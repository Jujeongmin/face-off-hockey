// Squad enhancement, transfer market and shop screens. Every rule and roll lives on the server (server/src/server.ts);
// these screens only show what it returns, including the odds, before anyone spends anything.
import { VXShop } from '@verse8/platform/vanilla';
import { Verse8Ads } from '@verse8/ads';
import { t } from '../i18n.ts';
import { sfx, uiSound } from '../audio.ts';
import { CHARACTER, powerOf, overallOf, ratingOf } from './roster.ts';
import { gradeName, gradeTag } from './grades.ts';
import type { ModelId } from '../render/model-ids.ts';

const $ = (id: string) => document.getElementById(id)!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface Card { u: number; m: string; l: number; b?: 1; dup?: 1 }
export interface Wallet { premPity?: number; coins: number; gems: number; tickets: number; cards: Card[]; owned: string[]; pity?: number; mats?: Record<string, number> }
interface Band { min: number; max: number }
interface Pack { gems: number; coins?: number; tickets?: number; scouts?: number; limit?: number }
interface Economy { premium?: { one: number; ten: number; ceiling: number; odds: number[] }; matStep?: number; matMax?: number; rate: number[]; cost: number[]; dropFrom: number; scout: number; models: number; fee: number; maxListings: number; bands: Band[][] | Band[]; gradeOdds?: number[]; pityMax?: number; packs: Record<string, Pack>; products: Record<string, number>; ads: Record<string, { coins: number; daily: number }>; adsUsed: Record<string, number> }
interface Reply extends Partial<Wallet> { ok: boolean; error?: string }
interface Listing { id: string; m: string; l: number; price: number; mine?: boolean; avg?: number | null }

export interface EconomyDeps {
  rpc<T>(fn: string, args?: unknown[]): Promise<T>;
  wallet(): (Partial<Wallet> & { packs?: Record<string, number> }) | null;
  /** new wallet values from the server */
  update(w: Partial<Wallet> & { packs?: Record<string, number> }): void;
  reload(): Promise<void>;
  portrait(id: ModelId): string;
  /** a collectible card */
  card(c: Card): string;
  toast(msg: string): void;
  screen(id: string): void;
  /** the on-ice reveal of new cards; again = one more of the same, done = back to the shop */
  reveal(cards: Card[], again: (() => void) | null, done: () => void): void;
}

let d: EconomyDeps;
let eco: Economy | null = null;
let busy = false;
const coin = '<i class="coin"></i>', gem = '<i class="gem"></i>', ticket = '<i class="ticket"></i>';
const nameOf = (m: string) => CHARACTER[m as ModelId]?.name ?? m;
const fail = (e?: string) => (uiSound('error'), d.toast(t((({ coins: 'eCoins', gems: 'eGems', full: 'eFull', bound: 'eBound', price: 'ePrice', limit: 'eLimit', gone: 'eGone', daily: 'eDaily', max: 'eMax', wait: 'eWait' } as const)[e ?? ''] ?? 'eServer'))));
const cards = () => d.wallet()?.cards ?? [];

