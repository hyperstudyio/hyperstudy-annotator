# Releasing @hyperstudyio/annotator

The package is published to npm by `.github/workflows/publish-annotator.yml` when a tag `annotator-vX.Y.Z` is
pushed. npm trusts that workflow by name (trusted publishing, the npm counterpart of PyPI's): no npm token is kept in
GitHub or anywhere else, and each version records the commit and workflow that built it (provenance).

## Once: the npm side (done by a person; npm cannot trust a workflow for a package that does not exist yet)

1. **An npm account**, with two-factor authentication on (npmjs.com → Sign up; then Account → Two-Factor
   Authentication, "Authorization and writes").
2. **The `hyperstudyio` organization** (npmjs.com → your avatar → Add Organization → name `hyperstudyio`, the free
   plan: public packages only, which is all this is). The organization is what owns the `@hyperstudyio` scope.
3. **The first version, from your computer**, in this repository on a checkout of main with this package merged:

   ```sh
   npm ci
   bash scripts/check-package.sh /tmp/annotator-pack   # builds, packs, checks it in a HyperStudy-like app, keeps it
   npm login                                           # opens the browser
   npm publish /tmp/annotator-pack/hyperstudyio-annotator-0.1.0.tgz --ignore-scripts --access public --dry-run
   npm publish /tmp/annotator-pack/hyperstudyio-annotator-0.1.0.tgz --ignore-scripts --access public   # asks for 2FA
   ```

   This publishes the tarball the check built and tested, as the workflow does, rather than a fresh build. The dry
   run lists what would be published: `dist/`, the README, the licence and `package.json`.
4. **Trust the workflow** (npmjs.com → the package → Settings → Trusted Publisher → GitHub Actions):
   organization `hyperstudyio`, repository `hyperstudy-annotator`, workflow `publish-annotator.yml`, no environment.
   Allow `npm publish`. A new connection must publish once within 2 days or it expires, so release soon after
   (below), or add it when the next release is ready.
5. **Turn tokens off** (same Settings page → Publishing access → "Require two-factor authentication and disallow
   tokens"). Trusted publishing is unaffected; a leaked token can then publish nothing.

## Each release

1. Bump `version` in `packages/annotator/package.json` (semver: a change to `BundleSource`, `CorrectionStore` or
   anything else `index.ts` exports that an embedding app must follow is a minor version while we are at 0.x) and
   merge it to main.
2. Tag that commit and push the tag:

   ```sh
   git tag annotator-v0.2.0 && git push origin annotator-v0.2.0
   ```

   The workflow refuses a tag that is not on main or does not match the package's version. A prerelease
   (`annotator-v0.2.0-beta.1`) is published under the `next` dist-tag, so `npm install` keeps the latest stable.
3. HyperStudy takes it by bumping `@hyperstudyio/annotator` in `frontend/package.json`.
