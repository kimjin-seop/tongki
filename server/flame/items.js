// 불꽃의 계승 소지품 규칙: 장비 인스턴스(장착·해제·자동 장착·강화·판매), 아티팩트 3슬롯, 필살기 슬롯, 소모품.
// 전부 도전 상태(run)를 직접 고치는 함수다. 거절은 FlameError(code)로 던지고, 던지기 전에는 run 을 고치지 않는다(거절된 요청이 상태를 바꾸지 않게).
// 능력치는 여기서 계산하지 않는다(stats.js 가 run 을 읽어 매번 다시 계산 -> 장비를 빼면 정확히 원복).
import { ferr } from './save.js';
import { pv, roundHalfUp, grantedModel, baseSpecial, ownSpecial, gradeOn, grantOf, teamArtifactsOn } from './catalog.js';
import { upgradedStats, allowOf, cleanSpecials, grantShotOf, spItemShot } from './stats.js';

export { baseSpecial, ownSpecial }; // 선수의 원작 필살기·고유 슛(정의는 catalog.js. 종전 호출자용으로 여기서도 내보낸다)

const player = (run, p) => (Number.isInteger(p) && p >= 0 && p < run.roster.length ? run.roster[p] : ferr('FLAME_INVALID'));
const instOf = (run, inst) => run.items.find((it) => it.inst === inst) ?? ferr('FLAME_INVALID');
/** 그 인스턴스를 낀 선수 번호(없으면 -1) */
export const wearerOf = (cat, run, inst) => run.roster.findIndex((r) => cat.slots.some((s) => r.equip[s] === inst));

function see(run, kind, id) { if (!run.seen[kind].includes(id)) run.seen[kind].push(id); }

/** 장비 보유 상한(엔드리스 D24, endless.json items.max)에 닿았는가. 엔드리스가 꺼져 있으면 상한이 없다(종전) */
export const itemsFull = (cat, run) => !!cat.endless && run.items.length >= cat.endless.itemMax;

/**
 * 장비 획득: 새 인스턴스(같은 아이템 ID 를 여러 개 가질 수 있고 각각 따로 강화·장착된다).
 * 보유 상한에 닿아 있으면 인스턴스를 만들지 않고 그 자리에서 판매가만큼 경기 포인트로 바꾼다(반환 {sold: 포인트, id}). 가진 장비는 건드리지 않고 진행도 막지 않는다. 도감에는 본 것으로 남는다
 */
export function addItem(cat, run, id) {
  if (!cat.items.has(id)) ferr('FLAME_INVALID');
  if (itemsFull(cat, run)) { const sold = cat.sellPrice(id); run.points += sold; see(run, 'items', id); return { sold, id }; }
  const it = { inst: run.nextInst++, id, lv: 0 };
  run.items.push(it);
  run.stat.bestRarity = Math.max(run.stat.bestRarity, cat.rarityRank[cat.items.get(id).rarity]);
  see(run, 'items', id);
  return it;
}

/** 장착. 슬롯은 아이템 분류로 정해진다. 다른 선수가 낀 인스턴스는 거절(기획 §4.1 "같은 장비를 여러 선수가 동시에 착용할 수 없다") — 먼저 해제해야 한다 */
export function equip(cat, run, p, inst) {
  const r = player(run, p), it = instOf(run, inst), slot = cat.items.get(it.id).slot;
  const w = wearerOf(cat, run, inst);
  if (w >= 0 && w !== p) ferr('FLAME_EQUIPPED');
  r.equip[slot] = inst; // 그 슬롯에 있던 장비는 인벤토리로 돌아간다(인스턴스는 run.items 에 그대로 있다)
}

export function unequip(cat, run, p, slot) {
  const r = player(run, p);
  if (!cat.slots.includes(slot)) ferr('FLAME_INVALID');
  r.equip[slot] = null;
}

