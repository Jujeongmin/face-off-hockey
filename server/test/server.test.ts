/** Matchmaking / rooms / records (local harness: npx -y @agent8/gameserver-node test). No real network here. */

test('first player hosts, second is team 1, third is turned away', async (server: any) => {
  const ROOM = 'fo-test0001';
  await server.simulateJoin(ROOM, 'alice');
  server.connect({ account: 'alice', roomId: ROOM });
  expect((await server.hello('Alice', 'quick', '')).team).toBe(0);
  await server.simulateJoin(ROOM, 'bob');
  server.connect({ account: 'bob', roomId: ROOM });
  const b = await server.hello('Bob', 'quick', '');
  expect(b.team).toBe(1);
  expect(b.players.length).toBe(2);
  await server.simulateJoin(ROOM, 'carol');
  server.connect({ account: 'carol', roomId: ROOM });
  expect((await server.hello('Carol', 'quick', '')).team).toBe(-1);
});

test('records are written only when both reports agree', async (server: any) => {
  const ROOM = 'fo-test0002';
  await server.simulateJoin(ROOM, 'dan');
  server.connect({ account: 'dan', roomId: ROOM }); await server.hello('Dan', 'quick', '');
  await server.simulateJoin(ROOM, 'eve');
  server.connect({ account: 'eve', roomId: ROOM }); await server.hello('Eve', 'quick', '');
  server.connect({ account: 'dan', roomId: ROOM });
  expect((await server.report(0, 3, 1, false)).recorded).toBe(false);
  server.connect({ account: 'eve', roomId: ROOM });
  expect((await server.report(1, 3, 1, false)).recorded).toBe(false);     // disagrees: nothing written
  expect((await server.report(0, 3, 1, false)).recorded).toBe(true);
  server.connect({ account: 'dan', roomId: ROOM });
  expect((await server.getRecord()).w).toBe(1);
  server.connect({ account: 'eve', roomId: ROOM });
  expect((await server.getRecord()).l).toBe(1);
});

test('forfeit: the remaining player alone can settle after the other leaves', async (server: any) => {
  const ROOM = 'fo-test0003';
  await server.simulateJoin(ROOM, 'fay');
  server.connect({ account: 'fay', roomId: ROOM }); await server.hello('Fay', 'quick', '');
  await server.simulateJoin(ROOM, 'gus');
  server.connect({ account: 'gus', roomId: ROOM }); await server.hello('Gus', 'quick', '');
  await server.bye();
  server.connect({ account: 'fay', roomId: ROOM });
  expect((await server.report(0, 1, 0, true)).recorded).toBe(true);
  expect((await server.getRecord()).w).toBe(1);
});

test('friend room code resolves to the room; quick match pairs into a waiting room', async (server: any) => {
  server.connect({ account: 'hal', roomId: '__no_room__' });
  const { roomId, code } = await server.createRoom();
  expect(typeof code).toBe('string');
  server.connect({ account: 'ivy', roomId: '__no_room__' });
  expect((await server.findRoom(code)).roomId).toBe(roomId);
  expect((await server.findRoom('ZZZZZ')).error).toBe('not_found');
  server.connect({ account: 'jon', roomId: '__no_room__' });
  const q1 = await server.quickMatch();
  await server.simulateJoin(q1.roomId, 'jon');
  server.connect({ account: 'kim', roomId: '__no_room__' });
  const q2 = await server.quickMatch();
  expect(q2.roomId).toBe(q1.roomId);
});

test('quick match: the second searcher takes a room whose creator has not joined yet (no two lonely rooms)', async (server: any) => {
  server.connect({ account: 'max', roomId: '__no_room__' });
  const q1 = await server.quickMatch();                       // max is still on his way into the room
  server.connect({ account: 'ned', roomId: '__no_room__' });
  const q2 = await server.quickMatch();
  expect(q2.roomId).toBe(q1.roomId);
  server.connect({ account: 'oli', roomId: '__no_room__' });
  expect((await server.quickMatch()).roomId === q1.roomId).toBe(false);   // claimed: a third player gets a new room
});

