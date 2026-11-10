// AKarcade host: runs the active cabinet's game, routes input, and owns the coin -> full-screen flow,
// boot screen, attract cycle, initials entry and high-score tables. The 3D room (room.js) attaches itself.
(() => {
  'use strict';
  const AK = window.AK;
  const W = AK.W, H = AK.H, STEP = 1000 / 60;
  const ORDER = ['glitchrun', 'rivetrush', 'starhopper', 'croom'];
  const games = ORDER.map(id => AK.games.find(g => g.id === id)).filter(Boolean);
  AK.games.forEach(g => { if (!games.includes(g)) games.push(g); });

  const $ = id => document.getElementById(id);
  const screen = $('screen');
  const sctx = screen.getContext('2d');
  sctx.imageSmoothingEnabled = false;
  AK.screen = screen;
  const overlay = $('overlay');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let room = null;
  let cur = Math.min(games.length - 1, Math.max(0, AK.store.get('akarcade.cabinet', 0)));
  let mode = 'room';       // room | flyin | game | flyout
  let scr = 'attract';     // attract | scores | boot | play | entry | table
  let scrT = 0, frame = 0, wentFullscreen = false;
  const game = () => games[cur];

  // ------------------------------------------------------------ sounds
  const sfx = {
    coin() { AK.audio.tone(988, 0.07, 'square', 0.3); AK.audio.tone(1319, 0.3, 'square', 0.3, null, 0.07); },
    move() { AK.audio.tone(520, 0.05, 'square', 0.18); },
    tick() { AK.audio.tone(1400, 0.03, 'square', 0.12); },
    ok() { AK.audio.tone(660, 0.08, 'square', 0.22); AK.audio.tone(990, 0.14, 'square', 0.22, null, 0.08); },
    power() { AK.audio.tone(60, 0.5, 'sawtooth', 0.25, 900); AK.audio.noise(0.25, 0.12); },
    fanfare() { [523, 659, 784, 1047, 1319].forEach((f, i) => AK.audio.tone(f, 0.16, 'square', 0.25, null, i * 0.1)); },
  };

  // ------------------------------------------------------------ screens drawn by the host
  const logo = new Image();
  logo.src = 'assets/akarcade-logo.png';
  const T = (s, x, y, c, a, z) => AK.text(sctx, s, x, y, c, a, z);
  const BOOT_LEN = 150;

  function drawBoot(f) {
    const g = game();
    sctx.fillStyle = '#000'; sctx.fillRect(0, 0, W, H);
    if (f < 10) {                       // CRT line snaps on
      const w = (f / 10) * W;
      sctx.fillStyle = '#fff'; sctx.fillRect(W / 2 - w / 2, H / 2 - 1, w, 2);
      return;
    }
    if (f < 20) {                       // line opens to a white flash
      const h = ((f - 10) / 10) * H;
      sctx.fillStyle = '#e8f6ff'; sctx.fillRect(0, H / 2 - h / 2, W, h);
      return;
    }
    const flash = Math.max(0, 1 - (f - 20) / 14);
    sctx.fillStyle = '#05010c'; sctx.fillRect(0, 0, W, H);
    if (logo.complete && logo.naturalWidth) {
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(logo, W / 2 - 43, 8, 86, 70);
      sctx.imageSmoothingEnabled = false;
    }
    const lines = [
      [34, 'AKARCADE SYSTEM  V1.0', '#2de2e6'],
      [50, 'RAM CHECK ....... OK', '#d8c8ff'],
      [66, 'ROM CHECK ....... OK', '#d8c8ff'],
      [82, 'SOUND CHIP ...... OK', '#d8c8ff'],
      [98, 'LOADING ' + g.title, '#ffd23f'],
    ];
    lines.forEach(([at, s, c], i) => { if (f >= at) T(s, 20, 88 + i * 13, c, 'left', 8); });
    if (f >= 98) {
      const p = Math.min(1, (f - 98) / 40);
      sctx.strokeStyle = '#ff3ea5'; sctx.lineWidth = 1; sctx.strokeRect(20.5, 160.5, 215, 9);
      sctx.fillStyle = '#ff3ea5'; sctx.fillRect(22, 162, Math.round(212 * p), 6);
    }
    if (f >= 140) T('CREDIT 1', W / 2, 184, '#ffffff', 'center', 8);
    if (flash > 0) { sctx.fillStyle = 'rgba(232,246,255,' + flash.toFixed(2) + ')'; sctx.fillRect(0, 0, W, H); }
  }
  function bootSound(f) {
    if (f === 1) sfx.power();
    if (f === 34 || f === 50 || f === 66 || f === 82) sfx.tick();
    if (f === 140) sfx.ok();
  }

  let tableRank = -1;
  function drawTable(prompt) {
    const g = game();
    sctx.fillStyle = '#05010c'; sctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 4) { sctx.fillStyle = 'rgba(108,43,217,0.10)'; sctx.fillRect(0, y, W, 1); }
    T('HIGH SCORES', W / 2, 12, '#ffd23f', 'center', 16);
    T(g.title, W / 2, 34, g.accent, 'center', 8);
    const list = AK.scores.get(g.id);
    list.forEach((e, i) => {
      const y = 54 + i * 14;
      const hot = i === tableRank && (frame >> 3) % 2;
      const col = hot ? '#ffffff' : i === 0 ? '#ffd23f' : i < 3 ? '#2de2e6' : '#d8c8ff';
      T(String(i + 1).padStart(2, ' ') + '.', 48, y, col);
      T(e.name, 88, y, col);
      T(AK.pad(e.score, 6), 208, y, col, 'right');
    });
    if (prompt && (frame >> 5) % 2) T(prompt, W / 2, 204, '#ff3ea5', 'center', 8);
  }

  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ .';
  let entry = { score: 0, chars: [0, 0, 0], pos: 0 };
  function startEntry(score) {
    const last = String(AK.store.get('akarcade.initials', 'AAA')).padEnd(3, 'A');
    entry = { score, pos: 0, chars: [0, 1, 2].map(i => Math.max(0, LETTERS.indexOf(last[i]))) };
    setScr('entry');
    sfx.fanfare();
  }
  function drawEntry() {
    sctx.fillStyle = '#05010c'; sctx.fillRect(0, 0, W, H);
    T('NEW HIGH SCORE!', W / 2, 26, (frame >> 3) % 2 ? '#ffd23f' : '#ff3ea5', 'center', 16);
    T(AK.pad(entry.score, 6), W / 2, 56, '#ffffff', 'center', 16);
    T('ENTER YOUR INITIALS', W / 2, 88, '#2de2e6', 'center', 8);
    for (let i = 0; i < 3; i++) {
      const x = W / 2 - 44 + i * 44;
      const active = i === entry.pos;
      T(LETTERS[entry.chars[i]], x, 112, active ? '#ffffff' : '#a99cc8', 'center', 24);
      sctx.fillStyle = active ? '#ff3ea5' : '#3a2a66';
      sctx.fillRect(x - 14, 142, 28, 3);
      if (active && (frame >> 4) % 2) { T('▲', x, 100, '#ffd23f', 'center', 8); T('▼', x, 150, '#ffd23f', 'center', 8); }
    }
    T('UP/DOWN LETTER   A NEXT', W / 2, 180, '#d8c8ff', 'center', 8);
    T('START TO FINISH', W / 2, 196, '#d8c8ff', 'center', 8);
  }
  function commitEntry() {
    const name = entry.chars.map(i => LETTERS[i]).join('');
    AK.store.set('akarcade.initials', name);
    tableRank = AK.scores.add(game().id, name, entry.score);
    sfx.ok();
    setScr('table');
  }
  function entryInput(name) {
    const n = LETTERS.length;
    if (name === 'up') { entry.chars[entry.pos] = (entry.chars[entry.pos] + 1) % n; sfx.tick(); }
    else if (name === 'down') { entry.chars[entry.pos] = (entry.chars[entry.pos] + n - 1) % n; sfx.tick(); }
    else if (name === 'left' || name === 'b') { entry.pos = Math.max(0, entry.pos - 1); sfx.move(); }
    else if (name === 'right' || name === 'a') {
      if (entry.pos === 2 && name === 'a') commitEntry(); else { entry.pos = Math.min(2, entry.pos + 1); sfx.move(); }
    } else if (name === 'start') commitEntry();
  }

  // ------------------------------------------------------------ flow
  function setScr(s) { scr = s; scrT = 0; }
  function enterAttract() {
    AK.audio.quiet = true;
    tableRank = -1;
    game().reset('attract');
    setScr('attract');
  }
  function startPlay() {
    AK.audio.ensure();
    AK.audio.quiet = false;
    tableRank = -1;
    game().reset('play');
    setScr('play');
  }

  function focus(i, silent) {
    if (mode !== 'room' || !games.length) return;
    const n = games.length;
    const next = ((i % n) + n) % n;
    if (next !== cur) {
      if (game().stop) game().stop();
      cur = next;
      AK.store.set('akarcade.cabinet', cur);
      if (!silent) sfx.move();
    }
    enterAttract();
    if (room) room.focus(cur);
    updateRoomUI();
  }

  function tryFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || document.fullscreenElement) return;
    try {
      const p = req.call(el);
      if (p && p.then) p.then(() => { wentFullscreen = true; }, () => {});
    } catch (e) { /* not allowed here */ }
  }

  async function insertCoin() {
    if (mode === 'game') {
      if (scr === 'attract' || scr === 'scores' || scr === 'table') { sfx.coin(); startPlay(); }
      return;
    }
    if (mode !== 'room' || !games.length) return;
    AK.audio.ensure();
    AK.audio.quiet = false;
    mode = 'flyin';
    releaseAll();
    tryFullscreen();
    document.body.classList.add('playing');
    const roomEl = $('play');
    const bar = document.querySelector('.topbar');
    if (roomEl) window.scrollTo({ top: Math.max(0, roomEl.offsetTop - (bar ? bar.offsetHeight : 0)), behavior: 'auto' });
    sfx.coin();
    if (room) { try { await room.coin(); } catch (e) { /* ignore */ } }
    setScr('boot');
    if (room) { try { await room.flyIn(); } catch (e) { /* ignore */ } }
    overlay.classList.add('on');
    overlay.setAttribute('aria-hidden', 'false');
    mode = 'game';
    setTimeout(() => { if (mode === 'game' && room) room.pause(); }, 350);
  }

  async function exitGame() {
    if (mode !== 'game') return;
    releaseAll();
    if (game().stop) game().stop();
    enterAttract();
    mode = 'flyout';
    if (room) room.resume();
    overlay.classList.remove('on');
    overlay.setAttribute('aria-hidden', 'true');
    if (document.fullscreenElement && document.exitFullscreen) { try { document.exitFullscreen(); } catch (e) { /* ignore */ } }
    wentFullscreen = false;
    if (room) { try { await room.flyOut(); } catch (e) { /* ignore */ } }
    document.body.classList.remove('playing');
    mode = 'room';
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && wentFullscreen && mode === 'game') exitGame();
  });

  function gameOver(id, score) {
    if (id !== game().id || scr !== 'play') return;
    releaseAll();
    if (game().stop) game().stop();
    if (mode !== 'game') { enterAttract(); return; }
    if (!game().noScores && AK.scores.qualifies(id, score)) startEntry(score);
    else { tableRank = -1; setScr(game().noScores ? 'attract' : 'table'); if (game().noScores) enterAttract(); }
  }

  // one 60 Hz step of whatever is on the active cabinet's screen
  function step() {
    frame++; scrT++;
    const g = game();
    if (!g) return;
    switch (scr) {
      case 'boot':
        bootSound(scrT);
        if (scrT >= BOOT_LEN) startPlay();
        break;
      case 'play':
        g.tick();
        break;
      case 'attract':
        g.tick();
        if (!g.noScores && scrT > 60 * 24) setScr('scores');
        if (mode === 'game' && scrT > 60 * 90) exitGame();
        break;
      case 'scores':
        if (scrT > 60 * 7) { enterAttract(); }
        break;
      case 'table':
        if (scrT > 60 * 12) enterAttract();
        break;
      case 'entry':
        if (scrT > 60 * 60) commitEntry();
        break;
    }
  }
  function compose() {
    const g = game();
    if (!g) return;
    if (scr === 'boot') drawBoot(scrT);
    else if (scr === 'scores') drawTable(mode === 'game' ? 'PRESS START' : 'INSERT COIN');
    else if (scr === 'table') drawTable('PRESS START');
    else if (scr === 'entry') drawEntry();
    else sctx.drawImage(g.canvas, 0, 0);
  }

  // ------------------------------------------------------------ input
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
    BUTTONS.forEach(b => { if (isDown(b)) { holders[b].clear(); emit(b, false); } });
  }
  function emit(name, down) {
    showControls();
    if (mode === 'room') {
      if (!down) return;
      if (name === 'left') focus(cur - 1);
      else if (name === 'right') focus(cur + 1);
      else if (name === 'a' || name === 'start') insertCoin();
      return;
    }
    if (mode !== 'game') return;
    if (scr === 'play') { game().input(name, down); return; }
    if (!down) return;
    if (scr === 'entry') entryInput(name);
    else if (scr === 'attract' || scr === 'scores' || scr === 'table') {
      if (name === 'start' || name === 'a') { sfx.coin(); startPlay(); }
    }
  }
  function showControls() {
    if (room) room.setControls({
      jx: (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0),
      jy: (isDown('up') ? 1 : 0) - (isDown('down') ? 1 : 0),
      a: isDown('a'), b: isDown('b'),
    });
    if (stick) {
      const jx = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
      const jy = (isDown('down') ? 1 : 0) - (isDown('up') ? 1 : 0);
      stick.style.setProperty('--kx', jx);
      stick.style.setProperty('--ky', jy);
    }
    ['a', 'b', 'start'].forEach(k => { if (touchBtn[k]) touchBtn[k].classList.toggle('pressed', isDown(k)); });
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
  let roomVisible = true;
  const playEl = $('play');
  if (playEl && 'IntersectionObserver' in window) {
    new IntersectionObserver(es => { roomVisible = es[0].intersectionRatio > 0.5; }, { threshold: [0, 0.5, 1] }).observe(playEl);
  }
  const typingTarget = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || typingTarget(e)) return;
    if (e.code === 'Escape') { if (mode === 'game') { e.preventDefault(); exitGame(); } return; }
    if (e.code === 'KeyM') { toggleMute(); return; }
    const b = KEYS[e.code];
    if (!b) return;
    if (mode === 'room') {
      if (!roomVisible) return;                                   // let the page scroll normally
      if (e.target && e.target.tagName === 'BUTTON' && (b === 'a' || b === 'start')) return; // focused button handles it
    }
    e.preventDefault();
    if (!e.repeat) press(b, 'kb:' + e.code);
  });
  window.addEventListener('keyup', e => {
    const b = KEYS[e.code];
    if (b) release(b, 'kb:' + e.code);
  });
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  // gamepad
  function pollPad() {
    if (!navigator.getGamepads) return;
    let pad = null;
    try { for (const p of navigator.getGamepads()) if (p && p.connected) { pad = p; break; } } catch (e) { return; }
    const set = (n, on) => (on ? press(n, 'pad') : release(n, 'pad'));
    if (!pad) { BUTTONS.forEach(b => release(b, 'pad')); return; }
    const bt = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    set('left', ax < -0.5 || bt(14)); set('right', ax > 0.5 || bt(15));
    set('up', ay < -0.5 || bt(12)); set('down', ay > 0.5 || bt(13));
    set('a', bt(0)); set('b', bt(1) || bt(2) || bt(3));
    set('start', bt(9)); set('select', bt(8));
  }

  // touch controls inside the full-screen view
  const stick = $('tStick');
  const touchBtn = { a: $('tA'), b: $('tB'), start: $('tStart') };
  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ } };
  Object.entries(touchBtn).forEach(([name, el]) => {
    if (!el) return;
    const src = 'touch:' + name;
    el.addEventListener('pointerdown', e => { e.preventDefault(); AK.audio.ensure(); capture(el, e); press(name, src); });
    el.addEventListener('pointerup', () => release(name, src));
    el.addEventListener('pointercancel', () => release(name, src));
  });
  if (stick) {
    let id = null;
    const dirs = ['left', 'right', 'up', 'down'];
    const set = (n, on) => (on ? press(n, 'stick') : release(n, 'stick'));
    const move = e => {
      const r = stick.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const th = r.width * 0.16;
      set('left', dx < -th); set('right', dx > th); set('up', dy < -th); set('down', dy > th);
    };
    stick.addEventListener('pointerdown', e => { e.preventDefault(); AK.audio.ensure(); id = e.pointerId; capture(stick, e); move(e); });
    stick.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
    const end = e => { if (e.pointerId === id) { id = null; dirs.forEach(d => release(d, 'stick')); } };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }
  const ovExit = $('ovExit');
  ovExit && ovExit.addEventListener('click', exitGame);
  screen.addEventListener('pointerdown', () => {
    if (mode === 'game' && (scr === 'attract' || scr === 'scores' || scr === 'table')) { sfx.coin(); startPlay(); }
  });

  // ------------------------------------------------------------ page UI
  function updateRoomUI() {
    const g = game();
    if (!g) return;
    const t = $('roomTitle'), tag = $('roomTag');
    if (t) { t.textContent = g.title; t.style.color = g.accent; }
    if (tag) tag.textContent = g.tag;
  }
  const on = (id, fn) => { const el = $(id); el && el.addEventListener('click', fn); };
  on('roomPrev', () => { AK.audio.ensure(); focus(cur - 1); });
  on('roomNext', () => { AK.audio.ensure(); focus(cur + 1); });
  on('coinBtn', insertCoin);
  document.querySelectorAll('[data-play]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = games.findIndex(g => g.id === btn.dataset.play);
      if (i < 0 || mode !== 'room') return;
      AK.audio.ensure();
      focus(i, true);
      insertCoin();
    });
  });

  const soundBtn = $('soundBtn');
  function toggleMute() { AK.audio.setMuted(!AK.audio.muted); showMute(); }
  function showMute() {
    if (!soundBtn) return;
    soundBtn.textContent = AK.audio.muted ? '♪ SOUND OFF' : '♪ SOUND ON';
    soundBtn.setAttribute('aria-pressed', String(AK.audio.muted));
  }
  soundBtn && soundBtn.addEventListener('click', () => { AK.audio.ensure(); toggleMute(); });
  showMute();

  // high-score boards on the page
  function renderBoards() {
    const host = $('scoreBoards');
    if (!host) return;
    host.textContent = '';
    games.filter(g => !g.noScores).forEach(g => {
      const card = document.createElement('article');
      card.className = 'board';
      card.style.setProperty('--accent', g.accent);
      const h = document.createElement('h3');
      h.textContent = g.title;
      const ol = document.createElement('ol');
      AK.scores.get(g.id).slice(0, 5).forEach(e => {
        const li = document.createElement('li');
        const n = document.createElement('span'); n.textContent = e.name;
        const s = document.createElement('span'); s.textContent = AK.pad(e.score, 6);
        li.append(n, s); ol.append(li);
      });
      card.append(h, ol); host.append(card);
    });
  }
  AK.scores.onChange(renderBoards);
  renderBoards();

  // ------------------------------------------------------------ main loop
  let last = performance.now(), acc = 0;
  function loop(now) {
    acc += Math.min(100, now - last);
    last = now;
    pollPad();
    let n = 0;
    while (acc >= STEP && n < 4) { step(); acc -= STEP; n++; }
    if (acc > STEP * 4) acc = 0;
    if (n) compose();
    requestAnimationFrame(loop);
  }

  AK.host = {
    games,
    gameOver,
    insertCoin,
    exitGame,
    focus,
    current: () => cur,
    mode: () => mode,
    attachRoom(r) { room = r; room.focus(cur, true); showControls(); },
  };

  if (games.length) { enterAttract(); updateRoomUI(); }
  const begin = () => requestAnimationFrame(loop);
  if (document.fonts && document.fonts.load) document.fonts.load('8px "Press Start 2P"').then(begin, begin);
  else begin();
})();
