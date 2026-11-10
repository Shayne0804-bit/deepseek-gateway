/**
 * Portail utilisateur (espace du porteur de cle derivee).
 *
 * Authentification par cle derivee (sk-dsk-...), session dediee (cookie
 * HttpOnly dsk_portal), acces limite aux donnees du client proprietaire.
 * Aucune route admin n'est accessible avec une session portail.
 */
import crypto from 'node:crypto';
import { APP_VERSION } from './config.js';
import {
  cleanupPortalEmailCodes,
  cleanupPortalSessions,
  cleanupSignupIdentities,
  clientUsageSeriesSince,
  countClientUsageSince,
  clientCreditWindowSince,
  countSignupIdentitiesByDevice,
  countSignupIdentitiesByIp,
  deletePortalEmailCode,
  deletePortalEmailCodes,
  deletePortalSession,
  findClientByEmail,
  getActivePortalEmailCode,
  getClientById,
  getPortalSession,
  getSetting,
  incrementPortalEmailCodeAttempts,
  insertClient,
  insertPortalEmailCode,
  insertPortalSession,
  insertSignupIdentity,
  listUsageLogs,
  recordAdminAudit,
  updateClientFields,
  cleanupDeviceCodes,
  approveDeviceCode,
  consumeDeviceCode,
  getDeviceCodeByDeviceHash,
  getDeviceCodeByUserCodeHash,
  insertDeviceCode,
  insertCliToken,
  listCliTokensByClient,
  revokeCliToken,
  insertPaymentOrder,
  getPaymentOrder,
  updatePaymentOrder,
  listPendingPaymentOrders,
  listClientPaymentOrders,
  claimPaymentOrder,
  resetClientUsage,
} from './db.js';
import {
  displayKeyPrefix,
  generateCliToken,
  generateDerivedKey,
  hashApiKey,
  sha256,
} from './auth.js';
import { getMasterKey } from './secrets.js';
import {
  checkClientAccess,
  findClientByApiKey,
  findClientByCliToken,
  maybeRollPeriod,
  periodKeyFor,
  remainingFor,
} from './quota.js';
import { loadPricing } from './pricing.js';
import { loadModelAliases, publicModelIds } from './model-aliases.js';
import { PASS_PLANS, getPassPlan, passPlanFields, publicPlan } from './plans.js';
import { currencyContext } from './currency.js';
import { deviceHashFor, isDisposableEmail } from './abuse.js';
import { createSaspayCheckout, getSaspayCheckoutStatus, verifySaspayWebhook } from './saspay.js';
import { lookupIpqsEmail, lookupIpqsIp, verifyHcaptcha, verifyTurnstile } from './fraud.js';
import {
  bearerToken,
  clientIp,
  HttpError,
  isHttpsRequest,
  originAllowed,
  parseCookies,
  readBody,
  readJsonBody,
  sendApiError,
  sendJson,
  serializeCookie,
} from './http-utils.js';

