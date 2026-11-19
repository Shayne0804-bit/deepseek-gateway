/* Site de présentation : morphose WebGL, révélations au défilement,
   récit du trajet, galerie, copie et statut public. Sans dépendance. */
(() => {
  'use strict';

  document.documentElement.classList.add('js');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = window.matchMedia('(max-width: 760px)');
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ------------------------------ en-tête ------------------------------ */
  const header = $('[data-header]');
  const body = document.body;
  let lastY = window.scrollY;
  let ticking = false;
  const onScroll = () => {
    const y = window.scrollY;
    if (header) {
      header.classList.toggle('is-scrolled', y > 24);
      const hide = y > lastY && y > 480 && !body.classList.contains('menu-open');
      header.classList.toggle('is-hidden', hide);
    }
    lastY = y;
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  /* --------------------------- menu mobile ----------------------------- */
  const toggle = $('[data-menu-toggle]');
  const menu = $('[data-menu]');
  const setMenu = (open) => {
    body.classList.toggle('menu-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
    const label = toggle?.querySelector('.sr-only');
    if (label) label.textContent = open ? 'Fermer le menu' : 'Ouvrir le menu';
    if (menu) menu.inert = !open;
    if (open) header?.classList.remove('is-hidden');
  };
  toggle?.addEventListener('click', () => setMenu(!body.classList.contains('menu-open')));
  menu?.addEventListener('click', (event) => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && body.classList.contains('menu-open')) { setMenu(false); toggle?.focus(); }
  });
  window.matchMedia('(min-width: 1025px)').addEventListener('change', (event) => { if (event.matches) setMenu(false); });

  /* ------------------- section courante dans la nav -------------------- */
  const navLinks = $$('.nav a[href^="#"]');
  if ('IntersectionObserver' in window && navLinks.length) {
    const byId = new Map(navLinks.map((link) => [link.getAttribute('href').slice(1), link]));
    const navObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        navLinks.forEach((link) => link.classList.remove('is-current'));
        byId.get(entry.target.id)?.classList.add('is-current');
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    byId.forEach((_, id) => { const section = document.getElementById(id); if (section) navObserver.observe(section); });
  }

  /* ---------------------- révélation + compteurs ----------------------- */
  const countUp = (el) => {
    const target = Number(el.dataset.count);
    if (reduced || !Number.isFinite(target)) return;
    const from = target === 0 ? 9 : 0;
    const start = performance.now();
    const dur = 1400;
    const step = (now) => {
      const k = clamp((now - start) / dur, 0, 1);
      el.textContent = String(Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const revealTargets = $$('[data-reveal], [data-term], [data-steps]');
  const show = (el) => {
    el.classList.add('is-in');
    $$('[data-count]', el).forEach(countUp);
  };
  if (reduced || !('IntersectionObserver' in window)) {
    revealTargets.forEach((el) => el.classList.add('is-in'));
  } else {
    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        show(entry.target);
        revealObserver.unobserve(entry.target);
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    revealTargets.forEach((el) => revealObserver.observe(el));
  }

  /* ---------------------- projecteur sur les cartes -------------------- */
  if (finePointer) {
    for (const card of $$('[data-spot]')) {
      card.addEventListener('pointermove', (event) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        card.style.setProperty('--my', `${event.clientY - rect.top}px`);
      });
    }
  }

  /* ------------------------ récit du trajet ---------------------------- */
  const flow = $('[data-flow]');
  const nodes = $$('[data-node]');
  const steps = $$('[data-step]');
  const packet = $('[data-packet]');
  let current = 0;
  const placePacket = () => {
    const node = nodes[current];
    if (!node || !packet) return;
    if (small.matches) {
      packet.style.setProperty('--x', `${node.offsetLeft + node.offsetWidth / 2 - 7}px`);
    } else {
      packet.style.setProperty('--y', `${node.offsetTop + node.offsetHeight / 2 - 7}px`);
    }
  };
  const setStep = (index) => {
    current = index;
    nodes.forEach((node, i) => {
      node.classList.toggle('is-on', i <= index);
      node.classList.toggle('is-current', i === index);
    });
    steps.forEach((step, i) => step.classList.toggle('is-current', i === index));
    flow?.style.setProperty('--p', String(nodes.length > 1 ? index / (nodes.length - 1) : 1));
    placePacket();
  };
  if (flow && steps.length) {
    setStep(0);
    if ('IntersectionObserver' in window) {
      const storyObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setStep(steps.indexOf(entry.target));
        }
      }, { rootMargin: '-45% 0px -45% 0px' });
      steps.forEach((step) => storyObserver.observe(step));
    }
    window.addEventListener('resize', placePacket);
  }

  /* ------------------------------ galerie ------------------------------ */
  const gallery = $('[data-gallery]');
  if (gallery) {
    const slides = $$('[data-gallery-slide]', gallery);
    const thumbs = $$('[data-gallery-thumb]', gallery);
    const title = $('[data-gallery-title]', gallery);
    const caption = $('[data-gallery-caption]', gallery);
    const counter = $('[data-gallery-index]', gallery);
    let index = 0;
    let timer = null;
    const go = (next) => {
      index = (next + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        slide.classList.toggle('is-active', i === index);
        slide.setAttribute('aria-hidden', i === index ? 'false' : 'true');
      });
      thumbs.forEach((thumb, i) => {
        thumb.classList.toggle('is-active', i === index);
        thumb.setAttribute('aria-selected', i === index ? 'true' : 'false');
      });
      if (title) title.textContent = slides[index]?.dataset.title || 'VALARIA Code';
      if (caption) caption.textContent = slides[index]?.dataset.caption || '';
      if (counter) counter.textContent = String(index + 1).padStart(2, '0');
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => {
      stop();
      if (reduced || document.hidden) return;
      timer = setInterval(() => go(index + 1), 5200);
    };
    thumbs.forEach((thumb) => thumb.addEventListener('click', () => {
      go(Number(thumb.dataset.galleryThumb));
      caption?.setAttribute('aria-live', 'polite');
      start();
    }));
    gallery.addEventListener('pointerenter', stop);
    gallery.addEventListener('pointerleave', start);
    gallery.addEventListener('focusin', stop);
    gallery.addEventListener('focusout', start);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    go(0);
    start();
  }

  /* ------------------------------- copie ------------------------------- */
  for (const button of $$('[data-copy]')) {
    const label = button.textContent;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy || '');
        button.textContent = 'Copié';
        button.classList.add('is-done');
      } catch {
        button.textContent = 'Copie impossible';
      }
      setTimeout(() => { button.textContent = label; button.classList.remove('is-done'); }, 1600);
    });
  }

  /* --------------------------- statut public --------------------------- */
  const badge = $('#site-status');
  if (!badge) return;
  const dot = $('.dot', badge);
  const text = $('.status-text', badge);
  const pageVersion = $('meta[name="app-version"]')?.content || null;
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
