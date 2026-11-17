// Names, descriptions and key commands of the skills for the screens; the rules are in sim/match.ts (useSkill) and sim/constants.ts.
import { t, type Key } from '../i18n.ts';
import type { SkillId } from '../sim/types.ts';
import { SKILL_COMMAND } from '../input.ts';
import { keyCap } from './keys.ts';

const NAME: Record<Exclude<SkillId, 'none'>, [Key, Key]> = {
  rush: ['skRush', 'skRushT'], dash: ['skDash', 'skDashT'], snipe: ['skSnipe', 'skSnipeT'],
  laser: ['skLaser', 'skLaserT'], charge: ['skCharge', 'skChargeT'], sweep: ['skSweep', 'skSweepT'],
};
export const skillName = (k: SkillId) => (k === 'none' ? '' : t(NAME[k][0]));
export const skillText = (k: SkillId) => (k === 'none' ? '' : t(NAME[k][1]));
const CAP: Record<string, string> = { same: '→', ArrowDown: '↓', ArrowRight: '→', ArrowLeft: '←', KeyD: 'D', KeyS: 'S', KeyE: 'E' };
/** the skill's command as key caps */
export const skillCaps = (k: SkillId) => (k === 'none' ? '' : SKILL_COMMAND[k].map(code => keyCap(CAP[code])).join(''));
