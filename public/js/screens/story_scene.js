// 스토리 대사 장면 엔진(경기 전·맞대면·경기 후 공통, 원작 대사 루틴 0x1205C~0x1236C).
// story_intro.js 의 runScene 을 일반화: 세그먼트별 오른쪽 그림(상대 초상 / 3전 팀 그림 / 15전 엄마 그림), 입 슬롯 $CA80, 시작 페이드 인.
// 근거: analysis/48 §2-2·§10-2·§10-3, analysis/53 §1-2(입 슬롯)·§2-1(맞대면 8f 페이드 인)·§3-1(팀 그림 8f/8f)·§3-2(엄마 32f).
import { imageAt } from '../game/assets.js';
import { level } from '../story_cut.js';
import { pageSteps } from './story_intro.js';

const PORT_URL = '/assets/rom/story/portraits.json', PORT_IMG = 'rom/story/portraits.png';
const EXTRA_URL = '/assets/rom/story/story_extras.json', EXTRA_IMG = 'rom/story/story_extras.png';
const TICK = 1000 / 60;
const MOUTH_HOLD = 5; // 2칸 x 5f(48 §10-3). 팀 그림·엄마도 대기 4 = 5f(story_extras.json anim.hold)
const BLINK_HOLD = 3;
const STEPS = 7; // 팔레트 페이드 단계(story_cut level 과 같은 7단계)

/** 화자 id → 타이핑음(표 0x7528A, 48 §2-2) */
export const sfxOf = (id) => (id === 0x00 ? 'sfx.story.type_b6' : id === 0x16 ? null : [0x0E, 0x10, 0x15].includes(id) ? 'sfx.story.type_a8' : 'sfx.story.type_a7');
/** 화자 id → 켜는 입 슬롯(0x1230C, 53 §1-2): L = $C700(통키), R = $C800(오른쪽), X = $CA80(엄마·팀 그림 둘째 입). 0x13(모두) = $C800+$CA80 */
export const slotOf = (id) => (id === 0x00 ? 'L' : id === 0x10 || id === 0x12 ? 'X' : id === 0x13 ? 'RX' : 'R');
const isSyl = (c) => c >= '가' && c <= '힣';

let portP = null, extraP = null;
const getJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
const loadPortraits = () => (portP ??= Promise.all([getJson(PORT_URL), imageAt(PORT_IMG)]).then(([meta, img]) => ({ meta, img })).catch((e) => { portP = null; throw e; }));
const loadExtras = () => (extraP ??= Promise.all([getJson(EXTRA_URL), imageAt(EXTRA_IMG)]).then(([meta, img]) => ({ meta, img })).catch((e) => { extraP = null; throw e; }));

/**
 * 오른쪽 그림 지정(세그먼트마다). 경기 전 = portraits.json matches[k].right, 맞대면·경기 후 k=14 = taiga_15(53 §1-2·§2-1),
 * 경기 후 이어지는 세그먼트 = 3전 팀 그림 / 15전 엄마 그림(53 §3).
 * @returns {{portrait:string|null, extra?:'team3'|'mom15'}[]}
 */
export function rightPlan(meta, k, kind, nSeg) {
  const base = meta?.matches?.find((m) => m.k === k)?.right ?? [];
  if (kind === 'pre') return Array.from({ length: nSeg }, (_, i) => ({ portrait: (base[i] ?? base[0])?.portrait ?? null }));
  const opp = k === 14 ? 'taiga_15' : base[0]?.portrait ?? null;
  return Array.from({ length: nSeg }, (_, i) => {
    if (kind === 'win' && i === 1 && k === 2) return { portrait: null, extra: 'team3' }; // 오른쪽 상대 초상($C900) 끔
    if (kind === 'win' && i === 1 && k === 14) return { portrait: opp, extra: 'mom15' }; // 다이가·통키는 남는다
    return { portrait: opp };
  });
}

/**
 * @param {{k:number, kind:'pre'|'faceoff'|'win'|'lose', segments:any[], left:HTMLCanvasElement, right:HTMLCanvasElement, extra?:HTMLCanvasElement,
 *   who:HTMLElement, text:HTMLElement, more:HTMLElement, fadeEl?:HTMLElement, fadeIn?:number, sfx:(key:string,opt?:object)=>void, onDone:()=>void}} o
 */
