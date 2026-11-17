# Stages and Instant-Play Entry Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-time player lands in the tutorial (PC) or a manager stage (phone), then plays through rewarded stages
(chapters 1-2, 20 stages with 3 stars each); home leads with "Continue stages", and red attention dots show what to press.

**Architecture:** Stage definitions and star rules are pure data + functions (`src/game/stages.ts`). A DOM-free
`StageRun` sets a scenario up on the real `Match` and watches it (`src/game/stageRun.ts`, testable in node). A
`StageSession` wraps it for rendering, HUD and input, PC hands or phone manager (`src/game/stageSession.ts`). The
server stores stars and pays rewards once (`server/src/server.ts`). The stage screen, home tile, result stars and
attention dots live in `src/game/stageScreen.ts` + `index.html` + `src/steel.css`; `src/main.ts` only wires them up.

**Tech Stack:** TypeScript, three.js, Vite, plain node test scripts (`node --experimental-strip-types`), Agent8
gameserver tests (`npm run server:test`).

**Spec:** `docs/superpowers/specs/2026-11-11-stages-and-solo-loop-design.md` (Parts 1 and 2; Part 3 is out of scope).

## Global Constraints

- No gems from gameplay. Stage rewards are coins, scouts, protection tickets and enhancement materials only.
- No energy / stamina limits.
- Same stats in every mode (no ranked cap); stages use `withLevels` lineups like AI practice.
- No emoji anywhere in UI. Icons: CSS shapes, existing `public/kit` art, or Phosphor (MIT) SVG.
- Every new UI string gets keys in all five tables: KO, EN (`src/i18n.ts`), JA, ZH_HANT, ZH_HANS (`src/i18n_cjk.ts`).
- PC layouts must hold at 640x467, 1280x720, 2560x1440 and tall windows (635x828); phone at 390x844.
- Never touch `.agent8.lock`, `.env`, `committedAt`. Commit + push to develop after each task (pre-approved).
- three.js: no new materials or geometries per stage; reuse scene objects (memory checklist).

## Review Focus

1. Quitting a stage mid-way (Esc / back) must return home with no reward and no stuck HUD/drill panel. Test in Task 3.
2. Replaying a cleared stage with fewer stars must never lower the stored stars or pay first-clear again. Test in Task 4.
3. A first-time player whose server profile is unreachable (offline / server error) still gets the tutorial, and
   progress made offline is not lost silently: show the server error toast and keep stars local until a retry. Test in Task 6.
4. A phone stage whose star condition is a hand skill must never be shown on phones (unwinnable stars). Test in Task 1.
5. A scenario where the sim reaches `phase === 'end'` or a shootout before the stage's clock ends (overtime stages)
   must still finish the stage once with one outcome. Test in Task 2.

---

### Task 1: Stage data and star rules

**Files:**
- Create: `src/game/stages.ts`
- Test: `tests/stages.test.ts` (add to `sim:test` in `package.json`)

**Interfaces:**
- Produces:
  ```ts
  export type Platform = 'pc' | 'phone';
  export type StarRule =
    | { k: 'win' } | { k: 'margin'; n: number } | { k: 'clean' } | { k: 'timeLeft'; s: number }
    | { k: 'skillGoal' } | { k: 'oneTimer' } | { k: 'goals'; n: number };     // skillGoal / oneTimer are hand rules (PC only)
  export interface Scenario {                // how the ice is set up before the puck drops
    seconds: number;                         // clock for the stage (boss: full match uses periods instead)
    score: [number, number];                 // starting score, me first
    mySkaters?: 1 | 2 | 3;                   // short-handed when < 3 (extra skaters benched)
    theirSkaters?: 1 | 2 | 3;
    puck: 'mine' | 'theirs' | 'faceoff';
    goal: 'win' | 'scoreN' | 'hold';         // win = lead at the end; scoreN = reach `need` goals; hold = concede none
    need?: number;
    shootout?: number;                       // > 0: the stage is a shootout of this many rounds
  }
  export interface Stage {
    id: string;                              // '1-1' .. '2-10'
    chapter: number; index: number;          // 1-based
    boss: boolean;                           // index 5 and 10
    name: Key;                               // i18n key
    power: number;                           // the opponent's per-seat power (fills Lineup.levels)
    foe: Lineup;                             // opposing characters (boss teams use epic / legend cards)
    scenario: Scenario | null;               // null = full match (boss)
    stars: { pc: [StarRule, StarRule]; phone: [StarRule, StarRule] };   // star 1 is always clearing the stage
  }
  export interface Outcome { cleared: boolean; myGoals: number; theirGoals: number; timeLeft: number; skillGoals: number; oneTimerGoals: number }
  export const STAGES: readonly Stage[];
  export function stageById(id: string): Stage | undefined;
  export function nextStage(stars: Record<string, number>): Stage;   // first stage not yet cleared (or the last one)
  export function isOpen(id: string, stars: Record<string, number>): boolean;   // previous stage cleared; 1-1 always open
  export function starsFor(stage: Stage, o: Outcome, p: Platform): number;   // 0..3; 0 when not cleared
  export function ruleOk(rule: StarRule, o: Outcome): boolean;
  export const HAND_RULES: ReadonlySet<StarRule['k']>;               // 'skillGoal', 'oneTimer'
  export const CHEST_AT: readonly [10, 20, 30];                       // chapter star totals that open a chest
  ```

