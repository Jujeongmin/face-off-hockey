// Shootout moves: S fakes a shot, W shoots through the five-hole, A lifts the puck; the crossbar stops a puck that
// goes over (node --experimental-strip-types tests/shootout.test.ts)
import { Match } from '../src/sim/match.ts';
import { STEP, RINK, SHOOTOUT } from '../src/sim/constants.ts';
import { emptyInput, type InputFrame, type MatchEvent, type Team } from '../src/sim/types.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type M = any;   // reaches into the shootout internals (startShootout, goalie state)

/** a shootout attempt ready to go: team 0 shoots, `human` says who is a player */
function attempt(seed: number, human: [boolean, boolean]) {
  const m: M = new Match({ seed, human });
  m.startShootout();
  while (m.shootout.shooter < 0) m.step(STEP, [null, null]);
  m.step(STEP, [emptyInput(), emptyInput()]);          // a first input frame: key presses count from the next one
  m.events.length = 0;
  const s = m.skaters[m.shootout.shooter], dir = m.attack[0];
  s.x = dir * (RINK.goalX - 7); s.z = 0;
  m.step(STEP, [emptyInput(), emptyInput()]);          // the puck comes along on the blade
  m.events.length = 0;
  return { m, s, gk: m.goalieOf(1 as Team), dir };
}
/** steps until the attempt is decided; true when it went in */
function result(m: M, f0: () => InputFrame | null, f1: () => InputFrame | null, max = 600) {
  for (let i = 0; i < max; i++) {
    m.step(STEP, [f0(), f1()]);
    const r = m.events.find((e: MatchEvent) => e.t === 'shootoutResult') as { scored: boolean } | undefined;
    m.events.length = 0;
    if (r) return r.scored;
  }
  return null;
}
/** a pass key pressed, held `hold` ticks, then let go */
function keyPress(kind: InputFrame['passKind'], hold: number) {
  let tick = 0;
  return () => { tick++; return { ...emptyInput(), passSeq: 1, passKind: kind, passHeld: tick <= hold }; };
}

// ---------------------------------------------------------------- five-hole
{
  let sliding = 0, set = 0;
  const N = 20;
  for (let seed = 1; seed <= N; seed++) {
    // goalie (a player) pushes across the crease; the shooter goes five-hole as he moves
    const a = attempt(seed, [true, true]);
    a.gk.z = -0.95;                                       // from the post, across: still moving when the puck gets there
    const goalie = () => ({ ...emptyInput(), mz: 1 });
    if (result(a.m, keyPress('through', 3), goalie)) sliding++;
    // same shot at a goalie who stays set in the middle
    const b = attempt(seed, [true, true]);
    if (result(b.m, keyPress('through', 6), () => emptyInput())) set++;
  }
  check('five-hole beats a sliding goalie more often than not', sliding >= N * 0.5, `${sliding}/${N}`);
  check('five-hole is saved by a set goalie', set <= N * 0.15, `${set}/${N}`);
}

// ---------------------------------------------------------------- lifted shot over a goalie who is down
{
  let lifted = 0, low = 0, standing = 0;
  const N = 20;
  for (let seed = 1; seed <= N; seed++) {
    for (const kind of ['lift', 'normal', 'standing'] as const) {
      const a = attempt(seed, [true, true]);
      a.gk.z = 0.45;                                       // guessed right: on the side the shot goes to
      if (kind !== 'standing') a.gk.dive = SHOOTOUT.dive + SHOOTOUT.recover;
      a.m.shoot(a.s, 0.5, 1, kind === 'normal' ? 'normal' : 'lift');
      const scored = result(a.m, () => emptyInput(), () => emptyInput());
      if (kind === 'lift' && scored) lifted++;
      if (kind === 'normal' && scored) low++;
      if (kind === 'standing' && scored) standing++;
    }
  }
  check('lifted shot goes over a goalie who is down', lifted >= N * 0.7, `${lifted}/${N}`);
  check('a low shot at the same goalie is saved', low <= N * 0.2, `${low}/${N}`);
  check('a lifted shot at a standing goalie is saved', standing <= N * 0.3, `${standing}/${N}`);
  // the A key fires it
  const a = attempt(3, [true, true]);
  const seen: MatchEvent[] = [];
  const k = keyPress('lift', 20);
  let maxY = 0;
  for (let i = 0; i < 80; i++) { a.m.step(STEP, [k(), emptyInput()]); seen.push(...a.m.events); a.m.events.length = 0; maxY = Math.max(maxY, a.m.puck.y); }
  check('A shoots a lifted puck in the shootout', seen.some(e => e.t === 'shot') && maxY > 0.6, { maxY: +maxY.toFixed(2) });
}

