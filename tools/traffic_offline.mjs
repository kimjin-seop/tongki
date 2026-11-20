// 측정 전용(analysis/51): 스냅샷 로그로 오프라인 재계산. 서버 코드는 읽기만 한다(엔진 Match 를 직접 돌려 로그를 만들 수도 있다).
//  - 필드별 바이트 기여, 경기 구간별(시작·일반·필살/이벤트·종료) 크기
//  - 같은 상태에서 30Hz·좌표 양자화·델타·바이너리로 보냈을 때의 바이트
//  - permessage-deflate(문맥 유지/미유지) 압축률·CPU(µs/메시지), 엔진 틱·snapshot·stringify CPU
//  - 엔진 입력 반응 틱(방향키 -> 조작 선수 x 변화까지)
// 사용: node tools/traffic_offline.mjs [--engine 8] [--ws <traffic_ws_measure 출력 디렉터리>] [--json <결과 파일>]
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { Match, loadData, BIT } from '../server/engine/index.js';
import * as fsx from 'node:fs';
// --out 가 이미 디렉터리면(실행 환경이 경로를 미리 만드는 경우) 그 안의 result.json 에 쓴다
const outFile = (p) => (fsx.existsSync(p) && fsx.statSync(p).isDirectory() ? p.replace(/[\/]+$/, '') + '/result.json' : p);

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const N_ENGINE = Number(arg('engine', 8));
const WS_DIR = arg('ws', null);
const OUT_JSON = arg('json', null);
const data = loadData();
const blen = (s) => Buffer.byteLength(s);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- 로그 만들기: 엔진 컴퓨터 대 컴퓨터(서버 RoomGame 과 같이 매 틱 snapshot, 종료 후 endHold 까지) ----------
function engineMatches(n) {
  const out = [], cpu = { tick: [], snap: [], str: [] };
  for (let i = 0; i < n; i++) {
    const m = new Match({ seed: 9100 + i, teams: [i % 15, (i * 7 + 3) % 15], data, humans: [false, false], cpuLevels: [2, 2] });
    const snaps = [m.snapshot()];
    let guard = 0;
    while (guard++ < 40000) {
      let t = performance.now(); m.tick([0, 0]); cpu.tick.push(performance.now() - t);
      t = performance.now(); const s = m.snapshot(); cpu.snap.push(performance.now() - t);
      t = performance.now(); JSON.stringify(s); cpu.str.push(performance.now() - t);
      snaps.push(s);
      if (m.result && m.f - m.endF >= (m.endHold || 90)) break;
    }
    out.push({ name: `engine#${i}`, reason: m.result?.reason ?? 'unfinished', snaps });
  }
  return { matches: out, cpu };
}

function wsMatches(dir) {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.snaps.jsonl'))) {
    const lines = readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean);
    const snaps = lines.map((l) => JSON.parse(JSON.parse(l).s));
    if (snaps.length) out.push({ name: 'ws:' + f.replace('.snaps.jsonl', ''), snaps });
  }
  return out;
}

// ---------- 필드 기여 ----------
function fieldBreakdown(snaps) {
  const acc = {}, prow = [], pcoord = [];
  for (const s of snaps) {
    for (const [k, v] of Object.entries(s)) acc[k] = (acc[k] ?? 0) + blen(`"${k}":${JSON.stringify(v)},`);
    for (const r of s.p) { prow.push(blen(JSON.stringify(r)) + 1); pcoord.push(blen(`${r[0]},${r[1]},${r[2]},`)); }
  }
  const total = avg(snaps.map((s) => blen(JSON.stringify(s))));
  const fields = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, r1(v / snaps.length)]).sort((a, b) => b[1] - a[1]));
  return { avgSnap: r1(total), fields, playerRow: r1(avg(prow)), playerCoords: r1(avg(pcoord)), playersTotal: r1(avg(prow) * 14) };
}

