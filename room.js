// AKarcade 3D room: a row of arcade cabinets (one per game) rendered with Three.js.
// Attaches itself to the host (arcade.js) through AK.host.attachRoom().
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const AK = window.AK;
const host = AK && AK.host;
const container = document.getElementById('room3d');

const PINK = '#ff3ea5', CYAN = '#2de2e6', YELLOW = '#ffd23f';
const SPACING = 1.3;
const CAB_W = 0.72;          // inner width between the side panels
const SIDE_T = 0.035;        // side panel thickness
const SCREEN_W = 0.52, SCREEN_H = 0.455;
const FOV = 38;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Front profile of the cabinet as [z (toward viewer), y (up)], bottom-back round to the back.
const P = [
  [-0.40, 0.00], [0.26, 0.00], [0.26, 0.78], [0.40, 0.88], [0.40, 0.95], [0.12, 1.05],
  [0.00, 1.56], [0.22, 1.62], [0.22, 1.84], [-0.30, 1.84], [-0.40, 1.70],
];
// Side panels use a slightly larger outline so they stand proud of the front panels.
const S = [
  [-0.42, 0.00], [0.285, 0.00], [0.285, 0.77], [0.425, 0.87], [0.425, 0.97], [0.15, 1.07],
  [0.035, 1.55], [0.245, 1.605], [0.245, 1.86], [-0.31, 1.86], [-0.42, 1.71],
];

// ---------------------------------------------------------------- canvas textures
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opts.pixel) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; }
  return t;
}
const logoImg = new Image();
logoImg.src = 'assets/akarcade-logo.png';
const logoWaiters = [];
logoImg.onload = () => logoWaiters.forEach(fn => fn());
const whenLogo = fn => { if (logoImg.complete && logoImg.naturalWidth) fn(); else logoWaiters.push(fn); };

