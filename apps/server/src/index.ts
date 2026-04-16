import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app } = await buildApp(config);
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ network: config.network, signerDriver: config.signerDriver }, 'faucet up');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
