import fs from 'node:fs';
import path from 'node:path';

export const APP_ROOT = path.resolve(import.meta.dirname, '..');
export const APP_VERSION = '1.2.0';
export const PANEL_COOKIE = 'dsk_admin';
export const PROVIDER_DEFAULT_BASE_URL = 'https://api.deepseek.com';

/** Parse un fichier .env minimaliste (sans dependance). */
function parseEnvFile(filePath) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, '\n');
    out[key] = value;
  }
  return out;
}

function intOr(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function boolOr(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function stripTrailingSlash(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

/** Resout un chemin de fichier relatif par rapport a la racine du projet. */
function resolveFilePath(value) {
  if (value == null) return '';
  const file = String(value).trim();
  if (!file) return '';
  return path.isAbsolute(file) ? file : path.resolve(APP_ROOT, file);
}

export const DEFAULT_HTTPS_PORT = 8788;

/**
 * Taille maximale du corps d'une requete entrante.
 * Claude Code (contexte long, images, futures fenetres 1M tokens) depasse
 * facilement 4 Mo : on autorise 32 Mo par defaut.
 */
export const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;

/**
 * Convertit une valeur MAX_BODY_BYTES en octets.
 * - absent / invalide  -> valeur par defaut
 * - 0 ou negatif       -> illimite (attention a la memoire)
 */
export function byteLimit(value, fallback = DEFAULT_MAX_BODY_BYTES) {
  if (value == null || String(value).trim() === '') return fallback;
  const n = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return Number.POSITIVE_INFINITY;
  return n;
}

/**
 * Charge la configuration.
 * Les `overrides` sont surtout utilises par les tests (port, dataDir, upstream...).
 * Les variables d'environnement priment sur le fichier .env.
 */
export function loadConfig(overrides = {}) {
  const fileEnv = parseEnvFile(path.join(APP_ROOT, '.env'));
  const env = { ...fileEnv, ...process.env };

  /**
   * Une variable d'environnement vide (ex. `DATA_DIR=` dans .env) est traitee
   * comme absente. Sans cela, `DATA_DIR=` ferait ecrire la base SQLite dans le
   * repertoire courant au lieu de ./data.
   */
  const raw = (name) => {
    const value = env[name];
    if (value == null) return undefined;
    const trimmed = String(value).trim();
    return trimmed === '' ? undefined : trimmed;
  };

  const dataDir = path.resolve(overrides.dataDir ?? raw('DATA_DIR') ?? path.join(APP_ROOT, 'data'));
  const config = {
    appRoot: APP_ROOT,
    publicDir: path.join(APP_ROOT, 'public'),
    dataDir,
    host: overrides.host ?? raw('HOST') ?? '127.0.0.1',
    port: overrides.port ?? intOr(raw('PORT'), 8787),
    // Cle originale : prioritaire via variable d'environnement (jamais exposee par l'API admin).
    providerApiKey: overrides.providerApiKey ?? raw('DEEPSEEK_API_KEY') ?? '',
    // Chaine vide = non definie par l'environnement (le panneau peut alors la configurer).
    providerBaseUrl: stripTrailingSlash(overrides.providerBaseUrl ?? raw('DEEPSEEK_BASE_URL') ?? ''),
    publicBaseUrl: stripTrailingSlash(overrides.publicBaseUrl ?? raw('PUBLIC_BASE_URL') ?? ''),
    adminPassword: overrides.adminPassword ?? raw('ADMIN_PASSWORD') ?? '',
    sessionHours: intOr(raw('SESSION_HOURS'), 12),
    maxBodyBytes: overrides.maxBodyBytes ?? byteLimit(raw('MAX_BODY_BYTES'), DEFAULT_MAX_BODY_BYTES),
    upstreamTimeoutMs: intOr(raw('UPSTREAM_TIMEOUT_MS'), 30 * 60 * 1000),
    logLevel: raw('LOG_LEVEL') ?? 'info',
    trustProxy: overrides.trustProxy ?? boolOr(raw('TRUST_PROXY'), false),
    // HTTPS optionnel : utile pour les clients qui refusent http:// (Claude Desktop…).
    httpsPort: overrides.httpsPort ?? intOr(raw('HTTPS_PORT'), DEFAULT_HTTPS_PORT),
    tlsCertFile: resolveFilePath(overrides.tlsCertFile ?? raw('TLS_CERT_FILE')),
    tlsKeyFile: resolveFilePath(overrides.tlsKeyFile ?? raw('TLS_KEY_FILE')),
    tlsPfxFile: resolveFilePath(overrides.tlsPfxFile ?? raw('TLS_PFX_FILE')),
    tlsPfxPassphrase: overrides.tlsPfxPassphrase ?? raw('TLS_PFX_PASSPHRASE') ?? '',
  };

  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error(`PORT invalide : ${config.port}`);
  }
  if (!Number.isInteger(config.httpsPort) || config.httpsPort < 0 || config.httpsPort > 65535) {
    throw new Error(`HTTPS_PORT invalide : ${config.httpsPort}`);
  }
  const hasPem = Boolean(config.tlsCertFile) || Boolean(config.tlsKeyFile);
  if (hasPem && (!config.tlsCertFile || !config.tlsKeyFile)) {
    throw new Error('TLS_CERT_FILE et TLS_KEY_FILE doivent etre definis ensemble (ou utilisez TLS_PFX_FILE).');
  }
  if (config.tlsPfxFile && hasPem) {
    throw new Error('Choisissez soit TLS_PFX_FILE, soit TLS_CERT_FILE + TLS_KEY_FILE (pas les deux).');
  }
  if (config.sessionHours < 1 || config.sessionHours > 24 * 30) {
    config.sessionHours = 12;
  }
  return config;
}
