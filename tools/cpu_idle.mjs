// CPU 선수 정지율 측정: AI 대 AI 헤드리스, 선수별 속도!=0 프레임 비율(공 상태·역할별)과 정지 구간 길이.
// 사용: node tools/cpu_idle.mjs [프레임=3000] [레벨=2] [시드수=3]
import { Match, loadData } from '../server/engine/index.js';
import { BM, ST } from '../server/engine/consts.js';
const data = loadData();
export function idle({ frames = 3000, level = 2, seeds = 3 } = {}) {
  const mv = {}; const runs = []; const spd = { in: [], out: [] };
  for (let s = 0; s < seeds; s++) {
    const m = new Match({ seed: 500 + s, teams: [(s * 5) % 25, (s * 7 + 2) % 25], data, humans: [false, false], cpuLevels: level ? [level, level] : [null, null] });
    let g = 0; while ((m.phase !== 'play' || m.tip.on) && g++ < 3000) m.tick([0, 0]);
    const cur = new Map();
    for (let f = 0; f < frames && m.phase === 'play'; f++) {
      m.tick([0, 0]); m.drainEvents();
      const bm = m.ball.mode, state = bm === BM.FLY || bm === BM.PASS ? 'fly' : bm === BM.HELD ? 'held' : 'loose';
      for (const p of m.players) {
        if (!m.usable(p) || p.st === ST.HIT || p.st === ST.DOWN) continue;
        const mvg = (p.vx || p.vy) ? 1 : 0;
        if (mvg) spd[p.role].push(Math.hypot(p.vx, p.vy) / 65536);
        for (const k of ['all/' + p.role, state + '/' + p.role]) { (mv[k] ??= [0, 0]); mv[k][0] += mvg; mv[k][1]++; }
        let c = cur.get(p.pid) ?? [mvg, 0];
        if (c[0] === mvg) c[1]++; else { if (c[0] === 0) runs.push(c[1]); c = [mvg, 1]; }
        cur.set(p.pid, c);
      }
    }
  }
  runs.sort((a, b) => a - b);
  return { mv, spd, med: runs[runs.length >> 1] ?? 0, max: runs[runs.length - 1] ?? 0 };
}
if (process.argv[1]?.endsWith('cpu_idle.mjs')) {
  const [frames = 3000, level = 2, seeds = 3] = process.argv.slice(2).map(Number);
  const r = idle({ frames, level, seeds });
  const r2 = (k) => r.spd[k].reduce((a, b) => a + b, 0) / Math.max(1, r.spd[k].length);
  for (const k of Object.keys(r.mv).sort()) console.log(k, `이동 ${(100 * r.mv[k][0] / r.mv[k][1]).toFixed(0)}% (n=${r.mv[k][1]})`);
  for (const r of ['in', 'out']) console.log(`이동 중 평균 속도 ${r} ${(r2(r)).toFixed(2)} px/f`);
  console.log(`정지 구간 중앙값 ${r.med}f 최대 ${r.max}f`);
}
