/**
 * Chiffrement des secrets au repos (cle API DeepSeek saisie dans le panneau).
 *
 * - Cle maitre de 32 octets : variable MASTER_KEY (base64) ou fichier
 *   data/master.key genere automatiquement (droits 0600).
 * - Format : enc:v1:<iv base64>:<tag base64>:<chiffre base64> (AES-256-GCM).
 * - Une valeur non prefixee est consideree comme en clair (migration legacy).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'enc:v1:';
const keyCache = new Map();

function decodeKey(value) {
  try {
    const buffer = Buffer.from(String(value).trim(), 'base64');
    return buffer.length === 32 ? buffer : null;
  } catch {
    return null;
  }
}

/** Charge (ou cree) la cle maitre pour un dossier de donnees donne. */
export function getMasterKey(config) {
  if (config.masterKey) {
    const provided = decodeKey(config.masterKey);
    if (!provided) throw new Error('MASTER_KEY invalide : 32 octets en base64 attendus.');
    return provided;
  }
  const cacheKey = path.resolve(config.dataDir);
  if (keyCache.has(cacheKey)) return keyCache.get(cacheKey);

  const file = path.join(config.dataDir, 'master.key');
  let key;
  if (fs.existsSync(file)) {
    key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error(`Cle maitre invalide : ${file}`);
  } else {
    key = crypto.randomBytes(32);
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  }
  keyCache.set(cacheKey, key);
  return key;
}

export function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext, config) {
  const value = String(plaintext ?? '');
  if (!value) return '';
  if (isEncryptedSecret(value)) return value;
  const key = getMasterKey(config);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(value, config) {
  const text = String(value ?? '');
  if (!text) return '';
  if (!isEncryptedSecret(text)) return text; // legacy en clair
  const parts = text.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Secret chiffre dans un format inconnu.');
  }
  try {
    const iv = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const encrypted = Buffer.from(parts[4], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getMasterKey(config), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Impossible de dechiffrer le secret (cle maitre absente ou differente).');
  }
}

/** Vide le cache (tests / rotation de cle). */
export function resetMasterKeyCache() {
  keyCache.clear();
}