// ---------- 구간 분류 ----------
const EVENTFUL = new Set(['special', 'hit', 'catch', 'out', 'fm_start', 'ref_out', 'throw']);
function segments(snaps) {
  // play 구간은 60틱 창 단위로: 창 안에 special 이벤트·필살 공(kind>0)·포메이션(fm) 이 있으면 'special', 그 밖은 'normal'
  const seg = new Array(snaps.length);
  for (let i = 0; i < snaps.length; i += 60) {
    const w = snaps.slice(i, i + 60);
    const sp = w.some((s) => s.b[6] > 0 || s.fm || s.ev.some((e) => e.k === 'special' || e.k.startsWith('fm')));
    for (let j = 0; j < w.length; j++) {
      const s = w[j];
      seg[i + j] = s.ph === 'ready' ? 'start' : s.ph === 'end' ? 'end' : sp ? 'special' : 'normal';
    }
  }
  const by = {};
  snaps.forEach((s, i) => { const e = by[seg[i]] ?? (by[seg[i]] = { n: 0, bytes: 0, ev: 0, evBytes: 0, evCount: 0 }); const L = blen(JSON.stringify(s)); e.n++; e.bytes += L; e.evBytes += blen(JSON.stringify(s.ev)); e.evCount += s.ev.length; if (s.ev.length) e.ev++; void EVENTFUL; });
  return Object.fromEntries(Object.entries(by).map(([k, e]) => [k, { snaps: e.n, sec: r1(e.n / 60), avgSnap: r1(e.bytes / e.n), Bps60: Math.round(e.bytes / e.n * 60), evPerSec: r1(e.evCount / e.n * 60), evBytesPerSnap: r1(e.evBytes / e.n), snapsWithEv: r1(e.ev / e.n * 100) + '%' }]));
}

// ---------- 변환 ----------
const quantP = (s, d) => ({ ...s, p: s.p.map((r) => [Math.round(r[0] / d), Math.round(r[1] / d), Math.round(r[2] / d), ...r.slice(3)]), b: [Math.round(s.b[0] / d), Math.round(s.b[1] / d), Math.round(s.b[2] / d), ...s.b.slice(3)], ref: s.ref ? [Math.round(s.ref[0] / d), Math.round(s.ref[1] / d), ...s.ref.slice(2)] : null });
function to30(snaps) { // 짝수 틱만 보내고 그 사이(홀수 틱) 이벤트를 합친다
  const out = []; let pend = [];
  for (const s of snaps) { if (s.f % 2) { pend.push(...s.ev); continue; } out.push({ ...s, ev: [...pend, ...s.ev] }); pend = []; }
  return out;
}
const J = (v) => JSON.stringify(v);
/** JSON 델타: keyEvery 틱마다 전체(키프레임), 그 사이 = 바뀐 최상위 키 + 바뀐 선수 칸만 [pid, 칸, 값, 칸, 값…] */
function deltaJson(snaps, keyEvery = 60) {
  let prev = null; const out = [];
  for (const s of snaps) {
    if (!prev || s.f % keyEvery === 0) { out.push(J(s)); prev = s; continue; }
    const d = { t: 'd', f: s.f };
    for (const k of Object.keys(s)) {
      if (k === 't' || k === 'f' || k === 'p' || k === 'ev') continue;
      if (J(s[k]) !== J(prev[k])) d[k] = s[k];
    }
    const pc = [];
    s.p.forEach((r, pid) => { const q = prev.p[pid], c = [pid]; r.forEach((v, i) => { if (v !== q[i]) c.push(i, v); }); if (c.length > 1) pc.push(c); });
    if (pc.length) d.p = pc;
    if (s.ev.length) d.ev = s.ev;
    out.push(J(d)); prev = s;
  }
  return out;
}

