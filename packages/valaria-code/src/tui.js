/**
 * TUI plein écran VALARIA Code.
 * Écran alternatif, en-tête de marque, conversation, panneau d'activité,
 * composeur et approbations. Aucune dépendance : ANSI + Node natifs.
 */
import readline from 'node:readline';
import { COLORS, bold, dim, paint, rule, stripAnsi, truncate, visibleLength, wrap, supportsColor } from './theme.js';
import { diffText, extractCode, listFiles, readFile, runCommand, writeFile } from './tools.js';

const SYSTEM_PROMPT = `Tu es VALARIA Code, un agent de code dans le terminal.
Tu aides l'utilisateur à comprendre, écrire, modifier et tester du code.
Tu réponds en français par défaut, de façon concise et actionnable.
Tu travailles uniquement avec du texte et du code : tu ne génères pas d'images, d'audio ou de vidéo.
Quand on te demande un fichier complet, retourne uniquement son contenu dans un bloc de code.
Ne prétends jamais avoir exécuté une commande ou modifié un fichier avant l'approbation de l'utilisateur.`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTui({ client, config, model, color = supportsColor(), onModelChange = null } = {}) {
  const state = {
    messages: [],
    input: '',
    history: [],
    historyIndex: -1,
    status: 'prêt',
    streaming: false,
    approval: null,
    abort: null,
    closed: false,
    model,
    startedAt: Date.now(),
  };
  const root = process.cwd();
  const draw = () => renderScreen(state, { client, config, color, root });
  let renderTimer = null;
  const scheduleRender = () => {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (!state.closed) draw();
    }, 40);
  };

  function addMessage(role, content) {
    state.messages.push({ role, content: String(content), at: Date.now() });
    if (state.messages.length > 80) state.messages.splice(0, state.messages.length - 80);
  }

  function systemMessage(content) {
    addMessage('system', content);
  }

  function apiMessages() {
    const history = state.messages
      .filter((message) => ['user', 'assistant', 'system'].includes(message.role))
      .filter((message) => !message.content.startsWith('✎') && !message.content.startsWith('⚙'))
      .slice(-24)
      .map((message) => ({ role: message.role === 'system' ? 'system' : message.role, content: message.content }));
    return [{ role: 'system', content: `${SYSTEM_PROMPT}\nProjet courant : ${root}` }, ...history];
  }

  async function sendChat(text) {
    addMessage('user', text);
    state.input = '';
    state.history.unshift(text);
    state.historyIndex = -1;
    state.streaming = true;
    state.status = 'réflexion…';
    const assistant = { role: 'assistant', content: '', at: Date.now() };
    state.messages.push(assistant);
    state.abort = new AbortController();
    draw();
    try {
      const result = await client.stream(apiMessages(), {
        model: state.model,
        signal: state.abort.signal,
        onDelta: (delta) => {
          assistant.content += delta;
          state.status = 'streaming…';
          scheduleRender();
        },
      });
      if (!assistant.content && result?.content) assistant.content = result.content;
      state.status = result?.usage?.total_tokens ? `prêt · ${result.usage.total_tokens} tokens` : 'prêt';
    } catch (error) {
      if (error?.name === 'AbortError' || state.abort?.signal.aborted) {
        assistant.content += '\n\n[annulé]';
        state.status = 'annulé';
      } else {
        assistant.content = assistant.content || `Erreur : ${error.message}`;
        state.status = `erreur : ${error.message}`;
      }
    } finally {
      state.streaming = false;
      state.abort = null;
      draw();
    }
  }

  async function requestWrite(pathname, instruction = '') {
    const file = pathname.trim();
    if (!file) {
      systemMessage('usage : /edit <fichier> <instruction>');
      return;
    }
    let before = '';
    try { before = readFile(root, file); } catch { before = ''; }
    state.status = `préparation de ${file}…`;
    draw();
    try {
      const prompt = `${instruction || `Écris la version complète du fichier ${file}.`}

${before ? `Contenu actuel de ${file} :\n\`\`\`\n${before}\n\`\`\`` : `Le fichier ${file} n'existe pas encore.`}

Retourne UNIQUEMENT le contenu complet du fichier, sans explication, dans un bloc de code.`;
      const result = await client.chat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ], { model: state.model, maxTokens: 8192 });
      const content = extractCode(result.content);
      state.approval = { type: 'write', file, before, content, diff: diffText(before, content) };
      state.status = 'approbation requise';
    } catch (error) {
      systemMessage(`✎ Échec de préparation : ${error.message}`);
      state.status = `erreur : ${error.message}`;
    }
    draw();
  }

  async function executeCommand(line) {
    const [command, ...rest] = line.slice(1).trim().split(/\s+/);
    const argument = rest.join(' ').trim();
    switch (command) {
      case 'help':
        systemMessage('⚙ Commandes\n/help · /files [dossier] · /read <fichier> · /edit <fichier> <instruction>\n/models · /model <nom> · /usage · /run <commande> · /clear · /quit\n\nEntrée : envoyer · Ctrl+C : annuler · Ctrl+L : redessiner');
        break;
      case 'files': {
        try {
          const files = listFiles(root, argument || '.', 160);
          systemMessage(`⚙ ${files.length} fichier(s)\n${files.join('\n')}`);
        } catch (error) { systemMessage(`✎ ${error.message}`); }
        break;
      }
      case 'read': {
        try {
          const content = readFile(root, argument);
          addMessage('system', `Fichier ${argument} :\n\`\`\`\n${content.slice(0, 60_000)}\n\`\`\``);
        } catch (error) { systemMessage(`✎ ${error.message}`); }
        break;
      }
      case 'edit':
      case 'write': {
        const [file, ...instruction] = argument.split(/\s+/);
        await requestWrite(file, instruction.join(' '));
        return;
      }
      case 'run':
        if (!argument) { systemMessage('usage : /run <commande>'); break; }
        state.approval = { type: 'run', command: argument };
        state.status = 'approbation requise';
        break;
      case 'models': {
        state.status = 'chargement des modèles…';
        draw();
        try { systemMessage(`⚙ Modèles disponibles\n${(await client.models()).join('\n')}`); }
        catch (error) { systemMessage(`✎ ${error.message}`); }
        break;
      }
      case 'model':
        if (argument) {
          state.model = argument;
          if (onModelChange) onModelChange(argument);
          systemMessage(`⚙ Modèle : ${argument}`);
        } else {
          systemMessage(`⚙ Modèle courant : ${state.model}`);
        }
        break;
      case 'usage': {
        state.status = 'chargement du compte…';
        draw();
        try {
          const me = await client.me();
          const q = me.quota?.requests;
          const usd = me.quota?.usd;
          systemMessage(`⚙ Compte ${me.client?.name || ''}\nRequêtes : ${q?.used ?? 0} / ${q?.limit ?? '∞'}\nCrédit : ${usd?.used ?? 0} / ${usd?.limit ?? '∞'}\nPass : ${me.plan?.name || me.client?.period || '—'}`);
        } catch (error) { systemMessage(`✎ ${error.message}`); }
        break;
      }
      case 'clear':
        state.messages = [];
        break;
      case 'quit':
      case 'exit':
        state.closed = true;
        break;
      default:
        systemMessage(`✎ Commande inconnue : /${command}. /help pour la liste.`);
    }
    state.status = 'prêt';
    draw();
  }

  function submit() {
    const value = state.input.trim();
    if (state.approval) {
      if (/^y(es)?$/i.test(value)) approvePending();
      else if (/^n(o)?$/i.test(value)) {
        systemMessage('⚙ Action refusée.');
        state.approval = null;
        state.status = 'prêt';
        draw();
      } else {
        state.status = 'répondez y (autoriser) ou n (refuser)';
        state.input = '';
        draw();
      }
      return;
    }
    if (!value) return;
    state.input = '';
    if (value.startsWith('/')) { executeCommand(value); return; }
    sendChat(value);
  }

  async function approvePending() {
    const approval = state.approval;
    state.approval = null;
    if (!approval) return;
    if (approval.type === 'write') {
      try {
        writeFile(root, approval.file, approval.content);
        systemMessage(`⚙ Fichier écrit : ${approval.file}`);
        state.status = 'fichier enregistré';
      } catch (error) {
        systemMessage(`✎ ${error.message}`);
        state.status = `erreur : ${error.message}`;
      }
      draw();
      return;
    }
    if (approval.type === 'run') {
      state.status = `exécution de ${approval.command}…`;
      draw();
      const result = await runCommand(approval.command, { cwd: root });
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, 20_000);
      systemMessage(`⚙ $ ${approval.command}\ncode ${result.code}${result.truncated ? ' · sortie tronquée' : ''}\n\`\`\`\n${output || '(aucune sortie)'}\n\`\`\``);
      state.status = `commande terminée (${result.code})`;
      draw();
    }
  }

  function onKey(key) {
    if (state.closed) return;
    if (key === '\u0003') { // Ctrl+C
      if (state.streaming && state.abort) {
        state.abort.abort();
        state.status = 'annulation…';
        return;
      }
      if (state.input) { state.input = ''; state.status = 'prêt'; draw(); return; }
      cleanup();
      process.exitCode = 0;
      return;
    }
    if (key === '\u0004') { cleanup(); process.exitCode = 0; return; }
    if (key === '\u000c') { draw(); return; }
    if (key === '\u007f' || key === '\b') { state.input = state.input.slice(0, -1); draw(); return; }
    if (key === '\x1b[A') {
      if (state.history.length) {
        state.historyIndex = Math.min(state.history.length - 1, state.historyIndex + 1);
        state.input = state.history[state.historyIndex] || '';
        draw();
      }
      return;
    }
    if (key === '\x1b[B') {
      state.historyIndex = Math.max(-1, state.historyIndex - 1);
      state.input = state.historyIndex >= 0 ? state.history[state.historyIndex] : '';
      draw();
      return;
    }
    if (key === '\r' || key === '\n') { submit(); return; }
    if (key.startsWith('\x1b')) return;
    if (key.length > 1) {
      state.input += key.replace(/[\x00-\x08\x0b-\x1f]/g, '');
    } else if (key >= ' ') {
      state.input += key;
    }
    draw();
  }

  function cleanup() {
    if (state.closed) return;
    state.closed = true;
    try { process.stdin.setRawMode(false); } catch { /* ignore */ }
    process.stdin.pause();
    process.stdout.write('\x1b[?25h\x1b[?1049l');
  }

  const onResize = () => draw();
  process.stdout.write('\x1b[?1049h\x1b[?25l');
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', onKey);
  process.stdout.on('resize', onResize);
  process.on('SIGINT', () => onKey('\u0003'));

  systemMessage(`⚙ VALARIA Code prête. Projet : ${root}\n/help pour les commandes. /edit <fichier> <instruction> pour modifier un fichier.`);
  draw();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (state.closed) {
        clearInterval(timer);
        process.stdin.off('data', onKey);
        process.stdout.off('resize', onResize);
        resolve(0);
      }
    }, 80);
  });
}

