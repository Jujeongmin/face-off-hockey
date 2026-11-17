/**
 * FACE-OFF! — Verse8 Agent8 GameServer: 1v1 matchmaking, friend rooms by code, packet relay, records.
 *
 * Roles
 *  - The two clients play host-authoritative: the host (team 0, first to join) runs the match simulation.
 *    Each client publishes its latest packet with `st` (throttled stream) → stored in its room user state → the
 *    SDK pushes it to the other client. The server never simulates (no timers, 200 ms tick).
 *  - Records are only written when both players report the same result, or when one player is gone
 *    (forfeit) — one report is enough then.
 *
 * Runtime limits (Agent8): new instance per request, no timers, every method is a public endpoint.
 * Read-modify-write goes through $lock.
 */

const ROOM_PREFIX = 'fo-';
const MIRROR = (id: string) => `room_${id}`;
const CODE_KEY = (code: string) => `code_${code}`;
const MIRROR_TTL_MS = 10 * 60 * 1000;
const MAX_PACKET = 6000;              // chars of JSON
const CHAT_MAX = 60;                 // characters in one chat line
const NO_ROOM = '__no_room__';

interface Player { account: string; nick: string; team: 0 | 1; at: number; lineup?: Lineup }
/** 4 model ids; the clients validate against their roster, the server only keeps it small and well-formed */
interface Lineup { skaters: string[]; goalie: string; levels?: number[] }
function cleanLineup(v: unknown): Lineup | undefined {
  const o = v as Lineup;
  if (!o || !Array.isArray(o.skaters) || o.skaters.length !== 3 || typeof o.goalie !== 'string') return undefined;
  const ok = (x: unknown) => typeof x === 'string' && /^[a-z0-9_]{1,24}$/.test(x);
  if (!o.skaters.every(ok) || !ok(o.goalie)) return undefined;
  return { skaters: [...o.skaters] as string[], goalie: o.goalie };
}
interface Report { winner: number; s0: number; s1: number; forfeit: boolean }
interface RoomState { players: Player[]; mode: 'quick' | 'room'; code: string; status: 'waiting' | 'playing' | 'done'; reports: Record<string, Report>; recorded: boolean; left: string[] }
interface Mirror { n: number; mode: 'quick' | 'room'; status: RoomState['status']; t: number }
interface Rec { w: number; l: number; d: number }
/** season progress, kept in the global user state next to rec */
/** one player card. u: unique within the account; b: bound (starter cards cannot be sold). The grade belongs to the character (m) */
interface Card { u: number; m: string; l: number; b?: 1; dup?: 1 }   // dup only on a scout's reply: no card was added, the character gained material
interface Profile { nick: string; lineup?: Lineup; premPity: number; mats: Record<string, number>; rec: Rec; rp: number; coins: number; season: string; cards: Card[]; nextU: number; gems: number; tickets: number; packs: Record<string, number>; purchases: string[]; adDay: string; ads: Record<string, number>; adIds: string[]; adAt: number; pity: number; stages: Record<string, number>; chests: string[]; stageDay: string; stageReplays: number }

// Ranked points and coins (only quick matches are ranked; friend rooms count W/L only).
const START_RP = 1000;
const FREE = ['casual_female', 'ninja_female', 'worker_female', 'soldier_female', 'ganz0'];   // everyone starts with these
// A character has one grade for good, by how it looks: 0 bronze, 1 silver, 2 gold, 3 epic, 4 legend. New characters only come from scouting and the market.
const GRADE_OF: Record<string, number> = { casual_female: 0, worker_female: 0, casual_male: 0, cowboy_male: 0, doctor_female: 0, chef_male: 0, suit_female: 0, worker_male: 0, casual_bald: 0, oldclassy_male: 0, ninja_female: 1, soldier_female: 1, ganz0: 1, bg3: 1, bg4: 1, viking: 1, rninja: 1, mking: 2, bg1: 2, bg2: 2, valeria: 2, gknight: 2, cyber: 3, sword2: 3, sword3: 3, sword4: 3, gynoid: 3, astra: 3, aking: 3, jelly: 4, oni: 4, sword1: 4 };
const MODELS = Object.keys(GRADE_OF);
const gradeOf = (m: string) => GRADE_OF[m] ?? 0;
const MAX_CARDS = 60;

// Enhancement: index = current level (trying for level + 1). Failure keeps the level up to +5; trying for +6 to +10
// costs a level unless a protection ticket is spent (only consumed when it actually saves the card).
const ENHANCE_RATE = [0.95, 0.9, 0.8, 0.7, 0.6, 0.45, 0.35, 0.25, 0.15, 0.1];
const ENHANCE_COST = [50, 80, 120, 180, 260, 360, 500, 700, 950, 1300];
const MAX_LEVEL = ENHANCE_RATE.length;
const DROP_FROM = 6;
// A character you already have comes back as enhancement material for that character: each one spent adds to one attempt's success rate
const MAT_STEP = 0.05, MAT_MAX = 6, MAT_CAP = 999;
const SCOUT_COST = 300;                                                                         // coins: one tradable card: roll a grade, then any character of that grade
// Grade odds, shown to players before they pay. A bonus counts like enhancement levels.
const GRADE_ODDS = [0.694, 0.24, 0.055, 0.01, 0.001];                                           // bronze, silver, gold, epic, legend
const GRADE_BONUS = [0, 2, 4, 6, 8];
const GRADE_PRICE = [1, 3, 15, 60, 400];                                                        // market price multiplier
const PITY_SCOUTS = 30, PITY_GRADE = 2;                                                         // every 30th scout without one is gold or better

