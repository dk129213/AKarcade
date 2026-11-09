// AKarcade cabinet controller: game-select menu, input routing, NES emulator
(() => {
  'use strict';

  const W = 256, H = 224, STEP = 1000 / 60;
  const GAMES = [
    { id: 'thwaite', title: 'THWAITE', tag: 'ARCADE SHOOTER', type: 'nes', rom: 'games/thwaite.nes' },
    { id: 'croom', title: 'CONCENTRATION ROOM', tag: 'PUZZLE', type: 'nes', rom: 'games/croom.nes' },
    { id: 'starhopper', title: 'STAR HOPPER', tag: 'PLATFORMER', type: 'starhopper' },
  ];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  const menuCanvas = document.getElementById('menu');
  const shCanvas = document.getElementById('game');
  const nesCanvas = document.getElementById('nes');
  const mctx = menuCanvas.getContext('2d');
  const nctx = nesCanvas.getContext('2d');
  const nowPlaying = document.getElementById('nowPlaying');

  let mode = 'menu';          // menu | starhopper | nes
  let selected = 0, menuFrame = 0, menuMsg = '', menuMsgTimer = 0, loading = false;
  let muted = store.get('akarcade.muted', false);

  // ------------------------------------------------------------ audio
  let ac = null, nesGain = null, proc = null;
  const RB = 16384;
  const rbL = new Float32Array(RB), rbR = new Float32Array(RB);
  let rw = 0, rr = 0;
  function ensureAudio() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        nesGain = ac.createGain();
        nesGain.gain.value = muted ? 0 : 0.9;
        nesGain.connect(ac.destination);
        proc = ac.createScriptProcessor(2048, 0, 2);
        proc.onaudioprocess = e => {
          const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
          for (let i = 0; i < L.length; i++) {
            if (rr !== rw) { L[i] = rbL[rr]; R[i] = rbR[rr]; rr = (rr + 1) % RB; }
            else { L[i] = 0; R[i] = 0; }
          }
        };
        proc.connect(nesGain);
      } catch (e) { ac = null; }
    }
    if (ac && ac.state === 'suspended') ac.resume();
  }
  function pushSample(l, r) {
    if (mode !== 'nes') return;
    const buffered = (rw - rr + RB) % RB;
    if (ac && buffered > ac.sampleRate * 0.12) return; // keep latency low
    const n = (rw + 1) % RB;
    if (n === rr) return;
    rbL[rw] = l; rbR[rw] = r; rw = n;
  }
  function blip(freq, dur = 0.06, vol = 0.15) {
    if (!ac || muted) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------ NES
  let nes = null, nesReady = false;
  const romCache = {};
  const nesImg = nctx.createImageData(256, 240);
  const nesBuf = new Uint32Array(nesImg.data.buffer);
  let nesFrameDirty = false;
  function getNES() {
    if (nes) return nes;
    ensureAudio();
    nes = new jsnes.NES({
      sampleRate: ac ? ac.sampleRate : 48000,
      emulateSound: !!ac,
      onAudioSample: pushSample,
      onFrame(fb) {
        // jsnes gives 0xRRGGBB, canvas wants little-endian 0xAABBGGRR
        for (let i = 0; i < 61440; i++) {
          const c = fb[i];
          nesBuf[i] = 0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff);
        }
        nesFrameDirty = true;
      },
    });
    return nes;
  }
  const NES_BTN = () => ({
    a: jsnes.Controller.BUTTON_A, b: jsnes.Controller.BUTTON_B,
    start: jsnes.Controller.BUTTON_START, select: jsnes.Controller.BUTTON_SELECT,
    up: jsnes.Controller.BUTTON_UP, down: jsnes.Controller.BUTTON_DOWN,
    left: jsnes.Controller.BUTTON_LEFT, right: jsnes.Controller.BUTTON_RIGHT,
  });

  async function loadRom(url) {
    if (romCache[url]) return romCache[url];
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    romCache[url] = new Uint8Array(await res.arrayBuffer());
    return romCache[url];
  }

  // ------------------------------------------------------------ modes
  function show(which) {
    menuCanvas.classList.toggle('active', which === 'menu');
    shCanvas.classList.toggle('active', which === 'starhopper');
    nesCanvas.classList.toggle('active', which === 'nes');
  }
  function setNowPlaying(t) { if (nowPlaying) nowPlaying.textContent = t; }

  async function launch(id) {
    const idx = GAMES.findIndex(g => g.id === id);
    if (idx < 0 || loading) return;
    selected = idx;
    const game = GAMES[idx];
    ensureAudio();
    stopCurrent();
    releaseAll();
    if (game.type === 'starhopper') {
      mode = 'starhopper'; show('starhopper');
      window.StarHopper.setMuted(muted);
      window.StarHopper.activate();
    } else {
      if (typeof jsnes === 'undefined') { flash('EMULATOR OFFLINE'); return; }
      loading = true; menuMsg = 'LOADING...'; menuMsgTimer = 9999;
      try {
        const rom = await loadRom(game.rom);
        const n = getNES();
        n.loadROM(rom);
        rw = rr = 0;
        nesReady = true;
        mode = 'nes'; show('nes');
        nctx.fillStyle = '#000'; nctx.fillRect(0, 0, W, H);
        menuMsg = ''; menuMsgTimer = 0;
      } catch (err) {
        console.error(err);
        flash('COULD NOT LOAD GAME');
      }
      loading = false;
    }
    setNowPlaying(game.title);
  }
  function stopCurrent() {
    if (mode === 'starhopper') window.StarHopper.deactivate();
    if (mode === 'nes') { nesReady = false; rw = rr = 0; }
  }
  function goMenu() {
    if (mode === 'menu') return;
    stopCurrent();
    releaseAll();
    mode = 'menu'; show('menu');
    setNowPlaying('GAME SELECT');
    blip(440);
  }
  function flash(msg) { menuMsg = msg; menuMsgTimer = 150; }

  // ------------------------------------------------------------ input
  // Each logical button can be held by several sources (keyboard, joystick, on-screen button).
  const BUTTONS = ['left', 'right', 'up', 'down', 'a', 'b', 'start', 'select'];
  const holders = {};
  BUTTONS.forEach(b => { holders[b] = new Set(); });
  const isDown = b => holders[b].size > 0;

  function press(name, src) {
    const was = isDown(name);
    holders[name].add(src);
    if (!was) emit(name, true);
  }
  function release(name, src) {
    if (!holders[name].has(src)) return;
    holders[name].delete(src);
    if (!isDown(name)) emit(name, false);
  }
  function releaseAll() {
    BUTTONS.forEach(b => {
      if (isDown(b)) {
        holders[b].clear();
        emit(b, false);
      }
    });
    if (window.StarHopper) window.StarHopper.releaseAll();
  }
  function emit(name, down) {
    updateCabinet();
    if (down) ensureAudio();
    if (mode === 'menu') { if (down) menuInput(name); return; }
    if (mode === 'starhopper') { window.StarHopper.input(name, down); return; }
    if (mode === 'nes' && nes && nesReady) {
      const btn = NES_BTN()[name];
      if (btn === undefined) return;
      if (down) nes.buttonDown(1, btn); else nes.buttonUp(1, btn);
    }
  }
  function menuInput(name) {
    if (loading) return;
    if (name === 'up') { selected = (selected + GAMES.length - 1) % GAMES.length; blip(660); }
    else if (name === 'down' || name === 'select') { selected = (selected + 1) % GAMES.length; blip(660); }
    else if (name === 'a' || name === 'start') { blip(880, 0.12); launch(GAMES[selected].id); }
  }

  // cabinet visuals
  const joyEl = document.getElementById('joystick');
  const btnEls = {
    a: document.getElementById('btnA'), b: document.getElementById('btnB'),
    start: document.getElementById('startBtn'), select: document.getElementById('selectBtn'),
  };
  function updateCabinet() {
    if (joyEl) {
      joyEl.style.setProperty('--jx', (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0));
      joyEl.style.setProperty('--jy', isDown('up') ? 1 : isDown('down') ? -1 : 0);
    }
    for (const k in btnEls) if (btnEls[k]) btnEls[k].classList.toggle('pressed', isDown(k));
  }

  // keyboard
  const KEYS = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    KeyZ: 'a', KeyK: 'a', Space: 'a',
    KeyX: 'b', KeyJ: 'b', ShiftLeft: 'b', ShiftRight: 'b',
    Enter: 'start', NumpadEnter: 'start', KeyP: 'start',
    KeyC: 'select', Backspace: 'select',
  };
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape') { e.preventDefault(); goMenu(); return; }
    if (e.code === 'KeyM') { toggleMute(); return; }
    const b = KEYS[e.code];
    if (!b) return;
    e.preventDefault();
    if (!e.repeat) press(b, 'kb:' + e.code);
  });
  window.addEventListener('keyup', e => {
    const b = KEYS[e.code];
    if (b) { e.preventDefault(); release(b, 'kb:' + e.code); }
  });
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  // on-cabinet buttons (mouse + touch)
  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ } };
  function holdButton(el, name) {
    if (!el) return;
    const src = 'el:' + name;
    el.addEventListener('pointerdown', e => { e.preventDefault(); capture(el, e); press(name, src); });
    el.addEventListener('pointerup', () => release(name, src));
    el.addEventListener('pointercancel', () => release(name, src));
    // keyboard activation of a focused button
    el.addEventListener('click', e => {
      if (e.detail !== 0) return; // real pointer clicks are handled above
      press(name, src); setTimeout(() => release(name, src), 120);
    });
  }
  Object.entries(btnEls).forEach(([k, el]) => holdButton(el, k));

  if (joyEl) {
    let joyId = null;
    const dirs = ['left', 'right', 'up', 'down'];
    const set = (n, on) => (on ? press(n, 'joy') : release(n, 'joy'));
    const joyMove = e => {
      const r = joyEl.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const th = r.width * 0.14;
      set('left', dx < -th); set('right', dx > th);
      set('up', dy < -th); set('down', dy > th);
    };
    joyEl.addEventListener('pointerdown', e => { e.preventDefault(); joyId = e.pointerId; capture(joyEl, e); joyMove(e); });
    joyEl.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
    const end = e => { if (e.pointerId === joyId) { joyId = null; dirs.forEach(d => release(d, 'joy')); } };
    joyEl.addEventListener('pointerup', end);
    joyEl.addEventListener('pointercancel', end);
  }

  const menuBtn = document.getElementById('menuBtn');
  menuBtn && menuBtn.addEventListener('click', goMenu);

  ['coinSlot', 'coinSlot2'].forEach(id => {
    const el = document.getElementById(id);
    el && el.addEventListener('click', () => {
      ensureAudio();
      blip(988, 0.07, 0.2); setTimeout(() => blip(1319, 0.2, 0.2), 70);
      press('start', 'coin'); setTimeout(() => release('start', 'coin'), 120);
    });
  });

  // click a game on the menu screen
  menuCanvas.addEventListener('pointerdown', e => {
    const r = menuCanvas.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height * H;
    GAMES.forEach((g, i) => {
      const iy = MENU_Y + i * MENU_GAP;
      if (y >= iy - 4 && y < iy + 14) {
        ensureAudio();
        if (selected === i) launch(g.id); else { selected = i; blip(660); }
      }
    });
  });

  // sound
  const soundBtn = document.getElementById('soundBtn');
  function toggleMute() {
    muted = !muted;
    store.set('akarcade.muted', muted);
    applyMute();
  }
  function applyMute() {
    if (nesGain) nesGain.gain.value = muted ? 0 : 0.9;
    if (window.StarHopper) window.StarHopper.setMuted(muted);
    if (soundBtn) {
      soundBtn.textContent = muted ? '♪ SOUND OFF' : '♪ SOUND ON';
      soundBtn.setAttribute('aria-pressed', String(muted));
    }
  }
  soundBtn && soundBtn.addEventListener('click', () => { ensureAudio(); toggleMute(); });
  applyMute();

  // ------------------------------------------------------------ menu drawing
  const MENU_Y = 124, MENU_GAP = 22;
  const FONT = '"Press Start 2P", monospace';
  const logo = new Image();
  logo.src = 'assets/akarcade-logo.png';
  const STARS = Array.from({ length: 50 }, (_, i) => ({ x: (i * 73) % W, y: (i * 37) % 120, s: i % 6 === 0 ? 2 : 1 }));

  function txt(s, x, y, col, align = 'left', size = 8) {
    mctx.font = size + 'px ' + FONT;
    mctx.textAlign = align; mctx.textBaseline = 'top';
    mctx.fillStyle = '#000'; mctx.fillText(s, x + 1, y + 1);
    mctx.fillStyle = col; mctx.fillText(s, x, y);
  }
  function drawMenu() {
    menuFrame++;
    const f = menuFrame;
    mctx.fillStyle = '#05010c'; mctx.fillRect(0, 0, W, H);
    // stars
    for (const s of STARS) {
      if ((f + s.x) % 140 < 6) continue;
      mctx.fillStyle = s.s > 1 ? '#fff6c8' : '#9a86d8';
      mctx.fillRect(s.x, s.y, s.s, s.s);
    }
    // neon floor grid
    const horizon = 150;
    mctx.strokeStyle = 'rgba(255, 62, 165, 0.45)'; mctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const t = ((i + (f % 40) / 40) / 8);
      const y = horizon + Math.pow(t, 2) * (H - horizon);
      mctx.beginPath(); mctx.moveTo(0, Math.round(y) + 0.5); mctx.lineTo(W, Math.round(y) + 0.5); mctx.stroke();
    }
    for (let i = -8; i <= 8; i++) {
      mctx.beginPath(); mctx.moveTo(W / 2 + i * 10, horizon); mctx.lineTo(W / 2 + i * 70, H); mctx.stroke();
    }
    // logo
    if (logo.complete && logo.naturalWidth) {
      mctx.imageSmoothingEnabled = true;
      mctx.drawImage(logo, W / 2 - 62, 4, 124, 101);
      mctx.imageSmoothingEnabled = false;
    }
    // list panel
    mctx.fillStyle = 'rgba(5, 1, 12, 0.85)';
    mctx.fillRect(14, MENU_Y - 14, W - 28, GAMES.length * MENU_GAP + 14);
    mctx.strokeStyle = '#2de2e6'; mctx.strokeRect(14.5, MENU_Y - 13.5, W - 29, GAMES.length * MENU_GAP + 13);
    GAMES.forEach((g, i) => {
      const y = MENU_Y + i * MENU_GAP - 6;
      const sel = i === selected;
      if (sel) {
        mctx.fillStyle = 'rgba(255, 62, 165, 0.28)';
        mctx.fillRect(18, y - 3, W - 36, 20);
        if ((f >> 4) % 2) txt('>', 24, y, '#ffd23f');
      }
      txt(g.title, 38, y, sel ? '#ffffff' : '#a99cc8');
      txt(g.tag, 38, y + 9, sel ? '#2de2e6' : '#5d5385', 'left', 5);
    });
    // footer
    if (menuMsgTimer > 0) {
      menuMsgTimer--;
      txt(menuMsg, W / 2, 202, '#ff5e7e', 'center');
    } else if ((f >> 5) % 2) {
      txt('PRESS START', W / 2, 202, '#ffd23f', 'center');
    } else {
      txt('UP/DOWN TO CHOOSE', W / 2, 202, '#d8c8ff', 'center');
    }
    txt('FREE PLAY', W - 8, 214, '#5d5385', 'right', 5);
    txt('CREDITS 99', 8, 214, '#5d5385', 'left', 5);
  }

  // ------------------------------------------------------------ main loop
  let last = performance.now(), acc = 0;
  function loop(now) {
    const dt = Math.min(100, now - last);
    last = now;
    if (mode === 'menu') {
      drawMenu();
    } else if (mode === 'nes' && nesReady) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 4) {
        try { nes.frame(); } catch (err) { console.error(err); nesReady = false; goMenu(); flash('GAME CRASHED'); break; }
        acc -= STEP; n++;
      }
      if (acc > STEP * 4) acc = 0;
      if (nesFrameDirty) { nctx.putImageData(nesImg, 0, -8); nesFrameDirty = false; }
    }
    if (mode !== 'nes') acc = 0;
    requestAnimationFrame(loop);
  }
  const begin = () => requestAnimationFrame(loop);
  if (document.fonts && document.fonts.load) document.fonts.load('8px "Press Start 2P"').then(begin, begin);
  else begin();

  show('menu');
  setNowPlaying('GAME SELECT');

  window.AKArcade = { launch, goMenu, games: GAMES };
})();
