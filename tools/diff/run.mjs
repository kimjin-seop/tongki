// 차분 비교기: 원작 트레이스(tools/diff/traces/oracle) 대 우리 엔진(Match.tick)을 프레임별로 비교하고 analysis/22_diff_status.md 를 쓴다.
// 실행: node tools/diff/run.mjs [시나리오명 ...] [--no-pin] [--no-report] [-v]
// 원작 트레이스가 없는 시나리오는 "원작 트레이스 없음"으로 표시한다(먼저 python -I tools/diff/oracle_trace.py).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runOurs, normOracle, FIX, TIMED } from './ours_trace.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const names = argv.filter((a) => !a.startsWith('-'));
const pin = !argv.includes('--no-pin'), verbose = argv.includes('-v');
const cfg = JSON.parse(readFileSync(path.join(HERE, 'scenarios.json'), 'utf8'));
const KEYS = { U: 1, D: 2, L: 4, R: 8, B: 16, C: 32, A: 64, S: 128 };
const parsePads = (s) => (s || '').split(/\s+/).filter(Boolean).flatMap((t) => { const [k, n] = t.split(':'); let m = 0; for (const c of k) if (c !== '-') m |= KEYS[c]; return Array(+n).fill(m); });
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const fx = (v) => (v / 65536).toFixed(4);

/** 한 프레임의 감시 대상 필드 차이 목록 [{field, o, u}] */
function diffFrame(o, u, watch) {
  const out = [];
  const add = (field, a, b, fixed) => { if (a !== b) out.push({ field, o: fixed ? fx(a) : a, u: fixed ? fx(b) : b, d: fixed ? b - a : null }); };
  for (const w of watch) {
    if (/^p\d+$/.test(w)) {
      const k = +w.slice(1), a = o.p[k], b = u.p[k];
      for (const key of FIX) add(`${w}.${key}`, a[key], b[key], true);
      add(`${w}.act`, a.act, b.act);
      if (TIMED.has(a.act)) add(`${w}.tmr`, a.tmr, b.tmr);
    } else if (w === 'ball') {
      for (const key of FIX) add(`ball.${key}`, o.ball[key], u.ball[key], true);
      add('ball.mode', o.ball.mode, u.ball.mode);
      add('ball.holder', o.ball.holder, u.ball.holder);
      if (o.ball.mode === 'fly' || o.ball.mode === 'special') add('ball.power', o.ball.power, u.ball.power);
    } else if (w === 'rules') {
      for (let k = 0; k < 14; k++) add(`p${k}.hp`, o.p[k].hp, u.p[k].hp);
      add('rem0', o.rem[0], u.rem[0]); add('rem1', o.rem[1], u.rem[1]);
    } else if (w === 'rng') add('rng', o.rng, u.rng);
    else if (w === 'ctrl') add('ctrl0', o.ctrl[0], u.ctrl[0]); // 좌팀 조작(활성) 선수 번호. 고정(pin)을 끈 시나리오에서만 의미가 있다
    else throw new Error('unknown watch ' + w);
  }
  return out;
}

