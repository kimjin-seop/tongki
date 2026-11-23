// 불꽃의 계승 진행 지도: 시드로 구간마다 분기형 지도를 만든다(D9: 구간당 경기 4 = 일반 2 + 강팀 1 + 보스 1, nodes.json proposed.segmentTemplate).
// 저장 v3(D24 엔드리스): 지도는 구간에 들어갈 때 한 구간씩 만든다(genSegment). run.map = [현재 구간, (v2 저장에서 넘어온 미리 만든 다음 구간들)…] 이고 run.map[i] 는 구간 run.seg + i 다.
//   지나온 구간의 지도는 버린다 -> 저장 크기가 구간 수에 비례해 커지지 않는다. 난수 rngFor(seed,'map',구간)·노드 ID `${구간}-${층}-${번호}` 는 구간마다 독립이라 구간 1~3 지도는 종전과 같다.
//   구간 4 이상(엔드리스)의 상대 풀·레벨은 run_config opponents.segments 의 마지막 줄(구간 3 + PC05 해금 풀)을 그대로 쓴다. 상대 능력 가산은 없다(39 D25 미구현).
// 지도 = 구간마다 층(layer) 배열, 층마다 후보 노드 1~2개. 한 층에서 하나를 골라 지나가면 다음 층으로 간다(next = 다음 층의 노드 ID 전부).
// 상대 팀·난이도는 지도 생성 때 정한다(run_config.json opponents). 상대 능력치는 키우지 않는다(원작 보존, 37 §2.13).
import { rngFor } from './rng.js';
import { segRow, cpuLevelAddOf } from './catalog.js';
import { homeStage } from '../league/rules.js';
import { tierCfg, tierOf, strongPctOf } from './tier.js';

export const MATCH_TYPES = ['normal', 'strong', 'boss'];
export const isMatch = (type) => MATCH_TYPES.includes(type);

/** 같은 인물을 쓰는 팀 묶음(37 §3-C15). 묶음이 없으면 자기 팀만 */
export function castOf(cat, team) {
  const s = new Set([team]);
  for (const g of cat.cfg.opponents.sameCast) if (g.includes(team)) for (const t of g) s.add(t);
  return s;
}
/**
 * 그 팀이 내 로스터와 겹치는가(같은 팀이거나 같은 인물 묶음). 원작 선수 칸만 본다:
 * 오리지널 시작 선수(orig)와 영입 풀 클론(clone)은 그 팀 소속이 아니다(from 은 능력치·몸의 출처일 뿐, 39 D18).
 * -> 오리지널 팀 도전에서는 통키 팀(팀 0)·같은 인물 묶음이 상대·영입 판정에 걸리지 않고, 클론을 영입해도 몸을 빌린 팀이 상대 풀에서 빠지지 않는다. 태동 도전(orig 없는 구 저장)은 종전과 같다
 */
export function conflicts(cat, roster, team) {
  const c = castOf(cat, team);
  return roster.some((r) => !r.orig && !r.clone && c.has(r.from.team));
}

function pool(cat, seg, type, oppUnlocked) {
  const rows = cat.cfg.opponents.segments, S = rows[segRow(rows, seg)];
  return [...S[type], ...(oppUnlocked && S.unlocked ? S.unlocked[type] : [])];
}
/**
 * 첫 경기 노드 상대 제한(39 D68, decisions.json run.firstNode). 구간 1(seg 0)의 템플릿 첫 경기 층(li)에서만 허용 팀 목록을, 아니면 null(제한 없음).
 * 환경 변수 FLAME_FIRST_NODE=0 이면 끈다(재측정·시험용)
 */
export function firstNodeAllow(cat, seg, li) {
  const F = cat.decisions.run?.firstNode;
  if (!F || F.enabled !== true || process.env.FLAME_FIRST_NODE === '0' || seg !== 0) return null;
  return li === cat.template.findIndex((s) => s.node) ? F.allowTeams : null;
}
/** 종전 상대 레벨(1~cpuLevelMax): 구간 표 + 난이도 가산. 하한 1(리뷰 L1): 레벨 0 이하가 지도에 저장되면 save.js 의 cpuLevel >= 1 검사에 걸려 도전이 격리된다 */
const levelOf = (cat, seg, type, diff) => {
  const O = cat.cfg.opponents, add = cpuLevelAddOf(cat, diff, type); // 숫자 = 전 종류 공통(종전), {normal,strong,boss} = 종류별(D32)
  return Math.max(1, Math.min(O.cpuLevelMax, O.segments[segRow(O.segments, seg)].cpuLevel[type] + add));
};
/** 컴퓨터 단계(tier.js): 구간 번호로 더해지는 단계. 단계 4 이상일 때만 opp.tier 에 적는다(cpuLevel 은 언제나 엔진 레벨 1~3). tier 설정이 꺼져 있으면 종전과 같다 */
function oppOf(cat, data, seg, type, team, diff) {
  const lv = levelOf(cat, seg, type, diff), T = tierCfg(cat), tier = T ? tierOf(T, lv, seg) : lv;
  return { team, cpuLevel: lv, stage: homeStage(data.stages, team), ...(tier > cat.cfg.opponents.cpuLevelMax ? { tier } : {}) };
}