function stripes(g, w, h, accent) {
  g.save();
  g.translate(w * 0.5, h * 0.5); g.rotate(-0.5); g.translate(-w, -h);
  const cols = [accent, YELLOW, CYAN, PINK];
  cols.forEach((c, i) => { g.fillStyle = c; g.globalAlpha = 0.9 - i * 0.12; g.fillRect(0, h * (0.86 + i * 0.07), w * 2, h * 0.035); });
  g.restore(); g.globalAlpha = 1;
}
function sideTexture(accent) {
  const t = canvasTex(512, 1024, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#2b1558'); bg.addColorStop(0.55, '#170b33'); bg.addColorStop(1, '#0a0518');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(45,226,230,0.16)'; g.lineWidth = 2;
    for (let y = h * 0.62; y < h; y += 26) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let i = -6; i <= 6; i++) { g.beginPath(); g.moveTo(w / 2 + i * 14, h * 0.62); g.lineTo(w / 2 + i * 110, h); g.stroke(); }
    stripes(g, w, h, accent);
  });
  whenLogo(() => {
    const g = t.image.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    g.drawImage(logoImg, 106, 200, 300, 244);
    g.globalCompositeOperation = 'source-over';
    t.needsUpdate = true;
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 0.87, 1 / 1.86);
  t.offset.set(0.42 / 0.87, 0);
  return t;
}
function marqueeTexture(game) {
  return canvasTex(1024, 320, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#12052a'); bg.addColorStop(1, '#2a0b3f');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 2;
    for (let x = 0; x < w; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.fillStyle = game.accent; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 14, w, 14);
    let size = 92;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    do { g.font = size + 'px ' + AK.FONT; size -= 4; } while (g.measureText(game.title).width > w - 120 && size > 24);
    g.shadowColor = game.accent; g.shadowBlur = 40;
    g.fillStyle = '#3b0f4f'; g.fillText(game.title, w / 2 + 6, h / 2 + 2);
    g.fillStyle = '#ffffff'; g.fillText(game.title, w / 2, h / 2 - 6);
    g.shadowBlur = 0;
    g.font = '22px ' + AK.FONT; g.fillStyle = YELLOW;
    g.fillText('★ ' + game.tag + ' ★', w / 2, h - 52);
  });
}
function bezelTexture(accent) {
  return canvasTex(1024, 768, (g, w, h) => {
    g.fillStyle = '#07040e'; g.fillRect(0, 0, w, h);
    g.strokeStyle = CYAN; g.globalAlpha = 0.55; g.lineWidth = 6;
    g.beginPath(); g.moveTo(40, 40); g.lineTo(w - 40, 40); g.lineTo(w / 2, h - 10); g.closePath(); g.stroke();
    g.strokeStyle = accent; g.globalAlpha = 0.5; g.lineWidth = 3;
    g.beginPath(); g.moveTo(70, 58); g.lineTo(w - 70, 58); g.lineTo(w / 2, h - 50); g.closePath(); g.stroke();
    g.globalAlpha = 1;
    g.font = '15px ' + AK.FONT; g.textBaseline = 'middle';
    g.fillStyle = CYAN; g.textAlign = 'left'; g.fillText('INSERT COIN', 40, h - 22);
    g.fillStyle = accent; g.textAlign = 'right'; g.fillText('AKARCADE', w - 40, h - 22);
  });
}
function panelTexture(accent) {
  return canvasTex(1024, 420, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#22154a'); bg.addColorStop(1, '#35225f');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.save(); g.transform(1, 0, -0.35, 1, 0, 0);
    [[accent, 500], [YELLOW, 540], [CYAN, 580]].forEach(([c, x]) => { g.fillStyle = c; g.globalAlpha = 0.55; g.fillRect(x, 0, 22, h); });
    g.restore(); g.globalAlpha = 1;
    g.font = '14px ' + AK.FONT; g.fillStyle = 'rgba(255,255,255,0.75)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('MOVE', 226, h - 40);
    g.fillText('B', 682, h - 40); g.fillText('A', 852, h - 40);
    g.fillText('START', 512, 90);
  });
}
function frontTexture(accent) {
  return canvasTex(512, 512, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1d1240'); bg.addColorStop(1, '#0b0619');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.save(); g.transform(1, 0, -0.5, 1, 0, 0);
    [[accent, 110], [YELLOW, 150], [CYAN, 560], [accent, 600]].forEach(([c, x]) => { g.fillStyle = c; g.globalAlpha = 0.45; g.fillRect(x, 0, 24, h); });
    g.restore(); g.globalAlpha = 1;
    g.fillStyle = '#07040e'; g.fillRect(0, h - 44, w, 44);
    g.fillStyle = '#b9b6cc'; g.fillRect(0, h - 46, w, 3);
  });
}
function coinDoorTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const m = g.createLinearGradient(0, 0, 0, h);
    m.addColorStop(0, '#9a97b0'); m.addColorStop(0.5, '#565370'); m.addColorStop(1, '#2d2b3d');
    g.fillStyle = m; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < w; x += 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.strokeStyle = '#1b1927'; g.lineWidth = 14; g.strokeRect(16, 16, w - 32, h - 32);
    g.strokeStyle = '#c9c6dc'; g.lineWidth = 3; g.strokeRect(8, 8, w - 16, h - 16);
    [[40, 40], [w - 40, 40], [40, h - 40], [w - 40, h - 40]].forEach(([x, y]) => {
      g.fillStyle = '#e8e6f2'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
      g.fillStyle = '#55526a'; g.beginPath(); g.arc(x + 1, y + 1, 3, 0, 7); g.fill();
    });
    [140, 372].forEach(cx => {
      g.fillStyle = '#0d0d14'; g.fillRect(cx - 70, 90, 140, 250);
      g.strokeStyle = '#6a6780'; g.lineWidth = 4; g.strokeRect(cx - 70, 90, 140, 250);
      g.fillStyle = '#000'; g.fillRect(cx - 9, 120, 18, 90);
      g.strokeStyle = '#a5a2b8'; g.lineWidth = 4; g.strokeRect(cx - 9, 120, 18, 90);
      g.shadowColor = '#ff7a3d'; g.shadowBlur = 30;
      g.fillStyle = '#ff7a3d'; g.fillRect(cx - 48, 248, 96, 56);
      g.shadowBlur = 0;
      g.fillStyle = '#fff3d6'; g.font = '26px ' + AK.FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('25¢', cx, 278);
    });
    g.fillStyle = '#f1f0f7'; g.font = '24px ' + AK.FONT; g.textAlign = 'center';
    g.fillText('INSERT COIN', w / 2, 410);
  });
}
function cardTexture(game) {
  const tex = canvasTex(256, 224, () => {}, { pixel: true });
  tex.userData = { game, blink: -1 };
  return tex;
}
function drawCard(tex, blinkOn) {
  if (tex.userData.blink === blinkOn) return;
  tex.userData.blink = blinkOn;
  const game = tex.userData.game;
  const g = tex.image.getContext('2d');
  g.fillStyle = '#05010c'; g.fillRect(0, 0, 256, 224);
  for (let y = 0; y < 224; y += 4) { g.fillStyle = 'rgba(108,43,217,0.14)'; g.fillRect(0, y, 256, 1); }
  g.fillStyle = game.accent; g.fillRect(0, 60, 256, 2); g.fillRect(0, 128, 256, 2);
  const words = game.title.split(' ');
  const size = words.some(wd => wd.length > 9) ? 16 : 24;
  words.forEach((wd, i) => AK.text(g, wd, 128, 96 - words.length * (size + 4) / 2 + i * (size + 4), '#ffffff', 'center', size));
  AK.text(g, game.tag, 128, 140, game.accent, 'center', 8);
  if (blinkOn) AK.text(g, 'INSERT COIN', 128, 176, YELLOW, 'center', 8);
  tex.needsUpdate = true;
}

