// 불꽃의 계승 P2·P5: 도전 진행(지도·노드·보상·정산)·저장·로비 연결. 핵심 동작 + 에러 없음만 본다.
// 시뮬 하네스: 경기는 돌리지 않고 결과(game_end 형식)를 주입해 12경기를 끝까지 자동 진행한다(첫 경기만 엔진 Match 에 옵션을 넣어 받아들이는지 확인).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Match, loadData } from '../server/engine/index.js';
import { createServer } from '../server/index.js';
import { openDb, schemaVersion } from '../server/store/db.js';
import { MemoryResultStore } from '../server/store/results.js';
import { MemoryFlameStore, SqliteFlameStore } from '../server/store/flame.js';
import { loadCatalog, CATALOG_MSG_REV } from '../server/flame/catalog.js';
import { catalogMsg } from '../server/flame/handlers.js';
import { freshProfile, sanitizeProfile, sanitizeRun, unlockedOf, FlameError, SAVE_VERSION, PROFILE_VERSION } from '../server/flame/save.js';
import { candidates, isMatch, genSegment } from '../server/flame/map.js';
import * as Items from '../server/flame/items.js';
import * as Nodes from '../server/flame/nodes.js';
import * as Run from '../server/flame/run.js';
import { equipChoices } from '../server/flame/rewards.js';

const data = loadData(), cat = loadCatalog();
const soft = (fn) => { try { fn(); return true; } catch (e) { if (e instanceof FlameError) return false; throw e; } };
/** 승리 뒤 회복(D15) 값만 바꾼 카탈로그. v = undefined 면 키 없음 */
const catHeal = (v) => { const rest = { ...cat.cfg.rest }; if (v === undefined) delete rest.afterWinHealPct; else rest.afterWinHealPct = v; return { ...cat, cfg: { ...cat.cfg, rest } }; };
/** 승리 뒤 회복량. 구간 보스 승리는 rest.afterBossHealPct(D30, 없으면 afterWinHealPct) */
const winHeal = (max, type = 'normal') => Math.round(max * ((type === 'boss' ? cat.cfg.rest.afterBossHealPct : undefined) ?? cat.cfg.rest.afterWinHealPct ?? 0) / 100);
/** 엔드리스(D24)를 끈 카탈로그 = 종전 동작(구간 3 보스 승리 = 우승으로 도전 종료) */
const catOff = { ...cat, endless: null };

/** 선택(pending)을 전부 푼다: 장비·아티팩트는 0번을 받아 끼고, 영입은 0번을 6번 자리와 교체, 휴식은 전원, 이벤트는 되는 선택지 */
function resolve(run, profile, C = cat) {
  while (run.pending.length) {
    const p = run.pending[0];
    if (p.kind === 'recruit') Run.choose(C, data, run, profile, p.choices.length ? 0 : -1, 6);
    else if (p.kind === 'event') { if (!soft(() => Run.choose(C, data, run, profile, 0))) Run.choose(C, data, run, profile, 1); }
    else Run.choose(C, data, run, profile, 0, 0);
    if (p.kind === 'equipment') Items.autoEquip(C, run);
    if (p.kind === 'artifact') soft(() => Items.setArtifact(C, run, null, p.choices[0]));
  }
}

/** 한 판 자동 진행. loseAt = 그 번째 경기에서 진다(없으면 12경기 전승). 반환 = {end, matches, run, types} */
function playRun(profile, { seed, loseAt = 0, engineCheck = false, C = cat }) {
  const run = Run.newRun(C, data, profile, { seed });
  let matches = 0;
  const types = [];
  for (let guard = 0; guard < 60; guard++) {
    resolve(run, profile, C);
    const node = candidates(run)[0];
    types.push(node.type);
    const r = Run.enterNode(C, data, run, profile, node.id);
    if (!r.match) {
      if (run.node?.type === 'shop') { run.node.stock.forEach((_, i) => soft(() => Nodes.buy(C, run, i))); soft(() => Items.upgrade(C, run, profile.perm, run.items[0]?.inst)); Run.leaveNode(run); }
      else if (run.node?.type === 'training') { soft(() => Nodes.train(C, run, 0, 'T05')); Run.leaveNode(run); }
      continue;
    }
    matches++;
    const o = r.match;
    assert.ok(isMatch(o.type) && o.flame.roster.length === 7 && o.flame.caps.r1MaxPct === 60);
    if (engineCheck && matches === 1) { // 엔진이 조립된 옵션을 받아들이고 몇 틱 돈다
      const m = new Match({ seed: 3, teams: [0, o.cpuTeam], data, humans: [false, false], cpuLevels: [2, o.cpuLevel], stage: o.stage, flame: o.flame });
      for (let i = 0; i < 300; i++) m.tick([0, 0]);
      assert.deepEqual(m.info().teams[0].players.map((p) => p.hp), o.flame.roster.map((x) => x.stat.hp));
    }
    const win = matches !== loseAt;
    const res = { winner: win ? 0 : 1, reason: 'annihilation', flame: { hp: o.flame.roster.map((x, i) => (i === 3 ? 0 : Math.max(1, x.hp - 7))), surviveUsed: [] } };
    const out = Run.applyMatchResult(C, data, run, profile, res);
    if (out.end) return { end: out.end, matches, run, types };
    const mx3 = Run.viewOf(C, data, run, profile).team.players[3].final.s0;
    assert.deepEqual([out.outcome, run.match, run.roster[3].hp], ['win', null, Math.min(mx3, 1 + winHeal(mx3, o.type))]); // D5: HP 0 선수는 1 로 남고, 거기에 승리 뒤 회복(D15, 보스 뒤는 D30)이 붙는다
  }
  assert.fail('도전이 끝나지 않음');
}