/** 자동 장착 점수(표시·자동 장착 전용, [자작]): 등급 + 강화 반영 능력치 합(음수는 감점) + 특수효과 수 */
function score(cat, it) {
  const def = cat.items.get(it.id);
  return cat.rarityRank[def.rarity] * 4 + Object.values(upgradedStats(cat, it.id, it.lv)).reduce((s, v) => s + (v >= 10 ? Math.ceil(v / 5) : v), 0) + def.effects.length * 3;
}

/** 자동 장착: p 를 주면 그 선수만, 없으면 라인업 순서대로. 아무도 끼지 않은 장비 중 지금 것보다 점수가 높은 것으로 바꾼다(남이 낀 것은 뺏지 않는다) */
export function autoEquip(cat, run, p = null) {
  const who = p === null || p === undefined ? run.roster.map((_, i) => i) : [(player(run, p), p)];
  let changed = 0;
  for (const i of who) {
    for (const slot of cat.slots) {
      const free = run.items.filter((it) => cat.items.get(it.id).slot === slot && wearerOf(cat, run, it.inst) < 0).sort((a, b) => score(cat, b) - score(cat, a) || a.inst - b.inst)[0];
      const cur = run.items.find((it) => it.inst === run.roster[i].equip[slot]);
      if (free && (!cur || score(cat, free) > score(cat, cur))) { run.roster[i].equip[slot] = free.inst; changed++; }
    }
  }
  return changed;
}

/** 강화 비용(다음 단계 1회분, D11 단계별 지불). 특훈 효율(PB06)은 % 할인, half-up */
export function upgradeCost(cat, perm, lv) {
  const u = cat.perm.get('PB06'), off = Math.min(90, (perm?.PB06 ?? 0) * u.effect.perLevel);
  return roundHalfUp(cat.upgrade.costs[lv] * (100 - off), 100);
}

/** 강화 +1(최대 +3, 실패 없음). 경기 포인트로 지불. 가능한 장소(특훈장·상점)는 호출자(nodes.js)가 본다 */
export function upgrade(cat, run, perm, inst) {
  const it = instOf(run, inst);
  if (!cat.items.get(it.id).upgradeable || it.lv >= cat.upgrade.maxLevel) ferr('FLAME_MAX');
  const cost = upgradeCost(cat, perm, it.lv);
  if (run.points < cost) ferr('FLAME_NO_FUNDS');
  run.points -= cost; it.lv++;
  return cost;
}

/** 판매: 아무도 끼지 않은 장비만. 판매가는 items_equipment.json proposed.sellPrice(강화 비용은 돌려주지 않는다) */
export function sell(cat, run, inst) {
  const it = instOf(run, inst);
  if (wearerOf(cat, run, inst) >= 0) ferr('FLAME_EQUIPPED');
  run.items.splice(run.items.indexOf(it), 1);
  run.surviveUsed = run.surviveUsed.filter((i) => i !== inst); // 표시용 목록만 지운다. 도전 단위 횟수(run.surviveCount)는 팔아도 돌아오지 않는다
  const price = cat.sellPrice(it.id);
  run.points += price;
  return price;
}

// ---------- 아티팩트 ----------
/**
 * 등급 아이템(D39): 같은 슛·같은 포메이션은 가장 높은 등급 하나만 가진다. 이미 같거나 높은 등급을 갖고 있으면 FLAME_INVALID(후보를 만들 때 이미 뺀다. 안전망),
 * 더 높은 등급을 얻으면 낮은 것은 그 자리에서 판매가(decisions.json grade.price.sell)만큼 경기 포인트로 바뀌고, 끼고 있었으면 같은 칸에 새 등급이 들어간다(슛·패턴이 같아 필살기 슬롯·포메이션은 그대로다).
 * @returns {{id:string, points:number}|null} 자동 판매된 낮은 등급(없으면 null)
 */
