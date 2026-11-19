// 불꽃의 계승 도전 중 관리 화면: 선수 관리·장비 관리(§12.5) / 팀 공용 아티팩트 + 필살기 슬롯(§12.6) / 포메이션(§12.7) / 소모품(§9).
// 능력치는 서버 계산 결과(flame_state.team.players[i]: steps[9]·delta·over·move)를 그대로 그린다. 장착·해제·강화는 요청만 보내고 응답 상태로 다시 그린다.
import { h } from '../../util.js';
import { toast } from '../../ui.js';
import { FM_NAMES_KO, fmNameKo } from '../../game/formation.js';
import * as F from './store.js';
import { icon, emptyIcon, pface, pname, pteam, ownShotOf, sprite, hpBar, hpOf, statTable, head, chip, btn, learnTip, gradeTag, rarTag, artKindTag } from './ui.js';
import { extraSpec } from './run.js';

const canUpgradeHere = (run) => run.node?.type === 'training' || run.node?.type === 'shop';
/** 누가 끼고 있는 장비인가(flame_state.run.items[].wearer = 라인업 번호, 아무도 안 끼면 -1) */
const isWorn = (it) => Number.isInteger(it?.wearer) && it.wearer >= 0;
/** 기본 포메이션(아이템 없이 쓰는 패턴)의 태그 표기(§13.22: 태그·보너스·시너지 없음) */
const NO_TAG = '태그 없음';

/** 관리 화면 머리줄 탭(시안 05): 선수 · 장비 · 아티팩트 · 필살기 슬롯 · 포메이션. 누르면 그 겹쳐 여는 화면으로 바꾼다(지도의 명령 줄과 같은 화면) */
// 팀 공용 아티팩트 끄기(§13.26, flame_catalog.artifact.model 'off'): 아티팩트 탭을 빼고 4종
const SUB_TABS = [['team', '선수'], ['inv', '장비'], ['art', '아티팩트'], ['sp', '필살기 슬롯'], ['fm', '포메이션']];
function subTabs(ctx, cur) {
  const go = (k) => { if (k === 'art' || k === 'sp') { ctx.S.artTab = k; ctx.open('artifact'); } else ctx.open(k === 'fm' ? 'formation' : k); };
  return h('div.fl-tabs.fl-subtabs', { role: 'group', 'aria-label': '관리' }, SUB_TABS.filter(([k]) => !(k === 'art' && F.artOff())).map(([k, label]) =>
    h('button.btn.small', { type: 'button', 'data-k': 'tab-' + k, 'aria-pressed': String(cur === k), onclick: () => { if (k !== cur) go(k); } }, label)));
}

