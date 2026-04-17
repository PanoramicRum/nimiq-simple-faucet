import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { startReconciler } from './reconcile.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, ctx } = await buildApp(config);
  // Start the reconciler BEFORE listen and register cleanup BEFORE listen
  // — Fastify 5 forbids addHook() after the instance is listening.
  const stopReconciler = startReconciler(ctx);
  app.addHook('onClose', () => stopReconciler());
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ network: config.network, signerDriver: config.signerDriver }, 'faucet up');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