- [ ] **Step 1: Write the failing test** `tests/stages.test.ts`, same `check(name, ok)` style as `tests/manager.test.ts`:
  - `STAGES.length === 20`, ids `'1-1'..'2-10'` in order, `boss` exactly at index 5 and 10, boss `scenario === null`.
  - Every `foe` uses 4 distinct valid `ModelId`s (`CHARACTER[id]` exists) and boss power > every non-boss power in its chapter; power never falls from one stage to the next.
  - No phone star rule has `k` in `HAND_RULES` (Review Focus 4).
  - `starsFor(s, {cleared:false,...}, 'pc') === 0`; cleared with both rules met `=== 3`; cleared with neither `=== 1`.
  - `ruleOk({k:'margin',n:3}, {myGoals:4, theirGoals:1,...}) === true`, `{myGoals:3, theirGoals:1}` → false.
  - `nextStage({}) .id === '1-1'`; `nextStage({'1-1':1}).id === '1-2'`; `isOpen('1-3', {'1-1':3}) === false`; `isOpen('2-1', {...all chapter 1 cleared})`.

- [ ] **Step 2: Run** `node --experimental-strip-types tests/stages.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/game/stages.ts`.** Content of the 20 stages is the builder's call within these rules:
  chapter 1 stages 1-4 and 6-9 mix the spec's scenario examples (down 1-0 with 40 s left, short-handed 45 s hold,
  overtime next goal, 3-round shootout, score N in 60 s); 1-1 is the easiest (`power` 0, free characters,
  `goal: 'scoreN', need: 1`, 45 s, puck mine). Power rises 0 → 12 over chapter 1, 10 → 24 over chapter 2.
  Boss 1-5 / 1-10 / 2-5 / 2-10 use gold / epic / epic / legend characters. Add `stage_1_1`... name keys to i18n (all five tables).

- [ ] **Step 4: Run** the test — Expected: all `ok`, exit 0. Run `npm run typecheck` — no errors.

- [ ] **Step 5: Commit** `feat: stage data and star rules (chapters 1-2)` and push to develop.

---

### Task 2: StageRun (scenario on the real sim, DOM-free)

**Files:**
- Create: `src/game/stageRun.ts`
- Test: `tests/stagerun.test.ts` (add to `sim:test`)

**Interfaces:**
- Consumes: `Stage`, `Scenario`, `Outcome` from Task 1; `Match` (`src/sim/match.ts`), `STEP`.
- Produces:
  ```ts
  export class StageRun {
    readonly match: Match;
    readonly stage: Stage;
    done: Outcome | null;                    // set once, when the stage ends
    constructor(stage: Stage, mine: Lineup, opts: { human: boolean; seed?: number });  // human=false: my team is AI (phone manager / tests)
    step(input: InputFrame | null): MatchEvent[];   // one STEP; returns this step's events; no-op after done
    get timeLeft(): number;
  }
  ```
  Opponent lineup = `{ ...stage.foe, levels: [p, p, p, p] }` with `p = stage.power`.

