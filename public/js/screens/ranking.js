// 랭킹보드(구 순위표) 3탭(2026-11-20 사용자 결정):
//  「래더 랭킹」 = ladder_board(PROTOCOL §11.3, 시즌별): 순위·닉네임·티어 칩·레이팅·승패 + 지금 시즌 번호·종료까지 남은 시간
//  「전체 랭킹」 = pvp_board(시즌 무관 누적, 래더 + 일반 사람끼리 경기): 순위·닉네임·승·패·승률·판수. rate = 천분율 정수(서버 store/ranking.js pvpBoard)
//  「불꽃의 계승」 = flame_ranking(PROTOCOL §13.13): 순위·닉네임(+고난도 칩)·구간·승·핵심 3명(좁은 폭은 핵심 열 숨김)
// 내 줄 = 노랑 강조. 상위 목록(최대 50)에 없으면 표 아래 고정 줄(tfoot). 손님(me:null)은 내 줄 없음.
// 규칙 창 틀(.rules-win)·리그 승패표 표(.lg-table) 재사용. 오류는 토스트(main.js).
import { h } from '../util.js';
import { net } from '../net.js';
import { arrowNav } from '../pix.js';
import * as F from './flame/store.js';
import { rankName } from './flame/ui.js';
import { tierChip, seasonText, placementGames } from './ladder.js';

let tab = 'ladder'; // 이 탭(브라우저 탭) 동안 마지막에 본 랭킹보드 탭 유지

// 요청 절약(서버 campaignRate 분당 30회를 ladder_board·pvp_board·flame_ranking_get 이 공유): 진입 시 활성 탭 1개만 요청, 나머지는 처음 전환할 때.
// 응답 받은 시각을 탭별로 모듈에 두고 15초 안이면 재요청 없이 app 에 있는 응답으로 그린다. 계정 바뀜·래더/사람 경기 뒤에는 비운다.
const TTL = 15000;
const at = { ladder: 0, pvp: 0, flame: 0 }; // 응답 시각(0 = 없음)
const pending = new Set(); // 응답 대기 중인 탭
let owner = null;
const dataOf = (app, k) => (k === 'ladder' ? app.rankBoard : k === 'pvp' ? app.pvpBoard : Array.isArray(app.flameRank?.top) ? app.flameRank : null);
/** 캐시 비우기(래더 경기 결과·사람 경기 시작·로그아웃/재로그인). app 인자가 있으면 보관 응답도 비운다 */
export function invalidate(app) {
  at.ladder = at.pvp = at.flame = 0; pending.clear();
  if (app) { app.rankBoard = null; app.pvpBoard = null; }
}