export function addArtifact(cat, run, id) {
  if (!cat.artifacts.has(id) || run.artifactsOwned.includes(id)) ferr('FLAME_INVALID'); // 같은 아티팩트는 하나만(37 §3-C20)
  const g = grantOf(cat, id), teamOn = teamArtifactsOn(cat);
  if (!teamOn && !g) ferr('FLAME_INVALID'); // off(D58): 손으로 쓴 아티팩트(A01~A30)는 받지 않는다(보상·상점·이벤트에도 나오지 않는다. 안전망)
  let sold = null;
  if (g) {
    const prev = run.artifactsOwned.find((a) => { const o = grantOf(cat, a); return !!o && o.kind === g.kind && o.key === g.key; });
    if (prev) {
      const o = grantOf(cat, prev);
      if (o.rank >= g.rank) ferr('FLAME_INVALID');
      run.artifactsOwned.splice(run.artifactsOwned.indexOf(prev), 1);
      const at = run.artifacts.indexOf(prev);
      if (at >= 0) run.artifacts[at] = id;
      if (!teamOn) { for (const r of run.roster) if (r.spItem === prev) r.spItem = id; if (run.fmItem === prev) run.fmItem = id; } // off: 낀 선수(팀 칸)에게 새 등급이 이어진다(슛·패턴이 같아 슬롯·포메이션은 그대로)
      sold = { id: prev, points: cat.grade.price.sell[o.grade] ?? 0 };
      run.points += sold.points;
    }
  }
  run.artifactsOwned.push(id);
  see(run, 'artifacts', id);
  return sold;
}

/** 지금은 받을 수 없는 아티팩트인가: 이미 가진 id, 또는 같은 종류를 같거나 높은 등급으로 가진 등급 아이템(addArtifact 가 FLAME_INVALID 로 거절하는 것과 같은 조건) */
export function staleArtifact(cat, run, id) {
  if (!cat.artifacts.has(id) || run.artifactsOwned.includes(id)) return true;
  const g = grantOf(cat, id);
  return !!g && run.artifactsOwned.some((a) => { const o = grantOf(cat, a); return !!o && o.kind === g.kind && o.key === g.key && o.rank >= g.rank; });
}

/**
 * 받을 수 없게 된 선택지 자동 무효(D48, 정검수 L3): 아티팩트를 얻은 뒤, 아직 풀지 않은 아티팩트 선택(run.pending)에서 지금은 받을 수 없는 칸(staleArtifact)을 뺀다.
 * 선택지가 하나도 남지 않은 선택은 통째로 뺀다(진행이 막히지 않게). 다른 종류의 선택(장비·영입·휴식·이벤트)은 건드리지 않는다
 * @returns {string[]} 빠진 아이템 id
 */
export function pruneArtifactChoices(cat, run) {
  const gone = [];
  for (const p of run.pending) {
    if (p.kind !== 'artifact') continue;
    const keep = p.choices.filter((id) => !staleArtifact(cat, run, id));
    gone.push(...p.choices.filter((id) => !keep.includes(id)));
    p.choices = keep;
  }
  if (gone.length) run.pending = run.pending.filter((p) => p.kind !== 'artifact' || p.choices.length > 0);
  return gone;
}

/**
 * 아티팩트 구성이 바뀐 뒤 포메이션 맞추기(등급제 D42 전용). before = 바뀌기 전의 run.artifacts.
 * 새로 낀 포메이션 아이템이 있으면 그 패턴으로 바꾸고, 지금 패턴을 주는 아이템이 빠졌으면 기본 포메이션으로 돌아간다(기본 포메이션은 아이템 없이 쓸 수 있다)
 */
export function syncFormation(cat, run, before) {
  if (!gradeOn(cat)) return;
  const fmOf = (a) => (a ? cat.artifacts.get(a)?.grant?.formation : undefined), def = cat.cfg.formation.default;
  for (const a of run.artifacts) if (a && !before.includes(a) && fmOf(a) !== undefined) run.fm = fmOf(a);
  if (run.fm !== def && !run.artifacts.some((a) => fmOf(a) === run.fm)) run.fm = def;
}

