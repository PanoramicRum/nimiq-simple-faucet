/**
 * Asserts that schema.sqlite.ts and schema.pg.ts define the same tables
 * with the same column names. Catches drift where a column is added to
 * one dialect but not the other.
 */
import { describe, expect, it } from 'vitest';
import * as sqlite from '../src/db/schema.sqlite.js';
import * as pg from '../src/db/schema.pg.js';

function columnNames(table: Record<string, unknown>): string[] {
  return Object.keys(table)
    .filter((k) => {
      const col = table[k] as { name?: string; columnType?: string } | null;
      // Drizzle columns have both `name` (the DB column name) and `columnType`.
      // Filter out non-column properties like pgTable's `enableRLS`.
      return col && typeof col.name === 'string' && typeof col.columnType === 'string';
    })
    .map((k) => (table[k] as { name: string }).name)
    .sort();
}

describe('SQLite / Postgres schema parity', () => {
  const sqliteExports = Object.entries(sqlite).filter(
    ([, v]) => v && typeof v === 'object' && Symbol.for('drizzle:Name') in (v as object),
  );
  const pgExports = Object.entries(pg).filter(
    ([, v]) => v && typeof v === 'object' && Symbol.for('drizzle:Name') in (v as object),
  );

  it('both schemas export the same table names', () => {
    const sqliteNames = sqliteExports.map(([k]) => k).sort();
    const pgNames = pgExports.map(([k]) => k).sort();
    expect(sqliteNames).toEqual(pgNames);
  });

  for (const [exportName, sqliteTable] of sqliteExports) {
    const pgTable = pg[exportName as keyof typeof pg];
    if (!pgTable) continue;

    it(`table "${exportName}" has the same columns in both dialects`, () => {
      const sqliteCols = columnNames(sqliteTable as Record<string, unknown>);
      const pgCols = columnNames(pgTable as Record<string, unknown>);
      expect(sqliteCols).toEqual(pgCols);
    });
  }
});
