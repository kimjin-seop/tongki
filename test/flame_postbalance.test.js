// 불꽃의 계승: 밸런스 보정 후속(analysis/40 §16.9, analysis/39 D30~D32) + 정검수 리뷰 L1. 핵심 동작 + 에러 없음만 본다:
// 보스 뒤 회복 값(키가 없으면 종전) / 특훈 누적 상한 거절·구 저장 읽기 / 난이도 레벨 가산 숫자·객체 / 연습 경기 오류 종료 복구.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadData } from '../server/engine/index.js';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { loadCatalog, roundHalfUp } from '../server/flame/catalog.js';
import { catalogMsg } from '../server/flame/handlers.js';
import { freshProfile, sanitizeRun, FlameError } from '../server/flame/save.js';
import { candidates, genSegment } from '../server/flame/map.js';
import * as Nodes from '../server/flame/nodes.js';
import * as Run from '../server/flame/run.js';

const data = loadData(), cat = loadCatalog();
const codeOf = (fn) => { try { fn(); return null; } catch (e) { if (e instanceof FlameError) return e.code; throw e; } };
/** run_config 의 한 묶음(rest·training·difficulty)만 바꾼 카탈로그 */
const catWith = (key, fn) => ({ ...cat, cfg: { ...cat.cfg, [key]: fn(structuredClone(cat.cfg[key])) } });

test('flame 보스 뒤 회복(D30): 구간 보스를 이기면 afterBossHealPct, 일반 승리는 afterWinHealPct. 키가 없으면 보스 뒤에도 afterWinHealPct(종전)', () => {
  /** 층 li(0 = 첫 일반 경기, 마지막 = 보스)의 경기를 전원 HP 10 으로 이긴 뒤의 [회복량 7칸, 최대 HP 7칸] */
  const gain = (C, boss) => {
    const profile = freshProfile(), run = Run.newRun(C, data, profile, { seed: 7 });
    run.pending = [];
    if (boss) run.layer = run.map[0].layers.length - 1;
    const node = candidates(run)[0], max = run.roster.map((r) => r.hp);
    assert.equal(node.type, boss ? 'boss' : 'normal');
    Run.enterNode(C, data, run, profile, node.id);
    const out = Run.applyMatchResult(C, data, run, profile, { winner: 0, reason: 'annihilation', flame: { hp: max.map(() => 10), surviveUsed: [] } });
    assert.deepEqual([out.outcome, out.end, run.seg], ['win', null, boss ? 1 : 0]);
    return [run.roster.map((r) => r.hp - 10), max];
  };
  const C = catWith('rest', (r) => ({ ...r, afterWinHealPct: 30, afterBossHealPct: 50 })), noKey = catWith('rest', (r) => { delete r.afterBossHealPct; return { ...r, afterWinHealPct: 30 }; });
  const pct = (max, p) => max.map((m) => roundHalfUp(m * p, 100));
  const [b, max] = gain(C, true);
  assert.ok(max.every((m) => m > 40));
  assert.deepEqual([b, gain(C, false)[0], gain(noKey, true)[0]], [pct(max, 50), pct(max, 30), pct(max, 30)]);
  assert.deepEqual([catalogMsg(C).afterBossHealPct, catalogMsg(C).afterWinHealPct, catalogMsg(noKey).afterBossHealPct], [50, 30, 30]);
});

test('flame 보스 승리 보상: 아티팩트 선택 칸에도 nodeType(장비 보상 칸과 같은 값)이 실리고 저장 왕복 뒤에도 남는다', () => {
  const profile = freshProfile(), run = Run.newRun(cat, data, profile, { seed: 7 });
  run.pending = []; run.layer = run.map[0].layers.length - 1;
  const node = candidates(run)[0];
  Run.enterNode(cat, data, run, profile, node.id);
  Run.applyMatchResult(cat, data, run, profile, { winner: 0, reason: 'annihilation', flame: { hp: run.roster.map(() => 10), surviveUsed: [] } });
  const view = (r) => Run.viewOf(cat, data, r, profile).run.pending.map((p) => [p.kind, p.src, p.nodeType]);
  assert.deepEqual(view(run), [['equipment', node.id, 'boss'], ['artifact', node.id, 'boss']]);
  assert.deepEqual(view(sanitizeRun(cat, data, JSON.parse(JSON.stringify(run)))), view(run));
});

