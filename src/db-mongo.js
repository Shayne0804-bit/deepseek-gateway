/**
 * Couche de donnees MongoDB (asynchrone).
 *
 * Reproduit les semantiques de la couche SQLite (`db-sqlite.js`) :
 *  - memes noms de champs internes qu'en SQLite (snake_case) pour que
 *    `mapClientRow` soit reutilisable tel quel ;
 *  - memes formes de retour cote API (camelCase, nombres, Map, etc.) ;
 *  - memes encodages : JSON stocke sous forme de texte, booleens stockes en
 *    0/1, horodatages stockes sous forme de chaines ISO (donc comparables
 *    lexicographiquement comme en SQLite).
 *
 * Les identifiants numeriques auto-incrementes (usage_logs, admin_audit,
 * portal_email_codes, signup_identities) sont alloues via la collection
 * `counters` : `findOneAndUpdate({_id}, {$inc:{seq:1}}, {upsert:true,
 * returnDocument:'after'})`. Cela reproduit `INTEGER PRIMARY KEY AUTOINCREMENT`.
 *
 * Ce module est consomme par le wrapper `src/db.js` (selection du moteur).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

/* ------------------------------- schema --------------------------------- */

const COLLECTION_NAMES = [
  'clients',
  'portal_email_codes',
  'usage_logs',
  'settings',
  'admin_sessions',
  'portal_sessions',
  'admin_audit',
  'signup_identities',
  'counters',
];

/**
 * Index equivalents au schema SQLite. `settings.key` est unique comme la cle
 * primaire SQLite. L'index unique sur `clients.email` reprend la semantique
 * `COLLATE NOCASE` de SQLite (unicite insensible a la casse).
 */
const INDEX_DEFINITIONS = {
  clients: [
    { keys: { id: 1 }, options: { unique: true } },
    { keys: { key_hash: 1 }, options: { unique: true } },
    {
      keys: { email: 1 },
      options: {
        unique: true,
        partialFilterExpression: { email: { $type: 'string' } },
        collation: { locale: 'en', strength: 2 },
      },
    },
  ],
  usage_logs: [
    { keys: { created_at: 1 }, options: {} },
    { keys: { client_id: 1, created_at: 1 }, options: {} },
  ],
  portal_email_codes: [{ keys: { email: 1, created_at: 1 }, options: {} }],
  settings: [{ keys: { key: 1 }, options: { unique: true } }],
  admin_sessions: [{ keys: { token_hash: 1 }, options: { unique: true } }],
  portal_sessions: [{ keys: { token_hash: 1 }, options: { unique: true } }],
  admin_audit: [{ keys: { created_at: 1 }, options: {} }],
  signup_identities: [
    { keys: { ip: 1, created_at: 1 }, options: {} },
    { keys: { device_hash: 1, created_at: 1 }, options: {} },
  ],
};

/** Tables copiees telles quelles lors d'une migration depuis SQLite.
 * `clients` est importe EN DERNIER : si la migration est interrompue avant,
 * MongoDB reste sans clients et sera rejouee proprement au prochain demarrage.
 */
const MIGRATION_TABLES = [
  'portal_email_codes',
  'usage_logs',
  'settings',
  'admin_sessions',
  'portal_sessions',
  'admin_audit',
  'signup_identities',
  'clients',
];

/** Tables dont la cle primaire SQLite est un entier auto-incremente. */
const COUNTER_COLLECTIONS = new Set([
  'portal_email_codes',
  'usage_logs',
  'admin_audit',
  'signup_identities',
]);

/* ------------------------------- helpers -------------------------------- */

function getCollection(handle, name) {
  return handle.db.collection(name);
}

