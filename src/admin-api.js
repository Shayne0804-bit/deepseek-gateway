import crypto from 'node:crypto';
import { APP_VERSION, PANEL_COOKIE } from './config.js';
import {
  countAllUsage,
  countClients,
  countUsageSince,
  deleteAllAdminSessions,
  deleteClient,
  deleteSetting,
  getClientById,
  getSetting,
  insertClient,
  listAdminAudit,
  listClients,
  listUsageLogs,
  perClientUsageSince,
  recordAdminAudit,
  resetClientUsage,
  setSetting,
  topClientsSince,
  updateClientFields,
  usageSeriesSince,
} from './db.js';
import {
  createAdminSession,
  destroyAdminSession,
  displayKeyPrefix,
  generateDerivedKey,
  hashApiKey,
  validateAdminSession,
} from './auth.js';
import {
  changeAdminPassword,
  checkAdminPassword,
  getAdminPasswordSource,
  getGlobalBudgetUsd,
  globalBudgetStatus,
  maskApiKey,
  resolveProviderConfig,
  saveGlobalBudgetUsd,
  saveProviderField,
  serverInfo,
} from './settings.js';
import {
  DEFAULT_PRICING,
  loadPricing,
  normalizePricing,
  peakWindowsLabel,
} from './pricing.js';
import {
  DEFAULT_MODEL_ALIASES,
  loadModelAliases,
  normalizeModelAliases,
} from './model-aliases.js';
import {
  checkClientAccess,
  normalizePeriod,
  periodKeyFor,
  remainingFor,
} from './quota.js';
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

const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'dsk-admin';
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function adminError(res, status, message, code = null) {
  sendApiError(res, status, message, 'admin_error', code);
}

function publicClient(client, today = null) {
  const remaining = remainingFor(client);
  const status = checkClientAccess(client);
  return {
    id: client.id,
    name: client.name,
    keyPrefix: client.keyPrefix,
    enabled: client.enabled,
    period: client.period,
    periodStart: client.periodStart,
    quotaTokens: client.quotaTokens,
    quotaRequests: client.quotaRequests,
    quotaUsd: client.quotaUsd,
    usedTokens: client.usedTokens,
    usedRequests: client.usedRequests,
    usedUsd: Math.round(client.usedUsd * 1e6) / 1e6,
    remainingTokens: remaining.tokens,
    remainingRequests: remaining.requests,
    remainingUsd: remaining.usd == null ? null : Math.round(remaining.usd * 1e6) / 1e6,
    rpmLimit: client.rpmLimit,
    concurrencyLimit: client.concurrencyLimit,
    maxOutputTokens: client.maxOutputTokens,
    allowedModels: client.allowedModels,
    expiresAt: client.expiresAt,
    note: client.note,
    createdAt: client.createdAt,
    lastUsedAt: client.lastUsedAt,
    todayRequests: today?.requests ?? 0,
    todayTokens: today?.tokens ?? 0,
    todayCost: Math.round((today?.cost ?? 0) * 1e6) / 1e6,
    status: status ? status.code : 'ok',
    exhausted: status?.code === 'insufficient_quota',
  };
}

