// 불꽃의 계승 능력치 파이프라인(기획 §14.1 9단계, 순수 함수 — 입력을 고치지 않고 저장·난수·시계를 쓰지 않는다).
//   1 기본 -> 2 영구 성장 -> 3 특훈 -> 4 장비(+강화) -> 5 아티팩트 -> 6 포메이션 -> 7 시너지 -> 8 소모품 -> 9 상한/하한
// 매번 1단계(원본 선수 데이터)부터 다시 더하므로 장비를 빼면 그 장비의 증감이 정확히 사라진다(§14.2 "제거 시 원래 능력치로 복구").
// 반올림은 catalog.roundHalfUp 하나만 쓴다(강화 보너스, 포메이션·시너지 강화 배율). 능력치는 전부 정수다.
// 경기 중 조건을 봐야 하는 효과(캐치 후 첫 투구 등)는 능력치가 아니라 fx(엔진 flame 옵션 roster[i].fx, PROTOCOL §12.1)로 모은다.
import { STAT_KEYS, ENGINE_STAT, pv, roundHalfUp, cloneOf, grantedModel, ownSpecial, playerKind, gradeOn, teamArtifactsOn } from './catalog.js';

const zero = () => Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
const newFx = () => ({ catchPow: 0, passSpd: 0, chargePow: 0, airPow: 0, lowHpDef: 0, survive: 0, spPow: 0, spAirPow: 0, spPct: 0, spSpd: 0, famPow: {}, famPct: {} });
const STEP_IDS = ['base', 'permanent', 'training', 'equipment', 'artifact', 'formation', 'synergy', 'consumable', 'clamp'];

/** 강화 보너스(D11): 양수 능력치만 base x pct% half-up, 최소 보장은 economy.json upgrade.rounding.minBonusWhenPositive(0). 음수·0 은 그대로 */
export function upgradeBonus(cat, base, lv) {
  if (!(base > 0) || !lv) return 0;
  const U = cat.upgrade;
  return Math.max(U.rounding.minBonusWhenPositive, roundHalfUp(base * U.bonusPct[lv - 1], 100));
}

/** 강화 레벨 lv 인 장비의 능력치 증감 {s0..r3 일부} */
export function upgradedStats(cat, itemId, lv = 0) {
  const out = {};
  for (const [k, v] of Object.entries(cat.items.get(itemId).stats)) out[k] = v + upgradeBonus(cat, v, lv);
  return out;
}

/** 강화 미리보기(화면 표시용): 능력치마다 지금 값·다음 단계 값·변화 없음 여부. 최대 단계면 next = null */
export function upgradePreview(cat, itemId, lv = 0) {
  const U = cat.upgrade, max = lv >= U.maxLevel, now = upgradedStats(cat, itemId, lv), nx = max ? null : upgradedStats(cat, itemId, lv + 1);
  const stats = Object.keys(now).map((k) => ({ stat: k, base: cat.items.get(itemId).stats[k], now: now[k], next: nx ? nx[k] : null, noChange: !!nx && nx[k] === now[k] }));
  return { lv, maxLevel: U.maxLevel, cost: max ? null : U.costs[lv], stats, noChange: !max && stats.every((s) => s.noChange), noChangeLabel: U.rounding.noChangeLabel };
}

/** 장착한 아티팩트가 부여하는(종전 용어: 해금하는) 필살기 ID(오름차순). 강위력(A06)은 불꽃·도끼를 열지 않는다(39 A2), 표값 255 ID 는 없다(D2) */
export function allowOf(cat, artifacts) {
  const s = new Set();
  for (const id of artifacts) {
    const d = cat.artifacts.get(id);
    if (d?.grant?.shot !== undefined) s.add(d.grant.shot); // 등급 필살슛 아이템(SP<슛>-<등급>, D39): 그 슛 하나
    for (const f of d?.unlockShotFamilies ?? []) for (const sh of cat.unlockIds[f]) s.add(sh);
  }
  return [...s].sort((a, b) => a - b);
}

// ---------- 선수별 필살기 아이템(analysis/39 D58~D63, decisions.json artifact.model = 'off') ----------
// 팀 공용 아티팩트를 끈 구조: 필살슛 아이템(SP<슛>-<등급>)은 선수 한 명이 roster[i].spItem 1칸에 끼고 그 선수에게만 슛·등급 가산이 붙는다. 포메이션 아이템은 팀 1칸 run.fmItem.
// 엔진에 넘기는 allow 는 팀 공용 칸이라 전 선수의 아이템 슛 + 원작 선수 고유 슛의 합이고, 선수마다 자기 집합 밖의 슬롯 값을 비워 넘긴다(종전 D38 과 같은 방식) -> 남이 낀 아이템의 슛은 나가지 않는다.

