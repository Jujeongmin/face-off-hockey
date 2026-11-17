// StageRun: every stage's scenario on the real sim, my team on AI (node --experimental-strip-types tests/stagerun.test.ts)
import { STAGES, stageById } from '../src/game/stages.ts';
import { StageRun } from '../src/game/stageRun.ts';
import { DEFAULT_LINEUPS } from '../src/game/roster.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };
const CAP = 120 * 60 * 20;   // 20 minutes of steps
const mine = DEFAULT_LINEUPS[0];

function play(id: string, seed: number) {
  const run = new StageRun(stageById(id)!, mine, { human: false, seed });
  let ends = 0, prev = run.done, i = 0;
  for (; i < CAP && !run.done; i++) { run.step(null); if (run.done !== prev) { ends++; prev = run.done; } }
  for (let k = 0; k < 600; k++) { run.step(null); if (run.done !== prev) ends++; prev = run.done; }   // keeps stepping after the end: nothing changes
  return { run, ends };
}

for (const s of STAGES) {
  const { run, ends } = play(s.id, 1);
  if (!run.done || ends !== 1) { check(`${s.id} ends once`, false, { done: run.done, ends }); }
}
check('every stage ends exactly once', failed === 0);

for (const s of STAGES.filter(x => x.scenario && !x.scenario.shootout)) {
  const run = new StageRun(s, mine, { human: false, seed: 2 }), sc = s.scenario!;
  const okScore = run.match.score[0] === sc.score[0] && run.match.score[1] === sc.score[1];
  const okClock = Math.abs(run.match.clock - sc.seconds) < 0.01 && Math.abs(run.timeLeft - sc.seconds) < 0.01;
  const mineOn = [0, 1, 2].filter(id => !run.match.benched.has(id)).length, theirsOn = [4, 5, 6].filter(id => !run.match.benched.has(id)).length;
  if (!okScore || !okClock || mineOn !== (sc.mySkaters ?? 3) || theirsOn !== (sc.theirSkaters ?? 3)) { check(`${s.id} set up`, false, { score: run.match.score, clock: run.match.clock, mineOn, theirsOn }); }
}
check('scenarios start with their score, clock and skater counts', failed === 0);

{
  const run = new StageRun(stageById('1-3')!, mine, { human: false, seed: 3 });
  for (let i = 0; i < 600; i++) run.step(null);
  check('short-handed: a benched skater never gets control or the puck', !run.match.benched.has(run.match.controlled[0]) && !run.match.benched.has(run.match.puck.owner));
}
{
  const run = new StageRun(stageById('1-7')!, mine, { human: false, seed: 4 });
  check('shootout stage starts in the shootout', run.match.phase === 'shootout');
}

{
  const run = new StageRun(stageById('1-1')!, mine, { human: true, seed: 5 }), m = run.match, c = m.skaters[0];
  const near = Math.min(...m.teamSkaters(1).map(o => Math.hypot(o.x - c.x, o.z - c.z)));
  check('1-1 starts with my carrier in open ice (nearest opponent 4 m+ away)', m.puck.owner === 0 && near >= 4, near.toFixed(1));
}
const rate = (id: string, n: number) => { let c = 0; for (let seed = 1; seed <= n; seed++) if (play(id, seed * 7919).run.done!.cleared) c++; return c / n; };
const r11 = rate('1-1', 200);
check('1-1 is easy: clear rate > 50 % with my team on AI', r11 > 0.5, r11);
const r210 = rate('2-10', 200);
check('2-10 needs growth: clear rate < 30 % with the free lineup', r210 < 0.3, r210);

if (failed) throw new Error(`${failed} stage run check(s) failed`);
