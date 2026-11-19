// 불꽃의 계승 팀 공용 아티팩트 끄기(analysis/39 D58~D63, analysis/44, decisions.json artifact.model = 'off'). 핵심 동작 + 에러 없음만 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../server/engine/index.js';
import { loadCatalog, roundHalfUp } from '../server/flame/catalog.js';
import { freshProfile, sanitizeProfile, sanitizeRun, FlameError } from '../server/flame/save.js';
import { teamOfRun } from '../server/flame/stats.js';
import * as Items from '../server/flame/items.js';
import * as Run from '../server/flame/run.js';

const data = loadData(), cat = loadCatalog();
const code = (fn) => { try { fn(); return null; } catch (e) { if (e instanceof FlameError) return e.code; throw e; } };
const fresh = () => { const r = Run.newRun(cat, data, freshProfile(), { seed: 3 }); r.pending = []; return r; };

test('선수별 필살기 아이템(off): SP22-S 를 선수 0 에게 끼우면 선수 0 만 주 슬롯 22·등급 S 가산을 받고, 선수 1 이 22 를 넣으면 FLAME_LOCKED. 공용 칸 요청은 FLAME_INVALID, 포메이션 아이템은 태그 보너스 × 등급 배율', () => {
  assert.equal(cat.artifact.model, 'off');
  const run = fresh(), profile = freshProfile(), G = cat.grade;
  Items.addArtifact(cat, run, 'SP22-S');
  Items.setSpItem(cat, data, run, 0, 'SP22-S');
  const t = teamOfRun(cat, data, run, profile.perm), o = Run.matchOptions(cat, data, run, profile, { id: 'x', type: 'normal', opp: { team: 1, cpuLevel: 1, stage: 0 } });
  assert.deepEqual([t.players[0].special.id, t.players[0].special.grade, t.players[0].special.add, t.players[0].fx.spSpd, t.players[0].spItem], [22, 'S', G.spPow.S, G.spSpd.S, 'SP22-S']);
  assert.deepEqual([t.players[1].special.id, t.players[1].special.add, t.players[1].fx.spSpd, t.synergies, t.grant], [null, 0, 0, [], []]);
  assert.deepEqual([o.flame.roster[0].sp[0], o.flame.roster.slice(1).every((r) => r.sp[0] === null), o.flame.allow.includes(22)], [22, true, true]);
  assert.deepEqual([code(() => Items.setSpecial(cat, data, run, 1, [22, null])), code(() => Items.setSpItem(cat, data, run, 1, 'SP22-S')), code(() => Items.setArtifact(cat, run, null, 'SP22-S', data))], ['FLAME_LOCKED', 'FLAME_EQUIPPED', 'FLAME_INVALID']);
  Items.setSpItem(cat, data, run, 0, null);
  assert.deepEqual(run.roster[0].sp, [null, null]); // 불씨: 빼면 「필살기 없음」
  // 포메이션 아이템(팀 1칸): FM1-S(공격형) = 태그 보너스 s4 +3 × 200% + 등급 팀 가산 s4
  const before = teamOfRun(cat, data, run, profile.perm).players[1].final.s4;
  Items.addArtifact(cat, run, 'FM1-S'); Items.setFmItem(cat, run, 'FM1-S');
  const tf = teamOfRun(cat, data, run, profile.perm);
  assert.deepEqual([tf.fm, tf.tag, tf.players[1].final.s4 - before], [1, 'attack', roundHalfUp(3 * G.formation.tagPct.S, 100) + G.formation.stat.s4.S]);
});

