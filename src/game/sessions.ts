// Game sessions: what runs while a match is on screen.
//  LocalSession  – practice vs AI / AI-vs-AI spectating; the Match runs here.
//  HostSession   – online, team 0: runs the Match, applies the guest's input, publishes snapshots.
//  GuestSession  – online, team 1: predicts its own skater, interpolates everything else from snapshots.
import { Match } from '../sim/match.ts';
import { STEP, SHOOTOUT } from '../sim/constants.ts';
import type { InputFrame, MatchEvent, Team } from '../sim/types.ts';
import type { Lineup } from './roster.ts';
import { emptyInput } from '../sim/types.ts';
import type { HockeyScene, ViewState, ViewSkater } from '../render/scene.ts';
import type { Hud } from '../hud.ts';
import type { KeyboardInput } from '../input.ts';
import type { ChatResult, Link } from '../net/transport.ts';
import { NET, SKATER_FIELDS, decodeFight, encodeSnapshot, isInput, isSnapshot, phaseOf, type Snapshot } from '../net/protocol.ts';

export interface MatchResult { winner: Team | -1; score: [number, number]; shootout: [number, number] | null; me: Team; shots: [number, number]; saves: [number, number]; forfeit?: boolean;
  aborted?: boolean }   // the opponent was gone before the match really started: not a result, search again
export interface Session {
  frame(dt: number, time: number): void; dispose(): void;
  /** online matches only: send a chat line (the HUD shows both players' lines as they come back) */
  say?(text: string): Promise<ChatResult>;
}

export const viewOf = (m: Match, me: Team): ViewState => ({ skaters: m.skaters, puck: m.puck, controlled: m.human[me] ? m.controlled[me] : -1, charge: m.charge[me], fight: m.fightView() });
const teamOfId = (id: number): Team => (id < 4 ? 0 : 1);
/** the skill chip follows the skater I control; there is none in a fight or the shootout */
export function paintSkill(hud: Hud, input: KeyboardInput, m: Match, me: Team) {
  const s = m.human[me] && !m.fight && !m.shootout ? m.skaters[m.controlled[me]] : null;
  hud.skill(s ? s.id : -1, s ? s.skillCd : 0, s ? s.skillT : 0);
  input.skill = s ? s.skill : 'none';
}
/** dev only: ?time=<seconds> shortens the period for testing */
/** lineup intro before the first face-off (the sim holds the puck drop this long) */
export const INTRO_S = 2.4;
const devPeriod = () => (import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('time')) || undefined : undefined);

// ------------------------------------------------------------------ local
export class LocalSession implements Session {
  readonly match: Match;
  private acc = 0;
  private done = false;
  constructor(private scene: HockeyScene, private hud: Hud, private input: KeyboardInput, watch: boolean, private onEnd: (r: MatchResult) => void, lineups: [Lineup, Lineup]) {
    this.match = new Match({ seed: (Math.random() * 1e9) | 0, human: watch ? [false, false] : [true, false], periodSeconds: devPeriod(), lineups, introSeconds: INTRO_S, fights: true });
    scene.setLineups(lineups); scene.setSide(0); hud.me = 0;
  }
  frame(dt: number, time: number) {
    const m = this.match;
    this.acc += dt;
    while (this.acc >= STEP) {
      const f = this.input.read((x, y) => this.scene.screenToWorld(x, y));
      m.step(STEP, [m.human[0] ? f : null, null]);
      this.acc -= STEP;
    }
    for (const e of m.events) { this.scene.onEvent(e); this.scene.shake = Math.max(this.scene.shake, this.hud.onEvent(e, teamOfId)); }
    m.events.length = 0;
    this.scene.update(viewOf(m, 0), dt, time);
    this.hud.update(m.score, m.clock, m.charge[0] >= 0 ? m.charge[0] : m.passCharge[0], m.overtime, m.charge[0] < 0 && m.passCharge[0] >= 0 && m.phase !== 'shootout', m.period);
    this.hud.shootout(m.shootout ? m.shootout.results : null);
    this.hud.fight(m.fightView(), m.offer ? { team: teamOfId(m.offer.by), t: m.offer.t } : null, m.morale);
    paintSkill(this.hud, this.input, m, 0);
    if (m.phase === 'end' && !this.done) {
      this.done = true;
      const so = m.shootout ? [m.shootout.results[0].filter(Boolean).length, m.shootout.results[1].filter(Boolean).length] as [number, number] : null;
      setTimeout(() => this.onEnd({ winner: m.winner, score: [...m.score] as [number, number], shootout: so, me: 0, shots: [m.stats.shots[0], m.stats.shots[1]], saves: [m.stats.saves[0], m.stats.saves[1]] }), 1500);
    }
  }
  dispose() { /* nothing to free: scene objects are reused */ }
}

