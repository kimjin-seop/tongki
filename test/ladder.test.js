// 래더(랭크 대체, PROTOCOL §11) 핵심 시험: 티어 승강·완충, 대기열 범위 확장, 같은 상대 제한 이연, 시즌 리셋·마스터, 마이그레이션 v3, 일반 사람끼리 전적
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { openDb, MIGRATIONS, schemaVersion } from '../server/store/db.js';
import { RankingStore } from '../server/store/ranking.js';
import { LADDER, nextTier, tierOf, queueWindow } from '../server/ranking/elo.js';
import { LadderQueue } from '../server/ranking/queue.js';

const DAY = 86400000;

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
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

test('티어: 승급은 하한 도달 즉시, 강등은 하한-25 아래에서(내려간 칸도 완충), 배치 5판째에 티어가 보인다', () => {
  assert.deepEqual([tierOf(949), tierOf(950), tierOf(1249), tierOf(1250)], ['bronze', 'silver', 'platinum', 'diamond']);
  assert.equal(nextTier('silver', 1050), 'gold'); // 승급
  assert.equal(nextTier('gold', 1026), 'gold'); // 하한 1050 - 25 = 1025 이상이면 유지
  assert.equal(nextTier('gold', 1024), 'silver'); // 강등
  assert.equal(nextTier('gold', 930), 'silver'); // 두 칸 아래 레이팅이어도 실버 완충(925) 안이면 실버
  assert.equal(nextTier('gold', 900), 'bronze');
  assert.equal(nextTier('silver', 1260), 'diamond'); // 승급은 여러 칸도 바로

  const rs = new RankingStore(openDb(':memory:'));
  const T0 = 1e12;
  rs.season(T0);
  const opp = (i) => [{ key: 'me', nick: 'Me' }, { key: `o${i}`, nick: `O${i}` }]; // 상대를 바꿔 같은 상대 제한을 피한다
  let r;
  for (let i = 0; i < 4; i++) r = rs.record({ matchId: `p${i}`, players: opp(i), winner: 0, now: T0 + i });
  assert.deepEqual([r.tier[0], r.placement[0], r.placementLeft[0]], [null, true, 1]); // 배치 중 = 티어 숨김
  r = rs.record({ matchId: 'p4', players: opp(4), winner: 0, now: T0 + 4 });
  assert.equal(r.after[0], 1104); // 배치 K48(첫 10판), 1000 상대 5연승: +24 +22 +21 +19 +18
  assert.deepEqual([r.tierBefore[0], r.tier[0], r.placement[0]], [null, 'gold', false]); // 5판째 = 레이팅으로 바로(1104 = 골드)
  assert.equal(rs.status('me', 'Me', T0 + 5).tier, 'gold');
});

test('대기열: 허용 차는 15초마다 100씩 넓어지고 60초 뒤 무제한(max 판정), 손님끼리·같은 키 짝 없음', () => {
  assert.deepEqual([queueWindow(0), queueWindow(14999), queueWindow(15000), queueWindow(45000), queueWindow(60000)], [100, 100, 200, 400, Infinity]);
  const q = new LadderQueue();
  q.join({ key: 'a', nick: 'A', guest: false, rating: 1000, at: 0 });
  q.join({ key: 'b', nick: 'B', guest: false, rating: 1250, at: 0 });
  assert.deepEqual(q.match(14000), []); // 창 100 < 차 250
  assert.deepEqual(q.match(29000), []); // 창 200
  const m = q.match(30000); // 창 300 >= 250
  assert.deepEqual(m.map((x) => [x.a.key, x.b.key, x.blocked]), [['a', 'b', false]]);
  assert.equal(q.size, 0);
  // 한쪽만 오래 기다려도(max) 성사: 새로 선 c(창 100) 와 60초 기다린 d(무제한)
  q.join({ key: 'd', nick: 'D', guest: false, rating: 1400, at: 0 });
  q.join({ key: 'c', nick: 'C', guest: false, rating: 1000, at: 60000 });
  assert.equal(q.match(60000).length, 1);
  // 손님끼리는 오래 기다려도 짝 없음
  q.join({ key: 'guest:x', nick: 'X', guest: true, rating: 1500, at: 0 });
  q.join({ key: 'guest:y', nick: 'Y', guest: true, rating: 0, at: 0 });
  assert.deepEqual(q.match(999999), []);
  assert.equal(q.get('guest:x').rating, LADDER.guestRating); // 손님은 1000 으로 본다
});

