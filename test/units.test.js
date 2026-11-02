import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  DEFAULT_PRICING,
  canonicalModelName,
  computeCost,
  isPeak,
  modelBaseName,
  normalizePricing,
  normalizeUsage,
  resolveModelPrice,
} from '../src/pricing.js';
import { APP_ROOT, DEFAULT_MAX_BODY_BYTES, byteLimit, loadConfig } from '../src/config.js';
import { formatByteSize } from '../src/http-utils.js';
import {
  DEFAULT_MODEL_ALIASES,
  loadModelAliases,
  normalizeModelAliases,
  resolveModelAlias,
} from '../src/model-aliases.js';
import {
  checkClientAccess,
  clampOutputTokens,
  estimateUsage,
  isModelAllowed,
  periodKeyFor,
  RateLimiter,
  remainingFor,
} from '../src/quota.js';
import {
  displayKeyPrefix,
  generateDerivedKey,
  hashApiKey,
  hashPassword,
  verifyPassword,
} from '../src/auth.js';

/* ------------------------------- tarifs -------------------------------- */

test('heures pleines : lundi 02:00 UTC oui, samedi non, ferie non', () => {
  const mondayPeak = new Date('2026-11-02T02:00:00Z'); // lundi
  const mondayOffPeak = new Date('2026-11-02T05:00:00Z');
  const saturday = new Date('2026-11-07T02:00:00Z'); // samedi
  const holiday = new Date('2026-11-02T02:00:00Z');
  assert.equal(isPeak(mondayPeak, DEFAULT_PRICING), true);
  assert.equal(isPeak(mondayOffPeak, DEFAULT_PRICING), false);
  assert.equal(isPeak(saturday, DEFAULT_PRICING), false);
  assert.equal(
    isPeak(holiday, { ...DEFAULT_PRICING, holidays: ['2026-11-02'] }),
    false,
  );
});

test('cout deepseek-flash : peak 1.506 USD, offpeak 0.753 USD pour 1M de chaque', () => {
  const usage = {
    prompt: 2_000_000,
    completion: 1_000_000,
    total: 3_000_000,
    cacheHit: 1_000_000,
    cacheMiss: 1_000_000,
  };
  const peakDate = new Date('2026-11-02T02:00:00Z');
  const offPeakDate = new Date('2026-11-02T12:00:00Z');
  assert.equal(computeCost(usage, 'deepseek-flash', DEFAULT_PRICING, peakDate), 1.506);
  assert.equal(computeCost(usage, 'deepseek-flash', DEFAULT_PRICING, offPeakDate), 0.753);
  // Modele inconnu -> tarif de repli (flash).
  assert.equal(computeCost(usage, 'modele-inconnu', DEFAULT_PRICING, peakDate), 1.506);
  // Alias legacy.
  assert.equal(computeCost(usage, 'deepseek-chat', DEFAULT_PRICING, peakDate), 1.506);
});

test('deepseek-v4-pro plus cher que flash', () => {
  const usage = {
    prompt: 1_000_000,
    completion: 1_000_000,
    total: 2_000_000,
    cacheHit: 0,
    cacheMiss: 1_000_000,
  };
  const peak = computeCost(usage, 'deepseek-v4-pro', DEFAULT_PRICING, new Date('2026-11-02T02:00:00Z'));
  const flash = computeCost(usage, 'deepseek-flash', DEFAULT_PRICING, new Date('2026-11-02T02:00:00Z'));
  assert.ok(peak > flash);
  assert.equal(peak, 1.32 + 3.96);
});

test('normalizeUsage gere le format OpenAI et Anthropic', () => {
  const openai = normalizeUsage({
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    prompt_cache_hit_tokens: 40,
    prompt_cache_miss_tokens: 60,
  });
  assert.deepEqual(openai, {
    prompt: 100,
    completion: 20,
    total: 120,
    cacheHit: 40,
    cacheMiss: 60,
  });

  const anthropic = normalizeUsage({
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 30,
    cache_creation_input_tokens: 0,
  });
  assert.deepEqual(anthropic, {
    prompt: 40,
    completion: 5,
    total: 45,
    cacheHit: 30,
    cacheMiss: 10,
  });

  assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage({}), null);
});

test('normalizePricing valide et rejette', () => {
  const ok = normalizePricing(DEFAULT_PRICING);
  assert.ok(ok.models['deepseek-flash']);
  assert.throws(() => normalizePricing({ models: {} }), /au moins un modele/i);
  assert.throws(() => normalizePricing({ models: { x: {} } }), /cacheHit/);
  assert.equal(resolveModelPrice('deepseek-v4-flash', DEFAULT_PRICING), DEFAULT_PRICING.models['deepseek-flash']);
});

/* ------------------------------- quotas -------------------------------- */

test('periodKeyFor : jour, mois, total', () => {
  const date = new Date('2026-10-31T23:30:00Z');
  assert.equal(periodKeyFor('daily', date), '2026-10-31');
  assert.equal(periodKeyFor('monthly', date), '2026-10');
  assert.equal(periodKeyFor('total', date), 'all');
});

