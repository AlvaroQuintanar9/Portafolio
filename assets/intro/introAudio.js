/* ==========================================================================
   introAudio.js — banda sonora de la intro, 100 % sintetizada con Web Audio API
   --------------------------------------------------------------------------
   No hay archivos de audio: cada sonido se genera con osciladores, ruido y
   filtros. Expone window.introAudio con:

     introAudio.create({ volume, muted })  -> instancia (o null si no hay audio)
       .chargeHum(at, dur)    zumbido grave de carga que sube de tono
       .crack(at, strength)   chasquido seco de cáscara agrietándose
       .bang(at)              kick grave de fondo con reverb larga (explosión)
       .orbitAir(at, dur)     soplo de aire suave mientras vuelan
       .setMuted(bool)        silencia / activa con rampa (sin clics)
       .fadeOut(sec)          baja el master y cierra el contexto
       .now()                 tiempo actual del AudioContext (segundos)

   `at` es relativo al inicio (segundos desde que se llamó a start()).
   ========================================================================== */
(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;

  function create(opts) {
    opts = opts || {};
    if (!AC) return null;
    var ctx;
    try { ctx = new AC(); } catch (e) { return null; }

    var volume = opts.volume == null ? 0.35 : opts.volume;
    var t0 = 0;           // instante (ctx.currentTime) que corresponde a at = 0
    var nodes = [];       // fuentes vivas, para poder pararlas al saltar

    // ---- Cadena master: buses -> compresor suave -> master gain -> salida ----
    var master = ctx.createGain();
    master.gain.value = 0;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 3.5;
    comp.attack.value = 0.004; comp.release.value = 0.3;
    comp.connect(master); master.connect(ctx.destination);

    var dry = ctx.createGain(); dry.gain.value = 1; dry.connect(comp);

    // Reverb procedural: respuesta al impulso de ruido estéreo con caída exponencial.
    var verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 3.4, 2.6);
    var verbIn = ctx.createGain(); verbIn.gain.value = 1;
    var verbOut = ctx.createGain(); verbOut.gain.value = 0.55;
    verbIn.connect(verb); verb.connect(verbOut); verbOut.connect(comp);

    // Reverb larga y oscura solo para el kick de la rotura (cola de explosión lejana).
    var boom = ctx.createConvolver();
    boom.buffer = impulse(ctx, 5.5, 3.2);
    var boomIn = ctx.createGain(); boomIn.gain.value = 1;
    var boomTone = ctx.createBiquadFilter(); boomTone.type = 'lowpass'; boomTone.frequency.value = 900;
    var boomOut = ctx.createGain(); boomOut.gain.value = 1.1;
    boomIn.connect(boom); boom.connect(boomTone); boomTone.connect(boomOut); boomOut.connect(comp);

    // Delay con feedback para el shimmer del arpegio.
    var delay = ctx.createDelay(1.5); delay.delayTime.value = 0.28;
    var fb = ctx.createGain(); fb.gain.value = 0.38;
    var dTone = ctx.createBiquadFilter(); dTone.type = 'lowpass'; dTone.frequency.value = 4200;
    var dOut = ctx.createGain(); dOut.gain.value = 0.5;
    delay.connect(dTone); dTone.connect(fb); fb.connect(delay);
    dTone.connect(dOut); dOut.connect(verbIn); dOut.connect(dry);

    function T(at) { return t0 + at; }
    function track(src, stopAt) { nodes.push(src); src.stop(stopAt); src.onended = function () { var i = nodes.indexOf(src); if (i >= 0) nodes.splice(i, 1); }; return src; }

    function osc(type, freq) { var o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; return o; }
    function gain(v) { var g = ctx.createGain(); g.gain.value = v == null ? 0 : v; return g; }
    function noise(dur) {
      var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var s = ctx.createBufferSource(); s.buffer = b; return s;
    }
    // Ruido rosa (más suave y "aireado" que el blanco); filtro de Paul Kellet.
    function pinkNoise(dur) {
      var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
      var s = ctx.createBufferSource(); s.buffer = b; return s;
    }

    // Curva aleatoria suave (paseo aleatorio filtrado) entre lo y hi: hace que el
    // viento nunca se repita igual. `smooth` 0..1, más alto = cambios más lentos.
    function drift(n, lo, hi, smooth) {
      var c = new Float32Array(n), v = Math.random(), tgt = Math.random(), a = 1 - smooth;
      for (var i = 0; i < n; i++) {
        if (Math.random() < 0.18) tgt = Math.random();
        v += (tgt - v) * a;
        c[i] = lo + (hi - lo) * v;
      }
      return c;
    }
    // Envía un nodo por un paneo estéreo que deambula; devuelve el nodo de salida.
    function panned(node, s, len, width) {
      if (!ctx.createStereoPanner) return node;
      var p = ctx.createStereoPanner();
      p.pan.setValueCurveAtTime(drift(48, -width, width, 0.3), s, len);
      node.connect(p); return p;
    }
    var api = {
      ctx: ctx,

      /** Arranca el reloj de audio. Llamar dentro del gesto del usuario (clic). */
      start: function (muted) {
        if (ctx.state === 'suspended') ctx.resume();
        t0 = ctx.currentTime + 0.05;
        master.gain.setValueAtTime(0, ctx.currentTime);
        master.gain.linearRampToValueAtTime(muted ? 0 : volume, t0 + 0.08);
        return t0;
      },

      now: function () { return ctx.currentTime - t0; },

      /** 1 · Zumbido de carga: drone grave filtrado que sube de tono y de brillo. */
      chargeHum: function (at, dur) {
        var s = T(at), e = s + dur;
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
        lp.frequency.setValueAtTime(110, s);
        lp.frequency.exponentialRampToValueAtTime(1400, e);
        var g = gain(0);
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.16, e - 0.05);
        g.gain.linearRampToValueAtTime(0.0001, e + 0.06); // corte limpio justo en el bang
        lp.connect(g); g.connect(dry);
        [['sawtooth', 1, 0.5], ['sine', 2, 0.6], ['sawtooth', 1.005, 0.35]].forEach(function (p) {
          var o = osc(p[0], 42 * p[1]), og = gain(p[2]);
          o.frequency.setValueAtTime(42 * p[1], s);
          o.frequency.exponentialRampToValueAtTime(118 * p[1], e);
          o.connect(og); og.connect(lp);
          o.start(s); track(o, e + 0.1);
        });
      },

      /** Chasquido de cáscara: varios micro-clics de ruido filtrado muy seguidos. */
      crack: function (at, strength) {
        var s = T(at), k = strength == null ? 1 : strength;
        var taps = 3 + Math.round(k * 3);
        for (var i = 0; i < taps; i++) {
          var t = s + i * (0.008 + Math.random() * 0.014);
          var n = noise(0.05), hp = ctx.createBiquadFilter(), bp = ctx.createBiquadFilter(), g = gain(0);
          hp.type = 'highpass'; hp.frequency.value = 1800;
          bp.type = 'peaking'; bp.frequency.value = 3200 + Math.random() * 2400; bp.gain.value = 8; bp.Q.value = 2;
          var amp = (0.22 + Math.random() * 0.2) * k * (i === 0 ? 1.4 : 1);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(amp, t + 0.002);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.03);
          n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(dry); g.connect(verbIn);
          n.start(t); track(n, t + 0.07);
        }
        // Golpe sordo debajo (el cuerpo del huevo)
        var o = osc('sine', 210), og = gain(0);
        o.frequency.setValueAtTime(210, s); o.frequency.exponentialRampToValueAtTime(120, s + 0.08);
        og.gain.setValueAtTime(0.0001, s);
        og.gain.exponentialRampToValueAtTime(0.12 * k, s + 0.004);
        og.gain.exponentialRampToValueAtTime(0.0001, s + 0.1);
        o.connect(og); og.connect(dry); o.start(s); track(o, s + 0.12);
      },

      /** 2 · Rotura: un kick grave pequeño, de fondo, con una reverb muy larga
          (sala enorme) para que suene a explosión lejana. */
      bang: function (at) {
        var s = T(at);
        // Kick: seno con caída de tono rápida + un clic suave de ataque
        var b = osc('sine', 130), bg = gain(0);
        b.frequency.setValueAtTime(130, s);
        b.frequency.exponentialRampToValueAtTime(46, s + 0.12);
        b.frequency.exponentialRampToValueAtTime(38, s + 0.5);
        bg.gain.setValueAtTime(0.0001, s);
        bg.gain.exponentialRampToValueAtTime(0.32, s + 0.006);
        bg.gain.exponentialRampToValueAtTime(0.0001, s + 0.55);
        b.connect(bg); bg.connect(dry); bg.connect(boomIn);
        b.start(s); track(b, s + 0.6);
        var c = noise(0.03), cf = ctx.createBiquadFilter(), cg = gain(0);
        cf.type = 'lowpass'; cf.frequency.value = 1800;
        cg.gain.setValueAtTime(0.0001, s);
        cg.gain.exponentialRampToValueAtTime(0.06, s + 0.002);
        cg.gain.exponentialRampToValueAtTime(0.0001, s + 0.025);
        c.connect(cf); cf.connect(cg); cg.connect(dry); cg.connect(boomIn);
        c.start(s); track(c, s + 0.04);
      },

      /** 3 · Aire: soplo suave con ráfagas irregulares mientras las apps vuelan. */
      orbitAir: function (at, dur) {
        var s = T(at), e = s + dur, len = dur + 0.9;

        // Cuerpo del viento
        var n = pinkNoise(len), bp = ctx.createBiquadFilter(), env = gain(0), gst = gain(0);
        bp.type = 'bandpass'; bp.Q.value = 0.7;
        bp.frequency.setValueCurveAtTime(drift(64, 500, 2200, 0.25), s, len);
        env.gain.setValueAtTime(0.0001, s);
        env.gain.exponentialRampToValueAtTime(0.22, s + 0.25);
        env.gain.setValueAtTime(0.22, e - 0.2);
        env.gain.exponentialRampToValueAtTime(0.0001, e + 0.8);
        gst.gain.setValueCurveAtTime(drift(96, 0.35, 1, 0.35), s, len);   // ráfagas irregulares
        n.connect(bp); bp.connect(env); env.connect(gst);
        var out = panned(gst, s, len, 0.6);
        out.connect(dry); out.connect(verbIn);
        n.start(s); track(n, s + len);

      },

      setMuted: function (m) {
        var n = ctx.currentTime;
        master.gain.cancelScheduledValues(n);
        master.gain.setValueAtTime(master.gain.value, n);
        master.gain.linearRampToValueAtTime(m ? 0 : volume, n + 0.12);
      },

      /** Baja el master en `sec` segundos (sin clics) y libera el contexto. */
      fadeOut: function (sec) {
        sec = sec == null ? 0.4 : sec;
        var n = ctx.currentTime;
        try {
          master.gain.cancelScheduledValues(n);
          master.gain.setValueAtTime(master.gain.value, n);
          master.gain.linearRampToValueAtTime(0, n + sec);
        } catch (e) {}
        setTimeout(function () {
          nodes.slice().forEach(function (s) { try { s.stop(); } catch (e) {} });
          try { ctx.close(); } catch (e) {}
        }, sec * 1000 + 120);
      }
    };
    return api;
  }

  /** Impulso de reverb estéreo: ruido con envolvente exponencial (sala amplia). */
  function impulse(ctx, seconds, decay) {
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      // Caída exponencial por multiplicación (mucho más barata que Math.pow por muestra).
      var env = 1, k = Math.exp(-decay * 2.4 / len), tail = Math.floor(len * 0.9);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * env * (i > tail ? (len - i) / (len - tail) : 1);
        env *= k;
      }
    }
    return buf;
  }

  window.introAudio = { create: create, supported: !!AC };
})();
