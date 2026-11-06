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
  const state = { me: null, busy: false, emailBusy: false, newKey: null, userView: 'overview', currency: null };

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

  /* ---------------- Captcha anti-bot (Turnstile ou hCaptcha) ---------------- */
  const captcha = { provider: null, siteKey: null, widgets: {}, tokens: {}, loading: null };

  function ensureCaptchaSlot(kind) {
    if (kind !== 'email') return null;
    const panel = $('#panel-email');
    if (!panel) return null;
    let slot = panel.querySelector('#email-captcha');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'email-captcha';
      slot.className = 'turnstile-slot';
      const error = panel.querySelector('.login-error');
      if (error) error.after(slot);
      else panel.prepend(slot);
    }
    return slot;
  }

  function loadCaptchaScript(provider) {
    const globalObject = provider === 'hcaptcha' ? window.hcaptcha : window.turnstile;
    if (globalObject) return Promise.resolve(globalObject);
    if (captcha.loading) return captcha.loading;
    captcha.loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = provider === 'hcaptcha'
        ? 'https://js.hcaptcha.com/1/api.js?render=explicit'
        : 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(provider === 'hcaptcha' ? window.hcaptcha : window.turnstile);
      script.onerror = () => reject(new Error('Impossible de charger la vérification anti-bot.'));
      document.head.appendChild(script);
    });
    return captcha.loading;
  }

  async function initCaptcha(publicConfig) {
    const provider = publicConfig?.captchaProvider || 'turnstile';
    const siteKey = publicConfig?.captchaSiteKey || publicConfig?.turnstileSiteKey || null;
    captcha.provider = provider;
    captcha.siteKey = siteKey;
    if (!siteKey || provider === 'none') return;
    try {
      await loadCaptchaScript(provider);
      // Ne pas rendre dans un panneau masque (hCaptcha ne s'affiche pas).
      if (!$('#panel-email').classList.contains('hidden')) renderCaptcha('email');
    } catch (err) {
      const message = err?.message || 'Vérification anti-bot indisponible.';
      showEmailError(message);
    }
  }

  /** Rend le captcha au moment ou son onglet devient visible. */
  async function renderCaptcha(kind) {
    if (!captcha.siteKey || captcha.widgets[kind] != null) return;
    try {
      await loadCaptchaScript(captcha.provider);
      const slot = ensureCaptchaSlot(kind);
      if (!slot) return;
      slot.classList.remove('hidden');
      slot.innerHTML = '';
      const callbacks = {
        sitekey: captcha.siteKey,
        theme: 'dark',
        callback: (token) => { captcha.tokens[kind] = token; },
        'expired-callback': () => { captcha.tokens[kind] = null; },
        'error-callback': () => { captcha.tokens[kind] = null; },
      };
      if (captcha.provider === 'hcaptcha' && window.hcaptcha) {
        captcha.widgets[kind] = window.hcaptcha.render(slot, callbacks);
      } else if (window.turnstile) {
        captcha.widgets[kind] = window.turnstile.render(slot, callbacks);
      }
    } catch (err) {
      const message = err?.message || 'Vérification anti-bot indisponible.';
      if (kind === 'email') showEmailError(message);
    }
  }

  function resetCaptcha(kind) {
    captcha.tokens[kind] = null;
    try {
      if (captcha.provider === 'hcaptcha' && window.hcaptcha && captcha.widgets[kind] != null) {
        window.hcaptcha.reset(captcha.widgets[kind]);
      } else if (window.turnstile && captcha.widgets[kind] != null) {
        window.turnstile.reset(captcha.widgets[kind]);
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

  function showPortalError(message = '') {
    const element = $('#portal-error');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('visible', Boolean(message));
  }

  function showLogin(message = '') {
    state.me = null;
    state.newKey = null;
    document.body.classList.remove('portal-authenticated');
    setUserMenu(false);
    $('#portal-app').classList.add('hidden');
    $('#login-view').classList.remove('hidden');
    showPortalError(message);
    resetEmailFlow();
    setAuthTab('key');
    $('#portal-key').focus();
  }

  function setAuthTab(mode) {
    const entries = {
      key: ['#tab-key', '#panel-key'],
      email: ['#tab-email', '#panel-email'],
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
    $('#email-error').classList.remove('visible');
    if (normalized === 'email') {
      renderCaptcha('email');
      $('#email-address').focus();
    } else {
      $('#portal-key').focus();
    }
  }

  function showEmailError(message = '') {
    const element = $('#email-error');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('visible', Boolean(message));
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
        body: { email, ...deviceFields(), captchaToken: captcha.tokens.email ?? null },
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
      resetCaptcha('email');
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

  function showSignupError() {
    /* Le parcours d'inscription vit sur /signup. */
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
        body: { email, ...deviceFields(), captchaToken: captcha.tokens.signup ?? null },
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
      resetCaptcha('signup');
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
      state.userView = 'keys';
      await loadMe();
    } catch (err) {
      const status = $('#portal-status');
      status.className = 'portal-status alert danger';
      status.textContent = err.message;
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
    document.body.classList.add('portal-authenticated');
    $('#login-view').classList.add('hidden');
    $('#portal-app').classList.remove('hidden');
  }

  const USER_VIEWS = {
    overview: 'Vue d’ensemble',
    pass: 'Mon pass',
    keys: 'Mes clés API',
    usage: 'Consommation',
    requests: 'Requêtes',
    settings: 'Réglages',
    guide: 'Guide d’intégration',
  };

  function setUserView(view) {
    const normalized = USER_VIEWS[view] ? view : 'overview';
    state.userView = normalized;
    document.querySelectorAll('[data-user-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.userPanel !== normalized);
    });
    document.querySelectorAll('[data-user-view]').forEach((item) => {
      item.classList.toggle('active', item.dataset.userView === normalized);
    });
    const title = $('#portal-title');
    if (title) title.textContent = USER_VIEWS[normalized];
    const profileStatus = $('#profile-status');
    if (profileStatus) profileStatus.textContent = '';
    setUserMenu(false);
  }

  function setUserMenu(open) {
    const sidebar = $('#user-sidebar');
    const toggle = $('#user-menu-toggle');
    const backdrop = $('#user-nav-backdrop');
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (backdrop) backdrop.classList.toggle('hidden', !open);
    document.body.classList.toggle('user-menu-open', open);
  }

  const TWO_DECIMAL_CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'CHF']);

  function formatPlanPrice(priceEur) {
    const currency = state.currency;
    if (!currency || currency.currency === 'EUR' || !Number.isFinite(Number(currency.rate))) {
      return `${Number(priceEur).toFixed(2).replace('.', ',')} €`;
    }
    const amount = Number(priceEur) * Number(currency.rate);
    const decimals = TWO_DECIMAL_CURRENCIES.has(currency.currency) ? 2 : 0;
    const label = ['XOF', 'XAF'].includes(currency.currency) ? 'FCFA' : currency.currency;
    const formatted = new Intl.NumberFormat('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
      useGrouping: true,
    }).format(amount).replace(/,/g, ' ').replace(/\./g, ',');
    return `${formatted}\u00A0${label}`;
  }

  function planCurrencyNote() {
    const currency = state.currency;
    if (!currency || currency.currency === 'EUR') return 'Prix affichés en euros (EUR).';
    const country = currency.country
      ? new Intl.DisplayNames(['fr'], { type: 'region' }).of(currency.country)
      : null;
    const updated = currency.updatedAt ? new Date(currency.updatedAt).toLocaleDateString('fr-FR') : null;
    const rate = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(currency.rate);
    const source = currency.fallback ? 'taux indicatif' : `taux ${currency.source || 'du marché'}`;
    return `Prix convertis en ${new Intl.DisplayNames(['fr'], { type: 'currency' }).of(currency.currency)}${country ? ` pour ${country}` : ''} · 1 € = ${rate} ${currency.currency}${updated ? ` · ${source} du ${updated}` : ''}.`;
  }

  function planCurrentMarkup(me) {
    const plan = me.plan;
    if (!plan) {
      return `<div class="plan-current">
        <div>
          <p class="plan-kicker">Pass personnalisé</p>
          <h3>Accès sur mesure</h3>
          <p class="muted">Votre accès a été configuré directement par l'administrateur.</p>
        </div>
        <span class="badge badge-muted">personnalisé</span>
      </div>
      <dl class="spec-list" style="margin-top:18px">
        <div class="spec-row"><dt>fin du pass</dt><dd>${me.client.expiresAt ? fmtDate(me.client.expiresAt) : 'sans date de fin'}</dd></div>
        <div class="spec-row"><dt>quota</dt><dd>${fmtInt(me.quota.requests.limit || 0)} requêtes · ${fmtUsd(me.quota.usd.limit || 0)}</dd></div>
      </dl>`;
    }
    const features = (plan.features ?? []).map((feature) => `<span class="chip">${esc(feature)}</span>`).join('');
    return `<div class="plan-current">
      <div>
        <p class="plan-kicker">Pass actif</p>
        <h3>${esc(plan.name)}</h3>
        <p class="muted">${esc(plan.tagline || '')}</p>
        <div class="chips plan-chips">${features}</div>
        <p class="small muted" style="margin:14px 0 0">
          ${esc(plan.support || '')} · ${me.client.expiresAt ? `fin le ${fmtDate(me.client.expiresAt)}` : 'sans date de fin'}
        </p>
      </div>
      <span class="badge badge-ok">actif</span>
    </div>`;
  }

  function planGridMarkup(me) {
    const currentId = me.plan?.id || null;
    return (me.plans ?? []).map((plan) => `
      <article class="plan-card ${plan.id === currentId ? 'is-current' : ''}">
        <div class="plan-card-head">
          <h3>${esc(plan.name)}</h3>
          ${plan.id === currentId ? '<span class="badge badge-ok">actuel</span>' : ''}
        </div>
        <p class="plan-tagline">${esc(plan.tagline || '')}</p>
        <p class="plan-price">${formatPlanPrice(plan.priceEur)} <span class="plan-period">/ 30 j</span></p>
        <ul class="plan-features">
          ${(plan.features ?? []).map((feature) => `<li>${esc(feature)}</li>`).join('')}
          <li>${esc(plan.support || '')}</li>
        </ul>
      </article>`).join('');
  }

  function keyDetailsMarkup(me) {
    if (!me.client.hasKey) {
      return '<div class="empty-state"><strong>Aucune clé API pour le moment</strong><p>Créez votre clé depuis le bouton en haut à droite. Elle sera affichée une seule fois.</p></div>';
    }
    const status = me.client.enabled ? 'Actif' : 'Désactivé';
    const rows = [
      ['empreinte', `${me.client.keyPrefix}…`],
      ['statut', status],
      ['créée le', fmtDate(me.client.createdAt)],
      ['fin du pass', me.client.expiresAt ? fmtDate(me.client.expiresAt) : 'sans date de fin'],
      ['période', PERIOD_LABELS[me.client.period] || me.client.period],
    ];
    return `<dl class="spec-list">${rows.map(([key, value]) => `<div class="spec-row"><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  }

  function accountDetailsMarkup(me) {
    const rows = [
      ['nom', me.client.name],
      ['email', me.client.email || 'non renseigné'],
      ['clé API', me.client.hasKey ? `${me.client.keyPrefix}…` : 'non créée'],
      ['compte', me.client.enabled ? 'actif' : 'désactivé'],
      ['créé le', fmtDate(me.client.createdAt)],
      ['fin du pass', me.client.expiresAt ? fmtDate(me.client.expiresAt) : 'sans date de fin'],
    ];
    return `<dl class="spec-list">${rows.map(([key, value]) => `<div class="spec-row"><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  }

  function endpointsMarkup(me) {
    return `<div class="usage-grid">
      <div>
        <h3 class="usage-title">OpenAI / compatible</h3>
        <p class="small muted">URL de base : <code>${esc(me.baseUrl)}</code></p>
        <pre class="mini-code">curl ${esc(me.baseUrl)}/chat/completions \\
  -H "Authorization: Bearer VOTRE_CLE" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"claude-opus-5.5","messages":[{"role":"user","content":"Bonjour"}]}'</pre>
      </div>
      <div>
        <h3 class="usage-title">Claude Code / Anthropic</h3>
        <p class="small muted">URL de base : <code>${esc(me.anthropicBaseUrl)}</code></p>
        <pre class="mini-code">ANTHROPIC_BASE_URL=${esc(me.anthropicBaseUrl)}
ANTHROPIC_AUTH_TOKEN=VOTRE_CLE</pre>
      </div>
    </div>`;
  }

  function usageTableMarkup(me) {
    const series = (me.usage?.series ?? []).filter((row) => Number(row.requests) > 0).slice(-14).reverse();
    if (!series.length) {
      return '<div class="empty-state"><strong>Aucune consommation</strong><p>Vos requêtes apparaîtront ici dès le premier appel.</p></div>';
    }
    const rows = series.map((row) => `<tr>
      <td>${esc(row.day)}</td>
      <td class="right">${fmtInt(row.requests)}</td>
      <td class="right">${fmtCompact(row.tokens)}</td>
      <td class="right">${fmtUsd(row.cost)}</td>
    </tr>`).join('');
    return `<div class="table-wrap"><table>
      <thead><tr><th>Jour</th><th class="right">Requêtes</th><th class="right">Tokens</th><th class="right">Coût</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
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
    const headerCreate = $('#create-key-btn');
    if (state.newKey) {
      noKeyPanel.classList.remove('hidden');
      $('#key-error').textContent = '';
      $('#new-key-value').textContent = state.newKey;
      headerCreate.classList.add('hidden');
    } else {
      noKeyPanel.classList.add('hidden');
      headerCreate.classList.toggle('hidden', hasKey);
    }
    $('#rotate-key-btn').disabled = !hasKey;
    const userStatusText = $('#user-status-text');
    const userStatusDot = $('#user-status-dot');
    if (userStatusText) userStatusText.textContent = !hasKey ? 'aucune clé' : me.client.enabled ? 'pass actif' : 'compte désactivé';
    if (userStatusDot) userStatusDot.className = `dot ${hasKey && me.client.enabled ? 'ok' : 'warn'}`;

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
    $('#portal-key-details').innerHTML = keyDetailsMarkup(me);
    $('#portal-plan-current').innerHTML = planCurrentMarkup(me);
    $('#portal-plan-grid').innerHTML = planGridMarkup(me);
    $('#plan-currency-note').textContent = planCurrencyNote();
    $('#portal-account-details').innerHTML = accountDetailsMarkup(me);
    $('#portal-endpoints').innerHTML = endpointsMarkup(me);
    $('#portal-usage-table').innerHTML = usageTableMarkup(me);
    $('#portal-usage-hint').textContent = `${fmtInt(me.usage?.totals?.requests ?? 0)} requêtes au total`;
    const profileName = $('#profile-form [name="displayName"]');
    if (profileName) profileName.value = me.client.name || '';
    $('#portal-usage').innerHTML = usageMarkup(me);

    $('#portal-logs-hint').textContent = `${fmtInt(me.usage?.totals?.requests ?? 0)} requêtes · ${fmtInt(me.usage?.today?.requests ?? 0)} aujourd'hui`;
    $('#portal-recent-hint').textContent = `${fmtInt(me.usage?.today?.requests ?? 0)} aujourd'hui`;
    $('#portal-logs').innerHTML = '<div class="muted small">Chargement des requêtes…</div>';
    $('#portal-recent-logs').innerHTML = '<div class="muted small">Chargement des requêtes…</div>';
    api('/logs?limit=25')
      .then((data) => {
        const rows = data.rows ?? [];
        $('#portal-logs').innerHTML = logsMarkup(rows);
        $('#portal-recent-logs').innerHTML = logsMarkup(rows.slice(0, 5));
      })
      .catch((err) => {
        $('#portal-logs').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
        $('#portal-recent-logs').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
      });

    setUserView(state.newKey ? 'keys' : state.userView || 'overview');
  }

  async function loadMe() {
    const me = await api('/me');
    renderMe(me);
  }

  async function loadCurrency() {
    try {
      const params = new URLSearchParams({
        locale: navigator.language || '',
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      });
      state.currency = await api(`/currency?${params.toString()}`);
    } catch {
      state.currency = null;
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.elements.displayName.value.trim();
    const status = $('#profile-status');
    if (!name) {
      status.textContent = 'Le nom ne peut pas être vide.';
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    status.textContent = 'Enregistrement…';
    try {
      const data = await api('/profile', { method: 'PUT', body: { name } });
      state.me.client.name = data.name;
      await loadMe();
      $('#profile-status').textContent = 'Nom enregistré.';
    } catch (err) {
      status.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (state.busy) return;
    const key = $('#portal-key').value.trim();
    const error = $('#portal-error');
    showPortalError('');
    if (!key) {
      showPortalError('Entrez votre clé API.');
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
      showPortalError(err.message);
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
    document.querySelectorAll('[data-user-view]').forEach((item) => {
      item.addEventListener('click', () => setUserView(item.dataset.userView));
    });
    $('#user-menu-toggle')?.addEventListener('click', () => {
      const sidebar = $('#user-sidebar');
      setUserMenu(!sidebar.classList.contains('open'));
    });
    $('#user-nav-backdrop')?.addEventListener('click', () => setUserMenu(false));
    $('#profile-form')?.addEventListener('submit', saveProfile);
    const authTabs = [
      ['tab-key', 'key'],
      ['tab-email', 'email'],
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
    let config;
    try {
      config = await api('/config');
    } catch {
      /* pas bloquant : la connexion par clé reste disponible */
      document.querySelector('.auth-tabs').classList.add('hidden');
      return;
    }
    if (!config.emailLoginEnabled) {
      document.querySelector('.auth-tabs').classList.add('hidden');
      return;
    }
    // Afficher l'onglet avant le captcha : un chargement anti-bot en échec
    // ne doit jamais faire disparaître la connexion par code email.
    $('#tab-email').classList.remove('hidden');
    try {
      await initCaptcha(config);
    } catch (err) {
      showEmailError(err?.message || 'Vérification anti-bot indisponible.');
    }
  }

  async function refreshStatus() {
    const badge = document.querySelector('#site-status');
    if (!badge) return;
    const dot = badge.querySelector('.dot');
    const text = badge.querySelector('.status-text');
    const pageVersion = document.querySelector('meta[name="app-version"]')?.content || null;
    try {
      const res = await fetch('/healthz', { headers: { accept: 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (pageVersion && data.version && pageVersion !== data.version) {
        location.reload();
        return;
      }
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
    await loadCurrency();
    try {
      await loadMe();
    } catch (err) {
      showLogin(err.status === 401 ? '' : err.message);
    }
  }

  init();
})();


