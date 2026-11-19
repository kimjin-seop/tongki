// 불꽃의 계승(flame_legacy) 데이터 마스터 검증 도구.
// 사용: node server/flame/tools/validate_data.mjs [--strict] [--asset-root <dir>] [--quiet]
//   --strict      경고(아이콘 파일 없음 등)도 실패로 처리
//   --asset-root  아이콘 경로의 기준 폴더(기본: <프로젝트>/public)
//   --update-body-lock  영입 풀의 새 id 를 몸 잠금 파일(tools/recruit_pool_body_lock.json)에 더한다. 이미 잠긴 id 의 몸이 다르면 쓰지 않고 실패한다
// 검사: ID 수·중복·누락, 필수 필드, enum, 아이콘 경로 규칙·파일 존재, 효과 타입 사전 정합,
//       기획서(analysis/36) 표와 이름·등급·효과 문구·수치 자동 대조, 참조 무결성.
// 읽기 전용이다. 기존 모드 데이터(server/data)는 조회만 한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePool, serializePool, summarizePool, cellCounts, scoreOf, GRADES, POOL_STATS } from './gen_recruit_pool.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../../..');
// 영입 풀 몸 잠금(2차 리뷰): 한 번 내보낸 클론 id 의 body 는 바꾸지 않는다. 저장된 도전의 클론 칸은 from = 몸이라, 풀을 개정하며 몸을 바꾸면
// save.js 가 그 칸의 클론 표시를 지워 원작 선수로 읽는다. 풀 파일은 생성 도구가 통째로 다시 쓰므로 기준을 풀 밖(이 파일)에 둔다
export const BODY_LOCK_REL = 'server/flame/tools/recruit_pool_body_lock.json';
const bodyKeyOf = (p) => `${p?.body?.team}:${p?.body?.idx}`;
/** 잠금 대조. changed = 몸이 달라진 id, missing = 풀에서 사라진 id, added = 잠금에 아직 없는 id */
export function diffBodyLock(lock, players) {
  const cur = new Map(players.map((p) => [p.id, bodyKeyOf(p)])), L = lock?.bodies ?? {};
  return {
    changed: Object.keys(L).filter((id) => cur.has(id) && cur.get(id) !== L[id]).map((id) => `${id} ${L[id]} -> ${cur.get(id)}`),
    missing: Object.keys(L).filter((id) => !cur.has(id)),
    added: [...cur.keys()].filter((id) => !(id in L)),
  };
}

const RARITY_KO = { 일반: 'common', 희귀: 'rare', 영웅: 'epic', 전설: 'legendary' };
const SLOT_OF = { H: 'headband', G: 'glove', P: 'protector', U: 'uniform' };
const ICON_DIR = { H: 'headbands', G: 'gloves', P: 'protectors', U: 'uniforms', A: 'artifacts', C: 'consumables' };
const KINDS = ['heal', 'nextMatch', 'utility'];
const DURATIONS = ['instant', 'nextMatch', 'nextBossMatch', 'nextReward', 'nextRecruit'];
const CATEGORIES = ['special', 'formation', 'team'];
// 기획서 문구의 능력치 이름 → 키. 긴 이름을 먼저 둔다.
const STAT_KO = [['캐치 후 밀림 감소', 'r2'], ['넉백 저항', 'r1'], ['캐치 지속', 's5'], ['투구 속도', 's6'], ['패스 속도', 's7'], ['이동속도', 's2'], ['점프력', 's3'], ['공격력', 's4'], ['방어력', 's1'], ['HP', 's0']];
const STAT_RE = new RegExp(`(${STAT_KO.map(([k]) => k).join('|')}) ([+-]\\d+)%?$`);
const DOWN_RE = /쓰러짐 회복 (\d+)프레임 단축$/;

const seq = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
const EXPECTED_IDS = {
  equipment: [...seq('H', 10), ...seq('G', 10), ...seq('P', 10), ...seq('U', 10)],
  artifacts: seq('A', 30),
  consumables: seq('C', 20),
};

/** 기획서 표에서 ID 행을 읽는다. { id: { name, rarity?, text } } */
export function parseSpecItems(specText) {
  const out = {};
  for (const line of specText.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([HGPUAC]\d{2})\s*\|(.+)\|\s*$/);
    if (!m) continue;
    const c = m[2].split('|').map((s) => s.trim());
    out[m[1]] = c.length === 3 ? { name: c[0], rarity: RARITY_KO[c[1]], text: c[2] } : { name: c[0], text: c[1] };
  }
  return out;
}

