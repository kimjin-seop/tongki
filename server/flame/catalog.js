// 불꽃의 계승 데이터 카탈로그: server/flame/data/*.json 을 한 번 읽어 검증하고 ID 조회 표를 만든다(PROTOCOL §13, analysis/38).
// 규칙: 기획서에 수치가 없어 null 인 값은 같은 객체의 proposed([자작 제안])를 읽는다 -> pv(). 코드에는 밸런스 숫자를 두지 않는다.
// 엔진(server/engine)은 이 파일을 읽지 않는다. 엔진에 넘길 계열표·상한은 run.js 가 여기서 꺼내 flame 옵션으로 넘긴다.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const FILES = ['rules', 'economy', 'decisions', 'nodes', 'perm_upgrades', 'items_equipment', 'artifacts', 'consumables', 'synergies', 'formation_tags', 'shot_families', 'run_config'];
/** 없어도 되는 파일(없으면 그 기능이 꺼진다): 오리지널 팀(D17), 영입 풀(D18. 생성 도구 tools/gen_recruit_pool.mjs 가 쓴다). 이 파일이 생기기 전의 데이터 폴더(--data 비교용 사본)도 그대로 읽힌다 */
const OPTIONAL_FILES = ['original_team', 'recruit_pool', 'endless'];

export const STAT_KEYS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 'r1', 'r2', 'r3'];
/** s0~s7 -> 엔진 능력치 이름(teams.json players[] 의 키) */
export const ENGINE_STAT = { s0: 'hp', s1: 'def', s2: 'spd', s3: 's3', s4: 'pow', s5: 's5', s6: 'thr', s7: 'pass' };

/** 효과 파라미터: 확정값이 null 이면 proposed([자작 제안]) */
export const pv = (e, k) => e?.params?.[k] ?? e?.proposed?.[k] ?? null;

/**
 * 반올림 통일(기획 §14.2): n/d 를 half-up 으로 정수화. 강화 보너스·포메이션/시너지 강화 배율·비용 할인 모두 이 함수만 쓴다.
 * 음수는 0 쪽으로 대칭(-1.5 -> -2)이 아니라 수학적 half-up(floor(x + 0.5))이다. 지금 쓰는 곳은 전부 0 이상이다
 */
export const roundHalfUp = (n, d = 1) => Math.floor((2 * n + d) / (2 * d));

const bad = (m) => { throw new Error('flame catalog: ' + m); };

/**
 * flame_catalog 메시지 형식 개정 번호. 데이터(_meta.version)는 그대로인데 메시지에 칸이 늘면 올린다 -> cat.ver 가 바뀌어
 * 클라이언트가 localStorage 에 둔 옛 카탈로그를 버리고 다시 받는다. 2 = afterWinHealPct 추가, 3 = economy.coin.proposed(defeatOutCoin·defeatOutCoinMax, D16) 추가(economy.json 의 _meta.version 은 cat.ver 에 들지 않는다),
 * 4 = original(오리지널 팀 정의, D17·D20·D21) 추가. original_team.json 의 _meta.version 은 cat.ver 에 `.o<버전>` 으로 든다(파일이 없으면 그 칸도 없다),
 * 5 = original.players[].base(능력치 출처 선수 = 도감·seen.players 의 키) 추가,
 * 6 = recruit(영입 풀 요약: 켜짐·풀 ID·인원·등급 순서, D18·D22) 추가. recruit_pool.json 의 _meta.version 은 cat.ver 에 `.p<버전>` 으로 든다(파일이 없으면 그 칸도 없다). 풀 선수 명단은 메시지에 싣지 않는다,
 * 7 = endless(엔드리스 요약, D24) 추가 + flame_state.run 의 구간 표시 칸(segNo·endless·championed, segments·matchesTotal 은 엔드리스에서 null)·cast.players[i].sp(클론 기본 필살기). endless.json 의 _meta.version 은 켜져 있을 때 cat.ver 에 `.e<버전>` 으로 든다
 * 8 = practice(연습 경기 요약, D28) 추가 + flame_state 의 profile.practiceUsed·run.practiceAvailable. run_config.json 의 _meta.version 은 올리지 않았다(키 하나만 더했다)
 * 9 = recruitRoomHealPct(영입실 입장 회복 %, D29) 추가 + flame_state 의 run.recruitHeal·profile.codexCast(도감 클론 정의). run_config.json 의 _meta 는 고치지 않았다(키 하나만 더했다)
 * 10 = afterBossHealPct(구간 보스 승리 뒤 회복 %, D30)·training.maxPerStat(특훈 누적 상한, D31) 추가 + flame_result.practiceRefunded(연습 경기 오류 종료 복구). difficulty[].cpuLevelAdd 는 숫자 또는 {normal,strong,boss}(D32). run_config.json 의 _meta 는 고치지 않았다
 */
export const CATALOG_MSG_REV = 10;

