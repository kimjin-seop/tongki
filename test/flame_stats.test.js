// 불꽃의 계승 P3·P4: 능력치 파이프라인·장비·아티팩트·포메이션(server/flame/stats.js·items.js). 핵심 동작 + 에러 없음만 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../server/engine/index.js';
import { loadCatalog, checkAgainstEngine } from '../server/flame/catalog.js';
import { freshProfile, FlameError } from '../server/flame/save.js';
import { computeTeam, teamOfRun, upgradeBonus, upgradePreview } from '../server/flame/stats.js';
import * as Items from '../server/flame/items.js';
import { newRun } from '../server/flame/run.js';

const data = loadData(), cat = { ...loadCatalog(), artifact: { ...loadCatalog().artifact, model: 'team' } }; // 아티팩트 스위치 team(종전 공용 3칸) 고정. off(기본값) 동작은 flame_noartifact.test.js
const catOff = { ...cat, grade: { ...cat.grade, on: false } }; // 등급제 스위치(decisions.json grade.model)를 끈 것과 같은 카탈로그
const code = (fn) => { try { fn(); } catch (e) { if (e instanceof FlameError) return e.code; throw e; } return null; };
const fresh = () => { const run = newRun(cat, data, freshProfile(), { seed: 11 }); run.pending = []; return run; };
const give = (run, id, lv = 0) => { const it = Items.addItem(cat, run, id); it.lv = lv; return it.inst; };

test('flame 카탈로그: 40/30/20·영구 성장 17·특훈 11 을 읽고 엔진 데이터 참조(팀·포메이션·필살기)가 맞다', () => {
  assert.equal(checkAgainstEngine(cat, data), true);
  assert.deepEqual([cat.items.size, cat.authored.length, cat.consumables.size, cat.perm.size, cat.training.length], [40, 30, 20, 17, 11]); // 손으로 쓴 아티팩트 30종(등급 아이템 248종은 flame_grade.test.js)
  assert.deepEqual([...cat.perm.values()].reduce((a, u) => { a[u.group]++; return a; }, { A: 0, B: 0, C: 0 }), { A: 4, B: 7, C: 6 });
});

test('flame 파이프라인 9단계: 기본→영구→특훈→장비(강화)→아티팩트→포메이션→시너지→소모품→상한. 장비를 빼면 정확히 원복', () => {
  const cat = catOff; // 등급제(D42)를 끈 카탈로그: 이 시험은 포메이션을 아이템 없이 고르던 종전 규칙의 9단계 계산을 본다(등급제의 포메이션 아이템·등급 보너스는 flame_grade.test.js)
  const run = fresh(), perm = { PA01: 2, PA03: 1 };
  const before = teamOfRun(cat, data, run, perm);
  assert.deepEqual([before.players[0].final.s0, before.players[0].final.s4], [85 + 2, 28 + 1]); // 영구 성장: HP +1x2(D50), 공격력 +1
  // 통키(0:0): 기본 hp85 def10 spd16 s3 44 pow28
  run.roster[0].train = { s4: 2, r1: 30 };
  const h = give(run, 'H08', 3), g = give(run, 'G05'), pr = give(run, 'P09'), u = give(run, 'U07');
  for (const i of [h, g, pr, u]) Items.equip(cat, run, 0, i);
  for (const a of ['A13', 'A01', 'A19']) { Items.addArtifact(cat, run, a); Items.setArtifact(cat, run, null, a); }
  run.fm = 7; // 엔드 어택 = 공격형
  run.buffs = [{ c: 'C04', p: 0 }, { c: 'C10', p: 0 }, { c: 'C13', p: null }];
  const t = teamOfRun(cat, data, run, perm), p0 = t.players[0];
  // s4 = 28 + 영구 1 + 특훈 2 + H08(3 → +3 강화 5) + G05 3 + A19 2 + A13 3(공격형) + C04 3 = 47. SY01 의 공격력 +3 은 A13 과 같은 수치라 다시 더하지 않는다(D10)
  assert.deepEqual({ s0: p0.final.s0, s1: p0.final.s1, s2: p0.final.s2, s3: p0.final.s3, s4: p0.final.s4 }, { s0: 85 + 2 + 5, s1: 10 + 3 - 1, s2: 18, s3: 45, s4: 47 });
  assert.deepEqual(p0.steps.map((s) => s.add.s4 ?? 0), [28, 1, 2, 8, 2, 3, 0, 3, 0]);
  assert.deepEqual([p0.final.r1, p0.over.r1, p0.steps[8].add.r1], [60, 5, -5]); // R1 20 + 15 + 30 = 65 -> 상한 60
  assert.deepEqual([t.tag, t.synergies, t.allow], ['attack', ['SY01', 'SX01'], [22, 25]]);
  assert.deepEqual([p0.fx.famPow.flame, p0.fx.famPct.flame, t.players[3].fx.famPow.flame], [6 + 5 + 4, 10, 5 + 4]); // H08 은 낀 선수만, 아티팩트·시너지는 팀 전원
  assert.equal(t.players[1].final.s4, 20 + 1 + 2 + 3); // 다른 선수: 영구 + A19 + A13
  // 이동속도: 걷기 상한 3.0px/f 에 닿는 s2 = 36, 지금은 낭비 없음
  assert.deepEqual([p0.move.capS2, p0.move.wasted, p0.down], [36, 0, 60]);
  // 포메이션 변경 -> 조건부 보너스·시너지 재계산(수비형 호뢰관 5): A13·SY01·SX01 이 꺼진다. SX01 은 포메이션 무관이라 남는다
  run.fm = 5;
  const t2 = teamOfRun(cat, data, run, perm);
  assert.deepEqual([t2.tag, t2.synergies, t2.players[0].final.s4, t2.players[0].fx.famPct.flame ?? 0], ['defense', ['SX01'], 44, 0]);
  // 전술 교본(A18): 포메이션 보너스 x1.5 half-up (3 -> 5)
  run.fm = 7; run.artifacts[2] = null; Items.addArtifact(cat, run, 'A18'); Items.setArtifact(cat, run, null, 'A18');
  assert.equal(teamOfRun(cat, data, run, perm).players[1].steps[5].add.s4, 5);
  // 원복: 장비·아티팩트·특훈·소모품을 전부 빼면 처음과 완전히 같다
  for (const s of cat.slots) Items.unequip(cat, run, 0, s);
  run.artifacts = [null, null, null]; run.roster[0].train = {}; run.buffs = []; run.fm = cat.cfg.formation.default;
  assert.deepEqual(teamOfRun(cat, data, run, perm), before);
  // 하한: 방어 0 이상, HP 1 이상(전역 캐시 원본은 바뀌지 않는다)
  const low = computeTeam(cat, data, { roster: [{ from: { team: 0, idx: 0 }, train: { s1: -50, s0: -500 }, equip: {} }], items: [], artifacts: [], fm: 7 });
  assert.deepEqual([low.players[0].final.s1, low.players[0].final.s0, data.teams[0].players[0].def], [0, 1, 10]);
});

