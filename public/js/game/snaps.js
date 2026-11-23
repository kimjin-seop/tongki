// 스냅샷 버퍼 + 적응형 지터 버퍼 + 선형 보간 (60Hz 스냅샷 → 렌더). 서버 상태가 정본, 로컬 예측 없음.
// 화면 표현만 다룬다(서버 판정·엔진 불변). 서버 틱 시계를 도착 시각으로 추정해 재생 시계를 만들고,
// 몰려 오거나 늦은 스냅샷은 재생 지연(틱 수)을 늘려 흡수한다. 그래도 모자라면 최신 스냅의 속도로 짧게만 외삽한다.
// 종전: 최신보다 1틱 뒤를 그리고 늦으면 멈춤 -> 지터 60ms 이하만 무난했다(2026-11-22 네트워크 조사)
// 2026-11-23(HANDOFF §28): 재생 시계가 목표보다 늘 한 프레임 앞서던 치우침 수정(60Hz 에서 지연이 1틱 모자라 프레임의 절반 이상이 외삽이었다),
// 지연 상한 6 -> 10틱(큰 늦음이 4초 안에 BIG_NEED 번 새로 시작될 때만 6 을 넘고 빨리 내려온다), 외삽 한도에서 뚝 멈추는 대신 서서히 선다
// 2026-11-23 튜닝(HANDOFF §28.2): 지연을 정수 틱이 아니라 소수로, 스냅 늦음의 최대값이 아니라 "그리는 순간 최신 스냅이 서버 시계보다 얼마나 뒤졌나(lag)"의
// 평균 + k x 편차로 맞춘다(안정된 망에서 지연이 1틱 안팎까지 내려간다). 크게 모자랄 때만 바로 올리고, 잠깐 붙든 뒤 빠르게 내린다. 성향은 PROFILES
const TICK_MS = 1000 / 60;
const DELAY_SOFT = 6; // 큰 늦음이 되풀이되지 않는 동안의 상한(약 100ms)
const DELAY_MAX = 10; // 상한(약 167ms): 큰 늦음이 되풀이될 때만 DELAY_SOFT 를 넘는다. 이보다 큰 늦음은 외삽·감속으로 둔다(입력 반응이 너무 늦어지는 것을 막는다)
const DELAY_INIT = 3;
const EXTRAP = 3; // 외삽 한도(틱, 약 50ms). 가까워질수록 느려져 여기서 선다
const BIG_GAP_MS = 250; // 큰 늦음 두 번을 서로 다른 일로 세는 최소 간격(한 번의 몰림은 한 번으로 센다)
const BIG_WIN_MS = 4000; // 이 안에 큰 늦음이 need 번 시작되면 '되풀이'로 본다. 큰 늦음은 시작(늦지 않던 스냅 뒤의 첫 큰 늦음)만 센다: 시계가 한 번 밀려 계속 늦게 보이는 것은 1번이다
const ATTACK = 0.75; // 그리는 순간 지연이 이만큼(틱) 넘게 모자라면 바로 올린다(그보다 작은 모자람은 짧은 외삽으로 넘기고 통계로만 반영)
const UP_RATE = 4; // 통계 목표가 올라갈 때 따라 올리는 빠르기(틱/초)
const STAT_TAU_MS = 1000; // lag 평균·편차의 시간 상수
/**
 * 성향(반응 대 끊김). k = 편차 배수(클수록 외삽이 줄고 지연이 는다), guard = 덧붙이는 여유(틱), min = 지연 하한(틱),
 * hold = 바로 올린 뒤 내리기 시작할 때까지(ms), down = 내리는 빠르기(틱/초), need = DELAY_SOFT 위를 여는 큰 늦음 시작 횟수(BIG_WIN_MS 안)
 */
