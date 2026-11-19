// 불꽃의 계승 「키운 팀」 슬롯(PROTOCOL §13.20, analysis/39 D33~D36, analysis/43): 도전이 끝날 때의 팀을 영구 저장(profile.teams{recent, best})에 재료만 남기고,
// 컴퓨터 대전 방에서 그 팀을 골랐을 때 엔진 flame 옵션(좌석 0)과 표시용 cast 를 조립한다. 이 파일은 저장소·소켓·방을 모른다(run.js 와 같다).
// 저장하는 것 = 재료만: 7명 구성·순서(from/orig/clone/recruited), 특훈 누적, 낀 장비의 아이템 id·강화 단계, 낀 아티팩트, 포메이션, 필살기 슬롯, 영구 성장 A 단계, 난이도·도달 구간·승수·시각.
// 저장하지 않는 것: 최종 능력치(쓸 때마다 computeTeam -> toEngine 으로 다시 계산한다. 저장값·클라이언트 수치를 믿지 않는다), 이름·skin·팀명(orig/clone id 에서 displayCast 로 만든다),
//   현재 HP·소모품·다음 경기 효과·끼지 않은 장비·경기 포인트·지도·난수 비밀값·치사 생존 사용 횟수.
// 읽을 때마다 sanitizeTeam 을 거친다: 없어진 아이템·아티팩트·클론·오리지널 id 는 그 칸만 버리고 팀은 살린다. 7명이 아니거나 같은 선수가 겹치면 그 슬롯만 없음(null)이다.
// 팀 공용 아티팩트 끄기(D58~D63): 새 슬롯에는 roster[i].spItem(선수별 필살기 아이템)·fmItem(팀 포메이션 아이템)을 담는다(선택 칸, TEAM_VERSION 그대로).
//   그 칸이 없는 옛 슬롯(arts 만 있는 것)은 쓸 때 도전 저장과 같은 이관 규칙(stats.js migrateWorn)으로 바꿔 읽고 저장된 칸은 고치지 않는다(B92 방식)
import { STAT_KEYS, displayCast, originalOf, cloneOf, trainCapOf, grantedModel, grantOf, teamArtifactsOn } from './catalog.js';
import { computeTeam, toEngine, cleanSpecials, initialSpecials, migrateWorn } from './stats.js';
import { permLvOfSaved } from './save.js';

export const TEAM_SLOTS = ['recent', 'best'];
export const TEAM_VERSION = 1; // 슬롯 한 칸의 형식 번호(영구 저장 PROFILE_VERSION 과 별개. 더 새 번호의 칸은 읽지 않고 버린다)
const SEG_MAX = 1000000, TRAIN_MAX = 255, PLAYER_IDX_MAX = 6, TEAM_ID_MAX = 255; // 안전 상한(저장값이 터무니없을 때. 실제 선수 존재 여부는 versusOptions 가 엔진 데이터로 본다)

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const nat = (v, d = 0) => (Number.isInteger(v) && v >= 0 ? v : d);

/**
 * run_config.json versusTeam(D33·D35). 키가 없거나 enabled 가 true 가 아니면 null = 꺼짐(슬롯을 새로 저장하지 않고 컴퓨터 대전에서 고를 수도 없다 = 종전 동작. 이미 저장된 슬롯은 지우지 않는다).
 * surviveUsesPerMatch = 그 팀으로 치르는 대전 한 경기에서 치사 생존(P10)이 발동하는 횟수의 팀 합계 상한(0 = 끔). 생략하면 1. 사람끼리 경기에서는 좌석(팀)마다 따로 센다.
 * humans = 사람끼리 방(방장이 규칙 「불꽃 팀」을 켠 방)에서도 고를 수 있는가(analysis/39 D53). true 가 아니면 꺼짐 = 1차 동작(컴퓨터 대전 방만)
 */
export const versusTeamCfg = (cat) => {
  const V = cat.cfg.versusTeam;
  return V?.enabled === true ? { surviveUses: Number.isInteger(V.surviveUsesPerMatch) && V.surviveUsesPerMatch >= 0 ? V.surviveUsesPerMatch : 1, humans: V.humans === true } : null;
};

/**
 * 슬롯 한 칸 검증·정규화(저장할 때와 읽을 때 같은 함수 -> 저장한 값은 다시 읽어도 같은 값이다). 쓸 수 없으면 null.
 * 카탈로그(아이템·아티팩트·오리지널·클론·포메이션·영구 성장)만 본다. 엔진 데이터(선수·필살기 ID 범위)는 versusOptions 가 본다
 */