// ------------------------------------------------------------------ host
export class HostSession implements Session {
  readonly match: Match;
  private acc = 0;
  private remote: InputFrame = emptyInput();
  private ack = 0;
  private echo = 0;
  private lastPeer = performance.now();
  private heard = false;              // a packet from the opponent has arrived (the match is real)
  private sendT = 0;
  private seq = 0;
  private evId = 0;
  private recent: [number, MatchEvent][] = [];
  private done = false;
  private endSends = 0;
  constructor(private scene: HockeyScene, private hud: Hud, private input: KeyboardInput, private link: Link, private onEnd: (r: MatchResult) => void, lineups: [Lineup, Lineup]) {
    this.match = new Match({ seed: (Math.random() * 1e9) | 0, human: [true, true], periodSeconds: devPeriod(), lineups, introSeconds: INTRO_S, fights: true });
    scene.setLineups(lineups); scene.setSide(0); hud.me = 0;
    link.onChat((team, text) => hud.chatLine(team, text));
    link.onPacket(p => {
      if (!isInput(p) || p.q <= this.ack) return;
      this.ack = p.q; this.echo = p.t; this.remote = p.f; this.lastPeer = performance.now(); this.heard = true;
    });
    link.onPeerLeft(() => this.forfeit());
  }  say(text: string) { return this.link.say(text, 0); }

  private forfeit() {
    if (this.done) return;
    this.done = true;
    const m = this.match;
    this.onEnd({ winner: 0, score: [...m.score] as [number, number], shootout: null, me: 0, shots: [m.stats.shots[0], m.stats.shots[1]], saves: [m.stats.saves[0], m.stats.saves[1]], forfeit: true, aborted: !this.heard });
  }
  frame(dt: number, time: number) {
    const m = this.match;
    if (performance.now() - this.lastPeer > NET.peerTimeoutMs) return this.forfeit();
    this.acc += dt;
    while (this.acc >= STEP) {
      const f = this.input.read((x, y) => this.scene.screenToWorld(x, y));
      m.step(STEP, [f, this.remote]);
      this.acc -= STEP;
    }
    for (const e of m.events) {
      this.scene.onEvent(e);
      this.scene.shake = Math.max(this.scene.shake, this.hud.onEvent(e, teamOfId));
      this.recent.push([++this.evId, e]); if (this.recent.length > 24) this.recent.shift();
    }
    m.events.length = 0;
    this.sendT += dt * 1000;
    // keep publishing a few times after the end so the guest surely sees the final state
    if (this.sendT >= NET.snapshotMs && (m.phase !== 'end' || this.endSends < 15)) {
      this.sendT = 0;
      if (m.phase === 'end') this.endSends++;
      this.link.send(encodeSnapshot(m, ++this.seq, this.ack, this.echo, this.recent));
    }
    this.scene.update(viewOf(m, 0), dt, time);
    this.hud.update(m.score, m.clock, m.charge[0] >= 0 ? m.charge[0] : m.passCharge[0], m.overtime, m.charge[0] < 0 && m.passCharge[0] >= 0 && m.phase !== 'shootout', m.period);
    this.hud.shootout(m.shootout ? m.shootout.results : null);
    this.hud.fight(m.fightView(), m.offer ? { team: teamOfId(m.offer.by), t: m.offer.t } : null, m.morale);
    paintSkill(this.hud, this.input, m, 0);
    if (m.phase === 'end' && !this.done) {
      this.done = true;
      const so = m.shootout ? [m.shootout.results[0].filter(Boolean).length, m.shootout.results[1].filter(Boolean).length] as [number, number] : null;
      setTimeout(() => this.onEnd({ winner: m.winner, score: [...m.score] as [number, number], shootout: so, me: 0, shots: [m.stats.shots[0], m.stats.shots[1]], saves: [m.stats.saves[0], m.stats.saves[1]] }), 1500);
    }
  }
  dispose() { this.link.close(); }
}

