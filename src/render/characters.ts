// Character models for the skaters: loads the GLBs once, hands out skinned clones and drives their animation.
//
// Memory notes (see the web-game checklist):
//  - geometry, skeleton bind data and the shared animation clips belong to the loaded templates: never disposed here
//  - tinted materials are cached per (model, team) and shared by every clone: never disposed per unit
//  - every clone owns a new Skeleton (bone texture on the GPU), so dispose() calls skeleton.dispose()
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Team } from '../sim/types.ts';

import { MODEL_IDS, type ModelId } from './model-ids.ts';
export { MODEL_IDS, type ModelId };

/** how each model is rigged and tinted. rig = which clip set (anims.glb for the Quaternius rig, anims_<rig>.glb otherwise) */
interface Meta {
  rig: string; fist: RegExp; tint: 'jersey' | 'emissive' | 'multiply' | 'outer' | 'none'; opaque: boolean; lift?: number;
  ankle: RegExp;            // ankle joints (left and right) the skate blades follow
  shin: RegExp;             // lower leg joints (knee) the goalie pads hang from
  arms: [string[], string[]]; // [left, right]: upper arm, forearm, hand (three-sanitised names) for the stick IK
  gripDepth?: number;       // metres the shaft sits in front of the palm: open-fingered realistic hands wrap around it
  lazy?: boolean;           // detailed model: fetched when a lineup needs it, not at start-up
  file?: string;            // file name when it is not the id (a changed asset gets a new name: Verse8 keeps serving the old file under the old one)
  anims?: string;           // clip file name when it is not anims_<rig> (same reason)
}
const Q: Meta = { rig: 'q', fist: /^fist.?r$/i, tint: 'jersey', opaque: true, ankle: /^LowerLeg[LR]_end$/, shin: /^LowerLeg[LR]$/,
  arms: [['UpperArmL', 'LowerArmL', 'FistL'], ['UpperArmR', 'LowerArmR', 'FistR']] };
const IDA: Meta = { lazy: true, rig: 'ida', fist: /^hand_r$/i, tint: 'none', opaque: false, gripDepth: 0.04, ankle: /^foot_[lr]$/, shin: /^calf_[lr]$/, arms: [['upperarm_l', 'lowerarm_l', 'hand_l'], ['upperarm_r', 'lowerarm_r', 'hand_r']] };
/** Sketchfab models: tools/blender/retarget.py gives every rig the same bone names; each has its own clip file */
const FREE = (rig: string): Meta => ({ lazy: true, rig, fist: /^hand_r$/, tint: 'none', opaque: false, gripDepth: 0.04, ankle: /^foot_[lr]$/, shin: /^shin_[lr]$/, arms: [['arm_l', 'forearm_l', 'hand_l'], ['arm_r', 'forearm_r', 'hand_r']] });
const BG: Meta = { lazy: true, rig: 'bg', fist: /^RightHand$/, tint: 'none', opaque: true, gripDepth: 0.04, ankle: /^(Left|Right)Foot$/, shin: /^(Left|Right)Leg$/, arms: [['LeftArm', 'LeftForeArm', 'LeftHand'], ['RightArm', 'RightForeArm', 'RightHand']] };
/** Quaternius bodies that only scouting gives: fetched when a lineup needs them, like the detailed models */
const QL: Meta = { ...Q, lazy: true };
const META: Record<ModelId, Meta> = {
  cowboy_male: QL, oldclassy_male: QL, chef_male: QL, doctor_female: QL, worker_male: QL, casual_bald: QL,
  casual_female: Q, casual2_male: Q, suit_female: Q, casual3_male: Q, worker_female: Q, casual2_female: Q,
  casual_male: Q, ninja_female: Q, casual3_female: Q, soldier_female: Q,
  cyber: { rig: 'cyber', fist: /^hand.?r$/i, tint: 'emissive', opaque: true, ankle: /^Foot[LR]$/, shin: /^LowerLeg[LR]$/, arms: [['UpperArml', 'LowerArmL', 'HandL'], ['UpperArmr', 'LowerArmR', 'HandR']] },
  jelly: { rig: 'jelly', fist: /^r.?hand$/i, tint: 'outer', opaque: true, ankle: /^[LR]Foot$/, shin: /^[LR]Leg$/, arms: [['LArm', 'LForeArm', 'LHand'], ['RArm', 'RForeArm', 'RHand']] },          // keeps her jellyfish hat
  mking: { rig: 'mking', fist: /^bip001_r_hand$/i, tint: 'multiply', opaque: true, lift: 0.45, ankle: /^Bip001_[LR]_Foot$/, shin: /^Bip001_[LR]_Calf$/,
    arms: [['Bip001_L_UpperArm', 'Bip001_L_Forearm', 'Bip001_L_Hand'], ['Bip001_R_UpperArm', 'Bip001_R_Forearm', 'Bip001_R_Hand']] },
  ganz0: { rig: 'ganz', fist: /^hand_r$/i, tint: 'multiply', opaque: true, ankle: /^foot_[lr]$/, shin: /^shin_[lr]$/, arms: [['upperarm_l', 'forearm_l', 'hand_l'], ['upperarm_r', 'forearm_r', 'hand_r']] },        // armour helmet
  ganz1: { rig: 'ganz', fist: /^hand_r$/i, tint: 'multiply', opaque: true, ankle: /^foot_[lr]$/, shin: /^shin_[lr]$/, arms: [['upperarm_l', 'forearm_l', 'hand_l'], ['upperarm_r', 'forearm_r', 'hand_r']] },
  bg1: BG, bg2: BG, bg3: BG, bg4: { ...BG, file: 'bg4_v2' },
  oni: FREE('oni'), gynoid: FREE('gynoid'), astra: { ...FREE('astra'), file: 'astra_v2', anims: 'anims_astra_v2' }, aking: FREE('aking'), valeria: { ...FREE('valeria'), file: 'valeria_v2', anims: 'anims_valeria_v2' }, gknight: FREE('gknight'), viking: FREE('viking'), rninja: FREE('rninja'),   // astra / valeria _v2: finger bones added (finger_rig.py)
  sword1: IDA, sword2: IDA, sword3: IDA, sword4: IDA,   // keep their own colours: the ring on the ice shows the team
};

/** materials that carry the shirt on the Quaternius characters: tinted with the team colour */
const JERSEY = /^(shirt|main|clothes|top|jacket)$/i;
const SKIN = /^skin$/i;
const FACE = /^face$/i;   // eyes and brows on the Quaternius bodies: the pack's colours for Face and Skin are swapped
const BASE = import.meta.env.BASE_URL + 'models/';
export const isHeavyModel = (id: ModelId) => !!META[id].lazy;

export interface MotionState {
  speed: number;            // m/s
  vx: number; vz: number;   // world velocity (heading changes = turns)
  hasPuck: boolean;
  stun: number;
  /** 0..1 shot charge while `charging` */
  charge: number;
  dive: number;
  charging: boolean;        // holding the shot button
}
export type OneShot = 'shot' | 'pass' | 'check';
export type Cheer = 'win' | 'lose' | '';

/** where a model's sole is, measured once from its bind pose: centre forward of the ankle and length, per unit of model scale */
interface FootFit { centre: number; length: number }
interface Template { scene: THREE.Group; height: number; rig: string; feet?: FootFit | null }

/** skates: geometry and materials shared by every character (never disposed per unit) */
export class Gear {
  static readonly LIFT = 0.07;                         // skates raise the body this much off the ice
  readonly blade = new THREE.BoxGeometry(0.022, 0.03, 0.34);
  readonly holder = new THREE.BoxGeometry(0.05, 0.05, 0.27);
  readonly steel = new THREE.MeshStandardMaterial({ color: 0xdfe5ec, metalness: 0.85, roughness: 0.25 });
  readonly black = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6 });
  /** goalie leg pad from public/models/gear.glb (tools/blender/build_gear.py): geometry and materials shared by every pad */
  padTemplate: THREE.Mesh | null = null;
  /** modelled stick per team (Nut Brothers pack), butt at the origin, shaft along +Z, 1.32 m: shared geometry / material */
  stickTemplates: (THREE.Mesh | null)[] = [null, null];
  stick(team: number) {
    const t = this.stickTemplates[team] ?? this.stickTemplates[0];
    if (!t) return null;
    const m = new THREE.Mesh(t.geometry, t.material); m.castShadow = true; m.frustumCulled = false;
    return m;
  }
  pad() {
    if (!this.padTemplate) return null;
    const m = new THREE.Mesh(this.padTemplate.geometry, this.padTemplate.material);
    m.castShadow = true; m.frustumCulled = false;
    return m;
  }
  /** the length of the skate and where its middle is, forward of the ankle */
  skateSpan() {
    this.blade.computeBoundingBox();
    const b = this.blade.boundingBox!;
    return { length: b.max.z - b.min.z, centre: (b.max.z + b.min.z) / 2 + 0.05 };
  }
  skate() {
    const g = new THREE.Group();
    const b = new THREE.Mesh(this.blade, this.steel); b.position.set(0, 0.015, 0.05);     // ankle sits over the heel
    const h = new THREE.Mesh(this.holder, this.black); h.position.set(0, 0.05, 0.05);
    b.castShadow = h.castShadow = true;
    g.add(b, h);
    return g;
  }
}

