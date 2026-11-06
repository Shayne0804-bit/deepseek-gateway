// Tests du package valaria-code : config, API, device flow, outils.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loginWithDevice } from '../src/auth.js';
import { createClient } from '../src/api.js';
import { runAgent } from '../src/agent.js';
import { clearConfig, loadConfig, saveConfig } from '../src/config.js';
import { groupModels } from '../src/onboarding.js';
import { LOGO_LINES, MARK, SPINNER } from '../src/assets.js';
import { playSplash } from '../src/splash.js';
import { collectWorkspaceDiff } from '../src/diff-view.js';
import { renderScreen } from '../src/tui.js';
import { diffText, listFiles, readFile, runCommand, writeFile } from '../src/tools.js';

function tmpDir(prefix = 'valaria-code-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

test('configuration locale : sauvegarde, relecture et oubli', () => {
  const home = tmpDir();
  process.env.VALARIA_HOME = home;
  try {
    saveConfig({ url: 'http://127.0.0.1:1234/v1', token: 'vlt_test', model: 'gpt-5', layout: 'studio' });
    const config = loadConfig();
    assert.equal(config.url, 'http://127.0.0.1:1234');
    assert.equal(config.token, 'vlt_test');
    assert.equal(config.model, 'gpt-5');
    assert.equal(config.layout, 'studio');
    clearConfig();
    assert.equal(loadConfig(), null);
  } finally {
    delete process.env.VALARIA_HOME;
  }
});

test('API : me, models et streaming SSE', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/portal/api/me') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ client: { name: 'Test' } }));
      return;
    }
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-5-codex' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      const body = JSON.parse(req.headers['x-body'] || '{}');
      void body;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Bon"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"jour"}}],"usage":{"total_tokens":2}}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const client = createClient({ url: server.url, token: 'vlt_test' });
    assert.equal((await client.me()).client.name, 'Test');
    assert.deepEqual(await client.models(), ['gpt-5-codex']);
    let streamed = '';
    const result = await client.stream([{ role: 'user', content: 'hi' }], { onDelta: (d) => { streamed += d; } });
    assert.equal(streamed, 'Bonjour');
    assert.equal(result.content, 'Bonjour');
  } finally {
    await server.close();
  }
});

test('device flow : code, approbation, jeton', async () => {
  let approved = false;
  const server = await startServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    if (requestUrl.pathname === '/portal/api/device/start') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ device_code: 'dev_1', user_code: 'ABCD-EFGH', verification_uri: 'http://x/device', verification_uri_complete: 'http://x/device?code=ABCD-EFGH', expires_in: 600, interval: 1 }));
      return;
    }
    if (requestUrl.pathname === '/portal/api/device/token') {
      res.writeHead(approved ? 200 : 202, { 'content-type': 'application/json' });
      res.end(JSON.stringify(approved ? { token: 'vlt_1', expires_at: new Date(Date.now() + 86400000).toISOString(), device_name: 'Test' } : { status: 'pending' }));
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const result = await loginWithDevice({
      url: server.url,
      open: false,
      pollMs: 5,
      onCode: () => { approved = true; },
    });
    assert.equal(result.token, 'vlt_1');
  } finally {
    await server.close();
  }
});

test('TUI : en-tête de marque et composeur', () => {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    renderScreen({
      messages: [
        { role: 'user', content: 'explique le projet' },
        { role: 'assistant', content: 'Je regarde les fichiers.' },
      ],
      input: 'const a = 1',
      status: 'prêt',
      streaming: false,
      approval: null,
      model: 'gpt-5',
      version: '0.4.0',
      mode: 'agent',
      layout: 'studio',
      account: {
        client: { name: 'Léa', expiresAt: new Date(Date.now() + 12 * 86400000).toISOString() },
        plan: { name: 'Créateur' },
        quota: { requests: { used: 47, limit: 300 }, usd: { used: 4, limit: 8 } },
      },
    }, { client: { baseUrl: 'https://api.valariamenu.com' }, config: { url: 'https://api.valariamenu.com' }, color: false });
  } finally {
    process.stdout.write = original;
  }
  const output = chunks.join('');
  assert.match(output, /VALARIA/);
  assert.match(output, /CODE/);
  assert.match(output, /REQUÊTES/);
  assert.match(output, /Créateur/);
  assert.match(output, /const a = 1/);
});

test('TUI layouts : focus épuré, studio avec compte, overlay compte', () => {
  const capture = (state) => {
    const chunks = [];
    const original = process.stdout.write;
    process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
    try {
      renderScreen(state, { client: {}, config: {}, color: false });
    } finally {
      process.stdout.write = original;
    }
    return chunks.join('');
  };
  const base = {
    messages: [{ role: 'user', content: 'salut' }],
    input: '',
    status: 'prêt',
    streaming: false,
    agentRunning: false,
    approval: null,
    model: 'gpt-5',
    version: '0.4.0',
    mode: 'agent',
    account: {
      client: { name: 'Léa', expiresAt: new Date(Date.now() + 86400000).toISOString() },
      plan: { name: 'Créateur' },
      quota: { requests: { used: 2, limit: 100 }, usd: { used: 1, limit: 8 } },
    },
  };
  const focus = capture({ ...base, layout: 'focus' });
  assert.match(focus, /Entrez une tâche/);
  assert.match(focus, /VALARIA CODE/);
  assert.doesNotMatch(focus, /REQUÊTES/);
  const studio = capture({ ...base, layout: 'studio' });
  assert.match(studio, /REQUÊTES/);
  const overlay = capture({ ...base, layout: 'focus', overlay: 'account' });
  assert.match(overlay, /votre compte/);
  assert.match(overlay, /REQUÊTES/);
});

