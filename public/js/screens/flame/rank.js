// 불꽃의 계승 도달 순위(PROTOCOL §13.13): flame_ranking_get → flame_ranking {top[≤50], me|null, total}. 모드 메인의 「순위」에서 들어온다.
// 한 줄 = 순위 · 닉네임(+고난도 표식) · 최고 구간 · 그 도전의 승수 · 핵심 3명. 내 줄(계정만, 손님은 me:null 이라 없다)은 목록 맨 아래에 붙여 두고 강조한다.
// 좁은 폭은 핵심 3명을 줄 아래로 내린다(flame.css .fl-rk-row). 요청은 index.js(ctx.go('rank')·재접속)가 보내고 여기서는 app.flameRank 만 그린다. 거절은 토스트(main.js).
import { h } from '../../util.js';
import * as F from './store.js';
import { head, rankName } from './ui.js';

export function rank(ctx) {
  const R = ctx.app.flameRank ?? null, B = Array.isArray(R?.top) ? R : null, back = () => ctx.go('home'); // top 없는 값 = 내 순위만 받은 상태(main.js) -> 불러오는 중
  const top = Array.isArray(B?.top) ? B.top : [], me = B?.me && typeof B.me === 'object' ? B.me : null;
  const hard = (d) => (d > 0 ? (F.catalog().difficulty ?? []).find((x) => x.id === d)?.name ?? '고난도' : null);
  const row = (x, cls = '') => {
    const on = x.seg > 0, team = (Array.isArray(x.team) ? x.team : []).slice(0, 3).map(rankName).filter(Boolean), hd = hard(x.diff);
    return h('div.fl-rk-row' + cls, { role: 'row' },
      h('span.fl-rk-n.tabular', { role: 'cell' }, x.rank !== null && x.rank !== undefined ? String(x.rank) : '-'),
      h('span.fl-rk-nick', { role: 'cell' }, h('b', String(x.nick ?? '')), hd ? h('span.tag.fl-rk-d', hd) : null),
      h('span.fl-rk-v.tabular', { role: 'cell' }, on ? String(x.seg) : '-'),
      h('span.fl-rk-v.tabular', { role: 'cell' }, on ? String(x.wins) : '-'),
      h('span.fl-rk-team', { role: 'cell' }, team.map((t) => h('span', t))));
  };
  const hd = h('div.fl-rk-row.hd', { role: 'row' }, ['순위', '닉네임', '구간', '승', '핵심'].map((t, i) =>
    h('span' + (i === 0 ? '.fl-rk-n' : i === 2 || i === 3 ? '.fl-rk-v' : i === 4 ? '.fl-rk-team' : ''), { role: 'columnheader' }, t)));
  const rows = top.map((x) => row(x, me && x.nick === me.nick ? '.me' : ''));
  const list = h('div.fl-rk-list', { 'data-sc': 'rank', role: 'table', 'aria-label': '순위' }, hd,
    !B ? h('div.empty', '불러오는 중…') : rows.length ? rows : h('div.empty', '기록이 없습니다'),
    me ? row(me, '.me.foot') : null);
  ctx.root.append(h('div.screen.fl.fl-rankv', head('순위', back, B && Number.isFinite(B.total) ? h('span.fl-count.tabular', `${B.total}명`) : null),
    h('section.pwin.fl-rk', list)));
  ctx.root.querySelector('[data-k="back"]').dataset.first = '1';
  return { esc: back };
}
