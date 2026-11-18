// 정지 공 방치 측정: 코트 여러 지점에 공을 세워 두고(사람 좌석0 무입력, 좌석1 CPU) 누군가 잡을 때까지 프레임.
// node analysis/scripts/feel_deadball.mjs [엔진 index.js 경로] [cpuLevel]
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const eng = process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : '../../server/engine/index.js';
const level = Number(process.argv[3] ?? 2);
const { Match, loadData, ONE, BM } = await import(eng);
const data = loadData();
const px = (v) => Math.round(v * ONE);
const pts = [[90, 236], [90, 222], [70, 228], [60, 240], [120, 250], [200, 226], [250, 236], [40, 128], [30, 60], [256, 128], [256, 20], [300, 236], [420, 236], [470, 128], [350, 22], [150, 128]];
let dead = 0;
for (const [x, y] of pts) {
  const m = new Match({ seed: 7, teams: [0, 1], data, humans: [true, false], cpuLevels: [null, level] });
  let n = 0; while ((m.phase !== 'play' || m.tip.on) && n < 4000) { m.tick([0, 0]); n++; }
  for (let i = 0; i < 30; i++) m.tick([0, 0]);
  for (const q of m.players) q.hasBall = false;
  Object.assign(m.ball, { x: px(x), y: px(y), z: 0, vx: 0, vy: 0, vz: 0, mode: BM.LOOSE, holder: -1, still: 0, kind: 0, sp: null });
  let f = 0, who = null, stall = '';
  for (; f < 900; f++) {
    m.tick([0, 0]);
    for (const e of m.drainEvents()) if (e.k === 'stall_nudge' || e.k === 'stall_give') stall = e.k;
    if (m.ball.mode === BM.HELD) { const p = m.players[m.ball.holder]; who = `좌석${p.seat} ${p.role === 'out' ? '외야' : '내야'} slot${p.slot}`; break; }
  }
  if (!who || stall) dead++;
  console.log(`공 (${x},${y})`.padEnd(14), who ? `${f}f ${who}` : '900f 동안 아무도 못 주움', stall ? `[안전망 ${stall}]` : '', `사람 조작=slot${m.players[m.sides[0].ctrl].slot}`);
}
console.log(`안전망 의존 또는 방치: ${dead}/${pts.length}`);
