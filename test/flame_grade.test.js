// 불꽃의 계승 등급제(analysis/39 D39~D44, PROTOCOL §13.22). 핵심 동작 + 에러 없음만 본다:
// 등급 아이템 생성(188 + 60)·등급 추첨 실측·같은 키 재현 / 종류당 최고 등급 하나·자동 판매·위력 가산·위력 상한(D45) / 올려 찾기 제한 프로브·자동 무효(D46·D48) / 포메이션 아이템(선택권·태그·등급 보너스)·표시가 사라진 칸의 고유 슛.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, loadData } from '../server/engine/index.js';
import { loadCatalog, GRADES } from '../server/flame/catalog.js';
import { freshProfile, sanitizeRun, unlockedOf, FlameError } from '../server/flame/save.js';
import { rngSecret } from '../server/flame/rng.js';
import { rollGrade, artifactChoices } from '../server/flame/rewards.js';
import { isMatch } from '../server/flame/map.js';
import { teamOfRun, capSpecialFx, cleanSpecials } from '../server/flame/stats.js';
import * as Items from '../server/flame/items.js';
import * as Run from '../server/flame/run.js';
import * as Nodes from '../server/flame/nodes.js';
import { mkdtempSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/flame/data');

const data = loadData(), cat = { ...loadCatalog(), artifact: { ...loadCatalog().artifact, model: 'team' } }; // 아티팩트 스위치 team(종전 공용 3칸) 고정. off(기본값) 동작은 flame_noartifact.test.js
const code = (fn) => { try { fn(); return null; } catch (e) { if (e instanceof FlameError) return e.code; throw e; } };
const fresh = (seed = 91) => { const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed }); run.pending = []; return { profile, run }; };
const wear = (run, id) => { Items.addArtifact(cat, run, id); Items.setArtifact(cat, run, null, id, data); };

test('등급 아이템: 필살슛 47×4 = 188·포메이션 15×4 = 60 을 규칙으로 만들고, 등급 추첨이 가중치와 ±1%p 안에서 맞고, 같은 키는 같은 보상이다', () => {
  const gen = [...cat.artifacts.values()].filter((a) => a.grant);
  assert.deepEqual([cat.grade.on, gen.filter((a) => a.kind === 'shot').length, gen.filter((a) => a.kind === 'formation').length, cat.authored.length], [true, 188, 60, 30]);
  assert.ok(gen.every((a) => (a.kind === 'shot' ? a.id === `SP${a.grant.shot}-${a.grade}` : a.id === `FM${a.grant.formation}-${a.grade}`) && GRADES.includes(a.grade)));
  assert.deepEqual([cat.artifacts.get('SP22-A').grant, cat.artifacts.get('FM7-S').grant, cat.artifacts.has('SP0-C')], [{ shot: 22 }, { formation: 7 }, false]); // 표값 255 인 슛(0 등)은 만들지 않는다
  // 등급 추첨 대량 실측: 구간 1 보스 C62 / B30 / A7.8 / S0.2
  const N = 200000, cnt = Object.fromEntries(GRADES.map((g) => [g, 0])), rng = rngSecret('ab'.repeat(16), 'grade-test');
  for (let i = 0; i < N; i++) cnt[rollGrade(cat, rng, 'boss', 0)]++;
  for (const g of GRADES) assert.ok(Math.abs((cnt[g] / N) * 100 - cat.grade.drop.boss[0][g]) < 1, `${g} ${(cnt[g] / N) * 100}%`);
  // 보스 3지선다 = 필살슛·포메이션·팀 강화 유형 고정, 같은 키는 다시 열어도 같다. A01~A06 은 새로 나오지 않는다
  const { profile, run } = fresh(), unlocked = unlockedOf(cat, profile.perm);
  const a = artifactChoices(cat, run, unlocked, 3, ['0-3-0', 0], 'boss'), b = artifactChoices(cat, run, unlocked, 3, ['0-3-0', 0], 'boss');
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((id) => cat.artifacts.get(id).kind ?? 'team'), ['shot', 'formation', 'team']);
  assert.ok(artifactChoices(cat, run, unlocked, 30, ['start', 0]).every((id) => cat.artifacts.get(id).unlockShotFamilies.length === 0 && !cat.artifacts.get(id).grant));
  const fw = artifactChoices(cat, run, unlocked, 3, ['0-0-0', 0], 'firstWin');
  assert.deepEqual([fw.length, new Set(fw).size, fw.every((id) => cat.artifacts.get(id).kind === 'shot' && cat.artifacts.get(id).grade === 'C')], [3, 3, true]); // 첫 승리 보상: 필살슛 C 택 1
  // 가진 등급 이하는 후보에서 빠진다: 전 슛을 S 로 가지면 필살슛 칸은 팀 강화 한 칸으로 대신한다(D46, grade.drop.emptyAsTeam)
  run.artifactsOwned = cat.grade.shotIds.map((s) => `SP${s}-S`);
  assert.deepEqual(artifactChoices(cat, run, unlocked, 3, ['0-3-0', 0], 'boss').map((id) => cat.artifacts.get(id).kind ?? 'team'), ['team', 'formation', 'team']);
});

