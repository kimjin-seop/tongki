// 래더(PROTOCOL §11, 랭크 대체): 로비 「래더 대전」 → 이 화면(내 현황 한 곳 + 대기열). 짝이 지어지면 ladder_matched → room_joined 로 래더 방(대기실 room.js).
// 내 현황 = ladder_status.me(티어·레이팅·배치 진행·순위·승패) + 시즌 종료까지. 대기열 = ladder_queue(대기 시간·허용 점수 차·대기 인원, 취소).
// 허용 점수 차는 서버가 매 초 푸시하지 않으므로 ladder_status.config.queue 규칙(§11.2)으로 대기 시간에서 계산해 그린다. 대기 인원은 15초마다 ladder_status 로 새로 받는다.
// 오류는 토스트(main.js). 티어 칩·시즌 남은 시간은 랭킹보드·대기실·결과 카드가 같이 쓴다(export).
import { h } from '../util.js';
import { net } from '../net.js';
import { toast } from '../ui.js';
import { TIER, ERR, lockText } from '../i18n.js';
import { arrowNav } from '../pix.js';

/** 티어 칩(글자 + 색 띠, CSS .tag.tier.t-<키>). placement = 배치 중이면 '배치 n/N' 칩 */
export function tierChip(tier, { placement = false, left = null, games = 5 } = {}) {
  if (placement) {
    const n = Number.isInteger(left) ? Math.max(0, games - left) : null;
    return h('span.tag.tier.t-place.tabular', n != null ? `배치 ${n}/${games}` : '배치 중');
  }
  return TIER[tier] ? h('span.tag.tier.t-' + tier, TIER[tier]) : null;
}
export const guestChip = () => h('span.tag.tier.t-guest', '손님');
/** 배치 판수(ladder_status.config.placementGames, 없으면 서버 기본 5) */
export const placementGames = (app) => app.ladderStatus?.config?.placementGames ?? 5;
/** 시즌 종료까지 남은 시간 한 줄 */
export function seasonText(season) {
  if (!season || !Number.isInteger(season.n)) return '';
  const ms = (season.endsAt ?? 0) - net.now();
  const left = ms <= 0 ? '곧 종료' : ms >= 86400000 ? `${Math.floor(ms / 86400000)}일 남음` : ms >= 3600000 ? `${Math.floor(ms / 3600000)}시간 남음` : `${Math.max(1, Math.ceil(ms / 60000))}분 남음`;
  return `시즌 ${season.n} · ${left}`;
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function mount(root, app, data) {
  let want = false; // 내가 줄에 서려는 중(재접속 뒤 다시 ladder_join, §11.2)
  const back = () => { if (app.ladderQ?.queued || want) net.send('ladder_cancel'); want = false; app.go('lobby'); };
  const backBtn = h('button.btn.small.back', { type: 'button', onclick: back }, '돌아가기');
  const season = h('div.ld-season.tabular');
  const me = h('div.ld-me');
  const q = h('div.ld-q');
  root.append(h('div.screen.rules', h('section.pwin.rules-win.ld-win', { 'aria-label': '래더 대전' },
    h('header.rules-head', h('h1.pix-title', '래더 대전'), backBtn), season, me, q)));
  const offNav = arrowNav(root, { onEsc: back });

  const locked = () => { const u = app.ladderStatus?.me?.lockUntil; return u > net.now() ? u : 0; };
  function join() {
    if (!app.account) { toast(ERR.ACCOUNT_REQUIRED, 'warn'); return; }
    const u = locked(); if (u) { toast(lockText(u, net.now()), 'warn'); return; }
    want = true; net.send('ladder_join');
  }

  function paintMe() {
    const st = app.ladderStatus;
    season.textContent = seasonText(st?.season);
    const m = st?.me;
    if (!m) { me.replaceChildren(app.account ? h('div.muted', '불러오는 중…') : h('div.ld-me-row', guestChip())); return; }
    const P = placementGames(app);
    me.replaceChildren(h('div.ld-me-row',
      tierChip(m.tier, { placement: m.placement, left: m.placementLeft, games: P }),
      h('b.ld-rating.tabular', String(m.rating)),
      m.rank ? h('span.ld-rank.tabular', `${m.rank}위`) : null,
      h('span.ld-wl.tabular', `${m.w}승 ${m.l}패`)));
  }

  let shownState = null; // 큐 영역 구조(queued 여부·잠금)가 바뀔 때만 버튼을 다시 만든다(포커스 유지)
  const waitEl = h('b.ld-wait.tabular'), winEl = h('span.tabular'), cntEl = h('span.tabular');
  function paintQ() {
    const Q = app.ladderQ, on = !!Q?.queued, lk = !!locked(), guestOff = !app.account;
    const key = `${on}|${lk}|${guestOff}`;
    if (key !== shownState) {
      shownState = key;
      const had = root.contains(document.activeElement) && document.activeElement !== backBtn;
      if (on) {
        q.replaceChildren(
          h('div.ld-q-t', '상대 찾는 중 ', waitEl),
          h('div.ld-q-sub', h('span', '허용 점수 차 ', winEl), h('span', '대기 ', cntEl)),
          h('div.cmds.ld-cmds', h('button.btn', { type: 'button', 'data-cmd': 'cancel', onclick: () => { want = false; net.send('ladder_cancel'); } }, '취소')));
      } else {
        const dim = lk || guestOff;
        q.replaceChildren(h('div.cmds.ld-cmds', h('button.btn.primary' + (dim ? '.dim' : ''), { type: 'button', 'data-cmd': 'join', 'aria-disabled': dim ? 'true' : null, onclick: join }, '상대 찾기')));
      }
      if (had || document.activeElement === document.body) q.querySelector('button')?.focus({ preventScroll: true });
    }
    if (on) tickQ();
  }
  function tickQ() {
    const Q = app.ladderQ; if (!Q?.queued) return;
    const wait = Math.max(0, Math.floor((net.now() - (Q.since ?? net.now())) / 1000));
    const c = app.ladderStatus?.config?.queue ?? { expandStep: 100, expandSec: 15, maxWaitSec: 60 };
    const win = wait >= c.maxWaitSec ? null : c.expandStep * (1 + Math.floor(wait / c.expandSec));
    waitEl.textContent = mmss(wait);
    winEl.textContent = win == null ? '제한 없음' : `±${win}`;
    cntEl.textContent = Number.isInteger(Q.waiting) ? `${Q.waiting}명` : '-';
  }
  const tick = setInterval(() => { tickQ(); if (!app.ladderQ?.queued) paintMe(); }, 500);
  // 대기 인원·내 현황 새로 받기(줄에 서 있는 동안만, 분당 상한 30 공유)
  const poll = setInterval(() => { if (app.ladderQ?.queued) net.send('ladder_status'); }, 15000);

  net.send('ladder_status'); // 응답의 queue 가 지금 줄 상태(app.ladderQ)를 맞춘다
  if (data?.join) join();
  paintMe(); paintQ();
  setTimeout(() => { if (!root.contains(document.activeElement)) (q.querySelector('button') ?? backBtn).focus({ preventScroll: true }); }, 30);

  return {
    onLadderStatus() { if (app.ladderStatus?.queue) app.ladderQ = app.ladderStatus.queue; paintMe(); paintQ(); },
    onLadderQueue(m) { if (!m.queued && m.reason === 'cancel') want = false; paintQ(); },
    onWelcome() { net.send('ladder_status'); if (want) net.send('ladder_join'); }, // 끊기면 서버가 줄에서 뺀다(알림 없음): 다시 선다
    onNetClose() { if (app.ladderQ?.queued) { app.ladderQ = { queued: false, reason: 'disconnect' }; paintQ(); } },
    unmount() { clearInterval(tick); clearInterval(poll); offNav(); },
  };
}