export function sanitizeTeam(cat, raw, legacyPerm = false) {
  if (!isObj(raw) || nat(raw.v, 1) > TEAM_VERSION || !Array.isArray(raw.roster) || raw.roster.length !== cat.rules.team.players) return null;
  const who = new Set(), origSeen = new Set(), cloneSeen = new Set(), roster = [], spSeen = new Set();
  for (const r of raw.roster) {
    if (!isObj(r) || !isObj(r.from) || !Number.isInteger(r.from.team) || r.from.team < 0 || r.from.team > TEAM_ID_MAX || !Number.isInteger(r.from.idx) || r.from.idx < 0 || r.from.idx > PLAYER_IDX_MAX) return null;
    const key = `${r.from.team}:${r.from.idx}`;
    if (who.has(key)) return null;
    who.add(key);
    // orig·clone: 도전 저장(save.js sanitizeRun)과 같은 규칙. 정의에 있고 그 정의의 몸이 이 칸의 from 과 같고 한 번만 나올 때만 남긴다(아니면 표시만 버린다 = 그 몸의 원작 선수로 읽힌다)
    const od = typeof r.orig === 'string' ? cat.original?.byId.get(r.orig) : null;
    const orig = od && od.base.team === r.from.team && od.base.idx === r.from.idx && !origSeen.has(od.id) ? od.id : null;
    if (orig) origSeen.add(orig);
    const cd = !orig && typeof r.clone === 'string' ? cat.pool?.byId.get(r.clone) : null;
    const clone = cd && cd.body.team === r.from.team && cd.body.idx === r.from.idx && !cloneSeen.has(cd.id) ? cd.id : null;
    if (clone) cloneSeen.add(clone);
    const lost = !orig && !clone && (r.lost === true || typeof r.orig === 'string' || typeof r.clone === 'string'); // 표시가 무효가 된 칸: 고유 슛 없음(save.js 와 같은 규칙, 정검수 L1)
    const train = {};
    for (const k of STAT_KEYS) if (Number.isInteger(r.train?.[k]) && r.train[k] > 0) train[k] = Math.min(r.train[k], trainCapOf(cat, k) ?? TRAIN_MAX); // 특훈 누적 상한(D31, run_config training.maxPerStat)으로 자른다. 표에 없는 능력치는 안전 상한(리뷰 L2). 상한 도입 전에 넘겨 쌓은 구 도전의 팀도 슬롯에서는 상한까지만이다
    const equip = {};
    for (const slot of cat.slots) {
      const e = r.equip?.[slot], def = isObj(e) ? cat.items.get(e.id) : null;
      equip[slot] = def && def.slot === slot ? { id: def.id, lv: Math.min(nat(e.lv), cat.upgrade.maxLevel) } : null; // 없어진 아이템·다른 슬롯의 아이템: 그 칸만 비운다
    }
    const spOk = (id) => Number.isInteger(id) && id >= 0 && !cat.excludedShots.has(id);
    const sp = [0, 1].map((k) => (spOk(r.sp?.[k]) ? r.sp[k] : null));
    if (sp[0] !== null && sp[0] === sp[1]) sp[1] = null;
    const spItem = typeof r.spItem === 'string' && grantOf(cat, r.spItem)?.kind === 'shot' && !spSeen.has(r.spItem) ? r.spItem : null; // 선수별 필살기 아이템(off, 선택 칸). 한 아이템은 한 선수만
    if (spItem) spSeen.add(spItem);
    roster.push({ from: { team: r.from.team, idx: r.from.idx }, ...(orig ? { orig } : {}), ...(clone ? { clone } : {}), ...(lost ? { lost: true } : {}), recruited: r.recruited === true, train, equip, sp, ...(spItem ? { spItem } : {}) });
  }
  const arts = Array.from({ length: cat.rules.team.artifactSlots }, (_, i) => (cat.artifacts.has(raw.arts?.[i]) ? raw.arts[i] : null));
  for (let i = 0; i < arts.length; i++) if (arts[i] && arts.indexOf(arts[i]) !== i) arts[i] = null;
  const perm = {};
  // 영구 성장 A 단계: 받아 주는 상한은 cat.permCap(이미 산 효과 보존, D50). legacyPerm = 옛 표(perm_upgrades version 1) 영구 저장에 들어 있던 슬롯 -> 단계를 새 표로 환산(save.js permLvOfSaved)
  if (isObj(raw.perm)) for (const u of cat.perm.values()) { const l = u.group === 'A' ? permLvOfSaved(cat, u.id, raw.perm[u.id], legacyPerm) : 0; if (l) perm[u.id] = l; }
  return {
    v: TEAM_VERSION, at: nat(raw.at), diff: nat(raw.diff), seg: Math.min(Math.max(nat(raw.seg, 1), 1), SEG_MAX), wins: nat(raw.wins),
    ...(typeof raw.origTeam === 'string' && raw.origTeam === cat.original?.id ? { origTeam: raw.origTeam } : {}), // 팀 id 만(팀명은 저장하지 않는다)
    fm: cat.tagOfFm.has(raw.fm) ? raw.fm : cat.cfg.formation.default, arts, perm, roster,
    ...(typeof raw.fmItem === 'string' && grantOf(cat, raw.fmItem)?.kind === 'formation' ? { fmItem: raw.fmItem } : {}), // 팀 포메이션 아이템(off, 선택 칸)
  };
}

