// 스토리 엔딩 그림(서브 12, 0x12CCE~0x12DA6). 근거 analysis/53 §3-3.
// 0x92 시작 → 페이드 인 64f → 유지 481f → 페이드 아웃 64f. 버튼 검사 없음(넘김 불가). 글자 없음.
// 스태프 롤(서브 21)은 근거 부족(53 §3-4)이라 넣지 않는다 → 끝나면 onEnd(챕터 목록).
import { h, fitScale } from '../util.js';
import { imageAt } from '../game/assets.js';
import { level } from '../story_cut.js';

export const ENDING_BGM_KEY = 'bgm.story.ending'; // 0x92(manifest 미등록이면 audio 가 무음 처리)
const IMG = 'rom/story/ending_01.png'; // 320x224 캔버스, 그림 (32,32) 248x128(story_extras.json ending_01)
const W = 398, H = 224, BW = 320, DW = (W - BW) / 2, TICK = 1000 / 60;
const FADE_IN = 64, HOLD = 481, FADE_OUT = 64, STEPS = 7;

/** @param {{root:HTMLElement, onStart?:()=>void, onEnd:()=>void}} o */
export function playEnding(o) {
  const canvas = h('canvas.intro-canvas', { width: W, height: H, 'aria-hidden': 'true' });
  const wrap = h('div.story-intro-card.story-end', canvas);
  o.root.append(wrap);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const fit = () => { const s = fitScale(innerWidth, innerHeight, W, H); canvas.style.width = s.cw + 'px'; canvas.style.height = s.ch + 'px'; };
  fit(); addEventListener('resize', fit);
  const total = FADE_IN + HOLD + FADE_OUT;
  let img = null, t = 0, acc = 0, last = 0, raf = 0, state = 'load';
  function draw() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (!img) return;
    const k = t < FADE_IN ? level(['in', 0, FADE_IN], t, STEPS) : t < FADE_IN + HOLD ? 1 : level(['out', FADE_IN + HOLD, FADE_OUT], t, STEPS);
    g.drawImage(img, DW, 0);
    if (k < 1) { g.globalAlpha = 1 - k; g.fillStyle = '#000'; g.fillRect(DW, 0, BW, H); g.globalAlpha = 1; }
  }
  function tick(now) {
    if (state !== 'play') return;
    acc += Math.min(100, now - last); last = now;
    while (acc >= TICK) { acc -= TICK; t++; if (t >= total) { draw(); finish(); return; } }
    draw();
    raf = requestAnimationFrame(tick);
  }
  function finish() {
    if (state === 'done') return;
    state = 'done';
    cancelAnimationFrame(raf);
    removeEventListener('resize', fit);
    wrap.remove();
    o.onEnd?.();
  }
  imageAt(IMG).then((im) => {
    if (state !== 'load') return;
    img = im; state = 'play'; last = performance.now();
    o.onStart?.();
    draw(); raf = requestAnimationFrame(tick);
  }).catch((e) => { console.warn('story_end', e.message); finish(); });
  window.__storyEnd = { get t() { return t; }, get state() { return state; } };
  return { stop() { if (state === 'done') return; o.onEnd = null; finish(); }, get state() { return state; } };
}
