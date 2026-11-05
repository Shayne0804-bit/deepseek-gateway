import { printStartupBanner, startGateway } from './src/app.js';

let started;
try {
  started = await startGateway();
} catch (err) {
  if (err?.code === 'EADDRINUSE') {
    console.error(`\n  Le port ${process.env.PORT ?? 8787} est deja utilise.`);
    console.error('  Changez PORT dans .env ou arretez l autre application.\n');
  } else {
    console.error('\n  Demarrage impossible :', err?.message ?? err, '\n');
  }
  process.exit(1);
}

printStartupBanner(started);

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (!started.log?.silent) console.log(`\n  Arret (${signal})...`);
  try {
    await started.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  console.error('  Promesse rejetee non geree :', err);
});
