// 불꽃의 계승: 모드 메인(§12.3) · 영구 성장(§10.3, 17항목) · 도감 3종(선수·장비·아티팩트) · 기록 및 업적 · 도전 종료(§12.9).
import { h } from '../../util.js';
import { toast } from '../../ui.js';
import { fmNameKo } from '../../game/formation.js';
import * as F from './store.js';
import { icon, emptyIcon, pface, pname, pteam, isClone, tname, emblem, sprite, head, chip, btn, castFor, rarTag, artKindTag, keepMark, SNAP_SLOTS, snapsOf, snapLabel, snapRec, snapBody, snapPicker, snapPickEsc, snapOn } from './ui.js';
import { champCoins } from './run.js';

const coinChip = (n) => chip('불꽃코인', String(n), '.coin');
/** 내 순위(도달 순위표의 내 줄, PROTOCOL §13.13 flame_ranking.me.rank). 손님(me:null)·기록 없는 계정(rank:null)·아직 받지 못했으면 null → 줄을 그리지 않는다 */
const myRank = (app) => { const r = app.flameRank?.me?.rank; return Number.isInteger(r) && r > 0 ? r : null; };
/** 저장 팀(팀 스냅샷 3칸, §13.20-B): 칸이 하나라도 있는가 */
const anySnap = (P) => Object.values(snapsOf(P)).some(Boolean);
const SNAP_EMPTY_MSG = '「팀 저장」으로 채울 수 있습니다';
/** 모드 소개 창(홈 메뉴 「모드 소개」). 설명 문구 최소화 규칙: 한 줄만. 시작 팀 구성(FLAME_START_CLONES)은 켜고 끌 수 있어 단정하지 않는다. 근거: 종료·정산 server/flame/run.js settle */
const INFO_LINES = [
  '지도를 따라 구간 보스를 넘는 도전입니다. 지거나 포기하면 장비·영입 선수는 사라지고 불꽃코인이 남습니다.',
];

// ---------------- 모드 메인 ----------------
// 배치(2026-11-22 사용자 채택 시안 B, _mockup/flame_home): 로고 아래 3단 = [프로필(팀 이름·순위·코인·기록) | 메뉴 | 저장 팀(제목 + 슬롯 3줄)], 창 높이 통일.
// 확인 창(모드 소개·새 도전·첫 팀 이름)은 3단 자리에 하나만 뜬다. 모바일 세로 = 프로필 → 저장 팀 → 메뉴(2열) 순으로 쌓는다(CSS)
/** 첫 팀 이름 창을 이 브라우저에서 이미 거쳤는가(닉네임별). 서버 저장이 아니라 「최초 1회」 표시만 막는다 */
const tnKey = (app) => 'dd.flTnAsked:' + (app?.nick ?? '');
export const markTnAsked = (app) => { try { localStorage.setItem(tnKey(app), '1'); } catch { /* 저장소 막힘: 다음에 다시 묻는다 */ } };
const tnAsked = (app) => { try { return localStorage.getItem(tnKey(app)) === '1'; } catch { return false; } };
const tnDef = (P) => (typeof P.teamNameDefault === 'string' ? P.teamNameDefault : '');
const tnNow = (P) => (typeof P.teamName === 'string' && P.teamName ? P.teamName : tnDef(P));
/** 첫 「새로운 도전」에서 팀 이름을 물을까: 이름 기능이 있고, 이름을 정한 적 없고, 모드를 해 본 적 없고(profile.played), 이 브라우저에서 아직 묻지 않았다 */
const needName = (app, P) => !!tnDef(P) && !(typeof P.teamName === 'string' && P.teamName) && P.played !== true && !tnAsked(app);