test('같은 상대 제한(PAIR_LIMIT): 큐는 제한 걸린 짝을 다른 후보가 있으면 미루고, 60초 지나면 허용(그 판은 미반영)', () => {
  const blocked = (a, b) => [a.key, b.key].sort().join() === 'a,b';
  let q = new LadderQueue();
  q.join({ key: 'a', nick: 'A', guest: false, rating: 1000, at: 0 });
  q.join({ key: 'b', nick: 'B', guest: false, rating: 1000, at: 1 });
  q.join({ key: 'c', nick: 'C', guest: false, rating: 1090, at: 2 });
  assert.deepEqual(q.match(1000, blocked).map((x) => [x.a.key, x.b.key]), [['a', 'c']]); // b 가 더 가깝지만 제한이라 c
  q = new LadderQueue();
  q.join({ key: 'a', nick: 'A', guest: false, rating: 1000, at: 0 });
  q.join({ key: 'b', nick: 'B', guest: false, rating: 1000, at: 1 });
  assert.deepEqual(q.match(59999, blocked), []); // 다른 후보가 없어도 60초 전에는 미룬다
  assert.deepEqual(q.match(60000, blocked).map((x) => x.blocked), [true]);

  const rs = new RankingStore(openDb(':memory:'));
  const P = [{ key: 'a', nick: 'A' }, { key: 'b', nick: 'B' }], T0 = 1e12;
  for (let i = 0; i < 3; i++) rs.record({ matchId: `m${i}`, players: P, winner: 0, now: T0 + i });
  assert.equal(rs.pairCount('a', 'b', T0 + 3), 3);
  assert.deepEqual((({ counted, why, delta }) => [counted, why, delta])(rs.record({ matchId: 'm3', players: P, winner: 0, now: T0 + 3 })), [false, 'PAIR_LIMIT', [0, 0]]);
  assert.equal(rs.pairCount('a', 'b', T0 + DAY + 10), 0); // 24시간 뒤 다시
});

test('시즌: 28일 지나면 닫고(마스터 확정) 다음 시즌 = round(1000 + (r-1000)×0.5)·판수 0(배치 다시), 지난 시즌 행 보관. 마스터 = 1250·20판 이상 상위 정원', () => {
  const db = openDb(':memory:');
  const rs = new RankingStore(db);
  const T0 = 1e12;
  assert.deepEqual(rs.season(T0), { season: 1, startedAt: T0, endsAt: T0 + 28 * DAY });
  // 배치 완료 20명(정원 = min(5, max(1, floor(20×0.05))) = 1). 1300·1290 은 마스터 조건, 나머지는 1000대
  for (let i = 0; i < 20; i++) {
    const rating = i === 0 ? 1300 : i === 1 ? 1290 : 1000 + i;
    db.run('INSERT INTO ratings (key, season, nick, rating, w, l, games, tier, lock_until, last_game_at, updated_at) VALUES (?, 1, ?, ?, 10, 10, 20, ?, 0, ?, ?)', `p${i}`, `P${i}`, rating, tierOf(rating), T0 + 20 * DAY, T0); // 마지막 경기 = 시즌 끝 8일 전(종료 시점에도 활동 중)
  }
  db.run("INSERT INTO ratings (key, season, nick, rating, w, l, games, tier, lock_until, last_game_at, updated_at) VALUES ('old', 1, 'Old', 1400, 30, 0, 30, 'diamond', 0, ?, ?)", T0 - 20 * DAY, T0);
  const b = rs.board(50, 'p1', 'P1', T0 + DAY);
  assert.equal(b.total, 20); assert.equal(b.masterQuota, 1);
  assert.deepEqual(b.top.slice(0, 2).map((x) => [x.nick, x.tier]), [['P0', 'master'], ['P1', 'diamond']]); // 비활동(14일) 'Old' 는 빠진다
  assert.equal(b.me.rank, 2);
  // 시즌 전환
  const S2 = rs.season(T0 + 28 * DAY + 5);
  assert.deepEqual([S2.season, S2.startedAt], [2, T0 + 28 * DAY]);
  const p0 = rs.get('p0', 'P0', T0 + 28 * DAY + 5);
  assert.deepEqual([p0.season, p0.rating, p0.games, p0.w, p0.l], [2, 1150, 0, 0, 0]);
  assert.equal(rs.get('p3', 'P3', T0 + 28 * DAY + 5).rating, 1002); // 1003 -> 1001.5 -> 반올림 1002
  assert.equal(db.get('SELECT rating FROM ratings WHERE key = ? AND season = 1', 'p0').rating, 1300); // 지난 시즌 행 보관
  assert.deepEqual(rs.seasonFinal(1).final.masters.map((m) => m.key), ['p0']);
  assert.equal(rs.status('p0', 'P0', T0 + 28 * DAY + 5).placement, true); // 새 시즌 배치 다시
  assert.equal(rs.season(T0 + 3 * 28 * DAY + 1).season, 4); // 서버가 꺼져 있던 동안 지난 시즌만큼 넘긴다
});

