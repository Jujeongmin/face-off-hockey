// Authoritative match simulation: rink physics, puck, skaters, goalies, AI teammates, rules, shootout.
// Pure TypeScript (no three.js, no DOM) so the same code runs for AI practice, for the online host, and in tests.
// Physics is top-down 2D in (x, z); the puck lifts only for passes over sticks and for show.
import { RINK, SKATE, PUCK, MATCH, ATTACK_DIR, SKATERS_PER_TEAM, FIGHT, IMPACT, SKILL, PASS_ASSIST, CROSSBAR, SHOOTOUT } from './constants.ts';
import type { InputFrame, MatchEvent, Phase, Puck, Skater, Team, PassKind } from './types.ts';
import type { Tactic, FightAct, FightView, SkillId } from './types.ts';

interface Fighter { id: number; hp: number; st: number; act: FightAct; T: number; left: number; hand: number; cd: number; mag: number; ai: number; ctr: number }
import { DEFAULT_LINEUPS, goalieSkillOf, offPos, OFF_POS_SKILL, skillOfModel, skillsOf, type Lineup } from '../game/roster.ts';

const { halfLength: L, halfWidth: W, cornerRadius: CR, goalX: GX, goalHalfWidth: GW, netDepth: ND, blueX: BLUE_X } = RINK;

/** small seeded RNG so a match replays the same from the same seed + inputs */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** a puck past the goal line carries on into the net, dies in the mesh at the back and drops to the ice. side = ±1, the net's end of the rink */
export function settlePuckInNet(p: { x: number; z: number; y: number; vx: number; vz: number; vy: number }, side: number, dt: number) {
  const back = side * (GX + ND - PUCK.radius), halfZ = GW - PUCK.radius;
  p.x += p.vx * dt; p.z += p.vz * dt; p.vy -= 9.8 * dt; p.y += p.vy * dt;
  if ((p.x - back) * side > 0) { p.x = back; p.vx *= -0.04; p.vz *= 0.45; p.vy = Math.min(0, p.vy); }
  if ((p.x - side * (GX + 0.1)) * side < 0) { p.x = side * (GX + 0.1); p.vx = 0; }
  if (Math.abs(p.z) > halfZ) { p.z = Math.sign(p.z) * halfZ; p.vz *= -0.3; p.vx *= 0.7; }
  if (p.y <= 0) { p.y = 0; p.vy = p.vy < -1 ? -p.vy * 0.25 : 0; const k = Math.max(0, 1 - dt * 2.5); p.vx *= k; p.vz *= k; }
}
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export interface MatchOptions {
  seed?: number;
  periodSeconds?: number;
  /** which teams are driven by a player (the rest of that team, and the goalie, are AI) */
  human?: [boolean, boolean];
  /** goalie skill 0..1 (overrides the goalie's card) */
  goalieSkill?: number;
  /** who plays for each team; skills come from the cards (src/game/roster.ts) */
  lineups?: [Lineup, Lineup];
  /** extra seconds before the first puck drop (the lineup intro plays over it) */
  introSeconds?: number;
  /** heavy hits can start fights */
  fights?: boolean;
  /** shootout rounds before sudden death (default MATCH.shootoutRounds) */
  shootoutRounds?: number;
}

interface ShootoutState {
  round: number;              // attempts taken by each team so far is derived from results
  shooterTeam: Team;
  results: [boolean[], boolean[]];
  attemptT: number;           // seconds left in this attempt
  pause: number;              // between attempts
  shooter: number;            // skater id
  decided: boolean;
  fakes: number;              // fakes tried in this attempt (an AI goalie bites less each time)
  fakeCd: number;
  plan: ShotKind | 'fake' | '';   // AI shooter: what it means to do next
}
export type ShotKind = 'normal' | 'lift' | 'fivehole';

/** the mobile manager's instruction to a team's AI. shoot*: range and per-think chances; lead / trail: where the two
 *  supporting skaters sit relative to the carrier; press: check chance; mark: goal-side gap; sitBack: no forecheck;
 *  cherry: one man stays up for the breakaway; cover: added to the goalie's skill */
/** how far from the carrier the presser waits to lunge: just outside body contact (2 x SKATE.radius = 0.84) */
const PRESS_GAP = 1.1;
const TACTICS: Record<Tactic, { shootRange: number; shootNear: number; shootFar: number; lead: number; trail: number; press: number; mark: number; sitBack: boolean; cherry: boolean; cover: number }> = {
  balanced: { shootRange: 15, shootNear: 0.6, shootFar: 0.32, lead: 4, trail: 3, press: 0.12, mark: 1.8, sitBack: false, cherry: false, cover: 0 },
  attack: { shootRange: 12, shootNear: 0.88, shootFar: 0.3, lead: 8, trail: 1, press: 0.34, mark: 0.7, sitBack: false, cherry: true, cover: -0.24 },
  defend: { shootRange: 13, shootNear: 0.56, shootFar: 0.27, lead: 2.5, trail: 8, press: 0.26, mark: 3.2, sitBack: true, cherry: false, cover: 0.16 },
};

export class Match {
  readonly skaters: Skater[] = [];
  readonly puck: Puck = { x: 0, z: 0, vx: 0, vz: 0, y: 0, vy: 0, owner: -1, last: -1, passTo: -1, shot: false, dead: false, blend: 0, lifted: false, laser: false };
  score: [number, number] = [0, 0];
  clock: number;
  phase: Phase = 'faceoff';
  phaseT = 0;
  /** 1..MATCH.periods; the clock counts one period down at a time */
  period = 1;
  /** which way each team attacks this period (+x or -x); teams change ends after every period */
  attack: [1 | -1, 1 | -1] = [ATTACK_DIR[0], ATTACK_DIR[1]];
  /** skater id each team's player is controlling */
  controlled: [number, number] = [0, SKATERS_PER_TEAM + 1];
  human: [boolean, boolean];
  charge: [number, number] = [-1, -1];
  /** pass power being charged (0..1, -1 none): hold S / W / A with the puck, release to pass */
  passCharge: [number, number] = [-1, -1];
  private passKindQ: [PassKind, PassKind] = ['short', 'short'];
  /** shot booked while a pass is on its way (0..1 power, -1 none): fired as a one-timer the moment it arrives */
  queued: [number, number] = [-1, -1];
  /** how each team's AI plays; only the mobile manager changes it (online matches stay balanced) */
  tactic: [Tactic, Tactic] = ['balanced', 'balanced'];
  /** seconds of the speed boost a team has left from winning a fight */
  morale: [number, number] = [0, 0];
  fight: { f: [Fighter, Fighter]; t: number; over: number } | null = null;
  /** seconds of hit-stop left: nothing moves, input presses wait */
  private freeze = 0;
  offer: { by: number; on: number; t: number; ai: boolean } | null = null;
  private fightsUsed = 0;
  private fightsOn = false;
  shootout: ShootoutState | null = null;
  /** sudden-death overtime: the next goal wins; still tied at the end goes to the shootout */
  overtime = false;
  private otSeconds: number;
  private periodSeconds: number;
  private soRounds: number;
  events: MatchEvent[] = [];
  readonly stats = { shots: [0, 0], saves: [0, 0], checks: 0, takeaways: 0, passes: 0 };
  private rand: () => number;
  private prev: [InputFrame | null, InputFrame | null] = [null, null];
  private lastOwnerTeam: Team | -1 = -1;
  private goalieSkill: [number, number];
  /** each goalie's sideways speed this step (m/s): the five-hole is open while it is high */
  private gkSlide: [number, number] = [0, 0];
  readonly lineups: [Lineup, Lineup];
  private tick = 0;
  /** ±1 while a scored puck is settling into that end's net */
  private netSide = 0;

  /** card skills for a seat (goalies skate at base speed; their reflexes are goalieSkill) */
  private skillsFor(team: Team, slot: number) {
    if (slot === SKATERS_PER_TEAM) return { passSkill: 0.6, handSkill: 0.6, speedMul: 1, shotSkill: 0.3, checkPower: 0.5, skill: 'none' as SkillId };
    const id = this.lineups[team].skaters[slot], k = skillsOf(id, this.lineups[team].levels?.[slot] ?? 0);
    const o = offPos(id, slot) ? OFF_POS_SKILL : 1;              // out of position: a little worse at everything, barely slower
    return { passSkill: k.pass * o, handSkill: k.hands * o, speedMul: k.speed * (1 - (1 - o) * 0.4), shotSkill: k.shot * o, checkPower: k.check * o, skill: skillOfModel(id) };
  }

  constructor(opts: MatchOptions = {}) {
    this.rand = rng(opts.seed ?? 1);
    this.periodSeconds = opts.periodSeconds ?? MATCH.periodSeconds;
    this.soRounds = opts.shootoutRounds ?? MATCH.shootoutRounds;
    this.clock = this.periodSeconds;
    this.otSeconds = Math.min(MATCH.overtimeSeconds, this.clock);
    this.human = opts.human ?? [true, false];
    this.fightsOn = !!opts.fights;
    this.lineups = opts.lineups ?? [DEFAULT_LINEUPS[0], DEFAULT_LINEUPS[1]];
    this.goalieSkill = [0, 1].map(t => opts.goalieSkill ?? goalieSkillOf(this.lineups[t].goalie, this.lineups[t].levels?.[3] ?? 0) * (offPos(this.lineups[t].goalie, 3) ? OFF_POS_SKILL : 1)) as [number, number];
    for (const team of [0, 1] as Team[]) for (let slot = 0; slot <= SKATERS_PER_TEAM; slot++) {
      this.skaters.push({ id: this.skaters.length, team, slot, goalie: slot === SKATERS_PER_TEAM, x: 0, z: 0, vx: 0, vz: 0, face: 0,
        stun: 0, contact: 0, cool: 0, checkCd: 0, lunge: 0, lx: 0, lz: 0, think: 0, tx: 0, tz: 0, sprint: false, hold: 0, react: 0, dive: 0, skillCd: 0, skillT: 0,
        ...this.skillsFor(team, slot) });
    }
    this.faceoff();
    if (opts.introSeconds) this.phaseT += opts.introSeconds;
  }

