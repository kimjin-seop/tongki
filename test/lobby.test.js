import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { mono } from '../server/net/limits.js';
import { openWs } from './ws_util.js';

function client(port) {
  const ws = openWs(port, { snaps: true });
  const q = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].res(m); else q.push(m);
  });
  const open = new Promise((r) => ws.on('open', r));
  return {
    open, ws,
    send: (o) => ws.send(JSON.stringify(o)),
    wait(pred, ms = 3000) {
      const i = q.findIndex(pred);
      if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        const w = { pred, res };
        waiters.push(w);
        setTimeout(() => rej(new Error('timeout waiting message')), ms).unref();
      });
    },
    type(t, ms) { return this.wait((m) => m.t === t, ms); },
  };
}

test('로비 흐름: 로그인 -> 방 -> 준비 -> 시작 -> 대전 -> 종료(기권) + 결과 저장', async () => {
  const store = new MemoryResultStore();
  const app = createServer({ store, log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port), b = client(port);
    await Promise.all([a.open, b.open]);
    a.send({ t: 'hello', nickname: '철수' });
    const wa = await a.type('welcome');
    assert.equal(wa.location, 'lobby');
    b.send({ t: 'hello', nickname: '철수' });
    assert.equal((await b.type('error')).code, 'NICK_TAKEN'); // 접속 중 중복 거부
    b.send({ t: 'hello', nickname: '영희' });
    await b.type('welcome');

    a.send({ t: 'create_room' });
    const ja = await a.type('room_joined');
    assert.equal(ja.you, 0);
    const code = ja.room.code;
    assert.match(code, /^[A-Z0-9]{4,6}$/);
    assert.equal(ja.room.evade, 'track'); // 사람끼리 일반 방 = 필살 추적 자동 적용(PROTOCOL §5.8)
    b.send({ t: 'join_room', code });
    assert.equal((await b.type('room_joined')).you, 1);
    a.send({ t: 'start' }); // 준비 전 시작 거부
    assert.equal((await a.type('error')).code, 'START_NOT_READY');
    b.send({ t: 'set_team', team: 5 });
    b.send({ t: 'ready', ready: true });
    await a.wait((m) => m.t === 'room_state' && m.room.start.ok);
    a.send({ t: 'start' });
    const sa = await a.type('game_start'), sb = await b.type('game_start');
    assert.deepEqual([sa.you, sb.you], [0, 1]);
    assert.equal(sa.rules.evade, 'track');
    assert.equal(sb.teams[1].id, 5);
    a.send({ t: 'input', n: 0, b: [8] });
    const snap = await a.type('snap');
    assert.equal(snap.p.length, 14);
    assert.equal(snap.ph, 'ready');

    b.send({ t: 'leave_room' }); // 게임 중 퇴장 = 기권패
    const end = await a.type('game_end');
    assert.equal(end.winner, 0);
    assert.equal(end.reason, 'forfeit_leave');
    await a.wait((m) => m.t === 'room_state' && m.room.status === 'waiting');
    assert.equal(store.records.length, 1);
    assert.equal(store.records[0].winner, '철수');
    assert.equal(store.records[0].endReason, 'forfeit_leave');
    a.ws.close(); b.ws.close();
  } finally { await app.close(); }
});

test('재접속: 끊긴 뒤 토큰으로 복귀하면 방과 경기가 이어진다', async () => {
  const app = createServer({ store: new MemoryResultStore(), log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port), b = client(port);
    await Promise.all([a.open, b.open]);
    a.send({ t: 'hello', nickname: 'aaa' }); await a.type('welcome');
    b.send({ t: 'hello', nickname: 'bbb' }); const wb = await b.type('welcome');
    a.send({ t: 'create_room', code: 'ab12' }); await a.type('room_joined');
    b.send({ t: 'join_room', code: 'AB12' }); await b.type('room_joined');
    b.send({ t: 'ready', ready: true });
    await a.wait((m) => m.t === 'room_state' && m.room.start.ok);
    a.send({ t: 'start' });
    await a.type('game_start');
    b.ws.close();
    await a.type('game_pause');
    const b2 = client(port); await b2.open;
    b2.send({ t: 'hello', token: wb.token });
    const w2 = await b2.type('welcome');
    assert.equal(w2.resumed, true);
    assert.equal(w2.location, 'game');
    await b2.wait((m) => m.t === 'game_start' && m.resumed === true);
    a.ws.close(); b2.ws.close();
  } finally { await app.close(); }
});