const STICK_LENGTH = 1.32;                       // as modelled
const STICK_MAX = 1.6;                           // the longest a long-armed body may need to keep the blade down
/** height of the shaft's end when the blade rests on the ice: the blade's underside sits this far above the end of the shaft line */
const BLADE_ON_ICE = -0.07;
/** the length that leaves a hand's width above the top hand, measured on the shortest and the tallest bodies (shoulders at 1.09 m and 1.45 m) */
const stickLengthFor = (shoulder: number) => Math.min(STICK_LENGTH, 0.34 + 0.61 * shoulder);

export class CharacterLibrary {
  private templates = new Map<ModelId, Template>();
  private clipSets = new Map<string, Map<string, THREE.AnimationClip>>();
  private tinted = new Map<string, THREE.Material>();
  readonly gear = new Gear();
  ready = false;
  /** what metal surfaces reflect (set once by the scene; shared by every material, never disposed). With nothing to reflect, metal renders black */
  metalEnv: THREE.Texture | null = null;

  private pending = new Map<ModelId, Promise<void>>();
  private gearLoad: Promise<void> | null = null;
  /** closed-fist finger rotations authored per model in Blender (tools/blender/fist_poses.py); empty if missing */
  private fists: Record<string, Record<string, number[]>> = {};
  private fistLoad: Promise<void> | null = null;
  has(id: ModelId) { return this.templates.has(id); }

  /** resolves once every id is in; a model already loaded or on its way is not fetched again */
  async load(ids: readonly ModelId[] = MODEL_IDS, onProgress?: (f: number) => void) {
    const fresh = ids.filter(id => !this.templates.has(id) && !this.pending.has(id));
    if (fresh.length) {
      const run = this.loadBatch(fresh, onProgress).finally(() => { for (const id of fresh) this.pending.delete(id); });
      for (const id of fresh) this.pending.set(id, run);
    }
    this.fistLoad ??= fetch(BASE + 'fists.json').then(r => (r.ok ? r.json() : {})).then(j => { this.fists = j; }).catch(() => {});
    await Promise.all([...ids.map(id => this.pending.get(id)), this.fistLoad]);
    this.ready = true;
  }

  /** onProgress(0..1) over every file (by bytes where the server says the size) */
  private async loadBatch(ids: readonly ModelId[], onProgress?: (f: number) => void) {
    // character meshes are Draco-compressed (~5x smaller); decoder files are copied from three into public/draco.
    // One decoder per batch: dispose() ends its workers for good
    const draco = new DRACOLoader();
    draco.setDecoderPath(import.meta.env.BASE_URL + 'draco/');
    draco.setDecoderConfig({ type: 'wasm' });
    const loader = new GLTFLoader().setDRACOLoader(draco);
    const rigs = [...new Set(ids.map(id => META[id].rig))].filter(r => !this.clipSets.has(r));
    const files = 1 + rigs.length + ids.length, part = new Map<string, number>();
    const tick = (url: string) => (e: ProgressEvent) => {
      part.set(url, e.total > 0 ? Math.min(0.99, e.loaded / e.total) : 0.5);
      onProgress?.([...part.values()].reduce((a, b) => a + b, 0) / files);
    };
    const done = (url: string) => { part.set(url, 1); onProgress?.([...part.values()].reduce((a, b) => a + b, 0) / files); };
    const get = (url: string) => loader.loadAsync(url, tick(url)).then(g => { done(url); return g; });
    this.gearLoad ??= get(BASE + 'gear_v2.glb').then(g => {
      g.scene.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        if (/^pad/i.test(m.name)) this.gear.padTemplate = m;
        else if (/stickhome/i.test(m.name)) this.gear.stickTemplates[0] = m;
        else if (/stickaway/i.test(m.name)) this.gear.stickTemplates[1] = m;
      });
    });
    await Promise.all(rigs.map(async rig => {
      const named = Object.values(META).find(m => m.rig === rig && m.anims)?.anims;
      const anims = await get(BASE + (rig === 'q' ? 'anims.glb' : `${named ?? `anims_${rig}`}.glb`));
      const set = new Map<string, THREE.AnimationClip>();
      for (const c of anims.animations) set.set(c.name, c);
      this.clipSets.set(rig, set);
    }));
    await Promise.all(ids.map(async id => {
      const gltf = await get(`${BASE}${META[id].file ?? id}.glb`);
      if (this.metalEnv) gltf.scene.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
          if (mat.metalnessMap || mat.metalness > 0.3) { mat.envMap = this.metalEnv; mat.envMapIntensity = 0.9; }
        }
      });
      // the FBX export leaves base-colour alpha at 0 on the Quaternius materials: force those opaque
      if (META[id].opaque) gltf.scene.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) { mat.opacity = 1; mat.transparent = false; mat.depthWrite = true; mat.alphaTest = 0; }
      });
      // these low-poly bodies were exported flat-shaded: smooth the skin (faces most of all), keep edges sharper than 60°
      const rig = META[id].rig;
      if (rig === 'q' || rig === 'ganz') gltf.scene.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        const name = (Array.isArray(m.material) ? m.material[0] : m.material).name;
        if (rig === 'q' ? name !== 'Skin' : m.name !== 'Base_Character_Mesh') return;
        const old = m.geometry; m.geometry = toCreasedNormals(old, Math.PI / 3); old.dispose();
      });
      // hair and lashes are alpha cards: cut them out instead of sorting them, and both sides of the thin cloth show
      if (META[id].rig === 'ida') gltf.scene.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          if (/hair|lash/i.test(mat.name)) { mat.transparent = false; mat.depthWrite = true; mat.alphaTest = 0.45; mat.side = THREE.DoubleSide; }
          else if (/cape/i.test(mat.name)) mat.side = THREE.DoubleSide;
        }
      });
      // GanzSe is coloured by a small palette texture: sample it without blending neighbouring cells
      if (META[id].rig === 'ganz') gltf.scene.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          const map = (mat as THREE.MeshStandardMaterial).map;
          if (map) { map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter; map.generateMipmaps = false; map.needsUpdate = true; }
        }
      });
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      this.templates.set(id, { scene: gltf.scene, height: Math.max(0.1, box.max.y - box.min.y), rig: META[id].rig });
    }));
    await this.gearLoad;
    draco.dispose();            // frees the decoder workers once this batch is in
  }

  private material(model: ModelId, tag: string | number, src: THREE.Material, edit: (c: THREE.Color, m: THREE.Material) => void) {
    const key = `${model}|${tag}|${src.uuid}`;
    let m = this.tinted.get(key);
    if (!m) { m = src.clone(); edit((m as THREE.MeshStandardMaterial).color, m); this.tinted.set(key, m); }
    return m;
  }

  spawn(model: ModelId, team: Team, teamColor: number, skinColor: number, height: number, goalie = false): CharacterInstance | null {
    const t = this.templates.get(model);
    if (!t) return null;
    const meta = META[model];
    const root = cloneSkinned(t.scene) as THREE.Group;
    const skinned: THREE.SkinnedMesh[] = [];
    const tc = new THREE.Color(teamColor);
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true; m.frustumCulled = false;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(m as THREE.SkinnedMesh);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const out = mats.map(mat => {
        const n = mat.name;
        if (meta.tint === 'jersey') return JERSEY.test(n) ? this.material(model, team, mat, c => c.set(teamColor))
          : SKIN.test(n) ? this.material(model, 's' + skinColor, mat, c => c.set(skinColor))
          : FACE.test(n) ? this.material(model, 'face', mat, c => c.set(0x141214)) : mat;
        if (meta.tint === 'emissive') return this.material(model, team, mat, (_c, mm) => { (mm as THREE.MeshStandardMaterial).emissive.copy(tc); });
        if (meta.tint === 'multiply') return this.material(model, team, mat, (c, mm) => {
          c.lerp(tc, 0.4);
          const s = mm as THREE.MeshStandardMaterial;
          if (meta.lift && s.map) { s.emissiveMap = s.map; s.emissive.copy(c).multiplyScalar(meta.lift); }
        });
        if (meta.tint === 'outer' && /outer/i.test(n)) return this.material(model, team, mat, c => c.copy(tc));
        return mat;
      });
      m.material = Array.isArray(m.material) ? out : out[0];
    });
    return new CharacterInstance(root, skinned, this.clipSets.get(t.rig)!, height / t.height, goalie, meta, this.gear, t, this.fists[model] ?? null);
  }
}

const clamp1 = (x: number) => Math.min(1, Math.max(-1, x));
const cosAngle = (x: THREE.Vector3, y: THREE.Vector3) => clamp1(x.dot(y) / Math.max(1e-9, x.length() * y.length()));
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** clips layered over the locomotion: one-shots (shot, pass, check, hockey stop) and held poses (fall, butterfly) */
const OVERLAYS = ['Shoot', 'PassFlick', 'BodyCheck', 'HockeyStop', 'FallSlide', 'Butterfly'];
/** finger curl per joint (radians), base to tip */
const CURL = [1.05, 1.25, 0.9, 0.6];
const THUMB_CURL = [0.35, 0.45, 0.3];
/** a closed fist (fight): finger joints base to tip, then the thumb folded over the fingers */
const FIST_CURL = [1.45, 1.65, 1.15, 0];
const FIST_THUMB = [0, 0.6, 0.5];   // [0]: the base is aimed onto the fingers instead

