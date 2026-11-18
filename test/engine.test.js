import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Match, loadData, BIT } from '../server/engine/index.js';
import { initSpecial, stepSpecial } from '../server/engine/special.js';

const data = loadData();

/** 시작 연출(입장·심판·점프볼)을 건너뛰어 자유 플레이 상태까지 진행 */
function toLive(m) {
  let n = 0;
  while ((m.phase !== 'play' || m.tip.on) && n++ < 2000) m.tick([0, 0]);
  assert.ok(m.phase === 'play' && !m.tip.on);
}

function run(seed, frames, scripted) {
  const m = new Match({ seed, teams: [0, 1], data, humans: scripted ? [true, true] : [false, false] });
  const h = createHash('sha1');
  let x = 12345;
  for (let i = 0; i < frames && !(m.phase === 'end'); i++) {
    let a = 0, b = 0;
    if (scripted) { // 고정 의사난수 입력(방향·A·B·C 전부 사용)
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      a = (x >>> 8) & 127; b = (x >>> 16) & 127;
    }
    m.tick([a, b]);
    h.update(JSON.stringify(m.snapshot()));
  }
  return { digest: h.digest('hex'), m };
}

test('엔진 결정성: 같은 시드·입력이면 같은 결과', () => {
  const r1 = run(777, 4000, true), r2 = run(777, 4000, true), r3 = run(778, 4000, true);
  assert.equal(r1.digest, r2.digest);
  assert.notEqual(r1.digest, r3.digest);
});

test('AI 대 AI 한 판이 끝까지 진행되어 승패가 난다', () => {
  const m = new Match({ seed: 1, teams: [4, 23], data, humans: [false, false] });
  let n = 0;
  while (m.phase !== 'end' && n++ < 60000) m.tick([0, 0]);
  assert.equal(m.phase, 'end');
  assert.ok(m.result.winner === 0 || m.result.winner === 1, JSON.stringify(m.result));
  assert.ok(['annihilation', 'timeup', 'sudden_death'].includes(m.result.reason));
  const evs = m.drainEvents().map((e) => e.k);
  assert.ok(evs.includes('throw') && evs.includes('hit'), '투구·피격이 발생해야 한다');
});

test('court.json 히트박스 수치가 모두 유한 숫자다 (CSV 헤더 파싱 회귀)', () => {
  assert.ok(data.court.hitboxes.length >= 17);
  for (const hb of data.court.hitboxes) {
    for (const k of ['xoff', 'w', 'yoff', 'h']) assert.ok(Number.isFinite(hb[k]), `idx ${hb.idx}.${k}=${hb[k]}`);
  }
});

test('아웃: hp==0 직후엔 rem·slot 불변, DOWN 종료 시 rem 감소·슬롯 교환', () => {
  const m = new Match({ seed: 1, teams: [4, 23], data, humans: [false, false] });
  const q = m.players[0], o = m.players.find((p) => p.seat === 0 && p.role === 'out');
  const qs = q.slot, os = o.slot;
  toLive(m);
  q.hp = 1; m.ball.power = 99; m.hitPlayer(q);
  assert.equal(q.hp, 0);
  assert.equal(m.sides[0].remaining, 7); assert.equal(q.slot, qs);
  for (let i = 0; i < 400 && !q.dead; i++) m.tick([0, 0]);
  assert.ok(q.dead);
  assert.equal(m.sides[0].remaining, 6); assert.equal(q.slot, os); assert.equal(o.slot, qs);
  assert.equal(m.snapshot().p[o.pid][5], qs);
  // 아웃된 선수는 외야 슬롯으로 걸어간 뒤 보통 외야 선수로 계속 뛴다(원작 타입 0x4C -> 슬롯 타입, ROM 0x986E)
  for (let i = 0; i < 300 && q.st === 12; i++) m.tick([0, 0]);
  assert.ok(q.st !== 12 && q.st !== 13 && m.usable(q) && q.role === 'out');
});

// ---- 필살기 ----
function jumpThrow(heldFrames, { slot } = {}) {
  const m = new Match({ seed: 5, teams: [0, 1], data, humans: [true, true] });
  toLive(m);
  const p = m.players[0];
  if (slot !== undefined) p.slot = slot;
  m.giveBall(p); m.sides[0].ctrl = 0;
  m.tick([BIT.C, 0]); // 점프
  m.tick([BIT.B, 0]); // 공중에서 B 차지 시작
  for (let i = 1; i < heldFrames; i++) m.tick([BIT.B, 0]);
  m.tick([0, 0]); // 해제 -> 투구 동작 10프레임 뒤 발사(원작 0x7194)
  const ev = m.drainEvents();
  for (let i = 0; i < 12 && !ev.some((e) => e.k === 'throw'); i++) { m.tick([0, 0]); ev.push(...m.drainEvents()); }
  return { m, ev };
}

test('필살기 발동: 공중 B 13~15프레임 홀드 후 해제에서만 (12·지상은 일반)', () => {
  for (const n of [13, 15]) {
    const { m, ev } = jumpThrow(n);
    const sp = ev.find((e) => e.k === 'special');
    assert.ok(sp, `${n}f 필살기`);
    assert.equal(m.ball.kind, sp.id + 1);
    assert.equal(sp.id, data.specials.row[0][0]); // 팀0 선수0 = 22
    assert.equal(m.ball.power, data.specials.power[sp.id]);
  }
  const low = jumpThrow(12);
  assert.ok(low.ev.some((e) => e.k === 'throw') && !low.ev.some((e) => e.k === 'special'));
  assert.equal(low.m.ball.kind, 0);
  // 지상 투구: 같은 홀드(14f)여도 일반
  const m = new Match({ seed: 5, teams: [0, 1], data, humans: [true, true] });
  toLive(m);
  m.giveBall(m.players[0]); m.sides[0].ctrl = 0;
  m.tick([BIT.B, 0]); for (let i = 1; i < 14; i++) m.tick([BIT.B, 0]); m.tick([0, 0]);
  assert.ok(m.drainEvents().some((e) => e.k === 'throw'));
  assert.equal(m.ball.kind, 0);
  // 외야 슬롯은 불가
  assert.equal(jumpThrow(14, { slot: 4 }).m.ball.kind, 0);
});

