// 측정 전용(analysis/51): 임시 서버(별도 프로세스, 기본 포트 3400, DB_PATH=:memory:, 임시 경로)를 띄우고
// Node WebSocket 클라이언트로 방 종류별 경기를 동시에 돌려 메시지 종류별 바이트·개수·도착 간격을 센다. 서버 코드는 건드리지 않는다.
// 사용: node tools/traffic_ws_measure.mjs --out <디렉터리> [--port 3400] [--cap 240] [--only a,b]
//  산출: <out>/summary.json, <out>/<시나리오>.snaps.jsonl(좌석 0 이 받은 snap 원문, 한 줄 = {r:수신ms, s:원문})
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', 3400));
const CAP_S = Number(arg('cap', 240));
const OUT = path.resolve(arg('out', path.join(tmpdir(), 'traffic51')));
const ONLY = arg('only', '')?.split(',').filter(Boolean);
if ([3000, 3300, 3410, 8765, 3399, 3397, 3398, 3401].includes(PORT)) throw new Error('금지 포트');
mkdirSync(OUT, { recursive: true });

// ---------- 임시 서버 ----------
export function startServer(port = PORT) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'traffic51-srv-'));
  const env = {
    ...process.env, PORT: String(port), DB_PATH: ':memory:',
    PROGRESS_PATH: path.join(tmp, 'progress.json'), LEAGUE_PATH: path.join(tmp, 'league.json'),
    RESULTS_DIR: path.join(tmp, 'results'), RESULTS_PATH: path.join(tmp, 'results.jsonl'),
    JSON_BACKUP_DIR: path.join(tmp, 'backup'), NOTICE_PATH: path.join(tmp, 'notices.jsonl'),
    MAX_HELLO_PER_MIN: '600', MAX_AUTH_PER_MIN: '100', MAX_CONN_PER_IP: '400', // 한 IP(루프백)에서 많은 클라이언트를 띄우기 위한 측정용 상한(서버 코드는 그대로, 환경변수만)
  };
  const ch = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
  let errBuf = '';
  ch.stderr.on('data', (d) => { errBuf += d; });
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('server start timeout ' + errBuf)), 15000);
    ch.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(to); res({ ch, tmp, stop: () => ch.kill() }); } });
    ch.on('exit', (c) => rej(new Error('server exit ' + c + ' ' + errBuf)));
  });
}

