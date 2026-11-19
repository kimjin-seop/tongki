// 불꽃의 계승 P1: 엔진 flame 옵션(server/engine/flame.js, analysis/39). 핵심 동작 + 에러 없음만 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Match, loadData, BIT, ST } from '../server/engine/index.js';
import { FLAME_DEFAULTS } from '../server/engine/flame.js';

const data = loadData();
const FAM = { flame: [22, 25], axe: [11] };

function toLive(m) {
  let n = 0;
  while ((m.phase !== 'play' || m.tip.on) && n++ < 2000) m.tick([0, 0]);
  assert.ok(m.phase === 'play' && !m.tip.on);
}

/** 팀 t 의 7명 그대로인 로스터. over(i) 로 칸별 값을 덮는다 */
const roster = (t, over = () => ({})) => Array.from({ length: 7 }, (_, i) => ({ from: { team: t, idx: i }, ...over(i) }));
const flameMatch = (flame, o = {}) => new Match({ seed: 5, teams: [0, 1], data, humans: [true, true], limitFrames: 0, ...o, flame });

/** 좌석 0 선수 0 이 점프해 공중에서 B 를 n 프레임 누른 뒤 던진다(engine.test.js jumpThrow 와 같은 입력) */
function jumpThrow(m, n) {
  toLive(m);
  m.giveBall(m.players[0]); m.sides[0].ctrl = 0;
  m.tick([BIT.C, 0]); m.tick([BIT.B, 0]);
  for (let i = 1; i < n; i++) m.tick([BIT.B, 0]);
  m.tick([0, 0]);
  const ev = m.drainEvents();
  for (let i = 0; i < 12 && !ev.some((e) => e.k === 'throw'); i++) { m.tick([0, 0]); ev.push(...m.drainEvents()); }
  return ev;
}

test('flame 필살기: 해금 전에는 공중 차지 14 도 일반 슛(차지 가산은 남는다), 해금하면 주 슬롯 ID 로 발동하고 위력 가산이 붙는다', () => {
  const sp0 = (i) => (i === 0 ? { sp: [22, 11] } : {});
  // 잠금(allow 없음): 필살 없음, 위력 = s4 28 + 공중 7 + 차지 14
  let m = flameMatch({ roster: roster(0, sp0) });
  let ev = jumpThrow(m, 14);
  assert.ok(!ev.some((e) => e.k === 'special'));
  assert.deepEqual([m.ball.kind, ev.find((e) => e.k === 'throw').pw], [0, 49]);
  // 슬롯 2(예비)만 해금: 주 슬롯(22)이 잠겨 있어 발동하지 않는다(D1)
  m = flameMatch({ roster: roster(0, sp0), allow: [11] });
  assert.ok(!jumpThrow(m, 14).some((e) => e.k === 'special'));
  // 해금: ID 22, 위력 = 표값 75
  m = flameMatch({ roster: roster(0, sp0), allow: [22] });
  ev = jumpThrow(m, 14);
  assert.equal(ev.find((e) => e.k === 'special')?.id, 22);
  assert.deepEqual([m.ball.kind, m.ball.power, m.info().teams[0].players[0].spOn], [23, 75, 22]);
  // 위력 가산: 필살 +5, 불꽃 계열 +6, 공중 필살 +4, 차지 13~15 +4, 공중 +2 = 96 -> 불꽃 계열 +10% = 105 (고정값 합 뒤 %)
  const fx = { spPow: 5, spAirPow: 4, chargePow: 4, airPow: 2, famPow: { flame: 6, axe: 8 }, famPct: { flame: 10 } };
  m = flameMatch({ roster: roster(0, (i) => (i === 0 ? { sp: [22, null], fx } : {})), allow: [22], families: FAM });
  jumpThrow(m, 14);
  assert.equal(m.ball.power, 105);
  // 표값 255 인 ID(0)는 allow 에 넣어도 발동하지 않는다(D2)
  m = flameMatch({ roster: roster(0, (i) => (i === 0 ? { sp: [0, null] } : {})), allow: [0] });
  assert.ok(!jumpThrow(m, 14).some((e) => e.k === 'special'));
});

/** 좌석 0 선수 1 을 위력 pw 의 공으로 맞힌 뒤 [넉백 vx, vy, vz, 쓰러져 있던 프레임 수] */
function knock(flame, pw = 40) {
  const m = flameMatch(flame);
  toLive(m);
  const q = m.players[1];
  m.ball.power = pw; m.ball.ang = { i: 20, fl: 0 }; m.ball.thrower = 7;
  m.hitPlayer(q);
  const v = [q.vx, q.vy, q.vz];
  let down = 0;
  for (let i = 0; i < 400 && (q.st === ST.HIT || q.st === ST.DOWN); i++) { m.tick([0, 0]); if (q.st === ST.DOWN) down++; }
  return [...v, down];
}