test('필살기 궤적: 결정적으로 진행하고 벽/바닥에 닿으면 바운스 공으로 종료', () => {
  const trace = () => {
    const m = new Match({ seed: 9, teams: [0, 1], data, humans: [false, false], forceSpecial: 12 }); // 정지-이동 반복
    toLive(m);
    const p = m.players[0];
    m.giveBall(p); p.x = 100 << 16; p.y = 128 << 16;
    m.doThrow(p, 10);
    const b = m.ball, xs = [];
    assert.equal(b.kind, 13);
    let n = 0;
    while (b.kind && n++ < 600) { m.stepBall(); xs.push(b.x); assert.ok(Number.isFinite(b.x + b.y + b.z)); }
    return { xs, mode: b.mode, kind: b.kind };
  };
  const a = trace(), c = trace();
  assert.deepEqual(a.xs, c.xs);
  assert.equal(a.kind, 0);
  assert.ok(a.xs.length > 8 && a.xs.length < 600);
});

test('필살기 erratic: 4f V0 후 rnd bit3 로 V0/4 구간 전환', () => {
  const V = 8 << 16, b = { x: 0, y: 0, z: 0, vx: V, vy: 0, vz: 0 }, s = initSpecial(b, 6);
  let calls = 0; const rnd = () => { calls++; return 8; };
  const vs = [];
  for (let i = 0; i < 5; i++) { stepSpecial(b, s, rnd, data.rules.special); vs.push(b.vx); }
  assert.deepEqual(vs, [V, V, V, V, V / 4]);
  assert.equal(calls, 1);
});

// ---- 경기 시작 연출 ----
test('시작 연출: 입장 중 입력 잠금 -> GO 에서 해제, 토스 전 C=점프볼 포기', () => {
  const m = new Match({ seed: 3, teams: [0, 1], data, humans: [true, true] });
  let goF = 0, lockedMoved = false;
  const x0 = m.players[0].x;
  while (!goF && m.f < 1000) {
    m.tick([BIT.RIGHT | BIT.C, 0]); // 잠금 중 입력은 무시되어야 한다
    const sn = m.snapshot();
    if (sn.ph === 'ready') { assert.equal(sn.lock, 1); if (m.sq.s >= 1 && m.players[0].st !== 0) lockedMoved = true; }
    if (sn.ev.some((e) => e.k === 'go')) goF = m.f;
  }
  assert.equal(goF, m.readyFrames);
  assert.ok(!lockedMoved && x0 !== m.players[0].x);
  assert.deepEqual(m.players.map((p) => p.x / 65536 | 0), m.players.map((p) => Math.floor(m.slotPos(p.seat, p.slot)[0])));
  const sn = m.snapshot();
  assert.equal(sn.lock, 0); assert.equal(sn.ph, 'play'); assert.equal(sn.ban[0], 'go');
  assert.equal(sn.cam, 96); assert.deepEqual(sn.tip, [0, 0, 0]);
  // GO 후 토스 전 C: 헛점프 -> 이 좌석 점프볼 포기, 토스는 30~61f 사이
  m.tick([BIT.C, 0]);
  assert.deepEqual(m.snapshot().tip, [0, 1, 0]);
  let tossF = 0;
  while (!tossF && m.f < goF + 200) { m.tick([BIT.C, 0]); if (m.snapshot().ev.some((e) => e.k === 'toss')) tossF = m.f; }
  assert.ok(tossF - goF >= 30 && tossF - goF <= 62, 'toss at +' + (tossF - goF));
});

test('점프볼: 사람은 C 점프 + 점프 중 B 로 쳐내면 자기 진영 쪽으로, 포기하면 성공 불가 (결정적)', () => {
  const play = (forfeit) => {
    const m = new Match({ seed: 4, teams: [0, 1], data, humans: [true, false] });
    const p = m.players[0], b = m.ball, hits = [];
    let n = 0, jumped = false;
    while (n++ < 3000 && m.f < 1500) {
      let bits = 0;
      if (m.phase === 'play' && forfeit && !m.tip.tossed) bits = BIT.C; // 토스 전 점프 = 포기
      else if (m.tip.tossed && m.tip.on) {
        if (p.st === 0 && b.vz < 0.5 * 65536 && !jumped) { bits = BIT.C; jumped = true; }
        else if (p.st === 1 && p.vz < 0.5 * 65536) bits = BIT.B;
      }
      m.tick([bits, 0]);
      for (const e of m.drainEvents()) if (e.k === 'tip_hit') hits.push(e);
      if (!m.tip.on && m.phase === 'play' && m.tip.tossed) break;
    }
    return { m, hits };
  };
  const a = play(false), a2 = play(false);
  assert.deepEqual(a.hits, a2.hits); // 결정적
  assert.ok(a.hits.length === 1, JSON.stringify(a.hits));
  const hit = a.hits[0];
  assert.ok(Math.sign(a.m.ball.vx) === (hit.seat === 0 ? -1 : 1), 'ball goes to hitter side');
  const f = play(true);
  assert.ok(f.m.tip.fg[0]);
  assert.ok(!f.hits.some((e) => e.seat === 0), '포기한 좌석은 쳐낼 수 없다');
});

test('아웃(HP 0) 순간 ref_out 이벤트, 종료 시 GAME SET 배너는 60f 뒤 180f', () => {
  const m = new Match({ seed: 1, teams: [4, 23], data, humans: [false, false] });
  toLive(m);
  for (let i = 0; i < 80; i++) m.tick([0, 0]); // 심판 관전 상태까지
  const q = m.players[0]; q.hp = 1; m.ball.power = 99; m.hitPlayer(q);
  assert.ok(m.drainEvents().some((e) => e.k === 'ref_out' && e.p === 0));
  assert.equal(m.snapshot().ref[2], 8);
  m.forceEnd(0, 'annihilation');
  assert.equal(m.endHold, 240);
  for (let i = 0; i < 59; i++) m.tick([0, 0]);
  assert.equal(m.snapshot().ban?.[0] === 'game_set', false);
  m.tick([0, 0]); m.tick([0, 0]);
  const sn = m.snapshot();
  assert.equal(sn.ban[0], 'game_set'); assert.equal(sn.ref[2], 12);
});

