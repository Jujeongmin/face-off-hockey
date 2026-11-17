// Stage progress sync, no DOM. The server's stars are the truth; a clear that could not be sent yet (offline) is kept
// in a queue and shown on top of them until it goes through. A clear the server refused is simply not pending, so it
// does not linger as a fake unlock.
export interface Pending { id: string; stars: number; seconds: number }

export function visibleStars(server: Record<string, number>, pending: readonly Pending[]): Record<string, number> {
  const out = { ...server };
  for (const p of pending) if (p.stars > 0) out[p.id] = Math.max(out[p.id] ?? 0, p.stars);
  return out;
}

/** clears waiting to be sent. flush() sends each once: overlapping calls share the run in flight, and an item leaves
 *  the list before its send and comes back only if that send fails */
export class PendingQueue {
  private running: Promise<void> | null = null;
  private read: () => Pending[];
  private write: (v: Pending[]) => void;
  constructor(read: () => Pending[], write: (v: Pending[]) => void) { this.read = read; this.write = write; }
  get list(): Pending[] { return this.read(); }
  add(p: Pending) { this.write([...this.read(), p]); }
  flush(send: (p: Pending) => Promise<unknown>): Promise<void> {
    if (!this.running) this.running = this.run(send).finally(() => { this.running = null; });
    return this.running;
  }
  private async run(send: (p: Pending) => Promise<unknown>) {
    for (;;) {
      const [p, ...rest] = this.read();
      if (!p) return;
      this.write(rest);
      try { await send(p); } catch { this.write([p, ...this.read()]); return; }
    }
  }
}

/** only the wallet part of a server reply goes into the profile (the whole reply put ok / error / stars / reward on it) */
const WALLET_KEYS = ['coins', 'gems', 'tickets', 'cards', 'owned', 'pity', 'mats', 'premPity'] as const;
export const walletOf = (r: Record<string, unknown>) => Object.fromEntries(WALLET_KEYS.filter(k => k in r).map(k => [k, r[k]]));
