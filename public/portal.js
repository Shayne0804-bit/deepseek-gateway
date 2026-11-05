/* Espace utilisateur VALARIA Gateway API — session par clé dérivée. */
(() => {
  'use strict';

  const CSRF_HEADER = 'x-requested-with';
  const CSRF_VALUE = 'dsk-portal';
  const PERIOD_LABELS = { daily: 'par jour', monthly: 'par mois', total: 'cumul' };
  const NF = new Intl.NumberFormat('fr-FR');
  const DATE_SHORT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });

  const $ = (selector) => document.querySelector(selector);
  const state = { me: null, busy: false, emailBusy: false, newKey: null };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  const fmtInt = (value) => NF.format(Number(value) || 0);
  const fmtUsd = (value) => `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(value) || 0)} $`;
  const fmtCompact = (value) => {
    const n = Number(value) || 0;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)} M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)} k`;
    return NF.format(n);
  };
  const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : DATE_SHORT.format(d); };

  async function api(path, options = {}) {
    const res = await fetch(`/portal/api${path}`, {
      method: options.method || 'GET',
      headers: { [CSRF_HEADER]: CSRF_VALUE, ...(options.body ? { 'content-type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!res.ok) {
      const error = new Error(data?.error?.message || `Erreur HTTP ${res.status}`);
      error.status = res.status;
      error.code = data?.error?.code;
      error.retryAfterSeconds = data?.retry_after_seconds ?? data?.error?.retry_after_seconds;
      error.sendsInWindow = data?.sends_in_window;
      error.maxSends = data?.max_sends;
      throw error;
    }
    return data;
  }

  /** Identifiant d'appareil persistant (localStorage), non secret. */
  const DEVICE_ID = (() => {
    try {
      const key = 'valaria_device_id';
      let id = localStorage.getItem(key);
      if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(key, id);
      }
      return id;
    } catch {
      return null;
    }
  })();

  function deviceFields() {
    return DEVICE_ID ? { deviceId: DEVICE_ID } : {};
  }

  /* ---------------- Cloudflare Turnstile (anti-bot) ---------------- */
  const turnstile = { siteKey: null, widgets: {}, tokens: {}, loading: null };

  function ensureTurnstileSlot(kind) {
    const panel = $(kind === 'email' ? '#panel-email' : '#panel-signup');
    if (!panel) return null;
    let slot = panel.querySelector(`#${kind}-turnstile`);
    if (!slot) {
      slot = document.createElement('div');
      slot.id = `${kind}-turnstile`;
      slot.className = 'turnstile-slot';
      const error = panel.querySelector('.login-error');
      if (error) error.after(slot);
      else panel.prepend(slot);
    }
    return slot;
  }

  function loadTurnstileScript() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstile.loading) return turnstile.loading;
    turnstile.loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => reject(new Error('Impossible de charger la vérification anti-bot.'));
      document.head.appendChild(script);
    });
    return turnstile.loading;
  }

  async function initTurnstile(siteKey) {
    turnstile.siteKey = siteKey || null;
    if (!siteKey) return;
    try {
      await loadTurnstileScript();
      for (const kind of ['email', 'signup']) {
        const slot = ensureTurnstileSlot(kind);
        slot.classList.remove('hidden');
        slot.innerHTML = '';
        if (window.turnstile) {
          turnstile.widgets[kind] = window.turnstile.render(slot, {
            sitekey: siteKey,
            callback: (token) => { turnstile.tokens[kind] = token; },
            'expired-callback': () => { turnstile.tokens[kind] = null; },
            'error-callback': () => { turnstile.tokens[kind] = null; },
          });
        }
      }
    } catch (err) {
      turnstile.tokens.email = null;
      turnstile.tokens.signup = null;
      const message = err?.message || 'Vérification anti-bot indisponible.';
      showEmailError(message);
      showSignupError(message);
    }
  }

  function resetTurnstile(kind) {
    turnstile.tokens[kind] = null;
    try {
      if (window.turnstile && turnstile.widgets[kind] != null) {
        window.turnstile.reset(turnstile.widgets[kind]);
      }
    } catch {
      /* ignore */
    }
  }

  const resendTimers = { email: null, signup: null };

  function stopResendTimer(kind) {
    if (resendTimers[kind]) {
      clearInterval(resendTimers[kind]);
      resendTimers[kind] = null;
    }
  }

  /** Affiche un decompte de renvoi et grise le bouton pendant l'attente. */
  function startResendCountdown(kind, seconds, info = {}) {
    stopResendTimer(kind);
    const isEmail = kind === 'email';
    const button = $(isEmail ? '#email-resend' : '#signup-resend');
    const status = $(isEmail ? '#email-resend-status' : '#signup-resend-status');
    let remaining = Math.max(0, Math.ceil(Number(seconds) || 0));
    const count = Number(info.count) || 0;
    const max = Number(info.max) || 0;
    const countLabel = count ? (max > 0 ? ` (${count}/${max})` : ` (${count})`) : '';
    const render = () => {
      if (remaining > 0) {
        button.disabled = true;
        button.textContent = `Renvoyer dans ${remaining} s`;
        status.textContent = `Code envoyé${countLabel}. Nouveau code possible dans ${remaining} s.`;
        return;
      }
      button.disabled = false;
      button.textContent = 'Renvoyer un code';
      status.textContent = count
        ? `Code envoyé${countLabel}. Vous pouvez demander un nouveau code.`
        : 'Vous pouvez demander un nouveau code.';
    };
    render();
    if (remaining <= 0) return;
    resendTimers[kind] = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        remaining = 0;
        stopResendTimer(kind);
      }
      render();
    }, 1000);
  }

  function showLogin(message = '') {
    state.me = null;
    state.newKey = null;
    $('#portal-app').classList.add('hidden');
    $('#login-view').classList.remove('hidden');
    $('#portal-error').textContent = message;
    resetEmailFlow();
    resetSignupFlow();
    setAuthTab('key');
    $('#portal-key').focus();
  }

  function setAuthTab(mode) {
    const entries = {
      key: ['#tab-key', '#panel-key'],
      email: ['#tab-email', '#panel-email'],
      signup: ['#tab-signup', '#panel-signup'],
    };
    const normalized = entries[mode] ? mode : 'key';
    for (const [name, [tabSelector, panelSelector]] of Object.entries(entries)) {
      const tab = $(tabSelector);
      const panel = $(panelSelector);
      const active = name === normalized;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panel.classList.toggle('hidden', !active);
    }
    $('#email-error').textContent = '';
    $('#signup-error').textContent = '';
    if (normalized === 'email') $('#email-address').focus();
    else if (normalized === 'signup') $('#signup-email').focus();
    else $('#portal-key').focus();
  }

  function showEmailError(message = '') {
    $('#email-error').textContent = message;
  }

  function resetEmailFlow() {
    stopResendTimer('email');
    $('#email-resend-status').textContent = '';
    $('#email-resend').disabled = false;
    $('#email-resend').textContent = 'Renvoyer un code';
    $('#email-request-form').classList.remove('hidden');
    $('#email-verify-form').classList.add('hidden');
    $('#email-code').value = '';
    $('#email-sent-note').textContent = '';
    showEmailError('');
  }

  async function requestEmailCode() {
    if (state.emailBusy) return;
    const email = $('#email-address').value.trim();
    showEmailError('');
    if (!email) {
      showEmailError('Entrez votre adresse email.');
      $('#email-address').focus();
      return;
    }
    state.emailBusy = true;
    const button = $('#email-request-btn');
    button.disabled = true;
    button.textContent = 'Envoi…';
    try {
      const data = await api('/email/request', {
        method: 'POST',
        body: { email, ...deviceFields(), turnstileToken: turnstile.tokens.email ?? null },
      });
      $('#email-sent-note').textContent = `Code envoyé à ${email} (valable ${data.expiresMinutes ?? 10} minutes). Vérifiez aussi les spams.`;
      $('#email-request-form').classList.add('hidden');
      $('#email-verify-form').classList.remove('hidden');
      $('#email-code').value = '';
      $('#email-code').focus();
      startResendCountdown('email', data.resend_in_seconds ?? 30, {
        count: data.sends_in_window,
        max: data.max_sends,
      });
    } catch (err) {
      if (err.retryAfterSeconds && !$('#email-verify-form').classList.contains('hidden')) {
        startResendCountdown('email', err.retryAfterSeconds, {
          count: err.sendsInWindow,
          max: err.maxSends,
        });
      }
      showEmailError(err.message);
    } finally {
      state.emailBusy = false;
      button.disabled = false;
      button.textContent = 'Recevoir un code';
      resetTurnstile('email');
    }
  }

  async function verifyEmailCode() {
    if (state.emailBusy) return;
    const email = $('#email-address').value.trim();
    const code = $('#email-code').value.replace(/\D/g, '');
    showEmailError('');
    if (!/^\d{6}$/.test(code)) {
      showEmailError('Entrez le code à 6 chiffres reçu par email.');
      $('#email-code').focus();
      return;
    }
    state.emailBusy = true;
    const button = $('#email-verify-btn');
    button.disabled = true;
    button.textContent = 'Vérification…';
    try {
      await api('/email/verify', { method: 'POST', body: { email, code, ...deviceFields() } });
      await loadMe();
    } catch (err) {
      showEmailError(err.message);
      $('#email-code').focus();
    } finally {
      state.emailBusy = false;
      button.disabled = false;
      button.textContent = 'Valider le code';
    }
  }

  function showSignupError(message = '') {
    $('#signup-error').textContent = message;
  }

  function resetSignupFlow() {
    stopResendTimer('signup');
    $('#signup-resend-status').textContent = '';
    $('#signup-resend').disabled = false;
    $('#signup-resend').textContent = 'Renvoyer un code';
    $('#signup-request-form').classList.remove('hidden');
    $('#signup-verify-form').classList.add('hidden');
    $('#signup-code').value = '';
    $('#signup-sent-note').textContent = '';
    showSignupError('');
  }

  async function requestSignup() {
    if (state.emailBusy) return;
    const email = $('#signup-email').value.trim();
    showSignupError('');
    if (!email) {
      showSignupError('Entrez votre adresse email.');
      $('#signup-email').focus();
      return;
    }
    state.emailBusy = true;
    const button = $('#signup-request-btn');
    button.disabled = true;
    button.textContent = 'Envoi…';
    try {
      const data = await api('/signup/request', {
        method: 'POST',
        body: { email, ...deviceFields(), turnstileToken: turnstile.tokens.signup ?? null },
      });
      $('#signup-sent-note').textContent = `Un code vient d’être envoyé à ${email} (valable ${data.expiresMinutes ?? 10} minutes). Utilisez le dernier code reçu : demander un nouveau code annule le précédent.`;
      $('#signup-request-form').classList.add('hidden');
      $('#signup-verify-form').classList.remove('hidden');
      $('#signup-code').value = '';
      $('#signup-code').focus();
      startResendCountdown('signup', data.resend_in_seconds ?? 30, {
        count: data.sends_in_window,
        max: data.max_sends,
      });
    } catch (err) {
      if (err.retryAfterSeconds && !$('#signup-verify-form').classList.contains('hidden')) {
        startResendCountdown('signup', err.retryAfterSeconds, {
          count: err.sendsInWindow,
          max: err.maxSends,
        });
      }
      showSignupError(err.message);
    } finally {
      state.emailBusy = false;
      button.disabled = false;
      button.textContent = 'Créer mon compte';
      resetTurnstile('signup');
    }
  }

  async function verifySignup() {
    if (state.emailBusy) return;
    const email = $('#signup-email').value.trim();
    const code = $('#signup-code').value.replace(/\D/g, '');
    showSignupError('');
    if (!/^\d{6}$/.test(code)) {
      showSignupError('Entrez le code à 6 chiffres reçu par email.');
      $('#signup-code').focus();
      return;
    }
    state.emailBusy = true;
    const button = $('#signup-verify-btn');
    button.disabled = true;
    button.textContent = 'Création…';
    try {
      await api('/signup/verify', { method: 'POST', body: { email, code, ...deviceFields() } });
      await loadMe();
    } catch (err) {
      showSignupError(err.message);
      $('#signup-code').focus();
    } finally {
      state.emailBusy = false;
      button.disabled = false;
      button.textContent = 'Vérifier et créer mon compte';
    }
  }

  async function createApiKey() {
    const button = $('#create-key-btn');
    $('#key-error').textContent = '';
    button.disabled = true;
    button.textContent = 'Création…';
    try {
      const data = await api('/key', { method: 'POST' });
      state.newKey = data.key;
      await loadMe();
    } catch (err) {
      $('#key-error').textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Créer ma clé API';
    }
  }

  async function rotateApiKey() {
    if (!window.confirm('Régénérer votre clé API ? L’ancienne clé cessera de fonctionner immédiatement.')) return;
    const button = $('#rotate-key-btn');
    button.disabled = true;
    button.textContent = 'Régénération…';
    try {
      const data = await api('/key/rotate', { method: 'POST' });
      state.newKey = data.key;
      await loadMe();
    } catch (err) {
      $('#portal-status').className = 'portal-status alert danger';
      $('#portal-status').innerHTML = `<strong>${esc(err.message)}</strong>`;
    } finally {
      button.disabled = false;
      button.textContent = 'Régénérer ma clé';
    }
  }

  function showApp() {
    $('#login-view').classList.add('hidden');
    $('#portal-app').classList.remove('hidden');
  }

  function quotaCard(label, quota, formatter) {
    const limit = quota.limit;
    const used = quota.used ?? 0;
    if (!limit) {
      return `<article class="stat-card quota-card">
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-value">${formatter(used)}</div>
        <div class="quota-bar quota-bar-unlimited"><span></span></div>
        <div class="small muted">non plafonné</div>
      </article>`;
    }
    const pct = Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
    const level = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok';
    return `<article class="stat-card quota-card">
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value">${formatter(used)} <span class="stat-sub">/ ${formatter(limit)}</span></div>
      <div class="quota-bar ${level}"><span style="width:${pct}%"></span></div>
      <div class="small muted">restant : ${formatter(Math.max(0, quota.remaining ?? 0))}</div>
    </article>`;
  }

  function passCard(me) {
    const expiresAt = me.client.expiresAt ? new Date(me.client.expiresAt) : null;
    if (!expiresAt) {
      return `<article class="stat-card quota-card">
        <div class="stat-label">Fin du pass</div>
        <div class="stat-value pass-date">Sans date</div>
        <div class="small muted">arrêt à l'épuisement du quota</div>
      </article>`;
    }
    const days = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
    const dateLabel = expiresAt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    return `<article class="stat-card quota-card">
      <div class="stat-label">Fin du pass</div>
      <div class="stat-value">${days > 0 ? `${fmtInt(days)} j` : 'Terminé'}</div>
      <div class="small muted">${days > 0 ? `jusqu'au ${dateLabel}` : 'pass expiré'}</div>
    </article>`;
  }

  function chartMarkup(series) {
    const tokens = series.map((row) => Number(row.tokens) || 0);
    const total = tokens.reduce((sum, value) => sum + value, 0);
    if (total === 0) {
      return '<div class="chart chart-empty"><span class="muted small">Aucune consommation sur les 30 derniers jours.</span></div>';
    }
    const W = 640;
    const H = 170;
    const padB = 24;
    const padT = 10;
    const n = series.length;
    const slot = W / n;
    const barW = Math.max(2, slot * 0.55);
    const max = Math.max(1, ...tokens);
    const bars = tokens.map((value, index) => {
      const h = value > 0 ? Math.max(2, (value / max) * (H - padB - padT)) : 0;
      const x = index * slot + (slot - barW) / 2;
      const y = H - padB - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="url(#portalGrad)"></rect>`;
    }).join('');
    const first = series[0]?.day ? DAY_LABEL.format(new Date(`${series[0].day}T00:00:00Z`)) : '';
    const last = series[n - 1]?.day ? DAY_LABEL.format(new Date(`${series[n - 1].day}T00:00:00Z`)) : '';
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Consommation quotidienne en tokens sur 30 jours, ${fmtInt(total)} tokens au total">
      <defs>
        <linearGradient id="portalGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="#1a7a43"></stop>
          <stop offset="100%" stop-color="#3ee97f"></stop>
        </linearGradient>
      </defs>
      <line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="#1d3b28" stroke-width="1"></line>
      ${bars}
      <text x="0" y="${H - 6}" fill="#5d8769" font-size="11" font-family="monospace">${first}</text>
      <text x="${W}" y="${H - 6}" text-anchor="end" fill="#5d8769" font-size="11" font-family="monospace">${last}</text>
      <text x="4" y="${padT + 4}" fill="#5d8769" font-size="11" font-family="monospace">max ${fmtCompact(max)}</text>
    </svg>`;
  }

  function limitsMarkup(me) {
    const rows = [
      ['période', PERIOD_LABELS[me.client.period] || me.client.period],
      ['débit', me.limits.rpmLimit ? `${fmtInt(me.limits.rpmLimit)} req/min` : 'non limité'],
      ['sortie max', me.limits.maxOutputTokens ? `${fmtInt(me.limits.maxOutputTokens)} tokens` : 'non plafonnée'],
      ['depuis', fmtDate(me.client.createdAt)],
    ];
    const models = (me.limits.allowedModels ?? []).length
      ? me.limits.allowedModels
      : me.models;
    return `${rows.map(([key, value]) => `<div class="spec-row"><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}
      <div class="spec-row"><dt>modèles</dt><dd class="chips">${models.length ? models.map((model) => `<span class="chip">${esc(model)}</span>`).join('') : '<span class="muted">selon votre pass</span>'}</dd></div>`;
  }

  function logsMarkup(rows) {
    if (!rows.length) {
      return '<div class="empty-state"><strong>Aucune requête pour le moment</strong><p>Les appels effectués avec votre clé apparaîtront ici.</p></div>';
    }
    const body = rows.map((row) => {
      const ok = Number(row.status) >= 200 && Number(row.status) < 300;
      const model = row.requestedModel
        ? esc(row.requestedModel)
        : '<span class="muted">—</span>';
      return `<tr>
        <td class="nowrap muted small">${fmtDate(row.createdAt)}</td>
        <td class="mono small">${model}</td>
        <td class="right small nowrap">${fmtCompact(row.totalTokens)}</td>
        <td class="right small nowrap">${fmtUsd(row.costUsd)}</td>
        <td class="right small nowrap ${ok ? 'text-ok' : 'text-danger'}">${esc(row.status)}</td>
        <td class="right small nowrap muted">${row.latencyMs == null ? '—' : `${fmtInt(row.latencyMs)} ms`}</td>
      </tr>`;
    }).join('');
    return `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Modèle</th><th class="right">Tokens</th><th class="right">Coût</th><th class="right">Statut</th><th class="right">Latence</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  function usageMarkup(me) {
    const curl = `curl ${me.baseUrl}/chat/completions \\\n  -H "Authorization: Bearer VOTRE_CLE" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"claude-opus-5.5","messages":[{"role":"user","content":"Bonjour"}]}'`;
    const anthropic = `ANTHROPIC_BASE_URL=${me.anthropicBaseUrl}\nANTHROPIC_AUTH_TOKEN=VOTRE_CLE`;
    return `
      <div class="usage-grid">
        <div>
          <h3 class="usage-title">OpenAI / compatible</h3>
          <p class="small muted">URL de base : <code>${esc(me.baseUrl)}</code></p>
          <div class="code-frame">
            <button type="button" class="btn btn-ghost btn-sm copy-btn" data-copy="${esc(curl)}" aria-label="Copier la commande cURL">Copier</button>
            <pre class="code-block">${esc(curl)}</pre>
          </div>
        </div>
        <div>
          <h3 class="usage-title">Claude Code / Anthropic</h3>
          <p class="small muted">URL de base : <code>${esc(me.anthropicBaseUrl)}</code></p>
          <div class="code-frame">
            <button type="button" class="btn btn-ghost btn-sm copy-btn" data-copy="${esc(anthropic)}" aria-label="Copier les variables Anthropic">Copier</button>
            <pre class="code-block">${esc(anthropic)}</pre>
          </div>
        </div>
      </div>
      <p class="small muted usage-headers">Chaque réponse expose aussi vos restants : ${me.headers.map((header) => `<code>${esc(header)}</code>`).join(' · ')}</p>`;
  }

  function renderMe(me) {
    state.me = me;
    showApp();
    $('#portal-sub').textContent = `${me.client.name}${me.client.email ? ` · ${me.client.email}` : ` · clé ${me.client.keyPrefix}`} · ${PERIOD_LABELS[me.client.period] || me.client.period}`;
    $('#portal-version').textContent = `v${me.server?.version ?? ''}`;

    const passLine = $('#portal-pass');
    if (me.client.expiresAt) {
      const expiresAt = new Date(me.client.expiresAt);
      const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
      passLine.textContent = `Pass actif jusqu’au ${fmtDate(me.client.expiresAt)} · arrêt aussi au quota.`;
      passLine.classList.toggle('pass-expired', daysLeft <= 0);
    } else {
      passLine.textContent = 'Accès sans date de fin · arrêt à l’épuisement du quota.';
      passLine.classList.remove('pass-expired');
    }

    const status = $('#portal-status');
    if (me.status && me.status !== 'ok') {
      status.className = 'portal-status alert danger';
      status.innerHTML = `<strong>${esc(me.statusMessage || 'Cette clé ne peut pas envoyer de requêtes.')}</strong>`;
    } else {
      status.className = 'portal-status hidden';
      status.textContent = '';
    }

    const hasKey = me.client.hasKey !== false;
    const noKeyPanel = $('#no-key-panel');
    if (!hasKey || state.newKey) {
      noKeyPanel.classList.remove('hidden');
      $('#key-error').textContent = '';
      if (state.newKey) {
        $('#no-key-title').textContent = 'Votre clé API est créée';
        $('#no-key-copy').textContent = 'Copiez-la et conservez-la maintenant : elle ne sera plus jamais affichée en entier.';
        $('#create-key-btn').classList.add('hidden');
        $('#dismiss-key-btn').classList.remove('hidden');
        $('#new-key-box').classList.remove('hidden');
        $('#new-key-value').textContent = state.newKey;
      } else {
        $('#no-key-title').textContent = 'Votre compte est créé';
        $('#no-key-copy').textContent = 'Créez votre clé API pour utiliser la passerelle. Elle sera affichée une seule fois ; vous pourrez ensuite vous connecter avec cette clé ou avec votre email.';
        $('#create-key-btn').classList.remove('hidden');
        $('#dismiss-key-btn').classList.add('hidden');
        $('#new-key-box').classList.add('hidden');
        $('#new-key-value').textContent = '';
      }
    } else {
      noKeyPanel.classList.add('hidden');
    }
    $('#portal-usage-panel').classList.toggle('hidden', !hasKey);

    const q = me.quota;
    $('#portal-quotas').innerHTML = [
      quotaCard('Requêtes', q.requests, fmtInt),
      quotaCard('Crédit', q.usd, fmtUsd),
      passCard(me),
    ].join('');

    const series = me.usage?.series ?? [];
    $('#portal-chart-hint').textContent = `${fmtInt(me.usage?.totals?.requests ?? 0)} requêtes · ${fmtUsd(me.usage?.totals?.cost ?? 0)}`;
    $('#portal-chart').innerHTML = chartMarkup(series);

    $('#portal-limits').innerHTML = limitsMarkup(me);
    $('#portal-logs-hint').textContent = `${fmtInt(me.usage?.totals?.requests ?? 0)} requêtes · ${fmtInt(me.usage?.today?.requests ?? 0)} aujourd'hui`;
    $('#portal-usage').innerHTML = usageMarkup(me);

    $('#portal-logs').innerHTML = '<div class="muted small">Chargement des requêtes…</div>';
    api('/logs?limit=25')
      .then((data) => { $('#portal-logs').innerHTML = logsMarkup(data.rows ?? []); })
      .catch((err) => { $('#portal-logs').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`; });
  }

  async function loadMe() {
    const me = await api('/me');
    renderMe(me);
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (state.busy) return;
    const key = $('#portal-key').value.trim();
    const error = $('#portal-error');
    error.textContent = '';
    if (!key) {
      error.textContent = 'Entrez votre clé API.';
      $('#portal-key').focus();
      return;
    }
    state.busy = true;
    const button = $('#login-form button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Connexion…';
    try {
      await api('/login', { method: 'POST', body: { key } });
      $('#portal-key').value = '';
      await loadMe();
    } catch (err) {
      error.textContent = err.message;
      $('#portal-key').focus();
    } finally {
      state.busy = false;
      button.disabled = false;
      button.textContent = 'Ouvrir mon espace';
    }
  }

  async function handleLogout() {
    try { await api('/logout', { method: 'POST' }); } catch { /* session déjà fermée */ }
    showLogin('');
  }

  function wire() {
    $('#login-form').addEventListener('submit', handleLogin);
    $('#logout-btn').addEventListener('click', handleLogout);
    const authTabs = [
      ['tab-key', 'key'],
      ['tab-email', 'email'],
      ['tab-signup', 'signup'],
    ];
    for (const [id, mode] of authTabs) {
      $(`#${id}`).addEventListener('click', () => setAuthTab(mode));
      $(`#${id}`).addEventListener('keydown', (event) => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const visible = authTabs.map(([tabId]) => tabId).filter((tabId) => !$(`#${tabId}`).classList.contains('hidden'));
        const current = visible.indexOf(id);
        const next = event.key === 'ArrowRight' || event.key === 'End'
          ? (current + 1) % visible.length
          : (current - 1 + visible.length) % visible.length;
        const nextMode = authTabs.find(([tabId]) => tabId === visible[next])?.[1] ?? 'key';
        setAuthTab(nextMode);
        $(`#${visible[next]}`).focus();
      });
    }
    $('#email-request-form').addEventListener('submit', (event) => {
      event.preventDefault();
      requestEmailCode();
    });
    $('#email-verify-form').addEventListener('submit', (event) => {
      event.preventDefault();
      verifyEmailCode();
    });
    $('#email-resend').addEventListener('click', requestEmailCode);
    $('#email-change').addEventListener('click', resetEmailFlow);
    $('#email-signup-link').addEventListener('click', () => setAuthTab('signup'));
    $('#signup-request-form').addEventListener('submit', (event) => {
      event.preventDefault();
      requestSignup();
    });
    $('#signup-verify-form').addEventListener('submit', (event) => {
      event.preventDefault();
      verifySignup();
    });
    $('#signup-resend').addEventListener('click', requestSignup);
    $('#signup-back').addEventListener('click', resetSignupFlow);
    $('#signup-login-link').addEventListener('click', () => setAuthTab('email'));
    $('#signup-key-link').addEventListener('click', () => setAuthTab('key'));
    $('#create-key-btn').addEventListener('click', createApiKey);
    $('#rotate-key-btn').addEventListener('click', rotateApiKey);
    $('#dismiss-key-btn').addEventListener('click', () => {
      state.newKey = null;
      if (state.me) renderMe(state.me);
    });
    $('#copy-new-key').addEventListener('click', async () => {
      const button = $('#copy-new-key');
      try {
        await navigator.clipboard.writeText($('#new-key-value').textContent || '');
        button.textContent = 'Copié';
        setTimeout(() => { button.textContent = 'Copier'; }, 1500);
      } catch {
        button.textContent = 'Copie impossible';
      }
    });
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-copy]');
      if (!button) return;
      try {
        await navigator.clipboard.writeText(button.getAttribute('data-copy') || '');
        const previous = button.textContent;
        button.textContent = 'Copié';
        setTimeout(() => { button.textContent = previous; }, 1500);
      } catch {
        button.textContent = 'Copie impossible';
      }
    });
  }

  async function detectEmailLogin() {
    try {
      const config = await api('/config');
      let modes = 1;
      if (config.emailLoginEnabled) {
        $('#tab-email').classList.remove('hidden');
        modes += 1;
      }
      if (config.signupEnabled) {
        $('#tab-signup').classList.remove('hidden');
        modes += 1;
      }
      if (modes === 1) document.querySelector('.auth-tabs').classList.add('hidden');
      await initTurnstile(config.turnstileSiteKey);
    } catch {
      /* pas bloquant : la connexion par clé reste disponible */
      document.querySelector('.auth-tabs').classList.add('hidden');
    }
  }

  async function refreshStatus() {
    const badge = document.querySelector('#site-status');
    if (!badge) return;
    const dot = badge.querySelector('.dot');
    const text = badge.querySelector('.status-text');
    try {
      const res = await fetch('/healthz', { headers: { accept: 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dot.className = 'dot ok';
      text.textContent = `en ligne · v${data.version}`;
    } catch {
      dot.className = 'dot warn';
      text.textContent = 'statut indisponible';
    }
  }

  async function init() {
    wire();
    refreshStatus();
    setInterval(refreshStatus, 60_000);
    await detectEmailLogin();
    try {
      await loadMe();
    } catch (err) {
      showLogin(err.status === 401 ? '' : err.message);
    }
  }

  init();
})();