test('승패 확정 후에는 아웃·피격으로 인원(rem)이 변하지 않는다', () => {
  const m = new Match({ seed: 1, teams: [4, 23], data, humans: [false, false] });
  toLive(m);
  const q = m.players[0]; q.hp = 1; m.ball.power = 99; m.hitPlayer(q); // HP 0, 아웃 처리 대기 중
  m.forceEnd(0, 'timeup');
  const rem = [...m.result.rem];
  for (let i = 0; i < 400; i++) m.tick([0, 0]);
  assert.deepEqual([m.sides[0].remaining, m.sides[1].remaining], rem);
});

test('바운스: bounceShift 3 스테이지에서도 떨어진 공은 일정 프레임 안에 정지한다', () => {
  const st = data.stages.find((s) => s.bounceShift === 3).id;
  const m = new Match({ seed: 5, teams: [0, 1], data, humans: [false, false], stage: st });
  toLive(m);
  Object.assign(m.ball, { mode: 3, holder: -1, x: 256 * 65536, y: 128 * 65536, z: 600000, vx: 0, vy: 0, vz: -150000, still: 0 });
  for (const q of m.players) { q.st = 11; q.tm = 99999; q.vx = q.vy = 0; } // 바운스 물리만 본다: 선수가 튀는 공을 캐치 자세로 잡아채지 않게 전원 쓰러뜨린다
  let n = 0;
  while (n++ < 1500 && !(m.ball.z === 0 && m.ball.vz === 0)) m.tick([0, 0]);
  assert.equal(m.ball.z === 0 && m.ball.vz === 0, true, 'shift 3 공이 정지하지 않음');
});

// ---- 조작 선수 전환(외야) / 줍기 ----
function looseAt(m, x, y) {
  for (const o of m.players) o.hasBall = false;
  const b = m.ball;
  b.mode = 3; b.holder = -1; b.x = x * 65536; b.y = y * 65536; b.z = 0; b.vx = b.vy = b.vz = 0; b.still = 0;
}

test('외야 구역에 멈춘 공 -> 해당 외야 선수로 조작 전환, 공은 코트 안으로 옮기지 않음, A 로 줍기', () => {
  const m = new Match({ seed: 5, teams: [0, 1], data, humans: [true, false] });
  toLive(m);
  assert.equal(m.R.ctrlSwitch.rom, true);
  looseAt(m, 300, 25); // 좌석0 외야 상단 구역, 외야 선수(352,24)의 캐치 상자(24x24) 밖
  m.settleBall = m.settleBall.bind(m);
  let sw = -1;
  for (let i = 1; i <= 40; i++) { m.tick([0, 0]); if (sw < 0 && m.players[m.sides[0].ctrl].role === 'out') sw = i; }
  assert.equal(sw, 31); // 정지 후 30프레임 주기 전환 [ROM 0xA60E/0x85CC, 하니스 ctrl_stop_out_back]
  const c = m.players[m.sides[0].ctrl];
  assert.equal(c.role, 'out');
  assert.equal(c.slot >= 4 && c.slot < 7, true);
  assert.ok(Math.abs(m.ball.y / 65536 - 25) < 1 && Math.abs(m.ball.x / 65536 - 300) < 1, '공이 외야에 그대로');
  // 사람 조작 외야 선수는 자동 습득하지 않고 A 로 줍는다
  assert.equal(m.ball.mode, 3);
  c.x = m.ball.x; c.y = m.ball.y; c.vx = c.vy = 0;
  for (let i = 0; i < 4; i++) m.tick([BIT.A, 0]);
  for (let i = 0; i < 30; i++) m.tick([0, 0]);
  assert.equal(c.hasBall, true);
});

test('외야 선수 발밑에 멈춘 공은 그 선수가 곧바로 잡는다(컴퓨터형 외야의 캐치 상자, ROM 0x9D8A)', () => {
  const m = new Match({ seed: 5, teams: [0, 1], data, humans: [true, false] });
  toLive(m);
  const o = m.players.find((p) => p.seat === 0 && p.slot === 4);
  looseAt(m, o.x / 65536 - 2, 25);
  let got = -1;
  for (let i = 1; i <= 10 && got < 0; i++) { m.tick([0, 0]); if (m.ball.holder === o.pid) got = i; }
  assert.equal(got, 2); // 하니스 ctrl_stop_out_top: 원작 f2 에 보유
});

test('외야로 튀어 가는 공: 굴러가는 동안에는 조작 전환이 없고, 그 구역 외야 선수가 캐치 자세로 받아낸다 (원작 직역)', () => {
  const m = new Match({ seed: 5, teams: [0, 1], data, humans: [true, false] });
  toLive(m);
  looseAt(m, 350, 60);
  m.ball.z = 30 * 65536; m.ball.vy = -2 * 65536; // 위쪽 외야 구역(y<=32)으로 튀어 간다(원작 바운스: 바닥에 닿을 때마다 수평 속도 절반, 지면 마찰 굴림 없음)
  m.settleBall = m.settleBall.bind(m);
  for (let i = 0; i < 3; i++) m.tick([0, 0]);
  assert.ok(m.ball.vy !== 0 && m.ball.y / 65536 > 40, '아직 굴러가는 중');
  assert.equal(m.players[m.sides[0].ctrl].role, 'in'); // 선행 전환(자작)은 원작에 없다
  for (let i = 0; i < 40; i++) m.tick([0, 0]);
  const c = m.players[m.sides[0].ctrl];
  assert.equal(c.role, 'out');
  assert.equal(c.slot >= 4 && c.slot < 7, true);
  assert.equal(c.hasBall, true); // 지나가는 공을 받아 보유 -> 조작 선수가 된다
});

