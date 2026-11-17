// three.js presentation of a match. Reads a plain view state (the local Match, or snapshots from the host),
// never touches game rules. Built once; per-frame work only moves existing objects.
import * as THREE from 'three';
import { RINK, PUCK, SKILL, SKILL_COLOR } from '../sim/constants.ts';
import type { MatchEvent, Team } from '../sim/types.ts';
import type { FightView } from '../sim/types.ts';
import { CharacterLibrary, CharacterInstance, MODEL_IDS, type ModelId } from './characters.ts';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ImpactFx } from './impact.ts';
import { crowdFlashes, fanGeometry, fanMaterial } from './crowd.ts';
import { DEFAULT_LINEUPS, type Lineup } from '../game/roster.ts';

const { halfLength: L, halfWidth: W, cornerRadius: CR, goalX: GX, goalHalfWidth: GW, netDepth: ND, blueX: BLUE_X } = RINK;
export const TEAM_COLOR = [0x2f7ff0, 0xe5483f];

export interface ViewSkater { id: number; team: Team; goalie: boolean; x: number; z: number; vx: number; vz: number; face: number; stun: number; dive?: number }
export interface ViewState {
  skaters: ViewSkater[];
  puck: { x: number; z: number; y: number; vx: number; vz: number; owner: number };
  controlled: number;        // my controlled skater id (−1 none)
  charge: number;            // my shot charge (−1 none)
  hide?: Set<number>;        // skater ids not drawn (the lobby practice's bench)
  fight?: FightView | null;  // a fight is on: these two box, the camera goes in
  focus?: { x: number; z: number };   // what the match camera follows instead of the puck (the tutorial's skating drills)
}

function rinkShape(l: number, w: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(-l + r, -w); s.lineTo(l - r, -w);
  s.absarc(l - r, -w + r, r, -Math.PI / 2, 0, false);
  s.lineTo(l, w - r); s.absarc(l - r, w - r, r, 0, Math.PI / 2, false);
  s.lineTo(-l + r, w); s.absarc(-l + r, w - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-l, -w + r); s.absarc(-l + r, -w + r, r, Math.PI, 1.5 * Math.PI, false);
  return s;
}

interface SkaterView { g: THREE.Group; body: THREE.Group; stick: THREE.Group; pip: THREE.Mesh; sway: number; spin: number; spinV: number; char: CharacterInstance | null; pads: THREE.Group | null;
  yaw: number; px: number; pz: number }   // shown body yaw (turn-rate limited) and last position

/** a used sheet of ice, painted once into the rink texture: fine grain, skate marks (thicker where play
 *  happens: centre, circles, creases), snow pushed up along the boards. All very faint */
function iceWear(g: CanvasRenderingContext2D, w: number, h: number, X: (x: number) => number, Z: (z: number) => number, sx: number) {
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9000; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.35)' : 'rgba(150,175,200,.10)'; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
  const hot = [[0, 0, 7], [-20, -6.7, 5], [-20, 6.7, 5], [20, -6.7, 5], [20, 6.7, 5], [-RINK.goalX + 3, 0, 5], [RINK.goalX - 3, 0, 5]];
  g.lineCap = 'round';
  for (let i = 0; i < 1400; i++) {
    let x: number, z: number;
    if (rnd() < 0.55) { const [hx, hz, r] = hot[Math.floor(rnd() * hot.length)]; const a = rnd() * 6.283, d = Math.sqrt(rnd()) * r; x = hx + Math.cos(a) * d; z = hz + Math.sin(a) * d; }
    else { x = (rnd() * 2 - 1) * (RINK.halfLength - 2); z = (rnd() * 2 - 1) * (RINK.halfWidth - 1.5); }
    const dir = rnd() * 6.283, len = (1 + rnd() * 4) * sx, bend = (rnd() - 0.5) * len * 0.8;
    const x0 = X(x), z0 = Z(z), x1 = x0 + Math.cos(dir) * len, z1 = z0 + Math.sin(dir) * len;
    g.strokeStyle = rnd() < 0.7 ? `rgba(130,160,190,${0.03 + rnd() * 0.045})` : `rgba(255,255,255,${0.2 + rnd() * 0.15})`;
    g.lineWidth = 0.6 + rnd() * 1.4;
    g.beginPath(); g.moveTo(x0, z0); g.quadraticCurveTo((x0 + x1) / 2 - Math.sin(dir) * bend, (z0 + z1) / 2 + Math.cos(dir) * bend, x1, z1); g.stroke();
  }
  // snow along the boards
  for (const [y0, y1] of [[0, 26], [h, h - 26]]) { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, Math.min(y0, y1), w, 26); }
  for (const [x0, x1] of [[0, 30], [w, w - 30]]) { const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(Math.min(x0, x1), 0, 30, h); }
}

const SKIN_TONES = [0xf3cfb3, 0xe2b48f, 0xc58c5e, 0x8d5a3a, 0xf7d9c4];

