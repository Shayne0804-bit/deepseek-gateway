/**
 * Bot Discord VALARIA Gateway.
 * Démarre avec le serveur quand DISCORD_TOKEN et DISCORD_GUILD_ID sont fournis.
 * Au premier démarrage, il crée la catégorie et les salons du site.
 */
import {
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { DISCORD_CATEGORY_NAME, DISCORD_CATEGORY_LEGACY_NAME, DISCORD_CHANNEL_TEMPLATES, categoryMatches, channelMatches, templateByKey } from './channels.js';
import { channelDocs } from './content.js';
import { setDiscordStatus } from './status.js';

const COMMANDS = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('VALARIA Gateway status and version'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('VALARIA links and bot commands'),
  new SlashCommandBuilder()
    .setName('api')
    .setDescription('VALARIA API URLs and integration'),
  new SlashCommandBuilder()
    .setName('valaria-code')
    .setDescription('Install and run VALARIA Code'),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),
].map((command) => command.toJSON());

function siteUrl(env) {
  return String(env.DISCORD_SITE_URL || env.PUBLIC_BASE_URL || 'https://api.valariamenu.com')
    .trim()
    .replace(/\/+$/, '');
}

function enabled(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(value));
}

function log(logger, level, message, ...args) {
  try {
    if (typeof logger?.[level] === 'function') logger[level](message, ...args);
    else console[level]?.(message, ...args);
  } catch {
    /* le bot ne doit jamais casser le serveur */
  }
}

