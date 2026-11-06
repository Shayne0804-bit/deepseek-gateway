/**
 * Catalogue des pass VALARIA Gateway API.
 *
 * Les montants sont exprimes en dollars de CREDIT SITE (pas en cout reel).
 * Un pass s'arrete a la date, au credit site ou au quota de requetes (premier atteint).
 * `credit5hLimit` est le plafond glissant de credit site sur 5 heures.
 */
export const PASS_PLANS = Object.freeze([
  {
    id: 'decouverte',
    name: 'Découverte',
    tagline: 'Pour tester et partager un premier accès.',
    priceEur: 3.9,
    durationDays: 7,
    quotaRequests: null,
    quotaUsd: 5,
    credit5hLimit: 0.45,
    creditWeeklyLimit: 5,
    rpmLimit: 20,
    concurrencyLimit: 2,
    maxOutputTokens: 4096,
    keys: 1,
    support: 'Email sous 72 h',
    features: ['7 jours renouvelables', '5 $ de crédit site', '0,45 $ max / 5 h', '5 $ max / semaine'],
  },
  {
    id: 'createur',
    name: 'Créateur',
    tagline: 'Pour un usage régulier, projets et prototypes.',
    priceEur: 11.9,
    durationDays: 14,
    quotaRequests: null,
    quotaUsd: 15,
    credit5hLimit: 0.7,
    creditWeeklyLimit: 7.5,
    rpmLimit: 60,
    concurrencyLimit: 3,
    maxOutputTokens: 8192,
    keys: 3,
    support: 'Email sous 48 h',
    features: ['14 jours renouvelables', '15 $ de crédit site', '0,70 $ max / 5 h', '7,50 $ max / semaine'],
  },
  {
    id: 'equipe',
    name: 'Équipe',
    tagline: 'Pour plusieurs personnes sur un même projet.',
    priceEur: 29.9,
    durationDays: 30,
    quotaRequests: null,
    quotaUsd: 40,
    credit5hLimit: 0.9,
    creditWeeklyLimit: 10,
    rpmLimit: 150,
    concurrencyLimit: 6,
    maxOutputTokens: 16384,
    keys: 8,
    support: 'Support prioritaire 24 h',
    features: ['30 jours renouvelables', '40 $ de crédit site', '0,90 $ max / 5 h', '10 $ max / semaine'],
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'Pour une utilisation intensive avec engagement.',
    priceEur: 79,
    durationDays: 30,
    quotaRequests: null,
    quotaUsd: 100,
    credit5hLimit: 2.1,
    creditWeeklyLimit: 25,
    rpmLimit: 400,
    concurrencyLimit: 12,
    maxOutputTokens: 32768,
    keys: 25,
    support: 'Support dédié + SLA 99,5 %',
    features: ['30 jours renouvelables', '100 $ de crédit site', '2,10 $ max / 5 h', '25 $ max / semaine'],
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




