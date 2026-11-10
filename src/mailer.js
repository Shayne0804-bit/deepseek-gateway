/**
 * Envoi d'emails transactionnels sans dependance npm.
 *
 * Transports :
 * - `console` (dev)  : affiche le code dans les logs du serveur ;
 * - `resend`         : API HTTPS Resend (recommande avec un domaine verifie) ;
 * - `smtp`           : SMTP implicite TLS (smtps://…:465, ex. Gmail mot de passe
 *                      d'application ou Google Workspace) ou STARTTLS (587).
 *
 * Le contenu ne contient jamais de secret : uniquement le code OTP et sa duree.
 */
import tls from 'node:tls';

const TIMEOUT_MS = 20_000;

/* ------------------------------- message -------------------------------- */

function encodeHeader(value) {
  const text = String(value ?? '');
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function wrapBase64(text) {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');
}

export function buildPortalCodeEmail({ to, code, minutes, from, fromName }) {
  const subject = `Votre code de connexion : ${code}`;
  const text = [
    'Code de connexion à votre espace VALARIA Gateway API',
    '',
    `Code : ${code}`,
    `Valable ${minutes} minutes, à usage unique.`,
    '',
    'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail :',
    'sans ce code, personne ne peut ouvrir votre espace.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:24px;background:#040705;color:#d6f7df;font-family:ui-monospace,Consolas,monospace">
  <div style="max-width:520px;margin:0 auto;border:1px solid #1f4a30;background:#07110b;padding:24px">
    <p style="margin:0 0 6px;color:#3ee97f;font-size:12px">&gt;_ VALARIA Gateway API</p>
    <h1 style="margin:0 0 16px;font-size:20px">Code de connexion</h1>
    <p style="margin:0 0 18px;line-height:1.6">Saisissez ce code dans votre espace pour vous connecter.</p>
    <p style="margin:0 0 18px;font-size:32px;letter-spacing:8px;color:#3ee97f;font-weight:700">${code}</p>
    <p style="margin:0 0 8px;line-height:1.6;color:#a8d8b8">Valable <strong>${minutes} minutes</strong>, à usage unique.</p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#5d8769">Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : sans ce code, personne ne peut ouvrir votre espace.</p>
  </div>
</body></html>`;

  const fromHeader = fromName ? `${encodeHeader(fromName)} <${from}>` : `<${from}>`;
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@valaria-gateway>`;
  const body = [
    `From: ${fromHeader}`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="dsg-otp-boundary"',
    '',
    '--dsg-otp-boundary',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(text),
    '--dsg-otp-boundary',
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(html),
    '--dsg-otp-boundary--',
    '',
  ].join('\r\n');
  return { subject, text, html, message: body, fromHeader };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/** Reçu de paiement d'un pass, envoye une seule fois apres confirmation. */
export function buildPaymentReceiptEmail({ to, receipt, from, fromName }) {
  const amount = `${receipt.amount} ${receipt.currency}`;
  const subject = `Reçu de paiement — ${receipt.planName}`;
  const text = [
    `Merci ${receipt.customerName || ''},`,
    '',
    'Votre paiement a été confirmé et votre pass est activé.',
    '',
    `Reçu : ${receipt.orderId}`,
    `Pass : ${receipt.planName}`,
    `Montant payé : ${amount}`,
    `Date de paiement : ${receipt.paidAt}`,
    `Fin du pass : ${receipt.expiresAt}`,
    `Crédit site : ${receipt.quotaUsd} $`,
    receipt.credit5h ? `Plafond 5 h : ${receipt.credit5h} $` : null,
    receipt.creditWeek ? `Plafond semaine : ${receipt.creditWeek} $` : null,
    '',
    'Ce reçu est généré automatiquement par VALARIA Gateway API.',
  ].filter(Boolean).join('\n');
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#040705;color:#d6f7df;font-family:ui-monospace,Consolas,monospace">
  <div style="max-width:540px;margin:0 auto;border:1px solid #1f4a30;background:#07110b;padding:24px">
    <p style="margin:0 0 6px;color:#3ee97f;font-size:12px">&gt;_ VALARIA Gateway API</p>
    <h1 style="margin:0 0 16px;font-size:20px">Reçu de paiement</h1>
    <p style="margin:0 0 18px;line-height:1.6">Votre paiement a été confirmé et votre pass est activé.</p>
    <p style="margin:0 0 14px;font-size:18px;color:#3ee97f"><strong>${escapeHtml(receipt.planName)}</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.7">
      <tr><td style="color:#8ab89a;padding:4px 0">Reçu</td><td style="text-align:right">${escapeHtml(receipt.orderId)}</td></tr>
      <tr><td style="color:#8ab89a;padding:4px 0">Montant payé</td><td style="text-align:right"><strong>${escapeHtml(amount)}</strong></td></tr>
      <tr><td style="color:#8ab89a;padding:4px 0">Date</td><td style="text-align:right">${escapeHtml(receipt.paidAt)}</td></tr>
      <tr><td style="color:#8ab89a;padding:4px 0">Fin du pass</td><td style="text-align:right">${escapeHtml(receipt.expiresAt)}</td></tr>
      <tr><td style="color:#8ab89a;padding:4px 0">Crédit site</td><td style="text-align:right">${escapeHtml(receipt.quotaUsd)} $</td></tr>
      ${receipt.credit5h ? `<tr><td style="color:#8ab89a;padding:4px 0">Plafond 5 h</td><td style="text-align:right">${escapeHtml(receipt.credit5h)} $</td></tr>` : ''}
      ${receipt.creditWeek ? `<tr><td style="color:#8ab89a;padding:4px 0">Plafond semaine</td><td style="text-align:right">${escapeHtml(receipt.creditWeek)} $</td></tr>` : ''}
    </table>
    <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#5d8769">Ce reçu est généré automatiquement par VALARIA Gateway API.</p>
  </div>
</body></html>`;
  const fromHeader = fromName ? `${encodeHeader(fromName)} <${from}>` : `<${from}>`;
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@valaria-gateway>`;
  const message = [
    `From: ${fromHeader}`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="dsg-receipt-boundary"',
    '',
    '--dsg-receipt-boundary',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(text),
    '--dsg-receipt-boundary',
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(html),
    '--dsg-receipt-boundary--',
    '',
  ].join('\r\n');
  return { subject, text, html, message, fromHeader };
}

/* ----------------------------------------------------------------- SMTP -- */
class SmtpSession {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.lines = [];
    this.waiters = [];
    this.closed = false;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      let index;
      while ((index = this.buffer.indexOf('\r\n')) >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        this.lines.push(line);
        this.flush();
      }
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('Connexion SMTP fermée.')));
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) this.waiters.shift().reject(error);
  }

  flush() {
    if (!this.waiters.length) return;
    // Une reponse SMTP complete : au moins une ligne, derniere ligne "250 " (avec espace),
    // les continuations etant "250-".
    const endIndex = this.lines.findIndex((line) => /^\d{3}(?: |$)/.test(line) && !/^\d{3}-/.test(line));
    if (endIndex < 0) return;
    const response = { code: Number(this.lines[0].slice(0, 3)), lines: this.lines.slice(0, endIndex + 1) };
    this.lines = this.lines.slice(endIndex + 1);
    const waiter = this.waiters.shift();
    waiter.resolve(response);
    this.flush();
  }

  read() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.reject !== reject);
        reject(new Error('Délai SMTP dépassé.'));
      }, TIMEOUT_MS);
      this.waiters.push({
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.flush();
    });
  }

  async command(line) {
    if (this.socket.destroyed) throw new Error('Connexion SMTP interrompue.');
    this.socket.write(`${line}\r\n`);
    return this.read();
  }

  expect(response, allowed, label) {
    if (!allowed.includes(response.code)) {
      throw new Error(`${label} : reponse SMTP ${response.code}.`);
    }
    return response;
  }

  async authenticate(user, pass) {
    const auth = await this.command('AUTH LOGIN');
    this.expect(auth, [334], 'AUTH LOGIN');
    this.expect(await this.command(Buffer.from(user, 'utf8').toString('base64')), [334], 'AUTH utilisateur');
    this.expect(await this.command(Buffer.from(pass, 'utf8').toString('base64')), [235], 'AUTH mot de passe');
  }

  async sendMail({ from, to, message }) {
    this.expect(await this.command(`MAIL FROM:<${from}>`), [250], 'MAIL FROM');
    this.expect(await this.command(`RCPT TO:<${to}>`), [250, 251], 'RCPT TO');
    this.expect(await this.command('DATA'), [354], 'DATA');
    const body = message.replace(/\r\n\./g, '\r\n..').replace(/\n\./g, '\n..');
    this.socket.write(body);
    if (!body.endsWith('\r\n')) this.socket.write('\r\n');
    this.socket.write('.\r\n');
    this.expect(await this.read(), [250], 'Envoi du message');
  }

  async quit() {
    try { await this.command('QUIT'); } catch { /* ignore */ }
    this.socket.destroy();
  }
}

