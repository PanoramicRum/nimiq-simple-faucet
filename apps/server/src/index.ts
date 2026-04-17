import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { startReconciler } from './reconcile.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, ctx } = await buildApp(config);
  await app.listen({ host: config.host, port: config.port });
  const stopReconciler = startReconciler(ctx);
  app.addHook('onClose', () => stopReconciler());
  app.log.info({ network: config.network, signerDriver: config.signerDriver }, 'faucet up');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
