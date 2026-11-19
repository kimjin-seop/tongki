// 불꽃의 계승 도전 중 관리 화면: 선수 관리·장비 관리(§12.5) / 팀 공용 아티팩트 + 필살기 슬롯(§12.6) / 포메이션(§12.7) / 소모품(§9).
// 능력치는 서버 계산 결과(flame_state.team.players[i]: steps[9]·delta·over·move)를 그대로 그린다. 장착·해제·강화는 요청만 보내고 응답 상태로 다시 그린다.
import { h } from '../../util.js';
import { FM_NAMES_KO, fmNameKo } from '../../game/formation.js';
import * as F from './store.js';
import { icon, emptyIcon, pface, pname, pteam, ownShotOf, sprite, hpBar, hpOf, statTable, head, chip, btn, learnTip } from './ui.js';
import { extraSpec } from './run.js';

const canUpgradeHere = (run) => run.node?.type === 'training' || run.node?.type === 'shop';
/** 누가 끼고 있는 장비인가(flame_state.run.items[].wearer = 라인업 번호, 아무도 안 끼면 -1) */
const isWorn = (it) => Number.isInteger(it?.wearer) && it.wearer >= 0;

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
    return h('button.fl-tm-p', { type: 'button', 'data-k': 'p-' + i, 'aria-pressed': String(S.selP === i),
      'aria-label': `${pname(x.from)} ${F.roleName(p.role)} HP ${hp.hp}/${hp.max} 장비 ${eqN}`, onclick: () => { S.selP = i; S.selInst = null; ctx.paint(); } },
      pface(x.from),
      h('span.fl-tm-pm', h('b.nm', pname(x.from), i === 0 ? h('span.fl-cap', '주장') : null), h('span.fl-tm-role', `${i < 4 ? '내야' : '외야'} · ${F.roleName(p.role)}`)),
      h('span.fl-tm-ps', hpBar(hp.hp, hp.max, hp.up),h('span.fl-tm-two.tabular', `공 ${p.final.s4} 방 ${p.final.s1} 장비 ${eqN}`)));
  }));

  // 가운데: 스프라이트 + 능력치(기본 / 장비 / 기타 / 최종 / 비교)
  let preview = null;
  if (sel && S.cmpOff !== true && sel.wearer !== S.selP) {
    const cur = worn(sel.slot)?.stats ?? {};
    preview = Object.fromEntries(F.STAT_KEYS.map((k) => [k, (sel.stats[k] ?? 0) - (cur[k] ?? 0)]));
  }
  const sp0 = r.sp?.[0] ?? null;
  const mid = h('section.pwin.fl-tm-mid', { 'aria-live': 'polite' },
    h('div.fl-tm-top', sprite(r.from),
      h('div.fl-tm-id', h('div.fl-cx-name', pname(r.from)), h('div.fl-cx-sub', pteam(r.from)),
        h('div.fl-cx-line', h('i', '필살기'), F.shotName(sp0), sp0 !== null && !T.allow.includes(sp0) ? h('button.tag.off.fl-lock', { type: 'button', 'data-k': 'sp-lock', 'aria-label': `미습득 ${F.learnText(sp0)}`, onclick: () => learnTip(sp0) }, '미습득') : null)),
      h('div.fl-tm-ord', btn('▲', 'ord-up', () => move(-1), '.small.center', { 'aria-label': '순서 앞으로', disabled: S.selP === 0 }),
        btn('▼', 'ord-dn', () => move(1), '.small.center', { 'aria-label': '순서 뒤로', disabled: S.selP === n - 1 }))),
    statTable(pl, preview));

  // 오른쪽: 슬롯 4칸 + 장비 목록
  const slots = h('div.fl-slots', { role: 'group', 'aria-label': '장비 슬롯' }, F.catalog().slots.map((slot) => {
    const it = worn(slot), d = it ? F.equipDef(it.id) : null;
    return h('button.fl-slot', { type: 'button', 'data-k': 'slot-' + slot, 'aria-pressed': String(!invMode && S.selSlot === slot), 'aria-label': `${F.SLOT_KO[slot]} ${d ? d.name : '비어 있음'}`,
      onclick: () => { S.selSlot = slot; S.selInst = it?.inst ?? null; ctx.paint(); } },
      d ? icon(d, { lv: it.lv }) : emptyIcon(), h('span.fl-slot-m', h('i', F.SLOT_KO[slot]), h('b', d ? d.name : '-')));
  }));
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
      h('div.fl-it-h', h('b', d.name + (sel.lv ? ` +${sel.lv}` : '')), h('span.fl-rar.r-' + d.rarity, F.rarityName(d.rarity)), h('span', F.SLOT_KO[d.slot])),
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
    head(invMode ? '장비 관리' : '선수 관리', back, chip('경기 포인트', String(run.points), '.pt')),
    h('div.fl-tm', h('section.pwin.fl-tm-left', list), mid, h('section.pwin.fl-tm-right', slots, inv, detail)),
    cmds));
  ctx.root.querySelector(`[data-k="p-${S.selP}"]`).dataset.first = '1';
  return { esc: back };
}

