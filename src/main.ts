// App shell: title / room / waiting / result screens, and the one render loop that drives the active session.
import { isBadNick } from './game/profanity.ts';
import { HockeyScene, type ViewSkater, type ViewState } from './render/scene.ts';
import { Hud } from './hud.ts';
import { KeyboardInput } from './input.ts';
import { unlockAudio, setMuted, muted, setCrowd, setMusic, uiSound } from './audio.ts';
import { apply as applyI18n, t, setLang, getLang, LANGS, type Lang } from './i18n.ts';
import { LocalSession, HostSession, GuestSession, INTRO_S, type Session, type MatchResult } from './game/sessions.ts';
import { Tutorial } from './game/tutorial.ts';
import { StageSession } from './game/stageSession.ts';
import { stageById, type Outcome } from './game/stages.ts';
import { initStages, loadStages, openStages, reportStage, showStageResult, paintDots, continueId, hasProgress, nextStageModels } from './game/stageScreen.ts';
import { LobbyPractice } from './game/lobbyPractice.ts';
import { LocalLobby, type Lobby, type MatchStart } from './net/lobby.ts';
import { createAgent8Lobby } from './net/agent8.ts';
import { CHARACTERS, CHARACTER, DEFAULT_LINEUPS, FREE, parseLineup, tierOf, ratingOf, overallOf, skillOfModel, powerOf, posOf, offPos, OFF_POS_RATING, type Lineup, type Position } from './game/roster.ts';
import { gradeTag } from './game/grades.ts';
import { PORTRAIT_SHIFT } from './game/portraitShift.ts';
import { ScoutReveal } from './game/reveal.ts';
import { skillCaps, skillName, skillText } from './game/skills.ts';
import { isHeavyModel } from './render/characters.ts';
import { creditsHtml } from './game/credits.ts';
import type { Tactic, Team } from './sim/types.ts';
import { openGuide, closeGuide } from './game/guide.ts';
import { initEconomy, openSquad, openMarket, openShop, watchAd, adsAvailable, paintWallet, type Card } from './game/economy.ts';
import type { Record as Profile } from './net/lobby.ts';
import type { ModelId } from './render/model-ids.ts';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const mobile = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
// Big screens (Verse8 full screen is ~2560 wide): the menus and panels are laid out for about 1600 x 900 and are
// zoomed up from there, so they keep their proportions instead of staying laptop-sized. The 3D canvas is not zoomed.
let uiZoom = 1;
function fitUi() {
  uiZoom = mobile ? 1 : Math.max(1, Math.min(innerWidth / 1600, innerHeight / 900));
  document.documentElement.style.setProperty('--ui-zoom', uiZoom.toFixed(3));
}
fitUi();
addEventListener('resize', fitUi);
// Phones are landscape only (owner 2026-11-11) and lay out like a small PC window: the portrait '.mobile' styles are no
// longer applied. '.touch' marks a touch device (manager matches only, no keyboard hints); held upright, a prompt asks
// to turn the phone.
document.body.classList.toggle('touch', mobile);
const scene = new HockeyScene($('app'), mobile);
scene.setRoster(Array.from({ length: 8 }, (_, i) => ({ team: (i < 4 ? 0 : 1) as 0 | 1, goalie: i % 4 === 3 })));
const hud = new Hud();
const input = new KeyboardInput();
let session: Session | null = null;
let lobby: Lobby = new LocalLobby();
let lastMode: 'quick' | 'practice' | 'watch' | 'room' | 'stage' = 'practice';
let currentMatch = '';