// ---------------- 선수 관리 / 장비 관리 ----------------
export function team(ctx, name) {
  const { S } = ctx, run = ctx.run(), T = ctx.team(), invMode = name === 'inv';
  const n = run.roster.length;
  if (!(S.selP >= 0 && S.selP < n)) S.selP = 0;
  if (!F.catalog().slots.includes(S.selSlot)) S.selSlot = F.catalog().slots[0];
  const r = run.roster[S.selP], pl = T.players[S.selP];
  let sel = run.items.find((it) => it.inst === S.selInst) ?? null;
  if (sel && !invMode && sel.slot !== S.selSlot) sel = null;
  if (!sel) S.selInst = null;
  const worn = (slot) => run.items.find((it) => it.inst === r.equip[slot]) ?? null;
  const back = () => ctx.close();

  // 왼쪽: 선수 7명
  const move = (d) => {
    const j = S.selP + d;
    if (j < 0 || j >= n) return;
    const order = run.roster.map((_, i) => i);
    [order[S.selP], order[j]] = [order[j], order[S.selP]];
    if (ctx.send('flame_lineup', { order })) S.selP = j;
  };
  const list = h('div.fl-tm-list', { role: 'group', 'aria-label': '선수' }, run.roster.map((x, i) => {
    const p = T.players[i], eqN = Object.values(x.equip).filter((v) => v !== null && v !== undefined).length, hp = hpOf(run, T, i);
    // 시안 05: 1줄 = 이름 + 공·방, 2줄 = HP 눈금 + 숫자 + 주장. 역할(내야·외야 · 역할)은 가운데 창 이름 옆, 장비 수는 읽기 이름에만
    return h('button.fl-tm-p', { type: 'button', 'data-k': 'p-' + i, 'aria-pressed': String(S.selP === i),
      'aria-label': `${pname(x.from)} ${F.roleName(p.role)} HP ${hp.hp}/${hp.max} 장비 ${eqN}`, onclick: () => { S.selP = i; S.selInst = null; ctx.paint(); } },
      pface(x.from),
      h('span.fl-tm-pm', h('span.fl-tm-l1', h('b.nm', pname(x.from)), h('span.fl-tm-two.tabular', `공 ${p.final.s4} 방 ${p.final.s1}`)),
        h('span.fl-tm-l2', hpBar(hp.hp, hp.max, hp.up), F.artOff() && x.spItem && p.special?.grade ? gradeTag(p.special.grade) : null, i === 0 ? h('span.tag.host.fl-cap', '주장') : null))); // off: 필살기 아이템을 낀 선수는 등급 딱지
  }));

  // 가운데: 스프라이트 + 능력치(기본 / 장비 / 기타 / 최종 / 비교)
  let preview = null;
  if (sel && S.cmpOff !== true && sel.wearer !== S.selP) {
    const cur = worn(sel.slot)?.stats ?? {};
    preview = Object.fromEntries(F.STAT_KEYS.map((k) => [k, (sel.stats[k] ?? 0) - (cur[k] ?? 0)]));
  }
  const sp0 = r.sp?.[0] ?? null, G = F.granted();
  // 필살기 줄. 부여 구조(§13.21): 주 슬롯이 비면 「필살기 없음」, 고유 슛이면 「고유」(「미습득」 상태는 없다). 종전: 아티팩트가 없는 슛 = 「미습득」
  // 등급제(§13.22, team.players[i].special = {id, grade, add, cut}): 등급 딱지 + 위력 가산, 위력 상한으로 잘렸으면 「상한 −n」
  const spx = F.gradeOn() && pl.special && pl.special.id === sp0 ? pl.special : null;
  const spGrade = spx ? [gradeTag(spx.grade), spx.grade && spx.add > 0 ? h('span.fl-up.tabular', { 'data-k': 'sp-add' }, `위력 +${spx.add}`) : null, spx.grade && pl.fx?.spSpd > 0 ? h('span.fl-up.tabular', { 'data-k': 'sp-spd' }, `필살 속도 +${pl.fx.spSpd}`) : null, spx.cut > 0 ? h('span.fl-warn.tabular', { 'data-k': 'sp-cut' }, `상한 −${spx.cut}`) : null] : null;
  const spLine = G
    ? (sp0 === null ? h('div.fl-cx-line', { 'data-k': 'sp-line' }, F.NO_SHOT) : h('div.fl-cx-line.fl-sp-line', { 'data-k': 'sp-line' }, h('i', '필살기'), F.shotName(sp0), sp0 === pl.own ? h('span.tag.host', '고유') : null, spGrade))
    : h('div.fl-cx-line', h('i', '필살기'), F.shotName(sp0), sp0 !== null && !T.allow.includes(sp0) ? h('button.tag.off.fl-lock', { type: 'button', 'data-k': 'sp-lock', 'aria-label': `미습득 ${F.learnText(sp0)}`, onclick: () => learnTip(sp0) }, '미습득') : null);
  const mid = h('section.pwin.fl-tm-mid', { 'aria-live': 'polite' },
    h('div.fl-tm-top', sprite(r.from),
      h('div.fl-tm-id', h('div.fl-cx-name', pname(r.from), h('span.fl-tm-role', `${S.selP < 4 ? '내야' : '외야'} · ${F.roleName(pl.role)}`)), h('div.fl-cx-sub', pteam(r.from)), spLine),
      h('div.fl-tm-ord', btn('▲', 'ord-up', () => move(-1), '.small.center', { 'aria-label': '순서 앞으로', disabled: S.selP === 0 }),
        btn('▼', 'ord-dn', () => move(1), '.small.center', { 'aria-label': '순서 뒤로', disabled: S.selP === n - 1 }))),
    h('div.fl-stw', { 'data-sc': 'st' }, statTable(pl, preview)),
    preview ? h('div.fl-tm-note', h('i', '비교'), h('b', F.equipDef(sel.id)?.name + (sel.lv ? ` +${sel.lv}` : ''))) : null);

  // 오른쪽: 슬롯 4칸 + 장비 목록
  const slots = h('div.fl-slots', { role: 'group', 'aria-label': '장비 슬롯' }, F.catalog().slots.map((slot) => {
    const it = worn(slot), d = it ? F.equipDef(it.id) : null;
    return h('button.fl-slot', { type: 'button', 'data-k': 'slot-' + slot, 'aria-pressed': String(!invMode && S.selSlot === slot), 'aria-label': `${F.SLOT_KO[slot]} ${d ? d.name : '비어 있음'}`,
      onclick: () => { S.selSlot = slot; S.selInst = it?.inst ?? null; ctx.paint(); } },
      d ? icon(d, { lv: it.lv }) : emptyIcon(), h('span.fl-slot-m', h('i', F.SLOT_KO[slot]))); // 시안 05 슬롯 탭: 그림 + 슬롯 이름(낀 장비 이름은 읽기 이름·목록·상세에)
  }));
  // off(§13.26): 선수마다 필살기 아이템 1칸. 누르면 필살기 슬롯 탭(그 선수)
  if (F.artOff()) {
    const sd = r.spItem ? F.artDef(r.spItem) : null;
    slots.classList.add('sp5');
    slots.append(h('button.fl-slot', { type: 'button', 'data-k': 'slot-sp', 'aria-label': `필살기 아이템 ${sd ? F.artName(sd) : '비어 있음'}`, onclick: () => { S.spP = S.selP; S.artTab = 'sp'; ctx.open('artifact'); } },
      sd ? icon(sd) : emptyIcon(), h('span.fl-slot-m', h('i', '필살기'))));
  }
  const items = run.items.filter((it) => invMode || it.slot === S.selSlot)
    .sort((a, b) => F.catalog().slots.indexOf(a.slot) - F.catalog().slots.indexOf(b.slot) || F.rarityRank(b.rarity) - F.rarityRank(a.rarity) || a.inst - b.inst);
  const inv = h('div.fl-inv', { 'data-sc': 'inv', role: 'group', 'aria-label': invMode ? '보유 장비' : `${F.SLOT_KO[S.selSlot]} 목록` },
    items.length ? items.map((it) => {
      const d = F.equipDef(it.id), w = isWorn(it) ? run.roster[it.wearer] : null;
      if (!d) return null; // 카탈로그에 없는 ID 는 건너뛴다
      return h('button.fl-inv-row', { type: 'button', 'data-k': 'it-' + it.inst, 'aria-pressed': String(S.selInst === it.inst), 'aria-label': `${d.name}${it.lv ? ' +' + it.lv : ''} ${F.statTexts(it.stats).join(', ')}${w ? ', ' + pname(w.from) + ' 장착' : ''}`,
        onclick: () => { S.selInst = it.inst; S.selSlot = it.slot; ctx.paint(); } },
        // 둘째 줄: 능력치, 능력치가 없는 장비는 특수효과 문구(빈 줄로 두지 않는다)
        icon(d, { lv: it.lv }), h('span.fl-inv-m', h('b', d.name), h('span.fl-inv-s', F.statTexts(it.stats).join(' · ') || extraSpec(d))), w ? pface(w.from) : null);
    }) : h('div.empty', '장비가 없습니다'));

  // 고른 장비 상세: 등급·능력치·특수효과·다음 강화(값이 그대로면 '변화 없음')
  let detail = null;
  if (sel && F.equipDef(sel.id)) {
    const d = F.equipDef(sel.id), up = sel.up;
    detail = h('div.fl-it-detail',
      h('div.fl-it-h', h('b', d.name + (sel.lv ? ` +${sel.lv}` : '')), rarTag(d.rarity), h('span', F.SLOT_KO[d.slot])),
      extraSpec(d) ? h('div.fl-it-x', extraSpec(d),
        // 치사 생존(P10)은 도전 전체에서 1회(run.surviveCount): 이미 썼으면 어느 인스턴스든 다시 발동하지 않는다
        d.effects.some((e) => e.type === 'survive_lethal') ? h('span.tag' + (run.surviveCount > 0 ? '.off' : '.ready'), run.surviveCount > 0 ? '사용함' : '남음') : null) : null,
      up && up.cost !== null && up.cost !== undefined
        ? h('div.fl-it-up', h('i', `강화 +${up.lv + 1}`), up.noChange ? h('span.fl-warn', up.noChangeLabel ?? '변화 없음')
          : up.stats.filter((s) => !s.noChange).map((s) => h('span.tabular', `${F.statName(s.stat)} ${s.now} → ${s.next}`)), h('b.tabular', `${up.cost}`))
        : h('div.fl-it-up', h('i', '강화'), h('span', '최대')));
  }

  const upOk = sel && sel.up?.cost !== null && sel.up?.cost !== undefined;
  const equipB = btn(sel && sel.wearer === S.selP ? '장착 중' : '장착', 'equip', () => sel && ctx.send('flame_equip', { p: S.selP, inst: sel.inst }), '.primary.center', { disabled: !sel || sel.wearer === S.selP });
  const cmds = h('div.fl-cmds',
    btn('자동 장착', 'auto', () => ctx.send('flame_auto_equip', { p: S.selP }), '.center'),
    equipB,
    btn(S.cmpOff ? '비교 꺼짐' : '비교', 'cmp', () => { S.cmpOff = !S.cmpOff; ctx.paint(); }, '.center', { 'aria-pressed': String(!S.cmpOff) }),
    btn('해제', 'unequip', () => ctx.send('flame_equip', { p: S.selP, inst: null, slot: sel?.wearer === S.selP ? sel.slot : S.selSlot }), '.center', { disabled: !worn(sel?.wearer === S.selP ? sel.slot : S.selSlot) }),
    btn(upOk ? `강화 ${sel.up.cost}` : '강화', 'upgrade', () => sel && ctx.send('flame_upgrade', { inst: sel.inst }), '.center' + (canUpgradeHere(run) ? '' : '.dim'), { disabled: !upOk }),
    btn(sel ? `판매 ${sel.sell}` : '판매', 'sell', () => sel && ctx.send('flame_sell', { inst: sel.inst }), '.center', { disabled: !sel || isWorn(sel) }),
    btn('다음 선수', 'nextp', () => { S.selP = (S.selP + 1) % n; S.selInst = null; ctx.paint(); }, '.center'));
  ctx.root.append(h('div.screen.fl.fl-team',
    head(invMode ? '장비 관리' : '선수 관리', back, subTabs(ctx, invMode ? 'inv' : 'team'), chip('경기 포인트', String(run.points), '.pt')),
    h('div.fl-tm', h('section.pwin.fl-tm-left', list), mid, h('section.pwin.fl-tm-right', slots, inv, detail)),
    cmds));
  ctx.root.querySelector(`[data-k="p-${S.selP}"]`).dataset.first = '1';
  return { esc: back };
}

