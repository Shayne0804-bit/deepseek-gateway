/* Autorisation d'un appareil CLI — page publique, approuvee par session portail. */
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const CSRF = { 'x-requested-with': 'dsk-portal' };
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const next = `${location.pathname}${location.search}`;

  function showError(message = '') {
    const error = $('#device-error');
    error.textContent = message;
    error.classList.toggle('visible', Boolean(message));
  }

  function formatCode(value) {
    const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
  }

  async function getSession() {
    const res = await fetch('/portal/api/me', { headers: { accept: 'application/json' }, credentials: 'same-origin' });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
    return res.json();
  }

  async function approve(event) {
    event.preventDefault();
    showError('');
    const input = $('#device-code');
    const userCode = formatCode(input.value);
    if (userCode.length !== 9) {
      showError('Entrez le code complet affiché dans le terminal (format XXXX-XXXX).');
      input.focus();
      return;
    }
    const button = $('#device-approve-btn');
    button.disabled = true;
    button.textContent = 'Autorisation…';
    try {
      const res = await fetch('/portal/api/device/approve', {
        method: 'POST',
        headers: { ...CSRF, 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ user_code: userCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || `Erreur HTTP ${res.status}`);
      $('#device-approve-panel').classList.add('hidden');
      $('#device-success').classList.remove('hidden');
    } catch (error) {
      showError(error.message);
      input.focus();
    } finally {
      button.disabled = false;
      button.textContent = 'Autoriser l’appareil';
    }
  }

  async function checkStatus() {
    try {
      const res = await fetch('/healthz', { headers: { accept: 'application/json' } });
      const data = await res.json();
      const badge = $('#site-status');
      badge.querySelector('.dot').className = 'dot ok';
      badge.querySelector('.status-text').textContent = `en ligne · v${data.version}`;
    } catch { /* footer status non bloquant */ }
  }

  async function init() {
    checkStatus();
    const input = $('#device-code');
    input.value = formatCode(code);
    $('#device-login-code').textContent = code ? formatCode(code) : '—';
    input.addEventListener('input', () => { input.value = formatCode(input.value); });
    $('#device-approve-form').addEventListener('submit', approve);
    try {
      const me = await getSession();
      $('#device-loading').classList.add('hidden');
      if (!me) {
        const login = $('#device-login-link');
        login.href = `/portal?next=${encodeURIComponent(next)}`;
        $('#device-login-required').classList.remove('hidden');
        return;
      }
      $('#device-account').textContent = `Connecté en tant que ${me.client?.name || 'utilisateur'}${me.client?.email ? ` · ${me.client.email}` : ''}.`;
      $('#device-approve-panel').classList.remove('hidden');
      input.focus();
    } catch (error) {
      $('#device-loading').classList.add('hidden');
      $('#device-login-required').classList.remove('hidden');
      showError(error.message);
    }
  }

  init();
})();
