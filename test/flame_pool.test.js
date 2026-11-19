// 불꽃의 계승 2차: 영입 풀(오리지널 클론 + 원작 희귀 발견, analysis/39 D18·D22·D23, analysis/42). 핵심 동작 + 에러 없음만 본다.
// 서버·포트·DB 를 쓰지 않는다(카탈로그·도전 상태 함수와 엔진 Match 만).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Match, loadData } from '../server/engine/index.js';
import { loadCatalog, playerPts, POOL_GRADES } from '../server/flame/catalog.js';
import { catalogMsg } from '../server/flame/handlers.js';
import { freshProfile, sanitizeProfile, sanitizeRun, unlockedOf, SAVE_VERSION } from '../server/flame/save.js';
import { candidates, isMatch } from '../server/flame/map.js';
import * as Nodes from '../server/flame/nodes.js';
import * as Run from '../server/flame/run.js';
import { generatePool, serializePool } from '../server/flame/tools/gen_recruit_pool.mjs';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/flame/data');
const data = loadData(), cat = loadCatalog();
const key = (v) => `${v.team}:${v.idx}`;
/** 영입실 한 번 방문(구간 seg). 후보 칸(저장 형식)을 돌려준다 */
function visit(c, run, profile, seg, id) {
  run.seg = seg; run.pending = [];
  Nodes.openNode(c, data, run, profile.perm, unlockedOf(c, profile.perm), { id, type: 'recruit' });
  return run.pending[0].choices;
}

test('flame 영입 풀 생성: 같은 입력 = 같은 파일(결정적), id·이름·겉모습 중복 0, 300명', () => {
  const spec = JSON.parse(readFileSync(path.join(DATA_DIR, 'recruit_pool_spec.json'), 'utf8'));
  const a = generatePool(spec), b = generatePool(spec);
  assert.equal(serializePool(a), serializePool(b));
  assert.equal(serializePool(a), readFileSync(path.join(DATA_DIR, 'recruit_pool.json'), 'utf8')); // 저장된 풀 = 입력으로 다시 만든 풀(손으로 고치지 않았다)
  const n = a.players.length, uniq = (f) => new Set(a.players.map(f)).size;
  assert.deepEqual([n, uniq((p) => p.id), uniq((p) => p.name), uniq((p) => `${key(p.body)}:${p.skin.uni}:${p.skin.hair}`)], [300, 300, 300, 300]);
  assert.deepEqual([a.players[0].id, a.players[299].id, a._meta.poolId, cat.pool.active], ['c001', 'c300', `rp${spec.version}-s20261119-n300`, 300]);
});

test('flame 영입 후보: 구간 등급 확률의 비율로 나오고, 내 로스터와 같은 몸·한 도전 안 같은 후보가 없다. 원작 희귀 칸은 방문당 최대 1칸', () => {
  const G = cat.cfg.recruit.clone.gradePct, O = cat.cfg.recruit.original, N = 400;
  const tally = G.map(() => Object.fromEntries(POOL_GRADES.map((g) => [g, 0]))), rare = G.map(() => 0);
  for (let seed = 1; seed <= N; seed++) {
    const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed });
    const mine = new Set([...run.roster.map((r) => key(r.from)), ...cat.original.players.map((p) => key(p.skin))]), all = [];
    for (let seg = 0; seg < G.length; seg++) {
      const ch = visit(cat, run, profile, seg, `r${seg}`);
      assert.equal(ch.length, cat.cfg.recruit.candidatesBase);
      assert.ok(ch.filter((c) => c.rare).length <= O.maxPerVisit);
      for (const c of ch) {
        assert.ok(!mine.has(key(c)), `시드 ${seed}: 로스터와 같은 몸 ${key(c)}`);
        if (c.clone) tally[seg][cat.pool.byId.get(c.clone).grade]++; else rare[seg]++;
        all.push(c.clone ?? key(c));
      }
    }
    assert.equal(new Set(all).size, all.length, `시드 ${seed}: 한 도전 안 후보 중복`);
    assert.deepEqual(run.recruitShown, all);
  }
  G.forEach((row, seg) => {
    const total = POOL_GRADES.reduce((s, g) => s + tally[seg][g], 0);
    POOL_GRADES.forEach((g, i) => assert.ok(Math.abs((100 * tally[seg][g]) / total - row[i]) < 6, `구간 ${seg + 1} ${g} 급 ${((100 * tally[seg][g]) / total).toFixed(1)}% (표 ${row[i]}%)`));
    assert.ok(Math.abs((100 * rare[seg]) / N - O.visitPct[seg]) < 6, `구간 ${seg + 1} 원작 칸 ${((100 * rare[seg]) / N).toFixed(1)}% (표 ${O.visitPct[seg]}%)`);
  });
  // 같은 도전·같은 노드 = 같은 후보(도전 비밀값 + 노드 ID)
  const mk = () => { const p = freshProfile(), r = Run.newRun(cat, data, p, { seed: 9 }); return visit(cat, r, p, 1, 'r1'); };
  assert.deepEqual(mk(), mk());
});