// 바이너리 인코딩(전체): 머리 25B + 선수 14x12B + 공 10B + 선택 칸 + 이벤트·fm·tr 은 JSON 문자열 그대로(드묾)
const PH = { ready: 0, play: 1, end: 2 };
function binFull(s) {
  const extra = [s.fm ? J(s.fm) : '', s.tr ? J(s.tr) : '', s.ev.length ? J(s.ev) : ''].map((x) => Buffer.from(x));
  const n = 25 + 14 * 12 + 10 + (s.ref ? 7 : 0) + (s.ban ? 5 : 0) + (s.tip ? 1 : 0) + extra.reduce((a, b) => a + 2 + b.length, 0);
  const b = Buffer.alloc(n); let o = 0;
  b.writeUInt8(1, o++); b.writeUInt32LE(s.f, o); o += 4; b.writeUInt8(PH[s.ph] | (s.sd ? 4 : 0) | (s.lock ? 8 : 0) | (s.ref ? 16 : 0) | (s.ban ? 32 : 0) | (s.tip ? 64 : 0), o++);
  b.writeUInt16LE(s.clk & 0xffff, o); o += 2; b.writeUInt8(s.rem[0], o++); b.writeUInt8(s.rem[1], o++);
  b.writeInt8(s.ctrl[0], o++); b.writeInt8(s.ctrl[1], o++); b.writeInt8(s.aim[0] ?? -1, o++); b.writeInt8(s.aim[1] ?? -1, o++);
  b.writeUInt8(s.sq[0], o++); b.writeUInt16LE(s.sq[1] & 0xffff, o); o += 2; b.writeInt16LE(s.cam ?? -1, o); o += 2;
  b.writeUInt8(s.fmLeft[0], o++); b.writeUInt8(s.fmLeft[1], o++); o += 4; // 예비
  for (const r of s.p) {
    b.writeInt16LE(r[0], o); b.writeInt16LE(r[1], o + 2); b.writeInt16LE(r[2], o + 4); o += 6;
    b.writeUInt8(r[3], o++); b.writeUInt8(r[4] & 255, o++); b.writeUInt8(r[5], o++); b.writeUInt8(r[6], o++); b.writeUInt8(r[7], o++);
    b.writeUInt8((r[8] < 0 ? 1 : 0) | (r[9] ? 2 : 0) | (r[10] ? 4 : 0), o++);
  }
  const bl = s.b; b.writeInt16LE(bl[0], o); b.writeInt16LE(bl[1], o + 2); b.writeInt16LE(bl[2], o + 4); o += 6; b.writeUInt8(bl[3], o++); b.writeInt8(bl[4], o++); b.writeUInt8(bl[5] & 255, o++); b.writeUInt8(bl[6], o++);
  if (s.ref) { b.writeInt16LE(s.ref[0], o); b.writeInt16LE(s.ref[1], o + 2); o += 4; b.writeUInt8(s.ref[2] & 255, o++); b.writeUInt8(s.ref[3] & 255, o++); b.writeUInt8(s.ref[4] ? 1 : 0, o++); }
  if (s.ban) { b.writeUInt8(s.ban[0] & 255, o++); b.writeUInt16LE(s.ban[1] & 0xffff, o); b.writeUInt16LE(s.ban[2] & 0xffff, o + 2); o += 4; }
  if (s.tip) b.writeUInt8(s.tip[0] | (s.tip[1] << 1) | (s.tip[2] << 2), o++);
  for (const x of extra) { b.writeUInt16LE(x.length, o); o += 2; x.copy(b, o); o += x.length; }
  return b;
}
/** 바이너리 델타 크기(바이트 수만 계산): 머리 7B(종류·f·플래그) + 바뀐 머리 칸 + 선수 마스크 2B + 바뀐 선수마다 칸 마스크 2B + 바뀐 칸 + 공(바뀌면 10B) + 이벤트 JSON */
function binDeltaSizes(snaps, keyEvery = 60) {
  const W = [2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0]; // 8~10(face/walk/fm) 은 1바이트 묶음
  let prev = null; const out = [];
  for (const s of snaps) {
    if (!prev || s.f % keyEvery === 0) { out.push(binFull(s).length); prev = s; continue; }
    let n = 7 + 2;
    for (const k of ['ph', 'clk', 'sd', 'rem', 'ctrl', 'aim', 'lock', 'sq', 'cam', 'fmLeft', 'ref', 'ban', 'tip']) if (J(s[k]) !== J(prev[k])) n += k === 'clk' ? 2 : k === 'ref' ? 7 : k === 'ban' ? 5 : k === 'sq' ? 3 : k === 'cam' ? 2 : 2;
    if (s.fm && J(s.fm) !== J(prev.fm)) n += 2 + blen(J(s.fm));
    if (s.tr && J(s.tr) !== J(prev.tr)) n += 2 + blen(J(s.tr));
    n += 2;
    s.p.forEach((r, pid) => { const q = prev.p[pid]; let c = 0, packed = false; r.forEach((v, i) => { if (v !== q[i]) { if (i >= 8) packed = true; else c += W[i]; } }); if (packed) c += 1; if (c) n += 2 + c; });
    if (J(s.b) !== J(prev.b)) n += 10;
    if (s.ev.length) n += 2 + blen(J(s.ev));
    out.push(n); prev = s;
  }
  return out;
}

