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
  const state = { me: null, busy: false, emailBusy: false, newKey: null, userView: 'overview', currency: null, paymentsEnabled: false };

  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    pass: '<path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3v3Z"/><path d="M13 6v12"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 4 3 3"/><path d="m14 7 3 3"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.1.36.3.7.6 1 .3.28.7.42 1.1.42H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.58Z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/><path d="m14.5 4-5 16"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    spark: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="M19 16v4"/><path d="M17 18h4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-.8.6-1.5 1.2-1.5 2.5"/><path d="M12 17h.01"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',
    dollar: '<path d="M12 2v20"/><path d="M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  };

  function icon(name, extraClass = '') {
    const path = ICONS[name] || ICONS.spark;
    return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
  }

  function paintIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((element) => {
      const name = element.dataset.icon;
      if (!name) return;
      const svg = icon(name);
      if (element.innerHTML !== svg) element.innerHTML = svg;
    });
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  const fmtInt = (value) => NF.format(Number(value) || 0);
  const fmtUsd = (value) => `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(Number(value) || 0)} $`;
  const fmtUsd2 = (value) => `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)} $`;
  const COUNT_FORMATS = { int: fmtInt, usd: fmtUsd2, days: (v) => `${fmtInt(v)} j` };
  const fmtCompact = (value) => {
    const n = Number(value) || 0;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace('.', ',')} M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace('.', ',')} k`;
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
    element.style.display = message ? 'block' : 'none';
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
    element.style.display = message ? 'block' : 'none';
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
    const previousLabel = button.innerHTML;
    $('#key-error').textContent = '';
    button.disabled = true;
    button.innerHTML = `${icon('refresh')}Création…`;
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
      button.innerHTML = previousLabel;
    }
  }

  async function rotateApiKey() {
    if (!window.confirm('Régénérer votre clé API ? L’ancienne clé cessera de fonctionner immédiatement.')) return;
    const button = $('#rotate-key-btn');
    const previousLabel = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `${icon('refresh')}Régénération…`;
    try {
      const data = await api('/key/rotate', { method: 'POST' });
      state.newKey = data.key;
      await loadMe();
    } catch (err) {
      $('#portal-status').className = 'portal-status alert danger';
      $('#portal-status').innerHTML = `<strong>${esc(err.message)}</strong>`;
    } finally {
      button.disabled = false;
      button.innerHTML = previousLabel;
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
    billing: 'Recharger',
    requests: 'Requêtes',
    settings: 'Réglages',
    guide: 'Guide d’utilisation',
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
    animateCounts(document.querySelector(`[data-user-panel="${normalized}"]`), COUNT_FORMATS);
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

  /** Pay as you go : les montants de base sont en FCFA, convertis dans la devise detectee. */
  const BILLING_BASE_FCFA = 655.957;

  function billingCurrencyInfo() {
    const currency = state.currency;
    const code = currency?.currency || 'XOF';
    const rate = Number(currency?.rate);
    const valid = Number.isFinite(rate) && rate > 0;
    const label = ['XOF', 'XAF'].includes(code)
      ? 'FCFA'
      : (() => {
        try {
          return new Intl.DisplayNames(['fr'], { type: 'currency' }).of(code) || code;
        } catch {
          return code;
        }
      })();
    const decimals = TWO_DECIMAL_CURRENCIES.has(code) ? 2 : 0;
    return { code, rate: valid ? rate : 655.957, label, decimals };
  }

  function formatBillingAmount(baseFcfa) {
    const { rate, label, decimals } = billingCurrencyInfo();
    const amount = (Number(baseFcfa) / BILLING_BASE_FCFA) * rate;
    const value = new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(amount);
    return `${value}\u00A0${label}`;
  }

  function renderBillingPreview() {
    const info = billingCurrencyInfo();
    document.querySelectorAll('[data-billing-base]').forEach((button) => {
      button.textContent = formatBillingAmount(button.dataset.billingBase);
    });
    const label = $('#billing-custom-label');
    if (label) label.textContent = `Montant personnalisé (${info.label})`;
    const input = $('#billing-custom-input');
    if (input) {
      const min = (1000 / BILLING_BASE_FCFA) * info.rate;
      input.min = info.decimals === 0 ? String(Math.round(min)) : min.toFixed(2);
      input.placeholder = `ex : ${formatBillingAmount(10000)}`;
    }
    const note = $('#billing-currency-note');
    if (note) note.textContent = `Montants affichés en ${info.label} selon votre localisation.`;
    const help = $('#billing-custom-help');
    if (help) help.textContent = `Minimum ${formatBillingAmount(1000)}. Le crédit est ajouté à votre solde dès le paiement confirmé.`;
    const enabled = Boolean(state.paymentsEnabled);
    document.querySelectorAll('[data-billing-base]').forEach((button) => { button.disabled = !enabled; });
    if (input) input.disabled = !enabled;
    const buy = $('#billing-buy');
    if (buy) buy.disabled = !enabled;
    const alert = $('#billing-alert');
    if (alert) alert.textContent = enabled
      ? 'Rechargez votre crédit site en mobile money. Le crédit acheté n’expire pas.'
      : 'Le paiement en ligne n’est pas encore configuré sur cette passerelle.';
  }

  function billingAmountValue(baseFcfa) {
    const { rate, decimals } = billingCurrencyInfo();
    const value = (Number(baseFcfa) / BILLING_BASE_FCFA) * rate;
    return decimals === 0 ? Math.round(value) : Number(value.toFixed(2));
  }

  async function startWalletRecharge(button) {
    const input = $('#billing-custom-input');
    const status = $('#billing-status');
    const amount = Number(String(input?.value ?? '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      if (status) status.textContent = 'Choisissez un montant.';
      return;
    }
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Préparation…';
    try {
      const data = await api('/wallet/checkout', { method: 'POST', body: { amount } });
      if (!data.checkout_url) throw new Error('Page de paiement indisponible.');
      window.location.assign(data.checkout_url);
    } catch (err) {
      if (status) status.textContent = err.message;
      button.disabled = false;
      button.textContent = label;
    }
  }

  function planCurrencyNote() {    const currency = state.currency;
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
        <div class="spec-row"><dt>quota</dt><dd>${fmtInt(me.quota.requests.limit || 0)} requêtes · ${fmtUsd2(me.quota.usd.limit || 0)}</dd></div>
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
        <p class="plan-price">${formatPlanPrice(plan.priceEur)} <span class="plan-period">/ ${plan.durationDays} j</span></p>
        <ul class="plan-features">
          ${(plan.features ?? []).map((feature) => `<li>${esc(feature)}</li>`).join('')}
          <li>${esc(plan.support || '')}</li>
        </ul>
        ${state.paymentsEnabled
          ? `<button type="button" class="btn btn-primary btn-block plan-buy" data-buy-plan="${esc(plan.id)}">${plan.id === currentId ? 'Renouveler ce pass' : 'Payer ce pass'}</button>`
          : '<button type="button" class="btn btn-primary btn-block" disabled>Paiement indisponible</button>'}
      </article>`).join('');
  }

  async function startPlanPayment(planId, button) {
    if (state.busy) return;
    state.busy = true;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Préparation du paiement…';
    const status = $('#portal-status');
    try {
      const data = await api('/pass/checkout', { method: 'POST', body: { plan: planId } });
      if (data.checkout_url) {
        window.location.assign(data.checkout_url);
        return;
      }
      throw new Error('Le paiement en ligne n’a pas renvoyé de page de paiement.');
    } catch (err) {
      if (status) {
        status.className = 'portal-status alert danger';
        status.textContent = err.message;
      }
    } finally {
      state.busy = false;
      button.disabled = false;
      button.textContent = label;
    }
  }

  async function confirmReturningPayment() {
    const orderId = new URLSearchParams(window.location.search).get('pass_order');
    if (!orderId) return;
    const status = $('#portal-status');
    try {
      const data = await api('/pass/confirm', { method: 'POST', body: { order_id: orderId } });
      const order = data.order || {};
      if (status) {
        status.className = `portal-status alert ${order.status === 'completed' ? 'ok' : 'warn'}`;
        status.textContent = order.status === 'completed'
          ? `Paiement confirmé : pass « ${order.plan} » activé.`
          : 'Paiement en attente de confirmation. Actualisez dans quelques instants.';
      }
      if (order.status === 'completed') await loadMe();
    } catch (err) {
      if (status) {
        status.className = 'portal-status alert warn';
        status.textContent = err.message;
      }
    } finally {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
  function devicesMarkup(devices) {
    if (!devices.length) {
      return '<div class="empty-state"><strong>Aucun appareil connecté</strong><p>Vos terminaux VALARIA Code apparaîtront ici après autorisation depuis la page de connexion d’appareil.</p></div>';
    }
    return `<div class="device-list">${devices.map((device) => `
      <div class="device-row">
        <span class="device-icon">${icon('terminal')}</span>
        <div class="device-main">
          <strong>${esc(device.name || 'Appareil CLI')}</strong>
          <span class="small muted">ajouté le ${fmtDate(device.createdAt)}${device.lastUsedAt ? ` · dernière activité ${fmtDate(device.lastUsedAt)}` : ' · jamais utilisé'}</span>
        </div>
        <span class="badge ${device.active ? 'badge-ok' : 'badge-muted'}">${device.active ? 'actif' : 'révoqué'}</span>
        ${device.active ? `<button type="button" class="btn btn-ghost btn-sm" data-device-revoke="${esc(device.id)}" data-device-name="${esc(device.name || 'Appareil CLI')}">${icon('logout')}Révoquer</button>` : ''}
      </div>`).join('')}</div>`;
  }

  async function loadDevices() {
    const target = $('#portal-devices');
    if (!target) return;
    try {
      const data = await api('/devices');
      target.innerHTML = devicesMarkup(data.devices ?? []);
    } catch (err) {
      target.innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
    }
  }

  async function revokeDevice(id, name) {
    if (!window.confirm(`Révoquer l’accès de « ${name} » ? Ce terminal devra se reconnecter.`)) return;
    try {
      await api(`/devices/${id}`, { method: 'DELETE' });
      await loadDevices();
    } catch (err) {
      const target = $('#portal-devices');
      if (target) target.innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
    }
  }

  function keyDetailsMarkup(me) {
    if (!me.client.hasKey) {
      return '<div class="empty-state"><strong>Aucune clé API pour le moment</strong><p>Créez votre clé depuis le bouton en haut à droite. Elle sera affichée une seule fois.</p></div>';
    }
    const status = me.client.enabled ? 'Actif' : 'Désactivé';
    const rows = [
      ['empreinte', `${me.client.keyPrefix}`],
      ['statut', status],
      ['créée le', fmtDate(me.client.createdAt)],
      ['fin du pass', me.client.expiresAt ? fmtDate(me.client.expiresAt) : 'sans date de fin'],
      me.plan
        ? ['pass', `${me.plan.name}${me.plan.durationDays ? ` · ${me.plan.durationDays} jours` : ''}`]
        : ['période', PERIOD_LABELS[me.client.period] || me.client.period],
    ];
    return `<dl class="spec-list">${rows.map(([key, value]) => `<div class="spec-row"><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  }

  function accountDetailsMarkup(me) {
    const rows = [
      ['nom', me.client.name],
      ['email', me.client.email || 'non renseigné'],
      ['clé API', me.client.hasKey ? `${me.client.keyPrefix}` : 'non créée'],
      ['compte', me.client.enabled ? 'actif' : 'désactivé'],
      ['créé le', fmtDate(me.client.createdAt)],
      ['fin du pass', me.client.expiresAt ? fmtDate(me.client.expiresAt) : 'sans date de fin'],
    ];
    return `<dl class="spec-list">${rows.map(([key, value]) => `<div class="spec-row"><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  }

  function guideMarkup(me) {
    const base = me.baseUrl || '';
    const anthropic = me.anthropicBaseUrl || `${base.replace(/\/v1\/?$/, '')}/anthropic`;
    const models = (me.models ?? []).filter((name) => !/deepseek/i.test(name));
    const openaiModel = models.find((name) => /^gpt-5-codex/i.test(name))
      || models.find((name) => /^(gpt|codex|o[34])/i.test(name))
      || models[0]
      || 'votre-modele';
    const chatModel = models.find((name) => /^gpt-5$/i.test(name)) || openaiModel;
    const anthropicModel = models.find((name) => /^claude/i.test(name)) || openaiModel;
    const codexModel = models.find((name) => /^gpt-5-codex/i.test(name)) || 'gpt-5-codex';
    const hasKey = Boolean(me.client?.hasKey);
    const keyHint = hasKey ? `${me.client.keyPrefix}` : 'Aucune clé active';
    const keyState = hasKey
      ? `<span class="badge badge-ok">${keyHint}</span>`
      : '<span class="badge badge-warn">à créer</span>';

    const curlCode = [
      `curl ${base}/chat/completions \\`,
      '  -H "Authorization: Bearer VOTRE_CLE_API" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '{"model":"${openaiModel}","messages":[{"role":"user","content":"Bonjour"}]}'`,
    ].join('\n');

    const nodeCode = [
      "import OpenAI from 'openai';",
      '',
      'const client = new OpenAI({',
      "  apiKey: 'VOTRE_CLE_API',",
      `  baseURL: '${base}',`,
      '});',
      '',
      'const completion = await client.chat.completions.create({',
      `  model: '${openaiModel}',`,
      "  messages: [{ role: 'user', content: 'Bonjour' }],",
      '});',
      '',
      'console.log(completion.choices[0].message.content);',
    ].join('\n');

    const pythonCode = [
      'from openai import OpenAI',
      '',
      'client = OpenAI(',
      '    api_key="VOTRE_CLE_API",',
      `    base_url="${base}",`,
      ')',
      '',
      'response = client.chat.completions.create(',
      `    model="${openaiModel}",`,
      '    messages=[{"role": "user", "content": "Bonjour"}],',
      ')',
      '',
      'print(response.choices[0].message.content)',
    ].join('\n');

    const anthropicCode = [
      `curl ${anthropic}/v1/messages \\`,
      '  -H "x-api-key: VOTRE_CLE_API" \\',
      '  -H "anthropic-version: 2023-06-01" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '{"model":"${anthropicModel}","max_tokens":1024,"messages":[{"role":"user","content":"Bonjour"}]}'`,
    ].join('\n');

    const codexCode = [
      '# ~/.codex/config.toml',
      `model = "${codexModel}"`,
      'model_provider = "valaria"',
      '',
      '[model_providers.valaria]',
      'name = "VALARIA Gateway"',
      `base_url = "${base}"`,
      'env_key = "VALARIA_API_KEY"',
      'wire_api = "responses"',
      '',
      '# Puis dans le terminal :',
      '# export VALARIA_API_KEY="VOTRE_CLE_API"',
      '# codex',
    ].join('\n');

    const claudeSettings = JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: anthropic,
        ANTHROPIC_AUTH_TOKEN: 'VOTRE_CLE_API',
        ANTHROPIC_MODEL: anthropicModel,
      },
    }, null, 2);

    const codexConfig = [
      '# ~/.codex/config.toml',
      `model = "${codexModel}"`,
      'model_provider = "valaria"',
      '',
      '[model_providers.valaria]',
      'name = "VALARIA Gateway"',
      `base_url = "${base}"`,
      'env_key = "VALARIA_API_KEY"',
      'wire_api = "responses"',
    ].join('\n');

    const codePanel = (id, label, code) => `
      <div class="guide-code-panel${id === 'curl' ? '' : ' hidden'}" data-code-panel="${id}">
        <div class="guide-code-top">
          <span>${esc(label)}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-guide-copy-target="guide-code-${id}">
            ${icon('copy')}Copier
          </button>
        </div>
        <pre class="guide-code" id="guide-code-${id}"><code>${esc(code)}</code></pre>
      </div>`;

    const modelUsage = (name) => {
      if (/opus/i.test(name)) return 'Raisonnement et tâches complexes';
      if (/fable/i.test(name)) return 'Écriture longue et créative';
      if (/codex|gpt-5/i.test(name)) return 'Codex / agents de code';
      if (/^o[34]/i.test(name)) return 'Raisonnement rapide';
      if (/gpt-4/i.test(name)) return 'Généraliste, code et analyse';
      if (/v4-pro/i.test(name)) return 'Généraliste, code et analyse';
      return 'Usage général';
    };

    return `
      <section class="panel guide-hero">
        <div class="guide-hero-copy">
          <p class="hero-kicker">Guide d'utilisation</p>
          <h2>Bien démarrer,<br><span class="accent-word">de votre clé au premier appel.</span></h2>
          <p class="guide-lede">Choisissez votre chemin : VALARIA Code pour coder dans le terminal, un SDK pour vos scripts, ou Claude Code et Codex CLI si vous les utilisez déjà. Tous passent par la même clé et le même crédit.</p>
          <div class="guide-hero-actions">
            <button type="button" class="btn btn-primary" data-guide-copy-target="guide-cli-install">${icon('copy')}Installer VALARIA Code</button>
            <button type="button" class="btn btn-ghost" data-guide-copy-target="guide-base-url">${icon('copy')}Copier l'URL de base</button>
            <button type="button" class="btn btn-ghost" data-guide-view="keys">${icon('key')}${hasKey ? 'Gérer ma clé' : 'Créer ma clé'}</button>
          </div>
          <div class="guide-hero-meta">
            <span class="chip">${icon('terminal')}VALARIA Code</span>
            <span class="chip">${icon('check')}OpenAI SDK</span>
            <span class="chip">${icon('terminal')}Codex CLI</span>
            <span class="chip">${icon('code')}cURL</span>
            <span class="chip">${icon('layers')}Streaming SSE</span>
          </div>
        </div>
        <div class="guide-terminal" aria-label="Aperçu d'une requête API">
          <div class="guide-terminal-bar">
            <span class="terminal-dots"><i></i><i></i><i></i></span>
            <span class="mono">POST /chat/completions</span>
            <span class="badge badge-ok">200</span>
          </div>
          <pre class="guide-terminal-code">{
  "model": "${esc(openaiModel)}",
  "messages": [
    { "role": "user", "content": "Bonjour" }
  ],
  "stream": true
}</pre>
          <div class="guide-terminal-foot">
            <span class="live-dot"></span>
            <span>réponse en streaming · ${esc(keyHint)}</span>
          </div>
        </div>
      </section>

      <div class="guide-steps">
        <article class="guide-step">
          <span class="guide-step-index">01</span>
          <div>
            <h3>Créez votre clé API</h3>
            <p>Elle commence par <code>sk-dsk-</code> et ne s'affiche qu'une fois : copiez-la tout de suite.</p>
            <button type="button" class="btn btn-ghost btn-sm" data-guide-view="keys">${icon('key')}Mes clés</button>
          </div>
        </article>
        <article class="guide-step">
          <span class="guide-step-index">02</span>
          <div>
            <h3>Copiez l'URL de base</h3>
            <p><code>${esc(base)}</code> remplace l'adresse d'OpenAI dans votre SDK ou votre client HTTP.</p>
            <button type="button" class="btn btn-ghost btn-sm" data-guide-copy-target="guide-base-url">${icon('copy')}Copier</button>
          </div>
        </article>
        <article class="guide-step">
          <span class="guide-step-index">03</span>
          <div>
            <h3>Faites un premier appel</h3>
            <p>Prenez un exemple plus bas et remplacez <code>VOTRE_CLE_API</code> par votre clé.</p>
            <a class="btn btn-ghost btn-sm" href="#guide-examples">${icon('arrow')}Voir un exemple</a>
          </div>
        </article>
      </div>

      <section class="panel guide-section guide-valaria-code" id="guide-valaria-code">
        <div class="panel-head">
          <div>
            <span class="guide-eyebrow">01 · VALARIA Code</span>
            <h2>L’agent de code dans votre terminal</h2>
            <span class="hint">Il se connecte par votre navigateur : vous n’avez aucune clé à coller.</span>
          </div>
          <span class="badge badge-ok">${icon('check')}nouveau</span>
        </div>
        <div class="guide-cli-grid">
          <div class="guide-cli-card">
            <div class="guide-cli-card-head">
              <span class="guide-client-icon">${icon('terminal')}</span>
              <div><h3>Installer et connecter</h3><p>Il faut Node.js 20 ou plus récent. Vous autorisez l’appareil depuis ce navigateur.</p></div>
            </div>
            <div class="guide-cli-steps">
              <div class="guide-cli-step">
                <span class="guide-client-num">1</span>
                <div>
                  <h4>Installer le CLI</h4>
                  <div class="guide-command-row">
                    <code id="guide-cli-install">npm install -g valaria-code</code>
                    <button type="button" class="icon-btn" data-guide-copy-target="guide-cli-install" aria-label="Copier la commande d’installation">${icon('copy')}</button>
                  </div>
                </div>
              </div>
              <div class="guide-cli-step">
                <span class="guide-client-num">2</span>
                <div>
                  <h4>Connecter l’appareil</h4>
                  <div class="guide-command-row">
                    <code id="guide-cli-login">valaria login</code>
                    <button type="button" class="icon-btn" data-guide-copy-target="guide-cli-login" aria-label="Copier valaria login">${icon('copy')}</button>
                  </div>
                  <p>Le terminal affiche un code et ouvre la page <code>/device</code>. Vérifiez que c’est le même code, autorisez l’appareil, puis choisissez Claude, Codex ou DeepSeek.</p>
                </div>
              </div>
              <div class="guide-cli-step">
                <span class="guide-client-num">3</span>
                <div>
                  <h4>Lancer l’agent</h4>
                  <div class="guide-command-row">
                    <code id="guide-cli-launch">valaria</code>
                    <button type="button" class="icon-btn" data-guide-copy-target="guide-cli-launch" aria-label="Copier valaria">${icon('copy')}</button>
                  </div>
                  <p>Lancez-le dans le dossier de votre projet et décrivez la tâche. L’agent lit les fichiers, propose un changement et, en mode Strict, attend votre accord avant d’écrire ou de lancer une commande.</p>
                </div>
              </div>
            </div>
          </div>
          <div class="guide-cli-gallery">
            <figure class="guide-cli-shot">
              <img src="/assets/valaria-code-focus.png" alt="VALARIA Code en mode Focus avec conversation et diff permanent." loading="lazy">
              <figcaption><strong>Focus</strong> · conversation et diff permanent</figcaption>
            </figure>
            <figure class="guide-cli-shot">
              <img src="/assets/valaria-code-studio.png" alt="VALARIA Code en mode Studio avec compte et quotas." loading="lazy">
              <figcaption><strong>Studio</strong> · compte, quotas et revue</figcaption>
            </figure>
            <figure class="guide-cli-shot">
              <img src="/assets/valaria-code-diff.png" alt="Revue de diff de VALARIA Code avec fichiers et lignes modifiées." loading="lazy">
              <figcaption><strong>Diff</strong> · fichiers en haut, lignes en bas</figcaption>
            </figure>
            <figure class="guide-cli-shot">
              <img src="/assets/valaria-code-approval.png" alt="Approbation d’un patch dans VALARIA Code." loading="lazy">
              <figcaption><strong>Approbation</strong> · décision avant écriture</figcaption>
            </figure>
          </div>
        </div>
        <div class="guide-cli-modes">
          <div class="guide-cli-mode"><strong>Strict</strong><span>Vous validez chaque écriture de fichier et chaque commande.</span></div>
          <div class="guide-cli-mode"><strong>Sécurisé</strong><span>Vous validez seulement les fichiers sensibles (<code>.env</code>, secrets, Docker) et les commandes risquées comme <code>rm -rf</code>.</span></div>
          <div class="guide-cli-mode"><strong>Accès total</strong><span>L’agent ne demande rien. Réservez ce mode aux projets que vous pouvez restaurer avec Git.</span></div>
        </div>
        <div class="guide-note">${icon('shield')}<span><strong>Ctrl+G</strong> ou <strong>Alt+M</strong> change de mode. <strong>PgUp/PgDn</strong> fait défiler la conversation. <code>/diff off</code> masque le diff et <code>/diff</code> le réaffiche. <code>/new</code> repart d’une conversation vide.</span></div>
      </section>

      <section class="panel guide-section" id="guide-cases">
        <div class="panel-head">
          <div>
            <span class="guide-eyebrow">02 · Par où commencer</span>
            <h2>Quel outil pour quel besoin ?</h2>
            <span class="hint">Chaque carte mène au bon exemple, avec le bon modèle.</span>
          </div>
        </div>
        <div class="guide-use-grid">
          <article class="guide-use-card">
            <span class="guide-use-icon">${icon('terminal')}</span>
            <h3>VALARIA Code</h3>
            <p>Pour coder : l’agent lit votre projet, propose des changements et lance les tests.</p>
            <div class="guide-use-meta"><code>npm install -g valaria-code</code></div>
            <a class="btn btn-ghost btn-sm" href="#guide-valaria-code">${icon('arrow')}Voir le guide</a>
          </article>
          <article class="guide-use-card">
            <span class="guide-use-icon">${icon('spark')}</span>
            <h3>Assistants et chat</h3>
            <p>Pour rédiger, résumer, traduire ou répondre à vos utilisateurs depuis vos scripts.</p>
            <div class="guide-use-meta"><code>${esc(chatModel)}</code></div>
            <button type="button" class="btn btn-ghost btn-sm" data-guide-usecase="node">${icon('arrow')}Voir le guide</button>
          </article>
          <article class="guide-use-card">
            <span class="guide-use-icon">${icon('terminal')}</span>
            <h3>Codex CLI</h3>
            <p>Pour générer et réécrire du code avec le client en ligne de commande d’OpenAI.</p>
            <div class="guide-use-meta"><code>${esc(codexModel)}</code></div>
            <button type="button" class="btn btn-ghost btn-sm" data-guide-usecase="codex">${icon('arrow')}Voir le guide</button>
          </article>
          <article class="guide-use-card">
            <span class="guide-use-icon">${icon('book')}</span>
            <h3>Claude Code</h3>
            <p>Pour le client d’Anthropic et tout outil qui utilise le protocole Messages.</p>
            <div class="guide-use-meta"><code>${esc(anthropicModel)}</code></div>
            <button type="button" class="btn btn-ghost btn-sm" data-guide-usecase="anthropic">${icon('arrow')}Voir le guide</button>
          </article>
        </div>
      </section>

      <section class="panel guide-section guide-install" id="guide-install">
        <div class="panel-head">
          <div>
            <span class="guide-eyebrow">03 · Clients tiers</span>
            <h2>Utiliser Claude Code ou Codex CLI</h2>
            <span class="hint">De l’installation au premier lancement, avec la configuration à copier.</span>
          </div>
        </div>
        <div class="guide-client-grid">
          <article class="guide-client-card">
            <div class="guide-client-head">
              <span class="guide-client-icon">${icon('book')}</span>
              <div><h3>Claude Code</h3><p>Le client en ligne de commande d’Anthropic, installé avec npm.</p></div>
              <span class="badge badge-muted">JSON</span>
            </div>
            <div class="guide-client-step">
              <span class="guide-client-num">1</span>
              <div>
                <h4>Installer le CLI</h4>
                <div class="guide-command-row">
                  <code id="guide-claude-install">npm install -g @anthropic-ai/claude-code</code>
                  <button type="button" class="icon-btn" data-guide-copy-target="guide-claude-install" aria-label="Copier la commande d'installation Claude Code">${icon('copy')}</button>
                </div>
              </div>
            </div>
            <div class="guide-client-step">
              <span class="guide-client-num">2</span>
              <div>
                <h4>Configurer <code>~/.claude/settings.json</code></h4>
                <p class="guide-client-hint">Créez le dossier <code>.claude</code> s'il n'existe pas, puis collez ce JSON dans le fichier. Sous Windows, le chemin est <code>%USERPROFILE%\\.claude\\settings.json</code>.</p>
                <div class="guide-config-head"><span>settings.json</span><button type="button" class="btn btn-ghost btn-sm" data-guide-copy-target="guide-claude-settings">${icon('copy')}Copier</button></div>
                <pre class="guide-config" id="guide-claude-settings"><code>${esc(claudeSettings)}</code></pre>
              </div>
            </div>
            <div class="guide-client-step">
              <span class="guide-client-num">3</span>
              <div>
                <h4>Lancer Claude Code</h4>
                <div class="guide-command-row">
                  <code id="guide-claude-launch">claude</code>
                  <button type="button" class="icon-btn" data-guide-copy-target="guide-claude-launch" aria-label="Copier la commande de lancement Claude Code">${icon('copy')}</button>
                </div>
                <p class="guide-client-hint">Lancez-le dans le dossier de votre projet. Claude Code prend l’adresse, la clé et le modèle dans <code>settings.json</code>.</p>
              </div>
            </div>
          </article>

          <article class="guide-client-card">
            <div class="guide-client-head">
              <span class="guide-client-icon">${icon('terminal')}</span>
              <div><h3>Codex CLI</h3><p>Le client en ligne de commande d’OpenAI, installé avec npm.</p></div>
              <span class="badge badge-muted">TOML</span>
            </div>
            <div class="guide-client-step">
              <span class="guide-client-num">1</span>
              <div>
                <h4>Installer le CLI</h4>
                <div class="guide-command-row">
                  <code id="guide-codex-install">npm install -g @openai/codex</code>
                  <button type="button" class="icon-btn" data-guide-copy-target="guide-codex-install" aria-label="Copier la commande d'installation Codex">${icon('copy')}</button>
                </div>
              </div>
            </div>
            <div class="guide-client-step">
              <span class="guide-client-num">2</span>
              <div>
                <h4>Configurer <code>~/.codex/config.toml</code></h4>
                <p class="guide-client-hint">Créez le dossier <code>.codex</code> s'il n'existe pas. Attention : Codex lit un fichier TOML, pas du JSON. Sous Windows, le chemin est <code>%USERPROFILE%\\.codex\\config.toml</code>.</p>
                <div class="guide-config-head"><span>config.toml</span><button type="button" class="btn btn-ghost btn-sm" data-guide-copy-target="guide-codex-config">${icon('copy')}Copier</button></div>
                <pre class="guide-config" id="guide-codex-config"><code>${esc(codexConfig)}</code></pre>
              </div>
            </div>
            <div class="guide-client-step">
              <span class="guide-client-num">3</span>
              <div>
                <h4>Définir la clé et lancer</h4>
                <div class="guide-config-head"><span>Terminal</span><button type="button" class="btn btn-ghost btn-sm" data-guide-copy-target="guide-codex-launch">${icon('copy')}Copier</button></div>
                <pre class="guide-config" id="guide-codex-launch"><code>export VALARIA_API_KEY="VOTRE_CLE_API"
codex</code></pre>
                <p class="guide-client-hint">Sous Windows PowerShell, tapez <code>$env:VALARIA_API_KEY="VOTRE_CLE_API"</code> puis <code>codex</code>, depuis le dossier de votre projet.</p>
              </div>
            </div>
          </article>
        </div>
        <div class="guide-prereq">${icon('help')}<span><strong>Avant de commencer :</strong> il vous faut Node.js 20 ou plus récent, avec npm. Vérifiez avec <code>node --version</code> et <code>npm --version</code>. Chaque client a son propre fichier de configuration : JSON pour Claude Code, TOML pour Codex CLI.</span></div>
      </section>

      <div class="guide-layout">
        <aside class="panel guide-toc-panel">
          <p class="guide-toc-title">Sommaire</p>
          <nav class="guide-toc" aria-label="Sommaire du guide">
            <a href="#guide-valaria-code">${icon('terminal')}VALARIA Code</a>
            <a href="#guide-cases">${icon('spark')}Par où commencer</a>
            <a href="#guide-install">${icon('terminal')}Claude Code et Codex</a>
            <a href="#guide-endpoints">${icon('globe')}Adresses de l'API</a>
            <a href="#guide-examples">${icon('code')}Premiers exemples</a>
            <a href="#guide-models">${icon('layers')}Modèles</a>
            <a href="#guide-params">${icon('settings')}Paramètres</a>
            <a href="#guide-errors">${icon('shield')}Erreurs et limites</a>
            <a href="#guide-faq">${icon('help')}FAQ</a>
          </nav>
          <div class="guide-toc-help">
            <p class="small muted">Une question sur votre compte ?</p>
            <button type="button" class="btn btn-ghost btn-sm" data-guide-view="settings">${icon('settings')}Réglages</button>
          </div>
        </aside>

        <div class="guide-content">
          <section class="panel guide-section" id="guide-endpoints">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">04 · Connexion</span>
                <h2>Les deux adresses de l'API</h2>
                <span class="hint">Deux formats, une seule clé.</span>
              </div>
              <span class="badge badge-ok">${icon('check')}opérationnel</span>
            </div>
            <div class="guide-endpoint-grid">
              <article class="guide-endpoint">
                <div class="guide-endpoint-head">
                  <span class="guide-endpoint-icon">${icon('globe')}</span>
                  <div><h3>Format OpenAI</h3><p>Pour le SDK OpenAI, Codex CLI, LangChain, LlamaIndex et vos scripts HTTP.</p></div>
                </div>
                <div class="guide-kv">
                  <span>Base URL</span>
                  <code id="guide-base-url">${esc(base)}</code>
                  <button type="button" class="icon-btn" data-guide-copy-target="guide-base-url" aria-label="Copier l'URL de base">${icon('copy')}</button>
                </div>
                <div class="guide-kv"><span>Auth</span><code>Authorization: Bearer VOTRE_CLE_API</code></div>
                <div class="guide-kv"><span>Format</span><code>POST /chat/completions</code></div>
              </article>
              <article class="guide-endpoint">
                <div class="guide-endpoint-head">
                  <span class="guide-endpoint-icon">${icon('terminal')}</span>
                  <div><h3>Format Anthropic</h3><p>Pour Claude Code et les outils qui utilisent le protocole Anthropic Messages.</p></div>
                </div>
                <div class="guide-kv">
                  <span>Base URL</span>
                  <code id="guide-anthropic-url">${esc(anthropic)}</code>
                  <button type="button" class="icon-btn" data-guide-copy-target="guide-anthropic-url" aria-label="Copier l'URL Anthropic">${icon('copy')}</button>
                </div>
                <div class="guide-kv"><span>Auth</span><code>x-api-key: VOTRE_CLE_API</code></div>
                <div class="guide-kv"><span>Version</span><code>anthropic-version: 2023-06-01</code></div>
                <p class="guide-footnote">${icon('help')}<span>2023-06-01 est le numéro de version du protocole Messages, pas une date d'expiration. Les SDK Anthropic et Claude Code l'ajoutent tout seuls.</span></p>
              </article>
            </div>
            <div class="guide-note">${icon('lock')}<span>Votre clé est personnelle. Ne la mettez jamais dans un dépôt Git : gardez-la dans une variable d'environnement ou un gestionnaire de secrets.</span></div>
          </section>

          <section class="panel guide-section" id="guide-examples">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">05 · Premier appel</span>
                <h2>Exemples prêts à copier</h2>
                <span class="hint">Remplacez <code>VOTRE_CLE_API</code> par votre clé.</span>
              </div>
              <span class="badge badge-muted">${esc(openaiModel)}</span>
            </div>
            <div class="guide-sdk-install">
              <div>
                <span class="guide-sdk-label">Node.js · SDK OpenAI</span>
                <div class="guide-command-row">
                  <code id="guide-sdk-node">npm install openai</code>
                  <button type="button" class="icon-btn" data-guide-copy-target="guide-sdk-node" aria-label="Copier npm install openai">${icon('copy')}</button>
                </div>
              </div>
              <div>
                <span class="guide-sdk-label">Python · SDK OpenAI</span>
                <div class="guide-command-row">
                  <code id="guide-sdk-python">pip install openai</code>
                  <button type="button" class="icon-btn" data-guide-copy-target="guide-sdk-python" aria-label="Copier pip install openai">${icon('copy')}</button>
                </div>
              </div>
            </div>
            <div class="code-tabs" role="tablist" aria-label="Langage de l'exemple">
              <button type="button" class="code-tab active" role="tab" aria-selected="true" data-guide-tab="curl">${icon('terminal')}cURL</button>
              <button type="button" class="code-tab" role="tab" aria-selected="false" data-guide-tab="node">${icon('code')}Node.js</button>
              <button type="button" class="code-tab" role="tab" aria-selected="false" data-guide-tab="python">${icon('code')}Python</button>
              <button type="button" class="code-tab" role="tab" aria-selected="false" data-guide-tab="codex">${icon('terminal')}Codex CLI</button>
              <button type="button" class="code-tab" role="tab" aria-selected="false" data-guide-tab="anthropic">${icon('terminal')}Anthropic</button>
            </div>
            <div class="guide-code-wrap">
              ${codePanel('curl', 'cURL', curlCode)}
              ${codePanel('node', 'Node.js · SDK OpenAI', nodeCode)}
              ${codePanel('python', 'Python · SDK OpenAI', pythonCode)}
              ${codePanel('codex', 'Codex CLI · ~/.codex/config.toml', codexCode)}
              ${codePanel('anthropic', 'Claude Code / Anthropic', anthropicCode)}
            </div>
            <div class="guide-inline-links">
              <button type="button" class="btn btn-ghost btn-sm" data-guide-view="keys">${icon('key')}Voir ma clé</button>
              <button type="button" class="btn btn-ghost btn-sm" data-guide-view="settings">${icon('settings')}Adresses de l'API</button>
            </div>
          </section>

          <section class="panel guide-section" id="guide-models">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">06 · Modèles</span>
                <h2>Modèles disponibles</h2>
                <span class="hint">Les modèles autorisés par votre pass.</span>
              </div>
            </div>
            ${models.length ? `<div class="table-wrap"><table class="guide-model-table">
              <thead><tr><th>Modèle</th><th>Idéal pour</th><th class="right">Statut</th></tr></thead>
              <tbody>${models.map((name) => `<tr>
                <td><code>${esc(name)}</code></td>
                <td class="muted">${esc(modelUsage(name))}</td>
                <td class="right"><span class="badge badge-ok">disponible</span></td>
              </tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-state">Aucun modèle autorisé pour le moment.</div>'}
            <p class="small muted" style="margin:10px 0 0">Copiez l'identifiant exact dans le champ <code>model</code>. Un modèle absent de cette liste peut être refusé.</p>
          </section>

          <section class="panel guide-section" id="guide-params">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">07 · Requête</span>
                <h2>Paramètres utiles</h2>
                <span class="hint">Les champs de requête que vous utiliserez le plus.</span>
              </div>
            </div>
            <div class="guide-param-grid">
              <div class="guide-param"><code>model</code><p>Identifiant du modèle, par exemple <code>${esc(openaiModel)}</code>.</p></div>
              <div class="guide-param"><code>messages</code><p>La conversation, message par message, avec le rôle de chacun (<code>system</code>, <code>user</code>, <code>assistant</code>).</p></div>
              <div class="guide-param"><code>stream</code><p>Mettez <code>true</code> pour recevoir la réponse au fil de l'eau (SSE), mot après mot.</p></div>
              <div class="guide-param"><code>temperature</code><p>Entre 0 et 2. Plus la valeur est basse, plus les réponses sont stables ; plus elle est haute, plus elles varient.</p></div>
              <div class="guide-param"><code>max_tokens</code><p>Longueur maximale de la réponse. Votre pass fixe un plafond ; sans valeur, c'est ce plafond qui s'applique.</p></div>
              <div class="guide-param"><code>stream_options</code><p>Ajoutez <code>{"include_usage": true}</code> pour recevoir le nombre de tokens à la fin du flux.</p></div>
            </div>
          </section>

          <section class="panel guide-section" id="guide-errors">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">08 · Diagnostic</span>
                <h2>Erreurs et limites</h2>
                <span class="hint">Le champ <code>error.code</code> de la réponse dit précisément ce qui bloque.</span>
              </div>
            </div>
            <div class="table-wrap"><table class="guide-model-table">
              <thead><tr><th>Code</th><th>Signification</th><th>Réflexe</th></tr></thead>
              <tbody>
                <tr><td><code>401</code></td><td>Clé absente, invalide ou régénérée depuis.</td><td>Vérifiez l'en-tête <code>Authorization</code> (ou <code>x-api-key</code> au format Anthropic).</td></tr>
                <tr><td><code>403</code></td><td>Accès désactivé, ou pass arrivé à sa date de fin.</td><td>Ouvrez <strong>Mon pass</strong> pour le renouveler, ou contactez l'administrateur.</td></tr>
                <tr><td><code>404</code></td><td>Modèle ou adresse inconnus.</td><td>Prenez un modèle de la liste ci-dessus et l'URL de base exacte.</td></tr>
                <tr><td><code>429</code> · <code>rate_limit_exceeded</code></td><td>Trop de requêtes par minute.</td><td>Attendez le délai indiqué par l'en-tête <code>Retry-After</code>, puis réessayez.</td></tr>
                <tr><td><code>429</code> · <code>concurrency_limit_exceeded</code></td><td>Trop d'appels en même temps.</td><td>Attendez la fin d'un appel en cours avant d'en lancer un autre.</td></tr>
                <tr><td><code>429</code> · <code>credit_window_exceeded</code></td><td>Plafond de crédit sur 5 heures atteint.</td><td>Le plafond se libère au fil des heures : réessayez plus tard.</td></tr>
                <tr><td><code>429</code> · <code>credit_week_exceeded</code></td><td>Plafond de crédit sur 7 jours glissants atteint.</td><td>Le plafond se libère à mesure que vos dépenses de plus de 7 jours sortent du calcul. Sinon, passez à un pass plus grand.</td></tr>
                <tr><td><code>429</code> · <code>insufficient_quota</code></td><td>Crédit du pass épuisé.</td><td>Consultez <strong>Consommation</strong>, puis renouvelez votre pass.</td></tr>
              </tbody>
            </table></div>
          </section>

          <section class="panel guide-section" id="guide-faq">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">09 · Aide</span>
                <h2>Questions fréquentes</h2>
                <span class="hint">Les réponses aux blocages les plus courants.</span>
              </div>
            </div>
            <div class="guide-faq">
              <details open>
                <summary>Où trouver ma clé API ?</summary>
                <p>Ouvrez <strong>Mes clés API</strong>. La clé complète ne s'affiche qu'une fois, à sa création ; ensuite, seul son début reste visible. Si vous l'avez perdue, régénérez-la : l'ancienne cesse aussitôt de fonctionner.</p>
              </details>
              <details>
                <summary>Quelle adresse choisir ?</summary>
                <p>Le <strong>format OpenAI</strong> convient à la plupart des SDK et des outils. Le <strong>format Anthropic</strong> sert aux clients qui utilisent le protocole Messages, comme Claude Code.</p>
              </details>
              <details>
                <summary>Comment suivre ma consommation ?</summary>
                <p><strong>Consommation</strong> montre les tokens et le coût jour par jour. <strong>Requêtes</strong> liste vos appels récents, avec le modèle, la durée et le coût de chacun.</p>
              </details>
              <details>
                <summary>Que se passe-t-il à la fin de mon pass ?</summary>
                <p>Le pass s'arrête à sa date de fin ou quand son crédit est épuisé, au premier des deux. Vos appels sont alors refusés jusqu'au renouvellement. Rien n'est prélevé automatiquement : c'est vous qui renouvelez depuis <strong>Mon pass</strong>.</p>
              </details>
              <details>
                <summary>Comment déconnecter un terminal ?</summary>
                <p>Ouvrez <strong>Réglages</strong>, section <strong>Appareils connectés</strong>, et révoquez l'appareil. Sur ce terminal, VALARIA Code devra repasser par <code>valaria login</code>.</p>
              </details>
              <details>
                <summary>Puis-je utiliser le SDK OpenAI ?</summary>
                <p>Oui. Indiquez votre clé et l'URL de base <code>${esc(base)}</code>. Les autres SDK compatibles OpenAI se configurent de la même façon.</p>
              </details>
            </div>
            <div class="guide-foot-actions">
              <button type="button" class="btn btn-primary btn-sm" data-guide-view="keys">${icon('key')}Gérer ma clé</button>
              <button type="button" class="btn btn-ghost btn-sm" data-guide-view="usage">${icon('chart')}Voir ma consommation</button>
            </div>
          </section>
        </div>
      </div>

      <div class="guide-status-bar">
        <span>${icon('shield')}Votre clé · ${keyState}</span>
        <span class="muted">URL : <code>${esc(base)}</code></span>
      </div>`;
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
      <td>${esc(String(row.day).split('-').reverse().join('/'))}</td>
      <td class="right">${fmtInt(row.requests)}</td>
      <td class="right">${fmtCompact(row.tokens)}</td>
      <td class="right">${fmtUsd(row.cost)}</td>
    </tr>`).join('');
    return `<div class="table-wrap"><table>
      <thead><tr><th>Jour</th><th class="right">Requêtes</th><th class="right">Tokens</th><th class="right">Coût</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  /* Compteurs animés : les nombres montent de 0 à leur valeur quand la vue s'affiche. */
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animateCounts(root, formatters) {
    if (!root) return;
    for (const el of root.querySelectorAll('[data-count]')) {
      const target = Number(el.dataset.count) || 0;
      const format = formatters[el.dataset.fmt] || ((v) => String(Math.round(v)));
      if (REDUCED_MOTION || target === 0) { el.textContent = format(target); continue; }
      const start = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - start) / 900);
        el.textContent = format(target * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  const countSpan = (value, kind) => `<span data-count="${Number(value) || 0}" data-fmt="${kind}">${COUNT_FORMATS[kind](value)}</span>`;

  function quotaCard(label, quota, kind) {
    const formatter = COUNT_FORMATS[kind];
    const limit = quota.limit;
    const used = quota.used ?? 0;
    if (!limit) {
      return `<article class="stat-card quota-card">
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-value">${countSpan(used, kind)}</div>
        <div class="quota-bar quota-bar-unlimited"><span></span></div>
        <div class="small muted">non plafonné</div>
      </article>`;
    }
    const pct = Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
    const level = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok';
    return `<article class="stat-card quota-card">
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value">${countSpan(used, kind)} <span class="stat-sub">/ ${formatter(limit)}</span></div>
      <div class="quota-bar ${level}" role="img" aria-label="${pct} % utilisé"><span style="width:${pct}%"></span></div>
      <div class="small muted">restant : ${formatter(Math.max(0, quota.remaining ?? 0))} · ${pct} % utilisé</div>
    </article>`;
  }

  function passCard(me) {
    const expiresAt = me.client.expiresAt ? new Date(me.client.expiresAt) : null;
    if (!expiresAt) {
      return `<article class="stat-card quota-card">
        <div class="stat-label">Fin du pass</div>
        <div class="stat-value pass-date">Sans date</div>
        <div class="small muted">s’arrête quand le crédit est épuisé</div>
      </article>`;
    }
    const days = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
    const dateLabel = expiresAt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    return `<article class="stat-card quota-card">
      <div class="stat-label">Fin du pass</div>
      <div class="stat-value">${days > 0 ? countSpan(days, 'days') : 'Terminé'}</div>
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
      const row = series[index] || {};
      const label = row.day ? DAY_LABEL.format(new Date(`${row.day}T00:00:00Z`)) : '';
      return `<rect class="chart-bar" style="--i:${index};--base:${H - padB}px" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="url(#portalGrad)"><title>${esc(label)} : ${fmtInt(value)} tokens, ${fmtInt(row.requests)} requêtes, ${fmtUsd(row.cost)}</title></rect>`;
    }).join('');
    const grid = [0.5, 1].map((f) => {
      const y = (H - padB - f * (H - padB - padT)).toFixed(1);
      return `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(220, 244, 255,.07)" stroke-dasharray="3 5"></line>`;
    }).join('');
    const first = series[0]?.day ? DAY_LABEL.format(new Date(`${series[0].day}T00:00:00Z`)) : '';
    const last = series[n - 1]?.day ? DAY_LABEL.format(new Date(`${series[n - 1].day}T00:00:00Z`)) : '';
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Consommation quotidienne en tokens sur 30 jours, ${fmtInt(total)} tokens au total">
      <defs>
        <linearGradient id="portalGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="#3c84cf" stop-opacity=".45"></stop>
          <stop offset="100%" stop-color="#8ccbea"></stop>
        </linearGradient>
      </defs>
      ${grid}
      <line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="rgba(220, 244, 255,.14)" stroke-width="1"></line>
      ${bars}
      <text x="0" y="${H - 6}" fill="#9faeb4" font-size="11" font-family="monospace">${first}</text>
      <text x="${W}" y="${H - 6}" text-anchor="end" fill="#9faeb4" font-size="11" font-family="monospace">${last}</text>
      <text x="4" y="${padT + 4}" fill="#9faeb4" font-size="11" font-family="monospace">max ${fmtCompact(max)} tokens/jour</text>
    </svg>`;
  }

  function limitsMarkup(me) {
    const rows = [
      me.plan
        ? ['pass', `${me.plan.name}${me.plan.durationDays ? ` · ${me.plan.durationDays} jours` : ''}`]
        : ['période', PERIOD_LABELS[me.client.period] || me.client.period],
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
    const accessLabel = me.plan ? `pass ${me.plan.name}` : (PERIOD_LABELS[me.client.period] || me.client.period);
    $('#portal-sub').textContent = `${me.client.name}${me.client.email ? ` · ${me.client.email}` : ` · clé ${me.client.keyPrefix}`} · ${accessLabel}`;
    $('#portal-version').textContent = me.server?.version ?? '';

    const passLine = $('#portal-pass');
    if (me.client.expiresAt) {
      const expiresAt = new Date(me.client.expiresAt);
      const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
      passLine.textContent = daysLeft > 0
        ? `Pass actif jusqu’au ${fmtDate(me.client.expiresAt)}. Il s’arrête plus tôt si le crédit est épuisé.`
        : `Pass terminé le ${fmtDate(me.client.expiresAt)}. Renouvelez-le dans Mon pass pour continuer.`;
      passLine.classList.toggle('pass-expired', daysLeft <= 0);
    } else {
      passLine.textContent = 'Accès sans date de fin. Il s’arrête quand le crédit est épuisé.';
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
    const cards = [
      quotaCard('Requêtes', q.requests, 'int'),
      quotaCard('Crédit du pass', q.usd, 'usd'),
    ];
    if (me.limits?.credit5h) cards.push(quotaCard('Crédit sur 5 h', me.limits.credit5h, 'usd'));
    if (me.limits?.creditWeek) cards.push(quotaCard('Crédit sur 7 jours', me.limits.creditWeek, 'usd'));
    cards.push(passCard(me));
    if (Number(me.client?.walletUsd) > 0) cards.push(quotaCard('Crédit rechargé', { used: 0, limit: me.client.walletUsd, remaining: me.client.walletUsd }, 'usd'));
    $('#portal-quotas').innerHTML = cards.join('');

    const series = me.usage?.series ?? [];
    $('#portal-chart-hint').textContent = `${fmtInt(me.usage?.totals?.requests ?? 0)} requêtes · ${fmtUsd2(me.usage?.totals?.cost ?? 0)} de crédit site`;
    $('#portal-chart').innerHTML = chartMarkup(series);

    $('#portal-limits').innerHTML = limitsMarkup(me);
    $('#portal-key-details').innerHTML = keyDetailsMarkup(me);
    $('#portal-plan-current').innerHTML = planCurrentMarkup(me);
    $('#portal-plan-grid').innerHTML = planGridMarkup(me);
    $('#plan-currency-note').textContent = planCurrencyNote();
    $('#portal-account-details').innerHTML = accountDetailsMarkup(me);
    loadDevices();
    $('#portal-endpoints').innerHTML = endpointsMarkup(me);
    $('#portal-usage-table').innerHTML = usageTableMarkup(me);
    $('#portal-usage-hint').textContent = `${fmtInt(me.usage?.totals?.requests ?? 0)} requêtes au total`;
    const profileName = $('#profile-form [name="displayName"]');
    if (profileName) profileName.value = me.client.name || '';
    const guideRoot = $('#portal-guide');
    if (guideRoot) {
      guideRoot.innerHTML = guideMarkup(me);
      paintIcons(guideRoot);
    }

    const totalRequests = me.usage?.totals?.requests ?? 0;
    $('#portal-logs-hint').textContent = `${fmtInt(totalRequests)} requêtes · ${fmtInt(me.usage?.today?.requests ?? 0)} aujourd'hui${totalRequests > 25 ? ' · les 25 plus récentes affichées' : ''}`;
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
    redirectAfterLogin();
  }

  /** Retour vers une page interne apres connexion (ex. /device?code=...). */
  function redirectAfterLogin() {
    const raw = new URLSearchParams(location.search).get('next');
    if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return;
    let target;
    try {
      target = new URL(raw, location.origin);
    } catch {
      return;
    }
    if (target.origin !== location.origin || !target.pathname.startsWith('/device')) return;
    location.assign(target.pathname + target.search);
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
    } finally {
      renderBillingPreview();
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
    $('#refresh-devices')?.addEventListener('click', loadDevices);
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-device-revoke]');
      if (button) revokeDevice(button.dataset.deviceRevoke, button.dataset.deviceName);
    });
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
      const previous = button.innerHTML;
      try {
        await navigator.clipboard.writeText($('#new-key-value').textContent || '');
        button.innerHTML = `${icon('check')}Copié`;
        setTimeout(() => { button.innerHTML = previous; }, 1500);
      } catch {
        button.textContent = 'Copie impossible';
      }
    });
    document.addEventListener('click', async (event) => {
      const amountButton = event.target.closest('[data-billing-base]');
      if (amountButton) {
        const input = $('#billing-custom-input');
        if (input) input.value = String(billingAmountValue(amountButton.dataset.billingBase));
        return;
      }
      const walletButton = event.target.closest('#billing-buy');
      if (walletButton) {
        event.preventDefault();
        await startWalletRecharge(walletButton);
        return;
      }
      const buyButton = event.target.closest('[data-buy-plan]');
      if (!buyButton) return;
      event.preventDefault();
      await startPlanPayment(buyButton.dataset.buyPlan, buyButton);
    });
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-copy]');
      if (!button) return;
      try {
        await navigator.clipboard.writeText(button.getAttribute('data-copy') || '');
        const previous = button.innerHTML;
        button.innerHTML = `${icon('check')}Copié`;
        setTimeout(() => { button.innerHTML = previous; }, 1500);
      } catch {
        button.textContent = 'Copie impossible';
      }
    });
    document.addEventListener('click', async (event) => {
      const guideView = event.target.closest('[data-guide-view]');
      if (guideView) {
        setUserView(guideView.dataset.guideView);
        return;
      }

      const copyButton = event.target.closest('[data-guide-copy-target]');
      if (copyButton) {
        const target = document.getElementById(copyButton.dataset.guideCopyTarget);
        if (!target) return;
        const previous = copyButton.innerHTML;
        try {
          await navigator.clipboard.writeText(target.textContent || '');
          copyButton.innerHTML = copyButton.classList.contains('icon-btn') ? icon('check') : `${icon('check')}Copié`;
          setTimeout(() => { copyButton.innerHTML = previous; }, 1500);
        } catch {
          toastInline(copyButton, 'Copie impossible');
        }
        return;
      }

      const useCase = event.target.closest('[data-guide-usecase]');
      if (useCase) {
        const tab = document.querySelector(`[data-guide-tab="${useCase.dataset.guideUsecase}"]`);
        if (tab) tab.click();
        document.getElementById('guide-examples')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      const codeTab = event.target.closest('[data-guide-tab]');
      if (codeTab) {
        const id = codeTab.dataset.guideTab;
        document.querySelectorAll('[data-guide-tab]').forEach((tab) => {
          const active = tab.dataset.guideTab === id;
          tab.classList.toggle('active', active);
          tab.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll('[data-code-panel]').forEach((panel) => {
          panel.classList.toggle('hidden', panel.dataset.codePanel !== id);
        });
      }
    });
  }

  function toastInline(element, message) {
    const previous = element.innerHTML;
    element.textContent = message;
    setTimeout(() => { element.innerHTML = previous; }, 1500);
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
    state.paymentsEnabled = Boolean(config.paymentsEnabled);
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
    paintIcons();
    refreshStatus();
    setInterval(refreshStatus, 60_000);
    await detectEmailLogin();
    await loadCurrency();
    try {
      await loadMe();
      await confirmReturningPayment();
    } catch (err) {
      showLogin(err.status === 401 ? '' : err.message);
    }
  }

  init();
})();