test('flame 지도·시드: 같은 시드 = 같은 지도·같은 보상, 구간당 경기 4(일반 2·강팀 1·보스 1) (구간 2·3 은 들어갈 때 만든다), 상대는 내 로스터와 겹치지 않는다', () => {
  const a = Run.newRun(cat, data, freshProfile(), { seed: 77 }), b = Run.newRun(cat, data, freshProfile(), { seed: 77 }), c = Run.newRun(cat, data, freshProfile(), { seed: 78 });
  assert.deepEqual([a.map, a.pending], [b.map, b.pending]);
  assert.notDeepEqual(a.map, c.map);
  assert.equal(a.map.length, 1); // 저장 v3: 현재 구간만 들고 다음 구간은 보스를 이길 때 만든다
  for (const seg of [0, 1, 2].map((i) => genSegment(cat, data, 77, i, { roster: a.roster, diff: 0, oppUnlocked: false }))) {
    assert.deepEqual(seg.layers.map((l) => (isMatch(l[0].type) ? l[0].type : '-')), ['normal', '-', 'normal', '-', 'strong', '-', 'boss']);
    for (const l of seg.layers) for (const n of l) if (n.opp) assert.ok(![0, 22, 24].includes(n.opp.team) && n.opp.cpuLevel >= 1 && n.opp.cpuLevel <= 3);
    assert.deepEqual(seg.layers[0][0].next, seg.layers[1].map((n) => n.id));
  }
  // 해금된 항목만 등장: 전설·잠긴 아티팩트는 해금 전 후보에 없다
  const u0 = unlockedOf(cat, {}), u1 = unlockedOf(cat, { PC02: 1, PC03: 2 });
  assert.ok(!u0.items.includes('G10') && u1.items.includes('G10') && !u0.artifacts.includes('A30') && u1.artifacts.includes('A30') && !u0.legendary);
});

test('flame 도전 한 판(결과 주입 시뮬, 엔드리스 끔 = 종전): 12경기 전승 = 우승으로 도전 종료·정산 980코인(첫 우승 포함), 두 번째 우승은 680. 영구 성장 구매·코인 차감', () => {
  const profile = freshProfile();
  const r = playRun(profile, { seed: 5, engineCheck: true, C: catOff });
  assert.deepEqual([r.matches, r.end.result, r.end.wins, r.end.seg], [12, 'champion', { normal: 6, strong: 3, boss: 3 }, 3]);
  assert.deepEqual(r.end.coins, { normal: 120, strong: 120, boss: 240, champion: 200, first: 300, defeat: 0, pct: 100, total: 980 });
  assert.deepEqual([profile.coins, profile.firstClear, profile.best.clears, profile.best.wins], [980, true, 1, 12]);
  assert.ok(profile.codex.items.length > 0 && profile.achievements.includes('ACH03'));
  // 영구 성장: 비용·단계·상한
  assert.equal(Run.buyPerm(cat, profile, 'PA01'), 100);
  assert.equal(Run.buyPerm(cat, profile, 'PA01'), 200);
  assert.equal(Run.buyPerm(cat, profile, 'PB03'), 300);
  assert.deepEqual([profile.coins, profile.perm], [380, { PA01: 2, PB03: 1 }]);
  assert.throws(() => Run.buyPerm(cat, profile, 'PC06'), (e) => e.code === 'FLAME_NO_FUNDS');
  const r2 = playRun(profile, { seed: 6, C: catOff });
  assert.deepEqual([r2.end.result, r2.end.coins.first, r2.end.coins.total, profile.coins], ['champion', 0, 680, 1060]);
  assert.ok(r2.run.artifactsOwned.length >= 1); // 전술 연구(PB03): 시작 아티팩트 선택
  assert.throws(() => { for (let i = 0; i < 3; i++) Run.buyPerm(cat, profile, 'PA02'); }, (e) => e.code === 'FLAME_MAX');
});

test('flame 패배: 3번째 경기 패배 -> 도전 종료 정산(일반 2승 = 40코인), 코인·영구 성장은 남고 도전(장비·아티팩트·포인트)은 사라진다. 저장 후 복구', () => {
  const store = new SqliteFlameStore(openDb(':memory:'));
  assert.equal(schemaVersion(store.db), 2); // 엔드리스·순위표는 DB 스키마를 바꾸지 않는다
  const profile = freshProfile();
  profile.coins = 500; Run.buyPerm(cat, profile, 'PA03');
  // 도중 저장 -> 읽기(sanitize) -> 같은 상태로 이어진다
  const run = Run.newRun(cat, data, profile, { seed: 9 });
  resolve(run, profile);
  Run.enterNode(cat, data, run, profile, candidates(run)[0].id);
  store.save('k', 'K', profile, run);
  const back = sanitizeRun(cat, data, store.getRun('k'));
  assert.deepEqual(back, run);
  assert.deepEqual(sanitizeProfile(cat, store.getProfile('k')), profile);
  assert.deepEqual([back.v, back.match.node, back.items.length], [SAVE_VERSION, run.match.node, 1]);
  assert.equal(sanitizeRun(cat, data, { ...run, v: SAVE_VERSION + 1 }), null); // 더 새 버전은 읽지 않는다
  assert.ok(sanitizeRun(cat, data, { ...run, v: undefined })); // 버전 필드 없는 값(v0)은 v1 로 올린다
  assert.equal(sanitizeRun(cat, data, { ...run, roster: run.roster.slice(0, 6) }), null);
  // 패배 경로
  const r = playRun(profile, { seed: 9, loseAt: 3 });
  assert.deepEqual([r.matches, r.end.result, r.end.coins.total, r.end.wins], [3, 'defeat', 40, { normal: 2, strong: 0, boss: 0 }]);
  assert.ok(r.end.lost.items > 0);
  assert.deepEqual([profile.coins, profile.perm, profile.firstClear, profile.totals.runs], [250 + 40, { PA03: 1 }, false, 1]);
  store.save('k', 'K', profile, null); // 정산과 도전 삭제를 한 번에
  assert.deepEqual([store.getRun('k'), store.getProfile('k').coins], [null, 290]);
  // 엔진 오류로 끊긴 경기는 재경기(도전 유지), 무승부 상한은 패배(D6)
  const p2 = freshProfile(), run2 = Run.newRun(cat, data, p2, { seed: 4 });
  resolve(run2, p2);
  const id = candidates(run2)[0].id;
  Run.enterNode(cat, data, run2, p2, id);
  assert.deepEqual([Run.applyMatchResult(cat, data, run2, p2, { winner: -1, reason: 'error' }).outcome, run2.match, candidates(run2)[0].id], ['rematch', null, id]);
  Run.enterNode(cat, data, run2, p2, id);
  assert.equal(Run.applyMatchResult(cat, data, run2, p2, { winner: -1, reason: 'draw_cap' }).end.result, 'defeat');
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
  };
}