test('승패 확정 후 승자가 끊겨도 결과가 뒤집히지 않는다 (기권 덮어쓰기 금지)', async () => {
  const store = new MemoryResultStore();
  const app = createServer({ store, log: () => {}, graceMs: 300 });
  const port = await app.listen(0);
  try {
    const a = client(port), b = client(port);
    await Promise.all([a.open, b.open]);
    a.send({ t: 'hello', nickname: 'aaa' }); await a.type('welcome');
    b.send({ t: 'hello', nickname: 'bbb' }); await b.type('welcome');
    a.send({ t: 'create_room', code: 'WN01' }); await a.type('room_joined');
    b.send({ t: 'join_room', code: 'WN01' }); await b.type('room_joined');
    b.send({ t: 'ready', ready: true });
    await a.wait((m) => m.t === 'room_state' && m.room.start.ok);
    a.send({ t: 'start' });
    await b.type('game_start');
    const g = app.lobby.rooms.get('WN01').game;
    g.match.finish(0, 'annihilation'); // 좌석0 승 확정(연출 구간)
    a.ws.close(); // 승자 끊김
    const end = await b.type('game_end', 5000);
    assert.equal(end.winner, 0);
    assert.equal(end.reason, 'annihilation');
    assert.equal(store.records.length, 1);
    assert.equal(store.records[0].winner, 'aaa');
    assert.equal(store.records[0].endReason, 'annihilation');
    b.ws.close();
  } finally { await app.close(); }
});

test('접속 상한: IP당 동시 연결 초과는 거부, 로그인 안 한 연결은 타임아웃', async () => {
  const app = createServer({ store: new MemoryResultStore(), log: () => {}, limits: { maxConnPerIp: 2, loginTimeoutMs: 300 } });
  const port = await app.listen(0);
  try {
    const c1 = client(port), c2 = client(port), c3 = client(port);
    await Promise.all([c1.open, c2.open, c3.open].map((p) => p.catch(() => {})));
    assert.equal((await c3.type('error')).code, 'TOO_MANY_CONNECTIONS');
    assert.equal((await c1.type('error')).code, 'LOGIN_TIMEOUT');
    c2.ws.close();
  } finally { await app.close(); }
});

test('컴퓨터 대전: 방장 혼자 시작 -> 기권 종료, 결과에 vsCpu 표기', async () => {
  const store = new MemoryResultStore();
  const app = createServer({ store, log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port);
    await a.open;
    a.send({ t: 'hello', nickname: '혼자' });
    await a.type('welcome');
    a.send({ t: 'create_room', vsCpu: true, cpuLevel: 3 });
    const j = await a.type('room_joined');
    assert.equal(j.room.slots[1].cpu, true);
    assert.equal(j.room.start.ok, true);
    a.send({ t: 'start' });
    const gs = await a.type('game_start');
    assert.equal(gs.you, 0);
    await a.type('snap');
    a.send({ t: 'leave_room' });
    const end = await a.type('game_end');
    assert.equal(end.reason, 'forfeit_leave');
    assert.equal(store.records.length, 1);
    assert.equal(store.records[0].vsCpu, true);
    assert.equal(store.records[0].cpuLevel, 3);
  } finally { await app.close(); }
});

