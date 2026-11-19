// 불꽃의 계승(flame_legacy) 엔진 훅. Match 옵션 `flame` 을 줄 때만 쓰인다(주지 않으면 match.js 의 모든 분기가 건너뛴다: this.fl = null, p.fl = undefined).
// 근거: analysis/37_flame_legacy_analysis.md §2.5~§2.12, 확정 결정 analysis/39_flame_decisions.md. 원작에 없는 규칙이라 전부 [자작].
// 이 파일은 난수(m.rng)를 부르지 않는다 -> 같은 시드의 난수 순서는 flame 여부와 무관하다. 효과는 flame 좌석 선수에게만 걸린다(상대 좌석에는 없다).
//
// 옵션 형식(PROTOCOL §12):
// flame: {
//   seat?: 0|1,                       // flame 좌석(기본 0). 그 좌석의 Match 옵션 teams[seat] 는 쓰이지 않는다
//   roster: [7칸 {                    // 순서 = 라인업(0~3 내야, 4 상단·5 하단·6 후방 외야). 0번 = 주장(D12)·점프볼 참가자
//     from: {team, idx},              // 출신(히트박스·손 위치·스프라이트·얼굴·말풍선의 기준)
//     stat?: {hp,def,spd,s3,pow,s5,thr,pass}, // 최종 능력치(일부만 줘도 된다. 없는 칸 = 출신 원본). 언제나 복사본에 쓴다
//     hp?: number,                    // 시작 현재 HP(도전 전용). 기본 = 최대 HP. [hpFloor, 최대 HP] 로 자른다(D5)
//     ext?: {r1, r2, r3},             // R1 넉백 저항 %, R2 캐치 후 밀림 감소 %, R3 쓰러짐 단축 프레임
//     sp?: [id|null, id|null],        // 필살기 슬롯(D1: 경기 중 발동은 슬롯 0 = 주 슬롯만)
//     fx?: {catchPow, passSpd, chargePow, airPow, lowHpDef, survive, spPow, spAirPow, spPct, famPow:{계열:n}, famPct:{계열:%}},
//   }],
//   allow?: number[],                 // 해금된 필살기 ID. 없으면 전부 잠금. 표값 255 인 ID 는 넣어도 빠진다(D2)
//   families?: {계열: number[]},      // famPow/famPct 판정용 계열표(server/flame/data/shot_families.json 을 호출자가 넘긴다)
//   fm?: 0~14,                        // 포메이션 패턴(이름 번호). 없으면 team 의 패턴
//   team?: number,                    // 좌석 표시용 팀 id(기본 = roster[0].from.team)
//   caps?: {…FLAME_DEFAULTS 일부}
// }

/** 상한·하한·규칙 스위치. 값은 server/flame/data/rules.json clamps 와 같다(호출자가 caps 로 덮을 수 있다). 되돌리기: 이 표의 값만 바꾼다 */
export const FLAME_DEFAULTS = Object.freeze({
  r1MaxPct: 60, // R1 넉백 저항 상한(기획 §2.2)
  r2MaxPct: 60, // R2 캐치 후 밀림 감소 상한
  r3MaxFrames: 24, // R3 쓰러짐 단축 상한
  downFramesMin: 36, // 쓰러짐 하한(프레임)
  walkCap: true, // 사람 걷기 속도를 대시 상한(rules.move.dashMax = 3.0px/f)으로 자른다(D14, 37 §3-C6)
  lowHpPct: 30, // "HP 30% 이하" 판정(이하, 맞기 직전 HP)
  hpFloor: 1, // 시작 현재 HP 하한(D5: HP 0 선수는 다음 경기 HP 1 로 출전)
  slotRule: 'primary', // D1: 발동은 주 슬롯(sp[0])만. 슬롯 2 는 예비
  lockCounter: true, // 받아치기 필살도 주 슬롯이 해금된 선수만(37 §3-C3). false = 받아치기는 잠금과 무관
  counterBonus: false, // 받아치기 공(잡은 공의 위력·속력 승계)에는 위력·속도 가산을 하지 않는다(37 §2.3: 같은 공이 오갈 때 누적 방지)
});

export const FLAME_STATS = ['hp', 'def', 'spd', 's3', 'pow', 's5', 'thr', 'pass'];
const FX_NUM = ['catchPow', 'passSpd', 'chargePow', 'airPow', 'lowHpDef', 'survive', 'spPow', 'spAirPow', 'spPct'];

