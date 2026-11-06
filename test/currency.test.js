// Tests de detection pays/devise et conversion des prix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../src/app.js';
import { detectCountry, FALLBACK_RATES, convertFromEur } from '../src/currency.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('detection pays : Cloudflare, locale puis timezone', () => {
  assert.equal(detectCountry({ headers: { 'cf-ipcountry': 'CI' } }, '', ''), 'CI');
  assert.equal(detectCountry({ headers: {} }, 'fr-SN', ''), 'SN');
  assert.equal(detectCountry({ headers: {} }, 'en-US', ''), 'US');
  assert.equal(detectCountry({ headers: {} }, '', 'Africa/Lagos'), 'NG');
  assert.equal(detectCountry({ headers: { 'cf-ipcountry': 'XX' } }, '', ''), null);
});

test('conversion EUR vers devise locale', () => {
  assert.ok(FALLBACK_RATES.XOF > 600);
  assert.equal(convertFromEur(10, { rate: 655.957 }), 6559.57);
  assert.equal(convertFromEur(10, { rate: 0.85 }), 8.5);
});

test('endpoint devises : pays Cloudflare et taux de secours', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsg-currency-'));
  const started = await startGateway({
    dataDir,
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    providerApiKey: 'sk-test-currency',
    providerBaseUrl: 'http://127.0.0.1:1',
    adminPassword: 'currency-admin-password-123',
    logLevel: 'error',
    logger: silentLogger,
    exchangeRatesUrl: 'http://127.0.0.1:1/latest',
  });
  try {
    const res = await fetch(`${started.url}/portal/api/currency?locale=fr-CI`, {
      headers: { 'cf-ipcountry': 'CI' },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.country, 'CI');
    assert.equal(data.currency, 'XOF');
    assert.ok(data.rate > 600);
    assert.equal(data.fallback, true);
    assert.equal(data.isDefault, false);
  } finally {
    await started.close();
  }
});
