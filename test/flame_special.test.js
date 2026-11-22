// 불꽃의 계승 필살기 부여 구조(analysis/39 D38, PROTOCOL §13.21). 핵심 동작 + 에러 없음만 본다:
// 불씨·클론은 필살기 없음 -> 아티팩트를 끼면 대표 슛이 들어오고 빼면 비워진다 / 원작 선수는 고유 슛을 아티팩트 없이 쓴다(남의 슬롯에는 못 넣는다) / 구 저장 읽기 정리 / legacy 스위치.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, loadData } from '../server/engine/index.js';
import { loadCatalog } from '../server/flame/catalog.js';
import { catalogMsg } from '../server/flame/handlers.js';
import { freshProfile, sanitizeRun, FlameError } from '../server/flame/save.js';
import { isMatch } from '../server/flame/map.js';
import { versusOptions, snapshotOf } from '../server/flame/teams.js';
import * as Items from '../server/flame/items.js';
import * as Run from '../server/flame/run.js';

process.env.FLAME_START_CLONES = '0'; // 시작 팀 랜덤(roster.startClones)은 끄고 고정 시작 팀 기준으로 본다(랜덤 시작은 flame_startclones.test.js)
const data = loadData(), cat = { ...loadCatalog(), artifact: { ...loadCatalog().artifact, model: 'team' } }; // 아티팩트 스위치 team(종전 공용 3칸) 고정. off(기본값) 동작은 flame_noartifact.test.js
const code = (fn) => { try { fn(); return null; } catch (e) { if (e instanceof FlameError) return e.code; throw e; } };
const fresh = (seed = 71) => { const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed }); run.pending = []; return { profile, run }; };
const optsOf = (c, run, profile) => Run.matchOptions(c, data, run, profile, run.map[0].layers.flat().find((n) => isMatch(n.type))).flame; // 경기 시작 값만 본다(어느 경기 노드든 같다)
/** 영입 후보 한 칸을 6번 자리에 들인다(시험용 가짜 영입 노드) */
function recruit(run, profile, choice) {
  run.node = { id: 'r0', type: 'recruit' }; run.pending = [{ kind: 'recruit', node: 'r0', choices: [choice] }];
  Run.choose(cat, data, run, profile, 0, 6);
}

test('부여 구조: 불씨·클론은 필살기 없음(allow 빔) -> 아티팩트를 끼면 대표 슛이 빈 주 슬롯에, 빼면 「필살기 없음」. 엔진이 그 옵션을 받는다', () => {
  const { profile, run } = fresh(), def = cat.pool.players.find((p) => !p.retired && !run.roster.some((r) => r.from.team === p.body.team && r.from.idx === p.body.idx));
  assert.deepEqual([cat.special.model, catalogMsg(cat).special.artifactShots.A01], ['granted', 22]);
  assert.deepEqual([run.roster.map((r) => r.sp), optsOf(cat, run, profile).allow], [Array(7).fill([null, null]), []]); // 새 도전: 7명 전원 필살기 없음, 아티팩트 없이는 발동 허용 ID 가 없다
  recruit(run, profile, { team: def.body.team, idx: def.body.idx, clone: def.id });
  assert.deepEqual([run.roster[6].clone, run.roster[6].sp], [def.id, [null, null]]); // 클론 영입: 풀의 sp 를 갖고 오지 않는다
  Items.addArtifact(cat, run, 'A01'); Items.addArtifact(cat, run, 'A03');
  Items.setArtifact(cat, run, null, 'A01', data);
  assert.deepEqual(run.roster.map((r) => r.sp), Array(7).fill([22, null])); // A01 대표 슛(22)이 전원의 빈 주 슬롯에
  Items.setSpecial(cat, data, run, 1, [25, 22]);
  Items.setArtifact(cat, run, null, 'A03', data);
  assert.deepEqual([run.roster[0].sp, run.roster[1].sp], [[22, null], [25, 22]]); // 이미 슛이 있는 선수는 새 아티팩트가 건드리지 않는다
  const o = optsOf(cat, run, profile);
  assert.deepEqual([o.allow, o.roster[1].sp], [[1, 2, 22, 25, 48, 49, 53], [25, 22]]);
  assert.doesNotThrow(() => new Match({ seed: 3, teams: [0, 8], data, humans: [false, false], flame: o }));
  Items.setSpecial(cat, data, run, 2, [1, null]);
  Items.setArtifact(cat, run, 0, null, data); // A01 해제: 불꽃 슛이 슬롯에서 비워진다. A03 슛은 남는다
  assert.deepEqual([run.roster[0].sp, run.roster[1].sp, run.roster[2].sp, optsOf(cat, run, profile).allow], [[null, null], [null, null], [1, null], [1, 2, 48, 49, 53]]);
});