// ---------------------------------------------------------------- scene
let renderer, composer, bloom, scene, camera;
const cabinets = [];
let liveTex = null;

function buildCabinet(game, index, shared) {
  const group = new THREE.Group();
  group.userData.index = index;
  const accent = new THREE.Color(game.accent);
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0718, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });

  // side panels: extruded profile, art on the faces, glowing T-molding on the edge
  const shape = new THREE.Shape();
  S.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  shape.closePath();
  const sideGeo = new THREE.ExtrudeGeometry(shape, { depth: SIDE_T, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2, curveSegments: 4 });
  sideGeo.rotateY(-Math.PI / 2);          // shape x -> world z, extrusion -> world -x
  const sideMats = [
    new THREE.MeshStandardMaterial({ map: sideTexture(game.accent), roughness: 0.55, metalness: 0.05 }),
    new THREE.MeshBasicMaterial({ color: accent }),
  ];
  const left = new THREE.Mesh(sideGeo, sideMats);
  left.position.x = -CAB_W / 2;
  const right = new THREE.Mesh(sideGeo, sideMats);
  right.position.x = CAB_W / 2 + SIDE_T;
  group.add(left, right);

  // a panel spanning the cabinet width along one segment of the profile
  const seg = (i, mat) => {
    const a = P[i], b = P[(i + 1) % P.length];
    const dz = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dz, dy);
    const s = new THREE.Group();
    s.position.set(0, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2);
    s.rotation.x = Math.atan2(dz, dy);
    s.add(new THREE.Mesh(new THREE.PlaneGeometry(CAB_W, len), mat));
    s.userData.len = len;
    group.add(s);
    return s;
  };
  const std = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.05, ...extra });

  seg(0, dark);
  const lower = seg(1, std(frontTexture(game.accent)));
  seg(2, dark);
  const lip = seg(3, new THREE.MeshStandardMaterial({ color: 0x1a1036, roughness: 0.4, metalness: 0.3 }));
  const panel = seg(4, std(panelTexture(game.accent), { roughness: 0.45 }));
  const bezel = seg(5, std(bezelTexture(game.accent), { roughness: 0.35 }));
  seg(6, new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(0.55) }));
  const marquee = seg(7, new THREE.MeshBasicMaterial({ map: marqueeTexture(game) }));
  seg(8, dark); seg(9, dark); seg(10, dark);

  // marquee chrome frame
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9c6dc, roughness: 0.25, metalness: 0.9 });
  [[0, 0.105, CAB_W, 0.012], [0, -0.105, CAB_W, 0.012]].forEach(([x, y, w, h]) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.01), chrome);
    bar.position.set(x, y, 0.004); marquee.add(bar);
  });

  // LED strip on the control panel lip
  const led = new THREE.Mesh(new THREE.BoxGeometry(CAB_W * 0.86, 0.012, 0.006), new THREE.MeshBasicMaterial({ color: accent }));
  led.position.z = 0.003; lip.add(led);

  // screen: frame, curved CRT face, glass reflection
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W + 0.07, SCREEN_H + 0.055),
    new THREE.MeshStandardMaterial({ color: 0x15111f, roughness: 0.3, metalness: 0.4 }));
  frame.position.z = 0.003; bezel.add(frame);
  const scrGeo = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H, 16, 16);
  const pos = scrGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (SCREEN_W / 2), y = pos.getY(i) / (SCREEN_H / 2);
    pos.setZ(i, 0.012 * (1 - x * x) * (1 - y * y));
  }
  const card = cardTexture(game);
  drawCard(card, true);
  const screenMat = new THREE.MeshBasicMaterial({ map: card, color: 0xb4b4b4, toneMapped: false });
  const screenMesh = new THREE.Mesh(scrGeo, screenMat);
  screenMesh.position.z = 0.006;
  screenMesh.userData.role = 'screen';
  bezel.add(screenMesh);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H),
    new THREE.MeshBasicMaterial({ map: shared.glass, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glass.position.z = 0.022; bezel.add(glass);

  // speaker grilles above the screen
  [-0.2, 0.2].forEach(x => {
    const gr = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.018), new THREE.MeshBasicMaterial({ map: shared.grill }));
    gr.position.set(x, bezel.userData.len / 2 - 0.016, 0.002); bezel.add(gr);
  });

  // joystick
  const plastic = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.1 });
  const upright = geo => { geo.rotateX(Math.PI / 2); return geo; };       // cylinder axis -> panel normal
  const base = new THREE.Mesh(upright(new THREE.CylinderGeometry(0.05, 0.056, 0.012, 28)), new THREE.MeshStandardMaterial({ color: 0x15121f, roughness: 0.35, metalness: 0.6 }));
  base.position.set(-0.2, 0.01, 0.006); panel.add(base);
  const pivot = new THREE.Group();
  pivot.position.set(-0.2, 0.01, 0.008); panel.add(pivot);
  const shaft = new THREE.Mesh(upright(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 12)), chrome);
  shaft.position.z = 0.05; pivot.add(shaft);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 18), plastic(0xe01e3c));
  ball.position.z = 0.108; pivot.add(ball);

  // buttons
  const mkButton = (x, y, color) => {
    const ring = new THREE.Mesh(upright(new THREE.CylinderGeometry(0.04, 0.04, 0.006, 28)), chrome);
    ring.position.set(x, y, 0.003); panel.add(ring);
    const cap = new THREE.Mesh(upright(new THREE.CylinderGeometry(0.031, 0.031, 0.022, 28)),
      new THREE.MeshStandardMaterial({ color, roughness: 0.2, metalness: 0.05, emissive: color, emissiveIntensity: 0.25 }));
    cap.position.set(x, y, 0.014); panel.add(cap);
    return cap;
  };
  const btnB = mkButton(0.12, -0.02, 0x1a9fe0);
  const btnA = mkButton(0.24, 0.02, 0xe01e3c);
  [-0.03, 0.03].forEach((x, i) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.016, 0.008), plastic(i ? 0xffffff : 0xd9d4ec));
    s.position.set(x, 0.085, 0.004); panel.add(s);
  });

  // coin door
  const metal = new THREE.MeshStandardMaterial({ color: 0x55526a, roughness: 0.35, metalness: 0.8 });
  const doorMats = [metal, metal, metal, metal, new THREE.MeshStandardMaterial({ map: shared.coinDoor, roughness: 0.4, metalness: 0.5 }), metal];
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.02), doorMats);
  door.position.set(0, 0.04, 0.01);
  door.userData.role = 'coin';
  lower.add(door);

  // blob shadow + coloured light spilling on the floor
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: shared.shadow, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.004, 0.05); group.add(shadow);
  const glow = new THREE.PointLight(accent, 5, 3.2, 1.6);
  glow.position.set(0, 1.25, 0.95); group.add(glow);
  const screenLight = new THREE.PointLight(0x9fd8ff, 0, 2.2, 1.8);
  screenLight.position.set(0, 1.3, 0.55); group.add(screenLight);

  return { group, game, screenMesh, screenMat, card, pivot, btnA, btnB, door, glow, screenLight };
}