// Transfer market: price band by level, the seller receives the price minus the fee.
const MARKET = 'market';
/** season ranking: one item per account per season (id `<season>_<account>`), written when a ranked result is recorded */
// One collection per season (ranking_2026-11): the board is read with a single-field order (rp) and the rank with a
// single-field count, which Firestore indexes by itself. Filtering one shared collection by season while ordering by
// rp needs a composite index the Verse8 backend does not have ("FAILED_PRECONDITION: The query requires an index").
const RANKING = 'ranking';                                  // the old shared collection: read once to carry this season over
const rankColl = (season: string) => `ranking_${season.replace(/[^0-9A-Za-z_-]/g, '_')}`;
interface RankEntry { season: string; account: string; nick: string; rp: number; w: number; l: number; d: number; at: number; lead?: string }   // lead: the first skater of the lineup, shown on the podium
const rankId = (season: string, account: string) => `${season}_${account}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
/** the entry counts ranked games only (friend rooms keep their W/L on the profile, not here); kind = the result just added */
/** once per season: copy this season's entries from the old shared collection (an equality filter alone needs no composite index) */
async function carrySeason(season: string): Promise<void> {
  const flag = `rankCarried2:${season}`;               // v2: the first version marked a failed read as done
  const g = (await $global.getGlobalState()) as Record<string, unknown> | null;
  if (g && g[flag]) return;
  await $lock(`rankCarry:${season}`, async () => {
    const again = (await $global.getGlobalState()) as Record<string, unknown> | null;
    if (again && again[flag]) return;
    let olds: RankEntry[];
    try { olds = (await $global.getCollectionItems(RANKING, { filters: [{ field: 'season', operator: '==', value: season }], limit: 500 })) as unknown as RankEntry[]; }
    catch { return; }                                       // not marked: the next board read tries again
    const coll = rankColl(season);
    for (const o of olds) {
      const id = rankId(season, o.account);
      let have = false;
      try { have = !!(await $global.getCollectionItem(coll, id)); } catch { have = false; }
      if (!have) await ($global.addCollectionItem as (c: string, i: unknown, o?: unknown) => Promise<unknown>)(coll, { season, account: o.account, nick: o.nick, lead: o.lead ?? '', rp: o.rp, w: o.w, l: o.l, d: o.d, at: o.at }, { id });
    }
    await $global.updateGlobalState({ [flag]: true });
  });
}
async function writeRank(account: string, p: Profile, kind?: 'w' | 'l' | 'd'): Promise<void> {
  const id = rankId(p.season, account), coll = rankColl(p.season);
  let old: RankEntry | null = null;
  try { old = (await $global.getCollectionItem(coll, id)) as unknown as RankEntry; } catch { old = null; }
  let moved: RankEntry | null = null;
  if (!old) { try { moved = (await $global.getCollectionItem(RANKING, id)) as unknown as RankEntry; } catch { moved = null; } }   // this season's entry in the old collection
  const base = old ?? moved;
  const have = !!old;
  const e: RankEntry = { season: p.season, account, nick: p.nick || 'Player', lead: p.lineup?.skaters[0] ?? base?.lead ?? '', rp: p.rp, w: (base?.w ?? 0) + (kind === 'w' ? 1 : 0), l: (base?.l ?? 0) + (kind === 'l' ? 1 : 0), d: (base?.d ?? 0) + (kind === 'd' ? 1 : 0), at: Date.now() };
  if (have) await $global.updateCollectionItem(coll, { __id: id, ...e });
  else await ($global.addCollectionItem as (c: string, i: unknown, o?: unknown) => Promise<unknown>)(coll, e, { id });
}
const MARKET_FEE = 0.1;
const MAX_LISTINGS = 5;
function marketBand(level: number, grade = 0) { const base = Math.round(100 * Math.pow(1.55, level) * (GRADE_PRICE[grade] ?? 1)); return { min: Math.round(base * 0.5), max: base * 3 }; }
const priceKey = (m: string, l: number) => `price_${m}_${l}`;
interface Listing { __id?: string; seller: string; m: string; l: number; price: number; at: number; status: 'open' | 'sold' }

// Shop. Gems only come from VXShop products; packages have fixed contents.
const GEM_PRODUCTS: Record<string, number> = { gems_100: 100, gems_550: 550, gems_1200: 1200, gems_3900: 3900, gems_7000: 7000, gems_15000: 15000 };
// Premium scout, gems only. A ten always holds one gold or better; a legend is certain on the ceiling-th scout since the last one. The odds, guarantee and ceiling are shown before paying.
// Premium cards are bound: paid value must not be movable between accounts (Verse8 VX Shop rules forbid user-to-user transfers).
const PREMIUM_ODDS = [0.45, 0.35, 0.15, 0.045, 0.005];
const PREMIUM_ONE = 100, PREMIUM_TEN = 900, PREMIUM_CEILING = 200, LEGEND = 4;
interface Pack { gems: number; coins?: number; tickets?: number; scouts?: number; limit?: number }
const PACKS: Record<string, Pack> = {
  starter: { gems: 120, coins: 1000, tickets: 1, scouts: 1, limit: 1 },
  coins: { gems: 100, coins: 1500 },
  tickets: { gems: 150, tickets: 3 },
};
// Stages: mirrors src/game/stages.ts (ids in order, boss = index 5 and 10). Keep both in step. Rewards are paid once per
// stage (first clear), once per star, once per chest; a replay with nothing new pays a little, a few times a day.
// The match runs in the browser, so a clear is the client's word: these limits are what a fake clear can earn.
const STAGE_IDS = [1, 2].flatMap(c => Array.from({ length: 10 }, (_, i) => `${c}-${i + 1}`));
const stageBoss = (id: string) => /-(5|10)$/.test(id);
const STAGE_MIN_S = (id: string) => (stageBoss(id) ? 150 : 3);        // a boss is a three-period match
const STAGE_STAR_COINS = 30, STAGE_REPLAY_COINS = 15, STAGE_REPLAYS = 10;
function stageFirstCoins(id: string): number {
  const [c, i] = id.split('-').map(Number);
  if (stageBoss(id)) return 200 + 50 * ((c - 1) * 2 + (i === 10 ? 2 : 1));    // 250, 300, 350, 400
  return 60 + 30 * (c - 1) + 5 * i;
}
const CHESTS: Record<number, { tickets?: number; scouts?: number; mats?: number }> = { 10: { tickets: 2 }, 20: { scouts: 1, mats: 3 }, 30: { scouts: 2 } };
interface StageReward { coins: number; scouts: number; tickets: number; mats: number; cards: Card[] }
// Rewarded ads only, small coin amounts and a daily cap per placement.
const ADS: Record<string, { coins: number; daily: number }> = { 'shop-coins': { coins: 30, daily: 3 }, 'result-coins': { coins: 20, daily: 5 } };
// The sandbox has no fetch, so the ad verifier cannot be reached: claims are limited by id, daily cap and this spacing.
const AD_GAP_MS = 20000;
const dayNow = () => new Date().toISOString().slice(0, 10);
const stored = (x: unknown): x is Card => { const c = x as Card; return !!c && typeof c.u === 'number' && typeof c.m === 'string' && typeof c.l === 'number'; };
function starterCards(owned: string[]): Card[] { return [...new Set([...FREE, ...owned])].map((m, i) => ({ u: i + 1, m, l: 0, b: 1 as const })); }
function bestLevel(p: Profile, id: string): number { let best = -1; for (const c of p.cards) if (c.m === id && c.l > best) best = c.l; return best; }
function bestPower(p: Profile, id: string): number { let best = -1; for (const c of p.cards) if (c.m === id) best = Math.max(best, c.l + GRADE_BONUS[gradeOf(id)]); return best; }
function addCard(p: Profile, m: string, l: number, bound = false): Card { const c: Card = { u: p.nextU++, m, l }; if (bound) c.b = 1; p.cards.push(c); return c; }
/** the grade of the next scouted character; the scout that reaches the pity count rolls among gold and above only */
function rollGrade(p: Profile): number {
  p.pity++;
  const odds = p.pity >= PITY_SCOUTS ? GRADE_ODDS.map((o, g) => (g >= PITY_GRADE ? o : 0)) : GRADE_ODDS;
  let r = Math.random() * odds.reduce((a, b) => a + b, 0), grade = 0;
  for (; grade < odds.length - 1; grade++) { r -= odds[grade]; if (r < 0) break; }
  if (grade >= PITY_GRADE) p.pity = 0;
  return grade;
}
function scoutedModel(p: Profile): string { const grade = rollGrade(p), list = MODELS.filter(m => gradeOf(m) === grade); return list[Math.floor(Math.random() * list.length)]; }
/** the next scouted character for this account: a new card, or material when the account already has the character */
function scoutAward(p: Profile): Card {
  const m = scoutedModel(p);
  if (!p.cards.some(c => c.m === m)) return addCard(p, m, 0);
  p.mats[m] = Math.min(MAT_CAP, (p.mats[m] ?? 0) + 1);
  return { u: 0, m, l: 0, dup: 1 };
}
function premiumGrade(p: Profile, atLeastGold: boolean): number {
  p.premPity++;
  if (p.premPity >= PREMIUM_CEILING) { p.premPity = 0; return LEGEND; }
  const odds = atLeastGold ? PREMIUM_ODDS.map((o, g) => (g >= PITY_GRADE ? o : 0)) : PREMIUM_ODDS;
  let r = Math.random() * odds.reduce((a, b) => a + b, 0), grade = 0;
  for (; grade < odds.length - 1; grade++) { r -= odds[grade]; if (r < 0) break; }
  if (grade === LEGEND) p.premPity = 0;
  return grade;
}
/** one premium scout: a bound card, or material when the account already has the character */
function premiumAward(p: Profile, atLeastGold: boolean): Card {
  const grade = premiumGrade(p, atLeastGold), list = MODELS.filter(m => gradeOf(m) === grade), m = list[Math.floor(Math.random() * list.length)];
  if (!p.cards.some(c => c.m === m)) return addCard(p, m, 0, true);
  p.mats[m] = Math.min(MAT_CAP, (p.mats[m] ?? 0) + 1);
  return { u: 0, m, l: 0, dup: 1 };
}
function storedMats(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') for (const m of MODELS) { const n = (v as Record<string, unknown>)[m]; if (typeof n === 'number' && n >= 1) out[m] = Math.min(MAT_CAP, Math.floor(n)); }
  return out;
}
/** how much of the requested material this attempt can really use: what the player has, the limit, and no more than reaches 100% */
function matsFor(p: Profile, c: Card, wanted: unknown): number {
  const most = Math.ceil(Number(((1 - ENHANCE_RATE[c.l]) / MAT_STEP).toFixed(6)));
  return Math.max(0, Math.min(Math.floor(Number(wanted)) || 0, MAT_MAX, p.mats[c.m] ?? 0, most));
}
function storedStages(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') for (const id of STAGE_IDS) { const n = (v as Record<string, unknown>)[id]; if (typeof n === 'number' && n >= 1 && n <= 3) out[id] = Math.floor(n); }
  return out;
}
const chapterStarsOf = (p: Profile, c: number) => STAGE_IDS.filter(id => id.startsWith(`${c}-`)).reduce((n, id) => n + (p.stages[id] ?? 0), 0);
const replaysLeft = (p: Profile) => (p.stageDay === dayNow() ? Math.max(0, STAGE_REPLAYS - p.stageReplays) : STAGE_REPLAYS);
/** pays scouts, tickets and material into the profile; a full card list turns a scout into its coin price */
function payStage(p: Profile, coins: number, extra: { scouts?: number; tickets?: number; mats?: number }): StageReward {
  const r: StageReward = { coins, scouts: 0, tickets: extra.tickets ?? 0, mats: extra.mats ?? 0, cards: [] };
  for (let i = 0; i < (extra.scouts ?? 0); i++) {
    if (p.cards.length >= MAX_CARDS) { r.coins += SCOUT_COST; continue; }
    r.cards.push(scoutAward(p)); r.scouts++;
  }
  p.coins += r.coins; p.tickets += r.tickets;
  if (r.mats) { const m = p.lineup?.skaters[0] ?? p.cards[0]?.m; if (m) p.mats[m] = Math.min(MAT_CAP, (p.mats[m] ?? 0) + r.mats); }
  return r;
}
function seasonNow(): string { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
async function readProfile(account: string): Promise<Profile> {
  const st = ((await $global.getUserState(account)) || {}) as Partial<Profile> & { owned?: string[] };
  // accounts from before cards existed: every character they had becomes a bound +0 card
  const cards = Array.isArray(st.cards) ? st.cards.filter(stored).slice(0, MAX_CARDS + MAX_LISTINGS) : starterCards(Array.isArray(st.owned) ? st.owned.filter(x => typeof x === 'string').slice(0, 40) : []);
  const p: Profile = {
    rec: { w: 0, l: 0, d: 0, ...(st.rec || {}) },
    rp: typeof st.rp === 'number' ? st.rp : START_RP,
    coins: typeof st.coins === 'number' ? st.coins : 0,
    season: typeof st.season === 'string' ? st.season : seasonNow(),
    cards,
    nextU: typeof st.nextU === 'number' ? st.nextU : cards.reduce((n, c) => Math.max(n, c.u), 0) + 1,
    gems: typeof st.gems === 'number' ? st.gems : 0,
    tickets: typeof st.tickets === 'number' ? st.tickets : 0,
    packs: st.packs && typeof st.packs === 'object' ? st.packs : {},
    purchases: Array.isArray(st.purchases) ? st.purchases.slice(-50) : [],
    adDay: typeof st.adDay === 'string' ? st.adDay : '',
    ads: st.ads && typeof st.ads === 'object' ? st.ads : {},
    adIds: Array.isArray(st.adIds) ? st.adIds.slice(-50) : [],
    adAt: typeof st.adAt === 'number' ? st.adAt : 0,
    pity: typeof st.pity === 'number' ? st.pity : 0,
    mats: storedMats(st.mats),
    premPity: typeof st.premPity === 'number' ? st.premPity : 0,
    nick: typeof st.nick === 'string' ? cleanNick(st.nick) : 'Player',
    lineup: cleanLineup(st.lineup),                 // the team the player last picked, so every device opens with it
    stages: storedStages(st.stages),
    chests: Array.isArray(st.chests) ? st.chests.filter(x => typeof x === 'string' && /^\d:(10|20|30)$/.test(x)) : [],
    stageDay: typeof st.stageDay === 'string' ? st.stageDay : '',
    stageReplays: typeof st.stageReplays === 'number' ? st.stageReplays : 0,
  };
  if (p.season !== seasonNow()) { p.rp = START_RP + Math.floor((p.rp - START_RP) / 2); p.season = seasonNow(); }   // soft reset each month
  return p;
}
async function saveProfile(account: string, p: Profile): Promise<void> {
  await $global.updateUserState(account, { nick: p.nick, ...(p.lineup ? { lineup: p.lineup } : {}), premPity: p.premPity, mats: p.mats, rec: p.rec, rp: p.rp, coins: p.coins, season: p.season, cards: p.cards, nextU: p.nextU, gems: p.gems, tickets: p.tickets, packs: p.packs, purchases: p.purchases.slice(-50), adDay: p.adDay, ads: p.ads, adIds: p.adIds.slice(-50), adAt: p.adAt, pity: p.pity, stages: p.stages, chests: p.chests, stageDay: p.stageDay, stageReplays: p.stageReplays });
}
const allowed = (p: Profile, id: string) => bestLevel(p, id) >= 0;
const ownedOf = (p: Profile) => [...new Set(p.cards.map(c => c.m))];
const wallet = (p: Profile) => ({ coins: p.coins, gems: p.gems, tickets: p.tickets, cards: p.cards, owned: ownedOf(p), pity: p.pity, mats: p.mats, premPity: p.premPity });
/** rank points and coins for one ranked result. gf / ga = goals for / against */
function ranked(kind: 'w' | 'l' | 'd', gf: number, ga: number, left: boolean) {
  if (kind === 'w') return { rp: 20 + Math.min(10, 2 * Math.max(0, gf - ga)), coins: 40 + 5 * Math.min(5, gf) };
  if (kind === 'd') return { rp: 2, coins: 25 + 5 * Math.min(5, gf) };
  return { rp: left ? -20 : -15, coins: left ? 0 : 15 + 5 * Math.min(5, gf) };
}

function roomOf(): string | null {
  const r = $sender.roomId;
  return r && r !== NO_ROOM && r.startsWith(ROOM_PREFIX) ? r : null;
}
function newRoomId(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)];
  return ROOM_PREFIX + s;
}
function newCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)];
  return s;
}
// Same filter as src/game/profanity.ts (tests/profanity.test.ts checks the copies match)
// PROFANITY-START
const BAD_WORDS = [
  // Korean (also caught with letters, digits or symbols put between the syllables)
  '씨발', '시발', '씨바', '씨빨', '시빨', '씌발', '쓰발', '쓰벌', '씨벌', '시벌', '썅', '씹', '좆', '좃같', '존나', '졸라',
  '개새', '개색', '개섀', '새끼', '쌔끼', '병신', '븅신', '빙신', '등신', '지랄', '염병', '미친놈', '미친년', '개년', '개놈',
  '니애미', '니엄마', '느금', '엠창', '애미뒤', '애비뒤', '호로새', '섹스', '보지', '자지', '후장', '걸레년', '창녀',
  '한남충', '김치녀', '틀딱', '꺼져', '닥쳐',
  'ㅅㅂ', 'ㅆㅂ', 'ㅂㅅ', 'ㅄ', 'ㅈㄹ', 'ㅈ같', 'ㅗㅗ', 'ㅅㄲ', 'ㄲㅈ',
  // English (letters may repeat, digits / symbols stand in for letters: f4ck, $hit, fuuuck)
  'fuck', 'fck', 'fack', 'phuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'asshole', 'bastard', 'nigger', 'nigga', 'faggot',
  'retard', 'whore', 'slut', 'cock', 'penis', 'vagina', 'porn', 'nazi', 'hitler', 'motherfucker', 'wanker',
  // Japanese
  '死ね', 'しね', '氏ね', '殺す', 'ころす', 'きちがい', 'キチガイ', 'ちんこ', 'チンコ', 'まんこ', 'マンコ', 'ちんぽ', 'くそ野郎',
  'ファック', 'セックス', 'レイプ',
  // Chinese (simplified and traditional)
  '操你', '肏', '傻逼', '傻屄', '傻b', '妈的', '媽的', '他妈', '他媽', '你妈', '你媽', '婊子', '屄', '鸡巴', '雞巴', '草泥马',
  '草泥馬', '去死', '幹你', '干你娘', '王八蛋', '贱人', '賤人',
];
/** names nobody may take as a whole (staff impersonation) */
const RESERVED = ['admin', 'administrator', 'moderator', 'gm', 'verse8', 'faceoff', '운영자', '관리자', '운영진', '개발자', '公式', '運営', '管理员', '管理員'];
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g' };
const HANGUL = /[^가-힣ㄱ-ㆎ]/g;
/** letters only, lower case, look-alike digits and symbols turned into the letters they stand for */
const latinize = (s: string) => [...s.normalize('NFKC').toLowerCase()].map(c => LEET[c] ?? c).join('').replace(/[^\p{L}\p{N}]/gu, '');
/** each letter of a word may repeat (fuuuck), so a word becomes f+u+c+k+ */
const PATTERNS = BAD_WORDS.map(w => new RegExp([...latinize(w)].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '+').join(''), 'u'));
const KOREAN_WORDS = BAD_WORDS.filter(w => /[가-힣ㄱ-ㆎ]/.test(w));

/** true when the text holds a word from the list, however it is spaced, spelled with digits or stretched */
function isProfane(text: string): boolean {
  const flat = latinize(text);
  if (PATTERNS.some(p => p.test(flat))) return true;
  const korean = text.normalize('NFC').replace(HANGUL, '');               // 시1발, 시.발, 시 발
  return KOREAN_WORDS.some(w => korean.includes(w));
}
const KOREAN_RE = KOREAN_WORDS.map(w => new RegExp(w, 'u'));
/** the text with every listed word starred out, whatever was put between its letters (f.u.c.k → *******) */
function maskProfanity(text: string): string {
  const raw = [...text], hit = raw.map(() => false);
  const mark = (keep: (c: string) => string, words: RegExp[]) => {
    const flat: string[] = [], at: number[] = [];
    raw.forEach((c, i) => { for (const k of keep(c)) { flat.push(k); at.push(i); } });
    const s = flat.join('');
    for (const p of words) {
      const g = new RegExp(p.source, 'gu');
      for (let m = g.exec(s); m; m = g.exec(s)) {
        for (let i = at[m.index]; i <= at[m.index + m[0].length - 1]; i++) hit[i] = true;
        if (!m[0].length) g.lastIndex++;
      }
    }
  };
  mark(latinize, PATTERNS);
  mark(c => c.normalize('NFC').replace(HANGUL, ''), KOREAN_RE);
  return raw.map((c, i) => (hit[i] && /\S/u.test(c) ? '*' : c)).join('');
}
/** a nickname the game refuses: swearing anywhere in it, or a staff name on its own */
function isBadNick(name: string): boolean {
  return isProfane(name) || RESERVED.includes(latinize(name));
}
// PROFANITY-END
/** what other players see: swearing or a staff name becomes Player (the client refuses them before they get here) */
function cleanNick(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '';
  return s && !isBadNick(s) ? s : 'Player';
}

async function readRoom(): Promise<RoomState> {
  const st = ((await $room.getRoomState(['players', 'mode', 'code', 'status', 'reports', 'recorded', 'left'])) || {}) as Partial<RoomState>;
  return {
    players: Array.isArray(st.players) ? st.players : [],
    mode: st.mode === 'room' ? 'room' : 'quick',
    code: typeof st.code === 'string' ? st.code : '',
    status: st.status === 'playing' || st.status === 'done' ? st.status : 'waiting',
    reports: st.reports || {},
    recorded: !!st.recorded,
    left: Array.isArray(st.left) ? st.left : [],
  };
}
async function saveRoom(roomId: string, r: RoomState): Promise<void> {
  await $room.updateRoomState({ ...r }, { returnState: false });
  const m: Mirror = { n: r.players.length, mode: r.mode, status: r.status, t: Date.now() };
  await $global.updateGlobalState({ [MIRROR(roomId)]: m });
}

async function addResult(account: string, kind: 'w' | 'l' | 'd', rank: { gf: number; ga: number; left: boolean } | null, nick?: string): Promise<void> {
  await $lock(`rec:${account}`, async () => {
    const p = await readProfile(account);
    p.rec[kind]++;
    if (nick && cleanNick(nick) !== 'Player') p.nick = cleanNick(nick);   // a device with no name set must not wipe the stored one
    if (rank) {
      const g = ranked(kind, rank.gf, rank.ga, rank.left);
      p.rp = Math.max(0, p.rp + g.rp); p.coins += g.coins;
    }
    await saveProfile(account, p);
    if (rank) await writeRank(account, p, kind);
  });
}

/** both reports agree → write records once. A forfeit needs only the remaining player's report. */
async function settle(r: RoomState): Promise<void> {
  if (r.recorded || r.players.length < 2) return;
  const [a, b] = r.players;
  const ra = r.reports[a.account], rb = r.reports[b.account];
  let res: Report | null = null;
  if (ra && rb && ra.winner === rb.winner && ra.s0 === rb.s0 && ra.s1 === rb.s1) res = ra;
  else if (ra && ra.forfeit && r.left.includes(b.account)) res = ra;
  else if (rb && rb.forfeit && r.left.includes(a.account)) res = rb;
  if (!res) return;
  r.recorded = true;
  for (const p of [a, b]) {
    const kind = res.winner === -1 ? 'd' : res.winner === p.team ? 'w' : 'l';
    const gf = p.team === 0 ? res.s0 : res.s1, ga = p.team === 0 ? res.s1 : res.s0;
    await addResult(p.account, kind, r.mode === 'quick' ? { gf, ga, left: r.left.includes(p.account) } : null, p.nick);
  }
}

async function removePlayer(roomId: string, account: string): Promise<void> {
  await $lock(`room:${roomId}`, async () => {
    const r = await readRoom();
    if (!r.players.some(p => p.account === account)) return;
    if (r.status === 'waiting') r.players = r.players.filter(p => p.account !== account);
    else if (!r.left.includes(account)) r.left.push(account);
    if (r.players.length === 0 || r.left.length >= r.players.length) r.status = 'done';
    await saveRoom(roomId, r);
  });
  $room.broadcastToRoom('left', { account });
}

async function readListing(id: string): Promise<Listing | null> {
  try { return (await $global.getCollectionItem(MARKET, id)) as Listing; } catch { return null; }
}
/** Verse8's ad verifier. The sandbox has no timers, so "pending" goes back to the client, which asks again */
async function adStatus(requestId: string): Promise<'verified' | 'pending' | 'failed'> {
  const f = (globalThis as unknown as { fetch?: (u: string) => Promise<{ status: number; ok: boolean; json(): Promise<{ status?: string }> }> }).fetch;
  if (typeof f !== 'function') return 'verified';                 // no outbound HTTP (true on Verse8 today, checked live): see AD_GAP_MS
  try {
    const r = await f(`https://ads-verifier.verse8.io/ads/status?requestId=${encodeURIComponent(requestId)}`);
    if (r.status === 202) return 'pending';
    if (!r.ok) return 'failed';
    const body = await r.json();
    return body.status === 'verified' ? 'verified' : body.status === 'pending' ? 'pending' : 'failed';
  } catch { return 'failed'; }
}