// ------------------------------------------------------------------ screens
const SCREENS = ['title', 'zone', 'team', 'room', 'wait', 'help', 'credits', 'result', 'squad', 'market', 'shop', 'rank', 'stages', 'stageResult'];
const NAV: Record<string, string> = { stages: 'tabStages', title: 'tabHome', team: 'tabTeam', squad: 'tabSquad', market: 'tabMarket', shop: 'tabShop', rank: 'tabRank' };
let shown: string | null = null;
function screen(id: string | null) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  const tab = id ? NAV[id] : undefined;
  $('gnav').classList.toggle('hidden', !tab);
  for (const t of Object.values(NAV)) $(t).classList.toggle('on', t === tab);
  if (id && id !== shown) playEntrance(id);
  shown = id;
  paintDots();
}
// ------------------------------------------------------------------ scout reveal
let revealRest: Card[] = [], revealAgain: (() => void) | null = null, revealDone: () => void = () => {};
/** new cards one by one on the ice; the shop comes back after the last */
function playReveal(cards: Card[], again: (() => void) | null, done: () => void) {
  // a ten is not ten trips to the ice: the best card gets the shot, and all ten are laid out beside it
  const many = cards.length >= 5, grade = (c: Card) => CHARACTER[c.m as ModelId].grade;
  const best = many ? [...cards].sort((a, b) => grade(b) - grade(a) || (a.dup ? 1 : 0) - (b.dup ? 1 : 0))[0] : cards[0];
  revealRest = many ? [] : cards.slice(1); revealAgain = again; revealDone = done;
  $('rvAll').innerHTML = many ? cards.map((c, i) => playerCard(c, i, c === best)).join('') : '';
  const card = best;
  void scene.ensureModels([card.m as ModelId]).finally(() => wipe(() => {        // never a placeholder in the reveal
    stopLobbyPractice(); stopSession(); setCrowd(0.32); hud.show(false); screen(null);
    session = new ScoutReveal(scene, card, () => paintRevealCard(card), many);
  }));
}
/** a rating's colour: red when it is high, orange below that */
const HIGH_RATING = 90;
const tone = (n: number) => (n >= HIGH_RATING ? 'tone-hi' : 'tone-lo');
/** the collectible card: frame art by grade with the portrait between its two layers; the text is sized from the card's own width */
function playerCard(c: Card, order = 0, best = false) {
  const id = c.m as ModelId, ch = CHARACTER[id], ovr = overallOf(id, powerOf(c));
  return `<div class="pc gr${ch.grade}${best ? ' best' : ''}" style="--i:${order}">
    <img src="${portrait(id)}" alt="" style="translate:${PORTRAIT_SHIFT[id] ?? 0}% 0" /><div class="pc-front"></div>
    <b class="pc-ovr ${tone(ovr)}${ovr >= 100 ? ' d3' : ''}">${ovr}</b>${c.l ? `<em class="pc-lv">+${c.l}</em>` : ''}${enhBadge(c.l)}
    <b class="pc-name">${ch.name}</b>${c.dup ? `<u class="pc-dup">${t('rvDupShort')}</u>` : ''}
  </div>`;
}
/** upgrade badge (owner 2026-11-11): bronze from +3, silver from +6, gold from +9; Codex art (tools/codex_enhance_prompt.txt) */
const ENH = ['', 'bronze', 'silver', 'gold'] as const;
const enhTier = (l = 0) => (l >= 9 ? 3 : l >= 6 ? 2 : l >= 3 ? 1 : 0);
const enhBadge = (l = 0, cls = 'pc-enh') => { const k = enhTier(l); return k ? `<img class="${cls}" src="${import.meta.env.BASE_URL}kit/enh_${ENH[k]}.webp" alt="" />` : ''; };
/** fetched at boot, so a card never appears without its frame */
function loadFrames() {
  for (let g = 0; g < 5; g++) for (const layer of ['b', 'f']) new Image().src = `${import.meta.env.BASE_URL}kit/card${g}_${layer}.webp`;
}
function paintRevealCard(c: Card) {
  const sk = skillOfModel(c.m as ModelId);
  $('rvCard').innerHTML = `<div class="rv-c">${playerCard(c)}<p><b>${skillName(sk)}<i class="sk-keys">${skillCaps(sk)}</i></b>${skillText(sk)}</p></div>
    <div class="rv-btns">${revealAgain && !revealRest.length ? `<button id="rvAgain" class="ghost">${t('rvAgain')}</button>` : ''}<button id="rvOk" class="primary">${t('rvOk')}</button></div>`;
}
$('reveal').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button')?.id;
  if (b === 'rvAgain') revealAgain?.();
  else if (b === 'rvOk') {
    if (revealRest.length) playReveal(revealRest, null, revealDone);
    else wipe(() => { stopSession(); setCrowd(0.12); setMusic('lobby'); revealDone(); });
  }
  else if (session instanceof ScoutReveal) session.skip();
});
/** the screen's staggered entrance (style.css `.entering`). A class on a timer, so re-rendering a list later does not replay it */
function playEntrance(id: string) {
  const el = $(id);
  el.classList.add('entering');
  window.setTimeout(() => el.classList.remove('entering'), 900);
}
/** the slash that covers the screen, runs `swap` behind it and sweeps away: match start, result, back home */
const WIPE_COVER_MS = 300, WIPE_CLEAR_MS = 350;
let wiping = false;
function wipe(swap: () => void) {
  if (wiping || matchMedia('(prefers-reduced-motion: reduce)').matches) { swap(); return; }
  wiping = true;
  const el = $('wipe');
  el.className = 'on in';
  window.setTimeout(() => {
    try { swap(); } finally {
      const clear = () => {
        el.className = 'on out';
        window.setTimeout(() => { el.className = ''; wiping = false; }, WIPE_CLEAR_MS);
      };
      // stay covered until the new screen has really drawn (a match's first frame compiles its shaders)
      if (document.hidden) clear(); else requestAnimationFrame(() => requestAnimationFrame(clear));
    }
  }, WIPE_COVER_MS);
}
function toast(msg: string, ms = 2500) {
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout((toast as unknown as { t: number }).t); (toast as unknown as { t: number }).t = window.setTimeout(() => el.classList.remove('show'), ms);
}
const nickInput = $('nick') as HTMLInputElement;
const nick = () => { const n = (nickInput.value.trim() || 'Player').slice(0, 12); return isBadNick(n) ? 'Player' : n; };
try { nickInput.value = localStorage.getItem('faceoff:nick') ?? ''; } catch { /* private mode */ }
if (isBadNick(nickInput.value.trim())) nickInput.value = '';            // saved before the filter existed
// the name in the top bar is not typed into directly: a click opens the nickname panel
nickInput.readOnly = true;
const nickNew = $('nickNew') as HTMLInputElement;
// live preview: the name on a nameplate with my lead skater and rank, a 12-step length meter, and the filter's verdict
$('nickMeter').innerHTML = '<i></i>'.repeat(12);
const nickCount = () => {
  const v = nickNew.value.trim(), n = [...nickNew.value].length, bad = !!v && isBadNick(v);
  $('nickCount').textContent = `${n}/12`;
  $('nickShow').textContent = v || 'Player';
  $('nickMeter').querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < n));
  const sheet = $('nickPanel').querySelector('.nick-sheet')!;
  sheet.classList.toggle('bad', bad); sheet.classList.toggle('ok', !!v && !bad);
  $('nickMsg').textContent = bad ? t('nickBad') : t('nickHint');
  ($('bNickSave') as HTMLButtonElement).disabled = bad;
};
function openNick() {
  ($('nickAva') as HTMLImageElement).src = ($('profAva') as HTMLImageElement).src;
  $('nickRank').innerHTML = $('rankMini').innerHTML;
  nickNew.value = nickInput.value; nickCount();
  $('nickPanel').classList.remove('hidden');
  nickNew.focus(); nickNew.select();
}
const closeNick = () => $('nickPanel').classList.add('hidden');
function saveNick() {
  const v = nickNew.value.trim().slice(0, 12);
  // swearing, slurs or a staff name: refused, the panel stays open (the server also turns it into Player)
  if (v && isBadNick(v)) { toast(t('nickBad')); nickNew.focus(); return; }
  nickInput.value = v;
  try { localStorage.setItem('faceoff:nick', nick()); } catch { /* */ }
  closeNick();
  pushNick();                                                // the ranking shows it; offline play does not need it
}
nickInput.closest('.nick-row')!.addEventListener('click', e => { e.preventDefault(); openNick(); });
nickNew.addEventListener('input', nickCount);
nickNew.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) saveNick(); if (e.key === 'Escape') closeNick(); });
$('bNickSave').addEventListener('click', saveNick);
$('bNickCancel').addEventListener('click', closeNick);
$('nickPanel').addEventListener('click', e => { if (e.target === e.currentTarget) closeNick(); });

// ------------------------------------------------------------------ profile: record, season rank, coins, unlocks
let profile: Profile | null = null;
// before the server's record arrives (or when it cannot be reached) only the free players count as owned, never all of them
const owns = (id: ModelId) => (profile?.owned ? profile.owned.includes(id) : FREE.includes(id));
const tierName = (key: string) => t(('tier_' + key) as Parameters<typeof t>[0]);
async function showRecord() {
  void loadTop3();
  const stamp = syncSeq;
  profile = await lobby.record().catch(() => null);
  syncAccount(stamp);
  paintRecord();
  fixLineup();
  paintProfEnh();
  void loadStages();
}
/**
 * The name and the picked team live with the account on the server, so a phone and a PC show the same ones.
 * Every time the record is fetched (page load, back to the home screen): a change made here that has not reached
 * the server yet (made offline, before the connection, or the call failed) is sent again and wins; otherwise the
 * server's copy wins, so a device left open picks up what another device changed. An account with nothing stored
 * takes this device's. A record that was requested before a local change (or before its send finished) is stale
 * and is not applied: syncSeq moves on every local change and every finished send.
 */
