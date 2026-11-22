// 불꽃의 계승 요청 핸들러(PROTOCOL §13). Lobby.makeHandlers 에 섞여 this = Lobby 로 불린다(league/handlers.js 와 같은 형태).
// 저장은 this.flame(getProfile/getRun/save)만 쓴다. 경기 노드는 특훈·리그처럼 비공개 방을 만들어 바로 시작하고, 끝나면 방을 없앤다.
// 엔진 flame 옵션(roster·allow·caps)은 저장된 도전 상태에서 run.js matchOptions 가 조립한다. 클라이언트가 보낸 수치는 쓰지 않는다(번호·ID 만 받는다).
import { SAVE_VERSION, PROFILE_VERSION, FlameError, sanitizeProfile, sanitizeRun } from './save.js';
import { loadCatalog, checkAgainstEngine, cloneRecruitOn, practiceCfg, recruitRoomHealPct, afterWinHealPct, POOL_GRADES } from './catalog.js';
import { teamOfRun, grantShotOf } from './stats.js';
import { TEAM_SLOTS, SNAP_SLOTS, ENDED_SLOT, TEAM_NAME_MAX, versusTeamCfg, versusOptions, teamSummary, snapshotOf } from './teams.js';
import { cleanText, maskBadwords } from '../chat/chat.js';
import * as Items from './items.js';
import * as Nodes from './nodes.js';
import * as Run from './run.js';
import { ERR } from '../net/protocol.js';
import { loadData } from '../engine/data.js';

const SAVE_TRIES = 3; // 경기 결과 저장 시도 횟수(P2 리뷰 L5)

/** 카탈로그 준비(Lobby 생성 때 1회). 데이터가 깨져 있으면 기존 모드는 그대로 두고 flame 요청만 FLAME_UNAVAILABLE 로 거절한다 */
export function initFlameCatalog(data, log) {
  try { const cat = loadCatalog(); checkAgainstEngine(cat, data); return cat; }
  catch (e) { log?.('[flame] 데이터 오류로 불꽃의 계승을 끕니다:', e.message); return null; }
}