// ---------- 압축 ----------
async function deflateCtx(bufs, level = 6) { // ws permessage-deflate(문맥 유지): 한 스트림 + 메시지마다 Z_SYNC_FLUSH, 끝 4바이트(00 00 ff ff) 제거
  const d = zlib.createDeflateRaw({ level, memLevel: 8, windowBits: 15 });
  let out = 0, chunks = 0;
  d.on('data', (c) => { chunks += c.length; });
  const c0 = process.cpuUsage(), t0 = performance.now();
  for (const b of bufs) {
    chunks = 0;
    d.write(b);
    await new Promise((r) => d.flush(zlib.constants.Z_SYNC_FLUSH, r));
    out += chunks - 4;
  }
  const cpu = process.cpuUsage(c0), wall = performance.now() - t0;
  d.close();
  return { bytes: out, cpuUsPerMsg: r1((cpu.user + cpu.system) / bufs.length), wallUsPerMsg: r1(wall * 1000 / bufs.length) };
}
function deflateNoCtx(bufs, level = 6) { // 문맥 미유지(server_no_context_takeover): 메시지마다 독립
  let out = 0; const t0 = performance.now();
  for (const b of bufs) out += zlib.deflateRawSync(b, { level, memLevel: 8, windowBits: 15 }).length;
  return { bytes: out, usPerMsg: r1((performance.now() - t0) * 1000 / bufs.length) };
}

async function variantsOf(snaps, withDeflate) {
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const sec = snaps.length / 60;
  const base = snaps.map((s) => J(s));
  const v = {};
  const put = (k, strsOrSizes, msgs) => { const bytes = typeof strsOrSizes[0] === 'number' ? sum(strsOrSizes) : sum(strsOrSizes.map((x) => (Buffer.isBuffer(x) ? x.length : blen(x)))); v[k] = { msgsPerSec: r1(msgs / sec), Bps: Math.round(bytes / sec), avgMsg: r1(bytes / msgs) }; return strsOrSizes; };
  put('json60(현행)', base, base.length);
  const s30 = to30(snaps);
  const j30 = put('json30', s30.map(J), s30.length);
  put('json60_q4(1/4px)', snaps.map((s) => J(quantP(s, 4))), snaps.length);
  put('json60_q16(1px)', snaps.map((s) => J(quantP(s, 16))), snaps.length);
  const d60 = put('delta60', deltaJson(snaps), snaps.length);
  const dq = put('delta60_q4', deltaJson(snaps.map((s) => quantP(s, 4))), snaps.length);
  put('delta30', deltaJson(s30), s30.length);
  put('delta30_q4', deltaJson(s30.map((s) => quantP(s, 4))), s30.length);
  const bf = put('bin60', snaps.map(binFull), snaps.length);
  put('binDelta60', binDeltaSizes(snaps), snaps.length);
  put('binDelta30', binDeltaSizes(s30), s30.length);
  if (withDeflate) {
    const enc = (arr) => arr.map((x) => (Buffer.isBuffer(x) ? x : Buffer.from(x)));
    for (const [k, arr, msgs] of [['json60(현행)', base, base.length], ['json30', j30, s30.length], ['delta60', d60, snaps.length], ['delta60_q4', dq, snaps.length], ['bin60', bf, snaps.length]]) {
      const b = enc(arr);
      const ctx = await deflateCtx(b), noc = deflateNoCtx(b);
      v[k + '+deflate'] = { msgsPerSec: r1(msgs / sec), Bps: Math.round(ctx.bytes / sec), avgMsg: r1(ctx.bytes / msgs), ratio: r1(ctx.bytes / sum(b.map((x) => x.length)) * 100) + '%', cpuUsPerMsg: ctx.cpuUsPerMsg, wallUsPerMsg: ctx.wallUsPerMsg };
      v[k + '+deflate_noctx'] = { msgsPerSec: r1(msgs / sec), Bps: Math.round(noc.bytes / sec), avgMsg: r1(noc.bytes / msgs), ratio: r1(noc.bytes / sum(b.map((x) => x.length)) * 100) + '%', usPerMsg: noc.usPerMsg };
    }
  }
  return v;
}

