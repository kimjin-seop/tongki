// 스토리 진입 내레이션 컷(원작 'はじめから' 직후 일러스트 + 내레이션). 사양·근거: analysis/12_story_cuts.md
// 데이터: /assets/rom/story/story_cuts.json (manifest 와 별개, 컷 목록·한국어 내레이션·원작 타이밍).
// 화면: 398x224 논리 해상도(intro.js 와 같은 16:9 와이드). 그림은 원작 256x96, 원작 좌표 (32,32)를 가운데 320 영역 기준으로 배치.
// 타이밍(60fps 프레임): 컷 시작 페이드인 → 페이지 유지(hold) → [페이지 교체: 글자만 페이드아웃·검정·페이드인] → 마지막 페이지 뒤 그림·글자 페이드아웃.
// BGM 은 연결하지 않는다(키 bgm.story_cut 만 데이터에 두고 has() 가 참일 때만 재생).
import { h, $, fitScale } from './util.js';
import { has } from './game/assets.js';
import { imageAt } from './game/assets.js';
import { dotMask, dotCanvas } from './game/dottext.js';

const W = 398, H = 224, BW = 320, DW = (W - BW) / 2, TICK = 1000 / 60;
const SEEN_KEY = 'dd.storyCutSeen';
const DATA_URL = '/assets/rom/story/story_cuts.json';
const TEXT_H = 11, FONT = '"DD UI", sans-serif';
let dataP = null;

const load = () => (dataP ??= fetch(DATA_URL).then((r) => { if (!r.ok) throw new Error('story_cuts ' + r.status); return r.json(); }).catch((e) => { dataP = null; throw e; }));

export function storyCutSeen() { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } }
function markSeen() { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* 저장 불가: 매번 재생 */ } }

/** 한 컷의 프레임 구간표. 반환: {segs:[{t0,t1,page,imgK,txtK,kind}], total, holdEnds:[page 별 hold 끝 프레임]} */
export function cutPlan(cut, tm) {
  if (cut.card) { // 제목 카드: 줄마다 원작 실측 페이드 시점(카드 시작 = 첫 줄 페이드인 시작 프레임)
    const total = Math.max(...cut.card.lines.map((l) => l.out[0] + l.out[1]));
    return { card: cut.card, total, segs: [{ t0: 0, t1: total, page: 0 }], holdEnds: [] };
  }
  const { hold, inFade, imgIn, txtLead, outFade, black, gap } = tm;
  const pages = cut.pages.length;
  const segs = []; const holdEnds = [];
  let t = 0;
  // 시작: 그림 imgIn 프레임 페이드인, 글자는 txtLead 뒤부터 inFade 프레임
  segs.push({ t0: t, t1: t + imgIn, page: 0, img: ['in', t, imgIn], txt: ['in', t + txtLead, inFade] });
  t += imgIn;
  for (let p = 0; p < pages; p++) {
    segs.push({ t0: t, t1: t + hold, page: p, img: ['on'], txt: ['on'] });
    t += hold; holdEnds.push(t);
    if (p < pages - 1) {
      segs.push({ t0: t, t1: t + outFade, page: p, img: ['on'], txt: ['out', t, outFade] }); t += outFade;
      segs.push({ t0: t, t1: t + black, page: p + 1, img: ['on'], txt: ['off'] }); t += black;
      segs.push({ t0: t, t1: t + inFade, page: p + 1, img: ['on'], txt: ['in', t, inFade] }); t += inFade;
    } else {
      segs.push({ t0: t, t1: t + outFade, page: p, img: ['out', t, outFade], txt: ['out', t, outFade] }); t += outFade;
      segs.push({ t0: t, t1: t + gap, page: p, img: ['off'], txt: ['off'] }); t += gap;
    }
  }
  return { segs, total: t, holdEnds };
}

/** 페이드 상태 → 밝기 0~1 (원작 팔레트 페이드처럼 7단계) */
export function level(spec, t, steps = 7) {
  const [m, s, n] = spec;
  if (m === 'on') return 1;
  if (m === 'off') return 0;
  const k = Math.max(0, Math.min(1, (t - s) / n));
  const v = m === 'in' ? k : 1 - k;
  return Math.round(v * steps) / steps;
}

/**
 * 스토리 컷 재생. cuts 는 데이터의 컷 id 배열(생략 시 전체).
 * @param {{onEnd?:()=>void, ids?:string[]}} o
 */
