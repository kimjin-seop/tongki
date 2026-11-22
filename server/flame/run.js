// 불꽃의 계승 도전 상태 기계(PROTOCOL §13): 새 도전 -> 노드 선택 -> (경기 | 상점·특훈·휴식·영입·이벤트) -> 보상 선택 -> … -> 구간 보스 -> 다음 구간 … -> 패배 | 포기 -> 코인 정산.
// 엔드리스(D24, endless.json): 구간 3 보스를 이기면 '우승'을 그 자리에서 반영하고(업적·최고 기록·첫 우승 표시) 도전은 구간 4 로 이어진다. 도전 종료 = 패배·포기뿐. 엔드리스가 꺼져 있으면(cat.endless = null) 종전대로 구간 3 보스 승리 = 우승으로 종료.
// 이 파일은 저장소·소켓·방을 모른다. run/profile 객체를 고치고 결과를 돌려줄 뿐이다(handlers.js 가 저장·전송, 시험은 경기 결과를 주입해 이 함수만으로 한 판을 돈다).
// 서버 권위: 지도는 지도 시드(run.seed), 보상·상점·영입·이벤트는 도전 비밀값(run.secret, 128비트, 저장만 하고 보내지 않는다)으로 서버가 만들고 클라이언트는 번호만 고른다. 엔진 flame 옵션(roster·allow·caps)은 저장된 도전 상태에서만 조립한다(클라이언트 입력 없음).
import { randomBytes, randomUUID } from 'node:crypto';
import { SAVE_VERSION, ferr, unlockedOf } from './save.js';
import { pv, roundHalfUp, startLineup, displayCast, recruitView, originalOf, cloneOf, practiceCfg, recruitRoomHealPct, codexCast, afterWinHealPct, gradeOn, teamArtifactsOn } from './catalog.js';
import { teamOfRun, clampHp, toEngine, upgradedStats, upgradePreview, initialSpecials, specialsOf, formationOf, teamWornOf } from './stats.js';
import { genSegment, enterSegment, candidates, findNode, isMatch } from './map.js';
import { secretFromSeed } from './rng.js';
import { equipChoices, artifactChoices, consumableChoices, rewardSize } from './rewards.js';
import { addItem, addArtifact, addConsumable, canHold, expireBuffs, wearerOf, upgradeCost, staleArtifact, pruneArtifactChoices } from './items.js';
import { openNode, chooseRest, chooseRecruit, chooseEvent } from './nodes.js';
import { SNAP_SLOTS, ENDED_SLOT, versusTeamCfg, snapshotOf, snapCard } from './teams.js';

export const NORMAL_END = ['annihilation', 'timeup', 'sudden_death'];
export const newSeed = () => randomBytes(4).readUInt32LE(0);
/** 도전 비밀값(128비트, 16진 32자). 보상·상점·영입·이벤트 난수의 열쇠(P2 리뷰 M2: 32비트 시드는 보이는 지도·보상에서 역산할 수 있다) */
export const newSecret = () => randomBytes(16).toString('hex');

const permLv = (cat, perm, id) => Math.min(perm?.[id] ?? 0, cat.perm.get(id).maxLevel);
const permVal = (cat, perm, id) => permLv(cat, perm, id) * cat.perm.get(id).effect.perLevel;
const maxHpOf = (cat, data, run, perm) => teamOfRun(cat, data, run, perm).players.map((p) => p.final.s0);
/** 다음 경기 소모품(C03·C13)으로 늘어난 최대 HP(선수별). 그 경기에 한해 현재 HP 도 이만큼 올려 출전한다(D13) */
function buffHpBonus(cat, data, run, perm, nodeType) {
  if (!cat.decisions.hp.teamMaxHpBonusAlsoHealsCurrent || !run.buffs.length) return run.roster.map(() => 0);
  const a = teamOfRun(cat, data, run, perm, nodeType), b = teamOfRun(cat, data, { ...run, buffs: [] }, perm, nodeType);
  return run.roster.map((_, i) => Math.max(0, a.players[i].final.s0 - b.players[i].final.s0));
}
/** 상태를 바꾼 뒤 부르는 정리: 현재 HP 를 최대 HP 안으로 */
export function settleHp(cat, data, run, perm) { clampHp(run, teamOfRun(cat, data, run, perm)); }

/**
 * 새 도전. 시작 7명 = (roster.startClones 켜짐) 영입 풀에서 랜덤 구성한 클론 7명(역할·등급 칸 고정, 서버 비밀값 시드), 아니면 오리지널 팀(D17, decisions.json roster.startOriginal + original_team.json) — 그 키가 없으면 종전대로 태동(D4).
 * 오리지널 선수의 칸에는 orig(선수 id)가 붙고 도전에는 origTeam(팀 id)이 붙는다. from 은 능력치·히트박스·기본 필살기의 출처(original_team.json base)라 계산 경로는 종전과 같다.
 * 시작 보상 = 장비 선택(+ 장비 보급 PB02), 전술 연구(PB03)가 있으면 아티팩트 선택
 * 필살기 슬롯(D38 부여 구조): 불씨 7명은 [null, null](필살기 없음)로 시작한다. 종전(legacy)·태동 시작(원작 선수)은 [원작 필살기, null]
 */