/** 클라이언트용 마스터 데이터(flame_catalog). 화면이 이름·효과·아이콘 경로를 그릴 때 쓴다. 수치 원본은 server/flame/data */
export function catalogMsg(cat, data = loadData()) {
  const R = cat.raw, M = cat.cfg.training.maxPerStat;
  return {
    t: 'flame_catalog', ver: cat.ver,
    // artifacts = 손으로 쓴 30종 + 규칙으로 만든 등급 아이템 248종(SP<슛>-<등급>·FM<패턴>-<등급>, D39). 등급 아이템의 칸: kind 'shot'|'formation', grant{shot}|{formation}, grade 'C'|'B'|'A'|'S'(이름·설명은 임시 문구 — 화면이 grant 로 슛·포메이션 이름을 붙인다)
    // artifact = 팀 공용 아티팩트 스위치(D58~D63, §13.26). model 'off' = 공용 3칸·A01~A30·시너지를 쓰지 않는다(필살슛 아이템은 선수마다 roster[i].spItem 1칸 = flame_sp_item, 포메이션 아이템은 팀 1칸 run.fmItem = flame_fm_item),
    //   'team' = 종전(flame_artifact 3칸). hiddenPerm = off 에서 영구 성장 상점에 내지 않는 항목, permText = off 에서 바뀐 영구 성장 설명(flame_state.profile.permList[].text 와 같다), refundPoints = 옛 도전의 A 번호 1개당 환급 포인트
    artifact: { model: cat.artifact.model, slots: cat.artifact.model === 'team' ? cat.rules.team.artifactSlots : 0, refundPoints: cat.artifact.refundPoints, hiddenPerm: cat.artifact.model === 'team' ? [] : cat.artifact.hiddenPerm.slice(), permText: cat.artifact.model === 'team' ? {} : { ...(cat.artifact.off?.permText ?? {}) } },
    equipment: R.items_equipment.items, artifacts: [...cat.artifacts.values()], consumables: R.consumables.items, synergies: R.synergies.synergies,
    formationTags: R.formation_tags.tags, shotFamilies: R.shot_families.families.map((f) => ({ id: f.id, name: f.name, unlockedBy: f.unlockedBy, shotIds: f.shotIds, unlockIds: cat.unlockIds[f.id] })),
    rarity: { ...cat.rules.rarity, letters: cat.grade.letters }, slots: cat.slots, stats: cat.rules.stats, clamps: cat.rules.clamps, nodeTypes: R.nodes.types,
    // 필살기 부여 구조(D38, §13.21, 표시용). model = 'granted'(선수에게 필살기가 없고 아티팩트가 부여한다. 원작 선수만 고유 슛 보유) | 'legacy'(종전: 원래 필살기 + 아티팩트 해금),
    // artifactShots = {아티팩트 id: 대표 슛 ID}(끼면 필살기 없는 선수의 빈 주 슬롯에 들어가는 슛. 필살기 아티팩트만 싣는다), slotRule = 발동 슬롯 규칙(D1)
    // power[슛 ID] = 슛별 기본 위력(server/data/specials.json power, 등급 가산 grade.spPow 등을 더하기 전 표값. 개정 19). 표값 255(일반 투구 계산값을 쓰는 ID)는 null.
    //   투구 속도는 슛별 표가 없다(던진 선수의 구속·차지·공중/대시 + 등급 spSpd 로 정해지고, 궤적 핸들러가 배수만 바꾼다) -> speed 칸은 싣지 않는다
    special: { model: cat.special.model, slotRule: cat.decisions.special.slotRule, artifactShots: Object.fromEntries([...cat.artifacts.keys()].map((a) => [a, grantShotOf(cat, a)]).filter(([, g]) => g !== null)), power: data.specials.power.map((v) => (v === 255 ? null : v)) },
    // 등급제(D39~D44, §13.22, 표시용). model 'v1' = 켜짐 | 'off' = 꺼짐(등급 아이템이 새로 나오지 않고 가산·상한·포메이션 아이템 규칙이 꺼진다). spPow = 등급별 필살 위력 가산(상한 밖, 전액), spOtherCap = 등급 가산을 뺀 그 밖의 필살 가산 합의 상한(null = 없음), spPowCap = 전체 안전 상한(표값 + 이 값, 캐치 직후 포함. D45), spSpd = 등급별 필살 투구 속도 가산(s6 단위 +4 = +0.25px/f, D52),
    // formation = {default: 기본 포메이션 패턴, stat: 등급별 팀 능력치 가산, tagPct: 태그 조건 보너스 배율 %, ampCapPct: 포메이션 강화 배율 합 상한}, drop = 출처별 등급 가중치·유형, price = 상점가·자동 판매가, equipmentLetters = 장비 등급 표기(rarity.letters 와 같다)
    grade: { model: cat.grade.model, grades: cat.grade.grades.slice(), spPow: cat.grade.spPow, spPowCap: cat.grade.spPowCap, spOtherCap: cat.grade.spOtherCap, spSpd: cat.grade.spSpd, formation: { default: cat.cfg.formation.default, ...cat.grade.formation }, drop: cat.grade.drop, price: cat.grade.price, equipmentLetters: cat.grade.letters },
    // maxPerStat = 특훈 누적 상한(D31, 선수·능력치별 roster[i].train[stat] 의 한도). 없는 능력치는 상한 없음, 키가 없으면 null(종전 동작)
    training: { options: cat.training, cost: cat.cfg.training.cost, picksPerVisit: cat.cfg.training.picksPerVisit, maxPerStat: M ? { ...M } : null },
    rest: cat.cfg.rest.options, afterWinHealPct: afterWinHealPct(cat), // 승리 뒤 전원 회복 %(D15). 꺼져 있으면 0
    afterBossHealPct: afterWinHealPct(cat, 'boss'), // 구간 보스 승리 뒤 전원 회복 %(D30, afterWinHealPct 대신 쓰인다). rest.afterBossHealPct 가 없으면 afterWinHealPct 와 같은 값
    recruitRoomHealPct: recruitRoomHealPct(cat), // 영입실 입장 전원 회복 %(D29). 꺼져 있으면 0
    events: cat.cfg.events.map((e) => ({ id: e.id, name: e.name, choices: e.choices.map((c) => ({ name: c.name, cost: c.cost ?? 0, ops: c.ops })) })),
    difficulty: cat.cfg.difficulty, roles: cat.cfg.roles, achievements: cat.cfg.achievements,
    // 연습 경기 요약(D28, 표시용). enabled = run_config.json practice 가 켜져 있는가(키가 없으면 false = 종전 동작), cpuLevel = 연습 상대 레벨(꺼져 있으면 null)
    practice: (() => { const P = practiceCfg(cat); return { enabled: !!P, cpuLevel: P ? P.cpuLevel : null }; })(),
    // 키운 팀 슬롯 요약(D33·D35, §13.20, 표시용). enabled = run_config.json versusTeam 이 켜져 있는가(꺼져 있으면 슬롯을 저장하지 않고 컴퓨터 대전에서 고를 수 없다),
    // slots = set_team{team:'flame:<슬롯>'} 에 쓰는 슬롯 이름, ruleMode = 그 팀을 쓸 수 있는 규칙, surviveUsesPerMatch = 대전 한 경기의 치사 생존(P10) 횟수(팀 합계)
    // humans = 사람끼리 방에서 방장이 규칙 「불꽃 팀」(rules.flameTeams)을 켤 수 있는가(D53). false 면 컴퓨터 대전 방만(1차)
    // 팀 스냅샷(B149): slots = 사용자 저장 칸 id(s1~s3), snapSlots = 칸 수(0 = 꺼짐), teamName = 팀 이름 {default: 기본 이름, max: 최대 글자 수}
    versusTeam: (() => { const V = versusTeamCfg(cat), teamName = { default: cat.original?.name ?? null, max: TEAM_NAME_MAX }; return V ? { enabled: true, slots: TEAM_SLOTS.slice(), snapSlots: TEAM_SLOTS.length, ruleMode: VERSUS_RULE_MODE, surviveUsesPerMatch: V.surviveUses, humans: V.humans, teamName } : { enabled: false, slots: [], snapSlots: 0, humans: false, teamName }; })(),
    // 엔드리스 요약(D24, 표시용). enabled = 무한 구간인가(꺼져 있으면 종전: 구간 championSegments 의 보스 승리에서 끝난다), championSegments = 우승 기준 구간 수,
    // itemMax = 장비 보유 상한(넘으면 받는 즉시 판매가만큼 포인트), artifactFallbackPoints = 아티팩트 고갈 때 보스 보상 대체 포인트, rerollFrom·rerollAdd = 그 구간 이상의 보스 격파마다 재선택 +n, rankTop = 순위표 줄 수
    endless: (() => {
      const E = cat.endless, n = cat.rules.run.segments;
      return E ? { enabled: true, championSegments: n, itemMax: E.itemMax, artifactFallbackPoints: E.artifactFallbackPoints, rerollFrom: E.rerollFrom, rerollAdd: E.rerollAdd, rankTop: E.rankTop } : { enabled: false, championSegments: n };
    })(),
    economy: { coin: cat.coin, matchPoints: cat.matchPoints, upgrade: cat.upgrade, consumables: cat.rules.consumables },
    perm: [...cat.perm.values()],
    // 영입 풀 요약(D18·D22·D23, 표시용). 풀 명단은 서버 전용이라 싣지 않는다(선수 정의는 flame_state 의 후보 칸·run.cast 로만 나간다).
    // clone = 영입 후보가 오리지널 클론 풀에서 나오는가(꺼져 있으면 종전대로 원작 선수만), count = 은퇴를 뺀 인원(도감의 클론 수 분모), grades = 등급 순서(낮은 것부터), rareOriginal = 원작 희귀 발견 칸이 켜져 있는가
    recruit: (() => {
      const on = cloneRecruitOn(cat), O = cat.cfg.recruit.original;
      return { clone: on, poolId: on ? cat.pool.poolId : null, poolVersion: on ? cat.pool.version : null, count: on ? cat.pool.active : 0, grades: POOL_GRADES.slice(), rareOriginal: on && !!O && O.maxPerVisit > 0 && O.visitPct.some((v) => v > 0) };
    })(),
    // 오리지널 팀 정의(D17·D20·D21, 표시용). 파일이 없으면 null. start = 새 도전이 이 팀으로 시작하는가, protagonistLocked = 주인공 교체 불가가 켜져 있는가.
    // players[].base = 능력치 출처 선수 {team, idx}. 도감·seen.players 의 키('팀:번호')가 base 라, 도전이 없을 때도 화면이 그 키에 오리지널 이름을 붙일 수 있다
    original: (() => {
      const O = cat.original;
      return O ? { id: O.id, name: O.name, short: O.short, intro: O.intro, protagonist: O.protagonist, start: O.start, protagonistLocked: O.locked, skinSets: { ...O.skinSets }, players: O.players.map((p) => ({ id: p.id, name: p.name, role: p.role, tagline: p.tagline, base: { ...p.base }, skin: { ...p.skin } })) } : null;
    })(),
  };
}