test('st stores the latest packet; oversized packets are ignored', async (server: any) => {
  const ROOM = 'fo-test0005';
  await server.simulateJoin(ROOM, 'lee');
  server.connect({ account: 'lee', roomId: ROOM });
  await server.st({ k: 'i', q: 1 });
  await server.st({ k: 'i', q: 2, junk: 'x'.repeat(7000) });
  const st = await server.getRecord();
  expect(st.w).toBe(0);
});

test('ranked: a quick-match win gives rank points and coins, a friend room only W/L', async (server: any) => {
  const Q = 'fo-test0007';
  await server.simulateJoin(Q, 'pia'); server.connect({ account: 'pia', roomId: Q }); await server.hello('Pia', 'quick', '');
  await server.simulateJoin(Q, 'quo'); server.connect({ account: 'quo', roomId: Q }); await server.hello('Quo', 'quick', '');
  server.connect({ account: 'pia', roomId: Q }); await server.report(0, 3, 1, false);
  server.connect({ account: 'quo', roomId: Q }); expect((await server.report(0, 3, 1, false)).recorded).toBe(true);
  server.connect({ account: 'pia', roomId: Q });
  const w = await server.getRecord();
  expect(w.w).toBe(1); expect(w.rp).toBe(1000 + 20 + 4); expect(w.coins).toBe(40 + 15);
  server.connect({ account: 'quo', roomId: Q });
  const l = await server.getRecord();
  expect(l.rp).toBe(1000 - 15); expect(l.coins).toBe(15 + 5);

  const R = 'fo-test0008';
  await server.simulateJoin(R, 'ray'); server.connect({ account: 'ray', roomId: R }); await server.hello('Ray', 'room', 'ABCDE');
  await server.simulateJoin(R, 'sam'); server.connect({ account: 'sam', roomId: R }); await server.hello('Sam', 'room', 'ABCDE');
  server.connect({ account: 'ray', roomId: R }); await server.report(0, 2, 0, false);
  server.connect({ account: 'sam', roomId: R }); await server.report(0, 2, 0, false);
  server.connect({ account: 'ray', roomId: R });
  const f = await server.getRecord();
  expect(f.w).toBe(1); expect(f.rp).toBe(1000); expect(f.coins).toBe(0);
});

test('a character the account has no card for is dropped from its lineup', async (server: any) => {
  const T = 'fo-test0009';
  await server.simulateJoin(T, 'pia'); server.connect({ account: 'pia', roomId: T });
  const h = await server.hello('Pia', 'quick', '', { skaters: ['casual_female', 'jelly', 'ganz0'], goalie: 'worker_female' });
  expect(h.players[0].lineup).toBe(undefined);                         // jelly is locked for pia
  await server.simulateJoin(T, 'tom'); server.connect({ account: 'tom', roomId: T });
  const h2 = await server.hello('Tom', 'quick', '', { skaters: ['casual_female', 'ninja_female', 'ganz0'], goalie: 'worker_female' });
  expect(h2.players[1].lineup.goalie).toBe('worker_female');
});


test('old accounts get bound +0 cards for what they owned', async (server: any) => {
  server.connect({ account: 'old1', roomId: '__no_room__' });
  await $global.updateUserState('old1', { coins: 5, owned: ['jelly'] });
  const r = await server.getRecord();
  expect(r.cards.length).toBe(6);
  expect(r.cards.every((c: any) => c.b === 1 && c.l === 0)).toBe(true);
  expect(r.owned.includes('jelly')).toBe(true);
});

test('enhance: costs coins, rolls on the server, drops from +6 unless protected', async (server: any) => {
  server.connect({ account: 'enh1', roomId: '__no_room__' });
  const u = (await server.getRecord()).cards[0].u;
  expect((await server.enhance(u, false)).error).toBe('coins');
  expect((await server.enhance(999, false)).error).toBe('card');
  const orig = Math.random;
  try {
    await $global.updateUserState('enh1', { coins: 10000, tickets: 1 });
    Math.random = () => 0;                                             // always succeeds
    const a = await server.enhance(u, false);
    expect(a.success).toBe(true); expect(a.level).toBe(1); expect(a.coins).toBe(9950);
    Math.random = () => 0.999;                                         // always fails
    const b = await server.enhance(u, false);
    expect(b.success).toBe(false); expect(b.level).toBe(1);            // below +6: the level is kept
    const r = await server.getRecord();
    r.cards[0].l = 5;
    await $global.updateUserState('enh1', { cards: r.cards });
    const unprotected = await server.enhance(u, false);
    expect(unprotected.level).toBe(4);                                 // trying for +6 drops one
    r.cards[0].l = 5;
    await $global.updateUserState('enh1', { cards: r.cards });
    const prot = await server.enhance(u, true);
    expect(prot.level).toBe(5); expect(prot.protected).toBe(true); expect(prot.tickets).toBe(0);
  } finally { Math.random = orig; }
});

