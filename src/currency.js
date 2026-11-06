/**
 * Detection pays/devise et conversion des prix des pass.
 *
 * Le pays vient en priorite de Cloudflare (CF-IPCountry), puis de la locale
 * du navigateur (fr-CI, en-NG...) et enfin de la timezone. Les taux sont
 * recuperes cote serveur (aucun appel externe depuis le navigateur), mis en
 * cache 12 h, avec un jeu de secours si l'API est indisponible.
 */

const RATE_CACHE_MS = 12 * 60 * 60 * 1000;
const FALLBACK_CACHE_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
const DEFAULT_RATES_URL = 'https://open.er-api.com/v6/latest/EUR';

export const COUNTRY_CURRENCY = Object.freeze({
  // Afrique de l'Ouest / zone FCFA
  CI: 'XOF', SN: 'XOF', BF: 'XOF', ML: 'XOF', TG: 'XOF', BJ: 'XOF', NE: 'XOF', GW: 'XOF',
  CM: 'XAF', GA: 'XAF', CG: 'XAF', TD: 'XAF', CF: 'XAF', GQ: 'XAF',
  NG: 'NGN', GH: 'GHS', GM: 'GMD', GN: 'GNF', SL: 'SLE', LR: 'LRD', CV: 'CVE',
  MA: 'MAD', DZ: 'DZD', TN: 'TND', EG: 'EGP', LY: 'LYD',
  KE: 'KES', TZ: 'TZS', UG: 'UGX', RW: 'RWF', ET: 'ETB', ZA: 'ZAR',
  CD: 'CDF', AO: 'AOA', MZ: 'MZN', ZM: 'ZMW', ZW: 'ZWL', MW: 'MWK',
  // Europe
  FR: 'EUR', BE: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR', PT: 'EUR', NL: 'EUR',
  LU: 'EUR', IE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR', SK: 'EUR', SI: 'EUR',
  EE: 'EUR', LV: 'EUR', LT: 'EUR', CY: 'EUR', MT: 'EUR', HR: 'EUR',
  GB: 'GBP', CH: 'CHF', NO: 'NOK', SE: 'SEK', DK: 'DKK', PL: 'PLN',
  CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', TR: 'TRY',
  // Ameriques / Asie / Moyen-Orient
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP',
  PE: 'PEN', IN: 'INR', CN: 'CNY', JP: 'JPY', KR: 'KRW', SG: 'SGD',
  HK: 'HKD', AU: 'AUD', NZ: 'NZD', AE: 'AED', SA: 'SAR', QA: 'QAR',
  IL: 'ILS', PK: 'PKR', BD: 'BDT', ID: 'IDR', MY: 'MYR', TH: 'THB',
  VN: 'VND', PH: 'PHP', RU: 'RUB', UA: 'UAH',
});

export const TIMEZONE_CURRENCY = Object.freeze({
  'Africa/Abidjan': 'XOF', 'Africa/Dakar': 'XOF', 'Africa/Bamako': 'XOF',
  'Africa/Ouagadougou': 'XOF', 'Africa/Lome': 'XOF', 'Africa/Cotonou': 'XOF',
  'Africa/Niamey': 'XOF', 'Africa/Bissau': 'XOF',
  'Africa/Douala': 'XAF', 'Africa/Yaounde': 'XAF', 'Africa/Libreville': 'XAF',
  'Africa/Brazzaville': 'XAF', 'Africa/Bangui': 'XAF', 'Africa/Malabo': 'XAF',
  "Africa/Ndjamena": 'XAF',
  'Africa/Lagos': 'NGN', 'Africa/Accra': 'GHS', 'Africa/Casablanca': 'MAD',
  'Africa/Algiers': 'DZD', 'Africa/Tunis': 'TND', 'Africa/Cairo': 'EGP',
  'Africa/Nairobi': 'KES', 'Africa/Johannesburg': 'ZAR',
  'Africa/Kinshasa': 'CDF', 'Africa/Luanda': 'AOA', 'Africa/Maputo': 'MZN',
});