export function home(ctx) {
  const { S } = ctx, P = ctx.prof(), run = ctx.run();
  const diffs = (F.catalog().difficulty ?? []).filter((d) => P.unlocked.difficulty.includes(d.id));
  if (!diffs.some((d) => d.id === S.newDiff)) S.newDiff = 0;
  const startNew = () => { S.newAsk = false; if (ctx.send('flame_new', { diff: S.newDiff })) ctx.expectRun(); ctx.paint(); };
  const needAsk = () => !!run || diffs.length > 1;
  const askNew = () => {
    if (needName(ctx.app, P)) { S.nameAsk = true; S.tnVal = tnNow(P); ctx.paint(); } else if (needAsk()) { S.newAsk = true; ctx.paint(); } else startNew();
  };
  const cancel = () => { S.newAsk = false; S.nameAsk = false; S.tnThen = null; ctx.paint(); };
  const top = h('div.fl-home-top', h('div.fl-logo', { role: 'img', 'aria-label': '불꽃의 계승' }, h('span.fl-logo-f', { 'aria-hidden': 'true' }), h('b', '불꽃의 계승')));
  const closeInfo = () => { S.info = false; ctx.paint(); };
  let body;
  if (S.info) {
    // 모드 소개(메뉴 맨 위 「모드 소개」): 3단 자리에 창 하나. 닫기 = 버튼·Esc(게임패드 B)·창 밖 클릭
    const x = btn('닫기', 'info-close', closeInfo, '.center', { 'data-sfx': 'cancel' });
    x.dataset.first = '1';
    body = h('section.pwin.fl-ask.fl-info', { role: 'dialog', 'aria-label': '불꽃의 계승 모드 소개' },
      h('h2.fl-info-t', '불꽃의 계승'),
      h('ul.fl-info-l', INFO_LINES.map((t) => h('li', t))),
      h('div.fl-cmds', x));
  } else if (S.nameAsk) body = nameAsk(ctx, P, needAsk(), startNew, cancel);
  else if (S.newAsk) {
    const ok = btn('시작', 'new-ok', startNew, '.primary.center');
    const no = btn('취소', 'new-no', cancel, '.center', { 'data-sfx': 'cancel' });
    no.dataset.first = '1';
    body = h('section.pwin.fl-ask', { role: 'dialog', 'aria-label': '새로운 도전' },
      run ? h('div.fl-ask-t', '진행 중인 도전을 포기하고 새로 시작합니다') : null,
      snapOn() && anySnap(P) ? h('span.kp-keep', { 'data-k': 'keep-stay' }, keepMark(), '저장 팀 유지') : null,
      diffs.length > 1 ? h('div.fl-opts', { role: 'group', 'aria-label': '난이도' }, diffs.map((d) =>
        h('button.btn', { type: 'button', 'data-k': 'diff-' + d.id, 'aria-pressed': String(S.newDiff === d.id), onclick: () => { S.newDiff = d.id; ctx.paint(); } }, d.name))) : null,
      h('div.fl-cmds', ok, no));
  } else {
    const items = [
      ['모드 소개', 'info', () => { S.info = true; ctx.paint(); }],
      ['새로운 도전', 'new', askNew], ['이어하기', 'cont', () => ctx.go('run'), !run], ['영구 성장', 'perm', () => ctx.go('perm')],
      ['선수 도감', 'cx-player', () => { S.codexTab = 'player'; S.codexSel = null; ctx.go('codex'); }],
      ['장비 도감', 'cx-equip', () => { S.codexTab = 'equip'; S.codexSel = null; ctx.go('codex'); }],
      [F.artOff() ? '아이템 도감' : '아티팩트 도감', 'cx-art', () => { S.codexTab = 'art'; S.codexSel = null; ctx.go('codex'); }], // off(§13.26): 필살기·포메이션 아이템
      ['기록 및 업적', 'rec', () => ctx.go('records')],
      ['불꽃의 계승 랭킹', 'rank', () => ctx.go('rank')], // 2026-11-22: 아래 줄 우측 「순위」 버튼을 메뉴로 옮김(같은 data-k·같은 화면)
    ];
    // 첫 방문(끝낸 도전 0회) = 「모드 소개」 옆 점 배지(깜박임 없음). 첫 포커스는 종전대로 새로운 도전/이어하기
    const fresh = !(P.totals?.runs > 0);
    const bs = items.map(([label, k, fn, off]) => h('button.ritem.fl-menu-b', { type: 'button', 'data-k': k, disabled: !!off, onclick: fn }, label,
      k === 'info' && fresh ? h('i.fl-dot', { 'aria-hidden': 'true' }) : null));
    bs.find((b) => b.dataset.k === (run ? 'cont' : 'new')).dataset.first = '1';
    body = h('div.fl-hb' + (snapOn() ? '' : '.nokp'), profile(ctx, P, run), h('nav.pwin.fl-menu', { 'aria-label': '불꽃의 계승' }, bs), snapOn() ? keepWin(ctx, P) : null);
  }
  const scr = h('div.screen.fl.fl-home', top, body,
    h('footer.fl-foot', btn('뒤로 가기', 'back', ctx.leave, '.small.back')));
  if (S.info) scr.addEventListener('click', (e) => { if (!body.contains(e.target) && !e.target.closest('button')) closeInfo(); }); // 소개 창 밖 클릭 = 닫기
  ctx.root.append(scr);
  return { esc: () => (S.tnEdit ? tnCancel(ctx) : S.info ? closeInfo() : S.newAsk || S.nameAsk ? cancel() : ctx.leave()) };
}

/** 프로필 창: 팀 이름(눌러 고침) · 내 순위(크게, 있을 때만) · 불꽃코인 · 최고 도달 구간 · 최고 기록 · 우승(있을 때만) */
function profile(ctx, P, run) {
  const rank = myRank(ctx.app);
  const kv = (k, v, c = '') => h('div.fl-pf-kv' + c, h('i', k), h('b.tabular', v));
  return h('section.pwin.fl-pf', { 'aria-label': '내 기록' },
    teamNameUi(ctx, P),
    rank !== null ? h('div.fl-pf-rank', h('i', '내 순위'), h('b.tabular', `${rank}위`)) : null,
    h('div.fl-pf-l', kv('불꽃코인', String(P.coins), '.coin'), kv('최고 도달 구간', F.segText(P.best.seg, run, ctx.S.segments)), kv('최고 기록', `${P.best.wins}승`),
      P.best.clears ? kv('우승', `${P.best.clears}회`) : null));
}