test('flame 로비 연결: flame_new -> 보상 선택 -> 장착 -> 경기 노드 = 비공개 방·game_start{flame} -> 서버 재시작 뒤 같은 도전 복구(재경기) -> 기권 = 패배 정산', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flame-')), dbPath = path.join(dir, 't.db');
  const mk = () => createServer({ store: new MemoryResultStore(), dbPath, importJson: false, flameSeed: 21, log: () => {} });
  let app = mk(), port = await app.listen(0);
  try {
    let a = client(port); await a.open;
    a.send({ t: 'hello', nickname: '불꽃A' }); await a.type('welcome');
    a.send({ t: 'flame_get' });
    let st = await a.type('flame_state');
    assert.deepEqual([st.run, st.profile.coins, st.profile.permList.length], [null, 0, 17]);
    a.send({ t: 'flame_catalog' });
    const cm = await a.type('flame_catalog');
    assert.deepEqual([cm.equipment.length, cm.artifacts.length, cm.consumables.length, cm.ver], [40, 30, 20, st.catalogVer]);
    a.send({ t: 'flame_node', id: '0-0-0', ref: 1 });
    assert.equal((await a.wait((m) => m.t === 'error' && m.ref === 1)).code, 'FLAME_NONE');
    a.send({ t: 'flame_new' });
    st = await a.type('flame_state');
    assert.deepEqual([st.run.pending[0].kind, st.run.candidates, st.run.points, st.run.seed, st.team.players.length], ['equipment', [], 100, undefined, 7]);
    a.send({ t: 'flame_node', id: '0-0-0', ref: 2 });
    assert.equal((await a.wait((m) => m.t === 'error' && m.ref === 2)).code, 'FLAME_PENDING');
    a.send({ t: 'flame_choose', i: 0 });
    st = await a.type('flame_state');
    const inst = st.run.items[0].inst;
    a.send({ t: 'flame_equip', p: 0, inst });
    st = await a.type('flame_state');
    assert.deepEqual([st.run.items[0].wearer, st.run.candidates.length, st.run.roster[0].equip[st.run.items[0].slot]], [0, 2, inst]);
    a.send({ t: 'flame_equip', p: 1, inst, ref: 3 });
    assert.equal((await a.wait((m) => m.t === 'error' && m.ref === 3)).code, 'FLAME_EQUIPPED');
    const nodeId = st.run.candidates[0], runId = st.run.id;
    a.send({ t: 'flame_node', id: nodeId });
    const rj = await a.type('room_joined');
    assert.deepEqual([rj.room.flame.node, rj.room.vsCpu], [nodeId, true]);
    const gs = await a.type('game_start');
    assert.deepEqual([gs.flame.seat, gs.teams[0].flame, gs.teams[0].players[0].from], [0, true, { team: 0, idx: 0 }]);
    assert.deepEqual([gs.flameCast.seat, gs.flameCast.team.short, gs.flameCast.players.length, gs.flameCast.players[0].name], [0, '불씨', 7, '윤이음']); // 표시용 정의(오리지널 팀, D17)
    a.send({ t: 'flame_equip', p: 0, inst: null, slot: 'headband', ref: 4 }); // 경기 중에는 도전 조작 불가
    assert.equal((await a.wait((m) => m.t === 'error' && m.ref === 4)).code, 'ALREADY_IN_ROOM');
    assert.equal(app.lobby.roomListMsg().rooms.length, 0); // 비공개 방
    // 서버 재시작(방·경기는 사라지고 도전은 DB 에 남는다) -> 같은 도전, 같은 노드를 다시 고를 수 있다
    await app.close();
    app = mk(); port = await app.listen(0);
    a = client(port); await a.open;
    a.send({ t: 'hello', nickname: '불꽃a' }); await a.type('welcome');
    a.send({ t: 'flame_get' });
    st = await a.type('flame_state');
    assert.deepEqual([st.run.id, st.run.inMatch, st.run.candidates[0], st.run.items[0].wearer, st.run.done.length], [runId, false, nodeId, 0, 0]);
    a.send({ t: 'flame_node', id: nodeId });
    await a.type('game_start');
    a.send({ t: 'leave_room' }); // 기권 = 패배(D6) -> 도전 종료
    const ge = await a.type('game_end');
    assert.ok(Array.isArray(ge.flame.hp));
    const fr = await a.type('flame_result'), fe = await a.type('flame_end');
    assert.deepEqual([fr.outcome, fr.reason, fe.summary.result, fe.summary.coins.total], ['lose', 'forfeit_leave', 'defeat', 0]);
    st = await a.type('flame_state');
    assert.deepEqual([st.run, st.profile.totals.runs], [null, 1]);
    await a.type('room_left');
    assert.equal(app.lobby.rooms.size, 0);
    a.ws.close();
  } finally { await app.close(); }
});

