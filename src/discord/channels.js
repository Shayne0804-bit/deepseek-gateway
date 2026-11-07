/**
 * Structure Discord de VALARIA Gateway.
 * Ces templates sont la source de vérité pour la synchronisation des salons.
 */

export const DISCORD_CATEGORY_NAME = 'VALARIA GATEWAY';

export const DISCORD_CHANNEL_TEMPLATES = Object.freeze([
  {
    key: 'welcome',
    name: 'bienvenue',
    topic: 'Bienvenue sur VALARIA Gateway — API et VALARIA Code.',
    readOnly: false,
  },
  {
    key: 'announcements',
    name: 'annonces',
    topic: 'Annonces officielles VALARIA Gateway.',
    readOnly: true,
  },
  {
    key: 'status',
    name: 'statut',
    topic: 'État de la passerelle et du service VALARIA Code.',
    readOnly: true,
  },
  {
    key: 'support',
    name: 'support',
    topic: 'Entraide, questions et retours sur VALARIA Gateway.',
    readOnly: false,
  },
  {
    key: 'api',
    name: 'api',
    topic: 'Intégration OpenAI / Anthropic — endpoints et clés dérivées.',
    readOnly: false,
  },
  {
    key: 'valaria-code',
    name: 'valaria-code',
    topic: 'Le CLI de code VALARIA : installation, modes et diff.',
    readOnly: false,
  },
  {
    key: 'reports',
    name: 'signalements',
    topic: 'Signaler un problème, un abus ou une erreur de facturation.',
    readOnly: false,
  },
]);

export function channelNames() {
  return DISCORD_CHANNEL_TEMPLATES.map((template) => template.name);
}

export function templateByKey(key) {
  return DISCORD_CHANNEL_TEMPLATES.find((template) => template.key === key) || null;
}