test('flame R1 넉백 저항·R3 쓰러짐 단축: 수평 넉백만 (100-r1)% 로 줄고 vz 는 그대로, 쓰러짐은 r3 프레임 짧아진다. 상한 60%·24f(하한 36f)', () => {
  const ext = (e) => ({ roster: roster(0, (i) => (i === 1 ? { ext: e } : {})) });
  const base = knock(ext({})), a = knock(ext({ r1: 30, r3: 12 })), cap = knock(ext({ r1: 90, r3: 40 }));
  assert.ok(base[0] !== 0 && base[1] !== 0);
  assert.deepEqual(a.slice(0, 3), [Math.trunc(base[0] * 70 / 100), Math.trunc(base[1] * 70 / 100), base[2]]);
  assert.equal(a[3], base[3] - 12);
  assert.deepEqual(cap.slice(0, 2), [Math.trunc(base[0] * 40 / 100), Math.trunc(base[1] * 40 / 100)]); // 90% -> 상한 60%
  assert.equal(cap[3], base[3] - 24); // 40f -> 상한 24f
  assert.deepEqual([base[3] >= 59 && base[3] <= 60, cap[3] >= 35 && cap[3] <= 36], [true, true]); // 60 -> 36 (세는 방식에 따른 1프레임 차이 허용)
  // 상수는 기획 데이터(rules.json clamps)와 같아야 한다
  const C = JSON.parse(readFileSync(new URL('../server/flame/data/rules.json', import.meta.url), 'utf8')).clamps;
  assert.deepEqual([FLAME_DEFAULTS.r1MaxPct, FLAME_DEFAULTS.r2MaxPct, FLAME_DEFAULTS.r3MaxFrames, FLAME_DEFAULTS.downFramesMin], [C.r1MaxPct, C.r2MaxPct, C.r3MaxShortenFrames, C.downFramesMin]);
  // 걷기 상한(D14): s2 60 이면 걷기 4.5px/f -> 3.0px/f(대시 상한)로 잘린다
  const m = flameMatch({ roster: roster(0, (i) => (i === 0 ? { stat: { spd: 60 } } : {})) });
  toLive(m);
  m.sides[0].ctrl = 0; m.tick([BIT.RIGHT, 0]);
  assert.equal(m.players[0].vx, m.R.move.dashMax);
});

test('flame R2 캐치 후 밀림 감소: 필살 공을 잡은 flame 좌석 선수의 밀림 시작 속력이 (100-r2)% 가 되고, 잠금 상태에서는 받아치기도 일반 슛이다', () => {
  // 좌석 0(일반 팀 0)의 선수 0 이 필살 22 를 던지고 flame 좌석 1 의 선수 0 이 캐치 자세로 잡는다(engine.test.js 받아치기 시험과 같은 흐름)
  const play = (r2) => {
    const m = flameMatch({ seat: 1, roster: roster(1, (i) => (i === 0 ? { ext: { r2 }, sp: [28, null] } : {})) }, { seed: 2 });
    toLive(m);
    m.giveBall(m.players[0]); m.sides[0].ctrl = 0;
    const tk = (a, b) => { m.tick([a, b]); return m.drainEvents(); };
    tk(BIT.C, 0); for (let i = 0; i < 13; i++) tk(BIT.B, 0);
    let caught = null;
    for (let i = 0; i < 80 && !caught; i++) caught = tk(0, m.ball.sp && i >= 2 && ((i - 2) & 3) < 2 ? BIT.B : 0).find((e) => e.k === 'catch') ?? null;
    assert.ok(caught && caught.p === 7 && caught.kind === 23);
    const slideV = m.players[7].slideV;
    let frames = 0, thrown = null;
    for (let d = 0; d < 200 && !thrown; d++) {
      const ev = tk(0, d === 45 || d === 46 ? BIT.B : 0);
      if (m.players[7].slideV > 0) frames++;
      if (ev.some((e) => e.k === 'throw')) thrown = { sp: ev.find((e) => e.k === 'special') ?? null, kind: m.ball.kind };
    }
    return { slideV, frames, thrown };
  };
  const base = play(0), half = play(50);
  assert.equal(base.slideV, (60 + 8) << 4); // 원작 식 그대로: (min(위력 75, 60) + 8) * 16
  assert.equal(half.slideV, Math.floor(base.slideV * 50 / 100));
  assert.ok(half.frames < base.frames && half.frames > 0);
  assert.deepEqual(base.thrown, { sp: null, kind: 0 }); // 해금된 필살이 없는 선수는 창 안에 던져도 받아치기 필살이 아니다(lockCounter)
});

