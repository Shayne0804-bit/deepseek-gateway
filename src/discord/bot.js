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
import { DISCORD_CATEGORY_NAME, DISCORD_CHANNEL_TEMPLATES } from './channels.js';

const COMMANDS = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('État de la passerelle VALARIA Gateway'),
  new SlashCommandBuilder()
    .setName('aide')
    .setDescription('Liens et commandes utiles de VALARIA'),
  new SlashCommandBuilder()
    .setName('api')
    .setDescription('URL et intégration de l’API VALARIA'),
  new SlashCommandBuilder()
    .setName('valaria-code')
    .setDescription('Installer et lancer VALARIA Code dans le terminal'),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Vérifier que le bot répond'),
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

function introEmbed(key, site, categoryName) {
  const embed = new EmbedBuilder().setFooter({ text: 'VALARIA Gateway' }).setTimestamp();
  if (key === 'welcome') {
    embed
      .setColor(0x2ba26a)
      .setTitle('Bienvenue sur VALARIA Gateway')
      .setDescription(`Une seule clé fournisseur côté serveur, des accès individuels et un agent de code dans le terminal.\n\n[Ouvrir le site](${site}) · [Mon espace](${site}/portal)`)
      .addFields(
        { name: 'API', value: `OpenAI et Anthropic compatibles\n\`${site}/v1\``, inline: true },
        { name: 'VALARIA Code', value: '`npm install -g valaria-code`\npuis `valaria login`', inline: true },
        { name: 'Commencer', value: `[Créer un compte](${site}/signup)`, inline: false },
      );
  } else if (key === 'api') {
    embed
      .setColor(0x2ba26a)
      .setTitle('API VALARIA Gateway')
      .setDescription(
        `URL de base OpenAI : \`${site}/v1\`\nURL Anthropic : \`${site}/anthropic\`\n\n` +
        'Créez votre clé dans **Mon espace → Mes clés API**. La clé est personnelle et révocable.',
      )
      .addFields({ name: 'Guide', value: `[Guide d’intégration](${site}/portal)`, inline: false });
  } else if (key === 'valaria-code') {
    embed
      .setColor(0x2ba26a)
      .setTitle('VALARIA Code')
      .setDescription('L’agent de code dans votre terminal, connecté par appareil sans clé API collée.')
      .addFields(
        { name: 'Installer', value: '```bash\nnpm install -g valaria-code\nvalaria login\nvalaria\n```', inline: false },
        { name: 'Contrôle', value: '`/diff` pour la revue permanente · `Ctrl+G` pour changer de mode d’approbation', inline: false },
        { name: 'Guide', value: `[Guide CLI](${site}/portal)`, inline: false },
      );
  } else if (key === 'support') {
    embed
      .setColor(0x2ba26a)
      .setTitle('Support VALARIA')
      .setDescription(`Posez votre question ici. Pour un problème de compte, précisez votre email et la date concernée.\n\n[Mon espace](${site}/portal)`)
      .addFields({ name: 'À ne jamais partager', value: 'Votre clé API complète ou un jeton d’appareil `vlt_…`.', inline: false });
  } else if (key === 'annonces') {
    embed
      .setColor(0x2ba26a)
      .setTitle('Annonces VALARIA')
      .setDescription(`Les nouveautés du site, de l’API et de VALARIA Code sont publiées ici.\n\n[Site](${site})`);
  } else if (key === 'statut') {
    embed
      .setColor(0x2ba26a)
      .setTitle('Statut VALARIA Gateway')
      .setDescription(`Panneau de statut mis à jour automatiquement.\n\n[Site](${site}) · [Mon espace](${site}/portal)`);
  } else {
    embed
      .setColor(0x2ba26a)
      .setTitle(`VALARIA · ${categoryName}`)
      .setDescription(`[Ouvrir le site](${site})`);
  }
  return embed;
}