- [ ] **Step 1: Write the failing test.** For every stage: `new StageRun(stage, DEFAULT_LINEUPS[0], { human: false, seed: 1 })`, step with `null` until `done` or a 20-minute step cap. Assert:
  - every stage ends (`done !== null`) inside the cap, including boss full matches and the shootout stage (Review Focus 5);
  - `done` is set exactly once (count transitions);
  - scenario stages start with `match.score` equal to `scenario.score` and the clock equal to `scenario.seconds`;
  - a short-handed scenario has `mySkaters` of my skaters not in `match.benched`, the rest benched;
  - over 200 seeds of stage 1-1 with my team AI, the clear rate is > 50 % (the first stage must be easy);
  - over 200 seeds of 2-10, the clear rate with the default free lineup is < 30 % (it needs growth).

- [ ] **Step 2: Run** `node --experimental-strip-types tests/stagerun.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `StageRun`.** Reuse the tutorial's placement approach (`Object.assign` on skaters/puck, `match.benched`) — move the shared helpers `place`, `give`, `loosePuck` out of `Tutorial` into an exported function set in `src/game/stageRun.ts` (or a small `src/game/ice.ts`) and make `Tutorial` call them, no behaviour change. Scenario clock: set `match.clock = seconds`, single period (`periodSeconds: seconds` in `MatchOptions`, overtime off by ending at clock 0 for `hold` / `scoreN`; `win` goes to the sim's normal overtime). Track `skillGoals` / `oneTimerGoals` from events (a goal within 1.5 s of a `skill` event by the scorer's team; a goal whose shot came from a received pass with no touch, read from the sim's existing one-timer flag or the `shot` following a `pass` within 0.6 s — builder's call, document it). End rules: `scoreN` ends when `myGoals - startMine >= need` (cleared) or the clock runs out (not); `hold` ends at clock 0 (cleared if no goal against) or on a goal against (not); `win` / boss / shootout end at `phase === 'end'` with `cleared = winner === 0`.

- [ ] **Step 4: Run** the test, then `npm run sim:test` — Expected: all pass, including the tutorial-adjacent tests (no behaviour change).

- [ ] **Step 5: Commit** `feat: StageRun runs a stage scenario on the real sim` and push.

---

### Task 3: StageSession (PC hands and phone manager)

**Files:**
- Create: `src/game/stageSession.ts`
- Modify: `src/main.ts` (a `stage(id)` launcher next to `practice()` / `tutorial()`, Esc/back handling at `src/main.ts:588-592`)
- Modify: `index.html` (a stage banner: name, goal text, clock, star rules — reuse the `#drill` panel's look)

**Interfaces:**
- Consumes: `StageRun` (Task 2), `Session` and `viewOf` / `paintSkill` patterns from `src/game/sessions.ts`.
- Produces:
  ```ts
  export class StageSession implements Session {
    constructor(scene: HockeyScene, hud: Hud, input: KeyboardInput, stage: Stage, mine: Lineup,
                opts: { manager: boolean; coach?: boolean }, onEnd: (o: Outcome, stars: number) => void);
    frame(dt: number, time: number): void;
    dispose(): void;
  }
  ```
  `manager: true` (phones) → `human: false`, `#tactics` shown, `hud.auto = true`, tactic changes write `run.match.tactic[0]`.
  `coach: true` (phone first visit) → short prompts over the match pointing at the tactic buttons (three keys: attack,
  defend, balanced), shown one after another at 2 s, 12 s, 22 s.

- [ ] **Step 1: Implement `StageSession`** like `LocalSession` (fixed `STEP` accumulator, events to scene + HUD, `scene.update(viewOf(...))`), plus the stage banner (goal text from the scenario, both star rules for the current platform, the clock). `onEnd` fires once, 1.5 s after `run.done`.
- [ ] **Step 2: Wire `stage(id: string)` in `main.ts`**: `lastMode = 'stage'` (extend the union), lineups `[withLevels(lineup), foe-with-levels]`, `begin(...)`. Leaving mid-stage (the existing leave button / Esc path) calls `wipe(toTitle)` with no report, hides the banner and `#tactics` (Review Focus 1).
- [ ] **Step 3: Verify in the browser** (1280x720, then phone preset 390x844): from the dev console `__game.stage('1-1')` plays, the banner shows goal and stars, scoring ends it once, leaving mid-way returns home with no banner left over. Capture consecutive frames during play, not one still.
- [ ] **Step 4: Run** `npm run typecheck && npm run sim:test` — Expected: pass.
- [ ] **Step 5: Commit** `feat: StageSession plays stages with hands (PC) or tactics (phone)` and push.