test('컴퓨터 활성 내야는 자기 구역 공을 걷기 속력으로 가지러 가 줍는다: 대시 없음 (원작 plan 0x28, 속력 0x9E32 = (s2*16+0x140-마찰>>7)/256 px/f)', () => {
  const m = new Match({ seed: 5, teams: [0, 1], data, humans: [false, false], cpuLevels: [2, null] });
  toLive(m);
  looseAt(m, 200, 200); // 좌석0 내야에 멈춘 공
  let dashed = false, maxV = 0, n = 0, walk = -9;
  for (; n < 200 && m.ball.mode === 3; n++) {
    m.tick([0, 0]);
    for (const e of m.drainEvents()) if (e.k === 'dash' && m.players[e.p].seat === 0) dashed = true;
    const c = m.players[m.sides[0].ctrl];
    if (c.cb?.plan === 0x28 && !c.cb.pf) { const v = Math.hypot(c.vx, c.vy) / 65536; maxV = Math.max(maxV, v); walk = Math.max(walk, v - ((c.stat.spd << 4) + 0x140 - (m.stage.friction >> 7)) / 256); } // walk = 걷기 속력 초과분의 최댓값
  }
  assert.equal(dashed, false);
  assert.notEqual(m.ball.mode, 3, '공을 줍지 못함');
  assert.equal(m.players[m.ball.holder].seat, 0);
  assert.ok(maxV > 0 && walk <= 0.01, `추격 속력 ${maxV} (걷기 속력 초과 ${walk})`);
});

test('외야 CPU: 자기 구역에 멈춘 공은 30프레임 뒤 활성 선수로 뽑혀 달려가 줍는다(난이도 무관, 원작 직역)', () => {
  const pick = (lv) => {
    const m = new Match({ seed: 5, teams: [0, 1], data, humans: [false, false], cpuLevels: [null, lv] });
    toLive(m);
    const o = m.players[11]; // 좌석1 외야 상단(y 24)
    for (const q of m.players) if (q.seat === 0 || (q.seat === 1 && q.role === 'in')) { q.st = 11; q.tm = 99999; q.vx = q.vy = 0; } // 상대 팀과 자기 내야는 쓰러뜨려 간섭 제거
    looseAt(m, o.x / 65536 + 60, 24); // 같은 띠 60px 옆(캐치 상자 밖)
    let t = -1;
    for (let i = 1; i <= 150 && t < 0; i++) { m.tick([0, 0]); if (m.ball.mode !== 3) t = i; }
    return m.ball.holder === 11 ? t : -1;
  };
  const a = pick(2), b = pick(null);
  assert.ok(a > 31 && a <= 80, '전환(31f) + 이동 + 줍기 15f: ' + a);
  assert.equal(b, a);
});

test('포메이션: 4명 남아 전원 내야 슬롯이어도 패스 순환이 끊기지 않는다(no_receiver 회귀)', () => {
  const m = new Match({ seed: 5, teams: [0, 0], data, humans: [true, true] });
  toLive(m);
  for (const p of m.players) if (p.seat === 1) p.hp = 99999;
  const infs = m.players.filter((p) => p.seat === 0 && p.role === 'in');
  for (let i = 0; i < 3; i++) { infs[i].st = 0; m.startOut(infs[i]); }
  for (let i = 0; i < 120; i++) m.tick([0, 0]);
  const alive = m.players.filter((p) => p.seat === 0 && !p.dead);
  assert.equal(alive.length, 4);
  for (const p of alive) { p.st = 0; p.z = 0; p.vz = 0; }
  m.giveBall(alive[0]); m.sides[0].ctrl = alive[0].pid;
  let cancel = null, passes = 0;
  for (let i = 0; i < 900 && !cancel; i++) {
    m.tick([i === 2 ? BIT.S : 0, 0]);
    for (const e of m.drainEvents()) { if (e.k === 'fm_cancel') cancel = e.why; if (e.k === 'pass' && e.fm) passes++; }
    if (passes >= 3) break;
  }
  assert.equal(cancel, null);
  assert.ok(passes >= 3);
});

// ---- 포메이션 어택 (analysis/14, docs/PROTOCOL.md 5.6) ----
function fmMatch() {
  const m = new Match({ seed: 5, teams: [1, 0], data, humans: [true, true] });
  toLive(m);
  for (const p of m.players) if (p.seat === 1) p.hp = 99999; // 엔드 어택으로 경기가 끝나지 않게
  return m;
}
/** 좌석0 선수0 이 지상에서 공을 들게 한 뒤 Start 한 번. B 를 계속 눌러 첫 수신에서 엔드 어택 */
function fmRun(m, evs) {
  const p0 = m.players[0];
  for (const p of m.players) { if (p.seat === 0 && !p.dead) { p.st = 0; p.z = 0; p.vz = 0; p.hp = 85; } }
  m.giveBall(p0);
  m.tick([BIT.S, 0]);
  for (let i = 0; i < 1500 && (m.fm || i < 1); i++) { m.tick([BIT.B, 0]); evs.push(...m.drainEvents()); }
}

test('포메이션 어택: 발동 -> 집합 -> 대기(시계 정지) -> 자동 패스 -> 엔드 어택(위력 s4x4, 필살기 아님)', () => {
  const m = fmMatch(), evs = [], clk0 = m.clock;
  const p0 = m.players[0];
  m.giveBall(p0);
  m.tick([BIT.S, 0]);
  assert.equal(m.fm?.st, 0, '발동 즉시 집합 단계');
  assert.equal(m.sides[0].fmLeft, 2);
  const seen = new Set();
  for (let i = 0; i < 1500 && m.fm; i++) { m.tick([BIT.B, 0]); seen.add(m.fm?.st); evs.push(...m.drainEvents()); if (m.fm && m.fm.st <= 1) assert.equal(m.clock, clk0 + 1, '집합·대기 중 시계 정지'); }
  const k = evs.map((e) => e.k);
  for (const x of ['fm_start', 'fm_ready', 'pass', 'receive', 'fm_end', 'throw']) assert.ok(k.includes(x), x);
  assert.ok(seen.has(1) && seen.has(2) && seen.has(3));
  const end = evs.find((e) => e.k === 'fm_end'), th = evs.find((e) => e.k === 'throw' && e.fm);
  const thrower = m.players[end.p];
  assert.equal(end.pw, thrower.stat.pow * 4);
  assert.equal(th.pw, end.pw);
  assert.ok(!evs.some((e) => e.k === 'special'));
  assert.equal(m.ball.kind, 0);
  const snap = m.snapshot();
  assert.deepEqual(snap.fmLeft, [2, 3]);
  assert.equal(snap.fm, null);
});