/** 인코딩 CPU(µs/메시지): 현행 stringify vs 델타 vs 바이너리 */
function encodeCpu(snaps) {
  const time = (f) => { const t = performance.now(); f(); return r1((performance.now() - t) * 1000 / snaps.length); };
  return { stringify: time(() => snaps.forEach((s) => J(s))), deltaJson: time(() => deltaJson(snaps)), binFull: time(() => snaps.forEach(binFull)), quant4: time(() => snaps.forEach((s) => J(quantP(s, 4)))) };
}

// ---------- 엔진 입력 반응(방향키를 누른 틱 -> 조작 선수 x 가 그 방향으로 바뀌는 첫 스냅샷까지 틱 수) ----------
function engineReact(trials = 200) {
  const res = [], jump = [];
  for (let k = 0; k < 6; k++) {
    const m = new Match({ seed: 7000 + k, teams: [k, k + 5], data, humans: [true, false], cpuLevels: [null, 2] });
    while (m.phase !== 'play') m.tick([0, 0]);
    let n = 0, dir = 1, guard = 0;
    while (n < trials / 6 && guard++ < 20000 && !m.result) {
      for (let i = 0; i < 20; i++) m.tick([0, 0]);
      const s0 = m.snapshot(); const pid = s0.ctrl[0], r0 = s0.p[pid];
      if (r0[3] !== 0) continue; // 서 있거나 걷는 상태에서만
      const bit = dir > 0 ? BIT.RIGHT : BIT.LEFT;
      let t = 0, moved = -1;
      for (; t < 10; t++) { m.tick([bit, 0]); const s = m.snapshot(); if (s.ctrl[0] !== pid) break; if ((s.p[pid][0] - r0[0]) * dir > 0) { moved = t + 1; break; } }
      if (moved > 0) { res.push(moved); n++; }
      for (let i = 0; i < 6; i++) m.tick([0, 0]);
      dir = -dir;
      // 점프(C) 반응: st 가 JUMP(1) 로 바뀌는 첫 틱
      const s1 = m.snapshot(); const p1 = s1.ctrl[0];
      if (s1.p[p1][3] === 0 && !(s1.p[p1][6] & 16)) {
        for (let t2 = 0; t2 < 12; t2++) { m.tick([t2 < 3 ? BIT.C : 0, 0]); const s = m.snapshot(); if (s.p[p1][3] === 1) { jump.push(t2 + 1); break; } }
        for (let i = 0; i < 60; i++) m.tick([0, 0]);
      }
    }
  }
  const hist = (a) => a.reduce((h, v) => ((h[v] = (h[v] ?? 0) + 1), h), {});
  return { move: { n: res.length, hist: hist(res) }, jump: { n: jump.length, hist: hist(jump) } };
}

// ---------- 실행 ----------
const report = { at: new Date().toISOString() };
const eng = engineMatches(N_ENGINE);
report.engineCpuUs = { tick: r1(avg(eng.cpu.tick) * 1000), snapshot: r1(avg(eng.cpu.snap) * 1000), stringify: r1(avg(eng.cpu.str) * 1000) };
const all = eng.matches.flatMap((m) => m.snaps);
report.engine = { matches: eng.matches.map((m) => ({ name: m.name, reason: m.reason, frames: m.snaps.length })), breakdown: fieldBreakdown(all), segments: segments(all) };
report.engine.variants = await variantsOf(eng.matches[0].snaps.concat(eng.matches[1]?.snaps ?? []), true);
report.engine.variantsAll = await variantsOf(all, false);
report.encodeCpu = encodeCpu(eng.matches[0].snaps);
report.engineReact = engineReact();
if (WS_DIR && existsSync(WS_DIR)) {
  report.ws = {};
  for (const m of wsMatches(WS_DIR)) report.ws[m.name] = { snaps: m.snaps.length, breakdown: fieldBreakdown(m.snaps), segments: segments(m.snaps), variants: await variantsOf(m.snaps, m.name === 'ws:pvp' || m.name === 'ws:cpu') };
}
if (OUT_JSON) writeFileSync(outFile(OUT_JSON), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ engineCpuUs: report.engineCpuUs, matches: report.engine.matches, breakdown: report.engine.breakdown, segments: report.engine.segments, variants: report.engine.variants, encodeCpu: report.encodeCpu, react: report.engineReact }, null, 1));
