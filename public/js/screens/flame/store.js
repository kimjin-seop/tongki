// 불꽃의 계승 클라이언트 공용 데이터(PROTOCOL §13). 상태는 서버가 단일 출처다: 화면은 app.flame(최근 flame_state)만 그린다.
// 여기에는 마스터 데이터(flame_catalog) 캐시와 이름·표기 조회만 둔다. catalog 는 flame_state.catalogVer 가 바뀔 때만 다시 받는다(메모리 + localStorage).
import { net } from '../../net.js';
import { has, json, jsonAt } from '../../game/assets.js';
import { fmNameKo } from '../../game/formation.js';

const LS_KEY = 'dd.flame.catalog';
let cat = null, maps = null, asked = null;
let shouts = null, sprTeams = null, prematch = null; // 슛 이름(special_shouts.json byId), 선수 원래 필살기(sprites/teams.json), 편성 화면 능력치(prematch.json)

function index(c) {
  const by = (list) => new Map((list ?? []).map((x) => [x.id, x]));
  maps = { equip: by(c.equipment), art: by(c.artifacts), cons: by(c.consumables), syn: by(c.synergies), tag: by(c.formationTags), node: by(c.nodeTypes),
    role: by(c.roles), ach: by(c.achievements), perm: by(c.perm), train: by(c.training?.options), event: by(c.events), fam: by(c.shotFamilies) };
}
const valid = (c) => !!c && typeof c.ver === 'string' && Array.isArray(c.equipment) && Array.isArray(c.artifacts) && Array.isArray(c.consumables);

export const catalog = () => cat;
/** flame_catalog 수신 */
export function setCatalog(m) {
  if (!valid(m)) return;
  cat = m; index(m); asked = null;
  try { localStorage.setItem(LS_KEY, JSON.stringify(m)); } catch { /* 저장 불가: 메모리만 */ }
}
/** 상태의 catalogVer 와 같은 카탈로그가 준비됐는가. 아니면 한 번만 요청한다 */
export function ensureCatalog(ver) {
  if (!ver) return !!cat;
  if (cat?.ver === ver) return true;
  if (!cat) {
    try { const c = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null'); if (valid(c) && c.ver === ver) { cat = c; index(c); return true; } } catch { /* 캐시 깨짐: 다시 받는다 */ }
  }
  if (asked !== ver) { asked = ver; net.send('flame_catalog'); }
  return false;
}
/** 요청이 거절됐을 때(오류) 다음 상태에서 다시 요청할 수 있게 */
export function catalogRetry() { asked = null; }
/** 그 버전의 카탈로그를 들고 있는가(요청하지 않는다) */
export const catalogReady = (ver) => !!cat && (!ver || cat.ver === ver);
/** 카탈로그를 버린다(메모리 + localStorage). 화면을 그리다 실패했을 때: 다음 ensureCatalog 가 새로 받는다 */
export function dropCatalog() {
  cat = null; maps = null; asked = null;
  try { localStorage.removeItem(LS_KEY); } catch { /* 저장소 불가 */ }
}

/** 화면이 같이 쓰는 클라이언트 에셋(슛 이름·원래 필살기·기본 능력치). 실패해도 화면은 뜬다(이름 대신 번호) */
let extraP = null;
export function loadExtras() {
  extraP ??= Promise.all([
    jsonAt('data/special_shouts.json').then((d) => { shouts = d; }).catch((e) => console.warn('flame shouts', e.message)),
    has('data.sprite.teams') ? json('data.sprite.teams').then((d) => { sprTeams = d; }).catch((e) => console.warn('flame teams', e.message)) : null,
    has('data.prematch') ? json('data.prematch').then((d) => { prematch = d; }).catch((e) => console.warn('flame prematch', e.message)) : null,
  ]);
  return extraP;
}

export const equipDef = (id) => maps?.equip.get(id) ?? null;
export const artDef = (id) => maps?.art.get(id) ?? null;
export const consDef = (id) => maps?.cons.get(id) ?? null;
export const synDef = (id) => maps?.syn.get(id) ?? null;
export const tagDef = (id) => maps?.tag.get(id) ?? null;
export const roleName = (id) => maps?.role.get(id)?.name ?? '';
export const achDef = (id) => maps?.ach.get(id) ?? null;
export const permDef = (id) => maps?.perm.get(id) ?? null;
export const eventDef = (id) => maps?.event.get(id) ?? null;
export const nodeName = (type) => maps?.node.get(type)?.name ?? type;
/** 포메이션 패턴 번호(0~14) → 태그 정의 */
export const tagOfFm = (fm) => cat?.formationTags.find((t) => t.mapping.includes(fm)) ?? null;

/** 엔드리스(무한 구간, PROTOCOL §13.12)인가: 도전·종료 요약에 endless 칸이 있으면 그것, 없으면 카탈로그(flame_catalog.endless.enabled) */
export const isEndless = (o = null) => (typeof o?.endless === 'boolean' ? o.endless : cat?.endless?.enabled === true);
/** 구간 수 표기: 엔드리스 = 숫자만(분모 없음), 종전 = 'n/3' */
export const segText = (n, o = null, total = null) => (isEndless(o) ? String(n) : `${n}/${o?.segments ?? total ?? cat?.endless?.championSegments ?? 3}`);

export const SLOT_KO = { headband: '머리띠', glove: '장갑', protector: '가슴보호대', uniform: '복장' };
export const NODE_SHORT = { normal: '일반', strong: '강팀', boss: '보스', shop: '상점', training: '특훈', rest: '휴식', recruit: '영입', event: '이벤트' };
export const CAT_KO = { special: '필살기', formation: '포메이션', team: '팀 강화' };
export const STAT_KEYS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 'r1', 'r2', 'r3'];
export const statName = (k) => cat?.stats?.base?.[k] ?? cat?.stats?.extended?.[k]?.name ?? k;
export const statUnit = (k) => ({ pct: '%', frames: 'F' })[cat?.stats?.extended?.[k]?.unit] ?? '';
export const rarityName = (r) => cat?.rarity?.names?.[r] ?? '';
/** 장비 등급 글자 C/B/A/S(flame_catalog.rarity.letters, PROTOCOL §13.22 D43) | null(칸이 없으면 종전 이름 표기) */
export const rarityLetter = (r) => { const l = cat?.rarity?.letters?.[r]; return typeof l === 'string' && l ? l : null; };
export const rarityRank = (r) => Math.max(0, cat?.rarity?.order?.indexOf(r) ?? 0);

