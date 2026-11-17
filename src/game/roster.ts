// The player pool and a team's lineup. Pure data (no three / DOM) so the simulation, the net code and the team
// screen all read the same thing. Stats are 1..5 on the cards and map to the 0..1 skills the simulation uses.
import type { ModelId } from '../render/model-ids.ts';
import { MODEL_IDS } from '../render/model-ids.ts';
import type { SkillId } from '../sim/types.ts';

export interface Stats { spd: number; sht: number; pas: number; chk: number; hnd: number }   // 1..5
export interface Character {
  id: ModelId;
  name: string;                 // short, works in Korean and English
  role: 'all' | 'sniper' | 'playmaker' | 'enforcer' | 'speedster' | 'wall';
  grade: number;                // index in GRADES, fixed for the character (the server has the same table)
  stats: Stats;
}

// Only characters that look different from each other. The other Quaternius bodies (same mesh, another
// hairstyle) and the second GanzSe colourway stay in public/models for later skins, not as players.
export const CHARACTERS: readonly Character[] = [
  { id: 'casual_female',  name: 'Mina',   role: 'all',       grade: 0, stats: { spd: 3, sht: 3, pas: 4, chk: 2, hnd: 4 } },
  { id: 'ninja_female',   name: 'Kage',   role: 'speedster', grade: 1, stats: { spd: 5, sht: 3, pas: 2, chk: 2, hnd: 4 } },
  { id: 'worker_female',  name: 'Hana',   role: 'wall',      grade: 0, stats: { spd: 2, sht: 2, pas: 3, chk: 4, hnd: 5 } },
  { id: 'soldier_female', name: 'Ray',    role: 'sniper',    grade: 1, stats: { spd: 3, sht: 5, pas: 2, chk: 3, hnd: 3 } },
  { id: 'cyber',          name: 'Unit-7', role: 'sniper',    grade: 3, stats: { spd: 4, sht: 5, pas: 2, chk: 3, hnd: 2 } },
  { id: 'jelly',          name: 'Kurage', role: 'playmaker', grade: 4, stats: { spd: 3, sht: 2, pas: 5, chk: 1, hnd: 5 } },
  { id: 'mking',          name: 'Mking',  role: 'enforcer',  grade: 2, stats: { spd: 1, sht: 3, pas: 2, chk: 5, hnd: 4 } },
  { id: 'sword1',         name: 'Aria',   role: 'speedster', grade: 4, stats: { spd: 4, sht: 4, pas: 3, chk: 2, hnd: 4 } },
  { id: 'ganz0',          name: 'Ganz',   role: 'enforcer',  grade: 1, stats: { spd: 2, sht: 4, pas: 2, chk: 5, hnd: 2 } },
  { id: 'bg1',            name: 'Viktor', role: 'enforcer',  grade: 2, stats: { spd: 3, sht: 3, pas: 2, chk: 5, hnd: 3 } },
  { id: 'bg2',            name: 'Reyes',  role: 'sniper',    grade: 2, stats: { spd: 3, sht: 5, pas: 3, chk: 3, hnd: 2 } },
  { id: 'bg3',            name: 'Marco',  role: 'all',       grade: 1, stats: { spd: 3, sht: 3, pas: 4, chk: 3, hnd: 3 } },
  { id: 'bg4',            name: 'Dane',   role: 'wall',      grade: 1, stats: { spd: 2, sht: 2, pas: 3, chk: 4, hnd: 5 } },
  { id: 'oni',            name: 'Akane',  role: 'speedster', grade: 4, stats: { spd: 5, sht: 4, pas: 3, chk: 3, hnd: 4 } },
  { id: 'gynoid',         name: 'Vega',   role: 'sniper',    grade: 3, stats: { spd: 3, sht: 5, pas: 3, chk: 2, hnd: 4 } },
  { id: 'astra',          name: 'Astra',  role: 'playmaker', grade: 3, stats: { spd: 3, sht: 3, pas: 5, chk: 2, hnd: 4 } },
  { id: 'aking',          name: 'Rex',    role: 'enforcer',  grade: 3, stats: { spd: 2, sht: 4, pas: 3, chk: 5, hnd: 3 } },
  { id: 'valeria',        name: 'Valeria', role: 'all',      grade: 2, stats: { spd: 4, sht: 3, pas: 4, chk: 3, hnd: 3 } },
  { id: 'gknight',        name: 'Garran', role: 'wall',      grade: 2, stats: { spd: 2, sht: 2, pas: 3, chk: 5, hnd: 5 } },
  { id: 'viking',         name: 'Bjorn',  role: 'enforcer',  grade: 1, stats: { spd: 2, sht: 3, pas: 2, chk: 5, hnd: 3 } },
  { id: 'rninja',         name: 'Shade',  role: 'speedster', grade: 1, stats: { spd: 5, sht: 2, pas: 3, chk: 2, hnd: 3 } },
  { id: 'sword2',         name: 'Lyra',   role: 'sniper',    grade: 3, stats: { spd: 3, sht: 5, pas: 3, chk: 2, hnd: 3 } },
  { id: 'sword3',         name: 'Nadia',  role: 'playmaker', grade: 3, stats: { spd: 3, sht: 3, pas: 5, chk: 2, hnd: 4 } },
  { id: 'sword4',         name: 'Rin',    role: 'enforcer',  grade: 3, stats: { spd: 3, sht: 3, pas: 2, chk: 5, hnd: 3 } },
  { id: 'casual_male',    name: 'Leo',    role: 'all',       grade: 0, stats: { spd: 3, sht: 3, pas: 4, chk: 3, hnd: 3 } },
  { id: 'cowboy_male',    name: 'Cody',   role: 'speedster', grade: 0, stats: { spd: 5, sht: 3, pas: 2, chk: 2, hnd: 4 } },
  { id: 'doctor_female',  name: 'Sena',   role: 'sniper',    grade: 0, stats: { spd: 3, sht: 5, pas: 2, chk: 3, hnd: 3 } },
  { id: 'chef_male',      name: 'Pierre', role: 'playmaker', grade: 0, stats: { spd: 3, sht: 2, pas: 5, chk: 2, hnd: 4 } },
  { id: 'suit_female',    name: 'Yuri',   role: 'playmaker', grade: 0, stats: { spd: 3, sht: 3, pas: 5, chk: 2, hnd: 3 } },
  { id: 'worker_male',    name: 'Bram',   role: 'enforcer',  grade: 0, stats: { spd: 2, sht: 4, pas: 2, chk: 5, hnd: 3 } },
  { id: 'casual_bald',    name: 'Moe',    role: 'enforcer',  grade: 0, stats: { spd: 3, sht: 3, pas: 2, chk: 5, hnd: 3 } },
  { id: 'oldclassy_male', name: 'Otto',   role: 'wall',      grade: 0, stats: { spd: 2, sht: 2, pas: 3, chk: 4, hnd: 5 } },
];
export const CHARACTER = Object.fromEntries(CHARACTERS.map(c => [c.id, c])) as Record<ModelId, Character>;

