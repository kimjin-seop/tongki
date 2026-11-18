// 키보드 → 입력 비트 (PROTOCOL 5.2). 상태가 바뀌면 즉시 전송, 눌린 채 유지되면 250ms 마다 재전송.
// 엣지·더블탭 대시·조준 그룹 판정은 서버가 한다. 여기서는 눌림 상태만 정확히 보낸다.
import { isTyping } from '../util.js';

export const BIT = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, B: 16, C: 32, A: 64, S: 128 };
const KEYMAP = {
  ArrowUp: BIT.UP, ArrowDown: BIT.DOWN, ArrowLeft: BIT.LEFT, ArrowRight: BIT.RIGHT,
  // A 줍기·패스·웅크림 / S 캐치·던지기·차지 / D 점프 / F 포메이션(S 비트, PROTOCOL 5.6)
  KeyA: BIT.A, KeyS: BIT.B, KeyD: BIT.C, KeyF: BIT.S,
};
const RESEND_MS = 250;

export class InputSender {
  /** @param {(bits:number)=>void} send */
  constructor(send) {
    this.send = send; this.bits = 0; this.enabled = true; this.lastSent = 0;
    this.down = new Set();
    this.touchBits = 0; // 터치 가상 패드(touchpad.js)가 넣는 눌림 비트. 키보드와 OR
    this.onKey = (e) => {
      const b = KEYMAP[e.code];
      if (!b) return;
      if (e.type === 'keyup') { if (this.down.delete(e.code)) { e.preventDefault(); this.update(); } return; }
      // 입력칸 타이핑·브라우저 단축키(Ctrl+F 찾기, Ctrl+S 등)는 가로채지 않는다(A/S/D/F 는 글자·단축키와 겹침)
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      this.down.add(e.code);
      this.update();
    };
    this.onBlur = () => { this.down.clear(); this.update(); };
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    addEventListener('blur', this.onBlur);
    this.timer = setInterval(() => {
      if (this.bits && this.enabled && performance.now() - this.lastSent >= RESEND_MS - 5) this.flush();
    }, 50);
  }

  update() {
    let b = 0;
    for (const c of this.down) b |= KEYMAP[c];
    b |= this.touchBits;
    if (!this.enabled) b = 0;
    if (b !== this.bits) { this.bits = b; this.flush(); }
  }

  /** 가상 패드 눌림 상태 갱신(키보드와 합쳐 같은 경로로 전송) */
  setTouch(bits) { this.touchBits = bits; this.update(); }

  flush() { this.lastSent = performance.now(); this.send(this.bits); }

  setEnabled(on) { this.enabled = on; if (!on) this.down.clear(); this.update(); }

  destroy() {
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    removeEventListener('blur', this.onBlur);
    clearInterval(this.timer);
  }
}