test('checkClientAccess : desactive, expire, quotas', () => {
  const now = new Date('2026-10-31T12:00:00Z');
  const base = {
    enabled: true,
    expiresAt: null,
    quotaRequests: null,
    quotaTokens: null,
    quotaUsd: null,
    usedRequests: 0,
    usedTokens: 0,
    usedUsd: 0,
    period: 'total',
  };
  assert.equal(checkClientAccess(base, now), null);
  assert.equal(checkClientAccess({ ...base, enabled: false }, now).code, 'client_disabled');
  assert.equal(checkClientAccess({ ...base, expiresAt: '2026-10-30T00:00:00Z' }, now).code, 'client_expired');
  assert.equal(
    checkClientAccess({ ...base, quotaRequests: 5, usedRequests: 5 }, now).code,
    'insufficient_quota',
  );
  assert.equal(
    checkClientAccess({ ...base, quotaTokens: 100, usedTokens: 100 }, now).status,
    429,
  );
  assert.equal(
    checkClientAccess({ ...base, quotaUsd: 1, usedUsd: 1 }, now).code,
    'insufficient_quota',
  );
  assert.equal(checkClientAccess({ ...base, quotaTokens: 100, usedTokens: 99 }, now), null);
});

test('clampOutputTokens respecte plafond et quota restant', () => {
  const body = { max_tokens: 1000 };
  assert.equal(clampOutputTokens(body, { maxOutputTokens: 64, quotaTokens: null, usedTokens: 0 }), true);
  assert.equal(body.max_tokens, 64);

  const body2 = { max_tokens: 500 };
  assert.equal(clampOutputTokens(body2, { maxOutputTokens: null, quotaTokens: 100, usedTokens: 90 }), true);
  assert.equal(body2.max_tokens, 10);

  const body3 = { max_completion_tokens: 999 };
  assert.equal(clampOutputTokens(body3, { maxOutputTokens: 32, quotaTokens: null, usedTokens: 0 }), true);
  assert.equal(body3.max_completion_tokens, 32);

  const body4 = {};
  assert.equal(clampOutputTokens(body4, { maxOutputTokens: 32, quotaTokens: null, usedTokens: 0 }), false);
  assert.equal(body4.max_tokens, undefined);

  // Deja sous les plafonds : aucune modification (donc pas de re-serialisation).
  const body5 = { max_tokens: 10 };
  assert.equal(clampOutputTokens(body5, { maxOutputTokens: 32, quotaTokens: null, usedTokens: 0 }), false);
  assert.equal(body5.max_tokens, 10);
});

test('limite de corps : valeurs, formats et depassement', () => {
  assert.equal(DEFAULT_MAX_BODY_BYTES, 32 * 1024 * 1024);
  assert.equal(byteLimit(undefined, 100), 100);
  assert.equal(byteLimit('', 100), 100);
  assert.equal(byteLimit('4194304', 100), 4194304);
  assert.equal(byteLimit(' 8388608 ', 100), 8388608);
  assert.equal(byteLimit('abc', 100), 100);
  assert.equal(byteLimit('0', 100), Infinity);
  assert.equal(byteLimit('-5', 100), Infinity);
  assert.equal(formatByteSize(4194304), '4 Mo');
  assert.equal(formatByteSize(33554432), '32 Mo');
  assert.equal(formatByteSize(2048), '2 Ko');
  assert.equal(formatByteSize(512), '512 octets');
  assert.equal(formatByteSize(Infinity), 'illimitee');
});

/* ---------------------------- alias de modeles ------------------------- */

test('alias de modeles : resolution, wildcard et validation', () => {
  // Defaut : claude-opus-5 (et variantes datees) -> deepseek-flash (modele economique).
  assert.equal(resolveModelAlias('claude-opus-5', DEFAULT_MODEL_ALIASES), 'deepseek-flash');
  assert.equal(resolveModelAlias('claude-opus-5-20260101', DEFAULT_MODEL_ALIASES), 'deepseek-flash');
  assert.equal(resolveModelAlias('fable-5', DEFAULT_MODEL_ALIASES), 'deepseek-flash');
  assert.equal(resolveModelAlias('fable-5.1', DEFAULT_MODEL_ALIASES), 'deepseek-flash');
  assert.equal(resolveModelAlias('deepseek-flash', DEFAULT_MODEL_ALIASES), 'deepseek-flash');
  assert.equal(resolveModelAlias('claude-opus-5', {}), 'claude-opus-5');

  // Correspondance exacte prioritaire, motif le plus long gagne.
  assert.equal(resolveModelAlias('claude-opus-5', { 'claude-opus-5': 'deepseek-flash' }), 'deepseek-flash');
  assert.equal(resolveModelAlias('claude-opus-9', { 'claude*': 'a', 'claude-opus*': 'b' }), 'b');
  assert.equal(resolveModelAlias('autre', { 'claude*': 'a' }), 'autre');

  assert.deepEqual(normalizeModelAliases({ ' a ': ' b ' }), { a: 'b' });
  assert.throws(() => normalizeModelAliases([]), /objet JSON/);
  assert.throws(() => normalizeModelAliases({ x: '' }), /cible/);

  // Chargement : reglage absent -> defauts ; objet vide -> aucun alias ; invalide -> defauts.
  assert.deepEqual(loadModelAliases(() => null), { ...DEFAULT_MODEL_ALIASES });
  assert.deepEqual(loadModelAliases(() => ({})), {});
  assert.deepEqual(loadModelAliases(() => ({ x: 'deepseek-flash' })), { x: 'deepseek-flash' });
  assert.deepEqual(loadModelAliases(() => { throw new Error('boom'); }), { ...DEFAULT_MODEL_ALIASES });
});

