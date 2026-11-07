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

// Bot Discord optionnel : démarre avec le serveur quand le token et la guilde
// sont configurés. Il crée la catégorie et les salons VALARIA au premier passage.
let discordBot = null;
const discordConfig = started.config;
if (discordConfig?.discordEnabled && discordConfig.discordToken && discordConfig.discordGuildId) {
  try {
    const { startDiscordBot } = await import('./src/discord/bot.js');
    discordBot = await startDiscordBot({
      logger: started.log,
      env: {
        ...process.env,
        DISCORD_TOKEN: discordConfig.discordToken,
        DISCORD_GUILD_ID: discordConfig.discordGuildId,
        DISCORD_CATEGORY_NAME: discordConfig.discordCategoryName,
        DISCORD_SYNC_CHANNELS: discordConfig.discordSyncChannels ? '1' : '0',
        DISCORD_SITE_URL: discordConfig.discordSiteUrl,
        PUBLIC_BASE_URL: discordConfig.publicBaseUrl,
      },
    });
    if (discordBot) {
      discordBot.ready
        .then(() => started.log?.info?.('Discord : salons et commandes synchronisés.'))
        .catch((error) => started.log?.warn?.(`Discord : initialisation incomplète : ${error.message}`));
    }
  } catch (error) {
    started.log?.warn?.(`Discord : bot non démarré : ${error.message}`);
  }
}

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
  try {
    if (discordBot) await discordBot.destroy();
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
