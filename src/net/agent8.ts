// Verse8 Agent8 client: lobby (quick match, friend rooms, records) + the match link (latest-packet relay).
// Follows the patterns of the shipped pop-battle client: direct GameServer import (no React), explicit verse,
// `<verse>-preview` on the dev server, one connection shared by lobby and match.
import { GameServer } from '@agent8/gameserver/dist/src/server/GameServer.js';
import type { ChatResult, Link } from './transport.ts';
import type { Packet } from './protocol.ts';
import { NET } from './protocol.ts';
import { lineupOr, type Lobby, type MatchStart, type Record } from './lobby.ts';
import type { Lineup } from '../game/roster.ts';
import type { Team } from '../sim/types.ts';

function configuredVerse(): string | null {
  const o = import.meta.env.DEV ? new URLSearchParams(location.search).get('verse')?.trim() : null;
  return o || (import.meta.env.VITE_AGENT8_VERSE as string | undefined)?.trim() || null;
}
const targetVerse = (v: string) => (new URLSearchParams(location.search).get('verse') ? v : import.meta.env.DEV ? `${v}-preview` : v);

type Unsub = () => void;
interface Player { account: string; nick: string; team: Team; lineup?: unknown }

class Agent8Link implements Link {
  private subs: Unsub[] = [];
  private cbs: ((p: Packet) => void)[] = [];
  private left: (() => void)[] = [];
  private chats: ((team: Team, text: string) => void)[] = [];
  private closed = false;
  constructor(private s: GameServer, roomId: string, me: string, private onClose: () => void) {
    this.subs.push(s.onRoomMessage(roomId, 'chat', (m: { team?: number; text?: string }) => {
      if (this.closed || (m?.team !== 0 && m?.team !== 1) || typeof m.text !== 'string') return;
      for (const f of this.chats) f(m.team as Team, m.text.slice(0, 60));
    }));
    this.subs.push(s.subscribeRoomAllUserStates(roomId, (states: { account: string; p?: Packet }[]) => {
      if (this.closed || !Array.isArray(states)) return;
      for (const st of states) if (st && st.account !== me && st.p) for (const f of this.cbs) f(st.p);
    }));
    this.subs.push(s.onRoomMessage(roomId, 'left', (m: { account?: string }) => { if (m?.account && m.account !== me) this.left.forEach(f => f()); }));
  }
  send(p: Packet) {
    if (this.closed) return;
    try { void this.s.remoteFunction('st', [p], { throttle: NET.throttleMs }); } catch { /* not connected: next packet retries */ }
  }
  onPacket(cb: (p: Packet) => void) { this.cbs.push(cb); }
  onPeerLeft(cb: () => void) { this.left.push(cb); }
  /** the server filters, limits and sends it back to both of us as the room message 'chat' */
  async say(text: string): Promise<ChatResult> {
    if (this.closed) return 'fail';
    try {
      const r = await this.s.remoteFunction('chat', [text]) as { ok: boolean; reason?: string };
      return r?.ok ? 'ok' : r?.reason === 'slow' ? 'slow' : 'fail';
    } catch { return 'fail'; }
  }
  onChat(cb: (team: Team, text: string) => void) { this.chats.push(cb); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.subs.forEach(u => u()); this.subs = [];
    this.onClose();
  }
}

class Agent8Lobby implements Lobby {
  readonly kind = 'agent8' as const;
  private roomId: string | null = null;
  private waitStop: (() => void) | null = null;
  constructor(private s: GameServer) {}

  private get me() { return this.s.account; }
  private call<T>(fn: string, args: unknown[] = []) { return this.s.remoteFunction(fn, args) as Promise<T>; }

  private async leave() {
    if (!this.roomId) return;
    const id = this.roomId; this.roomId = null;
    try { await Promise.race([this.call('bye'), new Promise(r => setTimeout(r, 1500))]); } catch { /* best effort */ }
    try { this.s.leaveRoom(); } catch { /* */ } void id;
  }

  /** join a room, take a seat, then wait until both players are seated */
  private async enter(roomId: string, nick: string, mode: 'quick' | 'room', code: string, lineup: Lineup): Promise<MatchStart> {
    await this.leave();
    await this.s.joinRoom(roomId);
    this.roomId = roomId;
    const hello = await this.call<{ team: number; players: Player[] }>('hello', [nick, mode, code, lineup]);
    if (hello.team < 0) { await this.leave(); throw new Error('full'); }
    const team = hello.team as Team;
    const done = (players: Player[]): MatchStart => {
      const opp = players.find(p => p.account !== this.me);
      const mine = players.find(p => p.account === this.me);                     // the server's copy: it carries the card levels, or nothing if it refused the lineup
      const lineups = (team === 0 ? [lineupOr(mine?.lineup, 0), lineupOr(opp?.lineup, 1)] : [lineupOr(opp?.lineup, 0), lineupOr(mine?.lineup, 1)]) as [Lineup, Lineup];
      return { link: new Agent8Link(this.s, roomId, this.me, () => void this.leave()), team, opponent: opp?.nick ?? 'Player', matchId: roomId, lineups };
    };
    if (hello.players.length >= 2) return done(hello.players);
    return await new Promise<MatchStart>((resolve, reject) => {
      const unsub = this.s.subscribeRoomState(roomId, (st: { players?: Player[] }) => {
        if (st?.players && st.players.length >= 2) { cleanup(); resolve(done(st.players)); }
      });
      const unsub2 = this.s.onRoomMessage(roomId, 'start', (m: { players?: Player[] }) => {
        if (m?.players && m.players.length >= 2) { cleanup(); resolve(done(m.players)); }
      });
      const cleanup = () => { unsub(); unsub2(); this.waitStop = null; };
      this.waitStop = () => { cleanup(); reject(new Error('cancelled')); };
    });
  }

  async quick(nick: string, lineup: Lineup) {
    const { roomId } = await this.call<{ roomId: string }>('quickMatch');
    return this.enter(roomId, nick, 'quick', '', lineup);
  }
  async create(nick: string, lineup: Lineup) {
    const { roomId, code } = await this.call<{ roomId: string; code: string }>('createRoom');
    const ready = this.enter(roomId, nick, 'room', code, lineup);
    return { code, ready };
  }
  async join(code: string, nick: string, lineup: Lineup) {
    const r = await this.call<{ roomId?: string; error?: string }>('findRoom', [code]);
    if (!r.roomId) throw new Error(r.error === 'full' ? 'full' : 'not_found');
    return this.enter(r.roomId, nick, 'room', code, lineup);
  }
  cancel() { this.waitStop?.(); void this.leave(); }
  async record(): Promise<Record | null> { try { return await this.call<Record>('getRecord'); } catch { return null; } }
  rpc<T>(fn: string, args: unknown[] = []) { return this.call<T>(fn, args); }
  async report(_id: string, r: { winner: Team | -1; score: [number, number]; forfeit?: boolean }) {
    try { await this.call('report', [r.winner, r.score[0], r.score[1], !!r.forfeit]); } catch { /* not recorded */ }
    await this.leave();
  }
}

/** null when this build has no Verse8 project (local development) */
export async function createAgent8Lobby(): Promise<Lobby | null> {
  const verse = configuredVerse();
  if (!verse) return null;
  const s = new GameServer({ verse: targetVerse(verse) } as ConstructorParameters<typeof GameServer>[0]);
  const ok = await s.connect();
  if (!ok) throw new Error('connect_failed');
  return new Agent8Lobby(s);
}
