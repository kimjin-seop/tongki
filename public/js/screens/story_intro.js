// 스토리 챕터 시작 연출: 제목 카드(第N戦 → 제N전) → 원작 경기 전 대사 장면(서브 2 → 서브 3).
// 근거: analysis/48_story_chapter_intro.md §2-1(카드)·§2-2(대사 루틴)·§10-2(속도 실측)·§10-3(초상·입·깜빡임 실측)·§10-4(소리),
//       대사 번역 analysis/49_story_translation_notes.md(규칙: 한글 음절 1자 = 가나 1자, 쉼 '.' 규칙).
// 화면 틀(초록 창 .pwin.dlg-box·이름판·넘김 공 커서)은 기존 것을 그대로 쓴다(48 요구 5). 이 모듈 전용 css 는 .story-intro-*.
import { h, fitScale, isTyping } from '../util.js';
import { dotMask, dotCanvas } from '../game/dottext.js';
import { level } from '../story_cut.js';

/** 대사 장면 곡 0x91(48 §2 표: 카드에서 시작 → 대사·규칙 창·라인업·맞대면까지, 맞대면 끝 0xE0). manifest bgm.story.scene verified(2026-11-20 박백엔 등록).
 *  곡 유지는 sfxmap SCREEN_BGM 의 rules/lineup silent·story launch 가 맡는다 */
export const SCENE_BGM_ON = true;
export const SCENE_BGM_KEY = 'bgm.story.scene';

/** 프롤로그 버튼·첫 진입 컷: 제목 카드(match1)를 뺀 진입 컷 4장(48 요구 4, §6 #18) */
export const PROLOGUE_IDS = ['kamakura', 'tonki', 'stranger', 'tiger'];

const KO_URL = '/assets/rom/story/story_dialogue_ko.json'; // = server/data/story_dialogue_ko.json 사본(한국어만, 일본어 원문 없음)
const CUTS_URL = '/assets/rom/story/story_cuts.json'; // 제목 카드 배치·타이밍(match1.card = 1전 실측, 15장 같은 코드 경로 0x11C94)
const W = 398, H = 224, BW = 320, DW = (W - BW) / 2, TICK = 1000 / 60;
const STEP_F = 4; // 바이트 하나(글자·화자·줄바꿈·페이지 끝) = 4프레임 1스텝($E40A=3, 0x12136) — 실측 930회
const PAUSE_F = 49; // 。 뒤 $E40A=0x30(0x121DA) → 49프레임 — 실측 6회
const BLACK_BEFORE = 119; // 카드 첫 줄 페이드인 전 검정(1전 실측, story_dialogue_jp title.timingFrames.blackBefore)

/** 가나 대응(입·소리 켬) = 한글 음절. 공백·문장부호·줄바꿈은 끔(49 rules.typing) */
const isSyl = (c) => c >= '가' && c <= '힣';

let koP = null, cutsP = null;
const getJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
export const loadKo = () => (koP ??= getJson(KO_URL).catch((e) => { koP = null; throw e; }));
const loadCuts = () => (cutsP ??= getJson(CUTS_URL).catch((e) => { cutsP = null; throw e; }));

/** 쉼 판정(49 §1): 앞뒤가 '.' 이 아니고 다음 글자가 공백·줄끝·」·끝인 '.' */
export function isPause(s, i) {
  if (s[i] !== '.' || s[i - 1] === '.' || s[i + 1] === '.') return false;
  const n = s[i + 1];
  return n === undefined || n === ' ' || n === '\n' || n === '」';
}

/**
 * 한 페이지의 스텝 목록. ROM 규칙(48 §2-2, 0x1214E~): [화자 바이트] + 글자 + (줄 사이 0x17) + 페이지 끝(0x18/0x19).
 * 화자 바이트는 세그먼트 첫 페이지이거나 앞 페이지와 화자가 다를 때만 있다(원문 26페이지 전부 이 규칙과 일치 — 구현 때 원문 JSON 으로 대조).
 */
export function pageSteps(page, prevSpeaker) {
  const run = page.runs[0];
  const s = run.lines_ko.join('\n');
  const steps = [];
  if (prevSpeaker == null || prevSpeaker !== run.speaker) steps.push({ t: 'spk', f: STEP_F });
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\n') { steps.push({ t: 'nl', f: STEP_F, i }); continue; }
    steps.push({ t: 'ch', c, i, f: isPause(s, i) ? PAUSE_F : STEP_F, syl: isSyl(c), closeAfter: s[i + 1] === '」' });
  }
  steps.push({ t: 'end', f: STEP_F });
  return { s, steps, speaker: run.speaker, name: run.nameKo ?? '' };
}

