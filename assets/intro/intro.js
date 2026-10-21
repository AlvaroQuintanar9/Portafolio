/* ==========================================================================
   intro.js — intro "huevo" del portafolio
   --------------------------------------------------------------------------
   Secuencia: fondo blanco con un huevo y "Rómpelo". El visitante le pega tres
   veces (cada golpe suena, agranda la grieta y el huevo brilla más por dentro)
   -> se rompe: estalla un destello de luz y las apps salen del centro hacia su
   sitio -> la luz se apaga poco a poco y las apps cogen color mientras se posan.

   Movimiento: todas las apps vuelan a la vez y llegan a la vez, cada una por una
   curva suave distinta, en un único movimiento continuo que frena de forma
   uniforme (desaceleración constante) hasta posarse, sin pararse a medio camino.

   Cómo funciona
   · Se carga en <head> ANTES de dc-runtime.js. Decide al instante si toca intro
     y lo publica en window.__cineIntro: la web lo lee para saltarse su mini-intro
     propia y pintar los iconos ya en su posición final.
   · La intro es una capa superpuesta (#cine-intro). No toca el DOM de la web:
     clona las "aplicaciones" marcadas con [data-intro] (iconos del escritorio,
     dock, apps del móvil), las anima y las aterriza en el rect exacto del
     original (getBoundingClientRect). Luego muestra los originales y elimina
     la capa.
   · El contenido real sigue en el DOM todo el tiempo (SEO / lectores de pantalla).
   · Si algo falla, la capa se retira y la web funciona con normalidad.

   Reproducir de nuevo: clic en el punto negro de la barra de menú,
   atajo Alt/Option + I, o abrir la web con ?intro  (?intro=0 la desactiva).
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------------
     PARÁMETROS AJUSTABLES
     ------------------------------------------------------------------------- */
  var CONFIG = {
    // El visitante rompe el huevo con `hits` golpes; el resto de la secuencia arranca
    // tras el último. Tiempos en segundos, contados desde el momento en que se rompe.
    hits: 3,
    timeline: {
      hatchDelay: 0.26,          // pausa entre el último golpe y la rotura (el huevo se tensa)
      air: 0.02,                 // empieza el soplo de aire de la explosión
      fade: 1.6,                 // la luz y el fondo blanco se han ido
      end: 2.1                   // fin mínimo (se espera además a que aterricen todas)
    },
    speed: 1,              // >1 más rápido, <1 más lento (escala la línea de tiempo y el audio)
    // Vuelo de las apps: todas salen a la vez del centro y llegan a la vez a su sitio, en un solo
    // movimiento continuo (sin pararse) que va frenando de forma uniforme hasta posarse.
    flight: { duration: 2.0, curve: 0.18, tilt: 14 },  // duración (s), curvatura del trayecto, inclinación inicial (grados)
    flash: { size: 0.85, life: 1.3, rotate: 0.25, rays: 10, sparks: 46 },  // destello: tamaño de los rayos (fracción de pantalla), duración (s), giro (rad/s)
    volume: 0.35,          // volumen master por defecto (0–1)
    desktop: { shards: 16, motes: 70, sparks: 1, dpr: 2 },
    mobile:  { shards: 10, motes: 30, sparks: 0.55, dpr: 1.5 },
    colors: {              // canvas (los del fondo, huevo y botones están en intro.css)
      shell: [247, 242, 233],
      shellShade: [214, 200, 180],
      light: [255, 196, 112],    // estelas de luz y motas de polvo
      bloom: [255, 186, 96]     // color del destello
    },
    storageKey: 'aq-intro-seen',   // sessionStorage: no repetir en la misma sesión
    muteKey: 'aq-intro-muted'      // localStorage: recordar si el visitante silenció
  };

  var TEXT = {
    es: { dialog: 'Intro', enter: 'Rómpelo', skip: 'Saltar', mute: 'Silenciar sonido', unmute: 'Activar sonido', replay: 'Reproducir intro' },
    en: { dialog: 'Intro', enter: 'Break it', skip: 'Skip', mute: 'Mute sound', unmute: 'Unmute sound', replay: 'Replay intro' }
  };

  /* ---------------------------------------------------------------------------
     Arranque síncrono (en <head>)
     ------------------------------------------------------------------------- */
  var root = document.documentElement;
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function sGet(kind, k) { try { return store(kind).getItem(k); } catch (e) { return null; } }
  function sSet(kind, k, v) { try { store(kind).setItem(k, v); } catch (e) {} }

  var params = null;
  try { params = new URLSearchParams(location.search); } catch (e) {}
  var qIntro = params ? params.get('intro') : null;
  var forced = qIntro !== null && qIntro !== '0';
  var disabled = qIntro === '0';
  // A los rastreadores no se les muestra la capa (el contenido ya está en el DOM igualmente).
  var isBot = /bot|crawl|spider|slurp|lighthouse|headless|prerender|preview/i.test(navigator.userAgent || '');
  var shouldRun = !disabled && (forced || (!isBot && !sGet('sessionStorage', CONFIG.storageKey)));

  window.__cineIntro = shouldRun;
  if (shouldRun) root.classList.add('cine-on', 'cine-hide');

  var lang = (function () {
    var q = params ? params.get('lang') : null;
    if (q === 'es' || q === 'en') return q;
    var s = sGet('localStorage', 'lang');
    if (s === 'es' || s === 'en') return s;
    var nav = ((navigator.languages && navigator.languages[0]) || navigator.language || 'es').toLowerCase();
    return nav.indexOf('en') === 0 ? 'en' : 'es';
  })();
  var L = TEXT[lang];

  var current = null; // instancia en curso

  document.addEventListener('DOMContentLoaded', function () {
    if (shouldRun) {
      try { current = createIntro(); }
      catch (e) { console.warn('[intro] no se pudo montar:', e); cleanupRoot(); }
    }
    bindReplay();
  });

  function cleanupRoot() {
    root.classList.remove('cine-on', 'cine-hide', 'cine-swap');
    window.__cineIntro = false;
  }

  /* ---------------------------------------------------------------------------
     Utilidades
     ------------------------------------------------------------------------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clamp01(v) { return clamp(v, 0, 1); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; }
  function isMobile() { return window.matchMedia('(max-width: 820px), (max-height: 500px) and (pointer: coarse)').matches; }
  function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  // Ruido suave 1D (0–1) para parpadeos y derivas orgánicas, en vez de senos regulares.
  var NOISE = []; for (var ni = 0; ni < 256; ni++) NOISE.push(Math.random());
  function noise(x) { var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return NOISE[i & 255] + (NOISE[(i + 1) & 255] - NOISE[i & 255]) * u; }

  var ICON_SOUND_ON = '<svg class="on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  var ICON_SOUND_OFF = '<svg class="off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

  // Grieta en zig-zag (coordenadas del viewBox 0 0 100 128, el mismo trazado que el clip-path
  // de las dos mitades en intro.css). Nace en el centro y se abre hacia los dos lados.
  var CRACK_RIGHT = '53,73 65,58.9 77,71.7 88,60.2 100,67.8';
  var CRACK_LEFT = '53,73 41,60.2 29,70.4 17,58.9 0,69.1';
  var EGG_HTML =
    '<div class="cine-egg-shadow"></div>' +
    '<div class="cine-glow"></div>' +
    '<div class="cine-half bottom"><div class="cine-shell"></div></div>' +
    '<div class="cine-half top"><div class="cine-shell"></div></div>' +
    '<div class="cine-shell-clip">' +
      '<div class="cine-inner"></div>' +   // luz que se transparenta desde dentro de la cáscara
      '<svg class="cine-crack" viewBox="0 0 100 128" preserveAspectRatio="none" aria-hidden="true">' +
        '<polyline class="light" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" points="' + CRACK_RIGHT + '"/>' +
        '<polyline class="light" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" points="' + CRACK_LEFT + '"/>' +
        '<polyline class="line" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" points="' + CRACK_RIGHT + '"/>' +
        '<polyline class="line" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" points="' + CRACK_LEFT + '"/>' +
      '</svg>' +
    '</div>';

  /* ---------------------------------------------------------------------------
     Intro
     ------------------------------------------------------------------------- */
  function createIntro() {
    // Hasta el último golpe no se sabe cuándo se rompe: la línea de tiempo se fija entonces (scheduleHatch).
    var TL = { hatch: Infinity, air: Infinity, fade: Infinity, end: Infinity };
    var hits = [];                        // instantes (s) de cada golpe, en el reloj de la intro
    var mobile = isMobile();
    var Q = mobile ? CONFIG.mobile : CONFIG.desktop;
    var reduced = reducedMotion();
    var muted = sGet('localStorage', CONFIG.muteKey) === '1';

    // ---- DOM de la capa ----
    var el = document.createElement('div');
    el.className = 'cine';
    el.id = 'cine-intro';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', L.dialog);
    el.innerHTML =
      '<div class="cine-bg"></div>' +
      '<div class="cine-dim" aria-hidden="true"></div>' +
      '<div class="cine-light" aria-hidden="true"></div>' +   // luz bajo el destello y las apps: ilumina el espacio
      '<div class="cine-ring" aria-hidden="true"></div>' +
      '<div class="cine-egg" aria-hidden="true">' + EGG_HTML + '</div>' +
      '<canvas class="cine-canvas" aria-hidden="true"></canvas>' +   // encima del huevo: el destello sale por delante
      '<div class="cine-stage" aria-hidden="true"></div>' +
      '<div class="cine-gate"><button type="button" class="cine-enter">' + L.enter + '</button>' +
        '<span class="cine-dots" aria-hidden="true">' + new Array(CONFIG.hits + 1).join('<i></i>') + '</span></div>' +
      '<div class="cine-controls">' +
        '<button type="button" class="cine-btn cine-skip">' + L.skip + '</button>' +
        '<button type="button" class="cine-btn icon cine-mute">' + ICON_SOUND_ON + ICON_SOUND_OFF + '</button>' +
      '</div>';
    document.body.appendChild(el);

    var $ = function (s) { return el.querySelector(s); };
    var bg = $('.cine-bg'), dim = $('.cine-dim'), light = $('.cine-light'), canvas = $('.cine-canvas'), stage = $('.cine-stage'), ring = $('.cine-ring');
    var egg = $('.cine-egg'), eggShadow = $('.cine-egg-shadow'), glow = $('.cine-glow'), inner = $('.cine-inner');
    var halfTop = $('.cine-half.top'), halfBottom = $('.cine-half.bottom'), crackSvg = $('.cine-crack');
    var crackLines = el.querySelectorAll('.cine-crack .line'), crackLights = el.querySelectorAll('.cine-crack .light');
    var gate = $('.cine-gate'), skipBtn = $('.cine-skip'), muteBtn = $('.cine-mute'), enterBtn = $('.cine-enter');
    var dots = el.querySelectorAll('.cine-dots i');
    var ctx2d = canvas.getContext('2d');

    function paintMute() {
      muteBtn.setAttribute('aria-pressed', String(muted));
      muteBtn.setAttribute('aria-label', muted ? L.unmute : L.mute);
      muteBtn.title = muted ? L.unmute : L.mute;
    }
    paintMute();

    // ---- Estado ----
    var W = 0, H = 0, DPR = 1, cx = 0, cy = 0, minSide = 0, eggW = 100, iconSize = 48;
    var shards = [], motes = [], clones = [], sparks = [], rays = [];
    var audio = null, raf = 0, startAt = 0, lastT = 0, started = false, alive = true, landingSet = false, collected = false, launched = false;
    var safety = 0;
    var prevFocus = document.activeElement;

    function measure() {
      W = window.innerWidth; H = window.innerHeight;
      cx = W / 2; cy = H / 2;
      minSide = Math.min(W, H);
      eggW = egg.offsetWidth || 100;
      DPR = Math.min(window.devicePixelRatio || 1, Q.dpr);
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      ctx2d.setTransform(DPR, 0, 0, DPR, 0, 0);
      clones.forEach(measureClone); clones.forEach(applyClone);   // primero leer todo, luego escribir (sin reflows)
      sizeClones();
    }
    measure();

    /* ---- Clones de las aplicaciones ---- */
    function collect() {
      collected = true;
      var found = Array.prototype.slice.call(document.querySelectorAll('[data-intro]')).filter(function (n) {
        if (el.contains(n)) return false;
        var r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W;
      });
      found.forEach(function (orig, i) {
        var c = orig.cloneNode(true);
        c.removeAttribute('data-intro');
        c.removeAttribute('id');
        c.querySelectorAll('[data-intro],[id]').forEach(function (n) { n.removeAttribute('data-intro'); n.removeAttribute('id'); });
        c.classList.add('cine-clone');
        c.setAttribute('aria-hidden', 'true');
        // Casi invisibles pero pintadas: así el navegador rasteriza iconos y filtros en el momento libre
        // y no justo al romper el huevo.
        c.style.opacity = '0.001';
        c.style.filter = 'grayscale(0.75) sepia(0.3) brightness(1.8) contrast(0.75)';
        var item = { orig: orig, el: c, i: i, fx: 0, fy: 0, k: 1, w: 0, h: 0, os: 1, iw: 0, ih: 0, dy: 0, label: null, rel: Infinity, done: false };
        clones.push(item);
        measureClone(item);
      });
      // Todas las lecturas de layout ya están hechas: ahora se escriben estilos y se insertan los clones
      // (intercalar lecturas y escrituras forzaba un reflow por app y daba un tirón al romperse).
      var frag = document.createDocumentFragment();
      clones.forEach(function (c) { applyClone(c); frag.appendChild(c.el); });
      stage.appendChild(frag);
      sizeClones();
    }

    // Trayecto de cada app: curva suave del centro a su sitio (con una curvatura distinta para cada una).
    function launch() {
      launched = true;
      clones.forEach(measureClone); clones.forEach(applyClone);   // por si algo se movió desde que se crearon
      var F = CONFIG.flight;
      clones.forEach(function (c) {
        c.tx = c.fx; c.ty = c.fy + c.dy * c.k;
        var dx = c.tx - cx, dy = c.ty - cy;
        var bend = (Math.random() * 2 - 1) * F.curve;
        c.qx = cx + dx / 2 - dy * bend; c.qy = cy + dy / 2 + dx * bend;   // punto de control (perpendicular)
        c.tilt0 = (Math.random() * 2 - 1) * F.tilt;
        c.x = cx; c.y = cy; c.vx = c.vy = 0; c.s = c.k * 0.25; c.rot = c.tilt0;
        c.rel = 0;
        c.trail = []; c.done = false; c.tLand = TL.hatch + F.duration * 0.75;
      });
    }

    // Coloca el clon en el rect exacto del original; el resto es solo transform.
    function measureClone(c) {
      var r = c.orig.getBoundingClientRect();
      var w = c.orig.offsetWidth || r.width, h = c.orig.offsetHeight || r.height;
      c.w = w; c.h = h;
      // Si la app tiene etiqueta debajo (escritorio / móvil), el tamaño de referencia es solo el icono:
      // la etiqueta se oculta hasta que aterriza.
      var first = c.orig.firstElementChild;
      var labeled = first && c.orig.children.length > 1 && first.offsetWidth >= w * 0.5 && h > first.offsetHeight * 1.25;
      c.iw = labeled ? first.offsetWidth : w; c.ih = labeled ? first.offsetHeight : h;
      c.k = w ? r.width / w : 1;                 // escala heredada (p. ej. el dock escalado)
      var fr = labeled ? first.getBoundingClientRect() : r;
      c.dy = ((fr.top + fr.height / 2) - (r.top + r.height / 2)) / (c.k || 1); // centro del icono respecto al del clon
      c.label = labeled ? c.el.lastElementChild : null;
      c.fx = r.left + r.width / 2; c.fy = r.top + r.height / 2;
    }
    function applyClone(c) {
      var s = c.el.style, w = c.w, h = c.h;
      s.left = (c.fx - w / 2) + 'px'; s.top = (c.fy - h / 2) + 'px';
      s.width = w + 'px'; s.height = h + 'px';
      s.right = 'auto'; s.bottom = 'auto';
    }

    // Tamaño medio de los iconos (grosor de las estelas de luz).
    function sizeClones() {
      if (!clones.length) return;
      iconSize = clones.reduce(function (m, c) { return m + Math.max(c.iw, c.ih) * c.k; }, 0) / clones.length;
    }

    /* ---- Física ---- */
    // Vuelo: posición sobre la curva con un frenado uniforme (desaceleración constante:
    // sale rápido de la explosión y va perdiendo velocidad siempre al mismo ritmo hasta posarse).
    function physics(c, t, dt) {
      var lt = t - TL.hatch;
      if (lt < 0 || c.done) return;
      var p = clamp01(lt / CONFIG.flight.duration), e = 1 - (1 - p) * (1 - p), u = 1 - e;
      var x = u * u * cx + 2 * u * e * c.qx + e * e * c.tx;
      var y = u * u * cy + 2 * u * e * c.qy + e * e * c.ty;
      if (dt > 0) { c.vx = (x - c.x) / dt; c.vy = (y - c.y) / dt; }
      c.x = x; c.y = y;
      c.s = c.k * (0.25 + 0.75 * Math.min(1, e * 1.15));
      c.rot = c.tilt0 * (1 - e);
      if (p >= 1) { c.done = true; c.x = c.tx; c.y = c.ty; c.s = c.k; c.vx = c.vy = 0; c.rot = 0; }
    }

    /* ---- Fragmentos de cáscara y motas de luz ---- */
    function hatchBurst() {
      // Chispas: puntos de luz que salen disparados en todas direcciones y se apagan.
      var nS = Math.round(CONFIG.flash.sparks * Q.sparks);
      for (var si = 0; si < nS; si++) {
        var sa = Math.random() * Math.PI * 2, sv = minSide * (0.6 + Math.random() * 1.6);
        sparks.push({ vx: Math.cos(sa) * sv, vy: Math.sin(sa) * sv, life: 0.45 + Math.random() * 0.6, w: 0.8 + Math.random() * 1.8 });
      }
      // Rayos finos secundarios a ángulos al azar (la estrella deja de ser simétrica: más natural).
      for (var ri = 0; ri < CONFIG.flash.rays; ri++) rays.push({ a: Math.random() * Math.PI * 2, l: 0.18 + Math.random() * 0.4, th: 0.4 + Math.random() * 0.7, ph: Math.random() * 10 });
      for (var i = 0; i < Q.shards; i++) {
        var a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6;
        var v = 300 + Math.random() * 560;
        var pts = [], n = 3 + (Math.random() * 3 | 0), sz = eggW * (0.04 + Math.random() * 0.08);
        for (var k = 0; k < n; k++) { var aa = (k / n) * Math.PI * 2 + Math.random() * 0.9; pts.push(Math.cos(aa) * sz * (0.5 + Math.random() * 0.6), Math.sin(aa) * sz * (0.5 + Math.random() * 0.6)); }
        shards.push({ x: cx + (Math.random() - 0.5) * eggW * 0.7, y: cy + eggW * 0.06, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 16, flip: 6 + Math.random() * 14, ph: Math.random() * 6.28, pts: pts, life: 0.75 + Math.random() * 0.35 });
      }
      var R0 = minSide * 0.36;
      for (var j = 0; j < Q.motes; j++) {
        var b = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R0 * 1.35, sv = 10 + Math.random() * 40;
        motes.push({ x: cx + Math.cos(b) * d, y: cy + Math.sin(b) * d, vx: Math.cos(b) * sv, vy: Math.sin(b) * sv,
          size: 0.6 + Math.random() * 1.8, seed: Math.random() * 100, br: 0.3 + Math.random() * 0.7 });
      }
    }

    /* ---- Huevo: grietas, temblor, brillo interior y rotura ---- */
    function renderEgg(t) {
      var B = TL.hatch, N = CONFIG.hits;
      if (t < B) {
        // Cada golpe: temblor amortiguado + un pequeño aplastamiento, y la grieta avanza un tramo
        var rot = 0, sq = 0, p = 0;
        for (var i = 0; i < hits.length; i++) {
          var d = t - hits[i];
          if (d < 0) continue;
          var amp = 4 + 5 * (i / Math.max(1, N - 1));
          rot += amp * Math.exp(-d * 9) * Math.sin(d * 42) * (i % 2 ? -1 : 1);
          sq += 0.05 * Math.exp(-d * 16);
          p += easeOutCubic(clamp01(d / 0.07)) / N;
        }
        var tense = hits.length >= N ? clamp01((t - hits[N - 1]) / (B - hits[N - 1])) : 0;
        sq += 0.035 * tense;                                             // se tensa antes de romperse
        rot += tense * 1.4 * (noise(t * 40) - 0.5);                      // y vibra
        egg.style.transform = 'rotate(' + rot.toFixed(2) + 'deg) scale(' + (1 + sq * 0.6).toFixed(4) + ',' + (1 - sq).toFixed(4) + ')';
        var leak = hits.length >= 2 ? clamp01((t - hits[1]) / 0.3) * 0.6 + (hits.length >= 3 ? 0.4 * clamp01((t - hits[2]) / 0.2) : 0) : 0;
        for (var k = 0; k < 2; k++) {
          crackLines[k].setAttribute('stroke-dashoffset', (1 - p).toFixed(3));
          crackLights[k].setAttribute('stroke-dashoffset', (1 - p).toFixed(3));
          crackLights[k].style.opacity = leak.toFixed(3);
        }
        // La cáscara se va transparentando: algo luminoso crece dentro
        var glowIn = (hits.length / N) * 0.55 + tense * 0.45;
        inner.style.opacity = (glowIn * (0.92 + 0.08 * noise(t * 9))).toFixed(3);
        return;
      }
      // Rotura (física simple: lanzamiento, gravedad y giro; la mitad de arriba da vueltas en 3D)
      var lt = t - B;
      if (crackSvg.style.opacity !== '0') { crackSvg.style.opacity = '0'; inner.style.opacity = '0'; egg.style.transform = 'none'; }
      var tx = -95 * lt, ty = -620 * lt + 0.5 * 1700 * lt * lt;
      var tumble = 0.3 + 0.7 * Math.abs(Math.cos(lt * 6.5));
      halfTop.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) rotate(' + (-150 * lt).toFixed(1) + 'deg) scale(1,' + tumble.toFixed(3) + ')';
      halfTop.style.opacity = (1 - clamp01((lt - 0.22) / 0.32)).toFixed(3);
      var wob = 12 * Math.exp(-lt * 4) * Math.sin(lt * 14);
      halfBottom.style.transform = 'translate(' + (18 * lt).toFixed(1) + 'px,' + (34 * easeOutCubic(clamp01(lt / 0.45))).toFixed(1) + 'px) rotate(' + wob.toFixed(2) + 'deg)';
      halfBottom.style.opacity = (1 - clamp01((lt - 0.14) / 0.34)).toFixed(3);
      eggShadow.style.opacity = (1 - clamp01(lt / 0.35)).toFixed(3);
      var go = lt < 0.05 ? lt / 0.05 : Math.exp(-(lt - 0.05) * 2.6);
      glow.style.opacity = go.toFixed(3);
      glow.style.transform = 'translate(-50%,-50%) scale(' + (0.3 + 2.4 * easeOutCubic(clamp01(lt / 0.7))).toFixed(3) + ')';
      var lr = clamp01(lt / 1.1);
      ring.style.transform = 'scale(' + (easeOutCubic(lr) * minSide / 200 * 1.25).toFixed(3) + ')';
      ring.style.opacity = (lr > 0 && lr < 1 ? Math.pow(1 - lr, 1.5) : 0).toFixed(3);
    }

    /* ---- Luz del Big Bang ---- */
    // Intensidad de la luz: estalla al romperse y se va apagando poco a poco hasta el acomodo.
    function lightLevel(t) {
      var lt = t - TL.hatch;
      if (lt < 0) return 0;
      var burst = lt < 0.07 ? lt / 0.07 : 0.3 + 0.7 * Math.exp(-(lt - 0.07) * 2.4);
      var flicker = 0.96 + 0.08 * noise(lt * 7);
      return clamp01(burst * flicker * (1 - easeInOutSine(clamp01((t - TL.hatch) / (TL.fade - TL.hatch)))));
    }

    // Destello: un fogonazo breve en el centro. Núcleo de luz que se abre y se apaga,
    // y una estrella de rayos finos (horizontal larga, vertical y diagonales) que
    // crece de golpe, gira apenas y se encoge hasta desaparecer. No queda nada fijo.
    function spike(g, ang, len, thick, a, W2) {
      if (a < 0.004 || len < 1) return;
      g.save(); g.translate(cx, cy); g.rotate(ang); g.scale(len, thick);
      var gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      gr.addColorStop(0, 'rgba(255,255,252,' + a.toFixed(3) + ')');
      gr.addColorStop(0.1, rgba(W2, a)); gr.addColorStop(0.4, rgba(W2, 0.4 * a)); gr.addColorStop(1, rgba(W2, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    function drawFlash(g, lt) {
      var F = CONFIG.flash, life = F.life;
      if (lt > life) return;
      var B = CONFIG.colors.bloom, TAU = Math.PI * 2;
      var grow = easeOutCubic(clamp01(lt / 0.07));
      var decay = Math.exp(-lt * 4.2 / life) * (1 - clamp01((lt - life * 0.7) / (life * 0.3)));
      var flick = 0.92 + 0.16 * noise(lt * 24);
      var a = grow * decay * flick;
      // Núcleo: se abre rápido y se desvanece
      var R = minSide * (0.04 + F.size * 0.75 * easeOutCubic(clamp01(lt / 0.3)));
      var core = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      core.addColorStop(0, 'rgba(255,255,252,' + a.toFixed(3) + ')'); core.addColorStop(0.08, 'rgba(255,250,232,' + (0.95 * a).toFixed(3) + ')');
      core.addColorStop(0.22, rgba(B, 0.9 * a)); core.addColorStop(0.55, rgba(B, 0.35 * a)); core.addColorStop(1, rgba(B, 0));
      g.fillStyle = core; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
      // Estrella de rayos
      var L = minSide * F.size * grow * (0.45 + 0.55 * decay), rot = F.rotate * lt, th = 2 + 7 * decay;
      spike(g, rot, L, th, a, B);
      spike(g, rot + TAU / 4, L * 0.55, th * 0.9, a * 0.9, B);
      spike(g, rot + TAU / 8, L * 0.26, th * 0.6, a * 0.6, B);
      spike(g, rot - TAU / 8, L * 0.26, th * 0.6, a * 0.6, B);
      for (var i = 0; i < rays.length; i++) {
        var ry = rays[i], tw = 0.6 + 0.4 * noise(ry.ph + lt * 9);
        spike(g, ry.a + rot * 0.5, L * ry.l, th * ry.th, a * 0.55 * tw, B);
      }
      // Chispas: vuelo frenado por el aire, estela corta en la dirección del movimiento
      var dk = 3.4, ex = (1 - Math.exp(-dk * lt)) / dk;
      g.lineCap = 'round';
      for (var j = 0; j < sparks.length; j++) {
        var S = sparks[j], sl = clamp01(1 - lt / S.life);
        if (sl <= 0) continue;
        var px = cx + S.vx * ex, py = cy + S.vy * ex, sp = Math.exp(-dk * lt), k2 = 0.035 * sp + 0.004;
        g.strokeStyle = 'rgba(255,248,226,' + (0.95 * sl).toFixed(3) + ')';
        g.lineWidth = S.w;
        g.beginPath(); g.moveTo(px - S.vx * k2, py - S.vy * k2); g.lineTo(px, py); g.stroke();
        g.strokeStyle = rgba(B, 0.45 * sl);
        g.lineWidth = S.w * 3.2;
        g.beginPath(); g.moveTo(px - S.vx * k2 * 0.6, py - S.vy * k2 * 0.6); g.lineTo(px, py); g.stroke();
      }
    }

    /* ---- Render de un fotograma ---- */
    function render(t, dt) {
      var g = ctx2d;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.clearRect(0, 0, W, H);
      renderEgg(t);

      // Fundido final del fondo blanco: la web real aparece debajo.
      var bgO = 1 - easeInOutSine(clamp01((t - TL.fade + 0.6) / 0.6));
      bg.style.opacity = bgO.toFixed(3);
      canvas.style.opacity = bgO.toFixed(3);

      // Luz: la penumbra previa desaparece en el estallido y la luz se va apagando poco a poco
      var Lv = lightLevel(t);
      light.style.opacity = Lv.toFixed(3);
      light.style.transform = 'scale(' + (0.6 + 0.6 * easeOutCubic(clamp01((t - TL.hatch) / 0.5))).toFixed(3) + ')';
      dim.style.opacity = (1 - clamp01((t - TL.hatch) / 0.12)).toFixed(3);

      var lt = t - TL.hatch;
      var LC = CONFIG.colors.light;
      if (lt > 0) {
        if (!collected) collect();
        if (!launched) { launch(); hatchBurst(); }

        // Física con subpasos (estable aunque el navegador vaya a tirones)
        var steps = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / steps;
        for (var st = 0; st < steps; st++) for (var p = 0; p < clones.length; p++) physics(clones[p], t - dt + h * (st + 1), h);

        // Motas de polvo flotando en la luz (deriva orgánica con ruido)
        for (var m = 0; m < motes.length; m++) {
          var M = motes[m];
          M.vx += (noise(M.seed + t * 0.8) - 0.5) * 60 * dt; M.vy += (noise(M.seed + 50 + t * 0.8) - 0.5) * 60 * dt - 6 * dt;
          M.vx *= 1 - 0.8 * dt; M.vy *= 1 - 0.8 * dt;
          M.x += M.vx * dt; M.y += M.vy * dt;
          var ma = Lv * M.br * (0.45 + 0.55 * noise(M.seed + t * 3));
          if (ma < 0.01) continue;
          g.fillStyle = rgba(LC, ma * 0.85);
          g.beginPath(); g.arc(M.x, M.y, M.size, 0, Math.PI * 2); g.fill();
        }

        // Estelas de luz, como en una foto de larga exposición (más intensas cuanto más luz y velocidad)
        g.lineCap = 'round';
        for (var q = 0; q < clones.length; q++) {
          var C = clones[q];
          if (lt < C.rel) continue;
          C.trail.push(C.x, C.y);
          if (C.trail.length > 24) C.trail.splice(0, 2);
          var speed = Math.sqrt(C.vx * C.vx + C.vy * C.vy), ta = Lv * clamp01(speed / 700);
          if (ta < 0.02 || C.trail.length < 4) continue;
          var n2 = C.trail.length / 2;
          for (var s2 = 1; s2 < n2; s2++) {
            var f = s2 / n2;
            g.strokeStyle = rgba(LC, 0.42 * ta * f * f);
            g.lineWidth = iconSize * 0.3 * f;
            g.beginPath(); g.moveTo(C.trail[s2 * 2 - 2], C.trail[s2 * 2 - 1]); g.lineTo(C.trail[s2 * 2], C.trail[s2 * 2 + 1]); g.stroke();
          }
        }

        drawFlash(g, lt);

        // Fragmentos de cáscara: resistencia del aire, gravedad y volteo (cambia la luz de la cara)
        for (var z = 0; z < shards.length; z++) {
          var S = shards[z], sa = clamp01(1 - lt / S.life);
          if (sa <= 0) continue;
          var kd = 2.2, gr = 1600, e = 1 - Math.exp(-kd * lt);
          var x = S.x + S.vx / kd * e, y = S.y + (S.vy + gr / kd) / kd * e - gr / kd * lt;
          var flip = Math.cos(S.ph + S.flip * lt);
          g.save(); g.translate(x, y); g.rotate(S.r + S.vr * lt); g.scale(1, Math.max(0.12, Math.abs(flip)));
          g.globalAlpha = sa;
          g.beginPath(); g.moveTo(S.pts[0], S.pts[1]);
          for (var pp = 2; pp < S.pts.length; pp += 2) g.lineTo(S.pts[pp], S.pts[pp + 1]);
          g.closePath();
          g.fillStyle = flip > 0 ? rgba(CONFIG.colors.shell, 1) : rgba(CONFIG.colors.shellShade, 1);
          g.fill();
          g.restore();
        }
      }

      // Apps: aplica el estado físico al DOM
      var allLanded = true;
      for (var k = 0; k < clones.length; k++) {
        var c = clones[k];
        if (!c.done) allLanded = false;
        if (lt < c.rel) continue;
        var landT = clamp01((t - c.tLand) / 0.6);                    // progreso del aterrizaje (para color y etiqueta)
        var X = c.x, Y = c.y - c.dy * c.s;                           // el icono (no la etiqueta) sigue la física
        c.el.style.transform = 'translate3d(' + (X - c.fx).toFixed(2) + 'px,' + (Y - c.fy).toFixed(2) + 'px,0) scale(' + c.s.toFixed(4) + ') rotate(' + c.rot.toFixed(2) + 'deg)';
        c.el.style.opacity = c.done ? '1' : clamp01((lt - c.rel) / 0.12).toFixed(3);
        // Color: nacen blancas por la luz y van ganando color poco a poco
        var col = c.done ? 1 : Math.max(easeInOutSine(clamp01((lt - 0.1) / (TL.fade + 0.3 - TL.hatch))), easeOutCubic(landT));
        if (col >= 0.999 && c.done) { if (c.el.style.filter) c.el.style.filter = ''; }
        else {
          var hot = 1 - col, f2 = 'grayscale(' + (0.75 * hot).toFixed(3) + ') sepia(' + (0.3 * hot).toFixed(3) + ') brightness(' + (1 + 0.8 * hot).toFixed(3) + ') contrast(' + (1 - 0.25 * hot).toFixed(3) + ')';
          c.el.style.filter = f2;
        }
        if (c.label) c.label.style.opacity = c.done ? '1' : clamp01((t - c.tLand - 0.25) / 0.35).toFixed(3);
      }

      if (!landingSet && t > TL.fade - 0.4) { landingSet = true; el.classList.add('is-landing'); }
      return allLanded || (collected && !clones.length && t > TL.fade);
    }

    function frame(now) {
      if (!alive) return;
      var t = Math.max(0, (now - startAt) / 1000);
      var dt = clamp(t - lastT, 0, 1 / 30); lastT = t;
      var landed;
      try { landed = render(t, dt); }
      catch (e) { console.warn('[intro] error de animación:', e); finish(true); return; }
      if (t >= TL.end && landed) { finish(false); return; }
      raf = requestAnimationFrame(frame);
    }

    /* ---- Audio ---- */
    // El audio (y sus reverbs, caras de preparar) se crea en un momento libre de la pantalla
    // previa; al primer golpe solo se arranca, así no hay tirón.
    function prepareAudio() {
      if (audio || started || !alive) return;
      try {
        if (!window.introAudio || !window.introAudio.supported) return;
        audio = window.introAudio.create({ volume: CONFIG.volume });
      } catch (e) { console.warn('[intro] audio no disponible:', e); audio = null; }
    }
    function startAudio() {
      if (!audio) prepareAudio();
      try { if (audio) audio.start(muted); }
      catch (e) { console.warn('[intro] audio no disponible:', e); audio = null; }
    }
    function sound(fn) { if (audio) { try { fn(audio); } catch (e) { console.warn('[intro] audio:', e); } } }

    /* ---- Ciclo de vida ---- */
    // Cada golpe al huevo (clic/toque en el huevo o en el botón).
    function hit() {
      if (!alive || hits.length >= CONFIG.hits) return;
      var now = performance.now();
      if (!started) {
        // Primer golpe: arranca el reloj, el audio (necesita este gesto) y el bucle de animación.
        started = true;
        sSet('sessionStorage', CONFIG.storageKey, '1');
        egg.classList.remove('is-idle');
        startAudio();
        if (reduced) { reducedEnd(); return; }
        startAt = now + 50;               // el audio arranca 50 ms después (audio.start)
        lastT = 0;
        raf = requestAnimationFrame(frame);
      }
      var t = Math.max(0, (now - startAt) / 1000);
      if (hits.length && t - hits[hits.length - 1] < 0.12) return; // ignora dobles toques
      hits.push(t);
      var n = hits.length;
      if (dots[n - 1]) dots[n - 1].classList.add('on');
      // Chasquido cada vez más fuerte: la cáscara se va rompiendo
      sound(function (a) { a.crack(Math.max(0, a.now()) + 0.005, 0.6 + 0.4 * (n - 1)); });
      if (n >= CONFIG.hits) scheduleHatch(t);
    }

    // Tras el último golpe se fija la línea de tiempo y se programa todo el sonido restante.
    function scheduleHatch(tLast) {
      var T = CONFIG.timeline, k = 1 / CONFIG.speed;
      TL.hatch = tLast + T.hatchDelay * k;
      TL.air = TL.hatch + T.air * k;
      TL.fade = TL.hatch + T.fade * k;
      TL.end = TL.hatch + T.end * k;
      egg.style.rotate = '';
      el.removeEventListener('pointermove', onLean);
      if (gate) gate.classList.add('is-gone');
      sound(function (a) {
        a.bang(TL.hatch);
        a.orbitAir(TL.air, 1.1);
      });
      safety = setTimeout(function () { finish(true); }, (TL.end - tLast + 5) * 1000);
    }

    // Movimiento reducido: un solo toque; todo se funde y suena solo el kick de la rotura.
    function reducedEnd() {
      if (gate) gate.classList.add('is-gone');
      sound(function (a) { a.bang(0.05); });
      root.classList.remove('cine-hide');
      [bg, canvas, egg].forEach(function (n) { n.style.transition = 'opacity .8s ease'; });
      requestAnimationFrame(function () { bg.style.opacity = canvas.style.opacity = egg.style.opacity = '0'; });
      el.classList.add('is-landing');
      safety = setTimeout(function () { finish(false); }, 900);
    }

    function finish(skipped) {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf); clearTimeout(safety);
      sSet('sessionStorage', CONFIG.storageKey, '1');
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey, true);
      if (audio) {
        if (skipped) audio.fadeOut(0.3);
        else { var a = audio; setTimeout(function () { a.fadeOut(1.4); }, 3800); } // deja sonar la cola de la reverb del kick
      }
      // Intercambio clon -> original en el mismo fotograma, sin transiciones.
      root.classList.add('cine-swap');
      root.classList.remove('cine-hide', 'cine-on');
      requestAnimationFrame(function () {
        el.classList.add('is-leaving');
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
          root.classList.remove('cine-swap');
          window.__cineIntro = false;
          current = null;
          decorateReplay();
          try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch (e) {}
        }, 360);
      });
    }

    function onResize() { measure(); }
    // En la pantalla previa el huevo se inclina levemente hacia el cursor.
    function onLean(e) {
      if (reduced) return;
      var dx = (e.clientX - cx) / (W / 2), dy = (e.clientY - cy) / (H / 2);
      egg.style.rotate = clamp(dx * 9 * (1 - Math.min(1, Math.abs(dy)) * 0.4), -9, 9).toFixed(2) + 'deg';
    }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); finish(true); } }

    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey, true);
    skipBtn.addEventListener('click', function () { finish(true); });
    muteBtn.addEventListener('click', function () {
      muted = !muted;
      sSet('localStorage', CONFIG.muteKey, muted ? '1' : '0');
      paintMute();
      if (audio) audio.setMuted(muted);
    });

    // Golpes: tocar el huevo (pointerdown, respuesta inmediata también en móvil) o el botón
    // (clic / Enter / espacio, para teclado y lectores de pantalla).
    egg.addEventListener('pointerdown', function (e) { if (e.button === 0 || e.pointerType !== 'mouse') hit(); });
    enterBtn.addEventListener('click', hit);
    egg.classList.add('is-idle');
    el.addEventListener('pointermove', onLean);
    // En un momento libre: preparar el audio y crear los clones (ocultos), así la rotura no da tirones.
    function prepare() {
      prepareAudio();
      if (!alive || reduced || collected || started) return;
      try { collect(); if (!clones.length) collected = false; }            // la web aún no ha montado: se reintenta al romper
      catch (e) { collected = false; }
    }
    if (window.requestIdleCallback) requestIdleCallback(prepare, { timeout: 1500 });
    else setTimeout(prepare, 400);
    try { enterBtn.focus({ preventScroll: true }); } catch (e) {}

    return { finish: finish };
  }

  /* ---------------------------------------------------------------------------
     Reproducir de nuevo
     ------------------------------------------------------------------------- */
  function replay() {
    if (current) return;
    try {
      root.classList.add('cine-hide');
      window.__cineIntro = true;
      current = createIntro();
    } catch (e) { console.warn('[intro] no se pudo repetir:', e); cleanupRoot(); current = null; }
  }

  // El punto negro de la barra de menú ([data-intro-replay]) repite la intro.
  function decorateReplay() {
    document.querySelectorAll('[data-intro-replay]').forEach(function (d) {
      if (d.__cineReady) return;
      d.__cineReady = true;
      d.setAttribute('role', 'button');
      d.setAttribute('tabindex', '0');
      d.setAttribute('aria-label', L.replay);
      d.title = L.replay;
      d.style.cursor = 'pointer';
    });
  }

  function bindReplay() {
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-intro-replay]');
      if (t) replay();
    });
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      var typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
      if (e.altKey && e.code === 'KeyI' && !typing) { e.preventDefault(); replay(); return; }
      var d = e.target && e.target.closest && e.target.closest('[data-intro-replay]');
      if (d && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); replay(); }
    });
    // La web se monta después de DOMContentLoaded: se decora el punto cuando aparezca.
    var tries = 0;
    (function poll() {
      decorateReplay();
      if (!document.querySelector('[data-intro-replay]') && ++tries < 40) setTimeout(poll, 250);
    })();
  }

  window.cineIntro = { replay: replay, config: CONFIG };
})();