/** 그 선수가 낀 필살슛 아이템의 슛 ID(아이템이 없거나 필살슛 아이템이 아니면 null). 팀 공용 아티팩트(team)에서는 언제나 null */
export function spItemShot(cat, r) {
  if (teamArtifactsOn(cat) || typeof r?.spItem !== 'string') return null;
  const g = cat.artifacts.get(r.spItem)?.grant?.shot;
  return g === undefined ? null : g;
}

/** 팀 공용으로 낀 아이템 목록(포메이션 판정·5단계·시너지가 본다): team = 아티팩트 3칸, off = 포메이션 아이템 1칸 */
export const teamWornOf = (cat, o) => (teamArtifactsOn(cat) ? (o.artifacts ?? []).filter(Boolean) : [o.fmItem].filter((a) => typeof a === 'string' && cat.artifacts.has(a)));

/**
 * 옛 저장(팀 공용 아티팩트 3칸) -> 선수별 칸 이관(D62, off 에서만 부른다). roster 를 그 자리에서 고친다(spItem), 돌려주는 값 = 포메이션 아이템 칸(fmItem | null).
 * 낀 필살슛 아이템 = 주 슬롯이 그 슛인 첫 선수에게 끼운다(없으면 끼지 않은 채 보유로 남는다). 같은 슛을 넣었던 나머지 선수는 슬롯 정리(cleanSpecials)에서 비워진다(원작 선수는 고유 슛으로 돌아간다).
 * 낀 포메이션 아이템 = team 에서 실제로 쓰이던 것(formationOf 와 같은 규칙): 저장된 패턴 fm 을 주는 아이템, 없으면 기본 포메이션(run_config formation.default)을 주는 아이템, 둘 다 없으면 null.
 *   -> 이관 뒤 run.fm(= formationOf(fm, [fmItem]))과 fmItem 이 언제나 짝이 맞고, 쓰던 패턴·태그가 그대로 이어진다(정검수 M1. 첫 칸 아이템을 고르면 패턴과 어긋났다).
 * 손으로 쓴 아티팩트(A01~A30)는 여기서 다루지 않는다(저장 읽기가 버리고 환급한다). 이미 spItem 이 있는 선수는 건드리지 않는다
 */
export function migrateWorn(cat, roster, arts, fm) {
  const fms = [];
  for (const a of arts ?? []) {
    const g = a ? cat.artifacts.get(a)?.grant : null;
    if (!g) continue;
    if (g.formation !== undefined) { fms.push(a); continue; }
    if (roster.some((r) => r.spItem === a)) continue;
    const r = roster.find((x) => !x.spItem && x.sp?.[0] === g.shot);
    if (r) r.spItem = a;
  }
  const of = (n) => fms.find((a) => cat.artifacts.get(a).grant.formation === n) ?? null;
  return of(fm) ?? of(cat.cfg.formation.default);
}

// ---------- 필살기 부여 구조(analysis/39 D38, decisions.json special.model = 'granted') ----------
// 선수별 발동 가능 집합 = 팀에 낀 아티팩트가 부여한 슛(allowOf) + (원작 선수라면) 자기 고유 슛(catalog.ownSpecial). 불씨·클론은 고유 슛이 없다.
// 엔진은 roster[i].sp[0] 이 allow(팀 공용)에 있으면 발동하므로(server/engine/flame.js flActiveId), 서버가 (1) allow 에 로스터 원작 선수의 고유 슛을 더하고
// (2) 선수별 집합 밖의 슬롯 값을 비워서 넘긴다 -> 남의 고유 슛이 allow 에 있어도 그 선수가 아니면 나가지 않는다. 종전(legacy)에서는 아래 함수가 전부 종전 값을 그대로 돌려준다.

/** 아티팩트 하나의 대표 슛(끼면 빈 주 슬롯에 들어가는 ID, shot_families.json grantShotId). 필살기를 부여하지 않는 아티팩트는 null */
export function grantShotOf(cat, artId) {
  const g = cat.artifacts.get(artId)?.grant?.shot;
  if (g !== undefined) return g; // 등급 필살슛 아이템: 자기 슛
  for (const f of cat.artifacts.get(artId)?.unlockShotFamilies ?? []) if (cat.special.grantShot[f] !== undefined) return cat.special.grantShot[f];
  return null;
}

/** 엔진 flame 옵션의 allow: 종전 = 아티팩트 해금 ID, 부여 구조 = 아티팩트가 부여한 ID + 로스터 원작 선수의 고유 슛(오름차순) */
export function engineAllow(cat, data, roster, artifacts) {
  const grant = teamArtifactsOn(cat) ? allowOf(cat, artifacts.filter(Boolean)) : roster.map((r) => spItemShot(cat, r)).filter((g) => g !== null); // off(D58): 전 선수가 낀 아이템의 슛
  if (!grantedModel(cat)) return grant;
  const s = new Set(grant);
  for (const r of roster) { const own = ownSpecial(cat, data, r); if (own !== null) s.add(own); }
  return [...s].sort((a, b) => a - b);
}

