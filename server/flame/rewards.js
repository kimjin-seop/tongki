// 불꽃의 계승 보상 생성: 장비 등급 추첨(기본 55/30/12/3 + 구간·노드 보정, 해금된 항목만), 아티팩트·소모품 후보.
// 난수는 도전 비밀값(run.secret, 클라이언트에 보내지 않는다) + 키(노드 ID·재선택 횟수)로 파생한다 -> 같은 도전의 같은 보상은 언제 열어도 같다(재접속·재시작 뒤에도).
import { rngSecret } from './rng.js';
import { segRow, gradeOn, grantOf, isTeamArtifact, GRADES, teamArtifactsOn } from './catalog.js';

/** 등급 가중치: rules.json dropRatePct + run_config rarityShift(구간, 노드 종류). 전설은 설계도(PC02) 해금 전에는 0. 표 길이를 넘는 구간(엔드리스 구간 4+)은 마지막 줄 고정(D24 — 종전에는 보정이 0 으로 떨어졌다) */
export function rarityWeights(cat, seg, kind, unlocked) {
  const S = cat.cfg.reward.rarityShift, w = {};
  for (const r of cat.rarities) w[r] = Math.max(0, cat.rules.rarity.dropRatePct[r] + (S.segment[segRow(S.segment, seg)]?.[r] ?? 0) + (S.node[kind]?.[r] ?? 0));
  if (!unlocked.legendary) w.legendary = 0;
  return w;
}

/** 등급을 뽑고 그 등급의 해금된 장비 하나. 그 등급에 남은 것이 없으면 아래 등급으로 내려간다 */
function rollItem(cat, rng, w, unlocked, exclude, force = null) {
  const ok = new Set(unlocked.items);
  let ri = cat.rarityRank[force ?? rng.weighted(w) ?? cat.rarities[0]];
  for (let n = 0; n < cat.rarities.length; n++, ri = (ri + cat.rarities.length - 1) % cat.rarities.length) {
    const c = [...cat.items.values()].filter((it) => it.rarity === cat.rarities[ri] && ok.has(it.id) && !exclude.has(it.id));
    if (c.length) return rng.pick(c).id;
  }
  return null;
}

/**
 * 장비 선택지 n 개(서로 다른 아이템). opts.epic = 영웅 등급 보장 칸 수(A29)
 * @returns {string[]} 아이템 ID
 */
export function equipChoices(cat, run, unlocked, n, kind, key, opts = {}) {
  const rng = rngSecret(run.secret, 'equip', ...key), w = rarityWeights(cat, run.seg, kind, unlocked), out = [], ex = new Set();
  for (let i = 0; i < n; i++) {
    const id = rollItem(cat, rng, w, unlocked, ex, i >= n - (opts.epic ?? 0) ? 'epic' : null);
    if (id) { out.push(id); ex.add(id); }
  }
  return out;
}

// ---------- 등급 아이템 추첨(analysis/39 D40) ----------
/** 출처별 등급 가중치(decisions.json grade.drop). src = 'boss'(구간별 줄, 표보다 뒤 구간은 마지막 줄) | 'shop' | 'firstWin' */
export const gradeWeights = (cat, src, seg = 0) => { const D = cat.grade.drop; return src === 'boss' ? D.boss[segRow(D.boss, seg)] : D[src]; };
/** 등급 하나(가중치 표가 전부 0 이면 가장 낮은 등급) */
export const rollGrade = (cat, rng, src, seg = 0) => rng.weighted(gradeWeights(cat, src, seg)) ?? GRADES[0];