test('flame HP 입출력: 시작 HP 는 도전 전용 값(0 은 1 로), 종료 뒤 flameResult 가 최종 HP 를 돌려준다. HP 30% 이하 방어·치사 생존 1회', () => {
  const fx = { lowHpDef: 2, survive: 1 };
  const m = flameMatch({ roster: roster(0, (i) => (i === 0 ? { hp: 20, fx } : i === 1 ? { hp: 0 } : i === 2 ? { hp: 999 } : {})) });
  assert.deepEqual(m.players.slice(0, 3).map((p) => p.hp), [20, 1, data.teams[0].players[2].hp]); // 0 -> 1(D5), 최대 HP 초과 -> 최대 HP
  toLive(m);
  const q = m.players[0];
  m.ball.thrower = 7; m.ball.power = 15; m.hitPlayer(q); // HP 20/85 <= 30%: 방어 10 + 2 -> 피해 3
  assert.equal(q.hp, 17);
  for (let i = 0; i < 200 && q.st !== ST.IDLE; i++) m.tick([0, 0]);
  m.drainEvents();
  m.ball.power = 99; m.hitPlayer(q); // 치사 -> HP 1 로 생존(1회)
  assert.equal(q.hp, 1);
  assert.ok(m.drainEvents().some((e) => e.k === 'fl_survive' && e.p === 0));
  const r = m.flameResult();
  assert.deepEqual([r.seat, r.hp.slice(0, 3), r.maxHp[0], r.surviveUsed], [0, [1, 1, data.teams[0].players[2].hp], 85, [0]]);
  for (let i = 0; i < 200 && q.st !== ST.IDLE; i++) m.tick([0, 0]);
  m.ball.power = 99; m.hitPlayer(q); // 두 번째는 생존 없음
  assert.equal(m.flameResult().hp[0], 0);
  assert.equal(new Match({ seed: 5, teams: [0, 1], data }).flameResult(), null); // flame 옵션이 없으면 null
});

test('flame 조건부 투구: 캐치 후 첫 투구 위력 +N 은 한 번만, 패스를 받은 선수의 다음 투구 속도 +N(s6 단위)', () => {
  const m = flameMatch({ roster: roster(0, (i) => (i === 0 ? { fx: { catchPow: 6, passSpd: 4 } } : {})) });
  toLive(m);
  const [p0, p1] = m.players;
  const ground = (p) => { // 지상 B 투구
    m.sides[0].ctrl = p.pid;
    const ev = [];
    m.tick([BIT.B, 0]); ev.push(...m.drainEvents());
    for (let i = 0; i < 20 && !ev.some((e) => e.k === 'throw'); i++) { m.tick([0, 0]); ev.push(...m.drainEvents()); }
    return ev.find((e) => e.k === 'throw');
  };
  m.giveBall(p0); p0.flCatch = 1; // 캐치 성공 표시(hitOne 이 세운다)
  assert.equal(ground(p0).pw, p0.stat.pow + 6);
  m.giveBall(p0);
  assert.equal(ground(p0).pw, p0.stat.pow); // 두 번째 투구에는 없다
  // 패스: 선수 0 -> 선수 1, 받은 선수 1 의 투구 속력 = s6*16 + 4*16
  m.giveBall(p0); m.stepBall(); m.romPass(p0, p1);
  for (let i = 0; i < 120 && !p1.hasBall; i++) m.tick([0, 0]);
  assert.ok(p1.hasBall && p1.flPassSpd === 4);
  ground(p1);
  assert.equal(m.ball.spd8, (p1.stat.thr << 4) + (4 << 4));
});

