import crypto from 'node:crypto';
import {
  cleanupAdminSessions,
  deleteAdminSession,
  deleteAllAdminSessions,
  getAdminSession,
  insertAdminSession,
} from './db.js';

/** Prefixe des cles derivees : compatible avec les clients qui attendent un prefixe "sk-". */
export const DERIVED_KEY_PREFIX = 'sk-dsk-';

export function generateDerivedKey() {
  return DERIVED_KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey), 'utf8').digest('hex');
}

export function displayKeyPrefix(apiKey) {
  // sk-dsk-abcde… : assez pour identifier la cle, pas assez pour l'utiliser.
  return `${apiKey.slice(0, DERIVED_KEY_PREFIX.length + 5)}…`;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/* ------------------------------- password ------------------------------- */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
    const n = Number.parseInt(parts[1], 10);
    const salt = Buffer.from(parts[2], 'base64');
    const expected = Buffer.from(parts[3], 'base64');
    if (!Number.isFinite(n) || !salt.length || !expected.length) return false;
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: n,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Mot de passe aleatoire lisible (16 caracteres). */
export function generateAdminPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

/* ------------------------------- sessions ------------------------------- */

export function createAdminSession(db, ttlMs, now = new Date()) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  cleanupAdminSessions(db, now.toISOString());
  insertAdminSession(db, sha256(token), now.toISOString(), expiresAt);
  return { token, expiresAt };
}

export function validateAdminSession(db, token, now = new Date()) {
  if (!token) return null;
  const row = getAdminSession(db, sha256(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    deleteAdminSession(db, sha256(token));
    return null;
  }
  return row;
}

export function destroyAdminSession(db, token) {
  if (token) deleteAdminSession(db, sha256(token));
}

export function destroyAllAdminSessions(db) {
  deleteAllAdminSessions(db);
}