export class Server {
  async ping(): Promise<number> { return Date.now(); }

  /** a waiting quick-match room with one player, or a fresh room id */
  async quickMatch(): Promise<{ roomId: string }> {
    return await $lock('qm', async () => {
      const all = ((await $global.getGlobalState()) || {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(all)) {
        const m = v as Mirror;
        if (!k.startsWith('room_') || !m || m.mode !== 'quick' || m.status !== 'waiting' || m.n !== 1 || Date.now() - m.t > MIRROR_TTL_MS) continue;
        const id = k.slice('room_'.length);
        // quickMatch returns before the creator has joined the room, so a fresh mirror counts as occupied; an old one
        // must still have someone in it (the creator closed the tab without a bye)
        if (Date.now() - m.t < 6000 || (await $global.countRoomUsers(id)) > 0) {
          // claim it so a third player does not pick the same room
          await $global.updateGlobalState({ [k]: { ...m, n: 2, t: Date.now() } });
          return { roomId: id };
        }
      }
      const id = newRoomId();
      await $global.updateGlobalState({ [MIRROR(id)]: { n: 1, mode: 'quick', status: 'waiting', t: Date.now() } as Mirror });
      return { roomId: id };
    });
  }

  /** friend room: a short code maps to a room id */
  async createRoom(): Promise<{ roomId: string; code: string }> {
    for (let i = 0; i < 6; i++) {
      const code = newCode();
      const taken = await $global.getGlobalState([CODE_KEY(code)]);
      if (taken && (taken as Record<string, unknown>)[CODE_KEY(code)]) continue;
      const id = newRoomId();
      await $global.updateGlobalState({ [CODE_KEY(code)]: { id, t: Date.now() }, [MIRROR(id)]: { n: 1, mode: 'room', status: 'waiting', t: Date.now() } as Mirror });
      return { roomId: id, code };
    }
    throw new Error('no_code');
  }
  async findRoom(code: string): Promise<{ roomId: string } | { error: string }> {
    const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const st = ((await $global.getGlobalState([CODE_KEY(c)])) || {}) as Record<string, { id: string; t: number } | undefined>;
    const e = st[CODE_KEY(c)];
    if (!e || Date.now() - e.t > MIRROR_TTL_MS) return { error: 'not_found' };
    const m = ((await $global.getGlobalState([MIRROR(e.id)])) || {})[MIRROR(e.id)] as Mirror | undefined;
    if (m && (m.n >= 2 || m.status !== 'waiting')) return { error: 'full' };
    return { roomId: e.id };
  }

  /** take a seat in the room I joined: first = team 0 (host), second = team 1. team −1 = full */
  async hello(nick: string, mode: string, code: string, lineup?: unknown): Promise<{ team: number; players: Player[] }> {
    const roomId = roomOf();
    if (!roomId) return { team: -1, players: [] };
    const account = $sender.account;
    return await $lock(`room:${roomId}`, async () => {
      const r = await readRoom();
      const mine = r.players.find(p => p.account === account);
      if (mine) return { team: mine.team, players: r.players };
      if (r.players.length >= 2 || r.status !== 'waiting') return { team: -1, players: r.players };
      if (r.players.length === 0) { r.mode = mode === 'room' ? 'room' : 'quick'; r.code = typeof code === 'string' ? code.slice(0, 8) : ''; }
      const team = (r.players.length === 0 ? 0 : 1 - r.players[0].team) as 0 | 1;
      let lu = cleanLineup(lineup);
      if (lu) {
        const prof = await readProfile(account), ids = [...lu.skaters, lu.goalie];
        if (!ids.every(id => allowed(prof, id))) lu = undefined;
        else lu = { ...lu, levels: ids.map(id => bestPower(prof, id)) };            // the client never states its own levels
      }
      let shown = cleanNick(nick);
      if (shown === 'Player') shown = (await readProfile(account)).nick;     // a device with no name set plays under the stored one
      r.players.push({ account, nick: shown, team, at: Date.now(), lineup: lu });
      if (r.players.length === 2) r.status = 'playing';
      await saveRoom(roomId, r);
      if (r.players.length === 2) $room.broadcastToRoom('start', { players: r.players });
      return { team, players: r.players };
    });
  }

  /** latest packet (snapshot or input) → my room user state, pushed to the opponent by the SDK */
  async st(pkt: unknown): Promise<void> {
    if (!roomOf() || !pkt || typeof pkt !== 'object') return;
    if (JSON.stringify(pkt).length > MAX_PACKET) return;
    await $room.updateMyState({ p: pkt }, { returnState: false });
  }

  /**
   * In-match chat: up to 60 characters, swearing starred out here (a modified client cannot get around it), at most
   * one line every 0.8 s and five in 10 s per player. Sent to both players as the room message 'chat'.
   */
  async chat(text: unknown): Promise<{ ok: boolean; text?: string; reason?: string }> {
    const roomId = roomOf();
    if (!roomId || typeof text !== 'string') return { ok: false, reason: 'room' };
    const line = text.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!line) return { ok: false, reason: 'empty' };
    const r = await readRoom(), me = r.players.find(p => p.account === $sender.account);
    if (!me) return { ok: false, reason: 'room' };
    const st = ((await $room.getRoomState(['chatAt'])) || {}) as { chatAt?: Record<string, number[]> };
    const now = Date.now(), at = (st.chatAt?.[me.account] ?? []).filter(t => now - t < 10000);
    if (at.length >= 5 || (at.length && now - at[at.length - 1] < 800)) return { ok: false, reason: 'slow' };
    await $room.updateRoomState({ chatAt: { ...(st.chatAt ?? {}), [me.account]: [...at, now] } });
    const clean = maskProfanity(line);
    $room.broadcastToRoom('chat', { team: me.team, text: clean });
    return { ok: true, text: clean };
  }