/** one hand for the stick grip: palm offset from the wrist joint, and the finger chains to close around the shaft */
interface Hand {
  arm: THREE.Object3D[];          // upper arm, forearm, hand
  reach: number;                  // shoulder-to-wrist length, straight
  palm: number;                   // wrist joint to the middle of the palm
  tip: THREE.Object3D | null;     // child marking the hand's long axis (middle knuckle, or the fist end joint)
  index: THREE.Object3D | null;   // knuckles across the palm (index / pinky side) to find which way the palm faces
  pinky: THREE.Object3D | null;
  fingers: THREE.Object3D[][];    // joint chains, base first
  thumb: THREE.Object3D[];
  still: [THREE.Object3D, THREE.Quaternion][];   // hand / finger bones no clip animates: reset to the bind pose each frame
  left: boolean;
  depth: number;                  // metres between the palm and the shaft
  across: THREE.Vector3;         // fist rigs: a hand-local axis square to the long axis (tells the hand's roll)
  lastPalm: THREE.Vector3;        // last frame's palm direction (group space), zero before the first grip
  lastHd: THREE.Vector3;          // last frame's hand long axis (group space)
  /** each finger / thumb joint's flex axis in its own local frame, measured once in the bind pose (null: no fingers).
   *  Bending every joint of a finger about one fixed axis keeps the finger in its plane; recomputing the axis from
   *  world directions every frame twisted joints different ways and bent some backwards (wavy fingers in a fist) */
  flex: { fingers: THREE.Vector3[][]; skip: number[]; thumb: THREE.Vector3[]; palm: THREE.Vector3 } | null;
  /** the authored fist: each finger bone's world rotation relative to the hand (hand_rest^-1 * delta * bone_rest),
   *  parents before children; null: no authored pose, the procedural curl is used */
  baked: { bone: THREE.Object3D; rel: THREE.Quaternion }[] | null;
}

export class CharacterInstance {
  readonly group = new THREE.Group();
  private fv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  /** how far fightPose moves the skater this frame (x across, z forward); the feet go too, so it is applied to the whole skater */
  readonly fightShift = { x: 0, z: 0 };
  private windup = 0;                            // 0..1 how far the blade is drawn back for a shot
  private falling = false;                       // down on the ice from a knockdown
  private gettingUp = 0;                         // seconds after a fall before the hands go back on the stick
  private lean = new THREE.Group();             // rolls the body into turns, pivoting on the ice
  readonly fist: THREE.Object3D | null;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  // locomotion layer: idle / skate / sprint / glide all run all the time and are blended by weight, so a change of
  // pace never restarts a clip (restarting a clip that still had weight is what made the body pop)
  private loco: (THREE.AnimationAction | undefined)[];
  private locoW = [1, 0, 0, 0];
  private stride = 0;                           // shared phase of Skate and Sprint, 0..1
  private coast = false;
  // overlay layer
  private over = new Map<string, { a: THREE.AnimationAction; w: number; on: boolean }>();
  private held = '';                            // FallSlide / Butterfly while stunned / diving
  private stopT = 0;                            // seconds left of a hockey stop
  private once = 0;                             // seconds left of a shot / pass / check
  private oneShot = '';                         // which one-shot is playing ('shot' / 'pass' / 'check')
  private oneShotLen = 0;
  // motion read from the view state
  private prevSpeed = 0;
  private accel = 0;                            // smoothed d|v|/dt, m/s²
  private heading = NaN;
  private turn = 0;                             // smoothed heading change, rad/s
  private leanAngle = 0;
  private tiltX = 0;                            // a hit throws the body over and it springs back: angle and speed about each axis
  private tiltZ = 0;
  private tiltVX = 0;
  private tiltVZ = 0;
  private dt = 1 / 60;
  private bladeAt = new THREE.Vector3(NaN, 0, 0);   // eased blade spot, group space
  private ankles: THREE.Object3D[] = [];
  private skates: THREE.Group[] = [];
  private shins: THREE.Object3D[] = [];        // same order as ankles (each ankle's knee)
  private pads: THREE.Mesh[] = [];             // goalie leg pads, laid along the shins every frame
  private ankleRest = 0;
  private ankleCalibrated = false;
  private footQ = new THREE.Quaternion();
  private groupQ = new THREE.Quaternion();
  private tmp2 = new THREE.Vector3();
  private ankleBind: THREE.Quaternion[] = [];   // inverse of each ankle's bind rotation in the body's space
  private sink = 0;                            // how far the body is lowered to keep the skates on the ice
  private skateZ = 0;                          // the skate goes this far forward of the ankle so it sits under the whole sole
  private tmp = new THREE.Vector3();
  private arms: THREE.Object3D[][] = [];        // [left, right] x [upper, fore, hand]
  private hands: Hand[] = [];