/** 저장 팀 창: 제목 줄 + 슬롯 3줄(한 줄 한 팀: 슬롯 · 팀 이름 · 구간·승수). 찬 줄 = 「저장 팀」 화면(카드·삭제), 빈 줄(점선) = 저장 방법 토스트 */
function keepWin(ctx, P) {
  const T = snapsOf(P), n = SNAP_SLOTS.filter((k) => T[k]).length;
  return h('section.pwin.kp-win', { 'aria-label': '저장 팀' }, h('div.kp-title', keepMark(), '저장 팀', h('span.kp-n.tabular', `${n}/${SNAP_SLOTS.length}`)),
    SNAP_SLOTS.map((k) => {
      const t = T[k];
      if (!t) return h('button.kp-slot.empty', { type: 'button', 'data-k': 'keep-' + k, 'aria-label': `${snapLabel(k)} 빈 슬롯`, onclick: () => toast(SNAP_EMPTY_MSG, 'info') }, h('b.sn-slot', snapLabel(k)), h('span.kp-nm', '빈 슬롯'));
      return h('button.kp-slot', { type: 'button', 'data-k': 'keep-' + k, 'aria-label': `${snapLabel(k)} ${t.team?.name ?? ''} ${snapRec(t)}`, onclick: () => ctx.go('snaps') },
        h('b.sn-slot', snapLabel(k)), h('span.kp-nm', t.team?.name ?? ''), h('span.kp-rc.tabular', snapRec(t)), h('span.kp-go', { 'aria-hidden': 'true' }, '▶'));
    }));
}

/** 첫 팀 이름 창(새 도전 최초 1회): 기본 이름이 채워진 입력 칸 · 글자 수 · 시작/취소(건너뛰기 없음 — 기본 이름 그대로 「시작」). 거절은 서버 토스트, 창은 남는다 */
function nameAsk(ctx, P, ask, startNew, cancel) {
  const { S } = ctx, def = tnDef(P), max = F.catalog()?.versusTeam?.teamName?.max ?? 12;
  const len = (v) => `${[...String(v ?? '')].length}/${max}`;
  const ct = h('span.fl-tnask-c.tabular', len(S.tnVal));
  const go = () => {
    const v = String(S.tnVal ?? '').trim();
    if (!v || v === def) { markTnAsked(ctx.app); S.nameAsk = false; if (ask) { S.newAsk = true; ctx.paint(); } else startNew(); return; }
    if (ctx.send('flame_team_name', { name: v })) { S.tnPending = true; S.tnThen = ask ? 'ask' : 'new'; } // 성공 응답 뒤 index.js 가 이어서 시작
  };
  const inp = h('input.rinput.fl-tnask-in', { type: 'text', maxlength: String(max), value: S.tnVal ?? '', placeholder: def, 'data-k': 'tn-first', 'aria-label': '팀 이름', autocomplete: 'off', spellcheck: 'false',
    oninput: (e) => { S.tnVal = e.target.value; ct.textContent = len(e.target.value); },
    onkeydown: (e) => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); go(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } } });
  inp.dataset.first = '1';
  return h('section.pwin.fl-ask.fl-tnask', { role: 'dialog', 'aria-label': '팀 이름' }, h('h2.fl-info-t', '팀 이름'), h('div.fl-tnask-r', inp, ct),
    h('div.fl-cmds', btn('시작', 'tn-first-ok', go, '.primary.center'), btn('취소', 'tn-first-no', cancel, '.center', { 'data-sfx': 'cancel' })));
}

// ---------------- 팀 이름(§13.20-B flame_team_name) ----------------
const tnCancel = (ctx) => { ctx.S.tnEdit = false; ctx.S.tnVal = null; ctx.paint(); };
/** 프로필 창의 팀 이름: 점선 밑줄 + 연필(눌러 고침). 누르면 그 자리에서 입력 칸(최대 12자). 비우고 확인 = 기본 이름. 거절(FLAME_TEAM_NAME_LONG·INVALID)은 서버 토스트, 입력 칸은 남는다 */
function teamNameUi(ctx, P) {
  const { S } = ctx, def = tnDef(P);
  if (!def) return null; // 이 기능이 없는 서버
  const now = tnNow(P), max = F.catalog()?.versusTeam?.teamName?.max ?? 12;
  if (!S.tnEdit) return h('button.fl-tn-b', { type: 'button', 'data-k': 'tn', 'aria-label': `팀 이름 ${now} 바꾸기`, onclick: () => { S.tnEdit = true; S.tnVal = now; ctx.paint(); } },
    h('i', '팀 이름', h('span.fl-pen', { 'aria-hidden': 'true' })), h('b', now));
  const ok = () => { if (ctx.send('flame_team_name', { name: String(S.tnVal ?? '').trim() })) S.tnPending = true; };
  const inp = h('input.rinput.fl-tn-in', { type: 'text', maxlength: String(max), value: S.tnVal ?? now, placeholder: def, 'data-k': 'tn-in', 'aria-label': '팀 이름', autocomplete: 'off', spellcheck: 'false',
    oninput: (e) => { S.tnVal = e.target.value; },
    onkeydown: (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); ok(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tnCancel(ctx); }
    } });
  inp.dataset.first = '1';
  return h('div.fl-tn', inp, h('div.fl-tn-x', btn('확인', 'tn-ok', ok, '.small.primary'), btn('취소', 'tn-no', () => tnCancel(ctx), '.small', { 'data-sfx': 'cancel' })));
}

