// Concentration Room: a real NES game (© Damian Yerrick, GPL v3) running in the JSNES emulator,
// wrapped in the AKarcade game contract (see core.js).
(() => {
  'use strict';
  const AK = window.AK;
  const ROM_URL = 'games/croom.nes';

  const canvas = AK.makeCanvas();
  const g = canvas.getContext('2d');
  const img = g.createImageData(256, 240);
  const buf = new Uint32Array(img.data.buffer);

  let nes = null, nesRate = 0, rom = null, romPromise = null;
  let ready = false, error = '', mode = 'attract', frame = 0;

  // ---- audio: emulator samples -> ring buffer -> ScriptProcessor
  const RB = 16384, rbL = new Float32Array(RB), rbR = new Float32Array(RB);
  let rw = 0, rr = 0, proc = null;
  function hookAudio() {
    const ctx = AK.audio.ctx();
    if (!ctx || proc) return;
    try {
      const boost = ctx.createGain();
      boost.gain.value = 3;
      proc = ctx.createScriptProcessor(2048, 0, 2);
      proc.onaudioprocess = e => {
        const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
        for (let i = 0; i < L.length; i++) {
          if (rr !== rw) { L[i] = rbL[rr]; R[i] = rbR[rr]; rr = (rr + 1) % RB; }
          else { L[i] = 0; R[i] = 0; }
        }
      };
      proc.connect(boost); boost.connect(AK.audio.out());
    } catch (e) { proc = null; }
  }
  function pushSample(l, r) {
    if (mode !== 'play' || AK.audio.quiet || !proc) return;
    const buffered = (rw - rr + RB) % RB;
    if (buffered > nesRate * 0.12) return; // keep latency low
    const n = (rw + 1) % RB;
    if (n === rr) return;
    rbL[rw] = l; rbR[rw] = r; rw = n;
  }

  function makeNES() {
    const ctx = AK.audio.ctx();
    const rate = ctx ? ctx.sampleRate : 48000;
    if (nes && nesRate === rate) return;
    nesRate = rate;
    nes = new window.jsnes.NES({
      sampleRate: rate,
      onAudioSample: pushSample,
      onFrame(fb) {
        // jsnes gives 0xRRGGBB; canvas ImageData wants little-endian 0xAABBGGRR
        for (let i = 0; i < 61440; i++) {
          const c = fb[i];
          buf[i] = 0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff);
        }
      },
    });
  }
  function loadRom() {
    if (!romPromise) {
      romPromise = fetch(ROM_URL)
        .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.arrayBuffer(); })
        .then(ab => { rom = new Uint8Array(ab); });
    }
    return romPromise;
  }
  function boot() {
    try {
      makeNES();
      nes.loadROM(rom);
      rw = rr = 0; frame = 0;
      ready = true; error = '';
    } catch (e) { console.error(e); ready = false; error = 'GAME FAILED TO START'; }
  }

  const BTN = () => {
    const C = window.jsnes.Controller;
    return { a: C.BUTTON_A, b: C.BUTTON_B, start: C.BUTTON_START, select: C.BUTTON_SELECT,
      up: C.BUTTON_UP, down: C.BUTTON_DOWN, left: C.BUTTON_LEFT, right: C.BUTTON_RIGHT };
  };

  function reset(m) {
    mode = m;
    ready = false;
    if (!window.jsnes) { error = 'EMULATOR OFFLINE'; return; }
    if (m === 'play') hookAudio();
    if (rom) { boot(); return; }
    error = '';
    const wanted = m;
    loadRom().then(() => { if (mode === wanted) boot(); }, e => { console.error(e); romPromise = null; error = 'COULD NOT LOAD GAME'; });
  }

  function message(lines) {
    g.fillStyle = '#05010c'; g.fillRect(0, 0, 256, 224);
    AK.text(g, 'CONCENTRATION', 128, 70, '#b98cff', 'center', 16);
    AK.text(g, 'ROOM', 128, 92, '#b98cff', 'center', 16);
    lines.forEach((s, i) => AK.text(g, s, 128, 130 + i * 14, '#d8c8ff', 'center', 8));
  }

  function tick() {
    frame++;
    if (!ready) { message([error || 'LOADING...']); return; }
    try {
      // In attract mode, tap Start once to get past the legal notice to the title screen,
      // and restart the loop every so often.
      if (mode === 'attract') {
        const s = BTN().start;
        if (frame === 200) nes.buttonDown(1, s);
        if (frame === 206) nes.buttonUp(1, s);
        if (frame > 60 * 40) { boot(); return; }
      }
      nes.frame();
      g.putImageData(img, 0, -8);
    } catch (e) {
      console.error(e);
      ready = false; error = 'GAME CRASHED';
    }
  }

  function input(name, down) {
    if (!ready || mode !== 'play') return;
    const b = BTN()[name];
    if (b === undefined) return;
    if (down) nes.buttonDown(1, b); else nes.buttonUp(1, b);
  }

  AK.register({
    id: 'croom', title: 'CONCENTRATION ROOM', tag: 'NES PUZZLE', accent: '#b98cff',
    noScores: true,
    canvas, reset, tick, input,
    stop() { rw = rr = 0; },
  });
})();
