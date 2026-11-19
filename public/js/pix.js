// 원작풍(시안 A) 바깥 UI 공용: 배경·창·엠블럼·얼굴·8x8 글리프 이미지를 manifest 키로 CSS 변수에 연결하고,
// 학교 엠블럼/약칭/짧은 팀 이름, 방향키 포커스 이동을 제공한다. 근거 analysis/11_team_select.md, select.data
import { h } from './util.js';
import { has, entry, json } from './game/assets.js';
import { teamName, teamPlayers } from './names.js';

// 엠블럼 번호 → 약칭(원작 8x8 글리프로 표시). 0~14 = 팀 id, 15 = 초투구부
const EMB_ABBR = ['T.D', 'S.A', 'A.T', 'B.A', 'TOK', 'HOK', 'KYO', 'OKI', 'USA', 'CHI', 'CHN', 'URS', 'GRE', 'BRA', 'EGY', 'CHO'];
// select.data#assets.emblems.team_to_emblem 의 기본값(데이터 로드 실패 시)
let T2E = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 8, 9, 10, 11, 12, 13, 14, 0, 15, null];
/** 원작 팀 선택 격자 순서(화면 왼→오, 위→아래) = 팀 id. 근거 11_team_select.md §2 */
export const GRID_MAIN = [0, 1, 3, 2, 5, 6, 7, 4, 10, 11, 14, 12, 13, 9, 8];

const IMGS = { '--img-bg': 'select.bg.unit', '--img-win': 'select.window.9s', '--img-emb': 'select.emblems',
  '--img-font': 'select.font.white', '--img-font-y': 'select.font.yellow', '--img-faces': 'hud.faces',
  '--img-ball': 'select.ball', '--img-bar': 'prematch.fm.bar', // 레트로 UI: 메뉴 공 커서 16x16x4, 눈금 게이지 4x8
  // 불꽃 보관 팀(안아트 keep 세트): 표식·배지·기호·딱지·빈 칸·NEW
  '--img-kp-mark': 'ui.icon.keep.mark', '--img-kp-badge': 'ui.icon.keep.badge', '--img-kp-g-recent': 'ui.icon.keep.glyph_recent', '--img-kp-g-best': 'ui.icon.keep.glyph_best',
  '--img-kp-t-recent': 'ui.icon.keep.tag_recent', '--img-kp-t-best': 'ui.icon.keep.tag_best', '--img-kp-empty': 'ui.icon.keep.slot_empty', '--img-kp-new': 'ui.icon.keep.new' };

/** 부팅 시 1회: 이미지 키 → CSS 변수, 팀→엠블럼 표 로드 */
export async function loadPix() {
  const st = document.documentElement.style;
  for (const [v, k] of Object.entries(IMGS)) {
    if (has(k)) { try { st.setProperty(v, `url("/assets/${entry(k).path}")`); } catch { /* 키 없음: CSS 폴백(단색) */ } }
  }
  if (has('select.data')) {
    try { const d = await json('select.data'); if (Array.isArray(d?.assets?.emblems?.team_to_emblem)) T2E = d.assets.emblems.team_to_emblem; }
    catch (e) { console.warn('select.data', e.message); }
  }
  medalFrame1().catch(() => { /* 실패해도 배경은 프레임 0 정지 그림 */ });
}

// 원작 메뉴 배경의 메달 회전(코드 0x10BC0): 메달 가운데 24x24(타일 0xD3~0xDB)가 평상시 프레임 0/1 을 5f 씩 교대.
// bg.unit(=프레임 0) 에 medal_anim 프레임 1 을 (8,0)·(32,48)(가로 48 넘김은 왼쪽으로 이어짐) 자리에 붙인 반복 단위를 만들어
// --img-bg-m1 로 넘긴다. CSS body::before 가 이 그림을 steps 로 켜고 끈다. 근거 analysis/11_team_select.md §3, select.data#bg_medal_anim
const MEDAL_AT = [[8, 0], [32, 48], [32 - 48, 48]];
async function medalFrame1() {
  if (!has('select.bg.unit') || !has('select.bg.medal_anim')) return;
  const load = (k) => new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = `/assets/${entry(k).path}`; });
  const [unit, sheet] = await Promise.all([load('select.bg.unit'), load('select.bg.medal_anim')]);
  const c = document.createElement('canvas'); c.width = 48; c.height = 96;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(unit, 0, 0);
  for (const [x, y] of MEDAL_AT) { g.clearRect(x, y, 24, 24); g.drawImage(sheet, 24, 0, 24, 24, x, y, 24, 24); }
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  if (blob) document.documentElement.style.setProperty('--img-bg-m1', `url("${URL.createObjectURL(blob)}")`);
}