// ---------------- 팀 공용 아티팩트 + 필살기 슬롯 ----------------
export function artifact(ctx) {
  const { S } = ctx, run = ctx.run(), T = ctx.team();
  const back = () => ctx.close();
  const tab = S.artTab === 'sp' ? 'sp' : 'art';
  const tabs = h('div.fl-tabs', { role: 'group', 'aria-label': '보기' }, [['art', '아티팩트'], ['sp', '필살기 슬롯']].map(([k, label]) =>
    h('button.btn.small', { type: 'button', 'data-k': 'tab-' + k, 'aria-pressed': String(tab === k), onclick: () => { S.artTab = k; ctx.paint(); } }, label)));
  const allowChips = h('div.fl-chipline', T.allow.length ? F.shotNames(T.allow).map((t) => h('span.tag.ready', t)) : h('span.tag.off', '없음')); // 이름만(내부 번호 없음, 같은 이름은 한 번)
  let body, cmds;
  if (tab === 'art') {
    if (!(S.artSlot >= 0 && S.artSlot < run.artifacts.length)) S.artSlot = Math.max(0, run.artifacts.indexOf(null));
    if (S.artSel && !run.artifactsOwned.includes(S.artSel)) S.artSel = null;
    const selId = S.artSel ?? run.artifacts[S.artSlot] ?? null, d = selId ? F.artDef(selId) : null;
    const at = selId ? run.artifacts.indexOf(selId) : -1;
    const slots = h('div.fl-art-slots', { role: 'group', 'aria-label': '아티팩트 슬롯' }, run.artifacts.map((id, i) => {
      const a = id ? F.artDef(id) : null;
      return h('button.fl-slot.art', { type: 'button', 'data-k': 'as-' + i, 'aria-pressed': String(S.artSlot === i), 'aria-label': `슬롯 ${i + 1} ${a ? a.name : '비어 있음'}`,
        onclick: () => { S.artSlot = i; S.artSel = id ?? S.artSel; ctx.paint(); } },
        a ? icon(a, { big: true }) : emptyIcon(String(i + 1)), h('span.fl-slot-m', h('i', `슬롯 ${i + 1}`), h('b', a ? a.name : '-')));
    }));
    const tag = F.tagDef(T.tag);
    const fmArts = run.artifacts.filter(Boolean).map(F.artDef).filter((a) => a?.formationTag);
    const info = h('div.fl-art-info', { 'aria-live': 'polite' },
      h('div.fl-art-sec', h('h2.fl-sub', '장착 정보'), d ? [h('div.fl-art-d', icon(d), h('b', d.name), h('span.fl-card-k', F.CAT_KO[d.category] ?? '')), h('p.fl-card-s', d.specText)] : h('div.empty', '')),
      h('div.fl-art-sec', h('h2.fl-sub', '활성 필살기'), allowChips),
      h('div.fl-art-sec', h('h2.fl-sub', '시너지'), T.synergies.length ? T.synergies.map((id) => { const s = F.synDef(id); return h('div.fl-syn', h('b', s?.name ?? id), h('span', (s?.specEffects ?? []).join(' · '))); }) : h('span.tag.off', '없음')),
      h('div.fl-art-sec', h('h2.fl-sub', '포메이션 보너스'),
        h('div.fl-syn', h('b', `${fmNameKo(run.fm)} · ${tag?.name ?? ''}`), T.amp.formation ? h('span.fl-up', `강화 +${T.amp.formation}%`) : null),
        fmArts.map((a) => h('div.fl-syn' + (a.formationTag === T.tag ? '' : '.off'), h('b', a.name), h('span', a.specText)))),
      T.unsupported?.length ? h('div.fl-art-sec', h('h2.fl-sub', '미적용 효과'), h('div.fl-chipline', T.unsupported.map((u) => h('span.tag.off', F.artDef(u.split(':')[0])?.name ?? F.equipDef(u.split(':')[0])?.name ?? u)))) : null);
    const owned = h('div.fl-art-own', { 'data-sc': 'art', role: 'group', 'aria-label': '보유 아티팩트' }, run.artifactsOwned.length ? run.artifactsOwned.map((id) => {
      const a = F.artDef(id), on = run.artifacts.includes(id);
      if (!a) return null;
      return h('button.fl-inv-row', { type: 'button', 'data-k': 'ao-' + id, 'aria-pressed': String(selId === id), 'aria-label': `${a.name}${on ? ' 장착 중' : ''}`, onclick: () => { S.artSel = id; ctx.paint(); } },
        icon(a), h('span.fl-inv-m', h('b', a.name), h('span.fl-inv-s', a.specText)), on ? h('span.tag.ready', '장착') : null);
    }) : h('div.empty', '아티팩트가 없습니다'));
    const occupied = run.artifacts[S.artSlot];
    body = h('div.fl-art', h('section.pwin.fl-art-l', slots, owned), h('section.pwin.fl-art-r', info));
    cmds = h('div.fl-cmds',
      btn(occupied && occupied !== selId ? '교체' : '장착', 'a-eq', () => selId && ctx.send('flame_artifact', { id: selId, slot: S.artSlot }), '.primary.center', { disabled: !selId || at === S.artSlot }),
      btn('해제', 'a-un', () => ctx.send('flame_artifact', { id: null, slot: at >= 0 ? at : S.artSlot }), '.center', { disabled: !(at >= 0 || occupied) }));
  } else {
    const n = run.roster.length;
    if (!(S.spP >= 0 && S.spP < n)) S.spP = 0;
    if (S.spSlot !== 1) S.spSlot = 0;
    const r = run.roster[S.spP], own = ownShotOf(r.from), sp = [r.sp?.[0] ?? null, r.sp?.[1] ?? null];
    const opts = [...new Set([...(own !== null ? [own] : []), ...sp.filter((x) => x !== null), ...T.allow])];
    const set = (id) => {
      const next = sp.slice();
      if (id !== null && next[1 - S.spSlot] === id) next[1 - S.spSlot] = next[S.spSlot]; // 다른 칸에 있던 것이면 두 칸을 맞바꾼다
      next[S.spSlot] = id;
      ctx.send('flame_special', { p: S.spP, sp: next });
    };
    const prow = h('div.fl-prow', { role: 'group', 'aria-label': '선수' }, run.roster.map((x, i) =>
      h('button.fl-pcell', { type: 'button', 'data-k': 'sp-p-' + i, 'aria-pressed': String(S.spP === i), 'aria-label': `${pname(x.from)} ${F.shotName(x.sp?.[0] ?? null)}`, onclick: () => { S.spP = i; ctx.paint(); } },
        pface(x.from), h('span.nm', pname(x.from)), h('span.fl-sp-cur' + (x.sp?.[0] !== null && x.sp?.[0] !== undefined && T.allow.includes(x.sp[0]) ? '.on' : ''), F.shotName(x.sp?.[0] ?? null)))));
    // 슬롯 이름도 선택지와 같은 이름표를 쓴다(같은 이름의 슛이 둘이면 둘째에 순번이 붙는다: 불꽃슛 · 불꽃슛 2. 내부 ID 는 보이지 않는다)
    const optLabels = F.shotLabels(opts), spName = (id) => (id === null ? F.shotName(null) : optLabels[opts.indexOf(id)]);
    const slotB = (i) => h('button.fl-slot', { type: 'button', 'data-k': 'sp-s-' + i, 'aria-pressed': String(S.spSlot === i), 'aria-label': `${i ? '예비' : '주'} 슬롯 ${spName(sp[i])}`, onclick: () => { S.spSlot = i; if (sp[i] !== null && !T.allow.includes(sp[i])) learnTip(sp[i]); ctx.paint(); } },
      h('span.fl-slot-m', h('i', i ? '예비' : '주 슬롯'), h('b', spName(sp[i]))), sp[i] !== null && !T.allow.includes(sp[i]) ? h('span.tag.off', '미습득') : sp[i] !== null && i === 0 ? h('span.tag.ready', '발동') : null);
    body = h('div.fl-art', h('section.pwin.fl-art-l', prow, h('div.fl-sp-slots', slotB(0), slotB(1))),
      h('section.pwin.fl-art-r', h('h2.fl-sub', '활성 필살기'), allowChips,
        h('h2.fl-sub', '선택'), h('div.fl-sp-opts', { 'data-sc': 'sp', role: 'group', 'aria-label': '필살기' },
          opts.map((id, i) => h('button.btn.small' + (T.allow.includes(id) ? '' : '.dim'), { type: 'button', 'data-k': 'sp-o-' + id, 'aria-pressed': String(sp[S.spSlot] === id), onclick: () => { if (!T.allow.includes(id)) learnTip(id); set(id); } }, optLabels[i])),
          h('button.btn.small', { type: 'button', 'data-k': 'sp-o-none', 'aria-pressed': String(sp[S.spSlot] === null), onclick: () => set(null) }, '비움'))));
    cmds = h('div.fl-cmds', btn('맞바꾸기', 'sp-swap', () => ctx.send('flame_special', { p: S.spP, sp: [sp[1], sp[0]] }), '.center', { disabled: sp[0] === null && sp[1] === null }));
  }
  ctx.root.append(h('div.screen.fl.fl-artv', head('아티팩트', back, tabs), body, cmds));
  (ctx.root.querySelector('.fl-inv-row, .fl-pcell') ?? ctx.root.querySelector('[data-k="back"]')).dataset.first = '1';
  return { esc: back };
}