test('the lineup carries levels from the server, not from the client', async (server: any) => {
  const R = 'fo-test0010';
  await $global.updateUserState('lvl1', { cards: [{ u: 1, m: 'casual_female', l: 7, b: 1 }, { u: 2, m: 'casual_female', l: 2, b: 1 }, { u: 3, m: 'ninja_female', l: 0, b: 1 }, { u: 4, m: 'ganz0', l: 0, b: 1 }, { u: 5, m: 'worker_female', l: 3, b: 1 }] });
  await server.simulateJoin(R, 'lvl1'); server.connect({ account: 'lvl1', roomId: R });
  const h = await server.hello('L', 'quick', '', { skaters: ['casual_female', 'ninja_female', 'ganz0'], goalie: 'worker_female', levels: [10, 10, 10, 10] });
  expect(h.players[0].lineup.levels.join()).toBe('7,2,2,3');               // enhancement plus the character's grade bonus
});

test('scout: the server rolls the grade, shows the odds, and the 30th scout without gold is at least gold', async (server: any) => {
  server.connect({ account: 'gacha1', roomId: '__no_room__' });
  await server.getRecord();
  await $global.updateUserState('gacha1', { coins: 100000 });
  const eco = await server.getEconomy();
  expect(Math.round(eco.gradeOdds.reduce((a: number, b: number) => a + b, 0) * 1e6)).toBe(1e6);
  const orig = Math.random;
  try {
    Math.random = () => 0;                                             // always the commonest grade
    for (let i = 0; i < 29; i++) expect((await server.scout()).card.m).toBe('casual_female');
    expect((await server.getRecord()).pity).toBe(29);
    const pity = await server.scout();
    expect(pity.card.m).toBe('mking'); expect(pity.pity).toBe(0);
    Math.random = () => 0.9999;
    expect((await server.scout()).card.m).toBe('sword1');             // the last legend in the list
  } finally { Math.random = orig; }
});

test('a duplicate from a scout is material: no card, chosen amount spent, success rate raised, never more than held or allowed', async (server: any) => {
  server.connect({ account: 'dup1', roomId: '__no_room__' });
  const first = await server.getRecord();
  await $global.updateUserState('dup1', { coins: 100000 });
  const orig = Math.random;
  try {
    Math.random = () => 0;                                             // the commonest grade: casual_female, which every account starts with
    const before = first.cards.length;
    const d1 = await server.scout();
    expect(d1.card.dup).toBe(1); expect(d1.cards.length).toBe(before); expect(d1.mats.casual_female).toBe(1);
    await $global.updateUserState('dup1', { mats: { casual_female: 3 } });
    const r = await server.getRecord();
    const c = r.cards.find((x: any) => x.m === 'casual_female');
    c.l = 7;                                                           // 25% to +8
    await $global.updateUserState('dup1', { cards: r.cards });
    Math.random = () => 0.3;
    const plain = await server.enhance(c.u, false);
    expect(plain.success).toBe(false); expect(plain.mats.casual_female).toBe(3);     // nothing chosen, nothing spent
    r.cards.find((x: any) => x.u === c.u).l = 7;
    await $global.updateUserState('dup1', { cards: r.cards });
    const two = await server.enhance(c.u, false, 2);
    expect(two.success).toBe(true); expect(two.mats.casual_female).toBe(1);          // 35% now beats the roll
    r.cards.find((x: any) => x.u === c.u).l = 7;
    await $global.updateUserState('dup1', { cards: r.cards, mats: { casual_female: 20 } });
    Math.random = () => 0.999;
    const many = await server.enhance(c.u, false, 50);
    expect(many.success).toBe(false); expect(many.mats.casual_female).toBe(14);      // six at most, and spent on a failure too
    r.cards.find((x: any) => x.u === c.u).l = 0;
    await $global.updateUserState('dup1', { cards: r.cards, mats: { casual_female: 20 } });
    expect((await server.enhance(c.u, false, 6)).mats.casual_female).toBe(19);       // 95% needs only one to reach 100%
    expect((await server.enhance(c.u, false, -3)).mats.casual_female).toBe(19);      // nonsense amounts spend nothing
    expect((await server.enhance(c.u, false, 'x')).mats.casual_female).toBe(19);
  } finally { Math.random = orig; }
});

