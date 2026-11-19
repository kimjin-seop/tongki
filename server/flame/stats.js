// 불꽃의 계승 능력치 파이프라인(기획 §14.1 9단계, 순수 함수 — 입력을 고치지 않고 저장·난수·시계를 쓰지 않는다).
//   1 기본 -> 2 영구 성장 -> 3 특훈 -> 4 장비(+강화) -> 5 아티팩트 -> 6 포메이션 -> 7 시너지 -> 8 소모품 -> 9 상한/하한
// 매번 1단계(원본 선수 데이터)부터 다시 더하므로 장비를 빼면 그 장비의 증감이 정확히 사라진다(§14.2 "제거 시 원래 능력치로 복구").
// 반올림은 catalog.roundHalfUp 하나만 쓴다(강화 보너스, 포메이션·시너지 강화 배율). 능력치는 전부 정수다.
// 경기 중 조건을 봐야 하는 효과(캐치 후 첫 투구 등)는 능력치가 아니라 fx(엔진 flame 옵션 roster[i].fx, PROTOCOL §12.1)로 모은다.
import { STAT_KEYS, ENGINE_STAT, pv, roundHalfUp, cloneOf } from './catalog.js';

const zero = () => Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
const newFx = () => ({ catchPow: 0, passSpd: 0, chargePow: 0, airPow: 0, lowHpDef: 0, survive: 0, spPow: 0, spAirPow: 0, spPct: 0, famPow: {}, famPct: {} });
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

/** 장착한 아티팩트로 해금되는 필살기 ID(오름차순). 강위력(A06)은 불꽃·도끼를 열지 않는다(39 A2), 표값 255 ID 는 없다(D2) */
export function allowOf(cat, artifacts) {
  const s = new Set();
  for (const id of artifacts) for (const f of cat.artifacts.get(id)?.unlockShotFamilies ?? []) for (const sh of cat.unlockIds[f]) s.add(sh);
  return [...s].sort((a, b) => a - b);
}

/** 지금 켜진 시너지 ID(조건 아티팩트 전부 장착 + 포메이션 태그 조건) */
export function activeSynergies(cat, artifacts, tag) {
  const on = new Set(artifacts);
  return cat.synergies.filter((s) => s.requires.artifacts.every((a) => on.has(a)) && (s.requires.formationTag == null || s.requires.formationTag === tag)).map((s) => s.id);
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
 * @param {{roster:object[], items:object[], artifacts:(string|null)[], fm:number, perm?:object, buffs?:object[], nodeType?:string|null, surviveCount?:number}} ctx  (surviveCount = 이 도전에서 이미 쓴 치사 생존 횟수)
 *   roster[i] = {from:{team,idx}, clone?(영입 풀 id), train:{}, equip:{slot:inst|null}, recruited}, items = [{inst,id,lv}], buffs = [{c, p}]
 * @returns {{tag:string, artifacts:string[], synergies:string[], allow:number[], amp:{formation:number, synergy:number}, unsupported:string[], players:object[]}}
 */
export function computeTeam(cat, data, ctx) {
  const arts = (ctx.artifacts ?? []).filter(Boolean), tag = cat.tagOfFm.get(ctx.fm) ?? null;
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
    const lv = perm[u.id] ?? 0;
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
  const C = cat.rules.clamps, caps = cat.cfg.statCaps ?? {};
  const hi = { r1: C.r1MaxPct, r2: C.r2MaxPct, r3: C.r3MaxShortenFrames };
  const M = data.rules.move, fr = data.stages?.[0]?.friction ?? 0;
  const capS2 = Math.ceil((M.dashMax - 65536 + 2 * fr) / 4096); // 걷기 속도(1 + s2/16 - 2x마찰)가 상한 3.0px/f 에 닿는 s2 (기본 스테이지 마찰 기준)
  const players = P.map((p) => {
    for (const k of STAT_KEYS) { p.add[5][k] = roundHalfUp(p.f6[k] * (100 + ampF), 100); p.add[6][k] = roundHalfUp(p.f7[k] * (100 + ampS), 100); }
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
      i: p.i, from: p.from, base: p.base, final, steps, over, fx: p.fx,
      delta: Object.fromEntries(STAT_KEYS.map((k) => [k, final[k] - p.base[k]])),
      down: C.downFramesBase - final.r3, // 쓰러짐 프레임(60 - R3, 하한 36)
      move: { walk: (65536 + (final.s2 << 12) - 2 * fr) / 65536, capPxPerFrame: C.moveSpeedCapPxPerFrame, capS2, wasted: Math.max(0, final.s2 - capS2) },
      role: roleOf(cat, data, final),
    };
  });
  return { tag, artifacts: arts, synergies: syn, allow: allowOf(cat, arts), amp: { formation: ampF, synergy: ampS }, unsupported: [...new Set(unsupported)], players };
}

/** 최종 능력치 -> 엔진 옵션 칸(PROTOCOL §12.1 roster[i].stat / ext) */
export function toEngine(pl) {
  const stat = {};
  for (const [k, ek] of Object.entries(ENGINE_STAT)) stat[ek] = pl.final[k];
  return { stat, ext: { r1: pl.final.r1, r2: pl.final.r2, r3: pl.final.r3 }, fx: { ...pl.fx, famPow: { ...pl.fx.famPow }, famPct: { ...pl.fx.famPct } } };
}

/** 도전 상태(run) 그대로 계산. nodeType = 다음(지금) 경기 종류(보스전 한정 효과 C20 판정용, 경기 밖 표시는 null) */
export const teamOfRun = (cat, data, run, perm, nodeType = null) => computeTeam(cat, data, {
  roster: run.roster, items: run.items, artifacts: run.artifacts, fm: run.fm, perm, buffs: run.buffs, nodeType, surviveCount: run.surviveCount,
});

/** 현재 HP 를 [0, 최대 HP] 로 맞춘다(장비를 빼 최대 HP 가 줄었을 때 등). 최대 HP 가 늘어도 현재 HP 는 늘지 않는다 */
export function clampHp(run, team) {
  run.roster.forEach((r, i) => { r.hp = Math.max(0, Math.min(r.hp, team.players[i].final.s0)); });
}
