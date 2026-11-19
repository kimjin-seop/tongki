// 불꽃의 계승 클라이언트 공용 데이터(PROTOCOL §13). 상태는 서버가 단일 출처다: 화면은 app.flame(최근 flame_state)만 그린다.
// 여기에는 마스터 데이터(flame_catalog) 캐시와 이름·표기 조회만 둔다. catalog 는 flame_state.catalogVer 가 바뀔 때만 다시 받는다(메모리 + localStorage).
import { net } from '../../net.js';
import { has, json, jsonAt } from '../../game/assets.js';

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
export const rarityRank = (r) => Math.max(0, cat?.rarity?.order?.indexOf(r) ?? 0);

/** 부호 붙인 수: +3 / −2 / 0 */
export const sgn = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
/** 능력치 묶음 {s5:1, r1:10} → ['캐치 지속 +1', '넉백 저항 +10%'] */
export const statTexts = (stats) => Object.entries(stats ?? {}).filter(([, v]) => v).map(([k, v]) => `${statName(k)} ${sgn(v)}${statUnit(k)}`);

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
export const iconUrl = (def) => (def && ICON_RE.test(def.icon ?? '') ? '/' + def.icon : null);

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
  return names.length ? `${names.join(' · ')} 장착 시 습득` : '아티팩트 필요';
}

/** 장착 가능한 채 남은 것: equip = 빈 슬롯에 낄 수 있는 미장착 장비 수, art = 빈 아티팩트 슬롯에 넣을 수 있는 보유 아티팩트 수 */
export function idle(run) {
  let equip = 0;
  for (const slot of cat?.slots ?? []) {
    const free = run.items.filter((it) => it.slot === slot && !(Number.isInteger(it.wearer) && it.wearer >= 0)).length;
    const empty = run.roster.filter((r) => r.equip?.[slot] === null || r.equip?.[slot] === undefined).length;
    equip += Math.min(free, empty);
  }
  const on = run.artifacts.filter(Boolean);
  const art = Math.min(run.artifacts.length - on.length, (run.artifactsOwned ?? []).filter((id) => !on.includes(id)).length);
  return { equip, art };
}
