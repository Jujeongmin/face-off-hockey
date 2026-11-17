// Stage progress sync: the server is the authority, only clears still waiting to be sent count on top of it, and a
// pending clear is sent once even when two loads overlap (node --experimental-strip-types tests/stagesync.test.ts)
import { visibleStars, PendingQueue, walletOf, type Pending } from '../src/game/stageSync.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };

check('server stars win over nothing pending', JSON.stringify(visibleStars({ '1-1': 2 }, [])) === JSON.stringify({ '1-1': 2 }));
check('a pending clear shows on top of the server', visibleStars({ '1-1': 2 }, [{ id: '1-2', stars: 1, seconds: 30 }])['1-2'] === 1);
check('a pending clear never lowers the server', visibleStars({ '1-1': 3 }, [{ id: '1-1', stars: 1, seconds: 30 }])['1-1'] === 3);
check('a refused local clear is gone once not pending', visibleStars({}, [])['1-3'] === undefined);

let store: Pending[] = [{ id: '1-1', stars: 2, seconds: 40 }, { id: '1-2', stars: 1, seconds: 30 }];
const q = new PendingQueue(() => store, v => { store = v; });
const sent: string[] = [];
const send = async (p: Pending) => { await new Promise(r => setTimeout(r, 20)); sent.push(p.id); };
await Promise.all([q.flush(send), q.flush(send)]);
check('two overlapping flushes send each clear once', JSON.stringify(sent) === JSON.stringify(['1-1', '1-2']), sent);
check('the queue is empty after sending', store.length === 0, store);

store = [{ id: '1-3', stars: 1, seconds: 30 }];
await q.flush(async () => { throw new Error('offline'); });
check('a failed send keeps the clear', store.length === 1 && store[0].id === '1-3', store);
q.add({ id: '1-4', stars: 2, seconds: 30 });
check('add appends', store.length === 2);

{
  const w = walletOf({ ok: true, error: 'x', stars: { '1-1': 2 }, reward: { coins: 5 }, chests: [], coins: 10, cards: [], mats: {} });
  check('only wallet fields go into the profile', JSON.stringify(Object.keys(w).sort()) === JSON.stringify(['cards', 'coins', 'mats']), Object.keys(w));
}
if (failed) throw new Error(`${failed} stage sync check(s) failed`);