/**
 * 선수 한 명의 슬롯 정리(부여 구조): 발동 가능 집합 밖의 ID 는 비우고, 원작 선수의 주 슬롯이 비면 고유 슛으로 되돌린다(예비 슬롯에 있었으면 옮긴다).
 * 클론·불씨의 빈 주 슬롯은 채우지 않는다(= 「필살기 없음」. 자동 채움은 아티팩트를 낄 때·영입할 때만 한다)
 */
function cleanSp(cat, data, r, grant) {
  const own = ownSpecial(cat, data, r), item = spItemShot(cat, r);
  if (!teamArtifactsOn(cat)) grant = new Set(item === null ? [] : [item]); // off(D58): 그 선수가 낀 아이템의 슛만
  const sp = [0, 1].map((k) => { const id = r.sp?.[k] ?? null; return id !== null && (grant.has(id) || id === own) ? id : null; });
  if (sp[0] !== null && sp[0] === sp[1]) sp[1] = null;
  if (item !== null && sp[0] === null) { sp[0] = item; if (sp[1] === item) sp[1] = null; } // 아이템을 낀 선수의 빈 주 슬롯 = 그 아이템의 슛
  if (own !== null && sp[0] === null) { if (sp[1] === own) sp[1] = null; sp[0] = own; }
  return sp;
}

/** 로스터 7칸의 정리된 슬롯(로스터를 고치지 않는다). 종전(legacy)은 저장된 값 그대로 */
export function specialsOf(cat, data, roster, artifacts) {
  if (!grantedModel(cat)) return roster.map((r) => [r.sp?.[0] ?? null, r.sp?.[1] ?? null]);
  const grant = new Set(allowOf(cat, artifacts.filter(Boolean)));
  return roster.map((r) => cleanSp(cat, data, r, grant));
}

/** 로스터의 슬롯을 그 자리에서 정리한다(저장 읽기·아티팩트 변경 뒤·키운 팀 조립). 종전(legacy)에서는 아무것도 하지 않는다 */
export function cleanSpecials(cat, data, roster, artifacts) {
  if (!grantedModel(cat)) return;
  specialsOf(cat, data, roster, artifacts).forEach((sp, i) => { roster[i].sp = sp; });
}

/**
 * 새로 로스터에 드는 선수의 슬롯 시작값. 종전 = [원래 필살기, null].
 * 부여 구조 = 원작 선수는 [고유 슛, null], 불씨·클론은 [지금 낀 아티팩트 중 첫 필살기 아티팩트의 대표 슛 | null, null](아티팩트가 없으면 「필살기 없음」)
 */
export function initialSpecials(cat, data, r, artifacts = []) {
  const own = ownSpecial(cat, data, r);
  if (own !== null || !grantedModel(cat) || !teamArtifactsOn(cat)) return [own, null]; // off(D58): 새 선수는 아이템 없이 들어온다(자동 배정 없음)
  for (const a of artifacts) { const g = a ? grantShotOf(cat, a) : null; if (g !== null) return [g, null]; }
  return [null, null];
}

// ---------- 등급제(analysis/39 D39~D44, decisions.json grade.model = 'v1') ----------

/**
 * 지금 쓰이는 포메이션(D42). 등급제: 기본 포메이션(run_config formation.default)은 아이템 없이 쓸 수 있지만 태그·보너스·시너지가 없다. 낀 포메이션 아이템(FM<패턴>-<등급>)이 그 패턴의 선택권·태그·등급 보너스를 준다.
 *   낀 아이템이 주지 않는 패턴이 저장돼 있으면 기본 포메이션으로 읽는다(아이템을 빼면 기본으로). 기본 패턴의 아이템을 끼면 기본 패턴도 태그·보너스를 받는다.
 * 꺼져 있으면 종전: 저장된 패턴 그대로, 태그는 패턴의 태그
 * @returns {{fm:number, item:string|null, grade:string|null, tag:string|null}}
 */
export function formationOf(cat, fm, artifacts) {
  if (!gradeOn(cat)) return { fm, item: null, grade: null, tag: cat.tagOfFm.get(fm) ?? null };
  const of = (n) => (artifacts ?? []).find((a) => a && cat.artifacts.get(a)?.grant?.formation === n) ?? null;
  let item = of(fm);
  if (!item && fm !== cat.cfg.formation.default) { fm = cat.cfg.formation.default; item = of(fm); }
  return { fm, item, grade: item ? cat.artifacts.get(item).grade : null, tag: item ? cat.tagOfFm.get(fm) ?? null : null };
}