function getCounters(handle) {
  return handle.counters ?? getCollection(handle, 'counters');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Filtre « email = valeur COLLATE NOCASE » de SQLite. On ancre le motif pour
 * reproduire l'egalite (et non une recherche de sous-chaine).
 */
function emailFilter(email) {
  return { $regex: `^${escapeRegExp(String(email))}$`, $options: 'i' };
}

/** Retire l'`_id` technique de Mongo : les lignes renvoyees imitent SQLite. */
function stripMongoId(doc) {
  if (!doc) return null;
  const { _id, ...row } = doc;
  return row;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function roundCost(value) {
  return Math.round(Number(value ?? 0) * 1e6) / 1e6;
}

/**
 * Alloue le prochain identifiant numerique d'une collection.
 * Le compteur est incremente atomiquement ; on retente une fois en cas de
 * course lors du tout premier upsert (deux processus, deux `_id` identiques).
 */
async function nextId(handle, name) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const doc = await getCounters(handle).findOneAndUpdate(
        { _id: name },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' },
      );
      return Number(doc?.seq ?? 0);
    } catch (err) {
      lastError = err;
      if (err?.code !== 11000) throw err;
    }
  }
  throw lastError;
}

/** Noms d'affichage des clients, avec le meme repli que le LEFT JOIN SQLite. */
async function clientNameMap(handle, ids) {
  const uniqueIds = [...new Set(ids.filter((id) => id != null))];
  const map = new Map();
  if (!uniqueIds.length) return map;
  const clients = await getCollection(handle, 'clients')
    .find({ id: { $in: uniqueIds } }, { projection: { _id: 0, id: 1, name: 1 } })
    .toArray();
  for (const client of clients) map.set(client.id, client.name ?? null);
  return map;
}

/** Agrege les volumes d'usage (comme COUNT/SUM en SQLite). */
async function sumUsage(handle, match) {
  const rows = await getCollection(handle, 'usage_logs')
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          requests: { $sum: 1 },
          tokens: { $sum: '$total_tokens' },
          cost: { $sum: '$cost_usd' },
        },
      },
    ])
    .toArray();
  const row = rows[0];
  return {
    requests: Number(row?.requests ?? 0),
    tokens: Number(row?.tokens ?? 0),
    cost: Number(row?.cost ?? 0),
  };
}

/** Agrege l'usage par jour (substr(created_at, 1, 10) en SQLite). */
async function seriesUsage(handle, match, roundCostValue) {
  const rows = await getCollection(handle, 'usage_logs')
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: { $substrBytes: ['$created_at', 0, 10] },
          requests: { $sum: 1 },
          tokens: { $sum: '$total_tokens' },
          cost: { $sum: '$cost_usd' },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  return rows.map((row) => ({
    day: row._id,
    requests: Number(row.requests),
    tokens: Number(row.tokens),
    cost: roundCostValue ? roundCost(row.cost) : Number(row.cost),
  }));
}

/* ------------------------------- lifecycle ------------------------------ */

async function ensureCollections(db) {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((info) => info.name),
  );
  for (const name of COLLECTION_NAMES) {
    if (existing.has(name)) continue;
    try {
      await db.createCollection(name);
    } catch (err) {
      // 48 = NamespaceExists (course benigne entre deux processus au demarrage).
      if (err?.code !== 48) throw err;
    }
  }
}

async function ensureIndexes(db, log) {
  for (const [name, definitions] of Object.entries(INDEX_DEFINITIONS)) {
    for (const definition of definitions) {
      try {
        await db.collection(name).createIndex(definition.keys, definition.options);
      } catch (err) {
        // 85/86 : un index existe deja avec la meme cle mais des options
        // differentes (base creee par une version anterieure). On continue :
        // ce n'est pas bloquant pour le demarrage.
        if (err?.code === 85 || err?.code === 86) {
          if (log?.warn) {
            log.warn(`Index MongoDB "${name}" conserve tel quel (definition differente : ${err.message}).`);
          }
          continue;
        }
        throw err;
      }
    }
  }
}

/**
 * Ouvre une base MongoDB et prepare le schema.
 * @returns {Promise<{driver:'mongo', client: MongoClient, db: import('mongodb').Db, counters: import('mongodb').Collection}>}
 */
