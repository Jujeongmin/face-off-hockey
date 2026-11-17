// Skills: what each one does, its cooldown, and that AI skaters use them too
// (node --experimental-strip-types tests/ability.test.ts)
import { Match } from '../src/sim/match.ts';
import { STEP, SKATE, SKILL } from '../src/sim/constants.ts';
import { emptyInput, type SkillId } from '../src/sim/types.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };

function setup(skill: SkillId, opts: { human?: [boolean, boolean] } = {}) {
  const m = new Match({ seed: 9, human: opts.human ?? [true, true] });
  while (m.phase !== 'play') m.step(STEP, [null, null]);
  m.skaters[0].skill = skill;
  return m;
}
function place(m: Match, id: number, x: number, z: number, face = 0) { Object.assign(m.skaters[id], { x, z, vx: 0, vz: 0, face, stun: 0, cool: 0, lunge: 0 }); }
function give(m: Match, id: number) {
  const s = m.skaters[id];
  Object.assign(m.puck, { owner: id, last: id, passTo: -1, shot: false, dead: false, vx: 0, vz: 0, y: 0, blend: 0, laser: false });
  m.puck.x = m.stickX(s); m.puck.z = m.stickZ(s);
}
function clearIce(m: Match) { [1, 2, 4, 5, 6].forEach((id, i) => place(m, id, -20 + i * 2, 11 - (i % 2) * 22)); place(m, 0, 0, 0); }

