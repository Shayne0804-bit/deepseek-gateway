#!/usr/bin/env node
/**
 * CLI VALARIA Gateway API.
 *
 *   valaria-gateway init   [--home <dir>]
 *   valaria-gateway start  [--env-file <fichier>] [--data-dir <dir>] [--host <h>] [--port <p>]
 *   valaria-gateway --version | --help
 *
 * `init` prépare ~/.valaria-gateway/.env (mot de passe admin + clé maître générés).
 * `start` lance la passerelle ; les données vont dans ~/.valaria-gateway/data par défaut.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
const DEFAULT_HOME = path.join(os.homedir(), '.valaria-gateway');

function readOption(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('-')) return argv[index + 1];
  return fallback;
}

function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode });
  try { fs.chmodSync(dir, mode); } catch { /* Windows */ }
}

/** Lecture minimale d'un .env (pour savoir si DATA_DIR y est défini). */
function parseEnvValues(file) {
  const out = {};
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    /* fichier absent */
  }
  return out;
}

function generatePassword() {
  return crypto.randomBytes(18).toString('base64url');
}

function generateMasterKey() {
  return crypto.randomBytes(32).toString('base64');
}

function printHelp() {
  console.log(`
VALARIA Gateway API v${PKG.version}

Usage :
  valaria-gateway init  [--home <dir>] [--data-dir <dir>]
      Crée le dossier de configuration (~/.valaria-gateway), un .env avec mot de
      passe administrateur et clé maître générés, puis affiche les étapes.

  valaria-gateway start [--env-file <fichier>] [--data-dir <dir>]
                        [--host <hôte>] [--port <port>] [--home <dir>]
      Démarre la passerelle. Cherche .env dans le dossier courant puis dans
      ~/.valaria-gateway/.env ; données dans ~/.valaria-gateway/data par défaut.

  valaria-gateway --version | --help

Après le démarrage :
  Site public  http://127.0.0.1:8787/
  Portail      http://127.0.0.1:8787/portal
  Console      http://127.0.0.1:8787/admin
  API          http://127.0.0.1:8787/v1

Pour partager à distance : domaine HTTPS (Railway/reverse proxy), TRUST_PROXY=1.
Documentation : https://github.com/Shayne0804-bit/deepseek-gateway#readme
`);
}

function commandInit(argv) {
  const home = path.resolve(readOption(argv, '--home', process.env.VALARIA_HOME || DEFAULT_HOME));
  const dataDir = path.resolve(readOption(argv, '--data-dir', path.join(home, 'data')));
  const envFile = path.join(home, '.env');
  ensureDir(home, 0o700);
  ensureDir(dataDir, 0o700);

  if (fs.existsSync(envFile)) {
    console.log(`\n  Configuration déjà présente : ${envFile}`);
    console.log('  Rien n’a été modifié. Éditez ce fichier puis lancez :');
    console.log('    valaria-gateway start\n');
    return 0;
  }

  const templateFile = path.join(PKG_ROOT, '.env.example');
  const template = fs.existsSync(templateFile)
    ? fs.readFileSync(templateFile, 'utf8')
    : 'DEEPSEEK_API_KEY=\nHOST=127.0.0.1\nPORT=8787\nADMIN_PASSWORD=\nDATA_DIR=\nMASTER_KEY=\n';
  const password = generatePassword();
  const masterKey = generateMasterKey();
  let env = template
    .replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password}`)
    .replace(/^MASTER_KEY=.*$/m, `MASTER_KEY=${masterKey}`)
    .replace(/^DATA_DIR=.*$/m, `DATA_DIR=${dataDir}`);
  if (!/^MASTER_KEY=/m.test(env)) env += `\nMASTER_KEY=${masterKey}\n`;
  if (!/^ADMIN_PASSWORD=/m.test(env)) env += `\nADMIN_PASSWORD=${password}\n`;

  fs.writeFileSync(envFile, env, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(envFile, 0o600); } catch { /* Windows */ }

  console.log(`
  VALARIA Gateway API v${PKG.version} — configuration créée.

    Fichier de configuration : ${envFile}
    Données (SQLite, secrets) : ${dataDir}

  Mot de passe administrateur (généré, à conserver) :
    ${password}

  Étapes suivantes :
    1. Ouvrez ${envFile} et renseignez DEEPSEEK_API_KEY
       (optionnel : MAIL_TRANSPORT, MAIL_FROM, RESEND_API_KEY pour la connexion email).
    2. Démarrez :  valaria-gateway start
    3. Ouvrez http://127.0.0.1:8787/admin et connectez-vous avec le mot de passe ci-dessus.
       Changez-le ensuite dans Réglages.

  Le fichier .env contient des secrets : ne le commité jamais, sauvegardez-le avec data/.
`);
  return 0;
}

async function commandStart(argv) {
  const home = path.resolve(readOption(argv, '--home', process.env.VALARIA_HOME || DEFAULT_HOME));
  const explicitEnv = readOption(argv, '--env-file');
  const cwdEnv = path.join(process.cwd(), '.env');
  const homeEnv = path.join(home, '.env');
  const envFile = explicitEnv
    ? path.resolve(explicitEnv)
    : [cwdEnv, homeEnv].find((candidate) => fs.existsSync(candidate)) || null;

  if (envFile) {
    process.env.ENV_FILE = envFile;
  } else {
    console.warn(`
  Aucun fichier .env trouvé (ni ${cwdEnv}, ni ${homeEnv}).
  Pour préparer la configuration : valaria-gateway init
  Démarrage quand même : un mot de passe admin sera généré dans le dossier de données.
`);
  }

  const envValues = envFile ? parseEnvValues(envFile) : {};
  const dataDir = path.resolve(
    readOption(argv, '--data-dir')
      ?? process.env.DATA_DIR
      ?? envValues.DATA_DIR
      ?? (envFile === cwdEnv ? path.join(process.cwd(), 'data') : path.join(home, 'data')),
  );
  ensureDir(dataDir, 0o700);
  if (!process.env.DATA_DIR) process.env.DATA_DIR = dataDir;

  const host = readOption(argv, '--host');
  const port = readOption(argv, '--port');
  if (host) process.env.HOST = host;
  if (port) process.env.PORT = port;

  console.log(`  VALARIA Gateway API v${PKG.version} — démarrage…`);
  await import(pathToFileURL(path.join(PKG_ROOT, 'server.js')).href);
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    printHelp();
    return 0;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(PKG.version);
    return 0;
  }
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'start';
  if (command === 'init') return commandInit(argv);
  if (command === 'start' || command === 'serve') return commandStart(argv);
  console.error(`\n  Commande inconnue : ${command}\n  Utilisez --help pour l’aide.\n`);
  return 1;
}

main()
  .then((code) => {
    if (typeof code === 'number' && code !== 0) process.exitCode = code;
  })
  .catch((err) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`\n  Le port ${process.env.PORT ?? 8787} est déjà utilisé.`);
      console.error('  Changez PORT dans .env ou avec --port.\n');
    } else {
      console.error('\n  Démarrage impossible :', err?.message ?? err, '\n');
    }
    process.exitCode = 1;
  });