// ---------------- 저장 팀(카드 3장, 보기 + 칸별 삭제) ----------------
export function snaps(ctx) {
  const { S } = ctx, T = snapsOf(ctx.prof());
  const back = () => { S.snapDel = null; ctx.go('home'); };
  const cards = SNAP_SLOTS.map((k) => {
    const t = T[k];
    if (!t) return h('div.sn-card.sn-empty', { 'data-k': 'sv-' + k }, h('b.sn-slot', snapLabel(k)), h('span', '빈 슬롯'));
    const no = btn('취소', 'del-no-' + k, () => { S.snapDel = null; ctx.paint(); }, '.small', { 'data-sfx': 'cancel' });
    if (S.snapDel === k) no.dataset.first = '1';
    const x = S.snapDel === k ? [h('span.sn-ask', '지울까요?'), btn('삭제', 'del-ok-' + k, () => ctx.send('flame_snap_delete', { slot: k }), '.small.danger'), no]
      : btn('삭제', 'del-' + k, () => { S.snapDel = k; ctx.paint(); }, '.small');
    return h('div.sn-card', { 'data-k': 'sv-' + k }, snapBody(t, k, h('span.sn-x', x)));
  });
  const b = btn('돌아가기', 'back', back, '.small.back');
  if (!S.snapDel) b.dataset.first = '1';
  ctx.root.append(h('div.screen.fl.fl-snaps', h('header.fl-head', h('h1.pix-title.fl-title', '저장 팀'), h('div.fl-head-x'), b),
    h('section.pwin.sn-win', h('div.sn-list', { 'data-sc': 'snaps' }, cards))));
  return { esc: () => { if (S.snapDel) { S.snapDel = null; ctx.paint(); } else back(); } };
}

// ---------------- 영구 성장 ----------------
const PERM_GROUP = { A: '기본 훈련', B: '출발 준비', C: '콘텐츠 해금' };
const PERM_KEY = { startMatchPoints: (n) => `시작 경기 포인트 +${n}`, startEquipmentChoices: (n) => `시작 장비 선택 +${n}`, startArtifactChoices: (n) => `시작 아티팩트 선택 +${n}`,
  recruitCandidates: (n) => `영입 후보 +${n}`, shopSlots: (n) => `상점 상품 +${n}`, upgradeCostDiscountPct: (n) => `강화 비용 −${n}%`, rewardRerolls: (n) => `재선택 +${n}` };
// 단계당 효과 + 산 단계가 있으면 총효과(「· 현재 +6」). 옛 저장 이관(PROTOCOL §13.23)으로 A 단계가 maxLevel 보다 클 수 있어 총효과는 lv 그대로 곱한다
function permText(id, lv) {
  const e = F.permDef(id)?.effect;
  if (!e || !Number.isFinite(e.perLevel)) return '';
  const one = e.stat ? `${F.statName(e.stat)} +${e.perLevel}` : PERM_KEY[e.key]?.(e.perLevel) ?? '';
  if (!one || !(lv > 1)) return one;
  const n = e.perLevel * lv;
  return `${one} · 현재 ${e.key === 'upgradeCostDiscountPct' ? `−${n}%` : `+${n}`}`;
}
export function perm(ctx) {
  const P = ctx.prof();
  const back = () => ctx.go('home');
  const row = (u) => {
    const max = u.next === null || u.next === undefined, over = u.lv > u.maxLevel; // over = 옛 표에서 산 효과를 보존한 단계(더 살 수 없음)
    return h('div.fl-perm-row' + (max ? '.max' : ''),
      h('span.fl-perm-n', u.name), h('span.fl-perm-e', typeof u.text === 'string' && u.text ? u.text : permText(u.id, u.lv)), // off(§13.26): 뜻이 바뀐 항목(PB03)은 서버 문구 permList[].text
      h('span.fl-pips', { role: 'img', 'aria-label': max ? '최대' + (over ? ' · 이전 구매 보존' : '') : `${u.lv}/${u.maxLevel}단계`, title: over ? '이전 구매 보존' : null },
        Array.from({ length: u.maxLevel }, (_, i) => h('i' + (i < u.lv ? '.on' : '')))),
      h('button.btn.small.fl-perm-b' + (!max && P.coins < u.next ? '.dim' : ''), { type: 'button', 'data-k': 'perm-' + u.id, disabled: max, 'aria-label': `${u.name} ${max ? '최대' : `${u.next} 불꽃코인`}`,
        onclick: () => ctx.send('flame_perm', { id: u.id }) }, max ? '최대' : h('span.tabular', String(u.next))));
  };
  const groups = ['A', 'B', 'C'].map((g) => h('section.pwin.fl-perm-g', { 'aria-label': PERM_GROUP[g] },
    h('h2.fl-sub', PERM_GROUP[g]), P.permList.filter((u) => u.group === g && !(F.catalog().artifact?.hiddenPerm ?? []).includes(u.id)).map(row))); // hiddenPerm(PC03) = 서버도 빼서 보낸다
  ctx.root.append(h('div.screen.fl', head('영구 성장', back, coinChip(P.coins)), h('div.fl-perm', { 'data-sc': 'perm' }, groups)));
  const first = ctx.root.querySelector('.fl-perm-b:not(:disabled)') ?? ctx.root.querySelector('[data-k="back"]');
  first.dataset.first = '1';
  return { esc: back };
}

