// 불꽃의 계승 경기 외 노드: 장비 상점·특훈장·휴식실·선수 영입·특별 이벤트. 수치는 전부 데이터(run_config.json, economy.json).
// 상점·특훈장은 열어 둔 채 여러 번 조작하고 flame_leave 로 나간다. 휴식·영입·이벤트는 선택 1회(pending)로 끝난다.
import { ferr } from './save.js';
import { roundHalfUp, originalOf, isLockedPlayer, cloneOf, cloneRecruitOn, playerPts, POOL_GRADES, segRow, canTrain } from './catalog.js';
import { rngSecret } from './rng.js';
import { equipChoices, artifactChoices, consumableChoices } from './rewards.js';
import { addItem, addArtifact, addConsumable, canHold, baseSpecial, itemsFull } from './items.js';
import { conflicts, fixOpponents } from './map.js';

const permLv = (cat, perm, id) => Math.min(perm?.[id] ?? 0, cat.perm.get(id).maxLevel);
const permVal = (cat, perm, id) => permLv(cat, perm, id) * cat.perm.get(id).effect.perLevel;

const bodyKey = (v) => `${v.team}:${v.idx}`;
/** 영입 후보 한 칸의 기록 키(run.recruitShown): 클론 = 풀 id, 원작 선수 = '팀:번호' */
const shownKey = (c) => c.clone ?? bodyKey(c);

/**
 * 원작 선수 후보 목록: 해금된 팀(teams 를 주면 그 안에서만)의 선수 중 로스터와 겹치지 않고(같은 팀·같은 인물 묶음 제외) 기본 필살기가 있는 선수.
 * bodies = 내 로스터가 쓰는 몸('팀:번호'), shown = 이 도전에서 이미 나온 후보, minPts = 이 점수(42 §2.1) 미만은 뺀다(null = 걸러 내지 않음)
 */
function originalPool(cat, data, run, unlocked, { bodies, teams = null, shown = null, minPts = null }) {
  const ex = new Set(cat.cfg.recruit.excludeTeams), all = [];
  for (const t of unlocked.recruitTeams) {
    if (ex.has(t) || (teams && !teams.includes(t)) || conflicts(cat, run.roster, t)) continue;
    for (const p of data.teams[t].players) {
      const c = { team: t, idx: p.idx }, k = bodyKey(c);
      if (baseSpecial(cat, data, c) === null || bodies.has(k) || shown?.has(k)) continue;
      if (minPts !== null && minPts !== undefined && playerPts(cat, data, c) < minPts) continue;
      all.push(c);
    }
  }
  return all;
}

/**
 * 영입 후보 n 칸(39 D18·D22, analysis/42). 저장되는 칸 = {team, idx, clone?, rare?}(클론의 team·idx = 몸).
 * 영입 풀이 켜져 있으면(recruit_pool.json + run_config recruit.clone): 칸마다 구간 등급 확률(gradePct[구간])로 등급을 뽑고 그 등급 안에서 균등 추첨.
 *   뺀다 = 은퇴(retired)·이 도전에서 이미 나온 후보(run.recruitShown)·이미 로스터에 있는 클론·내 로스터가 쓰는 몸(클론·원작 선수의 from, 오리지널 시작 선수가 빌린 skin 몸)·내 로스터나 같은 화면 후보와 이름 2자가 같은 선수.
 *   (같은 몸을 빼는 것이 엔진 initFlame 의 from 중복 거절을 피하는 길이다. 시작 7명이 빌린 몸·방영판 이름 얼굴은 풀을 만들 때 이미 빠져 있다)
 *   그 등급에 남은 선수가 없으면 아래 등급 -> 위 등급 순으로 찾는다.
 *   원작 희귀 발견: 방문당 maxPerVisit 번 visitPct[구간] % 로 굴려, 맞은 만큼 뒤 칸을 원작 선수로 바꾼다(rare). 범위 = 해금 팀 ∩ segmentTeams[구간], 점수 minPts 이상, 통키 팀·22~24 제외(excludeTeams). 조건에 맞는 선수가 없으면 클론 칸으로 둔다.
 * 꺼져 있으면 종전 동작(원작 선수만 n 명).
 * 난수 = 도전 비밀값 + 노드 ID(rngSecret) -> 같은 도전·같은 노드는 언제나 같은 후보다
 */
