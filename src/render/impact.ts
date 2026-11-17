// Hit effects: ice spray and impact stars from fixed pools. One geometry, one texture each, made once and never
// recreated; they live as long as the scene (the page), so nothing here is disposed.
import * as THREE from 'three';

const SPARKS = 120, STARS = 6, SPARK_LIFE = 0.5, STAR_LIFE = 0.17, GRAVITY = 15, UNSEEN = -50;

function canvas(size: number, draw: (g: CanvasRenderingContext2D, r: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.translate(size / 2, size / 2);
  draw(g, size / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const dotTexture = () => canvas(32, (g, r) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, r - 1, 0, Math.PI * 2); g.fill(); });
/** a jagged comic burst: bright middle, dark rim so it still reads against white ice */
const starTexture = () => canvas(256, (g, r) => {
  const points = 11;
  const shape = (outer: number, inner: number) => {
    g.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = (i / (points * 2)) * Math.PI * 2, d = (i % 2 ? inner : outer) * r * (i % 4 === 0 ? 1 : 0.86);
      if (i) g.lineTo(Math.cos(a) * d, Math.sin(a) * d); else g.moveTo(Math.cos(a) * d, Math.sin(a) * d);
    }
    g.closePath();
  };
  g.fillStyle = 'rgba(20,28,50,.85)'; shape(0.98, 0.5); g.fill();
  g.fillStyle = '#ffffff'; shape(0.86, 0.42); g.fill();
});

export class ImpactFx {
  private pos = new Float32Array(SPARKS * 3);
  private col = new Float32Array(SPARKS * 3);
  private vel = new Float32Array(SPARKS * 3);
  private life = new Float32Array(SPARKS);
  private next = 0;
  private alive = 0;
  private geo = new THREE.BufferGeometry();
  private stars: { s: THREE.Sprite; mat: THREE.SpriteMaterial; t: number; size: number }[] = [];
  private nextStar = 0;
  private tint = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.pos.fill(UNSEEN);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const points = new THREE.Points(this.geo, new THREE.PointsMaterial({ size: 0.13, map: dotTexture(), vertexColors: true, transparent: true, alphaTest: 0.4, depthWrite: false }));
    points.frustumCulled = false;
    points.renderOrder = 19;
    scene.add(points);
    const tex = starTexture();
    for (let i = 0; i < STARS; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.renderOrder = 20;
      s.scale.setScalar(0.001);                    // drawn invisibly small for the first frames so the shader compiles at load, not on the first hit
      scene.add(s);
      this.stars.push({ s, mat, t: -2, size: 0.001 });
    }
  }

  /** n particles thrown along (dx, dz) from a point, fanned out and up */
  spray(x: number, y: number, z: number, dx: number, dz: number, n: number, speed: number, color: number) {
    this.tint.setHex(color);
    for (let k = 0; k < n; k++) {
      const i = this.next, a = i * 3;
      this.next = (i + 1) % SPARKS;
      if (this.life[i] <= 0) this.alive++;
      const fan = (Math.random() - 0.5) * 2.4, c = Math.cos(fan), s = Math.sin(fan), v = speed * (0.35 + Math.random() * 0.75);
      this.pos[a] = x; this.pos[a + 1] = y; this.pos[a + 2] = z;
      this.vel[a] = (dx * c - dz * s) * v; this.vel[a + 1] = 1.5 + Math.random() * speed * 0.7; this.vel[a + 2] = (dx * s + dz * c) * v;
      this.col[a] = this.tint.r; this.col[a + 1] = this.tint.g; this.col[a + 2] = this.tint.b;
      this.life[i] = SPARK_LIFE * (0.5 + Math.random() * 0.5);
    }
    this.geo.attributes.color.needsUpdate = true;
  }

  star(x: number, y: number, z: number, size: number, color: number) {
    const b = this.stars[this.nextStar];
    this.nextStar = (this.nextStar + 1) % STARS;
    b.t = 0; b.size = size;
    b.mat.color.setHex(color); b.mat.rotation = Math.random() * Math.PI; b.mat.opacity = 1;
    b.s.position.set(x, y, z);
    b.s.visible = true;
  }

  step(dt: number) {
    for (const b of this.stars) {
      if (!b.s.visible) continue;
      b.t += dt / STAR_LIFE;
      if (b.t >= 1) { b.s.visible = false; continue; }
      const grow = 0.55 + 0.45 * Math.min(1, b.t * 3.2);
      b.s.scale.setScalar(b.size * grow);
      b.mat.opacity = b.t < 0.55 ? 1 : (1 - b.t) / 0.45;
    }
    if (!this.alive) return;
    for (let i = 0; i < SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      const a = i * 3;
      this.life[i] -= dt;
      this.vel[a + 1] -= GRAVITY * dt;
      this.pos[a] += this.vel[a] * dt; this.pos[a + 1] += this.vel[a + 1] * dt; this.pos[a + 2] += this.vel[a + 2] * dt;
      if (this.life[i] <= 0 || this.pos[a + 1] < 0.02) { this.life[i] = 0; this.pos[a + 1] = UNSEEN; this.alive--; }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