export function mount(root, app) {
  const who = `${app.account ? 1 : 0}:${app.nick ?? ''}`;
  if (owner !== who) { if (owner !== null) { invalidate(app); app.flameRank = null; } owner = who; }
  const back = () => app.go('lobby');
  const backBtn = h('button.btn.small.back', { type: 'button', onclick: back }, '돌아가기');
  const tabs = h('div.rl-tab.rk-tabs', { role: 'group', 'aria-label': '랭킹보드 종류' }, [['ladder', '래더 랭킹'], ['pvp', '전체 랭킹'], ['flame', '불꽃의 계승']].map(([k, label]) =>
    h('button.btn.small', { type: 'button', 'data-tab': k, 'aria-pressed': String(tab === k), onclick: () => setTab(k) }, label)));
  const sub = h('div.rk-sub.tabular');
  const body = h('div.lg-tscroll.rk-scroll');
  const win = h('section.pwin.rules-win.lg-tablewin.rk-win', { 'aria-label': '랭킹보드' },
    h('header.rules-head', h('h1.pix-title', '랭킹보드'), backBtn), tabs, sub, body);
  win.classList.toggle('rk-wide', tab === 'flame');
  root.append(h('div.screen.rules', win));
  const offNav = arrowNav(root, { onEsc: back });
  setTimeout(() => { if (backBtn.isConnected) root.querySelector(`[data-tab="${tab}"]`)?.focus({ preventScroll: true }); }, 30);

  function setTab(k) {
    tab = k;
    win.classList.toggle('rk-wide', tab === 'flame');
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    paint();
    ensure(tab);
  }
  const table = (cols, rows, meRow) => h('table.lg-table.rk-table.rk-' + tab,
    h('thead', h('tr', cols.map((c) => h('th', c)))),
    h('tbody', rows.length ? rows : h('tr', h('td.empty', { colSpan: cols.length }, '기록이 없습니다'))),
    meRow ? h('tfoot', meRow) : null);
  const meIn = (top, me) => !!me && top.some((x) => x.nick === me.nick);

  function paintLadder(b) {
    sub.textContent = seasonText(b?.season ?? app.ladderStatus?.season);
    const top = Array.isArray(b?.top) ? b.top : [], me = b?.me ?? null, P = placementGames(app);
    const row = (x, cls = '') => h('tr' + cls, h('td.tabular', x.rank != null ? String(x.rank) : '-'), h('td.rk-nick', x.nick),
      h('td.rk-tier', tierChip(x.tier, { placement: x.placement === true, left: x.placementLeft, games: P }) ?? '-'),
      h('td.tabular', String(x.rating)), h('td.tabular', `${x.w}-${x.l}`));
    body.replaceChildren(table(['순위', '닉네임', '티어', '레이팅', '승패'], top.map((x) => row(x, me && x.nick === me.nick ? '.rk-me' : '')),
      me && !meIn(top, me) ? row(me, '.rk-me') : null));
  }
  function paintPvp(b) {
    sub.textContent = '시즌과 무관한 누적 기록';
    const top = Array.isArray(b?.top) ? b.top : [], me = b?.me ?? null;
    const pct = (x) => (x.games > 0 && Number.isFinite(x.rate) ? `${Math.floor(x.rate / 10)}%` : '-');
    const row = (x, cls = '') => h('tr' + cls, h('td.tabular', x.rank != null ? String(x.rank) : '-'), h('td.rk-nick', x.nick),
      h('td.tabular', String(x.w)), h('td.tabular', String(x.l)), h('td.tabular', pct(x)), h('td.tabular', String(x.games ?? x.w + x.l)));
    body.replaceChildren(table(['순위', '닉네임', '승', '패', '승률', '플레이'], top.map((x) => row(x, me && x.nick === me.nick ? '.rk-me' : '')),
      me && !meIn(top, me) ? row(me, '.rk-me') : null));
  }
  function paintFlame(b) {
    sub.textContent = '';
    const top = Array.isArray(b.top) ? b.top : [], me = b.me && typeof b.me === 'object' ? b.me : null;
    const hard = (d) => (d > 0 ? (F.catalog()?.difficulty ?? []).find((x) => x.id === d)?.name ?? '고난도' : null);
    const row = (x, cls = '') => {
      const on = x.seg > 0, hd = hard(x.diff), team = (Array.isArray(x.team) ? x.team : []).slice(0, 3).map(rankName).filter(Boolean).join(' · ');
      return h('tr' + cls, h('td.tabular', x.rank != null ? String(x.rank) : '-'),
        h('td.rk-nick', String(x.nick ?? ''), hd ? h('span.tag.fl-rk-d.rk-hard', hd) : null),
        h('td.tabular', on ? String(x.seg) : '-'), h('td.tabular', on ? String(x.wins) : '-'), h('td.rk-team', team));
    };
    body.replaceChildren(table(['순위', '닉네임', '구간', '승', '핵심'], top.map((x) => row(x, me && x.nick === me.nick ? '.rk-me' : '')),
      me && !meIn(top, me) ? row(me, '.rk-me') : null));
  }
  const loading = () => { sub.textContent = ''; body.replaceChildren(h('div.empty', '불러오는 중…')); };
  function paint() {
    if (tab === 'ladder') { if (app.rankBoard) paintLadder(app.rankBoard); else loading(); }
    else if (tab === 'pvp') { if (app.pvpBoard) paintPvp(app.pvpBoard); else loading(); }
    else if (Array.isArray(app.flameRank?.top)) paintFlame(app.flameRank); else loading();
  }
  const MSG = { ladder: 'ladder_board', pvp: 'pvp_board', flame: 'flame_ranking_get' };
  // 15초 안의 응답이 있으면 요청하지 않는다(내 줄도 같은 응답에 들어 있다)
  function ensure(k) {
    if (dataOf(app, k) && Date.now() - at[k] < TTL) return;
    pending.add(k); net.send(MSG[k], {});
  }
  const got = (k) => { pending.delete(k); at[k] = Date.now(); if (tab === k) paint(); };
  paint();
  ensure(tab);
  return {
    onRankingList: () => got('ladder'), onPvpBoard: () => got('pvp'), onFlameRanking: () => { if (Array.isArray(app.flameRank?.top)) got('flame'); },
    // 거절(CAMPAIGN_RATE_LIMITED): 기다리던 탭에 이미 그릴 응답이 있으면 토스트 없이 그대로 둔다(main.js 가 묻는다)
    quietError: (m) => m?.code === 'CAMPAIGN_RATE_LIMITED' && pending.size > 0 && [...pending].every((k) => !!dataOf(app, k)) && (pending.clear(), true),
    onError: (m) => { if (m?.code === 'CAMPAIGN_RATE_LIMITED') pending.clear(); },
    onWelcome: () => ensure(tab), unmount: () => offNav(),
  };
}