/** 효과 문구 한 줄 → 끝에 붙은 능력치 증감. exact = 앞에 조건·대상 문구가 없는 순수 능력치 구절 */
function statPhrase(phrase) {
  let m = phrase.match(STAT_RE);
  if (m) return { stat: STAT_KO.find(([k]) => k === m[1])[1], value: Number(m[2]), exact: m[0] === phrase };
  m = phrase.match(DOWN_RE);
  if (m) return { stat: 'r3', value: Number(m[1]), exact: m[0] === phrase };
  return null;
}
const numbersIn = (s) => (s.match(/\d+/g) ?? []).map(Number);
function numbersOf(v, acc = []) {
  if (typeof v === 'number') acc.push(Math.abs(v));
  else if (Array.isArray(v)) v.forEach((x) => numbersOf(x, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'proposed') numbersOf(x, acc);
  return acc;
}

export function validate({ root = DEFAULT_ROOT, assetRoot, strict = false, bodyLock } = {}) {
  const errors = [], warnings = [], info = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  const dataDir = path.join(root, 'server/flame/data');
  assetRoot ??= path.join(root, 'public');
  const load = (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')); } catch (e) { err(`${name}: 읽기 실패 (${e.message})`); return null; }
  };
  const F = Object.fromEntries(['items_equipment', 'artifacts', 'consumables', 'synergies', 'formation_tags', 'shot_families', 'economy', 'perm_upgrades', 'rules', 'nodes', 'effect_types'].map((n) => [n, load(`${n}.json`)]));
  if (errors.length) return { ok: false, errors, warnings, info, counts: {} };

  const eq = F.items_equipment.items, ar = F.artifacts.items, co = F.consumables.items;
  const counts = { equipment: eq.length, artifacts: ar.length, consumables: co.length, synergies: F.synergies.synergies.length };
  const dict = F.effect_types;
  const tagIds = F.formation_tags.tags.map((t) => t.id);
  const famIds = F.shot_families.families.map((f) => f.id);
  const nodeIds = F.nodes.types.map((t) => t.id);
  const rarities = F.rules.rarity.order;
  const enums = { stats: dict.stats, targets: dict.targets, formation_tags: tagIds, shot_families: famIds, nodes: nodeIds, rarity: rarities };

  // ---- 1. ID 수·중복·누락 ----
  for (const [label, items, expected] of [['equipment', eq, EXPECTED_IDS.equipment], ['artifacts', ar, EXPECTED_IDS.artifacts], ['consumables', co, EXPECTED_IDS.consumables]]) {
    const ids = items.map((i) => i.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    const missing = expected.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => !expected.includes(id));
    if (items.length !== expected.length) err(`${label}: 항목 수 ${items.length} (기대 ${expected.length})`);
    if (dup.length) err(`${label}: 중복 ID ${[...new Set(dup)].join(', ')}`);
    if (missing.length) err(`${label}: 누락 ID ${missing.join(', ')}`);
    if (extra.length) err(`${label}: 정의되지 않은 ID ${extra.join(', ')}`);
    info.push(`${label}: ${items.length}종, 중복 ${new Set(dup).size}, 누락 ${missing.length}`);
  }

  // ---- 2. 효과 타입 사전 정합 ----
  const typeOk = (spec, v) => spec.split('|').some((t) => {
    if (t === 'null') return v === null;
    if (t === 'integer') return Number.isInteger(v);
    if (t === 'boolean') return typeof v === 'boolean';
    if (t === 'string') return typeof v === 'string';
    if (t.startsWith('enum:')) return enums[t.slice(5)]?.includes(v);
    return false;
  });
  function checkEffect(where, e) {
    for (const k of ['type', 'params', 'conditions', 'tags']) if (!(k in e)) err(`${where}: 효과에 ${k} 없음`);
    const def = dict.types[e.type];
    if (!def) { err(`${where}: 사전에 없는 효과 타입 "${e.type}"`); return; }
    for (const [k, v] of Object.entries(e.params ?? {})) {
      if (!(k in def.params)) err(`${where}: ${e.type} 에 허용되지 않은 파라미터 "${k}"`);
      else if (!typeOk(def.params[k], v)) err(`${where}: ${e.type}.${k} 값 ${JSON.stringify(v)} 이 ${def.params[k]} 가 아님`);
    }
    for (const [k, v] of Object.entries(e.conditions ?? {})) {
      if (!def.conditions.includes(k)) err(`${where}: ${e.type} 에 허용되지 않은 조건 "${k}"`);
      else if (!typeOk(dict.conditionKeys[k], v)) err(`${where}: 조건 ${k} 값 ${JSON.stringify(v)} 이 ${dict.conditionKeys[k]} 가 아님`);
    }
    if (!Array.isArray(e.tags)) err(`${where}: tags 가 배열이 아님`);
    // 기획서에 수치가 없어 null 인 값은 반드시 proposed([자작 제안])가 있어야 한다
    for (const [k, v] of Object.entries(e.params ?? {})) if (v === null && !(e.proposed && k in e.proposed)) err(`${where}: ${e.type}.${k} 가 null 인데 proposed.${k} 없음`);
  }

  // ---- 3. 필수 필드·enum·아이콘 ----
  const need = (where, o, keys) => { for (const k of keys) if (!(k in o)) err(`${where}: 필수 필드 ${k} 없음`); };
  const iconSeen = new Map();
  const missingIcons = [];
  function checkIcon(item) {
    const re = new RegExp(`^assets/flame-legacy/items/${ICON_DIR[item.id[0]]}/${item.id}_[a-z0-9]+(?:_[a-z0-9]+)*\\.png$`);
    if (typeof item.icon !== 'string' || !re.test(item.icon)) { err(`${item.id}: 아이콘 경로 규칙 위반 "${item.icon}"`); return; }
    if (iconSeen.has(item.icon)) err(`${item.id}: 아이콘 경로가 ${iconSeen.get(item.icon)} 와 중복`);
    iconSeen.set(item.icon, item.id);
    if (!fs.existsSync(path.join(assetRoot, item.icon))) missingIcons.push(item.icon);
  }
  for (const it of eq) {
    need(it.id, it, ['id', 'name', 'slot', 'rarity', 'specText', 'stats', 'effects', 'formationTags', 'shotTags', 'upgradeable', 'source', 'icon', 'proposed']);
    if (it.slot !== SLOT_OF[it.id?.[0]]) err(`${it.id}: slot "${it.slot}" 이 ID 접두와 맞지 않음`);
    if (!rarities.includes(it.rarity)) err(`${it.id}: rarity "${it.rarity}" enum 위반`);
    for (const [k, v] of Object.entries(it.stats ?? {})) if (!dict.stats.includes(k) || !Number.isInteger(v) || v === 0) err(`${it.id}: stats.${k}=${v} 잘못됨`);
    for (const t of it.formationTags ?? []) if (!tagIds.includes(t)) err(`${it.id}: formationTags "${t}" 미정의`);
    for (const t of it.shotTags ?? []) if (!famIds.includes(t)) err(`${it.id}: shotTags "${t}" 미정의`);
    if (typeof it.upgradeable !== 'boolean') err(`${it.id}: upgradeable 가 boolean 이 아님`);
    if ('sellPrice' in it) err(`${it.id}: sellPrice 는 [자작 제안]이므로 proposed.sellPrice 에 둔다`);
    if (!Number.isInteger(it.proposed?.sellPrice)) err(`${it.id}: proposed.sellPrice 없음`);
    (it.effects ?? []).forEach((e, i) => checkEffect(`${it.id}.effects[${i}]`, e));
    checkIcon(it);
  }
  const synIds = F.synergies.synergies.map((s) => s.id);
  for (const it of ar) {
    need(it.id, it, ['id', 'name', 'category', 'specText', 'effects', 'unlockShotFamilies', 'formationTag', 'synergyKeys', 'icon']);
    if (!CATEGORIES.includes(it.category)) err(`${it.id}: category "${it.category}" enum 위반`);
    const fromEffects = (it.effects ?? []).filter((e) => e.type === 'unlock_shot_family').map((e) => e.params.family);
    if (JSON.stringify(fromEffects) !== JSON.stringify(it.unlockShotFamilies)) err(`${it.id}: unlockShotFamilies 와 effects 의 해금 계열이 다름`);
    const condTags = [...new Set((it.effects ?? []).map((e) => e.conditions?.formationTag).filter(Boolean))];
    if ((it.formationTag ?? null) !== (condTags[0] ?? null) || condTags.length > 1) err(`${it.id}: formationTag 와 효과 조건이 다름`);
    if (it.formationTag !== null && !tagIds.includes(it.formationTag)) err(`${it.id}: formationTag "${it.formationTag}" 미정의`);
    const expectSyn = F.synergies.synergies.filter((s) => s.requires.artifacts.includes(it.id)).map((s) => s.id);
    if (JSON.stringify([...it.synergyKeys ?? []].sort()) !== JSON.stringify(expectSyn.sort())) err(`${it.id}: synergyKeys 가 synergies.json 과 다름`);
    (it.effects ?? []).forEach((e, i) => checkEffect(`${it.id}.effects[${i}]`, e));
    checkIcon(it);
  }
  for (const it of co) {
    need(it.id, it, ['id', 'name', 'kind', 'duration', 'specText', 'effects', 'stackMax', 'icon']);
    if (!KINDS.includes(it.kind)) err(`${it.id}: kind "${it.kind}" enum 위반`);
    if (!DURATIONS.includes(it.duration)) err(`${it.id}: duration "${it.duration}" enum 위반`);
    if (it.stackMax !== F.rules.consumables.stackMaxPerKind) err(`${it.id}: stackMax ${it.stackMax} 가 rules 의 ${F.rules.consumables.stackMaxPerKind} 과 다름`);
    if ((it.kind === 'heal') !== (it.effects ?? []).some((e) => e.type === 'heal_hp')) err(`${it.id}: kind 와 heal_hp 효과가 맞지 않음`);
    (it.effects ?? []).forEach((e, i) => checkEffect(`${it.id}.effects[${i}]`, e));
    checkIcon(it);
  }
  if (missingIcons.length) warn(`아이콘 파일 없음 ${missingIcons.length}/${iconSeen.size} (기준 ${path.relative(root, assetRoot) || '.'})`);

  // ---- 4. 시너지·계열·태그·노드 참조 ----
  const arIds = ar.map((a) => a.id);
  if (new Set(synIds).size !== synIds.length) err('synergies: 중복 ID');
  for (const s of F.synergies.synergies) {
    need(s.id, s, ['id', 'name', 'requires', 'specEffects', 'effects']);
    for (const a of s.requires?.artifacts ?? []) if (!arIds.includes(a)) err(`${s.id}: 조건 아티팩트 ${a} 없음`);
    if ((s.requires?.artifacts ?? []).length > F.rules.team.artifactSlots) err(`${s.id}: 조건 아티팩트 수가 슬롯 수를 넘음`);
    if (s.requires?.formationTag != null && !tagIds.includes(s.requires.formationTag)) err(`${s.id}: formationTag 미정의`);
    (s.effects ?? []).forEach((e, i) => {
      checkEffect(`${s.id}.effects[${i}]`, e);
      if (e.duplicatesArtifact && !arIds.includes(e.duplicatesArtifact)) err(`${s.id}: duplicatesArtifact ${e.duplicatesArtifact} 없음`);
    });
  }
  if (tagIds.length !== 6) err(`formation_tags: 태그 ${tagIds.length}종 (기대 6)`);
  for (const t of F.formation_tags.tags) if (t.mapping === null && !t.memo) err(`formation_tags.${t.id}: mapping 이 null 인데 memo 없음`);
  if (famIds.length !== 6) err(`shot_families: 계열 ${famIds.length}종 (기대 6)`);
  let usedShots = null, shotPower = null;
  try {
    const sp = JSON.parse(fs.readFileSync(path.join(root, 'server/data/specials.json'), 'utf8'));
    usedShots = new Set(sp.row.flat().filter((x) => x >= 0));
    shotPower = sp.power;
  } catch { warn('server/data/specials.json 을 읽지 못해 shotId 실재 여부를 대조하지 못함'); }
  const famSeen = new Map();
  for (const f of F.shot_families.families) {
    if (f.shotIds === null) {
      if (!/확인 필요/.test(f.status ?? '')) err(`shot_families.${f.id}: shotIds 가 null 인데 [확인 필요] 표시 없음`);
      warn(`shot_families.${f.id}: shotIds 미확정 [확인 필요]`);
    }
    for (const id of [...(f.shotIds ?? []), ...(f.proposed?.shotIds ?? []), ...(f.proposed?.extraShotIds ?? [])]) {
      if (usedShots && !usedShots.has(id)) err(`shot_families.${f.id}: shotId ${id} 가 기존 필살기 표(ROM 0x18732)에 없음`);
      if (f.overlap) continue; // 조건 태그 계열(강위력 = 위력 70 이상, analysis/39 D2)은 다른 계열과 겹친다
      if (famSeen.has(id)) err(`shot_families.${f.id}: shotId ${id} 가 ${famSeen.get(id)} 와 겹침`);
      famSeen.set(id, f.id);
    }
    // 위력 조건 태그: 표값이 powerMin 이상(255 = 표값 없음 제외)인 명단 ID 와 정확히 같아야 한다
    if (f.rule?.powerMin != null && shotPower && usedShots) {
      const want = [...usedShots].filter((id) => shotPower[id] !== 255 && shotPower[id] >= f.rule.powerMin).sort((a, b) => a - b);
      if (JSON.stringify(want) !== JSON.stringify([...(f.shotIds ?? [])].sort((a, b) => a - b))) err(`shot_families.${f.id}: shotIds 가 위력 ${f.rule.powerMin} 이상 ID 목록(${want.join(',')})과 다름`);
    }
    if (!arIds.includes(f.unlockedBy)) err(`shot_families.${f.id}: unlockedBy ${f.unlockedBy} 없음`);
    else if (!ar.find((a) => a.id === f.unlockedBy).unlockShotFamilies.includes(f.id)) err(`shot_families.${f.id}: ${f.unlockedBy} 가 이 계열을 해금하지 않음`);
  }
  // 확정된 계열표(analysis/39 D2): 배타 계열의 합 = 명단에 쓰이는 ID 중 표값 255(excluded)를 뺀 전부
  if (usedShots && shotPower && F.shot_families.families.every((f) => f.shotIds !== null)) {
    for (const id of usedShots) if (shotPower[id] !== 255 && !famSeen.has(id)) err(`shot_families: shotId ${id} 가 어느 계열에도 없음`);
    for (const id of famSeen.keys()) if (shotPower[id] === 255) err(`shot_families: shotId ${id} 는 위력 표값 255 라 해금 후보가 아님`);
  }
  for (const t of F.formation_tags.tags) if (t.mapping === null) { warn(`formation_tags: 기존 포메이션 매핑 미정 ${tagIds.length}종 (analysis/37 대기)`); break; }
  // 확정된 태그표(analysis/39 D7): 패턴 0~14 가 정확히 한 태그에 속한다
  if (F.formation_tags.tags.every((t) => Array.isArray(t.mapping))) {
    const all = F.formation_tags.tags.flatMap((t) => t.mapping).sort((a, b) => a - b);
    if (JSON.stringify(all) !== JSON.stringify(F.formation_tags.existingFormations.map((x) => x.name_idx).sort((a, b) => a - b))) err('formation_tags: mapping 이 포메이션 패턴 15종을 한 번씩 덮지 않음');
  }
  if (JSON.stringify(nodeIds) !== JSON.stringify(F.rules.nodeTypes)) err('nodes.types 와 rules.nodeTypes 가 다름');
  if (nodeIds.length !== 8) err(`nodes: ${nodeIds.length}종 (기대 8)`);

  // ---- 5. 기획서 표와 자동 대조 ----
  const specPath = path.join(root, 'analysis/36_flame_legacy_spec.md');
  let compared = 0;
  if (!fs.existsSync(specPath)) warn('analysis/36_flame_legacy_spec.md 가 없어 기획 대조를 건너뜀');
  else {
    const spec = fs.readFileSync(specPath, 'utf8');
    const rows = parseSpecItems(spec);
    const specIds = Object.keys(rows);
    if (specIds.length !== 90) err(`기획서 표에서 읽은 ID ${specIds.length}개 (기대 90)`);
    for (const it of [...eq, ...ar, ...co]) {
      const r = rows[it.id];
      if (!r) { err(`${it.id}: 기획서 표에 없음`); continue; }
      compared++;
      if (it.name !== r.name) err(`${it.id}: 이름 "${it.name}" ≠ 기획 "${r.name}"`);
      if (it.specText !== r.text) err(`${it.id}: specText 가 기획 원문과 다름`);
      if (r.rarity && it.rarity !== r.rarity) err(`${it.id}: 등급 ${it.rarity} ≠ 기획 ${r.rarity}`);
      const isEq = 'slot' in it;
      const stats = isEq ? { ...it.stats } : {};
      const statEffects = (it.effects ?? []).filter((e) => e.type === 'stat_bonus').map((e) => ({ stat: e.params.stat, value: e.params.value, used: false }));
      for (const phrase of r.text.split(', ')) {
        const p = statPhrase(phrase);
        if (!p) continue;
        if (isEq && stats[p.stat] === p.value) { delete stats[p.stat]; continue; }
        const hit = statEffects.find((e) => !e.used && e.stat === p.stat && e.value === p.value);
        if (hit && !(isEq && p.exact)) hit.used = true;
        // 조건부 투구 속도(예: 패스 직후 다음 투구 속도 +4)는 능력치가 아니라 throw_speed_bonus 로 옮긴다
        else if (!p.exact && p.stat === 's6' && (it.effects ?? []).some((e) => e.type === 'throw_speed_bonus' && e.params.value === p.value)) continue;
        else err(`${it.id}: 기획 "${phrase}" 에 대응하는 ${isEq && p.exact ? 'stats' : '효과'} ${p.stat} ${p.value} 없음`);
      }
      for (const k of Object.keys(stats)) err(`${it.id}: stats.${k}=${stats[k]} 가 기획 문구에 없음`);
      for (const e of statEffects) if (!e.used && e.value !== null) err(`${it.id}: stat_bonus ${e.stat} ${e.value} 가 기획 문구에 없음`);
      // 문구의 모든 숫자가 데이터에 있어야 한다(위력·회복량·차지 구간 등 능력치 구절이 아닌 수치 포함)
      const have = numbersOf({ stats: it.stats, effects: it.effects });
      for (const n of numbersIn(r.text.replace('선수 1명의', ''))) { // '선수 1명' 은 대상(target=player)이지 수치가 아니다
        const i = have.indexOf(n);
        if (i < 0) err(`${it.id}: 기획 수치 ${n} 이 데이터에 없음 ("${r.text}")`);
        else have.splice(i, 1);
      }
    }
    // 표·문장 수치 대조
    const cmp = (label, re, actual) => {
      const m = spec.match(re);
      if (!m) { err(`기획 대조: "${label}" 문구를 기획서에서 찾지 못함`); return; }
      const want = m.slice(1).map((x) => Number(x));
      const got = [].concat(actual);
      if (JSON.stringify(want) !== JSON.stringify(got)) err(`기획 대조: ${label} 기획 ${want.join('/')} ≠ 데이터 ${got.join('/')}`);
      compared++;
    };
    const R = F.rules, EC = F.economy;
    cmp('선수 구성', /기본 선수 구성: (\d+)명/, R.team.players);
    cmp('장비 슬롯', /선수별 장비 슬롯: (\d+)개/, R.team.equipmentSlotsPerPlayer);
    cmp('팀 장비 슬롯', /팀 전체 장비 슬롯: 최대 (\d+)개/, R.team.teamEquipmentSlots);
    cmp('아티팩트 슬롯', /공용 아티팩트 슬롯: (\d+)개/, R.team.artifactSlots);
    cmp('구간 수', /기본 도전: 총 (\d+)개 구간/, R.run.segments);
    cmp('경기 수', /기본 경기: 총 (\d+)경기/, R.run.matches);
    cmp('구간별 보스', /구간별 보스 경기: (\d+)회/, R.run.bossPerSegment);
    cmp('전체 보스', /전체 보스 경기: (\d+)회/, R.run.bosses);
    cmp('등급 확률', /- 일반: (\d+)%\s+- 희귀: (\d+)%\s+- 영웅: (\d+)%\s+- 전설: (\d+)%/, rarities.map((k) => R.rarity.dropRatePct[k]));
    cmp('소모품 보유 상한', /소모품 보유 상한은 (\d+)개/, R.consumables.inventoryMax);
    cmp('소모품 종류당 상한', /종류별로 최대 (\d+)개/, R.consumables.stackMaxPerKind);
    cmp('넉백 저항 상한', /초기 밸런스 상한: (\d+)%/, [R.clamps.r1MaxPct]);
    cmp('밀림 감소 상한', /초기 상한: (\d+)%/, [R.clamps.r2MaxPct]);
    cmp('쓰러짐 기본', /기본 쓰러짐: (\d+)프레임/, R.clamps.downFramesBase);
    cmp('쓰러짐 최대 단축', /아이템으로 최대 (\d+)프레임 단축/, R.clamps.r3MaxShortenFrames);
    cmp('쓰러짐 최소', /최소 쓰러짐 시간: (\d+)프레임/, R.clamps.downFramesMin);
    cmp('이동속도 상한', /이동속도 상한: (\d+(?:\.\d+)?)px\/프레임/, R.clamps.moveSpeedCapPxPerFrame);
    cmp('보상 선택지', /장비 보상을 (\d+)개 제시/, R.reward.equipmentChoices);
    cmp('강화 최대', /최대 \+(\d+)까지 강화/, EC.upgrade.maxLevel);
    cmp('강화 비용', /\| \+1 \| (\d+) \|[^\n]*\n\| \+2 \| (\d+) \|[^\n]*\n\| \+3 \| (\d+) \|/, EC.upgrade.costs);
    cmp('강화 보너스', /\+1 \| \d+ \| 기본 능력치 보너스 약 (\d+)%[^\n]*\n[^\n]*약 (\d+)%[^\n]*\n[^\n]*약 (\d+)%/, EC.upgrade.bonusPct);
    cmp('코인 일반', /\| 일반 경기 승리 \| (\d+) \|/, EC.flameCoin.normalWin);
    cmp('코인 강팀', /\| 강팀 경기 승리 \| (\d+) \|/, EC.flameCoin.strongWin);
    cmp('코인 보스', /\| 보스 경기 승리 \| (\d+) \|/, EC.flameCoin.bossWin);
    cmp('코인 우승', /\| 최종 우승 \| 추가 (\d+) \|/, EC.flameCoin.championshipBonus);
    cmp('코인 첫 우승', /\| 첫 우승 보너스 \| 추가 (\d+) \|/, EC.flameCoin.firstChampionshipBonus);
    for (const u of F.perm_upgrades.training) {
      const m = spec.match(new RegExp(`\\| ${u.name} \\| (\\d+) \\| (.+?) \\| ([\\d /]+) \\|`));
      if (!m) { err(`기획 대조: 영구 성장 A "${u.name}" 행 없음`); continue; }
      compared++;
      const costs = m[3].split('/').map((x) => Number(x.trim()));
      const per = Number(m[2].match(/\+(\d+)$/)?.[1]);
      if (Number(m[1]) !== u.maxLevel || JSON.stringify(costs) !== JSON.stringify(u.costs) || per !== u.effect.perLevel || m[2] !== u.specText || costs.length !== u.maxLevel) err(`기획 대조: 영구 성장 ${u.id} ${u.name} 이 기획 표와 다름`);
    }
    for (const u of F.perm_upgrades.preparation) {
      const m = spec.match(new RegExp(`\\| ${u.name} \\| (\\d+) \\| (.+?) \\|`));
      if (!m) { err(`기획 대조: 영구 성장 B "${u.name}" 행 없음`); continue; }
      compared++;
      if (Number(m[1]) !== u.maxLevel || m[2] !== u.specText) err(`기획 대조: 영구 성장 ${u.id} ${u.name} 이 기획 표와 다름`);
      if (u.costs !== null) err(`${u.id}: 기획서에 비용이 없으므로 costs 는 null, 제안은 proposed.costs`);
      if (u.proposed?.costs?.length !== u.maxLevel) err(`${u.id}: proposed.costs 길이가 maxLevel 과 다름`);
    }
    for (const c of F.perm_upgrades.content) if (!spec.includes(`- ${c.name}`)) err(`기획 대조: 콘텐츠 해금 "${c.name}" 없음`);
    for (const t of F.nodes.types) if (!spec.includes(`- ${t.name}: ${t.specText}`)) err(`기획 대조: 노드 "${t.name}: ${t.specText}" 없음`);
    for (const t of F.formation_tags.tags) if (!spec.includes(`- ${t.name}`)) err(`기획 대조: 포메이션 태그 "${t.name}" 없음`);
    for (const o of F.nodes.trainingOptions) if (!spec.includes(`- ${o.name}:`)) err(`기획 대조: 특훈 "${o.name}" 없음`);
    const order = [...spec.matchAll(/^(\d)\. (.+)$/gm)].filter((m) => m.index > spec.indexOf('## 14.1') && m.index < spec.indexOf('## 14.2'));
    if (order.length !== 9 || order.some((m, i) => m[2] !== R.calcOrder[i]?.name || Number(m[1]) !== R.calcOrder[i]?.step)) err('기획 대조: calcOrder 가 §14.1 의 9단계와 다름');
    else compared++;
    for (const s of F.synergies.synergies) for (const line of s.specEffects) if (!spec.includes(line)) err(`기획 대조: ${s.id} 문구 "${line}" 없음`);
  }
  if (F.perm_upgrades.training.length !== 4 || F.perm_upgrades.preparation.length !== 7 || F.perm_upgrades.content.length !== 6) err('perm_upgrades: A 4종·B 7종·C 6종이 아님');
  info.push(`기획서 대조 ${compared}건`);
  info.push(`아이콘 경로 ${iconSeen.size}개, 파일 없음 ${missingIcons.length}개`);

  // ---- 6. 오리지널 팀(original_team.json, analysis/39 D17·D20·D21) ----
  const DEC = load('decisions.json'), CFG = load('run_config.json');
  const EN = fs.existsSync(path.join(dataDir, 'endless.json')) ? load('endless.json') : null, endlessOn = EN?.enabled === true; // 엔드리스(39 D24). 8절에서 검사한다
  const startId = DEC?.roster?.startOriginal;
  if (!fs.existsSync(path.join(dataDir, 'original_team.json'))) {
    if (startId !== undefined) err(`decisions.json roster.startOriginal=${startId} 인데 original_team.json 이 없음`);
    info.push('오리지널 팀: 파일 없음(시작 팀 = 태동)');
  } else if (DEC && CFG) {
    const O = load('original_team.json');
    const readJson = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; } };
    const teams = readJson('server/data/teams.json')?.teams, bodyClass = readJson('server/data/romtables.json')?.bodyClass, spRow = readJson('server/data/specials.json')?.row;
    if (O && (!teams || !bodyClass || !spRow)) err('original_team: server/data 의 teams·romtables·specials 를 읽지 못해 대조할 수 없음');
    else if (O) {
      const str = (v) => typeof v === 'string' && v.length > 0;
      const real = (v) => !!v && Number.isInteger(v.team) && Number.isInteger(v.idx) && !!teams[v.team]?.players?.[v.idx];
      for (const k of ['id', 'name', 'short', 'intro', 'protagonist']) if (!str(O[k])) err(`original_team.${k} 없음`);
      if (startId !== undefined && startId !== O.id) err(`decisions.json roster.startOriginal=${startId} 가 original_team.id(${O.id})와 다름`);
      const nUni = O.skinSets?.uniforms, nHair = O.skinSets?.hairs;
      if (!Number.isInteger(nUni) || nUni < 1 || !Number.isInteger(nHair) || nHair < 0) err('original_team.skinSets(uniforms·hairs) 잘못됨');
      for (const k of ['protagonistLocked', 'recruitExcludeSkinBodies']) if (O.rules?.[k] !== undefined && typeof O.rules[k] !== 'boolean') err(`original_team.rules.${k} 가 boolean 이 아님`);
      const ps = Array.isArray(O.players) ? O.players : [];
      if (ps.length !== F.rules.team.players) err(`original_team.players ${ps.length}명 (기대 ${F.rules.team.players})`);
      const roleIds = CFG.roles.map((r) => r.id), excluded = new Set(DEC.special.excludedShotIds);
      const seen = { id: new Set(), name: new Set(), base: new Set(), body: new Set() };
      const once = (set, v, what) => { if (set.has(v)) err(`original_team: ${what} 중복 ${v}`); set.add(v); };
      for (const [i, p] of ps.entries()) {
        const w = `original_team.players[${i}]`;
        need(w, p, ['id', 'name', 'role', 'tagline', 'base', 'skin']);
        if (!str(p.id) || !str(p.name) || !str(p.tagline)) err(`${w}: id·name·tagline 은 빈 문자열일 수 없음`);
        once(seen.id, p.id, 'id'); once(seen.name, p.name, '이름');
        if (!roleIds.includes(p.role)) err(`${w}: role "${p.role}" 이 run_config.roles 에 없음`);
        if (!real(p.base)) { err(`${w}.base: 없는 선수 ${p.base?.team}:${p.base?.idx}`); continue; }
        if (!real(p.skin)) { err(`${w}.skin: 없는 선수 ${p.skin?.team}:${p.skin?.idx}`); continue; }
        once(seen.base, `${p.base.team}:${p.base.idx}`, 'base(엔진이 같은 선수 중복을 거절한다)'); once(seen.body, `${p.skin.team}:${p.skin.idx}`, 'skin 몸');
        if (!Number.isInteger(p.skin.uni) || p.skin.uni < 1 || p.skin.uni > nUni) err(`${w}.skin.uni=${p.skin.uni} (1~${nUni})`);
        if (!Number.isInteger(p.skin.hair) || p.skin.hair < 0 || p.skin.hair > nHair) err(`${w}.skin.hair=${p.skin.hair} (0~${nHair}, 0 = 원본 유지)`);
        const cb = bodyClass[p.base.team]?.[p.base.idx], cs = bodyClass[p.skin.team]?.[p.skin.idx];
        if (cb !== cs) err(`${w}: skin 몸통 분류 ${cs} 가 base 의 ${cb} 와 다름(히트박스·손 위치가 그림과 어긋난다)`);
        const sp = spRow[p.base.team]?.[p.base.idx];
        if (!(Number.isInteger(sp) && sp >= 0 && !excluded.has(sp))) err(`${w}.base: 기본 필살기 없음(${sp})`);
      }
      if (ps[DEC.roster.captainSlot]?.id !== O.protagonist) err(`original_team.protagonist(${O.protagonist}) 가 주장 칸(${DEC.roster.captainSlot}) 선수가 아님`);
      // 원작 이름과 겹치지 않는다(화면 이름표: public/assets/data/team_names.json)
      const names = readJson(path.relative(root, path.join(assetRoot, 'assets/data/team_names.json')))?.teams;
      if (names) {
        const taken = new Set(names.flatMap((t) => [t.name, t.label, ...(t.players ?? [])]).filter(Boolean));
        for (const n of [O.name, ...ps.map((p) => p.name)]) if (taken.has(n)) err(`original_team: 이름 "${n}" 이 원작 이름과 겹침`);
      }
      // 참고(오류 아님): 몸을 빌린 팀이 상대 풀에 있으면 같은 몸이 양쪽에 나올 수 있다(엔진의 중복 거절은 flame 로스터 7칸 안의 from 만 본다)
      const opp = new Set(CFG.opponents.segments.flatMap((s) => ['normal', 'strong', 'boss'].flatMap((k) => [...s[k], ...(s.unlocked?.[k] ?? [])])));
      const skinTeams = [...new Set(ps.map((p) => p.skin?.team))].filter((t) => opp.has(t)).sort((a, b) => a - b);
      info.push(`오리지널 팀 "${O.name}"(${O.id}): ${ps.length}명, 시작 팀 ${startId === O.id ? '켜짐' : '꺼짐(태동 시작)'}, 주인공 교체 잠금 ${O.rules?.protagonistLocked === true ? '켜짐' : '꺼짐'}, 몸을 빌린 팀 중 상대 풀에 있는 팀 [${skinTeams.join(', ')}]`);
    }
  }

  // ---- 7. 영입 풀(recruit_pool.json + recruit_pool_spec.json, analysis/39 D18·D22, analysis/42 §8) ----
  const RC = CFG?.recruit;
  if (RC && !fs.existsSync(path.join(dataDir, 'recruit_pool.json'))) {
    if (RC.clone !== undefined) warn('run_config recruit.clone 이 있는데 recruit_pool.json 이 없음(영입은 종전대로 원작 선수만 나온다)');
    info.push('영입 풀: 파일 없음(영입 후보 = 원작 선수만)');
  } else if (RC && DEC) {
    const P = load('recruit_pool.json'), SP = load('recruit_pool_spec.json');
    const rj = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; } };
    const teams = rj('server/data/teams.json')?.teams, spec255 = rj('server/data/specials.json')?.power, OT = fs.existsSync(path.join(dataDir, 'original_team.json')) ? load('original_team.json') : null;
    if (P && SP) {
      // (1) 생성 도구 결과와 같은가(손으로 고친 풀·입력만 고치고 다시 만들지 않은 풀을 잡는다)
      let gen = null;
      try { gen = generatePool(SP); } catch (e) { err(`recruit_pool_spec: 생성 실패 (${e.message})`); }
      if (gen && serializePool(gen) !== fs.readFileSync(path.join(dataDir, 'recruit_pool.json'), 'utf8')) err('recruit_pool.json 이 recruit_pool_spec.json 으로 다시 생성한 결과와 다름(tools/gen_recruit_pool.mjs --write 로 다시 만든다. 풀은 손으로 고치지 않는다)');
      // (2) 파일 내용 자체 검사(생성 도구와 따로 본다)
      const M = P.model ?? {}, ps = Array.isArray(P.players) ? P.players : [], N = SP.names ?? {}, roleIds = (CFG.roles ?? []).map((r) => r.id);
      const total = (SP.batches ?? []).reduce((s, b) => s + b.count, 0);
      if (P._meta?.poolId !== `rp${P._meta?.version}-s${SP.batches?.[0]?.seed}-n${total}`) err(`recruit_pool._meta.poolId "${P._meta?.poolId}" 가 규칙 rp<버전>-s<시드>-n<인원> 과 다름`);
      if (ps.length !== total) err(`recruit_pool.players ${ps.length}명 (입력 합 ${total})`);
      const bodyOk = new Set((SP.bodies?.list ?? []).flatMap((t) => t.idx.map((i) => `${t.team}:${i}`))), hairOk = new Set((SP.bodies?.list ?? []).flatMap((t) => t.hair.map((i) => `${t.team}:${i}`)));
      const startSkins = new Set((OT?.players ?? []).map((p) => `${p.skin?.team}:${p.skin?.idx}`)), named = new Set((SP.bodies?.namedFaces ?? []).map(([t, i]) => `${t}:${i}`));
      for (const k of bodyOk) {
        if (startSkins.has(k)) err(`recruit_pool_spec.bodies: ${k} 는 시작 7명이 빌린 몸`);
        if (named.has(k)) err(`recruit_pool_spec.bodies: ${k} 는 방영판 이름이 확정된 얼굴(39 D21 규칙 3)`);
        if (teams && !teams[+k.split(':')[0]]?.players?.[+k.split(':')[1]]) err(`recruit_pool_spec.bodies: 없는 선수 ${k}`);
      }
      const surs = new Set((N.surnames ?? []).flatMap(([l]) => l)), givens = new Set(N.given ?? []), bannedPrefix = new Set(N.bannedPrefix ?? []), bannedFull = new Set(N.bannedFull ?? []);
      const startNames = (OT?.players ?? []).map((p) => p.name), startGiven = new Set(startNames.map((n) => n.slice(1)));
      const origNames = new Set((rj(path.relative(root, path.join(assetRoot, 'assets/data/team_names.json')))?.teams ?? []).flatMap((t) => [t.name, t.label, ...(t.players ?? [])]).filter(Boolean));
      for (const g of givens) if (startGiven.has(g)) err(`recruit_pool_spec.names.given: "${g}" 는 시작 7명의 이름`);
      const excluded = new Set(DEC.special.excludedShotIds), forbid = new Set(SP.shots?.forbidden ?? []);
      const seen = { id: new Set(), name: new Set(), look: new Set() }, givenUse = {}, cell = {};
      ps.forEach((p, i) => {
        const w = `recruit_pool ${p?.id ?? `players[${i}]`}`;
        need(w, p, ['id', 'name', 'role', 'grade', 'pts', 'stat', 'sp', 'body', 'skin']);
        if (p.id !== 'c' + String(i + 1).padStart(3, '0')) err(`${w}: id 가 순번 규칙(c001~, 빈 번호·재사용 없음)과 다름`);
        for (const [set, v, what] of [[seen.id, p.id, 'id'], [seen.name, p.name, '이름'], [seen.look, `${p.body?.team}:${p.body?.idx}:${p.skin?.uni}:${p.skin?.hair}`, '겉모습(몸·유니폼·머리)']]) { if (set.has(v)) err(`${w}: ${what} 중복 ${v}`); set.add(v); }
        const sur = String(p.name).slice(0, 1), giv = String(p.name).slice(1);
        givenUse[giv] = (givenUse[giv] ?? 0) + 1;
        if (!surs.has(sur) || !givens.has(giv)) err(`${w}: 이름 "${p.name}" 이 성·이름 목록에 없음`);
        if (sur === giv[0] || bannedPrefix.has(sur + giv[0]) || bannedFull.has(p.name) || startNames.includes(p.name) || origNames.has(p.name)) err(`${w}: 이름 "${p.name}" 금칙`);
        if (!roleIds.includes(p.role) || !M.roles?.[p.role]) err(`${w}: role "${p.role}"`);
        if (!(p.grade in (M.grades ?? {}))) err(`${w}: grade "${p.grade}"`);
        (cell[p.grade] ??= {})[p.role] = (cell[p.grade]?.[p.role] ?? 0) + 1;
        // 점수 합계 = 등급 예산 + 역할 보정점 = 능력치로 다시 계산한 값, 능력치는 상·하한 안
        const want = (M.grades?.[p.grade] ?? NaN) + (M.roles?.[p.role]?.adj ?? NaN), calc = M.unit && p.stat ? scoreOf(M, p.stat) : NaN;
        if (p.pts !== want || Math.abs(calc - want) > 1e-9) err(`${w}: 점수 pts=${p.pts}, 능력치 계산 ${calc}, 예산 ${want}`);
        for (const k of POOL_STATS) { const v = p.stat?.[k], L = M.limits?.[k]; if (!Number.isInteger(v) || !L || v < L[0] || v > L[1]) err(`${w}: stat.${k}=${v} (범위 ${L?.[0]}~${L?.[1]})`); }
        const bk = `${p.body?.team}:${p.body?.idx}`;
        if (!bodyOk.has(bk)) err(`${w}: 몸 ${bk} 이 몸 목록에 없음`);
        if (!(SP.uniforms ?? []).includes(p.skin?.uni)) err(`${w}: skin.uni=${p.skin?.uni}`);
        if (hairOk.has(bk) ? !(SP.hairs ?? []).includes(p.skin?.hair) : p.skin?.hair !== 0) err(`${w}: skin.hair=${p.skin?.hair} (머리색을 바꿀 수 있는 몸만 1~, 나머지 0)`);
        const tier = SP.shots?.byRole?.[p.role]?.[p.grade] ?? SP.shots?.byRole?.[p.role]?.low ?? [];
        if (!tier.includes(p.sp) || forbid.has(p.sp) || excluded.has(p.sp) || (spec255 && spec255[p.sp] === 255)) err(`${w}: 기본 필살기 ${p.sp} (역할·등급 후보 밖이거나 금지 ID)`);
      });
      for (const [g, n] of Object.entries(givenUse)) if (n > (N.givenMaxUse ?? 0)) err(`recruit_pool: 이름 2자 "${g}" ${n}번 (최대 ${N.givenMaxUse})`);
      // 역할 × 등급 인원이 입력(묶음별 최대잉여법의 합)과 같은가
      const wantCell = {};
      for (const b of SP.batches ?? []) for (const [g, row] of Object.entries(cellCounts(b.gradeQuota, SP.roleWeight))) for (const [r, n] of Object.entries(row)) (wantCell[g] ??= {})[r] = (wantCell[g]?.[r] ?? 0) + n;
      for (const g of GRADES) for (const r of Object.keys(SP.roleWeight ?? {})) if ((cell[g]?.[r] ?? 0) !== (wantCell[g]?.[r] ?? 0)) err(`recruit_pool: ${r}×${g} ${cell[g]?.[r] ?? 0}명 (입력 ${wantCell[g]?.[r] ?? 0})`);
      for (const id of SP.retired ?? []) if (!ps.find((p) => p.id === id)?.retired) err(`recruit_pool: retired ${id} 가 풀에 은퇴로 적혀 있지 않음`);
      // (2-1) 기존 id 의 몸 불변(몸 잠금 파일과 대조). 새 id 는 오류가 아니다(--update-body-lock 으로 잠근다)
      const lockPath = bodyLock ?? path.join(root, BODY_LOCK_REL);
      if (!fs.existsSync(lockPath)) warn(`영입 풀 몸 잠금 파일(${BODY_LOCK_REL})이 없어 기존 id 의 body 불변을 대조하지 못함`);
      else {
        let lock = null;
        try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (e) { err(`recruit_pool_body_lock: 읽기 실패 (${e.message})`); }
        if (lock) {
          const d = diffBodyLock(lock, ps);
          if (d.changed.length) err(`recruit_pool: 이미 내보낸 id 의 body 가 바뀜 ${d.changed.length}명 (${d.changed.slice(0, 5).join(', ')}${d.changed.length > 5 ? ' …' : ''}). 저장된 도전의 클론이 원작 선수로 읽힌다 - 몸은 그대로 두고 새 id 를 쓴다`);
          if (d.missing.length) err(`recruit_pool: 잠긴 id 가 풀에서 사라짐 ${d.missing.length}명 (${d.missing.slice(0, 5).join(', ')}${d.missing.length > 5 ? ' …' : ''}). 빼는 선수는 지우지 않고 retired 에 적는다`);
          info.push(`영입 풀 몸 잠금: ${Object.keys(lock.bodies ?? {}).length}명 대조, 바뀜 ${d.changed.length}·사라짐 ${d.missing.length}${d.added.length ? `, 아직 잠기지 않은 새 id ${d.added.length}명(내보내기 전에 --update-body-lock)` : ''}`);
        }
      }
      // (3) run_config recruit 의 2차 키
      const nSeg = F.rules.run.segments;
      // 엔드리스(endless.json, 39 D24)가 켜져 있으면 구간별 표는 '구간 수 이상'(마지막 줄이 구간 4+ 에 쓰인다), 꺼져 있으면 종전대로 정확히 구간 수
      const segLenOk = (n) => (endlessOn ? n >= nSeg : n === nSeg);
      if (RC.clone === undefined) warn('recruit_pool.json 은 있는데 run_config recruit.clone 이 없음(영입은 종전대로 원작 선수만 나온다)');
      else {
        const G = RC.clone.gradePct;
        if (!Array.isArray(G) || !segLenOk(G.length) || G.some((row) => !Array.isArray(row) || row.length !== GRADES.length || row.some((v) => !(v >= 0)))) err(`run_config recruit.clone.gradePct 는 구간 ${nSeg}줄 × 등급 ${GRADES.length}칸`);
        else G.forEach((row, s) => { if (row.reduce((a, v) => a + v, 0) !== 100) warn(`run_config recruit.clone.gradePct[${s}] 합 ${row.reduce((a, v) => a + v, 0)} (100 이 아님. 가중치로 읽힌다)`); row.forEach((v, gi) => { if (v > 0 && !ps.some((p) => p.grade === GRADES[gi] && !p.retired)) err(`run_config recruit.clone.gradePct[${s}]: ${GRADES[gi]} 급 확률 ${v} 인데 풀에 그 등급이 없음`); }); });
      }
      const O = RC.original;
      let rareInfo = '원작 희귀 칸 꺼짐';
      if (O !== undefined) {
        if (!Array.isArray(O.visitPct) || !segLenOk(O.visitPct.length) || O.visitPct.some((v) => !(v >= 0 && v <= 100))) err('run_config recruit.original.visitPct');
        if (!Number.isInteger(O.maxPerVisit) || O.maxPerVisit < 0) err('run_config recruit.original.maxPerVisit');
        if (!Array.isArray(O.segmentTeams) || !segLenOk(O.segmentTeams.length)) err('run_config recruit.original.segmentTeams');
        else if (teams && M.unit) {
          // 참고: 구간별 희귀 칸 대상 인원(영구 성장 PC01 없음 / 전부). 통키 팀·22~24 제외, 기본 필살기 있음, 점수 minPts 이상
          const ex = new Set(RC.excludeTeams), spRow = rj('server/data/specials.json')?.row, count = (pool, seg) => pool.filter((t) => O.segmentTeams[seg].includes(t) && !ex.has(t)).reduce((s, t) => s + teams[t].players.filter((p) => { const sp = spRow?.[t]?.[p.idx]; return Number.isInteger(sp) && sp >= 0 && !excluded.has(sp) && (O.minPts == null || scoreOf(M, p) >= O.minPts); }).length, 0);
          const full = [...RC.basePool, ...CFG.unlocks.content.PC01.grants.flatMap((g) => g.recruitTeams ?? [])];
          for (const t of [0]) if (!ex.has(t)) warn(`run_config recruit.excludeTeams 에 통키 팀(${t})이 없음(39 D18: 영입 대상 제외)`);
          rareInfo = `원작 희귀 칸 방문당 ${O.visitPct.join('/')}% × ${O.maxPerVisit}, 점수 ${O.minPts ?? '제한 없음'} 이상, 구간별 대상 인원(PC01 없음 ${[0, 1, 2].slice(0, nSeg).map((s) => count(RC.basePool, s)).join('/')}, 전부 ${[0, 1, 2].slice(0, nSeg).map((s) => count(full, s)).join('/')})`;
        }
      }
      const sum = summarizePool(P);
      info.push(`영입 풀 ${P._meta?.poolId}: ${sum.count}명(은퇴 ${sum.retired}), 평균 점수 ${sum.avgPts.toFixed(2)}, 등급 ${GRADES.map((g) => `${g} ${sum.byGrade[g].n}`).join('·')}, 몸 ${sum.bodies}개(몸당 ${sum.bodyMin}~${sum.bodyMax}명), 이름 중복 ${sum.dupNames}·겉모습 중복 ${sum.dupLooks}, ${rareInfo}`);
    }
  }

  // ---- 8. 엔드리스(endless.json, analysis/39 D24) ----
  if (!fs.existsSync(path.join(dataDir, 'endless.json'))) info.push('엔드리스: 파일 없음(종전 = 구간 3 보스 승리로 도전 종료)');
  else if (EN) {
    const int = (v, min) => Number.isInteger(v) && v >= min, R = F.rules;
    if (typeof EN.enabled !== 'boolean') err('endless.json enabled 는 true|false');
    if (R && !int(EN.items?.max, R.team.players * R.team.equipmentSlotsPerPlayer)) err('endless.json items.max 는 선수 수 × 장비 슬롯 이상의 정수');
    if (!int(EN.artifactFallbackPoints, 0)) err('endless.json artifactFallbackPoints');
    if (!int(EN.rerollPerBoss?.fromSegment, 1) || !int(EN.rerollPerBoss?.add, 0)) err('endless.json rerollPerBoss{fromSegment, add}');
    if (!int(EN.recruitShownMax, 1) || !int(EN.bossesKeep, 1) || !int(EN.ranking?.top, 1)) err('endless.json recruitShownMax·bossesKeep·ranking.top');
    if (CFG && R && endlessOn) for (const [w, rows] of [['opponents.segments', CFG.opponents?.segments], ['reward.rarityShift.segment', CFG.reward?.rarityShift?.segment]]) if (!Array.isArray(rows) || rows.length < R.run.segments) err(`run_config ${w} 는 구간 ${R.run.segments}줄 이상(엔드리스: 마지막 줄이 그 뒤 구간에 쓰인다)`);
    info.push(`엔드리스: ${endlessOn ? '켜짐' : '꺼짐'}(우승 기준 구간 ${R?.run.segments}, 장비 상한 ${EN.items?.max}, 아티팩트 고갈 대체 ${EN.artifactFallbackPoints}점, 구간 ${EN.rerollPerBoss?.fromSegment}+ 보스마다 재선택 +${EN.rerollPerBoss?.add}, 순위표 ${EN.ranking?.top}줄)`);
  }

  // ---- 9. 연습 경기(run_config.json practice, analysis/39 D28). 키가 없으면 꺼짐(종전 동작) ----
  if (CFG && CFG.practice !== undefined) {
    const P = CFG.practice, max = CFG.opponents?.cpuLevelMax;
    if (!P || typeof P.enabled !== 'boolean') err('run_config practice.enabled 는 true|false');
    if (P && P.cpuLevel !== undefined && !(Number.isInteger(P.cpuLevel) && P.cpuLevel >= 1 && P.cpuLevel <= max)) err(`run_config practice.cpuLevel 은 1~${max} 의 정수`);
    info.push(`연습 경기: ${P?.enabled === true ? '켜짐' : '꺼짐'}(상대 레벨 ${P?.cpuLevel ?? '구간 1 일반과 같음'})`);
  } else if (CFG) info.push('연습 경기: 키 없음(꺼짐)');

  // ---- 10. 영입실 입장 회복(run_config.json recruitRoom.healPct, analysis/39 D29). 키가 없거나 0 이면 꺼짐(종전 동작) ----
  if (CFG && CFG.recruitRoom !== undefined) {
    const H = CFG.recruitRoom?.healPct;
    if (!CFG.recruitRoom || typeof CFG.recruitRoom !== 'object' || (H !== undefined && !(Number.isFinite(H) && H >= 0 && H <= 100))) err('run_config recruitRoom.healPct 는 0~100 의 수');
    info.push(`영입실 입장 회복: ${H > 0 ? `전원 최대 HP 의 ${H}%` : '꺼짐(0 또는 키 없음)'}`);
  } else if (CFG) info.push('영입실 입장 회복: 키 없음(꺼짐)');

  // ---- 11. 보스 뒤 회복(rest.afterBossHealPct, 39 D30)·특훈 누적 상한(training.maxPerStat, D31)·난이도 레벨 가산(difficulty[].cpuLevelAdd, D32). 키가 없으면 종전 동작 ----
  if (CFG) {
    const B = CFG.rest?.afterBossHealPct, W = CFG.rest?.afterWinHealPct, M = CFG.training?.maxPerStat;
    if (B !== undefined && !(Number.isFinite(B) && B >= 0 && B <= 100)) err('run_config rest.afterBossHealPct 는 0~100 의 수');
    info.push(`보스 뒤 회복: ${B === undefined ? `키 없음(승리 뒤 회복 ${W ?? 0}% 와 같음)` : `전원 최대 HP 의 ${B}%(일반·강팀 승리는 ${W ?? 0}%)`}`);
    if (M !== undefined) {
      const opts = F.nodes.trainingOptions.map((t) => ({ stat: t.stat, value: t.value ?? CFG.training?.values?.[t.id] }));
      if (!M || typeof M !== 'object' || Array.isArray(M)) err('run_config training.maxPerStat 는 {능력치 키: 0 이상의 정수}');
      else for (const [k, v] of Object.entries(M)) {
        if (!dict.stats.includes(k) || !Number.isInteger(v) || v < 0) err(`run_config training.maxPerStat.${k}=${v} (능력치 키·0 이상의 정수)`);
        else if (!opts.some((o) => o.stat === k)) warn(`run_config training.maxPerStat.${k}: 그 능력치를 올리는 특훈이 없음`);
      }
      info.push(`특훈 누적 상한: ${M && typeof M === 'object' ? Object.entries(M).map(([k, v]) => `${k} ${v}(${opts.filter((o) => o.stat === k).map((o) => `회당 ${o.value} = ${Math.floor(v / o.value)}회`).join(', ')})`).join(' · ') : '-'}`);
    } else info.push('특훈 누적 상한: 키 없음(상한 없음)');
    for (const d of CFG.difficulty ?? []) {
      const a = d.cpuLevelAdd, isObj = a !== null && typeof a === 'object' && !Array.isArray(a);
      if (!(Number.isInteger(a) || (isObj && Object.entries(a).every(([k, v]) => ['normal', 'strong', 'boss'].includes(k) && Number.isInteger(v))))) err(`run_config difficulty[${d.id}].cpuLevelAdd 는 정수 또는 {normal, strong, boss} 정수`);
    }
  }

  const ok = errors.length === 0 && (!strict || warnings.length === 0);
  return { ok, errors, warnings, info, counts, missingIcons };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--update-body-lock')) {
    const lockPath = path.join(DEFAULT_ROOT, BODY_LOCK_REL);
    const players = JSON.parse(fs.readFileSync(path.join(DEFAULT_ROOT, 'server/flame/data/recruit_pool.json'), 'utf8')).players;
    const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { _meta: { doc: 'analysis/39_flame_decisions.md B30', notes: ['영입 풀 클론 id -> 몸(team:idx) 잠금. validate_data.mjs 가 recruit_pool.json 과 대조한다.', '손으로 고치지 않는다. 새 id 는 validate_data.mjs --update-body-lock 으로 더한다(이미 잠긴 id 는 바뀌지 않는다).'] }, bodies: {} };
    const d = diffBodyLock(lock, players);
    if (d.changed.length || d.missing.length) { console.log(`몸 잠금 갱신 거절: 바뀐 id ${d.changed.length}(${d.changed.slice(0, 5).join(', ')}), 사라진 id ${d.missing.length}(${d.missing.slice(0, 5).join(', ')})`); process.exit(1); }
    for (const p of players) if (d.added.includes(p.id)) lock.bodies[p.id] = bodyKeyOf(p);
    if (d.added.length) fs.writeFileSync(lockPath, JSON.stringify(lock, null, 1) + String.fromCharCode(10));
    console.log(`몸 잠금: 새 id ${d.added.length}명 추가, 전체 ${Object.keys(lock.bodies).length}명${d.added.length ? '' : ' (파일 그대로)'}`);
    process.exit(0);
  }
  const strict = args.includes('--strict');
  const ai = args.indexOf('--asset-root');
  const r = validate({ strict, assetRoot: ai >= 0 ? path.resolve(args[ai + 1]) : undefined });
  console.log('== 불꽃의 계승 데이터 검증 ==');
  r.info.forEach((m) => console.log('  정보  ' + m));
  r.warnings.forEach((m) => console.log('  경고  ' + m));
  if (r.missingIcons?.length && !args.includes('--quiet')) { console.log('  [없는 아이콘 파일]'); r.missingIcons.forEach((p) => console.log('    ' + p)); }
  r.errors.forEach((m) => console.log('  오류  ' + m));
  console.log(`결과: 오류 ${r.errors.length}, 경고 ${r.warnings.length}${strict ? ' (--strict: 경고도 실패)' : ''} → ${r.ok ? '통과' : '실패'}`);
  process.exit(r.ok ? 0 : 1);
}
