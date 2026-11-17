# Instant play, stages and a solo loop that can carry heavy spenders

Date: 2026-11-11. Status: draft for the owner's approval.

## Why

FACE-OFF! is a web game: a player arrives from a link, and if the first thing they see is a menu, many leave. The
owner wants:

- **Instant play.** A first-time player goes straight into the tutorial, without passing through the home screen.
- **Plenty to do alone.** A player with nobody to match against must still have a reason to keep playing. Today the
  solo options are AI practice, AI-vs-AI watching (phones), shooting practice, scouting and enhancement. AI practice
  pays nothing and leads nowhere, and coins and rank only come from online quick matches.
- **A game that can make heavy spenders.** Today it cannot. The spend ceiling is low: a 4-card lineup, 3 legends and
  a +10 enhancement cap, so a few hundred dollars finishes an account. Paid power barely shows in a skill-decided 1v1:
  a +10 lineup wins by about 0.4 goals a game over 800 AI games. And a spender needs opponents and an audience, which a
  small player base does not supply.

## Owner's decisions

1. A first-time player goes straight to the tutorial.
2. Stages are the solo content (my recommendation, which the owner accepted: "좋다 진행하자").
3. Ranked 1v1: **player stats matter, but in the end the hand on the keyboard decides.** No separate cap for
   ranked: the same stats apply in every mode (owner, 2026-11-11: "상한없어"). Keeping skill decisive is a balance
   job: each growth step stays small enough that a better player still beats a richer one.
5. Phones get stages too, as manager-mode stages (owner, 2026-11-11).
4. Existing rules still apply: no emoji UI; paid value can never move between accounts (VXShop rule, premium cards
   are bound); push to develop after each finished task.

## Goals

- From the first page load to the first puck touch takes under about 10 s after loading, with no menus.
- After the tutorial there is always a "next thing": the next stage, a missing star, a boss, the daily challenge.
- Solo progress feeds the existing economy (coins, cards, enhancement, scouting). Stages give the cards a job.
- There is room for a spender to go on spending for a long time: deeper card growth, wider collection, and places
  where that power shows (stages, an async league), without making ranked pay-to-win.

## Non-goals

- Energy or stamina timers that block play. They work against "open the link and play".
- Gems earned from gameplay. Gems come from VXShop only, as today (`GEM_PRODUCTS` comment in `server/src/server.ts`).
- Real-time co-op, guilds, chat rooms.

## Anti-goals (a failure even if it works)

- A long tutorial that cannot be skipped, or one that stops for text walls.
- Ranked matches decided by the wallet: with no ranked cap, the size of each growth step is what prevents this.
- A home screen that pushes a new player into ranked matchmaking with nobody online.

## Part 1: entry flow

- **First visit** (no `faceoff:tutorial` in localStorage, the same flag that drives today's "NEW" mark, *and* a server
  profile with no games played and no stage progress, so a known account on a new device is not sent back through
  it; *my call*): when loading
  ends, the game starts the tutorial directly, without the home screen. The tutorial's seven drills stay as they are
  (`src/game/tutorial.ts`). A small "skip" control is always visible.
- **After the tutorial:** stage 1-1 starts at once (a short scenario stage, see below), then its result screen, then
  home. Skipping the tutorial also lands on stage 1-1.
- **Returning players:** home. The primary tile becomes "Continue stages" (shows chapter-stage and stars), with ranked
  quick match next to it and still prominent. *(My call: with a small player base, the tile that always works should
  lead.)*
- **Phones:** phones have no direct control, so the keyboard tutorial does not fit. A first-time phone player goes
  straight into manager stage 1-1, which teaches the tactic buttons with short prompts over the live match (*my
  call*). Afterwards: home, with "Continue stages" leading the same way.

## Part 2: stages

**Shape.** Chapters of 10 stages. Most stages are short scenarios (30-90 s of play); stages 5 and 10 of each chapter
are full matches against a boss team. Launch with 2 chapters (20 stages); more chapters come as content updates.

**Scenario stages** set up a situation on the real rink with the real sim, the way the tutorial drills do (place
skaters, set score and clock, give the puck). Examples:
- Down 1-0 with 40 s left: score twice.
- Short-handed (3 against 4) for 45 s: concede nothing.
- Score only from one-timers.
- Overtime from the opening face-off: next goal wins.
- Shootout of 3 against a hot goalie.