export async function openMongoDb({ uri, dbName = 'valaria_gateway', log = null } = {}) {
  if (!uri) throw new Error('MONGODB_URI manquante pour ouvrir MongoDB.');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(dbName || 'valaria_gateway');
    await ensureCollections(db);
    await ensureIndexes(db, log);
    return { driver: 'mongo', client, db, counters: db.collection('counters') };
  } catch (err) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function closeMongoDb(handle) {
  if (!handle?.client) return;
  try {
    await handle.client.close();
  } catch {
    /* deja ferme */
  }
}

/**
 * Migration one-shot SQLite -> MongoDB.
 * Ne copie que si MongoDB ne contient encore aucun client. Chaque table est
 * lue en lecture seule via `node:sqlite` et copiee telle quelle (memes colonnes
 * snake_case, memes ids). Une table absente/illisible est ignoree : elle ne
 * doit pas empecher le demarrage.
 * @returns {Promise<{imported:number, tables:Object<string,number>, counters:Object<string,number>, skipped:boolean, reason:string|null}>}
 */
export async function migrateFromSqlite(handle, sqliteFile, log = null) {
  const result = {
    imported: 0,
    tables: {},
    counters: {},
    skipped: false,
    reason: null,
  };

  const clientCount = await getCollection(handle, 'clients').countDocuments();
  if (clientCount > 0) {
    result.skipped = true;
    result.reason = 'des clients existent deja dans MongoDB';
    return result;
  }
  if (!sqliteFile || !fs.existsSync(sqliteFile)) {
    result.skipped = true;
    result.reason = 'fichier SQLite introuvable';
    return result;
  }

  // Import paresseux : evite d'afficher l'avertissement expérimental de
  // `node:sqlite` quand le moteur Mongo n'est jamais utilise.
  let DatabaseSync = null;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch (err) {
    result.skipped = true;
    result.reason = `node:sqlite indisponible (${err?.message ?? err})`;
    return result;
  }

  let sqlite = null;
  try {
    sqlite = new DatabaseSync(sqliteFile, { readOnly: true });
    const counterMax = new Map();

    for (const table of MIGRATION_TABLES) {
      let rows;
      try {
        rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      } catch (err) {
        // Tables optionnelles absentes des anciennes bases (ou colonnes
        // ajoutees par migration) : on ignore cette table et on continue.
        if (log?.warn) {
          log.warn(`Migration SQLite -> MongoDB : table "${table}" ignoree (${err.message}).`);
        }
        continue;
      }

      const target = getCollection(handle, table);
      // Remplacement complet : la migration doit produire une copie exacte et
      // rester rejouable apres un echec partiel.
      await target.deleteMany({});
      if (rows.length > 0) {
        try {
          await target.insertMany(
            rows.map((row) => ({ ...row })),
            { ordered: true },
          );
        } catch (err) {
          // Si l'import des clients echoue a mi-chemin, on nettoie pour que
          // `clients` reste vide et que la migration soit rejouee au prochain
          // demarrage (clients est importe en dernier).
          if (table === 'clients') await target.deleteMany({});
          throw err;
        }
      }
      result.tables[table] = rows.length;
      result.imported += rows.length;

      if (COUNTER_COLLECTIONS.has(table)) {
        let maxId = 0;
        for (const row of rows) {
          const id = Number(row.id);
          if (Number.isFinite(id) && id > maxId) maxId = id;
        }
        counterMax.set(table, maxId);
        // Les compteurs sont ecrits immediatement : clients etant importe en
        // dernier, un arret juste apres ne peut pas provoquer de collision d'id.
        await getCounters(handle).updateOne({ _id: table }, { $set: { seq: maxId } }, { upsert: true });
        result.counters[table] = maxId;
      }
    }

    if (result.imported > 0 && log?.debug) {
      log.debug(
        `Migration SQLite -> MongoDB : ${result.imported} document(s) copie(s) depuis ${sqliteFile}.`,
      );
    }
    return result;
  } finally {
    if (sqlite) {
      try {
        sqlite.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/* ------------------------------- settings ------------------------------- */

export async function getSetting(handle, key, fallback = null) {
  const row = await getCollection(handle, 'settings').findOne({ key });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export async function setSetting(handle, key, value) {
  await getCollection(handle, 'settings').updateOne(
    { key },
    { $set: { value: JSON.stringify(value) } },
    { upsert: true },
  );
}

export async function deleteSetting(handle, key) {
  await getCollection(handle, 'settings').deleteOne({ key });
}

/* -------------------------------- clients ------------------------------- */

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Identique a la version SQLite : la ligne Mongo utilise les memes colonnes. */
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

export async function getClientById(handle, id) {
  const row = await getCollection(handle, 'clients').findOne({ id });
  return mapClientRow(row);
}

export async function findClientByEmail(handle, email) {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return null;
  const row = await getCollection(handle, 'clients').findOne({ email: emailFilter(normalized) });
  return mapClientRow(row);
}

/* --------------------------- codes email portail ------------------------ */

export async function deletePortalEmailCodes(handle, email) {
  await getCollection(handle, 'portal_email_codes').deleteMany({ email: emailFilter(email) });
}

export async function insertPortalEmailCode(handle, { email, codeHash, createdAt, expiresAt }) {
  const id = await nextId(handle, 'portal_email_codes');
  await getCollection(handle, 'portal_email_codes').insertOne({
    id,
    email: String(email).toLowerCase(),
    code_hash: codeHash,
    created_at: createdAt,
    expires_at: expiresAt,
    attempts: 0,
  });
}

export async function getActivePortalEmailCode(handle, email) {
  const row = await getCollection(handle, 'portal_email_codes').findOne(
    { email: emailFilter(String(email).toLowerCase()) },
    { sort: { id: -1 } },
  );
  return stripMongoId(row);
}

export async function incrementPortalEmailCodeAttempts(handle, id) {
  await getCollection(handle, 'portal_email_codes').updateOne({ id }, { $inc: { attempts: 1 } });
}

export async function deletePortalEmailCode(handle, id) {
  await getCollection(handle, 'portal_email_codes').deleteOne({ id });
}

export async function cleanupPortalEmailCodes(handle, nowIso) {
  await getCollection(handle, 'portal_email_codes').deleteMany({ expires_at: { $lte: nowIso } });
}

/* ------------------------- anti-abus inscription ----------------------- */

export async function insertSignupIdentity(handle, { ip, deviceHash = null, email, createdAt }) {
  const id = await nextId(handle, 'signup_identities');
  await getCollection(handle, 'signup_identities').insertOne({
    id,
    ip: String(ip),
    device_hash: deviceHash == null ? null : String(deviceHash),
    email: String(email),
    created_at: createdAt,
  });
}

export async function countSignupIdentitiesByIp(handle, ip, sinceIso) {
  if (sinceIso == null) return 0;
  return Number(
    await getCollection(handle, 'signup_identities').countDocuments({
      ip: String(ip),
      created_at: { $gte: sinceIso },
    }),
  );
}

export async function countSignupIdentitiesByDevice(handle, deviceHash, sinceIso) {
  if (!deviceHash) return 0;
  if (sinceIso == null) return 0;
  return Number(
    await getCollection(handle, 'signup_identities').countDocuments({
      device_hash: String(deviceHash),
      created_at: { $gte: sinceIso },
    }),
  );
}

export async function cleanupSignupIdentities(handle, beforeIso) {
  await getCollection(handle, 'signup_identities').deleteMany({ created_at: { $lt: beforeIso } });
}

/* -------------------------------- clients ------------------------------- */

export async function getClientByKeyHash(handle, keyHash) {
  const row = await getCollection(handle, 'clients').findOne({ key_hash: keyHash });
  return mapClientRow(row);
}

export async function listClients(handle) {
  const rows = await getCollection(handle, 'clients').find({}).sort({ created_at: -1 }).toArray();
  return rows.map(mapClientRow);
}

export async function countClients(handle) {
  const clients = getCollection(handle, 'clients');
  const [total, enabled] = await Promise.all([
    clients.countDocuments({}),
    // SQLite : `enabled = 1` (les booleens y sont des entiers) ;
    // on tolere aussi `true` si la base a ete ecrite a la main.
    clients.countDocuments({ enabled: { $in: [1, true] } }),
  ]);
  return { total: Number(total), enabled: Number(enabled) };
}

export async function insertClient(handle, client) {
  await getCollection(handle, 'clients').insertOne({
    id: client.id,
    name: client.name,
    email: client.email ?? null,
    key_hash: client.keyHash,
    key_prefix: client.keyPrefix,
    enabled: client.enabled ? 1 : 0,
    quota_tokens: client.quotaTokens ?? null,
    quota_requests: client.quotaRequests ?? null,
    quota_usd: client.quotaUsd ?? null,
    used_tokens: client.usedTokens ?? 0,
    used_requests: client.usedRequests ?? 0,
    used_usd: client.usedUsd ?? 0,
    period: client.period,
    period_start: client.periodStart,
    rpm_limit: client.rpmLimit ?? null,
    concurrency_limit: client.concurrencyLimit ?? null,
    max_output_tokens: client.maxOutputTokens ?? null,
    allowed_models: client.allowedModels ? JSON.stringify(client.allowedModels) : null,
    expires_at: client.expiresAt ?? null,
    note: client.note ?? null,
    created_at: client.createdAt,
    last_used_at: null,
  });
}

const CLIENT_COLUMNS = {
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

export async function updateClientFields(handle, id, fields) {
  const changes = {};
  for (const [field, column] of Object.entries(CLIENT_COLUMNS)) {
    if (!(field in fields)) continue;
    let value = fields[field];
    if (field === 'enabled') value = value ? 1 : 0;
    if (field === 'allowedModels') value = value && value.length ? JSON.stringify(value) : null;
    changes[column] = value === undefined ? null : value;
  }
  if (!Object.keys(changes).length) return;
  await getCollection(handle, 'clients').updateOne({ id }, { $set: changes });
}

export async function resetClientUsage(handle, id, periodStart) {
  await getCollection(handle, 'clients').updateOne(
    { id },
    { $set: { used_tokens: 0, used_requests: 0, used_usd: 0, period_start: periodStart } },
  );
}

export async function deleteClient(handle, id) {
  await getCollection(handle, 'usage_logs').deleteMany({ client_id: id });
  await getCollection(handle, 'clients').deleteOne({ id });
}

/* ------------------------------ usage logs ------------------------------ */

function usageLogDocument(id, logRow) {
  return {
    id,
    client_id: logRow.clientId ?? null,
    model: logRow.model ?? null,
    requested_model: logRow.requestedModel ?? null,
    prompt_tokens: safeNumber(logRow.promptTokens),
    completion_tokens: safeNumber(logRow.completionTokens),
    total_tokens: safeNumber(logRow.totalTokens),
    cost_usd: safeNumber(logRow.costUsd),
    status: safeNumber(logRow.status),
    streamed: logRow.streamed ? 1 : 0,
    estimated: logRow.estimated ? 1 : 0,
    latency_ms: logRow.latencyMs == null ? null : safeNumber(logRow.latencyMs),
    error: logRow.error ?? null,
    created_at: logRow.createdAt ?? null,
  };
}

export async function insertUsageLog(handle, logRow) {
  const id = await nextId(handle, 'usage_logs');
  await getCollection(handle, 'usage_logs').insertOne(usageLogDocument(id, logRow));
}

/**
 * Insere un journal d'usage et met a jour les compteurs du client.
 * L'increment est atomique cote MongoDB (`$inc`), comme le fait la transaction
 * SQLite de `db-sqlite.js`.
 */
export async function insertUsageAndUpdateClient(handle, logRow) {
  await insertUsageLog(handle, logRow);
  await getCollection(handle, 'clients').updateOne(
    { id: logRow.clientId ?? null },
    {
      $inc: {
        used_tokens: safeNumber(logRow.totalTokens),
        used_requests: 1,
        used_usd: safeNumber(logRow.costUsd),
      },
      $set: { last_used_at: logRow.createdAt ?? null },
    },
  );
}

export async function countUsageSince(handle, sinceIso) {
  if (sinceIso == null) return { requests: 0, tokens: 0, cost: 0 };
  return sumUsage(handle, { created_at: { $gte: sinceIso } });
}

export async function countAllUsage(handle) {
  return sumUsage(handle, {});
}

export async function usageSeriesSince(handle, sinceIso) {
  if (sinceIso == null) return [];
  return seriesUsage(handle, { created_at: { $gte: sinceIso } }, false);
}

export async function perClientUsageSince(handle, sinceIso) {
  const map = new Map();
  if (sinceIso == null) return map;
  const rows = await getCollection(handle, 'usage_logs')
    .aggregate([
      { $match: { created_at: { $gte: sinceIso } } },
      {
        $group: {
          _id: '$client_id',
          requests: { $sum: 1 },
          tokens: { $sum: '$total_tokens' },
          cost: { $sum: '$cost_usd' },
        },
      },
    ])
    .toArray();
  for (const row of rows) {
    map.set(row._id, {
      requests: Number(row.requests),
      tokens: Number(row.tokens),
      cost: Number(row.cost),
    });
  }
  return map;
}

export async function topClientsSince(handle, sinceIso, limit = 5) {
  if (sinceIso == null) return [];
  let safeLimit = Number(limit);
  if (!Number.isFinite(safeLimit)) safeLimit = 5;
  safeLimit = Math.max(1, Math.min(50, Math.trunc(safeLimit)));

  const rows = await getCollection(handle, 'usage_logs')
    .aggregate([
      { $match: { created_at: { $gte: sinceIso } } },
      {
        $group: {
          _id: '$client_id',
          requests: { $sum: 1 },
          tokens: { $sum: '$total_tokens' },
          cost: { $sum: '$cost_usd' },
        },
      },
      // En cas d'egalite, SQLite (GROUP BY) trie par cle de groupe : on
      // reproduit ce comportement pour un resultat deterministe.
      { $sort: { tokens: -1, _id: 1 } },
      { $limit: safeLimit },
    ])
    .toArray();

  const nameById = await clientNameMap(handle, rows.map((row) => row._id));
  return rows.map((row) => ({
    clientId: row._id,
    name: nameById.get(row._id) ?? '(supprime)',
    requests: Number(row.requests),
    tokens: Number(row.tokens),
    cost: Number(row.cost),
  }));
}

export async function listUsageLogs(handle, { limit = 50, offset = 0, clientId = null } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const filter = clientId ? { client_id: clientId } : {};
  const usageLogs = getCollection(handle, 'usage_logs');
  const [rows, total] = await Promise.all([
    usageLogs.find(filter).sort({ id: -1 }).skip(safeOffset).limit(safeLimit).toArray(),
    usageLogs.countDocuments(filter),
  ]);
  const nameById = await clientNameMap(handle, rows.map((row) => row.client_id));
  return {
    total: Number(total),
    rows: rows.map((row) => ({
      id: Number(row.id),
      clientId: row.client_id ?? null,
      clientName: nameById.get(row.client_id) ?? '(supprime)',
      model: row.model ?? null,
      requestedModel: row.requested_model ?? null,
      promptTokens: Number(row.prompt_tokens ?? 0),
      completionTokens: Number(row.completion_tokens ?? 0),
      totalTokens: Number(row.total_tokens ?? 0),
      costUsd: Number(row.cost_usd ?? 0),
      status: Number(row.status ?? 0),
      streamed: row.streamed === 1,
      estimated: row.estimated === 1,
      latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
      error: row.error ?? null,
      createdAt: row.created_at ?? null,
    })),
  };
}

/* ----------------------------- admin sessions --------------------------- */

export async function insertAdminSession(handle, tokenHash, createdAt, expiresAt) {
  await getCollection(handle, 'admin_sessions').insertOne({
    token_hash: tokenHash,
    created_at: createdAt,
    expires_at: expiresAt,
  });
}

export async function getAdminSession(handle, tokenHash) {
  return stripMongoId(await getCollection(handle, 'admin_sessions').findOne({ token_hash: tokenHash }));
}

export async function deleteAdminSession(handle, tokenHash) {
  await getCollection(handle, 'admin_sessions').deleteOne({ token_hash: tokenHash });
}

export async function deleteAllAdminSessions(handle) {
  await getCollection(handle, 'admin_sessions').deleteMany({});
}

export async function cleanupAdminSessions(handle, nowIso) {
  await getCollection(handle, 'admin_sessions').deleteMany({ expires_at: { $lte: nowIso } });
}

/* ----------------------------- portal sessions -------------------------- */

export async function insertPortalSession(handle, tokenHash, clientId, createdAt, expiresAt) {
  await getCollection(handle, 'portal_sessions').insertOne({
    token_hash: tokenHash,
    client_id: clientId,
    created_at: createdAt,
    expires_at: expiresAt,
  });
}

export async function getPortalSession(handle, tokenHash) {
  return stripMongoId(await getCollection(handle, 'portal_sessions').findOne({ token_hash: tokenHash }));
}

export async function deletePortalSession(handle, tokenHash) {
  await getCollection(handle, 'portal_sessions').deleteOne({ token_hash: tokenHash });
}

export async function cleanupPortalSessions(handle, nowIso) {
  await getCollection(handle, 'portal_sessions').deleteMany({ expires_at: { $lte: nowIso } });
}

/* -------------------------------- audit --------------------------------- */

export async function recordAdminAudit(handle, { ip = null, action, target = null, details = null, now = new Date() }) {
  const id = await nextId(handle, 'admin_audit');
  await getCollection(handle, 'admin_audit').insertOne({
    id,
    created_at: now.toISOString(),
    ip: ip ?? null,
    action: String(action),
    target: target == null ? null : String(target),
    details: details == null ? null : String(details),
  });
}

export async function listAdminAudit(handle, { limit = 100, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const audit = getCollection(handle, 'admin_audit');
  const [rows, total] = await Promise.all([
    audit.find({}).sort({ id: -1 }).skip(safeOffset).limit(safeLimit).toArray(),
    audit.countDocuments({}),
  ]);
  return {
    total: Number(total),
    rows: rows.map((row) => ({
      id: Number(row.id),
      createdAt: row.created_at,
      ip: row.ip ?? null,
      action: row.action,
      target: row.target ?? null,
      details: row.details ?? null,
    })),
  };
}

/** Purge des journaux d'usage anterieurs a une date (retention). */
export async function deleteUsageLogsBefore(handle, isoDate) {
  const result = await getCollection(handle, 'usage_logs').deleteMany({
    created_at: { $lt: isoDate },
  });
  return Number(result.deletedCount ?? 0);
}

/* ------------------------ usage par client (portail) -------------------- */

export async function countClientUsageSince(handle, clientId, sinceIso) {
  // `client_id = NULL` ne correspond a aucune ligne en SQLite.
  if (clientId == null || sinceIso == null) return { requests: 0, tokens: 0, cost: 0 };
  const totals = await sumUsage(handle, {
    client_id: clientId,
    created_at: { $gte: sinceIso },
  });
  return { requests: totals.requests, tokens: totals.tokens, cost: roundCost(totals.cost) };
}

export async function clientUsageSeriesSince(handle, clientId, sinceIso) {
  if (clientId == null || sinceIso == null) return [];
  return seriesUsage(handle, { client_id: clientId, created_at: { $gte: sinceIso } }, true);
}
