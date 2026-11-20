// 측정 전용(analysis/51 지연): 임시 서버(별도 프로세스, 포트 3400, DB_PATH=:memory:)에 루프백으로 붙어
// 「입력 전송 -> 그 입력이 반영된 snap 도착」 시간을 여러 번 잰다(p50/p95/p99). 배경 경기 수(부하)별로 반복한다. 서버 코드는 그대로.
// 반영 판정: 조작 선수(snap.ctrl[0])가 서 있을 때(st 0) 방향키(RIGHT/LEFT 번갈아)를 눌러, 그 선수 x 가 그 방향으로 처음 바뀐 snap.
// 사용: node tools/latency_measure.mjs --out <결과.json> [--trials 300] [--loads 0,50,100]
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { startServer, client } from './traffic_ws_measure.mjs';
import * as fsx from 'node:fs';
// --out 가 이미 디렉터리면(실행 환경이 경로를 미리 만드는 경우) 그 안의 result.json 에 쓴다
const outFile = (p) => (fsx.existsSync(p) && fsx.statSync(p).isDirectory() ? p.replace(/[\/]+$/, '') + '/result.json' : p);

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const TRIALS = Number(arg('trials', 300));
const LOADS = arg('loads', '0,50,100').split(',').map(Number);
const OUT = arg('out', null);
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(2); };
const stats = (a) => ({ n: a.length, mean: a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null, p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99), max: a.length ? +Math.max(...a).toFixed(2) : null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

async function cpuRoom(name) {
  const c = client(name); await c.open;
  c.send({ t: 'hello', nickname: `lt${(++seq).toString().padStart(4, '0')}` }); await c.type('welcome');
  c.send({ t: 'create_room', vsCpu: true, cpuLevel: 2, rules: { mode: 'knockout', time: 8 } }); await c.type('room_joined');
  c.send({ t: 'start' }); await c.type('game_start');
  return c;
}

async function measure(load) {
  const bg = [];
  for (let i = 0; i < load; i++) bg.push(await cpuRoom('bg' + i)); // 배경 경기: 사람 좌석은 입력 없음(컴퓨터만 움직임), snap 은 그대로 60Hz 로 받는다
  const c = await cpuRoom('probe');
  let snap = null, waiter = null;
  c.sub((m, now) => { if (m.t === 'snap') { snap = m; waiter?.(m, now); } });
  while (!snap || snap.ph !== 'play') await sleep(50);
  const lat = [], ticks = [], gapsBefore = c.st.snapT.length;
  let dir = 1, tries = 0;
  while (lat.length < TRIALS && tries++ < TRIALS * 6) {
    await sleep(120 + Math.random() * 180); // 틱 위상과 무관하게 누르도록 무작위 간격
    const s0 = snap; if (!s0 || s0.ph !== 'play' || s0.fm || s0.lock) continue;
    const pid = s0.ctrl[0], r0 = s0.p[pid];
    if (r0[3] !== 0) continue;
    const bits = dir > 0 ? 8 : 4;
    const got = await new Promise((res) => {
      const t0 = performance.now(), f0 = s0.f;
      const to = setTimeout(() => { waiter = null; res(null); }, 600);
      waiter = (m, now) => {
        if (m.ctrl[0] !== pid) { clearTimeout(to); waiter = null; res(null); return; }
        if ((m.p[pid][0] - r0[0]) * dir > 0) { clearTimeout(to); waiter = null; res({ ms: now - t0, df: m.f - f0 }); }
      };
      c.send({ t: 'input', bits });
    });
    c.send({ t: 'input', bits: 0 });
    dir = -dir;
    if (got) { lat.push(got.ms); ticks.push(got.df); }
  }
  const T = c.st.snapT.slice(gapsBefore), gaps = T.slice(1).map((t, i) => t - T[i]);
  const hist = ticks.reduce((h, v) => ((h[v] = (h[v] ?? 0) + 1), h), {});
  const out = { load, rooms: load + 1, conns: load + 1, latencyMs: stats(lat), ticksAfterLastSnap: hist, snapGapMs: stats(gaps), snapGapOver20ms: gaps.filter((g) => g > 20).length, snapGapUnder2ms: gaps.filter((g) => g < 2).length, snaps: T.length };
  for (const x of [...bg, c]) x.close();
  await sleep(1500);
  return out;
}

const srv = await startServer(3400);
const res = [];
try {
  for (const l of LOADS) { const r = await measure(l); res.push(r); console.log(JSON.stringify(r)); }
} finally { srv.stop(); }
if (OUT) writeFileSync(outFile(OUT), JSON.stringify({ at: new Date().toISOString(), platform: process.platform, node: process.version, trials: TRIALS, res }, null, 1));