export function newRun(cat, data, profile, o = {}) {
  const C = cat.cfg, unlocked = unlockedOf(cat, profile.perm), diff = o.diff ?? 0;
  if (!unlocked.difficulty.includes(diff)) ferr('FLAME_LOCKED');
  const now = o.now ?? Date.now();
  const seed = (o.seed ?? newSeed()) >>> 0;
  const secret = o.secret ?? (o.seed === undefined ? newSecret() : secretFromSeed(seed)); // 시드를 지정한 도전(시험·시뮬)은 보상도 재현되게 시드에서 파생. 실제 도전은 무작위
  const start = startLineup(cat, secret); // 시작 팀 랜덤(roster.startClones)은 서버 비밀값에서만 뽑는다(클라이언트 입력 없음). 뽑은 라인업은 run.roster 에 저장돼 재개해도 같다
  const roster = start.players.map(({ from, orig, clone }) => (
    { from, ...(orig ? { orig } : {}), ...(clone ? { clone } : {}), hp: 0, train: {}, equip: Object.fromEntries(cat.slots.map((s) => [s, null])), sp: initialSpecials(cat, data, { from, orig, clone }), recruited: false }
  ));
  const run = {
    v: SAVE_VERSION, id: o.id ?? randomUUID(), seed, secret, diff, createdAt: now, updatedAt: now,
    ...(start.team ? { origTeam: start.team } : {}), // 오리지널 팀으로 시작한 도전만(D17). 없으면 종전(태동) 도전
    seg: 0, layer: 0, map: [genSegment(cat, data, seed, 0, { roster, diff, oppUnlocked: unlocked.opponents })], node: null, match: null, done: [], // map[0] = 현재 구간(다음 구간은 들어갈 때 만든다, map.js)
    wins: { normal: 0, strong: 0, boss: 0 },
    roster, items: [], nextInst: 1, artifactsOwned: [], artifacts: Array(cat.rules.team.artifactSlots).fill(null), fmItem: null, consumables: {}, buffs: [], // fmItem = 팀 포메이션 아이템 칸(off, D58. team 에서는 쓰지 않는다)
    extraReward: 0, extraRecruit: 0,
    points: cat.matchPoints.start + permVal(cat, profile.perm, 'PB01'), fm: C.formation.default,
    rerolls: C.reward.rerollsBase + permVal(cat, profile.perm, 'PB07'), rollN: 0,
    pending: [], surviveUsed: [], surviveCount: 0,
    stat: { bestRarity: 0, fms: [], bosses: [] },
    seen: { items: [], artifacts: [], consumables: [], players: roster.map((r) => (r.clone ? `c:${r.clone}` : `${r.from.team}:${r.from.idx}`)) },
  };
  for (const r of run.roster) r.hp = Number.MAX_SAFE_INTEGER;
  settleHp(cat, data, run, profile.perm); // 가득 찬 HP 로 시작(영구 성장 HP 포함)
  const eq = equipChoices(cat, run, unlocked, C.reward.startEquipmentChoices + permVal(cat, profile.perm, 'PB02'), 'start', ['start', 0]);
  if (eq.length) run.pending.push({ kind: 'equipment', src: 'start', nodeType: 'start', choices: eq, n: 0 });
  const aLv = permLv(cat, profile.perm, 'PB03');
  if (aLv > 0) {
    const ar = artifactChoices(cat, run, unlocked, C.reward.startArtifactChoicesBase + aLv * C.reward.startArtifactChoicesPerLevel, ['start', 0], 'start'); // off(D61): 시작 필살기 아이템 후보(team 은 종전 팀 강화)
    if (ar.length) run.pending.push({ kind: 'artifact', src: 'start', nodeType: 'start', choices: ar, n: 0 });
  }
  return run;
}

/**
 * 패배 분투 보상(D16, [자작 제안]. 기획 §10.2 는 패배 보상을 정하지 않았다): 패배한 마지막 경기에서 아웃시킨 상대 수 × defeatOutCoin, 최대 defeatOutCoinMax.
 * economy.json flameCoin.proposed 의 두 키가 없거나 0 이하·숫자가 아니면 0(종전 동작). 근거 = analysis/40 §13.2
 */
function defeatCoin(K, outs) {
  const per = K.proposed?.defeatOutCoin, max = K.proposed?.defeatOutCoinMax;
  if (!Number.isFinite(per) || per <= 0 || !Number.isFinite(max) || max <= 0 || !Number.isInteger(outs) || outs <= 0) return 0;
  return Math.floor(Math.min(max, outs * per));
}
/**
 * 패배한 경기에서 내가 아웃시킨 상대 수. 서버가 만든 경기 결과(game_end.rem = 승패 확정 시점 [좌석0, 좌석1] 남은 인원, roomGame.finish)에서만 읽는다(클라이언트 입력 없음).
 * 끝까지 치른 패배(전멸·시간 종료·서든데스)만 센다: 기권·유예 초과·무승부 상한은 0. flame 좌석은 0, 상대는 1(matchOptions). 경기 규칙이 knockout 이라 서든데스에서도 인원이 그대로다
 */
function oppOuts(cat, res) {
  if (res.winner !== 1 || !NORMAL_END.includes(res.reason) || !Array.isArray(res.rem)) return 0;
  const n = cat.rules.team.players, left = res.rem[1];
  return Number.isInteger(left) ? Math.min(n, Math.max(0, n - left)) : 0;
}

/**
 * 지금까지의 승리로 쌓인 불꽃코인(정산 전 예상). 분투 보상(defeat, D16)은 result 가 defeat 이고 defeatOuts 가 있을 때만.
 * 우승·첫 우승 보너스(D26): 엔드리스 = 이번 도전에서 우승했으면(run.champ) 한 번씩 — 첫 우승 여부는 우승한 그때의 표시(run.champ.first)로 본다(그 자리에서 profile.firstClear 가 서므로 정산 때 다시 보면 빠진다).
 * 종전(엔드리스 꺼짐) = result 가 champion 일 때만, 첫 우승은 profile.firstClear 로
 */
export function coinsOf(cat, run, profile, result = null, defeatOuts = 0) {
  const K = cat.coin, pct = cat.cfg.difficulty.find((d) => d.id === run.diff)?.coinPct ?? 100;
  const c = { normal: run.wins.normal * K.normalWin, strong: run.wins.strong * K.strongWin, boss: run.wins.boss * K.bossWin, champion: 0, first: 0, defeat: 0 };
  if (run.champ) { c.champion = K.championshipBonus; if (run.champ.first) c.first = K.firstChampionshipBonus; }
  else if (result === 'champion') { c.champion = K.championshipBonus; if (!profile.firstClear) c.first = K.firstChampionshipBonus; }
  if (result === 'defeat') c.defeat = defeatCoin(K, defeatOuts);
  const sum = c.normal + c.strong + c.boss + c.champion + c.first + c.defeat;
  return { ...c, pct, total: Math.floor((sum * pct) / 100) };
}

export const winsOf = (run) => run.wins.normal + run.wins.strong + run.wins.boss;

/** 순위표에 싣는 핵심 3명(라인업 0~2번 칸)의 표시 이름: 오리지널·클론 = 이름 문자열, 원작 선수(희귀 영입·구 태동 도전) = '@팀:번호'(서버에는 원작 선수 이름표가 없다 -> 화면이 이름으로 푼다) */
const coreNames = (cat, run) => run.roster.slice(0, 3).map((r) => originalOf(cat, r)?.name ?? cloneOf(cat, r)?.name ?? `@${r.from.team}:${r.from.idx}`);

/**
 * 순위 기록(D27): best.rank 가 없으면 엔드리스 이전 기록(best.seg·best.wins, 시각·핵심 3명 없음)을 쓴다. 기록이 없으면 null.
 * 엔드리스 이전 우승자(best.clears > 0 이고 best.seg = 마지막 구간 segments)는 도달 구간을 segments + 1 로 읽는다: 종전 우승은 마지막 구간에서 끝나 seg 가 3 으로 남았는데
 * 엔드리스의 우승(구간 3 보스 격파)은 구간 4 도달로 적힌다 -> 같은 성취가 같은 구간이 되게 한다. segments 를 주지 않으면 보정하지 않는다
 */