let syncSeq = 0;
const DIRTY = { nick: 'faceoff:nickDirty', lineup: 'faceoff:lineupDirty' } as const;
const isDirty = (k: keyof typeof DIRTY) => { try { return localStorage.getItem(DIRTY[k]) === '1'; } catch { return false; } };
const setDirty = (k: keyof typeof DIRTY, on: boolean) => { try { if (on) localStorage.setItem(DIRTY[k], '1'); else localStorage.removeItem(DIRTY[k]); } catch { /* */ } };
function pushNick() {
  setDirty('nick', true); syncSeq++;
  if (lobby.kind !== 'agent8') return;                       // sent once the server is there (syncAccount)
  const sent = nick();
  // shown at once where my name is on show (top 3, ranking screen), then confirmed from the server
  if (board) { for (const e of board.top) if (e.me) e.nick = sent; if (board.mine) board.mine.nick = sent; paintTop3(); }
  if (shown === 'rank') for (const el of document.querySelectorAll('#rankList li.me .rk-who b, #rankMe li.me .rk-who b')) el.textContent = sent;
  void lobby.rpc('setNick', [sent]).then(() => { if (nick() === sent) setDirty('nick', false); syncSeq++; void loadTop3(); if (shown === 'rank') void openRank(); }).catch(() => null);
}
function syncAccount(stamp: number) {
  if (!profile || lobby.kind !== 'agent8' || stamp !== syncSeq) return;
  const sv = typeof profile.nick === 'string' ? profile.nick : '', mine = nickInput.value.trim();
  if (isDirty('nick')) pushNick();
  else if (sv && sv !== 'Player') {
    if (sv !== mine) { nickInput.value = sv; try { localStorage.setItem('faceoff:nick', sv); } catch { /* */ } }
  } else if (mine && !isBadNick(mine)) pushNick();
  const sl = parseLineup(profile.lineup);
  if (isDirty('lineup')) pushLineup();
  else if (sl && seatIds(sl).every(owns)) {
    if (JSON.stringify(sl) !== JSON.stringify(lineup)) { lineup = sl; saveLineup(false); }
  } else pushLineup();
}
function paintRecord() {
  $('record').textContent = profile ? `${t('record')} ${profile.w}${t('wins')} ${profile.l}${t('losses')}` : '';
  renderRank();
}
function renderRank() {
  const el = $('rankCard');
  if (!profile || profile.rp == null) { el.innerHTML = ''; return; }
  const tr = tierOf(profile.rp);
  el.innerHTML = `<i class="emblem" style="background:${tr.color}"></i>
    <div class="rk-mid"><div class="rk-line"><span class="rk-tier" style="color:${tr.color}">${tierName(tr.key)}</span><span class="rk-rp">${profile.rp} RP</span></div>
      <div class="rk-bar"><i style="width:${(tr.frac * 100).toFixed(1)}%;background:${tr.color}"></i></div>
      <div class="rk-sub">${tr.next != null ? `${t('toNext')} ${tr.next - profile.rp}` : ''}</div></div>`;
  $('seasonTag').textContent = `${t('season')} ${profile.season ?? ''}`;
  $('rankMini').innerHTML = `<b style="color:${tr.color}">${tierName(tr.key)}</b> ${profile.rp} RP<i><u style="width:${(tr.frac * 100).toFixed(1)}%;background:${tr.color}"></u></i>`;
  paintWallet();
}
/** a saved lineup with a character this account does not own: swap in owned ones */
function fixLineup() {
  if (!profile?.owned) return;
  const ids = seatIds(lineup);
  if (ids.every(owns)) return;
  const spare = FREE.filter(id => !ids.includes(id));
  const fixed = ids.map(id => (owns(id) ? id : spare.shift() ?? id));
  lineup = { skaters: [fixed[0], fixed[1], fixed[2]], goalie: fixed[3] };
  saveLineup();
}
function toTitle() {
  firstRun = false;                       // the first visit's run ends at home, finished or left
  stopSession(); stopLobbyPractice(); hud.show(false); screen('title'); setCrowd(0.12); setMusic('lobby');
  $('pcMenu').classList.toggle('hidden', mobile); $('mobileMenu').classList.toggle('hidden', !mobile);
  void showRecord();
}

// ------------------------------------------------------------------ my team
let lineup: Lineup = DEFAULT_LINEUPS[0];
try { lineup = parseLineup(JSON.parse(localStorage.getItem('faceoff:lineup') ?? 'null')) ?? lineup; } catch { /* keep the default */ }
let seat = 0;                                                   // 0..2 skaters, 3 goalie
/** a redrawn portrait gets a new file name: Verse8 keeps serving the old image under the old one */
const portraitRev = (id: ModelId) => (id === 'bg4' || id === 'oni' || id === 'mking' ? 3 : 2);   // a redrawn portrait gets a new name (Verse8 caches by name)
const portrait = (id: ModelId) => `${import.meta.env.BASE_URL}portraits/${id}_s${portraitRev(id)}.webp`;
const portraitH = (id: ModelId) => `${import.meta.env.BASE_URL}portraits/${id}_h${portraitRev(id)}.webp`;   // the large images on the home and team screens
const seatIds = (l: Lineup) => [...l.skaters, l.goalie] as ModelId[];
const roleKey = { all: 'rAll', sniper: 'rSniper', playmaker: 'rPlaymaker', enforcer: 'rEnforcer', speedster: 'rSpeedster', wall: 'rWall' } as const;
function saveLineup(push = true) {
  try { localStorage.setItem('faceoff:lineup', JSON.stringify(lineup)); } catch { /* */ }
  renderPeek(); void scene.ensureModels(seatIds(lineup));
  if (push) pushLineup();
}
/** the server keeps the team for the other devices; several quick changes send one call */
let lineupTimer = 0;
function pushLineup() {
  setDirty('lineup', true); syncSeq++;
  if (lobby.kind !== 'agent8') return;                       // sent once the server is there (syncAccount)
  clearTimeout(lineupTimer);
  lineupTimer = window.setTimeout(() => {
    const sent = JSON.stringify(lineup);
    void lobby.rpc<{ ok: boolean }>('setLineup', [lineup]).then(r => { if (r?.ok && JSON.stringify(lineup) === sent) setDirty('lineup', false); syncSeq++; }).catch(() => null);
  }, 700);
}
/** the AI's team in practice: the best of whoever I did not pick, so no model plays on both sides */
function aiLineup(): Lineup {
  const mine = new Set(seatIds(lineup));
  const rest = CHARACTERS.filter(c => !mine.has(c.id)).map(c => c.id);
  return { skaters: [rest[0], rest[1], rest[2]], goalie: rest[3] };
}
function putInSeat(id: ModelId) {
  const ids = seatIds(lineup);
  const already = ids.indexOf(id);
  if (already === seat) return;
  if (already >= 0) ids[already] = ids[seat];                   // swap the two seats
  ids[seat] = id;
  lineup = { skaters: [ids[0], ids[1], ids[2]], goalie: ids[3] };
  saveLineup(); renderTeam();                                   // the seat just filled stays selected (it used to jump to the next one)
}
function renderPeek() {
  lineup.skaters.forEach((id, i) => { ($(`hero${i}`) as HTMLImageElement).src = portraitH(id); });
  ($('profAva') as HTMLImageElement).src = portrait(lineup.skaters[0]);
  paintProfEnh();
  paintHeroTag();
  $('peek').innerHTML = $('peekM').innerHTML = seatIds(lineup).map((id, i) => `<img src="${portrait(id)}" alt="${CHARACTER[id].name}" class="${i === 3 ? 'g' : ''}" />`).join('');
}
/** the lead skater's upgrade badge on the profile picture */
function paintProfEnh() { $('profEnh').innerHTML = enhBadge(bestCardOf(lineup.skaters[0])?.l, 'g-enh'); }
/** the big player on the team screen: the card under the mouse, or whoever sits in the chosen seat */
function showPlayer(id: ModelId) {
  const c = CHARACTER[id], card = bestCardOf(id), lv = powerFor(id);
  ($('tmHero') as HTMLImageElement).src = portraitH(id);
  const at = seatIds(lineup).indexOf(id);
  $('tmRole').textContent = `${t(roleKey[c.role])} · ${t('posRec')} ${posName(posOf(id))}${at >= 0 && offPos(id, at) ? ` · ${t('posOff').replace('{n}', String(OFF_POS_RATING))}` : ''}`;
  $('tmName').textContent = c.name;
  $('tmLv').innerHTML = `${gradeTag(c.grade)}${card?.l ? ` +${card.l}` : ''}${enhBadge(card?.l, 'tm-enh')}`;
  const sk = skillOfModel(id);
  $('tmSkill').innerHTML = `<i class="sk-keys">${skillCaps(sk)}</i><b>${skillName(sk)}</b><span>${skillText(sk)}</span>`;
  const rows = [['stSpd', c.stats.spd], ['stSht', c.stats.sht], ['stPas', c.stats.pas], ['stChk', c.stats.chk], ['stHnd', c.stats.hnd]] as const;
  $('tmStats').innerHTML = rows.map(([k, v]) => { const n = ratingOf(v, lv); return `<div class="r"><span>${t(k)}</span><i><b style="width:${Math.min(100, n)}%"></b></i><u class="${tone(n)}">${n}</u></div>`; }).join('');
}
const seatName = (i: number) => (i === 3 ? t('posG') : t('seatN').replace('{n}', String(i + 1)));
const POS_KEY = { FW: 'posFW', D: 'posD', G: 'posG' } as const;
const posName = (p: Position) => t(POS_KEY[p]);
/** the rating a player brings in a seat: out of position costs OFF_POS_RATING */
const seatOvr = (id: ModelId, i: number) => overallOf(id, powerFor(id)) - (offPos(id, i) ? OFF_POS_RATING : 0);
function renderTeam() {
  const ids = seatIds(lineup);
  // the four seats stand on a drawn half rink: three skaters up ice, the goalie in the crease
  $('bench').innerHTML = `<i class="rk-ice" aria-hidden="true"></i>` + ids.map((id, i) => `<button class="seat s${i} ${i === 3 ? 'g' : ''} ${i === seat ? 'on' : ''}" data-seat="${i}"><img src="${portrait(id)}" alt="" /><u>${seatName(i)}</u><b>${CHARACTER[id].name}</b><em class="seat-pos${offPos(id, i) ? ' off' : ''}" title="${offPos(id, i) ? t('posOff').replace('{n}', String(OFF_POS_RATING)) : ''}">${posOf(id)}</em><i class="${tone(seatOvr(id, i))}">${seatOvr(id, i)}</i></button>`).join('');
  $('tmPowerN').textContent = String(Math.round(ids.reduce((sum, id, i) => sum + seatOvr(id, i), 0) / ids.length));
  $('cards').innerHTML = CHARACTERS.filter(c => owns(c.id)).map(c => {
    const at = ids.indexOf(c.id), tag = at < 0 ? '' : seatName(at);
    return `<button class="pick ${at >= 0 ? 'in' : ''} ${at === seat ? 'cur' : ''}" data-id="${c.id}">${playerCard(bestCardOf(c.id) ?? { u: 0, m: c.id, l: 0 })}${tag ? `<span class="seat-tag">${tag}</span>` : ''}</button>`;
  }).join('');
  $('tmCount').textContent = String($('cards').children.length);
  showPlayer(ids[seat]);
}
$('cards').addEventListener('mouseover', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('.pick'); if (b) showPlayer(b.dataset.id as ModelId); });
$('cards').addEventListener('mouseleave', () => showPlayer(seatIds(lineup)[seat]));
$('bench').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('.seat'); if (b) { seat = Number(b.dataset.seat); renderTeam(); } });
$('cards').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.pick'); if (!b) return;
  putInSeat(b.dataset.id as ModelId);
});

