// 소유 획득 집계(우리 엔진, CPU 대 CPU 전체 경기). 역할(내야/외야)·경로(느슨한 공 줍기/패스 수신/캐치/안전망)별 횟수.
// node analysis/scripts/feel_possession.mjs [seeds=8] [level=2]
import { Match, loadData, ONE, BM } from '../../server/engine/index.js';
const data = loadData();
const seeds = Number(process.argv[2] ?? 8), level = Number(process.argv[3] ?? 2);
const tot = {}; const add = (k) => { tot[k] = (tot[k] ?? 0) + 1; };
let frames = 0, looseOut = 0, looseOutFrames = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const m = new Match({ seed, teams: [seed % 15, (seed * 7 + 3) % 15], data, humans: [false, false], cpuLevels: [level, level] });
  let prevMode = m.ball.mode, wasPass = false, n = 0, inZone = false;
  while (!m.result && n < 30000) {
    const modeBefore = m.ball.mode;
    m.tick([0, 0]); n++;
    const z = m.ball.mode === BM.LOOSE && m.ball.z === 0 && m.ball.vx === 0 && m.ball.vy === 0 && (m.ballZone(0) > 0 || m.ballZone(1) > 0);
    if (z && !inZone) looseOut++;
    if (z) looseOutFrames++;
    inZone = z;
    for (const e of m.drainEvents()) {
      if (e.k === 'receive') {
        const p = m.players[e.p];
        add(`${p.role === 'out' ? '외야' : '내야'} ${modeBefore === BM.PASS ? '패스 수신' : '느슨한 공 줍기'}`);
      } else if (e.k === 'catch') add(`${m.players[e.p].role === 'out' ? '외야' : '내야'} 캐치`);
      else if (e.k === 'stall_give') add('안전망 stall_give(위 줍기에 포함)');
      else if (e.k === 'stall_nudge') add('안전망 stall_nudge');
      else if (e.k === 'throw') add(`${m.players[e.p].role === 'out' ? '외야' : '내야'} 투구`);
    }
    prevMode = m.ball.mode; void prevMode; void wasPass;
  }
  frames += n;
}
console.log(`seeds ${seeds} level ${level} frames ${frames} (${(frames / 3600).toFixed(1)}분)`);
console.log(`외야 구역에 공이 정지한 횟수 ${looseOut}, 정지해 있던 총 프레임 ${looseOutFrames} (평균 ${(looseOutFrames / Math.max(1, looseOut)).toFixed(0)}f)`);
for (const k of Object.keys(tot).sort()) console.log(k.padEnd(36), tot[k]);
void ONE;
