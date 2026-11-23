// 불꽃의 계승 도전 진행(§12.4): 분기형 진행 지도 + 노드 화면(보상 선택 §12.8 · 상점 · 특훈장 · 휴식실 · 영입 · 이벤트).
// 무엇을 보여 줄지는 서버 상태가 정한다(index.js runBase). 여기서는 그리고, 번호·ID 만 보낸다.
import { h } from '../../util.js';
import { toast } from '../../ui.js';
import * as F from './store.js';
import { icon, emptyIcon, pface, pname, pteam, isClone, ownShotOf, tname, emblem, origEmblem, sprite, hpBar, head, chip, btn, learnTip, gradeTag, rarTag, artKindTag, snapPicker, snapPickEsc, snapOn } from './ui.js';

const isMatch = (t) => t === 'normal' || t === 'strong' || t === 'boss';
const tierChip = (t) => { const c = chip('단계', t > 9999 ? '9999+' : String(t), '.tier'); c.title = '컴퓨터 최대 단계(이 구간 보스 기준, 일반 상대는 더 낮을 수 있다)'; return c; }; // 짧은 칩(머리말 한 줄 유지)
const pointChip = (run) => chip('경기 포인트', String(run.points), '.pt');

/** 선수 7명 고르는 줄(얼굴 + 이름 + HP). sel = 고른 번호, onPick(i). lock(i) = 고를 수 없는 칸(흐리게, 누르면 onLock) */
function playerRow(ctx, sel, onPick, k = 'p', lock = null, onLock = null) {
  const run = ctx.run(), team = ctx.team();
  return h('div.fl-prow', { role: 'group', 'aria-label': '선수' }, run.roster.map((r, i) => {
    const off = !!lock?.(i);
    return h('button.fl-pcell' + (off ? '.lock' : ''), { type: 'button', 'data-k': `${k}-${i}`, 'aria-pressed': String(sel === i), ...(off ? { 'aria-disabled': 'true' } : {}),
      'aria-label': `${pname(r.from)} HP ${r.hp}/${team.players[i].final.s0}`, onclick: () => (off ? onLock?.(i) : onPick(i)) },
      pface(r.from), h('span.nm', pname(r.from)), hpBar(r.hp, team.players[i].final.s0));
  }));
}
/** 장비의 특수효과 문구: 설명에서 능력치 부분(앞쪽)을 뺀 나머지 */
export function extraSpec(def) {
  if (!def?.effects?.length) return '';
  const parts = String(def.specText ?? '').split(/,\s*/), n = Object.keys(def.stats ?? {}).length;
  return parts.slice(n).join(', ') || def.specText || '';
}
/** 관리 화면 버튼. 팀 관리 = 빈 슬롯에 낄 수 있는 미장착 장비 수, 아티팩트 = 빈 슬롯에 넣을 수 있는 보유 아티팩트 수를 숫자 점으로 */
function manageBtn(ctx, s, label) {
  const n = s === 'team' ? F.idle(ctx.run()).equip : s === 'artifact' ? F.idle(ctx.run()).art : s === 'formation' ? F.idle(ctx.run()).fm : 0; // fm = off(§13.26) 빈 포메이션 칸에 낄 아이템
  return btn(n > 0 ? [label, h('b.fl-badge.tabular', { 'aria-hidden': 'true' }, String(n))] : label, 'open-' + s, () => ctx.open(s), '.center',
    n > 0 ? { 'aria-label': `${label} 미장착 ${n}` } : {});
}
/** 도전 중 공통 명령(팀·장비·아티팩트·포메이션·소모품) */
const manage = (ctx, list = ['team', 'inv', 'artifact', 'formation', 'items']) => {
  const L = { team: '팀 관리', inv: '장비 관리', artifact: F.artOff() ? '필살기' : '아티팩트', formation: '포메이션', items: '소모품' }; // off(§13.26): 「아티팩트」 = 선수별 필살기 아이템 칸
  return list.map((s) => manageBtn(ctx, s, L[s]));
};

// ---------------- 팀 소개(오리지널 팀으로 시작한 도전의 첫 화면, 한 번) ----------------
/** 그 도전의 팀 소개를 이미 넘겼는가(localStorage 'dd.flame.intro' = 도전 id) */
const INTRO_KEY = 'dd.flame.intro';
export function introDue(run, S) {
  if (!run?.cast?.team || typeof run.cast.team.name !== 'string' || !run.cast.team.name) return false;
  if (run.done?.length || run.matchesWon > 0 || run.node || S.introSeen === run.id) return false; // 막 시작한 도전만
  try { return localStorage.getItem(INTRO_KEY) !== String(run.id); } catch { return true; }
}
export function intro(ctx) {
  const { S } = ctx, run = ctx.run(), T = run.cast.team;
  let gone = false;
  const go = () => {
    if (gone) return;
    gone = true; S.introSeen = run.id;
    try { localStorage.setItem(INTRO_KEY, String(run.id)); } catch { /* 저장 불가: 이 화면 동안만 기억 */ }
    ctx.paint();
  };
  const b = h('button.fl-intro', { type: 'button', 'data-k': 'intro', 'aria-label': T.name, onclick: go },
    origEmblem(), h('b.fl-intro-n', T.name), T.intro ? h('span.fl-intro-t', T.intro) : null,
    h('span.fl-intro-row', run.roster.map((r) => h('span.fl-intro-p', pface(r.from), h('span.nm', pname(r.from))))));
  b.dataset.first = '1';
  ctx.root.append(h('div.screen.fl.fl-introv', b));
  // 아무 키로나 넘긴다(Enter·Space 는 버튼 누름, Esc 는 공용 처리)
  const onKey = (e) => { if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !['Enter', ' ', 'Escape', 'Tab'].includes(e.key)) { e.preventDefault(); go(); } };
  addEventListener('keydown', onKey);
  return { esc: go, off: () => removeEventListener('keydown', onKey) };
}

