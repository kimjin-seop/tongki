// 불꽃의 계승 「키운 팀」 슬롯 + 컴퓨터 대전에서 그 팀 고르기(analysis/39 D33~D36, PROTOCOL §13.20). 핵심 동작 + 에러 없음만 본다:
// 도전 종료 때 최근/최고 저장·재시작 뒤 유지 / 컴퓨터 대전에서 고르면 종료 시점 팀의 능력치로 가득 찬 HP 로 시작하고 도전·코인·기록·결과 레코드가 그대로 / 거절 경로.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadData } from '../server/engine/index.js';
import { createServer } from '../server/index.js';
import { openDb } from '../server/store/db.js';
import { MemoryResultStore } from '../server/store/results.js';
import { SqliteFlameStore } from '../server/store/flame.js';
import { loadCatalog } from '../server/flame/catalog.js';
import { freshProfile, sanitizeProfile } from '../server/flame/save.js';
import { candidates } from '../server/flame/map.js';
import { teamOfRun, toEngine } from '../server/flame/stats.js';
import { versusOptions, sanitizeTeam } from '../server/flame/teams.js';
import * as Items from '../server/flame/items.js';
import * as Run from '../server/flame/run.js';

const data = loadData(), cat = loadCatalog();
const STATS = ['hp', 'def', 'spd', 's3', 'pow', 's5', 'thr', 'pass'];

/** 시작 보상을 받아 끼고 경기 노드만 골라 wins 번 이긴 뒤 다음 경기에서 진다(wins 0 = 첫 경기 패배). 반환 = {run(종료 시점), end} */
function playUntilLoss(profile, seed, wins, now) {
  const run = Run.newRun(cat, data, profile, { seed, now: now - 1 });
  for (let n = 0; n < 40; n++) {
    while (run.pending.length) { const p = run.pending[0]; Run.choose(cat, data, run, profile, p.kind === 'equipment' ? 0 : -1, 6); if (p.kind === 'equipment') Items.autoEquip(cat, run); }
    const node = candidates(run).find((c) => c.opp) ?? candidates(run)[0];
    const r = Run.enterNode(cat, data, run, profile, node.id);
    if (!r.match) { // 경기가 아닌 노드: 영입은 넘기고, 휴식·이벤트는 되는 선택지를 고르고, 상점·특훈장은 나간다
      if (!run.pending.length) Run.leaveNode(run);
      else if (run.pending[0].kind === 'recruit') Run.choose(cat, data, run, profile, -1);
      else { try { Run.choose(cat, data, run, profile, 0, 0); } catch { Run.choose(cat, data, run, profile, 1, 0); } }
      continue;
    }
    const win = run.wins.normal + run.wins.strong + run.wins.boss;
    const out = Run.applyMatchResult(cat, data, run, profile, { winner: win < wins ? 0 : 1, reason: 'annihilation', rem: [3, 3], flame: { hp: r.match.flame.roster.map((x) => Math.max(1, x.hp - 9)), surviveUsed: [] } }, now);
    if (out.end) return { run, end: out.end };
  }
  return assert.fail('도전이 끝나지 않음');
}

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
    drop(t) { for (let i = q.length - 1; i >= 0; i--) if (q[i].t === t) q.splice(i, 1); }, // 이미 받아 둔 그 종류의 메시지를 버린다
    async err(o, ref) { this.send({ ...o, ref }); return (await this.wait((m) => m.t === 'error' && m.ref === ref)).code; },
  };
}

