// STAR HOPPER: an original 8-bit style platformer
(() => {
  'use strict';

  const W = 256, H = 224, T = 16, ROWS = 14, COLS = 224;
  const GROUND_Y = 12;
  const POLE_X = 207;
  const ROCKET_X = 213 * T;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ---------------------------------------------------------------- storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  let hiScore = store.get('starhopper.hi', 0);
  const pad = (n, l) => String(Math.max(0, Math.floor(n))).padStart(l, '0');
  function showHi() { document.querySelectorAll('[data-hiscore]').forEach(el => { el.textContent = pad(hiScore, 6); }); }
  showHi();

  // ---------------------------------------------------------------- audio
  let actx = null, master = null, muted = false;
  function audio() {
    if (!actx) {
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        master = actx.createGain();
        master.gain.value = 0.22;
        master.connect(actx.destination);
      } catch (e) { actx = null; }
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, dur, type = 'square', vol = 0.5, slideTo = null, when = 0) {
    if (!actx || muted) return;
    const t = actx.currentTime + Math.max(0, when);
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.4) {
    if (!actx || muted) return;
    const len = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = actx.createBufferSource(), g = actx.createGain();
    g.gain.value = vol;
    src.buffer = buf; src.connect(g); g.connect(master); src.start();
  }
  const sfx = {
    jump: () => tone(250, 0.18, 'square', 0.3, 640),
    coin: () => { tone(988, 0.07, 'square', 0.25); tone(1319, 0.28, 'square', 0.25, null, 0.07); },
    stomp: () => tone(340, 0.14, 'triangle', 0.7, 80),
    bump: () => tone(150, 0.08, 'square', 0.35, 90),
    brick: () => { noise(0.22, 0.5); tone(120, 0.12, 'triangle', 0.5, 50); },
    die: () => [660, 560, 470, 390, 300, 220].forEach((f, i) => tone(f, 0.18, 'square', 0.3, null, 0.25 + i * 0.14)),
    win: () => [523, 659, 784, 1047, 880, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'square', 0.28, null, i * 0.13)),
    start: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.28, null, i * 0.07)),
    life: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.12, 'square', 0.28, null, i * 0.08)),
    tick: () => tone(1800, 0.03, 'square', 0.12),
    launch: () => { noise(1.6, 0.35); tone(80, 1.6, 'sawtooth', 0.25, 600); },
    pause: () => { tone(660, 0.08, 'square', 0.25); tone(880, 0.08, 'square', 0.25, null, 0.1); },
  };

  // Original background tune: 32 eighth-note steps
  const MEL = [72, 0, 76, 79, 77, 76, 74, 0, 72, 0, 67, 69, 71, 0, 74, 0,
               76, 0, 79, 81, 79, 77, 76, 0, 74, 72, 74, 76, 72, 0, 0, 0];
  const BASS = [48, 0, 55, 0, 53, 0, 55, 0, 48, 0, 55, 0, 55, 0, 50, 0,
                52, 0, 55, 0, 53, 0, 57, 0, 50, 0, 55, 0, 48, 0, 43, 0];
  const mf = n => 440 * Math.pow(2, (n - 69) / 12);
  let musicOn = false, musicStep = 0, nextNote = 0, musicTimer = null, musicFast = false;
  function startMusic() {
    if (!actx) return;
    musicOn = true; musicStep = 0; nextNote = actx.currentTime + 0.08;
    if (!musicTimer) musicTimer = setInterval(scheduleMusic, 25);
  }
  function stopMusic() { musicOn = false; }
  function scheduleMusic() {
    if (!musicOn || !actx) return;
    const step = musicFast ? 0.12 : 0.16;
    while (nextNote < actx.currentTime + 0.12) {
      const i = musicStep % 32, when = nextNote - actx.currentTime;
      if (MEL[i]) tone(mf(MEL[i]), step * 0.9, 'square', 0.1, null, when);
      if (BASS[i]) tone(mf(BASS[i]), step * 1.8, 'triangle', 0.32, null, when);
      if (i % 4 === 2) tone(90, 0.05, 'square', 0.05, 40, when);
      nextNote += step; musicStep++;
    }
  }

  // ---------------------------------------------------------------- input
  // Input arrives from arcade.js as logical cabinet buttons:
  // left/right/up/down (stick), a (jump), b (run), start, select.
  const keys = { left: false, right: false, jump: false, run: false, down: false };
  const held = { up: false, a: false };
  let jumpPressed = false, startPressed = false, active = false;

  function setKey(name, down) {
    if (name === 'jump' && down && !keys.jump) jumpPressed = true;
    keys[name] = down;
  }
  function insertCoin() {
    audio();
    startPressed = true;
  }
  function input(name, down) {
    if (!active) return;
    if (down) audio();
    switch (name) {
      case 'left': case 'right': case 'down': setKey(name, down); break;
      case 'up': case 'a': held[name] = down; setKey('jump', held.up || held.a); break;
      case 'b': setKey('run', down); break;
      case 'start': if (down) insertCoin(); break;
    }
  }
  function releaseAll() {
    Object.keys(keys).forEach(k => { keys[k] = false; });
    held.up = held.a = false;
  }
  canvas.addEventListener('pointerdown', () => {
    if (active && (state === 'title' || state === 'over' || (state === 'clear' && clearDone))) insertCoin();
  });

  // ---------------------------------------------------------------- level
  let map, enemySpawns;
  function buildLevel() {
    map = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
    const set = (x, y, c) => { if (x >= 0 && x < COLS && y >= 0 && y < ROWS) map[y][x] = c; };
    const ground = (a, b) => { for (let x = a; x <= b; x++) { set(x, 12, '#'); set(x, 13, '#'); } };
    const row = (x, y, s) => { for (let i = 0; i < s.length; i++) if (s[i] !== ' ') set(x + i, y, s[i]); };
    const pillar = (x, h) => { for (let i = 0; i < h; i++) set(x, 11 - i, 'S'); };

    ground(0, 40); ground(44, 80); ground(84, 120); ground(125, 160); ground(164, COLS - 1);

    // 1: warm-up
    row(12, 8, '?');
    row(17, 8, 'B?B?B');
    row(19, 4, '?');
    pillar(27, 2);
    row(30, 8, 'ooo');
    pillar(37, 3);
    row(41, 8, 'ooo');

    // 2: platforms + first spikes
    row(47, 8, 'SSSS'); row(47, 7, 'oooo');
    row(55, 8, 'BB?BB'); row(57, 4, '?');
    row(68, 11, '^^^'); row(68, 8, 'ooo');
    pillar(75, 2);
    row(81, 9, 'ooo');

    // 3: sky steps
    row(87, 9, 'SSS'); row(87, 8, 'ooo');
    row(91, 7, 'SSS'); row(91, 6, 'ooo');
    row(95, 5, 'S?S'); row(95, 4, 'o o');
    row(101, 8, '?');
    pillar(114, 4); row(114, 7, 'o');
    row(122, 10, 'S'); row(122, 9, 'o');

    // 4: gloop parade
    row(129, 8, 'B?BB?B'); row(129, 4, 'oooooo');
    row(151, 11, '^^');
    pillar(156, 3);

    // 5: the climb home
    row(168, 8, '?S?');
    row(175, 10, 'oooooooo');
    for (let i = 0; i < 8; i++) pillar(190 + i, i + 1);
    for (let y = 3; y <= 11; y++) set(POLE_X, y, 'F');

    enemySpawns = [24, 32, 60, 63, 100, 105, 109, 136, 140, 144, 147, 176, 181, 186];
  }

  const SOLID = new Set(['#', 'S', '?', 'B', 'U']);
  function tileAt(tx, ty) {
    if (ty < 0 || ty >= ROWS) return ' ';
    if (tx < 0 || tx >= COLS) return 'S';
    return map[ty][tx];
  }
  const solidAt = (tx, ty) => SOLID.has(tileAt(tx, ty));

  function moveX(o) {
    o.x += o.vx;
    const top = Math.floor(o.y / T), bot = Math.floor((o.y + o.h - 1) / T);
    if (o.vx > 0) {
      const tx = Math.floor((o.x + o.w - 1) / T);
      for (let ty = top; ty <= bot; ty++) if (solidAt(tx, ty)) { o.x = tx * T - o.w; return true; }
    } else if (o.vx < 0) {
      const tx = Math.floor(o.x / T);
      for (let ty = top; ty <= bot; ty++) if (solidAt(tx, ty)) { o.x = (tx + 1) * T; return true; }
    }
    return false;
  }
  function moveY(o) {
    o.y += o.vy;
    o.onGround = false;
    const l = Math.floor(o.x / T), r = Math.floor((o.x + o.w - 1) / T);
    if (o.vy > 0) {
      const ty = Math.floor((o.y + o.h - 1) / T);
      for (let tx = l; tx <= r; tx++) if (solidAt(tx, ty)) { o.y = ty * T - o.h; o.vy = 0; o.onGround = true; return null; }
    } else if (o.vy < 0) {
      const ty = Math.floor(o.y / T);
      if (solidAt(l, ty) || solidAt(r, ty)) {
        o.y = (ty + 1) * T; o.vy = 0;
        const cx = Math.floor((o.x + o.w / 2) / T);
        return { tx: solidAt(cx, ty) ? cx : (solidAt(l, ty) ? l : r), ty };
      }
    }
    return null;
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ---------------------------------------------------------------- state
  let state = 'title';           // title | ready | play | paused | dying | over | clear
  let stateTimer = 0, frame = 0;
  let score = 0, coins = 0, lives = 3, time = 300, timeTick = 0, combo = 0;
  let player, enemies, particles, popups, bumps, cam = 0, rocket, clearDone = false, hurryPlayed = false;

  function makePlayer() {
    return { x: 3 * T, y: GROUND_Y * T - 15, w: 12, h: 15, vx: 0, vy: 0, face: 1, onGround: false, coyote: 0, buffer: 0, anim: 0, hidden: false };
  }
  function resetLevel() {
    buildLevel();
    player = makePlayer();
    enemies = enemySpawns.map(x => ({ x: x * T + 1, y: GROUND_Y * T - 12, w: 14, h: 12, vx: -0.45, vy: 0, alive: true, dead: 0, flip: false, active: false, onGround: false }));
    particles = []; popups = []; bumps = {};
    cam = 0; time = 300; timeTick = 0; combo = 0; hurryPlayed = false; musicFast = false;
    rocket = { y: 0, vy: 0, launched: false };
    clearDone = false;
  }
  function newGame() {
    score = 0; coins = 0; lives = 3;
    resetLevel();
    setState('ready');
  }
  function setState(s) { state = s; stateTimer = 0; }
  function addScore(n, x, y) {
    score += n;
    if (x !== undefined) popups.push({ x, y, text: String(n), life: 45 });
  }
  function gainCoin() {
    coins++; addScore(200); sfx.coin();
    if (coins >= 100) { coins -= 100; lives++; sfx.life(); popups.push({ x: player.x, y: player.y - 10, text: '1UP', life: 60 }); }
  }
  function saveHi() {
    if (score > hiScore) { hiScore = score; store.set('starhopper.hi', hiScore); showHi(); }
  }
  function kill() {
    if (state !== 'play') return;
    setState('dying');
    stopMusic(); sfx.die();
    player.vx = 0; player.vy = -5.5;
  }

  buildLevel();
  resetLevel();

  // ---------------------------------------------------------------- update
  function hitBlock(tx, ty) {
    const c = map[ty][tx];
    const key = tx + ',' + ty;
    if (c === '?') {
      map[ty][tx] = 'U'; bumps[key] = 10;
      particles.push({ type: 'coin', x: tx * T + 4, y: ty * T - 12, vx: 0, vy: -4.5, life: 26 });
      gainCoin();
      popups.push({ x: tx * T + 2, y: ty * T - 20, text: '200', life: 40 });
    } else if (c === 'B') {
      map[ty][tx] = ' ';
      sfx.brick(); addScore(50);
      for (let i = 0; i < 4; i++) {
        particles.push({ type: 'debris', x: tx * T + (i % 2) * 8 + 4, y: ty * T + Math.floor(i / 2) * 8 + 4, vx: (i % 2 ? 1.4 : -1.4), vy: i < 2 ? -5 : -3.5, life: 70 });
      }
    } else {
      sfx.bump();
    }
    // knock out enemies standing on the block
    for (const e of enemies) {
      if (e.alive && e.x + e.w > tx * T && e.x < tx * T + T && Math.abs(e.y + e.h - ty * T) < 3) {
        e.alive = false; e.flip = true; e.vy = -3.5; e.dead = 90; sfx.stomp(); addScore(100, e.x, e.y);
      }
    }
    // collect a coin sitting on top
    if (tileAt(tx, ty - 1) === 'o') { map[ty - 1][tx] = ' '; gainCoin(); }
  }

  function updatePlayer() {
    const p = player;
    const max = keys.run ? 3.0 : 1.9;
    const acc = p.onGround ? 0.17 : 0.11;
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir) {
      p.vx += dir * acc;
      if (Math.sign(p.vx) !== dir) p.vx += dir * acc * 1.4;
      p.face = dir;
    } else {
      p.vx *= p.onGround ? 0.8 : 0.96;
      if (Math.abs(p.vx) < 0.05) p.vx = 0;
    }
    if (Math.abs(p.vx) > max) p.vx = Math.sign(p.vx) * Math.max(max, Math.abs(p.vx) - 0.1);

    if (p.onGround) { p.coyote = 6; combo = 0; } else if (p.coyote > 0) p.coyote--;
    if (jumpPressed) p.buffer = 7; else if (p.buffer > 0) p.buffer--;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = -(5.6 + Math.abs(p.vx) * 0.26);
      p.buffer = 0; p.coyote = 0; p.onGround = false;
      sfx.jump();
    }
    p.vy += (keys.jump && p.vy < 0) ? 0.2 : 0.45;
    if (p.vy > 7) p.vy = 7;

    moveX(p);
    if (p.x < cam) { p.x = cam; if (p.vx < 0) p.vx = 0; }
    const hit = moveY(p);
    if (hit) hitBlock(hit.tx, hit.ty);
    p.anim += p.onGround ? Math.abs(p.vx) * 0.12 : 0;

    // tile interactions
    const l = Math.floor(p.x / T), r = Math.floor((p.x + p.w - 1) / T);
    const t0 = Math.floor(p.y / T), b0 = Math.floor((p.y + p.h - 1) / T);
    for (let ty = t0; ty <= b0; ty++) {
      for (let tx = l; tx <= r; tx++) {
        const c = tileAt(tx, ty);
        if (c === 'o') {
          map[ty][tx] = ' '; gainCoin();
          for (let i = 0; i < 5; i++) particles.push({ type: 'spark', x: tx * T + 8, y: ty * T + 8, vx: Math.cos(i * 1.26) * 1.5, vy: Math.sin(i * 1.26) * 1.5, life: 16 });
        } else if (c === '^' && p.y + p.h > ty * T + 8 && p.x + p.w > tx * T + 2 && p.x < tx * T + 14) {
          kill(); return;
        } else if (c === 'F') {
          startClear(); return;
        }
      }
    }
    if (p.y > ROWS * T + 16) kill();
  }

  function updateEnemies() {
    const p = player;
    for (const e of enemies) {
      if (!e.active) { if (e.x < cam + W + 24) e.active = true; else continue; }
      if (!e.alive) {
        if (e.flip) { e.vy += 0.3; e.y += e.vy; e.x += e.vx * 0.6; }
        if (e.dead > 0) e.dead--;
        continue;
      }
      if (e.x + e.w < cam - 64) continue;
      e.vy = Math.min(6, e.vy + 0.4);
      if (moveX(e)) e.vx *= -1;
      moveY(e);
      if (e.onGround) {
        const aheadX = e.vx > 0 ? Math.floor((e.x + e.w) / T) : Math.floor((e.x - 1) / T);
        if (!solidAt(aheadX, Math.floor((e.y + e.h) / T))) e.vx *= -1;
      }
      if (e.y > ROWS * T) { e.alive = false; e.dead = 0; continue; }

      if (state === 'play' && overlap(p, e)) {
        if (p.vy > 0 && p.y + p.h - e.y < 9) {
          e.alive = false; e.dead = 30;
          combo++;
          const pts = Math.min(1600, 100 * Math.pow(2, combo - 1));
          addScore(pts, e.x, e.y - 6);
          sfx.stomp();
          p.vy = keys.jump ? -6.2 : -3.8;
        } else {
          kill();
        }
      }
    }
  }

  function updateParticles() {
    for (const q of particles) {
      q.x += q.vx; q.y += q.vy; q.life--;
      if (q.type === 'debris') q.vy += 0.3;
      else if (q.type === 'coin') q.vy += 0.3;
      else if (q.type === 'flame') { q.vy += 0.05; q.vx *= 0.95; }
    }
    particles = particles.filter(q => q.life > 0 && q.y < H + 20);
    for (const t of popups) { t.y -= 0.6; t.life--; }
    popups = popups.filter(t => t.life > 0);
    for (const k in bumps) { bumps[k]--; if (bumps[k] <= 0) delete bumps[k]; }
  }

  function updateCamera() {
    const target = player.x - W * 0.42;
    cam = Math.max(cam, Math.min(target, COLS * T - W));
    cam = Math.max(0, cam);
  }

  function startClear() {
    if (state !== 'play') return;
    setState('clear');
    stopMusic(); sfx.win();
    player.vx = 0; player.vy = 0;
    player.x = POLE_X * T + 7 - player.w;
    player.face = 1;
    // height bonus: higher grab, more points
    const bonus = player.y < 5 * T ? 5000 : player.y < 8 * T ? 2000 : 800;
    addScore(bonus, player.x - 10, player.y - 8);
  }

  function updateClear() {
    const p = player;
    if (!p.hidden) {
      if (stateTimer < 20) return;
      if (p.y < GROUND_Y * T - p.h) {
        p.y = Math.min(GROUND_Y * T - p.h, p.y + 2.2);
      } else {
        p.x += 1.2; p.face = 1; p.anim += 0.15; p.onGround = true;
        if (p.x + p.w / 2 >= ROCKET_X + 12) { p.hidden = true; stateTimer = 0; }
      }
      return;
    }
    // time bonus, then launch
    if (time > 0) {
      const d = Math.min(time, 3);
      time -= d; score += d * 10;
      if (frame % 3 === 0) sfx.tick();
      if (time === 0) stateTimer = 0;
      return;
    }
    if (!rocket.launched && stateTimer > 20) { rocket.launched = true; sfx.launch(); }
    if (rocket.launched) {
      rocket.vy -= 0.06; rocket.y += rocket.vy;
      for (let i = 0; i < 2; i++) {
        particles.push({ type: 'flame', x: ROCKET_X + 12 + (Math.random() * 8 - 4), y: GROUND_Y * T + rocket.y, vx: Math.random() * 1.6 - 0.8, vy: 1 + Math.random() * 1.5, life: 22 });
      }
      if (rocket.y < -260 && !clearDone) { clearDone = true; saveHi(); }
    }
  }

  function update() {
    frame++; stateTimer++;
    switch (state) {
      case 'title':
        cam = (Math.sin(frame / 900) * 0.5 + 0.5) * (COLS * T - W);
        if (startPressed) { sfx.start(); newGame(); }
        break;
      case 'ready':
        if (stateTimer > 130 || (startPressed && stateTimer > 20)) { setState('play'); startMusic(); }
        break;
      case 'play':
        if (startPressed) { setState('paused'); stopMusic(); sfx.pause(); break; }
        updatePlayer();
        if (state === 'play') updateEnemies();
        updateCamera();
        if (state === 'play' && ++timeTick >= 24) {
          timeTick = 0; time--;
          if (time === 100 && !hurryPlayed) { hurryPlayed = true; musicFast = true; popups.push({ x: player.x - 20, y: player.y - 20, text: 'HURRY!', life: 90 }); }
          if (time <= 0) { time = 0; kill(); }
        }
        break;
      case 'paused':
        if (startPressed) { state = 'play'; startMusic(); sfx.pause(); }
        break;
      case 'dying':
        if (stateTimer > 28) { player.vy += 0.3; player.y += player.vy; }
        updateEnemies();
        if (stateTimer > 170) {
          lives--;
          if (lives > 0) { resetLevel(); setState('ready'); }
          else { saveHi(); setState('over'); }
        }
        break;
      case 'over':
        if ((startPressed && stateTimer > 40) || stateTimer > 420) setState('title');
        break;
      case 'clear':
        updateClear();
        updateEnemies();
        if (clearDone && startPressed) setState('title');
        break;
    }
    if (state !== 'paused') updateParticles();
    jumpPressed = false;
    startPressed = false;
  }

  // ---------------------------------------------------------------- drawing
  const FONT = '"Press Start 2P", monospace';
  function text(str, x, y, color = '#fff', align = 'left', size = 8) {
    ctx.font = size + 'px ' + FONT;
    ctx.textAlign = align; ctx.textBaseline = 'top';
    ctx.fillStyle = '#000'; ctx.fillText(str, x + 1, y + 1);
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#1b0f3d');
  sky.addColorStop(0.5, '#4f2580');
  sky.addColorStop(0.8, '#c9507e');
  sky.addColorStop(1, '#ffb36b');
  const STARS = Array.from({ length: 46 }, (_, i) => ({ x: (i * 97) % 512, y: (i * 53) % 110, s: i % 7 === 0 ? 2 : 1, p: i }));
  const CLOUDS = [[30, 40, 1], [170, 26, 0.8], [300, 56, 1.2], [420, 34, 0.9]];

  function drawBackground(c) {
    rect(0, 0, W, H, sky);
    for (const s of STARS) {
      const x = ((s.x - c * 0.05) % 512 + 512) % 512;
      if (x > W) continue;
      if ((frame + s.p * 13) % 120 < 8) continue;
      rect(x, s.y, s.s, s.s, s.s > 1 ? '#fff6c8' : '#d8c8ff');
    }
    // striped sun
    const sx = 190 - c * 0.02, sy = 132, sr = 34;
    for (let y = -sr; y < sr; y++) {
      if (y > 2 && (y % 6 === 0 || y % 6 === 1)) continue;
      const hw = Math.sqrt(sr * sr - y * y);
      const t = (y + sr) / (2 * sr);
      ctx.fillStyle = t < 0.5 ? '#ffe066' : t < 0.75 ? '#ffa04d' : '#ff5e7e';
      ctx.fillRect(Math.round(sx - hw), sy + y, Math.round(hw * 2), 1);
    }
    // clouds
    for (const [cx, cy, s] of CLOUDS) {
      const x = ((cx - c * 0.2) % 560 + 560) % 560 - 60;
      ctx.fillStyle = 'rgba(255, 190, 230, 0.35)';
      ctx.fillRect(x, cy, 40 * s, 6); ctx.fillRect(x + 8 * s, cy - 5, 22 * s, 6); ctx.fillRect(x + 16 * s, cy - 9, 10 * s, 5);
    }
    // far mountains
    ctx.fillStyle = '#3b1c6e';
    for (let x = 0; x < W; x += 2) {
      const wx = x + c * 0.15;
      const h = 44 + 22 * Math.sin(wx * 0.018) + 12 * Math.sin(wx * 0.047 + 1.3) + 5 * Math.sin(wx * 0.11);
      ctx.fillRect(x, 196 - h, 2, h + 30);
    }
    // near hills
    ctx.fillStyle = '#25124a';
    for (let x = 0; x < W; x += 2) {
      const wx = x + c * 0.4;
      const h = 22 + 9 * Math.sin(wx * 0.03) + 6 * Math.sin(wx * 0.083 + 2);
      ctx.fillRect(x, 200 - h, 2, h + 30);
    }
  }

  function drawStar(cx, cy, col) {
    rect(cx - 1, cy - 4, 2, 8, col); rect(cx - 4, cy - 1, 8, 2, col); rect(cx - 2, cy - 2, 4, 4, col);
  }

  function drawTile(ch, x, y, tx, ty) {
    switch (ch) {
      case '#': {
        rect(x, y, T, T, '#8a4b2a');
        for (let k = 0; k < 3; k++) {
          const px = (tx * 37 + ty * 17 + k * 53) % 13 + 1, py = (tx * 11 + ty * 29 + k * 41) % 10 + 5;
          rect(x + px, y + py, 2, 2, '#6b3720');
        }
        if (tileAt(tx, ty - 1) !== '#') {
          rect(x, y, T, 5, '#4bd66b');
          rect(x, y, T, 1, '#a8ffa8');
          for (let i = 0; i < 16; i += 4) rect(x + i + ((tx + i) % 3), y + 5, 2, 2, '#2fa84f');
        }
        break;
      }
      case 'S':
        rect(x, y, T, T, '#7d6aa8');
        rect(x, y, T, 2, '#b8a8e0'); rect(x, y, 2, T, '#b8a8e0');
        rect(x, y + 14, T, 2, '#43356a'); rect(x + 14, y, 2, T, '#43356a');
        rect(x + 6, y + 6, 4, 4, '#5c4b88');
        break;
      case 'B':
        rect(x, y, T, T, '#c8553d');
        rect(x, y, T, 1, '#ff8a6a');
        rect(x, y + 7, T, 1, '#5a1f16'); rect(x, y + 15, T, 1, '#5a1f16');
        rect(x + 7, y, 1, 7, '#5a1f16'); rect(x + 3, y + 8, 1, 7, '#5a1f16'); rect(x + 11, y + 8, 1, 7, '#5a1f16');
        break;
      case '?': {
        const glow = Math.sin(frame * 0.1 + tx) * 0.5 + 0.5;
        rect(x, y, T, T, '#a8620c');
        rect(x + 1, y + 1, 14, 14, glow > 0.5 ? '#ffc94a' : '#ffb627');
        rect(x + 1, y + 1, 14, 1, '#fff0a8');
        rect(x + 2, y + 2, 1, 1, '#a8620c'); rect(x + 13, y + 2, 1, 1, '#a8620c');
        rect(x + 2, y + 13, 1, 1, '#a8620c'); rect(x + 13, y + 13, 1, 1, '#a8620c');
        drawStar(x + 8, y + 8, '#fff7d6');
        break;
      }
      case 'U':
        rect(x, y, T, T, '#4a3524');
        rect(x + 1, y + 1, 14, 14, '#8b6b4a');
        rect(x + 2, y + 2, 1, 1, '#4a3524'); rect(x + 13, y + 2, 1, 1, '#4a3524');
        rect(x + 2, y + 13, 1, 1, '#4a3524'); rect(x + 13, y + 13, 1, 1, '#4a3524');
        break;
      case 'o': {
        const w = Math.max(2, Math.round(Math.abs(Math.cos(frame * 0.07 + tx * 0.6)) * 8));
        const cx = x + 8 - w / 2;
        rect(cx, y + 3, w, 10, '#c98f00');
        rect(cx + (w > 3 ? 1 : 0), y + 2, Math.max(1, w - 2), 12, '#ffd23f');
        if (w > 4) rect(cx + 2, y + 4, 1, 6, '#fff3a0');
        break;
      }
      case '^':
        ctx.fillStyle = '#d9d9f0';
        for (let i = 0; i < 2; i++) {
          ctx.beginPath(); ctx.moveTo(x + i * 8, y + 16); ctx.lineTo(x + i * 8 + 4, y + 6); ctx.lineTo(x + i * 8 + 8, y + 16); ctx.fill();
        }
        rect(x, y + 14, T, 2, '#6e6e90');
        rect(x + 3, y + 8, 1, 4, '#ffffff'); rect(x + 11, y + 8, 1, 4, '#ffffff');
        break;
      case 'F':
        rect(x + 7, y, 2, T, '#e8e8ff');
        rect(x + 8, y, 1, T, '#9a9ac0');
        if (ty === 3) {
          const pulse = Math.sin(frame * 0.15) > 0;
          ctx.fillStyle = 'rgba(255, 230, 120, 0.25)';
          ctx.beginPath(); ctx.arc(x + 8, y - 4, pulse ? 10 : 8, 0, Math.PI * 2); ctx.fill();
          drawStar(x + 8, y - 4, '#ffe066');
          rect(x + 7, y - 5, 2, 2, '#ffffff');
        }
        break;
    }
  }

  function drawTiles(c) {
    const x0 = Math.floor(c / T), x1 = x0 + W / T + 1;
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const ch = tileAt(tx, ty);
        if (ch === ' ' || tx >= COLS) continue;
        const b = bumps[tx + ',' + ty];
        const off = b ? -Math.round(Math.sin((b / 10) * Math.PI) * 5) : 0;
        drawTile(ch, tx * T - c, ty * T + off, tx, ty);
      }
    }
  }

  function drawRocket(c) {
    const x = ROCKET_X - c, base = GROUND_Y * T;
    if (x < -40 || x > W + 40) return;
    // launch pad
    rect(x - 4, base - 4, 32, 4, '#5c4b88');
    rect(x - 2, base - 30, 3, 26, '#43356a');
    rect(x - 2, base - 30, 8, 2, '#43356a');
    const y = base - 4 + Math.round(rocket.y);
    // fins
    rect(x + 2, y - 10, 4, 10, '#e0304e'); rect(x + 18, y - 10, 4, 10, '#e0304e');
    // body
    rect(x + 6, y - 36, 12, 34, '#eef0ff');
    rect(x + 6, y - 36, 3, 34, '#ffffff');
    rect(x + 15, y - 36, 3, 34, '#b8bce0');
    rect(x + 6, y - 14, 12, 3, '#e0304e');
    // nose
    rect(x + 8, y - 42, 8, 6, '#e0304e'); rect(x + 10, y - 46, 4, 4, '#e0304e');
    // window (Pip waves when inside)
    rect(x + 9, y - 29, 6, 6, '#2b1d55');
    rect(x + 10, y - 28, 4, 4, player.hidden ? '#3ee6c8' : '#2de2e6');
    rect(x + 10, y - 28, 1, 1, '#ffffff');
    if (rocket.launched && (frame >> 1) % 2) {
      rect(x + 8, y - 2, 8, 6, '#ffd23f'); rect(x + 10, y + 4, 4, 5, '#ff7a3d');
    }
  }

  function drawPip(px, py, face, anim, airborne, deadPose) {
    const fx = (x, w) => face < 0 ? 12 - x - w : x;
    const r = (x, y, w, h, col) => rect(px + fx(x, w), py + y, w, h, col);
    // backpack
    r(0, 7, 2, 5, '#8a8fb0');
    // body suit
    r(2, 7, 8, 5, '#ff7a3d');
    r(2, 7, 8, 1, '#ffb07a');
    r(2, 10, 8, 1, '#3a1d4a');
    r(9, 8, 2, 2, '#ff7a3d'); // arm
    // helmet
    r(2, 0, 8, 1, '#3ee6c8');
    r(1, 1, 10, 6, '#3ee6c8');
    r(1, 1, 2, 2, '#bafff2');
    r(5, 2, 6, 4, deadPose ? '#ff5e7e' : '#1a1f4a');
    r(9, 2, 1, 1, '#ffffff');
    r(1, 6, 10, 1, '#1fa892');
    // antenna
    r(4, -2, 1, 2, '#e8e8ff'); r(3, -3, 3, 1, '#ffd23f');
    // legs
    let l1 = 0, l2 = 0;
    if (airborne) { l1 = -1; l2 = 1; }
    else { const f = Math.floor(anim) % 4; l1 = f === 1 ? -1 : f === 3 ? 1 : 0; l2 = -l1; }
    r(3 + l1, 12, 3, 3, '#2b2b4f');
    r(7 + l2, 12, 3, 3, '#2b2b4f');
    r(3 + l1, 14, 3, 1, '#ffd23f');
    r(7 + l2, 14, 3, 1, '#ffd23f');
  }

  function drawGloop(e, c) {
    const x = Math.round(e.x - c), y = Math.round(e.y);
    if (x < -20 || x > W + 20) return;
    if (!e.alive && !e.flip) {
      if (e.dead <= 0) return;
      rect(x, y + 8, 14, 4, '#c03bff'); rect(x + 2, y + 7, 10, 1, '#e08aff');
      rect(x + 3, y + 9, 2, 1, '#fff'); rect(x + 9, y + 9, 2, 1, '#fff');
      return;
    }
    if (e.flip && e.dead <= 0) return;
    const squish = e.alive ? Math.round(Math.sin(frame * 0.25 + e.x) * 1) : 0;
    const top = y + 1 + squish;
    ctx.save();
    if (e.flip) { ctx.translate(0, y * 2 + 12); ctx.scale(1, -1); }
    rect(x + 3, top, 8, 2, '#c03bff');
    rect(x + 1, top + 2, 12, 2, '#c03bff');
    rect(x, top + 4, 14, 11 - 4 - squish, '#c03bff');
    rect(x + 3, top + 1, 3, 2, '#f0b0ff');
    rect(x, y + 10, 14, 2, '#7a1fb0');
    const look = e.vx > 0 ? 1 : 0;
    rect(x + 2, top + 4, 4, 4, '#ffffff'); rect(x + 8, top + 4, 4, 4, '#ffffff');
    rect(x + 3 + look, top + 5, 2, 2, '#1a0a2a'); rect(x + 9 + look, top + 5, 2, 2, '#1a0a2a');
    // feet
    const step = (frame >> 3) % 2;
    rect(x + 1 + step, y + 11, 3, 1, '#7a1fb0'); rect(x + 10 - step, y + 11, 3, 1, '#7a1fb0');
    ctx.restore();
  }

  function drawParticles(c) {
    for (const q of particles) {
      const x = Math.round(q.x - c), y = Math.round(q.y);
      if (q.type === 'coin') { rect(x + 2, y, 4, 10, '#ffd23f'); rect(x + 3, y + 1, 1, 6, '#fff3a0'); }
      else if (q.type === 'debris') { rect(x, y, 5, 5, '#c8553d'); rect(x, y, 5, 1, '#ff8a6a'); }
      else if (q.type === 'spark') rect(x, y, 2, 2, '#fff3a0');
      else if (q.type === 'flame') rect(x, y, 3, 3, q.life > 14 ? '#ffd23f' : q.life > 7 ? '#ff7a3d' : '#7a2a4a');
    }
    for (const t of popups) text(t.text, Math.round(t.x - c), Math.round(t.y), '#ffffff', 'left', 8);
  }

  function drawHUD() {
    text('SCORE', 8, 6, '#ffd23f');
    text(pad(score, 6), 8, 16);
    // coin icon
    rect(82, 16, 6, 8, '#ffd23f'); rect(83, 17, 1, 5, '#fff3a0');
    text('COINS', 80, 6, '#ffd23f');
    text('x' + pad(coins, 2), 90, 16);
    text('LIVES', 140, 6, '#ffd23f');
    text('x' + lives, 148, 16);
    text('TIME', 208, 6, '#ffd23f');
    text(pad(time, 3), 212, 16, time <= 100 && (frame >> 4) % 2 ? '#ff5e7e' : '#ffffff');
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(11, 6, 20, 0.82)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#ff3ea5'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  function draw() {
    const c = Math.round(cam);
    if (state === 'ready') {
      rect(0, 0, W, H, '#0b0614');
      text('STAR HOPPER', W / 2, 62, '#ff3ea5', 'center', 16);
      text('ZONE 1 · TWILIGHT RUN', W / 2, 92, '#2de2e6', 'center', 8);
      drawPip(W / 2 - 26, 122, 1, 0, false, false);
      text('x ' + lives, W / 2 - 4, 126, '#ffffff', 'left', 8);
      if ((frame >> 4) % 2) text('GET READY!', W / 2, 168, '#ffd23f', 'center', 8);
      drawHUD();
      return;
    }

    drawBackground(c);
    drawTiles(c);
    drawRocket(c);
    for (const e of enemies) if (e.active || state === 'title') drawGloop(e, c);
    if (state !== 'title' && !player.hidden) {
      const airborne = !player.onGround && state !== 'dying';
      drawPip(Math.round(player.x - c), Math.round(player.y), player.face, player.anim, airborne, state === 'dying');
    }
    drawParticles(c);

    if (state === 'title') {
      panel(28, 34, 200, 150);
      text('STAR', W / 2 + 2, 48, '#7a1250', 'center', 24);
      text('STAR', W / 2, 46, '#ffd23f', 'center', 24);
      text('HOPPER', W / 2 + 2, 76, '#7a1250', 'center', 16);
      text('HOPPER', W / 2, 74, '#ff3ea5', 'center', 16);
      text('A PIP ADVENTURE', W / 2, 100, '#2de2e6', 'center', 8);
      if ((frame >> 5) % 2) text('INSERT COIN', W / 2, 126, '#ffffff', 'center', 8);
      text('PRESS START', W / 2, 142, '#a99cc8', 'center', 8);
      text('HI ' + pad(hiScore, 6), W / 2, 164, '#ffd23f', 'center', 8);
      text('© 2026 AKARCADE', W / 2, 206, '#d8c8ff', 'center', 8);
      return;
    }

    drawHUD();
    if (state === 'paused') {
      panel(64, 90, 128, 44);
      text('PAUSED', W / 2, 104, '#ffd23f', 'center', 8);
      text('START TO RESUME', W / 2, 118, '#a99cc8', 'center', 8);
    } else if (state === 'over') {
      panel(48, 80, 160, 64);
      text('GAME OVER', W / 2, 96, '#ff3ea5', 'center', 16);
      text('SCORE ' + pad(score, 6), W / 2, 122, '#ffffff', 'center', 8);
    } else if (state === 'clear' && player.hidden && time === 0 && rocket.y < -60) {
      panel(36, 70, 184, 84);
      text('ZONE CLEAR!', W / 2, 84, '#ffd23f', 'center', 16);
      text('SCORE ' + pad(score, 6), W / 2, 110, '#ffffff', 'center', 8);
      if (clearDone && (frame >> 5) % 2) text('PRESS START', W / 2, 132, '#2de2e6', 'center', 8);
    }
  }

  // ---------------------------------------------------------------- loop
  const STEP = 1000 / 60;
  let last = performance.now(), acc = 0;
  function loop(now) {
    acc += Math.min(200, now - last);
    last = now;
    if (active) {
      while (acc >= STEP) { update(); acc -= STEP; }
      draw();
    } else acc = 0;
    requestAnimationFrame(loop);
  }
  const begin = () => requestAnimationFrame(loop);
  if (document.fonts && document.fonts.load) {
    document.fonts.load('8px "Press Start 2P"').then(begin, begin);
  } else begin();

  window.StarHopper = {
    input,
    activate() {
      active = true; releaseAll();
      setState('title');
      jumpPressed = startPressed = false;
    },
    deactivate() {
      if (state !== 'title') saveHi();
      active = false; releaseAll();
      stopMusic();
      setState('title');
    },
    setMuted(m) { muted = !!m; },
    releaseAll,
  };
})();
