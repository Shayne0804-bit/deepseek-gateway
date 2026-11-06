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

const MAX_STEPS = 8;

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
      description: 'Lit le contenu texte d’un fichier du projet.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Chemin relatif du fichier' } },
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
];

function truncate(value, max = 30_000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}\n…[tronqué]` : text;
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
    return `Fichier ${args.path} :\n\`\`\`\n${content.slice(0, 60_000)}\n\`\`\``;
  }
  if (name === 'search_files') {
    const results = searchFiles(root, args.query, { limit: 40 });
    return results.length
      ? results.map((row) => `${row.file}:${row.line}\n${row.excerpt}`).join('\n\n')
      : `Aucun résultat pour « ${args.query} ».`;
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
  maxSteps = MAX_STEPS,
  approve = async () => false,
  onEvent = () => {},
  signal = null,
} = {}) {
  if (!task || !String(task).trim()) throw new Error('Tâche vide.');
  const messages = [
    {
      role: 'system',
      content: `Tu es VALARIA Code, un agent de code autonome dans le terminal.
Tu travailles dans le projet courant : ${root}.
Utilise les outils pour inspecter, modifier et tester le code. Lis toujours un fichier avant de l'écrire.
Les écritures et commandes seront soumises à l'utilisateur ; si une action est refusée, propose une alternative.
N'invente jamais le résultat d'un outil. Quand la tâche est terminée, réponds avec un résumé court des changements et des tests.
Tu ne produis que du texte et du code ; aucune image, aucun audio, aucune vidéo.`,
    },
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
