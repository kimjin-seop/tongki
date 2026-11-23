import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { BotGuard, loadBotguardConfig, mechanicalInput, headerSignals } from '../server/net/botguard.js';
import { openWs } from './ws_util.js';

const MIN = 60000, DAY = 24 * 60 * MIN;
const mk = (over = {}) => { let t = 1e12; const g = new BotGuard(loadBotguardConfig({}, over), { now: () => t, log: () => {} }); return { g, adv: (ms) => { t += ms; } }; };
const BROWSER = { origin: 'https://ok.test', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', 'accept-language': 'ko-KR', 'sec-websocket-extensions': 'permessage-deflate' };

test('botguard: 점수 누적 -> 임계 초과 차단 -> 시간 경과 해제, 반복 시 2배, 허용 IP 면제', () => {
  const { g, adv } = mk();
  const bot = { 'user-agent': 'python-requests/2.31' }; // 도구 UA + Origin·언어·확장 없음 = 60점
  assert.equal(headerSignals(bot).score, 60);
  assert.equal(headerSignals(BROWSER).score, 0);
  assert.deepEqual(g.checkUpgrade('9.9.9.9', bot), { ok: true }); // 60
  assert.deepEqual(g.checkUpgrade('9.9.9.9', bot), { ok: true }); // 120 > 100 -> 차단(판정은 hello 단계 bgGate)
  assert.equal(g.blocked('9.9.9.9'), true);
  assert.equal(g.blocked('8.8.8.8'), false);
  assert.deepEqual(g.summary(), { enabled: true, blockedIps: 1, blockedNicks: 0, reasons: { fingerprint: 2 } });
  adv(31 * MIN);
  assert.equal(g.blocked('9.9.9.9'), false); // 30분 뒤 해제
  g.checkUpgrade('9.9.9.9', bot); g.checkUpgrade('9.9.9.9', bot);
  assert.equal(g.blocked('9.9.9.9'), true);
  adv(31 * MIN);
  assert.equal(g.blocked('9.9.9.9'), true); // 두 번째는 60분
  adv(30 * MIN);
  assert.equal(g.blocked('9.9.9.9'), false);
  for (let i = 0; i < 5; i++) assert.deepEqual(g.checkUpgrade('127.0.0.1', bot), { ok: true }); // 허용 IP 는 검사·차단 없음
  assert.equal(g.blocked('::ffff:127.0.0.1'), false);
  // 감쇠: 60점 뒤 40분 지나면 20점 -> 60 더해도 80(차단 안 됨)
  g.checkUpgrade('7.7.7.7', bot); adv(40 * MIN);
  assert.deepEqual(g.checkUpgrade('7.7.7.7', bot), { ok: true });
  assert.equal(g.blocked('7.7.7.7'), false);
  assert.equal(headerSignals({ ...BROWSER, 'sec-websocket-extensions': undefined }).score, 0); // 확장 없음 하나뿐 = 0점
});

test('botguard: Origin 거절 점수는 IP 당 1분 1회, 시계 역행에도 점수 음수·폭증 없음, sweep 정리', () => {
  const { g, adv } = mk({ allowedOrigins: ['https://ok.test'] });
  for (let i = 0; i < 20; i++) assert.equal(g.checkUpgrade('4.4.4.4', { ...BROWSER, origin: 'https://evil.test' }).ok, false); // 0.5초 재연결 반복
  assert.equal(g.reasons.origin, 1);
  assert.equal(g.blocked('4.4.4.4'), false);
  adv(-10 * MIN); // 시계 역행
  g.add('ip:4.4.4.4', 1, 'test');
  assert.ok(g.ent.get('ip:4.4.4.4').score <= 26 && g.ent.get('ip:4.4.4.4').score >= 25);
  adv(10 * MIN + 2 * DAY);
  g.sweep();
  assert.equal(g.ent.size, 0);
});

test('net.js: 거절(close 1008)이면 재연결을 1분 이상 늦추고 1회 알림, welcome 뒤에만 간격 초기화', async (t) => {
  const socks = [];
  globalThis.location = { protocol: 'http:', host: 'x' };
  globalThis.WebSocket = class { constructor() { socks.push(this); } };
  const delays = [];
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => { delays.push(ms); return 0; });
  try {
    const { Net } = await import('../public/js/net.js');
    const n = new Net(); let notes = 0;
    n.on('rejected', () => notes++);
    n.connect(); socks.at(-1).onopen(); socks.at(-1).onclose({ code: 1008, reason: 'RATE_LIMITED' });
    n.connect(); socks.at(-1).onopen(); socks.at(-1).onclose({ code: 1008, reason: '' });
    assert.ok(delays[0] >= 60000 && delays[1] > delays[0], String(delays));
    assert.equal(notes, 1);
    n.connect(); socks.at(-1).onopen(); socks.at(-1).onclose({ code: 1006 }); // 열려도 welcome 전이면 간격 유지
    assert.ok(delays[2] >= 60000);
    n.connect(); socks.at(-1).onopen(); n._recv({ t: 'welcome', token: 'tk' }); socks.at(-1).onclose({ code: 1006 });
    assert.equal(delays[3], 500);
  } finally { delete globalThis.WebSocket; delete globalThis.location; }
});

