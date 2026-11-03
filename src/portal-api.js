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
  cleanupPortalSessions,
  clientUsageSeriesSince,
  countClientUsageSince,
  deletePortalSession,
  getClientById,
  getPortalSession,
  getSetting,
  insertPortalSession,
  listUsageLogs,
  recordAdminAudit,
} from './db.js';
import {
  sha256,
} from './auth.js';
import {
  checkClientAccess,
  findClientByApiKey,
  maybeRollPeriod,
  remainingFor,
} from './quota.js';
import { loadPricing } from './pricing.js';
import { loadModelAliases } from './model-aliases.js';
import {
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

export function createPortalApi({ config, db, log }) {
  const loginAttempts = new Map();

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
        keyPrefix: client.keyPrefix,
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
        allowedModels: client.allowedModels,
      },
      models: availableModelIds(db),
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
        const token = crypto.randomBytes(32).toString('base64url');
        const now = new Date();
        const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
        insertPortalSession(db, sha256(token), client.id, now.toISOString(), expiresAt);
        setPortalCookie(req, res, token, Math.floor(SESSION_TTL_MS / 1000));
        loginAttempts.delete(ip);
        audit(req, 'portal.login', client.name);
        log.info(`[${req.requestId ?? '-'}] Connexion portail : ${client.name}`);
        sendJson(res, 200, {
          ok: true,
          client: { name: client.name, keyPrefix: client.keyPrefix },
          expiresAt,
        });
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
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        let client = maybeRollPeriod(db, current.client);
        client = getClientById(db, client.id) ?? client;
        sendJson(res, 200, mePayload(req, client));
        return;
      }

      if (route === '/logs' && method === 'GET') {
        const current = sessionFromRequest(req);
        if (!current) {
          portalError(res, 401, 'Session portail expirée. Reconnectez-vous.', 'unauthorized');
          return;
        }
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const data = listUsageLogs(db, { limit, offset: 0, clientId: current.client.id });
        sendJson(res, 200, {
          total: data.total,
          rows: data.rows.map((row) => ({
            createdAt: row.createdAt,
            model: row.model,
            requestedModel: row.requestedModel,
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
