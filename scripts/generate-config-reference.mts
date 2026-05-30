#!/usr/bin/env tsx
/**
 * Generates `docs/config-reference.md` from the canonical sources:
 *
 *   - `apps/server/src/config.ts` Zod schema (type, default, constraints)
 *   - same file's JSDoc comments (parsed from source text via regex)
 *   - `ENV_KEYS` mapping (field → env-var name)
 *
 * Runs in seconds; no DB / Redis / server boot. Invoked by
 * `pnpm generate:config-reference`, by `pnpm pre-merge` as a drift check,
 * and by `.github/workflows/config-reference-drift.yml` on a weekly cron.
 *
 * If you need to tweak the rendered output, edit `renderMarkdown()` below;
 * never hand-edit `docs/config-reference.md` itself.
 *
 * §2.3.8.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { ServerConfigSchema, ENV_KEYS } from '../apps/server/src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const configSourcePath = resolve(repoRoot, 'apps/server/src/config.ts');
const outputPath = resolve(repoRoot, 'docs/config-reference.md');

interface FieldDoc {
  fieldName: string;
  envVar: string;
  typeLabel: string;
  defaultLabel: string;
  constraintLabel: string;
  required: boolean;
  jsdoc: string;
}

/**
 * Walk a Zod 4 schema to produce human-readable type/default/constraint
 * strings. Strips `optional`/`default`/`pipe` (transform) wrappers, then
 * reads the unwrapped schema's `_def.type` plus the inline properties Zod 4
 * exposes (`minLength`/`maxLength` on strings, `minValue`/`maxValue`/`format`
 * on numbers, `options` on enums, etc.).
 */
function describeZod(schema: z.ZodTypeAny): {
  typeLabel: string;
  defaultLabel: string;
  constraintLabel: string;
  required: boolean;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = schema;
  let required = true;
  let defaultLabel = '—';

  // Strip outer wrappers, recording optional/default along the way.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const def = current?._def;
    if (!def) break;
    if (def.type === 'optional') {
      required = false;
      current = def.innerType;
      continue;
    }
    if (def.type === 'default') {
      required = false;
      defaultLabel = formatDefault(def.defaultValue);
      current = def.innerType;
      continue;
    }
    if (def.type === 'pipe') {
      // .transform(...) becomes a pipe (input → transform). Inspect the
      // input side for the original shape; if that's still a pipe we give
      // up and treat the field as "transformed string".
      const next = def.in ?? def.left;
      if (next && next._def?.type !== 'pipe') {
        current = next;
        continue;
      }
      break;
    }
    break;
  }

  const def = current?._def ?? {};
  const constraints: string[] = [];
  let typeLabel: string;

  switch (def.type) {
    case 'string': {
      typeLabel = 'string';
      const format = current.format;
      const min = current.minLength;
      const max = current.maxLength;
      if (format === 'url') constraints.push('URL');
      if (min != null) constraints.push(`min len: ${min}`);
      if (max != null) constraints.push(`max len: ${max}`);
      break;
    }
    case 'number': {
      const fmt = current.format;
      const isInt = fmt === 'safeint' || fmt === 'int32' || fmt === 'int';
      typeLabel = isInt ? 'integer' : 'number';
      // Suppress Zod 4's implicit safeint cap (Number.MAX_SAFE_INTEGER) and
      // its implicit min — these aren't real constraints the source author wrote.
      const SAFE_MAX = Number.MAX_SAFE_INTEGER;
      const SAFE_MIN = -SAFE_MAX;
      if (current.minValue != null && current.minValue !== SAFE_MIN) {
        constraints.push(`min: ${formatNumberRaw(current.minValue)}`);
      }
      if (current.maxValue != null && current.maxValue !== SAFE_MAX) {
        constraints.push(`max: ${formatNumberRaw(current.maxValue)}`);
      }
      break;
    }
    case 'bigint': {
      typeLabel = 'bigint';
      if (current.minValue != null) constraints.push(`min: ${current.minValue}n`);
      if (current.maxValue != null) constraints.push(`max: ${current.maxValue}n`);
      break;
    }
    case 'boolean': {
      typeLabel = 'boolean';
      break;
    }
    case 'enum': {
      const options: readonly string[] = current.options ?? [];
      // Use `\|` to escape pipes inside the markdown-table cell.
      typeLabel = `enum(${options.map((v) => `\`${v}\``).join(' \\| ')})`;
      break;
    }
    case 'array': {
      typeLabel = 'array';
      break;
    }
    default: {
      typeLabel = def.type ? String(def.type) : '—';
    }
  }

  const constraintLabel = constraints.length > 0 ? constraints.join(', ') : '—';
  return { typeLabel, defaultLabel, constraintLabel, required };
}

function formatDefault(v: unknown): string {
  if (typeof v === 'bigint') return `\`${v.toString()}n\``;
  if (typeof v === 'string') return v === '' ? '`""`' : `\`${v}\``;
  if (typeof v === 'number') return `\`${formatNumberRaw(v)}\``;
  if (typeof v === 'boolean') return `\`${v}\``;
  if (Array.isArray(v)) return v.length === 0 ? '`[]`' : `\`[${v.map((x) => formatDefault(x)).join(', ')}]\``;
  return '`' + JSON.stringify(v) + '`';
}

