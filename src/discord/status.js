/**
 * État runtime du bot Discord, exposé par /healthz sans aucun secret.
 * Il permet de distinguer : config absente, connexion refusée, erreur de guilde,
 * bot connecté et salons synchronisés.
 */
const state = {
  status: 'disabled',
  error: null,
  guild: null,
  guildId: null,
  readyAt: null,
  lastSyncAt: null,
};

export function setDiscordStatus(patch = {}) {
  for (const [key, value] of Object.entries(patch)) {
    if (key in state) state[key] = value;
  }
  return getDiscordStatus();
}

export function getDiscordStatus() {
  return { ...state };
}
