// 불꽃의 계승 엔드리스(무한 구간, analysis/39 D24·D26) + 도달 순위표(D27). 핵심 동작 + 에러 없음만 본다.
// 경기는 돌리지 않고 결과(game_end 형식)를 주입해 진행한다(test/flame_run.test.js 와 같은 방식). DB 는 메모리만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { loadData } from '../server/engine/index.js';
import { createServer } from '../server/index.js';
import { openDb } from '../server/store/db.js';
import { MemoryResultStore } from '../server/store/results.js';
import { SqliteFlameStore } from '../server/store/flame.js';
import { loadCatalog } from '../server/flame/catalog.js';
import { catalogMsg } from '../server/flame/handlers.js';
import { freshProfile, sanitizeProfile, sanitizeRun, FlameError, SAVE_VERSION, PROFILE_VERSION } from '../server/flame/save.js';
import { candidates, genSegment } from '../server/flame/map.js';
import { FlameRanking } from '../server/flame/ranking.js';
import * as Items from '../server/flame/items.js';
import * as Nodes from '../server/flame/nodes.js';
import * as Run from '../server/flame/run.js';
import { openWs } from './ws_util.js';

const data = loadData(), cat = loadCatalog();
const soft = (fn) => { try { fn(); return true; } catch (e) { if (e instanceof FlameError) return false; throw e; } };
const json = (v) => JSON.parse(JSON.stringify(v));

function resolve(run, profile) {
  while (run.pending.length) {
    const p = run.pending[0];
    if (p.kind === 'recruit') Run.choose(cat, data, run, profile, p.choices.length ? 0 : -1, 6);
    else if (p.kind === 'event') { if (!soft(() => Run.choose(cat, data, run, profile, 0))) Run.choose(cat, data, run, profile, 1); }
    else Run.choose(cat, data, run, profile, 0, 0);
    if (p.kind === 'equipment') Items.autoEquip(cat, run);
    if (p.kind === 'artifact') soft(() => Items.setArtifact(cat, run, null, p.choices[0]));
  }
}

/**
 * 경기 n 판을 치른다(loseAt 번째 판은 진다). 반환 = 마지막 경기의 applyMatchResult 결과들.
 * onMatch(out, k) = 경기마다 불린다(k = 이 호출에서 몇 번째 판)
 */
function play(run, profile, n, { loseAt = 0, onMatch = null, now = 1000, resCat = cat } = {}) { // resCat = 경기 결과를 반영할 때의 카탈로그(엔드리스를 끈 서버 흉내)
  let k = 0, last = null;
  for (let guard = 0; guard < n * 6 && k < n; guard++) {
    resolve(run, profile);
    const node = candidates(run)[0];
    const r = Run.enterNode(cat, data, run, profile, node.id);
    if (!r.match) {
      if (run.node?.type === 'shop') { run.node.stock.forEach((_, i) => soft(() => Nodes.buy(cat, run, i))); Run.leaveNode(run); }
      else if (run.node?.type === 'training') { soft(() => Nodes.train(cat, run, 0, 'T05')); Run.leaveNode(run); }
      continue;
    }
    k++;
    const win = k !== loseAt;
    last = Run.applyMatchResult(resCat, data, run, profile, { winner: win ? 0 : 1, reason: 'annihilation', flame: { hp: r.match.flame.roster.map((x) => Math.max(1, x.hp - 5)), surviveUsed: [] } }, now + k);
    onMatch?.(last, k);
    if (last.end) break;
  }
  return last;
}

