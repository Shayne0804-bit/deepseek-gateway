/* Statut public de la passerelle (page d'accueil). */
(() => {
  'use strict';

  const badge = document.querySelector('#site-status');
  if (!badge) return;
  const dot = badge.querySelector('.dot');
  const text = badge.querySelector('.status-text');

  async function refresh() {
    try {
      const res = await fetch('/healthz', { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      dot.className = 'dot ok';
      text.textContent = `en ligne · v${data.version}`;
    } catch {
      dot.className = 'dot warn';
      text.textContent = 'statut indisponible';
    }
  }

  refresh();
  setInterval(refresh, 60_000);
})();