test('키운 팀 슬롯(D33): 경기를 치른 도전이 끝나면 최근·최고에 재료만 저장되고 DB 를 다시 열어도 남는다. 기록을 넘지 못한 도전은 최근만 덮고, 경기 없는 도전은 아무것도 바꾸지 않는다. 없어진 id 는 그 칸만 버린다', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'flame-team-')), 't.db');
  const profile = freshProfile();
  profile.coins = 500; Run.buyPerm(cat, profile, 'PA01');
  const a = playUntilLoss(profile, 31, 2, 1000);
  const T = profile.teams;
  assert.deepEqual([a.end.counted, T.recent.wins, T.recent.seg, T.recent.at, T.best], [true, 2, 1, 1000, T.recent]);
  assert.deepEqual(T.recent.perm, { PA01: 1 });
  assert.deepEqual(T.recent.roster.map((r) => r.from), a.run.roster.map((r) => r.from)); // 구성·순서
  assert.ok(T.recent.roster.some((r) => Object.values(r.equip).some(Boolean))); // 낀 장비(id·강화 단계)
  // 재료만: 현재 HP·포인트·소모품·지도·비밀값·끼지 않은 장비·이름은 없다
  assert.deepEqual(Object.keys(T.recent).sort(), ['arts', 'at', 'diff', 'fm', 'origTeam', 'perm', 'roster', 'seg', 'v', 'wins']);
  assert.ok(T.recent.roster.every((r) => !('hp' in r) && !('name' in r) && !('skin' in r)));
  // 쓸 때 다시 계산한 능력치 = 종료 시점 팀의 능력치, 시작 HP = 최대 HP
  const end = teamOfRun(cat, data, { ...a.run, buffs: [], surviveCount: 0 }, profile.perm).players.map((p) => toEngine(p).stat);
  const vs = versusOptions(cat, data, T.recent);
  assert.deepEqual(vs.flame.roster.map((r) => r.stat), end);
  assert.deepEqual(vs.flame.roster.map((r) => r.hp), end.map((s) => s.hp));

  // 저장 -> DB 닫고 다시 열기(서버 재시작) -> 그대로
  let db = openDb(file);
  new SqliteFlameStore(db).save('k', 'K', profile, null);
  db.close(); db = openDb(file);
  assert.deepEqual(sanitizeProfile(cat, new SqliteFlameStore(db).getProfile('k')), profile);
  db.close();

  // 리뷰 L1: 구간·승수가 같은 동률 도전은(시작 시각이 기록 시각보다 앞서도) 최고 슬롯을 덮지 않는다
  playUntilLoss(profile, 34, 2, 1001);
  assert.deepEqual([profile.teams.recent.at, profile.teams.best], [1001, T.best]);

  // 기록을 넘지 못한 도전(첫 경기 패배): 최근만 바뀐다. 경기 없는 도전(시작 직후 포기): 둘 다 그대로
  const best = structuredClone(T.best);
  playUntilLoss(profile, 32, 0, 2000);
  assert.deepEqual([profile.teams.recent.wins, profile.teams.recent.at, profile.teams.best], [0, 2000, best]);
  const recent = structuredClone(profile.teams.recent);
  assert.equal(Run.settle(cat, Run.newRun(cat, data, profile, { seed: 33 }), profile, 'abandon', 0, 3000).counted, false);
  assert.deepEqual(profile.teams, { recent, best });

  // 없어진 아이템·아티팩트·클론 id: 그 칸만 버리고 팀은 산다. 7명이 아니면 그 슬롯만 없음
  const broken = structuredClone(best);
  broken.roster[0].equip = { ...broken.roster[0].equip, headband: { id: 'NOPE', lv: 9 } }; broken.arts[0] = 'A99'; broken.roster[1].clone = 'c999999'; broken.roster[2].stat = { hp: 999 };
  const fixed = sanitizeTeam(cat, broken);
  assert.deepEqual([fixed.roster.length, fixed.roster[0].equip.headband, fixed.arts[0], 'clone' in fixed.roster[1], 'stat' in fixed.roster[2]], [7, null, null, false, false]);
  assert.ok(versusOptions(cat, data, fixed));
  assert.equal(sanitizeProfile(cat, { ...profile, teams: { recent: { ...best, roster: best.roster.slice(0, 6) }, best } }).teams.recent, undefined);
});

