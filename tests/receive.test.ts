// Reception: a receiver who keeps pressing a direction still gets the pass (node --experimental-strip-types tests/receive.test.ts)
import { Match } from '../src/sim/match.ts';
import { STEP } from '../src/sim/constants.ts';
import { emptyInput } from '../src/sim/types.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };

function trial(seed: number, mx: number, mz: number, power: number) {
  const m = new Match({ seed, human: [true, false] });
  while (m.phase !== 'play') m.step(STEP, [null, null]);
  const [c, r] = m.teamSkaters(0);
  Object.assign(c, { x: -8, z: 0, vx: 0, vz: 0, face: 0 });
  Object.assign(r, { x: 6, z: 4, vx: 0, vz: 0, face: Math.PI });
  m.teamSkaters(1).forEach((s, i) => Object.assign(s, { x: -20 + i * 2, z: 11, vx: 0, vz: 0, stun: 9 }));
  Object.assign(m.puck, { owner: c.id, last: c.id, x: m.stickX(c), z: m.stickZ(c), vx: 0, vz: 0, y: 0, passTo: -1, shot: false, dead: false });
  m.controlled[0] = r.id;                                 // the player is already on the receiver, as after a pass
  m.pass(c, r, 'short', power);
  const f = emptyInput(); f.mx = mx; f.mz = mz;
  for (let i = 0; i < 240; i++) { m.clock = 50; m.step(STEP, [f, null]); if (m.puck.owner === r.id) return true; if (m.puck.owner >= 0) return false; }
  return false;
}
const rate = (mx: number, mz: number, power: number) => { let n = 0; for (let s = 1; s <= 200; s++) if (trial(s * 13, mx, mz, power)) n++; return n / 200; };
for (const [name, mx, mz] of [['standing', 0, 0], ['skating across the pass', 0, 1], ['skating ahead', 1, 0], ['skating back toward the passer', -1, 0], ['drifting a little', 0.3, 0.3]] as const) {
  const soft = rate(mx, mz, 0.3), hard = rate(mx, mz, 0.9);
  check(`pass is received ${name}`, soft >= 0.9 && hard >= 0.85, [soft, hard]);
}
if (failed) throw new Error(`${failed} reception check(s) failed`);
console.log('reception checks passed');