// ---------- 계측 클라이언트 ----------
const frameHdr = (n, masked) => (n < 126 ? 2 : n < 65536 ? 4 : 10) + (masked ? 4 : 0);
export function client(name, opts = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${opts.port ?? PORT}/ws`);
  const st = { name, recv: {}, sent: {}, pings: 0, snapT: [], snapF: [], snapLen: [] };
  const add = (tab, t, n, masked) => { const e = tab[t] ?? (tab[t] = { n: 0, bytes: 0, wire: 0 }); e.n++; e.bytes += n; e.wire += n + frameHdr(n, masked); };
  const q = [], waiters = [], subs = [];
  ws.on('ping', () => { st.pings++; add(st.recv, '_ws_ping', 0, false); add(st.sent, '_ws_pong', 0, true); });
  ws.on('message', (raw) => {
    const now = performance.now();
    const str = raw.toString('utf8');
    const len = Buffer.byteLength(str);
    let m; try { m = JSON.parse(str); } catch { return; }
    add(st.recv, m.t, len, false);
    if (m.t === 'snap') { st.snapT.push(now); st.snapF.push(m.f); st.snapLen.push(len); opts.onSnap?.(m, str, now); }
    for (const f of subs) f(m, now);
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].res(m); else if (m.t !== 'snap') { q.push(m); if (q.length > 200) q.shift(); }
  });
  const open = new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  return {
    ws, st, open, sub: (f) => subs.push(f),
    send(o) { if (ws.readyState !== 1) return; const s = JSON.stringify(o); add(st.sent, o.t, Buffer.byteLength(s), true); ws.send(s); },
    wait(pred, ms = 8000) {
      const i = q.findIndex(pred);
      if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]);
      return new Promise((res, rej) => { const w = { pred, res }; waiters.push(w); setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); rej(new Error(name + ' timeout')); } }, ms).unref(); });
    },
    type(t, ms) { return this.wait((m) => m.t === t, ms); },
    close() { try { ws.close(); } catch { /* */ } },
  };
}

// ---------- 입력 봇 (public/js/game/input.js InputSender 와 같은 전송 규칙: 바뀌면 즉시, 눌린 채면 250ms 마다 재전송) ----------
const B = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, B: 16, C: 32, A: 64, S: 128 };
export function bot(c, seat, rnd = Math.random) {
  let bits = 0, lastSent = 0, snap = null, plan = [], busyUntil = 0, stopped = false;
  const set = (b) => { if (b !== bits) { bits = b; lastSent = performance.now(); c.send({ t: 'input', bits }); } };
  c.sub((m) => { if (m.t === 'snap') snap = m; if (m.t === 'game_end') stopped = true; });
  const fwd = seat === 0 ? B.RIGHT : B.LEFT;
  const timer = setInterval(() => {
    const now = performance.now();
    if (stopped) { clearInterval(timer); return; }
    if (bits && now - lastSent >= 245) { lastSent = now; c.send({ t: 'input', bits }); }
    while (plan.length && plan[0].at <= now) set(plan.shift().bits);
    if (plan.length || now < busyUntil || !snap) return;
    if (snap.ph !== 'play') { set(0); busyUntil = now + 100; return; }
    const pid = snap.ctrl[seat], b = snap.b, mine = b[3] === 0 && b[4] === pid;
    const at = (dt, x) => plan.push({ at: now + dt, bits: x });
    if (mine) {
      if (rnd() < 0.35) { at(0, B.C); at(90, B.C | B.B); at(90 + 230, 0); } // 점프 + B 14f 홀드 후 뗌 = 필살 시도
      else { const d = fwd | (rnd() < 0.3 ? B.UP : rnd() < 0.3 ? B.DOWN : 0); at(0, d); at(60, d | B.B); at(60 + 120 + rnd() * 200, d); at(500, 0); }
      busyUntil = now + 700;
    } else if (b[3] === 1 && rnd() < 0.6) { at(0, B.B); at(220, 0); busyUntil = now + 300; } // 날아오는 공: 캐치 자세
    else {
      const dirs = [0, B.UP, B.DOWN, B.LEFT, B.RIGHT, B.UP | B.RIGHT, B.DOWN | B.LEFT, B.UP | B.LEFT, B.DOWN | B.RIGHT];
      const d = dirs[Math.floor(rnd() * dirs.length)] | (b[3] === 3 && rnd() < 0.4 ? B.A : 0);
      at(0, d); busyUntil = now + 150 + rnd() * 450;
    }
  }, 50);
  return { stop() { stopped = true; clearInterval(timer); } };
}

// ---------- 시나리오 ----------
let nickSeq = 0;
const nick = (p) => `${p}${(++nickSeq).toString().padStart(3, '0')}`;
async function hello(c, n) { await c.open; c.send({ t: 'hello', nickname: n }); await c.type('welcome'); }

const SCEN = {
  async cpu() { // 컴퓨터 대전(일반 방, 레벨 2, 기본 규칙 knockout 5분)
    const a = client('cpu.s0'); await hello(a, nick('cpu'));
    a.send({ t: 'create_room', vsCpu: true, cpuLevel: 2 }); await a.type('room_joined');
    a.send({ t: 'start' }); return { clients: [a], seats: [a, null] };
  },
  async pvp() { // 사람 대 사람 일반 방(손님 2명, 필살 추적 규칙 자동 적용)
    const a = client('pvp.s0'), b = client('pvp.s1');
    await hello(a, nick('pa')); await hello(b, nick('pb'));
    a.send({ t: 'create_room' }); const j = await a.type('room_joined');
    b.send({ t: 'join_room', code: j.room.code }); await b.type('room_joined');
    b.send({ t: 'ready', ready: true }); await a.wait((m) => m.t === 'room_state' && m.room.start?.ok);
    a.send({ t: 'start' }); return { clients: [a, b], seats: [a, b] };
  },
  async ladder() { // 래더(계정 2명. 현재 트리는 손님 ladder_join 을 ACCOUNT_REQUIRED 로 거절)
    const a = client('ladder.s?a'), b = client('ladder.s?b');
    await a.open; await b.open;
    a.send({ t: 'register', nickname: nick('la'), password: 'pw123456' }); await a.type('welcome');
    b.send({ t: 'register', nickname: nick('lb'), password: 'pw123456' }); await b.type('welcome');
    a.send({ t: 'ladder_join' }); b.send({ t: 'ladder_join' });
    const ma = await a.type('ladder_matched', 15000), mb = await b.type('ladder_matched', 15000);
    const s0 = ma.you === 0 ? a : b, s1 = ma.you === 0 ? b : a;
    s0.st.name = 'ladder.s0'; s1.st.name = 'ladder.s1';
    s1.send({ t: 'ready', ready: true }); await s0.wait((m) => m.t === 'room_state' && m.room.start?.ok);
    s0.send({ t: 'start' }); void mb; return { clients: [a, b], seats: [s0, s1] };
  },
  async campaign() { // 스토리 1경기
    const a = client('campaign.s0'); await hello(a, nick('cm'));
    a.send({ t: 'campaign_list' }); await a.type('campaign_list');
    a.send({ t: 'campaign_start', k: 0 }); return { clients: [a], seats: [a, null] };
  },
  async train_catch() {
    const a = client('train_catch.s0'); await hello(a, nick('tc'));
    a.send({ t: 'training_start', kind: 'catch' }); return { clients: [a], seats: [a, null] };
  },
  async train_special() {
    const a = client('train_special.s0'); await hello(a, nick('ts'));
    a.send({ t: 'training_start', kind: 'special' }); return { clients: [a], seats: [a, null] };
  },
  async league() {
    const a = client('league.s0'); await hello(a, nick('lg'));
    a.send({ t: 'league_new', teams: [{ team: 0, com: false }, { team: 1 }, { team: 2 }], turns: 1 }); await a.type('league_state');
    a.send({ t: 'league_play', i: 0, j: 1 }); return { clients: [a], seats: [a, null] };
  },
  async flame() {
    const a = client('flame.s0'); await hello(a, nick('fl'));
    a.send({ t: 'flame_catalog' }); await a.type('flame_catalog').catch(() => null);
    a.send({ t: 'flame_new' }); await a.type('flame_state');
    a.send({ t: 'flame_choose', i: 0 }); const st = await a.type('flame_state');
    a.send({ t: 'flame_node', id: st.run.candidates[0] }); return { clients: [a], seats: [a, null] };
  },
};

async function runScenario(name) {
  const t0 = performance.now();
  const { clients, seats } = await SCEN[name]();
  const file = createWriteStream(path.join(OUT, `${name}.snaps.jsonl`));
  let firstSnapT = null;
  seats[0].sub((m) => { if (m.t === 'game_start') writeFileSync(path.join(OUT, `${name}.game_start.json`), JSON.stringify(m)); });
  // 좌석 0 의 snap 원문 기록(오프라인 재계산용)
  const origOn = seats[0].ws.listeners('message')[0];
  seats[0].ws.on('message', (raw) => { const s = raw.toString('utf8'); if (s.startsWith('{"t":"snap"')) { const r = performance.now(); firstSnapT ??= r; file.write(JSON.stringify({ r: +(r - firstSnapT).toFixed(2), s }) + '\n'); } });
  void origOn;
  const bots = seats.map((c, i) => (c ? bot(c, i) : null));
  const endP = Promise.all(seats.filter(Boolean).map((c) => c.type('game_end', CAP_S * 1000).catch(() => null)));
  const res = await endP;
  let forced = false;
  if (res.some((r) => !r)) { // 상한까지 안 끝났으면 기권으로 끝낸다(종료 메시지량까지 센다)
    forced = true;
    if (name.startsWith('train')) seats[0].send({ t: 'training_quit' }); else seats[0].send({ t: 'leave_room' });
    await Promise.all(seats.filter(Boolean).map((c) => c.type('game_end', 5000).catch(() => null)));
  }
  bots.forEach((b) => b?.stop());
  await new Promise((r) => setTimeout(r, 1500)); // 종료 뒤 room_state·결과·room_left 까지 받기
  file.end();
  const dur = (performance.now() - t0) / 1000;
  const out = { name, durS: +dur.toFixed(1), forced, end: res.map((r) => (r ? { reason: r.reason, ticks: r.ticks } : null)), seats: clients.map((c) => summarize(c.st)) };
  clients.forEach((c) => c.close());
  return out;
}

const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
function summarize(st) {
  const gaps = st.snapT.slice(1).map((t, i) => t - st.snapT[i]);
  const fGaps = st.snapF.slice(1).map((f, i) => f - st.snapF[i]);
  const span = st.snapT.length > 1 ? (st.snapT.at(-1) - st.snapT[0]) / 1000 : 0;
  const snapBytes = st.snapLen.reduce((a, b) => a + b, 0);
  return {
    name: st.name, recv: st.recv, sent: st.sent, pings: st.pings,
    snap: { n: st.snapT.length, spanS: +span.toFixed(2), perSec: span ? +(st.snapT.length / span).toFixed(2) : 0, bytesPerSec: span ? Math.round(snapBytes / span) : 0,
      avgLen: st.snapLen.length ? Math.round(snapBytes / st.snapLen.length) : 0, minLen: Math.min(...st.snapLen), maxLen: Math.max(...st.snapLen),
      gapMs: { p50: pct(gaps, 50), p95: pct(gaps, 95), p99: pct(gaps, 99), max: gaps.length ? Math.max(...gaps) : null, zeroish: gaps.filter((g) => g < 2).length },
      fGap: { gt1: fGaps.filter((g) => g > 1).length } },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const srv = await startServer();
  console.log('server up', PORT, srv.tmp);
  try {
    const names = ONLY.length ? ONLY : Object.keys(SCEN);
    const results = await Promise.all(names.map((n) => runScenario(n).catch((e) => ({ name: n, error: String(e?.stack ?? e) }))));
    // /health 로 마지막 상태 확인
    const health = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json()).catch(() => null);
    writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), port: PORT, capS: CAP_S, health, results }, null, 1));
    for (const r of results) console.log(r.name, r.error ?? `${r.durS}s forced=${r.forced} ` + r.seats.map((s) => `${s.name}: snap ${s.snap.n} ${s.snap.perSec}/s ${s.snap.bytesPerSec}B/s avg ${s.snap.avgLen}B input ${s.sent.input?.n ?? 0}`).join(' | '));
  } finally { srv.stop(); }
}
