// 줍기 측정(우리 엔진, 서버 접촉 없음). feel_pickup.py(원작)와 같은 시나리오. node analysis/scripts/feel_pickup_ours.mjs
import { Match, loadData, ONE, BM } from '../../server/engine/index.js';
const data = loadData();
const U = 1, D = 2, L = 4, R = 8, B = 16, C = 32, A = 64;
const px = (v) => Math.round(v * ONE);
function fresh(seed = 9) {
  const m = new Match({ seed, teams: [0, 1], data, humans: [true, false], cpuLevels: [null, 2] });
  let n = 0; while ((m.phase !== 'play' || m.tip.on) && n < 4000) { m.tick([0, 0]); n++; }
  for (let i = 0; i < 20; i++) m.tick([0, 0]);
  const p = m.players[0];
  p.x = px(200); p.y = px(128); p.vx = p.vy = 0; p.st = 0; p.tm = 0; // 코트 안쪽 고정 위치
  m.sides[0].ctrl = 0;
  return m;
}
function place(m, x, y, z = 0, v = [0, 0, 0]) {
  const b = m.ball;
  for (const q of m.players) q.hasBall = false;
  Object.assign(b, { x: px(x), y: px(y), z: px(z), vx: px(v[0]), vy: px(v[1]), vz: px(v[2]), mode: BM.LOOSE, holder: -1, still: 0, kind: 0, sp: null });
}
function trial(pads, bx, by, bz = 0, bv = [0, 0, 0], { settle = 3, n = 24, pre = [] } = {}) {
  const m = fresh();
  for (const k of pre) { m.sides[0].ctrl = 0; m.tick([k, 0]); }
  const p = m.players[0];
  place(m, p.x / ONE + bx, p.y / ONE + by, bz, bv);
  for (let i = 0; i < settle; i++) { m.sides[0].ctrl = 0; m.tick([0, 0]); }
  const all = [...pads, ...Array(n).fill(0)];
  for (let i = 0; i < all.length; i++) {
    m.sides[0].ctrl = 0; m.tick([all[i], 0]);
    if (m.ball.mode === BM.HELD && m.ball.holder === 0) return i;
    if (m.ball.mode === BM.HELD) return 'other:' + m.ball.holder;
  }
  return null;
}
const out = [];
const row = (name, r) => { out.push([name, r]); console.log(name.padEnd(70), '->', r); };
for (const [key, nm] of [[A, 'A'], [B, 'B']]) {
  for (const hold of [1, 2, 3]) for (const dx of [0, 16, 20, 22, 24, 25, -24]) row(`stopped ball ${nm} ${hold}f dx ${dx}`, trial(Array(hold).fill(key), dx, 0));
  for (const dy of [16, 20, 21, -16, -17]) row(`stopped ball ${nm} 1f dy ${dy}`, trial([key], 0, dy));
}
for (const k of [0, 4, 8, 12, 16, 20, 24, 30, 40]) row(`bouncing ball(z0=50,dx8) B tap at f${k}`, trial([...Array(k).fill(0), B], 8, 0, 50, [0, 0, 0], { settle: 0, n: 14 }));
for (const k of [8, 20]) row(`bouncing ball A tap at f${k}`, trial([...Array(k).fill(0), A], 8, 0, 50, [0, 0, 0], { settle: 0, n: 40 }));
row('incoming low bounce vx=-3, B at f6', trial([0, 0, 0, 0, 0, 0, B], 60, 0, 10, [-3, 0, 0], { settle: 0, n: 20 }));
row('jump then B at f11, high ball z0=90', trial([C, ...Array(10).fill(0), B], 4, 0, 90, [0, 0, 0], { settle: 0, n: 20 }));
row('A held 30f near stopped ball', trial(Array(30).fill(A), 10, 0));
row('walking L, A 1f (L kept), ball 12px ahead', trial([L | A, ...Array(20).fill(L)], -12, 0, 0, [0, 0, 0], { pre: [L, L, L, L] }));
row('dashing L, A tap, ball 40px ahead', trial([A], -40, 0, 0, [0, 0, 0], { pre: [L, L, 0, 0, 0, ...Array(10).fill(L)] }));
row('standing on stopped ball 200f no key', trial(Array(200).fill(0), 0, 0, 0, [0, 0, 0], { n: 0 }));
const ok = out.filter(([, r]) => typeof r === 'number').length;
console.log(`held ${ok}/${out.length}`);