export const PROFILES = {
  react: { k: 0.5, guard: 0.1, min: 1, hold: 1500, down: 3, need: 4 },
  smooth: { k: 2.5, guard: 0.25, min: 1.5, hold: 3000, down: 1, need: 3 },
};
export const DEFAULT_PROFILE = 'react';
const TAU_MS = 330; // 재생 시계를 목표로 끌어당기는 시간 상수(주사율과 무관. 종전 60Hz 프레임당 5% 와 같은 빠르기)
const JUMP = 12; // 목표와 이만큼(틱) 넘게 벌어지면 따라가지 않고 바로 맞춘다(탭 복귀·긴 끊김)
const REBASE_MS = 800; // 이보다 크게 늦은 도착 = 일시정지·재접속 등 시계 불연속: 기준 재설정
const BUCKET_MS = 5000;
const STALE_MS = 500, STALE_TICKS = 1.5; // 이 시간 내내 모든 스냅이 이만큼(틱) 넘게 늦으면 서버 틱 시계가 밀린 것: 기준을 그만큼 옮긴다(5~10초 창이 돌 때까지 계속 외삽하지 않게)
const MAX = 30;
export const U = 16; // 좌표 단위: 1/16 px

const far = (p, q) => Math.abs(p[0] - q[0]) > 64 * U || Math.abs(p[1] - q[1]) > 64 * U;

/** 최신 스냅 n 이 직전 pv 에서 움직인 속도로 EXTRAP 틱 뒤의 가상 스냅을 만든다(이산 값은 n 그대로, 이벤트 없음) */
function virtual(n, pv) {
  const df = n.f - (pv?.f ?? n.f);
  if (!pv || df <= 0) return n;
  const ex = (c, o, same) => {
    const q = c.slice(0, 3);
    if (!same || far(c, o)) return q;
    for (let i = 0; i < 3; i++) q[i] = c[i] + (c[i] - o[i]) / df * EXTRAP;
    q[2] = Math.max(0, q[2]);
    return q;
  };
  const p = n.p.map((c, i) => { const o = pv.p[i]; const e = o ? ex(c, o, c[3] === o[3]) : c; const r = c.slice(); r[0] = e[0]; r[1] = e[1]; r[2] = e[2]; return r; });
  const bb = n.b.slice(); const eb = ex(n.b, pv.b, n.b[3] === pv.b[3] && n.b[4] === pv.b[4]); bb[0] = eb[0]; bb[1] = eb[1]; bb[2] = eb[2];
  return { ...n, f: n.f + EXTRAP, p, b: bb, ev: [] };
}

export class SnapBuffer {
  /** @param {string|object} [profile] PROFILES 의 이름 또는 같은 모양의 객체. 없으면 DEFAULT_PROFILE */
  constructor(profile) {
    this.P = (typeof profile === 'object' && profile) || PROFILES[profile] || PROFILES[DEFAULT_PROFILE];
    this.list = []; this.tick = null; this.last = 0; this._frozen = false;
    this.delay = DELAY_INIT; // 현재 재생 지연(틱, 소수)
    this.reset();
  }

  reset() { this.base = null; this.bMin = Infinity; this.bPrev = Infinity; this.bAt = 0; this.lagAvg = null; this.lagDev = 0.5; this.heldAt = -Infinity; this.virt = null; this.rebase = false; this.bigs = []; this.wasBig = false; this.lateMin = Infinity; this.lateAt = 0; }

  get frozen() { return this._frozen; }
  set frozen(v) { if (this._frozen && !v) this.rebase = true; this._frozen = !!v; } // 일시정지 해제 뒤 첫 스냅에서 시계 기준을 다시 잡는다