  /** leave on purpose (the SDK would otherwise wait out a 30 s grace) */
  async bye(): Promise<void> {
    const roomId = roomOf();
    if (roomId) await removePlayer(roomId, $sender.account);
  }

  async report(winner: number, s0: number, s1: number, forfeit: boolean): Promise<{ recorded: boolean }> {
    const roomId = roomOf();
    if (!roomId) return { recorded: false };
    const account = $sender.account;
    const w = winner === 0 || winner === 1 ? winner : -1;
    return await $lock(`room:${roomId}`, async () => {
      const r = await readRoom();
      if (!r.players.some(p => p.account === account)) return { recorded: false };
      r.reports[account] = { winner: w, s0: Math.max(0, Math.floor(s0) || 0), s1: Math.max(0, Math.floor(s1) || 0), forfeit: !!forfeit };
      await settle(r);
      if (r.recorded) r.status = 'done';
      await saveRoom(roomId, r);
      return { recorded: r.recorded };
    });
  }

  /** this season's top 50 by rank points, and where I stand. Account ids never leave the server */
  async leaderboard(): Promise<{ season: string; top: { nick: string; lead: string; rp: number; w: number; l: number; me: boolean }[]; mine: { rank: number; rp: number; nick: string; w: number; l: number } | null }> {
    const account = $sender.account, season = seasonNow();
    const coll = rankColl(season);
    await carrySeason(season);
    const items = (await $global.getCollectionItems(coll, { orderBy: [{ field: 'rp', direction: 'desc' }], limit: 50 })) as unknown as RankEntry[];
    const top = items.map(e => ({ nick: e.nick, lead: e.lead ?? '', rp: e.rp, w: e.w, l: e.l, me: e.account === account }));
    let mine: { rank: number; rp: number; nick: string; w: number; l: number } | null = null;
    let e: RankEntry | null = null;
    try { e = (await $global.getCollectionItem(coll, rankId(season, account))) as unknown as RankEntry; } catch { e = null; }
    if (e) {
      const above = await $global.countCollectionItems(coll, { filters: [{ field: 'rp', operator: '>', value: e.rp }] });
      mine = { rank: above + 1, rp: e.rp, nick: e.nick, w: e.w, l: e.l };
    }
    return { season, top, mine };
  }
  /** the nickname shown in the ranking (rooms take the one sent with hello) */
  async setNick(nick: unknown): Promise<{ nick: string }> {
    const account = $sender.account;
    return await $lock(`rec:${account}`, async () => {
      const p = await readProfile(account);
      p.nick = cleanNick(nick);
      await saveProfile(account, p);
      let have = false;
      try { have = !!(await $global.getCollectionItem(rankColl(p.season), rankId(p.season, account)) ?? await $global.getCollectionItem(RANKING, rankId(p.season, account))); } catch { have = false; }
      if (have) await writeRank(account, p);
      return { nick: p.nick };
    });
  }
  /** the team the player picked, kept with the account so every device opens with it (checked against the cards owned) */
  async setLineup(lineup: unknown): Promise<{ ok: boolean }> {
    const account = $sender.account;
    const lu = cleanLineup(lineup);
    if (!lu) return { ok: false };
    return await $lock(`rec:${account}`, async () => {
      const p = await readProfile(account);
      if (![...lu.skaters, lu.goalie].every(id => allowed(p, id))) return { ok: false };
      p.lineup = lu;
      await saveProfile(account, p);
      let have = false;
      try { have = !!(await $global.getCollectionItem(rankColl(p.season), rankId(p.season, account))); } catch { have = false; }
      if (have) await writeRank(account, p);        // the podium shows the new lead skater
      return { ok: true };
    });
  }
  /** my record, season rank points, wallet and cards */
  async getRecord() {
    const p = await readProfile($sender.account);
    return { ...p.rec, rp: p.rp, season: p.season, packs: p.packs, nick: p.nick, lineup: p.lineup ?? null, ...wallet(p) };
  }

