// Recorded sound only, no synthesis. Game sounds: ElevenLabs sound effects (free plan, credited in the game),
// short mono clips in public/audio/sfx made by tools/sfx_import.sh. Crowd: Gregor Quendel - Free Crowd Cheering
// Sounds (a streamed ambience loop and two short decoded stingers). Interface: Kenney Interface Sounds (CC0).
// Music: ElevenLabs music library (see setMusic).
type Kind = 'shot' | 'pass' | 'post' | 'save' | 'board' | 'horn' | 'whistle' | 'tick' | 'skill' | 'whiff';

let ac: AudioContext | null = null;
let master: GainNode | null = null;
export let muted = false;

export function unlockAudio() {
  if (ac) {
    if (ac.state === 'suspended') void ac.resume();
    if (crowdEl?.paused) void crowdEl.play().catch(() => {});   // iOS: element play() only inside a gesture
    primeMusic();
    return;
  }
  const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ac = new C();
  master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
  initCrowd();
  initMusic();
}

// ------------------------------------------------------------------ crowd
// The ambience is 34 s: streamed through an <audio> element (a decoded buffer of a long track sits in memory as
// PCM), one MediaElementSource for the element's lifetime. The goal / save stingers are short buffers.
const AUDIO = import.meta.env.BASE_URL + 'audio/';
let crowdGain: GainNode | null = null;
let crowdEl: HTMLAudioElement | null = null;
const stingers: Partial<Record<'goal' | 'save', AudioBuffer>> = {};
let crowdLevel = 0.12;
function initCrowd() {
  if (!ac || !master || crowdEl) return;
  crowdEl = new Audio();
  crowdEl.crossOrigin = 'anonymous';                 // before src
  crowdEl.loop = true; crowdEl.preload = 'auto'; crowdEl.src = AUDIO + 'crowd_ambience.mp3';
  crowdGain = ac.createGain(); crowdGain.gain.value = crowdLevel;
  ac.createMediaElementSource(crowdEl).connect(crowdGain).connect(master);
  void crowdEl.play().catch(() => { /* retried on the next gesture */ });
  loadUiSounds();
  loadSfx();
  for (const k of ['goal', 'save'] as const) {
    void fetch(AUDIO + `crowd_${k}.mp3`).then(r => r.arrayBuffer()).then(b => ac!.decodeAudioData(b)).then(buf => { stingers[k] = buf; }).catch(() => {});
  }
}
/** how loud the crowd murmurs: quiet in the lobby, louder in a match */
// Interface sounds (Kenney Interface Sounds, CC0): short decoded buffers.
const uiBuf: Partial<Record<UiSound, AudioBuffer>> = {};
export type UiSound = 'click' | 'back' | 'ok' | 'error';
function loadUiSounds() {
  for (const k of ['click', 'back', 'ok', 'error'] as const) {
    void fetch(import.meta.env.BASE_URL + `kit/ui_${k}.mp3`).then(r => r.arrayBuffer()).then(b => ac!.decodeAudioData(b)).then(buf => { uiBuf[k] = buf; }).catch(() => {});
  }
}
export function uiSound(kind: UiSound) {
  const buf = uiBuf[kind];
  if (!ac || !master || !buf) return;
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = buf; g.gain.value = 0.5;
  s.connect(g).connect(master); s.start();
}
export function setCrowd(level: number) {
  crowdLevel = level;
  if (ac && crowdGain) crowdGain.gain.setTargetAtTime(level, ac.currentTime, 0.6);
  if (crowdEl && crowdEl.paused) void crowdEl.play().catch(() => {});
}
/** a recorded crowd reaction over the ambience */
export function cheer(kind: 'goal' | 'save', volume = 1) {
  const buf = stingers[kind];
  if (!ac || !master || !buf) return;
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = buf; g.gain.value = (kind === 'goal' ? 0.85 : 0.45) * volume;
  s.connect(g).connect(master); s.start();
}
// ------------------------------------------------------------------ music
// Two 2-minute loops (ElevenLabs music library, "hype" samples: royalty free, no copyright claimed), each streamed
// through its own <audio> element and one MediaElementSource for the element's lifetime (a decoded 2-minute stereo
// track would hold ~40 MB of PCM). Switching mood crossfades; the quiet one is paused.
export type Mood = 'lobby' | 'match';
const MUSIC: Record<Mood, { file: string; level: number }> = { lobby: { file: 'bgm_lobby_v2.mp3', level: 0.22 }, match: { file: 'bgm_match_v2.mp3', level: 0.14 } };
const music: Partial<Record<Mood, { el: HTMLAudioElement; gain: GainNode; primed: boolean }>> = {};
let mood: Mood | null = 'lobby';
function initMusic() {
  if (!ac || !master) return;
  for (const k of Object.keys(MUSIC) as Mood[]) {
    const el = new Audio();
    el.crossOrigin = 'anonymous';                    // before src
    el.loop = true; el.preload = 'none'; el.src = AUDIO + MUSIC[k].file;
    const gain = ac.createGain(); gain.gain.value = 0;
    ac.createMediaElementSource(el).connect(gain).connect(master);
    music[k] = { el, gain, primed: false };
  }
  primeMusic();
  applyMood(0.01);
}
/** iOS refuses element play() outside a gesture: inside one, start every track not yet played silently, then pause it */
function primeMusic() {
  for (const k of Object.keys(music) as Mood[]) {
    const m = music[k]!;
    if (m.primed || k === mood) continue;
    void m.el.play().then(() => { m.primed = true; if (k !== mood) m.el.pause(); }).catch(() => {});
  }
  if (mood && music[mood]?.el.paused) void music[mood]!.el.play().then(() => { music[mood!]!.primed = true; }).catch(() => {});
}
function applyMood(fade: number) {
  if (!ac) return;
  for (const k of Object.keys(music) as Mood[]) {
    const m = music[k]!, on = k === mood;
    m.gain.gain.cancelScheduledValues(ac.currentTime);
    m.gain.gain.setTargetAtTime(on ? MUSIC[k].level : 0, ac.currentTime, fade);
    if (on) { if (m.el.paused) void m.el.play().then(() => { m.primed = true; }).catch(() => {}); }
    else if (!m.el.paused) setTimeout(() => { if (mood !== k) m.el.pause(); }, fade * 5000);
  }
}
/** background music for the menus or a match; null stops it */
export function setMusic(next: Mood | null) {
  if (next === mood) return;
  mood = next;
  applyMood(0.5);
}
export function setMuted(m: boolean) { muted = m; if (master) master.gain.value = m ? 0 : 0.9; }

