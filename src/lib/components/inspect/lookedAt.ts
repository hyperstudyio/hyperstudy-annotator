import type { Session } from '../../model/session.svelte';

/** Who Gaze-LLE has looking at these object tracks, and for how long. */
export function lookedAtBy(s: Session, ids: Set<string>): string {
  const counts = new Map<string, number>(), fps = s.bundle.layers.gaze?.fps ?? 8;
  for (const [face, samples] of s.bundle.gazeOf) {
    const n = samples.filter((g) => g.target && ids.has(g.target)).length;
    if (!n) continue;
    const p = s.personOfFace(face);
    const name = p ? s.nameOf(p) : face;
    counts.set(name, (counts.get(name) ?? 0) + n);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} (${(n / fps).toFixed(1)} s)`).join(', ');
}
