import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadData } from '../server/engine/index.js';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { MemoryProgressStore } from '../server/store/progress.js';
import { MemoryLeagueStore, JsonLeagueStore } from '../server/store/league.js';
import { derive, makeLeague, recordWin, teamRating, quickJudge, homeStage, HOME_ROM_STAGE } from '../server/league/rules.js';

const data = loadData();

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
    wait(pred, ms = 3000) {
      const i = q.findIndex(pred);
      if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]);
      return new Promise((res, rej) => { waiters.push({ pred, res }); setTimeout(() => rej(new Error('timeout')), ms).unref(); });
    },
    type(t, ms) { return this.wait((m) => m.t === t, ms); },
  };
}

test('리그 규칙: 승률 floor·순위(동률 같은 번호), 즉시 판정 a=103,c=103, 홈 스테이지 표 = 캠페인 15행', () => {
  const lg = makeLeague({ teams: [{ team: 0 }, { team: 1 }, { team: 2 }], turns: 2 }, false, 1, 'x').league;
  const rk = () => derive(lg).table.sort((a, b) => a.idx - b.idx).map((r) => [r.rate, r.rank]);
  assert.deepEqual(rk(), [[0, 0], [0, 0], [0, 0]]);
  assert.deepEqual(derive(lg).table.map((r) => r.left), [4, 4, 4]);
  recordWin(lg, 0, 1);
  assert.deepEqual(rk(), [[1000, 0], [0, 1], [0, 1]]);         // 1·2·2위
  recordWin(lg, 1, 2);
  assert.deepEqual(rk(), [[1000, 0], [500, 1], [0, 2]]);
  recordWin(lg, 2, 0);
  assert.deepEqual(rk(), [[500, 0], [500, 0], [500, 0]]);       // 1·1·1위
  recordWin(lg, 0, 2); recordWin(lg, 0, 1);
  assert.equal(derive(lg).table.find((r) => r.idx === 0).rate, 750);
  assert.equal(derive(lg).table.find((r) => r.idx === 2).rate, 333); // floor(1000/3)

  const hi = (t) => teamRating(data.teams[t]) >> 8;
  assert.deepEqual([hi(1), hi(3), hi(15)], [103, 103, 173]);
  assert.equal(teamRating(data.teams[1]), 0x6744);
  assert.deepEqual(quickJudge(teamRating(data.teams[1]), teamRating(data.teams[3]), 46), { leftWins: true, p: 84, a: 51, c: 103 });
  assert.equal(quickJudge(teamRating(data.teams[1]), teamRating(data.teams[3]), 84).leftWins, true);
  assert.equal(quickJudge(teamRating(data.teams[1]), teamRating(data.teams[3]), 85).leftWins, false);

  for (const c of data.campaign) assert.equal(HOME_ROM_STAGE[c.teamOpp], c.romStage, `k${c.k}`);
  for (const c of data.campaign) assert.equal(homeStage(data.stages, c.teamOpp), c.stage, `k${c.k}`);
});

