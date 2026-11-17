// Nickname / text filter for swearing, slurs and sexual words in Korean, English, Japanese and Chinese, plus names
// that pose as staff. The block between the markers is copied verbatim into server/src/server.ts (the server is a
// single file); tests/profanity.test.ts fails when the two copies differ.

// PROFANITY-START
const BAD_WORDS = [
  // Korean (also caught with letters, digits or symbols put between the syllables)
  '씨발', '시발', '씨바', '씨빨', '시빨', '씌발', '쓰발', '쓰벌', '씨벌', '시벌', '썅', '씹', '좆', '좃같', '존나', '졸라',
  '개새', '개색', '개섀', '새끼', '쌔끼', '병신', '븅신', '빙신', '등신', '지랄', '염병', '미친놈', '미친년', '개년', '개놈',
  '니애미', '니엄마', '느금', '엠창', '애미뒤', '애비뒤', '호로새', '섹스', '보지', '자지', '후장', '걸레년', '창녀',
  '한남충', '김치녀', '틀딱', '꺼져', '닥쳐',
  'ㅅㅂ', 'ㅆㅂ', 'ㅂㅅ', 'ㅄ', 'ㅈㄹ', 'ㅈ같', 'ㅗㅗ', 'ㅅㄲ', 'ㄲㅈ',
  // English (letters may repeat, digits / symbols stand in for letters: f4ck, $hit, fuuuck)
  'fuck', 'fck', 'fack', 'phuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'asshole', 'bastard', 'nigger', 'nigga', 'faggot',
  'retard', 'whore', 'slut', 'cock', 'penis', 'vagina', 'porn', 'nazi', 'hitler', 'motherfucker', 'wanker',
  // Japanese
  '死ね', 'しね', '氏ね', '殺す', 'ころす', 'きちがい', 'キチガイ', 'ちんこ', 'チンコ', 'まんこ', 'マンコ', 'ちんぽ', 'くそ野郎',
  'ファック', 'セックス', 'レイプ',
  // Chinese (simplified and traditional)
  '操你', '肏', '傻逼', '傻屄', '傻b', '妈的', '媽的', '他妈', '他媽', '你妈', '你媽', '婊子', '屄', '鸡巴', '雞巴', '草泥马',
  '草泥馬', '去死', '幹你', '干你娘', '王八蛋', '贱人', '賤人',
];
/** names nobody may take as a whole (staff impersonation) */
const RESERVED = ['admin', 'administrator', 'moderator', 'gm', 'verse8', 'faceoff', '운영자', '관리자', '운영진', '개발자', '公式', '運営', '管理员', '管理員'];
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g' };
const HANGUL = /[^가-힣ㄱ-ㆎ]/g;
/** letters only, lower case, look-alike digits and symbols turned into the letters they stand for */
const latinize = (s: string) => [...s.normalize('NFKC').toLowerCase()].map(c => LEET[c] ?? c).join('').replace(/[^\p{L}\p{N}]/gu, '');
/** each letter of a word may repeat (fuuuck), so a word becomes f+u+c+k+ */
const PATTERNS = BAD_WORDS.map(w => new RegExp([...latinize(w)].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '+').join(''), 'u'));
const KOREAN_WORDS = BAD_WORDS.filter(w => /[가-힣ㄱ-ㆎ]/.test(w));

/** true when the text holds a word from the list, however it is spaced, spelled with digits or stretched */
export function isProfane(text: string): boolean {
  const flat = latinize(text);
  if (PATTERNS.some(p => p.test(flat))) return true;
  const korean = text.normalize('NFC').replace(HANGUL, '');               // 시1발, 시.발, 시 발
  return KOREAN_WORDS.some(w => korean.includes(w));
}
const KOREAN_RE = KOREAN_WORDS.map(w => new RegExp(w, 'u'));
/** the text with every listed word starred out, whatever was put between its letters (f.u.c.k → *******) */
export function maskProfanity(text: string): string {
  const raw = [...text], hit = raw.map(() => false);
  const mark = (keep: (c: string) => string, words: RegExp[]) => {
    const flat: string[] = [], at: number[] = [];
    raw.forEach((c, i) => { for (const k of keep(c)) { flat.push(k); at.push(i); } });
    const s = flat.join('');
    for (const p of words) {
      const g = new RegExp(p.source, 'gu');
      for (let m = g.exec(s); m; m = g.exec(s)) {
        for (let i = at[m.index]; i <= at[m.index + m[0].length - 1]; i++) hit[i] = true;
        if (!m[0].length) g.lastIndex++;
      }
    }
  };
  mark(latinize, PATTERNS);
  mark(c => c.normalize('NFC').replace(HANGUL, ''), KOREAN_RE);
  return raw.map((c, i) => (hit[i] && /\S/u.test(c) ? '*' : c)).join('');
}
/** a nickname the game refuses: swearing anywhere in it, or a staff name on its own */
export function isBadNick(name: string): boolean {
  return isProfane(name) || RESERVED.includes(latinize(name));
}
// PROFANITY-END
