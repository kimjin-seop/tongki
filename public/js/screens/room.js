// 대기실(시안 A): 1P(하늘)/2P(빨강) 좌석 창 + VS + 명령(팀 변경·준비 완료·시작·나가기).
// 시작 = 방장만. 2명이 모이고 방장이 아닌 사람이 준비 완료여야 한다(room.start). 조건이 안 되면 버튼은 흐리게 두고, 누르면 사유를 토스트로 낸다(인라인 문구 없음).
// 팀 변경 = 원작 팀 선택 화면(엠블럼 격자 + 1P/2P 커서 + 선수 얼굴 창). 확정하면 set_team(기존 메시지) 후 대기실로.
// 컴퓨터 좌석 팀은 서버가 정한다(클라이언트 지정 메시지 없음) → COM 커서는 표시만.
import { h, clear } from '../util.js';
import { net } from '../net.js';
import { toast } from '../ui.js';
import { ERR } from '../i18n.js';
import { available as prematchOk } from './prematch.js';
import { available as lineupOk } from './lineup.js';
import { rulesText } from './rules.js';
import { emblem, roster, glyphs, abbrOf, shortName, GRID_MAIN, arrowNav } from '../pix.js';

const PAGE_SPECIAL = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24]; // 스토리 전용 팀(목록 유지)

