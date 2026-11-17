// Hockey fights: offered after a heavy hit, decided by punches, guards and dodges, and worth a speed boost
// (node --experimental-strip-types tests/fight.test.ts)
import { Match } from '../src/sim/match.ts';
import { STEP, FIGHT, SKATE } from '../src/sim/constants.ts';
import { emptyInput, type InputFrame } from '../src/sim/types.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };

function setup(fights = true) {
  const m = new Match({ seed: 5, human: [true, true], fights });
  while (m.phase !== 'play') m.step(STEP, [null, null]);
  return m;
}
type Hit = { offerFight(a: unknown, b: unknown): void };
const offer = (m: Match) => (m as unknown as Hit).offerFight(m.skaters[0], m.skaters[4]);   // skater 0 took the hit from 4
function run(m: Match, a: InputFrame, b: InputFrame, secs: number) { const n = Math.round(secs / STEP); for (let i = 0; i < n && m.phase === 'fight'; i++) m.step(STEP, [a, b]); }
function play(m: Match, secs: number, a = emptyInput(), b = emptyInput()) { const n = Math.round(secs / STEP); for (let i = 0; i < n; i++) m.step(STEP, [a, b]); }
const startFight = () => {
  const m = setup(); offer(m);
  const a = emptyInput(), b = emptyInput();
  m.step(STEP, [a, b]);
  a.fightSeq = 1; m.step(STEP, [a, b]);
  return { m, a, b };
};