const bad = (msg) => { throw new Error('flame: ' + msg); };
const int = (v, name) => { if (!Number.isInteger(v)) bad(`${name} 가 정수가 아님: ${v}`); return v; };
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
/** 안전 상한(P1 리뷰 M2, [자작]): 호출자가 잘못된 값을 넘겨도 8.8·16.16 연산이 넘치거나 부호가 뒤집히지 않게 한다. 정상 데이터 범위(능력치 2~150, 가산 ~20)보다 훨씬 넓다 */
export const FLAME_LIMITS = Object.freeze({ statMax: 255, fxMax: 255, powMax: 4095 });
/** 0 이상 정수(fx·계열 가산). 음수·소수·문자열은 예외, 위는 fxMax 로 자른다 */
const fxInt = (v, name) => { if (int(v, name) < 0) bad(`${name} 가 음수: ${v}`); return Math.min(v, FLAME_LIMITS.fxMax); };
/** caps: 아는 키만 받고 범위를 자른다(상한 스위치로 넉백 반전·음수 하한이 생기지 않게). 모르는 키는 버리고 틀린 형은 예외 */
function normCaps(c) {
  const o = { ...FLAME_DEFAULTS };
  if (c === undefined || c === null) return o;
  if (typeof c !== 'object' || Array.isArray(c)) bad('caps 가 객체가 아님');
  const rng = (k, lo, hi) => { if (c[k] !== undefined) o[k] = clamp(int(c[k], 'caps.' + k), lo, hi); };
  rng('r1MaxPct', 0, 100); rng('r2MaxPct', 0, 100); rng('r3MaxFrames', 0, 255); rng('downFramesMin', 1, 255); rng('lowHpPct', 0, 100); rng('hpFloor', 0, 1);
  for (const k of ['walkCap', 'lockCounter', 'counterBonus']) if (c[k] !== undefined) { if (typeof c[k] !== 'boolean') bad(`caps.${k} 는 boolean`); o[k] = c[k]; }
  if (c.slotRule !== undefined) { if (typeof c.slotRule !== 'string') bad('caps.slotRule'); o.slotRule = c.slotRule; }
  return o;
}

/**
 * 옵션 검증·정규화. 반환값은 Match.fl 에 들어간다. 전역 캐시(data.teams)의 선수 객체는 읽기만 하고 능력치는 새 객체에 복사한다(37 §2.1: 원본을 고치면 같은 프로세스의 다른 경기가 오염된다)
 * @returns {{seat:number, team:number, fmTeam:number|null, fm:number|null, caps:object, allow:Set<number>, famOf:Map<number,string[]>, roster:object[], surviveUsed:number[]}}
 */
