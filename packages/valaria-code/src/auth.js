/**
 * Device authorization flow pour VALARIA Code.
 *
 * 1. le CLI demande un code au portail ;
 * 2. l'utilisateur se connecte au site et approuve l'appareil ;
 * 3. le CLI récupère un jeton révocable et le stocke en 0600.
 */
import { spawn } from 'node:child_process';
import { normalizeBaseUrl } from './config.js';

export class AuthError extends Error {
  constructor(message, code = 'auth_error') {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;
  if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function jsonRequest(url, options, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) {
    const message = data?.error?.message || `Erreur HTTP ${response.status}`;
    throw new AuthError(message, data?.error?.code || `http_${response.status}`);
  }
  return { response, data };
}

/**
 * Lance le device flow et retourne { token, tokenExpiresAt, deviceName }.
 * onCode est appelé dès que le code utilisateur est disponible.
 */
export async function loginWithDevice({
  url,
  deviceName = 'VALARIA Code',
  open = true,
  onCode = null,
  pollMs = 5000,
  timeoutMs = 10 * 60 * 1000,
  fetchImpl = fetch,
} = {}) {
  const base = normalizeBaseUrl(url);
  const request = (pathname, options) => jsonRequest(`${base}${pathname}`, options, fetchImpl);
  const started = await request('/portal/api/device/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ deviceName }),
  });
  const device = started.data;
  if (!device?.device_code || !device?.user_code) {
    throw new AuthError('Réponse de connexion d’appareil invalide.', 'invalid_device_response');
  }
  if (onCode) onCode(device);
  if (open) openBrowser(device.verification_uri_complete || device.verification_uri);

  const interval = Math.max(1, Number(device.interval) || 5);
  const deadline = Date.now() + Math.min(timeoutMs, (Number(device.expires_in) || 600) * 1000);
  while (Date.now() < deadline) {
    await sleep(pollMs || interval * 1000);
    let result;
    try {
      result = await request('/portal/api/device/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ device_code: device.device_code }),
      });
    } catch (error) {
      if (error.code === 'authorization_pending') continue;
      throw error;
    }
    if (result.response.status === 202 || result.data.status === 'pending') continue;
    if (result.data.token) {
      return {
        token: result.data.token,
        tokenExpiresAt: result.data.expires_at || null,
        deviceName: result.data.device_name || deviceName,
        url: base,
      };
    }
    throw new AuthError('Réponse de jeton invalide.', 'invalid_token_response');
  }
  throw new AuthError('Délai dépassé : l’appareil n’a pas été approuvé.', 'device_timeout');
}

export function tokenIsExpired(config) {
  if (!config?.tokenExpiresAt) return false;
  return new Date(config.tokenExpiresAt).getTime() <= Date.now();
}
