// Stage data and star rules (node --experimental-strip-types tests/stages.test.ts)
import { STAGES, stageById, nextStage, isOpen, starsFor, ruleOk, HAND_RULES, CHEST_AT, foeFor, foeLevels, type Outcome } from '../src/game/stages.ts';
import { CHARACTER, DEFAULT_LINEUPS } from '../src/game/roster.ts';
import type { ModelId } from '../src/render/model-ids.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };
const out = (o: Partial<Outcome>): Outcome => ({ cleared: true, myGoals: 0, theirGoals: 0, timeLeft: 0, skillGoals: 0, oneTimerGoals: 0, ...o });

const ids = STAGES.map(s => s.id);
const want = [1, 2].flatMap(c => Array.from({ length: 10 }, (_, i) => `${c}-${i + 1}`));
check('20 stages in order', JSON.stringify(ids) === JSON.stringify(want), ids);
check('bosses at 5 and 10, full matches', STAGES.every(s => s.boss === (s.index === 5 || s.index === 10) && (s.boss ? s.scenario === null : s.scenario !== null)));
check('foes: 4 distinct real characters', STAGES.every(s => { const f = [...s.foe.skaters, s.foe.goalie]; return new Set(f).size === 4 && f.every(m => !!CHARACTER[m]); }));
for (const c of [1, 2]) {
  const ch = STAGES.filter(s => s.chapter === c), lastBoss = ch.find(s => s.index === 10)!;
  check(`chapter ${c}: last boss strongest`, ch.every(s => s === lastBoss || s.power <= lastBoss.power));
}
check('power never falls', STAGES.every((s, i) => i === 0 || s.power >= STAGES[i - 1].power), STAGES.map(s => s.power));
check('phone stars have no hand rules', STAGES.every(s => s.stars.phone.every(r => !HAND_RULES.has(r.k))));
check('1-1 is the easiest: power 0, score one, puck mine', (() => { const s = stageById('1-1')!; return s.power === 0 && s.scenario?.goal === 'scoreN' && s.scenario.need === 1 && s.scenario.puck === 'mine'; })());

const s11 = stageById('1-1')!;
check('not cleared = 0 stars', starsFor(s11, out({ cleared: false, myGoals: 5 }), 'pc') === 0);
check('cleared, both rules = 3', starsFor(s11, out({ myGoals: 1, timeLeft: 45 }), 'pc') === 3);
check('cleared, no rule = 1', starsFor(s11, out({ myGoals: 1, theirGoals: 1, timeLeft: 0 }), 'pc') === 1);
check('margin 3: 4-1 yes', ruleOk({ k: 'margin', n: 3 }, out({ myGoals: 4, theirGoals: 1 })));
check('margin 3: 3-1 no', !ruleOk({ k: 'margin', n: 3 }, out({ myGoals: 3, theirGoals: 1 })));
check('clean', ruleOk({ k: 'clean' }, out({})) && !ruleOk({ k: 'clean' }, out({ theirGoals: 1 })));

check('next stage of nothing is 1-1', nextStage({}).id === '1-1');
check('next after 1-1 is 1-2', nextStage({ '1-1': 1 }).id === '1-2');
check('all cleared: the last one', nextStage(Object.fromEntries(want.map(i => [i, 3]))).id === '2-10');
check('1-1 always open', isOpen('1-1', {}));
check('1-3 locked after only 1-1', !isOpen('1-3', { '1-1': 3 }));
check('2-1 opens after chapter 1', isOpen('2-1', Object.fromEntries(want.slice(0, 10).map(i => [i, 1]))));
check('unknown stage is not open', !isOpen('9-9', {}));
check('chests at 10 / 20 / 30', CHEST_AT.join() === '10,20,30');

// no character on both sides: a foe that I also field is swapped for another of the same grade
const mine = DEFAULT_LINEUPS[0];
for (const s of STAGES) {
  const f = foeFor(s, mine), mineIds = new Set<ModelId>([...mine.skaters, mine.goalie]), fIds = [...f.skaters, f.goalie];
  if (fIds.some(m => mineIds.has(m)) || new Set(fIds).size !== 4) { check(`foe of ${s.id} avoids my lineup`, false, fIds); break; }
}
check('foe levels in range 0..18', STAGES.every(s => foeLevels(s, foeFor(s, mine)).every(n => Number.isInteger(n) && n >= 0 && n <= 18)));

// a lineup that is exactly the 1-5 boss team: every seat must be swapped
{
  const s = STAGES.find(x => x.id === '1-5')!, f = foeFor(s, s.foe), fIds = [...f.skaters, f.goalie];
  check('foe swap when I field the boss team', fIds.every(m => ![...s.foe.skaters, s.foe.goalie].includes(m)) && new Set(fIds).size === 4, fIds);
}
if (failed) throw new Error(`${failed} stage check(s) failed`);
