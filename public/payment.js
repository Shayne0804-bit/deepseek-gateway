/* Page dediee au retour de paiement SasPay. */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const fmtUsd = (value) => `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)} $`;
  const fmtAmount = (amount, currency) => {
    const n = Number(amount);
    const label = ['XOF', 'XAF'].includes(currency) ? 'FCFA' : (currency || '');
    const value = Number.isFinite(n) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n) : String(amount ?? '');
    return `${value} ${label}`.trim();
  };
  const fmtDate = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order') || params.get('pass_order') || '';
  const title = $('#payment-title');
  const message = $('#payment-message');
  const spinner = $('#payment-spinner');
  const actions = $('#payment-actions');
  const refresh = $('#payment-refresh');
  const back = $('#payment-back');
  const orderLabel = $('#payment-order');
  const POLL_MS = 5000;
  const MAX_POLLS = 60; // 5 minutes, ensuite l'utilisateur actualise a la main
  let timer = null;
  let polls = 0;

  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // state : pending (sablier + actions), waiting (actions seules), done (fini, pas d'actualisation)
  function setStatus(state, heading, text) {
    title.textContent = heading;
    message.textContent = text;
    spinner.classList.toggle('hidden', state !== 'pending');
    actions.classList.remove('hidden');
    refresh.classList.toggle('hidden', state === 'done');
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
    const body = $('#pass-modal-body');
    if (order.kind === 'payg') {
      $('#pass-modal-title').textContent = 'Crédit rechargé';
      body.innerHTML = `
        <p class="small muted" style="margin-top:0">Le crédit est ajouté à votre solde.</p>
        <dl class="spec-list">
          <div class="spec-row"><dt>Crédit ajouté</dt><dd>${fmtUsd(order.creditUsd)}</dd></div>
          ${me?.client ? `<div class="spec-row"><dt>Nouveau solde</dt><dd>${fmtUsd(me.client.walletUsd)}</dd></div>` : ''}
          <div class="spec-row"><dt>Montant payé</dt><dd>${esc(fmtAmount(order.amount, order.currency))}</dd></div>
          <div class="spec-row"><dt>Commande</dt><dd class="mono small">${esc(order.id)}</dd></div>
        </dl>
        <p class="small muted">Ce crédit n’expire pas. Il prend le relais quand votre pass est épuisé ou expiré, ou quand un plafond sur 5 h ou sur 7 jours est atteint.</p>`;
      $('#pass-modal').classList.remove('hidden');
      return;
    }
    const plan = me?.plan || {};
    const quota = me?.quota?.usd || {};
    const limits = me?.limits || {};
    const name = plan.name || order.plan || 'Votre pass';
    $('#pass-modal-title').textContent = 'Pass activé';
    body.innerHTML = `
      <p class="small muted" style="margin-top:0">Le pass ${esc(name)} est actif. Ses compteurs repartent de zéro.</p>
      <dl class="spec-list">
        <div class="spec-row"><dt>Pass</dt><dd>${esc(name)}</dd></div>
        ${me?.client ? `<div class="spec-row"><dt>Fin du pass</dt><dd>${fmtDate(me.client.expiresAt)}</dd></div>` : ''}
        ${quota.limit != null ? `<div class="spec-row"><dt>Crédit site</dt><dd>${fmtUsd(quota.limit)}</dd></div>` : ''}
        ${limits.credit5h ? `<div class="spec-row"><dt>Plafond 5 h</dt><dd>${fmtUsd(limits.credit5h.limit)}</dd></div>` : ''}
        ${limits.creditWeek ? `<div class="spec-row"><dt>Plafond 7 jours</dt><dd>${fmtUsd(limits.creditWeek.limit)}</dd></div>` : ''}
        <div class="spec-row"><dt>Montant payé</dt><dd>${esc(fmtAmount(order.amount, order.currency))}</dd></div>
        <div class="spec-row"><dt>Commande</dt><dd class="mono small">${esc(order.id)}</dd></div>
      </dl>
      <p class="small muted">Votre clé API reste la même. Tout est visible dans votre espace.</p>`;
    $('#pass-modal').classList.remove('hidden');
  }

  async function loadMe() {
    const response = await fetch('/portal/api/me', { credentials: 'same-origin' });
    if (!response.ok) return null;
    return response.json();
  }

  async function confirm() {
    if (!orderId) {
      setStatus('done', 'Lien de paiement invalide', 'Ce lien ne contient aucun numéro de commande. Ouvrez votre espace pour voir vos accès.');
      return;
    }
    if (!timer) setStatus('pending', 'Vérification du paiement…', 'Nous vérifions votre paiement auprès de SasPay. Gardez cette page ouverte.');
    try {
      const data = await api('/portal/api/pass/confirm');
      const order = data.order || {};
      orderLabel.textContent = `Commande ${order.id || orderId}${order.amount ? ` · ${fmtAmount(order.amount, order.currency)}` : ''}`;
      if (order.status === 'completed') {
        stopPolling();
        const me = await loadMe();
        setStatus('done', 'Paiement confirmé', order.kind === 'payg' ? 'Le crédit est ajouté à votre solde.' : 'Votre pass est activé.');
        showSuccessModal(order, me);
        return;
      }
      if (order.status === 'failed_credit') {
        stopPolling();
        setStatus('done', 'Paiement reçu, activation en échec', 'Votre paiement est bien arrivé, mais l’activation a échoué. Contactez le support en donnant le numéro de commande ci-dessous : nous l’activerons à la main.');
        return;
      }
      if (order.status === 'failed') {
        stopPolling();
        setStatus('done', 'Paiement non abouti', 'Le paiement a échoué ou a été annulé. Rien n’a été activé sur votre compte. Vous pouvez relancer un paiement depuis votre espace.');
        return;
      }
      // pending ou processing : on revérifie tout seul pendant 5 minutes.
      if (!timer && polls < MAX_POLLS) timer = setInterval(() => { polls += 1; confirm(); }, POLL_MS);
      if (polls >= MAX_POLLS) {
        stopPolling();
        setStatus('waiting', 'Paiement toujours en attente', 'SasPay n’a pas encore confirmé le paiement. Actualisez plus tard : votre pass ou votre crédit s’activera dès la confirmation.');
        return;
      }
      setStatus('pending', 'Paiement en attente', 'SasPay n’a pas encore confirmé le paiement. Cette page se met à jour toute seule.');
    } catch (err) {
      if (err.status === 401) {
        stopPolling();
        back.href = `/portal?next=${encodeURIComponent(`/payment?order=${orderId}`)}`;
        back.textContent = 'Me connecter';
        setStatus('done', 'Connectez-vous', 'Votre session a expiré. Connectez-vous, vous reviendrez ensuite sur cette page.');
        return;
      }
      if (err.status === 404) {
        stopPolling();
        setStatus('done', 'Commande introuvable', 'Cette commande n’existe pas ou appartient à un autre compte.');
        return;
      }
      stopPolling();
      setStatus('waiting', 'Vérification impossible', err.message || 'Vérification impossible pour le moment. Réessayez dans quelques instants.');
    }
  }

  refresh.addEventListener('click', () => {
    stopPolling();
    polls = 0;
    confirm();
  });
  window.addEventListener('beforeunload', stopPolling);
  confirm();
})();
