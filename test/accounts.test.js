import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { openDb } from '../server/store/db.js';
import { hashPassword, checkPassword } from '../server/store/accounts.js';
import { importJson } from '../server/store/migrate.js';
import { RankingStore } from '../server/store/ranking.js';
import { eloAfter } from '../server/ranking/elo.js';

function client(port, ip) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ip ? { headers: { 'x-forwarded-for': ip } } : undefined);
  const q = [], waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].res(m); else q.push(m);
  });
  const open = new Promise((r) => ws.on('open', r));
  return {
    open, ws, send: (o) => ws.send(JSON.stringify(o)),
    wait(pred, ms = 5000) {
      const i = q.findIndex(pred);
      if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]);
      return new Promise((res, rej) => { waiters.push({ pred, res }); setTimeout(() => rej(new Error('timeout')), ms).unref(); });
    },
    type(t, ms) { return this.wait((m) => m.t === t, ms); },
    async err(m) { this.send(m); return (await this.type('error')).code; },
  };
}
const LIM = { maxAuthPerMin: 100, maxHelloPerMin: 1000 };

test('계정: 비밀번호 해시(솔트·평문 없음)·가입 후 닉네임 보호·로그인 실패 잠금·토큰 재로그인(재시작 뒤)', async () => {
  const h = await hashPassword('secret12');
  assert.ok(await checkPassword('secret12', h.hash, h.salt));
  assert.equal(await checkPassword('secret13', h.hash, h.salt), false);
  assert.notEqual((await hashPassword('secret12')).hash, h.hash); // 솔트가 달라 해시도 다르다

  const dir = mkdtempSync(path.join(tmpdir(), 'acct-'));
  const dbPath = path.join(dir, 't.db');
  let app = createServer({ store: new MemoryResultStore(), dbPath, limits: LIM, log: () => {} });
  let port = await app.listen(0);
  const a = client(port), b = client(port);
  await Promise.all([a.open, b.open]);
  let token;
  try {
    assert.equal(await a.err({ t: 'register', nickname: '가입자', password: '123' }), 'PASSWORD_INVALID');
    a.send({ t: 'register', nickname: '가입자', password: 'pass1234' });
    const w = await a.type('welcome');
    assert.equal(w.account, true); assert.equal(w.nickname, '가입자');
    token = w.token;
    const row = app.db.get('SELECT pw_hash, pw_salt FROM accounts WHERE key = ?', '가입자');
    assert.ok(row.pw_hash && !row.pw_hash.includes('pass1234'));
    assert.equal(app.db.get('SELECT COUNT(*) AS n FROM auth_tokens WHERE token_hash = ?', token).n, 0); // 토큰 원문은 저장하지 않는다

    assert.equal(await b.err({ t: 'hello', nickname: '가입자' }), 'NICK_REGISTERED');    // 비밀번호 없이 사용 불가
    assert.equal(await b.err({ t: 'register', nickname: '가입자', password: 'xxxxxx' }), 'ACCOUNT_EXISTS');
    for (let i = 0; i < 5; i++) assert.equal(await b.err({ t: 'login', nickname: '가입자', password: 'wrong!!' }), 'LOGIN_FAILED');
    assert.equal(await b.err({ t: 'login', nickname: '가입자', password: 'pass1234' }), 'LOGIN_LOCKED'); // 5회 실패 뒤엔 맞아도 잠김
    assert.equal(await b.err({ t: 'login', nickname: '없는이름', password: 'pass1234' }), 'LOGIN_FAILED');
  } finally { a.ws.close(); b.ws.close(); await app.close(); }

  // 재시작: 메모리 세션은 사라졌지만 로그인 토큰(DB 해시)으로 다시 들어온다. 비밀번호 로그인도 된다(잠금은 메모리)
  app = createServer({ store: new MemoryResultStore(), dbPath, limits: LIM, log: () => {} });
  port = await app.listen(0);
  const c = client(port), d = client(port);
  await Promise.all([c.open, d.open]);
  try {
    c.send({ t: 'hello', token });
    const w2 = await c.type('welcome');
    assert.equal(w2.account, true); assert.equal(w2.nickname, '가입자');
    d.send({ t: 'login', nickname: '가입자', password: 'pass1234' });
    const w3 = await d.type('welcome');
    assert.equal(w3.resumed, true); // 같은 계정 세션을 넘겨받는다
    assert.equal((await c.type('error')).code, 'SESSION_REPLACED');
  } finally { c.ws.close(); d.ws.close(); await app.close(); }
});