// ---------------- 우승(엔드리스: 구간 3 보스 격파, 도전은 이어진다) ----------------
/** flame_result.champion 을 받은 뒤 도전 화면으로 돌아오면 한 번(app.flameChamp = {achievements}). 팀 소개 화면의 틀·로고 불꽃을 그대로 쓴다. 누르거나 아무 키로 넘긴다 */
export function champ(ctx) {
  const { app } = ctx, run = ctx.run(), ach = (app.flameChamp?.achievements ?? []).map((id) => F.achDef(id)?.name).filter(Boolean);
  let gone = false;
  const go = () => { if (gone) return; gone = true; app.flameChamp = null; ctx.paint(); };
  const b = h('button.fl-intro.fl-champ', { type: 'button', 'data-k': 'champ', 'aria-label': '우승', onclick: go },
    run.cast?.team ? origEmblem() : null,
    h('span.fl-logo', h('span.fl-logo-f', { 'aria-hidden': 'true' }), h('b', '우승!')),
    h('span.fl-intro-t', `${run.segNo ?? run.seg + 1}구간 돌입`),
    champCoins(run.coinsPending) > 0 ? h('span.fl-chipline', chip('정산 시 우승 코인', `+${champCoins(run.coinsPending)}`, '.coin')) : null, // 지급은 도전 종료 정산 때(§13.12)
    ach.length ? h('span.fl-chipline', ach.map((t) => h('span.tag.host', t))) : null,
    h('span.fl-intro-row', run.roster.map((r) => h('span.fl-intro-p', pface(r.from), h('span.nm', pname(r.from))))));
  b.dataset.first = '1';
  ctx.root.append(h('div.screen.fl.fl-introv', b));
  const onKey = (e) => { if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !['Enter', ' ', 'Escape', 'Tab'].includes(e.key)) { e.preventDefault(); go(); } };
  addEventListener('keydown', onKey);
  return { esc: go, off: () => removeEventListener('keydown', onKey) };
}

/** 우승으로 얻은 불꽃코인(우승 + 첫 우승, 난이도 % 적용). 서버 예상치 run.coinsPending / 종료 요약 summary.coins 의 칸을 그대로 쓴다(PROTOCOL §13.12: 지급은 도전 종료 정산 때) */
export const champCoins = (c) => (c && Number.isFinite(c.champion) ? Math.floor(((c.champion + (Number.isFinite(c.first) ? c.first : 0)) * (Number.isFinite(c.pct) ? c.pct : 100)) / 100) : 0);