test('규칙 창: 방장의 set_rules 가 방 상태와 서버 Match(제한 시간)에 반영된다. 무제한 = 0, 틀린 값·방장 아님은 거절', async () => {
  const app = createServer({ store: new MemoryResultStore(), log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port), b = client(port);
    await Promise.all([a.open, b.open]);
    a.send({ t: 'hello', nickname: '규칙방장' }); await a.type('welcome');
    b.send({ t: 'hello', nickname: '규칙손님' }); await b.type('welcome');
    a.send({ t: 'create_room' });
    const ja = await a.type('room_joined');
    assert.deepEqual(ja.room.rules, { mode: 'knockout', time: 5, flameTeams: true }); // 기본 = 종전 5분 + 불꽃 팀 허용(2026-11-22)
    b.send({ t: 'join_room', code: ja.room.code }); await b.type('room_joined');
    b.send({ t: 'set_rules', rules: { time: 3 } });
    assert.equal((await b.type('error')).code, 'NOT_HOST');
    a.send({ t: 'set_rules', rules: { time: 4 } });
    assert.equal((await a.type('error')).code, 'RULES_INVALID');
    a.send({ t: 'set_rules', rules: { mode: 'official', time: 0 } }); // こうしき 는 무제한을 쓸 수 없다 -> 3분으로 바뀐다(원작 규칙 창)
    assert.deepEqual((await a.wait((m) => m.t === 'room_state' && m.room.rules.mode === 'official')).room.rules, { mode: 'official', time: 3 });
    a.send({ t: 'set_rules', rules: { mode: 'knockout', time: 5 } });
    await a.wait((m) => m.t === 'room_state' && m.room.rules.mode === 'knockout');
    b.send({ t: 'ready', ready: true });
    await a.wait((m) => m.t === 'room_state' && m.room.start.ok);
    a.send({ t: 'set_rules', rules: { time: 3 } });
    const st = await b.wait((m) => m.t === 'room_state' && m.room.rules.time === 3);
    assert.equal(st.room.slots[1].ready, false); // 규칙이 바뀌면 상대 준비 해제
    b.send({ t: 'ready', ready: true });
    await a.wait((m) => m.t === 'room_state' && m.room.start.ok);
    a.send({ t: 'start' });
    const gs = await b.type('game_start');
    await a.type('game_start');
    assert.equal(gs.rules.limitFrames, 3 * 60 * 60);
    assert.equal(gs.rules.mode, 'knockout');
    const room = app.lobby.rooms.get(ja.room.code);
    assert.equal(room.game.match.limitFrames, 10800);
    assert.equal((await b.type('snap')).clk, 10800);
    // 무제한: 컴퓨터 대전 방에서 time 0 -> Match.limitFrames 0
    a.send({ t: 'leave_room' }); await a.type('room_left');
    a.send({ t: 'create_room', vsCpu: true, rules: { time: 0 } });
    assert.deepEqual((await a.type('room_joined')).room.rules, { mode: 'knockout', time: 0 });
    a.send({ t: 'start' });
    assert.equal((await a.type('game_start')).rules.limitFrames, 0);
    // こうしき: 방을 만들 때 실어도 되고, 엔진까지 official 로 전달된다
    a.send({ t: 'leave_room' }); await a.type('room_left');
    a.send({ t: 'create_room', vsCpu: true, rules: { mode: 'official', time: 0 } });
    const jo = await a.type('room_joined');
    assert.deepEqual(jo.room.rules, { mode: 'official', time: 3 });
    a.send({ t: 'start' });
    const go = await a.type('game_start');
    assert.deepEqual([go.rules.mode, go.rules.limitFrames], ['official', 10800]);
    assert.equal(app.lobby.rooms.get(jo.room.code).game.match.official, true);
    // 스토리: 틀린 rules 로 campaign_start 를 거절해도 끝난 경기의 대기 방은 그대로 남는다
    a.send({ t: 'leave_room' }); await a.type('room_left');
    a.send({ t: 'campaign_start', k: 0 });
    const cj = await a.type('room_joined');
    await a.type('game_start');
    app.lobby.rooms.get(cj.room.code).game.finish(1, 'annihilation');
    await a.type('campaign_result');
    a.send({ t: 'campaign_start', k: 0, rules: { time: 4 } });
    assert.equal((await a.type('error')).code, 'RULES_INVALID');
    assert.ok(app.lobby.rooms.has(cj.room.code));
    assert.equal(app.lobby.roomOf(app.lobby.rooms.get(cj.room.code).seats[0].s)?.code, cj.room.code);
  } finally { await app.close(); }
});

test('특훈: training_start -> game_start(training)·스냅샷 tr -> training_quit -> training_end + 로비 복귀, 결과 저장 없음', async () => {
  const store = new MemoryResultStore();
  const app = createServer({ store, log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port);
    await a.open;
    a.send({ t: 'hello', nickname: '특훈생' });
    await a.type('welcome');
    a.send({ t: 'training_start', kind: 'league' });
    assert.equal((await a.type('error')).code, 'BAD_MESSAGE'); // 모르는 종류
    a.send({ t: 'training_start', kind: 'catch' });
    const gs = await a.type('game_start');
    assert.deepEqual(gs.training, { kind: 'catch', step: 0, balls: 10, pass: 6, steps: 3 });
    assert.deepEqual([gs.teams[0].id, gs.teams[1].id, gs.you], [22, 24, 0]);
    const sn = await a.wait((m) => m.t === 'snap' && m.f >= 4);
    assert.equal(sn.tr.phase, 'intro');
    assert.equal(sn.tr.left, 10);
    a.send({ t: 'list_rooms' });
    assert.equal((await a.type('room_list')).rooms.length, 0); // 특훈 방은 공개 목록에 없다
    a.send({ t: 'start' });
    assert.equal((await a.type('error')).code, 'NOT_IN_CAMPAIGN_ROOM'); // 특훈 방은 start 로 시작할 수 없다
    a.send({ t: 'training_quit' });
    const te = await a.type('training_end');
    assert.deepEqual([te.kind, te.cleared, te.reason], ['catch', false, 'training_quit']);
    assert.equal((await a.type('room_left')).reason, 'leave');
    assert.equal(store.records.length, 0);
    a.ws.close();
  } finally { await app.close(); }
});