async function call(fn: string, args: unknown[] = []): Promise<Reply | null> {
  try { return await d.rpc<Reply>(fn, args); } catch { d.toast(t('eServer')); return null; }
}
async function loadRules(): Promise<boolean> {
  try { eco = await d.rpc<Economy>('getEconomy'); return true; } catch { d.toast(t('eServer')); return false; }
}
/** a balance in at most six characters, rounded down so a phone never shows more than the player holds */
function shortAmount(v: number) {
  if (v < 10000) return v.toLocaleString();
  return v < 1e6 ? `${Math.floor(v / 100) / 10}K` : `${Math.floor(v / 1e5) / 10}M`;
}
/** a reward the player just earned: a big coin plate in the middle of the screen, and the wallet's coins flash */
export function rewardPop(n: number) {
  let el = document.getElementById('rewardPop');
  if (!el) { el = document.createElement('div'); el.id = 'rewardPop'; el.className = 'reward-pop'; document.body.append(el); }
  el.innerHTML = `<i class="coin"></i><b>+${n.toLocaleString()}</b><small>${t('adGot')}</small>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  const chip = $('gnav').querySelector('.eco-wallet span');
  chip?.classList.remove('gain'); void (chip as HTMLElement | null)?.offsetWidth; chip?.classList.add('gain');
}
export function paintWallet() {
  if (!d) return;
  const w = d.wallet();
  const small = document.body.classList.contains('touch');
  const n = (v?: number) => (small ? shortAmount(v ?? 0) : (v ?? 0).toLocaleString());
  const html = `<span>${coin}<b>${n(w?.coins)}</b></span><span>${gem}<b>${n(w?.gems)}</b></span><span>${ticket}<b>${n(w?.tickets)}</b></span>`;
  $('gnav').querySelector('.eco-wallet')!.innerHTML = html;
}
function apply(r: Reply) { d.update(r); paintWallet(); }

const gr = (m: string) => CHARACTER[m as ModelId]?.grade ?? 0;
const bandOf = (c: { m: string; l: number }) => { const b = eco!.bands[0]; return (Array.isArray(b) ? (eco!.bands as Band[][])[gr(c.m)][c.l] : (eco!.bands as Band[])[c.l]); };   // a server not yet refreshed has one list
const held = (m: string) => d.wallet()?.mats?.[m] ?? 0;
const miniCard = (c: Card, on = false) => `<button class="pick ${on ? 'in' : ''}" data-u="${c.u}">${d.card(c)}<span class="pick-sub">${held(c.m) ? `<b>${t('enhMats')} ${held(c.m)}</b>` : ''}${t(c.b ? 'cardBound' : 'cardTradable')}</span></button>`;

// ------------------------------------------------------------------ enhancement
let picked = 0;
let matUse = 0;                                                 // material chosen for the next attempt on the picked card
function renderSquad() {
  const list = [...cards()].sort((a, b) => powerOf(b) - powerOf(a) || a.m.localeCompare(b.m));
  if (!list.some(c => c.u === picked)) picked = list[0]?.u ?? 0;
  $('squadCards').innerHTML = list.map(c => miniCard(c, c.u === picked)).join('');
  $('squadCount').textContent = String(list.length);
  renderForge();
}
function renderForge() {
  const c = cards().find(x => x.u === picked), f = $('forge');
  if (!c || !eco) { f.innerHTML = ''; return; }
  const max = c.l >= eco.rate.length;
  const target = c.l + 1, drops = !max && target >= eco.dropFrom, tickets = d.wallet()?.tickets ?? 0;
  const step = eco.matStep ?? 0, base = max ? 1 : eco.rate[c.l];
  const usable = step ? Math.min(held(c.m), eco.matMax ?? 0, Math.ceil(Number(((1 - base) / step).toFixed(6)))) : 0;
  matUse = Math.min(matUse, usable);
  const rate = Math.min(1, base + matUse * step);
  // what this attempt changes: the overall and each rating, before and after
  const id = c.m as ModelId, ch = CHARACTER[id], p0 = powerOf(c), p1 = p0 + 1;
  const stats = [['stSpd', ch.stats.spd], ['stSht', ch.stats.sht], ['stPas', ch.stats.pas], ['stChk', ch.stats.chk], ['stHnd', ch.stats.hnd]] as const;
  const head = `<div class="forge-head"><div class="forge-card">${d.card(c)}</div><div class="forge-who"><small>${gradeName(ch.grade)}</small><b>${ch.name}</b>
    <div class="forge-ovr"><span>OVR</span><b>${overallOf(id, p0)}</b>${max ? '' : `<i></i><b class="to">${overallOf(id, p1)}</b>`}</div></div></div>`;
  const diff = max ? '' : `<ul class="forge-stats">${stats.map(([k, v]) => { const a = ratingOf(v, p0), b = ratingOf(v, p1); return `<li><span>${t(k)}</span><b>${a}</b><i></i><b class="to">${b}</b><em>${b > a ? `+${b - a}` : ''}</em></li>`; }).join('')}</ul>`;
  f.innerHTML = `${head}
    ${max ? `<p class="forge-max">${t('enhMax')}</p>` : `
    <div class="forge-step"><b>+${c.l}</b><i></i><b class="to">+${target}</b></div>${diff}
    <dl class="forge-facts"><dt>${t('enhRate')}</dt><dd>${matUse ? `<span class="forge-up">${Math.round(rate * 100)}%</span>` : `${Math.round(rate * 100)}%`}</dd><dt>${t('enhCost')}</dt><dd>${coin}${eco.cost[c.l]}</dd><dt>${t('enhFail')}</dt><dd>${drops ? t('enhDrop') : t('enhKeep')}</dd></dl>
    ${step ? `<div class="forge-mat"><span>${t('enhMats')} ${held(c.m)}</span><span class="forge-stp"><button id="matMinus" ${matUse ? '' : 'disabled'} aria-label="-">−</button><b>${matUse}</b><button id="matPlus" ${matUse < usable ? '' : 'disabled'} aria-label="+">+</button></span></div>` : ''}
    ${drops ? `<label class="forge-ticket"><input type="checkbox" id="forgeTicket" ${tickets ? '' : 'disabled'} />${ticket}<span>${t('enhTicket')} (${tickets})</span></label>` : ''}
    <div class="forge-gauge"><i></i></div>
    <button id="bEnhance" class="primary">${t('enhGo')}</button>`}`;
}
async function enhance() {
  const c = cards().find(x => x.u === picked);
  if (busy || !c) return;
  busy = true;
  const f = $('forge'), protect = ($('forgeTicket') as HTMLInputElement | null)?.checked ?? false;
  ($('bEnhance') as HTMLButtonElement).disabled = true;
  f.classList.remove('win', 'lose'); f.classList.add('charging');
  const [r] = await Promise.all([call('enhance', [c.u, protect, matUse]), sleep(1300)]);   // the wait is the point
  f.classList.remove('charging');
  busy = false;
  if (!r || !r.ok) { if (r) fail(r.error); renderForge(); return; }
  const res = r as Reply & { success: boolean; level: number; protected: boolean };
  apply(r);
  matUse = 0;                                                   // spent: the next attempt is a new choice
  sfx(res.success ? 'horn' : 'board', res.success ? 0.6 : 1);
  renderSquad();
  f.classList.add(res.success ? 'win' : 'lose');
  d.toast(res.success ? `${t('enhWin')} +${res.level}` : res.protected ? t('enhSaved') : t('enhLose'));
}

// ------------------------------------------------------------------ market
let tab: 'buy' | 'sell' | 'mine' = 'buy';
type Sort = 'grade' | 'level' | 'low' | 'high';
const SORT_LABEL = { grade: 'mkSortGrade', level: 'mkSortLevel', low: 'mkSortLow', high: 'mkSortHigh' } as const;
let mkGrade = -1;                                // -1 = every grade
let mkSort: Sort = 'grade';
let mkItems: Listing[] | null = null;            // the server's last list: sorting and filtering do not ask it again
const sellTyped = new Map<number, string>();     // a price being typed survives a filter change
const fmt = (n: number) => n.toLocaleString();
const netOf = (price: number) => price - Math.ceil(price * eco!.fee);   // the seller's payout, same sum as the server
const note = (key: Parameters<typeof t>[0]) => `<p class="note">${t(key)}</p>`;
const nameCell = (m: string, l: number) => `<div class="m-name">${gradeTag(gr(m))}<b>${nameOf(m)}</b>${l ? `<span class="lv-text">+${l}</span>` : ''}</div>`;
const activeSort = (): Sort => (tab === 'sell' && (mkSort === 'low' || mkSort === 'high') ? 'grade' : mkSort);   // nothing to sell has a price yet
function arrange<T extends { m: string; l: number; price?: number }>(list: T[]): T[] {
  const sort = activeSort();
  return list.filter(x => mkGrade < 0 || gr(x.m) === mkGrade).sort((a, b) =>
    sort === 'low' ? (a.price ?? 0) - (b.price ?? 0)
    : sort === 'high' ? (b.price ?? 0) - (a.price ?? 0)
    : sort === 'level' ? b.l - a.l || gr(b.m) - gr(a.m)
    : gr(b.m) - gr(a.m) || b.l - a.l);
}
function paintTools() {
  const el = $('marketTools');
  el.classList.toggle('hidden', tab === 'mine');
  if (tab === 'mine') return;
  const sorts: Sort[] = tab === 'buy' ? ['grade', 'level', 'low', 'high'] : ['grade', 'level'];
  el.innerHTML = `<div class="m-chips">${[-1, 0, 1, 2, 3, 4].map(g => `<button class="m-chip ${g === mkGrade ? 'on' : ''}" data-grade="${g}">${g < 0 ? t('mkAll') : gradeName(g)}</button>`).join('')}</div>
    <div class="m-chips m-sorts" role="group" aria-label="${t('mkSortLabel')}"><span>${t('mkSortLabel')}</span>${sorts.map(o => `<button class="m-chip ${o === activeSort() ? 'on' : ''}" data-sort="${o}">${t(SORT_LABEL[o])}</button>`).join('')}</div>`;
}
const listed = (x: Listing): Card => ({ u: 0, m: x.m, l: x.l });
const buyCard = (x: Listing) => `<div class="mk-card">${d.card(listed(x))}<div class="mk-avg">${x.avg != null ? `${t('mkAvg')} ${fmt(x.avg)}` : t('mkNoAvg')}</div>
  <div class="mk-foot"><span class="m-price">${coin}${fmt(x.price)}</span>${x.mine ? `<span class="m-mine">${t('mkMine')}</span>` : `<button class="primary small" data-buy="${x.id}">${t('mkBuy')}</button>`}</div></div>`;
function sellRow(c: Card) {
  const b = bandOf(c);
  return `<div class="m-row sell"><div class="m-pic">${d.card(c)}</div>${nameCell(c.m, c.l)}
    <label class="m-field"><small>${t('mkPriceLabel')}</small><span class="m-input-wrap">${coin}<input class="m-input" type="number" id="sell${c.u}" data-u="${c.u}" min="${b.min}" max="${b.max}" value="${sellTyped.get(c.u) ?? b.min}" /></span><small class="m-range">${fmt(b.min)} ~ ${fmt(b.max)}</small></label>
    <div class="m-net"><small>${t('mkNet')}</small><b></b></div>
    <button class="primary small" data-sell="${c.u}">${t('mkSell')}</button></div>`;
}
/** the payout for the typed price; a price outside the band turns red and cannot be listed */
function paintNet(i: HTMLInputElement) {
  const v = Number(i.value), ok = i.value !== '' && Number.isInteger(v) && v >= Number(i.min) && v <= Number(i.max), row = i.closest('.m-row')!;
  row.classList.toggle('bad', !ok);
  row.querySelector('.m-net b')!.textContent = ok ? fmt(netOf(v)) : '-';
  row.querySelector<HTMLButtonElement>('button[data-sell]')!.disabled = !ok;
}
/** draws the buy or sell list from what is already here */
function paintMarket() {
  const el = $('marketBody');
  if (tab === 'buy' && mkItems) {
    const list = arrange([...mkItems]);
    el.innerHTML = list.length ? list.map(buyCard).join('') : note(mkItems.length ? 'mkNoMatch' : 'mkEmpty');
  } else if (tab === 'sell') {
    const all = cards().filter(c => !c.b), list = arrange([...all]);
    el.innerHTML = (list.length && eco ? list.map(sellRow).join('') : note(all.length ? 'mkNoMatch' : 'mkNoCards'))
      + (eco ? `<p class="note m-fee">${t('mkFee').replace('{n}', String(Math.round(eco.fee * 100)))}</p>` : '');
    el.querySelectorAll<HTMLInputElement>('.m-input').forEach(paintNet);
  }
}
async function renderMarket() {
  document.querySelectorAll<HTMLElement>('.m-tabs button').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('primary', on); b.classList.toggle('ghost', !on); });
  paintTools();
  const el = $('marketBody');
  el.className = `m-body ${tab === 'buy' ? 'm-grid' : 'm-rows'}`;
  if (tab === 'sell') { paintMarket(); return; }
  el.innerHTML = note('mkLoading');
  if (tab === 'buy') {
    let items: Listing[];
    try { items = await d.rpc<Listing[]>('marketList'); } catch { el.innerHTML = note('eServer'); return; }
    if (tab !== 'buy') return;
    mkItems = items;
    paintMarket();
  } else {
    let mine: { earned: number; listings: Listing[] };
    try { mine = await d.rpc('marketMine'); } catch { el.innerHTML = note('eServer'); return; }
    if (tab !== 'mine') return;
    if (mine.earned) { d.toast(`${t('mkEarned')} +${mine.earned}`); await d.reload(); paintWallet(); }
    el.innerHTML = mine.listings.length ? mine.listings.map(x => `<div class="m-row"><div class="m-pic">${d.card(listed(x))}</div>${nameCell(x.m, x.l)}<div class="m-avg"></div><div class="m-price">${coin}${fmt(x.price)}</div><button class="ghost small" data-cancel="${x.id}">${t('mkCancel')}</button></div>`).join('') : note('mkNoListings');
  }
}
async function marketAct(fn: string, args: unknown[]) {
  if (busy) return;
  busy = true;
  const r = await call(fn, args);
  busy = false;
  if (!r) return;
  if (!r.ok) { fail(r.error); if (r.error === 'gone') void renderMarket(); return; }
  apply(r); uiSound('ok'); d.toast(t(fn === 'marketBuy' ? 'mkBought' : fn === 'marketSell' ? 'mkListed' : 'mkCancelled'));
  void renderMarket();
}

// ------------------------------------------------------------------ shop
let adState: 'ok' | 'off' = 'ok';
function renderShop() {
  if (!eco) return;
  const w = d.wallet(), used = (w?.packs ?? {}) as Record<string, number>;
  // not enough to pay: the button still answers (the server says what is missing) but shows it up front
  const lack = (cur: 'coins' | 'gems', n: number) => ((w?.[cur] ?? 0) < n ? ' short' : '');
  const buy = (html: string, attr: string, off = false, cls = '') => `<button class="sp-buy ${cls}" ${attr} ${off ? 'disabled' : ''}>${html}</button>`;
  const art = (name: string) => `<img class="sp-ico" src="${import.meta.env.BASE_URL}kit/${name}.webp" alt="" />`;
  const tile = (icon: string, title: string, sub: string, button: string) => `<div class="sp-tile">${icon}<div class="sp-txt"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${button}</div>`;

  // the packs: the real cards, fanned out
  const fan = (ids: ModelId[]) => `<div class="pk-fan">${ids.map((m, i) => { const n = i - (ids.length - 1) / 2; return `<div class="pk-c" style="--n:${n};z-index:${9 - Math.abs(n) * 2}">${d.card({ u: 0, m, l: 0 })}</div>`; }).join('')}</div>`;
  const odds = (list: number[]) => `<ul class="pk-odds">${list.map((o, g) => `<li class="gr${g}">${gradeName(g)}<b>${+(o * 100).toFixed(1)}%</b></li>`).join('')}</ul>`;
  const meter = (text: string, n: number, max: number) => `<div class="pk-meter"><span>${text}</span><i><u style="width:${(n / max) * 100}%"></u></i></div>`;
  const pack = (cls: string, ids: ModelId[], title: string, table: string, note: string, meterHtml: string, button: string) => `<article class="pk ${cls}">${fan(ids)}<div class="pk-info"><h2>${title}${note ? `<small>${note}</small>` : ''}</h2>${button}${table}${meterHtml}</div></article>`;
  const prem = eco.premium;
  const ceiling = prem ? meter(t('shCeil').replace('{n}', String(prem.ceiling - (w?.premPity ?? 0))), w?.premPity ?? 0, prem.ceiling) : '';
  const packs: string[] = [];
  if (prem) {
    packs.push(pack('best', ['aking', 'gynoid', 'sword1', 'oni', 'jelly'], t('shPremTen'), odds(prem.odds), t('shTenGold'), ceiling, buy(`${gem}${prem.ten}`, 'id="bPrem10"', false, `hot${lack('gems', prem.ten)}`)));
    packs.push(pack('', ['gynoid', 'oni', 'aking'], t('shPremOne'), odds(prem.odds), '', ceiling, buy(`${gem}${prem.one}`, 'id="bPrem1"', false, lack('gems', prem.one))));
  }
  packs.push(pack('', ['casual_female', 'mking', 'bg3'], t('shNormalScout'), eco.gradeOdds?.length ? odds(eco.gradeOdds) : '', '', eco.pityMax ? meter(t('shPity').replace('{n}', String(eco.pityMax - (w?.pity ?? 0))), w?.pity ?? 0, eco.pityMax) : '', buy(`${coin}${eco.scout}`, 'id="bScout"', false, lack('coins', eco.scout))));
  $('shopFeature').innerHTML = packs.join('');
  $('shopFoot').textContent = `${prem ? `${t('shBound')}  ` : ''}${t('shDup')}`;

  const packTitle = { starter: 'shStarter', coins: 'shCoins', tickets: 'shTickets' } as const;
  const inside = (p: Pack) => [p.coins ? `<span>${coin}${p.coins.toLocaleString()}</span>` : '', p.tickets ? `<span>${ticket}${p.tickets}</span>` : '', p.scouts ? `<span>${t('shCard')} ${p.scouts}</span>` : ''].join('');
  const tiles: string[] = [];
  for (const [id, p] of Object.entries(eco.packs)) {
    const out = !!p.limit && (used[id] ?? 0) >= p.limit;
    if (id === 'starter' && out) continue;
    const icon = id === 'starter' ? `<img class="sp-ico face" src="${d.portrait('casual_female')}" alt="" />` : art(id === 'tickets' ? 'v4_shield' : 'v4_coins');
    tiles.push(tile(icon, t(packTitle[id as 'coins']), `${id === 'starter' ? `<span class="sp-once">${t('shOnce')}</span>` : ''}${inside(p)}`, buy(out ? t('shBought') : `${gem}${p.gems}`, `data-pack="${id}"`, out, out ? '' : lack('gems', p.gems))));
  }
  if (adState === 'ok') {
    const ad = eco.ads['shop-coins'], left = ad.daily - (eco.adsUsed['shop-coins'] ?? 0);
    tiles.push(tile(art('v4_ad'), t('shAd'), `${coin}+${ad.coins}&nbsp;&nbsp;${t('shAdLeft').replace('{n}', String(left))}`, buy(t('shAdGo'), 'id="bAdShop"', left <= 0, 'quiet')));
  }
  $('shopPacks').innerHTML = tiles.join('');

  // gems are sold through VXShop: a product shows only once it is registered there
  const gems = Object.entries(eco.products).filter(([id]) => VXShop.getItem(id));
  $('shopGems').innerHTML = gems.map(([id, n]) => {
    const price = VXShop.getItem(id)!.price, bonus = Math.round((n / price - 1) * 100);
    return tile(art('v4_gem'), n.toLocaleString(), bonus > 0 ? `<span class="sp-once">+${bonus}%</span>` : '', buy(`${price} VX`, `data-vx="${id}"`));
  }).join('');
  $('shopGemsWrap').classList.toggle('hidden', !gems.length);
}
/** a rewarded ad, then the server's grant. Returns the coins granted (0 = none) */
export async function watchAd(placement: string): Promise<number> {
  if (busy) return 0;
  busy = true;
  try {
    const r = await Verse8Ads.showRewarded({ placementId: placement });
    if (r.status !== 'rewarded') {
      if (r.status === 'failed' && r.error?.code === 'unsupported_env') { adState = 'off'; d.toast(t('adNone')); }
      else if (r.status === 'failed') d.toast(t('adFail'));
      return 0;
    }
    for (let i = 0; i < 4; i++) {           // the verifier can lag a moment behind the ad
      const c = await d.rpc<{ ok: boolean; error?: string; coins?: number; reward?: number }>('claimAd', [placement, r.requestId]);
      if (c.ok) { d.update({ coins: c.coins }); paintWallet(); uiSound('ok'); rewardPop(c.reward ?? 0); return c.reward ?? 0; }
      if (c.error !== 'pending') { fail(c.error); return 0; }
      await sleep(1500);
    }
    d.toast(t('adFail'));
    return 0;
  } catch { d.toast(t('eServer')); return 0; } finally { busy = false; }
}
export const adsAvailable = () => adState === 'ok';

// ------------------------------------------------------------------ opening the screens
async function open(id: 'squad' | 'market' | 'shop') {
  await d.reload();
  paintWallet();
  const ok = await loadRules();
  d.screen(id);
  if (!ok) return;
  paintWallet();
  if (id === 'squad') renderSquad();
  else if (id === 'market') { tab = 'buy'; mkGrade = -1; mkItems = null; sellTyped.clear(); void renderMarket(); }
  else { VXShop.init(); await VXShop.refresh().catch(() => {}); renderShop(); }
}
export const openSquad = () => open('squad'), openMarket = () => open('market'), openShop = () => open('shop');

export function initEconomy(deps: EconomyDeps) {
  d = deps;
  $('gnav').querySelector('.eco-wallet')!.addEventListener('click', () => $('tabShop').click());
  $('squadCards').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.pick'); if (!b || busy) return;
    picked = Number(b.dataset.u); matUse = 0; $('forge').classList.remove('win', 'lose'); renderSquad();
  });
  $('forge').addEventListener('click', e => {
    const id = (e.target as HTMLElement).id;
    if (id === 'bEnhance') void enhance();
    if ((id === 'matPlus' || id === 'matMinus') && !busy) {
      const box = $('forge').querySelector<HTMLInputElement>('#forgeTicket'), ticket = !!box?.checked;   // a redraw must not untick the protection
      matUse += id === 'matPlus' ? 1 : -1;
      renderForge();
      const again = $('forge').querySelector<HTMLInputElement>('#forgeTicket');
      if (again) again.checked = ticket;
    }
  });
  document.querySelector('.m-tabs')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-tab]'); if (!b) return;
    tab = b.dataset.tab as typeof tab; void renderMarket();
  });
  $('marketTools').addEventListener('click', e => {
    const s = (e.target as HTMLElement).closest<HTMLElement>('button[data-sort]');
    if (s) { mkSort = s.dataset.sort as Sort; paintTools(); paintMarket(); return; }
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-grade]'); if (!b) return;
    mkGrade = Number(b.dataset.grade); paintTools(); paintMarket();
  });
  $('marketBody').addEventListener('input', e => {
    const i = e.target as HTMLInputElement; if (!i.classList.contains('m-input')) return;
    sellTyped.set(Number(i.dataset.u), i.value); paintNet(i);
  });
  $('marketBody').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    if (b.dataset.buy) void marketAct('marketBuy', [b.dataset.buy]);
    if (b.dataset.cancel) void marketAct('marketCancel', [b.dataset.cancel]);
    if (b.dataset.sell) void marketAct('marketSell', [Number(b.dataset.sell), Number(($(`sell${b.dataset.sell}`) as HTMLInputElement).value)]);
  });
  $('shop').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!b || b.disabled) return;
    if (b.dataset.vx) { VXShop.buyItem(b.dataset.vx); return; }
    if (b.dataset.pack) void shopAct('buyPack', [b.dataset.pack]);
    if (b.id === 'bScout') void shopAct('scout', []);
    if (b.id === 'bPrem1') void shopAct('premiumScout', [1]);
    if (b.id === 'bPrem10') void shopAct('premiumScout', [10]);
    if (b.id === 'bAdShop') void watchAd('shop-coins').then(async got => { if (got) await loadRules(); renderShop(); });
  });
  VXShop.onClose(async p => {
    if (!p.purchased) return;
    d.toast(t('shThanks'));
    for (let i = 0; i < 5; i++) { await sleep(1000); await d.reload(); paintWallet(); }   // delivery reaches the server a moment after the dialog closes
    renderShop();
  });
}
async function shopAct(fn: string, args: unknown[]) {
  if (busy) return;
  busy = true;
  const r = await call(fn, args) as (Reply & { card?: Card; got?: Card[]; packs?: Record<string, number> }) | null;
  busy = false;
  if (!r) return;
  if (!r.ok) { fail(r.error); return; }
  apply(r); uiSound('ok');
  const got = r.card ? [r.card] : r.got ?? [];
  if (got.length) { d.reveal(got, fn === 'scout' || fn === 'premiumScout' ? () => void shopAct(fn, args) : null, () => { d.screen('shop'); renderShop(); }); return; }
  d.toast(t('shThanks'));
  renderShop();
}