function compare(sc) {
  const file = path.join(HERE, 'traces/oracle', sc.name + '.json');
  if (!existsSync(file)) return { sc, status: 'NO_ORACLE' };
  const tr = JSON.parse(readFileSync(file, 'utf8'));
  if (!same(tr.pads, parsePads(sc.pads)) || !same(tr.setup ?? [], sc.setup ?? [])) return { sc, status: 'STALE' };
  const orc = [tr.init, ...tr.frames].map(normOracle);
  let ours;
  try { ours = runOurs(tr, { pin: sc.pin ?? pin }); } catch (e) { return { sc, status: 'ERROR', err: String(e.stack || e) }; }
  mkdirSync(path.join(HERE, 'traces/ours'), { recursive: true });
  writeFileSync(path.join(HERE, 'traces/ours', sc.name + '.json'), JSON.stringify({ name: sc.name, pads: tr.pads, notes: ours.notes, events: ours.events, frames: ours.frames }));
  const N = tr.pads.length;
  const inj = diffFrame(orc[0], ours.frames[0], sc.watch); // 프레임 0 = 주입 직후. 여기서 다르면 어댑터 문제
  let match = 0, first = null;
  const cnt = {}, rows = [];
  for (let f = 1; f <= N; f++) {
    const d = diffFrame(orc[f], ours.frames[f], sc.watch);
    rows.push(d);
    if (!d.length) match++;
    else { if (!first) first = { f, d }; for (const x of d) cnt[x.field] = (cnt[x.field] || 0) + 1; }
  }
  // 진단: 우리 쪽을 k프레임 늦춰(우리 f+k 대 원작 f) 맞춰 보면 일치가 늘어나는가 (판정에는 쓰지 않음)
  let lag = null;
  for (const k of [1, 2, -1]) {
    let c = 0, n = 0;
    for (let f = 1; f <= N; f++) { const g = f + k; if (g < 1 || g > N) continue; n++; if (!diffFrame(orc[f], ours.frames[g], sc.watch).length) c++; }
    if (c > match && (!lag || c > lag.c)) lag = { k, c, n };
  }
  // 원작 쪽 오염 감시: 감시 선수의 HP 가 변했으면(= CPU 의 공에 맞음) 시나리오 영역 밖 사건이 섞인 것
  const taint = [];
  for (const w of sc.watch) if (/^p\d+$/.test(w)) { const k = +w.slice(1); const f = orc.findIndex((x) => x.p[k].hp !== orc[0].p[k].hp); if (f > 0) taint.push(`원작 ${w} HP 변화 f${f}`); }
  { const f = tr.frames.find((x) => x.ctrl[0] !== tr.init.ctrl[0]); if (f) taint.push(`원작이 조작 선수를 바꿈 f${f.f}(obj ${(f.ctrl[0] - 0xc000) / 0x80}) -> 이후 구간은 입력이 그 선수에게 가지 않음`); }
  if (tr.lagFrames) taint.push(`원작 에뮬 처리 지연 ${tr.lagFrames}프레임`);
  // 상태 전이(런 길이)와 끝 위치: 앞 프레임의 불일치에 가려지는 차이(대시·선 이탈·이동 한계·투구 선딜)를 따로 보여 준다
  const rle = (arr) => { const o = []; for (const v of arr) { const l = o[o.length - 1]; if (l && l[0] === v) l[1]++; else o.push([v, 1]); } return o.map(([v, n]) => `${v}x${n}`).join(' '); };
  const seq = [], end = [];
  for (const w of sc.watch) {
    const get = /^p\d+$/.test(w) ? (x) => x.p[+w.slice(1)] : w === 'ball' ? (x) => x.ball : null;
    if (!get) continue;
    const key = w === 'ball' ? 'mode' : 'act';
    seq.push({ w, o: rle(orc.slice(1).map((x) => get(x)[key])), u: rle(ours.frames.slice(1).map((x) => get(x)[key])) });
    const a = get(orc[N]), b = get(ours.frames[N]);
    end.push(`${w} 원작 (${fx(a.x)}, ${fx(a.y)}, ${fx(a.z)}) / 우리 (${fx(b.x)}, ${fx(b.y)}, ${fx(b.z)})`);
  }
  return { sc, status: !inj.length && match === N ? 'PASS' : 'FAIL', N, match, first, cnt, lag, inj, taint, notes: ours.notes, rows, orc, ours, seq, end };
}

const results = cfg.scenarios.filter((s) => !names.length || names.includes(s.name)).map(compare);

// ---- 콘솔 ----
for (const r of results) {
  if (r.status !== 'PASS' && r.status !== 'FAIL') { console.log(`${r.status.padEnd(9)} ${r.sc.name}${r.err ? '\n' + r.err : ''}`); continue; }
  const fm = r.first ? ` 첫 불일치 f${r.first.f}: ` + r.first.d.slice(0, 4).map((x) => `${x.field} 원작 ${x.o} / 우리 ${x.u}`).join(', ') : '';
  console.log(`${r.status.padEnd(5)} ${r.sc.name.padEnd(24)} ${r.match}/${r.N}${fm}${r.inj.length ? ' [주입 불일치 ' + r.inj.map((x) => x.field).join(',') + ']' : ''}`);
  if (verbose) for (let f = 1; f <= r.N; f++) if (r.rows[f - 1].length) console.log(`    f${f} ` + r.rows[f - 1].map((x) => `${x.field} ${x.o}/${x.u}`).join(' '));
}

