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
        <p class="plan-price">${formatPlanPrice(plan.priceEur)} <span class="plan-period">/ ${plan.durationDays} j</span></p>
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

  function guideMarkup(me) {
    const base = me.baseUrl || '';
    const anthropic = me.anthropicBaseUrl || `${base.replace(/\/v1\/?$/, '')}/anthropic`;
    const models = (me.models ?? []).filter((name) => !/deepseek/i.test(name));
    const model = models[0] || 'votre-modele';
    const hasKey = Boolean(me.client?.hasKey);
    const keyHint = hasKey ? `${me.client.keyPrefix}…` : 'Aucune clé active';
    const keyState = hasKey
      ? `<span class="badge badge-ok">${keyHint}</span>`
      : '<span class="badge badge-warn">à créer</span>';

    const curlCode = [
      `curl ${base}/chat/completions \\`,
      '  -H "Authorization: Bearer VOTRE_CLE_API" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '{"model":"${model}","messages":[{"role":"user","content":"Bonjour"}]}'`,
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
      `  model: '${model}',`,
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
      `    model="${model}",`,
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
      `  -d '{"model":"${model}","max_tokens":1024,"messages":[{"role":"user","content":"Bonjour"}]}'`,
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
      if (/v4-pro/i.test(name)) return 'Généraliste, code et analyse';
      return 'Usage général';
    };

    return `
      <section class="panel guide-hero">
        <div class="guide-hero-copy">
          <p class="hero-kicker">Guide d'intégration</p>
          <h2>De la clé au premier appel,<br><span class="accent-word">en quelques minutes.</span></h2>
          <p class="guide-lede">Une API compatible OpenAI, des exemples prêts à copier et un endpoint Anthropic pour Claude Code. Choisissez votre langage, collez votre clé, c'est parti.</p>
          <div class="guide-hero-actions">
            <button type="button" class="btn btn-primary" data-guide-copy-target="guide-base-url">${icon('copy')}Copier l'URL de base</button>
            <button type="button" class="btn btn-ghost" data-guide-view="keys">${icon('key')}${hasKey ? 'Gérer ma clé' : 'Créer ma clé'}</button>
          </div>
          <div class="guide-hero-meta">
            <span class="chip">${icon('check')}OpenAI SDK</span>
            <span class="chip">${icon('terminal')}cURL</span>
            <span class="chip">${icon('layers')}Streaming SSE</span>
            <span class="chip">${icon('shield')}Clé dérivée</span>
          </div>
        </div>
        <div class="guide-terminal" aria-label="Aperçu d'une requête API">
          <div class="guide-terminal-bar">
            <span class="terminal-dots"><i></i><i></i><i></i></span>
            <span class="mono">POST /chat/completions</span>
            <span class="badge badge-ok">200</span>
          </div>
          <pre class="guide-terminal-code">{
  "model": "${esc(model)}",
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
            <p>Une clé <code>sk-dsk-…</code> personnelle, affichée une seule fois.</p>
            <button type="button" class="btn btn-ghost btn-sm" data-guide-view="keys">${icon('key')}Mes clés</button>
          </div>
        </article>
        <article class="guide-step">
          <span class="guide-step-index">02</span>
          <div>
            <h3>Copiez l'URL de base</h3>
            <p><code>${esc(base)}</code> — à utiliser dans votre SDK ou votre client HTTP.</p>
            <button type="button" class="btn btn-ghost btn-sm" data-guide-copy-target="guide-base-url">${icon('copy')}Copier</button>
          </div>
        </article>
        <article class="guide-step">
          <span class="guide-step-index">03</span>
          <div>
            <h3>Envoyez votre premier appel</h3>
            <p>Choisissez un exemple ci-dessous et remplacez la clé.</p>
            <a class="btn btn-ghost btn-sm" href="#guide-examples">${icon('arrow')}Voir un exemple</a>
          </div>
        </article>
      </div>

      <div class="guide-layout">
        <aside class="panel guide-toc-panel">
          <p class="guide-toc-title">Sommaire</p>
          <nav class="guide-toc" aria-label="Sommaire du guide">
            <a href="#guide-endpoints">${icon('globe')}Points d'accès</a>
            <a href="#guide-examples">${icon('code')}Premiers exemples</a>
            <a href="#guide-models">${icon('layers')}Modèles</a>
            <a href="#guide-params">${icon('settings')}Paramètres</a>
            <a href="#guide-errors">${icon('shield')}Erreurs & quotas</a>
            <a href="#guide-faq">${icon('help')}FAQ</a>
          </nav>
          <div class="guide-toc-help">
            <p class="small muted">Besoin d'un coup de main ?</p>
            <button type="button" class="btn btn-ghost btn-sm" data-guide-view="settings">${icon('settings')}Réglages</button>
          </div>
        </aside>

        <div class="guide-content">
          <section class="panel guide-section" id="guide-endpoints">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">01 · Connexion</span>
                <h2>Points d'accès</h2>
                <span class="hint">Deux formats compatibles, une seule clé.</span>
              </div>
              <span class="badge badge-ok">${icon('check')}opérationnel</span>
            </div>
            <div class="guide-endpoint-grid">
              <article class="guide-endpoint">
                <div class="guide-endpoint-head">
                  <span class="guide-endpoint-icon">${icon('globe')}</span>
                  <div><h3>OpenAI-compatible</h3><p>SDK OpenAI, LangChain, LlamaIndex, scripts HTTP.</p></div>
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
                  <div><h3>Claude Code / Anthropic</h3><p>Pour les clients qui parlent le protocole Anthropic Messages.</p></div>
                </div>
                <div class="guide-kv">
                  <span>Base URL</span>
                  <code id="guide-anthropic-url">${esc(anthropic)}</code>
                  <button type="button" class="icon-btn" data-guide-copy-target="guide-anthropic-url" aria-label="Copier l'URL Anthropic">${icon('copy')}</button>
                </div>
                <div class="guide-kv"><span>Auth</span><code>x-api-key: VOTRE_CLE_API</code></div>
                <div class="guide-kv"><span>Version</span><code>anthropic-version: 2023-06-01</code></div>
                <p class="guide-footnote">${icon('help')}<span>« 2023-06-01 » est l'identifiant de version du protocole Messages, pas une date d'expiration. Les SDK Anthropic et Claude Code l'ajoutent automatiquement.</span></p>
              </article>
            </div>
            <div class="guide-note">${icon('lock')}<span>Votre clé est personnelle et n'expose jamais le fournisseur. Ne la partagez pas et stockez-la dans un gestionnaire de secrets.</span></div>
          </section>

          <section class="panel guide-section" id="guide-examples">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">02 · Premier appel</span>
                <h2>Exemples prêts à copier</h2>
                <span class="hint">Remplacez <code>VOTRE_CLE_API</code> par votre clé.</span>
              </div>
              <span class="badge badge-muted">${esc(model)}</span>
            </div>
            <div class="code-tabs" role="tablist" aria-label="Langage de l'exemple">
              <button type="button" class="code-tab active" role="tab" aria-selected="true" data-guide-tab="curl">${icon('terminal')}cURL</button>
              <button type="button" class="code-tab" role="tab" aria-selected="false" data-guide-tab="node">${icon('code')}Node.js</button>
              <button type="button" class="code-tab" role="tab" aria-selected="false" data-guide-tab="python">${icon('code')}Python</button>
              <button type="button" class="code-tab" role="tab" aria-selected="false" data-guide-tab="anthropic">${icon('terminal')}Anthropic</button>
            </div>
            <div class="guide-code-wrap">
              ${codePanel('curl', 'cURL', curlCode)}
              ${codePanel('node', 'Node.js — SDK OpenAI', nodeCode)}
              ${codePanel('python', 'Python — SDK OpenAI', pythonCode)}
              ${codePanel('anthropic', 'Claude Code / Anthropic', anthropicCode)}
            </div>
            <div class="guide-inline-links">
              <button type="button" class="btn btn-ghost btn-sm" data-guide-view="keys">${icon('key')}Voir ma clé</button>
              <button type="button" class="btn btn-ghost btn-sm" data-guide-view="settings">${icon('settings')}Points d'accès</button>
            </div>
          </section>

          <section class="panel guide-section" id="guide-models">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">03 · Modèles</span>
                <h2>Modèles disponibles</h2>
                <span class="hint">Les alias autorisés pour votre compte.</span>
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
            <p class="small muted" style="margin:14px 0 0">Utilisez l'identifiant exact comme valeur de <code>model</code>. Les modèles non listés peuvent être refusés par votre pass.</p>
          </section>

          <section class="panel guide-section" id="guide-params">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">04 · Requête</span>
                <h2>Paramètres utiles</h2>
                <span class="hint">Les clés que vous utiliserez le plus souvent.</span>
              </div>
            </div>
            <div class="guide-param-grid">
              <div class="guide-param"><code>model</code><p>Identifiant du modèle, par exemple <code>${esc(model)}</code>.</p></div>
              <div class="guide-param"><code>messages</code><p>Liste des tours de conversation ; le contenu peut être du texte ou des parties multimodales.</p></div>
              <div class="guide-param"><code>stream</code><p><code>true</code> pour recevoir la réponse en SSE, idéal pour un effet de frappe.</p></div>
              <div class="guide-param"><code>temperature</code><p>Entre 0 et 2. Plus bas = réponses déterministes, plus haut = plus créatives.</p></div>
              <div class="guide-param"><code>max_tokens</code><p>Plafonné par votre pass. Laissez vide pour utiliser la limite du modèle.</p></div>
              <div class="guide-param"><code>stream_options</code><p>Ajoutez <code>{"include_usage": true}</code> pour recevoir les tokens en fin de flux.</p></div>
            </div>
          </section>

          <section class="panel guide-section" id="guide-errors">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">05 · Diagnostic</span>
                <h2>Erreurs & quotas</h2>
                <span class="hint">Les réponses à connaître avant de déboguer.</span>
              </div>
            </div>
            <div class="table-wrap"><table class="guide-model-table">
              <thead><tr><th>Code</th><th>Signification</th><th>Réflexe</th></tr></thead>
              <tbody>
                <tr><td><code>401</code></td><td>Clé absente ou invalide.</td><td>Vérifiez l'en-tête <code>Authorization</code>.</td></tr>
                <tr><td><code>403</code></td><td>Accès désactivé ou pass expiré.</td><td>Ouvrez <strong>Mon pass</strong> ou contactez l'administrateur.</td></tr>
                <tr><td><code>404</code></td><td>Modèle ou route inconnue.</td><td>Utilisez un modèle listé et l'URL de base exacte.</td></tr>
                <tr><td><code>429</code></td><td>Débit trop élevé.</td><td>Respectez <code>Retry-After</code> et votre limite req/min.</td></tr>
                <tr><td><code>402</code> / quota</td><td>Quota ou crédit épuisé.</td><td>Consultez <strong>Consommation</strong> et renouvelez votre pass.</td></tr>
              </tbody>
            </table></div>
          </section>

          <section class="panel guide-section" id="guide-faq">
            <div class="panel-head">
              <div>
                <span class="guide-eyebrow">06 · Aide</span>
                <h2>Questions fréquentes</h2>
                <span class="hint">Les réponses aux blocages les plus courants.</span>
              </div>
            </div>
            <div class="guide-faq">
              <details open>
                <summary>Où trouver ma clé API ?</summary>
                <p>Ouvrez <strong>Mes clés API</strong>. La clé complète est affichée une seule fois à la création ; ensuite seule son empreinte reste visible. Si vous l'avez perdue, régénérez-la.</p>
              </details>
              <details>
                <summary>Quel endpoint choisir ?</summary>
                <p>Utilisez l'endpoint <strong>OpenAI-compatible</strong> pour la majorité des SDK et outils. L'endpoint <strong>Anthropic</strong> est destiné aux clients qui parlent le protocole Messages, comme Claude Code.</p>
              </details>
              <details>
                <summary>Comment suivre ma consommation ?</summary>
                <p>La page <strong>Consommation</strong> détaille les tokens et le coût par jour. La page <strong>Requêtes</strong> donne le détail des appels récents et leur latence.</p>
              </details>
              <details>
                <summary>Puis-je utiliser le SDK OpenAI ?</summary>
                <p>Oui. Renseignez votre clé et l'URL de base <code>${esc(base)}</code>. Les autres SDK compatibles OpenAI fonctionnent de la même manière.</p>
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
        <span>${icon('shield')}Connexion chiffrée · ${keyState}</span>
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
    $('#portal-chart-hint').textContent = `${fmtInt(me.usage?.totals?.requests ?? 0)} requêtes · ${fmtUsd(me.usage?.totals?.cost ?? 0)} de crédit site`;
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
    const guideRoot = $('#portal-guide');
    if (guideRoot) {
      guideRoot.innerHTML = guideMarkup(me);
      paintIcons(guideRoot);
    }

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
    } catch (err) {
      showLogin(err.status === 401 ? '' : err.message);
    }
  }

  init();
})();






