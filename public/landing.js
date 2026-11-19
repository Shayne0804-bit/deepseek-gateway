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
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

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

  /* ------------------------ morphose WebGL (hero) ---------------------- */
  const canvas = $('[data-morph]');
  if (canvas) startMorph(canvas);

  function startMorph(cv) {
    const gl = cv.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'low-power' });
    if (!gl) { cv.remove(); return; }

    const N = small.matches ? 2600 : 5200;
    const V_POLY = [[-1.7, 1.5], [-1, 1.5], [0, -0.3], [1, 1.5], [1.7, 1.5], [0.38, -1.3], [-0.38, -1.3]];
    const inV = (x, y) => {
      let c = false;
      for (let i = 0, j = V_POLY.length - 1; i < V_POLY.length; j = i++) {
        const [xi, yi] = V_POLY[i];
        const [xj, yj] = V_POLY[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const cloud = new Float32Array(N * 3);
    const sphere = new Float32Array(N * 3);
    const vee = new Float32Array(N * 3);
    const galaxy = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const seeds = new Float32Array(N);
    const palette = [[0.55, 0.92, 0.72], [0.24, 0.81, 0.71], [0.89, 1, 0.93], [0.94, 0.78, 0.45]];
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r0 = 4 + Math.random() * 3;
      cloud[k] = Math.sqrt(1 - u * u) * Math.cos(th) * r0;
      cloud[k + 1] = u * r0;
      cloud[k + 2] = Math.sqrt(1 - u * u) * Math.sin(th) * r0 * 0.4;
      const y = 1 - 2 * (i + 0.5) / N;
      const r = Math.sqrt(1 - y * y);
      const phi = i * 2.39996;
      sphere[k] = Math.cos(phi) * r * 2.1;
      sphere[k + 1] = y * 2.1;
      sphere[k + 2] = Math.sin(phi) * r * 2.1;
      let x;
      let yy;
      do { x = Math.random() * 3.4 - 1.7; yy = Math.random() * 2.8 - 1.3; } while (!inV(x, yy));
      vee[k] = x;
      vee[k + 1] = yy - 0.1;
      vee[k + 2] = (Math.random() - 0.5) * 0.55;
      const rr = Math.pow(Math.random(), 0.6) * 2.7;
      const an = rr * 1.9 + (i % 3) * 2.094 + (Math.random() - 0.5) * 0.35;
      galaxy[k] = Math.cos(an) * rr;
      galaxy[k + 1] = (Math.random() - 0.5) * 0.12;
      galaxy[k + 2] = Math.sin(an) * rr;
      const c = palette[Math.random() < 0.12 ? 3 : Math.floor(Math.random() * 3)];
      colors[k] = c[0]; colors[k + 1] = c[1]; colors[k + 2] = c[2];
      seeds[i] = Math.random();
    }
    const stages = [vee, sphere, vee, galaxy];
    const tilts = [0, 0, 0, 0.5];
    const pos = new Float32Array(N * 3);

    const vs = `
      attribute vec3 aP; attribute vec3 aC; attribute float aS;
      uniform float uT, uScat, uAspect, uSize, uF; uniform vec2 uRot;
      varying vec3 vC; varying float vA;
      void main() {
        vec3 q = aP + normalize(aP + vec3(0.001)) * uScat * (1.0 + aS * 4.0);
        float cy = cos(uRot.y), sy = sin(uRot.y);
        q = vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
        float cx = cos(uRot.x), sx = sin(uRot.x);
        q = vec3(q.x, q.y * cx - q.z * sx, q.y * sx + q.z * cx);
        float d = max(8.0 - q.z, 1.5);
        gl_Position = vec4(q.x * uF / uAspect, q.y * uF, 0.0, d);
        gl_PointSize = uSize * (0.55 + aS * 0.9) * 8.0 / d;
        vC = aC;
        vA = (0.6 + 0.4 * sin(uT * 2.0 + aS * 60.0)) * (1.0 - uScat);
      }`;
    const fs = `
      precision mediump float;
      varying vec3 vC; varying float vA;
      void main() {
        vec2 u = gl_PointCoord - 0.5;
        float a = exp(-dot(u, u) * 16.0) * vA * 0.9;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vC * a, a);
      }`;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const prog = gl.createProgram();
    const vsh = compile(gl.VERTEX_SHADER, vs);
    const fsh = compile(gl.FRAGMENT_SHADER, fs);
    if (!vsh || !fsh) { cv.remove(); return; }
    gl.attachShader(prog, vsh);
    gl.attachShader(prog, fsh);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cv.remove(); return; }
    gl.useProgram(prog);

    const attrib = (name, data, size, usage) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return buf;
    };
    const posBuf = attrib('aP', pos, 3, gl.DYNAMIC_DRAW);
    attrib('aC', colors, 3, gl.STATIC_DRAW);
    attrib('aS', seeds, 1, gl.STATIC_DRAW);
    const U = {};
    for (const name of ['uT', 'uScat', 'uAspect', 'uSize', 'uF', 'uRot']) U[name] = gl.getUniformLocation(prog, name);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, small.matches ? 1.5 : 2);
      const w = Math.max(1, Math.round(cv.clientWidth * dpr));
      const h = Math.max(1, Math.round(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
    };

    const hero = cv.closest('.hero');
    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    if (finePointer) {
      window.addEventListener('pointermove', (event) => {
        pointer.x = event.clientX / window.innerWidth * 2 - 1;
        pointer.y = event.clientY / window.innerHeight * 2 - 1;
      }, { passive: true });
    }

    const draw = (t) => {
      let a;
      let b;
      let e;
      let tilt = 0;
      if (t < 2.2) {
        a = cloud; b = vee; e = ease(clamp(t / 2.2, 0, 1));
      } else {
        const phase = 3.6;
        const tt = (t - 2.2) / phase;
        const s = Math.floor(tt);
        e = ease(clamp((tt - s - 0.55) / 0.45, 0, 1));
        a = stages[s % 4];
        b = stages[(s + 1) % 4];
        tilt = tilts[s % 4] + (tilts[(s + 1) % 4] - tilts[s % 4]) * e;
      }
      for (let i = 0; i < N * 3; i++) pos[i] = a[i] + (b[i] - a[i]) * e;
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);

      pointer.sx += (pointer.x - pointer.sx) * 0.05;
      pointer.sy += (pointer.y - pointer.sy) * 0.05;
      const heroH = hero ? hero.offsetHeight : window.innerHeight;
      const scat = reduced ? 0 : ease(clamp(window.scrollY / (heroH * 0.85), 0, 1));

      resize();
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(U.uT, t);
      gl.uniform1f(U.uScat, scat);
      gl.uniform1f(U.uAspect, cv.width / cv.height);
      gl.uniform1f(U.uSize, (small.matches ? 2.6 : 3.2) * dpr);
      gl.uniform1f(U.uF, small.matches ? 2.9 : 2.6);
      gl.uniform2f(U.uRot, tilt + pointer.sy * 0.25, Math.sin(t * 0.35) * 0.55 + pointer.sx * 0.5);
      gl.drawArrays(gl.POINTS, 0, N);
    };

    if (reduced) {
      draw(2.2);
      cv.classList.add('is-ready');
      window.addEventListener('resize', () => draw(2.2));
      return;
    }

    let running = false;
    let raf = 0;
    const t0 = performance.now();
    const loop = (now) => {
      draw((now - t0) / 1000);
      raf = requestAnimationFrame(loop);
    };
    const play = (on) => {
      if (on === running) return;
      running = on;
      if (on) raf = requestAnimationFrame(loop);
      else cancelAnimationFrame(raf);
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => play(entry.isIntersecting)).observe(cv);
    } else {
      play(true);
    }
    requestAnimationFrame(() => cv.classList.add('is-ready'));
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