  /** the rules the screens display (rates must be shown before anyone pays) */
  async getEconomy() {
    const today = await readProfile($sender.account);
    const used = today.adDay === dayNow() ? today.ads : {};
    return { rate: ENHANCE_RATE, cost: ENHANCE_COST, dropFrom: DROP_FROM, scout: SCOUT_COST, models: MODELS.length, premium: { one: PREMIUM_ONE, ten: PREMIUM_TEN, ceiling: PREMIUM_CEILING, odds: PREMIUM_ODDS }, matStep: MAT_STEP, matMax: MAT_MAX, fee: MARKET_FEE, maxListings: MAX_LISTINGS,
      bands: GRADE_PRICE.map((_, g) => ENHANCE_RATE.concat(0).map((__, l) => marketBand(l, g))), gradeOdds: GRADE_ODDS, gradeBonus: GRADE_BONUS, pityMax: PITY_SCOUTS, pityGrade: PITY_GRADE, packs: PACKS, products: GEM_PRODUCTS, ads: ADS, adsUsed: used };
  }

  /** try to raise a card one level. The server rolls; protect spends a ticket only if it stops a drop */
  async enhance(u: number, protect: boolean, mats?: number) {
    const account = $sender.account;
    return await $lock(`rec:${account}`, async () => {
      const p = await readProfile(account);
      const c = p.cards.find(x => x.u === u);
      if (!c) return { ok: false, error: 'card' };
      if (c.l >= MAX_LEVEL) return { ok: false, error: 'max' };
      const cost = ENHANCE_COST[c.l];
      if (p.coins < cost) return { ok: false, error: 'coins' };
      p.coins -= cost;
      const use = matsFor(p, c, mats);                                 // spent whether or not the attempt works
      if (use) { p.mats[c.m] -= use; if (p.mats[c.m] <= 0) delete p.mats[c.m]; }
      const target = c.l + 1, success = Math.random() < ENHANCE_RATE[c.l] + use * MAT_STEP;
      let protectedByTicket = false;
      if (success) c.l = target;
      else if (target >= DROP_FROM) {
        if (protect && p.tickets > 0) { p.tickets--; protectedByTicket = true; }
        else c.l = Math.max(0, c.l - 1);
      }
      await saveProfile(account, p);
      return { ok: true, success, level: c.l, protected: protectedByTicket, ...wallet(p) };
    });
  }

