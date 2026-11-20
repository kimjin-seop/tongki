// 필살 추적(사람끼리 일반 멀티 경기 자동 적용, Match 옵션 evade='track', rules.special.track). 원작 경로(evade 없음/'rom')는 프레임 동일해야 한다
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Match, loadData, BIT } from '../server/engine/index.js';
import { BM, ST, ONE } from '../server/engine/consts.js';
import { RoomGame, isHumanVsHuman, evadeOf } from '../server/game/roomGame.js';

const data = loadData();

/** 좌석0 이 점프 투구(forceSpecial=id 로 필살)를 대상(좌석1 슬롯0)에게 던지고, 대상은 공이 떠난 뒤 12f 에 정책대로 막는다. 결과 + 공 경로 해시 */
function duel(i, pol, evade, id = 1, dist = 140) {
  const m = new Match({ seed: 2000 + 2 * i, teams: [i % 25, (i * 7 + 3) % 25], data, humans: [true, true], forceSpecial: id, ...(evade ? { evade } : {}) });
  let g = 0; while ((m.phase !== 'play' || m.tip.on) && g++ < 3000) m.tick([0, 0]);
  for (let w = 0; w < 90; w++) m.tick([0, 0]);
  const th = m.players.find((p) => p.seat === 0 && p.slot === 0), df = m.players.find((p) => p.seat === 1 && p.slot === 0);
  m.sides[0].ctrl = th.pid; m.sides[1].ctrl = df.pid;
  const ay = 70 + ((i * 29) % 117), ax = 150 + (i % 5) * 4;
  th.x = ax * ONE; th.y = ay * ONE; th.vx = th.vy = 0; th.st = ST.IDLE; th.face = 1;
  df.x = Math.max(262, Math.min(410, ax + dist)) * ONE; df.y = ay * ONE; df.vx = df.vy = 0; df.st = ST.IDLE; df.face = -1;
  m.giveBall(th); m.drainEvents();
  const up = df.y / ONE > 128 ? BIT.UP : BIT.DOWN, h = createHash('sha1');
  let f = 0, rel = -1, ph = 0, res = null, prev = 0, caught = false;
  while (f++ < 400 && !res) {
    let a = 0;
    const air = th.z > 0 || th.vz !== 0;
    if (th.hasBall) { if (!air && ph === 0) { a = BIT.C; ph = 1; } else if (air && !th.charging && ph === 1) { a = BIT.B; ph = 2; } else if (th.charging) a = th.charge >= 3 ? 0 : BIT.B; }
    const b = m.ball, since = rel >= 0 ? f - rel : -1;
    let d = 0;
    if (since >= 12 && b.mode === BM.FLY) {
      if (pol === 'diag') d = up | BIT.RIGHT;
      else if (pol === 'crouch') d = since === 12 ? BIT.A : 0;
      else if (pol === 'jump') d = since === 12 ? BIT.C : 0;
    }
    if (pol === 'catch' && rel >= 0 && b.mode === BM.FLY && !caught) { // 도착 예상 시각에 맞춘 캐치(오차 없음)
      const eta = Math.hypot((b.x - df.x) / ONE, (b.y - df.y) / ONE) / (Math.hypot(b.vx, b.vy) / ONE || 1), want = Math.ceil(df.stat.s5 / 2);
      if (eta <= want + 1) d = BIT.LEFT;
      if (eta <= want && prev & BIT.LEFT) { d = BIT.B; caught = true; }
    }
    m.tick([a, d]); prev = d;
    if (rel >= 0) h.update(`${b.x},${b.y},${b.z},${b.vx},${b.vy},${b.vz};`);
    for (const e of m.drainEvents()) { if (e.k === 'throw' && rel < 0) rel = f; if (rel >= 0 && (e.k === 'hit' || e.k === 'catch') && !res) res = e.p === df.pid ? e.k : 'other'; }
    if (rel >= 0 && !res && m.ball.mode !== BM.FLY && f > rel + 1) res = 'miss';
  }
  return { res, path: h.digest('hex') };
}