export function rankRecordOf(profile, segments = 0) {
  const b = profile?.best;
  if (b?.rank) return b.rank;
  if (!b || !(b.seg > 0)) return null;
  return { seg: b.clears > 0 && b.seg === segments ? b.seg + 1 : b.seg, wins: b.wins, at: 0, team: [], diff: 0 };
}

/**
 * 최고 기록 갱신(구간 보스를 이길 때마다 + 도전 종료 때). 도달 구간 = 지금 서 있는 구간(1부터).
 * 순위 기록(best.rank)은 더 멀리 갔거나 같은 구간에서 승수가 더 많을 때만 바뀐다 -> 패배·포기·재접속으로 줄거나 사라지지 않는다. 달성 시각을 남긴다(2차 '이번 주' 탭용)
 */
function recordBest(cat, run, profile, now) {
  const reached = run.seg + 1, wins = winsOf(run), cur = rankRecordOf(profile, cat.rules.run.segments); // cur 는 best.seg·best.wins 를 고치기 전에 읽는다(엔드리스 이전 기록과 비교)
  if (!cur || reached > cur.seg || (reached === cur.seg && wins > cur.wins)) profile.best.rank = { seg: reached, wins, at: now, team: coreNames(cat, run), diff: run.diff, run: run.id }; // run = 이 기록을 세운 도전의 id(키운 팀 「최고」 슬롯 판정용, saveTeams)
  profile.best.seg = Math.max(profile.best.seg, reached); profile.best.wins = Math.max(profile.best.wins, wins);
}

/**
 * 도전 종료 시점의 팀을 teams.ended 에 남긴다(B149): 도전 종료 화면에서 flame_snap_save 로 스냅샷 칸에 저장할 재료. 대전에서 고를 수 없다.
 * 종전 자동 저장(D33 recent·best 덮어쓰기)은 폐지했다(2026-11-21 사용자 결정) — recent·best 는 건드리지 않는다(영구 저장에 그대로 남는다).
 * run_config.json versusTeam 이 꺼져 있으면 아무것도 하지 않는다
 * @returns {boolean} 저장할 수 있는 종료 팀이 생겼는가(flame_end.summary.teamSave)
 */
function keepEnded(cat, run, profile, now) {
  if (!versusTeamCfg(cat)) return false;
  let snap = null;
  try { snap = snapshotOf(cat, run, profile, { seg: run.seg + 1, wins: winsOf(run), now }); } catch (e) { console.error('[flame] 종료 팀을 만들지 못했습니다(정산은 그대로 진행):', e?.message ?? e); } // 부가 기능의 오류가 코인 정산을 막지 않게
  if (!snap) return false;
  profile.teams = { ...(profile.teams ?? {}), [ENDED_SLOT]: snap };
  return true;
}

/** 업적 판정. live = 도전 중(구간 3 우승 순간): 아직 정산되지 않은 이번 도전의 승수·도전 1회를 더해서 본다(정산 때와 같은 값이 된다) */
function grantAchievements(cat, run, profile, live) {
  const T = profile.totals, add = live ? 1 : 0;
  const facts = { totalWins: T.wins + add * winsOf(run), totalBoss: T.boss + add * run.wins.boss, clears: profile.best.clears, runs: T.runs + add, bestRarity: cat.rarities[run.stat.bestRarity] };
  const out = [];
  for (const a of cat.cfg.achievements) {
    if (profile.achievements.includes(a.id)) continue;
    const ok = Object.entries(a.cond).every(([k, v]) => (k === 'bestRarity' ? cat.rarityRank[facts[k]] >= cat.rarityRank[v] : facts[k] >= v));
    if (ok) { profile.achievements.push(a.id); out.push(a.id); }
  }
  return out;
}

/**
 * 도전 종료 정산(패배·우승·포기 공통, 한 번만): 코인 지급, 최고 기록·도감·업적 갱신. profile 을 고치고 종료 요약을 돌려준다.
 * 도전 상태(run)는 호출자가 지운다 -> 영입 선수·장비·아티팩트·강화·특훈·경기 포인트·소모품·필살기 활성은 전부 사라진다(기획 §3.4)
 * 경기를 한 판도 치르지 않은 도전(시작하자마자 포기·새 도전)은 도전 횟수·최고 기록·업적에 넣지 않는다(P2 리뷰 L2: flame_new 반복으로 올릴 수 없게). 도감은 합친다
 * @param defeatOuts 패배한 마지막 경기의 상대 아웃 수(applyMatchResult 의 패배 분기만 넘긴다. 포기·우승은 0). 분투 보상(D16)도 L2 와 같이 경기 1판 이상 치른 도전에만 준다
 * 엔드리스(D24·D26): 우승(구간 3 보스)은 이긴 그 자리에서 이미 반영됐다(run.champ). 여기서는 우승 횟수를 다시 올리지 않고 우승·첫 우승 코인만 다른 코인과 함께 한 번 준다. result 는 defeat | abandon 뿐이고 요약의 championed 로 우승 여부를 알린다
 */
export function settle(cat, run, profile, result, defeatOuts = 0, now = Date.now()) {
  const T = profile.totals, counted = run.seg > 0 || run.done.some((d) => isMatch(d.type)); // 끝까지 간 경기가 1판 이상(재경기 처리된 오류 경기는 done 에 없다. done 은 현재 구간 것만 남으므로 구간 2 이상이면 이미 치른 것이다)
  const outs = counted && result === 'defeat' ? defeatOuts : 0;
  const coins = coinsOf(cat, run, profile, result, outs), wins = winsOf(run);
  profile.coins += coins.total; profile.earned += coins.total;
  T.wins += wins; T.boss += run.wins.boss;
  const reached = run.seg + 1; // 도달 구간(1부터). 종전 우승 = 마지막 구간에서 끝난다(구간을 넘기지 않는다)
  let teamSave = false; // 도전 종료 화면에서 이 도전의 팀을 스냅샷 칸에 저장할 수 있는가(B149. 경기 없는 도전 = false)
  if (counted) { T.runs++; recordBest(cat, run, profile, now); teamSave = keepEnded(cat, run, profile, now); }
  if (result === 'champion') {
    if (!run.champ) profile.best.clears++; // 엔드리스로 이미 우승이 반영된 도전(run.champ)을 엔드리스를 끈 뒤 이어 우승해도 우승 횟수는 한 번만
    profile.firstClear = true;
    if (!profile.best.clearDiff.includes(run.diff)) profile.best.clearDiff.push(run.diff);
  }
  for (const k of ['items', 'artifacts', 'consumables', 'players']) for (const id of run.seen[k]) if (!profile.codex[k].includes(id)) profile.codex[k].push(id);
  const newAch = counted ? grantAchievements(cat, run, profile, false) : [];
  return {
    result, counted, endless: !!cat.endless, championed: result === 'champion' || !!run.champ, // championed = 이번 도전에서 우승(구간 3 보스 격파)을 했는가
    runId: run.id, diff: run.diff, seg: reached, defeatOuts: outs, wins: { ...run.wins }, matches: wins, bosses: run.stat.bosses.slice(),
    bestRarity: run.items.length ? cat.rarities[run.stat.bestRarity] : null, formations: run.stat.fms.slice(), coins, achievements: newAch,
    teams: { recent: false, best: false }, teamSave, // teams = 폐지된 자동 칸 갱신 표시(B149: 언제나 둘 다 false, 구 클라이언트 호환용으로 남김). teamSave = 이 도전의 팀을 flame_snap_save 로 저장할 수 있다(teams.ended)
    lost: { items: run.items.length, artifacts: run.artifactsOwned.length, consumables: Object.values(run.consumables).reduce((s, n) => s + n, 0), points: run.points, recruited: run.roster.filter((r) => r.recruited).length },
  };
}