/**
 * 한 구간의 지도. 난수는 구간마다 독립(rngFor(seed, 'map', seg))이라 언제 만들어도 같은 시드·같은 구간·같은 로스터면 같은 지도다
 * @returns {{layers: object[][]}}
 */
export function genSegment(cat, data, seed, seg, { roster, diff, oppUnlocked }) {
  const M = cat.cfg.map, rng = rngFor(seed, 'map', seg), used = new Set(), layers = [];
  cat.template.forEach((step, li) => {
    let nodes;
    if (step.node) {
      const allow = firstNodeAllow(cat, seg, li), full = pool(cat, seg, step.node, oppUnlocked), lim = allow ? full.filter((t) => allow.includes(t)) : full;
      const all = lim.length ? lim : full; // 허용 팀이 풀에 하나도 없으면 제한하지 않는다(지도가 비지 않게)
      let cand = all.filter((t) => !conflicts(cat, roster, t) && !used.has(t));
      if (!cand.length) cand = all.filter((t) => !conflicts(cat, roster, t));
      if (!cand.length) cand = all; // 후보가 전부 겹치면 그대로 쓴다(지도가 비지 않게)
      const T = tierCfg(cat), sp = T && step.node !== 'boss' ? strongPctOf(T, tierOf(T, levelOf(cat, seg, step.node, diff), seg)) : 0; // 단계가 오르면 상대 풀이 강팀 쪽으로 이동(일반 -> 강팀 풀, 강팀 -> 보스 풀). 0 이면 난수를 쓰지 않는다(구간 1~3 지도는 종전과 같다)
      nodes = rng.sample(cand, M.matchChoices[step.node]).map((team0) => {
        let team = team0;
        if (sp > 0 && rng.int(100) < sp) { const up = pool(cat, seg, step.node === 'normal' ? 'strong' : 'boss', oppUnlocked).filter((t) => !conflicts(cat, roster, t) && !used.has(t)); if (up.length) team = rng.pick(up); }
        used.add(team);
        return { type: step.node, opp: oppOf(cat, data, seg, step.node, team, diff) };
      });
    } else nodes = rng.sample(step.anyOf, M.anyOfChoices).map((type) => ({ type }));
    layers.push(nodes.map((n, k) => ({ id: `${seg}-${li}-${k}`, ...n, next: [] })));
  });
  layers.forEach((layer, li) => { for (const n of layer) n.next = (layers[li + 1] ?? []).map((x) => x.id); });
  return { layers };
}

/**
 * 구간 seg 에 들어갈 때의 지도: 로스터 제외 없이 만든 뒤(종전 genMap 과 같은 난수 흐름 — 시작 7명은 오리지널 선수거나 상대 풀에 없는 통키 팀이라 종전에도 걸러지는 팀이 없었다) 지금 로스터와 겹치는 상대만 바꾼다(종전에 영입 때마다 하던 fixOpponents 와 같은 규칙).
 * -> 영입이 없으면 종전에 도전 시작 때 한꺼번에 만들던 지도와 같다
 */
export function enterSegment(cat, data, run, seg, oppUnlocked) {
  const m = genSegment(cat, data, run.seed, seg, { roster: [], diff: run.diff, oppUnlocked });
  fixLayers(cat, data, run, seg, m.layers, 0, oppUnlocked);
  return m;
}

/** 지금 고를 수 있는 노드(현재 층). run.map[0] = 현재 구간 */
export const candidates = (run) => run.map[0]?.layers[run.layer] ?? [];
export function findNode(run, id) {
  for (const seg of run.map) for (const layer of seg.layers) for (const n of layer) if (n.id === id) return n;
  return null;
}

function fixLayers(cat, data, run, seg, layers, fromLayer, oppUnlocked) {
  layers.forEach((layer, li) => {
    if (li < fromLayer) return;
    const allow = firstNodeAllow(cat, seg, li);
    for (const n of layer) {
      if (!isMatch(n.type) || !conflicts(cat, run.roster, n.opp.team) || run.match?.node === n.id) continue;
      const taken = new Set(layer.map((x) => x.opp?.team));
      const cand = pool(cat, seg, n.type, oppUnlocked).filter((t) => !conflicts(cat, run.roster, t) && !taken.has(t) && (!allow || allow.includes(t)));
      if (cand.length) n.opp = oppOf(cat, data, seg, n.type, rngFor(run.seed, 'refix', n.id).pick(cand), run.diff);
    }
  });
}

/** 영입으로 로스터가 바뀐 뒤: 아직 지나지 않은 경기 노드 중 내 선수와 겹치는 상대를 같은 풀의 다른 팀으로 바꾼다(없으면 그대로). 아직 만들지 않은 구간은 들어갈 때(enterSegment) 같은 규칙이 걸린다 */
export function fixOpponents(cat, data, run, oppUnlocked) {
  run.map.forEach((m, i) => fixLayers(cat, data, run, run.seg + i, m.layers, i === 0 ? run.layer : 0, oppUnlocked));
}
