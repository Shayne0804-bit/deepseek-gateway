/**
 * Couche de donnees : SQLite (defaut) ou MongoDB (DB_DRIVER=mongo).
 *
 * Toutes les fonctions sont asynchrones pour permettre les deux moteurs.
 * SQLite reste disponible pour les tests et le rollback.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as sqlite from './db-sqlite.js';
import * as mongo from './db-mongo.js';

export { mapClientRow } from './db-sqlite.js';

export function dbDriver(db) {
  return db?.driver === 'mongo' ? 'mongo' : 'sqlite';
}

/** Ouvre la base selon la configuration. */
export async function openDb(dataDir, options = {}) {
  const driver = options.driver || 'sqlite';
  if (driver === 'mongo') {
    if (!options.mongoUri) throw new Error('DB_DRIVER=mongo mais MONGODB_URI est vide.');
    const handle = await mongo.openMongoDb({
      uri: options.mongoUri,
      dbName: options.mongoDb || 'valaria_gateway',
      log: options.log || null,
    });
    if (options.migrateSqlite !== false) {
      const sqliteFile = options.sqliteFile
        ? path.resolve(options.sqliteFile)
        : path.join(dataDir, 'gateway.db');
      try {
        const exists = fs.existsSync(sqliteFile);
        const result = await mongo.migrateFromSqlite(handle, sqliteFile, options.log || null);
        if (result?.imported && options.log?.info) {
          options.log.info(`Migration SQLite -> MongoDB : ${result.imported} document(s) importe(s).`);
        }
        const alreadyMigrated = String(result?.reason || '').includes('clients existent');
        if (options.migrateRequired && !alreadyMigrated && (result?.skipped || !result?.imported)) {
          throw new Error(
            `Migration MongoDB requise mais aucun document importe. Fichier SQLite cherche : ${sqliteFile} (${exists ? 'present' : 'INTROUVABLE'} ; DATA_DIR=${dataDir}). ` +
            `Verifiez le volume Railway monte sur ${dataDir}, ou definissez MONGODB_SQLITE_FILE. Raison : ${result?.reason || 'base vide'}.`,
          );
        }
      } catch (err) {
        if (options.migrateRequired) throw err;
        if (options.log?.warn) options.log.warn(`Migration SQLite -> MongoDB ignoree : ${err.message}`);
      }
    }
    return handle;
  }
  return sqlite.openDb(dataDir);
}

export async function closeDb(db) {
  if (db?.driver === 'mongo') return mongo.closeMongoDb(db);
  return sqlite.closeDb(db);
}

/* ------------------------------- settings ------------------------------- */
export async function getSetting(db, key, fallback = null) {
  return dbDriver(db) === 'mongo'
    ? mongo.getSetting(db, key, fallback)
    : sqlite.getSetting(db, key, fallback);
}
export async function setSetting(db, key, value) {
  return dbDriver(db) === 'mongo' ? mongo.setSetting(db, key, value) : sqlite.setSetting(db, key, value);
}
export async function deleteSetting(db, key) {
  return dbDriver(db) === 'mongo' ? mongo.deleteSetting(db, key) : sqlite.deleteSetting(db, key);
}

/* -------------------------------- clients ------------------------------- */
export async function getClientById(db, id) {
  return dbDriver(db) === 'mongo' ? mongo.getClientById(db, id) : sqlite.getClientById(db, id);
}
export async function findClientByEmail(db, email) {
  return dbDriver(db) === 'mongo' ? mongo.findClientByEmail(db, email) : sqlite.findClientByEmail(db, email);
}
export async function getClientByKeyHash(db, keyHash) {
  return dbDriver(db) === 'mongo' ? mongo.getClientByKeyHash(db, keyHash) : sqlite.getClientByKeyHash(db, keyHash);
}
export async function listClients(db) {
  return dbDriver(db) === 'mongo' ? mongo.listClients(db) : sqlite.listClients(db);
}
export async function countClients(db) {
  return dbDriver(db) === 'mongo' ? mongo.countClients(db) : sqlite.countClients(db);
}
export async function insertClient(db, client) {
  return dbDriver(db) === 'mongo' ? mongo.insertClient(db, client) : sqlite.insertClient(db, client);
}
export async function updateClientFields(db, id, fields) {
  return dbDriver(db) === 'mongo' ? mongo.updateClientFields(db, id, fields) : sqlite.updateClientFields(db, id, fields);
}
export async function resetClientUsage(db, id, periodStart) {
  return dbDriver(db) === 'mongo' ? mongo.resetClientUsage(db, id, periodStart) : sqlite.resetClientUsage(db, id, periodStart);
}
export async function deleteClient(db, id) {
  return dbDriver(db) === 'mongo' ? mongo.deleteClient(db, id) : sqlite.deleteClient(db, id);
}

