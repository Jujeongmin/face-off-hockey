// One stage on the real simulation, without DOM or rendering (StageSession draws it; tests run it headless).
// A scenario sets the score, clock, skater counts and the puck, then watches the sim's events until the stage's goal is
// met or missed. Boss stages are a normal three-period match; shootout stages start straight in the shootout.
//
// Star counting uses goals scored DURING the stage (a stage that starts 2-0 and ends 3-1 counts 1 for, 1 against).
// One-timer: a goal by the skater whose last shot came within 1.2 s of a teammate's pass. Skill goal: a goal by my
// team within 3 s of one of my skaters' skills.
import { Match } from '../sim/match.ts';
import { STEP } from '../sim/constants.ts';
import type { InputFrame, MatchEvent } from '../sim/types.ts';
import type { Lineup } from './roster.ts';
import { foeFor, foeLevels, type Outcome, type Stage } from './stages.ts';
import { givePuck, placeSkater } from './ice.ts';

const BENCH_MINE = [2, 1], BENCH_THEIRS = [6, 5];   // the last skater slots sit out first; goalies (3, 7) never
const ONE_TIMER_S = 1.2, SKILL_S = 3;

export class StageRun {
  readonly match: Match;
  readonly lineups: [Lineup, Lineup];
  readonly stage: Stage;
  done: Outcome | null = null;
  private t = 0;
  private start: [number, number];
  private lastPass = { team: -1, by: -1, t: -9 };
  private lastShot = { by: -1, oneTimer: false };
  private lastSkill = -9;
  private skillGoals = 0;
  private oneTimerGoals = 0;

  constructor(stage: Stage, mine: Lineup, opts: { human: boolean; seed?: number; intro?: number }) {
    this.stage = stage;
    const sc = stage.scenario, foe = foeFor(stage, mine);
    this.lineups = [mine, { ...foe, levels: foeLevels(stage, foe) }];
    this.match = new Match({
      seed: opts.seed ?? (Math.random() * 1e9) | 0, human: [opts.human, false], lineups: this.lineups,
      periodSeconds: sc && !sc.shootout ? sc.seconds : undefined, shootoutRounds: sc?.shootout || undefined,
      fights: !sc, introSeconds: opts.intro ?? 0,
    });
    const m = this.match;
    if (sc?.shootout) m.startShootout();
    else if (sc) {
      m.score = [...sc.score] as [number, number];
      for (const id of BENCH_MINE.slice(0, 3 - (sc.mySkaters ?? 3))) m.benched.add(id);
      for (const id of BENCH_THEIRS.slice(0, 3 - (sc.theirSkaters ?? 3))) m.benched.add(id);
      this.park();
      if (sc.puck !== 'faceoff') {
        for (let i = 0; i < 1200 && m.phase !== 'play'; i++) { m.step(STEP, [null, null]); this.park(); }
        m.events.length = 0;
        // the carrier starts in open ice in his own half, facing up the rink, not on the face-off dot among the other
        // team (the puck was gone before the player had moved); the other skaters keep their face-off spots
        const id = sc.puck === 'mine' ? 0 : 4, t = id < 4 ? 0 : 1, d = m.attack[t];
        placeSkater(m, id, -d * 7, 0, d > 0 ? 0 : Math.PI);
        givePuck(m, id);
        m.controlled[0] = 0;
      }
      m.clock = sc.seconds;
    }
    this.start = [...m.score] as [number, number];
  }

  get timeLeft(): number { return this.stage.scenario && !this.stage.scenario.shootout ? Math.max(0, this.match.clock) : 0; }

  /** benched skaters stand still along the far boards, out of play */
  private park() {
    for (const id of this.match.benched) Object.assign(this.match.skaters[id], { x: -22 + id * 1.4, z: 13.5, vx: 0, vz: 0, stun: 0.5 });
  }

  step(input: InputFrame | null): MatchEvent[] {
    if (this.done) return [];
    const m = this.match;
    m.step(STEP, [m.human[0] ? input : null, null]);
    this.t += STEP;
    if (m.benched.size) this.park();
    const ev = m.events.slice(); m.events.length = 0;
    for (const e of ev) this.watch(e);
    if (!this.done) this.judge();
    return ev;
  }

  private teamOf(id: number) { return id < 4 ? 0 : 1; }
  private watch(e: MatchEvent) {
    if (e.t === 'pass') this.lastPass = { team: this.teamOf(e.by), by: e.by, t: this.t };
    else if (e.t === 'shot') this.lastShot = { by: e.by, oneTimer: this.lastPass.team === this.teamOf(e.by) && this.lastPass.by !== e.by && this.t - this.lastPass.t < ONE_TIMER_S };
    else if (e.t === 'skill' && this.teamOf(e.by) === 0) this.lastSkill = this.t;
    else if (e.t === 'goal' && e.team === 0) {
      if (e.by >= 0 && e.by === this.lastShot.by && this.lastShot.oneTimer) this.oneTimerGoals++;
      if (this.t - this.lastSkill < SKILL_S) this.skillGoals++;
    }
  }

  private finish(cleared: boolean) {
    const m = this.match, so = m.shootout;
    const goals: [number, number] = so ? [so.results[0].filter(Boolean).length, so.results[1].filter(Boolean).length] : [m.score[0] - this.start[0], m.score[1] - this.start[1]];
    this.done = { cleared, myGoals: goals[0], theirGoals: goals[1], timeLeft: this.timeLeft, skillGoals: this.skillGoals, oneTimerGoals: this.oneTimerGoals };
  }

  private judge() {
    const m = this.match, sc = this.stage.scenario;
    if (!sc || sc.shootout) { if (m.phase === 'end') this.finish(m.winner === 0); return; }
    const mine = m.score[0] - this.start[0], theirs = m.score[1] - this.start[1];
    if (sc.goal === 'scoreN' && mine >= (sc.need ?? 1)) return this.finish(true);
    if (sc.goal === 'hold' && theirs > 0) return this.finish(false);
    if (sc.goal === 'next' && mine + theirs > 0) return this.finish(mine > 0);
    const over = m.clock <= 0 || m.phase === 'break' || m.phase === 'end' || m.phase === 'shootout';
    if (!over) return;
    if (sc.goal === 'win') return this.finish(m.score[0] > m.score[1]);
    this.finish(sc.goal === 'hold');
  }
}