test('botguard: Origin 검사 켬(ALLOWED_ORIGINS) 허용·거절, 다계정 상한', () => {
  const { g } = mk({ allowedOrigins: ['https://ok.test'] });
  assert.deepEqual(g.checkUpgrade('1.1.1.1', BROWSER), { ok: true });
  assert.deepEqual(g.checkUpgrade('1.1.1.1', { ...BROWSER, origin: 'https://ok.test/' }), { ok: true });
  assert.deepEqual(g.checkUpgrade('1.1.1.1', { ...BROWSER, origin: 'https://evil.test' }), { ok: false, why: 'origin' });
  assert.deepEqual(g.checkUpgrade('1.1.1.2', { ...BROWSER, origin: undefined }), { ok: false, why: 'origin' });
  const { g: m } = mk({ nicksPer10Min: 3 });
  for (let i = 0; i < 3; i++) m.noteNick('2.2.2.2', `n${i}`, false);
  m.noteNick('2.2.2.2', 'n0', false); // 같은 닉네임 재접속은 세지 않음
  assert.equal(m.summary().reasons.multi_account, undefined);
  for (let i = 3; i < 9; i++) m.noteNick('2.2.2.2', `n${i}`, false); // 상한 넘는 6개 x 20점 = 120
  assert.equal(m.blocked('2.2.2.2'), true);
});

test('botguard: 기계적 입력 판정(순수 함수) — 사람 분포 통과, 상수·틱 주기 봇 걸림', () => {
  let x = 12345; const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const human = Array.from({ length: 300 }, () => 40 + Math.round(-Math.log(1 - rnd()) * 180)); // 지수 분포 반응 간격
  assert.equal(mechanicalInput(human).suspect, false);
  const jitter = Array.from({ length: 300 }, () => 100 + Math.round((rnd() - 0.5) * 6)); // 100ms ± 3ms
  assert.equal(mechanicalInput(jitter).suspect, true);
  const periodic = Array.from({ length: 300 }, (_, i) => (i % 10 === 0 ? 400 : 50 + (rnd() < 0.5 ? 0 : 3))); // 대부분 같은 틱 칸
  assert.equal(mechanicalInput(periodic).suspect, true);
  assert.equal(mechanicalInput(jitter.slice(0, 100)).suspect, false); // 표본 부족
  // 계정 키는 그대로 70, IP 는 계정이면 35: 두 번 걸리면 계정 차단
  const { g } = mk();
  g.noteMechanical('3.3.3.3', 'botnick', true, jitter);
  const r = g.noteMechanical('3.3.3.3', 'botnick', true, jitter);
  assert.equal(r.blocked, true);
  assert.equal(g.blocked(null, 'botnick'), true);
  assert.equal(g.blocked('3.3.3.3'), false);
  assert.equal(g.noteMechanical('3.3.3.4', 'person', true, human).blocked, false);
});

test('botguard: 서버 — 차단 IP 새 접속 RATE_LIMITED+1008, Origin 거절 1008, /health 요약(IP 없음)', async () => {
  const app = createServer({ store: new MemoryResultStore(), log: () => {}, botguardCfg: { allowIps: [], allowedOrigins: ['http://ok.test'] } });
  const port = await app.listen(0);
  const open = (headers) => new Promise((res) => {
    const ws = openWs(port, { headers });
    const got = [];
    ws.on('message', (m) => got.push(JSON.parse(m.toString())));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', nickname: '시험손님' })));
    ws.on('close', (code) => res({ code, got }));
    setTimeout(() => ws.close(), 500).unref();
  });
  try {
    const ok = await open({ origin: 'http://ok.test', 'user-agent': 'Mozilla/5.0', 'accept-language': 'ko' });
    assert.ok(ok.got.some((m) => m.t === 'welcome'));
    const bad = await open({ origin: 'http://evil.test' });
    assert.equal(bad.code, 1008);
    assert.ok(!bad.got.some((m) => m.t === 'welcome'));
    app.botguard.add('ip:127.0.0.1', 500, 'test');
    const blk = await open({ origin: 'http://ok.test' });
    assert.equal(blk.code, 1008);
    assert.equal(blk.got[0]?.code, 'RATE_LIMITED');
    const h = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(h.botguard.blockedIps, 1);
    assert.ok(!JSON.stringify(h).includes('127.0.0.1'));
  } finally { await app.close(); }
});

test('botguard: 서버 — 차단 IP 라도 경기 중 세션은 재접속(hello token) 통과, 같은 IP 신규 hello 는 RATE_LIMITED', async () => {
  const app = createServer({ store: new MemoryResultStore(), log: () => {}, botguardCfg: { allowIps: [] } });
  const port = await app.listen(0);
  const cl = () => {
    const ws = openWs(port);
    const q = [], ws8 = []; let closed = null;
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); const i = ws8.findIndex((w) => w.p(m)); if (i >= 0) ws8.splice(i, 1)[0].r(m); else q.push(m); });
    ws.on('close', (code) => { closed = code; });
    return { ws, open: new Promise((r) => ws.on('open', r)), send: (o) => ws.send(JSON.stringify(o)), closed: () => closed,
      type: (t) => { const i = q.findIndex((m) => m.t === t); if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]); return new Promise((r, j) => { ws8.push({ p: (m) => m.t === t, r }); setTimeout(() => j(new Error('timeout ' + t)), 3000).unref(); }); } };
  };
  try {
    const a = cl(); await a.open;
    a.send({ t: 'hello', nickname: '경기중' }); const wa = await a.type('welcome');
    a.send({ t: 'campaign_start', k: 0 }); await a.type('game_start');
    app.botguard.add('ip:127.0.0.1', 500, 'test');
    a.ws.close(); await new Promise((r) => setTimeout(r, 50));
    const a2 = cl(); await a2.open;
    a2.send({ t: 'hello', token: wa.token });
    assert.equal((await a2.type('welcome')).location, 'game');
    const b = cl(); await b.open;
    b.send({ t: 'hello', nickname: '신규' });
    assert.equal((await b.type('error')).code, 'RATE_LIMITED');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(b.closed(), 1008);
  } finally { await app.close(); }
});
