// 불꽃의 계승 보상 생성: 장비 등급 추첨(기본 55/30/12/3 + 구간·노드 보정, 해금된 항목만), 아티팩트·소모품 후보.
// 난수는 도전 비밀값(run.secret, 클라이언트에 보내지 않는다) + 키(노드 ID·재선택 횟수)로 파생한다 -> 같은 도전의 같은 보상은 언제 열어도 같다(재접속·재시작 뒤에도).
import { rngSecret } from './rng.js';
import { segRow } from './catalog.js';

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

/** 아티팩트 후보: 해금되어 있고 아직 갖지 않은 것 중 n 개 */
export function artifactChoices(cat, run, unlocked, n, key) {
  const have = new Set(run.artifactsOwned);
  return rngSecret(run.secret, 'art', ...key).sample(unlocked.artifacts.filter((a) => !have.has(a)), n);
}

export function consumableChoices(cat, run, n, key) {
  return rngSecret(run.secret, 'cons', ...key).sample([...cat.consumables.keys()], n);
}

/** 장비 보상 선택지 수: 기본 3(rules.json) + 아티팩트(A28 보스·A29 강팀 영웅 보장) + 소모품 C18(run.extraReward) */
export function rewardSize(cat, run, nodeType, pvFn) {
  let n = cat.rules.reward.equipmentChoices, epic = 0;
  for (const id of run.artifacts.filter(Boolean)) {
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
