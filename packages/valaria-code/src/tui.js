/**
 * TUI plein écran VALARIA Code.
 * Écran alternatif, en-tête de marque, conversation, panneau d'activité,
 * composeur et approbations. Aucune dépendance : ANSI + Node natifs.
 */
import readline from 'node:readline';
import { COLORS, bold, dim, paint, rule, stripAnsi, truncate, visibleLength, wrap, supportsColor } from './theme.js';
import { runAgent } from './agent.js';
import { MARK, PULSE, SPINNER, TAGLINE, WORDMARK } from './assets.js';
import { collectWorkspaceDiff, summarize } from './diff-view.js';
import { playSplash } from './splash.js';
import { diffText, extractCode, listFiles, readFile, runCommand, writeFile } from './tools.js';

const SYSTEM_PROMPT = `Tu es VALARIA Code, un agent de code dans le terminal.
Tu aides l'utilisateur à comprendre, écrire, modifier et tester du code.
Tu réponds en français par défaut, de façon concise et actionnable.
Tu travailles uniquement avec du texte et du code : tu ne génères pas d'images, d'audio ou de vidéo.
Quand on te demande un fichier complet, retourne uniquement son contenu dans un bloc de code.
Ne prétends jamais avoir exécuté une commande ou modifié un fichier avant l'approbation de l'utilisateur.`;