  /** nowMs = 도착 시각(performance.now). 생략하면 지금 */
  push(s, nowMs = performance.now()) {
    const l = this.list;
    if (l.length && s.f <= l[l.length - 1].f) { l.length = 0; this.tick = null; this.reset(); } // 재접속 등으로 틱이 되감기면 초기화
    l.push(s);
    if (l.length > MAX) l.shift();
    this.virt = null;
    // 도착 시계 추정: off = 도착 시각 - 서버 틱 시각. 가장 작은 값(약 5~10초 창)이 최소 지연 기준, 거기서 얼마나 늦었는지가 지터
    const off = nowMs - s.f * TICK_MS;
    if (this.rebase || this.base === null || off - this.base > REBASE_MS) {
      this.rebase = false; this.base = off; this.bMin = off; this.bPrev = Infinity; this.bAt = nowMs; this.lagAvg = null;
    } else {
      if (nowMs - this.bAt > BUCKET_MS) { this.bPrev = this.bMin; this.bMin = Infinity; this.bAt = nowMs; }
      if (off < this.bMin) this.bMin = off;
      this.base = Math.min(this.bMin, this.bPrev);
    }
    let late = Math.max(0, off - this.base);
    // 시계 밀림: 서버가 밀린 틱을 버리면(긴 멈춤 뒤) 그 뒤 스냅이 전부 같은 만큼 늦게 보인다. 가장 덜 늦은 값만큼 기준을 옮긴다
    if (late < this.lateMin) this.lateMin = late;
    if (nowMs - this.lateAt > STALE_MS) {
      const d = this.lateMin;
      if (d > STALE_TICKS * TICK_MS && d < Infinity) { this.base += d; this.bMin += d; this.bPrev += d; late -= d; }
      this.lateMin = Infinity; this.lateAt = nowMs;
    }
    // 큰 늦음(DELAY_SOFT 로 못 덮는 늦음)의 시작 시각을 모은다. BIG_WIN_MS 안에 need 번이면 sample 이 상한을 DELAY_MAX 로 연다
    const big = late / TICK_MS + 0.5 > DELAY_SOFT, bg = this.bigs;
    if (big && !this.wasBig && nowMs - (bg[bg.length - 1] ?? -Infinity) > BIG_GAP_MS) { bg.push(nowMs); if (bg.length > 8) bg.shift(); }
    this.wasBig = big;
  }

  /** 재생 지연 조절(그릴 때마다). lag = 지금 서버 시계(추정) - 최신 스냅 틱 = 스냅 늦음 + 그리는 순간까지 지난 시간 */
  tune(nowMs, dt, lag) {
    const P = this.P, bg = this.bigs;
    if (this.lagAvg === null) { this.lagAvg = Math.max(0, lag); this.lagDev = 0.5; }
    const x = Math.max(0, Math.min(lag, this.lagAvg + 3)), a = 1 - Math.exp(-dt / STAT_TAU_MS); // 큰 늦음 한 번이 통계를 끌고 가지 않게 자른다
    this.lagAvg += (x - this.lagAvg) * a; this.lagDev += (Math.abs(x - this.lagAvg) - this.lagDev) * a;
    const cap = bg.length >= P.need && nowMs - bg[bg.length - P.need] < BIG_WIN_MS ? DELAY_MAX : DELAY_SOFT;
    const target = Math.max(P.min, Math.min(cap, this.lagAvg + P.k * this.lagDev + P.guard));
    if (lag - this.delay > ATTACK) { this.delay = Math.max(this.delay, Math.min(cap, lag + P.guard)); this.heldAt = nowMs; } // 크게 모자람: 바로 올리고 잠깐 붙든다
    else if (target > this.delay) this.delay = Math.min(target, this.delay + UP_RATE * dt / 1000);
    else if (nowMs - this.heldAt > P.hold) this.delay = Math.max(target, this.delay - P.down * dt / 1000);
    if (this.delay > cap) this.delay = Math.max(cap, this.delay - P.down * dt / 1000); // 상한이 닫히면 내려온다
  }

  latest() { return this.list[this.list.length - 1] ?? null; }

