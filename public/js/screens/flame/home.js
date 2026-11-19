// 불꽃의 계승: 모드 메인(§12.3) · 영구 성장(§10.3, 17항목) · 도감 3종(선수·장비·아티팩트) · 기록 및 업적 · 도전 종료(§12.9).
import { h } from '../../util.js';
import { fmNameKo } from '../../game/formation.js';
import * as F from './store.js';
import { icon, emptyIcon, pface, pname, pteam, isClone, tname, emblem, sprite, head, chip, btn, castFor } from './ui.js';
import { champCoins } from './run.js';

const coinChip = (n) => chip('불꽃코인', String(n), '.coin');
/** 내 순위(도달 순위표의 내 줄, PROTOCOL §13.13 flame_ranking.me.rank). 손님(me:null)·기록 없는 계정(rank:null)·아직 받지 못했으면 null → 줄을 그리지 않는다 */
const myRank = (app) => { const r = app.flameRank?.me?.rank; return Number.isInteger(r) && r > 0 ? r : null; };

// ---------------- 모드 메인 ----------------
export function home(ctx) {
  const { S } = ctx, P = ctx.prof(), run = ctx.run();
  const diffs = (F.catalog().difficulty ?? []).filter((d) => P.unlocked.difficulty.includes(d.id));
  if (!diffs.some((d) => d.id === S.newDiff)) S.newDiff = 0;
  const startNew = () => { S.newAsk = false; if (ctx.send('flame_new', { diff: S.newDiff })) ctx.expectRun(); ctx.paint(); };
  const askNew = () => { if (run || diffs.length > 1) { S.newAsk = true; ctx.paint(); } else startNew(); };
  const cancel = () => { S.newAsk = false; ctx.paint(); };
  const top = h('div.fl-home-top',
    h('div.fl-logo', { role: 'img', 'aria-label': '불꽃의 계승' }, h('span.fl-logo-f', { 'aria-hidden': 'true' }), h('b', '불꽃의 계승')),
    h('div.fl-chips', coinChip(P.coins), chip('최고 도달 구간', F.segText(P.best.seg, run, S.segments)), chip('최고 기록', `${P.best.wins}승`), P.best.clears ? chip('우승', `${P.best.clears}회`) : null,
      myRank(ctx.app) !== null ? chip('내 순위', `${myRank(ctx.app)}위`, '.rank') : null));
  let body;
  if (S.newAsk) {
    const ok = btn('시작', 'new-ok', startNew, '.primary.center');
    const no = btn('취소', 'new-no', cancel, '.center', { 'data-sfx': 'cancel' });
    no.dataset.first = '1';
    body = h('section.pwin.fl-ask', { role: 'dialog', 'aria-label': '새로운 도전' },
      run ? h('div.fl-ask-t', '진행 중인 도전을 포기하고 새로 시작합니다') : null,
      diffs.length > 1 ? h('div.fl-opts', { role: 'group', 'aria-label': '난이도' }, diffs.map((d) =>
        h('button.btn', { type: 'button', 'data-k': 'diff-' + d.id, 'aria-pressed': String(S.newDiff === d.id), onclick: () => { S.newDiff = d.id; ctx.paint(); } }, d.name))) : null,
      h('div.fl-cmds', ok, no));
  } else {
    const items = [
      ['새로운 도전', 'new', askNew], ['이어하기', 'cont', () => ctx.go('run'), !run], ['영구 성장', 'perm', () => ctx.go('perm')],
      ['선수 도감', 'cx-player', () => { S.codexTab = 'player'; S.codexSel = null; ctx.go('codex'); }],
      ['장비 도감', 'cx-equip', () => { S.codexTab = 'equip'; S.codexSel = null; ctx.go('codex'); }],
      ['아티팩트 도감', 'cx-art', () => { S.codexTab = 'art'; S.codexSel = null; ctx.go('codex'); }],
      ['기록 및 업적', 'rec', () => ctx.go('records')],
    ];
    const bs = items.map(([label, k, fn, off]) => h('button.btn.fl-menu-b', { type: 'button', 'data-k': k, disabled: !!off, onclick: fn }, label));
    (run ? bs[1] : bs[0]).dataset.first = '1';
    body = h('nav.pwin.fl-menu', { 'aria-label': '불꽃의 계승' }, bs);
  }
  ctx.root.append(h('div.screen.fl.fl-home', top, body,
    h('footer.fl-foot', btn('뒤로 가기', 'back', ctx.leave, '.small.back'), btn('순위', 'rank', () => ctx.go('rank'), '.small'))));
  return { esc: () => (S.newAsk ? cancel() : ctx.leave()) };
}

// ---------------- 영구 성장 ----------------
const PERM_GROUP = { A: '기본 훈련', B: '출발 준비', C: '콘텐츠 해금' };
const PERM_KEY = { startMatchPoints: (n) => `시작 경기 포인트 +${n}`, startEquipmentChoices: (n) => `시작 장비 선택 +${n}`, startArtifactChoices: (n) => `시작 아티팩트 선택 +${n}`,
  recruitCandidates: (n) => `영입 후보 +${n}`, shopSlots: (n) => `상점 상품 +${n}`, upgradeCostDiscountPct: (n) => `강화 비용 −${n}%`, rewardRerolls: (n) => `재선택 +${n}` };
