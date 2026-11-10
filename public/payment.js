/* Page dediee au retour de paiement SasPay. */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const fmtUsd = (value) => `$${Number(value || 0).toFixed(2)}`;
  const fmtDate = (value) => {
    if (!value) return '—';
    try { return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }); } catch { return '—'; }
  };

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order') || params.get('pass_order') || '';
  const title = $('#payment-title');
  const message = $('#payment-message');
  const spinner = $('#payment-spinner');
  const actions = $('#payment-actions');
  const orderLabel = $('#payment-order');
  let timer = null;

  function setStatus(state, heading, text) {
    title.textContent = heading;
    message.textContent = text;
    spinner.classList.toggle('hidden', state !== 'pending');
    actions.classList.toggle('hidden', state === 'pending');
    actions.dataset.state = state;
  }

  async function api(path) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-portal' },
      credentials: 'same-origin',
      body: JSON.stringify({ order_id: orderId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || `Erreur ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function showSuccessModal(order, me) {
    const plan = me?.plan || {};
    const quota = me?.quota?.usd || {};
    const limits = me?.limits || {};
    const body = $('#pass-modal-body');
    body.innerHTML = `
      <p class="small muted" style="margin-top:0">${esc(order.planLabel || plan.name || order.plan || 'Pass')} est maintenant actif.</p>
      <dl class="spec-list">
        <div class="spec-row"><dt>Pass</dt><dd>${esc(plan.name || order.plan || '—')}</dd></div>
        <div class="spec-row"><dt>Fin du pass</dt><dd>${fmtDate(me?.client?.expiresAt)}</dd></div>
        <div class="spec-row"><dt>Crédit site</dt><dd>${fmtUsd(quota.limit)}</dd></div>
        ${limits.credit5h ? `<div class="spec-row"><dt>Plafond 5 h</dt><dd>${fmtUsd(limits.credit5h.limit)}</dd></div>` : ''}
        ${limits.creditWeek ? `<div class="spec-row"><dt>Plafond semaine</dt><dd>${fmtUsd(limits.creditWeek.limit)}</dd></div>` : ''}
        <div class="spec-row"><dt>Montant payé</dt><dd>${esc(order.amount)} ${esc(order.currency)}</dd></div>
      </dl>
      <p class="small muted">Votre clé API et vos accès sont disponibles dans le dashboard.</p>`;
    $('#pass-modal').classList.remove('hidden');
  }

  async function loadMe() {
    const response = await fetch('/portal/api/me', { credentials: 'same-origin' });
    if (!response.ok) return null;
    return response.json();
  }

  async function confirm() {
    if (!orderId) {
      setStatus('failed', 'Lien de paiement invalide', 'Aucune commande à vérifier.');
      return;
    }
    setStatus('pending', 'Vérification du paiement…', 'Nous vérifions le statut réel auprès de SasPay.');
    try {
      const data = await api('/portal/api/pass/confirm');
      const order = data.order || {};
      orderLabel.textContent = `Commande ${order.id || orderId} · ${order.amount || ''} ${order.currency || ''}`;
      if (order.status === 'completed') {
        const me = await loadMe();
        setStatus('completed', 'Paiement confirmé', 'Votre pass est activé.');
        actions.classList.remove('hidden');
        $('#payment-refresh').classList.add('hidden');
        showSuccessModal(order, me);
        return;
      }
      if (order.status === 'failed' || order.status === 'failed_credit') {
        setStatus('failed', 'Paiement non confirmé', 'Le paiement n’a pas abouti. Aucun crédit n’a été activé.');
        actions.classList.remove('hidden');
        return;
      }
      setStatus('pending', 'Paiement en attente', 'Le paiement n’est pas encore confirmé par SasPay. Actualisez dans quelques instants.');
      actions.classList.remove('hidden');
      if (!timer) timer = setInterval(confirm, 5000);
    } catch (err) {
      if (err.status === 401) {
        setStatus('failed', 'Connectez-vous', 'Reconnectez-vous à votre espace pour vérifier ce paiement.');
        actions.classList.remove('hidden');
        return;
      }
      setStatus('pending', 'Vérification en cours', err.message || 'Impossible de vérifier le statut pour le moment.');
      actions.classList.remove('hidden');
    }
  }

  $('#payment-refresh')?.addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = null; }
    confirm();
  });
  window.addEventListener('beforeunload', () => { if (timer) clearInterval(timer); });
  confirm();
})();
