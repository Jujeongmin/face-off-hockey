# UI overhaul: ice and steel plates

## Why
The owner finds the current menus look like a website and like AI slop: flat single-colour skewed boxes, stock Korean web
gothic (Black Han Sans / Noto Sans KR) everywhere. A game should look made, with material and depth.

## Decided by the owner (2026-11-10)
- Reference: a hockey mobile-game concept sheet. Ignore its characters and game name; follow the first (home) screen's
  arrangement closely, and use the other screens (lineup on a rink, player list, player detail with stat bars, level-up,
  result with reward slots) as reference.
- Direction B "ice and steel" from the mockup (`.superpowers/brainstorm/.../home-layout.html`):
  dark steel plates with a thin metal edge and a top highlight, square-ish corners (about 6 px), a red bar on the
  left of main buttons, the single most important button as a bright white-ice plate, the real arena behind.
- Fonts: SB Aggro (titles, buttons, numbers) and Pretendard (text). Both free for commercial use.
- Everything changes: home, team, player detail, enhance, market, shop, scout, match HUD (scoreboard, key hints),
  result, loading, help, room / wait screens.
- No emoji or emoji packs anywhere (standing rule). Icons are drawn (inline SVG) or rendered for the game.

## Home layout (from the reference)
- Left: vertical menu with icons (Home, Team, Enhance, Market, Shop, then Practice zone / Tutorial / Controls lower).
  Replaces the top tab bar.
- Top: logo, profile (portrait, nickname with edit, season rank and RP bar), currencies with + buttons, sound and
  language.
- Centre: one big player of my lineup, with the second and third behind.
- Right: big stacked mode plates: Quick match (ranked, the white-ice one), Friend match, AI practice.
- Bottom right: scout banner. Bottom left: season rank plate.

## Mobile (portrait manager mode)
Same plates, buttons and fonts; the left menu becomes a bottom tab bar. My call, not discussed in detail.

## Builder's calls
- Built in HTML/CSS as now: a token layer in `style.css` (`--plate`, `--edge`, `--hi`, `--red`, `--icewhite`) and
  shared classes for plates and buttons, then screen by screen, pushed to develop after each screen.
- Fonts self-served from `public/fonts` (woff2) so the Verse8 build does not depend on a third-party CDN at runtime.
- The home hero uses the existing large portraits first; a full-body render can replace it later.
