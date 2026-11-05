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
} from './db.js';
import {
  displayKeyPrefix,
  generateDerivedKey,
  hashApiKey,
  sha256,
} from './auth.js';
import { getMasterKey } from './secrets.js';
import {
  checkClientAccess,
  findClientByApiKey,
  maybeRollPeriod,
  periodKeyFor,
  remainingFor,
} from './quota.js';
import { loadPricing } from './pricing.js';
import { loadModelAliases } from './model-aliases.js';
import { deviceHashFor, isDisposableEmail } from './abuse.js';
import { lookupIpqsEmail, lookupIpqsIp, verifyTurnstile } from './fraud.js';
import {
  bearerToken,
  clientIp,
  HttpError,
  isHttpsRequest,
  originAllowed,
  parseCookies,
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

function availableModelIds(db) {
  const pricing = loadPricing(() => getSetting(db, 'pricing', null));
  const aliases = loadModelAliases(() => getSetting(db, 'model_aliases', null));
  const ids = new Set(Object.keys(pricing.models ?? {}));
  for (const pattern of Object.keys(aliases ?? {})) {
    ids.add(pattern.endsWith('*') ? pattern.slice(0, -1) : pattern);
  }
  return [...ids].filter(Boolean);
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
    try {
      recordAdminAudit(db, { ip: clientIp(req, config.trustProxy), action, target });
    } catch (err) {
      log.error(`Audit portail impossible : ${err.message}`);
    }
  }

  function normalizeEmail(value) {
    return String(value ?? '').trim().toLowerCase();
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

  function createSession(req, res, client, method = 'api_key') {
    cleanupPortalSessions(db, new Date().toISOString());
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    insertPortalSession(db, sha256(token), client.id, now.toISOString(), expiresAt);
    setPortalCookie(req, res, token, Math.floor(SESSION_TTL_MS / 1000));
    loginAttempts.delete(clientIp(req, config.trustProxy));
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
    return clientIp(req, config.trustProxy);
  }

  /** Verification anti-bot Turnstile, fail-closed si le service est en erreur. */
  async function assertTurnstile(req, token) {
    if (!config.turnstileRequired) return;
    try {
      const result = await verifyTurnstile(token, requestIp(req), config);
      if (!result.ok) {
        audit(req, 'portal.signup.blocked', 'turnstile_failed');
        throw new HttpError(
          403,
          'Vérification anti-bot échouée. Rechargez la page, attendez la validation du captcha puis réessayez.',
          'turnstile_failed',
        );
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      log.error(`[${req.requestId ?? '-'}] Verification Turnstile impossible : ${err.message}`);
      throw new HttpError(
        503,
        'La vérification anti-bot est momentanément indisponible. Réessayez dans quelques instants.',
        'turnstile_unavailable',
      );
    }
  }

  /**
   * Anti-abus avant creation d'un compte : email jetable, 1 compte par IP et
   * par appareil sur la fenetre configuree, VPN/proxy optionnel.
   */
  async function enforceSignupPolicy(req, email, deviceId) {
    if (config.blockTempMail && isDisposableEmail(email, config.blockedEmailDomains)) {
      audit(req, 'portal.signup.blocked', 'email_disposable');
      throw new HttpError(
        400,
        'Les adresses email jetables (temp mail) ne sont pas acceptées. Utilisez une adresse personnelle.',
        'email_disposable',
      );
    }
    const ip = requestIp(req);
    const deviceHash = deviceHashFor(deviceId, req);
    const now = Date.now();
    cleanupSignupIdentities(db, new Date(now - 365 * 86_400_000).toISOString());

    if (config.signupMaxPerIp > 0) {
      const since = new Date(now - config.signupIpWindowDays * 86_400_000).toISOString();
      const count = countSignupIdentitiesByIp(db, ip, since);
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
      const count = countSignupIdentitiesByDevice(db, deviceHash, since);
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
  function createTrialClient(email, identity = null) {
    const now = new Date();
    const trialExpiry = new Date(now.getTime() + config.trialDays * 86_400_000).toISOString();
    const localPart = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
    const client = {
      id: crypto.randomUUID(),
      name: (localPart || 'Nouveau compte').slice(0, 80),
      email,
      keyHash: sha256(`pending:${crypto.randomUUID()}`),
      keyPrefix: 'en attente',
      enabled: true,
      quotaTokens: null,
      quotaRequests: config.trialQuotaRequests || null,
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
    insertClient(db, client);
    if (identity) {
      insertSignupIdentity(db, {
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

  function sessionFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[PORTAL_COOKIE];
    if (!token) return null;
    const session = getPortalSession(db, sha256(token));
    if (!session) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      deletePortalSession(db, sha256(token));
      return null;
    }
    const client = getClientById(db, session.client_id);
    if (!client) {
      deletePortalSession(db, sha256(token));
      return null;
    }
    return { token, session, client };
  }

  /**
   * Authentification directe par clé derivee (CLI npm, scripts) :
   * GET /portal/api/me et /logs acceptent `Authorization: Bearer sk-dsk-...`
   * ou `x-api-key`, sans session cookie ni échange de mot de passe.
   */
  function clientFromAuthorization(req) {
    const token = bearerToken(req) || String(req.headers['x-api-key'] ?? '').trim();
    if (!token) return null;
    return findClientByApiKey(db, token);
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

  function mePayload(req, client) {
    const now = new Date();
    const today = countClientUsageSince(db, client.id, utcStartOfToday(now));
    const totals = countClientUsageSince(db, client.id, '1970-01-01T00:00:00.000Z');
    const series = fillSeries(
      clientUsageSeriesSince(db, client.id, new Date(now.getTime() - 29 * 86_400_000).toISOString()),
      30,
      now,
    );
    const access = checkClientAccess(client, now);
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
      },
      models: availableModelIds(db).filter((id) => id !== 'deepseek-flash'),
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

  async function handle(req, res, url, pathname) {
    const route = pathname.slice('/portal/api'.length) || '/';
    const method = req.method;

    try {
      if (route === '/login' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy);
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
        const client = findClientByApiKey(db, apiKey);
        if (!client) {
          recordLoginFailure(ip);
          audit(req, 'portal.login.failed');
          portalError(res, 401, 'Clé API invalide. Vérifiez la clé fournie par l\'administrateur.', 'invalid_api_key');
          return;
        }
        cleanupPortalSessions(db, new Date().toISOString());
        createSession(req, res, client, 'api_key');
        return;
      }

      if (route === '/config' && method === 'GET') {
        sendJson(res, 200, {
          emailLoginEnabled: Boolean(mailer?.enabled),
          signupEnabled: Boolean(config.signupEnabled) && Boolean(mailer?.enabled),
          turnstileSiteKey: config.turnstileSiteKey || null,
          turnstileRequired: Boolean(config.turnstileRequired),
          method: mailer?.enabled ? 'email' : null,
        });
        return;
      }

      if (route === '/email/request' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy);
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
        const client = findClientByEmail(db, email);
        if (!client && !config.signupEnabled) {
          // Reponse generique : ne revele pas l'absence de compte.
          audit(req, 'portal.email.requested');
          sendJson(res, 200, emailCodeMessage());
          return;
        }
        if (!client) {
          await assertTurnstile(req, body.turnstileToken);
          await enforceSignupPolicy(req, email, body.deviceId);
        }
        const send = reserveEmailSend(email);
        if (!send.ok) {
          audit(req, client ? 'portal.email.request.rate_limited' : 'portal.signup.rate_limited', client?.name ?? null);
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
        cleanupPortalEmailCodes(db, now.toISOString());
        deletePortalEmailCodes(db, email);
        insertPortalEmailCode(db, {
          email,
          codeHash: otpHash(email, code),
          createdAt: now.toISOString(),
          expiresAt,
        });
        audit(req, client ? 'portal.email.requested' : 'portal.signup.requested', client?.name ?? null);
        try {
          await mailer.sendPortalCode({ to: email, code, minutes: config.otpExpiresMinutes });
        } catch (err) {
          releaseEmailSend(email);
          deletePortalEmailCodes(db, email);
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
        log.info(`[${req.requestId ?? '-'}] Code de connexion email envoyé (${client?.name ?? 'nouveau compte'}).`);
        sendJson(res, 200, {
          ok: true,
          sent: true,
          signup: !client,
          message: client
            ? 'Code de connexion envoyé. Vérifiez votre boîte email.'
            : 'Code envoyé. Le compte sera créé automatiquement après validation (pass d’essai).',
          expiresMinutes: config.otpExpiresMinutes,
          resend_in_seconds: send.retryAfterSeconds,
          sends_in_window: send.count,
          max_sends: send.max,
        });
        return;
      }

      if (route === '/email/verify' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy);
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
        if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
          portalError(res, 401, 'Code invalide ou expiré.', 'invalid_code');
          return;
        }
        const record = getActivePortalEmailCode(db, email);
        if (!record || new Date(record.expires_at).getTime() <= Date.now()) {
          if (record) deletePortalEmailCode(db, record.id);
          portalError(res, 401, 'Code expiré ou déjà utilisé. Demandez un nouveau code.', 'expired_code');
          return;
        }
        // Si l'inscription autonome est active, une adresse inconnue est acceptee :
        // le compte sera cree apres validation du code.
        const client = findClientByEmail(db, email);
        if (!client && !config.signupEnabled) {
          portalError(
            res,
            409,
            'Aucun compte n’existe encore pour cette adresse. Utilisez « Créer un compte » pour finaliser l’inscription avec ce code.',
            'account_not_found',
          );
          return;
        }
        incrementPortalEmailCodeAttempts(db, record.id);
        if (Number(record.attempts) + 1 > MAX_CODE_ATTEMPTS) {
          deletePortalEmailCode(db, record.id);
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
        deletePortalEmailCode(db, record.id);
        if (client) {
          createSession(req, res, client, 'email');
          return;
        }
        const created = createTrialClient(email, await enforceSignupPolicy(req, email, body.deviceId));
        audit(req, 'portal.signup', created.name);
        log.info(`[${req.requestId ?? '-'}] Nouveau compte email via connexion : ${created.name} (essai ${config.trialDays} j)`);
        createSession(req, res, created, 'signup');
        return;
      }

      if (route === '/signup/request' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy);
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
        const existing = findClientByEmail(db, email);
        if (!existing) {
          await assertTurnstile(req, body.turnstileToken);
          await enforceSignupPolicy(req, email, body.deviceId);
        }
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
        cleanupPortalEmailCodes(db, now.toISOString());
        deletePortalEmailCodes(db, email);
        insertPortalEmailCode(db, {
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
          deletePortalEmailCodes(db, email);
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
        const ip = clientIp(req, config.trustProxy);
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
        if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
          portalError(res, 401, 'Code invalide ou expiré.', 'invalid_code');
          return;
        }
        const record = getActivePortalEmailCode(db, email);
        if (!record || new Date(record.expires_at).getTime() <= Date.now()) {
          if (record) deletePortalEmailCode(db, record.id);
          portalError(res, 401, 'Code expiré ou déjà utilisé. Demandez un nouveau code.', 'expired_code');
          return;
        }
        incrementPortalEmailCodeAttempts(db, record.id);
        if (Number(record.attempts) + 1 > MAX_CODE_ATTEMPTS) {
          deletePortalEmailCode(db, record.id);
          portalError(res, 401, 'Trop de tentatives. Demandez un nouveau code.', 'too_many_attempts');
          return;
        }
        if (!safeEqualHex(otpHash(email, code), record.code_hash)) {
          recordLoginFailure(ip);
          portalError(res, 401, 'Code incorrect. Vérifiez le dernier code reçu.', 'invalid_code');
          return;
        }
        deletePortalEmailCode(db, record.id);

        // Compte déjà existant : on connecte simplement (pas de doublon).
        const existing = findClientByEmail(db, email);
        if (existing) {
          createSession(req, res, existing, 'email');
          return;
        }

        const client = createTrialClient(email, await enforceSignupPolicy(req, email, body.deviceId));
        audit(req, 'portal.signup', client.name);
        log.info(`[${req.requestId ?? '-'}] Nouveau compte email : ${client.name} (essai ${config.trialDays} j)`);
        createSession(req, res, client, 'signup');
        return;
      }

      if (route === '/key' && method === 'POST') {
        const current = sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        if (!requireCsrf(req, res)) return;
        const client = getClientById(db, current.client.id);
        if (!client) {
          portalError(res, 401, 'Compte introuvable.', 'unauthorized');
          return;
        }
        if (hasKeyFor(client)) {
          portalError(res, 409, 'Une clé API existe déjà pour ce compte. Utilisez la régénération.', 'key_exists');
          return;
        }
        const apiKey = generateDerivedKey();
        updateClientFields(db, client.id, {
          keyHash: hashApiKey(apiKey),
          keyPrefix: displayKeyPrefix(apiKey),
        });
        audit(req, 'portal.key.create', client.name);
        log.info(`[${req.requestId ?? '-'}] Clé API créée par ${client.name}.`);
        sendJson(res, 201, { ok: true, key: apiKey, client: { name: client.name, hasKey: true } });
        return;
      }

      if (route === '/key/rotate' && method === 'POST') {
        const current = sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        if (!requireCsrf(req, res)) return;
        const client = getClientById(db, current.client.id);
        if (!client || !hasKeyFor(client)) {
          portalError(res, 409, 'Aucune clé API à régénérer.', 'no_key');
          return;
        }
        const apiKey = generateDerivedKey();
        updateClientFields(db, client.id, {
          keyHash: hashApiKey(apiKey),
          keyPrefix: displayKeyPrefix(apiKey),
        });
        audit(req, 'portal.key.rotate', client.name);
        log.info(`[${req.requestId ?? '-'}] Clé API régénérée par ${client.name}.`);
        sendJson(res, 200, { ok: true, key: apiKey, client: { name: client.name, hasKey: true } });
        return;
      }

      if (route === '/profile' && method === 'PUT') {
        const current = sessionFromRequest(req);
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
        updateClientFields(db, current.client.id, { name });
        audit(req, 'portal.profile.update', name);
        sendJson(res, 200, { ok: true, name });
        return;
      }

      if (route === '/logout' && method === 'POST') {
        const current = sessionFromRequest(req);
        if (current) {
          deletePortalSession(db, sha256(current.token));
          audit(req, 'portal.logout', current.client.name);
        }
        setPortalCookie(req, res, '', 0);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (route === '/me' && method === 'GET') {
        const current = sessionFromRequest(req);
        const authorizedClient = current ? null : clientFromAuthorization(req);
        if (!current && !authorizedClient) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        let client = maybeRollPeriod(db, current?.client ?? authorizedClient);
        client = getClientById(db, client.id) ?? client;
        sendJson(res, 200, mePayload(req, client));
        return;
      }

      if (route === '/logs' && method === 'GET') {
        const current = sessionFromRequest(req);
        const authorizedClient = current ? null : clientFromAuthorization(req);
        if (!current && !authorizedClient) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const logsClient = current?.client ?? authorizedClient;
        const data = listUsageLogs(db, { limit, offset: 0, clientId: logsClient.id });
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