/** 부호 붙인 수: +3 / −2 / 0 */
export const sgn = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
/** 능력치 묶음 {s5:1, r1:10} → ['캐치 지속 +1', '넉백 저항 +10%'] */
export const statTexts = (stats) => Object.entries(stats ?? {}).filter(([, v]) => v).map(([k, v]) => `${statName(k)} ${sgn(v)}${statUnit(k)}`);

// ---- 등급제(PROTOCOL §13.22, flame_catalog.grade.model === 'v1'). 'off'·칸 없음 = 종전 화면 그대로
export const gradeOn = () => cat?.grade?.model === 'v1';
export const GRADES = ['C', 'B', 'A', 'S'];
/** 등급 아이템이면 {kind:'shot'|'formation', key: 슛 ID | 패턴 번호, grade, rank(0 = C)}, 아니면 null(손으로 쓴 아티팩트) */
export function grantOf(d) {
  const g = d?.grant, k = d?.kind === 'shot' ? g?.shot : d?.kind === 'formation' ? g?.formation : null;
  return Number.isInteger(k) && GRADES.includes(d.grade) ? { kind: d.kind, key: k, grade: d.grade, rank: GRADES.indexOf(d.grade) } : null;
}
/** 등급 아이템 id(SP<슛>-<등급> · FM<패턴>-<등급>) */
export const gradeId = (kind, key, grade) => `${kind === 'shot' ? 'SP' : 'FM'}${key}-${grade}`;
/** 아티팩트 이름: 등급 아이템 = grant 의 슛·포메이션 이름(서버의 name 은 임시 문구), 그 밖 = 정의 그대로 */
export function artName(d) {
  const g = grantOf(d);
  return g ? (g.kind === 'shot' ? shotLabel(g.key) : fmNameKo(g.key)) : d?.name ?? '';
}
/** 유형 이름. 등급제: 필살슛 · 포메이션 · 팀 강화(보스 보상 3칸의 유형). 종전: 분류 이름.
 * 팀 강화 = 등급 아이템이 아니고 슛 계열을 풀지 않는 아티팩트(서버 catalog.js isTeamArtifact 와 같은 기준 — 분류가 formation 인 「돌격 작전판」 등도 팀 강화다) */
