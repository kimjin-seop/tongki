// 불꽃의 계승 2차: 사람끼리 방에서 키운 팀으로 대전(analysis/39 D53~, PROTOCOL §13.20·§13.23). 핵심 동작 + 에러 없음만 본다:
// 엔진 두 좌석(좌석별 allow·famOf·caps·surviveUsed, 가로챈 패스) / 로비 두 클라이언트 흐름(허용 규칙·옵션 조립·고정·재접속 같은 값·저장 0회·결과 레코드 표시 칸·거절) / flame_end.summary.teams.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { Match, loadData } from '../server/engine/index.js';
import { flHitDmg, flThrowPow, flThrowSpd, flActiveId } from '../server/engine/flame.js';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { loadCatalog } from '../server/flame/catalog.js';
import { freshProfile } from '../server/flame/save.js';
import { candidates } from '../server/flame/map.js';
import { versusOptions } from '../server/flame/teams.js';
import * as Items from '../server/flame/items.js';
import * as Run from '../server/flame/run.js';

const data = loadData(), cat = loadCatalog();
const STATS = ['hp', 'def', 'spd', 's3', 'pow', 's5', 'thr', 'pass'];

/** flame_versus_team.test.js 와 같은 봇: 시작 보상을 끼고 경기 노드만 골라 wins 번 이긴 뒤 진다 */
function playUntilLoss(profile, seed, wins, now) {
  const run = Run.newRun(cat, data, profile, { seed, now: now - 1 });
  for (let n = 0; n < 40; n++) {
    while (run.pending.length) { const p = run.pending[0]; Run.choose(cat, data, run, profile, p.kind === 'equipment' ? 0 : -1, 6); if (p.kind === 'equipment') Items.autoEquip(cat, run); }
    const node = candidates(run).find((c) => c.opp) ?? candidates(run)[0];
    const r = Run.enterNode(cat, data, run, profile, node.id);
    if (!r.match) {
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

/** 엔진 시험용 최소 로스터: 원작 팀 t 의 7명 그대로 + 필살기 슬롯·fx 만 준다 */
const roster = (t, fx = {}, sp = null) => Array.from({ length: 7 }, (_, i) => ({ from: { team: t, idx: i }, sp: [i === 0 ? sp : null, null], fx: i === 0 ? fx : {} }));

test('엔진 두 좌석(D53): 좌석별 allow·famOf·caps·surviveUsed 가 섞이지 않고, 가로챈 패스에 보너스가 남지 않으며, 양 좌석 컴퓨터가 끝까지 예외 없이 돈다. 단일 객체·1칸 배열은 종전 형식 그대로', () => {
  const SP = data.specials.power.findIndex((v, i) => i > 0 && v !== 255); // 쓸 수 있는 필살기 ID 하나
  const A = { seat: 0, roster: roster(3, { famPow: { fire: 40 }, survive: 1, passSpd: 5 }, SP), allow: [SP], families: { fire: [SP] }, caps: { counterBonus: true, walkCap: false } };
  const B = { seat: 1, roster: roster(8, { survive: 1 }, SP), allow: [], families: {} };
  const m = new Match({ seed: 6, teams: [0, 0], data, humans: [false, false], cpuLevels: [2, 2], flame: [A, B] });
  const a = m.players[0], b = m.players[7];
  // 해금·계열은 좌석 것: B 는 같은 ID 를 슬롯에 넣어도 잠겨 있고(A 의 allow 를 합집합으로 쓰지 않는다), A 의 계열 가산이 B 에 붙지 않는다
  assert.deepEqual([flActiveId(m.fls[0], a), flActiveId(m.fls[1], b), b.fl.sp[0]], [SP, null, SP]);
  assert.equal(flThrowPow(m, a, 100, { air: false, ch: 0, spId: SP, counter: false }), 140);
  assert.equal(flThrowPow(m, b, 100, { air: false, ch: 0, spId: SP, counter: false }), 100);
  // caps 도 좌석 것: 받아치기 가산은 A(counterBonus true)만, 걷기 상한은 B(기본 walkCap)만
  a.flPassSpd = 2; b.flPassSpd = 2;
  assert.deepEqual([flThrowSpd(m, a, 0x300, true), flThrowSpd(m, b, 0x300, true)], [0x300 + (2 << 4), 0x300]);
  assert.deepEqual([m.fls[0].caps.walkCap, m.fls[1].caps.walkCap], [false, true]);
  // 패스 보너스: A 가 패스한 공을 B 가 가로채면(수신 아님) 아무도 받지 않는다. 같은 편 수신만 옮긴다
  b.flPassSpd = 3; m.ball.flPass = a.fl.fx.passSpd; m.giveBall(b);
  assert.deepEqual([b.flPassSpd, m.ball.flPass | 0], [0, 0]);
  m.ball.flPass = a.fl.fx.passSpd; m.giveBall(m.players[1], 'recv');
  assert.equal(m.players[1].flPassSpd, 5);
  // 치사 생존: 좌석마다 따로 기록된다(flameResult 도 좌석별 배열)
  a.hp = 3; b.hp = 3;
  assert.equal(flHitDmg(m, a, 99, 50), 2);
  assert.deepEqual([m.fls[0].surviveUsed, m.fls[1].surviveUsed], [[0], []]); // A 의 생존이 B 좌석 기록·B 선수 횟수에 닿지 않는다
  assert.deepEqual([flHitDmg(m, b, 99, 50), flHitDmg(m, b, 99, 50)], [2, 50]); // B 는 자기 1회를 그대로 갖고 있다(두 번째는 생존 없음)
  const fr = m.flameResult();
  assert.deepEqual([fr.length, fr[0].seat, fr[1].seat, fr[0].surviveUsed, fr[1].surviveUsed], [2, 0, 1, [0], [0]]);
  assert.deepEqual([m.info().teams[0].flame, m.info().teams[1].flame, m.info().flame.seats.map((x) => x.allow)], [true, true, [[SP], []]]);
  // 같은 좌석 두 번은 예외, 1칸 배열 = 단일 객체와 같은 info
  assert.throws(() => new Match({ seed: 6, teams: [0, 0], data, flame: [A, { ...B, seat: 0 }] }), /같은 좌석/);
  assert.deepEqual(new Match({ seed: 6, teams: [0, 0], data, flame: [B] }).info(), new Match({ seed: 6, teams: [0, 0], data, flame: B }).info());
  // 양 좌석 키운 팀 + 컴퓨터 AI 로 끝까지(예외 없음)
  const p = freshProfile(); playUntilLoss(p, 51, 1, 1000);
  const v = [0, 1].map((s) => versusOptions(cat, data, p.teams.ended, undefined, s).flame);
  const g = new Match({ seed: 10, teams: [0, 0], data, humans: [false, false], cpuLevels: [3, 3], ruleMode: 'knockout', flame: v });
  for (let n = 0; n < 130000 && g.phase !== 'end'; n++) g.tick([0, 0]);
  assert.ok(g.result && g.flameResult().every((r) => r.hp.length === 7));
});

test('flame_end.summary(B149): teams 는 언제나 둘 다 false(자동 칸 폐지, 구 클라이언트 호환), teamSave = 경기를 치른 도전이면 종료 팀 저장 가능', () => {
  const profile = freshProfile();
  const e1 = playUntilLoss(profile, 31, 2, 1000).end;
  assert.deepEqual([e1.teams, e1.teamSave], [{ recent: false, best: false }, true]);
  const e2 = Run.settle(cat, Run.newRun(cat, data, profile, { seed: 33 }), profile, 'abandon', 0, 3000);
  assert.deepEqual([e2.teams, e2.teamSave], [{ recent: false, best: false }, false]);
});

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
    drop(t) { for (let i = q.length - 1; i >= 0; i--) if (q[i].t === t) q.splice(i, 1); },
    async err(o, ref) { this.send({ ...o, ref }); return (await this.wait((m) => m.t === 'error' && m.ref === ref)).code; },
  };
}

test('사람끼리 방(D53): 방장이 「불꽃 팀」을 켠 방에서 두 사람이 슬롯을 고르면 서버가 좌석별 옵션을 조립하고 경기 중 고정·재접속 같은 값, 저장 0회·결과 레코드 표시 칸. 허용 끄기·스위치 끄기·랭크·공식 규칙·바뀐 슬롯은 거절', async () => {
  const results = new MemoryResultStore();
  const app = createServer({ store: results, dbPath: ':memory:', importJson: false, log: () => {} });
  const port = await app.listen(0);
  try {
    const pa = freshProfile(), pb = freshProfile();
    playUntilLoss(pa, 31, 2, 1000); playUntilLoss(pb, 41, 1, 1100);
    pa.teams.s1 = structuredClone(pa.teams.ended); pb.teams.s2 = structuredClone(pb.teams.ended); // 사용자가 저장한 칸(B149)
    const a = client(port), b = client(port); await a.open; await b.open;
    a.send({ t: 'register', nickname: 'PvpA', password: 'pw123456' }); await a.type('welcome');
    b.send({ t: 'hello', nickname: 'PvpB' }); await b.type('welcome');
    app.lobby.flame.save('pvpa', 'PvpA', pa, null); app.lobby.flame.save('pvpb', 'PvpB', pb, null); // 가입 뒤에 넣는다(가입 때의 손님 저장 옮기기와 섞이지 않게)
    assert.equal(await a.err({ t: 'create_room', ranked: true, rules: { flameTeams: true } }, 1), 'LADDER_ONLY'); // 랭크 방은 래더 대기열로 대체(2026-11-20)
    a.send({ t: 'create_room' }); const { room: r0 } = await a.type('room_joined');
    b.send({ t: 'join_room', code: r0.code }); await b.type('room_joined');
    const room = app.lobby.rooms.get(r0.code);
    const c = client(port); await c.open; c.send({ t: 'hello', nickname: 'PvpC' }); await c.type('welcome'); // 로비 대기 계정(방 목록 갱신 확인용)
    await new Promise((r) => setTimeout(r, 400)); c.drop('room_list'); // 접속 때 받은 목록과 접속으로 예약된 목록 갱신(250ms)은 먼저 흘려보낸다(규칙 변경 전 상태)
    assert.equal(await a.err({ t: 'set_team', team: 'flame:s1' }, 2), 'FLAME_TEAM_ROOM'); // 허용 전
    assert.equal(await a.err({ t: 'set_rules', rules: { mode: 'official', flameTeams: true } }, 3), 'FLAME_TEAM_RULES'); // 공식 규칙과 함께 못 켠다
    // 데이터 스위치를 끄면 키를 버린다(1차와 같다)
    const V = app.lobby.flameCat.cfg.versusTeam; V.humans = false;
    a.send({ t: 'set_rules', rules: { flameTeams: true } });
    assert.equal((await a.wait((m) => m.t === 'room_state')).room.rules.flameTeams, undefined);
    V.humans = true;
    a.send({ t: 'set_rules', rules: { flameTeams: true } });
    assert.equal((await a.wait((m) => m.t === 'room_state' && m.room.rules.flameTeams)).room.rules.flameTeams, true);
    assert.ok(await c.wait((m) => m.t === 'room_list' && m.rooms.some((x) => x.code === r0.code && x.rules.flameTeams === true))); // 규칙만 바뀌어도 로비의 방 목록 행이 갱신된다
    b.send({ t: 'set_team', team: 'flame:s2' }); await b.wait((m) => m.t === 'room_state' && m.room.slots[1].flameTeam);
    b.send({ t: 'ready', ready: true }); await b.wait((m) => m.t === 'room_state' && m.room.slots[1].ready);
    a.send({ t: 'set_team', team: 'flame:s1' }); // 방장이 불꽃 팀을 바꾸면 상대 준비 해제(D53 (6))
    const rs = await b.wait((m) => m.t === 'room_state' && m.room.slots[0].flameTeam);
    assert.deepEqual([rs.room.slots[0].flameTeam.slot, rs.room.slots[1].flameTeam.slot, rs.room.slots[1].ready], ['s1', 's2', false]);
    b.send({ t: 'ready', ready: true }); await b.wait((m) => m.t === 'room_state' && m.room.slots[1].ready);

    let saves = 0; const save = app.lobby.flame.save;
    app.lobby.flame.save = (...x) => { saves++; return save.apply(app.lobby.flame, x); };
    const stored = JSON.stringify(['pvpa', 'pvpb'].map((k) => [app.lobby.flame.getProfile(k), app.lobby.flame.getRun(k)])), nRec = results.records.length;
    a.drop('game_start'); b.drop('game_start');
    a.send({ t: 'start' });
    const [ga, gb] = [await a.type('game_start'), await b.type('game_start')];
    // 좌석별 조립: 능력치 = 각자 저장 재료로 서버가 다시 계산한 값(HP 가득), flameVs·flameCast 좌석별, 도전 경기 표시(flame) 없음
    const want = [versusOptions(cat, data, pa.teams.s1, undefined, 0).flame, versusOptions(cat, data, pb.teams.s2, undefined, 1).flame];
    for (const g of [ga, gb]) {
      assert.deepEqual([g.flame, g.flameVs.mode, g.flameVs.seats.map((x) => [x.seat, x.slot]), g.flameCast.seats.map((x) => x.slot), g.teams.map((t) => t.flame)], [undefined, 'versus', [[0, 's1'], [1, 's2']], ['s1', 's2'], [true, true]]);
      for (const s of [0, 1]) assert.deepEqual(g.teams[s].players.map((p) => STATS.map((k) => p[k])), want[s].roster.map((r) => STATS.map((k) => r.stat[k])));
      assert.ok(g.teams.every((t) => t.players.every((p) => p.hp0 === p.hp)));
    }
    // 경기 중 저장이 바뀌어도(다른 접속) 경기 옵션은 시작 때 값으로 고정 -> 재접속 game_start 가 같다
    app.lobby.flame.save('pvpb', 'PvpB', freshProfile(), null); saves--;
    for (let i = 0; i < 300; i++) room.game.match.tick([0, 0]);
    room.game.resume(1);
    const again = await b.wait((m) => m.t === 'game_start' && m.resumed);
    assert.deepEqual({ ...again, resumed: false }, { ...gb, resumed: false });
    app.lobby.flame.save('pvpb', 'PvpB', pb, null); saves--;
    room.game.finish(1, 'annihilation');
    const ge = await a.wait((m) => m.t === 'game_end');
    await a.wait((m) => m.t === 'room_state' && m.room.status === 'waiting');
    app.lobby.flame.save = save;
    // 저장 0회·영구 저장/도전 그대로, 결과 레코드는 1개(불꽃 팀 표시 칸), 랭크 아님
    assert.deepEqual([ge.flame, ge.flameVs.seats.map((x) => x.seat), ge.flameVs.seats.every((x) => x.hp.length === 7)], [undefined, [0, 1], true]);
    assert.deepEqual([saves, JSON.stringify(['pvpa', 'pvpb'].map((k) => [app.lobby.flame.getProfile(k), app.lobby.flame.getRun(k)]))], [0, stored]);
    const rec = results.records.at(-1);
    assert.deepEqual([results.records.length - nRec, rec.players.map((p) => p.flameTeam?.slot), rec.ranked, rec.players[0].flameTeam.at], [1, ['s1', 's2'], undefined, pa.teams.s1.at]);

    // 고를 때 본 슬롯이 시작 전에 바뀌면 FLAME_TEAM_CHANGED + 새 요약 방송, 상대 준비 해제
    const pa2 = structuredClone(pa); pa2.teams.s1.at = 5555;
    app.lobby.flame.save('pvpa', 'PvpA', pa2, null);
    b.send({ t: 'ready', ready: true }); await b.wait((m) => m.t === 'room_state' && m.room.slots[1].ready);
    b.drop('room_state');
    assert.equal(await a.err({ t: 'start' }, 4), 'FLAME_TEAM_CHANGED');
    const ch = await b.wait((m) => m.t === 'room_state' && m.room.slots[0].flameTeam?.at === 5555);
    assert.equal(ch.room.slots[1].ready, false);
    // 허용을 끄면 두 사람의 선택이 풀리고 토스트 1회
    a.send({ t: 'set_rules', rules: { flameTeams: false } });
    const [ta, tb] = [await a.wait((m) => m.t === 'toast'), await b.wait((m) => m.t === 'toast')];
    const off = await b.wait((m) => m.t === 'room_state' && !m.room.rules.flameTeams);
    assert.deepEqual([ta.code, tb.code, off.room.slots.map((s) => s.flameTeam)], ['FLAME_TEAM_CLEARED', 'FLAME_TEAM_CLEARED', [undefined, undefined]]);
    assert.equal(await b.err({ t: 'set_team', team: 'flame:s2' }, 5), 'FLAME_TEAM_ROOM');
    a.ws.close(); b.ws.close(); c.ws.close();
  } finally { await app.close(); }
});
