import { defineConfig } from 'vitest/config';

/**
 * Vitest 4 dropped `**\/dist/**` from its default `exclude` list. This package
 * compiles `src/**` (tests included) to `dist/**` via `tsc`, so without an
 * explicit exclude every colocated unit test is collected TWICE — once as
 * TypeScript source and once as its compiled JavaScript copy.
 *
 * That is not merely wasteful (57 duplicate cases). `dist/` is gitignored and
 * survives `git checkout`, and turbo restores it from its build cache, so a
 * branch switch leaves compiled tests on disk that no longer have a source
 * counterpart — they then fail against the current schema (or, worse, pass and
 * mask a deletion). Tests must run from source only.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