test('포메이션 어택: 사이드당 3회 제한, enabled=false 면 발동 안 함', () => {
  const m = fmMatch();
  for (let n = 0; n < 3; n++) { const evs = []; fmRun(m, evs); assert.ok(evs.some((e) => e.k === 'fm_end'), `회차 ${n + 1}`); }
  assert.equal(m.sides[0].fmLeft, 0);
  m.giveBall(m.players[0]);
  m.tick([BIT.S, 0]);
  assert.equal(m.fm, null, '4회째는 발동 불가');
  const off = new Match({ seed: 5, teams: [1, 0], data: { ...data, rules: { ...data.rules, formation: { ...data.rules.formation, enabled: false } } }, humans: [true, true] });
  assert.deepEqual(off.snapshot().fmLeft, [0, 0]);
});

test('입력 상위 비트(S·0xFF00)는 포메이션이 꺼진 경기의 이동·행동에 영향 없다', () => {
  const off = { ...data, rules: { ...data.rules, formation: { ...data.rules.formation, enabled: false } } };
  const go = (extra) => {
    const m = new Match({ seed: 9, teams: [0, 1], data: off, humans: [true, true] });
    const h = createHash('sha1');
    let x = 4321;
    for (let i = 0; i < 1500 && m.phase !== 'end'; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      m.tick([((x >>> 8) & 127) | extra, ((x >>> 16) & 127) | extra]);
      h.update(JSON.stringify(m.snapshot()));
    }
    return h.digest('hex');
  };
  assert.equal(go(0), go(0xFF80));
});

test('포메이션 진행 중 경기가 끝나면 fm_cancel(end) 로 정리된다', () => {
  const m = fmMatch();
  m.giveBall(m.players[0]);
  m.tick([BIT.S, 0]);
  assert.ok(m.fm);
  m.drainEvents();
  m.finish(0, 'time');
  assert.equal(m.fm, null);
  assert.ok(m.drainEvents().some((e) => e.k === 'fm_cancel' && e.why === 'end'));
});

// ---- 정지 공 소프트락 (사이드라인 사각지대, 2026-11-17) ----
test('사각지대 재현: 사이드라인 바로 안쪽 (446,125)·(66,125)에 정지한 공을 CPU 가 일정 프레임 안에 줍는다', () => {
  for (const [x, y] of [[446, 125], [66, 125], [450, 40], [62, 224]]) {
    const m = new Match({ seed: 5, teams: [0, 1], data, humans: [false, false], cpuLevels: [1, 1] });
    toLive(m);
    looseAt(m, x, y);
    let n = 0;
    while (n++ < 400 && m.ball.mode === 3) m.tick([0, 0]);
    assert.notEqual(m.ball.mode, 3, `(${x},${y}) 정지 공이 400f 안에 주워지지 않음`);
  }
});

test('방치된 정지 공: 300프레임 카운터를 넘으면(정지 후 312프레임째) 가장 가까운 선수가 강제 회수로 달려가 줍는다 (원작 0xA636 -> 0x86A6, 타입 0x44)', () => {
  const m = new Match({ seed: 5, teams: [0, 1], data, humans: [true, true] }); // 사람 둘 + 입력 0: 스스로 줍는 선수가 없다
  toLive(m);
  looseAt(m, 200, 128); // 좌석0 내야 한가운데
  let n = 0, t44 = -1;
  const evs = [];
  while (n++ < 420 && m.ball.mode === 3) {
    m.tick([0, 0]);
    evs.push(...m.drainEvents().map((e) => e.k));
    if (t44 < 0 && m.players.some((p) => p.t44)) t44 = m.ball.still;
  }
  assert.equal(t44, 313); // still 1 = 멈춘 프레임, 서브4 의 312번째 프레임에 발동
  assert.notEqual(m.ball.mode, 3, '강제 회수 선수가 공을 줍지 못함');
  assert.equal(m.players[m.ball.holder].seat, 0);
  assert.ok(!evs.includes('stall_nudge') && !evs.includes('stall_give')); // 자작 안전망은 쓰지 않는다
});

test('상대 패스 공: 서 있는 선수에게 닿으면 피격(위력 3), 캐치 자세는 공을 마주 보면 가로채고 등지면 피격 (원작 0x847C / 0x7392 -> 0x8416)', () => {
  // 좌석0 내야(0번)가 상대 코트 위쪽의 자기 편 상단 외야(4번)에게 짧은 패스(낮은 포물선). qpos = 길목에 세울 좌석1 내야(7번) 위치
  const run = (qpos, stance, face) => {
    const m = new Match({ seed: 5, teams: [0, 1], data, humans: [true, true] });
    toLive(m);
    const a = m.players[0], t = m.players[4], q = m.players[7];
    for (const p of m.players) { p.st = 11; p.tm = 99999; p.vx = p.vy = 0; } // 다른 선수 간섭 제거(아웃 이동 상태로 고정)
    a.x = 250 * 65536; a.y = 70 * 65536; a.st = 0; t.x = 290 * 65536; t.st = 0;
    if (qpos) { q.x = qpos[0]; q.y = qpos[1]; q.st = 0; q.face = face; q.back = false; q.hb = q.hbC = 1; }
    m.sides[0].ctrl = 0; m.sides[1].ctrl = 7;
    m.giveBall(a);
    Object.assign(m.ball, { x: 256 * 65536, y: 70 * 65536, z: 20 * 65536 });
    m.romPass(a, t); m.drainEvents();
    const hp0 = q.hp, path = [];
    for (let i = 0; i < 40; i++) {
      m.tick([0, stance && i === 0 ? BIT.B : 0]);
      path.push([m.ball.x, m.ball.y]);
      if (qpos && i === 0) assert.deepEqual([q.x, q.y], qpos, '7번이 이동 허용영역 밖');
      for (const e of m.drainEvents()) {
        if (e.k === 'hit' && e.p === 7) return { r: 'hit', dmg: hp0 - q.hp };
        if (e.k === 'receive') return { r: e.p === 7 ? 'steal' : 'recv' + e.p, path };
      }
    }
    return { r: 'none' };
  };
  const dry = run(null);
  assert.equal(dry.r, 'recv4'); // 방해가 없으면 수신 대기(타입 0x30) 선수가 받는다
  const at = dry.path[3].map((v) => Math.floor(v / 65536) * 65536); // 패스 4프레임째 공 위치(좌석1 내야 안)
  const stand = run(at, false, -1);
  assert.equal(stand.r, 'hit');
  assert.equal(stand.dmg, Math.max(0, 3 - data.teams[1].players[0].def));
  assert.equal(run(at, true, -1).r, 'steal'); // 공은 +x 로 날아온다: 왼쪽을 보고 있으면(공을 마주 봄) 가로채기
  assert.equal(run(at, true, 1).r, 'hit'); // 오른쪽을 보고 있으면(등을 돌림) 피격
});

