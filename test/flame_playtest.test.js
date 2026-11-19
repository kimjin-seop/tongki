// 불꽃의 계승: 하플레이 보고 후속(영입실 입장 회복 D29, 도감 클론 정의). 핵심 동작 + 에러 없음만 본다.
// 서버·포트·DB 를 쓰지 않는다(카탈로그·도전 상태 함수만).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../server/engine/index.js';
import { loadCatalog, roundHalfUp } from '../server/flame/catalog.js';
import { catalogMsg } from '../server/flame/handlers.js';
import { freshProfile, sanitizeRun } from '../server/flame/save.js';
import { candidates } from '../server/flame/map.js';
import * as Run from '../server/flame/run.js';

const data = loadData(), cat = loadCatalog();
/** 영입실 입장 회복 값만 바꾼 카탈로그. v = undefined 면 키 없음(데이터 파일의 시작값과 무관하게 본다) */
const catRoom = (v) => { const cfg = { ...cat.cfg }; if (v === undefined) delete cfg.recruitRoom; else cfg.recruitRoom = { healPct: v }; return { ...cat, cfg }; };
/** 첫 층을 영입 노드로 바꾼 도전(시험용). 전원 HP 를 깎아 둔다(0번은 아웃되어 HP 1) */
function atRecruit(seed) {
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed });
  run.pending = [];
  const node = candidates(run)[0]; node.type = 'recruit'; delete node.opp;
  run.roster.forEach((r, i) => { r.hp = i === 0 ? 1 : 10 + i; });
  return { profile, run, node };
}

test('flame 영입실 입장 회복(D29): 들어갈 때 전원 최대 HP 의 healPct % 회복, 한 방문에 한 번(노드가 닫혀 다시 들어가도·저장 왕복 뒤에도 또 주지 않는다). 0 이거나 키가 없으면 종전 동작', () => {
  const C = catRoom(10), { profile, run, node } = atRecruit(41);
  const max = Run.viewOf(C, data, run, profile).team.players.map((p) => p.final.s0), before = run.roster.map((r) => r.hp);
  Run.enterNode(C, data, run, profile, node.id);
  const want = before.map((hp, i) => Math.min(max[i], hp + roundHalfUp(max[i] * 10, 100)));
  assert.deepEqual(run.roster.map((r) => r.hp), want);
  assert.ok(want[0] > 1 && want.every((hp, i) => hp > before[i]));
  const total = want.reduce((s, hp, i) => s + hp - before[i], 0);
  assert.deepEqual([Run.viewOf(C, data, run, profile).run.recruitHeal, run.pending[0].kind, catalogMsg(C).recruitRoomHealPct], [{ pct: 10, total }, 'recruit', 10]);
  // 재진입 악용: 선택이 사라져 노드가 닫힌 저장(sanitizeRun 이 같은 층에서 다시 고르게 한다)으로 같은 영입실에 다시 들어가도 회복은 없다
  const back = sanitizeRun(C, data, JSON.parse(JSON.stringify({ ...run, pending: [] })));
  assert.deepEqual([back.node, back.roomHeal], [null, { at: '0:0', pct: 10, total }]);
  Run.enterNode(C, data, back, profile, node.id);
  assert.deepEqual([back.roster.map((r) => r.hp), back.node.type, Run.viewOf(C, data, back, profile).run.roomHeal], [want, 'recruit', undefined]);
  // 영입을 마치고 나가면 표시 칸은 null
  Run.choose(C, data, back, profile, -1);
  assert.equal(Run.viewOf(C, data, back, profile).run.recruitHeal, null);
  // 끄기: 0 또는 키 없음 = 회복 없음, 저장에 아무것도 적지 않는다
  for (const off of [catRoom(0), catRoom(undefined)]) {
    const o = atRecruit(41), hp = o.run.roster.map((r) => r.hp);
    Run.enterNode(off, data, o.run, o.profile, o.node.id);
    assert.deepEqual([o.run.roster.map((r) => r.hp), o.run.roomHeal, Run.viewOf(off, data, o.run, o.profile).run.recruitHeal, catalogMsg(off).recruitRoomHealPct], [hp, undefined, null, 0]);
  }
});

test('flame 도감 클론 정의: flame_state.profile.codexCast 는 도감에 적힌 클론 키(c:<id>)에만 이름·역할·등급·skin 을 싣는다(원작 선수 키·풀에 없는 id 는 없음, 도감 키는 그대로)', () => {
  const profile = freshProfile(), def = cat.pool.players[0], keys = ['0:1', `c:${def.id}`, 'c:c999999'];
  profile.codex.players = keys.slice();
  const P = Run.viewOf(cat, data, null, profile).profile;
  assert.deepEqual(P.codexCast, { [`c:${def.id}`]: { id: def.id, kind: 'clone', name: def.name, role: def.role, grade: def.grade, skin: { ...def.skin } } });
  assert.deepEqual(P.codex.players, keys);
  assert.deepEqual(Run.viewOf(cat, data, null, freshProfile()).profile.codexCast, {});
});
