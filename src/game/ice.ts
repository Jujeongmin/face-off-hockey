// Setting the ice up by hand (tutorial drills, stage scenarios): put a skater somewhere, hand someone the puck, drop a
// loose puck. The sim itself is untouched; these only write its state between steps.
import type { Match } from '../sim/match.ts';

export function placeSkater(m: Match, id: number, x: number, z: number, face = 0) {
  Object.assign(m.skaters[id], { x, z, vx: 0, vz: 0, face, stun: 0, cool: 0, lunge: 0, checkCd: 0 });
}
export function givePuck(m: Match, id: number) {
  const p = m.puck, s = m.skaters[id];
  Object.assign(p, { owner: id, last: id, passTo: -1, shot: false, dead: false, vx: 0, vz: 0, y: 0, blend: 0 });
  p.x = s.x + Math.cos(s.face) * 0.85; p.z = s.z + Math.sin(s.face) * 0.85;
}
export function loosePuck(m: Match, x: number, z: number) {
  Object.assign(m.puck, { owner: -1, last: -1, passTo: -1, x, z, vx: 0, vz: 0, y: 0, dead: false, shot: false });
}