// ---------------- 진행 지도 ----------------
export function map(ctx) {
  const { S } = ctx, run = ctx.run();
  const mapBase = Number.isInteger(run.mapBase) ? run.mapBase : 0, mapAt = (i) => run.map[i - mapBase]; // 서버가 현재 구간부터만 보내면(mapBase = run.seg) 바깥 번호 = 구간 번호. 옛 서버(지나온 구간을 빈 칸으로 채움)는 mapBase 없음 = 0
  // 구간 탭(PROTOCOL §13.12): 지도가 있는 구간만. 엔드리스는 지나온 구간이 빈 칸({layers: []})이고 다음 구간을 미리 볼 수 없어 보통 현재 구간 하나뿐이다 -> 탭을 그리지 않는다
  const segs = run.map.map((m, i) => mapBase + i).filter((i) => i === run.seg || mapAt(i)?.layers?.length > 0);
  const seg = segs.includes(S.segView) ? S.segView : run.seg, segNo = run.segNo ?? run.seg + 1;
  const cand = new Set(run.candidates), done = new Map(run.done.map((d) => [d.id, d]));
  const layers = mapAt(seg).layers;
  const all = run.map.flatMap((m) => (m?.layers ?? []).flat());
  const candNodes = all.filter((n) => cand.has(n.id));
  // 다음 상대: 지금 고를 수 있는 경기 노드, 없으면 이 구간의 다음 경기 층
  let nextOpp = candNodes.filter((n) => isMatch(n.type));
  if (!nextOpp.length) nextOpp = mapAt(run.seg).layers.slice(run.layer).find((l) => l.some((n) => isMatch(n.type)))?.filter((n) => isMatch(n.type)) ?? [];
  const roomHeal = Number(F.catalog().recruitRoomHealPct) > 0 ? Number(F.catalog().recruitRoomHealPct) : 0;
  const pick = (n) => {
    if (!cand.has(n.id)) return;
    if (isMatch(n.type)) ctx.startMatch(n); else ctx.send('flame_node', { id: n.id });
  };
  // 갈 수 있는 앞쪽 칸(지금 후보에서 next 로 이어지는 칸): 이 구간의 남은 칸 중 여기 없는 칸 = 잠김(지나온 길에서 갈라져 못 가는 칸, 회색)
  const reach = new Set(run.candidates);
  for (const l of layers) for (const n of l) if (reach.has(n.id)) for (const to of n.next ?? []) reach.add(to);
  const nodeBtn = (n, li) => {
    const d = done.get(n.id), on = cand.has(n.id);
    const past = seg < run.seg || (seg === run.seg && li < run.layer);
    const stt = d ? 'done' : on ? 'cand' : past ? 'skip' : seg === run.seg && run.candidates.length && !reach.has(n.id) ? 'lock' : 'todo';
    return h(`button.fl-node.t-${n.type}.${stt}`, { type: 'button', 'data-k': 'n-' + n.id, 'data-id': n.id, disabled: !on, // 고를 수 없는 노드는 방향키 포커스가 건너뛴다(pix.js arrowNav = button:not(:disabled))
      'aria-label': `${F.nodeName(n.type)}${n.opp ? ' ' + tname(n.opp.team) : ''}${d ? ' 완료' : on ? '' : ' 선택 불가'}`, onclick: () => pick(n) },
      // 안아트 노드 아이콘(manifest ui.icon.node.*, flame.css .fl-node-g) + 종류 글자. 완료·지나침·잠김 = 같은 모양의 불투명 회색
      h('span.fl-node-h', h('span.fl-node-g', { 'aria-hidden': 'true' }), h('span.fl-node-t', F.NODE_SHORT[n.type] ?? n.type)),
      n.opp ? [emblem(n.opp.team), h('span.fl-node-n', tname(n.opp.team))] : null,
      n.type === 'recruit' && roomHeal > 0 ? h('span.fl-node-n.fl-node-heal.tabular', `HP +${roomHeal}%`) : null); // 영입실 입장 회복 %(flame_catalog.recruitRoomHealPct, 0 = 꺼짐 → 표시 없음)
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'fl-map-edges'); svg.setAttribute('aria-hidden', 'true');
  const cols = h('div.fl-map-cols', layers.map((l, li) => h('div.fl-map-col' + (seg === run.seg && li === run.layer ? '.cur' : ''), l.map((n) => nodeBtn(n, li)))));
  const board = h('div.fl-map-board', { 'data-sc': 'map' }, h('div.fl-map-in', svg, cols));
  const segTabs = segs.length > 1 ? h('div.fl-tabs', { role: 'group', 'aria-label': '구간' }, segs.map((i) =>
    h('button.btn.small', { type: 'button', 'data-k': 'seg-' + i, 'aria-pressed': String(seg === i), onclick: () => { S.segView = i; ctx.paint(); } }, `${segNo + i - run.seg}구간` + (i === run.seg ? ' ●' : '')))) : null;

  // 포기 확인
  const cancelAb = () => { S.abAsk = false; ctx.paint(); };
  let cmds;
  const resting = ctx.peeking; // 휴식실에서 지도를 보는 중: 휴식 선택이 남아 있다
  if (S.snapPick) cmds = snapPicker(ctx, 'run'); // 팀 저장(§13.20-B): 진행 중 도전의 지금 팀을 저장 칸에
  else if (S.abAsk) {
    const no = btn('취소', 'ab-no', cancelAb, '.center', { 'data-sfx': 'cancel' });
    no.dataset.first = '1';
    cmds = h('div.fl-cmds.ask', h('span.fl-ask-t', '도전을 포기합니다'), btn('포기', 'ab-yes', () => { S.abAsk = false; ctx.send('flame_abandon'); }, '.danger.center'), no);
  } else {
    // 다음 칸 버튼: 후보가 하나면 그 칸 이름(경기 = 「다음 경기」, 그 밖 = 「다음 · 상점」)으로 바로 들어간다. 둘 이상이면 지도에서 고르게 후보를 보이고 토스트 한 줄. 후보가 없으면 누를 수 없다
    const one = candNodes.length === 1 ? candNodes[0] : null;
    const nextLabel = one && !isMatch(one.type) ? `다음 · ${F.NODE_SHORT[one.type] ?? F.nodeName(one.type)}` : candNodes.length > 1 && !candNodes.some((n) => isMatch(n.type)) ? '다음 칸' : '다음 경기';
    const next = resting ? btn('휴식실', 'to-rest', () => ctx.peek(false), '.primary.center') : btn(nextLabel, 'next', () => {
      if (one) return pick(one);
      S.segView = null;
      if (seg !== run.seg) ctx.paint();
      toast('지도에서 갈 곳을 고르세요', 'info', 1800);
      setTimeout(() => { showCur(ctx.root.querySelector('.fl-map-board')); ctx.root.querySelector('.fl-node.cand')?.focus(); }, 40);
    }, '.primary.center', { disabled: !candNodes.length });
    next.dataset.first = '1';
    cmds = h('div.fl-cmds', manage(ctx), next);
  }
  ctx.root.append(h('div.screen.fl.fl-run',
    h('header.fl-head', h('h1.pix-title.fl-title', `${segNo}구간`), run.championed ? h('span.tag.host.fl-champ-m', '우승') : null,
      h('div.fl-head-x',
        h('span.fl-chip.opp', h('i', '다음 상대'), nextOpp.length ? nextOpp.map((n) => h('span.fl-opp', emblem(n.opp.team), tname(n.opp.team))) : h('b', '-')),
        Number.isFinite(run.tier) ? tierChip(run.tier) : null, // 최대 단계(구간 보스 기준 서버 계산. 일반 상대는 더 낮을 수 있다). 4자리 초과는 9999+
        Number.isFinite(run.matchesTotal) ? chip('남은 경기', String(run.matchesTotal - run.matchesWon)) : null, pointChip(run), // 엔드리스 = matchesTotal:null(남은 경기 없음)
        F.artOff() ? null : h('button.fl-arts', { type: 'button', 'data-k': 'arts', 'aria-label': '장착 아티팩트', onclick: () => ctx.open('artifact') }, // off(§13.26): 공용 3칸 없음
          run.artifacts.map((id) => (id ? icon(F.artDef(id)) : emptyIcon())))),
      // 연습 경기(PROTOCOL §13.15): 받을 수 있고(run.practiceAvailable) 풀지 않은 선택이 없을 때만 작은 버튼. 결과는 도전에 반영되지 않는다(거절 = 토스트)
      run.practiceAvailable === true && !run.pending?.length && !run.node ? btn('연습 경기', 'practice', () => ctx.send('flame_practice'), '.small.fl-practice-b') : null,
      snapOn() ? btn('팀 저장', 'snap', () => { S.abAsk = false; S.snapPick = {}; document.activeElement?.blur(); ctx.paint(); }, '.small') : null, // blur: 다시 그린 뒤 첫 칸에 포커스
      btn('포기', 'abandon', () => { S.snapPick = null; S.abAsk = true; ctx.paint(); }, '.small'),
      btn('돌아가기', 'back', () => ctx.go('home'), '.small.back')),
    h('section.pwin.fl-map', segTabs, board),
    cmds));

  // 노드 사이 선(다음 층으로 가는 길). 지나온 길 = 금색
  const draw = () => {
    const box = cols.getBoundingClientRect();
    if (!box.width) return;
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`); svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
    svg.replaceChildren();
    const at = (id) => { const el = cols.querySelector(`[data-id="${CSS.escape(id)}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left - box.left, r: r.right - box.left, y: r.top - box.top + r.height / 2 }; };
    for (const l of layers) for (const n of l) for (const to of n.next) {
      const a = at(n.id), b = at(to);
      if (!a || !b) continue;
      const mx = Math.round((a.r + b.l) / 2), p = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      p.setAttribute('points', `${Math.round(a.r)},${Math.round(a.y)} ${mx},${Math.round(a.y)} ${mx},${Math.round(b.y)} ${Math.round(b.l)},${Math.round(b.y)}`);
      const on = done.has(n.id) && (done.has(to) || cand.has(to));
      p.setAttribute('class', on ? 'on' : 'off');
      if (on) svg.append(p); else svg.prepend(p); // 지나온 길(금색)이 다른 선에 덮이지 않게 맨 위에
    }
  };
  // 토스트(획득·이벤트 결과)는 지도 창 안 맨 아래에 비워 둔 띠(css .fl-run .fl-map padding-bottom)에 띄운다: 머리 줄 정보 칸도 지도 노드도 가리지 않게(css :root:has(.fl-run) #toasts)
  const placeToast = () => { const b = board.parentElement.getBoundingClientRect(); if (b.height) document.body.style.setProperty('--fl-toast-bottom', Math.max(8, Math.round(innerHeight - b.bottom + 9)) + 'px'); };
  // 좁은 화면(지도가 가로로 넘칠 때): 지금 고를 수 있는 칸이 보이게 가로로 맞춘다. 화면 폭이 바뀔 때(세로·가로 전환 포함)도 다시 맞춘다
  let bw = 0;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { draw(); placeToast(); if (board.clientWidth !== bw) { bw = board.clientWidth; showCur(board); } }) : null;
  ro?.observe(cols); ro?.observe(board);
  requestAnimationFrame(() => { draw(); placeToast(); bw = board.clientWidth; showCur(board); });
  return { esc: () => (snapPickEsc(ctx) || (S.abAsk ? cancelAb() : ctx.go('home'))), off: () => { ro?.disconnect(); document.body.style.removeProperty('--fl-toast-bottom'); } };
}
/** 지도가 가로로 넘칠 때 지금 고를 수 있는 칸(없으면 현재 층)을 가운데로. 넘치지 않으면 그대로 */
function showCur(board) {
  if (!board?.isConnected || board.scrollWidth <= board.clientWidth + 1) return;
  const els = [...board.querySelectorAll('.fl-node.cand')], cur = board.querySelector('.fl-map-col.cur');
  const rs = (els.length ? els : cur ? [cur] : []).map((e) => e.getBoundingClientRect());
  if (!rs.length) return;
  const l = Math.min(...rs.map((r) => r.left)), r = Math.max(...rs.map((x) => x.right)), b = board.getBoundingClientRect();
  board.scrollLeft += (l + r) / 2 - (b.left + board.clientWidth / 2);
}

