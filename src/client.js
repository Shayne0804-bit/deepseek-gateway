/**
 * Client CLI VALARIA Gateway API.
 *
 * Se connecte à une instance HÉBERGÉE (https://votre-domaine) avec une clé
 * dérivée `sk-dsk-…` : aucun serveur local, aucune installation de la base.
 * L'interface est une console terminal personnalisée (tableau de bord, quotas,
 * consommation 30 jours, modèles, requêtes, chat).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CONFIG_FILE = 'client.json';
const DEFAULT_HOME = path.join(os.homedir(), '.valaria-gateway');

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[92m',
  cyan: '\x1b[96m',
  amber: '\x1b[93m',
  red: '\x1b[91m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};

function colorize(enabled) {
  return {
    bold: (text) => (enabled ? `${ANSI.bold}${text}${ANSI.reset}` : text),
    dim: (text) => (enabled ? `${ANSI.dim}${text}${ANSI.reset}` : text),
    green: (text) => (enabled ? `${ANSI.green}${text}${ANSI.reset}` : text),
    cyan: (text) => (enabled ? `${ANSI.cyan}${text}${ANSI.reset}` : text),
    amber: (text) => (enabled ? `${ANSI.amber}${text}${ANSI.reset}` : text),
    red: (text) => (enabled ? `${ANSI.red}${text}${ANSI.reset}` : text),
    gray: (text) => (enabled ? `${ANSI.gray}${text}${ANSI.reset}` : text),
    white: (text) => (enabled ? `${ANSI.white}${text}${ANSI.reset}` : text),
  };
}

const NF = new Intl.NumberFormat('fr-FR');
const USD = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const USD2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function fmtInt(value) {
  return NF.format(Number(value) || 0);
}

function fmtUsd(value) {
  return `${USD.format(Number(value) || 0)} $`;
}

function fmtUsd2(value) {
  return `${USD2.format(Number(value) || 0)} $`;
}

function fmtCompact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)} k`;
  return NF.format(n);
}

function fmtDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE.format(date);
}

/* ------------------------------ config ---------------------------------- */

export function resolveHome(homeOption) {
  return path.resolve(homeOption || process.env.VALARIA_HOME || DEFAULT_HOME);
}

function clientConfigPath(home) {
  return path.join(home, CONFIG_FILE);
}

