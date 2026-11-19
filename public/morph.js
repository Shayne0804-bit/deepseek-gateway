/* Morphose VALARIA : nuage de particules WebGL qui forme le V, puis
   sphère, V, galaxie. Sans dépendance. Monté automatiquement sur tout
   <canvas data-morph="hero|ambient|center|field">. Mouvement réduit : image fixe. */
(() => {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = window.matchMedia('(max-width: 760px)');
  const narrow = window.matchMedia('(max-width: 1024px)');
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  const PRESETS = {
    // Hero de la landing : dense, se disperse au défilement.
    // Fond fixe de la landing : V à droite du titre, éclaté en champ d'étoiles au défilement.
    hero: { desktop: 5200, mobile: 2600, f: 2.6, fMobile: 2.2, offsetX: 0.36, offsetYMobile: 0.5, base: 0, scroll: true, scrollMax: 0.72 },
    // Fond des écrans d'accès : plus léger, V décalé derrière le formulaire.
    ambient: { desktop: 3400, mobile: 1500, f: 3.4, fMobile: 2.4, offsetX: 0.42, base: 0.12, scroll: false },
    // Variante centrée (carte unique au milieu : admin, paiement).
    center: { desktop: 3400, mobile: 1500, f: 3.6, fMobile: 2.4, offsetX: 0, base: 0.12, scroll: false },
    // Tableaux de bord : nébuleuse légère et dispersée, ouverte longtemps, donc moins de particules.
    field: { desktop: 3200, mobile: 1300, f: 3.3, fMobile: 2.2, offsetX: 0.1, base: 0.32, scroll: false, size: 1.5 },
  };

  function startMorph(cv, opts) {
    const gl = cv.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'low-power' });
    if (!gl) { cv.remove(); return; }

    const N = small.matches ? opts.mobile : opts.desktop;
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
      uniform float uT, uScat, uAspect, uSize, uF, uOff, uOffY; uniform vec2 uRot;
      varying vec3 vC; varying float vA;
      void main() {
        vec3 q = aP + normalize(aP + vec3(0.001)) * uScat * (1.0 + aS * 4.0);
        float cy = cos(uRot.y), sy = sin(uRot.y);
        q = vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
        float cx = cos(uRot.x), sx = sin(uRot.x);
        q = vec3(q.x, q.y * cx - q.z * sx, q.y * sx + q.z * cx);
        float d = max(8.0 - q.z, 1.5);
        gl_Position = vec4(q.x * uF / uAspect + uOff * d, q.y * uF + uOffY * d, 0.0, d);
        gl_PointSize = uSize * (0.55 + aS * 0.9) * 8.0 / d;
        vC = aC;
        vA = (0.6 + 0.4 * sin(uT * 2.0 + aS * 60.0)) * (1.0 - uScat * 0.65);
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
    for (const name of ['uT', 'uScat', 'uAspect', 'uSize', 'uF', 'uOff', 'uOffY', 'uRot']) U[name] = gl.getUniformLocation(prog, name);
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
      const scrolled = opts.scroll && !reduced ? ease(clamp(window.scrollY / (heroH * 0.85), 0, 1)) : 0;
      const scat = opts.base + ((opts.scrollMax ?? 1) - opts.base) * scrolled;

      resize();
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(U.uT, t);
      gl.uniform1f(U.uScat, scat);
      gl.uniform1f(U.uAspect, cv.width / cv.height);
      gl.uniform1f(U.uSize, (small.matches ? 2.6 : 3.2) * dpr * (opts.size || 1));
      gl.uniform1f(U.uF, narrow.matches ? opts.fMobile : opts.f);
      gl.uniform1f(U.uOff, narrow.matches ? 0 : opts.offsetX);
    gl.uniform1f(U.uOffY, narrow.matches ? (opts.offsetYMobile || 0) : 0);
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

  for (const cv of document.querySelectorAll('canvas[data-morph]')) {
    startMorph(cv, PRESETS[cv.dataset.morph] || PRESETS.hero);
  }
})();
