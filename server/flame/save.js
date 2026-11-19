// 불꽃의 계승 저장 형식: 영구 저장(profile)과 도전 저장(run). 둘 다 버전 필드 v 를 가진다(기획 §15 "저장 버전 관리").
// 읽을 때마다 migrate -> sanitize 를 거친다(리그 저장과 같은 패턴): 틀린 형식·없어진 ID 는 버리고, 도전이 복구할 수 없게 깨졌으면 null(= 도전 없음).
// 버전을 올릴 때: SAVE_VERSION 을 올리고 MIGRATE[이전 버전] = (o) => 새 형식 을 추가한다(v 가 없는 값은 v0 = v1 과 같은 형식으로 본다).
// v2(2026-11-19, P2 리뷰 M2·L3): 도전 저장에 secret(보상 난수 비밀값)·surviveCount(치사 생존 사용 횟수) 추가.
//   v1 도전은 읽을 때 secret = 시드에서 파생, surviveCount = surviveUsed 길이로 채운다(sanitizeRun). 영구 저장은 형식이 같다.
// v3(2026-11-19, 엔드리스 D24): **도전 저장만** v3. 지도를 구간 진입 때 한 구간씩 만들고 지나온 구간 지도는 버린다 -> map = [현재 구간, (v2 에서 넘어온 미리 만든 다음 구간)…], map[i] = 구간 seg + i.
//   seg 는 상한 없는 구간 번호(0 부터), champ = 이번 도전에서 우승(구간 3 보스 격파)을 했다는 표시 {first: 그때 첫 우승이었는가}(D26: 종료 정산 때 우승·첫 우승 코인을 한 번만 주는 근거).
//   v2 도전은 읽을 때 자동으로 올린다(MIGRATE[2]: 지나온 구간 지도·기록만 버린다, 진행 위치는 그대로). v3 도전은 v2 코드에서 읽히지 않는다(FLAME_SAVE_NEWER 로 거절 = 깨진 저장으로 격리되지 않는다).
//   **영구 저장은 v2 그대로**(PROFILE_VERSION): best.rank(순위 기록, D27)는 선택 필드라 형식 버전을 올리지 않았다 -> 서버를 되돌려도 영구 저장은 읽힌다(되돌린 서버가 다시 쓰면 best.rank 만 사라진다).
import { STAT_KEYS } from './catalog.js';
import { secretFromSeed } from './rng.js';

export const SAVE_VERSION = 3; // 도전 저장(run)
export const PROFILE_VERSION = 2; // 영구 저장(profile)
const MIGRATE = {
  0: (o) => ({ ...o, v: 1 }), // v0(버전 필드 없음) -> v1: 형식은 같고 필드만 붙인다
  1: (o) => ({ ...o, v: 2 }), // v1 -> v2: 없는 필드는 sanitizeRun 이 채운다
  // v2 -> v3(도전만): 지도 3구간 통째 -> 현재 구간부터(미리 만들어 둔 다음 구간은 그대로 둔다 = 이어하던 도전의 지도가 바뀌지 않는다). 지나온 구간의 노드 기록(done)도 버린다
  2: (o) => {
    const ok = Array.isArray(o.map) && Number.isInteger(o.seg) && o.seg >= 0 && o.seg < o.map.length;
    return { ...o, v: 3, ...(ok ? { map: o.map.slice(o.seg), done: Array.isArray(o.done) ? o.done.filter((d) => typeof d?.id === 'string' && d.id.startsWith(`${o.seg}-`)) : [] } : {}) };
  },
};
const SEG_MAX = 1000000, MAP_AHEAD_MAX = 8, DONE_MAX = 64, BOSSES_MAX = 64; // 안전 상한(저장값이 터무니없을 때)
/** 한 구간에서 지나는 노드 기록만 남긴다(구간이 넘어가면 run.js advance 가 비운다) */
export const doneOfSeg = (done, seg) => done.filter((d) => typeof d?.id === 'string' && d.id.startsWith(`${seg}-`));
const SPENT_MAX = 100; // 코인 소비 내역 보관 줄 수

