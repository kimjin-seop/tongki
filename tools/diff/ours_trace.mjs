// 우리 트레이서 + 상태 주입 어댑터. 엔진 파일(server/engine)은 수정하지 않고 Match 객체 필드를 직접 읽고 쓴다.
// 원작 트레이스(tools/diff/traces/oracle/*.json)의 init(프레임 0)을 우리 엔진에 주입하고, 같은 입력열로 Match.tick 을 돌려 같은 스키마로 덤프한다.
//
// 단위 변환 규칙
//  - 좌표·속도: 원작 $20/$24/$28(x,y,z), $30/$34/$38(vx,vy,vz) 32비트 16.16 = 우리 p.x.. 16.16 정수. 변환 없이 그대로 비교(z 는 양쪽 모두 위가 +).
//  - 선수 번호: 원작 obj k(0xC000+k*0x80, k=0..13) = 우리 pid k (0~6 좌팀 $E700, 7~13 우팀 $E780). 공 = obj14(0xC700).
//  - 능력치: $40.. s0~s7 = hp, def, spd, s3, pow, s5, thr, pass.
//  - 입력: 패드 비트 U1 D2 L4 R8 B16 C32 A64 S128 = consts.BIT 과 동일. 프레임 i 의 상태 = i 번째 입력을 적용한 직후(원작: VBlank 1회+로직 1회, 우리: tick 1회). 오프셋 없음.
//  - 상태(act): 원작 타입($0&0x7FFC)+서브($17) 와 우리 ST 를 아래 공통 라벨로 바꿔 비교. 타이머(tmr)는 원작 $18 대 우리 p.tm, TIMED 라벨일 때만 비교.
import { Match, ST, BM } from '../../server/engine/index.js';
import { loadData } from '../../server/engine/data.js';

export const FIX = ['x', 'y', 'z', 'vx', 'vy', 'vz'];
export const TIMED = new Set(['catch', 'crouch', 'pickup', 'foul', 'down']);

// ---- 원작 -> 공통 라벨 ----
const HUMAN_SUB = { 0x00: 'idle', 0x04: 'jump', 0x08: 'dash', 0x0c: 'throw', 0x10: 'pass', 0x14: 'catch', 0x18: 'crouch', 0x1c: 'pickup', 0x20: 'slide', 0x24: 'aircharge', 0x28: 'brake' };
const TYPE_ACT = { 0x30: 'recv', 0x3c: 'hit', 0x40: 'down', 0x44: 't44', 0x48: 'foul', 0x4c: 'outmove', 0x6c: 'jump', 0x88: 'jump' };
export function oracleAct(o) {
  const t = o.type & 0x7ffc;
  if (t === 0x10 || t === 0x34 || t === 0x38) return HUMAN_SUB[o.sub] ?? 'sub' + o.sub.toString(16);
  if (TYPE_ACT[t]) return TYPE_ACT[t];
  if (t === 0x20 || t === 0x24 || t === 0x28 || t === 0x70 || t === 0x74) return o.sub === 0 ? 'idle' : 'cpu' + o.sub.toString(16); // CPU 형 서브는 미해독
  return 'type' + t.toString(16);
}
const BALL_MODE = { 0x04: 'held', 0x14: 'fly', 0x18: 'pass', 0x1c: 'loose', 0x68: 'tip', 0x90: 'special' };
export const oracleBallMode = (o) => BALL_MODE[o.type & 0x7ffc] ?? 'type' + (o.type & 0x7ffc).toString(16);

/** 원작 프레임 스냅샷 -> 비교용 공통 형식 */
export function normOracle(fr) {
  const p = fr.o.slice(0, 14).map((o) => ({ x: o.x, y: o.y, z: o.z, vx: o.vx, vy: o.vy, vz: o.vz, act: oracleAct(o), tmr: o.tmr, hp: o.stat[0], raw: `type ${(o.type & 0x7ffc).toString(16)} sub ${o.sub.toString(16)}` }));
  const b = fr.o[14];
  const ball = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, mode: oracleBallMode(b), power: b.f1a, holder: (b.type & 0x7ffc) === 4 ? (b.own - 0xc000) / 0x80 : -1 };
  return { f: fr.f, p, ball, rem: fr.rem, rng: fr.rng >>> 0, ctrl: fr.ctrl.map((c) => (c >= 0xc000 && c < 0xc700 ? (c - 0xc000) / 0x80 : -1)) };
}