test('flame 로비: 메모리 저장소로도 동작하고, 가입 시 손님 flame 저장은 승계하지 않고 따로 옮긴다', () => {
  const st = new MemoryFlameStore();
  st.save('x', 'X', freshProfile(), null);
  assert.equal(st.setAside('x', 'guest-aside:x:1'), 1);
  assert.deepEqual([st.getProfile('x'), st.getProfile('guest-aside:x:1').v], [null, PROFILE_VERSION]);
});

// ---------- P2 리뷰 반영(M1·M2·L1~L5·L9) ----------
test('flame 리뷰 M1: 읽지 못한 도전(로스터 6명)은 지워지지 않고 격리 키로 보존된다(flame_get -> flame_perm 뒤에도). 모르는 이벤트·깨진 선택지는 그 칸만 버리고 진행된다', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flame-m1-')), logs = [];
  const app = createServer({ store: new MemoryResultStore(), dbPath: path.join(dir, 't.db'), importJson: false, flameSeed: 31, log: (...a) => logs.push(a.join(' ')) });
  const port = await app.listen(0);
  try {
    const a = client(port); await a.open;
    a.send({ t: 'hello', nickname: '손상A' }); await a.type('welcome');
    a.send({ t: 'flame_new' }); await a.type('flame_state');
    const st = app.lobby.flame, key = '손상a';
    const prof = st.getProfile(key), broken = st.getRun(key);
    broken.roster = broken.roster.slice(0, 6); prof.coins = 500;
    st.save(key, '손상A', prof, broken);
    a.send({ t: 'flame_get' });
    assert.equal((await a.type('flame_state')).run, null);
    a.send({ t: 'flame_perm', id: 'PA01' }); // 저장이 일어나는 요청
    assert.deepEqual((await a.type('flame_state')).profile.perm, { PA01: 1 });
    const rows = st.db.all('SELECT key, data FROM flame_runs');
    assert.equal(rows.length, 1);
    assert.ok(rows[0].key.startsWith(`flame-broken:${key}:`));
    assert.deepEqual(JSON.parse(rows[0].data), broken); // 원본 그대로
    assert.ok(logs.some((l) => l.includes('읽지 못한 저장') && l.includes('roster-size')));
    a.send({ t: 'flame_new' }); // 새 도전은 정상 시작
    assert.ok((await a.type('flame_state')).run);
    a.ws.close();
  } finally { await app.close(); }
  // 모르는 이벤트 ID 의 선택: 선택만 버리고 노드를 닫는다 -> 같은 노드를 다시 고르면 지금 있는 이벤트가 나온다. 배열이 아닌 선택지 = 빈 배열(도전은 산다)
  const profile = freshProfile();
  let run = null, ev = null;
  for (let seed = 1; seed < 40 && !ev; seed++) { run = Run.newRun(cat, data, profile, { seed }); ev = run.map[0].layers.flat().find((n) => n.type === 'event') ?? null; }
  assert.ok(ev);
  run.layer = run.map[0].layers.findIndex((l) => l.includes(ev));
  run.node = { id: ev.id, type: 'event' };
  run.pending = [{ kind: 'equipment', src: 'start', nodeType: 'start', choices: 'oops', n: 0 }, { kind: 'event', node: ev.id, event: 'EV_GONE' }];
  const back = sanitizeRun(cat, data, structuredClone(run));
  assert.deepEqual([back.node, back.pending.map((p) => [p.kind, p.choices])], [null, [['equipment', []]]]);
  Run.choose(cat, data, back, profile, -1); // 빈 선택지는 '받지 않음'으로 넘어간다
  Run.enterNode(cat, data, back, profile, ev.id);
  assert.ok(cat.cfg.events.some((e) => e.id === back.pending[0].event));
});

test('flame 리뷰 M2: 보상은 도전 비밀값으로 뽑는다(같은 지도 시드라도 비밀값이 다르면 지도는 같고 보상 흐름은 다르다). 비밀값은 보내지 않고, 비밀값 없는 v1 저장은 시드에서 파생', () => {
  const p = freshProfile(), u = unlockedOf(cat, {});
  const a = Run.newRun(cat, data, p, { seed: 77, secret: '0'.repeat(32) }), b = Run.newRun(cat, data, p, { seed: 77, secret: 'f'.repeat(32) }), c = Run.newRun(cat, data, p, {});
  assert.deepEqual(a.map, b.map);
  const stream = (r) => [0, 1, 2, 3, 4, 5].map((k) => equipChoices(cat, r, u, 3, 'normal', [`k${k}`]));
  assert.notDeepEqual(stream(a), stream(b));
  assert.match(c.secret, /^[0-9a-f]{32}$/);
  const view = Run.viewOf(cat, data, a, p).run;
  assert.deepEqual([view.secret, view.seed], [undefined, undefined]);
  const { secret, surviveCount, ...v1 } = Run.newRun(cat, data, p, { seed: 9 }); // eslint-disable-line no-unused-vars
  const up = sanitizeRun(cat, data, { ...v1, v: 1, surviveUsed: [] });
  assert.deepEqual([up.v, up.secret, up.surviveCount], [SAVE_VERSION, secret, 0]);
});