export class FlameError extends Error {
  constructor(code, params) { super(code); this.code = code; this.params = params; }
}
export const ferr = (code, params) => { throw new FlameError(code, params); };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const nat = (v, d = 0) => (Number.isInteger(v) && v >= 0 ? v : d);

function migrate(v, target = SAVE_VERSION) {
  if (!isObj(v)) return null;
  let o = v, ver = Number.isInteger(o.v) ? o.v : 0;
  if (ver > target) return null; // 더 새 버전(서버를 되돌린 경우): 읽지 않는다(덮어쓰지도 않게 호출자가 구분)
  while (ver < target) { o = MIGRATE[ver](o); ver = o.v; }
  return o;
}

export const freshProfile = () => ({
  v: PROFILE_VERSION, coins: 0, earned: 0, spent: [], perm: {},
  codex: { items: [], artifacts: [], consumables: [], players: [] },
  best: { seg: 0, wins: 0, clears: 0, clearDiff: [] }, totals: { runs: 0, wins: 0, boss: 0 },
  achievements: [], firstClear: false,
});

/** 영구 성장 단계에서 나오는 해금 목록(저장하지 않고 매번 계산 -> 저장값과 어긋날 수 없다). flame_state.profile.unlocked 로 보낸다 */
export function unlockedOf(cat, perm = {}) {
  const lv = (id) => Math.min(nat(perm[id]), cat.perm.get(id)?.maxLevel ?? 0), C = cat.cfg;
  const grants = (id) => cat.perm.get(id).grants.slice(0, lv(id));
  const req = (r) => !r || lv(r) > 0;
  const except = new Set(C.unlocks.defaultArtifactsExcept);
  for (const g of grants('PC03')) for (const a of g.artifacts ?? []) except.delete(a);
  return {
    recruitTeams: [...C.recruit.basePool, ...grants('PC01').flatMap((g) => g.recruitTeams ?? [])],
    legendary: lv('PC02') > 0,
    items: [...cat.items.values()].filter((it) => (it.proposed.sources ?? []).every((s) => !s.startsWith('requires:') || lv(s.slice(9)) > 0)).map((it) => it.id),
    artifacts: [...cat.artifacts.keys()].filter((a) => !except.has(a)),
    events: C.events.filter((e) => req(e.requires)).map((e) => e.id),
    opponents: lv('PC05') > 0,
    difficulty: C.difficulty.filter((d) => req(d.requires)).map((d) => d.id),
  };
}