export function mount(root, app) {
  let selecting = false, cur = null, page = 0, pdCur = null;
  let offNav = null;
  const setNav = (el, opts) => { offNav?.(); offNav = el ? arrowNav(el, opts) : null; };
  const teamOk = (id) => app.teams.some((t) => t.id === id);
  const teamText = (id) => { const t = app.teams.find((x) => x.id === id); return t ? t.label ?? t.name : id != null ? `팀 ${id + 1}` : ''; };
  const myIdx = () => app.room?.slots?.findIndex((s) => s && s.nick === app.nick) ?? -1;

  // 준비 완료였는데 서버가 풀었을 때(규칙 변경·내 팀 변경) 한 번 알린다. 내가 누른 준비 취소·경기 종료는 알리지 않는다
  let prev = null;
  function noteReady() {
    const r = app.room, m = r?.slots?.[myIdx()];
    const now = m && !m.host ? { ready: m.ready, rules: `${r.rules?.mode}/${r.rules?.time}`, team: m.team } : null;
    if (prev?.ready && now && !now.ready && r.status === 'waiting') {
      if (prev.rules !== now.rules) toast(ERR.READY_RESET_RULES, 'warn');
      else if (prev.team !== now.team) toast(ERR.READY_RESET_TEAM, 'warn');
    }
    prev = now;
  }

  function update() {
    const r = app.room; if (!r) return;
    noteReady();
    if (selecting && myIdx() >= 0 && r.status === 'waiting') { if (root.querySelector('.tsel')) marks(); else paintSelect(); } else { selecting = false; paintRoom(); }
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
      const team = s?.team;
      return h('section.seat.s' + i + (i === me ? '.me' : '') + (rdy ? '.is-ready' : ''), { 'aria-label': `${i ? '오른쪽' : '왼쪽'} 좌석` },
        h('div.seat-top', lab, h('span.seat-nick', cpu ? '컴퓨터' : s.nick), s && !s.connected && !cpu ? h('span.tag.off', '연결 끊김') : null, tag),
        team != null ? [
          h('div.seat-team', emblem(team), h('span.tn', teamText(team)),
            i === me ? h('button.chg', { type: 'button', 'data-cmd': 'chg', onclick: openSelect }, '변경 ▶') : null),
          roster(team, i === 0),
        ] : null);
    };
    const cmds = [];
    if (mine) cmds.push(h('button.btn', { type: 'button', 'data-cmd': 'team', onclick: openSelect }, '팀 변경'));
    if (mine?.host) {
      cmds.push(h('button.btn', { type: 'button', 'data-cmd': 'rules', onclick: openRules }, '규칙'));
      // 조건 미달이어도 누를 수 있게 둔다(disabled 가 아니라 aria-disabled): 누르면 사유 토스트
      cmds.push(h('button.btn.primary' + (r.start.ok ? '' : '.dim'), { type: 'button', 'data-cmd': 'start', 'aria-disabled': r.start.ok ? null : 'true',
        onclick: () => { const st = app.room?.start; if (st && !st.ok) { toast(st.msg, 'warn'); return; } startFlow(); } }, '시작'));
    } else if (mine) {
      cmds.push(h('button.btn' + (mine.ready ? '' : '.primary'), { type: 'button', 'data-cmd': 'ready', onclick: () => net.send('ready', { ready: !mine.ready }) },
        mine.ready ? '준비 취소' : '준비 완료'));
    }
    cmds.push(h('button.btn', { type: 'button', 'data-cmd': 'leave', onclick: () => net.send('leave_room') }, '나가기'));
    root.append(h('div.screen.room',
      h('header.room-head', h('h1.pix-title', r.vsCpu || !r.host ? '대기실' : `${r.host}의 방`),
        r.rules ? h('span.rules-line', '규칙 ', h('b', rulesText(r.rules))) : null,
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
      onDone: (v) => { if (v.mode !== r.rules?.mode || v.time !== r.rules?.time) net.send('set_rules', { rules: v }); app.go('room'); } });
  }

  // 시작 직전 경기 전 화면(원작: 라인업 VS -> 편성 1P -> 편성 COM). 서버 변경 없이 클라이언트에서 끼운다. 마지막 화면에서 start 전송
  function startFlow() {
    const r = app.room, me = myIdx();
    const mine = r?.slots?.[me]?.team, theirs = r?.slots?.[1 - me]?.team;
    if (me < 0 || mine == null || theirs == null) { net.send('start'); return; }
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
    cur = app.room.slots[me]?.team ?? 0;
    page = PAGE_SPECIAL.includes(cur) ? 1 : 0;
    paintSelect(true);
  }
  function closeSelect() { selecting = false; paintRoom(); root.querySelector('[data-cmd="team"]')?.focus(); }
  function confirm(team) {
    const s = app.room?.slots?.[myIdx()];
    if (s && s.team !== team) net.send('set_team', { team });
    closeSelect();
  }
  const pageTeams = (p) => (p ? PAGE_SPECIAL : GRID_MAIN).filter(teamOk);

  function paintSelect(focusCur = false) {
    const list = pageTeams(page);
    const fe = document.activeElement;
    const focusedTeam = focusCur ? cur : (fe?.dataset?.team != null ? +fe.dataset.team : null);
    const focusHead = !focusCur && fe?.closest?.('.tsel-head') ? fe.textContent : null;
    clear(root);
    const cells = list.map((id) => h('button.tcell', { type: 'button', 'data-team': id, 'aria-label': teamText(id),
      // 마우스·터치: 첫 누름 = 커서 이동, 커서가 있던 칸을 다시 누름 = 결정. 키보드 포커스 이동도 커서를 옮긴다
      onpointerdown: () => { pdCur = cur; },
      onfocus: () => { if (cur !== id) move(id); },
      onclick: () => { const prev = pdCur ?? cur; pdCur = null; if (prev === id) confirm(id); else move(id); } },
      h('span.cl.c0'), h('span.cl.c1'), emblem(id), h('span.ab', glyphs(abbrOf(id))), h('span.nm', shortName(id, teamText(id)))));
    root.append(h('div.screen.tsel',
      h('header.tsel-head', h('h1.pix-title', '팀 선택'),
        h('div.tpage', { role: 'group', 'aria-label': '팀 목록' },
          h('button.btn.small', { type: 'button', 'aria-pressed': String(page === 0), onclick: () => setPage(0) }, '학교'),
          h('button.btn.small', { type: 'button', 'aria-pressed': String(page === 1), 'aria-label': '스페셜 팀', onclick: () => setPage(1) }, glyphs('SPECIAL', page === 1))),
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
    const oTeam = r.slots[other]?.team;
    const cpu = [isCpuSeat(r, 0), isCpuSeat(r, 1)];
    for (const el of root.querySelectorAll('.tcell')) {
      const id = +el.dataset.team;
      const at = [me === 0 ? cur === id : oTeam === id, me === 1 ? cur === id : oTeam === id];
      el.classList.toggle('at0', at[0]); el.classList.toggle('at1', at[1]);
      el.classList.toggle('mine', cur === id); el.classList.toggle('s1', cur === id && me === 1);
      el.setAttribute('aria-pressed', String(r.slots[me]?.team === id));
      const [c0, c1] = el.querySelectorAll('.cl');
      c0.textContent = at[0] ? (cpu[0] ? 'COM' : '1P') : '';
      c1.textContent = at[1] ? (cpu[1] ? 'COM' : '2P') : '';
      c1.classList.toggle('com', cpu[1]);
    }
    const slots = root.querySelectorAll('.tinfo-slot');
    slots.forEach((slot, i) => slot.replaceChildren(info(i)));
  }
  function info(i) {
    const r = app.room, me = myIdx();
    const s = r.slots[i];
    const cpu = isCpuSeat(r, i);
    const t = i === me ? cur : s?.team;
    const lab = h('b.pl.' + (cpu ? 'com' : i ? 'p2' : 'p1'), cpu ? 'COM' : i ? '2P' : '1P');
    if (t == null) return h('section.pwin.tinfo', h('div.tinfo-top', lab, h('span.tn.muted', '빈 자리')));
    let st;
    if (i === me) {
      st = s?.team === cur ? h('div.tinfo-st.done', '결정 완료')
        : h('div.tinfo-st', '고르는 중', h('button.btn.small.primary', { type: 'button', onclick: () => confirm(cur) }, '결정'));
    } else st = h('div.tinfo-st.done', cpu ? '컴퓨터' : '결정 완료');
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
  return { update, unmount: () => setNav(null) };
}

/** 컴퓨터 대전 좌석 판정 (PROTOCOL 4: room.vsCpu / slot.cpu) */
export function isCpuSeat(r, i) {
  const s = r?.slots?.[i];
  return !!(s?.cpu || (r?.vsCpu && i === 1));
}
function cpuLevel(r, s) { return s?.cpuLevel ?? r?.cpuLevel ?? 2; }
