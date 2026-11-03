// Capture d'ecran du panneau VALARIA Gateway API avec Chrome headless (CDP).
// Usage interne : valide le rendu reel de l'interface et les erreurs JS.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!CHROME) {
  console.error('Aucun navigateur Chromium trouve. Definissez CHROME_PATH.');
  process.exit(1);
}
const GATEWAY_PORT = 8899;
const DEBUG_PORT = 9720 + Math.floor(Math.random() * 200);
const ADMIN_PASSWORD = 'demo-password-2026';
const ADMIN_URL = `http://127.0.0.1:${GATEWAY_PORT}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------------------- mock upstream ---------------------------- */

function startMockUpstream() {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }));
      return;
    }
    const prompt = 900 + Math.floor(Math.random() * 4000);
    const completion = 120 + Math.floor(Math.random() * 1400);
    const usage = {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      prompt_cache_hit_tokens: Math.floor(prompt * 0.4),
      prompt_cache_miss_tokens: prompt - Math.floor(prompt * 0.4),
    };
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      res.write(`data: ${JSON.stringify({ id: 'demo', model: body.model, choices: [{ delta: { content: 'Bonjour' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'demo', model: body.model, choices: [{ delta: { content: ' !' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'demo', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'demo',
      object: 'chat.completion',
      model: body.model ?? 'deepseek-flash',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Demo' }, finish_reason: 'stop' }],
      usage,
    }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
  }));
}

/* ------------------------------- seeding ------------------------------- */

async function adminFetch(cookie, pathname, options = {}) {
  const headers = { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(ADMIN_URL + pathname, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* ignore */ }
  return { res, data };
}

async function main() {
  const mock = await startMockUpstream();
  const dataDir = fs.mkdtempSync(path.join(process.env.TEMP, 'dsg-demo-'));
  const { startGateway } = await import(`file:///${ROOT.replace(/\\/g, '/')}/src/app.js`);
  const silentLogger = { debug() {}, info() {}, warn() {}, error: (m) => console.error('[gateway]', m) };
  const gateway = await startGateway({
    dataDir,
    host: '127.0.0.1',
    port: GATEWAY_PORT,
    // Isolation : on n'active pas le HTTPS du .env local pour la demonstration.
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    providerApiKey: 'sk-demo-original',
    providerBaseUrl: mock.url,
    mailTransport: 'console',
    adminPassword: ADMIN_PASSWORD,
    publicBaseUrl: 'https://api.mon-domaine.fr',
    logLevel: 'error',
    logger: silentLogger,
  });

  const loginRes = await fetch(`${ADMIN_URL}/admin/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const cookieHeader = loginRes.headers.getSetCookie()[0];
  const cookie = cookieHeader.split(';')[0];
  const sessionToken = cookie.slice(cookie.indexOf('=') + 1);

  const specs = [
    { name: 'Léa — projet perso', quotaTokens: 2000000, period: 'monthly', rpmLimit: 30, note: 'Amie — usage quotidien', allowedModels: null },
    { name: 'Marc — cours Python', quotaRequests: 300, quotaUsd: 1.5, period: 'monthly', note: 'Étudiant — quota serré' },
    { name: 'Équipe proto jeu', quotaTokens: 500000, period: 'daily', maxOutputTokens: 4096, concurrencyLimit: 2, note: 'Prototype — remis à zéro chaque jour' },
    { name: 'Ancien test (désactivé)', quotaTokens: 100000, period: 'total', enabled: false, note: 'Désactivée le mois dernier' },
    { name: 'Sandbox illimitée', period: 'total', note: 'Accès de confiance, sans quota' },
  ];
  const clients = [];
  for (const spec of specs) {
    const { res, data } = await adminFetch(cookie, '/admin/api/clients', { method: 'POST', body: spec });
    if (!res.ok) throw new Error(`Creation client: ${JSON.stringify(data)}`);
    clients.push({ ...data.client, key: data.key });
  }

  // Quelques vraies requetes via le proxy (pour les journaux et l'activite du jour).
  const models = ['deepseek-flash', 'deepseek-flash', 'deepseek-v4-pro'];
  for (const client of clients.slice(0, 3)) {
    for (let i = 0; i < 5; i += 1) {
      const model = models[i % models.length];
      const stream = i === 2;
      const res = await fetch(`${ADMIN_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${client.key}` },
        body: JSON.stringify({ model, stream, messages: [{ role: 'user', content: `Démo ${i}` }] }),
      });
      await res.text();
    }
  }

  // Historique de consommation sur 30 jours (donnees de demonstration).
  const insert = gateway.db.prepare(
    `INSERT INTO usage_logs (client_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, status, streamed, estimated, latency_ms, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 200, ?, 0, ?, NULL, ?)`,
  );
  for (let day = 29; day >= 0; day -= 1) {
    const date = new Date(Date.now() - day * 86400000);
    const activity = day === 0 ? 0 : 2 + Math.floor(Math.random() * 5) + (day < 7 ? 3 : 0);
    for (let i = 0; i < activity; i += 1) {
      const client = clients[i % 3];
      const prompt = 1500 + Math.floor(Math.random() * 9000);
      const completion = 200 + Math.floor(Math.random() * 2500);
      const model = Math.random() > 0.75 ? 'deepseek-v4-pro' : 'deepseek-flash';
      const cost = (prompt / 1e6) * 0.3 + (completion / 1e6) * 1.2;
      const ts = new Date(date.getTime() - Math.floor(Math.random() * 3600000 * 8));
      insert.run(
        client.id, model, prompt, completion, prompt + completion,
        Math.round(cost * 1e6) / 1e6, Math.random() > 0.7 ? 1 : 0,
        400 + Math.floor(Math.random() * 4000), ts.toISOString(),
      );
    }
  }

  // Session portail pour les captures de l'espace utilisateur.
  const portalLogin = await fetch(`${ADMIN_URL}/portal/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-portal' },
    body: JSON.stringify({ key: clients[0].key }),
  });
  if (!portalLogin.ok) throw new Error(`Connexion portail : HTTP ${portalLogin.status}`);
  const portalCookie = portalLogin.headers.getSetCookie()[0].split(';')[0];
  const portalToken = portalCookie.slice(portalCookie.indexOf('=') + 1);

  /* ------------------------------ Chrome ------------------------------ */
  const profile = fs.mkdtempSync(path.join(process.env.TEMP, 'dsg-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--mute-audio',
    '--force-device-scale-factor=1', '--window-size=1460,1020',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let browserWs;
  for (let i = 0; i < 100; i += 1) {
    try {
      const info = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
      browserWs = info.webSocketDebuggerUrl;
      if (browserWs) break;
    } catch { /* pas pret */ }
    await sleep(150);
  }
  if (!browserWs) throw new Error('Chrome CDP indisponible');

  const ws = new WebSocket(browserWs);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const jsErrors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      jsErrors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? 'exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      jsErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => send(method, params, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Network.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: 1460, height: 1020, deviceScaleFactor: 1, mobile: false });

  async function waitFor(expression, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const result = await s('Runtime.evaluate', { expression, returnByValue: true });
        if (result.result?.value) return true;
      } catch { /* retry */ }
      await sleep(180);
    }
    return false;
  }

  async function navigate(url) {
    await s('Page.navigate', { url });
    await sleep(300);
    await waitFor("document.readyState === 'complete'");
  }

  async function screenshot(name) {
    await s('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' });
    await sleep(220);
    const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot:', name);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  async function setViewport(width, height, mobile = false) {
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  }

  // 0. Site public (desktop + mobile).
  await navigate(`${ADMIN_URL}/`);
  await waitFor("document.querySelector('.hero h1') !== null");
  await sleep(500);
  await screenshot('landing-desktop.png');
  await setViewport(390, 844, true);
  await navigate(`${ADMIN_URL}/`);
  await waitFor("document.querySelector('.hero h1') !== null");
  await sleep(400);
  await screenshot('landing-mobile.png');
  await setViewport(1440, 900);

  // 0b. Espace utilisateur : connexion puis tableau de bord.
  await navigate(`${ADMIN_URL}/portal`);
  await waitFor("document.querySelector('#login-view') && !document.querySelector('#login-view').classList.contains('hidden')");
  await sleep(300);
  await screenshot('portal-login.png');

  await s('Network.setCookie', { name: 'dsk_portal', value: portalToken, domain: '127.0.0.1', path: '/', httpOnly: true });
  await navigate(`${ADMIN_URL}/portal`);
  await waitFor("document.querySelector('#portal-app') && !document.querySelector('#portal-app').classList.contains('hidden') && document.querySelector('#portal-quotas').innerText.trim().length > 10");
  await sleep(800);
  await screenshot('portal-dashboard.png');
  await setViewport(390, 844, true);
  await navigate(`${ADMIN_URL}/portal`);
  await waitFor("document.querySelector('#portal-quotas') && document.querySelector('#portal-quotas').innerText.trim().length > 10");
  await sleep(700);
  await screenshot('portal-mobile.png');
  await setViewport(1440, 900);

  // 1. Page de connexion admin (sans cookie).
  await navigate(`${ADMIN_URL}/admin`);
  await waitFor("!document.querySelector('#login-view').classList.contains('hidden')");
  await sleep(300);
  await screenshot('panel-login.png');

  // 2. Session admin puis vues principales.
  await s('Network.setCookie', { name: 'dsk_admin', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true });
  await navigate(`${ADMIN_URL}/admin`);
  await waitFor("document.querySelector('#view') && document.querySelector('#view').innerText.trim().length > 40");
  await sleep(700);
  await screenshot('panel-overview.png');

  async function gotoView(view, name) {
    await s('Runtime.evaluate', { expression: `document.querySelector('[data-nav="${view}"]').click()` });
    await sleep(400);
    await waitFor(`document.querySelector('#view').innerText.trim().length > 40 && document.querySelector('[data-nav="${view}"]').classList.contains('active')`);
    await sleep(650);
    await screenshot(name);
  }

  await gotoView('clients', 'panel-clients.png');
  await gotoView('logs', 'panel-logs.png');
  await gotoView('settings', 'panel-settings.png');
  await gotoView('guide', 'panel-guide.png');

  // 3. Modale de creation de cle (verification du formulaire).
  await s('Runtime.evaluate', { expression: "document.querySelector('[data-nav=\"clients\"]').click()" });
  await sleep(500);
  await s('Runtime.evaluate', { expression: "document.querySelector('[data-action=\"create-client\"]').click()" });
  await sleep(500);
  await screenshot('panel-new-key.png');
  await s('Runtime.evaluate', { expression: 'document.querySelector(\'[data-close]\').click()' });

  console.log('Erreurs JS detectees:', jsErrors.length ? jsErrors : 'aucune');
  console.log('URL', ADMIN_URL, '| clients:', clients.length);

  try { await send('Target.closeTarget', { targetId }); } catch { /* ignore */ }
  ws.close();
  chrome.kill();
  await sleep(700);
  await gateway.close();
  await new Promise((resolve) => { mock.server.close(resolve); mock.server.closeAllConnections?.(); });
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* chrome peut encore verrouiller le profil */ }
  process.exit(jsErrors.length ? 2 : 0);
}

main().catch((err) => {
  console.error('ECHEC:', err);
  process.exit(1);
});


