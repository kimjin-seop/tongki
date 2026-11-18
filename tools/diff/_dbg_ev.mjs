// 디버그: 우리 엔진의 이벤트·활성 선수·두뇌 상태 출력. 사용: node tools/diff/_dbg_ev.mjs <시나리오> <from> <to> [pid...]
import fs from 'fs';
import { inject } from './ours_trace.mjs';
const [name, a, b, ...ks] = process.argv.slice(2);
const tr = JSON.parse(fs.readFileSync(new URL('./traces/oracle/' + name + '.json', import.meta.url), 'utf8'));
const { m } = inject(tr.init);
const fx = (v) => (v / 65536).toFixed(3);
tr.pads.forEach((pad, i) => {
  m.tick([pad, tr.pads2?.[i] ?? 0]);
  const ev = m.drainEvents();
  if (i + 1 < +a || i + 1 > +b) return;
  console.log('f' + (i + 1), 'ctrl', m.sides.map((s) => s.ctrl).join(','), 'ball', m.ball.mode, m.ball.holder, fx(m.ball.x), fx(m.ball.y), fx(m.ball.z), 'z', JSON.stringify(m.sides.map((s) => [s.zp, s.zone])), 'ev', ev.map((e) => e.k + ':' + (e.p ?? '')).join(' '));
  for (const k of ks) { const p = m.players[+k]; console.log('   p' + k, 'st', p.st, 'x', fx(p.x), fx(p.y), fx(p.z), 'v', fx(p.vx), fx(p.vy), fx(p.vz), 'cb', JSON.stringify(p.cb), 'recv', JSON.stringify(p.recv), 'chg', p.charging, p.charge, 'wind', JSON.stringify(p.wind)); }
});
