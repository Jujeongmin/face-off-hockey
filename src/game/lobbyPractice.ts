// Lobby practice: while the menus are up, my first skater is on the ice in the attacking zone with the puck and
// the other team's goalie in net. Arrows / E / D work as in a match; the puck comes back after a goal, a save or
// when it dies. Everyone else stands at the far end, out of the camera's view. The practice attacks the LEFT net
// so the play stays clear of the menu tiles on the right (the camera is the match camera, side-on).
import { Match } from '../sim/match.ts';
import { STEP, RINK } from '../sim/constants.ts';
import type { MatchEvent, Team } from '../sim/types.ts';
import type { HockeyScene, ViewState } from '../render/scene.ts';
import type { Hud } from '../hud.ts';
import type { KeyboardInput } from '../input.ts';
import type { Lineup } from './roster.ts';

const teamOfId = (id: number): Team => (id < 4 ? 0 : 1);
const ME = 0;

export class LobbyPractice {
  readonly match: Match;
  goals = 0;
  saves = 0;
  private acc = 0;
  private respawn = 0;
  private idle = 0;                  // seconds the puck has been loose and slow
  private view: ViewState;
  onScore?: (goals: number, saves: number) => void;

  constructor(private scene: HockeyScene, private hud: Hud, private input: KeyboardInput, readonly lineups: [Lineup, Lineup]) {
    this.match = new Match({ seed: 3, human: [true, false], lineups });
    while (this.match.phase !== 'play') this.match.step(STEP, [null, null]);
    this.match.attack = [-1, 1];          // I shoot at the left net, their goalie defends it
    this.view = { skaters: this.match.skaters, puck: this.match.puck, controlled: ME, charge: -1,
      hide: new Set(this.match.skaters.filter(s => s.id !== ME && !(s.goalie && s.team === 1)).map(s => s.id)) };
    scene.setLineups(lineups);
    this.reset();
  }

  /** puck on my stick in the slot area, everyone else parked at the far end */
  reset() {
    const m = this.match;
    m.phase = 'play'; m.charge = [-1, -1]; m.passCharge = [-1, -1]; m.queued = [-1, -1]; m.controlled[0] = ME;
    for (const s of m.skaters) {
      if (s.id === ME || (s.goalie && s.team === 1)) continue;
      Object.assign(s, { x: RINK.halfLength - 3 - (s.id % 4) * 1.5, z: -RINK.halfWidth + 2 + (s.id >> 2) * 1.5, vx: 0, vz: 0 });
    }
    const me = m.skaters[ME];
    Object.assign(me, { x: -RINK.goalX + 10 - Math.random() * 2.5, z: (Math.random() - 0.5) * 7, vx: 0, vz: 0, face: Math.PI, stun: 0, cool: 0, lunge: 0 });
    Object.assign(m.puck, { owner: ME, last: ME, passTo: -1, shot: false, dead: false, vx: 0, vz: 0, y: 0, blend: 0 });
    m.puck.x = me.x - 0.85; m.puck.z = me.z;
    const gk = m.goalieOf(1); gk.hold = 0; gk.dive = 0;
    this.respawn = 0; this.idle = 0;
  }

  frame(dt: number, time: number) {
    const m = this.match;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      const f = this.input.read((x, y) => this.scene.screenToWorld(x, y));
      m.step(STEP, [f, null]);
      this.acc -= STEP;
      m.clock = 999;
      for (const s of m.skaters) if (s.id !== ME && !(s.goalie && s.team === 1)) { s.vx = s.vz = 0; }
      this.handle(m.events);
      m.events.length = 0;
      if (this.respawn > 0) { this.respawn -= STEP; if (this.respawn <= 0) this.reset(); continue; }
      const p = m.puck, sp = Math.hypot(p.vx, p.vz);
      this.idle = p.owner < 0 && sp < 1 ? this.idle + STEP : 0;
      const gk = m.goalieOf(1);
      if (this.idle > 1.2 || p.owner === gk.id || p.x > 2 || m.phase === 'goal') this.respawn = 0.9;
    }
    if (m.phase === 'goal') m.phase = 'play';
    this.view.charge = m.charge[0] >= 0 ? m.charge[0] : m.passCharge[0];
    this.scene.update(this.view, dt, time);
  }

  private handle(events: MatchEvent[]) {
    for (const e of events) {
      this.scene.onEvent(e);
      if (e.t === 'goal') { this.goals++; this.onScore?.(this.goals, this.saves); this.scene.shake = 0.3; this.respawn = 1.2; }
      else if (e.t === 'save') { this.saves++; this.onScore?.(this.goals, this.saves); }
      else this.hud.onEvent(e, teamOfId);         // sounds for shots, posts, boards
    }
  }
}
