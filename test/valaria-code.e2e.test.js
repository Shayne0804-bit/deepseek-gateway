// Test d'intégration : package valaria-code contre la passerelle réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../src/app.js';
import { loginWithDevice } from '../packages/valaria-code/src/auth.js';
import { createClient } from '../packages/valaria-code/src/api.js';

const ADMIN_PASSWORD = 'valaria-code-e2e-password-123';
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('valaria-code : device login, jeton révocable et API', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valaria-code-gw-'));
  const started = await startGateway({
    dataDir,
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    providerApiKey: 'sk-test-code',
    providerBaseUrl: 'http://127.0.0.1:1',
    adminPassword: ADMIN_PASSWORD,
    logLevel: 'error',
    logger: silentLogger,
  });
  try {
    const admin = await fetch(`${started.url}/admin/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    assert.equal(admin.status, 200);
    const adminCookie = admin.headers.getSetCookie()[0].split(';')[0];
    const created = await fetch(`${started.url}/admin/api/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin', cookie: adminCookie },
      body: JSON.stringify({ name: 'VALARIA Code E2E', period: 'total' }),
    });
    assert.equal(created.status, 201);
    const clientData = await created.json();
    const portal = await fetch(`${started.url}/portal/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-portal' },
      body: JSON.stringify({ key: clientData.key }),
    });
    assert.equal(portal.status, 200);
    const cookie = portal.headers.getSetCookie()[0].split(';')[0];

    const device = await loginWithDevice({
      url: started.url,
      open: false,
      deviceName: 'Appareil CLI',
      pollMs: 150,
      onCode: async (payload) => {
        const res = await fetch(`${started.url}/portal/api/device/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-portal', cookie },
          body: JSON.stringify({ user_code: payload.user_code }),
        });
        assert.equal(res.status, 200);
      },
    });
    assert.match(device.token, /^vlt_/);
    const cli = createClient({ url: started.url, token: device.token });
    assert.equal((await cli.me()).client.name, 'VALARIA Code E2E');
    const models = await cli.models();
    assert.ok(models.length > 0);
    assert.ok(models.includes('deepseek-flash'));

    const devices = await (await fetch(`${started.url}/portal/api/devices`, { headers: { cookie } })).json();
    assert.equal(devices.devices.length, 1);
    assert.equal(devices.devices[0].name, 'Appareil CLI');
    const revoke = await fetch(`${started.url}/portal/api/devices/${devices.devices[0].id}`, {
      method: 'DELETE',
      headers: { 'x-requested-with': 'dsk-portal', cookie },
    });
    assert.equal(revoke.status, 200);
    await assert.rejects(() => cli.models(), /Erreur|401|invalide/i);
  } finally {
    await started.close();
  }
});
