// A stage on screen: StageRun (the sim and the stage's rules) plus rendering, HUD and input. PC players skate with the
// keys; phones play it as a manager match (my team on AI, the tactic buttons steer it). The banner at the top left
// shows the stage, its goal and the two star rules for this platform.
import { STEP } from '../sim/constants.ts';
import type { Team } from '../sim/types.ts';
import type { HockeyScene } from '../render/scene.ts';
import type { Hud } from '../hud.ts';
import type { KeyboardInput } from '../input.ts';
import type { Lineup } from './roster.ts';
import { StageRun } from './stageRun.ts';
import { starsFor, type Outcome, type Platform, type Stage, type StarRule } from './stages.ts';
import { INTRO_S, paintSkill, viewOf, type Session } from './sessions.ts';
import { t, type Key } from '../i18n.ts';

const $ = (id: string) => document.getElementById(id)!;
const teamOfId = (id: number): Team => (id < 4 ? 0 : 1);
const fill = (k: Key, n: number) => t(k).replace('{n}', String(n));

export function goalText(stage: Stage): string {
  const sc = stage.scenario;
  if (!sc) return t('sgBoss');
  if (sc.shootout) return t('sgShootout');
  if (sc.goal === 'scoreN') return fill('sgScoreN', sc.need ?? 1);
  return t(sc.goal === 'win' ? 'sgWin' : sc.goal === 'hold' ? 'sgHold' : 'sgNext');
}
export function ruleText(r: StarRule): string {
  switch (r.k) {
    case 'win': return t('srClear');
    case 'margin': return fill('srMargin', r.n);
    case 'clean': return t('srClean');
    case 'timeLeft': return fill('srTime', r.s);
    case 'skillGoal': return t('srSkill');
    case 'oneTimer': return t('srOne');
    case 'goals': return fill('srGoals', r.n);
  }
}
/** the three star lines of a stage for this platform: clearing, then its two rules */
export const starLines = (stage: Stage, p: Platform) => [t('srClear'), ...stage.stars[p].map(ruleText)];

/** first-visit phone prompts: when (s), the line, and which tactic button lights up */
const COACH: [number, Key, Key, string][] = [[1.5, 'scTip', 'scAttack', 'attack'], [11, 'scTip', 'scDefend', 'defend'], [21, 'scTip', 'scBalanced', 'balanced']];
const COACH_S = 7;

export class StageSession implements Session {
  readonly run: StageRun;
  private acc = 0;
  private ended = false;
  private endTimer = 0;
  private t = 0;
  private coachNext = 0;
  private platform: Platform;

  constructor(private scene: HockeyScene, private hud: Hud, private input: KeyboardInput, readonly stage: Stage, mine: Lineup,
              private opts: { manager: boolean; coach?: boolean }, private onEnd: (o: Outcome, stars: number) => void) {
    this.platform = opts.manager ? 'phone' : 'pc';
    this.run = new StageRun(stage, mine, { human: !opts.manager, intro: stage.scenario ? 0 : INTRO_S });
    scene.setLineups(this.run.lineups); scene.setSide(0); hud.me = 0;
    hud.auto = opts.manager;
    this.banner();
  }
  get match() { return this.run.match; }

  private banner() {
    $('sbStep').textContent = `${t('stageLabel')} ${this.stage.id}`;
    $('sbName').textContent = t(this.stage.name);
    $('sbGoal').textContent = goalText(this.stage);
    $('sbStars').innerHTML = starLines(this.stage, this.platform).map(s => `<li><i></i>${s}</li>`).join('');
    $('stageBar').classList.remove('hidden');
  }

  frame(dt: number, time: number) {
    const m = this.run.match;
    this.acc += dt;
    while (this.acc >= STEP) {
      const f = this.input.read((x, y) => this.scene.screenToWorld(x, y));
      const events = this.run.step(m.human[0] ? f : null);
      for (const e of events) { this.scene.onEvent(e); this.scene.shake = Math.max(this.scene.shake, this.hud.onEvent(e, teamOfId)); }
      this.acc -= STEP; this.t += STEP;
      if (this.run.done) { this.acc = 0; break; }
    }
    this.scene.update({ ...viewOf(m, 0), hide: m.benched }, dt, time);
    this.hud.update(m.score, m.clock, m.charge[0] >= 0 ? m.charge[0] : m.passCharge[0], m.overtime, m.charge[0] < 0 && m.passCharge[0] >= 0 && m.phase !== 'shootout', m.period);
    this.hud.shootout(m.shootout ? m.shootout.results : null);
    this.hud.fight(m.fightView(), m.offer ? { team: teamOfId(m.offer.by), t: m.offer.t } : null, m.morale);
    paintSkill(this.hud, this.input, m, 0);
    if (this.opts.coach) this.coach();
    if (this.run.done && !this.ended) {
      this.ended = true;
      const o = this.run.done, stars = starsFor(this.stage, o, this.platform);
      this.hud.lowerThird(t(o.cleared ? 'stClear' : 'stFail'), '', o.cleared ? 0 : 1, 1.6);
      this.endTimer = window.setTimeout(() => { this.endTimer = 0; this.onEnd(o, stars); }, 1500);
    }
  }
  /** a speech bubble over the tactic buttons, the named button pulsing, for COACH_S seconds each */
  private coach() {
    const tip = $('coachTip');
    if (this.coachNext < COACH.length && this.t >= COACH[this.coachNext][0]) {
      const [, a, b, tc] = COACH[this.coachNext++];
      $('ctMain').textContent = t(a); $('ctSub').textContent = t(b);
      tip.classList.remove('hidden'); tip.style.setProperty('--arrow', tc === 'attack' ? '16.7%' : tc === 'defend' ? '83.3%' : '50%');
      for (const el of document.querySelectorAll<HTMLElement>('#tactics button')) el.classList.toggle('coach-on', el.dataset.t === tc);
      this.coachOff = this.t + COACH_S;
    }
    if (this.coachOff > 0 && (this.t >= this.coachOff || this.run.done)) { this.coachOff = 0; this.clearCoach(); }
  }
  private coachOff = 0;
  private clearCoach() {
    $('coachTip').classList.add('hidden');
    for (const el of document.querySelectorAll<HTMLElement>('#tactics button')) el.classList.remove('coach-on');
  }
  /** the stage is over but its result is still on its way (the 1.5 s "Cleared"): deliver it now. Leaving in that
   *  window used to drop the clear, stars and reward with it. True when there was one to deliver */
  finishNow(): boolean {
    if (!this.ended || !this.endTimer || !this.run.done) return false;
    clearTimeout(this.endTimer); this.endTimer = 0;
    this.onEnd(this.run.done, starsFor(this.stage, this.run.done, this.platform));
    return true;
  }
  dispose() { clearTimeout(this.endTimer); $('stageBar').classList.add('hidden'); this.clearCoach(); this.hud.auto = false; }
}
