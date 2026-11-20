// 리그(혼자 + 컴퓨터, PROTOCOL §10, 기준 analysis/33 A). 화면 8개를 한 모듈에서 모드로 나눈다:
// entry(처음부터/이어하기) → setup(팀 수·턴·규칙) → teams(15팀 격자에서 N팀 차례로) → mancom(사람/컴퓨터, 사람 최대 1) → menu(경기하기/성적 보기/설정 변경)
// table(승패표), cards(대전표: 컴-컴 = 즉시 판정 결과 창, 사람 낀 카드 = 라인업·편성 → league_play → 경기), champ(우승: 공동 1위 전부 참가 순).
// 서버 상태는 main.js 가 app.league(최근 league_state)에 두고 onLeagueState/onLeagueResult/onLeagueEnd 로 넘긴다. 오류는 전부 토스트(main.js).
// 사용: app.go('league', { mode?: 'entry'|'menu'|... })
import { h, clear } from '../util.js';
import { net } from '../net.js';
import { toast } from '../ui.js';
import { LEAGUE } from '../i18n.js';
import { RULE_TIMES, timeLabel } from './rules.js';
import { available as lineupOk } from './lineup.js';
import { available as prematchOk } from './prematch.js';
import { emblem, glyphs, abbrOf, shortName, faces, GRID_MAIN, arrowNav } from '../pix.js';

const SPECIAL_ROW = [15, 16, 17, 18, 19, 20, 21]; // SPECIAL TEAM 줄(해금 계정만). 22·23·24 는 리그 불가(서버 거절)
const TEAM_N = [2, 3, 4, 5, 6], TURN_N = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const MODES = [['knockout', '녹아웃'], ['official', '공식']];

/** 승률 천분율 → 원작 표기(.500, 1.000) */
export const rateText = (r) => (r >= 1000 ? '1.000' : '.' + String(Math.max(0, r | 0)).padStart(3, '0'));
/** 리그 규칙 조합 맞추기: 녹아웃 = 무제한만, 공식 = 3/5/8분(기본 3) */
function fixRules(r) {
  const mode = r?.mode === 'official' ? 'official' : 'knockout';
  if (mode === 'knockout') return { mode, time: 0 };
  return { mode, time: [3, 5, 8].includes(r?.time) ? r.time : 3 };
}

