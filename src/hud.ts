// In-game HUD (DOM): scoreboard, clock, banners, shot charge, shootout tally, network info.
// Only writes when a value changed.
import { t } from './i18n.ts';
import type { FightView, MatchEvent, Team } from './sim/types.ts';
import { sfx, cheer, impact } from './audio.ts';
import { CHARACTER, DEFAULT_LINEUPS, skillOfModel, type Lineup } from './game/roster.ts';
import { SKILL, SKILL_COLOR, FIGHT } from './sim/constants.ts';
import { skillCaps, skillName } from './game/skills.ts';

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private last = { s0: -1, s1: -1, clock: '', charge: -2, so: '' };
  private bannerTimer = 0;
  private ltTimer = 0;
  private lineups: [Lineup, Lineup] = [DEFAULT_LINEUPS[0], DEFAULT_LINEUPS[1]];
  /** goals and shots by skater id this match (for the MVP) */
  goals = new Array(8).fill(0);
  shots = new Array(8).fill(0);
  /** which team is "me" (for colours / wording) */
  me: Team = 0;
  /** the AI plays my team (mobile manager): no fight prompts */
  auto = false;
  private fightLast = '';
  private soTipShown = false;            // the fake-then-lift tip, once per match on my first shootout attempt
  private skillLast = '';
  private skillOwner = -1;
  private skillKind = '';

  show(on: boolean) { $('hud').classList.toggle('hidden', !on); $('quitAsk').classList.add('hidden'); }
  setNames(a: string, b: string) { $('n0').textContent = a; $('n1').textContent = b; }
  setLineups(l: [Lineup, Lineup]) { this.lineups = l; }
  /** the character a skater id plays (ids 0..3 team 0, 4..7 team 1; slot 3 is the goalie) */
  idOf(id: number) { const l = this.lineups[id < 4 ? 0 : 1], slot = id % 4; return slot === 3 ? l.goalie : l.skaters[slot]; }
  nameOf(id: number) { return CHARACTER[this.idOf(id)]?.name ?? ''; }
  /** fight offer, the fight bars and the morale tags; called every frame, writes only what changed */
  fight(f: FightView | null, offer: { team: Team; t: number } | null, morale: [number, number]) {
    const on = (id: string, show: boolean) => $(id).classList.toggle('hidden', !show);
    const myOffer = !!offer && offer.team === this.me && !this.auto;
    on('offer', myOffer);
    if (myOffer) ($('offerBar') as HTMLElement).style.width = `${(offer!.t / FIGHT.offerSeconds) * 100}%`;
    on('fightHud', !!f);
    on('fightKeys', !!f && !this.auto && !f.over && [f.a, f.b].some(id => (id < 4 ? 0 : 1) === this.me));
    if (f) {
      const left = f.a < 4 ? 0 : 1;                          // team 0's fighter on the left, under its scoreboard end
      const key = `${f.a},${f.b},${f.hp.join()},${f.st.map(n => n.toFixed(2)).join()},${Math.ceil(f.t)}`;
      if (key !== this.fightLast) {
        this.fightLast = key;
        for (const [k, side] of [[left, 0], [1 - left, 1]] as const) {
          $(`fn${side}`).textContent = this.nameOf(k === 0 ? f.a : f.b);
          $(`fhp${side}`).style.width = `${Math.max(0, f.hp[k])}%`;
          $(`ftr${side}`).style.width = `${Math.max(0, f.hp[k])}%`;
          $(`fst${side}`).style.width = `${f.st[k] * 100}%`;
        }
        $('fightT').textContent = String(Math.ceil(f.t));
      }
    }
    for (const k of [0, 1] as const) {
      const show = morale[k] > 0 && !f;                      // the fight bars use the same row under the scoreboard
      on(`mo${k}`, show);
      if (show) { const s = `${t('moraleTag')} ${Math.ceil(morale[k])}`; if ($(`mo${k}`).textContent !== s) $(`mo${k}`).textContent = s; }
    }
  }
  /** the skill chip for skater `id` (-1 hides it); called every frame, writes only what changed */
  skill(id: number, cd: number, active: number) {
    this.skillOwner = id;
    const kind = id >= 0 && !this.auto ? skillOfModel(this.idOf(id)) : 'none';
    const key = kind === 'none' ? '' : `${kind},${cd.toFixed(1)},${active > 0}`;
    if (key === this.skillLast) return;
    this.skillLast = key;
    const el = $('skill');
    el.classList.toggle('hidden', kind === 'none');
    if (kind === 'none') return;
    el.classList.toggle('ready', cd <= 0);
    el.classList.toggle('active', active > 0);
    if (kind !== this.skillKind) { this.skillKind = kind; $('skName').textContent = skillName(kind); $('skKeys').innerHTML = skillCaps(kind); }
    $('skCd').textContent = cd > 0 ? String(Math.ceil(cd)) : '';
    $('skFill').style.width = `${cd > 0 ? (1 - cd / SKILL[kind].cd) * 100 : 0}%`;
  }
  /** centre pop card (goal, period end, overtime) with a team-colour (or gold) top edge */
  lowerThird(main: string, sub = '', team: Team | -1 = -1, sec = 2.6) {
    const el = $('lt'); $('ltMain').textContent = main; $('ltSub').textContent = sub;
    el.classList.remove('t0', 't1'); if (team >= 0) el.classList.add('t' + team);
    el.classList.add('show');
    clearTimeout(this.ltTimer); this.ltTimer = window.setTimeout(() => el.classList.remove('show'), sec * 1000);
  }
  /** player of the match: most goals, then most shots, on the winning side (any side for a draw) */
  mvp(winner: Team | -1) {
    let best = -1, bs = -1;
    for (let id = 0; id < 8; id++) {
      if (id % 4 === 3) continue;
      if (winner !== -1 && (id < 4 ? 0 : 1) !== winner) continue;
      const sc = this.goals[id] * 10 + this.shots[id];
      if (sc > bs) { bs = sc; best = id; }
    }
    return best < 0 ? null : { id: best, model: this.idOf(best), name: this.nameOf(best), goals: this.goals[best], shots: this.shots[best] };
  }

  /** charge: shot power 0..1 (−1 hidden); pass = the bar shows a pass being charged instead */
  update(score: [number, number], clock: number, charge: number, overtime = false, pass = false, period = 1) {
    if (score[0] !== this.last.s0) { this.last.s0 = score[0]; $('s0').textContent = String(score[0]); }
    if (score[1] !== this.last.s1) { this.last.s1 = score[1]; $('s1').textContent = String(score[1]); }
    const c = (overtime ? 'OT ' : t('periodTag').replace('{n}', String(period)) + ' ') + `${Math.floor(clock / 60)}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;
    if (c !== this.last.clock) { this.last.clock = c; $('clock').textContent = c; }
    const ch = charge < 0 ? -1 : Math.round(charge * 50) / 50 + (pass ? 10 : 0);
    if (ch !== this.last.charge) {
      this.last.charge = ch;
      $('charge').classList.toggle('pass', pass);
      $('charge').style.display = ch < 0 ? 'none' : 'block';
      if (ch >= 0) ($('charge').firstElementChild as HTMLElement).style.width = `${(ch % 10) * 100}%`;
    }
  }

  shootout(results: [boolean[], boolean[]] | null) {
    const el = $('so');
    if (!results) { if (this.last.so) { el.classList.add('hidden'); this.last.so = ''; } return; }
    const dots = (r: boolean[]) => { const n = Math.max(3, r.length); let h = ''; for (let i = 0; i < n; i++) h += `<span class="dot ${i < r.length ? (r[i] ? 'g' : 'x') : ''}"></span>`; return h; };
    const html = `<span class="t0">${dots(results[0])}</span> &nbsp;${t('soScore')}&nbsp; <span class="t1">${dots(results[1])}</span>`;
    if (html !== this.last.so) { this.last.so = html; el.innerHTML = html; el.classList.remove('hidden'); }
  }

  /** team = whose moment it is: the plate's top edge takes that team's colour (blue home, red away); none = neutral */
  banner(text: string, color = '#fff', sec = 1.3, team: Team | -1 = -1) {
    const b = $('banner'); b.textContent = text; b.style.color = color; b.dataset.team = String(team); b.classList.add('show');
    clearTimeout(this.bannerTimer); this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), sec * 1000);
  }
  ping(text: string) { $('ping').textContent = text; }
  /** a chat line from either player: name in its team colour, gone after 8 s, the last five kept */
  chatLine(team: Team, text: string) {
    if (this.chatMuted && team !== this.me) return;                      // the other player's lines are off
    const log = $('chatLog'), row = document.createElement('div'), who = document.createElement('b'), say = document.createElement('span');
    row.className = 'chat-row'; who.className = `t${team}`;
    who.textContent = $(`n${team}`).textContent ?? ''; say.textContent = text;          // text only: a line never becomes markup
    row.append(who, say); log.append(row);
    while (log.children.length > 5) log.firstElementChild?.remove();
    setTimeout(() => row.classList.add('old'), 8000);
  }
  /** the other player's chat lines hidden; my own still show (kept between matches) */
  chatMuted = (() => { try { return localStorage.getItem('faceoff:chatMute') === '1'; } catch { return false; } })();
  setChatMuted(on: boolean) {
    this.chatMuted = on;
    try { localStorage.setItem('faceoff:chatMute', on ? '1' : '0'); } catch { /* private mode */ }
    const b = $('chatMute'); b.textContent = t(on ? 'chatUnmute' : 'chatMuteBtn'); b.classList.toggle('on', on);
    if (on) for (const row of [...$('chatLog').children]) if (!row.querySelector(`b.t${this.me}`)) row.remove();
  }
  /** chat is there in online matches only */
  chatOn(on: boolean) { $('chat').classList.toggle('hidden', !on); $('chatLog').textContent = ''; this.setChatMuted(this.chatMuted); }
  reset() { this.chatOn(false); $('hint').textContent = t('hint'); this.soTipShown = false; this.auto = false; this.fightLast = ''; this.last = { s0: -1, s1: -1, clock: '', charge: -2, so: '' }; this.shootout(null); $('banner').classList.remove('show'); $('lt').classList.remove('show'); this.goals.fill(0); this.shots.fill(0); this.skill(-1, 0, 0); }

  private calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** the red edge of the screen when my skater takes a hit */
  private hurt(strength: number) {
    if (!this.calm) $('hitFlash').animate([{ opacity: strength }, { opacity: 0 }], { duration: 280, easing: 'ease-out' });
  }
  /** the fighter's health panel jumps when he is hit (team 0's panel is on the left) */
  private rock(team: Team, px: number) {
    if (!this.calm) $(`fn${team}`).parentElement!.animate([{ transform: `translate(${team ? px : -px}px, 2px)` }, { transform: `translate(${team ? -px / 3 : px / 3}px, 0)` }, { transform: 'none' }], { duration: 200, easing: 'ease-out' });
  }

  /** presentation of simulation events. teamOf maps a skater id to its team. returns screen shake amount */
  onEvent(e: MatchEvent, teamOf: (id: number) => Team): number {
    switch (e.t) {
      case 'pass': sfx('pass'); return 0;
      case 'shot': sfx('shot'); if (e.by >= 0 && e.by < 8) this.shots[e.by]++; return 0.12 + 0.2 * e.power;
      case 'save': sfx('save'); cheer('save'); this.banner(t('save'), '#cfe8ff', 0.6, teamOf(e.by)); return 0.1;
      case 'post': sfx('post'); this.banner(t('post'), '#ffd34d', 0.7); return 0.15;
      case 'board': sfx('board', Math.min(1, e.speed / 20)); return 0;
      case 'check':
        impact(e.hard ? 'big' : 'check');
        if (e.hard) cheer('save', 0.5);
        if (teamOf(e.by) === this.me || teamOf(e.on) === this.me) this.banner(t(e.hard ? 'bigHit' : 'check'), e.hard ? '#ffc42e' : '#ffb36b', e.hard ? 0.85 : 0.6, teamOf(e.by));
        if (e.hard && teamOf(e.on) === this.me) this.hurt(0.7);
        return e.hard ? 0.42 : 0.2;
      case 'bump': impact('bump', 0.8); return 0.07;
      case 'collide': impact('bump', Math.min(1.3, e.speed / 7)); return Math.min(0.16, e.speed * 0.016);
      case 'boardHit': impact('boards', Math.min(1, 0.5 + e.speed / 16)); cheer('save', 0.6); return 0.5;
      case 'skill':
        sfx('skill');
        if (e.by === this.skillOwner) this.banner(skillName(e.kind), `#${SKILL_COLOR[e.kind].toString(16).padStart(6, '0')}`, 0.7, teamOf(e.by));
        return e.kind === 'charge' || e.kind === 'sweep' ? 0.16 : 0.06;
      case 'goal': {
        sfx('horn'); cheer('goal');
        if (e.by >= 0 && e.by < 8) this.goals[e.by]++;
        this.lowerThird(t('goal'), e.by >= 0 ? this.nameOf(e.by) : '', e.team, 3);
        return 0.6;
      }
      case 'fightOffer': sfx('tick'); return 0;
      case 'fightStart': sfx('whistle'); cheer('goal', 0.6); this.banner(t('fight'), '#f2c230', 1.1); return 0.2;
      case 'fightHit':
        impact('punch');
        this.rock(teamOf(e.on), 9);
        if (teamOf(e.on) === this.me) this.hurt(1);
        return 0.3;
      case 'fightBlock': impact('block'); this.rock(teamOf(e.on), 3); return 0.1;
      case 'fightMiss': sfx('whiff'); return 0;
      case 'fightEnd':
        if (e.ko) impact('ko');
        sfx('horn'); cheer('goal');
        if (e.winner === -1) this.lowerThird(t('fightDraw'), '', -1, 2.4);
        else this.lowerThird(`${this.nameOf(e.by)} ${t(e.ko ? 'fightKO' : 'fightWin')}`, t('fightMorale'), e.winner, 3);
        return 0.3;
      case 'fake': sfx('pass', 0.45); return 0;
      case 'faceoff': this.banner(t('faceoff'), '#fff', 0.8); return 0;
      case 'periodEnd': sfx('whistle'); this.lowerThird(t('periodEndMain').replace('{n}', String(e.period)), t('changeEnds'), -1, 3.4); return 0;
      case 'go': sfx('whistle'); this.banner(t('go'), '#fff', 0.5); return 0;
      case 'overtime': sfx('whistle'); this.lowerThird(t('otMain'), t('otSub'), -1, 3); return 0;
      case 'shootoutStart': sfx('whistle'); this.lowerThird(t('shootout'), t('soSub'), -1, 3); return 0;
      case 'shootoutAttempt':
        $('hint').textContent = t(e.team === this.me ? 'soShootHint' : 'soSaveHint');
        if (e.team === this.me && !this.auto && !this.soTipShown) { this.soTipShown = true; this.lowerThird(t('soTipMain'), t('soTipSub'), -1, 4); }
        this.banner(e.team === this.me ? t('yourShot') : t('yourSave'), e.team === this.me ? '#6fb6ff' : '#ff7b7b', 1.1, this.me); return 0;
      case 'shootoutResult': if (e.scored) { sfx('horn'); this.banner(t('goal'), e.team === this.me ? '#6fb6ff' : '#ff7b7b', 1.2, e.team); } else { sfx('save'); this.banner(t('save'), '#cfe8ff', 0.9, (1 - e.team) as Team); } return e.scored ? 0.5 : 0.1;
      default: return 0;
    }
  }
}