test('특훈: 끊김 횟수 초과 기권(roomGame 이 직접 종료)에도 방이 남지 않고, 재접속하면 로비다', async () => {
  const app = createServer({ store: new MemoryResultStore(), log: () => {}, limits: { maxDisconnects: 0 } });
  const port = await app.listen(0);
  try {
    const a = client(port);
    await a.open;
    a.send({ t: 'hello', nickname: '끊김생' });
    const w = await a.type('welcome');
    a.send({ t: 'training_start', kind: 'catch' });
    await a.type('game_start');
    a.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(app.lobby.stats(), { sessions: 1, rooms: 0, playing: 0 });
    const a2 = client(port);
    await a2.open;
    a2.send({ t: 'hello', token: w.token });
    assert.equal((await a2.type('welcome')).location, 'lobby');
    a2.ws.close();
  } finally { await app.close(); }
});

test('특훈 상한(자작 안전망): 무입력이 idleMax 프레임을 넘으면 training_end{cleared:false, reason:idle} 로 끝난다', async () => {
  const app = createServer({ store: new MemoryResultStore(), log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port);
    await a.open;
    a.send({ t: 'hello', nickname: '무입력생' });
    await a.type('welcome');
    a.send({ t: 'training_start', kind: 'catch' });
    await a.type('game_start');
    const g = [...app.lobby.rooms.values()][0].game;
    assert.deepEqual(g.trainCap, { idle: 36000, total: 108000 });
    g.trainCap.idle = 6;
    const te = await a.type('training_end');
    assert.deepEqual([te.cleared, te.reason], [false, 'idle']);
    assert.equal((await a.type('room_left')).reason, 'leave');
    assert.equal(app.lobby.stats().rooms, 0);
    a.ws.close();
  } finally { await app.close(); }
});

test('필살 특훈: training_start{special} -> game_start(training)·스냅샷 tr(ch) -> 총 시간 상한 종료, 다시 시작 -> leave_room 기권. 방·결과 레코드가 남지 않는다', async () => {
  const store = new MemoryResultStore();
  const app = createServer({ store, log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port);
    await a.open;
    a.send({ t: 'hello', nickname: '필살생' });
    await a.type('welcome');
    a.send({ t: 'training_start', kind: 'special' });
    assert.deepEqual((await a.type('room_joined')).room.training, { kind: 'special' });
    const gs = await a.type('game_start');
    assert.deepEqual(gs.training, { kind: 'special', step: 0, balls: 20, pass: 10, steps: 1, gauge: { max: 15, ok: [13, 15], hold: 120 } });
    assert.deepEqual([gs.teams[0].id, gs.teams[1].id, gs.you], [22, 24, 0]);
    const sn = await a.wait((m) => m.t === 'snap' && m.f >= 4);
    assert.deepEqual(sn.tr, { step: 0, count: 0, left: 20, phase: 'intro', msg: 6, retry: 0, ch: 0, chb: 0 });
    assert.equal(sn.b[4], 0); // 공은 내 쪽 선수 0 이 들고 시작
    [...app.lobby.rooms.values()][0].game.trainCap.total = 8; // 상한(자작 안전망)
    const te = await a.type('training_end');
    assert.deepEqual([te.kind, te.cleared, te.reason], ['special', false, 'cap']);
    assert.equal((await a.type('room_left')).reason, 'leave');
    assert.equal(app.lobby.stats().rooms, 0);
    a.send({ t: 'training_start', kind: 'special' }); // 다시 시작 -> 기권
    await a.type('game_start');
    a.send({ t: 'leave_room' });
    const te2 = await a.type('training_end');
    assert.deepEqual([te2.kind, te2.cleared, te2.reason], ['special', false, 'forfeit_leave']);
    await a.type('room_left');
    assert.deepEqual(app.lobby.stats(), { sessions: 1, rooms: 0, playing: 0 });
    assert.equal(store.records.length, 0);
    a.ws.close();
  } finally { await app.close(); }
});

