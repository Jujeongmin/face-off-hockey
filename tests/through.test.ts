// A through pass must leave the passer: skating flat out the same way, the passer used to catch the puck again the
// moment the 0.3 s pick-up pause ended (W "stuck to the body") (node --experimental-strip-types tests/through.test.ts)
import { Match } from '../src/sim/match.ts';
import { STEP, SKATE } from '../src/sim/constants.ts';
import { emptyInput } from '../src/sim/types.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };

function trial(seed: number, mateZ: number, sprint: boolean, mateX = -6) {
  const m = new Match({ seed, human: [true, false] });
  while (m.phase !== 'play') m.step(STEP, [null, null]);
  const [c, a] = m.teamSkaters(0), dir = m.attack[0];
  const v = sprint ? SKATE.sprintSpeed : SKATE.maxSpeed;
  Object.assign(c, { x: -10 * dir, z: 0, vx: v * dir, vz: 0, face: dir > 0 ? 0 : Math.PI });
  Object.assign(a, { x: mateX * dir, z: mateZ, vx: v * 0.8 * dir, vz: 0, face: dir > 0 ? 0 : Math.PI });
  for (const s of m.skaters) if (s.team === 1 && !s.goalie) Object.assign(s, { x: 20 * dir, z: 12, vx: 0, vz: 0, stun: 9 });
  m.teamSkaters(0)[2] && Object.assign(m.teamSkaters(0)[2], { x: -25 * dir, z: -12, vx: 0, vz: 0 });
  m.puck.owner = c.id; m.puck.last = c.id; m.controlled[0] = c.id;
  const run = { ...emptyInput(), mx: dir, mz: 0, sprint };
  m.step(STEP, [run, null]);
  m.step(STEP, [{ ...run, passSeq: 1, passKind: 'through' }, null]);          // tap W: lowest power
  let back = false;
  for (let i = 0; i < 120 * 1.2; i++) { m.step(STEP, [run, null]); if (m.puck.owner === c.id) back = true; }
  return back;
}
let n = 0, back = 0;
for (let seed = 1; seed <= 40; seed++) for (const z of [3, -3, 6]) for (const sp of [true, false]) { n++; if (trial(seed, z, sp)) back++; }
let n2 = 0, back2 = 0;
for (let seed = 1; seed <= 40; seed++) for (const z of [0, 1.5, -2]) for (const sp of [true, false]) { n2++; if (trial(seed, z, sp, -13)) back2++; }
check('mate ahead: the through pass leaves the passer (a bobble may come back now and then)', back <= 2, `${back}/${n}`);
check('mate trailing behind: W still sends the puck away, not into the passer own path', back2 <= 2, `${back2}/${n2}`);   // a bobbled pass is loose: the passer may win it back, rarely
if (failed) throw new Error(`${failed} through-pass check(s) failed`);