// ---------------- 도감 ----------------
const CODEX_TABS = [['player', '선수'], ['equip', '장비'], ['art', '아티팩트']];
const codexTabs = () => CODEX_TABS.map(([k, l]) => [k, k === 'art' && F.artOff() ? '필살기·포메이션 아이템' : l]); // off(§13.26)
export function codex(ctx) {
  const { S } = ctx, P = ctx.prof(), run = ctx.run(), C = F.catalog();
  const back = () => ctx.go('home');
  // 발견 = 영구 저장의 도감 + 지금 도전에서 가진 것(도전 중 도감은 도전이 끝날 때 영구 저장에 합쳐진다)
  const seen = {
    equip: new Set([...P.codex.items, ...(run?.items ?? []).map((i) => i.id)]),
    art: new Set([...P.codex.artifacts, ...(run?.artifactsOwned ?? [])]),
    // 선수 키: 원작·시작 7명 = '팀:번호'(능력치 출처), 영입 풀 클론 = 'c:<id>'(PROTOCOL §13.10). 클론 칸의 from 은 몸을 빌린 원작 선수라 원작 발견으로 세지 않는다
    player: [...new Set([...P.codex.players, ...(run?.roster ?? []).map((r) => (typeof r.clone === 'string' ? 'c:' + r.clone : isClone(r.from) ? null : `${r.from.team}:${r.from.idx}`)).filter(Boolean)])],
  };
  const tab = S.codexTab;
  const tabs = h('div.fl-tabs', { role: 'group', 'aria-label': '도감' }, codexTabs().map(([k, label]) =>
    h('button.btn.small', { type: 'button', 'data-k': 'tab-' + k, 'aria-pressed': String(tab === k), onclick: () => { S.codexTab = k; S.codexSel = null; ctx.paint(); } }, label)));
  let grid, detail = null, count;
  const pick = (id) => { S.codexSel = id; ctx.paint(); };
  if (tab === 'player') {
    // 한 칸 = {id(도감 키), f(표시용 선수 칸) | null(정의 없는 클론 키), kind}. 순서: 오리지널(시작 7명) → 원작 선수 → 영입 클론
    //  - '팀:번호' 가 flame_catalog.original.players[].base 와 같으면 오리지널 선수(이름·색 입힌 얼굴·팀), 아니면 원작 선수(종전)
    //  - 'c:<id>' 는 flame_state.profile.codexCast[키](PROTOCOL §13.16)의 이름·역할·skin. 아직 정산 전인 지금 도전의 클론은 로스터 칸(run.cast)으로,
    //    어느 쪽에도 정의가 없는 키(풀에서 사라진 id)는 「영입 선수」 한 칸으로 둔다. 등급(grade)은 화면에 내지 않는다
    const O = C.original && Array.isArray(C.original.players) ? C.original : null, CC = P.codexCast && typeof P.codexCast === 'object' ? P.codexCast : {};
    const list = seen.player.map((id) => {
      if (typeof id !== 'string') return null;
      if (id.startsWith('c:')) {
        const live = run?.roster?.find((r) => r.clone === id.slice(2) && isClone(r.from))?.from, d = CC[id];
        if (live) return { id, f: live, kind: 2 };
        if (d && typeof d.name === 'string' && d.name && d.skin) return { id, f: castFor({ team: d.skin.team, idx: d.skin.idx }, { kind: 'clone', name: d.name, role: d.role, skin: d.skin }), kind: 2 };
        return { id, f: null, kind: 2 };
      }
      const [team, idx] = id.split(':').map(Number);
      if (!Number.isInteger(team) || !Number.isInteger(idx)) return null;
      const o = O?.players.find((p) => p?.base?.team === team && p.base.idx === idx && typeof p.name === 'string' && p.name);
      return o ? { id, f: castFor({ team, idx }, o, O), kind: 0, ord: O.players.indexOf(o) } : { id, f: { team, idx }, kind: 1, ord: team * 7 + idx };
    }).filter(Boolean).sort((a, b) => a.kind - b.kind || (a.kind === 2 ? a.id.localeCompare(b.id) : a.ord - b.ord));
    const UNK = '영입 선수';
    count = `${list.length}명`;
    grid = h('div.fl-cx-grid.pl', { 'data-sc': 'cx' }, list.length ? list.map(({ id, f }) =>
      h('button.fl-cx-cell', { type: 'button', 'data-k': 'cx-' + id, 'aria-pressed': String(S.codexSel === id), 'aria-label': f ? pname(f) : UNK, onclick: () => pick(id) },
        f ? pface(f) : emptyIcon('?'), h('span.nm', f ? pname(f) : UNK))) : h('div.empty', '아직 만난 선수가 없습니다'));
    const cell = list.find((x) => x.id === S.codexSel), sel = cell?.f ?? null;
    if (cell && !sel) detail = [h('div.fl-cx-top', emptyIcon('?'), h('div.fl-cx-name', UNK))];
    else if (sel) {
      // 클론의 능력치·필살기는 도감 정의에 없다(몸을 빌린 원작 선수의 값을 내면 틀린다) → 이름·역할·모습만
      // 부여 구조(§13.21): 고유 슛은 원작 선수(kind 1)만 갖는다 — 오리지널(불씨) 선수 칸에는 필살기 줄을 내지 않는다
      const G = F.granted(), clone = cell.kind === 2, six = clone ? null : F.baseSix(sel), own = clone || (G && cell.kind !== 1) ? null : F.ownShot(sel);
      detail = [h('div.fl-cx-top', sprite(sel), h('div', h('div.fl-cx-name', pname(sel)), h('div.fl-cx-sub', pteam(sel)))),
        six ? h('div.fl-kv', F.SIX_KEYS.map((k, i) => h('span', h('i', F.statName(k)), h('b.tabular', String(six[i]))))) : null,
        own !== null ? h('div.fl-cx-line', h('i', '필살기'), F.shotName(own), G ? h('span.tag.host', '고유') : null) : null];
    }
  } else {
    // 아티팩트 탭(§13.22): 분모 = 손으로 쓴 것(30종)만. 등급 아이템은 종류(슛 47 · 포메이션 15)마다 한 칸 = 발견한 가장 높은 등급(딱지), 묶음 머리에 발견 수
    // off(§13.26): 손으로 쓴 아티팩트(30종) 칸·분모를 내지 않는다 — 종류별 최고 등급 묶음만, 머리 수 = 묶음 합
    const OFF = tab === 'art' && F.artOff(), has = seen[tab], all = tab === 'equip' ? C.equipment : OFF ? [] : C.artifacts.filter((d) => !F.grantOf(d));
    count = `${all.filter((d) => has.has(d.id)).length}/${all.length}`;
    const groups = [];
    if (tab === 'art') {
      const best = new Map();
      for (const id of has) { const g = F.grantOf(F.artDef(id)); if (g && !(best.get(`${g.kind}:${g.key}`)?.rank >= g.rank)) best.set(`${g.kind}:${g.key}`, g); }
      if (F.gradeOn() || best.size) for (const kind of ['shot', 'formation']) {
        const keys = [...new Set(C.artifacts.map(F.grantOf).filter((g) => g?.kind === kind).map((g) => g.key))];
        const list = keys.map((key) => { const grade = best.get(`${kind}:${key}`)?.grade ?? null; return { id: (kind === 'shot' ? 'SP' : 'FM') + key, d: F.artDef(F.gradeId(kind, key, grade ?? 'C')), grade }; }).filter((x) => x.d);
        if (list.length) groups.push({ kind, list });
      }
    }
    if (OFF) { const xs = groups.flatMap((g) => g.list); count = `${xs.filter((x) => x.grade).length}/${xs.length}`; }
    grid = h('div.fl-cx-grid', { 'data-sc': 'cx' }, all.map((d) => {
      const ok = has.has(d.id);
      return h('button.fl-cx-cell' + (ok ? '' : '.unk'), { type: 'button', 'data-k': 'cx-' + d.id, 'aria-pressed': String(S.codexSel === d.id), 'aria-label': ok ? d.name : '미발견', onclick: () => pick(d.id) },
        icon(d, { dim: !ok }), h('span.nm', ok ? d.name : '???'));
    }), groups.map((g) => [h('h2.fl-sub.fl-cx-h', { 'data-k': 'cxh-' + g.kind }, F.KIND_KO[g.kind], h('span.fl-count.tabular', `${g.list.filter((x) => x.grade).length}/${g.list.length}`)),
      g.list.map((x) => h('button.fl-cx-cell' + (x.grade ? '' : '.unk'), { type: 'button', 'data-k': 'cx-' + x.id, 'aria-pressed': String(S.codexSel === x.id), 'aria-label': x.grade ? `${F.artName(x.d)} ${x.grade} 등급` : '미발견', onclick: () => pick(x.id) },
        icon(x.d, { dim: !x.grade, grade: x.grade }), h('span.nm', x.grade ? F.artName(x.d) : '???')))]));
    const d = all.find((x) => x.id === S.codexSel), gx = groups.flatMap((g) => g.list).find((x) => x.id === S.codexSel);
    if (gx) {
      detail = gx.grade ? [h('div.fl-cx-top', icon(gx.d, { big: true }), h('div', h('div.fl-cx-name', F.artName(gx.d)), h('div.fl-cx-sub', artKindTag(gx.d)))), h('div.fl-cx-spec', F.artLine(gx.d)), F.artPair(gx.d) ? h('div.fl-cx-spec.fl-pair', F.artPair(gx.d)) : null]
        : [h('div.fl-cx-top', icon(gx.d, { big: true, dim: true, grade: null }), h('div.fl-cx-name', '???'))];
    } else if (d && has.has(d.id)) {
      detail = [h('div.fl-cx-top', icon(d, { big: true }), h('div', h('div.fl-cx-name', d.name),
        h('div.fl-cx-sub', tab === 'equip' ? [rarTag(d.rarity), F.SLOT_KO[d.slot]] : artKindTag(d)))),
        h('div.fl-cx-spec', tab === 'equip' ? d.specText : F.artSpec(d)), tab !== 'equip' && F.artPair(d) ? h('div.fl-cx-spec.fl-pair', F.artPair(d)) : null,
        tab !== 'equip' && F.artShot(d.id) !== null ? h('div.fl-cx-line', { 'data-k': 'art-shot' }, h('i', '대표 슛'), F.shotName(F.artShot(d.id))) : null];
    } else if (d) detail = [h('div.fl-cx-top', icon(d, { big: true, dim: true }), h('div.fl-cx-name', '???'))];
  }
  ctx.root.append(h('div.screen.fl', head('도감', back, tabs, h('span.fl-count.tabular', count)),
    h('div.fl-cx', h('section.pwin.fl-cx-list', grid), h('section.pwin.fl-cx-detail', { 'aria-live': 'polite' }, detail ?? h('div.empty', '')))));
  (ctx.root.querySelector('.fl-cx-cell') ?? ctx.root.querySelector('[data-k="back"]')).dataset.first = '1';
  return { esc: back };
}