// ------------------------------------------------------------------ guest
interface Buffered { snap: Snapshot; at: number }
export class GuestSession implements Session {
  /** used only for its physics helpers + as the predicted copy of my skater */
  private pred = new Match({ human: [false, true] });
  private buf: Buffered[] = [];
  private latest: Snapshot | null = null;
  private seq = 0;
  private sendT = 0;
  private pending: { q: number; f: InputFrame; dt: number }[] = [];
  private lastEv = 0;
  private offset = Infinity;       // min(receive time − host time): host clock → local clock
  private rtt = 0;
  private own = -1;
  private visual = { dx: 0, dz: 0 };  // smoothing of prediction corrections
  private view: ViewState;
  private done = false;
  private lastRecv = performance.now();
  // shootout: an attempt is on (between shootoutAttempt and shootoutResult) and whether I am the one shooting.
  // Shooting I predict my skater; defending I predict my goalie (the host moves it the same way: 4.2 m/s across
  // the crease, slower while down); between attempts nothing of mine moves.
  private so = { active: false, mine: false };
  private gk = { id: -1, z: 0, dive: 0, dz: 0 };   // dz: correction still being faded out of the drawn position
  private lastShootSeq = 0;

  constructor(private scene: HockeyScene, private hud: Hud, private input: KeyboardInput, private link: Link, private onEnd: (r: MatchResult) => void, lineups: [Lineup, Lineup]) {
    this.pred = new Match({ human: [false, true], lineups });
    this.gk.id = this.pred.goalieOf(1).id;
    scene.setLineups(lineups); scene.setSide(1); hud.me = 1;
    const sk: ViewSkater[] = this.pred.skaters.map(s => ({ id: s.id, team: s.team, goalie: s.goalie, x: s.x, z: s.z, vx: 0, vz: 0, face: s.face, stun: 0, dive: 0 }));
    this.view = { skaters: sk, puck: { x: 0, z: 0, y: 0, vx: 0, vz: 0, owner: -1 }, controlled: -1, charge: -1 };
    link.onPacket(p => { if (isSnapshot(p)) this.receive(p); });
    link.onPeerLeft(() => this.forfeit());
    link.onChat((team, text) => hud.chatLine(team, text));
  }
  say(text: string) { return this.link.say(text, 1); }

  private forfeit() {
    if (this.done) return;
    this.done = true;
    const sc = this.latest?.sc ?? [0, 0];
    this.onEnd({ winner: 1, score: [...sc] as [number, number], shootout: null, me: 1, shots: [0, 0], saves: [0, 0], forfeit: true, aborted: !this.latest });
  }