test('필살슛 등급: 종류당 최고 등급 하나(상위 획득 = 하위 자동 판매·장착 칸 승계, 같거나 낮은 등급 거절), 등급 가산 C0/B8/A18/S35 는 상한 밖 전액, 그 밖의 가산은 +20, 캐치 가산은 평소 필살을 깎지 않는다', () => {
  const { profile, run } = fresh();
  wear(run, 'SP22-C');
  let t = teamOfRun(cat, data, run, profile.perm);
  assert.deepEqual([run.roster.map((r) => r.sp[0]), t.grant, t.players[0].special, t.players[0].fx.spPow], [Array(7).fill(22), [22], { id: 22, grade: 'C', add: 0, cut: 0, other: 0, cutCatch: 0 }, 0]);
  const points = run.points, sold = Items.addArtifact(cat, run, 'SP22-S');
  assert.deepEqual([sold, run.points - points, run.artifactsOwned, run.artifacts[0]], [{ id: 'SP22-C', points: cat.grade.price.sell.C }, cat.grade.price.sell.C, ['SP22-S'], 'SP22-S']);
  assert.deepEqual([code(() => Items.addArtifact(cat, run, 'SP22-B')), code(() => Items.addArtifact(cat, run, 'SP22-S')), run.artifactsOwned], ['FLAME_INVALID', 'FLAME_INVALID', ['SP22-S']]);
  t = teamOfRun(cat, data, run, profile.perm);
  assert.deepEqual([t.players[0].special, t.players[0].fx.spPow, run.roster[0].sp], [{ id: 22, grade: 'S', add: 35, cut: 0, other: 0, cutCatch: 0 }, 35, [22, null]]);
  // 정검수 M2 재현 빌드: SP22-S + A07(필살 +5) + A01(불꽃 +5) + 선수 0 = G10(필살 +6) + H08(불꽃 +6) -> 그 밖의 가산 22 는 20 으로 잘리고 등급 35 는 그대로 = 평소 필살 +55
  const G = cat.grade, T = data.specials.power[22];
  const pow = (fx, caught = false) => Math.floor(((T + fx.chargePow + fx.airPow + (caught ? fx.catchPow : 0) + fx.spPow + fx.spAirPow + (fx.famPow.flame ?? 0)) * (100 + fx.spPct + (fx.famPct.flame ?? 0))) / 100) - T; // 엔진 flThrowPow 와 같은 식(표값 대비 증가분)
  for (const a of ['A07', 'A01']) wear(run, a);
  for (const id of ['G10', 'H08']) Items.equip(cat, run, 0, Items.addItem(cat, run, id).inst);
  Items.equip(cat, run, 1, Items.addItem(cat, run, 'G10').inst);
  const S = teamOfRun(cat, data, run, profile.perm).players;
  assert.deepEqual([[G.spOtherCap, G.spPowCap], S[0].special, pow(S[0].fx), pow(S[1].fx), pow(S[2].fx)], [[20, 60], { id: 22, grade: 'S', add: 35, cut: 2, other: 20, cutCatch: 0 }, 55, 35 + 16, 35 + 10]);
  // 같은 빌드의 A 등급: S 가 언제나 +17 이상 세다(종전에는 상한 45 에 같이 걸려 차이가 줄었다)
  const runA = JSON.parse(JSON.stringify(run));
  runA.artifactsOwned = runA.artifactsOwned.map((a) => (a === 'SP22-S' ? 'SP22-A' : a)); runA.artifacts = runA.artifacts.map((a) => (a === 'SP22-S' ? 'SP22-A' : a));
  const A = teamOfRun(cat, data, runA, profile.perm).players;
  for (const k of [0, 1, 2]) assert.ok(pow(S[k].fx) - pow(A[k].fx) >= G.spPow.S - G.spPow.A, `선수 ${k}: S ${pow(S[k].fx)} A ${pow(A[k].fx)}`);
  // 정검수 M1: 캐치 가산 장비(H09 +6)를 껴도 평소 필살은 약해지지 않는다(종전에는 그만큼 깎였다)
  Items.equip(cat, run, 1, Items.addItem(cat, run, 'H09').inst);
  const p1 = teamOfRun(cat, data, run, profile.perm).players[1];
  assert.deepEqual([pow(p1.fx), pow(p1.fx, true), p1.fx.catchPow, p1.special.cutCatch, p1.special.cut], [35 + 16, 35 + 16 + 6, 6, 0, 0]);
  const o = Run.matchOptions(cat, data, run, profile, run.map[0].layers.flat().find((n) => isMatch(n.type))).flame;
  assert.deepEqual([o.allow.includes(22), pow(o.roster[0].fx), pow(o.roster[1].fx, true)], [true, 55, 57]);
  assert.doesNotThrow(() => new Match({ seed: 3, teams: [0, 8], data, humans: [false, false], flame: o }));
  // 전체 안전 상한(+60): 이 재현 빌드로는 닿지 않아 값으로 직접 본다 — 평소 +55 에 캐치 가산 9 면 캐치 가산만 5 로 줄고(캐치 직후 +60) 평소 필살은 그대로다
  const fx = { ...p1.fx, famPow: {}, famPct: {}, chargePow: 0, airPow: 0, spAirPow: 0, spPct: 0, spPow: 55, catchPow: 9 };
  assert.deepEqual([capSpecialFx(cat, fx, 22, T, 35, G.spOtherCap, G.spPowCap), fx.catchPow, pow(fx), pow(fx, true)], [{ cut: 0, cutCatch: 4, other: 20 }, 5, 55, 60]);
  // 시너지 조건(D47): A01 대신 「불꽃 계열 슛을 부여하는 아티팩트」 — SP22 아이템 + A13 으로 SX01 이 켜진다
  const r2 = fresh().run;
  for (const a of ['SP22-C', 'A13']) wear(r2, a);
  assert.deepEqual(teamOfRun(cat, data, r2, profile.perm).synergies, ['SX01']);
});

