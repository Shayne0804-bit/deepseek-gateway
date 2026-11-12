/**
 * Boucle agentique VALARIA Code : lecture → proposition → approbation → action.
 * Le modèle choisit des outils ; les écritures et commandes sont bloquées
 * jusqu'à l'approbation explicite de l'utilisateur.
 */
import {
  diffText,
  listFiles,
  readFile,
  resolveInside,
  runCommand,
  searchFiles,
  writeFile,
} from './tools.js';

const MAX_STEPS = 12;

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'Liste les fichiers du projet. Utiliser avant de lire ou modifier.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Dossier relatif, par défaut .' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Lit le contenu texte d’un fichier du projet. Pour un gros fichier, préciser start et end (1-indexé).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier' },
          start: { type: 'integer', description: 'Première ligne (optionnel)' },
          end: { type: 'integer', description: 'Dernière ligne (optionnel)' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Recherche une chaîne dans les fichiers du projet.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Texte recherché' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description: 'Remplace un extrait unique dans un fichier. Plus sûr et plus rapide qu’une réécriture complète. Nécessite une approbation.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier' },
          old_text: { type: 'string', description: 'Texte exact à remplacer (doit apparaître une seule fois)' },
          new_text: { type: 'string', description: 'Nouveau texte' },
        },
        required: ['path', 'old_text', 'new_text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Écrit le contenu complet d’un fichier. Nécessite l’approbation de l’utilisateur.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier' },
          content: { type: 'string', description: 'Contenu complet du fichier' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Exécute une commande shell (test, lint, build). Nécessite l’approbation.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Commande à exécuter' } },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Affiche l’état Git du projet (lecture seule, sans approbation).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Affiche le diff Git courant (lecture seule, sans approbation).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

function truncate(value, max = 30_000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}\n…[tronqué]` : text;
}

function projectInstructions(root) {
  const candidates = ['AGENTS.md', 'VALARIA.md', 'CLAUDE.md', '.valaria/instructions.md'];
  const parts = [];
  for (const relative of candidates) {
    try {
      const content = readFile(root, relative).trim();
      if (content) parts.push(`# ${relative}\n${content.slice(0, 8_000)}`);
    } catch {
      /* fichier optionnel */
    }
  }
  return parts.length ? `\n\nInstructions du projet :\n${parts.join('\n\n')}` : '';
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function executeTool({ client, root, name, args, approve, signal }) {
  if (approve?.signal?.aborted) throw new Error('Agent annulé.');
  if (name === 'list_files') {
    const files = listFiles(root, args.path || '.', 180);
    return `Fichiers (${files.length}) :\n${files.join('\n')}`;
  }
  if (name === 'read_file') {
    const content = readFile(root, args.path);
    const lines = content.split(/\r?\n/);
    const start = Number.isInteger(args.start) && args.start > 0 ? args.start : null;
    const end = Number.isInteger(args.end) && args.end > 0 ? args.end : null;
    const selected = start || end
      ? lines.slice((start || 1) - 1, end || lines.length).join('\n')
      : content;
    return `Fichier ${args.path}${start || end ? ` (lignes ${start || 1}-${end || lines.length})` : ''} :\n\`\`\`\n${selected.slice(0, 60_000)}\n\`\`\``;
  }
  if (name === 'search_files') {
    const results = searchFiles(root, args.query, { limit: 40 });
    return results.length
      ? results.map((row) => `${row.file}:${row.line}\n${row.excerpt}`).join('\n\n')
      : `Aucun résultat pour « ${args.query} ».`;
  }
  if (name === 'replace_in_file') {
    const before = readFile(root, args.path);
    const oldText = String(args.old_text ?? '');
    if (!oldText) throw new Error('old_text est vide.');
    const first = before.indexOf(oldText);
    if (first === -1) throw new Error(`Extrait introuvable dans ${args.path}.`);
    if (before.indexOf(oldText, first + oldText.length) !== -1) {
      throw new Error(`Extrait ambigu dans ${args.path} : il apparaît plusieurs fois. Précise davantage old_text.`);
    }
    const content = `${before.slice(0, first)}${String(args.new_text ?? '')}${before.slice(first + oldText.length)}`;
    const diff = diffText(before, content);
    const approved = await approve({ type: 'write', file: args.path, before, content, diff });
    if (!approved) return `Écriture de ${args.path} refusée par l'utilisateur.`;
    writeFile(root, args.path, content);
    return `Extrait remplacé dans ${args.path}.`;
  }
  if (name === 'write_file') {
    const before = (() => { try { return readFile(root, args.path); } catch { return ''; } })();
    const content = String(args.content ?? '');
    if (content.length > 250_000) throw new Error('Fichier trop volumineux pour cet agent.');
    const diff = diffText(before, content);
    const approved = await approve({ type: 'write', file: args.path, before, content, diff });
    if (!approved) return `Écriture de ${args.path} refusée par l'utilisateur.`;
    const file = writeFile(root, args.path, content);
    return `Fichier écrit : ${file}`;
  }
  if (name === 'run_command') {
    const command = String(args.command || '').trim();
    if (!command) throw new Error('Commande vide.');
    const approved = await approve({ type: 'run', command });
    if (!approved) return `Commande refusée : ${command}`;
    const result = await runCommand(command, { cwd: root });
    return truncate(`$ ${command}\ncode ${result.code}\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`, 30_000);
  }
  if (name === 'git_status') {
    const result = await runCommand('git status --short --branch', { cwd: root });
    return truncate(`$ git status\ncode ${result.code}\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`, 30_000);
  }
  if (name === 'git_diff') {
    const result = await runCommand('git diff --stat && git diff', { cwd: root });
    return truncate(`$ git diff\ncode ${result.code}\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`, 30_000);
  }
  throw new Error(`Outil inconnu : ${name}`);
}