function build() {
  const games = host.games;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07030f);
  scene.fog = new THREE.Fog(0x07030f, 5, 13);
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);

  scene.add(new THREE.AmbientLight(0x6a4fc0, 0.75));
  const key = new THREE.DirectionalLight(0xd8ccff, 1.15);
  key.position.set(2.5, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff3ea5, 0.9);
  rim.position.set(-4, 2.5, -2); scene.add(rim);

  // floor
  const gridTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#0c0619'; g.fillRect(0, 0, w, h);
    g.strokeStyle = PINK; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
  });
  gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping; gridTex.repeat.set(40, 20);
  const glowTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
  });
  glowTex.wrapS = glowTex.wrapT = THREE.RepeatWrapping; glowTex.repeat.set(40, 20);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20),
    new THREE.MeshStandardMaterial({ map: gridTex, roughness: 0.42, metalness: 0.25, emissive: new THREE.Color(PINK), emissiveMap: glowTex, emissiveIntensity: 0.55 }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = 4; scene.add(floor);

  // back wall with neon strips and logo signs
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 6), new THREE.MeshStandardMaterial({ color: 0x0b0420, roughness: 0.95 }));
  wall.position.set(0, 3, -1.1); scene.add(wall);
  [[2.42, PINK], [2.5, CYAN]].forEach(([y, c]) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(40, 0.025, 0.02), new THREE.MeshBasicMaterial({ color: c }));
    strip.position.set(0, y, -1.08); scene.add(strip);
  });
  const logoTex = new THREE.Texture(logoImg);
  logoTex.colorSpace = THREE.SRGBColorSpace;
  whenLogo(() => { logoTex.needsUpdate = true; });
  const n = games.length;
  for (let i = -1; i <= n; i++) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.7),
      new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sign.position.set((i - (n - 1) / 2 + 0.5) * SPACING, 2.0, -1.07); scene.add(sign);
  }

  const shared = {
    coinDoor: coinDoorTexture(),
    glass: canvasTex(256, 224, (g, w, h) => {
      const r = g.createRadialGradient(w * 0.28, h * 0.14, 0, w * 0.28, h * 0.14, w * 0.7);
      r.addColorStop(0, 'rgba(255,255,255,0.20)'); r.addColorStop(0.5, 'rgba(255,255,255,0.03)'); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) { g.fillStyle = 'rgba(0,0,0,0.0)'; g.fillRect(0, y, w, 1); }
    }),
    grill: canvasTex(128, 16, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#3a3158'; for (let x = 2; x < w; x += 6) g.fillRect(x, 2, 2, h - 4);
    }),
    shadow: canvasTex(128, 128, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(0,0,0,0.85)'); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }),
  };

  games.forEach((game, i) => {
    const cab = buildCabinet(game, i, shared);
    cab.group.position.x = (i - (n - 1) / 2) * SPACING;
    scene.add(cab.group);
    cabinets.push(cab);
  });

  liveTex = new THREE.CanvasTexture(AK.screen);
  liveTex.colorSpace = THREE.SRGBColorSpace;
  liveTex.magFilter = THREE.NearestFilter; liveTex.minFilter = THREE.LinearFilter; liveTex.generateMipmaps = false;
}

