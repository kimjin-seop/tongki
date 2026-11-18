// 개발용: AI 대 AI 한 판 시뮬레이션 (node tools/sim.mjs [seed] [teamA] [teamB])
import { Match, loadData } from '../server/engine/index.js';
const [seed = 1, ta = 0, tb = 1] = process.argv.slice(2).map(Number);
const m = new Match({ seed, teams: [ta, tb], data: loadData(), humans: [false, false] });
const t0 = Date.now();
const counts = {};
let n = 0;
while (m.phase !== 'end' || m.f < m.endF + 90) {
  m.tick([0, 0]); n++;
  for (const e of m.drainEvents()) counts[e.k] = (counts[e.k] || 0) + 1;
  if (n > 70000) break;
}
console.log({ result: m.result, frames: m.f, rem: m.sides.map((s) => s.remaining), counts, ms: Date.now() - t0 });
