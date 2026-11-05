import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
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

CREATE TABLE IF NOT EXISTS portal_email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_email_codes_email ON portal_email_codes (email COLLATE NOCASE, created_at);

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

CREATE TABLE IF NOT EXISTS portal_sessions (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_expires ON portal_sessions (expires_at);

CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  ip TEXT,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit (created_at);

-- Traçabilite anti-abus des inscriptions (1 compte par IP / appareil).
CREATE TABLE IF NOT EXISTS signup_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  device_hash TEXT,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signup_ip ON signup_identities (ip, created_at);
CREATE INDEX IF NOT EXISTS idx_signup_device ON signup_identities (device_hash, created_at);
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
  const clientColumns = db.prepare('PRAGMA table_info(clients)').all();
  if (!clientColumns.some((column) => column.name === 'email')) {
    db.exec('ALTER TABLE clients ADD COLUMN email TEXT');
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_email ON clients (email COLLATE NOCASE) WHERE email IS NOT NULL",
  );
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
    email: row.email ?? null,
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

export function findClientByEmail(db, email) {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return null;
  return mapClientRow(
    db.prepare("SELECT * FROM clients WHERE email IS NOT NULL AND email = ? COLLATE NOCASE").get(normalized),
  );
}

/* --------------------------- codes email portail ------------------------ */

export function deletePortalEmailCodes(db, email) {
  db.prepare('DELETE FROM portal_email_codes WHERE email = ? COLLATE NOCASE').run(String(email));
}

export function insertPortalEmailCode(db, { email, codeHash, createdAt, expiresAt }) {
  db.prepare(
    'INSERT INTO portal_email_codes (email, code_hash, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, 0)',
  ).run(String(email).toLowerCase(), codeHash, createdAt, expiresAt);
}

export function getActivePortalEmailCode(db, email) {
  return db
    .prepare(
      `SELECT * FROM portal_email_codes
        WHERE email = ? COLLATE NOCASE
        ORDER BY id DESC LIMIT 1`,
    )
    .get(String(email).toLowerCase());
}

export function incrementPortalEmailCodeAttempts(db, id) {
  db.prepare('UPDATE portal_email_codes SET attempts = attempts + 1 WHERE id = ?').run(id);
}

export function deletePortalEmailCode(db, id) {
  db.prepare('DELETE FROM portal_email_codes WHERE id = ?').run(id);
}

export function cleanupPortalEmailCodes(db, nowIso) {
  db.prepare('DELETE FROM portal_email_codes WHERE expires_at <= ?').run(nowIso);
}

export function insertSignupIdentity(db, { ip, deviceHash = null, email, createdAt }) {
  db.prepare(
    'INSERT INTO signup_identities (ip, device_hash, email, created_at) VALUES (?, ?, ?, ?)',
  ).run(String(ip), deviceHash == null ? null : String(deviceHash), String(email), createdAt);
}

export function countSignupIdentitiesByIp(db, ip, sinceIso) {
  return Number(db.prepare(
    'SELECT COUNT(*) AS n FROM signup_identities WHERE ip = ? AND created_at >= ?',
  ).get(String(ip), sinceIso)?.n ?? 0);
}

export function countSignupIdentitiesByDevice(db, deviceHash, sinceIso) {
  if (!deviceHash) return 0;
  return Number(db.prepare(
    'SELECT COUNT(*) AS n FROM signup_identities WHERE device_hash = ? AND created_at >= ?',
  ).get(String(deviceHash), sinceIso)?.n ?? 0);
}

export function cleanupSignupIdentities(db, beforeIso) {
  db.prepare('DELETE FROM signup_identities WHERE created_at < ?').run(beforeIso);
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
       max_output_tokens, allowed_models, expires_at, note, created_at, email
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    client.email ?? null,
  );
}

export function updateClientFields(db, id, fields) {
  const columns = {
    name: 'name',
    email: 'email',
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

/* -------------------------------- audit --------------------------------- */

export function recordAdminAudit(db, { ip = null, action, target = null, details = null, now = new Date() }) {
  db.prepare(
    'INSERT INTO admin_audit (created_at, ip, action, target, details) VALUES (?, ?, ?, ?, ?)',
  ).run(now.toISOString(), ip, String(action), target == null ? null : String(target), details == null ? null : String(details));
}

export function listAdminAudit(db, { limit = 100, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const rows = db
    .prepare('SELECT * FROM admin_audit ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(safeLimit, safeOffset);
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n);
  return {
    total,
    rows: rows.map((row) => ({
      id: Number(row.id),
      createdAt: row.created_at,
      ip: row.ip,
      action: row.action,
      target: row.target,
      details: row.details,
    })),
  };
}

/** Purge des journaux d'usage anterieurs a une date (retention). */
export function deleteUsageLogsBefore(db, isoDate) {
  const result = db.prepare('DELETE FROM usage_logs WHERE created_at < ?').run(isoDate);
  return Number(result.changes ?? 0);
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

/* ----------------------------- portal sessions -------------------------- */

export function insertPortalSession(db, tokenHash, clientId, createdAt, expiresAt) {
  db.prepare(
    'INSERT INTO portal_sessions (token_hash, client_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(tokenHash, clientId, createdAt, expiresAt);
}

export function getPortalSession(db, tokenHash) {
  return db.prepare('SELECT * FROM portal_sessions WHERE token_hash = ?').get(tokenHash);
}

export function deletePortalSession(db, tokenHash) {
  db.prepare('DELETE FROM portal_sessions WHERE token_hash = ?').run(tokenHash);
}

export function cleanupPortalSessions(db, nowIso) {
  db.prepare('DELETE FROM portal_sessions WHERE expires_at <= ?').run(nowIso);
}

/* ------------------------ usage par client (portail) -------------------- */

export function countClientUsageSince(db, clientId, sinceIso) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost_usd), 0) AS cost
         FROM usage_logs
        WHERE client_id = ? AND created_at >= ?`,
    )
    .get(clientId, sinceIso);
  return {
    requests: Number(row.requests),
    tokens: Number(row.tokens),
    cost: Math.round(Number(row.cost) * 1e6) / 1e6,
  };
}

export function clientUsageSeriesSince(db, clientId, sinceIso) {
  return db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day,
              COUNT(*) AS requests,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost_usd), 0) AS cost
         FROM usage_logs
        WHERE client_id = ? AND created_at >= ?
        GROUP BY day
        ORDER BY day ASC`,
    )
    .all(clientId, sinceIso)
    .map((row) => ({
      day: row.day,
      requests: Number(row.requests),
      tokens: Number(row.tokens),
      cost: Math.round(Number(row.cost) * 1e6) / 1e6,
    }));
}

/** Insere un journal d'usage et met a jour les compteurs du client atomiquement. */
export function insertUsageAndUpdateClient(db, logRow) {
  db.exec('BEGIN IMMEDIATE');
  try {
    insertUsageLog(db, logRow);
    db.prepare(
      `UPDATE clients
          SET used_tokens = used_tokens + ?,
              used_requests = used_requests + 1,
              used_usd = used_usd + ?,
              last_used_at = ?
        WHERE id = ?`,
    ).run(logRow.totalTokens, logRow.costUsd, logRow.createdAt, logRow.clientId);
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