{
  const m = setup('dash'); clearIce(m);
  const used = m.useSkill(m.skaters[0], 1, 0, null);
  check('dash bursts past sprint speed', used && m.skaters[0].vx > SKATE.sprintSpeed, m.skaters[0].vx);
  check('the skill goes on cooldown', m.skaters[0].skillCd === SKILL.dash.cd);
  check('it cannot be used again during the cooldown', !m.useSkill(m.skaters[0], 1, 0, null));
  const a = emptyInput(); for (let i = 0; i < Math.round((SKILL.dash.cd + 0.1) / STEP); i++) { m.clock = 50; m.step(STEP, [a, null]); }
  check('it comes back after the cooldown', m.skaters[0].skillCd === 0, m.skaters[0].skillCd);
}
{
  const m = setup('rush'); clearIce(m);
  m.useSkill(m.skaters[0], 1, 0, null);
  const a = emptyInput(); a.mx = 1; a.sprint = true;
  for (let i = 0; i < Math.round(1.5 / STEP); i++) m.step(STEP, [a, null]);
  check('rush is faster than a sprint', m.skaters[0].vx > SKATE.sprintSpeed * m.skaters[0].speedMul * 1.15, m.skaters[0].vx);
}
{
  const m = setup('snipe'); clearIce(m); place(m, 0, 12, 0); give(m, 0);
  const shots = m.stats.shots[0];
  m.useSkill(m.skaters[0], 1, 0, 1);
  check('snipe shoots at once with the puck', m.stats.shots[0] === shots + 1 && m.puck.owner === -1, m.stats.shots[0]);
  check('at more than full charge speed', Math.hypot(m.puck.vx, m.puck.vz) > 33 * (0.94 + 0.12 * m.skaters[0].shotSkill), Math.hypot(m.puck.vx, m.puck.vz));
  const n = setup('snipe'); clearIce(n);
  n.useSkill(n.skaters[0], 1, 0, null);
  check('without the puck it stays armed', n.skaters[0].skillT === SKILL.snipe.armed && n.stats.shots[0] === 0);
}
{
  const m = setup('laser'); clearIce(m); place(m, 0, -6, 0); place(m, 1, 6, 0, Math.PI); place(m, 4, 0, 0.05, Math.PI); give(m, 0);
  m.useSkill(m.skaters[0], 1, 0, null);
  check('laser passes at once and hands over control', m.puck.laser && m.controlled[0] === 1, m.controlled);
  let rival = false, got = false;
  for (let i = 0; i < 180 && !got; i++) { m.clock = 50; m.step(STEP, [emptyInput(), null]); if (m.puck.owner === 4) rival = true; if (m.puck.owner === 1) got = true; }
  check('a rival on the lane cannot pick it off', !rival && got, m.puck.owner);
}
{
  const m = setup('charge'); clearIce(m); place(m, 4, 2.4, 0, 0); m.skaters[4].skill = 'none';
  m.useSkill(m.skaters[0], 1, 0, null);
  for (let i = 0; i < 60; i++) { m.clock = 50; m.step(STEP, [emptyInput(), null]); if (m.skaters[4].stun > 0) break; }
  check('shoulder charge knocks the target down', m.skaters[4].stun > 0.45, m.skaters[4].stun);
  const w = setup('charge'); clearIce(w);
  w.useSkill(w.skaters[0], 1, 0, null);
  let down = false;
  for (let i = 0; i < 70; i++) { w.clock = 50; w.step(STEP, [emptyInput(), null]); if (w.skaters[0].stun > 0) down = true; }
  check('a whiffed charge does not stagger the user', !down);
}
{
  const m = setup('sweep'); clearIce(m); place(m, 4, 2, 0, Math.PI); give(m, 4);
  m.useSkill(m.skaters[0], 1, 0, null);
  check('sweep staggers a nearby carrier and frees the puck', m.skaters[4].stun > 0 && m.puck.owner === -1, m.puck.owner);
}
{
  const m = setup('dash'); clearIce(m); const a = emptyInput(), b = emptyInput();
  m.step(STEP, [a, b]); a.mx = 1; a.skillSeq = 1; m.step(STEP, [a, b]);
  check('a completed command reaches the controlled skater', m.skaters[0].skillCd > 0, m.skaters[0].skillCd);
  m.skaters[0].skillCd = 0; const before = m.events.length; m.step(STEP, [a, b]);
  check('a press is not repeated by later frames', m.skaters[0].skillCd === 0 && m.events.length >= before);
}
{
  const m = new Match({ seed: 3, human: [false, false] });
  m.skaters[0].skill = 'rush';
  const used = new Set<string>();
  for (let i = 0; i < Math.round(60 / STEP) && m.phase !== 'end'; i++) { m.step(STEP, [null, null]); for (const e of m.events) if (e.t === 'skill') used.add(e.kind); m.events.length = 0; }
  check('AI skaters use their skills', used.size >= 2, [...used]);
}

{
  // goals: the team attacking that end scores in every period, and the puck ends up inside the net
  const m = new Match({ seed: 2, human: [true, true] });
  while (m.phase !== 'play') m.step(STEP, [null, null]);
  m.attack = [-1, 1];                                     // second period: ends changed
  Object.assign(m.puck, { x: -23.4, z: 0.3, y: 0, vx: -28, vz: 0, vy: 0, owner: -1, last: 0, dead: false, shot: true });
  m.goalieOf(0).z = 0.9; m.goalieOf(1).z = 0.9;
  let deepest = 0, stepsInGoal = 0;
  for (let i = 0; i < 180; i++) { m.clock = 50; m.step(STEP, [null, null]); if ((m.phase as string) === 'goal') { stepsInGoal++; deepest = Math.min(deepest, m.puck.x); } }
  check('the team attacking that end gets the goal', m.score[0] === 1 && m.score[1] === 0, m.score);
  check('the puck travels on into the net', stepsInGoal > 0 && deepest < -24.4 - 0.7, deepest);
  check('and comes to rest on the ice inside it', m.puck.y === 0 && Math.abs(m.puck.x) > 24.4 && Math.hypot(m.puck.vx, m.puck.vz) < 1, [m.puck.x, m.puck.y]);
}
if (failed) throw new Error(`${failed} ability checks failed`);
console.log('ability checks passed');