// ------------------------------------------------------------------ sessions
function stopSession() { session?.dispose(); session = null; scene.celebrations = false; input.enabled = true; input.skill = 'none'; }
// ------------------------------------------------------------------ lobby practice (behind the menus, PC only)
let lobbyPlay: LobbyPractice | null = null;
function startLobbyPractice() {
  if (mobile) return;
  lobbyPlay = new LobbyPractice(scene, hud, input, [lineup, aiLineup()]);
  lobbyPlay.onScore = (g, s) => { $('pcScore').textContent = `${t('pcGoals')} ${g} · ${t('pcSaves')} ${s}`; };
  $('pcScore').textContent = `${t('pcGoals')} 0 · ${t('pcSaves')} 0`;
  scene.setSide(0);                       // the tutorial's camera (the match's broadcast view following the play), not a quarter view of the zone
}
function stopLobbyPractice() { lobbyPlay = null; }
function begin(s: Session, a: string, b: string, lineups: [Lineup, Lineup], intro = true) {
  stopLobbyPractice(); stopSession(); setCrowd(0.32); setMusic('match'); session = s; scene.celebrations = true; $('tactics').classList.add('hidden'); hud.reset(); hud.setNames(a, b); hud.setLineups(lineups); hud.ping('');
  const started = performance.now();
  wipe(() => { if (session !== s) return; hud.show(true); screen(null); if (intro) showIntro(lineups, performance.now() - started); });
}
/** both lineups slide in while the sim holds the first puck drop (INTRO_S) */
let introTimer = 0;
function showIntro(l: [Lineup, Lineup], lateMs: number) {
  const side = (x: Lineup) => seatIds(x).map((id, i) => `<figure class="${i === 3 ? 'g' : ''}"><img src="${portrait(id)}" alt="" /><figcaption>${CHARACTER[id].name}</figcaption></figure>`).join('');
  $('in0').innerHTML = side(l[0]); $('in1').innerHTML = side(l[1]);
  const el = $('intro'); el.classList.remove('hidden', 'out');
  clearTimeout(introTimer);
  introTimer = window.setTimeout(() => { el.classList.add('out'); introTimer = window.setTimeout(() => el.classList.add('hidden'), 380); }, (INTRO_S - 0.4) * 1000 - lateMs);
}
function finished(r: MatchResult) {
  if (r.aborted) {                       // the other player never showed up: no record, back to the search
    stopSession(); hud.show(false); toast(t('oppLeft'));
    if (lastMode === 'quick') void quick(); else toTitle();
    return;
  }
  if (lastMode !== 'practice' && lastMode !== 'watch') void lobby.report(currentMatch, r).catch(() => {});
  wipe(() => showResult(r));
}
/** one line of the result's comparison: both numbers and a bar split by who had more */
function statRow(label: string, a: number, b: number) {
  const left = a + b ? (a / (a + b)) * 100 : 50;
  return `<div class="rs-stat"><b>${a}</b><span>${label}</span><b>${b}</b><i><u style="width:${left.toFixed(1)}%"></u></i></div>`;
}
function showResult(r: MatchResult) {
  hud.show(false);
  const won = r.winner === r.me, draw = r.winner === -1;
  $('resTitle').textContent = draw ? t('draw') : won ? t('win') : t('lose');
  $('resTitle').style.color = draw || won ? '' : '#d3262c';
  const names = [$('n0').textContent ?? '', $('n1').textContent ?? ''];
  $('resBug').innerHTML = `<div class="rs-n a"><b>${r.score[0]}</b><span>${esc(names[0])}</span></div><div class="rs-n b"><b>${r.score[1]}</b><span>${esc(names[1])}</span></div>`
    + (r.shootout ? `<div class="rs-so">SO ${r.shootout[0]} : ${r.shootout[1]}</div>` : '');
  const m = r.forfeit ? null : hud.mvp(r.winner);
  $('resMvp').innerHTML = m ? `<img src="${portrait(m.model)}" alt="" /><div class="txt"><div class="k">${t('mvp')}</div><div class="n">${m.name}</div><div class="s">${t('goalsShort')} ${m.goals} · ${t('shotsShort')} ${m.shots}</div></div>` : '';
  $('resStats').innerHTML = r.forfeit ? t('oppLeft') : statRow(t('shots'), r.shots[0], r.shots[1]) + statRow(t('saves'), r.saves[0], r.saves[1]);
  $('resRank').innerHTML = '';
  $('bAdResult').classList.toggle('hidden', lastMode === 'practice' || !adsAvailable());   // manager matches (the phone's only mode) offer it too
  ($('bAdResult') as HTMLButtonElement).disabled = false;
  $('bAdResult').textContent = t('adBonus').replace('{n}', '20');
  if (lastMode === 'quick' || lastMode === 'room') void showRankChange(lastMode === 'quick');
  screen('result');
}
/** after an online match: wait for the server to settle (both reports), then show what changed */
async function showRankChange(rankedMatch: boolean) {
  const el = $('resRank'), before = profile;
  el.innerHTML = `<span class="rk-wait">${t('tallying')}</span>`;
  const games = (p: Profile | null) => (p ? p.w + p.l + p.d : 0);
  let after: Profile | null = null;
  for (let i = 0; i < 10; i++) {
    await new Promise(res => setTimeout(res, 1200));
    after = await lobby.record().catch(() => null);
    if (after && games(after) > games(before)) break;
  }
  if (!after || games(after) <= games(before)) { el.innerHTML = `<span class="rk-wait">${t('notRecorded')}</span>`; return; }
  profile = after; renderRank();
  if (!rankedMatch || after.rp == null || before?.rp == null) { el.innerHTML = `<span class="rk-wait">${t('recorded')}</span>`; return; }
  const d = after.rp - before.rp, c = (after.coins ?? 0) - (before.coins ?? 0);
  const t0 = tierOf(before.rp), t1 = tierOf(after.rp);
  el.innerHTML = `<div class="rk-delta ${d >= 0 ? 'up' : 'down'}"><b id="rkNum">${before.rp}</b> RP <span>${d >= 0 ? '+' : ''}${d}</span></div>
    <div class="rk-coin"><i class="coin"></i> +${c}</div>
    ${t1.index !== t0.index ? `<div class="rk-promo" style="color:${t1.color}">${tierName(t1.key)} ${t1.index > t0.index ? t('promoted') : t('demoted')}</div>` : ''}`;
  const num = $('rkNum'), start = performance.now();
  const step = (now: number) => { const k = Math.min(1, (now - start) / 900); num.textContent = String(Math.round(before.rp! + d * k)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
/** `then`: what follows the tutorial (the first visit goes on to stage 1-1); default back home */
function tutorial(then?: () => void) {
  lastMode = 'practice';
  stopLobbyPractice(); stopSession(); hud.reset(); hud.setNames(nick(), t('tutorial')); hud.setLineups([lineup, aiLineup()]); hud.ping('');
  const tut = new Tutorial(scene, hud, input, () => { $('bTutorial').classList.remove('hot'); paintDots(); if (then) then(); else { wipe(toTitle); toast(t('tutDone')); } }, [lineup, aiLineup()]);
  session = tut;
  wipe(() => { if (session !== tut) return; hud.show(true); screen(null); });   // left before the wipe finished: home stays
}
// ------------------------------------------------------------------ first visit
// Straight into play: no home screen first. PC: the tutorial, then stage 1-1; phones: stage 1-1 as a coached manager
// match. A first visit = no tutorial flag on this device AND an account with no games and no stage progress (a known
// player on a new device is not sent through it again). The server is given a few seconds; without it the flag decides.
const sleep = (ms: number) => new Promise<null>(r => setTimeout(() => r(null), ms));
const FIRST_VISIT_WAIT_MS = 3500;
async function firstVisit(): Promise<boolean> {
  try { if (localStorage.getItem('faceoff:tutorial') || localStorage.getItem('faceoff:welcomed')) return false; } catch { /* private mode: treat as new */ }
  if (hasProgress()) return false;
  // one budget for the whole check (connection + record + stages), so a slow server holds the loading screen ~3.5 s at
  // most; a known player on a slow new device may then see the tutorial again (it has a Skip button)
  const end = performance.now() + FIRST_VISIT_WAIT_MS;
  const left = () => sleep(Math.max(0, end - performance.now()));
  const known = () => { try { localStorage.setItem('faceoff:tutorial', '1'); } catch { /* */ } return false; };
  try {
    if (await Promise.race([lobbyReady.then(() => true), left()]) === null) return true;
    const [rec, st] = await Promise.race([
      Promise.all([lobby.record().catch(() => null), lobby.rpc<{ stars: Record<string, number> }>('getStages').catch(() => null)]),
      left().then(() => [null, null] as const),
    ]);
    if (rec && rec.w + rec.l + rec.d > 0) return known();
    if (st && Object.keys(st.stars ?? {}).length) return known();
  } catch { /* no server: a new device it is */ }
  return true;
}
function startFirstVisit() {
  firstRun = true;
  if (mobile) stage('1-1', true);
  else tutorial(() => { firstRun = true; stage('1-1'); });
}
/** mobile manager: the instruction my team's AI is following */
function paintTactic(tc: Tactic) {
  for (const b of $('tactics').querySelectorAll<HTMLElement>('button')) { const on = b.dataset.t === tc; b.classList.toggle('primary', on); b.classList.toggle('ghost', !on); b.setAttribute('aria-pressed', String(on)); }
}
$('tactics').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-t]');
  if (!b || !(session instanceof LocalSession || session instanceof StageSession)) return;
  session.match.tactic[0] = b.dataset.t as Tactic; paintTactic(b.dataset.t as Tactic);
});
/** my best card of each picked character sets that seat's enhancement */
function bestCardOf(id: ModelId) { let best: Card | null = null; for (const c of (profile?.cards ?? []) as Card[]) if (c.m === id && (!best || powerOf(c) > powerOf(best))) best = c; return best; }
const powerFor = (id: ModelId) => powerOf(bestCardOf(id) ?? { m: id, l: 0 });
const withLevels = (l: Lineup): Lineup => ({ ...l, levels: seatIds(l).map(powerFor) });
function practice(watch = false) {
  lastMode = watch ? 'watch' : 'practice';
  const mine = withLevels(lineup);
  const s = new LocalSession(scene, hud, input, watch, finished, [mine, aiLineup()]);
  begin(s, nick(), 'AI', [mine, aiLineup()]);
  $('tactics').classList.toggle('hidden', !watch); paintTactic('balanced'); hud.auto = watch;
}
/** a stage: PC plays it with the keys, phones as a manager match; `coach` adds the first-visit tactic prompts */
let lastStage = '1-1';
function stage(id: string, coach = false) {
  const st = stageById(id);
  if (!st) return;
  lastMode = 'stage'; lastStage = id; stageStarted = performance.now();
  const s = new StageSession(scene, hud, input, st, withLevels(lineup), { manager: mobile, coach }, (o, stars) => stageEnded(id, o, stars));
  begin(s, nick(), t(st.name), s.run.lineups, !st.scenario);       // scenarios start at once: no lineup intro
  $('tactics').classList.toggle('hidden', !mobile); paintTactic('balanced'); hud.auto = mobile;
}
/** the stage is over: report it (the server pays), then the result screen with the stars */
let stageStarted = 0, firstRun = false;
function stageEnded(id: string, o: Outcome, stars: number) {
  const reward = reportStage(id, o, stars, (performance.now() - stageStarted) / 1000);
  const first = firstRun; firstRun = false;
  if (first) try { localStorage.setItem('faceoff:welcomed', '1'); } catch { /* */ }   // the first run is over, cleared or not
  wipe(() => { stopSession(); hud.show(false); setCrowd(0.12); setMusic('lobby'); showStageResult(id, o, stars, reward, { firstRun: first }); });
}
function online(start: MatchStart) {
  currentMatch = start.matchId;
  const s = start.team === 0 ? new HostSession(scene, hud, input, start.link, finished, start.lineups) : new GuestSession(scene, hud, input, start.link, finished, start.lineups);
  const [a, b] = start.team === 0 ? [nick(), start.opponent] : [start.opponent, nick()];
  begin(s, a, b, start.lineups);
  hud.chatOn(!mobile);
}
function waiting(title: string, msg: string, code = '') {
  screen('wait'); $('waitTitle').textContent = title; $('waitMsg').textContent = msg; $('waitCode').textContent = code;
}
async function quick() {
  lastMode = 'quick';
  waiting(t('quick'), t('searching'));
  // a room can fill or close between the search and the seat (its player cancelled): just search again
  for (let attempt = 0; ; attempt++) {
    try { online(await lobby.quick(nick(), lineup)); return; }
    catch (e) {
      const msg = String((e as Error).message || e);
      if (msg === 'full' && attempt < 4) continue;
      if (msg !== 'cancelled') { toast(msg); toTitle(); }
      return;
    }
  }
}
async function createRoom() {
  lastMode = 'room';
  try {
    const { code, ready } = await lobby.create(nick(), lineup);
    waiting(t('roomWait'), t('roomShare'), code);
    online(await ready);
  } catch (e) { if ((e as Error).message !== 'cancelled') { toast(String((e as Error).message || e)); screen('room'); } }
}
async function joinRoom() {
  lastMode = 'room';
  const code = ($('code') as HTMLInputElement).value.trim().toUpperCase();
  if (code.length < 4) return;
  waiting(t('friend'), t('connecting'), code);
  try { online(await lobby.join(code, nick(), lineup)); } catch (e) { if ((e as Error).message !== 'cancelled') { toast(String((e as Error).message || e)); screen('room'); } }
}

