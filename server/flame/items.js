// 불꽃의 계승 소지품 규칙: 장비 인스턴스(장착·해제·자동 장착·강화·판매), 아티팩트 3슬롯, 필살기 슬롯, 소모품.
// 전부 도전 상태(run)를 직접 고치는 함수다. 거절은 FlameError(code)로 던지고, 던지기 전에는 run 을 고치지 않는다(거절된 요청이 상태를 바꾸지 않게).
// 능력치는 여기서 계산하지 않는다(stats.js 가 run 을 읽어 매번 다시 계산 -> 장비를 빼면 정확히 원복).
import { ferr } from './save.js';
import { pv, roundHalfUp, cloneOf } from './catalog.js';
import { upgradedStats, allowOf } from './stats.js';

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
export function addArtifact(cat, run, id) {
  if (!cat.artifacts.has(id) || run.artifactsOwned.includes(id)) ferr('FLAME_INVALID'); // 같은 아티팩트는 하나만(37 §3-C20)
  run.artifactsOwned.push(id);
  see(run, 'artifacts', id);
}

/**
 * 아티팩트 장착·해제(3슬롯). id = null 이면 그 슬롯을 비운다. slot 을 생략하면 빈 칸에 넣고, 빈 칸이 없으면 FLAME_FULL(4번째 거절).
 * 해금이 풀린 필살기는 슬롯에 남되 발동하지 않는다(엔진 allow 에서 빠진다). 다시 장착하면 그대로 살아난다
 */
export function setArtifact(cat, run, slot, id) {
  const n = cat.rules.team.artifactSlots;
  if (id === null || id === undefined) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= n) ferr('FLAME_INVALID');
    run.artifacts[slot] = null;
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
}

/** 선수의 원래 필살기 ID(해금 후보에서 빠진 ID·무작위 풀 선수는 null, 39 §3) */
export function baseSpecial(cat, data, from) {
  const id = data.specials.row[from.team]?.[from.idx];
  return Number.isInteger(id) && id >= 0 && !cat.excludedShots.has(id) ? id : null;
}
/** 로스터 한 칸의 원래 필살기: 영입 풀 클론은 풀의 sp(42 §3), 그 밖은 출신 선수의 ID */
export const ownSpecial = (cat, data, r) => cloneOf(cat, r)?.sp ?? baseSpecial(cat, data, r.from);

/** 필살기 슬롯 2칸 지정(D1: 발동은 슬롯 0 만, D3: 해금된 슛은 아무 선수나). 넣을 수 있는 것 = 지금 해금된 ID 또는 그 선수의 원래 ID */
export function setSpecial(cat, data, run, p, sp) {
  const r = player(run, p);
  if (!Array.isArray(sp) || sp.length !== cat.rules.team.specialSlotsPerPlayer) ferr('FLAME_INVALID');
  const ok = new Set(allowOf(cat, run.artifacts.filter(Boolean))), own = ownSpecial(cat, data, r);
  for (const id of sp) if (id !== null && !(Number.isInteger(id) && (ok.has(id) || id === own))) ferr('FLAME_LOCKED');
  if (sp[0] !== null && sp[0] === sp[1]) ferr('FLAME_INVALID');
  r.sp = [sp[0], sp[1]];
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