// ---------------- 기록 및 업적 ----------------
export function records(ctx) {
  const P = ctx.prof(), C = F.catalog(), run = ctx.run();
  const back = () => ctx.go('home');
  const b = btn('돌아가기', 'back', back, '.small.back');
  b.dataset.first = '1';
  const kv = (k, v) => h('div.fl-rec-row', h('i', k), h('b.tabular', v));
  ctx.root.append(h('div.screen.fl', h('header.fl-head', h('h1.pix-title.fl-title', '기록 및 업적'), h('div.fl-head-x', coinChip(P.coins)), b),
    h('div.fl-rec',
      h('section.pwin.fl-rec-box', h('h2.fl-sub', '기록'),
        kv('최고 도달 구간', F.segText(P.best.seg, run, ctx.S.segments)), kv('한 도전 최다 승리', `${P.best.wins}승`), kv('우승', `${P.best.clears}회`),
        kv('도전 횟수', `${P.totals.runs}회`), kv('누적 승리', `${P.totals.wins}승`), kv('보스 격파', `${P.totals.boss}회`), kv('누적 불꽃코인', String(P.earned))),
      h('section.pwin.fl-rec-box', h('h2.fl-sub', '업적'),
        (C.achievements ?? []).map((a) => { const on = P.achievements.includes(a.id); return h('div.fl-ach' + (on ? '.on' : ''), h('span.fl-ach-m', { 'aria-hidden': 'true' }), h('span', a.name), h('b', on ? '달성' : '')); })))));
  return { esc: back };
}

