// CPU 방어(캐치) 측정: 사람(좌석0)이 지상 투구 -> CPU(좌석1) 내야 대상의 반응 분포.
// 사용: node tools/cpu_catch.mjs [레벨=2] [시도=150] [차지=8]   (레벨 0 = cpuLevels 없음 = 기본 AI)
// 출력: 캐치 시도(catch_start)/캐치 성공/피격/빗나감 비율, 평균 반응 시점(공이 대상에 닿기 몇 f 전에 B 를 눌렀나는 접촉 f - 시작 f)
import { Match, loadData } from '../server/engine/index.js';
import { BIT, BM } from '../server/engine/consts.js';
const data = loadData();
export function measure({ level = 2, n = 150, charge = 8, seedBase = 1000 } = {}) {
  const r = { n: 0, tryCatch: 0, catchOk: 0, hit: 0, miss: 0, other: 0 };
  for (let i = 0; i < n; i++) {
    const m = new Match({ seed: seedBase + i, teams: [i % 25, (i * 7 + 3) % 25], data, humans: [true, false], cpuLevels: [null, level || null] });
    let g = 0;
    while ((m.phase !== 'play' || m.tip.on) && g++ < 3000) m.tick([0, 0]);
    if (m.phase !== 'play') continue;
    for (let w = 0; w < 90; w++) m.tick([0, 0]); // 점프볼 직후의 공중 선수가 없도록 잠시 진행
    const th = m.players.find((p) => p.seat === 0 && p.role === 'in');
    m.sides[0].ctrl = th.pid;
    // 사람이 코트 중앙선에서 떨어진 곳(x 130~190)에서 던진다: 시드별 위치(결정론)
    th.x = (130 + (i * 13) % 61) * 65536; th.y = (70 + (i * 29) % 117) * 65536; th.vx = th.vy = 0;
    m.giveBall(th);
    m.drainEvents();
    let f = 0, held = 0, state = 'aim', res = null, flyF = -1, catchF = -1;
    while (f++ < 400 && !res) {
      let bits = 0;
      if (state === 'aim') { bits = BIT.RIGHT; if (f > 2) state = 'chg'; }
      else if (state === 'chg') { bits = BIT.B; if (++held >= charge) state = 'rel'; }
      else bits = 0;
      m.tick([bits, 0]);
      for (const e of m.drainEvents()) {
        if (e.k === 'throw' && flyF < 0) flyF = f;
        if (e.k === 'catch_start' && m.players[e.p].seat === 1 && flyF >= 0 && catchF < 0) { r.tryCatch++; catchF = f; }
        if (e.k === 'catch' && flyF >= 0) res = 'catchOk';
        if (e.k === 'hit' && flyF >= 0) res = 'hit';
      }
      if (flyF >= 0 && !res && m.ball.mode !== BM.FLY && f > flyF + 2) res = 'miss';
    }
    r.n++;
    if (res === 'catchOk') { r.catchOk++; } else if (res === 'hit') r.hit++; else if (res === 'miss') r.miss++; else r.other++;
  }
  return r;
}
if (process.argv[1] && process.argv[1].endsWith('cpu_catch.mjs')) {
  const [level = 2, n = 150, charge = 8] = process.argv.slice(2).map(Number);
  const r = measure({ level, n, charge });
  const p = (x) => (100 * x / r.n).toFixed(0) + '%';
  console.log(`level=${level} charge=${charge} n=${r.n}: 캐치시도 ${p(r.tryCatch)} 캐치성공 ${p(r.catchOk)} 피격 ${p(r.hit)} 빗나감 ${p(r.miss)} 기타 ${r.other}`);
}
