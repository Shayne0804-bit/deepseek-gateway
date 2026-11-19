// Non-regression des correctifs de l'audit de securite du 2026-11-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../src/app.js';
import { closeDb, getActivePortalEmailCode, incrementPortalEmailCodeAttempts, insertPortalEmailCode, openDb } from '../src/db.js';
import { clientIp, originAllowed } from '../src/http-utils.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

async function startServer(overrides = {}) {
  const sent = [];
  const mailer = { enabled: true, transport: 'test', sent, async sendPortalCode(p) { sent.push(p); return { ok: true }; } };
  const started = await startGateway({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dsg-sec-')),
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    otpCooldownSeconds: 0,
    providerApiKey: 'sk-test-security',
    providerBaseUrl: 'http://127.0.0.1:1',
    adminPassword: 'security-admin-password-123',
    logLevel: 'error',
    logger: silentLogger,
    mailer,
    ...overrides,
  });
  return { started, sent };
}

function portalPost(base, pathname, body) {
  return fetch(`${base}/portal/api${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-portal' },
    body: JSON.stringify(body),
  });
}

test('E1 : le compteur d essais OTP est borne de facon atomique', async () => {
  const db = await openDb(fs.mkdtempSync(path.join(os.tmpdir(), 'dsg-sec-db-')));
  try {
    const now = new Date();
    await insertPortalEmailCode(db, {
      email: 'otp@gmail.com',
      codeHash: 'x',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 600_000).toISOString(),
    });
    const { id } = await getActivePortalEmailCode(db, 'otp@gmail.com');
    const results = await Promise.all(Array.from({ length: 12 }, () => incrementPortalEmailCodeAttempts(db, id, 5)));
    assert.equal(results.filter(Boolean).length, 5, 'exactement 5 essais acceptes');
  } finally {
    await closeDb(db);
  }
});

test('E2 : IP la plus a droite de X-Forwarded-For, X-Forwarded-Host ignore sans proxy', () => {
  const req = { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(clientIp(req, true), '203.0.113.9');
  assert.equal(clientIp(req, false), '10.0.0.1');
  const forged = { headers: { origin: 'https://evil.test', host: 'site.test', 'x-forwarded-host': 'evil.test' } };
  assert.equal(originAllowed(forged, false), false);
});

test('E2/F1 : ORIGIN_SECRET bloque l acces direct, /healthz reste minimal', async () => {
  const { started } = await startServer({ originSecret: 'cf-secret-123' });
  try {
    assert.equal((await fetch(`${started.url}/`)).status, 403);
    assert.equal((await fetch(`${started.url}/`, { headers: { 'x-origin-secret': 'cf-secret-123' } })).status, 200);
    const health = await fetch(`${started.url}/healthz`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.warnings, undefined);
    assert.equal(body.discord, undefined);
  } finally {
    await started.close();
  }
});

test('M3 : le proxy refuse les endpoints hors liste blanche', async () => {
  const { started } = await startServer();
  try {
    const login = await fetch(`${started.url}/admin/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
      body: JSON.stringify({ password: 'security-admin-password-123' }),
    });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const created = await fetch(`${started.url}/admin/api/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin', cookie },
      body: JSON.stringify({ name: 'Proxy' }),
    });
    const { key } = await created.json();
    for (const [method, pathname] of [['DELETE', '/v1/files/abc'], ['GET', '/v1/files'], ['POST', '/v1/batches']]) {
      const res = await fetch(`${started.url}${pathname}`, { method, headers: { authorization: `Bearer ${key}` } });
      assert.equal(res.status, 404, `${method} ${pathname}`);
    }
  } finally {
    await started.close();
  }
});
