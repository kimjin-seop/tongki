// 필살 입력 타이밍 (analysis/47 수정안 A·B)
// A: 공중 차지(13~15)로 시작한 투구 동작이 착지 뒤 발사돼도 필살(원작 0x8BEE -> 0x8CF0 은 차지만 본다). 공중 위력 가산은 발사 순간 기준
// B: 서버 입력 래치는 새로 눌린 비트만 1틱 보장하고, 뗀 비트는 다음 틱에 바로 반영한다
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, loadData, BIT } from '../server/engine/index.js';
import { ST, ONE } from '../server/engine/consts.js';
import { RoomGame } from '../server/game/roomGame.js';

const data = loadData();

/** 좌석0 슬롯0 이 제자리 점프 -> w 프레임 대기 -> B 를 h 프레임 누르고 뗀다. 첫 투구의 {z(발사 직후 높이), ch, sp, pw} */
function jumpThrow(w, h) {
  const m = new Match({ seed: 77, teams: [0, 1], data, humans: [true, true] });
  let g = 0; while ((m.phase !== 'play' || m.tip.on) && g++ < 3000) m.tick([0, 0]);
  for (let i = 0; i < 90; i++) m.tick([0, 0]);
  const th = m.players.find((p) => p.seat === 0 && p.slot === 0);
  m.sides[0].ctrl = th.pid;
  th.x = 150 * ONE; th.y = 128 * ONE; th.vx = th.vy = 0; th.st = ST.IDLE; th.face = 1;
  m.giveBall(th); m.drainEvents();
  const pads = [BIT.C, ...Array(w).fill(0), ...Array(h).fill(BIT.B), ...Array(60).fill(0)];
  for (const pad of pads) {
    m.tick([pad, 0]);
    let th0 = null, sp = false;
    for (const e of m.drainEvents()) { if (e.k === 'throw' && e.p === th.pid) th0 = e; if (e.k === 'special' && e.p === th.pid) sp = true; }
    if (th0) return { z: th.z, ch: th0.ch, sp, pw: th0.pw };
  }
  return null;
}

test('A: 공중 차지 13~15 로 시작해 투구 동작 중 착지한 발사도 필살, 착지 전 발사·창 밖 차지는 종전대로', () => {
  let landedSp = 0, airSp = 0;
  for (let w = 0; w <= 40; w++) {
    for (const h of [12, 14]) {
      const r = jumpThrow(w, h);
      if (!r) continue;
      if (r.ch >= 13 && r.ch <= 15) { assert.equal(r.sp, true, `w${w} h${h} 차지 ${r.ch} z ${r.z}`); if (r.z === 0) landedSp++; else airSp++; }
      else assert.equal(r.sp, false, `w${w} h${h} 차지 ${r.ch}`);
    }
  }
  assert.ok(landedSp > 0 && airSp > 0, `착지 뒤 필살 ${landedSp}, 공중 필살 ${airSp}`);
});

test('B: 입력 래치 - 짧은 탭은 1틱 보장, 뗀 비트는 다음 틱에 바로 반영', () => {
  const rg = new RoomGame({ roomCode: 'TEST', seats: [{ nick: 'a', team: 0 }, { nick: 'b', team: 1 }], data, send: () => {}, onEnd: () => {}, store: { append() {} }, build: 't', seed: 5 });
  const seen = [], tick = rg.match.tick.bind(rg.match);
  rg.match.tick = (bits) => { seen.push(bits[0]); return tick(bits); };
  const one = () => { rg.nextAt = 1000; rg.step(1000); };
  rg.setInput(0, BIT.B); one(); // 누름
  one(); // 유지
  rg.setInput(0, 0); one(); // 뗌: 바로 0 (종전 래치는 B 가 한 틱 더 남았다)
  rg.setInput(0, BIT.B); rg.setInput(0, 0); one(); // 틱 사이 짧은 탭: 1틱 보장
  one(); // 그 다음 틱은 0
  rg.setInput(0, BIT.B | BIT.RIGHT); rg.setInput(0, BIT.RIGHT); one(); // 오른쪽 누른 채 B 탭
  rg.setInput(0, 0); one();
  assert.deepEqual(seen, [BIT.B, BIT.B, 0, BIT.B, 0, BIT.B | BIT.RIGHT, 0]);
});