export function parseSmtpUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('SMTP_URL invalide.');
  }
  if (!['smtp:', 'smtps:'].includes(url.protocol)) {
    throw new Error('SMTP_URL doit commencer par smtp:// ou smtps://.');
  }
  const secure = url.protocol === 'smtps:';
  const port = Number(url.port) || (secure ? 465 : 587);
  const user = decodeURIComponent(url.username || '');
  const pass = decodeURIComponent(url.password || '');
  return { host: url.hostname, port, secure, user, pass };
}

async function smtpSend({ smtpUrl, from, to, message }) {
  const { host, port, secure, user, pass } = parseSmtpUrl(smtpUrl);
  if (!secure) {
    // Pas de STARTTLS maison : on exige une connexion TLS implicite (smtps://, port 465).
    throw new Error('SMTP non chiffré refusé : utilisez smtps://…:465 (TLS implicite).');
  }
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host }, () => {
      (async () => {
        const session = new SmtpSession(socket);
        try {
          session.expect(await session.read(), [220], 'Bannière SMTP');
          session.expect(await session.command('EHLO valaria-gateway'), [250], 'EHLO');
          if (user) await session.authenticate(user, pass);
          await session.sendMail({ from, to, message });
          await session.quit();
          resolve({ ok: true });
        } catch (error) {
          try { socket.destroy(); } catch { /* ignore */ }
          reject(error);
        }
      })();
    });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('Délai SMTP dépassé.')));
  });
}