// ---------------- 보상 선택(장비·아티팩트) ----------------
const SRC_KO = (p) => (p.src === 'start' ? '시작 보상' : '승리 보상');
export function reward(ctx) {
  const { S } = ctx, run = ctx.run(), pend = run.pending[0], isEq = pend.kind === 'equipment';
  // 장착 정보(flame_state.run.items · roster[].equip)가 있으면 보유 수·빈 선수 수를 센다. 없으면 종전 표시(주장 기준, 차이 0 = '=')
  const known = isEq && Array.isArray(run.items) && run.roster.every((r) => r.equip && typeof r.equip === 'object');
  const vacant = (r, slot) => r.equip[slot] === null || r.equip[slot] === undefined;
  const key = `${pend.kind}:${pend.choices.join(',')}`;
  if (S.cmpKey !== key) { S.cmpKey = key; S.cmpP = null; } // 보상이 바뀌면 비교 선수를 다시 고른다
  if (!(Number.isInteger(S.cmpP) && S.cmpP >= 0 && S.cmpP < run.roster.length)) S.cmpP = null;
  // 비교 선수 기본값(직접 고르기 전): 보상 장비의 칸이 가장 많이 비어 있는 선수, 없으면 주장
  let cmpP = S.cmpP ?? 0;
  if (S.cmpP === null && known) {
    const slots = pend.choices.map((id) => F.equipDef(id)?.slot).filter(Boolean);
    const free = run.roster.map((r) => slots.filter((s) => vacant(r, s)).length);
    cmpP = Math.max(0, free.indexOf(Math.max(...free)));
  }
  const curOf = (slot) => run.items.find((it) => it.inst === run.roster[cmpP].equip[slot]) ?? null;
  const card = (id, i) => {
    const d = isEq ? F.equipDef(id) : F.artDef(id);
    if (!d) return null;
    const pick = btn('선택', 'pick-' + i, () => ctx.send('flame_choose', { i }), '.primary.center');
    if (i === 0) pick.dataset.first = '1';
    if (!isEq) {
      // 아티팩트 카드(§13.22): 이름 · 등급 딱지 + 유형(보스 보상 3칸 = 필살슛·포메이션·팀 강화) · 한 줄 속성. 같은 슛·포메이션을 갖고 있으면 그 등급(더 높은 등급만 후보로 온다)
      const g = F.grantOf(d), own = F.ownedGrade(run.artifactsOwned, d);
      return h('article.pwin.fl-card' + (g ? '.g-' + g.grade : ''), { 'data-kind': F.artKind(d) ?? '' }, icon(d, { big: true }), h('h2.fl-card-n', F.artName(d)),
        h('div.fl-card-k', artKindTag(d), own ? h('span.fl-card-own', { 'data-k': 'own-g' }, '보유 ', gradeTag(own)) : null), h('p.fl-card-s', F.artLine(d)), F.artPair(d) ? h('p.fl-card-s.fl-pair', F.artPair(d)) : null, pick);
    }
    const cur = curOf(d.slot), cs = cur?.stats ?? {};
    const keys = [...new Set([...Object.keys(d.stats ?? {}), ...Object.keys(cs)])];
    const vac = known ? run.roster.filter((r) => vacant(r, d.slot)).length : 0;
    return h('article.pwin.fl-card.r-' + d.rarity, icon(d, { big: true }), h('h2.fl-card-n', d.name),
      h('div.fl-card-k', rarTag(d.rarity), F.SLOT_KO[d.slot],
        known ? h('span.fl-card-own.tabular', `보유 ${run.items.filter((it) => it.id === d.id).length}` + (vac ? ` · 빈 선수 ${vac}명` : '')) : null),
      h('div.fl-card-st', keys.map((k) => {
        const nv = d.stats?.[k] ?? 0, df = nv - (cs[k] ?? 0);
        return h('div.fl-st-line', h('i', F.statName(k)), h('b.tabular', `${F.sgn(nv)}${F.statUnit(k)}`),
          h('span.fl-diff.tabular' + (df > 0 ? '.up' : df < 0 ? '.down' : ''), df > 0 ? `▲${df}` : df < 0 ? `▼${-df}` : known ? '' : '='));
      })),
      extraSpec(d) ? h('p.fl-card-s', extraSpec(d)) : null,
      h('div.fl-card-cur', h('i', '현재'), cur ? [icon(F.equipDef(cur.id), { lv: cur.lv }), F.equipDef(cur.id)?.name] : '없음'),
      pick);
  };
  const skip = btn('받지 않음', 'skip', () => ctx.send('flame_choose', { i: -1 }), '.center');
  const re = btn(`재선택 ${run.rerolls}`, 'reroll', () => ctx.send('flame_reroll'), '.center', { disabled: !(run.rerolls > 0) });
  // 승리 뒤 전원 회복 %(0 이거나 없으면 꺼짐): 승리 보상에서만 한 칸. 구간 보스 승리 보상은 flame_catalog.afterBossHealPct(PROTOCOL §13.18 D30, 없으면 afterWinHealPct), 일반·강팀은 afterWinHealPct.
  // 보스 판별 = pending[].nodeType, 없는 칸(아티팩트 보상)은 지나온 노드 기록(run.done[].type), 그것도 없으면 승리 보상 아티팩트 = 보스(서버가 보스 승리에서만 준다)
  const C = F.catalog(), srcType = pend.nodeType ?? run.done?.find((d) => d.id === pend.src)?.type ?? (pend.kind === 'artifact' ? 'boss' : null);
  const healPct = pend.src === 'start' ? 0 : Number(srcType === 'boss' && Number.isFinite(C.afterBossHealPct) ? C.afterBossHealPct : C.afterWinHealPct);
  ctx.root.append(h('div.screen.fl.fl-reward',
    h('header.fl-head', h('h1.pix-title.fl-title', isEq ? '장비 보상' : pend.g === 'firstWin' ? '첫 승리 보상' : F.artOff() ? `${F.itemTitle(pend.choices)} 보상` : '아티팩트 보상'), // off(§13.26): 칸 종류(필살기·포메이션 아이템)로
      h('div.fl-head-x', h('span.tag', SRC_KO(pend)), healPct > 0 ? chip('승리 회복', `+${healPct}%`, '.heal') : null, run.pending.length > 1 ? h('span.fl-count.tabular', `1/${run.pending.length}`) : null)),
    isEq ? h('div.fl-cmp', h('span.fl-cmp-t', '비교 선수'),
      h('div.fl-cmp-row', { role: 'group', 'aria-label': '비교 선수' }, run.roster.map((r, i) =>
        h('button.fl-face-b', { type: 'button', 'data-k': 'cmp-' + i, 'aria-pressed': String(cmpP === i), 'aria-label': pname(r.from), onclick: () => { S.cmpP = i; ctx.paint(); } }, pface(r.from))))) : null,
    h('div.fl-cards', pend.choices.map(card)),
    h('div.fl-cmds', skip, re, manageBtn(ctx, 'team', '팀 관리'))));
  return { esc: () => ctx.go('home') };
}