// ---- 우리 -> 공통 라벨 ----
const ST_NAME = Object.fromEntries(Object.entries(ST).map(([k, v]) => [v, k]));
const OURS_ACT = { IDLE: 'idle', JUMP: 'jump', DASH: 'dash', BRAKE: 'brake', CHARGE: 'throw', THROW: 'throw', PASS: 'pass', CATCH: 'catch', CROUCH: 'crouch', PICKUP: 'pickup', HIT: 'hit', DOWN: 'down', OUTMOVE: 'outmove', DEAD: 'dead', GONE: 'gone', FOUL: 'foul' };
const CPU_ST = { CATCH: 'cpu14', CROUCH: 'cpu18', PICKUP: 'cpu1c', JUMP: 'cpu4' }; // 컴퓨터형(타입 0x20/0x24/0x28/0x70/0x74)의 서브 번호 라벨. 원작 쪽 oracleAct 와 같은 이름
export function oursAct(p, m) {
  const n = ST_NAME[p.st] ?? 'st' + p.st;
  if (m && p.recv && m.R.cpu.rom && p.st !== ST.HIT && p.st !== ST.DOWN) return 'recv'; // 패스 수신 대기(타입 0x30)
  if (m && !m.isHuman(p) && !p.t44 && !p.recv && !p.tipJ && m.R.cpu.rom) { // 컴퓨터형 선수: 원작은 서브 번호로만 구분된다(cpuN). 엔진 두뇌 상태(p.cb.sub / 외야 p.ob.mv)를 같은 라벨로
    if (p.slideV > 0) return 'cpu20';
    if (p.wind) return p.wind.kind === 'pass' ? 'cpu10' : 'cpuc'; // 투구·패스 동작(서브 0x0C/0x10)
    if (n === 'JUMP' && p.charging) return 'cpu24'; // 공중 차지
    if (n === 'DASH') return 'cpu8'; // 공격 plan 의 대시 주행(서브 8)
    if (CPU_ST[n]) return CPU_ST[n];
    if (n === 'IDLE') { const sub = p.role === 'out' ? (p.cb?.act ? p.cb.sub ?? 0 : p.ob?.pc ? 0x0c : p.ob?.mv ? 0x10 : 0) : p.cb?.sub ?? 0; return sub ? 'cpu' + sub.toString(16) : 'idle'; }
  }
  if (n === 'JUMP' && p.charging) return 'aircharge';
  return OURS_ACT[n] ?? 'ours:' + n; // 엔진에 새 상태가 생기면 OURS_ACT 에 추가
}
const OURS_MODE = { [BM.HELD]: 'held', [BM.FLY]: 'fly', [BM.PASS]: 'pass', [BM.LOOSE]: 'loose', [BM.DROP]: 'tip' };

export function normOurs(m, f) {
  const p = m.players.map((q) => ({ x: q.x, y: q.y, z: q.z, vx: q.vx, vy: q.vy, vz: q.vz, act: oursAct(q, m), tmr: q.tm, hp: q.hp, raw: `st ${ST_NAME[q.st] ?? q.st}` }));
  const b = m.ball;
  const ball = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, mode: b.mode === BM.FLY && b.sp ? 'special' : OURS_MODE[b.mode] ?? 'mode' + b.mode, power: b.power, holder: b.mode === BM.HELD ? b.holder : -1 };
  return { f, p, ball, rem: m.sides.map((s) => s.remaining), rng: m.rng.seed >>> 0, ctrl: m.sides.map((s) => s.ctrl) };
}