test('마이그레이션 v3: v2 DB 의 ratings 는 보관 표로(시즌 1 = 전원 1000), 새 표 생성, 다시 열어도 한 번만 적용', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ladder-mig-'));
  const file = path.join(dir, 'v2.db');
  const raw = new DatabaseSync(file);
  raw.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)');
  raw.exec(MIGRATIONS[0]); raw.exec(MIGRATIONS[1]);
  raw.exec('INSERT INTO schema_version (version) VALUES (1), (2)');
  raw.exec("INSERT INTO ratings (key, nick, rating, w, l, games, season, lock_until, updated_at) VALUES ('k', 'K', 1234, 7, 3, 10, 1, 0, 1)");
  raw.exec("INSERT INTO rank_games (match_id, a_key, b_key, winner_key, forfeit_key, counted, at) VALUES ('m', 'k', 'z', 'k', NULL, 1, 1)");
  raw.close();
  let db = openDb(file, { allow: { 3: true } }); // 기존 DB 의 v3 는 LADDER_MIGRATE=1 게이트(아래 시험)
  assert.equal(schemaVersion(db), 3);
  assert.deepEqual({ ...db.get('SELECT key, rating, w FROM ratings_v2_archive') }, { key: 'k', rating: 1234, w: 7 });
  assert.equal(db.get('SELECT COUNT(*) AS n FROM ratings').n, 0);
  assert.equal(new RankingStore(db).get('k', 'K').rating, 1000); // 시즌 1 은 전원 1000
  assert.equal(db.get('SELECT season FROM rank_games').season, 0); // 종전 경기 = 시즌 0
  db.close();
  db = openDb(file); // 다시 열기: 재적용 없음
  assert.deepEqual([schemaVersion(db), db.get('SELECT COUNT(*) AS n FROM schema_version').n, db.get('SELECT COUNT(*) AS n FROM ratings_v2_archive').n], [3, 3, 1]);
  db.close();
});

test('마이그레이션 게이트(M2): LADDER_MIGRATE 없이 v2 DB 를 열면 v3 를 적용하지 않고 MIGRATION_GATED 로 멈춘다, 새 DB 는 게이트 없이 최신', () => {
  const saved = process.env.LADDER_MIGRATE; delete process.env.LADDER_MIGRATE;
  try {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'ladder-gate-')), 'v2.db');
    const raw = new DatabaseSync(file);
    raw.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)'); raw.exec(MIGRATIONS[0]); raw.exec(MIGRATIONS[1]);
    raw.exec('INSERT INTO schema_version (version) VALUES (1), (2)'); raw.close();
    assert.throws(() => openDb(file), (e) => e.code === 'MIGRATION_GATED' && /LADDER_MIGRATE=1/.test(e.message));
    const chk = new DatabaseSync(file);
    assert.deepEqual([chk.prepare('SELECT MAX(version) AS v FROM schema_version').get().v, chk.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('pvp_records', 'ratings_v2_archive')").get().n], [2, 0]);
    chk.close();
    const fresh = openDb(path.join(path.dirname(file), 'new.db')); // 새 파일 = 버전 0 -> 바로 v3
    assert.equal(schemaVersion(fresh), 3); fresh.close();
  } finally { if (saved !== undefined) process.env.LADDER_MIGRATE = saved; }
});

