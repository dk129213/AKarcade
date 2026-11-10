// AKarcade shared core: constants, sound, storage, high scores, drawing helpers, game registry.
// Every game script loads after this file and talks only to window.AK.
(() => {
  'use strict';

  const AK = (window.AK = window.AK || {});
  AK.W = 256;
  AK.H = 224;

  // ------------------------------------------------------------ storage
  AK.store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    },
  };

  // ------------------------------------------------------------ audio
  // One AudioContext for the whole arcade. `muted` is the user's sound switch,
  // `quiet` is set by the host while a cabinet is in attract mode (demos are silent).
  let ctx = null, master = null;
  const audio = (AK.audio = {
    muted: AK.store.get('akarcade.muted', false),
    quiet: false,
    /** Create/resume the AudioContext. Call from a user gesture. Returns the context or null. */
    ensure() {
      if (!ctx) {
        try {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          master = ctx.createGain();
          master.gain.value = audio.muted ? 0 : 0.24;
          master.connect(ctx.destination);
        } catch (e) { ctx = null; }
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    },
    ctx() { return ctx; },
    /** Master gain node that everything connects to (null before ensure()). */
    out() { return master; },
    /** Current audio clock in seconds (0 before the context exists). */
    now() { return ctx ? ctx.currentTime : 0; },
    setMuted(m) {
      audio.muted = !!m;
      AK.store.set('akarcade.muted', audio.muted);
      if (master) master.gain.value = audio.muted ? 0 : 0.24;
    },
    /**
     * Play a simple synth note.
     * @param freq   start frequency in Hz
     * @param dur    seconds
     * @param type   'square' | 'triangle' | 'sawtooth' | 'sine'
     * @param vol    0..1
     * @param slideTo optional end frequency (pitch slide)
     * @param delay  seconds from now
     */
    tone(freq, dur, type = 'square', vol = 0.3, slideTo = null, delay = 0) {
      if (!ctx || audio.muted || audio.quiet) return;
      const t = ctx.currentTime + Math.max(0, delay);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, freq), t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    /** White-noise burst (explosions, crumbles). */
    noise(dur, vol = 0.3, delay = 0) {
      if (!ctx || audio.muted || audio.quiet) return;
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource(), g = ctx.createGain();
      g.gain.value = vol;
      src.buffer = buf; src.connect(g); g.connect(master);
      src.start(ctx.currentTime + Math.max(0, delay));
    },
  });

  // ------------------------------------------------------------ high scores
  const SEED_NAMES = ['AKA', 'DAN', 'KEV', 'ZED', 'MAX', 'JOY', 'PIP', 'REX', 'IVY', 'BIT'];
  const seedTable = top => SEED_NAMES.map((name, i) => ({ name, score: Math.round(top * (1 - i * 0.09) / 10) * 10 }));
  const SEEDS = { glitchrun: 8000, rivetrush: 6000, starhopper: 12000 };
  const scoreListeners = [];
  AK.scores = {
    /** Top-10 list for a game: [{name, score}], best first. */
    get(id) {
      const saved = AK.store.get('akarcade.scores.' + id, null);
      if (Array.isArray(saved) && saved.length) return saved.slice(0, 10);
      return seedTable(SEEDS[id] || 5000);
    },
    top(id) { return AK.scores.get(id)[0].score; },
    qualifies(id, score) {
      if (!(score > 0)) return false;
      const list = AK.scores.get(id);
      return list.length < 10 || score > list[list.length - 1].score;
    },
    /** Insert a score; returns its 0-based rank, or -1 if it did not make the table. */
    add(id, name, score) {
      const list = AK.scores.get(id);
      const entry = { name: String(name || 'AAA').toUpperCase().slice(0, 3), score: Math.floor(score) };
      list.push(entry);
      list.sort((a, b) => b.score - a.score);
      const kept = list.slice(0, 10);
      AK.store.set('akarcade.scores.' + id, kept);
      scoreListeners.forEach(fn => { try { fn(id); } catch (e) { /* ignore */ } });
      return kept.indexOf(entry);
    },
    onChange(fn) { scoreListeners.push(fn); },
  };

  // ------------------------------------------------------------ drawing helpers
  AK.FONT = '"Press Start 2P", monospace';
  /** New 256x224 offscreen canvas with crisp pixels. */
  AK.makeCanvas = (w = AK.W, h = AK.H) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return c;
  };
  /** Pixel-font text with a 1px drop shadow. align: 'left' | 'center' | 'right'. */
  AK.text = (g, str, x, y, color = '#fff', align = 'left', size = 8) => {
    g.font = size + 'px ' + AK.FONT;
    g.textAlign = align; g.textBaseline = 'top';
    g.fillStyle = '#000'; g.fillText(str, x + 1, y + 1);
    g.fillStyle = color; g.fillText(str, x, y);
  };
  AK.pad = (n, len) => String(Math.max(0, Math.floor(n))).padStart(len, '0');

  // ------------------------------------------------------------ game registry
  /*
    A game registers an object with this contract:

      id      short id, e.g. 'glitchrun' (also the high-score key)
      title   display name in capitals, e.g. 'GLITCH RUN'
      tag     short genre label, e.g. 'MAZE CHASE'
      accent  CSS colour used for the cabinet's lighting and marquee
      canvas  a 256x224 canvas made with AK.makeCanvas(); the game draws only on this
      reset(mode)
              'attract': show the title screen and loop a self-playing demo. The host makes
                         audio silent and sends no input in this mode.
              'play':    a credit was inserted; start a new game right away.
      tick()  advance exactly one 1/60 s frame and redraw the canvas. The host calls this
              60 times per second while the game is on the active cabinet. Do not use
              requestAnimationFrame or timers for gameplay.
      input(name, down)
              name is one of: left right up down a b start select. Only sent in play mode.
      stop()  optional; called when the host leaves the game (stop music, clear timers).

    When a game ends (out of lives, or the player finished it), the game shows its own
    GAME OVER / YOU WIN screen for about two seconds and then calls AK.gameOver(id, score)
    exactly once. The host then runs initials entry and the high-score table.
  */
  AK.games = [];
  AK.register = game => { AK.games.push(game); if (AK.onRegister) AK.onRegister(game); };
  AK.gameOver = (id, score) => { if (AK.host && AK.host.gameOver) AK.host.gameOver(id, score); };
})();