// ------------------------------------------------------------------ game sounds: short decoded clips (a few hundred KB of PCM in all)
export type Impact = 'bump' | 'check' | 'big' | 'boards' | 'punch' | 'block' | 'ko';
type Clip = Exclude<Kind, 'tick'> | Impact;
const CLIPS: Clip[] = ['shot', 'pass', 'post', 'save', 'board', 'horn', 'whistle', 'skill', 'whiff', 'bump', 'check', 'big', 'boards', 'punch', 'block', 'ko'];
/** base loudness per clip (the files are loudness-normalised, this is the mix) */
const LEVEL: Record<Clip, number> = {
  shot: 0.8, pass: 0.45, post: 0.7, save: 0.6, board: 0.5, horn: 0.55, whistle: 0.5, skill: 0.55, whiff: 0.45,
  bump: 0.45, check: 0.65, big: 0.85, boards: 0.85, punch: 0.8, block: 0.55, ko: 0.95,
};
const clipBuf: Partial<Record<Clip, AudioBuffer>> = {};
function loadSfx() {
  for (const k of CLIPS) {
    void fetch(AUDIO + `sfx/${k}.mp3`).then(r => { if (!r.ok) throw r.status; return r.arrayBuffer(); })
      .then(b => ac!.decodeAudioData(b)).then(buf => { clipBuf[k] = buf; }).catch(() => {});
  }
}
/** one clip with a little pitch spread so repeats do not sound identical; silent until its file has loaded */
function play(k: Clip, volume: number, spread = 0.08) {
  const buf = clipBuf[k];
  if (!ac || !master || !buf || volume <= 0) return;
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = buf; s.playbackRate.value = 1 + (Math.random() * 2 - 1) * spread;
  g.gain.value = LEVEL[k] * volume;
  s.connect(g).connect(master); s.start();
}

export function sfx(kind: Kind, volume = 1) {
  if (kind === 'tick') { uiSound('click'); return; }
  play(kind, volume, kind === 'horn' || kind === 'whistle' ? 0 : 0.08);
}
export function impact(kind: Impact, volume = 1) { play(kind, volume, kind === 'ko' ? 0.03 : 0.1); }
