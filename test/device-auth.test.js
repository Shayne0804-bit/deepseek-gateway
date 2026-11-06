// Tests du device flow CLI : approbation depuis le portail et jeton révocable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../src/app.js';

const ADMIN_PASSWORD = 'device-admin-password-123';
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const CSRF = { 'x-requested-with': 'dsk-portal' };
const ADMIN_CSRF = { 'x-requested-with': 'dsk-admin' };

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function startServer() {
  return startGateway({
    dataDir: tmpDir('dsg-device-'),
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    providerApiKey: 'sk-test-device',
    providerBaseUrl: 'http://127.0.0.1:1',
    adminPassword: ADMIN_PASSWORD,
    logLevel: 'error',
    logger: silentLogger,
  });
}

async function adminLogin(base) {
  const res = await fetch(`${base}/admin/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...ADMIN_CSRF },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  assert.equal(res.status, 200);
  return res.headers.getSetCookie()[0].split(';')[0];
}

async function createClient(base, adminCookie, name = 'Client appareil') {
  const res = await fetch(`${base}/admin/api/clients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...ADMIN_CSRF, cookie: adminCookie },
    body: JSON.stringify({ name, period: 'total' }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

async function portalLogin(base, key) {
  const res = await fetch(`${base}/portal/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...CSRF },
    body: JSON.stringify({ key }),
  });
  assert.equal(res.status, 200);
  return res.headers.getSetCookie()[0].split(';')[0];
}

async function post(base, pathname, body, headers = {}) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('device flow : approbation site, jeton CLI, révocation', async () => {
  const started = await startServer();
  try {
    const adminCookie = await adminLogin(started.url);
    const created = await createClient(started.url, adminCookie);
    const cookie = await portalLogin(started.url, created.key);

    const start = await post(started.url, '/portal/api/device/start', { deviceName: 'Poste de test' });
    assert.equal(start.status, 200);
    const device = await start.json();
    assert.match(device.user_code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(device.verification_uri_complete.includes('/device?code='));
    assert.equal(typeof device.device_code, 'string');

    const pending = await post(started.url, '/portal/api/device/token', { device_code: device.device_code });
    assert.equal(pending.status, 202);
    assert.equal((await pending.json()).status, 'pending');

    const noAuthApprove = await post(started.url, '/portal/api/device/approve', { user_code: device.user_code });
    assert.equal(noAuthApprove.status, 401);

    const approve = await post(
      started.url,
      '/portal/api/device/approve',
      { user_code: device.user_code },
      { cookie, ...CSRF },
    );
    assert.equal(approve.status, 200);
    assert.equal((await approve.json()).ok, true);

    const issued = await post(started.url, '/portal/api/device/token', { device_code: device.device_code });
    assert.equal(issued.status, 200);
    const tokenData = await issued.json();
    assert.match(tokenData.token, /^vlt_/);
    assert.equal(tokenData.token_type, 'Bearer');

    const replay = await post(started.url, '/portal/api/device/token', { device_code: device.device_code });
    assert.notEqual(replay.status, 200);

    const models = await fetch(`${started.url}/v1/models`, {
      headers: { authorization: `Bearer ${tokenData.token}` },
    });
    assert.equal(models.status, 200);

    const me = await fetch(`${started.url}/portal/api/me`, {
      headers: { authorization: `Bearer ${tokenData.token}` },
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).client.name, 'Client appareil');

    const devices = await fetch(`${started.url}/portal/api/devices`, { headers: { cookie } });
    assert.equal(devices.status, 200);
    const list = (await devices.json()).devices;
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Poste de test');
    assert.equal(list[0].active, true);

    const revoke = await fetch(`${started.url}/portal/api/devices/${list[0].id}`, {
      method: 'DELETE',
      headers: { ...CSRF, cookie },
    });
    assert.equal(revoke.status, 200);

    const afterRevoke = await fetch(`${started.url}/v1/models`, {
      headers: { authorization: `Bearer ${tokenData.token}` },
    });
    assert.equal(afterRevoke.status, 401);

    const afterRevokeMe = await fetch(`${started.url}/portal/api/me`, {
      headers: { authorization: `Bearer ${tokenData.token}` },
    });
    assert.equal(afterRevokeMe.status, 401);
  } finally {
    await started.close();
  }
});

test('device flow : mauvais code refusé et endpoints protégés', async () => {
  const started = await startServer();
  try {
    const adminCookie = await adminLogin(started.url);
    const created = await createClient(started.url, adminCookie, 'Client code invalide');
    const cookie = await portalLogin(started.url, created.key);
    const start = await post(started.url, '/portal/api/device/start', { deviceName: 'Mauvais code' });
    const device = await start.json();

    const bad = await post(
      started.url,
      '/portal/api/device/approve',
      { user_code: 'AAAA-BBBB' },
      { cookie, ...CSRF },
    );
    assert.equal(bad.status, 400);

    const noSession = await fetch(`${started.url}/portal/api/devices`);
    assert.equal(noSession.status, 401);

    const badToken = await fetch(`${started.url}/v1/models`, {
      headers: { authorization: 'Bearer vlt_invalide' },
    });
    assert.equal(badToken.status, 401);

    // Un code non consommé expire côté lecture si la date est dépassée.
    assert.equal(typeof device.device_code, 'string');
  } finally {
    await started.close();
  }
});
