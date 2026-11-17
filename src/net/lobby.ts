// Matchmaking: quick match, friend rooms by code, records. Agent8 in production; a BroadcastChannel stand-in for
// local two-tab testing when no Verse8 project is configured.
import type { Link } from './transport.ts';
import { LoopbackLink } from './transport.ts';
import type { Team } from '../sim/types.ts';
import { DEFAULT_LINEUPS, parseLineup, type Lineup } from '../game/roster.ts';
import type { Card } from '../game/economy.ts';

export interface MatchStart { link: Link; team: Team; opponent: string; matchId: string; lineups: [Lineup, Lineup] }
/** a lineup from the other side, or that team's default when it sent none / nonsense */
export const lineupOr = (x: unknown, team: Team): Lineup => parseLineup(x) ?? DEFAULT_LINEUPS[team];
export interface Record { w: number; l: number; d: number; rp?: number; coins?: number; gems?: number; tickets?: number; season?: string; owned?: string[]; cards?: Card[]; packs?: { [id: string]: number }; nick?: string; lineup?: unknown }
export interface Lobby {
  readonly kind: 'agent8' | 'local';
  quick(nick: string, lineup: Lineup): Promise<MatchStart>;
  /** create a friend room; `ready` resolves when someone joins */
  create(nick: string, lineup: Lineup): Promise<{ code: string; ready: Promise<MatchStart> }>;
  join(code: string, nick: string, lineup: Lineup): Promise<MatchStart>;
  cancel(): void;
  record(): Promise<Record | null>;
  /** spend coins on a character */
  /** any other server method (cards, market, shop) */
  rpc<T>(fn: string, args?: unknown[]): Promise<T>;
  /** both players report; the server keeps a result only when the two reports agree */
  report(matchId: string, r: { winner: Team | -1; score: [number, number]; me: Team; forfeit?: boolean }): Promise<void>;
}

const randomId = () => Math.random().toString(36).slice(2, 10);
export const randomCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[(Math.random() * 32) | 0]).join('');

/** two tabs of this browser find each other through a BroadcastChannel */
export class LocalLobby implements Lobby {
  readonly kind = 'local' as const;
  private ch = new BroadcastChannel('faceoff:lobby');
  private me = randomId();
  private stop: (() => void) | null = null;

  private wait(match: (d: any) => MatchStart | null, announce: () => void): Promise<MatchStart> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent) => { const r = match(e.data); if (r) { cleanup(); resolve(r); } };
      const timer = setInterval(announce, 500);
      const cleanup = () => { clearInterval(timer); this.ch.removeEventListener('message', onMsg); this.stop = null; };
      this.stop = () => { cleanup(); reject(new Error('cancelled')); };
      this.ch.addEventListener('message', onMsg);
      announce();
    });
  }

  quick(nick: string, lineup: Lineup) {
    // both tabs announce; the smaller id hosts and confirms the pair
    return this.wait(d => {
      if (d.t === 'seek' && d.id !== this.me && this.me < d.id) {
        this.ch.postMessage({ t: 'pair', host: this.me, guest: d.id, hostNick: nick, hostLineup: lineup });
        return { link: new LoopbackLink(this.me, this.me), team: 0, opponent: d.nick, matchId: this.me, lineups: [lineup, lineupOr(d.lineup, 1)] as [Lineup, Lineup] };
      }
      if (d.t === 'pair' && d.guest === this.me) return { link: new LoopbackLink(d.host, this.me), team: 1, opponent: d.hostNick, matchId: d.host, lineups: [lineupOr(d.hostLineup, 0), lineup] as [Lineup, Lineup] };
      return null;
    }, () => this.ch.postMessage({ t: 'seek', id: this.me, nick, lineup }));
  }

  async create(nick: string, lineup: Lineup) {
    const code = randomCode();
    const ready = this.wait(d => {
      if (d.t === 'join' && d.code === code) {
        this.ch.postMessage({ t: 'joined', code, host: this.me, guest: d.id, hostNick: nick, hostLineup: lineup });
        return { link: new LoopbackLink(code, this.me), team: 0, opponent: d.nick, matchId: code, lineups: [lineup, lineupOr(d.lineup, 1)] as [Lineup, Lineup] };
      }
      return null;
    }, () => {});
    return { code, ready };
  }
  join(code: string, nick: string, lineup: Lineup) {
    return this.wait(d => d.t === 'joined' && d.code === code && d.guest === this.me
      ? { link: new LoopbackLink(code, this.me), team: 1, opponent: d.hostNick, matchId: code, lineups: [lineupOr(d.hostLineup, 0), lineup] as [Lineup, Lineup] } : null,
      () => this.ch.postMessage({ t: 'join', code, id: this.me, nick, lineup }));
  }
  cancel() { this.stop?.(); }

  rpc<T>(): Promise<T> { return Promise.reject(new Error('offline')); }
  async record() {
    try { return JSON.parse(localStorage.getItem('faceoff:record') || 'null') ?? { w: 0, l: 0, d: 0 }; } catch { return null; }
  }
  async report(_id: string, r: { winner: Team | -1; me: Team }) {
    const rec = (await this.record()) ?? { w: 0, l: 0, d: 0 };
    if (r.winner === -1) rec.d++; else if (r.winner === r.me) rec.w++; else rec.l++;
    try { localStorage.setItem('faceoff:record', JSON.stringify(rec)); } catch { /* private mode */ }
  }
}