test('필살 속도 등급(D52): 주 슬롯 슛의 등급 아이템 등급 값이 fx.spSpd(C0/B4/A10/S24)로 엔진 옵션까지 가고, 등급 아이템이 없으면 0, 데이터 상한 64 초과는 카탈로그가 거절', () => {
  const { profile, run } = fresh();
  delete run.roster[0].orig; cleanSpecials(cat, data, run.roster, run.artifacts); // 선수 0 = 원작 선수(고유 슛 22)
  let p0 = teamOfRun(cat, data, run, profile.perm).players[0];
  assert.deepEqual([p0.kind, p0.special.id, p0.fx.spSpd], ['original', 22, 0]); // 고유 슛 단독 = 등급 없음 = 0
  wear(run, 'SP22-B'); // 고유 슛 + 같은 슛 아이템 = 그 등급
  p0 = teamOfRun(cat, data, run, profile.perm).players[0];
  assert.deepEqual([p0.special.grade, p0.fx.spSpd], ['B', cat.grade.spSpd.B]);
  Items.addArtifact(cat, run, 'SP22-S');
  const o = Run.matchOptions(cat, data, run, profile, run.map[0].layers.flat().find((n) => isMatch(n.type))).flame;
  assert.deepEqual([cat.grade.spSpd, o.roster[0].fx.spSpd], [{ C: 0, B: 4, A: 10, S: 24 }, 24]);
  assert.doesNotThrow(() => new Match({ seed: 3, teams: [0, 8], data, humans: [false, false], flame: o }));
  const dir = mkdtempSync(path.join(tmpdir(), 'flame-spspd-'));
  for (const f of readdirSync(SRC)) copyFileSync(path.join(SRC, f), path.join(dir, f));
  const dec = JSON.parse(readFileSync(path.join(dir, 'decisions.json'), 'utf8'));
  dec.grade.spSpd.S = 65;
  writeFileSync(path.join(dir, 'decisions.json'), JSON.stringify(dec));
  assert.throws(() => loadCatalog({ dir }), /grade\.spSpd/);
});