test('flame 원작 희귀 칸 규칙: 통키 팀·22~24 는 나오지 않고, 점수 -9 미만은 빠지고, 구간 상한(구간 1 = 팀 1~7, 구간 2 = 14 까지)과 해금 팀(PC01) 안에서만 나온다', () => {
  const O = cat.cfg.recruit.original, always = { ...cat, cfg: { ...cat.cfg, recruit: { ...cat.cfg.recruit, original: { ...O, visitPct: O.visitPct.map(() => 100) } } } };
  const seenTeams = [new Set(), new Set(), new Set()];
  for (const perm of [{}, { PC01: 2 }]) {
    for (let seed = 1; seed <= 60; seed++) {
      const profile = freshProfile(); profile.perm = perm;
      const run = Run.newRun(always, data, profile, { seed });
      for (let seg = 0; seg < 3; seg++) {
        const ch = visit(always, run, profile, seg, `r${seg}`), r = ch.filter((c) => c.rare);
        assert.deepEqual([r.length, ch.at(-1).rare, ch.filter((c) => c.clone).length], [1, true, ch.length - 1]); // 맞으면 마지막 한 칸만 원작
        const c = r[0], max = perm.PC01 ? [7, 14, 21][seg] : 7;
        assert.ok(c.team >= 1 && c.team <= max && ![0, 22, 23, 24].includes(c.team), `구간 ${seg + 1} 팀 ${c.team}`);
        assert.ok(playerPts(cat, data, c) >= O.minPts, `점수 ${playerPts(cat, data, c)}`);
        if (perm.PC01) seenTeams[seg].add(c.team);
      }
    }
  }
  assert.ok([...seenTeams[1]].some((t) => t > 7) && [...seenTeams[2]].some((t) => t > 14)); // 해금하면 구간 2·3 에서 상위 팀도 나온다
  assert.ok(data.teams.slice(1, 8).some((t) => t.players.some((p) => playerPts(cat, data, { team: t.id ?? data.teams.indexOf(t), idx: p.idx }) < O.minPts))); // 걸러지는 약한 원작이 실제로 있다
});

test('flame 클론 영입: 교체 자리에 클론이 들어가 자기 능력치·기본 필살기로 계산되고 엔진이 받아들인다. 표시 정의(후보 칸·cast)·도감 키·지도(상대)는 클론을 팀 소속으로 보지 않는다', () => {
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 21 });
  run.pending = [];
  const ch = visit(cat, run, profile, 0, 'r0'), i = ch.findIndex((c) => c.clone), def = cat.pool.byId.get(ch[i].clone);
  run.seg = 0; run.node = { id: 'r0', type: 'recruit' };
  const v0 = Run.viewOf(cat, data, run, profile).run.pending[0].choices[i], mapBefore = JSON.stringify(run.map);
  assert.deepEqual([v0.kind, v0.id, v0.name, v0.role, v0.grade, v0.sp, v0.stat.s0, v0.skin, [v0.team, v0.idx]], ['clone', def.id, def.name, def.role, def.grade, def.sp, def.stat.hp, { ...def.body, ...{ uni: def.skin.uni, hair: def.skin.hair } }, [def.body.team, def.body.idx]]);
  run.layer = 0; // advance 가 층을 넘긴다(시험용 가짜 노드)
  Run.choose(cat, data, run, profile, i, 6);
  const r = run.roster[6];
  assert.deepEqual([r.clone, r.from, r.sp, r.recruited, r.hp, run.seen.players.at(-1), JSON.stringify(run.map)], [def.id, def.body, [def.sp, null], true, def.stat.hp, `c:${def.id}`, mapBefore]);
  const view = Run.viewOf(cat, data, run, profile), pl = view.team.players[6], cast = view.run.cast.players[6];
  assert.deepEqual([pl.base.s0, pl.base.s4, pl.final.s1], [def.stat.hp, def.stat.pow, def.stat.def]); // 영구 성장 A 는 영입 선수에 붙지 않는다(B5)
  assert.deepEqual([cast.kind, cast.name, cast.grade, cast.locked, view.run.cast.players[0].kind, view.run.recruitShown], ['clone', def.name, def.grade, false, 'starter', undefined]);
  const node = { id: 'm', type: 'normal', opp: { team: def.body.team, cpuLevel: 1, stage: 0 } }, o = Run.matchOptions(cat, data, run, profile, node); // 몸을 빌린 팀과 붙어도 경기가 만들어진다
  assert.deepEqual([o.flame.roster[6].from, o.flame.roster[6].stat.hp, o.flame.roster[6].stat.thr], [def.body, def.stat.hp, def.stat.thr]);
  const m = new Match({ seed: 4, teams: [0, o.cpuTeam], data, humans: [false, false], cpuLevels: [2, 1], stage: 0, flame: o.flame });
  for (let k = 0; k < 200; k++) m.tick([0, 0]);
  assert.equal(m.info().teams[0].players[6].hp <= def.stat.hp, true);
  // 저장 왕복·도감: 클론 표시가 남고, 정산하면 도감에 c:<id> 로 적힌다
  const back = sanitizeRun(cat, data, JSON.parse(JSON.stringify(run)));
  assert.deepEqual([back.v, back.roster[6].clone, back.recruitShown], [SAVE_VERSION, def.id, run.recruitShown]);
  Run.settle(cat, run, profile, 'abandon');
  assert.ok(sanitizeProfile(cat, JSON.parse(JSON.stringify(profile))).codex.players.includes(`c:${def.id}`));
  const msg = catalogMsg(cat);
  assert.deepEqual([msg.recruit.clone, msg.recruit.count, msg.recruit.grades, msg.recruit.rareOriginal, JSON.stringify(msg).includes(def.name)], [true, 300, POOL_GRADES, true, false]); // 풀 명단은 카탈로그에 싣지 않는다
});

