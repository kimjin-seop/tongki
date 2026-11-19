// 불꽃의 계승 연습 경기(analysis/39 D28, PROTOCOL §13.15). 핵심 동작 + 에러 없음만 본다:
// 결과가 저장·코인·순위·승수에 반영되지 않는다 / 두 번째 도전에는 나오지 않는다 / run_config.json practice 키가 없으면 종전 동작.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadData } from '../server/engine/index.js';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { loadCatalog } from '../server/flame/catalog.js';
import { catalogMsg } from '../server/flame/handlers.js';
import { freshProfile, FlameError } from '../server/flame/save.js';
import { candidates } from '../server/flame/map.js';
import * as Run from '../server/flame/run.js';

const data = loadData(), cat = loadCatalog();
const codeOf = (fn) => { try { fn(); return null; } catch (e) { if (e instanceof FlameError) return e.code; throw e; } };

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

test('flame 연습 경기(D28) 로비 경유: 이겨도 도전·코인·승수·기록·결과 레코드가 그대로이고 끝난 뒤 저장이 없다. 한 번 쓰면 다시 받을 수 없고, 실전 첫 경기는 그대로 남아 있으며, 두 번째 도전에는 나오지 않는다', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flame-practice-')), results = new MemoryResultStore();
  const app = createServer({ store: results, dbPath: path.join(dir, 't.db'), importJson: false, flameSeed: 21, log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port); await a.open;
    a.send({ t: 'hello', nickname: '연습A' }); await a.type('welcome');
    a.send({ t: 'flame_new' }); await a.type('flame_state');
    a.send({ t: 'flame_choose', i: 0 });
    let st = await a.type('flame_state');
    assert.deepEqual([st.run.practiceAvailable, st.profile.practiceUsed], [true, false]);
    const strip = (s) => { const { updatedAt, practiceAvailable, ...run } = s.run; const { practiceUsed, ...profile } = s.profile; return { run, profile }; }; // eslint-disable-line no-unused-vars
    const before = strip(st), first = st.run.candidates[0];

    a.send({ t: 'flame_practice' });
    const rj = await a.type('room_joined'), gs = await a.type('game_start');
    const room = app.lobby.rooms.values().next().value;
    assert.deepEqual([rj.room.flame, gs.flameCast.practice, gs.teams[0].flame, room.cpuLevel, room.cpuTeam], [{ node: null, type: 'practice' }, true, true, cat.cfg.practice.cpuLevel, st.run.map[0].layers[0][0].opp.team]);
    let saves = 0;
    const save = app.lobby.flame.save;
    app.lobby.flame.save = (...x) => { saves++; return save.apply(app.lobby.flame, x); };
    room.game.finish(0, 'annihilation'); // 연습 경기를 이긴다
    await a.type('game_end');
    const fr = await a.type('flame_result');
    assert.deepEqual([fr.practice, fr.outcome, fr.won, fr.node], [true, 'practice', true, null]);
    st = await a.type('flame_state');
    await a.type('room_left');
    assert.deepEqual([saves, results.records.length, app.lobby.rooms.size], [0, 0, 0]); // 끝난 뒤 저장 없음·결과 레코드 없음
    app.lobby.flame.save = save;
    assert.deepEqual(strip(st), before); // 도전(승수·포인트·HP·지도·보상)과 영구 저장(코인·기록·업적)이 그대로
    assert.deepEqual([st.profile.coins, st.profile.totals, st.profile.best, st.run.matchesWon, st.run.done, st.run.practiceAvailable, st.profile.practiceUsed],
      [0, { runs: 0, wins: 0, boss: 0 }, { seg: 0, wins: 0, clears: 0, clearDiff: [] }, 0, [], false, true]);

    a.send({ t: 'flame_practice', ref: 1 }); // 계정당 한 번
    assert.equal((await a.wait((m) => m.t === 'error' && m.ref === 1)).code, 'FLAME_PRACTICE_NONE');
    a.send({ t: 'flame_node', id: first }); await a.type('game_start'); // 실전 첫 경기는 그대로 고를 수 있다
    app.lobby.rooms.values().next().value.game.finish(0, 'annihilation');
    assert.equal((await a.type('flame_result')).outcome, 'win');
    st = await a.type('flame_state');
    await a.type('room_left');
    assert.deepEqual([st.run.matchesWon, results.records.length], [1, 1]);

    a.send({ t: 'flame_new' }); // 두 번째 도전
    await a.type('flame_end');
    st = await a.type('flame_state');
    assert.deepEqual([st.profile.totals.runs, st.run.practiceAvailable], [1, false]);
    a.ws.close();
  } finally { await app.close(); }
});

test('flame 연습 경기 조건: 첫 도전의 실전 0판일 때만(끝난 도전 기록이 있거나 한 판 치른 뒤에는 없음), 시작 값은 도전 상태를 고치지 않는다', () => {
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 5 });
  assert.equal(Run.practiceAvailable(cat, run, profile), true);
  assert.equal(codeOf(() => Run.practiceOptions(cat, data, run, profile)), 'FLAME_PENDING'); // 시작 보상을 먼저 푼다
  while (run.pending.length) Run.choose(cat, data, run, profile, -1);
  const snap = JSON.stringify(run), o = Run.practiceOptions(cat, data, run, profile);
  assert.deepEqual([o.type, o.node, o.cpuLevel, o.cast.practice, o.flame.roster.length, JSON.stringify(run) === snap], ['practice', null, 1, true, 7, true]);
  assert.equal(Run.practiceAvailable(cat, run, { ...freshProfile(), totals: { runs: 1, wins: 0, boss: 0 } }), false); // 끝난 도전이 있는 계정
  assert.equal(Run.practiceAvailable(cat, run, { ...freshProfile(), practiceUsed: true }), false); // 이미 쓴 계정
  Run.enterNode(cat, data, run, profile, candidates(run)[0].id);
  Run.applyMatchResult(cat, data, run, profile, { winner: 0, reason: 'annihilation' });
  assert.equal(Run.practiceAvailable(cat, run, profile), false); // 실전을 한 판 치른 뒤
});

test('flame 연습 경기 끄기: run_config.json practice 키가 없으면(또는 enabled:false) 받을 수 없고 flame_state 의 나머지는 같다', () => {
  const cfg = { ...cat.cfg }; delete cfg.practice;
  const catNo = { ...cat, cfg }, profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 5 });
  while (run.pending.length) Run.choose(cat, data, run, profile, -1);
  assert.deepEqual([Run.practiceAvailable(catNo, run, profile), Run.practiceAvailable({ ...cat, cfg: { ...cat.cfg, practice: { enabled: false } } }, run, profile)], [false, false]);
  assert.equal(codeOf(() => Run.practiceOptions(catNo, data, run, profile)), 'FLAME_PRACTICE_NONE');
  assert.deepEqual([catalogMsg(catNo).practice, catalogMsg(cat).practice], [{ enabled: false, cpuLevel: null }, { enabled: true, cpuLevel: 1 }]);
  const on = Run.viewOf(cat, data, run, profile), off = Run.viewOf(catNo, data, run, profile);
  assert.deepEqual([on.run.practiceAvailable, off.run.practiceAvailable], [true, false]);
  assert.deepEqual({ ...off, run: { ...off.run, practiceAvailable: true } }, on);
});
