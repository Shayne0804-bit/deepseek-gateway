/* Statut public de la passerelle (page d'accueil). */
(() => {
  'use strict';

  const copyButtons = document.querySelectorAll('[data-copy]');
  for (const button of copyButtons) {
    button.addEventListener('click', async () => {
      const value = button.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(value);
        const old = button.textContent;
        button.textContent = 'Copié';
        setTimeout(() => { button.textContent = old; }, 1600);
      } catch {
        button.textContent = 'Copier manuellement';
      }
    });
  }

  const badge = document.querySelector('#site-status');
  if (!badge) return;
  const dot = badge.querySelector('.dot');
  const text = badge.querySelector('.status-text');
  const pageVersion = document.querySelector('meta[name="app-version"]')?.content || null;

  async function refresh() {
    try {
      const res = await fetch('/healthz', { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
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

  refresh();
  setInterval(refresh, 60_000);
})();