test('flame 리뷰 L1~L4: 다음 경기 최대 HP 소모품은 경기 뒤 현재 HP 를 올려 두지 않는다, 경기 없는 도전은 기록에 안 든다, 치사 생존은 도전 단위 1회, 영입 자리의 버프는 사라진다', () => {
  const profile = freshProfile();
  // L2: 경기 없이 끝낸 도전
  const s0 = Run.settle(cat, Run.newRun(cat, data, profile, { seed: 3 }), profile, 'abandon');
  assert.deepEqual([s0.counted, profile.totals.runs, profile.best.seg, profile.achievements], [false, 0, 0, []]);
  // L1: C03(선수 0 최대 HP +10)·C13(팀 +5) -> 경기에는 올려서 나가고, 경기 뒤에는 경기 전 HP 를 넘지 않는다
  const run = Run.newRun(cat, data, profile, { seed: 3 });
  run.pending = [];
  run.consumables = { C03: 1, C13: 1 };
  run.roster[0].hp = 5; run.roster[1].hp = 6;
  const maxHp = run.roster.map(() => 999);
  Items.useConsumable(cat, run, 'C03', 0, maxHp); Items.useConsumable(cat, run, 'C13', null, maxHp);
  const node = candidates(run)[0], o = Run.enterNode(cat, data, run, profile, node.id).match;
  assert.deepEqual([o.flame.roster[0].hp, o.flame.roster[1].hp], [20, 11]);
  // 치사 생존 장비 2개를 선수 0·1 에게: 도전 단위 1회라 앞 선수만 받는다(L3)
  const p10 = [Items.addItem(cat, run, 'P10'), Items.addItem(cat, run, 'P10')];
  run.roster[0].equip.protector = p10[0].inst; run.roster[1].equip.protector = p10[1].inst;
  const sv = (r) => Run.matchOptions(cat, data, r, profile, node).flame.roster.map((x) => x.fx.survive).slice(0, 2);
  assert.deepEqual(sv(run), [1, 0]);
  const out = Run.applyMatchResult(catHeal(0), data, run, profile, { winner: 0, reason: 'annihilation', flame: { hp: o.flame.roster.map((x) => x.hp), surviveUsed: [0] } }); // 승리 뒤 회복(D15)을 끄고 L1 만 본다
  assert.deepEqual([out.outcome, run.roster[0].hp, run.roster[1].hp, run.buffs, run.surviveCount], ['win', 5, 6, [], 1]);
  Items.unequip(cat, run, 0, 'protector'); // 쓰지 않은 두 번째 P10 만 남겨도 다시 생기지 않는다
  assert.deepEqual(sv(run), [0, 0]);
  // L4: 선수 6 에게 건 다음 경기 효과는 그 자리에 영입된 선수에게 넘어가지 않는다(팀 대상은 남는다)
  run.buffs = [{ c: 'C03', p: 6 }, { c: 'C13', p: null }];
  const pend = { kind: 'recruit', node: 'x', choices: [{ team: 5, idx: 0 }] };
  Nodes.chooseRecruit(cat, data, run, pend, 0, 6, false);
  assert.deepEqual([run.roster[6].from.team, run.buffs], [5, [{ c: 'C13', p: null }]]);
});

test('flame 승리 뒤 전원 회복(D15): 이기면 전원 최대 HP 의 afterWinHealPct % 회복(HP 1 로 남은 선수 포함, 최대 HP 까지), 지면 그대로, 키가 0 이거나 없으면 종전과 같다', () => {
  // 선수 0 = 아웃(0 -> 1), 선수 1 = 최대 HP 에서 2 모자람, 나머지 = 10
  const play = (c, win) => {
    const profile = freshProfile(), run = Run.newRun(c, data, profile, { seed: 3 });
    run.pending = [];
    const max = run.roster.map((r) => r.hp); // 새 도전은 가득 찬 HP
    Run.enterNode(c, data, run, profile, candidates(run)[0].id);
    const out = Run.applyMatchResult(c, data, run, profile, { winner: win ? 0 : 1, reason: 'annihilation', flame: { hp: max.map((m, i) => (i === 0 ? 0 : i === 1 ? m - 2 : 10)), surviveUsed: [] } });
    return { out, max, hp: run.roster.map((r) => r.hp) };
  };
  assert.equal(cat.cfg.rest.afterWinHealPct, 30);
  const w = play(cat, true);
  assert.ok(w.max.every((m) => m > 20));
  assert.deepEqual([w.out.outcome, w.out.end], ['win', null]);
  assert.deepEqual(w.hp, w.max.map((m, i) => (i === 0 ? 1 + Math.round(m * 0.3) : i === 1 ? m : 10 + Math.round(m * 0.3))));
  const before = (max) => max.map((m, i) => (i === 0 ? 1 : i === 1 ? m - 2 : 10)); // 종전 동작
  const l = play(cat, false);
  assert.deepEqual([l.out.outcome, l.hp], ['lose', before(l.max)]);
  for (const v of [0, undefined]) { const z = play(catHeal(v), true); assert.deepEqual([z.out.outcome, z.hp], ['win', before(z.max)]); }
});