export function recruitChoices(cat, data, run, unlocked, n, key) {
  const rng = rngSecret(run.secret, 'recruit', ...key), RC = cat.cfg.recruit;
  // 내 오리지널 선수가 몸을 빌린 원작 선수(skin)는 후보에서 뺀다(D21: 같은 그림 두 명이 한 팀에 서지 않게). original_team.json rules.recruitExcludeSkinBodies 가 꺼져 있거나 오리지널 선수가 없으면 빈 집합(종전과 같다)
  const skinBodies = cat.original?.recruitExcludeSkinBodies ? run.roster.map((r) => originalOf(cat, r)?.skin).filter(Boolean).map(bodyKey) : [];
  if (!cloneRecruitOn(cat)) return rng.sample(originalPool(cat, data, run, unlocked, { bodies: new Set(skinBodies) }), n);
  const seg = segRow(RC.clone.gradePct, run.seg), shown = new Set(run.recruitShown ?? []); // 구간 4+(엔드리스)는 마지막 줄 고정
  const bodies = new Set([...skinBodies, ...run.roster.map((r) => bodyKey(r.from))]);
  const mine = new Set(run.roster.map((r) => r.clone).filter(Boolean));
  const given = new Set(run.roster.map((r) => cloneOf(cat, r)?.given ?? originalOf(cat, r)?.name.slice(1)).filter(Boolean));
  // 원작 희귀 발견(D22): 맞든 안 맞든 언제나 maxPerVisit 번 굴린다(난수 흐름이 결과에 따라 달라지지 않게)
  const O = RC.original;
  let hits = 0;
  for (let i = 0; i < (O?.maxPerVisit ?? 0); i++) if (rng.next() * 100 < (O.visitPct[segRow(O.visitPct, run.seg)] ?? 0)) hits++;
  const rare = hits > 0 ? rng.sample(originalPool(cat, data, run, unlocked, { bodies, teams: O.segmentTeams[segRow(O.segmentTeams, run.seg)], shown, minPts: O.minPts }), Math.min(hits, n)).map((c) => ({ ...c, rare: true })) : [];
  const out = [], W = Object.fromEntries(POOL_GRADES.map((g, i) => [g, RC.clone.gradePct[seg][i]]));
  const ok = (c) => !c.retired && !shown.has(c.id) && !mine.has(c.id) && !bodies.has(bodyKey(c.body)) && !given.has(c.given) && !out.some((x) => x.clone === c.id);
  for (let i = rare.length; i < n; i++) {
    const gi = POOL_GRADES.indexOf(rng.weighted(W));
    const order = [gi, ...Array.from({ length: gi }, (_, k) => gi - 1 - k), ...Array.from({ length: POOL_GRADES.length - 1 - gi }, (_, k) => gi + 1 + k)];
    for (const g of order) {
      const list = cat.pool.byGrade[POOL_GRADES[g]].filter(ok);
      if (!list.length) continue;
      const c = rng.pick(list);
      out.push({ team: c.body.team, idx: c.body.idx, clone: c.id });
      given.add(c.given);
      break;
    }
  }
  return [...out, ...rare];
}

