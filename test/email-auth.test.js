// Tests de la connexion portail par code email (OTP) et du transport email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../src/app.js';
import { buildPortalCodeEmail, createMailer, parseSmtpUrl } from '../src/mailer.js';

const ADMIN_PASSWORD = 'email-admin-password-123';
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
    async sendPortalCode(payload) {
      sent.push(payload);
      return { ok: true };
    },
  };
}

async function startServer(overrides = {}) {
  const mailer = overrides.mailer ?? fakeMailer();
  const started = await startGateway({
    dataDir: tmpDir('dsg-email-'),
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    providerApiKey: 'sk-test-email',
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
  assert.equal(res.status, 200);
  return res.headers.getSetCookie()[0].split(';')[0];
}

async function createClient(base, cookie, body) {
  return fetch(`${base}/admin/api/clients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-requested-with': 'dsk-admin' },
    body: JSON.stringify(body),
  });
}

function portalPost(base, pathname, body, extra = {}) {
  return fetch(`${base}/portal/api${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-portal', ...extra },
    body: JSON.stringify(body),
  });
}

test('email OTP : demande générique, vérification, session et audit', async () => {
  // Inscription fermée : une adresse inconnue ne reçoit rien (comportement historique).
  const { started, mailer } = await startServer({ signupEnabled: false });
  try {
    const cookie = await adminLogin(started.url);
    const created = await createClient(started.url, cookie, {
      name: 'Utilisateur email',
      email: 'User@Example.com',
      period: 'monthly',
    });
    assert.equal(created.status, 201);
    const client = (await created.json()).client;
    assert.equal(client.email, 'user@example.com');

    // Adresse inconnue : réponse générique, aucun envoi.
    const unknown = await portalPost(started.url, '/email/request', { email: 'inconnu@example.com' });
    assert.equal(unknown.status, 200);
    assert.match((await unknown.json()).message, /Si un compte existe/);
    assert.equal(mailer.sent.length, 0);

    // Adresse connue : même réponse, un code envoyé.
    const request = await portalPost(started.url, '/email/request', { email: 'user@example.com' });
    assert.equal(request.status, 200);
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0].to, 'user@example.com');
    const code = mailer.sent[0].code;
    assert.match(code, /^\d{6}$/);

    // Mauvaise adresse / mauvais format de code.
    const wrong = await portalPost(started.url, '/email/verify', { email: 'user@example.com', code: '000000' === code ? '111111' : '000000' });
    assert.equal(wrong.status, 401);

    // Bon code -> session portail.
    const verify = await portalPost(started.url, '/email/verify', { email: 'USER@example.com', code });
    assert.equal(verify.status, 200);
    const verifyBody = await verify.json();
    assert.equal(verifyBody.method, 'email');
    const portalCookie = verify.headers.getSetCookie()[0].split(';')[0];
    const me = await fetch(`${started.url}/portal/api/me`, { headers: { cookie: portalCookie } });
    assert.equal(me.status, 200);
    const data = await me.json();
    assert.equal(data.client.name, 'Utilisateur email');
    assert.equal(data.client.email, 'user@example.com');

    // Le code est à usage unique.
    const replay = await portalPost(started.url, '/email/verify', { email: 'user@example.com', code });
    assert.equal(replay.status, 401);

    // Audit.
    const adminCookie = cookie;
    const audit = await fetch(`${started.url}/admin/api/audit?limit=50`, { headers: { cookie: adminCookie } });
    const actions = (await audit.json()).rows.map((row) => row.action);
    assert.ok(actions.includes('portal.email.requested'));
    assert.ok(actions.includes('portal.login.email'));
  } finally {
    await started.close();
  }
});