test('옛 도전 저장 이관(off): 낀 SP 는 주 슬롯이 그 슛인 첫 선수에게, FM 은 fmItem, A 번호는 버리고 1개당 refundPoints 환급(다시 읽어도 한 번), A 번호만 남은 선택은 통째로 빠진다. 영구 저장 PC03 은 코인 한 번 환불', () => {
  const run = fresh(), raw = structuredClone(run);
  Object.assign(raw, { artifactsOwned: ['SP22-A', 'A19', 'A07', 'FM1-B'], artifacts: ['SP22-A', 'A19', 'FM1-B'], fm: 1, points: 100 });
  delete raw.fmItem;
  raw.roster[2].sp = [22, null]; raw.roster[4].sp = [22, null];
  raw.pending = [{ kind: 'artifact', src: 'a', nodeType: 'boss', choices: ['A20', 'A21'], n: 0 }, { kind: 'artifact', src: 'b', nodeType: 'boss', choices: ['A22', 'SP25-C'], n: 0 }];
  let why = null;
  const back = sanitizeRun(cat, data, raw, (w) => { why = w; });
  assert.equal(why, null);
  assert.deepEqual([back.roster[2].spItem, back.roster[2].sp[0], back.roster[4].spItem, back.roster[4].sp[0], back.artifactsOwned, back.artifacts, back.fmItem, back.fm, back.points, back.pending.map((p) => p.choices)],
    ['SP22-A', 22, undefined, null, ['SP22-A', 'FM1-B'], [null, null, null], 'FM1-B', 1, 100 + 2 * cat.artifact.refundPoints, [['SP25-C']]]);
  const again = sanitizeRun(cat, data, structuredClone(back));
  assert.deepEqual([again.points, again.roster[2].spItem, again.fmItem], [back.points, 'SP22-A', 'FM1-B']); // 두 번 환급하지 않는다
  assert.equal(teamOfRun(cat, data, back, {}).players[2].special.grade, 'A');
  const p = sanitizeProfile(cat, { v: 2, permV: 2, coins: 10, perm: { PC03: 2, PA01: 1 } }), p2 = sanitizeProfile(cat, p);
  const back3 = cat.perm.get('PC03').costs.reduce((a, c) => a + c, 0);
  assert.deepEqual([p.coins, p.perm, p.artV, p2.coins], [10 + back3, { PA01: 1 }, 1, 10 + back3]);
  assert.equal(code(() => Run.buyPerm(cat, { ...p, coins: 9999 }, 'PC03')), 'FLAME_LOCKED');
});

test('옛 저장 포메이션 이관(off, 정검수 M1): 쓰던 패턴의 아이템을 고르고 없으면 기본 패턴 아이템, 둘 다 없으면 null — run.fmItem 과 team.fmItem 이 언제나 같다. 시작 보상 A 번호 후보는 필살기 아이템 후보로 바뀐다(L6)', () => {
  const D = cat.cfg.formation.default;
  for (const [arts, fm, want, wantFm] of [[['FM1-C', 'FM3-B', null], 3, 'FM3-B', 3], [['FM1-C', `FM${D}-B`, null], D, `FM${D}-B`, D], [['FM1-C', null, null], D, null, D], [['FM1-C', `FM${D}-C`, null], 3, `FM${D}-C`, D]]) {
    const raw = structuredClone(fresh());
    Object.assign(raw, { artifactsOwned: arts.filter(Boolean), artifacts: arts, fm }); delete raw.fmItem;
    const b = sanitizeRun(cat, data, raw), t = teamOfRun(cat, data, b, {});
    assert.deepEqual([b.fmItem, b.fm, t.fmItem, t.fm], [want, wantFm, want, wantFm], `${arts} fm=${fm}`);
  }
  const raw = structuredClone(fresh());
  raw.pending = [{ kind: 'artifact', src: 'start', nodeType: 'start', choices: ['A20', 'A21'], n: 0 }];
  const s1 = sanitizeRun(cat, data, raw), s2 = sanitizeRun(cat, data, structuredClone(raw));
  assert.equal(s1.pending[0].choices.length, 2);
  assert.ok(s1.pending[0].choices.every((c) => /^SP\d+-[CBAS]$/.test(c)));
  assert.deepEqual(s1.pending[0].choices, s2.pending[0].choices);
});
