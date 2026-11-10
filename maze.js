// GLITCH RUN: an original maze-chase game for AKarcade.
// BITSY the cube-robot collects data bits in a generated neon maze while four GLITCHES hunt it.
(() => {
  'use strict';

  const AK = window.AK;
  const ID = 'glitchrun';

  // ------------------------------------------------------------ constants
  const COLS = 15, ROWS = 12, CS = 16, OX = 8, OY = 24, N = COLS * ROWS;
  const MW = COLS * CS, MH = ROWS * CS;
  // directions: 0 up, 1 right, 2 down, 3 left
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0], BIT = [1, 2, 4, 8], MIRROR = [0, 3, 2, 1];
  const opp = d => (d + 2) & 3;
  const DIRNAME = { up: 0, right: 1, down: 2, left: 3 };

  const BG = '#05010c', PINK = '#ff3ea5', CYAN = '#2de2e6', YELLOW = '#ffd23f', ORANGE = '#ff7a3d', PURPLE = '#6c2bd9';
  const WALLS = ['#8a4bff', '#2d8fe6', '#e63e9a', '#e6803d', '#3dd68a', '#d6b83d'];
  const GLITCH_COL = [PINK, ORANGE, '#4dff7a', '#b06bff'];
  const GLITCH_NAME = ['HUNTER', 'AMBUSH', 'SHY', 'DRIFT'];
  const CORNERS = [[COLS - 1, 0], [0, 0], [0, ROWS - 1], [COLS - 1, ROWS - 1]];
  const HOME = 5 * COLS + 7, START = 10 * COLS + 7;
  const CHIPS = [1 * COLS + 1, 1 * COLS + 13, 10 * COLS + 1, 10 * COLS + 13];
  const PHASES = [300, 1200, 300, 1200, 240, Infinity]; // even index = scatter, odd = chase
  const TITLE_TICKS = 240, DEMO_TICKS = 900;

  const canvas = AK.makeCanvas();
  const g = canvas.getContext('2d');

  // ------------------------------------------------------------ helpers
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
  function hash3(a, b, c) {
    let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  const popcount = v => (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);

  /** Index of the cell reached from idx going d (wraps through the tunnel). Caller checks the side is open. */
  function nextCell(idx, d) {
    let c = idx % COLS + DX[d], r = ((idx / COLS) | 0) + DY[d];
    if (c < 0) c = COLS - 1; else if (c >= COLS) c = 0;
    if (r < 0) r = ROWS - 1; else if (r >= ROWS) r = 0;
    return r * COLS + c;
  }

  // ------------------------------------------------------------ maze generation
  function buildMaze(seed) {
    const rnd = mulberry32(seed);
    const ri = n => Math.floor(rnd() * n);
    const open = new Uint8Array(N);
    const HALFW = 8; // columns 0..7 (7 is the centre column, its own mirror)

    function carve1(c, r, d) {
      const nc = c + DX[d], nr = r + DY[d];
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return;
      open[r * COLS + c] |= BIT[d];
      open[nr * COLS + nc] |= BIT[opp(d)];
    }
    function carve(c, r, d) { carve1(c, r, d); carve1(COLS - 1 - c, r, MIRROR[d]); }
    function canOpen(c, r, d) {
      const nc = c + DX[d], nr = r + DY[d];
      return nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS && !(open[r * COLS + c] & BIT[d]);
    }

    // depth-first carve of the left half, mirrored
    const seen = new Uint8Array(N);
    const stack = [[ri(HALFW), ri(ROWS)]];
    seen[stack[0][1] * COLS + stack[0][0]] = 1;
    while (stack.length) {
      const [c, r] = stack[stack.length - 1];
      const opts = [];
      for (let d = 0; d < 4; d++) {
        const nc = c + DX[d], nr = r + DY[d];
        if (nc >= 0 && nc < HALFW && nr >= 0 && nr < ROWS && !seen[nr * COLS + nc]) opts.push(d);
      }
      if (!opts.length) { stack.pop(); continue; }
      const d = opts[ri(opts.length)];
      carve(c, r, d);
      seen[(r + DY[d]) * COLS + c + DX[d]] = 1;
      stack.push([c + DX[d], r + DY[d]]);
    }

    // wrap-around tunnel row
    const tunnelRow = 2 + ri(ROWS - 4);
    open[tunnelRow * COLS] |= BIT[3];
    open[tunnelRow * COLS + COLS - 1] |= BIT[1];

    // remove every dead end
    for (let pass = 0; pass < 20; pass++) {
      let found = false;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < HALFW; c++) {
        if (popcount(open[r * COLS + c]) > 1) continue;
        const cand = [];
        for (let d = 0; d < 4; d++) if (canOpen(c, r, d)) cand.push(d);
        if (cand.length) { carve(c, r, cand[ri(cand.length)]); found = true; }
      }
      if (!found) break;
    }

    // a few extra loops
    for (let k = 0; k < 5; k++) {
      const c = ri(HALFW), r = ri(ROWS), d = ri(4);
      if (canOpen(c, r, d)) carve(c, r, d);
    }
    return { open, tunnelRow, seed };
  }

  function checkMaze(m) {
    const seen = new Uint8Array(N), q = [0];
    seen[0] = 1;
    let count = 1;
    while (q.length) {
      const u = q.pop();
      for (let d = 0; d < 4; d++) {
        if (!(m.open[u] & BIT[d])) continue;
        const v = nextCell(u, d);
        if (!seen[v]) { seen[v] = 1; count++; q.push(v); }
      }
    }
    if (count !== N) return false;
    for (let i = 0; i < N; i++) if (popcount(m.open[i]) < 2) return false;
    return true;
  }

  function generateMaze(seed) {
    for (let s = seed >>> 0; ; s = (s + 1) >>> 0) {
      const m = buildMaze(s);
      if (checkMaze(m)) return m;
    }
  }

  // ------------------------------------------------------------ game state
  const G = {
    mode: 'attract', state: 'title', t: 0, frame: 0, paused: false,
    demo: false, demoTimer: 0, autopilot: false,
    score: 0, lives: 3, level: 1, extraGiven: false, hi: 0, baseSeed: 1,
    maze: null, cellBit: new Uint8Array(N), edge: new Uint8Array(N * 2), bitsLeft: 0, distHome: new Int16Array(N),
    player: { c: 7, r: 10, dir: -1, prog: 0, want: -1, face: 3 },
    glitches: [], frightTimer: 0, frightLen: 420, combo: 0, phaseIdx: 0, phaseTimer: 0, freeze: 0,
    particles: [], popups: [], bitSnd: 0,
  };

  const cellOf = e => e.r * COLS + e.c;
  /** Index into G.edge for the passage leaving idx in direction d, or -1 for the tunnel wrap. */
  function edgeIdx(idx, d) {
    const c = idx % COLS;
    if (d === 1) return c < COLS - 1 ? idx : -1;
    if (d === 3) return c > 0 ? idx - 1 : -1;
    if (d === 2) return idx < N - COLS ? N + idx : -1;
    return idx >= COLS ? N + idx - COLS : -1;
  }

  function setupLevel() {
    const m = G.maze = generateMaze((G.baseSeed + G.level * 7919) >>> 0);
    G.cellBit.fill(0); G.edge.fill(0);
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (i !== HOME && i !== START) { G.cellBit[i] = 1; n++; }
      const c = i % COLS;
      if ((m.open[i] & BIT[1]) && c < COLS - 1) { G.edge[i] = 1; n++; }
      if ((m.open[i] & BIT[2]) && i < N - COLS) { G.edge[N + i] = 1; n++; }
    }
    for (const ch of CHIPS) { G.cellBit[ch] = 2; n--; }
    G.bitsLeft = n;
    // distance-to-home map for returning cores
    G.distHome.fill(-1);
    G.distHome[HOME] = 0;
    const q = [HOME];
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (let d = 0; d < 4; d++) {
        if (!(m.open[u] & BIT[d])) continue;
        const v = nextCell(u, d);
        if (G.distHome[v] < 0) { G.distHome[v] = G.distHome[u] + 1; q.push(v); }
      }
    }
    G.frightLen = Math.max(120, 420 - 45 * (G.level - 1));
    G.particles.length = 0; G.popups.length = 0;
    resetActors();
  }

  function resetActors() {
    const p = G.player;
    p.c = START % COLS; p.r = (START / COLS) | 0; p.dir = -1; p.prog = 0; p.want = -1; p.face = 3;
    G.glitches = [];
    for (let i = 0; i < 4; i++) {
      G.glitches.push({
        kind: i, color: GLITCH_COL[i], corner: CORNERS[i],
        c: HOME % COLS, r: (HOME / COLS) | 0, dir: -1, prog: 0, state: 'wait', timer: 20 + i * 130,
      });
    }
    G.frightTimer = 0; G.combo = 0; G.freeze = 0;
    G.phaseIdx = 0; G.phaseTimer = PHASES[0];
  }

  function toTitle() {
    G.state = 'title'; G.t = 0; G.demo = false; G.paused = false;
    G.hi = AK.scores.top(ID);
  }

  function newGame(demo) {
    G.demo = demo; G.demoTimer = 0; G.paused = false;
    G.score = 0; G.lives = 3; G.level = 1; G.extraGiven = false;
    G.hi = AK.scores.top(ID);
    G.baseSeed = (Math.random() * 0x7fffffff) | 0;
    setupLevel();
    G.state = 'ready'; G.t = demo ? 60 : 120;
    AK.audio.tone(392, 0.1, 'square', 0.2, null, 0);
    AK.audio.tone(523, 0.1, 'square', 0.2, null, 0.12);
    AK.audio.tone(659, 0.1, 'square', 0.2, null, 0.24);
    AK.audio.tone(784, 0.22, 'square', 0.2, null, 0.36);
  }

  function addScore(n) {
    G.score += n;
    if (!G.extraGiven && G.score >= 10000) {
      G.extraGiven = true; G.lives++;
      for (let i = 0; i < 4; i++) AK.audio.tone(660 + i * 220, 0.08, 'square', 0.22, null, i * 0.09);
    }
  }

  // ------------------------------------------------------------ movement
  function reverse(e) {
    if (e.dir < 0) return;
    const n = nextCell(cellOf(e), e.dir);
    e.c = n % COLS; e.r = (n / COLS) | 0;
    e.dir = opp(e.dir); e.prog = CS - e.prog;
  }

  function choosePlayer(p) {
    if (G.demo || G.autopilot) p.want = botChoose(p);
    const o = G.maze.open[cellOf(p)];
    if (p.want >= 0 && (o & BIT[p.want])) p.dir = p.want;
    else if (p.dir >= 0 && !(o & BIT[p.dir])) p.dir = -1;
    if (p.dir >= 0) p.face = p.dir;
  }

  function glitchTarget(gl) {
    const p = G.player;
    if (!(G.phaseIdx & 1)) return gl.corner;
    if (gl.kind === 0) return [p.c, p.r];
    if (gl.kind === 1) { const f = p.dir >= 0 ? p.dir : p.face; return [p.c + DX[f] * 3, p.r + DY[f] * 3]; }
    if (gl.kind === 2) {
      const dx = p.c - gl.c, dy = p.r - gl.r;
      return dx * dx + dy * dy > 25 ? [p.c, p.r] : gl.corner;
    }
    return null; // drifter: random
  }

  function chooseGlitch(gl) {
    if (gl.state === 'wait') { gl.dir = -1; return; }
    const idx = cellOf(gl), o = G.maze.open[idx];
    if (gl.state === 'core') {
      if (idx === HOME) { gl.state = 'wait'; gl.timer = 70; gl.dir = -1; gl.prog = 0; return; }
      let best = -1, bd = 1e9;
      for (let d = 0; d < 4; d++) {
        if (!(o & BIT[d])) continue;
        const dist = G.distHome[nextCell(idx, d)];
        if (dist < bd) { bd = dist; best = d; }
      }
      gl.dir = best; return;
    }
    const opts = [];
    for (let d = 0; d < 4; d++) if ((o & BIT[d]) && !(gl.dir >= 0 && d === opp(gl.dir))) opts.push(d);
    if (!opts.length) { gl.dir = gl.dir >= 0 ? opp(gl.dir) : -1; return; }
    const tgt = gl.state === 'fright' ? null : glitchTarget(gl);
    if (!tgt) { gl.dir = opts[(Math.random() * opts.length) | 0]; return; }
    let best = opts[0], bd = 1e9;
    for (const d of opts) {
      const v = nextCell(idx, d), dx = v % COLS - tgt[0], dy = ((v / COLS) | 0) - tgt[1];
      const dist = dx * dx + dy * dy;
      if (dist < bd) { bd = dist; best = d; }
    }
    gl.dir = best;
  }

  function eatEdge(p) {
    const ei = edgeIdx(cellOf(p), p.dir);
    if (ei >= 0 && G.edge[ei]) { G.edge[ei] = 0; gotBit(); }
  }
  function gotBit() {
    G.bitsLeft--; addScore(10);
    G.bitSnd ^= 1;
    AK.audio.tone(G.bitSnd ? 620 : 500, 0.04, 'square', 0.1);
  }
  function eatCell(p) {
    const idx = cellOf(p), v = G.cellBit[idx];
    if (!v) return;
    G.cellBit[idx] = 0;
    if (v === 1) { gotBit(); return; }
    addScore(50);
    G.frightTimer = G.frightLen; G.combo = 0;
    for (const gl of G.glitches) {
      if (gl.state === 'normal') { gl.state = 'fright'; reverse(gl); }
    }
    AK.audio.tone(180, 0.35, 'sawtooth', 0.22, 900);
    AK.audio.tone(360, 0.35, 'square', 0.12, 1800, 0.05);
  }

  function advance(e, speed, isPlayer) {
    let rem = speed, guard = 0;
    while (rem > 1e-6 && guard++ < 8) {
      if (e.dir < 0) {
        if (isPlayer) choosePlayer(e); else chooseGlitch(e);
        if (e.dir < 0) return;
      }
      const before = e.prog, mv = Math.min(rem, CS - e.prog);
      e.prog += mv; rem -= mv;
      if (isPlayer && before < 8 && e.prog >= 8) eatEdge(e);
      if (e.prog >= CS - 1e-6) {
        const n = nextCell(cellOf(e), e.dir);
        e.c = n % COLS; e.r = (n / COLS) | 0; e.prog = 0;
        if (isPlayer) { eatCell(e); choosePlayer(e); } else chooseGlitch(e);
      }
    }
  }

  const posX = e => OX + e.c * CS + 8 + (e.dir >= 0 ? DX[e.dir] * e.prog : 0);
  const posY = e => OY + e.r * CS + 8 + (e.dir >= 0 ? DY[e.dir] * e.prog : 0);

  // ------------------------------------------------------------ demo bot
  const danger = new Uint8Array(N), bfsSeen = new Uint8Array(N), bfsFirst = new Int8Array(N), bfsQ = new Int16Array(N);
  function isThreat(gl) {
    return gl.state === 'normal' || (gl.state === 'fright' && G.frightTimer < 70) || (gl.state === 'wait' && gl.timer < 40);
  }
  function markDanger() {
    danger.fill(0);
    const open = G.maze.open;
    const spread = idx => {
      danger[idx] = 1;
      for (let d = 0; d < 4; d++) if (open[idx] & BIT[d]) danger[nextCell(idx, d)] = 1;
    };
    for (const gl of G.glitches) {
      if (!isThreat(gl)) continue;
      const idx = cellOf(gl);
      spread(idx);
      if (gl.dir >= 0) spread(nextCell(idx, gl.dir));
    }
  }
  function botChoose(p) {
    markDanger();
    const open = G.maze.open, start = cellOf(p);
    bfsSeen.fill(0); bfsSeen[start] = 1;
    let head = 0, tail = 0;
    bfsQ[tail++] = start; bfsFirst[start] = -1;
    while (head < tail) {
      const u = bfsQ[head++];
      for (let d = 0; d < 4; d++) {
        if (!(open[u] & BIT[d])) continue;
        const v = nextCell(u, d);
        if (bfsSeen[v] || danger[v]) continue;
        const first = u === start ? d : bfsFirst[u];
        const ei = edgeIdx(u, d);
        if ((ei >= 0 && G.edge[ei]) || G.cellBit[v]) return first;
        bfsSeen[v] = 1; bfsFirst[v] = first; bfsQ[tail++] = v;
      }
    }
    // nothing safely reachable: run away from the nearest threat
    let best = -1, bs = -1e9;
    for (let d = 0; d < 4; d++) {
      if (!(open[start] & BIT[d])) continue;
      const v = nextCell(start, d), vc = v % COLS, vr = (v / COLS) | 0;
      let near = 999;
      for (const gl of G.glitches) {
        if (!isThreat(gl)) continue;
        const dist = Math.abs(gl.c - vc) + Math.abs(gl.r - vr);
        if (dist < near) near = dist;
      }
      const s = near - (danger[v] ? 100 : 0);
      if (s > bs) { bs = s; best = d; }
    }
    return best;
  }
  function botMidCorridor(p) {
    if (p.dir < 0 || p.prog <= 0) return;
    markDanger();
    const cur = cellOf(p), nxt = nextCell(cur, p.dir);
    if (danger[nxt] && !danger[cur]) reverse(p);
  }

  // ------------------------------------------------------------ particles
  function burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 24 + ((Math.random() * 16) | 0), color, size: 2, grav: 0 });
    }
  }
  function shatterBitsy(x, y) {
    for (let iy = 0; iy < 6; iy++) for (let ix = 0; ix < 6; ix++) {
      const dx = ix - 2.5, dy = iy - 2.5;
      G.particles.push({
        x: x + dx * 2, y: y + dy * 2,
        vx: dx * 0.35 + (Math.random() - 0.5) * 0.6, vy: dy * 0.35 - 0.9 + (Math.random() - 0.5) * 0.6,
        life: 50 + ((Math.random() * 40) | 0), color: (ix + iy) % 3 ? CYAN : '#ffffff', size: 2, grav: 0.05,
      });
    }
  }
  function updateParticles() {
    const ps = G.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.x += p.vx; p.y += p.vy; p.vy += p.grav;
      if (--p.life <= 0) ps.splice(i, 1);
    }
    const pp = G.popups;
    for (let i = pp.length - 1; i >= 0; i--) { pp[i].y -= 0.25; if (--pp[i].life <= 0) pp.splice(i, 1); }
  }

  // ------------------------------------------------------------ update
  function killPlayer() {
    const p = G.player;
    G.state = 'dying'; G.t = 0;
    if (!G.demo) G.lives--;
    shatterBitsy(posX(p), posY(p));
    AK.audio.tone(700, 0.7, 'sawtooth', 0.28, 50);
    AK.audio.noise(0.4, 0.22);
  }

  function updatePlay() {
    const p = G.player;
    if (G.frightTimer > 0) {
      if (--G.frightTimer === 0) { for (const gl of G.glitches) if (gl.state === 'fright') gl.state = 'normal'; }
      else if (G.frightTimer % 16 === 0) AK.audio.tone(140, 0.06, 'triangle', 0.12, 220);
    } else if (--G.phaseTimer <= 0) {
      G.phaseIdx = Math.min(G.phaseIdx + 1, PHASES.length - 1);
      G.phaseTimer = PHASES[G.phaseIdx];
      for (const gl of G.glitches) if (gl.state === 'normal') reverse(gl);
    }

    if (G.demo || G.autopilot) botMidCorridor(p);
    advance(p, 1.2, true);
    if (G.bitsLeft <= 0) {
      G.state = 'clear'; G.t = 0;
      for (let i = 0; i < 5; i++) AK.audio.tone(440 * Math.pow(1.19, i), 0.1, 'square', 0.2, null, i * 0.08);
      return;
    }

    const gs = Math.min(1.15, 0.8 + 0.05 * (G.level - 1));
    for (const gl of G.glitches) {
      if (gl.state === 'wait') { if (--gl.timer <= 0) { gl.state = 'normal'; gl.dir = -1; gl.prog = 0; } continue; }
      advance(gl, gl.state === 'core' ? 2.4 : gl.state === 'fright' ? gs * 0.55 : gs, false);
    }

    const px = posX(p), py = posY(p);
    for (const gl of G.glitches) {
      if (gl.state !== 'normal' && gl.state !== 'fright') continue;
      let dx = Math.abs(posX(gl) - px);
      if (dx > MW / 2) dx = MW - dx;
      const dy = Math.abs(posY(gl) - py);
      if (dx >= 7 || dy >= 7) continue;
      if (gl.state === 'fright') {
        const pts = 200 << Math.min(G.combo, 3);
        G.combo++;
        addScore(pts);
        gl.state = 'core';
        burst(posX(gl), posY(gl), gl.color, 14, 1.6);
        burst(posX(gl), posY(gl), '#ffffff', 6, 1);
        G.popups.push({ x: posX(gl), y: posY(gl) - 4, text: String(pts), life: 45 });
        G.freeze = 18;
        AK.audio.tone(300, 0.22, 'square', 0.24, 1400);
      } else { killPlayer(); return; }
    }
  }

  function update() {
    switch (G.state) {
      case 'title':
        if (++G.t >= TITLE_TICKS && G.mode === 'attract') newGame(true);
        break;
      case 'ready':
        updateParticles();
        if (--G.t <= 0) G.state = 'play';
        break;
      case 'play':
        if (G.demo && ++G.demoTimer >= DEMO_TICKS) { toTitle(); break; }
        updateParticles();
        if (G.freeze > 0) { G.freeze--; break; }
        updatePlay();
        break;
      case 'dying':
        updateParticles();
        if (++G.t >= 100) {
          if (G.demo) toTitle();
          else if (G.lives <= 0) { G.state = 'gameover'; G.t = 0; AK.audio.tone(330, 0.5, 'triangle', 0.25, 110); }
          else { resetActors(); G.state = 'ready'; G.t = 90; }
        }
        break;
      case 'clear':
        updateParticles();
        if (++G.t >= 90) { G.level++; setupLevel(); G.state = 'ready'; G.t = 90; }
        break;
      case 'gameover':
        if (++G.t >= 120) { G.state = 'over'; AK.gameOver(ID, G.score); }
        break;
      default: break; // 'over': frozen until reset
    }
  }

  // ------------------------------------------------------------ drawing
  function rect(x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

  function drawBitsy(cx, cy, face, moving) {
    const bob = moving ? (G.frame >> 3) & 1 : (G.frame >> 5) & 1;
    const x = Math.round(cx) - 6, y = Math.round(cy) - 6 - bob;
    rect(x + 5, y, 2, 2, YELLOW);                 // antenna
    rect(x + 1, y + 2, 10, 9, CYAN);              // body
    rect(x + 1, y + 2, 10, 2, '#a8fbfd');         // top face highlight
    rect(x + 9, y + 4, 2, 7, '#178f93');          // side shade
    const ex = DX[face], ey = DY[face];           // eyes look where it travels
    rect(x + 2 + ex, y + 5 + ey, 3, 3, '#ffffff');
    rect(x + 7 + ex, y + 5 + ey, 3, 3, '#ffffff');
    const pxo = ex > 0 ? 1 : 0, pyo = ey > 0 ? 1 : 0;
    rect(x + 2 + ex + pxo, y + 5 + ey + pyo, 2, 2, BG);
    rect(x + 7 + ex + pxo, y + 5 + ey + pyo, 2, 2, BG);
    const step = moving ? (G.frame >> 2) & 1 : 0;   // feet
    rect(x + 2, y + 11 + bob - step, 3, 1, '#178f93');
    rect(x + 7, y + 11 + bob - (moving ? 1 - step : 0), 3, 1, '#178f93');
  }
  function drawMiniBitsy(x, y) {
    rect(x + 3, y, 1, 1, YELLOW);
    rect(x, y + 1, 7, 6, CYAN);
    rect(x, y + 1, 7, 1, '#a8fbfd');
    rect(x + 1, y + 3, 2, 2, '#ffffff'); rect(x + 4, y + 3, 2, 2, '#ffffff');
    rect(x + 1, y + 4, 1, 1, BG); rect(x + 4, y + 4, 1, 1, BG);
  }

  // 12x12 spiky bug, two leg frames
  const BUG = [
    '#....##....#',
    '##..####..##',
    '.##########.',
    '..########..',
    '.##########.',
    '.##########.',
    '############',
    '..########..',
    '.##########.',
  ];
  const LEGS = [['##.##..##.##', '#..#....#..#', '#..#....#..#'], ['.####..####.', '.#.#....#.#.', '#...#..#...#']];
  const runsOf = row => {
    const out = [];
    for (let i = 0; i < row.length; i++) {
      if (row[i] !== '#') continue;
      let j = i; while (j < row.length && row[j] === '#') j++;
      out.push([i, j - i]); i = j;
    }
    return out;
  };
  const BUG_RUNS = BUG.map(runsOf), LEG_RUNS = LEGS.map(f => f.map(runsOf));

  function drawGlitch(cx, cy, color, id, face, scared) {
    const x = Math.round(cx) - 6, y = Math.round(cy) - 6;
    const legs = LEG_RUNS[((G.frame >> 3) + id) & 1];
    g.fillStyle = color;
    for (let i = 0; i < 12; i++) {
      const runs = i < 9 ? BUG_RUNS[i] : legs[i - 9];
      const h = hash3(G.frame >> 2, i, id);
      const shift = h % 9 === 0 ? ((h >> 5) % 3) - 1 : 0;   // row tearing
      for (const r of runs) g.fillRect(x + r[0] + shift, y + i, r[1], 1);
    }
    if (hash3(G.frame >> 3, 77, id) % 7 === 0) rect(x - 2 + (hash3(G.frame >> 3, 5, id) % 14), y + (hash3(G.frame >> 3, 9, id) % 11), 3, 1, '#ffffff');
    if (scared) {
      rect(x + 2, y + 4, 2, 2, '#1a2a6c'); rect(x + 8, y + 4, 2, 2, '#1a2a6c');
      rect(x + 3, y + 8, 6, 1, '#1a2a6c');
    } else {
      rect(x + 2, y + 3, 3, 3, BG); rect(x + 7, y + 3, 3, 3, BG);
      const ex = face >= 0 ? DX[face] : 0, ey = face >= 0 ? DY[face] : 0;
      rect(x + 3 + ex, y + 4 + ey, 1, 1, '#ffffff'); rect(x + 8 + ex, y + 4 + ey, 1, 1, '#ffffff');
    }
  }
  function drawCore(cx, cy, color) {
    const x = Math.round(cx), y = Math.round(cy), s = (G.frame >> 2) & 1;
    rect(x - 2 - s, y - 2 - s, 4 + s * 2, 4 + s * 2, color);
    rect(x - 1, y - 1, 2, 2, '#ffffff');
  }
  function drawChip(cx, cy) {
    const big = (G.frame >> 3) & 1, s = big ? 4 : 3;
    rect(cx - s - 1, cy - 1, s * 2 + 2, 2, YELLOW);     // pins
    rect(cx - 1, cy - s - 1, 2, s * 2 + 2, YELLOW);
    rect(cx - s, cy - s, s * 2, s * 2, big ? '#ffffff' : CYAN);
    rect(cx - s + 1, cy - s + 1, s * 2 - 2, s * 2 - 2, big ? CYAN : '#0b5b6b');
    rect(cx - 1, cy - 1, 2, 2, '#ffffff');
  }

  /** Draw fn at (x,y) and again on the far side when the entity is inside the tunnel. */
  function wrapDraw(x, y, fn) {
    fn(x, y);
    if (x < OX + 8) fn(x + MW, y); else if (x > OX + MW - 8) fn(x - MW, y);
  }

  function drawWalls(color) {
    const open = G.maze.open;
    for (let pass = 0; pass < 2; pass++) {
      const t = pass ? 2 : 4, o = t / 2;
      g.globalAlpha = pass ? 1 : 0.28;
      g.fillStyle = color;
      for (let i = 0; i < N; i++) {
        const c = i % COLS, r = (i / COLS) | 0, x = OX + c * CS, y = OY + r * CS, v = open[i];
        if (!(v & 1)) g.fillRect(x - o, y - o, CS + t, t);
        if (!(v & 8)) g.fillRect(x - o, y - o, t, CS + t);
        if (r === ROWS - 1 && !(v & 4)) g.fillRect(x - o, y + CS - o, CS + t, t);
        if (c === COLS - 1 && !(v & 2)) g.fillRect(x + CS - o, y - o, t, CS + t);
      }
    }
    g.globalAlpha = 1;
    // tunnel mouth markers
    const ty = OY + G.maze.tunnelRow * CS + 7, blink = (G.frame >> 4) & 1;
    rect(OX - 5 - blink, ty, 3, 2, YELLOW);
    rect(OX + MW + 2 + blink, ty, 3, 2, YELLOW);
  }

  function drawHud() {
    rect(0, 0, AK.W, OY - 2, BG);
    AK.text(g, 'SCORE', 8, 2, PINK, 'left', 8);
    AK.text(g, AK.pad(G.score, 6), 8, 12, '#ffffff', 'left', 8);
    AK.text(g, 'HI', 128, 2, YELLOW, 'center', 8);
    AK.text(g, AK.pad(Math.max(G.hi, G.score), 6), 128, 12, '#ffffff', 'center', 8);
    AK.text(g, 'LEVEL ' + AK.pad(G.level, 2), 248, 2, CYAN, 'right', 8);
    const n = Math.min(Math.max(G.lives, 0), 6);
    for (let i = 0; i < n; i++) drawMiniBitsy(241 - i * 9, 12);
  }

  function panel(text, color, sub) {
    const w = Math.max(text.length * 8 + 24, sub ? sub.length * 5 + 24 : 0), h = sub ? 34 : 24;
    const x = (AK.W - w) >> 1, y = (OY + (MH - h) / 2) | 0;
    rect(x - 1, y - 1, w + 2, h + 2, color);
    rect(x, y, w, h, BG);
    AK.text(g, text, 128, y + 8, color, 'center', 8);
    if (sub) AK.text(g, sub, 128, y + 22, '#ffffff', 'center', 5);
  }

  function drawGame() {
    rect(0, 0, AK.W, AK.H, BG);
    const flash = G.state === 'clear' && ((G.t >> 3) & 1);
    drawWalls(flash ? '#ffffff' : WALLS[(G.level - 1) % WALLS.length]);

    // bits and chips
    g.fillStyle = '#ffe6a6';
    for (let i = 0; i < N; i++) {
      const x = OX + (i % COLS) * CS + 8, y = OY + ((i / COLS) | 0) * CS + 8;
      if (G.cellBit[i] === 1) g.fillRect(x - 1, y - 1, 2, 2);
      if (G.edge[i]) g.fillRect(x + 7, y - 1, 2, 2);
      if (G.edge[N + i]) g.fillRect(x - 1, y + 7, 2, 2);
    }
    for (const ch of CHIPS) if (G.cellBit[ch] === 2) drawChip(OX + (ch % COLS) * CS + 8, OY + ((ch / COLS) | 0) * CS + 8);

    g.save();
    g.beginPath(); g.rect(OX, OY - 4, MW, MH + 8); g.clip();
    const p = G.player, hideActors = G.state === 'dying' && G.t > 12;
    if (!hideActors && G.state !== 'clear') {
      G.glitches.forEach((gl, i) => {
        if (gl.state === 'wait') {
          // dormant in the centre: flickering, about to boot
          if (gl.timer < 40 ? (G.frame >> 1) & 1 : (G.frame + i * 3) % 6 < 4) {
            g.globalAlpha = gl.timer < 40 ? 1 : 0.45;
            drawGlitch(posX(gl) + (i - 1.5) * 3, posY(gl) + (((G.frame >> 4) + i) & 1), gl.color, i, -1, false);
            g.globalAlpha = 1;
          }
        } else if (gl.state === 'core') {
          wrapDraw(posX(gl), posY(gl), (x, y) => drawCore(x, y, gl.color));
        } else {
          const scared = gl.state === 'fright';
          const col = scared ? (G.frightTimer < 90 && ((G.frame >> 3) & 1) ? '#ffffff' : '#9fd8ff') : gl.color;
          const jx = scared ? 0 : (hash3(G.frame >> 2, 3, i) % 13 === 0 ? 1 : 0);
          wrapDraw(posX(gl) + jx, posY(gl), (x, y) => drawGlitch(x, y, col, i, gl.dir, scared));
        }
      });
    }
    if (G.state !== 'dying' && G.state !== 'gameover' && G.state !== 'over') {
      const moving = p.dir >= 0 && G.state === 'play';
      wrapDraw(posX(p), posY(p), (x, y) => drawBitsy(x, y, p.face, moving));
    }
    for (const q of G.particles) { g.fillStyle = q.color; g.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size); }
    g.restore();
    for (const q of G.popups) AK.text(g, q.text, Math.round(q.x), Math.round(q.y), YELLOW, 'center', 5);

    drawHud();

    if (G.state === 'ready') panel('READY!', YELLOW);
    else if (G.state === 'clear') panel('LEVEL CLEAR', CYAN);
    else if (G.state === 'gameover' || G.state === 'over') panel('GAME OVER', PINK);
    if (G.demo) {
      rect(0, AK.H - 6, AK.W, 6, BG);
      AK.text(g, 'DEMO', 10, AK.H - 6, PINK, 'left', 5);
      if ((G.frame >> 5) & 1) AK.text(g, 'INSERT COIN', 128, AK.H - 6, YELLOW, 'center', 5);
    }
    if (G.paused) panel('PAUSED', CYAN, 'PRESS START');
  }

  function drawTitle() {
    const t = G.frame;
    rect(0, 0, AK.W, AK.H, BG);
    // drifting data rain backdrop
    for (let i = 0; i < 40; i++) {
      const x = hash3(i, 1, 0) % AK.W, sp = 1 + hash3(i, 2, 0) % 3;
      const y = (hash3(i, 3, 0) % AK.H + t * sp * 0.4) % AK.H;
      rect(x, y | 0, 1, 2 + sp, i % 3 ? '#1b0f3a' : '#2a1560');
    }
    // neon frame
    rect(6, 6, AK.W - 12, 1, PURPLE); rect(6, AK.H - 7, AK.W - 12, 1, PURPLE);
    rect(6, 6, 1, AK.H - 12, PURPLE); rect(AK.W - 7, 6, 1, AK.H - 12, PURPLE);

    const tear = hash3(t >> 3, 4, 4) % 9 === 0 ? (hash3(t >> 3, 6, 6) % 5) - 2 : 0;
    AK.text(g, 'GLITCH RUN', 128 + 2 + tear, 30, PINK, 'center', 16);
    AK.text(g, 'GLITCH RUN', 128 - tear, 28, CYAN, 'center', 16);
    AK.text(g, 'MAZE CHASE', 128, 52, '#b06bff', 'center', 8);

    // chase parade
    const span = AK.W + 140, bx = (t * 1.1) % span - 20, y = 82;
    rect(12, y + 9, AK.W - 24, 1, '#2a1560');
    for (let x = 16; x < AK.W - 12; x += 8) if (x > bx + 8) rect(x, y - 1, 2, 2, '#ffe6a6');
    g.save();
    g.beginPath(); g.rect(8, y - 12, AK.W - 16, 24); g.clip();
    drawBitsy(bx, y, 1, true);
    for (let i = 0; i < 4; i++) drawGlitch(bx - 30 - i * 18, y + (((t >> 3) + i) & 1), GLITCH_COL[i], i, 1, false);
    g.restore();

    // cast
    for (let i = 0; i < 4; i++) {
      const cx = 44 + i * 56;
      drawGlitch(cx, 112, GLITCH_COL[i], i, 2, false);
      AK.text(g, GLITCH_NAME[i], cx, 122, GLITCH_COL[i], 'center', 5);
    }
    // legend
    rect(74, 142, 2, 2, '#ffe6a6');
    AK.text(g, 'DATA BIT   10', 88, 139, '#ffffff', 'left', 8);
    drawChip(75, 157);
    AK.text(g, 'CHIP       50', 88, 153, '#ffffff', 'left', 8);

    if ((t >> 5) & 1) AK.text(g, 'INSERT COIN', 128, 178, YELLOW, 'center', 8);
    AK.text(g, 'HI ' + AK.pad(G.hi, 6), 128, 198, ORANGE, 'center', 8);
  }

  function draw() {
    if (G.state === 'title') drawTitle(); else drawGame();
  }

  // ------------------------------------------------------------ contract
  function reset(mode) {
    G.mode = mode === 'play' ? 'play' : 'attract';
    G.paused = false; G.autopilot = false;
    if (G.mode === 'play') newGame(false); else toTitle();
    draw();
  }

  function tick() {
    G.frame++;
    if (!G.paused) update();
    draw();
  }

  function input(name, down) {
    if (G.mode !== 'play') return;
    if (name === 'start') {
      if (down && (G.state === 'ready' || G.state === 'play' || G.state === 'dying' || G.state === 'clear')) {
        G.paused = !G.paused;
        AK.audio.tone(G.paused ? 440 : 660, 0.08, 'square', 0.18);
      }
      return;
    }
    const d = DIRNAME[name];
    if (d === undefined || !down || G.paused) return;
    const p = G.player;
    p.want = d;
    if (G.state === 'play' && p.dir >= 0 && d === opp(p.dir)) { reverse(p); p.face = p.dir; }
  }

  function stop() { G.paused = false; }

  toTitle();
  AK.register({
    id: ID, title: 'GLITCH RUN', tag: 'MAZE CHASE', accent: CYAN,
    canvas, reset, tick, input, stop,
    // test hooks (not used by the host)
    _test: { generate: generateMaze, build: buildMaze, state: G, COLS, ROWS },
  });
})();
