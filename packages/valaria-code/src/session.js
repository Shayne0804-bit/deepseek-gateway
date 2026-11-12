/**
 * Persistent VALARIA Code session memory.
 *
 * A session belongs to the current project directory. It is stored under
 * `~/.valaria/sessions/<hash>.json`, mode 0600, and restored automatically on
 * the next launch. Only user/assistant turns are persisted — tool internals stay
 * out of the saved transcript.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './config.js';

export const SESSION_VERSION = 1;
export const MAX_SESSION_MESSAGES = 200;
export const MAX_CONTEXT_MESSAGES = 30;

function normalizeCwd(cwd) {
  return path.resolve(String(cwd || process.cwd()));
}

export function sessionsDir({ home = homeDir() } = {}) {
  return path.join(home, 'sessions');
}

export function sessionFile({ cwd = process.cwd(), home = homeDir() } = {}) {
  const normalized = normalizeCwd(cwd);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  return path.join(sessionsDir({ home }), `${hash}.json`);
}

export function createSession({ cwd = process.cwd(), model = null } = {}) {
  const now = new Date().toISOString();
  return {
    version: SESSION_VERSION,
    id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
    cwd: normalizeCwd(cwd),
    model: model || null,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const item of messages) {
    if (!item || (item.role !== 'user' && item.role !== 'assistant')) continue;
    const content = String(item.content ?? '').trim();
    if (!content) continue;
    out.push({
      role: item.role,
      content: content.slice(0, 60_000),
      at: Number(item.at) || Date.now(),
    });
  }
  return out.slice(-MAX_SESSION_MESSAGES);
}

export function loadSession({ cwd = process.cwd(), home = homeDir() } = {}) {
  const normalized = normalizeCwd(cwd);
  const file = sessionFile({ cwd: normalized, home });
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || data.version !== SESSION_VERSION || normalizeCwd(data.cwd) !== normalized) {
      return createSession({ cwd: normalized });
    }
    return {
      ...createSession({ cwd: normalized }),
      ...data,
      cwd: normalized,
      messages: cleanMessages(data.messages),
    };
  } catch {
    return createSession({ cwd: normalized });
  }
}

export function saveSession(session) {
  if (!session || typeof session !== 'object') throw new Error('Session invalide.');
  const cwd = normalizeCwd(session.cwd || process.cwd());
  const payload = {
    version: SESSION_VERSION,
    id: String(session.id || ''),
    cwd,
    model: session.model || null,
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: cleanMessages(session.messages),
  };
  const dir = sessionsDir({ home: session.home || homeDir() });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = sessionFile({ cwd, home: session.home || homeDir() });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(temporary, 0o600); } catch { /* Windows */ }
  fs.renameSync(temporary, file);
  session.updatedAt = payload.updatedAt;
  return file;
}

export function appendSessionTurn(session, { user, assistant, model = null } = {}) {
  if (!session) return session;
  if (user) session.messages.push({ role: 'user', content: String(user), at: Date.now() });
  if (assistant) session.messages.push({ role: 'assistant', content: String(assistant), at: Date.now() });
  if (model) session.model = model;
  session.messages = cleanMessages(session.messages);
  return session;
}

export function clearSession({ cwd = process.cwd(), home = homeDir() } = {}) {
  try {
    fs.unlinkSync(sessionFile({ cwd, home }));
  } catch {
    /* absent */
  }
}

export function sessionApiMessages(session, { limit = MAX_CONTEXT_MESSAGES } = {}) {
  const messages = cleanMessages(session?.messages).slice(-limit);
  return messages.map(({ role, content }) => ({ role, content }));
}

export function sessionSummary(session) {
  const messages = cleanMessages(session?.messages);
  return {
    id: session?.id || null,
    createdAt: session?.createdAt || null,
    updatedAt: session?.updatedAt || null,
    messageCount: messages.length,
    lastMessageAt: messages.length ? messages[messages.length - 1].at : null,
  };
}