  private receive(s: Snapshot) {
    if (this.latest && s.q <= this.latest.q) return;
    const now = performance.now();
    this.lastRecv = now;
    // host clock → local clock: track the fastest delivery, let it drift up slowly so clock skew can't stick
    this.offset = Math.min(this.offset + 0.02, now - s.t);
    if (s.echo) this.rtt = this.rtt ? this.rtt * 0.9 + (now - s.echo) * 0.1 : now - s.echo;
    this.latest = s;
    this.buf.push({ snap: s, at: now });
    if (this.buf.length > 30) this.buf.shift();
    // events
    for (const [id, e] of s.ev) if (id > this.lastEv) {
      this.lastEv = id; this.scene.onEvent(e); this.scene.shake = Math.max(this.scene.shake, this.hud.onEvent(e, teamOfId));
      if (e.t === 'shootoutAttempt') { this.so = { active: true, mine: e.team === 1 }; Object.assign(this.gk, { z: 0, dive: 0, dz: 0 }); }   // the host sets the goalie in the middle
      else if (e.t === 'shootoutResult' || e.t === 'end') this.so.active = false;
    }
    // reconcile my skater: take the host's state, replay inputs it has not applied yet
    const ctl = s.ctl[1];
    const me = this.pred.skaters[ctl];
    const before = this.own === ctl ? { x: me.x, z: me.z } : null;
    if (this.own !== ctl) { this.own = ctl; this.pending.length = 0; }
    const o = ctl * SKATER_FIELDS;
    me.x = s.s[o]; me.z = s.s[o + 1]; me.vx = s.s[o + 2]; me.vz = s.s[o + 3]; me.face = s.s[o + 4]; me.stun = s.s[o + 5]; me.skillT = s.sk?.[ctl * 2 + 1] ?? 0;
    this.pred.puck.owner = s.p[5];
    this.pending = this.pending.filter(p => p.q > s.ack);
    if (this.role === 'goalie') {
      // my goalie: the host's position, then the inputs it has not applied yet
      const g = this.gk.id * SKATER_FIELDS, was = this.gk.z;
      this.gk.z = s.s[g + 1]; this.gk.dive = Math.max(this.gk.dive, s.s[g + 6]);
      for (const p of this.pending) this.stepGoalie(p.f, p.dt);
      this.gk.dz = Math.abs(this.gk.dz + was - this.gk.z) < 1 ? this.gk.dz + was - this.gk.z : 0;
    } else for (const p of this.pending) this.simulateOwn(p.f, p.dt);
    if (before) {                                   // hide the correction: carry the difference and fade it out
      this.visual.dx += before.x - me.x; this.visual.dz += before.z - me.z;
      if (Math.hypot(this.visual.dx, this.visual.dz) > 2.5) this.visual.dx = this.visual.dz = 0;   // too far: snap
    }
    const phase = phaseOf(s.ph);
    if (phase === 'end' && !this.done && s.w !== undefined) {
      this.done = true;
      const so = s.so ? [s.so[0].filter(Boolean).length, s.so[1].filter(Boolean).length] as [number, number] : null;
      const st = s.st ?? [0, 0, 0, 0];
      setTimeout(() => this.onEnd({ winner: s.w as Team | -1, score: [...s.sc] as [number, number], shootout: so, me: 1, shots: [st[0], st[1]], saves: [st[2], st[3]] }), 1500);
    }
  }