test('필살 추적: 웅크리기·점프·대각 이동으로는 필살슛을 피하지 못하고 캐치로는 막는다. 같은 입력이면 같은 결과', () => {
  const N = 10, cnt = (pol, ev, k) => Array.from({ length: N }, (_, j) => duel(j + 1, pol, ev)).filter((r) => r.res === k).length;
  for (const pol of ['crouch', 'jump', 'diag']) assert.ok(cnt(pol, 'track', 'hit') >= 9, `${pol} 추적 명중`);
  assert.ok(cnt('diag', 'rom', 'hit') <= 5, '원작 규칙에서는 대각 이동 회피가 통한다(대조)');
  const cr = cnt('catch', 'rom', 'catch'), ct = cnt('catch', 'track', 'catch');
  assert.ok(ct >= 7 && ct === cr, `캐치는 원작과 같이 성공(rom ${cr}, track ${ct})`);
  for (const pol of ['diag', 'jump']) assert.deepEqual(duel(3, pol, 'track'), duel(3, pol, 'track'), '결정론');
});

test('원작 경로 불변: 기본값·rom 은 프레임 동일, 추적 경기도 일반 슛은 프레임 동일, 특훈은 추적을 받지 않는다', () => {
  const run = (ev, k) => {
    const m = new Match({ seed: 40 + k, teams: [k % 22, (k * 5 + 2) % 22], data, humans: [true, true], ...(ev ? { evade: ev } : {}) });
    const h = createHash('sha1'); let x = 777 + k, sp = 0;
    for (let f = 0; f < 1500 && m.phase !== 'end'; f++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      m.tick([(x >>> 8) & 127, (x >>> 16) & 127]);
      for (const e of m.drainEvents()) if (e.k === 'special') sp++;
      const b = m.ball; h.update(JSON.stringify([m.snapshot(false), b.x, b.y, b.z, b.vx, b.vy, b.vz]));
    }
    return { h: h.digest('hex'), sp };
  };
  for (let k = 0; k < 4; k++) {
    const a = run(undefined, k), r = run('rom', k), t = run('track', k);
    assert.equal(a.h, r.h);
    assert.equal(a.sp, 0); // 이 무작위 입력은 필살을 내지 않는다 = 일반 슛만
    assert.equal(t.h, a.h, '필살이 없으면 추적 규칙 경기도 원작과 같다');
  }
  assert.equal(duel(2, 'diag', undefined).path, duel(2, 'diag', 'rom').path);
  assert.equal(new Match({ seed: 1, teams: [0, 1], data, evade: 'track', training: { kind: 'special' } }).track, false);
  assert.equal(new Match({ seed: 1, teams: [0, 1], data }).track, false);
  assert.equal(new Match({ seed: 1, teams: [0, 1], data, evade: 'track' }).info().rules.evade, 'track');
  assert.equal(new Match({ seed: 1, teams: [0, 1], data }).info().rules.evade, undefined);
});

test('서버 판정: 사람끼리 일반 방·랭크 방만 추적, 컴퓨터·스토리·특훈·리그·불꽃·불꽃 팀 허용 방은 원작', () => {
  const base = { rules: { mode: 'knockout', time: 5 } };
  assert.equal(evadeOf({ ...base }), 'track');
  assert.equal(evadeOf({ ...base, ranked: true }), 'track');
  for (const k of [{ vsCpu: true }, { campaign: { k: 1 } }, { training: { kind: 'catch' } }, { league: { i: 0, j: 1 } }, { flame: { node: 1 } }, { rules: { mode: 'knockout', time: 5, flameTeams: true } }]) assert.equal(isHumanVsHuman({ ...base, ...k }), false, JSON.stringify(k));
  const mk = (seats, evade) => new RoomGame({ roomCode: 'TEST', seats, data, send: () => {}, onEnd: () => {}, store: { append() {} }, build: 't', seed: 5, evade });
  assert.equal(mk([{ nick: 'a', team: 0 }, { nick: 'b', team: 1 }], 'track').match.track, true);
  assert.equal(mk([{ nick: 'a', team: 0 }, { nick: 'c', team: 1, cpu: true, level: 2 }], 'track').match.track, false); // 컴퓨터 좌석이면 넘겨도 막힌다
  assert.equal(mk([{ nick: 'a', team: 0 }, { nick: 'b', team: 1 }]).match.track, false);
});