/** 같은 구간 안에서 다음 층으로(상점·특훈·휴식·영입·이벤트 뒤. 구간의 마지막 층은 언제나 보스라 여기서 구간이 넘어가지 않는다 — catalog.js 구간 템플릿 검사) */
function advance(run) {
  run.node = null;
  if (run.layer < run.map[0].layers.length - 1) run.layer++;
}

/**
 * 구간 보스를 이긴 뒤 다음 구간으로: 지나온 구간의 지도·노드 기록을 버리고(저장이 구간 수에 비례해 커지지 않게) 다음 구간 지도를 만든다(v2 저장에서 넘어온 미리 만든 지도가 있으면 그것을 쓴다).
 * 지나온 구간의 요약으로 남는 것 = 승수(run.wins)·격파 보스(run.stat.bosses, 최근 것만)·구간 번호(run.seg)
 */
function nextSegment(cat, data, run, profile) {
  run.node = null; run.seg++; run.layer = 0; run.done = []; run.map.shift();
  if (!run.map.length) run.map.push(enterSegment(cat, data, run, run.seg, unlockedOf(cat, profile.perm).opponents));
}

/** 방문 열쇠(영입실 입장 회복의 '한 방문'): 구간:층. 한 층에서는 노드 하나만 지나가므로 같은 층의 다른 영입 노드도 같은 방문이다 */
const visitKey = (run) => `${run.seg}:${run.layer}`;

/**
 * 영입실 입장 회복(D29, [자작 제안] 보조 규칙): 영입 노드에 들어갈 때 전원 현재 HP += 최대 HP × recruitRoom.healPct %(half-up), 최대 HP 까지. 아웃되어 HP 1 로 남은 선수(D5)도 받는다(D15 와 같은 식).
 * 한 방문에 한 번: 준 층을 도전 저장에 적는다(run.roomHeal.at = 구간:층) -> 저장이 깨져 노드가 닫힌 뒤 같은 층에 다시 들어가도 또 주지 않는다. 난수는 쓰지 않는다.
 * 키가 없거나 0 이하면 아무것도 하지 않고 run.roomHeal 도 적지 않는다(종전 동작·종전 저장과 같다). pct·total(실제로 오른 HP 합)은 표시용이다(viewOf run.recruitHeal)
 */
function healRecruitRoom(cat, data, run, perm) {
  const pct = recruitRoomHealPct(cat), at = visitKey(run);
  if (!pct || run.roomHeal?.at === at) return;
  const maxHp = maxHpOf(cat, data, run, perm);
  let total = 0;
  run.roster.forEach((r, i) => { const to = Math.max(r.hp, Math.min(maxHp[i], r.hp + roundHalfUp(maxHp[i] * pct, 100))); total += to - r.hp; r.hp = to; });
  run.roomHeal = { at, pct, total };
}

/**
 * 노드 선택. 경기 노드면 {match: 방 생성에 필요한 값} 을 돌려주고 run.match 를 표시한다(경기 중). 그 밖은 노드를 열고 {match:null}.
 * 풀지 않은 선택(보상 등)이 있으면 FLAME_PENDING, 이미 노드 안이면 FLAME_IN_NODE
 */
export function enterNode(cat, data, run, profile, nodeId, now = Date.now()) {
  if (run.pending.length) ferr('FLAME_PENDING');
  if (run.node) ferr('FLAME_IN_NODE');
  const node = candidates(run).find((n) => n.id === nodeId) ?? ferr('FLAME_INVALID');
  if (isMatch(node.type)) {
    run.match = { node: node.id, at: now };
    return { match: matchOptions(cat, data, run, profile, node) };
  }
  openNode(cat, data, run, profile.perm, unlockedOf(cat, profile.perm), node);
  if (node.type === 'recruit') healRecruitRoom(cat, data, run, profile.perm); // D29: 후보를 고르기 전에, 방문당 한 번
  return { match: null };
}

/** 상점·특훈장에서 나간다(다음 층으로) */
export function leaveNode(run) {
  if (!run.node || !['shop', 'training'].includes(run.node.type)) ferr('FLAME_NOT_HERE');
  run.done.push({ id: run.node.id, type: run.node.type });
  advance(run);
}

/**
 * 맨 앞 선택(pending)을 푼다. i = 번호(-1 = 받지 않음), p = 대상 선수(영입 교체 자리·집중 치료).
 * equipment/artifact = 1개 획득, recruit = 교체, rest·event = 효과 적용 뒤 다음 층으로.
 * 자동 무효(D48, 정검수 L3): 아티팩트를 얻은 뒤에는 남은 아티팩트 선택에서 받을 수 없게 된 칸(이미 가진 등급 이하)을 빼고, 빈 선택은 통째로 뺀다.
 *   그래도 받을 수 없는 칸을 골랐으면(변경 전 저장 등) 거절하지 않고 그 칸만 무효로 한다: note {voided:true, id}, 남은 칸이 있으면 그 선택은 그대로 남아 다시 고른다
 */
