// Per-viewer layout: which timeline groups and rows are hidden, collapsed, reordered or resized, the overlay layers,
// the drawer and the splitters. Kept in localStorage per video. Never corrections: nothing here changes the data.

export const GROUP_KEYS = ['audio', 'prosody', 'people', 'objects', 'gestures', 'social', 'sounds', 'text', 'annotations'] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export interface OverlayLayers {
  boxes: boolean; objects: boolean; skeleton: boolean; hands: boolean; unlinkedHands: boolean;
  landmarks: boolean; gaze: boolean; smooth: boolean;
}
export type GazeSource = 'gaze_lle' | 'pyfeat';
export type Tab = 'inspect' | 'review' | 'people' | 'notes';

export interface ViewState {
  collapsed: string[];
  hidden: string[];                     // row ids
  hiddenGroups: string[];
  heights: Record<string, number>;      // row id -> px, for rows the viewer resized
  groupOrder: string[];
  rowOrder: Record<string, string[]>;   // group -> row ids, for rows the viewer moved
  layers: OverlayLayers;
  gazeSource: GazeSource;
  drawerClosed: boolean;
  drawerW: number | null;
  timelineH: number | null;
}

export const defaultView = (): ViewState => ({
  collapsed: [], hidden: [], hiddenGroups: [], heights: {}, groupOrder: [], rowOrder: {},
  layers: { boxes: true, objects: true, skeleton: false, hands: false, unlinkedHands: false, landmarks: false, gaze: false, smooth: true },
  // Gaze-LLE is the default: on OOO it read more accurately by eye than PaGE and the py-feat ray (user review 2026-10-23)
  gazeSource: 'gaze_lle',
  drawerClosed: false, drawerW: null, timelineH: null,
});

export const MIN_ROW_H = 14, MAX_ROW_H = 480;
export const DRAWER_W: [number, number] = [260, 900];

/** Move `id` so that it lands before the item now at index `at` (at = length: last). */
export function moveTo(ids: string[], id: string, at: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const out = ids.filter((x) => x !== id);
  out.splice(at > from ? at - 1 : at, 0, id);
  return out;
}

/** Items in the viewer's order: ones the viewer placed first, in that order; the rest keep their own order after. */
export function ordered<T>(items: T[], key: (x: T) => string, order: string[]): T[] {
  const rank = (x: T) => { const i = order.indexOf(key(x)); return i >= 0 ? i : order.length; };
  return items.map((x, i) => [x, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([x]) => x);
}

export class View {
  s = $state<ViewState>(defaultView());
  readonly key: string;
  #storage: Storage | null;

  constructor(sha256: string, storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage) {
    this.key = `hyperstudy-annotator:view:${sha256}`;
    this.#storage = storage;
    const saved = this.#read();
    if (saved) this.s = { ...defaultView(), ...saved, layers: { ...defaultView().layers, ...saved.layers } };
  }

  #read(): Partial<ViewState> | null {
    try { return JSON.parse(this.#storage?.getItem(this.key) ?? 'null'); }
    catch { return null; }   // a first visit, or storage blocked: the default layout
  }
  save() {
    try { this.#storage?.setItem(this.key, JSON.stringify(this.s)); }
    catch { /* layout is a convenience; nothing is lost */ }
  }

  toggleCollapsed(group: string) { this.s.collapsed = toggled(this.s.collapsed, group); this.save(); }
  setGroupShown(group: string, shown: boolean) {
    this.s.hiddenGroups = shown ? this.s.hiddenGroups.filter((k) => k !== group) : [...new Set([...this.s.hiddenGroups, group])];
    this.save();
  }
  hideRow(id: string) { if (!this.s.hidden.includes(id)) this.s.hidden = [...this.s.hidden, id]; this.save(); }
  showRows(ids: string[] | 'all') { this.s.hidden = ids === 'all' ? [] : this.s.hidden.filter((id) => !ids.includes(id)); this.save(); }
  setHeight(id: string, h: number | null) {
    const heights = { ...this.s.heights };
    if (h === null) delete heights[id]; else heights[id] = Math.max(MIN_ROW_H, Math.min(MAX_ROW_H, Math.round(h)));
    this.s.heights = heights; this.save();
  }
  /** `shown` is the groups in their current order; groups not shown (hidden ones) keep a place after them. */
  moveGroup(shown: string[], id: string, at: number) {
    const ids = moveTo(shown, id, at);
    this.s.groupOrder = [...ids, ...GROUP_KEYS.filter((k) => !ids.includes(k))];
    this.save();
  }
  moveRow(group: string, shown: string[], id: string, at: number) {
    this.s.rowOrder = { ...this.s.rowOrder, [group]: moveTo(shown, id, at) };
    this.save();
  }
  setLayer(key: keyof OverlayLayers, on: boolean) { this.s.layers[key] = on; this.save(); }
  setGazeSource(src: GazeSource) { this.s.gazeSource = src; this.save(); }
  toggleDrawer() { this.s.drawerClosed = !this.s.drawerClosed; this.save(); }
  setDrawerW(w: number | null) { this.s.drawerW = w === null ? null : Math.max(DRAWER_W[0], Math.min(DRAWER_W[1], Math.round(w))); }
  setTimelineH(h: number | null) { this.s.timelineH = h === null ? null : Math.round(h); }
}

const toggled = (list: string[], x: string) => (list.includes(x) ? list.filter((k) => k !== x) : [...list, x]);