/** 키운 팀을 쓸 수 있는 규칙(D34): 체력제만. こうしき + flame 훅 조합은 측정한 적이 없다(analysis/43 §5) */
export const VERSUS_RULE_MODE = 'knockout';
const TEAM_REF = /^flame:([a-z0-9]+)$/;
const TEAM_NAME_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]+$/u; // 팀 이름 문자(B149): 닉네임 규칙(protocol.js NICK_RE) 문자 + 공백
/** set_team 의 team 값이 불꽃 팀 칸 참조('flame:s1' | 'flame:s2' | 'flame:s3')면 칸 id, 아니면 null(폐지된 'flame:recent'·'flame:best' 도 null = TEAM_INVALID, B149) */
export const flameTeamSlot = (v) => { const m = typeof v === 'string' ? TEAM_REF.exec(v) : null; return m && TEAM_SLOTS.includes(m[1]) ? m[1] : null; };

/**
 * 컴퓨터 대전 방의 불꽃 팀(D34, PROTOCOL §13.20): 그 세션의 영구 저장에서 슬롯을 읽어 엔진 flame 옵션·표시용 cast·요약을 조립한다. **읽기 전용이다**(저장·순위표·도전 상태를 건드리지 않는다).
 * 팀 선택(set_team)과 경기 시작(startGame) 두 곳에서 부른다 -> 경기는 언제나 시작 시점의 저장값과 지금 데이터로 다시 계산한 능력치로 열린다(클라이언트가 보낸 것은 슬롯 이름뿐이다).
 * 거절: FLAME_UNAVAILABLE(모드·기능 꺼짐), FLAME_SAVE_NEWER(더 새 형식의 영구 저장), FLAME_TEAM_NONE(슬롯 없음·읽지 못한 저장·쓸 수 없는 슬롯)
 * @returns {{slot:string, flame:object, cast:object, bodyTeams:number[], summary:object}}
 */
