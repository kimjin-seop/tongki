// 불꽃의 계승: 시작 팀 랜덤 구성(decisions.json roster.startClones). 핵심 동작만: 제약 만족·재현성·저장 왕복, 스위치 꺼짐 = 고정 시작 팀.
// 서버·포트·DB 를 쓰지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../server/engine/index.js';
import { loadCatalog } from '../server/flame/catalog.js';
import { freshProfile, sanitizeRun } from '../server/flame/save.js';
import * as Run from '../server/flame/run.js';

delete process.env.FLAME_START_CLONES; // 데이터 파일 값 그대로
const data = loadData(), on = loadCatalog({ patch: (raw) => { raw.decisions.roster.startClones.enabled = true; } }), off = loadCatalog({ patch: (raw) => { raw.decisions.roster.startClones.enabled = false; } });
const S = on.startClones;

test('flame 시작 팀 랜덤: 칸별 역할·등급·점수 대역·몸/이름 중복 없음을 지키고, 같은 비밀값 = 같은 라인업(재현), 다른 비밀값 = 다른 라인업, 저장 왕복·상태 조회 정상', () => {
  assert.ok(S && S.slots.length === 7);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const secret = `s${i}`.padEnd(32, '0'), run = Run.newRun(on, data, freshProfile(), { seed: 100 + i, secret });
    const defs = run.roster.map((r) => on.pool.byId.get(r.clone));
    assert.ok(defs.every(Boolean) && run.roster.every((r) => !r.orig));
    assert.deepEqual(defs.map((d) => [d.role, d.grade]), S.slots.map((s) => [s.role, s.grade]));
    const sum = defs.reduce((s, d) => s + d.pts, 0);
    assert.ok(sum >= S.band.min && sum <= S.band.max, `pts ${sum}`);
    assert.equal(new Set(run.roster.map((r) => `${r.from.team}:${r.from.idx}`)).size, 7);
    assert.equal(new Set(defs.map((d) => d.given)).size, 7);
    assert.deepEqual(run.roster.map((r) => r.from), defs.map((d) => d.body)); // 엔진 from = 몸
    assert.equal(run.origTeam, on.original.id);
    assert.equal(run.seen.players[0], `c:${defs[0].id}`);
    const again = Run.newRun(on, data, freshProfile(), { seed: 999, secret }); // 지도 시드가 달라도 비밀값이 같으면 같은 라인업
    assert.deepEqual(again.roster.map((r) => r.clone), run.roster.map((r) => r.clone));
    seen.add(run.roster.map((r) => r.clone).join());
    const back = sanitizeRun(on, data, JSON.parse(JSON.stringify(run)));
    assert.deepEqual(back.roster.map((r) => r.clone), run.roster.map((r) => r.clone)); // 이어하기: 저장 왕복 뒤에도 같은 라인업
    const v = Run.viewOf(on, data, run, freshProfile());
    assert.deepEqual([v.team.players.length, v.run.cast.players.every((p) => p.kind === 'clone')], [7, true]);
  }
  assert.ok(seen.size >= 30);
});

test('flame 시작 팀 랜덤 스위치: 꺼짐 = 기존 고정 오리지널 7명(비밀값과 무관), 환경 변수 FLAME_START_CLONES=0 도 같다', () => {
  const run = Run.newRun(off, data, freshProfile(), { seed: 5, secret: 'a'.repeat(32) });
  assert.deepEqual(run.roster.map((r) => r.orig), off.original.players.map((p) => p.id));
  assert.ok(run.roster.every((r) => !r.clone));
  process.env.FLAME_START_CLONES = '0';
  try { assert.equal(loadCatalog().startClones, null); } finally { delete process.env.FLAME_START_CLONES; }
});

// D68 첫 경기 노드 상대 제한(decisions.json run.firstNode): 켜면 구간 1 첫 경기 층 상대가 허용 팀 안, 끄면 종전 무작위
import { genSegment } from '../server/flame/map.js';
test('flame 첫 노드 상대 제한: 켜면 첫 경기 층이 allowTeams 안(2·5 는 후속 층), 끄면 종전 무작위', () => {
  const mk = (en) => loadCatalog({ patch: (raw) => { raw.decisions.run.firstNode = { enabled: en, allowTeams: [1, 3] }; } });
  const a = mk(true), b = mk(false), first = (c, seed) => genSegment(c, data, seed, 0, { roster: [], diff: 0, oppUnlocked: [] }).layers[0].map((n) => n.opp.team);
  const seenOff = new Set();
  for (let s = 1; s <= 200; s++) {
    assert.ok(first(a, s).every((t) => [1, 3].includes(t)), `seed ${s}`);
    first(b, s).forEach((t) => seenOff.add(t));
  }
  assert.ok(seenOff.has(2) && seenOff.has(5)); // 끄면 팀 2·5 도 첫 노드에 나온다(종전)
  const later = genSegment(a, data, 7, 0, { roster: [], diff: 0, oppUnlocked: [] }).layers[2].map((n) => n.opp.team);
  assert.deepEqual(later.sort(), [2, 5]);
});
