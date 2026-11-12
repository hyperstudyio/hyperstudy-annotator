// Each word of an utterance where it is spoken. The bundle times every word the transcriber heard (transcript.words);
// a corrected utterance is stored as its whole text (utterance.text), so its words are placed again from that text:
// a word-level diff against the words as heard, where a word kept keeps its time, and words that replace others share
// the time of the words they replace. Nothing new is stored, so the corrections file (and what HyperStudy reads) stays
// as it is, and a correction typed in Inspect lines up on the timeline as one typed there does.
import type { Span } from '../types';

export interface TimedWord extends Span { w: string }

/** A word as compared: case and punctuation aside ("Trends," is "trends"). */
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
export const tokens = (text: string) => text.split(/\s+/).filter(Boolean);

/** A stretch of the diff: words as heard (`from`, `to` exclusive) and the text's words that stand for them. */
interface Run { o: [number, number]; t: [number, number] }

/** The text's words placed on the times of `heard` (the words as transcribed, in order). */
export function alignWords(heard: TimedWord[], text: string): TimedWord[] {
  const T = tokens(text);
  if (!heard.length || !T.length) return [];
  const a = heard.map((x) => norm(x.w)), b = T.map(norm), n = a.length, m = b.length;
  // longest common subsequence, from the end, so the walk below goes forwards
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] && a[i] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  // runs: each kept word alone, and between two kept words the heard words and the text's words in between
  const runs: Run[] = [];
  let i = 0, j = 0, oi = 0, tj = 0;
  const gapRun = () => { if (i > oi || j > tj) runs.push({ o: [oi, i], t: [tj, j] }); };
  while (i < n && j < m) {
    if (a[i] === b[j] && a[i]) { gapRun(); runs.push({ o: [i, i + 1], t: [j, j + 1] }); i++; j++; oi = i; tj = j; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  i = n; j = m; gapRun();
  // a word added where none was heard: it shares the time of the run before it (or after, at the start), as if it had
  // been typed into that word. A pause wide enough to say it in takes it instead.
  const merged: Run[] = [];
  let pending: [number, number] | null = null;   // words added before the first word heard: they join the next run
  for (const r of runs) {
    if (r.o[0] === r.o[1]) {   // only added words
      const before = r.o[0] > 0 ? heard[r.o[0] - 1].end : null, after = r.o[0] < n ? heard[r.o[0]].start : null;
      if (before !== null && after !== null && after - before >= 0.15 * (r.t[1] - r.t[0])) merged.push({ o: [...r.o], t: [...r.t] });
      else if (merged.length) merged.at(-1)!.t[1] = r.t[1];   // the runs are contiguous in the text
      else pending = [...r.t];
      continue;
    }
    merged.push({ o: [...r.o], t: [pending ? pending[0] : r.t[0], r.t[1]] });
    pending = null;
  }
  // lay each run's words over its time, by their length in letters
  const out: TimedWord[] = [];
  for (const r of merged) {
    const words = T.slice(r.t[0], r.t[1]);
    if (!words.length) continue;   // words deleted
    const start = r.o[0] < r.o[1] ? heard[r.o[0]].start : heard[r.o[0] - 1].end;
    const end = r.o[0] < r.o[1] ? heard[r.o[1] - 1].end : heard[r.o[0]].start;
    const weights = words.map((w) => Math.max(1, w.length)), total = weights.reduce((x, y) => x + y, 0);
    let t = start;
    words.forEach((w, k) => { const e = k === words.length - 1 ? end : t + ((end - start) * weights[k]) / total; out.push({ w, start: t, end: e }); t = e; });
  }
  return out;
}

/** The utterance's text with word `index` replaced by `text` (several words: it is split; empty: it is deleted). */
export function replaceWord(words: string[], index: number, text: string): string {
  const next = [...words];
  next.splice(index, 1, ...tokens(text));
  return next.join(' ');
}
