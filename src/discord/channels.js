/**
 * Discord structure for VALARIA Gateway.
 *
 * Discord does not expose a real font for channel names, so the names use
 * Unicode mathematical-bold glyphs. All public channel content is in English.
 */

export const DISCORD_CATEGORY_NAME = '｜💠｜𝐕𝐀𝐋𝐀𝐑𝐈𝐀 𝐆𝐀𝐓𝐄𝐖𝐀𝐘';
export const DISCORD_CATEGORY_LEGACY_NAME = 'VALARIA GATEWAY';
export const DISCORD_CATEGORY_PREVIOUS_NAMES = Object.freeze([
  '「💠」VALARIA GATEWAY',
  '｜💠｜VALARIA GATEWAY',
]);

export const DISCORD_CHANNEL_TEMPLATES = Object.freeze([
  {
    key: 'welcome',
    name: '｜💠｜𝐖𝐄𝐋𝐂𝐎𝐌𝐄',
    legacyName: 'bienvenue',
    previousNames: ['「💠」bienvenue', '｜💠｜bienvenue', '｜💠｜𝐛𝐢𝐞𝐧𝐯𝐞𝐧𝐮𝐞', 'welcome'],
    topic: '[VALARIA] Welcome to VALARIA Gateway — API and VALARIA Code.',
    readOnly: false,
  },
  {
    key: 'announcements',
    name: '｜📢｜𝐀𝐍𝐍𝐎𝐔𝐍𝐂𝐄𝐌𝐄𝐍𝐓𝐒',
    legacyName: 'annonces',
    previousNames: ['「📢」annonces', '｜📢｜annonces', '｜📢｜𝐚𝐧𝐧𝐨𝐧𝐜𝐞𝐬', 'announcements'],
    topic: '[VALARIA] Official VALARIA Gateway announcements.',
    readOnly: true,
  },
  {
    key: 'status',
    name: '｜📡｜𝐒𝐓𝐀𝐓𝐔𝐒',
    legacyName: 'statut',
    previousNames: ['「📡」statut', '｜📡｜statut', '｜📡｜𝐬𝐭𝐚𝐭𝐮𝐭', 'status'],
    topic: '[VALARIA] VALARIA Gateway and VALARIA Code service status.',
    readOnly: true,
  },
  {
    key: 'general',
    name: '｜💬｜𝐆𝐄𝐍𝐄𝐑𝐀𝐋',
    legacyName: 'général',
    previousNames: ['「💬」général', '｜💬｜général', '｜💬｜𝐠𝐞𝐧𝐞𝐫𝐚𝐥', 'general'],
    topic: '[VALARIA] General discussion about the API and the CLI.',
    readOnly: false,
  },
  {
    key: 'support',
    name: '｜🛟｜𝐒𝐔𝐏𝐏𝐎𝐑𝐓',
    legacyName: 'support',
    previousNames: ['「🛟」support', '｜🛟｜support', '｜🛟｜𝐬𝐮𝐩𝐩𝐨𝐫𝐭'],
    topic: '[VALARIA] Help, questions and feedback about VALARIA Gateway.',
    readOnly: false,
  },
  {
    key: 'api',
    name: '｜🔌｜𝐀𝐏𝐈',
    legacyName: 'api',
    previousNames: ['「🔌」api', '｜🔌｜api', '｜🔌｜𝐚𝐩𝐢'],
    topic: '[VALARIA] OpenAI / Anthropic integration — endpoints and derived keys.',
    readOnly: false,
  },
  {
    key: 'valaria-code',
    name: '｜⌨️｜𝐕𝐀𝐋𝐀𝐑𝐈𝐀-𝐂𝐎𝐃𝐄',
    legacyName: 'valaria-code',
    previousNames: ['「⌨️」valaria-code', '｜⌨️｜valaria-code', '｜⌨️｜𝐯𝐚𝐥𝐚𝐫𝐢𝐚-𝐜𝐨𝐝𝐞'],
    topic: '[VALARIA] The VALARIA Code CLI: install, modes and permanent diff.',
    readOnly: false,
  },
  {
    key: 'reports',
    name: '｜🚨｜𝐑𝐄𝐏𝐎𝐑𝐓𝐒',
    legacyName: 'signalements',
    previousNames: ['「🚨」signalements', '｜🚨｜signalements', '｜🚨｜𝐬𝐢𝐠𝐧𝐚𝐥𝐞𝐦𝐞𝐧𝐭𝐬', 'reports'],
    topic: '[VALARIA] Report incidents, abuse or billing errors.',
    readOnly: false,
  },
]);

export function channelNames() {
  return DISCORD_CHANNEL_TEMPLATES.map((template) => template.name);
}

export function templateByKey(key) {
  return DISCORD_CHANNEL_TEMPLATES.find((template) => template.key === key) || null;
}

export function channelMatches(template, name) {
  if (!template || !name) return false;
  return name === template.name
    || name === template.legacyName
    || (template.previousNames ?? []).includes(name);
}

export function categoryMatches(name) {
  return Boolean(name) && (
    name === DISCORD_CATEGORY_NAME
    || name === DISCORD_CATEGORY_LEGACY_NAME
    || DISCORD_CATEGORY_PREVIOUS_NAMES.includes(name)
  );
}
