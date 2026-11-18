// 순위표(PROTOCOL §11.3 ranking_list): 상위 50명(순위·닉네임·레이팅·승·패) + 내 줄(계정만, 5경기 미만 = '배치 중').
// 규칙 창 틀(.rules-win)·리그 승패표 표(.lg-table) 재사용. 오류는 토스트(main.js).
import { h } from '../util.js';
import { net } from '../net.js';
import { arrowNav } from '../pix.js';

export function mount(root, app) {
  const back = () => app.go('lobby');
  const backBtn = h('button.btn.small.back', { type: 'button', onclick: back }, '돌아가기');
  const body = h('div.lg-tscroll.rk-scroll');
  root.append(h('div.screen.rules', h('section.pwin.rules-win.lg-tablewin.rk-win', { 'aria-label': '순위표' },
    h('header.rules-head', h('h1.pix-title', '순위표'), backBtn), body)));
  const offNav = arrowNav(root, { onEsc: back });
  setTimeout(() => { if (backBtn.isConnected) backBtn.focus({ preventScroll: true }); }, 30);

  function paint(b) {
    const top = Array.isArray(b?.top) ? b.top : [];
    const me = b?.me ?? null;
    const row = (x, cls = '') => h('tr' + cls, h('td.tabular', x.rank != null ? String(x.rank) : '배치 중'), h('td.rk-nick', x.nick),
      h('td.tabular', String(x.rating)), h('td.tabular', String(x.w)), h('td.tabular', String(x.l)));
    const rows = top.map((x) => row(x, me && x.nick === me.nick ? '.rk-me' : ''));
    body.replaceChildren(h('table.lg-table.rk-table',
      h('thead', h('tr', ['순위', '닉네임', '레이팅', '승', '패'].map((c) => h('th', c)))),
      h('tbody', rows.length ? rows : h('tr', h('td.empty', { colSpan: 5 }, '기록이 없습니다'))),
      me ? h('tfoot', row({ ...me, rank: me.placement ? null : me.rank }, '.rk-me')) : null));
  }
  paint(app.rankBoard);
  net.send('ranking_list', {});
  return { onRankingList: paint, onWelcome: () => net.send('ranking_list', {}), unmount: () => offNav() };
}
