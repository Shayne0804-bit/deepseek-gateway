/* ============================================================
   DeepSeek Gateway — panneau d'administration (vanilla JS)
   ============================================================ */
(() => {
  'use strict';

  const VIEW_TITLES = {
    overview: "Vue d'ensemble",
    clients: 'Clés & quotas',
    logs: 'Journaux',
    audit: "Journal d'audit",
    settings: 'Réglages',
    guide: 'Guide pour votre ami',
  };
  const VIEW_SUBS = {
    overview: 'Activité, consommation et état des quotas.',
    clients: 'Créez une clé par personne ou par projet, avec ses propres limites.',
    logs: 'Les 100 dernières requêtes traitées par la passerelle.',
    audit: 'Traçabilité des actions d’administration (connexions, clés, réglages).',
    settings: 'Clé DeepSeek originale, URL publique, budget, tarifs et mot de passe.',
    guide: 'À transmettre tel quel à votre ami.',
  };
  const PERIOD_LABELS = { daily: 'par jour', monthly: 'par mois', total: 'total' };
  const STATUS_LABELS = {
    insufficient_quota: 'Quota épuisé',
    client_disabled: 'Désactivée',
    client_expired: 'Expirée',
    ok: 'Active',
  };
  const NF = new Intl.NumberFormat('fr-FR');

  const state = {
    view: 'overview',
    session: null,
    clients: [],
    overview: null,
    settings: null,
    audit: null,
    logs: { rows: [], total: 0, clientId: '' },
  };

  /* ------------------------------ helpers ------------------------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function fmtInt(n) {
    return NF.format(Math.round(Number(n) || 0));
  }

  function fmtCompact(n) {
    if (n == null) return 'Illimité';
    const v = Number(n);
    if (v >= 1e9) return `${(v / 1e9).toFixed(v % 1e9 === 0 ? 0 : 1).replace('.', ',')} Md`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1).replace('.', ',')} M`;
    if (v >= 100000) return `${Math.round(v / 1000)} k`;
    return NF.format(v);
  }

  function fmtUsd(n) {
    if (n == null) return 'Illimité';
    const v = Number(n);
    if (v === 0) return '0 $';
    if (Math.abs(v) < 0.01) return `${v.toFixed(4).replace('.', ',')} $`;
    return `${v.toFixed(2).replace('.', ',')} $`;
  }

  function fmtMs(ms) {
    if (ms == null) return '—';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1).replace('.', ',')} s` : `${Math.round(ms)} ms`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function fmtFullDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function shortDay(day) {
    return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function appBaseUrl() {
    const configured = state.settings?.publicBaseUrl;
    return (configured || window.location.origin).replace(/\/+$/, '');
  }

  function apiBaseUrl() {
    const base = appBaseUrl();
    return base.endsWith('/v1') ? base : `${base}/v1`;
  }

  function anthropicBaseUrl() {
    const base = appBaseUrl();
    return base.endsWith('/v1') ? `${base.slice(0, -3)}/anthropic` : `${base}/anthropic`;
  }

  function remainingText(value) {
    return value == null ? 'illimité' : fmtCompact(value);
  }

  async function api(path, options = {}) {
    let res;
    try {
      res = await fetch(`/admin/api${path}`, {
        method: options.method || 'GET',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'same-origin',
      });
    } catch {
      throw new Error("La passerelle ne répond pas. Vérifiez qu'elle est démarrée, puis réessayez.");
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (res.status === 401 && path !== '/login' && path !== '/session') {
      showLogin();
      throw new Error('Session expirée, reconnectez-vous.');
    }
    if (!res.ok) {
      throw new Error(data?.error?.message || `Erreur HTTP ${res.status}`);
    }
    return data;
  }

  /* ------------------------------- toasts ------------------------------- */

  function toast(message, kind = 'info') {
    const root = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .25s';
      setTimeout(() => el.remove(), 260);
    }, 4600);
  }

  /* ------------------------------- modales ------------------------------ */

  function closeModal() {
    const root = $('#modal-root');
    if (root) root.innerHTML = '';
  }

  function openModal({ title, bodyHtml, footerHtml = '', formKind = null, submitLabel = 'Enregistrer', size = '' }) {
    const root = $('#modal-root');
    const inner = formKind
      ? `<form data-form="${esc(formKind)}">
           <div class="modal-body">${bodyHtml}</div>
           <div class="modal-foot">
             <button type="button" class="btn btn-ghost" data-close>Annuler</button>
             <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
           </div>
         </form>`
      : `<div class="modal-body">${bodyHtml}</div>
         <div class="modal-foot">${footerHtml}</div>`;
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${esc(size)}" role="dialog" aria-modal="true">
          <div class="modal-head">
            <h2>${esc(title)}</h2>
            <button type="button" class="icon-btn" data-close aria-label="Fermer">✕</button>
          </div>
          ${inner}
        </div>
      </div>`;
    const focusable = root.querySelector('input, select, textarea, button.btn-primary');
    if (focusable) setTimeout(() => focusable.focus(), 40);
  }

  function confirmModal({ title, message, confirmLabel = 'Confirmer', danger = false, onConfirm }) {
    openModal({
      title,
      bodyHtml: `<p style="margin:0;color:var(--muted)">${message}</p>`,
      footerHtml: `<button type="button" class="btn btn-ghost" data-close>Annuler</button>
                   <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-action">${esc(confirmLabel)}</button>`,
    });
    const button = $('#confirm-action');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await onConfirm();
      } catch (err) {
        toast(err.message, 'error');
        button.disabled = false;
      }
    });
  }

  function copyText(text, label = 'Copié dans le presse-papiers.') {
    const done = () => toast(label, 'success');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      done();
    } catch {
      toast('Copie impossible : sélectionnez le texte manuellement.', 'error');
    }
  }

  /* -------------------------------- auth -------------------------------- */

  function showLogin() {
    closeModal();
    $('#app-view').classList.add('hidden');
    $('#login-view').classList.remove('hidden');
    $('#login-error').classList.remove('visible');
    const password = $('#login-password');
    if (password) {
      password.value = '';
      setTimeout(() => password.focus(), 60);
    }
  }

  function showApp() {
    $('#login-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    setView(state.view || 'overview');
  }

  async function init() {
    try {
      const session = await api('/session');
      state.session = session;
      updateProviderPill(session.provider?.configured, session.provider?.source);
      $('#app-version').textContent = session.server?.version || '1.0.0';
      showApp();
    } catch {
      showLogin();
    }
  }

  async function handleLogin(form) {
    const password = form.elements.password.value;
    const errorEl = $('#login-error');
    errorEl.classList.remove('visible');
    try {
      const res = await fetch('/admin/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errorEl.textContent = data?.error?.message || 'Connexion refusée.';
        errorEl.classList.add('visible');
        form.elements.password.select();
        return;
      }
      form.reset();
      await init();
    } catch {
      errorEl.textContent = 'Impossible de contacter la passerelle.';
      errorEl.classList.add('visible');
    }
  }

  async function handleLogout() {
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      /* deja deconnecte */
    }
    state.session = null;
    state.clients = [];
    state.settings = null;
    showLogin();
  }

  function updateProviderPill(configured, source) {
    const dot = $('#provider-dot');
    const text = $('#provider-text');
    if (!dot || !text) return;
    dot.className = `dot ${configured ? 'ok' : 'warn'}`;
    if (configured) {
      text.textContent = `DeepSeek connecté${source === 'env' ? ' (env)' : ''}`;
    } else {
      text.textContent = 'Clé manquante';
    }
  }

  /* ----------------------------- navigation ----------------------------- */

  async function setView(view) {
    if (!VIEW_TITLES[view]) return;
    if (view !== 'logs') state.logs.clientId = '';
    state.view = view;
    $$('#nav .nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.nav === view));
    $('#page-title').textContent = VIEW_TITLES[view];
    $('#page-sub').textContent = VIEW_SUBS[view] || '';
    $('#view').innerHTML = '<div class="panel"><div class="muted">Chargement…</div></div>';
    try {
      await loadView(view);
    } catch (err) {
      $('#view').innerHTML = `<div class="panel">
        <div class="alert danger">${esc(err.message)}</div>
        <div class="form-actions" style="justify-content:flex-start">
          <button class="btn btn-ghost btn-sm" data-action="retry-view">Réessayer</button>
        </div>
      </div>`;
    }
  }

  async function loadView(view) {
    if (view === 'overview') {
      const data = await api('/overview');
      state.overview = data;
      updateProviderPill(data.provider?.configured, data.provider?.source);
      renderOverview(data);
    } else if (view === 'clients') {
      const data = await api('/clients');
      state.clients = data.clients;
      renderClients();
    } else if (view === 'logs') {
      await ensureClients();
      await loadLogs({ reset: true });
    } else if (view === 'audit') {
      state.audit = await api('/audit?limit=200');
      renderAudit();
    } else if (view === 'settings') {
      await loadSettings();
    } else if (view === 'guide') {
      if (!state.settings) await loadSettings();
      renderGuide();
    }
  }

  async function refreshCurrentView() {
    try {
      if (state.view === 'overview') {
        const data = await api('/overview');
        state.overview = data;
        renderOverview(data);
      } else if (state.view === 'clients') {
        const data = await api('/clients');
        state.clients = data.clients;
        renderClients();
      } else if (state.view === 'logs') {
        await loadLogs({ reset: true });
      } else if (state.view === 'audit') {
        state.audit = await api('/audit?limit=200');
        renderAudit();
      } else if (state.view === 'settings') {
        await loadSettings();
      } else if (state.view === 'guide' && state.settings) {
        renderGuide();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function ensureClients() {
    if (state.clients.length === 0) {
      const data = await api('/clients');
      state.clients = data.clients;
    }
  }

  /* ----------------------------- composants ----------------------------- */

  function statCard(label, value, foot) {
    return `<div class="stat-card">
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-foot">${esc(foot || '')}</div>
    </div>`;
  }

  function statusBadge(client) {
    if (!client.enabled) return '<span class="badge badge-muted">Désactivée</span>';
    if (client.status === 'client_expired') return '<span class="badge badge-warn">Expirée</span>';
    if (client.exhausted) return '<span class="badge badge-danger">Quota épuisé</span>';
    return '<span class="badge badge-ok">Active</span>';
  }

  function quotaBar(label, used, limit, formatter = fmtCompact) {
    const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
    const cls = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : '';
    return `<div class="quota">
      <div class="quota-top"><span>${esc(label)}</span><span><strong>${formatter(used)}</strong> / ${formatter(limit)}</span></div>
      <div class="bar ${cls}"><span style="width:${pct.toFixed(1)}%"></span></div>
    </div>`;
  }

  function quotaCell(client) {
    const parts = [];
    if (client.quotaTokens != null) parts.push(quotaBar('Tokens', client.usedTokens, client.quotaTokens, fmtCompact));
    if (client.quotaRequests != null) parts.push(quotaBar('Requêtes', client.usedRequests, client.quotaRequests, fmtInt));
    if (client.quotaUsd != null) parts.push(quotaBar('Coût', client.usedUsd, client.quotaUsd, (v) => fmtUsd(v)));
    if (parts.length === 0) return '<span class="muted small">Aucun quota (illimité)</span>';
    return parts.join('');
  }

  function clientActions(client) {
    return `<div class="row-actions">
      <button class="btn btn-ghost btn-sm" data-action="edit-client" data-id="${esc(client.id)}">Modifier</button>
      <button class="btn btn-ghost btn-sm" data-action="toggle-client" data-id="${esc(client.id)}">${client.enabled ? 'Désactiver' : 'Activer'}</button>
      <button class="btn btn-danger btn-sm" data-action="delete-client" data-id="${esc(client.id)}">Supprimer</button>
    </div>`;
  }

  function emptyState(title, hint, actionHtml = '') {
    return `<div class="table-empty">
      <div style="font-size:15px;color:var(--text);margin-bottom:6px">${esc(title)}</div>
      <div class="small" style="margin-bottom:14px">${esc(hint)}</div>
      ${actionHtml}
    </div>`;
  }

  function logsTable(rows) {
    if (!rows.length) {
      return emptyState('Aucune requête pour le moment', "Les appels de vos amis apparaîtront ici.");
    }
    const body = rows.map((row) => `
      <tr>
        <td class="nowrap muted small">${fmtDate(row.createdAt)}</td>
        <td>${esc(row.clientName || '(supprimé)')}</td>
        <td class="mono small">${row.requestedModel
          ? `${esc(row.requestedModel)}<br><span class="muted">facturé : ${esc(row.model || '—')}</span>`
          : esc(row.model || '—')}</td>
        <td class="right nowrap small">${fmtInt(row.promptTokens)} / ${fmtInt(row.completionTokens)}</td>
        <td class="right nowrap small">${fmtUsd(row.costUsd)}</td>
        <td class="right nowrap small">${fmtMs(row.latencyMs)}</td>
        <td class="right nowrap">
          ${row.status >= 200 && row.status < 300 ? '<span class="badge badge-ok">200</span>' : `<span class="badge badge-danger">${esc(row.status || 'ERR')}</span>`}
          ${row.streamed ? '<span class="badge badge-muted">SSE</span>' : ''}
          ${row.estimated ? '<span class="badge badge-est" title="Comptage estimé (déconnexion ou réponse incomplète)">est.</span>' : ''}
        </td>
      </tr>`).join('');
    return `<div class="table-wrap">
      <table>
        <thead><tr>
          <th>Date</th><th>Clé</th><th>Modèle</th><th class="right">Tokens (in/out)</th>
          <th class="right">Coût</th><th class="right">Latence</th><th class="right">Statut</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  }

  /* ----------------------------- vue globale ---------------------------- */

  function renderOverview(data) {
    const series = data.series || [];
    const tokens30 = series.reduce((acc, row) => acc + row.tokens, 0);
    const requests30 = series.reduce((acc, row) => acc + row.requests, 0);
    const cost30 = series.reduce((acc, row) => acc + row.cost, 0);
    const counts = data.counts || {};
    const providerAlert = data.provider?.configured
      ? ''
      : `<div class="alert danger">
           <strong>La passerelle n'a pas encore de clé DeepSeek originale.</strong>
           Ajoutez-la dans <button class="btn btn-ghost btn-sm" data-nav="settings" style="margin-left:6px">Réglages</button>
           ou dans le fichier <code>.env</code>, sinon les requêtes de vos amis échoueront.
         </div>`;

    const chart = renderChart(series);
    const budget = data.globalBudget || {};
    const budgetAlert = budget.limitUsd > 0
      ? budget.exceeded
        ? `<div class="alert danger">
             <strong>Budget global mensuel atteint :</strong> ${fmtUsd(budget.spentUsd)} / ${fmtUsd(budget.limitUsd)}.
             Les requêtes API sont refusées jusqu'au prochain mois ou jusqu'à un ajustement dans Réglages.
           </div>`
        : `<div class="alert ok">
             Budget global mensuel : ${fmtUsd(budget.spentUsd)} / ${fmtUsd(budget.limitUsd)}
             (${fmtUsd(budget.remainingUsd)} restants).
           </div>`
      : '';
    const top = data.topClients || [];
    const topRows = top.length
      ? top.map((row) => `
          <tr>
            <td>${esc(row.name)}</td>
            <td class="right">${fmtCompact(row.tokens)}</td>
            <td class="right">${fmtInt(row.requests)}</td>
            <td class="right">${fmtUsd(row.cost)}</td>
          </tr>`).join('')
      : '';

    const recent = data.recent || [];
    const recentRows = recent.length
      ? recent.map((row) => `
          <tr>
            <td class="nowrap muted small">${fmtDate(row.createdAt)}</td>
            <td>${esc(row.clientName || '—')}</td>
            <td class="mono small">${row.requestedModel
          ? `${esc(row.requestedModel)}<br><span class="muted">facturé : ${esc(row.model || '—')}</span>`
          : esc(row.model || '—')}</td>
            <td class="right small nowrap">${fmtCompact(row.totalTokens)}</td>
            <td class="right small nowrap">${fmtUsd(row.costUsd)}</td>
          </tr>`).join('')
      : '';

    $('#view').innerHTML = `
      ${providerAlert}
      ${budgetAlert}
      <section class="stat-grid">
        ${statCard('Requêtes (30 jours)', fmtInt(requests30), `${fmtInt(data.today?.requests || 0)} aujourd'hui`)}
        ${statCard('Tokens (30 jours)', fmtCompact(tokens30), `${fmtCompact(data.today?.tokens || 0)} aujourd'hui`)}
        ${statCard('Coût estimé (30 jours)', fmtUsd(cost30), `${fmtUsd(data.today?.cost || 0)} aujourd'hui`)}
        ${statCard('Clés actives', `${fmtInt(counts.clientsEnabled || 0)} / ${fmtInt(counts.clientsTotal || 0)}`, `${fmtInt(counts.clientsExhausted || 0)} épuisée(s)`)}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Activité des 30 derniers jours</h2>
            <span class="hint">Tarifs appliqués : ${esc(data.pricing?.peakLabel || '—')} · heures creuses à moitié prix</span>
          </div>
          <div class="panel-head-actions">
            <button class="btn btn-primary btn-sm" data-action="create-client">+ Nouvelle clé</button>
          </div>
        </div>
        ${chart}
        <div class="chart-legend">
          <span>Total 30 jours : ${fmtCompact(tokens30)} tokens</span>
          <span>${fmtInt(requests30)} requêtes</span>
          <span>${fmtUsd(cost30)} estimés</span>
        </div>
      </section>

      <div class="two-col">
        <section class="panel">
          <div class="panel-head">
            <h2>Top consommateurs</h2>
            <button class="btn btn-ghost btn-sm" data-nav="clients">Gérer les clés</button>
          </div>
          ${top.length
            ? `<div class="table-wrap"><table><thead><tr><th>Clé</th><th class="right">Tokens</th><th class="right">Requêtes</th><th class="right">Coût</th></tr></thead><tbody>${topRows}</tbody></table></div>`
            : emptyState('Aucune consommation', 'Créez une clé et partagez-la pour voir arriver les premières requêtes.', '<button class="btn btn-primary btn-sm" data-action="create-client">+ Nouvelle clé</button>')}
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Dernières requêtes</h2>
            <button class="btn btn-ghost btn-sm" data-nav="logs">Tout voir</button>
          </div>
          ${recent.length
            ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Clé</th><th>Modèle</th><th class="right">Tokens</th><th class="right">Coût</th></tr></thead><tbody>${recentRows}</tbody></table></div>`
            : emptyState('Aucune requête', 'Les appels de vos amis apparaîtront ici.')}
        </section>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>Récapitulatif</h2></div>
        <div class="table-wrap">
          <table>
            <tbody>
              <tr><td class="muted">Clés actives</td><td class="right">${fmtInt(counts.clientsEnabled || 0)}</td></tr>
              <tr><td class="muted">Clés désactivées</td><td class="right">${fmtInt(counts.clientsDisabled || 0)}</td></tr>
              <tr><td class="muted">Clés au quota épuisé</td><td class="right">${fmtInt(counts.clientsExhausted || 0)}</td></tr>
              <tr><td class="muted">Total historique</td><td class="right">${fmtInt(data.totals?.requests || 0)} requêtes · ${fmtCompact(data.totals?.tokens || 0)} tokens · ${fmtUsd(data.totals?.cost || 0)}</td></tr>
              <tr><td class="muted">Depuis</td><td class="right">${fmtFullDate(data.server?.startedAt)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderChart(series) {
    const W = 680;
    const H = 190;
    const padL = 4;
    const padB = 24;
    const padT = 12;
    const n = Math.max(1, series.length);
    const max = Math.max(1, ...series.map((row) => row.tokens));
    if (series.every((row) => row.tokens === 0)) {
      return '<div class="chart chart-empty"><span class="muted small">Aucune consommation sur les 30 derniers jours.</span></div>';
    }
    const slot = (W - padL) / n;
    const barW = Math.max(2, slot * 0.55);
    const bars = series.map((row, i) => {
      const h = row.tokens > 0 ? Math.max(2, (row.tokens / max) * (H - padB - padT)) : 0;
      const x = padL + i * slot + (slot - barW) / 2;
      const y = H - padB - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="url(#barGrad)"><title>${esc(shortDay(row.day))} — ${fmtInt(row.tokens)} tokens, ${fmtInt(row.requests)} requêtes, ${fmtUsd(row.cost)}</title></rect>`;
    }).join('');
    const labels = series.map((row, i) => {
      if (i % 5 !== 0 && i !== n - 1) return '';
      return `<text x="${(padL + i * slot + slot / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="9" fill="#5d8769" font-family="Consolas, monospace">${esc(shortDay(row.day))}</text>`;
    }).join('');
    return `<div class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Consommation de tokens par jour">
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#3ee97f"/>
            <stop offset="1" stop-color="#1f9e57" stop-opacity="0.35"/>
          </linearGradient>
        </defs>
        <line x1="${padL}" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="#14341f" stroke-width="1"/>
        ${bars}
        ${labels}
      </svg>
    </div>`;
  }

  /* ------------------------------ vue clés ------------------------------ */

  function renderClients() {
    const clients = state.clients || [];
    const active = clients.filter((c) => c.enabled && c.status === 'ok').length;
    const exhausted = clients.filter((c) => c.exhausted).length;
    const disabled = clients.filter((c) => !c.enabled).length;

    const rows = clients.map((client) => `
      <tr>
        <td>
          <div class="client-name">${esc(client.name)}</div>
          <div class="client-meta">${client.email ? `${esc(client.email)} · ` : ''}${esc(client.note || '')}${client.note ? ' · ' : ''}créée le ${fmtDate(client.createdAt)}${client.lastUsedAt ? ` · dernier appel ${fmtDate(client.lastUsedAt)}` : ' · jamais utilisée'}</div>
        </td>
        <td class="nowrap"><span class="mono small" title="Empreinte de la clé">${esc(client.keyPrefix)}</span></td>
        <td>${statusBadge(client)}</td>
        <td>${quotaCell(client)}</td>
        <td class="right nowrap small">
          ${fmtCompact(client.todayTokens)} tok<br>
          <span class="muted">${fmtInt(client.todayRequests)} req.</span>
        </td>
        <td>${clientActions(client)}</td>
      </tr>`).join('');

    $('#view').innerHTML = `
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>${clients.length} clé${clients.length > 1 ? 's' : ''} dérivée${clients.length > 1 ? 's' : ''}</h2>
            <span class="hint">${active} active(s) · ${disabled} désactivée(s) · ${exhausted} épuisée(s)</span>
          </div>
          <div class="panel-head-actions">
            <button class="btn btn-primary" data-action="create-client">+ Nouvelle clé</button>
          </div>
        </div>
        ${clients.length
          ? `<div class="table-wrap"><table class="clients-table">
               <thead><tr>
                 <th>Nom</th><th>Clé</th><th>Statut</th><th>Quotas</th>
                 <th class="right">Aujourd'hui</th><th class="right">Actions</th>
               </tr></thead>
               <tbody>${rows}</tbody>
             </table></div>`
          : emptyState(
              'Aucune clé dérivée pour le moment',
              "Créez une clé à donner à votre ami. Vous choisissez ses quotas et pouvez la révoquer à tout moment.",
              '<button class="btn btn-primary" data-action="create-client">+ Créer la première clé</button>',
            )}
      </section>
      <div class="alert">
        <strong>Bon à savoir :</strong> la clé complète n'est affichée qu'une seule fois, juste après sa création.
        L'empreinte affichée ici (<span class="mono">sk-dsk-…</span>) sert seulement à l'identifier.
        La clé originale DeepSeek n'est jamais visible dans le panneau ni jamais transmise à vos amis.
      </div>`;
  }

  function clientForm(client) {
    const isEdit = Boolean(client);
    return `<input type="hidden" name="clientId" value="${esc(client?.id || '')}">
      <div class="form-grid">
        <label class="field full"><span>Nom de la clé</span>
          <input name="name" required maxlength="80" value="${esc(client?.name || '')}" placeholder="Ex : Ami, équipe 3D, projet perso…">
        </label>
        <label class="field full"><span>Email (connexion portail)</span>
          <input type="email" name="email" maxlength="254" value="${esc(client?.email || '')}" placeholder="ex : ami@example.com">
          <small>Permet à l'utilisateur de se connecter à <code>/portal</code> par code email, sans utiliser sa clé API. Laisser vide pour désactiver.</small>
        </label>
        <label class="field"><span>Quota de tokens</span>
          <input type="number" name="quotaTokens" min="0" step="1000" value="${client?.quotaTokens ?? ''}" placeholder="ex : 5 000 000">
          <small>Vide = aucun quota de tokens.</small>
        </label>
        <label class="field"><span>Quota de requêtes</span>
          <input type="number" name="quotaRequests" min="0" step="1" value="${client?.quotaRequests ?? ''}" placeholder="ex : 500">
          <small>Vide = aucune limite de requêtes.</small>
        </label>
        <label class="field"><span>Quota de coût (USD)</span>
          <input type="number" name="quotaUsd" min="0" step="0.01" value="${client?.quotaUsd ?? ''}" placeholder="ex : 3.50">
          <small>Vide = aucun quota de coût estimé.</small>
        </label>
        <label class="field"><span>Période de remise à zéro</span>
          <select name="period">
            ${Object.entries(PERIOD_LABELS).map(([value, label]) =>
              `<option value="${value}" ${(client?.period || 'monthly') === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}
          </select>
          <small>Changer la période réinitialise les compteurs.</small>
        </label>
        <label class="field"><span>Requêtes par minute</span>
          <input type="number" name="rpmLimit" min="1" step="1" value="${client?.rpmLimit ?? ''}" placeholder="ex : 20">
          <small>Vide = pas de limite de débit.</small>
        </label>
        <label class="field"><span>Requêtes simultanées</span>
          <input type="number" name="concurrencyLimit" min="1" step="1" value="${client?.concurrencyLimit ?? ''}" placeholder="ex : 2">
          <small>Vide = pas de limite.</small>
        </label>
        <label class="field"><span>Tokens de sortie maximum</span>
          <input type="number" name="maxOutputTokens" min="1" max="393216" step="1" value="${client?.maxOutputTokens ?? ''}" placeholder="ex : 4096">
          <small>Plafonne <code>max_tokens</code> envoyé par l'ami.</small>
        </label>
        <label class="field"><span>Modèles autorisés</span>
          <input name="allowedModels" value="${esc((client?.allowedModels || []).join(', '))}" placeholder="deepseek-flash, deepseek-v4-pro">
          <small>Vide = tous les modèles. Sinon séparez par des virgules.</small>
        </label>
        <label class="field"><span>Date d'expiration (optionnel)</span>
          <input type="datetime-local" name="expiresAt" value="${toLocalInput(client?.expiresAt)}">
          <small>Après cette date, la clé est refusée automatiquement.</small>
        </label>
        <label class="field full"><span>Note interne</span>
          <input name="note" maxlength="500" value="${esc(client?.note || '')}" placeholder="Visible uniquement dans ce panneau.">
        </label>
        <label class="field full checkbox">
          <input type="checkbox" name="enabled" value="1" ${!client || client.enabled ? 'checked' : ''}>
          <span>Clé active (décoché = refusée immédiatement)</span>
        </label>
      </div>
      ${isEdit
        ? `<div class="form-actions" style="justify-content:flex-start;border-top:1px solid var(--border);padding-top:16px">
             <span class="small muted" style="align-self:center;margin-right:auto">Opérations sur cette clé :</span>
             <button type="button" class="btn btn-ghost btn-sm" data-action="reset-client" data-id="${esc(client.id)}">Réinitialiser les compteurs</button>
             <button type="button" class="btn btn-ghost btn-sm" data-action="regen-client" data-id="${esc(client.id)}">Générer une nouvelle clé</button>
           </div>`
        : ''}`;
  }

  function openClientModal(client) {
    const isEdit = Boolean(client);
    openModal({
      title: isEdit ? `Modifier « ${client.name} »` : 'Nouvelle clé dérivée',
      bodyHtml: clientForm(client),
      formKind: isEdit ? 'client-edit' : 'client-create',
      submitLabel: isEdit ? 'Enregistrer' : 'Créer la clé',
      size: 'modal-wide',
    });
  }

  function clientPayloadFromForm(form) {
    const raw = new FormData(form);
    const value = (name) => {
      const v = raw.get(name);
      return v == null ? '' : String(v).trim();
    };
    const num = (name) => (value(name) === '' ? null : Number(value(name)));
    const payload = {
      name: value('name'),
      email: value('email') || null,
      quotaTokens: num('quotaTokens'),
      quotaRequests: num('quotaRequests'),
      quotaUsd: num('quotaUsd'),
      period: value('period') || 'monthly',
      rpmLimit: num('rpmLimit'),
      concurrencyLimit: num('concurrencyLimit'),
      maxOutputTokens: num('maxOutputTokens'),
      allowedModels: value('allowedModels') || null,
      expiresAt: value('expiresAt') ? new Date(value('expiresAt')).toISOString() : null,
      note: value('note') || null,
      enabled: raw.get('enabled') === '1',
    };
    if (!payload.name) throw new Error('Le nom de la clé est obligatoire.');
    if (payload.quotaTokens != null && (!Number.isInteger(payload.quotaTokens) || payload.quotaTokens < 0)) {
      throw new Error('Le quota de tokens doit être un entier positif (ou vide).');
    }
    if (payload.quotaRequests != null && (!Number.isInteger(payload.quotaRequests) || payload.quotaRequests < 0)) {
      throw new Error('Le quota de requêtes doit être un entier positif (ou vide).');
    }
    if (payload.quotaUsd != null && (!Number.isFinite(payload.quotaUsd) || payload.quotaUsd < 0)) {
      throw new Error('Le quota de coût doit être un nombre positif (ou vide).');
    }
    return payload;
  }

  function showKeyModal(apiKey, client) {
    const apiUrl = apiBaseUrl();
    openModal({
      title: 'Clé créée — copiez-la maintenant',
      bodyHtml: `
        <div class="alert warn"><strong>Cette clé ne sera plus jamais affichée en entier.</strong> Copiez-la et transmettez-la à votre ami par un canal sûr.</div>
        <div class="key-reveal">
          <code id="revealed-key">${esc(apiKey)}</code>
          <button type="button" class="btn btn-ghost" data-copy="#revealed-key">Copier</button>
        </div>
        <div class="setting-row"><span class="k">Nom</span><span class="v">${esc(client.name)}</span></div>
        <div class="setting-row"><span class="k">URL à donner à votre ami</span><span class="v">${esc(apiUrl)}</span></div>
        ${client.email ? `<div class="setting-row"><span class="k">Connexion portail par email</span><span class="v">${esc(client.email)}</span></div>` : ''}
        <div class="setting-row"><span class="k">Modèle conseillé</span><span class="v">deepseek-flash</span></div>
        <p class="muted small" style="margin:16px 0 0">
          Votre ami utilise cette clé comme <code>api_key</code> et l'URL ci-dessus comme <code>base_url</code>.
          Consultez l'onglet <strong>Guide pour votre ami</strong> pour les exemples prêts à copier.
        </p>`,
      footerHtml: '<button type="button" class="btn btn-primary" data-close>J\'ai copié la clé</button>',
    });
  }

  async function handleClientCreate(form) {
    const payload = clientPayloadFromForm(form);
    const data = await api('/clients', { method: 'POST', body: payload });
    closeModal();
    showKeyModal(data.key, data.client);
    toast('Clé créée.', 'success');
    await refreshCurrentView();
  }

  async function handleClientEdit(form) {
    const payload = clientPayloadFromForm(form);
    const clientId = new FormData(form).get('clientId');
    await api(`/clients/${clientId}`, { method: 'PATCH', body: payload });
    closeModal();
    toast('Clé mise à jour.', 'success');
    await refreshCurrentView();
  }

  /* ----------------------------- vue logs ------------------------------- */

  async function loadLogs({ reset = false, append = false } = {}) {
    if (reset) state.logs.rows = [];
    const params = new URLSearchParams({
      limit: '100',
      offset: String(append ? state.logs.rows.length : 0),
    });
    if (state.logs.clientId) params.set('clientId', state.logs.clientId);
    const data = await api(`/logs?${params.toString()}`);
    state.logs.total = data.total;
    state.logs.rows = append ? state.logs.rows.concat(data.rows) : data.rows;
    renderLogs();
  }

  function renderLogs() {
    const clients = state.clients || [];
    const options = clients.map((client) =>
      `<option value="${esc(client.id)}" ${state.logs.clientId === client.id ? 'selected' : ''}>${esc(client.name)}</option>`).join('');
    const filter = `<select data-log-filter style="max-width:260px">
        <option value="">Toutes les clés</option>
        ${options}
      </select>`;
    const hasMore = state.logs.rows.length < state.logs.total;
    $('#view').innerHTML = `
      <section class="panel">
        <div class="panel-head">
          <div><h2>Journal des requêtes</h2><span class="hint">${fmtInt(state.logs.total)} requête(s) — 100 par page</span></div>
          <div class="panel-head-actions">
            ${filter}
            <a class="btn btn-ghost btn-sm" href="/admin/api/export/logs.csv" download>Exporter CSV</a>
            <button class="btn btn-ghost btn-sm" data-action="refresh-logs">Actualiser</button>
          </div>
        </div>
        ${logsTable(state.logs.rows)}
        ${hasMore ? `<div style="text-align:center;margin-top:16px"><button class="btn btn-ghost" data-action="load-more-logs">Charger plus</button></div>` : ''}
      </section>`;
  }

  /* ------------------------------ vue audit ----------------------------- */

  function renderAudit() {
    const rows = state.audit?.rows ?? [];
    const body = rows.length
      ? rows.map((row) => `
          <tr>
            <td class="nowrap muted small">${fmtDate(row.createdAt)}</td>
            <td class="mono small">${esc(row.action)}</td>
            <td>${esc(row.target || '—')}</td>
            <td class="mono small muted">${esc(row.ip || '—')}</td>
            <td class="small muted">${esc(row.details || '')}</td>
          </tr>`).join('')
      : '';
    $('#view').innerHTML = `
      <section class="panel">
        <div class="panel-head">
          <div><h2>Journal d'audit</h2><span class="hint">${fmtInt(state.audit?.total || 0)} événement(s) — connexions, clés, réglages</span></div>
          <div class="panel-head-actions"><button class="btn btn-ghost btn-sm" data-action="refresh-audit">Actualiser</button></div>
        </div>
        ${rows.length
          ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Action</th><th>Cible</th><th>IP</th><th>Détails</th></tr></thead><tbody>${body}</tbody></table></div>`
          : emptyState("Aucun événement", "Les actions d'administration (connexions, clés, réglages) seront tracées ici.")}
      </section>`;
  }

  /* ---------------------------- vue réglages ---------------------------- */

  async function loadSettings() {
    const data = await api('/settings');
    state.settings = data;
    updateProviderPill(data.provider?.configured, data.provider?.source);
    renderSettings();
  }

  function providerSourceLabel(source) {
    if (source === 'env') return 'variable d\'environnement';
    if (source === 'panel') return 'panneau';
    if (source === 'default') return 'valeur par défaut';
    return 'non configurée';
  }

  function renderSettings() {
    const s = state.settings;
    const provider = s.provider;
    const pricingJson = JSON.stringify(s.pricing, null, 2);
    const aliasesJson = JSON.stringify(s.modelAliases ?? {}, null, 2);
    const version = s.server?.version || '1.0.0';

    $('#view').innerHTML = `
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Clé DeepSeek originale</h2>
            <span class="hint">Elle reste sur cette machine et n'est jamais transmise à vos amis.</span>
          </div>
          <div class="panel-head-actions">
            ${provider.configured ? '<span class="badge badge-ok">Connectée</span>' : '<span class="badge badge-danger">Manquante</span>'}
            <span class="badge badge-muted">source : ${esc(providerSourceLabel(provider.source))}</span>
          </div>
        </div>
        ${provider.configured
          ? `<div class="alert ok">Clé actuelle : <span class="mono">${esc(provider.masked)}</span> — elle est stockée ${provider.source === 'env' ? 'dans <code>.env</code>' : 'dans la base locale, <strong>chiffrée (AES-256-GCM)</strong>'}.</div>`
          : `<div class="alert danger">Aucune clé originale configurée : les requêtes seront refusées (503). Ajoutez-la ci-dessous ou dans <code>.env</code>.</div>`}
        <form data-form="settings-provider">
          <div class="form-grid">
            <label class="field full"><span>Nouvelle clé API DeepSeek</span>
              <input type="password" name="providerApiKey" placeholder="sk-…" autocomplete="off" ${provider.envApiKey ? 'disabled' : ''}>
              <small>${provider.envApiKey ? 'Définie via la variable DEEPSEEK_API_KEY : modifiez le fichier .env puis redémarrez.' : 'Laissez vide pour conserver la clé actuelle.'}</small>
            </label>
            <label class="field full"><span>URL de base de l'API DeepSeek</span>
              <input name="providerBaseUrl" value="${esc(provider.baseUrl)}" ${provider.envBaseUrl ? 'disabled' : ''}>
              <small>${provider.envBaseUrl ? 'Définie via DEEPSEEK_BASE_URL.' : 'Par défaut : https://api.deepseek.com'}</small>
            </label>
          </div>
          <div class="form-actions">
            ${provider.configured && !provider.envApiKey
              ? '<button type="button" class="btn btn-danger btn-sm" data-action="clear-provider-key">Supprimer la clé enregistrée</button>'
              : ''}
            <button type="submit" class="btn btn-primary">Enregistrer</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>URL publique de la passerelle</h2>
            <span class="hint">L'adresse que vos amis utiliseront comme <code>base_url</code>.</span>
          </div>
          <span class="badge badge-muted">source : ${esc(providerSourceLabel(s.publicBaseUrlSource))}</span>
        </div>
        <form data-form="settings-public">
          <div class="inline-form">
            <label class="field"><span>URL publique</span>
              <input name="publicBaseUrl" value="${esc(s.publicBaseUrl)}" placeholder="${esc(window.location.origin)}" ${s.publicBaseUrlSource === 'env' ? 'disabled' : ''}>
              <small>Ex : <code>https://api.mondomaine.fr</code> — vide = adresse actuelle du navigateur.</small>
            </label>
            <button type="submit" class="btn btn-primary">Enregistrer</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Budget global mensuel</h2>
            <span class="hint">Plafond de coût estimé pour toutes les clés, remis à zéro le 1er du mois (UTC).</span>
          </div>
          <span class="badge badge-muted">${s.globalBudget?.limitUsd > 0 ? `consommé : ${fmtUsd(s.globalBudget.spentUsd)}` : 'désactivé'}</span>
        </div>
        <form data-form="settings-budget">
          <div class="inline-form">
            <label class="field"><span>Budget mensuel (USD, 0 = désactivé)</span>
              <input type="number" step="0.01" min="0" name="globalBudgetUsd" value="${s.globalBudgetUsd > 0 ? s.globalBudgetUsd : ''}" placeholder="ex : 20">
              <small>Au-delà du budget, les requêtes API sont refusées (429 <code>global_budget_exceeded</code>).</small>
            </label>
            <button type="submit" class="btn btn-primary">Enregistrer</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Connexion par email</h2>
            <span class="hint">Codes à usage unique envoyés aux utilisateurs du portail.</span>
          </div>
          <span class="badge ${s.email?.enabled ? 'badge-ok' : 'badge-muted'}">${s.email?.enabled ? 'activée' : 'désactivée'}</span>
        </div>
        <div class="alert">
          Transport : <code>${esc(s.email?.transport || '—')}</code>${s.email?.from ? ` · expéditeur : <code>${esc(s.email.from)}</code>` : ''}
          · validité du code : ${fmtInt(s.email?.otpExpiresMinutes || 10)} min.
          Configurez <code>MAIL_TRANSPORT</code>, <code>MAIL_FROM</code> et <code>SMTP_URL</code> ou <code>RESEND_API_KEY</code>.
          Chaque utilisateur doit avoir une adresse email dans sa fiche.
        </div>
        ${s.email?.transport === 'console'
          ? '<div class="alert warn">Mode console : les codes sont écrits dans les logs du serveur. À réserver au développement.</div>'
          : ''}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Tarification (estimation du coût)</h2>
            <span class="hint">Heures pleines : ${esc(s.pricingMeta?.peakLabel || '—')} · les heures creuses sont à moitié prix.</span>
          </div>
          <div class="panel-head-actions">
            <button class="btn btn-ghost btn-sm" data-action="reset-pricing">Valeurs par défaut</button>
          </div>
        </div>
        <div class="alert">
          Ces tarifs (USD par million de tokens) servent uniquement à estimer les quotas de coût.
          Vérifiez-les de temps en temps sur la page officielle DeepSeek : ils peuvent évoluer.
        </div>
        <form data-form="settings-pricing">
          <label class="field"><span>JSON de tarification</span>
            <textarea name="pricing" rows="16" spellcheck="false">${esc(pricingJson)}</textarea>
          </label>
          <div class="form-actions"><button type="submit" class="btn btn-primary">Enregistrer les tarifs</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Alias de modèles</h2>
            <span class="hint">Exposez un nom de modèle différent du modèle DeepSeek réellement utilisé.</span>
          </div>
          <div class="panel-head-actions">
            <button class="btn btn-ghost btn-sm" data-action="reset-aliases">Valeurs par défaut</button>
          </div>
        </div>
        <div class="alert">
          Par défaut : <span class="mono">claude-opus-5*</span>, <span class="mono">claude-opus-5.5</span>,
          <span class="mono">fable-5</span> et <span class="mono">fable-5.1</span> → <span class="mono">deepseek-flash</span>.
          Un client qui demande <span class="mono">claude-opus-5</span> (ou <span class="mono">claude-opus-5-20260101</span>)
          est donc servi par DeepSeek Flash (le modèle économique). Les quotas, le coût estimé et les journaux utilisent le
          <strong>modèle réellement facturé</strong> ; le client reçoit les en-têtes
          <span class="mono">x-gateway-requested-model</span> / <span class="mono">x-gateway-billed-model</span>.
          Videz le champ puis enregistrez pour revenir aux alias par défaut.
        </div>
        <form data-form="settings-aliases">
          <label class="field"><span>JSON des alias (« nom demandé » → « modèle DeepSeek »)</span>
            <textarea name="aliases" rows="8" spellcheck="false">${esc(aliasesJson)}</textarea>
          </label>
          <div class="form-actions"><button type="submit" class="btn btn-primary">Enregistrer les alias</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Mot de passe du panneau</h2>
            <span class="hint">${s.admin?.passwordSource === 'panel' ? 'Mot de passe personnalisé.' : 'Mot de passe initial — pensez à le changer.'}</span>
          </div>
          ${s.admin?.passwordSource === 'panel' ? '<span class="badge badge-ok">Personnalisé</span>' : '<span class="badge badge-warn">Initial</span>'}
        </div>
        <form data-form="settings-password">
          <div class="form-grid">
            <label class="field full"><span>Mot de passe actuel</span>
              <input type="password" name="currentPassword" autocomplete="current-password" required>
            </label>
            <label class="field"><span>Nouveau mot de passe</span>
              <input type="password" name="newPassword" autocomplete="new-password" minlength="10" required>
              <small>10 caractères minimum.</small>
            </label>
            <label class="field"><span>Confirmation</span>
              <input type="password" name="confirmPassword" autocomplete="new-password" minlength="10" required>
            </label>
          </div>
          <div class="form-actions"><button type="submit" class="btn btn-primary">Changer le mot de passe</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Informations serveur</h2></div>
        <div class="setting-row"><span class="k">Version</span><span class="v">v${esc(version)}</span></div>
        <div class="setting-row"><span class="k">Node.js</span><span class="v">${esc(s.server?.node || '—')}</span></div>
        <div class="setting-row"><span class="k">Adresse d'écoute</span><span class="v">${esc(s.server?.host || '')}:${esc(s.server?.port || '')}</span></div>
        <div class="setting-row"><span class="k">Dossier de données</span><span class="v">${esc(s.server?.dataDir || '—')}</span></div>
        <div class="setting-row"><span class="k">Démarré le</span><span class="v">${fmtFullDate(s.server?.startedAt)}</span></div>
      </section>`;
  }

  async function handleProviderSave(form) {
    const body = {};
    const keyInput = form.elements.providerApiKey;
    const urlInput = form.elements.providerBaseUrl;
    if (keyInput && !keyInput.disabled && keyInput.value.trim()) body.providerApiKey = keyInput.value.trim();
    if (urlInput && !urlInput.disabled) body.providerBaseUrl = urlInput.value.trim();
    if (Object.keys(body).length === 0) {
      toast('Rien à enregistrer.', 'info');
      return;
    }
    await api('/settings', { method: 'PUT', body });
    toast('Réglages du fournisseur enregistrés.', 'success');
    await loadSettings();
  }

  async function handlePublicUrlSave(form) {
    const value = form.elements.publicBaseUrl.value.trim();
    await api('/settings', { method: 'PUT', body: { publicBaseUrl: value } });
    toast('URL publique enregistrée.', 'success');
    await loadSettings();
  }

  async function handleBudgetSave(form) {
    const raw = String(form.elements.globalBudgetUsd.value ?? '').trim();
    const value = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error('Budget global invalide.');
    await api('/settings', { method: 'PUT', body: { globalBudgetUsd: value } });
    toast('Budget global enregistré.', 'success');
    await loadSettings();
  }

  async function handlePricingSave(form) {
    let pricing;
    try {
      pricing = JSON.parse(form.elements.pricing.value);
    } catch (err) {
      throw new Error(`JSON invalide : ${err.message}`);
    }
    await api('/settings', { method: 'PUT', body: { pricing } });
    toast('Tarification enregistrée.', 'success');
    await loadSettings();
  }

  async function handleAliasesSave(form) {
    const raw = form.elements.aliases.value.trim();
    let modelAliases = null;
    if (raw) {
      try {
        modelAliases = JSON.parse(raw);
      } catch (err) {
        throw new Error(`JSON invalide : ${err.message}`);
      }
    }
    await api('/settings', { method: 'PUT', body: { modelAliases } });
    toast('Alias de modèles enregistrés.', 'success');
    await loadSettings();
  }

  async function handlePasswordSave(form) {
    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    const confirmPassword = form.elements.confirmPassword.value;
    if (newPassword.length < 10) throw new Error('Le nouveau mot de passe doit contenir au moins 10 caractères.');
    if (newPassword !== confirmPassword) throw new Error('La confirmation ne correspond pas au nouveau mot de passe.');
    await api('/settings/password', { method: 'POST', body: { currentPassword, newPassword } });
    form.reset();
    toast('Mot de passe modifié. Les autres sessions ont été déconnectées.', 'success');
    await loadSettings();
  }

  /* ------------------------------ vue guide ----------------------------- */

  function codeBlock(id, label, code) {
    return `<div class="code-block">
      <div class="code-label">${esc(label)}</div>
      <button type="button" class="code-copy" data-copy="#${esc(id)}">Copier</button>
      <pre id="${esc(id)}"><code>${esc(code)}</code></pre>
    </div>`;
  }

  function renderGuide() {
    const apiUrl = apiBaseUrl();
    const anthropicUrl = anthropicBaseUrl();
    const domain = appBaseUrl();

    const curlCode = [
      `curl ${apiUrl}/chat/completions \\`,
      '  -H "Authorization: Bearer sk-dsk-VOTRE_CLE" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d \'{"model": "deepseek-flash", "messages": [{"role": "user", "content": "Bonjour !"}]}\'',
    ].join('\n');

    const pythonCode = [
      'from openai import OpenAI',
      '',
      'client = OpenAI(',
      '    api_key="sk-dsk-VOTRE_CLE",',
      `    base_url="${apiUrl}",`,
      ')',
      '',
      'reponse = client.chat.completions.create(',
      '    model="deepseek-flash",',
      '    messages=[{"role": "user", "content": "Bonjour !"}],',
      ')',
      'print(reponse.choices[0].message.content)',
    ].join('\n');

    const nodeCode = [
      'import OpenAI from "openai";',
      '',
      'const client = new OpenAI({',
      '  apiKey: "sk-dsk-VOTRE_CLE",',
      `  baseURL: "${apiUrl}",`,
      '});',
      '',
      'const reponse = await client.chat.completions.create({',
      '  model: "deepseek-flash",',
      '  messages: [{ role: "user", content: "Bonjour !" }],',
      '});',
      'console.log(reponse.choices[0].message.content);',
    ].join('\n');

    const envCode = [
      '# --- Clients compatibles OpenAI ---',
      `OPENAI_BASE_URL=${apiUrl}`,
      'OPENAI_API_KEY=sk-dsk-VOTRE_CLE',
      '',
      '# --- Claude Code / format Anthropic ---',
      `ANTHROPIC_BASE_URL=${anthropicUrl}`,
      'ANTHROPIC_AUTH_TOKEN=sk-dsk-VOTRE_CLE',
      'ANTHROPIC_MODEL=deepseek-flash',
      'ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro',
      'ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-flash',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-flash',
      'CLAUDE_CODE_SUBAGENT_MODEL=deepseek-flash',
    ].join('\n');

    $('#view').innerHTML = `
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Tout ce que votre ami doit savoir</h2>
            <span class="hint">Il n'a besoin ni de votre clé originale, ni de compte DeepSeek.</span>
          </div>
        </div>
        <div class="alert warn">
          <strong>Ne transmettez jamais votre clé DeepSeek originale.</strong>
          Seule une clé dérivée (<span class="mono">sk-dsk-…</span>) créée dans l'onglet « Clés &amp; quotas » doit être partagée.
          Vous pouvez la révoquer ou la régénérer à tout moment.
        </div>

        <div class="steps">
          <div class="step">
            <div class="step-num"></div>
            <div>
              <h3>Créer une clé pour votre ami</h3>
              <p>Dans <strong>Clés &amp; quotas</strong> → <em>+ Nouvelle clé</em>, choisissez ses quotas (tokens, requêtes, coût, période, débit…). La clé complète ne s'affiche qu'une fois : copiez-la.</p>
              <button class="btn btn-primary btn-sm" data-action="create-client">+ Créer une clé</button>
            </div>
          </div>

          <div class="step">
            <div class="step-num"></div>
            <div>
              <h3>Envoyer ces deux informations</h3>
              <p>
                <strong>URL de base :</strong> <span class="mono">${esc(apiUrl)}</span><br>
                <strong>Clé API :</strong> <span class="mono">sk-dsk-…</span> (celle que vous venez de créer)
              </p>
              <div class="alert" style="margin:0">
                La passerelle est compatible avec le format <strong>OpenAI</strong> (chat/completions, responses, completions)
                et avec le format <strong>Anthropic</strong> : <span class="mono">${esc(anthropicUrl)}</span>.
                Le domaine utilisé est <span class="mono">${esc(domain)}</span>.<br>
                L'URL racine fonctionne aussi (les appels <span class="mono">/v1/messages</span> sont redirigés).
                Les anciens noms de modèles (<span class="mono">deepseek-v4-flash</span>, <span class="mono">deepseek-chat</span>…)
                et le suffixe <span class="mono">[1m]</span> sont acceptés et convertis automatiquement.
                Vous pouvez aussi exposer des alias (ex. <span class="mono">claude-opus-5</span> → <span class="mono">deepseek-flash</span>)
                depuis <strong>Réglages → Alias de modèles</strong>.<br>
                <strong>Claude Desktop n'accepte que https://</strong> : activez le HTTPS local
                (<span class="mono">tools/generate-local-tls.ps1</span> + variables <span class="mono">TLS_*</span> dans <code>.env</code>),
                utilisez l'URL Railway, ou un tunnel Cloudflare — voir le README.
              </div>
            </div>
          </div>

          <div class="step">
            <div class="step-num"></div>
            <div>
              <h3>Exemples prêts à copier</h3>
              <p>Remplacez <span class="mono">sk-dsk-VOTRE_CLE</span> par la clé créée à l'étape 1.</p>
              ${codeBlock('guide-curl', 'cURL', curlCode)}
              ${codeBlock('guide-python', 'Python (SDK OpenAI)', pythonCode)}
              ${codeBlock('guide-node', 'Node.js (SDK OpenAI)', nodeCode)}
              ${codeBlock('guide-env', 'Variables d\'environnement (outils compatibles)', envCode)}
            </div>
          </div>

          <div class="step">
            <div class="step-num"></div>
            <div>
              <h3>Comprendre les limites</h3>
              <p>💡 Claude Code envoie un prompt système volumineux (~20 000 tokens par requête) :
                dimensionnez les quotas en conséquence (2 à 5 M de tokens par mois par exemple).</p>
              <p>Votre ami peut suivre sa consommation grâce aux en-têtes de réponse :</p>
              <div class="table-wrap"><table>
                <thead><tr><th>En-tête</th><th>Signification</th></tr></thead>
                <tbody>
                  <tr><td class="mono">x-quota-tokens-remaining</td><td>Tokens restants au début de la requête (si quota configuré)</td></tr>
                  <tr><td class="mono">x-quota-requests-remaining</td><td>Requêtes restantes (si quota configuré)</td></tr>
                  <tr><td class="mono">x-quota-usd-remaining</td><td>Budget restant en USD (si quota configuré)</td></tr>
                  <tr><td class="mono">x-quota-period</td><td>Période de remise à zéro : <span class="mono">daily</span>, <span class="mono">monthly</span> ou <span class="mono">total</span></td></tr>
                </tbody>
              </table></div>
              <p style="margin-top:14px">Codes d'erreur possibles :</p>
              <div class="table-wrap"><table>
                <thead><tr><th>HTTP</th><th>Code</th><th>Cause</th></tr></thead>
                <tbody>
                  <tr><td>401</td><td class="mono">invalid_api_key</td><td>Clé dérivée inconnue ou révoquée</td></tr>
                  <tr><td>403</td><td class="mono">client_disabled</td><td>Clé désactivée par l'administrateur</td></tr>
                  <tr><td>403</td><td class="mono">model_not_allowed</td><td>Modèle non autorisé pour cette clé</td></tr>
                  <tr><td>429</td><td class="mono">insufficient_quota</td><td>Quota de tokens / requêtes / coût atteint</td></tr>
                  <tr><td>429</td><td class="mono">rate_limit_exceeded</td><td>Trop de requêtes par minute</td></tr>
                  <tr><td>503</td><td class="mono">provider_not_configured</td><td>Clé DeepSeek originale manquante côté administrateur</td></tr>
                </tbody>
              </table></div>
            </div>
          </div>
        </div>
      </section>`;
  }

  /* ------------------------------ actions ------------------------------- */

  async function handleAction(action, id) {
    if (action === 'logout') {
      await handleLogout();
      return;
    }
    if (action === 'retry-view') {
      await setView(state.view);
      return;
    }
    if (action === 'create-client') {
      await ensureClients();
      openClientModal(null);
      return;
    }
    if (action === 'refresh-logs') {
      await loadLogs({ reset: true });
      return;
    }
    if (action === 'refresh-audit') {
      state.audit = await api('/audit?limit=200');
      renderAudit();
      return;
    }
    if (action === 'load-more-logs') {
      await loadLogs({ append: true });
      return;
    }
    if (action === 'reset-pricing') {
      if (state.settings?.pricingMeta?.defaultPricing) {
        const textarea = document.querySelector('textarea[name="pricing"]');
        if (textarea) {
          textarea.value = JSON.stringify(state.settings.pricingMeta.defaultPricing, null, 2);
          toast('Tarifs par défaut chargés dans l\'éditeur. Cliquez sur « Enregistrer les tarifs ».', 'info');
        }
      }
      return;
    }
    if (action === 'reset-aliases') {
      const textarea = document.querySelector('textarea[name="aliases"]');
      if (textarea) {
        textarea.value = JSON.stringify(state.settings?.modelAliasesMeta?.defaults ?? {}, null, 2);
        toast('Alias par défaut chargés dans l\'éditeur. Cliquez sur « Enregistrer les alias ».', 'info');
      }
      return;
    }
    if (action === 'clear-provider-key') {
      confirmModal({
        title: 'Supprimer la clé DeepSeek enregistrée ?',
        message: 'La passerelle refusera toutes les requêtes jusqu\'à ce qu\'une nouvelle clé soit configurée.',
        confirmLabel: 'Supprimer la clé',
        danger: true,
        onConfirm: async () => {
          await api('/settings', { method: 'PUT', body: { providerApiKey: '' } });
          closeModal();
          toast('Clé supprimée.', 'success');
          await loadSettings();
        },
      });
      return;
    }

    await ensureClients();
    const client = state.clients.find((c) => c.id === id);
    if (!client) throw new Error('Clé introuvable (elle a peut-être été supprimée).');

    if (action === 'edit-client') {
      openClientModal(client);
      return;
    }

    if (action === 'toggle-client') {
      await api(`/clients/${client.id}`, { method: 'PATCH', body: { enabled: !client.enabled } });
      toast(client.enabled ? `« ${client.name} » désactivée.` : `« ${client.name} » activée.`, 'success');
      await refreshCurrentView();
      return;
    }

    if (action === 'reset-client') {
      confirmModal({
        title: `Réinitialiser « ${client.name} » ?`,
        message: `Les compteurs de consommation repartent à zéro pour la période en cours (${esc(PERIOD_LABELS[client.period] || '')}). La clé reste la même.`,
        confirmLabel: 'Réinitialiser',
        onConfirm: async () => {
          await api(`/clients/${client.id}/reset`, { method: 'POST' });
          closeModal();
          toast('Compteurs réinitialisés.', 'success');
          await refreshCurrentView();
        },
      });
      return;
    }

    if (action === 'regen-client') {
      const question = `Générer une nouvelle clé pour « ${client.name} » ? L'ancienne clé arrêtera immédiatement de fonctionner.`;
      confirmModal({
        title: 'Nouvelle clé',
        message: esc(question),
        confirmLabel: 'Générer',
        onConfirm: async () => {
          const data = await api(`/clients/${client.id}/regenerate`, { method: 'POST' });
          closeModal();
          showKeyModal(data.key, data.client);
          await refreshCurrentView();
        },
      });
      return;
    }

    if (action === 'delete-client') {
      confirmModal({
        title: `Supprimer « ${client.name} » ?`,
        message: 'La clé cessera de fonctionner immédiatement et ses journaux de consommation seront effacés. Cette action est irréversible.',
        confirmLabel: 'Supprimer définitivement',
        danger: true,
        onConfirm: async () => {
          await api(`/clients/${client.id}`, { method: 'DELETE' });
          closeModal();
          toast('Clé supprimée.', 'success');
          await refreshCurrentView();
        },
      });
    }
  }

  /* --------------------------- gestion globale -------------------------- */

  document.addEventListener('click', async (event) => {
    const target = event.target;

    const nav = target.closest('[data-nav]');
    if (nav) {
      await setView(nav.dataset.nav);
      return;
    }

    const copy = target.closest('[data-copy]');
    if (copy) {
      const selector = copy.dataset.copy;
      const source = selector ? $(selector) : null;
      if (source) copyText(source.textContent);
      return;
    }

    if (target.closest('[data-close]')) {
      closeModal();
      return;
    }
    if (target.classList.contains('modal-backdrop')) {
      closeModal();
      return;
    }

    const actionEl = target.closest('[data-action]');
    if (actionEl) {
      try {
        await handleAction(actionEl.dataset.action, actionEl.dataset.id);
      } catch (err) {
        toast(err.message || 'Erreur inattendue.', 'error');
      }
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const kind = form.dataset.form;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalLabel = submitBtn ? submitBtn.textContent : null;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Patientez…';
    }
    try {
      if (kind === 'login') await handleLogin(form);
      else if (kind === 'client-create') await handleClientCreate(form);
      else if (kind === 'client-edit') await handleClientEdit(form);
      else if (kind === 'settings-provider') await handleProviderSave(form);
      else if (kind === 'settings-public') await handlePublicUrlSave(form);
      else if (kind === 'settings-budget') await handleBudgetSave(form);
      else if (kind === 'settings-pricing') await handlePricingSave(form);
      else if (kind === 'settings-aliases') await handleAliasesSave(form);
      else if (kind === 'settings-password') await handlePasswordSave(form);
    } catch (err) {
      toast(err.message || 'Erreur inattendue.', 'error');
    } finally {
      if (submitBtn && document.body.contains(submitBtn)) {
        submitBtn.disabled = false;
        if (originalLabel) submitBtn.textContent = originalLabel;
      }
    }
  });

  document.addEventListener('change', async (event) => {
    const filter = event.target.closest('[data-log-filter]');
    if (filter) {
      state.logs.clientId = filter.value;
      try {
        await loadLogs({ reset: true });
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });

  init();
})();