test('등급 추첨 프로브(정검수 M3·L3·L1): 보유가 찬 상태로 2000회 — 가중치 0 인 등급은 나오지 않고(상점 S·첫 승리 B 이상 0), 보스의 S 는 직접 추첨 비율만, 낼 것이 없는 칸은 팀 강화로 대신한다. 받을 수 없게 된 선택은 자동 무효', () => {
  const { profile, run } = fresh(), unlocked = unlockedOf(cat, profile.perm), N = 2000;
  const gradeOf = (id) => cat.artifacts.get(id).grade ?? null, kindOf = (id) => cat.artifacts.get(id).kind ?? 'team';
  // 전 종류를 A 로 보유: 종전에는 「한 등급 올려 찾기」로 모든 칸이 S 가 됐다
  run.artifactsOwned = [...cat.grade.shotIds.map((s) => `SP${s}-A`), ...cat.grade.fmIds.map((f) => `FM${f}-A`)];
  const seen = { boss: [], shop: [], firstWin: [] };
  for (let k = 0; k < N; k++) for (const src of Object.keys(seen)) seen[src].push(...artifactChoices(cat, run, unlocked, 3, [`probe-${k}`, 0], src));
  const sOf = (src) => seen[src].filter((id) => gradeOf(id) === 'S').length;
  assert.deepEqual([sOf('shop'), sOf('firstWin'), seen.shop.every((id) => kindOf(id) === 'team'), seen.firstWin.every((id) => kindOf(id) === 'team'), seen.firstWin.length], [0, 0, true, true, 3 * N]);
  assert.ok(seen.boss.length === 3 * N && seen.boss.every((id) => kindOf(id) === 'team' || gradeOf(id) === 'S')); // 보스 3칸은 그대로 서고(팀 강화로 대신), 등급 아이템은 직접 뽑힌 S 뿐이다
  assert.ok(sOf('boss') / (2 * N) < (cat.grade.drop.boss[0].S / 100) * 3 + 0.002, `보스 S ${sOf('boss')} / ${2 * N}칸`); // 직접 추첨 0.2% 언저리(종전 100%)
  // 전 슛을 C 로만 보유: 첫 승리 보상은 B 로 올라가지 않는다. 상점은 A 까지만(S 0)
  run.artifactsOwned = cat.grade.shotIds.map((s) => `SP${s}-C`);
  const fw = [], shop = [];
  for (let k = 0; k < N; k++) { fw.push(...artifactChoices(cat, run, unlocked, 3, [`probe2-${k}`, 0], 'firstWin')); shop.push(...artifactChoices(cat, run, unlocked, 1, ['shop', `probe2-${k}`], 'shop')); }
  assert.deepEqual([fw.some((id) => gradeOf(id) !== null), shop.some((id) => gradeOf(id) === 'S'), shop.some((id) => gradeOf(id) === 'B')], [false, false, true]);
  // 자동 무효(L3): SP22-B 를 받으면 뒤에 선 선택의 SP22-C 는 빠지고(남은 칸으로 진행), 빈 선택은 통째로 빠진다. 받을 수 없는 칸을 골라도 거절하지 않는다
  const r2 = fresh().run;
  r2.pending = [{ kind: 'artifact', src: 'x', nodeType: 'boss', choices: ['SP22-B', 'A07'], n: 0 }, { kind: 'artifact', src: 'y', nodeType: 'normal', choices: ['SP22-C', 'SP25-C'], n: 0, g: 'firstWin' }, { kind: 'artifact', src: 'z', nodeType: 'boss', choices: ['SP22-C'], n: 0 }];
  assert.equal(Run.choose(cat, data, r2, profile, 0), null);
  assert.deepEqual([r2.artifactsOwned, r2.pending.map((p) => p.choices)], [['SP22-B'], [['SP25-C']]]);
  r2.pending[0].choices = ['SP22-C', 'SP25-C']; // 변경 전 저장처럼 받을 수 없는 칸이 남아 있는 경우
  assert.deepEqual([Run.choose(cat, data, r2, profile, 0), r2.pending.map((p) => p.choices), r2.artifactsOwned], [{ voided: true, id: 'SP22-C' }, [['SP25-C']], ['SP22-B']]);
  // 상점 구매의 자동 판매 알림(L1)
  r2.pending = []; r2.node = { id: 's', type: 'shop', stock: [{ kind: 'artifact', id: 'SP22-A', price: 0, sold: false }] };
  assert.deepEqual(Nodes.buy(cat, r2, 0), { upgraded: true, id: 'SP22-A', sold: 'SP22-B', points: cat.grade.price.sell.B });
});

