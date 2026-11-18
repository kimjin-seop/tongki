// BGM 허용 목록: manifest 의 bgm.* 는 수치 검증을 통과한 원작 곡(verified:true)뿐이고 루프 구간이 파일 안에 있어야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rd = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));

test('bgm 허용 목록: verified 곡만, 루프 구간 유효, 검증 표와 일치', () => {
  const man = rd('../public/assets/manifest.json');
  const meta = rd('../analysis/data/bgm_loops.json');
  const keys = Object.keys(man).filter((k) => k.startsWith('bgm.'));
  assert.ok(keys.length > 0);
  const allow = new Set(meta.allow);
  for (const k of keys) {
    const e = man[k], tag = e.rom_id.slice(2).toLowerCase();
    assert.equal(e.verified, true, k);
    assert.ok(allow.has(tag) && meta.status[tag].numeric_pass, k + ' 허용 목록에 없음');
    if (e.loop) assert.ok(e.loop_start >= 0 && e.loop_start < e.loop_end && e.loop_end <= e.sec, k + ' 루프 구간');
  }
});

// 소리 관리자 상태기계: 탭 숨김(컨텍스트 suspended) 중 받은 곡 명령이 복귀 뒤 반영되고, 끝난 경기 곡 버퍼는 해제된다.
test('audio: 숨김 중 곡 명령은 복귀 때 반영, 경기 곡 버퍼 해제', async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.document = { hidden: false, createElement: () => ({}) };
  globalThis.fetch = async (u) => {
    const p = new URL('../public' + u, import.meta.url);
    return fs.existsSync(p) ? { ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')), arrayBuffer: async () => new ArrayBuffer(8) } : { ok: false, status: 404 };
  };
  const param = () => ({ value: 1, setValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {}, setValueCurveAtTime() {} });
  const node = () => ({ gain: param(), connect() {}, disconnect() {}, start() {}, stop() {}, onended: null });
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.subs = []; }
    addEventListener(_, fn) { this.subs.push(fn); }
    to(s) { this.state = s; for (const fn of this.subs) fn(); return Promise.resolve(); }
    resume() { return this.to('running'); }
    suspend() { return this.to('suspended'); }
    createGain() { return node(); }
    createBufferSource() { return node(); }
    createBuffer() { return {}; }
    decodeAudioData(ab, res) { const b = { duration: 300 }; res(b); return Promise.resolve(b); }
  };
  const { loadManifest } = await import('../public/js/game/assets.js');
  const { audio, softLimit, limiterCurve } = await import('../public/js/audio.js');
  await loadManifest();
  // 출력 리미터: 0.9 이하는 그대로, 그 위는 1.0 을 넘지 않는다
  assert.equal(softLimit(0.5), 0.5);
  assert.ok(softLimit(2.5) <= 1 && softLimit(-2.5) >= -1 && Math.max(...limiterCurve()) <= 1);
  const tick = () => new Promise((r) => setTimeout(r, 5));
  audio.unlock(); await tick();

  // 재현 C: 경기 곡 재생 중 숨김 → 종료(페이드)·결과 곡 명령 → 복귀
  audio.bgm('bgm.stage.00'); await tick();
  assert.equal(audio.cur?.key, 'bgm.stage.00');
  await audio.ctx.suspend();
  audio.bgm(null); audio.bgm('bgm.result.win');
  assert.equal(audio.cur?.key, 'bgm.stage.00');
  await audio.ctx.resume(); await tick();
  assert.equal(audio.cur?.key, 'bgm.result.win');
  assert.equal(audio.bufs.has('bgm.stage.00'), false, '끝난 경기 곡 버퍼 해제');
  assert.equal(audio.bufs.has('bgm.result.win'), true, '짧은 곡은 유지');

  // 재현 D: 입장 곡(1회) 중 숨김 → 경기 곡 명령 → 복귀. 미리 받은 곡은 재생 전까지 유지
  audio.preload(['bgm.stage.01', 'bgm.enter']);
  audio.bgm('bgm.enter'); await tick();
  assert.equal(audio.bufs.has('bgm.stage.01'), true);
  await audio.ctx.suspend();
  audio.bgm('bgm.stage.01');
  await audio.ctx.resume(); await tick();
  assert.equal(audio.cur?.key, 'bgm.stage.01');
  audio.bgmStop();
  assert.equal(audio.bufs.has('bgm.stage.01'), false);

  // 1회 곡이 곡 길이보다 늦게 풀리면(잠긴 채 지나간 인트로 곡) 틀지 않는다
  await audio.ctx.suspend();
  audio.bgm('bgm.title'); audio.wantAt -= 301e3;
  await audio.ctx.resume(); await tick();
  assert.equal(audio.cur, null);
});