test('flame 장비: 4슬롯 독립, 같은 인스턴스 중복 장착 거절, 강화 +3(60/140/260 단계 지불·half-up·변화 없음), 판매', () => {
  const run = fresh();
  const h = give(run, 'H06'), g = give(run, 'G05'), h2 = give(run, 'H06');
  Items.equip(cat, run, 0, h); Items.equip(cat, run, 0, g);
  assert.deepEqual(run.roster[0].equip, { headband: h, glove: g, protector: null, uniform: null });
  assert.equal(code(() => Items.equip(cat, run, 1, h)), 'FLAME_EQUIPPED'); // 다른 선수가 낀 인스턴스
  assert.equal(run.roster[1].equip.headband, null);
  Items.equip(cat, run, 1, h2); // 같은 아이템의 다른 인스턴스는 된다
  Items.equip(cat, run, 0, h); // 같은 선수 재장착은 그대로
  Items.unequip(cat, run, 0, 'headband');
  assert.deepEqual([run.roster[0].equip.glove, run.roster[1].equip.headband, run.roster[0].equip.headband], [g, h2, null]); // 다른 칸·다른 선수 불변
  // 강화 표(D11): 기본값 -> +1/+2/+3
  const tbl = (b) => [1, 2, 3].map((lv) => b + upgradeBonus(cat, b, lv));
  assert.deepEqual([tbl(1), tbl(2), tbl(3), tbl(5), tbl(8), tbl(15)], [[1, 1, 2], [2, 3, 3], [4, 4, 5], [6, 7, 8], [10, 11, 13], [18, 21, 24]]);
  assert.equal(upgradeBonus(cat, -1, 3), 0); // 음수는 그대로
  assert.deepEqual([upgradePreview(cat, 'H01', 0).noChange, upgradePreview(cat, 'H01', 0).noChangeLabel, upgradePreview(cat, 'H06', 0).noChange], [true, '변화 없음', false]);
  run.points = 460;
  assert.deepEqual([1, 2, 3].map(() => Items.upgrade(cat, run, {}, g)), [60, 140, 260]);
  assert.deepEqual([run.points, run.items.find((i) => i.inst === g).lv, code(() => Items.upgrade(cat, run, {}, g))], [0, 3, 'FLAME_MAX']);
  assert.equal(code(() => Items.upgrade(cat, run, {}, h)), 'FLAME_NO_FUNDS');
  assert.equal(teamOfRun(cat, data, run, {}).players[0].final.s4, 28 + 5);
  assert.equal(Items.upgradeCost(cat, { PB06: 4 }, 0), 48); // 특훈 효율 4단계 = 20% 할인(D50: 단계당 5%)
  // 판매: 낀 장비는 거절, 인벤토리 장비만
  assert.equal(code(() => Items.sell(cat, run, g)), 'FLAME_EQUIPPED');
  assert.deepEqual([Items.sell(cat, run, h), run.points, run.items.length], [30, 30, 2]);
  // 자동 장착: 남이 낀 것은 뺏지 않고 빈 장비만
  const p = give(run, 'P07');
  Items.autoEquip(cat, run);
  assert.equal(Items.wearerOf(cat, run, p), 0);
});

