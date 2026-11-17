// Stage screen (#stages), the home "Continue stages" tiles, the stage result (#stageResult) and the red attention dots.
// Progress lives on the server (getStages / clearStage / claimChest); a copy is kept in localStorage so the screens
// draw at once and a clear made while the server is unreachable is kept and sent again on the next load.
import { STAGES, CHEST_AT, stageById, nextStage, isOpen, chapterStars, foeFor, foeLevels, ruleOk, type Outcome, type Platform, type Stage } from './stages.ts';
import { goalText, starLines } from './stageSession.ts';
import { visibleStars, PendingQueue, walletOf, type Pending } from './stageSync.ts';
import { CHARACTER, MAX_LEVEL, overallOf, type Lineup } from './roster.ts';
import type { ModelId } from '../render/model-ids.ts';
import { t, type Key } from '../i18n.ts';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fill = (k: Key, ...n: (number | string)[]) => n.reduce<string>((s, v, i) => s.replace(i === 0 ? '{n}' : '{m}', String(v)), t(k));

export interface StageDeps {
  rpc<T>(fn: string, args?: unknown[]): Promise<T>;
  toast(msg: string): void;
  start(id: string): void;
  /** my lineup with its seat powers (what a stage would field) */
  mine(): Lineup;
  portrait(id: ModelId): string;
  /** the collectible card of a character at an enhancement level (the same card the team screen shows) */
  card(id: ModelId, level: number): string;
  platform: Platform;
  /** wallet fields after a reward (coins, tickets, cards, mats...) */
  update(w: Record<string, unknown>): void;
  /** the shop's starter pack is still on offer */
  starterOpen(): boolean;
  screen(id: string): void;
  /** fetch models in the background */
  prefetch(ids: ModelId[]): Promise<unknown>;
}
export interface StageReward { coins: number; scouts: number; tickets: number; mats: number; cards: { m: string; dup?: 1 }[] }
interface Progress { stars: Record<string, number>; chests: string[]; replaysLeft: number }

let d: StageDeps;

let prog: Progress = { stars: {}, chests: [], replaysLeft: 10 };
/** the server's stars as last seen (the truth); prog.stars = these plus clears still waiting to be sent */
let serverStars: Record<string, number> = {};
let chapter = 1;
let picked = '';

// ------------------------------------------------------------------ local copy
const LS_PROG = 'faceoff:stages', LS_PEND = 'faceoff:stagesPending', LS_SEEN = 'faceoff:stageSeen';
const lsGet = <T>(k: string, fb: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fb; } catch { return fb; } };
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const queue = new PendingQueue(() => lsGet<Pending[]>(LS_PEND, []), v => lsSet(LS_PEND, v));
function refresh() { prog.stars = visibleStars(serverStars, queue.list); lsSet(LS_PROG, { stars: serverStars, chests: prog.chests }); }
const seen = () => new Set(lsGet<string[]>(LS_SEEN, []));
function markSeen(id: string) { const s = seen(); s.add(id); lsSet(LS_SEEN, [...s]); }

export function initStages(deps: StageDeps) {
  d = deps;
  const local = lsGet<Partial<Progress>>(LS_PROG, {});
  serverStars = local.stars ?? {};
  prog = { stars: visibleStars(serverStars, queue.list), chests: local.chests ?? [], replaysLeft: 10 };
  $('stgTabs').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ch]'); if (b) { chapter = Number(b.dataset.ch); picked = ''; render(); } });
  $('stgPath').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-st]'); if (b) { picked = b.dataset.st!; render(); } });
  $('stgSide').addEventListener('click', e => { if ((e.target as HTMLElement).closest('#bStageGo') && picked && isOpen(picked, prog.stars)) { markSeen(picked); d.start(picked); } });
  $('stgChest').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-at]'); if (b && !b.hasAttribute('disabled')) void claim(chapter, Number(b.dataset.at)); });
  paintHome(); paintDots();
}

/** server progress (and any clear that could not be sent before) */
export async function loadStages(): Promise<void> {
  await queue.flush(p => d.rpc('clearStage', [p.id, p.stars, p.seconds]));   // a refused one is dropped: the server's answer stands
  try {
    const s = await d.rpc<Progress>('getStages');
    serverStars = s.stars ?? {}; prog.chests = s.chests ?? []; prog.replaysLeft = s.replaysLeft ?? 0;
  } catch { /* offline: the last server copy and the queue stand */ }
  refresh();
  paintHome(); paintDots();
  if (!$('stages').classList.contains('hidden')) render();
}
export const stageStars = () => prog.stars;
export const hasProgress = () => Object.keys(prog.stars).length > 0;

