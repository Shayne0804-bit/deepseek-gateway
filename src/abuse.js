/**
 * Anti-abus pour l'inscription autonome.
 *
 * - domaines d'emails jetables (liste locale + domaines ajoutes par l'admin) ;
 * - empreinte d'appareil (identifiant localStorage + en-tetes navigateur) ;
 * - verification optionnelle d'IP (VPN / proxy / hebergement) via un service
 *   externe configure par l'admin. Aucun appel reseau si IP_INTEL_ENABLED=0.
 */
import crypto from 'node:crypto';

/** Domaines jetables courants (correspondance exacte ou sous-domaine). */
export const DEFAULT_DISPOSABLE_DOMAINS = Object.freeze([
  '10minutemail.com', '10minutemail.net', '20minutemail.com', '33mail.com',
  'anonbox.net', 'burnermail.io', 'dispostable.com', 'dropmail.me',
  'emailondeck.com', 'fakeinbox.com', 'fakemail.net', 'getairmail.com',
  'getnada.com', 'grr.la', 'guerrillamail.biz', 'guerrillamail.com',
  'guerrillamail.de', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamailblock.com', 'inboxkitten.com', 'linshiyouxiang.net',
  'mail.tm', 'mail.gw', 'mailcatch.com', 'maildrop.cc', 'mailinator.com',
  'mailinator.net', 'mailnesia.com', 'mailnull.com', 'mailsac.com',
  'mintemail.com', 'mohmal.com', 'mytemp.email', 'nada.email',
  'sharklasers.com', 'spam4.me', 'spambog.com', 'spamgourmet.com',
  'temp-mail.io', 'temp-mail.org', 'tempail.com', 'tempboxa.com',
  'tempemail.net', 'tempmail.dev', 'tempmail.email', 'tempmailo.com',
  'tempr.email', 'throwawaymail.com', 'trashmail.com', 'trashmail.de',
  'trashmail.net', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'zehnminutenmail.de',
]);

export function normalizeDomain(domain) {
  return String(domain ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

export function emailDomain(email) {
  const at = String(email ?? '').lastIndexOf('@');
  return at >= 0 ? normalizeDomain(String(email).slice(at + 1)) : '';
}

/**
 * Un email est jetable si son domaine est dans la liste ou en est un sous-domaine.
 * Les domaines ajoutes par l'admin (BLOCKED_EMAIL_DOMAINS) sont fusionnes.
 */
export function isDisposableEmail(email, extraDomains = []) {
  const domain = emailDomain(email);
  if (!domain) return false;
  const blocked = new Set([
    ...DEFAULT_DISPOSABLE_DOMAINS.map(normalizeDomain),
    ...extraDomains.map(normalizeDomain).filter(Boolean),
  ]);
  for (const entry of blocked) {
    if (domain === entry || domain.endsWith(`.${entry}`)) return true;
  }
  return false;
}

/** Empreinte non reversible d'un appareil (identifiant client + en-tetes). */
export function deviceHashFor(deviceId, req) {
  const ua = String(req?.headers?.['user-agent'] ?? '');
  const lang = String(req?.headers?.['accept-language'] ?? '');
  const ch = String(req?.headers?.['sec-ch-ua'] ?? '');
  const raw = deviceId
    ? `id:${String(deviceId).slice(0, 200)}`
    : `ua:${ua}|lang:${lang}|ch:${ch}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Interroge un service d'intelligence IP pour detecter VPN/proxy/Tor/hebergement.
 * Retourne null si desactive. Leve une erreur si le service repond mal.
 */
export async function lookupIpReputation(ip, { url, timeoutMs = 2500 }) {
  if (!url || !ip) return null;
  const target = String(url).replaceAll('{ip}', encodeURIComponent(ip));
  const response = await fetch(target, {
    signal: AbortSignal.timeout(Math.max(500, Math.min(10_000, timeoutMs))),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`service IP HTTP ${response.status}`);
  const data = await response.json();
  const vpn = Boolean(
    data.proxy || data.vpn || data.tor || data.hosting || data.is_vpn || data.is_proxy,
  );
  return { vpn, data };
}