const pctOn = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
/**
 * 승리 뒤 전원 회복 %(analysis/39 D15·D30). nodeType 이 'boss' 이고 run_config.json rest.afterBossHealPct 가 숫자(0 이상)면 그 값(0 = 보스 뒤 회복 없음),
 * 그 밖(일반·강팀 승리, 또는 그 키가 없음)은 rest.afterWinHealPct. 없거나 0 이하·숫자가 아니면 0 = 꺼짐
 */
export const afterWinHealPct = (cat, nodeType = null) => {
  const R = cat.cfg.rest, b = R?.afterBossHealPct;
  return nodeType === 'boss' && Number.isFinite(b) && b >= 0 ? b : pctOn(R?.afterWinHealPct);
};

/**
 * 특훈 누적 상한(run_config.json training.maxPerStat, analysis/39 D31): 선수 한 명이 한 능력치에 특훈(특훈장 + 이벤트 trainRandom)으로 쌓을 수 있는 합. 키가 없는 능력치·키 자체가 없으면 null = 상한 없음(종전 동작).
 * statCaps(최종 능력치 상한, stats.js)와 별개다: 이쪽은 roster[i].train[stat] 만 본다
 */
export const trainCapOf = (cat, stat) => { const v = cat.cfg.training?.maxPerStat?.[stat]; return Number.isInteger(v) && v >= 0 ? v : null; };
/** 그 선수가 그 능력치 특훈을 value 만큼 더 받을 수 있는가(상한이 없으면 언제나 참). 이미 상한을 넘은 구 저장은 거절만 하고 깎지 않는다 */
export const canTrain = (cat, r, stat, value) => { const cap = trainCapOf(cat, stat); return cap === null || (r.train?.[stat] ?? 0) + value <= cap; };

/**
 * 난이도의 상대 레벨 가산(run_config.json difficulty[].cpuLevelAdd, D32): 숫자 = 모든 경기 종류에 같은 값(종전), {normal, strong, boss} = 종류별(없는 종류는 0). 없는 난이도·잘못된 값은 0
 */
export const cpuLevelAddOf = (cat, diff, type) => {
  const a = cat.cfg.difficulty.find((d) => d.id === diff)?.cpuLevelAdd;
  const v = a !== null && typeof a === 'object' ? a[type] : a;
  return Number.isInteger(v) ? v : 0;
};

/**
 * 영입실 입장 회복 %(run_config.json recruitRoom.healPct, analysis/39 D29 [자작 제안]). 키가 없거나 0 이하·숫자가 아니면 0 = 꺼짐(종전 동작: 영입실은 회복하지 않는다)
 */
export const recruitRoomHealPct = (cat) => { const v = cat.cfg.recruitRoom?.healPct; return Number.isFinite(v) && v > 0 ? v : 0; };

/** 도감 선수 키 중 영입 풀 클론 키('c:<풀 id>', D23)의 풀 id. 클론 키가 아니면 null */
const codexCloneId = (key) => (typeof key === 'string' && key.startsWith('c:') ? key.slice(2) : null);

/**
 * 도감의 클론 키에 붙일 표시용 정의(flame_state.profile.codexCast, PROTOCOL §13.16): { 'c:c012': {id, kind:'clone', name, role, grade, skin{team,idx,uni,hair}, retired?} }.
 * 영구 저장의 도감(profile.codex.players)에 적힌 클론만 싣는다(풀 전체를 보내지 않는다) -> 칸 수 상한 = 풀 인원(recruit_pool.json players 수). 풀에서 없어진 id 는 싣지 않는다(화면은 정의 없는 키로 다룬다).
 * 원작 선수 키('팀:번호')는 여기 없다: 화면이 종전대로 이름표에서 찾고, 시작 7명은 flame_catalog.original.players[].base 로 찾는다
 */
export function codexCast(cat, keys) {
  const out = {};
  for (const key of Array.isArray(keys) ? keys : []) {
    const cl = cat.pool?.byId.get(codexCloneId(key));
    if (cl) out[key] = { id: cl.id, kind: 'clone', name: cl.name, role: cl.role, grade: cl.grade, skin: { ...cl.skin }, ...(cl.retired ? { retired: true } : {}) };
  }
  return out;
}

/**
 * 연습 경기(run_config.json practice, analysis/39 D28)가 켜져 있는가. 키가 없거나 enabled 가 true 가 아니면 꺼짐 = 종전 동작(연습 경기 없음).
 * cpuLevel 을 생략하면 구간 1 일반 경기의 상대 레벨(난이도 가산 전)을 쓴다
 */
export const practiceCfg = (cat) => {
  const P = cat.cfg.practice;
  return P?.enabled === true ? { cpuLevel: Number.isInteger(P.cpuLevel) ? P.cpuLevel : cat.cfg.opponents.segments[0].cpuLevel.normal } : null;
};

let cache = null;