test('엔드리스: 구간 3 보스를 이기면 우승이 그 자리에서 한 번 반영되고 도전은 구간 4 로 이어진다. 우승 200·첫 우승 300 은 종료 정산 때 한 번만', () => {
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 5 });
  const champs = [];
  const at12 = play(run, profile, 12, { onMatch: (o, k) => { if (o.champion) champs.push(k); } });
  assert.deepEqual([at12.outcome, at12.end, at12.champion, at12.segCleared, champs], ['win', null, true, 3, [12]]);
  assert.deepEqual([run.seg, run.layer, run.map.length, run.champ, profile.firstClear, profile.best.clears, profile.coins], [3, 0, 1, { first: true }, true, 1, 0]); // 코인은 아직 정산 전
  assert.ok(at12.achievements.includes('ACH03') && profile.achievements.includes('ACH03'));
  const v = Run.viewOf(cat, data, run, profile).run;
  assert.deepEqual([v.segNo, v.endless, v.championed, v.segments, v.matchesTotal, v.championSegments, v.coinsPending.first, v.map.length, v.mapBase, v.map[0].layers.length], [4, true, true, null, null, 3, 300, 1, 3, 7]);
  // 구간 4 를 다 이기고(보스 = 재선택 +1) 17번째 경기에서 진다 -> 정산
  const rerolls = run.rerolls;
  const end = play(run, profile, 5, { loseAt: 5, onMatch: (o, k) => { if (o.champion) champs.push(12 + k); } }).end;
  assert.deepEqual([end.result, end.championed, end.endless, end.seg, end.matches, champs], ['defeat', true, true, 5, 16, [12]]);
  assert.deepEqual(end.coins, { normal: 160, strong: 160, boss: 320, champion: 200, first: 300, defeat: 0, pct: 100, total: 1140 });
  assert.deepEqual([profile.coins, profile.best.clears, profile.best.seg, profile.best.wins, profile.totals.runs], [1140, 1, 5, 16, 1]);
  assert.ok(run.rerolls >= rerolls); // 재선택을 쓰지 않는 자동 진행이라 줄지 않는다(구간 4 보스 +1)
  // 두 번째 도전: 우승은 다시 세지만 첫 우승 300 은 없다
  const run2 = Run.newRun(cat, data, profile, { seed: 6 });
  play(run2, profile, 12);
  assert.deepEqual([run2.champ, profile.best.clears], [{ first: false }, 2]);
  const end2 = Run.settle(cat, run2, profile, 'abandon');
  assert.deepEqual([end2.championed, end2.coins.champion, end2.coins.first, end2.coins.total], [true, 200, 0, 680]);
});

test('엔드리스: 구간 10 까지 전승 진행이 예외 없이 돌고 저장 왕복이 같으며, 저장 크기는 구간 3 을 마친 시점의 2배 이내다. 구간 4+ 는 표 마지막 줄(상대·보상 등급)', () => {
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 11 });
  const pool3 = new Set(['normal', 'strong', 'boss'].flatMap((k) => cat.cfg.opponents.segments[2][k]));
  let size3 = 0;
  play(run, profile, 40, {
    onMatch: (o) => {
      const back = sanitizeRun(cat, data, json(run), (w) => assert.fail('저장을 읽지 못함: ' + w));
      assert.deepEqual(back, run); // 단계마다 저장 왕복
      if (o.segCleared === 3) size3 = JSON.stringify(run).length;
    },
  });
  const size10 = JSON.stringify(run).length;
  assert.deepEqual([run.seg, run.map.length, run.wins, run.done.length], [10, 1, { normal: 20, strong: 10, boss: 10 }, 0]);
  assert.ok(size3 > 0 && size10 <= size3 * 2, `구간 3 뒤 ${size3}바이트, 구간 10 뒤 ${size10}바이트`);
  assert.ok(run.items.length <= cat.endless.itemMax && run.stat.bosses.length <= cat.endless.bossesKeep);
  for (const l of run.map[0].layers) for (const n of l) { assert.ok(n.id.startsWith('10-')); if (n.opp) assert.ok(pool3.has(n.opp.team) && n.opp.cpuLevel <= cat.cfg.opponents.cpuLevelMax); }
  // 장비 보유 상한: 가득 차면 받는 즉시 판매가만큼 포인트로, 상점 구매는 FLAME_FULL
  while (run.items.length < cat.endless.itemMax) Items.addItem(cat, run, 'G01');
  const pts = run.points, got = Items.addItem(cat, run, 'G01');
  assert.deepEqual([run.items.length, got.sold, run.points], [cat.endless.itemMax, cat.sellPrice('G01'), pts + cat.sellPrice('G01')]);
});