/** 노드에 들어간다(경기 노드는 run.js 가 처리). run.node 와 필요한 선택(pending)을 만든다 */
export function openNode(cat, data, run, perm, unlocked, node) {
  const C = cat.cfg;
  run.node = { id: node.id, type: node.type };
  if (node.type === 'shop') {
    const S = C.shop, stock = [];
    for (const id of equipChoices(cat, run, unlocked, S.equipmentSlots + permVal(cat, perm, 'PB05'), 'shop', [node.id])) stock.push({ kind: 'equipment', id, price: cat.equipPrice(id), sold: false });
    for (const id of consumableChoices(cat, run, S.consumableSlots, [node.id])) stock.push({ kind: 'consumable', id, price: cat.consumablePrice(id), sold: false });
    for (const id of artifactChoices(cat, run, unlocked, S.artifactSlots, ['shop', node.id])) stock.push({ kind: 'artifact', id, price: S.artifactPrice, sold: false });
    run.node.stock = stock;
  } else if (node.type === 'training') run.node.picks = C.training.picksPerVisit;
  else if (node.type === 'rest') run.pending.push({ kind: 'rest', node: node.id });
  else if (node.type === 'recruit') {
    const n = C.recruit.candidatesBase + permVal(cat, perm, 'PB04') + Math.min(run.extraRecruit, C.recruit.extraMax);
    run.extraRecruit = 0; // C19: 다음 영입 1회에 쓰고 사라진다
    let choices = recruitChoices(cat, data, run, unlocked, n, [node.id]);
    // 후보 고갈(엔드리스 D24): 이미 나온 후보 기록 때문에 칸이 모자라거나 기록이 상한을 넘으면 기록을 비우고 다시 뽑는다(같은 선수가 다시 나올 수 있다). 엔드리스가 꺼져 있으면 비우지 않는다(종전 동작)
    if (cloneRecruitOn(cat) && cat.endless && run.recruitShown?.length && (choices.length < n || run.recruitShown.length >= cat.endless.shownMax)) { delete run.recruitShown; choices = recruitChoices(cat, data, run, unlocked, n, [node.id]); }
    // 한 도전 안 중복 방지(D22): 나온 후보를 도전 상태에 적어 둔다(선택 필드. 영입 풀이 꺼져 있으면 적지 않는다 = 종전 저장과 같다)
    if (cloneRecruitOn(cat) && choices.length) run.recruitShown = [...new Set([...(run.recruitShown ?? []), ...choices.map(shownKey)])];
    run.pending.push({ kind: 'recruit', node: node.id, choices });
  } else if (node.type === 'event') {
    const evs = C.events.filter((e) => unlocked.events.includes(e.id));
    run.pending.push({ kind: 'event', node: node.id, event: rngSecret(run.secret, 'event', node.id).pick(evs).id });
  }
}

/** 상점 구매(i = 상품 번호). 경기 포인트 지불 */
export function buy(cat, run, i) {
  if (run.node?.type !== 'shop') ferr('FLAME_NOT_HERE');
  const g = run.node.stock?.[i];
  if (!g || g.sold) ferr('FLAME_INVALID');
  if (run.points < g.price) ferr('FLAME_NO_FUNDS');
  if (g.kind === 'consumable' && !canHold(cat, run, g.id)) ferr('FLAME_FULL');
  if (g.kind === 'equipment' && itemsFull(cat, run)) ferr('FLAME_FULL'); // 장비 보유 상한(D24): 값을 치르고 바로 팔리지 않게 구매는 거절한다(먼저 판다)
  if (g.kind === 'equipment') addItem(cat, run, g.id);
  else if (g.kind === 'artifact') addArtifact(cat, run, g.id);
  else addConsumable(cat, run, g.id);
  run.points -= g.price; g.sold = true;
}

/**
 * 특훈장: 능력치 특훈 11종(nodes.json trainingOptions) 중 하나를 선수 1명에게. 방문당 picksPerVisit 회, 회당 training.cost.
 * 특훈 누적 상한(D31, run_config training.maxPerStat): 이번 특훈을 더하면 그 선수·그 능력치의 누적이 상한을 넘으면 FLAME_TRAIN_CAP 으로 거절한다(포인트·방문 횟수 소모 없음). 이미 넘은 구 저장도 거절만 하고 값은 그대로 둔다
 */
