// 대기실(시안 A): 1P(하늘)/2P(빨강) 좌석 창 + VS + 명령(팀 변경·준비 완료·시작·나가기).
// 시작 = 방장만. 2명이 모이고 방장이 아닌 사람이 준비 완료여야 한다(room.start). 조건이 안 되면 버튼은 흐리게 두고, 누르면 사유를 토스트로 낸다(인라인 문구 없음).
// 팀 변경 = 원작 팀 선택 화면(엠블럼 격자 + 1P/2P 커서 + 선수 얼굴 창). 확정하면 set_team(기존 메시지) 후 대기실로.
// 컴퓨터 좌석 팀은 서버가 정한다(클라이언트 지정 메시지 없음) → COM 커서는 표시만.
import { h, clear } from '../util.js';
import { net } from '../net.js';
import { toast } from '../ui.js';
import { ERR, ERR_CODE, TIER } from '../i18n.js';
import { available as prematchOk } from './prematch.js';
import { available as lineupOk } from './lineup.js';
import { rulesText } from './rules.js';
import { emblem, roster, glyphs, abbrOf, shortName, GRID_MAIN, arrowNav } from '../pix.js';
import * as F from './flame/store.js';
import { keepEmblem, snapsOf, snapLabel, snapRec, snapBody, snapFaces, snapRoster, SNAP_SLOTS } from './flame/ui.js';
import { roomPanel } from '../chat.js';
import { tierChip, placementGames } from './ladder.js';
import * as Invite from '../invite.js';

const PAGE_SPECIAL = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24]; // 스토리 전용 팀(목록 유지)
// 불꽃 팀(PROTOCOL §13.20-B): 「불꽃의 계승」 탭의 저장 팀 3칸. 칸의 id = set_team 에 보내는 값 그대로('flame:s1' | 'flame:s2' | 'flame:s3'), 원작 팀 칸은 숫자
const PAGE_FL = 2; // 쪽 번호: 0 학교 · 1 스페셜 · 2 불꽃의 계승
const isFl = (id) => typeof id === 'string';
const cellId = (el) => { const v = el?.dataset?.team; return v == null ? null : v.startsWith('flame:') ? v : +v; };
const RANK_MAX_TEAM = 21; // 래더 방은 SPECIAL(15~21)까지, 22~24 는 서버가 TEAM_INVALID(PROTOCOL §11.2)
// 팀 선택에서 한 번이라도 결정한 좌석('방코드:좌석'). 서버 좌석에는 「고른 적 있음」 표시가 없고(입장 기본값 = 좌석 번호 팀) 대기실은 규칙 창을 다녀오면 다시 마운트되므로 모듈 범위에 둔다
const decided = new Set();