// ---------------- 장비 상점 ----------------
export function shop(ctx) {
  const run = ctx.run(), stock = run.node.stock ?? [];
  const leave = () => ctx.send('flame_leave');
  // 아티팩트 칸(§13.22): 등급제면 등급 딱지 + 유형 + 같은 종류 보유 등급, 종전 = 분류 이름
  const ownTag = (d) => { const o = F.ownedGrade(run.artifactsOwned, d); return o ? h('span.fl-card-own', '보유 ', gradeTag(o)) : null; };
  const KIND = { equipment: (d) => [rarTag(d.rarity), F.SLOT_KO[d.slot]], artifact: (d) => (F.artKind(d) ? [artKindTag(d), ownTag(d)] : F.artOff() ? F.CAT_KO[d.category] ?? '' : `아티팩트 · ${F.CAT_KO[d.category] ?? ''}`), consumable: () => '소모품' };
  const nameOf = (g, d) => (g.kind === 'artifact' ? F.artName(d) : d.name);
  const defOf = (g) => (g.kind === 'equipment' ? F.equipDef(g.id) : g.kind === 'artifact' ? F.artDef(g.id) : F.consDef(g.id));
  const rows = stock.map((g, i) => {
    const d = defOf(g);
    if (!d) return null;
    return h('div.fl-shop-row' + (g.sold ? '.sold' : ''), icon(d),
      h('div.fl-shop-m', h('b.fl-shop-n', nameOf(g, d)), h('span.fl-shop-k', KIND[g.kind](d)), h('span.fl-shop-s', g.kind === 'artifact' ? F.artLine(d) : d.specText), g.kind === 'artifact' && F.artPair(d) ? h('span.fl-shop-s.fl-pair', F.artPair(d)) : null),
      h('button.btn.fl-buy' + (!g.sold && run.points < g.price ? '.dim' : ''), { type: 'button', 'data-k': 'buy-' + i, disabled: g.sold, 'aria-label': `${nameOf(g, d)} ${g.sold ? '품절' : `${g.price} 경기 포인트`}`,
        onclick: () => ctx.send('flame_buy', { i }) }, g.sold ? '품절' : h('span.tabular', String(g.price))));
  });
  const out = btn('나가기', 'leave', leave, '.primary.center');
  ctx.root.append(h('div.screen.fl', h('header.fl-head', h('h1.pix-title.fl-title', '장비 상점'), h('div.fl-head-x', pointChip(run))),
    h('section.pwin.fl-shopw', h('div.fl-shop', { 'data-sc': 'shop' }, rows)), // 스크롤은 창 안쪽 목록이(창 테두리 밖으로 줄이 걸치지 않게)
    h('div.fl-cmds', manage(ctx, ['inv', 'team', 'artifact', 'items']), out)));
  (ctx.root.querySelector('.fl-buy:not(:disabled)') ?? out).dataset.first = '1';
  return { esc: () => ctx.go('home') };
}