test('flame 구 저장·되돌리기: 영입 풀 전에 저장된 도전(후보 {team, idx}, recruitShown 없음)은 그대로 읽혀 영입까지 되고, 풀에서 없어진 클론은 칸을 버리지 않고 표시만 지운다. recruit.clone 키가 없으면 종전 영입(원작 선수만)', () => {
  const profile = freshProfile(), old = Run.newRun(cat, data, profile, { seed: 31 });
  old.pending = []; old.node = { id: candidates(old)[0].id, type: 'recruit' };
  const m = candidates(old)[0]; m.type = 'recruit'; delete m.opp; // 영입 노드에 서 있는 구 저장(시험용으로 첫 층을 영입 노드로 바꾼다)
  old.pending = [{ kind: 'recruit', node: m.id, choices: [{ team: 5, idx: 0 }, { team: 6, idx: 1 }] }];
  const back = sanitizeRun(cat, data, JSON.parse(JSON.stringify(old)));
  assert.deepEqual([back.v, back.recruitShown, back.pending[0].choices, back.roster.map((r) => r.clone)], [SAVE_VERSION, undefined, [{ team: 5, idx: 0 }, { team: 6, idx: 1 }], Array(7).fill(undefined)]);
  assert.equal(Run.viewOf(cat, data, back, profile).run.pending[0].choices[0].kind, 'original');
  Run.choose(cat, data, back, profile, 1, 6);
  assert.deepEqual([back.roster[6].from, back.roster[6].clone, back.seen.players.at(-1)], [{ team: 6, idx: 1 }, undefined, '6:1']);
  // 풀에서 없어진 id: 칸은 남고(그 몸의 원작 선수로) 표시만 지워진다
  const run = Run.newRun(cat, data, profile, { seed: 32 }), def = cat.pool.players[0];
  run.roster[6] = { ...run.roster[6], from: { ...def.body }, clone: def.id, recruited: true };
  delete run.roster[6].orig;
  const noPool = { ...cat, pool: { ...cat.pool, byId: new Map() } }, lost = sanitizeRun(noPool, data, JSON.parse(JSON.stringify(run)));
  assert.deepEqual([lost.roster.length, lost.roster[6].from, lost.roster[6].clone], [7, def.body, undefined]);
  assert.equal(sanitizeRun(cat, data, JSON.parse(JSON.stringify(run))).roster[6].clone, def.id);
  // 되돌리기: recruit.clone 키를 지우면 종전 영입(원작 선수 n 명, recruitShown 을 적지 않는다)
  const { clone, original, ...legacyRecruit } = cat.cfg.recruit, legacy = { ...cat, cfg: { ...cat.cfg, recruit: legacyRecruit } }; // eslint-disable-line no-unused-vars
  const r2 = Run.newRun(legacy, data, profile, { seed: 33 }), ch = visit(legacy, r2, profile, 0, 'r0');
  assert.deepEqual([ch.length, ch.every((c) => c.clone === undefined && c.rare === undefined && c.team >= 1 && c.team <= 7), r2.recruitShown, isMatch('recruit')], [3, true, undefined, false]);
});
