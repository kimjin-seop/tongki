// 불꽃의 계승 영구 성장 표 개정(analysis/39 D50, analysis/40 §21.4). 핵심 동작만 본다: 풀강화 합계 / 옛 표 저장을 읽을 때의 단계 환산(효과 보존·환불 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../server/engine/index.js';
import { loadCatalog } from '../server/flame/catalog.js';
import { freshProfile, sanitizeProfile, PERM_TABLE_VERSION } from '../server/flame/save.js';
import { computeTeam } from '../server/flame/stats.js';
import * as Run from '../server/flame/run.js';

const data = loadData(), cat = loadCatalog();

test('영구 성장 D50: 풀강화 9,480코인 · 37단계(A 3,000 · B 2,980 · C 3,500)', () => {
  const sum = (g) => [...cat.perm.values()].filter((u) => u.group === g).reduce((a, u) => [a[0] + u.costs.reduce((x, c) => x + c, 0), a[1] + u.maxLevel], [0, 0]);
  assert.deepEqual([sum('A'), sum('B'), sum('C')], [[3000, 7], [2980, 22], [3500, 8]]);
});

test('영구 성장 D50 이관: 옛 표 저장(permV 없음)은 읽을 때 총효과가 같은 단계로 바뀌고, A 는 새 maxLevel 을 넘어도 남지만 더 살 수 없다. 새 표 저장은 그대로', () => {
  const old = { v: 2, coins: 1000, perm: { PA01: 3, PA02: 2, PB01: 2, PB06: 2, PB03: 1, PC02: 1, ZZ9: 4 }, teams: { recent: null } };
  const p = sanitizeProfile(cat, old);
  // PA01 3 × HP+2 -> 6 × +1 · PA02 2 × +1 그대로(새 maxLevel 1 초과 보존) · PB01 2 × +30 -> 4 × +15 · PB06 2 × 10% -> 4 × 5% · 모르는 id 버림
  assert.deepEqual([p.permV, p.perm, p.coins], [PERM_TABLE_VERSION, { PA01: 6, PA02: 2, PB01: 4, PB03: 1, PB06: 4, PC02: 1 }, 1000]);
  assert.deepEqual(sanitizeProfile(cat, p), p); // 한 번만 바뀐다(다시 읽어도 같다)
  const ctx = (perm) => ({ roster: Array.from({ length: 7 }, (_, i) => ({ from: { team: 0, idx: i }, train: {}, equip: {}, sp: [null, null] })), items: [], artifacts: [null, null, null], fm: cat.cfg.formation.default, perm, buffs: [] });
  const add = computeTeam(cat, data, ctx(p.perm)).players[0].steps[1].add;
  assert.deepEqual([add.s0, add.s1], [6, 2]); // 옛 표의 HP +6 · 방어 +2 그대로
  assert.equal(Run.newRun(cat, data, p, { seed: 3 }).points, cat.matchPoints.start + 60); // 시작 포인트 +60 그대로
  assert.throws(() => Run.buyPerm(cat, p, 'PA01'), (e) => e.code === 'FLAME_MAX');
  const fresh = { ...freshProfile(), perm: { PA01: 3, PB01: 2 } };
  assert.deepEqual(sanitizeProfile(cat, fresh).perm, { PA01: 3, PB01: 2 }); // 새 표 저장은 환산하지 않는다
});