export function choose(cat, data, run, profile, i, p) {
  const pend = run.pending[0] ?? ferr('FLAME_INVALID');
  if (!Number.isInteger(i) || i < -1) ferr('FLAME_INVALID');
  const unlocked = unlockedOf(cat, profile.perm);
  let note = null;
  if (pend.kind === 'equipment' || pend.kind === 'artifact') {
    if (i >= 0) {
      const id = pend.choices[i] ?? ferr('FLAME_INVALID');
      if (pend.kind === 'equipment') { const got = addItem(cat, run, id); if (got.sold !== undefined) note = { full: true, id, sold: got.sold }; } // 장비 보유 상한(D24): 받는 즉시 판매가만큼 포인트로
      else if (staleArtifact(cat, run, id)) { pruneArtifactChoices(cat, run); settleHp(cat, data, run, profile.perm); return { voided: true, id }; }
      else { const sold = addArtifact(cat, run, id); if (sold) note = { upgraded: true, id, sold: sold.id, points: sold.points }; } // 등급 아이템(D39): 더 높은 등급을 얻어 낮은 등급이 자동 판매됐다
    }
  } else {
    if (i === -1 && pend.kind !== 'recruit') ferr('FLAME_INVALID');
    const maxHp = maxHpOf(cat, data, run, profile.perm);
    if (pend.kind === 'rest') chooseRest(cat, run, i, p, maxHp);
    else if (pend.kind === 'recruit') chooseRecruit(cat, data, run, pend, i, p, unlocked.opponents);
    else note = chooseEvent(cat, run, pend, i, unlocked, maxHp);
    run.done.push({ id: pend.node, type: pend.kind });
    advance(run);
  }
  run.pending.shift();
  pruneArtifactChoices(cat, run);
  settleHp(cat, data, run, profile.perm);
  return note;
}

/** 보상 재선택: 맨 앞 장비·아티팩트 선택지를 다시 뽑는다(도전당 rerolls 회 = 기본 + 보상 분석 PB07) */
export function reroll(cat, run, profile) {
  const pend = run.pending[0];
  if (!pend || !['equipment', 'artifact'].includes(pend.kind)) ferr('FLAME_INVALID');
  if (!(run.rerolls > 0)) ferr('FLAME_MAX');
  const unlocked = unlockedOf(cat, profile.perm), n = pend.g === 'firstWin' ? cat.grade.drop.firstWinChoices : pend.choices.length, key = [pend.src, pend.n + 1]; // 첫 승리 보상은 자동 무효로 칸이 줄었어도 정해진 칸 수로 다시 뽑는다
  const gsrc = pend.g === 'firstWin' ? 'firstWin' : pend.nodeType === 'boss' ? 'boss' : pend.nodeType === 'start' ? 'start' : null; // 등급제(D40): 처음 뽑을 때와 같은 출처·유형으로 다시 뽑는다
  const next = pend.kind === 'equipment' ? equipChoices(cat, run, unlocked, n, pend.nodeType, key, { epic: pend.epic ?? 0 }) : artifactChoices(cat, run, unlocked, n, key, gsrc);
  if (!next.length) ferr('FLAME_NO_EFFECT');
  run.rerolls--; pend.n++; pend.choices = next;
}

/**
 * 경기 시작 값 조립(엔진 flame 옵션 PROTOCOL §12.1 + 방 설정). 전부 저장된 도전 상태와 서버 데이터에서만 만든다.
 * D13: 다음 경기 최대 HP 소모품(C13 팀 +5, C03 선수 +10)은 그 경기에 한해 최대 HP 와 현재 HP 를 같이 올린다(경기 뒤 처리는 applyMatchResult). D5: HP 0 선수는 1 로 출전(엔진 hpFloor)
 * D38(부여 구조): allow = 낀 아티팩트가 부여한 슛 + 로스터 원작 선수의 고유 슛(team.allow). 슬롯은 선수별 발동 가능 집합으로 한 번 더 걸러 넘긴다(specialsOf) -> 엔진의 allow 는 팀 공용이지만 남의 고유 슛은 나가지 않는다
 */
export function matchOptions(cat, data, run, profile, node) {
  const team = teamOfRun(cat, data, run, profile.perm, node.type), sps = specialsOf(cat, data, run.roster, run.artifacts);
  const bonus = buffHpBonus(cat, data, run, profile.perm, node.type); // 소모품으로 늘어난 최대 HP 만큼 현재 HP 도
  const roster = run.roster.map((r, i) => {
    const pl = team.players[i], e = toEngine(pl);
    return { from: { ...r.from }, stat: e.stat, hp: Math.min(pl.final.s0, Math.max(0, r.hp) + bonus[i]), ext: e.ext, sp: sps[i], fx: e.fx };
  });
  return {
    node: node.id, type: node.type, cpuTeam: node.opp.team, cpuLevel: node.opp.cpuLevel, stage: node.opp.stage,
    rules: { mode: cat.cfg.match.ruleMode, time: cat.cfg.match.timeMin },
    flame: { seat: 0, roster, allow: team.allow, families: cat.families, fm: team.fm, caps: { ...cat.engineCaps } }, // team.fm = 실제로 쓰이는 패턴(등급제 D42: 아이템이 주지 않는 패턴이면 기본 포메이션. 꺼져 있으면 run.fm 그대로)
    cast: displayCast(cat, run, profile.teamName), // 화면 표시용(game_start.flameCast). 엔진에는 넘기지 않는다. 팀 이름 = 플레이어가 정한 이름(B149)
  };
}

/**
 * 연습 경기(D28, 구간 1 초보 구제)를 지금 받을 수 있는가. run_config.json practice 가 켜져 있고(키가 없으면 언제나 false = 종전 동작),
 * 첫 도전(끝난 도전 기록·최고 구간·우승·승리가 전부 0)이고, 이 계정이 아직 쓰지 않았고(profile.practiceUsed), 구간 1 첫 층에서 실전을 한 판도 치르지 않았을 때만 참.
 * 경기를 치르지 않고 끝낸 도전(counted:false)은 도전 기록에 들지 않으므로 그 뒤의 새 도전도 첫 도전이다
 */
export function practiceAvailable(cat, run, profile) {
  if (!practiceCfg(cat) || !run || profile.practiceUsed) return false;
  const T = profile.totals, B = profile.best;
  if (T.runs > 0 || T.wins > 0 || B.seg > 0 || B.clears > 0) return false;
  return run.seg === 0 && run.layer === 0 && winsOf(run) === 0 && !run.match && !run.node && !run.done.some((d) => isMatch(d.type));
}

/**
 * 연습 경기 시작 값: 지금 고를 수 있는 첫 경기 노드의 상대 팀·스테이지에 practice.cpuLevel(난이도 가산 없음)로 matchOptions 와 같은 조립을 한다(엔진에는 flame 옵션 경로로만 들어간다).
 * 도전 상태(run)는 고치지 않는다: run.match 를 세우지 않으므로 결과가 applyMatchResult 로 갈 길이 없다. 한 번 소비 표시(profile.practiceUsed)는 호출자(handlers.js)가 세운다.
 * 받을 수 없으면 FLAME_PRACTICE_NONE, 풀지 않은 선택(시작 보상)이 있으면 FLAME_PENDING
 */