export function train(cat, run, p, optId) {
  if (run.node?.type !== 'training') ferr('FLAME_NOT_HERE');
  const opt = cat.training.find((t) => t.id === optId), r = run.roster[p];
  if (!opt || !r || !Number.isInteger(p)) ferr('FLAME_INVALID');
  if (!(run.node.picks > 0)) ferr('FLAME_MAX');
  if (!canTrain(cat, r, opt.stat, opt.value)) ferr('FLAME_TRAIN_CAP');
  const cost = cat.cfg.training.cost;
  if (run.points < cost) ferr('FLAME_NO_FUNDS');
  run.points -= cost; run.node.picks--;
  r.train[opt.stat] = (r.train[opt.stat] ?? 0) + opt.value;
}

/** 장비 강화를 할 수 있는 곳인가(기획 §6.1 "특훈장 또는 특정 상점") */
export function canUpgradeHere(cat, run) {
  const t = run.node?.type;
  return (t === 'training' && cat.cfg.training.upgradeHere) || (t === 'shop' && cat.cfg.shop.upgradeHere);
}

const heal = (r, max, d) => { r.hp = Math.max(1, Math.min(max, r.hp + d)); };
const pctOf = (max, pct) => Math.sign(pct) * roundHalfUp(max * Math.abs(pct), 100);

/** 휴식실: i = rest.options 번호. target player 면 p 필요 */
export function chooseRest(cat, run, i, p, maxHp) {
  const o = cat.cfg.rest.options[i] ?? ferr('FLAME_INVALID');
  if (o.target === 'player') {
    if (!Number.isInteger(p) || !run.roster[p]) ferr('FLAME_INVALID');
    heal(run.roster[p], maxHp[p], pctOf(maxHp[p], o.healPct));
  } else run.roster.forEach((r, k) => heal(r, maxHp[k], pctOf(maxHp[k], o.healPct)));
}

/** 영입: 후보 i 를 라인업 p 자리와 교체(로스터는 7명 고정, 37 §3-C23). 빠진 선수의 장비는 인벤토리로, 특훈 효과는 사라진다. i = -1 은 영입 안 함 */
export function chooseRecruit(cat, data, run, pend, i, p, oppUnlocked) {
  if (i === -1) return;
  const c = pend.choices[i];
  if (!c || !Number.isInteger(p) || !run.roster[p]) ferr('FLAME_INVALID');
  if (isLockedPlayer(cat, run.roster[p])) ferr('FLAME_PROTAGONIST'); // D20: 주인공은 교체할 수 없다(라인업 어느 칸에 있든). original_team.json rules.protagonistLocked 로 끈다
  // 영입 풀 클론(D18): from = 몸, clone = 풀 id(능력치·이름·기본 필살기는 풀에서 읽는다). 원작 선수는 종전 그대로
  const cl = c.clone !== undefined ? cloneOf(cat, c) ?? ferr('FLAME_INVALID') : null, from = cl ? { ...cl.body } : { team: c.team, idx: c.idx };
  if (run.roster.some((r, k) => k !== p && r.from.team === from.team && r.from.idx === from.idx)) ferr('FLAME_INVALID'); // 같은 몸이 로스터에 있으면 엔진이 경기를 거절한다(후보를 만들 때 이미 걸렀다. 안전망)
  run.roster[p] = { from, ...(cl ? { clone: cl.id } : {}), hp: Number.MAX_SAFE_INTEGER, train: {}, equip: Object.fromEntries(cat.slots.map((s) => [s, null])), sp: [cl ? cl.sp : baseSpecial(cat, data, c), null], recruited: true }; // hp 는 호출자가 최대 HP 로 자른다(가득 찬 상태로 합류)
  run.buffs = run.buffs.filter((b) => b.p !== p); // 빠진 선수에게 걸어 둔 다음 경기 효과는 새 선수에게 넘어가지 않는다(P2 리뷰 L4). 팀 대상(p = null)은 남는다
  const seenKey = cl ? `c:${cl.id}` : `${c.team}:${c.idx}`; // 도감 키(D23): 클론 = c:<풀 id>, 원작 선수 = 팀:번호
  if (!run.seen.players.includes(seenKey)) run.seen.players.push(seenKey);
  fixOpponents(cat, data, run, oppUnlocked);
}