export function loadClientConfig(home) {
  try {
    const raw = fs.readFileSync(clientConfigPath(home), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed?.url || !parsed?.key) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveClientConfig(home, config) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = clientConfigPath(home);
  fs.writeFileSync(file, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  return file;
}

export function clearClientConfig(home) {
  try { fs.rmSync(clientConfigPath(home), { force: true }); } catch { /* ignore */ }
}

export function normalizeUrl(rawUrl) {
  const candidate = String(rawUrl ?? '').trim().replace(/\/+$/, '');
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('URL invalide. Exemple : --url https://api.votre-domaine.fr');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('L’URL doit commencer par http:// ou https://.');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/* --------------------------- appel serveur ------------------------------ */

function friendlyError(error, config) {
  if (error?.name === 'TimeoutError') return new Error('Le serveur n’a pas répondu à temps.');
  if (error?.cause?.code === 'ENOTFOUND') return new Error(`Serveur introuvable : ${config.url}`);
  if (error?.cause?.code === 'ECONNREFUSED') return new Error(`Connexion refusée : ${config.url}`);
  return error;
}

async function request(config, pathname, options = {}) {
  const url = `${config.url}${pathname}`;
  const headers = {
    authorization: `Bearer ${config.key}`,
    accept: 'application/json',
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
    });
  } catch (error) {
    throw friendlyError(error, config);
  }
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) {
    const message = data?.error?.message || `Erreur HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = data?.error?.code;
    throw error;
  }
  return { data, headers: response.headers };
}

/** Valide une clé et récupère l'identité cliente sur l'instance hébergée. */
export async function connect({ url, key }) {
  const config = { url: normalizeUrl(url), key: String(key ?? '').trim() };
  if (!/^sk-dsk-/.test(config.key)) {
    throw new Error('Clé invalide : elle doit commencer par sk-dsk-… (fournie par l’administrateur).');
  }
  const { data } = await request(config, '/portal/api/me');
  return {
    config,
    client: {
      name: data.client?.name ?? 'utilisateur',
      email: data.client?.email ?? null,
      keyPrefix: data.client?.keyPrefix ?? `${config.key.slice(0, 12)}…`,
    },
    server: data.server ?? null,
  };
}

export async function fetchDashboard(config) {
  const [{ data: me }, { data: logs }] = await Promise.all([
    request(config, '/portal/api/me'),
    request(config, '/portal/api/logs?limit=6').catch(() => ({ data: { rows: [], total: 0 } })),
  ]);
  return { me, logs };
}

export async function listModels(config) {
  const { data } = await request(config, '/v1/models');
  return (data.data ?? []).map((model) => model.id);
}

export async function ask(config, prompt, { model } = {}) {
  let chosenModel = model;
  if (!chosenModel) {
    try {
      const models = await listModels(config);
      chosenModel = models.includes('deepseek-flash') ? 'deepseek-flash' : models[0];
    } catch {
      chosenModel = 'deepseek-flash';
    }
  }
  const { data } = await request(config, '/v1/chat/completions', {
    method: 'POST',
    body: { model: chosenModel, messages: [{ role: 'user', content: prompt }] },
    timeoutMs: 180_000,
  });
  return {
    model: data.model ?? chosenModel,
    content: data.choices?.[0]?.message?.content ?? '',
    usage: data.usage ?? null,
    requestedModel: chosenModel,
  };
}

export function openInBrowser(config, target = 'portal') {
  const url = `${config.url}/${target === 'admin' ? 'admin' : 'portal'}`;
  const command = process.platform === 'win32'
    ? { file: 'cmd', args: ['/c', 'start', '', url] }
    : process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : { file: 'xdg-open', args: [url] };
  const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' });
  child.unref();
  return url;
}

/* ------------------------------ rendu ----------------------------------- */

function panel(lines, { width = 78, title = null } = {}) {
  const inner = width - 4;
  const visibleLength = (text) => String(text).replace(/\x1b\[[0-9;]*m/g, '').length;
  const truncateVisible = (text, max) => {
    let out = '';
    let visible = 0;
    let index = 0;
    const hadAnsi = text.includes('\x1b');
    while (index < text.length) {
      if (text[index] === '\x1b') {
        const match = /^\x1b\[[0-9;]*m/.exec(text.slice(index));
        if (match) {
          out += match[0];
          index += match[0].length;
          continue;
        }
      }
      if (visible >= max) break;
      out += text[index];
      visible += 1;
      index += 1;
    }
    return hadAnsi ? `${out}\x1b[0m` : out;
  };
  const padded = lines.map((line) => {
    const raw = String(line);
    const clipped = truncateVisible(raw, inner);
    const length = visibleLength(clipped);
    return `│ ${clipped}${' '.repeat(Math.max(0, inner - length))} │`;
  });
  const header = title
    ? `╭─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 5))}╮`
    : `╭${'─'.repeat(width - 2)}╮`;
  return [header, ...padded, `╰${'─'.repeat(width - 2)}╯`];
}

function progressBar(percent, width, colors) {
  const safe = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((safe / 100) * width);
  const bar = colors.green('█'.repeat(filled)) + colors.gray('░'.repeat(width - filled));
  return `${bar} ${String(safe).padStart(3)} %`;
}

function sparkline(series, colors) {
  const values = series.map((row) => Number(row.tokens) || 0);
  const max = Math.max(1, ...values);
  const glyphs = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  return values.map((value) => {
    if (!value) return colors.gray('·');
    const index = Math.max(0, Math.min(glyphs.length - 1, Math.round((value / max) * (glyphs.length - 1))));
    return colors.green(glyphs[index]);
  }).join('');
}

export function renderDashboard({ me, logs }, config, { color = false } = {}) {
  const c = colorize(color);
  const out = [];
  const client = me.client ?? {};
  const quota = me.quota ?? {};
  const usage = me.usage ?? { today: {}, totals: {}, series: [] };
  const limits = me.limits ?? {};
  const models = me.models ?? [];

  out.push('');
  out.push(...panel([
    `${c.green('>_')} ${c.bold('VALARIA GATEWAY API')}   ${c.dim('console cliente')}`,
    `${c.gray(config.url)}  ·  ${c.white(client.name ?? 'utilisateur')}${client.email ? c.gray(` <${client.email}>`) : c.gray(`  (${client.keyPrefix ?? ''})`)}`,
  ], { width: 78 }));
  out.push('');

  const quotaLines = [];
  const addQuota = (label, q, formatter) => {
    if (!q) return;
    if (!q.limit) {
      quotaLines.push(`${label.padEnd(10)} ${formatter(q.used ?? 0)} ${c.gray('· aucune limite')}`);
      return;
    }
    const pct = q.limit > 0 ? ((q.used ?? 0) / q.limit) * 100 : 0;
    quotaLines.push(`${label.padEnd(10)} ${progressBar(pct, 22, c)}  ${formatter(q.used ?? 0)} / ${formatter(q.limit)} ${c.gray(`· restant ${formatter(q.remaining ?? 0)}`)}`);
  };
  addQuota('Tokens', quota.tokens, fmtCompact);
  addQuota('Requêtes', quota.requests, fmtInt);
  addQuota('Coût', quota.usd, fmtUsd2);
  if (!quotaLines.length) quotaLines.push(c.gray('Aucun quota configuré.'));
  out.push(...panel(quotaLines, { title: 'QUOTAS', width: 78 }));
  out.push('');

  const series = usage.series ?? [];
  const spark = sparkline(series, c);
  const today = usage.today ?? {};
  const totals = usage.totals ?? {};
  out.push(...panel([
    `${c.cyan('30 jours')} ${spark}`,
    `${c.gray('aujourd’hui')} ${fmtInt(today.requests)} req · ${fmtCompact(today.tokens)} tok · ${fmtUsd(today.cost)}    ${c.gray('total')} ${fmtInt(totals.requests)} req · ${fmtCompact(totals.tokens)} tok`,
  ], { title: 'CONSOMMATION', width: 78 }));
  out.push('');

  const limitLines = [];
  limitLines.push(`${c.gray('période')} ${client.period ?? '—'}    ${c.gray('débit')} ${limits.rpmLimit ? `${fmtInt(limits.rpmLimit)} req/min` : 'non limité'}    ${c.gray('sortie max')} ${limits.maxOutputTokens ? fmtCompact(limits.maxOutputTokens) : 'non plafonnée'}`);
  limitLines.push(`${c.gray('modèles')} ${(models.length ? models : limits.allowedModels ?? []).slice(0, 8).join(' · ')}`);
  if (me.status && me.status !== 'ok') {
    limitLines.push(c.amber(`⚠ ${me.statusMessage || 'cette clé ne peut pas envoyer de requêtes.'}`));
  }
  out.push(...panel(limitLines, { title: 'MA CLÉ', width: 78 }));
  out.push('');

  const rows = logs.rows ?? [];
  const logLines = rows.length
    ? rows.map((row) => {
      const model = row.requestedModel ? `${row.requestedModel}${c.gray(` → ${row.model ?? '?'}`)}` : row.model ?? '—';
      return `${c.gray(fmtDate(row.createdAt).padEnd(17))} ${model.padEnd(26).slice(0, 26)} ${fmtCompact(row.totalTokens).padStart(7)} tok  ${fmtUsd(row.costUsd).padStart(10)}  ${Number(row.status) >= 200 && Number(row.status) < 300 ? c.green(String(row.status)) : c.red(String(row.status))}`;
    })
    : [c.gray('Aucune requête pour le moment.')];
  out.push(...panel(logLines, { title: 'DERNIÈRES REQUÊTES', width: 78 }));
  out.push('');
  out.push(`  ${c.gray('astuce')} ${c.green('valaria-gateway ask "Bonjour"')} · ${c.green('models')} · ${c.green('logs')} · ${c.green('open')} · ${c.green('ui')}`);
  out.push('');
  return out.join('\n');
}

/* ---------------------------- interface UI ------------------------------ */

export async function runUi(config, { color = false, onRefresh = null } = {}) {
  const c = colorize(color);
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let done = false;
  const refresh = async () => {
    const dashboard = await fetchDashboard(config);
    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write(`${renderDashboard(dashboard, config, { color })}\n`);
    if (onRefresh) onRefresh(dashboard);
  };
  try {
    await refresh();
    while (!done) {
      const line = (await rl.question(c.green('valaria> '))).trim();
      if (!line) { await refresh(); continue; }
      const [command, ...rest] = line.split(/\s+/);
      const argument = rest.join(' ');
      if (['quit', 'exit', 'q'].includes(command)) break;
      if (command === 'help') {
        console.log(`\n  ${c.bold('Commandes')}\n  status                 rafraîchir le tableau de bord\n  ask <texte>            envoyer une requête au modèle\n  models                 lister les modèles disponibles\n  logs                   afficher les dernières requêtes\n  open [admin]           ouvrir le portail web hébergé\n  quit                   quitter\n`);
        continue;
      }
      if (command === 'status' || command === 'refresh') { await refresh(); continue; }
      if (command === 'ask') {
        if (!argument) { console.log(c.amber('  usage : ask <texte>')); continue; }
        console.log(`\n  ${c.gray('envoi…')}`);
        try {
          const result = await ask(config, argument);
          console.log(`\n${c.green('▌')} ${c.bold(result.model)}\n\n${result.content}\n\n${c.gray(`tokens : ${result.usage?.total_tokens ?? '—'}`)}\n`);
        } catch (err) {
          console.log(c.red(`  ${err.message}`));
        }
        continue;
      }
      if (command === 'models') {
        const models = await listModels(config);
        console.log(`\n  ${models.map((model) => c.cyan(model)).join(' · ')}\n`);
        continue;
      }
      if (command === 'logs') {
        const dashboard = await fetchDashboard(config);
        console.log(`\n${renderDashboard(dashboard, config, { color })}\n`);
        continue;
      }
      if (command === 'open') {
        console.log(`  ${c.green('ouvert')} ${openInBrowser(config, argument === 'admin' ? 'admin' : 'portal')}`);
        continue;
      }
      console.log(c.amber(`  commande inconnue : ${command} (tapez help)`));
    }
  } catch (err) {
    if (err?.code !== 'ERR_USE_AFTER_CLOSE') throw err;
  } finally {
    rl.close();
  }
}