export const LAYOUT_LABELS = {
  focus: 'Focus',
  studio: 'Studio',
  compact: 'Compact',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTui({ client, config, model, layout = 'focus', version = '0.7.0', color = supportsColor(), animations = true, account = null, onModelChange = null, onPreferencesChange = null } = {}) {
  const state = {
    messages: [],
    input: '',
    history: [],
    historyIndex: -1,
    status: 'prêt',
    streaming: false,
    agentRunning: false,
    agentAbort: null,
    mode: 'agent',
    layout: ['focus', 'studio', 'compact'].includes(layout) ? layout : 'focus',
    overlay: null,
    diffReview: null,
    approval: null,
    abort: null,
    closed: false,
    ready: false,
    animations,
    model,
    version,
    account,
    tick: 0,
    suggestions: [],
    startedAt: Date.now(),
  };
  const root = process.cwd();
  const draw = () => renderScreen(state, { client, config, color, root });
  let renderTimer = null;
  const scheduleRender = () => {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (!state.closed && state.ready) draw();
    }, 40);
  };

  async function refreshAccount() {
    try {
      state.account = await client.me();
      scheduleRender();
    } catch {
      /* le statut visible reste utilisable hors ligne */
    }
  }

  function addMessage(role, content) {
    state.messages.push({ role, content: String(content), at: Date.now() });
    if (state.messages.length > 80) state.messages.splice(0, state.messages.length - 80);
  }

  function systemMessage(content) {
    addMessage('system', content);
  }

  function suggestionsFor(task) {
    const base = [
      { code: '1', label: 'Lancer les tests', input: '/run npm test' },
      { code: '2', label: 'Planifier la suite', input: `/plan ${task}` },
      { code: '3', label: 'Voir mon compte', input: '/account' },
    ];
    state.suggestions = base;
    systemMessage(`Suggestions : ${base.map((item) => `[${item.code}] ${item.label}`).join('  ·  ')}`);
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
      suggestionsFor(text);
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
      refreshAccount();
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
      openDiffReview({ path: file, content, diff: state.approval.diff, status: 'M' }).catch(() => {});
      return;
    } catch (error) {
      systemMessage(`✎ Échec de préparation : ${error.message}`);
      state.status = `erreur : ${error.message}`;
    }
    draw();
  }

  async function openDiffReview(extra = null) {
    state.status = 'analyse des fichiers…';
    draw();
    const review = await collectWorkspaceDiff(root, extra);
    if (!review.ok) {
      systemMessage(`⚙ ${review.error}`);
      state.status = 'prêt';
      draw();
      return;
    }
    const selected = extra?.path ? review.files.findIndex((file) => file.path === extra.path) : 0;
    state.diffReview = { ...review, selected: Math.max(0, selected), scroll: 0, wide: false, canApprove: Boolean(state.approval) };
    state.overlay = 'diff';
    state.status = state.approval ? 'revue du diff · y autoriser / n refuser' : 'revue du diff';
    draw();
  }

  async function runAgentTask(task, { explicit = false } = {}) {
    if (!task) {
      systemMessage('usage : /agent <tâche>');
      return;
    }
    state.agentRunning = true;
    state.streaming = true;
    state.mode = 'agent';
    state.agentAbort = new AbortController();
    state.status = 'agent en cours…';
    addMessage('user', task);
    draw();
    try {
      const result = await runAgent({
        client,
        root,
        task,
        model: state.model,
        signal: state.agentAbort.signal,
        approve: (request) => new Promise((resolve) => {
          state.approval = { ...request, resolve };
          state.status = 'approbation demandée par l’agent';
          draw();
          if (request.type === 'write') {
            const content = request.content || '';
            openDiffReview({ path: request.file, content, diff: request.diff, status: 'M' }).catch(() => {});
          }
        }),
        onEvent: (event) => {
          if (event.type === 'assistant' && event.content) addMessage('assistant', event.content);
          else if (event.type === 'tool') {
            const args = event.args || {};
            const label = event.name === 'read_file' ? `Lecture ${args.path || ''}`
              : event.name === 'write_file' ? `Écriture ${args.path || ''}`
                : event.name === 'run_command' ? `$ ${args.command || ''}`
                  : event.name === 'search_files' ? `Recherche « ${args.query || ''} »`
                    : `Liste ${args.path || '.'}`;
            addMessage('tool', label.trim());
            state.status = `agent · ${event.name}`;
            scheduleRender();
          } else if (event.type === 'error') systemMessage(`✎ ${event.name} : ${event.message}`);
        },
      });
      systemMessage(`⚙ Agent terminé · ${result.steps} étape(s)`);
      suggestionsFor(task);
      state.status = 'prêt';
    } catch (error) {
      systemMessage(`✎ Agent : ${error.message}`);
      state.status = `erreur : ${error.message}`;
    } finally {
      state.agentRunning = false;
      state.streaming = false;
      state.agentAbort = null;
      state.approval = null;
      refreshAccount();
      draw();
    }
  }

  async function planTask(task) {
    if (!task) {
      systemMessage('usage : /plan <objectif>');
      return;
    }
    state.streaming = true;
    state.status = 'planification…';
    draw();
    try {
      const result = await client.chat([
        { role: 'system', content: `${SYSTEM_PROMPT}\nMode planification : ne modifie aucun fichier. Produis un plan court et ordonné, avec les fichiers concernés et les vérifications à lancer.` },
        { role: 'user', content: task },
      ], { model: state.model, maxTokens: 4096 });
      addMessage('assistant', result.content);
      suggestionsFor(task);
      state.status = 'prêt';
    } catch (error) {
      systemMessage(`✎ Plan : ${error.message}`);
      state.status = `erreur : ${error.message}`;
    } finally {
      state.streaming = false;
      refreshAccount();
      draw();
    }
  }

  async function interviewTask() {
    state.streaming = true;
    state.status = 'interview…';
    draw();
    try {
      const result = await client.chat([
        { role: 'system', content: `${SYSTEM_PROMPT}\nMode interview : pose au maximum 3 questions courtes pour clarifier le besoin avant de coder. Ne propose pas encore de patch.` },
        { role: 'user', content: 'Je veux clarifier ma demande avant de commencer.' },
      ], { model: state.model, maxTokens: 1024 });
      addMessage('assistant', result.content);
      state.status = 'prêt';
    } catch (error) {
      systemMessage(`✎ Interview : ${error.message}`);
      state.status = `erreur : ${error.message}`;
    } finally {
      state.streaming = false;
      refreshAccount();
      draw();
    }
  }

  async function reviewTask() {
    state.streaming = true;
    state.status = 'revue du diff…';
    draw();
    try {
      const diff = await runCommand('git diff --stat', { cwd: root });
      const detail = await runCommand('git diff', { cwd: root });
      const text = `${diff.stdout}\n${detail.stdout}`.trim();
      if (!text) {
        systemMessage('⚙ Aucun changement à relire.');
        state.status = 'prêt';
        return;
      }
      const result = await client.chat([
        { role: 'system', content: `${SYSTEM_PROMPT}\nMode revue : analyse le diff, signale les bugs, risques et tests manquants. Ne modifie rien.` },
        { role: 'user', content: text.slice(0, 60_000) },
      ], { model: state.model, maxTokens: 4096 });
      addMessage('assistant', result.content);
      suggestionsFor('corrige les points de la revue');
      state.status = 'prêt';
    } catch (error) {
      systemMessage(`✎ Revue : ${error.message}`);
      state.status = `erreur : ${error.message}`;
    } finally {
      state.streaming = false;
      refreshAccount();
      draw();
    }
  }

  async function executeCommand(line) {
    const [command, ...rest] = line.slice(1).trim().split(/\s+/);
    const argument = rest.join(' ').trim();
    switch (command) {
      case 'help':
        systemMessage('⚙ Votre message est exécuté par l’agent (lecture/patch/tests, avec approbations).\n/chat <message> · /agent <tâche> · /interview · /plan <objectif> · /review · /diff\n/files [dossier] · /read <fichier> · /edit <fichier> <instruction> · /run <commande>\n/models · /model <nom> · /account · /layout focus|studio|compact · /animations on|off · /mode agent|chat · /usage · /clear · /quit\n\nCtrl+O : compte · Ctrl+P : interface · Ctrl+C : annuler · 1/2/3 : suggestion');
        break;
      case 'agent': {
        await runAgentTask(argument, { explicit: true });
        return;
      }
      case 'plan': {
        await planTask(argument);
        return;
      }
      case 'diff': {
        await openDiffReview();
        return;
      }
      case 'interview': {
        await interviewTask();
        return;
      }
      case 'review': {
        await reviewTask();
        return;
      }
      case 'chat': {
        if (!argument) {
          state.mode = 'chat';
          systemMessage('⚙ Mode conversation simple. /mode agent pour revenir à l’agent.');
          break;
        }
        await sendChat(argument);
        return;
      }
      case 'mode': {
        state.mode = argument === 'chat' ? 'chat' : 'agent';
        systemMessage(`⚙ Mode ${state.mode === 'agent' ? 'agent' : 'conversation'}.`);
        break;
      }
      case 'layout': {
        const next = ['focus', 'studio', 'compact'].includes(argument)
          ? argument
          : state.layout === 'focus' ? 'studio' : state.layout === 'studio' ? 'compact' : 'focus';
        state.layout = next;
        if (onPreferencesChange) onPreferencesChange({ layout: next });
        systemMessage(`⚙ Interface : ${LAYOUT_LABELS[next]}. /layout focus|studio|compact pour changer.`);
        break;
      }
      case 'animations':
      case 'anim': {
        state.animations = argument === 'off' ? false : argument === 'on' ? true : !state.animations;
        systemMessage(`⚙ Animations : ${state.animations ? 'activées' : 'désactivées'}.`);
        break;
      }
      case 'account':
      case 'compte':
        state.overlay = 'account';
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

  function denyPending() {
    const approval = state.approval;
    if (!approval) return;
    state.approval = null;
    state.overlay = null;
    state.diffReview = null;
    if (typeof approval.resolve === 'function') approval.resolve(false);
    systemMessage('⚙ Action refusée.');
    state.status = 'prêt';
    draw();
  }

  function submit() {
    const value = state.input.trim();
    if (state.approval) {
      if (/^y(es)?$/i.test(value)) approvePending();
      else if (/^n(o)?$/i.test(value)) denyPending();
      else {
        state.status = 'répondez y (autoriser) ou n (refuser)';
        state.input = '';
        draw();
      }
      return;
    }
    if (!value) return;
    if (state.agentRunning) {
      state.input = '';
      state.status = 'agent en cours…';
      draw();
      return;
    }
    state.input = '';
    if (value.startsWith('/')) { executeCommand(value); return; }
    if (state.mode === 'chat') sendChat(value);
    else runAgentTask(value);
  }

  async function approvePending() {
    const approval = state.approval;
    state.approval = null;
    state.overlay = null;
    state.diffReview = null;
    if (!approval) return;
    if (typeof approval.resolve === 'function') {
      approval.resolve(true);
      state.status = 'action autorisée par l’utilisateur';
      draw();
      return;
    }
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
    if (!state.ready) {
      if (key === '\u0003') { cleanup(); process.exitCode = 0; }
      return;
    }
    if (state.overlay) {
      if (state.overlay === 'diff') {
        const review = state.diffReview;
        if (key === '\x1b[A' || key === 'k') {
          if (review?.files?.length) {
            review.selected = (review.selected + review.files.length - 1) % review.files.length;
            review.scroll = 0;
            draw();
          }
          return;
        }
        if (key === '\x1b[B' || key === 'j') {
          if (review?.files?.length) {
            review.selected = (review.selected + 1) % review.files.length;
            review.scroll = 0;
            draw();
          }
          return;
        }
        if (key === '\x1b[5~' || key === '\x1b[6~') {
          if (review) {
            review.scroll = Math.max(0, (review.scroll || 0) + (key === '\x1b[5~' ? -12 : 12));
            draw();
          }
          return;
        }
        if (key === 'd') {
          if (review) {
            review.wide = !review.wide;
            draw();
          }
          return;
        }
        if (state.approval && (/^y$/i.test(key) || /^n$/i.test(key))) {
          if (key.toLowerCase() === 'y') approvePending();
          else denyPending();
          return;
        }
        if (key === '\u0003' || key === '\u001b' || key === 'q') {
          if (state.approval) denyPending();
          else { state.overlay = null; state.diffReview = null; draw(); }
        }
        return;
      }
      if (key === '\u0003' || key === '\u001b' || key === '\r' || key === '\n' || key === 'q') {
        state.overlay = null;
        draw();
      }
      return;
    }
    if (key === '\u000f') { // Ctrl+O : compte
      state.overlay = 'account';
      draw();
      return;
    }
    if (key === '\u0010') { // Ctrl+P : changer d'interface
      const order = ['focus', 'studio', 'compact'];
      const next = order[(order.indexOf(state.layout) + 1) % order.length];
      state.layout = next;
      if (onPreferencesChange) onPreferencesChange({ layout: next });
      draw();
      return;
    }
    if (!state.input && !state.streaming && !state.agentRunning && state.suggestions.length && ['1', '2', '3'].includes(key)) {
      const suggestion = state.suggestions[Number(key) - 1];
      if (suggestion) {
        state.suggestions = [];
        state.input = suggestion.input;
        submit();
        return;
      }
    }
    if (!state.input && !state.streaming && !state.agentRunning && key === '?') {
      executeCommand('/help');
      return;
    }
    if (key === '\u0003') { // Ctrl+C
      if (state.agentRunning) {
        if (typeof state.approval?.resolve === 'function') state.approval.resolve(false);
        state.approval = null;
        state.agentAbort?.abort();
        state.status = 'annulation de l’agent…';
        return;
      }
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

  refreshAccount();
  const animation = setInterval(() => {
    if (state.closed || !state.ready) return;
    state.tick = (state.tick + 1) % 10;
    // Animation active pendant le streaming/l'agent, pulse discret au repos.
    if (state.animations && (state.streaming || state.agentRunning || state.approval || state.tick === 0)) scheduleRender();
  }, 140);

  const start = () => {
    if (state.closed) return;
    state.ready = true;
    draw();
  };
  if (state.animations) playSplash({ color, version: state.version }).catch(() => {}).finally(start);
  else start();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (state.closed) {
        clearInterval(timer);
        clearInterval(animation);
        process.stdin.off('data', onKey);
        process.stdout.off('resize', onResize);
        resolve(0);
      }
    }, 80);
  });
}

