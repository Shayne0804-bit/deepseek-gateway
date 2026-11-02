import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  quota_tokens INTEGER,
  quota_requests INTEGER,
  quota_usd REAL,
  used_tokens INTEGER NOT NULL DEFAULT 0,
  used_requests INTEGER NOT NULL DEFAULT 0,
  used_usd REAL NOT NULL DEFAULT 0,
  period TEXT NOT NULL DEFAULT 'monthly',
  period_start TEXT NOT NULL,
  rpm_limit INTEGER,
  concurrency_limit INTEGER,
  max_output_tokens INTEGER,
  allowed_models TEXT,
  expires_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT,
  model TEXT,
  requested_model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 0,
  streamed INTEGER NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_usage_client ON usage_logs (client_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'gateway.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrateDb(db);
  return db;
}

/**
 * Migrations legeres pour les bases existantes (ajout de colonnes).
 * `requested_model` : nom de modele demande par le client (ex. fable-5.1)
 * quand il differe du modele DeepSeek reellement facture (ex. deepseek-flash).
 */
function migrateDb(db) {
  const logColumns = db.prepare('PRAGMA table_info(usage_logs)').all();
  if (!logColumns.some((column) => column.name === 'requested_model')) {
    db.exec('ALTER TABLE usage_logs ADD COLUMN requested_model TEXT');
  }
}

export function closeDb(db) {
  try {
    db.close();
  } catch {
    /* deja ferme */
  }
}

/* ------------------------------- settings ------------------------------- */

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

export function deleteSetting(db, key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

/* -------------------------------- clients ------------------------------- */

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function mapClientRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    enabled: row.enabled === 1 || row.enabled === true,
    quotaTokens: row.quota_tokens == null ? null : Number(row.quota_tokens),
    quotaRequests: row.quota_requests == null ? null : Number(row.quota_requests),
    quotaUsd: row.quota_usd == null ? null : Number(row.quota_usd),
    usedTokens: Number(row.used_tokens ?? 0),
    usedRequests: Number(row.used_requests ?? 0),
    usedUsd: Number(row.used_usd ?? 0),
    period: row.period,
    periodStart: row.period_start,
    rpmLimit: row.rpm_limit == null ? null : Number(row.rpm_limit),
    concurrencyLimit: row.concurrency_limit == null ? null : Number(row.concurrency_limit),
    maxOutputTokens: row.max_output_tokens == null ? null : Number(row.max_output_tokens),
    allowedModels: row.allowed_models ? safeJsonParse(row.allowed_models) : null,
    expiresAt: row.expires_at,
    note: row.note,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function getClientById(db, id) {
  return mapClientRow(db.prepare('SELECT * FROM clients WHERE id = ?').get(id));
}

export function getClientByKeyHash(db, keyHash) {
  return mapClientRow(db.prepare('SELECT * FROM clients WHERE key_hash = ?').get(keyHash));
}

export function listClients(db) {
  return db
    .prepare('SELECT * FROM clients ORDER BY created_at DESC')
    .all()
    .map(mapClientRow);
}

export function countClients(db) {
  const row = db.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) AS enabled
       FROM clients`,
  ).get();
  return { total: Number(row.total), enabled: Number(row.enabled) };
}

export function insertClient(db, client) {
  db.prepare(
    `INSERT INTO clients (
       id, name, key_hash, key_prefix, enabled,
       quota_tokens, quota_requests, quota_usd,
       used_tokens, used_requests, used_usd,
       period, period_start, rpm_limit, concurrency_limit,
       max_output_tokens, allowed_models, expires_at, note, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    client.id,
    client.name,
    client.keyHash,
    client.keyPrefix,
    client.enabled ? 1 : 0,
    client.quotaTokens,
    client.quotaRequests,
    client.quotaUsd,
    client.usedTokens ?? 0,
    client.usedRequests ?? 0,
    client.usedUsd ?? 0,
    client.period,
    client.periodStart,
    client.rpmLimit,
    client.concurrencyLimit,
    client.maxOutputTokens,
    client.allowedModels ? JSON.stringify(client.allowedModels) : null,
    client.expiresAt,
    client.note,
    client.createdAt,
  );
}

