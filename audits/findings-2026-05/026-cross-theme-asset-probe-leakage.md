# Cross-theme asset probe serves any bundled theme's `dist/`

**Severity:** Low
**CVSS v3.1:** AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N (4.3)
**Component:** apps/server/src/ui.ts
**Affected versions:** main @ 855868a (introduced when the multi-theme system shipped)

> _The maintainer of this repository has waived the SECURITY.md private-disclosure policy for the duration of this audit; this finding is therefore filed publicly. Downstream forks should NOT inherit this disclosure channel._

## Summary

When the theme picker is enabled, the SPA fall-through handler at [`apps/server/src/ui.ts:161-190`](../../apps/server/src/ui.ts#L161-L190) probes *every* bundled theme's `dist/` for a missing asset before falling back to `index.html`. This means a request for `/some-asset.css` is served from the first non-active theme that has a file at that path, regardless of which theme the caller actually selected (or the operator deployed).

Practical consequence: if the operator includes any non-public file in any theme's `dist/` (e.g., a `staging.config.json` accidentally bundled, a `team-notes.txt` left over from development), it becomes reachable from every other theme. The cross-theme isolation that operators might assume the theme registry provides is *not* enforced for hashed assets.

This is path-traversal-adjacent (the directory boundary is permeable) but not classic traversal (no escape from `dist/` itself). Severity Low because it requires the operator to bundle sensitive files into a `dist/` — generally something the build pipeline doesn't do — and the assets are still scoped to the union of all bundled themes' `dist/`.

## Location

- [`apps/server/src/ui.ts:175-185`](../../apps/server/src/ui.ts#L175-L185) — the cross-theme probe loop:
  ```ts
  if (pathOnly && !pathOnly.includes('..') && /\.[a-zA-Z0-9]+$/.test(pathOnly)) {
    for (const altDir of altThemeDirs) {
      const candidate = resolve(altDir, pathOnly);
      if (existsSync(candidate)) {
        return reply.sendFile(pathOnly, altDir);
      }
    }
  }
  ```

The intent (per the comment at lines 157-160) is to make hashed assets resolve when `?theme=<slug>` serves a different theme's `index.html`. The implementation matches that intent for hashed JS/CSS, but doesn't restrict to known asset patterns.

## Reproduction

1. Bundle two themes: `porcelain-vault` (active, default) and `nimiq-pow`.
2. In `apps/nimiq-pow-ui/dist/`, place a file `internal-notes.txt` (simulates operator footgun).
3. Request `http://faucet/internal-notes.txt`.
4. Active theme is `porcelain-vault`; its `dist/` doesn't have the file. Fallback handler probes `nimiq-pow`'s `dist/`, finds it, serves it.
5. Anyone on the public internet has now read `internal-notes.txt`.

## Impact

- Operator must bundle a sensitive file into a theme's `dist/` for this to bite, which is bad practice but happens (e.g., source maps with comment-stripped secrets, dev-only JSON configs, README leftovers).
- The `\.[a-zA-Z0-9]+$` regex constrains exposure to extensioned files only — `internal-notes` (no extension) wouldn't match. So `*.txt`, `*.json`, `*.md`, `*.map` are reachable; bare-name files are not.
- Severity Low because (a) requires operator misconfiguration, (b) constrained to extensioned files, (c) bound to bundled-theme `dist/` directories specifically (no escape).

## Recommended fix

Two complementary mitigations:

### Fix 1 — only probe the *requested* theme

When the request includes `?theme=<slug>`, only probe that theme's `dist/`. When no `?theme=` is set, only probe the active theme's `dist/` (the SPA shell already covers the active theme's hashed assets via the static handler upstream of this fallback). Code sketch:

```ts
// Before
for (const altDir of altThemeDirs) {
  const candidate = resolve(altDir, pathOnly);
  ...
}

// After
const requested = themeForRequest(req, config, fallbackSlug, themeDirs);
const candidate = resolve(requested.dir, pathOnly);
if (existsSync(candidate)) {
  return reply.sendFile(pathOnly, requested.dir);
}
// No cross-theme fallback. Asset must live in the requested theme's dist/.
```

### Fix 2 — restrict asset-extension regex to known UI extensions

Change `\.[a-zA-Z0-9]+$` to a narrow allow-list: `\.(js|mjs|css|svg|png|jpe?g|gif|webp|woff2?|ttf|map)$`. This won't fix the leak class (a `.json` is still allowed because Vite emits `manifest.json`), but reduces the surface to what the SPA actually consumes.

Recommend Fix 1 alone — it's the principled fix. Fix 2 is a defence-in-depth nice-to-have.

## References

- [`apps/server/src/themes.ts`](../../apps/server/src/themes.ts) — the registry that the probe iterates
- [`apps/server/src/ui.ts:144-149`](../../apps/server/src/ui.ts#L144-L149) — `altThemeDirs` construction (every non-active theme's resolved `dist/`)
- [`docs/contributing-a-frontend.md`](../../docs/contributing-a-frontend.md) — should add a "don't bundle sensitive files in dist/" note
- Related CWE: CWE-200, CWE-552 (Files or Directories Accessible to External Parties)