export const KIND_KO = { shot: '필살슛', formation: '포메이션', team: '팀 강화' };
export const artKind = (d) => { const g = grantOf(d); return g ? g.kind : gradeOn() && d && !d.grant && (Array.isArray(d.unlockShotFamilies) ? d.unlockShotFamilies.length === 0 : d.category === 'team') ? 'team' : null; };
export const artKindName = (d) => KIND_KO[artKind(d)] ?? CAT_KO[d?.category] ?? '';
/** 아티팩트 한 줄 속성. 등급 아이템: 슛 = 계열 · 위력 가산, 포메이션 = 태그 · 태그 보너스 % · 팀 능력치. 그 밖 = 설명문(artSpec) */
export function artLine(d) {
  const g = grantOf(d), G = cat?.grade;
  if (!g) return artSpec(d);
  if (g.kind === 'shot') {
    const fam = (cat?.shotFamilies ?? []).find((f) => f.unlockedBy && !f.overlap && (f.shotIds ?? []).includes(g.key)) ?? (cat?.shotFamilies ?? []).find((f) => (f.shotIds ?? []).includes(g.key));
    const pow = G?.spPow?.[g.grade] ?? 0, spd = G?.spSpd?.[g.grade] ?? 0; // 가산이 0 인 등급(C)은 「위력 +0」·「필살 속도 +0」을 내지 않는다(§13.24 spSpd)
    return [fam?.name ? `${fam.name} 계열` : null, pow > 0 ? `위력 +${pow}` : null, spd > 0 ? `필살 속도 +${spd}` : null].filter(Boolean).join(' · ');
  }
  return [tagOfFm(g.key)?.name, Number.isFinite(G?.formation?.tagPct?.[g.grade]) ? `태그 보너스 ${G.formation.tagPct[g.grade]}%` : null, ...fmGradeTexts(g.grade)].filter(Boolean).join(' · ');
}
/** 짝 안내 한 줄(등급제만, analysis/40 §20.9): 포메이션 아이템 ↔ 같은 태그 아티팩트(formationTag)가 서로 있어야 태그 보너스가 난다 | null */
export function artPair(d) {
  if (!gradeOn() || !d || artOff()) return null; // off(§13.26): 태그 보너스는 포메이션 아이템이 직접 준다(짝 없음)
  const g = grantOf(d);
  if (g?.kind === 'formation') { const t = tagOfFm(g.key)?.name; return t ? `${t} 아티팩트가 있어야 태그 보너스` : null; }
  if (g || !d.formationTag) return null;
  const t = tagDef(d.formationTag)?.name;
  return t ? `${t} 포메이션 아이템이 있어야 보너스` : null;
}
/** 포메이션 등급의 팀 능력치 가산 문구 목록(flame_catalog.grade.formation.stat) */
export const fmGradeTexts = (grade) => statTexts(Object.fromEntries(Object.entries(cat?.grade?.formation?.stat ?? {}).map(([k, v]) => [k, v?.[grade] ?? 0])));
/** 같은 종류(같은 슛·같은 포메이션)의 보유 등급 | null. ids = 보유 아티팩트 id 목록(가장 높은 등급 하나만 갖는다) */
export function ownedGrade(ids, d) {
  const g = grantOf(d);
  if (!g) return null;
  let best = null;
  for (const id of ids ?? []) { const o = grantOf(artDef(id)); if (o && o.kind === g.kind && o.key === g.key && (!best || o.rank > best.rank)) best = o; }
  return best?.grade ?? null;
}

