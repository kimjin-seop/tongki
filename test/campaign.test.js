import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Match, loadData } from '../server/engine/index.js';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { MemoryProgressStore, JsonProgressStore } from '../server/store/progress.js';

const data = loadData();

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const q = [], waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].res(m); else q.push(m);
  });
  const open = new Promise((r) => ws.on('open', r));
  return {
    open, ws, send: (o) => ws.send(JSON.stringify(o)),
    wait(pred, ms = 3000) {
      const i = q.findIndex(pred);
      if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]);
      return new Promise((res, rej) => { waiters.push({ pred, res }); setTimeout(() => rej(new Error('timeout')), ms).unref(); });
    },
    type(t, ms) { return this.wait((m) => m.t === t, ms); },
  };
}

test('캠페인 데이터: 15경기 ROM 표와 일치, 스테이지 마찰·바운스가 stage json 과 일치', () => {
  const c = data.campaign;
  assert.equal(c.length, 15);
  const row = (k) => [c[k].teamMine, c[k].teamOpp, c[k].romStage];
  assert.deepEqual(row(0), [0, 1, 1]); assert.deepEqual(row(6), [0, 4, 8]); assert.deepEqual(row(7), [22, 17, 4]);
  assert.deepEqual(row(12), [22, 16, 0]); assert.deepEqual(row(14), [22, 23, 6]);
  assert.equal(data.teams.length, 25);
  const bg = path.resolve('public/assets/rom/bg');
  for (const s of data.stages) {
    const f = path.join(bg, `stage_${String(s.id).padStart(2, '0')}.json`);
    if (s.id === 0 || !existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    assert.equal(s.romStage, j.rom_stage_index);
    assert.equal(s.friction, parseInt(j.physics.friction_E22C, 16));
    assert.equal(s.bounceShift, j.physics.bounce_shift_E22A);
  }
});

function digest(opts, frames = 3000) {
  const m = new Match({ seed: 9, teams: [0, 1], data, humans: [false, false], ...opts });
  const h = createHash('sha1');
  for (let i = 0; i < frames && m.phase !== 'end'; i++) { m.tick([0, 0]); h.update(JSON.stringify(m.snapshot())); }
  return { d: h.digest('hex'), m };
}

test('스테이지: 0/미지정은 기존과 동일 결과, 마찰이 다른 스테이지는 달라지고 info 에 stage 포함', () => {
  assert.equal(digest({ stage: 0 }).d, digest({}).d);
  assert.notEqual(digest({ stage: 8 }).d, digest({}).d);
  assert.equal(digest({}, 1).m.info().stage.id, 0);
  assert.deepEqual(digest({ stage: 8 }, 1).m.info().stage, { id: 8, key: 'bg.stage.08', file: 'rom/bg/stage_08', json: 'rom/bg/stage_08.json', romStage: 5 });
  assert.throws(() => new Match({ seed: 1, teams: [0, 1], data, stage: 99 }));
});

test('컴퓨터 필살기: 원작 공격 plan(0x14 공중 차지 15 등)으로 발동한다(자작 확률 specialChance256 과 무관) / AI 대 AI 100시드 예외·NaN·무종료 0', () => {
  // 직역 두뇌(rules.cpu.rom): 컴퓨터 활성 내야의 필살기는 선수 파라미터(b2..b5)로 고른 plan 에서 나온다. 종전 자작 확률(specialChance256)은 활성 내야에 쓰이지 않는다
  // -> 자작 확률이 0 이어도 필살기가 나오고, 그 필살기는 전부 포메이션 밖의 활성 내야가 던진 것이다
  {
    const m = new Match({ seed: 3, teams: [0, 1], data, humans: [false, false], specialChance256: [0, 0] });
    let n = 0, sp = 0, act = 0;
    while (m.phase !== 'end' && n++ < 60000) {
      m.tick([0, 0]);
      for (const e of m.drainEvents()) if (e.k === 'special') { sp++; const p = m.players[e.p]; if (!m.fm && p.role === 'in' && m.sides[p.seat].ctrl === e.p) act++; }
    }
    assert.ok(sp > 0 && act === sp, `필살기 ${sp}회 중 활성 내야 ${act}회`);
  }
  let sp = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const m = new Match({ seed, teams: [seed % 25, (seed * 7 + 3) % 25], data, humans: [false, false], stage: seed % 14, specialChance256: [128, 200] });
    let n = 0;
    while (m.phase !== 'end' && n++ < 60000) { m.tick([0, 0]); for (const e of m.drainEvents()) if (e.k === 'special') sp++; }
    assert.equal(m.phase, 'end', `seed ${seed} 무종료`);
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(m.snapshot())), `seed ${seed} NaN`);
  }
  assert.ok(sp > 0);
});

test('진행 저장소: 승리만 해제·되돌아가지 않음, JSON 파일에 원자적으로 저장되고 재로드된다', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prog-'));
  const f = path.join(dir, 'p.json');
  const st = new JsonProgressStore(f);
  assert.deepEqual(st.get('a'), { clearedMax: -1, last: null });
  st.recordResult('a', 'A', 0, true); st.recordResult('a', 'A', 1, false); st.recordResult('a', 'A', 0, true);
  assert.deepEqual(st.get('a'), { clearedMax: 0, last: 0 });
  await new Promise((r) => setTimeout(r, 250)); // 디바운스 쓰기
  assert.deepEqual(new JsonProgressStore(f).get('a'), { clearedMax: 0, last: 0 });
  assert.deepEqual(readdirSync(dir), ['p.json']); // 임시 파일이 남지 않는다
});

