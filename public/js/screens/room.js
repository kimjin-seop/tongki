// 대기실(시안 A): 1P(하늘)/2P(빨강) 좌석 창 + VS + 명령(팀 변경·준비 완료·시작·나가기).
// 시작 = 방장만. 2명이 모이고 방장이 아닌 사람이 준비 완료여야 한다(room.start). 조건이 안 되면 버튼은 흐리게 두고, 누르면 사유를 토스트로 낸다(인라인 문구 없음).
// 팀 변경 = 원작 팀 선택 화면(엠블럼 격자 + 1P/2P 커서 + 선수 얼굴 창). 확정하면 set_team(기존 메시지) 후 대기실로.
// 컴퓨터 좌석 팀은 서버가 정한다(클라이언트 지정 메시지 없음) → COM 커서는 표시만.
import { h, clear } from '../util.js';
import { net } from '../net.js';
import { toast } from '../ui.js';
import { ERR, ERR_CODE } from '../i18n.js';
import { available as prematchOk } from './prematch.js';
import { available as lineupOk } from './lineup.js';
import { rulesText } from './rules.js';
import { emblem, roster, glyphs, abbrOf, shortName, GRID_MAIN, arrowNav } from '../pix.js';
import * as F from './flame/store.js';
import { rankName, keepEmblem, keepGlyph } from './flame/ui.js';

const PAGE_SPECIAL = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24]; // 스토리 전용 팀(목록 유지)
// 불꽃 팀 칸(PROTOCOL §13.20): 불꽃의 계승에서 키운 팀 슬롯. 칸의 id = set_team 에 보내는 값 그대로('flame:recent' | 'flame:best'), 원작 팀 칸은 숫자
const FL_LABEL = { recent: '최근', best: '최고' };
const isFl = (id) => typeof id === 'string';
const cellId = (el) => { const v = el?.dataset?.team; return v == null ? null : v.startsWith('flame:') ? v : +v; };
const RANK_MAX_TEAM = 21; // 랭크 방은 SPECIAL(15~21)까지, 22~24 는 서버가 TEAM_INVALID(PROTOCOL §11.2)
// 팀 선택에서 한 번이라도 결정한 좌석('방코드:좌석'). 서버 좌석에는 「고른 적 있음」 표시가 없고(입장 기본값 = 좌석 번호 팀) 대기실은 규칙 창을 다녀오면 다시 마운트되므로 모듈 범위에 둔다
const decided = new Set();
const EVADE_NOTE = '필살슛 유도 — 받아내야 막힙니다'; // room.evade==='track'(사람끼리 일반 방) 대기실 안내 한 줄

