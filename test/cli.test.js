// Tests de la CLI npm et du paquet installable (init, start, --version).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const BIN = path.join(ROOT, 'bin', 'valaria-gateway.js');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function run(args, options = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: ROOT, ...options });
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('cli : --version et --help', () => {
  const version = run(['--version']);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), PKG.version);

  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /valaria-gateway init/);
  assert.match(help.stdout, /--data-dir/);
  assert.match(help.stdout, /\/admin/);
});

test('cli init : crée .env avec secrets générés et dossier data', () => {
  const home = tmpDir('valaria-cli-init-');
  try {
    const result = run(['init', '--home', home]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /configuration (serveur )?créée/i);

    const envPath = path.join(home, '.env');
    assert.ok(fs.existsSync(envPath), '.env créé');
    const env = fs.readFileSync(envPath, 'utf8');
    const password = /^ADMIN_PASSWORD=(.+)$/m.exec(env)?.[1] ?? '';
    const masterKey = /^MASTER_KEY=(.+)$/m.exec(env)?.[1] ?? '';
    assert.ok(password.length >= 20, 'mot de passe admin généré');
    assert.equal(Buffer.from(masterKey, 'base64').length, 32, 'clé maître 32 octets');
    assert.ok(env.includes(`DATA_DIR=${path.join(home, 'data')}`));
    assert.ok(fs.existsSync(path.join(home, 'data')), 'dossier data créé');

    const second = run(['init', '--home', home]);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /déjà présente/);
    assert.equal(fs.readFileSync(envPath, 'utf8'), env, 'le .env existant n’est pas écrasé');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('cli start : démarre la passerelle et /healthz répond', async () => {
  const home = tmpDir('valaria-cli-start-');
  const cwd = tmpDir('valaria-cli-cwd-');
  const init = run(['init', '--home', home], { cwd });
  assert.equal(init.status, 0, init.stderr);
  const port = await freePort();
  const child = spawn(process.execPath, [BIN, 'start', '--home', home, '--port', String(port)], {
    cwd,
    env: { ...process.env, VALARIA_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  try {
    const baseUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`démarrage expiré : ${output}`)), 20_000);
      const onData = (chunk) => {
        output += chunk.toString();
        const match = output.match(/Site public\s*:\s*(http:\/\/127\.0\.0\.1:\d+)\//);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`CLI sortie ${code} : ${output}`));
      });
    });

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.name, 'valaria-gateway');
    assert.equal(body.version, PKG.version);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), sleep(3000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
