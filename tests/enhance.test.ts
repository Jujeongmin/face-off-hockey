// Enhancement matters but does not decide a match on its own (design doc: skill still has to win)
// (node --experimental-strip-types tests/enhance.test.ts)
import { Match } from '../src/sim/match.ts';
import { STEP } from '../src/sim/constants.ts';
import { DEFAULT_LINEUPS, skillsOf } from '../src/game/roster.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };

const base = skillsOf('casual_female'), top = skillsOf('casual_female', 10);
check('top speed gains 10% at +10', Math.abs(top.speed / base.speed - 1.1) < 1e-6, top.speed / base.speed);

const GAMES = 800;    // the difference between levels is small next to a game's luck: 150 games can rank +0 above +5
function series(level: number) {
  let wins = 0, losses = 0, gf = 0, ga = 0;
  for (let seed = 1; seed <= GAMES; seed++) {
    const lv = [level, level, level, level];
    const m = new Match({ seed: seed * 6151, human: [false, false], introSeconds: 0, lineups: [{ ...DEFAULT_LINEUPS[0], levels: lv }, DEFAULT_LINEUPS[1]] });
    for (let i = 0; i < 120 * 60 * 12 && m.phase !== 'end'; i++) { m.step(STEP, [null, null]); m.events.length = 0; }
    gf += m.score[0]; ga += m.score[1];
    if (m.winner === 0) wins++; else if (m.winner === 1) losses++;
  }
  return { wins, losses, gf, ga };
}
const even = series(0), mid = series(5), full = series(10);
console.log('+0', even, '+5', mid, '+10', full);
const margin = (r: { gf: number; ga: number }) => r.gf - r.ga;
check('+5 outscores +0', margin(mid) > margin(even), [margin(mid), margin(even)]);
check('+10 is at least as dominant as +5', margin(full) >= margin(mid), [margin(full), margin(mid)]);
check('a full +10 team does not win everything', full.wins / GAMES < 0.82, full.wins / GAMES);
if (failed) throw new Error(`${failed} enhancement check(s) failed`);
console.log('enhancement checks passed');
