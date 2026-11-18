// 정지 공 줍기 시작/완료 프레임 측정(시나리오별): 공을 지정 위치에 정지시키고 누가 몇 프레임 만에 줍는지.
// 사용: node tools/cpu_pickup.mjs [레벨=2] [시드수=6]   모드: cvc(양쪽 CPU) / human(사람 좌석0 + 아군 CPU)
// 출력: 시나리오별 줍기 완료 프레임 중앙값/최대/실패 수, 줍은 선수 역할(in/out). 360f 안에 못 주우면 실패.
import { Match, loadData } from '../server/engine/index.js';
import { ST } from '../server/engine/consts.js';
const data = loadData();
export const SCEN = [
  ['내야 좌하단 구석(좌석0)', 100, 200], ['내야 좌상단 구석(좌석0)', 100, 56], ['내야 우하단 구석(좌석1)', 412, 200],
  ['외야 하단 띠(좌석0 외야)', 350, 240], ['외야 상단 띠(좌석0 외야)', 350, 24], ['외야 후방(좌석0 외야)', 436, 128],
  ['상대 코트로 넘어간 공(좌석1 내야)', 330, 128], ['내야 중앙(좌석0)', 180, 128],
];
export function pickupTimes({ level = 2, seeds = 6, humans = false } = {}) {
  const out = [];
  for (const [name, x, y] of SCEN) {
    const fr = [], roles = { in: 0, out: 0 };
    let fail = 0;
    for (let s = 0; s < seeds; s++) {
      const m = new Match({ seed: 900 + s, teams: [(s * 3) % 25, (s * 11 + 4) % 25], data, humans: humans ? [true, false] : [false, false], cpuLevels: humans ? [null, level || null] : level ? [level, level] : [null, null] });
      let g = 0; while ((m.phase !== 'play' || m.tip.on) && g++ < 3000) m.tick([0, 0]);
      for (let w = 0; w < 60; w++) m.tick([0, 0]);
      for (const o of m.players) o.hasBall = false;
      const b = m.ball; b.mode = 3; b.holder = -1; b.x = x * 65536; b.y = y * 65536; b.z = 0; b.vx = b.vy = b.vz = 0; b.still = 0;
      m.drainEvents();
      let got = -1;
      for (let f = 0; f < 360 && got < 0; f++) {
        m.tick([0, 0]);
        for (const e of m.drainEvents()) if (e.k === 'receive' && got < 0) { got = f + 1; roles[m.players[e.p].role]++; }
      }
      if (got < 0) fail++; else fr.push(got);
    }
    fr.sort((a, c) => a - c);
    out.push({ name, med: fr[fr.length >> 1] ?? null, max: fr[fr.length - 1] ?? null, fail, roles });
  }
  return out;
}
if (process.argv[1]?.endsWith('cpu_pickup.mjs')) {
  const [level = 2, seeds = 6, mode = 'cvc'] = process.argv.slice(2);
  const r = pickupTimes({ level: +level, seeds: +seeds, humans: mode === 'human' });
  console.log(`레벨 ${level} 모드 ${mode} 시드 ${seeds}`);
  for (const x of r) console.log(`${x.name.padEnd(24)} 중앙 ${String(x.med).padStart(4)}f 최대 ${String(x.max).padStart(4)}f 실패 ${x.fail}/${seeds} 줍기 내야${x.roles.in} 외야${x.roles.out}`);
}
