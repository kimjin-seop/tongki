// 디버그: 난수 시드 바이트($E622)를 바꿔 가며 우리 엔진에서 컴퓨터 보유자가 고르는 공격 plan 을 훑는다(원작 트레이스를 만들 시드 고르기용)
import fs from 'fs';
import { inject } from './ours_trace.mjs';
const tr = JSON.parse(fs.readFileSync(new URL('./traces/oracle/atk_plan14.json', import.meta.url), 'utf8'));
const by = {};
for (let v = 0; v < 256; v++) {
  const init = JSON.parse(JSON.stringify(tr.init));
  init.rng = ((init.rng & ~0xff00) | (v << 8)) >>> 0;
  const { m } = inject(init);
  let seq = [];
  for (let i = 0; i < 260; i++) {
    m.tick([4, 0]);
    for (const p of m.players) if (p.seat === 1 && p.hasBall && p.cb && p.cb.has && p.cb.plan && p.cb.plan !== 0x48) { const k = (p.role === 'in' ? '' : 'o') + p.cb.plan.toString(16); if (seq[seq.length - 1] !== k) seq.push(k); }
  }
  const key = seq.join('>');
  (by[key] ??= []).push(v.toString(16));
}
for (const [k, v] of Object.entries(by)) console.log(k.padEnd(24), v.length, v.slice(0, 6).join(','));
