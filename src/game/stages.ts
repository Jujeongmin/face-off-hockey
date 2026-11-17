// Stages: chapters of 10, short scenarios on the real rink and a boss match at 5 and 10, three stars each.
// Pure data and rules (no DOM): the run is src/game/stageRun.ts, the screen src/game/stageScreen.ts.
// The server mirrors the stage ids, boss flags and minimum seconds in `STAGE_RULES` (server/src/server.ts): keep both in step.
import { CHARACTERS, CHARACTER, GRADES, MAX_LEVEL, type Lineup } from './roster.ts';
import type { ModelId } from '../render/model-ids.ts';
import type { Key } from '../i18n.ts';

export type Platform = 'pc' | 'phone';
export type StarRule =
  | { k: 'win' } | { k: 'margin'; n: number } | { k: 'clean' } | { k: 'timeLeft'; s: number }
  | { k: 'skillGoal' } | { k: 'oneTimer' } | { k: 'goals'; n: number };
/** rules that need hands on the keys: never asked of a phone (manager) player */
export const HAND_RULES: ReadonlySet<StarRule['k']> = new Set(['skillGoal', 'oneTimer']);

export interface Scenario {
  seconds: number;                   // the stage clock
  score: [number, number];           // starting score, me first
  mySkaters?: 1 | 2 | 3;             // short-handed when < 3
  theirSkaters?: 1 | 2 | 3;
  puck: 'mine' | 'theirs' | 'faceoff';
  /** win = lead at the buzzer; scoreN = score `need` goals; hold = concede none; next = the first goal decides */
  goal: 'win' | 'scoreN' | 'hold' | 'next';
  need?: number;
  shootout?: number;                 // > 0: a shootout of this many rounds (no skating play)
}
export interface Stage {
  id: string;
  chapter: number; index: number;
  boss: boolean;
  name: Key;
  /** the opponent's enhancement level per seat (0..10); each card's grade bonus is added on top (foeLevels) */
  power: number;
  foe: Lineup;
  scenario: Scenario | null;         // null = a full match (boss)
  stars: { pc: [StarRule, StarRule]; phone: [StarRule, StarRule] };   // star 1 is clearing the stage
}
export interface Outcome { cleared: boolean; myGoals: number; theirGoals: number; timeLeft: number; skillGoals: number; oneTimerGoals: number }

const L = (a: ModelId, b: ModelId, c: ModelId, g: ModelId): Lineup => ({ skaters: [a, b, c], goalie: g });
const R = {
  win: { k: 'win' } as StarRule, clean: { k: 'clean' } as StarRule, skill: { k: 'skillGoal' } as StarRule, one: { k: 'oneTimer' } as StarRule,
  margin: (n: number): StarRule => ({ k: 'margin', n }), time: (s: number): StarRule => ({ k: 'timeLeft', s }), goals: (n: number): StarRule => ({ k: 'goals', n }),
};
type Def = [power: number, foe: Lineup, scenario: Scenario | null, pc: [StarRule, StarRule], phone: [StarRule, StarRule]];

// bronze teams early, silver mid chapter 1, gold / epic bosses; chapter 2 climbs to a legend boss
const BRONZE = L('casual_male', 'cowboy_male', 'worker_male', 'oldclassy_male');
const BRONZE2 = L('doctor_female', 'chef_male', 'casual_bald', 'oldclassy_male');
const SILVER = L('rninja', 'bg3', 'viking', 'bg4');
const GOLD = L('valeria', 'bg2', 'mking', 'gknight');
const EPIC = L('gynoid', 'astra', 'aking', 'gknight');
const EPIC2 = L('sword2', 'cyber', 'sword4', 'bg4');
const LEGEND = L('oni', 'jelly', 'aking', 'gknight');