test('flame 특훈 누적 상한(D31): 상한을 넘는 특훈은 FLAME_TRAIN_CAP(포인트·횟수 그대로), 이미 넘은 구 저장은 읽기만 하고 깎지 않는다, 이벤트 trainRandom 은 받을 수 있는 선수에게, 키가 없으면 종전', () => {
  const opt = cat.training.find((t) => t.stat === 's4'), cap = 3 * opt.value;
  const C = catWith('training', (t) => ({ ...t, maxPerStat: { s4: cap } })), noKey = catWith('training', (t) => { delete t.maxPerStat; return t; });
  const profile = freshProfile(), run = Run.newRun(C, data, profile, { seed: 9 });
  run.pending = []; run.points = 100000; run.node = { id: 'x', type: 'training', picks: 99 };
  for (let i = 0; i < 3; i++) Nodes.train(C, run, 0, opt.id);
  const snap = [run.points, run.node.picks];
  assert.deepEqual([codeOf(() => Nodes.train(C, run, 0, opt.id)), run.roster[0].train.s4, run.points, run.node.picks], ['FLAME_TRAIN_CAP', cap, ...snap]);
  assert.equal(codeOf(() => Nodes.train(C, run, 1, opt.id)), null); // 다른 선수는 그대로 받는다
  assert.equal(codeOf(() => Nodes.train(noKey, run, 0, opt.id)), null); // 키가 없으면 상한 없음(종전)
  // 구 저장: 이미 상한을 넘은 값은 저장 왕복에서 그대로 남고 더 받을 수만 없다
  const old = Run.newRun(C, data, profile, { seed: 9 });
  old.pending = []; old.roster[2].train.s4 = cap * 5;
  const back = sanitizeRun(C, data, JSON.parse(JSON.stringify(old)));
  back.points = 100000; back.node = { id: 'x', type: 'training', picks: 2 };
  assert.deepEqual([back.roster[2].train.s4, codeOf(() => Nodes.train(C, back, 2, opt.id)), back.roster[2].train.s4], [cap * 5, 'FLAME_TRAIN_CAP', cap * 5]);
  // 이벤트 trainRandom: 한 명만 여유가 있으면 그 선수가 받고, 아무도 없으면 선택지를 거절한다(HP·포인트 그대로)
  const ev = { id: 'EX', name: 'x', choices: [{ name: 'a', cost: 10, ops: [{ op: 'hpAll', value: -5 }, { op: 'trainRandom', stat: 's4', value: opt.value }] }] };
  const CE = { ...C, cfg: { ...C.cfg, events: [ev] } }, pend = { kind: 'event', node: '0-3-0', event: 'EX' }, maxHp = back.roster.map((r) => r.hp);
  back.roster.forEach((r, i) => { r.train.s4 = i === 5 ? 0 : cap; });
  assert.deepEqual(Nodes.chooseEvent(CE, back, pend, 0, null, maxHp).results.at(-1), { op: 'trainRandom', p: 5, stat: 's4', value: opt.value });
  back.roster[5].train.s4 = cap;
  const hp = back.roster.map((r) => r.hp), pts = back.points;
  assert.deepEqual([codeOf(() => Nodes.chooseEvent(CE, back, pend, 0, null, maxHp)), back.roster.map((r) => r.hp), back.points], ['FLAME_TRAIN_CAP', hp, pts]);
  assert.deepEqual([catalogMsg(C).training.maxPerStat, catalogMsg(noKey).training.maxPerStat], [{ s4: cap }, null]);
});

test('flame 난이도 레벨 가산(D32): cpuLevelAdd 가 숫자면 모든 경기 종류에(종전), {normal,strong,boss} 면 종류별로(없는 종류 0, 상한 cpuLevelMax)', () => {
  const O = cat.cfg.opponents, base = O.segments[0].cpuLevel;
  const levels = (add) => {
    const C = catWith('difficulty', (d) => d.map((x) => (x.id === 1 ? { ...x, cpuLevelAdd: add } : x)));
    const out = {};
    for (const n of genSegment(C, data, 11, 0, { roster: [], diff: 1, oppUnlocked: false }).layers.flat()) if (n.opp) out[n.type] = n.opp.cpuLevel;
    return out;
  };
  const want = (a) => Object.fromEntries(['normal', 'strong', 'boss'].map((k) => [k, Math.min(O.cpuLevelMax, base[k] + (a[k] ?? 0))]));
  assert.deepEqual(levels(1), want({ normal: 1, strong: 1, boss: 1 }));
  assert.deepEqual(levels({ normal: 1, boss: 1 }), want({ normal: 1, boss: 1 }));
  assert.notDeepEqual(levels(1), levels({ normal: 1, boss: 1 })); // 강팀만 가산이 빠진다
  assert.deepEqual(levels(0), want({}));
  assert.ok(Object.values(levels(-9)).every((l) => l === 1)); // 리뷰 L1: 음수 가산이 들어와도 레벨 하한 1(저장 검사 cpuLevel >= 1 에 걸리지 않게)
});

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

test('flame 연습 경기 오류 종료(리뷰 L1): 엔진 오류(reason error)로 끝나면 한 번 소비를 되돌려 다시 받을 수 있고 도전은 그대로다. 기권으로 끝나면 종전대로 소비된다', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flame-practice-err-'));
  const app = createServer({ store: new MemoryResultStore(), dbPath: path.join(dir, 't.db'), importJson: false, flameSeed: 21, log: () => {} });
  const port = await app.listen(0);
  try {
    const a = client(port); await a.open;
    a.send({ t: 'hello', nickname: '연습E' }); await a.type('welcome');
    a.send({ t: 'flame_new' }); await a.type('flame_state');
    a.send({ t: 'flame_choose', i: 0 });
    const before = await a.type('flame_state');
    const play = async (reason) => {
      a.send({ t: 'flame_practice' }); await a.type('game_start');
      app.lobby.rooms.values().next().value.game.abort(reason === 'error' ? -1 : 1, reason);
      const fr = await a.type('flame_result'), st = await a.type('flame_state');
      await a.type('room_left');
      return { fr, st };
    };
    const e = await play('error');
    assert.deepEqual([e.fr.reason, e.fr.practiceRefunded, e.st.profile.practiceUsed, e.st.run.practiceAvailable, app.lobby.rooms.size], ['error', true, false, true, 0]);
    const strip = (s) => { const { updatedAt, ...run } = s.run; return run; }; // eslint-disable-line no-unused-vars
    assert.deepEqual(strip(e.st), strip(before)); // 도전(지도·HP·포인트·보상)은 그대로
    const f = await play('forfeit_disconnect'); // 다시 받을 수 있고, 기권은 종전대로 소비
    assert.deepEqual([f.fr.practiceRefunded, f.st.profile.practiceUsed, f.st.run.practiceAvailable], [undefined, true, false]);
    a.ws.close();
  } finally { await app.close(); }
});