// ---------------------------------------------------------------- camera
const view = { tx: 0, yaw: 0.34, pitch: 0.2, yawT: 0.34, pitchT: 0.2, txT: 0 };
let focused = 0, fly = 0, flyAnim = null, paused = false, visible = true;
const roomPos = new THREE.Vector3(), roomQuat = new THREE.Quaternion();
const scrPos = new THREE.Vector3(), scrQuat = new THREE.Quaternion();
const tmpCam = new THREE.PerspectiveCamera();
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function roomPose() {
  const aspect = camera.aspect;
  const R = Math.max(3.9, 1.9 / aspect);
  const target = new THREE.Vector3(view.tx, 0.74, 0.05);
  const cp = Math.cos(view.pitch);
  tmpCam.position.set(target.x + R * Math.sin(view.yaw) * cp, target.y + R * Math.sin(view.pitch), target.z + R * Math.cos(view.yaw) * cp);
  tmpCam.lookAt(target);
  roomPos.copy(tmpCam.position); roomQuat.copy(tmpCam.quaternion);
}
function screenPose() {
  const cab = cabinets[focused];
  cab.group.updateWorldMatrix(true, true);
  const m = cab.screenMesh;
  m.getWorldQuaternion(scrQuat);
  const centre = m.getWorldPosition(new THREE.Vector3());
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(scrQuat);
  const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const d = Math.max((SCREEN_H / 2) / t, (SCREEN_W / 2) / (t * camera.aspect));
  scrPos.copy(centre).addScaledVector(normal, d + 0.012);
}
function animateFly(to) {
  return new Promise(resolve => {
    const from = fly, dur = reduceMotion ? 250 : 1250, t0 = performance.now();
    flyAnim = now => {
      const k = Math.min(1, (now - t0) / dur);
      fly = from + (to - from) * ease(k);
      if (k >= 1) { fly = to; flyAnim = null; resolve(); }
    };
    // safety: resolve even if rendering is throttled (hidden tab)
    setTimeout(() => { if (flyAnim) { fly = to; flyAnim = null; resolve(); } }, dur + 400);
  });
}