export function sanitizeProfile(cat, raw) {
  const v = migrate(raw, PROFILE_VERSION), p = freshProfile();
  if (!v) return p;
  p.coins = nat(v.coins); p.earned = nat(v.earned);
  if (Array.isArray(v.spent)) p.spent = v.spent.filter((s) => isObj(s) && typeof s.id === 'string' && Number.isInteger(s.cost)).slice(-SPENT_MAX).map((s) => ({ id: s.id, lv: nat(s.lv), cost: s.cost, at: nat(s.at) }));
  if (isObj(v.perm)) for (const u of cat.perm.values()) { const l = Math.min(nat(v.perm[u.id]), u.maxLevel); if (l) p.perm[u.id] = l; }
  const ids = (a, m) => (Array.isArray(a) ? [...new Set(a.filter((x) => m.has(x)))] : []);
  if (isObj(v.codex)) {
    p.codex.items = ids(v.codex.items, cat.items); p.codex.artifacts = ids(v.codex.artifacts, cat.artifacts); p.codex.consumables = ids(v.codex.consumables, cat.consumables);
    if (Array.isArray(v.codex.players)) p.codex.players = [...new Set(v.codex.players.filter((x) => typeof x === 'string' && /^(\d+:\d|c:c\d+)$/.test(x)))]; // 원작 선수 '팀:번호' | 영입 풀 클론 'c:<풀 id>'(D23)
  }
  if (isObj(v.best)) {
    p.best = { seg: nat(v.best.seg), wins: nat(v.best.wins), clears: nat(v.best.clears), clearDiff: Array.isArray(v.best.clearDiff) ? v.best.clearDiff.filter(Number.isInteger) : [] };
    // 순위 기록(D27, 선택 필드): 가장 멀리 간 도전 하나의 {도달 구간, 그 도전의 승수, 달성 시각(ms), 핵심 3명 이름, 난이도}. best.wins(한 도전 최다 승리)와는 다른 값이라 따로 둔다
    const k = v.best.rank;
    if (isObj(k) && Number.isInteger(k.seg) && k.seg >= 1) p.best.rank = { seg: Math.min(k.seg, SEG_MAX), wins: nat(k.wins), at: nat(k.at), team: (Array.isArray(k.team) ? k.team : []).filter((x) => typeof x === 'string').slice(0, 3).map((x) => x.slice(0, 24)), diff: nat(k.diff) };
  }
  if (isObj(v.totals)) p.totals = { runs: nat(v.totals.runs), wins: nat(v.totals.wins), boss: nat(v.totals.boss) };
  const ach = new Set(cat.cfg.achievements.map((a) => a.id));
  if (Array.isArray(v.achievements)) p.achievements = [...new Set(v.achievements.filter((a) => ach.has(a)))];
  p.firstClear = v.firstClear === true;
  if (v.practiceUsed === true) p.practiceUsed = true; // 연습 경기를 이미 썼다(D28, 선택 필드. 형식 버전은 그대로이고 없는 저장은 '쓰지 않음'이다)
  return p;
}

const NODE_PENDING = ['rest', 'recruit', 'event']; // 노드 안에서 생기는 선택(run.node 와 짝)
const SHOWN_RE = /^(c\d+|\d+:\d)$/, SHOWN_MAX = 1000; // run.recruitShown 한 칸과 보관 안전 상한(엔드리스에서는 endless.json recruitShownMax 에 닿으면 nodes.js 가 먼저 비운다)

/**
 * 도전 저장 검증. 복구할 수 없으면 null(onBad 에 이유를 넘긴다 -> 호출자가 로그를 남기고 원본을 따로 보존한다. 조용히 지우지 않는다).
 * 없어진 아이템 ID·깨진 장착 참조·깨진 선택(pending)은 그 칸만 버린다. 선택이 사라진 휴식·영입·이벤트 노드는 닫아서 같은 층에서 다시 고를 수 있게 한다
 */