/**
 * 아티팩트 장착·해제(3슬롯). id = null 이면 그 슬롯을 비운다. slot 을 생략하면 빈 칸에 넣고, 빈 칸이 없으면 FLAME_FULL(4번째 거절).
 * 종전(legacy): 해금이 풀린 필살기는 슬롯에 남되 발동하지 않는다(엔진 allow 에서 빠진다). 다시 장착하면 그대로 살아난다.
 * 부여 구조(D38, data 를 넘겼을 때): 바뀐 뒤 필살기 슬롯을 맞춘다(syncSpecials) — 뺀 아티팩트에서 온 슛은 슬롯에서 비워지고, 새로 낀 아티팩트의 대표 슛이 빈 주 슬롯에 들어간다.
 * @param {object} [data] 엔진 데이터(원작 선수의 고유 슛을 읽는다). 생략하면 슬롯을 맞추지 않는다(경기 조립·저장 읽기가 다시 정리하므로 발동 규칙은 같다)
 */
export function setArtifact(cat, run, slot, id, data) {
  if (!teamArtifactsOn(cat)) ferr('FLAME_INVALID'); // off(D58): 공용 아티팩트 칸을 쓰지 않는다 -> flame_sp_item·flame_fm_item
  const n = cat.rules.team.artifactSlots, before = run.artifacts.slice();
  if (id === null || id === undefined) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= n) ferr('FLAME_INVALID');
    run.artifacts[slot] = null;
    syncSpecials(cat, data, run, before); syncFormation(cat, run, before);
    return;
  }
  if (!run.artifactsOwned.includes(id)) ferr('FLAME_INVALID');
  const at = run.artifacts.indexOf(id);
  if (slot === null || slot === undefined) {
    if (at >= 0) return; // 이미 장착
    slot = run.artifacts.indexOf(null);
    if (slot < 0) ferr('FLAME_FULL');
  } else if (!Number.isInteger(slot) || slot < 0 || slot >= n) ferr('FLAME_INVALID');
  if (at >= 0 && at !== slot) run.artifacts[at] = run.artifacts[slot]; // 다른 칸에 있던 것이면 두 칸을 맞바꾼다(같은 아티팩트 중복 장착 없음)
  run.artifacts[slot] = id;
  syncSpecials(cat, data, run, before); syncFormation(cat, run, before);
}

/**
 * 아티팩트 구성이 바뀐 뒤 필살기 슬롯 맞추기(부여 구조 D38 전용. 종전·data 없음이면 아무것도 하지 않는다). before = 바뀌기 전의 run.artifacts.
 *  1) 선수별 발동 가능 집합(낀 아티팩트가 부여한 슛 + 원작 선수의 고유 슛) 밖의 ID 를 두 슬롯에서 비운다. 원작 선수의 주 슬롯이 비면 고유 슛으로 돌아간다.
 *  2) 주 슬롯이 비고 예비 슬롯에 쓸 수 있는 슛이 남았으면 주 슬롯으로 올린다.
 *  3) 새로 낀 아티팩트의 대표 슛을 아직 주 슬롯이 빈 선수(= 필살기 없는 클론·불씨)에게 넣는다. 이미 슛이 있는 선수는 건드리지 않는다
 */
export function syncSpecials(cat, data, run, before) {
  if (!grantedModel(cat) || !data) return;
  cleanSpecials(cat, data, run.roster, run.artifacts);
  for (const r of run.roster) if (r.sp[0] === null && r.sp[1] !== null) r.sp = [r.sp[1], null];
  for (const a of run.artifacts) {
    const g = a && !before.includes(a) ? grantShotOf(cat, a) : null;
    if (g !== null) for (const r of run.roster) if (r.sp[0] === null) r.sp = [g, null];
  }
}

