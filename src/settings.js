import { APP_VERSION, PROVIDER_DEFAULT_BASE_URL } from './config.js';
import {
  deleteSetting,
  getSetting,
  setSetting,
} from './db.js';
import { hashPassword, verifyPassword, generateAdminPassword } from './auth.js';

/* ------------------------------ provider ------------------------------- */

/**
 * Resolution de la configuration du fournisseur DeepSeek.
 * Priorite : variables d'environnement > panneau (SQLite) > valeur par defaut.
 * La cle originale n'est JAMAIS renvoyee par l'API admin.
 */
export function resolveProviderConfig(db, config) {
  const stored = getSetting(db, 'provider', {}) || {};
  const apiKey = config.providerApiKey || stored.apiKey || '';
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

export function saveProviderField(db, field, value) {
  const stored = getSetting(db, 'provider', {}) || {};
  const next = { ...stored };
  if (value == null || value === '') delete next[field];
  else next[field] = value;
  if (Object.keys(next).length === 0) deleteSetting(db, 'provider');
  else setSetting(db, 'provider', next);
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
