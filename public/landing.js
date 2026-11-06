/* Statut public de la passerelle (page d'accueil). */
(() => {
  'use strict';

  const gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    const slides = Array.from(gallery.querySelectorAll('[data-gallery-slide]'));
    const thumbs = Array.from(gallery.querySelectorAll('[data-gallery-thumb]'));
    const title = gallery.querySelector('[data-gallery-title]');
    const caption = gallery.querySelector('[data-gallery-caption]');
    const counter = gallery.querySelector('[data-gallery-index]');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let index = 0;
    let timer = null;
    const show = (next, announce = false) => {
      index = (next + slides.length) % slides.length;
      slides.forEach((slide, item) => {
        const active = item === index;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
      thumbs.forEach((thumb, item) => {
        const active = item === index;
        thumb.classList.toggle('is-active', active);
        thumb.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      if (title) title.textContent = slides[index]?.dataset.title || 'VALARIA Code';
      if (caption) caption.textContent = slides[index]?.dataset.caption || '';
      if (counter) counter.textContent = String(index + 1).padStart(2, '0');
      if (announce) {
        const live = gallery.querySelector('[data-gallery-caption]');
        if (live) live.setAttribute('aria-live', 'polite');
      }
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => {
      stop();
      if (reduced || document.hidden) return;
      timer = setInterval(() => show(index + 1), 5200);
    };
    thumbs.forEach((thumb) => {
      thumb.addEventListener('click', () => {
        show(Number(thumb.getAttribute('data-gallery-thumb')));
        start();
      });
    });
    gallery.addEventListener('pointerenter', stop);
    gallery.addEventListener('pointerleave', start);
    gallery.addEventListener('focusin', stop);
    gallery.addEventListener('focusout', start);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else start();
    });
    show(0);
    start();
  }

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

  const revealElements = Array.from(document.querySelectorAll('[data-reveal]'));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealElements.forEach((element) => element.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealElements.forEach((element) => revealObserver.observe(element));
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