export function initFlame(data, o, R) {
  if (!o || typeof o !== 'object') bad('옵션이 객체가 아님');
  const seat = o.seat ?? 0;
  if (seat !== 0 && seat !== 1) bad('seat 는 0 또는 1');
  if (!Array.isArray(o.roster) || o.roster.length !== 7) bad('roster 는 7칸 배열');
  const caps = normCaps(o.caps);
  const SP = data.specials, nSp = SP?.power?.length ?? 0;
  const usable = (id) => Number.isInteger(id) && id >= 0 && id < nSp && SP.power[id] !== 255; // 표값 255 = 일반 계산값을 쓰는 ID(0·16·30·32·38·46·47): 해금 후보에서 뺀다(D2)
  if (o.allow !== undefined && !Array.isArray(o.allow)) bad('allow 는 배열');
  const allow = new Set((o.allow ?? []).map((id) => int(id, 'allow[]')).filter(usable));
  const famOf = new Map();
  for (const [fam, ids] of Object.entries(o.families ?? {})) for (const id of ids ?? []) { int(id, `families.${fam}[]`); if (!famOf.has(id)) famOf.set(id, []); famOf.get(id).push(fam); }
  const seen = new Set();
  const roster = o.roster.map((r, i) => {
    const team = r?.from?.team, idx = r?.from?.idx;
    if (!Number.isInteger(team) || !Number.isInteger(idx)) bad(`roster[${i}].from 은 정수 {team, idx}: ${team}:${idx}`); // 문자열 '0' 로 중복 검사를 피하거나 idx:'length' 로 엉뚱한 칸을 읽지 않게(P1 리뷰 M1)
    const src = data.teams[team]?.players?.[idx];
    if (!src) bad(`roster[${i}].from 이 없는 선수: ${team}:${idx}`);
    if (seen.has(team * 7 + idx)) bad(`roster[${i}] 같은 선수 중복: ${team}:${idx}`);
    seen.add(team * 7 + idx);
    const stat = { ...src, ai: src.ai.slice() }; // 복사본(얕은 복사 + ai 표 복사). special 칸은 읽지 않는다
    for (const k of FLAME_STATS) if (r.stat?.[k] !== undefined) stat[k] = clamp(int(r.stat[k], `roster[${i}].stat.${k}`), k === 'hp' ? 1 : 0, FLAME_LIMITS.statMax); // 하한: HP 1, 나머지 0(37 §3-C19: 방어 음수 금지). 상한 255(안전 상한, M2)
    const hp = clamp(r.hp === undefined ? stat.hp : int(r.hp, `roster[${i}].hp`), Math.min(caps.hpFloor, stat.hp), stat.hp);
    const e = r.ext ?? {};
    const r1 = clamp(int(e.r1 ?? 0, 'ext.r1'), 0, caps.r1MaxPct), r2 = clamp(int(e.r2 ?? 0, 'ext.r2'), 0, caps.r2MaxPct), r3 = clamp(int(e.r3 ?? 0, 'ext.r3'), 0, caps.r3MaxFrames);
    const sp = [0, 1].map((k) => { const id = r.sp?.[k] ?? null; if (id !== null && !(Number.isInteger(id) && id >= 0 && id < nSp)) bad(`roster[${i}].sp[${k}] 없는 필살기 ID: ${id}`); return id; });
    const fx = { famPow: {}, famPct: {} };
    for (const fk of ['famPow', 'famPct']) for (const [fam, v] of Object.entries(r.fx?.[fk] ?? {})) fx[fk][fam] = fxInt(v, `roster[${i}].fx.${fk}.${fam}`);
    for (const k of FX_NUM) fx[k] = fxInt(r.fx?.[k] ?? 0, `roster[${i}].fx.${k}`);
    return {
      i, from: { team, idx }, stat, hp, r1, r2, r3, sp, fx,
      down: Math.max(Math.min(caps.downFramesMin, R.hit.downFrames), R.hit.downFrames - r3), // R3: 60 -> 하한 36
    };
  });
  const team = o.team ?? roster[0].from.team;
  if (!Number.isInteger(team) || !data.teams[team]) bad('team 없음: ' + team);
  let fm = null, fmTeam = null;
  if (o.fm !== undefined && o.fm !== null) {
    int(o.fm, 'fm');
    const row = data.formations?.teams.find((t) => t.name_idx === o.fm);
    if (!row) bad('fm 없는 포메이션 패턴: ' + o.fm);
    fm = o.fm; fmTeam = row.team; // 같은 패턴을 쓰는 팀 중 첫 팀의 표(위치·순서는 패턴마다 하나다)
  }
  return { seat, team, fm, fmTeam, caps, allow, famOf, roster, surviveUsed: [] };
}

/** 지금 발동되는 필살기 ID(D1: 주 슬롯). 잠겨 있거나 비어 있으면 null */
export function flActiveId(fl, p) {
  const id = fl.caps.slotRule === 'primary' ? p.fl.sp[0] : p.fl.sp[0] ?? p.fl.sp[1];
  return id !== null && fl.allow.has(id) ? id : null;
}

/** 필살기 발동 허용(specialReady 의 こうしき 검사 다음). 받아치기는 lockCounter 가 꺼져 있으면 잠금과 무관 */
export function flCanSpecial(fl, p, counter) {
  if (counter && !fl.caps.lockCounter) return true;
  return flActiveId(fl, p) !== null;
}

/** R1: 넉백 수평 속도 성분 x (100 - r1)% (0 쪽으로 내림). 수직 속도·공의 튕김은 호출 쪽에서 줄이기 전 값으로 계산한다 */
export function flKnock(p, v) { return p.fl.r1 ? Math.trunc((v * (100 - p.fl.r1)) / 100) : v; }

