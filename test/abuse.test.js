// Tests des briques anti-abus : emails jetables, empreinte appareil, Turnstile, IPQS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceHashFor, isDisposableEmail } from '../src/abuse.js';
import { lookupIpqsEmail, lookupIpqsIp, verifyHcaptcha, verifyTurnstile } from '../src/fraud.js';

function fakeResponse(data, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    async json() { return data; },
  };
}

test('emails jetables : domaines exacts, sous-domaines et adresses normales', () => {
  assert.equal(isDisposableEmail('test@mailinator.com'), true);
  assert.equal(isDisposableEmail('test@sub.mailinator.com'), true);
  assert.equal(isDisposableEmail('test@yopmail.com'), true);
  assert.equal(isDisposableEmail('test@gmail.com'), false);
  assert.equal(isDisposableEmail('test@mon-domaine.fr'), false);
  assert.equal(isDisposableEmail('test@jetable.example', ['jetable.example']), true);
});

test('empreinte appareil : stable, differente selon l identifiant ou les en-tetes', () => {
  const req = { headers: { 'user-agent': 'UA-test', 'accept-language': 'fr-FR' } };
  const a = deviceHashFor('device-1', req);
  const b = deviceHashFor('device-1', req);
  const c = deviceHashFor('device-2', req);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('Turnstile : token manquant, succes et echec', async () => {
  const config = {
    turnstileSecretKey: 'secret',
    turnstileVerifyUrl: 'https://turnstile.test/verify',
    turnstileTimeoutMs: 1000,
  };
  const missing = await verifyTurnstile('', '1.2.3.4', config);
  assert.equal(missing.ok, false);

  const ok = await verifyTurnstile('token', '1.2.3.4', config, async () => fakeResponse({ success: true }));
  assert.equal(ok.ok, true);

  const failed = await verifyTurnstile('token', '1.2.3.4', config, async () => fakeResponse({ success: false, 'error-codes': ['invalid-input-response'] }));
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.errors, ['invalid-input-response']);
});

test('hCaptcha : verifie le token serveur', async () => {
  const config = { hcaptchaSecretKey: 'secret', hcaptchaSiteKey: 'site', hcaptchaVerifyUrl: 'https://hcaptcha.test/verify', captchaTimeoutMs: 1000 };
  const missing = await verifyHcaptcha('', '1.2.3.4', config);
  assert.equal(missing.ok, false);
  const ok = await verifyHcaptcha('token', '1.2.3.4', config, async () => fakeResponse({ success: true }));
  assert.equal(ok.ok, true);
  const failed = await verifyHcaptcha('token', '1.2.3.4', config, async () => fakeResponse({ success: false, 'error-codes': ['invalid-input-response'] }));
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.errors, ['invalid-input-response']);
});

test('IPQS IP : VPN/hebergement bloques, IP propre acceptee', async () => {
  const config = {
    ipqsApiKey: 'key',
    fraudCheckEnabled: true,
    ipqsMinFraudScore: 85,
    ipqsBlockVpn: true,
    ipqsBlockHosting: true,
    fraudTimeoutMs: 1000,
  };
  const vpn = await lookupIpqsIp('1.2.3.4', config, async () => fakeResponse({
    success: true, fraud_score: 10, vpn: true, proxy: false, tor: false, hosting: false,
  }));
  assert.equal(vpn.blocked, true);

  const hosting = await lookupIpqsIp('1.2.3.4', config, async () => fakeResponse({
    success: true, fraud_score: 10, vpn: false, hosting: true,
  }));
  assert.equal(hosting.blocked, true);

  const clean = await lookupIpqsIp('1.2.3.4', config, async () => fakeResponse({
    success: true, fraud_score: 5, vpn: false, proxy: false, tor: false, hosting: false,
  }));
  assert.equal(clean.blocked, false);

  const disabled = await lookupIpqsIp('1.2.3.4', { ipqsApiKey: '', fraudCheckEnabled: false });
  assert.equal(disabled.configured, false);
});

test('IPQS email : jetable et invalide bloques, email valide accepte', async () => {
  const config = {
    ipqsApiKey: 'key',
    fraudCheckEnabled: true,
    emailValidationEnabled: true,
    ipqsMinFraudScore: 85,
    fraudTimeoutMs: 1000,
  };
  const disposable = await lookupIpqsEmail('test@jetable.com', config, async () => fakeResponse({
    success: true, disposable: true, valid: true, fraud_score: 5, deliverability: 'deliverable',
  }));
  assert.equal(disposable.blocked, true);

  const invalid = await lookupIpqsEmail('test@invalid.com', config, async () => fakeResponse({
    success: true, disposable: false, valid: false, fraud_score: 5,
  }));
  assert.equal(invalid.blocked, true);

  const clean = await lookupIpqsEmail('test@gmail.com', config, async () => fakeResponse({
    success: true, disposable: false, valid: true, fraud_score: 0, deliverability: 'deliverable',
  }));
  assert.equal(clean.blocked, false);
});