test('flame 패배 분투 보상(D16): 패배한 마지막 경기의 상대 아웃 수 × defeatOutCoin(상한 defeatOutCoinMax). 기권·무승부 상한·포기·키 없음/0 은 0(종전과 같다)', () => {
  /** 첫 경기에 들어가 결과 res 를 넣는다(c = 쓸 카탈로그) */
  const lose = (res, c = cat) => {
    const profile = freshProfile(), run = Run.newRun(c, data, profile, { seed: 4 });
    resolve(run, profile);
    Run.enterNode(c, data, run, profile, candidates(run)[0].id);
    return { end: Run.applyMatchResult(c, data, run, profile, res).end, profile };
  };
  const catCoin = (proposed) => { const coin = { ...cat.coin }; if (proposed === undefined) delete coin.proposed; else coin.proposed = proposed; return { ...cat, coin }; };
  const P = cat.coin.proposed, legacy = { normal: 0, strong: 0, boss: 0, champion: 0, first: 0, defeat: 0, pct: 100, total: 0 };
  // 값은 데이터(economy.json flameCoin.proposed)에서 읽는다(밸런스 조정으로 바뀐다, analysis/40 §16.2). 지켜야 할 관계만 고정한다: 양의 정수, 상한 < 일반 승리 코인(D16)
  const per = P.defeatOutCoin, max = P.defeatOutCoinMax, want = (outs) => Math.floor(Math.min(max, outs * per));
  assert.ok(Number.isInteger(per) && per > 0 && Number.isInteger(max) && max >= per && max < cat.coin.normalWin);
  // 상대 7명 중 3명 아웃(남은 4) = 3 × defeatOutCoin(상한까지), 프로필에 1회 지급
  const a = lose({ winner: 1, reason: 'annihilation', rem: [0, 4] });
  assert.deepEqual([a.end.result, a.end.counted, a.end.defeatOuts, a.end.coins.defeat, a.end.coins.total, a.profile.coins, a.profile.earned], ['defeat', true, 3, want(3), want(3), want(3), want(3)]);
  // 상한: 6명 아웃, 시간 종료 패배도 받는다. 이상한 rem(음수)은 7명으로 잘려 상한까지만
  assert.deepEqual([lose({ winner: 1, reason: 'timeup', rem: [0, 1] }).end.coins.total, lose({ winner: 1, reason: 'annihilation', rem: [0, -50] }).end.coins.total], [want(6), want(7)]);
  // 0 조건: 한 명도 못 잡음 / 기권 / 무승부 상한 / rem 없음
  for (const res of [{ winner: 1, reason: 'annihilation', rem: [0, 7] }, { winner: 1, reason: 'forfeit_leave', rem: [7, 1] }, { winner: -1, reason: 'draw_cap', rem: [7, 1] }, { winner: 1, reason: 'annihilation' }]) {
    assert.deepEqual(lose(res).end.coins, legacy);
  }
  // 키 없음 / 0 = 종전과 같다
  for (const c of [catCoin(undefined), catCoin({ defeatOutCoin: 0, defeatOutCoinMax: 12 }), catCoin({ defeatOutCoin: 2 })]) {
    const b = lose({ winner: 1, reason: 'annihilation', rem: [0, 1] }, c);
    assert.deepEqual([b.end.coins, b.profile.coins], [legacy, 0]);
  }
  // 포기·경기 0판 도전은 아웃 수를 넘겨도 0, 우승·진행 중 예상(coinsPending)에는 걸리지 않는다
  const p0 = freshProfile(), r0 = Run.newRun(cat, data, p0, { seed: 4 });
  assert.equal(Run.coinsOf(cat, r0, p0, 'champion', 6).defeat + Run.coinsOf(cat, r0, p0, null, 6).defeat + Run.settle(cat, r0, p0, 'abandon', 6).coins.defeat + Run.settle(cat, r0, p0, 'defeat', 6).coins.defeat, 0);
});

test('flame 리뷰 L9·L5: 로비 경유 승리(game_end -> flame_result{win} -> flame_state 보상 선택) / 결과 저장 실패 = error 푸시 + 같은 노드 재경기(승리가 조용히 사라지지 않는다)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flame-win-')), logs = [];
  const app = createServer({ store: new MemoryResultStore(), dbPath: path.join(dir, 't.db'), importJson: false, flameSeed: 21, log: (...a) => logs.push(String(a[0])) });
  const port = await app.listen(0);
  try {
    const a = client(port); await a.open;
    a.send({ t: 'hello', nickname: '불꽃W' }); await a.type('welcome');
    a.send({ t: 'flame_new' }); await a.type('flame_state');
    a.send({ t: 'flame_choose', i: 0 });
    let st = await a.type('flame_state');
    const first = st.run.candidates[0];
    a.send({ t: 'flame_node', id: first }); await a.type('game_start');
    app.lobby.rooms.values().next().value.game.finish(0, 'annihilation');
    await a.type('game_end');
    assert.equal((await a.type('flame_result')).outcome, 'win');
    st = await a.type('flame_state');
    assert.deepEqual([st.run.matchesWon, st.run.pending[0].kind, st.run.done[0].win, st.run.layer, st.run.inMatch], [1, 'equipment', true, 1, false]);
    await a.type('room_left');
    // 다음 경기 노드까지: 보상 받지 않음 -> 상점|특훈 -> 나가기
    a.send({ t: 'flame_choose', i: -1 }); st = await a.type('flame_state');
    a.send({ t: 'flame_node', id: st.run.candidates[0] }); await a.type('flame_state');
    a.send({ t: 'flame_leave' }); st = await a.type('flame_state');
    const second = st.run.candidates[0], points = st.run.points;
    a.send({ t: 'flame_node', id: second }); await a.type('game_start');
    const save = app.lobby.flame.save;
    app.lobby.flame.save = () => { throw new Error('disk full'); };
    app.lobby.rooms.values().next().value.game.finish(0, 'annihilation');
    await a.type('game_end');
    assert.equal((await a.wait((m) => m.t === 'error')).code, 'FLAME_SAVE_FAILED');
    const fr = await a.type('flame_result');
    assert.deepEqual([fr.outcome, fr.saveFailed], ['rematch', true]);
    st = await a.type('flame_state');
    assert.deepEqual([st.run.matchesWon, st.run.candidates.includes(second), st.run.points, st.run.inMatch], [1, true, points, false]);
    assert.ok(logs.some((l) => l.includes('경기 결과 저장 실패')));
    await a.type('room_left');
    app.lobby.flame.save = save;
    a.send({ t: 'flame_node', id: second }); await a.type('game_start'); // 같은 노드를 다시 고를 수 있다
    a.ws.close();
  } finally { await app.close(); }
});