async function statusEmbed(site, fetchImpl) {
  try {
    const response = await fetchImpl(`${site}/healthz`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return new EmbedBuilder()
      .setColor(0x2ba26a)
      .setTitle('VALARIA Gateway is online')
      .addFields(
        { name: 'Version', value: `\`${data.version || '—'}\``, inline: true },
        { name: 'Database', value: `\`${data.database || '—'}\``, inline: true },
        { name: 'Gateway', value: data.providerConfigured ? 'configured' : 'not configured', inline: true },
      )
      .setFooter({ text: 'VALARIA Status' })
      .setTimestamp();
  } catch (error) {
    return new EmbedBuilder()
      .setColor(0xf06b5d)
      .setTitle('VALARIA Gateway unavailable')
      .setDescription(`Health check failed: \`${String(error.message).slice(0, 200)}\``)
      .setFooter({ text: 'VALARIA Status' })
      .setTimestamp();
  }
}

async function ensureStatusPanel(channel, client, site, fetchImpl) {
  if (!channel) return;
  const embed = await statusEmbed(site, fetchImpl);
  try {
    const messages = await channel.messages.fetch({ limit: 20 });
    const current = messages.find((message) => message.author.id === client.user.id
      && ['VALARIA Status', 'Statut VALARIA'].includes(message.embeds[0]?.footer?.text));
    if (current) await current.edit({ embeds: [embed] });
    else await channel.send({ embeds: [embed] });
  } catch (error) {
    log(console, 'warn', `Discord status panel not published: ${error.message}`);
  }
}

async function ensureChannelDocs(channel, client, template, site, logger) {
  const docs = channelDocs(template.key, site);
  let recent = null;
  try {
    recent = await channel.messages.fetch({ limit: 50 });
  } catch (error) {
    log(logger, 'warn', `Discord : messages illisibles dans #${template.name} : ${error.message}`);
  }
  const markerPrefix = `VALARIA DOC · ${template.key} · `;
  const existing = new Map();
  if (recent) {
    for (const message of recent.values()) {
      if (message.author?.id !== client.user.id) continue;
      for (const embed of message.embeds ?? []) {
        const footer = embed.footer?.text || '';
        if (footer.startsWith(markerPrefix)) existing.set(footer.slice(markerPrefix.length), message);
      }
    }
  }
  let firstMessage = null;
  for (let index = 0; index < docs.length; index += 1) {
    const marker = `${index + 1}/${docs.length}`;
    const doc = docs[index];
    let embed = new EmbedBuilder()
      .setColor(0x2ba26a)
      .setTitle(String(doc.title || `VALARIA · ${template.name}`).slice(0, 256))
      .setDescription(String(doc.description || '').slice(0, 4096))
      .setFooter({ text: `${markerPrefix}${marker}` })
      .setTimestamp();
    if (doc.image) embed = embed.setImage(doc.image);
    try {
      const previous = existing.get(marker);
      const message = previous
        ? await previous.edit({ embeds: [embed] })
        : await channel.send({ embeds: [embed] });
      if (!firstMessage) firstMessage = message;
    } catch (error) {
      log(logger, 'warn', `Discord : documentation non envoyée dans #${template.name} : ${error.message}`);
      break;
    }
  }
  if (firstMessage) {
    await firstMessage.pin('Documentation VALARIA').catch(() => {});
  }
}

async function ensureChannels(guild, client, { site, categoryName, fetchImpl, logger }) {
  const channels = await guild.channels.fetch();
  let category = channels.find((channel) => channel?.type === ChannelType.GuildCategory
    && (channel.name === categoryName || categoryMatches(channel.name)));
  if (!category) {
    try {
      category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory, reason: 'Déploiement VALARIA Gateway' });
    } catch (error) {
      log(logger, 'warn', `Discord : catégorie stylée refusée, repli sur « ${DISCORD_CATEGORY_LEGACY_NAME} » : ${error.message}`);
      category = await guild.channels.create({ name: DISCORD_CATEGORY_LEGACY_NAME, type: ChannelType.GuildCategory, reason: 'Déploiement VALARIA Gateway' });
    }
    log(logger, 'info', `Discord : catégorie créée « ${category.name} »`);
  } else if (category.name !== categoryName) {
    await category.setName(categoryName).catch((error) => log(logger, 'warn', `Discord : catégorie non renommée : ${error.message}`));
  }

  const created = [];
  for (const template of DISCORD_CHANNEL_TEMPLATES) {
    let channel = channels.find((item) => item?.type === ChannelType.GuildText && channelMatches(template, item.name));
    const overwrites = [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: template.readOnly ? [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions] : [],
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ];
    if (!channel) {
      try {
        channel = await guild.channels.create({
          name: template.name,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: template.topic,
          permissionOverwrites: overwrites,
          reason: 'Salon VALARIA Gateway',
        });
      } catch (error) {
        log(logger, 'warn', `Discord : nom stylé refusé pour ${template.name}, repli sur « ${template.legacyName} » : ${error.message}`);
        channel = await guild.channels.create({
          name: template.legacyName,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: template.topic,
          permissionOverwrites: overwrites,
          reason: 'Salon VALARIA Gateway',
        });
      }
      created.push(channel);
      log(logger, 'info', `Discord : salon créé #${channel.name}`);
    } else {
      if (channel.parentId !== category.id) await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
      if (channel.name !== template.name) {
        await channel.setName(template.name).catch((error) => log(logger, 'warn', `Discord : #${template.legacyName} non renommé : ${error.message}`));
      }
      if (channel.topic !== template.topic) await channel.setTopic(template.topic).catch(() => {});
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: !template.readOnly,
        AddReactions: !template.readOnly,
      }).catch(() => {});
      await channel.permissionOverwrites.edit(client.user, {
        ViewChannel: true,
        SendMessages: true,
        EmbedLinks: true,
        ReadMessageHistory: true,
        ManageMessages: true,
      }).catch(() => {});
    }
    await ensureChannelDocs(channel, client, template, site, logger);
    if (template.key === 'status') await ensureStatusPanel(channel, client, site, fetchImpl);
  }
  return created;
}

async function registerCommands(guild, logger) {
  try {
    await guild.commands.set(COMMANDS);
    log(logger, 'info', `Discord : ${COMMANDS.length} commandes enregistrées`);
  } catch (error) {
    log(logger, 'warn', `Discord : commandes non enregistrées : ${error.message}`);
  }
}