const DEFS: Def[] = [
  // chapter 1
  [0, BRONZE, { seconds: 60, score: [0, 0], theirSkaters: 1, puck: 'mine', goal: 'scoreN', need: 1 }, [R.time(40), R.clean], [R.time(30), R.clean]],
  [1, BRONZE2, { seconds: 60, score: [0, 1], puck: 'mine', goal: 'win' }, [R.margin(2), R.skill], [R.margin(2), R.clean]],
  [1, BRONZE, { seconds: 45, score: [1, 0], mySkaters: 2, puck: 'theirs', goal: 'hold' }, [R.goals(1), R.margin(2)], [R.goals(1), R.margin(2)]],
  [2, SILVER, { seconds: 75, score: [0, 0], puck: 'faceoff', goal: 'scoreN', need: 2 }, [R.one, R.time(20)], [R.clean, R.time(15)]],
  [3, GOLD, null, [R.margin(2), R.clean], [R.margin(2), R.clean]],
  [3, SILVER, { seconds: 60, score: [2, 2], puck: 'faceoff', goal: 'next' }, [R.time(40), R.skill], [R.time(30), R.goals(1)]],
  [4, SILVER, { seconds: 60, score: [0, 0], puck: 'faceoff', goal: 'win', shootout: 3 }, [R.clean, R.margin(2)], [R.clean, R.margin(2)]],
  [4, GOLD, { seconds: 80, score: [0, 0], theirSkaters: 2, puck: 'mine', goal: 'scoreN', need: 2 }, [R.time(20), R.one], [R.time(15), R.clean]],
  [5, GOLD, { seconds: 60, score: [2, 0], puck: 'theirs', goal: 'win' }, [R.clean, R.margin(3)], [R.clean, R.margin(3)]],
  [6, EPIC, null, [R.margin(2), R.goals(4)], [R.margin(2), R.goals(3)]],
  // chapter 2
  [6, GOLD, { seconds: 75, score: [0, 1], puck: 'mine', goal: 'win' }, [R.margin(2), R.skill], [R.margin(2), R.clean]],
  [6, GOLD, { seconds: 60, score: [1, 0], mySkaters: 2, puck: 'theirs', goal: 'hold' }, [R.goals(1), R.margin(2)], [R.goals(1), R.margin(2)]],
  [7, EPIC, { seconds: 100, score: [0, 0], puck: 'faceoff', goal: 'scoreN', need: 3 }, [R.one, R.time(15)], [R.clean, R.time(10)]],
  [7, EPIC, { seconds: 60, score: [3, 3], mySkaters: 2, puck: 'faceoff', goal: 'next' }, [R.time(30), R.skill], [R.time(20), R.goals(1)]],
  [8, EPIC2, null, [R.margin(2), R.clean], [R.margin(2), R.clean]],
  [8, EPIC, { seconds: 60, score: [0, 0], puck: 'faceoff', goal: 'win', shootout: 5 }, [R.clean, R.margin(3)], [R.clean, R.margin(2)]],
  [9, EPIC2, { seconds: 90, score: [1, 2], puck: 'mine', goal: 'win' }, [R.margin(2), R.skill], [R.margin(2), R.goals(4)]],
  [9, EPIC2, { seconds: 60, score: [3, 2], mySkaters: 2, puck: 'theirs', goal: 'win' }, [R.clean, R.margin(2)], [R.clean, R.margin(2)]],
  [10, EPIC2, { seconds: 50, score: [0, 0], puck: 'mine', goal: 'scoreN', need: 1 }, [R.time(15), R.one], [R.time(10), R.clean]],
  [10, LEGEND, null, [R.margin(2), R.clean], [R.margin(2), R.clean]],
];

export const STAGES: readonly Stage[] = DEFS.map(([power, foe, scenario, pc, phone], i) => {
  const chapter = Math.floor(i / 10) + 1, index = (i % 10) + 1;
  return { id: `${chapter}-${index}`, chapter, index, boss: index === 5 || index === 10, name: `st_${chapter}_${index}` as Key, power, foe, scenario, stars: { pc, phone } };
});
export const CHEST_AT = [10, 20, 30] as const;

export const stageById = (id: string) => STAGES.find(s => s.id === id);
const cleared = (stars: Record<string, number>, id: string) => (stars[id] ?? 0) > 0;
export function isOpen(id: string, stars: Record<string, number>): boolean {
  const i = STAGES.findIndex(s => s.id === id);
  return i === 0 || (i > 0 && cleared(stars, STAGES[i - 1].id));
}
/** the first stage not yet cleared; everything cleared gives the last one */
export function nextStage(stars: Record<string, number>): Stage {
  return STAGES.find(s => !cleared(stars, s.id)) ?? STAGES[STAGES.length - 1];
}
export const chapterStars = (stars: Record<string, number>, chapter: number) => STAGES.filter(s => s.chapter === chapter).reduce((n, s) => n + (stars[s.id] ?? 0), 0);

export function ruleOk(r: StarRule, o: Outcome): boolean {
  switch (r.k) {
    case 'win': return o.cleared;
    case 'margin': return o.myGoals - o.theirGoals >= r.n;
    case 'clean': return o.theirGoals === 0;
    case 'timeLeft': return o.timeLeft >= r.s;
    case 'skillGoal': return o.skillGoals > 0;
    case 'oneTimer': return o.oneTimerGoals > 0;
    case 'goals': return o.myGoals >= r.n;
  }
}
export function starsFor(stage: Stage, o: Outcome, p: Platform): number {
  if (!o.cleared) return 0;
  return 1 + stage.stars[p].filter(r => ruleOk(r, o)).length;
}

/** the stage's opponents with nobody I field myself (the same model on both sides is not allowed): a clash is swapped
 *  for an unused character of the same grade and position-friendly role, else any unused one */
export function foeFor(stage: Stage, mine: Lineup): Lineup {
  const taken = new Set<ModelId>([...mine.skaters, mine.goalie]);
  const seats = [...stage.foe.skaters, stage.foe.goalie];
  for (const m of seats) taken.add(m);
  const out = seats.map(m => {
    if (![...mine.skaters, mine.goalie].includes(m)) return m;
    const c = CHARACTER[m];
    const pick = CHARACTERS.find(x => !taken.has(x.id) && x.grade === c.grade && x.role === c.role)
      ?? CHARACTERS.find(x => !taken.has(x.id) && x.grade === c.grade)
      ?? CHARACTERS.find(x => !taken.has(x.id))!;
    taken.add(pick.id);
    return pick.id;
  });
  return L(out[0], out[1], out[2], out[3]);
}
/** per-seat power for the sim: the stage's level plus each card's grade bonus (the same scale as a player's cards) */
export function foeLevels(stage: Stage, foe: Lineup): number[] {
  const max = MAX_LEVEL + GRADES[GRADES.length - 1].bonus;
  return [...foe.skaters, foe.goalie].map(m => Math.min(max, stage.power + GRADES[CHARACTER[m].grade].bonus));
}