test('CPU 방어(analysis/18): 사람 슛에 대해 레벨2 CPU 가 캐치를 시도하고 성공한다(원작 방어표 b9..b12)', async () => {
  const { measure } = await import('../tools/cpu_catch.mjs');
  const r = measure({ level: 2, n: 40, charge: 8 });
  assert.ok(r.tryCatch / r.n >= 0.3, `캐치 시도율 ${r.tryCatch}/${r.n}`);
  assert.ok(r.catchOk >= 3, `캐치 성공 ${r.catchOk}/${r.n}`);
});

// ---- 조작감·줍기 원작 직역 (analysis/21_game_feel.md) ----
test('원작 조작감: 걷기는 첫 프레임 1.75px/f·즉시 정지, 지상 투구는 B 뒤 10프레임에 발사(차지 없음, 위력 s4)', () => {
  const m = new Match({ seed: 5, teams: [0, 1], data, humans: [true, false] });
  toLive(m);
  const p = m.players[0];
  p.x = 200 * 65536; p.y = 128 * 65536; p.vx = p.vy = 0; p.st = 0; m.sides[0].ctrl = 0;
  m.tick([BIT.LEFT, 0]);
  assert.equal(p.vx, -1.75 * 65536); // 1.0 + s2(16)/16 - 2*마찰(0.125) [ROM 0x8272]
  m.sides[0].ctrl = 0; m.tick([0, 0]);
  assert.equal(p.vx, 0);
  m.giveBall(p); m.drainEvents();
  let at = -1;
  for (let i = 1; i <= 14 && at < 0; i++) { m.sides[0].ctrl = 0; m.tick([BIT.B, 0]); if (m.drainEvents().some((e) => e.k === 'throw')) at = i; }
  assert.equal(at, 11); // B 프레임 + 10프레임 [ROM 0x7194, 하니스 throw_ground_hold]
  assert.equal(m.ball.power, p.stat.pow);
});

test('원작 줍기: 정지 공은 A·B 한 번(1프레임)으로 15프레임 뒤 습득(|dx|<=22), 튀는 공은 B 캐치 자세로 잡는다', () => {
  const run = (key, dx, z) => {
    const m = new Match({ seed: 5, teams: [0, 1], data, humans: [true, false] });
    toLive(m);
    const p = m.players[0];
    p.x = 200 * 65536; p.y = 128 * 65536; p.vx = p.vy = 0; p.st = 0; m.sides[0].ctrl = 0;
    looseAt(m, 200 + dx, 128); m.ball.z = z * 65536; if (!z) m.ball.still = 2; // 정지 플래그($C71E)는 멈춘 다음 프레임에 선다
    for (const q of m.players) if (q !== p) { q.st = 11; q.tm = 99999; q.vx = q.vy = 0; } // 다른 선수 간섭 제거
    for (let i = 0; i < 30; i++) { m.sides[0].ctrl = 0; m.tick([i === 0 ? key : 0, 0]); if (m.ball.holder === 0) return i; }
    return -1;
  };
  assert.equal(run(BIT.A, 22, 0), 15);
  assert.equal(run(BIT.B, 22, 0), 15);
  assert.equal(run(BIT.A, 23, 0), -1);
  assert.ok(run(BIT.B, 8, 20) >= 0, '튀는 공 B');
  assert.equal(run(BIT.A, 8, 20), -1); // 튀는 공에 A 는 웅크림(회피)
});

test('스냅샷 선수 배열은 길이 11: [9]=입장 보행, [10]=포메이션 집합 이동 (render.js 가 인덱스로 읽는다)', () => {
  const m = new Match({ seed: 3, teams: [0, 1], data, humans: [true, true] });
  m.tick([0, 0]);
  const sn = m.snapshot();
  assert.ok(sn.p.every((s) => s.length === 11));
  assert.equal(sn.p[0][9], 1); // 입장 행진 중
  toLive(m);
  assert.equal(m.snapshot().p[0][9], 0);
});

test('입장 방향(원작 0x9962/0x9996): 위로 걸으면 뒷모습, 도착하면 y>=128 은 뒷모습·x>=256 은 왼쪽 / 컴퓨터 공격 plan: 공을 잡으면 원작 plan 으로 던진다', () => {
  const m = new Match({ seed: 3, teams: [0, 1], data, humans: [true, false] });
  let sawUp = false;
  while (m.sq.s === 0 && m.f < 400) {
    m.tick([0, 0]);
    for (const p of m.players) if (p.en && p.en.ty < p.en.ey - 1) { sawUp = true; assert.equal(p.back, true); } // 목표가 위쪽이면 걷는 동안 뒷모습
  }
  assert.ok(sawUp);
  for (const p of m.players) { const [sx, sy] = m.slotPos(p.seat, p.slot); assert.equal(p.back, sy >= 128); assert.equal(p.face, sx >= 256 ? -1 : 1); }
  // 사람이 가만히 있어도 컴퓨터(좌석 1)는 공을 줍고 공격 plan 으로 투구·패스까지 간다(예외 없이 진행)
  let acted = false;
  for (let i = 0; i < 4000 && !acted; i++) { m.tick([0, 0]); for (const e of m.drainEvents()) if ((e.k === 'throw' || e.k === 'pass') && m.players[e.p].seat === 1) acted = true; }
  assert.ok(acted);
});

