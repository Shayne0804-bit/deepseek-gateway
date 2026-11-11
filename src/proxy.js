import crypto from 'node:crypto';
import { computeCost, canonicalModelName, creditPricingModelFor, loadPricing, normalizeUsage } from './pricing.js';
import { loadModelAliases, publicModelIds, resolveModelAlias } from './model-aliases.js';
import {
  checkClientAccess,
  clampOutputTokens,
  ConcurrencyTracker,
  estimateUsage,
  findClientByApiKey,
  findClientByCliToken,
  isModelAllowed,
  maybeRollPeriod,
  RateLimiter,
  recordUsage,
  remainingFor,
} from './quota.js';
import { getSetting, clientCreditWindowSince, reserveCreditSlot, releaseCreditSlot } from './db.js';
import { globalBudgetStatus } from './settings.js';
import { Semaphore } from './limits.js';
import { toMicroUsd } from './money.js';
import { getPassPlan } from './plans.js';
import {
  bearerToken,
  corsHeaders,
  HttpError,
  readBody,
  sendApiError,
  sendJson,
} from './http-utils.js';
import { APP_VERSION } from './config.js';

/**
 * Chemins proxifies vers l'API DeepSeek. Le client peut utiliser
 * indifferemment `<base>/v1/...` ou `<base>/...` (compatibilite OpenAI SDK).
 */
const API_PREFIXES = [
  '/v1/',
  '/beta/',
  '/anthropic/',
  '/chat/completions',
  '/completions',
  '/responses',
  '/messages',
  '/models',
];

export function isProxyPath(pathname) {
  return API_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Normalise le chemin entrant :
 * - supprime les slashs multiples (base URL se terminant par « / ») ;
 * - redirige `/v1/messages` (format Anthropic envoye par Claude Code) vers
 *   `/anthropic/v1/messages`, chemin reel de l'API Anthropic de DeepSeek.
 */
export function normalizeProxyPath(rawPathname) {
  let pathname = String(rawPathname || '/').replace(/\/{2,}/g, '/');
  if (pathname === '/v1/messages' || pathname.startsWith('/v1/messages/')) {
    pathname = `/anthropic${pathname}`;
  }
  return pathname;
}

/** Vrai pour les endpoints de decouverte de modeles (OpenAI ou Anthropic). */
export function isModelsPath(pathname) {
  return pathname === '/models' || pathname === '/v1/models' || pathname === '/anthropic/v1/models';
}

/**
 * Construit la liste des modeles exposes par la passerelle :
 * modeles DeepSeek factures + alias configures (ex. claude-opus-5).
 * Anthropic ne fournit pas d'endpoint /models : on repond donc localement,
 * ce qui permet la decouverte de modeles par Claude Desktop et les SDK.
 */
function buildModelsPayload(pathname, req, pricing, aliases) {
  const ids = new Set(Object.keys(pricing.models ?? {}));
  for (const pattern of Object.keys(aliases ?? {})) {
    ids.add(pattern.endsWith('*') ? pattern.slice(0, -1) : pattern);
  }
  const modelIds = publicModelIds([...ids]);
  const nowSeconds = Math.floor(Date.now() / 1000);

  const anthropicFormat =
    pathname.startsWith('/anthropic') || Boolean(req.headers['anthropic-version']);
  if (anthropicFormat) {
    const createdAt = new Date().toISOString();
    const data = modelIds.map((id) => ({
      type: 'model',
      id,
      display_name: id,
      created_at: createdAt,
    }));
    return {
      data,
      has_more: false,
      first_id: data.length ? data[0].id : null,
      last_id: data.length ? data[data.length - 1].id : null,
    };
  }
  return {
    object: 'list',
    data: modelIds.map((id) => ({
      id,
      object: 'model',
      created: nowSeconds,
      owned_by: 'valaria-gateway',
    })),
  };
}

function quotaHeaders(client) {
  const left = remainingFor(client);
  const headers = {};
  if (left.tokens != null) headers['x-quota-tokens-remaining'] = String(left.tokens);
  if (left.requests != null) headers['x-quota-requests-remaining'] = String(left.requests);
  if (left.usd != null) headers['x-quota-usd-remaining'] = left.usd.toFixed(4);
  if (client.quotaTokens != null) headers['x-quota-tokens-limit'] = String(client.quotaTokens);
  if (client.quotaRequests != null) headers['x-quota-requests-limit'] = String(client.quotaRequests);
  headers['x-quota-period'] = client.period;
  return headers;
}

function truncate(text, max = 500) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function mergeUsageState(current, next) {
  if (!next) return current;
  if (!current) return { ...next };
  const merged = {
    prompt: Math.max(current.prompt ?? 0, next.prompt ?? 0),
    completion: Math.max(current.completion ?? 0, next.completion ?? 0),
    cacheHit: Math.max(current.cacheHit ?? 0, next.cacheHit ?? 0),
  };
  merged.total = merged.prompt + merged.completion;
  merged.cacheMiss = Math.max(0, merged.prompt - merged.cacheHit);
  return merged;
}

/** Extrait modele + usage d'une ligne SSE (`data: {...}`). */
function processSseLine(line, state) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return;
  let obj;
  try {
    obj = JSON.parse(payload);
  } catch {
    return;
  }
  const usage = obj?.usage ?? obj?.message?.usage ?? null;
  if (usage) state.usage = mergeUsageState(state.usage, normalizeUsage(usage));
  if (typeof obj?.model === 'string') state.model = obj.model;
  if (typeof obj?.message?.model === 'string') state.model = obj.message.model;
}

