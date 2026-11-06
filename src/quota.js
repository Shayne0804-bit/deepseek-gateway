import { hashApiKey, sha256 } from './auth.js';
import {
  getCliTokenByHash,
  getClientById,
  getClientByKeyHash,
  insertUsageAndUpdateClient,
  resetClientUsage,
  touchCliToken,
} from './db.js';
import { canonicalModelName, modelBaseName } from './pricing.js';

export const PERIODS = ['daily', 'monthly', 'total'];

export function normalizePeriod(period) {
  return PERIODS.includes(period) ? period : 'monthly';
}

/** Cle de periode : '2026-10-31' (jour), '2026-10' (mois), 'all' (total). */
export function periodKeyFor(period, now = new Date()) {
  if (period === 'daily') return now.toISOString().slice(0, 10);
  if (period === 'monthly') return now.toISOString().slice(0, 7);
  return 'all';
}

export function periodLabel(period) {
  if (period === 'daily') return 'Par jour';
  if (period === 'monthly') return 'Par mois';
  return 'Total (sans remise a zero)';
}

/**
 * Remet les compteurs a zero si la periode est terminee.
 * Retourne le client a jour (objet en memoire, pas de deuxieme lecture).
 */
export async function maybeRollPeriod(db, client, now = new Date()) {
  const expected = periodKeyFor(client.period, now);
  if (client.periodStart === expected) return client;
  await resetClientUsage(db, client.id, expected);
  return { ...client, usedTokens: 0, usedRequests: 0, usedUsd: 0, periodStart: expected };
}

export function remainingFor(client) {
  return {
    tokens: client.quotaTokens == null ? null : Math.max(0, client.quotaTokens - client.usedTokens),
    requests:
      client.quotaRequests == null ? null : Math.max(0, client.quotaRequests - client.usedRequests),
    usd: client.quotaUsd == null ? null : Math.max(0, client.quotaUsd - client.usedUsd),
  };
}

/** Verifie qu'une cle derivee peut encore emettre une requete. */
export function checkClientAccess(client, now = new Date()) {
  if (!client.enabled) {
    return {
      status: 403,
      type: 'permission_error',
      code: 'client_disabled',
      message: 'Cette cle API a ete desactivee par l administrateur.',
    };
  }
  if (client.expiresAt && new Date(client.expiresAt).getTime() <= now.getTime()) {
    return {
      status: 403,
      type: 'permission_error',
      code: 'client_expired',
      message: `Cette cle API a expire le ${client.expiresAt}.`,
    };
  }
  if (client.quotaRequests != null && client.usedRequests >= client.quotaRequests) {
    return {
      status: 429,
      type: 'insufficient_quota',
      code: 'insufficient_quota',
      message: `Quota de requetes epuise (${client.quotaRequests} requetes par ${client.period}).`,
    };
  }
  if (client.quotaTokens != null && client.usedTokens >= client.quotaTokens) {
    return {
      status: 429,
      type: 'insufficient_quota',
      code: 'insufficient_quota',
      message: `Quota de tokens epuise (${client.quotaTokens} tokens par ${client.period}).`,
    };
  }
  if (client.quotaUsd != null && client.usedUsd >= client.quotaUsd - 1e-9) {
    return {
      status: 429,
      type: 'insufficient_quota',
      code: 'insufficient_quota',
      message: `Quota de cout epuise (${client.quotaUsd} USD par ${client.period}).`,
    };
  }
  return null;
}

/**
 * Limite le nombre de tokens de sortie demande par le client :
 * plafond configure + tokens restants sur le quota (pour eviter un depassement massif).
 * Retourne true si le corps a ete modifie (evite une re-serialisation inutile).
 */
export function clampOutputTokens(body, client) {
  const keys = ['max_tokens', 'max_completion_tokens'];
  let remaining = null;
  if (client.quotaTokens != null) {
    remaining = Math.max(0, client.quotaTokens - client.usedTokens);
  }
  let changed = false;
  for (const key of keys) {
    if (body[key] == null) continue;
    const original = body[key];
    let value = Number(original);
    if (!Number.isFinite(value) || value < 1) {
      value = 1;
    }
    if (client.maxOutputTokens != null) value = Math.min(value, client.maxOutputTokens);
    if (remaining != null) value = Math.min(value, Math.max(1, Math.floor(remaining)));
    const clamped = Math.floor(value);
    if (clamped !== original) {
      body[key] = clamped;
      changed = true;
    }
  }
  return changed;
}

