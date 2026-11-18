// 개발용: 공 LOOSE 거동 통계. 사용: node tools/ball_sim.mjs '<ballPhys 덮어쓰기 JSON>' [seeds=30] [maxFrames=18000] [stageFrom] [stageTo]
import { Match, loadData } from '../server/engine/index.js';
const [ov = '{}', seeds = 30, maxF = 18000, s0 = 0, s1 = 13] = process.argv.slice(2);
const data = loadData();
data.rules = { ...data.rules, ballPhys: { ...data.rules.ballPhys, ...JSON.parse(ov) } };
const med = (a) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log('stage sh | LOOSE중앙 최대 평균 | 바운스중앙 최대 | 정지까지(f)중앙 최대 | 1차바운스높이(px)평균 | 경기평균초 | 아웃/경기 | n런');
for (let st = +s0; st <= +s1; st++) {
  const dur = [], bn = [], setl = [], pk = [], secs = [], outs = [];
  for (let sd = 1; sd <= +seeds; sd++) {
    const m = new Match({ seed: 7000 + sd, teams: [(sd * 3) % 25, (sd * 7 + 1) % 25], data, humans: [false, false], stage: st });
    let run = null, n = 0, prevMode = -1, out0 = 0;
    while (!(m.phase === 'end' && m.f > m.endF + 5) && n++ < +maxF) {
      m.tick([0, 0]);
      const b = m.ball;
      let nb = 0; for (const e of m.drainEvents()) if (e.k === 'bounce') nb++;
      if (b.mode === 3) {
        if (!run) run = { f: 0, bn: 0, settle: -1, pk: 0, afterB1: false, pkDone: false };
        run.f++;
        if (nb) { run.bn += nb; if (run.bn === 1) run.afterB1 = true; else if (run.bn === 2 && !run.pkDone) { run.pkDone = true; } }
        if (run.afterB1 && !run.pkDone) run.pk = Math.max(run.pk, b.z / 65536);
        if (run.settle < 0 && b.z === 0 && b.vz === 0) run.settle = run.f;
      } else if (run) { fin(); }
    }
    function fin() { if (run.f > 3) { dur.push(run.f); bn.push(run.bn); if (run.settle >= 0) setl.push(run.settle); if (run.pkDone || run.pk > 0) pk.push(run.pk); } run = null; }
    if (run) fin();
    secs.push((m.clock || m.f) / 60);
    outs.push(m.players.filter((p) => p.out || p.slot === undefined).length);
  }
  const sh = data.stages[st].bounceShift;
  console.log(`${st} sh${sh} | ${med(dur)} ${Math.max(...dur, 0)} ${mean(dur).toFixed(0)} | ${med(bn)} ${Math.max(...bn, 0)} | ${med(setl)} ${Math.max(...setl, 0)} | ${mean(pk).toFixed(1)} | ${mean(secs).toFixed(0)} | - | ${dur.length}`);
}