test('email OTP : anti-spam, unicité et clé API toujours valide', async () => {
  const { started, mailer } = await startServer();
  try {
    const cookie = await adminLogin(started.url);
    const first = await createClient(started.url, cookie, { name: 'Premier', email: 'premier@example.com' });
    assert.equal(first.status, 201);
    const second = await createClient(started.url, cookie, { name: 'Second', email: 'premier@example.com' });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, 'duplicate_email');

    const firstRequest = await portalPost(started.url, '/email/request', { email: 'premier@example.com' });
    assert.equal(firstRequest.status, 200);
    const firstData = await firstRequest.json();
    assert.equal(firstData.sent, true);
    assert.equal(firstData.sends_in_window, 1);
    assert.equal(firstData.max_sends, 0, 'pas de plafond par email');
    assert.ok(firstData.resend_in_seconds > 0);
    const code = mailer.sent[0].code;
    const before = mailer.sent.length;
    const again = await portalPost(started.url, '/email/request', { email: 'premier@example.com' });
    assert.equal(again.status, 429);
    const againBody = await again.json();
    assert.equal(againBody.error.code, 'email_cooldown');
    assert.ok(againBody.retry_after_seconds > 0);
    assert.equal(mailer.sent.length, before, 'cooldown : aucun second envoi immédiat');

    // La connexion par clé reste disponible et renvoie la méthode.
    const keyLogin = await portalPost(started.url, '/login', { key: (await first.json()).key });
    assert.equal(keyLogin.status, 200);
    assert.equal((await keyLogin.json()).method, 'api_key');

    // Le code reste utilisable.
    const verify = await portalPost(started.url, '/email/verify', { email: 'premier@example.com', code });
    assert.equal(verify.status, 200);
  } finally {
    await started.close();
  }
});

test('email OTP : 5 codes errones invalident le code', async () => {
  const { started, mailer } = await startServer();
  try {
    const cookie = await adminLogin(started.url);
    await createClient(started.url, cookie, { name: 'Brute force', email: 'brute@example.com' });
    await portalPost(started.url, '/email/request', { email: 'brute@example.com' });
    const code = mailer.sent[0].code;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      const res = await portalPost(started.url, '/email/verify', { email: 'brute@example.com', code: wrong });
      assert.equal(res.status, 401);
    }
    const correct = await portalPost(started.url, '/email/verify', { email: 'brute@example.com', code });
    assert.equal(correct.status, 401, 'le code doit être invalidé après trop de tentatives');
  } finally {
    await started.close();
  }
});

test('mailer : construction du message et transport Resend', async () => {
  const email = buildPortalCodeEmail({
    to: 'ami@example.com',
    code: '123456',
    minutes: 10,
    from: 'no-reply@mail.example.com',
    fromName: 'VALARIA Gateway API',
  });
  assert.match(email.subject, /123456/);
  assert.match(email.message, /To: <ami@example.com>/);
  assert.match(email.html, /123456/);

  const received = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"id":"test"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const mailer = createMailer({
      mailTransport: 'resend',
      resendApiKey: 're_test',
      resendApiBase: `http://127.0.0.1:${server.address().port}`,
      mailFrom: 'no-reply@mail.example.com',
      mailFromName: 'VALARIA Gateway API',
      emailLoginEnabled: true,
    }, silentLogger);
    await mailer.sendPortalCode({ to: 'ami@example.com', code: '123456', minutes: 10 });
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/emails');
    assert.equal(received[0].auth, 'Bearer re_test');
    assert.deepEqual(received[0].body.to, ['ami@example.com']);
    assert.match(received[0].body.html, /123456/);
  } finally {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
  }
});

test('mailer : URL SMTP et mode console', async () => {
  const smtp = parseSmtpUrl('smtps://user%40gmail.com:app-password@smtp.gmail.com:465');
  assert.equal(smtp.host, 'smtp.gmail.com');
  assert.equal(smtp.port, 465);
  assert.equal(smtp.secure, true);
  assert.equal(smtp.user, 'user@gmail.com');

  const logs = [];
  const mailer = createMailer({
    mailTransport: 'console',
    mailFrom: '',
    emailLoginEnabled: true,
  }, { warn: (message) => logs.push(message), info() {}, error() {}, debug() {} });
  const result = await mailer.sendPortalCode({ to: 'ami@example.com', code: '654321', minutes: 10 });
  assert.equal(result.ok, true);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /654321/);
});

