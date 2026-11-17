// Mobile manager: a tactic has to change how the AI team plays, and none may simply be the best choice
// (node --experimental-strip-types tests/manager.test.ts)
import { Match } from '../src/sim/match.ts';
import { STEP } from '../src/sim/constants.ts';
import type { Tactic } from '../src/sim/types.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };

const GAMES = 800;    // a tactic's effect is small next to a game's luck: 150 games can rank them wrongly
/** team 0 plays `tactic` against a balanced team 1, from both kick-off sides' worth of seeds */
function series(tactic: Tactic) {
  const r = { shotsFor: 0, shotsAgainst: 0, goalsFor: 0, goalsAgainst: 0, wins: 0, losses: 0 };
  for (let seed = 1; seed <= GAMES; seed++) {
    const m = new Match({ seed: seed * 7919, human: [false, false], introSeconds: 0 });
    m.tactic[0] = tactic;
    for (let i = 0; i < 120 * 60 * 12 && m.phase !== 'end'; i++) { m.step(STEP, [null, null]); m.events.length = 0; }
    r.shotsFor += m.stats.shots[0]; r.shotsAgainst += m.stats.shots[1];
    r.goalsFor += m.score[0]; r.goalsAgainst += m.score[1];
    if (m.winner === 0) r.wins++; else if (m.winner === 1) r.losses++;
  }
  return r;
}

const base = series('balanced'), att = series('attack'), def = series('defend');
console.log('balanced', base); console.log('attack  ', att); console.log('defend  ', def);
check('attack scores more than balanced', att.goalsFor > base.goalsFor * 1.1, [att.goalsFor, base.goalsFor]);
check('attack concedes more than balanced', att.goalsAgainst > base.goalsAgainst * 1.1, [att.goalsAgainst, base.goalsAgainst]);
check('defend concedes less than balanced', def.goalsAgainst < base.goalsAgainst * 0.9, [def.goalsAgainst, base.goalsAgainst]);
check('defend scores less than balanced', def.goalsFor < base.goalsFor * 0.9, [def.goalsFor, base.goalsFor]);
for (const [name, r] of [['attack', att], ['defend', def]] as const) check(`${name} neither wins nor throws the game`, r.wins / GAMES < 0.65 && r.wins / GAMES > 0.35, r.wins);
if (failed) throw new Error(`${failed} manager check(s) failed`);
console.log('manager checks passed');