test('컴퓨터 대전에서 키운 팀 고르기(D34): set_team{flame:recent} -> game_start{flameVs} 의 능력치가 종료 시점 팀과 같고 HP 가 가득하다. 끝나면 대기실로 돌아오고 진행 중인 도전·코인·기록·결과 레코드·저장이 그대로다. 거절: 위조 값·슬롯 없음·사람끼리 방·랭크 방·공식 규칙', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flame-versus-')), results = new MemoryResultStore();
  const app = createServer({ store: results, dbPath: path.join(dir, 't.db'), importJson: false, flameSeed: 21, log: () => {} });
  const port = await app.listen(0);
  const roomOf = (nick) => [...app.lobby.rooms.values()].find((r) => r.seats[0]?.s.nick === nick);
  try {
    const a = client(port); await a.open;
    a.send({ t: 'hello', nickname: '키운A' }); await a.type('welcome');
    // 도전 한 판: 시작 장비를 받아 끼고 첫 경기를 이긴 뒤 둘째 경기에서 진다
    a.send({ t: 'flame_new' }); await a.type('flame_state');
    a.send({ t: 'flame_choose', i: 0 }); await a.type('flame_state');
    a.send({ t: 'flame_auto_equip' });
    let st = await a.type('flame_state');
    a.send({ t: 'flame_node', id: st.run.candidates[0] }); await a.type('game_start');
    roomOf('키운A').game.finish(0, 'annihilation');
    await a.type('flame_result'); st = await a.type('flame_state'); await a.type('room_left');
    for (let n = 0; n < 6 && !st.run.candidates.length; n++) { // 승리 보상(받지 않음)
      a.send({ t: 'flame_choose', i: -1 }); st = await a.type('flame_state');
    }
    let last = null;
    for (let n = 0; n < 6 && !last; n++) { // 다음 경기 노드까지(경기가 아닌 노드는 건너뛴다: 첫 선택지를 고르거나 나간다)
      a.send({ t: 'flame_node', id: st.run.candidates[0] });
      const m = await a.wait((x) => x.t === 'game_start' || x.t === 'flame_state');
      if (m.t === 'game_start') { last = m; break; }
      st = m;
      if (st.run.pending.length) a.send({ t: 'flame_choose', i: st.run.pending[0].kind === 'recruit' ? -1 : 0, p: 0 }); else a.send({ t: 'flame_leave' });
      st = await a.type('flame_state');
    }
    assert.ok(last?.flame && last.teams[0].flame);
    roomOf('키운A').game.finish(1, 'annihilation'); // 패배 = 도전 종료
    const end = await a.type('flame_end');
    st = await a.type('flame_state'); await a.type('room_left');
    assert.deepEqual([end.summary.counted, st.run, st.profile.teams.recent.wins, st.profile.teams.best.wins, st.profile.teams.recent.core.length], [true, null, 1, 1, 3]);

    // 진행 중인 도전을 하나 둔 채 컴퓨터 대전 방에서 고른다
    a.send({ t: 'flame_new' });
    const before = await a.type('flame_state');
    const stored = JSON.stringify([app.lobby.flame.getProfile('키운a'), app.lobby.flame.getRun('키운a')]), nRec = results.records.length;
    a.send({ t: 'create_room', vsCpu: true }); await a.type('room_joined');
    assert.equal(await a.err({ t: 'set_team', team: 'flame:hack' }, 1), 'TEAM_INVALID'); // 위조 값
    assert.equal(await a.err({ t: 'set_team', team: { slot: 'recent' } }, 2), 'TEAM_INVALID');
    a.send({ t: 'set_team', team: 'flame:recent' });
    const rs = await a.wait((m) => m.t === 'room_state' && m.room.slots[0].flameTeam);
    const room = roomOf('키운A');
    assert.deepEqual([rs.room.slots[0].flameTeam.slot, rs.room.slots[0].flameTeam.wins, rs.room.flame, rs.room.slots[1].team === rs.room.slots[0].team], ['recent', 1, undefined, false]);
    assert.equal(await a.err({ t: 'set_rules', rules: { mode: 'official' } }, 3), 'FLAME_TEAM_RULES'); // 체력제 고정
    let saves = 0;
    const save = app.lobby.flame.save;
    app.lobby.flame.save = (...x) => { saves++; return save.apply(app.lobby.flame, x); };
    a.send({ t: 'start' });
    const gs = await a.type('game_start');
    // 도전 경기 표시(game_start.flame)가 없고 flameVs 로 구분된다. 능력치 = 종료 시점(마지막 도전 경기) 팀, 시작 HP = 최대 HP
    assert.deepEqual([gs.flame, gs.flameVs.mode, gs.flameVs.slot, gs.flameVs.seat, gs.flameCast.versus, gs.teams[0].flame, gs.rules.mode], [undefined, 'versus', 'recent', 0, true, true, 'knockout']);
    const pick = (p) => STATS.map((k) => p[k]);
    assert.deepEqual(gs.teams[0].players.map(pick), last.teams[0].players.map(pick));
    assert.deepEqual(gs.teams[0].players.map((p) => p.from), last.teams[0].players.map((p) => p.from));
    assert.ok(gs.teams[0].players.every((p) => p.hp0 === p.hp));
    assert.ok(!gs.teams[0].players.some((p) => p.from.team === gs.teams[1].id)); // 상대는 내 로스터의 몸 출처 팀이 아니다(D36)
    for (let i = 0; i < 120; i++) room.game.match.tick([0, 0]); // 엔진이 조립된 옵션으로 돈다
    a.drop('room_state');
    room.game.finish(0, 'annihilation');
    const ge = await a.wait((m) => m.t === 'game_end' && m.matchId === gs.matchId);
    const back = await a.wait((m) => m.t === 'room_state' && m.room.status === 'waiting');
    assert.deepEqual([ge.flame, Array.isArray(ge.flameVs.hp), back.room.slots[0].flameTeam.slot, app.lobby.rooms.size], [undefined, true, 'recent', 1]); // 대기실 복귀(방·선택 유지)
    a.send({ t: 'flame_get' });
    const after = await a.type('flame_state');
    app.lobby.flame.save = save;
    assert.deepEqual(after, before); // 진행 중인 도전·코인·최고 기록·슬롯 그대로
    assert.deepEqual([saves, results.records.length, JSON.stringify([app.lobby.flame.getProfile('키운a'), app.lobby.flame.getRun('키운a')])], [0, nRec, stored]); // 저장·결과 레코드 없음
    a.send({ t: 'set_team', team: 3 }); // 원작 팀으로 돌아가면 선택이 풀린다
    assert.equal((await a.wait((m) => m.t === 'room_state' && m.room.slots[0].team === 3)).room.slots[0].flameTeam, undefined);

    // 거절: 슬롯 없음(도전을 끝낸 적 없는 사람) / 사람끼리 방 / 랭크 방
    const b = client(port); await b.open;
    b.send({ t: 'register', nickname: '키운B', password: 'pw123456' }); await b.type('welcome');
    b.send({ t: 'create_room', vsCpu: true }); await b.type('room_joined');
    assert.equal(await b.err({ t: 'set_team', team: 'flame:best' }, 4), 'FLAME_TEAM_NONE');
    b.send({ t: 'leave_room' }); await b.type('room_left');
    b.send({ t: 'create_room', ranked: true }); await b.type('room_joined');
    assert.equal(await b.err({ t: 'set_team', team: 'flame:recent' }, 5), 'FLAME_TEAM_ROOM');
    a.send({ t: 'leave_room' }); await a.type('room_left');
    a.send({ t: 'create_room' }); await a.type('room_joined');
    assert.equal(await a.err({ t: 'set_team', team: 'flame:recent' }, 6), 'FLAME_TEAM_ROOM'); // 슬롯이 있어도 사람끼리 방은 거절
    a.ws.close(); b.ws.close();
  } finally { await app.close(); }
});