export function versusTeamOf(lobby, s, slot, fail, seat = 0) { // seat = 그 사람이 앉은 좌석(엔진 flame 옵션의 seat, D53)
  const cat = lobby.flameCat ?? fail('FLAME_UNAVAILABLE'), cfg = versusTeamCfg(cat) ?? fail('FLAME_UNAVAILABLE');
  if (!TEAM_SLOTS.includes(slot)) fail('TEAM_INVALID');
  const rp = lobby.flame.getProfile(s.key);
  if ((rp?.v ?? 0) > PROFILE_VERSION) fail('FLAME_SAVE_NEWER');
  // 가입 경합으로 남은 손님 세션은 그 계정 키의 팀을 쓰지 못한다(계정 키에 쓰지 않는 세션이 읽지도 않게)
  const t = rp && rp.unparsable !== true && !lobby.guestOfAccount(s) ? sanitizeProfile(cat, rp).teams?.[slot] : null;
  const o = versusOptions(cat, lobby.o.data, t, cfg, seat) ?? fail('FLAME_TEAM_NONE');
  return { slot, ...o, summary: teamSummary(cat, t) };
}

/** 저장한 뒤 도달 순위표의 그 계정 줄을 맞춘다(§13.13). 순위표 오류가 요청을 실패시키지 않게 삼킨다 */
function rankUpdate(lobby, s, profile) {
  try { lobby.flameRank?.update(s.key, s.nick, profile); } catch (e) { lobby.log('[flame] 순위표 갱신 실패', e?.message ?? e); }
}

