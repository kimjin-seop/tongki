// 전체 랭킹(pvp_board, PROTOCOL §11.6) 핵심 시험: 정렬(승 -> 승률 -> 판수 -> 닉네임)·동점 같은 rank·me, 손님 me=null
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { openDb } from '../server/store/db.js';
import { RankingStore } from '../server/store/ranking.js';

test('전체 랭킹: 승 내림차순 -> 승률(천분율 정수) -> 판수 -> 닉네임, 동점 같은 rank, 계정 없는 행 제외, me 순위', () => {
  const db = openDb(':memory:');
  const acct = (nick) => db.run("INSERT INTO accounts (key, nick, pw_hash, pw_salt, created_at) VALUES (?, ?, 'h', 's', 0)", nick.toLowerCase(), nick);
  const rec = (nick, w, l) => db.run('INSERT INTO pvp_records (key, nick, w, l, updated_at) VALUES (?, ?, ?, ?, 0)', nick.toLowerCase(), nick, w, l);
  // [닉, 승, 패]: D·B 는 승·승률·판수 같음(동점) -> 닉네임 순으로 B 먼저, 같은 rank
  for (const [n, w, l] of [['Ann', 5, 5], ['B', 6, 2], ['C', 6, 0], ['D', 6, 2], ['E', 5, 0], ['F', 5, 10], ['Z', 3, 0], ['Zero', 0, 0]]) { acct(n); rec(n, w, l); }
  rec('Ghost', 99, 0); // accounts 에 없는 키 = 제외
  acct('Nogame');
  const rs = new RankingStore(db);
  const b = rs.pvpBoard(50, 'd', 'D');
  assert.deepEqual(b.top.map((x) => [x.rank, x.nick, x.w, x.l, x.games, x.rate]), [
    [1, 'C', 6, 0, 6, 1000], [2, 'B', 6, 2, 8, 750], [2, 'D', 6, 2, 8, 750],
    [4, 'E', 5, 0, 5, 1000], [5, 'Ann', 5, 5, 10, 500], [6, 'F', 5, 10, 15, 333], [7, 'Z', 3, 0, 3, 1000],
  ]);
  assert.equal(b.total, 7); // 0판·계정 없는 행 제외
  assert.deepEqual(b.me, { rank: 2, nick: 'D', w: 6, l: 2, games: 8, rate: 750 });
  assert.deepEqual(rs.pvpBoard(2, 'f', 'F').top.map((x) => x.nick), ['C', 'B']); // top 개수 제한
  assert.equal(rs.pvpBoard(2, 'f', 'F').me.rank, 6); // 목록 밖이어도 내 순위
  assert.deepEqual(rs.pvpBoard(50, 'nogame', 'Nogame').me, { rank: null, nick: 'Nogame', w: 0, l: 0, games: 0, rate: 0 });
  db.close();
});

test('pvp_board 요청: 계정은 me 내 줄, 손님은 me=null, top 범위 밖 BAD_MESSAGE', async () => {
  const app = createServer({ store: new MemoryResultStore(), limits: { maxAuthPerMin: 100, maxHelloPerMin: 1000 }, log: () => {} });
  const port = await app.listen(0);
  const cs = [0, 1].map(() => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), q = [], w = [];
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); const i = w.findIndex((x) => x.t === m.t); if (i >= 0) w.splice(i, 1)[0].r(m); else q.push(m); });
    return { ws, q, send: (o) => ws.send(JSON.stringify(o)), type: (t) => { const i = q.findIndex((m) => m.t === t); return i >= 0 ? Promise.resolve(q.splice(i, 1)[0]) : new Promise((r) => w.push({ t, r })); }, open: new Promise((r) => ws.on('open', r)) };
  });
  const [a, g] = cs;
  await Promise.all(cs.map((c) => c.open));
  try {
    a.send({ t: 'register', nickname: '전체A', password: 'aaaaaa' }); await a.type('welcome');
    g.send({ t: 'hello', nickname: '손님B' }); await g.type('welcome');
    app.db.run("INSERT INTO pvp_records (key, nick, w, l, updated_at) VALUES ('전체a', '전체A', 3, 1, 0)");
    a.send({ t: 'pvp_board' });
    const ra = await a.type('pvp_board');
    assert.deepEqual([ra.total, ra.top, ra.me], [1, [{ rank: 1, nick: '전체A', w: 3, l: 1, games: 4, rate: 750 }], { rank: 1, nick: '전체A', w: 3, l: 1, games: 4, rate: 750 }]);
    g.send({ t: 'pvp_board', top: 10 });
    const rg = await g.type('pvp_board');
    assert.deepEqual([rg.total, rg.top.length, rg.me], [1, 1, null]);
    g.send({ t: 'pvp_board', top: 51 });
    assert.equal((await g.type('error')).code, 'BAD_MESSAGE');
    // 래더 화면 요청: 대기 중 창이 넓어지면 ladder_queue 푸시(바뀔 때만), 래더 방 좌석에 placementLeft
    a.send({ t: 'ladder_join' }); assert.equal((await a.type('ladder_queue')).window, 100);
    const t0 = Date.now(); app.lobby.now = () => t0 + 15500;
    app.lobby.tickLadder(); assert.equal((await a.type('ladder_queue')).window, 200);
    app.lobby.tickLadder(); await new Promise((r) => setTimeout(r, 100));
    assert.equal(a.q.some((m) => m.t === 'ladder_queue'), false); // 바뀐 것이 없으면 다시 보내지 않는다
    assert.equal(app.lobby.ladder.size, 1);
    g.send({ t: 'ladder_join' }); assert.equal((await g.type('error')).code, 'ACCOUNT_REQUIRED'); // 래더 = 계정만
    g.send({ t: 'register', nickname: '손님B', password: 'bbbbbb' }); await g.type('account_ok');
    g.send({ t: 'ladder_join' }); // 가입 승격 뒤 짝(창 200 안)
    const { room } = await a.type('room_joined');
    const me = room.slots.find((x) => x.nick === '전체A');
    assert.deepEqual([me.placement, me.placementLeft], [true, 5]);
  } finally { for (const c of cs) c.ws.close(); await app.close(); }
});
