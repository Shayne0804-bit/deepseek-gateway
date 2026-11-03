// Tests du client npm connecté à une instance hébergée (login, dashboard, models, ask).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../src/app.js';

const ROOT = path.join(import.meta.dirname, '..');
const BIN = path.join(ROOT, 'bin', 'valaria-gateway.js');
const ADMIN_PASSWORD = 'client-admin-password-123';
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cli(args, extraEnv = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, NO_COLOR: '1', ...extraEnv },
  });
}

/**
 * Exécution asynchrone : le serveur de test tourne dans CE processus, donc
 * spawnSync bloquerait sa boucle d'événements et ferait échouer le client.
 */
function runCli(args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: '1', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function startMockUpstream() {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }] }));
      return;
    }
    const body = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock',
      object: 'chat.completion',
      model: body.model ?? 'deepseek-flash',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Bonjour depuis le mock' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
  }));
}

async function createClient(base) {
  const login = await fetch(`${base}/admin/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const created = await fetch(`${base}/admin/api/clients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-requested-with': 'dsk-admin' },
    body: JSON.stringify({ name: 'Client CLI', period: 'monthly' }),
  });
  const data = await created.json();
  return data.key;
}

test('cli client : login, dashboard, models et ask contre l’instance hébergée', async () => {
  const mock = await startMockUpstream();
  const dataDir = tmpDir('valaria-client-gw-');
  const home = tmpDir('valaria-client-home-');
  const gateway = await startGateway({
    dataDir,
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    providerApiKey: 'sk-client-test',
    providerBaseUrl: mock.url,
    adminPassword: ADMIN_PASSWORD,
    mailTransport: 'console',
    logLevel: 'error',
    logger: silentLogger,
  });
  try {
    const key = await createClient(gateway.url);

    // login : valide la clé auprès de l'instance et mémorise la config.
    const login = await runCli(['login', '--url', gateway.url, '--key', key, '--home', home]);
    assert.equal(login.status, 0, login.stderr + login.stdout);
    assert.match(login.stdout, /connecté/);
    const configFile = path.join(home, 'client.json');
    assert.ok(fs.existsSync(configFile), 'client.json créé');
    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    assert.equal(saved.url, gateway.url);
    assert.equal(saved.key, key);

    // Status (non-TTY) : interface personnalisée avec quotas et historique.
    const status = await runCli(['status', '--home', home]);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /VALARIA GATEWAY API/);
    assert.match(status.stdout, /QUOTAS/);
    assert.match(status.stdout, /DERNIÈRES REQUÊTES/);
    assert.match(status.stdout, /Client CLI/);

    // Sans commande en non-TTY : même tableau de bord.
    const dashboard = await runCli(['--home', home]);
    assert.equal(dashboard.status, 0, dashboard.stderr);
    assert.match(dashboard.stdout, /VALARIA GATEWAY API/);

    // Modèles autorisés.
    const models = await runCli(['models', '--home', home]);
    assert.equal(models.status, 0, models.stderr);
    assert.match(models.stdout, /deepseek-flash/);

    // Requête réelle via l'instance (upstream mock).
    const answer = await runCli(['ask', 'Bonjour', '--home', home]);
    assert.equal(answer.status, 0, answer.stderr);
    assert.match(answer.stdout, /Bonjour depuis le mock/);
    assert.match(answer.stdout, /tokens : 10/);

    // Logout efface la configuration locale.
    const logout = await runCli(['logout', '--home', home]);
    assert.equal(logout.status, 0);
    assert.equal(fs.existsSync(configFile), false);
  } finally {
    await gateway.close();
    await new Promise((resolve) => { mock.server.close(resolve); mock.server.closeAllConnections?.(); });
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('cli client : clé invalide refusée avec un message clair', async () => {
  const mock = await startMockUpstream();
  const dataDir = tmpDir('valaria-client-bad-');
  const home = tmpDir('valaria-client-bad-home-');
  const gateway = await startGateway({
    dataDir,
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    providerApiKey: 'sk-client-test',
    providerBaseUrl: mock.url,
    adminPassword: ADMIN_PASSWORD,
    logLevel: 'error',
    logger: silentLogger,
  });
  try {
    const login = await runCli(['login', '--url', gateway.url, '--key', 'sk-dsk-invalide', '--home', home]);
    assert.equal(login.status, 1);
    assert.match(login.stderr, /Connexion impossible/);
    assert.equal(fs.existsSync(path.join(home, 'client.json')), false, 'aucune config écrite');
  } finally {
    await gateway.close();
    await new Promise((resolve) => { mock.server.close(resolve); mock.server.closeAllConnections?.(); });
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