test('진행 저장소: 패배·기권은 파일에 기록하지 않고(last 는 메모리 유지), 손상 파일은 보존 후 시작, 범위 밖 항목은 무시', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prog-'));
  const f = path.join(dir, 'p.json');
  const st = new JsonProgressStore(f);
  st.recordResult('x', 'X', 3, false);
  st.flush();
  assert.deepEqual(st.get('x'), { clearedMax: -1, last: 3 });
  assert.deepEqual(readdirSync(dir), []); // 패배만으로는 파일이 생기지 않는다
  st.recordResult('x', 'X', 0, true); st.flush();
  assert.deepEqual(new JsonProgressStore(f).get('x'), { clearedMax: 0, last: 0 });

  writeFileSync(f, '{broken', 'utf8');
  const st2 = new JsonProgressStore(f);
  assert.deepEqual(st2.get('x'), { clearedMax: -1, last: null });
  const names = readdirSync(dir);
  assert.equal(names.length, 1);
  assert.match(names[0], /^p\.json\.corrupt-\d+$/);
  assert.equal(readFileSync(path.join(dir, names[0]), 'utf8'), '{broken');

  writeFileSync(f, JSON.stringify({ users: { ok: { clearedMax: 14 }, big: { clearedMax: 15 }, frac: { clearedMax: 1.5 } } }), 'utf8');
  const st3 = new JsonProgressStore(f);
  assert.equal(st3.get('ok').clearedMax, 14);
  assert.equal(st3.get('big').clearedMax, -1);
  assert.equal(st3.get('frac').clearedMax, -1);
});

test('캠페인 흐름: 잠금·위조 무시·공개 목록 숨김·재접속·패배 불변·승리 해제', async () => {
  const store = new MemoryResultStore(), progress = new MemoryProgressStore();
  const app = createServer({ store, progress, log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port), o = client(port);
    await Promise.all([a.open, o.open]);
    a.send({ t: 'hello', nickname: '캠페인A' }); const wa = await a.type('welcome');
    o.send({ t: 'hello', nickname: '구경꾼' }); await o.type('welcome');
    a.send({ t: 'campaign_list' });
    const l0 = await a.type('campaign_list');
    assert.equal(l0.chapters.length, 15);
    assert.deepEqual(l0.progress, { clearedMax: -1, last: null });
    assert.deepEqual(l0.chapters.filter((c) => c.unlocked).map((c) => c.k), [0]);
    a.send({ t: 'campaign_start', k: 1 });
    assert.equal((await a.type('error')).code, 'CAMPAIGN_LOCKED');
    a.send({ t: 'campaign_start', k: 99 });
    assert.equal((await a.type('error')).code, 'BAD_MESSAGE');

    // 위조 필드(상대·스테이지·내 팀)는 무시: 서버 표(k0 = 팀0 vs 팀1, stage 0)
    a.send({ t: 'campaign_start', k: 0, teamOpp: 9, teamMine: 5, stage: 8, cpuLevel: 1, specialChance256: 0 });
    const gs = await a.type('game_start');
    assert.deepEqual(gs.teams.map((t) => t.id), [0, 1]);
    assert.equal(gs.stage.id, 0);
    assert.equal(gs.campaign.k, 0);
    o.send({ t: 'list_rooms' });
    assert.deepEqual((await o.type('room_list')).rooms, []); // 캠페인 방은 목록에 없다
    o.send({ t: 'join_room', code: [...app.lobby.rooms.keys()][0] });
    assert.equal((await o.type('error')).code, 'ROOM_IN_GAME');

    // 재접속: 끊어도 같은 경기가 이어진다(campaign 정보 포함)
    a.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    const a2 = client(port); await a2.open;
    a2.send({ t: 'hello', token: wa.token });
    assert.equal((await a2.type('welcome')).location, 'game');
    const gs2 = await a2.wait((m) => m.t === 'game_start' && m.resumed);
    assert.equal(gs2.campaign.k, 0);

    // 패배(기권): 진행 불변
    a2.send({ t: 'leave_room' });
    const lose = await a2.type('campaign_result');
    assert.equal(lose.win, false);
    assert.deepEqual(lose.progress, { clearedMax: -1, last: 0 });

    // 승리: 다음 경기 해제 -> k1 시작 가능(스테이지 1, 상대 팀 3)
    a2.send({ t: 'campaign_start', k: 0 });
    await a2.type('game_start');
    app.lobby.rooms.values().next().value.game.finish(0, 'annihilation'); // 사람 승리 확정 경로
    const win = await a2.type('campaign_result');
    assert.equal(win.win, true); assert.equal(win.unlocked, 1);
    assert.deepEqual(win.progress, { clearedMax: 0, last: 0 });
    a2.send({ t: 'campaign_start', k: 1 });
    const gs3 = await a2.type('game_start');
    assert.deepEqual(gs3.teams.map((t) => t.id), [0, 3]);
    assert.equal(gs3.stage.id, 1);
    const rec = store.records.find((r) => r.campaign?.k === 0 && r.winner === '캠페인A');
    assert.ok(rec && rec.vsCpu);
    a2.ws.close(); o.ws.close();
  } finally { await app.close(); }
});