// ---------------- 포메이션 ----------------
export function formation(ctx) {
  const { S } = ctx, run = ctx.run(), T = ctx.team();
  const back = () => ctx.close();
  const tag = F.tagDef(T.tag);
  // 변경 전 상태를 들고 있다가(요청을 보낼 때) 응답 뒤 선수별 최종 능력치를 견준다
  const prev = S.fmPrev && S.fmPrev.runId === run.id && S.fmPrev.fm !== run.fm ? S.fmPrev : null;
  const change = (fm) => {
    if (fm === run.fm) return;
    const snap = { runId: run.id, fm: run.fm, finals: T.players.map((p) => ({ ...p.final })) };
    if (ctx.send('flame_formation', { fm })) S.fmPrev = snap;
  };
  const grid = h('div.fl-fm-grid', { role: 'group', 'aria-label': '포메이션' }, FM_NAMES_KO.map((nm, i) => {
    const t = F.tagOfFm(i);
    return h('button.fl-fm-cell.g-' + (t?.id ?? 'none'), { type: 'button', 'data-k': 'fm-' + i, 'aria-pressed': String(run.fm === i), 'aria-label': `${nm} ${t?.name ?? ''}`, onclick: () => change(i) },
      h('b', nm), h('span.fl-fm-tag', t?.name ?? ''));
  }));
  const sumOf = (id) => {
    const tot = {};
    for (const p of T.players) for (const [k, v] of Object.entries(p.steps.find((s) => s.id === id)?.add ?? {})) tot[k] = Math.max(tot[k] ?? 0, v);
    return F.statTexts(tot);
  };
  const fmArts = run.artifacts.filter(Boolean).map(F.artDef).filter((a) => a?.formationTag === T.tag);
  const fmFx = sumOf('formation'), synFx = sumOf('synergy');
  let cmp = null;
  if (prev) {
    const rows = [];
    run.roster.forEach((r, i) => {
      const ch = F.STAT_KEYS.filter((k) => prev.finals[i]?.[k] !== T.players[i].final[k]);
      if (ch.length) rows.push(h('div.fl-fm-cmp-row', pface(r.from), h('span.nm', pname(r.from)),
        h('span.fl-fm-cmp-v', ch.map((k) => { const a = prev.finals[i][k], b = T.players[i].final[k]; return h('span.tabular' + (b > a ? '.up' : '.down'), `${F.statName(k)} ${a} → ${b}`); }))));
    });
    cmp = h('div.fl-art-sec', h('h2.fl-sub', `${fmNameKo(prev.fm)} → ${fmNameKo(run.fm)}`), rows.length ? rows : h('span.fl-warn', '변화 없음'));
  }
  const info = h('section.pwin.fl-art-r', { 'aria-live': 'polite' },
    h('div.fl-art-sec', h('h2.fl-sub', '현재 포메이션'), h('div.fl-fm-cur', h('b', fmNameKo(run.fm)), h('span.tag.host', tag?.name ?? ''))),
    h('div.fl-art-sec', h('h2.fl-sub', '기본 효과'), fmFx.length ? h('div.fl-chipline', fmFx.map((t) => h('span.tag.ready', t))) : h('span.tag.off', '없음')),
    h('div.fl-art-sec', h('h2.fl-sub', '아티팩트 강화'),
      fmArts.length ? fmArts.map((a) => h('div.fl-syn', h('b', a.name), h('span', a.specText))) : h('span.tag.off', '없음'),
      T.amp.formation ? h('div.fl-syn', h('b', '효과 강화'), h('span.fl-up', `+${T.amp.formation}%`)) : null),
    h('div.fl-art-sec', h('h2.fl-sub', '시너지'),
      T.synergies.length ? T.synergies.map((id) => { const s = F.synDef(id); return h('div.fl-syn', h('b', s?.name ?? id), h('span', (s?.specEffects ?? []).join(' · '))); }) : h('span.tag.off', '없음'),
      synFx.length ? h('div.fl-chipline', synFx.map((t) => h('span.tag.ready', t))) : null),
    cmp);
  ctx.root.append(h('div.screen.fl.fl-fmv', head('포메이션', back),
    h('div.fl-art', h('section.pwin.fl-art-l', grid), info),
    h('div.fl-cmds', btn('되돌리기', 'fm-undo', () => prev && change(prev.fm), '.center', { disabled: !prev }))));
  ctx.root.querySelector(`[data-k="fm-${run.fm}"]`).dataset.first = '1';
  return { esc: back };
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