export function makeFlameHandlers(fail) {
  /** 요청 공통: 빈도 제한 -> 카탈로그 -> 저장 읽기(sanitize). 서버 재시작 등으로 방이 사라진 '경기 중' 표시는 지운다(D6: 재경기) */
  const load = (lobby, s) => {
    lobby.flameRate(s);
    const cat = lobby.flameCat ?? fail('FLAME_UNAVAILABLE'), data = lobby.o.data;
    const rp = lobby.flame.getProfile(s.key), rr = lobby.flame.getRun(s.key);
    if ((rp?.v ?? 0) > PROFILE_VERSION || (rr?.v ?? 0) > SAVE_VERSION) fail('FLAME_SAVE_NEWER'); // 더 새 형식의 저장: 읽지도 덮어쓰지도 않는다. 영구 저장과 도전 저장은 형식 버전이 따로다(save.js)
    let why = null;
    const run = sanitizeRun(cat, data, rr, (w) => { why = w; });
    // 읽지 못한 저장(P2 리뷰 M1): 조용히 '없음'으로 두면 다음 저장이 원본을 지우거나 덮는다 -> 로그를 남기고 원본 행을 격리 키로 옮겨 보존한 뒤 진행한다.
    // 격리 키 `flame-broken:<키>:<시각>` 는 NICK_RE 에 ':' 가 없어 어떤 세션도 쓰지 못한다(guest-aside 와 같은 방식). 옮기지 못하면 요청을 거절한다(덮어쓰지 않는다)
    const bad = { profile: rp?.unparsable === true, run: rr != null && !run };
    if (bad.profile || bad.run) {
      const aside = `flame-broken:${s.key}:${Date.now()}`;
      lobby.log(`[flame] 읽지 못한 저장: key=${s.key} profile=${bad.profile ? 'unparsable' : 'ok'} run=${bad.run ? `${why ?? 'unparsable'} (id=${typeof rr?.id === 'string' ? rr.id : '?'}, v=${rr?.v ?? '?'})` : 'ok'} -> ${aside}`);
      if (!lobby.guestOfAccount(s)) { // 가입 경합으로 남은 손님 세션은 어차피 쓰지 않는다(원본 그대로)
        let moved = 0;
        try { moved = lobby.flame.quarantine?.(s.key, aside, bad) ?? 0; } catch (e) { lobby.log('[flame] 격리 실패', e?.message ?? e); }
        if (!moved) fail('FLAME_SAVE_BROKEN');
      }
    }
    const profile = sanitizeProfile(cat, bad.profile ? null : rp);
    const room = lobby.roomOf(s);
    if (run?.match && !(room?.flame && room.flame.runId === run.id && room.game)) run.match = null;
    return { cat, data, profile, run };
  };
  const save = (lobby, s, c) => {
    if (c.run) c.run.updatedAt = Date.now();
    if (!lobby.guestOfAccount(s)) { lobby.flame.save(s.key, s.nick, c.profile, c.run); rankUpdate(lobby, s, c.profile); } // 가입 경합으로 남은 손님 세션은 계정 키에 쓰지 않는다
  };
  const state = (lobby, s, c, extra = {}) => lobby.sendTo(s, { t: 'flame_state', catalogVer: c.cat.ver, ...Run.viewOf(c.cat, c.data, c.run, c.profile), ...extra });
  /** 도전 조작 공통: 방 안(경기 중)이 아니어야 하고 도전이 있어야 한다. fn 이 던진 FlameError 는 error{code} 로 나간다(상태는 저장하지 않는다) */
  const act = (lobby, s, fn, { needRun = true } = {}) => {
    const c = load(lobby, s);
    if (s.roomCode) fail('ALREADY_IN_ROOM');
    if (needRun && !c.run) fail('FLAME_NONE');
    let extra;
    try { extra = fn(c); if (c.run) Run.settleHp(c.cat, c.data, c.run, c.profile.perm); }
    catch (e) { if (e instanceof FlameError) fail(e.code, e.params); throw e; }
    save(lobby, s, c);
    state(lobby, s, c, extra ?? {});
    return c;
  };
  const endRun = (lobby, s, c, result, o = {}) => {
    const summary = Run.settle(c.cat, c.run, c.profile, result);
    if (o.replaced) summary.teamSave = false; // flame_new(리뷰 M): 곧 새 도전이 시작되고 종료 팀(ended)은 버려지므로 종료 화면에서 저장할 수 없다
    c.run = null;
    lobby.sendTo(s, { t: 'flame_end', summary });
  };

  return {
    flame_get(s) { const c = load(this, s); state(this, s, c); },
    flame_catalog(s) { this.flameRate(s); this.sendTo(s, catalogMsg(this.flameCat ?? fail('FLAME_UNAVAILABLE'), this.o.data)); },
    // 새 도전. 진행 중인 도전이 있으면 포기로 정산하고(코인 지급, 37 §3-C24) 새로 만든다('처음부터' 확인은 클라이언트가 한다)
    flame_new(s, m) {
      if (m.diff !== undefined && !Number.isInteger(m.diff)) fail('BAD_MESSAGE');
      act(this, s, (c) => {
        const next = Run.newRun(c.cat, c.data, c.profile, { diff: m.diff ?? 0, seed: this.o.flameSeed }); // 거절(잠긴 난이도)은 옛 도전을 정산하기 전에
        if (c.run) endRun(this, s, c, 'abandon', { replaced: true });
        if (c.profile.teams?.[ENDED_SLOT]) { const { [ENDED_SLOT]: _e, ...rest } = c.profile.teams; c.profile.teams = rest; } // eslint-disable-line no-unused-vars -- 새 도전을 시작하면 종료 화면 저장 재료는 버린다(B149)
        c.run = next;
      }, { needRun: false });
    },
    flame_abandon(s) { act(this, s, (c) => endRun(this, s, c, 'abandon')); },
    // 노드 선택. 경기 노드 = 비공개 방 생성 -> room_joined{room.flame} -> game_start{flame}. 그 밖 = flame_state(노드가 열린 상태)
    flame_node(s, m) {
      if (typeof m.id !== 'string') fail('BAD_MESSAGE');
      const c = load(this, s);
      if (s.roomCode) fail('ALREADY_IN_ROOM');
      if (!c.run) fail('FLAME_NONE');
      if (this.rooms.size >= this.limits.maxRooms) fail('TOO_MANY_ROOMS');
      let r;
      try { r = Run.enterNode(c.cat, c.data, c.run, c.profile, m.id); }
      catch (e) { if (e instanceof FlameError) fail(e.code, e.params); throw e; }
      save(this, s, c);
      if (!r.match) { state(this, s, c); return; }
      const o = r.match;
      const room = this.makeRoom(this.newCode(), true, o.cpuLevel, null, { ...o.rules });
      room.flame = { runId: c.run.id, node: o.node, type: o.type, stage: o.stage, opts: o.flame, cast: o.cast };
      room.cpuTeam = o.cpuTeam;
      this.join(s, room, o.flame.roster[0].from.team);
      try { this.startGame(room); }
      catch (e) { // 경기를 만들지 못함: 방을 치우고 '경기 중' 표시를 지운다(도전은 그대로, 같은 노드를 다시 고를 수 있다)
        this.log('[flame] 경기 시작 실패', e);
        room.game = null;
        if (this.roomOf(s) === room) this.removeFromRoom(s, 'leave');
        c.run.match = null; save(this, s, c);
        fail('INTERNAL');
      }
    },
    // 연습 경기(D28, §13.15): 첫 도전의 구간 1 첫 경기 전에 계정당 한 번. 비공개 방 생성 -> room_joined{room.flame:{node:null,type:'practice'}} -> game_start{flameCast.practice:true}.
    // 저장은 여기서 한 번뿐이다(한 번 소비 표시 profile.practiceUsed). 도전 상태(run)는 고치지 않고 '경기 중' 표시(run.match)도 세우지 않는다 -> 끝난 뒤에는 아무것도 저장하지 않는다(flameEnd)
    flame_practice(s) {
      const c = load(this, s);
      if (s.roomCode) fail('ALREADY_IN_ROOM');
      if (!c.run) fail('FLAME_NONE');
      if (this.guestOfAccount(s)) fail('FLAME_PRACTICE_NONE'); // 저장하지 않는 세션(가입 경합으로 남은 손님)은 소비 표시를 남길 수 없다 -> 주지 않는다
      if (this.rooms.size >= this.limits.maxRooms) fail('TOO_MANY_ROOMS');
      let o;
      try { o = Run.practiceOptions(c.cat, c.data, c.run, c.profile); }
      catch (e) { if (e instanceof FlameError) fail(e.code, e.params); throw e; }
      c.profile.practiceUsed = true;
      save(this, s, c);
      let room = null;
      try { // 방 생성·입장·경기 시작 어디서 실패해도 소비 표시를 되돌린다(리뷰 L1)
        room = this.makeRoom(this.newCode(), true, o.cpuLevel, null, { ...o.rules });
        room.flame = { runId: c.run.id, node: null, type: 'practice', practice: true, stage: o.stage, opts: o.flame, cast: o.cast };
        room.cpuTeam = o.cpuTeam;
        this.join(s, room, o.flame.roster[0].from.team);
        this.startGame(room);
      } catch (e) { // 경기를 만들지 못함: 방을 치우고 소비 표시를 되돌린다(다시 받을 수 있다)
        this.log('[flame] 연습 경기 시작 실패', e);
        if (room) room.game = null;
        if (room && this.roomOf(s) === room) this.removeFromRoom(s, 'leave');
        delete c.profile.practiceUsed; save(this, s, c);
        fail('INTERNAL');
      }
    },
    flame_leave(s) { act(this, s, (c) => Run.leaveNode(c.run)); },
    flame_choose(s, m) { act(this, s, (c) => { const note = Run.choose(c.cat, c.data, c.run, c.profile, m.i, m.p); return note ? { note } : undefined; }); },
    flame_reroll(s) { act(this, s, (c) => Run.reroll(c.cat, c.run, c.profile)); },
    // 장비: inst = 인스턴스 번호. inst 가 null 이면 slot 을 비운다
    flame_equip(s, m) { act(this, s, (c) => (m.inst === null || m.inst === undefined ? Items.unequip(c.cat, c.run, m.p, m.slot) : Items.equip(c.cat, c.run, m.p, m.inst))); },
    flame_auto_equip(s, m) { act(this, s, (c) => { Items.autoEquip(c.cat, c.run, m.p ?? null); }); },
    flame_upgrade(s, m) { act(this, s, (c) => { if (!Nodes.canUpgradeHere(c.cat, c.run)) throw new FlameError('FLAME_NOT_HERE'); Items.upgrade(c.cat, c.run, c.profile.perm, m.inst); }); },
    flame_sell(s, m) { act(this, s, (c) => { if (!c.cat.cfg.sell.anywhere && c.run.node?.type !== 'shop') throw new FlameError('FLAME_NOT_HERE'); Items.sell(c.cat, c.run, m.inst); }); },
    flame_artifact(s, m) { act(this, s, (c) => Items.setArtifact(c.cat, c.run, m.slot, m.id, c.data)); },
    // 선수별 필살기 아이템(off, §13.26): p = 선수 번호, id = 보유한 필살슛 아이템(SP<슛>-<등급>) | null(빼기). 다른 선수가 낀 아이템 FLAME_EQUIPPED, team 모델·잘못된 값 FLAME_INVALID
    flame_sp_item(s, m) { act(this, s, (c) => Items.setSpItem(c.cat, c.data, c.run, m.p, m.id ?? null)); },
    // 팀 포메이션 아이템(off, §13.26): id = 보유한 포메이션 아이템(FM<패턴>-<등급>) | null(빼기 = 기본 포메이션). team 모델·잘못된 값 FLAME_INVALID
    flame_fm_item(s, m) { act(this, s, (c) => Items.setFmItem(c.cat, c.run, m.id ?? null)); },
    flame_special(s, m) { act(this, s, (c) => Items.setSpecial(c.cat, c.data, c.run, m.p, m.sp)); },
    flame_formation(s, m) { act(this, s, (c) => Run.setFormation(c.cat, c.data, c.run, m.fm)); },
    flame_lineup(s, m) { act(this, s, (c) => Run.setLineup(c.run, m.order)); },
    flame_use(s, m) { act(this, s, (c) => Items.useConsumable(c.cat, c.run, m.c, m.p, teamOfRun(c.cat, c.data, c.run, c.profile.perm).players.map((p) => p.final.s0))); },
    flame_buy(s, m) { act(this, s, (c) => { const note = Nodes.buy(c.cat, c.run, m.i); return note ? { note } : undefined; }); }, // note.upgraded = 낮은 등급 자동 판매(§13.22)
    flame_train(s, m) { act(this, s, (c) => Nodes.train(c.cat, c.run, m.p, m.opt)); },
    // 팀 스냅샷(B149, §13.20): slot = 's1'|'s2'|'s3'. 진행 중인 도전이 있으면 그 도전의 지금 팀, 없으면 마지막으로 끝난 도전의 팀(teams.ended)을 그 칸에 덮어쓴다.
    // 재료는 서버 상태에서만 만든다(클라이언트는 칸 id 만). 방 안 ALREADY_IN_ROOM, 재료 없음 FLAME_NONE, 기능 꺼짐 FLAME_UNAVAILABLE
    // src(선택, 리뷰 M): 'run' = 진행 중 도전만, 'ended' = 종료 팀만(도전 종료 화면의 「팀 저장」은 이것을 보낸다). 생략 = 진행 중 도전 우선, 없으면 종료 팀. 지정한 재료가 없으면 FLAME_NONE
    flame_snap_save(s, m) {
      if (!SNAP_SLOTS.includes(m.slot) || (m.src !== undefined && m.src !== 'run' && m.src !== 'ended')) fail('BAD_MESSAGE');
      act(this, s, (c) => {
        if (!versusTeamCfg(c.cat)) throw new FlameError('FLAME_UNAVAILABLE');
        const now = Date.now(), useRun = m.src === 'run' || (m.src === undefined && !!c.run);
        if ((useRun && !c.run) || (!useRun && !c.profile.teams?.[ENDED_SLOT])) throw new FlameError('FLAME_NONE');
        const t = useRun ? snapshotOf(c.cat, c.run, c.profile, { seg: c.run.seg + 1, wins: Run.winsOf(c.run), now }) : c.profile.teams?.[ENDED_SLOT] ? { ...structuredClone(c.profile.teams[ENDED_SLOT]), name: c.profile.teamName } : null;
        if (!t) throw new FlameError('FLAME_NONE');
        if (!t.name) delete t.name;
        c.profile.teams = { ...(c.profile.teams ?? {}), [m.slot]: t };
        return { snapSaved: m.slot };
      }, { needRun: false });
    },
    // 칸 비우기(B149): 빈 칸 FLAME_TEAM_NONE. 확인 단계는 클라이언트가 한다
    flame_snap_delete(s, m) {
      if (!SNAP_SLOTS.includes(m.slot)) fail('BAD_MESSAGE');
      act(this, s, (c) => {
        if (!c.profile.teams?.[m.slot]) throw new FlameError('FLAME_TEAM_NONE');
        const { [m.slot]: _gone, ...rest } = c.profile.teams; // eslint-disable-line no-unused-vars
        c.profile.teams = rest;
        return { snapDeleted: m.slot };
      }, { needRun: false });
    },
    // 팀 이름(B149): 영구 저장 단위 1개. 빈 문자열·공백만·null = 기본 이름으로(저장 칸을 지워 기본값을 따른다). 앞뒤 공백·제어문자 제거, 1~TEAM_NAME_MAX 자,
    // 한글·영문·숫자·공백만(닉네임 문자 규칙 + 공백), 채팅 욕설 목록에 걸리면 거절. 진행 중 도전 표시에 바로 반영되고, 스냅샷 칸에는 저장한 순간의 이름이 고정된다
    flame_team_name(s, m) {
      if (m.name !== null && m.name !== undefined && typeof m.name !== 'string') fail('BAD_MESSAGE');
      act(this, s, (c) => { // 검사는 빈도 창 안에서(거절도 횟수에 든다)
        let name = null;
        if (typeof m.name === 'string') {
          const r = cleanText(m.name, TEAM_NAME_MAX);
          if (r.code === 'CHAT_TOO_LONG') throw new FlameError('FLAME_TEAM_NAME_LONG', { max: TEAM_NAME_MAX });
          if (r.text) {
            if (!TEAM_NAME_RE.test(r.text) || maskBadwords(r.text, this.chatBad) !== r.text) throw new FlameError('FLAME_TEAM_NAME_INVALID');
            name = r.text;
          }
        }
        if (name === null || name === c.cat.original?.name) delete c.profile.teamName; else c.profile.teamName = name;
      }, { needRun: false });
    },
    flame_perm(s, m) { act(this, s, (c) => { Run.buyPerm(c.cat, c.profile, m.id); }, { needRun: false }); },
    // 도달 순위표(§13.13). top = 1~상한(생략 = 상한). me = 계정이면 내 줄, 손님이면 null. 방 안에서도 볼 수 있다(읽기 전용)
    flame_ranking_get(s, m) {
      this.flameRate(s);
      const max = this.flameRank.top;
      if (m.top !== undefined && !(Number.isInteger(m.top) && m.top >= 1 && m.top <= max)) fail('BAD_MESSAGE');
      const b = this.flameRank.board(m.top ?? max, s.account ? s.key : null, s.nick);
      this.sendTo(s, { t: 'flame_ranking', top: b.top, me: b.me, total: b.total });
    },
  };
}

