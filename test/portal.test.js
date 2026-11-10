// Tests de l'espace utilisateur (portail) : session par cle derivee, isolation des donnees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../src/app.js';
import { recordUsage } from '../src/quota.js';

const ADMIN_PASSWORD = 'portal-admin-password-123';
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function startServer() {
  return startGateway({
    dataDir: tmpDir('dsg-portal-'),
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    providerApiKey: 'sk-test-portal',
    providerBaseUrl: 'http://127.0.0.1:1',
    adminPassword: ADMIN_PASSWORD,
    logLevel: 'error',
    logger: silentLogger,
  });
}

async function adminLogin(base) {
  const res = await fetch(`${base}/admin/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  const token = cookie.slice(cookie.indexOf('=') + 1);
  return { cookie, token, csrf: 'dsk-admin' };
}

async function createClient(base, admin, name) {
  const res = await fetch(`${base}/admin/api/clients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: admin.cookie, 'x-requested-with': 'dsk-admin' },
    body: JSON.stringify({ name, period: 'monthly' }),
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  return { client: data.client, key: data.key };
}

async function portalLogin(base, key, extraHeaders = {}) {
  return fetch(`${base}/portal/api/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'dsk-portal',
      ...extraHeaders,
    },
    body: JSON.stringify({ key }),
  });
}

function addLog(db, clientId, createdAt = new Date().toISOString()) {
  recordUsage(db, clientId, {
    model: 'deepseek-flash',
    requestedModel: 'claude-opus-5.5',
    usage: { prompt: 100, completion: 20, total: 120 },
    costUsd: 0.0012,
    status: 200,
    streamed: false,
    estimated: false,
    latencyMs: 42,
    now: new Date(createdAt),
  });
}

test('portail : trois surfaces + robots prives', async () => {
  const started = await startServer();
  try {
    const landing = await fetch(`${started.url}/`);
    assert.equal(landing.status, 200);
    const html = await landing.text();
    assert.match(html, /VALARIA Gateway API/);
    assert.match(html, /Une clé/);
  assert.match(html, /VALARIA Code/);

    const admin = await fetch(`${started.url}/admin`);
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /Console d'administration/);

    const portal = await fetch(`${started.url}/portal`);
    assert.equal(portal.status, 200);
    assert.match(await portal.text(), /Mon espace/);

    const signup = await fetch(`${started.url}/signup`);
    assert.equal(signup.status, 200);
    const signupHtml = await signup.text();
    assert.match(signupHtml, /Créer un compte/);
    assert.match(signupHtml, /signup-request-form/);

    const device = await fetch(`${started.url}/device?code=ABCD-EFGH`);
    assert.equal(device.status, 200);
    const deviceHtml = await device.text();
    assert.match(deviceHtml, /Autorisez/);
    assert.match(deviceHtml, /device-approve-form/);
    const deviceScript = await fetch(`${started.url}/assets/device.js`);
    assert.equal(deviceScript.status, 200);
    assert.match(await deviceScript.text(), /portal\/api\/device\/approve/);

    const robots = await fetch(`${started.url}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /Disallow: \//);
  } finally {
    await started.close();
  }
});