  /** stars per stage, claimed chests and today's paid replays left */
  async getStages() {
    const p = await readProfile($sender.account);
    return { stars: p.stages, chests: p.chests, replaysLeft: replaysLeft(p) };
  }

  /** a finished stage: `stars` 0 (failed) .. 3, `seconds` it took. Pays the first clear, each new star, or a capped replay */
  async clearStage(id: unknown, stars: unknown, seconds: unknown) {
    const account = $sender.account;
    return await $lock(`rec:${account}`, async () => {
      const p = await readProfile(account);
      const none = (error: string) => ({ ok: false, error, stars: p.stages, reward: { coins: 0, scouts: 0, tickets: 0, mats: 0, cards: [] }, ...wallet(p) });
      const i = typeof id === 'string' ? STAGE_IDS.indexOf(id) : -1;
      if (i < 0 || !Number.isInteger(stars) || (stars as number) < 0 || (stars as number) > 3) return none('stage');
      const sid = id as string, n = stars as number;
      if (i > 0 && !p.stages[STAGE_IDS[i - 1]]) return none('locked');
      if (!(Number(seconds) >= STAGE_MIN_S(sid))) return none('short');
      const had = p.stages[sid] ?? 0;
      let coins = 0, scouts = 0;
      if (n > had) {
        if (had === 0) { coins += stageFirstCoins(sid); if (stageBoss(sid)) scouts = 1; }
        coins += STAGE_STAR_COINS * (n - had);
        p.stages[sid] = n;
      } else if (n > 0) {
        if (p.stageDay !== dayNow()) { p.stageDay = dayNow(); p.stageReplays = 0; }
        if (p.stageReplays < STAGE_REPLAYS) { p.stageReplays++; coins = STAGE_REPLAY_COINS; }
      }
      const reward = payStage(p, coins, { scouts });
      await saveProfile(account, p);
      return { ok: true, stars: p.stages, reward, replaysLeft: replaysLeft(p), ...wallet(p) };
    });
  }