test('TUI accueil : écran vide avec marque et actions', () => {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    renderScreen({
      messages: [],
      input: '',
      status: 'prêt',
      streaming: false,
      approval: null,
      model: 'gpt-5',
      version: '0.6.0',
      mode: 'agent',
      layout: 'focus',
      account: { client: { name: 'Test' }, plan: { name: 'Essai' }, quota: {} },
    }, { client: {}, config: {}, color: false });
  } finally {
    process.stdout.write = original;
  }
  const output = chunks.join('');
  assert.match(output, /VALARIA CODE/);
  assert.match(output, /Décrivez une tâche/);
  assert.match(output, /planifier/);
});

test('diff review : fichiers à gauche et lignes +/- à droite', () => {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    renderScreen({
      messages: [],
      input: '',
      status: 'revue',
      streaming: false,
      approval: { type: 'write', file: 'src/a.js' },
      overlay: 'diff',
      diffReview: {
        selected: 0,
        scroll: 0,
        files: [
          { path: 'src/a.js', status: 'M', additions: 1, deletions: 1, diff: '--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-const a = 1\n+const a = 2' },
          { path: 'src/b.js', status: 'A', additions: 2, deletions: 0, diff: '--- /dev/null\n+++ b/src/b.js\n@@ -0,0 +1,1 @@\n+export const b = 2' },
        ],
      },
      model: 'gpt-5',
      version: '0.6.1',
      mode: 'agent',
      account: null,
    }, { client: {}, config: {}, color: false });
  } finally {
    process.stdout.write = original;
  }
  const output = chunks.join('');
  assert.match(output, /FICHIERS \(2\)/);
  assert.match(output, /src\/a\.js/);
  assert.match(output, /const a = 1/);
  assert.match(output, /const a = 2/);
});

test('diff view : lecture des changements git', async (t) => {
  const root = tmpDir();
  const init = await runCommand('git init', { cwd: root });
  if (init.code !== 0) return t.skip('git indisponible');
  writeFile(root, 'a.js', 'const a = 1;\n');
  await runCommand('git add a.js', { cwd: root });
  await runCommand('git -c user.name=Test -c user.email=test@example.invalid -c commit.gpgsign=false commit -m init', { cwd: root });
  writeFile(root, 'a.js', 'const a = 2;\n');
  writeFile(root, 'b.js', 'export const b = 3;\n');
  const review = await collectWorkspaceDiff(root);
  assert.equal(review.ok, true);
  const files = Object.fromEntries(review.files.map((file) => [file.path, file]));
  assert.equal(files['a.js'].status, 'M');
  assert.equal(files['a.js'].additions, 1);
  assert.equal(files['a.js'].deletions, 1);
  assert.equal(files['b.js'].status, 'A');
  assert.match(files['b.js'].diff, /\+export const b = 3/);
});

test('assets et splash animé', async () => {
  assert.ok(LOGO_LINES.length >= 4);
  assert.equal(MARK, '◈');
  assert.ok(SPINNER.length >= 8);
  const chunks = [];
  const output = {
    isTTY: true,
    columns: 100,
    rows: 30,
    write: (chunk) => { chunks.push(String(chunk)); return true; },
  };
  await playSplash({ output, color: false, frameMs: 1, version: '0.6.0' });
  const rendered = chunks.join('');
  assert.match(rendered, /VALARIA|██/);
  assert.match(rendered, /agent de code/);
});

test('onboarding : familles Claude, Codex et DeepSeek', () => {
  const families = groupModels(['claude-opus-5.5', 'fable-5', 'gpt-5-codex', 'gpt-5', 'deepseek-v4-pro', 'deepseek-flash']);
  assert.deepEqual(families.claude, ['claude-opus-5.5']);
  assert.deepEqual(families.codex, ['gpt-5-codex', 'gpt-5']);
  assert.deepEqual(families.deepseek, ['deepseek-v4-pro', 'deepseek-flash']);
});

test('agent : lecture, proposition de patch, approbation et synthèse', async () => {
  const root = tmpDir();
  writeFile(root, 'hello.js', 'export const value = 1;\n');
  let calls = 0;
  const approvals = [];
  const client = {
    async complete() {
      calls += 1;
      if (calls === 1) {
        return { content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'read_file', arguments: '{"path":"hello.js"}' } }] };
      }
      if (calls === 2) {
        return { content: '', tool_calls: [{ id: '2', type: 'function', function: { name: 'write_file', arguments: '{"path":"hello.js","content":"export const value = 2;\\n"}' } }] };
      }
      return { content: 'Le fichier a été mis à jour.', tool_calls: [] };
    },
  };
  const result = await runAgent({
    client,
    root,
    task: 'Mets value à 2',
    approve: async (request) => { approvals.push(request); return true; },
  });
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].type, 'write');
  assert.match(approvals[0].diff, /\+ export const value = 2/);
  assert.match(readFile(root, 'hello.js'), /value = 2/);
  assert.match(result.summary, /mis à jour/);
});

test('outils locaux : fichiers, diff, commande', async () => {
  const root = tmpDir();
  writeFile(root, 'src/a.js', 'const a = 1;\n');
  assert.deepEqual(listFiles(root), ['src/a.js']);
  assert.match(readFile(root, 'src/a.js'), /const a/);
  assert.match(diffText('a\n', 'b\n'), /- a[\s\S]*\+ b/);
  const result = await runCommand('node --version', { cwd: root });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^v\d+/);
});
