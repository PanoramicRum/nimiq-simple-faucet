/**
 * Admin CLI — one-off operations that don't need the full Fastify server.
 *
 * Usage inside the Docker container:
 *   docker exec <container> node apps/server/dist/admin-cli.js reset-totp
 *
 * The CLI shares the server's DB schema so it can safely read/write the
 * same SQLite file without schema drift.
 */
import { join } from 'node:path';
import { openDb } from './db/index.js';
import { adminUsers, adminSessions } from './db/schema.js';

const DATA_DIR = process.env.FAUCET_DATA_DIR ?? '/data';

const COMMANDS: Record<string, () => Promise<void>> = {
  'reset-totp': async () => {
    const db = openDb({ dataDir: DATA_DIR });
    // Wipe TOTP secrets + all sessions so the operator gets a fresh
    // TOTP provisioning URI on the next login.
    await db.delete(adminSessions);
    await db.delete(adminUsers);
    console.log('TOTP reset complete. Log in again at /admin/login to re-enrol.');
  },
};

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd || !COMMANDS[cmd]) {
    console.error(`Usage: node admin-cli.js <command>\n\nCommands:\n  ${Object.keys(COMMANDS).join('\n  ')}`);
    process.exit(1);
  }
  await COMMANDS[cmd]();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
