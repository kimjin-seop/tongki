// 조작감 측정(우리 엔진, 서버 접촉 없음). feel_move.py(원작)와 같은 입력열·같은 출력 형식. node analysis/scripts/feel_move_ours.mjs
import { Match, loadData, ONE } from '../../server/engine/index.js';
const data = loadData();
const U = 1, D = 2, L = 4, R = 8, B = 16, C = 32, A = 64;
function fresh() {
  const m = new Match({ seed: 9, teams: [0, 1], data, humans: [true, false], cpuLevels: [null, 2] });
  let n = 0; while ((m.phase !== 'play' || m.tip.on) && n < 4000) { m.tick([0, 0]); n++; }
  for (let i = 0; i < 20; i++) m.tick([0, 0]);
  const p = m.players[0];
  p.x = 236 * ONE; p.y = 128 * ONE; p.vx = p.vy = 0; p.st = 0; p.tm = 0; m.sides[0].ctrl = 0; // 원작 ctrl0 상태와 같은 위치(236,128)
  m.ball.x = 400 * ONE; m.ball.y = 60 * ONE; // 공은 멀리(조작 전환·줍기 영향 제거)
  return m;
}
const r3 = (v) => Math.round(v * 1000) / 1000;
function rec(pads) { const m = fresh(), o = []; for (const k of pads) { m.sides[0].ctrl = 0; m.tick([k, 0]); const q = m.players[0]; o.push({ x: q.x / ONE, y: q.y / ONE, z: q.z / ONE, vx: q.vx / ONE, vy: q.vy / ONE, vz: q.vz / ONE, st: q.st, tm: q.tm, df: q.dashFlag ? 1 : 0 }); } return o; }
function show(name, o, keys, step = 1, n) { console.log(name); for (const k of keys) console.log('  ', k, JSON.stringify(o.slice(0, n).filter((_, i) => i % step === 0).map((x) => r3(x[k])))); }
const rep = (k, n) => Array(n).fill(k);
show('WALK L 6f, release 4f, R 5f (start/stop/reverse)', rec([...rep(L, 6), ...rep(0, 4), ...rep(R, 5)]), ['vx', 'x']);
show('WALK diag U|L 5f', rec(rep(U | L, 5)), ['vx', 'vy']);
show('WALK U 3f then D 3f', rec([...rep(U, 3), ...rep(D, 3)]), ['vy']);
show('DASH L double-tap then no input 45f', rec([L, L, 0, 0, 0, L, L, ...rep(0, 45)]), ['vx', 'st', 'df']);
show('DASH L then U at +28 (brake)', rec([L, L, 0, 0, 0, L, L, ...rep(0, 28), ...rep(U, 30)]).slice(30), ['vx', 'vy', 'st']);
show('DASH L hold then R (reverse)', rec([L, L, 0, 0, 0, ...rep(L, 30), ...rep(R, 30)]).slice(30), ['vx', 'st']);
show('double-tap UP', rec([U, U, 0, 0, 0, ...rep(U, 20)]), ['vy', 'st']);
for (const gap of [10, 13, 14, 15, 16, 17]) console.log('double-tap gap', gap, 'st', JSON.stringify(rec([L, ...rep(0, gap), ...rep(L, 4)]).slice(-4).map((x) => x.st)));
let o = rec([C, ...rep(0, 45)]);
show('JUMP stand', o, ['z', 'vz', 'st'], 1, 6); console.log('   air frames', o.filter((x) => x.z > 0).length, 'zmax', Math.max(...o.map((x) => x.z)), 'land st seq', JSON.stringify(o.slice(38, 45).map((x) => x.st)));
o = rec([...rep(L, 5), L | C, ...rep(L, 45)]);
show('JUMP while walking L', o, ['vx', 'z'], 1, 12); show('   ...landing', o.slice(40), ['vx', 'z', 'st']);
show('JUMP then L in air', rec([C, ...rep(0, 5), ...rep(L, 40)]), ['vx'], 3);
o = rec([L, L, 0, 0, 0, L, L, ...rep(0, 26), C, ...rep(0, 60)]);
show('DASH JUMP', o.slice(32), ['vx', 'vz', 'z', 'st'], 4); console.log('   zmax', Math.max(...o.map((x) => x.z)), 'air frames', o.filter((x) => x.z > 0).length);
show('B catch stance', rec([B, ...rep(0, 16)]), ['st', 'tm']);
show('B then L', rec([B, ...rep(L, 14)]), ['st', 'vx']);
show('air B', rec([C, ...rep(0, 6), B, ...rep(0, 40)]), ['st', 'tm', 'z'], 2);
show('A crouch', rec([A, ...rep(0, 34)]), ['st', 'tm'], 2);
for (const [name, seq] of [['U then L', [[U, 60], [L, 110]]], ['D then L', [[D, 60], [L, 110]]], ['R', [[R, 20]]], ['D then R', [[D, 60], [R, 20]]]]) {
  const m = fresh(); for (const [k, n] of seq) for (let i = 0; i < n; i++) { m.sides[0].ctrl = 0; m.tick([k, 0]); }
  console.log('BOUND', name, 'x=' + (m.players[0].x / ONE).toFixed(2), 'y=' + (m.players[0].y / ONE).toFixed(2));
}
