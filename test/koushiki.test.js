// こうしき(공식) 규칙 = 원작 $E680=1 (analysis/29 §3). 핵심 동작만: 아웃 규칙 / 필살 변환 / 시간 종료 판정
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, loadData, BIT, ST } from '../server/engine/index.js';

const data = loadData();
const toLive = (m) => { let n = 0; while ((m.phase !== 'play' || m.tip.on) && n++ < 2000) m.tick([0, 0]); assert.ok(m.phase === 'play' && !m.tip.on); };
const mk = (ruleMode, o = {}) => { const m = new Match({ seed: 2, teams: [0, 1], data, humans: [false, false], ruleMode, limitFrames: 0, ...o }); toLive(m); return m; };

/** 좌석 1 이 던진 공에 좌석 0 선수 0 이 맞은 직후 상태. after(m, q) 로 공의 행방을 정한 뒤 쓰러짐이 끝날 때까지 돌린다 */
function hitThen(ruleMode, after) {
  const m = mk(ruleMode), q = m.players[0], hp0 = q.hp;
  m.ball.thrower = 7; m.ball.power = 30; m.ball.mode = 1; m.ball.holder = -1;
  for (const p of m.players) p.hasBall = false;
  m.hitPlayer(q);
  const hpHit = q.hp;
  after(m, q);
  const ev = [];
  for (let i = 0; i < 400 && (q.st === ST.HIT || q.st === ST.DOWN); i++) { m.tick([0, 0]); ev.push(...m.drainEvents()); }
  return { m, q, hp0, hpHit, ev };
}
const drop = (m) => { m.ball.z = 1 << 16; m.ball.vz = -(1 << 16); m.ball.vx = 0; m.ball.vy = 0; m.ball.x = 250 << 16; m.ball.y = 40 << 16; }; // 다음 틱에 바닥(코트 가운데 위쪽, 아무도 없는 곳)

test('こうしき 아웃 규칙: 데미지 0, 맞은 공이 바닥에 닿거나 상대가 잡으면 쓰러짐 끝에 아웃, 같은 편이 먼저 잡으면 세이프', () => {
  // 바닥 -> 아웃 (원작 f272 피격 -> f309 착지 -> f374 아웃)
  const a = hitThen('official', drop);
  assert.equal(a.hpHit, a.hp0); // 맞는 순간 HP 불변
  assert.equal(a.m.sides[0].remaining, 6);
  assert.ok(a.q.dead && a.q.hp === 0 && a.ev.some((e) => e.k === 'out' && e.p === 0) && a.ev.some((e) => e.k === 'ref_out' && e.p === 0));
  // 상대(던진 쪽)가 바닥 전에 잡음 -> 아웃
  const b = hitThen('official', (m) => m.giveBall(m.players[7]));
  assert.equal(b.m.sides[0].remaining, 6);
  // 같은 편이 바닥 전에 잡음 -> 세이프(HP 그대로, 인원 그대로)
  const c = hitThen('official', (m) => m.giveBall(m.players[1]));
  assert.equal(c.m.sides[0].remaining, 7);
  assert.ok(!c.q.dead && c.q.hp === c.hp0 && !c.ev.some((e) => e.k === 'out'));
  // 체력제(기본)는 종전대로: 데미지가 들어가고 HP 가 남으면 바닥에 닿아도 아웃이 아니다
  const k = hitThen('knockout', drop);
  assert.ok(k.hpHit < k.hp0 && k.hpHit > 0);
  assert.equal(k.m.sides[0].remaining, 7);
});

test('こうしき 필살 변환: 공중 차지 13 은 체력제에서 필살 슛, こうしき 에서는 일반 슛(차지 가산은 그대로)', () => {
  const thr = (ruleMode) => {
    const m = mk(ruleMode, { humans: [true, true] });
    m.giveBall(m.players[0]); m.sides[0].ctrl = 0;
    m.tick([BIT.C, 0]); for (let i = 0; i < 13; i++) m.tick([BIT.B, 0]); m.tick([0, 0]);
    const ev = m.drainEvents();
    for (let i = 0; i < 12 && !ev.some((e) => e.k === 'throw'); i++) { m.tick([0, 0]); ev.push(...m.drainEvents()); }
    return { m, ev, t: ev.find((e) => e.k === 'throw') };
  };
  const ko = thr('knockout'), of = thr('official');
  assert.ok(ko.ev.some((e) => e.k === 'special') && ko.m.ball.kind > 0);
  assert.ok(of.t && !of.ev.some((e) => e.k === 'special'));
  assert.equal(of.m.ball.kind, 0);
  const pow = of.m.players[0].stat.pow;
  assert.equal(of.t.ch, 13);
  assert.equal(of.t.pw, pow + (pow >> 2) + 13); // 위력 = 기본 + 공중 1/4 + 차지 (원작 0x89AA)
});

