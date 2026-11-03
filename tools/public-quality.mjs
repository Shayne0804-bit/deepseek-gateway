// Audit qualite web (site public, portail, console) : HTTP + rendu Chrome headless.
// Mesure les delais, poids transferes, erreurs JS, CLS, long tasks et la semantique
// d'accessibilite de base. Produit docs/quality-report.json.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs');
const PORT = 8898;
const DEBUG_PORT = 9930 + Math.floor(Math.random() * 200);
const ADMIN_PASSWORD = 'quality-admin-password-123';
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find((candidate) => fs.existsSync(candidate));
if (!CHROME) {
  console.error('Aucun navigateur Chromium trouve. Definissez CHROME_PATH.');
  process.exit(1);
}

function startMockUpstream() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url.endsWith('/models')) res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }] }));
    else {
      res.end(JSON.stringify({
        id: 'quality', object: 'chat.completion', model: 'deepseek-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

async function adminFetch(cookie, pathname, options = {}) {
  const res = await fetch(BASE + pathname, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin', ...(cookie ? { cookie } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* ignore */ }
  return { res, data };
}

function meta(html) {
  const get = (regex) => (html.match(regex) || [])[1] ?? null;
  return {
    title: get(/<title>([^<]*)<\/title>/i),
    description: get(/<meta\s+name="description"\s+content="([^"]*)"/i),
    robots: get(/<meta\s+name="robots"\s+content="([^"]*)"/i),
    lang: get(/<html\s+lang="([^"]*)"/i),
    h1: (html.match(/<h1[\s>]/gi) || []).length,
    h2: (html.match(/<h2[\s>]/gi) || []).length,
    skipLink: /class="skip-link"/.test(html),
    inlineScripts: (html.match(/<script(?![^>]*src=)[^>]*>/gi) || []).length,
    images: (html.match(/<img\s/gi) || []).length,
  };
}

async function main() {
  const mock = await startMockUpstream();
  const dataDir = fs.mkdtempSync(path.join(process.env.TEMP, 'dsq-data-'));
  const { startGateway } = await import(`file:///${ROOT.replace(/\\/g, '/')}/src/app.js`);
  const gateway = await startGateway({
    dataDir,
    host: '127.0.0.1',
    port: PORT,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    providerApiKey: 'sk-quality',
    providerBaseUrl: mock.url,
    adminPassword: ADMIN_PASSWORD,
    publicBaseUrl: 'https://api.mon-domaine.fr',
    logLevel: 'error',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });

  const login = await adminFetch(null, '/admin/api/login', { method: 'POST', body: { password: ADMIN_PASSWORD } });
  const cookie = login.res.headers.getSetCookie()[0].split(';')[0];
  const created = await adminFetch(cookie, '/admin/api/clients', { method: 'POST', body: { name: 'Client qualite', quotaTokens: 500000, period: 'monthly' } });
  if (!created.res.ok) throw new Error('Creation client qualite impossible');
  const client = created.data.client;
  const portalLogin = await fetch(`${BASE}/portal/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-portal' },
    body: JSON.stringify({ key: created.data.key }),
  });
  const portalCookie = portalLogin.headers.getSetCookie()[0].split(';')[0];
  const portalToken = portalCookie.slice(portalCookie.indexOf('=') + 1);

  /* ------------------------------ HTTP ------------------------------- */
  const pages = [
    { name: 'landing', path: '/', cookie: null },
    { name: 'admin-login', path: '/admin', cookie: null },
    { name: 'portal-login', path: '/portal', cookie: null },
    { name: 'portal-dashboard', path: '/portal', cookie: portalCookie },
  ];
  const httpResults = [];
  for (const page of pages) {
    const started = performance.now();
    const res = await fetch(BASE + page.path, { headers: page.cookie ? { cookie: page.cookie } : {} });
    const html = await res.text();
    const durationMs = Math.round(performance.now() - started);
    httpResults.push({
      name: page.name,
      path: page.path,
      status: res.status,
      durationMs,
      bytes: Buffer.byteLength(html),
      contentType: res.headers.get('content-type'),
      headers: {
        csp: Boolean(res.headers.get('content-security-policy')),
        xfo: res.headers.get('x-frame-options'),
        permissionsPolicy: Boolean(res.headers.get('permissions-policy')),
        coop: res.headers.get('cross-origin-opener-policy'),
        requestId: Boolean(res.headers.get('x-request-id')),
      },
      ...meta(html),
    });
  }

  // Liens internes de la page publique : statut verifie.
  const landingHtml = await (await fetch(`${BASE}/`)).text();
  const links = [...new Set(Array.from(landingHtml.matchAll(/href="(\/[^"#]*)"/g), (match) => match[1]))];
  const linkResults = [];
  for (const link of links) {
    const res = await fetch(BASE + link, { method: 'HEAD' });
    linkResults.push({ link, status: res.status });
  }

  /* ----------------------------- Chrome ------------------------------ */
  const profile = fs.mkdtempSync(path.join(process.env.TEMP, 'dsq-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--mute-audio', '--force-device-scale-factor=1',
    '--window-size=1440,900', `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank',
  ], { stdio: 'ignore' });
  let browserWs;
  for (let i = 0; i < 120; i += 1) {
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
  const errors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.text ?? 'exception');
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
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
  await s('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__q = { errors: [], longTasks: [], cls: 0 };
      addEventListener('error', (e) => window.__q.errors.push(String(e.message)));
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__q.longTasks.push(entry.duration); }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) { if (!entry.hadRecentInput) window.__q.cls += entry.value; } }).observe({ type: 'layout-shift', buffered: true });`,
  });
  await s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  async function waitFor(expression, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = await s('Runtime.evaluate', { expression, returnByValue: true });
      if (result.result?.value) return true;
      await sleep(120);
    }
    return false;
  }

  async function rendered(url, expectExpression, withPortalCookie = false) {
    if (withPortalCookie) {
      await s('Network.setCookie', { name: 'dsk_portal', value: portalToken, domain: '127.0.0.1', path: '/', httpOnly: true });
    } else {
      await s('Network.clearBrowserCookies');
    }
    await s('Page.navigate', { url });
    await waitFor("document.readyState === 'complete'");
    await waitFor(expectExpression);
    await sleep(350);
    return s('Runtime.evaluate', {
      expression: `(() => {
        const nav = performance.getEntriesByType('navigation')[0] ?? {};
        const resources = performance.getEntriesByType('resource');
        const q = window.__q ?? { errors: [], longTasks: [], cls: 0 };
        const text = (el) => (el?.textContent ?? '').trim();
        const labelled = (el) => Boolean(el.closest('label') || el.getAttribute('aria-label') || (el.id && document.querySelector('label[for="' + el.id + '"]')));
        const images = Array.from(document.images).filter((img) => !img.hasAttribute('alt')).length;
        const emptyLinks = Array.from(document.querySelectorAll('a')).filter((a) => !text(a) && !a.getAttribute('aria-label')).length;
        const emptyButtons = Array.from(document.querySelectorAll('button')).filter((b) => !text(b) && !b.getAttribute('aria-label')).length;
        const fields = Array.from(document.querySelectorAll('input, select, textarea'));
        return {
          title: document.title,
          lang: document.documentElement.lang,
          h1Count: document.querySelectorAll('h1').length,
          landmarks: { header: document.querySelectorAll('header').length, nav: document.querySelectorAll('nav').length, main: document.querySelectorAll('main').length, footer: document.querySelectorAll('footer').length },
          skipLink: Boolean(document.querySelector('.skip-link')),
          fields: fields.length,
          unlabeledFields: fields.filter((el) => !labelled(el)).length,
          imagesWithoutAlt: images,
          emptyLinks,
          emptyButtons,
          domNodes: document.getElementsByTagName('*').length,
          timing: {
            domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd ?? 0),
            loadMs: Math.round(nav.loadEventEnd ?? 0),
            responseMs: Math.round(nav.responseEnd ?? 0),
            transferBytes: Math.round(nav.transferSize ?? 0),
            resources: resources.length,
            resourceBytes: Math.round(resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0)),
          },
          cls: Math.round((q.cls ?? 0) * 1000) / 1000,
          longTasks: (q.longTasks ?? []).length,
          pageErrors: (q.errors ?? []).length,
        };
      })()`,
      returnByValue: true,
    }).then((result) => result.result?.value);
  }

  const renderedResults = {};
  renderedResults.landing = await rendered(`${BASE}/`, "document.querySelector('.hero h1')");
  renderedResults['admin-login'] = await rendered(`${BASE}/admin`, "document.querySelector('#login-view')");
  renderedResults['portal-login'] = await rendered(`${BASE}/portal`, "document.querySelector('#login-view')");
  renderedResults['portal-dashboard'] = await rendered(`${BASE}/portal`, "document.querySelector('#portal-quotas') && document.querySelector('#portal-quotas').innerText.trim().length > 5", true);

  const report = {
    generatedAt: new Date().toISOString(),
    target: '3 surfaces : site public (/), console admin (/admin), espace utilisateur (/portal)',
    http: httpResults,
    internalLinks: linkResults,
    rendered: renderedResults,
    jsErrors: errors,
    knownLimitations: [
      'Mesures lab (Chrome headless, 1440x900) : pas de donnees terrain CrUX (instance privee, noindex).',
      'Lighthouse/axe non installes : couverture a11y automatisee complementaire dans docs/theme/checks.json (contraste, focus, cibles tactiles).',
      'Les pages sont marquees noindex : SEO volontairement limite pour une instance privee.',
    ],
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'quality-report.json'), JSON.stringify(report, null, 2));

  console.log('--- HTTP ---');
  for (const page of httpResults) {
    console.log(`${page.name.padEnd(18)} ${page.status} ${String(page.bytes).padStart(6)} o ${String(page.durationMs).padStart(4)} ms | h1=${page.h1} lang=${page.lang} robots=${page.robots} skip=${page.skipLink} inlineScripts=${page.inlineScripts}`);
  }
  console.log('\n--- RENDERED ---');
  for (const [name, value] of Object.entries(renderedResults)) {
    console.log(`${name.padEnd(18)} DCL=${value.timing.domContentLoadedMs}ms load=${value.timing.loadMs}ms res=${value.timing.resources} (${value.timing.resourceBytes} o) CLS=${value.cls} longTasks=${value.longTasks} pagesErrors=${value.pageErrors} fields=${value.fields}/${value.unlabeledFields} sansAlt=${value.imagesWithoutAlt} liensVides=${value.emptyLinks}`);
  }
  const brokenLinks = linkResults.filter((item) => item.status >= 400);
  console.log('\nliens internes:', linkResults.length, '| casses:', brokenLinks.length);
  console.log('erreurs JS globales:', errors.length ? errors : 'aucune');

  try { await send('Target.closeTarget', { targetId }); } catch { /* ignore */ }
  ws.close();
  chrome.kill();
  await sleep(500);
  await gateway.close();
  await new Promise((resolve) => { mock.server.close(resolve); mock.server.closeAllConnections?.(); });
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(errors.length || brokenLinks.length ? 2 : 0);
}

main().catch((err) => {
  console.error('ECHEC:', err);
  process.exit(1);
});
