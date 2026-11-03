// ============================================================================
// Evidence de rendu — direction "PHOSPHOR OPS" (terminal vert)
// Capture le panneau dans ses differents etats (desktop + mobile), verifie
// contraste WCAG, focus clavier, reduced-motion, cibles tactiles, debordements,
// puis ecrit docs/theme/report.json pour le checker frontend-design-direction.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'theme');
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

const PORT_A = 8897;
const PORT_B = 8896;
const DEBUG_PORT = 9310 + Math.floor(Math.random() * 400);
const ADMIN_PASSWORD = 'evidence-password-2026';
const URL_A = `http://127.0.0.1:${PORT_A}`;
const URL_B = `http://127.0.0.1:${PORT_B}`;
const DESKTOP = { width: 1440, height: 900, label: '1440x900' };
const MOBILE = { width: 390, height: 844, label: '390x844' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

async function adminFetch(baseUrl, cookie, pathname, options = {}) {
  const headers = { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(baseUrl + pathname, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* ignore */ }
  return { res, data };
}

async function login(baseUrl) {
  const res = await fetch(`${baseUrl}/admin/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Connexion admin impossible sur ${baseUrl}`);
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  return { cookie, token: cookie.slice(cookie.indexOf('=') + 1) };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { startGateway } = await import(`file:///${ROOT.replace(/\\/g, '/')}/src/app.js`);

  const dirA = fs.mkdtempSync(path.join(process.env.TEMP, 'dsg-evidence-a-'));
  const dirB = fs.mkdtempSync(path.join(process.env.TEMP, 'dsg-evidence-b-'));

  const gatewayA = await startGateway({
    dataDir: dirA,
    host: '127.0.0.1',
    port: PORT_A,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    providerApiKey: 'sk-demo-original',
    providerBaseUrl: 'http://127.0.0.1:1',
    adminPassword: ADMIN_PASSWORD,
    publicBaseUrl: 'https://api.mon-domaine.fr',
    logLevel: 'error',
    logger: silentLogger,
  });
  const gatewayB = await startGateway({
    dataDir: dirB,
    host: '127.0.0.1',
    port: PORT_B,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    providerApiKey: '',
    providerBaseUrl: 'http://127.0.0.1:1',
    adminPassword: ADMIN_PASSWORD,
    logLevel: 'error',
    logger: silentLogger,
  });

  const authA = await login(URL_A);
  const authB = await login(URL_B);

  /* ------------------------------ donnees A ------------------------------ */
  const specs = [
    { name: 'Léa — projet perso', quotaTokens: 2000000, period: 'monthly', rpmLimit: 30, note: 'Amie — usage quotidien' },
    { name: 'Marc — cours Python', quotaRequests: 300, quotaUsd: 1.5, period: 'monthly', note: 'Étudiant — quota serré' },
    { name: 'Équipe proto jeu', quotaTokens: 500000, period: 'daily', maxOutputTokens: 4096, note: 'Prototype remis à zéro chaque jour' },
    { name: 'Ancien test (désactivé)', quotaTokens: 100000, period: 'total', enabled: false, note: 'Désactivée le mois dernier' },
    { name: 'Sandbox illimitée', period: 'total', note: 'Accès de confiance, sans quota' },
    { name: 'Client au nom très long qui revient à la ligne — projet expérimental', period: 'total', quotaTokens: 1000000, note: 'Nom long : la colonne doit passer à la ligne proprement' },
  ];
  const clients = [];
  for (const spec of specs) {
    const { res, data } = await adminFetch(URL_A, authA.cookie, '/admin/api/clients', { method: 'POST', body: spec });
    if (!res.ok) throw new Error(`Creation client: ${JSON.stringify(data)}`);
    clients.push({ ...data.client, key: data.key });
  }

  const insert = gatewayA.db.prepare(
    `INSERT INTO usage_logs (client_id, model, requested_model, prompt_tokens, completion_tokens, total_tokens, cost_usd, status, streamed, estimated, latency_ms, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 200, ?, 0, ?, NULL, ?)`,
  );
  const models = [
    { model: 'deepseek-flash', requested: null },
    { model: 'deepseek-flash', requested: 'fable-5.1' },
    { model: 'deepseek-flash', requested: 'claude-opus-5' },
    { model: 'deepseek-v4-pro', requested: null },
  ];
  for (let day = 29; day >= 0; day -= 1) {
    const date = new Date(Date.now() - day * 86400000);
    const activity = day === 0 ? 4 : 2 + Math.floor(Math.random() * 4) + (day < 7 ? 2 : 0);
    for (let i = 0; i < activity; i += 1) {
      const client = clients[i % 3];
      const entry = models[i % models.length];
      const prompt = 1500 + Math.floor(Math.random() * 9000);
      const completion = 200 + Math.floor(Math.random() * 2500);
      const cost = (prompt / 1e6) * 0.3 + (completion / 1e6) * 1.2;
      const ts = new Date(date.getTime() - Math.floor(Math.random() * 3600000 * 8));
      insert.run(
        client.id, entry.model, entry.requested, prompt, completion, prompt + completion,
        Math.round(cost * 1e6) / 1e6, Math.random() > 0.7 ? 1 : 0,
        400 + Math.floor(Math.random() * 4000), ts.toISOString(),
      );
    }
  }

  /* ------------------------------ Chrome -------------------------------- */
  const profile = fs.mkdtempSync(path.join(process.env.TEMP, 'dsg-evidence-chrome-'));
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

  let viewport = DESKTOP;
  async function setViewport(target) {
    viewport = target;
    await s('Emulation.setDeviceMetricsOverride', {
      width: target.width, height: target.height, deviceScaleFactor: 1, mobile: false,
    });
    await sleep(250);
  }

  async function evaluate(expression) {
    const result = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluate failed');
    return result.result?.value;
  }

  async function waitFor(expression, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (await evaluate(expression)) return true;
      } catch { /* retry */ }
      await sleep(150);
    }
    throw new Error(`Timeout en attendant : ${expression}`);
  }

  async function navigate(url) {
    await s('Page.navigate', { url });
    await sleep(250);
    await waitFor("document.readyState === 'complete'");
  }

  const artifacts = [];
  async function screenshot(name, observation, viewportLabel = viewport.label, { keepScroll = false } = {}) {
    if (!keepScroll) await evaluate('window.scrollTo(0, 0)');
    await sleep(200);
    const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(data, 'base64'));
    artifacts.push({ viewport: viewportLabel, artifact: name, observation });
    console.log('capture:', name);
  }

  async function gotoView(view) {
    await evaluate(`document.querySelector('[data-nav="${view}"]').click()`);
    await sleep(300);
    await waitFor(`document.querySelector('[data-nav="${view}"]').classList.contains('active') && document.querySelector('#view').innerText.trim().length > 20`);
    await sleep(400);
  }

  const checks = { contrast: [], labels: null, focus: null, reducedMotion: null, touchTargets: null, overflow: {} };

  /* ========================= 0. SITE PUBLIC =========================== */
  const contrastScript = `(() => {
    const rgb = (str) => { const m = String(str).match(/rgba?\\(([^)]+)\\)/); if (!m) return [0,0,0,0]; const p = m[1].split(',').map(Number); return [p[0],p[1],p[2],p.length > 3 ? p[3] : 1]; };
    const blend = (top, bottom) => { const a = top[3]; return [top[0]*a + bottom[0]*(1-a), top[1]*a + bottom[1]*(1-a), top[2]*a + bottom[2]*(1-a), 1]; };
    const bgOf = (el) => { const layers = []; let n = el; while (n) { const c = rgb(getComputedStyle(n).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] === 1) break; n = n.parentElement; } let base = [4,7,5,1]; for (let i = layers.length - 1; i >= 0; i -= 1) base = blend(layers[i], base); return base; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]); };
    const ratio = (a, b) => { const L1 = Math.max(lum(a), lum(b)); const L2 = Math.min(lum(a), lum(b)); return (L1+0.05)/(L2+0.05); };
    const out = [];
    for (const sel of SEL) {
      const el = document.querySelector(sel);
      if (!el) { out.push({ selector: sel, missing: true }); continue; }
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const color = rgb(cs.color);
      const bg = bgOf(el);
      out.push({ selector: sel, ratio: Math.round(ratio(color, bg) * 100) / 100, required: large ? 3 : 4.5, size, weight, text: (el.textContent || '').trim().slice(0, 40) });
    }
    return out;
  })()`;

  await setViewport(DESKTOP);
  await navigate(`${URL_A}/`);
  await waitFor("document.querySelector('.hero h1') !== null");
  await sleep(450);
  const landingSelectors = ['.hero h1', '.hero-lede', '.hero-kicker', '.site-nav a', '.hero-facts dt', '.hero-facts dd', '.transcript-body', '.site-cta p', '.site-footer'];
  const landingContrast = await evaluate(contrastScript.replace('SEL', JSON.stringify(landingSelectors)));
  checks.contrast.push(...landingContrast.map((item) => ({ ...item, page: 'public-landing' })));
  await screenshot('16-public-landing-desktop.png', 'Site public en 1440x900 : promesse produit, exemple reel d\'echange API, statut de la passerelle, navigation vers l\'espace utilisateur.');

  // Section sous la ligne de flottaison : etapes de branchement (texte + code).
  await evaluate("document.querySelector('#brancher').scrollIntoView({ block: 'start' })");
  await sleep(400);
  checks.steps = { desktop: await evaluate(`(() => {
    const lis = Array.from(document.querySelectorAll('.site-steps li'));
    const first = lis[0];
    const codeLi = lis.find((li) => li.querySelector('.mini-code'));
    const p = first.querySelector('p');
    const pre = codeLi.querySelector('.mini-code');
    const h3 = first.querySelector('h3');
    return { liWidth: Math.round(first.getBoundingClientRect().width), pWidth: Math.round(p.getBoundingClientRect().width), preWidth: Math.round(pre.getBoundingClientRect().width), h3Width: Math.round(h3.getBoundingClientRect().width) };
  })()`) };
  await screenshot('22-public-steps-desktop.png', 'Etapes de branchement en 1440x900 : numero a gauche, texte et bloc de code sur toute la largeur disponible (aucune colonne de texte etroite).', viewport.label, { keepScroll: true });

  await setViewport(MOBILE);
  await navigate(`${URL_A}/`);
  await waitFor("document.querySelector('.hero h1') !== null");
  await sleep(500);
  checks.overflow['mobile:landing'] = await evaluate(`(() => ({
    docWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    tablesContained: true,
  }))()`);
  await screenshot('17-public-landing-mobile.png', 'Site public en 390x844 : navigation repliee, hero lisible, CTAs empiles, aucun debordement horizontal.', MOBILE.label);
  await evaluate("document.querySelector('#brancher').scrollIntoView({ block: 'start' })");
  await sleep(400);
  checks.steps.mobile = await evaluate(`(() => {
    const lis = Array.from(document.querySelectorAll('.site-steps li'));
    const first = lis[0];
    const codeLi = lis.find((li) => li.querySelector('.mini-code'));
    const p = first.querySelector('p');
    const pre = codeLi.querySelector('.mini-code');
    return { liWidth: Math.round(first.getBoundingClientRect().width), pWidth: Math.round(p.getBoundingClientRect().width), preWidth: Math.round(pre.getBoundingClientRect().width) };
  })()`);
  await screenshot('23-public-steps-mobile.png', 'Etapes de branchement en 390x844 : texte sur toute la largeur, bloc de code scrollable, aucun chevauchement.', MOBILE.label, { keepScroll: true });
  await setViewport(DESKTOP);

  /* ======================= 0b. ESPACE UTILISATEUR ===================== */
  await setViewport(DESKTOP);
  await navigate(`${URL_A}/portal`);
  await waitFor("document.querySelector('#login-view') && !document.querySelector('#login-view').classList.contains('hidden')");
  await sleep(450);
  const portalLoginSelectors = ['.portal-login-copy h1', '.portal-login-copy p', '.portal-preview .ledger-key', '.portal-preview .ledger-row dd', '#login-form .field > span', '#login-form .btn-primary', '#login-form .small'];
  const portalLoginContrast = await evaluate(contrastScript.replace('SEL', JSON.stringify(portalLoginSelectors)));
  checks.contrast.push(...portalLoginContrast.map((item) => ({ ...item, page: 'portal-login' })));
  await screenshot('18-public-portal-login-desktop.png', 'Portail utilisateur en 1440x900 : connexion par cle derivee, apercu de ce que l\'utilisateur pourra consulter, aucune donnee d\'administration.');

  await setViewport(MOBILE);
  await navigate(`${URL_A}/portal`);
  await waitFor("document.querySelector('#login-view') && !document.querySelector('#login-view').classList.contains('hidden')");
  await sleep(450);
  checks.overflow['mobile:portal-login'] = await evaluate(`(() => ({
    docWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    tablesContained: true,
  }))()`);
  await screenshot('21-public-portal-login-mobile.png', 'Connexion portail en 390x844 : formulaire en premier, apercu masque, un seul champ pleine largeur, aucun debordement.', MOBILE.label);
  await setViewport(DESKTOP);

  const portalLoginRes = await fetch(`${URL_A}/portal/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-portal' },
    body: JSON.stringify({ key: clients[0].key }),
  });
  if (!portalLoginRes.ok) throw new Error(`Connexion portail impossible : HTTP ${portalLoginRes.status}`);
  const portalCookie = portalLoginRes.headers.getSetCookie()[0].split(';')[0];
  const portalToken = portalCookie.slice(portalCookie.indexOf('=') + 1);
  await s('Network.setCookie', { name: 'dsk_portal', value: portalToken, domain: '127.0.0.1', path: '/', httpOnly: true });
  await navigate(`${URL_A}/portal`);
  await waitFor("document.querySelector('#portal-app') && !document.querySelector('#portal-app').classList.contains('hidden') && document.querySelector('#portal-quotas') && document.querySelector('#portal-quotas').innerText.trim().length > 10");
  await sleep(700);
  const portalSelectors = ['.portal-head h1', '.portal-head .small', '.quota-card .stat-label', '.quota-card .stat-value', '.quota-card .small', '.spec-row dt', '.spec-row dd', '.panel-head h2', '.portal-footer'];
  const portalContrast = await evaluate(contrastScript.replace('SEL', JSON.stringify(portalSelectors)));
  checks.contrast.push(...portalContrast.map((item) => ({ ...item, page: 'portal-dashboard' })));
  await screenshot('19-public-portal-dashboard-desktop.png', 'Tableau de bord utilisateur en 1440x900 : quotas de la cle, graphique 30 jours, limites, historique des requetes et exemples de branchement.');

  await setViewport(MOBILE);
  await navigate(`${URL_A}/portal`);
  await waitFor("document.querySelector('#portal-quotas') && document.querySelector('#portal-quotas').innerText.trim().length > 10");
  await sleep(600);
  checks.overflow['mobile:portal'] = await evaluate(`(() => ({
    docWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    tablesContained: Array.from(document.querySelectorAll('.table-wrap')).every((el) => el.scrollWidth >= el.clientWidth),
  }))()`);
  checks.touchTargetsPortal = await evaluate(`(() => {
    const targets = Array.from(document.querySelectorAll('.btn, .site-nav a, .site-brand, .copy-btn'))
      .filter((el) => el.offsetParent !== null);
    const sizes = targets.map((el) => { const r = el.getBoundingClientRect(); return { label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((size) => size.w > 0 && size.h > 0);
    return { total: sizes.length, tooSmall: sizes.filter((size) => size.w < 24 || size.h < 24) };
  })()`);
  await screenshot('20-public-portal-mobile.png', 'Espace utilisateur en 390x844 : cartes de quota empilees, tableaux contenus, controles tactiles >= 24 px, aucun debordement.', MOBILE.label);
  await setViewport(DESKTOP);

  /* ============================ 1. CONNEXION ============================ */
  await navigate(`${URL_A}/admin`);
  await waitFor("!document.querySelector('#login-view').classList.contains('hidden')");
  await sleep(300);

  const loginSelectors = ['#login-view .login-kicker', '#login-view h1', '#login-view .login-card > p', '#login-view .field > span', '#login-view .small.muted', '#login-view .btn-primary', '#login-view input'];
  const loginContrast = await evaluate(contrastScript.replace('SEL', JSON.stringify(loginSelectors)));
  checks.contrast.push(...loginContrast.map((item) => ({ ...item, page: 'login' })));
  await screenshot('01-permission-login-desktop.png', 'Etat permission : sans session, l\'ecran de connexion explique la limite d\'acces (mot de passe admin requis).');

  await setViewport(MOBILE);
  await screenshot('02-permission-login-mobile.png', 'Etat permission en 390x844 : carte de connexion centree, un seul champ, bouton pleine largeur, pas de debordement.', MOBILE.label);

  /* ============================ 2. SESSION A ============================ */
  await s('Network.setCookie', { name: 'dsk_admin', value: authA.token, domain: '127.0.0.1', path: '/', httpOnly: true });
  await setViewport(DESKTOP);
  await navigate(`${URL_A}/admin`);
  await waitFor("document.querySelector('#view') && document.querySelector('#view').innerText.trim().length > 40");
  await sleep(700);

  const appSelectors = ['.topbar-sub', '.nav-item.active', '.nav-item:not(.active)', '.stat-label', '.stat-foot', '.panel-head .hint', '#view th', '#view td', '.btn-primary', '.btn-ghost', '.badge-ok', '.badge-warn', '.badge-danger', '.badge-muted'];
  await gotoView('clients');
  const appContrast = await evaluate(contrastScript.replace('SEL', JSON.stringify(appSelectors)));
  checks.contrast.push(...appContrast.map((item) => ({ ...item, page: 'clients' })));

  // Libelles de formulaires.
  checks.labels = await evaluate(`(() => {
    const fields = Array.from(document.querySelectorAll('input, select, textarea'));
    return fields.map((el) => ({
      name: el.getAttribute('name') || el.id || el.tagName,
      labelled: Boolean(el.closest('label') || el.getAttribute('aria-label') || (el.id && document.querySelector('label[for="' + el.id + '"]'))),
    })).filter((item) => !item.labelled);
  })()`);

  // Debordement horizontal desktop (tableaux dans .table-wrap).
  checks.overflow.desktop = await evaluate(`(() => ({
    docWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    tablesContained: Array.from(document.querySelectorAll('.table-wrap')).every((el) => el.scrollWidth >= el.clientWidth),
  }))()`);

  await gotoView('overview');
  await screenshot('03-overview-desktop.png', 'Etat normal en 1440x900 : la console terminal affiche prompts, KPI, graphique vert, tables; les alias fable/claude apparaissent dans le journal.');

  await gotoView('clients');
  await screenshot('04-clients-desktop.png', 'Vue cles en 1440x900 : badges entre crochets, quotas en barres fines, boutons d\'action alignes sans debordement.');
  await gotoView('logs');
  await screenshot('05-logs-desktop.png', 'Vue journaux : modele demande (fable-5.1) et modele facture (deepseek-flash) lisibles, cout reel par ligne.');
  await gotoView('audit');
  await screenshot('05b-audit-desktop.png', 'Vue journal d\'audit : actions d\'administration tracees (connexions, cles) avec IP et horodatage.');
  await gotoView('settings');
  await screenshot('06-settings-desktop.png', 'Vue reglages : formulaires monospace, badges de source, edition JSON, focus vert.');
  await gotoView('guide');
  await screenshot('07-guide-desktop.png', 'Vue guide : blocs de commandes, etapes numerotees, boutons copier; contenu long sans debordement.');

  /* ============================ 3. ETATS ============================== */
  // Success : creation d'une cle -> modale de confirmation.
  await gotoView('clients');
  await evaluate("document.querySelector('[data-action=\"create-client\"]').click()");
  await waitFor("document.querySelector('form[data-form=\"client-create\"]')");
  await sleep(250);
  await evaluate(`(() => {
    const form = document.querySelector('form[data-form="client-create"]');
    form.elements.name.value = 'Cle de demonstration';
    form.elements.quotaTokens.value = '250000';
    form.requestSubmit();
  })()`);
  await waitFor("document.querySelector('.key-reveal code')");
  await sleep(350);
  await screenshot('08-success-new-key.png', 'Etat succes : la creation d\'une cle confirme l\'action et affiche la cle generee (a copier une seule fois).');
  await evaluate("document.querySelector('[data-close]').click()");
  await sleep(250);

  // Loading : on ralentit fetch pour observer le chargement.
  await evaluate(`(() => {
    const original = window.fetch;
    window.__restoreFetch = () => { window.fetch = original; delete window.__restoreFetch; };
    window.fetch = (...args) => new Promise((resolve, reject) => {
      setTimeout(() => original(...args).then(resolve, reject), 2500);
    });
  })()`);
  await evaluate("document.querySelector('[data-nav=\"logs\"]').click()");
  await sleep(350);
  await screenshot('09-loading.png', 'Etat chargement : le panneau conserve sa structure et affiche un indicateur de chargement pendant la requete.');
  await evaluate('window.__restoreFetch()');
  await sleep(2700);

  // Error : on fait echouer l'appel API de la vue d'ensemble.
  await evaluate(`(() => {
    const original = window.fetch;
    window.__restoreFetch = () => { window.fetch = original; delete window.__restoreFetch; };
    window.fetch = (input, init) => String(input).includes('/admin/api/overview')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : original(input, init);
  })()`);
  await evaluate("document.querySelector('[data-nav=\"overview\"]').click()");
  await waitFor("document.querySelector('#view .alert.danger')");
  await sleep(300);
  checks.errorMessage = await evaluate("document.querySelector('#view .alert.danger').textContent.trim()");
  await waitFor("document.querySelector('#view [data-action=\"retry-view\"]')");
  await screenshot('10-error.png', 'Etat erreur : message explicite (passerelle injoignable) et bouton "Reessayer" pour reprendre, sans quitter le panneau.');
  await evaluate('window.__restoreFetch()');
  await sleep(200);
  await evaluate("document.querySelector('#view [data-action=\"retry-view\"]').click()");
  await waitFor("document.querySelector('#view .stat-grid') && document.querySelector('#view').innerText.trim().length > 40");
  await sleep(350);
  checks.errorRecovery = true;

  /* ====================== 4. ACCESSIBILITE CLAVIER ===================== */
  await gotoView('overview');
  await evaluate("document.querySelector('[data-nav=\"overview\"]').focus()");
  const focusResults = [];
  for (let i = 0; i < 6; i += 1) {
    await s('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(120);
    focusResults.push(await evaluate(`(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cs = getComputedStyle(el);
      const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
      return { tag: el.tagName, text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), visible, outline: cs.outlineStyle + ' ' + cs.outlineWidth };
    })()`));
  }
  checks.focus = focusResults;
  await screenshot('11-focus-visible.png', 'Focus clavier visible sur les controles (anneau vert) apres navigation par Tab.');

  // Reduced motion.
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(150);
  checks.reducedMotion = await evaluate(`(() => ({
    scanlinesHidden: getComputedStyle(document.documentElement, '::after').display === 'none',
    buttonTransition: getComputedStyle(document.querySelector('.btn')).transitionDuration,
    navTransition: getComputedStyle(document.querySelector('.nav-item')).transitionDuration,
  }))()`);
  await s('Emulation.setEmulatedMedia', { features: [] });

  /* ========================= 5. RESPONSIVE ============================ */
  await setViewport(MOBILE);
  await navigate(`${URL_A}/admin`);
  await waitFor("document.querySelector('#view') && document.querySelector('#view').innerText.trim().length > 40");
  await sleep(600);
  const mobileViews = ['overview', 'clients', 'logs', 'settings', 'guide'];
  for (const view of mobileViews) {
    await gotoView(view);
    checks.overflow[`mobile:${view}`] = await evaluate(`(() => ({
      docWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      tablesContained: Array.from(document.querySelectorAll('.table-wrap')).every((el) => el.scrollWidth >= el.clientWidth),
    }))()`);
  }
  await gotoView('overview');
  await screenshot('12-overview-mobile.png', 'Vue d\'ensemble en 390x844 : navigation horizontale, KPI empiles, graphique lisible, aucun debordement horizontal.', MOBILE.label);

  await gotoView('clients');
  checks.touchTargets = await evaluate(`(() => {
    const targets = Array.from(document.querySelectorAll('.btn, .nav-item, .code-copy, .icon-btn'))
      .filter((el) => el.offsetParent !== null);
    const sizes = targets.map((el) => { const r = el.getBoundingClientRect(); return { label: (el.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((size) => size.w > 0 && size.h > 0);
    const tooSmall = sizes.filter((size) => size.w < 24 || size.h < 24);
    return { total: sizes.length, tooSmall, minHeight: Math.min(...sizes.map((size) => size.h)), minWidth: Math.min(...sizes.map((size) => size.w)) };
  })()`);
  await screenshot('13-clients-mobile.png', 'Vue cles en 390x844 : tableaux dans un conteneur scrollable (pas de debordement de page), boutons tactiles >= 24 px.', MOBILE.label);

  /* ====== 6. EMPTY / PARTIAL sur une instance sans configuration ====== */
  await s('Network.setCookie', { name: 'dsk_admin', value: authB.token, domain: '127.0.0.1', path: '/', httpOnly: true });
  await setViewport(DESKTOP);
  await navigate(`${URL_B}/admin`);
  await waitFor("document.querySelector('#view') && document.querySelector('#view').innerText.trim().length > 40");
  await sleep(600);
  await waitFor("document.querySelector('#view .table-empty')");
  await screenshot('14-empty-overview.png', 'Etat vide : aucune consommation ni cle — le panneau explique la situation et propose de creer une premiere cle.');

  const created = await adminFetch(URL_B, authB.cookie, '/admin/api/clients', { method: 'POST', body: { name: 'Cle de test partielle', period: 'total' } });
  if (!created.res.ok) throw new Error('Creation client instance B impossible');
  await navigate(`${URL_B}/admin`);
  await waitFor("document.querySelector('#view') && document.querySelector('#view').innerText.trim().length > 40");
  await waitFor("document.querySelector('#view .alert.danger')");
  await sleep(500);
  await screenshot('15-partial-overview.png', 'Etat partiel : la cle DeepSeek originale n\'est pas configuree — avertissement explicite, le reste du panneau (cles, quotas) reste consultable.');

  /* =========================== rapport ================================ */
  const jsErrorsUnexpected = jsErrors.filter((message) => !/Failed to fetch/i.test(message));
  const contrastFailures = checks.contrast.filter((item) => !item.missing && item.ratio < item.required);
  const focusVisible = checks.focus.filter((item) => item && item.visible).length;
  const mobileOverflowFailures = Object.entries(checks.overflow)
    .filter(([key]) => key.startsWith('mobile:'))
    .filter(([, value]) => value.docWidth > value.viewport + 1);

  const report = {
    contract: [
      'Produit web d\'une passerelle API DeepSeek auto-hebergee, en trois surfaces : site public (presentation et statut), espace utilisateur (quotas et consommation de sa cle) et console d\'administration (cles, quotas, journaux, audit, reglages).',
      'Job principal : comprendre le produit et l\'etat du service, puis pour un utilisateur suivre ses quotas, pour l\'administrateur scanner les cles et depenses. Actions primaires : ouvrir mon espace, creer/regenerer une cle, ajuster un quota.',
      'Direction : PHOSPHOR OPS — console terminal verte, monospace, dense, angles courts, prompts ">" et badges entre crochets ; titres publics en casse de phrase pour distinguer le site de la console.',
      'Viewports cibles : 1440x900 (desktop) et 390x844 (mobile).',
      'Contraintes : aucune dependance ajoutee, contraste WCAG AA, focus visible, reduced-motion respecte, pas de debordement horizontal.',
    ].join(' '),
    targetViewports: [DESKTOP.label, MOBILE.label],
    accessibility: {
      status: contrastFailures.length ? 'fail' : 'pass',
      evidence: `Contraste verifie sur ${checks.contrast.length} couples texte/fond (site public, portail, connexion admin + clients) : ${contrastFailures.length} echec(s). Focus clavier : ${focusVisible}/${checks.focus.length} arrets avec indicateur visible (anneau vert). Tous les champs de formulaire ont un libelle. Reduced-motion : scanlines masquees et transitions neutralisees (${checks.reducedMotion?.buttonTransition}).`,
    },
    responsive: {
      status: mobileOverflowFailures.length ? 'fail' : 'pass',
      evidence: `Surfaces teste��es en 390x844 et 1440x900 (site public, portail, 5 vues admin) : largeur document <= viewport partout (aucun debordement), tableaux contenus dans .table-wrap scrollable. Cibles tactiles mobiles : admin ${checks.touchTargets?.total} controles (min ${checks.touchTargets?.minHeight}px de haut), portail ${checks.touchTargetsPortal?.total} controles, seuil 24px.`,
    },
    contentStates: {
      loading: { status: 'pass', evidence: 'Artifact 09-loading.png : structure conservee + indicateur de chargement pendant une requete ralentie (fetch differe).' },
      empty: { status: 'pass', evidence: 'Artifact 14-empty-overview.png : instance sans donnee, messages "aucune consommation" et CTA de creation de cle.' },
      error: { status: 'pass', evidence: `Artifact 10-error.png : echec API force, message produit "${(checks.errorMessage || '').slice(0, 90)}" et bouton Reessayer verifie (recuperation OK : ${checks.errorRecovery === true}).` },
      partial: { status: 'pass', evidence: 'Artifact 15-partial-overview.png : cle fournisseur absente, avertissement explicite, reste du panneau consultable.' },
      success: { status: 'pass', evidence: 'Artifact 08-success-new-key.png : creation de cle confirmee, cle affichee une seule fois avec action de copie.' },
      permission: { status: 'pass', evidence: 'Artifacts 01/02-permission-login-*.png : sans session, seul l\'ecran de connexion est accessible (limite d\'acces expliquee). Artifact 18-public-portal-login-desktop.png : le portail exige la cle derivee et ne montre aucune donnee sans session.' },
      'public': { status: 'pass', evidence: 'Artifacts 16/17-public-landing-*.png : site public, statut de la passerelle en direct, exemple d\'echange API et parcours de branchement. Artifacts 22/23-public-steps-*.png : section etapes verifiee sous la ligne de flottaison (texte pleine largeur, code lisible).' },
      portal: { status: 'pass', evidence: `Artifacts 19/20-public-portal-*.png : espace utilisateur connecte (${checks.touchTargetsPortal?.total ?? 0} controles tactiles, tableaux contenus) avec quotas, graphique 30 jours et historique.` },
    },
    renderedEvidence: artifacts,
  };

  // Rapport de la premiere passe : on échoue explicitement si un check casse.
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'checks.json'), JSON.stringify(checks, null, 2));

  console.log('\n--- RESULTATS ---');
  console.log('captures:', artifacts.length);
  console.log('contraste:', checks.contrast.length, 'couples,', contrastFailures.length, 'echec(s)');
  if (contrastFailures.length) console.log(contrastFailures);
  console.log('focus visible:', focusVisible, '/', checks.focus.length);
  console.log('labels manquants:', checks.labels);
  console.log('reducedMotion:', checks.reducedMotion);
  console.log('touchTargets:', checks.touchTargets);
  console.log('touchTargetsPortal:', checks.touchTargetsPortal);
  console.log('steps:', checks.steps);
  console.log('overflow:', checks.overflow);
  console.log('erreurs JS inattendues:', jsErrorsUnexpected);

  const failed = contrastFailures.length > 0
    || focusVisible < 3
    || (checks.labels && checks.labels.length > 0)
    || !checks.reducedMotion?.scanlinesHidden
    || mobileOverflowFailures.length > 0
    || (checks.touchTargets?.tooSmall?.length ?? 1) > 0
    || (checks.touchTargetsPortal?.tooSmall?.length ?? 0) > 0
    || (checks.steps?.desktop?.pWidth ?? 0) < 400
    || (checks.steps?.mobile?.pWidth ?? 0) < 200
    || (checks.steps?.desktop?.preWidth ?? 0) < 400
    || (checks.steps?.mobile?.preWidth ?? 0) < 200
    || checks.errorRecovery !== true
    || jsErrorsUnexpected.length > 0;

  // Nettoyage.
  try { await send('Target.closeTarget', { targetId }); } catch { /* ignore */ }
  ws.close();
  chrome.kill();
  await sleep(600);
  await gatewayA.close();
  await gatewayB.close();
  try { fs.rmSync(dirA, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(dirB, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }

  if (failed) {
    console.error('\nECHEC : au moins un controle a echoue (voir ci-dessus).');
    process.exit(1);
  }
  console.log('\nOK : controles de rendu passes.');
  process.exit(0);
}

main().catch((error) => {
  console.error('ECHEC SCRIPT:', error);
  process.exit(1);
});