function permText(id) {
  const e = F.permDef(id)?.effect;
  if (!e) return '';
  if (e.stat) return `${F.statName(e.stat)} +${e.perLevel}`;
  return PERM_KEY[e.key]?.(e.perLevel) ?? '';
}
export function perm(ctx) {
  const P = ctx.prof();
  const back = () => ctx.go('home');
  const row = (u) => {
    const max = u.next === null || u.next === undefined;
    return h('div.fl-perm-row' + (max ? '.max' : ''),
      h('span.fl-perm-n', u.name), h('span.fl-perm-e', permText(u.id)),
      h('span.fl-pips', { role: 'img', 'aria-label': `${u.lv}/${u.maxLevel}단계` }, Array.from({ length: u.maxLevel }, (_, i) => h('i' + (i < u.lv ? '.on' : '')))),
      h('button.btn.small.fl-perm-b' + (!max && P.coins < u.next ? '.dim' : ''), { type: 'button', 'data-k': 'perm-' + u.id, disabled: max, 'aria-label': `${u.name} ${max ? '최대' : `${u.next} 불꽃코인`}`,
        onclick: () => ctx.send('flame_perm', { id: u.id }) }, max ? '최대' : h('span.tabular', String(u.next))));
  };
  const groups = ['A', 'B', 'C'].map((g) => h('section.pwin.fl-perm-g', { 'aria-label': PERM_GROUP[g] },
    h('h2.fl-sub', PERM_GROUP[g]), P.permList.filter((u) => u.group === g).map(row)));
  ctx.root.append(h('div.screen.fl', head('영구 성장', back, coinChip(P.coins)), h('div.fl-perm', { 'data-sc': 'perm' }, groups)));
  const first = ctx.root.querySelector('.fl-perm-b:not(:disabled)') ?? ctx.root.querySelector('[data-k="back"]');
  first.dataset.first = '1';
  return { esc: back };
}

// ---------------- 도감 ----------------
const CODEX_TABS = [['player', '선수'], ['equip', '장비'], ['art', '아티팩트']];
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
  const tabs = h('div.fl-tabs', { role: 'group', 'aria-label': '도감' }, CODEX_TABS.map(([k, label]) =>
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
      const clone = cell.kind === 2, six = clone ? null : F.baseSix(sel), own = clone ? null : F.ownShot(sel);
      detail = [h('div.fl-cx-top', sprite(sel), h('div', h('div.fl-cx-name', pname(sel)), h('div.fl-cx-sub', pteam(sel)))),
        six ? h('div.fl-kv', F.SIX_KEYS.map((k, i) => h('span', h('i', F.statName(k)), h('b.tabular', String(six[i]))))) : null,
        own !== null ? h('div.fl-cx-line', h('i', '필살기'), F.shotName(own)) : null];
    }
  } else {
    const all = tab === 'equip' ? C.equipment : C.artifacts, has = seen[tab];
    count = `${all.filter((d) => has.has(d.id)).length}/${all.length}`;
    grid = h('div.fl-cx-grid', { 'data-sc': 'cx' }, all.map((d) => {
      const ok = has.has(d.id);
      return h('button.fl-cx-cell' + (ok ? '' : '.unk'), { type: 'button', 'data-k': 'cx-' + d.id, 'aria-pressed': String(S.codexSel === d.id), 'aria-label': ok ? d.name : '미발견', onclick: () => pick(d.id) },
        icon(d, { dim: !ok }), h('span.nm', ok ? d.name : '???'));
    }));
    const d = all.find((x) => x.id === S.codexSel);
    if (d && has.has(d.id)) {
      detail = [h('div.fl-cx-top', icon(d, { big: true }), h('div', h('div.fl-cx-name', d.name),
        h('div.fl-cx-sub', tab === 'equip' ? [h('span.fl-rar.r-' + d.rarity, F.rarityName(d.rarity)), F.SLOT_KO[d.slot]] : F.CAT_KO[d.category] ?? ''))),
        h('div.fl-cx-spec', d.specText)];
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
  const kv = (k, v) => h('div.fl-rec-row', h('i', k), h('b.tabular', v));
  const coins = m.coins ?? { total: 0 };
  const parts = [['일반', coins.normal], ['강팀', coins.strong], ['보스', coins.boss], ['우승', coins.champion], ['첫 우승', coins.first]].filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`).join(' + ') + (coins.pct && coins.pct !== 100 ? ` ×${coins.pct}%` : '');
  const lost = m.lost ?? {};
  const lostRows = [['장비', lost.items, '개'], ['아티팩트', lost.artifacts, '개'], ['소모품', lost.consumables, '개'], ['경기 포인트', lost.points, ''], ['영입 선수', lost.recruited, '명']];
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
        h('div.fl-rec-row', h('i', '최고 장비 등급'), m.bestRarity ? h('b.fl-rar.r-' + m.bestRarity, F.rarityName(m.bestRarity)) : h('b', '없음')),
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
    h('div.fl-cmds.one', ok)));
  return { esc: done };
}
