/**
 * Structure Discord de VALARIA Gateway.
 *
 * Discord n'expose pas de police réelle pour les noms de salons : les noms
 * utilisent donc les caractères Unicode « mathematical bold » (par exemple
 * 𝐑𝐞𝐟𝐞𝐫𝐫𝐚𝐥). Les anciens noms restent reconnus pour renommer sans doublon.
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
    name: '｜💠｜𝐛𝐢𝐞𝐧𝐯𝐞𝐧𝐮𝐞',
    legacyName: 'bienvenue',
    previousNames: ['「💠」bienvenue', '｜💠｜bienvenue'],
    topic: '[VALARIA] Bienvenue sur VALARIA Gateway — API et VALARIA Code.',
    readOnly: false,
  },
  {
    key: 'announcements',
    name: '｜📢｜𝐚𝐧𝐧𝐨𝐧𝐜𝐞𝐬',
    legacyName: 'annonces',
    previousNames: ['「📢」annonces', '｜📢｜annonces'],
    topic: '[VALARIA] Annonces officielles VALARIA Gateway.',
    readOnly: true,
  },
  {
    key: 'status',
    name: '｜📡｜𝐬𝐭𝐚𝐭𝐮𝐭',
    legacyName: 'statut',
    previousNames: ['「📡」statut', '｜📡｜statut'],
    topic: '[VALARIA] État de la passerelle et du service VALARIA Code.',
    readOnly: true,
  },
  {
    key: 'general',
    name: '｜💬｜𝐠𝐞𝐧𝐞𝐫𝐚𝐥',
    legacyName: 'général',
    previousNames: ['「💬」général', '｜💬｜général'],
    topic: '[VALARIA] Discussion générale autour de l’API et du CLI.',
    readOnly: false,
  },
  {
    key: 'support',
    name: '｜🛟｜𝐬𝐮𝐩𝐩𝐨𝐫𝐭',
    legacyName: 'support',
    previousNames: ['「🛟」support', '｜🛟｜support'],
    topic: '[VALARIA] Entraide, questions et retours sur VALARIA Gateway.',
    readOnly: false,
  },
  {
    key: 'api',
    name: '｜🔌｜𝐚𝐩𝐢',
    legacyName: 'api',
    previousNames: ['「🔌」api', '｜🔌｜api'],
    topic: '[VALARIA] Intégration OpenAI / Anthropic — endpoints et clés dérivées.',
    readOnly: false,
  },
  {
    key: 'valaria-code',
    name: '｜⌨️｜𝐯𝐚𝐥𝐚𝐫𝐢𝐚-𝐜𝐨𝐝𝐞',
    legacyName: 'valaria-code',
    previousNames: ['「⌨️」valaria-code', '｜⌨️｜valaria-code'],
    topic: '[VALARIA] Le CLI de code VALARIA : installation, modes et diff.',
    readOnly: false,
  },
  {
    key: 'reports',
    name: '｜🚨｜𝐬𝐢𝐠𝐧𝐚𝐥𝐞𝐦𝐞𝐧𝐭𝐬',
    legacyName: 'signalements',
    previousNames: ['「🚨」signalements', '｜🚨｜signalements'],
    topic: '[VALARIA] Signaler un problème, un abus ou une erreur de facturation.',
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
