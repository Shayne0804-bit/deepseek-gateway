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
/** Prefixe des jetons d'appareil emis apres approbation dans le portail. */
export const CLI_TOKEN_PREFIX = 'vlt_';

export function generateDerivedKey() {
  return DERIVED_KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

/** Jeton opaque d'appareil CLI. Seul son SHA-256 est stocke en base. */
export function generateCliToken() {
  return CLI_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
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

export async function createAdminSession(db, ttlMs, now = new Date()) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  await cleanupAdminSessions(db, now.toISOString());
  await insertAdminSession(db, sha256(token), now.toISOString(), expiresAt);
  return { token, expiresAt };
}

export async function validateAdminSession(db, token, now = new Date()) {
  if (!token) return null;
  const row = await getAdminSession(db, sha256(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    await deleteAdminSession(db, sha256(token));
    return null;
  }
  return row;
}

export async function destroyAdminSession(db, token) {
  if (token) await deleteAdminSession(db, sha256(token));
}

export async function destroyAllAdminSessions(db) {
  await deleteAllAdminSessions(db);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
  const clean = String(input ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Verifie un code TOTP (RFC 6238, SHA-1, 30 s, tolerance +/- 1 pas). */
export function verifyTotp(secret, code, now = Date.now()) {
  const expected = String(code ?? '').replace(/\s/g, '');
  if (!secret) return true;
  if (!/^\d{6}$/.test(expected)) return false;
  const key = base32Decode(secret);
  if (!key.length) return false;
  const counter = Math.floor(now / 1000 / 30);
  for (let offset = -1; offset <= 1; offset += 1) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(counter + offset));
    const digest = crypto.createHmac('sha1', key).update(buffer).digest();
    const position = digest[digest.length - 1] & 0x0f;
    const value = ((digest[position] & 0x7f) << 24)
      | ((digest[position + 1] & 0xff) << 16)
      | ((digest[position + 2] & 0xff) << 8)
      | (digest[position + 3] & 0xff);
    const candidate = String(value % 1_000_000).padStart(6, '0');
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))) return true;
  }
  return false;
}
