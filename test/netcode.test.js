// 네트워크 개선(2026-11-22, PROTOCOL §5.2·5.3): 바이너리 스냅샷 코덱 무손실·크기, 프로토콜 버전 거절, 입력 번호 처리, 적응형 지터 버퍼
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { Match, loadData } from '../server/engine/index.js';
import { RoomGame } from '../server/game/roomGame.js';
import { createServer } from '../server/index.js';
import { SnapEncoder, SnapDecoder, flatten } from '../public/js/game/snapcodec.js';
import { readFileSync } from 'node:fs';
import { SnapBuffer, PROFILES, DEFAULT_PROFILE } from '../public/js/game/snaps.js';

const data = loadData();

test('스냅샷 코덱: 실제 경기 6000틱이 키프레임·델타를 거쳐 서버 스냅샷과 완전히 같고(무손실), 평균 메시지가 250B 이하', () => {
  let tot = 0, n = 0;
  for (const [seed, humans] of [[1, [true, true]], [2, [false, false]]]) {
    const m = new Match({ seed, teams: [seed, 20 - seed], data, humans });
    const enc = new SnapEncoder(), dec = new SnapDecoder();
    let r = seed * 7919, bits = [0, 0];
    for (let i = 0; i < 3000; i++) {
      if (i % 20 === 0) { r = (r * 1103515245 + 12345) & 0x7fffffff; bits = [r & 15 | ((r >> 8) & 3) << 4, (r >> 4) & 15]; }
      m.tick(bits);
      const s = m.snapshot();
      const u = enc.encode(s);
      assert.deepStrictEqual(dec.decode(u), JSON.parse(JSON.stringify(s)), `f=${s.f}`);
      if (i === 1500) assert.deepStrictEqual(new SnapDecoder().decode(enc.encodeKeyOnly(s)), JSON.parse(JSON.stringify(s))); // 재접속 좌석용 키프레임(체인 불변)
      tot += u.length; n++;
    }
  }
  assert.ok(tot / n <= 250, `평균 ${(tot / n).toFixed(1)}B`);
});

test('스냅샷 코덱: 기준이 어긋난 델타는 버리고(null) 다음 키프레임부터 복구한다', () => {
  const m = new Match({ seed: 3, teams: [3, 9], data, humans: [false, false] });
  const enc = new SnapEncoder(), dec = new SnapDecoder();
  const us = [];
  for (let i = 0; i < 130; i++) { m.tick([0, 0]); us.push(enc.encode(m.snapshot())); }
  assert.ok(dec.decode(us[0]));
  assert.equal(dec.decode(us[5]), null); // 1~4번을 못 받은 뒤의 델타
  assert.equal(dec.decode(us[6]), null);
  assert.equal(dec.decode(us[60])?.f, 61); // 60틱 뒤 키프레임
  assert.equal(dec.decode(us[61])?.f, 62);
});

test('접속 주소의 프로토콜 버전이 다르면(구 클라이언트) PROTOCOL_MISMATCH 안내 후 1008 로 닫는다', async () => {
  const app = createServer({ log: () => {} });
  const port = await app.listen(0);
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); // v 없음
    const got = [];
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString())));
    const code = await new Promise((res) => ws.on('close', res));
    assert.equal(code, 1008);
    assert.equal(got[0].t, 'error');
    assert.equal(got[0].code, 'PROTOCOL_MISMATCH');
    assert.match(got[0].msg, /새로고침/);
  } finally { await app.close(); }
});

test('입력 번호: 이미 처리한 번호는 버리고, 빠진 번호는 최근 입력으로 채운다. 재접속하면 번호를 다시 센다', () => {
  const rg = new RoomGame({ roomCode: 'TEST', seats: [{ nick: 'a', team: 0 }, { nick: 'b', team: 1 }], data, send: () => {}, onEnd: () => {}, store: { append() {} }, build: 't', seed: 5 });
  const seen = [], tick = rg.match.tick.bind(rg.match);
  rg.match.tick = (bits) => { seen.push(bits[0]); return tick(bits); };
  const one = () => { rg.nextAt = 1000; rg.step(1000); };
  rg.applyInput(0, 0, [8]); one(); // 오른쪽
  rg.applyInput(0, 0, [8]); rg.applyInput(0, 1, [0, 8]); one(); // 같은 번호 다시 = 무시, 뗌
  rg.applyInput(0, 4, [0, 16, 0, 8]); one(); // 번호 2·3 을 못 받았다: 16 눌림(탭)이 래치돼 한 틱 보장되고 마지막은 0
  rg.applyInput(0, 3, [32]); one(); // 늦게 도착한 옛 번호 = 무시
  rg.resume(0); rg.applyInput(0, 0, [4]); one(); // 재접속: 번호 0 부터 다시
  assert.deepEqual(seen, [8, 0, 16, 0, 4]);
});