export function practiceOptions(cat, data, run, profile) {
  if (!practiceAvailable(cat, run, profile)) ferr('FLAME_PRACTICE_NONE');
  if (run.pending.length) ferr('FLAME_PENDING');
  const node = candidates(run).find((n) => isMatch(n.type)) ?? ferr('FLAME_PRACTICE_NONE');
  const o = matchOptions(cat, data, run, profile, node);
  return { ...o, node: null, type: 'practice', cpuLevel: practiceCfg(cat).cpuLevel, cast: { ...o.cast, practice: true } };
}

/**
 * 승리 뒤 전원 회복(D15, [자작 제안] 보조 규칙. 기획 §3.3 휴식실은 그대로 있다): 전원 현재 HP += 최대 HP × rest.afterWinHealPct %(half-up), 최대 HP 까지.
 * 아웃되어 HP 1 로 남은 선수(D5)도 받는다. 키가 없거나 0 이하·숫자가 아니면 아무것도 하지 않는다(종전 동작). 근거 = 시뮬 측정(analysis/40 §2·§12)
 * 구간 보스 승리(D30, analysis/40 §16.4): rest.afterBossHealPct 가 있으면 그 값을 대신 쓴다(더하지 않는다. 한 번만 계산한다). 키가 없으면 afterWinHealPct 그대로(종전 동작) -> catalog.js afterWinHealPct
 * @param nodeType 방금 이긴 경기 노드의 종류(normal|strong|boss)
 */
function healAfterWin(cat, data, run, perm, nodeType) {
  const pct = afterWinHealPct(cat, nodeType);
  if (!pct) return;
  const maxHp = maxHpOf(cat, data, run, perm);
  run.roster.forEach((r, i) => { r.hp = Math.min(maxHp[i], r.hp + roundHalfUp(maxHp[i] * pct, 100)); });
}

/**
 * 경기 결과 반영(game_end 1회). D6: 정상 종료에서 내가 이긴 것만 승리, 엔진 오류(error)는 재경기, 그 밖(패배·기권·유예 초과·무승부 상한)은 패배 = 도전 종료.
 * D15: 이기고 도전이 이어지면 전원 회복(healAfterWin). 패배·재경기·우승에는 걸리지 않는다. D16: 끝까지 치른 패배는 상대 아웃 수만큼 분투 보상(oppOuts -> settle).
 * @param res {winner, reason, rem?:[a,b], flame?:{hp[7], surviveUsed[]}} (game_end 그대로. flame = game_end.flame, PROTOCOL §12.3)
 * D24(엔드리스): 구간 보스 승리 = 다음 구간으로(지도 생성·최고 기록 갱신). 구간 3 보스면 우승을 그 자리에서 반영하고 도전은 이어진다(반환 champion:true). 엔드리스가 꺼져 있으면 종전대로 구간 3 보스 승리에서 끝난다
 * @returns {{outcome:'win'|'lose'|'rematch'|'stale', end:object|null, segCleared?:number, champion?:true, achievements?:string[], artifactPoints?:number}} end = 정산 요약(도전이 끝났을 때). 끝났으면 호출자가 run 을 지운다.
 *   segCleared = 방금 이긴 보스의 구간(1부터), champion = 이 승리로 우승, achievements = 그때 새로 딴 업적, artifactPoints = 낼 아티팩트가 없어 대신 받은 경기 포인트
 */
export function applyMatchResult(cat, data, run, profile, res, now = Date.now()) {
  const node = run.match ? findNode(run, run.match.node) : null;
  if (!node || !candidates(run).includes(node)) { run.match = null; return { outcome: 'stale', end: null }; }
  run.match = null;
  if (res.reason === 'error') return { outcome: 'rematch', end: null }; // 서버 쪽 사정으로 끊긴 경기: 같은 노드를 다시 고를 수 있다
  // 현재 HP·치사 생존 사용 기록(이기든 지든 경기에서 일어난 일)
  // 다음 경기 한정 최대 HP 소모품(C03·C13)으로 올려 받은 현재 HP 는 경기 뒤 남지 않는다(P2 리뷰 L1): 그 선수의 현재 HP 는 경기 전 값을 넘지 않는다(늘어난 몫이 먼저 깎인 셈)
  const floor = cat.decisions.hp.floorAfterMatch, bonus = buffHpBonus(cat, data, run, profile.perm, node.type);
  if (Array.isArray(res.flame?.hp)) run.roster.forEach((r, i) => { if (Number.isInteger(res.flame.hp[i])) r.hp = Math.max(floor, bonus[i] > 0 ? Math.min(res.flame.hp[i], r.hp) : res.flame.hp[i]); });
  // 치사 생존: 횟수는 도전 단위(surviveCount, P2 리뷰 L3). surviveUsed 는 쓴 장비 인스턴스 표시용
  for (const i of res.flame?.surviveUsed ?? []) {
    if (!run.roster[i]) continue;
    run.surviveCount++;
    const inst = run.roster[i].equip.protector;
    if (inst && !run.surviveUsed.includes(inst)) run.surviveUsed.push(inst);
  }
  if (!run.stat.fms.includes(run.fm)) run.stat.fms.push(run.fm);
  const win = res.winner === 0 && NORMAL_END.includes(res.reason);
  run.done.push({ id: node.id, type: node.type, opp: node.opp.team, win, reason: res.reason });
  expireBuffs(cat, run, node.type); // 다음 경기 효과는 경기가 끝나면 사라진다(§9.2)
  if (!win) { settleHp(cat, data, run, profile.perm); return { outcome: 'lose', end: settle(cat, run, profile, 'defeat', oppOuts(cat, res), now) }; }
  const E = cat.endless, nSeg = cat.rules.run.segments, out = { outcome: 'win', end: null };
  run.wins[node.type]++;
  if (node.type === 'boss') { run.stat.bosses.push(node.opp.team); if (E && run.stat.bosses.length > E.bossesKeep) run.stat.bosses.splice(0, run.stat.bosses.length - E.bossesKeep); }
  run.points += cat.matchPoints[`${node.type}Win`];
  const lastLayer = run.layer === run.map[0].layers.length - 1; // 구간의 마지막 층 = 보스
  if (!E && lastLayer && run.seg >= nSeg - 1) { // 종전(엔드리스 꺼짐): 마지막 구간 보스 승리 = 우승으로 도전 종료
    run.node = null;
    settleHp(cat, data, run, profile.perm);
    return { outcome: 'win', end: settle(cat, run, profile, 'champion', 0, now) };
  }
  if (lastLayer) {
    out.segCleared = run.seg + 1;
    if (E && out.segCleared === nSeg && !run.champ) { // 우승(D24): 그 자리에서 우승 횟수·첫 우승·업적을 반영한다. 코인은 도전 종료 정산 때 한 번(D26, 기획 §10.2)
      run.champ = { first: !profile.firstClear };
      profile.best.clears++; profile.firstClear = true;
      if (!profile.best.clearDiff.includes(run.diff)) profile.best.clearDiff.push(run.diff);
      out.champion = true; out.achievements = grantAchievements(cat, run, profile, true);
    }
    if (E && E.rerollAdd > 0 && out.segCleared >= E.rerollFrom) run.rerolls += E.rerollAdd; // 구간 4+ 보스 격파마다 재선택 +1(endless.json rerollPerBoss)
    nextSegment(cat, data, run, profile);
    recordBest(cat, run, profile, now); // 진행 중인 도전도 순위에 든다(D27)
  } else advance(run);
  settleHp(cat, data, run, profile.perm);
  healAfterWin(cat, data, run, profile.perm, node.type);
  // 승리 보상: 장비 선택(등급 확률 = 구간·노드 보정), 보스 = 아티팩트 선택, 강팀 = 소모품
  const unlocked = unlockedOf(cat, profile.perm), R = cat.cfg.reward;
  const sz = rewardSize(cat, run, node.type, pv);
  if (sz.usedExtra) run.extraReward = 0; // C18: 다음 보상 1회에 쓰고 사라진다
  const eq = equipChoices(cat, run, unlocked, sz.n, node.type, [node.id, 0], { epic: sz.epic });
  if (eq.length) run.pending.push({ kind: 'equipment', src: node.id, nodeType: node.type, choices: eq, n: 0, epic: sz.epic });
  if (node.type === 'boss') {
    const ar = artifactChoices(cat, run, unlocked, R.bossArtifactChoices, [node.id, 0], 'boss'); // 등급제(D40): 「필살슛·포메이션·팀 강화」 유형 고정
    if (ar.length) run.pending.push({ kind: 'artifact', src: node.id, nodeType: node.type, choices: ar, n: 0 }); // nodeType = 장비 보상 칸과 같은 표시용 칸(화면이 보스 뒤 회복 % 를 가정 없이 판별, B70). 뽑기에는 쓰지 않는다
    else if (E && E.artifactFallbackPoints > 0) { run.points += E.artifactFallbackPoints; out.artifactPoints = E.artifactFallbackPoints; } // 아티팩트 고갈(D24): 경기 포인트로 대신
  }
  // 첫 승리 보상(등급제 D40): 이 도전의 첫 승리에 필살슛 아이템(가장 낮은 등급) 택 1. 보스 승리에는 위의 보스 보상이 있어 주지 않는다. 꺼져 있으면 없다(종전 동작)
  if (gradeOn(cat) && node.type !== 'boss' && winsOf(run) === 1) {
    const fw = artifactChoices(cat, run, unlocked, cat.grade.drop.firstWinChoices, [node.id, 0], 'firstWin');
    if (fw.length) run.pending.push({ kind: 'artifact', src: node.id, nodeType: node.type, choices: fw, n: 0, g: 'firstWin' });
  }
  if (node.type === 'strong') for (const id of consumableChoices(cat, run, cat.consumables.size, [node.id]).filter((c) => canHold(cat, run, c)).slice(0, R.strongConsumables)) addConsumable(cat, run, id);
  return out;
}

