import { APP_VERSION, PROVIDER_DEFAULT_BASE_URL } from './config.js';
import {
  deleteSetting,
  getSetting,
  setSetting,
} from './db.js';
import { hashPassword, verifyPassword, generateAdminPassword } from './auth.js';
import { decryptSecret, encryptSecret, isEncryptedSecret } from './secrets.js';

/* ------------------------------ provider ------------------------------- */

/**
 * Resolution de la configuration du fournisseur DeepSeek.
 * Priorite : variables d'environnement > panneau (SQLite) > valeur par defaut.
 * La cle stockee au panneau est chiffree (AES-256-GCM) et dechiffree ici.
 * La cle originale n'est JAMAIS renvoyee par l'API admin.
 */
export function resolveProviderConfig(db, config) {
  const stored = getSetting(db, 'provider', {}) || {};
  let storedKey = stored.apiKey || '';
  if (storedKey && isEncryptedSecret(storedKey)) {
    try {
      storedKey = decryptSecret(storedKey, config);
    } catch {
      storedKey = '';
    }
  }
  const apiKey = config.providerApiKey || storedKey || '';
  const baseUrl = (config.providerBaseUrl || stored.baseUrl || PROVIDER_DEFAULT_BASE_URL).replace(/\/+$/, '');
  let source = null;
  if (config.providerApiKey) source = 'env';
  else if (stored.apiKey) source = 'panel';
  let baseUrlSource = 'default';
  if (config.providerBaseUrl) baseUrlSource = 'env';
  else if (stored.baseUrl) baseUrlSource = 'panel';
  return { apiKey, baseUrl, source, baseUrlSource };
}

/** Ne revele que les 4 derniers caracteres d'une cle. */
export function maskApiKey(apiKey) {
  if (!apiKey) return '';
  const tail = apiKey.slice(-4);
  if (apiKey.length <= 8) return `••••${tail}`;
  return `••••••••${tail}`;
}

/**
 * Enregistre un champ fournisseur. La cle API est chiffree avant stockage ;
 * le fichier de cle maitre (data/master.key) est cree au besoin.
 */
export function saveProviderField(db, field, value, config) {
  const stored = getSetting(db, 'provider', {}) || {};
  const next = { ...stored };
  if (value == null || value === '') {
    delete next[field];
  } else if (field === 'apiKey' && config) {
    next[field] = encryptSecret(value, config);
  } else {
    next[field] = value;
  }
  if (Object.keys(next).length === 0) deleteSetting(db, 'provider');
  else setSetting(db, 'provider', next);
}

/** Migration : chiffre une cle eventuellement stockee en clair par une version anterieure. */
export function migrateProviderSecret(db, config, log = null) {
  const stored = getSetting(db, 'provider', {}) || {};
  if (stored.apiKey && !isEncryptedSecret(stored.apiKey)) {
    setSetting(db, 'provider', { ...stored, apiKey: encryptSecret(String(stored.apiKey), config) });
    if (log) log.info('Cle API fournisseur migree en stockage chiffre (AES-256-GCM).');
    return true;
  }
  return false;
}

/* ---------------------------- global budget ---------------------------- */

/** Budget mensuel global en USD (0 = desactive). */
export function getGlobalBudgetUsd(db) {
  const value = Number(getSetting(db, 'global_budget_usd', 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function saveGlobalBudgetUsd(db, value) {
  if (value == null || value === '' || Number(value) <= 0) deleteSetting(db, 'global_budget_usd');
  else setSetting(db, 'global_budget_usd', Math.round(Number(value) * 1e6) / 1e6);
}

/** Etat du budget global pour le mois UTC en cours. */
export function globalBudgetStatus(db, now = new Date()) {
  const limitUsd = getGlobalBudgetUsd(db);
  if (!limitUsd) return { limitUsd: 0, spentUsd: 0, exceeded: false, periodStart: null, remainingUsd: null };
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const row = db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM usage_logs WHERE created_at >= ?')
    .get(periodStart.toISOString());
  const spentUsd = Math.round(Number(row.cost) * 1e6) / 1e6;
  return {
    limitUsd,
    spentUsd,
    exceeded: spentUsd >= limitUsd,
    periodStart: periodStart.toISOString(),
    remainingUsd: Math.max(0, Math.round((limitUsd - spentUsd) * 1e6) / 1e6),
  };
}

/* -------------------------------- admin -------------------------------- */

/**
 * Initialise le mot de passe admin au premier demarrage.
 * - ADMIN_PASSWORD (env) s'il est fourni ;
 * - sinon mot de passe aleatoire genere, ecrit dans data/admin-password.txt.
 */
export function bootstrapAdmin(db, config) {
  const existing = getSetting(db, 'admin_password_hash', '');
  if (existing) {
    return { bootstrapped: false, generatedPassword: null };
  }
  const fromEnv = Boolean(config.adminPassword);
  const password = fromEnv ? config.adminPassword : generateAdminPassword();
  setSetting(db, 'admin_password_hash', hashPassword(password));
  setSetting(db, 'admin_password_source', fromEnv ? 'env' : 'generated');
  setSetting(db, 'admin_password_initialized_at', new Date().toISOString());
  return { bootstrapped: true, generatedPassword: fromEnv ? null : password };
}

export function getAdminPasswordSource(db) {
  return getSetting(db, 'admin_password_source', 'generated');
}

export function checkAdminPassword(db, password) {
  const stored = getSetting(db, 'admin_password_hash', '');
  if (!stored) return false;
  return verifyPassword(String(password ?? ''), stored);
}

export function changeAdminPassword(db, newPassword) {
  setSetting(db, 'admin_password_hash', hashPassword(newPassword));
  setSetting(db, 'admin_password_source', 'panel');
}

/* ------------------------------- defaults ------------------------------ */

export const STARTED_AT = new Date().toISOString();

export function serverInfo(config) {
  return {
    version: APP_VERSION,
    node: process.version,
    startedAt: STARTED_AT,
    dataDir: config.dataDir,
    host: config.host,
    port: config.port,
  };
}