test('JSON -> SQLite 가져오기: 멱등·원본 보존·백업 사본, 손님 진행은 같은 닉네임 가입자가 승계', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mig-'));
  const pf = path.join(dir, 'progress.json'), lf = path.join(dir, 'league.json');
  const pj = JSON.stringify({ version: 1, users: { 손님: { nick: '손님', clearedMax: 4, last: 4, updatedAt: 1 }, 버림: { nick: '버림', clearedMax: -1 } } });
  writeFileSync(pf, pj);
  const lg = { id: 'x', teams: [{ team: 0, com: true }, { team: 1, com: true }], turns: 1, rules: { mode: 'knockout', time: 0 }, res: [[[0, 0], [0, 0]], [[0, 0], [0, 0]]], done: false, createdAt: 1, updatedAt: 1 };
  writeFileSync(lf, JSON.stringify({ version: 1, users: { 손님: { nick: '손님', league: lg, updatedAt: 1 } } }));
  const dbPath = path.join(dir, 't.db'), backupDir = path.join(dir, 'backup');
  const db = openDb(dbPath);
  assert.deepEqual(importJson(db, { progressFile: pf, leagueFile: lf, backupDir, log: () => {} }), { progress: 1, leagues: 1, skipped: [] });
  assert.deepEqual(importJson(db, { progressFile: pf, leagueFile: lf, backupDir, log: () => {} }), { progress: 0, leagues: 0, skipped: ['progress', 'league'] });
  db.run('DELETE FROM meta'); // 표식이 없어져도 중복·덮어쓰기 없음
  assert.deepEqual(importJson(db, { progressFile: pf, leagueFile: lf, log: () => {} }), { progress: 0, leagues: 0, skipped: [] });
  assert.equal(db.get('SELECT COUNT(*) AS n FROM progress').n, 1);
  assert.equal(readFileSync(pf, 'utf8'), pj); // 원본 그대로
  assert.ok(existsSync(path.join(backupDir, 'progress.json')) && existsSync(path.join(backupDir, 'league.json')));
  // 가져온 뒤 옛 JSON 서버가 파일을 더 썼으면(크기·시각 변경) 다시 합친다: 더 높은 clearedMax 만 반영
  writeFileSync(pf, JSON.stringify({ version: 1, users: { 손님: { nick: '손님', clearedMax: 3, last: 3, updatedAt: 2 }, 새손님: { nick: '새손님', clearedMax: 0, last: 0, updatedAt: 2 } } }));
  assert.equal(importJson(db, { progressFile: pf, log: () => {} }).progress, 1); // 새손님만(손님 4 > 3 유지)
  assert.equal(db.get('SELECT cleared_max FROM progress WHERE key = ?', '손님').cleared_max, 4);
  // 한 번 가져온 키는 DB 에서 지워진 뒤(리그 포기) JSON 이 바뀌어 다시 가져와도 부활하지 않는다
  db.run('DELETE FROM leagues WHERE key = ?', '손님');
  writeFileSync(lf, JSON.stringify({ version: 1, users: { 손님: { nick: '손님', league: { ...lg, updatedAt: 9 }, updatedAt: 9 } } }));
  assert.equal(importJson(db, { leagueFile: lf, log: () => {} }).leagues, 0);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM leagues').n, 0);
  writeFileSync(lf, JSON.stringify({ version: 1, users: { 손님: { nick: '손님', league: lg, updatedAt: 1 } } })); // 아래 승계 확인용으로 되돌림
  db.run("DELETE FROM meta WHERE k = 'json_imported:league:손님'");
  assert.equal(importJson(db, { leagueFile: lf, log: () => {} }).leagues, 1);
  db.close();

  const app = createServer({ store: new MemoryResultStore(), dbPath, importJson: false, limits: LIM, log: () => {} });
  const port = await app.listen(0);
  const a = client(port);
  await a.open;
  try {
    a.send({ t: 'hello', nickname: '손님' }); await a.type('welcome');
    a.send({ t: 'register', nickname: '손님', password: 'guest123' }); // 접속 중인 손님 세션을 계정으로 올린다
    assert.equal((await a.type('account_ok')).nickname, '손님');
    a.send({ t: 'campaign_list' });
    assert.equal((await a.type('campaign_list')).progress.clearedMax, 4);
    a.send({ t: 'league_get' });
    assert.equal((await a.type('league_state')).league.id, 'x');
  } finally { a.ws.close(); await app.close(); }
});