function parseNullableInt(body, key, min, max, label) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  const value = body[key];
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${label} invalide (entier entre ${min} et ${max}).`, 'invalid_field');
  }
  return n;
}

function parseClientPayload(body, { partial = false } = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const out = {};

  if (!partial || has('name')) {
    const name = String(body.name ?? '').trim();
    if (name.length < 1 || name.length > 80) {
      throw new HttpError(400, 'Le nom doit contenir entre 1 et 80 caracteres.', 'invalid_name');
    }
    out.name = name;
  }

  const intFields = [
    ['quotaTokens', 0, 10_000_000_000, 'Quota de tokens'],
    ['quotaRequests', 0, 100_000_000, 'Quota de requetes'],
    ['rpmLimit', 1, 100_000, 'Limite de requetes/minute'],
    ['concurrencyLimit', 1, 1000, 'Limite de requetes simultanees'],
    ['maxOutputTokens', 1, 393216, 'Limite de tokens de sortie'],
  ];
  for (const [key, min, max, label] of intFields) {
    const parsed = parseNullableInt(body, key, min, max, label);
    if (parsed !== undefined) out[key] = parsed;
  }

  if (has('quotaUsd')) {
    const value = body.quotaUsd;
    if (value == null || value === '') {
      out.quotaUsd = null;
    } else {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
        throw new HttpError(400, 'Quota en USD invalide.', 'invalid_quota_usd');
      }
      out.quotaUsd = Math.round(n * 1e6) / 1e6;
    }
  }

  if (!partial || has('period')) out.period = normalizePeriod(body.period ?? 'monthly');

  if (has('enabled')) out.enabled = Boolean(body.enabled);

  if (has('expiresAt')) {
    const value = body.expiresAt;
    if (value == null || value === '') {
      out.expiresAt = null;
    } else {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        throw new HttpError(400, "Date d'expiration invalide.", 'invalid_expiry');
      }
      out.expiresAt = date.toISOString();
    }
  }

  if (has('note')) {
    const note = body.note == null ? null : String(body.note).trim();
    if (note && note.length > 500) {
      throw new HttpError(400, 'La note est limitee a 500 caracteres.', 'invalid_note');
    }
    out.note = note || null;
  }

  if (has('allowedModels')) {
    const value = body.allowedModels;
    let models = null;
    if (Array.isArray(value)) models = value;
    else if (typeof value === 'string') models = value.split(',');
    else if (value != null && value !== '') {
      throw new HttpError(400, 'allowedModels doit etre une liste.', 'invalid_models');
    }
    if (models) {
      const cleaned = [...new Set(models.map((m) => String(m).trim()).filter(Boolean))];
      if (cleaned.some((m) => m.length > 80)) {
        throw new HttpError(400, 'Nom de modele trop long.', 'invalid_models');
      }
      out.allowedModels = cleaned.length ? cleaned : null;
    } else {
      out.allowedModels = null;
    }
  }

  return out;
}

function fillDailySeries(rows, days = 30, now = new Date()) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const series = [];
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(day);
    series.push({
      day,
      requests: row?.requests ?? 0,
      tokens: row?.tokens ?? 0,
      cost: Math.round((row?.cost ?? 0) * 1e6) / 1e6,
    });
  }
  return series;
}

function utcStartOfToday(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function validateHttpUrl(value, label) {
  if (value == null || value === '') return '';
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new HttpError(400, `${label} invalide : URL attendue.`, 'invalid_url');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(400, `${label} : seuls http et https sont acceptes.`, 'invalid_url');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

export function createAdminApi({ config, db, log }) {
  const loginAttempts = new Map();

  function requireSession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[PANEL_COOKIE];
    const session = validateAdminSession(db, token);
    if (!session) return null;
    return { token, session };
  }

  function setSessionCookie(req, res, token, maxAgeSeconds) {
    const cookie = serializeCookie(PANEL_COOKIE, token, {
      maxAge: maxAgeSeconds,
      secure: isHttpsRequest(req, config.trustProxy),
    });
    res.setHeader('set-cookie', cookie);
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
    if (!entry || now - entry.first > LOGIN_WINDOW_MS) {
      loginAttempts.set(ip, { first: now, count: 1 });
    } else {
      entry.count += 1;
    }
  }

  function clearLoginFailures(ip) {
    loginAttempts.delete(ip);
  }

  /** Journal d'audit des actions d'administration (production). */
  function audit(req, action, target = null, details = null) {
    try {
      recordAdminAudit(db, {
        ip: clientIp(req, config.trustProxy),
        action,
        target,
        details,
      });
    } catch (err) {
      log.error(`Journal d'audit impossible : ${err.message}`);
    }
  }

  function csvCell(value) {
    const text = value == null ? '' : String(value);
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function readSettingsView() {
    const provider = resolveProviderConfig(db, config);
    const pricing = loadPricing(() => getSetting(db, 'pricing', null));
    const modelAliases = loadModelAliases(() => getSetting(db, 'model_aliases', null));
    const publicStored = getSetting(db, 'public_base_url', '') || '';
    const publicBaseUrl = config.publicBaseUrl || publicStored;
    let publicBaseUrlSource = 'default';
    if (config.publicBaseUrl) publicBaseUrlSource = 'env';
    else if (publicStored) publicBaseUrlSource = 'panel';
    return {
      provider: {
        configured: Boolean(provider.apiKey),
        source: provider.source,
        masked: maskApiKey(provider.apiKey),
        baseUrl: provider.baseUrl,
        baseUrlSource: provider.baseUrlSource,
        envApiKey: Boolean(config.providerApiKey),
        envBaseUrl: Boolean(config.providerBaseUrl),
      },
      publicBaseUrl,
      publicBaseUrlSource,
      pricing,
      pricingMeta: {
        peakLabel: peakWindowsLabel(pricing),
        defaultPricing: DEFAULT_PRICING,
      },
      modelAliases,
      modelAliasesMeta: { defaults: DEFAULT_MODEL_ALIASES },
      globalBudget: globalBudgetStatus(db),
      globalBudgetUsd: getGlobalBudgetUsd(db),
      admin: { passwordSource: getAdminPasswordSource(db) },
      server: serverInfo(config),
    };
  }

  async function handle(req, res, url, pathname) {
    const route = pathname.slice('/admin/api'.length) || '/';
    const method = req.method;

    try {
      // ------------------------------ public ------------------------------
      if (route === '/login' && method === 'POST') {
        const ip = clientIp(req, config.trustProxy);
        if (loginRateLimited(ip)) {
          audit(req, 'admin.login.rate_limited', 'admin');
          adminError(res, 429, 'Trop de tentatives. Reessayez dans quelques minutes.', 'too_many_attempts');
          return;
        }
        const body = await readJsonBody(req, 16 * 1024);
        const password = String(body.password ?? '');
        if (!checkAdminPassword(db, password)) {
          recordLoginFailure(ip);
          audit(req, 'admin.login.failed', 'admin');
          log.warn(`Echec de connexion admin depuis ${ip}`);
          adminError(res, 401, 'Mot de passe incorrect.', 'invalid_password');
          return;
        }
        clearLoginFailures(ip);
        const ttlMs = config.sessionHours * 3600 * 1000;
        const { token, expiresAt } = createAdminSession(db, ttlMs);
        setSessionCookie(req, res, token, Math.floor(ttlMs / 1000));
        audit(req, 'admin.login', 'admin');
        log.info(`Connexion admin depuis ${ip}`);
        sendJson(res, 200, { ok: true, expiresAt, server: { version: APP_VERSION } });
        return;
      }

      if (route === '/session' && method === 'GET') {
        const auth = requireSession(req);
        if (!auth) {
          adminError(res, 401, 'Non authentifie.', 'unauthorized');
          return;
        }
        const provider = resolveProviderConfig(db, config);
        sendJson(res, 200, {
          authenticated: true,
          server: serverInfo(config),
          provider: { configured: Boolean(provider.apiKey), source: provider.source },
          admin: { passwordSource: getAdminPasswordSource(db) },
        });
        return;
      }

      // Toutes les routes suivantes exigent une session valide.
      const auth = requireSession(req);
      if (!auth) {
        adminError(res, 401, 'Session expiree. Reconnectez-vous.', 'unauthorized');
        return;
      }

      // Protection CSRF simple : en-tete personnalise + origine identique.
      if (!['GET', 'HEAD'].includes(method)) {
        if (String(req.headers[CSRF_HEADER] ?? '') !== CSRF_VALUE) {
          adminError(res, 403, 'Requete refusee (en-tete de securite manquant).', 'csrf');
          return;
        }
        if (!originAllowed(req)) {
          adminError(res, 403, 'Origine non autorisee.', 'csrf_origin');
          return;
        }
      }

      if (route === '/logout' && method === 'POST') {
        audit(req, 'admin.logout', 'admin');
        destroyAdminSession(db, auth.token);
        res.setHeader(
          'set-cookie',
          serializeCookie(PANEL_COOKIE, '', { maxAge: 0, secure: isHttpsRequest(req, config.trustProxy) }),
        );
        sendJson(res, 200, { ok: true });
        return;
      }

      // ----------------------------- overview ----------------------------
      if (route === '/overview' && method === 'GET') {
        const now = new Date();
        const todayIso = utcStartOfToday(now);
        const sinceIso = new Date(now.getTime() - 29 * 86_400_000);
        sinceIso.setUTCHours(0, 0, 0, 0);
        const clients = listClients(db);
        const counts = countClients(db);
        const todayByClient = perClientUsageSince(db, todayIso);
        const provider = resolveProviderConfig(db, config);
        const pricing = loadPricing(() => getSetting(db, 'pricing', null));
        const exhausted = clients.filter((c) => checkClientAccess(c)?.code === 'insufficient_quota').length;
        sendJson(res, 200, {
          generatedAt: now.toISOString(),
          provider: { configured: Boolean(provider.apiKey), source: provider.source },
          counts: {
            clientsTotal: counts.total,
            clientsEnabled: counts.enabled,
            clientsExhausted: exhausted,
            clientsDisabled: clients.filter((c) => !c.enabled).length,
          },
          today: countUsageSince(db, todayIso),
          totals: countAllUsage(db),
          series: fillDailySeries(usageSeriesSince(db, sinceIso.toISOString()), 30, now),
          topClients: topClientsSince(db, sinceIso.toISOString(), 5),
          recent: listUsageLogs(db, { limit: 8 }).rows,
          pricing: {
            currency: pricing.currency,
            peakLabel: peakWindowsLabel(pricing),
            offPeakNotice: 'Les heures creuses sont a moitie prix.',
          },
          globalBudget: globalBudgetStatus(db),
          clientsUsingToday: [...todayByClient.entries()]
            .map(([id, usage]) => ({ id, ...usage }))
            .sort((a, b) => b.tokens - a.tokens)
            .slice(0, 5),
          server: serverInfo(config),
        });
        return;
      }

      // ----------------------------- clients -----------------------------
      if (route === '/clients' && method === 'GET') {
        const todayIso = utcStartOfToday();
        const todayByClient = perClientUsageSince(db, todayIso);
        const clients = listClients(db).map((client) => publicClient(client, todayByClient.get(client.id)));
        sendJson(res, 200, { clients });
        return;
      }

      if (route === '/clients' && method === 'POST') {
        const body = await readJsonBody(req, 64 * 1024);
        const payload = parseClientPayload(body);
        if (listClients(db).some((c) => c.name === payload.name)) {
          adminError(res, 409, 'Ce nom est deja utilise par une autre cle.', 'duplicate_name');
          return;
        }
        const now = new Date();
        const apiKey = generateDerivedKey();
        const client = {
          id: crypto.randomUUID(),
          name: payload.name,
          keyHash: hashApiKey(apiKey),
          keyPrefix: displayKeyPrefix(apiKey),
          enabled: payload.enabled !== false,
          quotaTokens: payload.quotaTokens ?? null,
          quotaRequests: payload.quotaRequests ?? null,
          quotaUsd: payload.quotaUsd ?? null,
          usedTokens: 0,
          usedRequests: 0,
          usedUsd: 0,
          period: payload.period ?? 'monthly',
          periodStart: periodKeyFor(payload.period ?? 'monthly', now),
          rpmLimit: payload.rpmLimit ?? null,
          concurrencyLimit: payload.concurrencyLimit ?? null,
          maxOutputTokens: payload.maxOutputTokens ?? null,
          allowedModels: payload.allowedModels ?? null,
          expiresAt: payload.expiresAt ?? null,
          note: payload.note ?? null,
          createdAt: now.toISOString(),
        };
        insertClient(db, client);
        audit(req, 'client.create', client.name, client.id);
        log.info(`Cle derivee creee pour "${client.name}".`);
        sendJson(res, 201, { client: publicClient(getClientById(db, client.id)), key: apiKey });
        return;
      }

      const clientMatch = /^\/clients\/([0-9a-f-]{36})(\/[a-z]+)?$/.exec(route);
      if (clientMatch) {
        const clientId = clientMatch[1];
        const subRoute = clientMatch[2] ?? '';
        const existing = getClientById(db, clientId);
        if (!existing) {
          adminError(res, 404, 'Cle introuvable.', 'not_found');
          return;
        }

        if (!subRoute && method === 'GET') {
          sendJson(res, 200, { client: publicClient(existing) });
          return;
        }

        if (!subRoute && method === 'PATCH') {
          const body = await readJsonBody(req, 64 * 1024);
          const payload = parseClientPayload(body, { partial: true });
          if (payload.name != null) {
            const duplicate = listClients(db).find((c) => c.id !== clientId && c.name === payload.name);
            if (duplicate) {
              adminError(res, 409, 'Ce nom est deja utilise par une autre cle.', 'duplicate_name');
              return;
            }
          }
          updateClientFields(db, clientId, payload);
          if (payload.period && payload.period !== existing.period) {
            resetClientUsage(db, clientId, periodKeyFor(payload.period));
          }
          audit(req, 'client.update', existing.name, Object.keys(payload).join(','));
          log.info(`Cle "${existing.name}" mise a jour.`);
          sendJson(res, 200, { client: publicClient(getClientById(db, clientId)) });
          return;
        }

        if (!subRoute && method === 'DELETE') {
          deleteClient(db, clientId);
          audit(req, 'client.delete', existing.name, clientId);
          log.info(`Cle "${existing.name}" supprimee (avec ses journaux).`);
          sendJson(res, 200, { ok: true });
          return;
        }

        if (subRoute === '/regenerate' && method === 'POST') {
          const apiKey = generateDerivedKey();
          updateClientFields(db, clientId, {
            keyHash: hashApiKey(apiKey),
            keyPrefix: displayKeyPrefix(apiKey),
          });
          audit(req, 'client.key.regenerate', existing.name);
          log.info(`Cle "${existing.name}" regeneree.`);
          sendJson(res, 200, { client: publicClient(getClientById(db, clientId)), key: apiKey });
          return;
        }

        if (subRoute === '/reset' && method === 'POST') {
          resetClientUsage(db, clientId, periodKeyFor(existing.period));
          audit(req, 'client.usage.reset', existing.name);
          log.info(`Compteurs de "${existing.name}" remis a zero.`);
          sendJson(res, 200, { client: publicClient(getClientById(db, clientId)) });
          return;
        }

        const logsMatch = /^\/clients\/([0-9a-f-]{36})\/logs$/.exec(route);
        if (logsMatch && method === 'GET') {
          const limit = Number(url.searchParams.get('limit') ?? 50);
          const offset = Number(url.searchParams.get('offset') ?? 0);
          sendJson(res, 200, listUsageLogs(db, { limit, offset, clientId }));
          return;
        }

        adminError(res, 405, 'Methode non autorisee.', 'method_not_allowed');
        return;
      }

      // ------------------------------- logs ------------------------------
      if (route === '/logs' && method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const clientId = url.searchParams.get('clientId') || null;
        sendJson(res, 200, listUsageLogs(db, { limit, offset, clientId }));
        return;
      }

      // Export CSV des journaux (production / comptabilite).
      if (route === '/export/logs.csv' && method === 'GET') {
        const clientId = url.searchParams.get('clientId') || null;
        const { rows } = listUsageLogs(db, { limit: 5000, offset: 0, clientId });
        const lines = [[
          'date', 'cle', 'modele_demande', 'modele_facture', 'tokens_entree', 'tokens_sortie',
          'tokens_total', 'cout_usd', 'statut', 'latence_ms', 'streaming', 'estime',
        ].join(';')];
        for (const row of rows) {
          lines.push([
            row.createdAt,
            row.clientName,
            row.requestedModel ?? '',
            row.model ?? '',
            row.promptTokens,
            row.completionTokens,
            row.totalTokens,
            String(row.costUsd).replace('.', ','),
            row.status,
            row.latencyMs ?? '',
            row.streamed ? 'oui' : 'non',
            row.estimated ? 'oui' : 'non',
          ].map(csvCell).join(';'));
        }
        const csv = `\uFEFF${lines.join('\r\n')}`;
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="journaux-deepseek-gateway.csv"',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(csv),
        });
        res.end(csv);
        return;
      }

      // ------------------------------- audit -----------------------------
      if (route === '/audit' && method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        sendJson(res, 200, listAdminAudit(db, { limit, offset }));
        return;
      }

      // ----------------------------- settings ----------------------------
      if (route === '/settings' && method === 'GET') {
        sendJson(res, 200, readSettingsView());
        return;
      }

      if (route === '/settings' && method === 'PUT') {
        const body = await readJsonBody(req, 256 * 1024);
        const changed = [];

        if (body.providerApiKey !== undefined) {
          if (config.providerApiKey) {
            throw new HttpError(
              409,
              "La cle originale est definie par la variable d'environnement DEEPSEEK_API_KEY et ne peut pas etre modifiee ici.",
              'env_managed',
            );
          }
          const value = String(body.providerApiKey ?? '').trim();
          if (value && !value.startsWith('sk-')) {
            throw new HttpError(400, 'Cle API invalide : elle doit commencer par "sk-".', 'invalid_api_key');
          }
          saveProviderField(db, 'apiKey', value || null, config);
          changed.push('providerApiKey');
        }

        if (body.providerBaseUrl !== undefined) {
          if (config.providerBaseUrl) {
            throw new HttpError(
              409,
              "L'URL de base est definie par la variable d'environnement DEEPSEEK_BASE_URL.",
              'env_managed',
            );
          }
          const value = validateHttpUrl(body.providerBaseUrl, "URL de l'API DeepSeek");
          saveProviderField(db, 'baseUrl', value || null, config);
          changed.push('providerBaseUrl');
        }

        if (body.publicBaseUrl !== undefined) {
          if (config.publicBaseUrl) {
            throw new HttpError(409, "L'URL publique est definie par PUBLIC_BASE_URL.", 'env_managed');
          }
          const value = validateHttpUrl(body.publicBaseUrl, "URL publique de la passerelle");
          setSetting(db, 'public_base_url', value);
          changed.push('publicBaseUrl');
        }

        if (body.pricing !== undefined) {
          let pricing;
          try {
            pricing = normalizePricing(body.pricing);
          } catch (err) {
            throw new HttpError(400, `Tarification invalide : ${err.message}`, 'invalid_pricing');
          }
          setSetting(db, 'pricing', pricing);
          changed.push('pricing');
        }

        if (body.modelAliases !== undefined) {
          if (body.modelAliases === null) {
            // Retour aux alias par defaut.
            deleteSetting(db, 'model_aliases');
            changed.push('modelAliases(reset)');
          } else {
            let aliases;
            try {
              aliases = normalizeModelAliases(body.modelAliases);
            } catch (err) {
              throw new HttpError(400, `Alias de modeles invalides : ${err.message}`, 'invalid_aliases');
            }
            setSetting(db, 'model_aliases', aliases);
            changed.push('modelAliases');
          }
        }

        if (body.globalBudgetUsd !== undefined) {
          const raw = body.globalBudgetUsd;
          if (raw === null || raw === '' || Number(raw) === 0) {
            saveGlobalBudgetUsd(db, 0);
            changed.push('globalBudgetUsd(desactive)');
          } else {
            const budget = Number(raw);
            if (!Number.isFinite(budget) || budget < 0 || budget > 10_000_000) {
              throw new HttpError(400, 'Budget global invalide (USD, 0 = desactive).', 'invalid_budget');
            }
            saveGlobalBudgetUsd(db, budget);
            changed.push('globalBudgetUsd');
          }
        }

        log.info(`Reglages mis a jour : ${changed.join(', ') || 'aucun changement'}.`);
        audit(req, 'settings.update', 'settings', changed.join(',') || 'aucun changement');
        sendJson(res, 200, { ok: true, settings: readSettingsView() });
        return;
      }

      if (route === '/settings/password' && method === 'POST') {
        const body = await readJsonBody(req, 16 * 1024);
        const currentPassword = String(body.currentPassword ?? '');
        const newPassword = String(body.newPassword ?? '');
        if (!checkAdminPassword(db, currentPassword)) {
          adminError(res, 401, 'Mot de passe actuel incorrect.', 'invalid_password');
          return;
        }
        if (newPassword.length < 12) {
          adminError(res, 400, 'Le nouveau mot de passe doit contenir au moins 12 caracteres.', 'weak_password');
          return;
        }
        changeAdminPassword(db, newPassword);
        deleteAllAdminSessions(db);
        const ttlMs = config.sessionHours * 3600 * 1000;
        const { token } = createAdminSession(db, ttlMs);
        setSessionCookie(req, res, token, Math.floor(ttlMs / 1000));
        audit(req, 'admin.password.change', 'admin');
        log.info('Mot de passe administrateur modifie.');
        sendJson(res, 200, { ok: true });
        return;
      }

      adminError(res, 404, 'Route inconnue.', 'not_found');
    } catch (err) {
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      if (err instanceof HttpError) {
        adminError(res, err.status, err.message, err.code);
        return;
      }
      log.error(`Erreur API admin [${req.requestId ?? '-'}] : ${err?.stack ?? err}`);
      adminError(res, 500, `Erreur interne. Reessayez. (ref ${req.requestId ?? '-'})`, 'internal_error');
    }
  }

  return { handle, readSettingsView };
}