test('리그 한 바퀴(전원 컴퓨터 3팀 2턴): 검증 거절·즉시 판정·카드 잠금·우승·재시작 뒤 이어하기', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'league-'));
  const file = path.join(dir, 'league.json');
  const progress = new MemoryProgressStore();
  let app = createServer({ store: new MemoryResultStore(), progress, leagues: new JsonLeagueStore(file), log: () => {} });
  let port = await app.listen(0);
  let a = client(port); await a.open;
  a.send({ t: 'hello', nickname: '리그A' }); const wa = await a.type('welcome');
  const err = async (m) => { a.send(m); return (await a.type('error')).code; };
  try {
    a.send({ t: 'league_get' });
    const s0 = await a.type('league_state');
    assert.equal(s0.league, null); assert.equal(s0.special, false);
    const T = (...ids) => ids.map((team) => ({ team }));
    assert.equal(await err({ t: 'league_new', teams: T(0), turns: 2 }), 'LEAGUE_INVALID');
    assert.equal(await err({ t: 'league_new', teams: T(0, 1, 2, 3, 4, 5, 6), turns: 2 }), 'LEAGUE_INVALID');
    assert.equal(await err({ t: 'league_new', teams: T(0, 1, 2), turns: 0 }), 'LEAGUE_INVALID');
    assert.equal(await err({ t: 'league_new', teams: T(0, 1, 2), turns: 10 }), 'LEAGUE_INVALID');
    assert.equal(await err({ t: 'league_new', teams: T(0, 1, 1), turns: 2 }), 'LEAGUE_INVALID');
    for (const x of [22, 23, 24]) assert.equal(await err({ t: 'league_new', teams: T(0, x), turns: 1 }), 'LEAGUE_INVALID');
    assert.equal(await err({ t: 'league_new', teams: T(0, 15), turns: 1 }), 'LEAGUE_TEAM_LOCKED');
    assert.equal(await err({ t: 'league_new', teams: [{ team: 0, com: false }, { team: 1, com: false }], turns: 1 }), 'LEAGUE_INVALID');
    assert.equal(await err({ t: 'league_new', teams: T(0, 1), turns: 1, rules: { mode: 'knockout', time: 5 } }), 'LEAGUE_INVALID');
    assert.equal(await err({ t: 'league_play', i: 0, j: 1 }), 'LEAGUE_NONE');

    a.send({ t: 'league_new', teams: T(0, 5, 3), turns: 2 });
    const s1 = await a.type('league_state');
    assert.deepEqual(s1.table.map((r) => [r.left, r.rate, r.rank]), [[4, 0, 0], [4, 0, 0], [4, 0, 0]]);
    assert.deepEqual(s1.league.rules, { mode: 'knockout', time: 0 });
    assert.equal(await err({ t: 'league_play', i: 1, j: 1 }), 'LEAGUE_CARD_INVALID'); // 대각선

    const cards = [[0, 1], [0, 1], [0, 2], [2, 1], [1, 2], [2, 0]];
    let last;
    for (const [k, [i, j]] of cards.entries()) {
      a.send({ t: 'league_play', i, j });
      const r = await a.type('league_result');
      assert.equal(r.quick, true); assert.equal(r.left, i); assert.equal(r.right, j);
      assert.ok(r.winner === i || r.winner === j);
      last = await a.type('league_state');
      if (k === 1) assert.equal(await err({ t: 'league_play', i: 1, j: 0 }), 'LEAGUE_CARD_INVALID'); // 같은 카드 3번째
    }
    assert.equal(last.league.done, true);
    assert.deepEqual(last.table.map((r) => r.left), [0, 0, 0]);
    const end = await a.type('league_end');
    const ranks = last.table.filter((r) => r.rank === 0).map((r) => r.idx).sort();
    assert.deepEqual([...end.champions].sort(), ranks);
    assert.ok(end.champions.length >= 1);
    assert.deepEqual(last.champions, end.champions);
    assert.equal(app.lobby.rooms.size, 0); // 즉시 판정은 방을 만들지 않는다

    // 서버 재시작 뒤 이어하기: 같은 파일에서 대전표·승패표 그대로
    app.lobby.leagues.flush(); a.ws.close(); await app.close();
    app = createServer({ store: new MemoryResultStore(), progress, leagues: new JsonLeagueStore(file), log: () => {} });
    port = await app.listen(0);
    a = client(port); await a.open;
    a.send({ t: 'hello', nickname: '리그a' }); await a.type('welcome');
    a.send({ t: 'league_get' });
    const s2 = await a.type('league_state');
    assert.deepEqual(s2.league.res, last.league.res);
    assert.deepEqual(s2.table, last.table);
    assert.ok(wa.token);
  } finally { a.ws.close(); await app.close(); }
});

