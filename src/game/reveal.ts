// The scout reveal: one skater on the empty ice, seen from behind, buries the puck; the goal flash gives away the grade
// and the camera cuts to the player's face. Uses the match scene and models, so it costs what a match start costs.
import { RINK } from '../sim/constants.ts';
import { settlePuckInNet } from '../sim/match.ts';
import type { HockeyScene, ViewSkater, ViewState } from '../render/scene.ts';
import type { Session } from './sessions.ts';
import { CHARACTER, CHARACTERS, GRADES, type Lineup } from './roster.ts';
import type { ModelId } from '../render/model-ids.ts';
import { cheer, sfx } from '../audio.ts';
import { gradeName } from './grades.ts';

const $ = (id: string) => document.getElementById(id)!;
const SHOT_AT = 2.6, TOP_SPEED = 10.5, PUCK_SPEED = 30, START_X = -14, GOALIE = 7;
const CUT_AFTER = 0.26;                                   // the camera cuts while the flash is brightest
const CARD_AFTER = [1.7, 1.9, 2.2, 2.6, 3.0];             // rarer grades get a longer moment before the card

export class ScoutReveal implements Session {
  private t = 0;
  private speed = 3;
  private scoredAt = -1;
  private cardShown = false;
  private view: ViewState;
  private puck = { x: START_X + 0.85, z: -2, y: 0, vx: 0, vz: 0, vy: 0, owner: 0 };
  private me: ViewSkater;
  private cam = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0 };
  private first = true;

  /** multi: a ten-pull result; the bottom of the screen holds the cards, so the camera frames the player in the space above them */
  constructor(private scene: HockeyScene, private card: { m: string }, private showCard: () => void, private multi = false) {
    const rest = CHARACTERS.filter(c => c.id !== card.m).map(c => c.id as ModelId);
    const mine: Lineup = { skaters: [card.m as ModelId, rest[0], rest[1]], goalie: rest[2] };
    const other: Lineup = { skaters: [rest[3], rest[4], rest[5]], goalie: rest[6] };
    scene.setLineups([mine, other]); scene.setSide(0);
    const skaters: ViewSkater[] = Array.from({ length: 8 }, (_, id) => ({ id, team: id < 4 ? 0 : 1, goalie: id % 4 === 3, x: 0, z: 0, vx: 0, vz: 0, face: 0, stun: 0, dive: 0 } as ViewSkater));
    this.me = skaters[0];
    this.me.x = START_X; this.me.z = -2;
    Object.assign(skaters[GOALIE], { x: RINK.goalX - 0.75, z: 0, face: Math.PI });
    this.view = { skaters, puck: this.puck, controlled: -1, charge: -1, hide: new Set([1, 2, 3, 4, 5, 6]) };
    scene.cinema = this.cam;
    const root = $('reveal');
    root.className = `reveal gr${this.grade}${multi ? ' multi' : ''}`;
    $('rvGrade').textContent = gradeName(this.grade);
    $('rvCard').innerHTML = '';
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.skip();
  }

  private get grade() { return CHARACTER[this.card.m as ModelId]?.grade ?? 0; }
  private get colorHex() { return parseInt(GRADES[this.grade].color.slice(1), 16); }

  /** straight to the end of the shot: the player stopped in front of the camera, the card up */
  skip() {
    if (this.cardShown) return;
    if (this.scoredAt < 0) {
      this.t = Math.max(this.t, SHOT_AT + 5);             // past the run-up, or the skater would skate on into the net
      this.me.x = START_X + 29; this.me.z = 0; this.me.face = 0; this.me.vx = this.me.vz = 0; this.speed = 0;
      Object.assign(this.puck, { x: RINK.goalX + RINK.netDepth - 0.12, z: 0.55, y: 0, vx: 0, vz: 0, vy: 0, owner: -1 });
      this.scoredAt = this.t - CUT_AFTER;
      $('reveal').classList.add('scored');
      this.first = true;
    }
    this.revealCard();
  }
  private revealCard() {
    this.cardShown = true;
    this.showCard();
    $('reveal').classList.add('shown');
  }
  private score() {
    this.scoredAt = this.t;
    sfx('horn'); cheer('goal');
    this.scene.onEvent({ t: 'goal', team: 0, by: 0 });
    this.scene.shake = 0.5 + this.grade * 0.08;
    this.scene.burst(0, this.colorHex, 3 + this.grade * 1.5);
    this.scene.burst(GOALIE, this.colorHex, 2 + this.grade);
    $('reveal').classList.add('scored');
  }

  frame(rawDt: number, time: number) {
    const dt = Math.min(rawDt, 0.05);
    this.t += dt;
    const t = this.t, s = this.me, p = this.puck, g = this.view.skaters[GOALIE];
    this.speed = t < SHOT_AT ? Math.min(TOP_SPEED, this.speed + 5 * dt) : Math.max(0, this.speed - 7.5 * dt);
    const heading = t < SHOT_AT ? Math.sin(t * 1.7) * 0.16 : s.face * Math.exp(-dt * 6);
    s.face = heading; s.vx = Math.cos(heading) * this.speed; s.vz = Math.sin(heading) * this.speed;
    s.x += s.vx * dt; s.z += s.vz * dt;
    if (p.owner === 0) {
      if (t >= SHOT_AT) {
        const dx = RINK.goalX + 0.4 - p.x, dz = 0.55 - p.z, d = Math.hypot(dx, dz);
        p.owner = -1; p.vx = dx / d * PUCK_SPEED; p.vz = dz / d * PUCK_SPEED; p.vy = 2.2;
        sfx('shot'); this.scene.shake = 0.2;
      } else {
        p.x = s.x + Math.cos(s.face) * 0.85; p.z = s.z + Math.sin(s.face) * 0.85; p.vx = s.vx; p.vz = s.vz;
      }
    } else if (this.scoredAt < 0) {
      p.x += p.vx * dt; p.z += p.vz * dt; p.vy -= 9.8 * dt; p.y = Math.max(0, p.y + p.vy * dt);
      if (p.x >= RINK.goalX) this.score();
    } else settlePuckInNet(p, 1, dt);
    g.dive = t > SHOT_AT + 0.12 && t < SHOT_AT + 0.7 ? 0.4 : 0;
    if (g.dive) g.z += (-0.45 - g.z) * Math.min(1, dt * 10);

    const landscape = this.scene.camera.aspect >= 1, cut = this.scoredAt >= 0 && t >= this.scoredAt + CUT_AFTER, c = this.cam;
    const wide = landscape ? 1 : 1.7;
    const want = cut
      ? this.multi ? this.frameInSpace(s) : { x: s.x + 3.3 * wide, y: 1.18, z: s.z + 1.0 * wide, lx: s.x, ly: 1.08, lz: s.z - (landscape ? 1.25 : 0) }
      : { x: s.x - 6.5 * wide, y: 1.75, z: s.z * 0.6 + 1.4, lx: s.x + 9, ly: 0.75, lz: s.z * 0.25 };
    if (this.first || (cut && !this.wasCut)) { Object.assign(c, want); this.first = false; }
    else { const k = 1 - Math.exp(-dt * (cut ? 5 : 9)); for (const key of Object.keys(want) as (keyof typeof want)[]) c[key] += (want[key] - c[key]) * k; }
    this.wasCut = cut;

    this.scene.update(this.view, rawDt, time);
    if (this.scoredAt >= 0 && !this.cardShown && t >= this.scoredAt + CARD_AFTER[this.grade]) this.revealCard();
  }
  private wasCut = false;

  /** the camera that stands the whole player in the empty part of a ten-pull's screen: left of the best card, above the row of cards, measured once from the page */
  private space: { heightPart: number; u: number; v: number; widthPart: number } | null = null;
  private tall = 2;
  private frameInSpace(s: ViewSkater) {
    if (!this.space) {
      const W = innerWidth, H = innerHeight, top = H * 0.09 + 8, bottom = $('rvAll').getBoundingClientRect().top - 8, left = 8, right = $('rvCard').getBoundingClientRect().left - 8;
      this.space = { heightPart: (bottom - top) / H, widthPart: (right - left) / W, u: (left + right) / W - 1, v: 1 - (top + bottom) / H };
      this.tall = this.scene.playerHeight(0);
    }
    const cam = this.scene.camera, tan = Math.tan((cam.fov * Math.PI) / 360), { heightPart, widthPart, u, v } = this.space;
    // the frame height that makes the player fill the space, unless his width would run out of it first
    const frame = Math.max(this.tall / (0.9 * heightPart), (this.tall * 0.62) / (cam.aspect * 0.95 * widthPart));
    const d = frame / (2 * tan), halfH = frame / 2, halfW = halfH * cam.aspect;
    const midY = this.tall / 2, dirX = 0.957, dirZ = 0.29;                       // the same three-quarter view as a single scout
    const rightX = dirZ, rightZ = -dirX;                                         // the camera's right on the ice, looking back at the player
    const lookOff = -u * halfW;
    return { x: s.x + dirX * d, y: midY + 0.12, z: s.z + dirZ * d, lx: s.x + rightX * lookOff, ly: midY - v * halfH, lz: s.z + rightZ * lookOff };
  }

  dispose() {
    this.scene.cinema = null;
    $('reveal').className = 'reveal hidden';
    $('rvCard').innerHTML = '';
  }
}