export function start({ onEnd, ids } = {}) {
  const canvas = h('canvas.intro-canvas', { width: W, height: H, 'aria-hidden': 'true' });
  const coarse = matchMedia?.('(pointer: coarse)').matches;
  const hint = h('div.intro-hint', coarse ? '눌러서 넘기기 · 길게 눌러 건너뛰기' : '아무 키나 눌러 넘기기 · Esc 건너뛰기');
  const overlay = h('div#storycut', { role: 'presentation' }, canvas, hint);
  document.body.append(overlay);
  document.body.dataset.storycut = 'play';
  const appRoot = $('#app');
  if (appRoot) appRoot.inert = true;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const fit = () => { const s = fitScale(innerWidth, innerHeight, W, H); canvas.style.width = s.cw + 'px'; canvas.style.height = s.ch + 'px'; };
  fit(); addEventListener('resize', fit);

  let D = null, plans = [], imgs = new Map(), txtCache = new Map();
  let ci = 0, t = 0, acc = 0, last = 0, raf = 0, state = 'load', gapT = 0, longTimer = 0;

  const textCanvas = (s, hh = TEXT_H) => { const k = hh + s; if (!txtCache.has(k)) txtCache.set(k, dotCanvas(dotMask(s, { h: hh, font: FONT, th: 0.55, ct: 0.65, maxW: BW - 24 }), { fill: '#fcfcfc' })); return txtCache.get(k); };

  function segAt(plan, tt) { return plan.segs.find((s) => tt >= s.t0 && tt < s.t1) ?? plan.segs[plan.segs.length - 1]; }
  function dim(k) { if (k < 1) { g.globalAlpha = 1 - k; g.fillStyle = '#000'; return true; } return false; }

  function draw() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (state !== 'play') return;
    const cut = D.cuts[ci], plan = plans[ci], sg = segAt(plan, t);
    if (plan.card) {
      g.translate(DW, 0);
      cut.pages[0].ko.forEach((str, i) => {
        const ln = plan.card.lines[i], k = t >= ln.out[0] ? level(['out', ln.out[0], ln.out[1]], t, D.timing.steps) : level(['in', ln.in[0], ln.in[1]], t, D.timing.steps);
        const c = textCanvas(str, cut.textH);
        g.globalAlpha = k; g.drawImage(c, Math.round((BW - c.width) / 2), cut.textY[i]); g.globalAlpha = 1;
      });
      return;
    }
    const ik = level(sg.img, t, D.timing.steps), tk = level(sg.txt, t, D.timing.steps);
    g.translate(DW, 0);
    if (cut.image && imgs.get(cut.id)) {
      const im = imgs.get(cut.id), [x, y] = D.imageAt;
      g.drawImage(im, x, y);
      if (dim(ik)) { g.fillRect(x, y, im.width, im.height); g.globalAlpha = 1; }
    }
    const lines = cut.pages[sg.page].ko;
    lines.forEach((s, i) => {
      if (!s) return;
      const c = textCanvas(s, cut.textH), y = (cut.textY ?? D.textY)[i] ?? D.textY[i];
      const x = Math.round((BW - c.width) / 2);
      g.globalAlpha = tk; g.drawImage(c, x, y); g.globalAlpha = 1;
    });
  }

  function tick(now) {
    if (state !== 'play') return;
    acc += Math.min(100, now - last); last = now;
    while (acc >= TICK) {
      acc -= TICK; t++;
      if (t >= plans[ci].total) { ci++; t = 0; if (ci >= D.cuts.length) { finish(); return; } }
    }
    draw();
    raf = requestAnimationFrame(tick);
  }

  /** 현재 페이지 hold 를 건너뛰어 다음 글자 전환(또는 컷 끝)으로. 이미 전환 중이면 그 구간을 끝까지 */
  function advance() {
    if (state !== 'play') return;
    const plan = plans[ci], sg = segAt(plan, t);
    if (plan.card) { const o = Math.min(...plan.card.lines.map((l) => l.out[0])); t = t < o ? o : plan.total - 1; return; }
    const he = plan.holdEnds.find((e) => e > t);
    if (sg.txt[0] === 'on' && he != null && t < he - 1) t = he - 1;
    else if (sg.t1 - 1 > t) t = sg.t1 - 1;
  }
  function finish() {
    if (state === 'done') return;
    state = 'done';
    cancelAnimationFrame(raf);
    clearTimeout(longTimer);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', fit);
    overlay.remove();
    if (appRoot) appRoot.inert = false;
    delete document.body.dataset.storycut;
    markSeen();
    onEnd?.();
  }
  function onKey(e) {
    if (state === 'done') return;
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    if (e.key === 'Escape') finish(); else advance();
  }
  addEventListener('keydown', onKey, true);
  overlay.addEventListener('pointerdown', (e) => { e.preventDefault(); longTimer = setTimeout(finish, 700); advance(); });
  overlay.addEventListener('pointerup', () => clearTimeout(longTimer));
  overlay.addEventListener('pointercancel', () => clearTimeout(longTimer));

  load().then(async (d) => {
    D = { ...d, cuts: ids ? d.cuts.filter((c) => ids.includes(c.id)) : d.cuts };
    if (!D.cuts.length) throw new Error('story cuts 없음');
    await Promise.all(D.cuts.filter((c) => c.image).map((c) => imageAt(c.image).then((im) => imgs.set(c.id, im))));
    plans = D.cuts.map((c) => cutPlan(c, { ...D.timing, ...(c.timing ?? {}) }));
    if (state !== 'load') return;
    state = 'play'; last = performance.now(); draw();
    raf = requestAnimationFrame(tick);
  }).catch((e) => { console.warn('story_cut', e.message); finish(); });

  return { get active() { return state !== 'done'; }, get state() { return state; }, get cut() { return D?.cuts[ci]?.id ?? null; }, get frame() { return t; },
    skip: finish, advance, pause(v = true) { if (v) { cancelAnimationFrame(raf); } else { last = performance.now(); raf = requestAnimationFrame(tick); } },
    seek(c, f = 0) { if (state !== 'play') return; ci = Math.max(0, Math.min(D.cuts.length - 1, c | 0)); t = Math.max(0, f | 0); draw(); } };
}
