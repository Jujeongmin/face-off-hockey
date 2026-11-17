// Nickname filter: swearing in four languages however it is disguised, staff names, ordinary names left alone, and
// the server's copy of the filter kept identical (node --experimental-strip-types tests/profanity.test.ts)
// @ts-expect-error the project has no Node types; the test runs under node
import { readFileSync } from 'node:fs';
import { isBadNick, maskProfanity } from '../src/game/profanity.ts';

let failed = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, info); if (!ok) failed++; };

const bad = [
  '씨발', '시1발', '시.발', '시 발', 'ㅅㅂ', '병신놈', '개새끼', 'ㅂㅅ', '존나잘함', '니애미',
  'fuck', 'FUCK', 'fuuuck', 'f.u.c.k', 'f4ck', '$hit', 'b1tch', 'Asshole99', 'n1gger',
  '死ね', 'しね', 'まんこ', '傻逼', '操你妈', '幹你娘',
  'admin', 'ADMIN', '운영자', 'gm',
];
const good = ['Mina', '김하키', 'Player', 'IceKing', '골리장인', 'Shiba', 'Niger', 'Glass', 'Snow_White', 'ゆき', '冰球王', 'Ogma', 'gmania', '시바견', '보라색'];
const missed = bad.filter(n => !isBadNick(n)), wrong = good.filter(n => isBadNick(n));
check('every bad name is refused', missed.length === 0, missed);
check('ordinary names pass', wrong.length === 0, wrong);

// chat: the words are starred out, the rest of the line stays
const masks: [string, string][] = [
  ['nice shot fuck', 'nice shot ****'], ['f.u.c.k off', '******* off'], ['아 씨발 진짜', '아 ** 진짜'], ['시1발', '***'],
  ['GG 잘했어요', 'GG 잘했어요'], ['you are a b1tch lol', 'you are a ***** lol'], ['傻逼', '**'], ['glass of water', 'glass of water'],
];
const wrongMask = masks.filter(([a, b]) => maskProfanity(a) !== b).map(([a, b]) => [a, maskProfanity(a), b]);
check('chat lines are starred out word by word', wrongMask.length === 0, wrongMask);

// the server (one file) carries a copy of the filter
const block = (s: string) => s.slice(s.indexOf('// PROFANITY-START'), s.indexOf('// PROFANITY-END')).replace(/export function/g, 'function');
const client = readFileSync(new URL('../src/game/profanity.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const server = readFileSync(new URL('../server/src/server.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
check('server copy of the filter matches src/game/profanity.ts', block(client).length > 100 && block(client) === block(server));

if (failed) throw new Error(`${failed} profanity check(s) failed`);
console.log('profanity checks passed');