test('premium scout: costs gems, a ten holds a gold or better, the ceiling gives a legend, new cards are bound', async (server: any) => {
  server.connect({ account: 'prem1', roomId: '__no_room__' });
  await server.getRecord();
  expect((await server.premiumScout(1)).error).toBe('gems');
  await $global.updateUserState('prem1', { gems: 5000 });
  expect((await server.premiumScout(3)).error).toBe('bad');
  const eco = await server.getEconomy();
  expect(Math.round(eco.premium.odds.reduce((a: number, b: number) => a + b, 0) * 1e6)).toBe(1e6);
  const orig = Math.random;
  try {
    Math.random = () => 0;                                             // the commonest grade each time
    const ten = await server.premiumScout(10);
    expect(ten.got.length).toBe(10); expect(ten.gems).toBe(4100);
    expect(ten.got[9].m).toBe('mking');                                // nine bronze: the last is forced to gold
    expect(ten.got[9].b).toBe(1);                                      // premium cards cannot be sold
    expect(ten.got[0].dup).toBe(1);
    expect(ten.premPity).toBe(10);
    await $global.updateUserState('prem1', { premPity: 198 });
    const near = await server.premiumScout(1);
    expect(near.premPity).toBe(199); expect(near.got[0].m).toBe('casual_female');
    const legend = await server.premiumScout(1);
    expect(['jelly', 'sword1', 'oni'].includes(legend.got[0].m)).toBe(true);
    expect(legend.premPity).toBe(0);
    Math.random = () => 0.9999;                                        // a legend on the roll resets the count too
    const lucky = await server.premiumScout(1);
    expect(['jelly', 'sword1', 'oni'].includes(lucky.got[0].m)).toBe(true); expect(lucky.premPity).toBe(0);
  } finally { Math.random = orig; }
});

test('grades belong to the character: lineup power adds the bonus, the market band follows it', async (server: any) => {
  const R = 'fo-test0011';
  await $global.updateUserState('gr1', { cards: [{ u: 1, m: 'jelly', l: 3 }, { u: 2, m: 'mking', l: 0 }, { u: 3, m: 'ganz0', l: 0, b: 1 }, { u: 4, m: 'worker_female', l: 1, b: 1 }] });
  await server.simulateJoin(R, 'gr1'); server.connect({ account: 'gr1', roomId: R });
  const h = await server.hello('G', 'quick', '', { skaters: ['jelly', 'mking', 'ganz0'], goalie: 'worker_female' });
  expect(h.players[0].lineup.levels.join()).toBe('11,4,2,1');
  expect((await server.marketSell(2, 300)).error).toBe('price');       // a gold +0 starts at 750
  expect((await server.marketSell(2, 750)).ok).toBe(true);
  const listed = (await server.marketList()).find((x: any) => x.m === 'mking' && x.mine);
  await server.marketCancel(listed.id);
  expect((await server.getRecord()).cards.some((c: any) => c.m === 'mking')).toBe(true);
});