// ------------------------------------------------------------------ chat (online matches on PC)
// Enter opens the box (the game keys stop while it has the keyboard), Enter sends, Esc or leaving it closes it.
const chatBox = $('chat'), chatIn = $('chatIn') as HTMLInputElement;
function chatOpen(open: boolean) {
  chatIn.classList.toggle('hidden', !open); chatBox.classList.toggle('typing', open);
  if (open) { input.releaseAll(); chatIn.placeholder = t('chatPh'); chatIn.focus(); } else { chatIn.value = ''; chatIn.blur(); }
}
addEventListener('keydown', e => {
  if (e.code !== 'Enter' || e.target === chatIn || !session?.say || chatBox.classList.contains('hidden')) return;
  e.preventDefault(); chatOpen(true);
});
chatIn.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.code === 'Escape') { chatOpen(false); return; }
  if (e.code !== 'Enter' || e.isComposing) return;              // Enter that ends an IME composition (Korean, Japanese, Chinese) is not a send
  e.preventDefault();
  const text = chatIn.value;
  chatOpen(false);
  if (text.trim() && session?.say) void session.say(text).then(r => { if (r === 'slow') toast(t('chatSlow')); });
});
$('chatMute').addEventListener('click', e => { (e.currentTarget as HTMLElement).blur(); hud.setChatMuted(!hud.chatMuted); });
chatIn.addEventListener('blur', () => { if (!chatIn.classList.contains('hidden')) chatOpen(false); });