  /** a chapter chest at 10 / 20 / 30 stars, once each */
  async claimChest(chapter: unknown, at: unknown) {
    const account = $sender.account;
    return await $lock(`rec:${account}`, async () => {
      const p = await readProfile(account);
      const none = (error: string) => ({ ok: false, error, reward: { coins: 0, scouts: 0, tickets: 0, mats: 0, cards: [] }, ...wallet(p) });
      const c = Number(chapter), a = Number(at), chest = CHESTS[a];
      if (!Number.isInteger(c) || !STAGE_IDS.some(id => id.startsWith(`${c}-`))) return none('stage');
      if (!chest) return none('chest');
      const key = `${c}:${a}`;
      if (p.chests.includes(key)) return none('claimed');
      if (chapterStarsOf(p, c) < a) return none('stars');
      p.chests.push(key);
      const reward = payStage(p, 0, chest);
      await saveProfile(account, p);
      return { ok: true, chests: p.chests, reward, ...wallet(p) };
    });
  }

  /** coins for one tradable +0 card */
  async scout() {
    const account = $sender.account;
    return await $lock(`rec:${account}`, async () => {
      const p = await readProfile(account);
      if (p.cards.length >= MAX_CARDS) return { ok: false, error: 'full' };
      if (p.coins < SCOUT_COST) return { ok: false, error: 'coins' };
      p.coins -= SCOUT_COST;
      const card = scoutAward(p);
      await saveProfile(account, p);
      return { ok: true, card, ...wallet(p) };
    });
  }

  /** gems for one or ten premium scouts */
  async premiumScout(count: number) {
    const n = count === 10 ? 10 : count === 1 ? 1 : 0;
    if (!n) return { ok: false, error: 'bad' };
    const price = n === 10 ? PREMIUM_TEN : PREMIUM_ONE, account = $sender.account;
    return await $lock(`rec:${account}`, async () => {
      const p = await readProfile(account);
      if (p.cards.length + n > MAX_CARDS) return { ok: false, error: 'full' };
      if (p.gems < price) return { ok: false, error: 'gems' };
      p.gems -= price;
      const got: Card[] = [];
      let gold = false;
      for (let i = 0; i < n; i++) {
        const c = premiumAward(p, n === 10 && i === n - 1 && !gold);
        if (gradeOf(c.m) >= PITY_GRADE) gold = true;
        got.push(c);
      }
      await saveProfile(account, p);
      return { ok: true, got, ...wallet(p) };
    });
  }

  // ------------------------------------------------------------------ transfer market
  /** newest open listings; the seller stays anonymous */
  async marketList() {
    const account = $sender.account;
    const items = (await $global.getCollectionItems(MARKET, { filters: [{ field: 'status', operator: '==', value: 'open' }], limit: 100 })) as Listing[];
    const keys = [...new Set(items.map(x => priceKey(x.m, x.l)))];
    const avg = (keys.length ? ((await $global.getGlobalState(keys)) || {}) : {}) as Record<string, number>;
    return items.map(x => ({ id: x.__id as string, m: x.m, l: x.l, price: x.price, mine: x.seller === account, avg: avg[priceKey(x.m, x.l)] ?? null }));
  }

