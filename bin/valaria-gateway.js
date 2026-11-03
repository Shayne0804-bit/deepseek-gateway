#!/usr/bin/env node
/**
 * CLI VALARIA Gateway API.
 *
 * Mode client (par défaut) : se connecte à une instance HÉBERGÉE avec une clé
 * dérivée. Aucun serveur local, aucune base locale.
 *
 *   valaria-gateway login --url https://api.votre-domaine.fr --key sk-dsk-…
 *   valaria-gateway              # tableau de bord interactif (interface VALARIA)
 *   valaria-gateway status
 *   valaria-gateway ask "Bonjour"
 *   valaria-gateway models | logs | open [admin] | ui
 *   valaria-gateway logout
 *
 * Mode auto-hébergement (opérateur) :
 *   valaria-gateway init      # crée ~/.valaria-gateway/.env (secrets) + data/
 *   valaria-gateway serve     # démarre la passerelle locale (alias : start)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ask,
  clearClientConfig,
  connect,
  fetchDashboard,
  listModels,
  loadClientConfig,
  normalizeUrl,
  openInBrowser,
  renderDashboard,
  resolveHome,
  runUi,
  saveClientConfig,
} from '../src/client.js';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
const DEFAULT_HOME = path.join(os.homedir(), '.valaria-gateway');
const DEFAULT_INSTANCE_URL = PKG.valaria?.defaultUrl || '';

function parseArgs(argv) {
  const flags = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[index + 1];
      if (next != null && !next.startsWith('-')) {
        flags[name] = next;
        index += 1;
      } else {
        flags[name] = true;
      }
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

function homeOf(flags) {
  return resolveHome(flags.home || process.env.VALARIA_HOME || DEFAULT_HOME);
}

function useColor() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode });
  try { fs.chmodSync(dir, mode); } catch { /* Windows */ }
}

function parseEnvValues(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch { /* absent */ }
  return out;
}

function printHelp() {
  console.log(`
VALARIA Gateway API v${PKG.version}

MODE CLIENT (recommandé) — se connecte à l'instance hébergée par l'administrateur.
Aucune installation locale de serveur, aucune base de données.

  valaria-gateway login --url https://api.votre-domaine.fr --key sk-dsk-…
  valaria-gateway                 interface interactive VALARIA (tableau de bord)
  valaria-gateway status          quotas, consommation 30 jours, dernières requêtes
  valaria-gateway ask "Bonjour"   envoyer une requête au modèle
  valaria-gateway models          lister les modèles autorisés
  valaria-gateway logs            dernières requêtes
  valaria-gateway open [admin]    ouvrir le portail /portal (ou la console /admin)
  valaria-gateway ui              interface interactive
  valaria-gateway logout          oublier l'instance et la clé

  Options : --url <url>, --key <clé>, --model <modèle>, --home <dir>
  Variables : VALARIA_GATEWAY_URL, VALARIA_API_KEY, VALARIA_HOME, NO_COLOR

MODE AUTO-HÉBERGEMENT (opérateur / serveur) :

  valaria-gateway init  [--home <dir>] [--data-dir <dir>]
  valaria-gateway serve [--env-file <fichier>] [--data-dir <dir>]
                        [--host <hôte>] [--port <port>] [--home <dir>]
  valaria-gateway start   (alias de serve)

${DEFAULT_INSTANCE_URL ? `Instance par défaut configurée : ${DEFAULT_INSTANCE_URL}\n` : ''}Documentation : https://github.com/Shayne0804-bit/deepseek-gateway#readme
`);
}