// ---------------- 특훈장 ----------------
export function train(ctx) {
  const { S } = ctx, run = ctx.run(), team = ctx.team(), T = F.catalog().training;
  if (!(S.trainP >= 0 && S.trainP < run.roster.length)) S.trainP = 0;
  const pl = team.players[S.trainP], picks = run.node.picks ?? 0;
  // 특훈 누적 상한(PROTOCOL §13.18 D31, flame_catalog.training.maxPerStat{능력치: 상한} | null = 제한 없음): 고른 선수의 누적(roster[p].train[stat]) + 이번 증가량이 상한을 넘는 특훈은 막고 「최대」(서버도 FLAME_TRAIN_CAP 으로 거절한다 = 토스트)
  const got = run.roster[S.trainP].train ?? {}, caps = T.maxPerStat ?? null;
  const capped = (o) => Number.isFinite(caps?.[o.stat]) && (Number(got[o.stat]) || 0) + o.value > caps[o.stat];
  const opts = T.options.map((o) => {
    const mx = capped(o);
    return h('button.btn.fl-train-b' + (mx ? '.max' : picks > 0 && run.points >= T.cost ? '' : '.dim'), { type: 'button', 'data-k': 'tr-' + o.id, disabled: mx || !(picks > 0),
      'aria-label': `${o.name} ${F.statName(o.stat)} ${mx ? '최대' : `+${o.value}`}`, onclick: () => ctx.send('flame_train', { p: S.trainP, opt: o.id }) },
      h('span.fl-train-n', o.name), h('span.fl-train-v.tabular', mx ? `${F.statName(o.stat)} ${pl.final[o.stat]}${F.statUnit(o.stat)} · 최대`
        : `${F.statName(o.stat)} ${pl.final[o.stat]} → ${pl.final[o.stat] + (pl.over?.[o.stat] ? 0 : o.value)}${F.statUnit(o.stat)}`));
  });
  const out = btn('나가기', 'leave', () => ctx.send('flame_leave'), '.primary.center');
  ctx.root.append(h('div.screen.fl', h('header.fl-head', h('h1.pix-title.fl-title', '특훈장'),
    h('div.fl-head-x', chip('남은 특훈', String(picks)), chip('비용', String(T.cost)), pointChip(run))),
    playerRow(ctx, S.trainP, (i) => { S.trainP = i; ctx.paint(); }),
    h('section.pwin.fl-trainw', h('div.fl-train', { role: 'group', 'aria-label': '특훈' }, opts)), // 스크롤은 창 안쪽 칸 묶음이
    h('div.fl-cmds', btn('장비 강화', 'open-inv', () => ctx.open('inv'), '.center'), manage(ctx, ['team', 'artifact', 'items']), out)));
  (ctx.root.querySelector('.fl-train-b:not(:disabled)') ?? out).dataset.first = '1';
  return { esc: () => ctx.go('home') };
}

