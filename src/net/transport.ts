// A match link between the two players: each side publishes its latest packet; the other side gets it.
// Agent8 (production) and a BroadcastChannel loopback (two local tabs, optional fake latency) implement it.
import type { Packet } from './protocol.ts';
import type { Team } from '../sim/types.ts';
import { maskProfanity } from '../game/profanity.ts';

/** how a chat line went: sent, too soon after the last ones, or not sent */
export type ChatResult = 'ok' | 'slow' | 'fail';

export interface Link {
  send(p: Packet): void;
  onPacket(cb: (p: Packet) => void): void;
  onPeerLeft(cb: () => void): void;
  /** in-match chat. The server stars out swearing and limits the pace; every line reaches both players */
  say(text: string, team: Team): Promise<ChatResult>;
  onChat(cb: (team: Team, text: string) => void): void;
  close(): void;
}

/** Two browser tabs on one machine. ?lag=ms adds one-way delay (+ jitter) to test the netcode without a server. */
export class LoopbackLink implements Link {
  private ch: BroadcastChannel;
  private cbs: ((p: Packet) => void)[] = [];
  private left: (() => void)[] = [];
  private lag: number;
  private closed = false;
  private chats: ((team: Team, text: string) => void)[] = [];
  private chatAt: number[] = [];

  constructor(room: string, private me: string) {
    this.ch = new BroadcastChannel('faceoff:' + room);
    this.lag = Number(new URLSearchParams(location.search).get('lag') || 0);
    this.ch.onmessage = e => {
      const d = e.data as { from: string; p?: Packet; bye?: boolean; chat?: { team: Team; text: string } };
      if (d.from === this.me || this.closed) return;
      if (d.bye) { this.left.forEach(f => f()); return; }
      if (d.chat) { const c = d.chat; this.chats.forEach(f => f(c.team, maskProfanity(c.text))); return; }
      const deliver = () => { if (!this.closed && d.p) this.cbs.forEach(f => f(d.p!)); };
      if (this.lag > 0) setTimeout(deliver, this.lag + Math.random() * this.lag * 0.3); else deliver();
    };
    addEventListener('pagehide', () => this.close());
  }
  send(p: Packet) { if (!this.closed) this.ch.postMessage({ from: this.me, p }); }
  onPacket(cb: (p: Packet) => void) { this.cbs.push(cb); }
  onPeerLeft(cb: () => void) { this.left.push(cb); }
  /** the server's rules (server.ts chat) played locally: 60 characters, one line per 0.8 s, five per 10 s, starred out */
  async say(text: string, team: Team): Promise<ChatResult> {
    const line = text.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (this.closed || !line) return 'fail';
    const now = Date.now();
    this.chatAt = this.chatAt.filter(t => now - t < 10000);
    if (this.chatAt.length >= 5 || (this.chatAt.length && now - this.chatAt[this.chatAt.length - 1] < 800)) return 'slow';
    this.chatAt.push(now);
    const clean = maskProfanity(line);
    this.ch.postMessage({ from: this.me, chat: { team, text: clean } });
    this.chats.forEach(f => f(team, clean));
    return 'ok';
  }
  onChat(cb: (team: Team, text: string) => void) { this.chats.push(cb); }
  close() { if (this.closed) return; this.ch.postMessage({ from: this.me, bye: true }); this.closed = true; this.ch.close(); }
}