/** 이벤트: 선택지 i 의 ops 를 차례로 적용. 결과 요약을 돌려준다(화면 표시용) */
export function chooseEvent(cat, run, pend, i, unlocked, maxHp) {
  const ev = cat.cfg.events.find((e) => e.id === pend.event), ch = ev?.choices[i];
  if (!ch) ferr('FLAME_INVALID');
  const cost = ch.cost ?? 0, rng = rngSecret(run.secret, 'eventop', pend.node, i);
  if (run.points < cost) ferr('FLAME_NO_FUNDS');
  // 거절 조건을 먼저 본다(지불 뒤에 실패하지 않게)
  const art = ch.ops.some((o) => o.op === 'gainArtifact') ? artifactChoices(cat, run, unlocked, 1, ['event', pend.node])[0] : null;
  if (ch.ops.some((o) => o.op === 'gainArtifact') && !art) ferr('FLAME_NO_EFFECT');
  // 특훈 누적 상한(D31): 받을 수 있는 선수가 한 명도 없으면 선택지를 거절한다(비용·HP 를 치르기 전에)
  if (ch.ops.some((o) => o.op === 'trainRandom' && !run.roster.some((r) => canTrain(cat, r, o.stat, o.value)))) ferr('FLAME_TRAIN_CAP');
  run.points -= cost;
  const cap = cat.decisions.roster.captainSlot, out = [];
  for (const o of ch.ops) {
    if (o.op === 'points') { run.points = Math.max(0, run.points + o.value); out.push({ op: o.op, value: o.value }); }
    else if (o.op === 'hpAll') { run.roster.forEach((r, k) => heal(r, maxHp[k], o.value)); out.push({ op: o.op, value: o.value }); }
    else if (o.op === 'hpAllPct') { run.roster.forEach((r, k) => heal(r, maxHp[k], pctOf(maxHp[k], o.value))); out.push({ op: o.op, value: o.value }); }
    else if (o.op === 'hpCaptain') { heal(run.roster[cap], maxHp[cap], o.value); out.push({ op: o.op, value: o.value }); }
    else if (o.op === 'trainRandom') {
      // 난수 흐름은 종전과 같다(한 번 뽑는다). 뽑힌 선수가 특훈 누적 상한(D31)에 걸리면 라인업 순서로 다음 선수에게 준다 -> 상한에 닿은 선수가 없으면 결과가 종전과 같다
      const n = run.roster.length, k0 = rng.int(n), k = Array.from({ length: n }, (_, d) => (k0 + d) % n).find((x) => canTrain(cat, run.roster[x], o.stat, o.value));
      if (k !== undefined) { run.roster[k].train[o.stat] = (run.roster[k].train[o.stat] ?? 0) + o.value; out.push({ op: o.op, p: k, stat: o.stat, value: o.value }); }
    }
    else if (o.op === 'gamble') { const win = rng.next() * 100 < o.winPct; if (win) run.points += o.win; out.push({ op: o.op, win, value: win ? o.win : 0 }); }
    else if (o.op === 'gainEquipment') { const id = equipChoices(cat, run, unlocked, 1, 'event', [pend.node])[0]; if (id) { const got = addItem(cat, run, id); out.push({ op: o.op, id, ...(got.sold !== undefined ? { sold: got.sold } : {}) }); } }
    else if (o.op === 'gainConsumable') { const id = consumableChoices(cat, run, cat.consumables.size, ['event', pend.node]).find((c) => canHold(cat, run, c)); if (id) { addConsumable(cat, run, id); out.push({ op: o.op, id }); } }
    else if (o.op === 'gainArtifact') { addArtifact(cat, run, art); out.push({ op: o.op, id: art }); }
  }
  return { event: ev.id, choice: i, results: out };
}