test('부여 구조: 원작 선수는 고유 슛을 아티팩트 없이 쓰고(allow·주 슬롯), 아티팩트 슛으로 바꿨다가 빼면 고유 슛으로 돌아온다. 남의 고유 슛은 FLAME_LOCKED', () => {
  const { profile, run } = fresh(72), own = data.specials.row[5][0];
  recruit(run, profile, { team: 5, idx: 0, rare: true });
  const view = Run.viewOf(cat, data, run, profile).team;
  assert.deepEqual([run.roster[6].sp, optsOf(cat, run, profile).allow, view.players[6].kind, view.players[6].own, view.players[0].kind, view.players[0].own, view.grant], [[own, null], [own], 'original', own, 'starter', null, []]);
  assert.equal(code(() => Items.setSpecial(cat, data, run, 0, [own, null])), 'FLAME_LOCKED'); // 고유 슛은 그 선수 전용
  assert.equal(code(() => Items.setSpecial(cat, data, run, 0, [data.specials.row[0][0], null])), 'FLAME_LOCKED'); // 불씨는 몸(from)의 원작 필살기를 쓸 수 없다
  Items.addArtifact(cat, run, 'A01'); Items.setArtifact(cat, run, null, 'A01', data);
  assert.deepEqual(run.roster[6].sp, [own, null]); // 원작 선수의 주 슬롯은 대표 슛으로 덮지 않는다
  Items.setSpecial(cat, data, run, 6, [22, null]);
  assert.deepEqual(optsOf(cat, run, profile).roster[6].sp, [22, null]);
  Items.setArtifact(cat, run, 0, null, data);
  assert.deepEqual([run.roster[6].sp, run.roster[0].sp, optsOf(cat, run, profile).allow], [[own, null], [null, null], [own]]);
});

test('부여 구조: 구 저장(불씨·클론이 필살기를 갖고 있던 도전)과 키운 팀 슬롯은 읽을 때 정리되고 원작 선수의 고유 슛은 남는다. legacy 스위치는 종전 그대로', () => {
  const { profile, run } = fresh(73), own = data.specials.row[5][0], body = data.specials.row[0];
  const def = cat.pool.players.find((p) => !p.retired && p.body.team !== 5 && !run.roster.some((r) => r.from.team === p.body.team && r.from.idx === p.body.idx));
  // 변경 전 서버가 쓴 모양: 불씨 = [몸의 원작 필살기, null], 클론 = [풀의 sp, null], 원작 선수 = [고유, null]
  run.roster.forEach((r, i) => { r.sp = [body[i], null]; });
  run.roster[5] = { ...run.roster[5], from: { ...def.body }, clone: def.id, sp: [def.sp, null], recruited: true }; delete run.roster[5].orig;
  run.roster[6] = { ...run.roster[6], from: { team: 5, idx: 0 }, sp: [own, null], recruited: true }; delete run.roster[6].orig;
  const raw = JSON.parse(JSON.stringify(run)), read = sanitizeRun(cat, data, raw);
  assert.deepEqual([read.v, read.roster.map((r) => r.sp)], [run.v, [...Array(6).fill([null, null]), [own, null]]]);
  const slot = snapshotOf(cat, run, profile, { seg: 1, wins: 1, now: 1 }), vs = versusOptions(cat, data, slot);
  assert.deepEqual([vs.flame.allow, vs.flame.roster.map((r) => r.sp[0])], [[own], [...Array(6).fill(null), own]]);
  // 스위치: decisions.json special.model = 'legacy' 면 종전(원래 필살기를 갖고 시작·읽을 때 그대로·아티팩트가 해금)
  const legacy = { ...cat, special: { ...cat.special, model: 'legacy' } };
  const old = Run.newRun(legacy, data, freshProfile(), { seed: 73 });
  assert.deepEqual([old.roster.map((r) => r.sp[0]), sanitizeRun(legacy, data, raw).roster.map((r) => r.sp[0]), optsOf(legacy, old, profile).allow, catalogMsg(legacy).special.model],
    [body.map((id) => (cat.excludedShots.has(id) ? null : id)), [...body.slice(0, 5).map((id) => (cat.excludedShots.has(id) ? null : id)), def.sp, own], [], 'legacy']);
});
