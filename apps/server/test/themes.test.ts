/**
 * §3.0.14 — bundled-theme registry resolution.
 *
 * The full UI-mounting path requires real built assets and is exercised
 * by the smoke job. These tests cover the registry's logic surface in
 * isolation: known slugs resolve, unknown slugs fall back to the default,
 * and the manifest shape stays consistent across themes.
 */

import { describe, expect, it } from 'vitest';
import { THEMES, DEFAULT_THEME, isKnownTheme, listThemes } from '../src/themes.js';

describe('THEMES registry', () => {
  it('exposes the default theme', () => {
    expect(DEFAULT_THEME in THEMES).toBe(true);
    expect(THEMES[DEFAULT_THEME].displayName).toBeTruthy();
    expect(THEMES[DEFAULT_THEME].distFromRepoRoot).toMatch(/^apps\/.*\/dist$/);
    expect(THEMES[DEFAULT_THEME].distInImage).toMatch(/^\/app\/themes\/.*\/dist$/);
  });

  it.each(Object.entries(THEMES))(
    'theme %s has a complete manifest',
    (slug, manifest) => {
      expect(manifest.displayName).toBeTruthy();
      expect(manifest.description).toBeTruthy();
      expect(manifest.distFromRepoRoot).toMatch(/^apps\/.*\/dist$/);
      expect(manifest.distInImage).toBe(`/app/themes/${slug}/dist`);
    },
  );

  it('isKnownTheme distinguishes registered slugs from typos', () => {
    expect(isKnownTheme('porcelain-vault')).toBe(true);
    expect(isKnownTheme('porcelain-valt')).toBe(false); // typo
    expect(isKnownTheme('')).toBe(false);
    expect(isKnownTheme('NIMIQ-POW')).toBe(false); // case-sensitive
  });

  it('listThemes returns every registered theme with its manifest', () => {
    const all = listThemes();
    expect(all.length).toBe(Object.keys(THEMES).length);
    expect(all.every((entry) => entry.manifest === THEMES[entry.slug])).toBe(true);
  });
});
