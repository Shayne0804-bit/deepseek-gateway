import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PASS_PLANS, getPassPlan, passPlanFields } from '../src/plans.js';
import { openDb, closeDb, insertUsageLog, clientCreditWindowSince } from '../src/db.js';
import { reserveCreditSlot, releaseCreditSlot } from '../src/db.js';
import { toMicroUsd, fromMicroUsd } from '../src/money.js';
import { creditPricingModelFor, computeCost, loadPricing } from '../src/pricing.js';

test('plans : durees, credit site et plafond 5 h', () => {
  const byId = Object.fromEntries(PASS_PLANS.map((plan) => [plan.id, plan]));
  assert.equal(byId.decouverte.durationDays, 7);
  assert.equal(byId.createur.durationDays, 14);
  assert.equal(byId.equipe.durationDays, 30);
  assert.equal(byId.business.durationDays, 30);
  assert.equal(byId.decouverte.quotaUsd, 5);
  assert.equal(byId.decouverte.quotaRequests, null);
  assert.equal(byId.createur.quotaRequests, null);
  assert.equal(byId.decouverte.credit5hLimit, 5);
  assert.equal(byId.createur.credit5hLimit, 10);
  assert.equal(byId.equipe.credit5hLimit, 20);
  assert.equal(byId.business.credit5hLimit, 50);
});

test('plans : la date de fin est calculee depuis la duree', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const fields = passPlanFields('decouverte', now);
  assert.equal(fields.plan, 'decouverte');
  assert.equal(fields.quotaUsd, 5);
  assert.equal(fields.period, 'total');
  assert.equal(fields.expiresAt, '2026-01-08T00:00:00.000Z');
  assert.equal(passPlanFields('createur').quotaUsd, 15);
  assert.equal(getPassPlan('inconnu'), null);
});

test('credit site : fenetre glissante de 5 h', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsg-credit-'));
  const db = await openDb(dir);
  try {
    const recent = new Date(Date.now() - 3_600_000).toISOString();
    const old = new Date(Date.now() - 6 * 3_600_000).toISOString();
    const base = {
      clientId: 'credit-client',
      model: 'deepseek-flash',
      requestedModel: null,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      status: 200,
      streamed: false,
      estimated: false,
      latencyMs: 5,
      error: null,
    };
    await insertUsageLog(db, { ...base, costUsd: 0.2, createdAt: recent });
    await insertUsageLog(db, { ...base, costUsd: 9.5, createdAt: old });
    const since = new Date(Date.now() - 5 * 3_600_000).toISOString();
    const win = await clientCreditWindowSince(db, 'credit-client', since);
    assert.equal(win.total, 0.2, 'seul le credit des 5 dernieres heures compte');
    assert.ok(win.oldest);
  } finally {
    await closeDb(db);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('reservations de credit persistantes : plafond strict', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsg-reserve-'));
  const db = await openDb(dir);
  try {
    const base = { clientId: 'c1', availableMicroUsd: 500000, ttlMs: 60000 };
    assert.equal(await reserveCreditSlot(db, { ...base, id: 'r1', amountMicroUsd: 400000 }), true);
    assert.equal(await reserveCreditSlot(db, { ...base, id: 'r2', amountMicroUsd: 200000 }), false);
    await releaseCreditSlot(db, 'r1');
    assert.equal(await reserveCreditSlot(db, { ...base, id: 'r3', amountMicroUsd: 200000 }), true);
    await releaseCreditSlot(db, 'r3');
  } finally {
    await closeDb(db);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('money : conversion micro-USD sans perte', () => {
  assert.equal(toMicroUsd(0.123456), 123456);
  assert.equal(fromMicroUsd(123456), 0.123456);
  assert.equal(toMicroUsd(1.0000004), 1000000);
});

test('alias premium : consomme le credit au tarif gros modele', () => {
  assert.equal(creditPricingModelFor('claude-opus-5', 'deepseek-flash'), 'alias:claude-opus-5');
  assert.equal(creditPricingModelFor('fable-5.1', 'deepseek-flash'), 'alias:fable-5.1');
  assert.equal(creditPricingModelFor('deepseek-flash', 'deepseek-flash'), 'deepseek-flash');
  assert.equal(creditPricingModelFor('claude-opus-5', 'deepseek-flash', false), 'deepseek-flash');
});


test('fable-5.1 : tarif reel -25 % avant credit site', () => {
  const pricing = loadPricing(() => null);
  const usage = { prompt: 1000, completion: 500, total: 1500, cacheHit: 0, cacheMiss: 1000 };
  const real = computeCost(usage, 'alias:fable-5.1', pricing);
  assert.equal(real, 0.02625);
  assert.equal(Math.round(real * 3.75 * 1e6) / 1e6, 0.098438);
});