  // ------------------------------------------------------------------ helpers
  get carrier(): Skater | null { return this.puck.owner >= 0 ? this.skaters[this.puck.owner] : null; }
  goalieOf(t: Team) { return this.skaters[t * (SKATERS_PER_TEAM + 1) + SKATERS_PER_TEAM]; }
  teamSkaters(t: Team) { return this.skaters.filter(s => s.team === t && !s.goalie && !this.benched.has(s.id)); }   // benched (drills, short-handed stages) are out of play
  isControlled(s: Skater) { return this.human[s.team] && this.controlled[s.team] === s.id; }
  private emit(e: MatchEvent) { this.events.push(e); }
  stickX(s: Skater) { return s.x + Math.cos(s.face) * SKATE.stickReach + Math.cos(s.face - Math.PI / 2) * 0.12; }
  stickZ(s: Skater) { return s.z + Math.sin(s.face) * SKATE.stickReach + Math.sin(s.face - Math.PI / 2) * 0.12; }
  private gauss() { return (this.rand() + this.rand() + this.rand() - 1.5) / 1.5; }
  private nearest(list: Skater[], x: number, z: number) {
    let b: Skater | null = null, bd = Infinity;
    for (const o of list) { const d = Math.hypot(o.x - x, o.z - z); if (d < bd) { b = o; bd = d; } }
    return b;
  }

  // ------------------------------------------------------------------ flow
  faceoff() {
    const spots = [[-0.9, 0], [-6, 6], [-6, -6]];
    for (const s of this.skaters) {
      const dir = this.attack[s.team];
      if (s.goalie) { s.x = -dir * (GX - 0.75); s.z = 0; }
      else { const [x, z] = spots[s.slot]; s.x = x * dir; s.z = z * dir; }
      s.vx = s.vz = 0; s.face = dir > 0 ? 0 : Math.PI; s.stun = s.cool = s.hold = s.dive = s.lunge = s.skillT = 0;
    }
    Object.assign(this.puck, { x: 0, z: 0, vx: 0, vz: 0, y: 1.2, vy: 0, owner: -1, passTo: -1, shot: false, dead: false, laser: false });
    this.netSide = 0;
    this.controlled = [0, SKATERS_PER_TEAM + 1];
    this.charge = [-1, -1]; this.passCharge = [-1, -1]; this.queued = [-1, -1];
    this.phase = 'faceoff'; this.phaseT = MATCH.faceoffDelay;
    this.emit({ t: 'faceoff' });
  }

  /** advance one fixed step. inputs[t] is the latest frame from team t's player (null = AI / no player) */
  step(dt: number, inputs: [InputFrame | null, InputFrame | null]) {
    this.tick++;
    if (this.phase === 'end') return;
    if (this.freeze > 0 && (this.phase === 'play' || this.phase === 'fight')) { this.freeze -= dt; return; }
    if (this.phase === 'faceoff') {
      this.phaseT -= dt; this.puck.y = Math.max(0, this.phaseT);
      this.consumeEdges(inputs);                      // presses during the drop do nothing
      if (this.phaseT <= 0) { this.phase = 'play'; this.puck.y = 0; this.emit({ t: 'go' }); }
      return;
    }
    if (this.phase === 'shootout') return this.stepShootout(dt, inputs);
    if (this.phase === 'fight') return this.stepFight(dt, inputs);
    if (this.phase === 'break') {
      this.consumeEdges(inputs);
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.nextPeriod();
      return;
    }
    if (this.phase === 'goal') { this.phaseT -= dt; if (this.phaseT <= 0) { if (this.overtime) this.finishRegulation(); else if (this.clock <= 0) this.endPeriod(); else this.faceoff(); return; } }
    else {
      this.tickOffer(dt);
      for (const t of [0, 1] as Team[]) this.morale[t] = Math.max(0, this.morale[t] - dt);
      this.clock -= dt;
      if (this.clock <= 0) { this.clock = 0; this.endPeriod(); return; }
    }
    for (const s of this.skaters) { s.stun = Math.max(0, s.stun - dt); s.contact = Math.max(0, s.contact - dt); s.cool = Math.max(0, s.cool - dt); s.checkCd = Math.max(0, s.checkCd - dt); s.skillCd = Math.max(0, s.skillCd - dt); s.skillT = Math.max(0, s.skillT - dt); }
    this.autoSwitch();
    for (const s of this.skaters) {
      if (s.goalie) { this.updateGoalie(s, dt, null); continue; }
      if (this.isControlled(s) && this.phase === 'play') continue;
      s.think -= dt;
      if (s.think <= 0 && this.phase === 'play') { s.think = 0.12 + this.rand() * 0.06; this.aiThink(s); this.netDetour(s); }
      this.aiMove(s, dt);
    }
    if (this.phase === 'play') for (const t of [0, 1] as Team[]) if (this.human[t]) this.humanControl(t, inputs[t], dt);
    else this.consumeEdges(inputs);
    for (const s of this.skaters) if (!s.goalie) this.moveSkater(s, dt);
    this.separate();
    this.lunges(dt);
    this.stickPokes(dt);
    this.updatePuck(dt);
  }

  /** the period clock ran out: intermission and a change of ends, or the end of regulation after the last one */
  private endPeriod() {
    if (this.overtime || this.period >= MATCH.periods) return this.finishRegulation();
    this.phase = 'break'; this.phaseT = MATCH.breakSeconds;
    this.puck.dead = true; this.puck.owner = -1; this.puck.vx = this.puck.vz = 0;
    this.emit({ t: 'periodEnd', period: this.period });
  }
  private nextPeriod() {
    this.period++; this.fightsUsed = 0;
    this.changeEnds();
    this.clock = this.periodSeconds;
    this.faceoff();
  }
  private changeEnds() { this.attack = [this.attack[1], this.attack[0]]; }
  private finishRegulation() {
    if (this.score[0] !== this.score[1]) return this.end();
    if (!this.overtime) {
      this.overtime = true; this.period++; this.changeEnds(); this.clock = this.otSeconds;
      this.emit({ t: 'overtime' });
      return this.faceoff();
    }
    this.startShootout();
  }
  private end() {
    this.phase = 'end';
    const so = this.shootout ? [this.shootout.results[0].filter(Boolean).length, this.shootout.results[1].filter(Boolean).length] as [number, number] : null;
    this.emit({ t: 'end', score: [...this.score] as [number, number], shootout: so });
  }
  /** winner: 0, 1, or −1 for a draw (only when the shootout cap is reached) */
  get winner(): Team | -1 {
    if (this.score[0] !== this.score[1]) return this.score[0] > this.score[1] ? 0 : 1;
    if (!this.shootout) return -1;
    const a = this.shootout.results[0].filter(Boolean).length, b = this.shootout.results[1].filter(Boolean).length;
    return a === b ? -1 : a > b ? 0 : 1;
  }

  // ------------------------------------------------------------------ physics
  private boards(o: { x: number; z: number; vx: number; vz: number }, r: number, bounce: number) {
    const ex = L - CR, ez = W - CR;
    let nx = 0, nz = 0, pen = 0;
    if (Math.abs(o.x) > ex && Math.abs(o.z) > ez) {
      const cx = Math.sign(o.x) * ex, cz = Math.sign(o.z) * ez, dx = o.x - cx, dz = o.z - cz, d = Math.hypot(dx, dz);
      if (d > CR - r) { pen = d - (CR - r); nx = -dx / d; nz = -dz / d; }
    } else {
      if (Math.abs(o.x) > L - r) { pen = Math.abs(o.x) - (L - r); nx = -Math.sign(o.x); }
      if (Math.abs(o.z) > W - r) { pen = Math.abs(o.z) - (W - r); nz = -Math.sign(o.z); nx = 0; }
    }
    if (!pen) return 0;
    o.x += nx * pen; o.z += nz * pen;
    const vn = o.vx * nx + o.vz * nz;
    if (vn < 0) { o.vx -= (1 + bounce) * vn * nx; o.vz -= (1 + bounce) * vn * nz; }
    return -vn;
  }
  /** nets are solid boxes behind the goal lines; returns the side (±1) when the puck enters a goal mouth */
  private nets(o: { x: number; z: number; vx: number; vz: number; y?: number }, r: number, isPuck: boolean): number {
    if (isPuck && (o.y ?? 0) > CROSSBAR) return 0;                    // over the bar and the net
    for (const s of [-1, 1]) {
      const x0 = s > 0 ? GX : -GX - ND, x1 = s > 0 ? GX + ND : -GX, z0 = -GW - 0.06, z1 = GW + 0.06;
      if (o.x + r < x0 || o.x - r > x1 || o.z + r < z0 || o.z - r > z1) continue;
      if (isPuck && Math.abs(o.z) < GW - r * 0.5 && Math.sign(o.vx) === s && Math.abs(o.x) < GX + 0.4) return s;
      const pens: [number, number, number][] = [[o.x + r - x0, -1, 0], [x1 - (o.x - r), 1, 0], [o.z + r - z0, 0, -1], [z1 - (o.z - r), 0, 1]];
      pens.sort((a, b) => a[0] - b[0]);
      const [p, nx, nz] = pens[0];
      o.x += nx * p; o.z += nz * p;
      const vn = o.vx * nx + o.vz * nz; if (vn < 0) { o.vx -= 1.5 * vn * nx; o.vz -= 1.5 * vn * nz; }
    }
    if (isPuck) for (const s of [-1, 1]) for (const pz of [-GW, GW]) {
      const dx = o.x - s * GX, dz = o.z - pz, d = Math.hypot(dx, dz);
      if (d < r + 0.05 && d > 0) {
        const nx = dx / d, nz = dz / d, vn = o.vx * nx + o.vz * nz;
        if (vn < 0) { o.vx -= 1.6 * vn * nx; o.vz -= 1.6 * vn * nz; if (Math.abs(vn) > 6) this.emit({ t: 'post' }); }
        o.x = s * GX + nx * (r + 0.05); o.z = pz + nz * (r + 0.05);
      }
    }
    return 0;
  }