// offers
{
  const m = setup(false); offer(m);
  check('no offer where fights are off', m.offer === null);
  const m2 = setup(); offer(m2);
  check('a heavy hit makes an offer to the skater hit', m2.offer?.by === 0, m2.offer);
  play(m2, FIGHT.offerSeconds + 0.1);
  check('an unanswered offer lapses', m2.offer === null && m2.phase === 'play');
  const b2 = emptyInput(); offer(m2); m2.step(STEP, [emptyInput(), b2]); b2.fightSeq = 1; m2.step(STEP, [emptyInput(), b2]);
  check('the team that hit cannot accept', m2.phase === 'play');
}
{
  const { m } = startFight();
  check('accepting starts the fight and stops the clock', m.phase === 'fight' && !!m.fight, m.phase);
  const c = m.clock; run(m, emptyInput(), emptyInput(), 1);
  check('the clock is stopped', m.clock === c);
}
// punches
function punches(m: Match, a: InputFrame, b: InputFrame, n: number, gap = 0.7) { for (let i = 0; i < n && m.phase === 'fight'; i++) { a.shootSeq++; run(m, a, b, gap); } }
{
  const { m, a, b } = startFight();
  const hp0 = m.fight!.f[1].hp; punches(m, a, b, 1);
  check('a clean punch takes health', m.fight!.f[1].hp < hp0 - 8, m.fight!.f[1].hp);
}
{
  const { m, a, b } = startFight();
  b.passHeld = true; run(m, a, b, 0.05);
  const hp0 = m.fight!.f[1].hp; punches(m, a, b, 1);
  check('a guard takes only a little', hp0 - m.fight!.f[1].hp <= FIGHT.guardChip + 0.01, hp0 - m.fight!.f[1].hp);
  check('and costs stamina', m.fight!.f[1].st < 1);
}
{
  const { m, a, b } = startFight();
  a.shootSeq++; run(m, a, b, FIGHT.windup - 0.1);
  b.mx = 1; run(m, a, b, 0.14);
  check('a dodge makes it miss', m.fight!.f[1].hp === FIGHT.hp, m.fight!.f[1].hp);
}
{
  const { m, a, b } = startFight();
  for (let i = 0; i < 8; i++) { a.shootSeq++; run(m, a, b, 0.02); }
  run(m, a, b, 0.5);
  check('button mashing is limited by stamina and timing', m.fight!.f[1].hp > FIGHT.hp - 2 * FIGHT.punch, m.fight!.f[1].hp);
}
{
  // a dodge gives a counter that hits harder than a plain punch
  const plain = startFight(); plain.a.shootSeq++; run(plain.m, plain.a, plain.b, 0.6);
  const dmgPlain = FIGHT.hp - plain.m.fight!.f[1].hp;
  const { m, a, b } = startFight();
  b.shootSeq++; run(m, a, b, FIGHT.windup - 0.12);
  a.mx = 1; run(m, a, b, 0.2); a.mx = 0; run(m, a, b, FIGHT.dodge);
  a.shootSeq++; run(m, a, b, 0.6);
  const dmgCounter = FIGHT.hp - m.fight!.f[1].hp;
  check('a dodged punch whiffs and the counter hits harder', m.fight!.f[0].hp === FIGHT.hp && dmgCounter > dmgPlain * 1.4, [dmgPlain, dmgCounter]);
}
{
  // mashing into a guard: the puncher bounces off and the guard holder lands the next clean hit
  const { m, a, b } = startFight();
  b.passHeld = true; run(m, a, b, 0.05);
  a.shootSeq++; run(m, a, b, FIGHT.windup + 0.02);
  check('a punch into a guard leaves the puncher open', m.fight!.f[0].act === 5, m.fight!.f[0].act);
  b.passHeld = false; run(m, a, b, 0.02); b.shootSeq++; run(m, a, b, FIGHT.windup + 0.05);
  check('and the guard holder punishes it', m.fight!.f[0].hp < FIGHT.hp - 8, m.fight!.f[0].hp);
}
{
  // two mashers trade: neither gets a free chain
  const { m, a, b } = startFight();
  for (let i = 0; i < 40 && m.phase === 'fight' && !m.fight!.over; i++) { a.shootSeq++; b.shootSeq++; run(m, a, b, 0.1); }
  const [x, y] = m.fight!.f;
  check('mashing against mashing trades blows', Math.abs(x.hp - y.hp) <= FIGHT.punch * 1.3, [x.hp, y.hp]);
}
// endings
{
  const { m, a, b } = startFight();
  const maxBefore = () => { const s = m.skaters[0]; return s; };
  punches(m, a, b, 30);
  check('knocking the other down wins', m.fight?.over ? m.fight.f[1].hp === 0 && m.morale[0] === FIGHT.moraleSeconds : m.morale[0] > 0, m.morale);
  check('the fight ends with a face-off', m.phase === 'fight' || m.phase === 'faceoff', [m.phase, maxBefore().id]);
  play(m, FIGHT.overSeconds + 0.1);
  check('play restarts', m.fight === null && m.phase !== 'fight', m.phase);
  check('one fight per period', (() => { offer(m); return m.offer === null; })());
}
{
  const { m, a, b } = startFight();
  punches(m, a, b, 1);
  a.shootSeq; run(m, emptyInput(), emptyInput(), FIGHT.seconds + 0.2);
  check('at the bell the healthier fighter wins', m.morale[0] === FIGHT.moraleSeconds && m.morale[1] === 0, m.morale);
}
// the boost
function speedAfter(boost: boolean) {
  const m = setup();
  if (boost) m.morale[0] = FIGHT.moraleSeconds;
  const s = m.skaters[0]; m.phase = 'play';
  Object.assign(s, { x: -18, z: 0, vx: 0, vz: 0 });
  const f = { ...emptyInput(), mx: 1, sprint: false };
  play(m, 1.2, f);
  return Math.hypot(s.vx, s.vz);
}
{
  const a = speedAfter(false), b = speedAfter(true);
  check('morale makes the team 10% faster', Math.abs(b / a - FIGHT.moraleSpeed) < 0.03, [a, b, SKATE.maxSpeed]);
  const m = setup(); m.morale[0] = 1; play(m, 1.2);
  check('morale runs out', m.morale[0] === 0, m.morale);
}
// AI fights finish on their own
{
  let ended = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const m = new Match({ seed, human: [false, false], fights: true });
    while (m.phase !== 'play') m.step(STEP, [null, null]);
    (m as unknown as { startFight(a: number, b: number): void }).startFight(0, 4);
    for (let i = 0; i < 120 * 22 && m.fight; i++) m.step(STEP, [null, null]);
    if (!m.fight) ended++;
  }
  check('AI fights end', ended === 20, ended);
}
if (failed) throw new Error(`${failed} fight check(s) failed`);
console.log('fight checks passed');