const PORTAL_COOKIE = 'dsk_portal';
const PORTAL_CSRF_HEADER = 'x-requested-with';
const PORTAL_CSRF_VALUE = 'dsk-portal';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_CODE_ATTEMPTS = 5;
const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
const CLI_TOKEN_TTL_MS = 90 * 24 * 3600 * 1000;
const DEVICE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateUserCode() {
  let raw = '';
  for (let index = 0; index < 8; index += 1) {
    raw += DEVICE_CODE_ALPHABET[crypto.randomInt(0, DEVICE_CODE_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function normalizeUserCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function utcStartOfToday(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function fillSeries(rows, days = 30, now = new Date()) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const series = [];
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(day);
    series.push({
      day,
      requests: row?.requests ?? 0,
      tokens: row?.tokens ?? 0,
      cost: row?.cost ?? 0,
    });
  }
  return series;
}

async function availableModelIds(db) {
  const pricingValue = await getSetting(db, 'pricing', null);
  const aliasesValue = await getSetting(db, 'model_aliases', null);
  const pricing = loadPricing(() => pricingValue);
  const aliases = loadModelAliases(() => aliasesValue);
  const ids = new Set(Object.keys(pricing.models ?? {}));
  for (const pattern of Object.keys(aliases ?? {})) {
    ids.add(pattern.endsWith('*') ? pattern.slice(0, -1) : pattern);
  }
  return publicModelIds([...ids]);
}

function requestOrigin(req, config) {
  if (config.publicBaseUrl) return config.publicBaseUrl.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .split(',')[0]
    .trim();
  const proto = isHttpsRequest(req, config.trustProxy) ? 'https' : 'http';
  return `${proto}://${host}`;
}

function quotaView(client) {
  const remaining = remainingFor(client);
  return {
    tokens: { limit: client.quotaTokens, used: client.usedTokens, remaining: remaining.tokens },
    requests: { limit: client.quotaRequests, used: client.usedRequests, remaining: remaining.requests },
    usd: { limit: client.quotaUsd, used: Math.round(client.usedUsd * 1e6) / 1e6, remaining: remaining.usd },
  };
}

export function createPortalApi({ config, db, log, mailer = null }) {
  const loginAttempts = new Map();
  const deviceStartAttempts = new Map();
  const deviceTokenAttempts = new Map();
  const emailRequestAttempts = new Map();
  const emailVerifyAttempts = new Map();
  const emailLastSend = new Map();
  const emailSendWindow = new Map();
  const fraudIpCache = new Map();
  const fraudEmailCache = new Map();
  const FRAUD_CACHE_MS = 10 * 60 * 1000;

  async function fraudIp(ip) {
    const cached = fraudIpCache.get(ip);
    if (cached && Date.now() - cached.at < FRAUD_CACHE_MS) return cached.value;
    const value = await lookupIpqsIp(ip, config);
    fraudIpCache.set(ip, { at: Date.now(), value });
    return value;
  }

  async function fraudEmail(email) {
    const cached = fraudEmailCache.get(email);
    if (cached && Date.now() - cached.at < FRAUD_CACHE_MS) return cached.value;
    const value = await lookupIpqsEmail(email, config);
    fraudEmailCache.set(email, { at: Date.now(), value });
    return value;
  }

  function portalError(res, status, message, code = null) {
    sendApiError(res, status, message, status === 429 ? 'rate_limit_error' : 'invalid_request_error', code);
  }

  function audit(req, action, target = null) {
    recordAdminAudit(db, { ip: clientIp(req, config.trustProxy, config.trustCloudflare), action, target })
      .catch((err) => log.error(`Audit portail impossible : ${err.message}`));
  }

  function normalizeEmail(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  /** Nom d'utilisateur choisi a l'inscription (fallback email pour les anciens flux). */
  function normalizeUsername(value) {
    if (value == null || String(value).trim() === '') return null;
    const username = String(value).trim().replace(/\s+/g, ' ');
    if (username.length < 2 || username.length > 40) {
      throw new HttpError(400, "Le nom d'utilisateur doit contenir entre 2 et 40 caractères.", 'invalid_username');
    }
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(username)) {
      throw new HttpError(400, "Le nom d'utilisateur contient des caractères non autorisés.", 'invalid_username');
    }
    return username;
  }

  function otpHash(email, code) {
    return crypto
      .createHmac('sha256', getMasterKey(config))
      .update(`${email}:${code}`)
      .digest('hex');
  }

  function safeEqualHex(a, b) {
    const left = Buffer.from(String(a), 'utf8');
    const right = Buffer.from(String(b), 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  function hitWindow(map, key, limit, windowMs) {
    const now = Date.now();
    const entry = map.get(key);
    if (!entry || now - entry.first > windowMs) {
      map.set(key, { first: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  function requireCsrf(req, res) {
    if (String(req.headers[PORTAL_CSRF_HEADER] ?? '') !== PORTAL_CSRF_VALUE) {
      portalError(res, 403, 'Requête refusée.', 'csrf');
      return false;
    }
    if (!originAllowed(req)) {
      portalError(res, 403, 'Origine non autorisée.', 'csrf_origin');
      return false;
    }
    return true;
  }

  async function createSession(req, res, client, method = 'api_key') {
    await cleanupPortalSessions(db, new Date().toISOString());
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    await insertPortalSession(db, sha256(token), client.id, now.toISOString(), expiresAt);
    setPortalCookie(req, res, token, Math.floor(SESSION_TTL_MS / 1000));
    loginAttempts.delete(clientIp(req, config.trustProxy, config.trustCloudflare));
    const loginAction = method === 'signup' ? 'portal.signup' : method === 'email' ? 'portal.login.email' : 'portal.login';
    audit(req, loginAction, client.name);
    log.info(`[${req.requestId ?? '-'}] Connexion portail (${method}) : ${client.name}`);
    sendJson(res, 200, {
      ok: true,
      method,
      client: { name: client.name, email: client.email ?? null, keyPrefix: client.keyPrefix, hasKey: hasKeyFor(client) },
      expiresAt,
    });
  }

  /** Un compte peut exister sans cle API active (inscription autonome). */
  function hasKeyFor(client) {
    return Boolean(client?.keyPrefix && String(client.keyPrefix).startsWith('sk-dsk-'));
  }

  /** IP reelle derriere Cloudflare si TRUST_CLOUDFLARE=1, sinon proxy standard. */
  function requestIp(req) {
    const cloudflareIp = String(req.headers['cf-connecting-ip'] ?? '').trim();
    if (config.trustCloudflare && cloudflareIp) return cloudflareIp;
    return clientIp(req, config.trustProxy, config.trustCloudflare);
  }

  /** Verification captcha (Turnstile ou hCaptcha), fail-closed si erreur. */
  async function assertTurnstile(req, token) {
    if (!config.turnstileRequired) return;
    try {
      const ip = requestIp(req);
      const result = config.captchaProvider === 'hcaptcha'
        ? await verifyHcaptcha(token, ip, config)
        : await verifyTurnstile(token, ip, config);
      if (!result.ok) {
        audit(req, 'portal.signup.blocked', 'captcha_failed');
        throw new HttpError(
          403,
          'Vérification anti-bot échouée. Rechargez la page, validez le captcha puis réessayez.',
          'captcha_failed',
        );
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      log.error(`[${req.requestId ?? '-'}] Verification captcha impossible : ${err.message}`);
      throw new HttpError(
        503,
        'La vérification anti-bot est momentanément indisponible. Réessayez dans quelques instants.',
        'captcha_unavailable',
      );
    }
  }

  /** Refus immediat d'une adresse temporaire / jetable. */
  function assertEmailNotDisposable(email) {
    if (config.blockTempMail && isDisposableEmail(email, config.blockedEmailDomains)) {
      throw new HttpError(
        400,
        'Adresse email temporaire (temp mail) invalide. Utilisez une adresse email personnelle.',
        'email_disposable',
      );
    }
  }

  /**
   * Anti-abus avant creation d'un compte : email jetable, 1 compte par IP et
   * par appareil sur la fenetre configuree, VPN/proxy optionnel.
   */
  async function enforceSignupPolicy(req, email, deviceId) {
    assertEmailNotDisposable(email);
    const ip = requestIp(req);
    const deviceHash = deviceHashFor(deviceId, req);
    const now = Date.now();
    await cleanupSignupIdentities(db, new Date(now - 365 * 86_400_000).toISOString());

    if (config.signupMaxPerIp > 0) {
      const since = new Date(now - config.signupIpWindowDays * 86_400_000).toISOString();
      const count = await countSignupIdentitiesByIp(db, ip, since);
      if (count >= config.signupMaxPerIp) {
        audit(req, 'portal.signup.blocked', 'signup_ip_limit');
        throw new HttpError(
          403,
          `Un compte a déjà été créé depuis cette connexion. Un seul compte est autorisé par IP sur ${config.signupIpWindowDays} jours. Connectez-vous ou contactez l’administrateur.`,
          'signup_ip_limit',
        );
      }
    }
    if (config.signupMaxPerDevice > 0) {
      const since = new Date(now - config.signupDeviceWindowDays * 86_400_000).toISOString();
      const count = await countSignupIdentitiesByDevice(db, deviceHash, since);
      if (count >= config.signupMaxPerDevice) {
        audit(req, 'portal.signup.blocked', 'signup_device_limit');
        throw new HttpError(
          403,
          `Un compte a déjà été créé depuis cet appareil. Un seul compte est autorisé par appareil sur ${config.signupDeviceWindowDays} jours.`,
          'signup_device_limit',
        );
      }
    }
    if (config.fraudCheckEnabled) {
      try {
        const ipReputation = await fraudIp(ip);
        if (ipReputation.blocked) {
          audit(req, 'portal.signup.blocked', 'vpn_detected');
          throw new HttpError(
            403,
            `Création de compte refusée depuis cette connexion (${ipReputation.reasons.join(', ')}). Désactivez VPN/proxy puis réessayez.`,
            'vpn_detected',
          );
        }
        if (config.emailValidationEnabled) {
          const emailReputation = await fraudEmail(email);
          if (emailReputation.blocked) {
            audit(req, 'portal.signup.blocked', 'email_rejected');
            throw new HttpError(
              400,
              `Adresse email refusée (${emailReputation.reasons.join(', ')}). Utilisez une adresse personnelle valide.`,
              'email_rejected',
            );
          }
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        log.error(`[${req.requestId ?? '-'}] Verification anti-fraude impossible : ${err.message}`);
        if (config.fraudFailClosed) {
          throw new HttpError(
            503,
            'La vérification anti-fraude est indisponible. Réessayez dans quelques instants.',
            'fraud_check_unavailable',
          );
        }
      }
    }
    return { ip, deviceHash };
  }

  /** Cree un compte d'essai (inscription autonome ou connexion email inconnue). */
  async function createTrialClient(email, identity = null, username = null) {
    const now = new Date();
    const trialExpiry = new Date(now.getTime() + config.trialDays * 86_400_000).toISOString();
    const localPart = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
    const client = {
      id: crypto.randomUUID(),
      name: (username || localPart || 'Nouveau compte').slice(0, 80),
      email,
      plan: 'essai',
      keyHash: sha256(`pending:${crypto.randomUUID()}`),
      keyPrefix: 'en attente',
      enabled: true,
      quotaTokens: null,
      quotaRequests: null,
      quotaUsd: config.trialQuotaUsd || null,
      usedTokens: 0,
      usedRequests: 0,
      usedUsd: 0,
      period: 'total',
      periodStart: periodKeyFor('total', now),
      rpmLimit: config.trialRpmLimit || null,
      concurrencyLimit: config.trialConcurrencyLimit || null,
      maxOutputTokens: config.trialMaxOutputTokens || null,
      allowedModels: null,
      expiresAt: trialExpiry,
      note: 'Inscription autonome — pass d’essai',
      createdAt: now.toISOString(),
    };
    await insertClient(db, client);
    if (identity) {
      await insertSignupIdentity(db, {
        ip: identity.ip,
        deviceHash: identity.deviceHash,
        email,
        createdAt: now.toISOString(),
      });
    }
    return client;
  }

  function emailCodeMessage() {
    return {
      ok: true,
      message: 'Si un compte existe pour cette adresse, un code de connexion vient d’être envoyé.',
      expiresMinutes: config.otpExpiresMinutes,
    };
  }

  /** Anti-spam : fenetre glissante simple, avec delai restant expose au client. */
  function windowState(map, key, limit, windowMs) {
    const now = Date.now();
    const entry = map.get(key);
    if (!entry || now - entry.first > windowMs) {
      map.set(key, { first: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0, count: 1, max: limit };
    }
    entry.count += 1;
    const allowed = entry.count <= limit;
    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((entry.first + windowMs - now) / 1000)),
      count: entry.count,
      max: limit,
    };
  }

  /** Etat d'envoi pour un email : cooldown + plafond optionnel (0 = illimite). */
  function emailSendState(email) {
    const now = Date.now();
    const last = emailLastSend.get(email) ?? 0;
    const entry = emailSendWindow.get(email);
    const active = entry && now - entry.first <= LOGIN_WINDOW_MS;
    const count = active ? entry.count : 0;
    const limited = config.otpMaxPerEmail > 0;
    const cooldownLeft = Math.max(0, Math.ceil((last + config.otpCooldownSeconds * 1000 - now) / 1000));
    const windowLeft = limited && count >= config.otpMaxPerEmail
      ? Math.max(1, Math.ceil((entry.first + LOGIN_WINDOW_MS - now) / 1000))
      : 0;
    return {
      allowed: cooldownLeft <= 0 && (!limited || count < config.otpMaxPerEmail),
      retryAfterSeconds: Math.max(cooldownLeft, windowLeft),
      count,
      max: limited ? config.otpMaxPerEmail : 0,
    };
  }

  function reserveEmailSend(email) {
    const state = emailSendState(email);
    if (!state.allowed) return { ok: false, ...state };
    const now = Date.now();
    emailLastSend.set(email, now);
    const entry = emailSendWindow.get(email);
    if (!entry || now - entry.first > LOGIN_WINDOW_MS) {
      emailSendWindow.set(email, { first: now, count: 1 });
    } else {
      entry.count += 1;
    }
    return {
      ok: true,
      retryAfterSeconds: config.otpCooldownSeconds,
      count: emailSendWindow.get(email).count,
      max: config.otpMaxPerEmail,
    };
  }

  function releaseEmailSend(email) {
    emailLastSend.delete(email);
    const entry = emailSendWindow.get(email);
    if (entry && entry.count > 0) entry.count -= 1;
  }

  function sendRateLimited(res, message, code, retryAfterSeconds, info = {}) {
    const retry = Math.max(1, Number(retryAfterSeconds) || 1);
    sendJson(
      res,
      429,
      {
        error: {
          message,
          type: 'rate_limit_error',
          code,
          param: null,
          retry_after_seconds: retry,
        },
        retry_after_seconds: retry,
        ...info,
      },
      { 'retry-after': String(retry), 'cache-control': 'no-store' },
    );
  }

  function loginRateLimited(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || now - entry.first > LOGIN_WINDOW_MS) {
      loginAttempts.set(ip, { first: now, count: 0 });
      return false;
    }
    return entry.count >= MAX_LOGIN_ATTEMPTS;
  }

  function recordLoginFailure(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || now - entry.first > LOGIN_WINDOW_MS) loginAttempts.set(ip, { first: now, count: 1 });
    else entry.count += 1;
  }

  async function sessionFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[PORTAL_COOKIE];
    if (!token) return null;
    const session = await getPortalSession(db, sha256(token));
    if (!session) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await deletePortalSession(db, sha256(token));
      return null;
    }
    const client = await getClientById(db, session.client_id);
    if (!client) {
      await deletePortalSession(db, sha256(token));
      return null;
    }
    return { token, session, client };
  }

  /**
   * Authentification directe par clé derivee (CLI npm, scripts) :
   * GET /portal/api/me et /logs acceptent `Authorization: Bearer sk-dsk-...`
   * ou `x-api-key`, sans session cookie ni échange de mot de passe.
   */
  async function clientFromAuthorization(req) {
    const token = bearerToken(req) || String(req.headers['x-api-key'] ?? '').trim();
    if (!token) return null;
    if (token.startsWith('vlt_')) return await findClientByCliToken(db, token);
    return await findClientByApiKey(db, token);
  }

  function setPortalCookie(req, res, token, maxAgeSeconds) {
    res.setHeader(
      'set-cookie',
      serializeCookie(PORTAL_COOKIE, token, {
        maxAge: maxAgeSeconds,
        path: '/',
        secure: isHttpsRequest(req, config.trustProxy),
      }),
    );
  }

  async function mePayload(req, client) {
    const now = new Date();
    const today = await countClientUsageSince(db, client.id, utcStartOfToday(now));
    const totals = await countClientUsageSince(db, client.id, '1970-01-01T00:00:00.000Z');
    const series = fillSeries(
      await clientUsageSeriesSince(db, client.id, new Date(now.getTime() - 29 * 86_400_000).toISOString()),
      30,
      now,
    );
    const access = checkClientAccess(client, now);
    const plan = getPassPlan(client.plan);
    const fiveLimit = plan?.credit5hLimit ?? null;
    const weekLimit = plan?.creditWeeklyLimit ?? (client.plan === 'essai' ? config.trialQuotaUsd : null);
    const since5h = new Date(now.getTime() - (config.siteCreditWindowHours || 5) * 3_600_000).toISOString();
    const since7d = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const credit5hUsed = fiveLimit != null ? (await clientCreditWindowSince(db, client.id, since5h)).total : 0;
    const creditWeekUsed = weekLimit != null ? (await clientCreditWindowSince(db, client.id, since7d)).total : 0;
    const origin = requestOrigin(req, config);
    return {
      client: {
        name: client.name,
        email: client.email ?? null,
        keyPrefix: client.keyPrefix,
        hasKey: hasKeyFor(client),
        period: client.period,
        periodStart: client.periodStart,
        expiresAt: client.expiresAt,
        createdAt: client.createdAt,
        enabled: client.enabled,
      },
      status: access ? access.code : 'ok',
      statusMessage: access ? access.message : null,
      quota: quotaView(client),
      usage: { today, totals, series },
      limits: {
        rpmLimit: client.rpmLimit,
        maxOutputTokens: client.maxOutputTokens,
        allowedModels: client.allowedModels
          ? client.allowedModels.filter((id) => id !== 'deepseek-flash')
          : null,
        credit5h: fiveLimit == null
          ? null
          : { used: credit5hUsed, limit: fiveLimit, remaining: Math.max(0, fiveLimit - credit5hUsed) },
        creditWeek: weekLimit == null
          ? null
          : { used: creditWeekUsed, limit: weekLimit, remaining: Math.max(0, weekLimit - creditWeekUsed) },
      },
      models: (await availableModelIds(db)).filter((id) => id !== 'deepseek-flash'),
      plan: (() => {
        if (client.plan === 'essai') {
          return {
            id: 'essai',
            name: 'Essai',
            tagline: 'Pass de découverte offert à l’inscription.',
            durationDays: config.trialDays,
            quotaRequests: null,
            quotaUsd: config.trialQuotaUsd,
            rpmLimit: config.trialRpmLimit,
            concurrencyLimit: config.trialConcurrencyLimit,
            maxOutputTokens: config.trialMaxOutputTokens,
            support: 'Communauté',
            features: [
              `${config.trialQuotaUsd} $ de crédit site`,
              `${config.trialQuotaUsd} $ max / semaine`,
              `${config.trialDays} jours`,
            ],
          };
        }
        const plan = getPassPlan(client.plan);
        return plan ? publicPlan(plan) : null;
      })(),
      plans: PASS_PLANS.map(publicPlan),
      baseUrl: `${origin}/v1`,
      anthropicBaseUrl: `${origin}/anthropic`,
      headers: [
        'x-quota-tokens-remaining',
        'x-quota-requests-remaining',
        'x-quota-usd-remaining',
        'x-quota-period',
      ],
      server: { version: APP_VERSION },
    };
  }

  const PAYABLE_CURRENCIES = new Set([
    'XOF', 'XAF', 'NGN', 'GHS', 'KES', 'TZS', 'UGX', 'RWF', 'ZMW', 'MWK', 'CDF', 'GNF',
  ]);
  const CURRENCY_COUNTRY = { XOF: 'BJ', XAF: 'CM', NGN: 'NG', GHS: 'GH', KES: 'KE', TZS: 'TZ', UGX: 'UG', RWF: 'RW', ZMW: 'ZM', MWK: 'MW', CDF: 'CD', GNF: 'GN' };

  function publicPaymentOrder(order) {
    if (!order) return null;
    return {
      id: order.id,
      plan: order.plan,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      checkoutUrl: order.status === 'pending' ? order.checkoutUrl : null,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
    };
  }

  async function applyPaidPaymentOrder(order, providerPaymentId) {
    if (!order || order.status !== 'pending') return order;
    const claimed = await claimPaymentOrder(db, order.id, {
      paidAt: new Date().toISOString(),
      providerPaymentId: providerPaymentId ?? null,
    });
    if (!claimed) return getPaymentOrder(db, order.id);
    try {
      const preset = passPlanFields(order.plan);
      if (!preset) throw new Error(`Pass inconnu : ${order.plan}`);
      await updateClientFields(db, order.clientId, preset);
      await resetClientUsage(db, order.clientId, periodKeyFor(preset.period));
      await updatePaymentOrder(db, order.id, {
        status: 'completed',
        creditedAt: new Date().toISOString(),
      });
      log.info(`[paiement] Pass ${order.plan} activé pour ${order.clientId} (${order.id}).`);
    } catch (err) {
      await updatePaymentOrder(db, order.id, { status: 'failed_credit' });
      log.error(`[paiement] Crédit impossible pour ${order.id} : ${err.message}`);
    }
    return getPaymentOrder(db, order.id);
  }

  async function reconcilePaymentOrder(order) {
    if (!order) return null;
    if (order.status !== 'pending' || !order.checkoutId) return order;
    try {
      const status = await getSaspayCheckoutStatus(config, order.checkoutId);
      const transactionStatus = String(status?.transaction_status ?? '').toUpperCase();
      const sessionStatus = String(status?.status ?? '').toUpperCase();
      if (transactionStatus === 'SUCCESS' || sessionStatus === 'PAID') {
        return applyPaidPaymentOrder(order, status?.transaction_id);
      }
      if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(transactionStatus)
        || ['FAILED', 'CANCELLED', 'EXPIRED'].includes(sessionStatus)) {
        await updatePaymentOrder(db, order.id, { status: 'failed' });
        return getPaymentOrder(db, order.id);
      }
    } catch (err) {
      log.warn(`[paiement] Vérification ${order.id} impossible : ${err.message}`);
    }
    return order;
  }

  async function reconcilePendingPaymentOrders(limit = 10) {
    const orders = await listPendingPaymentOrders(db, limit);
    for (const order of orders) {
      await reconcilePaymentOrder(order);
    }
  }

  async function handleSaspayWebhook(req, res) {
    const rawBody = await readBody(req, 256 * 1024);
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    if (!verifySaspayWebhook(rawBody, signature, timestamp, config.saspayWebhookSecret)) {
      log.warn('Webhook SasPay rejeté (signature ou horodatage invalide).');
      sendJson(res, 401, { ok: false });
      return;
    }
    let event = null;
    try { event = JSON.parse(rawBody); } catch { /* payload invalide */ }
    if (!event?.event) {
      sendJson(res, 400, { ok: false });
      return;
    }
    await reconcilePendingPaymentOrders(10);
    sendJson(res, 200, { ok: true });
  }

  async function handle(req, res, url, pathname) {
    const route = pathname.slice('/portal/api'.length) || '/';
    const method = req.method;

    try {
      if (route === '/login' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy, config.trustCloudflare);
        if (loginRateLimited(ip)) {
          audit(req, 'portal.login.rate_limited');
          portalError(res, 429, 'Trop de tentatives. Réessayez dans quelques minutes.', 'too_many_attempts');
          return;
        }
        if (String(req.headers[PORTAL_CSRF_HEADER] ?? '') !== PORTAL_CSRF_VALUE) {
          portalError(res, 403, 'Requête refusée.', 'csrf');
          return;
        }
        if (!originAllowed(req)) {
          portalError(res, 403, 'Origine non autorisée.', 'csrf_origin');
          return;
        }
        const body = await readJsonBody(req, 4 * 1024);
        const apiKey = String(body.key ?? '').trim();
        const client = await findClientByApiKey(db, apiKey);
        if (!client) {
          recordLoginFailure(ip);
          audit(req, 'portal.login.failed');
          portalError(res, 401, 'Clé API invalide. Vérifiez la clé fournie par l\'administrateur.', 'invalid_api_key');
          return;
        }
        await cleanupPortalSessions(db, new Date().toISOString());
        await createSession(req, res, client, 'api_key');
        return;
      }

      if (route === '/device/start' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy, config.trustCloudflare);
        const state = windowState(deviceStartAttempts, ip, 10, LOGIN_WINDOW_MS);
        if (!state.allowed) {
          audit(req, 'portal.device.start.rate_limited');
          sendRateLimited(
            res,
            `Trop de demandes de connexion d’appareil. Réessayez dans ${state.retryAfterSeconds} s.`,
            'too_many_requests',
            state.retryAfterSeconds,
            { max_requests: state.max },
          );
          return;
        }
        const body = await readJsonBody(req, 4 * 1024);
        const deviceName = String(body.deviceName ?? '').trim().slice(0, 60) || 'Appareil CLI';
        const now = new Date();
        await cleanupDeviceCodes(db, now.toISOString());
        const nowIso = now.toISOString();
        const expiresAt = new Date(now.getTime() + DEVICE_CODE_TTL_MS).toISOString();
        const deviceCode = `dvc_${crypto.randomBytes(24).toString('base64url')}`;
        const userCode = generateUserCode();
        await insertDeviceCode(db, {
          id: crypto.randomUUID(),
          deviceHash: sha256(deviceCode),
          userCodeHash: sha256(normalizeUserCode(userCode)),
          deviceName,
          createdAt: nowIso,
          expiresAt,
        });
        audit(req, 'portal.device.start', deviceName);
        const origin = requestOrigin(req, config);
        sendJson(res, 200, {
          device_code: deviceCode,
          user_code: userCode,
          verification_uri: `${origin}/device`,
          verification_uri_complete: `${origin}/device?code=${encodeURIComponent(userCode)}`,
          expires_in: Math.floor(DEVICE_CODE_TTL_MS / 1000),
          interval: 5,
        });
        return;
      }

      if (route === '/device/token' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy, config.trustCloudflare);
        const state = windowState(deviceTokenAttempts, ip, 300, LOGIN_WINDOW_MS);
        if (!state.allowed) {
          sendRateLimited(res, 'Trop de vérifications. Patientez.', 'too_many_requests', state.retryAfterSeconds);
          return;
        }
        const body = await readJsonBody(req, 4 * 1024);
        const deviceCode = String(body.device_code ?? '');
        if (!deviceCode) {
          portalError(res, 400, 'Code d’appareil manquant.', 'invalid_device_code');
          return;
        }
        const now = new Date();
        await cleanupDeviceCodes(db, now.toISOString());
        const row = await getDeviceCodeByDeviceHash(db, sha256(deviceCode));
        if (!row) {
          portalError(res, 400, 'Code d’appareil invalide ou expiré.', 'invalid_device_code');
          return;
        }
        if (row.status === 'pending') {
          sendJson(res, 202, { status: 'pending', interval: 5, expires_in: Math.max(0, Math.ceil((new Date(row.expires_at).getTime() - now.getTime()) / 1000)) });
          return;
        }
        if (row.status !== 'approved') {
          portalError(res, 409, 'Code d’appareil déjà utilisé.', 'device_code_used');
          return;
        }
        const approved = await consumeDeviceCode(db, sha256(deviceCode), now.toISOString());
        if (!approved) {
          portalError(res, 409, 'Code d’appareil déjà utilisé ou expiré.', 'device_code_used');
          return;
        }
        const token = generateCliToken();
        const tokenExpiresAt = new Date(now.getTime() + CLI_TOKEN_TTL_MS).toISOString();
        await insertCliToken(db, {
          id: crypto.randomUUID(),
          tokenHash: sha256(token),
          clientId: approved.client_id,
          name: approved.device_name || 'Appareil CLI',
          createdAt: now.toISOString(),
          expiresAt: tokenExpiresAt,
        });
        audit(req, 'portal.device.token', approved.device_name || 'Appareil CLI');
        sendJson(res, 200, {
          token,
          token_type: 'Bearer',
          expires_at: tokenExpiresAt,
          device_name: approved.device_name || 'Appareil CLI',
        });
        return;
      }

      if (route === '/device/approve' && method === 'POST') {
        const current = await sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Connectez-vous au portail pour approuver cet appareil.', 'unauthorized');
          return;
        }
        if (!requireCsrf(req, res)) return;
        const body = await readJsonBody(req, 4 * 1024);
        const normalized = normalizeUserCode(body.user_code);
        if (normalized.length !== 8) {
          portalError(res, 400, 'Code d’appareil invalide.', 'invalid_device_code');
          return;
        }
        const approved = await approveDeviceCode(db, sha256(normalized), current.client.id, new Date().toISOString());
        if (!approved) {
          portalError(res, 400, 'Code invalide, expiré ou déjà utilisé.', 'device_code_rejected');
          return;
        }
        audit(req, 'portal.device.approve', approved.device_name || 'Appareil CLI');
        sendJson(res, 200, { ok: true, device_name: approved.device_name || 'Appareil CLI' });
        return;
      }

      if (route === '/devices' && method === 'GET') {
        const current = await sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        const rows = await listCliTokensByClient(db, current.client.id);
        sendJson(res, 200, {
          devices: rows.map((row) => ({
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
            lastUsedAt: row.last_used_at,
            expiresAt: row.expires_at,
            revokedAt: row.revoked_at,
            active: !row.revoked_at && new Date(row.expires_at).getTime() > Date.now(),
          })),
        });
        return;
      }

      const deviceMatch = /^\/devices\/([0-9a-f-]{36})$/.exec(route);
      if (deviceMatch && method === 'DELETE') {
        const current = await sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        if (!requireCsrf(req, res)) return;
        const changed = await revokeCliToken(db, deviceMatch[1], current.client.id, new Date().toISOString());
        if (!changed) {
          portalError(res, 404, 'Appareil introuvable.', 'not_found');
          return;
        }
        audit(req, 'portal.device.revoke', deviceMatch[1]);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (route === '/currency' && method === 'GET') {
        const context = await currencyContext(req, {
          locale: url.searchParams.get('locale') || '',
          timezone: url.searchParams.get('tz') || '',
          config,
        });
        sendJson(res, 200, context);
        return;
      }

      if (route === '/config' && method === 'GET') {
        sendJson(res, 200, {
          emailLoginEnabled: Boolean(mailer?.enabled),
          paymentsEnabled: Boolean(config.saspayApiKey),
          signupEnabled: Boolean(config.signupEnabled) && Boolean(mailer?.enabled),
          captchaProvider: config.captchaProvider,
          captchaSiteKey: config.captchaSiteKey || null,
          captchaRequired: Boolean(config.turnstileRequired),
          turnstileSiteKey: config.turnstileSiteKey || null,
          turnstileRequired: Boolean(config.turnstileRequired),
          method: mailer?.enabled ? 'email' : null,
        });
        return;
      }

      if (route === '/email/request' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy, config.trustCloudflare);
        if (!mailer?.enabled) {
          portalError(res, 503, 'La connexion par email n’est pas configurée sur cette passerelle.', 'email_not_configured');
          return;
        }
        if (!requireCsrf(req, res)) return;
        const ipState = windowState(emailRequestAttempts, ip, config.otpMaxPerIp, LOGIN_WINDOW_MS);
        if (!ipState.allowed) {
          audit(req, 'portal.email.request.rate_limited');
          sendRateLimited(
            res,
            `Trop de demandes de code. Réessayez dans ${ipState.retryAfterSeconds} s.`,
            'too_many_requests',
            ipState.retryAfterSeconds,
            { max_requests: ipState.max },
          );
          return;
        }
        const body = await readJsonBody(req, 4 * 1024);
        const email = normalizeEmail(body.email);
        if (!EMAIL_RE.test(email) || email.length > 254) {
          portalError(res, 400, 'Adresse email invalide.', 'invalid_email');
          return;
        }
        assertEmailNotDisposable(email);
        normalizeUsername(body.username);
        // Captcha obligatoire aussi pour la connexion par email.
        await assertTurnstile(req, body.captchaToken ?? body.turnstileToken);
        const client = await findClientByEmail(db, email);
        if (!client && !config.signupEnabled) {
          audit(req, 'portal.email.generic');
          sendJson(res, 200, emailCodeMessage());
          return;
        }
        if (!client) {
          await enforceSignupPolicy(req, email, body.deviceId);
        }
        const send = reserveEmailSend(email);
        if (!send.ok) {
          audit(req, 'portal.email.request.rate_limited', client?.name ?? null);
          sendRateLimited(
            res,
            `Un code a déjà été demandé. Patientez ${send.retryAfterSeconds} s avant de renvoyer.`,
            'email_cooldown',
            send.retryAfterSeconds,
            { sends_in_window: send.count, max_sends: send.max },
          );
          return;
        }
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        const now = new Date();
        const expiresAt = new Date(now.getTime() + config.otpExpiresMinutes * 60_000).toISOString();
        await cleanupPortalEmailCodes(db, now.toISOString());
        await deletePortalEmailCodes(db, email);
        await insertPortalEmailCode(db, {
          email,
          codeHash: otpHash(email, code),
          createdAt: now.toISOString(),
          expiresAt,
        });
        audit(req, 'portal.email.requested', client?.name ?? null);
        try {
          await mailer.sendPortalCode({ to: email, code, minutes: config.otpExpiresMinutes });
        } catch (err) {
          releaseEmailSend(email);
          await deletePortalEmailCodes(db, email);
          audit(req, 'portal.email.send_failed', client?.name ?? null);
          log.error(`[${req.requestId ?? '-'}] Envoi email impossible : ${err.message}`);
          sendJson(res, 502, {
            error: {
              message: 'L’envoi du code a échoué. Réessayez dans un instant ou contactez l’administrateur.',
              type: 'api_error',
              code: 'mail_send_failed',
              param: null,
            },
          });
          return;
        }
        log.info(`[${req.requestId ?? '-'}] Code email envoyé (${client?.name ?? 'compte ou inscription'}).`);
        sendJson(res, 200, {
          ok: true,
          sent: true,
          message: 'Si cette adresse peut être utilisée, un code vient d’être envoyé. Vérifiez votre email.',
          expiresMinutes: config.otpExpiresMinutes,
          resend_in_seconds: send.retryAfterSeconds,
          sends_in_window: send.count,
          max_sends: send.max,
        });
        return;
      }

      if (route === '/email/verify' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy, config.trustCloudflare);
        if (!mailer?.enabled) {
          portalError(res, 503, 'La connexion par email n’est pas configurée sur cette passerelle.', 'email_not_configured');
          return;
        }
        if (!requireCsrf(req, res)) return;
        if (!hitWindow(emailVerifyAttempts, ip, 20, LOGIN_WINDOW_MS)) {
          audit(req, 'portal.email.verify.rate_limited');
          portalError(res, 429, 'Trop de tentatives. Réessayez dans quelques minutes.', 'too_many_attempts');
          return;
        }
        const body = await readJsonBody(req, 4 * 1024);
        const email = normalizeEmail(body.email);
        const code = String(body.code ?? '').replace(/\D/g, '');
        const username = normalizeUsername(body.username);
        if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
          portalError(res, 401, 'Code invalide ou expiré.', 'invalid_code');
          return;
        }
        const record = await getActivePortalEmailCode(db, email);
        if (!record || new Date(record.expires_at).getTime() <= Date.now()) {
          if (record) await deletePortalEmailCode(db, record.id);
          portalError(res, 401, 'Code expiré ou déjà utilisé. Demandez un nouveau code.', 'expired_code');
          return;
        }
        // Reponse identique que le compte existe ou non : le code est verifie
        // avant toute creation de compte.
        const client = await findClientByEmail(db, email);
        await incrementPortalEmailCodeAttempts(db, record.id);
        if (Number(record.attempts) + 1 > MAX_CODE_ATTEMPTS) {
          await deletePortalEmailCode(db, record.id);
          audit(req, 'portal.email.failed');
          portalError(res, 401, 'Trop de tentatives. Demandez un nouveau code.', 'too_many_attempts');
          return;
        }
        if (!safeEqualHex(otpHash(email, code), record.code_hash)) {
          audit(req, 'portal.email.failed');
          recordLoginFailure(ip);
          portalError(res, 401, 'Code incorrect. Vérifiez le dernier code reçu.', 'invalid_code');
          return;
        }
        await deletePortalEmailCode(db, record.id);
        if (!client) {
          if (!config.signupEnabled) {
            portalError(res, 401, 'Code invalide ou expiré.', 'invalid_code');
            return;
          }
          const created = await createTrialClient(email, await enforceSignupPolicy(req, email, body.deviceId));
          audit(req, 'portal.signup', created.name);
          log.info(`[${req.requestId ?? '-'}] Nouveau compte email : ${created.name} (essai ${config.trialDays} j)`);
          await createSession(req, res, created, 'signup');
          return;
        }
        await createSession(req, res, client, 'email');
        return;
      }

      if (route === '/signup/request' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy, config.trustCloudflare);
        if (!config.signupEnabled || !mailer?.enabled) {
          portalError(res, 403, 'L’inscription par email est désactivée sur cette passerelle.', 'signup_disabled');
          return;
        }
        if (!requireCsrf(req, res)) return;
        const ipState = windowState(emailRequestAttempts, ip, config.otpMaxPerIp, LOGIN_WINDOW_MS);
        if (!ipState.allowed) {
          audit(req, 'portal.signup.rate_limited');
          sendRateLimited(
            res,
            `Trop de demandes de code. Réessayez dans ${ipState.retryAfterSeconds} s.`,
            'too_many_requests',
            ipState.retryAfterSeconds,
            { max_requests: ipState.max },
          );
          return;
        }
        const body = await readJsonBody(req, 4 * 1024);
        const email = normalizeEmail(body.email);
        if (!EMAIL_RE.test(email) || email.length > 254) {
          portalError(res, 400, 'Adresse email invalide.', 'invalid_email');
          return;
        }
        assertEmailNotDisposable(email);
        normalizeUsername(body.username);
        // Captcha avant de reveler si le compte existe (anti-enumeration).
        await assertTurnstile(req, body.captchaToken ?? body.turnstileToken);
        const existing = await findClientByEmail(db, email);
        // Compte existant : le meme parcours envoie un code de connexion.
        // Aucun message ne revele l'existence du compte.
        if (!existing) await enforceSignupPolicy(req, email, body.deviceId);
        const send = reserveEmailSend(email);
        if (!send.ok) {
          audit(req, 'portal.signup.rate_limited');
          sendRateLimited(
            res,
            `Un code a déjà été demandé. Patientez ${send.retryAfterSeconds} s avant de renvoyer.`,
            'email_cooldown',
            send.retryAfterSeconds,
            { sends_in_window: send.count, max_sends: send.max },
          );
          return;
        }
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        const now = new Date();
        const expiresAt = new Date(now.getTime() + config.otpExpiresMinutes * 60_000).toISOString();
        await cleanupPortalEmailCodes(db, now.toISOString());
        await deletePortalEmailCodes(db, email);
        await insertPortalEmailCode(db, {
          email,
          codeHash: otpHash(email, code),
          createdAt: now.toISOString(),
          expiresAt,
        });
        audit(req, 'portal.signup.requested');
        try {
          await mailer.sendPortalCode({ to: email, code, minutes: config.otpExpiresMinutes });
        } catch (err) {
          releaseEmailSend(email);
          await deletePortalEmailCodes(db, email);
          audit(req, 'portal.signup.send_failed');
          log.error(`[${req.requestId ?? '-'}] Envoi email inscription impossible : ${err.message}`);
          sendJson(res, 502, {
            error: {
              message: 'L’envoi du code a échoué. Réessayez dans un instant ou contactez l’administrateur.',
              type: 'api_error',
              code: 'mail_send_failed',
              param: null,
            },
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          sent: true,
          message: 'Code envoyé. Vérifiez votre boîte email (et les spams).',
          expiresMinutes: config.otpExpiresMinutes,
          resend_in_seconds: send.retryAfterSeconds,
          sends_in_window: send.count,
          max_sends: send.max,
        });
        return;
      }

      if (route === '/signup/verify' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy, config.trustCloudflare);
        if (!config.signupEnabled || !mailer?.enabled) {
          portalError(res, 403, 'L’inscription par email est désactivée sur cette passerelle.', 'signup_disabled');
          return;
        }
        if (!requireCsrf(req, res)) return;
        if (!hitWindow(emailVerifyAttempts, ip, 20, LOGIN_WINDOW_MS)) {
          portalError(res, 429, 'Trop de tentatives. Réessayez dans quelques minutes.', 'too_many_attempts');
          return;
        }
        const body = await readJsonBody(req, 4 * 1024);
        const email = normalizeEmail(body.email);
        const code = String(body.code ?? '').replace(/\D/g, '');
        const username = normalizeUsername(body.username);
        if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
          portalError(res, 401, 'Code invalide ou expiré.', 'invalid_code');
          return;
        }
        const record = await getActivePortalEmailCode(db, email);
        if (!record || new Date(record.expires_at).getTime() <= Date.now()) {
          if (record) await deletePortalEmailCode(db, record.id);
          portalError(res, 401, 'Code expiré ou déjà utilisé. Demandez un nouveau code.', 'expired_code');
          return;
        }
        await incrementPortalEmailCodeAttempts(db, record.id);
        if (Number(record.attempts) + 1 > MAX_CODE_ATTEMPTS) {
          await deletePortalEmailCode(db, record.id);
          portalError(res, 401, 'Trop de tentatives. Demandez un nouveau code.', 'too_many_attempts');
          return;
        }
        if (!safeEqualHex(otpHash(email, code), record.code_hash)) {
          recordLoginFailure(ip);
          portalError(res, 401, 'Code incorrect. Vérifiez le dernier code reçu.', 'invalid_code');
          return;
        }
        await deletePortalEmailCode(db, record.id);

        // Un code valide sur un compte existant ouvre une session (connexion).
        const existing = await findClientByEmail(db, email);
        if (existing) {
          audit(req, 'portal.email.requested', existing.name);
          await createSession(req, res, existing, 'email');
          return;
        }

        const client = await createTrialClient(email, await enforceSignupPolicy(req, email, body.deviceId), username);
        audit(req, 'portal.signup', client.name);
        log.info(`[${req.requestId ?? '-'}] Nouveau compte email : ${client.name} (essai ${config.trialDays} j)`);
        await createSession(req, res, client, 'signup');
        return;
      }

      if (route === '/key' && method === 'POST') {
        const current = await sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        if (!requireCsrf(req, res)) return;
        const client = await getClientById(db, current.client.id);
        if (!client) {
          portalError(res, 401, 'Compte introuvable.', 'unauthorized');
          return;
        }
        if (hasKeyFor(client)) {
          portalError(res, 409, 'Une clé API existe déjà pour ce compte. Utilisez la régénération.', 'key_exists');
          return;
        }
        const apiKey = generateDerivedKey();
        await updateClientFields(db, client.id, {
          keyHash: hashApiKey(apiKey),
          keyPrefix: displayKeyPrefix(apiKey),
        });
        audit(req, 'portal.key.create', client.name);
        log.info(`[${req.requestId ?? '-'}] Clé API créée par ${client.name}.`);
        sendJson(res, 201, { ok: true, key: apiKey, client: { name: client.name, hasKey: true } });
        return;
      }

      if (route === '/key/rotate' && method === 'POST') {
        const current = await sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        if (!requireCsrf(req, res)) return;
        const client = await getClientById(db, current.client.id);
        if (!client || !hasKeyFor(client)) {
          portalError(res, 409, 'Aucune clé API à régénérer.', 'no_key');
          return;
        }
        const apiKey = generateDerivedKey();
        await updateClientFields(db, client.id, {
          keyHash: hashApiKey(apiKey),
          keyPrefix: displayKeyPrefix(apiKey),
        });
        audit(req, 'portal.key.rotate', client.name);
        log.info(`[${req.requestId ?? '-'}] Clé API régénérée par ${client.name}.`);
        sendJson(res, 200, { ok: true, key: apiKey, client: { name: client.name, hasKey: true } });
        return;
      }

      if (route === '/profile' && method === 'PUT') {
        const current = await sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        if (!requireCsrf(req, res)) return;
        const body = await readJsonBody(req, 4 * 1024);
        const name = String(body.name ?? '').trim();
        if (name.length < 1 || name.length > 80) {
          portalError(res, 400, 'Le nom doit contenir entre 1 et 80 caractères.', 'invalid_name');
          return;
        }
        await updateClientFields(db, current.client.id, { name });
        audit(req, 'portal.profile.update', name);
        sendJson(res, 200, { ok: true, name });
        return;
      }

      if (route === '/logout' && method === 'POST') {
        const current = await sessionFromRequest(req);
        if (current) {
          await deletePortalSession(db, sha256(current.token));
          audit(req, 'portal.logout', current.client.name);
        }
        setPortalCookie(req, res, '', 0);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (route === '/me' && method === 'GET') {
        const current = await sessionFromRequest(req);
        const authorizedClient = current ? null : await clientFromAuthorization(req);
        if (!current && !authorizedClient) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        let client = await maybeRollPeriod(db, current?.client ?? authorizedClient);
        client = await getClientById(db, client.id) ?? client;
        sendJson(res, 200, await mePayload(req, client));
        return;
      }

      if (route === '/logs' && method === 'GET') {
        const current = await sessionFromRequest(req);
        const authorizedClient = current ? null : await clientFromAuthorization(req);
        if (!current && !authorizedClient) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const logsClient = current?.client ?? authorizedClient;
        const data = await listUsageLogs(db, { limit, offset: 0, clientId: logsClient.id });
        sendJson(res, 200, {
          total: data.total,
          // Les utilisateurs ne doivent pas voir le modele reellement facture.
          rows: data.rows.map((row) => ({
            createdAt: row.createdAt,
            requestedModel: row.requestedModel || null,
            promptTokens: row.promptTokens,
            completionTokens: row.completionTokens,
            totalTokens: row.totalTokens,
            costUsd: row.costUsd,
            status: row.status,
            streamed: row.streamed,
            estimated: row.estimated,
            latencyMs: row.latencyMs,
          })),
        });
        return;
      }

      if (route === '/saspay/webhook' && method === 'POST') {
        await handleSaspayWebhook(req, res);
        return;
      }

      if (route === '/pass/orders' && method === 'GET') {
        const current = await sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        const orders = await listClientPaymentOrders(db, current.client.id, 20);
        sendJson(res, 200, { orders: orders.map(publicPaymentOrder) });
        return;
      }

      if (route === '/pass/checkout' && method === 'POST') {
        const current = await sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        if (!requireCsrf(req, res)) return;
        const body = await readJsonBody(req, 4 * 1024);
        const plan = getPassPlan(body.plan);
        if (!plan) {
          portalError(res, 400, 'Pass inconnu.', 'invalid_plan');
          return;
        }
        const context = await currencyContext(req, { config });
        if (!PAYABLE_CURRENCIES.has(context.currency)) {
          portalError(res, 400, 'Le paiement n’est pas disponible pour votre devise.', 'payment_currency_unsupported');
          return;
        }
        const amount = (plan.priceEur * context.rate).toFixed(2);
        const country = context.country && context.country.length === 2
          ? context.country
          : CURRENCY_COUNTRY[context.currency];
        const client = await getClientById(db, current.client.id);
        if (!client) {
          portalError(res, 401, 'Session invalide.', 'unauthorized');
          return;
        }
        const order = {
          id: crypto.randomUUID(),
          clientId: client.id,
          plan: plan.id,
          amount,
          currency: context.currency,
          country,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        await insertPaymentOrder(db, order);
        try {
          const session = await createSaspayCheckout(config, {
            amount,
            currency: context.currency,
            country,
            description: `Pass VALARIA ${plan.name}`,
            customer_email: client.email || 'client@valariamenu.com',
            customer_name: client.name,
            return_url: `${requestOrigin(req, config)}/portal?pass_order=${order.id}`,
            metadata: { order_id: order.id, client_id: client.id, plan_id: plan.id },
          });
          await updatePaymentOrder(db, order.id, {
            checkoutId: session.id,
            checkoutUrl: session.checkout_url,
          });
          sendJson(res, 200, {
            order: publicPaymentOrder(await getPaymentOrder(db, order.id)),
            checkout_url: session.checkout_url,
          });
        } catch (err) {
          await updatePaymentOrder(db, order.id, { status: 'failed' });
          log.warn(`[paiement] Création checkout impossible : ${err.message}`);
          portalError(res, 502, 'Le paiement en ligne est momentanément indisponible.', 'payment_unavailable');
        }
        return;
      }

      if (route === '/pass/confirm' && method === 'POST') {
        const current = await sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        if (!requireCsrf(req, res)) return;
        const body = await readJsonBody(req, 4 * 1024);
        const order = await getPaymentOrder(db, String(body.order_id ?? ''));
        if (!order || order.clientId !== current.client.id) {
          portalError(res, 404, 'Commande introuvable.', 'not_found');
          return;
        }
        const updated = await reconcilePaymentOrder(order);
        sendJson(res, 200, { order: publicPaymentOrder(updated) });
        return;
      }

      portalError(res, 404, 'Route inconnue.', 'not_found');
    } catch (err) {
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      if (err instanceof HttpError) {
        portalError(res, err.status, err.message, err.code);
        return;
      }
      log.error(`[${req.requestId ?? '-'}] Erreur API portail : ${err?.stack ?? err}`);
      portalError(res, 500, `Erreur interne. Réessayez. (ref ${req.requestId ?? '-'})`, 'internal_error');
    }
  }

  return { handle };
}