// ---- 팀 공용 아티팩트 스위치(PROTOCOL §13.26, flame_catalog.artifact.model). 'off' = 공용 3칸·시너지 없음, 필살기 아이템은 선수마다 1칸(roster[i].spItem), 포메이션 아이템은 팀 1칸(run.fmItem). 'team'·칸 없음 = 종전 화면
export const artOff = () => cat?.artifact?.model === 'off';
/** off 의 등급 아이템 종류 이름(카드·도감·토스트) */
export const ITEM_KO = { shot: '필살기 아이템', formation: '포메이션 아이템' };
/** 그 필살기 아이템을 낀 선수 번호(라인업 순서) | -1 */
export const spWearer = (run, id) => (id ? (run?.roster ?? []).findIndex((r) => r?.spItem === id) : -1);
/** 등급 아이템 묶음의 보상 제목(off): 전부 필살기 = 필살기 아이템, 전부 포메이션 = 포메이션 아이템, 섞이면 아이템 */
export function itemTitle(ids) {
  const ks = new Set((ids ?? []).map((id) => grantOf(artDef(id))?.kind).filter(Boolean));
  return ks.size === 1 ? ITEM_KO[[...ks][0]] : '아이템';
}

// ---- 필살기 부여 구조(PROTOCOL §13.21, flame_catalog.special.model === 'granted'). 'legacy'·칸 없음 = 종전 화면 그대로
/** 부여 구조인가: 선수 자체에는 필살기가 없고 낀 아티팩트가 슛을 부여한다(원작 선수만 고유 슛) */
export const granted = () => cat?.special?.model === 'granted';
/** 주 슬롯이 빈 선수의 표기(부여 구조) */
export const NO_SHOT = '필살기 없음';
/** 아티팩트 설명문: 부여 구조면 「해금」→「부여」(서버 데이터 원문은 종전 낱말) */
export const artSpec = (d) => (granted() ? String(d?.specText ?? '').replace(/해금/g, '부여') : d?.specText ?? '');
/** 그 아티팩트를 끼면 빈 주 슬롯에 들어가는 대표 슛 ID | null(flame_catalog.special.artifactShots) */
export function artShot(id) {
  const v = granted() ? cat?.special?.artifactShots?.[id] : null;
  return Number.isInteger(v) && v >= 0 ? v : null;
}
/** 필살기 이름(말풍선 문구에서 느낌표를 뗀 것). 표가 없으면 번호 */
export function shotName(id) {
  if (id === null || id === undefined) return '없음';
  const s = shouts?.byId?.[id];
  return typeof s === 'string' && s ? s.replace(/!+$/, '') : `필살기 ${id}`;
}
/** 같은 이름의 슛 가운데 몇 번째인가(슛 표 전체에서 ID 오름차순, 1부터). 내부 ID 를 화면에 내지 않으려고 쓴다 */
function shotOrdinal(id) {
  const nm = shotName(id);
  return Object.keys(shouts?.byId ?? {}).map(Number).filter((k) => Number.isInteger(k) && k < id && shotName(k) === nm).length + 1;
}
/** 필살기 이름표 목록(고르는 칸용): 같은 이름의 슛이 한 목록에 둘 이상이면 둘째부터 순번을 붙인다(불꽃슛 · 불꽃슛 2). 내부 ID 는 보이지 않는다 */
export function shotLabels(ids) {
  const names = ids.map(shotName);
  return ids.map((id, i) => {
    if (id === null || id === undefined || names.filter((n) => n === names[i]).length < 2) return names[i];
    const n = shotOrdinal(id);
    return n > 1 ? `${names[i]} ${n}` : names[i];
  });
}
/** 필살기 이름표 하나(등급 아이템 이름용): 같은 이름의 슛이 여럿이면 둘째부터 순번(불꽃슛 · 불꽃슛 2) */
export function shotLabel(id) { const n = shotOrdinal(id); return n > 1 ? `${shotName(id)} ${n}` : shotName(id); }
/** 필살기 이름 목록(보여 주기만 하는 칸용): 같은 이름은 한 번만 */
export const shotNames = (ids) => [...new Set(ids.map(shotName))];
/** 선수의 원래 필살기 ID(ROM 표, 표시·선택지용. 최종 판정은 서버). 없으면 null */
export function ownShot(from) {
  const t = Array.isArray(sprTeams) ? sprTeams.find((x) => x.team === from.team) ?? sprTeams[from.team] : sprTeams?.[from.team];
  const id = t?.players?.[from.idx]?.special_shot_id;
  return Number.isInteger(id) && id >= 0 ? id : null;
}
/** 원작 편성 화면 능력치 6종 [체력, 방어, 스피드, 점프, 슛, 캐치] (영입 후보처럼 서버 계산 결과가 없는 선수의 기본값 표시). 없으면 null */
export const baseSix = (from) => prematch?.teams?.[String(from.team)]?.[from.idx] ?? null;
export const SIX_KEYS = ['s0', 's1', 's2', 's3', 's4', 's5'];