async function statusEmbed(site, fetchImpl) {
  try {
    const response = await fetchImpl(`${site}/healthz`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return new EmbedBuilder()
      .setColor(0x2ba26a)
      .setTitle('VALARIA Gateway est en ligne')
      .addFields(
        { name: 'Version', value: `\`${data.version || '—'}\``, inline: true },
        { name: 'Base de données', value: `\`${data.database || '—'}\``, inline: true },
        { name: 'Passerelle', value: data.providerConfigured ? 'configurée' : 'non configurée', inline: true },
      )
      .setFooter({ text: 'Statut VALARIA' })
      .setTimestamp();
  } catch (error) {
    return new EmbedBuilder()
      .setColor(0xf06b5d)
      .setTitle('VALARIA Gateway indisponible')
      .setDescription(`La vérification du site a échoué : \`${String(error.message).slice(0, 200)}\``)
      .setFooter({ text: 'Statut VALARIA' })
      .setTimestamp();
  }
}

async function ensureStatusPanel(channel, client, site, fetchImpl) {
  if (!channel) return;
  const embed = await statusEmbed(site, fetchImpl);
  try {
    const messages = await channel.messages.fetch({ limit: 20 });
    const current = messages.find((message) => message.author.id === client.user.id && message.embeds[0]?.footer?.text === 'Statut VALARIA');
    if (current) await current.edit({ embeds: [embed] });
    else await channel.send({ embeds: [embed] });
  } catch (error) {
    log(console, 'warn', `Statut Discord non publié : ${error.message}`);
  }
}

async function ensureChannels(guild, client, { site, categoryName, fetchImpl, logger }) {
  const channels = await guild.channels.fetch();
  let category = channels.find((channel) => channel?.type === ChannelType.GuildCategory && channel.name === categoryName);
  if (!category) {
    category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory, reason: 'Déploiement VALARIA Gateway' });
    log(logger, 'info', `Discord : catégorie créée « ${categoryName} »`);
  }
  const created = [];
  for (const template of DISCORD_CHANNEL_TEMPLATES) {
    let channel = channels.find((item) => item?.type === ChannelType.GuildText && item.name === template.name);
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
      channel = await guild.channels.create({
        name: template.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: template.topic,
        permissionOverwrites: overwrites,
        reason: 'Salon VALARIA Gateway',
      });
      created.push(channel);
      log(logger, 'info', `Discord : salon créé #${template.name}`);
    } else {
      if (channel.parentId !== category.id) await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
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
    if (created.includes(channel)) {
      try {
        await channel.send({ embeds: [introEmbed(template.key, site, categoryName)] });
      } catch (error) {
        log(logger, 'warn', `Discord : message d’accueil non envoyé dans #${template.name} : ${error.message}`);
      }
    }
    if (template.key === 'statut') await ensureStatusPanel(channel, client, site, fetchImpl);
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
        .setTitle('API VALARIA Gateway')
        .setDescription(`\`${site}/v1\` · OpenAI compatible\n\`${site}/anthropic\` · Anthropic Messages`)
        .addFields({ name: 'Guide', value: `[Ouvrir le guide](${site}/portal)`, inline: false });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (name === 'valaria-code') {
      const embed = new EmbedBuilder()
        .setColor(0x2ba26a)
        .setTitle('VALARIA Code')
        .setDescription('```bash\nnpm install -g valaria-code\nvalaria login\nvalaria\n```')
        .addFields(
          { name: 'Terminal', value: 'Diff permanent, conversation, approbations.', inline: false },
          { name: 'Guide', value: `[Espace VALARIA](${site}/portal)`, inline: false },
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (name === 'aide') {
      const embed = new EmbedBuilder()
        .setColor(0x2ba26a)
        .setTitle('Aide VALARIA')
        .setDescription('Commandes du bot et liens utiles.')
        .addFields(
          { name: 'Commandes', value: '`/status` · `/api` · `/valaria-code` · `/aide` · `/ping`', inline: false },
          { name: 'Site', value: `[Accueil](${site}) · [Mon espace](${site}/portal) · [Créer un compte](${site}/signup)`, inline: false },
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (error) {
    log(console, 'warn', `Discord : commande ${name} en erreur : ${error.message}`);
    if (!interaction.replied) {
      await interaction.reply({ content: 'La commande a échoué. Réessayez plus tard.', ephemeral: true }).catch(() => {});
    }
  }
}

export async function startDiscordBot({ env = process.env, logger = console, fetchImpl = fetch } = {}) {
  const token = String(env.DISCORD_TOKEN || '').trim();
  const guildId = String(env.DISCORD_GUILD_ID || '').trim();
  if (!token || !guildId) {
    log(logger, 'debug', 'Discord : DISCORD_TOKEN ou DISCORD_GUILD_ID absent, bot désactivé.');
    return null;
  }
  if (!enabled(env.DISCORD_ENABLED, true)) return null;
  const site = siteUrl(env);
  const categoryName = String(env.DISCORD_CATEGORY_NAME || DISCORD_CATEGORY_NAME).trim() || DISCORD_CATEGORY_NAME;
  const syncChannels = enabled(env.DISCORD_SYNC_CHANNELS, true);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let statusTimer = null;
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  client.once('ready', async () => {
    log(logger, 'info', `Discord : connecté en tant que ${client.user.tag}`);
    client.user.setPresence({ status: 'online', activities: [{ name: 'VALARIA Gateway', type: 3 }] });
    readyResolve();
    try {
      const guild = await client.guilds.fetch(guildId);
      if (syncChannels) await ensureChannels(guild, client, { site, categoryName, fetchImpl, logger });
      await registerCommands(guild, logger);
      const statusChannel = guild.channels.cache.find((channel) => channel?.type === ChannelType.GuildText && channel.name === 'statut');
      if (statusChannel) {
        statusTimer = setInterval(() => ensureStatusPanel(statusChannel, client, site, fetchImpl), 5 * 60_000);
        statusTimer.unref?.();
      }
    } catch (error) {
      log(logger, 'warn', `Discord : synchronisation impossible : ${error.message}`);
    }
  });
  client.on('error', (error) => log(logger, 'warn', `Discord : erreur client : ${error.message}`));
  client.on('interactionCreate', (interaction) => {
    handleCommand(interaction, { site, fetchImpl }).catch((error) => log(logger, 'warn', `Discord : interaction : ${error.message}`));
  });
  await client.login(token);
  return {
    client,
    ready,
    async destroy() {
      if (statusTimer) clearInterval(statusTimer);
      try { await client.destroy(); } catch { /* ignore */ }
    },
  };
}