  /** what of mine this side predicts now */
  private get role(): 'skater' | 'goalie' | null {
    const ph = this.latest ? phaseOf(this.latest.ph) : null;
    if (ph === 'play') return 'skater';
    if (ph === 'shootout' && this.so.active) return this.so.mine ? 'skater' : 'goalie';
    return null;
  }
  /** the host's goalie control (Match.updateGoalie with a player's input) */
  private stepGoalie(f: InputFrame, dt: number) {
    const tz = Math.max(-0.95, Math.min(0.95, this.gk.z + f.mz * 3)), dz = tz - this.gk.z;
    this.gk.z += Math.sign(dz) * Math.min(Math.abs(dz), 4.2 * dt * (this.gk.dive > 0 ? 0.3 : 1));
  }
  private simulateOwn(f: InputFrame, dt: number) {
    const me = this.pred.skaters[this.own];
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(STEP, left);
      this.pred.steer(me, f.mx, f.mz, h, f.sprint);
      this.pred.moveSkater(me, h);
      me.stun = Math.max(0, me.stun - h);
      left -= h;
    }
  }

  frame(dt: number, time: number) {
    if (!this.done && performance.now() - this.lastRecv > NET.peerTimeoutMs) return this.forfeit();
    const f = this.input.read((x, y) => this.scene.screenToWorld(x, y));
    const s = this.latest;
    // predict my skater (or, defending in the shootout, my goalie) with the input of this frame, only while it is live
    const role = this.role;
    if (role === 'goalie') {
      if (f.shootSeq > this.lastShootSeq && this.gk.dive <= 0) this.gk.dive = SHOOTOUT.dive + SHOOTOUT.recover;   // D: down at once
      this.gk.dive = Math.max(0, this.gk.dive - dt);
    }
    this.lastShootSeq = f.shootSeq;
    if (s && this.own >= 0 && role) {
      if (role === 'goalie') this.stepGoalie(f, dt); else this.simulateOwn(f, dt);
      this.pending.push({ q: this.seq + 1, f, dt });
      if (this.pending.length > 240) this.pending.shift();
    }
    this.sendT += dt * 1000;
    if (this.sendT >= NET.inputMs) { this.sendT = 0; this.link.send({ k: 'i', q: ++this.seq, t: Math.round(performance.now()), f }); }
    if (!s) return;
    this.interpolate();
    this.visual.dx *= Math.exp(-dt * 10); this.visual.dz *= Math.exp(-dt * 10); this.gk.dz *= Math.exp(-dt * 10);
    this.scene.update(this.view, dt, time);
    this.hud.update(s.sc, s.c, s.ch >= 0 ? s.ch : (s.pc ?? -1), !!s.ot, s.ch < 0 && s.pc != null, s.pd ?? 1);
    this.hud.shootout(s.so ? [s.so[0].map(Boolean), s.so[1].map(Boolean)] : null);
    this.view.fight = decodeFight(s.ft);
    this.hud.fight(this.view.fight, s.of ? { team: teamOfId(s.of[0]), t: s.of[1] } : null, s.mo ?? [0, 0]);
    if (s.mo) this.pred.morale = [s.mo[0], s.mo[1]]; else this.pred.morale = [0, 0];
    this.hud.skill(s.so || s.ft ? -1 : s.ctl[1], s.sk?.[s.ctl[1] * 2] ?? 0, s.sk?.[s.ctl[1] * 2 + 1] ?? 0);
    this.input.skill = s.so || s.ft ? 'none' : this.pred.skaters[s.ctl[1]].skill;
    this.hud.ping(`${Math.round(this.rtt)} ms`);
  }

  /** everything except my skater: render the host state NET.interpDelayMs in the past, between two snapshots */
  private interpolate() {
    const target = performance.now() - this.offset - NET.interpDelayMs;   // in host clock
    let a = this.buf[0], b = this.buf[this.buf.length - 1];
    for (let i = 0; i < this.buf.length - 1; i++) if (this.buf[i].snap.t <= target && this.buf[i + 1].snap.t >= target) { a = this.buf[i]; b = this.buf[i + 1]; break; }
    const span = b.snap.t - a.snap.t, k = span > 0 ? Math.min(1, Math.max(0, (target - a.snap.t) / span)) : 1;
    const A = a.snap.s, B = b.snap.s, v = this.view, role = this.role;
    for (let i = 0; i < v.skaters.length; i++) {
      const o = i * SKATER_FIELDS, sk = v.skaters[i];
      if (i === this.gk.id && role === 'goalie') {
        sk.x = A[o] + (B[o] - A[o]) * k; sk.z = this.gk.z + this.gk.dz; sk.vx = 0; sk.vz = 0; sk.face = B[o + 4]; sk.stun = 0; sk.dive = Math.max(B[o + 6], this.gk.dive);
        continue;
      }
      if (i === this.own && role === 'skater') {
        const me = this.pred.skaters[i];
        sk.x = me.x + this.visual.dx; sk.z = me.z + this.visual.dz; sk.vx = me.vx; sk.vz = me.vz; sk.face = me.face; sk.stun = B[o + 5]; sk.dive = B[o + 6];
        continue;
      }
      sk.x = A[o] + (B[o] - A[o]) * k; sk.z = A[o + 1] + (B[o + 1] - A[o + 1]) * k;
      sk.vx = B[o + 2]; sk.vz = B[o + 3];
      const da = Math.atan2(Math.sin(B[o + 4] - A[o + 4]), Math.cos(B[o + 4] - A[o + 4]));
      sk.face = A[o + 4] + da * k; sk.stun = B[o + 5]; sk.dive = B[o + 6];
    }
    const PA = a.snap.p, PB = b.snap.p, p = v.puck;
    p.owner = PB[5];
    if (p.owner === this.own && this.own >= 0 && role === 'skater') {
      // my puck sits on my predicted stick so carrying it feels instant
      const me = v.skaters[this.own];
      p.x = me.x + Math.cos(me.face) * 0.85 + Math.cos(me.face - Math.PI / 2) * 0.12; p.z = me.z + Math.sin(me.face) * 0.85 + Math.sin(me.face - Math.PI / 2) * 0.12; p.y = 0;
    } else {
      p.x = PA[0] + (PB[0] - PA[0]) * k; p.z = PA[1] + (PB[1] - PA[1]) * k; p.y = PA[2] + (PB[2] - PA[2]) * k;
    }
    p.vx = PB[3]; p.vz = PB[4];
    v.controlled = this.own; v.charge = this.latest ? this.latest.ch : -1;
  }

  dispose() { this.link.close(); }
}