test('ranking_result 티어(L4): 마스터 조건을 채운 계정은 tierBefore·tier 가 ladder_status 와 같은 master', () => {
  const db = openDb(':memory:'), rs = new RankingStore(db), T0 = 1e12;
  rs.season(T0);
  for (let i = 0; i < 20; i++) {
    const rating = i === 0 ? 1300 : 1000 + i;
    db.run('INSERT INTO ratings (key, season, nick, rating, w, l, games, tier, lock_until, last_game_at, updated_at) VALUES (?, 1, ?, ?, 10, 10, 20, ?, 0, ?, ?)', `p${i}`, `P${i}`, rating, tierOf(rating), T0, T0);
  }
  const r = rs.record({ matchId: 'm', players: [{ key: 'p0', nick: 'P0' }, { key: 'p5', nick: 'P5' }], winner: 0, now: T0 + 1 });
  assert.deepEqual([r.tierBefore[0], r.tier[0]], ['master', 'master']); // 종전에는 저장 티어 'diamond'
  assert.equal(rs.status('p0', 'P0', T0 + 2).tier, r.tier[0]);
  db.close();
});

test('일반 사람끼리 방 경기는 전적(pvp)에 반영·레이팅 불변, 래더 방은 불꽃 팀·입장 거절', async () => {
  const app = createServer({ store: new MemoryResultStore(), limits: { maxAuthPerMin: 100, maxHelloPerMin: 1000 }, log: () => {} });
  const port = await app.listen(0);
  const a = client(port), g = client(port), c = client(port);
  await Promise.all([a.open, g.open, c.open]);
  try {
    a.send({ t: 'register', nickname: '전적A', password: 'aaaaaa' }); await a.type('welcome');
    g.send({ t: 'hello', nickname: '손님P' }); await g.type('welcome');
    c.send({ t: 'register', nickname: '전적C', password: 'cccccc' }); await c.type('welcome');
    a.send({ t: 'create_room' }); const { room: r0 } = await a.type('room_joined');
    g.send({ t: 'join_room', code: r0.code }); await g.type('room_joined');
    const room = app.lobby.rooms.get(r0.code);
    g.send({ t: 'ready', ready: true });
    await a.wait((m) => m.t === 'room_state' && m.room.start.ok);
    a.send({ t: 'start' }); await a.type('game_start');
    room.game.match.phase = 'play'; room.game.finish(0, 'timeup');
    await a.type('game_end');
    assert.deepEqual(app.lobby.ranking.pvp('전적a'), { w: 1, l: 0 });
    assert.equal(app.lobby.ranking.get('전적a').rating, 1000); // 일반 방은 레이팅 불변
    assert.equal(app.db.get("SELECT COUNT(*) AS n FROM pvp_records WHERE key = '손님p'").n, 0); // 손님은 저장 없음
    a.send({ t: 'leave_room' }); await a.type('room_left');
    g.send({ t: 'leave_room' }); await g.type('room_left');

    a.send({ t: 'ladder_join' }); c.send({ t: 'ladder_join' });
    const { code } = await a.type('ladder_matched'); await a.type('room_joined');
    assert.equal(await g.err({ t: 'join_room', code }), 'ROOM_FULL'); // 매칭된 두 사람 전용
    assert.equal(await a.err({ t: 'set_team', team: 'flame:recent' }), 'FLAME_TEAM_ROOM');
    assert.equal(await a.err({ t: 'set_team', team: 22 }), 'TEAM_INVALID');
    c.send({ t: 'leave_room' }); // 경기 전 취소 = 남은 사람도 해산(벌점 없음)
    assert.equal((await a.type('room_left')).reason, 'ladder_cancel');
    assert.equal(app.lobby.rooms.has(code), false);
  } finally { a.ws.close(); g.ws.close(); c.ws.close(); await app.close(); }
});