/**
 * 필살 위력 상한(D45 — D41 의 상한 구조를 대체). 엔진에 넘길 fx 를 자른다(엔진은 고치지 않는다). 엔진 식(server/engine/flame.js flThrowPow) = (표값 + 고정 가산 합) × (100 + % 합) / 100 내림.
 * 필살 투구는 언제나 공중·차지 13~15 라 airPow·chargePow 가 같이 붙는다(= 평소 필살). 캐치 직후면 catchPow 가 더 붙는다(= 조건 가산).
 *  1) 등급 가산(gradeAdd, 이미 fx.spPow 에 들어 있다)은 상한 밖이다 — 언제나 전액 붙는다.
 *  2) 그 밖의 가산(평소 필살의 표값 대비 증가분 − 등급 가산: 장비 옵션·아티팩트·시너지의 필살 전용 값 + % + 차지·공중 가산)이 otherCap(decisions grade.spOtherCap)을 넘으면 필살 전용 값만 줄인다:
 *     이 슛이 속한 계열의 가산과 % 를 접고(다른 계열 값은 그대로 둔다) 남은 몫(otherCap − 차지·공중 가산)을 spAirPow·spPow 에 다시 담는다. 차지·공중 가산은 일반 투구에도 쓰이는 값이라 건드리지 않는다.
 *     캐치 가산은 이 계산에 넣지 않는다 -> 캐치 가산 장비를 껴도 평소 필살이 약해지지 않는다(정검수 M1).
 *  3) 전체 안전 상한 totalCap(grade.spPowCap): 캐치 직후 필살(평소 필살 + catchPow)이 표값 + totalCap 을 넘으면 넘는 만큼 catchPow 만 줄인다(평소 필살은 그대로).
 * 받아치기 공은 엔진이 가산하지 않는다(counterBonus false).
 * 한계: (가) 차지·공중 가산만으로 otherCap 을 넘으면 그만큼은 넘는다. (나) catchPow 는 일반 투구의 캐치 직후 가산이기도 해서, 3)으로 줄인 만큼 그 선수의 캐치 직후 일반 투구도 약해진다(엔진에 필살 전용 캐치 칸이 없다)
 * @returns {{cut:number, cutCatch:number, other:number}} cut = 2)에서 잘린 위력, cutCatch = 3)에서 줄인 catchPow, other = 자른 뒤 평소 필살의 그 밖의 가산
 */
export function capSpecialFx(cat, fx, shotId, table, gradeAdd, otherCap, totalCap) {
  const fams = Object.entries(cat.families).filter(([, ids]) => ids.includes(shotId)).map(([f]) => f);
  const always = fx.chargePow + fx.airPow;
  const plain = (extra = 0) => { // 표값 대비 증가분(extra = 캐치 가산)
    const add = always + extra + fx.spPow + fx.spAirPow + fams.reduce((n, k) => n + (fx.famPow[k] ?? 0), 0), pct = fx.spPct + fams.reduce((n, k) => n + (fx.famPct[k] ?? 0), 0);
    return Math.floor(((table + add) * (100 + pct)) / 100) - table;
  };
  let other = plain() - gradeAdd, cut = 0, cutCatch = 0;
  if (otherCap !== null && other > otherCap) {
    const left = Math.max(0, otherCap - always);
    fx.spPct = 0;
    for (const k of fams) { delete fx.famPow[k]; delete fx.famPct[k]; }
    fx.spAirPow = Math.max(0, Math.min(fx.spAirPow, left)); fx.spPow = gradeAdd + left - fx.spAirPow;
    cut = other - (plain() - gradeAdd); other -= cut;
  }
  while (fx.catchPow > 0 && plain(fx.catchPow) > totalCap) { fx.catchPow--; cutCatch++; }
  return { cut, cutCatch, other };
}

/** 그 계열(shot_families 의 id)의 슛을 하나라도 부여하는 아티팩트인가: 계열 아티팩트(A01 = 불꽃) 또는 그 계열 슛의 등급 필살슛 아이템(SP22-x·SP25-x = 불꽃) */
export const grantsFamily = (cat, artId, fam) => allowOf(cat, [artId]).some((id) => cat.families[fam]?.includes(id));

/** 지금 켜진 시너지 ID(조건 아티팩트 전부 장착 + (있으면) 조건 계열의 슛을 부여하는 아티팩트 장착(requires.shotFamily, D47) + 포메이션 태그 조건) */
export function activeSynergies(cat, artifacts, tag) {
  if (!teamArtifactsOn(cat)) return []; // off(D58): 시너지 7종은 전부 아티팩트 조건이라 같이 꺼진다
  const on = new Set(artifacts);
  return cat.synergies.filter((s) => s.requires.artifacts.every((a) => on.has(a)) && (s.requires.shotFamily == null || artifacts.some((a) => grantsFamily(cat, a, s.requires.shotFamily)))
    && (s.requires.formationTag == null || s.requires.formationTag === tag)).map((s) => s.id);
}