  /** skating: accelerate toward the stick direction; turning against momentum is slower (ice) */
  steer(s: Skater, dx: number, dz: number, dt: number, sprint = false) {
    const len = Math.hypot(dx, dz);
    let max = (sprint ? SKATE.sprintSpeed : SKATE.maxSpeed) * s.speedMul * (this.morale[s.team] > 0 ? FIGHT.moraleSpeed : 1);
    if (s.skill === 'rush' && s.skillT > 0) max *= SKILL.rush.speed;
    if (this.puck.owner === s.id) max *= SKATE.carryFactor;
    if (s.stun > 0) dx = dz = 0;
    if (len > 0.05 && s.stun <= 0) {
      const tx = dx / Math.max(1, len) * max, tz = dz / Math.max(1, len) * max;
      const ddx = tx - s.vx, ddz = tz - s.vz, dl = Math.hypot(ddx, ddz);
      const along = (s.vx * tx + s.vz * tz) / (Math.hypot(s.vx, s.vz) * Math.hypot(tx, tz) + 1e-6);
      const a = (along > 0.3 ? SKATE.accel : SKATE.turnAccel) * dt;
      if (dl > 0) { const k = Math.min(1, a / dl); s.vx += ddx * k; s.vz += ddz * k; }
    } else {
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > 0) { const k = Math.max(0, sp - SKATE.glide * dt) / sp; s.vx *= k; s.vz *= k; }
    }
  }
  moveSkater(s: Skater, dt: number) {
    s.x += s.vx * dt; s.z += s.vz * dt;
    const wall = this.boards(s, SKATE.radius, s.stun > 0 ? 0.5 : 0.25);
    if (wall > 4 && s.stun > 0 && s.contact <= 0) { s.contact = 0.5; this.freeze = Math.max(this.freeze, IMPACT.boards); this.emit({ t: 'boardHit', on: s.id, speed: wall }); }
    this.nets(s, SKATE.radius, false);
    if (Math.hypot(s.vx, s.vz) > 0.6) s.face = lerpAngle(s.face, Math.atan2(s.vz, s.vx), Math.min(1, dt * 10));
  }
  private separate() {
    const sk = this.skaters;
    for (let i = 0; i < sk.length; i++) for (let j = i + 1; j < sk.length; j++) {
      const a = sk[i], b = sk[j];
      if (this.phase === 'shootout' && (this.parked(a) || this.parked(b))) continue;
      if (this.benched.has(a.id) || this.benched.has(b.id)) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = SKATE.radius * 2 + (a.goalie || b.goalie ? 0.15 : 0);
      if (d < min && d > 0) {
        const nx = dx / d, nz = dz / d, p = (min - d) / 2;
        if (!a.goalie) { a.x -= nx * p; a.z -= nz * p; } if (!b.goalie) { b.x += nx * p; b.z += nz * p; }
        const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rv >= 0) continue;
        // opponents who run into each other bounce, the bigger hitter moving less; teammates, goalies and a landing check just stop dead
        const body = a.team !== b.team && !a.goalie && !b.goalie && a.lunge <= 0 && b.lunge <= 0 && rv < -2.5;
        const ma = body ? 1 + 0.6 * a.checkPower : 1, mb = body ? 1 + 0.6 * b.checkPower : 1;
        const j = (1 + (body ? 0.35 : 0)) * rv / (1 / ma + 1 / mb);
        a.vx += j / ma * nx; a.vz += j / ma * nz; b.vx -= j / mb * nx; b.vz -= j / mb * nz;
        if (body && rv < -3.5 && a.contact <= 0 && b.contact <= 0) { a.contact = b.contact = 0.45; this.emit({ t: 'collide', a: a.id, b: b.id, speed: -rv }); }
      }
    }
  }

  // ------------------------------------------------------------------ puck actions
  private release(s: Skater) { this.puck.owner = -1; s.cool = 0.3; this.puck.last = s.id; this.shotAge = 0; }
  /** seconds since the puck last left a stick (a quick five-hole beats the legs closing) */
  private shotAge = 0;
  private shotKind: ShotKind = 'normal';
  // ---- pass assist (FC-style): rough direction in, best teammate + lead + pace out
  /** pass pace for distance d. power 0..1 is how long the pass key was held (0.4 = the old fixed pace) */
  private passSpeed(d: number, kind: PassKind, power = 0.4) { return clamp(9 + d * 0.6, 12, 24) * (kind === 'lift' ? 0.78 : 1) * (0.8 + 0.5 * power); }
  /** where receiver r will be when a pass from (fx, fz) arrives; through passes go into the space ahead */
  leadPoint(fx: number, fz: number, r: Skater, kind: PassKind, power = 0.4) {
    let x = r.x, z = r.z, t = 0;
    for (let i = 0; i < 2; i++) {                    // two rounds of "time to arrive" <-> "where then"
      const d = Math.hypot(x - fx, z - fz); t = d / this.passSpeed(d, kind, power);
      x = r.x + r.vx * t; z = r.z + r.vz * t;
    }
    if (kind === 'through') { x += this.attack[r.team] * 4.5 * (0.6 + power); z *= 0.85; }
    return { x: clamp(x, -GX - 1, GX + 1), z: clamp(z, -W + 1.2, W - 1.2), t };
  }
  /** 0..1: how likely an opponent stick gets to the lane before the puck passes (saucer passes fly over most) */
  laneRisk(ax: number, az: number, bx: number, bz: number, team: Team, kind: PassKind, power = 0.4) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1, speed = this.passSpeed(len, kind, power);
    let risk = 0;
    for (const o of this.skaters) {
      if (o.team === team || o.goalie || o.stun > 0) continue;
      const t = clamp(((o.x - ax) * dx + (o.z - az) * dz) / (len * len), 0, 1);
      const d = Math.hypot(ax + dx * t - o.x, az + dz * t - o.z);
      const reach = 0.75 + SKATE.maxSpeed * (t * len / speed) * 0.55;   // how far it can lunge in that time
      let r = clamp((reach - d) / reach, 0, 1);
      if (kind === 'lift' && t > 0.15 && t < 0.85) r *= 0.2;
      risk = Math.max(risk, r);
    }
    return risk;
  }
  /** best teammate for a pass in direction (dx, dz); hasDir = the player gave a direction */
  passTarget(s: Skater, dx: number, dz: number, kind: PassKind, hasDir: boolean, power = 0.4, byPower = false): Skater | null {
    let best: Skater | null = null, bs = -Infinity;
    const minCos = hasDir ? 0.2 : 0.05;   // wide cone: a rough direction is enough (FC-style)
    for (const o of this.teamSkaters(s.team)) {
      if (o === s) continue;
      const L = this.leadPoint(this.puck.x, this.puck.z, o, kind, power);
      const vx = L.x - s.x, vz = L.z - s.z, d = Math.hypot(vx, vz) || 1, cos = (vx * dx + vz * dz) / d;
      if (cos < minCos) continue;
      const risk = this.laneRisk(this.puck.x, this.puck.z, L.x, L.z, s.team, kind, power);
      const forward = (L.x - s.x) * this.attack[s.team];
      // a soft pass looks for a near teammate, a hard one for a far one (tap ~7 m, full ~26 m)
      // (a player's charged pass leans on its power much more than the AI's default pace)
      const score = cos * 2 - Math.abs(d - (4 + 22 * power)) / (byPower ? 10 : 25) - risk * 1.6 + forward * 0.03 + Math.min(4, this.openness(o)) * 0.05;
      if (score > bs) { bs = score; best = o; }
    }
    return best;
  }
  pass(s: Skater, target: Skater, kind: PassKind = 'short', power = 0.4) {
    const p = this.puck;
    const L = this.leadPoint(p.x, p.z, target, kind, power);
    const d = Math.hypot(L.x - p.x, L.z - p.z) || 1;
    const speed = this.passSpeed(d, kind, power);
    // not every pass is perfect: skill, pressure and pace spread the angle and the weight
    const pressed = this.skaters.some(o => o.team !== s.team && !o.goalie && Math.hypot(o.x - s.x, o.z - s.z) < 2.5);
    // saucer passes clear sticks but are harder to place and to receive
    const laser = s.skill === 'laser' && s.skillT > 0;
    const errDeg = laser ? 0 : (0.6 + (1 - s.passSkill) * 2.2 + (pressed ? 1.8 : 0)) * (kind === 'lift' ? 1.8 : 1) * this.gauss();
    const a = Math.atan2(L.z - p.z, L.x - p.x) + errDeg * Math.PI / 180;
    const pace = speed * (1 + this.gauss() * 0.04 * (1.5 - s.passSkill));
    this.release(s);
    p.vx = Math.cos(a) * pace; p.vz = Math.sin(a) * pace; p.passTo = target.id; p.shot = false; p.lifted = kind === 'lift'; p.laser = laser;
    if (laser) s.skillT = 0;
    if (kind === 'lift') p.vy = 4.2;
    target.tx = L.x; target.tz = L.z; target.think = Math.min(0.8, L.t + 0.2);   // receiver skates onto it
    this.stats.passes++; this.emit({ t: 'pass', by: s.id });
  }
  /** where the receiver should meet the moving puck: closest point of the puck's path ahead of it */
  private meetPoint(s: Skater) {
    const p = this.puck, v2 = p.vx * p.vx + p.vz * p.vz || 1;
    const t = clamp(((s.x - p.x) * p.vx + (s.z - p.z) * p.vz) / v2, 0, 1.5);
    return { x: p.x + p.vx * t, z: p.z + p.vz * t };
  }
  private passDir(s: Skater, dx: number, dz: number, power = 0.4) {
    const v = 16 * (0.8 + 0.5 * power);
    this.release(s); this.puck.vx = dx * v; this.puck.vz = dz * v; this.puck.passTo = -1; this.puck.shot = false;
    this.emit({ t: 'pass', by: s.id });
  }
  /**
   * shot at the opponent net. aimZ = world z side to aim at (null = far side). charge trades accuracy for speed.
   * Shootout only: 'lift' goes up under the bar (over a goalie who is down), 'fivehole' low at the goalie's middle.
   */
  shoot(s: Skater, charge: number, aimZ: number | null, kind: ShotKind = 'normal') {
    const p = this.puck, gx = this.attack[s.team] * GX;
    if (kind !== 'normal') return this.shootoutShot(s, charge, aimZ, kind);
    this.shotKind = 'normal';
    const tz = aimZ != null && Math.abs(aimZ) > 0.25 ? Math.sign(aimZ) * 0.72 : -Math.sign(s.z || 1) * 0.6;
    const d = Math.hypot(gx - p.x, tz - p.z);
    const sniped = s.skill === 'snipe' && s.skillT > 0;
    const err = (0.12 + 0.35 * charge + d * 0.012) * (1.35 - 0.7 * s.shotSkill) * (sniped ? SKILL.snipe.accuracy : 1) * this.gauss();   // a sniper keeps a charged shot on target
    const speed = (19 + 14 * charge) * (0.94 + 0.12 * s.shotSkill) * (sniped ? SKILL.snipe.power : 1);
    if (sniped) s.skillT = 0;
    const ax = gx - p.x, az = tz + err - p.z, al = Math.hypot(ax, az);
    this.release(s);
    p.vx = ax / al * speed; p.vz = az / al * speed; p.vy = 1.2 + 2.6 * charge; p.shot = true; p.passTo = -1; p.laser = false;
    this.stats.shots[s.team]++; this.emit({ t: 'shot', by: s.id, power: charge });
  }
  private shootoutShot(s: Skater, charge: number, aimZ: number | null, kind: 'lift' | 'fivehole') {
    const p = this.puck, gx = this.attack[s.team] * GX, gk = this.goalieOf((1 - s.team) as Team);
    this.shotKind = kind;
    const miss = 1.35 - 0.7 * s.shotSkill;
    // five-hole: at where the goalie's middle will be when the puck gets there (he is sliding)
    const lead = Math.hypot(gx - p.x, gk.z - p.z) / ((17 + 10 * charge) * (0.94 + 0.12 * s.shotSkill)) * this.gkSlide[gk.team];
    const tz = kind === 'fivehole' ? clamp(gk.z + lead, -0.85, 0.85) + 0.035 * miss * this.gauss()
      : (aimZ != null && Math.abs(aimZ) > 0.25 ? Math.sign(aimZ) * 0.66 : -Math.sign(s.z || 1) * 0.55) + (0.18 + 0.2 * charge) * miss * this.gauss();
    // a lifted shot is slower and wider than a wrist shot: its edge is the goalie who is down, not the corner
    const speed = (kind === 'lift' ? 12 + 7 * charge : 17 + 10 * charge) * (0.94 + 0.12 * s.shotSkill);
    const ax = gx - p.x, az = tz - p.z, al = Math.hypot(ax, az) || 1;
    this.release(s);
    p.vx = ax / al * speed; p.vz = az / al * speed; p.shot = true; p.passTo = -1; p.laser = false; p.y = 0;
    if (kind === 'lift') {
      // up to the aimed height at the goal line (friction slows it a little on the way: close enough at these ranges)
      const t = al / speed, h = SHOOTOUT.liftHeight + SHOOTOUT.liftSpread * miss * this.gauss();
      p.vy = Math.min(SHOOTOUT.liftMaxVy, (h + 4.9 * t * t) / t);   // from far out it would be a lob over the glass: it drops short instead
    } else p.vy = 0;
    this.stats.shots[s.team]++; this.emit({ t: 'shot', by: s.id, power: charge });
  }
  /** shootout: the shooter shows a shot and keeps the puck. An AI goalie may go down for it */
  private fake(s: Skater, side: number) {
    const so = this.shootout;
    if (!so || so.fakeCd > 0 || this.puck.owner !== s.id) return;
    so.fakeCd = SHOOTOUT.fakeCooldown;
    this.emit({ t: 'fake', by: s.id });
    const def = (1 - s.team) as Team, gk = this.goalieOf(def);
    const bite = SHOOTOUT.bite * Math.pow(0.5, so.fakes++) * (1.2 - 0.4 * this.goalieSkill[def]);
    if (!this.human[def] && gk.dive <= 0 && this.rand() < bite) this.goDown(gk, side || Math.sign(this.puck.vz) || 1);
  }
  /** AI goalie dives toward a side (shootout) */
  private goDown(gk: Skater, side: number) {
    gk.dive = SHOOTOUT.dive + SHOOTOUT.recover; gk.react = 1;
    gk.z = clamp(gk.z + Math.sign(side) * 0.35, -0.95, 0.95);
  }
  /**
   * Body check: a short lunge along the facing. It only lands on real contact during the lunge, and how hard it
   * lands is the closing speed along the line of contact: meeting a skater head-on or from the side at speed
   * knocks him down, catching one who skates away from you barely bumps him, a whiff leaves you off balance.
   * Timing and angle decide it; nothing is random.
   */
  check(s: Skater) {
    if (s.checkCd > 0 || s.stun > 0 || s.lunge > 0) return;
    s.checkCd = 1.1; s.lunge = 0.22;
    s.lx = Math.cos(s.face); s.lz = Math.sin(s.face);
    s.vx += s.lx * 4; s.vz += s.lz * 4;
    this.emit({ t: 'lunge', by: s.id });
  }
  private lunges(dt: number) {
    for (const s of this.skaters) {
      if (s.lunge <= 0) continue;
      s.lunge -= dt;
      let hit: Skater | null = null, hd = SKATE.radius * 2 + 0.3;
      for (const o of this.skaters) {
        if (o.team === s.team || o.goalie || o.stun > 0) continue;
        const dx = o.x - s.x, dz = o.z - s.z, d = Math.hypot(dx, dz);
        if (d < hd && (dx * s.lx + dz * s.lz) / (d || 1) > 0.35) { hit = o; hd = d; }
      }
      if (hit) { s.lunge = 0; this.checkContact(s, hit); }
      else if (s.lunge <= 0) { s.lunge = 0; if (s.skill !== 'charge' || s.skillT <= 0) s.stun = 0.3; }   // whiffed: overcommitted (the skill's charge recovers)
    }
  }
  private checkContact(s: Skater, o: Skater) {
    const d = Math.hypot(o.x - s.x, o.z - s.z) || 1, nx = (o.x - s.x) / d, nz = (o.z - s.z) / d;
    // closing speed along the contact line, weighed by who is the bigger hitter: an enforcer needs less speed to
    // put someone down, and a strong skater takes more to be moved
    let vn = ((s.vx - o.vx) * nx + (s.vz - o.vz) * nz) * (0.8 + 0.4 * s.checkPower) / (0.8 + 0.4 * o.checkPower);
    if (s.skill === 'charge' && s.skillT > 0) { vn = Math.max(vn, SKILL.charge.hit); s.skillT = 0; }   // the skill always lands as a heavy hit
    const carrier = this.puck.owner === o.id;
    if (vn < 2.5) {                                                    // bounced off: the checker loses his feet
      s.stun = 0.35; s.vx -= nx * 2; s.vz -= nz * 2;
      this.emit({ t: 'bump', by: s.id, on: o.id });
      return;
    }
    if (vn < 4) {                                                      // a shove: both slow, the puck stays
      const still = carrier && Math.hypot(o.vx, o.vz) < 2.5;          // ...unless the carrier was standing on it: a shove knocks it off his stick
      o.vx += nx * vn * 0.4; o.vz += nz * vn * 0.4; s.vx -= nx * vn * 0.4; s.vz -= nz * vn * 0.4;
      if (still) { this.release(o); o.cool = 0.4; this.puck.vx = nx * 3 + o.vx * 0.5; this.puck.vz = nz * 3 + o.vz * 0.5; }
      this.emit({ t: 'bump', by: s.id, on: o.id });
      return;
    }
    const hard = vn > 6.5;
    o.stun = hard ? 0.8 : 0.3;
    const thrown = hard ? 0.85 : 0.6, recoil = hard ? 0.2 : 0.35;     // a big hit sends the victim flying and the hitter skates through it
    o.vx += nx * vn * thrown; o.vz += nz * vn * thrown;
    s.vx -= nx * vn * recoil; s.vz -= nz * vn * recoil;
    this.freeze = Math.max(this.freeze, hard ? IMPACT.hard : IMPACT.check);
    if (carrier) {                                                     // the puck squirts on along the hit
      this.release(o); o.cool = hard ? 0.8 : 0.45;
      this.puck.vx = o.vx * 0.6 + nx * 2.5; this.puck.vz = o.vz * 0.6 + nz * 2.5;
    }
    this.stats.checks++; this.emit({ t: 'check', by: s.id, on: o.id, hard });
    if (hard) this.offerFight(o, s);
  }
  // ------------------------------------------------------------------ skills
  /** the skater's skill in direction (dx, dz); aimZ picks the side of the net for a shot. False = not available now */
  useSkill(s: Skater, dx: number, dz: number, aimZ: number | null): boolean {
    const k = s.skill;
    if (k === 'none' || s.goalie || s.skillCd > 0 || s.stun > 0 || s.lunge > 0 || this.phase !== 'play') return false;
    const has = this.puck.owner === s.id;
    s.skillCd = SKILL[k].cd;
    this.emit({ t: 'skill', by: s.id, kind: k });
    if (k === 'rush') s.skillT = SKILL.rush.seconds;
    else if (k === 'dash') { s.vx = dx * SKILL.dash.speed; s.vz = dz * SKILL.dash.speed; s.face = Math.atan2(dz, dx); }
    else if (k === 'snipe') { s.skillT = SKILL.snipe.armed; if (has) this.shoot(s, 1, aimZ); }
    else if (k === 'laser') {
      s.skillT = SKILL.laser.armed;
      const target = has ? this.passTarget(s, dx, dz, 'short', true, 1) : null;
      if (target) { this.pass(s, target, 'short', 1); if (this.controlled[s.team] === s.id) this.controlled[s.team] = target.id; }
    }
    else if (k === 'charge') {
      s.lunge = SKILL.charge.lunge; s.skillT = SKILL.charge.lunge + 0.1;
      s.lx = dx; s.lz = dz; s.vx = dx * SKILL.charge.speed; s.vz = dz * SKILL.charge.speed; s.face = Math.atan2(dz, dx);
      this.emit({ t: 'lunge', by: s.id });
    }
    else this.sweep(s);
    return true;
  }
  /** rocks every opponent nearby and drags a carried or loose puck toward the sweeper */
  private sweep(s: Skater) {
    const { radius, stun, push, pull } = SKILL.sweep, p = this.puck;
    for (const o of this.skaters) {
      if (o.team === s.team || o.goalie) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      if (d >= radius || d === 0) continue;
      const nx = (o.x - s.x) / d, nz = (o.z - s.z) / d;
      o.stun = Math.max(o.stun, stun); o.vx += nx * push; o.vz += nz * push; o.lunge = 0;
      if (p.owner === o.id) { this.release(o); o.cool = 0.7; }
    }
    const pd = Math.hypot(p.x - s.x, p.z - s.z);
    if (p.owner < 0 && !p.dead && pd < radius && pd > 0) {
      p.vx = (s.x - p.x) / pd * pull; p.vz = (s.z - p.z) / pd * pull; p.passTo = -1; p.shot = false; p.laser = false;
    }
  }
  /** AI skaters use theirs when the moment fits; a roll keeps them from firing the instant it comes back */
  private aiSkill(s: Skater) {
    if (this.rand() > 0.25) return false;
    const own = this.carrier, p = this.puck, goalX = this.attack[s.team] * GX, has = own === s;
    const foe = own && own.team !== s.team ? own : null, dFoe = foe ? Math.hypot(foe.x - s.x, foe.z - s.z) : Infinity;
    const dGoal = Math.hypot(goalX - s.x, s.z), dPuck = Math.hypot(p.x - s.x, p.z - s.z);
    const toward = (x: number, z: number) => { const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz) || 1; return this.useSkill(s, dx / d, dz / d, null); };
    switch (s.skill) {
      case 'dash': return has && dGoal > 6 ? toward(goalX, 0) : !own && dPuck < 9 ? toward(p.x, p.z) : false;
      case 'rush': return has || dFoe < 8 ? toward(goalX, 0) : false;
      case 'snipe': return has && dGoal < 16 && Math.abs(s.z) < 9 ? toward(goalX, 0) : false;
      case 'laser': return has && this.skaters.some(o => o.team !== s.team && !o.goalie && Math.hypot(o.x - s.x, o.z - s.z) < 2.6) ? toward(goalX, s.z) : false;
      case 'charge': return foe && dFoe < 3.4 ? toward(foe.x, foe.z) : false;
      case 'sweep': return foe && dFoe < SKILL.sweep.radius * 0.8 ? toward(foe.x, foe.z) : false;
      default: return false;
    }
  }
  private stickPokes(dt: number) {
    const c = this.carrier;
    if (!c || c.goalie) return;
    for (const o of this.skaters) {
      if (o.team === c.team || o.goalie || o.stun > 0) continue;
      if (Math.hypot(this.stickX(o) - this.puck.x, this.stickZ(o) - this.puck.z) < 0.5 && this.rand() < 0.5 * dt) {
        this.release(c); c.cool = 0.5;
        this.puck.vx = (this.rand() - 0.5) * 6; this.puck.vz = (this.rand() - 0.5) * 6;
        return;
      }
    }
  }
  private takePuck(s: Skater) {
    const p = this.puck, prevTeam = p.last >= 0 ? this.skaters[p.last].team : -1;
    p.owner = s.id; p.passTo = -1; p.shot = false; p.last = s.id; p.blend = 0.16; p.lifted = false; p.laser = false;
    if (prevTeam !== -1 && prevTeam !== s.team) { this.stats.takeaways++; this.emit({ t: 'takeaway', by: s.id }); }
  }

  private updatePuck(dt: number) {
    const p = this.puck;
    if (p.dead) { if (this.netSide) settlePuckInNet(p, this.netSide, dt); return; }
    const c = this.carrier;
    this.shotAge += dt;
    if (c) {
      const sp = Math.hypot(c.vx, c.vz);
      const dangle = Math.sin(this.tick / 14) * 0.12 * Math.min(1, sp / 4);
      let px = this.stickX(c) + Math.cos(c.face + Math.PI / 2) * dangle, pz = this.stickZ(c) + Math.sin(c.face + Math.PI / 2) * dangle;
      if (p.blend > 0) {                       // just received: glide onto the blade instead of jumping there
        p.blend -= dt; const k = 1 - Math.exp(-dt * 22);
        px = p.x + (px - p.x) * k; pz = p.z + (pz - p.z) * k;
      }
      p.vx = (px - p.x) / dt; p.vz = (pz - p.z) / dt; p.x = px; p.z = pz; p.y = Math.max(0, p.y - dt * 4);
      return;
    }
    this.homePass(dt);
    let sp = Math.hypot(p.vx, p.vz);
    if (sp > PUCK.maxSpeed) { p.vx *= PUCK.maxSpeed / sp; p.vz *= PUCK.maxSpeed / sp; sp = PUCK.maxSpeed; }
    if (sp > 0) { const k = Math.max(0, sp - PUCK.friction * dt) / sp; p.vx *= k; p.vz *= k; }
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.vy -= 9.8 * dt; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0) p.vy = 0;
    const hit = this.boards(p, PUCK.radius, PUCK.boardBounce);
    if (hit > 8) this.emit({ t: 'board', speed: hit });
    const g = this.nets(p, PUCK.radius, true);
    if (g) return this.goal(this.attack[0] === g ? 0 : 1, g);    // whichever team attacks that end this period
    if (sp < 6) { p.shot = false; p.laser = false; }
    for (const t of [0, 1] as Team[]) this.goalieSave(this.goalieOf(t), dt);
    if (this.puck.owner >= 0) return;
    // pick-ups: closest stick wins; a fast puck can bounce off a stick unless it was passed to you
    let best: Skater | null = null, bd = Infinity;
    for (const s of this.skaters) {
      if (s.goalie || s.stun > 0 || s.cool > 0) continue;
      if (this.phase === 'shootout' && this.parked(s)) continue;
      if (this.benched.has(s.id)) continue;
      if (s.id === p.last && p.passTo >= 0 && p.passTo !== s.id && this.shotAge < 1) continue;   // a live pass belongs to its receiver: the passer skating after it must not take it back
      if (p.laser && p.last >= 0 && this.skaters[p.last].team !== s.team) continue;   // a laser pass goes through opposing sticks
      // the intended receiver reaches a little further (stick out for the pass)
      const d = Math.hypot(this.stickX(s) - p.x, this.stickZ(s) - p.z), reach = 0.55 + (sp < 5 ? 0.3 : 0) + (p.passTo === s.id ? PASS_ASSIST.reach : 0);
      if (d < reach && d < bd && p.y < 0.6) { best = s; bd = d; }
    }
    if (best) {
      // a booked one-timer meets the pass with the blade: no bounce, no bobble
      if (this.human[best.team] && this.controlled[best.team] === best.id && this.queued[best.team] >= 0) { this.takePuck(best); return; }
      const rel = Math.hypot(p.vx - best.vx, p.vz - best.vz);
      if (rel > 17 && p.passTo !== best.id && this.rand() < 0.6) { p.vx *= -0.3; p.vz = p.vz * 0.4 + (this.rand() - 0.5) * 6; best.cool = 0.25; return; }
      // a hard pass can bobble off the stick: it slows and skips a little instead of sticking
      const fumble = (clamp((rel - 12) / 20, 0, 0.6) + (p.lifted ? 0.15 : 0)) * (1 - best.handSkill * 0.7) * (p.passTo === best.id ? 0.4 : 1);
      if (this.rand() < fumble) { p.vx = p.vx * 0.3 + (this.rand() - 0.5) * 3; p.vz = p.vz * 0.3 + (this.rand() - 0.5) * 3; best.cool = 0.18; p.passTo = -1; return; }
      this.takePuck(best);
    }
  }

  /** a pass bends gently toward where its receiver's stick will be, so a receiver who keeps moving still gets it */
  private homePass(dt: number) {
    const p = this.puck, sp = Math.hypot(p.vx, p.vz);
    if (p.passTo < 0 || sp < 1) return;
    const r = this.skaters[p.passTo], dist = Math.hypot(this.stickX(r) - p.x, this.stickZ(r) - p.z), t = dist / sp;
    if (dist > PASS_ASSIST.near) return;
    const want = Math.atan2(this.stickZ(r) + r.vz * t - p.z, this.stickX(r) + r.vx * t - p.x), now = Math.atan2(p.vz, p.vx);
    const off = Math.atan2(Math.sin(want - now), Math.cos(want - now));
    if (Math.abs(off) > PASS_ASSIST.maxOff) return;                     // already past him: no boomerangs
    const a = now + clamp(off, -PASS_ASSIST.turn * dt, PASS_ASSIST.turn * dt);
    p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp;
  }
  private goal(team: Team, side: number) {
    const p = this.puck;
    p.dead = true; this.netSide = side;
    if (this.phase === 'shootout') return this.shootoutResult(true);
    this.score[team]++;
    const scorer = p.last >= 0 && this.skaters[p.last].team === team ? p.last : -1;
    this.emit({ t: 'goal', team, by: scorer });
    this.phase = 'goal'; this.phaseT = MATCH.goalPause;
  }

  // ------------------------------------------------------------------ goalies
  private ownNetSide(t: Team) { return this.attack[t] > 0 ? -1 : 1; }
  private goalieSave(gk: Skater, dt: number) {
    const s = this.ownNetSide(gk.team), p = this.puck;
    if (gk.hold > 0 || p.owner >= 0) return;
    const gx = s * (GX - 0.75);
    if (p.vx * s <= 0) return;
    const prevX = p.x - p.vx * dt;
    if (!((prevX - gx) * s < 0 && (p.x - gx) * s >= 0)) return;      // crossed the goalie plane this step
    // in the shootout the goalie must guess: smaller natural reach, the dive (player D / AI guess) covers the gap
    const gs = this.goalieSkill[gk.team] + TACTICS[this.tactic[gk.team]].cover;      // tactic: a packed slot helps the goalie, an exposed one hurts
    const base = this.phase === 'shootout' ? 0.16 + gs * 0.16 : 0.26 + gs * 0.26;
    let reach = base + (p.y > 0.5 ? -0.08 : 0) + (gk.dive > SHOOTOUT.recover ? 0.45 : 0);   // the stretch; after it the goalie is still down, getting up
    if (this.phase === 'shootout') {
      // down on the ice: a high puck goes over the pads and the arm
      const down = gk.dive > 0;
      if (down && p.y > SHOOTOUT.overPad) reach = base * SHOOTOUT.downReach;
      else if (!down && p.y > SHOOTOUT.overPad) reach = base + SHOOTOUT.highReach;      // standing: the high shot is where his hands are
      // a low puck at the middle goes between the legs while he slides across or before he can close them
      const open = Math.abs(this.gkSlide[gk.team]) > SHOOTOUT.openSlide || (this.shotKind === 'fivehole' && this.shotAge < SHOOTOUT.quickRelease);
      if (!down && p.y < 0.25 && Math.abs(p.z - gk.z) < SHOOTOUT.fiveHole && open) return;
    }
    if (Math.abs(p.z - gk.z) >= reach) return;
    const sp = Math.hypot(p.vx, p.vz);
    this.stats.saves[gk.team]++;
    if (this.phase === 'shootout') { p.vx = -p.vx * 0.3; p.vz = (this.rand() - 0.5) * 6; this.emit({ t: 'save', by: gk.id, held: false }); return this.shootoutResult(false); }
    if (sp < 15 && Math.abs(p.z - gk.z) < 0.3) {
      p.owner = gk.id; p.vx = p.vz = 0; gk.hold = 0.8; p.shot = false; p.last = gk.id;
      this.emit({ t: 'save', by: gk.id, held: true }); return;
    }
    p.x = gx - s * 0.05; p.vx = -p.vx * 0.32; p.vz = (this.rand() - 0.5) * 9; p.vy = 0.8; p.shot = false; p.last = gk.id;
    this.emit({ t: 'save', by: gk.id, held: false });
  }
  /** goalie AI (and, in the shootout, the defending player's lateral control + dive) */
  private updateGoalie(gk: Skater, dt: number, control: InputFrame | null) {
    const s = this.ownNetSide(gk.team), p = this.puck, homeX = s * (GX - 0.75);
    gk.dive = Math.max(0, gk.dive - dt);
    let tz: number;
    if (control) {
      tz = clamp(gk.z + control.mz * 3, -0.95, 0.95);
    } else {
      tz = clamp(p.z * (0.75 / Math.max(1.5, Math.abs(s * GX - p.x))) * 1.6, -0.8, 0.8);
      if (p.shot && p.vx * s > 0) {                                    // read the shot after a short reaction delay
        gk.react += dt;
        if (gk.react > 0.15) { const t = (homeX - p.x) / p.vx; tz = clamp(p.z + p.vz * t, -0.95, 0.95); }
      } else gk.react = 0;
    }
    const speed = control ? 4.2 : this.phase === 'shootout' ? 2.4 : p.shot ? 3.2 : 3.5, dz = tz - gk.z;
    const step = Math.sign(dz) * Math.min(Math.abs(dz), speed * dt * (gk.dive > 0 ? 0.3 : 1));
    gk.z += step;
    if (dt > 0) this.gkSlide[gk.team] = step / dt;
    gk.x += (homeX - gk.x) * Math.min(1, dt * 6);
    gk.face = s > 0 ? Math.PI : 0;
    if (gk.hold > 0) {
      gk.hold -= dt;
      p.x = gk.x - s * 0.6; p.z = gk.z; p.vx = p.vz = 0;
      if (gk.hold <= 0) {                                              // clear it to the nearest teammate
        const t = this.nearest(this.teamSkaters(gk.team), gk.x, gk.z);
        if (t) { p.owner = gk.id; this.pass(gk, t); gk.cool = 0.6; }
      }
    }
  }

  // ------------------------------------------------------------------ fights
  // A heavy hit lets the player who took it call a fight. Play stops, the two fighters box (punch, guard, dodge, no
  // randomness for humans), and knocking the other down or leading on health after 15 s gives the winner's whole team
  // a burst of speed. One per period. Only sessions that ask for it have fights (not the tutorial or the lobby rink).
  private offerFight(victim: Skater, hitter: Skater) {
    if (!this.fightsOn || this.phase !== 'play' || this.offer || this.overtime || victim.goalie || hitter.goalie || this.fightsUsed >= FIGHT.perPeriod) return;
    const aiYes = !this.human[victim.team] && this.rand() < 0.35;
    this.offer = { by: victim.id, on: hitter.id, t: FIGHT.offerSeconds, ai: aiYes };
    this.emit({ t: 'fightOffer', by: victim.id, on: hitter.id });
  }
  private tickOffer(dt: number) {
    const o = this.offer;
    if (!o) return;
    o.t -= dt;
    if (o.ai && o.t < FIGHT.offerSeconds - 0.6) { this.startFight(o.by, o.on); return; }
    if (o.t <= 0) this.offer = null;
  }
  private startFight(by: number, on: number) {
    this.offer = null; this.fightsUsed++;
    const a = this.skaters[by], b = this.skaters[on];
    let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const mx = clamp((a.x + b.x) / 2, -GX + 3, GX - 3), mz = clamp((a.z + b.z) / 2, -RINK.halfWidth + 3, RINK.halfWidth - 3);
    a.x = mx - dx * 0.8; a.z = mz - dz * 0.8; b.x = mx + dx * 0.8; b.z = mz + dz * 0.8;
    a.face = Math.atan2(dz, dx); b.face = Math.atan2(-dz, -dx);
    for (const s of this.skaters) { s.vx = s.vz = 0; s.stun = 0; s.lunge = 0; s.skillT = 0; }
    if (this.puck.owner >= 0) this.release(this.skaters[this.puck.owner]);
    Object.assign(this.puck, { x: mx - dz * 3, z: mz + dx * 3, vx: 0, vz: 0, y: 0, passTo: -1, shot: false });   // out of the way
    this.charge = [-1, -1]; this.passCharge = [-1, -1]; this.queued = [-1, -1];
    const fighter = (id: number): Fighter => ({ id, hp: FIGHT.hp, st: 1, act: 0, T: 1, left: 0, hand: 0, cd: 0, mag: 0, ai: 0, ctr: 0 });
    this.fight = { f: [fighter(by), fighter(on)], t: FIGHT.seconds, over: 0 };
    this.phase = 'fight';
    this.emit({ t: 'fightStart', a: by, b: on });
  }
  private setAct(f: Fighter, act: FightAct, T: number) { f.act = act; f.T = T; f.left = T; }
  private land(k: number) {
    const fg = this.fight!, me = fg.f[k], o = fg.f[1 - k];
    if (o.act === 4) { this.setAct(me, 2, FIGHT.whiff); o.ctr = FIGHT.counterWindow; this.emit({ t: 'fightMiss', by: me.id }); return; }   // dodged: my opening, his counter
    this.setAct(me, 2, FIGHT.recover);
    if (o.act === 3) {
      o.hp -= FIGHT.guardChip; o.st = Math.max(0, o.st - FIGHT.guardDrain);
      if (o.st <= 0) this.setAct(o, 5, FIGHT.guardBreak);            // guard broken
      else this.setAct(me, 5, FIGHT.blocked);                          // bounced off the guard: open for a moment
      this.freeze = Math.max(this.freeze, IMPACT.block);
      this.emit({ t: 'fightBlock', on: o.id });
    } else {
      const power = 0.75 + 0.5 * this.skaters[me.id].checkPower, counter = me.ctr > 0 ? FIGHT.counter : 1;
      me.ctr = 0;
      o.hp -= FIGHT.punch * power * (0.55 + 0.45 * me.st) * counter;
      this.setAct(o, 5, FIGHT.stagger);
      this.freeze = Math.max(this.freeze, IMPACT.punch);
      this.emit({ t: 'fightHit', by: me.id, on: o.id });
    }
    o.hp = Math.max(0, o.hp);
  }
  private endFight(winnerK: number, ko: boolean) {
    const fg = this.fight!;
    fg.over = FIGHT.overSeconds;
    const team = winnerK < 0 ? -1 : this.skaters[fg.f[winnerK].id].team;
    if (team >= 0) this.morale[team as Team] = FIGHT.moraleSeconds;
    if (winnerK >= 0 && ko) {
      const l = fg.f[1 - winnerK], down = this.skaters[l.id], w = this.skaters[fg.f[winnerK].id];
      const d = Math.hypot(down.x - w.x, down.z - w.z) || 1;
      this.setAct(l, 6, FIGHT.overSeconds); down.stun = FIGHT.overSeconds;
      down.vx = (down.x - w.x) / d * 4; down.vz = (down.z - w.z) / d * 4;   // the loser slides away on his back
      this.freeze = Math.max(this.freeze, IMPACT.ko);
    }
    this.emit({ t: 'fightEnd', winner: team as Team | -1, by: winnerK < 0 ? -1 : fg.f[winnerK].id, ko });
  }
  private aiFight(f: Fighter, o: Fighter, dt: number) {
    f.ai -= dt;
    const free = f.act === 0 || f.act === 3;
    if (!free) return { punch: false, guard: false, dodge: false };
    if (o.act === 1 && f.ai <= 0) {                                  // reads some wind-ups
      f.ai = 0.35;
      const r = this.rand();
      if (r < 0.25 && f.st >= FIGHT.dodgeCost && f.cd <= 0) return { punch: false, guard: false, dodge: true };
      if (r < 0.55) return { punch: false, guard: true, dodge: false };
    }
    // an opening (he whiffed, bounced off my guard or is staggered): punish it
    if ((o.act === 2 && o.T >= FIGHT.whiff) || o.act === 5) { if (f.st >= FIGHT.punchCost && this.rand() < 0.08) return { punch: true, guard: false, dodge: false }; }
    if (f.act === 3 && o.act !== 1) return { punch: false, guard: false, dodge: false };
    if (f.ai <= 0 && f.st > 0.35) { f.ai = 0.75 + this.rand() * 0.7; return { punch: true, guard: false, dodge: false }; }
    return { punch: false, guard: f.act === 3, dodge: false };
  }
  private stepFight(dt: number, inputs: [InputFrame | null, InputFrame | null]) {
    const fg = this.fight!;
    if (fg.over > 0) {
      this.consumeEdges(inputs);
      fg.over -= dt;
      for (const f of fg.f) { const s = this.skaters[f.id]; if (s.stun > 0) { const face = s.face; this.steer(s, 0, 0, dt); this.moveSkater(s, dt); s.face = face; } }
      for (const s of this.skaters) s.stun = Math.max(0, s.stun - dt);
      if (fg.over <= 0) { this.fight = null; this.faceoff(); }
      return;
    }
    fg.t -= dt;
    for (let k = 0; k < 2; k++) {
      const f = fg.f[k], o = fg.f[1 - k], sk = this.skaters[f.id], t = sk.team;
      f.cd = Math.max(0, f.cd - dt); f.ctr = Math.max(0, f.ctr - dt);
      f.st = Math.min(1, f.st + (f.act === 3 ? FIGHT.guardRegen : FIGHT.regen) * dt);
      if (f.act !== 0 && f.act !== 3) {
        f.left -= dt;
        if (f.left <= 0) { if (f.act === 1) this.land(k); else this.setAct(f, 0, 1); }
      }
      const inp = this.human[t] ? inputs[t] : null;
      let cmd: { punch: boolean; guard: boolean; dodge: boolean };
      if (inp) {
        const e = this.edges(t, inp), mag = Math.hypot(inp.mx, inp.mz);
        cmd = { punch: e.press, guard: inp.passHeld, dodge: mag > 0.5 && f.mag <= 0.3 };
        f.mag = mag;
      } else cmd = this.aiFight(f, o, dt);
      if (f.act === 0 || f.act === 3) {
        if (cmd.punch && f.st >= FIGHT.punchCost) { f.st -= FIGHT.punchCost; f.hand = 1 - f.hand; this.setAct(f, 1, FIGHT.windup); }
        else if (cmd.dodge && f.cd <= 0 && f.st >= FIGHT.dodgeCost) { f.st -= FIGHT.dodgeCost; f.cd = FIGHT.dodgeCooldown; this.setAct(f, 4, FIGHT.dodge); }
        else if (cmd.guard && f.st > 0.02) { if (f.act !== 3) this.setAct(f, 3, 1); }
        else if (f.act === 3) this.setAct(f, 0, 1);
      }
    }
    const [a, b] = fg.f;
    if (a.hp <= 0 || b.hp <= 0) this.endFight(a.hp > b.hp ? 0 : b.hp > a.hp ? 1 : -1, true);
    else if (fg.t <= 0) this.endFight(a.hp > b.hp ? 0 : b.hp > a.hp ? 1 : -1, false);
  }
  /** the state the screens draw; null outside a fight */
  fightView(): FightView | null {
    const fg = this.fight;
    if (!fg) return null;
    const [a, b] = fg.f, p = (f: Fighter) => 1 - Math.max(0, f.left) / f.T;
    return { a: a.id, b: b.id, hp: [a.hp, b.hp], st: [a.st, b.st], act: [a.act, b.act], hand: [a.hand, b.hand], p: [p(a), p(b)], t: Math.max(0, fg.t), over: fg.over > 0 };
  }

  // ------------------------------------------------------------------ player control
  private edges(t: Team, f: InputFrame | null) {
    const prev = this.prev[t];
    const e = { pass: false, press: false, release: false, fight: false, skill: false };
    if (f && prev) { e.pass = f.passSeq > prev.passSeq; e.press = f.shootSeq > prev.shootSeq; e.release = f.releaseSeq > prev.releaseSeq; e.fight = f.fightSeq > prev.fightSeq; e.skill = f.skillSeq > prev.skillSeq; }
    if (f) this.prev[t] = { ...f };
    return e;
  }
  private consumeEdges(inputs: [InputFrame | null, InputFrame | null]) { this.edges(0, inputs[0]); this.edges(1, inputs[1]); }

  private humanControl(t: Team, f: InputFrame | null, dt: number) {
    const s = this.skaters[this.controlled[t]], e = this.edges(t, f);
    if (e.fight && this.offer && this.skaters[this.offer.by].team === t) { this.startFight(this.offer.by, this.offer.on); return; }
    if (!f) { this.steer(s, 0, 0, dt); return; }
    const has = this.puck.owner === s.id;
    const mag = Math.min(1, Math.hypot(f.mx, f.mz));
    if (this.puck.passTo === s.id && this.puck.owner < 0) {
      // receiving: the skater goes to meet the pass; the stick only bends the run, as in FC
      const m = this.meetPoint(s), dx = m.x - s.x, dz = m.z - s.z, d = Math.hypot(dx, dz);
      const k = Math.min(1, d / 2), ax = d > 0.3 ? dx / d * k : 0, az = d > 0.3 ? dz / d * k : 0, own = PASS_ASSIST.stickShare;
      this.steer(s, ax * (1 - own * mag) + f.mx * own, az * (1 - own * mag) + f.mz * own, dt, f.sprint || d > 4);
    } else this.steer(s, f.mx, f.mz, dt, f.sprint);
    if (e.skill) {
      const dx = mag > 0.3 ? f.mx / mag : Math.cos(s.face), dz = mag > 0.3 ? f.mz / mag : Math.sin(s.face);
      if (this.useSkill(s, dx, dz, mag > 0.3 ? f.mz : null) && has && this.puck.owner !== s.id) { this.charge[t] = this.passCharge[t] = this.queued[t] = -1; return; }   // the skill sent the puck away
    }
    // shootout: nobody to pass to, so the pass keys are the moves. S fakes a shot, W (five-hole) and A (lifted)
    // charge while held and shoot on release like D
    const so = this.phase === 'shootout';
    if (e.pass && so && has && f.passKind === 'short') { this.fake(s, mag > 0.3 ? f.mz : 0); return; }
    if (e.pass) {
      if (has) { this.passCharge[t] = 0; this.passKindQ[t] = f.passKind; }    // charge while held
      else if (f.passKind === 'short') {
        // without the puck S = switch to the teammate nearest the puck
        const n = this.nearest(this.teamSkaters(t).filter(o => o !== s), this.puck.x, this.puck.z);
        if (n) this.controlled[t] = n.id;
      }
    }
    if (this.passCharge[t] >= 0) {
      if (!has) this.passCharge[t] = -1;
      else if (f.passHeld) this.passCharge[t] = Math.min(1, this.passCharge[t] + dt / 0.7);
      else {
        // released: pass assist picks the teammate in the stick direction (or facing) at that power
        const power = 0.15 + 0.85 * this.passCharge[t], kind = this.passKindQ[t], held = this.passCharge[t];
        this.passCharge[t] = -1;
        if (so) { this.shoot(s, held, mag > 0.3 ? f.mz : null, kind === 'lift' ? 'lift' : 'fivehole'); this.charge[t] = -1; return; }
        const hasDir = mag > 0.3;
        const dx = hasDir ? f.mx / mag : Math.cos(s.face), dz = hasDir ? f.mz / mag : Math.sin(s.face);
        const best = this.passTarget(s, dx, dz, kind, hasDir, power, true);
        if (best) { this.pass(s, best, kind, power); this.controlled[t] = best.id; }
        else this.passDir(s, dx, dz, power);
        this.charge[t] = -1;
        return;
      }
    }
    // D without the puck: a pass on its way to me books a shot, otherwise it is a body check. While the pass travels
    // the gauge fills (D held) and the shot goes off the moment the puck arrives, held or not.
    const incoming = this.puck.owner < 0 && this.puck.passTo === s.id;
    if (e.press && !has) { if (incoming) this.queued[t] = 0; else this.check(s); }
    else if (incoming && f.shootHeld && this.queued[t] < 0) this.queued[t] = 0;   // D was already down when the pass left
    if (this.queued[t] >= 0) {
      if (has) {
        this.shoot(s, this.queued[t], mag > 0.3 ? f.mz : null);
        this.queued[t] = -1; this.charge[t] = -1;
      } else if (!incoming) this.queued[t] = -1;                       // picked off / missed it
      else if (f.shootHeld) this.queued[t] = Math.min(1, this.queued[t] + dt / 0.85);
    }
    const holding = this.puck.owner === s.id;
    if (holding && f.shootHeld && this.passCharge[t] < 0) this.charge[t] = Math.min(1, (this.charge[t] < 0 ? 0 : this.charge[t]) + dt / 0.85);
    if (holding && e.release && this.charge[t] >= 0) { this.shoot(s, this.charge[t], mag > 0.3 ? f.mz : null); this.charge[t] = -1; }
    if (this.puck.owner !== s.id) this.charge[t] = this.queued[t];
  }

  /** the player always plays the puck carrier; when the other team gets the puck, take the closest skater */
  private autoSwitch() {
    const c = this.carrier;
    if (c && !c.goalie && this.human[c.team]) this.controlled[c.team] = c.id;
    const t = c ? c.team : -1;
    if (t !== this.lastOwnerTeam && t !== -1) {
      const other = (1 - t) as Team;
      if (this.human[other]) { const n = this.nearest(this.teamSkaters(other), this.puck.x, this.puck.z); if (n) this.controlled[other] = n.id; }
    }
    this.lastOwnerTeam = t;
  }

  // ------------------------------------------------------------------ AI
  private openness(m: Skater) { let v = 9; for (const o of this.skaters) if (o.team !== m.team && !o.goalie) v = Math.min(v, Math.hypot(o.x - m.x, o.z - m.z)); return v; }
  private laneClear(ax: number, az: number, bx: number, bz: number, team: Team) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    for (const o of this.skaters) {
      if (o.team === team || o.goalie) continue;
      const t = clamp(((o.x - ax) * dx + (o.z - az) * dz) / l2, 0, 1);
      if (Math.hypot(ax + dx * t - o.x, az + dz * t - o.z) < 1.0) return false;
    }
    return true;
  }
  private aiThink(s: Skater) {
    const team = s.team, dir = this.attack[team], goalX = dir * GX, own = this.carrier, p = this.puck, tc = TACTICS[this.tactic[team]];
    const mates = this.teamSkaters(team).filter(o => o !== s);
    const free = (list: Skater[]) => list.filter(o => !this.isControlled(o));
    if (s.skillCd <= 0 && this.aiSkill(s) && own === s && p.owner !== s.id) return;
    if (p.passTo === s.id && p.owner < 0) {             // pass on its way to me: meet it
      const m = this.meetPoint(s); s.tx = m.x; s.tz = m.z; s.sprint = Math.hypot(m.x - s.x, m.z - s.z) > 4; return;
    }
    if (own === s) {
      const dGoal = Math.hypot(goalX - s.x, s.z);
      const pressure = this.skaters.some(o => o.team !== team && !o.goalie && Math.hypot(o.x - s.x, o.z - s.z) < 2.6);
      if (dGoal < tc.shootRange && Math.abs(s.z) < 9 && this.rand() < (dGoal < 9 ? tc.shootNear : tc.shootFar)) { this.shoot(s, 0.35 + this.rand() * 0.6, -s.z); return; }
      if (pressure && this.rand() < 0.55) {
        const open = mates.filter(m => this.laneClear(s.x, s.z, m.x, m.z, team)).sort((a, b) => this.openness(b) - this.openness(a))[0];
        if (open) { this.pass(s, open); return; }
      }
      s.tx = goalX - dir * 7; s.tz = clamp(s.z * 0.6, -4, 4); s.sprint = Math.abs(s.x - s.tx) > 10; return;
    }
    if (!own) {
      const chaser = this.nearest(free(this.teamSkaters(team)), p.x + p.vx * 0.25, p.z + p.vz * 0.25);
      if (chaser === s) { s.tx = p.x + p.vx * 0.25; s.tz = p.z + p.vz * 0.25; s.sprint = true; return; }
    }
    if (own && own.team === team) {
      const others = this.teamSkaters(team).filter(o => o !== own);
      const i = others.indexOf(s);
      if (i === 0) { s.tx = clamp(own.x + dir * tc.lead, -GX + 4, GX - 4); s.tz = own.z > 0 ? -5 : 5; }
      else { s.tx = clamp(own.x - dir * tc.trail, -GX + 4, GX - 4); s.tz = own.z > 0 ? 2 : -2; }
      if (!tc.sitBack && dir * own.x > BLUE_X && dir * s.tx < BLUE_X) s.tx = dir * (BLUE_X + 1.5);
      s.sprint = false; return;
    }
    // defence: one presses the carrier, the others mark goal-side
    const target = own ?? p;
    const presser = this.nearest(free(this.teamSkaters(team)), target.x, target.z);
    if (presser === s) {
      if (tc.sitBack && dir * target.x > 2) { s.tx = -dir * BLUE_X; s.tz = clamp(target.z * 0.5, -6, 6); s.sprint = false; return; }   // no forecheck: wait at my blue line
      // stand off just outside body contact (0.84 m): pressed against him, separate() stopped every lunge dead before it
      // landed and the check bounced off (most corner and behind-the-net checks did)
      s.tx = target.x - dir * PRESS_GAP; s.tz = target.z; s.sprint = true;
      // behind a goal line there is no goal side (it is the net): come along the end boards from my side instead
      if (Math.abs(target.x) > RINK.goalX - 0.2) { s.tx = target.x; s.tz = target.z + (s.z >= target.z ? PRESS_GAP : -PRESS_GAP); }
      // in a corner the goal-side spot is behind the rounded boards: the boards pushed me onto him and every lunge
      // started in contact. Wait on the open-ice side of him instead (towards the corner's centre)
      const ex = L - CR, ez = W - CR;
      if (Math.abs(s.tx) > ex && Math.abs(s.tz) > ez && Math.hypot(Math.abs(s.tx) - ex, Math.abs(s.tz) - ez) > CR - SKATE.radius - 0.1) {
        const cx = Math.sign(target.x) * ex, cz = Math.sign(target.z) * ez, d = Math.hypot(cx - target.x, cz - target.z) || 1;
        s.tx = target.x + (cx - target.x) / d * PRESS_GAP; s.tz = target.z + (cz - target.z) / d * PRESS_GAP;
      }
      if (own && Math.hypot(own.x - s.x, own.z - s.z) < 1.6 && this.rand() < tc.press) { s.face = Math.atan2(own.z - s.z, own.x - s.x); this.check(s); }   // lunge at him, not where I happened to face
      return;
    }
    const opp = this.teamSkaters((1 - team) as Team), others = opp.filter(o => o !== own);
    const markers = this.teamSkaters(team).filter(o => o !== presser);
    if (tc.cherry && markers.indexOf(s) === 1) { s.tx = dir * 3; s.tz = clamp(target.z * 0.4, -6, 6); s.sprint = false; return; }      // stays up for the breakaway, one fewer man back
    const mark = others[markers.indexOf(s) % Math.max(1, others.length)] ?? opp[0];
    // nobody to mark (a drill or stage with every opposing skater benched): guard my net instead of reading an empty list
    if (!mark) { s.tx = -dir * (GX - 4); s.tz = clamp(target.z * 0.3, -4, 4); s.sprint = false; return; }
    const ownGoalX = -dir * GX, mx = ownGoalX - mark.x, mz = -mark.z, ml = Math.hypot(mx, mz) || 1;
    s.tx = mark.x + mx / ml * tc.mark; s.tz = mark.z + mz / ml * tc.mark; s.sprint = false;
  }
  /**
   * A target behind a goal line (a carrier behind his net, a puck there) put the straight path, and often the goal-side
   * target itself, inside the net: the skater pinned himself to the net's front with the goalie and never got there.
   * Such a target is moved out of the net, and a skater in front of the net goes round its side first.
   */
  private netDetour(s: Skater) {
    const NW = RINK.goalHalfWidth + 0.55, D = RINK.netDepth;
    for (const side of [-1, 1]) {
      const gx = side * RINK.goalX, behind = side * s.tx > RINK.goalX - 0.3;
      if (!behind || side * s.x > RINK.goalX + D) continue;                // target not behind this net, or I am already there
      // the target itself never inside the frame
      if (side * s.tx < RINK.goalX + D + 0.5 && Math.abs(s.tz) < NW) s.tz = (s.tz >= 0 ? 1 : -1) * NW;
      // in front of the goal line and in line with the net: round the side the target (or I) is on
      if (side * s.x < RINK.goalX + 0.2 && Math.abs(s.z) < NW + 0.4) {
        const zs = Math.sign(s.tz || s.z || 1);
        s.tx = gx - side * 0.4; s.tz = zs * (NW + 1.1); s.sprint = true;
      }
    }
  }
  private aiMove(s: Skater, dt: number) {
    const dx = s.tx - s.x, dz = s.tz - s.z, d = Math.hypot(dx, dz);
    if (d < 0.4) this.steer(s, 0, 0, dt);
    else { const k = Math.min(1, d / 2.5); this.steer(s, dx / d * k, dz / d * k, dt, s.sprint); }
  }

  // ------------------------------------------------------------------ shootout
  // Tie after regulation: alternating 1-on-1 attempts (shooter vs goalie). The defending player controls
  // their goalie's slide (stick left/right) and dive (D). Best of 3, then sudden death, capped at 10 rounds.
  private parked(s: Skater) { return this.shootout !== null && s.id !== this.shootout.shooter && !s.goalie; }
  /** skaters taken out of play by a drill (tutorial): no collisions, no pick-ups; the scene does not draw them */
  readonly benched = new Set<number>();
  /** tied regulation goes here; a shootout stage starts with it */
  startShootout() {
    this.shootout = { round: 0, shooterTeam: 0, results: [[], []], attemptT: 0, pause: 1.6, shooter: -1, decided: false, fakes: 0, fakeCd: 0, plan: '' };
    this.phase = 'shootout';
    this.emit({ t: 'shootoutStart' });
    this.parkAll();
  }
  private parkAll() {
    for (const s of this.skaters) if (!s.goalie) { s.x = (s.slot - 1) * 2.2; s.z = (s.team === 0 ? -1 : 1) * (W - 1.2); s.vx = s.vz = 0; s.face = s.team === 0 ? Math.PI / 2 : -Math.PI / 2; }
    Object.assign(this.puck, { x: 0, z: 0, vx: 0, vz: 0, y: 0, owner: -1, dead: true, shot: false });
    this.netSide = 0;
  }
  private beginAttempt() {
    const so = this.shootout!;
    const t = so.shooterTeam, slot = so.results[t].length % SKATERS_PER_TEAM;
    const shooter = this.skaters.find(s => s.team === t && s.slot === slot)!;
    so.shooter = shooter.id; so.attemptT = MATCH.shootoutAttemptSeconds; so.fakes = 0; so.fakeCd = 0; so.plan = '';
    this.parkAll();
    const dir = this.attack[t];
    shooter.x = -dir * 3; shooter.z = 0; shooter.face = dir > 0 ? 0 : Math.PI;
    Object.assign(this.puck, { x: shooter.x + dir * 0.85, z: 0, vx: 0, vz: 0, y: 0, owner: shooter.id, last: shooter.id, dead: false, shot: false, passTo: -1 });
    this.controlled[t] = shooter.id;
    const gk = this.goalieOf((1 - t) as Team); gk.z = 0; gk.dive = 0; gk.hold = 0; gk.react = 0;
    this.emit({ t: 'shootoutAttempt', team: t, round: so.results[t].length + 1 });
  }
  /**
   * AI shooter: skates in weaving, and on the way picks one plan: a plain shot, a five-hole while the goalie slides,
   * or a fake first (then a lifted shot if the goalie went down, otherwise the far side).
   */
  private aiShooter(s: Skater, gk: Skater, dt: number) {
    const so = this.shootout!, t = s.team, gx = this.attack[t] * GX, d = Math.abs(gx - s.x), has = this.puck.owner === s.id;
    if (!so.plan) { const r = this.rand(); so.plan = r < 0.35 ? 'fake' : r < 0.55 ? 'fivehole' : 'normal'; }
    s.think -= dt;
    if (s.think <= 0) {
      s.think = 0.15;
      const close = d < 7 + this.rand() * 3;
      if (has && so.plan === 'fake' && d < 9) { this.fake(s, this.rand() < 0.5 ? -1 : 1); so.plan = 'lift'; s.think = 0.22; }
      else if (has && so.plan === 'lift' && so.fakeCd < SHOOTOUT.fakeCooldown - 0.15) this.shoot(s, 0.5, -Math.sign(gk.z || 1), gk.dive > 0 ? 'lift' : 'normal');
      else if (has && so.plan === 'fivehole' && close && Math.abs(this.gkSlide[(1 - t) as Team]) > SHOOTOUT.openSlide) this.shoot(s, 0.5, null, 'fivehole');
      else if (has && close && (so.plan === 'normal' || d < 5)) this.shoot(s, 0.4 + this.rand() * 0.5, this.rand() < 0.5 ? -1 : 1);
      else { s.tx = gx - this.attack[t] * 5; s.tz = (this.rand() - 0.5) * 6; s.sprint = false; }
    }
    this.aiMove(s, dt);
  }
  private shootoutResult(scored: boolean) {
    const so = this.shootout!;
    if (so.shooter < 0) return;
    so.results[so.shooterTeam].push(scored);
    this.emit({ t: 'shootoutResult', team: so.shooterTeam, scored });
    so.shooter = -1; this.puck.dead = true; this.puck.owner = -1;
    // decided?
    const [a, b] = so.results, ga = a.filter(Boolean).length, gb = b.filter(Boolean).length, R = this.soRounds;
    const leftA = Math.max(0, R - a.length), leftB = Math.max(0, R - b.length);
    let done = false;
    if (a.length <= R && b.length <= R) done = ga > gb + leftB || gb > ga + leftA;
    if (!done && a.length === b.length && a.length >= R) done = ga !== gb || a.length >= Math.max(6, R);   // capped: still tied after 6 rounds = draw
    if (done) { so.decided = true; this.end(); return; }
    so.shooterTeam = (1 - so.shooterTeam) as Team;
    so.pause = 1.4;
  }
  private stepShootout(dt: number, inputs: [InputFrame | null, InputFrame | null]) {
    const so = this.shootout!;
    if (so.shooter < 0) {
      this.consumeEdges(inputs);
      this.updatePuck(dt);                               // a scored puck finishes going into the net
      so.pause -= dt;
      if (so.pause <= 0) this.beginAttempt();
      return;
    }
    const t = so.shooterTeam, def = (1 - t) as Team, shooter = this.skaters[so.shooter], gk = this.goalieOf(def);
    so.attemptT -= dt; so.fakeCd = Math.max(0, so.fakeCd - dt);
    shooter.stun = Math.max(0, shooter.stun - dt); shooter.cool = Math.max(0, shooter.cool - dt);
    // shooter
    if (this.human[t]) this.humanControl(t, inputs[t], dt);
    else this.aiShooter(shooter, gk, dt);
    // goalie: player-controlled when that team has a player
    const f = this.human[def] ? inputs[def] : null, e = this.human[def] ? this.edges(def, f) : null;
    if (e?.press && gk.dive <= 0) gk.dive = SHOOTOUT.dive + SHOOTOUT.recover;
    // AI goalie guesses a dive once per shot, to the side the puck is heading (right about half the time); a goalie
    // still down from a dive (gk.dive covers the stretch and getting up) cannot go down again
    // A puck coming up high is read as a lift: he stays up for it (going down is what a lifted shot wants)
    if (!this.human[def] && this.puck.shot && gk.dive <= 0 && !gk.react) { gk.react = 1; if (this.rand() < (this.puck.vy > 2.5 ? 0.12 : 0.5)) this.goDown(gk, this.rand() < 0.6 ? Math.sign(this.puck.vz || 1) : -Math.sign(this.puck.vz || 1)); }
    this.updateGoalie(gk, dt, f);
    this.moveSkater(shooter, dt);
    this.updatePuck(dt);
    // attempt over: puck stopped, went behind the goal line wide, came back out, or time ran out
    const p = this.puck, dirX = this.attack[t];
    if (so.shooter >= 0) {
      const behind = p.x * dirX > GX + 0.2, stalled = p.owner < 0 && Math.hypot(p.vx, p.vz) < 0.8 && !p.shot, back = p.owner < 0 && p.vx * dirX < -2;
      if (so.attemptT <= 0 || behind || stalled || back) this.shootoutResult(false);
    }
  }
}
