import fs from 'node:fs';
import path from 'node:path';

export const APP_ROOT = path.resolve(import.meta.dirname, '..');
export const APP_VERSION = '3.10.0';
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
    // sqlite (defaut) ou mongo.
    dbDriver: String(overrides.dbDriver ?? raw('DB_DRIVER') ?? 'sqlite').trim().toLowerCase(),
    mongoUri: overrides.mongoUri ?? raw('MONGODB_URI') ?? '',
    mongoDb: overrides.mongoDb ?? raw('MONGODB_DB') ?? 'valaria_gateway',
    mongoMigrateSqlite: overrides.mongoMigrateSqlite ?? boolOr(raw('MONGODB_MIGRATE_SQLITE'), true),
    mongoSqliteFile: overrides.mongoSqliteFile ?? raw('MONGODB_SQLITE_FILE') ?? '',
    mongoMigrationRequired: overrides.mongoMigrationRequired ?? boolOr(raw('MONGODB_MIGRATION_REQUIRED'), false),
    host: overrides.host ?? raw('HOST') ?? '127.0.0.1',
    port: overrides.port ?? intOr(raw('PORT'), 8787),
    // Cle originale : prioritaire via variable d'environnement (jamais exposee par l'API admin).
    providerApiKey: overrides.providerApiKey ?? raw('DEEPSEEK_API_KEY') ?? '',
    // Modele reellement appele chez le fournisseur. Par defaut TOUT est servi par
    // deepseek-flash, meme si le client demande deepseek-v4-pro ou un alias Claude.
    // Mettre BILLED_MODEL=none pour desactiver ce forcage.
    saspayApiKey: overrides.saspayApiKey ?? raw('SASPAY_API_KEY') ?? '',
    saspayWebhookSecret: overrides.saspayWebhookSecret ?? raw('SASPAY_WEBHOOK_SECRET') ?? '',
    saspayBaseUrl: stripTrailingSlash(overrides.saspayBaseUrl ?? raw('SASPAY_BASE_URL') ?? 'https://api.saspay.me/api/v1'),
    billedModel: overrides.billedModel ?? raw('BILLED_MODEL') ?? 'deepseek-flash',
    // Les alias premium consomment le credit au tarif v4-pro, meme si le modele
    // reellement appele reste flash. Desactivable via ALIAS_PREMIUM_BILLING=0.
    aliasPremiumBilling: overrides.aliasPremiumBilling ?? boolOr(raw('ALIAS_PREMIUM_BILLING'), true),
    // Chaine vide = non definie par l'environnement (le panneau peut alors la configurer).
    providerBaseUrl: stripTrailingSlash(overrides.providerBaseUrl ?? raw('DEEPSEEK_BASE_URL') ?? ''),
    publicBaseUrl: stripTrailingSlash(overrides.publicBaseUrl ?? raw('PUBLIC_BASE_URL') ?? ''),
    adminPassword: overrides.adminPassword ?? raw('ADMIN_PASSWORD') ?? '',
    adminTotpSecret: overrides.adminTotpSecret ?? raw('ADMIN_TOTP_SECRET') ?? '',
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
    // Bot Discord optionnel, démarré avec le serveur.
    discordEnabled: boolOr(raw('DISCORD_ENABLED'), true),
    discordToken: raw('DISCORD_TOKEN') ?? '',
    discordGuildId: raw('DISCORD_GUILD_ID') ?? '',
    discordCategoryName: raw('DISCORD_CATEGORY_NAME') ?? '',
    discordSyncChannels: boolOr(raw('DISCORD_SYNC_CHANNELS'), true),
    discordSiteUrl: raw('DISCORD_SITE_URL') ?? '',
    // Connexion portail par code recu par email (OTP).
    mailTransport: overrides.mailTransport ?? raw('MAIL_TRANSPORT') ?? '',
    mailFrom: overrides.mailFrom ?? raw('MAIL_FROM') ?? '',
    mailTimeoutMs: overrides.mailTimeoutMs ?? intOr(raw('MAIL_TIMEOUT_MS'), 15000),
    mailFromName: overrides.mailFromName ?? raw('MAIL_FROM_NAME') ?? 'VALARIA Gateway API',
    smtpUrl: overrides.smtpUrl ?? raw('SMTP_URL') ?? '',
    resendApiKey: overrides.resendApiKey ?? raw('RESEND_API_KEY') ?? '',
    resendApiBase: stripTrailingSlash(overrides.resendApiBase ?? raw('RESEND_API_BASE') ?? 'https://api.resend.com'),
    exchangeRatesUrl: overrides.exchangeRatesUrl ?? raw('EXCHANGE_RATES_URL') ?? 'https://open.er-api.com/v6/latest/EUR',
    otpExpiresMinutes: intOr(raw('OTP_EXPIRES_MINUTES'), 10),
    otpCooldownSeconds: overrides.otpCooldownSeconds ?? intOr(raw('OTP_COOLDOWN_SECONDS'), 30),
    otpMaxPerEmail: overrides.otpMaxPerEmail ?? intOr(raw('OTP_MAX_PER_EMAIL'), 0),
    otpMaxPerIp: overrides.otpMaxPerIp ?? intOr(raw('OTP_MAX_PER_IP'), 10),
    // Inscription autonome par email + pass d'essai cree automatiquement.
    signupEnabled: overrides.signupEnabled ?? boolOr(raw('SIGNUP_ENABLED'), true),
    trialDays: overrides.trialDays ?? intOr(raw('TRIAL_DAYS'), 7),
    // Credit site du pass gratuit. L'ancienne variable TRIAL_QUOTA_USD etait
    // exprimee en cout reel : on la convertit une fois via SITE_CREDIT_RATE.
    trialQuotaUsd: overrides.trialQuotaUsd
      ?? Number(raw('TRIAL_CREDIT_SITE_USD') ?? raw('TRIAL_QUOTA_USD') ?? 1.125),
    trialQuotaLegacy: overrides.trialQuotaUsd === undefined
      && raw('TRIAL_CREDIT_SITE_USD') === undefined
      && raw('TRIAL_QUOTA_USD') !== undefined,
    trialQuotaRequests: overrides.trialQuotaRequests ?? 0,
    trialRpmLimit: overrides.trialRpmLimit ?? intOr(raw('TRIAL_RPM_LIMIT'), 20),
    trialConcurrencyLimit: overrides.trialConcurrencyLimit ?? intOr(raw('TRIAL_CONCURRENCY_LIMIT'), 2),
    trialMaxOutputTokens: overrides.trialMaxOutputTokens ?? intOr(raw('TRIAL_MAX_OUTPUT_TOKENS'), 4096),
    // Credit site : le client est debite du cout reel x SITE_CREDIT_RATE.
    siteCreditRate: overrides.siteCreditRate ?? Number(raw('SITE_CREDIT_RATE') ?? 3.75),
    siteCreditWindowHours: overrides.siteCreditWindowHours ?? intOr(raw('SITE_CREDIT_WINDOW_HOURS'), 5),
    // Anti-abus inscription : 1 compte par IP / appareil sur une fenetre.
    signupMaxPerIp: overrides.signupMaxPerIp ?? intOr(raw('SIGNUP_MAX_PER_IP'), 1),
    signupIpWindowDays: overrides.signupIpWindowDays ?? intOr(raw('SIGNUP_IP_WINDOW_DAYS'), 30),
    signupMaxPerDevice: overrides.signupMaxPerDevice ?? intOr(raw('SIGNUP_MAX_PER_DEVICE'), 1),
    signupDeviceWindowDays: overrides.signupDeviceWindowDays ?? intOr(raw('SIGNUP_DEVICE_WINDOW_DAYS'), 30),
    blockTempMail: overrides.blockTempMail ?? boolOr(raw('BLOCK_TEMP_MAIL'), true),
    blockedEmailDomains: overrides.blockedEmailDomains
      ?? String(raw('BLOCKED_EMAIL_DOMAINS') ?? '')
        .split(',').map((entry) => entry.trim()).filter(Boolean),
    // Verification anti-bot Cloudflare Turnstile (recommande, gratuit).
    turnstileSiteKey: overrides.turnstileSiteKey ?? raw('TURNSTILE_SITE_KEY') ?? '',
    turnstileSecretKey: overrides.turnstileSecretKey ?? raw('TURNSTILE_SECRET_KEY') ?? '',
    turnstileVerifyUrl: overrides.turnstileVerifyUrl
      ?? raw('TURNSTILE_VERIFY_URL')
      ?? 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    turnstileRequired: overrides.turnstileRequired ?? boolOr(raw('TURNSTILE_REQUIRED'), true),
    turnstileTimeoutMs: overrides.turnstileTimeoutMs ?? intOr(raw('TURNSTILE_TIMEOUT_MS'), 5000),
    // Captcha : turnstile (passif) ou hcaptcha (checkbox visible).
    captchaProvider: String(overrides.captchaProvider ?? raw('CAPTCHA_PROVIDER') ?? 'turnstile').trim().toLowerCase(),
    captchaRequired: overrides.captchaRequired
      ?? (raw('CAPTCHA_REQUIRED') !== undefined
        ? boolOr(raw('CAPTCHA_REQUIRED'), true)
        : (raw('TURNSTILE_REQUIRED') !== undefined ? boolOr(raw('TURNSTILE_REQUIRED'), true) : true)),
    hcaptchaSiteKey: overrides.hcaptchaSiteKey ?? raw('HCAPTCHA_SITE_KEY') ?? '',
    hcaptchaSecretKey: overrides.hcaptchaSecretKey ?? raw('HCAPTCHA_SECRET_KEY') ?? '',
    hcaptchaVerifyUrl: overrides.hcaptchaVerifyUrl
      ?? raw('HCAPTCHA_VERIFY_URL')
      ?? 'https://api.hcaptcha.com/siteverify',
    captchaTimeoutMs: overrides.captchaTimeoutMs ?? intOr(raw('CAPTCHA_TIMEOUT_MS'), 5000),
    // Intelligence IP + email (IPQualityScore) pour VPN et emails jetables.
    ipqsApiKey: overrides.ipqsApiKey ?? raw('IPQS_API_KEY') ?? '',
    ipqsApiBase: stripTrailingSlash(overrides.ipqsApiBase ?? raw('IPQS_API_BASE') ?? 'https://ipqualityscore.com/api/json'),
    ipqsMinFraudScore: overrides.ipqsMinFraudScore ?? intOr(raw('IPQS_MIN_FRAUD_SCORE'), 85),
    ipqsBlockVpn: overrides.ipqsBlockVpn ?? boolOr(raw('IPQS_BLOCK_VPN'), true),
    ipqsBlockHosting: overrides.ipqsBlockHosting ?? boolOr(raw('IPQS_BLOCK_HOSTING'), true),
    fraudCheckEnabled: overrides.fraudCheckEnabled ?? boolOr(raw('FRAUD_CHECK_ENABLED'), true),
    emailValidationEnabled: overrides.emailValidationEnabled ?? boolOr(raw('EMAIL_VALIDATION_ENABLED'), false),
    fraudFailClosed: overrides.fraudFailClosed ?? boolOr(raw('FRAUD_FAIL_CLOSED'), true),
    fraudTimeoutMs: overrides.fraudTimeoutMs ?? intOr(raw('FRAUD_TIMEOUT_MS'), 5000),
    trustCloudflare: overrides.trustCloudflare ?? boolOr(raw('TRUST_CLOUDFLARE'), false),
    ipIntelEnabled: overrides.ipIntelEnabled ?? boolOr(raw('IP_INTEL_ENABLED'), false),
    ipIntelUrl: overrides.ipIntelUrl
      ?? raw('IP_INTEL_URL')
      ?? 'http://ip-api.com/json/{ip}?fields=status,proxy,hosting,mobile,country,isp',
    ipIntelTimeoutMs: overrides.ipIntelTimeoutMs ?? intOr(raw('IP_INTEL_TIMEOUT_MS'), 2500),
    ipIntelFailClosed: overrides.ipIntelFailClosed ?? boolOr(raw('IP_INTEL_FAIL_CLOSED'), false),
    blockVpn: overrides.blockVpn ?? boolOr(raw('BLOCK_VPN'), true),
  };

  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error(`PORT invalide : ${config.port}`);
  }
  if (!['sqlite', 'mongo'].includes(config.dbDriver)) {
    throw new Error(`DB_DRIVER invalide : ${config.dbDriver} (sqlite ou mongo).`);
  }
  if (config.dbDriver === 'mongo' && !config.mongoUri) {
    throw new Error('DB_DRIVER=mongo mais MONGODB_URI est vide.');
  }
  config.mongoMigrateSqlite = Boolean(config.mongoMigrateSqlite);
  config.mongoMigrationRequired = Boolean(config.mongoMigrationRequired);
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
    config.otpCooldownSeconds = 30;
  }
  if (!Number.isFinite(config.otpMaxPerEmail) || config.otpMaxPerEmail < 0 || config.otpMaxPerEmail > 50) {
    config.otpMaxPerEmail = 0;
  }
  if (!Number.isFinite(config.otpMaxPerIp) || config.otpMaxPerIp < 1 || config.otpMaxPerIp > 50) {
    config.otpMaxPerIp = 10;
  }
  for (const key of ['signupMaxPerIp', 'signupMaxPerDevice']) {
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 10) config[key] = 1;
  }
  for (const key of ['signupIpWindowDays', 'signupDeviceWindowDays']) {
    if (!Number.isFinite(config[key]) || config[key] < 1 || config[key] > 365) config[key] = 30;
  }
  if (!Number.isFinite(config.ipIntelTimeoutMs) || config.ipIntelTimeoutMs < 500 || config.ipIntelTimeoutMs > 10_000) {
    config.ipIntelTimeoutMs = 2500;
  }
  config.blockTempMail = Boolean(config.blockTempMail);
  config.ipIntelEnabled = Boolean(config.ipIntelEnabled);
  config.ipIntelFailClosed = Boolean(config.ipIntelFailClosed);
  config.blockVpn = Boolean(config.blockVpn);
  config.trustCloudflare = Boolean(config.trustCloudflare);
  if (!Number.isFinite(config.ipqsMinFraudScore) || config.ipqsMinFraudScore < 0 || config.ipqsMinFraudScore > 100) {
    config.ipqsMinFraudScore = 85;
  }
  if (!Number.isFinite(config.turnstileTimeoutMs) || config.turnstileTimeoutMs < 500 || config.turnstileTimeoutMs > 15_000) {
    config.turnstileTimeoutMs = 5000;
  }
  if (!Number.isFinite(config.fraudTimeoutMs) || config.fraudTimeoutMs < 500 || config.fraudTimeoutMs > 15_000) {
    config.fraudTimeoutMs = 5000;
  }
  config.turnstileConfigured = Boolean(config.turnstileSiteKey && config.turnstileSecretKey);
  if (!['turnstile', 'hcaptcha', 'none'].includes(config.captchaProvider)) {
    config.captchaProvider = 'turnstile';
  }
  if (config.captchaProvider === 'turnstile') {
    config.captchaConfigured = config.turnstileConfigured;
    config.captchaSiteKey = config.turnstileSiteKey;
  } else if (config.captchaProvider === 'hcaptcha') {
    config.captchaConfigured = Boolean(config.hcaptchaSiteKey && config.hcaptchaSecretKey);
    config.captchaSiteKey = config.hcaptchaSiteKey;
  } else {
    config.captchaConfigured = false;
    config.captchaSiteKey = '';
  }
  // Compatibilite : le reste du code utilise encore turnstileRequired comme
  // « captcha obligatoire » quel que soit le fournisseur.
  config.turnstileRequired = Boolean(config.captchaRequired) && config.captchaConfigured;
  if (!Number.isFinite(config.captchaTimeoutMs) || config.captchaTimeoutMs < 500 || config.captchaTimeoutMs > 15_000) {
    config.captchaTimeoutMs = 5000;
  }
  config.fraudCheckEnabled = Boolean(config.fraudCheckEnabled) && Boolean(config.ipqsApiKey);
  config.ipqsBlockVpn = Boolean(config.ipqsBlockVpn);
  config.ipqsBlockHosting = Boolean(config.ipqsBlockHosting);
  config.emailValidationEnabled = Boolean(config.emailValidationEnabled) && config.fraudCheckEnabled;
  config.fraudFailClosed = Boolean(config.fraudFailClosed);
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
  if (!Number.isFinite(config.trialQuotaUsd) || config.trialQuotaUsd < 0) config.trialQuotaUsd = 1.125;
  // Le pass d'essai n'a plus de quota de requetes : seul le credit site l'arrete.
  config.trialQuotaRequests = null;
  if (!Number.isFinite(config.trialRpmLimit) || config.trialRpmLimit < 1) config.trialRpmLimit = 20;
  if (!Number.isFinite(config.trialConcurrencyLimit) || config.trialConcurrencyLimit < 1) config.trialConcurrencyLimit = 2;
  if (!Number.isFinite(config.trialMaxOutputTokens) || config.trialMaxOutputTokens < 1) config.trialMaxOutputTokens = 4096;
  if (!Number.isFinite(config.siteCreditRate) || config.siteCreditRate <= 0 || config.siteCreditRate > 50) {
    config.siteCreditRate = 3.75;
  }
  if (config.trialQuotaLegacy) {
    config.trialQuotaUsd = Math.round(config.trialQuotaUsd * config.siteCreditRate * 1e6) / 1e6;
  }
  if (!Number.isFinite(config.siteCreditWindowHours) || config.siteCreditWindowHours < 1 || config.siteCreditWindowHours > 24) {
    config.siteCreditWindowHours = 5;
  }
  // L'activation effective (transport email present) est verifiee dans l'API portail.
  config.signupEnabled = Boolean(config.signupEnabled);
  return config;
}









































