/** off(D63) 에서 영구 성장 상점에 내지 않는 항목인가(decisions.json artifact.hiddenPerm) */
export const permHidden = (cat, id) => !teamArtifactsOn(cat) && cat.artifact.hiddenPerm.includes(id);

/** 영구 성장 구매(17항목: A 4·B 7·C 6). 다음 단계 비용을 불꽃코인으로 지불. 도전 중에도 살 수 있다(시작 보상·시작 포인트류는 다음 도전부터) */
export function buyPerm(cat, profile, id, now = Date.now()) {
  const u = cat.perm.get(id) ?? ferr('FLAME_INVALID'), lv = profile.perm[id] ?? 0;
  if (permHidden(cat, id)) ferr('FLAME_LOCKED'); // off(D63): 신규 아티팩트 해금(PC03)은 팔지 않는다
  if (lv >= u.maxLevel) ferr('FLAME_MAX');
  const cost = u.costs[lv];
  if (profile.coins < cost) ferr('FLAME_NO_FUNDS');
  profile.coins -= cost; profile.perm[id] = lv + 1;
  profile.spent.push({ id, lv: lv + 1, cost, at: now });
  if (profile.spent.length > 100) profile.spent.splice(0, profile.spent.length - 100);
  return cost;
}

/** 포메이션 변경(패턴 0~14). selectable = 'roster' 면 로스터 출신 팀의 패턴만 */
export function setFormation(cat, data, run, fm) {
  if (!cat.tagOfFm.has(fm)) ferr('FLAME_INVALID');
  // 등급제(D42): 기본 포메이션과 낀 포메이션 아이템의 패턴만 고를 수 있다(그 밖은 FLAME_LOCKED). 꺼져 있으면 아래 종전 규칙
  if (gradeOn(cat)) { if (formationOf(cat, fm, teamWornOf(cat, run)).fm !== fm) ferr('FLAME_LOCKED'); run.fm = fm; return; } // off(D58): 팀 포메이션 아이템 칸(run.fmItem)
  if (cat.cfg.formation.selectable === 'roster' && fm !== cat.cfg.formation.default) {
    const mine = new Set(run.roster.map((r) => data.formations.teams.find((t) => t.team === r.from.team)?.name_idx));
    if (!mine.has(fm)) ferr('FLAME_LOCKED');
  }
  run.fm = fm;
}

/** 라인업 순서 변경: order = 지금 번호 7개의 순열(0~3 내야, 4~6 외야, 0번 = 주장 D12) */
export function setLineup(run, order) {
  const n = run.roster.length;
  if (!Array.isArray(order) || order.length !== n || new Set(order).size !== n || order.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) ferr('FLAME_INVALID');
  run.roster = order.map((i) => run.roster[i]);
  run.buffs = run.buffs.map((b) => (b.p === null ? b : { ...b, p: order.indexOf(b.p) })); // 선수에게 건 다음 경기 효과는 선수를 따라간다
}

