// 불꽃의 계승 팀 스냅샷(B149: 사용자 저장 3칸 s1~s3, 자동 recent·best 폐지) + 컴퓨터 대전에서 그 팀 고르기(analysis/39 D33~D36·B149, PROTOCOL §13.20). 핵심 동작 + 에러 없음만 본다:
// 정산은 자동 저장하지 않고 종료 팀(ended)만 남긴다 / 옛 best->s1·recent->s2 한 번 변환 / 저장한 칸으로 컴퓨터 대전 = 그 팀 능력치·가득 찬 HP / 거절·삭제·팀 이름·손님 유지.
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
import { loadCatalog, teamShortOf } from '../server/flame/catalog.js';
import { freshProfile, sanitizeProfile } from '../server/flame/save.js';
import { candidates } from '../server/flame/map.js';
import { teamOfRun, toEngine } from '../server/flame/stats.js';
import { versusOptions, sanitizeTeam, snapCard } from '../server/flame/teams.js';
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

test('팀 스냅샷(B149): 정산은 recent·best 를 쓰지 않고 종료 팀(ended)만 남긴다. 옛 best->s1·recent->s2 는 한 번만 옮기고(같은 팀이면 s1 만) 옛 칸은 보존. DB 를 다시 열어도 같다. 없어진 id 는 그 칸만 버린다', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'flame-team-')), 't.db');
  const profile = freshProfile();
  profile.coins = 500; Run.buyPerm(cat, profile, 'PA01');
  const a = playUntilLoss(profile, 31, 2, 1000);
  const E = profile.teams.ended;
  assert.deepEqual([a.end.counted, a.end.teamSave, a.end.teams, Object.keys(profile.teams), E.wins, E.seg, E.at], [true, true, { recent: false, best: false }, ['ended'], 2, 1, 1000]);
  assert.deepEqual(E.perm, { PA01: 1 }); // 영구 성장 = 저장 시점 값
  assert.deepEqual(Object.keys(E).sort(), ['arts', 'at', 'diff', 'fm', 'origTeam', 'perm', 'roster', 'seg', 'v', 'wins']); // 재료만(HP·소모품·이름 없음)
  // 쓸 때 다시 계산한 능력치 = 종료 시점 팀의 능력치, 시작 HP = 최대 HP. 카드(snapCard)도 같은 값
  const end = teamOfRun(cat, data, { ...a.run, buffs: [], surviveCount: 0 }, profile.perm).players.map((p) => toEngine(p).stat);
  const vs = versusOptions(cat, data, E);
  assert.deepEqual([vs.flame.roster.map((r) => r.stat), vs.flame.roster.map((r) => r.hp)], [end, end.map((x) => x.hp)]);
  const card = snapCard(cat, data, 's1', E);
  assert.deepEqual([card.players.length, card.players.map((p) => p.hpMax), card.players.map((p) => p.field), card.players[0].captain], [7, end.map((x) => x.hp), ['in', 'in', 'in', 'in', 'out', 'out', 'out'], true]);
  assert.equal(snapCard(cat, data, 's2', null), null);
  assert.deepEqual(['Boss국민학교', '불꽃 국민학교', 'sss국민학교', '국민학교', '번개 팀'].map(teamShortOf), ['Boss', '불꽃', 'sss', '국민학교', '번개 팀']); // 정한 이름의 약칭(B156)

  // 옛 저장(snapV 없음) 변환: best -> s1, recent -> s2, 옛 칸 보존. 다시 읽어도(snapV 1) 지운 칸을 되살리지 않는다
  const other = structuredClone(E); other.at = 999; other.wins = 1;
  const old = { ...structuredClone(profile), teams: { best: E, recent: other } }; delete old.snapV;
  const m1 = sanitizeProfile(cat, old);
  assert.deepEqual([m1.teams.s1.at, m1.teams.s2.at, m1.teams.best.at, m1.teams.recent.at, m1.snapV], [1000, 999, 1000, 999, 1]);
  delete m1.teams.s1;
  assert.equal(sanitizeProfile(cat, m1).teams.s1, undefined); // 멱등
  const same = { ...old, teams: { best: E, recent: structuredClone(E) } };
  assert.deepEqual(Object.keys(sanitizeProfile(cat, same).teams).sort(), ['best', 'recent', 's1']); // 같은 도전의 팀이면 s1 하나

  // 저장 -> DB 닫고 다시 열기(서버 재시작) -> 그대로
  profile.teams.s1 = structuredClone(E);
  let db = openDb(file);
  new SqliteFlameStore(db).save('k', 'K', profile, null);
  db.close(); db = openDb(file);
  assert.deepEqual(sanitizeProfile(cat, new SqliteFlameStore(db).getProfile('k')), profile);
  db.close();

  // 경기 없는 도전(시작 직후 포기)은 종료 팀을 바꾸지 않는다
  assert.equal(Run.settle(cat, Run.newRun(cat, data, profile, { seed: 33 }), profile, 'abandon', 0, 3000).teamSave, false);
  assert.equal(profile.teams.ended.at, 1000);

  // 없어진 아이템·아티팩트·클론 id: 그 칸만 버리고 팀은 산다. 7명이 아니면 그 칸만 없음
  const broken = structuredClone(E);
  broken.roster[0].equip = { ...broken.roster[0].equip, headband: { id: 'NOPE', lv: 9 } }; broken.arts[0] = 'A99'; broken.roster[1].clone = 'c999999'; broken.roster[2].stat = { hp: 999 };
  const fixed = sanitizeTeam(cat, broken);
  assert.deepEqual([fixed.roster.length, fixed.roster[0].equip.headband, fixed.arts[0], 'clone' in fixed.roster[1], 'stat' in fixed.roster[2]], [7, null, null, false, false]);
  assert.ok(versusOptions(cat, data, fixed));
  assert.equal(sanitizeProfile(cat, { ...profile, teams: { s1: { ...E, roster: E.roster.slice(0, 6) } } }).teams, undefined);
});

