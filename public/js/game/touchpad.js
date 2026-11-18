// 터치 기기(pointer:coarse) 경기용 가상 조작: 왼쪽 방향 패드(8방향) + 오른쪽 B·C·A 버튼 + 작은 F(포메이션) 버튼.
// Pointer Events 로 손가락(pointerId)마다 따로 추적해 멀티터치(이동하면서 버튼)를 지원한다.
// 눌림 비트(PROTOCOL 5.2)만 InputSender.setTouch 로 넘기고, 엣지·대시 판정은 서버 몫.
import { h } from '../util.js';
import { BIT } from './input.js';

export const COARSE_MQ = '(pointer: coarse)';

// atan2 기준 45도 구간(0=오른쪽, 시계방향: 화면 y 아래가 +)
const SECTOR = [BIT.RIGHT, BIT.RIGHT | BIT.DOWN, BIT.DOWN, BIT.DOWN | BIT.LEFT, BIT.LEFT, BIT.LEFT | BIT.UP, BIT.UP, BIT.UP | BIT.RIGHT];
const DEAD = 0.2; // 패드 반지름 대비 무입력 반경
const BTN_SLOP = 10; // 버튼 사이로 손가락을 미끄러뜨릴 때 허용 여백(px)

export class TouchPad {
  /** @param {(bits:number)=>void} onBits @param {{training?:boolean}} [o] 캐치 특훈: A 도 던지기, F(포메이션) 없음(PROTOCOL §9.1) */
  constructor(onBits, { training = false } = {}) {
    this.onBits = onBits; this.bits = 0;
    /** @type {Map<number, {zone:'dir'|'btn', bits:number}>} */
    this.ptrs = new Map();
    this.knob = h('div.tp-knob');
    this.dir = h('div.tp-dir', { 'aria-hidden': 'true' },
      h('div.tp-arrow.u'), h('div.tp-arrow.d'), h('div.tp-arrow.l'), h('div.tp-arrow.r'), this.knob);
    const btn = (cls, bit, label, cap) => {
      const el = h('div.tp-btn.' + cls, h('b', label), h('small', cap));
      el.dataset.bit = bit; return el;
    };
    this.btnEls = [btn('a', BIT.A, 'A', training ? '던지기' : '패스'), btn('c', BIT.C, 'C', '점프'), btn('b', BIT.B, 'B', '던지기')];
    if (!training) this.btnEls.push(btn('f', BIT.S, 'F', '')); // F = 포메이션(5.6)
    this.btns = h('div.tp-btns', { 'aria-hidden': 'true' }, this.btnEls);
    this.el = h('div.tpad', this.dir, this.btns);
    for (const [zone, el] of [['dir', this.dir], ['btn', this.btns]]) {
      el.addEventListener('pointerdown', (e) => this.down(e, zone, el));
      el.addEventListener('pointermove', (e) => this.move(e));
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, (e) => this.up(e));
    }
  }

  down(e, zone, el) {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* 이미 해제된 포인터 */ }
    this.ptrs.set(e.pointerId, { zone, bits: 0 });
    this.move(e);
  }

  move(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    p.bits = p.zone === 'dir' ? this.dirBits(e.clientX, e.clientY) : this.btnBits(e.clientX, e.clientY);
    this.emit();
  }

  up(e) {
    if (!this.ptrs.delete(e.pointerId)) return;
    if (![...this.ptrs.values()].some((p) => p.zone === 'dir')) this.knob.style.translate = '';
    this.emit();
  }

  dirBits(x, y) {
    const r = this.dir.getBoundingClientRect(), rad = r.width / 2;
    const dx = x - (r.left + rad), dy = y - (r.top + r.height / 2), d = Math.hypot(dx, dy);
    const m = Math.min(d, rad * 0.45) / (d || 1);
    this.knob.style.translate = `${Math.round(dx * m)}px ${Math.round(dy * m)}px`;
    if (d < rad * DEAD) return 0;
    return SECTOR[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
  }

  btnBits(x, y) {
    let best = 0, bestD = Infinity;
    for (const el of this.btnEls) {
      const r = el.getBoundingClientRect();
      if (x < r.left - BTN_SLOP || x > r.right + BTN_SLOP || y < r.top - BTN_SLOP || y > r.bottom + BTN_SLOP) continue;
      const d = Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2);
      if (d < bestD) { bestD = d; best = +el.dataset.bit; }
    }
    return best;
  }

  emit() {
    let b = 0;
    for (const p of this.ptrs.values()) b |= p.bits;
    if (b === this.bits) return;
    this.bits = b;
    for (const el of this.btnEls) el.classList.toggle('on', !!(b & +el.dataset.bit));
    this.dir.dataset.on = [b & BIT.UP && 'u', b & BIT.DOWN && 'd', b & BIT.LEFT && 'l', b & BIT.RIGHT && 'r'].filter(Boolean).join('');
    this.onBits(b);
  }

  reset() { this.ptrs.clear(); this.knob.style.translate = ''; this.emit(); }
}