export function runScene(o) {
  const { left, right, extra, who, text, more } = o;
  const lg = left.getContext('2d'), rg = right.getContext('2d'), xg = extra?.getContext('2d');
  let P = null, X = null, plan = [];
  let seg = 0, pi = 0, prevSpk = null, page = null, si = 0, wait = 0, phase = 'load', shown = '';
  let mouthOn = ''; const ph = { L: 0, R: 0, X: 0 };
  let bc = rnd(), blinkVis = 'closed';
  let visPrev = null, raf = 0, acc = 0, last = 0;
  let fade = null; // {kind, t, n, ...} 진행 중 페이드
  let bright = { R: 1, X: 1 }; // 오른쪽·추가 그림 밝기(팔레트 라인 페이드)
  let showExtra = null; // 'team3' | 'mom15' | null
  function rnd() { const r = (Math.random() * 256) | 0; return r < 8 ? 8 : r; }

  function startPage() {
    const pg = o.segments[seg].pages[pi];
    page = pageSteps(pg, pi === 0 ? null : prevSpk);
    prevSpk = page.speaker;
    si = 0; wait = 0; shown = ''; text.textContent = ''; more.hidden = true; phase = 'type';
  }
  function step(st) {
    if (st.t === 'spk') { who.textContent = page.name; return; }
    if (st.t === 'end') { mouthOn = ''; phase = 'end'; more.hidden = false; return; }
    if (st.t === 'nl') { shown += '\n'; text.textContent = shown; return; }
    shown += st.c; text.textContent = shown;
    if (st.syl) {
      if (!mouthOn) mouthOn = slotOf(page.speaker);
      const key = sfxOf(page.speaker);
      if (key) o.sfx(key, { gap: 0, solo: 'story-type' });
    } else mouthOn = '';
    if (st.closeAfter) mouthOn = '';
  }
  const cell = (s) => (Math.floor(ph[s]++ / MOUTH_HOLD) % 2 ? 'mouthB' : 'mouthA');

  /** 세그먼트 진입 그림 교체. team3: 오른쪽 8f 페이드 아웃 → 팀 그림 8f 페이드 인(53 §3-1). mom15: 엄마 그림 32f 페이드 인(53 §3-2). 그 밖: 바로 교체 */
  function enterSeg() {
    const want = plan[seg]?.extra ?? null;
    text.textContent = ''; more.hidden = true; // 창 글자 지움
    if (want === 'team3' && showExtra !== 'team3') { fade = { kind: 'team3', t: 0 }; phase = 'fade'; return; }
    if (want === 'mom15' && showExtra !== 'mom15') { showExtra = 'mom15'; ph.X = 0; bright.X = 0; fade = { kind: 'mom15', t: 0 }; phase = 'fade'; return; }
    startPage();
  }
  function fadeFrame() {
    const f = fade;
    if (f.kind === 'in') { // 장면 시작 페이드 인(막힘형)
      const k = level(['in', 0, f.n], f.t, STEPS);
      if (o.fadeEl) o.fadeEl.style.opacity = String(1 - k);
      if (++f.t > f.n) { if (o.fadeEl) o.fadeEl.hidden = true; fade = null; startPage(); }
      return;
    }
    if (f.kind === 'team3') {
      if (f.t < 8) bright.R = level(['out', 0, 8], f.t + 1, STEPS);
      else { if (f.t === 8) { showExtra = 'team3'; ph.R = 0; ph.X = 0; } bright.X = level(['in', 8, 8], f.t + 1, STEPS); }
      if (++f.t >= 16) { fade = null; bright.X = 1; bright.R = 1; startPage(); }
      return;
    }
    if (f.kind === 'mom15') {
      bright.X = level(['in', 0, 32], f.t + 1, STEPS);
      if (++f.t >= 32) { fade = null; bright.X = 1; startPage(); }
    }
  }
  function frame() {
    if (phase === 'fade') fadeFrame();
    else if (phase === 'type') {
      if (wait > 0) wait--;
      else { const st = page.steps[si++]; step(st); wait = st.f - 1; }
    }
    const team = showExtra === 'team3';
    const mL = mouthOn.includes('L') ? cell('L') : null;
    // 팀 그림: 두 입($C800·$CA80)을 같은 위상으로 합성한 칸(story_extras.png). 화자 0x13 이 둘을 함께 켠다
    // (그림을 실을 때 두 위상을 0 으로 맞추고, 화자 0x13 만 말하므로 두 입은 같이 진행한다)
    const mR = mouthOn.includes('R') ? cell('R') : null;
    const mX = mouthOn.includes('X') ? cell('X') : null;
    if (!mouthOn.includes('L')) {
      bc--; if (bc < 0) bc = rnd();
      const s = 7 - bc;
      blinkVis = bc <= 7 ? (s < BLINK_HOLD ? 'blink1' : s < BLINK_HOLD * 2 ? 'blink2' : 'closed') : 'closed';
    } else blinkVis = 'closed';
    // team3 페이드 앞 8f(팀 그림을 싣기 전): 이전 세그먼트의 상대 초상을 남겨 bright.R 로 어둡게 한다(53 §3-1)
    const pr = (fade?.kind === 'team3' && !team ? plan[seg - 1] : plan[seg])?.portrait ?? null;
    const vis = {
      L: mL ?? blinkVis,
      r: team ? null : pr, R: team ? 'closed' : (mR ?? 'closed'), bR: bright.R,
      x: showExtra, X: (team ? mR ?? mX : mX) ?? 'closed', bX: bright.X,
    };
    if (visPrev) paint(visPrev); // 스프라이트 표 1프레임 늦게 반영(48 §10-3)
    visPrev = vis;
  }
  let painted = '';
  const put = (g, img, r, w, h, b) => {
    g.clearRect(0, 0, w, h);
    if (!r) return;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    if (b < 1) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(0,0,0,${1 - b})`; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
  };
  function paint(v) {
    const key = [v.L, v.r, v.R, v.bR, v.x, v.X, v.bX].join('|');
    if (!P || key === painted) return;
    painted = key;
    put(lg, P.img, P.meta.frames['danpei.' + v.L], 40, 40, 1);
    right.hidden = !v.r;
    if (v.r) put(rg, P.img, P.meta.frames[v.r + '.' + v.R], 40, 40, v.bR);
    if (extra) {
      extra.hidden = !v.x;
      extra.classList.toggle('wide', v.x === 'team3');
      if (v.x && X) {
        const r = X.meta.frames[v.x + '.' + v.X];
        if (r && (extra.width !== r.w)) extra.width = r.w;
        put(xg, X.img, r, extra.width, 40, v.bX);
      }
    }
    dbg.painted.push(key); if (dbg.painted.length > 400) dbg.painted.shift();
  }
  function tick(now) {
    if (phase === 'done') return;
    acc += Math.min(100, now - last); last = now;
    while (acc >= TICK) { acc -= TICK; frame(); if (phase === 'done') return; }
    raf = requestAnimationFrame(tick);
  }
  function advance() {
    if (phase === 'type') {
      shown = page.s; text.textContent = shown; mouthOn = ''; phase = 'end'; more.hidden = false;
      o.sfx('sfx.ui.cursor');
      return;
    }
    if (phase !== 'end') return;
    if (pi + 1 < o.segments[seg].pages.length) { pi++; startPage(); return; }
    if (seg + 1 < o.segments.length) { seg++; pi = 0; enterSeg(); return; }
    finish();
  }
  function finish() {
    if (phase === 'done') return;
    phase = 'done'; cancelAnimationFrame(raf); mouthOn = '';
    if (o.fadeEl) o.fadeEl.hidden = true;
    if (page) text.textContent = page.s;
    more.hidden = true;
    o.onDone();
  }
  const dbg = { kind: o.kind, painted: [], get phase() { return phase; }, get seg() { return seg; }, get page() { return pi; }, get mouth() { return mouthOn; }, get blink() { return blinkVis; }, get extra() { return showExtra; }, advance, finish };
  window.__storyIntro = dbg; // 디버그·검증용(main 의 __app 과 같은 관례)

  // 초상을 못 받아도 대사는 글자로 이어 간다(P=null → paint 가 그리지 않음)
  const ready = Promise.all([loadPortraits().catch((e) => { console.warn('story_scene portraits', e.message); return null; }),
    o.kind === 'win' ? loadExtras().catch((e) => { console.warn('story_scene extras', e.message); return null; }) : null]);
  ready.then(([p, x]) => {
    P = p; X = x;
    plan = rightPlan(P?.meta ?? null, o.k, o.kind, o.segments?.length ?? 0);
    if (phase === 'done') return;
    if (!o.segments?.length || !o.segments[0].pages?.length) { finish(); return; }
    if (o.fadeIn > 0) { phase = 'fade'; fade = { kind: 'in', t: 0, n: o.fadeIn }; if (o.fadeEl) { o.fadeEl.hidden = false; o.fadeEl.style.opacity = '1'; } }
    else startPage();
    last = performance.now(); raf = requestAnimationFrame(tick);
  }).catch((e) => { console.warn('story_scene', e.message); finish(); });
  return { advance, finish, stop() { phase = 'done'; cancelAnimationFrame(raf); }, get phase() { return phase; } };
}
