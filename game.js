// STAR HOPPER: an original 8-bit style platformer in three zones with a boss.
// Runs on the shared AK arcade contract (see core.js): the host owns the frame loop,
// audio context and high scores; this file only draws on its own canvas.
(() => {
  'use strict';

  const AK = window.AK;
  const ID = 'starhopper';
  const W = 256, H = 224, T = 16, ROWS = 14;
  const GROUND_Y = 12;
  const canvas = AK.makeCanvas();
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const pad = AK.pad;

  // ---------------------------------------------------------------- audio
  const tone = (freq, dur, type, vol, slideTo, delay) => AK.audio.tone(freq, dur, type, vol, slideTo, delay);
  const noise = (dur, vol) => AK.audio.noise(dur, vol);
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
    appear: () => tone(300, 0.3, 'triangle', 0.4, 900),
    shield: () => [523, 784, 1047, 1568].forEach((f, i) => tone(f, 0.1, 'triangle', 0.4, null, i * 0.05)),
    shieldBreak: () => { noise(0.18, 0.4); tone(900, 0.3, 'square', 0.25, 180); },
    bossHit: () => { tone(200, 0.25, 'sawtooth', 0.35, 60); tone(520, 0.12, 'square', 0.25, 260, 0.05); },
    slam: () => { noise(0.3, 0.5); tone(70, 0.3, 'triangle', 0.7, 35); },
    gate: () => { noise(0.25, 0.4); tone(110, 0.25, 'square', 0.3, 55); },
  };

  // Original background tune: 32 eighth-note steps (transposed per zone)
  const MEL = [72, 0, 76, 79, 77, 76, 74, 0, 72, 0, 67, 69, 71, 0, 74, 0,
               76, 0, 79, 81, 79, 77, 76, 0, 74, 72, 74, 76, 72, 0, 0, 0];
  const BASS = [48, 0, 55, 0, 53, 0, 55, 0, 48, 0, 55, 0, 55, 0, 50, 0,
                52, 0, 55, 0, 53, 0, 57, 0, 50, 0, 55, 0, 48, 0, 43, 0];
  const TRANSPOSE = [0, -3, 2];
  const mf = n => 440 * Math.pow(2, (n - 69) / 12);
  let musicOn = false, musicStep = 0, nextNote = 0, musicTimer = null, musicFast = false, lastTickAt = 0;
  function startMusic() {
    if (mode !== 'play') return;
    musicOn = true; musicStep = 0; nextNote = AK.audio.now() + 0.08;
    if (musicTimer === null) musicTimer = setInterval(scheduleMusic, 25);
  }
  function stopMusic() {
    musicOn = false;
    if (musicTimer !== null) { clearInterval(musicTimer); musicTimer = null; }
  }
  function scheduleMusic() {
    if (!musicOn || mode !== 'play' || state !== 'play') return;
    const now = AK.audio.now();
    if (!now) return;                                                // no audio context yet
    if (now - lastTickAt > 0.5) { nextNote = now + 0.05; return; }   // host is not ticking us
    if (nextNote < now - 0.25) nextNote = now + 0.05;
    const step = musicFast ? 0.12 : 0.16, tr = TRANSPOSE[zone] || 0;
    while (nextNote < now + 0.12) {
      const i = musicStep % 32, when = Math.max(0, nextNote - now);
      if (MEL[i]) tone(mf(MEL[i] + tr), step * 0.9, 'square', 0.1, null, when);
      if (BASS[i]) tone(mf(BASS[i] + tr), step * 1.8, 'triangle', 0.32, null, when);
      if (i % 4 === 2) tone(90, 0.05, 'square', 0.05, 40, when);
      nextNote += step; musicStep++;
    }
  }

  // ---------------------------------------------------------------- input
  // Logical cabinet buttons: left/right/up/down (stick), a (jump), b (run), start, select.
  const keys = { left: false, right: false, jump: false, run: false, down: false };
  const held = { up: false, a: false };
  let jumpPressed = false, startPressed = false;
  let mode = 'attract';          // attract | play
  let demo = false, demoTimer = 0;

  function setKey(name, down) {
    if (name === 'jump' && down && !keys.jump) jumpPressed = true;
    keys[name] = down;
  }
  function input(name, down) {
    if (mode !== 'play') return;
    switch (name) {
      case 'left': case 'right': case 'down': setKey(name, !!down); break;
      case 'up': case 'a': held[name] = !!down; setKey('jump', held.up || held.a); break;
      case 'b': setKey('run', !!down); break;
      case 'start': if (down) startPressed = true; break;
    }
  }
  function releaseAll() {
    Object.keys(keys).forEach(k => { keys[k] = false; });
    held.up = held.a = false;
    jumpPressed = startPressed = false;
  }

  // ---------------------------------------------------------------- zones
  // Tiles: # ground, S stone, B brick, ? star block (coin), Z bolt block (shield),
  // H heart block (1UP), I hidden 1UP block, U used block, o coin, ^ spikes, F star pole.
  const ZONES = [
    {
      name: 'TWILIGHT RUN', cols: 224, time: 300, speed: 0.45, boss: false, build: zone1,
      pal: { dirt: '#8a4b2a', speck: '#6b3720', top: '#4bd66b', topHi: '#a8ffa8', topLo: '#2fa84f',
             stone: '#7d6aa8', stoneHi: '#b8a8e0', stoneLo: '#43356a', stoneMid: '#5c4b88' },
    },
    {
      name: 'NEON NIGHT', cols: 240, time: 340, speed: 0.55, boss: false, build: zone2,
      pal: { dirt: '#2a2f6b', speck: '#1c2050', top: '#2de2e6', topHi: '#b8fbff', topLo: '#1a9aa8',
             stone: '#4a6aa8', stoneHi: '#9ac0f0', stoneLo: '#1f3260', stoneMid: '#35508a' },
    },
    {
      name: 'EMBER DAWN', cols: 256, time: 400, speed: 0.65, boss: true, build: zone3,
      pal: { dirt: '#3a1a1a', speck: '#240e0e', top: '#ff7a3d', topHi: '#ffd23f', topLo: '#b0401e',
             stone: '#6a4a52', stoneHi: '#a88890', stoneLo: '#2e1a20', stoneMid: '#4e3238' },
    },
  ];

  function zone1(h) {
    h.ground(0, 40); h.ground(44, 80); h.ground(84, 120); h.ground(125, 160); h.ground(164, h.cols - 1);

    // 1: warm-up
    h.row(12, 8, '?');
    h.row(17, 8, 'B?B?B');
    h.row(19, 4, '?');
    h.pillar(27, 2);
    h.row(30, 8, 'ooo');
    h.pillar(37, 3);
    h.row(41, 8, 'ooo');
    h.gloop(24); h.gloop(32);

    // 2: platforms + first spikes
    h.row(47, 8, 'SSSS'); h.row(47, 7, 'oooo');
    h.row(55, 8, 'BB?BB'); h.row(57, 4, '?');
    h.row(68, 11, '^^^'); h.row(68, 8, 'ooo');
    h.pillar(75, 2);
    h.row(81, 9, 'ooo');
    h.gloop(60); h.gloop(63);

    // 3: sky steps
    h.row(87, 9, 'SSS'); h.row(87, 8, 'ooo');
    h.row(91, 7, 'SSS'); h.row(91, 6, 'ooo');
    h.row(95, 5, 'S?S'); h.row(95, 4, 'o o');
    h.row(101, 8, 'Z');
    h.pillar(114, 4); h.row(114, 7, 'o');
    h.row(122, 10, 'S'); h.row(122, 9, 'o');
    h.gloop(100); h.gloop(105); h.gloop(109);
    h.checkpoint(112);

    // 4: gloop parade
    h.row(129, 8, 'B?BB?B'); h.row(129, 4, 'oooooo');
    h.row(151, 11, '^^');
    h.pillar(156, 3);
    h.gloop(136); h.gloop(140); h.gloop(144); h.spiker(147);

    // 5: the climb home
    h.row(168, 8, '?S?');
    h.row(175, 10, 'oooooooo');
    h.gloop(176); h.flutter(180, 9); h.gloop(186);
    h.goal();
  }

  function zone2(h) {
    h.ground(0, 30); h.ground(35, 62); h.ground(71, 98); h.ground(103, 128);
    h.ground(142, 170); h.ground(175, h.cols - 1);

    // 1: rooftops
    h.row(8, 8, 'B?B');
    h.gloop(15);
    h.pillar(19, 2);
    h.row(22, 8, 'ooo');
    h.gloop(25); h.flutter(27, 9);
    h.row(31, 8, 'oooo');

    // 2: spiker on the bolt row
    h.row(38, 8, 'BBZBB'); h.spiker(40, 8);
    h.gloop(44);
    h.row(47, 11, '^^'); h.row(47, 8, 'oo');
    h.pillar(52, 3);
    h.spiker(56); h.row(57, 8, '?');
    h.plat(63, 70); h.row(65, 9, 'oooo');

    // 3: neon steps
    h.row(74, 8, 'B?B?B'); h.row(76, 4, '?');
    h.gloop(79); h.gloop(82);
    h.orb(85);
    h.pillar(88, 2);
    h.row(90, 9, 'SSS'); h.row(90, 8, 'ooo');
    h.row(94, 7, 'SSS'); h.row(94, 6, 'ooo');
    h.flutter(92, 5);
    h.gloop(96);
    h.row(99, 8, 'oooo');

    // 4: the long crossing
    h.checkpoint(104);
    h.row(108, 11, '^^^'); h.row(108, 8, 'ooo');
    h.row(112, 8, 'BBBBBB'); h.gloop(114, 8); h.row(113, 4, 'oooo');
    h.spiker(116);
    h.flutter(119, 9);
    h.pillar(121, 3);
    h.row(124, 10, 'o o'); h.row(125, 8, 'I');           // the hidden 1UP
    h.set(132, 12, 'S'); h.set(133, 12, 'S'); h.set(132, 13, 'S'); h.set(133, 13, 'S');
    h.row(132, 10, 'oo');
    h.plat(134, 141); h.row(136, 9, 'oooo');

    // 5: orb alley
    h.row(145, 8, 'B?B');
    h.gloop(148); h.spiker(151);
    h.orb(155);
    h.row(158, 11, '^^'); h.row(158, 8, 'oo');
    h.pillar(162, 2);
    h.flutter(165, 8); h.gloop(167);
    h.row(171, 8, 'oooo');

    // 6: the climb home
    h.checkpoint(176);
    h.row(178, 8, '??');
    h.gloop(183); h.gloop(186); h.spiker(189);
    h.row(191, 8, 'BBBB');
    h.flutter(195, 9);
    h.row(198, 11, '^^^'); h.row(198, 8, 'ooo');
    h.gloop(203);
    h.goal();
  }

  function zone3(h) {
    h.ground(0, 24); h.ground(29, 50); h.ground(60, 84); h.ground(89, 110);
    h.ground(126, 150); h.ground(155, 176); h.ground(187, h.cols - 1);

    // 1: scorched start
    h.row(6, 8, 'B?B');
    h.gloop(11); h.flutter(13, 9); h.spiker(15);
    h.row(18, 11, '^^'); h.row(18, 8, 'oo');
    h.pillar(22, 2);
    h.row(25, 8, 'oooo');

    // 2: brick bridge
    h.row(31, 8, 'BBBBB'); h.spiker(33, 8);
    h.gloop(36);
    h.orb(39);
    h.row(42, 8, '?Z?');
    h.gloop(45); h.gloop(47); h.flutter(48, 9);
    h.plat(51, 59); h.row(53, 9, 'ooooo'); h.flutter(55, 6);

    // 3: ash steps
    h.row(63, 11, '^^^'); h.row(63, 8, 'ooo');
    h.spiker(68);
    h.row(70, 9, 'SSS'); h.row(70, 8, 'ooo');
    h.row(74, 7, 'SSS'); h.row(74, 6, 'ooo');
    h.row(78, 5, 'S?S'); h.row(78, 4, 'o o');
    h.gloop(76); h.gloop(80);
    h.orb(82);
    h.row(85, 8, 'oooo');

    // 4: cinder field
    h.checkpoint(90);
    h.row(92, 8, 'B?B?B'); h.row(94, 4, '?');
    h.spiker(96); h.gloop(99);
    h.row(101, 11, '^^');
    h.pillar(104, 3);
    h.orb(107); h.flutter(108, 8);
    h.set(115, 12, 'S'); h.set(116, 12, 'S'); h.set(115, 13, 'S'); h.set(116, 13, 'S');
    h.row(115, 10, 'oo');
    h.plat(117, 125); h.row(119, 9, 'ooooo');

    // 5: the gauntlet
    h.row(128, 8, 'BBBBBB'); h.spiker(130, 8);
    h.gloop(133); h.gloop(135);
    h.row(138, 11, '^^^'); h.row(138, 8, 'ooo');
    h.pillar(142, 2); h.pillar(145, 4); h.row(145, 6, 'o');
    h.spiker(148);
    h.row(151, 8, 'oooo');

    // 6: orb run
    h.checkpoint(156);
    h.orb(159);
    h.row(161, 8, '?B?');
    h.gloop(164); h.flutter(166, 9);
    h.row(168, 11, '^^');
    h.orb(171);
    h.gloop(174);
    h.plat(177, 186); h.row(179, 9, 'oooooo'); h.flutter(182, 6);

    // 7: the king's road
    h.row(189, 8, 'B?B');
    h.gloop(193); h.spiker(196);
    h.row(199, 11, '^^^'); h.row(199, 8, 'ooo');
    h.flutter(203, 9);
    h.pillar(206, 3);
    h.checkpoint(207);
    h.row(209, 8, 'BZB');
    h.gloop(214);
    h.orb(217);
    h.row(221, 10, 'oooo');
    h.arena();
  }

  function makeLevel(zi) {
    const Z = ZONES[zi], cols = Z.cols;
    const L = { zone: zi, cols, map: Array.from({ length: ROWS }, () => Array(cols).fill(' ')),
                spawns: [], plats: [], checkpoints: [3], pole: -1, arena: -1, rocketX: 0 };
    const set = (x, y, c) => { if (x >= 0 && x < cols && y >= 0 && y < ROWS) L.map[y][x] = c; };
    const h = {
      cols, set,
      ground(a, b) { for (let x = a; x <= b; x++) { set(x, 12, '#'); set(x, 13, '#'); } },
      row(x, y, s) { for (let i = 0; i < s.length; i++) if (s[i] !== ' ') set(x + i, y, s[i]); },
      pillar(x, n) { for (let i = 0; i < n; i++) set(x, 11 - i, 'S'); },
      gloop(x, row) { L.spawns.push({ type: 'gloop', x, row: row || GROUND_Y }); },
      spiker(x, row) { L.spawns.push({ type: 'spiker', x, row: row || GROUND_Y }); },
      flutter(x, row) { L.spawns.push({ type: 'flutter', x, row }); },
      orb(x) { L.spawns.push({ type: 'orb', x, row: GROUND_Y }); },
      // a moving platform that shuttles across the gap spanning tile columns a..b
      plat(a, b) { L.plats.push({ x0: a * T + 2, x1: (b + 1) * T - 50, y: GROUND_Y * T, w: 48, h: 8 }); },
      checkpoint(x) { L.checkpoints.push(x); },
      goal() {
        for (let i = 0; i < 8; i++) h.pillar(cols - 34 + i, i + 1);
        L.pole = cols - 17;
        for (let y = 3; y <= 11; y++) set(L.pole, y, 'F');
        L.rocketX = (cols - 11) * T;
      },
      arena() {
        L.arena = cols - 28;
        for (let y = 0; y <= 11; y++) set(L.arena + 15, y, 'S');
        L.rocketX = (cols - 8) * T;
      },
    };
    Z.build(h);
    return L;
  }

  let map, COLS = 224, POLE_X = -1, ARENA = -1, ROCKET_X = 0, level, PAL = ZONES[0].pal;
  function buildLevel(zi) {
    level = makeLevel(zi);
    map = level.map; COLS = level.cols; POLE_X = level.pole; ARENA = level.arena; ROCKET_X = level.rocketX;
    PAL = ZONES[zi].pal;
  }

  const SOLID = new Set(['#', 'S', '?', 'B', 'U', 'Z', 'H']);
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
    const prevY = o.y;
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
      // hidden blocks only exist for Pip, and only when struck from below
      if (o === player && prevY >= (ty + 1) * T - 0.01) {
        for (let tx = l; tx <= r; tx++) {
          if (tileAt(tx, ty) === 'I') { o.y = (ty + 1) * T; o.vy = 0; return { tx, ty }; }
        }
      }
    }
    return null;
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ---------------------------------------------------------------- state
  // title | ready | play | paused | dying | over | clear | ending | done
  let state = 'title', finalScreen = 'over', reported = false;
  let stateTimer = 0, frame = 0, shake = 0;
  let zone = 0, checkpoint = 3;
  let score = 0, coins = 0, lives = 3, time = 300, timeTick = 0, combo = 0;
  let player, enemies = [], particles = [], popups = [], bumps = {}, plats = [], items = [], waves = [], boss = null;
  let cam = 0, rocket = { y: 0, vy: 0, launched: false }, clearDone = false, clearTimer = 0, hurryPlayed = false;

  function makePlayer(col) {
    return { x: col * T, y: GROUND_Y * T - 15, w: 12, h: 15, vx: 0, vy: 0, face: 1, onGround: false,
             coyote: 0, buffer: 0, anim: 0, hidden: false, shield: false, inv: 0, ride: null };
  }
  function makeEnemy(s) {
    const speed = ZONES[zone].speed;
    const e = { type: s.type, alive: true, dead: 0, flip: false, active: false, onGround: false, vy: 0 };
    if (s.type === 'flutter') {
      Object.assign(e, { x: s.x * T + 2, y: s.row * T, w: 12, h: 10, vx: -0.6, baseY: s.row * T, x0: s.x * T + 2, t: s.x * 5 });
    } else if (s.type === 'orb') {
      Object.assign(e, { x: s.x * T + 2, y: 9 * T - 6, w: 12, h: 12, vx: 0, baseY: 9 * T - 6, amp: 40, t: s.x * 7 });
    } else {
      Object.assign(e, { x: s.x * T + 1, y: s.row * T - 12, w: 14, h: 12, vx: -speed });
    }
    return e;
  }
  function camMax() { return boss && !boss.gone ? ARENA * T : COLS * T - W; }
  function resetLevel() {
    buildLevel(zone);
    player = makePlayer(checkpoint);
    enemies = level.spawns.map(makeEnemy);
    plats = level.plats.map((p, i) => ({ x: i % 2 ? p.x1 : p.x0, y: p.y, w: p.w, h: p.h, x0: p.x0, x1: p.x1, vx: i % 2 ? -0.7 : 0.7 }));
    particles = []; popups = []; bumps = {}; items = []; waves = [];
    boss = null;
    if (ZONES[zone].boss) {
      const maxX = (ARENA + 15) * T - 40;
      boss = { x: maxX - 16, y: GROUND_Y * T - 32, w: 40, h: 32, vx: 0, vy: 0, hp: 3, inv: 0, onGround: true,
               wait: 70, hops: 0, slam: false, squash: 0, active: false, dying: false, defeated: false, gone: false, dead: 0,
               minX: (ARENA + 1) * T, maxX };
    }
    cam = Math.max(0, Math.min(checkpoint * T - W * 0.42, camMax()));
    time = ZONES[zone].time; timeTick = 0; combo = 0; hurryPlayed = false; musicFast = false; shake = 0;
    rocket = { y: 0, vy: 0, launched: false };
    clearDone = false; clearTimer = 0;
  }
  function newGame() {
    score = 0; coins = 0; lives = 3; zone = 0; checkpoint = 3;
    resetLevel();
    setState('ready');
  }
  function setState(s) { state = s; stateTimer = 0; }
  function addScore(n, x, y) {
    score += n;
    if (x !== undefined) popups.push({ x, y, text: String(n), life: 45 });
  }
  function gainLife() {
    lives++; sfx.life();
    popups.push({ x: player.x, y: player.y - 10, text: '1UP', life: 60 });
  }
  function gainCoin() {
    coins++; addScore(200); sfx.coin();
    if (coins >= 100) { coins -= 100; gainLife(); }
  }
  function kill() {
    if (state !== 'play') return;
    setState('dying');
    stopMusic(); sfx.die();
    player.vx = 0; player.vy = -5.5; player.shield = false; player.ride = null;
  }
  function knockOut(e) {
    e.alive = false; e.flip = true; e.vy = -3.5; e.dead = 90;
    sfx.stomp(); addScore(100, e.x, e.y);
  }
  // Something hurt Pip: the shield soaks one hit, otherwise a life is lost.
  function hurt(e) {
    const p = player;
    if (state !== 'play' || p.inv > 0) return;
    if (p.shield) {
      p.shield = false; p.inv = 90; sfx.shieldBreak();
      for (let i = 0; i < 8; i++) particles.push({ type: 'spark', x: p.x + 6, y: p.y + 7, vx: Math.cos(i * 0.785) * 2, vy: Math.sin(i * 0.785) * 2, life: 18 });
      if (e && e.alive && e.type !== 'orb') knockOut(e);
      return;
    }
    kill();
  }
  function report() {
    if (reported) return;
    reported = true;
    finalScreen = state;
    setState('done');
    stopMusic();
    AK.gameOver(ID, score);          // last: the host may call reset() from inside
  }

  // ---------------------------------------------------------------- attract mode
  function toTitle() {
    demo = false; demoTimer = 0;
    zone = 0; checkpoint = 3; score = 0; coins = 0; lives = 3;
    releaseAll();
    resetLevel();
    setState('title');
  }
  function startDemo() {
    toTitle();
    demo = true;
    setState('play');
  }
  // Simple demo bot: hold right, hop over whatever is just ahead.
  function botInput() {
    const p = player;
    keys.left = false; keys.right = true; keys.run = false; keys.down = false;
    let want = false;
    if (p.onGround) {
      const foot = Math.floor((p.y + p.h) / T);
      const a1 = Math.floor((p.x + p.w + 6) / T), a2 = Math.floor((p.x + p.w + 20) / T);
      if (solidAt(a1, foot - 1)) want = true;                                   // wall or pillar
      let floor = false;
      for (let ty = foot; ty < ROWS; ty++) if (solidAt(a1, ty)) { floor = true; break; }
      if (!floor) want = true;                                                  // gap
      if (tileAt(a1, foot - 1) === '^' || tileAt(a2, foot - 1) === '^') want = true;   // spikes
      // under a low ceiling the hop is short, so leave it late and land on the enemy instead
      let low = false;
      for (let tx = a1 - 1; tx <= a1 + 2; tx++) for (let ty = foot - 5; ty <= foot - 3; ty++) if (solidAt(tx, ty)) low = true;
      const reach = low ? 10 : 26;
      for (const e of enemies) {
        if (!e.alive || !e.active) continue;
        const dx = e.x - (p.x + p.w);
        if (dx > -6 && dx < reach && Math.abs(e.y + e.h - (p.y + p.h)) < 30) { want = true; break; }
      }
      if (p.vx === 0 && stateTimer > 30) want = true;                           // stuck
      if (want) jumpPressed = true;
    } else if (p.vy > 0) {
      // coming down: do not drift past solid footing into a gap
      const below = tx => { for (let ty = Math.floor((p.y + p.h) / T); ty < ROWS; ty++) if (solidAt(tx, ty)) return true; return false; };
      if (below(Math.floor((p.x + 6) / T)) && !below(Math.floor((p.x + 30) / T))) { keys.right = false; keys.left = p.vx > 0.3; }
    }
    keys.jump = want || (!p.onGround && p.vy < 0);
  }

  // ---------------------------------------------------------------- update
  function hitBlock(tx, ty) {
    const c = map[ty][tx];
    const key = tx + ',' + ty;
    if (c === '?') {
      map[ty][tx] = 'U'; bumps[key] = 10;
      particles.push({ type: 'coin', x: tx * T + 4, y: ty * T - 12, vx: 0, vy: -4.5, life: 26 });
      gainCoin();
      popups.push({ x: tx * T + 2, y: ty * T - 20, text: '200', life: 40 });
    } else if (c === 'Z' || c === 'H' || c === 'I') {
      map[ty][tx] = 'U'; bumps[key] = 10;
      items.push({ type: c === 'Z' ? 'shield' : 'life', x: tx * T + 3, y: ty * T, w: 10, h: 10, emerge: 16, life: 900, got: false });
      sfx.appear();
    } else if (c === 'B') {
      map[ty][tx] = ' ';
      sfx.brick(); addScore(50);
      for (let i = 0; i < 4; i++) {
        particles.push({ type: 'debris', x: tx * T + (i % 2) * 8 + 4, y: ty * T + Math.floor(i / 2) * 8 + 4, vx: (i % 2 ? 1.4 : -1.4), vy: i < 2 ? -5 : -3.5, life: 70 });
      }
    } else {
      sfx.bump();
    }
    // knock out walkers standing on the block (the only way to beat a spiker without a shield)
    for (const e of enemies) {
      if (e.alive && e.type !== 'orb' && e.type !== 'flutter' && e.x + e.w > tx * T && e.x < tx * T + T && Math.abs(e.y + e.h - ty * T) < 3) knockOut(e);
    }
    // collect a coin sitting on top
    if (tileAt(tx, ty - 1) === 'o') { map[ty - 1][tx] = ' '; gainCoin(); }
  }

  function updatePlats() {
    for (const pl of plats) {
      const ox = pl.x;
      pl.x += pl.vx;
      if (pl.x <= pl.x0) { pl.x = pl.x0; pl.vx = Math.abs(pl.vx); }
      else if (pl.x >= pl.x1) { pl.x = pl.x1; pl.vx = -Math.abs(pl.vx); }
      if (state === 'play' && player.ride === pl) player.x += pl.x - ox;
    }
  }

  function updatePlayer() {
    const p = player;
    if (p.inv > 0) p.inv--;
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
    // speed cap: the bleed-off must beat the acceleration, or holding a direction speeds up forever
    if (Math.abs(p.vx) > max) p.vx = Math.sign(p.vx) * Math.max(max, Math.abs(p.vx) - 0.3);

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
    if (boss && !boss.gone) {                       // the arena wall cannot be hopped over
      const lim = (ARENA + 15) * T - p.w;
      if (p.x > lim) { p.x = lim; if (p.vx > 0) p.vx = 0; }
    }
    const hit = moveY(p);
    if (hit) hitBlock(hit.tx, hit.ty);

    // moving platforms: one-way, landed on from above
    p.ride = null;
    if (!p.onGround && p.vy >= 0) {
      const feet = p.y + p.h;
      for (const pl of plats) {
        if (p.x + p.w > pl.x && p.x < pl.x + pl.w && feet >= pl.y && feet - p.vy <= pl.y + 1.01) {
          p.y = pl.y - p.h; p.vy = 0; p.onGround = true; p.ride = pl;
          break;
        }
      }
    }
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
          hurt(null);
          if (state !== 'play') return;
        } else if (c === 'F') {
          startClear(false); return;
        }
      }
    }
    if (p.y > ROWS * T + 16) { kill(); return; }

    if (!demo) {
      for (const cp of level.checkpoints) {
        if (cp > checkpoint && p.x >= cp * T) {
          checkpoint = cp;
          popups.push({ x: p.x - 30, y: p.y - 22, text: 'CHECKPOINT', life: 70 });
        }
      }
    }
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

      if (e.type === 'flutter') {
        e.t++;
        e.x += e.vx;
        if (e.x < e.x0 - 48) e.vx = Math.abs(e.vx); else if (e.x > e.x0 + 48) e.vx = -Math.abs(e.vx);
        e.y = e.baseY + Math.sin(e.t * 0.07) * 12;
      } else if (e.type === 'orb') {
        e.t++;
        e.y = e.baseY + Math.sin(e.t * 0.045) * e.amp;
      } else {
        e.vy = Math.min(6, e.vy + 0.4);
        if (moveX(e)) e.vx *= -1;
        moveY(e);
        if (e.onGround) {
          const aheadX = e.vx > 0 ? Math.floor((e.x + e.w) / T) : Math.floor((e.x - 1) / T);
          if (!solidAt(aheadX, Math.floor((e.y + e.h) / T))) e.vx *= -1;
        }
        if (e.y > ROWS * T) { e.alive = false; e.dead = 0; continue; }
      }

      if (state === 'play' && overlap(p, e)) {
        const stomp = p.vy > 0 && p.y + p.h - e.y < 9;
        if (stomp && (e.type === 'gloop' || e.type === 'flutter')) {
          e.alive = false;
          combo++;
          if (e.type === 'flutter') { e.flip = true; e.vy = 0; e.dead = 60; addScore(200, e.x, e.y - 6); }
          else { e.dead = 30; addScore(Math.min(1600, 100 * Math.pow(2, combo - 1)), e.x, e.y - 6); }
          sfx.stomp();
          p.vy = keys.jump ? -6.2 : -3.8;
        } else {
          hurt(e);
        }
      }
    }
  }

  function updateItems() {
    const p = player;
    for (const it of items) {
      if (it.emerge > 0) { it.y -= 1; it.emerge--; }
      else {
        it.life--;
        const dx = p.x + 1 - it.x, dy = p.y + 2 - it.y, d = Math.hypot(dx, dy);
        if (d > 1) { it.x += dx / d * 0.9; it.y += dy / d * 0.9; }
      }
      if (state === 'play' && it.emerge < 8 && overlap(p, it)) {
        it.got = true;
        if (it.type === 'shield') {
          addScore(p.shield ? 1000 : 500, it.x, it.y - 8);
          p.shield = true; sfx.shield();
        } else gainLife();
      }
    }
    items = items.filter(it => !it.got && it.life > 0);
  }

  // KING GLOOP: hops around the arena, every third jump is a slam with a ground shockwave
  function bossHit() {
    const b = boss;
    if (!b || b.hp <= 0 || state !== 'play') return;
    b.hp--; b.inv = 70; shake = 8;
    sfx.bossHit();
    if (b.hp <= 0) {
      waves = [];
      addScore(5000, b.x + 4, b.y - 16);
      b.defeated = true; b.dying = true; b.dead = 0; b.vy = -4; b.vx = 0;
      startClear(true);
    } else {
      addScore(500, b.x + 8, b.y - 10);
    }
  }
  function updateBoss() {
    const b = boss, p = player;
    if (!b || b.defeated) return;
    if (!b.active) {
      if (state === 'play' && p.x > (ARENA + 2) * T) {
        b.active = true;
        for (let y = 0; y <= 11; y++) map[y][ARENA] = 'S';       // the gate slams shut
        sfx.gate(); shake = 8; musicFast = true;
      }
      return;
    }
    if (b.inv > 0) b.inv--;
    if (b.squash > 0) b.squash--;
    const gy = GROUND_Y * T - b.h;
    const rage = 3 - b.hp;                                       // 0, 1, 2
    if (b.onGround) {
      if (--b.wait <= 0) {
        b.hops++;
        b.slam = b.hops % 3 === 0;
        let dir = (p.x + p.w / 2) < (b.x + b.w / 2) ? -1 : 1;
        if (b.x <= b.minX + 4) dir = 1; else if (b.x >= b.maxX - 4) dir = -1;
        const sp = 1.1 + rage * 0.45;
        b.vy = b.slam ? -7.6 : -4.8;
        b.vx = dir * (b.slam ? sp * 0.5 : sp);
        b.onGround = false;
      }
    } else {
      b.vy += (b.slam && b.vy > 0) ? 0.55 : 0.3;
      b.x += b.vx;
      if (b.x < b.minX) { b.x = b.minX; b.vx = Math.abs(b.vx); }
      else if (b.x > b.maxX) { b.x = b.maxX; b.vx = -Math.abs(b.vx); }
      b.y += b.vy;
      if (b.y >= gy) {
        b.y = gy; b.vy = 0; b.vx = 0; b.onGround = true; b.squash = 8;
        b.wait = b.slam ? 75 - rage * 10 : 40 - rage * 8;    // winded after a slam: the opening to stomp
        if (b.slam) {
          const wy = GROUND_Y * T - 8;
          waves.push({ x: b.x - 10, y: wy, w: 10, h: 8, vx: -2.2 });
          waves.push({ x: b.x + b.w, y: wy, w: 10, h: 8, vx: 2.2 });
          sfx.slam(); shake = 12;
        }
      }
    }
    for (const w of waves) {
      w.x += w.vx;
      if (w.x < (ARENA + 1) * T || w.x + w.w > (ARENA + 15) * T) w.gone = true;
      else if (state === 'play' && overlap(p, w)) hurt(null);
    }
    waves = waves.filter(w => !w.gone);

    if (state === 'play' && b.inv === 0 && overlap(p, b)) {
      if (p.vy > 0 && p.y + p.h - b.y < 12) {
        p.vy = keys.jump ? -6.8 : -5.2;
        bossHit();
      } else hurt(null);
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
    cam = Math.max(cam, Math.min(target, camMax()));
    if (boss && boss.active && !boss.gone) cam = Math.min(ARENA * T, cam + 2);   // lock onto the arena
    cam = Math.max(0, cam);
  }

  function startClear(fromBoss) {
    if (state !== 'play') return;
    setState('clear');
    stopMusic(); sfx.win();
    player.vx = 0; player.vy = 0; player.inv = 0; player.ride = null;
    player.face = 1;
    if (!fromBoss) {
      player.x = POLE_X * T + 7 - player.w;
      // height bonus: higher grab, more points
      const bonus = player.y < 5 * T ? 5000 : player.y < 8 * T ? 2000 : 800;
      addScore(bonus, player.x - 10, player.y - 8);
    }
  }

  function updateClear() {
    const p = player, b = boss;
    if (b && b.dying) {
      b.dead++;
      if (b.dead > 30) { b.vy += 0.25; b.y += b.vy; }
      if (b.dead % 6 === 0) {
        for (let i = 0; i < 3; i++) particles.push({ type: 'spark', x: b.x + Math.random() * b.w, y: b.y + Math.random() * b.h, vx: Math.random() * 3 - 1.5, vy: -Math.random() * 2.5, life: 20 });
      }
      if (b.dead > 110) {
        b.dying = false; b.gone = true;
        for (let y = 0; y <= 11; y++) {                           // the far wall crumbles
          map[y][ARENA + 15] = ' ';
          if (y >= 5) particles.push({ type: 'debris', x: (ARENA + 15) * T + 4, y: y * T + 4, vx: (y % 2 ? 1.4 : -1.4), vy: -3 - (y % 3), life: 70 });
        }
        sfx.brick();
      }
    }
    if (!p.hidden) {
      if (stateTimer < 20) return;
      if (p.y < GROUND_Y * T - p.h) {
        p.y = Math.min(GROUND_Y * T - p.h, p.y + 2.2);
      } else if (!(b && b.dying)) {
        p.y = GROUND_Y * T - p.h;
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
      if (rocket.y < -260 && !clearDone) { clearDone = true; clearTimer = 0; }
    }
  }

  function nextZone() {
    if (zone < ZONES.length - 1) {
      const sh = player.shield;
      zone++; checkpoint = 3;
      resetLevel();
      player.shield = sh;
      setState('ready');
    } else {
      score += lives * 1000;                                     // spare lives bonus
      setState('ending');
      sfx.win();
    }
  }

  function update() {
    frame++; stateTimer++;
    if (shake > 0) shake--;
    switch (state) {
      case 'title':
        cam = Math.min(stateTimer * 0.5, COLS * T - W);
        if (mode === 'attract' && stateTimer > 240) startDemo();
        break;
      case 'ready':
        if (stateTimer > 130 || (startPressed && stateTimer > 20)) { setState('play'); startMusic(); }
        break;
      case 'play':
        if (demo) {
          if (++demoTimer > 900) { toTitle(); break; }
          botInput();
        } else if (startPressed) { setState('paused'); stopMusic(); sfx.pause(); break; }
        updatePlats();
        updatePlayer();
        if (state === 'play') updateEnemies();
        if (state === 'play') updateBoss();
        if (state === 'play') updateItems();
        updateCamera();
        if (state === 'play' && ++timeTick >= 24) {
          timeTick = 0; time--;
          if (time === 100 && !hurryPlayed) { hurryPlayed = true; musicFast = true; popups.push({ x: player.x - 20, y: player.y - 20, text: 'HURRY!', life: 90 }); }
          if (time <= 0) { time = 0; kill(); }
        }
        break;
      case 'paused':
        if (startPressed) { setState('play'); startMusic(); sfx.pause(); }
        break;
      case 'dying':
        if (stateTimer > 28) { player.vy += 0.3; player.y += player.vy; }
        updatePlats();
        updateEnemies();
        updateBoss();
        if (demo) { if (stateTimer > 100) toTitle(); break; }
        if (stateTimer > 170) {
          lives--;
          if (lives > 0) { resetLevel(); setState('ready'); }
          else setState('over');
        }
        break;
      case 'over':
        if (stateTimer >= 120) report();
        break;
      case 'clear':
        updateClear();
        updatePlats();
        updateEnemies();
        updateCamera();
        if (demo) { if (stateTimer > 90) toTitle(); break; }
        if (clearDone && (++clearTimer > 150 || (startPressed && clearTimer > 30))) nextZone();
        break;
      case 'ending':
        if (stateTimer >= 240) report();
        break;
    }
    if (state !== 'paused' && state !== 'done') updateParticles();
    jumpPressed = false;
    startPressed = false;
  }

  // ---------------------------------------------------------------- drawing
  const FONT = AK.FONT || '"Press Start 2P", monospace';
  function text(str, x, y, color = '#fff', align = 'left', size = 8) {
    ctx.font = size + 'px ' + FONT;
    ctx.textAlign = align; ctx.textBaseline = 'top';
    ctx.fillStyle = '#000'; ctx.fillText(str, x + 1, y + 1);
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const hash = n => (Math.imul((n | 0) + 7919, 2654435761) >>> 0) >>> 8;

  function gradient(stops) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  }
  const SKIES = [
    gradient([[0, '#1b0f3d'], [0.5, '#4f2580'], [0.8, '#c9507e'], [1, '#ffb36b']]),
    gradient([[0, '#03061c'], [0.45, '#0a1446'], [0.8, '#1b2a78'], [1, '#3a2a7a']]),
    gradient([[0, '#2a0a1e'], [0.4, '#7a1a2a'], [0.75, '#e0502a'], [1, '#ffc04d']]),
  ];
  const STARS = Array.from({ length: 46 }, (_, i) => ({ x: (i * 97) % 512, y: (i * 53) % 110, s: i % 7 === 0 ? 2 : 1, p: i }));
  const CLOUDS = [[30, 40, 1], [170, 26, 0.8], [300, 56, 1.2], [420, 34, 0.9]];

  function drawStars(c, maxY, colA, colB) {
    for (const s of STARS) {
      if (s.y > maxY) continue;
      const x = ((s.x - c * 0.05) % 512 + 512) % 512;
      if (x > W) continue;
      if ((frame + s.p * 13) % 120 < 8) continue;
      rect(x, s.y, s.s, s.s, s.s > 1 ? colA : colB);
    }
  }

  function drawTwilight(c) {
    rect(0, 0, W, H, SKIES[0]);
    drawStars(c, 200, '#fff6c8', '#d8c8ff');
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

  function drawCity(c, par, bw, base, minH, varH, col, wins) {
    const off = c * par, i0 = Math.floor(off / bw), n = Math.ceil(W / bw) + 1;
    for (let i = i0; i <= i0 + n; i++) {
      const hs = hash(i * 3 + bw);
      const hgt = minH + hs % varH, wdt = bw - 2 - (hs >> 5) % 6;
      const x = Math.round(i * bw - off);
      rect(x, base - hgt, wdt, hgt + 40, col);
      if (hs & 1) rect(x + (wdt >> 1), base - hgt - 6, 1, 6, col);
      if (hs & 2) rect(x + 2, base - hgt - 3, wdt - 6, 3, col);
      for (let wy = 4; wy < hgt - 4; wy += 7) {
        for (let wx = 3; wx < wdt - 4; wx += 5) {
          const k = hash(i * 131 + wy * 17 + wx);
          if (k % 5 < 2) rect(x + wx, base - hgt + wy, 2, 3, wins[k % wins.length]);
        }
      }
    }
  }
  function drawNeonNight(c) {
    rect(0, 0, W, H, SKIES[1]);
    drawStars(c, 200, '#ffffff', '#9ab8ff');
    // big moon
    const mx = Math.round(186 - c * 0.02), my = 60, mr = 28;
    ctx.fillStyle = 'rgba(180, 210, 255, 0.10)';
    ctx.beginPath(); ctx.arc(mx, my, mr + 8, 0, Math.PI * 2); ctx.fill();
    for (let y = -mr; y < mr; y++) {
      const hw = Math.sqrt(mr * mr - y * y);
      rect(Math.round(mx - hw), my + y, Math.round(hw * 2), 1, y < -mr * 0.2 ? '#fbf7dc' : '#e9e3c0');
    }
    rect(mx - 12, my - 10, 7, 5, '#cfc8a4'); rect(mx + 6, my + 2, 9, 6, '#cfc8a4');
    rect(mx - 4, my + 12, 5, 4, '#cfc8a4'); rect(mx + 10, my - 16, 4, 3, '#cfc8a4');
    // city silhouettes
    drawCity(c, 0.15, 22, 196, 40, 58, '#141d52', ['#ffd23f', '#ff3ea5', '#ffd23f']);
    drawCity(c, 0.4, 34, 204, 18, 34, '#090e2e', ['#2de2e6', '#ff3ea5', '#3ee6c8']);
  }

  function drawEmberDawn(c) {
    rect(0, 0, W, H, SKIES[2]);
    drawStars(c, 50, '#ffe0c0', '#e0a0a0');
    // rising sun on the horizon
    const sx = Math.round(120 - c * 0.02), sy = 186, sr = 46;
    ctx.fillStyle = 'rgba(255, 220, 120, 0.18)';
    ctx.beginPath(); ctx.arc(sx, sy, sr + 12, 0, Math.PI * 2); ctx.fill();
    for (let y = -sr; y < 10; y++) {
      const hw = Math.sqrt(sr * sr - y * y);
      rect(Math.round(sx - hw), sy + y, Math.round(hw * 2), 1, y < -sr * 0.5 ? '#fff3a0' : y < -sr * 0.15 ? '#ffd23f' : '#ffa04d');
    }
    // smoke bands
    for (const [cx, cy, s] of CLOUDS) {
      const x = ((cx - c * 0.2) % 560 + 560) % 560 - 60;
      ctx.fillStyle = 'rgba(60, 10, 30, 0.4)';
      ctx.fillRect(x, cy + 30, 52 * s, 5); ctx.fillRect(x + 10 * s, cy + 26, 28 * s, 5);
    }
    // jagged far ridge
    ctx.fillStyle = '#5a1424';
    for (let x = 0; x < W; x += 2) {
      const wx = x + c * 0.15;
      const h = 30 + 30 * Math.abs(Math.sin(wx * 0.021)) + 12 * Math.abs(Math.sin(wx * 0.057 + 1));
      ctx.fillRect(x, 196 - h, 2, h + 30);
    }
    // near crags
    ctx.fillStyle = '#2c0918';
    for (let x = 0; x < W; x += 2) {
      const wx = x + c * 0.4;
      const h = 14 + 16 * Math.abs(Math.sin(wx * 0.034 + 2)) + 5 * Math.sin(wx * 0.11);
      ctx.fillRect(x, 202 - h, 2, h + 30);
    }
    // drifting embers
    for (let i = 0; i < 18; i++) {
      const x = ((i * 61 - c * 0.3 + Math.sin((frame + i * 40) * 0.03) * 6) % W + W) % W;
      const y = H - ((frame * (0.3 + (i % 4) * 0.12) + i * 47) % (H + 10));
      rect(Math.round(x), Math.round(y), i % 5 === 0 ? 2 : 1, i % 5 === 0 ? 2 : 1, i % 3 ? '#ffb04d' : '#ffe890');
    }
  }
  function drawBackground(c) {
    if (zone === 1) drawNeonNight(c); else if (zone === 2) drawEmberDawn(c); else drawTwilight(c);
  }

  function drawStar(cx, cy, col) {
    rect(cx - 1, cy - 4, 2, 8, col); rect(cx - 4, cy - 1, 8, 2, col); rect(cx - 2, cy - 2, 4, 4, col);
  }
  function drawBolt(x, y, col) {           // 8x10 lightning bolt
    rect(x + 4, y, 3, 2, col); rect(x + 3, y + 2, 3, 2, col); rect(x + 1, y + 4, 6, 2, col);
    rect(x + 3, y + 6, 3, 2, col); rect(x + 2, y + 8, 2, 2, col);
  }
  function drawHeart(x, y, col) {          // 9x8 heart
    rect(x + 1, y, 3, 1, col); rect(x + 5, y, 3, 1, col);
    rect(x, y + 1, 9, 3, col); rect(x + 1, y + 4, 7, 1, col);
    rect(x + 2, y + 5, 5, 1, col); rect(x + 3, y + 6, 3, 1, col); rect(x + 4, y + 7, 1, 1, col);
  }
  function drawBlockFrame(x, y, edge, face, hi) {
    rect(x, y, T, T, edge);
    rect(x + 1, y + 1, 14, 14, face);
    rect(x + 1, y + 1, 14, 1, hi);
    rect(x + 2, y + 2, 1, 1, edge); rect(x + 13, y + 2, 1, 1, edge);
    rect(x + 2, y + 13, 1, 1, edge); rect(x + 13, y + 13, 1, 1, edge);
  }

  function drawTile(ch, x, y, tx, ty) {
    switch (ch) {
      case '#': {
        rect(x, y, T, T, PAL.dirt);
        for (let k = 0; k < 3; k++) {
          const px = (tx * 37 + ty * 17 + k * 53) % 13 + 1, py = (tx * 11 + ty * 29 + k * 41) % 10 + 5;
          rect(x + px, y + py, 2, 2, PAL.speck);
        }
        if (tileAt(tx, ty - 1) !== '#') {
          rect(x, y, T, 5, PAL.top);
          rect(x, y, T, 1, PAL.topHi);
          for (let i = 0; i < 16; i += 4) rect(x + i + ((tx + i) % 3), y + 5, 2, 2, PAL.topLo);
        }
        break;
      }
      case 'S':
        rect(x, y, T, T, PAL.stone);
        rect(x, y, T, 2, PAL.stoneHi); rect(x, y, 2, T, PAL.stoneHi);
        rect(x, y + 14, T, 2, PAL.stoneLo); rect(x + 14, y, 2, T, PAL.stoneLo);
        rect(x + 6, y + 6, 4, 4, PAL.stoneMid);
        break;
      case 'B':
        rect(x, y, T, T, '#c8553d');
        rect(x, y, T, 1, '#ff8a6a');
        rect(x, y + 7, T, 1, '#5a1f16'); rect(x, y + 15, T, 1, '#5a1f16');
        rect(x + 7, y, 1, 7, '#5a1f16'); rect(x + 3, y + 8, 1, 7, '#5a1f16'); rect(x + 11, y + 8, 1, 7, '#5a1f16');
        break;
      case '?': {
        const glow = Math.sin(frame * 0.1 + tx) * 0.5 + 0.5;
        drawBlockFrame(x, y, '#a8620c', glow > 0.5 ? '#ffc94a' : '#ffb627', '#fff0a8');
        drawStar(x + 8, y + 8, '#fff7d6');
        break;
      }
      case 'Z': {
        const glow = Math.sin(frame * 0.12 + tx) > 0;
        drawBlockFrame(x, y, '#0c5a66', glow ? '#2de2e6' : '#22c4cc', '#d0fdff');
        drawBolt(x + 4, y + 4, '#0b2a40');
        drawBolt(x + 4, y + 3, '#ffffff');
        break;
      }
      case 'H': {
        const glow = Math.sin(frame * 0.12 + tx) > 0;
        drawBlockFrame(x, y, '#7a1250', glow ? '#ff7ac0' : '#ff5aae', '#ffd0ea');
        drawHeart(x + 4, y + 5, '#7a1250');
        drawHeart(x + 3, y + 4, '#ffffff');
        break;
      }
      case 'I':
        if ((frame + tx * 7) % 200 < 6) rect(x + 7, y + 7, 2, 2, '#fff6c8');   // a faint glint gives it away
        break;
      case 'U':
        drawBlockFrame(x, y, '#4a3524', '#8b6b4a', '#8b6b4a');
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

  function drawRocketAt(x, y, flame, occupied) {
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
    rect(x + 10, y - 28, 4, 4, occupied ? '#3ee6c8' : '#2de2e6');
    rect(x + 10, y - 28, 1, 1, '#ffffff');
    if (flame && (frame >> 1) % 2) {
      rect(x + 8, y - 2, 8, 6, '#ffd23f'); rect(x + 10, y + 4, 4, 5, '#ff7a3d');
    }
  }
  function drawRocket(c) {
    const x = ROCKET_X - c, base = GROUND_Y * T;
    if (x < -40 || x > W + 40) return;
    // launch pad
    rect(x - 4, base - 4, 32, 4, '#5c4b88');
    rect(x - 2, base - 30, 3, 26, '#43356a');
    rect(x - 2, base - 30, 8, 2, '#43356a');
    drawRocketAt(x, base - 4 + Math.round(rocket.y), rocket.launched, player.hidden);
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
  function drawShieldRing(px, py) {
    ctx.fillStyle = 'rgba(45, 226, 230, 0.14)';
    ctx.beginPath(); ctx.arc(px + 6, py + 6, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = (frame >> 2) % 2 ? '#2de2e6' : '#bafff2'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px + 6, py + 6, 12, 0, Math.PI * 2); ctx.stroke();
    const ang = frame * 0.12;
    rect(Math.round(px + 6 + Math.cos(ang) * 12) - 1, Math.round(py + 6 + Math.sin(ang) * 12) - 1, 2, 2, '#ffffff');
    rect(Math.round(px + 6 - Math.cos(ang) * 12) - 1, Math.round(py + 6 - Math.sin(ang) * 12) - 1, 2, 2, '#ffffff');
  }

  const GLOOP_COL = { body: '#c03bff', hi: '#f0b0ff', dark: '#7a1fb0', flat: '#e08aff' };
  const SPIKER_COL = { body: '#2fb86a', hi: '#b0ffd0', dark: '#157a40', flat: '#7ae0a0' };
  function drawWalker(e, c) {
    const x = Math.round(e.x - c), y = Math.round(e.y);
    if (x < -20 || x > W + 20) return;
    const K = e.type === 'spiker' ? SPIKER_COL : GLOOP_COL;
    if (!e.alive && !e.flip) {
      if (e.dead <= 0) return;
      rect(x, y + 8, 14, 4, K.body); rect(x + 2, y + 7, 10, 1, K.flat);
      rect(x + 3, y + 9, 2, 1, '#fff'); rect(x + 9, y + 9, 2, 1, '#fff');
      return;
    }
    if (e.flip && e.dead <= 0) return;
    const squish = e.alive ? Math.round(Math.sin(frame * 0.25 + e.x) * 1) : 0;
    const top = y + 1 + squish;
    ctx.save();
    if (e.flip) { ctx.translate(0, y * 2 + 12); ctx.scale(1, -1); }
    rect(x + 3, top, 8, 2, K.body);
    rect(x + 1, top + 2, 12, 2, K.body);
    rect(x, top + 4, 14, 11 - 4 - squish, K.body);
    rect(x + 3, top + 1, 3, 2, K.hi);
    rect(x, y + 10, 14, 2, K.dark);
    const look = e.vx > 0 ? 1 : 0;
    rect(x + 2, top + 4, 4, 4, '#ffffff'); rect(x + 8, top + 4, 4, 4, '#ffffff');
    rect(x + 3 + look, top + 5, 2, 2, '#1a0a2a'); rect(x + 9 + look, top + 5, 2, 2, '#1a0a2a');
    if (e.type === 'spiker') {
      // spiked shell: do not stomp
      rect(x + 1, top + 1, 12, 2, '#5a6a7a');
      for (let i = 0; i < 4; i++) {
        rect(x + 1 + i * 3, top - 1, 3, 2, '#e8e8ff');
        rect(x + 2 + i * 3, top - 3, 1, 2, '#ffffff');
      }
      rect(x + 2, top + 3, 4, 1, K.dark); rect(x + 8, top + 3, 4, 1, K.dark);   // angry brows
    }
    // feet
    const step = (frame >> 3) % 2;
    rect(x + 1 + step, y + 11, 3, 1, K.dark); rect(x + 10 - step, y + 11, 3, 1, K.dark);
    ctx.restore();
  }
  function drawFlutter(e, c) {
    const x = Math.round(e.x - c), y = Math.round(e.y);
    if (x < -20 || x > W + 20) return;
    if (!e.alive && e.dead <= 0) return;
    const flap = e.alive ? (frame >> 2) % 2 : 0;
    // wings
    if (flap) {
      rect(x - 3, y - 3, 5, 5, '#d0fdff'); rect(x + 10, y - 3, 5, 5, '#d0fdff');
      rect(x - 3, y - 3, 5, 1, '#ffffff'); rect(x + 10, y - 3, 5, 1, '#ffffff');
    } else {
      rect(x - 4, y + 3, 5, 4, '#d0fdff'); rect(x + 11, y + 3, 5, 4, '#d0fdff');
    }
    // body
    rect(x + 2, y, 8, 1, '#ffb627');
    rect(x + 1, y + 1, 10, 7, '#ffb627');
    rect(x + 2, y + 8, 8, 2, '#c97a0a');
    rect(x + 2, y + 1, 3, 1, '#fff0a8');
    rect(x + 1, y + 6, 10, 1, '#7a3d0a');
    const look = e.vx > 0 ? 1 : 0;
    if (e.alive) {
      rect(x + 2, y + 2, 3, 3, '#ffffff'); rect(x + 7, y + 2, 3, 3, '#ffffff');
      rect(x + 3 + look, y + 3, 1, 2, '#1a0a2a'); rect(x + 8 + look, y + 3, 1, 2, '#1a0a2a');
    } else {
      rect(x + 2, y + 3, 3, 1, '#1a0a2a'); rect(x + 7, y + 3, 3, 1, '#1a0a2a');
    }
    rect(x + 4, y - 2, 1, 2, '#7a3d0a'); rect(x + 7, y - 2, 1, 2, '#7a3d0a');   // feelers
  }
  function drawOrb(e, c) {
    const x = Math.round(e.x - c), y = Math.round(e.y);
    if (x < -20 || x > W + 20) return;
    // faint rail showing its path
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fillRect(x + 5, e.baseY - e.amp, 2, e.amp * 2 + 12);
    const spin = (frame >> 2) % 2;
    const sp = '#e8e8ff';
    if (spin) { rect(x + 5, y - 3, 2, 3, sp); rect(x + 5, y + 12, 2, 3, sp); rect(x - 3, y + 5, 3, 2, sp); rect(x + 12, y + 5, 3, 2, sp); }
    else { rect(x - 2, y - 2, 3, 3, sp); rect(x + 11, y - 2, 3, 3, sp); rect(x - 2, y + 11, 3, 3, sp); rect(x + 11, y + 11, 3, 3, sp); }
    rect(x + 2, y, 8, 12, '#e0304e'); rect(x, y + 2, 12, 8, '#e0304e');
    rect(x + 1, y + 1, 10, 10, '#e0304e');
    rect(x + 3, y + 3, 6, 6, '#ff7a3d');
    rect(x + 4, y + 4, 4, 4, spin ? '#ffd23f' : '#fff3a0');
    rect(x + 2, y + 2, 2, 2, '#ffb0b0');
  }
  function drawEnemy(e, c) {
    if (e.type === 'flutter') drawFlutter(e, c);
    else if (e.type === 'orb') drawOrb(e, c);
    else drawWalker(e, c);
  }

  function drawPlats(c) {
    for (const pl of plats) {
      const x = Math.round(pl.x - c), y = pl.y;
      if (x < -50 || x > W + 10) continue;
      const blink = (frame >> 4) % 2, burn = (frame >> 1) % 2;
      rect(x, y, pl.w, pl.h, '#5c6a9a');
      rect(x, y, pl.w, 1, '#d0d8ff');
      rect(x, y + pl.h - 1, pl.w, 1, '#2a3050');
      rect(x + 2, y + 2, 3, 2, blink ? '#2de2e6' : '#ff3ea5');
      rect(x + pl.w - 5, y + 2, 3, 2, blink ? '#ff3ea5' : '#2de2e6');
      // little thruster glow underneath
      rect(x + 8, y + pl.h, 4, 2, burn ? '#ffd23f' : '#ff7a3d');
      rect(x + pl.w - 12, y + pl.h, 4, 2, burn ? '#ff7a3d' : '#ffd23f');
    }
  }
  function drawItems(c) {
    for (const it of items) {
      if (it.life < 120 && (frame >> 2) % 2) continue;
      const x = Math.round(it.x - c), y = Math.round(it.y + (it.emerge > 0 ? 0 : Math.sin(frame * 0.15) * 1.5));
      ctx.fillStyle = it.type === 'shield' ? 'rgba(45, 226, 230, 0.3)' : 'rgba(255, 62, 165, 0.3)';
      ctx.beginPath(); ctx.arc(x + 5, y + 5, 8, 0, Math.PI * 2); ctx.fill();
      if (it.type === 'shield') { drawBolt(x + 1, y + 1, '#0b2a40'); drawBolt(x + 1, y, '#d0fdff'); }
      else { drawHeart(x + 1, y + 2, '#7a1250'); drawHeart(x, y + 1, '#ff5aae'); rect(x + 1, y + 2, 2, 1, '#ffffff'); }
    }
  }

  function drawCrown(x, y, col, gem) {     // 16x8
    rect(x, y + 4, 16, 4, col);
    rect(x, y, 3, 4, col); rect(x + 6, y - 1, 4, 5, col); rect(x + 13, y, 3, 4, col);
    rect(x + 7, y + 5, 2, 2, gem); rect(x + 2, y + 5, 1, 2, gem); rect(x + 13, y + 5, 1, 2, gem);
  }
  function drawCrownIcon(x, y, col) {      // 10x6
    rect(x, y + 3, 10, 3, col);
    rect(x, y, 2, 3, col); rect(x + 4, y, 2, 3, col); rect(x + 8, y, 2, 3, col);
  }
  function drawBoss(c) {
    const b = boss;
    if (!b || b.gone) return;
    const x = Math.round(b.x - c), y = Math.round(b.y);
    if (x < -50 || x > W + 10) return;
    const flash = (b.inv > 0 || b.dying) && (frame >> 2) % 2;
    const col = flash ? '#ffffff' : '#9b2bd6', dark = flash ? '#e0c0ff' : '#5a1490', hi = '#e9a8ff';
    const sq = b.squash > 0 ? 4 : 0;
    const t = y + sq, bh = 32 - sq;
    // shadow on the ground while airborne
    if (!b.onGround && !b.dying) { ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; ctx.fillRect(x + 4, GROUND_Y * T - 2, 32, 3); }
    // body
    rect(x + 9, t, 22, 4, col);
    rect(x + 4, t + 4, 32, 5, col);
    rect(x, t + 9, 40, bh - 9, col);
    rect(x + 10, t + 2, 8, 3, hi);
    rect(x, y + 28, 40, 4, dark);
    // eyes
    const look = player.x + 6 > b.x + 20 ? 3 : 0;
    rect(x + 6, t + 12, 11, 9, '#ffffff'); rect(x + 23, t + 12, 11, 9, '#ffffff');
    if (b.dying) {
      rect(x + 8, t + 16, 7, 2, '#1a0a2a'); rect(x + 25, t + 16, 7, 2, '#1a0a2a');
    } else {
      rect(x + 8 + look, t + 15, 5, 5, '#1a0a2a'); rect(x + 25 + look, t + 15, 5, 5, '#1a0a2a');
      rect(x + 9 + look, t + 16, 2, 2, '#ff5e7e'); rect(x + 26 + look, t + 16, 2, 2, '#ff5e7e');
    }
    // heavy brows
    rect(x + 5, t + 10, 12, 2, dark); rect(x + 23, t + 10, 12, 2, dark);
    rect(x + 14, t + 12, 3, 1, dark); rect(x + 23, t + 12, 3, 1, dark);
    // mouth with fangs
    rect(x + 13, y + 23, 14, 3, '#1a0a2a');
    rect(x + 15, y + 23, 2, 2, '#ffffff'); rect(x + 23, y + 23, 2, 2, '#ffffff');
    // feet
    const step = b.onGround ? 0 : 2;
    rect(x + 3 - step, y + 30, 8, 2, dark); rect(x + 29 + step, y + 30, 8, 2, dark);
    // crown
    drawCrown(x + 12, t - 7, '#ffd23f', '#ff3ea5');
    rect(x + 12, t - 3, 16, 1, '#c98f00');
  }
  function drawWaves(c) {
    for (const w of waves) {
      const x = Math.round(w.x - c), y = w.y, f = (frame >> 1) % 2;
      rect(x, y + 4, 10, 4, '#ffd23f');
      rect(x + 1, y + (f ? 0 : 2), 3, 6, '#ffffff');
      rect(x + 6, y + (f ? 2 : 0), 3, 6, '#fff3a0');
      rect(x + 3, y + 5, 4, 3, '#ff7a3d');
    }
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
    if (boss && boss.active && !boss.gone) {
      // KING GLOOP health: three crowns
      for (let i = 0; i < 3; i++) {
        drawCrownIcon(W / 2 - 20 + i * 14 + 1, 33, '#000000');
        drawCrownIcon(W / 2 - 20 + i * 14, 32, i < boss.hp ? '#ffd23f' : '#5a4a6a');
      }
    }
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(11, 6, 20, 0.82)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#ff3ea5'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  function drawEnding() {
    rect(0, 0, W, H, '#0b0614');
    for (const s of STARS) {
      const y = (s.y * 2 + frame * (s.s > 1 ? 1.5 : 0.8)) % H;
      rect(s.x % W, y, s.s, s.s > 1 ? 4 : 2, s.s > 1 ? '#fff6c8' : '#d8c8ff');
    }
    for (let i = 0; i < 7; i++) {
      const a = frame * 0.03 + i * 0.9;
      drawStar(Math.round(W / 2 + Math.cos(a) * 96), Math.round(124 + Math.sin(a) * 24), i % 2 ? '#ffe066' : '#2de2e6');
    }
    const ry = 156 + Math.round(Math.sin(frame * 0.08) * 3);
    drawRocketAt(W / 2 - 12, ry, true, true);
    text('YOU SAVED', W / 2, 26, '#ffd23f', 'center', 16);
    text('THE STARS!', W / 2, 48, '#ff3ea5', 'center', 16);
    text('KING GLOOP IS NO MORE', W / 2, 76, '#2de2e6', 'center', 8);
    text('FINAL SCORE', W / 2, 180, '#a99cc8', 'center', 8);
    text(pad(score, 6), W / 2, 194, '#ffffff', 'center', 16);
  }

  function draw() {
    const st = state === 'done' ? finalScreen : state;
    if (st === 'ready') {
      rect(0, 0, W, H, '#0b0614');
      text('STAR HOPPER', W / 2, 62, '#ff3ea5', 'center', 16);
      text('ZONE ' + (zone + 1) + ' - ' + ZONES[zone].name, W / 2, 92, '#2de2e6', 'center', 8);
      drawPip(W / 2 - 26, 122, 1, 0, false, false);
      text('x ' + lives, W / 2 - 4, 126, '#ffffff', 'left', 8);
      if (ZONES[zone].boss) text('BEWARE KING GLOOP', W / 2, 148, '#ff5e7e', 'center', 8);
      if ((frame >> 4) % 2) text('GET READY!', W / 2, 168, '#ffd23f', 'center', 8);
      drawHUD();
      return;
    }
    if (st === 'ending') { drawEnding(); return; }

    const c = Math.round(cam);
    const sy = shake > 0 ? ((frame & 2) ? 1 : -1) : 0;
    drawBackground(c);
    if (sy) ctx.translate(0, sy);
    drawTiles(c);
    drawRocket(c);
    drawPlats(c);
    for (const e of enemies) if (e.active || st === 'title') drawEnemy(e, c);
    drawBoss(c);
    drawWaves(c);
    drawItems(c);
    if (st !== 'title' && !player.hidden && !(player.inv > 0 && (frame >> 1) % 2)) {
      const airborne = !player.onGround && st !== 'dying';
      const px = Math.round(player.x - c), py = Math.round(player.y);
      drawPip(px, py, player.face, player.anim, airborne, st === 'dying');
      if (player.shield) drawShieldRing(px, py);
    }
    drawParticles(c);
    if (sy) ctx.translate(0, -sy);

    if (st === 'title') {
      panel(28, 34, 200, 150);
      text('STAR', W / 2 + 2, 48, '#7a1250', 'center', 24);
      text('STAR', W / 2, 46, '#ffd23f', 'center', 24);
      text('HOPPER', W / 2 + 2, 76, '#7a1250', 'center', 16);
      text('HOPPER', W / 2, 74, '#ff3ea5', 'center', 16);
      text('A PIP ADVENTURE', W / 2, 100, '#2de2e6', 'center', 8);
      if ((frame >> 5) % 2) text('INSERT COIN', W / 2, 126, '#ffffff', 'center', 8);
      text('PRESS START', W / 2, 142, '#a99cc8', 'center', 8);
      text('HI ' + pad(AK.scores.top(ID), 6), W / 2, 164, '#ffd23f', 'center', 8);
      text('© 2026 AKARCADE', W / 2, 206, '#d8c8ff', 'center', 8);
      return;
    }

    drawHUD();
    if (demo) {
      if ((frame >> 5) % 2) text('DEMO', W / 2, 44, '#ffffff', 'center', 8);
    } else if (st === 'paused') {
      panel(64, 90, 128, 44);
      text('PAUSED', W / 2, 104, '#ffd23f', 'center', 8);
      text('START TO RESUME', W / 2, 118, '#a99cc8', 'center', 8);
    } else if (st === 'over') {
      panel(48, 80, 160, 64);
      text('GAME OVER', W / 2, 96, '#ff3ea5', 'center', 16);
      text('SCORE ' + pad(score, 6), W / 2, 122, '#ffffff', 'center', 8);
    } else if (st === 'clear' && player.hidden && time === 0 && rocket.y < -60) {
      panel(36, 70, 184, 84);
      text(ZONES[zone].boss ? 'ALL CLEAR!' : 'ZONE CLEAR!', W / 2, 84, '#ffd23f', 'center', 16);
      text('SCORE ' + pad(score, 6), W / 2, 110, '#ffffff', 'center', 8);
      if (clearDone && !ZONES[zone].boss && (frame >> 4) % 2) text('NEXT: ' + ZONES[zone + 1].name, W / 2, 132, '#2de2e6', 'center', 8);
    } else if (st === 'play' && boss && boss.active && boss.hops < 2 && (frame >> 4) % 2) {
      text('KING GLOOP', W / 2, 46, '#ff5e7e', 'center', 8);
    }
  }

  // ---------------------------------------------------------------- host contract
  function reset(m) {
    mode = m === 'play' ? 'play' : 'attract';
    stopMusic();
    releaseAll();
    reported = false; demo = false; demoTimer = 0; frame = 0;
    if (mode === 'play') newGame();
    else toTitle();
    draw();
  }
  function tick() {
    lastTickAt = AK.audio.now();
    if (state !== 'done') update();
    draw();
  }
  function stop() {
    stopMusic();
    releaseAll();
    if (state === 'play' && !demo) setState('paused');
  }

  // Test-only helpers used by the offline harness; harmless in the real cabinet.
  function testWarp(z, toCol, noEnemies) {
    mode = 'play'; demo = false; reported = false;
    zone = Math.max(0, Math.min(ZONES.length - 1, z | 0)); checkpoint = 3;
    resetLevel();
    if (noEnemies) enemies = [];
    const col = toCol != null ? toCol : (ZONES[zone].boss ? ARENA - 3 : POLE_X - 4);
    player.x = col * T; player.y = GROUND_Y * T - player.h;
    cam = Math.max(0, Math.min(player.x - W * 0.42, camMax()));
    setState('play');
  }
  function testStompBoss() {
    if (!boss || state !== 'play') return false;
    boss.inv = 0;
    bossHit();
    return true;
  }
  function testInfo() {
    return { mode, state, demo, zone, score, lives, coins, time, checkpoint, px: player.x, py: player.y,
             vx: player.vx, vy: player.vy, onGround: player.onGround, inv: player.inv,
             ride: plats.indexOf(player.ride), plats: plats.map(p => ({ x: p.x, vx: p.vx, x0: p.x0, x1: p.x1, w: p.w, y: p.y })),
             shield: player.shield,
             boss: boss ? { x: boss.x, y: boss.y, vy: boss.vy, onGround: boss.onGround, inv: boss.inv, wait: boss.wait, slam: boss.slam } : null,
             waves: waves.map(w => ({ x: w.x, vx: w.vx })), bossActive: !!(boss && boss.active), bossHp: boss ? boss.hp : -1,
             musicOn, musicTimer: musicTimer !== null };
  }
  function testLevel(z) {
    const L = makeLevel(z);
    return { cols: L.cols, rows: L.map.map(r => r.join('')), spawns: L.spawns, plats: L.plats,
             checkpoints: L.checkpoints, pole: L.pole, arena: L.arena, rocketX: L.rocketX,
             name: ZONES[z].name, boss: ZONES[z].boss };
  }

  toTitle();

  AK.register({
    id: ID,
    title: 'STAR HOPPER',
    tag: 'PLATFORMER',
    accent: '#ff3ea5',
    canvas, reset, tick, input, stop,
    _test: { warp: testWarp, stompBoss: testStompBoss, info: testInfo, level: testLevel, zones: ZONES.length },
  });
})();