test('포메이션 아이템: 기본 포메이션은 태그·보너스 없음, 아이템을 끼면 그 패턴·태그·등급 보너스, 빼면 기본으로. 표시가 사라진 칸은 고유 슛을 얻지 않는다', () => {
  const { profile, run } = fresh(), def = cat.cfg.formation.default;
  wear(run, 'A13'); // 공격형 포메이션에서 공격력 +3
  let t = teamOfRun(cat, data, run, profile.perm);
  const s4 = t.players[1].final.s4, s7 = t.players[1].final.s7;
  assert.deepEqual([run.fm, t.fm, t.tag, t.fmItem, code(() => Run.setFormation(cat, data, run, 1))], [def, def, null, null, 'FLAME_LOCKED']);
  wear(run, 'FM1-S'); // V자(공격형) S: 태그 보너스 200%(A13 3 -> 6) + 공격 +2 · 투구속도 +2 · 패스속도 +4
  t = teamOfRun(cat, data, run, profile.perm);
  assert.deepEqual([run.fm, t.fm, t.tag, t.fmGrade, t.players[1].final.s4 - s4, t.players[1].final.s7 - s7, t.players[1].steps[5].add], [1, 1, 'attack', 'S', 6 + 2, 4, { s4: 8, s6: 2, s7: 4 }]);
  assert.equal(Run.matchOptions(cat, data, run, profile, run.map[0].layers.flat().find((n) => isMatch(n.type))).flame.fm, 1);
  assert.equal(code(() => Run.setFormation(cat, data, run, def)), null); // 기본 포메이션은 언제나 고를 수 있다
  Run.setFormation(cat, data, run, 1);
  Items.setArtifact(cat, run, run.artifacts.indexOf('FM1-S'), null, data);
  t = teamOfRun(cat, data, run, profile.perm);
  assert.deepEqual([run.fm, t.tag, t.players[1].final.s4], [def, null, s4]);
  // 구 저장(아이템 없이 고른 패턴)은 읽을 때 기본 포메이션이 된다. 풀에서 사라진 클론 칸은 원작 선수로 이어지되 고유 슛이 없다(정검수 L1)
  const raw = JSON.parse(JSON.stringify(run));
  raw.fm = 5; raw.roster[6].clone = 'c999999'; delete raw.roster[6].orig; raw.roster[6].sp = [22, null];
  const read = sanitizeRun(cat, data, raw), t2 = teamOfRun(cat, data, read, profile.perm);
  assert.deepEqual([read.fm, read.roster[6].lost, read.roster[6].sp, t2.players[6].kind, t2.players[6].own], [def, true, [null, null], 'original', null]);
});
