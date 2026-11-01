/**
 * Tarification DeepSeek (USD par million de tokens) et estimation du cout.
 *
 * Tarifs publics de reference (2026) :
 *   deepseek-flash    : cache hit 0.003 / 0.006  $, cache miss 0.15 / 0.30 $, sortie 0.60 / 1.20 $
 *   deepseek-v4-pro   : cache hit 0.022 / 0.044  $, cache miss 0.66 / 1.32 $, sortie 1.98 / 3.96 $
 *   (off-peak / peak - les heures creuses sont a moitie prix)
 *
 * Heures pleines : 01:00-04:00 et 06:00-10:00 UTC, du lundi au vendredi,
 * hors jours feries chinois (liste configurable dans le panneau).
 * Ce calcul est une ESTIMATION destinee aux quotas, pas une facture.
 */

const num = (value, fallback = 0) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const DEFAULT_PRICING = {
  currency: 'USD',
  peakHoursUtc: [
    { start: 1, end: 4 },
    { start: 6, end: 10 },
  ],
  peakWeekdays: [1, 2, 3, 4, 5],
  holidays: [],
  fallbackModel: 'deepseek-flash',
  models: {
    'deepseek-flash': {
      cacheHit: { peak: 0.006, offpeak: 0.003 },
      cacheMiss: { peak: 0.3, offpeak: 0.15 },
      output: { peak: 1.2, offpeak: 0.6 },
    },
    'deepseek-v4-pro': {
      cacheHit: { peak: 0.044, offpeak: 0.022 },
      cacheMiss: { peak: 1.32, offpeak: 0.66 },
      output: { peak: 3.96, offpeak: 1.98 },
    },
  },
  // Anciens noms de modeles encore acceptes par l'API -> modele facture.
  aliases: {
    'deepseek-v4-flash': 'deepseek-flash',
    'deepseek-v4-flash-vision-exp': 'deepseek-flash',
    'deepseek-chat': 'deepseek-flash',
    'deepseek-reasoner': 'deepseek-v4-pro',
  },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Convertit un ancien nom de modele DeepSeek vers son nom canonique.
 * Ex : deepseek-v4-flash -> deepseek-flash, deepseek-chat -> deepseek-flash.
 * Conserve un eventuel suffixe de variante, ex. « deepseek-flash[1m] ».
 */
export function canonicalModelName(model) {
  if (typeof model !== 'string') return model;
  const bracket = model.indexOf('[');
  const base = bracket > 0 ? model.slice(0, bracket) : model;
  const suffix = bracket > 0 ? model.slice(bracket) : '';
  return (DEFAULT_PRICING.aliases[base] ?? base) + suffix;
}

/** Nom de modele sans suffixe de variante : « deepseek-flash[1m] » -> « deepseek-flash ». */
export function modelBaseName(model) {
  return canonicalModelName(model).replace(/\[[^\]]*\]$/, '');
}

/** Valide/normalise un objet de tarification venu du panneau. Lance une erreur si invalide. */
export function normalizePricing(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('La tarification doit etre un objet JSON.');
  }
  const models = {};
  const source = input.models && typeof input.models === 'object' ? input.models : DEFAULT_PRICING.models;
  for (const [name, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== 'object') throw new Error(`Modele "${name}" invalide.`);
    const normalized = {};
    for (const kind of ['cacheHit', 'cacheMiss', 'output']) {
      const pair = entry[kind];
      if (!pair || typeof pair !== 'object') throw new Error(`Modele "${name}" : "${kind}" manquant.`);
      normalized[kind] = {
        peak: num(pair.peak),
        offpeak: num(pair.offpeak),
      };
    }
    models[String(name)] = normalized;
  }
  if (Object.keys(models).length === 0) throw new Error('Au moins un modele doit etre tarifie.');

  const peakHoursUtc = Array.isArray(input.peakHoursUtc)
    ? input.peakHoursUtc
        .filter((w) => w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)))
        .map((w) => ({ start: clamp(Number(w.start), 0, 24), end: clamp(Number(w.end), 0, 24) }))
        .filter((w) => w.end > w.start)
    : DEFAULT_PRICING.peakHoursUtc;

  const peakWeekdays = Array.isArray(input.peakWeekdays)
    ? [...new Set(input.peakWeekdays.map(Number).filter((d) => d >= 0 && d <= 6))]
    : DEFAULT_PRICING.peakWeekdays;

  const holidays = Array.isArray(input.holidays)
    ? input.holidays.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];

  const fallbackModel =
    typeof input.fallbackModel === 'string' && input.fallbackModel.trim()
      ? input.fallbackModel.trim()
      : DEFAULT_PRICING.fallbackModel;

  const aliases = {};
  if (input.aliases && typeof input.aliases === 'object' && !Array.isArray(input.aliases)) {
    for (const [from, to] of Object.entries(input.aliases)) {
      if (typeof from === 'string' && typeof to === 'string') aliases[from] = to;
    }
  }

  return {
    currency: typeof input.currency === 'string' && input.currency.trim() ? input.currency.trim() : 'USD',
    peakHoursUtc,
    peakWeekdays,
    holidays,
    fallbackModel,
    models,
    aliases,
  };
}

