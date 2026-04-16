import { existsSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

interface E2EState {
  baseUrl: string;
  dataDir: string;
  pid: number;
}

function repoRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return resolve(here, '..', '..');
}

export default async function globalTeardown(): Promise<void> {
  const statePath = resolve(repoRoot(), '.e2e-state.json');

  const ref = (globalThis as unknown as {
    __faucetE2E?: { app: FastifyInstance; dataDir: string };
  }).__faucetE2E;

  if (ref) {
    try {
      await ref.app.close();
    } catch {
      // best-effort
    }
    try {
      rmSync(ref.dataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  } else if (existsSync(statePath)) {
    try {
      const state: E2EState = JSON.parse(readFileSync(statePath, 'utf8'));
      rmSync(state.dataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  try {
    if (existsSync(statePath)) unlinkSync(statePath);
  } catch {
    // best-effort
  }
}
