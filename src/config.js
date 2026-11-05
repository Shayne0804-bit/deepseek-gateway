import fs from 'node:fs';
import path from 'node:path';

export const APP_ROOT = path.resolve(import.meta.dirname, '..');
export const APP_VERSION = '2.7.2';
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
  // Fichier de configuration : override explicite, sinon ENV_FILE (CLI npm),
  // sinon le .env du depot (developpement). Les variables d'environnement priment.
  const envFile = overrides.envFile
    ? path.resolve(overrides.envFile)
    : process.env.ENV_FILE
      ? path.resolve(process.env.ENV_FILE)
      : path.join(APP_ROOT, '.env');
  const fileEnv = parseEnvFile(envFile);
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
    // Modele reellement appele chez le fournisseur. Par defaut TOUT est servi par
    // deepseek-flash, meme si le client demande deepseek-v4-pro ou un alias Claude.
    // Mettre BILLED_MODEL=none pour desactiver ce forcage.
    billedModel: overrides.billedModel ?? raw('BILLED_MODEL') ?? 'deepseek-flash',
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
    // Garde-fous et observabilite production.
    ipRateLimitPerMin: overrides.ipRateLimitPerMin ?? intOr(raw('IP_RATE_LIMIT_PER_MIN'), 240),
    maxConcurrentRequests: overrides.maxConcurrentRequests ?? intOr(raw('MAX_CONCURRENT_REQUESTS'), 200),
    logFormat: (overrides.logFormat ?? raw('LOG_FORMAT') ?? 'text') === 'json' ? 'json' : 'text',
    usageRetentionDays: overrides.usageRetentionDays ?? intOr(raw('USAGE_RETENTION_DAYS'), 0),
    masterKey: overrides.masterKey ?? raw('MASTER_KEY') ?? '',
    // Connexion portail par code recu par email (OTP).
    mailTransport: overrides.mailTransport ?? raw('MAIL_TRANSPORT') ?? '',
    mailFrom: overrides.mailFrom ?? raw('MAIL_FROM') ?? '',
    mailFromName: overrides.mailFromName ?? raw('MAIL_FROM_NAME') ?? 'VALARIA Gateway API',
    smtpUrl: overrides.smtpUrl ?? raw('SMTP_URL') ?? '',
    resendApiKey: overrides.resendApiKey ?? raw('RESEND_API_KEY') ?? '',
    resendApiBase: stripTrailingSlash(overrides.resendApiBase ?? raw('RESEND_API_BASE') ?? 'https://api.resend.com'),
    otpExpiresMinutes: intOr(raw('OTP_EXPIRES_MINUTES'), 10),
    otpCooldownSeconds: overrides.otpCooldownSeconds ?? intOr(raw('OTP_COOLDOWN_SECONDS'), 60),
    // Inscription autonome par email + pass d'essai cree automatiquement.
    signupEnabled: overrides.signupEnabled ?? boolOr(raw('SIGNUP_ENABLED'), true),
    trialDays: overrides.trialDays ?? intOr(raw('TRIAL_DAYS'), 7),
    trialQuotaUsd: overrides.trialQuotaUsd ?? Number(raw('TRIAL_QUOTA_USD') ?? 1),
    trialQuotaRequests: overrides.trialQuotaRequests ?? intOr(raw('TRIAL_QUOTA_REQUESTS'), 200),
    trialRpmLimit: overrides.trialRpmLimit ?? intOr(raw('TRIAL_RPM_LIMIT'), 20),
    trialConcurrencyLimit: overrides.trialConcurrencyLimit ?? intOr(raw('TRIAL_CONCURRENCY_LIMIT'), 2),
    trialMaxOutputTokens: overrides.trialMaxOutputTokens ?? intOr(raw('TRIAL_MAX_OUTPUT_TOKENS'), 4096),
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
  if (!Number.isFinite(config.ipRateLimitPerMin) || config.ipRateLimitPerMin < 0) config.ipRateLimitPerMin = 0;
  if (!Number.isFinite(config.maxConcurrentRequests) || config.maxConcurrentRequests < 0) config.maxConcurrentRequests = 0;
  if (!Number.isFinite(config.usageRetentionDays) || config.usageRetentionDays < 0) config.usageRetentionDays = 0;
  if (config.sessionHours < 1 || config.sessionHours > 24 * 30) {
    config.sessionHours = 12;
  }
  if (!Number.isFinite(config.otpExpiresMinutes) || config.otpExpiresMinutes < 5 || config.otpExpiresMinutes > 30) {
    config.otpExpiresMinutes = 10;
  }
  if (!Number.isFinite(config.otpCooldownSeconds) || config.otpCooldownSeconds < 0 || config.otpCooldownSeconds > 600) {
    config.otpCooldownSeconds = 60;
  }
  // BILLED_MODEL=none / off : desactive le forcage (comportement historique).
  if (['none', 'off', '0', 'false'].includes(String(config.billedModel ?? '').trim().toLowerCase())) {
    config.billedModel = '';
  }
  // Transport email effectif : explicite, sinon detecte par configuration.
  // Sans rien : desactive (la connexion par cle API reste le mode par defaut).
  if (!config.mailTransport) {
    if (config.smtpUrl) config.mailTransport = 'smtp';
    else if (config.resendApiKey) config.mailTransport = 'resend';
    else config.mailTransport = 'disabled';
  }
  if (!['console', 'smtp', 'resend', 'disabled'].includes(config.mailTransport)) {
    config.mailTransport = 'disabled';
  }
  config.emailLoginEnabled = ['console', 'smtp', 'resend'].includes(config.mailTransport)
    && (config.mailTransport !== 'smtp' || Boolean(config.smtpUrl))
    && (config.mailTransport !== 'resend' || Boolean(config.resendApiKey))
    && (config.mailTransport === 'console' || Boolean(config.mailFrom));
  // Valeurs d'essai coherentes (un pass d'essai ne doit jamais etre infini par accident).
  if (!Number.isFinite(config.trialDays) || config.trialDays < 1 || config.trialDays > 90) config.trialDays = 7;
  if (!Number.isFinite(config.trialQuotaUsd) || config.trialQuotaUsd < 0) config.trialQuotaUsd = 1;
  if (!Number.isFinite(config.trialQuotaRequests) || config.trialQuotaRequests < 0) config.trialQuotaRequests = 200;
  if (!Number.isFinite(config.trialRpmLimit) || config.trialRpmLimit < 1) config.trialRpmLimit = 20;
  if (!Number.isFinite(config.trialConcurrencyLimit) || config.trialConcurrencyLimit < 1) config.trialConcurrencyLimit = 2;
  if (!Number.isFinite(config.trialMaxOutputTokens) || config.trialMaxOutputTokens < 1) config.trialMaxOutputTokens = 4096;
  // L'activation effective (transport email present) est verifiee dans l'API portail.
  config.signupEnabled = Boolean(config.signupEnabled);
  return config;
}


