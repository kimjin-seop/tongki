// 스냅샷 버퍼 + 단순 선형 보간 (60Hz 스냅샷 → 렌더). 서버 상태가 정본, 로컬 예측 없음.
// 입력→화면 지연(analysis/21 §6): 종전 30Hz 스냅 + 3틱 지연 = 평균 약 75ms(4.5프레임) → 60Hz 스냅 + 1틱 지연 = 평균 약 33ms(2프레임). 원작은 1프레임
const DELAY_TICKS = 1; // 최신 스냅샷보다 1틱(약 17ms) 뒤를 그린다(스냅 간격 1틱)
const MAX = 12;
export const U = 16; // 좌표 단위: 1/16 px

export class SnapBuffer {
  constructor() { this.list = []; this.tick = null; this.last = 0; this.frozen = false; }

  push(s) {
    const l = this.list;
    if (l.length && s.f <= l[l.length - 1].f) { l.length = 0; this.tick = null; } // 재접속 등으로 틱이 되감기면 초기화
    l.push(s);
    if (l.length > MAX) l.shift();
  }

  latest() { return this.list[this.list.length - 1] ?? null; }

  /** 렌더 틱을 진행시키고 보간된 상태를 돌려준다 */
  sample(nowMs) {
    const l = this.list;
    if (!l.length) return null;
    const newest = l[l.length - 1];
    const dt = this.last ? Math.min(100, nowMs - this.last) : 0;
    this.last = nowMs;
    const target = newest.f - DELAY_TICKS;
    if (this.tick === null || Math.abs(this.tick - target) > 10) this.tick = target;
    else if (!this.frozen) this.tick += dt * 0.06 + (target - this.tick) * 0.05;
    this.tick = Math.min(this.tick, newest.f);
    let a = l[0], b = l[0], ia = 0;
    for (let i = 0; i < l.length; i++) {
      if (l[i].f <= this.tick) { a = l[i]; b = l[i + 1] ?? l[i]; ia = i; }
    }
    const t = b.f > a.f ? Math.max(0, Math.min(1, (this.tick - a.f) / (b.f - a.f))) : 0;
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
