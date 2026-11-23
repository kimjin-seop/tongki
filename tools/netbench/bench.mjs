// 네트워크 모의 측정(2026-11-22): 실제 서버(임시 포트 8801, 임시 DB) + 지연·지터·손실 TCP 프록시(8802~) 경유로 컴퓨터 대전을 하며 정지 프레임·입력 반응·바이트를 잰다. 8801~8805 와 다른 서비스 포트가 겹치지 않는지 먼저 확인.
// 사용: node tools/netbench/bench.mjs <label> <ver 0|N> <snapsPath> <durSec> [conds]
// 환경변수(2026-11-23): BENCH_PORT = 서버 포트(기본 8801, 프록시는 +1 부터), BENCH_HZ = 렌더 주사율(기본 60. 144 등으로 보간 균일성 확인), BENCH_PROFILE = snaps.js PROFILES 이름(없으면 기본), BENCH_PRECISE=1 = 서버 프로세스를 쉬지 않게 돌려 타이머를 1ms 급으로(윈도우 15.6ms 타이머 대신 리눅스 운영에 가까운 틱 간격. 코어 하나를 쓴다)
// BENCH_VARIANTS = "이름=snaps.js 경로[@성향];..." : 여러 버퍼 구현·성향을 한 번에(같은 서버·같은 시각·같은 지연 무늬로) 잰다. 결과 파일의 variants[]. 주면 <snapsPath> 인자는 무시
// 조건 이름: c40·c100·c200·c300(종전), n50·n100·n200·n200j(RTT 50/100/200 x 손실 0/1/2%). 결과의 extrapPct = 최신 스냅을 지나 그린 프레임 비율, err* = 그린 공 위치와 그 틱의 실제(나중에 받은 스냅) 위치 차(px)
import { spawn } from 'node:child_process';
import { pathToFileURL as _p } from 'node:url';
const { WebSocket } = await import(_p(path.resolve(import.meta.dirname, '../../node_modules/ws/wrapper.mjs')).href);
import { createProxy } from './proxy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [label, ver, snapsPath, dur = '30', condArg = 'all'] = process.argv.slice(2);
const HERE = import.meta.dirname;
const REAL = path.resolve(import.meta.dirname, '../..').split(path.sep).join('/');
const ROOT = process.env.BENCH_ROOT ?? REAL; // 옛 서버 비교 = 옛 소스 사본 폴더를 BENCH_ROOT 로
const TMP = path.join(HERE, 'tmp_' + label); fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
const PROFILE0 = process.env.BENCH_PROFILE?.startsWith('{') ? JSON.parse(process.env.BENCH_PROFILE) : process.env.BENCH_PROFILE; // 이름 또는 JSON 객체
const VARIANTS = [];
for (const v of (process.env.BENCH_VARIANTS ?? `main=${snapsPath}`).split(';').filter(Boolean)) {
  const [name, rest] = [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)];
  const [p, prof] = rest.split('@');
  VARIANTS.push({ name, prof: prof ?? PROFILE0, M: await import(pathToFileURL(p).href) });
}
const { lerpPos } = VARIANTS[0].M;
let codec = null;
try { codec = await import(pathToFileURL(REAL + '/public/js/game/snapcodec.js').href); } catch { /* 기준선: 코덱 없음 */ }
const CONDS = { c40: [40, 10, 0], c100: [100, 30, 0.005], c200: [200, 100, 0.01], c300: [300, 100, 0.02], n50: [50, 10, 0], n100: [100, 20, 0.01], n200: [200, 40, 0.02], n200j: [200, 100, 0.02] };
const names = condArg === 'all' ? Object.keys(CONDS) : condArg.split(',');
const SPORT = Number(process.env.BENCH_PORT ?? 8801);
const srv = spawn(process.execPath, [...(process.env.BENCH_PRECISE ? ['--import', pathToFileURL(path.join(HERE, 'spin.mjs')).href] : []), 'server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(SPORT), DB_PATH: path.join(TMP, 't.db'), RESULTS_PATH: path.join(TMP, 'r.jsonl'), NOTICE_PATH: path.join(TMP, 'n.jsonl'), PROGRESS_PATH: path.join(TMP, 'p.json'), LEAGUE_PATH: path.join(TMP, 'l.json'), JSON_BACKUP_DIR: path.join(TMP, 'bk'), BOTGUARD_ENABLED: '0', BOTGUARD_ALLOW_FILE: path.join(TMP, 'allow.txt'), MAX_HELLO_PER_MIN: '1000', MAX_CONN_PER_IP: '400', MAX_ROOM_CREATE_PER_MIN: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
let slog = ''; srv.stdout.on('data', (d) => (slog += d)); srv.stderr.on('data', (d) => (slog += d));
await new Promise((r) => { const t = setInterval(() => { if (slog.includes('listening')) { clearInterval(t); r(); } }, 50); setTimeout(() => { clearInterval(t); r(); }, 8000); });

const clients = [];
let pi = 0;
for (const nm of names) {
  const [rtt, jit, loss] = CONDS[nm];
  const port = SPORT + 1 + pi++;
  const proxy = createProxy({ listen: port, target: SPORT, rtt, jitter: jit, loss, seed: 7 + pi });
  await proxy.start();
  for (const [vi, V] of VARIANTS.entries()) {
  const c = { v: V.name, nm, rtt, proxy, buf: new V.M.SnapBuffer(typeof V.prof === 'string' && V.prof.startsWith('{') ? JSON.parse(V.prof) : V.prof), arr: [], lastArr: 0, bytes: 0, msgs: 0, errs: [], playStart: 0, frames: [], trials: [], inputs: 0, nick: 'nb' + vi + nm, latest: null, truth: new Map(), delays: {} };
  c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws${ver === '0' ? '' : '?v=' + ver}`);
  c.ws.binaryType = 'nodebuffer';
  c.dec = codec && ver !== '0' ? new codec.SnapDecoder() : null;
  c.ws.on('message', (raw, isBin) => {
    const now = performance.now();
    let m;
    c.bytes += raw.length; c.msgs++;
    if (isBin) { try { m = c.dec.decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.length)); } catch (e) { c.errs.push('dec ' + e.message); return; } if (!m) return; }
    else { try { m = JSON.parse(raw.toString()); } catch { return; } }
    if (m.t === 'welcome') c.ws.send(JSON.stringify({ t: 'create_room', vsCpu: true, ref: 1 }));
    else if (m.t === 'room_joined') c.ws.send(JSON.stringify({ t: 'start', ref: 2 }));
    else if (m.t === 'error') c.errs.push(m.code);
    else if (m.t === 'snap') {
      if (c.lastArr) c.arr.push(now - c.lastArr);
      c.lastArr = now; c.latest = m; c.buf.push(m, now); c.truth.set(m.f, m.b);
      if (m.ph === 'play' && !m.lock && !c.playStart) { c.playStart = now; c.snapMsg0 = c.msgs; c.snapBytes0 = c.bytes; c.wire0 = c.proxy.stats.down; c.t0 = now; c.arr.length = 0; }
    }
  });
  c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'hello', nickname: c.nick, ...(ver === '0' ? {} : { proto: Number(ver) }), ref: 0 })));
  c.ws.on('close', (code) => { c.closed = code; });
  clients.push(c);
  }
}
const DIRS = [8, 4, 1, 2];
const sendIn = (c, bits) => { if (ver === '0') c.ws.send(JSON.stringify({ t: 'input', bits })); else { c.hist = [bits, ...(c.hist ?? [])].slice(0, 3); c.ws.send(JSON.stringify({ t: 'input', n: c.seq = (c.seq ?? -1) + 1, b: c.hist })); } };
const FR = 1000 / Number(process.env.BENCH_HZ ?? 60);
let next = performance.now();
const endAt = performance.now() + (Number(dur) + 25) * 1000;
const pos = (c, sm) => {
  const pid = c.latest?.ctrl?.[0] ?? 0;
  const a = sm.a.p[pid]; if (!a) return null;
  const b = sm.b.p[pid] ?? null;
  return lerpPos(a, b, sm.t);
};
await new Promise((resolve) => {
  const loop = () => {
    const now = performance.now();
    if (now >= endAt) return resolve();
    if (now >= next) {
      next += FR; if (now - next > 100) next = now + FR;
      for (const c of clients) {
        const sm = c.buf.sample(now); if (!sm) continue;
        const inPlay = c.playStart && now > c.playStart + 1000 && now < c.playStart + Number(dur) * 1000 + 1000;
        const p = pos(c, sm);
        const dt = c.pf ? Math.min(100, now - c.pf.now) : 0;
        if (inPlay && c.pf && dt > 0) { c.frames.push({ dt, adv: sm.tick - c.pf.tick, nom: dt * 0.06, tick: sm.tick, ex: sm.tick > c.latest.f, ball: lerpPos(sm.a.b, sm.b.b, sm.t) }); const dk = Math.round(c.buf.delay); c.delays[dk] = (c.delays[dk] ?? 0) + 1; c.dSum = (c.dSum ?? 0) + c.buf.delay; if (c.buf.delay > 6.01) c.dOver = (c.dOver ?? 0) + 1; }
        if (inPlay) {
          const tr = c.trial;
          if (!tr) {
            if (!c.idleSince) c.idleSince = now;
            if (c.lastP && p && Math.hypot(p[0] - c.lastP[0], p[1] - c.lastP[1]) > 0.3) c.idleSince = now;
            if (now - (c.relAt ?? 0) > 700 && now - c.idleSince > 300 && p) {
              sendIn(c, DIRS[c.inputs++ % 4]);
              c.trial = { t0: now, base: p, relAt: now + 900 };
            }
          } else {
            if (!tr.hit && p && Math.hypot(p[0] - tr.base[0], p[1] - tr.base[1]) >= 1) { tr.hit = now; c.trials.push(now - tr.t0); }
            if (now >= tr.relAt) { sendIn(c, 0); c.relAt = now; c.idleSince = now; c.trial = null; }
          }
        }
        c.lastP = p; c.pf = { now, tick: sm.tick };
      }
    }
    setImmediate(loop);
  };
  loop();
});
const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const out = [];
for (const c of clients) {
  const span = (c.lastArr - c.t0) / 1000;
  let stall = 0, jump = 0, runMs = 0, maxMs = 0, n = 0;
  for (const f of c.frames) {
    n++;
    if (f.adv < f.nom * 0.5) { stall++; runMs += f.dt; if (runMs > maxMs) maxMs = runMs; } else runMs = 0;
    if (f.adv > f.nom * 2.5) jump++;
  }
  // 그린 공 위치 - 그 틱의 실제 위치(앞뒤 스냅 선형 보간, 순간이동·모드 전환 구간 제외)
  const errs = []; let ex = 0;
  for (const f of c.frames) {
    if (f.ex) ex++;
    const f0 = Math.floor(f.tick), a = c.truth.get(f0), b = c.truth.get(f0 + 1);
    if (!a || !b || a[3] !== b[3] || Math.abs(a[0] - b[0]) > 64 * 16 || Math.abs(a[1] - b[1]) > 64 * 16) continue;
    const t = f.tick - f0; errs.push(Math.hypot(f.ball[0] - (a[0] + (b[0] - a[0]) * t) / 16, f.ball[1] - (a[1] + (b[1] - a[1]) * t) / 16, f.ball[2] - (a[2] + (b[2] - a[2]) * t) / 16));
  }
  const arr = c.arr;
  out.push({ v: c.v, cond: c.nm, rtt: c.rtt, frames: n, stallPct: +(stall / n * 100).toFixed(1), maxStallMs: +maxMs.toFixed(0), jumpPct: +(jump / n * 100).toFixed(1), extrapPct: +(ex / n * 100).toFixed(1), errPx: { p95: +q(errs, 0.95).toFixed(2), p99: +q(errs, 0.99).toFixed(2), max: +Math.max(0, ...errs).toFixed(1), over2Pct: +(errs.filter((x) => x > 2).length / Math.max(1, errs.length) * 100).toFixed(2) }, delays: c.delays, delayAvg: +((c.dSum ?? 0) / n).toFixed(2), over6Pct: +((c.dOver ?? 0) / n * 100).toFixed(1),
    react: { n: c.trials.length, mean: +(c.trials.reduce((a, b) => a + b, 0) / Math.max(1, c.trials.length)).toFixed(0), p50: +q(c.trials, 0.5).toFixed(0), p95: +q(c.trials, 0.95).toFixed(0), frames50: +(q(c.trials, 0.5) / FR).toFixed(1) },
    arrGap: { p50: +q(arr, 0.5).toFixed(1), p95: +q(arr, 0.95).toFixed(1), p99: +q(arr, 0.99).toFixed(1), max: +Math.max(...arr).toFixed(0), over50: arr.filter((x) => x > 50).length },
    bytesPerSec: +((c.bytes - c.snapBytes0) / span).toFixed(0), msgsPerSec: +((c.msgs - c.snapMsg0) / span).toFixed(1), avgMsgB: +((c.bytes - c.snapBytes0) / (c.msgs - c.snapMsg0)).toFixed(0), wireDownPerSec: +((c.proxy.stats.down - c.wire0) / span).toFixed(0), errs: c.errs.slice(0, 5), closed: c.closed });
}
const txt = JSON.stringify({ label, ver, hz: Number(process.env.BENCH_HZ ?? 60), precise: !!process.env.BENCH_PRECISE, variants: VARIANTS.map((V) => ({ name: V.name, prof: V.prof ?? null })), out });
fs.writeFileSync(path.join(HERE, `result_${label}.json`), txt);
console.log(txt);
for (const c of clients) { try { c.ws.close(); } catch { /* ignore */ } try { c.proxy.stop(); } catch { /* 이미 닫음 */ } }
srv.kill();
setTimeout(() => process.exit(0), 300);
