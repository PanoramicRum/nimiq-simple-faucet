import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = join(HERE, '../src/routes');
const MCP_ROUTE_FILE = join(HERE, '../src/mcp/index.ts');
const OPENAPI_DOCUMENT_FILE = join(HERE, '../src/openapi/document.ts');

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function normalizePath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

function collectRuntimePaths(): Set<string> {
  const paths = new Set<string>();
  const files = [...collectTsFiles(ROUTES_DIR), MCP_ROUTE_FILE];
  const routeRegex = /app\.(?:get|post|patch|delete)\(\s*['"]([^'"]+)['"]/g;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    while (true) {
      match = routeRegex.exec(source);
      if (!match) break;
      paths.add(normalizePath(match[1] ?? ''));
    }
  }
  return paths;
}

function collectOpenapiPaths(): Set<string> {
  const source = readFileSync(OPENAPI_DOCUMENT_FILE, 'utf8');
  const paths = new Set<string>();
  const pathRegex = /path:\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while (true) {
    match = pathRegex.exec(source);
    if (!match) break;
    paths.add(match[1] ?? '');
  }
  return paths;
}

describe('OpenAPI path parity', () => {
  it('keeps documented paths in sync with runtime route registrations', () => {
    const runtime = collectRuntimePaths();
    const openapi = collectOpenapiPaths();

    const missingInOpenapi = [...runtime].filter((p) => !openapi.has(p)).sort();
    const extraInOpenapi = [...openapi].filter((p) => !runtime.has(p)).sort();

    expect(missingInOpenapi).toEqual([]);
    expect(extraInOpenapi).toEqual([]);
  });
});