// ------------------------------------------------------------------ buttons
const on = (id: string, f: () => void) => $(id).addEventListener('click', () => { unlockAudio(); f(); });
on('bQuick', () => void quick());
on('bRoom', () => screen('room'));
on('bTeam', () => { renderTeam(); screen('team'); });
for (const [a, f] of [['tabSquad', openSquad], ['tabMarket', openMarket], ['tabShop', openShop]] as const) on(a, () => void f());
on('tabHome', () => { screen('title'); void showRecord(); });
on('tabTeam', () => { renderTeam(); screen('team'); });
// ------------------------------------------------------------------ season ranking (server: leaderboard)
interface Board { season: string; top: { nick: string; lead?: string; rp: number; w: number; l: number; me: boolean }[]; mine: { rank: number; rp: number; nick: string; w: number; l: number } | null }
function rankRow(n: number, nk: string, rp: number, w: number, l: number, me: boolean) {
  const tr = tierOf(rp);
  return `<li class="${me ? 'me' : ''} ${n <= 3 ? `top${n}` : ''}"><b class="rk-n">${n}</b><span class="rk-who"><b>${esc(nk)}</b><small style="color:${tr.color}">${tierName(tr.key)}</small></span><b class="rk-rp">${rp}</b><span class="rk-wl">${w}${t('wins')} ${l}${t('losses')}</span></li>`;
}
/** the home screen's season top 3, always on show; refreshed on every visit home and right after a name change */
let board: Board | null = null;
async function loadTop3() {
  if (lobby.kind !== 'agent8') { $('top3').classList.add('hidden'); return; }
  try { board = await lobby.rpc<Board>('leaderboard'); } catch { /* keep the last one */ }
  paintTop3();
}
/** podium art generated with Codex (tools/codex_podium_prompt.txt, tools/podium_art.py): crown, silver / bronze medals; no pedestals */
const KIT = `${import.meta.env.BASE_URL}kit/`;
function paintTop3() {
  const el = $('top3');
  if (!board) { el.classList.add('hidden'); return; }
  const rows = board.top.slice(0, 3);
  // a podium: second, champion, third; the champion stands highest under the crown
  const spot = (i: number) => {
    const e = rows[i];
    const mark = i === 0 ? `<img class="t3-crown" src="${KIT}podium_crown.webp" alt="" />` : `<img class="t3-medal" src="${KIT}podium_medal${i + 1}.webp" alt="" />`;
    if (!e) return `<div class="t3-spot t3-p${i + 1} empty">${mark}</div>`;
    const face = e.lead && CHARACTER[e.lead as ModelId] ? `<div class="t3-face"><img src="${portrait(e.lead as ModelId)}" alt="" style="translate:${PORTRAIT_SHIFT[e.lead] ?? 0}% 0" /></div>` : '';   // entries from before the lead was kept have none
    return `<div class="t3-spot t3-p${i + 1}${e.me ? ' me' : ''}">${mark}${face}`
      + `<span class="t3-who">${esc(e.nick)}</span><b class="t3-rp">${e.rp} RP</b></div>`;
  };
  el.innerHTML = `<h4>${t('top3Title')}</h4>` + (rows.length ? `<div class="t3-pod">${spot(1)}${spot(0)}${spot(2)}</div>` : `<p>${t('rankEmpty')}</p>`);
  el.classList.remove('hidden');
}
async function openRank() {
  screen('rank');
  $('rankList').innerHTML = `<li class="rk-note">${t('mkLoading')}</li>`; $('rankMe').innerHTML = '';
  let b: Board;
  try { b = await lobby.rpc<Board>('leaderboard'); } catch { $('rankList').innerHTML = `<li class="rk-note">${t('eServer')}</li>`; return; }
  if (shown !== 'rank') return;
  $('rankSeason').textContent = b.season;
  $('rankList').innerHTML = b.top.length ? b.top.map((e, i) => rankRow(i + 1, e.nick, e.rp, e.w, e.l, e.me)).join('') : `<li class="rk-note">${t('rankEmpty')}</li>`;
  $('rankMe').innerHTML = b.mine ? `<small>${t('rankMine')}</small><ol class="rk-list">${rankRow(b.mine.rank, b.mine.nick, b.mine.rp, b.mine.w, b.mine.l, true)}</ol>` : `<p class="rk-note">${t('rankNone')}</p>`;
}
on('tabRank', () => void openRank());
on('tabStages', () => void openStages());
on('bStage', () => stage(continueId()));
on('bStageM', () => stage(continueId()));
on('bStageNext', () => { const id = $('bStageNext').dataset.st; if (id) stage(id); });
on('bStageRetry', () => stage(lastStage));
on('bStageHome', () => wipe(toTitle));
on('bZone', () => { screen('zone'); startLobbyPractice(); });
on('bZoneBack', () => { stopLobbyPractice(); screen('title'); });
on('bAdResult', () => { ($('bAdResult') as HTMLButtonElement).disabled = true; void watchAd('result-coins').then(got => { if (got) $('bAdResult').classList.add('hidden'); else ($('bAdResult') as HTMLButtonElement).disabled = false; }); });
on('bTeamM', () => { renderTeam(); screen('team'); });
on('bTeamDone', () => { screen('title'); void showRecord(); });
on('bPractice', () => practice(false));
on('bTutorial', () => tutorial());
on('drSkip', () => { if (session instanceof Tutorial) session.skip(); });
on('bWatch', () => practice(true));
on('bHelp', () => { openGuide(mobile); screen('help'); });
on('bHelpBack', () => { closeGuide(); screen('title'); });
let creditsFrom: 'help' | 'title' = 'help';
on('bCredits', () => { closeGuide(); creditsFrom = 'help'; $('creditsList').innerHTML = creditsHtml(); screen('credits'); });
on('bCreditsM', () => { creditsFrom = 'title'; $('creditsList').innerHTML = creditsHtml(); screen('credits'); });   // phones: from the home screen
on('bCreditsBack', () => { if (creditsFrom === 'help') { openGuide(mobile); screen('help'); } else screen('title'); });
on('bRoomBack', () => screen('title'));
on('bCreate', () => void createRoom());
on('bJoin', () => void joinRoom());
on('bCancel', () => { lobby.cancel(); toTitle(); });
// one click used to end the match on the spot, and a match left online counts as a loss. The tutorial has nothing to lose
const closeQuit = () => $('quitAsk').classList.add('hidden');
const quitOpen = () => !$('quitAsk').classList.contains('hidden');
on('bQuit', () => {
  if (session instanceof Tutorial) { wipe(toTitle); return; }
  if (session instanceof StageSession && session.finishNow()) return;   // already cleared or failed: go to its result
  $('quitText').textContent = t(session instanceof LocalSession || session instanceof StageSession ? 'quitLocal' : 'quitOnline');
  $('quitAsk').classList.remove('hidden');
});
on('bQuitNo', closeQuit);
on('bQuitYes', () => { closeQuit(); wipe(toTitle); });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && quitOpen()) closeQuit(); });
on('bLobby', () => wipe(toTitle));
on('bAgain', () => { if (lastMode === 'quick') void quick(); else if (lastMode === 'room') screen('room'); else if (lastMode === 'stage') stage(lastStage); else practice(lastMode === 'watch'); });
// a language change redraws whichever screen is open, so nothing stays half translated
// our own drop-down: a native <select> list is drawn by the browser (white on white in some themes)
const langPicks = ['bLang', 'bLangM'].map(id => $(id));
const langName = (l: Lang) => LANGS.find(([k]) => k === l)?.[1] ?? l;
function paintLangPicks() {
  for (const pick of langPicks) {
    const short = ({ ko: 'KO', en: 'EN', ja: 'JA', 'zh-Hant': '繁', 'zh-Hans': '简' } as Record<Lang, string>)[getLang()];
    pick.innerHTML = `<button class="lsel-btn" type="button" aria-haspopup="listbox" aria-label="Language"><span>${langName(getLang())}</span><em>${short}</em><i></i></button>
      <div class="lsel-list" role="listbox">${LANGS.map(([l, name]) => `<button type="button" role="option" data-lang="${l}" class="${l === getLang() ? 'on' : ''}">${name}</button>`).join('')}</div>`;
  }
}
paintLangPicks();
for (const pick of langPicks) {
  pick.addEventListener('click', e => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-lang]');
    if (!opt) { pick.classList.toggle('open'); return; }
    pick.classList.remove('open');
    if (opt.dataset.lang === getLang()) return;
    setLang(opt.dataset.lang as Lang);
    paintLangPicks();
    if ($('bTutorial').dataset.hot) $('bTutorial').dataset.hot = t('tutNew');
    paintRecord();                                              // at once: the fresh record below is a server call away
    document.querySelector<HTMLElement>('.tabn.on')?.click();
  });
}
document.addEventListener('pointerdown', e => { for (const p of langPicks) if (!p.contains(e.target as Node)) p.classList.remove('open'); });
addEventListener('keydown', e => { if (e.key === 'Escape') langPicks.forEach(p => p.classList.remove('open')); });
const toggleMute = () => { setMuted(!muted); for (const id of ['muteIcon', 'muteIconM']) ($(id) as HTMLImageElement).src = `${import.meta.env.BASE_URL}kit/i_audio${muted ? 'Off' : 'On'}_black.png`; };
on('bMute', toggleMute);
on('bMuteM', toggleMute);
document.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (b && !b.disabled) uiSound(/Back$|^bLobby$|^bCancel$/.test(b.id) ? 'back' : 'click'); });
addEventListener('keydown', () => unlockAudio(), { once: true });
addEventListener('pointerdown', () => unlockAudio(), { once: true });