export const emblemOf = (team) => T2E[team] ?? 0;
export const abbrOf = (team) => (team === 24 ? 'REN' : EMB_ABBR[emblemOf(team)] ?? '');
/** 격자용 짧은 이름: '태동 국민학교' → '태동' */
export const shortName = (team, fallback = '') => teamName(team, fallback).replace(/\s*국민학교$/, '');

/** 엠블럼 24x16 (CSS 배경 스프라이트). 크기 배율은 CSS --ek */
export const emblem = (team) => h('span.emb', { style: { '--e': emblemOf(team) }, 'aria-hidden': 'true' });

/** 선수 얼굴 24x24 (hud.faces: x=선수 idx, y=팀 id). flip = 오른쪽을 보게 */
export const face = (team, i, flip = false) => h('span.face' + (flip ? '.flip' : ''), { style: { '--t': team, '--i': i }, 'aria-hidden': 'true' });
export const faces = (team, flip = false) => h('div.faces', { 'aria-hidden': 'true' }, [0, 1, 2, 3, 4, 5, 6].map((i) => face(team, i, flip)));
/** 얼굴 + 이름 라벨(한국판 이름이 있으면 이름, 없으면 'N번'). 대기실·팀 선택 큰 얼굴 격자용 */
export function roster(team, flip = false) {
  const names = teamPlayers(team);
  return h('div.roster', [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const n = names[i];
    const label = n && /[가-힣]/.test(n) ? n : `${i + 1}번`;
    return h('figure.rp', face(team, i, flip), h('figcaption', label));
  }));
}

/** 원작 8x8 글리프 문자열(ASCII 0x20~0x5F). 화면 읽기용 텍스트는 aria-label */
export function glyphs(text, yellow = false) {
  const s = String(text).toUpperCase();
  return h('span.gly' + (yellow ? '.y' : ''), { role: 'img', 'aria-label': s },
    [...s].map((c) => { const n = c.charCodeAt(0) - 32; return h('i', { style: { '--c': n >= 0 && n < 64 ? n : 0 } }); }));
}

/**
 * 방향키로 화면 안 버튼·입력 사이 포커스 이동(가장 가까운 방향 요소). Esc 는 onEsc.
 * 입력 칸 안에서는 좌우 키를 글자 이동에 남겨 둔다(한글 IME 조합 중에는 아무것도 하지 않음).
 * @returns {() => void} 해제
 */
export function arrowNav(root, { onEsc } = {}) {
  const DIR = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const onKey = (e) => {
    if (e.isComposing || e.defaultPrevented || !root.isConnected) return;
    if (document.body.dataset.intro) return;
    const a = document.activeElement;
    const inInput = a?.tagName === 'INPUT' && a.type === 'text';
    if (e.key === 'Escape' && onEsc) { e.preventDefault(); onEsc(); return; }
    const d = DIR[e.key];
    if (!d || e.altKey || e.ctrlKey || e.metaKey) return;
    if (inInput && d[0] !== 0) return;
    const items = [...root.querySelectorAll('button:not(:disabled), input:not(:disabled), [data-nav]')]
      .filter((el) => el.offsetParent !== null && !el.closest('[hidden]'));
    if (!items.length) return;
    e.preventDefault();
    if (!root.contains(a) || !items.includes(a)) { items[0].focus(); return; }
    const r0 = a.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = null, bs = Infinity, bo = Infinity;
    for (const el of items) {
      if (el === a) continue;
      const r = el.getBoundingClientRect();
      // 진행 방향 쪽으로 겹치지 않는 요소만: 가로 이동은 x, 세로 이동은 y 기준
      const along = d[0] ? (d[0] > 0 ? r.left - (r0.right - 2) : (r0.left + 2) - r.right) : (d[1] > 0 ? r.top - (r0.bottom - 2) : (r0.top + 2) - r.bottom);
      if (along < 0) continue;
      const ex = r.left + r.width / 2, ey = r.top + r.height / 2;
      const cross = d[0] ? Math.max(0, Math.abs(ey - cy) - (r.height + r0.height) / 2) : Math.max(0, Math.abs(ex - cx) - (r.width + r0.width) / 2);
      const sc = along + cross * 3;
      // 동점(겹친 테두리로 위아래 줄 cross 가 모두 0 인 격자 등)이면 진행 축 중심이 더 가까운 쪽(같은 줄·열)
      const off = d[0] ? Math.abs(ey - cy) : Math.abs(ex - cx);
      if (sc < bs - 0.5 || (sc <= bs + 0.5 && off < bo)) { bs = Math.min(bs, sc); bo = off; best = el; }
    }
    best?.focus();
    if (best?.scrollIntoView) best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}
