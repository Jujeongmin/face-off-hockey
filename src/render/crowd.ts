// One fan: a small body merged into a single geometry and drawn instanced, so the whole crowd is one draw call.
// The vertex colour holds how much of each colour a vertex takes (shirt, skin, hair); the real colours are per fan.
// Sway, standing up and raised arms run in the vertex shader. Built once and kept for the life of the page.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const SHOULDER_X = 0.25, SHOULDER_Y = 0.56;

/** a part's vertices, each with a colour mix from `mix` and an arm side (0 body, -1 / 1 an arm) */
function part(g: THREE.BufferGeometry, mix: (y: number) => [number, number, number], arm = 0) {
  const flat = g.index ? g.toNonIndexed() : g;
  flat.deleteAttribute('uv');
  const pos = flat.attributes.position, colour = new Float32Array(pos.count * 3), side = new Float32Array(pos.count).fill(arm);
  for (let i = 0; i < pos.count; i++) colour.set(mix(pos.getY(i)), i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  flat.setAttribute('aArm', new THREE.BufferAttribute(side, 1));
  flat.computeVertexNormals();
  return flat;
}

/** origin on the seat, facing -z (the seats are turned so -z looks at the ice) */
export function fanGeometry() {
  const shirt = (): [number, number, number] => [1, 0, 0], skin = (): [number, number, number] => [0, 1, 0], hair = (): [number, number, number] => [0, 0, 1];
  const torso = new THREE.CylinderGeometry(0.2, 0.16, 0.54, 6, 1, true); torso.scale(1, 1, 0.72); torso.translate(0, 0.3, 0);
  const shoulders = new THREE.BoxGeometry(0.46, 0.12, 0.2); shoulders.translate(0, SHOULDER_Y, 0);
  const head = new THREE.IcosahedronGeometry(0.135, 0); head.translate(0, 0.8, 0);
  const crown = new THREE.IcosahedronGeometry(0.142, 0); crown.scale(1, 0.72, 1); crown.translate(0, 0.87, 0.035);
  const arm = (side: number) => {
    const a = new THREE.BoxGeometry(0.1, 0.46, 0.12, 1, 2, 1); a.translate(side * SHOULDER_X, SHOULDER_Y - 0.23, 0);
    return part(a, y => (y < 0.2 ? [0, 1, 0] : [1, 0, 0]), side);          // the forearm's end is the hand
  };
  return mergeGeometries([part(torso, shirt), part(shoulders, shirt), part(head, skin), part(crown, hair), arm(-1), arm(1)])!;
}

export interface CrowdUniforms { uTime: { value: number }; uCheer: { value: number }; uLead: { value: number } }

export function fanMaterial(u: CrowdUniforms) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = `uniform float uTime; uniform float uCheer; uniform float uLead;
      attribute vec3 aShirt; attribute vec3 aSkin; attribute vec3 aHair; attribute float aSeed; attribute float aHome; attribute float aArm;
      ` + sh.vertexShader
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor.rgb = color.r * aShirt + color.g * aSkin + color.b * aHair;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float mine = uLead == 0.0 || uLead * aHome > 0.0 ? 1.0 : 0.18;      // after a goal the scoring side's fans are the ones on their feet
        float joy = uCheer * mine, ph = aSeed * 6.283;
        // a few fans are up to something at any moment, and it changes every few seconds
        float busy = step(0.86, fract(aSeed * 7.31 + floor(uTime * 0.14 + aSeed) * 0.37));
        float lift = max(joy * (2.1 + 0.7 * sin(uTime * 9.0 + ph)), busy * (0.7 + 0.55 * sin(uTime * 6.5 + ph)));
        if (aArm != 0.0) {
          vec2 pivot = vec2(aArm * ${SHOULDER_X.toFixed(2)}, ${SHOULDER_Y.toFixed(2)}), d = transformed.xy - pivot;
          float a = aArm * lift, cs = cos(a), sn = sin(a);
          transformed.xy = pivot + vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
        }
        transformed.x += sin(uTime * (0.7 + aSeed * 0.6) + ph) * 0.02 * (transformed.y + 0.2);
        transformed.y += joy * 0.14 + (0.008 + joy * 0.2) * abs(sin(uTime * (1.5 + aSeed * 1.2 + joy * 4.0) + ph));`);
  };
  return m;
}

/** a camera flash here and there among the fans, only while the crowd is excited */
export function crowdFlashes(points: number[], u: CrowdUniforms) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const seeds = new Float32Array(points.length / 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = (i * 0.61803) % 1;
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: u as unknown as Record<string, THREE.IUniform>, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime; uniform float uCheer; attribute float aSeed; varying float vA;
      void main() {
        float t = fract(uTime * (0.9 + aSeed * 1.7) + aSeed * 13.0);
        vA = smoothstep(0.25, 0.75, uCheer) * (1.0 - smoothstep(0.0, 0.11, t));
        vec4 v = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (150.0 / -v.z) * (0.6 + aSeed);
        gl_Position = projectionMatrix * v;
      }`,
    fragmentShader: `varying float vA;
      void main() { if (vA < 0.01) discard; float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0), vA * smoothstep(0.5, 0.08, d)); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}