// ------------------------------------------------------------------ loop
let prev = performance.now();
function tick(now: number) {
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
  if (session || lobbyPlay) scene.hero = null;          // the home screen's framing must not follow into a match or the practice rink
  if (session) session.frame(dt, now / 1000);
  else if (lobbyPlay) lobbyPlay.frame(dt, now / 1000);   // lobby: my skater on the ice
  else if (shown === 'title') { scene.update(heroFrame(), dt, now / 1000); placeHeroTag(); }   // the lead skater live on the ice, phones included
  else { scene.hero = null; scene.update(idleView, dt, now / 1000); }   // other menus: the empty rink drifting behind
}
let lastFrame = performance.now();
function loop(now: number) { lastFrame = performance.now(); tick(now); requestAnimationFrame(loop); }
// Background tabs get no animation frames and slowed timers. An online host that alt-tabs must keep the match
// running for the opponent, so a worker clock drives the loop whenever animation frames stop arriving.
{
  const src = 'setInterval(() => postMessage(0), 16)';
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  // background tabs may still get a few slow animation frames, so tick whenever the loop has fallen behind
  w.onmessage = () => { const now = performance.now(); if (session && now - prev > 20 && now - lastFrame > 20) tick(now); };
}
const idleView = { skaters: [], puck: { x: 0, z: 0, y: 0, vx: 0, vz: 0, owner: -1 }, controlled: -1, charge: -1 };
// ------------------------------------------------------------------ home: my lead skater on the ice
// The live 3D scene is the home screen's centre (PC): skater 0 of my lineup idles at centre ice and the camera frames
// it inside the area the top bar, the left menu and the right column leave free. Phones keep the portrait images.
let heroLineups: [Lineup, Lineup] | null = null;
const heroSkaters: ViewSkater[] = Array.from({ length: 8 }, (_, i) => ({ id: i, team: (i < 4 ? 0 : 1) as Team, goalie: i % 4 === 3, x: 60 + i * 4, z: 60, vx: 0, vz: 0, face: 0, stun: 0, dive: 0 }));
heroSkaters[0].x = 0; heroSkaters[0].z = 2; heroSkaters[0].face = 0.5;          // facing the camera, turned a little to the left
if (import.meta.env.DEV) (window as unknown as { __heroSk: ViewSkater[] }).__heroSk = heroSkaters;
const heroView: ViewState = { skaters: heroSkaters, puck: { x: 60, z: 60, y: 0, vx: 0, vz: 0, owner: -1 }, controlled: -1, charge: -1, hide: new Set([1, 2, 3, 4, 5, 6, 7]) };
function heroFrame() {
  if (!heroLineups || heroLineups[0] !== lineup) heroLineups = [lineup, aiLineup()];
  scene.setLineups(heroLineups);
  const top = $('gnav').querySelector('.g-top')!.getBoundingClientRect(), rail = $('gnav').querySelector('.g-rail')!.getBoundingClientRect(), menu = $(mobile ? 'mobileMenu' : 'pcMenu').getBoundingClientRect();
  const tag = $('heroTag');
  if (mobile && innerHeight > innerWidth) {
    // phone held upright: the menu tabs are along the bottom, the play buttons and rank above them; the skater stands in between
    const rank = $('rankCard').getBoundingClientRect(), t3 = $('top3').getBoundingClientRect(), low = Math.min(menu.top, rank.height ? rank.top : menu.top, t3.height ? t3.top : menu.top);
    const tools = $('mTools').getBoundingClientRect();          // the sound / credits / language row: the head stays under it
    scene.hero = { left: 12, right: 12, top: Math.max(top.bottom, tools.bottom) + 6, bottom: innerHeight - low + tag.offsetHeight * uiZoom + 22 };
  } else if (innerHeight > innerWidth) {
    // PC browser in a tall window: the play column is along the bottom, the top 3 strip under the top bar
    const t3 = $('top3').getBoundingClientRect();
    scene.hero = { left: rail.right + 12, right: 12, top: Math.max(top.bottom, t3.height ? t3.bottom : 0) + 8, bottom: innerHeight - menu.top + tag.offsetHeight * uiZoom + 22 };
  } else {
    const t3 = $('top3').getBoundingClientRect();      // the skater's head stays under the top 3 panel
    scene.hero = { left: rail.right + 12, right: innerWidth - menu.left + 12, top: Math.max(top.bottom, t3.height ? t3.bottom : 0) + 8, bottom: tag.offsetHeight + 26 };
  }
  // never hand the camera an empty or inverted box (a menu covering the screen made it zoom into the ice, no skater)
  const h = scene.hero, minW = 140, minH = 150;
  if (innerWidth - h.left - h.right < minW) { h.left = Math.min(h.left, innerWidth / 2 - minW / 2); h.right = innerWidth - h.left - minW; }
  if (innerHeight - h.top - h.bottom < minH) { h.top = Math.min(h.top, innerHeight / 2 - minH / 2); h.bottom = innerHeight - h.top - minH; }
  return heroView;
}
function paintHeroTag() {
  const id = lineup.skaters[0], c = CHARACTER[id];
  $('htName').textContent = c.name;
  $('htRole').textContent = `${t(roleKey[c.role])} · ${seatName(0)}`;
  $('htOvr').textContent = String(seatOvr(id, 0));
}
function placeHeroTag() {
  const tag = $('heroTag');
  tag.style.left = `${scene.heroFeet.x / uiZoom}px`; tag.style.top = `${(scene.heroFeet.y + 18) / uiZoom}px`;   // the tag sits in the zoomed UI
}