test('엔드리스: 구간 4+ 보상 등급 보정은 마지막 줄 고정, 아티팩트가 고갈되면 보스 보상은 경기 포인트로 바뀐다', async () => {
  const { rarityWeights } = await import('../server/flame/rewards.js');
  const u = { legendary: true };
  assert.deepEqual(rarityWeights(cat, 7, 'normal', u), rarityWeights(cat, 2, 'normal', u));
  assert.notDeepEqual(rarityWeights(cat, 7, 'normal', u), rarityWeights(cat, 0, 'normal', u));
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 12 });
  play(run, profile, 3);
  run.artifactsOwned = [...cat.artifacts.keys()]; // 전부 보유
  resolve(run, profile);
  const pts = run.points, o = play(run, profile, 1); // 구간 1 보스
  assert.deepEqual([o.segCleared, o.artifactPoints, run.points - pts, run.pending.some((p) => p.kind === 'artifact')], [1, cat.endless.artifactFallbackPoints, cat.matchPoints.bossWin + cat.endless.artifactFallbackPoints, false]);
});

test('엔드리스: v2 도전 저장(지도 3구간 통째)은 v3 로 올라가 이어지고(미리 만든 구간 지도 그대로) 구간 3 보스 뒤 구간 4 로 넘어간다', () => {
  const profile = freshProfile(), fresh = Run.newRun(cat, data, profile, { seed: 21 });
  const opt = { roster: fresh.roster, diff: 0, oppUnlocked: false }, full = [0, 1, 2].map((i) => genSegment(cat, data, 21, i, opt));
  assert.deepEqual(full[0], fresh.map[0]); // 구간 1 지도는 종전(한꺼번에 생성)과 같다
  const v2 = { ...json(fresh), v: 2, map: json(full) };
  const run = sanitizeRun(cat, data, json(v2), (w) => assert.fail(w));
  assert.deepEqual([run.v, SAVE_VERSION, run.seg, run.map.length], [3, 3, 0, 3]);
  play(run, profile, 4);
  assert.deepEqual([run.seg, run.map.length, run.map[0]], [1, 2, full[1]]); // 이어하던 도전의 다음 구간 지도가 바뀌지 않는다
  // 구간 3 진행 중이던 v2 저장: 지나온 구간 지도·기록만 버리고 같은 자리에서 이어진다
  const mid = { ...json(fresh), v: 2, map: json(full), seg: 2, layer: 2, wins: { normal: 5, strong: 2, boss: 2 }, done: [{ id: '1-6-0', type: 'boss', win: true }, { id: '2-0-0', type: 'normal', win: true }, { id: '2-1-0', type: 'shop' }] };
  const r3 = sanitizeRun(cat, data, json(mid), (w) => assert.fail(w));
  assert.deepEqual([r3.v, r3.seg, r3.layer, r3.map.length, r3.done.map((d) => d.id), candidates(r3).map((n) => n.id)], [3, 2, 2, 1, ['2-0-0', '2-1-0'], full[2].layers[2].map((n) => n.id)]);
  const o = play(r3, profile, 3); // 일반 1 + 강팀 + 보스
  assert.deepEqual([o.champion, o.end, r3.seg, r3.map[0].layers[0][0].id.slice(0, 2)], [true, null, 3, '3-']);
  // 더 새 버전은 읽지 않는다(되돌린 서버가 v3 도전을 깨진 저장으로 격리하지 않게 handlers 가 먼저 FLAME_SAVE_NEWER 로 거절한다)
  assert.equal(sanitizeRun(cat, data, { ...json(r3), v: SAVE_VERSION + 1 }), null);
});

