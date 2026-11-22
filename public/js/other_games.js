// 로비 작은 메뉴 「다른 게임」 팝업(2026-11-22): 같은 포털(oddplay_portal src/data/games.json)의 다른 게임으로 가는 외부 링크.
// 공개 저장소라 포털 썸네일(원작 파생 이미지)은 쓰지 않는다: 글자 + 도트 화살표만.
// 켜고 끄기 = 아래 OTHER_GAMES 의 status 한 곳('play' = 링크, 'soon' = 「준비 중」 흐림·링크 없음). 줄을 빼면 목록에서 사라진다
import { h } from './util.js';
import { padNav } from './screens/flame/ui.js';

export const OTHER_GAMES = [
  { slug: 'nekketsu', title: '열혈격투전설', genre: '격투 액션', url: 'https://nekketsu.oddplay.kr', status: 'soon' },
  { slug: 'liero', title: '리에로 포에버', genre: '포격 난투', url: 'https://liero.oddplay.kr', status: 'play' },
  { slug: 'scorched', title: '스코치드 어스 포에버', genre: '턴제 포격', url: 'https://tank.oddplay.kr', status: 'play' },
];

/**
 * 팝업 열기. 닫기 = ✕ · Esc(게임패드 B) · 창 밖 클릭. 열린 동안 Tab·방향키는 창 안에서만 돈다(포커스 트랩).
 * 키 처리는 window 캡처 단계에서 먼저 받아 preventDefault 하므로 로비 arrowNav(defaultPrevented 면 무시)와 겹치지 않는다.
 * @returns {() => void} 닫기(로비 unmount 에서도 부른다)
 */
export function openOtherGames(host, opener) {
  let closed = false;
  const x = h('button.btn.small.og-x', { type: 'button', 'aria-label': '닫기', 'data-sfx': 'cancel', onclick: () => close() }, '✕');
  const rows = OTHER_GAMES.map((g) => {
    const kids = [h('b.og-t', g.title), g.genre ? h('span.og-g', g.genre) : null];
    if (g.status !== 'play') return h('div.og-row.off', { 'data-slug': g.slug, 'aria-disabled': 'true' }, ...kids, h('span.og-soon', '준비 중'));
    return h('a.og-row', { href: g.url, target: '_blank', rel: 'noopener noreferrer', 'data-nav': '', 'data-slug': g.slug, 'aria-label': `${g.title}, 새 창에서 열기` },
      ...kids, h('span.og-ext', { 'aria-hidden': 'true' }, h('i.og-ar')));
  });
  const win = h('section.pwin.og-win', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'og-title' },
    h('div.og-head', h('h2.og-title#og-title', '다른 게임'), x), h('div.og-list', rows));
  const pop = h('div.og-pop', { onclick: (e) => { if (!win.contains(e.target)) close(); } }, win);
  const items = () => [...win.querySelectorAll('a.og-row, button')];
  const onKey = (e) => {
    if (e.isComposing) return;
    if (!pop.isConnected) { close(); return; }
    const list = items(), i = list.indexOf(document.activeElement);
    const move = (d) => {
      e.preventDefault(); e.stopImmediatePropagation();
      const n = list.length, k = i < 0 ? (d > 0 ? 0 : n - 1) : (i + d + n) % n;
      list[k].focus();
    };
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    else if (e.key === 'Tab') move(e.shiftKey ? -1 : 1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') move(1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') move(-1);
  };
  addEventListener('keydown', onKey, true);
  const offPad = padNav(); // 게임패드: 방향 = 방향키, A = 누르기, B = Esc(닫기)
  host.append(pop);
  (rows.find((r) => r.tagName === 'A') ?? x).focus({ preventScroll: true });
  function close() {
    if (closed) return;
    closed = true;
    removeEventListener('keydown', onKey, true);
    offPad();
    pop.remove();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  return close;
}