test('flame 2차 리뷰 M: 클론을 주장 칸(라인업 0번)에 두고 그 몸의 팀과 붙어도 상대는 지도 노드의 팀 그대로다(로비가 무작위 팀으로 바꾸지 않는다)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flame-cap-'));
  const app = createServer({ store: new MemoryResultStore(), dbPath: path.join(dir, 't.db'), importJson: false, flameSeed: 21, log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port); await a.open;
    a.send({ t: 'hello', nickname: '불꽃C' }); await a.type('welcome');
    a.send({ t: 'flame_new' }); await a.type('flame_state');
    a.send({ t: 'flame_choose', i: -1 });
    let st = await a.type('flame_state');
    const nodeId = st.run.candidates[0], opp = st.run.map[0].layers[0].find((n) => n.id === nodeId).opp.team;
    // 영입으로 닿을 수 있는 상태를 저장에 넣는다: 6번 칸 = 몸이 상대 팀 선수인 클론(영입 때 만드는 칸과 같은 형태). 그 뒤 실제 요청으로 주장 칸에 올린다
    const cl = cat.pool.players.find((p) => p.body.team === opp && !p.retired);
    assert.ok(cl, `상대 팀 ${opp} 의 몸을 쓰는 클론이 풀에 없음`);
    const getRun = app.lobby.flame.getRun.bind(app.lobby.flame);
    let once = true;
    app.lobby.flame.getRun = (k) => { const r = getRun(k); if (r && once) { once = false; r.roster[6] = { ...r.roster[6], from: { ...cl.body }, clone: cl.id, sp: [cl.sp, null], recruited: true }; delete r.roster[6].orig; } return r; };
    a.send({ t: 'flame_lineup', order: [6, 1, 2, 3, 4, 5, 0] });
    st = await a.type('flame_state');
    assert.deepEqual([st.run.roster[0].clone, st.run.roster[0].from], [cl.id, cl.body]);
    a.send({ t: 'flame_node', id: nodeId });
    const gs = await a.type('game_start');
    assert.deepEqual([gs.teams[1].id, app.lobby.rooms.values().next().value.cpuTeam, gs.teams[0].flame], [opp, opp, true]);
    a.ws.close();
  } finally { await app.close(); }
});

test('flame 리뷰 L9: 공 보유 20초 제한(기획 §17-16)은 flame 경기에서도 같은 프레임에 걸린다', () => {
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 5 });
  run.pending = [];
  const o = Run.enterNode(cat, data, run, profile, candidates(run)[0].id).match;
  const heldFor = (flame) => {
    const m = new Match({ seed: 6, teams: [0, o.cpuTeam], data, humans: [true, false], cpuLevels: [2, o.cpuLevel], stage: o.stage, limitFrames: 0, ...(flame ? { flame } : {}) });
    for (let n = 0; (m.phase !== 'play' || m.tip.on) && n < 2000; n++) m.tick([0, 0]);
    const p = m.players[0];
    m.giveBall(p); m.sides[0].ctrl = 0;
    for (let f = 1; f <= data.rules.holdMaxFrames + 60; f++) { m.tick([0, 0]); if (!p.hasBall) return f; }
    return -1;
  };
  const f = heldFor(o.flame);
  assert.ok(f > data.rules.holdMaxFrames - 60 && f <= data.rules.holdMaxFrames + 60, `강제 투구 프레임 ${f}`);
  assert.equal(f, heldFor(null));
});

test('flame_catalog: 승리 뒤 회복 %(afterWinHealPct)를 싣는다(키가 없으면 0), 메시지 개정 번호가 ver 에 들어간다', () => {
  assert.equal(catalogMsg(cat).afterWinHealPct, cat.cfg.rest.afterWinHealPct);
  assert.equal(catalogMsg(catHeal(undefined)).afterWinHealPct, 0);
  assert.ok(cat.ver.endsWith(`.m${CATALOG_MSG_REV}`) && Array.isArray(catalogMsg(cat).rest));
});