/** 투구 조건부 효과 한 개를 엔진 fx 칸에 더한다. mult = 시너지 강화 배율(%). 엔진 훅이 없는 조합이면 false */
function addThrowFx(fx, e, mult = 100) {
  const c = e.conditions ?? {}, amp = (v) => roundHalfUp(v * mult, 100);
  const v = pv(e, 'value'), pct = e.params?.pct ?? null;
  if (e.type === 'throw_speed_bonus') {
    if (!c.afterPass || v == null) return false; // 계열 필살 속도(A04)는 엔진 훅이 없다
    fx.passSpd += amp(v); return true;
  }
  let key = null, fam = null;
  if (c.afterCatch) key = 'catchPow';
  else if (c.chargeMin !== undefined) key = 'chargePow';
  else if (c.special && c.shotFamily) fam = c.shotFamily;
  else if (c.special && c.airborne) key = 'spAirPow';
  else if (c.special) key = pct != null && v == null ? 'spPct' : 'spPow';
  else if (c.airborne) key = 'airPow';
  else return false;
  if (fam) {
    if (v != null) fx.famPow[fam] = (fx.famPow[fam] ?? 0) + amp(v);
    if (pct != null) fx.famPct[fam] = (fx.famPct[fam] ?? 0) + amp(pct);
  } else fx[key] += amp(key === 'spPct' ? pct : v);
  return true;
}

let zCache = null;
/** 추천 역할(§11.3, 표시 전용): 25팀 전 선수 분포에서 가장 두드러진 능력치. 두드러진 것이 없으면 균형형 */
export function roleOf(cat, data, final) {
  if (!zCache || zCache.data !== data) {
    const all = data.teams.flatMap((t) => t.players), ms = {};
    for (const [k, ek] of Object.entries(ENGINE_STAT)) {
      const mean = all.reduce((s, p) => s + p[ek], 0) / all.length;
      ms[k] = { mean, sd: Math.sqrt(all.reduce((s, p) => s + (p[ek] - mean) ** 2, 0) / all.length) || 1 };
    }
    zCache = { data, ms };
  }
  let best = null, bz = cat.cfg.roleMinZ;
  for (const r of cat.cfg.roles) {
    if (!r.stat) continue;
    const z = Math.round(((final[r.stat] - zCache.ms[r.stat].mean) / zCache.ms[r.stat].sd) * 100);
    if (z > bz) { bz = z; best = r; }
  }
  return (best ?? cat.cfg.roles.find((r) => !r.stat)).id;
}

/**
 * 팀 7명의 최종 능력치.
 * @param {object} cat loadCatalog()
 * @param {object} data 엔진 데이터(loadData())
 * @param {{roster:object[], items:object[], artifacts:(string|null)[], fmItem?:string|null, fm:number, perm?:object, buffs?:object[], nodeType?:string|null, surviveCount?:number}} ctx  (surviveCount = 이 도전에서 이미 쓴 치사 생존 횟수)
 *   artifact.model 'off'(D58): artifacts 는 보지 않고 fmItem(팀 1칸)과 roster[i].spItem(선수별)을 본다. 5단계·시너지 = 0, 태그 보너스 = formation_tags tags[].bonus × 포메이션 아이템 등급 배율
 *   roster[i] = {from:{team,idx}, clone?(영입 풀 id), train:{}, equip:{slot:inst|null}, recruited}, items = [{inst,id,lv}], buffs = [{c, p}]
 * @returns {{tag:string, fm:number, fmItem:string|null, fmGrade:string|null, artifacts:string[], synergies:string[], allow:number[], grant:number[], amp:{formation:number, synergy:number}, unsupported:string[], players:object[]}}
 *   등급제(D39~D44): fm = 실제로 쓰이는 패턴(낀 포메이션 아이템이 주지 않는 패턴이면 기본 포메이션), fmItem·fmGrade = 그 패턴을 주는 낀 아이템과 등급(없으면 null = 태그·보너스 없음),
 *   players[i].special = {id: 주 슬롯 슛 | null, grade: 그 슛을 주는 낀 아이템의 등급 | null(고유 슛·계열 아티팩트 = 등급 없음), add: 등급 위력 가산(상한 밖, 전액), cut: 그 밖의 가산 상한(spOtherCap)으로 잘린 값, other: 자른 뒤 평소 필살의 그 밖의 가산, cutCatch: 전체 안전 상한(spPowCap)으로 줄인 캐치 가산}
 *   allow = 엔진에 넘기는 발동 허용 ID(부여 구조 D38 에서는 로스터 원작 선수의 고유 슛 포함), grant = 낀 아티팩트가 부여한 ID(아무 선수나 슬롯에 넣을 수 있는 것),
 *   players[i].kind = 'starter'|'clone'|'original', players[i].own = 그 선수만 넣을 수 있는 고유 슛 ID | null
 */
