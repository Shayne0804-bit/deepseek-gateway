/**
 * Outils locaux de VALARIA Code. Toute écriture ou commande passe par une
 * approbation dans la TUI ; ces primitives ne sont jamais exposées au réseau.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', 'data']);
const MAX_READ = 120_000;
const MAX_OUTPUT = 30_000;

export class WorkspaceError extends Error {}

export function workspaceRoot(cwd = process.cwd()) {
  return path.resolve(cwd);
}

export function resolveInside(root, target) {
  const resolved = path.resolve(root, String(target || ''));
  const relative = path.relative(root, resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return resolved;
  throw new WorkspaceError('Chemin hors du projet refusé.');
}

export function listFiles(root, relative = '.', limit = 160) {
  const start = resolveInside(root, relative);
  const out = [];
  const walk = (dir) => {
    if (out.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  const stat = fs.statSync(start, { throwIfNoEntry: false });
  if (!stat) throw new WorkspaceError(`Chemin introuvable : ${relative}`);
  if (stat.isFile()) return [path.relative(root, start).split(path.sep).join('/')];
  walk(start);
  return out;
}

export function readFile(root, relative) {
  const file = resolveInside(root, relative);
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new WorkspaceError(`Fichier introuvable : ${relative}`);
  if (stat.size > MAX_READ) throw new WorkspaceError(`Fichier trop volumineux (${stat.size} octets).`);
  return fs.readFileSync(file, 'utf8');
}

export function writeFile(root, relative, content) {
  const file = resolveInside(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(content), 'utf8');
  return file;
}

function splitLines(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').split('\n');
}

/** Diff ligne à ligne simple, suffisant pour une approbation lisible. */
export function lineDiff(before, after) {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const max = Math.max(oldLines.length, newLines.length);
  const rows = [];
  for (let index = 0; index < max; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine) {
      rows.push({ type: 'same', line: oldLine ?? '' });
      continue;
    }
    if (oldLine !== undefined) rows.push({ type: 'remove', line: oldLine });
    if (newLine !== undefined) rows.push({ type: 'add', line: newLine });
  }
  return rows;
}

export function diffText(before, after, maxLines = 120) {
  const rows = lineDiff(before, after);
  const shown = rows.slice(0, maxLines);
  const text = shown.map((row) => {
    if (row.type === 'add') return `+ ${row.line}`;
    if (row.type === 'remove') return `- ${row.line}`;
    return `  ${row.line}`;
  }).join('\n');
  return `${text}${rows.length > maxLines ? `\n… ${rows.length - maxLines} ligne(s) supplémentaire(s)` : ''}`;
}

export function extractCode(text) {
  const fenced = /```(?:[\w.-]+)?\n([\s\S]*?)```/m.exec(String(text));
  return fenced ? fenced[1].replace(/\n$/, '') : String(text).trim();
}

export function runCommand(command, { cwd = process.cwd(), timeoutMs = 120_000, maxOutput = MAX_OUTPUT } = {}) {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/sh';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
    const child = spawn(shell, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timer;
    const append = (chunk, target) => {
      const text = chunk.toString();
      if (target === 'stdout') stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > maxOutput) truncated = true;
    };
    child.stdout.on('data', (chunk) => append(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => append(chunk, 'stderr'));
    if (timeoutMs) {
      timer = setTimeout(() => {
        truncated = true;
        child.kill('SIGTERM');
      }, timeoutMs);
    }
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: error.message, truncated });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        code: code == null ? -1 : code,
        stdout: stdout.slice(0, maxOutput),
        stderr: stderr.slice(0, maxOutput),
        truncated: truncated || stdout.length > maxOutput || stderr.length > maxOutput,
      });
    });
  });
}