// ---------------- 휴식실 ----------------
export function rest(ctx) {
  const { S } = ctx, run = ctx.run(), R = F.catalog().rest ?? [];
  if (!(S.restP >= 0 && S.restP < run.roster.length)) S.restP = 0;
  const label = (o) => (o.target === 'player' ? `${o.name} · ${pname(run.roster[S.restP].from)} HP +${o.healPct}%` : `${o.name} · HP +${o.healPct}%`);
  const bs = R.map((o, i) => btn(label(o), 'rest-' + i,
    () => ctx.send('flame_choose', o.target === 'player' ? { i, p: S.restP } : { i }, { done: label(o) }), '.center' + (i === 0 ? '.primary' : ''))); // done = 응답 뒤 확인 토스트(index.js showDone)
  if (bs[0]) bs[0].dataset.first = '1';
  ctx.root.append(h('div.screen.fl', h('header.fl-head', h('h1.pix-title.fl-title', '휴식실')),
    playerRow(ctx, S.restP, (i) => { S.restP = i; ctx.paint(); }),
    h('div.fl-cmds.wide', bs)));
  return { esc: () => ctx.peek(true) }; // Esc = 지도(모드 메인으로 나가지 않는다). 지도의 '휴식실' 로 돌아온다
}

// ---------------- 선수 영입 ----------------
const REC_CMP = ['s0', 's4', 's1', 's5']; // 교체 대상과 견주는 능력치: HP·공격·방어·캐치
export function recruit(ctx) {
  const { S } = ctx, run = ctx.run(), pend = run.pending[0], list = pend.choices ?? [];
  // 주인공 칸(flame_state.run.cast.players[i].locked, PROTOCOL §13.8)은 교체 대상으로 고를 수 없다: 흐리게 두고 누르면 서버 거절(FLAME_PROTAGONIST)과 같은 문구를 토스트로
  const locked = (i) => run.cast?.players?.[i]?.locked === true;
  // 교체 대상의 기본값은 없음이다(직접 고르기 전에는 영입 버튼을 누를 수 없다). 후보 묶음이 바뀌면 고른 것을 비운다
  const recKey = `${run.id}:${run.layer}:${list.map((c) => c?.id ?? `${c?.team}:${c?.idx}`).join(',')}`;
  if (S.recKey !== recKey) { S.recKey = recKey; S.recP = null; S.recSel = 0; }
  if (!(S.recSel >= 0 && S.recSel < list.length)) S.recSel = 0;
  if (!(Number.isInteger(S.recP) && S.recP >= 0 && S.recP < run.roster.length) || locked(S.recP)) S.recP = null;
  const out = S.recP === null ? null : ctx.team().players[S.recP]; // 교체 대상(능력치 비교의 기준 = 그 선수의 기본 능력치)
  const allow = ctx.team().allow ?? [], G = F.granted();
  // 후보 칸(PROTOCOL §13.10): 클론 {kind:'clone', name, role, stat, sp, skin} = 자기 이름·역할·색 입힌 몸(ui.js bindCast 가 걸어 둔 칸), 원작 {kind:'original', rare, stat, sp} = 종전 표시 + 희귀 발견 표식.
  // stat·sp 가 없는 칸(종전 서버)은 종전대로 화면 에셋(편성 표 6종·ROM 필살기)으로 채운다. 등급(grade)은 보이지 않는다(능력치 숫자로 판단)
  const cards = list.map((c, i) => {
    const clone = isClone(c), rare = c.kind === 'original' && c.rare === true;
    const six = F.SIX_KEYS.every((k) => Number.isFinite(c.stat?.[k])) ? F.SIX_KEYS.map((k) => c.stat[k]) : clone ? null : F.baseSix(c);
    // 필살기 칸. 부여 구조(§13.21): 클론 = 「필살기 없음」, 원작 선수 = 고유 슛 이름 + 「고유」(후보 칸의 sp 만 쓴다. 「미습득」 없음). 종전: 원래 필살기 + 아티팩트가 없으면 「미습득」
    const csp = Number.isInteger(c.sp) && c.sp >= 0 ? c.sp : null;
    const own = G ? (clone ? null : csp) : Object.hasOwn(c, 'sp') ? csp : ownShotOf(c), none = !G && own !== null && !allow.includes(own);
    return h('button.pwin.fl-card.fl-rec-card' + (rare ? '.rare' : ''), { type: 'button', 'data-k': 'rc-' + i, 'aria-pressed': String(S.recSel === i),
      'aria-label': `${pname(c)} ${clone ? F.roleName(c.role) : tname(c.team)}${rare ? ' 원작' : ''}`, onclick: () => { S.recSel = i; if (none) learnTip(own); ctx.paint(); } },
      h('div.fl-cx-top', sprite(c), h('div', h('div.fl-cx-name', pname(c)), h('div.fl-cx-sub', pteam(c), rare ? h('b.fl-rare-m', '원작') : null))),
      // 교체 대상을 골랐으면 HP·공격·방어·캐치의 증감(후보 − 교체 대상, 기본 능력치끼리)을 장비 보상 카드와 같은 ▲▼ 로
      six ? h('div.fl-kv' + (out ? '.cmp' : ''), F.SIX_KEYS.map((k, j) => {
        const df = out && REC_CMP.includes(k) && Number.isFinite(out.base?.[k]) ? six[j] - out.base[k] : 0;
        return h('span', h('i', F.statName(k)), h('b.tabular', String(six[j]), df ? h('em.fl-diff' + (df > 0 ? '.up' : '.down'), df > 0 ? `▲${df}` : `▼${-df}`) : null));
      })) : null,
      G ? (own !== null ? h('div.fl-cx-line', { 'data-k': 'rc-sp' }, h('i', '필살기'), F.shotName(own), h('span.tag.host', '고유')) : h('div.fl-cx-line', { 'data-k': 'rc-sp' }, F.NO_SHOT))
        : h('div.fl-cx-line', h('i', '필살기'), own !== null ? F.shotName(own) : '없음', none ? h('span.tag.off', '미습득') : null));
  });
  const no = btn('영입 안 함', 'rc-no', () => ctx.send('flame_choose', { i: -1 }), '.center');
  const yes = btn(list.length && S.recP !== null ? `영입 · ${F.josa(pname(run.roster[S.recP].from), '와/과')} 교체` : '영입', 'rc-yes', () => S.recP !== null && ctx.send('flame_choose', { i: S.recSel, p: S.recP }), '.primary.center', { disabled: !list.length || S.recP === null });
  // 후보 3~8칸(PB04·C19): 넓은 화면의 열 수 = 4칸까지 한 줄, 5~8칸은 두 줄로 고르게(5 = 3+2 … 8 = 4+4, many = 스프라이트 한 단계 작게). 좁은·낮은 화면은 CSS 가 폭으로 정하고 카드 줄이 스크롤한다
  ctx.root.append(h('div.screen.fl', h('header.fl-head', h('h1.pix-title.fl-title', '선수 영입')),
    h('div.fl-cards.rec' + (list.length > 4 ? '.many' : ''), { 'data-sc': 'rec', style: { '--cols': String(list.length <= 4 ? Math.max(1, list.length) : Math.ceil(list.length / 2)) } }, list.length ? cards : h('div.empty', '후보가 없습니다')),
    h('div.fl-cmp', h('span.fl-cmp-t', '교체할 선수'), playerRow(ctx, S.recP, (i) => { S.recP = i; ctx.paint(); }, 'out', locked, () => toast('주인공은 교체할 수 없습니다', 'error'))),
    h('div.fl-cmds.two', yes, no)));
  (ctx.root.querySelector('.fl-rec-card') ?? no).dataset.first = '1';
  // 후보가 많아 카드 줄이 스크롤될 때: 고른 카드가 보이게(이미 보이면 그대로)
  requestAnimationFrame(() => ctx.root.querySelector('.fl-rec-card[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  return { esc: () => ctx.go('home') };
}

// ---------------- 특별 이벤트 ----------------
const OP_TEXT = {
  points: (o) => `경기 포인트 ${F.sgn(o.value)}`, hpAll: (o) => `전원 HP ${F.sgn(o.value)}`, hpAllPct: (o) => `전원 HP ${F.sgn(o.value)}%`, hpCaptain: (o) => `주장 HP ${F.sgn(o.value)}`,
  trainRandom: (o) => `한 명 ${F.statName(o.stat)} ${F.sgn(o.value)}`, gamble: (o) => `${o.winPct}% 확률로 경기 포인트 +${o.win}`,
  gainEquipment: () => '장비 1개', gainConsumable: () => '소모품 1개', gainArtifact: () => (F.artOff() ? '필살기 아이템 1개' : '아티팩트 1개'), // off(§13.26 D61): E05 = 필살기 아이템
};
export function event(ctx) {
  const run = ctx.run(), pend = run.pending[0], ev = F.eventDef(pend.event);
  const bs = (ev?.choices ?? []).map((c, i) => {
    const fx = [c.cost ? `경기 포인트 −${c.cost}` : null, ...c.ops.map((o) => OP_TEXT[o.op]?.(o))].filter(Boolean);
    return h('button.btn.fl-ev-b' + (run.points < (c.cost ?? 0) ? '.dim' : ''), { type: 'button', 'data-k': 'ev-' + i, onclick: () => ctx.send('flame_choose', { i }) },
      h('span.fl-ev-n', c.name), h('span.fl-ev-fx', fx.length ? fx.join(' · ') : '변화 없음'));
  });
  if (bs[0]) bs[0].dataset.first = '1';
  ctx.root.append(h('div.screen.fl.fl-event', h('header.fl-head', h('h1.pix-title.fl-title', '특별 이벤트'), h('div.fl-head-x', pointChip(run))),
    h('section.pwin.fl-ev', h('h2.fl-ev-t', ev?.name ?? ''), h('div.fl-ev-list', bs))));
  return { esc: () => ctx.go('home') };
}
