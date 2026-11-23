// 불꽃의 계승 컴퓨터 단계(tier.js, engine/boost.js). 핵심 동작 + 에러 없음만 본다. 경기·DB 없이 순수 함수와 엔진·지도 생성만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, loadData } from '../server/engine/index.js';
import { loadCatalog } from '../server/flame/catalog.js';
import { genSegment } from '../server/flame/map.js';
import { sanitizeRun } from '../server/flame/save.js';
import * as Run from '../server/flame/run.js';
import { freshProfile } from '../server/flame/save.js';
import { tierCfg, extraOf, tierOf, boostOf, coinBonusPct, saturate, strongPctOf, tierLabel } from '../server/flame/tier.js';

const data = loadData(), cat = loadCatalog(), T = tierCfg(cat);

test('단계 곡선: 구간 3 까지는 종전(추가 0), 뒤로 stepRuns 구간마다 +1, 단계 3 이하는 보정 없음, 4 이상은 단조 증가하며 상한 미만', () => {
  assert.ok(T, 'tier 설정이 켜져 있다');
  for (const seg of [0, 1, 2]) assert.equal(extraOf(T, seg), 0);
  const step = T.stepRuns;
  assert.equal(extraOf(T, 2 + step), 1);
  assert.equal(extraOf(T, 2 + step - 1), 0);
  assert.equal(tierOf(T, 3, 2 + step), 4);
  for (const n of [1, 2, 3]) assert.equal(boostOf(T, n), null);
  let prev = boostOf(T, 4);
  for (const n of [5, 8, 12, 20, 40, 1000, 1e6, 2e9]) {
    const b = boostOf(T, n);
    for (const k of ['catch256', 'special256', 'ballSpeedPct', 'hpPct']) assert.ok(b[k] >= prev[k] && Number.isSafeInteger(b[k]), k + ' ' + n);
    assert.ok(b.catch256 < T.catch256.max && b.ballSpeedPct < 100 + T.ballSpeedPct.max && b.hpPct < T.hpPct.max);
    prev = b;
  }
  assert.equal(saturate(500, 0, 28), 0);
  assert.ok(coinBonusPct(T, 4) > 0 && coinBonusPct(T, 1e9) === T.coin.cap && coinBonusPct(T, 3) === 0);
  assert.equal(strongPctOf(T, 3), 0);
  assert.equal(tierLabel(10000), '9999+');
});

test('지도: 구간 1~3 상대는 종전과 같고(tier 필드 없음), 구간 4 이상 노드에만 opp.tier(4 이상)가 붙으며 엔진 레벨은 3 이하다. 저장 검증을 통과한다', () => {
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 9 });
  for (const seg of [0, 1, 2]) for (const layer of genSegment(cat, data, 9, seg, { roster: run.roster, diff: 0, oppUnlocked: false }).layers) for (const n of layer) if (n.opp) assert.equal(n.opp.tier, undefined);
  const seg = 2 + T.stepRuns * T.unitSegs + 3, m = genSegment(cat, data, 9, seg, { roster: run.roster, diff: 0, oppUnlocked: false });
  const opps = m.layers.flat().filter((n) => n.opp).map((n) => n.opp);
  assert.ok(opps.length > 0 && opps.every((o) => o.cpuLevel <= 3 && o.tier > 3));
  run.seg = seg; run.map = [{ layers: m.layers }]; run.layer = 0;
  let bad = null; const ok = sanitizeRun(cat, data, JSON.parse(JSON.stringify(run)), (w) => { bad = w; }); assert.ok(ok && !bad, "저장 검증 실패 " + bad);
});

test('엔진: cpuBoost 없으면 같은 결과, 있으면 오류 없이 끝나고 빠른 공이 선수를 통과하지 않는다(공 속도 600%)', () => {
  const base = { seed: 4242, teams: [3, 9], data, humans: [false, false], cpuLevels: [3, 3], stage: 0, limitFrames: 1800 };
  const run = (extra) => { const m = new Match({ ...base, ...extra }); let throws = 0, hits = 0, n = 0; while (m.phase !== 'end' && n++ < 4000) { m.tick([0, 0]); for (const e of m.drainEvents()) { if (e.k === 'throw' && m.players[e.p].seat === 1) throws++; if (e.k === 'hit' && m.players[e.p].seat === 0) hits++; } } return { f: m.f, throws, hits, seed: m.rng.seed }; };
  assert.deepEqual(run({}), run({ cpuBoost: null }));
  const fast = run({ cpuBoost: { seat: 1, ballSpeedPct: 600, catch256: 90, special256: 90, hpPct: 60 } });
  assert.ok(fast.throws > 0);
});