export function computeTeam(cat, data, ctx) {
  const arts = teamWornOf(cat, ctx), G = gradeOn(cat) ? cat.grade : null, teamOn = teamArtifactsOn(cat);
  const FM = formationOf(cat, ctx.fm, arts), tag = FM.tag;
  const inst = new Map((ctx.items ?? []).map((it) => [it.inst, it]));
  const capIdx = cat.decisions.roster.captainSlot;
  let surviveSpent = Number.isInteger(ctx.surviveCount) ? ctx.surviveCount : 0; // 치사 생존은 도전 단위 횟수(P2 리뷰 L3): 이미 쓴 횟수 + 이번 계산에서 앞 선수에게 나눠 준 횟수
  const perm = ctx.perm ?? {}, unsupported = [];
  const condOk = (c = {}) => (c.formationTag === undefined || c.formationTag === tag) && (c.nodeType === undefined || c.nodeType === ctx.nodeType);
  const targets = (t, self) => (t === 'team' ? ctx.roster.map((_, i) => i) : t === 'captain' ? [capIdx] : self === null || self === undefined ? [] : [self]);

  const P = ctx.roster.map((r, i) => {
    const src = data.teams[r.from.team]?.players?.[r.from.idx];
    if (!src) throw new Error(`flame stats: 없는 선수 ${r.from.team}:${r.from.idx}`);
    const base = zero(), cl = cloneOf(cat, r); // 영입 풀 클론(D18): 기본 능력치는 풀의 stat(자기 능력치). from(= 몸)은 히트박스·손 위치·컴퓨터 표만 정한다
    for (const [k, ek] of Object.entries(ENGINE_STAT)) base[k] = cl ? cl.base[k] : src[ek];
    return { i, from: { ...r.from }, base, add: STEP_IDS.map(() => zero()), fx: newFx(), f6: zero(), f7: zero() };
  });
  let ampF = 0, ampS = 0; // 포메이션·시너지 강화 배율(% 포인트 합)

  // 2 영구 성장(A: 시작 선수만. 영입 선수에게는 붙지 않는다)
  for (const u of cat.perm.values()) {
    // 단계는 maxLevel 로 자르지 않는다(옛 표에서 산 효과 보존, D50) — 받아 주는 상한 cat.permCap 까지만, 정수가 아닌 값은 0
    const raw = perm[u.id], lv = Number.isInteger(raw) && raw > 0 ? Math.min(raw, cat.permCap?.get(u.id) ?? raw) : 0;
    if (u.group !== 'A' || !lv) continue;
    for (const p of P) if (u.effect.target !== 'starters' || !ctx.roster[p.i].recruited) p.add[1][u.effect.stat] += u.effect.perLevel * lv;
  }
  // 3 특훈
  for (const p of P) for (const [k, v] of Object.entries(ctx.roster[p.i].train ?? {})) if (STAT_KEYS.includes(k)) p.add[2][k] += v;
  // 4 장비(선수별): 무조건 능력치(+강화) + 조건부 효과
  for (const p of P) {
    for (const slot of cat.slots) {
      const it = inst.get(ctx.roster[p.i].equip?.[slot]);
      if (!it) continue;
      const def = cat.items.get(it.id);
      for (const [k, v] of Object.entries(upgradedStats(cat, it.id, it.lv))) p.add[3][k] += v;
      for (const e of def.effects) {
        if (e.type === 'stat_bonus') {
          if (e.conditions?.hpAtMostPct !== undefined) p.fx.lowHpDef += pv(e, 'value'); // P08: 경기 중 HP 를 봐야 한다 -> 엔진 훅
          else if (condOk(e.conditions)) for (const t of targets(pv(e, 'target'), p.i)) P[t].add[3][pv(e, 'stat')] += pv(e, 'value');
        } else if (e.type === 'survive_lethal') { const left = pv(e, 'usesPerRun') - surviveSpent; if (left > 0) { p.fx.survive += left; surviveSpent += left; } } // P10: 도전당 1회 = 도전 전체에서(같은 장비를 또 얻거나 두 명이 껴도 늘지 않는다. 라인업 앞 선수가 먼저 받는다)
        else if (e.type === 'formation_bonus_amplify') { if (!e.conditions?.isCaptain || p.i === capIdx) ampF += pv(e, 'multiplierPct'); } // H10: 주장이 낄 때만
        else if (!addThrowFx(p.fx, e)) unsupported.push(`${it.id}:${e.type}`);
      }
    }
  }
  // 5 아티팩트(팀 공용, 포메이션 조건 없음) / 6 포메이션(조건에 formationTag 가 있는 아티팩트 효과)
  for (const id of arts) {
    for (const e of cat.artifacts.get(id).effects) {
      if (e.type === 'stat_bonus') {
        const st = e.conditions?.formationTag !== undefined ? 'f6' : null;
        if (!condOk(e.conditions)) continue;
        for (const t of targets(pv(e, 'target'), null)) { if (st) P[t].f6[pv(e, 'stat')] += pv(e, 'value'); else P[t].add[4][pv(e, 'stat')] += pv(e, 'value'); }
      } else if (e.type === 'formation_bonus_amplify') ampF += pv(e, 'multiplierPct');
      else if (e.type === 'synergy_amplify') ampS += pv(e, 'multiplierPct');
      else if (e.type === 'unlock_shot_family' || e.type === 'reward_extra_choice') { /* 해금 = allowOf, 보상 = run.js */ }
      else { let ok = true; for (const p of P) ok = addThrowFx(p.fx, e) && ok; if (!ok) unsupported.push(`${id}:${e.type}`); }
    }
  }
  // 6 태그 보너스표(off, D60): 낀 포메이션 아이템이 주는 태그의 보너스(종전 A09~A17 의 값)를 팀 전원에게. 아래에서 포메이션 강화 배율(등급 tagPct)을 받는다
  if (!teamOn && FM.grade && FM.tag) for (const b of cat.tagBonus.get(FM.tag) ?? []) for (const p of P) p.f6[b.stat] += b.value;
  // 8 소모품(다음 경기 임시 효과). 강화 배율(C12)은 6단계 합산 전에 알아야 해서 먼저 모은다
  for (const b of ctx.buffs ?? []) {
    for (const e of cat.consumables.get(b.c)?.effects ?? []) {
      if (e.type === 'formation_bonus_amplify') ampF += pv(e, 'multiplierPct');
      else if (e.type === 'stat_bonus' && condOk(e.conditions)) for (const t of targets(pv(e, 'target'), b.p)) P[t].add[7][pv(e, 'stat')] += pv(e, 'value');
    }
  }
  // 7 시너지: 조건 아티팩트와 같은 수치(duplicatesArtifact)는 다시 더하지 않는다(D10)
  const syn = activeSynergies(cat, arts, tag);
  for (const sid of syn) {
    for (const e of cat.synergies.find((s) => s.id === sid).effects) {
      if (e.duplicatesArtifact && !cat.applyDuplicates) continue;
      if (e.type === 'stat_bonus') { for (const t of targets(pv(e, 'target'), null)) P[t].f7[pv(e, 'stat')] += pv(e, 'value'); }
      else { let ok = true; for (const p of P) ok = addThrowFx(p.fx, e, 100 + ampS) && ok; if (!ok) unsupported.push(`${sid}:${e.type}`); }
    }
  }
  // 6 포메이션 아이템의 등급 보너스(D42, 새 단계 없음 — 6단계 안): 태그 조건 보너스 배율(C 50% … S 200%)은 포메이션 강화 배율에 (배율 − 100)으로 더하고, 강화 배율 합은 상한(ampCapPct)으로 자른다. 팀 능력치 가산(fmFlat)은 배율을 받지 않는다
  const fmFlat = zero();
  if (G) {
    if (FM.grade) { ampF += G.formation.tagPct[FM.grade] - 100; for (const [k, v] of Object.entries(G.formation.stat)) fmFlat[k] += v[FM.grade]; }
    ampF = Math.max(-100, Math.min(ampF, G.formation.ampCapPct));
  }
  // 필살슛 등급 가산(D41): 주 슬롯의 슛을 주는 낀 등급 아이템이 있으면 그 등급의 위력 가산(fx.spPow). 고유 슛·계열 아티팩트(A01~A06)의 슛은 등급이 없다(가산 0) — 단 같은 슛의 아이템을 끼면 그 등급을 받는다.
  // 등급 가산은 상한 밖에서 전액 붙고, 그 밖의 필살 가산 합은 spOtherCap, 캐치 직후까지 더한 전체는 spPowCap 으로 자른다(D45, capSpecialFx)
  const sps = specialsOf(cat, data, ctx.roster, arts), shotGrade = new Map();
  if (teamOn) for (const a of arts) { const d = cat.artifacts.get(a); if (d?.grant?.shot !== undefined) shotGrade.set(d.grant.shot, d.grade); }
  for (const p of P) {
    const id = sps[p.i][0], r = ctx.roster[p.i];
    // off(D58): 등급 = 그 선수가 낀 아이템의 등급(주 슬롯이 그 아이템의 슛일 때만). 다른 선수의 아이템은 보지 않는다
    const grade = id === null ? null : teamOn ? shotGrade.get(id) ?? null : spItemShot(cat, r) === id ? cat.artifacts.get(r.spItem).grade : null;
    p.special = { id, grade, add: 0, cut: 0, other: 0, cutCatch: 0 };
    if (!G || id === null) continue;
    if (grade) { p.special.add = G.spPow[grade]; p.fx.spPow += p.special.add; p.fx.spSpd = Math.max(0, Math.min(G.spSpd[grade] | 0, G.spSpdMax)); } // 필살 속도 가산(D52): 그 등급 값, 데이터 최댓값 이내로 한 번 더 자른다(엔진 server/engine/flame.js flSpSpd)
    Object.assign(p.special, capSpecialFx(cat, p.fx, id, data.specials.power[id], p.special.add, G.spOtherCap, G.spPowCap));
  }
  const C = cat.rules.clamps, caps = cat.cfg.statCaps ?? {};
  const hi = { r1: C.r1MaxPct, r2: C.r2MaxPct, r3: C.r3MaxShortenFrames };
  const M = data.rules.move, fr = data.stages?.[0]?.friction ?? 0;
  const capS2 = Math.ceil((M.dashMax - 65536 + 2 * fr) / 4096); // 걷기 속도(1 + s2/16 - 2x마찰)가 상한 3.0px/f 에 닿는 s2 (기본 스테이지 마찰 기준)
  const players = P.map((p) => {
    for (const k of STAT_KEYS) { p.add[5][k] = roundHalfUp(p.f6[k] * (100 + ampF), 100) + fmFlat[k]; p.add[6][k] = roundHalfUp(p.f7[k] * (100 + ampS), 100); }
    const raw = { ...p.base };
    for (let s = 1; s <= 7; s++) for (const k of STAT_KEYS) raw[k] += p.add[s][k];
    // 9 상한·하한: HP 1 이상, 나머지 0 이상(방어 음수 금지), R1·R2 60%, R3 24프레임, 능력치 상한(run_config statCaps, 지금은 없음)
    const final = {}, over = {};
    for (const k of STAT_KEYS) {
      const max = hi[k] ?? caps[k] ?? Infinity;
      final[k] = Math.min(Math.max(raw[k], k === 's0' ? 1 : 0), max);
      p.add[8][k] = final[k] - raw[k];
      if (raw[k] > max) over[k] = raw[k] - max; // 상한을 넘어 버려지는 양(화면의 낭비 표시)
    }
    const steps = STEP_IDS.map((id, s) => ({ id, add: s === 0 ? { ...p.base } : Object.fromEntries(Object.entries(p.add[s]).filter(([, v]) => v !== 0)) }));
    return {
      i: p.i, from: p.from, kind: playerKind(cat, ctx.roster[p.i]), own: ownSpecial(cat, data, ctx.roster[p.i]), spItem: spItemShot(cat, ctx.roster[p.i]) !== null ? ctx.roster[p.i].spItem : null, special: p.special, base: p.base, final, steps, over, fx: p.fx,
      delta: Object.fromEntries(STAT_KEYS.map((k) => [k, final[k] - p.base[k]])),
      down: C.downFramesBase - final.r3, // 쓰러짐 프레임(60 - R3, 하한 36)
      move: { walk: (65536 + (final.s2 << 12) - 2 * fr) / 65536, capPxPerFrame: C.moveSpeedCapPxPerFrame, capS2, wasted: Math.max(0, final.s2 - capS2) },
      role: roleOf(cat, data, final),
    };
  });
  return { tag, fm: FM.fm, fmItem: FM.item, fmGrade: FM.grade, artifacts: arts, synergies: syn, allow: engineAllow(cat, data, ctx.roster, arts), grant: teamOn ? allowOf(cat, arts) : [], amp: { formation: ampF, synergy: ampS }, unsupported: [...new Set(unsupported)], players };
}

