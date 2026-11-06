/**
 * Revue de diff : fichiers modifiés à gauche, lignes ajoutées/supprimées à droite.
 * Utilise git en lecture seule, sans dépendance.
 */
import { readFile, runCommand } from './tools.js';

function countDiff(diff) {
  let additions = 0;
  let deletions = 0;
  for (const line of String(diff).split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

function statusLabel(code) {
  if (code === '??' || code === 'A') return 'A';
  if (code.includes('D')) return 'D';
  if (code === 'R') return 'R';
  return 'M';
}

function untrackedDiff(root, relative) {
  try {
    const content = readFile(root, relative);
    const lines = content.split(/\r?\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    return [
      `--- /dev/null`,
      `+++ b/${relative}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join('\n');
  } catch {
    return `--- /dev/null\n+++ b/${relative}\n@@ -0,0 +1,1 @@\n+(binaire ou illisible)`;
  }
}

function extraDiff(relative, content, status = 'M') {
  const lines = String(content ?? '').split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (status === 'A') {
    return [`--- /dev/null`, `+++ b/${relative}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n');
  }
  return [`--- a/${relative}`, `+++ b/${relative}`, `@@ -1,${lines.length} +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n');
}

/**
 * @returns {Promise<{ok:boolean, files:Array, error?:string, repo?:string}>}
 */
export async function collectWorkspaceDiff(root = process.cwd(), extra = null) {
  const repoResult = await runCommand('git rev-parse --show-toplevel', { cwd: root, timeoutMs: 8000 });
  const isRepo = repoResult.code === 0;
  const files = [];

  if (isRepo) {
    const status = await runCommand('git status --porcelain=v1', { cwd: root, timeoutMs: 8000 });
    let rawDiff = await runCommand('git diff HEAD --no-ext-diff --no-color', { cwd: root, timeoutMs: 8000 });
    if (rawDiff.code !== 0) rawDiff = await runCommand('git diff --no-ext-diff --no-color', { cwd: root, timeoutMs: 8000 });
    const sections = new Map();
    let current = null;
    for (const line of String(rawDiff.stdout || '').split(/\r?\n/)) {
      if (line.startsWith('diff --git ')) {
        if (current) sections.set(current.path, current.lines.join('\n'));
        current = { path: '', lines: [line] };
      } else if (current) {
        current.lines.push(line);
        if (!current.path && line.startsWith('+++ b/')) current.path = line.slice(6).trim();
        else if (!current.path && line.startsWith('--- a/')) current.path = line.slice(6).trim();
        else if (!current.path && line.startsWith('+++ ')) current.path = line.slice(4).trim().replace(/^b\//, '');
      }
    }
    if (current) sections.set(current.path, current.lines.join('\n'));

    for (const line of String(status.stdout || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const code = line.slice(0, 2).trim() || 'M';
      let relative = line.slice(3).trim();
      if (relative.includes(' -> ')) relative = relative.split(' -> ').pop();
      if (!relative) continue;
      if (relative.startsWith('"') && relative.endsWith('"')) relative = relative.slice(1, -1);
      const statusCode = statusLabel(code);
      const diff = (statusCode === 'A' || code === '??') ? untrackedDiff(root, relative) : (sections.get(relative) || '');
      const stats = countDiff(diff);
      files.push({ path: relative, status: statusCode, diff, ...stats });
    }
  }

  if (extra?.path) {
    const existing = files.find((file) => file.path === extra.path);
    const status = existing ? existing.status : (extra.status || 'M');
    const diff = extra.diff || extraDiff(extra.path, extra.content || '', status);
    const stats = countDiff(diff);
    if (existing) Object.assign(existing, { status, diff, ...stats });
    else files.push({ path: extra.path, status, diff, ...stats });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  if (!files.length) {
    return { ok: false, error: isRepo ? 'Aucun fichier modifié.' : 'Ce dossier n’est pas un dépôt Git.', files: [] };
  }
  return { ok: true, files, repo: isRepo ? String(repoResult.stdout || '').trim() : root };
}

export function summarize(files = []) {
  const additions = files.reduce((sum, file) => sum + (file.additions || 0), 0);
  const deletions = files.reduce((sum, file) => sum + (file.deletions || 0), 0);
  return { files: files.length, additions, deletions };
}

export { extraDiff };