export function loadPricing(getSetting) {
  const stored = getSetting();
  if (!stored) return DEFAULT_PRICING;
  try {
    return normalizePricing(stored);
  } catch {
    return DEFAULT_PRICING;
  }
}

export function peakWindowsLabel(pricing) {
  if (!pricing.peakHoursUtc?.length) return 'aucune';
  return pricing.peakHoursUtc
    .map((w) => `${String(w.start).padStart(2, '0')}:00–${String(w.end).padStart(2, '0')}:00 UTC`)
    .join(' et ');
}

/** Vrai si `now` tombe dans une plage de tarification pleine. */
export function isPeak(now, pricing = DEFAULT_PRICING) {
  const weekday = now.getUTCDay();
  if (!(pricing.peakWeekdays ?? DEFAULT_PRICING.peakWeekdays).includes(weekday)) return false;
  const isoDay = now.toISOString().slice(0, 10);
  if ((pricing.holidays ?? []).includes(isoDay)) return false;
  const hour = now.getUTCHours();
  return (pricing.peakHoursUtc ?? []).some((w) => hour >= w.start && hour < w.end);
}

export function resolveModelPrice(model, pricing = DEFAULT_PRICING) {
  const models = pricing.models ?? DEFAULT_PRICING.models;
  const aliases = pricing.aliases ?? DEFAULT_PRICING.aliases;
  // On ignore un eventuel suffixe de variante : deepseek-flash[1m] -> deepseek-flash.
  const name = typeof model === 'string' ? model.replace(/\[[^\]]*\]$/, '') : '';
  const direct = models[name];
  if (direct) return direct;
  const aliased = aliases[name];
  if (aliased && models[aliased]) return models[aliased];
  const fallback = models[pricing.fallbackModel ?? DEFAULT_PRICING.fallbackModel];
  return fallback ?? models[DEFAULT_PRICING.fallbackModel] ?? Object.values(models)[0];
}

/**
 * Normalise un objet `usage` OpenAI ou Anthropic vers
 * { prompt, completion, total, cacheHit, cacheMiss }.
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;

  if (usage.prompt_tokens != null || usage.completion_tokens != null) {
    const prompt = num(usage.prompt_tokens);
    const completion = num(usage.completion_tokens);
    const rawHit = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
    const hit = Math.min(num(rawHit), prompt);
    const missProvided = usage.prompt_cache_miss_tokens;
    const miss = missProvided != null ? Math.min(num(missProvided), prompt) : prompt - hit;
    return {
      prompt,
      completion,
      total: prompt + completion,
      cacheHit: hit,
      cacheMiss: miss,
    };
  }

  if (usage.input_tokens != null || usage.output_tokens != null) {
    const input = num(usage.input_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);
    const cacheWrite = num(usage.cache_creation_input_tokens);
    const prompt = input + cacheRead + cacheWrite;
    const completion = num(usage.output_tokens);
    return {
      prompt,
      completion,
      total: prompt + completion,
      cacheHit: cacheRead,
      cacheMiss: prompt - cacheRead,
    };
  }

  return null;
}

/** Cout estime en USD pour une utilisation donnee. */
export function computeCost(usage, model, pricing = DEFAULT_PRICING, now = new Date()) {
  const normalized = usage && usage.total != null ? usage : normalizeUsage(usage);
  if (!normalized) return 0;
  const table = resolveModelPrice(model, pricing);
  if (!table) return 0;
  const period = isPeak(now, pricing) ? 'peak' : 'offpeak';
  const hitPrice = num(table.cacheHit?.[period]);
  const missPrice = num(table.cacheMiss?.[period]);
  const outputPrice = num(table.output?.[period]);
  const cost =
    (normalized.cacheMiss / 1e6) * missPrice +
    (normalized.cacheHit / 1e6) * hitPrice +
    (normalized.completion / 1e6) * outputPrice;
  return Math.round(cost * 1e6) / 1e6;
}