test('market: bound cards stay, price band, a sale moves the card and pays the seller minus the fee', async (server: any) => {
  await $global.updateUserState('sel1', { coins: 0, cards: [{ u: 1, m: 'jelly', l: 0, b: 1 }, { u: 2, m: 'casual_female', l: 0 }] });
  await $global.updateUserState('buy1', { coins: 500 });
  server.connect({ account: 'sel1', roomId: '__no_room__' });
  expect((await server.marketSell(1, 100)).error).toBe('bound');
  expect((await server.marketSell(2, 1)).error).toBe('price');
  expect((await server.marketSell(2, 9999)).error).toBe('price');
  expect((await server.marketSell(2, 200)).ok).toBe(true);
  const list = await server.marketList();
  expect(list.length).toBe(1); expect(list[0].mine).toBe(true); expect(list[0].seller).toBe(undefined);
  expect((await server.marketBuy(list[0].id)).error).toBe('mine');
  server.connect({ account: 'buy1', roomId: '__no_room__' });
  const got = await server.marketBuy(list[0].id);
  expect(got.ok).toBe(true); expect(got.coins).toBe(300);
  expect(got.cards.some((c: any) => c.m === 'casual_female' && !c.b)).toBe(true);
  expect((await server.marketBuy(list[0].id)).error).toBe('gone');   // sold once
  server.connect({ account: 'sel1', roomId: '__no_room__' });
  expect((await server.marketMine()).earned).toBe(180);
  expect((await server.marketMine()).earned).toBe(0);                // paid once
  expect((await server.getRecord()).coins).toBe(180);
});

test('market: cancelling returns the card', async (server: any) => {
  await $global.updateUserState('can1', { cards: [{ u: 1, m: 'casual_female', l: 2 }] });
  server.connect({ account: 'can1', roomId: '__no_room__' });
  expect((await server.marketSell(1, 200)).ok).toBe(true);
  expect((await server.getRecord()).cards.length).toBe(0);
  const [l] = (await server.marketMine()).listings;
  expect((await server.marketCancel(l.id)).ok).toBe(true);
  const c = (await server.getRecord()).cards;
  expect(c.length).toBe(1); expect(c[0].l).toBe(2);
});

test('shop: a purchase pays once, packs cost gems and honour limits', async (server: any) => {
  server.connect({ account: 'shop1', roomId: '__no_room__' });
  expect((await server.buyPack('coins')).error).toBe('gems');
  const buy = { account: 'shop1', purchaseId: 'p1', productId: 'gems_100', quantity: 2, metadata: {} };
  expect((await server.$onItemPurchased(buy)).success).toBe(true);
  await server.$onItemPurchased(buy);                                 // redelivered
  expect((await server.getRecord()).gems).toBe(200);
  const s1 = await server.buyPack('starter');
  expect(s1.ok).toBe(true); expect(s1.coins).toBe(1000); expect(s1.tickets).toBe(1); expect(s1.got.length).toBe(1); expect(s1.gems).toBe(80);
  await server.$onItemPurchased({ ...buy, purchaseId: 'p2' });
  expect((await server.buyPack('starter')).error).toBe('limit');
});

test('rewarded ads: a request id pays once and the daily cap holds', async (server: any) => {
  server.connect({ account: 'ad1', roomId: '__no_room__' });
  expect((await server.claimAd('nope', 'r1')).error).toBe('bad');
  expect((await server.claimAd('shop-coins', 'r1')).reward).toBe(30);
  expect((await server.claimAd('shop-coins', 'r1')).error).toBe('used');
  expect((await server.claimAd('shop-coins', 'r2')).error).toBe('wait');   // too soon after the last ad
  await $global.updateUserState('ad1', { adAt: 0 }); await server.claimAd('shop-coins', 'r2');
  await $global.updateUserState('ad1', { adAt: 0 }); await server.claimAd('shop-coins', 'r3');
  await $global.updateUserState('ad1', { adAt: 0 });
  expect((await server.claimAd('shop-coins', 'r4')).error).toBe('daily');
  expect((await server.getRecord()).coins).toBe(90);
});

test('chat: swearing is starred out, the pace is limited, only players in the room can talk', async (server: any) => {
  const ROOM = 'fo-test0099';
  await server.simulateJoin(ROOM, 'cha');
  server.connect({ account: 'cha', roomId: ROOM }); await server.hello('Cha', 'room', '');
  const r = await server.chat('nice shot <b>fuck</b>');
  expect(r.ok).toBe(true);
  expect(r.text).toBe('nice shot b****/b');
  expect((await server.chat('again')).reason).toBe('slow');
  expect((await server.chat('   ')).ok).toBe(false);
  server.connect({ account: 'zed', roomId: '__no_room__' });
  expect((await server.chat('hi')).ok).toBe(false);
});