  constructor(private root: THREE.Group, private skinned: THREE.SkinnedMesh[], clips: Map<string, THREE.AnimationClip>, scale: number,
              private goalie: boolean, meta: Meta, gear: Gear, fit: Template, fistPose: Record<string, number[]> | null = null) {
    root.scale.setScalar(scale);
    root.position.y = Gear.LIFT;
    this.group.add(this.lean);
    this.lean.add(root);
    this.mixer = new THREE.AnimationMixer(root);
    for (const [name, clip] of clips) this.actions.set(name, this.mixer.clipAction(clip));
    this.loco = [goalie ? 'GoalieReady' : 'Ready', 'Skate', 'Sprint', 'Glide'].map(n => this.actions.get(n));
    this.loco.forEach((a, i) => {
      if (!a) return;
      a.play(); a.setEffectiveWeight(i === 0 ? 1 : 0);
      if (i === 1 || i === 2) a.timeScale = 0;              // stride clips are driven by this.stride
    });
    for (const n of OVERLAYS) {
      const a = this.actions.get(n);
      if (!a) continue;
      a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.setEffectiveWeight(0);
      this.over.set(n, { a, w: 0, on: false });
    }
    let fist: THREE.Object3D | null = null;
    root.traverse(o => {
      if (!fist && meta.fist.test(o.name)) fist = o;
      if (meta.ankle.test(o.name)) this.ankles.push(o);
    });
    this.fist = fist;
    for (const side of meta.arms) {
      const bones = side.map(n => root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
      if (bones.length === 3) this.arms.push(bones);
    }
    // gear and hands are measured in the bind pose
    this.group.updateMatrixWorld(true);
    if (this.arms.length === 2) this.stickLen = stickLengthFor((this.arms[0][0].getWorldPosition(this.tmp).y + this.arms[1][0].getWorldPosition(this.tmp).y) / 2);
    this.stickBase = this.stickLen;
    if (this.ankles.length === 2) {
      this.ankleRest = this.ankles[0].getWorldPosition(this.tmp).y;
      if (fit.feet === undefined) fit.feet = this.measureSoles(scale);
      const body = this.group.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.ankleBind = this.ankles.map(a => a.getWorldQuaternion(new THREE.Quaternion()).premultiply(body).invert());
      const span = gear.skateSpan(), feet = fit.feet;
      const along = feet ? THREE.MathUtils.clamp((feet.length * scale * 1.04) / span.length, 0.75, 1.75) : 1;
      this.skateZ = feet ? feet.centre * scale - span.centre * along : 0;
      for (let i = 0; i < 2; i++) { const s = gear.skate(); s.scale.set(THREE.MathUtils.clamp(Math.sqrt(along), 0.85, 1.25), 1, along); this.skates.push(s); this.group.add(s); }
      if (goalie) for (const ankle of this.ankles) {
        let knee: THREE.Object3D | null = ankle.parent;
        while (knee && !meta.shin.test(knee.name)) knee = knee.parent;
        const pad = knee ? gear.pad() : null;
        if (!knee || !pad) continue;
        this.shins.push(knee); this.pads.push(pad); this.group.add(pad);
      }
    }
    if (this.arms.length === 2) {
      // bones the locomotion / overlay clips actually write every frame. A bone keyed only in a clip that never
      // plays (Victory / Defeat carry GanzSe's fingers) is not reset by the mixer, so it must be reset here
      const animated = new Set<string>();
      const used = [...this.loco, ...[...this.over.values()].map(o => o.a)].filter((a): a is THREE.AnimationAction => !!a);
      for (const a of used) for (const tr of a.getClip().tracks) animated.add(tr.name.slice(0, tr.name.lastIndexOf('.')));
      this.hands = this.arms.map((arm, i) => this.measureHand(arm, i === 0, animated, meta.gripDepth ?? 0));
      if (fistPose) for (const h of this.hands) h.baked = this.bakeFist(h, fistPose);
    }
  }

  private measureHand(arm: THREE.Object3D[], left: boolean, animated: Set<string>, depth: number): Hand {
    const [a, b, c] = arm;
    const pa = a.getWorldPosition(new THREE.Vector3()), pb = b.getWorldPosition(new THREE.Vector3()), pc = c.getWorldPosition(new THREE.Vector3());
    const kids = c.children.filter(k => (k as THREE.Bone).isBone);
    const isEnd = (o: THREE.Object3D) => /(end|tip)$/i.test(o.name) || /prop|weapon|socket|attach/i.test(o.name);
    const isPalmBone = (k: THREE.Object3D) => /metacarpal|palm/i.test(k.name);
    const direct = kids.filter(k => !isEnd(k) && !isPalmBone(k));
    // Unreal-style hands hang the fingers off metacarpals, leaving only the thumb directly on the wrist
    const fingerKids = direct.some(k => !/thumb|finger0$/i.test(k.name)) ? direct : kids.filter(k => !isEnd(k)).flatMap(k => (isPalmBone(k) ? k.children.filter(j => (j as THREE.Bone).isBone) : [k]));
    const thumbKid = fingerKids.find(k => /thumb|finger0$/i.test(k.name)) ?? null;
    const chain = (o: THREE.Object3D) => { const out: THREE.Object3D[] = []; let j: THREE.Object3D | undefined = o;
      while (j && (j as THREE.Bone).isBone && out.length < 4) { out.push(j); j = j.children.find(k => (k as THREE.Bone).isBone); } return out; };
    const fingers = fingerKids.filter(k => k !== thumbKid).map(chain);
    let tip: THREE.Object3D | null, palm: number;
    if (fingers.length) {
      tip = fingerKids.find(k => /middle|finger2$|second/i.test(k.name)) ?? fingers[0][0];
      palm = 0.75 * tip.getWorldPosition(new THREE.Vector3()).distanceTo(pc);
    } else {
      tip = kids.find(isEnd) ?? null;
      palm = tip ? 0.5 * tip.getWorldPosition(new THREE.Vector3()).distanceTo(pc) : 0.04;
    }
    const index = fingerKids.find(k => /index|first|finger1$/i.test(k.name)) ?? null;
    const pinky = fingerKids.find(k => /pinky|little|finger4$/i.test(k.name)) ?? fingerKids.find(k => /second|ring|finger3$/i.test(k.name)) ?? null;
    const thumb = thumbKid ? chain(thumbKid) : [];
    return {
      flex: this.measureFlex(c, pc, tip, index, pinky, fingers, thumb, left), baked: null,
      arm, reach: pa.distanceTo(pb) + pb.distanceTo(pc), palm, tip, left, depth, lastPalm: new THREE.Vector3(), lastHd: new THREE.Vector3(), across: this.squareAxis(tip),
      index, pinky, fingers, thumb,
      // the grip rotates these on top of whatever they hold; a bone no clip writes would keep turning every frame
      // fingers are always put back to the bind pose before the curl (the clips' finger keys are not hockey grips anyway)
      still: [...(animated.has(c.name) ? [] : [c]), ...fingers.flat(), ...(thumbKid ? chain(thumbKid) : [])].map(o => [o, o.quaternion.clone()]),
    };
  }

  /**
   * Bind pose: the knuckle line (index to pinky) is the flex axis of every finger joint, the palm faces the side the
   * thumb sits on. Each joint gets that axis in its own local frame, signed so a positive angle closes the finger
   * towards the palm; the thumb folds about (its direction x palm normal).
   */
  private measureFlex(handBone: THREE.Object3D, wrist: THREE.Vector3, tip: THREE.Object3D | null, index: THREE.Object3D | null, pinky: THREE.Object3D | null,
    fingers: THREE.Object3D[][], thumb: THREE.Object3D[], left: boolean): Hand['flex'] {
    if (!tip || !index || !pinky || !fingers.length) return null;
    const P = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const knuckle = P(index).sub(P(pinky)).normalize(), long = P(tip).sub(wrist).normalize();
    const palmN = left ? new THREE.Vector3().crossVectors(long, knuckle) : new THREE.Vector3().crossVectors(knuckle, long);
    if (thumb.length) {                                    // the thumb sits on the palm side: settle the sign by it
      const t = P(thumb[thumb.length - 1]).sub(wrist);
      if (t.dot(palmN) < 0) palmN.negate();
    }
    palmN.normalize();
    const local = (joint: THREE.Object3D, axisW: THREE.Vector3, signed = false) => {
      const child = joint.children.find(k => (k as THREE.Bone).isBone);
      const d = child ? P(child).sub(P(joint)) : long.clone();
      d.normalize();
      // square to the bone: a splayed finger bent about a slanted axis turns in a cone and twists
      const ax = axisW.clone().addScaledVector(d, -axisW.dot(d));
      if (ax.lengthSq() < 1e-10) ax.copy(axisW);
      ax.normalize();
      if (!signed && new THREE.Vector3().crossVectors(ax, d).dot(palmN) < 0) ax.negate();   // + closes towards the palm
      return ax.applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    };
    // thumb joints bend towards the palm (the base is swung onto the fingers per frame in makeFist)
    const thumbAxis = (j: THREE.Object3D) => {
      const child = j.children.find(c => (c as THREE.Bone).isBone);
      const d = child ? P(child).sub(P(j)) : P(j).sub(wrist);
      d.normalize();
      const ax = new THREE.Vector3().crossVectors(d, palmN);
      return ax.lengthSq() < 1e-12 ? knuckle.clone() : ax.normalize();
    };
    // a chain that starts with a palm bone (IndexFinger_Base, metacarpal) bends from its second joint
    const palmBone = (ch: THREE.Object3D[]) => ch.length >= 4 && (/base|meta|carpal/i.test(ch[0].name) || P(ch[0]).distanceTo(wrist) < 0.3 * P(ch[1]).distanceTo(wrist));
    return {
      skip: fingers.map(ch => (palmBone(ch) ? 1 : 0)),
      fingers: fingers.map(ch => ch.map(j => local(j, knuckle))),
      thumb: thumb.map(j => local(j, thumbAxis(j), true)),
      palm: palmN.clone().applyQuaternion(handBone.getWorldQuaternion(new THREE.Quaternion()).invert()),   // hand-local, thumb-checked
    };
  }

  /**
   * The authored fist (fists.json) in the bind pose: the file holds each finger bone's world-space rotation from its
   * rest (glTF scene axes, hand not moved). Kept relative to the hand, so any hand orientation can carry it.
   */
  private bakeFist(h: Hand, pose: Record<string, number[]>) {
    const byName = new Map(Object.entries(pose).map(([k, v]) => [THREE.PropertyBinding.sanitizeNodeName(k), v]));
    const S = this.root.getWorldQuaternion(new THREE.Quaternion()), Si = S.clone().invert();
    const hand = h.arm[2], Hi = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    const out: { bone: THREE.Object3D; rel: THREE.Quaternion }[] = [];
    hand.traverse(o => {                                        // depth first: parents before their children
      const v = o !== hand ? byName.get(o.name) : undefined;
      if (!v) return;
      const D = new THREE.Quaternion(v[0], v[1], v[2], v[3]).premultiply(S).multiply(Si);   // scene axes -> world
      out.push({ bone: o, rel: Hi.clone().multiply(D).multiply(o.getWorldQuaternion(new THREE.Quaternion())) });
    });
    return out.length ? out : null;
  }

  /** fingers into a closed fist: the authored pose when there is one, else a curl about the bind-pose flex axes
   *  (the bones were just reset to the bind pose) */
  private makeFist(h: Hand) {
    if (h.baked) {
      const hq = h.arm[2].getWorldQuaternion(this.q[1]).clone(), pq = this.q[2];
      for (const { bone, rel } of h.baked) {
        bone.parent!.getWorldQuaternion(pq).invert();
        bone.quaternion.copy(pq).multiply(this.q[0].copy(hq).multiply(rel));
        bone.updateWorldMatrix(false, true);
      }
      return;
    }
    if (!h.flex) return;
    const q = this.q[0];
    h.fingers.forEach((ch, i) => ch.forEach((j, k) => {
      const a = FIST_CURL[k - h.flex!.skip[i]];
      if (a) j.quaternion.multiply(q.setFromAxisAngle(h.flex!.fingers[i][k], a));
    }));
    // thumb: bend the outer joints a little, then swing the whole thumb from its base so its tip lies over the
    // middle joints of the curled index and middle fingers (the front of the fist), whatever the rig's bind pose
    h.thumb.forEach((j, k) => { if (k > 0 && k < FIST_THUMB.length) j.quaternion.multiply(q.setFromAxisAngle(h.flex!.thumb[k], FIST_THUMB[k])); });
    h.arm[2].updateWorldMatrix(false, true);
    const mid = h.fingers.find(ch => ch[0] === h.tip) ?? h.fingers[1] ?? h.fingers[0], idx = h.fingers.find(ch => ch[0] === h.index) ?? h.fingers[0];
    const sk = (ch: THREE.Object3D[]) => h.flex!.skip[h.fingers.indexOf(ch)] ?? 0;
    if (h.thumb.length >= 2 && idx.length >= 2 && mid.length >= 2) {
      const v = this.v, b = v[21], tip = v[22], t = v[23], last = h.thumb[h.thumb.length - 1];
      const end = last.children.find(c => (c as THREE.Bone).isBone) ?? last;
      h.thumb[0].getWorldPosition(b); end.getWorldPosition(tip);
      idx[Math.min(idx.length - 1, 1 + sk(idx))].getWorldPosition(t); mid[Math.min(mid.length - 1, 1 + sk(mid))].getWorldPosition(v[20]); t.add(v[20]).multiplyScalar(0.5);
      t.addScaledVector(v[20].copy(h.flex!.palm).applyQuaternion(h.arm[2].getWorldQuaternion(this.q[1])), 0.018);   // on the fingers, not in them
      tip.sub(b).normalize(); t.sub(b).normalize();
      this.rotateWorld(h.thumb[0], q.setFromUnitVectors(tip, t));
    }
    h.arm[2].updateWorldMatrix(false, true);
  }

  /** the hand-local unit axis most square to the hand's long axis (towards `tip`, a child of the hand) */
  private squareAxis(tip: THREE.Object3D | null) {
    const long = tip ? tip.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const best = axes.reduce((a, b) => Math.abs(a.dot(long)) <= Math.abs(b.dot(long)) ? a : b);
    return best.addScaledVector(long, -best.dot(long)).normalize();
  }

  /** start an overlay clip from its first frame (fades in over the locomotion) */
  private startOver(name: string, timeScale: number) {
    for (const o of this.over.values()) o.on = false;
    const o = this.over.get(name);
    if (!o) return;
    o.a.reset(); o.a.timeScale = timeScale; o.a.play(); o.on = true;
  }
  private endOver() { for (const o of this.over.values()) o.on = false; }

  /** play a short action (shot, pass, check) over the locomotion */
  trigger(kind: OneShot) {
    if (this.held) return;
    const name = kind === 'shot' ? 'Shoot' : kind === 'pass' ? 'PassFlick' : 'BodyCheck';
    const o = this.over.get(name);
    if (!o) return;
    const ts = kind === 'shot' ? 1.35 : 1.5;
    this.stopT = 0;
    this.once = Math.min(0.55, o.a.getClip().duration / ts);
    this.oneShot = kind; this.oneShotLen = this.once;
    this.startOver(name, ts);
  }

  /** finds the soles in the bind pose: the skinned vertices low down around each ankle (a sampled few thousand, once per model) */
  private measureSoles(scale: number): FootFit | null {
    const ankle = this.ankles.map(a => a.getWorldPosition(new THREE.Vector3())), v = new THREE.Vector3();
    const low = Gear.LIFT + (ankle[0].y - Gear.LIFT) * 0.75, sides: number[][] = [[], []];
    for (const m of this.skinned) {
      m.skeleton.update();
      const pos = m.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 6000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i); m.applyBoneTransform(i, v); m.localToWorld(v);
        if (v.y > low) continue;
        const k = Math.abs(v.x - ankle[0].x) < Math.abs(v.x - ankle[1].x) ? 0 : 1;
        if (Math.abs(v.x - ankle[k].x) < 0.25 && Math.abs(v.z - ankle[k].z) < 0.5) sides[k].push(v.z - ankle[k].z);
      }
    }
    if (sides[0].length < 8 || sides[1].length < 8) return null;
    let centre = 0, length = 0;
    for (const zs of sides) {
      zs.sort((a, b) => a - b);
      const lo = zs[Math.floor(zs.length * 0.03)], hi = zs[Math.floor(zs.length * 0.97)];
      centre += (lo + hi) / 4; length += (hi - lo) / 2;
    }
    return { centre: centre / scale, length: length / scale };
  }

  /** a hit: (lx, lz) is the direction the body is thrown in the skater's own frame, amount 0..1 */
  impact(lx: number, lz: number, amount: number) { this.tiltVX += lz * amount * 11; this.tiltVZ -= lx * amount * 11; }
  private stepTilt(dt: number) {
    if (Math.abs(this.tiltX) + Math.abs(this.tiltZ) + Math.abs(this.tiltVX) + Math.abs(this.tiltVZ) < 0.002) { this.tiltX = this.tiltZ = this.tiltVX = this.tiltVZ = 0; return; }
    const h = Math.min(dt, 1 / 30), stiff = 130, damp = 13;
    this.tiltVX += (-stiff * this.tiltX - damp * this.tiltVX) * h; this.tiltVZ += (-stiff * this.tiltZ - damp * this.tiltVZ) * h;
    this.tiltX = THREE.MathUtils.clamp(this.tiltX + this.tiltVX * h, -0.8, 0.8); this.tiltZ = THREE.MathUtils.clamp(this.tiltZ + this.tiltVZ * h, -0.8, 0.8);
  }

  update(s: MotionState, dt: number) {
    this.lean.rotation.x = 0;                                     // fightPose owns this while a fight is on
    this.lean.rotation.y = 0;
    const sp = s.speed;
    // ---- what the skater is doing: speed change and how fast the heading turns
    if (dt > 0) {
      this.accel += ((sp - this.prevSpeed) / dt - this.accel) * Math.min(1, dt * 8);
      if (sp > 1.5) {
        const h = Math.atan2(s.vz, s.vx);
        if (!Number.isNaN(this.heading)) this.turn += (wrapAngle(h - this.heading) / dt - this.turn) * Math.min(1, dt * 10);
        this.heading = h;
      } else { this.heading = NaN; this.turn *= Math.max(0, 1 - dt * 6); }
    }
    this.prevSpeed = sp;

    // ---- overlays
    this.windup += ((s.charging ? s.charge : 0) - this.windup) * Math.min(1, dt * 24);
    // a whiff or a bump is a stagger (stun up to 0.35 s): only a real knockdown goes to the ice and lets go of the stick
    if (s.stun > 0.45) this.falling = true; else if (s.stun <= 0) this.falling = false;
    const want = this.falling ? 'FallSlide' : s.dive > 0 ? 'Butterfly' : '';
    if (want !== this.held) {
      this.held = want; this.once = 0; this.oneShot = ''; this.stopT = 0;
      if (want) this.startOver(want, want === 'FallSlide' ? 1.2 : 1.7); else this.endOver();
    }
    if (this.once > 0) {
      this.once -= dt;
      if (this.once <= 0) { this.once = 0; this.oneShot = ''; this.endOver(); }
    }
    if (!this.goalie && !this.held && this.once <= 0) {
      if (this.stopT > 0) {
        // the stop ends when the skater stops or pushes off again (reversing direction)
        this.stopT -= dt;
        if (this.stopT <= 0 || this.accel > 0.5 || sp < 0.8) { this.stopT = 0; this.endOver(); }
      } else if (this.accel < -12 && sp > 4 && Math.abs(this.turn) < 1.0) {
        // hard braking in a straight line; a sharp turn also sheds speed but keeps the heading moving
        const o = this.over.get('HockeyStop');
        if (o) { this.stopT = Math.min(0.7, o.a.getClip().duration / 1.4); this.startOver('HockeyStop', 1.4); }
      }
    }
    const kIn = 1 - Math.exp(-dt / 0.06), kOut = 1 - Math.exp(-dt / 0.1);
    let W = 0;
    for (const o of this.over.values()) {
      o.w += ((o.on ? 1 : 0) - o.w) * (o.on ? kIn : kOut);
      if (!o.on && o.w < 1e-3) o.w = 0;
      W += o.w;
    }
    const norm = W > 1 ? 1 / W : 1;
    for (const o of this.over.values()) o.a.setEffectiveWeight(o.w * norm);

    // ---- locomotion blend
    const move = this.goalie ? smoothstep(0.3, 1.2, sp) : smoothstep(0.25, 1.4, sp);
    const sprint = this.goalie ? 0 : smoothstep(7.8, 9.0, sp);
    if (this.coast) { if (this.accel > -0.3 || sp < 2) this.coast = false; }      // hysteresis: no flicker at the edge
    else if (this.accel < -1.2 && sp > 2.5) this.coast = true;
    const glide = this.goalie || !this.coast ? 0 : 1;
    const target = [1 - move, move * (1 - glide) * (1 - sprint), move * (1 - glide) * sprint, move * glide];
    const kL = 1 - Math.exp(-dt * 7);
    let sum = 0;
    for (let i = 0; i < 4; i++) { this.locoW[i] += (target[i] - this.locoW[i]) * kL; sum += this.locoW[i]; }
    const rest = Math.max(0, 1 - W) / Math.max(1e-6, sum);
    for (let i = 0; i < 4; i++) this.loco[i]?.setEffectiveWeight(this.locoW[i] * rest);
    // one stride phase for Skate and Sprint, so blending between them never shifts the legs
    const sk = this.loco[1], sr = this.loco[2];
    if (sk) {
      const skDur = sk.getClip().duration, srDur = sr ? sr.getClip().duration : skDur;
      const skRate = (this.goalie ? 0.5 + sp * 0.2 : 0.55 + sp * 0.13) / skDur;
      const srRate = (0.85 + Math.max(0, sp - 8.2) * 0.3) / srDur;
      this.stride = (this.stride + dt * (skRate + (srRate - skRate) * sprint)) % 1;
      sk.time = this.stride * skDur;
      if (sr) sr.time = this.stride * srDur;
    }
    // lean into turns: tan(lean) = v·ω / g
    const lean = this.goalie || sp < 2 ? 0 : THREE.MathUtils.clamp(Math.atan(sp * this.turn / 9.81) * 0.8, -0.35, 0.35);
    this.leanAngle += (lean - this.leanAngle) * Math.min(1, dt * 8);
    this.stepTilt(dt);
    this.stepCheer(dt);
    // a scorer rocks back with the stick up; a beaten skater bends over his stick
    this.lean.rotation.x = this.tiltX + (this.cheerKind === 'win' ? -0.1 : 0.2) * this.cheerW;
    this.lean.rotation.z = this.leanAngle + this.tiltZ;

    this.dt = dt;
    this.mixer.update(dt);
    // skates ride under the ankles, flat on the ice (tilted with the lean), toes slightly out
    this.lean.updateMatrixWorld(true);
    // a pose can hold both ankles above where they stand in the bind pose (bent knees, heels up): lower the body by that much, so the lower foot stays on the ice
    if (this.ankles.length === 2) {
      const a = this.group.worldToLocal(this.ankles[0].getWorldPosition(this.tmp)).y, b = this.group.worldToLocal(this.ankles[1].getWorldPosition(this.tmp)).y;
      // the rest height is taken from the first standing frame, not the bind pose: on the Quaternius rig the ankle
      // bone (LowerLeg_end) sits 8 cm higher standing than in the bind pose while the sole stays put, and measuring
      // from the bind pose sank those bodies 8 cm into their skates
      if (!this.ankleCalibrated && !this.falling && s.dive <= 0 && this.sink === 0) { this.ankleRest = Math.min(a, b); this.ankleCalibrated = true; }
      const over = this.falling || s.dive > 0 ? 0 : Math.max(0, Math.min(a, b) - this.ankleRest + this.sink);
      this.sink += (over - this.sink) * Math.min(1, dt * 1.6);     // slowly, to the stance as a whole: following each stride would bob the body and pin the lifted foot to the ice
      this.root.position.y = Gear.LIFT - this.sink;
      this.lean.updateMatrixWorld(true);
    }
    for (let i = 0; i < this.skates.length; i++) {
      const p = this.group.worldToLocal(this.ankles[i].getWorldPosition(this.tmp));
      const s = this.skates[i];
      // flat on the ice while the foot is down; once it lifts, the skate pitches with the foot, pivoting on the ankle
      this.ankles[i].getWorldQuaternion(this.footQ).premultiply(this.group.getWorldQuaternion(this.groupQ).invert()).multiply(this.ankleBind[i]);
      const toe = this.tmp2.set(0, 0, 1).applyQuaternion(this.footQ);
      const lifted = THREE.MathUtils.clamp((p.y - this.ankleRest) / 0.05, 0, 1);
      const pitch = Math.atan2(-toe.y, Math.hypot(toe.x, toe.z)) * lifted, c = Math.cos(pitch), n = Math.sin(pitch);
      s.position.set(p.x, Math.max(0, p.y - this.ankleRest * c - this.skateZ * n), p.z - this.ankleRest * n * lifted + this.skateZ * c);
      s.rotation.set(pitch, (p.x > 0 ? 1 : -1) * 0.1, this.leanAngle);
    }
    // goalie pads: foot of the pad on the ankle, up the shin to above the knee, face towards the body's front
    for (let i = 0; i < this.pads.length; i++) {
      const pad = this.pads[i], a = this.v[21], k = this.v[22], up = this.v[23], fwd = this.v[20], side = this.v[19];
      this.group.worldToLocal(this.ankles[i].getWorldPosition(a));
      this.group.worldToLocal(this.shins[i].getWorldPosition(k));
      up.subVectors(k, a); const len = up.length(); if (len < 1e-4) continue; up.multiplyScalar(1 / len);
      fwd.set(0, 0, 1).addScaledVector(up, -up.z); if (fwd.lengthSq() < 1e-6) fwd.set(0, 1, 0); fwd.normalize();
      side.crossVectors(up, fwd);
      // gear.glb comes out of Blender's Y-forward export: the pad's length runs along -Z (ankle at 0, top of the
      // knee roll at -1.11), its face along +Y, width along X. Map those onto the shin.
      this.mA.makeBasis(side, fwd, this.v[18].copy(up).negate());
      pad.quaternion.setFromRotationMatrix(this.mA);
      // real pad size whatever the model's scale: ~0.31 m wide, ~0.2 m thick, from below the ankle to above the knee
      pad.position.copy(a).addScaledVector(fwd, 0.03).addScaledVector(up, -0.07);
      pad.scale.set(2.2, 1.6, (len * 1.3 + 0.1) / 1.11);
    }
  }

  // ------------------------------------------------------------------ goal celebration / defeat
  private cheerKind: Cheer = '';
  private cheerT = 0;                           // seconds since the pose began (below 0: still waiting for it)
  private cheerLeft = 0;                        // seconds until it eases out
  private cheerW = 0;                           // 0..1 how far into the pose
  /** after a goal or at the final whistle: 'win' raises the stick and pumps the free fist, 'lose' hangs over the stick */
  cheer(kind: Exclude<Cheer, ''>, delay: number, seconds: number) {
    if (this.cheerKind !== kind || this.cheerW <= 0) this.cheerT = -delay;
    this.cheerKind = kind; this.cheerLeft = delay + seconds;
  }
  stopCheer() { this.cheerLeft = 0; }
  /** the raised-stick pose is drawn (the scene calls cheerPose instead of holdStick) */
  get cheering() { return this.cheerKind === 'win' && this.cheerW > 0.001; }
  /** how far a 'lose' pose has the hands down the shaft and the blade out in front, 0..1 */
  private get slump() { return this.cheerKind === 'lose' ? this.cheerW : 0; }
  private stepCheer(dt: number) {
    if (!this.cheerKind) return;
    this.cheerT += dt; this.cheerLeft -= dt;
    // a knockdown or a dive owns the body; so does the shot / pass / check playing over it
    const on = this.cheerT >= 0 && this.cheerLeft > 0 && !this.falling && !this.held;
    this.cheerW = THREE.MathUtils.clamp(this.cheerW + (on ? dt / 0.28 : -dt / 0.22), 0, 1);
    if (!on && this.cheerW <= 0 && this.cheerLeft <= 0) { this.cheerKind = ''; this.releaseGrip(); }
  }

  /**
   * Stick up: the right hand takes the stick by the butt end and lifts it over the head, blade to the sky, while the
   * left fist pumps. Arm IK on every rig like fightPose; eased in from the carrying grip by cheerW.
   */
  cheerPose(stick: THREE.Object3D) {
    if (this.hands.length < 2) return;
    const g = this.group, [sl, sr, mid, T, F, dir, low] = this.v, D = this.fv[2];
    const w = this.cheerW * this.cheerW * (3 - 2 * this.cheerW);
    this.lean.updateMatrixWorld(true);
    g.worldToLocal(this.arms[0][0].getWorldPosition(sl));
    g.worldToLocal(this.arms[1][0].getWorldPosition(sr));
    mid.addVectors(sl, sr).multiplyScalar(0.5);
    const k = mid.y / 1.15, hl = this.hands[0], hr = this.hands[1];
    const pump = 0.5 - 0.5 * Math.cos(Math.max(0, this.cheerT) * Math.PI * 2 * 1.7);   // 0 low .. 1 punched up
    low.set(mid.x, mid.y - 0.36 * k, mid.z + 0.28 * k);                              // where the hands carry the stick
    // stick hand up and out over its shoulder (a V: straight up, these short arms end inside the big heads); bobs with the fist
    const rR = (hr.reach + hr.palm) * 0.95, side = Math.sign(sr.x) || -1, sideL = Math.sign(sl.x) || 1;
    T.set(sr.x + side * rR * 0.62, sr.y + rR * 0.76 - 0.05 * k * pump, sr.z + 0.1 * k);
    this.pull(T, sr, rR);
    T.lerpVectors(low, T, w);
    // shaft from the hand up and out to the side, blade highest; while easing in it swings up from carrying (down and forward)
    dir.set(0.55 * side, 1, -0.12).normalize();
    F.set(-0.15 * side, -0.55, 0.82).normalize();
    dir.lerpVectors(F, dir, w).normalize();
    const along = THREE.MathUtils.lerp(0.55, 0.06, w) * this.stickLen;           // the hand slides to the butt end
    const top = this.v[21].copy(T).addScaledVector(dir, -along);
    stick.scale.setScalar(this.stickLen / STICK_LENGTH);
    stick.rotation.set(Math.asin(THREE.MathUtils.clamp(-dir.y, -1, 1)), Math.atan2(dir.x, dir.z), 0, 'YXZ');
    stick.position.copy(top);
    const gq = g.getWorldQuaternion(this.q[4]);
    g.localToWorld(top); dir.applyQuaternion(gq);
    this.grip(hr, top, dir, along);
    // free fist: from the shaft up past the head and back, the elbow driving down between punches
    const rL = (hl.reach + hl.palm) * 0.97;
    T.set(sl.x + sideL * rL * (0.62 - 0.2 * pump), sl.y + rL * (0.3 + 0.5 * pump), sl.z + (0.3 - 0.16 * pump) * k);
    this.pull(T, sl, rL);
    T.lerpVectors(low, T, w);
    D.set(1, 0, 0).applyQuaternion(gq);
    g.localToWorld(T);
    this.grip(hl, T, D, 0);
  }

  // ------------------------------------------------------------------ stick + two-hand grip
  private v = Array.from({ length: 24 }, () => new THREE.Vector3());
  private q = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  private mA = new THREE.Matrix4();
  private bodyK = 0;
  private stickBase = STICK_LENGTH;               // the bind-pose length (stickLengthFor)
  private stickLen = STICK_LENGTH;              // sized to this body from the bind pose: a full-length stick on a short player runs through the belly above the top hand
  private mB = new THREE.Matrix4();

  /**
   * Places the stick (blade on the puck when carrying, otherwise ahead on the forehand side; swung back and through
   * during a shot) and puts both hands on it: the top (left) hand where the left arm reaches, the bottom (right)
   * hand at the shaft point nearest the right shoulder. The middle of each palm sits on the shaft and the fingers
   * close around it.
   * Returns false when the body is not in a stick-holding state (falling, diving): the caller then hangs the stick
   * off the right hand instead.
   */
  holdStick(stick: THREE.Object3D, puck: { x: number; z: number } | null, dive: number): boolean {
    if (this.hands.length < 2) return false;
    if (this.falling || dive > 0) { this.releaseGrip(); this.gettingUp = 0.16; return false; }
    if (this.gettingUp > 0) { this.gettingUp -= this.dt; return false; }   // still rising out of the fall: the shaft would be out of reach
    const [sl, sr, mid, top, blade, dir, t] = this.v;
    const g = this.group;
    g.worldToLocal(this.arms[0][0].getWorldPosition(sl));
    g.worldToLocal(this.arms[1][0].getWorldPosition(sr));
    mid.addVectors(sl, sr).multiplyScalar(0.5);
    // body size relative to a ~1.75 m player, eased: a long-legged stride bobs the shoulders, and every target below scales with this
    this.bodyK = this.bodyK ? this.bodyK + (mid.y / 1.15 - this.bodyK) * Math.min(1, this.dt * 4) : mid.y / 1.15;
    const k = this.bodyK;
    if (puck) { g.worldToLocal(blade.set(puck.x, 0, puck.z)); blade.y = BLADE_ON_ICE; }
    else blade.set(-0.32 * k + 0.2 * k * this.slump, BLADE_ON_ICE, (1.0 + 0.3 * this.slump) * k);   // beaten: the blade rests out in front
    // ease the blade between spots (picking up / losing the puck would otherwise move the stick in one frame)
    if (this.bladeAt.x !== this.bladeAt.x || this.bladeAt.distanceTo(blade) > 1.5) this.bladeAt.copy(blade);
    else this.bladeAt.lerp(blade, 1 - Math.exp(-this.dt * 18));
    blade.copy(this.bladeAt);
    // The backswing belongs to the charge (the blade draws back while the shot is held); the puck has already gone when
    // a shot or pass event arrives, so from then on the blade only follows through and comes back to the ice.
    let through = 0;
    if (this.oneShot === 'shot' || this.oneShot === 'pass') {
      const p = 1 - this.once / Math.max(0.01, this.oneShotLen);
      through = (this.oneShot === 'shot' ? 1 : 0.4) * (p < 0.7 ? Math.sin(p / 0.7 * Math.PI) : 0);
    }
    const swing = this.windup - through;
    blade.x -= 0.2 * k * Math.abs(swing);
    blade.y += 0.5 * k * this.windup + 0.42 * k * through;
    blade.z += -0.8 * k * this.windup + 0.5 * k * through;
    // Hand spots first, then the shaft through them. The characters have short (chibi) arms, so a stick aimed from
    // a fixed spot passes out of the bottom hand's reach. Top hand in front of the belly, bottom hand 30 cm further
    // down towards the blade, each pulled into its arm's reach; the shaft runs from the blade between them, and the
    // spots are moved onto it and back into reach a few times.
    const hl = this.hands[0], hr = this.hands[1];
    const rL = (hl.reach + hl.palm) * 0.95, rR = (hr.reach + hr.palm) * 0.95, sep = 0.3 * k;
    const L = this.v[21], R = this.v[22], C = this.v[23];         // free until grip() (pull() uses v[17])
    L.set(mid.x + 0.05 * k, mid.y - 0.38 * k, mid.z + 0.25 * k - 0.15 * k * swing);
    this.pull(L, sl, rL);
    dir.subVectors(blade, L).normalize();
    R.copy(L).addScaledVector(dir, sep);
    this.pull(R, sr, rR);
    for (let it = 0; it < 3; it++) {
      C.addVectors(L, R).multiplyScalar(0.5);
      dir.subVectors(blade, C).normalize();
      // onto the shaft line, keeping the hands apart along it
      let aLc = t.subVectors(L, C).dot(dir), aRc = t.subVectors(R, C).dot(dir);
      if (aRc - aLc < sep * 0.7) { const m = (aLc + aRc) / 2; aLc = m - sep * 0.35; aRc = m + sep * 0.35; }
      L.copy(C).addScaledVector(dir, aLc); R.copy(C).addScaledVector(dir, aRc);
      if (it < 2) { this.pull(L, sl, rL); this.pull(R, sr, rR); }
    }
    const LEN = this.stickLen;
    top.copy(blade).addScaledVector(dir, -LEN);                     // butt end
    // hands further from the blade than the stick is long (tall players): slide the stick up so the top hand
    // stays on the butt end; the blade lifts a little
    const spare = t.subVectors(L, top).dot(dir);
    if (spare < 0.04) {
      top.copy(L).addScaledVector(dir, -0.04);
      // standing still with no puck the blade should reach the ice: if this body cannot, the stick grows to fit, once and for good (never for a far-off puck: that would bring back a stick through the belly)
      // at most 10 % over the length measured on the bind pose: a frame with the arms not yet settled (first frames,
      // a slow device) used to grow it for good, up to 1.6 m on a 1.1 m body, and the stick then stood off the hands
      if (!puck && this.prevSpeed < 0.5 && Math.abs(swing) < 0.02) this.stickLen = Math.min(STICK_MAX, this.stickBase * 1.1, this.stickLen + 0.04 - spare);
    }
    stick.scale.setScalar(this.stickLen / STICK_LENGTH);
    const aL = Math.max(0.04, t.subVectors(L, top).dot(dir));       // top hand, from the butt end
    const aR = Math.max(aL + 0.15 * k, t.subVectors(R, top).dot(dir));
    const pitch = Math.asin(THREE.MathUtils.clamp(-dir.y, -1, 1)), yaw = Math.atan2(dir.x, dir.z);
    stick.rotation.set(pitch, yaw, 0, 'YXZ');
    stick.position.copy(top);
    // to world space for the arm solve
    const gq = g.getWorldQuaternion(this.q[4]);
    g.localToWorld(top); dir.applyQuaternion(gq);
    this.grip(hl, top, dir, aL);
    this.grip(hr, top, dir, aR);
    return true;
  }

  /**
   * Boxing stance on the arm IK, so it works on every rig without new clips. Fists up by the chin, the punching
   * hand drives straight out along the arm; the fingers close through grip() around a short bar across the fist.
   */
  fightPose(act: number, hand: number, p: number) {
    if (this.hands.length < 2) return;
    this.releaseGrip();
    const g = this.group, [sl, sr] = this.v, T = this.fv[0], W = this.fv[1], D = this.fv[2];
    const ext = act === 1 ? p * p : act === 2 ? 1 - p : 0;
    const coil = act === 1 ? Math.max(0, 1 - p / 0.45) : 0;          // draws back, then goes
    const rocked = act === 5 ? 1 - p : 0;
    this.lean.rotation.x = ext * 0.34 - coil * 0.16 - rocked * 0.42 + (act === 3 ? 0.1 : 0.04) + this.tiltX;
    this.lean.rotation.y = (hand ? 1 : -1) * (ext * 0.6 - coil * 0.35);   // the shoulder goes with the fist
    this.fightShift.x = act === 4 ? Math.sin(p * Math.PI) * 0.34 * (hand ? 1 : -1) : 0;   // slip to the side
    this.fightShift.z = ext * 0.62 - coil * 0.08 - rocked * 0.34;    // the whole skater drives into the punch so it lands; the one hit is knocked back
    this.lean.updateMatrixWorld(true);
    g.worldToLocal(this.arms[0][0].getWorldPosition(sl));
    g.worldToLocal(this.arms[1][0].getWorldPosition(sr));
    const k = (sl.y + sr.y) / 2 / 1.15;
    D.set(1, 0, 0).applyQuaternion(g.getWorldQuaternion(this.q[4]));
    for (let i = 0; i < 2; i++) {
      const h = this.hands[i], s = i ? sr : sl, r = (h.reach + h.palm) * 0.97;
      T.set(s.x * 1.05, s.y - 0.04 * k, s.z + 0.3 * k);                // fists apart, in front of the shoulders
      if (act === 3) { T.x = s.x * 0.6; T.y += 0.16 * k; T.z += 0.04 * k; }
      if (act === 5) T.y -= 0.14 * k * (1 - p);
      if (i === hand && ext > 0) { W.set(s.x * 0.1, s.y + 0.05 * k, s.z + r); T.lerp(W, ext); }
      this.pull(T, s, r);
      g.localToWorld(W.copy(T));
      this.fistHand(h, W, i === 1, i === hand ? ext : 0);
    }
  }

  /**
   * A fist at `at` (world): the arm reaches it, the wrist stays straight (the hand carries on along the forearm, a
   * touch up), the palm faces the body's middle in the guard and turns down as the punch goes out; then the fingers close.
   */
  private fistHand(h: Hand, at: THREE.Vector3, right: boolean, ext: number) {
    const v = this.v, sh = v[16], f = v[17], c = v[18], w = v[19], n = v[20], u = v[21], gq = this.group.getWorldQuaternion(this.q[3]);
    for (const [bone, q] of h.still) bone.quaternion.copy(q);
    h.arm[0].getWorldPosition(sh);
    f.subVectors(at, sh).normalize();
    this.reach(h.arm, u.copy(at).addScaledVector(f, -h.palm));
    const hand = h.arm[2];
    h.arm[1].getWorldPosition(u); hand.getWorldPosition(w);
    f.subVectors(w, u).normalize();                                  // forearm direction: the straight wrist
    f.addScaledVector(v[22].set(0, 1, 0).applyQuaternion(gq), 0.12).normalize();
    // palm: in the guard it faces back towards the face and in towards the middle (right palm to the body's left;
    // facing only inwards is undefined when the forearm itself points in), turning down as the punch extends
    c.set(right ? 0.65 : -0.65, 0, -0.75).applyQuaternion(gq);
    c.lerp(v[22].set(0, -1, 0).applyQuaternion(gq), Math.min(1, ext) * 0.85);
    c.addScaledVector(f, -c.dot(f));
    if (c.lengthSq() < 1e-8) return;
    c.normalize();
    if (!h.tip) return;
    hand.getWorldPosition(u); h.tip.getWorldPosition(w); w.sub(u).normalize();   // current long axis
    if (h.flex) n.copy(h.flex.palm).applyQuaternion(hand.getWorldQuaternion(this.q[1]));   // the palm side measured in the bind pose
    else if (h.index && h.pinky) this.palmNormal(h, w, n);
    else n.copy(h.across).applyQuaternion(hand.getWorldQuaternion(this.q[1]));
    n.addScaledVector(w, -n.dot(w));
    if (n.lengthSq() < 1e-8) return;
    n.normalize();
    this.mA.makeBasis(w, n, u.crossVectors(w, n));
    this.mB.makeBasis(f, c, u.crossVectors(f, c));
    this.mA.transpose(); this.mB.multiply(this.mA);
    this.rotateWorld(hand, this.q[0].setFromRotationMatrix(this.mB));
    if (h.flex || h.baked) this.makeFist(h);
  }

  /** the hands left the stick: the next grip starts fresh, with the blade at its new spot straight away (easing from
   *  where it was left put the shaft out of the hands' reach for the first frames after getting up) */
  private palmDir = new THREE.Vector3();
  private releaseGrip() {
    this.bladeAt.x = NaN;
    for (const h of this.hands) { h.lastPalm.set(0, 0, 0); h.lastHd.set(0, 0, 0); }
  }

  /** move p to within r of c */
  private pull(p: THREE.Vector3, c: THREE.Vector3, r: number) {
    const t = this.v[17].subVectors(p, c), l = t.length();
    if (l > r) p.copy(c).addScaledVector(t, r / l);
  }

  /** world-space: put the middle of this hand's palm on the shaft point `along` metres from `top`, close the fingers */
  private grip(h: Hand, top: THREE.Vector3, dir: THREE.Vector3, along: number, fist = false) {
    const v = this.v, p = v[16], hd = v[17], n = v[18], u = v[19], w = v[20];
    const qr = this.q[0];
    p.copy(top).addScaledVector(dir, along);
    // the hand points from the shoulder towards the grip, square to the shaft
    // (plus some of the body's sideways, across the body: for the top hand shoulder-to-grip runs almost along the
    // shaft, its square part shrinks to nothing and would flip the hand over; the shaft points forward and down,
    // so sideways stays well clear of it)
    h.arm[0].getWorldPosition(hd); hd.subVectors(p, hd);
    hd.add(n.set(h.left ? -0.2 : 0.2, -0.08, 0).applyQuaternion(this.group.getWorldQuaternion(this.q[3])));
    hd.addScaledVector(dir, -hd.dot(dir));
    if (hd.lengthSq() < 1e-8) hd.set(0, -1, 0);
    hd.normalize();
    // turn the hand at most ~25° a frame about the shaft (its direction is ill-defined when that square part is short)
    const gq = this.group.getWorldQuaternion(this.q[3]);
    if (h.lastHd.lengthSq() > 0) {
      w.copy(h.lastHd).applyQuaternion(gq);
      w.addScaledVector(dir, -w.dot(dir));
      if (w.lengthSq() > 1e-8) {
        w.normalize();
        const ang = Math.atan2(u.crossVectors(w, hd).dot(dir), w.dot(hd)), max = 0.45 * Math.min(2, this.dt * 60);
        if (Math.abs(ang) > max) hd.copy(w).applyAxisAngle(dir, Math.sign(ang) * max);
      }
    }
    h.lastHd.copy(hd).applyQuaternion(gq.invert());
    for (const [bone, q] of h.still) bone.quaternion.copy(q);
    // Two palm directions fit (either side of the shaft). Take the one nearest last frame's, so the hand never
    // turns over between frames; the first frame turns the palm to the body's middle.
    const c = this.palmDir.crossVectors(dir, hd).normalize();
    const side = v[22].set(1, 0, 0).applyQuaternion(this.group.getWorldQuaternion(this.q[3]));   // body's left
    const gp = this.group.getWorldQuaternion(this.q[3]);
    if (h.lastPalm.lengthSq() === 0) { if ((c.dot(side) > 0) === h.left) c.negate(); }
    else if (c.dot(v[22].copy(h.lastPalm).applyQuaternion(gp)) < 0) c.negate();
    h.lastPalm.copy(c).applyQuaternion(gp.invert());
    this.reach(h.arm, u.copy(p).addScaledVector(hd, -h.palm).addScaledVector(c, -h.depth));
    const hand = h.arm[2];
    if (!h.tip) return;
    // Turn the hand onto a target frame built from scratch every frame (no dependence on where the clip left it,
    // which flipped the hand whenever the clip pointed it the other way): long axis hd, palm facing across the
    // shaft towards the body's middle (right palm to the body's left, left palm to its right).
    hand.getWorldPosition(u); h.tip.getWorldPosition(w); w.sub(u).normalize();             // current long axis
    if (h.index && h.pinky) this.palmNormal(h, w, n);
    else n.copy(h.across).applyQuaternion(hand.getWorldQuaternion(this.q[3]));          // fist rigs: a fixed hand axis
    n.addScaledVector(w, -n.dot(w));
    if (n.lengthSq() < 1e-8) n.set(0, 1, 0).addScaledVector(w, -w.y);
    n.normalize();
    this.mA.makeBasis(w, n, u.crossVectors(w, n));
    this.mB.makeBasis(hd, c, u.crossVectors(hd, c));
    this.mA.transpose(); this.mB.multiply(this.mA);
    this.rotateWorld(hand, qr.setFromRotationMatrix(this.mB));
    if (!h.index || !h.pinky) return;
    if (fist && h.flex) { this.makeFist(h); return; }
    // close the fingers towards the palm
    this.palmNormal(h, hd, n);
    for (const chain of h.fingers) this.curl(chain, n, CURL);
    if (h.thumb.length) this.curl(h.thumb, n, THUMB_CURL);
  }

  /** palm normal from the knuckle line: index-to-pinky across the hand, crossed with the hand's long axis */
  private palmNormal(h: Hand, hd: THREE.Vector3, out: THREE.Vector3) {
    const a = this.v[21], b = this.v[22];
    h.index!.getWorldPosition(a); h.pinky!.getWorldPosition(b); a.sub(b);
    if (h.left) out.crossVectors(hd, a); else out.crossVectors(a, hd);
    if (out.lengthSq() < 1e-10) out.set(0, -1, 0);
    return out.normalize();
  }

  /** bend each joint of a finger towards the palm normal */
  private curl(chain: THREE.Object3D[], n: THREE.Vector3, angles: number[]) {
    const a = this.v[21], b = this.v[22], ax = this.v[23], qr = this.q[0];
    for (let j = 0; j < chain.length && j < angles.length; j++) {
      const joint = chain[j], child = chain[j + 1] ?? joint.children[0];
      if (!child) break;
      joint.getWorldPosition(a); child.getWorldPosition(b); b.sub(a);
      ax.crossVectors(b, n);
      if (ax.lengthSq() < 1e-12) continue;
      this.rotateWorld(joint, qr.setFromAxisAngle(ax.normalize(), angles[j]));
    }
  }

  /** apply a world-space rotation to a bone (about its own joint) and refresh it and its children */
  private rotateWorld(bone: THREE.Object3D, r: THREE.Quaternion) {
    const qw = this.q[1], qi = this.q[2];
    bone.getWorldQuaternion(qw);
    // local' = local * (W^-1 R W)
    qi.copy(qw).invert().multiply(r).multiply(qw);
    bone.quaternion.multiply(qi).normalize();          // keep it unit: a drifting length scales the bone
    bone.updateWorldMatrix(false, true);
  }

  /** analytic two-bone IK (upper + fore arm), keeping the elbow on the side the animation already bends it */
  private reach(arm: THREE.Object3D[], target: THREE.Vector3) {
    const [a, b, c] = arm;
    const v = this.v, pa = v[7], pb = v[8], pc = v[9], ac = v[10], ab = v[11], ba = v[12], bc = v[13], at = v[14], ax = v[15];
    const [qa, qb, r, qi] = this.q;
    a.getWorldPosition(pa); b.getWorldPosition(pb); c.getWorldPosition(pc);
    const lab = pa.distanceTo(pb), lcb = pb.distanceTo(pc);
    const lat = THREE.MathUtils.clamp(target.distanceTo(pa), 0.01, lab + lcb - 0.01);
    ac.subVectors(pc, pa); ab.subVectors(pb, pa); ba.subVectors(pa, pb); bc.subVectors(pc, pb); at.subVectors(target, pa);
    const ac_ab_0 = Math.acos(cosAngle(ac, ab)), ba_bc_0 = Math.acos(cosAngle(ba, bc));
    const ac_ab_1 = Math.acos(clamp1((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
    const ba_bc_1 = Math.acos(clamp1((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
    ax.crossVectors(ac, ab);
    if (ax.lengthSq() < 1e-10) ax.set(0, -1, 0).cross(ac);              // straight arm: bend downward
    ax.normalize();
    a.getWorldQuaternion(qa); b.getWorldQuaternion(qb);
    // rotation about a world axis, expressed in the bone's own frame, applied on the right of its local rotation
    a.quaternion.multiply(r.setFromAxisAngle(pc.copy(ax).applyQuaternion(qi.copy(qa).invert()), ac_ab_1 - ac_ab_0));
    b.quaternion.multiply(r.setFromAxisAngle(pc.copy(ax).applyQuaternion(qi.copy(qb).invert()), ba_bc_1 - ba_bc_0));
    // Swing the bent arm onto the target. The bend has turned the upper arm and moved the wrist, so read both again:
    // using the pre-bend rotation and shoulder-to-wrist line here left the wrist ~2 cm off target by an amount that
    // depended on the clip's pose, and the hand twitched whenever the idle clip looped.
    a.updateWorldMatrix(false, true);
    c.getWorldPosition(pc); ac.subVectors(pc, pa);
    a.getWorldQuaternion(qa);
    ax.crossVectors(ac, at);
    if (ax.lengthSq() > 1e-12) a.quaternion.multiply(r.setFromAxisAngle(ax.normalize().applyQuaternion(qi.copy(qa).invert()), Math.acos(cosAngle(ac, at))));
    a.updateWorldMatrix(false, true);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const m of this.skinned) m.skeleton.dispose();   // clone-owned bone texture
    this.group.removeFromParent();
  }
}