/* --------------------------- codes email portail ------------------------ */
export async function deletePortalEmailCodes(db, email) {
  return dbDriver(db) === 'mongo' ? mongo.deletePortalEmailCodes(db, email) : sqlite.deletePortalEmailCodes(db, email);
}
export async function insertPortalEmailCode(db, code) {
  return dbDriver(db) === 'mongo' ? mongo.insertPortalEmailCode(db, code) : sqlite.insertPortalEmailCode(db, code);
}
export async function getActivePortalEmailCode(db, email) {
  return dbDriver(db) === 'mongo' ? mongo.getActivePortalEmailCode(db, email) : sqlite.getActivePortalEmailCode(db, email);
}
export async function incrementPortalEmailCodeAttempts(db, id) {
  return dbDriver(db) === 'mongo'
    ? mongo.incrementPortalEmailCodeAttempts(db, id)
    : sqlite.incrementPortalEmailCodeAttempts(db, id);
}
export async function deletePortalEmailCode(db, id) {
  return dbDriver(db) === 'mongo' ? mongo.deletePortalEmailCode(db, id) : sqlite.deletePortalEmailCode(db, id);
}
export async function cleanupPortalEmailCodes(db, nowIso) {
  return dbDriver(db) === 'mongo' ? mongo.cleanupPortalEmailCodes(db, nowIso) : sqlite.cleanupPortalEmailCodes(db, nowIso);
}

/* ------------------------- anti-abus inscription ----------------------- */
export async function insertSignupIdentity(db, identity) {
  return dbDriver(db) === 'mongo' ? mongo.insertSignupIdentity(db, identity) : sqlite.insertSignupIdentity(db, identity);
}
export async function countSignupIdentitiesByIp(db, ip, sinceIso) {
  return dbDriver(db) === 'mongo'
    ? mongo.countSignupIdentitiesByIp(db, ip, sinceIso)
    : sqlite.countSignupIdentitiesByIp(db, ip, sinceIso);
}
export async function countSignupIdentitiesByDevice(db, deviceHash, sinceIso) {
  return dbDriver(db) === 'mongo'
    ? mongo.countSignupIdentitiesByDevice(db, deviceHash, sinceIso)
    : sqlite.countSignupIdentitiesByDevice(db, deviceHash, sinceIso);
}
export async function cleanupSignupIdentities(db, beforeIso) {
  return dbDriver(db) === 'mongo' ? mongo.cleanupSignupIdentities(db, beforeIso) : sqlite.cleanupSignupIdentities(db, beforeIso);
}

