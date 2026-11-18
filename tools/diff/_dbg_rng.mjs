// 디버그: 지정 프레임의 난수 호출 스택 출력. 사용: node tools/diff/_dbg_rng.mjs <시나리오> <프레임...>
import fs from 'fs';
import { inject } from './ours_trace.mjs';
const [name, ...fs_] = process.argv.slice(2); const want = new Set(fs_.map(Number));
const tr = JSON.parse(fs.readFileSync(new URL('./traces/oracle/' + name + '.json', import.meta.url), 'utf8'));
const { m } = inject(tr.init);
const next = m.rng.next.bind(m.rng); let f = 0;
m.rng.next = () => { if (want.has(f)) console.log('f' + f, 'tms', m.players.map((q) => q.cb ? q.cb.tm + '/' + q.cb.sub.toString(16) + (m.sides[q.seat].ctrl === q.pid ? '*' : '') : '-').join(' '), 'z', JSON.stringify(m.sides.map((s) => [s.zp, s.zone])), new Error().stack.split('\n').slice(2, 6).map((l) => l.trim().replace(/\(file:.*\/(\w+\.js)/, '($1')).join(' <- ')); return next(); };
tr.pads.forEach((pad, i) => { f = i + 1; m.tick([pad, tr.pads2?.[i] ?? 0]); });
