/**
 * Configuration locale VALARIA Code.
 * Aucune clé API complète n'est stockée : uniquement le jeton d'appareil
 * émis après approbation dans le portail. Fichier 0600.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_BASE_URL = process.env.VALARIA_GATEWAY_URL || 'https://api.valariamenu.com';
export const DEFAULT_MODEL = 'gpt-5';
export const DEFAULT_LAYOUT = 'focus';
export const LAYOUTS = ['focus', 'studio', 'compact'];

export function homeDir() {
  return path.resolve(process.env.VALARIA_HOME || path.join(os.homedir(), '.valaria'));
}

export function configFile() {
  return path.join(homeDir(), 'code.json');
}

export function normalizeBaseUrl(raw) {
  let value = String(raw || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  value = value.replace(/\/(v1|anthropic|portal)$/i, '');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  return value;
}

export function loadConfig() {
  const file = configFile();
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    return {
      url: normalizeBaseUrl(data.url),
      token: typeof data.token === 'string' ? data.token : null,
      tokenExpiresAt: data.tokenExpiresAt || null,
      deviceName: data.deviceName || 'VALARIA Code',
      clientName: data.clientName || null,
      model: data.model || DEFAULT_MODEL,
      layout: LAYOUTS.includes(data.layout) ? data.layout : DEFAULT_LAYOUT,
    };
  } catch {
    return null;
  }
}

export function saveConfig(config) {
  const dir = homeDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = configFile();
  const payload = {
    url: normalizeBaseUrl(config.url),
    token: config.token,
    tokenExpiresAt: config.tokenExpiresAt || null,
    deviceName: config.deviceName || 'VALARIA Code',
    clientName: config.clientName || null,
    model: config.model || DEFAULT_MODEL,
    layout: LAYOUTS.includes(config.layout) ? config.layout : DEFAULT_LAYOUT,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  return file;
}

export function clearConfig() {
  try { fs.unlinkSync(configFile()); } catch { /* absent */ }
}

export function resolveAuthConfig(options = {}) {
  const stored = loadConfig();
  const url = normalizeBaseUrl(options.url || stored?.url || DEFAULT_BASE_URL);
  const envToken = String(process.env.VALARIA_API_KEY || '').trim();
  const token = options.token || envToken || stored?.token || null;
  return {
    url,
    token,
    tokenSource: options.token ? 'option' : envToken ? 'env' : stored?.token ? 'config' : null,
    config: stored,
    model: options.model || stored?.model || DEFAULT_MODEL,
    layout: LAYOUTS.includes(options.layout) ? options.layout : (stored?.layout || DEFAULT_LAYOUT),
  };
}