test('ranking: a ranked result puts both players on this season\'s board, sorted by rank points; friend rooms do not; setNick renames', async (server: any) => {
  const Q = 'fo-rank0001';
  await server.simulateJoin(Q, 'rk1'); server.connect({ account: 'rk1', roomId: Q }); await server.hello('Winner', 'quick', '');
  await server.simulateJoin(Q, 'rk2'); server.connect({ account: 'rk2', roomId: Q }); await server.hello('Loser', 'quick', '');
  server.connect({ account: 'rk1', roomId: Q }); await server.report(0, 4, 1, false);
  server.connect({ account: 'rk2', roomId: Q }); expect((await server.report(0, 4, 1, false)).recorded).toBe(true);
  const R = 'fo-rank0002';
  await server.simulateJoin(R, 'rk3'); server.connect({ account: 'rk3', roomId: R }); await server.hello('Friend', 'room', '');
  await server.simulateJoin(R, 'rk4'); server.connect({ account: 'rk4', roomId: R }); await server.hello('Mate', 'room', '');
  server.connect({ account: 'rk3', roomId: R }); await server.report(0, 1, 0, false);
  server.connect({ account: 'rk4', roomId: R }); await server.report(0, 1, 0, false);
  server.connect({ account: 'rk1', roomId: Q });
  const b = await server.leaderboard();
  const names = b.top.map((e: any) => e.nick);
  expect(names.includes('Friend')).toBe(false);
  const wi = names.indexOf('Winner'), li = names.indexOf('Loser');
  expect(wi >= 0 && li > wi).toBe(true);
  expect(b.top[wi].me).toBe(true);
  expect(b.mine.rank).toBe(wi + 1);
  expect(b.top[wi].w).toBe(1); expect(b.top[wi].l).toBe(0); expect(b.top[li].l).toBe(1);
  // a friend-room win afterwards changes the profile record, not the ranked one
  const R2 = 'fo-rank0003';
  await server.simulateJoin(R2, 'rk1'); server.connect({ account: 'rk1', roomId: R2 }); await server.hello('Winner', 'room', '');
  await server.simulateJoin(R2, 'rk5'); server.connect({ account: 'rk5', roomId: R2 }); await server.hello('Pal', 'room', '');
  server.connect({ account: 'rk1', roomId: R2 }); await server.report(0, 2, 0, false);
  server.connect({ account: 'rk5', roomId: R2 }); await server.report(0, 2, 0, false);
  server.connect({ account: 'rk1', roomId: Q });
  expect((await server.getRecord()).w).toBe(2);
  expect((await server.leaderboard()).top[wi].w).toBe(1);
  expect(JSON.stringify(b).includes('rk2')).toBe(false);              // account ids stay on the server
  expect((await server.setNick('NewName')).nick).toBe('NewName');
  expect((await server.leaderboard()).top[wi].nick).toBe('NewName');
  expect((await server.setNick('fuck')).nick).toBe('Player');
});

test('the picked team and the name follow the account to every device', async (server: any) => {
  server.connect({ account: 'syncer', roomId: '__no_room__' });
  const free = { skaters: ['casual_female', 'ninja_female', 'worker_female'], goalie: 'soldier_female' };
  expect((await server.setLineup(free)).ok).toBe(true);
  expect((await server.setLineup({ skaters: ['casual_female', 'ninja_female', 'oni'], goalie: 'soldier_female' })).ok).toBe(false);   // not owned
  expect((await server.setLineup({ skaters: ['x'], goalie: 'y' })).ok).toBe(false);                                                     // malformed
  await server.setNick('IceKing');
  const r = await server.getRecord();
  expect(r.nick).toBe('IceKing');
  expect(r.lineup.skaters.join()).toBe(free.skaters.join());
  expect(r.lineup.goalie).toBe('soldier_female');
});