export async function openStages(ch?: number) {
  chapter = ch ?? nextStage(prog.stars).chapter;
  picked = nextStage(prog.stars).chapter === chapter ? nextStage(prog.stars).id : '';
  render(); d.screen('stages');
  await loadStages();
}

// ------------------------------------------------------------------ screen
const starRow = (n: number) => `<span class="stg-stars">${[0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
const teamOvr = (l: Lineup) => { const ids = [...l.skaters, l.goalie]; return Math.round(ids.reduce((s, m, i) => s + overallOf(m, Math.min(10, l.levels?.[i] ?? 0)), 0) / 4); };
/** the first-clear reward shown before playing (the server's numbers: STAGE rewards in server/src/server.ts) */
function firstReward(s: Stage) { const coins = s.boss ? 200 + 50 * ((s.chapter - 1) * 2 + (s.index === 10 ? 2 : 1)) : 60 + 30 * (s.chapter - 1) + 5 * s.index; return { coins, scout: s.boss }; }

function render() {
  const chapters = [...new Set(STAGES.map(s => s.chapter))];
  $('stgTabs').innerHTML = chapters.map(c => {
    const open = isOpen(`${c}-1`, prog.stars), stars = chapterStars(prog.stars, c);
    return `<button class="${c === chapter ? 'primary' : 'ghost'} small stg-tab" data-ch="${c}" ${open ? '' : 'disabled'}>${fill('stChapter', c)}<small>${stars}/30</small></button>`;
  }).join('');
  const list = STAGES.filter(s => s.chapter === chapter), fresh = seen();
  $('stgPath').innerHTML = list.map(s => {
    const open = isOpen(s.id, prog.stars), n = prog.stars[s.id] ?? 0, isNew = open && !n && !fresh.has(s.id);
    const face = s.boss ? `<img class="stg-boss" src="${d.portrait(s.foe.skaters[0])}" alt="" />` : '';
    return `<li><button class="stg-node ${s.boss ? 'boss' : ''} ${open ? '' : 'locked'} ${n ? 'done' : ''} ${s.id === picked ? 'sel' : ''}" data-st="${s.id}" ${isNew ? 'data-new="1"' : ''}>
      ${face}<b class="stg-no">${s.boss ? t('stBossTag') : s.index}</b><span class="stg-name">${esc(t(s.name))}</span>${open ? starRow(n) : `<i class="stg-lock"></i>`}</button></li>`;
  }).join('');
  for (const el of $('stgPath').querySelectorAll<HTMLElement>('[data-new]')) dot(el, 1);
  renderSide();
  renderChest();
  paintDots();
}

function renderSide() {
  const s = stageById(picked);
  if (!s) { $('stgSide').innerHTML = `<p class="stg-pick">${t('stPick')}</p>`; return; }
  const open = isOpen(s.id, prog.stars), n = prog.stars[s.id] ?? 0, mine = d.mine(), foe = foeFor(s, mine);
  const foeL = { ...foe, levels: foeLevels(s, foe) }, a = teamOvr(mine), b = teamOvr(foeL), rw = firstReward(s);
  const lines = starLines(s, d.platform).map((line, i) => `<li class="${i < n ? 'on' : ''}"><i></i>${esc(line)}</li>`).join('');
  const reward = n ? `<p class="stg-rw">${fill('stReplay', prog.replaysLeft)}</p>`
    : `<p class="stg-rw"><b>${t('stFirst')}</b> ${fill('stCoins', rw.coins)}${rw.scout ? ` · ${fill('stScout', 1)}` : ''}</p>`;
  $('stgSide').innerHTML = `
    <div class="stg-title"><small>${t('stageLabel')} ${s.id}${s.boss ? ` · ${t('stBossTag')}` : ''}</small><h3>${esc(t(s.name))}</h3></div>
    <p class="stg-goal">${esc(goalText(s))}</p>
    <ul class="stg-lines">${lines}</ul>
    <div class="stg-vs"><div><small>${t('stMine')}</small><b>${a}</b></div><span>VS</span><div class="${b > a ? 'hard' : ''}"><small>${t('stFoe')}</small><b>${b}</b></div></div>
    <div class="stg-foes"><small>${t('stFoe')}</small><div>${[...foe.skaters, foe.goalie].map(m => d.card(m, Math.min(MAX_LEVEL, s.power))).join('')}</div></div>
    ${reward}
    <button id="bStageGo" class="primary stg-go" ${open ? '' : 'disabled'}>${open ? t('stStart') : t('stLocked')}</button>`;
}

/** the chests at 10 / 20 / 30 stars get richer: bronze, silver, gold */
const CHEST_METAL = ['bronze', 'silver', 'gold'] as const;
function renderChest() {
  const stars = chapterStars(prog.stars, chapter);
  $('stgChest').innerHTML = `<div class="stg-bar"><i style="width:${Math.min(100, stars / 30 * 100)}%"></i></div>` + CHEST_AT.map((at, i) => {
    const got = prog.chests.includes(`${chapter}:${at}`), ready = !got && stars >= at;
    const art = `${import.meta.env.BASE_URL}kit/chest_${CHEST_METAL[i] ?? 'gold'}${got ? '_open' : ''}.webp`;   // Codex art, tools/chest_art.py
    return `<button class="stg-box ${ready ? 'ready' : ''} ${got ? 'got' : ''}" data-at="${at}" style="left:${at / 30 * 100}%" ${ready ? '' : 'disabled'}><img src="${art}" alt="" /><small>${at}</small></button>`;
  }).join('');
  for (const el of $('stgChest').querySelectorAll<HTMLElement>('.stg-box.ready')) dot(el, 1);
}

async function claim(ch: number, at: number) {
  try {
    const r = await d.rpc<{ ok: boolean; error?: string; chests?: string[]; reward: StageReward } & Record<string, unknown>>('claimChest', [ch, at]);
    if (!r.ok) { d.toast(t('eServer')); return; }
    prog.chests = r.chests ?? [...prog.chests, `${ch}:${at}`];
    refresh();
    d.update(walletOf(r)); d.toast(`${t('stChestGot')}: ${rewardText(r.reward)}`);
    render(); paintHome();
  } catch { d.toast(t('eServer')); }
}

export function rewardText(r: StageReward): string {
  const parts: string[] = [];
  if (r.coins) parts.push(fill('stCoins', r.coins));
  if (r.scouts) parts.push(fill('stScout', r.scouts) + (r.cards.length ? ` (${r.cards.map(c => CHARACTER[c.m as ModelId]?.name ?? c.m).join(', ')})` : ''));
  if (r.tickets) parts.push(fill('stTicket', r.tickets));
  if (r.mats) parts.push(fill('stMats', r.mats));
  return parts.join(' · ');
}

// ------------------------------------------------------------------ after a stage
/** sends the result; offline, the stars are kept locally and sent on the next load. null reward = not sent */
export async function reportStage(id: string, _o: Outcome, stars: number, seconds: number): Promise<StageReward | null> {
  markSeen(id);
  try {
    const r = await d.rpc<{ ok: boolean; error?: string; stars: Record<string, number>; reward: StageReward; replaysLeft?: number } & Record<string, unknown>>('clearStage', [id, stars, Math.round(seconds)]);
    if (r.stars) serverStars = r.stars;
    if (!r.ok) { d.toast(t('stRefused')); return null; }        // e.g. the stage is still locked on the server: say so, show the server's stars
    prog.replaysLeft = r.replaysLeft ?? prog.replaysLeft;
    d.update(walletOf(r));
    return r.reward;
  } catch {
    if (stars > 0) queue.add({ id, stars, seconds: Math.round(seconds) });
    d.toast(t('stOffline'));
    return null;
  } finally { refresh(); paintHome(); paintDots(); if (!$('stageResult').classList.contains('hidden')) paintNext(); }
}

/** the stage result screen: stars fill in one by one, the star lines say which were met, then the reward */
export function showStageResult(id: string, o: Outcome, stars: number, reward: Promise<StageReward | null>, opts: { firstRun: boolean }) {
  const s = stageById(id)!, next = STAGES[STAGES.findIndex(x => x.id === id) + 1];
  $('srTag').textContent = `${t('stageLabel')} ${s.id}`;
  $('srTitle').textContent = t(o.cleared ? 'stClear' : 'stFail');
  $('srName').textContent = t(s.name);
  $('srStars').innerHTML = [0, 1, 2].map(i => `<i class="${i < stars ? 'on' : ''}" style="animation-delay:${0.35 + i * 0.35}s"></i>`).join('');
  const met = [o.cleared, ...s.stars[d.platform].map(r => o.cleared && ruleOk(r, o))];
  $('srLines').innerHTML = starLines(s, d.platform).map((line, i) => `<li class="${met[i] ? 'on' : ''}"><i></i>${esc(line)}</li>`).join('');
  $('srScore').textContent = `${o.myGoals} : ${o.theirGoals}`;
  $('srReward').textContent = '';
  void reward.then(r => { if (r && rewardText(r)) $('srReward').textContent = rewardText(r); });
  resultCtx = { next: next?.id ?? '', firstRun: opts.firstRun };
  // until the server answers, this clear counts as if sent (reportStage repaints with the server's stars)
  const nextOpen = !!next && isOpen(next.id, visibleStars(prog.stars, stars ? [{ id, stars, seconds: 0 }] : []));
  $('bStageNext').classList.toggle('hidden', !nextOpen || opts.firstRun);
  $('bStageNext').dataset.st = next?.id ?? '';
  $('bStageHome').textContent = t(opts.firstRun && o.cleared ? 'stContinueHome' : 'stHome');
  const homeMain = opts.firstRun || !nextOpen;   // the only way on is home: it is the main button
  $('bStageHome').classList.toggle('primary', homeMain); $('bStageHome').classList.toggle('ghost', !homeMain);
  $('stageResult').classList.toggle('win', o.cleared);
  d.screen('stageResult');
}

let resultCtx = { next: '', firstRun: false };
function paintNext() {
  const open = !!resultCtx.next && isOpen(resultCtx.next, prog.stars);
  $('bStageNext').classList.toggle('hidden', !open || resultCtx.firstRun);
  const homeMain = resultCtx.firstRun || !open;
  $('bStageHome').classList.toggle('primary', homeMain); $('bStageHome').classList.toggle('ghost', !homeMain);
}

// ------------------------------------------------------------------ home tiles
export function paintHome() {
  if (d) void d.prefetch(nextStageModels(d.mine()));      // while the player looks at home, the next stage's opponents arrive
  const s = nextStage(prog.stars), all = STAGES.every(x => (prog.stars[x.id] ?? 0) > 0);
  for (const id of ['bStage', 'bStageM']) {
    const el = document.getElementById(id); if (!el) continue;
    el.querySelector('.st-at')!.textContent = all ? t('stAllClear') : `${s.id} ${t(s.name)}`;
    el.querySelector('.st-prog')!.innerHTML = `<span class="stg-stars"><i class="on"></i></span><b>${STAGES.reduce((n, x) => n + (prog.stars[x.id] ?? 0), 0)}</b>/${STAGES.length * 3}`;
  }
}
export const continueId = () => nextStage(prog.stars).id;
/** the characters the next stage fields against `mine`, read straight from this device's copy (works before init):
 *  the loading screen fetches them so the first stage does not stop to download and decode models */
export function nextStageModels(mine: Lineup): ModelId[] {
  const stars = visibleStars(lsGet<Partial<Progress>>(LS_PROG, {}).stars ?? {}, lsGet<Pending[]>(LS_PEND, []));
  const f = foeFor(nextStage(stars), mine);
  return [...f.skaters, f.goalie];
}

// ------------------------------------------------------------------ attention dots (owner 2026-11-11: "빨간점도 잘 떠서 유저들이 아 이거 눌러야하는구나")
/** a red dot with a count on the host's top-right corner; n = 0 removes it */
export function dot(host: Element, n: number) {
  let el = host.querySelector<HTMLElement>(':scope > .dot-alert');
  if (n <= 0) { el?.remove(); return; }
  if (!el) { el = document.createElement('i'); el.className = 'dot-alert'; host.appendChild(el); host.classList.add('dot-host'); }
  el.textContent = n > 1 ? String(Math.min(n, 9)) : '';
}
export function attention() {
  const fresh = seen(), s = nextStage(prog.stars);
  const newStage = isOpen(s.id, prog.stars) && !(prog.stars[s.id] ?? 0) && !fresh.has(s.id) ? 1 : 0;
  let chests = 0;
  for (const c of new Set(STAGES.map(x => x.chapter))) for (const at of CHEST_AT) if (!prog.chests.includes(`${c}:${at}`) && chapterStars(prog.stars, c) >= at) chests++;
  let tutorial = false; try { tutorial = !localStorage.getItem('faceoff:tutorial'); } catch { /* */ }
  return { stages: newStage + chests, chest: chests > 0, tutorial: tutorial && d.platform === 'pc', shop: d.starterOpen() };
}
export function paintDots() {
  if (!d) return;
  const a = attention();
  for (const id of ['bStage', 'bStageM', 'tabStages']) { const el = document.getElementById(id); if (el) dot(el, a.stages); }
  const tut = document.getElementById('bTutorial'); if (tut) dot(tut, a.tutorial ? 1 : 0);
  const shop = document.getElementById('tabShop'); if (shop) dot(shop, a.shop ? 1 : 0);
  for (const b of document.querySelectorAll<HTMLElement>('#stgTabs [data-ch]')) {
    const c = Number(b.dataset.ch);
    dot(b, CHEST_AT.filter(at => !prog.chests.includes(`${c}:${at}`) && chapterStars(prog.stars, c) >= at).length);
  }
}