---

### Task 4: Server progress and rewards

**Files:**
- Modify: `server/src/server.ts` (Profile, load/save, new methods)
- Test: `server/test/server.test.ts`

**Interfaces:**
- Produces (server methods, called through `lobby.rpc`):
  ```ts
  getStages(): Promise<{ stars: Record<string, number>; chests: string[]; replaysLeft: number }>
  clearStage(id: string, stars: number, seconds: number): Promise<{ ok: boolean; error?: 'stage' | 'locked' | 'short';
      stars: Record<string, number>; reward: { coins: number; scouts: number; tickets: number; mats: number }; wallet: ReturnType<typeof wallet> }>
  claimChest(chapter: number, at: 10 | 20 | 30): Promise<{ ok: boolean; error?: 'stars' | 'claimed'; reward: {...same}; wallet: ... }>
  ```
  Profile gains `stages: Record<string, number>`, `chests: string[]` (`'1:10'`), `stageDay: string`, `stageReplays: number`.
  The server keeps its own copy of the stage id list, boss flags and minimum seconds (`STAGE_IDS`, like `GRADE_OF`
  mirrors roster.ts); a comment on both sides says they must match.
  Rewards (server constants, numbers are the builder's balance call): first clear coins (non-boss 60-120, boss 250-400),
  boss first clear adds 1 free scout (`scouts` = a coin scout's card, as `scoutAward`), each new star 30 coins,
  chests: 10 stars → 2 protection tickets, 20 → 1 scout + mats, 30 → 2 scouts. Replays with no new stars: 15 coins,
  10 per day (`replaysLeft`). Mats go to the account's most-used lineup character (`p.mats[lineup.skaters[0]]`).

- [ ] **Step 1: Write failing server tests:**
  - `clearStage('1-1', 2, 40)` on a new account → `ok`, stars `{'1-1': 2}`, coins rise by first-clear + 2 × star coins.
  - `clearStage('1-1', 1, 40)` again → stars stay 2 (Review Focus 2), coins rise by the replay amount only, `replaysLeft` drops by 1.
  - `clearStage('1-1', 3, 40)` → one new star paid, no first-clear again.
  - `clearStage('1-3', 3, 40)` with 1-2 not cleared → `error: 'locked'`, nothing changes.
  - `clearStage('1-1', 3, 2)` (below the stage's minimum seconds) → `error: 'short'`.
  - `clearStage('9-9', 1, 40)` → `error: 'stage'`; `stars` 4 or -1 → rejected.
  - `claimChest(1, 10)` with 9 stars → `error: 'stars'`; with 10 → ok; again → `error: 'claimed'`.
  - after 10 replays the 11th pays 0 coins but still records new stars.
- [ ] **Step 2: Run** `npm run server:test` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** inside `$lock('rec:<account>')` like `enhance` / `scout`; load defaults in the profile loader (`server.ts:185-205`), save in `save` (`server.ts:211`). Day key the same way as `adDay`.
- [ ] **Step 4: Run** `npm run server:test` — Expected: all pass (old ones too).
- [ ] **Step 5: Commit** `feat: server stage progress, stars and rewards` and push. Note in the commit body that the Verse8 editor must be refreshed for the preview server to pick it up.

---

### Task 5: Stage screen, home tile, result stars and attention dots

**Files:**
- Create: `src/game/stageScreen.ts`
- Modify: `index.html` (`#stages` section; home tiles in `#pcMenu` and `#mobileMenu`; result stars row in `#result`), `src/steel.css`, `src/main.ts`, `src/i18n.ts`, `src/i18n_cjk.ts`

**Interfaces:**
- Consumes: `STAGES`, `isOpen`, `nextStage`, `CHEST_AT` (Task 1); `stage(id)` (Task 3); `getStages` / `clearStage` / `claimChest` (Task 4).
- Produces:
  ```ts
  export function openStages(chapter?: number): Promise<void>;         // renders #stages from server progress
  export function reportStage(id: string, o: Outcome, stars: number, seconds: number): Promise<StageReport | null>;
  export function attention(): { stages: number; chest: boolean; tutorial: boolean };   // counts for the red dots
  export function paintDots(): void;                                   // applies attention() to every dot host
  ```

- [ ] **Step 1: Stage screen `#stages`.** Chapter tabs; 10 stage cards in a path (2 rows of 5 on PC, one column on phones and tall windows); each card: number, name, 3 star slots, lock state, boss cards bigger with the boss's lead portrait. Selecting a card shows a side panel: goal text, the 2 star rules for this platform, opponent power vs. my lineup power (`ratingOf`), rewards, a Start button. Chest bar under the path: 10 / 20 / 30 star marks, claimable ones glow.
- [ ] **Step 2: Home tile "Continue stages"** as the first, largest tile in `#pcMenu` (above quick match, which stays a large tile) and first in `#mobileMenu` (above manager match); shows `nextStage` id and chapter stars. Pressing it starts `nextStage` directly; a small "all stages" link opens `#stages`. Left rail gets a Stages entry.
- [ ] **Step 3: Result screen.** After a stage: 3 stars filling in one after another (CSS animation, `prefers-reduced-motion` off), the rewards counted up, buttons Next stage / Retry / Home. `reportStage` failure → `toast(t('eServer'))` and stars kept in `localStorage['faceoff:stagesPending']`, retried on the next `openStages` (Review Focus 3).
- [ ] **Step 4: Attention dots (owner request 2026-11-11: "빨간점도 잘 떠서 유저들이 아 이거 눌러야하는구나").** One shared `.dot-alert` style: 12 px (PC) / 14 px (phone) red circle, white 2 px ring, soft pulse (scale 1 → 1.25, 1.4 s, off under `prefers-reduced-motion`), a white number inside when > 1. Hosts: home stage tile (new stage open and not yet played, or chest claimable), rail Stages tab, chapter tab with a claimable chest, the tutorial entry until done (replaces today's 9 px `#bTutorial.hot::after`), shop starter pack until bought. `paintDots()` runs after every `getStages`, `getEconomy` and screen change. Dots sit on the host's top-right corner, never covering its label, at all checked window sizes.
- [ ] **Step 5: Verify in the browser** at 1280x720, 640x467, 635x828 and phone 390x844 (headless CDP screenshots for exact sizes, `PROJECT/` memory notes): stage screen, home tile, a full stage played to the result with stars, chest claim, dots appearing and clearing. Consecutive frames for the star animation.
- [ ] **Step 6: Run** `npm run typecheck && npm run sim:test && npm run server:test` — pass. **Commit** `feat: stage screen, Continue stages tile, result stars, attention dots` and push.

---

### Task 6: First-visit entry flow

**Files:**
- Modify: `src/main.ts` (boot after loading, `tutorial()` end callback at `src/main.ts:435`, `src/main.ts:704-705` first-visit block), `src/game/tutorial.ts` (skip button), `index.html` (skip button in `#drill`), i18n tables

**Interfaces:**
- Consumes: `stage(id)` (Task 3), `getStages` (Task 4), `reportStage` (Task 5).
- Produces: `function firstVisit(): Promise<boolean>` in `main.ts` — true when `localStorage['faceoff:tutorial']` is missing **and** the server profile has no record (`getRecord` w + l + d === 0) and no stars (`getStages`); when the server cannot be reached, the local flag alone decides (Review Focus 3).

- [ ] **Step 1: Skip control** in the tutorial panel (top-right of `#drill`, "Skip"), sets the tutorial flag and ends like a finished tutorial.
- [ ] **Step 2: Boot.** When loading ends: `firstVisit()` true → PC: `tutorial()` straight away, its end (finish or skip) → `stage('1-1')`; phone: `stage('1-1')` with `{ manager: true, coach: true }`. The stage's result screen's Next goes home for this first run (the player sees the home and its dots once). Otherwise → home as today.
- [ ] **Step 3: Verify** with a fresh browser profile (headless CDP, new `--user-data-dir`): loading → tutorial with no home screen in between (frames every 200 ms around the handover), skip → stage 1-1 → result → home with the stage dot. Second load of the same profile → home. Phone preset fresh profile → manager stage 1-1 with the coach prompts.
- [ ] **Step 4: Run** `npm run typecheck && npm run sim:test` — pass. **Commit** `feat: first visit goes straight into the tutorial (PC) or a coached manager stage (phone)` and push. Update `PROJECT/Status.md` with a short "Stages and entry flow (2026-11-11)" section.