export function isModelAllowed(client, model) {
  if (!model) return true;
  if (!Array.isArray(client.allowedModels) || client.allowedModels.length === 0) return true;
  // Compare les noms canoniques, sans suffixe de variante ([1m], ...).
  const target = modelBaseName(model);
  return client.allowedModels.some((allowed) => modelBaseName(allowed) === target);
}

/* ------------------------------ rate limits ----------------------------- */

/** Limite simple de requetes/minute par client (fenetre glissante, en memoire). */
export class RateLimiter {
  constructor(nowFn = Date.now) {
    this.now = nowFn;
    this.map = new Map();
  }

  hit(clientId, limitPerMinute) {
    const now = this.now();
    const windowStart = now - 60_000;
    const list = (this.map.get(clientId) ?? []).filter((t) => t > windowStart);
    if (list.length >= limitPerMinute) {
      this.map.set(clientId, list);
      const retryAfter = Math.max(1, Math.ceil((list[0] + 60_000 - now) / 1000));
      return { ok: false, retryAfter, remaining: 0 };
    }
    list.push(now);
    this.map.set(clientId, list);
    return { ok: true, retryAfter: 0, remaining: limitPerMinute - list.length };
  }

  prune() {
    const windowStart = this.now() - 60_000;
    for (const [key, list] of this.map) {
      const kept = list.filter((t) => t > windowStart);
      if (kept.length) this.map.set(key, kept);
      else this.map.delete(key);
    }
  }
}

/** Limite de requetes simultanees par client. */
export class ConcurrencyTracker {
  constructor() {
    this.map = new Map();
  }

  acquire(clientId, limit) {
    const current = this.map.get(clientId) ?? 0;
    if (current >= limit) return false;
    this.map.set(clientId, current + 1);
    return true;
  }

  release(clientId) {
    const current = this.map.get(clientId) ?? 0;
    if (current <= 1) this.map.delete(clientId);
    else this.map.set(clientId, current - 1);
  }
}

/* -------------------------------- usage --------------------------------- */

/** Estime l'usage quand l'amont ne fournit pas de statistiques (deconnexion, erreur...). */
export function estimateUsage(inputText, outputBytes) {
  const prompt = Math.max(1, Math.ceil(String(inputText ?? '').length / 4));
  const completion = Math.max(0, Math.ceil(Number(outputBytes ?? 0) / 4));
  return {
    prompt,
    completion,
    total: prompt + completion,
    cacheHit: 0,
    cacheMiss: prompt,
  };
}

/**
 * Enregistre une requete dans les journaux et met a jour les compteurs du client.
 * `usage` peut etre null (aucun token facture, mais la requete compte).
 */
export async function recordUsage(
  db,
  clientId,
  {
    model = null,
    requestedModel = null,
    usage = null,
    costUsd = 0,
    status = 0,
    streamed = false,
    estimated = false,
    latencyMs = null,
    error = null,
    now = new Date(),
  } = {},
) {
  const promptTokens = Math.max(0, Math.round(usage?.prompt ?? 0));
  const completionTokens = Math.max(0, Math.round(usage?.completion ?? 0));
  const totalTokens = Math.max(0, Math.round(usage?.total ?? promptTokens + completionTokens));
  const cost = Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
  const createdAt = now.toISOString();

  await insertUsageAndUpdateClient(db, {
    clientId,
    model,
    requestedModel,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: cost,
    status,
    streamed,
    estimated,
    latencyMs,
    error,
    createdAt,
  });
}

/** Retrouve un client a partir de la cle presentee par l'appelant. */
export async function findClientByApiKey(db, apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return null;
  return getClientByKeyHash(db, hashApiKey(apiKey));
}

/**
 * Resout un jeton d'appareil CLI (vlt_...) vers le client qui l'a approuve.
 * Un jeton expire, revoque ou inconnu est refuse. last_used_at est mis a jour.
 */
export async function findClientByCliToken(db, token) {
  if (!token || typeof token !== 'string' || !token.startsWith('vlt_')) return null;
  const row = await getCliTokenByHash(db, sha256(token));
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  const client = await getClientById(db, row.client_id);
  if (!client) return null;
  await touchCliToken(db, row.id, new Date().toISOString());
  return client;
}