test('방 목록: 로비 사용자에게 새 방이 푸시되고 항목에 규칙 요약(rules)·인원이 실린다', async () => {
  const app = createServer({ store: new MemoryResultStore(), log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port), b = client(port);
    await Promise.all([a.open, b.open]);
    a.send({ t: 'hello', nickname: '목록방장' }); await a.type('welcome');
    b.send({ t: 'hello', nickname: '목록손님' }); await b.type('welcome');
    a.send({ t: 'create_room', rules: { mode: 'official', time: 3 } });
    const code = (await a.type('room_joined')).room.code;
    // list_rooms 를 보내지 않아도 푸시로 온다
    const l1 = await b.wait((m) => m.t === 'room_list' && m.rooms.length === 1);
    assert.deepEqual(l1.rooms[0], { code, host: '목록방장', players: 1, max: 2, status: 'waiting', rules: { mode: 'official', time: 3 } });
    b.send({ t: 'join_room', code }); await b.type('room_joined');
    b.send({ t: 'leave_room' }); await b.type('room_left');
    assert.equal((await b.wait((m) => m.t === 'room_list' && m.rooms[0]?.players === 1)).rooms[0].code, code);
    a.ws.close(); b.ws.close();
  } finally { await app.close(); }
});

test('봇 방어: 컴퓨터 대전 방은 목록에 없고, 경기 없는 방은 유휴 시간이 지나면 닫혀 로비로 간다(경기 중인 방은 그대로)', async () => {
  const app = createServer({ store: new MemoryResultStore(), log: () => {}, limits: { idleRoomMs: 30 * 60000 } });
  const port = await app.listen(0);
  try {
    const a = client(port), b = client(port), c = client(port), d = client(port);
    await Promise.all([a.open, b.open, c.open, d.open]);
    for (const [x, n] of [[a, '유휴대기'], [b, '유휴컴'], [c, '경기중컴'], [d, '구경']]) { x.send({ t: 'hello', nickname: n }); await x.type('welcome'); }
    a.send({ t: 'create_room' }); const ca = (await a.type('room_joined')).room.code;
    b.send({ t: 'create_room', vsCpu: true }); const cb = (await b.type('room_joined')).room;
    assert.equal(cb.vsCpu, true); // 본인 방 상태에는 그대로 실린다
    c.send({ t: 'create_room', vsCpu: true }); await c.type('room_joined');
    c.send({ t: 'start' }); await c.type('game_start');
    d.send({ t: 'list_rooms' });
    const list = await d.wait((m) => m.t === 'room_list' && m.rooms.length === 1);
    assert.deepEqual(list.rooms.map((r) => r.code), [ca]); // 컴퓨터 대전 방(대기·경기 중) 없음
    app.lobby.sweepIdleRooms(mono() + 29 * 60000); // 아직 이르다
    assert.equal(app.lobby.rooms.size, 3);
    app.lobby.sweepIdleRooms(mono() + 31 * 60000);
    assert.equal((await a.type('room_left')).reason, 'idle');
    assert.equal((await b.type('room_left')).reason, 'idle');
    assert.deepEqual([app.lobby.rooms.size, app.lobby.rooms.has(ca), app.lobby.roomOf(app.lobby.byNick.get('경기중컴'))?.game ? 'playing' : null], [1, false, 'playing']);
    for (const x of [a, b, c, d]) x.ws.close();
  } finally { await app.close(); }
});

test('봇 방어: IP당 분당 방 만들기 상한(create_room·컴퓨터 대전 start)을 넘으면 RATE_LIMITED', async () => {
  const app = createServer({ store: new MemoryResultStore(), log: () => {}, limits: { maxRoomCreatePerMin: 3 } });
  const port = await app.listen(0);
  try {
    const a = client(port);
    await a.open;
    a.send({ t: 'hello', nickname: '방남용' }); await a.type('welcome');
    a.send({ t: 'create_room' }); await a.type('room_joined');
    a.send({ t: 'create_room' }); assert.equal((await a.type('error')).code, 'ALREADY_IN_ROOM'); // 세션당 동시 방 1개
    a.send({ t: 'leave_room' }); await a.type('room_left');
    a.send({ t: 'create_room', vsCpu: true }); await a.type('room_joined'); // 2번째(거절된 ALREADY_IN_ROOM 은 창 검사 전이라 세지 않는다)
    a.send({ t: 'start' }); assert.equal((await a.wait((m) => m.t === 'error' || m.t === 'game_start')).t, 'game_start'); // 3번째
    a.send({ t: 'leave_room' }); await a.type('room_left');
    a.send({ t: 'create_room' }); assert.equal((await a.type('error')).code, 'RATE_LIMITED');
    a.ws.close();
  } finally { await app.close(); }
});