const ROLE_SKILL: Record<Character['role'], SkillId> = { all: 'rush', speedster: 'dash', sniper: 'snipe', playmaker: 'laser', enforcer: 'charge', wall: 'sweep' };
/** the skill a character brings to the ice */
export const skillOfModel = (id: ModelId): SkillId => ROLE_SKILL[CHARACTER[id].role];

/**
 * Future skins: models that share a character's mesh and only change hair / outfit / colour. Not pickable as
 * players; a skin system can swap one of these in for the base character's look (stats stay the base's).
 * Quaternius bodies fit any of Mina / Kage / Hana / Ray; ganz1 is Ganz's second armour colourway.
 */
export const SKINS: Readonly<Partial<Record<ModelId, readonly ModelId[]>>> = {
  casual_female: ['casual2_female', 'casual3_female', 'suit_female'],
  ninja_female: ['casual2_female', 'casual3_female', 'suit_female'],
  worker_female: ['casual2_female', 'casual3_female', 'suit_female'],
  soldier_female: ['casual2_female', 'casual3_female', 'suit_female'],
  ganz0: ['ganz1'],
};
/** male Quaternius bodies: kept for a later male line-up / skins */
export const SPARE_MODELS: readonly ModelId[] = ['casual_male', 'casual2_male', 'casual3_male'];