test('a device with no name set neither wipes the stored name nor plays as Player', async (server: any) => {
  const ROOM = 'fo-test0090';
  server.connect({ account: 'named', roomId: '__no_room__' }); await server.setNick('Named');
  await server.simulateJoin(ROOM, 'named');
  server.connect({ account: 'named', roomId: ROOM });
  const h = await server.hello('Player', 'quick', '');
  expect(h.players[0].nick).toBe('Named');
  await server.simulateJoin(ROOM, 'other');
  server.connect({ account: 'other', roomId: ROOM }); await server.hello('Other', 'quick', '');
  server.connect({ account: 'named', roomId: ROOM }); await server.report(0, 2, 0, false);
  server.connect({ account: 'other', roomId: ROOM }); await server.report(0, 2, 0, false);
  server.connect({ account: 'named', roomId: ROOM });
  expect((await server.getRecord()).nick).toBe('Named');
});

test('stages: first clear and new stars pay once, stars never drop, replays are capped, locked and too-short clears are refused', async (server: any) => {
  server.connect({ account: 'st1', roomId: '__no_room__' });
  const first = await server.clearStage('1-1', 2, 40);
  expect(first.ok).toBe(true);
  expect(first.stars['1-1']).toBe(2);
  const paid = first.reward.coins;
  expect(paid).toBeGreaterThan(60);
  expect((await server.getRecord()).coins).toBe(paid);
  const again = await server.clearStage('1-1', 1, 40);                    // fewer stars: stored stars stay, replay coins only
  expect(again.stars['1-1']).toBe(2);
  expect(again.reward.coins).toBe(15);
  const st = await server.getStages();
  expect(st.replaysLeft).toBe(9);
  const more = await server.clearStage('1-1', 3, 40);                     // one new star: 30 coins, no first clear again
  expect(more.reward.coins).toBe(30);
  expect(more.stars['1-1']).toBe(3);
  expect((await server.clearStage('1-3', 3, 40)).error).toBe('locked');
  expect((await server.clearStage('1-2', 3, 1)).error).toBe('short');
  expect((await server.clearStage('9-9', 1, 40)).error).toBe('stage');
  expect((await server.clearStage('1-2', 4, 40)).error).toBe('stage');
  expect((await server.clearStage('1-2', -1, 40)).error).toBe('stage');
  expect((await server.getStages()).stars['1-2']).toBe(undefined);
});

test('stages: a failed run (0 stars) records nothing; replays past the daily cap pay nothing but still record new stars', async (server: any) => {
  server.connect({ account: 'st2', roomId: '__no_room__' });
  const zero = await server.clearStage('1-1', 0, 40);
  expect(zero.ok).toBe(true);
  expect(zero.reward.coins).toBe(0);
  expect((await server.getStages()).stars['1-1']).toBe(undefined);
  await server.clearStage('1-1', 1, 40);
  for (let i = 0; i < 10; i++) await server.clearStage('1-1', 1, 40);
  const capped = await server.clearStage('1-1', 1, 40);
  expect(capped.reward.coins).toBe(0);
  const star = await server.clearStage('1-1', 2, 40);
  expect(star.reward.coins).toBe(30);
  expect(star.stars['1-1']).toBe(2);
});

test('stages: chests open at 10 / 20 / 30 chapter stars, once each; a boss first clear adds a scout', async (server: any) => {
  server.connect({ account: 'st3', roomId: '__no_room__' });
  for (let i = 1; i <= 3; i++) await server.clearStage(`1-${i}`, 3, 40);
  expect((await server.claimChest(1, 10)).error).toBe('stars');           // 9 stars
  await server.clearStage('1-4', 1, 40);
  const boss = await server.clearStage('1-5', 1, 200);
  expect(boss.reward.scouts).toBe(1);
  expect(boss.reward.cards.length).toBe(1);
  const chest = await server.claimChest(1, 10);
  expect(chest.ok).toBe(true);
  expect(chest.reward.tickets).toBe(2);
  expect((await server.claimChest(1, 10)).error).toBe('claimed');
  expect((await server.claimChest(1, 20)).error).toBe('stars');
  expect((await server.claimChest(1, 15)).error).toBe('chest');
  expect((await server.getStages()).chests).toEqual(['1:10']);
  expect((await server.clearStage('1-6', 3, 40)).ok).toBe(true);
  expect((await server.clearStage('1-5', 3, 20)).error).toBe('short');   // a boss is a full match
});