/** the net as a mesh of cords on the back, sides and sloping roof; the mouth (x = 0, facing the ice) is open. Built once, shared by both goals */
function goalNet() {
  const CELL = 0.16, FRONT = 1.2, BACK = 0.72, p: number[] = [];
  const line = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => p.push(x0, y0, z0, x1, y1, z1);
  const roof = (x: number) => FRONT + (BACK - FRONT) * x / ND;
  const nz = Math.round(2 * GW / CELL), nx = Math.round(ND / CELL), ny = Math.round(FRONT / CELL);
  for (let i = 0; i <= nz; i++) {                         // back wall and roof, cords running up and over
    const z = -GW + (2 * GW * i) / nz;
    line(ND, 0, z, ND, BACK, z);
    line(ND, BACK, z, 0, FRONT, z);
  }
  for (let j = 0; j <= ny; j++) {                         // cords running across the back, and round the sides from the back to the roof
    const y = (FRONT * j) / ny, end = y <= BACK ? ND : ND * (FRONT - y) / (FRONT - BACK);
    if (y <= BACK) line(ND, y, -GW, ND, y, GW);
    for (const z of [-GW, GW]) line(0, y, z, end, y, z);
  }
  for (let i = 1; i <= nx; i++) {
    const x = (ND * i) / nx;
    line(x, roof(x), -GW, x, roof(x), GW);
    for (const z of [-GW, GW]) line(x, 0, z, x, roof(x), z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return g;
}

export class HockeyScene {
  private chars = new CharacterLibrary();
  private roster: { team: Team; goalie: boolean }[] = [];
  /** who wears what this match (both clients get the same pair from the lobby) */
  private lineups: [Lineup, Lineup] = [DEFAULT_LINEUPS[0], DEFAULT_LINEUPS[1]];
  private prevOwner = -1;
  private ph: any = null;                      // placeholder + pad geometry/materials, shared by every setRoster
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** which side I play: team 1 sees the rink mirrored so it always attacks to the right */
  side: Team = 0;
  shake = 0;
  private views: SkaterView[] = [];
  private marker = new THREE.Group();
  private puckMesh: THREE.Mesh;
  private puckGlow: THREE.Mesh;
  private trail: THREE.Line;
  private trailPos: Float32Array;
  private camPos = new THREE.Vector3(0, 14, 28);
  private camLook = new THREE.Vector3();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();

  private mobile: boolean;
  private iceMat!: THREE.MeshStandardMaterial;
  constructor(canvasParent: HTMLElement, mobile: boolean) {
    this.mobile = mobile;
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;            // keeps the colours, rolls off the white ice instead of clipping it
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    canvasParent.prepend(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 300);
    this.scene.background = new THREE.Color(0x0d1620);
    this.scene.fog = new THREE.Fog(0x0d1620, 70, 140);
    this.scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x334455, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-10, 30, 14); sun.castShadow = true; sun.shadow.radius = mobile ? 2 : 3;   // soft edges (PCF)
    sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 16, bottom: -16, near: 1, far: 70 });
    this.scene.add(sun);
    // home screen only: a soft key light from the camera side so the lead skater's face and kit read clearly
    this.heroKey = new THREE.DirectionalLight(0xfff4e8, 0); this.heroKey.position.set(4, 6, 10);
    this.heroRim = new THREE.DirectionalLight(0x9fc8ff, 0); this.heroRim.position.set(-6, 5, -8);
    this.scene.add(this.heroKey, this.heroRim, this.heroKey.target, this.heroRim.target);
    this.buildRink();
    this.buildArena();
    this.buildRoof();
    this.buildGoals();
    // puck + visibility aids
    this.puckMesh = new THREE.Mesh(new THREE.CylinderGeometry(PUCK.radius, PUCK.radius, 0.07, 18), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.4 }));
    this.puckMesh.castShadow = true; this.scene.add(this.puckMesh);
    this.puckGlow = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    this.puckGlow.rotation.x = -Math.PI / 2; this.scene.add(this.puckGlow);
    this.trailPos = new Float32Array(24 * 3);
    this.trail = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
    this.trail.frustumCulled = false; this.scene.add(this.trail);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe34d, transparent: true, opacity: 0.95, depthWrite: false });
    const r = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.82, 28), ringMat); r.rotation.x = -Math.PI / 2; r.position.y = 0.03;
    const a = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.46, 3), ringMat); a.rotation.x = Math.PI; a.position.y = 2.62;
    this.marker.add(r, a); this.scene.add(this.marker);
    this.fx = new ImpactFx(this.scene);
    // metal players need something to reflect. Baked once; the generator and the source room are freed, the result lives with the page
    const pmrem = new THREE.PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.chars.metalEnv = pmrem.fromScene(room, 0.04).texture;
    this.iceMat.envMap = this.chars.metalEnv;                 // a soft sheen on the ice, no mirror (no second render)
    room.dispose(); pmrem.dispose();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  private buildRink() {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 932;
    const g = c.getContext('2d')!, sx = c.width / (2 * L), sz = c.height / (2 * W);
    const X = (x: number) => (x + L) * sx, Z = (z: number) => (z + W) * sz;
    g.fillStyle = '#eef5fa'; g.fillRect(0, 0, c.width, c.height);
    const line = (x: number, col: string, w: number) => { g.fillStyle = col; g.fillRect(X(x) - w * sx / 2, 0, w * sx, c.height); };
    line(0, '#d23a3a', 0.3); line(BLUE_X, '#2c62c9', 0.3); line(-BLUE_X, '#2c62c9', 0.3); line(GX, '#d23a3a', 0.06); line(-GX, '#d23a3a', 0.06);
    const circle = (x: number, z: number, r: number, col: string, fill = false) => {
      g.beginPath(); g.ellipse(X(x), Z(z), r * sx, r * sz, 0, 0, Math.PI * 2);
      if (fill) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = 0.06 * sx; g.stroke(); }
    };
    circle(0, 0, 4.5, '#2c62c9'); circle(0, 0, 0.15, '#2c62c9', true);
    for (const x of [-20, 20]) for (const z of [-6.7, 6.7]) { circle(x, z, 4.5, '#d23a3a'); circle(x, z, 0.3, '#d23a3a', true); }
    for (const s of [-1, 1]) {
      g.beginPath(); g.fillStyle = 'rgba(80,140,230,.55)';
      g.ellipse(X(s * GX), Z(0), 1.8 * sx, 1.8 * sz, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2); g.fill();
    }
    iceWear(g, c.width, c.height, X, Z, sx);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const geo = new THREE.ShapeGeometry(rinkShape(L, W, CR), 24);
    const uv = geo.attributes.uv, p = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + L) / (2 * L), 1 - (p.getY(i) + W) / (2 * W));
    this.iceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0, envMapIntensity: 0.22 });
    const ice = new THREE.Mesh(geo, this.iceMat);
    ice.rotation.x = -Math.PI / 2; ice.receiveShadow = true; this.scene.add(ice);
    // boards (yellow kick plate, white wall, faint glass)
    const pts = rinkShape(L, W, CR).getSpacedPoints(240);
    const wall = (h0: number, h1: number, color: number, opacity = 1) => {
      const pos: number[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        pos.push(a.x, h0, -a.y, b.x, h0, -b.y, b.x, h1, -b.y, a.x, h0, -a.y, b.x, h1, -b.y, a.x, h1, -a.y);
      }
      const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.computeVertexNormals();
      this.scene.add(new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, transparent: opacity < 1, opacity, roughness: 0.4, depthWrite: opacity >= 1 })));
    };
    wall(0, 0.22, 0xf2c230); wall(0.22, 1.07, 0xffffff); wall(1.07, 2.6, 0xbfe0ff, 0.12);
  }

  private buildArena() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 120), new THREE.MeshStandardMaterial({ color: 0x1a2733 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; this.scene.add(floor);
    // Seating bowl behind the far boards and both ends (the near side is where the camera is; setSide mirrors it).
    // Rows of seats broken by aisles, a fan on most seats (see crowd.ts), and above them the wall of lit suites. Built once at start-up.
    const ROWS = this.mobile ? 8 : 12, STEP_D = 0.85, STEP_H = 0.42, SEAT = 0.62, Y0 = 1.25, GAP = 2.2, AISLE_EVERY = 15;
    const stand = this.crowd;
    type Fan = { x: number; y: number; z: number; q: THREE.Quaternion; size: number; shirt: THREE.Color; skin: THREE.Color; hair: THREE.Color; home: number };
    const blocks: { m: THREE.Matrix4; c: THREE.Color }[] = [], fans: Fan[] = [], flashes: number[] = [];
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = (list: THREE.Color[]) => list[Math.floor(rnd() * list.length)];
    const colours = (hexes: number[]) => hexes.map(c => new THREE.Color(c));
    const skins = colours([0xf3cfb3, 0xe2b48f, 0xc58c5e, 0x8d5a3a, 0xf7d9c4, 0x6b4630]);
    const hairs = colours([0x1a1512, 0x2a1d14, 0x3a2a1c, 0x6b4a2a, 0xa98a5c, 0x74777e, 0xd9dde2]);
    // most of a real crowd is coats and hoodies; jerseys are the accent, not the whole stand
    const street = colours([0x20232a, 0x2c3038, 0x3d424c, 0x596170, 0xd9dde4, 0x25324a, 0x4b3628, 0x3f4a35, 0x6b2530, 0x8a7a5f]);
    const DIM = 0.42;                                               // the stands sit in the dark, the ice is where the light is
    const stepColour = new THREE.Color(0x0c1218), aisleColour = new THREE.Color(0x1c2530);
    const seats = colours([0x173257, 0x1d3d69]), upperSeats = colours([0x2a3442, 0x323d4c]);
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const box = (x: number, y: number, z: number, rot: THREE.Quaternion, sx: number, sy: number, sz: number, c: THREE.Color) =>
      blocks.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), rot, new THREE.Vector3(sx, sy, sz)), c });
    /** one straight section: rows rise away from the ice along `out` (unit, horizontal), seats run along `along` */
    const section = (cx: number, cz: number, ox: number, oz: number, len: number) => {
      const ax = -oz, az = ox;                                     // along = out turned 90°
      q.setFromAxisAngle(up, Math.atan2(ox, oz));
      const rot = q.clone();
      for (let r = 0; r < ROWS; r++) {
        const d = GAP + r * STEP_D, y = Y0 + r * STEP_H, shade = DIM * (1 - 0.4 * r / (ROWS - 1));   // the light falls off towards the back
        const px = cx + ox * d, pz = cz + oz * d;
        box(px, y / 2, pz, rot, len, y, STEP_D, stepColour);
        const n = Math.floor(len / SEAT), seatTone = r < ROWS * 0.6 ? seats : upperSeats;
        for (let i = 0; i < n; i++) {
          const t0 = (i + 0.5) * SEAT - len / 2, sx = px + ax * t0, sz = pz + az * t0;
          if (i % AISLE_EVERY === AISLE_EVERY - 1) { box(sx, y + 0.012, sz, rot, SEAT * 0.96, 0.03, STEP_D, aisleColour); continue; }
          box(sx + ox * 0.27, y + 0.2, sz + oz * 0.27, rot, SEAT * 0.86, 0.4, 0.09, pick(seatTone).clone().multiplyScalar(shade));
          box(sx - ox * 0.02, y + 0.04, sz - oz * 0.02, rot, SEAT * 0.86, 0.08, 0.44, pick(seatTone).clone().multiplyScalar(shade));
          // empty seats come in patches (a group that left, a block sold short), more of them high up
          const gap = 0.05 + 0.1 * r / ROWS + 0.22 * Math.max(0, Math.sin(i * 0.13 + cx * 0.21 + cz * 0.17 + r * 0.45) * Math.sin(i * 0.041 + r * 0.9 + 1.3));
          if (rnd() < gap) continue;
          const lit = 0.8 + rnd() * 0.32;                           // no two fans the same brightness
          const t = t0 + (rnd() - 0.5) * 0.07, fx = px + ax * t, fz = pz + az * t, home = fx < 0;
          const kind = rnd();
          let shirt: THREE.Color;
          if (kind < 0.3) shirt = new THREE.Color(TEAM_COLOR[home ? 0 : 1]).offsetHSL((rnd() - 0.5) * 0.03, -0.1 * rnd(), (rnd() - 0.5) * 0.14);
          else if (kind < 0.38) shirt = new THREE.Color(TEAM_COLOR[home ? 1 : 0]).offsetHSL(0, -0.1, (rnd() - 0.5) * 0.12);   // away fans among the home end
          else if (kind < 0.42) shirt = new THREE.Color(0xf2c230);
          else shirt = pick(street).clone();
          const cap = rnd() < 0.22;                                 // a cap or beanie takes the place of the hair
          const hair = (cap ? (rnd() < 0.6 ? new THREE.Color(TEAM_COLOR[home ? 0 : 1]) : pick(street).clone()) : pick(hairs).clone()).multiplyScalar(shade);
          fans.push({ x: fx, y, z: fz, q: rot, size: 0.88 + rnd() * 0.26, shirt: shirt.multiplyScalar(shade * lit), skin: pick(skins).clone().multiplyScalar((0.55 + 0.3 * shade) * lit), hair: hair.multiplyScalar(lit), home: home ? 1 : -1 });
          if (rnd() < 0.2) flashes.push(fx, y + 0.9, fz);
        }
      }
    };
    const LL = L + 1.5, WW = W + 0.5;
    section(0, -WW, 0, -1, 2 * LL);                                 // far long side
    // ends: only the far half. The near half sat beside the camera and showed a big sunlit side wall whenever
    // play was in an end zone
    const endLen = WW + 3, endZ = -WW + endLen / 2;
    section(-LL, endZ, -1, 0, endLen);
    section(LL, endZ, 1, 0, endLen);
    const blockMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.95 }), blocks.length);
    blocks.forEach((b, i) => { blockMesh.setMatrixAt(i, b.m); blockMesh.setColorAt(i, b.c); });
    const fanGeo = fanGeometry(), N = fans.length;
    const shirts = new Float32Array(N * 3), skinsA = new Float32Array(N * 3), hairsA = new Float32Array(N * 3), seeds = new Float32Array(N), homes = new Float32Array(N);
    const crowdMesh = new THREE.InstancedMesh(fanGeo, fanMaterial(this.crowdU), N);
    const mat4 = new THREE.Matrix4(), at = new THREE.Vector3(), sz = new THREE.Vector3();
    fans.forEach((f, i) => {
      crowdMesh.setMatrixAt(i, mat4.compose(at.set(f.x, f.y, f.z), f.q, sz.setScalar(f.size)));
      f.shirt.toArray(shirts, i * 3); f.skin.toArray(skinsA, i * 3); f.hair.toArray(hairsA, i * 3);
      seeds[i] = rnd(); homes[i] = f.home;
    });
    fanGeo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirts, 3));
    fanGeo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skinsA, 3));
    fanGeo.setAttribute('aHair', new THREE.InstancedBufferAttribute(hairsA, 3));
    fanGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    fanGeo.setAttribute('aHome', new THREE.InstancedBufferAttribute(homes, 1));
    for (const m of [blockMesh, crowdMesh]) { m.frustumCulled = false; stand.add(m); }
    stand.add(crowdFlashes(flashes, this.crowdU));
    // the back wall: a dark band of suites with their windows lit, closing the bowl off behind the top row
    const suite = document.createElement('canvas'); suite.width = 256; suite.height = 32;
    const sg = suite.getContext('2d')!;
    sg.fillStyle = '#0a0f17'; sg.fillRect(0, 0, 256, 32);
    for (let i = 0; i < 16; i++) { sg.fillStyle = ['#26241f', '#332c22', '#1e232b', '#2d2820'][(i * 7) % 4]; sg.fillRect(2 + i * 16, 9, 13, 14); }
    const suiteTex = new THREE.CanvasTexture(suite); suiteTex.colorSpace = THREE.SRGBColorSpace; suiteTex.wrapS = THREE.RepeatWrapping;
    const suiteMat = new THREE.MeshBasicMaterial({ map: suiteTex, fog: false }), wallMat = new THREE.MeshBasicMaterial({ color: 0x0a0f17 });
    const WALL_D = GAP + ROWS * STEP_D - STEP_D / 2, WALL_Y = Y0 + ROWS * STEP_H;
    const backWall = (cx: number, cz: number, ox: number, oz: number, len: number) => {
      const yaw = Math.atan2(-ox, -oz), wx = cx + ox * WALL_D, wz = cz + oz * WALL_D;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, 9), wallMat); wall.position.set(wx, WALL_Y + 4, wz); wall.rotation.y = yaw; stand.add(wall);
      const geo = new THREE.PlaneGeometry(len, 0.8), uv = geo.attributes.uv, tiles = Math.round(len / 9);
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * tiles);
      const strip = new THREE.Mesh(geo, suiteMat); strip.position.set(wx - ox * 0.02, WALL_Y + 1.1, wz - oz * 0.02); strip.rotation.y = yaw; stand.add(strip);
    };
    backWall(0, -WW, 0, -1, 2 * LL + 2 * WALL_D); backWall(-LL, endZ, -1, 0, endLen); backWall(LL, endZ, 1, 0, endLen);
    // banners hanging on the far wall above the suites, in the two teams' colours (one instanced draw)
    const bc = document.createElement('canvas'); bc.width = 64; bc.height = 128;
    const bg2 = bc.getContext('2d')!;
    bg2.fillStyle = '#fff'; bg2.fillRect(0, 0, 64, 128);
    bg2.fillStyle = '#c9c9c9'; bg2.fillRect(0, 14, 64, 5); bg2.fillRect(0, 96, 64, 5);
    bg2.clearRect(0, 112, 64, 16); bg2.beginPath(); bg2.moveTo(0, 112); bg2.lineTo(32, 127); bg2.lineTo(64, 112); bg2.fill();
    const bannerTex = new THREE.CanvasTexture(bc); bannerTex.colorSpace = THREE.SRGBColorSpace;
    const BN = 10, banners = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 3), new THREE.MeshBasicMaterial({ map: bannerTex, alphaTest: 0.5 }), BN);
    for (let i = 0; i < BN; i++) {
      const x = (i - (BN - 1) / 2) * 5.2;
      banners.setMatrixAt(i, mat4.compose(at.set(x, WALL_Y + 3.4, -WW - WALL_D + 0.05), q.identity(), sz.setScalar(1)));
      banners.setColorAt(i, new THREE.Color(i % 5 === 2 ? 0xd8c27a : TEAM_COLOR[i % 2]).multiplyScalar(0.06));
    }
    stand.add(banners);
    // LED ribbon along the front of the first tier. It is an ad strip: one 728x90 leaderboard (the standard web
    // ad size) per tile, 0.75 m tall x 6.07 m long on the rink, so a real banner drops in pixel for pixel later
    // (see setRibbonAd). Until then the game's own logo.
    const AD_W = 728, AD_H = 90, RIB_H = 1.15, TILE = RIB_H * AD_W / AD_H;      // 1.15 m tall: reads clearly from the match camera
    const c = document.createElement('canvas'); c.width = AD_W; c.height = AD_H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#071019'; g.fillRect(0, 0, AD_W, AD_H);
    g.font = 'bold 56px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillStyle = '#4aa3ff'; g.fillText('FACE', AD_W / 2 - 150, AD_H / 2 + 2);
    g.fillStyle = '#ff5a4a'; g.fillText('-OFF!', AD_W / 2 + 80, AD_H / 2 + 2);
    this.ribbonTex = new THREE.CanvasTexture(c); this.ribbonTex.colorSpace = THREE.SRGBColorSpace; this.ribbonTex.wrapS = THREE.RepeatWrapping; this.ribbonTex.anisotropy = 4;
    const ribbonMat = new THREE.MeshBasicMaterial({ map: this.ribbonTex });
    const ribbon = (cx: number, cz: number, ox: number, oz: number, len: number) => {
      const tiles = Math.max(1, Math.round(len / TILE));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(tiles * TILE, RIB_H), ribbonMat);
      const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * tiles);
      m.position.set(cx + ox * (GAP - STEP_D / 2 - 0.01), Y0 - RIB_H / 2 - 0.05, cz + oz * (GAP - STEP_D / 2 - 0.01));
      m.rotation.y = Math.atan2(-ox, -oz);
      stand.add(m);
    };
    ribbon(0, -WW, 0, -1, 2 * LL); ribbon(-LL, endZ, -1, 0, endLen); ribbon(LL, endZ, 1, 0, endLen);
    this.scene.add(stand);
    // dasher-board ads, like a real rink: the white boards along both long sides carry the same 728x90 creative
    // (0.8 m tall, one tile per 6.5 m), on the inside face so the match camera sees the far side
    const BOARD_H = 0.8, BTILE = BOARD_H * AD_W / AD_H, straight = 2 * (L - CR);
    const tiles = Math.max(1, Math.round(straight / BTILE));
    const boardGeo = new THREE.PlaneGeometry(tiles * BTILE, BOARD_H);
    const buv = boardGeo.attributes.uv; for (let i = 0; i < buv.count; i++) buv.setX(i, buv.getX(i) * tiles);
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(boardGeo, ribbonMat);
      m.position.set(0, 0.24 + BOARD_H / 2, side * (W - 0.015));
      m.rotation.y = side < 0 ? 0 : Math.PI;
      this.scene.add(m);
    }
  }
  /** the roof: steel trusses, rows of arena lights under them, the scoreboard over centre ice. Four draw calls,
   *  built once. Unlit (the lights are the bright thing up there; the steel is a dark silhouette) */
  private buildRoof() {
    const Y = 15.5, SPAN_X = L + 14, SPAN_Z = W + 14;
    const steel = new THREE.MeshBasicMaterial({ color: 0x0b121b });
    const beams: THREE.Matrix4[] = [], lamps: THREE.Matrix4[] = [];
    const m = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    for (let z = -SPAN_Z + 2; z <= SPAN_Z - 2; z += 7.5) {
      beams.push(m(0, Y, z, 2 * SPAN_X, 0.18, 0.18), m(0, Y - 0.9, z, 2 * SPAN_X, 0.18, 0.18));        // a truss: two chords...
      for (let x = -SPAN_X; x <= SPAN_X; x += 1.8) beams.push(m(x, Y - 0.45, z, 0.08, 0.9, 0.08));    // ...and its posts
      if (z < -4) for (let x = -L + 2; x <= L - 2; x += 5.5) lamps.push(m(x, Y - 1.1, z, 1.1, 0.14, 0.5));   // the far half: near ones would hang in the lobby shot
    }
    for (const x of [-SPAN_X + 4, -12, 12, SPAN_X - 4]) beams.push(m(x, Y + 0.1, 0, 0.3, 0.3, 2 * SPAN_Z));
    const truss = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, beams.length);
    beams.forEach((b, i) => truss.setMatrixAt(i, b));
    const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xfff3dc, fog: false }), lamps.length);
    lamps.forEach((b, i) => lights.setMatrixAt(i, b));
    // centre-hung scoreboard: dark box, a screen on each side
    const sc = document.createElement('canvas'); sc.width = 256; sc.height = 128;
    const g = sc.getContext('2d')!;
    g.fillStyle = '#050a10'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#0d1a28'; g.fillRect(8, 8, 240, 112);
    g.font = 'bold 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#7fb6ea'; g.fillText('FACE', 92, 64); g.fillStyle = '#e0505a'; g.fillText('OFF', 182, 64);
    const screenTex = new THREE.CanvasTexture(sc); screenTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.MeshBasicMaterial({ map: screenTex, fog: false }), case_ = new THREE.MeshBasicMaterial({ color: 0x080d14 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), [screen, screen, case_, case_, screen, screen]);
    board.position.set(0, 11.5, 0);
    for (const o of [truss, lights, board]) { o.frustumCulled = false; this.roof.add(o); }
    this.scene.add(this.roof);
  }
  /** trusses, lights and scoreboard: home screen only. The match camera (34 m up in a tall frame) looks down through them */
  private roof = new THREE.Group();
  /** stands + crowd (mirrored to the far side when the view flips) */
  private crowd = new THREE.Group();
  private crowdU = { uTime: { value: 0 }, uCheer: { value: 0 }, uLead: { value: 0 } };
  private ribbonTex!: THREE.CanvasTexture;
  /** swap the ribbon's ad: a 728x90 image (leaderboard) fills one tile; wider images are squeezed to that ratio */
  setRibbonAd(img: HTMLImageElement | HTMLCanvasElement) {
    const c = this.ribbonTex.image as HTMLCanvasElement;
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    this.ribbonTex.needsUpdate = true;
  }
  private cheer = 0;
  private idle = true;
  /** where a fight is going on (the camera goes there) */
  private fightAt: [number, number] | null = null;
  private fightOver = false;

  private buildGoals() {
    const red = new THREE.MeshStandardMaterial({ color: 0xd8282b, roughness: 0.3 });
    const net = new THREE.LineBasicMaterial({ color: 0x5d7088, transparent: true, opacity: 0.9 });   // grey-blue: white mesh vanished against the white ice
    const netG = goalNet();
    const postG = new THREE.CylinderGeometry(0.05, 0.05, 1.22, 10), barG = new THREE.CylinderGeometry(0.05, 0.05, 2 * GW, 10);
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      for (const z of [-GW, GW]) { const p = new THREE.Mesh(postG, red); p.position.set(0, 0.61, z); g.add(p); }
      const bar = new THREE.Mesh(barG, red); bar.rotation.x = Math.PI / 2; bar.position.y = 1.22; g.add(bar);
      const back = new THREE.LineSegments(netG, net); back.scale.x = s; g.add(back);
      g.position.x = s * GX; this.scene.add(g);
    }
  }

  /** placeholder skater bodies (capsules); replaced by character models later */
  setRoster(list: { team: Team; goalie: boolean }[]) {
    for (const v of this.views) { v.char?.dispose(); this.scene.remove(v.g); }
    this.views = [];
    this.roster = list;
    const { pants, skin, stickM, pad, jersey, ringM, pipM, G } = this.ph ??= (() => {
    const pants = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0c9a8, roughness: 0.6 });
    const stickM = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.7 });
    const pad = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5 });
    const jersey = TEAM_COLOR.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    const ringM = TEAM_COLOR.map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, depthWrite: false }));
    const pipM = TEAM_COLOR.map(c => new THREE.MeshBasicMaterial({ color: c }));   // shared by every skater for the life of the page: never dispose
    const G = {
      pip: new THREE.ConeGeometry(0.15, 0.24, 4),
      body: new THREE.CapsuleGeometry(0.3, 0.55, 4, 10), legs: new THREE.CapsuleGeometry(0.22, 0.4, 4, 8),
      head: new THREE.SphereGeometry(0.17, 14, 10), helmet: new THREE.SphereGeometry(0.19, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      shaft: new THREE.BoxGeometry(0.04, 0.04, 1.35), blade: new THREE.BoxGeometry(0.05, 0.1, 0.32), pad: new THREE.BoxGeometry(0.28, 0.75, 0.3),
      ring: new THREE.RingGeometry(0.5, 0.62, 28),
    };
      return { pants, skin, stickM, pad, jersey, ringM, pipM, G };
    })();
    for (const s of list) {
      const g = new THREE.Group(), body = new THREE.Group();
      const legs = new THREE.Mesh(G.legs, pants); legs.position.y = 0.45;
      const torso = new THREE.Mesh(G.body, jersey[s.team]); torso.position.y = 1.12; if (s.goalie) torso.scale.set(1.35, 1, 1.35);
      const head = new THREE.Mesh(G.head, skin); head.position.y = 1.72;
      const helm = new THREE.Mesh(G.helmet, s.goalie ? pad : jersey[s.team]); helm.position.y = 1.74;
      body.add(legs, torso, head, helm);
      if (s.goalie) for (const z of [-0.2, 0.2]) { const p = new THREE.Mesh(G.pad, pad); p.position.set(0.12, 0.38, z); body.add(p); }
      const stick = new THREE.Group();
      const shaft = new THREE.Mesh(G.shaft, stickM); shaft.position.set(0, 0, 0.62); stick.add(shaft);
      const blade = new THREE.Mesh(G.blade, stickM); blade.position.set(0, -0.02, 1.32); blade.rotation.y = Math.PI / 2; stick.add(blade);
      stick.position.set(0, 1.0, 0.18); stick.rotation.x = 0.62; body.add(stick);
      body.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      g.add(body);
      const ring = new THREE.Mesh(G.ring, ringM[s.team]); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
      const pip = new THREE.Mesh(G.pip, pipM[s.team]); pip.rotation.x = Math.PI; pip.position.y = s.goalie ? 2.22 : 2.12; g.add(pip);   // realistic models wear no team colour of their own
      this.scene.add(g);
      this.views.push({ g, body, stick, pip, sway: Math.random() * 6, spin: 0, spinV: 0, char: null, pads: null, yaw: NaN, px: 0, pz: 0 });
    }
    this.attachCharacters();
  }

  /** load the character models (once) and swap them in for the capsules */
  loadCharacters(ids: readonly ModelId[] = MODEL_IDS, onProgress?: (f: number) => void) {
    return this.chars.load(ids, onProgress).then(() => this.attachCharacters()).catch(e => console.warn('characters failed, keeping placeholders', e));
  }
  /** fetch the models these ids need; their skaters switch from placeholder to model as soon as they arrive */
  ensureModels(ids: readonly ModelId[]) {
    if (ids.every(id => this.chars.has(id))) return Promise.resolve();
    return this.loadCharacters(ids);
  }
  /** swap the models to a match's lineups (call before setRoster / at match start) */
  setLineups(l: [Lineup, Lineup]) {
    if (l[0] === this.lineups[0] && l[1] === this.lineups[1]) return;
    this.lineups = l;
    void this.ensureModels([...l[0].skaters, l[0].goalie, ...l[1].skaters, l[1].goalie]);
    for (const v of this.views) { if (v.char) { v.char.dispose(); v.char = null; v.body.children.forEach(ch => { ch.visible = true; }); } }
    this.attachCharacters();
  }
  private attachCharacters() {
    if (!this.chars.ready) return;
    const slots = [0, 0];
    this.views.forEach((v, i) => {
      const { team, goalie } = this.roster[i];
      const slot = goalie ? 3 : slots[team]++;
      if (v.char) return;
      const id = goalie ? this.lineups[team].goalie : this.lineups[team].skaters[slot];
      const c = this.chars.spawn(id, team, TEAM_COLOR[team], SKIN_TONES[(i * 2 + 1) % SKIN_TONES.length], goalie ? 1.85 : 1.75, goalie);
      if (!c) return;
      v.char = c; v.g.add(c.group);
      v.body.children.slice().forEach(ch => { if (ch !== v.stick) ch.visible = false; });
      // the modelled stick replaces the two placeholder boxes (made once per view, shared geometry / material)
      if (!v.stick.userData.model) {
        const m = this.chars.gear.stick(team);
        if (m) { v.stick.children.forEach(ch => { ch.visible = false; }); v.stick.add(m); v.stick.userData.model = m; }
      }
    });
  }

  private tmpH = new THREE.Vector3();
  private tmpP = new THREE.Vector3();
  /** the stick follows the right hand: grip at the hand, blade on the ice — on the puck when carrying it,
   *  otherwise a little ahead and to the forehand side */
  private gripStick(view: SkaterView, puck: { x: number; z: number } | null) {
    const fist = view.char?.fist;
    if (!fist) return;
    fist.updateWorldMatrix(true, false);
    view.g.worldToLocal(fist.getWorldPosition(this.tmpH));
    const hand = this.tmpH;
    let tx = -0.25, tz = 1.0;                                   // default blade spot (group local: +z forward)
    if (puck) { view.g.worldToLocal(this.tmpP.set(puck.x, 0, puck.z)); tx = this.tmpP.x; tz = this.tmpP.z; }
    const dx = tx - hand.x, dz = tz - hand.z, flat = Math.max(0.2, Math.hypot(dx, dz));
    const yaw = Math.atan2(dx, dz), pitch = Math.atan2(Math.max(0.1, hand.y - 0.03), flat);
    view.stick.rotation.set(pitch, yaw, 0, 'YXZ');
    // the shaft runs from 0 to ~1.35 along the stick's +z; slide it so the blade lands on the target spot
    const len = Math.hypot(flat, hand.y), back = Math.max(0, 1.32 * view.stick.scale.z - len);
    const ux = Math.sin(yaw) * Math.cos(pitch), uy = -Math.sin(pitch), uz = Math.cos(yaw) * Math.cos(pitch);
    view.stick.position.set(hand.x - ux * back, hand.y - uy * back, hand.z - uz * back);
  }

  /** tutorial: a gold ring on the ice to skate to (shared geometry / material, made once) */
  private drillRing: THREE.Mesh | null = null;
  setDrillTarget(p: { x: number; z: number } | null) {
    if (!this.drillRing) {
      this.drillRing = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 40), new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.85, depthWrite: false }));
      this.drillRing.rotation.x = -Math.PI / 2; this.scene.add(this.drillRing);
    }
    this.drillRing.visible = !!p;
    if (p) this.drillRing.position.set(p.x, 0.03, p.z);
  }

  /** skill rings on the ice, one per skater: one shared geometry, materials made once and only recoloured */
  private bursts: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; radius: number }[] = [];
  burst(id: number, color: number, radius: number) {
    if (!this.bursts.length) {
      const geo = new THREE.RingGeometry(0.8, 1, 48);
      for (let i = 0; i < 8; i++) {
        const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2; mesh.visible = false; this.scene.add(mesh);
        this.bursts.push({ mesh, mat, t: 0, radius: 1 });
      }
    }
    const b = this.bursts[id];
    if (!b) return;
    b.mat.color.setHex(color); b.t = 0; b.radius = radius; b.mesh.visible = true;
  }
  private stepBursts(dt: number) {
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i];
      if (!b.mesh.visible) continue;
      b.t += dt / 0.5;
      if (b.t >= 1) { b.mesh.visible = false; continue; }
      const grow = 1 - (1 - b.t) ** 3, at = this.views[i].g.position;
      b.mesh.scale.setScalar(0.5 + (b.radius - 0.5) * grow);
      b.mesh.position.set(at.x, 0.04, at.z);
      b.mat.opacity = 0.9 * (1 - b.t);
    }
  }

  /** goal celebrations and the final-whistle poses: matches only (the lobby rink, tutorial and scout reveal score goals too) */
  celebrations = false;
  /** the scoring team raises its sticks (scorer first, the others joining in), the other team bends over its sticks */
  private celebrate(team: Team, by: number, seconds: number) {
    const order = [0, 0];
    for (let i = 0; i < this.views.length; i++) {
      const c = this.views[i].char, r = this.roster[i];
      if (!c || !r) continue;
      if (r.team === team) c.cheer('win', i === by ? 0 : r.goalie ? 0.55 : 0.18 + 0.14 * order[0]++, seconds);
      else c.cheer('lose', 0.3 + 0.1 * order[1]++, seconds);
    }
  }
  private stopCelebrating() { for (const v of this.views) v.char?.stopCheer(); }

  /** simulation events the bodies react to: the body-check lunge plays the checker's BodyCheck */
  onEvent(e: MatchEvent) {
    if (this.celebrations) {
      if (e.t === 'goal') this.celebrate(e.team, e.by, 3);                      // held until the face-off
      else if (e.t === 'end') {
        const [a, b] = e.shootout && e.score[0] === e.score[1] ? e.shootout : e.score;
        if (a !== b) this.celebrate(a > b ? 0 : 1, -1, 12);                      // until the result screen
      } else if (e.t === 'faceoff' || e.t === 'shootoutStart') this.stopCelebrating();
    }
    if (e.t === 'lunge') this.views[e.by]?.char?.trigger('check');
    if (e.t === 'fake') this.views[e.by]?.char?.trigger('shot');                 // shows the shot, keeps the puck
    if (e.t === 'skill') this.burst(e.by, SKILL_COLOR[e.kind], e.kind === 'sweep' ? SKILL.sweep.radius : 1.9);
    if (e.t === 'goal' || e.t === 'shootoutResult' && e.scored || e.t === 'fightStart' || e.t === 'fightEnd') this.cheer = 1;     // the crowd jumps
    if (e.t === 'goal') this.crowdU.uLead.value = e.team === 0 ? 1 : -1; else if (e.t === 'fightStart' || e.t === 'fightEnd') this.crowdU.uLead.value = 0;
    if (e.t === 'check') { this.contact(e.by, e.on, e.hard ? 1 : 0.55, e.hard ? 0.09 : 0.04, e.hard); if (e.hard) this.cheer = Math.max(this.cheer, 0.7); }
    if (e.t === 'bump') this.contact(e.by, e.on, 0.3, 0, false);
    if (e.t === 'collide') { const k = Math.min(1, e.speed / 10); this.contact(e.a, e.b, 0.3 + 0.35 * k, 0.02, false); this.tip(e.a, e.b, 0.3 + 0.35 * k); }
    if (e.t === 'boardHit') this.boardImpact(e.on, e.speed);
    if (e.t === 'fightHit') this.punch(e.by, e.on, 0.9, 0.07, 0xffc42e, 1.05);
    if (e.t === 'fightBlock') this.punch(this.fighters[0] === e.on ? this.fighters[1] : this.fighters[0], e.on, 0.25, 0.025, 0x35d0ff, 0.7);
    if (e.t === 'fightEnd' && e.ko && e.by >= 0) {
      const on = this.fighters[0] === e.by ? this.fighters[1] : this.fighters[0];
      this.punch(e.by, on, 1.4, 0.22, 0xff5a3c, 2.1);
      const v = this.views[on];
      if (v) v.spinV = 5;
    }
  }

  // ------------------------------------------------------------------ the feel of a hit
  private fx: ImpactFx;
  private hold = 0;                     // seconds the bodies stay frozen at the moment of impact
  private kick = new THREE.Vector3();   // the camera is knocked along the hit
  private kickLook = new THREE.Vector3();
  private zoom = 0;
  private fighters: [number, number] = [-1, -1];
  private dirX = 0;
  private dirZ = 0;
  /** unit direction from one skater to another into dirX, dirZ; false when either has no body */
  private aim(by: number, on: number) {
    const a = this.views[by]?.g.position, b = this.views[on]?.g.position;
    if (!a || !b) return false;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
    this.dirX = dx / d; this.dirZ = dz / d;
    return true;
  }
  /** throw skater `id` along (dx, dz) by amount */
  private throwBody(id: number, dx: number, dz: number, amount: number) {
    const v = this.views[id];
    if (!v?.char || Number.isNaN(v.yaw)) return;
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
    v.char.impact(dx * c - dz * s, dx * s + dz * c, amount);
  }
  private tip(by: number, on: number, amount: number) { if (this.aim(by, on)) this.throwBody(by, -this.dirX, -this.dirZ, amount); }
  private jolt(amount: number, reach: number, hold: number) {
    this.kick.set(this.dirX * reach, -reach * 0.3, this.dirZ * reach);
    this.zoom = Math.max(this.zoom, amount);
    this.hold = Math.max(this.hold, hold);
  }
  /** a body check or a collision on the ice */
  private contact(by: number, on: number, amount: number, hold: number, spin: boolean) {
    if (!this.aim(by, on)) return;
    this.throwBody(on, this.dirX, this.dirZ, amount);
    this.throwBody(by, this.dirX, this.dirZ, amount * 0.35);          // the hitter drives through
    this.jolt(amount, amount * 0.85, hold);
    const b = this.views[on].g.position, a = this.views[by].g.position, x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
    this.fx.spray(b.x, 0.1, b.z, this.dirX, this.dirZ, Math.round(30 * amount), 3 + 5 * amount, 0x9fc6ee);
    if (amount >= 0.5) this.fx.star(x, 1.05, z, 0.9 + 1.1 * amount, 0xffc42e);
    if (spin) this.views[on].spinV = (this.dirX * Math.sin(this.views[on].yaw) >= 0 ? 1 : -1) * 8;
  }
  private boardImpact(on: number, speed: number) {
    const v = this.views[on];
    if (!v) return;
    const b = v.g.position, k = Math.min(1, speed / 10), len = Math.hypot(b.x, b.z) || 1;
    this.dirX = b.x / len; this.dirZ = b.z / len;
    this.jolt(0.8 * k + 0.2, 0.9 * k, 0.08);
    this.fx.spray(b.x, 0.3, b.z, -this.dirX, -this.dirZ, 26, 6, 0x9fc6ee);
    this.fx.star(b.x, 1.1, b.z, 1.4 + k, 0xffffff);
    this.throwBody(on, -this.dirX, -this.dirZ, 0.7 * k);
    this.cheer = Math.max(this.cheer, 0.8);
  }
  /** a fist landing */
  private punch(by: number, on: number, amount: number, hold: number, color: number, size: number) {
    if (!this.aim(by, on)) return;
    this.throwBody(on, this.dirX, this.dirZ, amount);
    this.jolt(amount, 0.34 * amount, hold);
    const a = this.views[by].g.position, b = this.views[on].g.position, x = a.x + (b.x - a.x) * 0.8, z = a.z + (b.z - a.z) * 0.8;
    this.fx.star(x, 1.4, z, size, color);
    this.fx.spray(x, 1.4, z, this.dirX, this.dirZ, Math.round(16 * amount), 3.5, 0xfff0c0);
    this.cheer = Math.max(this.cheer, 0.45 * amount);
  }
  /** hit-stop timer, camera recovery, particles: real time, once a frame */
  private stepFeel(dt: number) {
    this.hold = Math.max(0, this.hold - dt);
    this.fx.step(dt);
    this.kick.multiplyScalar(Math.exp(-dt * 10));
    this.zoom = this.zoom < 0.002 ? 0 : this.zoom * Math.exp(-dt * 7);
    const fov = 38 - this.zoom * 2.6;
    if (fov !== this.camera.fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  /** team 1 watches from the other side so it also attacks to the right of the screen */
  setSide(t: Team) {
    this.side = t;
    this.crowd.rotation.y = t === 0 ? 0 : Math.PI;      // a turn, not a mirror: the ribbon text stays readable
    this.camPos.set(0, 14, t === 0 ? 28 : -28);
  }

  update(v: ViewState, dt: number, time: number) {
    this.idle = v.skaters.length === 0;
    const bodyDt = this.hold > 0 ? dt * 0.06 : dt;          // hit-stop: the bodies hold still at the moment of impact
    if (v.fight) { this.fighters[0] = v.fight.a; this.fighters[1] = v.fight.b; this.fightOver = v.fight.over; const a = v.skaters[v.fight.a], b = v.skaters[v.fight.b]; (this.fightAt ??= [0, 0])[0] = (a.x + b.x) / 2; this.fightAt[1] = (a.z + b.z) / 2; }
    else this.fightAt = null;
    this.crowdU.uTime.value = time; this.time = time;
    this.roof.visible = this.idle || (!!this.hero && !this.cinema);
    this.cheer = Math.max(0, this.cheer - dt * 0.35);
    this.crowdU.uCheer.value = this.cheer;
    for (let i = 0; i < this.views.length; i++) this.views[i].g.visible = i < v.skaters.length && !v.hide?.has(i);
    for (let i = 0; i < v.skaters.length && i < this.views.length; i++) {
      const s = v.skaters[i], view = this.views[i];
      // the simulation turns the facing fast (a reversal swings it ~30° in one frame); the body turns at most
      // ~11 rad/s and eases in. A teleport (face-off, shootout setup) snaps.
      const yaw = -s.face + Math.PI / 2;
      if (Number.isNaN(view.yaw) || Math.hypot(s.x - view.px, s.z - view.pz) > 1.5 || dt <= 0 || dt > 0.25) view.yaw = yaw;
      else {
        const d = Math.atan2(Math.sin(yaw - view.yaw), Math.cos(yaw - view.yaw)), max = 11 * dt;
        view.yaw += THREE.MathUtils.clamp(d * (1 - Math.exp(-dt * 16)), -max, max);
      }
      view.px = s.x; view.pz = s.z;
      view.g.position.set(s.x, 0, s.z);
      if (view.spinV !== 0 || view.spin !== 0) {             // knocked spinning on the ice; turns back once he is up
        view.spin += view.spinV * bodyDt;
        view.spinV *= Math.exp(-bodyDt * 3);
        if (Math.abs(view.spinV) < 0.05) view.spinV = 0;
        if (s.stun <= 0 && Math.abs(view.spinV) < 2) { view.spinV = 0; const back = Math.atan2(Math.sin(view.spin), Math.cos(view.spin)); view.spin = Math.abs(back) < 0.02 ? 0 : back * Math.exp(-dt * 11); }
      }
      view.g.rotation.y = view.yaw + view.spin;
      const sp = Math.hypot(s.vx, s.vz);
      if (view.char) {
        view.char.update({ speed: sp, vx: s.vx, vz: s.vz, hasPuck: v.puck.owner === s.id, stun: s.stun, dive: s.dive ?? 0, charging: s.id === v.controlled && v.charge > 0, charge: s.id === v.controlled ? Math.max(0, v.charge) : 0 }, bodyDt);
        const f = v.fight, k = f && s.id === f.a ? 0 : f && s.id === f.b ? 1 : -1;
        view.stick.visible = k === -1;                              // sticks and gloves come off for a fight
        if (f && k !== -1) { if (s.stun <= 0) { view.char.fightPose(f.act[k], f.hand[k], f.p[k]); view.g.translateX(view.char.fightShift.x); view.g.translateZ(view.char.fightShift.z); } }
        else if (view.char.cheering) view.char.cheerPose(view.stick);
        else if (!view.char.holdStick(view.stick, v.puck.owner === s.id ? v.puck : null, s.dive ?? 0)) this.gripStick(view, null);
        continue;
      }
      view.sway += dt * (2 + sp * 0.9);
      view.body.rotation.x = Math.min(0.32, sp * 0.035) + (s.stun > 0 ? 0.5 : 0) + ((s.dive ?? 0) > 0 ? 0.6 : 0);
      view.body.rotation.z = Math.sin(view.sway) * Math.min(0.14, sp * 0.02);
      view.stick.rotation.x = 0.62 + (v.puck.owner === s.id ? Math.sin(time * 9) * 0.06 : 0) + (s.id === v.controlled && v.charge > 0 ? -v.charge * 0.9 : 0);
    }
    // a puck that just left a carrier at speed: shot (fast) or pass
    const po = v.puck.owner;
    if (this.prevOwner >= 0 && po !== this.prevOwner) {
      const sp = Math.hypot(v.puck.vx, v.puck.vz);
      if (po === -1 && sp > 9) this.views[this.prevOwner]?.char?.trigger(sp > 18 ? 'shot' : 'pass');
    }
    this.prevOwner = po;
    this.stepBursts(dt);
    this.stepFeel(dt);
    const me = v.skaters[v.controlled];
    this.marker.visible = !!me;
    for (let i = 0; i < this.views.length; i++) this.views[i].pip.visible = i !== v.controlled && !this.hero;   // the player I control wears the yellow arrow instead; none on the home screen
    if (me) { const g = this.views[v.controlled].g.position; this.marker.position.set(g.x, 0, g.z); this.marker.children[1].position.y = 2.62 + Math.sin(time * 5) * 0.08; }
    if (this.ph) this.ph.pipM[0].visible = this.ph.pipM[1].visible = !this.cinema && !v.fight;   // team pips stay out of the scout reveal's and the fight's close-ups
    const p = v.puck;
    this.puckMesh.position.set(p.x, 0.035 + p.y, p.z);
    this.puckGlow.position.set(p.x, 0.025, p.z);
    this.trailPos.copyWithin(3, 0, 23 * 3); this.trailPos[0] = p.x; this.trailPos[1] = 0.05 + p.y; this.trailPos[2] = p.z;
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.visible = Math.hypot(p.vx, p.vz) > 12 && p.owner < 0;
    this.updateCamera(v.focus?.x ?? p.x, v.focus?.z ?? p.z, dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** how tall a skater's body is right now, for framing it; the marker, pip and stick do not count */
  playerHeight(i: number) {
    const box = new THREE.Box3();
    this.views[i]?.g.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) box.expandByObject(o); });
    return box.isEmpty() ? 2 : THREE.MathUtils.clamp(box.max.y, 1.1, 2.6);
  }

  /** home screen: skater 0 stands on the ice as the lobby's main figure, framed inside the screen area the menus
   *  leave free (pixels from each edge). null everywhere else */
  hero: { left: number; right: number; top: number; bottom: number } | null = null;
  private heroKey: THREE.DirectionalLight;
  private heroRim: THREE.DirectionalLight;
  /** where the lead skater's feet are on screen (CSS pixels), for the name plate under it */
  readonly heroFeet = { x: 0, y: 0 };
  /** camera three-quarters in front of the skater, sized and shifted so the whole body fills the free area */
  private time = 0;
  private heroOn = false;
  private heroLook = new THREE.Vector3();
  private heroBaseFov: number | undefined;
  private frameHero(dt: number) {
    const s = this.hero!, el = this.renderer.domElement, W = el.clientWidth || innerWidth, H = el.clientHeight || innerHeight;
    const p = this.views[0].g.position, h = this.playerHeight(0) + 0.12;
    this.heroBaseFov ??= this.camera.fov;
    const t = Math.tan((this.heroBaseFov * Math.PI) / 360), areaH = Math.max(80, H - s.top - s.bottom);
    const tm = this.time;
    // a slow drift (a few cm, a degree or two) so the shot is never a still frame
    let d = h / (2 * t * (areaH / H) * 0.72) * (1 + 0.012 * Math.sin(tm * 0.17));   // the body takes ~72% of the free height
    const yaw = 0.5 + 0.03 * Math.sin(tm * 0.21), fx = Math.sin(yaw), fz = Math.cos(yaw);
    // stay inside the boards: a small free area (phone with the top 3 and rank strip) put the camera behind the glass,
    // which then filled the screen grey. Closer is fine: the body just takes more of the area
    const inside = (lim: number, at: number, dir: number) => (Math.abs(dir) < 1e-4 ? Infinity : ((dir > 0 ? lim : -lim) - at) / dir);
    d = Math.min(d, inside(RINK.halfWidth - 0.8, p.z, fz), inside(RINK.halfLength - 0.8, p.x, fx));   // (W and H here are the canvas size)
    // still too close to fit (a phone's small free area): widen the lens instead, home screen only
    const want = Math.max(Math.tan((this.heroBaseFov * Math.PI) / 360), h / (2 * d * (areaH / H) * 0.72));
    const fov = (Math.atan(want) * 360) / Math.PI;
    if (Math.abs(fov - this.camera.fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // the feet sit 14% of the area above its bottom (with the planned size the body is centred); a body the boards made
    // larger moves up instead of down onto the panels under it
    const bodyPx = H * h / (2 * want * d);
    const cx = (s.left + W - s.right) / 2, cy = (H - s.bottom) - 0.14 * areaH - bodyPx / 2;
    // the body lands at (cx, cy) by shifting the lens, not by moving the camera: on a phone held upright the free
    // area sits high, and moving the camera down to match put it under the ice (the skater then floated in the air)
    const v = this.camera.view;
    if (!v || !v.enabled || v.fullWidth !== W || v.fullHeight !== H || Math.abs(v.offsetX - (W / 2 - cx)) > 0.5 || Math.abs(v.offsetY - (H / 2 - cy)) > 0.5)
      this.camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    // a little below the chest, looking slightly up: the skater stands over the ice with the stands and roof behind
    this.v1.set(p.x + fx * d, h * 0.4 + 0.03 * Math.sin(tm * 0.33), p.z + fz * d); this.v2.set(p.x, h * 0.5, p.z);
    if (!this.heroOn || dt <= 0 || dt > 0.25) { this.camPos.copy(this.v1); this.heroLook.copy(this.v2); }
    else { const k = 1 - Math.exp(-dt * 4); this.camPos.lerp(this.v1, k); this.heroLook.lerp(this.v2, k); }   // a new lead skater: ease over
    this.heroOn = true;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.heroLook);
    this.heroKey.intensity = 1.35; this.heroRim.intensity = 1.6;
    this.heroKey.position.set(p.x + fx * 6 + fz * 3, 5, p.z + fz * 6 - fx * 3); this.heroKey.target.position.set(p.x, 1, p.z);
    this.heroRim.position.set(p.x - fx * 6 - fz * 4, 4, p.z - fz * 6 + fx * 4); this.heroRim.target.position.set(p.x, 1, p.z);
    this.v1.set(p.x, 0, p.z).project(this.camera);
    this.heroFeet.x = (this.v1.x + 1) / 2 * W; this.heroFeet.y = (1 - this.v1.y) / 2 * H;
  }
  /** lobby backdrop: no match on the ice, the camera drifts slowly round the rink */
  private orbit = 0;
  /** a scripted shot (the scout reveal): where the camera is and what it looks at */
  cinema: { x: number; y: number; z: number; lx: number; ly: number; lz: number } | null = null;
  private updateCamera(px: number, pz: number, dt: number) {
    if (!this.hero || this.idle) this.heroKey.intensity = this.heroRim.intensity = 0;
    if (this.hero && !this.idle) { this.frameHero(dt); return; }
    this.heroOn = false;
    if (this.camera.view?.enabled) this.camera.clearViewOffset();   // the lens shift belongs to the home framing only
    if (this.heroBaseFov !== undefined && this.camera.fov !== this.heroBaseFov) { this.camera.fov = this.heroBaseFov; this.camera.updateProjectionMatrix(); }
    if (this.cinema) {
      const c = this.cinema;
      this.camera.position.set(c.x, c.y, c.z);
      if (this.shake > 0) { this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5; this.shake = Math.max(0, this.shake - dt * 1.6); }
      this.camera.lookAt(c.lx, c.ly, c.lz);
      return;
    }
    if (this.idle) {
      this.orbit += dt * 0.05;
      const a = Math.sin(this.orbit) * 0.6;
      this.camera.position.set(Math.sin(a) * 30, 9 + Math.sin(this.orbit * 0.7) * 2, Math.cos(a) * 30);
      this.camera.lookAt(Math.sin(a) * 4, 2, -6);
      return;
    }
    const portrait = this.camera.aspect < 1, side = this.side === 0 ? 1 : -1;
    const fx = THREE.MathUtils.clamp(px * 0.85, -L + 10, L - 10);
    const h = portrait ? 34 : 13, back = portrait ? 30 : 15;
    if (this.fightAt) {                                   // ringside
      const [mx, mz] = this.fightAt;
      this.v1.set(mx, portrait ? 10 : this.fightOver ? 2.7 : 3.3, mz + side * (portrait ? 12 : this.fightOver ? 4.6 : 5.8)); this.camPos.lerp(this.v1, 1 - Math.exp(-dt * 5));
      this.v2.set(mx, 1.05, mz); this.camLook.lerp(this.v2, 1 - Math.exp(-dt * 6));
    } else {
      this.v1.set(fx, h, side * (W + back)); this.camPos.lerp(this.v1, 1 - Math.exp(-dt * 3));
      this.v2.set(fx, 0, pz * 0.25 - side * 1.5); this.camLook.lerp(this.v2, 1 - Math.exp(-dt * 4));
    }
    this.camera.position.copy(this.camPos).add(this.kick);
    if (this.shake > 0) { this.camera.position.x += (Math.random() - 0.5) * this.shake; this.camera.position.y += (Math.random() - 0.5) * this.shake; this.shake = Math.max(0, this.shake - dt * 1.6); }
    this.camera.lookAt(this.kickLook.copy(this.camLook).addScaledVector(this.kick, 0.6));
  }

  /** stick input (screen right / up) → world direction, using the current camera */
  screenToWorld(ix: number, iy: number) {
    this.camera.getWorldDirection(this.v1); this.v1.y = 0; this.v1.normalize();
    const rx = -this.v1.z, rz = this.v1.x;
    return { x: rx * ix - this.v1.x * iy, z: rz * ix - this.v1.z * iy };
  }
}