/** 영구 저장의 teams 칸 검증. 쓸 수 있는 슬롯이 하나도 없으면 undefined(칸 자체를 두지 않는다 = 이 기능 전의 저장과 같은 모양) */
export function sanitizeTeams(cat, raw, legacyPerm = false) {
  if (!isObj(raw)) return undefined;
  const out = {};
  for (const slot of TEAM_SLOTS) { const t = sanitizeTeam(cat, raw[slot], legacyPerm); if (t) out[slot] = t; }
  return Object.keys(out).length ? out : undefined;
}

/**
 * 도전 종료 시점의 팀 -> 슬롯 한 칸(run.js settle 이 부른다. run 을 고치지 않는다).
 * @param {{seg:number, wins:number, now:number}} o seg = 도달 구간(1부터), wins = 그 도전의 승수
 */
export function snapshotOf(cat, run, profile, o) {
  const inst = new Map(run.items.map((it) => [it.inst, it]));
  return sanitizeTeam(cat, {
    v: TEAM_VERSION, at: o.now, diff: run.diff, seg: o.seg, wins: o.wins, origTeam: run.origTeam, fm: run.fm, arts: run.artifacts.slice(), fmItem: run.fmItem ?? null, perm: { ...profile.perm },
    roster: run.roster.map((r) => ({
      from: { ...r.from }, orig: r.orig, clone: r.clone, lost: r.lost, recruited: r.recruited === true, train: { ...r.train }, sp: r.sp.slice(), spItem: r.spItem,
      equip: Object.fromEntries(cat.slots.map((s) => { const it = inst.get(r.equip?.[s]); return [s, it ? { id: it.id, lv: it.lv } : null]; })),
    })),
  });
}

/** 한 칸의 표시 이름: 오리지널·클론 = 이름 문자열, 원작 선수 = '@팀:번호'(순위표 핵심 3명과 같은 표기 -> 화면이 이름으로 푼다, 39 B40) */
const nameOf = (cat, r) => originalOf(cat, r)?.name ?? cloneOf(cat, r)?.name ?? `@${r.from.team}:${r.from.idx}`;

/**
 * 슬롯 요약(flame_state.profile.teams[slot], room.slots[0].flameTeam). 재료·능력치는 싣지 않는다.
 * core = 라인업 0~2번 칸 이름, team = 오리지널 팀으로 시작한 도전이면 {id, name, short}(아니면 null), captain = 주장 칸의 몸 {team, idx}(= 대기실 좌석 팀 표시 fallback)
 */
export function teamSummary(cat, t) {
  if (!t) return null;
  const O = cat.original;
  return { seg: t.seg, wins: t.wins, diff: t.diff, at: t.at, core: t.roster.slice(0, 3).map((r) => nameOf(cat, r)), team: O && t.origTeam === O.id ? { id: O.id, name: O.name, short: O.short } : null, captain: { ...t.roster[0].from } };
}