/**
 * 등급 아이템 한 칸: 등급을 먼저 뽑고(출처별 가중치) 그 등급으로 받을 수 있는 종류 중 하나를 균등 추첨한다.
 * 받을 수 있는 종류 = 같은 종류를 그 등급 이상으로 갖고 있지 않고(종류당 최고 등급 하나만, D39) 같은 화면의 다른 칸에 없는 것(taken).
 * 그 등급으로 받을 것이 없으면(전부 그 등급 이상 보유) 올려 찾되(D46, 정검수 M3), **그 출처의 가중치가 0 보다 큰 등급만, grade.drop.escalateMax 이하까지만** 거친다
 *   -> 상점(S 0)·첫 승리 보상(C 100)에서는 가중치 0 인 등급이 어떤 경우에도 나오지 않고, 보스의 S 는 직접 뽑혔을 때만 나온다(올려 찾기로는 A 까지). 끝까지 없으면 null(호출자가 팀 강화로 대신하거나 그 칸을 뺀다).
 * 난수는 언제나 등급 1번 + 종류 1번(받을 것이 있을 때)이다
 * @param kind 'shot' | 'formation'  @returns {string|null} 아이템 id
 */
export function grantChoice(cat, run, rng, kind, src, taken = new Set()) {
  const own = new Map();
  for (const a of run.artifactsOwned) { const g = grantOf(cat, a); if (g && g.kind === kind) own.set(g.key, g.rank); }
  const keys = kind === 'shot' ? cat.grade.shotIds : cat.grade.fmIds;
  const W = gradeWeights(cat, src, run.seg), r0 = GRADES.indexOf(rollGrade(cat, rng, src, run.seg));
  const top = cat.grade.drop.escalateMax === undefined ? GRADES.length - 1 : GRADES.indexOf(cat.grade.drop.escalateMax);
  for (let r = r0; r < GRADES.length; r++) {
    if (r > r0 && (r > top || !(W[GRADES[r]] > 0))) continue; // 올려 찾기 제한: 직접 뽑힌 등급(r0)은 그대로 본다
    const ok = keys.filter((k) => !taken.has(`${kind}:${k}`) && (own.get(k) ?? -1) < r);
    if (!ok.length) continue;
    const k = rng.pick(ok);
    taken.add(`${kind}:${k}`);
    return cat.grade.gen[kind].get(k)[GRADES[r]];
  }
  return null;
}

/**
 * 아티팩트 후보. 종전(등급제 꺼짐) = 해금되어 있고 아직 갖지 않은 것 중 n 개.
 * 등급제(D40): 손으로 쓴 아티팩트는 팀 강화(A07~A30)만 새로 나온다(A01~A06 = 필살기 계열 해금은 신규 획득 중단. 가진 것은 종전대로 동작).
 *   src 'boss' = 「필살슛 1 · 포메이션 1 · 팀 강화 1」 유형 고정(grade.drop.bossKinds. n 은 쓰지 않는다),
 *   src 'firstWin' = 필살슛 n 칸(첫 승리 보상: 전부 가장 낮은 등급), src 'shop' = 칸마다 유형을 가중치(grade.drop.shopKinds)로 뽑는다, 그 밖(시작 보상·이벤트) = 팀 강화 n 개.
 *   낼 것이 없는 필살슛·포메이션 칸(D46): grade.drop.emptyAsTeam 이 켜져 있으면 팀 강화 한 칸으로 대신하고(팀 강화도 없으면 그 칸은 빠진다), 꺼져 있으면 그 칸을 뺀다. 높은 등급으로 대신하지 않는다.
 * 난수는 도전 비밀값 + 키라 같은 도전의 같은 보상은 다시 열어도 같다(보유 구성이 같을 때)
 */
