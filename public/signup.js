/* Création de compte VALARIA Gateway API — parcours séparé de la connexion. */
(() => {
  'use strict';

  const CSRF_HEADER = 'x-requested-with';
  const CSRF_VALUE = 'dsk-portal';
  const $ = (selector) => document.querySelector(selector);
  const NF = new Intl.NumberFormat('fr-FR');
  const state = { busy: false, timers: {} };
  const captcha = { provider: null, siteKey: null, token: null, widget: null, loading: null };

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
      error.retryAfterSeconds = data?.retry_after_seconds ?? data?.error?.retry_after_seconds ?? data?.resend_in_seconds;
      throw error;
    }
    return data;
  }

  function showError(message = '') {
    $('#signup-error').textContent = message;
  }

  function setBusy(busy, button, label) {
    state.busy = busy;
    button.disabled = busy;
    button.textContent = busy ? 'Patientez…' : label;
  }

  function startCountdown(seconds) {
    clearInterval(state.timers.resend);
    const button = $('#signup-resend');
    let remaining = Math.max(0, Math.ceil(Number(seconds) || 0));
    if (!remaining) {
      button.disabled = false;
      button.textContent = 'Renvoyer un code';
      return;
    }
    button.disabled = true;
    button.textContent = `Renvoyer (${remaining} s)`;
    state.timers.resend = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(state.timers.resend);
        button.disabled = false;
        button.textContent = 'Renvoyer un code';
        return;
      }
      button.textContent = `Renvoyer (${remaining} s)`;
    }, 1000);
  }

  function loadCaptchaScript(provider) {
    const api = provider === 'hcaptcha' ? window.hcaptcha : window.turnstile;
    if (api) return Promise.resolve(api);
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

  async function initCaptcha(config) {
    const provider = config?.captchaProvider || 'turnstile';
    const siteKey = config?.captchaSiteKey || config?.turnstileSiteKey || null;
    captcha.provider = provider;
    captcha.siteKey = siteKey;
    if (!siteKey || provider === 'none') return;
    try {
      await loadCaptchaScript(provider);
      const slot = $('#signup-turnstile');
      if (!slot) return;
      slot.classList.remove('hidden');
      slot.innerHTML = '';
      const callbacks = {
        sitekey: siteKey,
        theme: 'dark',
        callback: (token) => { captcha.token = token; },
        'expired-callback': () => { captcha.token = null; },
        'error-callback': () => { captcha.token = null; },
      };
      if (provider === 'hcaptcha' && window.hcaptcha) captcha.widget = window.hcaptcha.render(slot, callbacks);
      else if (window.turnstile) captcha.widget = window.turnstile.render(slot, callbacks);
    } catch (err) {
      showError(err.message);
    }
  }

  function resetCaptcha() {
    captcha.token = null;
    try {
      if (captcha.provider === 'hcaptcha' && window.hcaptcha && captcha.widget != null) window.hcaptcha.reset(captcha.widget);
      else if (window.turnstile && captcha.widget != null) window.turnstile.reset(captcha.widget);
    } catch {
      /* ignore */
    }
  }

  async function requestCode() {
    if (state.busy) return;
    const email = $('#signup-email').value.trim();
    showError('');
    if (!email) {
      showError('Entrez votre adresse email.');
      $('#signup-email').focus();
      return;
    }
    const button = $('#signup-request-btn');
    setBusy(true, button, 'Recevoir mon code');
    try {
      const data = await api('/signup/request', {
        method: 'POST',
        body: { email, ...deviceFields(), captchaToken: captcha.token ?? null },
      });
      $('#signup-sent-note').textContent = `Code envoyé à ${email} (valable ${data.expiresMinutes ?? 10} minutes). Vérifiez aussi les spams.`;
      $('#signup-request-form').classList.add('hidden');
      $('#signup-verify-form').classList.remove('hidden');
      $('#signup-code').value = '';
      $('#signup-code').focus();
      startCountdown(data.resend_in_seconds ?? 30);
    } catch (err) {
      if (err.code === 'account_exists') {
        showError(`${err.message} Utilisez le lien « Se connecter » ci-dessous.`);
      } else {
        showError(err.message);
      }
      if (err.retryAfterSeconds) startCountdown(err.retryAfterSeconds);
    } finally {
      setBusy(false, button, 'Recevoir mon code');
      resetCaptcha();
    }
  }

  async function verifyCode() {
    if (state.busy) return;
    const email = $('#signup-email').value.trim();
    const code = $('#signup-code').value.replace(/\D/g, '');
    showError('');
    if (!/^\d{6}$/.test(code)) {
      showError('Entrez le code à 6 chiffres reçu par email.');
      $('#signup-code').focus();
      return;
    }
    const button = $('#signup-verify-btn');
    setBusy(true, button, 'Créer mon compte');
    try {
      await api('/signup/verify', { method: 'POST', body: { email, code, ...deviceFields() } });
      window.location.assign('/portal');
    } catch (err) {
      showError(err.message);
      $('#signup-code').focus();
    } finally {
      setBusy(false, button, 'Créer mon compte');
    }
  }

  function resetFlow() {
    clearInterval(state.timers.resend);
    $('#signup-request-form').classList.remove('hidden');
    $('#signup-verify-form').classList.add('hidden');
    $('#signup-code').value = '';
    $('#signup-sent-note').textContent = '';
    $('#signup-resend-status').textContent = '';
    showError('');
  }

  async function checkStatus() {
    try {
      const res = await fetch('/healthz', { headers: { accept: 'application/json' } });
      const data = await res.json();
      const badge = $('#site-status');
      if (badge) {
        badge.querySelector('.dot').className = 'dot ok';
        badge.querySelector('.status-text').textContent = `en ligne · v${data.version}`;
      }
    } catch { /* statut non bloquant */ }
  }

  async function init() {
    checkStatus();
    setInterval(checkStatus, 60_000);
    try {
      const config = await api('/config');
      if (!config.signupEnabled) {
        showError('L’inscription est actuellement fermée. Contactez l’administrateur.');
        $('#signup-request-btn').disabled = true;
        return;
      }
      await initCaptcha(config);
    } catch {
      showError('Impossible de vérifier la configuration de l’inscription.');
    }
  }

  $('#signup-request-form').addEventListener('submit', (event) => {
    event.preventDefault();
    requestCode();
  });
  $('#signup-verify-form').addEventListener('submit', (event) => {
    event.preventDefault();
    verifyCode();
  });
  $('#signup-resend').addEventListener('click', requestCode);
  $('#signup-back').addEventListener('click', resetFlow);
  init();
})();

