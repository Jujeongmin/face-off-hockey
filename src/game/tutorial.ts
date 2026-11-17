// Tutorial: drills on the real rink with the real controls. Each drill sets the ice up (who stands where, who
// has the puck), watches the simulation for success and moves on. Nothing is faked in the sim itself: the
// drill only places skaters, parks the ones it does not need and keeps the clock from running out.
import { Match } from '../sim/match.ts';
import { STEP, RINK } from '../sim/constants.ts';
import type { MatchEvent, Skater, Team } from '../sim/types.ts';
import type { HockeyScene, ViewState } from '../render/scene.ts';
import type { Hud } from '../hud.ts';
import { SKILL_COMMAND, type KeyboardInput } from '../input.ts';
import type { Lineup } from './roster.ts';
import { keyCap } from './keys.ts';
import { skillCaps, skillName, skillText } from './skills.ts';
import type { Session } from './sessions.ts';
import { t, type Key } from '../i18n.ts';
import { placeSkater, givePuck, loosePuck } from './ice.ts';

const $ = (id: string) => document.getElementById(id)!;
const teamOfId = (id: number): Team => (id < 4 ? 0 : 1);

interface Drill {
  text: Key;
  keys: string[];                        // key caps shown under the text
  setup(d: Tutorial): void;
  /** true when the drill is done */
  tick(d: Tutorial, dt: number, events: MatchEvent[]): boolean;
  /** seconds the result stays on screen before the next drill */
  linger?: number;
  /** runs every step while the result is on screen */
  hold?(d: Tutorial): void;
  /** the drill's own banner stays up (a goal) instead of the "nice" one */
  quiet?: boolean;
  /** the controlled skater's skill command works in this drill (elsewhere two quick arrows must not fire a dash) */
  skill?: boolean;
  /** text and key caps that depend on who is playing */
  say?(d: Tutorial): { text: string; caps: string };
}

/** step state shared by the drills */
interface Scratch { i: number; held: number; timer: number; mate: number; opp: number; start: number }

export class Tutorial implements Session {
  readonly match: Match;
  private acc = 0;
  private step = -1;
  private ended = false;
  private doneTimer = 0;
  private fail = 0;                      // seconds until a missed drill is set up again
  s: Scratch = { i: 0, held: 0, timer: 0, mate: 1, opp: 4, start: 0 };
  private linger = 0;                    // seconds left of showing the drill's result
  private focus = { x: 0, z: 0 };
  /** ids that the drill places itself; everyone else is parked out of play */
  active = new Set<number>();

  constructor(readonly scene: HockeyScene, readonly hud: Hud, private input: KeyboardInput, private onEnd: () => void, lineups: [Lineup, Lineup]) {
    this.match = new Match({ seed: 7, human: [true, false], lineups });
    while (this.match.phase !== 'play') this.match.step(STEP, [null, null]);
    scene.setLineups(lineups); scene.setSide(0); hud.me = 0;
    $('drill').classList.remove('hidden');
    $('hint').classList.add('hidden');
    this.next();
  }

  get me(): Skater { return this.match.skaters[this.match.controlled[0]]; }
  sk(id: number) { return this.match.skaters[id]; }
  place(id: number, x: number, z: number, face = 0) { placeSkater(this.match, id, x, z, face); this.active.add(id); }
  give(id: number) { givePuck(this.match, id); }
  loosePuck(x: number, z: number) { loosePuck(this.match, x, z); }

  private next() {
    this.step++;
    if (this.step >= DRILLS.length) return this.finish();
    this.scene.setDrillTarget(null);
    this.setupCurrent();
    this.render();
  }
  private setupCurrent() {
    const m = this.match;
    m.phase = 'play'; m.charge = [-1, -1]; m.passCharge = [-1, -1]; m.queued = [-1, -1];
    this.active.clear();
    this.s = { i: 0, held: 0, timer: 0, mate: 1, opp: 4, start: performance.now() };
    m.controlled[0] = 0;
    DRILLS[this.step].setup(this);
    this.park();
  }
  /** everyone the drill did not place is benched: out of play and not drawn (they used to stand knocked over along the
   *  boards in every drill); goalies stay in their nets unless placed */
  private park() {
    this.match.benched.clear();
    for (const s of this.match.skaters) {
      if (this.active.has(s.id) || s.goalie) continue;
      this.match.benched.add(s.id);
      Object.assign(s, { x: -22 + s.id * 1.4, z: RINK.halfWidth - 1.2, vx: 0, vz: 0, stun: 0.5 });
    }
  }
  private render() {
    const d = DRILLS[this.step];
    $('drStep').textContent = `${this.step + 1} / ${DRILLS.length}`;
    const said = d.say?.(this);
    $('drText').textContent = said ? said.text : t(d.text);
    $('drKeys').innerHTML = said ? said.caps : d.keys.map(keyCap).join('');
    $('drProg').innerHTML = DRILLS.map((_, i) => `<i class="${i < this.step ? 'ok' : i === this.step ? 'on' : ''}"></i>`).join('');
  }
  private finish() {
    this.ended = true;
    this.input.skill = 'none'; this.hud.skill(-1, 0, 0);
    this.scene.setDrillTarget(null);
    $('drill').classList.add('hidden');
    this.hud.lowerThird(t('tutDone'), t('tutDoneSub'), 0, 3);
    try { localStorage.setItem('faceoff:tutorial', '1'); } catch { /* */ }
    this.doneTimer = window.setTimeout(() => this.onEnd(), 3000);
  }
  /** the Skip button: the tutorial counts as seen and ends now */
  skip() {
    if (this.ended) return;
    this.ended = true;
    this.input.skill = 'none'; this.hud.skill(-1, 0, 0);
    this.scene.setDrillTarget(null);
    $('drill').classList.add('hidden');
    try { localStorage.setItem('faceoff:tutorial', '1'); } catch { /* */ }
    this.onEnd();
  }
  /** a missed attempt: say so and set the same drill up again */
  miss(msg: Key) {
    if (this.fail > 0) return;
    this.hud.lowerThird(t(msg), t('tutAgain'), 1, 1.8);
    this.fail = 1.6;
  }