/** 최종 능력치 -> 엔진 옵션 칸(PROTOCOL §12.1 roster[i].stat / ext) */
export function toEngine(pl) {
  const stat = {};
  for (const [k, ek] of Object.entries(ENGINE_STAT)) stat[ek] = pl.final[k];
  return { stat, ext: { r1: pl.final.r1, r2: pl.final.r2, r3: pl.final.r3 }, fx: { ...pl.fx, famPow: { ...pl.fx.famPow }, famPct: { ...pl.fx.famPct } } };
}

/** 도전 상태(run) 그대로 계산. nodeType = 다음(지금) 경기 종류(보스전 한정 효과 C20 판정용, 경기 밖 표시는 null) */
export const teamOfRun = (cat, data, run, perm, nodeType = null) => computeTeam(cat, data, {
  roster: run.roster, items: run.items, artifacts: run.artifacts, fmItem: run.fmItem ?? null, fm: run.fm, perm, buffs: run.buffs, nodeType, surviveCount: run.surviveCount,
});

/** 현재 HP 를 [0, 최대 HP] 로 맞춘다(장비를 빼 최대 HP 가 줄었을 때 등). 최대 HP 가 늘어도 현재 HP 는 늘지 않는다 */
export function clampHp(run, team) {
  run.roster.forEach((r, i) => { r.hp = Math.max(0, Math.min(r.hp, team.players[i].final.s0)); });
}
