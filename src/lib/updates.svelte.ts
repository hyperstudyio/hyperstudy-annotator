// Updating the app in place: a check against the releases' latest.json (tauri-plugin-updater; the endpoint and the
// public key that every download must be signed with are in tauri.conf.json), then download and install, then a
// relaunch into the new version. Checked quietly at launch, and on demand (Settings, or the macOS app menu's Check for
// Updates…). Nothing downloads until the user asks; the relaunch waits for a run in progress (see Settings).

export interface Pending {
  version: string;
  notes: string;
  /** Download, check its signature, install. `on`: bytes so far, and the total when the server gave one. */
  install(on: (done: number, total: number | null) => void): Promise<void>;
}

export interface UpdaterApi {
  version(): Promise<string>;
  /** The newer release, or null when this is the newest. Rejects when the check could not be made. */
  check(): Promise<Pending | null>;
  relaunch(): Promise<void>;
}

export type Phase =
  | { kind: 'idle' }                                                   // not checked, or a quiet check found nothing
  | { kind: 'checking' }
  | { kind: 'current'; at: Date }                                      // the newest, as of `at`
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'downloading'; version: string; fraction: number | null }  // null: the server gave no size
  | { kind: 'ready'; version: string }                                 // installed: the relaunch finishes it
  | { kind: 'failed'; op: 'check' | 'install'; message: string };

export async function tauriUpdater(): Promise<UpdaterApi> {
  const [{ check }, { relaunch }, { getVersion }] = await Promise.all([
    import('@tauri-apps/plugin-updater'), import('@tauri-apps/plugin-process'), import('@tauri-apps/api/app')]);
  return {
    version: getVersion,
    async check() {
      const u = await check({ timeout: 20_000 });   // a hung endpoint fails the check, not the button
      if (!u) return null;
      return {
        version: u.version, notes: u.body ?? '',
        install: (on) => {
          let done = 0, total: number | null = null;
          return u.downloadAndInstall((e) => {
            if (e.event === 'Started') total = e.data.contentLength ?? null;
            else if (e.event === 'Progress') { done += e.data.chunkLength; on(done, total); }
          });
        },
      };
    },
    relaunch,
  };
}

export class Updates {
  phase = $state<Phase>({ kind: 'idle' });
  /** this app's version (null until known) */
  version = $state<string | null>(null);
  /** a quiet check that failed: said in Settings, never as an interruption */
  quietError = $state<string | null>(null);
  #api: UpdaterApi;
  #pending: Pending | null = null;
  #checking = false;

  constructor(api: UpdaterApi) {
    this.#api = api;
    api.version().then((v) => (this.version = v)).catch(() => {});
  }

  /** `quiet` (at launch): say nothing unless there is an update. Asked for: say what the check found, or why it
   *  could not be made. Neither interrupts a download, or loses an update already found to a check that fails. */
  async check({ quiet = false } = {}) {
    const p = this.phase.kind;
    if (this.#checking || p === 'downloading' || p === 'ready') return;
    this.#checking = true;
    const before = this.phase;
    if (!quiet) this.phase = { kind: 'checking' };
    try {
      const next = await this.#api.check();
      this.quietError = null;
      this.#pending = next;
      this.phase = next ? { kind: 'available', version: next.version, notes: next.notes } : { kind: 'current', at: new Date() };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (before.kind === 'available') this.phase = before;   // its download is still there to take
      else if (quiet) { this.quietError = message; this.phase = before; }
      else this.phase = { kind: 'failed', op: 'check', message };
    } finally { this.#checking = false; }
  }

  async install() {
    if (this.phase.kind !== 'available' || !this.#pending) return;
    const { version } = this.phase;
    this.phase = { kind: 'downloading', version, fraction: 0 };
    try {
      await this.#pending.install((done, total) => (this.phase = { kind: 'downloading', version, fraction: total ? Math.min(done / total, 1) : null }));
      this.#pending = null;
      this.phase = { kind: 'ready', version };
    } catch (e) {
      this.phase = { kind: 'failed', op: 'install', message: e instanceof Error ? e.message : String(e) };
    }
  }

  relaunch() { return this.#api.relaunch(); }
}
