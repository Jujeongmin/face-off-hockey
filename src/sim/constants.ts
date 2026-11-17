// Rink geometry and tuning shared by the simulation, the renderer and the network layer.
// Coordinates: x = rink length (goals at ±GOAL_X), z = width. Team 0 attacks +x, team 1 attacks −x.

export const RINK = {
  halfLength: 28,       // ~61 m NHL rink
  halfWidth: 12.75,     // ~26 m
  cornerRadius: 8,
  goalX: 24.4,          // goal line
  goalHalfWidth: 0.915, // half of the 1.83 m mouth
  netDepth: 1.1,
  blueX: 7.6,
} as const;

export const SKATE = {
  radius: 0.42,
  maxSpeed: 7.6,
  sprintSpeed: 9.6,
  carryFactor: 0.92,    // slower with the puck
  accel: 15,
  turnAccel: 22,        // changing direction against momentum
  glide: 2.2,           // deceleration with no input
  stickReach: 0.85,
} as const;

export const PUCK = { radius: 0.12, friction: 0.55, maxSpeed: 34, boardBounce: 0.72 } as const;

export const MATCH = {
  periods: 3,            // like the real game: three periods, teams change ends after each
  periodSeconds: 60,     // per period (a match is 3 minutes of play)
  breakSeconds: 4,       // intermission between periods
  faceoffDelay: 0.9,
  goalPause: 2.4,
  overtimeSeconds: 60,   // 3-on-3 style sudden death before the shootout
  shootoutRounds: 3,
  shootoutAttemptSeconds: 7,
} as const;

/** the crossbar: a puck higher than this at the goal line goes over the net */
export const CROSSBAR = 1.22;

/**
 * Shootout moves (S fake, W five-hole, A lifted shot). A five-hole goes through only while the goalie is sliding
 * across (set or down, the legs are closed). A lifted shot clears a goalie who is down on the ice. A fake sends an
 * AI goalie down less often each time it is tried in the same attempt.
 */
export const SHOOTOUT = {
  fiveHole: 0.075,      // half width (m) of the gap between the pads
  openSlide: 0.8,       // m/s of sideways slide that opens it
  quickRelease: 0.27,   // s: a shot that gets there sooner beats the legs closing (from close in)
  overPad: 0.5,         // m: a puck this high clears a goalie who is down
  downReach: 0.2,       // share of the goalie's reach left against a high puck while down (the glove, right at the body)
  highReach: 0.2,       // m more reach against a high puck while standing (glove and blocker are up there)
  liftHeight: 0.92,     // m at the goal line a lifted shot aims for
  liftMaxVy: 5.6,       // m/s up at most: the puck peaks at 1.6 m
  liftSpread: 0.17,     // m (one sigma) of that height for an average shooter: some go over the bar
  bite: 0.42,           // chance an AI goalie goes down on the first fake (halved by every fake after it)
  dive: 0.45,           // s of the stretch (the reach covers the gap)
  recover: 0.4,         // s after the stretch the goalie is still down, getting up: no new dive, legs closed
  fakeCooldown: 0.5,
} as const;

/** fixed simulation step */
export const STEP = 1 / 120;

export const ATTACK_DIR: readonly [1, -1] = [1, -1];
export const SKATERS_PER_TEAM = 3;

/** hockey fights: offered after a heavy hit, one per period; every number is seconds or a 0..100 / 0..1 scale */
/** hit-stop: the whole simulation holds for this many seconds at the moment of contact */
export const IMPACT = { check: 0.03, hard: 0.075, boards: 0.06, punch: 0.055, block: 0.02, ko: 0.2 } as const;

export const FIGHT = {
  offerSeconds: 3, seconds: 15, perPeriod: 1, overSeconds: 1.8,
  hp: 100, punch: 16, guardChip: 3, guardDrain: 0.14,
  punchCost: 0.24, dodgeCost: 0.1, regen: 0.3, guardRegen: 0.12,
  // a punch is a readable wind-up; after landing one the puncher is slower to recover than the one hit (stagger),
  // so mashing trades blows instead of chaining them. Into a guard it bounces off (blocked) and leaves the puncher open.
  // A dodge in time makes it whiff and gives the dodger a counter: the next punch inside counterWindow hits x counter.
  windup: 0.3, recover: 0.32, whiff: 0.55, stagger: 0.24, blocked: 0.34, guardBreak: 0.45, dodge: 0.45, dodgeCooldown: 0.5,
  counter: 1.7, counterWindow: 0.9,
  moraleSeconds: 15, moraleSpeed: 1.1,
} as const;

/** FC-style reception: stickShare = how much of the receiver's run the stick still decides; near = metres from the receiver where a pass starts to bend (before that the lane decides, so defenders can still cut it); turn = how fast (rad/s), within maxOff rad; reach = extra metres for the intended stick */
export const PASS_ASSIST = { stickShare: 0.35, near: 6, turn: 2.6, maxOff: 1.2, reach: 0.75 } as const;

/** player skills (key commands): cd = cooldown seconds per skater, short on purpose so they get used a lot */
export const SKILL = {
  rush: { cd: 8, seconds: 3.5, speed: 1.22 },
  dash: { cd: 6, speed: 15 },
  snipe: { cd: 9, armed: 5, accuracy: 0.25, power: 1.12 },
  laser: { cd: 7, armed: 5 },
  charge: { cd: 7, lunge: 0.36, speed: 12.5, hit: 7 },
  sweep: { cd: 8, radius: 3.4, stun: 0.42, push: 5, pull: 9 },
} as const;
/** effect ring and banner colour of each skill */
export const SKILL_COLOR = { rush: 0x3ddc84, dash: 0x35d0ff, snipe: 0xffc42e, laser: 0xb98cff, charge: 0xff7a3c, sweep: 0xf2f6fc, none: 0xffffff } as const;