// ---------------- 팀 공용 아티팩트 + 필살기 슬롯 ----------------
export function artifact(ctx) {
  const { S } = ctx, run = ctx.run(), T = ctx.team();
  const back = () => ctx.close();
  const OFF = F.artOff(), tab = OFF || S.artTab === 'sp' ? 'sp' : 'art'; // off(§13.26): 필살기 슬롯 보기만
  const tabs = subTabs(ctx, tab); // 아티팩트 · 필살기 슬롯 = 같은 화면의 두 보기(tab-art · tab-sp)
  // 부여 구조(§13.21): 팀 칸에는 낀 아티팩트가 부여한 슛(team.grant)만 낸다 — team.allow 는 엔진용이라 남의 고유 슛이 섞여 있다. 종전 = team.allow
  const G = F.granted(), teamShots = OFF ? [] : G ? T.grant ?? [] : T.allow, shotsTitle = G ? '부여 필살기' : '활성 필살기';
  const allowChips = h('div.fl-chipline', teamShots.length ? F.shotNames(teamShots).map((t) => h('span.tag.ready', t)) : h('span.tag.off', '없음')); // 이름만(내부 번호 없음, 같은 이름은 한 번)
  let body, cmds;
  if (tab === 'art') {
    // 고른 슬롯: 처음(null)·범위 밖이면 첫 빈 칸(없으면 1번). null >= 0 은 참이라 정수인지부터 본다
    if (S.artSel && !run.artifactsOwned.includes(S.artSel)) S.artSel = null;
    if (!(Number.isInteger(S.artSlot) && S.artSlot >= 0 && S.artSlot < run.artifacts.length)) S.artSlot = S.artSel && run.artifacts.includes(S.artSel) ? run.artifacts.indexOf(S.artSel) : Math.max(0, run.artifacts.indexOf(null));
    const selId = S.artSel ?? run.artifacts[S.artSlot] ?? null, d = selId ? F.artDef(selId) : null;
    const at = selId ? run.artifacts.indexOf(selId) : -1;
    const slots = h('div.fl-art-slots', { role: 'group', 'aria-label': '아티팩트 슬롯' }, run.artifacts.map((id, i) => {
      const a = id ? F.artDef(id) : null;
      return h('button.fl-slot.art', { type: 'button', 'data-k': 'as-' + i, 'aria-pressed': String(S.artSlot === i), 'aria-label': `슬롯 ${i + 1} ${a ? F.artName(a) : '비어 있음'}`,
        onclick: () => { S.artSlot = i; S.artSel = id ?? S.artSel; ctx.paint(); } },
        a ? icon(a, { big: true }) : emptyIcon(String(i + 1)), h('span.fl-slot-m', h('i', `슬롯 ${i + 1}`), h('b', a ? F.artName(a) : '-')));
    }));
    const tag = F.tagDef(T.tag), GR = F.gradeOn(), fmNow = GR && Number.isInteger(T.fm) ? T.fm : run.fm; // 등급제: 실제로 쓰이는 패턴 = team.fm(아이템을 빼면 기본 포메이션)
    const fmArts = run.artifacts.filter(Boolean).map(F.artDef).filter((a) => a?.formationTag);
    const info = h('div.fl-art-info', { 'aria-live': 'polite' },
      h('div.fl-art-sec', h('h2.fl-sub', '장착 정보'), d ? [h('div.fl-art-d', icon(d), h('b', F.artName(d)), h('span.fl-card-k', artKindTag(d))), h('p.fl-card-s', F.artLine(d)), F.artPair(d) ? h('p.fl-card-s.fl-pair', F.artPair(d)) : null,
        F.artShot(d.id) !== null && !F.grantOf(d) ? h('div.fl-cx-line', { 'data-k': 'art-shot' }, h('i', '대표 슛'), F.shotName(F.artShot(d.id))) : null] : h('div.empty', '')),
      h('div.fl-art-sec', h('h2.fl-sub', shotsTitle), allowChips),
      h('div.fl-art-sec', h('h2.fl-sub', '시너지'), T.synergies.length ? T.synergies.map((id) => { const s = F.synDef(id); return h('div.fl-syn', h('b', s?.name ?? id), h('span', (s?.specEffects ?? []).join(' · '))); }) : h('span.tag.off', '없음')),
      h('div.fl-art-sec', h('h2.fl-sub', '포메이션 보너스'),
        h('div.fl-syn', h('b', `${fmNameKo(fmNow)} · ${tag?.name ?? (GR ? NO_TAG : '')}`), GR ? gradeTag(T.fmGrade) : null, T.amp.formation ? h('span.fl-up', `강화 +${T.amp.formation}%`) : null),
        fmArts.map((a) => h('div.fl-syn' + (a.formationTag === T.tag ? '' : '.off'), h('b', a.name), h('span', F.artSpec(a))))),
      T.unsupported?.length ? h('div.fl-art-sec', h('h2.fl-sub', '미적용 효과'), h('div.fl-chipline', T.unsupported.map((u) => h('span.tag.off', (F.artDef(u.split(':')[0]) ? F.artName(F.artDef(u.split(':')[0])) : null) ?? F.equipDef(u.split(':')[0])?.name ?? u)))) : null);
    const owned = h('div.fl-art-own', { 'data-sc': 'art', role: 'group', 'aria-label': '보유 아티팩트' }, run.artifactsOwned.length ? run.artifactsOwned.map((id) => {
      const a = F.artDef(id), on = run.artifacts.includes(id);
      if (!a) return null;
      return h('button.fl-inv-row', { type: 'button', 'data-k': 'ao-' + id, 'aria-pressed': String(selId === id), 'aria-label': `${F.artName(a)}${F.grantOf(a) ? ` ${a.grade} 등급` : ''}${on ? ' 장착 중' : ''}`, onclick: () => { S.artSel = id; if (on) S.artSlot = run.artifacts.indexOf(id); ctx.paint(); } }, // 이미 낀 것을 고르면 그 슬롯이 선택된다(「장착 중」)
        icon(a), h('span.fl-inv-m', h('b', F.artName(a)), h('span.fl-inv-s', F.artLine(a))), on ? h('span.tag.ready', '장착') : null);
    }) : h('div.empty', '아티팩트가 없습니다'));
    const occupied = run.artifacts[S.artSlot];
    body = h('div.fl-art', h('section.pwin.fl-art-l', slots, owned), h('section.pwin.fl-art-r', info));
    cmds = h('div.fl-cmds',
      btn(selId && at === S.artSlot ? '장착 중' : occupied && occupied !== selId ? '교체' : '장착', 'a-eq', () => selId && ctx.send('flame_artifact', { id: selId, slot: S.artSlot }), '.primary.center', { disabled: !selId || at === S.artSlot }),
      btn('해제', 'a-un', () => ctx.send('flame_artifact', { id: null, slot: at >= 0 ? at : S.artSlot }), '.center', { disabled: !(at >= 0 || occupied) }));
  } else {
    const n = run.roster.length;
    if (!(S.spP >= 0 && S.spP < n)) S.spP = 0;
    if (S.spSlot !== 1) S.spSlot = 0;
    // 선택지. 부여 구조: 그 선수의 고유 슛(team.players[i].own) + 낀 아티팩트가 부여한 슛(team.grant) — 서버가 받는 집합 그대로다(그 밖은 FLAME_LOCKED).
    // 종전: 몸 주인의 원래 필살기 + 슬롯에 든 것 + team.allow
    const r = run.roster[S.spP], gOwn = T.players[S.spP]?.own, own = G || OFF ? (Number.isInteger(gOwn) && gOwn >= 0 ? gOwn : null) : ownShotOf(r.from), sp = [r.sp?.[0] ?? null, r.sp?.[1] ?? null];
    // off(§13.26): 넣을 수 있는 것 = 그 선수가 낀 아이템의 슛 + 그 선수의 고유 슛(서버 flame_special 규칙)
    const itShot = OFF ? F.grantOf(F.artDef(r.spItem))?.key ?? null : null;
    const opts = OFF ? [...new Set([own, itShot].filter((x) => x !== null))] : G ? [...new Set([...(own !== null ? [own] : []), ...teamShots])] : [...new Set([...(own !== null ? [own] : []), ...sp.filter((x) => x !== null), ...T.allow])];
    const usable = (id) => G || OFF || T.allow.includes(id); // 부여 구조에는 「슬롯에 있지만 발동하지 않는」 상태가 없다(서버가 비운다)
    const none0 = (id, i = 0) => ((G || OFF) && i === 0 && id === null ? F.NO_SHOT : null);
    const set = (id) => {
      const next = sp.slice();
      if (id !== null && next[1 - S.spSlot] === id) next[1 - S.spSlot] = next[S.spSlot]; // 다른 칸에 있던 것이면 두 칸을 맞바꾼다
      next[S.spSlot] = id;
      ctx.send('flame_special', { p: S.spP, sp: next });
    };
    const prow = h('div.fl-prow', { role: 'group', 'aria-label': '선수' }, run.roster.map((x, i) =>
      h('button.fl-pcell', { type: 'button', 'data-k': 'sp-p-' + i, 'aria-pressed': String(S.spP === i), 'aria-label': `${pname(x.from)} ${none0(x.sp?.[0] ?? null) ?? F.shotName(x.sp?.[0] ?? null)}`, onclick: () => { S.spP = i; ctx.paint(); } },
        pface(x.from), h('span.nm', pname(x.from)), h('span.fl-sp-cur' + (x.sp?.[0] !== null && x.sp?.[0] !== undefined && usable(x.sp[0]) ? '.on' : ''), none0(x.sp?.[0] ?? null) ?? F.shotName(x.sp?.[0] ?? null)),
        OFF && x.spItem && T.players[i]?.special?.grade ? gradeTag(T.players[i].special.grade) : null))); // off: 아이템을 낀 선수 = 등급 딱지(한눈에 구분)
    // 슬롯 이름도 선택지와 같은 이름표를 쓴다(같은 이름의 슛이 둘이면 둘째에 순번이 붙는다: 불꽃슛 · 불꽃슛 2. 내부 ID 는 보이지 않는다)
    const optLabels = F.shotLabels(opts), spName = (id, i = 1) => (id === null ? none0(id, i) ?? F.shotName(null) : optLabels[opts.indexOf(id)] ?? F.shotName(id));
    const slotTag = (i) => (sp[i] === null ? null : !usable(sp[i]) ? h('span.tag.off', '미습득') : (G || OFF) && sp[i] === own ? h('span.tag.host', '고유') : i === 0 ? h('span.tag.ready', '발동') : null);
    const slotB = (i) => h('button.fl-slot', { type: 'button', 'data-k': 'sp-s-' + i, 'aria-pressed': String(S.spSlot === i), 'aria-label': `${i ? '예비' : '주'} 슬롯 ${spName(sp[i], i)}`, onclick: () => { S.spSlot = i; if (sp[i] !== null && !usable(sp[i])) learnTip(sp[i]); ctx.paint(); } },
      h('span.fl-slot-m', h('i', i ? '예비' : '주 슬롯'), h('b', spName(sp[i], i))), slotTag(i));
    const optB = h('div.fl-sp-opts', { 'data-sc': 'sp', role: 'group', 'aria-label': '필살기' },
      opts.map((id, i) => h('button.btn.small' + (usable(id) ? '' : '.dim'), { type: 'button', 'data-k': 'sp-o-' + id, 'aria-pressed': String(sp[S.spSlot] === id), onclick: () => { if (!usable(id)) learnTip(id); set(id); } }, optLabels[i], (G || OFF) && id === own ? h('span.tag.host', '고유') : null)),
      h('button.btn.small', { type: 'button', 'data-k': 'sp-o-none', 'aria-pressed': String(sp[S.spSlot] === null), onclick: () => set(null) }, '비움'));
    const swapB = btn('맞바꾸기', 'sp-swap', () => ctx.send('flame_special', { p: S.spP, sp: [sp[1], sp[0]] }), '.center', { disabled: sp[0] === null && sp[1] === null });
    if (OFF) {
      // 선수마다 필살기 아이템 1칸(§13.26 flame_sp_item). 목록 = 보유한 필살기 아이템, 다른 선수가 낀 것은 그 선수 얼굴 + 누르면 토스트(서버도 FLAME_EQUIPPED)
      const own2 = run.artifactsOwned.map((id) => ({ id, d: F.artDef(id) })).filter((x) => F.grantOf(x.d)?.kind === 'shot')
        .sort((a, b) => F.grantOf(b.d).rank - F.grantOf(a.d).rank || F.artName(a.d).localeCompare(F.artName(b.d)));
      // 고른 것이 없어졌거나 다른 선수가 낀 것이면(선수를 바꾼 경우) 이 선수가 낀 것으로
      if (!own2.some((x) => x.id === S.spiSel) || ![-1, S.spP].includes(F.spWearer(run, S.spiSel))) S.spiSel = r.spItem ?? null;
      const sel = own2.find((x) => x.id === S.spiSel) ?? null, sd = r.spItem ? F.artDef(r.spItem) : null;
      const itemSlot = h('div.fl-slot.fl-sp-item', { 'data-k': 'sp-item', role: 'img', 'aria-label': `필살기 아이템 ${sd ? F.artName(sd) : '비어 있음'}` },
        sd ? icon(sd) : emptyIcon(), h('span.fl-slot-m', h('i', '아이템'), h('b', sd ? F.artName(sd) : '-')));
      const list = h('div.fl-art-own', { 'data-sc': 'spi', role: 'group', 'aria-label': '필살기 아이템' }, own2.length ? own2.map(({ id, d }) => {
        const wi = F.spWearer(run, id), mine = wi === S.spP, other = wi >= 0 && !mine ? run.roster[wi] : null;
        return h('button.fl-inv-row' + (other ? '.lock' : ''), { type: 'button', 'data-k': 'spi-' + id, 'aria-pressed': String(S.spiSel === id), ...(other ? { 'aria-disabled': 'true' } : {}),
          'aria-label': `${F.artName(d)} ${F.grantOf(d).grade} 등급${mine ? ' 장착 중' : other ? `, ${pname(other.from)} 장착` : ''}`,
          onclick: () => { if (other) { toast(`${pname(other.from)} 장착 중`, 'info'); return; } S.spiSel = id; ctx.paint(); } },
          icon(d), h('span.fl-inv-m', h('b', F.artName(d)), h('span.fl-inv-s', F.artLine(d))), mine ? h('span.tag.ready', '장착') : other ? pface(other.from) : null);
      }) : h('div.empty', '필살기 아이템이 없습니다'));
      body = h('div.fl-art', h('section.pwin.fl-art-l', prow, h('div.fl-sp-slots.three', itemSlot, slotB(0), slotB(1)), optB),
        h('section.pwin.fl-art-r', h('h2.fl-sub', '필살기 아이템'), list));
      cmds = h('div.fl-cmds',
        btn(sel && sel.id === r.spItem ? '장착 중' : r.spItem && sel ? '교체' : '장착', 'spi-eq', () => sel && ctx.send('flame_sp_item', { p: S.spP, id: sel.id }), '.primary.center', { disabled: !sel || sel.id === r.spItem }),
        btn('해제', 'spi-un', () => ctx.send('flame_sp_item', { p: S.spP, id: null }), '.center', { disabled: !r.spItem }), swapB);
    } else {
      body = h('div.fl-art', h('section.pwin.fl-art-l', prow, h('div.fl-sp-slots', slotB(0), slotB(1))),
        h('section.pwin.fl-art-r', h('h2.fl-sub', shotsTitle), allowChips, h('h2.fl-sub', '선택'), optB));
      cmds = h('div.fl-cmds', swapB);
    }
  }
  ctx.root.append(h('div.screen.fl.fl-artv', head(OFF ? '필살기' : '아티팩트', back, tabs), body, cmds));
  (ctx.root.querySelector('.fl-inv-row, .fl-pcell') ?? ctx.root.querySelector('[data-k="back"]')).dataset.first = '1';
  return { esc: back };
}