test('리그 사람 카드: 비공개 방·사람 좌석 0·오른쪽 홈 스테이지·공식 5분, 정상 종료 1회 기록, 기권=패, draw_cap 미기록', async () => {
  const progress = new MemoryProgressStore();
  for (let k = 0; k <= 13; k++) progress.recordResult('리그b', '리그B', k, true); // SPECIAL 해금
  const app = createServer({ store: new MemoryResultStore(), progress, leagues: new MemoryLeagueStore(), log: () => {} });
  const port = await app.listen(0);
  const a = client(port), o = client(port);
  await Promise.all([a.open, o.open]);
  a.send({ t: 'hello', nickname: '리그B' }); await a.type('welcome');
  o.send({ t: 'hello', nickname: '구경꾼' }); await o.type('welcome');
  const roomGame = () => [...app.lobby.rooms.values()][0].game;
  try {
    a.send({ t: 'league_get' });
    assert.equal((await a.type('league_state')).special, true);
    a.send({ t: 'league_new', teams: [{ team: 15, com: true }, { team: 2, com: false }], turns: 3, rules: { mode: 'official', time: 5 } });
    await a.type('league_state');
    // 행 = 컴퓨터(15), 열 = 사람(2) -> 좌우를 바꿔 사람이 왼쪽(좌석 0), 스테이지 = 오른쪽 팀(15)의 홈
    a.send({ t: 'league_play', i: 0, j: 1 });
    const rj = await a.type('room_joined');
    assert.deepEqual(rj.room.league, { i: 0, j: 1 }); assert.equal(rj.you, 0);
    const gs = await a.type('game_start');
    assert.deepEqual(gs.league, { i: 0, j: 1 });
    assert.deepEqual(gs.teams.map((t) => t.id), [2, 15]);
    assert.equal(gs.stage.id, homeStage(data.stages, 15));
    assert.equal(gs.rules.mode, 'official'); assert.equal(gs.rules.limitFrames, 18000);
    o.send({ t: 'list_rooms' });
    assert.deepEqual((await o.type('room_list')).rooms, []);
    a.send({ t: 'set_team', team: 3 }); assert.equal((await a.type('error')).code, 'IN_GAME');
    a.send({ t: 'league_play', i: 0, j: 1 }); assert.equal((await a.type('error')).code, 'ALREADY_IN_ROOM');

    const g1 = roomGame(); g1.finish(0, 'annihilation'); g1.finish(0, 'annihilation'); // 두 번 불러도 1회
    await a.type('game_end');
    const r1 = await a.type('league_result');
    assert.equal(r1.recorded, true); assert.equal(r1.winner, 1); assert.equal(r1.quick, false);
    const st1 = await a.type('league_state');
    assert.deepEqual(st1.league.res[1][0], [1, 0]);
    await a.type('room_left');
    assert.equal(app.lobby.rooms.size, 0);

    // 기권 = 사람 패배
    a.send({ t: 'league_play', i: 1, j: 0 });
    await a.type('game_start');
    a.send({ t: 'leave_room' });
    const r2 = await a.type('league_result');
    assert.equal(r2.reason, 'forfeit_leave'); assert.equal(r2.winner, 0); assert.equal(r2.recorded, true);
    assert.deepEqual((await a.type('league_state')).league.res[1][0], [1, 1]);
    await a.type('room_left');

    // draw_cap 미기록
    a.send({ t: 'league_play', i: 1, j: 0 });
    await a.type('game_start');
    roomGame().finish(-1, 'draw_cap');
    const r3 = await a.type('league_result');
    assert.equal(r3.recorded, false); assert.equal(r3.winner, null);
    assert.deepEqual((await a.type('league_state')).league.res[1][0], [1, 1]);
    await a.type('room_left');
    assert.equal(app.lobby.rooms.size, 0);
  } finally { a.ws.close(); o.ws.close(); await app.close(); }
});

test('리그 레이트 리밋: 리그 전용 창(분당 200)이라 6팀 9턴 135카드 즉시 판정이 막히지 않는다(캠페인 창 30 과 분리)', async () => {
  const { Lobby } = await import('../server/lobby/lobby.js');
  const { loadLimits } = await import('../server/net/limits.js');
  const lobby = new Lobby({ data, store: new MemoryResultStore(), progress: new MemoryProgressStore(), leagues: new MemoryLeagueStore(), build: 't', limits: loadLimits({}), log: () => {} });
  const out = [];
  const conn = { ip: '1.1.1.1', send: (m) => out.push(typeof m === 'string' ? JSON.parse(m) : m), close() {} };
  lobby.onMessage(conn, { t: 'hello', nickname: '리밋' });
  lobby.onMessage(conn, { t: 'league_new', teams: [0, 1, 2, 3, 4, 5].map((team) => ({ team })), turns: 9 });
  const n = 6, cards = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = 0; k < 9; k++) cards.push([i, j]);
  assert.equal(cards.length, 135);
  for (const [i, j] of cards) lobby.onMessage(conn, { t: 'league_play', i, j });
  assert.deepEqual(out.filter((m) => m.t === 'error').map((m) => m.code), []);
  assert.equal(out.filter((m) => m.t === 'league_result').length, 135);
  assert.equal(out.filter((m) => m.t === 'league_end').length, 1);
  // 창 상한(200)은 그대로: 남은 64회 뒤 초과분은 거절(거절도 횟수에 든다)
  for (let k = 0; k < 64; k++) lobby.onMessage(conn, { t: 'league_get' });
  lobby.onMessage(conn, { t: 'league_get' });
  assert.equal(out.at(-1).code, 'CAMPAIGN_RATE_LIMITED');
});