/** R2: 캐치 후 밀림 시작 속력 x (100 - r2)% (내림, 최소 1). 감속은 그대로 -> 시간 x(1-s), 거리 약 x(1-s)^2 (37 §3-C8) */
export function flSlide(p, v) { return p.fl.r2 ? Math.max(1, Math.floor((v * (100 - p.fl.r2)) / 100)) : v; }

/** 걷기 상한(D14): 사람 걷기 속도를 대시 상한으로 자른다. 대시·컴퓨터형 이동 식은 건드리지 않는다 */
export function flWalk(fl, w, dashMax) { return fl.caps.walkCap ? Math.min(w, dashMax) : w; }

/** 공 획득: 패스 직후 투구 속도 보너스(공에 실려 온 값)를 받은 선수에게 옮긴다. 패스 수신이 아니면 0 */
export function flGive(m, q, how) {
  const b = m.ball, v = b.flPass | 0;
  b.flPass = 0;
  if (q.fl) q.flPassSpd = how === 'recv' ? v : 0;
}

/** 패스 발사: 패서의 '패스 직후 투구 속도' 값을 공에 싣는다(받은 같은 편 선수의 다음 투구에 가산, 37 §3-C10). 받았던 보너스는 패스하면 사라진다 */
export function flPass(m, p) { m.ball.flPass = p.fl ? p.fl.fx.passSpd : 0; if (p.fl) p.flPassSpd = 0; }

/** 투구 속력(8.8) 가산: 패스 직후 +N(s6 단위, <<4). 받아치기 공은 승계값 그대로 */
export function flThrowSpd(m, p, spd, counter) {
  const add = p.flPassSpd | 0;
  p.flPassSpd = 0;
  return counter && !m.fl.caps.counterBonus ? spd : (spd + (add << 4)) & 0xffff;
}

/**
 * 투구 위력 가산(위력 확정 뒤): (일반 = 원작 식 | 필살 = 표값) + 고정값 합 -> % 는 마지막(내림). 받아치기 공은 가산 없음.
 * c = {air, ch(가산에 쓰인 차지 0~15), spId(null = 일반), counter}
 */
export function flThrowPow(m, p, power, c) {
  const f = p.fl.fx, L = m.R.special, caught = p.flCatch;
  p.flCatch = 0; // 캐치 후 '첫' 투구: 받아치기로 던져도 소비된다
  if (c.counter && !m.fl.caps.counterBonus) return power;
  let add = 0, pct = 0;
  if (caught) add += f.catchPow;
  if (c.ch >= L.minCharge && c.ch <= L.maxCharge) add += f.chargePow;
  if (c.air) add += f.airPow;
  if (c.spId !== null) {
    add += f.spPow; pct += f.spPct;
    if (c.air) add += f.spAirPow;
    for (const fam of m.fl.famOf.get(c.spId) ?? []) { add += f.famPow[fam] | 0; pct += f.famPct[fam] | 0; }
  }
  power += add;
  return clamp(pct ? Math.floor((power * (100 + pct)) / 100) : power, 0, FLAME_LIMITS.powMax); // 음수·8.8 넘침 방지(P1 리뷰 M2)
}

/** 피격 피해: HP 30% 이하 방어 가산, 도전당 1회 치사 생존(HP 1). 내야 슬롯·체력제에서 원작 피해가 0 보다 클 때만 불린다 */
export function flHitDmg(m, q, power, dmg) {
  const f = q.fl.fx, fl = m.fl;
  if (f.lowHpDef && q.hp * 100 <= q.stat.hp * fl.caps.lowHpPct) dmg = Math.max(0, power - q.stat.def - f.lowHpDef);
  if (f.survive > 0 && q.hp > 0 && q.hp - dmg <= 0) {
    f.survive--; dmg = q.hp - 1;
    fl.surviveUsed.push(q.idx);
    m.emit('fl_survive', { p: q.pid });
  }
  return dmg;
}

/** 경기 종료 뒤 도전 상태에 돌려줄 값: 라인업 순서의 최종 HP·최대 HP, 치사 생존을 쓴 선수 번호 */
export function flameResult(m) {
  const fl = m.fl, ps = m.players.slice(fl.seat * 7, fl.seat * 7 + 7);
  return { seat: fl.seat, hp: ps.map((p) => p.hp), maxHp: ps.map((p) => p.stat.hp), surviveUsed: fl.surviveUsed.slice() };
}