function commandInit(flags) {
  const home = homeOf(flags);
  const dataDir = path.resolve(flags['data-dir'] || path.join(home, 'data'));
  const envFile = path.join(home, '.env');
  ensureDir(home, 0o700);
  ensureDir(dataDir, 0o700);

  if (fs.existsSync(envFile)) {
    console.log(`\n  Configuration serveur déjà présente : ${envFile}`);
    console.log('  Rien n’a été modifié. Lancez : valaria-gateway serve\n');
    return 0;
  }

  const templateFile = path.join(PKG_ROOT, '.env.example');
  const template = fs.existsSync(templateFile)
    ? fs.readFileSync(templateFile, 'utf8')
    : 'DEEPSEEK_API_KEY=\nHOST=127.0.0.1\nPORT=8787\nADMIN_PASSWORD=\nDATA_DIR=\nMASTER_KEY=\n';
  const password = crypto.randomBytes(18).toString('base64url');
  const masterKey = crypto.randomBytes(32).toString('base64');
  let env = template
    .replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password}`)
    .replace(/^MASTER_KEY=.*$/m, `MASTER_KEY=${masterKey}`)
    .replace(/^DATA_DIR=.*$/m, `DATA_DIR=${dataDir}`);
  if (!/^MASTER_KEY=/m.test(env)) env += `\nMASTER_KEY=${masterKey}\n`;
  if (!/^ADMIN_PASSWORD=/m.test(env)) env += `\nADMIN_PASSWORD=${password}\n`;

  fs.writeFileSync(envFile, env, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(envFile, 0o600); } catch { /* Windows */ }

  console.log(`
  VALARIA Gateway API v${PKG.version} — configuration serveur créée.

    Configuration : ${envFile}
    Données       : ${dataDir}
    Mot de passe admin : ${password}

  Étapes :
    1. Renseignez DEEPSEEK_API_KEY dans ${envFile}
       (optionnel : MAIL_TRANSPORT, MAIL_FROM, RESEND_API_KEY pour les codes email).
    2. Lancez : valaria-gateway serve
    3. Ouvrez http://127.0.0.1:8787/admin

  Ce fichier contient des secrets : ne le commité jamais, sauvegardez-le avec data/.
`);
  return 0;
}

async function commandServe(flags) {
  const home = homeOf(flags);
  const explicitEnv = flags['env-file'];
  const cwdEnv = path.join(process.cwd(), '.env');
  const homeEnv = path.join(home, '.env');
  const envFile = explicitEnv
    ? path.resolve(explicitEnv)
    : [cwdEnv, homeEnv].find((candidate) => fs.existsSync(candidate)) || null;

  if (envFile) process.env.ENV_FILE = envFile;
  else {
    console.warn(`
  Aucun fichier .env trouvé (ni ${cwdEnv}, ni ${homeEnv}).
  Pour préparer la configuration : valaria-gateway init
`);
  }

  const envValues = envFile ? parseEnvValues(envFile) : {};
  const dataDir = path.resolve(
    flags['data-dir']
      ?? process.env.DATA_DIR
      ?? envValues.DATA_DIR
      ?? (envFile === cwdEnv ? path.join(process.cwd(), 'data') : path.join(home, 'data')),
  );
  ensureDir(dataDir, 0o700);
  if (!process.env.DATA_DIR) process.env.DATA_DIR = dataDir;
  if (flags.host) process.env.HOST = String(flags.host);
  if (flags.port) process.env.PORT = String(flags.port);

  console.log(`  VALARIA Gateway API v${PKG.version} — démarrage du serveur…`);
  await import(pathToFileURL(path.join(PKG_ROOT, 'server.js')).href);
  return 0;
}

function requireClient(flags) {
  const home = homeOf(flags);
  const config = loadClientConfig(home);
  if (!config) {
    console.error(`
  Aucune instance configurée.

  Connectez-vous à l'instance de votre administrateur :
    valaria-gateway login --url https://api.votre-domaine.fr --key sk-dsk-…

  Ou, pour auto-héberger la passerelle :
    valaria-gateway init && valaria-gateway serve
