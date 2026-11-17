// FC Online style keyboard: arrows move, E sprint, S pass / switch, W through pass, A lifted pass, D shoot / check; skills are key commands.
// Produces InputFrames with press counters (see sim/types.ts) so they survive the network unchanged.
import type { InputFrame, PassKind, SkillId } from './sim/types.ts';
import { emptyInput } from './sim/types.ts';

/** FC-style skill commands: key presses in order, each within COMMAND_GAP_MS of the last. 'same' = any arrow, the same one each time */
export const SKILL_COMMAND: Record<Exclude<SkillId, 'none'>, string[]> = {
  rush: ['KeyE', 'KeyE'],
  dash: ['same', 'same'],
  snipe: ['ArrowDown', 'ArrowRight', 'KeyD'],
  laser: ['ArrowDown', 'ArrowRight', 'KeyS'],
  charge: ['same', 'same', 'KeyD'],
  sweep: ['ArrowLeft', 'ArrowRight', 'KeyS'],
};
const COMMAND_GAP_MS = 320;

export class KeyboardInput {
  private keys = new Set<string>();
  private frame: InputFrame = emptyInput();
  enabled = true;
  /** the skill of the skater being controlled: only its command counts */
  skill: SkillId = 'none';
  private recent: { code: string; at: number }[] = [];
  /** a key that finished a command does not also pass or shoot, until it is let go */
  private swallowed = new Set<string>();

  constructor() {
    addEventListener('keydown', e => {
      if (!this.enabled) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.commandDone(e.code) && (e.code === 'KeyD' || e.code === 'KeyS')) { this.swallowed.add(e.code); return; }
      const pass = (k: PassKind) => { this.frame.passSeq++; this.frame.passKind = k; };
      if (e.code === 'KeyS') pass('short');
      if (e.code === 'KeyW') pass('through');
      if (e.code === 'KeyA') pass('lift');
      if (e.code === 'KeyD') this.frame.shootSeq++;
      if (e.code === 'KeyF') this.frame.fightSeq++;
    });
    addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (this.swallowed.delete(e.code)) return;
      if (e.code === 'KeyD') this.frame.releaseSeq++;
    });
    addEventListener('blur', () => this.releaseAll());
  }
  /** lets go of every held key (window lost focus, or the chat box took the keyboard) */
  releaseAll() {
    if (this.keys.has('KeyD') && !this.swallowed.has('KeyD')) this.frame.releaseSeq++;
    this.keys.clear(); this.swallowed.clear();
  }

  /** remembers a key press; true when it completes the controlled skater's command (which then counts as one skill press) */
  private commandDone(code: string) {
    const now = performance.now(), last = this.recent[this.recent.length - 1];
    if (last && now - last.at > COMMAND_GAP_MS) this.recent.length = 0;
    this.recent.push({ code, at: now });
    if (this.recent.length > 4) this.recent.shift();
    if (this.skill === 'none') return false;
    const want = SKILL_COMMAND[this.skill], tail = this.recent.slice(-want.length);
    if (tail.length < want.length) return false;
    const arrow = tail[0].code;
    const ok = want.every((w, i) => (w === 'same' ? tail[i].code.startsWith('Arrow') && tail[i].code === arrow : tail[i].code === w));
    if (ok) { this.recent.length = 0; this.frame.skillSeq++; }
    return ok;
  }

  /** current frame; toWorld turns (screen right, screen up) into a world direction */
  read(toWorld: (ix: number, iy: number) => { x: number; z: number }): InputFrame {
    let ix = 0, iy = 0;
    if (this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('ArrowRight')) ix += 1;
    if (this.keys.has('ArrowUp')) iy -= 1;
    if (this.keys.has('ArrowDown')) iy += 1;
    const l = Math.hypot(ix, iy); if (l > 1) { ix /= l; iy /= l; }
    const w = l > 0 ? toWorld(ix, iy) : { x: 0, z: 0 };
    const f = this.frame;
    f.mx = w.x; f.mz = w.z;
    f.sprint = this.keys.has('KeyE') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    f.shootHeld = this.keys.has('KeyD') && !this.swallowed.has('KeyD');
    f.passHeld = (this.keys.has('KeyS') && !this.swallowed.has('KeyS')) || this.keys.has('KeyW') || this.keys.has('KeyA');
    return { ...f };
  }
}
