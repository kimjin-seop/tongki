// 정지 공 사각지대 점검: 코트 전역 격자에 정지한 공을 놓고 누군가 줍기까지 프레임을 측정한다(헤드리스, 운영·서버 무관).
// 사용: node tools/stall_scan.mjs [stepX] [stepY]   -- 최악값·미습득 칸을 출력한다.
import { Match, loadData, BIT } from '../server/engine/index.js';

const data = loadData();
const O = 65536;
const stepX = +(process.argv[2] ?? 4), stepY = +(process.argv[3] ?? 8);
const LIMIT = 900;

function toLive(m) { let n = 0; while ((m.phase !== 'play' || m.tip.on) && n++ < 3000) m.tick([0, 0]); }

/** 사람 봇: 조작 선수가 공으로 걸어가 닿으면 A 를 눌렀다 뗀다 */
function humanBits(m, seat, f) {
  const p = m.players[m.sides[seat].ctrl], b = m.ball;
  if (!p || p.hasBall) return 0;
  const dx = (b.x - p.x) / O, dy = (b.y - p.y) / O;
  let bits = 0;
  if (dx > 3) bits |= BIT.RIGHT; else if (dx < -3) bits |= BIT.LEFT;
  if (dy > 3) bits |= BIT.DOWN; else if (dy < -3) bits |= BIT.UP;
  if (Math.abs(dx) <= 14 && Math.abs(dy) <= 14 && f % 2 === 0) bits = BIT.A;
  return bits;
}

function cell(cfg, x, y) {
  const m = new Match({ seed: 5, teams: [0, 1], data, humans: cfg.humans, cpuLevels: cfg.lv });
  toLive(m);
  for (const o of m.players) o.hasBall = false;
  const b = m.ball;
  Object.assign(b, { mode: 3, holder: -1, x: x * O, y: y * O, z: 0, vx: 0, vy: 0, vz: 0, still: 0 });
  for (let f = 0; f < LIMIT; f++) {
    m.tick([cfg.humans[0] ? humanBits(m, 0, f) : 0, cfg.humans[1] ? humanBits(m, 1, f) : 0]);
    if (m.ball.mode !== 3) return f + 1;
  }
  return -1;
}

const cfgs = [
  { name: 'CPU(lv1) vs CPU(lv1)', humans: [false, false], lv: [1, 1] },
  { name: 'CPU(lv2) vs CPU(lv2)', humans: [false, false], lv: [2, 2] },
  { name: 'CPU(lv3) vs CPU(lv3)', humans: [false, false], lv: [3, 3] },
  { name: '사람(좌) vs CPU(lv2)', humans: [true, false], lv: [null, 2] },
  { name: 'CPU(lv2) vs 사람(우)', humans: [false, true], lv: [2, null] },
  { name: '사람 vs 사람', humans: [true, true], lv: [null, null] },
  { name: 'AI 기본 vs AI 기본', humans: [false, false], lv: [null, null] },
];
const out = [];
for (const cfg of cfgs) {
  let worst = 0, wAt = null; const bad = [];
  for (let x = 16; x <= 496; x += stepX) for (let y = 16; y <= 248; y += stepY) {
    const r = cell(cfg, x, y);
    if (r < 0) bad.push([x, y]); else if (r > worst) { worst = r; wAt = [x, y]; }
  }
  out.push({ cfg: cfg.name, worst, wAt, notPicked: bad.length, sample: bad.slice(0, 12) });
  console.log(JSON.stringify(out.at(-1)));
}