/* ------------------------------ usage logs ------------------------------ */
export async function insertUsageLog(db, row) {
  return dbDriver(db) === 'mongo' ? mongo.insertUsageLog(db, row) : sqlite.insertUsageLog(db, row);
}
export async function insertUsageAndUpdateClient(db, row) {
  return dbDriver(db) === 'mongo'
    ? mongo.insertUsageAndUpdateClient(db, row)
    : sqlite.insertUsageAndUpdateClient(db, row);
}
export async function countUsageSince(db, sinceIso) {
  return dbDriver(db) === 'mongo' ? mongo.countUsageSince(db, sinceIso) : sqlite.countUsageSince(db, sinceIso);
}
export async function countAllUsage(db) {
  return dbDriver(db) === 'mongo' ? mongo.countAllUsage(db) : sqlite.countAllUsage(db);
}
export async function usageSeriesSince(db, sinceIso) {
  return dbDriver(db) === 'mongo' ? mongo.usageSeriesSince(db, sinceIso) : sqlite.usageSeriesSince(db, sinceIso);
}
export async function perClientUsageSince(db, sinceIso) {
  return dbDriver(db) === 'mongo' ? mongo.perClientUsageSince(db, sinceIso) : sqlite.perClientUsageSince(db, sinceIso);
}
export async function topClientsSince(db, sinceIso, limit = 5) {
  return dbDriver(db) === 'mongo' ? mongo.topClientsSince(db, sinceIso, limit) : sqlite.topClientsSince(db, sinceIso, limit);
}
export async function listUsageLogs(db, options) {
  return dbDriver(db) === 'mongo' ? mongo.listUsageLogs(db, options) : sqlite.listUsageLogs(db, options);
}
export async function deleteUsageLogsBefore(db, isoDate) {
  return dbDriver(db) === 'mongo' ? mongo.deleteUsageLogsBefore(db, isoDate) : sqlite.deleteUsageLogsBefore(db, isoDate);
}
export async function countClientUsageSince(db, clientId, sinceIso) {
  return dbDriver(db) === 'mongo'
    ? mongo.countClientUsageSince(db, clientId, sinceIso)
    : sqlite.countClientUsageSince(db, clientId, sinceIso);
}
export async function clientCreditWindowSince(db, clientId, sinceIso) {
  return dbDriver(db) === 'mongo'
    ? mongo.clientCreditWindowSince(db, clientId, sinceIso)
    : sqlite.clientCreditWindowSince(db, clientId, sinceIso);
}
export async function clientCreditWindows(db, since5hIso, since7dIso) {
  return dbDriver(db) === 'mongo'
    ? mongo.clientCreditWindows(db, since5hIso, since7dIso)
    : sqlite.clientCreditWindows(db, since5hIso, since7dIso);
}
export async function clearTrialRequestQuotas(db) {
  return dbDriver(db) === 'mongo'
    ? mongo.clearTrialRequestQuotas(db)
    : sqlite.clearTrialRequestQuotas(db);
}
export async function clientUsageSeriesSince(db, clientId, sinceIso) {
  return dbDriver(db) === 'mongo'
    ? mongo.clientUsageSeriesSince(db, clientId, sinceIso)
    : sqlite.clientUsageSeriesSince(db, clientId, sinceIso);
}

/* ------------------------------- sessions ------------------------------- */
export async function insertAdminSession(db, tokenHash, createdAt, expiresAt) {
  return dbDriver(db) === 'mongo'
    ? mongo.insertAdminSession(db, tokenHash, createdAt, expiresAt)
    : sqlite.insertAdminSession(db, tokenHash, createdAt, expiresAt);
}
export async function getAdminSession(db, tokenHash) {
  return dbDriver(db) === 'mongo' ? mongo.getAdminSession(db, tokenHash) : sqlite.getAdminSession(db, tokenHash);
}
export async function deleteAdminSession(db, tokenHash) {
  return dbDriver(db) === 'mongo' ? mongo.deleteAdminSession(db, tokenHash) : sqlite.deleteAdminSession(db, tokenHash);
}
export async function deleteAllAdminSessions(db) {
  return dbDriver(db) === 'mongo' ? mongo.deleteAllAdminSessions(db) : sqlite.deleteAllAdminSessions(db);
}
export async function cleanupAdminSessions(db, nowIso) {
  return dbDriver(db) === 'mongo' ? mongo.cleanupAdminSessions(db, nowIso) : sqlite.cleanupAdminSessions(db, nowIso);
}
export async function insertPortalSession(db, tokenHash, clientId, createdAt, expiresAt) {
  return dbDriver(db) === 'mongo'
    ? mongo.insertPortalSession(db, tokenHash, clientId, createdAt, expiresAt)
    : sqlite.insertPortalSession(db, tokenHash, clientId, createdAt, expiresAt);
}
export async function getPortalSession(db, tokenHash) {
  return dbDriver(db) === 'mongo' ? mongo.getPortalSession(db, tokenHash) : sqlite.getPortalSession(db, tokenHash);
}
export async function deletePortalSession(db, tokenHash) {
  return dbDriver(db) === 'mongo' ? mongo.deletePortalSession(db, tokenHash) : sqlite.deletePortalSession(db, tokenHash);
}
export async function cleanupPortalSessions(db, nowIso) {
  return dbDriver(db) === 'mongo' ? mongo.cleanupPortalSessions(db, nowIso) : sqlite.cleanupPortalSessions(db, nowIso);
}

/* -------------------------------- audit --------------------------------- */
export async function recordAdminAudit(db, entry) {
  return dbDriver(db) === 'mongo' ? mongo.recordAdminAudit(db, entry) : sqlite.recordAdminAudit(db, entry);
}
export async function listAdminAudit(db, options) {
  return dbDriver(db) === 'mongo' ? mongo.listAdminAudit(db, options) : sqlite.listAdminAudit(db, options);
}