function readClientApiKey(req) {
  const bearer = bearerToken(req);
  if (bearer) return bearer;
  // Compatibilite avec les clients Anthropic qui envoient x-api-key.
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

export function createProxyHandler({ config, db, log, resolveProvider }) {
  const limiter = new RateLimiter();
  const concurrency = new ConcurrencyTracker();
  const globalConcurrency = new Semaphore(config.maxConcurrentRequests);

  function accessLog(req, client, status, tokens, cost, ms, pathname, modelLabel = null) {
    const modele = modelLabel ? ` | ${modelLabel}` : '';
    const ref = req.requestId ? `[${req.requestId}] ` : '';
    log.info(
      `${ref}${req.method} ${pathname} -> ${status} | ${tokens} tok | $${Number(cost).toFixed(5)} | ${ms} ms | ${client.name}${modele}`,
    );
  }

  async function handleProxy(req, res, url) {
    const startedAt = Date.now();
    const pathname = normalizeProxyPath(url.pathname);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    const cors = corsHeaders();

    // ---- 1. Authentification par cle derivee -------------------------
    const apiKey = readClientApiKey(req);
    if (!apiKey) {
      sendApiError(
        res,
        401,
        "Cle API manquante. Utilisez l'en-tete Authorization: Bearer <votre-cle>.",
        'authentication_error',
        'missing_api_key',
        cors,
      );
      return;
    }
    let client = apiKey.startsWith('vlt_')
      ? await findClientByCliToken(db, apiKey)
      : await findClientByApiKey(db, apiKey);
    if (!client) {
      sendApiError(
        res,
        401,
        "Cle API invalide ou revoquee. Demandez une nouvelle cle a l'administrateur.",
        'authentication_error',
        'invalid_api_key',
        cors,
      );
      return;
    }

    // La decouverte de modeles est une operation de connexion, pas une
    // requete facturee : elle doit fonctionner meme si le credit est epuise.
    // Claude Desktop refuse sinon la connexion avant meme d'envoyer un prompt.
    if (req.method === 'GET' && isModelsPath(pathname)) {
      const pricingValue = await getSetting(db, 'pricing', null);
      const aliasesValue = await getSetting(db, 'model_aliases', null);
      sendJson(res, 200, buildModelsPayload(pathname, req, loadPricing(() => pricingValue), loadModelAliases(() => aliasesValue)), {
        ...cors,
        'cache-control': 'public, max-age=60',
      });
      return;
    }

    // ---- 2. Remise a zero de periode + droits -------------------------
    client = await maybeRollPeriod(db, client);
    const denied = checkClientAccess(client);
    if (denied) {
      log.warn(`Quota/refus ${client.name} (${denied.code})`);
      sendApiError(res, denied.status, denied.message, denied.type, denied.code, cors);
      return;
    }

    const walletMicroUsd = Number(client.walletMicroUsd ?? 0);
    const passExpired = Boolean(client.expiresAt && new Date(client.expiresAt).getTime() <= Date.now());
    const passQuotaExhausted = (client.quotaUsd != null && client.usedUsd >= client.quotaUsd - 1e-9)
      || (client.quotaRequests != null && client.usedRequests >= client.quotaRequests)
      || (client.quotaTokens != null && client.usedTokens >= client.quotaTokens);
    const useWallet = walletMicroUsd > 0 && (passExpired || passQuotaExhausted);

    // ---- 3. Limites de debit ------------------------------------------
    if (client.rpmLimit != null) {
      const rate = limiter.hit(client.id, client.rpmLimit);
      if (!rate.ok) {
        sendApiError(
          res,
          429,
          `Limite de ${client.rpmLimit} requetes/minute atteinte. Reessayez dans ${rate.retryAfter} s.`,
          'rate_limit_error',
          'rate_limit_exceeded',
          { ...cors, 'retry-after': String(rate.retryAfter) },
        );
        return;
      }
    }

    const hasConcurrencyLimit = client.concurrencyLimit != null;
    if (hasConcurrencyLimit && !concurrency.acquire(client.id, client.concurrencyLimit)) {
      sendApiError(
        res,
        429,
        `Trop de requetes simultanees (limite ${client.concurrencyLimit}).`,
        'rate_limit_error',
        'concurrency_limit_exceeded',
        cors,
      );
      return;
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (hasConcurrencyLimit) concurrency.release(client.id);
    };

    const responseHeaders = { ...cors, ...quotaHeaders(client) };

    // ---- 3 bis. Plafond glissant de credit site (5 h par defaut) -------
    const plan = useWallet ? null : getPassPlan(client.plan);
    let credit5hUsed = 0;
    let creditWeekUsed = 0;
    const windowLimit = Number(plan?.credit5hLimit ?? 0);
    if (windowLimit > 0) {
      const windowHours = config.siteCreditWindowHours || 5;
      const sinceIso = new Date(Date.now() - windowHours * 3_600_000).toISOString();
      const win = await clientCreditWindowSince(db, client.id, sinceIso);
      credit5hUsed = win.total;
      if (win.total >= windowLimit) {
        const oldestMs = win.oldest ? Date.parse(win.oldest) : NaN;
        const retryAfter = Number.isFinite(oldestMs)
          ? Math.max(1, Math.ceil((oldestMs + windowHours * 3_600_000 - Date.now()) / 1000))
          : 300;
        release();
        log.warn(`[${req.requestId ?? '-'}] Plafond credit ${windowHours} h atteint pour ${client.name}.`);
        sendApiError(
          res,
          429,
          `Plafond de credit atteint sur ${windowHours} h (${windowLimit.toFixed(2)} $). Reessayez dans ${Math.ceil(retryAfter / 60)} min.`,
          'rate_limit_error',
          'credit_window_exceeded',
          { ...responseHeaders, 'retry-after': String(retryAfter) },
        );
        return;
      }
    }

    const pricingValue = await getSetting(db, 'pricing', null);

    // ---- 3 ter. Plafond glissant hebdomadaire (7 jours) ----------------
    const weeklyLimit = Number(plan?.creditWeeklyLimit ?? 0);
    if (weeklyLimit > 0) {
      const sinceIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const win = await clientCreditWindowSince(db, client.id, sinceIso);
      creditWeekUsed = win.total;
      if (win.total >= weeklyLimit) {
        const oldestMs = win.oldest ? Date.parse(win.oldest) : NaN;
        const retryAfter = Number.isFinite(oldestMs)
          ? Math.max(1, Math.ceil((oldestMs + 7 * 86_400_000 - Date.now()) / 1000))
          : 3600;
        release();
        log.warn(`[${req.requestId ?? '-'}] Plafond hebdomadaire atteint pour ${client.name}.`);
        sendApiError(
          res,
          429,
          `Plafond hebdomadaire de crédit atteint (${weeklyLimit.toFixed(2)} $). Réessayez dans ${Math.ceil(retryAfter / 3600)} h.`,
          'rate_limit_error',
          'credit_week_exceeded',
          { ...responseHeaders, 'retry-after': String(retryAfter) },
        );
        return;
      }
    }
    const aliasesValue = await getSetting(db, 'model_aliases', null);
    const pricing = loadPricing(() => pricingValue);
    const modelAliases = loadModelAliases(() => aliasesValue);

    let recorded = false;
    let reservedCreditId = null;
    let reservedCreditMicro = 0;
    const releaseReserved = async () => {
      const id = reservedCreditId;
      reservedCreditId = null;
      reservedCreditMicro = 0;
      if (id) await releaseCreditSlot(db, id);
    };
    // Nom de modele demande par le client quand il differe du modele facture
    // (ex. fable-5.1 -> deepseek-flash), pour un journal de facturation reel.
    let logRequestedModel = null;
    let creditPricingModel = null;
    const record = async (opts) => {
      if (recorded) return;
      recorded = true;
      try {
        const realCost = Number(opts.costUsd) || 0;
        const billedCost = Math.round(realCost * config.siteCreditRate * 1e6) / 1e6;
        await recordUsage(db, client.id, {
          model: opts.model ?? null,
          requestedModel: opts.requestedModel ?? logRequestedModel,
          usage: opts.usage ?? null,
          costUsd: billedCost,
          walletMicroUsd: useWallet ? Math.round(billedCost * 1_000_000) : 0,
          status: opts.status ?? 0,
          streamed: Boolean(opts.streamed),
          estimated: Boolean(opts.estimated),
          latencyMs: Date.now() - startedAt,
          error: opts.error ? truncate(opts.error) : null,
        });
      } catch (err) {
        log.error(`[${req.requestId ?? '-'}] Ecriture du journal impossible : ${err.message}`);
      } finally {
        await releaseReserved();
      }
    };

    // Garde-fou global anti-surcharge (production, tous clients confondus).
    if (!globalConcurrency.tryAcquire()) {
      log.warn(`[${req.requestId ?? '-'}] Plafond global de requetes simultanees atteint.`);
      sendApiError(
        res,
        503,
        'Passerelle surchargee. Reessayez dans un instant.',
        'rate_limit_error',
        'gateway_overloaded',
        { ...cors, 'retry-after': '2' },
      );
      return;
    }
    const releaseAll = () => {
      release();
      globalConcurrency.release();
    };

    try {
      // ---- 4. Decouverte de modeles : deja traitee avant les quotas ----

      // Garde-fou budget global mensuel (production, multi-utilisateurs).
      if (req.method !== 'GET') {
        const budget = await globalBudgetStatus(db);
        if (budget.exceeded) {
          log.warn(
            `[${req.requestId ?? '-'}] Budget global mensuel atteint (${budget.spentUsd} / ${budget.limitUsd} USD).`,
          );
          sendApiError(
            res,
            429,
            `Budget global mensuel atteint (${budget.spentUsd.toFixed(2)} $ / ${budget.limitUsd.toFixed(2)} $). Contactez l'administrateur.`,
            'insufficient_quota',
            'global_budget_exceeded',
            { ...responseHeaders, 'retry-after': '3600' },
          );
          return;
        }
      }

      // ---- 5. Lecture et validation du corps --------------------------
      let rawBody = null;
      let body = null;
      let isChatLike = false;
      if (req.method === 'POST') {
        rawBody = await readBody(
          req,
          config.maxBodyBytes,
          "Augmentez MAX_BODY_BYTES si votre client envoie de gros contextes ou des images.",
        );
        if (rawBody.trim()) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            throw new HttpError(400, 'Corps JSON invalide.', 'invalid_json');
          }
          if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            throw new HttpError(400, 'Le corps JSON doit etre un objet.', 'invalid_json');
          }
          // Alias de modele (« deguisement ») puis anciens noms DeepSeek -> nom canonique.
          // Puis forcage eventuel : par defaut, TOUT est reellement servi par deepseek-flash,
          // meme si le client demande deepseek-v4-pro ou un alias Claude. Le modele demande
          // reste trace (en-tetes + journal) pour la transparence.
          let bodyMutated = false;
          const requestedModel = typeof body.model === 'string' ? body.model : null;
          const aliasedModel = resolveModelAlias(requestedModel, modelAliases);
          const model = config.billedModel || canonicalModelName(aliasedModel);
          if (model && body.model !== model) {
            body.model = model;
            bodyMutated = true;
            if (requestedModel) {
              logRequestedModel = requestedModel;
              creditPricingModel = creditPricingModelFor(requestedModel, model, config.aliasPremiumBilling);
            }
            responseHeaders['x-gateway-billed-model'] = model;
            if (requestedModel && model !== requestedModel) {
              responseHeaders['x-gateway-requested-model'] = requestedModel;
            }
          }
          const modelAllowed =
            isModelAllowed(client, model) ||
            (requestedModel ? isModelAllowed(client, requestedModel) : true);
          if (!modelAllowed) {
            const converted = model !== requestedModel ? ` (converti en ${model})` : '';
            sendApiError(
              res,
              403,
              `Modele non autorise pour cette cle : ${requestedModel ?? model}${converted}. Modeles autorises : ${client.allowedModels.join(', ')}.`,
              'permission_error',
              'model_not_allowed',
              responseHeaders,
            );
            return;
          }
          if (clampOutputTokens(body, client)) bodyMutated = true;
          // Re-serialisation uniquement si necessaire (gros corps : evite un pic memoire inutile).
          if (bodyMutated) rawBody = JSON.stringify(body);
          isChatLike =
            pathname.includes('/completions') ||
            pathname.includes('/responses') ||
            pathname.includes('/messages');
        }
      }

      // ---- 5. Cle originale cote fournisseur --------------------------
      // Reservation de credit avant l'appel : empeche deux requetes
      // concurrentes de franchir le meme plafond avant l'enregistrement.
      if (req.method === 'POST' && body) {
        const explicitMax = Number(body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens ?? 0);
        let maxOut = Math.max(1, Number.isFinite(explicitMax) && explicitMax > 0
          ? Math.floor(explicitMax)
          : Math.floor(client.maxOutputTokens ?? 4096));
        const promptEstimate = estimateUsage(rawBody ?? '', 0).prompt;
        const priceModel = creditPricingModel ?? body.model ?? null;
        // Claude Desktop envoie de tres gros contextes caches : reserver tout
        // le prompt au prix cache-miss bloquait des requetes valides.
        const estimatedCacheHit = Math.floor(promptEstimate * config.reservationCacheHitRatio);
        const promptReal = computeCost(
          {
            prompt: promptEstimate,
            completion: 0,
            total: promptEstimate,
            cacheHit: estimatedCacheHit,
            cacheMiss: Math.max(0, promptEstimate - estimatedCacheHit),
          },
          priceModel,
          pricing,
        );
        const promptCredit = promptReal * config.siteCreditRate;
        const totalRoom = useWallet ? walletMicroUsd / 1_000_000 : (client.quotaUsd == null ? Infinity : Math.max(0, client.quotaUsd - client.usedUsd));
        const fiveRoom = plan?.credit5hLimit == null ? Infinity : Math.max(0, plan.credit5hLimit - credit5hUsed);
        const weekRoom = plan?.creditWeeklyLimit == null ? Infinity : Math.max(0, plan.creditWeeklyLimit - creditWeekUsed);
        const room = Math.min(totalRoom, fiveRoom, weekRoom);
        if (promptCredit > room + 1e-9) {
          const code = fiveRoom <= totalRoom && fiveRoom <= weekRoom
            ? 'credit_window_exceeded'
            : weekRoom <= totalRoom
              ? 'credit_week_exceeded'
              : 'insufficient_quota';
          release();
          sendApiError(
            res,
            429,
            `Credit insuffisant pour cette requete (entree estimee ${promptCredit.toFixed(4)} $, disponible ${Math.max(0, room).toFixed(4)} $).`,
            code === 'insufficient_quota' ? 'insufficient_quota' : 'rate_limit_error',
            code,
            { ...responseHeaders, 'retry-after': '60' },
          );
          return;
        }
        // Plafonne la sortie a ce que le credit restant peut payer, au lieu
        // de refuser une requete sur la base de la sortie maximale theorique.
        const outputUnitReal = computeCost(
          { prompt: 0, completion: 1_000_000, total: 1_000_000, cacheHit: 0, cacheMiss: 0 },
          priceModel,
          pricing,
        );
        const outputCreditPerToken = (outputUnitReal * config.siteCreditRate) / 1_000_000;
        if (outputCreditPerToken > 0 && room !== Infinity) {
          const affordableOut = Math.floor((room - promptCredit) / outputCreditPerToken);
          if (affordableOut < 1) {
            release();
            sendApiError(res, 429, 'Credit insuffisant pour produire une reponse.', 'insufficient_quota', 'insufficient_quota', responseHeaders);
            return;
          }
          if (affordableOut < maxOut) {
            maxOut = affordableOut;
            const maxKey = ['max_tokens', 'max_completion_tokens', 'max_output_tokens'].find((key) => body[key] != null)
              ?? (pathname.includes('/responses') ? 'max_output_tokens' : 'max_tokens');
            body[maxKey] = maxOut;
            rawBody = JSON.stringify(body);
          }
        }
        const maxUsage = { prompt: promptEstimate, completion: maxOut, total: promptEstimate + maxOut, cacheHit: 0, cacheMiss: promptEstimate };
        const realEstimate = computeCost(maxUsage, priceModel, pricing);
        const creditEstimate = Math.round(realEstimate * config.siteCreditRate * 1e6) / 1e6;
        const amountMicro = toMicroUsd(creditEstimate);
        const availableMicro = room === Infinity ? Number.MAX_SAFE_INTEGER : Math.max(0, toMicroUsd(room));
        const reservationId = crypto.randomUUID();
        const reserved = await reserveCreditSlot(db, { id: reservationId, clientId: client.id, amountMicroUsd: amountMicro, availableMicroUsd: availableMicro, ttlMs: config.upstreamTimeoutMs + 60_000 });
        if (!reserved) {
          release();
          sendApiError(
            res,
            429,
            'Trop de requetes simultanees pour votre credit restant. Reessayez dans un instant.',
            'rate_limit_error',
            'credit_reservation_conflict',
            { ...responseHeaders, 'retry-after': '2' },
          );
          return;
        }
        reservedCreditId = reservationId;
        reservedCreditMicro = amountMicro;
      }

      const provider = await resolveProvider(db, config);
      if (!provider.apiKey) {
        log.error("Cle API DeepSeek originale non configuree.");
        sendApiError(
          res,
          503,
          "La passerelle n'est pas encore configuree : cle API DeepSeek originale manquante. Contactez l'administrateur.",
          'api_error',
          'provider_not_configured',
          responseHeaders,
        );
        return;
      }

      // ---- 6. Appel de l'API DeepSeek ---------------------------------
      const upstreamHeaders = {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`,
        'user-agent': `valaria-gateway/${APP_VERSION}`,
      };
      if (req.headers.accept) upstreamHeaders.accept = String(req.headers.accept);

      const controller = new AbortController();
      let clientGone = false;
      const timeout = setTimeout(
        () => controller.abort(new Error('upstream_timeout')),
        config.upstreamTimeoutMs,
      );
      const onResClose = () => {
        if (!res.writableEnded) {
          clientGone = true;
          controller.abort(new Error('client_aborted'));
        }
      };
      res.once('close', onResClose);

      const modelFromRequest = typeof body?.model === 'string' ? body.model : null;
      let streamState = { usage: null, model: modelFromRequest };
      let bytesStreamed = 0;
      let upstreamRes = null;

      try {
        upstreamRes = await fetch(`${provider.baseUrl}${pathname}${url.search}`, {
          method: req.method,
          headers: upstreamHeaders,
          body: req.method === 'POST' ? rawBody ?? '' : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeout);
        res.off('close', onResClose);
        const aborted = err?.name === 'AbortError';
        if (aborted && clientGone) {
          await record({
            model: modelFromRequest,
            usage: estimateUsage(rawBody ?? '', bytesStreamed),
            costUsd: computeCost(estimateUsage(rawBody ?? '', bytesStreamed), creditPricingModel ?? modelFromRequest, pricing),
            status: 0,
            streamed: true,
            estimated: true,
            error: 'client_aborted',
          });
          if (!res.headersSent) res.destroy();
          else if (!res.writableEnded) res.end();
          return;
        }
        if (aborted) {
          await record({ model: modelFromRequest, status: 0, error: 'upstream_timeout' });
          sendApiError(
            res,
            504,
            "Delai depasse en attendant l'API DeepSeek.",
            'api_error',
            'upstream_timeout',
            responseHeaders,
          );
          return;
        }
        await record({ model: modelFromRequest, status: 0, error: err?.message ?? 'network_error' });
        log.error(`Passerelle amont injoignable : ${err?.message ?? err}`);
        sendApiError(
          res,
          502,
          "Impossible de joindre l'API DeepSeek. Reessayez plus tard.",
          'api_error',
          'upstream_unreachable',
          responseHeaders,
        );
        return;
      }

      const contentType = String(upstreamRes.headers.get('content-type') ?? 'application/json');
      const isEventStream = contentType.includes('text/event-stream');

      // ---- 7a. Reponse JSON classique --------------------------------
      if (!isEventStream) {
        let text = '';
        try {
          text = await upstreamRes.text();
        } catch (err) {
          clearTimeout(timeout);
          res.off('close', onResClose);
          if (err?.name === 'AbortError' && clientGone) {
            await record({
              model: modelFromRequest,
              usage: estimateUsage(rawBody ?? '', 0),
              costUsd: computeCost(estimateUsage(rawBody ?? '', 0), creditPricingModel ?? modelFromRequest, pricing),
              status: 0,
              estimated: true,
              error: 'client_aborted',
            });
            if (!res.headersSent) res.destroy();
            return;
          }
          throw err;
        }
        clearTimeout(timeout);
        res.off('close', onResClose);

        let payload = null;
        try {
          payload = JSON.parse(text);
        } catch {
          /* reponse non JSON : passee telle quelle */
        }
        const usage = payload?.usage ? normalizeUsage(payload.usage) : null;

        if (isChatLike && req.method === 'POST') {
          let billedUsage = usage;
          let estimated = false;
          if (!billedUsage && upstreamRes.ok) {
            billedUsage = estimateUsage(rawBody ?? '', text.length);
            estimated = true;
          }
          const cost = billedUsage ? computeCost(billedUsage, creditPricingModel ?? modelFromRequest ?? payload?.model, pricing) : 0;
          await record({
            model: modelFromRequest ?? payload?.model ?? null,
            usage: billedUsage,
            costUsd: cost,
            status: upstreamRes.status,
            streamed: false,
            estimated,
            error: upstreamRes.ok ? null : payload?.error?.message ?? text,
          });
          accessLog(
            req,
            client,
            upstreamRes.status,
            billedUsage?.total ?? 0,
            cost,
            Date.now() - startedAt,
            pathname,
            logRequestedModel ? `${logRequestedModel} -> ${modelFromRequest ?? payload?.model}` : modelFromRequest ?? payload?.model,
          );
        }

        if (res.headersSent) {
          if (!res.writableEnded) res.end();
          return;
        }
        res.writeHead(upstreamRes.status, {
          ...responseHeaders,
          'content-type': contentType,
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(text),
        });
        res.end(text);
        return;
      }

      // ---- 7b. Streaming SSE -----------------------------------------
      res.writeHead(upstreamRes.status, {
        ...responseHeaders,
        'content-type': contentType,
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      });
      res.flushHeaders?.();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        for await (const chunk of upstreamRes.body) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytesStreamed += buf.length;
          if (!res.writableEnded) res.write(buf);
          buffer += decoder.decode(buf, { stream: true });
          let newline;
          while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline).replace(/\r$/, '');
            buffer = buffer.slice(newline + 1);
            processSseLine(line, streamState);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) processSseLine(buffer, streamState);
      } catch (err) {
        clearTimeout(timeout);
        res.off('close', onResClose);
        const aborted = err?.name === 'AbortError';
        const usage = streamState.usage ?? estimateUsage(rawBody ?? '', bytesStreamed);
        const estimated = !streamState.usage;
        const cost = computeCost(usage, creditPricingModel ?? streamState.model, pricing);
        await record({
          model: streamState.model,
          usage,
          costUsd: cost,
          status: clientGone ? 0 : upstreamRes.status,
          streamed: true,
          estimated,
          error: clientGone ? 'client_aborted' : `stream_interrupted: ${err?.message ?? err}`,
        });
        accessLog(
          req,
          client,
          499,
          usage.total,
          cost,
          Date.now() - startedAt,
          pathname,
          logRequestedModel ? `${logRequestedModel} -> ${streamState.model}` : streamState.model,
        );
        if (!res.writableEnded) res.end();
        if (!aborted) log.warn(`Flux SSE interrompu : ${err?.message ?? err}`);
        return;
      }

      clearTimeout(timeout);
      res.off('close', onResClose);
      if (!res.writableEnded) res.end();

      const usage = streamState.usage ?? estimateUsage(rawBody ?? '', bytesStreamed);
      const estimated = !streamState.usage;
      const cost = computeCost(usage, creditPricingModel ?? streamState.model, pricing);
      await record({
        model: streamState.model,
        usage,
        costUsd: cost,
        status: upstreamRes.status,
        streamed: true,
        estimated,
        error: upstreamRes.ok ? null : 'upstream_error',
      });
      accessLog(
        req,
        client,
        upstreamRes.status,
        usage.total,
        cost,
        Date.now() - startedAt,
        pathname,
        logRequestedModel ? `${logRequestedModel} -> ${streamState.model}` : streamState.model,
      );
    } catch (err) {
      // Erreurs locales (corps invalide, etc.) : la requete n'est pas facturee.
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      if (err instanceof HttpError) {
        sendApiError(res, err.status, err.message, 'invalid_request_error', err.code, responseHeaders);
        return;
      }
      log.error(`[${req.requestId ?? '-'}] Erreur passerelle : ${err?.stack ?? err}`);
      sendApiError(
        res,
        500,
        `Erreur interne de la passerelle. Reessayez. (ref ${req.requestId ?? '-'})`,
        'api_error',
        'gateway_error',
        responseHeaders,
      );
    } finally {
      await releaseReserved();
      releaseAll();
    }
  }

  return handleProxy;
}