/** 클라이언트에 보내는 상태(flame_state). 지도 시드·도전 비밀값은 보내지 않는다(보상 예측 방지) */
export function viewOf(cat, data, run, profile) {
  const P = {
    coins: profile.coins, earned: profile.earned, perm: { ...profile.perm }, spent: profile.spent.slice(-20), unlocked: unlockedOf(cat, profile.perm),
    codex: profile.codex, best: profile.best, totals: profile.totals, achievements: profile.achievements, firstClear: profile.firstClear,
    practiceUsed: profile.practiceUsed === true, // 연습 경기를 이미 썼는가(D28)
    // 팀 스냅샷 칸 카드(B149, §13.20): {s1, s2, s3} 각각 카드 | null(빈 칸). 능력치는 대전과 같은 경로로 지금 다시 계산한 값(teams.js snapCard).
    //   폐지된 자동 칸(recent·best)은 싣지 않는다 -> 구 클라이언트는 그 키가 없어 '없음'으로 그린다
    teams: Object.fromEntries(SNAP_SLOTS.map((k) => [k, snapCard(cat, data, k, profile.teams?.[k])])),
    // 도전 종료 화면 저장 재료가 있는가(진행 중인 도전이 없을 때 flame_snap_save 가 쓰는 팀). 도전이 있으면 그 도전이 우선이다
    teamEnded: !!profile.teams?.[ENDED_SLOT],
    teamName: profile.teamName ?? null, teamNameDefault: cat.original?.name ?? null, // 팀 이름(B149): 정한 이름 | null(= 기본 이름 teamNameDefault 를 따른다)
    played: profile.totals.runs > 0 || !!run, // 모드를 해 본 적 있는가(경기를 1판 이상 치르고 끝낸 도전이 있거나 지금 도전 중). 팀 선택 탭의 안내 표시용
    codexCast: codexCast(cat, profile.codex.players), // 도감의 클론 키('c:<id>')에 붙일 표시용 정의(§13.16). 도감에 적힌 클론만 싣는다
    // off(D63): hiddenPerm(PC03)은 싣지 않고, permText 가 있는 항목(PB03)은 text 에 바뀐 설명을 싣는다
    permList: [...cat.perm.values()].filter((u) => !permHidden(cat, u.id)).map((u) => ({ id: u.id, name: u.name, group: u.group, lv: profile.perm[u.id] ?? 0, maxLevel: u.maxLevel, costs: u.costs, next: (profile.perm[u.id] ?? 0) < u.maxLevel ? u.costs[profile.perm[u.id] ?? 0] : null,
      ...(!teamArtifactsOn(cat) && cat.artifact.off.permText[u.id] ? { text: cat.artifact.off.permText[u.id] } : {}) })),
  };
  if (!run) return { profile: P, run: null, team: null };
  const { seed, secret, rollN, seen, recruitShown, roomHeal, ...rest } = run; // eslint-disable-line no-unused-vars
  const next = candidates(run).find((n) => isMatch(n.type)) ?? null;
  const nodeType = run.node ? null : next && candidates(run).every((n) => n.type === next.type) ? next.type : null;
  const team = teamOfRun(cat, data, run, profile.perm, nodeType);
  // 다음 경기 출전 HP(표시용, matchOptions 와 같은 식): 다음 경기 소모품(C03·C13)으로 늘어난 최대 HP 만큼 현재 HP 도 올려 출전한다(D13), HP 0 은 1 로 출전(D5)
  const bonus = buffHpBonus(cat, data, run, profile.perm, nodeType), floor = cat.engineCaps.hpFloor ?? 1;
  const matchHp = run.roster.map((r, i) => { const max = team.players[i].final.s0; return { hp: Math.max(Math.min(floor, max), Math.min(max, Math.max(0, r.hp) + bonus[i])), max, bonus: bonus[i] }; });
  return {
    profile: P,
    run: {
      ...rest,
      // 영입 후보 칸에는 표시용 정의를 채워 보낸다(D18, §13.10): 클론 = 이름·역할·등급·능력치·필살기·skin, 원작 선수 = 능력치·필살기·rare. 저장에는 {team, idx, clone?, rare?} 만 있다
      pending: run.pending.map((p) => (p.kind === 'recruit' ? { ...p, choices: p.choices.map((c) => recruitView(cat, data, c)) } : p)),
      // 장비 인스턴스: 강화 반영 능력치·낀 선수·판매가·다음 강화(비용은 특훈 효율 할인 반영, 값이 그대로면 noChange = '변화 없음')
      items: run.items.map((it) => {
        const def = cat.items.get(it.id), up = upgradePreview(cat, it.id, it.lv);
        return { ...it, slot: def.slot, rarity: def.rarity, stats: upgradedStats(cat, it.id, it.lv), wearer: wearerOf(cat, run, it.inst), sell: cat.sellPrice(it.id), up: { ...up, cost: up.cost === null ? null : upgradeCost(cat, profile.perm, it.lv) } };
      }),
      // 지도(v3): 저장에는 현재 구간부터만 있다. 화면이 map[run.seg] 로 읽을 수 있게 지나온 구간 자리는 빈 칸({layers: []})으로 채워 보낸다
      map: [...Array.from({ length: run.seg }, () => ({ layers: [] })), ...run.map],
      // 구간 표시(D24): segNo = 현재 구간(1부터), endless = 무한 구간 도전인가, championed = 이번 도전에서 우승했는가, championSegments = 우승 기준 구간 수(rules.json run.segments).
      // 엔드리스에서는 끝이 없으므로 segments·matchesTotal 은 null 이다(분모·남은 경기 표시를 하지 않는다). 꺼져 있으면 종전 값
      segNo: run.seg + 1, endless: !!cat.endless, championed: !!run.champ, championSegments: cat.rules.run.segments,
      segments: cat.endless ? null : cat.rules.run.segments, matchesTotal: cat.endless ? null : cat.rules.run.matches, matchesWon: winsOf(run),
      candidates: run.node || run.pending.length ? [] : candidates(run).map((n) => n.id),
      inMatch: !!run.match, coinsPending: coinsOf(cat, run, profile), matchHp,
      practiceAvailable: practiceAvailable(cat, run, profile), // 연습 경기(D28)를 지금 받을 수 있는가(flame_practice). 풀지 않은 선택이 있으면 참이어도 FLAME_PENDING 으로 거절된다
      // 영입실 입장 회복(D29, 표시용): 지금 열려 있는 영입실에 들어올 때 받은 회복 {pct, total(전원이 실제로 오른 HP 합)}. 영입실 밖이거나 꺼져 있으면 null. 새로고침해도 같은 값이다(다시 주지 않는다)
      recruitHeal: run.node?.type === 'recruit' && roomHeal?.at === visitKey(run) ? { pct: roomHeal.pct, total: roomHeal.total } : null,
      cast: displayCast(cat, run, profile.teamName), // 표시용 정의(팀 이름 = 플레이어가 정한 이름 B149, 없으면 기본)(팀명·약칭·소개, 라인업 순서 7칸의 이름·역할·한 줄·skin·주인공·교체 잠금). 원작 선수 칸은 null
    },
    team,
  };
}
