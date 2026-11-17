export type Team = 0 | 1;
export type PassKind = 'short' | 'through' | 'lift';

/**
 * One player's controls for a frame. Button presses are counters (not booleans) so a press is never lost or
 * repeated when frames arrive late, twice or out of order over the network: the simulation acts when a counter
 * grows. Move is already in world space (the client turns the stick by its own camera).
 */
export interface InputFrame {
  mx: number;
  mz: number;
  sprint: boolean;
  shootHeld: boolean;
  passSeq: number;      // S / W / A presses
  passHeld: boolean;    // a pass key is down (with the puck: charging the pass, released = pass)
  passKind: PassKind;   // kind of the latest pass press
  shootSeq: number;     // D presses
  releaseSeq: number;   // D releases
  fightSeq: number;     // F presses (accept a fight after a heavy hit)
  skillSeq: number;     // key commands completed (the controlled skater's skill)
}

export const emptyInput = (): InputFrame => ({ mx: 0, mz: 0, sprint: false, shootHeld: false, passSeq: 0, passHeld: false, passKind: 'short', shootSeq: 0, releaseSeq: 0, fightSeq: 0, skillSeq: 0 });

/** one per role (roster.ts); goalies have none */
export type SkillId = 'rush' | 'dash' | 'snipe' | 'laser' | 'charge' | 'sweep' | 'none';

export interface Skater {
  id: number;           // stable index in Match.skaters
  team: Team;
  slot: number;         // 0..2 skaters, 3 goalie
  goalie: boolean;
  x: number; z: number; vx: number; vz: number;
  face: number;         // radians, direction (cos, sin) in (x, z)
  stun: number;         // knocked down / off balance
  contact: number;      // seconds before this skater can make another collision or boards impact
  cool: number;         // cannot pick up the puck
  checkCd: number;
  lunge: number;        // seconds left of a body-check lunge (hits only on real contact)
  lx: number; lz: number;   // lunge direction
  think: number;        // AI decision timer
  tx: number; tz: number; sprint: boolean;
  hold: number;         // goalie holding the puck
  react: number;        // goalie reaction timer
  dive: number;         // goalie butterfly / dive (shootout control)
  passSkill: number;    // 0..1 pass accuracy (from the character's card)
  handSkill: number;    // 0..1 receiving a hard pass cleanly
  speedMul: number;     // top-speed multiplier (~0.93..1.07)
  shotSkill: number;    // 0..1 shot accuracy and pace
  checkPower: number;   // 0..1 how hard this skater hits and how well they take a hit
  skill: SkillId;
  skillCd: number;      // seconds until the skill can be used again
  skillT: number;       // seconds the skill stays active or armed
}

export interface Puck {
  x: number; z: number; vx: number; vz: number; y: number; vy: number;
  owner: number;        // skater id or −1
  last: number;         // last skater id that touched it
  passTo: number;       // intended receiver id or −1
  shot: boolean;
  dead: boolean;
  blend: number;        // seconds left of the soft hand-over onto a stick after a reception
  lifted: boolean;      // current pass is a saucer pass
  laser: boolean;       // current pass cannot be picked off (playmaker skill)
}

export type Phase = 'faceoff' | 'play' | 'goal' | 'break' | 'shootout' | 'end' | 'fight';   // break = intermission between periods

/** things the presentation layer reacts to (sound, banners, shake); drained every frame */
export type MatchEvent =
  | { t: 'pass'; by: number }
  | { t: 'shot'; by: number; power: number }
  | { t: 'fake'; by: number }
  | { t: 'save'; by: number; held: boolean }
  | { t: 'post' }
  | { t: 'board'; speed: number }
  | { t: 'check'; by: number; on: number; hard: boolean }   // hard = knocked down, else staggered
  | { t: 'lunge'; by: number }
  | { t: 'skill'; by: number; kind: SkillId }
  | { t: 'collide'; a: number; b: number; speed: number }    // two opponents ran into each other without a check
  | { t: 'boardHit'; on: number; speed: number }             // a skater off his feet hit the boards
  | { t: 'bump'; by: number; on: number }                    // body contact too soft to win the puck
  | { t: 'takeaway'; by: number }
  | { t: 'goal'; team: Team; by: number }
  | { t: 'faceoff' }
  | { t: 'periodEnd'; period: number }
  | { t: 'go' }
  | { t: 'overtime' }
  | { t: 'shootoutStart' }
  | { t: 'shootoutAttempt'; team: Team; round: number }
  | { t: 'shootoutResult'; team: Team; scored: boolean }
  | { t: 'fightOffer'; by: number; on: number }
  | { t: 'fightStart'; a: number; b: number }
  | { t: 'fightHit'; by: number; on: number }
  | { t: 'fightBlock'; on: number }
  | { t: 'fightMiss'; by: number }
  | { t: 'fightEnd'; winner: Team | -1; by: number; ko: boolean }
  | { t: 'end'; score: [number, number]; shootout: [number, number] | null };
/** mobile manager mode: how a team's AI plays */
export type Tactic = 'balanced' | 'attack' | 'defend';
/** 0 idle, 1 throwing a punch, 2 recovering, 3 guard, 4 dodge, 5 hit, 6 down */
export type FightAct = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** what the presentation needs of a fight (both fighters in the order a, b) */
export interface FightView { a: number; b: number; hp: [number, number]; st: [number, number]; act: [FightAct, FightAct]; hand: [number, number]; p: [number, number]; t: number; over: boolean }
