// 측정: 컴퓨터 대 컴퓨터 N 경기(레벨 2)의 종료 사유·평균 프레임·이벤트 수. 사용: node tools/_cpu_vs_cpu.mjs [경기 수=16]
import { Match, loadData } from '../server/engine/index.js';
const data = loadData(), N = +process.argv[2] || 16, ev = {}, why = {}; let fr = 0, unfinished = 0;
for (let i = 0; i < N; i++) {
  const m = new Match({ seed: 5000 + i, teams: [i % 15, (i * 7 + 3) % 15], data, humans: [false, false], cpuLevels: [2, 2] });
  let n = 0;
  while (m.phase !== 'end' && n++ < 60000) { m.tick([0, 0]); for (const e of m.drainEvents()) ev[e.k] = (ev[e.k] || 0) + 1; }
  if (m.phase !== 'end') unfinished++; else why[m.result.reason] = (why[m.result.reason] || 0) + 1;
  fr += m.f;
}
const pick = (k) => k.map((x) => x + ' ' + (ev[x] || 0)).join(', ');
console.log(`경기 ${N}: 미종료 ${unfinished}, 종료 사유 ${JSON.stringify(why)}, 평균 ${Math.round(fr / N)}f`);
console.log(pick(['throw', 'pass', 'special', 'hit', 'catch', 'catch_start', 'out', 'foul', 'jump', 'fm_start', 'stall_nudge', 'stall_give']));
