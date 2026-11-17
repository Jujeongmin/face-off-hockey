// AI-vs-AI smoke + balance check for the shared simulation (node --experimental-strip-types)
import { Match } from '../src/sim/match.ts';
import { STEP } from '../src/sim/constants.ts';

let goals = 0, shots = 0, shootouts = 0, draws = 0, takeaways = 0;
const N = 40;
for (let g = 0; g < N; g++) {
  const m = new Match({ seed: 1000 + g, human: [false, false] });
  let steps = 0;
  while (m.phase !== 'end' && steps < 120 * 600) { m.step(STEP, [null, null]); m.events.length = 0; steps++; }
  if (m.phase !== 'end') throw new Error(`game ${g} did not end`);
  goals += m.score[0] + m.score[1]; shots += m.stats.shots[0] + m.stats.shots[1]; takeaways += m.stats.takeaways;
  if (m.shootout) shootouts++;
  if (m.winner === -1) draws++;
}
console.log(JSON.stringify({ games: N, goalsPerGame: +(goals / N).toFixed(2), shootPct: +(goals / shots * 100).toFixed(1), shootouts, draws, takeawaysPerGame: +(takeaways / N).toFixed(1) }));
if (draws > 4) throw new Error('a game ended without a winner');
