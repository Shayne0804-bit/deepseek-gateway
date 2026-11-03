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
  const state = { me: null, busy: false, emailBusy: false };

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
      throw error;
    }
    return data;
  }

  function showLogin(message = '') {
    state.me = null;
    $('#portal-app').classList.add('hidden');
    $('#login-view').classList.remove('hidden');
    $('#portal-error').textContent = message;
    resetEmailFlow();
    setAuthTab('key');
    $('#portal-key').focus();
  }

  function setAuthTab(mode) {
    const emailMode = mode === 'email';
    const keyTab = $('#tab-key');
    const emailTab = $('#tab-email');
    const keyPanel = $('#panel-key');
    const emailPanel = $('#panel-email');
    if (!keyTab || !emailTab) return;
    keyTab.classList.toggle('active', !emailMode);
    keyTab.setAttribute('aria-selected', String(!emailMode));
    keyTab.tabIndex = emailMode ? -1 : 0;
    emailTab.classList.toggle('active', emailMode);
    emailTab.setAttribute('aria-selected', String(emailMode));
    emailTab.tabIndex = emailMode ? 0 : -1;
    keyPanel.classList.toggle('hidden', emailMode);
    emailPanel.classList.toggle('hidden', !emailMode);
    $('#email-error').textContent = '';
    if (emailMode) $('#email-address').focus();
    else $('#portal-key').focus();
  }

  function showEmailError(message = '') {
    $('#email-error').textContent = message;
  }

  function resetEmailFlow() {
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
      const data = await api('/email/request', { method: 'POST', body: { email } });
      $('#email-sent-note').textContent = `${data.message} Le code est valable ${data.expiresMinutes ?? 10} minutes.`;
      $('#email-request-form').classList.add('hidden');
      $('#email-verify-form').classList.remove('hidden');
      $('#email-code').value = '';
      $('#email-code').focus();
    } catch (err) {
      showEmailError(err.message);
    } finally {
      state.emailBusy = false;
      button.disabled = false;
      button.textContent = 'Recevoir un code';
    }
  }

  async function verifyEmailCode() {
    if (state.emailBusy) return;
    const email = $('#email-address').value.trim();
    const code = $('#email-code').value.replace(/\s+/g, '');
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
      await api('/email/verify', { method: 'POST', body: { email, code } });
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
        <div class="small muted">aucun plafond configuré</div>
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
      ['expiration', me.client.expiresAt ? fmtDate(me.client.expiresAt) : 'aucune'],
      ['depuis', fmtDate(me.client.createdAt)],
    ];
    const models = (me.limits.allowedModels ?? []).length
      ? me.limits.allowedModels
      : me.models;
    return `${rows.map(([key, value]) => `<div class="spec-row"><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}
      <div class="spec-row"><dt>modèles</dt><dd class="chips">${models.map((model) => `<span class="chip">${esc(model)}</span>`).join('')}</dd></div>`;
  }

  function logsMarkup(rows) {
    if (!rows.length) {
      return '<div class="empty-state"><strong>Aucune requête pour le moment</strong><p>Les appels effectués avec votre clé apparaîtront ici.</p></div>';
    }
    const body = rows.map((row) => {
      const ok = Number(row.status) >= 200 && Number(row.status) < 300;
      const model = row.requestedModel
        ? `${esc(row.requestedModel)}<br><span class="muted">facturé : ${esc(row.model || '—')}</span>`
        : esc(row.model || '—');
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
    const curl = `curl ${me.baseUrl}/chat/completions \\\n  -H "Authorization: Bearer VOTRE_CLE" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"deepseek-flash","messages":[{"role":"user","content":"Bonjour"}]}'`;
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

    const status = $('#portal-status');
    if (me.status && me.status !== 'ok') {
      status.className = 'portal-status alert danger';
      status.innerHTML = `<strong>${esc(me.statusMessage || 'Cette clé ne peut pas envoyer de requêtes.')}</strong>`;
    } else {
      status.className = 'portal-status hidden';
      status.textContent = '';
    }

    const q = me.quota;
    $('#portal-quotas').innerHTML = [
      quotaCard('Tokens', q.tokens, fmtCompact),
      quotaCard('Requêtes', q.requests, fmtInt),
      quotaCard('Coût estimé', q.usd, fmtUsd),
    ].join('');

    const series = me.usage?.series ?? [];
    $('#portal-chart-hint').textContent = `${fmtInt(me.usage?.totals?.requests ?? 0)} requêtes (historique) · ${fmtUsd(me.usage?.totals?.cost ?? 0)}`;
    $('#portal-chart').innerHTML = chartMarkup(series);

    $('#portal-limits').innerHTML = limitsMarkup(me);
    $('#portal-logs-hint').textContent = `${fmtInt(me.usage?.totals?.requests ?? 0)} au total · aujourd'hui : ${fmtInt(me.usage?.today?.requests ?? 0)}`;
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
    $('#tab-key').addEventListener('click', () => setAuthTab('key'));
    $('#tab-email').addEventListener('click', () => setAuthTab('email'));
    for (const id of ['tab-key', 'tab-email']) {
      $(`#${id}`).addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        setAuthTab($('#tab-email').classList.contains('active') ? 'key' : 'email');
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
      if (config.emailLoginEnabled) {
        $('#tab-email').classList.remove('hidden');
      } else {
        // Un seul mode : la barre d'onglets n'apporte rien.
        document.querySelector('.auth-tabs').classList.add('hidden');
      }
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