test('스냅샷 코덱 표가 엔진과 맞는다: 엔진이 쓰는 배너 키·단계(ph) 값과 rules.json 배너 키가 모두 인코딩된다', () => {
  const src = readFileSync(new URL('../server/engine/match.js', import.meta.url), 'utf8');
  const bans = new Set([...src.matchAll(/setBanner\('(\w+)'\)/g)].map((m) => m[1]));
  for (const k of Object.keys(data.rules.start.banners)) if (!k.startsWith('_')) bans.add(k);
  const phs = new Set([...src.matchAll(/this\.phase = '(\w+)'/g)].map((m) => m[1]));
  assert.ok(bans.size >= 5 && phs.size >= 3, `배너 ${bans.size} 단계 ${phs.size}`); // 정규식이 엔진 코드를 못 찾으면 실패
  const s = new Match({ seed: 4, teams: [0, 1], data, humans: [true, true] }).snapshot();
  for (const k of bans) for (const ph of phs) {
    const got = new SnapDecoder().decode(new SnapEncoder().encode({ ...s, ph, ban: [k, 1, 30] }));
    assert.equal(got.ph, ph); assert.deepEqual(got.ban, [k, 1, 30]);
  }
  assert.throws(() => flatten({ ...s, ban: ['no_such_banner', 0, 0] }));
});

test('상대가 끊겨 일시정지 중인 경기에 다시 붙으면 game_pause 를 다시 받는다', () => {
  const sent = [[], []];
  const rg = new RoomGame({ roomCode: 'TEST', seats: [{ nick: 'a', team: 0 }, { nick: 'b', team: 1 }], data, send: (seat, m) => { sent[seat].push(m); }, onEnd: () => {}, store: { append() {} }, build: 't', seed: 6 });
  rg.setConnected(1, false);
  sent[0].length = 0;
  rg.resume(0);
  const p = sent[0].find((m) => m?.t === 'game_pause');
  assert.equal(p?.seat, 1); assert.equal(p?.nick, 'b'); assert.ok(p.deadline > 0);
  rg.setConnected(1, true); sent[0].length = 0;
  rg.resume(0);
  assert.ok(!sent[0].some((m) => m?.t === 'game_pause')); // 멈춰 있지 않으면 보내지 않는다
});

test('적응형 지터 버퍼: 안정된 망은 지연이 하한까지 내려가고, 한 번의 큰 늦음은 6틱까지, 되풀이되면 10틱까지, 끝나면 빠르게 내려온다. 시계가 한 번 밀린 것은 6틱을 넘지 않는다', () => {
  const T = 1000 / 60, P = PROFILES[DEFAULT_PROFILE];
  const b = new SnapBuffer();
  const mk = (f) => ({ f, p: Array.from({ length: 14 }, () => [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]), b: [0, 0, 0, 0, 0, 0, 0], ev: [] });
  let f = 0, t = 1000, lastArr = 0, frameT = 1000, q = [], sm = null;
  /** n틱 진행: late(i) = 그 틱 스냅이 늦는 ms(뒤 스냅은 앞 스냅을 앞지르지 못한다). 60Hz 로 그리며 지연의 최대값을 돌려준다 */
  const run = (n, late = () => 0) => {
    let mx = 0;
    for (let i = 0; i < n; i++, f++) {
      t += T; lastArr = Math.max(t + late(i), lastArr); q.push([lastArr, f]);
      for (; frameT <= t; frameT += T) { while (q.length && q[0][0] <= frameT) { const [at, g] = q.shift(); b.push(mk(g), at); } sm = b.sample(frameT); mx = Math.max(mx, b.delay); }
    }
    return mx;
  };
  run(600);
  assert.ok(Math.abs(b.delay - P.min) < 0.05, `지연 ${b.delay}`); // 흔들림이 없으면 하한
  assert.ok(Math.abs(b.latest().f - sm.tick - b.delay) < 0.1, `여유 ${(b.latest().f - sm.tick).toFixed(2)}틱`); // 재생 시계가 목표에 맞는다(종전: 한 프레임 앞섰다)
  assert.equal(run(60, (i) => (i === 0 ? 200 : 0)), 6); // 한 번의 큰 늦음: 6틱까지만
  run(360);
  assert.ok(b.delay < P.min + 0.3, `지연 ${b.delay}`); // 6초 뒤 복귀
  assert.equal(run(300, (i) => (i % 24 === 0 ? 250 : 0)), 10); // 0.4초마다 되풀이: 상한 10
  run(480);
  assert.ok(b.delay < P.min + 0.3, `지연 ${b.delay}`); // 8초 뒤 복귀
  assert.ok(run(600, () => 200) <= 6); // 서버 틱 시계가 한 번 200ms 밀려 그 뒤 스냅이 계속 늦게 보여도 6틱을 넘지 않는다
  for (let k = 0; k < 20; k++) sm = b.sample(frameT + k * T); // 데이터가 끊긴 지 한참: 외삽 한도에서 선다
  assert.ok(sm.tick <= b.latest().f + 3 + 1e-9);
});