function formatNumberRaw(n: number): string {
  // 60000 → 60_000 for readability when it matches the source style
  if (Number.isInteger(n) && Math.abs(n) >= 10_000) {
    return n.toLocaleString('en-US').replace(/,/g, '_');
  }
  return String(n);
}

/**
 * Best-effort JSDoc extraction. config.ts is consistent enough that a regex
 * over the source captures every JSDoc block immediately preceding a field
 * declaration. We strip leading `*`, leading whitespace, and join multi-line
 * comments into a single paragraph.
 */
function parseJsdocs(sourceText: string): Map<string, string> {
  const map = new Map<string, string>();
  // Match: /** ... */ \n  <whitespace> fieldName: ...
  const pattern = /\/\*\*([\s\S]*?)\*\/\s*\n\s*(\w+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(sourceText)) !== null) {
    const fieldName = m[2];
    const body = m[1]
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .filter((line, i, arr) => !(i === 0 && line === '') && !(i === arr.length - 1 && line === ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (body.length > 0) map.set(fieldName, body);
  }
  return map;
}

function renderMarkdown(rows: FieldDoc[]): string {
  const header = `<!-- AUTO-GENERATED by scripts/generate-config-reference.mts. Do NOT hand-edit. Regenerate via \`pnpm generate:config-reference\`. -->

# Faucet configuration reference

Every \`FAUCET_*\` environment variable accepted by the server, with type, default, constraints, and a one-line description from the source-of-truth JSDoc in [\`apps/server/src/config.ts\`](../apps/server/src/config.ts). Generated by [\`scripts/generate-config-reference.mts\`](../scripts/generate-config-reference.mts) and verified for drift by \`pnpm pre-merge\` plus a weekly CI check (\`.github/workflows/config-reference-drift.yml\`).

**Required column:** ✓ means the field must be set; otherwise the column is empty (the field is optional, has a default, or is conditional on the deployment mode).

**Not covered here:**
- The non-\`FAUCET_*\` env vars \`DATABASE_URL\` and \`REDIS_URL\` (standard 12-factor names, used by the DB and Redis clients respectively).
- Runtime overrides via \`PATCH /admin/config\` (claim amount, rate limit, abuse thresholds, layer toggles) — see [\`apps/server/src/routes/admin/config.ts\`](../apps/server/src/routes/admin/config.ts) and the \`AdminConfigPatch\` schema in [\`apps/server/src/openapi/schemas.ts\`](../apps/server/src/openapi/schemas.ts).
- The public derivation served at \`GET /v1/config\` — see [\`apps/server/src/configView.ts\`](../apps/server/src/configView.ts).

## All variables (${rows.length})

| Env var | Type | Default | Constraints | Required | Description |
|---|---|---|---|---|---|
`;

  const body = rows
    .map((r) =>
      `| \`${r.envVar}\` | ${r.typeLabel} | ${r.defaultLabel} | ${r.constraintLabel} | ${r.required ? '✓' : ''} | ${r.jsdoc} |`,
    )
    .join('\n');

  return header + body + '\n';
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');

  const sourceText = await readFile(configSourcePath, 'utf8');
  const jsdocs = parseJsdocs(sourceText);

  const rows: FieldDoc[] = [];
  for (const [fieldName, envVar] of Object.entries(ENV_KEYS)) {
    // Skip non-FAUCET_ vars — DATABASE_URL and REDIS_URL are standard
    // 12-factor names. The doc preface calls them out separately.
    if (!envVar.startsWith('FAUCET_')) continue;
    const schema = (ServerConfigSchema.shape as Record<string, z.ZodTypeAny>)[fieldName];
    if (!schema) {
      // ENV_KEYS lists a field that's not in the schema — log and skip.
      // eslint-disable-next-line no-console
      console.warn(`[generate-config-reference] ENV_KEYS entry "${fieldName}" not found in ServerConfigSchema.shape; skipping`);
      continue;
    }
    const { typeLabel, defaultLabel, constraintLabel, required } = describeZod(schema);
    rows.push({
      fieldName,
      envVar,
      typeLabel,
      defaultLabel,
      constraintLabel,
      required,
      jsdoc: jsdocs.get(fieldName) ?? '—',
    });
  }

  const markdown = renderMarkdown(rows);

  if (check) {
    let existing = '';
    try {
      existing = await readFile(outputPath, 'utf8');
    } catch {
      // File missing entirely → drift.
    }
    if (existing !== markdown) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[generate-config-reference] DRIFT: docs/config-reference.md is out of sync with apps/server/src/config.ts.\n` +
          `Run \`pnpm generate:config-reference\` to regenerate, then commit the result.\n`,
      );
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`docs/config-reference.md is up to date (${rows.length} entries).`);
    return;
  }

  await writeFile(outputPath, markdown, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outputPath} (${rows.length} entries)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