  frame(dt: number, time: number) {
    const m = this.match;
    this.acc += dt;
    const events: MatchEvent[] = [];
    while (this.acc >= STEP) {
      const skillOn = !this.ended && !!DRILLS[this.step]?.skill;
      this.input.skill = skillOn ? this.me.skill : 'none';
      this.hud.skill(skillOn ? this.me.id : -1, this.me.skillCd, this.me.skillT);
      const f = this.input.read((x, y) => this.scene.screenToWorld(x, y));
      m.step(STEP, [f, null]);
      this.acc -= STEP;
      m.clock = 999;                                           // the drills have no clock
      for (const s of m.skaters) if (!this.active.has(s.id) && !s.goalie) { s.vx = s.vz = 0; s.stun = Math.max(s.stun, 0.2); }
      events.push(...m.events);
      for (const e of m.events) { this.scene.onEvent(e); this.scene.shake = Math.max(this.scene.shake, this.hud.onEvent(e, teamOfId)); }
      m.events.length = 0;
      if (this.ended || this.step < 0) continue;
      if (this.fail > 0) { this.fail -= STEP; if (this.fail <= 0) { this.fail = 0; this.setupCurrent(); } continue; }
      if (this.linger > 0) {
        DRILLS[this.step].hold?.(this);
        this.linger -= STEP;
        if (this.linger <= 0) this.next();
        events.length = 0;
        continue;
      }
      const drill = DRILLS[this.step];
      if (drill.tick(this, STEP, events)) {
        if (!drill.quiet) this.hud.lowerThird(t('tutNice'), '', 0, 1.2);
        if (drill.linger) this.linger = drill.linger; else this.next();
      }
      events.length = 0;
    }
    if (m.phase === 'goal' && this.linger <= 0) { m.phase = 'play'; m.puck.dead = false; }   // the drills reset the ice themselves
    // the camera follows the puck, unless my skater is far from it (skating drills with the puck parked): then him
    const me = m.skaters[m.controlled[0]], far = !!me && Math.hypot(me.x - m.puck.x, me.z - m.puck.z) > 10;
    if (far) { this.focus.x = me.x; this.focus.z = me.z; }
    const v: ViewState = { skaters: m.skaters, puck: m.puck, controlled: m.controlled[0], charge: m.charge[0], focus: far ? this.focus : undefined, hide: m.benched };
    this.scene.update(v, dt, time);
    this.hud.update(m.score, 0, m.charge[0] >= 0 ? m.charge[0] : m.passCharge[0], false, m.charge[0] < 0 && m.passCharge[0] >= 0, 1);
  }
  dispose() {
    clearTimeout(this.doneTimer);
    this.input.skill = 'none'; this.hud.skill(-1, 0, 0);
    this.scene.setDrillTarget(null);
    $('drill').classList.add('hidden');
    $('hint').classList.remove('hidden');
  }
}

const near = (s: Skater, x: number, z: number, r: number) => Math.hypot(s.x - x, s.z - z) < r;
/** the shooting drill has the net to itself */
function emptyNet(d: Tutorial) { const gk = d.match.goalieOf(1); gk.x = RINK.goalX - 2; gk.z = RINK.halfWidth - 2; }
/** the skill drill sets the ice up for whatever the first skater's skill needs, so its effect can be seen */
function placeForSkill(d: Tutorial) {
  const me = d.sk(0), k = me.skill;
  if (k === 'snipe') d.place(0, 12, 2);
  else if (k === 'laser') { d.place(0, -10, -2); d.place(1, 2, 5, Math.PI); }
  else if (k === 'charge') { d.place(0, -4, 0); d.place(4, 0, 0, Math.PI); }
  else if (k === 'sweep') { d.place(0, -4, 0); d.place(4, -1.8, 0, Math.PI); }
  else d.place(0, -14, 0);
  me.skillCd = me.skillT = 0;
}

