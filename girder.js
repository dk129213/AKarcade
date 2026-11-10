// RIVET RUSH: an original single-screen ladder-and-platform climber for AKarcade.
// RIVET the worker climbs a neon construction tower to reach the OFF SWITCH of CLANK,
// a malfunctioning crane-robot that throws rolling gears down the floors.
(() => {
  'use strict';
  const AK = window.AK;
  const ID = 'rivetrush';
  const W = 256, H = 224;
  const canvas = AK.makeCanvas();
  const ctx = canvas.getContext('2d');

  // ------------------------------------------------------------ constants
  const PINK = '#ff3ea5', CYAN = '#2de2e6', YEL = '#ffd23f', ORG = '#ff7a3d', PUR = '#6c2bd9';
  const FY = [208, 176, 144, 112, 80, 48];          // walking surface of each floor
  const TOP = 5, GAP = 24, BEAM = 6;
  const SWITCH_X = 212, CLANK_EDGE = 48, GEAR_SPAWN_X = 46;
  const JUMP_V = 2.933, JUMP_G = 0.1956;            // 22px rise, 30 frames of airtime
  const CLIMB_V = 0.7;
  const TITLE_FRAMES = 240, DEMO_FRAMES = 900;
  const T = { noGears: false, demoFrames: 0 };      // test-only flags, off in normal use

  // gap side per floor: 0 none, 1 right end, -1 left end
  const gapSide = f => (f === 0 ? 0 : (f % 2 ? 1 : -1));
  const solid = f => { const s = gapSide(f); return [s < 0 ? GAP : 0, s > 0 ? W - GAP : W]; };
  const inGap = (f, x) => { const s = gapSide(f); return s > 0 ? x > W - GAP + 2 : s < 0 ? x < GAP - 2 : false; };
  // direction a gear rolls on a floor: towards its gap (bottom floor: off the left edge)
  const floorDir = f => (f === 0 ? -1 : gapSide(f));

  function mulberry32(a) {
    a >>>= 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Ladder layout for a seed. Two ladders per floor pair, never in a gap, >= 40px apart. */
  function genLayout(seed) {
    const r = mulberry32(Math.imul(seed | 0, 0x9E3779B1) + 12345);
    const ladders = [];
    for (let f = 0; f < TOP; f++) {
      let lo = 12, hi = W - 12;
      for (const ff of [f, f + 1]) {
        const s = gapSide(ff);
        if (s < 0) lo = Math.max(lo, GAP + 12);
        if (s > 0) hi = Math.min(hi, W - GAP - 12);
      }
      if (f + 1 === TOP) { lo = Math.max(lo, CLANK_EDGE + 12); hi = Math.min(hi, SWITCH_X - 16); }
      if (f === 0) lo = Math.max(lo, 32);             // keep the spawn corner clear
      lo = Math.ceil(lo / 4) * 4; hi = Math.floor(hi / 4) * 4;
      const steps = (hi - lo - 40) / 4;
      const a = Math.floor(r() * (steps + 1));
      const b = a + Math.floor(r() * (steps - a + 1));
      ladders.push({ x: lo + a * 4, from: f });
      ladders.push({ x: lo + 40 + b * 4, from: f });
    }
    const sf = r() < 0.5 ? 2 : 3;
    let sx = 0, tries = 0;
    do { sx = 44 + Math.floor(r() * 43) * 4; tries++; }
    while (tries < 20 && ladders.some(l => (l.from === sf || l.from === sf - 1) && Math.abs(l.x - sx) < 10));
    return { ladders, shield: { x: sx, floor: sf } };
  }

  // ------------------------------------------------------------ state
  let mode = 'attract', scene = 'title', sceneT = 0, frame = 0;
  let paused = false, reported = false, demoT = 0, demoCount = 0;
  let score = 0, lives = 3, level = 1, bonus = 5000, bonusT = 0, extraGiven = false;
  let gameSeed = 1, rnd = mulberry32(1);
  let ladders = [], shieldItem = null;
  let gears = [], sparks = [], parts = [], pops = [];
  const clank = { timer: 60, throwT: 0, dead: false };
  const trolley = { phase: 0, x: 128, timer: 300, warn: 0 };
  let jumpBuf = 0;
  const keys = { left: false, right: false, up: false, down: false };
  const p = { x: 16, y: FY[0], floor: 0, st: 'walk', vx: 0, vy: 0, face: 1, anim: 0, stun: 0, lad: null, jumpId: 0, shield: 0 };

  const snd = (f, d, type, v, s, dl) => AK.audio.tone(f, d, type, v, s || null, dl || 0);

  function clearKeys() { keys.left = keys.right = keys.up = keys.down = false; jumpBuf = 0; }

  function spawnPlayer() {
    p.x = 16; p.y = FY[0]; p.floor = 0; p.st = 'walk'; p.vx = 0; p.vy = 0; p.face = 1;
    p.anim = 0; p.stun = 0; p.lad = null; p.shield = 0;
    gears = []; sparks = [];
    clank.timer = 50; clank.throwT = 0;
    trolley.timer = 240 + Math.floor(rnd() * 120); trolley.warn = 0;
  }

  function startLevel(n) {
    level = n;
    const lay = genLayout(gameSeed + n * 7919);
    ladders = lay.ladders;
    shieldItem = { x: lay.shield.x, floor: lay.shield.floor, taken: false };
    bonus = 5000; bonusT = 0;
    clank.dead = false;
    parts = []; pops = [];
    spawnPlayer();
    scene = 'ready'; sceneT = 70;
  }

  function newGame(seed) {
    gameSeed = seed >>> 0;
    rnd = mulberry32(gameSeed ^ 0x9e3779b9);
    score = 0; lives = 3; extraGiven = false; reported = false; paused = false;
    clearKeys();
    startLevel(1);
  }

  function toTitle() { scene = 'title'; sceneT = 0; gears = []; sparks = []; parts = []; pops = []; clearKeys(); }

  function startDemo() {
    demoCount++;
    demoT = 0;
    newGame(1000 + demoCount * 37);
  }

  function reset(m) {
    mode = m === 'play' ? 'play' : 'attract';
    paused = false; reported = false;
    if (mode === 'play') newGame(Math.floor(Math.random() * 0x7fffffff) + 1);
    else toTitle();
    draw();
  }

  function addScore(n) {
    score += n;
    if (!extraGiven && score >= 10000) {
      extraGiven = true; lives++;
      snd(660, 0.08, 'square', 0.25); snd(880, 0.08, 'square', 0.25, null, 0.09); snd(1320, 0.16, 'square', 0.25, null, 0.18);
    }
  }
  function pop(x, y, txt, col) { pops.push({ x, y, txt, col: col || YEL, t: 45 }); }
  function burst(x, y, col, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = 0.4 + Math.random() * 1.6;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.6, t: 14 + Math.floor(Math.random() * 16), col });
    }
  }

  function kill() {
    if (scene !== 'playing') return;
    scene = 'dying'; sceneT = 80; p.shield = 0;
    snd(440, 0.5, 'sawtooth', 0.3, 60); AK.audio.noise(0.25, 0.25);
    burst(p.x, p.y - 7, ORG, 10);
  }

  // ------------------------------------------------------------ demo bot
  function bot() {
    keys.left = keys.right = keys.up = keys.down = false;
    if (scene !== 'playing') return;
    if (p.st === 'climb') {
      const danger = gears.some(g => g.st === 'ladder' && g.lad === p.lad && g.y < p.y && p.y - g.y < 40);
      keys[danger ? 'down' : 'up'] = true;
      return;
    }
    if (p.st !== 'walk' || p.stun > 0) return;
    for (const g of gears) {
      if (g.st !== 'roll' || g.floor !== p.floor) continue;
      const d = g.x - p.x;
      if (Math.abs(d) < 22 && d * g.dir < 0) {
        keys[d > 0 ? 'right' : 'left'] = true; jumpBuf = 2;
        return;
      }
    }
    if (p.floor === TOP) { keys.right = true; return; }
    let best = null, bd = 1e9;
    for (const l of ladders) {
      if (l.from !== p.floor) continue;
      let d = Math.abs(l.x - p.x);
      if (gears.some(g => g.st === 'ladder' && g.lad === l)) d += 300;
      if (d < bd) { bd = d; best = l; }
    }
    if (!best) return;
    const dx = best.x - p.x;
    if (Math.abs(dx) > 1) { keys[dx > 0 ? 'right' : 'left'] = true; return; }
    const risky = gears.some(g => (g.st === 'ladder' && g.lad === best) ||
      (g.st === 'roll' && g.floor === p.floor + 1 && Math.abs(g.x - best.x) < 36 && (best.x - g.x) * g.dir > 0));
    if (!risky) keys.up = true;
  }

  // ------------------------------------------------------------ update
  function updatePlayer() {
    if (p.shield > 0) p.shield--;
    if (p.st === 'walk') {
      if (p.stun > 0) { p.stun--; return; }
      const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (dx) {
        p.x += dx; p.face = dx; p.anim++;
        if (p.anim % 12 === 0) snd(180, 0.02, 'square', 0.06);
      }
      p.x = Math.max(p.floor === TOP ? CLANK_EDGE : 5, Math.min(W - 5, p.x));
      if (inGap(p.floor, p.x)) {
        p.st = 'fall'; p.vy = 0; p.floor--;
        snd(500, 0.3, 'triangle', 0.2, 150);
        return;
      }
      if (jumpBuf > 0) {
        jumpBuf = 0; p.st = 'jump'; p.vy = -JUMP_V; p.vx = dx; p.jumpId++;
        snd(300, 0.14, 'square', 0.2, 620);
        return;
      }
      if (keys.up || keys.down) {
        const want = keys.up ? p.floor : p.floor - 1;
        const l = ladders.find(q => q.from === want && Math.abs(q.x - p.x) <= 4);
        if (l) { p.st = 'climb'; p.lad = l; p.x = l.x; }
      }
    } else if (p.st === 'climb') {
      const l = p.lad;
      if (keys.up) {
        p.y -= CLIMB_V; p.anim++;
        if (p.y <= FY[l.from + 1]) { p.y = FY[l.from + 1]; p.floor = l.from + 1; p.st = 'walk'; p.lad = null; }
      } else if (keys.down) {
        p.y += CLIMB_V; p.anim++;
        if (p.y >= FY[l.from]) { p.y = FY[l.from]; p.floor = l.from; p.st = 'walk'; p.lad = null; }
      }
      if (p.st === 'climb' && (keys.up || keys.down) && p.anim % 10 === 0) snd(520, 0.02, 'square', 0.06);
    } else if (p.st === 'jump') {
      p.x += p.vx;
      p.x = Math.max(p.floor === TOP ? CLANK_EDGE : 5, Math.min(W - 5, p.x));
      p.vy += JUMP_G; p.y += p.vy;
      if (p.vy > 0 && p.y >= FY[p.floor]) {
        if (inGap(p.floor, p.x)) { p.st = 'fall'; p.floor--; }
        else { p.y = FY[p.floor]; p.st = 'walk'; p.vy = 0; }
      }
    } else if (p.st === 'fall') {
      p.vy = Math.min(p.vy + 0.2, 3); p.y += p.vy;
      if (p.y >= FY[p.floor]) {
        p.y = FY[p.floor]; p.st = 'walk'; p.vy = 0; p.stun = 20;
        AK.audio.noise(0.06, 0.2);
      }
    }
  }

  function gearSpeed(hot) {
    const s = Math.min(1.5, 0.9 + (level - 1) * 0.08);
    return hot ? Math.min(2, s * 1.4) : s;
  }

  function updateClank() {
    if (T.noGears || clank.dead) return;
    if (clank.throwT > 0) clank.throwT--;
    if (--clank.timer <= 0) {
      const interval = Math.max(55, 140 - (level - 1) * 14);
      clank.timer = interval + Math.floor(rnd() * 40);
      if (gears.length < 14) {
        const hot = level >= 2 && rnd() < Math.min(0.5, 0.2 + level * 0.04);
        gears.push({ x: GEAR_SPAWN_X, y: FY[TOP] - 5, floor: TOP, dir: 1, st: 'roll', hot, sp: gearSpeed(hot), rot: 0, vy: 0, lad: null, jumpId: -1 });
        clank.throwT = 14;
        snd(120, 0.08, 'sawtooth', 0.15, 70);
      }
    } else if (clank.timer === 22) clank.throwT = 36;   // wind-up
    // crane trolley and sparks
    if (trolley.warn > 0) {
      if (--trolley.warn === 0) {
        sparks.push({ x: trolley.x, y: 24, vy: 1.5 });
        snd(1400, 0.2, 'sawtooth', 0.15, 300);
      }
    } else {
      trolley.phase += 0.013;
      if (level >= 3 && --trolley.timer <= 0) {
        trolley.timer = Math.max(150, 420 - (level - 3) * 40) + Math.floor(rnd() * 120);
        trolley.warn = 40;
      }
    }
    trolley.x = Math.round(140 + 92 * Math.sin(trolley.phase));
  }

  function updateGears() {
    const ladChance = Math.min(0.5, 0.2 + (level - 1) * 0.05);
    for (let i = gears.length - 1; i >= 0; i--) {
      const g = gears[i];
      g.rot += g.sp;
      if (g.st === 'roll') {
        const px = g.x;
        g.x += g.dir * g.sp;
        if (g.floor === 0) { if (g.x < -8 || g.x > W + 8) { gears.splice(i, 1); continue; } }
        else {
          const s = gapSide(g.floor);
          if ((s > 0 && g.x > W - GAP + 5) || (s < 0 && g.x < GAP - 5)) { g.st = 'fall'; g.vy = 0; g.floor--; continue; }
          for (const l of ladders) {
            if (l.from !== g.floor - 1) continue;
            if ((px - l.x) * (g.x - l.x) <= 0 && px !== l.x && rnd() < ladChance) {
              g.st = 'ladder'; g.lad = l; g.x = l.x; g.floor--;
              break;
            }
          }
        }
      } else if (g.st === 'fall') {
        g.vy = Math.min(g.vy + 0.25, 3); g.y += g.vy;
        if (g.y >= FY[g.floor] - 5) { g.y = FY[g.floor] - 5; g.st = 'roll'; g.dir = floorDir(g.floor); AK.audio.noise(0.03, 0.08); }
      } else {
        g.y += g.sp * 0.8;
        if (g.y >= FY[g.floor] - 5) { g.y = FY[g.floor] - 5; g.st = 'roll'; g.lad = null; g.dir = floorDir(g.floor); }
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.y += s.vy;
      if (s.y > H + 6) sparks.splice(i, 1);
    }
  }

  function collide() {
    for (let i = gears.length - 1; i >= 0; i--) {
      const g = gears[i];
      const dx = Math.abs(g.x - p.x);
      const sameFloorRoll = g.st === 'roll' && g.floor === p.floor;
      if (p.st === 'jump' && sameFloorRoll && dx < 5 && p.y < g.y - 4 && g.jumpId !== p.jumpId) {
        g.jumpId = p.jumpId;
        addScore(100); pop(p.x, p.y - 22, '100');
        snd(880, 0.06, 'square', 0.2); snd(1320, 0.08, 'square', 0.2, null, 0.06);
      }
      if (p.st === 'jump' && g.st === 'roll' && !sameFloorRoll) continue;
      if (dx < 7 && g.y + 4 > p.y - 12 && g.y - 4 < p.y) {
        if (p.shield > 0) {
          gears.splice(i, 1);
          addScore(300); pop(g.x, g.y - 10, '300', CYAN);
          burst(g.x, g.y, g.hot ? '#ff5a5a' : '#c9d1e0', 12);
          AK.audio.noise(0.12, 0.25); snd(200, 0.12, 'square', 0.2, 900);
        } else { kill(); return; }
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      if (Math.abs(s.x - p.x) < 6 && s.y + 4 > p.y - 12 && s.y - 4 < p.y) {
        if (p.shield > 0) {
          sparks.splice(i, 1); addScore(300); pop(s.x, s.y - 10, '300', CYAN); burst(s.x, s.y, YEL, 10);
          AK.audio.noise(0.1, 0.2);
        } else { kill(); return; }
      }
    }
    const it = shieldItem;
    if (it && !it.taken && Math.abs(it.x - p.x) < 8 && Math.abs((FY[it.floor] - 9) - (p.y - 7)) < 10) {
      it.taken = true; p.shield = 480;
      pop(it.x, FY[it.floor] - 24, 'SHIELD', CYAN);
      snd(520, 0.08, 'triangle', 0.3); snd(780, 0.08, 'triangle', 0.3, null, 0.08); snd(1040, 0.2, 'triangle', 0.3, null, 0.16);
    }
    if (p.floor === TOP && p.st !== 'fall' && p.st !== 'climb' && Math.abs(p.x - SWITCH_X) < 8) {
      scene = 'clear'; sceneT = 210; clank.dead = true;
      gears.forEach(g => burst(g.x, g.y, '#c9d1e0', 5));
      gears = []; sparks = []; p.st = 'walk'; p.y = FY[TOP]; p.shield = 0;
      [523, 659, 784, 1047].forEach((f, i) => snd(f, 0.14, 'square', 0.25, null, i * 0.12));
      snd(300, 0.8, 'sawtooth', 0.2, 40, 0.1);
    }
  }

  function updateFx() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.x += q.vx; q.y += q.vy; q.vy += 0.08;
      if (--q.t <= 0) parts.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      const q = pops[i];
      q.y -= 0.3;
      if (--q.t <= 0) pops.splice(i, 1);
    }
  }

  function update() {
    if (scene === 'ended' || scene === 'title') return;
    if (jumpBuf > 0 && scene !== 'playing') jumpBuf = 0;
    updateFx();
    if (scene === 'ready') {
      if (--sceneT <= 0) scene = 'playing';
    } else if (scene === 'playing') {
      updatePlayer();
      if (jumpBuf > 0) jumpBuf--;
      updateClank();
      updateGears();
      collide();
      if (scene === 'playing' && ++bonusT >= 120) {
        bonusT = 0; bonus -= 100;
        if (bonus <= 1000 && bonus > 0) snd(990, 0.05, 'square', 0.15);
        if (bonus <= 0) { bonus = 0; kill(); }
      }
    } else if (scene === 'dying') {
      if (--sceneT <= 0) {
        if (mode === 'attract') { toTitle(); return; }
        lives--;
        if (lives <= 0) {
          lives = 0; scene = 'gameover'; sceneT = 120;
          snd(392, 0.25, 'square', 0.25); snd(330, 0.25, 'square', 0.25, null, 0.25); snd(262, 0.5, 'square', 0.25, null, 0.5);
        } else {
          if (bonus <= 0) { bonus = 5000; bonusT = 0; }
          spawnPlayer(); scene = 'ready'; sceneT = 60;
        }
      }
    } else if (scene === 'clear') {
      if (sceneT % 6 === 0 && sceneT > 90) burst(18 + Math.random() * 16, 24 + Math.random() * 18, Math.random() < 0.5 ? YEL : CYAN, 2);
      if (sceneT < 170 && bonus > 0) {
        bonus -= 100; addScore(100);
        if (bonus % 200 === 0) snd(1200, 0.03, 'square', 0.12);
      }
      if (--sceneT <= 0) startLevel(level + 1);
    } else if (scene === 'gameover') {
      if (--sceneT <= 0) {
        scene = 'ended';
        if (!reported) { reported = true; AK.gameOver(ID, score); }
      }
    }
  }

  function tick() {
    frame++;
    if (mode === 'attract') {
      if (scene === 'title') { if (++sceneT >= TITLE_FRAMES) startDemo(); }
      else {
        bot();
        update();
        if (scene !== 'title' && ++demoT >= (T.demoFrames || DEMO_FRAMES)) toTitle();
      }
    } else if (!paused) update();
    draw();
  }

  function input(name, down) {
    if (mode !== 'play') return;
    if (name === 'start') {
      if (down && scene !== 'gameover' && scene !== 'ended') {
        paused = !paused;
        snd(paused ? 440 : 660, 0.06, 'square', 0.2);
      }
      return;
    }
    if (name === 'left' || name === 'right' || name === 'up' || name === 'down') keys[name] = !!down;
    else if ((name === 'a' || name === 'b') && down && !paused) jumpBuf = 6;
  }

  function stop() { clearKeys(); paused = false; }

  // ------------------------------------------------------------ drawing
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };

  const bgRnd = mulberry32(4242);
  const STARS = [];
  for (let i = 0; i < 38; i++) STARS.push({ x: Math.floor(bgRnd() * W), y: 17 + Math.floor(bgRnd() * 120), ph: Math.floor(bgRnd() * 200), c: bgRnd() < 0.2 ? PINK : bgRnd() < 0.3 ? CYAN : '#ffffff' });
  const FAR = [], NEAR = [];
  for (let x = 0; x < W;) { const w = 14 + Math.floor(bgRnd() * 20); FAR.push({ x, w, h: 50 + Math.floor(bgRnd() * 70) }); x += w + Math.floor(bgRnd() * 6); }
  for (let x = -4; x < W;) {
    const w = 18 + Math.floor(bgRnd() * 22), h = 24 + Math.floor(bgRnd() * 56), wins = [];
    for (let k = 0; k < 5; k++) wins.push({ x: 2 + Math.floor(bgRnd() * (w - 5)), y: 4 + Math.floor(bgRnd() * (h - 8)), c: bgRnd() < 0.5 ? YEL : bgRnd() < 0.5 ? PINK : CYAN });
    NEAR.push({ x, w, h, wins }); x += w + Math.floor(bgRnd() * 5);
  }

  function drawBg() {
    R(0, 0, W, H, '#07041a');
    R(0, 120, W, 40, '#0d0628'); R(0, 160, W, 34, '#150a38'); R(0, 194, W, 30, '#1f0d4a');
    for (const s of STARS) if (((frame + s.ph) >> 5) % 5 !== 0) R(s.x, s.y, 1, 1, s.c);
    R(206, 30, 14, 14, '#3a1a6e'); R(208, 28, 10, 18, '#3a1a6e'); R(204, 32, 18, 10, '#3a1a6e');   // dim moon
    for (const b of FAR) R(b.x, H - b.h, b.w, b.h, '#120833');
    for (const b of NEAR) {
      R(b.x, H - b.h, b.w, b.h, '#0a0520');
      R(b.x, H - b.h, b.w, 1, '#2a1260');
      for (const w of b.wins) if (((frame >> 6) + w.x + w.y) % 7 !== 0) R(b.x + w.x, H - b.h + w.y, 1, 2, w.c);
    }
  }

  function drawTower() {
    for (const x of [30, 128, 226]) R(x, 22, 2, H - 22, '#1c1640');     // scaffold poles
    for (let f = 0; f <= TOP; f++) {
      const [x0, x1] = solid(f), y = FY[f];
      R(x0, y, x1 - x0, BEAM, '#7f889c');
      R(x0, y, x1 - x0, 1, '#d5dcea');
      R(x0, y + BEAM - 1, x1 - x0, 1, '#444b60');
      R(x0, y + BEAM, x1 - x0, 1, f % 2 ? PINK : PUR);
      for (let x = x0 + 3; x < x1 - 1; x += 8) R(x, y + 2, 2, 2, '#2b3040');
      const s = gapSide(f);
      if (s) { const ex = s > 0 ? x1 - 3 : x0; R(ex, y, 3, BEAM, YEL); R(ex, y + 2, 3, 2, '#111111'); }
    }
    for (const l of ladders) {
      const yt = FY[l.from + 1], yb = FY[l.from];
      R(l.x - 4, yt - 2, 1, yb - yt + 2, CYAN); R(l.x + 3, yt - 2, 1, yb - yt + 2, CYAN);
      for (let y = yt + 1; y < yb; y += 4) R(l.x - 3, y, 6, 1, '#1a9ea3');
    }
    // crane rail and trolley
    R(40, 18, W - 44, 1, '#4a5166'); R(40, 19, W - 44, 1, '#22263a');
    const warn = trolley.warn > 0 && (frame >> 2) % 2 === 0;
    R(trolley.x - 4, 17, 8, 4, warn ? YEL : '#8a93a6'); R(trolley.x - 1, 21, 2, 3, warn ? '#ffffff' : '#5a6278');
  }

  function drawSwitch() {
    const y = FY[TOP], off = clank.dead;
    R(SWITCH_X - 2, y - 12, 4, 12, '#5a6278');
    R(SWITCH_X - 7, y - 22, 14, 11, '#22263a');
    R(SWITCH_X - 7, y - 22, 14, 1, PINK); R(SWITCH_X - 7, y - 12, 14, 1, PINK);
    R(SWITCH_X - 7, y - 22, 1, 11, PINK); R(SWITCH_X + 6, y - 22, 1, 11, PINK);
    R(SWITCH_X - 4, y - 19, 3, 3, off ? '#3dff7a' : ((frame >> 4) % 2 ? '#ff3b3b' : '#7a1010'));
    if (off) { R(SWITCH_X + 1, y - 17, 2, 6, YEL); R(SWITCH_X, y - 12, 4, 2, '#ffffff'); }
    else { R(SWITCH_X + 1, y - 26, 2, 8, YEL); R(SWITCH_X, y - 28, 4, 3, '#ffffff'); }
    AK.text(ctx, 'OFF', SWITCH_X + 16, y - 20, off ? '#3dff7a' : YEL, 'center', 5);
  }

  function drawGear(x, y, rot, hot) {
    x = Math.round(x); y = Math.round(y);
    const c = hot ? '#ff4040' : '#b8c0d0', d = hot ? '#8a1010' : '#566078', q = Math.floor(rot / 4);
    if (q % 2 === 0) { R(x - 1, y - 5, 2, 10, c); R(x - 5, y - 1, 10, 2, c); }
    else { R(x - 4, y - 4, 2, 2, c); R(x + 2, y - 4, 2, 2, c); R(x - 4, y + 2, 2, 2, c); R(x + 2, y + 2, 2, 2, c); }
    R(x - 3, y - 3, 6, 6, c);
    R(x - 3, y + 2, 6, 1, d); R(x + 2, y - 3, 1, 6, d);
    R(x - 1, y - 1, 2, 2, hot ? YEL : '#1c2030');
    const o = [[-2, -2], [1, -2], [1, 1], [-2, 1]][q & 3];
    R(x + o[0], y + o[1], 1, 1, hot ? '#ffd0d0' : '#ffffff');
  }

  function drawClank(ox, by, throwT, dead) {
    // by = y of the surface it stands on
    const body = '#5a6278', lite = '#8a93a6', dark = '#2b3040';
    R(ox + 2, by - 4, 28, 4, dark);
    for (let i = 0; i < 5; i++) R(ox + 4 + i * 5 + (dead ? 0 : (frame >> 3) % 2), by - 3, 2, 2, lite);
    R(ox + 4, by - 20, 22, 16, body); R(ox + 4, by - 20, 22, 1, lite); R(ox + 4, by - 20, 1, 16, lite);
    R(ox + 25, by - 20, 1, 16, dark);
    R(ox + 7, by - 16, 8, 6, dark); R(ox + 8, by - 15, 2, 1, dead ? '#333333' : YEL); R(ox + 11, by - 13, 3, 1, dead ? '#333333' : CYAN);
    R(ox + 17, by - 16, 6, 1, PINK); R(ox + 17, by - 13, 6, 1, PINK); R(ox + 17, by - 10, 6, 1, PINK);
    // head
    R(ox + 8, by - 28, 14, 8, lite); R(ox + 8, by - 28, 14, 1, '#d5dcea'); R(ox + 8, by - 21, 14, 1, dark);
    R(ox + 14, by - 30, 1, 2, lite); R(ox + 13, by - 31, 3, 1, dead ? '#555555' : PINK);
    const eyeOn = !dead && (frame >> 3) % 4 !== 0;
    R(ox + 14, by - 26, 6, 4, '#111111'); R(ox + 15, by - 25, 4, 2, eyeOn ? '#ff2a2a' : '#5a1010');
    if (eyeOn) R(ox + 16, by - 25, 1, 1, '#ffb0b0');
    // claw arm
    if (dead) { R(ox + 26, by - 14, 3, 9, body); R(ox + 25, by - 6, 2, 3, lite); R(ox + 28, by - 6, 2, 3, lite); }
    else if (throwT > 14) {                             // wind-up: arm raised holding a gear
      R(ox + 26, by - 18, 4, 3, body); R(ox + 29, by - 22, 3, 6, body);
      R(ox + 27, by - 25, 2, 4, lite); R(ox + 32, by - 25, 2, 4, lite);
      drawGear(ox + 30, by - 27, frame, false);
    } else if (throwT > 0) {                            // release: arm flung forward
      R(ox + 26, by - 14, 12, 3, body); R(ox + 38, by - 17, 2, 4, lite); R(ox + 38, by - 11, 2, 4, lite);
    } else {
      R(ox + 26, by - 16, 7, 3, body); R(ox + 32, by - 16, 3, 7, body);
      R(ox + 31, by - 9, 2, 3, lite); R(ox + 34, by - 9, 2, 3, lite);
    }
  }

  function drawRivet(cx, feet, face, pose, fr) {
    const x0 = Math.round(cx) - 5, y0 = Math.round(feet) - 14;
    const r = (dx, dy, w, h, c) => R(face < 0 ? x0 + 10 - dx - w : x0 + dx, y0 + dy, w, h, c);
    const skin = '#ffd9a8', blue = '#3a6cff', boot = '#2b3040';
    r(3, 0, 5, 1, YEL); r(2, 1, 7, 2, YEL); r(2, 3, 8, 1, '#d9a400'); r(4, 1, 2, 1, '#fff3b0');
    if (pose === 'climb') {
      r(3, 4, 5, 3, '#7a4a1e');                         // back of the head
      r(2, 7, 6, 4, ORG); r(2, 9, 6, 1, YEL); r(4, 7, 2, 4, '#d95a20');
      if (fr) { r(0, 3, 2, 5, skin); r(8, 7, 2, 3, skin); r(2, 11, 2, 3, blue); r(6, 11, 2, 2, blue); }
      else { r(8, 3, 2, 5, skin); r(0, 7, 2, 3, skin); r(2, 11, 2, 2, blue); r(6, 11, 2, 3, blue); }
      return;
    }
    r(3, 4, 5, 3, skin); r(6, 5, 1, 1, '#111111');
    r(2, 7, 6, 4, ORG); r(2, 9, 6, 1, YEL);
    if (pose === 'jump') {
      r(0, 5, 2, 3, skin); r(8, 5, 2, 3, skin);
      r(2, 11, 2, 2, blue); r(6, 11, 2, 2, blue); r(1, 12, 2, 1, boot); r(7, 12, 2, 1, boot);
    } else if (fr) {
      r(1, 7, 1, 3, skin); r(8, 8, 1, 3, skin);
      r(3, 11, 2, 2, blue); r(5, 11, 2, 2, blue); r(3, 13, 2, 1, boot); r(5, 13, 3, 1, boot);
    } else {
      r(1, 8, 1, 3, skin); r(8, 7, 1, 3, skin);
      r(2, 11, 2, 2, blue); r(6, 11, 2, 2, blue); r(1, 13, 3, 1, boot); r(6, 13, 3, 1, boot);
    }
  }

  function drawHat(x, y) { R(x + 1, y, 5, 1, YEL); R(x, y + 1, 7, 2, YEL); R(x, y + 3, 8, 1, '#d9a400'); }

  function drawBubble(x, y, c) {
    R(x - 2, y - 4, 4, 1, c); R(x - 2, y + 3, 4, 1, c); R(x - 4, y - 2, 1, 4, c); R(x + 3, y - 2, 1, 4, c);
    R(x - 3, y - 3, 1, 1, c); R(x + 2, y - 3, 1, 1, c); R(x - 3, y + 2, 1, 1, c); R(x + 2, y + 2, 1, 1, c);
  }

  function drawHud() {
    R(0, 0, W, 16, '#05030f'); R(0, 15, W, 1, PUR);
    AK.text(ctx, 'SCORE', 4, 2, PINK, 'left', 5);
    AK.text(ctx, AK.pad(score, 6), 4, 7, '#ffffff', 'left', 8);
    AK.text(ctx, 'BONUS', 76, 2, PINK, 'left', 5);
    AK.text(ctx, AK.pad(bonus, 4), 76, 7, bonus <= 1000 && (frame >> 3) % 2 ? '#ff3b3b' : YEL, 'left', 8);
    AK.text(ctx, 'LEVEL', 132, 2, PINK, 'left', 5);
    AK.text(ctx, AK.pad(level, 2), 132, 7, CYAN, 'left', 8);
    AK.text(ctx, 'LIVES', 172, 2, PINK, 'left', 5);
    const n = Math.min(lives, 7);
    for (let i = 0; i < n; i++) drawHat(172 + i * 11, 9);
  }

  function panel(txt, col, y) {
    const w = txt.length * 8 + 16;
    R((W - w) / 2, y - 6, w, 20, '#05030f');
    R((W - w) / 2, y - 6, w, 1, col); R((W - w) / 2, y + 13, w, 1, col);
    AK.text(ctx, txt, W / 2, y, col, 'center', 8);
  }

  function drawTitle() {
    drawBg();
    R(0, 0, W, 16, '#05030f'); R(0, 15, W, 1, PUR);
    AK.text(ctx, 'HI ' + AK.pad(AK.scores.top(ID), 6), W / 2, 4, YEL, 'center', 8);
    AK.text(ctx, 'RIVET RUSH', W / 2 + 1, 41, PUR, 'center', 16);
    AK.text(ctx, 'RIVET RUSH', W / 2, 40, YEL, 'center', 16);
    R(48, 60, 160, 1, PINK); R(64, 63, 128, 1, CYAN);
    AK.text(ctx, 'CLIMB THE TOWER', W / 2, 72, CYAN, 'center', 8);
    AK.text(ctx, 'SWITCH OFF CLANK', W / 2, 84, PINK, 'center', 8);
    // little scene on a beam
    const y = 150;
    R(24, y, 208, BEAM, '#7f889c'); R(24, y, 208, 1, '#d5dcea'); R(24, y + BEAM, 208, 1, PINK);
    for (let x = 27; x < 230; x += 8) R(x, y + 2, 2, 2, '#2b3040');
    const t = sceneT % 120;
    drawClank(28, y, t > 84 ? 120 - t : 0, false);
    drawGear(72 + ((sceneT * 1.1) % 120), y - 5, frame, false);
    drawGear(72 + ((sceneT * 1.1 + 60) % 120), y - 5, frame + 4, true);
    drawRivet(214, y, -1, 'walk', (frame >> 3) % 2);
    AK.text(ctx, 'JUMP GEARS 100   SHIELD SMASH 300', W / 2, 168, '#c9d1e0', 'center', 5);
    if ((frame >> 5) % 2 === 0) AK.text(ctx, 'INSERT COIN', W / 2, 186, '#ffffff', 'center', 8);
    AK.text(ctx, 'AKARCADE', W / 2, 208, PUR, 'center', 5);
  }

  function draw() {
    if (scene === 'title') { drawTitle(); return; }
    drawBg();
    drawTower();
    drawSwitch();
    const it = shieldItem;
    if (it && !it.taken) {
      const by = FY[it.floor] - 10 + Math.round(Math.sin(frame / 12) * 2);
      drawBubble(it.x, by, (frame >> 3) % 2 ? CYAN : '#b8fbff');
      R(it.x - 1, by - 1, 2, 2, '#ffffff');
    }
    drawClank(4, FY[TOP], clank.throwT, clank.dead);
    for (const g of gears) drawGear(g.x, g.y, g.rot, g.hot);
    for (const s of sparks) {
      const a = (frame >> 1) % 2;
      R(s.x - 1, s.y - 3, 2, 6, YEL); R(s.x - 3, s.y - 1, 6, 2, a ? '#ffffff' : ORG);
      R(s.x - 1, s.y - 1, 2, 2, '#ffffff'); R(s.x, s.y - 7, 1, 3, ORG);
    }
    // player
    if (scene === 'dying') {
      const k = 80 - sceneT;
      if (k < 50 && ((k >> 1) % 2 === 0 || k < 20)) {
        const f = (k >> 2) % 4;
        drawRivet(p.x, p.y - Math.min(k, 12) + Math.max(0, k - 24) * 0.5, f < 2 ? 1 : -1, f % 2 ? 'jump' : 'walk', f % 2);
      }
    } else if (scene !== 'gameover' && scene !== 'ended') {
      const pose = p.st === 'climb' ? 'climb' : (p.st === 'jump' || p.st === 'fall') ? 'jump' : 'walk';
      const fr = p.st === 'climb' ? (p.anim >> 3) % 2 : (p.anim >> 2) % 2;
      if (!(p.stun > 0 && (frame >> 1) % 2)) drawRivet(p.x, p.y, p.face, pose, fr);
      if (p.shield > 0 && (p.shield > 120 || (frame >> 2) % 2)) {
        const c = (frame >> 2) % 2 ? CYAN : '#b8fbff', x = Math.round(p.x), y = Math.round(p.y);
        R(x - 5, y - 18, 10, 1, c); R(x - 5, y + 1, 10, 1, c); R(x - 8, y - 15, 1, 14, c); R(x + 7, y - 15, 1, 14, c);
        R(x - 7, y - 17, 2, 2, c); R(x + 5, y - 17, 2, 2, c); R(x - 7, y - 1, 2, 2, c); R(x + 5, y - 1, 2, 2, c);
      }
    }
    for (const q of parts) R(q.x, q.y, q.t > 8 ? 2 : 1, q.t > 8 ? 2 : 1, q.col);
    for (const q of pops) AK.text(ctx, q.txt, Math.max(14, Math.min(W - 14, Math.round(q.x))), Math.round(q.y), q.col, 'center', 5);
    drawHud();
    if (scene === 'ready') panel(level > 1 ? 'LEVEL ' + level + ' READY!' : 'READY!', YEL, 100);
    else if (scene === 'clear') {
      panel('CLANK IS OFF!', CYAN, 96);
      if (sceneT < 170) AK.text(ctx, 'BONUS ' + AK.pad(bonus, 4), W / 2, 122, YEL, 'center', 8);
    } else if (scene === 'gameover' || scene === 'ended') panel('GAME OVER', '#ff3b3b', 100);
    if (mode === 'attract') {
      R(W / 2 - 14, 20, 28, 9, '#05030f');
      if ((frame >> 4) % 4 !== 0) AK.text(ctx, 'DEMO', W / 2, 22, PINK, 'center', 5);
    } else if (paused) panel('PAUSED', '#ffffff', 100);
  }

  const game = { id: ID, title: 'RIVET RUSH', tag: 'CLIMBER', accent: '#ffb627', canvas, reset, tick, input, stop };
  // Test hooks: used only by the offline harness, inert in the arcade.
  game._test = {
    flags: T, genLayout, gapSide, FY, SWITCH_X, GAP,
    state: () => ({ mode, scene, level, score, lives, bonus, gears: gears.length, px: p.x, py: p.y, floor: p.floor, st: p.st }),
  };
  AK.register(game);
  reset('attract');
})();