test('flame 아티팩트·필살기: 3개 제한(4번째 거절), 장착하면 계열 해금 -> 해제하면 다시 잠금, 강위력(A06)은 불꽃·도끼를 열지 않는다', () => {
  const run = fresh();
  for (const a of ['A01', 'A02', 'A03', 'A06']) Items.addArtifact(cat, run, a);
  assert.deepEqual(teamOfRun(cat, data, run, {}).allow, []); // 갖고만 있으면 잠금
  for (const a of ['A01', 'A02', 'A03']) Items.setArtifact(cat, run, null, a, data);
  assert.equal(code(() => Items.setArtifact(cat, run, null, 'A06', data)), 'FLAME_FULL');
  assert.equal(code(() => Items.addArtifact(cat, run, 'A01')), 'FLAME_INVALID'); // 같은 아티팩트 중복 소지 없음
  assert.deepEqual(teamOfRun(cat, data, run, {}).allow, [1, 2, 11, 22, 25, 48, 49, 53]);
  Items.setSpecial(cat, data, run, 3, [22, 11]); // D3: 해금된 슛은 아무 선수나
  Items.setArtifact(cat, run, 0, null, data); // A01 해제
  assert.deepEqual(teamOfRun(cat, data, run, {}).allow, [1, 2, 11, 48, 49, 53]);
  assert.equal(code(() => Items.setSpecial(cat, data, run, 4, [22, null])), 'FLAME_LOCKED'); // 부여가 끊긴 슛은 넣을 수 없다
  assert.deepEqual(run.roster[3].sp, [11, null]); // D38: 뺀 아티팩트에서 온 슛(22)은 슬롯에서 비워지고 남은 예비 슛(11)이 주 슬롯으로 올라온다
  Items.setArtifact(cat, run, 0, 'A06', data);
  const allow = teamOfRun(cat, data, run, {}).allow;
  assert.ok(allow.includes(29) && allow.includes(53) && !allow.includes(22) && !allow.includes(25) && allow.includes(11)); // 11 은 A02 로 열린 것
  Items.setArtifact(cat, run, 1, null, data);
  assert.ok(!teamOfRun(cat, data, run, {}).allow.includes(11));
});

test('flame 소모품: 보유 5개·종류당 3개, 회복은 최대 HP 까지, 다음 경기 효과는 같은 대상에 한 번, 경기 뒤 만료(보스전용은 보스전 뒤)', () => {
  const run = fresh(), maxHp = teamOfRun(cat, data, run, {}).players.map((p) => p.final.s0);
  for (let i = 0; i < 3; i++) Items.addConsumable(cat, run, 'C01');
  assert.equal(code(() => Items.addConsumable(cat, run, 'C01')), 'FLAME_FULL'); // 종류당 3
  Items.addConsumable(cat, run, 'C04'); Items.addConsumable(cat, run, 'C20');
  assert.equal(code(() => Items.addConsumable(cat, run, 'C13')), 'FLAME_FULL'); // 전체 5
  assert.equal(code(() => Items.useConsumable(cat, run, 'C01', 0, maxHp)), 'FLAME_NO_EFFECT'); // HP 가 가득
  run.roster[0].hp = 70;
  Items.useConsumable(cat, run, 'C01', 0, maxHp);
  assert.deepEqual([run.roster[0].hp, run.consumables.C01], [85, 2]); // 70 + 20 -> 최대 85
  Items.useConsumable(cat, run, 'C04', 2, maxHp); Items.useConsumable(cat, run, 'C20', null, maxHp);
  Items.addConsumable(cat, run, 'C04');
  assert.equal(code(() => Items.useConsumable(cat, run, 'C04', 2, maxHp)), 'FLAME_DUP');
  assert.deepEqual([teamOfRun(cat, data, run, {}, 'normal').players[2].final.s4, teamOfRun(cat, data, run, {}, 'normal').players[1].final.s1, teamOfRun(cat, data, run, {}, 'boss').players[1].final.s1], [30 + 3, 8, 8 + 2]);
  Items.expireBuffs(cat, run, 'normal');
  assert.deepEqual(run.buffs, [{ c: 'C20', p: null }]);
  Items.expireBuffs(cat, run, 'boss');
  assert.deepEqual(run.buffs, []);
});