// ---- 보고서 ----
if (!argv.includes('--no-report') && !names.length) {
  const done = results.filter((r) => r.status === 'PASS' || r.status === 'FAIL');
  const areas = [...new Set(cfg.scenarios.map((s) => s.area))];
  const L = [];
  L.push('# 22. 차분 테스트 현황 (원작 에뮬 대 우리 엔진)', '');
  L.push('이 파일은 `node tools/diff/run.mjs` 가 자동 생성한다(직접 고치지 말 것). 하니스 설명·실행법: `tools/diff/README.md`.', '');
  L.push(`- 판정: 감시 필드(선수 x,y,z,vx,vy,vz 16.16 정수 · 상태 라벨 · 타이머 / 공 x..vz · 모드 · 보유자 · 위력)가 **전 프레임 비트 단위로 같아야 PASS**. 프레임 오프셋 허용 없음.`);
  L.push(`- 시작 상태: 원작 저장 상태 \`analysis/state/${cfg.state}.pkl\` 을 대기 루프 경계까지 진행한 뒤 우리 엔진에 주입(조작 선수 고정 ${pin ? '켬' : '끔'}).`);
  L.push('- 원작 값은 자작 68000 에뮬(`analysis/scripts/m68k.py`) 결과다. 실기·검증된 에뮬과 대조한 적 없음(한계는 README "오라클 신뢰도").', '');
  L.push('## 요약 (영역별)', '', '| 영역 | 시나리오 | PASS | 일치 프레임 / 전체 |', '|---|---|---|---|');
  let ts = 0, tp = 0, tm = 0, tn = 0;
  for (const a of areas) {
    const rs = done.filter((r) => r.sc.area === a);
    const all = results.filter((r) => r.sc.area === a).length;
    const p = rs.filter((r) => r.status === 'PASS').length, mt = rs.reduce((s, r) => s + r.match, 0), n = rs.reduce((s, r) => s + r.N, 0);
    ts += all; tp += p; tm += mt; tn += n;
    L.push(`| ${a} | ${all}${rs.length < all ? ` (실행 ${rs.length})` : ''} | ${p} | ${mt} / ${n} |`);
  }
  L.push(`| **합계** | ${ts} | ${tp} | ${tm} / ${tn} |`, '');
  L.push('## 시나리오별', '', '| 시나리오 | 영역 | 입력 | 감시 | 판정 | 예상(19) | 일치/전체 | 첫 불일치 | 진단 |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const s = r.sc;
    if (r.status !== 'PASS' && r.status !== 'FAIL') { L.push(`| ${s.name} | ${s.area} | \`${s.pads}\` | ${s.watch.join(',')} | ${r.status === 'NO_ORACLE' ? '원작 트레이스 없음' : r.status === 'STALE' ? '원작 트레이스가 시나리오와 다름(재생성 필요)' : '오류'} | ${s.known} | - | - | - |`); continue; }
    const fm = r.first ? `f${r.first.f} ` + r.first.d.slice(0, 3).map((x) => `${x.field} 원작 ${x.o} / 우리 ${x.u}`).join('; ') + (r.first.d.length > 3 ? ` 외 ${r.first.d.length - 3}` : '') : '-';
    const dg = [];
    if (r.inj.length) dg.push('주입 불일치: ' + r.inj.map((x) => x.field).join(','));
    if (r.lag) dg.push(`우리를 ${r.lag.k}프레임 ${r.lag.k > 0 ? '늦추면' : '당기면'} ${r.lag.c}/${r.lag.n} 일치`);
    dg.push(...r.taint);
    const kn = s.known === '?' ? '?' : s.known === r.status ? `${s.known} (맞음)` : `${s.known} (**다름**)`;
    L.push(`| ${s.name} | ${s.area} | \`${(s.setup ? s.setup.join('+') + ' / ' : '') + s.pads}\` | ${s.watch.join(',')} | **${r.status}** | ${kn} | ${r.match}/${r.N} | ${fm} | ${dg.join('; ') || '-'} |`);
  }
  L.push('', '## 불일치 필드 집계 (FAIL 시나리오)', '', '| 시나리오 | 필드: 불일치 프레임 수 |', '|---|---|');
  for (const r of done) if (r.status === 'FAIL') L.push(`| ${r.sc.name} | ${Object.entries(r.cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(', ')} |`);
  L.push('', '## 상태 전이와 끝 위치 (FAIL 시나리오)', '', '라벨x프레임수. 원작 라벨은 타입/서브, 우리 라벨은 ST 를 `ours_trace.mjs` 표로 바꾼 것. 끝 위치 = 마지막 프레임 (x, y, z) px.', '');
  for (const r of done) if (r.status === 'FAIL') {
    L.push(`- **${r.sc.name}**`);
    for (const q of r.seq) L.push(`  - ${q.w} 원작: ${q.o}`, `  - ${q.w} 우리: ${q.u}`);
    L.push(`  - 끝 위치: ${r.end.join('; ')}`);
  }
  const notes = done.filter((r) => r.notes.length);
  if (notes.length) {
    L.push('', '## 주입 근사·참고', '');
    const seen = new Map();
    for (const r of notes) for (const n of r.notes) seen.set(n, [...(seen.get(n) || []), r.sc.name]);
    for (const [n, v] of seen) L.push(`- ${n} (${v.length === done.length ? '전 시나리오' : v.join(', ')})`);
  }
  L.push('');
  writeFileSync(path.join(ROOT, 'analysis/22_diff_status.md'), L.join('\n'));
  console.log('-> analysis/22_diff_status.md');
}