// Taux indicatifs de secours (base EUR). Les taux reels remplacent cette table
// des que l'API repond ; ils ne servent qu'en cas de panne reseau.
export const FALLBACK_RATES = Object.freeze({
  EUR: 1,
  USD: 1.08, GBP: 0.85, CHF: 0.94, CAD: 1.47,
  XOF: 655.957, XAF: 655.957,
  NGN: 1650, GHS: 13.2, GMD: 75, GNF: 9300, SLE: 24, LRD: 210, CVE: 110,
  MAD: 10.8, DZD: 145, TND: 3.4, EGP: 53, LYD: 5.2,
  KES: 140, TZS: 2900, UGX: 4100, RWF: 1450, ETB: 130, ZAR: 20,
  CDF: 3100, AOA: 980, MZN: 69, ZMW: 29, ZWL: 14, MWK: 1900,
  NOK: 11.8, SEK: 11.3, DKK: 7.46, PLN: 4.3, CZK: 25.2, HUF: 395,
  RON: 4.97, BGN: 1.96, TRY: 38,
  MXN: 20, BRL: 6.2, ARS: 1100, CLP: 1050, COP: 4500, PEN: 4.1,
  INR: 91, CNY: 7.8, JPY: 165, KRW: 1480, SGD: 1.45, HKD: 8.4,
  AUD: 1.65, NZD: 1.8, AED: 3.97, SAR: 4.05, QAR: 3.93,
  ILS: 4, PKR: 300, BDT: 127, IDR: 17500, MYR: 4.8, THB: 38,
  VND: 27500, PHP: 62, RUB: 100, UAH: 45,
});

const COUNTRY_NAME_FALLBACK = {
  CI: "Côte d’Ivoire", SN: 'Sénégal', CM: 'Cameroun', NG: 'Nigéria', GH: 'Ghana',
  FR: 'France', BE: 'Belgique', CA: 'Canada', US: 'États-Unis', GB: 'Royaume-Uni',
};

let rateCache = null;

function currencyFromCountry(country) {
  return COUNTRY_CURRENCY[String(country || '').toUpperCase()] || null;
}

function validCountry(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && !['XX', 'T1'].includes(code) ? code : null;
}

function countryFromLocale(locale) {
  const match = /[-_]([A-Za-z]{2})\b/.exec(String(locale || ''));
  if (!match) return null;
  const code = match[1].toUpperCase();
  return COUNTRY_CURRENCY[code] ? code : null;
}

function countryFromTimezone(tz) {
  const currency = TIMEZONE_CURRENCY[String(tz || '')];
  if (!currency) return null;
  const entry = Object.entries(COUNTRY_CURRENCY).find(([, value]) => value === currency);
  return entry ? entry[0] : null;
}

export function detectCountry(req, locale = '', timezone = '') {
  const cfCountry = validCountry(req?.headers?.['cf-ipcountry']);
  if (cfCountry && COUNTRY_CURRENCY[cfCountry]) return cfCountry;
  // La timezone est un meilleur indice de localisation que la langue du
  // navigateur; Cloudflare reste prioritaire car il connait l'IP reelle.
  const tzCountry = countryFromTimezone(timezone);
  if (tzCountry) return tzCountry;
  const localeCountry = countryFromLocale(locale);
  if (localeCountry) return localeCountry;
  return null;
}

async function fetchRates(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'VALARIA-Gateway/currency' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data?.rates || typeof data.rates !== 'object') throw new Error('Reponse de taux invalide');
  const rates = { ...FALLBACK_RATES, ...data.rates };
  rates.EUR = 1;
  return {
    rates,
    source: 'open.er-api.com',
    updatedAt: data.time_last_update_utc
      ? new Date(data.time_last_update_utc).toISOString()
      : new Date().toISOString(),
    fallback: false,
  };
}

export async function getExchangeRates(config = {}) {
  const now = Date.now();
  if (rateCache && now - rateCache.at < (rateCache.fallback ? FALLBACK_CACHE_MS : RATE_CACHE_MS)) {
    return rateCache;
  }
  const url = config.exchangeRatesUrl || DEFAULT_RATES_URL;
  try {
    const fresh = await fetchRates(url);
    rateCache = { ...fresh, at: now };
  } catch {
    rateCache = {
      rates: FALLBACK_RATES,
      source: 'taux de secours',
      updatedAt: new Date().toISOString(),
      fallback: true,
      at: now,
    };
  }
  return rateCache;
}

export async function currencyContext(req, { locale = '', timezone = '', config = {} } = {}) {
  const country = detectCountry(req, locale, timezone);
  let currency = currencyFromCountry(country) || 'EUR';
  const rates = await getExchangeRates(config);
  let rate = Number(rates.rates[currency]);
  let resolvedCurrency = currency;
  if (!Number.isFinite(rate) || rate <= 0) {
    resolvedCurrency = 'EUR';
    rate = 1;
  }
  return {
    country: country || null,
    countryName: country
      ? (COUNTRY_NAME_FALLBACK[country] || country)
      : null,
    currency: resolvedCurrency,
    rate,
    source: rates.source,
    updatedAt: rates.updatedAt,
    fallback: Boolean(rates.fallback),
    isDefault: resolvedCurrency === 'EUR',
  };
}

export function convertFromEur(amountEur, context) {
  if (!context || !Number.isFinite(Number(amountEur))) return null;
  return Number(amountEur) * Number(context.rate || 1);
}
