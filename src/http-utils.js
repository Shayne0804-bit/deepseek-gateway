/** Petites aides HTTP partagees (reponses JSON, lecture du corps, cookies, erreurs). */

export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function sendJson(res, status, payload, extraHeaders = {}) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

/** Erreur au format OpenAI : { error: { message, type, code } }. */
export function sendApiError(res, status, message, type = 'invalid_request_error', code = null, extraHeaders = {}) {
  sendJson(res, status, { error: { message, type, code, param: null } }, extraHeaders);
}

export function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, x-api-key, content-type, x-requested-with',
    'access-control-expose-headers':
      'x-quota-tokens-remaining, x-quota-requests-remaining, x-quota-usd-remaining, x-quota-tokens-limit, x-quota-requests-limit, x-quota-period, x-gateway-requested-model, x-gateway-billed-model',
    'access-control-max-age': '86400',
  };
}

/** Taille lisible : 4194304 -> « 4 Mo », Infinity -> « illimitee ». */
export function formatByteSize(bytes) {
  if (!Number.isFinite(bytes)) return 'illimitee';
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} Mo`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${bytes} octets`;
}

function payloadTooLarge(limitBytes, receivedBytes, hint) {
  const detail = receivedBytes == null
    ? `limite ${formatByteSize(limitBytes)}`
    : `${formatByteSize(receivedBytes)} recus, limite ${formatByteSize(limitBytes)}`;
  const suffix = hint ? ` ${hint}` : '';
  return new HttpError(413, `Corps de requete trop volumineux (${detail}).${suffix}`, 'payload_too_large');
}

export function readBody(req, limitBytes = Number.POSITIVE_INFINITY, hint = '') {
  const limit = Number.isFinite(limitBytes) ? limitBytes : Number.POSITIVE_INFINITY;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;

    const finish = (err, value) => {
      if (done) return;
      done = true;
      if (err) reject(err);
      else resolve(value);
    };

    // Rejet immediat si le client annonce deja un corps trop gros (Content-Length).
    const declaredLength = Number.parseInt(String(req.headers['content-length'] ?? ''), 10);
    if (Number.isFinite(limit) && Number.isFinite(declaredLength) && declaredLength > limit) {
      req.resume();
      finish(payloadTooLarge(limit, declaredLength, hint));
      return;
    }

    req.on('data', (chunk) => {
      if (done) {
        req.resume();
        return;
      }
      size += chunk.length;
      if (size > limit) {
        finish(payloadTooLarge(limit, null, hint));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => finish(new HttpError(400, `Lecture de la requete impossible : ${err.message}`, 'bad_request')));
  });
}

export async function readJsonBody(req, limitBytes = 1024 * 1024) {
  const raw = await readBody(req, limitBytes);
  if (!raw || !raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Corps JSON invalide.', 'invalid_json');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Le corps JSON doit etre un objet.', 'invalid_json');
  }
  return parsed;
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite ?? 'Strict'}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function isHttpsRequest(req, trustProxy = false) {
  if (trustProxy) {
    const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
    if (proto === 'https') return true;
  }
  return Boolean(req.socket?.encrypted);
}

export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

export function bearerToken(req) {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : null;
}

export function hostHeader(req) {
  return String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
}

export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // clients non-navigateur (curl, SDK)
  try {
    return new URL(origin).host === hostHeader(req);
  } catch {
    return false;
  }
}

/** Securite de base appliquee a toutes les reponses du panneau. */
export function applySecurityHeaders(res, { https = false } = {}) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (https) {
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader(
    'content-security-policy',
    [
      "default-src 'self'",
      "script-src 'self' https://challenges.cloudflare.com https://js.hcaptcha.com https://hcaptcha.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com",
      "frame-src https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      https ? 'upgrade-insecure-requests' : '',
    ]
      .filter(Boolean)
      .join('; '),
  );
}