export function mount(root, app) {
  let selecting = false, cur = null, page = 0, pdCur = null;
  let offNav = null;
  const setNav = (el, opts) => { offNav?.(); offNav = el ? arrowNav(el, opts) : null; };
  const teamOk = (id) => app.teams.some((t) => t.id === id);
  const teamText = (id) => { const t = app.teams.find((x) => x.id === id); return t ? t.label ?? t.name : id != null ? `팀 ${id + 1}` : ''; };
  const myIdx = () => app.room?.slots?.findIndex((s) => s && s.nick === app.nick) ?? -1;

  // ---------------- 불꽃 팀(PROTOCOL §13.20) ----------------
  // 「불꽃의 계승」 탭이 보이는 조건: 컴퓨터 대전 방의 방장 | 방장이 「불꽃 팀」을 허용한 사람끼리 일반 방(§13.25)의 두 사람, 래더 아님.
  // 탭 본문 = 저장 칸 3장(flame_state.profile.teams.s1~s3). 상태·카탈로그를 아직 못 받았거나 기능이 꺼졌으면(FLAME_UNAVAILABLE·versusTeam 꺼짐) 빈 상태 안내. 공식 규칙이면 카드를 흐리게(누르면 사유 토스트)
  const flWanted = () => !!app.room && !app.room.ranked && (!!app.room.vsCpu || app.room.rules?.flameTeams === true);
  const flCat = () => (app.flame && F.ensureCatalog(app.flame.catalogVer) ? F.catalog() : null);
  // 탭은 사람끼리 일반 방이면 허용이 꺼져 있어도 보인다(2026-11-22 사용자 제보: 저장 팀이 안 보여 저장이 안 된 줄 앎). 꺼져 있으면 카드 흐림 + 허용 안내 토스트(flLock)
  const flTab = () => !!app.room && !app.room.ranked && (app.room.vsCpu ? myIdx() === 0 : flWanted() || flCat()?.versusTeam?.humans === true);
  const flVs = () => (flTab() ? flCat()?.versusTeam ?? null : null);
  /** 불꽃 카드를 지금 못 고르는 사유 토스트 문구(허용 꺼짐 · 공식 규칙), 고를 수 있으면 null */
  const flLock = () => (!flWanted() ? (myIdx() === 0 ? '규칙에서 「불꽃 팀」을 허용하면 고를 수 있습니다' : '방장이 규칙에서 「불꽃 팀」을 허용하면 고를 수 있습니다') : !flRuleOk() ? ERR_CODE.FLAME_TEAM_RULES : null);
  /** 탭 본문의 칸 3개: {k, t(카드 | null)}. 기능이 꺼졌거나 상태가 없으면 전부 빈 칸 */
  const flSlots = () => { const V = flVs(), on = !!(V?.enabled && (app.room.vsCpu || V.humans === true)), T = on ? snapsOf(app.flame?.profile) : {}; return SNAP_SLOTS.map((k) => ({ k, t: on && (V.slots ?? SNAP_SLOTS).includes(k) ? T[k] ?? null : null })); };
  /** 고를 수 있는 칸 id(채워져 있고 쓸 수 있는 카드) */
  const flCells = () => (flTab() ? flSlots().filter((x) => x.t && x.t.usable !== false).map((x) => 'flame:' + x.k) : []);
  /** 규칙 창의 「불꽃 팀」 토글을 보일까(방장 · 사람끼리 일반 방 · 카탈로그 versusTeam.humans): 지금 값, 아니면 undefined(줄 없음) */
  const flToggle = () => { const r = app.room; return r && !r.vsCpu && !r.ranked && flCat()?.versusTeam?.humans === true ? r.rules?.flameTeams === true : undefined; };
  const flRuleOk = () => (app.room?.rules?.mode ?? 'knockout') === (F.catalog()?.versusTeam?.ruleMode ?? 'knockout');
  const flSum = (id) => app.flame?.profile?.teams?.[id.slice(6)] ?? null;
  /** 좌석이 고른 것: 불꽃 팀이면 'flame:<슬롯>', 아니면 팀 번호 */
  const selOf = (s) => (s?.flameTeam?.slot ? 'flame:' + s.flameTeam.slot : s?.team);
  /** 좌석·팀 창의 불꽃 팀 요약: 7명 작은 초상 한 줄 + 구간·승수(능력치·장비 없음) */
  const flBody = (t) => h('div.flt', snapFaces(t), h('div.flt-rec.tabular', snapRec(t)));
  if (app.room && !app.room.ranked && !app.flame) net.send('flame_get'); // 방 안에서도 받을 수 있다(슬롯 유무·규칙 창 토글용 카탈로그). 응답 = flame_state(main.js -> onFlameState)
  // 카탈로그 미리 받기: 규칙 창을 처음 열 때 「불꽃 팀」 줄이 빠지지 않게(캐시 ver 비교·중복 요청 방지는 ensureCatalog)
  const flPrefetch = () => { if (app.room && !app.room.ranked && app.flame) F.ensureCatalog(app.flame.catalogVer); };
  flPrefetch();

  // 래더 방(PROTOCOL §11.2): 좌석마다 티어 칩 + 레이팅(slots[i].tier·rating·placement), 손님 좌석은 「손님」 칩.
  // 머리줄 = 「반영」/「미반영」(내가 손님이거나 같은 상대 제한 room.ladder.counted:false) + 시작 기한(startBy) 카운트다운
  // 좌석 머리줄 오른쪽 뱃지(방장·준비 뱃지 왼쪽에 나란히): 손님 = 「게스트」 회색 칩, 계정 = 래더 칩(서버가 tier 를 주면 티어 색·이름, 배치 중이면 흐린 칩, 없으면 숫자 칩) + 승·패 칩.
  // 컴퓨터 좌석·필드 없는 응답은 없음. 티어는 클라이언트에서 계산하지 않는다(slots[i].tier·placement 그대로). 래더 방의 「배치 n/5」 칩은 그대로 둔다
  const seatBadges = (s, ladder) => {
    if (s?.guest === true) return [h('span.tag.tier.t-guest', '게스트')];
    if (!Number.isInteger(s?.rating)) return [];
    const place = s.placement === true, tn = !place && TIER[s.tier] ? TIER[s.tier] : null;
    const out = [];
    if (ladder && place) out.push(tierChip(null, { placement: true, left: s.placementLeft, games: placementGames(app) }));
    out.push(h('span.tag.tier.tabular' + (tn ? '.t-' + s.tier : place ? '.t-place' : '.t-num'), { 'aria-label': `래더 ${tn ?? ''} ${s.rating}`.replace(/\s+/g, ' ') }, `${tn ?? '래더'} ${s.rating}`));
    if (Number.isInteger(s.w) && Number.isInteger(s.l)) out.push(h('span.tag.wl.tabular', h('span.w', `${s.w}승`), h('span.l', `${s.l}패`))); // 한 칩 두 색 반쪽(승 초록·패 빨강): 좌석 머리줄 한 줄 유지
    return out;
  };
  /** 이번 판이 내 점수에 반영되는가: 계정 + 같은 상대 제한 아님(손님 상대도 반영, K 16 — PROTOCOL §11.1) */
  const ladderCounted = (r) => !!r?.ladder && r.ladder.counted !== false && !!app.account;
  const cdEl = h('span.tag.ld-cd.tabular', { title: '시작 기한' });
  const paintCd = () => {
    const by = app.room?.ladder?.startBy; if (!by || app.room.status !== 'waiting') { cdEl.hidden = true; return; }
    const left = Math.max(0, Math.ceil((by - net.now()) / 1000));
    cdEl.hidden = false; cdEl.textContent = `시작 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    cdEl.classList.toggle('warn', left <= 30);
  };
  const cdTick = setInterval(paintCd, 500);

  // 준비 완료였는데 서버가 풀었을 때(규칙 변경·내 팀 변경·방장의 불꽃 팀 변경) 한 번 알린다. 내가 누른 준비 취소·경기 종료는 알리지 않는다
  let prev = null;
  function noteReady() {
    const r = app.room, i = myIdx(), m = r?.slots?.[i], o = r?.slots?.[1 - i];
    const now = m && !m.host ? { ready: m.ready, rules: `${r.rules?.mode}/${r.rules?.time}/${r.rules?.flameTeams === true}`, team: selOf(m), myFt: !!m.flameTeam,
      opp: o?.flameTeam ? JSON.stringify(o.flameTeam) : null } : null; // opp = 방장의 불꽃 팀 선택(슬롯·요약). 바뀌면 서버가 내 준비를 푼다(§13.25 D53 (6))
    if (prev?.ready && now && !now.ready && r.status === 'waiting') {
      if (prev.rules !== now.rules) { if (!(prev.myFt && !now.myFt)) toast(ERR.READY_RESET_RULES, 'warn'); } // 허용을 꺼 내 불꽃 팀이 풀린 경우는 서버 토스트(FLAME_TEAM_CLEARED)만
      else if (prev.team !== now.team) toast(ERR.READY_RESET_TEAM, 'warn');
      else if (prev.opp !== now.opp) toast(ERR.READY_RESET_OPP, 'warn');
    }
    prev = now;
  }

  function update() {
    const r = app.room; if (!r) return;
    noteReady();
    if (selecting && myIdx() >= 0 && r.status === 'waiting') {
      // 방장이 「불꽃 팀」 허용을 바꾸면 「불꽃의 계승」 탭이 생기거나 사라진다: 탭·칸이 달라졌을 때만 다시 그린다
      if (page === PAGE_FL && !flTab()) { page = 0; if (isFl(cur)) cur = pageTeams(0)[0] ?? 0; }
      const tabNow = flTab(), tabShown = !!root.querySelector('.tpage [data-pg=fl]');
      if (!root.querySelector('.tsel')) paintSelect();
      else if (shownSig !== pageSig(page) || tabNow !== tabShown) { if (page !== PAGE_FL && !pageTeams(page).includes(cur)) cur = pageTeams(page)[0] ?? 0; paintSelect(false); } else marks();
    } else { selecting = false; paintRoom(); }
  }

  // ---------------- 대기실 ----------------
  function paintRoom() {
    const r = app.room;
    const me = myIdx();
    const mine = r.slots[me];
    const had = document.activeElement?.dataset?.cmd;
    // 채팅 패널(room.chat, 사람끼리 방): 재그리기 밖에 두고 같은 요소를 옮겨 입력 중 글자·스크롤·포커스를 지킨다
    const chat = r.chat === true ? roomPanel(app) : null;
    const old = [...root.childNodes];
    const seat = (i) => {
      const s = r.slots[i];
      const cpu = isCpuSeat(r, i);
      const lab = h('b.pl.' + (cpu ? 'com' : i ? 'p2' : 'p1'), cpu ? 'COM' : i ? '2P' : '1P');
      if (!s && !cpu) return h('section.seat.s' + i, h('div.seat-top', lab), h('div.seat-empty', '빈 자리'));
      const rdy = !cpu && !s.host && s.ready;
      const tag = cpu ? h('span.tag.cpu', `난이도 ${cpuLevel(r, s)}`)
        : s.host ? h('span.tag.host', '방장') : h('span.tag.rdy' + (rdy ? '.on' : ''), rdy ? '준비 완료' : '준비 중');
      const team = s?.team, ft = s?.flameTeam ?? null; // ft = 고른 불꽃 팀 요약(그때 team 은 주장 칸의 몸 출처 팀)
      return h('section.seat.s' + i + (i === me ? '.me' : '') + (rdy ? '.is-ready' : ''), { 'aria-label': `${i ? '오른쪽' : '왼쪽'} 좌석` },
        h('div.seat-top', lab, h('span.seat-nick', cpu ? '컴퓨터' : s.nick),
          h('span.seat-tags', s && !s.connected && !cpu ? h('span.tag.off', '연결 끊김') : null, cpu ? null : seatBadges(s, !!r.ladder), tag)),
        ft ? [
          h('div.seat-team.fl', { 'aria-label': `${ft.team?.name || '불꽃 팀'} · ${snapLabel(ft.slot)} · ${snapRec(ft)}` }, keepEmblem(), h('span.tn', ft.team?.name || '불꽃 팀'),
            i === me ? h('button.chg', { type: 'button', 'data-cmd': 'chg', onclick: openSelect }, '변경 ▶') : null),
          snapRoster(ft, i === 0), // 원작 팀 좌석과 같은 구성(슬롯·구간·승은 화면에 내지 않는다, 2026-11-22 사용자 지시)
        ] : team != null ? [
          h('div.seat-team', emblem(team), h('span.tn', teamText(team)),
            i === me ? h('button.chg', { type: 'button', 'data-cmd': 'chg', onclick: openSelect }, '변경 ▶') : null),
          roster(team, i === 0),
        ] : null);
    };
    const cmds = [];
    if (mine) cmds.push(h('button.btn', { type: 'button', 'data-cmd': 'team', onclick: openSelect }, '팀 변경'));
    if (mine?.host) {
      // 래더 방은 녹아웃·5분 고정: 흐리게 두고 누르면 사유 토스트(서버 RANKED_RULES_FIXED 와 같은 문구)
      cmds.push(r.ranked ? h('button.btn.dim', { type: 'button', 'data-cmd': 'rules', 'aria-disabled': 'true', onclick: () => toast(ERR.RANKED_RULES_FIXED, 'warn') }, '규칙')
        : h('button.btn', { type: 'button', 'data-cmd': 'rules', onclick: openRules }, '규칙'));
      // 조건 미달이어도 누를 수 있게 둔다(disabled 가 아니라 aria-disabled): 누르면 사유 토스트
      cmds.push(h('button.btn.primary' + (r.start.ok ? '' : '.dim'), { type: 'button', 'data-cmd': 'start', 'aria-disabled': r.start.ok ? null : 'true',
        onclick: () => { const st = app.room?.start; if (st && !st.ok) { toast(st.msg, 'warn'); return; } startFlow(); } }, '시작'));
    } else if (mine) {
      cmds.push(h('button.btn' + (mine.ready ? '' : '.primary'), { type: 'button', 'data-cmd': 'ready', onclick: () => net.send('ready', { ready: !mine.ready }) },
        mine.ready ? '준비 취소' : '준비 완료'));
    }
    cmds.push(h('button.btn', { type: 'button', 'data-cmd': 'leave', onclick: () => net.send('leave_room') }, '나가기'));
    const cmdsEl = h('div.cmds', { style: { '--n': cmds.length } }, cmds);
    root.append(h('div.screen.room',
      h('header.room-head', h('h1.pix-title', r.ladder ? '래더 대전' : r.vsCpu || !r.host ? '대기실' : `${r.host}의 방`),
        r.ladder ? h('span.tag.ld-cnt' + (ladderCounted(r) ? '.on' : ''), ladderCounted(r) ? '반영' : app.account ? '미반영' : '미반영(손님)') : null, r.ladder ? cdEl : null,
        r.rules ? h('span.rules-line', '규칙 ', h('b', rulesText(r.rules))) : null,
        h('span.spacer'), Invite.shareable(r) ? inviteBtn(r.code) : h('span.room-code', { title: '방 코드' }, r.code), h('span.nick-me', app.nick || '')),
      h('div.seats', seat(0), h('div.vs', { 'aria-hidden': 'true' }, 'VS'), seat(1)),
      chat ? h('div.room-foot', cmdsEl) : cmdsEl)); // 채팅이 있으면 아래 줄 = 왼쪽 채팅 + 오른쪽 명령 창
    if (chat) chat.mount(cmdsEl);
    for (const n of old) n.remove();
    paintCd();
    setNav(root);
    const want = root.querySelector(`[data-cmd="${had ?? (mine?.host ? 'start' : 'ready')}"]:not(:disabled)`) ?? root.querySelector('[data-cmd="team"]');
    if (had || document.activeElement === document.body || !root.contains(document.activeElement)) want?.focus({ preventScroll: true });
  }

  // 규칙 창(원작 팀 선택 다음 화면). 방장이 고르면 set_rules -> room_state 로 두 사람 모두에게 반영(상대 준비 해제)
  function openRules() {
    const r = app.room; if (!r) return;
    app.go('rules', { rules: r.rules, onCancel: () => app.go('room'),
      flameTeams: flToggle(), // 사람끼리 일반 방: 「불꽃 팀」 허용(§13.25). 끄면 고른 사람의 선택이 풀리고 서버가 그 사람에게 토스트(FLAME_TEAM_CLEARED)
      flameTeamsLate: flToggle, // 창이 열린 뒤 상태·카탈로그가 도착하면 규칙 창이 다시 묻는다(줄을 그때 끼운다)
      onDone: (v) => { if (v.mode !== r.rules?.mode || v.time !== r.rules?.time || ('flameTeams' in v && v.flameTeams !== (r.rules?.flameTeams === true))) net.send('set_rules', { rules: v }); app.go('room'); } });
  }

  // 시작 직전 경기 전 화면(원작: 라인업 VS -> 편성 1P -> 편성 COM). 서버 변경 없이 클라이언트에서 끼운다. 마지막 화면에서 start 전송
  function startFlow() {
    const r = app.room, me = myIdx();
    const mine = r?.slots?.[me]?.team, theirs = r?.slots?.[1 - me]?.team;
    // 불꽃 팀: 경기 전 화면(라인업·편성)은 원작 팀 번호로 그려 내 팀과 맞지 않고, 상대 팀도 시작 때 다시 뽑힐 수 있다 -> 건너뛴다
    if (me < 0 || mine == null || theirs == null || r.slots[me].flameTeam) { net.send('start'); return; }
    const lab = (i) => (isCpuSeat(r, i) ? 'COM' : i ? '2P' : '1P');
    const back = () => app.go('room');
    const steps = [];
    if (lineupOk()) steps.push((next) => app.go('lineup', { teams: [r.slots[0].team, r.slots[1].team], labels: [lab(0), lab(1)], onCancel: back, onExit: next }));
    if (prematchOk()) {
      steps.push((next) => app.go('prematch', { team: mine, label: lab(me), onCancel: back, onExit: next }));
      steps.push((next) => app.go('prematch', { team: theirs, label: lab(1 - me), onCancel: back, onExit: next }));
    }
    const run = (i) => (i < steps.length ? steps[i](() => run(i + 1)) : net.send('start'));
    run(0);
  }

  // ---------------- 팀 선택 ----------------
  function openSelect() {
    const me = myIdx(); if (me < 0) return;
    selecting = true;
    cur = selOf(app.room.slots[me]) ?? 0;
    if (isFl(cur) && !flCells().includes(cur)) cur = app.room.slots[me]?.team ?? 0; // 슬롯 요약을 아직 받지 못했다: 원작 팀 칸에서 시작
    // 「불꽃 팀」 허용 방(사람끼리, §13.25): 아직 고른 적 없는 입장 기본값이면 「불꽃의 계승」 탭의 첫 카드에서 시작한다(하플레이 M4).
    // 고르기만, 결정은 종전처럼 누를 때. 이미 고른 팀이 있으면 그 칸(커서 = 현재 팀), 규칙이 불꽃 팀을 못 쓰는 모드면 옮기지 않는다(정검수 M)
    const s0 = app.room.slots[me], fresh = !decided.has(`${app.room.code}:${me}`) && !s0?.flameTeam && s0?.team === me;
    if (fresh && !isFl(cur) && app.room.rules?.flameTeams === true && flRuleOk() && flCells().length) cur = flCells()[0];
    page = isFl(cur) ? PAGE_FL : PAGE_SPECIAL.includes(cur) ? 1 : 0;
    paintSelect(true);
  }
  function closeSelect() { selecting = false; paintRoom(); root.querySelector('[data-cmd="team"]')?.focus(); }
  function confirm(team) {
    const s = app.room?.slots?.[myIdx()];
    if (isFl(team) && flLock()) { toast(flLock(), 'warn'); return; }
    if (s) decided.add(`${app.room.code}:${myIdx()}`);
    if (s && selOf(s) !== team) net.send('set_team', { team });
    closeSelect();
  }
  // 쪽 0·1 = 원작 팀 격자, 쪽 2 = 불꽃의 계승 카드(고를 수 있는 칸만)
  const pageTeams = (p) => (p === PAGE_FL ? flCells() : (p ? PAGE_SPECIAL : GRID_MAIN).filter((id) => teamOk(id) && !(app.room?.ranked && id > RANK_MAX_TEAM)));
  /** 지금 그린 칸 서명(상태가 바뀌어 다시 그릴지): 불꽃 쪽은 카드 내용까지 */
  const pageSig = (p) => (p === PAGE_FL ? JSON.stringify(flSlots()) + flLock() : pageTeams(p).join());
  let shownSig = '';

  function paintSelect(focusCur = false) {
    const fl = page === PAGE_FL, list = pageTeams(page);
    const fe = document.activeElement;
    const focusedTeam = focusCur ? cur : cellId(fe);
    const focusHead = !focusCur && fe?.closest?.('.tsel-head') ? fe.dataset.pg ?? fe.textContent : null;
    clear(root);
    shownSig = pageSig(page);
    const cells = fl ? null : list.map((id) => h('button.tcell', { type: 'button', 'data-team': id, 'aria-label': teamText(id),
      // 마우스·터치: 첫 누름 = 커서 이동, 커서가 있던 칸을 다시 누름 = 결정. 키보드 포커스 이동도 커서를 옮긴다
      onpointerdown: () => { pdCur = cur; },
      onfocus: () => { if (cur !== id) move(id); },
      onclick: () => { const prev = pdCur ?? cur; pdCur = null; if (prev === id) confirm(id); else move(id); } },
      h('span.cl.c0'), h('span.cl.c1'), emblem(id), h('span.ab', glyphs(abbrOf(id))), h('span.nm', shortName(id, teamText(id)))));
    const tab = (pg, label, on) => h('button.btn.small', { type: 'button', 'data-pg': pg, 'aria-pressed': String(on), onclick: () => setPage(+pg) }, label);
    root.append(h('div.screen.tsel' + (fl ? '.flp' : ''),
      h('header.tsel-head', h('h1.pix-title', '팀 선택'),
        h('div.tpage', { role: 'group', 'aria-label': '팀 목록' },
          tab('0', '학교', page === 0), tab('1', '스페셜', page === 1),
          // 「불꽃의 계승」 탭(쓸 수 있는 방만). 좁아 탭 줄이 머리줄 폭을 넘으면 「불꽃」(fitTabs)
          flTab() ? h('button.btn.small.kp-tab', { type: 'button', 'data-pg': 'fl', 'aria-pressed': String(fl), 'aria-label': '불꽃의 계승', onclick: () => setPage(PAGE_FL) }, h('span.tl-l', '불꽃의 계승'), h('span.tl-s', '불꽃')) : null),
        h('button.btn.small.back', { type: 'button', onclick: closeSelect }, '돌아가기')),
      h('div.tsel-body',
        fl ? flPage() : h('section.pwin.tgrid-win', h('div.tgrid', { role: 'group', 'aria-label': '팀을 고르세요', onkeydown: gridKey }, cells)),
        h('div.tside', h('div.tinfo-slot'), h('div.tinfo-slot')))));
    fitTabs();
    marks();
    setNav(root.querySelector('.tsel'), { onEsc: closeSelect });
    const f = focusedTeam != null ? root.querySelector(`[data-team="${focusedTeam}"]`)
      : focusHead != null ? [...root.querySelectorAll('.tsel-head button')].find((b) => (b.dataset.pg ?? b.textContent) === focusHead) : null;
    f?.focus({ preventScroll: true });
    if (fl && f) f.scrollIntoView?.({ block: 'nearest' });
  }
  /** 탭 줄이 머리줄 폭을 넘으면 「불꽃의 계승」 → 「불꽃」 */
  function fitTabs() {
    const tp = root.querySelector('.tpage'), hd = root.querySelector('.tsel-head');
    if (!tp || !tp.querySelector('[data-pg=fl]')) return;
    tp.classList.remove('short');
    if (tp.scrollWidth > hd.clientWidth) tp.classList.add('short');
  }
  /** 「불꽃의 계승」 탭 본문: 칸 카드 3장 세로(빈 칸 = 점선 카드). 3칸 모두 비면 가운데 안내 두 줄(+ 컴퓨터 대전 방만 「불꽃의 계승 하러 가기」) */
  function flPage() {
    const xs = flSlots(), off = !!flLock();
    if (!xs.some((x) => x.t)) {
      // 방을 나간 뒤(room_left) 불꽃의 계승 화면으로: main.js 가 app.leaveTo 를 본다. 한 번 누르면 비활성(겹쳐 보내지 않게)
      const go = app.room?.vsCpu ? h('button.btn.primary.sn-go', { type: 'button', 'data-k': 'fl-go', onclick: (e) => { if (app.leaveTo) return; e.currentTarget.disabled = true; app.leaveTo = 'flame'; net.send('leave_room'); } }, '불꽃의 계승 하러 가기') : null;
      // 도전 이력(profile.played)이 있는데 칸이 비었다 = 저장만 안 했다: 저장 안내. 이력 없는 손님·미플레이 계정 = 모드 소개
      const tip = app.flame?.profile?.played === true ? '도전 중이나 끝난 뒤 팀을 저장해 보세요' : '한번 즐겨 보세요';
      return h('section.pwin.sn-win.sn-none', h('div.sn-none-t', h('p', '불꽃의 계승에서 키운 팀으로 대전할 수 있어요'), h('p', tip)), go);
    }
    return h('section.pwin.sn-win', h('div.sn-list', { role: 'group', 'aria-label': '저장 팀', onkeydown: flKey }, xs.map(({ k, t }) => {
      if (!t) return h('button.sn-card.sn-empty', { type: 'button', 'data-k': 'sn-' + k, onclick: () => toast('불꽃의 계승에서 팀을 저장할 수 있습니다', 'info') }, h('b.sn-slot', snapLabel(k)), h('span', '빈 슬롯'));
      const id = 'flame:' + k, dead = t.usable === false;
      return h('button.sn-card.sn-pick' + (off || dead ? '.off' : ''), { type: 'button', 'data-team': dead ? null : id, 'data-k': 'sn-' + k,
        'aria-label': `${snapLabel(k)} ${t.team?.name ?? ''} ${snapRec(t)}`, 'aria-disabled': off || dead ? 'true' : null,
        onpointerdown: () => { pdCur = cur; },
        onfocus: () => { if (!off && !dead && cur !== id) move(id); },
        onclick: () => {
          const prev = pdCur ?? cur; pdCur = null;
          if (dead) { toast(ERR.FLAME_TEAM_UNUSABLE, 'warn'); return; }
          if (off) { toast(flLock(), 'warn'); return; }
          if (prev === id) confirm(id); else move(id);
        } }, snapBody(t, k));
    })));
  }
  /** 카드 목록 키: ↑↓ = 고를 수 있는 카드 사이(끝에서 순환), ←→ = 지금 카드의 선수 줄 가로 스크롤, Esc = 돌아가기. Enter·Space = 버튼 누름(커서 칸이면 결정) */
  function flKey(e) {
    if (e.isComposing) return;
    pdCur = null;
    const k = e.key;
    if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); e.stopPropagation(); closeSelect(); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const row = e.target.closest?.('.sn-card')?.querySelector('.sn-row'); if (!row) return;
      e.preventDefault(); e.stopPropagation();
      const w = row.querySelector('.sn-p')?.getBoundingClientRect().width ?? 100;
      row.scrollBy({ left: k === 'ArrowRight' ? w : -w });
      return;
    }
    if (k !== 'ArrowUp' && k !== 'ArrowDown') return;
    e.preventDefault(); e.stopPropagation();
    const l = flCells(); if (!l.length) return;
    const i = l.indexOf(cur), n = i < 0 ? 0 : (i + (k === 'ArrowDown' ? 1 : -1) + l.length) % l.length;
    move(l[n]);
  }
  /** 커서 표시(1P/2P/COM 라벨·테두리)와 오른쪽 팀 창만 다시 그린다(격자 버튼은 유지 → 클릭·포커스가 끊기지 않게) */
  function marks() {
    const r = app.room, me = myIdx(), other = 1 - me;
    // 상대가 고른 불꽃 팀은 상대 계정의 슬롯이라 내 격자의 같은 이름 칸(내 슬롯)과 다르다: 격자에 상대 커서를 두지 않는다(오른쪽 팀 창에만 요약)
    const oTeam = r.slots[other]?.flameTeam ? 'x:other' : selOf(r.slots[other]), mySel = selOf(r.slots[me]);
    const cpu = [isCpuSeat(r, 0), isCpuSeat(r, 1)];
    for (const el of root.querySelectorAll('.sn-pick[data-team]')) { const id = el.dataset.team; el.classList.toggle('mine', cur === id); el.classList.toggle('s1', cur === id && me === 1); el.setAttribute('aria-pressed', String(mySel === id)); }
    for (const el of root.querySelectorAll('.tcell')) {
      const id = cellId(el);
      const at = [me === 0 ? cur === id : oTeam === id, me === 1 ? cur === id : oTeam === id];
      el.classList.toggle('at0', at[0]); el.classList.toggle('at1', at[1]);
      el.classList.toggle('mine', cur === id); el.classList.toggle('s1', cur === id && me === 1);
      el.setAttribute('aria-pressed', String(mySel === id));
      const [c0, c1] = el.querySelectorAll('.cl');
      c0.textContent = at[0] ? (cpu[0] ? 'COM' : '1P') : '';
      c1.textContent = at[1] ? (cpu[1] ? 'COM' : '2P') : '';
      c1.classList.toggle('com', cpu[1]);
    }
    for (const b of root.querySelectorAll('.tpage [data-pg]')) b.setAttribute('aria-pressed', String(b.dataset.pg === 'fl' ? page === PAGE_FL : page === +b.dataset.pg));
    const slots = root.querySelectorAll('.tinfo-slot');
    slots.forEach((slot, i) => slot.replaceChildren(info(i)));
  }
  function info(i) {
    const r = app.room, me = myIdx();
    const s = r.slots[i];
    const cpu = isCpuSeat(r, i);
    const t = i === me ? cur : selOf(s);
    const lab = h('b.pl.' + (cpu ? 'com' : i ? 'p2' : 'p1'), cpu ? 'COM' : i ? '2P' : '1P');
    if (t == null) return h('section.pwin.tinfo', h('div.tinfo-top', lab, h('span.tn.muted', '빈 자리')));
    let st;
    // 잠김(공식 규칙 등 불꽃 팀을 못 쓰는 규칙에서 불꽃 칸에 커서): 「결정」 흐림 + 팀 요약 회색. 누르면 사유 토스트(confirm)
    const locked = i === me && isFl(t) && !!flLock();
    if (i === me) {
      st = selOf(s) === cur ? h('div.tinfo-st.done', '결정 완료')
        : h('div.tinfo-st', h('span.tinfo-stt', '고르는 중'), h('button.btn.small.primary' + (locked ? '.dim' : ''), { type: 'button', 'aria-disabled': locked ? 'true' : null, onclick: () => confirm(cur) }, '결정'));
    } else st = h('div.tinfo-st.done', cpu ? '컴퓨터' : '결정 완료');
    if (isFl(t)) { // 불꽃 팀: 7명 작은 초상 한 줄 + 구간·승수(능력치·장비는 내 카드에만)
      const theirs = s?.flameTeam?.slot === t.slice(6) ? s.flameTeam : null; // 상대 좌석 = 그 사람 슬롯 요약(room_state), 내 좌석 = 내 카드
      const ft = i === me ? flSum(t) ?? theirs : theirs, nm = `불꽃 팀 ${snapLabel(t.slice(6))}`;
      return h('section.pwin.tinfo.fl.s' + i + (locked ? '.off' : ''), { 'aria-label': `${i ? '2P' : '1P'} ${nm}` },
        h('div.tinfo-top', lab, keepEmblem(), h('span.tn', ft?.team?.name || '불꽃 팀', h('span.sn-sl', ' · ' + snapLabel(t.slice(6))))), ft ? flBody(ft) : null, st);
    }
    return h('section.pwin.tinfo.s' + i, { 'aria-label': `${cpu ? 'COM' : i ? '2P' : '1P'} ${teamText(t)}` },
      h('div.tinfo-top', lab, emblem(t), h('span.tn', teamText(t))), roster(t, i === 0), st);
  }
  function setPage(p) {
    if (page === p) return;
    page = p;
    const l = pageTeams(page);
    if (!l.includes(cur)) cur = l[0] ?? (p === PAGE_FL ? selOf(app.room.slots[myIdx()]) : cur); // 불꽃 쪽에 고를 카드가 없으면 커서는 지금 팀 그대로
    paintSelect(false);
  }
  function move(id) {
    cur = id;
    const el = root.querySelector(`[data-team="${id}"]`);
    if (!el) { paintSelect(true); return; }
    marks();
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
  }
  // 원작 규칙: 방향 1회 = 1칸, 좌우·상하 끝에서 반대편으로 순환. 학교(3행) 아래 끝 ↔ SPECIAL(2행) 이어짐. Enter/Space = 결정, Esc = 돌아가기
  function gridKey(e) {
    if (e.isComposing) return;
    pdCur = null;
    const k = e.key;
    if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); e.stopPropagation(); closeSelect(); return; }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
    e.preventDefault(); e.stopPropagation();
    if (page === PAGE_FL) return;
    const pages = [pageTeams(0), pageTeams(1)];
    let p = page, l = pages[p];
    if (!l.length) return;
    const i = Math.max(0, l.indexOf(cur));
    const rows = (x) => Math.ceil(x.length / 5);
    let c = i % 5, rr = Math.floor(i / 5);
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const rowLen = Math.min(5, l.length - rr * 5);
      c = (c + (k === 'ArrowRight' ? 1 : -1) + rowLen) % rowLen;
    } else if (k === 'ArrowDown') {
      if (rr + 1 < rows(l)) rr++;
      else if (pages[1 - p].length) { p = 1 - p; l = pages[p]; rr = 0; } else rr = 0;
    } else if (rr > 0) rr--;
    else if (pages[1 - p].length) { p = 1 - p; l = pages[p]; rr = rows(l) - 1; } else rr = rows(l) - 1;
    const ni = Math.min(l.length - 1, rr * 5 + c);
    if (p !== page) { page = p; cur = l[ni]; paintSelect(true); } else move(l[ni]);
  }

  update();
  // 슬롯 요약·카탈로그가 뒤늦게 오면 팀 선택 화면의 불꽃 팀 칸을 다시 맞춘다. 슬롯이 없다는 거절이면 요약을 새로 받는다(칸이 사라진다)
  const onFlame = () => {
    if (!selecting || !root.querySelector('.tsel')) return;
    if (page !== PAGE_FL && !pageTeams(page).includes(cur)) cur = pageTeams(page)[0] ?? 0;
    else if (page === PAGE_FL && isFl(cur) && !flCells().includes(cur)) cur = flCells()[0] ?? selOf(app.room.slots[myIdx()]);
    if (shownSig !== pageSig(page) || flTab() !== !!root.querySelector('.tpage [data-pg=fl]')) paintSelect(false); else marks();
  };
  return { update, onFlameState: () => { flPrefetch(); onFlame(); }, onFlameCatalog: onFlame,
    onError: (m) => { if (m?.code === 'FLAME_TEAM_NONE' && flWanted()) net.send('flame_get'); }, unmount: () => { clearInterval(cdTick); setNav(null); app.leaveTo = null; } }; // leaveTo: room_left 가 쓰기 전에 화면을 떠나면 남지 않게(main.js 는 대기실에서만 본다)
}

// 초대 칩(사람끼리 일반 방만): 「초대링크 복사」, 누르면 초대 URL 복사(invite.js). 코드는 글자로 보이지 않고 data-code 로만. data-cmd = 재그리기 뒤 포커스 유지
const SVG = 'http://www.w3.org/2000/svg';
function linkIcon() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 10 5'); svg.setAttribute('class', 'lnk-ic'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('fill', 'currentColor');
  for (const [x, y, w, hh] of [[1, 0, 3, 1], [0, 1, 1, 3], [1, 4, 3, 1], [6, 0, 3, 1], [9, 1, 1, 3], [6, 4, 3, 1], [3, 2, 4, 1]]) {
    const q = document.createElementNS(SVG, 'rect'); q.setAttribute('x', x); q.setAttribute('y', y); q.setAttribute('width', w); q.setAttribute('height', hh); svg.append(q);
  }
  return svg;
}
function inviteBtn(code) {
  const b = h('button.room-code.invite', { type: 'button', 'data-cmd': 'invite', 'data-code': code, 'aria-label': '초대링크 복사',
    onclick: () => { b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); Invite.copy(code); } },
  linkIcon(), h('span.iv-t', '초대링크 복사'));
  return b;
}

/** 컴퓨터 대전 좌석 판정 (PROTOCOL 4: room.vsCpu / slot.cpu) */
export function isCpuSeat(r, i) {
  const s = r?.slots?.[i];
  return !!(s?.cpu || (r?.vsCpu && i === 1));
}
function cpuLevel(r, s) { return s?.cpuLevel ?? r?.cpuLevel ?? 2; }