// ---------------- 포메이션 ----------------
export function formation(ctx) {
  const { S } = ctx, run = ctx.run(), T = ctx.team();
  const back = () => ctx.close();
  const tag = F.tagDef(T.tag);
  // 등급제(§13.22): 고를 수 있는 것 = 기본 포메이션(태그 없음) + 낀 포메이션 아이템의 패턴, 지금 쓰이는 패턴 = team.fm(아이템을 빼면 기본으로 돌아간다). 종전('off') = 15패턴 전부 · run.fm
  const GR = F.gradeOn(), cur = GR && Number.isInteger(T.fm) ? T.fm : run.fm, fmDef = F.catalog().grade?.formation?.default;
  // off(§13.26): 팀 포메이션 아이템 1칸(run.fmItem, flame_fm_item). 고를 수 있는 것 = 보유한 포메이션 아이템, 빼면 기본 포메이션
  const OFF = F.artOff(), fmItem = OFF ? run.fmItem ?? null : null;
  const fitted = OFF ? [F.grantOf(F.artDef(fmItem))].filter((g) => g?.kind === 'formation') : GR ? run.artifacts.map((id) => F.grantOf(F.artDef(id))).filter((g) => g?.kind === 'formation') : [];
  // 변경 전 상태를 들고 있다가(요청을 보낼 때) 응답 뒤 선수별 최종 능력치를 견준다
  const prev = S.fmPrev && S.fmPrev.runId === run.id && (OFF ? S.fmPrev.item !== fmItem : S.fmPrev.fm !== cur) ? S.fmPrev : null;
  const snapNow = () => ({ runId: run.id, fm: cur, item: fmItem, finals: T.players.map((p) => ({ ...p.final })) });
  const change = (fm) => {
    if (fm === cur) return;
    const snap = snapNow();
    if (ctx.send('flame_formation', { fm })) S.fmPrev = snap;
  };
  const wear = (id) => {
    if (id === fmItem) return;
    const snap = snapNow();
    if (ctx.send('flame_fm_item', { id })) S.fmPrev = snap;
  };
  const cell = (i, g = null) => {
    const t = GR && !g ? null : F.tagOfFm(i), tn = t?.name ?? (GR ? NO_TAG : '');
    return h('button.fl-fm-cell.g-' + (t?.id ?? 'none'), { type: 'button', 'data-k': 'fm-' + i, 'aria-pressed': String(cur === i), 'aria-label': `${fmNameKo(i)} ${tn}${g ? ` ${g.grade} 등급` : ''}`, onclick: () => change(i) },
      h('b', fmNameKo(i)), h('span.fl-fm-tag', tn, g ? gradeTag(g.grade) : null));
  };
  const fmKeys = GR ? [...new Set([...(Number.isInteger(fmDef) ? [fmDef] : []), ...fitted.map((g) => g.key), cur])] : FM_NAMES_KO.map((_, i) => i);
  let grid, fmSel = null;
  if (OFF) {
    const own = run.artifactsOwned.map((id) => ({ id, d: F.artDef(id) })).filter((x) => F.grantOf(x.d)?.kind === 'formation')
      .sort((a, b) => F.grantOf(b.d).rank - F.grantOf(a.d).rank || F.artName(a.d).localeCompare(F.artName(b.d)));
    if (!own.some((x) => x.id === S.fmSel)) S.fmSel = fmItem;
    fmSel = own.find((x) => x.id === S.fmSel) ?? null;
    const fd = fmItem ? F.artDef(fmItem) : null;
    grid = [h('div.fl-sp-slots.one', h('div.fl-slot.fl-sp-item', { 'data-k': 'fm-item', role: 'img', 'aria-label': `포메이션 아이템 ${fd ? F.artName(fd) : '비어 있음'}` },
        fd ? icon(fd) : emptyIcon(), h('span.fl-slot-m', h('i', '포메이션 아이템'), h('b', fd ? F.artName(fd) : '-')))),
      h('div.fl-art-own', { 'data-sc': 'fmi', role: 'group', 'aria-label': '포메이션 아이템' }, own.length ? own.map(({ id, d }) =>
        h('button.fl-inv-row', { type: 'button', 'data-k': 'fmi-' + id, 'aria-pressed': String(S.fmSel === id), 'aria-label': `${F.artName(d)} ${F.grantOf(d).grade} 등급${id === fmItem ? ' 장착 중' : ''}`, onclick: () => { S.fmSel = id; ctx.paint(); } },
          icon(d), h('span.fl-inv-m', h('b', F.artName(d)), h('span.fl-inv-s', F.artLine(d))), id === fmItem ? h('span.tag.ready', '장착') : null))
        : h('div.empty', '포메이션 아이템이 없습니다'))];
  } else grid = h('div.fl-fm-grid', { role: 'group', 'aria-label': '포메이션' }, fmKeys.map((i) => cell(i, fitted.find((g) => g.key === i) ?? null)));
  const sumOf = (id) => {
    const tot = {};
    for (const p of T.players) for (const [k, v] of Object.entries(p.steps.find((s) => s.id === id)?.add ?? {})) tot[k] = Math.max(tot[k] ?? 0, v);
    return F.statTexts(tot);
  };
  const fmArts = OFF ? [] : run.artifacts.filter(Boolean).map(F.artDef).filter((a) => a?.formationTag === T.tag);
  const fmFx = sumOf('formation'), synFx = sumOf('synergy');
  let cmp = null;
  if (prev) {
    const rows = [];
    run.roster.forEach((r, i) => {
      const ch = F.STAT_KEYS.filter((k) => prev.finals[i]?.[k] !== T.players[i].final[k]);
      if (ch.length) rows.push(h('div.fl-fm-cmp-row', pface(r.from), h('span.nm', pname(r.from)),
        h('span.fl-fm-cmp-v', ch.map((k) => { const a = prev.finals[i][k], b = T.players[i].final[k]; return h('span.tabular' + (b > a ? '.up' : '.down'), `${F.statName(k)} ${a} → ${b}`); }))));
    });
    cmp = h('div.fl-art-sec', h('h2.fl-sub', `${fmNameKo(prev.fm)} → ${fmNameKo(cur)}`), rows.length ? rows : h('span.fl-warn', '변화 없음'));
  }
  const info = h('section.pwin.fl-art-r', { 'aria-live': 'polite' },
    h('div.fl-art-sec', h('h2.fl-sub', '현재 포메이션'), h('div.fl-fm-cur', h('b', fmNameKo(cur)), GR && !tag ? h('span.tag.off', NO_TAG) : h('span.tag.host', tag?.name ?? ''), GR ? gradeTag(T.fmGrade) : null)),
    // 등급 보너스(team.fmGrade): 태그 보너스 배율(flame_catalog.grade.formation.tagPct). 등급의 팀 능력치 가산은 아래 「기본 효과」에 이미 들어 있다(능력치 6단계)
    !OFF && GR && T.fmGrade && Number.isFinite(F.catalog().grade?.formation?.tagPct?.[T.fmGrade]) ? h('div.fl-art-sec', { 'data-k': 'fm-grade' }, h('h2.fl-sub', '등급 보너스'),
      h('div.fl-chipline', h('span.tag.ready', `태그 보너스 ${F.catalog().grade.formation.tagPct[T.fmGrade]}%`))) : null,
    h('div.fl-art-sec', h('h2.fl-sub', '기본 효과'), fmFx.length ? h('div.fl-chipline', fmFx.map((t) => h('span.tag.ready', t))) : h('span.tag.off', '없음')),
    OFF ? fmItemSec(T, fmItem) : h('div.fl-art-sec', h('h2.fl-sub', '아티팩트 강화'),
      fmArts.length ? fmArts.map((a) => h('div.fl-syn', h('b', a.name), h('span', F.artSpec(a)))) : h('span.tag.off', '없음'),
      T.amp.formation ? h('div.fl-syn', h('b', '효과 강화'), h('span.fl-up', `+${T.amp.formation}%`)) : null),
    OFF ? null : h('div.fl-art-sec', h('h2.fl-sub', '시너지'),
      T.synergies.length ? T.synergies.map((id) => { const s = F.synDef(id); return h('div.fl-syn', h('b', s?.name ?? id), h('span', (s?.specEffects ?? []).join(' · '))); }) : h('span.tag.off', '없음'),
      synFx.length ? h('div.fl-chipline', synFx.map((t) => h('span.tag.ready', t))) : null),
    cmp);
  ctx.root.append(h('div.screen.fl.fl-fmv', head('포메이션', back, subTabs(ctx, 'fm')),
    h('div.fl-art', h('section.pwin.fl-art-l', grid), info),
    h('div.fl-cmds', OFF ? [
      btn(fmSel && fmSel.id === fmItem ? '장착 중' : fmItem && fmSel ? '교체' : '장착', 'fmi-eq', () => fmSel && wear(fmSel.id), '.primary.center', { disabled: !fmSel || fmSel.id === fmItem }),
      btn('해제', 'fmi-un', () => wear(null), '.center', { disabled: !fmItem })] : null,
    btn('되돌리기', 'fm-undo', () => prev && (OFF ? wear(prev.item) : change(prev.fm)), '.center', { disabled: !prev }))));
  (ctx.root.querySelector(OFF ? '.fl-inv-row' : `[data-k="fm-${cur}"]`) ?? ctx.root.querySelector('[data-k="back"]')).dataset.first = '1';
  return { esc: back };
}