// ---------------- 도전 종료 ----------------
const END_TITLE = { defeat: '도전 종료', champion: '우승', abandon: '도전 포기' };
export function end(ctx) {
  const { app } = ctx, m = app.flameEnd;
  const done = () => { app.flameEnd = null; ctx.go(ctx.run() ? 'run' : 'home'); };
  const ok = btn('확인', 'ok', done, '.primary.center.big');
  ok.dataset.first = '1';
  // 팀 저장(§13.20-B): 경기를 치른 이 도전의 팀이 남아 있으면(summary.teamSave + profile.teamEnded) 칸 고르기 → flame_snap_save{src:'ended'}
  const P = ctx.prof(), canSave = snapOn() && m.teamSave === true && P?.teamEnded === true;
  const save = canSave ? btn('팀 저장', 'snap', () => { ctx.S.snapPick = {}; document.activeElement?.blur(); ctx.paint(); }, '.center.big') : null;
  const kv = (k, v) => h('div.fl-rec-row', h('i', k), h('b.tabular', v));
  const coins = m.coins ?? { total: 0 };
  const parts = [['일반', coins.normal], ['강팀', coins.strong], ['보스', coins.boss], ['우승', coins.champion], ['첫 우승', coins.first]].filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`).join(' + ') + (coins.pct && coins.pct !== 100 ? ` ×${coins.pct}%` : '');
  const lost = m.lost ?? {};
  // off(§13.26): lost.artifacts = 보유한 필살기·포메이션 아이템 수
  const lostRows = [['장비', lost.items, '개'], [F.artOff() ? '필살기·포메이션 아이템' : '아티팩트', lost.artifacts, '개'], ['소모품', lost.consumables, '개'], ['경기 포인트', lost.points, ''], ['영입 선수', lost.recruited, '명']];
  const ach = (m.achievements ?? []).map((id) => F.achDef(id)?.name).filter(Boolean);
  // 우승한 도전(엔드리스는 우승해도 도전이 이어져 result 가 'champion' 으로 오지 않는다 → summary.championed): 제목을 금색으로 바꾸고 제목 바로 아래에 우승 요약 한 줄(소멸 목록보다 먼저 보인다)
  const won = m.result === 'champion' || m.championed === true, cc = champCoins(coins), rank = myRank(app);
  const title = won && m.result !== 'champion' ? `우승 · ${END_TITLE[m.result] ?? '도전 종료'}` : END_TITLE[m.result] ?? '도전 종료';
  ctx.root.append(h('div.screen.fl.fl-end' + (won ? '.champ' : ''),
    h('h1.pix-title.fl-end-t' + (won ? '.win' : ''), title),
    won ? h('div.fl-end-champ', h('span.fl-logo', h('span.fl-logo-f', { 'aria-hidden': 'true' }), h('b', '우승')),
      h('div.fl-chips', chip('도달 구간', F.segText(m.seg, m, ctx.S.segments)), cc > 0 ? chip('우승 코인', `+${cc}`, '.coin') : null, rank !== null ? chip('내 순위', `${rank}위`, '.rank') : null)) : null,
    h('div.fl-end-body',
      h('section.pwin.fl-rec-box', h('h2.fl-sub', '이번 도전'),
        kv('도달 구간', F.segText(m.seg, m, ctx.S.segments)), // 엔드리스 = 분모 없음(summary.endless, PROTOCOL §13.12)
        kv('승리', `${m.matches}승` + (m.matches ? ` (일반 ${m.wins.normal} · 강팀 ${m.wins.strong} · 보스 ${m.wins.boss})` : '')),
        h('div.fl-rec-row', h('i', '격파한 보스'), h('b.fl-end-boss', m.bosses?.length ? m.bosses.map((t) => h('span', emblem(t), tname(t))) : '없음')),
        h('div.fl-rec-row', h('i', '최고 장비 등급'), m.bestRarity ? rarTag(m.bestRarity) : h('b', '없음')),
        kv('사용한 포메이션', m.formations?.length ? m.formations.map(fmNameKo).join(' · ') : '없음'),
        // 경기를 한 판도 치르지 않은 도전은 도전 횟수·최고 기록·업적에 들지 않는다(summary.counted, PROTOCOL §13.3)
        // 엔드리스는 우승해도 도전이 이어져 result 가 'champion' 으로 오지 않는다: 우승 여부는 summary.championed 로 표식 한 개
        !won && rank !== null ? kv('내 순위', `${rank}위`) : null,
        m.counted === false ? h('div.fl-end-tags', h('span.tag.off', '기록 미반영')) : null),
      h('section.pwin.fl-rec-box.fl-keep', h('h2.fl-sub', '보존'),
        h('div.fl-rec-row.fl-coin-row', h('i', '획득 불꽃코인'), h('b.tabular', `+${coins.total}`)),
        parts ? h('div.fl-end-parts.tabular', parts) : null,
        coins.defeat > 0 ? kv('분투 보상', `+${coins.defeat}`) : null, // 패배 분투 보상(PROTOCOL §13.3, total 에 이미 포함)
        ach.length ? h('div.fl-rec-row', h('i', '새 업적'), h('b', ach.join(' · '))) : null),
      h('section.pwin.fl-rec-box.fl-lost', h('h2.fl-sub', '소멸'),
        lostRows.filter(([, v]) => v > 0).map(([k, v, u]) => kv(k, `${v}${u}`)))),
    canSave && ctx.S.snapPick ? snapPicker(ctx, 'ended') : h('div.fl-cmds' + (save ? '' : '.one'), save, ok)));
  return { esc: () => snapPickEsc(ctx) || done() };
}