const DRILLS: Drill[] = [
  { // 1. skate to three rings
    text: 'tut1', keys: ['←', '↑', '↓', '→'],
    setup(d) { d.place(0, -14, 0); d.loosePuck(0, RINK.halfWidth - 2); d.scene.setDrillTarget(RINGS[0]); },
    tick(d) {
      const r = RINGS[d.s.i];
      if (near(d.me, r.x, r.z, 1.6)) { d.s.i++; d.scene.setDrillTarget(RINGS[d.s.i] ?? null); }
      return d.s.i >= RINGS.length;
    },
  },
  { // 2. sprint: hold E until top speed
    text: 'tut2', keys: ['E', '+', '→'],
    setup(d) { d.place(0, -20, -3); },
    tick(d, dt) {
      const sp = Math.hypot(d.me.vx, d.me.vz);
      d.s.held = sp > 8.4 ? d.s.held + dt : 0;
      if (d.me.x > 18) { d.me.x = -20; }
      return d.s.held > 0.35;
    },
  },
  { // 3. pass: hold S, release towards the teammate
    text: 'tut3', keys: ['S', t('tutHold')],
    setup(d) { d.place(0, -10, -2); d.place(1, 0, 5, Math.PI); d.give(0); },
    tick(d) {
      if (d.match.puck.passTo !== 1 && d.match.puck.owner !== 1) d.place(1, 0, 5, Math.PI);   // wait for the pass in place
      if (d.match.puck.owner === 1) return true;
      if (d.match.puck.owner < 0 && d.match.puck.passTo < 0 && Math.hypot(d.match.puck.vx, d.match.puck.vz) < 0.5) d.miss('tutMissPass');
      return false;
    },
    linger: 0.8,
  },
  { // 4. switch player without the puck
    text: 'tut4', keys: ['S'],
    setup(d) { d.place(0, -16, -6); d.place(1, -2, 4); d.loosePuck(0, 5.5); },
    tick(d) {
      if (d.match.controlled[0] !== 1) d.place(1, -2, 4);
      return d.match.controlled[0] === 1;
    },
    linger: 1.2,                         // long enough to see the marker move to the other skater
  },
  { // 5. shoot: hold D, release (empty net)
    text: 'tut5', keys: ['D', t('tutHold')],
    setup(d) { d.place(0, 12, 2); d.give(0); },
    tick(d, _dt, ev) {
      emptyNet(d);
      if (ev.some(e => e.t === 'goal' && e.team === 0)) return true;
      if (d.match.puck.owner < 0 && Math.hypot(d.match.puck.vx, d.match.puck.vz) < 0.4 && performance.now() - d.s.start > 1500) d.miss('tutMissShot');
      return false;
    },
    linger: 1.9, quiet: true, hold: emptyNet,   // the puck goes all the way in and GOAL! stays up
  },
  { // 6. body check: meet the carrier head-on
    text: 'tut7', keys: ['D', t('tutNoPuck')],
    setup(d) { d.place(0, -6, 0, 0); d.place(4, 10, 0.4, Math.PI); d.give(4); },
    tick(d, _dt, ev) {
      const o = d.sk(4), m = d.match;
      if (m.puck.owner === 4) { o.vx = -4.2; o.vz = 0; o.face = Math.PI; }                // the carrier skates at you
      if (ev.some(e => e.t === 'check' && e.by === 0)) return true;
      if (o.x < -16 || ev.some(e => e.t === 'bump' && e.by === 0)) d.miss('tutMissCheck');
      return false;
    },
  },
  { // 7. the first skater's own skill, by its key command: whichever player leads the lineup
    text: 'tutSkill', keys: [], skill: true,
    say(d) {
      const k = d.sk(0).skill;
      const same = k !== 'none' && SKILL_COMMAND[k].includes('same') ? ` ${t('tutSame')}` : '';
      return { text: `${skillName(k)}: ${skillText(k)} ${t('tutSkill')}${same}`, caps: skillCaps(k) };
    },
    setup(d) {
      placeForSkill(d);
      const k = d.sk(0).skill;
      if (k === 'snipe' || k === 'laser') d.give(0); else d.loosePuck(14, -9);
    },
    tick(d, _dt, ev) {
      const k = d.sk(0).skill;
      if (k === 'none') return true;
      if (ev.some(e => e.t === 'skill' && e.by === 0)) return true;
      if (k === 'snipe') emptyNet(d);
      if (k === 'laser') d.place(1, 2, 5, Math.PI);                    // waits for the pass in place
      if (k === 'charge' || k === 'sweep') d.place(4, k === 'charge' ? 0 : d.sk(0).x + 2.2, d.sk(0).z, Math.PI);   // stands still to be hit
      return false;
    },
    linger: 1.9,                         // long enough to see what the skill did
    hold(d) { if (d.sk(0).skill === 'snipe') emptyNet(d); },
  },
];
const RINGS = [{ x: -4, z: -6 }, { x: 6, z: 5 }, { x: 14, z: -3 }];

