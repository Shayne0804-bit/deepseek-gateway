/**
 * Catalogue des pass VALARIA Gateway API.
 *
 * Les montants sont ceux valides avec l'administrateur : le pass est un acces
 * de 30 jours, sans reconduction automatique, arrete a la date ou au quota.
 * Les quotas sont en USD pour le credit et en nombre de requetes.
 */
export const PASS_PLANS = Object.freeze([
  {
    id: 'decouverte',
    name: 'Découverte',
    tagline: 'Pour tester et partager un premier accès.',
    priceEur: 3.9,
    durationDays: 30,
    quotaRequests: 1000,
    quotaUsd: 2.5,
    rpmLimit: 20,
    concurrencyLimit: 2,
    maxOutputTokens: 4096,
    keys: 1,
    support: 'Email sous 72 h',
    features: ['1 000 requêtes', '2,50 € de crédit', '20 req/min'],
  },
  {
    id: 'createur',
    name: 'Créateur',
    tagline: 'Pour un usage régulier, projets et prototypes.',
    priceEur: 11.9,
    durationDays: 30,
    quotaRequests: 4000,
    quotaUsd: 8,
    rpmLimit: 60,
    concurrencyLimit: 3,
    maxOutputTokens: 8192,
    keys: 3,
    support: 'Email sous 48 h',
    features: ['4 000 requêtes', '8 € de crédit', '60 req/min'],
  },
  {
    id: 'equipe',
    name: 'Équipe',
    tagline: 'Pour plusieurs personnes sur un même projet.',
    priceEur: 29.9,
    durationDays: 30,
    quotaRequests: 10000,
    quotaUsd: 20,
    rpmLimit: 150,
    concurrencyLimit: 6,
    maxOutputTokens: 16384,
    keys: 8,
    support: 'Support prioritaire 24 h',
    features: ['10 000 requêtes', '20 € de crédit', '150 req/min'],
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'Pour une utilisation intensive avec engagement.',
    priceEur: 79,
    durationDays: 30,
    quotaRequests: 25000,
    quotaUsd: 55,
    rpmLimit: 400,
    concurrencyLimit: 12,
    maxOutputTokens: 32768,
    keys: 25,
    support: 'Support dédié + SLA 99,5 %',
    features: ['25 000 requêtes', '55 € de crédit', '400 req/min'],
  },
]);

export const PASS_PLAN_IDS = Object.freeze(PASS_PLANS.map((plan) => plan.id));

export function getPassPlan(id) {
  if (!id) return null;
  return PASS_PLANS.find((plan) => plan.id === id) ?? null;
}

export function isPassPlanId(id) {
  return Boolean(getPassPlan(id));
}

/** Champs a appliquer a un client lorsqu'un pass est choisi. */
export function passPlanFields(id, now = new Date()) {
  const plan = getPassPlan(id);
  if (!plan) return null;
  const expiresAt = new Date(now.getTime() + plan.durationDays * 86_400_000).toISOString();
  return {
    plan: plan.id,
    quotaTokens: null,
    quotaRequests: plan.quotaRequests,
    quotaUsd: plan.quotaUsd,
    period: 'total',
    rpmLimit: plan.rpmLimit,
    concurrencyLimit: plan.concurrencyLimit,
    maxOutputTokens: plan.maxOutputTokens,
    expiresAt,
  };
}

export function publicPlan(plan) {
  return { ...plan, features: [...plan.features] };
}

