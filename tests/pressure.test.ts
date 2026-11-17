// AI pressure on a carrier who holds the puck still: it used to be safe for good behind his own net (0 of 30) because
// the AI's goal-side target there was inside the net; later the presser waited in body contact, so its lunges died
// (corner 11 of 30) - it now waits just outside contact (PRESS_GAP) and on the open-ice side in a corner (node --experimental-strip-types tests/pressure.test.ts)
import { Match } from '../src/sim/match.ts';
import { STEP, RINK } from '../src/sim/constants.ts';
import { emptyInput } from '../src/sim/types.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };
function taken(fx: number, z: number, N = 30) {
  let lost = 0;
  for (let seed = 1; seed <= N; seed++) {
    const m = new Match({ seed, human: [true, false] });
    while (m.phase !== 'play') m.step(STEP, [null, null]);
    const dir = m.attack[0], c = m.teamSkaters(0)[0];
    Object.assign(c, { x: -dir * (RINK.goalX + 1.6) * fx, z, vx: 0, vz: 0 }); m.puck.owner = c.id; m.puck.last = c.id; m.controlled[0] = c.id;
    for (let i = 0; i < 120 * 8; i++) { m.step(STEP, [emptyInput(), null]); m.events.length = 0; if (m.puck.owner !== c.id) { lost++; break; } }
  }
  return lost;
}
const behind = taken(1, 0), open = taken(0.55, 2);
// a corner: on the rounded boards beside his own goal line (the goal-side spot there is behind the boards)
const corner = taken((RINK.goalX - 1) / (RINK.goalX + 1.6), RINK.halfWidth - 1.2), corner2 = taken((RINK.goalX - 1) / (RINK.goalX + 1.6), -(RINK.halfWidth - 1.2));
check('behind his own net the AI wins the puck back within 8 s in at least 24 of 30', behind >= 24, `${behind}/30`);
check('in open ice it does in at least 24 of 30', open >= 24, `${open}/30`);
check('in either corner it does in at least 24 of 30', corner >= 24 && corner2 >= 24, `${corner}/30, ${corner2}/30`);
// a drill with every skater on one side benched (the tutorial does this): the other side's AI must still think
{
  const m = new Match({ seed: 3, human: [true, false] });
  while (m.phase !== 'play') m.step(STEP, [null, null]);
  for (const s of m.skaters) if (s.team === 0 && !s.goalie) m.benched.add(s.id);
  let error = '';
  try { for (let i = 0; i < 120 * 5; i++) { m.step(STEP, [emptyInput(), null]); m.events.length = 0; } } catch (e) { error = String(e); }
  check('the AI keeps playing when every opposing skater is benched', !error, error);
}
if (failed) throw new Error(`${failed} pressure check(s) failed`);