// ---------------------------------------------------------------- fake
{
  let first = 0, second = 0, kept = 0;
  const N = 200;
  for (let seed = 1; seed <= N; seed++) {
    const a = attempt(seed, [true, false]);
    const f = keyPress('short', 1);
    a.m.step(STEP, [f(), null]);
    if (a.gk.dive > 0) first++;
    if (a.m.puck.owner === a.s.id) kept++;
    // let him get up, then fake again
    for (let i = 0; i < 130; i++) a.m.step(STEP, [emptyInput(), null]);
    const wasDown = a.gk.dive > 0;
    a.m.step(STEP, [{ ...emptyInput(), passSeq: 2 }, null]);
    if (!wasDown && a.gk.dive > 0) second++;
  }
  check('the shooter keeps the puck on a fake', kept === N, `${kept}/${N}`);
  check('an AI goalie goes down for a first fake about a third of the time', first > N * 0.25 && first < N * 0.6, `${first}/${N}`);
  check('and for a second one less often', second < first * 0.75, `${second}/${N}`);
}

// ---------------------------------------------------------------- crossbar
{
  const go = (y: number) => {
    const m: M = new Match({ seed: 5, human: [true, true] });
    while (m.phase !== 'play') m.step(STEP, [null, null]);
    for (const s of m.skaters) if (!s.goalie) Object.assign(s, { x: -24 + s.id, z: 13, vx: 0, vz: 0 });
    const dir = m.attack[0];
    Object.assign(m.puck, { owner: -1, x: dir * (RINK.goalX - 0.5), z: 0.3, vx: dir * 12, vz: 0, y, vy: 0, shot: true });
    for (let i = 0; i < 40; i++) { m.step(STEP, [null, null]); if (m.events.some((e: MatchEvent) => e.t === 'goal')) return true; m.events.length = 0; }
    return false;
  };
  check('a puck under the bar goes in', go(0.6));
  check('a puck over the bar does not', !go(1.6));
}

// ---------------------------------------------------------------- AI shootouts still end both ways
{
  let goals = 0, tries = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const a = attempt(seed, [false, false]);
    const r = result(a.m, () => null, () => null, 1200);
    if (r !== null) { tries++; if (r) goals++; }
  }
  check('AI shootout scoring stays between 25 and 65%', goals / tries > 0.25 && goals / tries < 0.65, `${goals}/${tries}`);
}

// ---------------------------------------------------------------- balance: a player skating in against the AI goalie
// (weaving in from 12 m, the move made at 6 m). The plain shot, the five-hole and the fake-then-lift all score about
// a third to a half of the time; the lifted shot on its own is only a finisher for a goalie who is down.
{
  type Move = 'D' | 'A' | 'W' | 'SA';
  const skateIn = (seed: number, move: Move) => {
    const m: M = new Match({ seed, human: [true, false] });
    m.startShootout();
    while (m.shootout.shooter < 0) m.step(STEP, [null, null]);
    m.step(STEP, [emptyInput(), null]);
    const s = m.skaters[m.shootout.shooter], dir = m.attack[0], gx = dir * RINK.goalX, gk = m.goalieOf(1 as Team);
    s.x = gx - dir * 12; s.z = 0;
    m.step(STEP, [emptyInput(), null]); m.events.length = 0;
    let t0 = -1, seq = 0, sseq = 0, rseq = 0;
    for (let i = 0; i < 1400; i++) {
      const f: InputFrame = { ...emptyInput(), mx: dir * 0.8, mz: Math.sin(i / 40 + seed) * 0.6 };
      if (t0 < 0 && Math.abs(gx - s.x) < 6 + (move === 'SA' ? 1.5 : 0)) t0 = i;
      if (t0 >= 0) {
        const k = i - t0;
        if (move === 'D') { if (k === 0) sseq++; f.shootHeld = k < 30; if (k === 30) rseq++; }
        if (move === 'A') { if (k === 0) seq++; f.passKind = 'lift'; f.passHeld = k < 30; if (k >= 25) f.mz = gk.z > 0 ? -1 : 1; }
        if (move === 'W') { if (k === 0) seq++; f.passKind = 'through'; f.passHeld = k < 15; }
        if (move === 'SA') { if (k === 0) seq++; if (k === 36) seq++; if (k >= 36) { f.passKind = 'lift'; f.passHeld = k < 60; if (k >= 55) f.mz = gk.z > 0 ? -1 : 1; } }
      }
      f.passSeq = seq; f.shootSeq = sseq; f.releaseSeq = rseq;
      m.step(STEP, [f, null]);
      const r = m.events.find((e: MatchEvent) => e.t === 'shootoutResult') as { scored: boolean } | undefined;
      m.events.length = 0;
      if (r) return r.scored ? 1 : 0;
    }
    return 0;
  };
  const N = 150, rate: Record<string, number> = {};
  for (const mv of ['D', 'A', 'W', 'SA'] as Move[]) { let g = 0; for (let s = 1; s <= N; s++) g += skateIn(s, mv); rate[mv] = g / N; }
  const pct = Object.fromEntries(Object.entries(rate).map(([k, v]) => [k, Math.round(v * 100) + '%']));
  check('plain shot, five-hole and fake-then-lift each score 25-60%', ['D', 'W', 'SA'].every(k => rate[k] >= 0.25 && rate[k] <= 0.6), pct);
  check('a lifted shot alone scores less than a plain shot', rate.A < rate.D, pct);
}

if (failed) throw new Error(`${failed} shootout check(s) failed`);
console.log('shootout checks passed');
