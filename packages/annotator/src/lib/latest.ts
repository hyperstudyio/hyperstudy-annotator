/** For calls whose results can arrive out of order: only the newest call's outcome (result or error) is delivered. */
export function latestOnly() {
  let newest = 0;
  return <T>(p: Promise<T>, ok: (v: T) => void, fail: (e: unknown) => void) => {
    const mine = ++newest;
    p.then((v) => { if (mine === newest) ok(v); }, (e) => { if (mine === newest) fail(e); });
  };
}
