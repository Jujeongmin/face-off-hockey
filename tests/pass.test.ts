// Pass assist checks: rough stick direction picks the right teammate, leads a moving receiver,
// and a defender in the lane makes it fail sometimes (node --experimental-strip-types tests/pass.test.ts)
import { Match } from '../src/sim/match.ts';
import { STEP } from '../src/sim/constants.ts';
import { emptyInput } from '../src/sim/types.ts';

type Setup = { defenderInLane: boolean; dir: [number, number]; kind?: 'short' | 'through' | 'lift' };

function trial(seed: number, o: Setup) {
  const m = new Match({ seed, human: [true, false] });
  // skip the face-off
  while (m.phase !== 'play') m.step(STEP, [null, null]);
  const [c, a, b] = m.teamSkaters(0);
  const opp = m.teamSkaters(1);
  // carrier at centre, A ahead-left moving forward, B behind-right standing
  Object.assign(c, { x: 0, z: 0, vx: 0, vz: 0, face: 0 });
  Object.assign(a, { x: 9, z: 6, vx: 5, vz: 0, face: 0, tx: 30, tz: 6 });
  Object.assign(b, { x: -6, z: -7, vx: 0, vz: 0, face: 0 });
  opp.forEach((s, i) => Object.assign(s, { x: -20 + i * 2, z: 11, vx: 0, vz: 0, stun: 5 }));     // out of play
  if (o.defenderInLane) Object.assign(opp[0], { x: 6, z: 3.6, vx: 0, vz: 0, stun: 0 });
  m.puck.owner = c.id; m.puck.last = c.id; m.controlled[0] = c.id;
  const f = emptyInput();
  m.step(STEP, [f, null]);
  const press = { ...f, mx: o.dir[0], mz: o.dir[1], passSeq: 1, passKind: o.kind ?? 'short' };
  m.step(STEP, [press, null]);
  const target = m.puck.passTo;
  const ctl = m.controlled[0];
  const idle = { ...press, mx: 0, mz: 0 };
  for (let i = 0; i < 240; i++) {
    m.step(STEP, [idle, null]);
    if (m.puck.owner >= 0) break;
  }
  return { target, ctlFollows: ctl === target, receivedBy: m.puck.owner, a: a.id, b: b.id, opp: opp[0].id };
}

function run(name: string, o: Setup, n = 200) {
  let toA = 0, toB = 0, ok = 0, cut = 0, loose = 0, follow = 0;
  for (let i = 0; i < n; i++) {
    const r = trial(500 + i, o);
    if (r.target === r.a) toA++; if (r.target === r.b) toB++;
    if (r.ctlFollows) follow++;
    if (r.receivedBy === r.target) ok++; else if (r.receivedBy === r.opp) cut++; else loose++;
  }
  console.log(name.padEnd(34), JSON.stringify({ pickedA: toA, pickedB: toB, completed: `${Math.round(ok / n * 100)}%`, intercepted: `${Math.round(cut / n * 100)}%`, loose: `${Math.round(loose / n * 100)}%`, controlFollows: `${Math.round(follow / n * 100)}%` }));
  return { toA, toB, ok: ok / n, cut: cut / n };
}

const open = run('open lane, rough dir toward A', { defenderInLane: false, dir: [0.7, 0.7] });
const back = run('open lane, rough dir toward B', { defenderInLane: false, dir: [-0.6, -0.8] });
const blocked = run('defender in lane toward A', { defenderInLane: true, dir: [0.7, 0.7] });
const lifted = run('defender in lane, saucer (A)', { defenderInLane: true, dir: [0.7, 0.7], kind: 'lift' });
const fails: string[] = [];
if (open.toA < 190) fails.push('rough direction should pick A');
if (back.toB < 190) fails.push('rough direction should pick B');
if (open.ok < 0.85) fails.push('open passes should mostly connect');
if (blocked.cut < 0.15) fails.push('a defender in the lane should cut some passes');
if (lifted.cut >= blocked.cut) fails.push('saucer passes should beat the stick more often');
if (fails.length) throw new Error('FAIL: ' + fails.join('; '));
console.log('pass assist checks passed');