/**
 * Lance l'agent jusqu'à une réponse finale.
 * onEvent({ type:'assistant'|'tool'|'result'|'error', ... })
 * approve(approval) doit résoudre true/false.
 */
export async function runAgent({
  client,
  root = process.cwd(),
  task,
  model,
  history = [],
  maxSteps = MAX_STEPS,
  approve = async () => false,
  onEvent = () => {},
  signal = null,
} = {}) {
  if (!task || !String(task).trim()) throw new Error('Tâche vide.');
  const prior = Array.isArray(history)
    ? history
      .filter((message) => message && ['user', 'assistant'].includes(message.role) && String(message.content || '').trim())
      .slice(-30)
      .map((message) => ({ role: message.role, content: String(message.content) }))
    : [];
  const messages = [
    {
      role: 'system',
      content: `Tu es VALARIA Code, un agent de code autonome dans le terminal.
Tu travailles dans le projet courant : ${root}.
Tu disposes de la mémoire de la conversation précédente : tiens compte du contexte, des préférences et des décisions déjà prises.
Utilise les outils pour inspecter, modifier et tester le code. Lis toujours un fichier avant de l'écrire.
Préfère replace_in_file pour une modification ciblée ; utilise write_file seulement pour un nouveau fichier ou une réécriture complète.
Les écritures et commandes seront soumises à l'utilisateur ; si une action est refusée, propose une alternative.
N'invente jamais le résultat d'un outil. Quand la tâche est terminée, réponds avec un résumé court des changements et des tests.
Tu ne produis que du texte et du code ; aucune image, aucun audio, aucune vidéo.${projectInstructions(root)}`,
    },
    ...prior,
    { role: 'user', content: String(task) },
  ];
  const events = [];
  let steps = 0;
  while (steps < maxSteps) {
    if (signal?.aborted) throw new Error('Agent annulé.');
    steps += 1;
    const response = await client.complete(messages, {
      model,
      tools: TOOL_DEFINITIONS,
      toolChoice: 'auto',
      maxTokens: 8192,
      signal,
    });
    if (response.content) {
      events.push({ type: 'assistant', content: response.content });
      onEvent({ type: 'assistant', content: response.content });
    }
    const calls = response.tool_calls || [];
    if (!calls.length) {
      return { summary: response.content || 'Tâche terminée.', steps, events };
    }
    messages.push({ role: 'assistant', content: response.content || null, tool_calls: calls });
    for (const call of calls) {
      const name = call?.function?.name || 'inconnu';
      const args = parseArgs(call?.function?.arguments);
      onEvent({ type: 'tool', name, args });
      let output;
      try {
        output = await executeTool({ client, root, name, args, approve, signal });
        if (/refusée|refusé/.test(output)) onEvent({ type: 'approval-denied', name });
        else onEvent({ type: 'tool-result', name, output });
      } catch (error) {
        output = `ERREUR : ${error.message}`;
        onEvent({ type: 'error', name, message: error.message });
      }
      messages.push({ role: 'tool', tool_call_id: call.id || `tool_${steps}`, content: truncate(output) });
    }
  }
  return { summary: `Limite de ${maxSteps} étapes atteinte.`, steps, events };
}

export { TOOL_DEFINITIONS };