/**
 * 필살기 슬롯 2칸 지정(D1: 발동은 슬롯 0 만, D3: 아티팩트 슛은 아무 선수나). 넣을 수 있는 것 = 지금 낀 아티팩트의 슛 또는 그 선수의 고유 슛(ownSpecial). 그 밖은 FLAME_LOCKED.
 * 부여 구조(D38): 고유 슛은 원작 선수 본인만 가진다 -> 다른 선수의 고유 슛(아티팩트로 부여되지 않은 것)·불씨와 클론의 옛 필살기는 FLAME_LOCKED 로 거절된다.
 *   원작 선수의 주 슬롯은 비울 수 없다: 비워 보내면 고유 슛으로 돌아간다(저장 읽기와 같은 정리. 클론·불씨는 [null, null] = 「필살기 없음」으로 둘 수 있다)
 */
export function setSpecial(cat, data, run, p, sp) {
  const r = player(run, p);
  if (!Array.isArray(sp) || sp.length !== cat.rules.team.specialSlotsPerPlayer) ferr('FLAME_INVALID');
  const item = spItemShot(cat, r), ok = new Set(teamArtifactsOn(cat) ? allowOf(cat, run.artifacts.filter(Boolean)) : item === null ? [] : [item]), own = ownSpecial(cat, data, r); // off(D58): 그 선수가 낀 아이템의 슛만(남이 낀 아이템의 슛은 FLAME_LOCKED)
  for (const id of sp) if (id !== null && !(Number.isInteger(id) && (ok.has(id) || id === own))) ferr('FLAME_LOCKED');
  if (sp[0] !== null && sp[0] === sp[1]) ferr('FLAME_INVALID');
  r.sp = [sp[0], sp[1]];
  if (grantedModel(cat) && own !== null && r.sp[0] === null) r.sp = [own, r.sp[1] === own ? null : r.sp[1]];
}

// ---------- 선수별 필살기 아이템·팀 포메이션 아이템(off, analysis/39 D58~D63, PROTOCOL §13.26) ----------
/** 그 필살슛 아이템을 낀 선수 번호(없으면 -1) */
export const spWearerOf = (run, id) => run.roster.findIndex((r) => r.spItem === id);

/**
 * 선수 p 의 필살기 아이템 칸 장착·해제(flame_sp_item). id = null 이면 뺀다.
 * 장착: 보유한 필살슛 아이템만(그 밖 FLAME_INVALID), 다른 선수가 낀 아이템은 FLAME_EQUIPPED(먼저 빼야 한다, 장비와 같은 규칙). 그 선수의 슬롯 = [아이템의 슛, 원작 선수면 고유 슛(같은 슛이면 null)].
 * 해제: 아이템의 슛이 그 선수 슬롯에서 빠진다(원작 선수는 고유 슛으로 돌아가고 불씨·클론은 「필살기 없음」). team 모델에서는 FLAME_INVALID
 */
export function setSpItem(cat, data, run, p, id) {
  if (teamArtifactsOn(cat)) ferr('FLAME_INVALID');
  const r = player(run, p);
  if (id === null || id === undefined) { delete r.spItem; cleanSpecials(cat, data, [r], []); return; }
  if (typeof id !== 'string' || !run.artifactsOwned.includes(id) || grantOf(cat, id)?.kind !== 'shot') ferr('FLAME_INVALID');
  const w = spWearerOf(run, id);
  if (w >= 0 && w !== p) ferr('FLAME_EQUIPPED');
  const shot = cat.artifacts.get(id).grant.shot, own = ownSpecial(cat, data, r);
  r.spItem = id; r.sp = [shot, own !== null && own !== shot ? own : null];
}