test('catalogue des pass et pass applique au compte', async () => {
  const started = await startServer();
  try {
    const admin = await adminLogin(started.url);
    const plansRes = await fetch(`${started.url}/admin/api/plans`, {
      headers: { cookie: admin.cookie, 'x-requested-with': 'dsk-admin' },
    });
    assert.equal(plansRes.status, 200);
    const catalog = await plansRes.json();
    assert.deepEqual(catalog.plans.map((plan) => plan.id), ['decouverte', 'createur', 'equipe', 'business']);

    const created = await fetch(`${started.url}/admin/api/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie, 'x-requested-with': 'dsk-admin' },
      body: JSON.stringify({ name: 'Client Createur', email: 'createur@example.com', plan: 'createur' }),
    });
    assert.equal(created.status, 201);
    const data = await created.json();
    assert.equal(data.client.plan, 'createur');
    assert.equal(data.client.planName, 'Créateur');
    assert.equal(data.client.quotaRequests, null);
    assert.equal(data.client.quotaUsd, 15);
    assert.equal(data.client.rpmLimit, 120);
    assert.equal(data.client.concurrencyLimit, 6);
    assert.ok(data.client.expiresAt, 'date de fin du pass automatique');
    const decouverte = catalog.plans.find((plan) => plan.id === 'decouverte');
    assert.equal(decouverte.durationDays, 7);
    assert.equal(decouverte.credit5hLimit, 2.5);
    const createur = catalog.plans.find((plan) => plan.id === 'createur');
    assert.equal(createur.durationDays, 14);
    assert.equal(createur.credit5hLimit, 5);

    const login = await portalLogin(started.url, data.key);
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const me = await (await fetch(`${started.url}/portal/api/me`, { headers: { cookie } })).json();
    assert.equal(me.plan.id, 'createur');
    assert.equal(me.plan.name, 'Créateur');
    assert.equal(me.plans.length, 4);
    assert.equal(me.quota.requests.limit, null);
  } finally {
    await started.close();
  }
});

test('portail : login, session, quotas et deconnexion', async () => {
  const started = await startServer();
  try {
    const admin = await adminLogin(started.url);
    const { client, key } = await createClient(started.url, admin, 'Client portail');
    addLog(started.db, client.id);

    // CSRF obligatoire.
    const noCsrf = await fetch(`${started.url}/portal/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    assert.equal(noCsrf.status, 403);

    // Mauvaise cle API.
    const bad = await portalLogin(started.url, 'sk-dsk-invalide');
    assert.equal(bad.status, 401);
    assert.equal((await bad.json()).error.code, 'invalid_api_key');

    // Bonne cle -> session.
    const login = await portalLogin(started.url, key);
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const me = await fetch(`${started.url}/portal/api/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    const data = await me.json();
    assert.equal(data.client.name, 'Client portail');
    assert.match(data.client.keyPrefix, /^sk-dsk-/);
    assert.equal(data.quota.tokens.used, 120);
    assert.equal(data.usage.totals.requests, 1);
    assert.ok(data.models.includes('claude-opus-5.5'));
    // Le modele reellement facture ne doit pas apparaitre cote utilisateur.
    assert.ok(!data.models.includes('deepseek-flash'));
    assert.match(data.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    assert.match(data.anthropicBaseUrl, /\/anthropic$/);

    // Journaux du client uniquement.
    const logs = await fetch(`${started.url}/portal/api/logs?limit=10`, { headers: { cookie } });
    assert.equal(logs.status, 200);
    const logsData = await logs.json();
    assert.equal(logsData.total, 1);
    assert.equal(logsData.rows[0].requestedModel, 'claude-opus-5.5');
    assert.equal(Object.hasOwn(logsData.rows[0], 'model'), false);

    // Modification de son propre nom affiche.
    const profile = await fetch(`${started.url}/portal/api/profile`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'dsk-portal' },
      body: JSON.stringify({ name: 'Client renommé' }),
    });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).name, 'Client renommé');
    const meAfterProfile = await (await fetch(`${started.url}/portal/api/me`, { headers: { cookie } })).json();
    assert.equal(meAfterProfile.client.name, 'Client renommé');

    // Une session portail n'ouvre pas l'API admin.
    const adminAccess = await fetch(`${started.url}/admin/api/clients`, { headers: { cookie } });
    assert.equal(adminAccess.status, 401);

    // Sans session portail.
    const anonymous = await fetch(`${started.url}/portal/api/me`);
    assert.equal(anonymous.status, 401);

    // Deconnexion.
    const logout = await fetch(`${started.url}/portal/api/logout`, {
      method: 'POST',
      headers: { cookie, 'x-requested-with': 'dsk-portal' },
    });
    assert.equal(logout.status, 200);
    const afterLogout = await fetch(`${started.url}/portal/api/me`, { headers: { cookie } });
    assert.equal(afterLogout.status, 401);
  } finally {
    await started.close();
  }
});

test('portail : isolation des donnees entre deux cles', async () => {
  const started = await startServer();
  try {
    const admin = await adminLogin(started.url);
    const first = await createClient(started.url, admin, 'Client A');
    const second = await createClient(started.url, admin, 'Client B');
    addLog(started.db, first.client.id);
    addLog(started.db, first.client.id);
    addLog(started.db, second.client.id);

    const login = await portalLogin(started.url, first.key);
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0].split(';')[0];

    const me = await (await fetch(`${started.url}/portal/api/me`, { headers: { cookie } })).json();
    assert.equal(me.client.name, 'Client A');
    assert.equal(me.usage.totals.requests, 2);
    assert.equal(me.quota.tokens.used, 240);

    const logs = await (await fetch(`${started.url}/portal/api/logs?limit=10`, { headers: { cookie } })).json();
    assert.equal(logs.total, 2);
    assert.ok(logs.rows.every((row) => row.totalTokens === 120));
  } finally {
    await started.close();
  }
});






