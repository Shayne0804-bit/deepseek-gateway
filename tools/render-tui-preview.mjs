// Rend un aperçu visuel réel de la TUI (ANSI -> HTML -> PNG) pour revue design.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { renderScreen } from '../packages/valaria-code/src/tui.js';
import { playSplash } from '../packages/valaria-code/src/splash.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'valaria-code-preview');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });

function ansiToHtml(input) {
  let out = '';
  let fg = null;
  let bold = false;
  let dim = false;
  const escape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const flushStyle = () => {
    const styles = [];
    if (fg) styles.push(`color:${fg}`);
    if (bold) styles.push('font-weight:700');
    if (dim) styles.push('opacity:.62');
    return styles.length ? ` style="${styles.join(';')}"` : '';
  };
  const pushText = (text) => {
    if (!text) return;
    if (fg || bold || dim) out += `<span${flushStyle()}>${escape(text)}</span>`;
    else out += escape(text);
  };
  let index = 0;
  const sgr = /\x1b\[([0-9;]*)m/g;
  let match;
  while ((match = sgr.exec(input))) {
    pushText(input.slice(index, match.index));
    index = sgr.lastIndex;
    const parts = match[1].split(';').map((v) => Number(v));
    if (!parts.length || parts[0] === 0) { fg = null; bold = false; dim = false; continue; }
    for (let i = 0; i < parts.length; i += 1) {
      const code = parts[i];
      if (code === 0) { fg = null; bold = false; dim = false; }
      else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 22) { bold = false; dim = false; }
      else if (code === 38 && parts[i + 1] === 2) {
        fg = `rgb(${parts[i + 2] || 0},${parts[i + 3] || 0},${parts[i + 4] || 0})`;
        i += 4;
      } else if (code === 39) fg = null;
    }
  }
  pushText(input.slice(index));
  return out.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function captureScreen(state) {
  const oldColumns = process.stdout.columns;
  const oldRows = process.stdout.rows;
  const originalWrite = process.stdout.write;
  const chunks = [];
  process.stdout.columns = 165;
  process.stdout.rows = 52;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    renderScreen(state, {
      client: {},
      config: {},
      color: true,
      root: 'C:/Users/ADMIN/Projets/valaria',
    });
  } finally {
    process.stdout.write = originalWrite;
    process.stdout.columns = oldColumns;
    process.stdout.rows = oldRows;
  }
  return ansiToHtml(chunks.join(''));
}

async function captureSplash() {
  const frames = [];
  const output = {
    isTTY: true,
    columns: 165,
    rows: 52,
    write: (chunk) => { frames.push(String(chunk)); return true; },
  };
  await playSplash({ output, color: true, frameMs: 1, version: '0.7.0' });
  return ansiToHtml(frames[frames.length - 1] || '');
}