export function sanitizeRun(cat, data, raw, onBad) {
  const v = migrate(raw);
  if (!v) { if (raw != null) onBad?.(isObj(raw) ? 'version' : 'not-object'); return null; }
  try {
    const R = cat.rules, need = (c, why) => { if (!c) throw new Error(why); };
    need(typeof v.id === 'string' && Number.isInteger(v.seed) && cat.cfg.difficulty.some((d) => d.id === v.diff), 'head');
    need(Array.isArray(v.map) && v.map.length >= 1 && v.map.length <= MAP_AHEAD_MAX && Number.isInteger(v.seg) && v.seg >= 0 && v.seg <= SEG_MAX, 'map'); // map[i] = 구간 seg + i(v3). 구간 수 상한은 없다(엔드리스). 엔드리스를 끈 뒤의 구간 4+ 도전도 읽는다(다음 보스 승리에서 끝난다, run.js)
    const nodeIds = new Set();
    for (const [si, seg] of v.map.entries()) {
      need(isObj(seg) && Array.isArray(seg.layers) && seg.layers.length > 0, 'map-seg');
      for (const layer of seg.layers) {
        need(Array.isArray(layer) && layer.length > 0, 'map-layer');
        for (const n of layer) {
          need(isObj(n) && typeof n.id === 'string' && n.id.startsWith(`${v.seg + si}-`) && R.nodeTypes.includes(n.type) && Array.isArray(n.next) && !nodeIds.has(n.id), 'map-node');
          nodeIds.add(n.id);
          if (['normal', 'strong', 'boss'].includes(n.type)) need(isObj(n.opp) && !!data.teams[n.opp.team] && Number.isInteger(n.opp.team) && Number.isInteger(n.opp.cpuLevel) && n.opp.cpuLevel >= 1 && n.opp.cpuLevel <= 3 && Number.isInteger(n.opp.stage) && !!data.stages[n.opp.stage], 'map-opp');
        }
      }
    }
    need(Number.isInteger(v.layer) && v.layer >= 0 && v.layer < v.map[0].layers.length, 'layer');
    need(Array.isArray(v.items) && Array.isArray(v.roster) && v.roster.length === R.team.players, 'roster-size');
    const items = [], seenInst = new Set();
    for (const it of v.items) if (isObj(it) && Number.isInteger(it.inst) && it.inst > 0 && !seenInst.has(it.inst) && cat.items.has(it.id)) { seenInst.add(it.inst); items.push({ inst: it.inst, id: it.id, lv: Math.min(nat(it.lv), cat.upgrade.maxLevel) }); }
    const byInst = new Map(items.map((it) => [it.inst, it])), worn = new Set(), who = new Set();
    const owned = Array.isArray(v.artifactsOwned) ? [...new Set(v.artifactsOwned.filter((a) => cat.artifacts.has(a)))] : [];
    const origSeen = new Set(), cloneSeen = new Set();
    const roster = v.roster.map((r) => {
      need(isObj(r) && isObj(r.from) && Number.isInteger(r.from.team) && Number.isInteger(r.from.idx) && !!data.teams[r.from.team]?.players?.[r.from.idx], 'roster-player');
      const key = r.from.team * 7 + r.from.idx;
      need(!who.has(key), 'roster-dup'); who.add(key);
      const equip = {};
      for (const slot of cat.slots) {
        const it = byInst.get(r.equip?.[slot]);
        equip[slot] = it && cat.items.get(it.id).slot === slot && !worn.has(it.inst) ? it.inst : null; // 같은 인스턴스 중복 장착은 저장에서도 허용하지 않는다
        if (equip[slot]) worn.add(it.inst);
      }
      const train = {};
      for (const k of STAT_KEYS) if (Number.isInteger(r.train?.[k]) && r.train[k] > 0) train[k] = r.train[k];
      const nSp = data.specials.power.length, spOk = (id) => Number.isInteger(id) && id >= 0 && id < nSp && !cat.excludedShots.has(id);
      const sp = [0, 1].map((k) => (spOk(r.sp?.[k]) ? r.sp[k] : null));
      if (sp[0] !== null && sp[0] === sp[1]) sp[1] = null;
      // orig = 오리지널 선수 id(D17). 정의(original_team.json)에 있고, 그 정의의 base 가 이 칸의 from 과 같고, 로스터에 한 번만 나올 때만 남긴다(아니면 그 표시만 버리고 원작 선수로 둔다). 없는 저장(변경 전 태동 도전)은 그대로다
      const od = typeof r.orig === 'string' ? cat.original?.byId.get(r.orig) : null;
      const orig = od && od.base.team === r.from.team && od.base.idx === r.from.idx && !origSeen.has(od.id) ? od.id : null;
      if (orig) origSeen.add(orig);
      // clone = 영입 풀 클론 id(D18). 풀에 있고, 그 정의의 몸이 이 칸의 from 과 같고, 로스터에 한 번만 나올 때만 남긴다. 풀에서 없어진 id 면 칸은 버리지 않고 표시만 지운다(= 그 몸의 원작 선수로 이어진다)
      const cd = !orig && typeof r.clone === 'string' ? cat.pool?.byId.get(r.clone) : null;
      const clone = cd && cd.body.team === r.from.team && cd.body.idx === r.from.idx && !cloneSeen.has(cd.id) ? cd.id : null;
      if (clone) cloneSeen.add(clone);
      return { from: { team: r.from.team, idx: r.from.idx }, ...(orig ? { orig } : {}), ...(clone ? { clone } : {}), hp: nat(r.hp, 1), train, equip, sp, recruited: r.recruited === true };
    });
    const arts = [0, 1, 2].map((i) => (owned.includes(v.artifacts?.[i]) ? v.artifacts[i] : null)).slice(0, R.team.artifactSlots);
    for (let i = 0; i < arts.length; i++) if (arts[i] && arts.indexOf(arts[i]) !== i) arts[i] = null;
    const consumables = {};
    let total = 0;
    for (const [id, n] of Object.entries(isObj(v.consumables) ? v.consumables : {})) {
      const c = Math.min(nat(n), cat.rules.consumables.stackMaxPerKind, cat.rules.consumables.inventoryMax - total);
      if (cat.consumables.has(id) && c > 0) { consumables[id] = c; total += c; }
    }
    const buffs = (Array.isArray(v.buffs) ? v.buffs : []).filter((b) => isObj(b) && cat.consumables.has(b.c) && (b.p === null || (Number.isInteger(b.p) && b.p >= 0 && b.p < 7))).map((b) => ({ c: b.c, p: b.p }));
    let node = isObj(v.node) && v.map[0].layers[v.layer].some((n) => n.id === v.node.id && n.type === v.node.type) ? v.node : null;
    const events = new Set(cat.cfg.events.map((e) => e.id)), pending = [];
    for (const p of Array.isArray(v.pending) ? v.pending : []) {
      if (!isObj(p) || !['equipment', 'artifact', ...NODE_PENDING].includes(p.kind)) continue;
      if (NODE_PENDING.includes(p.kind)) {
        if (!node || node.type !== p.kind || p.node !== node.id || pending.some((q) => q.node === p.node)) continue; // 열린 노드와 짝이 맞지 않는 선택
        if (p.kind === 'event' && !events.has(p.event)) continue; // 없어진 이벤트 ID: 선택만 버린다(아래에서 노드를 닫는다)
      }
      const ch = Array.isArray(p.choices) ? p.choices : []; // 배열이 아닌 선택지는 빈 배열(그 칸만 버리고 도전은 살린다. 장비·아티팩트·영입은 '받지 않음'으로 넘어갈 수 있다)
      if (p.kind === 'equipment') { p.choices = ch.filter((c) => cat.items.has(c)); p.n = nat(p.n); }
      else if (p.kind === 'artifact') { p.choices = ch.filter((c) => cat.artifacts.has(c)); p.n = nat(p.n); }
      // 영입 후보: {team, idx} 는 실제 선수여야 한다. 클론 칸(clone, D18)은 풀에 있는 id 만 남긴다(없어진 id 의 칸은 버린다). 종전 저장의 {team, idx} 칸은 그대로 원작 선수 후보다
      else if (p.kind === 'recruit') p.choices = ch.filter((c) => isObj(c) && Number.isInteger(c.team) && Number.isInteger(c.idx) && !!data.teams[c.team]?.players?.[c.idx] && (c.clone === undefined || (typeof c.clone === 'string' && !!cat.pool?.byId.has(c.clone))))
        .map((c) => ({ team: c.team, idx: c.idx, ...(c.clone !== undefined ? { clone: c.clone } : {}), ...(c.rare === true ? { rare: true } : {}) }));
      pending.push(p);
    }
    if (node && NODE_PENDING.includes(node.type) && !pending.some((p) => p.node === node.id)) node = null; // 선택이 사라진 노드: 닫고 같은 층에서 다시 고른다(진행이 막히지 않게)
    const W = isObj(v.wins) ? v.wins : {}, S = isObj(v.stat) ? v.stat : {};
    const shown = Array.isArray(v.recruitShown) ? [...new Set(v.recruitShown.filter((x) => typeof x === 'string' && SHOWN_RE.test(x)))].slice(0, SHOWN_MAX) : [];
    return {
      v: SAVE_VERSION, id: v.id, seed: v.seed >>> 0, secret: typeof v.secret === 'string' && /^[0-9a-f]{32}$/.test(v.secret) ? v.secret : secretFromSeed(v.seed), diff: v.diff, createdAt: nat(v.createdAt), updatedAt: nat(v.updatedAt),
      ...(typeof v.origTeam === 'string' && v.origTeam === cat.original?.id ? { origTeam: v.origTeam } : {}), // 오리지널 팀 도전 표시(D17). 저장 버전은 그대로(v2)이고 없는 저장은 종전 태동 도전으로 이어진다
      seg: v.seg, layer: v.layer, map: v.map, node, match: isObj(v.match) && nodeIds.has(v.match.node) ? { node: v.match.node, at: nat(v.match.at) } : null,
      done: (Array.isArray(v.done) ? v.done : []).filter((d) => isObj(d) && typeof d.id === 'string').slice(-DONE_MAX),
      ...(isObj(v.champ) ? { champ: { first: v.champ.first === true } } : {}), // 이번 도전에서 우승했다는 표시(D24·D26, 선택 필드)
      wins: { normal: nat(W.normal), strong: nat(W.strong), boss: nat(W.boss) },
      roster, items, nextInst: Math.max(nat(v.nextInst, 1), ...items.map((it) => it.inst + 1), 1),
      artifactsOwned: owned, artifacts: arts, consumables, buffs,
      extraReward: nat(v.extraReward), extraRecruit: nat(v.extraRecruit),
      // 영입실 입장 회복을 준 층(D29, 선택 필드. 저장 버전은 그대로이고 없는 저장은 '아직 주지 않음'이다): at = 구간:층, pct·total = 표시용
      ...(isObj(v.roomHeal) && typeof v.roomHeal.at === 'string' && /^\d+:\d+$/.test(v.roomHeal.at) ? { roomHeal: { at: v.roomHeal.at, pct: Number.isFinite(v.roomHeal.pct) && v.roomHeal.pct > 0 ? v.roomHeal.pct : 0, total: nat(v.roomHeal.total) } } : {}),
      ...(shown.length ? { recruitShown: shown } : {}), // 이 도전에서 이미 나온 영입 후보(D22, 선택 필드. 저장 버전은 그대로이고 없는 저장은 빈 목록으로 이어진다)
      points: nat(v.points), fm: cat.tagOfFm.has(v.fm) ? v.fm : cat.cfg.formation.default, rerolls: nat(v.rerolls), rollN: nat(v.rollN),
      pending, surviveUsed: (Array.isArray(v.surviveUsed) ? v.surviveUsed : []).filter((i) => byInst.has(i)),
      surviveCount: Number.isInteger(v.surviveCount) && v.surviveCount >= 0 ? v.surviveCount : Array.isArray(v.surviveUsed) ? v.surviveUsed.length : 0, // v1: 쓴 인스턴스 수 = 쓴 횟수
      stat: { bestRarity: Math.min(nat(S.bestRarity), cat.rarities.length - 1), fms: Array.isArray(S.fms) ? S.fms.filter((f) => cat.tagOfFm.has(f)) : [], bosses: Array.isArray(S.bosses) ? S.bosses.filter(Number.isInteger).slice(-BOSSES_MAX) : [] },
      seen: { items: Array.isArray(v.seen?.items) ? v.seen.items.filter((x) => cat.items.has(x)) : [], artifacts: Array.isArray(v.seen?.artifacts) ? v.seen.artifacts.filter((x) => cat.artifacts.has(x)) : [], consumables: Array.isArray(v.seen?.consumables) ? v.seen.consumables.filter((x) => cat.consumables.has(x)) : [], players: Array.isArray(v.seen?.players) ? v.seen.players.filter((x) => typeof x === 'string') : [] },
    };
  } catch (e) { onBad?.(e?.message ?? 'error'); return null; }
}
