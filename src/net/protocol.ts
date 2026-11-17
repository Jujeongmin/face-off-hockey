// Host-authoritative 1v1 protocol. The host (team 0) runs the whole Match; the guest (team 1) sends its latest
// input and receives snapshots. Both are "latest value" channels: a lost or late packet is simply replaced by the
// next one (press counters in InputFrame make button presses survive that).
import type { FightAct, FightView, InputFrame, MatchEvent, Phase } from '../sim/types.ts';
import type { Match } from '../sim/match.ts';

export const NET = {
  snapshotMs: 33,       // host → guest ~30 Hz
  inputMs: 33,          // guest → host ~30 Hz
  throttleMs: 30,       // Agent8 stream minimum
  interpDelayMs: 70,    // guest renders others this far in the past (between two snapshots)
  peerTimeoutMs: 8000,  // no packets this long = opponent gone
} as const;

const PHASES: Phase[] = ['faceoff', 'play', 'goal', 'shootout', 'end', 'break', 'fight'];

export interface Snapshot {
  k: 's';
  q: number;              // snapshot seq
  t: number;              // host clock ms (for interpolation / RTT)
  ph: number;             // phase index
  c: number;              // clock (s, 1 decimal)
  pd?: number;            // period (1..3, 4 = overtime)
  sc: [number, number];
  ctl: [number, number];  // controlled skater per team
  ch: number;             // guest (team 1) shot charge (also a booked one-timer)
  pc?: number;            // guest pass charge while held
  ack: number;            // last guest input seq the host applied
  echo: number;           // guest send time of that input (RTT)
  s: number[];            // 8 × [x, z, vx, vz, face, stun, dive]
  p: number[];            // [x, z, y, vx, vz, owner]
  so: [number[], number[]] | null;   // shootout results 1/0
  ev: [number, MatchEvent][];         // recent events with ids
  w?: number;             // winner when ended (0, 1, −1)
  ot?: 1;                 // in overtime
  st?: number[];          // [shots0, shots1, saves0, saves1] when ended
  ft?: number[];          // fight: [a, b, hp a, hp b, st a, st b, act a, act b, hand a, hand b, p a, p b, t, over]
  of?: [number, number];  // fight offer: [skater it was offered to, seconds left]
  mo?: [number, number];  // speed boost seconds per team
  sk?: number[];          // 8 × [skill cooldown, skill active]
}
export interface InputPacket { k: 'i'; q: number; t: number; f: InputFrame }
export type Packet = Snapshot | InputPacket;

export const SKATER_FIELDS = 7;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;

function encodeFight(f: FightView | null): number[] | undefined {
  return f ? [f.a, f.b, r2(f.hp[0]), r2(f.hp[1]), r2(f.st[0]), r2(f.st[1]), f.act[0], f.act[1], f.hand[0], f.hand[1], r2(f.p[0]), r2(f.p[1]), r2(f.t), f.over ? 1 : 0] : undefined;
}
export function decodeFight(n: number[] | undefined): FightView | null {
  if (!n || n.length !== 14) return null;
  return { a: n[0], b: n[1], hp: [n[2], n[3]], st: [n[4], n[5]], act: [n[6] as FightAct, n[7] as FightAct], hand: [n[8], n[9]], p: [n[10], n[11]], t: n[12], over: !!n[13] };
}

export function encodeSnapshot(m: Match, q: number, ack: number, echo: number, events: [number, MatchEvent][]): Snapshot {
  const s: number[] = [];
  for (const k of m.skaters) s.push(r3(k.x), r3(k.z), r2(k.vx), r2(k.vz), r3(k.face), r2(k.stun), r2(k.dive));
  const p = m.puck;
  return {
    k: 's', q, t: Math.round(performance.now()), ph: PHASES.indexOf(m.phase), c: Math.round(m.clock * 10) / 10, pd: m.period,
    sc: [...m.score] as [number, number], ctl: [...m.controlled] as [number, number], ch: r2(m.charge[1]), pc: m.passCharge[1] >= 0 ? r2(m.passCharge[1]) : undefined, ack, echo,
    s, p: [r3(p.x), r3(p.z), r2(p.y), r2(p.vx), r2(p.vz), p.owner],
    so: m.shootout ? [m.shootout.results[0].map(Number), m.shootout.results[1].map(Number)] : null,
    ev: events, w: m.phase === 'end' ? m.winner : undefined, ot: m.overtime ? 1 : undefined,
    st: m.phase === 'end' ? [m.stats.shots[0], m.stats.shots[1], m.stats.saves[0], m.stats.saves[1]] : undefined,
    ft: encodeFight(m.fightView()), of: m.offer ? [m.offer.by, r2(m.offer.t)] : undefined,
    mo: m.morale[0] > 0 || m.morale[1] > 0 ? [r2(m.morale[0]), r2(m.morale[1])] : undefined,
    sk: m.skaters.flatMap(k => [r1(k.skillCd), r1(k.skillT)]),
  };
}
export const phaseOf = (i: number): Phase => PHASES[i] ?? 'play';

/** light shape check for packets that came over the wire */
export function isSnapshot(x: unknown): x is Snapshot {
  const o = x as Snapshot;
  return !!o && o.k === 's' && Array.isArray(o.s) && o.s.length === 8 * SKATER_FIELDS && Array.isArray(o.p) && o.p.length === 6;
}
export function isInput(x: unknown): x is InputPacket {
  const o = x as InputPacket;
  return !!o && o.k === 'i' && typeof o.q === 'number' && !!o.f && typeof o.f.mx === 'number' && typeof o.f.passSeq === 'number';
}