test('랭킹: Elo +16/-16(배치 +24/-24)·랭크 방(계정 필수·규칙 고정)·정상 종료/기권 반영·GO 이전 무효·순위표·기권 잠금', async () => {
  assert.deepEqual(eloAfter({ rating: 1000, games: 10 }, { rating: 1000, games: 10 }, true), [1016, 984]);
  assert.deepEqual(eloAfter({ rating: 1000, games: 0 }, { rating: 1000, games: 0 }, true), [1024, 976]);
  assert.deepEqual(eloAfter({ rating: 100, games: 20 }, { rating: 100, games: 20 }, false), [100, 116]); // 진 쪽 84 -> 하한 100

  const store = new MemoryResultStore();
  const app = createServer({ store, limits: LIM, log: () => {} });
  const port = await app.listen(0);
  const a = client(port), b = client(port), g = client(port);
  await Promise.all([a.open, b.open, g.open]);
  try {
    a.send({ t: 'register', nickname: '랭커A', password: 'aaaaaa' }); await a.type('welcome');
    b.send({ t: 'register', nickname: '랭커B', password: 'bbbbbb' }); await b.type('welcome');
    g.send({ t: 'hello', nickname: '손님G' }); await g.type('welcome');
    assert.equal(await g.err({ t: 'create_room', ranked: true }), 'ACCOUNT_REQUIRED');
    assert.equal(await a.err({ t: 'create_room', ranked: true, rules: { mode: 'official', time: 3 } }), 'RANKED_RULES_FIXED');
    a.send({ t: 'create_room', ranked: true });
    const rj = await a.type('room_joined');
    assert.equal(rj.room.ranked, true); assert.deepEqual(rj.room.rules, { mode: 'knockout', time: 5 });
    g.send({ t: 'list_rooms' });
    assert.equal((await g.wait((m) => m.t === 'room_list' && m.rooms.length === 1)).rooms[0].ranked, true);
    assert.equal(await g.err({ t: 'join_room', code: rj.room.code }), 'ACCOUNT_REQUIRED');
    assert.equal(await a.err({ t: 'set_rules', rules: { time: 3 } }), 'RANKED_RULES_FIXED');
    b.send({ t: 'join_room', code: rj.room.code }); await b.type('room_joined');
    const room = app.lobby.rooms.get(rj.room.code);
    const play = async () => {
      b.send({ t: 'ready', ready: true });
      await a.wait((m) => m.t === 'room_state' && m.room.start.ok);
      a.send({ t: 'start' });
      await a.type('game_start'); await b.type('game_start');
    };

    // 1) 정상 종료(GO 이후): 배치 구간 +24/-24
    await play();
    room.game.match.phase = 'play'; room.game.finish(0, 'annihilation');
    const r1a = await a.type('ranking_result'), r1b = await b.type('ranking_result');
    assert.deepEqual([r1a.counted, r1a.before, r1a.after, r1a.delta, r1a.oppBefore], [true, 1000, 1024, 24, 1000]);
    assert.equal(r1b.delta, -24);
    const rec = store.records.at(-1);
    assert.equal(rec.ranked, true); assert.deepEqual(rec.ratingDelta, [24, -24]);

    // 2) GO 이전 퇴장 = 무효
    await play();
    b.send({ t: 'leave_room' });
    const r2 = await a.type('ranking_result');
    assert.equal(r2.counted, false); assert.equal(r2.why, 'VOID'); assert.equal(r2.delta, 0);
    assert.equal((await b.type('ranking_result')).why, 'VOID'); // 나간 쪽도 game_end 뒤에 받는다
    b.send({ t: 'join_room', code: rj.room.code }); await b.type('room_joined');

    // 3) GO 이후 퇴장 = 기권 패배 반영
    await play();
    room.game.match.phase = 'play';
    a.send({ t: 'leave_room' });
    const r3 = await b.type('ranking_result');
    assert.equal(r3.counted, true); assert.ok(r3.delta > 0);
    const ra = app.lobby.ranking.get('랭커a');
    assert.deepEqual([ra.w, ra.l, ra.games], [1, 1, 2]);

    // 순위표: 5경기 미만은 목록 제외, 내 줄은 배치 중
    a.send({ t: 'ranking_list' });
    const L = await a.type('ranking_list');
    assert.deepEqual(L.top, []);
    assert.equal(L.me.placement, true); assert.equal(L.me.rank, null); assert.equal(L.me.nick, '랭커A');
  } finally { a.ws.close(); b.ws.close(); g.ws.close(); await app.close(); }

  // 저장소 단위: 같은 상대 24시간 4번째는 미반영, 5경기 이상이면 순위표, 최근 10경기 중 기권 3회 = 30분 잠금
  const rs = new RankingStore(openDb(':memory:'));
  const P = [{ key: 'x', nick: 'X' }, { key: 'y', nick: 'Y' }];
  const T0 = 1e12;
  for (let i = 0; i < 3; i++) assert.equal(rs.record({ matchId: `m${i}`, players: P, winner: 0, now: T0 + i }).counted, true);
  const r4 = rs.record({ matchId: 'm3', players: P, winner: 0, now: T0 + 3 });
  assert.deepEqual([r4.counted, r4.why, r4.delta], [false, 'PAIR_LIMIT', [0, 0]]);
  for (let i = 0; i < 2; i++) rs.record({ matchId: `n${i}`, players: P, winner: 0, now: T0 + 86400001 + i });
  const bd = rs.board(50, 'y', 'Y');
  assert.deepEqual(bd.top.map((r) => [r.rank, r.nick, r.w, r.l]), [[1, 'X', 5, 0], [2, 'Y', 0, 5]]);
  assert.equal(bd.me.rank, 2);
  const T1 = T0 + 3 * 86400001;
  for (let i = 0; i < 3; i++) rs.record({ matchId: `f${i}`, players: P, winner: 0, forfeit: 1, now: T1 + i * 86400001 });
  assert.ok(rs.lockedUntil('y', T1 + 2 * 86400001 + 1) > 0);
  assert.equal(rs.lockedUntil('x', T1 + 2 * 86400001 + 1), 0);
});