**Boss stages** are a normal AI match (three periods, the existing `LocalSession` path) against a named team whose
lineup carries grades and enhancement levels. Bosses later in a chapter use epic and legend cards.

**Stars (3 per stage).** One for clearing, two for conditions read from sim events: win by 3+, score with a skill,
no goals against, finish with N seconds left, etc. Each stage lists its conditions before you start.

**Difficulty.** Comes from the opposing lineup's power (grades, enhancement) and AI settings, not from hidden
cheats. The stage card shows the recommended power next to mine, so enhancement and scouting have a visible purpose.

**Rewards (into today's economy).**
- First clear: coins plus, at milestones, a free scout or a protection ticket.
- Each star: once.
- Chapter star chests at 10 / 20 / 30 stars: enhancement materials, scouts, tickets.
- Replays: a small coin amount with a daily cap.
- No gems.

**Phones: manager-mode stages.** The same chapters and stage list on phones, played through the existing manager
match (my lineup's AI follows the tactic I pick). Scenario setups are the same; star conditions must be things a
tactic can bring about (win, margin, clean sheet, time left), not hand skills like "score a one-timer". Each stage
defines its PC and phone star conditions separately where they differ. Progress is per account, so stars from either
device count. *(My call: one progression across devices, not separate PC and phone tracks.)*

**Unlocking.** Linear: stage N+1 opens when stage N is cleared. A chapter opens when its previous boss is beaten.

**Server.** Progress (stars per stage, chests claimed) is stored on the server profile like coins. The match runs in
the browser, so a client could fake a clear. Rewards are paid by the server once per stage, star and chest, with a
daily replay cap. *(My call: the same trust level as today's practice; there is nothing to sell in a fake clear beyond
the capped rewards. Builder may add a plausibility check: a minimum stage duration.)*

## Part 3: making room for heavy spenders (after stages)

No ranked cap (decision 3): everything below counts in every mode, ranked included. Today a +10 lineup is worth about
+0.4 goals a game. Each new layer (awakening, collection) must be measured the same way, over many AI games, before it
ships, so a fully grown account stays beatable by a clearly better player.

In order of value:

1. **Async league ("League challenge").** Each player's saved lineup is a team other players can challenge. The AI
   plays it, and I play against it with my own hands. A weekly table, defence wins count for the owner, and rewards
   by league rank. It needs nobody online, and a spender's team becomes a visible wall others try to break. This is
   the main reason to spend.
2. **Awakening stars (★1-★5) from duplicates.** Today a duplicate becomes enhancement material. Instead it can awaken
   the card: more stats and, at ★3 / ★5, a stronger skill. This gives depth past +10 for every card, legends included.
3. **Collection book.** Owning N cards of a grade gives small team-wide bonuses (PvE and league only).
4. **Tower.** An endless climb of boss teams that gets stronger every floor, with a floor leaderboard.
5. **Monthly pass and season pass.** Daily gems for 30 days, a reward track for stages, league and ranked. This is the
   mid-spender layer that usually makes most of the revenue.
6. **Limited banners and a new legend each season.** These raise the ceiling over time.
7. **Status.** Skins (the alternate models already listed in `SKINS` / `SPARE_MODELS`), a jersey and arena look, and
   the home top 3 crown.

## Order of work

1. Entry flow: auto tutorial on the first visit, skip, chain into stage 1-1, "Continue stages" tile. (PC.)
2. Stage framework: stage definitions (data), scenario runner (reuses the tutorial's setup/tick pattern), boss
   matches, stars, result screen, server progress and rewards. Chapters 1-2 of content.
3. Async league.
4. Awakening + collection book.
5. Tower, passes, banners, skins.

Steps 1-2 are planned in detail now. Steps 3-5 stay a roadmap and get their own design pass once stages are live
(*my call*: they change the economy, server data and VXShop products). When awakening ships, duplicates already
turned into enhancement material stay material, no refund or migration (*my call*, revisit then).

Each step ships on its own (pushed to develop) and is checked in the browser at landscape PC sizes and the narrow
window sizes fixed on 2026-11-11.

## Left to the builder

- Exact stage list, numbers (rewards, boss powers, star conditions) and their balance.
- UI layout of the stage map and stage card, within the current FC Online-style look.
- How scenario stages are set up in code (extend `Tutorial`'s drill pattern or a sibling `StageSession`).
- Server storage shape for stage progress.

## Open questions

None left for the owner at this point.