/** off(§13.26) 포메이션 아이템 칸: 아이템 이름·등급 + 태그 보너스표(formationTags[].bonus) × 등급 배율(grade.formation.tagPct) */
function fmItemSec(T, fmItem) {
  const d = fmItem ? F.artDef(fmItem) : null, g = F.grantOf(d), tg = g ? F.tagOfFm(g.key) : null;
  const pct = g ? F.catalog().grade?.formation?.tagPct?.[g.grade] : null;
  const bonus = F.statTexts(Object.fromEntries((tg?.bonus ?? []).map((b) => [b.stat, b.value])));
  return h('div.fl-art-sec', { 'data-k': 'fm-item-sec' }, h('h2.fl-sub', '포메이션 아이템'),
    d ? [h('div.fl-syn', h('b', F.artName(d)), gradeTag(g.grade), tg ? h('span', tg.name) : null),
      bonus.length ? h('div.fl-chipline', bonus.map((t) => h('span.tag.ready', t)), Number.isFinite(pct) ? h('span.fl-up.tabular', `× ${pct}%`) : null) : null]
      : h('span.tag.off', '없음'));
}

// ---------------- 소모품 ----------------
const needsPlayer = (d) => (d.effects ?? []).some((e) => (e.params?.target ?? e.proposed?.target) === 'player');
export function items(ctx) {
  const { S } = ctx, run = ctx.run(), T = ctx.team(), C = F.catalog();
  const back = () => ctx.close();
  const own = Object.entries(run.consumables).filter(([, n]) => n > 0);
  if (!own.some(([id]) => id === S.itemSel)) S.itemSel = own[0]?.[0] ?? null;
  if (!(S.itemP >= 0 && S.itemP < run.roster.length)) S.itemP = 0;
  const d = S.itemSel ? F.consDef(S.itemSel) : null, need = d ? needsPlayer(d) : false;
  const total = own.reduce((s, [, n]) => s + n, 0);
  const list = h('div.fl-inv', { 'data-sc': 'cons', role: 'group', 'aria-label': '소모품' }, own.length ? own.map(([id, n]) => {
    const c = F.consDef(id);
    if (!c) return null;
    return h('button.fl-inv-row', { type: 'button', 'data-k': 'c-' + id, 'aria-pressed': String(S.itemSel === id), 'aria-label': `${c.name} ${n}개`, onclick: () => { S.itemSel = id; ctx.paint(); } },
      icon(c, { n }), h('span.fl-inv-m', h('b', c.name), h('span.fl-inv-s', c.specText)), h('b.tabular', `×${n}`));
  }) : h('div.empty', '소모품이 없습니다'));
  const buffs = run.buffs.map((b) => h('span.tag.ready', (F.consDef(b.c)?.name ?? b.c) + (b.p !== null && b.p !== undefined && run.roster[b.p] ? ` · ${pname(run.roster[b.p].from)}` : '')));
  if (run.extraReward) buffs.push(h('span.tag.ready', `다음 보상 +${run.extraReward}`));
  if (run.extraRecruit) buffs.push(h('span.tag.ready', `다음 영입 +${run.extraRecruit}`));
  const prow = h('div.fl-prow' + (need ? '' : '.off'), { role: 'group', 'aria-label': '대상 선수' }, run.roster.map((r, i) => {
    const hp = hpOf(run, T, i);
    return h('button.fl-pcell', { type: 'button', 'data-k': 'ip-' + i, 'aria-pressed': String(need && S.itemP === i), disabled: !need, 'aria-label': `${pname(r.from)} HP ${hp.hp}/${hp.max}`, onclick: () => { S.itemP = i; ctx.paint(); } },
      pface(r.from), h('span.nm', pname(r.from)), hpBar(hp.hp, hp.max, hp.up));
  }));
  const use = btn(d ? (need ? `사용 · ${pname(run.roster[S.itemP].from)}` : '사용') : '사용', 'use', () => d && ctx.send('flame_use', need ? { c: d.id, p: S.itemP } : { c: d.id }), '.primary.center', { disabled: !d });
  ctx.root.append(h('div.screen.fl.fl-itemsv', head('소모품', back, chip('보유', `${total}/${C.economy?.consumables?.inventoryMax ?? 5}`)),
    h('div.fl-art', h('section.pwin.fl-art-l', list),
      h('section.pwin.fl-art-r', h('div.fl-art-sec', h('h2.fl-sub', '다음 경기 효과'), buffs.length ? h('div.fl-chipline', buffs) : h('span.tag.off', '없음')),
        h('div.fl-art-sec', h('h2.fl-sub', '대상'), prow))),
    h('div.fl-cmds', use)));
  (ctx.root.querySelector('.fl-inv-row') ?? ctx.root.querySelector('[data-k="back"]')).dataset.first = '1';
  return { esc: back };
}