test('로그인 실패 제한: 공격자 IP 의 실패 누적이 다른 IP(새 기기) 본인 로그인을 막지 않는다', async () => {
  const prev = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';
  const app = createServer({ store: new MemoryResultStore(), limits: { ...LIM, loginSlowStepMs: 20, loginSlowMaxMs: 100 }, log: () => {} });
  const port = await app.listen(0);
  const v = client(port, '10.0.0.1'), atk = client(port, '10.0.0.66'), v2 = client(port, '10.0.0.2');
  await Promise.all([v.open, atk.open, v2.open]);
  try {
    v.send({ t: 'register', nickname: '피해자', password: 'goodpass' }); await v.type('welcome');
    for (let i = 0; i < 5; i++) assert.equal(await atk.err({ t: 'login', nickname: '피해자', password: `wrong${i}` }), 'LOGIN_FAILED');
    assert.equal(await atk.err({ t: 'login', nickname: '피해자', password: 'goodpass' }), 'LOGIN_LOCKED'); // 공격자 (닉네임, IP) 쌍은 잠김
    v2.send({ t: 'login', nickname: '피해자', password: 'goodpass' });
    assert.equal((await v2.type('welcome')).account, true); // 다른 IP 는 (늦어질 수 있어도) 로그인된다
  } finally {
    if (prev === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = prev;
    v.ws.close(); atk.ws.close(); v2.ws.close(); await app.close();
  }
});

// 1단계 경로(로그인 전 연결에서 바로 register)만 검사한다. hello 로 끊긴 손님 닉네임을 먼저 잡은 뒤 register 하는 2단계 우회는
// 승계가 일어나며, 손님은 소유 증명이 없어 수용된 한계다(PROTOCOL §2.1 한계)
test('손님 닉네임 선점 방지: 접속 중이 아닌 손님 닉네임으로 가입하면 빈 진행으로 시작하고 손님 데이터는 따로 보존', async () => {
  const app = createServer({ store: new MemoryResultStore(), limits: LIM, graceMs: 50, log: () => {} });
  const port = await app.listen(0);
  const g = client(port), thief = client(port), g2 = client(port);
  await Promise.all([g.open, thief.open, g2.open]);
  try {
    g.send({ t: 'hello', nickname: '손님X' }); await g.type('welcome');
    app.lobby.progress.recordResult('손님x', '손님X', 5, true);
    g.ws.close(); await new Promise((r) => setTimeout(r, 120)); // 유예 만료
    thief.send({ t: 'register', nickname: '손님X'.normalize('NFD'), password: 'thief123' }); // 조합형(NFD) 입력도 같은 닉네임
    assert.equal((await thief.type('welcome')).nickname, '손님X');
    thief.send({ t: 'campaign_list' });
    assert.equal((await thief.type('campaign_list')).progress.clearedMax, -1); // 승계 없음
    const aside = app.db.all("SELECT key, cleared_max FROM progress WHERE key LIKE 'guest-aside:손님x:%'");
    assert.deepEqual(aside.map((r) => r.cleared_max), [5]); // 지우지 않고 계정이 못 읽는 키로 보존
    assert.equal(await g2.err({ t: 'hello', nickname: '손님X' }), 'NICK_REGISTERED'); // 원래 손님은 이 닉네임을 못 쓴다(PROTOCOL §2.1 한계)
  } finally { g.ws.close(); thief.ws.close(); g2.ws.close(); await app.close(); }
});

test('가입 경합: 해시 계산 중 같은 닉네임 손님 hello -> 손님 세션 종료·가입 연결은 재로그인 안내(토큰 미발급)', async () => {
  const app = createServer({ store: new MemoryResultStore(), limits: LIM, log: () => {} });
  const port = await app.listen(0);
  const a = client(port), g = client(port);
  await Promise.all([a.open, g.open]);
  try {
    a.send({ t: 'register', nickname: '경합Y', password: 'pass1234' });
    g.send({ t: 'hello', nickname: '경합Y' }); // scrypt 대기 중에 도착
    await g.type('welcome');
    assert.equal((await a.type('error')).code, 'ACCOUNT_CREATED_RELOGIN');
    await g.type('logged_out'); // 남은 손님 세션은 끝난다(계정 키에 기록을 쓰지 않게)
    assert.equal(app.lobby.byNick.get('경합y'), undefined);
    assert.equal(app.db.get('SELECT COUNT(*) AS n FROM auth_tokens').n, 0); // 고아 토큰 없음
    a.send({ t: 'login', nickname: '경합Y', password: 'pass1234' });
    assert.equal((await a.type('welcome')).account, true);
  } finally { a.ws.close(); g.ws.close(); await app.close(); }
});

test('로그아웃 뒤 로그인 타이머: 로그아웃 시점부터 다시 건다(연결 시점 타이머로 조기 종료되지 않고, 늦은 로그아웃도 무기한 남지 않음)', async () => {
  const app = createServer({ store: new MemoryResultStore(), limits: { ...LIM, loginTimeoutMs: 200, logoutLoginTimeoutMs: 400 }, log: () => {} });
  const port = await app.listen(0);
  const early = client(port), late = client(port);
  const closed = (c) => new Promise((r) => c.ws.on('close', r));
  const eClosed = closed(early), lClosed = closed(late);
  await Promise.all([early.open, late.open]);
  try {
    early.send({ t: 'hello', nickname: '일찍' }); late.send({ t: 'hello', nickname: '늦게' });
    await early.type('welcome'); await late.type('welcome');
    early.send({ t: 'logout' }); await early.type('logged_out'); // 연결 시점 타이머(200ms) 전에 로그아웃
    await new Promise((r) => setTimeout(r, 300)); // 연결 시점 타이머는 지났다
    assert.equal(early.ws.readyState, 1); // 로그아웃 시점 기준(400ms)이라 아직 연결 유지
    late.send({ t: 'logout' }); await late.type('logged_out'); // 연결 시점 타이머 뒤 로그아웃
    assert.equal((await early.type('error', 2000)).code, 'LOGIN_TIMEOUT');
    assert.equal((await late.type('error', 2000)).code, 'LOGIN_TIMEOUT'); // 늦은 로그아웃도 제한 시간 뒤 끊긴다
    await Promise.all([eClosed, lClosed]);
  } finally { early.ws.close(); late.ws.close(); await app.close(); }
});

test('랭크 방 좌석 레이팅: room_joined/room_state slots 에 rating·placement(랭크 방만), 경기 뒤 최신 값', async () => {
  const app = createServer({ store: new MemoryResultStore(), limits: LIM, log: () => {} });
  const port = await app.listen(0);
  const a = client(port), b = client(port), g = client(port);
  await Promise.all([a.open, b.open, g.open]);
  try {
    a.send({ t: 'register', nickname: '좌석A', password: 'aaaaaa' }); await a.type('welcome');
    b.send({ t: 'register', nickname: '좌석B', password: 'bbbbbb' }); await b.type('welcome');
    g.send({ t: 'hello', nickname: '손님S' }); await g.type('welcome');
    g.send({ t: 'create_room' });
    const gs = (await g.type('room_joined')).room.slots[0];
    assert.ok(!('rating' in gs) && !('placement' in gs)); // 비랭크 방은 필드 없음
    app.lobby.ranking.record({ matchId: 'pre', players: [{ key: '좌석b', nick: '좌석B' }, { key: 'zz', nick: 'ZZ' }], winner: 0 });
    a.send({ t: 'create_room', ranked: true });
    const rj = await a.type('room_joined');
    assert.deepEqual([rj.room.slots[0].rating, rj.room.slots[0].placement], [1000, true]);
    b.send({ t: 'join_room', code: rj.room.code });
    const bj = await b.type('room_joined');
    assert.deepEqual([bj.room.slots[1].rating, bj.room.slots[1].placement], [1024, true]);
    const st = await a.wait((m) => m.t === 'room_state' && m.room.slots[1]);
    assert.deepEqual([st.room.slots[0].rating, st.room.slots[1].rating], [1000, 1024]); // 상대 입장 시 상대 값
    b.send({ t: 'ready', ready: true });
    await a.wait((m) => m.t === 'room_state' && m.room.start.ok);
    a.send({ t: 'start' }); await a.type('game_start');
    const room = app.lobby.rooms.get(rj.room.code);
    room.game.match.phase = 'play'; room.game.finish(0, 'annihilation');
    const r = await a.type('ranking_result');
    const after = await a.wait((m) => m.t === 'room_state' && m.room.status === 'waiting' && m.room.slots[1] && m.room.slots[0].rating !== 1000);
    assert.equal(r.oppBefore, 1024);
    assert.deepEqual(after.room.slots.map((x) => x.rating), [r.after, app.lobby.ranking.get('좌석b').rating]); // 경기 종료 뒤 room_state 는 반영 후 값
    assert.ok(after.room.slots[1].rating < 1024);
  } finally { a.ws.close(); b.ws.close(); g.ws.close(); await app.close(); }
});