// coin toss
let coin = null, coinAnim = null;
function tossCoin() {
  return new Promise(resolve => {
    const cab = cabinets[focused];
    cab.group.updateWorldMatrix(true, true);
    const end = cab.door.localToWorld(new THREE.Vector3(-0.07, 0.06, 0.02));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const start = camera.position.clone().addScaledVector(fwd, 0.9).add(new THREE.Vector3(0.25, -0.2, 0));
    if (!coin) {
      const geo = new THREE.CylinderGeometry(0.035, 0.035, 0.006, 24);
      coin = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.25, metalness: 0.9, emissive: 0xffa800, emissiveIntensity: 0.5 }));
      scene.add(coin);
    }
    coin.visible = true;
    const dur = reduceMotion ? 120 : 520, t0 = performance.now();
    coinAnim = now => {
      const k = Math.min(1, (now - t0) / dur);
      coin.position.lerpVectors(start, end, k);
      coin.position.y += Math.sin(k * Math.PI) * 0.35;
      coin.rotation.set(k * 14, 0, Math.PI / 2 + k * 3);
      coin.scale.setScalar(1 - k * 0.4);
      if (k >= 1) { coin.visible = false; coinAnim = null; resolve(); }
    };
    setTimeout(() => { if (coinAnim) { coin.visible = false; coinAnim = null; resolve(); } }, dur + 300);
  });
}