/** @param {{dir?:string, data?:object}} o data = 엔진 데이터(loadData()). 주면 선수·필살기·포메이션 참조까지 검증한다 */
export function loadCatalog(o = {}) {
  if (!o.dir && cache) return cache;
  const dir = o.dir ?? DIR, raw = {};
  for (const f of FILES) {
    try { raw[f] = JSON.parse(readFileSync(path.join(dir, f + '.json'), 'utf8')); } catch (e) { bad(`${f}.json 읽기 실패: ${e.message}`); }
  }
  for (const f of OPTIONAL_FILES) {
    const file = path.join(dir, f + '.json');
    if (!existsSync(file)) { raw[f] = null; continue; }
    try { raw[f] = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { bad(`${f}.json 읽기 실패: ${e.message}`); }
  }
  const cat = build(raw);
  if (!o.dir) cache = cat;
  return cat;
}

/**
 * 오리지널 팀(original_team.json, analysis/39 D17·D20·D21). 파일이 없으면 null.
 * start = decisions.json roster.startOriginal 이 이 팀을 가리킨다(새 도전의 시작 팀). 그 키를 지우면 start = false 로 종전(태동) 시작이고, 이미 저장된 오리지널 도전의 표시는 그대로 된다
 */
function buildOriginal(raw) {
  const O = raw.original_team, startId = raw.decisions.roster.startOriginal;
  if (!O) { if (startId !== undefined) bad(`decisions roster.startOriginal=${startId} 인데 original_team.json 이 없음`); return null; }
  const str = (v) => typeof v === 'string' && v.length > 0, pair = (v) => !!v && Number.isInteger(v.team) && v.team >= 0 && Number.isInteger(v.idx) && v.idx >= 0;
  for (const k of ['id', 'name', 'short', 'intro', 'protagonist']) if (!str(O[k])) bad(`original_team.${k}`);
  if (startId !== undefined && startId !== O.id) bad(`decisions roster.startOriginal=${startId} 가 original_team.id(${O.id})와 다름`);
  const nUni = O.skinSets?.uniforms, nHair = O.skinSets?.hairs, roles = new Set(raw.run_config.roles.map((r) => r.id));
  if (!Number.isInteger(nUni) || nUni < 1 || !Number.isInteger(nHair) || nHair < 0) bad('original_team.skinSets');
  if (!Array.isArray(O.players) || O.players.length !== raw.rules.team.players) bad(`original_team.players 는 ${raw.rules.team.players}명`);
  const byId = new Map(), bases = new Set(), bodies = new Set();
  const players = O.players.map((p, i) => {
    const w = `original_team.players[${i}]`;
    if (!str(p?.id) || byId.has(p.id)) bad(`${w}.id`);
    if (!str(p.name) || !str(p.tagline) || !roles.has(p.role)) bad(`${w} 이름·한 줄·역할`);
    if (!pair(p.base) || bases.has(`${p.base.team}:${p.base.idx}`)) bad(`${w}.base (없거나 중복)`);
    const k = p.skin;
    if (!pair(k) || bodies.has(`${k.team}:${k.idx}`)) bad(`${w}.skin 몸(없거나 중복)`);
    if (!Number.isInteger(k.uni) || k.uni < 1 || k.uni > nUni || !Number.isInteger(k.hair) || k.hair < 0 || k.hair > nHair) bad(`${w}.skin 색 세트 번호`);
    bases.add(`${p.base.team}:${p.base.idx}`); bodies.add(`${k.team}:${k.idx}`);
    const def = { id: p.id, name: p.name, role: p.role, tagline: p.tagline, base: { team: p.base.team, idx: p.base.idx }, skin: { team: k.team, idx: k.idx, uni: k.uni, hair: k.hair } };
    byId.set(p.id, def);
    return def;
  });
  if (players[raw.decisions.roster.captainSlot]?.id !== O.protagonist) bad('original_team.protagonist 는 주장 칸(captainSlot)의 선수여야 한다');
  return {
    version: O._meta?.version ?? 0, id: O.id, name: O.name, short: O.short, intro: O.intro, protagonist: O.protagonist, skinSets: { uniforms: nUni, hairs: nHair },
    locked: O.rules?.protagonistLocked === true, recruitExcludeSkinBodies: O.rules?.recruitExcludeSkinBodies === true,
    start: startId === O.id, players, byId,
  };
}

/** 영입 풀의 등급 순서(낮은 것부터). recruit_pool.json players[].grade·run_config.json recruit.clone.gradePct 의 열 순서 */
export const POOL_GRADES = ['D', 'C', 'B', 'A', 'S'];

/**
 * 영입 풀(recruit_pool.json, analysis/39 D18·analysis/42 §8). 파일이 없으면 null(= 종전 영입: 원작 선수만).
 * players[] = {id, name, given(이름 2자), role, grade, pts, stat(엔진 능력치 이름), base(s0~s7), sp, body{team,idx}, skin{team,idx,uni,hair}, retired}
 * body = 엔진 from(히트박스·손 위치·컴퓨터 표) 겸 그림. 능력치는 stat 이 덮는다(stats.js computeTeam 1단계)
 */
function buildPool(raw) {
  const P = raw.recruit_pool;
  if (!P) return null;
  const roles = new Set(raw.run_config.roles.map((r) => r.id)), M = P.model, byId = new Map(), names = new Set();
  if (!Array.isArray(P.players) || !M?.unit || !M?.anchor) bad('recruit_pool: players·model(unit·anchor) 없음');
  for (const k of Object.values(ENGINE_STAT)) if (!(M.unit[k] > 0) || !Number.isFinite(M.anchor[k])) bad(`recruit_pool.model: ${k} 단위·기준값`);
  const players = P.players.map((p, i) => {
    const w = `recruit_pool.players[${i}]`;
    if (typeof p?.id !== 'string' || !/^c\d{3,}$/.test(p.id) || byId.has(p.id)) bad(`${w}.id (형식 c001~ 또는 중복)`);
    if (typeof p.name !== 'string' || p.name.length < 2 || names.has(p.name)) bad(`${w}.name (없거나 중복)`);
    if (!roles.has(p.role) || !POOL_GRADES.includes(p.grade) || !Number.isInteger(p.sp)) bad(`${w} 역할·등급·필살기`);
    if (!Number.isInteger(p.body?.team) || !Number.isInteger(p.body?.idx) || !Number.isInteger(p.skin?.uni) || !Number.isInteger(p.skin?.hair)) bad(`${w} 몸·색 세트`);
    const stat = {}, base = {};
    for (const [k, ek] of Object.entries(ENGINE_STAT)) { if (!Number.isInteger(p.stat?.[ek]) || p.stat[ek] < (k === 's0' ? 1 : 0)) bad(`${w}.stat.${ek}`); stat[ek] = p.stat[ek]; base[k] = p.stat[ek]; }
    const def = { id: p.id, name: p.name, given: p.name.slice(1), role: p.role, grade: p.grade, pts: p.pts, stat, base, sp: p.sp, body: { team: p.body.team, idx: p.body.idx }, skin: { team: p.body.team, idx: p.body.idx, uni: p.skin.uni, hair: p.skin.hair }, retired: p.retired === true };
    byId.set(def.id, def); names.add(def.name);
    return def;
  });
  const byGrade = Object.fromEntries(POOL_GRADES.map((g) => [g, players.filter((p) => p.grade === g && !p.retired)]));
  return { version: P._meta?.version ?? 0, poolId: P._meta?.poolId ?? null, model: M, players, byId, byGrade, active: players.filter((p) => !p.retired).length };
}

/**
 * 엔드리스(endless.json, analysis/39 D24). 파일이 없거나 enabled 가 true 가 아니거나 환경 변수 FLAME_ENDLESS=0 이면 null = 종전 동작(구간 3 보스 승리 = 우승으로 도전 종료).
 * 켜져 있으면 rules.json run.segments 는 '우승 기준 구간'이고 도전은 패배·포기로만 끝난다. 구간 4 이상은 run_config 의 구간별 표 마지막 줄을 쓴다(segRow)
 */
function buildEndless(raw) {
  const E = raw.endless;
  if (!E || E.enabled !== true || process.env.FLAME_ENDLESS === '0') return null;
  const pos = (v, w, min = 1) => { if (!Number.isInteger(v) || v < min) bad(`endless.${w}`); return v; };
  return {
    version: E._meta?.version ?? 0,
    itemMax: pos(E.items?.max, 'items.max', raw.rules.team.players * raw.rules.team.equipmentSlotsPerPlayer), // 전원이 다 끼고도 남는 수 이상
    artifactFallbackPoints: pos(E.artifactFallbackPoints, 'artifactFallbackPoints', 0),
    rerollFrom: pos(E.rerollPerBoss?.fromSegment, 'rerollPerBoss.fromSegment'), rerollAdd: pos(E.rerollPerBoss?.add, 'rerollPerBoss.add', 0),
    shownMax: pos(E.recruitShownMax, 'recruitShownMax'), bossesKeep: pos(E.bossesKeep, 'bossesKeep'), rankTop: pos(E.ranking?.top, 'ranking.top'),
  };
}

/** 구간별 표(상대·보상 등급 보정·영입 확률)의 줄 번호: 표 길이를 넘는 구간(엔드리스 구간 4+)은 마지막 줄 고정 */
export const segRow = (rows, seg) => Math.max(0, Math.min(seg, rows.length - 1));

/** 구간별 표의 줄 수 검사: 종전 = 정확히 구간 수, 엔드리스 = 구간 수 이상(마지막 줄이 그 뒤 구간에 쓰인다) */
const segLenOk = (raw, n) => (raw.endless?.enabled === true ? n >= raw.rules.run.segments : n === raw.rules.run.segments);

/** run_config.json recruit 의 2차 키(clone·original) 형식 검사. 키가 없으면 종전 영입(원작 선수만) */
function checkRecruitCfg(raw) {
  const RC = raw.run_config.recruit, nSeg = raw.rules.run.segments, num = (v) => Number.isFinite(v) && v >= 0;
  if (RC.clone !== undefined) {
    const G = RC.clone?.gradePct;
    if (!Array.isArray(G) || !segLenOk(raw, G.length) || G.some((row) => !Array.isArray(row) || row.length !== POOL_GRADES.length || !row.every(num) || !row.some((v) => v > 0))) bad(`recruit.clone.gradePct 는 구간 ${nSeg}줄 × 등급 ${POOL_GRADES.length}칸`);
  }
  if (RC.original !== undefined) {
    const O = RC.original ?? {};
    if (!Array.isArray(O.visitPct) || !segLenOk(raw, O.visitPct.length) || !O.visitPct.every((v) => num(v) && v <= 100)) bad('recruit.original.visitPct');
    if (!Number.isInteger(O.maxPerVisit) || O.maxPerVisit < 0) bad('recruit.original.maxPerVisit');
    if (!Array.isArray(O.segmentTeams) || !segLenOk(raw, O.segmentTeams.length) || O.segmentTeams.some((row) => !Array.isArray(row) || !row.every(Number.isInteger))) bad('recruit.original.segmentTeams');
    if (O.minPts !== null && O.minPts !== undefined && !Number.isFinite(O.minPts)) bad('recruit.original.minPts');
  }
}

/** 영입 풀이 켜져 있는가(풀 파일 + run_config recruit.clone). 꺼져 있으면 영입 후보는 종전대로 원작 선수만 */
export const cloneRecruitOn = (cat) => !!cat.pool && !!cat.cfg.recruit.clone;

/** 로스터 한 칸(또는 영입 후보 한 칸)이 영입 풀 클론이면 그 정의(recruit_pool.json players[]), 아니면 null */
export const cloneOf = (cat, r) => (typeof r?.clone === 'string' ? cat.pool?.byId.get(r.clone) ?? null : null);

/** 원작 선수의 점수(42 §2.1 = Σ (능력치 − 기준값) ÷ 단위, 풀 파일의 model 기준). 풀이 없으면 null */
export function playerPts(cat, data, from) {
  const M = cat.pool?.model, src = data.teams[from.team]?.players?.[from.idx];
  if (!M || !src) return null;
  return Object.values(ENGINE_STAT).reduce((s, ek) => s + (src[ek] - M.anchor[ek]) / M.unit[ek], 0);
}

/**
 * 영입 후보 한 칸의 표시용 정의(flame_state.run.pending[].choices[], PROTOCOL §13.10). 저장에는 {team, idx, clone?, rare?} 만 있고 이 함수가 볼 때마다 채운다(풀 개정으로 능력치가 바뀌면 바로 반영).
 * 클론: team·idx = 몸(그림), kind 'clone'. 원작 선수: kind 'original'(rare = 희귀 발견 칸). stat = 기본 능력치 s0~s7(장비·영구 성장 전), sp = 기본 필살기 ID | null
 */
export function recruitView(cat, data, c) {
  const cl = cloneOf(cat, c);
  if (cl) return { team: cl.body.team, idx: cl.body.idx, kind: 'clone', id: cl.id, name: cl.name, role: cl.role, grade: cl.grade, stat: { ...cl.base }, sp: cl.sp, skin: { ...cl.skin } };
  const src = data.teams[c.team]?.players?.[c.idx], stat = {}, sp = data.specials.row[c.team]?.[c.idx];
  for (const [k, ek] of Object.entries(ENGINE_STAT)) stat[k] = src?.[ek] ?? 0;
  return { team: c.team, idx: c.idx, kind: 'original', rare: c.rare === true, stat, sp: Number.isInteger(sp) && sp >= 0 && !cat.excludedShots.has(sp) ? sp : null };
}

/** 새 도전의 시작 라인업: 오리지널 팀이 켜져 있으면 그 7명(D17. from = base, orig = 선수 id), 아니면 종전(태동 7명, D4). team = 오리지널 팀 id | null */
export function startLineup(cat) {
  const D = cat.decisions.roster, O = cat.original;
  if (O?.start) return { team: O.id, players: O.players.map((p) => ({ from: { ...p.base }, orig: p.id })) };
  return { team: null, players: D.startPlayers.map((idx) => ({ from: { team: D.startTeam, idx } })) };
}

/** 로스터 한 칸이 오리지널 선수면 그 정의(original_team.json players[]), 원작 선수면 null */
export const originalOf = (cat, r) => (typeof r?.orig === 'string' ? cat.original?.byId.get(r.orig) ?? null : null);

/** 그 칸이 교체할 수 없는 주인공인가(D20). rules.protagonistLocked 가 꺼져 있으면 언제나 false */
export const isLockedPlayer = (cat, r) => !!cat.original?.locked && originalOf(cat, r)?.id === cat.original.protagonist;

/**
 * 화면 표시용 정의(flame_state.run.cast·game_start.flameCast, PROTOCOL §13.8). 서버·엔진 계산에는 쓰지 않는다.
 * team = 도전의 팀(오리지널 팀으로 시작한 도전만, 아니면 null = 종전대로 주장 출신 팀), players = 라인업 순서 7칸(오리지널 선수 = 정의, 원작 선수 = null -> 화면이 from 으로 이름·얼굴을 찾는다)
 */
export function displayCast(cat, run) {
  const O = cat.original, team = O && run.origTeam === O.id ? { id: O.id, name: O.name, short: O.short, intro: O.intro } : null;
  return {
    team,
    players: run.roster.map((r) => {
      const d = originalOf(cat, r), cl = d ? null : cloneOf(cat, r);
      // 영입 풀 클론(D18): 이름·역할·등급·몸과 색 세트. 한 줄 소개는 없다(null). 원작 선수 칸은 종전대로 null
      // sp = 클론의 기본 필살기 ID(풀 정의). 새로고침 뒤에도 화면이 '원래 필살기'를 선택지로 낼 수 있게 싣는다(슬롯에서 뺀 뒤에는 roster[i].sp 로 알 수 없다)
      if (cl) return { id: cl.id, kind: 'clone', name: cl.name, role: cl.role, grade: cl.grade, tagline: null, skin: { ...cl.skin }, sp: cl.sp, protagonist: false, locked: false };
      return d ? { id: d.id, kind: 'starter', name: d.name, role: d.role, tagline: d.tagline, skin: { ...d.skin }, protagonist: d.id === O.protagonist, locked: isLockedPlayer(cat, r) } : null;
    }),
  };
}

function build(raw) {
  const byId = (arr, what) => {
    const m = new Map();
    for (const it of arr) { if (m.has(it.id)) bad(`${what} ID 중복 ${it.id}`); m.set(it.id, it); }
    return m;
  };
  const items = byId(raw.items_equipment.items, '장비'), artifacts = byId(raw.artifacts.items, '아티팩트'), consumables = byId(raw.consumables.items, '소모품');
  const R = raw.rules, cfg = raw.run_config, E = raw.economy;
  if (items.size !== R.team.equipmentSlotsPerPlayer * 10 || artifacts.size !== 30 || consumables.size !== 20) bad(`항목 수 ${items.size}/${artifacts.size}/${consumables.size} (40/30/20 이어야 함)`);
  for (const it of items.values()) {
    if (!R.equipmentSlots.includes(it.slot)) bad(`${it.id} slot ${it.slot}`);
    if (!R.rarity.order.includes(it.rarity)) bad(`${it.id} rarity ${it.rarity}`);
    for (const k of Object.keys(it.stats)) if (!STAT_KEYS.includes(k)) bad(`${it.id} stats.${k}`);
  }
  // 포메이션 패턴(0~14) -> 태그
  const tagOfFm = new Map();
  for (const t of raw.formation_tags.tags) for (const fm of t.mapping ?? []) { if (tagOfFm.has(fm)) bad(`포메이션 ${fm} 태그 중복`); tagOfFm.set(fm, t.id); }
  if (tagOfFm.size !== 15) bad(`포메이션 태그 매핑 ${tagOfFm.size}/15`);
  // 필살기 계열: families = 엔진 옵션용 {계열:[id]}, unlockIds = 아티팩트가 그 계열로 여는 ID(강위력은 불꽃·도끼 제외, 39 A2)
  const families = {}, unlockIds = {};
  for (const f of raw.shot_families.families) families[f.id] = [...(f.shotIds ?? [])];
  const excluded = new Set(raw.decisions.special.excludedShotIds);
  for (const f of raw.shot_families.families) {
    const cut = new Set((f.unlockExcludesFamilies ?? []).flatMap((x) => families[x] ?? bad(`${f.id}.unlockExcludesFamilies ${x}`)));
    unlockIds[f.id] = families[f.id].filter((id) => !cut.has(id) && !excluded.has(id));
  }
  for (const a of artifacts.values()) for (const f of a.unlockShotFamilies) if (!families[f]) bad(`${a.id} 계열 ${f} 없음`);
  for (const s of raw.synergies.synergies) for (const a of s.requires.artifacts) if (!artifacts.has(a)) bad(`${s.id} 조건 아티팩트 ${a} 없음`);
  // 영구 성장 17항목: A·B 는 perm_upgrades.json(B 는 proposed), C 는 run_config.json unlocks.content
  const perm = new Map();
  for (const u of raw.perm_upgrades.training) perm.set(u.id, { id: u.id, name: u.name, group: 'A', maxLevel: u.maxLevel, costs: u.costs, effect: u.effect });
  for (const u of raw.perm_upgrades.preparation) perm.set(u.id, { id: u.id, name: u.name, group: 'B', maxLevel: u.maxLevel, costs: u.costs ?? u.proposed.costs, effect: { key: u.effect.key, perLevel: u.effect.perLevel ?? u.proposed.perLevel } });
  for (const u of raw.perm_upgrades.content) {
    const c = cfg.unlocks.content[u.id] ?? bad(`run_config unlocks.content.${u.id} 없음`);
    perm.set(u.id, { id: u.id, name: u.name, group: 'C', maxLevel: c.maxLevel, costs: c.costs, grants: c.grants, unlock: u.unlock });
  }
  if (perm.size !== 17) bad(`영구 성장 ${perm.size}/17`);
  for (const u of perm.values()) if (!Array.isArray(u.costs) || u.costs.length !== u.maxLevel || u.costs.some((c) => !Number.isInteger(c) || c < 0)) bad(`${u.id} 비용 표`);
  for (const u of perm.values()) if (u.group === 'C' && u.grants.length !== u.maxLevel) bad(`${u.id} grants 길이`);
  // run_config 참조 검증
  const training = raw.nodes.trainingOptions.map((t) => ({ ...t, value: t.value ?? cfg.training.values[t.id] ?? bad(`특훈 ${t.id} 증가량 없음`) }));
  if (training.length !== 11) bad('특훈 11종');
  for (const a of [...cfg.unlocks.defaultArtifactsExcept, ...cfg.unlocks.content.PC03.grants.flatMap((g) => g.artifacts ?? [])]) if (!artifacts.has(a)) bad(`run_config 아티팩트 ${a} 없음`);
  const eventIds = new Set(cfg.events.map((e) => e.id));
  for (const g of cfg.unlocks.content.PC04.grants) for (const e of g.events ?? []) if (!eventIds.has(e)) bad(`run_config 이벤트 ${e} 없음`);
  const OPS = ['points', 'hpAll', 'hpAllPct', 'hpCaptain', 'trainRandom', 'gamble', 'gainEquipment', 'gainConsumable', 'gainArtifact'];
  for (const e of cfg.events) for (const c of e.choices) for (const op of c.ops) if (!OPS.includes(op.op)) bad(`${e.id} 이벤트 op ${op.op}`);
  if (cfg.practice !== undefined) { // 연습 경기(D28). 키가 없으면 꺼짐
    const P = cfg.practice;
    if (!P || typeof P.enabled !== 'boolean') bad('practice.enabled 는 true|false');
    if (P.cpuLevel !== undefined && !(Number.isInteger(P.cpuLevel) && P.cpuLevel >= 1 && P.cpuLevel <= cfg.opponents.cpuLevelMax)) bad(`practice.cpuLevel 은 1~${cfg.opponents.cpuLevelMax}`);
  }
  { // 보스 뒤 회복(D30)·특훈 누적 상한(D31)·난이도 레벨 가산(D32). 키가 없으면 종전 동작
    const B = cfg.rest?.afterBossHealPct, M = cfg.training?.maxPerStat;
    if (B !== undefined && !(Number.isFinite(B) && B >= 0 && B <= 100)) bad('rest.afterBossHealPct 는 0~100');
    if (M !== undefined && (!M || typeof M !== 'object' || Array.isArray(M) || Object.entries(M).some(([k, v]) => !STAT_KEYS.includes(k) || !Number.isInteger(v) || v < 0))) bad('training.maxPerStat 는 {능력치 키: 0 이상의 정수}');
    for (const d of cfg.difficulty) {
      const a = d.cpuLevelAdd, isObj = a !== null && typeof a === 'object' && !Array.isArray(a);
      if (!(Number.isInteger(a) || (isObj && Object.entries(a).every(([k, v]) => ['normal', 'strong', 'boss'].includes(k) && Number.isInteger(v))))) bad(`difficulty[${d.id}].cpuLevelAdd 는 정수 또는 {normal, strong, boss} 정수`);
    }
  }
  if (cfg.recruitRoom !== undefined) { // 영입실 입장 회복(D29). 키가 없으면 꺼짐
    const H = cfg.recruitRoom?.healPct;
    if (!cfg.recruitRoom || typeof cfg.recruitRoom !== 'object' || (H !== undefined && !(Number.isFinite(H) && H >= 0 && H <= 100))) bad('recruitRoom.healPct 는 0~100');
  }
  if (!segLenOk(raw, cfg.opponents.segments.length)) bad('opponents.segments 길이');
  if (!segLenOk(raw, cfg.reward.rarityShift.segment.length)) bad('reward.rarityShift.segment 길이');
  const tpl = raw.nodes.proposed.segmentTemplate;
  if (tpl.filter((s) => s.node).length !== raw.decisions.run.matchesPerSegment || tpl.at(-1).node !== 'boss') bad('구간 템플릿: 경기 수 또는 마지막 보스');
  if (R.run.segments * raw.decisions.run.matchesPerSegment !== R.run.matches) bad('총 경기 수');
  const rar = R.rarity.order;
  const price = E.shop.proposed, mp = E.matchPoints.proposed;
  const original = buildOriginal(raw), pool = buildPool(raw), endless = buildEndless(raw);
  checkRecruitCfg(raw);
  return {
    ver: `${raw.items_equipment._meta.version}.${raw.artifacts._meta.version}.${raw.consumables._meta.version}.${cfg._meta.version}${original ? `.o${original.version}` : ''}${pool ? `.p${pool.version}` : ''}${endless ? `.e${endless.version}` : ''}.m${CATALOG_MSG_REV}`,
    original, pool, endless, raw, rules: R, economy: E, decisions: raw.decisions, cfg, items, artifacts, consumables, perm, training,
    synergies: raw.synergies.synergies, applyDuplicates: raw.synergies._meta.proposed.applyDuplicates === true,
    tags: raw.formation_tags.tags, tagOfFm, families, unlockIds, excludedShots: excluded,
    template: tpl, slots: R.equipmentSlots, rarities: rar, rarityRank: Object.fromEntries(rar.map((r, i) => [r, i])),
    matchPoints: mp, coin: E.flameCoin, upgrade: E.upgrade,
    equipPrice: (id) => price.equipmentPrice[items.get(id).rarity],
    consumablePrice: (id) => price.consumablePrice.overrides[id] ?? price.consumablePrice.default,
    sellPrice: (id) => items.get(id).proposed.sellPrice,
    /** 엔진 옵션 caps(server/engine/flame.js FLAME_DEFAULTS 와 같은 키) */
    engineCaps: { r1MaxPct: R.clamps.r1MaxPct, r2MaxPct: R.clamps.r2MaxPct, r3MaxFrames: R.clamps.r3MaxShortenFrames, downFramesMin: R.clamps.downFramesMin, ...raw.decisions.engine },
  };
}

/** 엔진 데이터와의 참조 검증(서버 시작·시험에서 1회): 시작 선수·상대 팀·영입 풀·포메이션 패턴·필살기 ID */
export function checkAgainstEngine(cat, data) {
  const nT = data.teams.length, team = (t, w) => { if (!Number.isInteger(t) || t < 0 || t >= nT) bad(`${w}: 없는 팀 ${t}`); };
  team(cat.decisions.roster.startTeam, 'startTeam');
  // 오리지널 팀(D17·D21): base·skin 몸이 실제 선수이고, skin 몸의 몸통 분류가 base 와 같다(엔진 히트박스·손 위치는 base 기준이라 그림과 어긋나지 않게)
  for (const p of cat.original?.players ?? []) {
    for (const [w, v] of [['base', p.base], ['skin', p.skin]]) if (!data.teams[v.team]?.players?.[v.idx]) bad(`original_team ${p.id}.${w}: 없는 선수 ${v.team}:${v.idx}`);
    const cls = (v) => data.rom?.bodyClass?.[v.team]?.[v.idx];
    if (cls(p.base) !== cls(p.skin)) bad(`original_team ${p.id}: skin 몸통 분류(${cls(p.skin)})가 base(${cls(p.base)})와 다름`);
  }
  for (const s of cat.cfg.opponents.segments) for (const k of ['normal', 'strong', 'boss']) for (const t of [...s[k], ...(s.unlocked?.[k] ?? [])]) team(t, 'opponents');
  for (const t of [...cat.cfg.recruit.basePool, ...cat.cfg.recruit.excludeTeams, ...cat.cfg.unlocks.content.PC01.grants.flatMap((g) => g.recruitTeams ?? []), ...(cat.cfg.recruit.original?.segmentTeams ?? []).flat()]) team(t, 'recruit');
  // 영입 풀(D18): 몸이 실제 선수이고 기본 필살기가 쓸 수 있는 ID 다(표값 255·제외 ID 가 아니다)
  for (const p of cat.pool?.players ?? []) {
    if (!data.teams[p.body.team]?.players?.[p.body.idx]) bad(`recruit_pool ${p.id}.body: 없는 선수 ${p.body.team}:${p.body.idx}`);
    if (!(p.sp >= 0 && p.sp < data.specials.power.length) || data.specials.power[p.sp] === 255 || cat.excludedShots.has(p.sp)) bad(`recruit_pool ${p.id}.sp: 쓸 수 없는 필살기 ID ${p.sp}`);
  }
  const fms = new Set(data.formations.teams.map((t) => t.name_idx));
  for (const fm of cat.tagOfFm.keys()) if (!fms.has(fm)) bad(`포메이션 패턴 ${fm} 가 엔진 데이터에 없음`);
  if (!fms.has(cat.cfg.formation.default)) bad('formation.default');
  const pw = data.specials.power;
  for (const [f, ids] of Object.entries(cat.families)) for (const id of ids) if (!(id >= 0 && id < pw.length) || pw[id] === 255) bad(`계열 ${f}: 쓸 수 없는 필살기 ID ${id}`);
  return true;
}
