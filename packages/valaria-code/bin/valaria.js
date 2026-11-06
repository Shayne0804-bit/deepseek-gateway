#!/usr/bin/env node
/**
 * VALARIA Code — CLI + TUI.
 * Connexion par appareil depuis le portail, puis agent de code dans le terminal.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '../src/api.js';
import { loginWithDevice, openBrowser, tokenIsExpired } from '../src/auth.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  clearConfig,
  loadConfig,
  normalizeBaseUrl,
  resolveAuthConfig,
  saveConfig,
} from '../src/config.js';
import { runTui, renderScreen } from '../src/tui.js';
import { chooseModel } from '../src/onboarding.js';
import { playSplash } from '../src/splash.js';
import { supportsColor } from '../src/theme.js';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));

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

function help() {
  console.log(`
  V  VALARIA CODE  ${PKG.version}
  Agent de code en terminal — connexion par appareil au portail VALARIA.

  USAGE
    valaria                      ouvrir l'interface plein écran
    valaria login                connecter cet appareil via le navigateur
    valaria logout               oublier le jeton local
    valaria status               quotas, pass et compte
    valaria models               lister les modèles autorisés
    valaria chat "..."           envoyer un message sans TUI
    valaria preview              aperçu statique de l'interface
    valaria preview --splash     aperçu avec l'animation de démarrage
    valaria --version | --help

  OPTIONS
    --url <url>                  instance VALARIA (défaut : ${DEFAULT_BASE_URL})
    --model <nom>                modèle par défaut
    --device-name <nom>          nom affiché dans le portail
    --no-open                    ne pas ouvrir le navigateur automatiquement
    --no-onboarding              ne pas demander Claude/Codex/DeepSeek au premier login
    --no-anim                    désactiver le splash et les animations
    --layout <focus|studio|compact>  interface au démarrage
    --approval <strict|safe|full>    mode d'approbation de l'agent
    --home <dir>                 dossier de configuration

  VARIABLES
    VALARIA_GATEWAY_URL, VALARIA_HOME, VALARIA_MODEL
    VALARIA_API_KEY              mode CI/automatisation uniquement

  CONFIGURATION
    ~/.valaria/code.json (0600) — jeton d'appareil, jamais la clé API.
`);
}

function printLoginInstructions(url) {
  console.log(`
  Aucun appareil connecté.

  Lancez :
    valaria login --url ${url || DEFAULT_BASE_URL}

  Vous serez redirigé vers le portail pour autoriser l'appareil.
  Aucune clé API ne vous sera demandée dans le terminal.
`);
}

async function commandLogin(flags) {
  const url = normalizeBaseUrl(flags.url || process.env.VALARIA_GATEWAY_URL || loadConfig()?.url || DEFAULT_BASE_URL);
  const deviceName = String(flags['device-name'] || flags.deviceName || `VALARIA Code · ${process.platform}`).slice(0, 60);
  console.log(`
  ${supportsColor() ? '\x1b[92m' : ''}V  VALARIA CODE${supportsColor() ? '\x1b[0m' : ''}
  Connexion de l'appareil à ${url}
`);
  try {
    const result = await loginWithDevice({
      url,
      deviceName,
      open: !flags['no-open'],
      onCode: (device) => {
        console.log(`  Code : ${device.user_code}`);
        console.log(`  Page : ${device.verification_uri_complete}`);
        console.log('  En attente de l’approbation sur le site…\n');
      },
    });
    let selectedModel = flags.model || null;
    if (!selectedModel && !flags['no-onboarding']) {
      try {
        const models = await createClient({ url: result.url, token: result.token }).models();
        selectedModel = await chooseModel({ models });
      } catch {
        selectedModel = null;
      }
    }
    selectedModel = selectedModel || loadConfig()?.model || DEFAULT_MODEL;
    const file = saveConfig({
      url: result.url,
      token: result.token,
      tokenExpiresAt: result.tokenExpiresAt,
      deviceName: result.deviceName,
      clientName: loadConfig()?.clientName || null,
      model: selectedModel,
    });
    console.log(`  ✔ appareil autorisé`);
    console.log(`  Modèle : ${selectedModel}`);
    console.log(`  Configuration : ${file}`);
    console.log('  Lancez : valaria\n');
    return 0;
  } catch (error) {
    console.error(`\n  Connexion impossible : ${error.message}\n`);
    return 1;
  }
}

async function commandStatus(flags) {
  const auth = resolveAuthConfig(flags);
  if (!auth.token) { printLoginInstructions(auth.url); return 1; }
  if (tokenIsExpired(auth.config)) { console.error('\n  Jeton expiré. Relancez : valaria login\n'); return 1; }
  const client = createClient({ url: auth.url, token: auth.token, model: auth.model });
  try {
    const me = await client.me();
    const quota = me.quota || {};
    const requests = quota.requests || {};
    const usd = quota.usd || {};
    console.log(`\n  V  VALARIA CODE  ${PKG.version}`);
    console.log(`  ${auth.url}  ·  ${me.client?.name || ''}`);
    console.log(`  Modèle : ${auth.model}`);
    console.log(`  Requêtes : ${requests.used ?? 0} / ${requests.limit ?? '∞'}`);
    console.log(`  Crédit : ${usd.used ?? 0} / ${usd.limit ?? '∞'}`);
    console.log(`  Pass : ${me.plan?.name || me.client?.period || '—'}\n`);
    return 0;
  } catch (error) {
    console.error(`\n  ${error.message}\n`);
    return 1;
  }
}

async function commandModels(flags) {
  const auth = resolveAuthConfig(flags);
  if (!auth.token) { printLoginInstructions(auth.url); return 1; }
  const client = createClient({ url: auth.url, token: auth.token, model: auth.model });
  try {
    const models = await client.models();
    console.log(`\n  ${models.join('  ·  ')}\n`);
    return 0;
  } catch (error) {
    console.error(`\n  ${error.message}\n`);
    return 1;
  }
}

async function commandChat(flags) {
  const auth = resolveAuthConfig(flags);
  if (!auth.token) { printLoginInstructions(auth.url); return 1; }
  const prompt = flags._.slice(1).join(' ').trim();
  if (!prompt) {
    console.error('\n  usage : valaria chat "Votre question"\n');
    return 1;
  }
  const client = createClient({ url: auth.url, token: auth.token, model: auth.model });
  const color = supportsColor();
  const accent = (text) => (color ? `\x1b[92m${text}\x1b[0m` : text);
  process.stdout.write(`\n${accent('▌')} `);
  try {
    await client.stream(
      [{ role: 'user', content: prompt }],
      { model: auth.model, onDelta: (delta) => process.stdout.write(delta) },
    );
    process.stdout.write('\n\n');
    return 0;
  } catch (error) {
    console.error(`\n  ${error.message}\n`);
    return 1;
  }
}

async function commandPreview(flags = {}) {
  if (flags.splash) await playSplash({ color: supportsColor(), version: PKG.version });
  renderScreen({
    messages: [
      { role: 'user', content: 'Ajoute un test pour la fonction de calcul.' },
      { role: 'assistant', content: 'Je lis le fichier de test, puis je propose un patch. Aucun fichier ne sera écrit sans votre approbation.' },
    ],
    input: 'ajoute un test pour la fonction de calcul',
    status: 'prêt · mode agent',
    streaming: false,
    agentRunning: false,
    mode: 'agent',
    layout: ['focus', 'studio', 'compact'].includes(flags.layout) ? flags.layout : 'focus',
    overlay: null,
    tick: 0,
    version: PKG.version,
    account: {
      client: { name: 'Votre compte', expiresAt: new Date(Date.now() + 21 * 86400000).toISOString() },
      plan: { name: 'Créateur' },
      quota: { requests: { used: 47, limit: 4000 }, usd: { used: 3.25, limit: 8 } },
    },
    approval: null,
    model: process.env.VALARIA_MODEL || DEFAULT_MODEL,
  }, {
    client: { baseUrl: normalizeBaseUrl(process.env.VALARIA_GATEWAY_URL || DEFAULT_BASE_URL) },
    config: { url: normalizeBaseUrl(process.env.VALARIA_GATEWAY_URL || DEFAULT_BASE_URL) },
    color: supportsColor(),
  });
  console.log('\n');
  return 0;
}

async function commandTui(flags) {
  const auth = resolveAuthConfig(flags);
  if (!auth.token) { printLoginInstructions(auth.url); return 1; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('\n  L’interface plein écran nécessite un terminal interactif (TTY).\n  Utilisez : valaria chat "..." ou valaria status\n');
    return 1;
  }
  const client = createClient({ url: auth.url, token: auth.token, model: auth.model });
  try {
    const me = await client.me();
    const config = { url: auth.url, model: auth.model, clientName: me.client?.name || null };
    await runTui({
      client,
      config,
      model: auth.model,
      layout: auth.layout,
      approvalMode: auth.approvalMode,
      version: PKG.version,
      animations: !flags['no-anim'],
      account: me,
      onModelChange: (model) => {
        const current = loadConfig() || {};
        saveConfig({ ...current, url: auth.url, token: auth.token, model, layout: current.layout || auth.layout, approvalMode: current.approvalMode || auth.approvalMode, deviceName: current.deviceName || 'VALARIA Code' });
      },
      onPreferencesChange: ({ layout, approvalMode }) => {
        const current = loadConfig() || {};
        saveConfig({
          ...current,
          url: auth.url,
          token: auth.token,
          model: auth.model,
          layout: layout || current.layout || auth.layout,
          approvalMode: approvalMode || current.approvalMode || auth.approvalMode,
          deviceName: current.deviceName || 'VALARIA Code',
        });
      },
    });
    return 0;
  } catch (error) {
    console.error(`\n  ${error.message}\n`);
    return 1;
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || flags.h || flags._[0] === 'help') { help(); return 0; }
  if (flags.version || flags.v) { console.log(PKG.version); return 0; }
  if (flags.home) process.env.VALARIA_HOME = String(flags.home);
  const command = flags._[0] || '';
  switch (command) {
    case 'login':
    case 'connect':
      return commandLogin(flags);
    case 'logout': {
      const config = loadConfig();
      clearConfig();
      console.log(`\n  Appareil oublié${config?.url ? ` (${config.url})` : ''}.\n`);
      return 0;
    }
    case 'status':
    case 'dashboard':
      return commandStatus(flags);
    case 'models':
      return commandModels(flags);
    case 'chat':
    case 'ask':
      return commandChat(flags);
    case 'preview':
      return commandPreview(flags);
    case '':
      return commandTui(flags);
    default:
      console.error(`\n  Commande inconnue : ${command}\n  valaria --help pour l'aide.\n`);
      return 1;
  }
}

main().then((code) => {
  if (typeof code === 'number' && code !== 0) process.exitCode = code;
}).catch((error) => {
  console.error(`\n  Erreur : ${error?.message || error}\n`);
  process.exitCode = 1;
});