/** three skaters (slots 0..2) and a goalie, all different */
export interface Lineup { skaters: [ModelId, ModelId, ModelId]; goalie: ModelId; /** power (enhancement + grade) of each seat (skaters, then goalie), set by the server for online play */ levels?: number[] }

/** everyone owns these from the start; the rest come from scouting and the transfer market */
export const FREE: readonly ModelId[] = ['casual_female', 'ninja_female', 'worker_female', 'soldier_female', 'ganz0'];
/** defaults use free characters only (a lineup the other side cannot verify falls back to these) */
export const DEFAULT_LINEUPS: readonly [Lineup, Lineup] = [
  { skaters: ['casual_female', 'ninja_female', 'ganz0'], goalie: 'worker_female' },
  { skaters: ['soldier_female', 'ninja_female', 'ganz0'], goalie: 'worker_female' },
];

/** grades, rarest last. A bonus counts like enhancement levels; odds and rolls live on the server */
export const GRADES = [
  { key: 'bronze', bonus: 0, color: '#c98a5a' }, { key: 'silver', bonus: 2, color: '#cdd8e6' }, { key: 'gold', bonus: 4, color: '#ffc42e' },
  { key: 'epic', bonus: 6, color: '#b98cff' }, { key: 'legend', bonus: 8, color: '#ff4f6d' },
] as const;
/** what a card adds to its character's stats: enhancement plus the character's grade */
export const powerOf = (c: { m: string; l: number }) => c.l + GRADES[CHARACTER[c.m as ModelId]?.grade ?? 0].bonus;

/** season tiers by rank points */
export const TIERS = [
  { key: 'bronze', min: 0, color: '#c98a5a' }, { key: 'silver', min: 1100, color: '#b9c6d3' }, { key: 'gold', min: 1300, color: '#f2c230' },
  { key: 'platinum', min: 1500, color: '#5fe0d0' }, { key: 'diamond', min: 1700, color: '#7fb6ff' }, { key: 'master', min: 1900, color: '#ff6fae' },
] as const;
export function tierOf(rp: number) {
  let i = 0; while (i + 1 < TIERS.length && rp >= TIERS[i + 1].min) i++;
  const next = TIERS[i + 1];
  return { ...TIERS[i], index: i, next: next?.min ?? null, frac: next ? (rp - TIERS[i].min) / (next.min - TIERS[i].min) : 1 };
}
/** ids that may be picked (a saved lineup with anything else is rejected) */
const POOL = new Set<string>(CHARACTERS.map(c => c.id));

const isModel = (x: unknown): x is ModelId => typeof x === 'string' && (MODEL_IDS as readonly string[]).includes(x) && POOL.has(x);

/**
 * The numbers shown on the team screen, from a card's 1..5 stat and its power (enhancement plus grade bonus).
 * No 99 cap (owner 2026-11-11): legends start around 100 and a +10 legend reaches the 110s. Display only: the match
 * uses skillsOf / goalieSkillOf.
 */
export const ratingOf = (stat: number, level = 0) => Math.round(58 + 9 * (stat - 1) + 1.5 * level);
export function overallOf(id: ModelId, level = 0) {
  const s = CHARACTER[id].stats;
  const best = [s.spd, s.sht, s.pas, s.chk, s.hnd].map(v => ratingOf(v, level)).sort((a, b) => b - a).slice(0, 3);   // what the player is good at
  return Math.round((best[0] + best[1] + best[2]) / 3);
}
/**
 * Recommended position, like a football game (owner 2026-11-11): forward (FW), defence (D) or goalie (G). Taken from
 * the role: walls (the best hands and size) keep goal, enforcers defend, snipers and speedsters attack; all-rounders
 * and playmakers defend when they can check (3+), otherwise attack. Nobody is locked to a position.
 */