test('flame_state run.matchHp: 다음 경기 소모품(C13)으로 늘어난 최대 HP 만큼 출전 HP 가 오르고 matchOptions 의 출전 HP 와 같다(roster.hp 는 그대로)', () => {
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 7 });
  resolve(run, profile);
  const max0 = Run.viewOf(cat, data, run, profile).team.players.map((p) => p.final.s0);
  run.roster.forEach((r, i) => { r.hp = max0[i] - 3; });
  run.roster[6].hp = 0;
  run.consumables.C13 = 1;
  Items.useConsumable(cat, run, 'C13', null, max0);
  const v = Run.viewOf(cat, data, run, profile), node = candidates(run).find((n) => isMatch(n.type));
  const b = v.run.matchHp[0].bonus;
  assert.ok(b > 0);
  assert.deepEqual(v.run.matchHp[0], { hp: max0[0] - 3 + b, max: max0[0] + b, bonus: b });
  assert.equal(v.run.roster[0].hp, max0[0] - 3);
  assert.deepEqual(v.run.matchHp.map((m) => m.hp), Run.matchOptions(cat, data, run, profile, node).flame.roster.map((r) => Math.max(1, r.hp)));
});

// ---- 오리지널 팀(analysis/39 D17·D20·D21) ----
/** 시작 팀 키(decisions.json roster.startOriginal)를 지운 것과 같은 카탈로그 = 종전 태동 시작 */
const catLegacy = { ...cat, original: { ...cat.original, start: false } };

test('flame 오리지널 팀(D17): 새 도전은 오리지널 7명으로 시작하고 능력치·엔진 옵션은 태동 시작과 같다. 표시용 정의(cast)가 flame_state·경기 시작 값에 실린다', () => {
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 5 }), old = Run.newRun(catLegacy, data, profile, { seed: 5 });
  assert.deepEqual([run.origTeam, run.roster.map((r) => r.orig)], ['bulssi', ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']]);
  assert.deepEqual([old.origTeam, old.roster.map((r) => r.orig)], [undefined, Array(7).fill(undefined)]);
  const node = candidates(run).find((n) => isMatch(n.type)), a = Run.matchOptions(cat, data, run, profile, node), b = Run.matchOptions(catLegacy, data, old, profile, node);
  assert.deepEqual([run.map, a.flame], [old.map, b.flame]); // 지도·엔진 옵션(출신·능력치·필살기)이 종전과 같다 = 밸런스 재측정 0
  const v = Run.viewOf(cat, data, run, profile).run.cast;
  assert.deepEqual([v.team.name, v.team.short, v.players[0].name, v.players[0].role, v.players[0].protagonist, v.players[0].locked, v.players[1].locked], ['불씨 국민학교', '불씨', '윤이음', 'ace', true, true, false]);
  assert.deepEqual([Object.keys(v.players[6].skin), a.cast.players.map((p) => p.id), catalogMsg(cat).original.players.length], [['team', 'idx', 'uni', 'hair'], run.roster.map((r) => r.orig), 7]);
  // flame_catalog.original.players[].base = 그 선수 칸의 from(도감·seen.players 의 키 '팀:번호'). 도전이 없어도 화면이 그 키에 오리지널 이름을 붙일 수 있다
  assert.deepEqual(catalogMsg(cat).original.players.map((p) => p.base), run.roster.map((r) => r.from));
});

test('flame 주인공 교체 불가(D20): 영입 교체 대상으로 주인공 칸을 고르면 FLAME_PROTAGONIST(상태 그대로), 다른 칸은 되고, 플래그를 끄면 주인공도 교체된다', () => {
  const mk = () => { const p = freshProfile(), r = Run.newRun(cat, data, p, { seed: 6 }); r.pending = [{ kind: 'recruit', node: candidates(r)[0].id, choices: [{ team: 5, idx: 0 }] }]; return [p, r]; };
  const [profile, run] = mk(), before = JSON.stringify(run);
  assert.throws(() => Run.choose(cat, data, run, profile, 0, 0), (e) => e instanceof FlameError && e.code === 'FLAME_PROTAGONIST');
  assert.equal(JSON.stringify(run), before);
  Run.choose(cat, data, run, profile, 0, 6);
  assert.deepEqual([run.roster[6].from, run.roster[6].orig, run.roster[6].recruited, run.roster[0].orig], [{ team: 5, idx: 0 }, undefined, true, 'o1']);
  const [p2, r2] = mk(), off = { ...cat, original: { ...cat.original, locked: false } };
  Run.choose(off, data, r2, p2, 0, 0);
  assert.deepEqual(r2.roster[0].from, { team: 5, idx: 0 });
});

test('flame 구 저장(태동 도전): 오리지널 팀 추가 전에 저장된 도전은 저장 버전 그대로 읽혀 이어진다(표시 정의 없음·주장 칸 교체 가능). 오리지널 도전은 저장 왕복에서 orig·origTeam 이 남는다', () => {
  const profile = freshProfile(), old = Run.newRun(catLegacy, data, profile, { seed: 8 });
  const back = sanitizeRun(cat, data, JSON.parse(JSON.stringify(old)));
  assert.deepEqual([back.v, back.origTeam, back.roster.map((r) => [r.from.team, r.orig])], [SAVE_VERSION, undefined, Array(7).fill([0, undefined])]);
  const c = Run.viewOf(cat, data, back, profile).run.cast;
  assert.deepEqual([c.team, c.players], [null, Array(7).fill(null)]);
  back.pending = [{ kind: 'recruit', node: candidates(back)[0].id, choices: [{ team: 5, idx: 0 }] }];
  Run.choose(cat, data, back, profile, 0, 0);
  assert.deepEqual(back.roster[0].from, { team: 5, idx: 0 });
  const run = Run.newRun(cat, data, profile, { seed: 8 }), rt = sanitizeRun(cat, data, JSON.parse(JSON.stringify(run)));
  assert.deepEqual([rt.origTeam, rt.roster.map((r) => r.orig)], [run.origTeam, run.roster.map((r) => r.orig)]);
});