/**
 * flame 경기 종료(Lobby.onGameEnd 에서 game_end 전송 뒤 1회): 도전 상태에 결과를 반영하고 flame_result -> (도전이 끝났으면 flame_end) -> flame_state 를 보낸다.
 * 그다음 방을 없애고 room_left 로 돌려보낸다(리그 방과 같은 정리. removeFromRoom 이 부른 종료 = 퇴장·유예 만료면 그쪽이 정리한다).
 * 그 사이 도전이 바뀌었으면(다른 도전·다른 노드) 반영하지 않는다
 */
export function flameEnd(lobby, room, res) {
  const s = room.seats[0]?.s, f = room.flame, cat = lobby.flameCat;
  if (s && cat && f.practice) {
    // 연습 경기(D28): 결과를 어디에도 반영하지 않는다 — 저장·순위표 갱신·applyMatchResult 를 부르지 않고 저장되어 있는 상태를 읽어 그대로 돌려보낼 뿐이다(이기든 지든 지도로 복귀)
    // 예외(리뷰 L1): 엔진 오류로 끊긴 연습 경기(reason 'error', 실전의 재경기와 같은 사정)는 한 번 소비 표시(profile.practiceUsed)만 되돌려 다시 받을 수 있게 한다. 정상 종료·기권·유예 초과·서버 재시작은 종전대로 소비
    try {
      const data = lobby.o.data, rp = lobby.flame.getProfile(s.key), rr = lobby.flame.getRun(s.key);
      const readable = (rp?.v ?? 0) <= PROFILE_VERSION && (rr?.v ?? 0) <= SAVE_VERSION && rp?.unparsable !== true;
      const run = readable ? sanitizeRun(cat, data, rr) : null, profile = readable ? sanitizeProfile(cat, rp) : null;
      let refunded = false;
      // 되돌리기는 저장을 온전히 읽었을 때만 한다(읽지 못한 도전을 '없음'으로 덮어쓰지 않게). 영구 저장의 그 칸만 지우고 도전은 읽은 그대로 다시 쓴다
      if (res.reason === 'error' && readable && profile.practiceUsed && (rr == null || run) && !lobby.guestOfAccount(s)) {
        try { delete profile.practiceUsed; lobby.flame.save(s.key, s.nick, profile, run); refunded = true; }
        catch (e) { profile.practiceUsed = true; lobby.log(`[flame] 연습 경기 복구 저장 실패 key=${s.key}`, e); }
      }
      lobby.sendTo(s, { t: 'flame_result', matchId: res.matchId, node: null, type: 'practice', practice: true, outcome: 'practice', won: res.winner === 0 && Run.NORMAL_END.includes(res.reason), reason: res.reason, hp: null, ...(refunded ? { practiceRefunded: true } : {}) });
      if (readable) lobby.sendTo(s, { t: 'flame_state', catalogVer: cat.ver, ...Run.viewOf(cat, data, run, profile) });
    } catch (e) { lobby.log('[flame] 연습 경기 종료 처리 실패', e); }
  } else if (s && cat) {
    try {
      const data = lobby.o.data, rp = lobby.flame.getProfile(s.key), rr = lobby.flame.getRun(s.key);
      if ((rp?.v ?? 0) <= PROFILE_VERSION && (rr?.v ?? 0) <= SAVE_VERSION && rp?.unparsable !== true) {
        const read = () => ({ cat, data, profile: sanitizeProfile(cat, lobby.flame.getProfile(s.key)), run: sanitizeRun(cat, data, lobby.flame.getRun(s.key), (w) => lobby.log(`[flame] 경기 결과: 읽지 못한 도전 key=${s.key} (${w}) - 반영하지 않고 원본을 그대로 둔다`)) });
        let c = read(), out = { outcome: 'stale', end: null }, saveFailed = false;
        if (c.run && c.run.id === f.runId && c.run.match?.node === f.node) {
          out = Run.applyMatchResult(cat, data, c.run, c.profile, res);
          if (out.end) c.run = null;
          else c.run.updatedAt = Date.now();
          if (!lobby.guestOfAccount(s)) {
            // 저장 실패(P2 리뷰 L5): 다시 시도하고, 끝내 못 쓰면 결과를 반영하지 않은 것으로 알린다. 저장된 도전은 '경기 중' 표시가 남은 그대로라
            // 방이 없어진 뒤 그 노드를 다시 고를 수 있다(재경기). 승리가 조용히 사라지지 않게 error 와 flame_result{saveFailed} 를 보낸다
            let err = null;
            for (let i = 0; i < SAVE_TRIES; i++) { try { lobby.flame.save(s.key, s.nick, c.profile, c.run); err = null; break; } catch (e) { err = e; } }
            if (!err) rankUpdate(lobby, s, c.profile);
            if (err) {
              lobby.log(`[flame] 경기 결과 저장 실패 key=${s.key} run=${f.runId} node=${f.node} outcome=${out.outcome} reason=${res.reason}`, err);
              saveFailed = true; out = { outcome: 'rematch', end: null };
              lobby.sendTo(s, { t: 'error', code: 'FLAME_SAVE_FAILED', msg: ERR.FLAME_SAVE_FAILED });
              c = read(); // 저장되어 있는 상태(결과 반영 전)로 되돌려 보낸다
              if (c.run) c.run.match = null;
            }
          }
        }
        lobby.sendTo(s, { t: 'flame_result', matchId: res.matchId, node: f.node, type: f.type, outcome: out.outcome, reason: res.reason, hp: res.flame?.hp ?? null, ...(saveFailed ? { saveFailed: true } : {}),
          // 엔드리스(D24): segCleared = 방금 이긴 보스의 구간(1부터), champion = 이 승리로 우승(도전은 이어진다), achievements = 그때 새로 딴 업적, artifactPoints = 아티팩트 고갈로 대신 받은 포인트
          ...(out.segCleared ? { segCleared: out.segCleared } : {}), ...(out.champion ? { champion: true, achievements: out.achievements ?? [] } : {}), ...(out.artifactPoints ? { artifactPoints: out.artifactPoints } : {}) });
        if (out.end) lobby.sendTo(s, { t: 'flame_end', summary: out.end });
        lobby.sendTo(s, { t: 'flame_state', catalogVer: cat.ver, ...Run.viewOf(cat, data, c.run, c.profile) });
      }
    } catch (e) { lobby.log('[flame] 경기 결과 반영 실패', e); }
  }
  if (s && !room.closing && lobby.roomOf(s) === room) lobby.removeFromRoom(s, 'leave');
  lobby.markListDirty();
}