export type Position = 'FW' | 'D' | 'G';
export function posOf(id: ModelId): Position {
  const c = CHARACTER[id];
  if (!c) return 'FW';
  if (c.role === 'wall') return 'G';
  if (c.role === 'enforcer') return 'D';
  if (c.role === 'sniper' || c.role === 'speedster') return 'FW';
  return c.stats.chk >= 3 ? 'D' : 'FW';
}
/** what each seat wants: skaters 1 and 2 attack, skater 3 defends, the last seat keeps goal */
export const SEAT_POS: readonly Position[] = ['FW', 'FW', 'D', 'G'];
/** a player out of position plays a little worse: 5 off the shown rating, 5% off the match skills */
export const OFF_POS_RATING = 5, OFF_POS_SKILL = 0.95;
export const offPos = (id: ModelId, seat: number) => posOf(id) !== SEAT_POS[seat];
/** a lineup from untrusted data (storage, the network); null when it is not one */
export function parseLineup(x: unknown): Lineup | null {
  const o = x as Lineup;
  if (!o || !Array.isArray(o.skaters) || o.skaters.length !== 3 || !isModel(o.goalie)) return null;
  if (!o.skaters.every(isModel)) return null;
  const ids = [...o.skaters, o.goalie];
  if (new Set(ids).size !== 4) return null;
  const lv = o.levels;
  const levels = Array.isArray(lv) && lv.length === 4 && lv.every(n => Number.isInteger(n) && n >= 0 && n <= MAX_POWER) ? [...lv] : undefined;
  return { skaters: [o.skaters[0], o.skaters[1], o.skaters[2]], goalie: o.goalie, ...(levels ? { levels } : {}) };
}

/** simulation skills from card stats (1..5 -> roughly 0.2..1) */
export interface Skills {
  speed: number;      // max speed multiplier, 0.93..1.07
  shot: number;       // 0..1: tighter shots, harder shots
  pass: number;       // 0..1: Skater.passSkill
  check: number;      // 0..1: body-check power / resistance
  hands: number;      // 0..1: Skater.handSkill (receiving, puck protection); goalie reflexes
}
const u = (v: number) => (v - 1) / 4;      // 1..5 -> 0..1
export const MAX_LEVEL = 10;
const MAX_POWER = MAX_LEVEL + GRADES[GRADES.length - 1].bonus;
/** enhancement: 0..1 of the way to +10. Ten levels add about 10% top speed and harder, tighter shots */
const lv = (level: number) => Math.min(MAX_POWER, Math.max(0, level)) / MAX_LEVEL;
export function skillsOf(id: ModelId, level = 0): Skills {
  const s = CHARACTER[id]?.stats ?? { spd: 3, sht: 3, pas: 3, chk: 3, hnd: 3 };
  const k = lv(level);
  return { speed: (0.93 + 0.14 * u(s.spd)) * (1 + 0.1 * k), shot: u(s.sht) + 0.4 * k, pass: 0.35 + 0.6 * u(s.pas) + 0.15 * k, check: u(s.chk) + 0.3 * k, hands: 0.3 + 0.65 * u(s.hnd) + 0.15 * k };
}
/** goalie: hands are reflexes, checking is size and coverage */
export function goalieSkillOf(id: ModelId, level = 0): number {
  const s = CHARACTER[id]?.stats ?? { spd: 3, sht: 3, pas: 3, chk: 3, hnd: 3 };
  return 0.45 + 0.4 * (0.7 * u(s.hnd) + 0.3 * u(s.chk)) + 0.12 * lv(level);
}