export function artifactChoices(cat, run, unlocked, n, key, src = null) {
  if (!teamArtifactsOn(cat)) return itemChoices(cat, run, n, key, src);
  const have = new Set(run.artifactsOwned);
  if (!gradeOn(cat)) return rngSecret(run.secret, 'art', ...key).sample(unlocked.artifacts.filter((a) => !have.has(a)), n);
  const team = unlocked.artifacts.filter((a) => !have.has(a) && isTeamArtifact(cat, a));
  if (!['boss', 'shop', 'firstWin'].includes(src)) return rngSecret(run.secret, 'art', ...key).sample(team, n);
  const rng = rngSecret(run.secret, 'gart', src, ...key), D = cat.grade.drop, out = [], taken = new Set();
  const kinds = src === 'boss' ? D.bossKinds : src === 'firstWin' ? Array(n).fill('shot') : Array.from({ length: n }, () => rng.weighted(D.shopKinds));
  for (const kind of kinds) {
    const teamOne = () => rng.sample(team.filter((a) => !out.includes(a)), 1)[0] ?? null;
    const id = kind === 'team' ? teamOne() : grantChoice(cat, run, rng, kind, src, taken) ?? (D.emptyAsTeam ? teamOne() : null);
    if (id) out.push(id);
  }
  return out;
}

/**
 * 팀 공용 아티팩트를 끈 구조(D58~D61, decisions.json artifact.model 'off')의 보상 후보: 필살슛·포메이션 아이템만 나온다(A01~A30 은 나오지 않는다).
 *   'boss' = artifact.off.bossKinds 유형 고정(필살슛 · 필살슛 · 포메이션), 'shop' = 칸마다 artifact.off.shopKinds 가중치로 유형, 'firstWin' = 필살슛 n 칸(가장 낮은 등급),
 *   'start'(시작 보상, 전술 연구 PB03) = 필살슛 n 칸(등급 출처 artifact.off.startGrade), 'event'(E05) = 필살슛 n 칸(등급 출처 artifact.off.eventGrade).
 *   낼 것이 없는 칸은 뺀다(팀 강화로 대신하지 않는다). 등급제가 꺼져 있으면 낼 것이 없다(빈 목록). 난수 열쇠는 등급제와 같은 'gart' + 출처 + 키
 */
function itemChoices(cat, run, n, key, src) {
  if (!gradeOn(cat)) return [];
  const O = cat.artifact.off, rng = rngSecret(run.secret, 'gart', src ?? 'none', ...key), out = [], taken = new Set();
  const kinds = src === 'boss' ? O.bossKinds : src === 'shop' ? Array.from({ length: n }, () => rng.weighted(O.shopKinds)) : Array(n).fill('shot');
  const gsrc = src === 'start' ? O.startGrade : src === 'event' ? O.eventGrade : src === 'boss' || src === 'shop' ? src : 'firstWin';
  for (const kind of kinds) { const id = grantChoice(cat, run, rng, kind, gsrc, taken); if (id) out.push(id); }
  return out;
}

/** 상점의 아티팩트 한 칸 값: 등급 아이템 = 등급별 값(grade.price.shop), 그 밖 = 종전 값(run_config shop.artifactPrice) */
export const artifactPrice = (cat, id) => { const g = grantOf(cat, id); return g ? cat.grade.price.shop[g.grade] : cat.cfg.shop.artifactPrice; };

export function consumableChoices(cat, run, n, key) {
  return rngSecret(run.secret, 'cons', ...key).sample([...cat.consumables.keys()], n);
}

/** 장비 보상 선택지 수: 기본 3(rules.json) + 아티팩트(A28 보스·A29 강팀 영웅 보장) + 소모품 C18(run.extraReward) */
export function rewardSize(cat, run, nodeType, pvFn) {
  let n = cat.rules.reward.equipmentChoices, epic = 0;
  for (const id of teamArtifactsOn(cat) ? run.artifacts.filter(Boolean) : []) { // off(D58): A28·A29 가 없다
    for (const e of cat.artifacts.get(id).effects) {
      if (e.type !== 'reward_extra_choice' || e.conditions?.nodeType !== nodeType) continue;
      const c = pvFn(e, 'count');
      n += c;
      if (e.params.rarity === 'epic') epic += c;
    }
  }
  const extra = Math.min(run.extraReward, cat.cfg.reward.extraChoiceMax);
  return { n: n + extra, epic, usedExtra: run.extraReward > 0 };
}