/** default creative for the arena's ad boards until a real sponsor banner goes in (scene.setRibbonAd): one 728x90 tile */
function brandRibbon() {
  const c = document.createElement('canvas'); c.width = 728; c.height = 90;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.font = 'italic 800 66px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  const a = 'FACE', b = 'OFF', w = g.measureText(a).width, wb = g.measureText(b).width, bar = 30, total = w + bar + 16 + wb + 22;
  let x = (c.width - total) / 2;
  g.fillStyle = '#10233f'; g.fillText(a, x, 47); x += w + 8;
  g.fillStyle = '#d3262c'; g.fillRect(x, 42, bar, 10); x += bar + 8;
  g.fillStyle = '#10233f'; g.fillText(b, x, 47); x += wb;
  g.fillStyle = '#d3262c'; g.fillText('!', x, 47);
  scene.setRibbonAd(c);
}
applyI18n();
renderPeek();
// first visit: the tutorial is the first thing offered
try { if (!localStorage.getItem('faceoff:tutorial')) { $('bTutorial').classList.add('hot'); $('bTutorial').dataset.hot = t('tutNew'); } } catch { /* */ }
// ------------------------------------------------------------------ loading: models, portraits, fonts
{
  const fill = $('loadFill'), pct = $('loadPct'), what = $('loadWhat'), tip = $('loadTip');
  const tips = ['tip1', 'tip2', 'tip3', 'tip4', 'tip5', 'tip6'] as const;
  let k = Math.floor(Math.random() * tips.length);
  const showTip = () => { tip.textContent = t(tips[k++ % tips.length]); };
  showTip(); const tipTimer = window.setInterval(showTip, 2600);
  let models = 0, cards = 0, fonts = 0;
  const draw = () => {
    const f = Math.min(1, models * 0.8 + cards * 0.15 + fonts * 0.05);
    fill.style.width = `${(f * 100).toFixed(1)}%`;
    pct.textContent = `${Math.round(f * 100)}%`;
    what.textContent = t(f >= 1 ? 'ldReady' : models < 1 ? 'ldModels' : 'ldCards');
  };
  const stageIds = nextStageModels(lineup);         // the first stage's opponents too: no download and decode when it starts
  const ids = CHARACTERS.map(c => c.id).filter(id => !isHeavyModel(id) || seatIds(lineup).includes(id) || stageIds.includes(id));
  const modelLoad = scene.loadCharacters(ids, f => { models = f; draw(); }).then(() => { models = 1; draw(); });
  loadFrames();
  let n = 0;
  const cardLoad = Promise.all(ids.map(id => new Promise<void>(res => {
    const img = new Image(); img.onload = img.onerror = () => { cards = ++n / ids.length; draw(); res(); }; img.src = portrait(id);
  })));
  const fontLoad = (document.fonts?.ready ?? Promise.resolve()).then(() => { fonts = 1; draw(); });
  void fontLoad.then(brandRibbon);
  void Promise.all([modelLoad, cardLoad, fontLoad]).then(async () => {
    clearInterval(tipTimer); draw();
    const first = await firstVisit();
    if (first) startFirstVisit();
    window.setTimeout(() => { $('loading').classList.add('done'); if (!first) playEntrance('title'); window.setTimeout(() => $('loading').remove(), 500); }, 250);
  });
}
toTitle();
requestAnimationFrame(loop);
// Agent8 when a Verse8 project is configured; otherwise the local two-tab lobby (development)
const lobbyReady = createAgent8Lobby().then(l => { if (l) { lobby = l; void showRecord(); } }).catch(() => toast(t('noServer'), 4000));
initStages({
  rpc: (fn, args) => lobby.rpc(fn, args), toast: m => toast(m), start: id => stage(id), mine: () => withLevels(lineup),
  portrait: id => portrait(id), card: (id, l) => playerCard({ u: 0, m: id, l }), platform: mobile ? 'phone' : 'pc', screen: id => screen(id), prefetch: ids => scene.ensureModels(ids),
  update: w => { if (profile) { Object.assign(profile, w); renderRank(); fixLineup(); paintProfEnh(); paintWallet(); } },
  starterOpen: () => !!profile && !((profile as { packs?: Record<string, number> }).packs?.starter),
});
initEconomy({
  rpc: (fn, args) => lobby.rpc(fn, args),
  wallet: () => profile as never,
  update: w => { if (profile) { Object.assign(profile, w); renderRank(); fixLineup(); paintProfEnh(); } },
  reload: async () => { profile = await lobby.record().catch(() => profile); renderRank(); },
  portrait: id => portrait(id), card: c => playerCard(c), toast: m => toast(m), screen: id => screen(id), reveal: playReveal,
});
(window as unknown as { __game: unknown }).__game = { get session() { return session; }, stage, get lobby() { return lobby; }, set lobby(l: Lobby) { lobby = l; }, scene, practice, quick, reveal: playReveal };