test('정검수 4차 High-1: 캐치 자세에 들어간 프레임에 강제 회수로 바뀐 외야가 공 위에서 멈추지 않는다 (0x9634 -> 0x77D4 는 패드 없는 직접 분기)', () => {
  // 재현 경기: 종전에는 f2340 부터 공이 (45.8,123.7)에 멈춘 채 경기가 끝나지 않았다
  const m = new Match({ seed: 777 + 169 * 31, teams: [19, 14], data, humans: [false, false], cpuLevels: [2, 2], stage: data.stages[169 % data.stages.length].id });
  let worst = 0;
  const evs = new Set();
  while (m.phase !== 'end' && m.f < 4000) { m.tick([0, 0]); for (const e of m.drainEvents()) evs.add(e.k); if (m.ball.still > worst) worst = m.ball.still; }
  assert.ok(worst < 400, `공이 ${worst}프레임 멈춰 있었다`);
  assert.ok(!evs.has('stall_t44') && !evs.has('stall_give') && !evs.has('stall_nudge')); // 자작 안전망 없이 풀린다
});

test('정검수 4차 High-2: 사람이 조작하는 선수는 왼쪽만 눌러도 이동 허용영역 밖으로 걸어 나가지 않는다 (걷기 클램프 0x7F36)', () => {
  const m = new Match({ seed: 9000, teams: [0, 3], data, humans: [true, false], cpuLevels: [1, 1], stage: data.stages[0].id });
  let xmin = Infinity;
  for (let n = 0; n < 1400; n++) {
    m.tick([BIT.LEFT, 0]); m.drainEvents();
    const c = m.players[m.sides[0].ctrl];
    if (m.phase === 'play' && m.isHuman(c) && c.st === 0) xmin = Math.min(xmin, c.x / 65536);
  }
  assert.ok(xmin >= 16, `조작 선수 x 최소 ${xmin}`);
});

test('원작 난수 시드는 언제나 짝수: 홀수 시드로 시작해도 경기 내내 시드가 짝수다 (0x928 +2 / 0x14EA x41, analysis/25 §11)', () => {
  const m = new Match({ seed: 7001, teams: [1, 10], data, humans: [false, false], cpuLevels: [2, 2] });
  assert.equal(m.seed, 7001); // 기록용 값은 그대로
  for (let n = 0; n < 1500; n++) { m.tick([0, 0]); m.drainEvents(); assert.equal(m.rng.seed & 1, 0, `f${m.f} 시드 홀수`); }
});

test('경기별 제한 시간(Match 옵션 limitFrames): 지정한 프레임에 시간 종료, 0 = 무제한은 시간 종료가 없다', () => {
  const mk = (limitFrames) => { const m = new Match({ seed: 2, teams: [0, 1], data, humans: [true, true], limitFrames }); toLive(m); return m; };
  const timed = mk(600), free = mk(0);
  for (let i = 0; i < 700; i++) { timed.tick([0, 0]); free.tick([0, 0]); }
  assert.ok(timed.sudden || timed.result?.reason === 'timeup'); // 인원 동수면 서든데스, 아니면 시간 종료 승패
  assert.ok(!free.sudden && !free.result);
  assert.equal(free.snapshot().clk, 0);
  assert.equal(free.info().rules.limitFrames, 0);
  assert.equal(new Match({ seed: 2, teams: [0, 1], data }).limitFrames, data.rules.time.limitFrames); // 옵션 없으면 종전 값
});

// ---- 특훈: 캐치 (analysis/29 §1, §4-2) ----
/** 좌석 0 입력 봇: 상대 투구가 가까이 오면 B(캐치), 공을 들면 B(되던지기), 내 코트에 멈춘 공은 걸어가 A. cap = 그 단계에서 잡을 개수 상한 */
function trBot(m, cap) {
  const p = m.players[m.sides[0].ctrl], b = m.ball, t = m.tr, d = (v) => v / 65536;
  if (t.phase !== 'play') return 0;
  if (p.hasBall) return m.f % 4 < 2 ? BIT.B : 0;
  if (b.mode === 1 && m.players[b.thrower].seat === 1) return t.count < cap && Math.hypot(d(b.x - p.x), d(b.y - p.y)) < 44 ? BIT.B : 0;
  if (b.mode === 3 && b.z === 0 && b.vx === 0 && b.vy === 0 && d(b.x) < 256) {
    const dx = d(b.x - p.x), dy = d(b.y - p.y);
    if (Math.abs(dx) <= 16 && Math.abs(dy) <= 14) return m.f % 4 < 2 ? BIT.A : 0;
    return (dx > 8 ? BIT.RIGHT : dx < -8 ? BIT.LEFT : 0) | (dy > 8 ? BIT.DOWN : dy < -8 ? BIT.UP : 0);
  }
  if (p.pid === 0 && p.st === 0 && (p.face !== 1 || p.back) && b.mode === 0) return BIT.RIGHT;
  return 0;
}

test('특훈 캐치: 5개는 같은 단계 재시도, 6개는 다음 단계, 3단계 통과하면 완료(아웃 없음)', () => {
  const m = new Match({ seed: 2, teams: [0, 1], data, humans: [true, false], training: { kind: 'catch' } });
  assert.deepEqual([m.sides[0].team, m.sides[1].team, m.stageInfo.romStage], [22, 24, 13]);
  assert.deepEqual(m.snapshot(false).tr, { step: 0, count: 0, left: 10, phase: 'intro', msg: 5, retry: 0 });
  assert.equal(m.ball.holder, 7);
  const caps = [5, 6, 6, 10]; // 1단계 5개(불합격) -> 1단계 6개 -> 2단계 6개 -> 3단계 전부
  const log = [];
  let tries = 0;
  for (let i = 0; i < 40000 && m.phase !== 'end'; i++) {
    m.tick([trBot(m, caps[tries]), 0]);
    for (const e of m.drainEvents()) {
      if (e.k === 'tr_result') { log.push([e.step, e.count, e.pass]); tries++; }
      assert.notEqual(e.k, 'out');
    }
  }
  assert.deepEqual(log, [[0, 5, false], [0, 6, true], [1, 6, true], [2, 10, true]]);
  assert.deepEqual(m.result, { winner: 0, reason: 'training_clear', rem: [1, 1] });
  assert.equal(m.tr.phase, 'done');
});