export function renderScreen(state, { client, config, color = true, root = process.cwd() } = {}) {
  const cols = Math.max(54, Math.min(Number(process.stdout.columns) || 90, 110));
  const rows = Math.max(16, Number(process.stdout.rows) || 24);
  const lines = [];
  const add = (value = '') => lines.push(value);
  const c = (text, hex) => paint(text, hex, color);
  const b = (text) => bold(text, color);
  const d = (text) => dim(text, color);

  add(`  ${c('V', COLORS.accent)}  ${b('VALARIA')} ${c('CODE', COLORS.accent2)}  ${d('agent de code · terminal')}  ${d(`v${state.version || '0.1.0'}`)}`);
  add(`  ${d('─'.repeat(Math.max(0, cols - 4)))}`);
  add(`  ${c('●', COLORS.accent)} ${d('connecté')}  ${d('·')}  ${truncate(client?.baseUrl || config?.url || '', cols - 30)}  ${d('·')}  ${c(state.model || 'modèle', COLORS.amber)}`);
  add('');

  const bodyRows = Math.max(6, rows - 10);
  const body = [];
  for (const message of state.messages) {
    const prefix = message.role === 'user' ? c('›', COLORS.accent) : message.role === 'assistant' ? c('▌', COLORS.accent2) : c('·', COLORS.dim);
    const label = message.role === 'user' ? c('vous', COLORS.muted) : message.role === 'assistant' ? b('VALARIA') : d('système');
    body.push(`${prefix} ${label}`);
    const wrapped = wrap(message.content || '', cols - 4);
    for (const line of wrapped) body.push(`  ${line}`);
    body.push('');
  }
  const shownBody = body.slice(-bodyRows);
  while (shownBody.length < bodyRows) shownBody.push('');
  for (const line of shownBody) add(truncate(line, cols));

  add(`  ${rule(Math.max(0, cols - 4), color)}`);
  if (state.approval) {
    const approval = state.approval;
    add(`  ${c('⚠ APPROBATION REQUISE', COLORS.amber)}  ${d('y autoriser · n refuser')}`);
    if (approval.type === 'write') {
      add(`  ${b(approval.file)}`);
      const diffLines = String(approval.diff).split('\n').slice(-Math.max(2, rows - 11));
      for (const line of diffLines) {
        const hex = line.startsWith('+') ? COLORS.accent : line.startsWith('-') ? COLORS.danger : COLORS.dim;
        add(`  ${c(truncate(line, cols - 4), hex)}`);
      }
    } else {
      add(`  ${c('$', COLORS.amber)} ${truncate(approval.command, cols - 6)}`);
    }
  } else {
    add(`  ${c('>', COLORS.accent)} ${state.input}${state.streaming ? c('▌', COLORS.accent) : ''}`);
  }
  add(`  ${d(state.status || 'prêt')}  ${d('· Entrée envoyer · / commandes · Ctrl+C annuler · Ctrl+D quitter')}`);
  process.stdout.write(`\x1b[H\x1b[2J${lines.join('\n')}\x1b[?25l`);
}

export async function runPlainChat({ client, messages, model, onDelta }) {
  return client.stream(messages, { model, onDelta });
}

export const runTui = createTui;