  /** 렌더 틱을 진행시키고 보간된 상태를 돌려준다 */
  sample(nowMs) {
    const l = this.list;
    if (!l.length) return null;
    const newest = l[l.length - 1];
    const dt = this.last ? Math.min(100, nowMs - this.last) : 0;
    this.last = nowMs;
    if (!this.frozen && !this.rebase && dt > 0) this.tune(nowMs, dt, (nowMs - this.base) / TICK_MS - newest.f);
    const ideal = (nowMs - this.base) / TICK_MS - this.delay; // 지금 그려야 할 서버 틱(지연 반영)
    // 멈춘 동안(일시정지·결과 화면)과 그 뒤 시계 기준을 다시 잡기 전에는 바로 맞추지 않는다(종전: 멈춘 채 시간이 흘러 그림이 앞으로 튀었다)
    if (this.tick === null || (!this.frozen && !this.rebase && Math.abs(ideal - this.tick) > JUMP)) this.tick = ideal;
    else if (this.frozen) this.tick = Math.max(this.tick, Math.min(newest.f, this.tick + dt / TICK_MS)); // 받아 둔 스냅까지만 마저 그리고 선다(외삽 없음)
    else {
      const step = dt / TICK_MS;
      // 목표로 천천히 맞춘다(뒤로 가지 않고, 0.25~2배속). 차이는 이번 프레임만큼 나아간 뒤의 값으로 잰다
      // (종전: 나아가기 전 값으로 재서 늘 한 프레임 앞섰다 = 60Hz 에서 지연이 1틱 모자랐다). 당기는 세기는 지난 시간 기준이라 주사율과 무관
      let adv = Math.max(step * 0.25, Math.min(step * 2, step + (ideal - (this.tick + step)) * (1 - Math.exp(-dt / TAU_MS))));
      const over = (this.tick - newest.f) / EXTRAP; // 최신 스냅을 지난 정도(0~1)
      if (over > 0) adv *= Math.max(0, 1 - over * over); // 외삽 구간은 갈수록 느리게: 한도에서 뚝 멈추지 않고 서서히 선다
      this.tick += adv;
    }
    this.tick = Math.min(this.tick, newest.f + EXTRAP);
    let ia = -1;
    for (let i = 0; i < l.length; i++) if (l[i].f <= this.tick) ia = i;
    let a, b, t;
    if (ia < 0) { a = b = l[0]; t = 0; }
    else if (ia === l.length - 1) { // 최신 스냅을 지났다: 짧은 외삽
      a = newest;
      this.virt ??= virtual(newest, l[l.length - 2]);
      b = this.virt; t = b.f > a.f ? Math.min(1, (this.tick - a.f) / (b.f - a.f)) : 0;
    } else { a = l[ia]; b = l[ia + 1]; t = Math.max(0, Math.min(1, (this.tick - a.f) / (b.f - a.f))); }
    // a0/b1: 곡선 보간용 앞뒤 스냅(없으면 a/b)
    return { a, b, t, tick: this.tick, a0: l[ia - 1] ?? a, b1: l[ia + 2] ?? b };
  }
}

const L = (p, q, t) => p + (q - p) * t;

/** 보간된 위치 (px). 순간이동(64px 초과)은 보간하지 않는다 */
export function lerpPos(pa, pb, t) {
  if (!pb) return [pa[0] / U, pa[1] / U, pa[2] / U];
  if (Math.abs(pa[0] - pb[0]) > 64 * U || Math.abs(pa[1] - pb[1]) > 64 * U) return t < 0.5 ? [pa[0] / U, pa[1] / U, pa[2] / U] : [pb[0] / U, pb[1] / U, pb[2] / U];
  return [L(pa[0], pb[0], t) / U, L(pa[1], pb[1], t) / U, L(pa[2], pb[2], t) / U];
}

/** Catmull-Rom 곡선 보간(px). 원운동처럼 스냅 사이가 꺾이는 궤적용. 이웃 스냅과 64px 넘게 떨어지면 선형으로 */
export function splinePos(p0, pa, pb, p1, t) {
  const far = (p, q) => Math.abs(p[0] - q[0]) > 64 * U || Math.abs(p[1] - q[1]) > 64 * U || Math.abs(p[2] - q[2]) > 64 * U;
  if (!p0 || !p1 || far(p0, pa) || far(pa, pb) || far(pb, p1)) return lerpPos(pa, pb, t);
  const t2 = t * t, t3 = t2 * t;
  const c = (i) => 0.5 * (2 * pa[i] + (pb[i] - p0[i]) * t + (2 * p0[i] - 5 * pa[i] + 4 * pb[i] - p1[i]) * t2 + (3 * pa[i] - p0[i] - 3 * pb[i] + p1[i]) * t3) / U;
  return [c(0), c(1), Math.max(0, c(2))];
}
