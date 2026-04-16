/**
 * Generate the frozen OpenAPI spec at packages/openapi/{openapi.yaml,openapi.json}.
 *
 * Invoked via `pnpm -F @faucet/server freeze:openapi`. The release workflow has
 * an equivalent "pull image and curl /openapi.yaml" step that is kept in sync
 * with this script so either path produces identical output.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { buildOpenapiDocument } from '../src/openapi/document.js';
import type { ServerConfig } from '../src/config.js';

// Minimal config — only `network` is read by buildOpenapiDocument.
const config = { network: 'test' } as ServerConfig;

const doc = buildOpenapiDocument(config);
const outDir = resolve(import.meta.dirname, '../../../packages/openapi');

writeFileSync(resolve(outDir, 'openapi.json'), JSON.stringify(doc, null, 2) + '\n');
writeFileSync(resolve(outDir, 'openapi.yaml'), YAML.stringify(doc));

console.log('Wrote:', resolve(outDir, 'openapi.yaml'));
console.log('Wrote:', resolve(outDir, 'openapi.json'));
