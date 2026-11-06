import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PASS_PLANS, getPassPlan, passPlanFields } from '../src/plans.js';
import { openDb, closeDb, insertUsageLog, clientCreditWindowSince } from '../src/db.js';
import { CreditReservationBook } from '../src/limits.js';

test('plans : durees, credit site et plafond 5 h', () => {
  const byId = Object.fromEntries(PASS_PLANS.map((plan) => [plan.id, plan]));
  assert.equal(byId.decouverte.durationDays, 7);
  assert.equal(byId.createur.durationDays, 14);
  assert.equal(byId.equipe.durationDays, 30);
  assert.equal(byId.business.durationDays, 30);
  assert.equal(byId.decouverte.quotaUsd, 5);
  assert.equal(byId.decouverte.quotaRequests, null);
  assert.equal(byId.createur.quotaRequests, null);
  assert.equal(byId.decouverte.credit5hLimit, 0.45);
  assert.equal(byId.createur.credit5hLimit, 0.7);
  assert.equal(byId.equipe.credit5hLimit, 0.9);
  assert.equal(byId.business.credit5hLimit, 2.1);
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


test('reservations de credit : empeche le depassement concurrent', () => {
  const book = new CreditReservationBook();
  assert.equal(book.tryReserve('c1', 0.4, 0.5), true);
  assert.equal(book.tryReserve('c1', 0.2, 0.5), false, 'la deuxieme requete ne doit pas passer');
  book.release('c1', 0.4);
  assert.equal(book.tryReserve('c1', 0.2, 0.5), true);
  book.release('c1', 0.2);
  assert.equal(book.heldFor('c1'), 0);
});
