// Tests production : chiffrement des secrets, garde-fous, audit, budget, export CSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger, startGateway } from '../src/app.js';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  resetMasterKeyCache,
} from '../src/secrets.js';
import { IpRateLimiter, Semaphore } from '../src/limits.js';
import { closeDb, deleteUsageLogsBefore, insertUsageLog } from '../src/db.js';
import { openDb } from '../src/db.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const ADMIN_PASSWORD = 'admin-password-prod-123';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function startProd(overrides = {}) {
  return startGateway({
    dataDir: overrides.dataDir ?? tmpDir('dsg-prod-'),
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    providerApiKey: 'sk-test-prod',
    providerBaseUrl: 'http://127.0.0.1:1',
    adminPassword: ADMIN_PASSWORD,
    ipRateLimitPerMin: 0,
    logLevel: 'error',
    logger: silentLogger,
    ...overrides,
  });
}

async function login(base) {
  const res = await fetch(`${base}/admin/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  return { cookie, token: cookie.slice(cookie.indexOf('=') + 1) };
}

async function adminJson(base, cookie, pathname, options = {}) {
  const res = await fetch(base + pathname, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin', cookie },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
  return { res, data };
}

// ------------------------------- unitaires --------------------------------

test('chiffrement des secrets : AES-256-GCM + migration du clair', () => {
  const dataDir = tmpDir('dsg-secret-');
  const config = { dataDir, masterKey: '' };
  resetMasterKeyCache();

  const encrypted = encryptSecret('sk-secret-de-test-123456', config);
  assert.ok(isEncryptedSecret(encrypted));
  assert.ok(!encrypted.includes('sk-secret-de-test'));
  assert.equal(decryptSecret(encrypted, config), 'sk-secret-de-test-123456');
  assert.ok(fs.existsSync(path.join(dataDir, 'master.key')));

  // Valeur en clair (migration legacy) renvoyee telle quelle.
  assert.equal(decryptSecret('sk-legacy-plain', config), 'sk-legacy-plain');

  // Alteration -> erreur d'integrite.
  const tampered = `${encrypted.slice(0, -4)}AAAA`;
  assert.throws(() => decryptSecret(tampered, config), /dechiffrer/);
});

test('limiteurs : fenetre IP et semaphore global', () => {
  let now = 1_000_000;
  const limiter = new IpRateLimiter(() => now);
  assert.equal(limiter.hit('ip', 2).ok, true);
  assert.equal(limiter.hit('ip', 2).ok, true);
  assert.equal(limiter.hit('ip', 2).ok, false);
  assert.equal(limiter.hit('autre', 2).ok, true);
  now += 61_000;
  assert.equal(limiter.hit('ip', 2).ok, true);
  assert.equal(limiter.hit('ip', 0).ok, true);

  const semaphore = new Semaphore(1);
  assert.equal(semaphore.tryAcquire(), true);
  assert.equal(semaphore.tryAcquire(), false);
  semaphore.release();
  assert.equal(semaphore.tryAcquire(), true);
  const unlimited = new Semaphore(0);
  assert.equal(unlimited.tryAcquire(), true);
  assert.equal(unlimited.tryAcquire(), true);
});

test('logger : format JSON pour la production', () => {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    const log = createLogger('info', 'json');
    log.info('bonjour');
  } finally {
    console.log = original;
  }
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.msg, 'bonjour');
  assert.ok(parsed.ts);
});

test('retention : suppression des journaux anciens', async () => {
  const db = await openDb(tmpDir('dsg-retention-'));
  await insertUsageLog(db, {
    clientId: 'client-x',
    model: 'deepseek-flash',
    requestedModel: null,
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    costUsd: 0,
    status: 200,
    streamed: false,
    estimated: false,
    latencyMs: 10,
    error: null,
    createdAt: '2020-01-01T00:00:00.000Z',
  });
  const deleted = await deleteUsageLogsBefore(db, '2021-01-01T00:00:00.000Z');
  assert.equal(deleted, 1);
  await closeDb(db);
});

// ------------------------------ integration -------------------------------

test('securite HTTP : request-id, en-tetes de securite, /readyz', async () => {
  const started = await startProd();
  try {
    const res = await fetch(`${started.url}/healthz`);
    assert.equal(res.status, 200);
    const requestId = res.headers.get('x-request-id');
    assert.match(requestId ?? '', /^[0-9a-f]{12}$/);
    assert.match(res.headers.get('permissions-policy') ?? '', /camera=\(\)/);
    assert.match(res.headers.get('content-security-policy') ?? '', /object-src 'none'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    const ready = await fetch(`${started.url}/readyz`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).ok, true);
  } finally {
    await started.close();
  }
});

test('cle fournisseur : chiffree en base et lisible apres redemarrage', async () => {
  const dataDir = tmpDir('dsg-key-');
  const first = await startProd({ dataDir, providerApiKey: '' });
  const { cookie } = await login(first.url);
  const saved = await adminJson(first.url, cookie, '/admin/api/settings', {
    method: 'PUT',
    body: { providerApiKey: 'sk-panel-secret-999888' },
  });
  assert.equal(saved.res.status, 200);
  assert.equal(saved.data.settings.provider.configured, true);

  // En base : valeur chiffree, jamais en clair.
  const stored = JSON.parse(
    first.db.prepare("SELECT value FROM settings WHERE key = 'provider'").get().value,
  );
  assert.ok(isEncryptedSecret(stored.apiKey), 'la cle doit etre chiffree en base');
  assert.ok(!stored.apiKey.includes('sk-panel-secret'));
  await first.close();

  // Redemarrage : la cle est dechiffree et le fournisseur reste configure.
  const second = await startProd({ dataDir, providerApiKey: '' });
  try {
    const health = await (await fetch(`${second.url}/healthz`)).json();
    assert.equal(health.providerConfigured, true);
  } finally {
    await second.close();
  }
});

test('limite de requetes par IP appliquee sur l API', async () => {
  const started = await startProd({ ipRateLimitPerMin: 4 });
  try {
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(`${started.url}/v1/models`);
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(0, 4), [401, 401, 401, 401]);
    assert.equal(statuses[4], 429);
    const blocked = await fetch(`${started.url}/v1/models`);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error.code, 'ip_rate_limit');
    // La sante reste accessible.
    assert.equal((await fetch(`${started.url}/healthz`)).status, 200);
  } finally {
    await started.close();
  }
});

test('budget global mensuel : refus des requetes au-dela du plafond', async () => {
  const started = await startProd();
  try {
    const { cookie } = await login(started.url);
    const created = await adminJson(started.url, cookie, '/admin/api/clients', {
      method: 'POST',
      body: { name: 'Client budget', period: 'total' },
    });
    assert.equal(created.res.status, 201);

    // Consommation deja au-dessus du futur plafond.
    const clientId = created.data.client.id;
    insertUsageLog(started.db, {
      clientId,
      model: 'deepseek-flash',
      requestedModel: null,
      promptTokens: 1000,
      completionTokens: 1000,
      totalTokens: 2000,
      costUsd: 0.5,
      status: 200,
      streamed: false,
      estimated: false,
      latencyMs: 10,
      error: null,
      createdAt: new Date().toISOString(),
    });
    const budget = await adminJson(started.url, cookie, '/admin/api/settings', {
      method: 'PUT',
      body: { globalBudgetUsd: 0.01 },
    });
    assert.equal(budget.res.status, 200);
    assert.equal(budget.data.settings.globalBudget.exceeded, true);

    const res = await fetch(`${started.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${created.data.key}` },
      body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'x' }] }),
    });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).error.code, 'global_budget_exceeded');
  } finally {
    await started.close();
  }
});

test('audit des actions admin + export CSV des journaux', async () => {
  const started = await startProd();
  try {
    const { cookie } = await login(started.url);
    await adminJson(started.url, cookie, '/admin/api/clients', {
      method: 'POST',
      body: { name: 'Client audit', period: 'total' },
    });
    await adminJson(started.url, cookie, '/admin/api/settings', {
      method: 'PUT',
      body: { publicBaseUrl: 'https://audit.example.test' },
    });

    const audit = await adminJson(started.url, cookie, '/admin/api/audit?limit=50');
    assert.equal(audit.res.status, 200);
    const actions = audit.data.rows.map((row) => row.action);
    assert.ok(actions.includes('admin.login'));
    assert.ok(actions.includes('client.create'));
    assert.ok(actions.includes('settings.update'));

    const csv = await fetch(`${started.url}/admin/api/export/logs.csv`, { headers: { cookie } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(csv.headers.get('content-disposition') ?? '', /attachment/);
    const body = await csv.text();
    // Le BOM UTF-8 est consomme par le decodage de fetch ; il reste ecrit pour Excel.
    assert.ok(body.startsWith('date;cle;modele_demande'), body.slice(0, 60));
  } finally {
    await started.close();
  }
});
