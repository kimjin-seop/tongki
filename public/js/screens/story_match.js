// 맞대면(서브 7) 끝 전환과 장면 페이드. 근거 analysis/53 §2-2(0x125D8~0x12670)·§1-3(승리 끝 페이드 약 32f).
import { level } from '../story_cut.js';

const TICK = 1000 / 60;
const STEPS = 7;
export const FACEOFF_FADE_IN = 8; // 맞대면 진입 8f 페이드 인(0x125A4~0x125C0, 막힘형)
export const SCROLL_F = 32; // 끝 전환 32프레임: VSRAM −32 → 0(1px/f), 위 띠 −1px/f, 아래 띠 +3px/f
export const BAND_Y = 136; // 아래 검은 띠 시작 = 창 영역 y≥136(레지스터 0x12=0x91, 48 §2-2)
export const WIN_FADE_OUT = 32; // 승리 끝 화면 전체 페이드 아웃 약 32f(53 §1-3, 0x12792~0x127D4)

/** 60fps 고정 틱으로 n 프레임 동안 f(t) 를 부른 뒤 done. 반환 = 멈춤 함수 */
export function frames(n, f, done) {
  let t = 0, acc = 0, last = performance.now(), raf = 0, stopped = false;
  const tick = (now) => {
    if (stopped) return;
    acc += Math.min(100, now - last); last = now;
    while (acc >= TICK) { acc -= TICK; f(t); if (++t >= n) { stopped = true; done?.(); return; } }
    raf = requestAnimationFrame(tick);
  };
  f(0); raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

/**
 * 맞대면 끝: 창·초상 끔(box 숨김) → 32f 동안 코트가 32px 올라가며(--sy 32→0) 아래 검은 띠가 3px/f 로 내려가 열린다 → done(경기 시작).
 * 곡 0xE0 페이드는 부르는 쪽(블록 끝 버튼 시점).
 */
export function faceoffEnd({ sc, box, band, done }) {
  box.hidden = true;
  band.hidden = false;
  return frames(SCROLL_F, (t) => {
    sc.style.setProperty('--sy', String(SCROLL_F - (t + 1)));
    band.style.setProperty('--by', String(BAND_Y + 3 * (t + 1)));
  }, done);
}

/** 화면 전체 페이드(검정 막). dir 'in' = 검정에서 밝아짐, 'out' = 검정으로. 팔레트 7단계 */
export function screenFade(el, dir, n, done) {
  el.hidden = false;
  return frames(n, (t) => {
    const k = level([dir, 0, n], t + 1, STEPS);
    el.style.opacity = String(1 - k);
  }, () => { if (dir === 'in') el.hidden = true; done?.(); });
}