test('순위표: 구간 -> 승수 -> 먼저 달성 순, 같은 값은 같은 순위, 손님 제외, 기록은 역행하지 않고, 저장에서 다시 만들어도 같다', () => {
  const store = new SqliteFlameStore(openDb(':memory:')), accounts = new Set(['a', 'b', 'c', 'd', 'old', 'oldchamp', 'e']);
  const mk = () => new FlameRanking({ store, isAccount: (k) => accounts.has(k), top: 50, segments: cat.rules.run.segments });
  const rank = mk();
  const put = (key, nick, seg, wins, at, team = ['윤이음', '표우람', '@3:1']) => { const p = freshProfile(); p.best.seg = seg; p.best.wins = wins; p.best.rank = { seg, wins, at, team, diff: key === 'b' ? 1 : 0 }; store.save(key, nick, p, null); rank.update(key, nick, p); return p; };
  put('a', 'A', 5, 18, 300); put('b', 'B', 7, 25, 200); put('c', 'C', 5, 18, 100); put('d', 'D', 5, 17, 50); put('guest', '손님', 9, 40, 10);
  const old = freshProfile(); old.best.seg = 3; old.best.wins = 12; store.save('old', 'Old', old, null); rank.update('old', 'Old', old); // 엔드리스 이전 기록(best.rank 없음), 우승 못 함 = 구간 3 그대로
  // 리뷰 M2: 엔드리스 이전 우승자(구간 3 에서 끝남, clears > 0)는 구간 4 로 읽혀 새 우승자(구간 3 보스 격파 = 구간 4 도달)와 같은 구간·같은 순위다
  const oc = freshProfile(); oc.best.seg = 3; oc.best.wins = 12; oc.best.clears = 1; store.save('oldchamp', 'OldChamp', oc, null); rank.update('oldchamp', 'OldChamp', oc);
  put('e', 'E', 4, 12, 400);
  const b = rank.board(50, 'a', 'A');
  assert.deepEqual(b.top.map((r) => [r.rank, r.nick, r.seg, r.wins]), [[1, 'B', 7, 25], [2, 'C', 5, 18], [2, 'A', 5, 18], [4, 'D', 5, 17], [5, 'OldChamp', 4, 12], [5, 'E', 4, 12], [7, 'Old', 3, 12]]);
  assert.deepEqual([b.total, b.me.rank, b.me.nick, b.top[0].diff, b.top[0].team, b.top[4].team, rank.board(50, 'guest', '손님').me, rank.board(2).top.length], [7, 2, 'A', 1, ['윤이음', '표우람', '@3:1'], [], null, 2]);
  // 서버 재시작(메모리 표를 저장에서 다시 만든다): 같은 표
  assert.deepEqual(mk().board(50, 'a', 'A'), b);
  // 기록 역행 없음: 멀리 간 도전 뒤에 일찍 진 도전·포기를 해도 순위 기록은 그대로다. 진행 중인 도전도 보스를 이기면 반영된다
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 31 });
  play(run, profile, 8, { now: 5000 });
  assert.deepEqual([profile.best.rank.seg, profile.best.rank.wins, profile.best.rank.at, profile.best.rank.team.length], [3, 8, 5008, 3]); // 구간 2 보스 격파 시점(진행 중)
  Run.settle(cat, run, profile, 'abandon', 0, 6000);
  const kept = json(profile.best.rank);
  const run2 = Run.newRun(cat, data, profile, { seed: 32 });
  const end = play(run2, profile, 2, { loseAt: 2, now: 9000 }).end;
  assert.deepEqual([end.result, end.seg, profile.best.rank, sanitizeProfile(cat, json(profile)).best.rank], ['defeat', 1, kept, kept]);
});