export function mount(root, app) {
  let selecting = false, cur = null, page = 0, pdCur = null;
  let offNav = null;
  const setNav = (el, opts) => { offNav?.(); offNav = el ? arrowNav(el, opts) : null; };
  const teamOk = (id) => app.teams.some((t) => t.id === id);
  const teamText = (id) => { const t = app.teams.find((x) => x.id === id); return t ? t.label ?? t.name : id != null ? `팀 ${id + 1}` : ''; };
  const myIdx = () => app.room?.slots?.findIndex((s) => s && s.nick === app.nick) ?? -1;

  // ---------------- 불꽃 팀(PROTOCOL §13.20) ----------------
  // 칸이 보이는 조건: (컴퓨터 대전 방의 방장 | 방장이 「불꽃 팀」을 허용한 사람끼리 일반 방(§13.25)의 두 사람) + 랭크 아님 + flame_catalog.versusTeam.enabled(사람끼리는 .humans 도)
  //   + 그 슬롯의 요약(flame_state.profile.teams)이 있음. 공식 규칙이면 흐리게(누르면 사유 토스트)
  const flWanted = () => !!app.room && !app.room.ranked && (!!app.room.vsCpu || app.room.rules?.flameTeams === true);
  const flCat = () => (app.flame && F.ensureCatalog(app.flame.catalogVer) ? F.catalog() : null);
  const flVs = () => (flWanted() ? flCat()?.versusTeam ?? null : null);
  const flCells = () => { const V = flVs(); return V?.enabled && (app.room.vsCpu ? myIdx() === 0 : V.humans === true) ? (V.slots ?? []).filter((k) => FL_LABEL[k] && app.flame.profile?.teams?.[k]).map((k) => 'flame:' + k) : []; };
  /** 규칙 창의 「불꽃 팀」 토글을 보일까(방장 · 사람끼리 일반 방 · 카탈로그 versusTeam.humans): 지금 값, 아니면 undefined(줄 없음) */
  const flToggle = () => { const r = app.room; return r && !r.vsCpu && !r.ranked && flCat()?.versusTeam?.humans === true ? r.rules?.flameTeams === true : undefined; };
  const flRuleOk = () => (app.room?.rules?.mode ?? 'knockout') === (F.catalog()?.versusTeam?.ruleMode ?? 'knockout');
  const flSum = (id) => app.flame?.profile?.teams?.[id.slice(6)] ?? null;
  /** 좌석이 고른 것: 불꽃 팀이면 'flame:<슬롯>', 아니면 팀 번호 */
  const selOf = (s) => (s?.flameTeam?.slot ? 'flame:' + s.flameTeam.slot : s?.team);
  const flCore = (t) => (Array.isArray(t?.core) ? t.core : []).slice(0, 3).map(rankName).filter(Boolean);
  /** 핵심 3명 + 구간·승수 */
  const flBody = (t, core = true) => h('div.flt', core ? h('div.flt-core', flCore(t).map((n) => h('b', n))) : null,
    h('div.flt-rec.tabular', `구간 ${t.seg} · ${t.wins}승`));
  if (app.room && !app.room.ranked && !app.flame) net.send('flame_get'); // 방 안에서도 받을 수 있다(슬롯 유무·규칙 창 토글용 카탈로그). 응답 = flame_state(main.js -> onFlameState)
  // 카탈로그 미리 받기: 규칙 창을 처음 열 때 「불꽃 팀」 줄이 빠지지 않게(캐시 ver 비교·중복 요청 방지는 ensureCatalog)
  const flPrefetch = () => { if (app.room && !app.room.ranked && app.flame) F.ensureCatalog(app.flame.catalogVer); };
  flPrefetch();

  // 랭크 방(PROTOCOL §11.2): 좌석마다 레이팅. 서버가 좌석에 rating(정수)·placement 를 주면 그 값이 우선,
  // 없으면(구 서버) 순위표(ranking_list) 값으로 보완 — 내 줄(me)은 언제나, 상대는 상위 50명 안에 있을 때만. 상대가 바뀔 때만 다시 묻는다(분당 상한 공유)
  let askedFor = null;
  function askRatings() {
    const r = app.room; if (!r?.ranked) return;
    const s = r.slots?.[1 - myIdx()];
    if (Number.isInteger(s?.rating)) return;
    const opp = s?.nick ?? '';
    if (opp === askedFor) return;
    askedFor = opp; net.send('ranking_list', {});
  }
  function ratingOf(s) {
    if (Number.isInteger(s?.rating)) return s.placement === true ? '배치 중' : String(s.rating);
    const nick = s?.nick;
    const b = app.rankBoard; if (!b || !nick) return null;
    if (b.me && b.me.nick === nick) return b.me.placement ? '배치 중' : String(b.me.rating);
    const row = b.top?.find((x) => x.nick === nick);
    return row ? String(row.rating) : null;
  }

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
    askRatings();
    if (selecting && myIdx() >= 0 && r.status === 'waiting') {
      // 방장이 「불꽃 팀」 허용을 바꾸면 격자 칸(최근·최고)이 생기거나 사라진다: 칸 목록이 달라졌을 때만 격자를 다시 그린다
      const shown = [...root.querySelectorAll('.tcell')].map((el) => el.dataset.team).join(), want = pageTeams(page).join();
      if (!root.querySelector('.tsel')) paintSelect();
      else if (shown !== want) { if (!pageTeams(page).includes(cur)) cur = pageTeams(page)[0] ?? 0; paintSelect(false); } else marks();
    } else { selecting = false; paintRoom(); }
  }

  // ---------------- 대기실 ----------------
  function paintRoom() {
    const r = app.room;
    const me = myIdx();
    const mine = r.slots[me];
    const had = document.activeElement?.dataset?.cmd;
    clear(root);
    const seat = (i) => {
      const s = r.slots[i];
      const cpu = isCpuSeat(r, i);
      const lab = h('b.pl.' + (cpu ? 'com' : i ? 'p2' : 'p1'), cpu ? 'COM' : i ? '2P' : '1P');
      if (!s && !cpu) return h('section.seat.s' + i, h('div.seat-top', lab), h('div.seat-empty', '빈 자리'));
      const rdy = !cpu && !s.host && s.ready;
      const tag = cpu ? h('span.tag.cpu', `난이도 ${cpuLevel(r, s)}`)
        : s.host ? h('span.tag.host', '방장') : h('span.tag.rdy' + (rdy ? '.on' : ''), rdy ? '준비 완료' : '준비 중');
      const team = s?.team, ft = s?.flameTeam ?? null; // ft = 고른 불꽃 팀 요약(그때 team 은 주장 칸의 몸 출처 팀)
      const rate = r.ranked && s ? ratingOf(s) : null;
      return h('section.seat.s' + i + (i === me ? '.me' : '') + (rdy ? '.is-ready' : ''), { 'aria-label': `${i ? '오른쪽' : '왼쪽'} 좌석` },
        h('div.seat-top', lab, h('span.seat-nick', cpu ? '컴퓨터' : s.nick), s && !s.connected && !cpu ? h('span.tag.off', '연결 끊김') : null,
          rate ? h('span.tag.rate.tabular', { title: '레이팅' }, rate) : null, tag),
        ft ? [
          h('div.seat-team.fl', keepEmblem(), keepGlyph(ft.slot), h('span.tn', flCore(ft).join(' · ') || '불꽃 팀'),
            i === me ? h('button.chg', { type: 'button', 'data-cmd': 'chg', onclick: openSelect }, '변경 ▶') : null),
          flBody(ft, false),
        ] : team != null ? [
          h('div.seat-team', emblem(team), h('span.tn', teamText(team)),
            i === me ? h('button.chg', { type: 'button', 'data-cmd': 'chg', onclick: openSelect }, '변경 ▶') : null),
          roster(team, i === 0),
        ] : null);
    };
    const cmds = [];
    if (mine) cmds.push(h('button.btn', { type: 'button', 'data-cmd': 'team', onclick: openSelect }, '팀 변경'));
    if (mine?.host) {
      // 랭크 방은 녹아웃·5분 고정: 흐리게 두고 누르면 사유 토스트(서버 RANKED_RULES_FIXED 와 같은 문구)
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
    root.append(h('div.screen.room',
      h('header.room-head', h('h1.pix-title', r.vsCpu || !r.host ? '대기실' : `${r.host}의 방`), r.ranked ? h('span.tag.rank', '랭크') : null,
        r.rules ? h('span.rules-line', '규칙 ', h('b', rulesText(r.rules))) : null,
        // 읽기 전용(PROTOCOL §4 room.evade, §5.8). 사람끼리 일반 방만 'track'. 머리줄이 넘치면 줄바꿈 대신 말줄임(전문은 title)
        r.evade === 'track' ? h('span.rules-line.evade-note', { title: EVADE_NOTE }, h('span', EVADE_NOTE)) : null,
        h('span.spacer'), h('span.room-code', { title: '방 코드' }, r.code), h('span.nick-me', app.nick || '')),
      h('div.seats', seat(0), h('div.vs', { 'aria-hidden': 'true' }, 'VS'), seat(1)),
      h('div.cmds', { style: { '--n': cmds.length } }, cmds)));
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
    // 「불꽃 팀」 허용 방(사람끼리, §13.25): 아직 고른 적 없는 입장 기본값이면 보관 팀 칸(최근·최고)에서 시작한다(하플레이 M4: SPECIAL 쪽 끝이라 찾기 어려웠다).
    // 고르기만, 결정은 종전처럼 누를 때. 이미 고른 팀이 있으면 그 칸(커서 = 현재 팀), 규칙이 불꽃 팀을 못 쓰는 모드면 옮기지 않는다(정검수 M)
    const s0 = app.room.slots[me], fresh = !decided.has(`${app.room.code}:${me}`) && !s0?.flameTeam && s0?.team === me;
    if (fresh && !isFl(cur) && app.room.rules?.flameTeams === true && flRuleOk() && flCells().length) cur = flCells()[0];
    page = PAGE_SPECIAL.includes(cur) || isFl(cur) ? 1 : 0;
    paintSelect(true);
  }
  function closeSelect() { selecting = false; paintRoom(); root.querySelector('[data-cmd="team"]')?.focus(); }
  function confirm(team) {
    const s = app.room?.slots?.[myIdx()];
    if (isFl(team) && !flRuleOk()) { toast(ERR_CODE.FLAME_TEAM_RULES, 'warn'); return; }
    if (s) decided.add(`${app.room.code}:${myIdx()}`);
    if (s && selOf(s) !== team) net.send('set_team', { team });
    closeSelect();
  }
  // 불꽃 팀 칸은 SPECIAL 쪽 끝(셋째 줄)에 붙는다
  const pageTeams = (p) => [...(p ? PAGE_SPECIAL : GRID_MAIN).filter((id) => teamOk(id) && !(app.room?.ranked && id > RANK_MAX_TEAM)), ...(p ? flCells() : [])];

  function paintSelect(focusCur = false) {
    const list = pageTeams(page);
    const fe = document.activeElement;
    const focusedTeam = focusCur ? cur : cellId(fe);
    const focusHead = !focusCur && fe?.closest?.('.tsel-head') ? fe.textContent : null;
    clear(root);
    const flOff = !flRuleOk();
    const cells = list.map((id) => h('button.tcell' + (isFl(id) ? '.fl' + (flOff ? '.off' : '') : ''), { type: 'button', 'data-team': id,
      'aria-label': isFl(id) ? `불꽃 팀 ${FL_LABEL[id.slice(6)]}` : teamText(id), 'aria-disabled': isFl(id) && flOff ? 'true' : null,
      // 마우스·터치: 첫 누름 = 커서 이동, 커서가 있던 칸을 다시 누름 = 결정. 키보드 포커스 이동도 커서를 옮긴다
      onpointerdown: () => { pdCur = cur; },
      onfocus: () => { if (cur !== id) move(id); },
      onclick: () => { const prev = pdCur ?? cur; pdCur = null; if (prev === id) confirm(id); else move(id); } },
      h('span.cl.c0'), h('span.cl.c1'), isFl(id) ? [keepEmblem(), h('span.nm', keepGlyph(id.slice(6)), FL_LABEL[id.slice(6)])] : [emblem(id), h('span.ab', glyphs(abbrOf(id))), h('span.nm', shortName(id, teamText(id)))]));
    root.append(h('div.screen.tsel',
      h('header.tsel-head', h('h1.pix-title', '팀 선택'),
        // 쪽 탭 = 글자 라벨(하플레이 M4). 보관 팀 칸이 있으면 「보관 팀」 탭(같은 SPECIAL 쪽의 보관 팀 칸으로 커서를 옮긴다)
        h('div.tpage', { role: 'group', 'aria-label': '팀 목록' },
          h('button.btn.small', { type: 'button', 'data-pg': '0', 'aria-pressed': String(page === 0), onclick: () => setPage(0) }, '학교'),
          h('button.btn.small', { type: 'button', 'data-pg': '1', 'aria-pressed': String(page === 1 && !isFl(cur)), 'aria-label': '스페셜 팀', onclick: () => { if (page === 1 && isFl(cur)) move(pageTeams(1).find((id) => !isFl(id)) ?? cur); else setPage(1); } }, '스페셜'),
          flCells().length ? h('button.btn.small.kp-tab', { type: 'button', 'data-pg': 'fl', 'aria-pressed': String(page === 1 && isFl(cur)), onclick: () => { const f = flCells()[0]; if (page !== 1) { page = 1; cur = f; paintSelect(true); } else if (!isFl(cur)) move(f); } }, keepGlyph('recent'), '보관 팀') : null),
        h('button.btn.small.back', { type: 'button', onclick: closeSelect }, '돌아가기')),
      h('div.tsel-body',
        h('section.pwin.tgrid-win', h('div.tgrid', { role: 'group', 'aria-label': '팀을 고르세요', onkeydown: gridKey }, cells)),
        h('div.tside', h('div.tinfo-slot'), h('div.tinfo-slot')))));
    marks();
    setNav(root.querySelector('.tsel'), { onEsc: closeSelect });
    const f = focusedTeam != null ? root.querySelector(`.tcell[data-team="${focusedTeam}"]`)
      : focusHead != null ? [...root.querySelectorAll('.tsel-head button')].find((b) => b.textContent === focusHead) : null;
    f?.focus({ preventScroll: true });
  }
  /** 커서 표시(1P/2P/COM 라벨·테두리)와 오른쪽 팀 창만 다시 그린다(격자 버튼은 유지 → 클릭·포커스가 끊기지 않게) */
  function marks() {
    const r = app.room, me = myIdx(), other = 1 - me;
    // 상대가 고른 불꽃 팀은 상대 계정의 슬롯이라 내 격자의 같은 이름 칸(내 슬롯)과 다르다: 격자에 상대 커서를 두지 않는다(오른쪽 팀 창에만 요약)
    const oTeam = r.slots[other]?.flameTeam ? 'x:other' : selOf(r.slots[other]), mySel = selOf(r.slots[me]);
    const cpu = [isCpuSeat(r, 0), isCpuSeat(r, 1)];
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
    for (const b of root.querySelectorAll('.tpage [data-pg]')) b.setAttribute('aria-pressed', String(b.dataset.pg === '0' ? page === 0 : page === 1 && (b.dataset.pg === 'fl') === isFl(cur)));
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
    if (i === me) {
      st = selOf(s) === cur ? h('div.tinfo-st.done', '결정 완료')
        : h('div.tinfo-st', '고르는 중', h('button.btn.small.primary', { type: 'button', onclick: () => confirm(cur) }, '결정'));
    } else st = h('div.tinfo-st.done', cpu ? '컴퓨터' : '결정 완료');
    if (isFl(t)) { // 불꽃 팀: 선수 얼굴 대신 핵심 3명·구간·승수
      const theirs = s?.flameTeam?.slot === t.slice(6) ? s.flameTeam : null; // 상대 좌석 = 그 사람 슬롯 요약(room_state), 내 좌석 = 내 요약
      const ft = i === me ? flSum(t) ?? theirs : theirs, nm = `불꽃 팀 · ${FL_LABEL[t.slice(6)] ?? ''}`;
      return h('section.pwin.tinfo.s' + i, { 'aria-label': `${i ? '2P' : '1P'} ${nm}` },
        h('div.tinfo-top', lab, keepEmblem(), h('span.tn', keepGlyph(t.slice(6)), ' ', FL_LABEL[t.slice(6)] ?? '')), ft ? flBody(ft) : null, st); // 이름 = 기호 + 「최근/최고」(보관 팀 엠블럼이 불꽃 팀임을 보인다, 좁은 화면 말줄임 방지)
    }
    return h('section.pwin.tinfo.s' + i, { 'aria-label': `${cpu ? 'COM' : i ? '2P' : '1P'} ${teamText(t)}` },
      h('div.tinfo-top', lab, emblem(t), h('span.tn', teamText(t))), roster(t, i === 0), st);
  }
  function setPage(p) {
    if (page === p) return;
    page = p;
    const l = pageTeams(page);
    if (!l.includes(cur)) cur = l[0];
    paintSelect(false);
  }
  function move(id) {
    cur = id;
    const el = root.querySelector(`.tcell[data-team="${id}"]`);
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
  const onFlame = () => { if (selecting && root.querySelector('.tsel')) { if (!pageTeams(page).includes(cur)) cur = pageTeams(page)[0] ?? 0; paintSelect(false); } };
  return { update, onRankingList: () => { if (!selecting && app.room?.ranked) paintRoom(); }, onFlameState: () => { flPrefetch(); onFlame(); }, onFlameCatalog: onFlame,
    onError: (m) => { if (m?.code === 'FLAME_TEAM_NONE' && flWanted()) net.send('flame_get'); }, unmount: () => setNav(null) };
}

/** 컴퓨터 대전 좌석 판정 (PROTOCOL 4: room.vsCpu / slot.cpu) */
export function isCpuSeat(r, i) {
  const s = r?.slots?.[i];
  return !!(s?.cpu || (r?.vsCpu && i === 1));
}
function cpuLevel(r, s) { return s?.cpuLevel ?? r?.cpuLevel ?? 2; }