export function updateClientFields(db, id, fields) {
  const columns = {
    name: 'name',
    enabled: 'enabled',
    quotaTokens: 'quota_tokens',
    quotaRequests: 'quota_requests',
    quotaUsd: 'quota_usd',
    period: 'period',
    rpmLimit: 'rpm_limit',
    concurrencyLimit: 'concurrency_limit',
    maxOutputTokens: 'max_output_tokens',
    allowedModels: 'allowed_models',
    expiresAt: 'expires_at',
    note: 'note',
    keyHash: 'key_hash',
    keyPrefix: 'key_prefix',
  };
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(columns)) {
    if (!(field in fields)) continue;
    let value = fields[field];
    if (field === 'enabled') value = value ? 1 : 0;
    if (field === 'allowedModels') value = value && value.length ? JSON.stringify(value) : null;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  if (!sets.length) return;
  values.push(id);
  db.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function resetClientUsage(db, id, periodStart) {
  db.prepare(
    `UPDATE clients
        SET used_tokens = 0, used_requests = 0, used_usd = 0, period_start = ?
      WHERE id = ?`,
  ).run(periodStart, id);
}

export function deleteClient(db, id) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM usage_logs WHERE client_id = ?').run(id);
    db.prepare('DELETE FROM clients WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/* ------------------------------ usage logs ------------------------------ */

export function insertUsageLog(db, logRow) {
  db.prepare(
    `INSERT INTO usage_logs (
       client_id, model, requested_model, prompt_tokens, completion_tokens, total_tokens, cost_usd,
       status, streamed, estimated, latency_ms, error, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    logRow.clientId,
    logRow.model,
    logRow.requestedModel ?? null,
    logRow.promptTokens,
    logRow.completionTokens,
    logRow.totalTokens,
    logRow.costUsd,
    logRow.status,
    logRow.streamed ? 1 : 0,
    logRow.estimated ? 1 : 0,
    logRow.latencyMs,
    logRow.error,
    logRow.createdAt,
  );
}

export function countUsageSince(db, sinceIso) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost_usd), 0) AS cost
         FROM usage_logs
        WHERE created_at >= ?`,
    )
    .get(sinceIso);
  return {
    requests: Number(row.requests),
    tokens: Number(row.tokens),
    cost: Number(row.cost),
  };
}

export function countAllUsage(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost_usd), 0) AS cost
         FROM usage_logs`,
    )
    .get();
  return {
    requests: Number(row.requests),
    tokens: Number(row.tokens),
    cost: Number(row.cost),
  };
}

export function usageSeriesSince(db, sinceIso) {
  return db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day,
              COUNT(*) AS requests,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost_usd), 0) AS cost
         FROM usage_logs
        WHERE created_at >= ?
        GROUP BY day
        ORDER BY day ASC`,
    )
    .all(sinceIso)
    .map((r) => ({
      day: r.day,
      requests: Number(r.requests),
      tokens: Number(r.tokens),
      cost: Number(r.cost),
    }));
}

export function perClientUsageSince(db, sinceIso) {
  const rows = db
    .prepare(
      `SELECT client_id,
              COUNT(*) AS requests,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost_usd), 0) AS cost
         FROM usage_logs
        WHERE created_at >= ?
        GROUP BY client_id`,
    )
    .all(sinceIso);
  const map = new Map();
  for (const row of rows) {
    map.set(row.client_id, {
      requests: Number(row.requests),
      tokens: Number(row.tokens),
      cost: Number(row.cost),
    });
  }
  return map;
}

export function topClientsSince(db, sinceIso, limit = 5) {
  return db
    .prepare(
      `SELECT l.client_id AS clientId,
              COALESCE(c.name, '(supprime)') AS name,
              COUNT(*) AS requests,
              COALESCE(SUM(l.total_tokens), 0) AS tokens,
              COALESCE(SUM(l.cost_usd), 0) AS cost
         FROM usage_logs l
         LEFT JOIN clients c ON c.id = l.client_id
        WHERE l.created_at >= ?
        GROUP BY l.client_id
        ORDER BY tokens DESC
        LIMIT ?`,
    )
    .all(sinceIso, Math.max(1, Math.min(50, limit)))
    .map((r) => ({
      clientId: r.clientId,
      name: r.name,
      requests: Number(r.requests),
      tokens: Number(r.tokens),
      cost: Number(r.cost),
    }));
}

export function listUsageLogs(db, { limit = 50, offset = 0, clientId = null } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const where = clientId ? 'WHERE l.client_id = ?' : '';
  const params = clientId ? [clientId, safeLimit, safeOffset] : [safeLimit, safeOffset];
  const rows = db
    .prepare(
      `SELECT l.*, COALESCE(c.name, '(supprime)') AS client_name
         FROM usage_logs l
         LEFT JOIN clients c ON c.id = l.client_id
         ${where}
        ORDER BY l.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params);
  const total = clientId
    ? db.prepare('SELECT COUNT(*) AS n FROM usage_logs WHERE client_id = ?').get(clientId).n
    : db.prepare('SELECT COUNT(*) AS n FROM usage_logs').get().n;
  return {
    total: Number(total),
    rows: rows.map((r) => ({
      id: Number(r.id),
      clientId: r.client_id,
      clientName: r.client_name,
      model: r.model,
      requestedModel: r.requested_model ?? null,
      promptTokens: Number(r.prompt_tokens),
      completionTokens: Number(r.completion_tokens),
      totalTokens: Number(r.total_tokens),
      costUsd: Number(r.cost_usd),
      status: Number(r.status),
      streamed: r.streamed === 1,
      estimated: r.estimated === 1,
      latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
      error: r.error,
      createdAt: r.created_at,
    })),
  };
}

/* ------------------------------- sessions ------------------------------- */

export function insertAdminSession(db, tokenHash, createdAt, expiresAt) {
  db.prepare(
    'INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)',
  ).run(tokenHash, createdAt, expiresAt);
}

export function getAdminSession(db, tokenHash) {
  return db
    .prepare('SELECT * FROM admin_sessions WHERE token_hash = ?')
    .get(tokenHash);
}

export function deleteAdminSession(db, tokenHash) {
  db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteAllAdminSessions(db) {
  db.prepare('DELETE FROM admin_sessions').run();
}

export function cleanupAdminSessions(db, nowIso) {
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(nowIso);
}