test('flame 혼합 로스터: 여러 팀 선수 7명 + 포메이션 패턴 지정으로 컴퓨터 대 컴퓨터 한 판이 끝까지 진행되고, 전역 캐시 능력치는 오염되지 않는다', () => {
  const before = JSON.stringify(data.teams);
  const from = [[0, 0], [1, 1], [3, 0], [15, 0], [9, 2], [2, 0], [16, 0]];
  const flame = {
    roster: from.map(([team, idx], i) => ({ from: { team, idx }, stat: { pow: data.teams[team].players[idx].pow + 20, def: 12 }, ext: { r1: 20, r2: 20, r3: 6 }, sp: [data.specials.row[team][idx], null], fx: { catchPow: 6, passSpd: 4, spPow: 5, survive: i === 0 ? 1 : 0 } })),
    allow: from.map(([t, i]) => data.specials.row[t][i]), families: FAM, fm: 4,
  };
  const m = new Match({ seed: 11, teams: [0, 8], data, humans: [false, false], flame });
  const info = JSON.parse(JSON.stringify(m.info()));
  assert.deepEqual([info.teams[0].flame, info.teams[0].players[3].from, info.teams[0].players[3].idx, info.teams[1].flame], [true, { team: 15, idx: 0 }, 3, undefined]);
  assert.deepEqual([info.flame.seat, info.flame.fm, info.rules.formation.names[0]], [0, 4, 4]);
  assert.deepEqual([m.players[3].ot, m.players[3].oi, m.players[7].ot], [15, 0, undefined]); // 출신은 flame 좌석 선수만 든다
  let n = 0, sp = 0, fmN = 0;
  while (m.phase !== 'end' && n++ < 40000) { m.tick([0, 0]); for (const e of m.drainEvents()) { if (e.k === 'special' && e.p < 7) sp++; if (e.k === 'fm_start' && e.seat === 0) fmN++; } }
  assert.ok(m.result, '경기가 끝나지 않음');
  assert.ok(m.flameResult().hp.every((h) => Number.isInteger(h) && h >= 0));
  assert.ok(sp > 0, 'flame 좌석 필살 0회'); // 해금된 주 슬롯 필살이 실제로 나간다
  void fmN;
  // 복사본: flame 선수 능력치는 캐시 원본과 다른 객체이고 원본 값은 그대로다(같은 프로세스의 다음 일반 경기도 원본 참조)
  assert.ok(m.players[0].stat !== data.teams[0].players[0] && m.players[0].stat.ai !== data.teams[0].players[0].ai);
  assert.equal(m.players[0].stat.pow, data.teams[0].players[0].pow + 20);
  assert.equal(JSON.stringify(data.teams), before);
  assert.equal(new Match({ seed: 1, teams: [0, 1], data }).players[0].stat, data.teams[0].players[0]);
  // 사람 조작 + 무작위 입력 6000프레임: 예외 없음
  const h = new Match({ seed: 12, teams: [0, 8], data, humans: [true, false], cpuLevels: [null, 2], flame });
  let x = 99;
  for (let i = 0; i < 6000 && h.phase !== 'end'; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; h.tick([(x >>> 8) & 255, 0]); h.snapshot(); }
  // 잘못된 옵션은 생성 때 거절
  assert.throws(() => flameMatch({ roster: roster(0).slice(0, 6) }), /roster/);
  assert.throws(() => flameMatch({ roster: roster(0, (i) => (i === 1 ? { from: { team: 0, idx: 0 } } : {})) }), /중복/);
});

test('flame 옵션 검증(P1 리뷰 M1·M2): 정수가 아닌 from/team/fm/allow 는 거절(문자열로 중복 검사 우회 불가), 음수·소수 효과 거절, 과대 능력치·상한 스위치는 안전 범위로 자른다', () => {
  const bad = (flame) => assert.throws(() => flameMatch(flame), /flame:/);
  bad({ roster: roster(0, (i) => (i === 1 ? { from: { team: '0', idx: 0 } } : {})) }); // '0' 문자열로 같은 선수 중복
  bad({ roster: roster(0, (i) => (i === 1 ? { from: { team: 0, idx: 'length' } } : {})) });
  bad({ roster: roster(0), team: 'length' });
  bad({ roster: roster(0), fm: '7' });
  bad({ roster: roster(0), allow: ['22'] });
  bad({ roster: roster(0, () => ({ fx: { airPow: -500 } })) });
  bad({ roster: roster(0, () => ({ fx: { famPow: { flame: '6' } } })) });
  bad({ roster: roster(0, () => ({ fx: { famPct: { flame: 1.5 } } })) });
  bad({ roster: roster(0), caps: { walkCap: 'yes' } });
  const m = flameMatch({ roster: roster(0, (i) => (i === 0 ? { stat: { pow: 100000, thr: 5000 }, ext: { r1: 500 }, fx: { airPow: 99999 } } : {})), caps: { r1MaxPct: 200, downFramesMin: -5, evil: 1 } });
  const p = m.players[0];
  assert.deepEqual([p.stat.pow, p.stat.thr, p.fl.r1, p.fl.fx.airPow, m.fl.caps.r1MaxPct, m.fl.caps.downFramesMin, m.fl.caps.evil], [255, 255, 100, 255, 100, 1, undefined]);
  const ev = jumpThrow(m, 14);
  const pw = ev.find((e) => e.k === 'throw').pw;
  assert.ok(pw > 0 && pw <= 4095, `위력 ${pw}`);
});