test('remainingFor et isModelAllowed', () => {
  const client = {
    quotaTokens: 100,
    usedTokens: 40,
    quotaRequests: 10,
    usedRequests: 2,
    quotaUsd: 5,
    usedUsd: 1.5,
  };
  assert.deepEqual(remainingFor(client), { tokens: 60, requests: 8, usd: 3.5 });
  assert.equal(isModelAllowed(client, 'deepseek-flash'), true);
  assert.equal(isModelAllowed({ allowedModels: ['deepseek-flash'] }, 'deepseek-flash'), true);
  assert.equal(isModelAllowed({ allowedModels: ['deepseek-flash'] }, 'deepseek-v4-pro'), false);
});

test('RateLimiter fenetre glissante', () => {
  let now = 1_000_000;
  const limiter = new RateLimiter(() => now);
  assert.equal(limiter.hit('a', 2).ok, true);
  assert.equal(limiter.hit('a', 2).ok, true);
  const blocked = limiter.hit('a', 2);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 1);
  assert.equal(limiter.hit('b', 2).ok, true); // independant par client
  now += 61_000;
  assert.equal(limiter.hit('a', 2).ok, true);
});

test('estimateUsage ne renvoie jamais zero', () => {
  const usage = estimateUsage('abcd'.repeat(10), 40);
  assert.ok(usage.prompt >= 1);
  assert.ok(usage.completion >= 1);
  assert.equal(usage.total, usage.prompt + usage.completion);
});

/* -------------------------------- auth --------------------------------- */

test('mots de passe hashes scrypt verifiables', () => {
  const hash = hashPassword('mot-de-passe-solide');
  assert.match(hash, /^scrypt\$/);
  assert.equal(verifyPassword('mot-de-passe-solide', hash), true);
  assert.equal(verifyPassword('mauvais', hash), false);
  assert.equal(verifyPassword('mot-de-passe-solide', 'nimporte-quoi'), false);
});

test('cles derivees : format, hachage, prefixe', () => {
  const key = generateDerivedKey();
  assert.match(key, /^sk-dsk-[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(generateDerivedKey(), key);
  assert.equal(hashApiKey(key).length, 64);
  assert.ok(displayKeyPrefix(key).startsWith('sk-dsk-'));
  assert.ok(!displayKeyPrefix(key).includes(key.slice(-10)));
});

/* ------------------------------ modeles -------------------------------- */

test('noms de modeles : alias convertis, suffixe de variante conserve', () => {
  assert.equal(canonicalModelName('deepseek-v4-flash'), 'deepseek-flash');
  assert.equal(canonicalModelName('deepseek-chat'), 'deepseek-flash');
  assert.equal(canonicalModelName('deepseek-reasoner'), 'deepseek-v4-pro');
  assert.equal(canonicalModelName('deepseek-flash[1m]'), 'deepseek-flash[1m]');
  assert.equal(canonicalModelName('deepseek-v4-flash[1m]'), 'deepseek-flash[1m]');
  assert.equal(canonicalModelName('modele-inconnu'), 'modele-inconnu');
  assert.equal(modelBaseName('deepseek-flash[1m]'), 'deepseek-flash');
  assert.equal(modelBaseName('deepseek-v4-pro[1m]'), 'deepseek-v4-pro');
  assert.equal(
    resolveModelPrice('deepseek-v4-pro[1m]', DEFAULT_PRICING),
    DEFAULT_PRICING.models['deepseek-v4-pro'],
  );
  assert.equal(
    resolveModelPrice('deepseek-v4-flash[1m]', DEFAULT_PRICING),
    DEFAULT_PRICING.models['deepseek-flash'],
  );
});

/* ----------------------------- configuration --------------------------- */

test('configuration : variables d environnement vides traitees comme absentes', () => {
  const savedDataDir = process.env.DATA_DIR;
  const savedHost = process.env.HOST;
  process.env.DATA_DIR = '';
  process.env.HOST = '   ';
  try {
    const config = loadConfig();
    // `DATA_DIR=` dans .env ne doit plus ecrire la base dans le repertoire courant.
    assert.equal(config.dataDir, path.join(APP_ROOT, 'data'));
    assert.equal(config.host, '127.0.0.1');
  } finally {
    if (savedDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = savedDataDir;
    if (savedHost === undefined) delete process.env.HOST;
    else process.env.HOST = savedHost;
  }
});
