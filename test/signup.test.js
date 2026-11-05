// Tests de l'inscription autonome par email, création de clé et connexions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../src/app.js';

const ADMIN_PASSWORD = 'signup-admin-password-123';
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeMailer() {
  const sent = [];
  return {
    enabled: true,
    transport: 'test',
    sent,
    async sendPortalCode(payload) { sent.push(payload); return { ok: true }; },
  };
}

async function startServer(overrides = {}) {
  const mailer = overrides.mailer ?? fakeMailer();
  const started = await startGateway({
    dataDir: tmpDir('dsg-signup-'),
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    otpCooldownSeconds: 0,
    providerApiKey: 'sk-test-signup',
    providerBaseUrl: 'http://127.0.0.1:1',
    adminPassword: ADMIN_PASSWORD,
    logLevel: 'error',
    logger: silentLogger,
    mailer,
    ...overrides,
  });
  return { started, mailer };
}

async function adminLogin(base) {
  const res = await fetch(`${base}/admin/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  return res.headers.getSetCookie()[0].split(';')[0];
}

function portalPost(base, pathname, body, extra = {}) {
  return fetch(`${base}/portal/api${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-portal', ...extra },
    body: JSON.stringify(body),
  });
}

test('inscription autonome : code email, compte, clé API et double connexion', async () => {
  const { started, mailer } = await startServer();
  try {
    // Demande de code pour un nouvel email.
    const request = await portalPost(started.url, '/signup/request', { email: 'nouveau@gmail.com' });
    assert.equal(request.status, 200);
    const message = (await request.json()).message;
    assert.match(message, /code envoyé/i);
    assert.equal(mailer.sent.length, 1);
    const code = mailer.sent[0].code;
    assert.match(code, /^\d{6}$/);

    // Vérification : le compte est créé, une session est ouverte.
    const verify = await portalPost(started.url, '/signup/verify', { email: 'nouveau@gmail.com', code });
    assert.equal(verify.status, 200);
    const cookie = verify.headers.getSetCookie()[0].split(';')[0];
    const me = await fetch(`${started.url}/portal/api/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    const data = await me.json();
    assert.equal(data.client.email, 'nouveau@gmail.com');
    assert.equal(data.client.hasKey, false, 'aucune clé API au départ');
    assert.equal(data.quota.requests.limit, 200, 'quota d’essai appliqué');
    assert.ok(data.client.expiresAt, 'date de fin d’essai');

    // Le compte apparaît une seule fois (pas de doublon admin).
    const adminCookie = await adminLogin(started.url);
    const clients = await (await fetch(`${started.url}/admin/api/clients`, { headers: { cookie: adminCookie } })).json();
    assert.equal(clients.clients.filter((c) => c.email === 'nouveau@gmail.com').length, 1);
    assert.equal(clients.clients.find((c) => c.email === 'nouveau@gmail.com').hasKey, false);

    // Création de la clé API par l'utilisateur.
    const keyRes = await portalPost(started.url, '/key', {}, { cookie });
    assert.equal(keyRes.status, 201);
    const created = await keyRes.json();
    assert.match(created.key, /^sk-dsk-/);
    const apiKey = created.key;

    // L'ancienne session voit maintenant hasKey=true.
    const me2 = await (await fetch(`${started.url}/portal/api/me`, { headers: { cookie } })).json();
    assert.equal(me2.client.hasKey, true);
    assert.ok(me2.client.keyPrefix.startsWith('sk-dsk-'));

    // Connexion par email (code) même compte.
    const request2 = await portalPost(started.url, '/signup/request', { email: 'nouveau@gmail.com' });
    assert.equal(request2.status, 200);
    await fetch(`${started.url}/portal/api/logout`, {
      method: 'POST',
      headers: { cookie, 'x-requested-with': 'dsk-portal' },
    });
    const code2 = mailer.sent.at(-1).code;
    const loginEmail = await portalPost(started.url, '/signup/verify', { email: 'nouveau@gmail.com', code: code2 });
    assert.equal(loginEmail.status, 200);
    assert.equal((await loginEmail.json()).method, 'email');

    // Connexion par clé API.
    const loginKey = await portalPost(started.url, '/login', { key: apiKey });
    assert.equal(loginKey.status, 200);
    assert.equal((await loginKey.json()).method, 'api_key');
  } finally {
    await started.close();
  }
});

test('inscription : désactivée par SIGNUP_ENABLED=0', async () => {
  const { started, mailer } = await startServer({ signupEnabled: false });
  try {
    const request = await portalPost(started.url, '/signup/request', { email: 'blocked@gmail.com' });
    assert.equal(request.status, 403);
    assert.equal(mailer.sent.length, 0);
  } finally {
    await started.close();
  }
});

test('clé API : une seule création, régénération possible', async () => {
  const { started, mailer } = await startServer();
  try {
    await portalPost(started.url, '/signup/request', { email: 'cle@gmail.com' });
    const verify = await portalPost(started.url, '/signup/verify', { email: 'cle@gmail.com', code: mailer.sent.at(-1).code });
    const cookie = verify.headers.getSetCookie()[0].split(';')[0];
    const first = await (await portalPost(started.url, '/key', {}, { cookie })).json();
    const second = await portalPost(started.url, '/key', {}, { cookie });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, 'key_exists');
    const rotate = await portalPost(started.url, '/key/rotate', {}, { cookie });
    assert.equal(rotate.status, 200);
    const rotated = await rotate.json();
    assert.match(rotated.key, /^sk-dsk-/);
    assert.notEqual(rotated.key, first.key);
    // L'ancienne clé ne fonctionne plus.
    const oldLogin = await portalPost(started.url, '/login', { key: first.key });
    assert.equal(oldLogin.status, 401);
    const newLogin = await portalPost(started.url, '/login', { key: rotated.key });
    assert.equal(newLogin.status, 200);
  } finally {
    await started.close();
  }
});

test('pas de plafond d envois par email (cooldown court en test)', async () => {
  const { started, mailer } = await startServer();
  try {
    for (let i = 0; i < 6; i += 1) {
      const res = await portalPost(started.url, '/signup/request', { email: 'illimite@gmail.com' });
      assert.equal(res.status, 200, `envoi ${i + 1}`);
      const body = await res.json();
      assert.equal(body.sent, true);
      assert.equal(body.max_sends, 0);
    }
    assert.equal(mailer.sent.length, 6, 'chaque demande doit envoyer un email');
  } finally {
    await started.close();
  }
});

test('code demande en inscription mais saisi en connexion : compte cree automatiquement', async () => {
  const { started, mailer } = await startServer();
  try {
    await portalPost(started.url, '/signup/request', { email: 'mauvais-onglet@gmail.com' });
    const code = mailer.sent.at(-1).code;

    const login = await portalPost(started.url, '/email/verify', { email: 'mauvais-onglet@gmail.com', code });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).method, 'signup');

    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const me = await (await fetch(`${started.url}/portal/api/me`, { headers: { cookie } })).json();
    assert.equal(me.client.email, 'mauvais-onglet@gmail.com');
    assert.equal(me.client.hasKey, false);
  } finally {
    await started.close();
  }
});

test('connexion email inconnue : un code est envoye et le compte est cree', async () => {
  const { started, mailer } = await startServer();
  try {
    const request = await portalPost(started.url, '/email/request', { email: 'inconnu@gmail.com' });
    assert.equal(request.status, 200);
    const requestData = await request.json();
    assert.equal(requestData.sent, true);
    assert.equal(requestData.signup, true);
    assert.equal(mailer.sent.length, 1);

    const verify = await portalPost(started.url, '/email/verify', { email: 'inconnu@gmail.com', code: mailer.sent[0].code });
    assert.equal(verify.status, 200);
    assert.equal((await verify.json()).method, 'signup');

    const adminCookie = await adminLogin(started.url);
    const clients = await (await fetch(`${started.url}/admin/api/clients`, { headers: { cookie: adminCookie } })).json();
    const account = clients.clients.find((c) => c.email === 'inconnu@gmail.com');
    assert.ok(account, 'le compte doit apparaître côté admin');
    assert.equal(account.hasKey, false);
  } finally {
    await started.close();
  }
});

test('inscription : email jetable refuse', async () => {
  const { started, mailer } = await startServer();
  try {
    const res = await portalPost(started.url, '/signup/request', { email: 'test@mailinator.com' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'email_disposable');
    assert.equal(mailer.sent.length, 0);
  } finally {
    await started.close();
  }
});

test('inscription : un seul compte par IP', async () => {
  const { started, mailer } = await startServer({
    signupMaxPerIp: 1,
    signupMaxPerDevice: 0,
    otpCooldownSeconds: 0,
  });
  try {
    await portalPost(started.url, '/signup/request', { email: 'premier-ip@gmail.com' });
    const verify = await portalPost(started.url, '/signup/verify', { email: 'premier-ip@gmail.com', code: mailer.sent.at(-1).code });
    assert.equal(verify.status, 200);

    const second = await portalPost(started.url, '/signup/request', { email: 'second-ip@gmail.com' });
    assert.equal(second.status, 403);
    assert.equal((await second.json()).error.code, 'signup_ip_limit');
    assert.equal(mailer.sent.length, 1, 'aucun email pour le second compte');
  } finally {
    await started.close();
  }
});

test('inscription : Turnstile exige un token valide', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://turnstile.test/')) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(url, options);
  };
  const { started, mailer } = await startServer({
    turnstileSiteKey: 'site-key',
    turnstileSecretKey: 'secret-key',
    turnstileRequired: true,
    turnstileVerifyUrl: 'https://turnstile.test/verify',
    signupMaxPerDevice: 0,
  });
  try {
    const withoutToken = await portalPost(started.url, '/signup/request', { email: 'sans-token@gmail.com' });
    assert.equal(withoutToken.status, 403);
    assert.equal((await withoutToken.json()).error.code, 'turnstile_failed');
    assert.equal(mailer.sent.length, 0);

    const withToken = await portalPost(started.url, '/signup/request', {
      email: 'avec-token@gmail.com',
      turnstileToken: 'ok-token',
    });
    assert.equal(withToken.status, 200);
    assert.equal(mailer.sent.length, 1);
  } finally {
    await started.close();
    globalThis.fetch = originalFetch;
  }
});

test('admin : test email visible et erreur Resend remontee', async () => {
  const { started, mailer } = await startServer();
  try {
    const admin = await adminLogin(started.url);
    const ok = await fetch(`${started.url}/admin/api/settings/mail-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin', cookie: admin },
      body: JSON.stringify({ to: 'destinataire@test.local' }),
    });
    assert.equal(ok.status, 200);
    assert.equal(mailer.sent.at(-1).code, '000000');
  } finally {
    await started.close();
  }

  const failing = {
    enabled: true,
    transport: 'resend',
    async sendPortalCode() { throw new Error('Resend HTTP 403 {"message":"domain not verified"}'); },
  };
  const { started: failingStarted } = await startServer({ mailer: failing });
  try {
    const admin = await adminLogin(failingStarted.url);
    const res = await fetch(`${failingStarted.url}/admin/api/settings/mail-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin', cookie: admin },
      body: JSON.stringify({ to: 'destinataire@test.local' }),
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error.message, /domain not verified/);
  } finally {
    await failingStarted.close();
  }
});
