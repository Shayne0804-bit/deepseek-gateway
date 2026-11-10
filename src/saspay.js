/**
 * Client SasPay minimal (server-side uniquement).
 * Base URL : https://api.saspay.me/api/v1
 */
import crypto from 'node:crypto';

const DEFAULT_BASE_URL = 'https://api.saspay.me/api/v1';

function baseUrl(config) {
  return String(config.saspayBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function saspayRequest(config, method, path, body = null) {
  if (!config.saspayApiKey) {
    const error = new Error('Paiement en ligne non configuré.');
    error.code = 'saspay_not_configured';
    error.status = 503;
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('saspay_timeout')), 20_000);
  try {
    const response = await fetch(`${baseUrl(config)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.saspayApiKey}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    if (!response.ok || payload.success === false) {
      const code = payload?.error?.code || `saspay_http_${response.status}`;
      const error = new Error(payload?.error?.message || `Erreur SasPay (${response.status}).`);
      error.code = code;
      error.status = response.status === 401 || response.status === 403 ? 502 : 502;
      throw error;
    }
    return payload.data;
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      const timeout = new Error('Le paiement en ligne ne répond pas. Réessayez.');
      timeout.code = 'saspay_timeout';
      timeout.status = 504;
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function createSaspayCheckout(config, payload) {
  return saspayRequest(config, 'POST', '/checkout-sessions/', payload);
}

export async function getSaspayCheckoutStatus(config, checkoutId) {
  return saspayRequest(config, 'GET', `/checkout-sessions/${encodeURIComponent(checkoutId)}/status/`);
}

export async function getSaspayPayment(config, paymentId) {
  return saspayRequest(config, 'GET', `/payments/${encodeURIComponent(paymentId)}/verify/`);
}

export function verifySaspayWebhook(rawBody, signature, timestamp, secret) {
  if (!secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const left = Buffer.from(String(signature || ''));
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