/**
 * 컴퓨터 대전용 조립(D34~D36): 슬롯 한 칸(sanitizeTeam 을 거친 값) -> 엔진 flame 옵션(좌석 0, PROTOCOL §12.1) + 표시용 cast.
 * 능력치는 여기서 지금 데이터로 다시 계산한다(computeTeam 9단계. 다음 경기 소모품 없음, 보스전 한정 효과 없음). 시작 HP = 최대 HP(hp 칸을 최대값으로 준다).
 * 치사 생존(P10): 도전에서는 도전당 횟수지만 대전에는 도전이 없다 -> 경기마다 새로 세고 팀 합계를 cfg.surviveUses 로 자른다(라인업 앞 선수부터. 0 이면 발동하지 않는다).
 * 엔진 데이터에 없는 선수가 있으면 null(그 슬롯은 쓸 수 없다). 엔진 데이터에 없는 필살기 ID 는 그 슬롯 칸만 비운다
 * 필살기 부여 구조(D38): 저장된 슬롯 값을 쓸 때마다 선수별 발동 가능 집합으로 정리한다(cleanSpecials: 변경 전에 저장된 팀의 불씨·클론 필살기는 비고 원작 선수의 고유 슛은 남는다). allow 에는 원작 선수의 고유 슛이 든다(computeTeam).
 *   저장된 칸 자체는 고치지 않는다(sanitizeTeam 은 엔진 데이터를 모른다) -> 스위치를 legacy 로 되돌리면 종전 값이 그대로 쓰인다
 * @returns {{flame:object, cast:object, bodyTeams:number[]}|null} bodyTeams = 로스터 7칸의 몸 출처 팀(상대 팀 고를 때 제외, D36)
 */
export function versusOptions(cat, data, t, cfg = versusTeamCfg(cat), seat = 0) { // seat = 엔진 flame 옵션의 좌석(사람끼리 방의 좌석 1, D53). 생략 = 0(1차와 같다)
  if (!t || !cfg) return null;
  if (t.roster.some((r) => !data.teams[r.from.team]?.players?.[r.from.idx])) return null;
  const nSp = data.specials.power.length, items = [];
  const roster = t.roster.map((r) => {
    const equip = {};
    for (const slot of cat.slots) {
      const e = r.equip[slot];
      if (e) { items.push({ inst: items.length + 1, id: e.id, lv: e.lv }); equip[slot] = items.length; } else equip[slot] = null;
    }
    return { from: { ...r.from }, ...(r.orig ? { orig: r.orig } : {}), ...(r.clone ? { clone: r.clone } : {}), ...(r.lost ? { lost: true } : {}), recruited: r.recruited, train: { ...r.train }, equip, sp: r.sp.map((id) => (id !== null && id < nSp ? id : null)), ...(r.spItem ? { spItem: r.spItem } : {}) };
  });
  const teamOn = teamArtifactsOn(cat);
  let fmItem = t.fmItem ?? null;
  if (!teamOn && !fmItem && !roster.some((r) => r.spItem)) fmItem = migrateWorn(cat, roster, t.arts, t.fm); // off: 옛 슬롯(arts 만)은 쓸 때 이관해 읽는다(저장된 칸은 그대로)
  cleanSpecials(cat, data, roster, t.arts);
  // 도전의 아티팩트 장착 뒤 정리(items.js syncSpecials)와 같은 결과로 맞춘다(정검수 L2): 주 슬롯이 비고 예비 슬롯에 슛이 남았으면 올리고, 그래도 빈 선수(불씨·클론)는 낀 필살기 아이템의 첫 대표 슛을 받는다.
  // 슬롯에 저장된 칸은 고치지 않는다(B92). 종전(legacy)에서는 아무것도 하지 않는다
  if (grantedModel(cat) && teamOn) for (const r of roster) { if (r.sp[0] === null && r.sp[1] !== null) r.sp = [r.sp[1], null]; if (r.sp[0] === null) r.sp = initialSpecials(cat, data, r, t.arts); }
  const team = computeTeam(cat, data, { roster, items, artifacts: t.arts, fmItem, fm: t.fm, perm: t.perm, buffs: [], nodeType: null, surviveCount: 0 });
  let surviveLeft = cfg.surviveUses;
  const engine = roster.map((r, i) => {
    const pl = team.players[i], e = toEngine(pl);
    e.fx.survive = Math.min(e.fx.survive, surviveLeft); surviveLeft -= e.fx.survive;
    return { from: { ...r.from }, stat: e.stat, hp: pl.final.s0, ext: e.ext, sp: r.sp.slice(), fx: e.fx };
  });
  return {
    flame: { seat, roster: engine, allow: team.allow, families: cat.families, fm: team.fm, caps: { ...cat.engineCaps } },
    cast: displayCast(cat, { origTeam: t.origTeam, roster }), // 화면 표시용(game_start.flameCast). 엔진에는 넘기지 않는다
    bodyTeams: [...new Set(roster.map((r) => r.from.team))],
  };
}