// ---------------- 제목 카드 ----------------
/**
 * 제목 카드. 배치·타이밍은 story_cuts.json match1(1전 실측: 첫 줄 0f 인 27f, 둘째 줄 113f 인 27f, 222f 두 줄 아웃 27f).
 * @param {{root:HTMLElement, number:string, subtitle:string, black?:number, onStart?:()=>void, onEnd:()=>void}} o
 */
export function playCard(o) {
  const canvas = h('canvas.intro-canvas', { width: W, height: H, 'aria-hidden': 'true' });
  const wrap = h('div.story-intro-card', { role: 'img', 'aria-label': `${o.number} ${o.subtitle}` }, canvas);
  o.root.append(wrap);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const fit = () => { const s = fitScale(innerWidth, innerHeight, W, H); canvas.style.width = s.cw + 'px'; canvas.style.height = s.ch + 'px'; };
  fit(); addEventListener('resize', fit);
  const black = o.black ?? BLACK_BEFORE;
  let card = null, steps = 7, texts = [], t = 0, acc = 0, last = 0, raf = 0, state = 'load';

  function draw() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const tc = t - black;
    if (!card || tc < 0) return;
    g.translate(DW, 0);
    texts.forEach((c, i) => {
      const ln = card.lines[i];
      const k = tc >= ln.out[0] ? level(['out', ln.out[0], ln.out[1]], tc, steps) : level(['in', ln.in[0], ln.in[1]], tc, steps);
      g.globalAlpha = k; g.drawImage(c, Math.round((BW - c.width) / 2), card.textY[i]); g.globalAlpha = 1;
    });
  }
  const total = () => black + Math.max(...card.lines.map((l) => l.out[0] + l.out[1]));
  function tick(now) {
    if (state !== 'play') return;
    acc += Math.min(100, now - last); last = now;
    while (acc >= TICK) { acc -= TICK; t++; if (t >= total()) { draw(); finish(); return; } }
    draw();
    raf = requestAnimationFrame(tick);
  }
  /** 버튼 = 단계 넘김(story_cut 카드와 같은 동작): 아웃 전이면 아웃 시작으로, 아웃 중이면 끝 */
  function advance() {
    if (state !== 'play') return;
    const o2 = black + Math.min(...card.lines.map((l) => l.out[0]));
    t = t < o2 ? o2 : total() - 1;
  }
  function finish() {
    if (state === 'done') return;
    state = 'done';
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', fit);
    wrap.remove();
    o.onEnd?.();
  }
  function onKey(e) {
    if (state === 'done' || e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    if (e.key === 'Escape') finish(); else advance();
  }
  addEventListener('keydown', onKey, true);
  wrap.addEventListener('pointerdown', (e) => { e.preventDefault(); advance(); });

  loadCuts().then((d) => {
    if (state !== 'load') return;
    const m = d.cuts.find((c) => c.id === 'match1');
    if (!m?.card) throw new Error('match1 card 없음');
    card = { lines: m.card.lines, textY: m.textY };
    steps = d.timing?.steps ?? 7;
    const th = m.textH ?? 12;
    texts = [o.number, o.subtitle].map((s) => dotCanvas(dotMask(s, { h: th, font: '"DD UI", sans-serif', th: 0.55, ct: 0.65, maxW: BW - 24 }), { fill: '#fcfcfc' }));
    state = 'play'; last = performance.now(); draw();
    o.onStart?.();
    raf = requestAnimationFrame(tick);
  }).catch((e) => { console.warn('story_intro card', e.message); finish(); });

  /** 화면이 바뀔 때: 다음 단계로 넘기지 않고 정리만 */
  function stop() { if (state === 'done') return; o.onEnd = null; finish(); }
  return { finish, stop, get state() { return state; }, get frame() { return t; } };
}

// 대사 장면 엔진(runScene)은 story_scene.js 로 옮겼다(경기 전·맞대면·경기 후 공통).

/** 키 입력이 장면 넘김인지(기존 scene() 과 같은 키: Enter·Space·D) */
export function isAdvanceKey(e) {
  if (isTyping() || e.repeat) return false;
  const act = e.code === 'KeyD' && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (e.key === 'Enter' || e.key === ' ' || act) return !(e.target instanceof HTMLButtonElement && e.key !== 'Enter' && !act);
  return false;
}