/** 아이콘 경로(서버 데이터의 icon, public 기준). 형식이 다르면 쓰지 않는다 */
const ICON_RE = /^assets\/flame-legacy\/items\/[a-z]+\/[A-Za-z0-9_]+\.png$/;
export function iconUrl(def) {
  if (def && ICON_RE.test(def.icon ?? '')) return '/' + def.icon;
  // 등급 아이템(전용 그림 없음, §13.22 ⑩): 서버가 준 계열 아티팩트 그림이 없으면 같은 분류의 첫 아티팩트 그림을 빌린다
  const sub = grantOf(def) ? (cat?.artifacts ?? []).find((a) => !a.grant && a.category === def.category && ICON_RE.test(a.icon ?? '')) : null;
  return sub ? '/' + sub.icon : null;
}

/** 한국어 조사: josa('황금산', '와/과') → '황금산과', josa('강철', '을/를') → '강철을'. 한글로 끝나지 않으면 받침 없는 쪽. '로/으로' 는 ㄹ 받침도 '로' */
export function josa(word, pair) {
  const w = String(word ?? ''), [a, b] = pair.split('/');
  const open = '와를가는로야랑'.includes(a) ? a : b, closed = open === a ? b : a; // 받침 없을 때 붙는 쪽을 가려낸다(쌍의 순서는 상관없다)
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  if (!(c >= 0 && c <= 11171)) return w + open;
  const jong = c % 28;
  return w + (jong === 0 || (open === '로' && jong === 8) ? open : closed);
}

/** 그 필살기가 생기는 아티팩트 정의 목록(flame_catalog.shotFamilies + 아티팩트 unlock_shot_family 효과). 습득 안내용 */
export function shotGivers(shotId) {
  const fams = new Set((cat?.shotFamilies ?? []).filter((f) => (f.unlockIds ?? f.shotIds ?? []).includes(shotId)).map((f) => f.id));
  if (!fams.size) return [];
  return (cat?.artifacts ?? []).filter((a) => (a.effects ?? []).some((e) => e.type === 'unlock_shot_family' && fams.has(e.params?.family)));
}
/** 없는 필살기의 습득 조건 한 줄 */
export function learnText(shotId) {
  const names = shotGivers(shotId).map((a) => a.name).filter(Boolean);
  if (artOff()) return '필살기 아이템 필요';
  return names.length ? `${names.join(' · ')} 장착 시 습득` : '아티팩트 필요';
}

/** 장착 가능한 채 남은 것: equip = 빈 슬롯에 낄 수 있는 미장착 장비 수, art = 빈 아티팩트 슬롯에 넣을 수 있는 보유 아티팩트 수.
 *  off(§13.26): art = 아무도 끼지 않은 필살기 아이템 수와 아이템 없는 선수 수 중 작은 것, fm = 포메이션 칸이 비어 있고 보유한 포메이션 아이템이 있으면 1 */
export function idle(run) {
  let equip = 0;
  for (const slot of cat?.slots ?? []) {
    const free = run.items.filter((it) => it.slot === slot && !(Number.isInteger(it.wearer) && it.wearer >= 0)).length;
    const empty = run.roster.filter((r) => r.equip?.[slot] === null || r.equip?.[slot] === undefined).length;
    equip += Math.min(free, empty);
  }
  if (artOff()) {
    const own = (run.artifactsOwned ?? []).map((id) => [id, grantOf(artDef(id))]).filter(([, g]) => g);
    const freeSp = own.filter(([id, g]) => g.kind === 'shot' && spWearer(run, id) < 0).length, noSp = run.roster.filter((r) => !r.spItem).length;
    return { equip, art: Math.min(freeSp, noSp), fm: !run.fmItem && own.some(([, g]) => g.kind === 'formation') ? 1 : 0 };
  }
  const on = run.artifacts.filter(Boolean);
  const art = Math.min(run.artifacts.length - on.length, (run.artifactsOwned ?? []).filter((id) => !on.includes(id)).length);
  return { equip, art, fm: 0 };
}
