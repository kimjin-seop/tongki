// 로비(시안 A): 왼쪽 로고 + 큰 메뉴 4줄(스토리 모드 / 전국 리그 / 불꽃의 계승 / 컴퓨터 대결 + 난이도 1·2·3) + 작은 메뉴 한 줄(튜토리얼·오프닝 다시보기·가입). 로그아웃은 오른쪽 머리줄,
// 오른쪽 방 목록 창(방 만들기 + 행을 눌러 입장, 서버 푸시로 실시간).
// 방 코드 입력 입장은 화면에서 뺐다(프로토콜 join_room{code} 는 그대로: 행을 누르면 그 방의 code 로 보낸다).
// 튜토리얼 = 종전 특훈 2종(training_start). 고르는 화면은 screens/tutorial.js
import { h, clear } from '../util.js';
import { toast } from '../ui.js';
import { net } from '../net.js';
import { ROOM_OFF, ERR } from '../i18n.js';
import { rulesText } from './rules.js';
import { titleLogo, start as startIntro } from '../intro.js';
import { arrowNav } from '../pix.js';
import { soundButton } from '../audio.js';

// 방 목록 탭(전체/랭크)·방 만들기 '랭크' 선택은 로비를 다시 열어도 유지(이 탭 동안)
let filter = 'all', rankedOpt = false;

export function mount(root, app) {
  const acct = !!app.account;
  if (!acct) rankedOpt = false;
  const list = h('div.room-list', { role: 'group', 'aria-label': '방 목록' });
  // 컴퓨터 대전: create_room{vsCpu, cpuLevel(1~3)}. 난이도는 다음 방문에도 유지
  let lvl = ['1', '2', '3'].includes(localStorage.getItem('dd.cpuLevel')) ? +localStorage.getItem('dd.cpuLevel') : 2;
  const lvBtns = [1, 2, 3].map((n) => h('button.btn.lv', { type: 'button', 'aria-label': `난이도 ${n}`, 'aria-pressed': String(n === lvl),
    onclick: () => { lvl = n; localStorage.setItem('dd.cpuLevel', String(n)); for (const [i, b] of lvBtns.entries()) b.setAttribute('aria-pressed', String(i + 1 === lvl)); } }, String(n)));
  // 방 만들기 '랭크' 선택(PROTOCOL §11.2 create_room.ranked): 계정만. 손님은 흐리게 두고 누르면 사유 토스트
  const rankBtn = h('button.btn.rank-opt' + (acct ? '' : '.dim'), { type: 'button', 'aria-pressed': String(rankedOpt), 'aria-disabled': acct ? null : 'true', 'aria-label': '랭크 방으로 만들기',
    onclick: () => { if (!acct) { toast(ERR.ACCOUNT_REQUIRED, 'warn'); return; } rankedOpt = !rankedOpt; rankBtn.setAttribute('aria-pressed', String(rankedOpt)); } }, '랭크');
  const tabs = h('div.rl-tab', { role: 'group', 'aria-label': '방 목록 보기' }, [['all', '전체'], ['ranked', '랭크']].map(([k, label]) =>
    h('button.btn.small', { type: 'button', 'data-f': k, 'aria-pressed': String(filter === k), onclick: () => { filter = k; for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.f === filter)); update(); } }, label)));
  const story = h('button.btn.primary.story-entry', { type: 'button', onclick: () => app.go('story', { mode: 'list' }) },
    h('span.story-entry-t', '스토리 모드'), h('span.story-entry-n', '15경기'));
  const league = h('button.btn.story-entry.league-entry', { type: 'button', onclick: () => app.go('league') }, h('span.story-entry-t', '전국 리그'));
  // 불꽃의 계승(로그라이트 도전, PROTOCOL §13)
  const flame = h('button.btn.story-entry.flame-entry', { type: 'button', onclick: () => app.go('flame') },
    h('span.story-entry-t', '불꽃의 계승'), h('span.story-entry-n', '도전'));
  root.append(h('div.screen.lobby',
    h('div.lobby-l',
      titleLogo(), // 타이틀 로고(인트로가 끝나면 이 자리로 이동)
      h('div.pwin.lobby-menu.title-follow', // 레트로 UI: 모드 창(9-slice) 안 메뉴 줄
        story,
        league,
        flame,
        // 컴퓨터 대결: 큰 버튼 = 고른 난이도로 바로 시작, 오른쪽 1·2·3 = 난이도
        h('div.cpu-box.cpu-row', { role: 'group', 'aria-label': '컴퓨터 대결' },
          h('button.btn.story-entry.go', { type: 'button', onclick: () => net.send('create_room', { vsCpu: true, cpuLevel: lvl }) }, h('span.story-entry-t', '컴퓨터 대결')),
          lvBtns),
        // 작은 메뉴 한 줄: 튜토리얼 · 오프닝 다시보기 · (손님이면) 가입 = 지금 닉네임을 계정으로(진행 승계) · 로그아웃
        h('div.lobby-foot',
          h('button.btn.small.tut-entry', { type: 'button', onclick: () => app.go('tutorial') }, '튜토리얼'),
          h('button.btn.small.replay-intro', { type: 'button', onclick: () => { if (!app.intro?.active) app.intro = startIntro({ app, onEnd: () => { app.intro = null; } }); } }, '오프닝 다시보기'),
          acct ? null : h('button.btn.small.acct-btn', { type: 'button', 'data-k': 'signup', onclick: () => app.go('nick', { upgrade: true }) }, '가입')))),
    h('div.lobby-r.title-follow',
      // 머리줄: 닉네임 이름판 · 소리 · 로그아웃(시안 01: 로그아웃은 오른쪽 위 명령 칸)
      h('div.nick-line', h('span.nick-t', app.nick || ''), soundButton(h),
        h('button.btn.small.acct-btn.logout', { type: 'button', 'data-k': 'logout', onclick: () => net.send('logout') }, '로그아웃')),
      h('section.pwin.room-panel',
        h('div.rl-top', h('h1', '방 목록'),
          h('span.rl-mk', rankBtn, h('button.btn.primary.mk', { type: 'button', onclick: () => net.send('create_room', rankedOpt ? { ranked: true } : {}) }, '방 만들기'))),
        h('div.rl-tabs', tabs, h('button.btn.small.rank-entry', { type: 'button', onclick: () => app.go('ranking') }, '순위표')),
        list))));
  net.send('list_rooms');
  const offNav = arrowNav(root);
  const offLogo = fitLogo(root.querySelector('.lobby'));
  if (!app.intro?.active) setTimeout(() => { if (story.isConnected && document.activeElement === document.body) story.focus({ preventScroll: true }); }, 30);

  function update() {
    const had = list.contains(document.activeElement) ? document.activeElement.dataset.code : null;
    clear(list);
    const rooms = filter === 'ranked' ? app.rooms.filter((r) => r.ranked) : app.rooms;
    if (!rooms.length) { list.append(h('div.empty', '방이 없습니다')); return; }
    for (const r of rooms) {
      // 들어갈 수 없는 방: 흐리게 두되 포커스·클릭은 받는다(누르면 사유 토스트). 최종 판정은 서버(ROOM_IN_GAME / ROOM_FULL)
      const off = r.status === 'playing' ? 'playing' : r.vsCpu ? 'cpu' : r.players >= r.max ? 'full' : null;
      const st = off ? ROOM_OFF[off].st : '대기';
      const name = `${r.host}의 방`, rules = r.rules ? rulesText(r.rules) : '';
      const row = h('button.room-row' + (off ? '.off' : ''), {
        type: 'button', 'data-code': r.code, 'aria-disabled': off ? 'true' : null,
        'aria-label': `${r.ranked ? '랭크, ' : ''}${name}, ${rules ? rules + ', ' : ''}${r.players}/${r.max}, ${st}`,
        onclick: () => { if (off) toast(ROOM_OFF[off].msg, 'warn'); else net.send('join_room', { code: r.code }); },
      },
        h('span.rr-main', h('b.rr-name', r.ranked ? h('span.tag.rank', '랭크') : null, name), rules ? h('span.rr-rules', rules) : null),
        h('span.rr-n.tabular', `${r.players}/${r.max}`),
        h('span.rr-st' + (off ? '' : '.st-wait'), st));
      list.append(row);
      if (had === r.code) row.focus({ preventScroll: true });
    }
  }
  update();
  return { update, unmount: () => { offNav?.(); offLogo(); } };
}