/* ------------------------------- mailer --------------------------------- */

export function createMailer(config, log) {
  const transport = config.mailTransport || 'disabled';
  const from = config.mailFrom || '';
  const fromName = config.mailFromName || 'VALARIA Gateway API';
  const enabled = Boolean(config.emailLoginEnabled);

  async function deliverEmail(email, to) {
    if (transport === 'smtp') {
      return smtpSend({ smtpUrl: config.smtpUrl, from, to, message: email.message, fromName });
    }
    if (transport === 'resend') {
      const response = await fetch(`${config.resendApiBase}/emails`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.resendApiKey}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(Math.max(3000, Number(config.mailTimeoutMs) || 15000)),
        body: JSON.stringify({
          from: fromName ? `${fromName} <${from}>` : from,
          to: [to],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Resend HTTP ${response.status} ${detail.slice(0, 120)}`);
      }
      return { ok: true, transport };
    }
    throw new Error('Aucun transport email configuré.');
  }

  async function sendPortalCode({ to, code, minutes }) {
    if (transport === 'console') {
      log.warn(`[email:dev] Code de connexion pour ${to} : ${code} (valable ${minutes} min)`);
      return { ok: true, transport };
    }
    const email = buildPortalCodeEmail({ to, code, minutes, from, fromName });
    return deliverEmail(email, to);
  }

  async function sendPaymentReceipt({ to, receipt }) {
    if (transport === 'console') {
      log.warn(`[email:dev] Reçu ${receipt.orderId} pour ${to} : ${receipt.amount} ${receipt.currency} (${receipt.planName}).`);
      return { ok: true, transport };
    }
    const email = buildPaymentReceiptEmail({ to, receipt, from, fromName });
    return deliverEmail(email, to);
  }

  return {
    enabled,
    transport,
    from,
    sendPortalCode,
    sendPaymentReceipt,
  };
}

