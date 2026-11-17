// Controls guide: one action per page, each with a short clip recorded from the real game (public/video).
// One <video> is reused and its source released on close, so at most one clip is ever loaded.
// Phones play manager matches only (no direct control), so they get the manager pages instead: what the tactic
// buttons do, each with a still from a real manager match (public/video/guide_m_*.webp).
import { t, type Key as StrKey } from '../i18n.ts';
import { keyCap } from './keys.ts';

const $ = (id: string) => document.getElementById(id)!;
const VIDEO = import.meta.env.BASE_URL + 'video/guide_';

interface Page { clip?: string; img?: string; keys: string[]; title: StrKey; text: StrKey }
const PAGES: Page[] = [
  { clip: 'move', keys: ['←', '↑', '↓', '→'], title: 'gMove', text: 'gMoveT' },
  { clip: 'sprint', keys: ['E'], title: 'gSprint', text: 'gSprintT' },
  { clip: 'pass', keys: ['S'], title: 'gPass', text: 'gPassT' },
  { clip: 'switch', keys: ['S'], title: 'gSwitch', text: 'gSwitchT' },
  { clip: 'through', keys: ['W'], title: 'gThrough', text: 'gThroughT' },
  { clip: 'lift', keys: ['A'], title: 'gLift', text: 'gLiftT' },
  { clip: 'shoot', keys: ['D'], title: 'gShoot', text: 'gShootT' },
  { clip: 'check_b', keys: ['D'], title: 'gCheck', text: 'gCheckT' },
  { clip: 'skill2', keys: ['↓', '→', 'D'], title: 'gSkill', text: 'gSkillT' },
  { clip: 'fight', keys: ['F', 'D', 'S'], title: 'gFight', text: 'gFightT' },
];

const PHONE_PAGES: Page[] = [
  { img: 'm_play', keys: [], title: 'managerPlay', text: 'scTip' },
  { img: 'm_attack', keys: [], title: 'tacAttack', text: 'scAttack' },
  { img: 'm_balanced', keys: [], title: 'tacBalanced', text: 'scBalanced' },
  { img: 'm_defend', keys: [], title: 'tacDefend', text: 'scDefend' },
];
let pages = PAGES;
let page = 0;
const video = () => $('guideVideo') as HTMLVideoElement;
/** plays like a GIF: muted, looping, no controls. A play() cut short by the next page or by the browser is simply retried when the clip is ready */
function playClip() { void video().play().catch(() => { /* retried on canplay or a click */ }); }

function show(i: number) {
  page = (i + pages.length) % pages.length;
  const p = pages[page], v = video(), img = $('guideImg') as HTMLImageElement;
  for (const [n, el] of [...$('guideList').children].entries()) { el.classList.toggle('on', n === page); el.setAttribute('aria-current', n === page ? 'true' : 'false'); }
  $('guideTitle').textContent = t(p.title);
  $('guideText').textContent = t(p.text);
  $('guideKeys').innerHTML = p.keys.map(keyCap).join('');
  $('guideKeys').classList.toggle('hidden', !p.keys.length);
  $('guideStep').textContent = `${page + 1} / ${pages.length}`;
  v.classList.toggle('hidden', !p.clip); img.classList.toggle('hidden', !p.img);
  if (p.img) { img.src = `${VIDEO}${p.img}.webp`; closeGuide(); return; }
  v.src = `${VIDEO}${p.clip}_v3.mp4`;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;     // stays on its first frame
  playClip();
}

/** phone = a manager-only device: the tactic pages instead of the keyboard ones */
export function openGuide(phone = false) {
  if ((phone ? PHONE_PAGES : PAGES) !== pages) { pages = phone ? PHONE_PAGES : PAGES; page = 0; }
  $('guideList').innerHTML = pages.map((p, i) => `<button class="g-item" data-i="${i}">${t(p.title)}</button>`).join('');
  show(page);
}
/** frees the clip: an element keeps its decoded video until the source is removed */
export function closeGuide() {
  const v = video(); v.pause(); v.removeAttribute('src'); v.load();
}

$('guideList').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.g-item');
  if (b) show(Number(b.dataset.i));
});
video().addEventListener('canplay', playClip);
video().addEventListener('click', playClip);
$('guidePrev').addEventListener('click', () => show(page - 1));
$('guideNext').addEventListener('click', () => show(page + 1));