test('순위표·카탈로그 로비 연결: flame_ranking_get -> flame_ranking{top, me, total}(손님은 me:null), flame_catalog.endless, 클론 칸 cast.sp', async () => {
  const msg = catalogMsg(cat);
  assert.deepEqual([msg.endless.enabled, msg.endless.championSegments, msg.endless.itemMax, catalogMsg({ ...cat, endless: null }).endless], [true, 3, 60, { enabled: false, championSegments: 3 }]);
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 41 }), def = cat.pool.players[0];
  run.roster[6] = { ...run.roster[6], from: { ...def.body }, clone: def.id, sp: [null, null], recruited: true }; delete run.roster[6].orig;
  assert.equal(Run.viewOf(cat, data, run, profile).run.cast.players[6].sp, null); // D38 부여 구조: 클론에게는 원래 필살기가 없다(종전 legacy 에서는 풀의 sp)
  const app = createServer({ store: new MemoryResultStore(), dbPath: ':memory:', importJson: false, log: () => {} }), port = await app.listen(0);
  try {
    const ws = openWs(port), got = [];
    const wait = (t) => new Promise((res, rej) => { const tm = setTimeout(() => rej(new Error('timeout ' + t)), 3000); const chk = () => { const i = got.findIndex((m) => m.t === t); if (i >= 0) { clearTimeout(tm); res(got.splice(i, 1)[0]); } else setTimeout(chk, 5); }; chk(); });
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString())));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ t: 'hello', nickname: '순위손님' })); await wait('welcome');
    ws.send(JSON.stringify({ t: 'flame_ranking_get' }));
    const m = await wait('flame_ranking');
    assert.deepEqual([m.top, m.me, m.total], [[], null, 0]);
    ws.close();
  } finally { await app.close(); }
});

// ---------- 엔드리스 리뷰(정검수) 반영: M1·L1 (M2 는 위 순위표 시험) ----------
test('엔드리스 리뷰 M1: 영구 저장이 더 새 형식(v = PROFILE_VERSION + 1)이면 FLAME_SAVE_NEWER 로 거절하고 덮어쓰지 않는다(도전 저장 버전과 따로 비교)', async () => {
  const app = createServer({ store: new MemoryResultStore(), dbPath: ':memory:', importJson: false, log: () => {} }), port = await app.listen(0);
  try {
    const ws = openWs(port), got = [];
    const wait = (t) => new Promise((res, rej) => { const tm = setTimeout(() => rej(new Error('timeout ' + t)), 3000); const chk = () => { const i = got.findIndex((m) => m.t === t); if (i >= 0) { clearTimeout(tm); res(got.splice(i, 1)[0]); } else setTimeout(chk, 5); }; chk(); });
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString())));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ t: 'hello', nickname: '새형식A' })); await wait('welcome');
    const st = app.lobby.flame, key = '새형식a';
    const newer = { ...freshProfile(), v: PROFILE_VERSION + 1, coins: 500, future: 'x' };
    assert.ok(newer.v <= SAVE_VERSION); // 도전 저장 버전으로 비교하면 걸리지 않는 값
    st.save(key, '새형식A', newer, null);
    ws.send(JSON.stringify({ t: 'flame_perm', id: 'PA01' })); // 저장이 일어나는 요청
    assert.equal((await wait('error')).code, 'FLAME_SAVE_NEWER');
    assert.deepEqual(st.getProfile(key), newer); // 원본 그대로
    ws.close();
  } finally { await app.close(); }
});

test('엔드리스 리뷰 L1: 엔드리스로 우승이 반영된 도전을 엔드리스를 끈 뒤 이어서 보스를 이겨 우승으로 끝나도 우승 횟수는 +1 만, 우승·첫 우승 코인도 한 번', () => {
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 5 });
  play(run, profile, 12);
  assert.deepEqual([run.champ, profile.best.clears, run.seg], [{ first: true }, 1, 3]);
  const end = play(run, profile, 4, { resCat: { ...cat, endless: null } }).end; // 구간 4 보스 승리 = 종전 규칙의 우승 종료
  assert.deepEqual([end.result, end.championed, profile.best.clears, end.coins.champion, end.coins.first], ['champion', true, 1, 200, 300]);
});
