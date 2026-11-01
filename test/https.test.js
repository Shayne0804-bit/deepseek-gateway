// Tests de l'ecouteur HTTPS natif (Claude Desktop et autres clients https).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../src/app.js';

const TLS_DIR = path.join(import.meta.dirname, 'fixtures', 'tls');
const TLS_CERT = path.join(TLS_DIR, 'server.crt');
const TLS_KEY = path.join(TLS_DIR, 'server.key');
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function httpsGet(url, ca, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { ca }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout HTTPS')));
  });
}

test('HTTPS natif : HTTP et HTTPS servis en parallele', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-gateway-tls-'));
  const local = await startGateway({
    dataDir: dir,
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: TLS_CERT,
    tlsKeyFile: TLS_KEY,
    providerApiKey: 'sk-test-tls',
    providerBaseUrl: 'http://127.0.0.1:1',
    adminPassword: 'mot-de-passe-test-123',
    logLevel: 'error',
    logger: silentLogger,
  });
  try {
    assert.equal(local.tlsEnabled, true);
    assert.ok(local.httpsPort > 0, 'port HTTPS ephemere attendu');

    // HTTP fonctionne toujours.
    const httpRes = await fetch(`${local.url}/healthz`);
    assert.equal(httpRes.status, 200);
    assert.equal((await httpRes.json()).ok, true);

    // HTTPS avec l'autorite de certification de test.
    const ca = fs.readFileSync(TLS_CERT);
    const health = await httpsGet(`https://127.0.0.1:${local.httpsPort}/healthz`, ca);
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);
    assert.equal(JSON.parse(health.body).version.length > 0, true);

    // Le panneau et l'API sont aussi servis en HTTPS.
    const panel = await httpsGet(`https://localhost:${local.httpsPort}/`, ca);
    assert.equal(panel.status, 200);
    assert.match(panel.body, /DeepSeek Gateway/);

    const api = await httpsGet(`https://127.0.0.1:${local.httpsPort}/v1/models`, ca);
    assert.equal(api.status, 401); // sans cle derivee : l'API repond (preuve que le proxy HTTPS fonctionne)
    assert.equal(JSON.parse(api.body).error.code, 'missing_api_key');
  } finally {
    await local.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('TLS : configuration incomplete refusee explicitement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-gateway-tls-bad-'));
  try {
    await assert.rejects(
      startGateway({
        dataDir: dir,
        host: '127.0.0.1',
        port: 0,
        tlsCertFile: TLS_CERT,
        tlsKeyFile: '',
        providerApiKey: 'sk-test',
        adminPassword: 'mot-de-passe-test-123',
        logLevel: 'error',
        logger: silentLogger,
      }),
      /TLS_CERT_FILE et TLS_KEY_FILE/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