const STAT_KEYS = ['hp', 'def', 'spd', 's3', 'pow', 's5', 'thr', 'pass'];

/** 원작 init 상태로 Match 를 만든다. 반환 {m, notes}. notes = 주입하지 못했거나 근사한 항목 */
export function inject(init, setup = []) {
  const data = loadData();
  const notes = [];
  // 팀: 원작 능력치와 일치하는 팀을 찾는다(능력치는 어차피 원작 값으로 덮어쓴다)
  const teamOf = (k0) => {
    const s = init.o[k0].stat;
    const i = data.teams.findIndex((t) => t && STAT_KEYS.slice(1).every((key, j) => t.players[0][key] === s[j + 1]));
    if (i < 0) notes.push(`obj${k0} 능력치와 일치하는 팀 없음 -> 팀 ${k0 ? 1 : 0} 사용`);
    return i < 0 ? (k0 ? 1 : 0) : i;
  };
  // setup 에 poke:E680,01 이 있으면 こうしき 규칙으로 돌린다(원작 $E680=1 <-> Match 옵션 ruleMode:'official'). 없으면 종전과 같은 생성(체력제)
  const official = setup.some((x) => /^poke:E680,0*1$/i.test(x));
  const m = new Match({ seed: 1, teams: [teamOf(0), teamOf(7)], data, humans: [true, false], ...(official ? { ruleMode: 'official' } : {}) });
  let n = 0;
  while ((m.phase !== 'play' || m.tip.on) && n < 6000) { m.tick([0, 0]); n++; } // 입장·점프볼 연출을 지나 일반 경기 상태로
  if (m.phase !== 'play' || m.tip.on) throw new Error('우리 엔진이 경기 상태에 도달하지 못함');
  m.drainEvents();
  m.fm = null;
  for (let k = 0; k < 14; k++) {
    const o = init.o[k], p = m.players[k], act = oracleAct(o);
    p.stat = { ...p.stat, ...Object.fromEntries(STAT_KEYS.map((key, j) => [key, o.stat[j]])) };
    p.hp = o.stat[0];
    p.slot = o.f1a; p.role = o.f1a < 4 ? 'in' : 'out';
    for (const key of FIX) p[key] = o[key];
    const air = o.z > 0 || o.vz > 0;
    p.st = air ? ST.JUMP : ST.IDLE;
    if (act !== 'idle' && !(act === 'jump' && air)) notes.push(`obj${k} 원작 상태 ${act}(${o.type.toString(16)}/${o.sub.toString(16)}) -> ${air ? 'JUMP' : 'IDLE'} 로 근사`);
    p.face = o.f3 & 1 ? -1 : 1; p.back = !!(o.f3 & 2); // $3 bit0 = 왼쪽 보기, bit1 = 뒤 보기 [확인 ROM 0x7868/0x78A0]. 방향 자체는 비교 대상이 아니지만 보유 공 위치·캐치 판정에 쓰인다
    p.hb = p.hbC = o.hb; p.stH = p.st; p.fs = 0; p.fsNew = false; p.dashT = 0; p.wind = null; p.slideV = 0; p.dashDir = 0; p.dashNew = false;
    p.tipJ = (o.type & 0x7ffc) === 0x88 ? 1 : 0; // 점프볼 점프 중(타입 0x88)
    // 컴퓨터형 두뇌 상태 주입(원작 $16 서브·$18 타이머·$5E plan·$60/$62 대기점). 트레이스에 필드가 없으면(옛 트레이스) 기본값
    const ty = o.type & 0x7ffc;
    p.cb = null; p.ob = null; p.t44 = null; p.recv = null;
    if (o.plan !== undefined) {
      if (ty === 0x24 || ty === 0x28) p.ob = { t: o.tmr, tx: o.tx, ty: o.ty, mv: o.sub === 0x10 };
      else p.cb = { sub: ty === 0x20 || ty === 0x70 ? o.sub : 0, fresh: !(ty === 0x20 || ty === 0x70) || !o.init, tm: o.tmr, tx: o.tx, ty: o.ty, plan: o.plan & 0x7c, pf: !(o.plan & 0x8000), act: ty === 0x20 ? false : ty === 0x70 ? true : null, busy: 0 };
    }
    Object.assign(p, { tm: 0, prev: 0, tapDir: 0, tapF: -999, hold: 0, charging: false, charge: 0, dashFlag: false, hasBall: false, slide: 0, swing: 0, en: null, dead: false, from: null, to: null, plan: null, wander: null, aiDash: false });
  }
  const b = init.o[14], bt = b.type & 0x7ffc, mb = m.ball;
  if (bt === 4) m.giveBall(m.players[(b.own - 0xc000) / 0x80]);
  else {
    mb.mode = BM.LOOSE; mb.holder = -1; mb.kind = 0; mb.sp = null;
    if (bt !== 0x1c) notes.push(`공 원작 타입 ${bt.toString(16)} -> LOOSE 로 근사`);
  }
  for (const key of FIX) mb[key] = b[key];
  mb.still = 0;
  mb.owner = b.own >= 0xc000 && b.own < 0xc700 ? (b.own - 0xc000) / 0x80 : -1; // 공 $1C(마지막 보유자)
  mb.d0 = !!(b.f3 & 1); mb.d1 = !!(b.f3 & 2); // 공 방향 비트
  if (b.a72 !== undefined) mb.ang = { i: b.a70, fl: b.a72 }; // 마지막 투구 각도
  mb.romPass = false;
  // 기본 패스 대상($E214)도 원작 값으로: 위 giveBall 이 엔진 규칙으로 정한 값이 남으면, setup give_ball(RAM 직접 쓰기라 $E214 는 0 그대로)인 원작과 달리 그 선수가 지정 대기(서브 0x0C)에 들어가 외야 120프레임 타이머가 갈린다 [실측 ctr_special f94 p4]
  if (init.e214 !== undefined) m.e214 = init.e214 >= 0xc000 && init.e214 < 0xc700 ? (init.e214 - 0xc000) / 0x80 : -1;
  m.drainEvents();
  for (let s = 0; s < 2; s++) {
    const c = init.ctrl[s];
    m.sides[s].ctrl = c >= 0xc000 && c < 0xc700 ? (c - 0xc000) / 0x80 : s * 7;
    m.sides[s].remaining = init.rem[s]; m.sides[s].aim = 0; m.sides[s].bits = 0;
    if (init.zone) { const sb = (v) => (v & 0x80 ? v - 256 : v); m.sides[s].zp = sb(init.zone[s][0]); m.sides[s].zone = sb(init.zone[s][1]); } // 공 구역 직전/현재 값
  }
  m.sPrev = [0, 0];
  m.rng.seed = init.rng >>> 0;
  return { m, notes };
}

/** 원작 트레이스와 같은 입력으로 우리 엔진을 돌린다. pin = 좌팀 조작 선수를 원작 조작 선수로 매 틱 고정(우리 자동 전환 규칙 차이를 분리) */
export function runOurs(trace, { pin = true, humans = null } = {}) {
  const { m, notes } = inject(trace.init, trace.setup ?? []);
  if (humans) m.humans = humans;
  const ctrl0 = m.sides[0].ctrl;
  const frames = [normOurs(m, 0)];
  const events = [];
  let switched = 0;
  trace.pads.forEach((pad, i) => {
    if (m.sides[0].ctrl !== ctrl0) { switched++; if (pin) m.sides[0].ctrl = ctrl0; }
    m.tick([pad, trace.pads2?.[i] ?? 0]);
    frames.push(normOurs(m, i + 1));
    for (const e of m.drainEvents()) events.push({ f: i + 1, k: e.k, p: e.p });
  });
  if (switched) notes.push(`우리 엔진이 조작 선수를 ${switched}회 바꿈${pin ? '(고정으로 되돌림)' : ''}`);
  return { frames, events, notes };
}