test('こうしき 시간 종료: 남은 인원 많은 쪽 승, 같으면 PLAY OFF 로 양쪽 1-1 이 되고 다음 아웃으로 끝난다', () => {
  const run = (rem) => {
    const m = mk('official', { limitFrames: 10800 });
    [m.sides[0].remaining, m.sides[1].remaining] = rem;
    m.clock = 10799; m.tick([0, 0]);
    return m;
  };
  assert.deepEqual([run([7, 5]).result.winner, run([7, 5]).result.reason], [0, 'timeup']);
  assert.equal(run([5, 7]).result.winner, 1);
  // 동수: TIME UP 181f + PLAY OFF 181f 동안 선수는 멈춰 있고(원작 실행 확인), 그 뒤 1-1 로 재개
  const m = run([7, 7]);
  assert.ok(!m.sudden && !m.result && m.snapshot().ban[0] === 'time_up');
  const pos = () => JSON.stringify(m.players.map((p) => [p.x, p.y, p.z, p.st]));
  const p0 = pos();
  for (let i = 0; i < 300; i++) m.tick([BIT.RIGHT, BIT.LEFT]);
  assert.equal(m.snapshot().ban[0], 'play_off');
  for (let i = 0; i < 61; i++) m.tick([BIT.RIGHT, BIT.LEFT]);
  assert.ok(!m.sudden && pos() === p0);
  assert.deepEqual(m.snapshot().rem, [7, 7]);
  m.tick([0, 0]);
  assert.ok(m.sudden && !m.result);
  assert.deepEqual(m.snapshot().rem, [1, 1]);
  // PLAY OFF 뒤 아웃 1번 = 종료
  const q = m.players[7];
  m.ball.thrower = 0; m.ball.power = 30; m.ball.mode = 1; m.ball.holder = -1;
  for (const p of m.players) p.hasBall = false;
  m.hitPlayer(q); drop(m);
  for (let i = 0; i < 400 && !m.result; i++) m.tick([0, 0]);
  assert.deepEqual([m.result.winner, m.result.reason, m.result.rem], [0, 'sudden_death', [1, 0]]);
});

test('こうしき 정지 구간(TIME UP·PLAY OFF): 날아가는 공이 선수를 지나가도 hit 이벤트가 없다', () => {
  // 좌석 1 이 던진 비직역 FLY 공을 좌석 0 내야 선수 바로 앞에 놓는다. hold=false 는 같은 배치에서 정지만 푼 대조군(피격이 나야 배치가 유효)
  const run = (hold) => {
    const m = mk('official', { limitFrames: 10800 });
    m.clock = 10799; m.tick([0, 0]);
    assert.ok(m.timeHold > 0);
    m.drainEvents();
    const q = m.players.find((p) => p.seat === 0 && p.role === 'in' && m.hittable(p) && (p.st === ST.IDLE || p.st === ST.CROUCH) && !p.aiNoHit && !p.t44);
    const b = m.ball;
    for (const p of m.players) p.hasBall = false;
    Object.assign(b, { mode: 1, holder: -1, thrower: 7, power: 30, rom: false, sp: null, ang: null, romPass: false, x: q.x - (2 << 16), y: q.y, z: q.z + (8 << 16), vx: 1 << 16, vy: 0, vz: 0 });
    if (!hold) m.timeHold = 0;
    const ev = [];
    if (hold) for (let i = 0; i < 8; i++) { m.tick([0, 0]); ev.push(...m.drainEvents()); }
    else { m.stepBall(); ev.push(...m.drainEvents()); }
    return { ev, q };
  };
  assert.ok(run(false).ev.some((e) => e.k === 'hit'));
  const h = run(true);
  assert.ok(!h.ev.some((e) => e.k === 'hit' || e.k === 'catch') && h.q.st !== ST.HIT);
});

test('こうしき 정지 구간: 자작 안전망(stall_t44·stall_nudge)은 멈춘 공을 건드리지 않고, 강제 회수 선수는 그대로 남는다', () => {
  // hold=false 는 같은 배치에서 정지만 푼 대조군(안전망이 발동해야 배치가 유효)
  const run = (hold, still, t44) => {
    const m = mk('official', { limitFrames: 10800 });
    m.clock = 10799; m.tick([0, 0]);
    m.drainEvents();
    for (const p of m.players) { p.hasBall = false; p.t44 = null; }
    const q = m.players[1];
    if (t44) q.t44 = { sub: 0, busy: 0, age: m.R.stall.t44MaxFrames - 2 };
    Object.assign(m.ball, { mode: 3, holder: -1, x: 250 << 16, y: 40 << 16, z: 0, vx: 0, vy: 0, vz: 0, still, rom: false });
    if (!hold) m.timeHold = 0;
    const ev = [];
    if (hold) for (let i = 0; i < 12; i++) { m.tick([0, 0]); ev.push(...m.drainEvents()); }
    else for (let i = 0; i < 12; i++) { m.stepBall(); ev.push(...m.drainEvents()); }
    return { ev, q, b: m.ball };
  };
  const stall = (r) => r.ev.filter((e) => e.k.startsWith('stall_')).map((e) => e.k);
  assert.deepEqual(stall(run(false, 100, true)), ['stall_t44']);
  const a = run(true, 100, true);
  assert.ok(stall(a).length === 0 && a.q.t44);
  assert.deepEqual(stall(run(false, 355, false)), ['stall_nudge']);
  const n = run(true, 355, false);
  assert.ok(stall(n).length === 0 && n.b.x === 250 << 16 && n.b.y === 40 << 16);
});
