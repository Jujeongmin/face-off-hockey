// Skill controls: pass power picks near / far and sets the pace, a shot booked during a pass goes off as a
// the moment the puck arrives, and body checks land on timing and angle alone (node --experimental-strip-types tests/skill.test.ts)
import { Match } from '../src/sim/match.ts';
import { STEP } from '../src/sim/constants.ts';
import { emptyInput, type InputFrame, type MatchEvent } from '../src/sim/types.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };

/** both teams human (no AI steering the skaters we set up); everyone else parked out of play */
function setup(seed: number) {
  const m = new Match({ seed, human: [true, true] });
  while (m.phase !== 'play') m.step(STEP, [null, null]);
  for (const s of m.skaters) if (!s.goalie) Object.assign(s, { x: -24 + s.id, z: 13, vx: 0, vz: 0 });
  return m;
}
function run(m: Match, f0: InputFrame | null, f1: InputFrame | null, ticks: number, until?: (e: MatchEvent[]) => boolean) {
  const seen: MatchEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    m.step(STEP, [f0, f1]); seen.push(...m.events); m.events.length = 0;
    if (until?.(seen)) break;
  }
  return seen;
}

// ---------------------------------------------------------------- pass power
function passWith(holdTicks: number) {
  const m = setup(7);
  const [c, near, far] = m.teamSkaters(0);
  Object.assign(c, { x: -10, z: 0, face: 0 });
  Object.assign(near, { x: -5, z: -3 });          // off the lane to the far one
  Object.assign(far, { x: 13, z: 3 });
  m.puck.owner = c.id; m.puck.last = c.id; m.controlled[0] = c.id; m.controlled[1] = m.teamSkaters(1)[0].id;
  const f = emptyInput();
  run(m, f, null, 1);
  const down = { ...f, mx: 1, mz: 0, passSeq: 1, passHeld: true };
  run(m, down, null, holdTicks);
  const up = { ...down, passHeld: false };
  run(m, up, null, 1);
  return { to: m.puck.passTo, near: near.id, far: far.id, pace: Math.hypot(m.puck.vx, m.puck.vz) };
}
const tap = passWith(2), full = passWith(100);
check('tap passes to the near teammate', tap.to === tap.near, tap);
check('a full-power pass goes to the far teammate', full.to === full.far, full);
check('a held pass is harder than a tap', full.pace > tap.pace * 1.3, { tap: tap.pace.toFixed(1), full: full.pace.toFixed(1) });
{
  const m = setup(7);
  const [c] = m.teamSkaters(0);
  m.puck.owner = c.id; m.puck.last = c.id; m.controlled[0] = c.id;
  const f = emptyInput();
  run(m, f, null, 1);
  run(m, { ...f, passSeq: 1, passHeld: true }, null, 30);
  check('the pass waits for the release', m.puck.owner === c.id && m.passCharge[0] > 0.3, { charge: m.passCharge[0] });
}

// ---------------------------------------------------------------- shot booked during a pass
function oneTimer(holdThrough: boolean) {
  const m = setup(11);
  const [c, r] = m.teamSkaters(0);
  Object.assign(c, { x: -2, z: -6, face: Math.PI / 2 });
  Object.assign(r, { x: 6, z: 2, face: 0 });
  m.puck.owner = c.id; m.puck.last = c.id; m.controlled[0] = c.id;
  const f = emptyInput();
  run(m, f, null, 1);
  const toR = { ...f, mx: 0.8, mz: 0.6, passSeq: 1, passHeld: false };
  run(m, toR, null, 1);
  const passedTo = m.puck.passTo;
  run(m, { ...toR, mx: 0, mz: 0 }, null, 6);                              // puck on its way
  const press = { ...toR, mx: 0, mz: 0, shootSeq: 1, shootHeld: true };
  const ev = run(m, press, null, 8);
  const lunged = ev.some(e => e.t === 'lunge');
  const booked = m.queued[0];
  const after = holdThrough ? press : { ...press, shootHeld: false, releaseSeq: 1 };
  const ev2 = run(m, after, null, 200, e => e.some(x => x.t === 'shot'));
  const shot = ev2.find(e => e.t === 'shot');
  return { passedTo, r: r.id, lunged, booked, shotBy: shot && shot.t === 'shot' ? shot.by : -1, power: shot && shot.t === 'shot' ? shot.power : -1, owner: m.puck.owner, charge: m.charge[0] };
}
const ot = oneTimer(false);
check('D during an incoming pass books a shot, no body check', ot.passedTo === ot.r && !ot.lunged && ot.booked > 0, ot);
check('the booked shot goes off as the pass arrives', ot.shotBy === ot.r, ot);
const otHold = oneTimer(true);
check('holding D through the catch still shoots the moment it arrives', otHold.shotBy === otHold.r && otHold.power >= otHold.booked, otHold);

// ---------------------------------------------------------------- body checks
function hit(seed: number, checker: { vx: number; face: number }, carrier: { x: number; z: number; vx: number; vz: number }, pressAt = 0) {
  const m = setup(seed);
  const a = m.teamSkaters(0)[0], b = m.teamSkaters(1)[0];
  Object.assign(a, { x: 0, z: 0, vz: 0, ...checker });
  Object.assign(b, { ...carrier, face: Math.atan2(carrier.vz, carrier.vx || 1e-6) });
  m.puck.owner = b.id; m.puck.last = b.id; m.controlled[0] = a.id; m.controlled[1] = b.id;
  const glide = emptyInput();
  run(m, glide, glide, 1 + pressAt);
  const ev = run(m, { ...glide, mx: Math.cos(checker.face), mz: Math.sin(checker.face), shootSeq: 1 }, glide, 60);
  const c = ev.find(e => e.t === 'check' || e.t === 'bump');
  return { result: !c ? 'miss' : c.t === 'bump' ? 'bump' : c.hard ? 'knockdown' : 'stagger', puckLost: m.puck.owner !== b.id, checkerStun: a.stun > 0 || ev.some(e => e.t === 'lunge') && !c };
}
const headOn = hit(1, { vx: 6, face: 0 }, { x: 2.2, z: 0, vx: -2, vz: 0 });
check('skating into a carrier head-on knocks him down and frees the puck', headOn.result === 'knockdown' && headOn.puckLost, headOn);
const chase = hit(1, { vx: 7, face: 0 }, { x: 1.4, z: 0, vx: 6.5, vz: 0 });
check('catching a carrier who skates away is only a bump', chase.result === 'bump' && !chase.puckLost, chase);
const dodge = hit(1, { vx: 4, face: 0 }, { x: 2.6, z: 0, vx: 0, vz: 7.5 });
check('a carrier cutting across the lunge is missed', dodge.result === 'miss' && !dodge.puckLost, dodge);
const same = [1, 2, 3, 4, 5].map(s => hit(s, { vx: 5, face: 0 }, { x: 2.0, z: 0.4, vx: 1, vz: 1 }).result);
check('the same check gives the same result on every seed (no dice)', same.every(r => r === same[0]), same);

if (failed) throw new Error(`${failed} skill check(s) failed`);
console.log('skill checks passed');