/** 팀 포메이션 아이템 칸 장착·해제(flame_fm_item). 장착 = 그 패턴으로 바꾼다, 해제(null) = 기본 포메이션으로. 보유한 포메이션 아이템만(그 밖 FLAME_INVALID). team 모델에서는 FLAME_INVALID */
export function setFmItem(cat, run, id) {
  if (teamArtifactsOn(cat)) ferr('FLAME_INVALID');
  if (id === null || id === undefined) { run.fmItem = null; run.fm = cat.cfg.formation.default; return; }
  if (typeof id !== 'string' || !run.artifactsOwned.includes(id) || grantOf(cat, id)?.kind !== 'formation') ferr('FLAME_INVALID');
  run.fmItem = id; run.fm = cat.artifacts.get(id).grant.formation;
}

// ---------- 소모품 ----------
export const consumableCount = (run) => Object.values(run.consumables).reduce((s, n) => s + n, 0);
/** 보유 상한 5개·종류당 3개(기획 §9.1) 안에서 더 가질 수 있는가 */
export function canHold(cat, run, id) {
  const L = cat.rules.consumables;
  return consumableCount(run) < L.inventoryMax && (run.consumables[id] ?? 0) < Math.min(L.stackMaxPerKind, cat.consumables.get(id).stackMax);
}
export function addConsumable(cat, run, id) {
  if (!cat.consumables.has(id)) ferr('FLAME_INVALID');
  if (!canHold(cat, run, id)) ferr('FLAME_FULL');
  run.consumables[id] = (run.consumables[id] ?? 0) + 1;
  see(run, 'consumables', id);
}

/**
 * 소모품 사용(경기 밖에서만, 호출자가 경기 중인지 본다). maxHp = 선수별 현재 최대 HP(stats.js 결과).
 * heal: 선수 1명 즉시 회복 / nextMatch·nextBossMatch: 다음 경기 효과로 걸어 둔다(경기가 끝나면 run.js 가 지운다) / C18·C19: 다음 보상·다음 영입에 걸린다.
 * 중복 규칙(§9.2 "중복 적용 규칙과 최대 상한", [자작]): 같은 소모품을 같은 대상에 두 번 걸 수 없다(FLAME_DUP). C18·C19 는 utilityStackMax 까지
 */
export function useConsumable(cat, run, id, p, maxHp) {
  const def = cat.consumables.get(id);
  if (!def || !(run.consumables[id] > 0)) ferr('FLAME_INVALID');
  const tgt = (e) => pv(e, 'target');
  const needP = def.effects.some((e) => tgt(e) === 'player');
  const r = needP ? player(run, p) : null, C = cat.cfg.consumables;
  if (def.kind === 'heal') {
    if (r.hp >= maxHp[p]) ferr('FLAME_NO_EFFECT');
    r.hp = Math.min(maxHp[p], r.hp + def.effects.reduce((s, e) => s + (e.type === 'heal_hp' ? pv(e, 'value') : 0), 0));
  } else if (def.kind === 'nextMatch') {
    const bp = needP ? p : null;
    if (!C.sameBuffStacks && run.buffs.some((b) => b.c === id && b.p === bp)) ferr('FLAME_DUP');
    run.buffs.push({ c: id, p: bp });
  } else {
    const key = def.duration === 'nextReward' ? 'extraReward' : def.duration === 'nextRecruit' ? 'extraRecruit' : ferr('FLAME_INVALID');
    if (run[key] >= C.utilityStackMax) ferr('FLAME_DUP');
    run[key] += def.effects.reduce((s, e) => s + (pv(e, 'count') ?? 0), 0);
  }
  if (--run.consumables[id] <= 0) delete run.consumables[id];
}

/** 경기가 끝난 뒤 '다음 경기' 효과 제거. 보스전 한정 효과(C20)는 보스 경기를 치른 뒤에만 지운다 */
export function expireBuffs(cat, run, nodeType) {
  run.buffs = run.buffs.filter((b) => cat.consumables.get(b.c).duration === 'nextBossMatch' && nodeType !== 'boss');
}