`);
    return null;
  }
  return { config, home };
}

async function promptLine(question) {
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function commandLogin(flags) {
  const home = homeOf(flags);
  let url = flags.url || process.env.VALARIA_GATEWAY_URL || DEFAULT_INSTANCE_URL;
  let key = flags.key || process.env.VALARIA_API_KEY;
  const color = useColor();
  const accent = (text) => (color ? `\x1b[92m${text}\x1b[0m` : text);
  const dim = (text) => (color ? `\x1b[2m${text}\x1b[0m` : text);

  if (!url) {
    if (!process.stdin.isTTY) {
      console.error('\n  URL manquante : valaria-gateway login --url https://api.votre-domaine.fr --key sk-dsk-…\n');
      return 1;
    }
    url = await promptLine('  URL de l’instance (ex. https://api.votre-domaine.fr) : ');
  }
  if (!key) {
    if (!process.stdin.isTTY) {
      console.error('\n  Clé manquante : --key sk-dsk-… ou variable VALARIA_API_KEY\n');
      return 1;
    }
    key = await promptLine('  Clé API sk-dsk-… (fournie par l’administrateur) : ');
  }

  try {
    const { config, client, server } = await connect({ url, key });
    const file = saveClientConfig(home, {
      url: config.url,
      key: config.key,
      clientName: client.name,
      email: client.email,
      keyPrefix: client.keyPrefix,
      savedAt: new Date().toISOString(),
    });
    console.log(`
  ${accent('>_ VALARIA GATEWAY API')}  ${dim(`v${server?.version ?? PKG.version}`)}

  ${accent('✔ connecté')} à ${config.url}
  ${client.name}${client.email ? ` <${client.email}>` : ''} · clé ${client.keyPrefix}

  ${dim('Configuration :')} ${file}
  ${dim('Lancez :')} valaria-gateway          ${dim('(interface interactive)')}
  ${dim('ou :')}     valaria-gateway status
`);
    return 0;
  } catch (error) {
    console.error(`\n  Connexion impossible : ${error.message}\n`);
    return 1;
  }
}

async function commandStatus(flags) {
  const context = requireClient(flags);
  if (!context) return 1;
  const dashboard = await fetchDashboard(context.config);
  console.log(renderDashboard(dashboard, context.config, { color: useColor() }));
  return 0;
}

async function commandAsk(flags) {
  const context = requireClient(flags);
  if (!context) return 1;
  const prompt = flags._.slice(1).join(' ').trim();
  if (!prompt) {
    console.error('\n  usage : valaria-gateway ask "Votre question"\n');
    return 1;
  }
  const result = await ask(context.config, prompt, { model: flags.model });
  const color = useColor();
  const green = (text) => (color ? `\x1b[92m▌\x1b[0m ${text}` : `▌ ${text}`);
  console.log(`\n${green(`\x1b[1m${result.model}\x1b[0m`)}\n\n${result.content}\n`);
  if (result.usage?.total_tokens != null) console.log(`  tokens : ${result.usage.total_tokens}\n`);
  return 0;
}

async function commandModels(flags) {
  const context = requireClient(flags);
  if (!context) return 1;
  const models = await listModels(context.config);
  const color = useColor();
  console.log('\n' + models.map((model) => (color ? `\x1b[96m${model}\x1b[0m` : model)).join('  ·  ') + '\n');
  return 0;
}

async function commandOpen(flags) {
  const context = requireClient(flags);
  if (!context) return 1;
  const target = flags._[1] === 'admin' || flags.admin ? 'admin' : 'portal';
  const url = openInBrowser(context.config, target);
  console.log(`  ouvert dans le navigateur : ${url}`);
  return 0;
}

async function commandUi(flags) {
  const context = requireClient(flags);
  if (!context) return 1;
  if (!process.stdin.isTTY) {
    const dashboard = await fetchDashboard(context.config);
    console.log(renderDashboard(dashboard, context.config, { color: useColor() }));
    return 0;
  }
  await runUi(context.config, { color: useColor() });
  return 0;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || flags.h || flags._[0] === 'help') { printHelp(); return 0; }
  if (flags.version || flags.v) { console.log(PKG.version); return 0; }
  const command = flags._[0] || '';

  switch (command) {
    case 'login':
    case 'connect':
      return commandLogin(flags);
    case 'logout': {
      const home = homeOf(flags);
      clearClientConfig(home);
      console.log('\n  Instance et clé oubliées sur cette machine.\n');
      return 0;
    }
    case 'status':
    case 'dashboard':
      return commandStatus(flags);
    case 'ask':
    case 'chat':
      return commandAsk(flags);
    case 'models':
      return commandModels(flags);
    case 'open':
      return commandOpen(flags);
    case 'ui':
      return commandUi(flags);
    case 'init':
      return commandInit(flags);
    case 'serve':
    case 'server':
    case 'start':
      return commandServe(flags);
    case '':
      return commandUi(flags);
    default:
      console.error(`\n  Commande inconnue : ${command}\n  Utilisez --help pour l’aide.\n`);
      return 1;
  }
}

main()
  .then((code) => {
    if (typeof code === 'number' && code !== 0) process.exitCode = code;
  })
  .catch((error) => {
    if (error?.code === 'EADDRINUSE') {
      console.error(`\n  Le port ${process.env.PORT ?? 8787} est déjà utilisé.\n`);
    } else if (error?.status === 401) {
      console.error('\n  Clé invalide ou révoquée (401). Vérifiez sk-dsk-… auprès de l’administrateur.\n');
    } else {
      console.error(`\n  Erreur : ${error?.message ?? error}\n`);
    }
    process.exitCode = 1;
  });