// ---------------------------------------------------------------- render loop
const controls = { jx: 0, jy: 0, a: false, b: false };
function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  const pr = Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
let lastT = performance.now();
function render(now) {
  requestAnimationFrame(render);
  if (paused || !visible) { lastT = now; return; }
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const s = 1 - Math.exp(-dt * 7);
  view.tx += (view.txT - view.tx) * s;
  view.yaw += (view.yawT - view.yaw) * s;
  view.pitch += (view.pitchT - view.pitch) * s;
  if (flyAnim) flyAnim(now);
  if (coinAnim) coinAnim(now);

  roomPose();
  if (fly > 0) {
    screenPose();
    camera.position.lerpVectors(roomPos, scrPos, fly);
    camera.quaternion.slerpQuaternions(roomQuat, scrQuat, fly);
  } else {
    camera.position.copy(roomPos); camera.quaternion.copy(roomQuat);
  }

  const blink = Math.floor(now / 600) % 2 === 0;
  cabinets.forEach((cab, i) => {
    const on = i === focused;
    if (!on) drawCard(cab.card, blink);
    const k = 1 - Math.exp(-dt * 12);
    cab.pivot.rotation.y += ((on ? controls.jx : 0) * 0.42 - cab.pivot.rotation.y) * k;
    cab.pivot.rotation.x += ((on ? -controls.jy : 0) * 0.42 - cab.pivot.rotation.x) * k;
    cab.btnA.position.z = on && controls.a ? 0.006 : 0.014;
    cab.btnB.position.z = on && controls.b ? 0.006 : 0.014;
    cab.screenLight.intensity += ((on ? 2.2 : 0.5) - cab.screenLight.intensity) * s;
    cab.glow.intensity += ((on ? 6 : 2.2) - cab.glow.intensity) * s;
  });
  liveTex.needsUpdate = true;
  cabinets[focused].screenMat.color.setScalar(0.7 + 0.3 * fly);
  bloom.strength = 0.38 * (1 - fly);   // keep the game readable as the screen fills the view
  composer.render();
}

// ---------------------------------------------------------------- pointer: drag to look, click to pick
function bindPointer() {
  const el = renderer.domElement;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  el.addEventListener('pointerdown', e => {
    down = { x: e.clientX, y: e.clientY, yaw: view.yawT, pitch: view.pitchT, moved: false, id: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  el.addEventListener('pointermove', e => {
    if (!down || e.pointerId !== down.id || host.mode() !== 'room') return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) down.moved = true;
    if (!down.moved) return;
    view.yawT = THREE.MathUtils.clamp(down.yaw - dx * 0.006, -1.15, 1.15);
    view.pitchT = THREE.MathUtils.clamp(down.pitch + dy * 0.004, 0.03, 0.55);
    el.classList.add('dragging');
  });
  const up = e => {
    if (!down || e.pointerId !== down.id) return;
    const wasDrag = down.moved; down = null;
    el.classList.remove('dragging');
    if (wasDrag || host.mode() !== 'room') return;
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(cabinets.map(c => c.group), true)[0];
    if (!hit) return;
    let o = hit.object, role = o.userData.role, index;
    while (o) { if (o.userData.index !== undefined) { index = o.userData.index; break; } o = o.parent; }
    if (index === undefined) return;
    if (index !== focused) host.focus(index);
    else if (role === 'coin' || role === 'screen') host.insertCoin();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', () => { down = null; el.classList.remove('dragging'); });
}

// ---------------------------------------------------------------- public API for the host
const api = {
  focus(i, instant) {
    if (!cabinets.length) return;
    cabinets[focused].screenMat.map = cabinets[focused].card;
    focused = Math.max(0, Math.min(cabinets.length - 1, i));
    cabinets[focused].screenMat.map = liveTex;
    view.txT = cabinets[focused].group.position.x;
    view.yawT = 0.34; view.pitchT = 0.2;
    if (instant) { view.tx = view.txT; view.yaw = view.yawT; view.pitch = view.pitchT; }
  },
  coin: () => tossCoin(),
  flyIn: () => animateFly(1),
  flyOut: () => animateFly(0),
  pause() { paused = true; },
  resume() { paused = false; },
  setControls(c) { Object.assign(controls, c); },
};

async function start() {
  if (!container || !host || !host.games.length) return;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    document.body.classList.add('no3d');
    return;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (document.fonts && document.fonts.load) {
    try { await Promise.race([document.fonts.load('16px "Press Start 2P"'), new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* use fallback font */ }
  }
  build();
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  container.appendChild(renderer.domElement);
  container.classList.add('ready');
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(container);
  window.addEventListener('resize', resize);
  if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(container);
  bindPointer();
  host.attachRoom(api);
  requestAnimationFrame(render);
}
start();