async function handleCommand(interaction, { site, fetchImpl }) {
  if (!interaction.isChatInputCommand()) return;
  const name = interaction.commandName;
  try {
    if (name === 'ping') {
      await interaction.reply({ content: `Pong · ${Date.now() - interaction.createdTimestamp} ms`, ephemeral: true });
      return;
    }
    if (name === 'status') {
      const embed = await statusEmbed(site, fetchImpl);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (name === 'api') {
      const embed = new EmbedBuilder()
        .setColor(0x2ba26a)
        .setTitle('VALARIA Gateway API')
        .setDescription(`\`${site}/v1\` · OpenAI compatible\n\`${site}/anthropic\` · Anthropic Messages`)
        .addFields({ name: 'Guide', value: `[Open the guide](${site}/portal)`, inline: false });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (name === 'valaria-code') {
      const embed = new EmbedBuilder()
        .setColor(0x2ba26a)
        .setTitle('VALARIA Code')
        .setDescription('```bash\nnpm install -g valaria-code\nvalaria login\nvalaria\n```')
        .addFields(
          { name: 'Terminal', value: 'Permanent diff, conversation, approvals.', inline: false },
          { name: 'Guide', value: `[VALARIA dashboard](${site}/portal)`, inline: false },
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (name === 'help' || name === 'aide') {
      const embed = new EmbedBuilder()
        .setColor(0x2ba26a)
        .setTitle('VALARIA help')
        .setDescription('Bot commands and useful links.')
        .addFields(
          { name: 'Commands', value: '`/status` · `/api` · `/valaria-code` · `/help` · `/ping`', inline: false },
          { name: 'Website', value: `[Home](${site}) · [Dashboard](${site}/portal) · [Create account](${site}/signup)`, inline: false },
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (error) {
    log(console, 'warn', `Discord command ${name} failed: ${error.message}`);
    if (!interaction.replied) {
      await interaction.reply({ content: 'The command failed. Please try again later.', ephemeral: true }).catch(() => {});
    }
  }
}

export async function startDiscordBot({ env = process.env, logger = console, fetchImpl = fetch } = {}) {
  const token = String(env.DISCORD_TOKEN || '').trim();
  const guildId = String(env.DISCORD_GUILD_ID || '').trim();
  if (!token || !guildId) {
    log(logger, 'debug', 'Discord : DISCORD_TOKEN ou DISCORD_GUILD_ID absent, bot désactivé.');
    setDiscordStatus({ status: 'missing_config', error: 'DISCORD_TOKEN ou DISCORD_GUILD_ID manquant.' });
    return null;
  }
  if (!enabled(env.DISCORD_ENABLED, true)) {
    setDiscordStatus({ status: 'disabled' });
    return null;
  }
  setDiscordStatus({ status: 'connecting', error: null, guild: null, guildId });
  const site = siteUrl(env);
  const categoryName = String(env.DISCORD_CATEGORY_NAME || DISCORD_CATEGORY_NAME).trim() || DISCORD_CATEGORY_NAME;
  const syncChannels = enabled(env.DISCORD_SYNC_CHANNELS, true);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let statusTimer = null;
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  client.once('clientReady', async () => {
    log(logger, 'info', `Discord : connecté en tant que ${client.user.tag}`);
    client.user.setPresence({ status: 'online', activities: [{ name: 'VALARIA Gateway', type: 3 }] });
    setDiscordStatus({ status: 'syncing', guildId, error: null });
    readyResolve();
    try {
      const guild = await client.guilds.fetch(guildId);
      setDiscordStatus({ guild: guild.name, guildId: guild.id });
      if (syncChannels) await ensureChannels(guild, client, { site, categoryName, fetchImpl, logger });
      await registerCommands(guild, logger);
      const statusTemplate = templateByKey('status');
      const statusChannel = guild.channels.cache.find((channel) => channel?.type === ChannelType.GuildText && channelMatches(statusTemplate, channel.name));
      if (statusChannel) {
        statusTimer = setInterval(() => ensureStatusPanel(statusChannel, client, site, fetchImpl), 5 * 60_000);
        statusTimer.unref?.();
      }
      setDiscordStatus({ status: 'ready', guild: guild.name, guildId: guild.id, readyAt: new Date().toISOString(), lastSyncAt: new Date().toISOString(), error: null });
    } catch (error) {
      log(logger, 'warn', `Discord : synchronisation impossible : ${error.message}`);
      setDiscordStatus({ status: 'sync_failed', error: String(error.message).slice(0, 300) });
    }
  });
  client.on('error', (error) => {
    log(logger, 'warn', `Discord : erreur client : ${error.message}`);
    setDiscordStatus({ status: 'error', error: String(error.message).slice(0, 300) });
  });
  client.on('interactionCreate', (interaction) => {
    handleCommand(interaction, { site, fetchImpl }).catch((error) => log(logger, 'warn', `Discord : interaction : ${error.message}`));
  });
  try {
    await client.login(token);
  } catch (error) {
    log(logger, 'warn', `Discord : connexion refusée : ${error.message}`);
    setDiscordStatus({ status: 'login_failed', error: String(error.message).slice(0, 300) });
    throw error;
  }
  setDiscordStatus({ status: 'online', guildId });
  return {
    client,
    ready,
    async destroy() {
      if (statusTimer) clearInterval(statusTimer);
      setDiscordStatus({ status: 'stopped' });
      try { await client.destroy(); } catch { /* ignore */ }
    },
  };
}