export function mount(root, app, data = {}) {
  const st = () => app.league ?? null; // 최근 league_state {league, table, special, champions?}
  const lg = () => st()?.league ?? null;
  const teamText = (id) => { const t = app.teams.find((x) => x.id === id); return t ? t.label ?? t.name : `팀 ${id + 1}`; };
  const teamOk = (id) => app.teams.some((t) => t.id === id);

  let mode = null, offNav = null, busy = false, pending = null, focusSel = null;
  // 새 리그 초안(설정 → 팀 선택 → 사람/컴퓨터)
  const draft = { n: 3, turns: 2, rules: { mode: 'knockout', time: 0 }, teams: [], com: [] };
  // 설정 변경 초안
  let cfg = null;
  let confirmNew = false; // '처음부터' 덮어쓰기 확인 1회
  let quick = null; // 즉시 판정 결과 창 {i,j,left,right,winner}

  const setNav = (opts) => { offNav?.(); offNav = arrowNav(root, opts); };
  function go(m) { mode = m; confirmNew = false; paint(true); }
  function paint(first = false) {
    const fe = document.activeElement;
    const keep = !first && root.contains(fe) ? fe.dataset?.k : null;
    clear(root);
    ({ entry, setup, teams, mancom, menu, table, cards, champ })[mode]();
    const want = (keep && root.querySelector(`[data-k="${CSS.escape(keep)}"]`)) || (focusSel && root.querySelector(focusSel)) || root.querySelector('[data-first]');
    focusSel = null;
    setTimeout(() => { if (want?.isConnected && (first || keep || !root.contains(document.activeElement))) want.focus({ preventScroll: true }); }, 30);
  }
  const head = (title, onBack, extra) => h('header.rules-head', h('h1.pix-title', title), extra ?? null,
    onBack ? h('button.btn.small.back', { type: 'button', 'data-k': 'back', onclick: onBack }, '돌아가기') : null);
  const btn = (label, k, onclick, cls = '') => h('button.btn' + cls, { type: 'button', 'data-k': k, onclick }, label);
  const item = (label, k, onclick) => h('button.ritem.lg-big', { type: 'button', 'data-k': k, onclick }, label); // 창 안 메뉴 줄(공 커서)
  const opt = (label, k, on, onclick, disabled = false) => h('button.btn', { type: 'button', 'data-k': k, 'aria-pressed': String(!!on), disabled, onclick }, label);

  // ---------------- ① 진입 창 ----------------
  function entry() {
    const has = !!lg();
    const win = h('section.pwin.rules-win.lg-entry', { 'aria-label': '리그' }, head('리그', () => app.go('lobby')));
    if (confirmNew) {
      win.append(h('div.lg-ask', LEAGUE.OVERWRITE),
        h('div.lg-cmds', btn('처음부터', 'yes', startNew, '.primary.danger'), btn('취소', 'no', () => { confirmNew = false; focusSel = '[data-k="new"]'; paint(); })));
      win.querySelector('[data-k="no"]').dataset.first = '1';
    } else {
      const cont = h('button.ritem.lg-big', { type: 'button', 'data-k': 'cont', disabled: !has, onclick: () => go(lg()?.done ? 'champ' : 'menu') }, '이어하기');
      const nw = h('button.ritem.lg-big', { type: 'button', 'data-k': 'new', onclick: () => { if (lg()) { confirmNew = true; paint(); } else startNew(); } }, '처음부터');
      (has ? cont : nw).dataset.first = '1';
      win.append(h('div.lg-steps', nw, cont));
    }
    root.append(h('div.screen.rules', win));
    setNav({ onEsc: () => (confirmNew ? (confirmNew = false, paint()) : app.go('lobby')) });
  }
  function startNew() { draft.teams = []; draft.com = []; app.leagueChamp = null; go('setup'); }

  // ---------------- ② 설정 ----------------
  function ruleRows(r, set) {
    const modeBtns = MODES.map(([id, label]) => opt(label, 'm-' + id, r.mode === id, () => set(fixRules({ mode: id, time: r.time }))));
    const timeBtns = RULE_TIMES.map((t) => opt(timeLabel(t), 't-' + t, r.time === t, () => set(fixRules({ mode: r.mode, time: t })),
      r.mode === 'knockout' ? t !== 0 : t === 0));
    return [h('div.rules-row', { role: 'group', 'aria-label': '규칙' }, h('span.rules-lbl', '규칙'), h('div.rules-opts', modeBtns)),
      h('div.rules-row', { role: 'group', 'aria-label': '경기 시간' }, h('span.rules-lbl', '경기 시간'), h('div.rules-opts', timeBtns))];
  }
  function setup() {
    const ok = btn('결정', 'ok', () => { draft.teams = draft.teams.slice(0, draft.n); go('teams'); }, '.primary.ok');
    ok.dataset.first = '1';
    root.append(h('div.screen.rules', h('section.pwin.rules-win.lg-setup', { 'aria-label': '리그 설정' },
      head('리그 설정', () => go('entry')),
      h('div.rules-row', { role: 'group', 'aria-label': '팀 수' }, h('span.rules-lbl', '팀 수'),
        h('div.rules-opts.lg-nums', TEAM_N.map((n) => opt(String(n), 'n-' + n, draft.n === n, () => { draft.n = n; paint(); })))),
      h('div.rules-row', { role: 'group', 'aria-label': '턴 수' }, h('span.rules-lbl', '턴 수'),
        h('div.rules-opts.lg-nums', TURN_N.map((n) => opt(String(n), 'r-' + n, draft.turns === n, () => { draft.turns = n; paint(); })))),
      ruleRows(draft.rules, (r) => { draft.rules = r; paint(); }),
      ok)));
    setNav({ onEsc: () => go('entry') });
  }

  // ---------------- ③ 팀 선택 (대기실 팀 격자와 같은 칸) ----------------
  // 해금 계정의 SPECIAL 줄은 대기실 팀 선택처럼 쪽(학교/SPECIAL)으로 나눠 한 격자에 한 쪽만 그린다(두 쪽 모두 3줄 칸 크기 같게, css .lg-tsel .tgrid)
  let tpage = 0;
  function teams() {
    const sp = !!st()?.special;
    if (!sp) tpage = 0;
    const list = (tpage ? SPECIAL_ROW : GRID_MAIN).filter(teamOk);
    const picked = draft.teams;
    const cell = (id) => {
      const at = picked.indexOf(id);
      return h('button.tcell' + (at >= 0 ? '.at0.lg-picked' : ''), { type: 'button', 'data-team': id, 'data-k': 'tm-' + id, 'aria-pressed': String(at >= 0),
        'aria-label': teamText(id) + (at >= 0 ? `, ${at + 1}번째` : ''), onclick: () => pick(id) },
        h('span.cl.c0', at >= 0 ? String(at + 1) : ''), h('span.cl.c1'), emblem(id), h('span.ab', glyphs(abbrOf(id))), h('span.nm', shortName(id, teamText(id))));
    };
    const slots = Array.from({ length: draft.n }, (_, i) => {
      const t = picked[i];
      return h('div.lg-slot' + (i === picked.length ? '.cur' : ''), h('b.lg-no', String(i + 1)),
        t != null ? [emblem(t), h('span.tn', teamText(t))] : h('span.tn.muted', ''));
    });
    const undo = btn('하나 취소', 'undo', () => { picked.pop(); paint(); }, '.small');
    undo.disabled = !picked.length;
    root.append(h('div.screen.tsel.lg-tsel',
      h('header.tsel-head', h('h1.pix-title', '팀 선택'), h('span.lg-count.tabular', `${picked.length}/${draft.n}`),
        sp ? h('div.tpage', { role: 'group', 'aria-label': '팀 목록' },
          h('button.btn.small', { type: 'button', 'data-k': 'pg-0', 'aria-pressed': String(tpage === 0), onclick: () => { tpage = 0; paint(); } }, '학교'),
          h('button.btn.small', { type: 'button', 'data-k': 'pg-1', 'aria-pressed': String(tpage === 1), 'aria-label': '스페셜 팀', onclick: () => { tpage = 1; paint(); } }, '스페셜')) : null, // 쪽 탭 = 글자 라벨(대기실 팀 선택과 같게)
        h('button.btn.small.back', { type: 'button', 'data-k': 'back', onclick: () => go('setup') }, '돌아가기')),
      h('div.tsel-body',
        h('section.pwin.tgrid-win', h('div.tgrid', { role: 'group', 'aria-label': tpage ? '스페셜 팀' : '팀' }, list.map(cell))),
        h('section.pwin.lg-side', h('div.lg-slots', slots), undo))));
    const first = root.querySelector('.tcell:not(.lg-picked)');
    if (first) first.dataset.first = '1';
    setNav({ onEsc: () => (picked.length ? (picked.pop(), paint()) : go('setup')) });
  }
  function pick(id) {
    if (draft.teams.includes(id)) { toast(LEAGUE.DUP, 'warn'); return; }
    draft.teams.push(id);
    if (draft.teams.length >= draft.n) {
      draft.com = draft.teams.map(() => true);
      go('mancom');
    } else paint();
  }

  // ---------------- ④ 사람/컴퓨터 (새 리그·설정 변경 공용) ----------------
  function mancom() {
    const isCfg = !!cfg;
    const list = isCfg ? lg().teams.map((t) => t.team) : draft.teams;
    const com = isCfg ? cfg.com : draft.com;
    const rules = isCfg ? cfg.rules : draft.rules;
    const setMan = (i, man) => {
      if (man) for (let k = 0; k < com.length; k++) com[k] = k !== i; // 사람은 최대 1팀
      else com[i] = true;
      paint();
    };
    const rows = list.map((t, i) => h('div.lg-mc-row', { role: 'group', 'aria-label': teamText(t) },
      h('b.lg-no', String(i + 1)), emblem(t), h('span.lg-ab', glyphs(abbrOf(t))), h('span.tn', teamText(t)),
      h('div.rules-opts.lg-mc', opt('사람', `man-${i}`, !com[i], () => setMan(i, true)), opt('컴퓨터', `com-${i}`, com[i], () => setMan(i, false)))));
    const ok = btn('결정', 'ok', () => {
      if (busy) return;
      busy = true;
      if (isCfg) { pending = 'config'; net.send('league_config', { com: [...cfg.com], rules: { ...cfg.rules } }); }
      else { pending = 'new'; net.send('league_new', { teams: draft.teams.map((team, i) => ({ team, com: draft.com[i] })), turns: draft.turns, rules: { ...draft.rules } }); }
    }, '.primary.ok');
    ok.dataset.first = '1';
    const back = () => { if (isCfg) { cfg = null; go('menu'); } else { draft.teams.pop(); go('teams'); } };
    root.append(h('div.screen.rules', h('section.pwin.rules-win.lg-mcwin', { 'aria-label': isCfg ? '설정 변경' : '사람/컴퓨터' },
      head(isCfg ? '설정 변경' : '사람/컴퓨터', back),
      h('div.lg-mc-list', rows),
      ruleRows(rules, (r) => { if (isCfg) cfg.rules = r; else draft.rules = r; paint(); }),
      ok)));
    setNav({ onEsc: back });
  }

  // ---------------- ⑤ 리그 메뉴 ----------------
  function menu() {
    const L = lg();
    if (!L) { go('entry'); return; }
    const play = item('경기하기', 'play', () => go(L.done ? 'champ' : 'cards'));
    play.dataset.first = '1';
    root.append(h('div.screen.rules', h('section.pwin.rules-win.lg-menu', { 'aria-label': '리그' },
      head('리그', () => app.go('lobby')),
      h('div.lg-steps', play, item('성적 보기', 'table', () => go('table')),
        item('설정 변경', 'cfg', () => { cfg = { com: L.teams.map((t) => t.com), rules: fixRules(L.rules) }; go('mancom'); })))));
    setNav({ onEsc: () => app.go('lobby') });
  }

  // ---------------- ⑥ 승패표 ----------------
  function table() {
    const T = st()?.table ?? [];
    const L = lg();
    const cols = ['순위', '', '팀', '승', '패', '승률', '남은'];
    const tr = (r) => h('tr', h('td.tabular', String(r.rank + 1)), h('td.lg-mcl' + (r.com ? '' : '.man'), r.com ? 'C' : 'M'),
      h('td.lg-tteam', h('span.lg-tteam-in', emblem(r.team), h('span.tn', teamText(r.team)))), h('td.tabular', String(r.w)), h('td.tabular', String(r.l)),
      h('td.tabular', rateText(r.rate)), h('td.tabular', String(r.left)));
    const back = btn('돌아가기', 'back', () => go('menu'), '.small.back');
    back.dataset.first = '1';
    root.append(h('div.screen.rules', h('section.pwin.rules-win.lg-tablewin', { 'aria-label': '승패표' },
      h('header.rules-head', h('h1.pix-title', '승패표'), h('span.lg-sub', `${L?.turns ?? 0}턴`), back),
      h('div.lg-tscroll', h('table.lg-table', h('thead', h('tr', cols.map((c, i) => h('th', { 'aria-label': i === 1 ? '사람/컴퓨터' : null }, c)))), h('tbody', T.map(tr)))))));
    setNav({ onEsc: () => go('menu') });
  }

  // ---------------- ⑦ 대전표 ----------------
  function cards() {
    const L = lg();
    if (!L) { go('entry'); return; }
    const n = L.teams.length;
    const headCell = (j) => h('th.lg-ch', { scope: 'col', 'aria-label': teamText(L.teams[j].team) }, emblem(L.teams[j].team), h('span.lg-ab', glyphs(abbrOf(L.teams[j].team))));
    const rowHead = (i) => h('th.lg-rh', { scope: 'row', 'aria-label': teamText(L.teams[i].team) },
      h('b.lg-no', String(i + 1)), h('span.lg-mcl' + (L.teams[i].com ? '' : '.man'), L.teams[i].com ? 'C' : 'M'), emblem(L.teams[i].team));
    const cell = (i, j) => {
      if (i === j) return h('td.lg-diag', { 'aria-hidden': 'true' });
      const [w, l] = L.res[i][j];
      const full = w + l >= L.turns || L.done;
      return h('td', h('button.lg-card' + (full ? '.off' : ''), { type: 'button', 'data-k': `c-${i}-${j}`, 'aria-disabled': full ? 'true' : null,
        'aria-label': `${teamText(L.teams[i].team)} 대 ${teamText(L.teams[j].team)} ${w}승 ${l}패`, onclick: () => playCard(i, j) },
        h('span.tabular', `${w}-${l}`)));
    };
    const first = (() => { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && L.res[i][j][0] + L.res[i][j][1] < L.turns) return `c-${i}-${j}`; return null; })();
    const pop = quick ? quickPop() : null;
    root.append(h('div.screen.rules.lg-cards', h('section.pwin.rules-win.lg-cardwin', { 'aria-label': '대전표' },
      head('대전표', () => go('menu')),
      h('div.lg-tscroll', h('table.lg-grid', h('thead', h('tr', h('th.lg-corner'), Array.from({ length: n }, (_, j) => headCell(j)))),
        h('tbody', Array.from({ length: n }, (_, i) => h('tr', rowHead(i), Array.from({ length: n }, (_, j) => cell(i, j)))))))), pop));
    if (pop) pop.querySelector('[data-k="qok"]').dataset.first = '1';
    else if (first) root.querySelector(`[data-k="${first}"]`).dataset.first = '1';
    else root.querySelector('[data-k="back"]').dataset.first = '1';
    setNav({ onEsc: () => (quick ? closeQuick() : go('menu')) });
  }
  function playCard(i, j) {
    const L = lg();
    if (!L || busy || quick) return;
    const [w, l] = L.res[i][j];
    if (L.done || i === j || w + l >= L.turns) { toast(LEAGUE.CARD_DONE, 'warn'); return; }
    const a = L.teams[i], b = L.teams[j];
    if (a.com && b.com) { busy = true; pending = 'quick'; net.send('league_play', { i, j }); return; }
    // 사람 낀 카드: 사람 팀이 언제나 왼쪽(서버 cardSides). 라인업 → 편성(나) → 편성(상대) → league_play → 경기
    const me = a.com ? b.team : a.team, opp = a.com ? a.team : b.team;
    const back = () => app.go('league', { mode: 'cards' });
    const steps = [];
    if (lineupOk()) steps.push((next) => app.go('lineup', { teams: [me, opp], labels: ['1P', 'COM'], onCancel: back, onExit: next }));
    if (prematchOk()) {
      steps.push((next) => app.go('prematch', { team: me, label: '1P', onCancel: back, onExit: next }));
      steps.push((next) => app.go('prematch', { team: opp, label: 'COM', onCancel: back, onExit: next }));
    }
    const run = (k) => (k < steps.length ? steps[k](() => run(k + 1)) : net.send('league_play', { i, j }));
    run(0);
  }
  function quickPop() {
    const q = quick, L = lg();
    const side = (idx) => {
      const t = L.teams[idx].team, win = q.winner === idx;
      return h('div.lg-q-side' + (win ? '.win' : ''), emblem(t), h('span.tn', teamText(t)), h('b.lg-wl', win ? '승' : '패'));
    };
    return h('div.lg-pop', h('div.pwin.lg-q', { role: 'dialog', 'aria-label': '경기 결과' },
      h('div.lg-q-t', '경기 결과'), side(q.left), side(q.right),
      h('button.btn.primary.ok', { type: 'button', 'data-k': 'qok', onclick: closeQuick }, '확인')));
  }
  function closeQuick() {
    quick = null;
    if (app.leagueChamp) { go('champ'); return; }
    paint(true);
  }

  // ---------------- ⑧ 우승 ----------------
  function champ() {
    const L = lg();
    const ids = app.leagueChamp ?? st()?.champions ?? [];
    app.leagueChamp = null;
    if (!L || !ids.length) { go('menu'); return; }
    const ok = btn('확인', 'ok', () => go('menu'), '.primary.ok');
    ok.dataset.first = '1';
    root.append(h('div.screen.rules.lg-champ', h('section.pwin.rules-win.lg-champwin', { 'aria-label': '우승' },
      h('h1.pix-title.lg-champ-t', '우승'),
      h('div.lg-champs', ids.map((idx, k) => {
        const t = L.teams[idx].team;
        return h('div.lg-champ-row', { style: { '--d': k } }, h('div.lg-champ-id', emblem(t), h('span.lg-ab', glyphs(abbrOf(t)))),
          h('div.lg-champ-main', h('span.tn', teamText(t)), faces(t)));
      })),
      ok)));
    setNav({ onEsc: () => go('menu') });
  }

  // ---------------- 서버 메시지 ----------------
  function onLeagueState() {
    if (pending === 'new' || pending === 'config') { pending = null; busy = false; cfg = null; go('menu'); return; }
    if (pending === 'quick') return; // 결과(league_result)를 아직 못 받았다
    if (mode === 'entry' || mode === 'cards' || mode === 'table') paint(); // 대전표는 결과 창 뒤의 칸 숫자를 갱신
  }
  function onLeagueResult(m) {
    if (!m.quick) return;
    pending = null; busy = false;
    quick = { i: m.i, j: m.j, left: m.left, right: m.right, winner: m.winner };
    if (mode === 'cards') paint(true);
  }

  mode = data.mode && ['entry', 'menu', 'cards', 'table', 'champ'].includes(data.mode) ? data.mode : 'entry';
  if (mode === 'menu' && app.leagueChamp && lg()?.done) mode = 'champ';
  if (mode !== 'entry' && !lg()) mode = 'entry';
  paint(true);
  net.send('league_get');

  return {
    onLeagueState,
    onLeagueResult,
    onLeagueEnd() { if (mode === 'cards' && quick) return; /* 결과 창 '확인' 뒤 우승 화면 */ if (mode === 'cards' || mode === 'menu') go('champ'); },
    onError() { busy = false; pending = null; },
    onWelcome() { net.send('league_get'); },
    unmount() { offNav?.(); },
  };
}