// ---- 특훈: 필살 슛 (analysis/29 §1-5, §4-2-3) ----
/** 좌석 0 입력 봇: 공을 들면 필살 수가 cap 미만일 때 C 점프 -> B 홀드 -> 차지 13 에서 뗌(필살), 아니면 지상 B(일반 투구). 상대 되던지기는 B 로 잡고, 멈춘 공은 걸어가 A, 외야가 들면 B(선수 0 에게 패스) */
function spBot(m, cap, st) {
  const p = m.players[m.sides[0].ctrl], b = m.ball, t = m.tr, d = (v) => v / 65536;
  if (t.phase !== 'play') { st.jump = false; return 0; }
  if (p.hasBall) {
    if (p.pid !== 0) return m.f % 4 < 2 ? BIT.B : 0;
    if (p.wind) return 0;
    const air = p.z > 0 || p.vz !== 0;
    if (st.jump) {
      if (!air) { if (++st.n > 3) st.jump = false; return st.jump ? BIT.C : 0; }
      if (p.charging && p.charge >= 13) { st.jump = false; return 0; }
      return BIT.B;
    }
    if (!air && p.st === 0) {
      if (t.count < cap) { st.jump = true; st.n = 0; return BIT.C; }
      return m.f % 4 < 2 ? BIT.B : 0;
    }
    return 0;
  }
  st.jump = false;
  if (b.mode === 3 && b.z === 0 && b.vx === 0 && b.vy === 0 && d(b.x) < 256) {
    const dx = d(b.x - p.x), dy = d(b.y - p.y);
    if (Math.abs(dx) <= 16 && Math.abs(dy) <= 14) return m.f % 4 < 2 ? BIT.A : 0;
    return (dx > 8 ? BIT.RIGHT : dx < -8 ? BIT.LEFT : 0) | (dy > 8 ? BIT.DOWN : dy < -8 ? BIT.UP : 0);
  }
  if (b.mode === 1 && m.players[b.thrower].seat === 1 && Math.hypot(d(b.x - p.x), d(b.y - p.y)) < 44) return BIT.B;
  return 0;
}

test('특훈 필살: 20구 중 필살 9개는 재시도(말풍선 8), 10개는 완료. 상대는 필살에 맞고(아웃 없음) 되던지기는 내 HP 를 깎지 않는다', () => {
  const m = new Match({ seed: 2, teams: [0, 1], data, humans: [true, false], training: { kind: 'special' } });
  assert.deepEqual(m.snapshot(false).tr, { step: 0, count: 0, left: 20, phase: 'intro', msg: 6, retry: 0, ch: 0, chb: 0 });
  assert.equal(m.ball.holder, 0);
  const caps = [9, 10], log = [], st = {};
  let tries = 0, chMax = 0, retryMsg = 0;
  for (let i = 0; i < 30000 && m.phase !== 'end'; i++) {
    m.tick([spBot(m, caps[tries], st), 0]);
    chMax = Math.max(chMax, m.tr.ch);
    for (const e of m.drainEvents()) {
      if (e.k === 'tr_result') { log.push([e.count, e.grade, e.pass]); tries++; }
      if (e.k === 'tr_step') retryMsg = m.tr.msg;
      if (e.k === 'special') assert.deepEqual([e.p, e.id], [0, 22]);
      assert.notEqual(e.k, 'out');
    }
  }
  assert.deepEqual(log, [[9, 1, false], [10, 2, true]]);
  assert.equal(retryMsg, 8);
  assert.deepEqual(m.result, { winner: 0, reason: 'training_clear', rem: [1, 1] });
  assert.deepEqual([m.players[0].hp, m.players[7].hp], [112, 0]); // 상대 되던지기 위력 1/4 -> 데미지 0, 상대는 필살(위력 75)에 맞아 HP 0 이어도 계속
  assert.ok(chMax >= 13 && chMax <= 15); // 게이지가 필살 구간까지 올라갔다
});

test('받아치기 필살(원작 공 $76, ROM 0x8C08): 필살 슛을 잡고 받아치기 창 안에 지상 B 로 던지면 같은 ID 의 필살 슛, 창이 끝난 뒤·점프한 뒤는 일반 슛', () => {
  // 원작 실행 analysis/data/34_counter_special_oracle 과 같은 흐름: 좌석 0 선수 0 이 필살(ID 22, 위력 75)을 던지고 좌석 1 선수 0(자기 표 ID 28)이 B 캐치 자세로 잡는다
  const play = (delay, jump) => {
    const m = new Match({ seed: 2, teams: [0, 1], data, humans: [true, true], limitFrames: 0 });
    toLive(m);
    m.giveBall(m.players[0]); m.sides[0].ctrl = 0;
    const tk = (a, b) => { m.tick([a, b]); return m.drainEvents(); };
    tk(BIT.C, 0); for (let i = 0; i < 13; i++) tk(BIT.B, 0);
    let caught = null;
    for (let i = 0; i < 80 && !caught; i++) caught = tk(0, m.ball.sp && i >= 2 && ((i - 2) & 3) < 2 ? BIT.B : 0).find((e) => e.k === 'catch') ?? null;
    assert.ok(caught && caught.p === 7 && caught.kind === 23);
    for (let d = 0; d < 200; d++) {
      const pad = jump ? (d === delay ? BIT.C : d === delay + 6 ? BIT.B : 0) : d === delay || d === delay + 1 ? BIT.B : 0;
      const ev = tk(0, pad), t = ev.find((e) => e.k === 'throw');
      if (t) return { t, sp: ev.find((e) => e.k === 'special') ?? null, kind: m.ball.kind, spd: m.ball.spd8, c42: m.ball.c42 };
    }
    return null;
  };
  const a = play(45, false); // 밀림이 끝난 뒤, 창 안
  assert.deepEqual([a.sp?.p, a.sp?.id, a.kind, a.t.pw], [7, 22, 23, 75]); // 던진 선수의 표 ID(28, 위력 70)가 아니라 잡은 공의 ID·위력
  assert.equal(a.spd, 0x750); // 속력도 잡은 공 그대로(구속 88*16 + 공중 0x100 + 차지 13*16)
  const b = play(110, false); // 창(밀림 뒤 60프레임)이 끝난 뒤
  assert.deepEqual([b.sp, b.kind, b.t.pw], [null, 0, 30]);
  assert.deepEqual([a.c42, b.c42], [15, 0]); // 공 $42: 차지 13 으로 던진 필살을 받아친 공은 15 고정(0xA3E6), 창이 끝난 뒤 지상 투구는 0
  const c = play(45, true); // 창 안에 점프하면 창이 지워진다
  assert.deepEqual([c.sp, c.kind], [null, 0]);
});