  async marketSell(u: number, price: number) {
    const account = $sender.account, cost = Math.floor(price);
    return await $lock(`rec:${account}`, async () => {
      const p = await readProfile(account);
      const i = p.cards.findIndex(x => x.u === u);
      if (i < 0) return { ok: false, error: 'card' };
      const c = p.cards[i];
      if (c.b) return { ok: false, error: 'bound' };
      const band = marketBand(c.l, gradeOf(c.m));
      if (!(cost >= band.min && cost <= band.max)) return { ok: false, error: 'price' };
      const mine = (await $global.getCollectionItems(MARKET, { filters: [{ field: 'seller', operator: '==', value: account }], limit: 20 })) as Listing[];
      if (mine.filter(x => x.status === 'open').length >= MAX_LISTINGS) return { ok: false, error: 'limit' };
      p.cards.splice(i, 1);
      await saveProfile(account, p);
      const now = Date.now();
      const id = `${String(9e13 - now).padStart(14, '0')}_${Math.floor(Math.random() * 1e6)}`;   // collections read in id order: newest first
      await $global.addCollectionItem(MARKET, { seller: account, m: c.m, l: c.l, price: cost, at: now, status: 'open' } as Listing, { id });
      return { ok: true, ...wallet(p) };
    });
  }

  async marketCancel(id: string) {
    const account = $sender.account;
    if (typeof id !== 'string') return { ok: false, error: 'gone' };
    return await $lock(`listing:${id}`, async () => {
      const it = await readListing(id);
      if (!it || it.status !== 'open' || it.seller !== account) return { ok: false, error: 'gone' };
      return await $lock(`rec:${account}`, async () => {
        const p = await readProfile(account);
        addCard(p, it.m, it.l);
        await saveProfile(account, p);
        await $global.deleteCollectionItem(MARKET, id);
        return { ok: true, ...wallet(p) };
      });
    });
  }

  /** the listing lock comes first, then only the buyer's account, so two trades can never wait on each other */
  async marketBuy(id: string) {
    const account = $sender.account;
    if (typeof id !== 'string') return { ok: false, error: 'gone' };
    return await $lock(`listing:${id}`, async () => {
      const it = await readListing(id);
      if (!it || it.status !== 'open') return { ok: false, error: 'gone' };
      if (it.seller === account) return { ok: false, error: 'mine' };
      const res = await $lock(`rec:${account}`, async () => {
        const p = await readProfile(account);
        if (p.cards.length >= MAX_CARDS) return { ok: false, error: 'full' };
        if (p.coins < it.price) return { ok: false, error: 'coins' };
        p.coins -= it.price;
        addCard(p, it.m, it.l);
        await saveProfile(account, p);
        return { ok: true, ...wallet(p) };
      });
      if (res.ok) {
        await $global.updateCollectionItem(MARKET, { __id: id, status: 'sold' });
        const key = priceKey(it.m, it.l);
        const prev = (((await $global.getGlobalState([key])) || {}) as Record<string, number>)[key];
        await $global.updateGlobalState({ [key]: typeof prev === 'number' ? Math.round(prev * 0.8 + it.price * 0.2) : it.price });
      }
      return res;
    });
  }

  /** my open listings, and pay out anything that has sold */
  async marketMine() {
    const account = $sender.account;
    const items = (await $global.getCollectionItems(MARKET, { filters: [{ field: 'seller', operator: '==', value: account }], limit: 20 })) as Listing[];
    let earned = 0;
    for (const x of items) {
      if (x.status !== 'sold') continue;
      const id = x.__id as string;
      earned += await $lock(`listing:${id}`, async () => {
        const it = await readListing(id);
        if (!it || it.status !== 'sold') return 0;
        const pay = it.price - Math.ceil(it.price * MARKET_FEE);
        await $lock(`rec:${account}`, async () => { const p = await readProfile(account); p.coins += pay; await saveProfile(account, p); });
        await $global.deleteCollectionItem(MARKET, id);
        return pay;
      });
    }
    return { earned, listings: items.filter(x => x.status === 'open').map(x => ({ id: x.__id as string, m: x.m, l: x.l, price: x.price })) };
  }

  // ------------------------------------------------------------------ shop
  async buyPack(id: string) {
    const pack = typeof id === 'string' && Object.prototype.hasOwnProperty.call(PACKS, id) ? PACKS[id] : null;
    if (!pack) return { ok: false, error: 'unknown' };
    const account = $sender.account;
    return await $lock(`rec:${account}`, async () => {
      const p = await readProfile(account);
      if (pack.limit && (p.packs[id] ?? 0) >= pack.limit) return { ok: false, error: 'limit' };
      if (p.gems < pack.gems) return { ok: false, error: 'gems' };
      if (p.cards.length + (pack.scouts ?? 0) > MAX_CARDS) return { ok: false, error: 'full' };
      p.gems -= pack.gems; p.coins += pack.coins ?? 0; p.tickets += pack.tickets ?? 0; p.packs[id] = (p.packs[id] ?? 0) + 1;
      const got: Card[] = [];
      for (let i = 0; i < (pack.scouts ?? 0); i++) got.push(scoutAward(p));
      await saveProfile(account, p);
      return { ok: true, got, packs: p.packs, ...wallet(p) };
    });
  }

  /** VXShop delivery (called by the platform, never by a client). A purchase id is only ever paid once */
  async $onItemPurchased({ account, purchaseId, productId, quantity }: { account: string; purchaseId: string; productId: string; quantity: number }) {
    const gems = GEM_PRODUCTS[productId];
    if (!gems) return { success: false };
    await $lock(`rec:${account}`, async () => {
      const p = await readProfile(account);
      if (p.purchases.includes(purchaseId)) return;
      p.purchases.push(purchaseId);
      p.gems += gems * Math.max(1, Math.floor(quantity) || 1);
      await saveProfile(account, p);
    });
    return { success: true };
  }

  /** a finished rewarded ad. Amounts and caps are the server's; a request id pays once */
  async claimAd(placement: string, requestId: string) {
    const ad = typeof placement === 'string' && Object.prototype.hasOwnProperty.call(ADS, placement) ? ADS[placement] : null;
    if (!ad || typeof requestId !== 'string' || !requestId || requestId.length > 64) return { ok: false, error: 'bad' };
    const check = await adStatus(requestId);
    if (check !== 'verified') return { ok: false, error: check };
    const account = $sender.account;
    return await $lock(`rec:${account}`, async () => {
      const p = await readProfile(account);
      if (p.adIds.includes(requestId)) return { ok: false, error: 'used' };
      if (p.adDay !== dayNow()) { p.adDay = dayNow(); p.ads = {}; }
      const used = p.ads[placement] ?? 0;
      if (used >= ad.daily) return { ok: false, error: 'daily' };
      if (Date.now() - p.adAt < AD_GAP_MS) return { ok: false, error: 'wait' };
      p.adAt = Date.now();
      p.ads[placement] = used + 1; p.adIds.push(requestId); p.coins += ad.coins;
      await saveProfile(account, p);
      return { ok: true, coins: p.coins, reward: ad.coins, used: p.ads[placement] };
    });
  }

  async onRoomLeave(roomId: string, account: string): Promise<void> {
    if (roomId.startsWith(ROOM_PREFIX)) await removePlayer(roomId, account);
  }
}
