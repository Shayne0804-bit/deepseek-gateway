/**
 * Verifications de fraude (services externes, optionnels).
 *
 * - Cloudflare Turnstile : verification anti-bot cote serveur.
 * - IPQualityScore : reputation IP (VPN/proxy/Tor/hebergement, score de fraude)
 *   et validation d'email (jetable, invalide, delivrabilite) selon le plan.
 *
 * Fail-closed par defaut : si le service est configure mais indisponible,
 * l'inscription est refusee plutot que laissee passer.
 */

const DEFAULT_TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DEFAULT_IPQS_BASE = 'https://ipqualityscore.com/api/json';

function timeoutSignal(ms) {
  return AbortSignal.timeout(Math.max(500, Math.min(15_000, Number(ms) || 5000)));
}

/** Verifie un token Turnstile. Retourne { ok, configured, errors }. */
export async function verifyTurnstile(token, ip, config, fetchImpl = fetch) {
  if (!config?.turnstileSecretKey) return { ok: true, configured: false, errors: [] };
  if (!token) return { ok: false, configured: true, errors: ['missing-token'] };
  const body = new URLSearchParams({
    secret: config.turnstileSecretKey,
    response: String(token),
  });
  if (ip) body.set('remoteip', String(ip));
  const response = await fetchImpl(config.turnstileVerifyUrl || DEFAULT_TURNSTILE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: timeoutSignal(config.turnstileTimeoutMs || 5000),
  });
  if (!response.ok) throw new Error(`Turnstile HTTP ${response.status}`);
  const data = await response.json();
  return {
    ok: Boolean(data.success),
    configured: true,
    errors: Array.isArray(data['error-codes']) ? data['error-codes'] : [],
    data,
  };
}

/** Reputation d'une IP via IPQualityScore. */
export async function lookupIpqsIp(ip, config, fetchImpl = fetch) {
  if (!config?.ipqsApiKey || !config?.fraudCheckEnabled) return { configured: false, blocked: false };
  const base = config.ipqsApiBase || DEFAULT_IPQS_BASE;
  const url = `${base}/ip/${encodeURIComponent(config.ipqsApiKey)}/${encodeURIComponent(ip)}?strictness=1`;
  const response = await fetchImpl(url, { signal: timeoutSignal(config.fraudTimeoutMs || 5000) });
  if (!response.ok) throw new Error(`IPQS IP HTTP ${response.status}`);
  const data = await response.json();
  if (data.success === false) {
    throw new Error(`IPQS IP: ${data.message || data.error || 'reponse invalide'}`);
  }
  const score = Number(data.fraud_score) || 0;
  const vpn = Boolean(data.proxy || data.vpn || data.tor || data.active_vpn || data.active_tor);
  const hosting = Boolean(data.hosting);
  const reasons = [];
  if (score >= config.ipqsMinFraudScore) reasons.push(`score ${score}`);
  if (config.ipqsBlockVpn && vpn) reasons.push('VPN/proxy/Tor');
  if (config.ipqsBlockHosting && hosting) reasons.push('hébergement/datacenter');
  return {
    configured: true,
    blocked: reasons.length > 0,
    score,
    vpn,
    hosting,
    reasons,
    details: data,
  };
}

/** Validation d'un email via IPQualityScore (si le plan le permet). */
export async function lookupIpqsEmail(email, config, fetchImpl = fetch) {
  if (!config?.ipqsApiKey || !config?.emailValidationEnabled) return { configured: false, blocked: false };
  const base = config.ipqsApiBase || DEFAULT_IPQS_BASE;
  const url = `${base}/email/${encodeURIComponent(config.ipqsApiKey)}/${encodeURIComponent(email)}?strictness=1`;
  const response = await fetchImpl(url, { signal: timeoutSignal(config.fraudTimeoutMs || 5000) });
  if (!response.ok) throw new Error(`IPQS email HTTP ${response.status}`);
  const data = await response.json();
  if (data.success === false) {
    throw new Error(`IPQS email: ${data.message || data.error || 'reponse invalide'}`);
  }
  const score = Number(data.fraud_score) || 0;
  const deliverability = String(data.deliverability || '').toLowerCase();
  const reasons = [];
  if (data.disposable) reasons.push('email jetable');
  if (data.valid === false) reasons.push('email invalide');
  if (deliverability === 'undeliverable') reasons.push('email non délivrable');
  if (score >= config.ipqsMinFraudScore) reasons.push(`score ${score}`);
  return {
    configured: true,
    blocked: reasons.length > 0,
    score,
    deliverability,
    reasons,
    details: data,
  };
}