/** 이미지 불투명 영역 bbox [x0, y0, x1, y1](원본 px, 끝 배타). 읽기 실패 시 전체 */
const bboxCache = new Map();
function alphaBox(img) {
  const W = img.naturalWidth, H = img.naturalHeight;
  if (bboxCache.has(img.src)) return bboxCache.get(img.src);
  let b = [0, 0, W, H];
  try {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 >= 0) b = [x0, y0, x1 + 1, y1 + 1];
  } catch { /* 캔버스 읽기 불가: 전체 크기 */ }
  bboxCache.set(img.src, b);
  return b;
}

/** 로비 로고: 투명 여백을 뺀 실제 그림 기준으로 왼쪽 패널 폭에 맞춰 확대(정수배 우선, 세로는 메뉴를 밀어내지 않게). 반환: 해제 함수 */
function fitLogo(lobby) {
  const img = lobby?.querySelector('.title-logo img');
  if (!img || typeof ResizeObserver === 'undefined') return () => {};
  const box = img.parentElement, left = box.parentElement, menu = left.querySelector('.lobby-menu');
  const mobile = matchMedia('(max-width: 760px)');
  const px = (el, p) => parseFloat(getComputedStyle(el)[p]) || 0;
  function apply() {
    if (!img.naturalWidth || !box.isConnected) return;
    const [x0, y0, x1, y1] = alphaBox(img);
    const cw = x1 - x0, ch = y1 - y0;
    const availW = box.clientWidth;
    const availH = mobile.matches ? innerHeight * 0.3
      : lobby.clientHeight - px(lobby, 'paddingTop') - px(lobby, 'paddingBottom') - px(left, 'paddingTop') - (menu?.offsetHeight ?? 0) - px(left, 'rowGap') - 4;
    const fit = Math.min(availW / cw, availH / ch);
    if (!(fit > 0)) return;
    const n = Math.floor(fit);
    const s = n >= 1 && n / fit >= 0.9 ? n : fit; // 정수배가 90% 이상 채우면 정수배, 아니면 꽉 채움
    Object.assign(img.style, {
      width: Math.round(img.naturalWidth * s) + 'px', height: Math.round(img.naturalHeight * s) + 'px', maxWidth: 'none',
      margin: `${-y0 * s}px ${-(img.naturalWidth - x1) * s}px ${-(img.naturalHeight - y1) * s}px ${-x0 * s}px`,
    });
  }
  const ro = new ResizeObserver(apply);
  ro.observe(lobby); if (menu) ro.observe(menu);
  if (!img.complete) img.addEventListener('load', apply, { once: true });
  return () => { ro.disconnect(); img.removeEventListener('load', apply); };
}