export function renderScreen(state, { client, config, color = true, root = process.cwd() } = {}) {
  const cols = Math.max(60, Math.min(Number(process.stdout.columns) || 96, 220));
  const rows = Math.max(18, Number(process.stdout.rows) || 28);
  const layout = ['focus', 'studio', 'compact'].includes(state.layout) ? state.layout : 'focus';
  const c = (text, hex) => paint(text, hex, color);
  const b = (text) => bold(text, color);
  const d = (text) => dim(text, color);
  const pad = (text, width) => `${text}${' '.repeat(Math.max(0, width - visibleLength(text)))}`;
  const nf = new Intl.NumberFormat('fr-FR');
  const usd = (value) => `${nf.format(Math.round((Number(value) || 0) * 100) / 100)} $`;
  const active = Boolean(state.streaming || state.agentRunning || state.approval);
  const tick = Number(state.tick) || 0;
  const pulse = active ? SPINNER[tick % SPINNER.length] : PULSE[tick % PULSE.length];
  const account = state.account || null;
  const planName = account?.plan?.name || account?.client?.period || '—';
  const req = account?.quota?.requests || {};
  const credit = account?.quota?.usd || {};
  const model = state.model || 'modèle';
  const mode = state.mode === 'chat' ? 'conversation' : 'agent';
  const pct = (used, limit) => (!limit ? 0 : Math.max(0, Math.min(100, Math.round((Number(used || 0) / Number(limit)) * 100))));
  const bar = (used, limit, width = 10) => {
    if (!limit) return c('∞', COLORS.dim);
    const filled = Math.round((pct(used, limit) / 100) * width);
    const tone = pct(used, limit) >= 90 ? COLORS.danger : pct(used, limit) >= 75 ? COLORS.amber : COLORS.accent;
    return c('█'.repeat(filled), tone) + c('░'.repeat(Math.max(0, width - filled)), COLORS.border);
  };
  const expires = account?.client?.expiresAt ? new Date(account.client.expiresAt) : null;
  const daysLeft = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86_400_000)) : null;
  const expiresLabel = expires ? expires.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—';
  if (state.overlay === 'account') {
    return renderAccountOverlay(state, { color, cols, rows });
  }
  if (state.overlay === 'diff') {
    return renderDiffOverlay(state, { color, cols, rows });
  }

  const lines = [];
  const add = (value = '') => lines.push(value);
  const project = String(root).replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'projet';
  const head = layout === 'focus'
    ? `  ${c(MARK, COLORS.accent)} ${b('VALARIA')} ${c('CODE', COLORS.accent2)}   ${d('—')}   ${d(project)}   ${pulse} ${d(account ? 'en ligne' : 'hors ligne')}`
    : `  ${c(MARK, COLORS.accent)}  ${b('VALARIA')} ${c('CODE', COLORS.accent2)}   ${pulse} ${account ? 'en ligne' : 'hors ligne'}   ${d(LAYOUT_LABELS[layout])}   ${c(model, COLORS.amber)}   ${d(`v${state.version || '0.7.0'}`)}`;
  add(head);
  add(`  ${d('─'.repeat(Math.max(0, cols - 4)))}`);

  const sidebar = layout === 'studio' && cols >= 88 ? 24 : 0;
  const mainWidth = cols - (sidebar ? sidebar + 4 : 4);
  let bodyHeight = rows - (layout === 'compact' ? 7 : 6);
  if (layout === 'compact') {
    add(`  ${d(`${planName} · ${nf.format(req.used || 0)}/${req.limit ? nf.format(req.limit) : '∞'} req · ${usd(credit.used)}${credit.limit ? `/${usd(credit.limit)}` : ''} · ${daysLeft == null ? '—' : `${daysLeft} j`} · ${truncate(model, 25)}`)}`);
  }

  const left = [];
  if (sidebar) {
    left.push(c('COMPTE', COLORS.muted));
    left.push(` ${b(truncate(account?.client?.name || 'compte', sidebar - 2))}`);
    left.push(` ${d(truncate(`pass ${planName}`, sidebar - 2))}`);
    left.push('');
    left.push(c('REQUÊTES', COLORS.muted));
    left.push(` ${bar(req.used, req.limit, 12)}`);
    left.push(` ${d(`${nf.format(req.used || 0)} / ${req.limit ? nf.format(req.limit) : '∞'}`)}`);
    left.push('');
    left.push(c('CRÉDIT', COLORS.muted));
    left.push(` ${bar(credit.used, credit.limit, 12)}`);
    left.push(` ${d(`${usd(credit.used)} / ${credit.limit ? usd(credit.limit) : '∞'}`)}`);
    left.push('');
    left.push(c('PASS', COLORS.muted));
    left.push(` ${daysLeft == null ? '—' : `${daysLeft} j`} ${d(`· ${expiresLabel}`)}`);
    left.push('');
    left.push(c('MODÈLE', COLORS.muted));
    left.push(` ${c(truncate(model, sidebar - 2), COLORS.amber)}`);
    left.push(c('MODE', COLORS.muted));
    left.push(` ${d(mode)}`);
  }

  const conversation = [];
  const hasConversation = state.messages.some((message) => ['user', 'assistant', 'tool'].includes(message.role));
  if (!hasConversation) {
    const center = (text) => `${' '.repeat(Math.max(0, Math.floor((mainWidth - visibleLength(text)) / 2)))}${text}`;
    conversation.push('');
    conversation.push(center(`${c(MARK, COLORS.accent)}  ${b('VALARIA')} ${c('CODE', COLORS.accent2)}`));
    conversation.push(center(d(TAGLINE)));
    conversation.push('');
    conversation.push(center(d('Décrivez une tâche, ou tapez / pour les commandes.')));
    conversation.push('');
    conversation.push(center(`${c('/plan', COLORS.accent)} planifier   ${c('/review', COLORS.accent)} relire   ${c('/account', COLORS.accent)} compte   ${c('?', COLORS.accent)} aide`));
    conversation.push('');
  }
  for (const message of state.messages) {
    if (message.role === 'tool') {
      conversation.push(`${c('›', COLORS.accent)} ${message.content || ''}`);
      conversation.push('');
      continue;
    }
    const prefix = message.role === 'user' ? c('❯', COLORS.accent) : message.role === 'assistant' ? c('▌', COLORS.accent2) : c('·', COLORS.dim);
    const label = message.role === 'user' ? c('vous', COLORS.muted) : message.role === 'assistant' ? b('VALARIA') : d('système');
    conversation.push(`${prefix} ${label}`);
    for (const line of wrap(message.content || '', Math.max(20, mainWidth - 2))) conversation.push(`  ${line}`);
    conversation.push('');
  }
  const approvalLines = [];
  if (state.approval) {
    const approval = state.approval;
    approvalLines.push('');
    approvalLines.push(`${c('⚠ APPROBATION REQUISE', COLORS.amber)}  ${d('y autoriser · n refuser')}`);
    if (approval.type === 'write') {
      approvalLines.push(`  ${b(truncate(approval.file || 'fichier', mainWidth - 2))}`);
      const diff = String(approval.diff || '').split('\n').slice(0, 8);
      for (const line of diff) {
        const hex = line.startsWith('+') ? COLORS.accent : line.startsWith('-') ? COLORS.danger : COLORS.dim;
        approvalLines.push(c(`  ${truncate(line, mainWidth - 2)}`, hex));
      }
    } else {
      approvalLines.push(`  ${c('$', COLORS.amber)} ${truncate(approval.command || '', mainWidth - 4)}`);
      approvalLines.push(`  ${d('commande proposée par l’agent')}`);
    }
  }
  let main = conversation.slice(-Math.max(2, bodyHeight - approvalLines.length)).concat(approvalLines);
  if (!hasConversation) {
    const offset = Math.max(0, Math.floor((bodyHeight - main.length) / 2));
    main = Array(offset).fill('').concat(main);
  }
  while (main.length < bodyHeight) main.push('');
  for (let index = 0; index < bodyHeight; index += 1) {
    const mainLine = truncate(main[index] || '', mainWidth);
    if (sidebar) add(`  ${pad(truncate(left[index] || '', sidebar), sidebar)} ${d('│')} ${mainLine}`);
    else add(`  ${mainLine}`);
  }

  add(`  ${d('─'.repeat(Math.max(0, cols - 4)))}`);
  const placeholder = !state.input && !state.approval ? d('Entrez une tâche ou / pour les commandes') : '';
  add(`  ${state.approval ? `${c('y', COLORS.accent)} / ${c('n', COLORS.danger)}` : `${c('>', COLORS.accent)} ${truncate(state.input || placeholder, cols - 6)}${active ? c('▌', COLORS.accent) : ''}`}`);
  if (layout === 'focus') {
    const usage = `${nf.format(req.used || 0)}/${req.limit ? nf.format(req.limit) : '∞'}`;
    add(`  ${d(`${truncate(model, 24)} · ${mode} · ${truncate(planName, 14)} · ${usage} req · /model · /account · ? aide`)}`);
  } else {
    add(`  ${d(truncate(state.status || 'prêt', Math.max(12, cols - 42)))} ${d(`· ${mode} · Ctrl+O compte · Ctrl+P interface · /help`)}`);
  }
  process.stdout.write(`\x1b[H\x1b[2J${lines.join('\n')}\x1b[?25l`);

  function renderAccountOverlay(stateValue, { color: overlayColor, cols: overlayCols, rows: overlayRows }) {
    const oc = (text, hex) => paint(text, hex, overlayColor);
    const ob = (text) => bold(text, overlayColor);
    const od = (text) => dim(text, overlayColor);
    const onf = new Intl.NumberFormat('fr-FR');
    const ousd = (value) => `${onf.format(Math.round((Number(value) || 0) * 100) / 100)} $`;
    const oAccount = stateValue.account || null;
    const oQuota = oAccount?.quota || {};
    const oReq = oQuota.requests || {};
    const oCredit = oQuota.usd || {};
    const oPlan = oAccount?.plan?.name || oAccount?.client?.period || '—';
    const oExpiry = oAccount?.client?.expiresAt ? new Date(oAccount.client.expiresAt) : null;
    const oDays = oExpiry ? Math.max(0, Math.ceil((oExpiry.getTime() - Date.now()) / 86_400_000)) : null;
    const width = Math.min(72, overlayCols - 8);
    const oBar = (used, limit) => {
      if (!limit) return oc('∞', COLORS.dim);
      const filled = Math.round((Math.max(0, Math.min(100, Math.round((Number(used || 0) / Number(limit)) * 100))) / 100) * 28);
      return oc('█'.repeat(filled), COLORS.accent) + oc('░'.repeat(Math.max(0, 28 - filled)), COLORS.border);
    };
    const out = [];
    out.push('');
    out.push(`  ${oc('V', COLORS.accent)}  ${ob('VALARIA')} ${oc('CODE', COLORS.accent2)}   ${od('votre compte')}`);
    out.push(`  ${od('─'.repeat(width))}`);
    out.push('');
    if (!oAccount) {
      out.push(`  ${od('Compte en cours de chargement…')}`);
    } else {
      out.push(`  ${ob(oAccount.client?.name || 'Compte')}  ${od(oAccount.client?.email || '')}`);
      out.push(`  ${od('PASS')} ${oc(oPlan, COLORS.amber)}   ${od('fin')} ${oDays == null ? '—' : `${oDays} j · ${oExpiry.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`}`);
      out.push('');
      out.push(`  ${od('REQUÊTES')}`);
      out.push(`  ${oBar(oReq.used, oReq.limit)}  ${onf.format(oReq.used || 0)} / ${oReq.limit ? onf.format(oReq.limit) : '∞'}`);
      out.push('');
      out.push(`  ${od('CRÉDIT')}`);
      out.push(`  ${oBar(oCredit.used, oCredit.limit)}  ${ousd(oCredit.used)} / ${oCredit.limit ? ousd(oCredit.limit) : '∞'}`);
      out.push('');
      out.push(`  ${od('MODÈLE')} ${oc(stateValue.model || '—', COLORS.amber)}   ${od('MODE')} ${stateValue.mode === 'chat' ? 'conversation' : 'agent'}   ${od('INTERFACE')} ${LAYOUT_LABELS[stateValue.layout] || 'Focus'}`);
    }
    out.push('');
    out.push(`  ${od('Entrée / Échap fermer')}`);
    process.stdout.write(`\x1b[H\x1b[2J${out.join('\n')}\x1b[?25l`);
  }
}
function renderDiffOverlay(state, { color = true, cols = 96, rows = 28 } = {}) {
  const c = (text, hex) => paint(text, hex, color);
  const b = (text) => bold(text, color);
  const d = (text) => dim(text, color);
  const pad = (text, width) => `${text}${' '.repeat(Math.max(0, width - visibleLength(text)))}`;
  const review = state.diffReview || { files: [] };
  const files = review.files || [];
  const selectedIndex = Math.max(0, Math.min(files.length - 1, Number(review.selected) || 0));
  const selected = files[selectedIndex] || null;
  const stats = summarize(files);
  const wide = Boolean(review.wide);
  const header = `  ${c('◈', COLORS.accent)} ${b('VALARIA')} ${c('CODE', COLORS.accent2)}   ${d('revue du diff')}   ${d(`${stats.files} fichier(s)`)}   ${c(`+${stats.additions}`, COLORS.accent)} ${c(`−${stats.deletions}`, COLORS.danger)}`;
  const footer = state.approval
    ? `  ↑↓ fichier   PgUp/PgDn lignes   d ${wide ? 'réduire' : 'agrandir'} le diff   y autoriser   n refuser   Échap annuler`
    : `  ↑↓ fichier   PgUp/PgDn lignes   d ${wide ? 'réduire' : 'agrandir'} le diff   Échap fermer`;
  const bodyHeight = Math.max(6, rows - 4);
  const showAccount = state.layout === 'studio' && cols >= 136;
  const accountWidth = 22;
  const conversationWidth = Math.max(28, Math.min(wide ? 48 : 72, Math.floor(cols * (wide ? 0.30 : 0.43))));
  const filesWidth = Math.max(22, Math.min(28, Math.floor(cols * 0.16)));
  const separators = showAccount ? 12 : 9;
  const diffWidth = Math.max(24, cols - 2 - conversationWidth - filesWidth - separators - (showAccount ? accountWidth : 0));

  const accountLines = [];
  if (showAccount) {
    const account = state.account || null;
    const q = account?.quota || {};
    const req = q.requests || {};
    const credit = q.usd || {};
    const nf = new Intl.NumberFormat('fr-FR');
    const usd = (value) => `${nf.format(Math.round((Number(value) || 0) * 100) / 100)} $`;
    const days = account?.client?.expiresAt ? Math.max(0, Math.ceil((new Date(account.client.expiresAt).getTime() - Date.now()) / 86_400_000)) : null;
    const bar = (used, limit, width = 12) => {
      if (!limit) return c('∞', COLORS.dim);
      const percent = Math.max(0, Math.min(100, Math.round((Number(used || 0) / Number(limit)) * 100)));
      const filled = Math.round((percent / 100) * width);
      const tone = percent >= 90 ? COLORS.danger : percent >= 75 ? COLORS.amber : COLORS.accent;
      return c('█'.repeat(filled), tone) + c('░'.repeat(Math.max(0, width - filled)), COLORS.border);
    };
    accountLines.push(c('COMPTE', COLORS.muted));
    accountLines.push(` ${b(truncate(account?.client?.name || 'compte', accountWidth - 2))}`);
    accountLines.push(` ${d(truncate(`pass ${account?.plan?.name || '—'}`, accountWidth - 2))}`);
    accountLines.push('');
    accountLines.push(c('REQUÊTES', COLORS.muted));
    accountLines.push(` ${bar(req.used, req.limit, 12)}`);
    accountLines.push(` ${d(`${nf.format(req.used || 0)} / ${req.limit ? nf.format(req.limit) : '∞'}`)}`);
    accountLines.push('');
    accountLines.push(c('CRÉDIT', COLORS.muted));
    accountLines.push(` ${bar(credit.used, credit.limit, 12)}`);
    accountLines.push(` ${d(`${usd(credit.used)} / ${credit.limit ? usd(credit.limit) : '∞'}`)}`);
    accountLines.push('');
    accountLines.push(c('PASS', COLORS.muted));
    accountLines.push(` ${days == null ? '—' : `${days} j`}`);
    accountLines.push('');
    accountLines.push(c('MODÈLE', COLORS.muted));
    accountLines.push(` ${c(truncate(state.model || '—', accountWidth - 2), COLORS.amber)}`);
    accountLines.push(c('MODE', COLORS.muted));
    accountLines.push(` ${state.mode === 'chat' ? 'conversation' : 'agent'}`);
  }

  const conversationLines = [c('CONVERSATION', COLORS.muted)];
  const recent = [];
  for (const message of state.messages) {
    if (message.role === 'tool') {
      recent.push(`${c('›', COLORS.accent)} ${truncate(message.content || '', conversationWidth - 2)}`);
      continue;
    }
    const label = message.role === 'user' ? c('❯ vous', COLORS.accent) : message.role === 'assistant' ? b('▌ VALARIA') : d('· système');
    recent.push(label);
    for (const line of wrap(message.content || '', Math.max(16, conversationWidth - 2))) recent.push(`  ${line}`);
  }
  if (!recent.length) recent.push(d('  Aucun message — décrivez une tâche.'), '', d('  Les messages restent visibles'), d('  pendant la revue du diff.'));
  conversationLines.push(...recent.slice(-(bodyHeight - 2)));

  const fileLines = [];
  fileLines.push(c(`FICHIERS (${files.length})`, COLORS.muted));
  fileLines.push(d('répertoire'));
  const fileRows = Math.max(2, bodyHeight - 3);
  const start = Math.max(0, Math.min(Math.max(0, files.length - fileRows), selectedIndex - Math.floor(fileRows / 2)));
  for (let index = start; index < Math.min(files.length, start + fileRows); index += 1) {
    const file = files[index];
    const selectedFile = index === selectedIndex;
    const marker = selectedFile ? c('›', COLORS.accent) : ' ';
    const tone = file.status === 'A' ? COLORS.accent : file.status === 'D' ? COLORS.danger : COLORS.amber;
    const label = `${marker} ${c(file.status, tone)} ${truncate(file.path, filesWidth - 5)}`;
    fileLines.push(selectedFile ? b(label) : label);
    fileLines.push(`   ${c(`+${file.additions || 0}`, COLORS.accent)} ${c(`−${file.deletions || 0}`, COLORS.danger)}`);
  }

  const diffLines = [];
  diffLines.push(selected ? `${b(truncate(selected.path, diffWidth - 2))}  ${c(selected.status, selected.status === 'D' ? COLORS.danger : COLORS.amber)} ${c(`+${selected.additions || 0}`, COLORS.accent)} ${c(`−${selected.deletions || 0}`, COLORS.danger)}` : d('Aucun fichier'));
  diffLines.push(d('─'.repeat(diffWidth)));
  if (selected) {
    let oldLine = 0;
    let newLine = 0;
    const parsed = [];
    for (const line of String(selected.diff || '').split(/\r?\n/)) {
      if (line.startsWith('@@')) {
        const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        oldLine = match ? Number(match[1]) : 1;
        newLine = match ? Number(match[2]) : 1;
        parsed.push({ kind: 'hunk', text: line, number: '' });
      } else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('Binary files ')) {
        continue;
      } else if (line.startsWith('+')) {
        parsed.push({ kind: 'add', number: String(newLine).padStart(4, ' '), text: line.slice(1) });
        newLine += 1;
      } else if (line.startsWith('-')) {
        parsed.push({ kind: 'del', number: String(oldLine).padStart(4, ' '), text: line.slice(1) });
        oldLine += 1;
      } else if (line.startsWith(' ')) {
        parsed.push({ kind: 'ctx', number: String(newLine).padStart(4, ' '), text: line.slice(1) });
        oldLine += 1;
        newLine += 1;
      } else if (line) {
        parsed.push({ kind: 'meta', number: '', text: line });
      }
    }
    if (!parsed.length) diffLines.push(d('  (fichier binaire ou vide — pas d’aperçu texte)'));
    const maxLines = Math.max(1, bodyHeight - 4);
    const offset = Math.max(0, Math.min((parsed.length - maxLines), Number(review.scroll) || 0));
    if (offset > 0) diffLines.push(d('  …'));
    for (const line of parsed.slice(offset, offset + maxLines - (offset > 0 ? 1 : 0))) {
      const text = truncate(line.text, diffWidth - 7);
      if (line.kind === 'add') diffLines.push(`${d(line.number)} ${c('+', COLORS.accent)} ${c(text, COLORS.accent)}`);
      else if (line.kind === 'del') diffLines.push(`${d(line.number)} ${c('−', COLORS.danger)} ${c(text, COLORS.danger)}`);
      else if (line.kind === 'hunk') diffLines.push(`${d(line.number)} ${c(text, COLORS.amber)}`);
      else diffLines.push(`${d(line.number)}   ${d(text)}`);
    }
  }

  const lines = [];
  lines.push(header);
  lines.push(d('─'.repeat(Math.max(0, cols - 4))));
  for (let index = 0; index < bodyHeight; index += 1) {
    const parts = [];
    if (showAccount) parts.push(pad(truncate(accountLines[index] || '', accountWidth), accountWidth));
    parts.push(pad(truncate(conversationLines[index] || '', conversationWidth), conversationWidth));
    parts.push(pad(truncate(fileLines[index] || '', filesWidth), filesWidth));
    parts.push(truncate(diffLines[index] || '', diffWidth));
    lines.push(`  ${parts.join(` ${d('│')} `)}`);
  }
  lines.push(d('─'.repeat(Math.max(0, cols - 4))));
  lines.push(footer);
  process.stdout.write(`\x1b[H\x1b[2J${lines.join('\n')}\x1b[?25l`);
}
export async function runPlainChat({ client, messages, model, onDelta }) {
  return client.stream(messages, { model, onDelta });
}

export const runTui = createTui;