test('스냅샷 저장·대전(B149): 종료 화면·도전 중 지도에서 flame_snap_save -> flame_state.profile.teams 카드, set_team{flame:s1} -> 그 팀 능력치·HP 가득으로 컴퓨터 대전(도전·저장 그대로). 거절: 옛 참조·방 안 저장·빈 칸 삭제·사람끼리 방. 팀 이름. 손님 저장 유지·방 안 flame_get', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flame-versus-')), results = new MemoryResultStore();
  const app = createServer({ store: results, dbPath: path.join(dir, 't.db'), importJson: false, flameSeed: 21, log: () => {} });
  const port = await app.listen(0);
  const roomOf = (nick) => [...app.lobby.rooms.values()].find((r) => r.seats[0]?.s.nick === nick);
  try {
    const a = client(port); await a.open;
    a.send({ t: 'hello', nickname: '키운A' }); await a.type('welcome'); // 손님
    // 도전 한 판: 시작 장비를 받아 끼고 첫 경기를 이긴 뒤 둘째 경기에서 진다
    a.send({ t: 'flame_new' }); let st = await a.type('flame_state');
    assert.deepEqual([st.profile.played, st.profile.teams, st.profile.teamName, st.profile.teamNameDefault], [true, { s1: null, s2: null, s3: null }, null, '불꽃국민학교']);
    a.send({ t: 'flame_choose', i: 0 }); await a.type('flame_state');
    a.send({ t: 'flame_auto_equip' });
    st = await a.type('flame_state');
    a.send({ t: 'flame_node', id: st.run.candidates[0] }); await a.type('game_start');
    roomOf('키운A').game.finish(0, 'annihilation');
    await a.type('flame_result'); st = await a.type('flame_state'); await a.type('room_left');
    for (let n = 0; n < 6 && !st.run.candidates.length; n++) { a.send({ t: 'flame_choose', i: -1 }); st = await a.type('flame_state'); }
    let last = null;
    for (let n = 0; n < 6 && !last; n++) {
      a.send({ t: 'flame_node', id: st.run.candidates[0] });
      const m = await a.wait((x) => x.t === 'game_start' || x.t === 'flame_state');
      if (m.t === 'game_start') { last = m; break; }
      st = m;
      if (st.run.pending.length) a.send({ t: 'flame_choose', i: st.run.pending[0].kind === 'recruit' ? -1 : 0, p: 0 }); else a.send({ t: 'flame_leave' });
      st = await a.type('flame_state');
    }
    assert.ok(last?.flame);
    assert.equal(await a.err({ t: 'flame_snap_save', slot: 's1' }, 10), 'ALREADY_IN_ROOM'); // 경기 중 저장 불가
    roomOf('키운A').game.finish(1, 'annihilation'); // 패배 = 도전 종료
    const end = await a.type('flame_end');
    st = await a.type('flame_state'); await a.type('room_left');
    assert.deepEqual([end.summary.teamSave, st.run, st.profile.teamEnded, st.profile.teams.s1], [true, null, true, null]); // 자동 저장 없음
    // 종료 화면에서 s1 에 저장
    a.send({ t: 'flame_snap_save', slot: 's1' });
    st = await a.wait((m) => m.t === 'flame_state' && m.snapSaved === 's1');
    const c1 = st.profile.teams.s1;
    assert.deepEqual([c1.wins, c1.usable, c1.players.length, c1.team.name, Object.keys(c1.players[0].equip).length], [1, true, 7, '불꽃국민학교', cat.slots.length]);
    assert.equal(await a.err({ t: 'flame_snap_delete', slot: 's3' }, 11), 'FLAME_TEAM_NONE');
    assert.equal(await a.err({ t: 'flame_snap_save', slot: 's9' }, 12), 'BAD_MESSAGE');
    assert.equal(await a.err({ t: 'flame_team_name', name: 'a'.repeat(13) }, 13), 'FLAME_TEAM_NAME_LONG');
    assert.equal(await a.err({ t: 'flame_team_name', name: '불꽃!!' }, 14), 'FLAME_TEAM_NAME_INVALID');
    a.send({ t: 'flame_team_name', name: '  번개   팀 ' }); st = await a.type('flame_state');
    assert.deepEqual([st.profile.teamName, st.profile.teams.s1.team.name], ['번개 팀', '불꽃국민학교']); // 스냅샷은 저장 시점 이름 고정

    // 새 도전(종료 팀은 버려진다) -> 지도에서 s2 에 저장(이름 = 지금 이름)
    a.send({ t: 'flame_new' }); const before0 = await a.type('flame_state');
    assert.deepEqual([before0.profile.teamEnded, before0.run.cast.team.name], [false, '번개 팀']);
    assert.equal(await a.err({ t: 'flame_snap_save', slot: 's3', src: 'ended' }, 15), 'FLAME_NONE'); // 새 도전이 시작되면 종료 팀은 없다
    a.send({ t: 'flame_snap_save', slot: 's2' }); const before = await a.wait((m) => m.t === 'flame_state' && m.snapSaved === 's2');
    assert.deepEqual([before.profile.teams.s2.wins, before.profile.teams.s2.team.name, before.profile.teams.s1.at], [0, '번개 팀', c1.at]);
    const stored = JSON.stringify([app.lobby.flame.getProfile('키운a'), app.lobby.flame.getRun('키운a')]), nRec = results.records.length;
    a.send({ t: 'create_room', vsCpu: true }); await a.type('room_joined');
    assert.equal(await a.err({ t: 'set_team', team: 'flame:recent' }, 1), 'TEAM_INVALID'); // 폐지된 참조
    assert.equal(await a.err({ t: 'set_team', team: 'flame:hack' }, 7), 'TEAM_INVALID'); // 위조 값
    assert.equal(await a.err({ t: 'set_team', team: { slot: 's1' } }, 8), 'TEAM_INVALID');
    assert.equal(await a.err({ t: 'set_team', team: 'flame:s3' }, 2), 'FLAME_TEAM_NONE'); // 빈 칸
    assert.equal(await a.err({ t: 'flame_snap_save', slot: 's3' }, 3), 'ALREADY_IN_ROOM'); // 방 안 저장 불가
    a.send({ t: 'set_team', team: 'flame:s1' });
    const rs = await a.wait((m) => m.t === 'room_state' && m.room.slots[0].flameTeam);
    const ft = rs.room.slots[0].flameTeam;
    assert.deepEqual([ft.slot, ft.wins, ft.players.length, 'final' in ft.players[0], 'equip' in ft.players[0]], ['s1', 1, 7, false, false]); // 상대도 보는 값: 능력치·장비 없음
    const room = roomOf('키운A');
    let saves = 0;
    const save = app.lobby.flame.save;
    app.lobby.flame.save = (...x) => { saves++; return save.apply(app.lobby.flame, x); };
    a.send({ t: 'start' });
    const gs = await a.type('game_start');
    assert.deepEqual([gs.flame, gs.flameVs.mode, gs.flameVs.slot, gs.teams[0].flame], [undefined, 'versus', 's1', true]);
    const pick = (p) => STATS.map((k) => p[k]);
    assert.deepEqual(gs.teams[0].players.map(pick), last.teams[0].players.map(pick)); // 종료 시점(마지막 도전 경기) 팀 능력치
    assert.ok(gs.teams[0].players.every((p) => p.hp0 === p.hp)); // HP 가득
    assert.deepEqual(gs.teams[0].players.map((p) => p.hp), c1.players.map((p) => p.hpMax)); // 카드의 최대 HP = 실제 시작 HP
    for (let i = 0; i < 60; i++) room.game.match.tick([0, 0]);
    a.drop('room_state');
    room.game.finish(0, 'annihilation');
    await a.wait((m) => m.t === 'room_state' && m.room.status === 'waiting');
    a.send({ t: 'flame_get' }); const after = await a.type('flame_state'); // 방 안에서도 flame_get 응답
    app.lobby.flame.save = save;
    assert.deepEqual(after.profile, before.profile);
    assert.deepEqual([saves, results.records.length, JSON.stringify([app.lobby.flame.getProfile('키운a'), app.lobby.flame.getRun('키운a')])], [0, nRec, stored]);
    a.send({ t: 'leave_room' }); await a.type('room_left');
    a.send({ t: 'create_room', rules: { flameTeams: false } }); await a.type('room_joined');
    assert.equal(await a.err({ t: 'set_team', team: 'flame:s1' }, 6), 'FLAME_TEAM_ROOM'); // 허용하지 않은 사람끼리 방
    a.send({ t: 'leave_room' }); await a.type('room_left');
    a.send({ t: 'flame_snap_delete', slot: 's2' }); st = await a.wait((m) => m.t === 'flame_state' && m.snapDeleted === 's2');
    assert.equal(st.profile.teams.s2, null);
    // 진행 중 도전이 있을 때 flame_new(리뷰 M): 포기 정산 요약은 teamSave:false, 종료 팀 지정 저장은 FLAME_NONE(새 도전 시작 팀으로 덮이지 않는다)
    a.send({ t: 'flame_new' }); const ab = await a.type('flame_end'); await a.type('flame_state');
    assert.equal(ab.summary.teamSave, false);
    assert.equal(await a.err({ t: 'flame_snap_save', slot: 's1', src: 'ended' }, 16), 'FLAME_NONE');
    assert.equal(await a.err({ t: 'flame_snap_save', slot: 's1', src: 'nope' }, 17), 'BAD_MESSAGE');
    a.ws.close();
    // 손님 저장은 같은 닉네임으로 다시 접속해도 남는다(키 = 닉네임 소문자)
    await new Promise((r) => setTimeout(r, 50));
    const a2 = client(port); await a2.open;
    a2.send({ t: 'hello', nickname: '키운A' }); const w = await a2.type('welcome');
    a2.send({ t: 'flame_get' }); const st2 = await a2.type('flame_state');
    assert.deepEqual([w.account, st2.profile.teams.s1.at, st2.profile.teamName], [false, c1.at, '번개 팀']);
    // 해 본 적 없는 사람: played false, 3칸 빔
    const b = client(port); await b.open;
    b.send({ t: 'hello', nickname: '처음B' }); await b.type('welcome');
    b.send({ t: 'flame_get' }); const sb = await b.type('flame_state');
    assert.deepEqual([sb.profile.played, sb.profile.teams], [false, { s1: null, s2: null, s3: null }]);
    a2.ws.close(); b.ws.close();
  } finally { await app.close(); }
});