function html(body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Term'; src: local('Cascadia Mono'), local('Consolas'), local('Courier New'); }
  html, body { margin:0; width:1491px; height:970px; overflow:hidden; background:#080c0a; }
  body { display:flex; align-items:stretch; justify-content:stretch; }
  pre { margin:0; padding:22px 26px; width:100%; height:100%; box-sizing:border-box;
        font-family:'Cascadia Mono','Consolas','Courier New',monospace;
        font-size:15px; line-height:1.18; letter-spacing:0;
        color:#e8f3ec; background:#080c0a; white-space:pre; }
</style></head><body><pre>${body}</pre></body></html>`;
}

function screenshot(name, body) {
  const htmlPath = path.join(OUT, `${name}.html`);
  const pngPath = path.join(OUT, `${name}.png`);
  fs.writeFileSync(htmlPath, html(body), 'utf8');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'valaria-preview-chrome-'));
  const result = spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--force-device-scale-factor=1', '--window-size=1491,970',
    `--user-data-dir=${profile}`, `--screenshot=${pngPath}`,
    pathToFileURL(htmlPath).href,
  ], { stdio: 'pipe' });
  if (result.status !== 0) throw new Error(`Chrome screenshot failed (${result.status}): ${result.stderr}`);
  for (let attempt = 0; attempt < 30 && !fs.existsSync(pngPath); attempt += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (!fs.existsSync(pngPath)) throw new Error(`Chrome screenshot missing: ${pngPath}`);
  return pngPath;
}

const account = {
  client: { name: 'sossoukassim', plan: { name: 'Essai' }, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() },
  plan: { name: 'Essai' },
  quota: { requests: { used: 4, limit: null }, usd: { used: 0.04, limit: 1.13 } },
};

const base = {
  messages: [],
  input: '',
  status: 'prêt',
  streaming: false,
  agentRunning: false,
  approval: null,
  approvalMode: 'safe',
  model: 'claude-opus-5.5',
  version: '0.7.0',
  mode: 'agent',
  tick: 0,
  account,
  diffVisible: true,
  diffReview: {
    repo: 'C:/Users/ADMIN/Projets/valaria',
    selected: 0,
    scroll: 0,
    files: [
      {
        path: 'tests/login.test.js',
        status: 'M',
        additions: 2,
        deletions: 1,
        diff: '--- a/tests/login.test.js\n+++ b/tests/login.test.js\n@@ -1,4 +1,5 @@\n- await page.waitForTimeout(250)\n+ await page.waitForCookie("session")\n   await expect(page).toHaveURL("/dashboard")',
      },
      {
        path: 'src/session.js',
        status: 'A',
        additions: 12,
        deletions: 0,
        diff: '--- /dev/null\n+++ b/src/session.js\n@@ -0,0 +1,3 @@\n+export const sessionCookie = "session"\n+export const sessionTtl = 86400\n',
      },
    ],
  },
};

const focus = screenshot('focus', captureScreen({ ...base, layout: 'focus' }));
const active = screenshot('focus-active', captureScreen({
  ...base,
  layout: 'focus',
  messages: [
    { role: 'user', content: 'corrige le test de connexion qui échoue une fois sur cinq' },
    { role: 'tool', content: 'Lecture tests/login.test.js' },
    { role: 'assistant', content: 'Le test utilise un délai fixe avant la vérification du cookie. Je remplace ce délai par une attente de la session.' },
    { role: 'tool', content: '$ npm test' },
    { role: 'assistant', content: 'Les 20 exécutions passent. Le test est maintenant déterministe.' },
  ],
  status: 'prêt · 20 requêtes exécutées',
}));
const approval = screenshot('approval', captureScreen({
  ...base,
  layout: 'focus',
  messages: [{ role: 'user', content: 'corrige le test de connexion' }],
  approval: {
    type: 'write',
    file: 'tests/login.test.js',
    diff: '--- a/tests/login.test.js\n+++ b/tests/login.test.js\n@@ -1,4 +1,5 @@\n- await page.waitForTimeout(250)\n+ await page.waitForCookie("session")\n  await expect(page).toHaveURL("/dashboard")',
  },
}));
const diff = screenshot('diff-review', captureScreen({
  ...base,
  layout: 'focus',
  overlay: 'diff',
  messages: [
    { role: 'user', content: 'corrige le test de connexion qui échoue une fois sur cinq' },
    { role: 'assistant', content: 'Je propose de remplacer le délai fixe par une attente de la session. Vérifiez le diff à droite avant d’autoriser.' },
  ],
  approval: { type: 'write', file: 'tests/login.test.js' },
  diffReview: {
    repo: 'C:/Users/ADMIN/Projets/valaria',
    selected: 0,
    scroll: 0,
    files: [
      {
        path: 'tests/login.test.js',
        status: 'M',
        additions: 2,
        deletions: 1,
        diff: '--- a/tests/login.test.js\n+++ b/tests/login.test.js\n@@ -1,4 +1,5 @@\n- import { delay } from "node:timers/promises"\n+ import { expect } from "@playwright/test"\n const login = async (page) => {\n-  await page.waitForTimeout(250)\n+  await page.waitForCookie("session")\n   await expect(page).toHaveURL("/dashboard")\n }',
      },
      {
        path: 'src/session.js',
        status: 'A',
        additions: 12,
        deletions: 0,
        diff: '--- /dev/null\n+++ b/src/session.js\n@@ -0,0 +1,3 @@\n+export const sessionCookie = "session"\n+export const sessionTtl = 86400\n+',
      },
      {
        path: 'old/helper.js',
        status: 'D',
        additions: 0,
        deletions: 4,
        diff: '--- a/old/helper.js\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-export const oldHelper = true\n-// legacy\n-// remove me\n',
      },
    ],
  },
}));
const diffStudio = screenshot('diff-review-studio', captureScreen({
  ...base,
  layout: 'studio',
  overlay: 'diff',
  messages: [
    { role: 'user', content: 'corrige le test de connexion qui échoue une fois sur cinq' },
    { role: 'assistant', content: 'Je propose de remplacer le délai fixe par une attente de la session. Vérifiez le diff à droite avant d’autoriser.' },
  ],
  approval: { type: 'write', file: 'tests/login.test.js' },
  diffReview: {
    repo: 'C:/Users/ADMIN/Projets/valaria',
    selected: 0,
    scroll: 0,
    files: [
      {
        path: 'tests/login.test.js',
        status: 'M',
        additions: 2,
        deletions: 1,
        diff: '--- a/tests/login.test.js\n+++ b/tests/login.test.js\n@@ -1,4 +1,5 @@\n- import { delay } from "node:timers/promises"\n+ import { expect } from "@playwright/test"\n const login = async (page) => {\n-  await page.waitForTimeout(250)\n+  await page.waitForCookie("session")\n   await expect(page).toHaveURL("/dashboard")\n }',
      },
      {
        path: 'src/session.js',
        status: 'A',
        additions: 12,
        deletions: 0,
        diff: '--- /dev/null\n+++ b/src/session.js\n@@ -0,0 +1,3 @@\n+export const sessionCookie = "session"\n+export const sessionTtl = 86400\n+',
      },
      {
        path: 'old/helper.js',
        status: 'D',
        additions: 0,
        deletions: 4,
        diff: '--- a/old/helper.js\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-export const oldHelper = true\n-// legacy\n-// remove me\n',
      },
    ],
  },
}));
const studio = screenshot('studio', captureScreen({ ...base, layout: 'studio' }));
const splash = screenshot('splash', await captureSplash());
console.log(JSON.stringify({ focus, active, approval, diff, diffStudio, studio, splash }, null, 2));

