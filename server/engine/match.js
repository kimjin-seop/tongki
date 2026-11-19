// 피구왕 통키 규칙 엔진: 렌더·네트워크와 분리된 순수 결정적 시뮬레이션 (60Hz 고정 틱)
// 위치/속도는 16.16 고정소수 정수. 난수는 원작 RNG(rng.js). Math.random/Date 사용 금지.
// 근거: analysis/05_match_rules.md. 미확정 항목은 [추정] 주석 + server/data/rules.json 분리.
import { Rng } from './rng.js';
import { aiInput } from './ai.js';
import { ONE, BIT, ST, BM, FM, slotGroup } from './consts.js';
import { initSpecial, stepSpecial } from './special.js';
import { initFlameSeats, flActiveId, flCanSpecial, flKnock, flSlide, flWalk, flGive, flPass, flThrowSpd, flSpSpd, flThrowPow, flHitDmg, flameResult } from './flame.js';

export { ONE, BIT, ST, BM, FM, slotGroup };
const SLOT_OF_IDX = [0, 1, 2, 3, 4, 7, 10]; // 선수 idx -> 시작 슬롯 [확인 0x4C0E 표, 외야 상/하/후방 1명씩]
// 슬롯별 기본 패스 구역(사이드 $20 워드 표) [확인: 원작 RAM 실측(ctrl0 상태) 좌석0 $E720 / 좌석1 $E7A0. 경기 중 바뀌는지는 미확인(사람은 방향키로 $E20E 를 따로 쓴다)]
const PASS_GRP = [[4, 4, 4, 4, 10, 10, 10, 0, 0, 0, 7, 7, 7], [10, 10, 10, 10, 7, 7, 7, 0, 0, 0, 4, 4, 4]]; // [좌석][슬롯 0~12] -> 패스 구역(0 내야, 4 상단, 7 하단, 10 후방)

// 시작 연출 단계(snap.sq[0]) [웹 구현 사양 08 §7]
export const SQ = { ENTER: 0, HUD: 1, REF_IN: 2, REF_WAIT: 3, GO: 4, TOSS: 5, BACK: 6, WATCH: 7 };

const px = (v) => Math.round(v * ONE);
const toPx = (v) => v / ONE;
/** game_start.flame 의 좌석 한 칸(PROTOCOL §12.2): {seat, fm, allow}. 좌석이 flame 이 아니면 null */
const flInfo = (fl) => (fl ? { seat: fl.seat, fm: fl.fm, allow: [...fl.allow].sort((a, c) => a - c) } : null);
const sgn = (v) => (v > 0) - (v < 0);
const approach = (v, t, a) => (v < t ? Math.min(v + a, t) : Math.max(v - a, t));

/** 원작 각도 루틴 [직역 ROM 0x2254]: (sx,sy)->(tx,ty) 방향을 팔분면 플래그(1=x음수, 2=y음수, 4=y가 주축) + 0..63 기울기 인덱스로. 좌표는 정수 px */
export function romAngle(tx, ty, sx, sy) {
  let fl = 0, a = tx - sx, c = ty - sy;
  if (a < 0) { fl |= 1; a = -a; }
  if (c < 0) { fl |= 2; c = -c; }
  if (c >= a) { fl |= 4; const t = a; a = c; c = t; }
  let i = a === 0 ? 0 : Math.floor((c << 6) / a) & 0xff;
  if (i >= 0x40) i = 0x3f;
  return { i, fl, major: a };
}
/** 원작 속도 분해 [직역 ROM 0x22DA, 표 0x232A]: 각도(i,fl)와 속력(8.8 워드) -> [x성분, y성분] 16.16 */
export function romDecomp(T, i, fl, spd) {
  let mi, ma;
  if (i === 0) { mi = 0; ma = spd; } else { mi = Math.floor((T[i][0] * spd) / 65536); ma = Math.floor((T[i][1] * spd) / 65536); }
  if (fl & 4) { const t = mi; mi = ma; ma = t; }
  return [(fl & 1 ? -ma : ma) * 256, (fl & 2 ? -mi : mi) * 256];
}

export class Match {
  /**
   * @param {{seed:number, teams:[number,number], data:{rules,teams,court}, humans?:[boolean,boolean], cpuLevels?:[number|null,number|null], limitFrames?:number, ruleMode?:'knockout'|'official'}} o
   * humans[s]=false 이면 그 사이드는 조작 선수도 AI가 움직인다(시뮬레이션/테스트용).
   */
  constructor(o) {
    this.data = o.data;
    this.R = o.data.rules;
    this.seed = o.seed >>> 0;
    // 원작 시드($E620)는 언제나 짝수다: 쓰는 곳이 VBlank 의 +2(0x928)와 난수 루틴(0x14EA, 시드x41 이라 짝수는 짝수로 남는다) 둘뿐이고 0 에서 출발한다 [확인: 원작 트레이스 67개 8,160프레임에 홀수 0].
    // 짝수 시드에서는 난수를 불러도 하위 4비트가 그대로라(9n = n mod 16) 'bit3' 판정(외야 자리 이동 0x9234, 수동 내야 대기점 0x8EDE, plan 0x30)이 프레임 위상(8프레임 주기 중 4프레임)으로 정해진다.
    // 홀수 시드는 원작에 없는 상태(부를 때마다 bit3 이 뒤집힘)라 외야 대기 선수가 원작보다 자주 움직였다 -> 최하위 비트를 버린다. this.seed(기록·스냅샷용)는 받은 값 그대로 (analysis/25 §11)
    this.rng = new Rng((this.seed & 0xfffffffe) >>> 0);
    this.humans = o.humans ?? [true, true];
    // 컴퓨터 대전: cpuLevels[s]=1~3 이면 그 사이드 AI에 난이도 파라미터 적용(rules.cpu.levels). 없으면 기존 AI 그대로.
    // 사람 사이드의 비조작 동료(아군 CPU)는 기본 난이도(rules.cpu.defaultLevel) 값으로 움직인다: 동료도 기민하게 공을 줍고 막는다(analysis/18). 사람이 없는 사이드(봇/시뮬)는 종전대로
    this.aiTune = [0, 1].map((s) => (o.cpuLevels?.[s] ? this.R.cpu.levels[o.cpuLevels[s]] ?? null : this.humans[s] ? this.R.cpu.levels[this.R.cpu.defaultLevel] ?? null : null));
    // 필살기 강제 발동(시뮬레이션/테스트용): true=내야 선수 전 투구를 표의 ID로, 숫자=그 ID로 고정. 기본 꺼짐
    this.forceSpecial = o.forceSpecial ?? false;
    // 스테이지: 마찰·바운스를 stages.json 표로 교체. 미지정/0 은 기존 rules.stage 와 같은 값(결과 동일)
    const stId = o.stage ?? 0;
    const stRow = o.data.stages?.find((x) => x.id === stId);
    if (!stRow && stId !== 0) throw new Error('unknown stage ' + stId);
    this.stageInfo = stRow ?? { id: 0, key: 'bg.stage.00', file: 'rom/bg/stage_00', json: 'rom/bg/stage_00.json', romStage: 1 };
    this.stage = stRow ? { friction: stRow.friction, bounceShift: stRow.bounceShift } : this.R.stage;
    // 컴퓨터 필살기 시도 확률(/256), 사이드별. 기본은 rules.cpu.specialChance256(0)
    this.aiSpecial = [0, 1].map((x) => o.specialChance256?.[x] ?? this.R.cpu?.specialChance256 ?? 0);
    // 포메이션 어택(analysis/14): rules.formation.enabled=false 이거나 formations 데이터가 없으면 완전히 꺼짐
    // 특훈(원작 $E68E=4, analysis/29 §1·§4-2): training: {kind:'catch'|'special'}. 팀·스테이지·배치는 training.json 이 정하고 시작 연출·시계·포메이션·아웃이 없다. 주지 않으면 아래 분기는 전부 건너뛴다(일반 경기·차분 하네스 불변)
    const TR = o.training ? o.data.training : null;
    if (o.training) {
      if (!TR) throw new Error('training data missing');
      if (o.training.kind !== 'catch' && o.training.kind !== 'special') throw new Error('unknown training kind: ' + o.training.kind);
      const row = o.data.stages?.find((x) => x.id === TR.stage);
      this.stageInfo = row; this.stage = { friction: row.friction, bounceShift: row.bounceShift };
    }
    this.tr = null; // 특훈 진행기 상태(initTraining)
    // 불꽃의 계승(flame.js, analysis/37·39): flame 옵션을 줄 때만 this.fl 이 생기고 그 좌석 선수에 p.fl 이 붙는다. 주지 않으면 아래의 모든 flame 분기(p.fl / this.fl 검사)가 건너뛴다(일반 경기·차분 하네스 불변)
    if (o.flame && TR) throw new Error('flame 과 training 은 함께 쓸 수 없다');
    // 좌석별(analysis/39 D53): fls[좌석] = 그 좌석의 flame 상태 | null. this.fl = flame 좌석이 하나라도 있음 표시이자 한 좌석 경기의 그 좌석(종전 값과 같다). 좌석 단위 값은 언제나 fls[p.seat] 로 읽는다
    this.fls = o.flame ? initFlameSeats(o.data, o.flame, this.R) : [null, null];
    this.fl = this.fls[0] ?? this.fls[1];
    this.fmOn = !TR && !!(this.R.formation?.enabled && o.data.formations);
    this.fm = null; this.fmLast = -1; this.sPrev = [0, 0]; this.sEdge = [0, 0];
    this.f = 0;
    this.restK = null; this.restC = null; // predictRest 캐시
    this.phase = 'ready'; // ready=입장~GO 전(입력 잠금), play=GO 이후, end=종료 연출
    this.sq = { s: SQ.ENTER, t: 0 };
    this.ref = null; // 심판 {x,y(px),anim,at,flip,call,final}. null=아직 등장 전
    this.banner = null; // {k, f0}
    this.tip = { on: false, tossed: false, fg: [false, false], goWait: 0 };
    this.endPre = 0; this.endHold = 0;
    this.clock = 0;
    this.sudden = false;
    this.timeHold = 0; // こうしき 시간 종료 동수의 배너 대기 카운터(stepTimeHold). 0 = 아님
    // 경기별 규칙 옵션(원작 규칙 창). 주지 않으면 rules.json 값 그대로(차분 하네스·시뮬레이션 불변)
    // limitFrames: 제한 시간(프레임), 0 = 무제한(시간 종료 판정 없음, 시계 표시 없음). 무제한의 무승부 상한은 time.unlimitedCapFrames [자작 안전망]
    this.limitFrames = TR ? 0 : o.limitFrames ?? this.R.time.limitFrames; // 특훈은 시계·시간 종료가 없다
    this.capFrames = this.limitFrames > 0 ? Math.max(this.R.time.hardCapFrames, this.limitFrames) : this.R.time.unlimitedCapFrames ?? this.R.time.hardCapFrames;
    // ruleMode: 'official' = こうしき(원작 $E680=1, analysis/29 §3). this.official 이 켜졌을 때만 아래 분기가 돈다(주지 않으면 체력제 = 종전 경로 그대로):
    //  피격 데미지 0(0x853E) / 맞은 공이 바닥에 닿거나(0xA5E2) 상대편이 잡으면(0x73DE) 쓰러짐이 끝날 때 아웃, 같은 편이 먼저 잡으면 세이프(0x9554) / 필살 슛은 일반 슛으로(0x8BFA)
    //  컴퓨터 방어 표 0xD624(ai.js defend) / 시간 종료 동수 = TIME UP·PLAY OFF 배너 동안 선수 정지 뒤 양쪽 남은 인원 1(0x61C8, stepTimeHold) / 얼굴 HUD 떨림 없음(0xDF7E). 특훈($E68E=4)에는 규칙 창이 없다
    this.ruleMode = o.ruleMode === 'official' && !TR ? 'official' : 'knockout';
    this.official = this.ruleMode === 'official';
    this.result = null;
    this.endF = 0;
    this.ev = [];
    this.throwId = 0;
    this.players = [];
    this.sides = [];
    for (let s = 0; s < 2; s++) {
      const fl = this.fls[s];
      const teamId = TR ? TR.teams[s] : fl ? fl.team : o.teams[s];
      const team = o.data.teams[teamId];
      if (!team) throw new Error('unknown team ' + teamId);
      this.sides.push({ seat: s, team: team.id, teamData: team, remaining: 7, ctrl: -1, aim: 0, bits: 0, fmLeft: this.fmOn ? this.R.formation.uses : 0, fmCnt: 0, fmPend: false, zone: 0, zp: 0 }); // zone/zp = 공 구역 현재/직전 값(원작 사이드 $5D/$5C)
      if (fl) this.sides[s].fmT = fl.fmTeam ?? team.id; // 포메이션 패턴의 기준 팀(fmOf)
      for (let i = 0; i < 7; i++) this.players.push(fl ? this.makeFlamePlayer(s, i, fl.roster[i]) : this.makePlayer(s, i, team.players[i]));
    }
    const RF = this.R.start.ref;
    this.ball = {
      x: px(RF.startX), y: px(RF.startY + RF.ballDy), z: px(RF.handDz.stand), vx: 0, vy: 0, vz: 0,
      mode: BM.DROP, holder: -1, thrower: -1, tgt: -1, power: 0, kind: 0, still: 0, id: 0, sp: null, lastHit: -1, // lastHit = 공 $3C(마지막으로 맞거나 잡은 선수) // DROP = 심판이 들고 있는 공(토스 전)
    };
    for (const s of this.sides) s.ctrl = s.seat * 7; // 점프볼 참가자 = 각 팀 슬롯0(idx 0)
    if (TR) this.initTraining(o.training.kind); else this.initEntry();
  }

  // ================= 특훈 (analysis/29 §1, §4-2) =================
  /**
   * 특훈 시작 상태 [확인 0x3750/0x3E46]: 입장·심판·점프볼 없이 곧바로 예고(120f). 양쪽 내야는 선수 0 한 명(남은 인원 1), 나머지 6명은 외야 슬롯.
   * 공은 캐치 특훈이면 연습 상대(좌석 1 선수 0)가, 필살 슛 특훈이면 내 쪽(좌석 0 선수 0)이 들고 시작한다(표 holder). 연습하는 쪽은 언제나 좌석 0
   */
  initTraining(kind) {
    const T = this.data.training, C = T[kind];
    for (const s of this.sides) s.remaining = 1;
    for (let seat = 0; seat < 2; seat++) {
      let k = 0;
      for (let i = 0; i < 7; i++) {
        const p = this.players[seat * 7 + i];
        if (i === T.infieldIdx) { p.slot = 0; p.role = 'in'; const [x, y] = seat === 0 ? T.start.a : T.start.b; p.x = px(x); p.y = px(y); }
        else { p.slot = T.outSlots[k++]; p.role = 'out'; const [x, y] = this.slotPos(seat, p.slot); p.x = px(x); p.y = px(y); }
      }
    }
    this.phase = 'play'; this.sq = { s: SQ.WATCH, t: 0 }; this.readyFrames = 0;
    this.tr = { kind, step: 0, phase: 'intro', t: 0, count: 0, thrown: 0, retry: 0, grade: -1, msg: C.steps[0].intro, ch: 0, chT: 0 }; // ch/chT = 필살 슛 특훈의 차지 게이지 값·깜빡임 남은 프레임
    this.giveBall(this.players[C.holder * 7 + T.infieldIdx]);
    this.stepBall(); // 보유 공을 손 위치로
  }

  /** 약한 투구(위력 1/4, 가산 없는 속력)의 대상인가 [판독만 ROM 0x89E6/0x7D4C]: 캐치 특훈 = 내 쪽(좌석 0), 필살 슛 특훈 = 연습 상대 쪽(좌석 1) [확인 sp_pass10: 5.5px/f, 내 HP 불변] */
  trWeak(p) { return !!this.tr && p.seat === (this.tr.kind === 'catch' ? 0 : 1); }

  /** 필살이 되지 않는 쪽인가 [판독만 ROM 0x8C24]: 캐치 특훈의 내 쪽만. 필살 슛 특훈은 양쪽 다 평소 판정(0x8C42 -> 0x8BF4) */
  trNoSpecial(p) { return !!this.tr && this.tr.kind === 'catch' && p.seat === 0; }

  /** 사람 쪽(좌석 0)의 A 가 패스가 아니라 상대 조준 투구인가 [판독만 ROM 0x7702 -> 0x76D4]: 캐치 특훈 = 좌석 0 전원, 필살 슛 특훈 = 선수 0 */
  trThrowA(p) { return !!this.tr && p.seat === 0 && (this.tr.kind === 'catch' || p.idx === this.data.training.infieldIdx); }

  /** 필살 슛 특훈에서 선수 0 이 아닌 내 쪽 선수가 공을 들었는가: B·A 모두 선수 0 에게 패스한다 [판독만 ROM 0x76EA: $50 != 0 이면 $E214=$C000 -> 패스 0x776C] */
  trPassBack(p) { return !!this.tr && this.tr.kind === 'special' && p.seat === 0 && p.idx !== this.data.training.infieldIdx; }

  /**
   * 투구 집계 [직역 ROM 0x8C46: 선수 번호 0 의 투구만 $64 +1, 필살이면 $68 +1]. 캐치 특훈 = 연습 상대(좌석 1)의 투구 수,
   * 필살 슛 특훈 = 내(좌석 0) 투구 수 + 그중 필살 수(지상 일반 투구도 투구 수에 든다 [확인 sp_pass10])
   */
  trThrow(p, special, charge) {
    const t = this.tr;
    if (!t || p.idx !== this.data.training.infieldIdx) return;
    if (t.kind === 'special' && p.seat === 0 && charge > 0 && (p.z > 0 || p.vz !== 0)) { t.ch = Math.min(charge, this.R.throw.maxCharge); t.chT = this.data.training.special.gaugeHold; } // 공중 차지 투구 뒤 게이지 깜빡임 [판독만 ROM 0x3F36: 타이머 0x78]
    if (t.phase !== 'play') return;
    if (t.kind === 'catch' ? p.seat === 1 : p.seat === 0) { t.thrown++; if (t.kind === 'special' && special) t.count++; }
  }

  /** 필살 슛 특훈 차지 게이지 [판독만 ROM 0x3EA2: 선수 0 이 공중 차지(서브 0x24)에 들면 차지 값을 따라가고, 투구 뒤 120f 깜빡인 다음 0]. 차지가 투구 없이 끝난 경우의 원작 동작은 미확정(0 으로 되돌린다) */
  trGauge() {
    const t = this.tr;
    if (t.kind !== 'special') return;
    const p = this.players[this.data.training.infieldIdx];
    if (p.hasBall && p.charging) { t.ch = Math.min(p.charge, this.R.throw.maxCharge); t.chT = 0; }
    else if (p.hasBall && p.wind && p.wind.kind === 'throw' && p.wind.charge > 0) { t.ch = Math.min(p.wind.charge, this.R.throw.maxCharge); t.chT = 0; }
    else if (t.chT > 0) { if (--t.chT === 0) t.ch = 0; }
    else t.ch = 0;
  }

  /** 캐치 집계 [판독만 ROM 0x7448 -> 0x8CA8]: 선수 번호 0 이 지상에서 살아 있는 투구(필살 슛 포함)를 잡았을 때만 +1 */
  trCatch(q) {
    const t = this.tr;
    if (t && t.phase === 'play' && t.kind === 'catch' && q.seat === 0 && q.idx === this.data.training.infieldIdx && !(q.z > 0 || q.vz !== 0)) t.count++;
  }

  /**
   * 특훈 1프레임 = 진행기 [29 §1-2: $E602 0x04 예고 -> 0x00 연습 -> 0x08 전원 정지 대기 -> 0x0C 페이드 -> 0x10 결과 -> 합격 판정 0x3D70].
   * 예고·대기·페이드·결과 동안은 입력·컴퓨터 두뇌가 멈춘다(물리만 진행) [확인: 예고 중 연습 상대가 공을 든 채 서 있다 / 추정: 대기·결과 구간]
   */
  tickTraining(inputs) {
    const t = this.tr, T = this.data.training, C = T[t.kind], F = T.frames;
    if (this.phase === 'end') { this.stepPlayers([0, 0], false); this.stepBall(); return; }
    t.t++;
    if (t.phase === 'play') {
      this.clock++;
      this.stepPlayers(inputs, true);
      this.stepBall();
      this.autoSwitch();
      this.trGauge();
      // 종료 조건 [판독만 + 확인 0x3C2E]: 캐치 = 상대 투구 수 >= 10, 필살 = 내 투구 수 >= 20 이고 공이 살아 있는 투구가 아닐 때
      if (t.thrown >= C.balls && this.ball.mode !== BM.FLY) { t.phase = 'settle'; t.t = 0; }
      return;
    }
    this.stepPlayers([0, 0], false);
    this.stepBall();
    this.trGauge();
    if (t.phase === 'intro') {
      if (t.t >= F.intro) { t.phase = 'play'; t.t = 0; t.msg = 0; }
    } else if (t.phase === 'settle') {
      const still = this.players.every((p) => p.vx === 0 && p.vy === 0 && p.z === 0 && p.vz === 0 && !(p.slideV > 0) && p.st !== ST.HIT && p.st !== ST.DOWN);
      if (still || t.t >= F.settleMax) { t.phase = 'fade'; t.t = 0; }
    } else if (t.phase === 'fade') {
      if (t.t >= F.fade) {
        const g = C.grades;
        t.grade = t.count < g[0] ? 0 : t.count < g[1] ? 1 : t.count < g[2] ? 2 : 3;
        t.phase = 'result'; t.t = 0; t.msg = T.resultMsg[t.grade];
        this.emit('tr_result', { step: t.step, count: t.count, grade: t.grade, pass: t.count >= C.pass });
      }
    } else if (t.t >= F.result) { // result -> 합격 판정
      if (t.count >= C.pass) {
        if (t.step + 1 >= C.steps.length) { this.trFinish(); return; } // 캐치 3단계 통과 = 완료(필살 슛 특훈으로 이어지지 않는다) [확인 tr_full]. 필살 슛 특훈은 한 단계라 합격하면 완료 [확인 sp_pass10]
        t.step++; t.retry = 0; t.msg = C.steps[t.step].intro;
      } else { t.retry++; t.msg = T.retryMsg[t.kind]; } // 불합격: 같은 단계 다시(횟수 제한 없음)
      t.phase = 'intro'; t.t = 0; t.count = 0; t.thrown = 0; t.grade = -1; // 카운터 0. 선수 위치·공 보유자는 그대로 [확인 0x3C1A]
      this.emit('tr_step', { step: t.step, retry: t.retry });
    }
  }

  /** 특훈 완료: 배너·심판 연출 없이 페이드 길이만큼 뒤에 끝난다(원작은 페이드 뒤 완료 대사 화면 0x94) */
  trFinish() {
    const t = this.tr;
    t.phase = 'done'; t.t = 0; t.msg = 0;
    this.result = { winner: 0, reason: 'training_clear', rem: [this.sides[0].remaining, this.sides[1].remaining] };
    this.phase = 'end'; this.endF = this.f; this.endPre = 0; this.endHold = this.data.training.frames.fade;
    this.emit('end', { winner: 0, reason: 'training_clear' });
  }

  /** 스냅샷 tr [29 §4-2 초안]: step 단계(0부터), count 성공 수, left 남은 공, phase, msg 말풍선 번호(0 = 없음), retry 같은 단계 재시도 횟수. 필살 슛 특훈만 ch(게이지 값 0~15)·chb(깜빡임 남은 프레임) */
  trSnap() {
    const t = this.tr, C = this.data.training[t.kind];
    return { step: t.step, count: t.count, left: Math.max(0, C.balls - t.thrown), phase: t.phase === 'fade' ? 'settle' : t.phase, msg: t.msg, retry: t.retry, ...(t.kind === 'special' ? { ch: t.ch, chb: t.chT } : {}) };
  }

  /** 입장 행진 준비: 양 팀이 화면 밖 출발점에서 슬롯 위치로 걸어 들어온다. readyFrames=GO 틱 번호(결정적 값) */
  initEntry() {
    const E = this.R.start.enter, H = this.R.start.hud, RF = this.R.start.ref;
    let maxN = 1;
    for (const p of this.players) {
      const [sx, sy] = this.slotPos(p.seat, p.slot);
      const [ox, oy] = p.seat === 0 ? E.originA : E.originB;
      const spd = E.baseSpeed + p.stat.spd / E.speedDiv;
      p.en = { tx: sx, ty: sy, spd, ex: ox, ey: oy };
      p.x = px(ox); p.y = px(oy); p.face = p.seat === 0 ? 1 : -1;
      maxN = Math.max(maxN, Math.ceil(Math.hypot(sx - ox, sy - oy) / spd));
    }
    const refN = Math.ceil(RF.standY - RF.arriveTol - RF.startY);
    this.readyFrames = maxN + H.delay + H.frames + H.refDelay + refN + RF.waitFrames;
  }

  makePlayer(seat, idx, st) {
    const slot = SLOT_OF_IDX[idx];
    const [sx, sy] = this.slotPos(seat, slot);
    return {
      pid: seat * 7 + idx, seat, idx, st: ST.IDLE, tm: 0, slot, role: idx < 4 ? 'in' : 'out', dead: false,
      stat: st, cfg: st.ai, hp: st.hp, x: px(sx), y: px(sy), z: 0, vx: 0, vy: 0, vz: 0, slide: 0,
      face: seat === 0 ? 1 : -1, hasBall: false, charging: false, charge: 0, dashFlag: false,
      prev: 0, tapDir: 0, tapF: -999, tapL: -999, tapR: -999, dashDir: 0, dashNew: false, wind: null, windLeft: false, steer: 0, slideV: 0, slideA: null, tmNew: 0, chargeNew: false, hold: 0, from: null, to: null, plan: null, wander: null, ai: { act: null, last: -1 },
      back: false, hb: 1, hbC: 1, stH: ST.IDLE, chkV: true, fs: 0, fsNew: false, tipJ: 0, dashT: 0, // back=원작 $3 bit1(뒤 보기), hb=히트박스 번호($4), fs=선 이탈 단계, tipJ=점프볼 점프(타입 0x88), dashT=대시 발소리 카운터($18)
      cb: null, t44: null, recv: null, aiNoHit: false, aiCatchTm: 0, // cb=컴퓨터형 두뇌 상태(서브·타이머·대기점·plan), t44=강제 회수(타입 0x44), recv=패스 수신 대기(타입 0x30)
    };
  }

  /** flame 좌석 선수: 능력치는 복사본(r.stat), 시작 HP 는 도전 전용 현재 HP, 출신 팀·번호(ot/oi)는 히트박스·손 위치 표의 기준 */
  makeFlamePlayer(seat, idx, r) {
    const p = this.makePlayer(seat, idx, r.stat);
    p.hp = r.hp; p.fl = r; p.ot = r.from.team; p.oi = r.from.idx; p.flCatch = 0; p.flPassSpd = 0;
    return p;
  }

  /** 경기 뒤 flame 좌석의 최종 HP 등(flame 옵션이 없으면 null). 두 좌석 경기 = [좌석 0, 좌석 1](D53) */
  flameResult() { return !this.fl ? null : this.fls[0] && this.fls[1] ? this.fls.map((fl) => flameResult(this, fl)) : flameResult(this); }

  slotPos(seat, slot) {
    const s = this.data.court.slots[slot];
    return seat === 0 ? s.a : s.b;
  }

  emit(k, o = {}) { this.ev.push({ k, f: this.f, ...o }); }
  /** 마지막 스냅샷 이후 이벤트를 비우고 반환 */
  drainEvents() { const e = this.ev; this.ev = []; return e; }

  // ---- 영역(이동 범위) [추정: 0x6E00 표 미해독] ----
  bounds(p) {
    const Z = this.R.zones;
    if (Z.rom) { // 원작 이동 허용영역 표 [확인 ROM 0x6AA4(좌석0)/0x6B0C(좌석1) + 사다리꼴 보정 0x6E56/0x6E8A(x 경계 += ±(y>>2)), 걷기 클램프 0x7F36. 실측 analysis/21 §3]
      const r = Z.rom.area[p.seat][p.slot], t = Z.rom.trap[p.seat][p.slot], q = Math.floor(p.y / ONE) >> 2;
      return { x0: px(r[0] + t[0] * q), x1: px(r[1] + t[1] * q), y0: px(r[2]), y1: px(r[3]) };
    }
    const mir = (x0, x1) => (p.seat === 0 ? [x0, x1] : [512 - x1, 512 - x0]);
    if (p.role === 'in') {
      const [a, b] = mir(Z.infield.xMin, Z.infield.xMax);
      return { x0: px(a), x1: px(b), y0: px(Z.infield.yMin), y1: px(Z.infield.yMax) };
    }
    const g = slotGroup(p.slot);
    const [sx, sy] = this.slotPos(p.seat, p.slot);
    if (g === 3) return { x0: px(sx), x1: px(sx), y0: px(Z.outBack.yMin), y1: px(Z.outBack.yMax) };
    const o = g === 1 ? Z.outTop : Z.outBottom;
    const [a, b] = mir(o.xMin, o.xMax);
    return { x0: px(a), x1: px(b), y0: px(sy), y1: px(sy) };
  }

  /** 슬롯 영역 표(정수 px)에 사다리꼴 보정을 적용한 [x0,x1,y0,y1] [직역 ROM 0x6E00/0x6E1C -> 0x6F26~0x6F3C: x 경계 += ±(y>>2)] */
  romBox(tbl, p) {
    const r = tbl[p.seat][p.slot], t = this.R.zones.rom.trap[p.seat][p.slot], q = Math.floor(p.y / ONE) >> 2;
    return [r[0] + t[0] * q, r[1] + t[1] * q, r[2], r[3]];
  }
  /** 선수 정수 좌표가 영역 안인지(경계 포함) [직역 ROM 0x6D9A] */
  inBox(tbl, p) {
    const a = this.romBox(tbl, p), x = Math.floor(p.x / ONE), y = Math.floor(p.y / ONE);
    return x >= a[0] && x <= a[1] && y >= a[2] && y <= a[3];
  }
  /** 선 이탈 판정 [직역 ROM 0x88EA -> 0x6D90, 표 0x6B74/0x6BDC] */
  outOfLine(p) { const Z = this.R.zones.rom; return !!(Z?.foul && this.R.foul && this.data.rom) && !this.inBox(Z.foul, p); }

  /** 코트 클램프 [직역 ROM 0x7F8E]: 정수부가 16 미만이면 16.0, 496(y 248) 이상이면 그 값(소수부 0), 그 축 속도 0 */
  clampCourtRom(p) {
    const C = this.R.court, xi = Math.floor(p.x / ONE), yi = Math.floor(p.y / ONE);
    if (xi < C.xMin || xi >= C.xMax) { p.x = px(xi < C.xMin ? C.xMin : C.xMax); p.vx = 0; }
    if (yi < C.yMin || yi >= C.yMax) { p.y = px(yi < C.yMin ? C.yMin : C.yMax); p.vy = 0; }
  }

  /** 피격·쓰러짐 중의 코트 벽 반사 [직역 ROM 0x9DA8, 피격 0x94A6·쓰러짐 0x94FA 가 이동 뒤에 부른다]: x 정수부가 16 미만/496 이상이면 그 값(소수부 0)으로 놓고 vx = (-vx) >> 2, y 정수부가 16 미만/248 이상이면 vy = (-vy) >> 1. 공의 벽 반사와 같은 규칙 */
  bounceCourtRom(p) {
    const C = this.R.court, xi = Math.floor(p.x / ONE), yi = Math.floor(p.y / ONE);
    if (xi < C.xMin || xi >= C.xMax) { p.x = px(xi < C.xMin ? C.xMin : C.xMax); p.vx = (-p.vx) >> 2; }
    if (yi < C.yMin || yi >= C.yMax) { p.y = px(yi < C.yMin ? C.yMin : C.yMax); p.vy = (-p.vy) >> 1; }
  }

  /** 속도로 보는 방향 갱신 [직역 ROM 0x7868]: vx!=0 이면 좌우(bit0), vy!=0 이면 앞뒤(bit1), vy=0 이고 vx!=0 이면 앞 보기 */
  faceByVel(p, vx, vy) {
    if (vx !== 0) p.face = vx < 0 ? -1 : 1;
    if (vy !== 0) p.back = vy < 0; else if (vx !== 0) p.back = false;
  }

  /** 선 이탈 진입(타입 0x48) [직역 ROM 0x714C/0x764A/0x840A/0x7576/0x954E]: 높이·수직 속도 0, 수평 속도 값은 그대로 남는다(이동은 멈춤) */
  enterFoul(p, tm) {
    p.z = 0; p.vz = 0; p.st = ST.FOUL; p.fs = 0; p.fsNew = false; p.charging = false; p.chargeNew = false; p.wind = null; p.slideV = 0; p.plan = null;
    if (tm !== undefined) p.tm = tm;
    this.emit('foul', { p: p.pid });
  }

  /** 선 이탈 상태 1프레임 [직역 ROM 0x974C]. fs: 0 진입 직후, 1 정지 30f(서브0), 2 공 놓고 20f(서브4), 3 슬롯 기본 위치 쪽으로 복귀(서브8) */
  stepFoul(p) {
    const F = this.R.foul, b = this.ball;
    if (p.fs === 0) { p.fs = 1; p.dashFlag = false; p.dashDir = 0; p.tm = F.waitFrames; }
    if (p.fs === 1) {
      if (--p.tm !== 0) return;
      p.fs = p.slot < 4 && p.hasBall ? 2 : 3; p.fsNew = true;
      return;
    }
    if (p.fs === 2) {
      if (p.fsNew) { // 0x97B4: 공을 놓는다. 공 = 바운스 공, vx 정수부 = 보는 방향 ±1
        p.fsNew = false; p.tm = F.dropFrames;
        if (p.hasBall && b.mode === BM.HELD && b.holder === p.pid) {
          p.hasBall = false; p.hold = 0;
          b.mode = BM.LOOSE; b.holder = -1; b.vx = (b.vx & 0xffff) + (p.face < 0 ? -ONE : ONE); b.still = 0; b.rom = false; b.steer = 0; b.kind = 0; b.sp = null;
          this.emit('foul_drop', { p: p.pid });
        }
      }
      if (--p.tm !== 0) return;
      p.fs = 3; p.fsNew = true;
      return;
    }
    if (p.fsNew) { // 0x9806 -> 0x9E2A: 슬롯 기본 위치를 향한 속도. 속력(8.8) = s2*16 + 0x140 - (마찰>>7)
      p.fsNew = false;
      const [hx, hy] = this.slotPos(p.seat, p.slot);
      const a = romAngle(hx, hy, Math.floor(p.x / ONE), Math.floor(p.y / ONE));
      const v = romDecomp(this.data.rom.trig, a.i, a.fl, ((p.stat.spd << 4) + F.speedAdd - (this.stage.friction >> 7)) & 0xffff);
      p.vx = v[0]; p.vy = v[1];
    }
    this.faceByVel(p, p.vx, p.vy);
    p.x += p.vx; p.y += p.vy;
    if (this.inBox(this.R.zones.rom.area, p)) { p.vx = 0; p.vy = 0; p.st = ST.IDLE; p.fs = 0; this.emit('foul_end', { p: p.pid }); } // 0x9838: 이동 허용영역 안이면 복귀
  }

  /** 사람이 지금 조작하는 선수(원작 타입 0x10/0x34/0x38). 강제 회수(타입 0x44)·패스 수신 대기(타입 0x30) 중에는 입력을 받지 않는다 */
  isHuman(p) { return this.humans[p.seat] && p.pid === this.sides[p.seat].ctrl && !p.t44 && !p.recv; }

  /** 아웃 직역 여부(rules.out.rom): 아웃된 선수는 외야 슬롯으로 걸어간 뒤 보통 외야 선수(슬롯 타입 0x24/0x28)로 계속 뛴다. p.dead = 원작 $1F(아웃됨: 내야 교체 후보에서 빠진다) */
  get romOut() { return !!(this.R.out.rom && this.data.rom); }
  usable(p) { return p.st !== ST.DEAD && p.st !== ST.GONE && p.st !== ST.OUTMOVE && (!p.dead || this.romOut); }
  targetable(p) { return p.role === 'in' && this.usable(p) && p.st !== ST.HIT && p.st !== ST.DOWN && p.st !== ST.FOUL; }
  /** 투구 공과 충돌 판정을 하는 선수: 외야 선수도 맞거나 잡는다(외야 핸들러 0x917A/0x92FA 도 0x847C 를 부른다. 데미지는 슬롯<4 만, 0x84B8) */
  hittable(p) { return this.usable(p) && p.st !== ST.HIT && p.st !== ST.DOWN && p.st !== ST.FOUL && (p.role === 'in' || !!(this.R.cpu.rom && this.data.rom)); }

  nearestInfield(seat, x, y, pred = (p) => this.usable(p)) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < 7; i++) {
      const p = this.players[seat * 7 + i];
      if (p.role !== 'in' || !pred(p)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p.pid; }
    }
    return best;
  }

  // ================= 틱 =================
  /** @param {[number,number]} inputs 사이드별 입력 비트 */
  tick(inputs) {
    this.f++;
    this.rng.vblank();
    for (let s = 0; s < 2; s++) { const v = inputs[s] | 0; this.sEdge[s] = v & ~this.sPrev[s] & BIT.S; this.sPrev[s] = v; }
    if (this.tr) { this.tickTraining(inputs); return; }
    const wasReady = this.phase === 'ready';
    this.stepStart();
    if (wasReady) return; // 입장~GO 전: 선수 입력 잠금(위치는 stepStart 가 직접 갱신)
    if (this.phase === 'play') {
      if (this.timeHold) { this.stepTimeHold(); return; } // こうしき 시간 종료 동수: TIME UP -> PLAY OFF 배너 동안 선수 정지
      if (!(this.fm && this.fm.st <= FM.HOLD)) this.clock++; // 집합·대기 중 경기 시계 정지(원작)
      this.stepPlayers(inputs, true);
      this.stepBall();
      this.stepHudShake();
      this.stepFormation();
      this.stepTipEnd();
      if (!this.tip.on) this.autoSwitch();
      this.checkTime();
    } else { // end: 연출 진행
      this.stepPlayers([0, 0], false);
      this.stepBall();
      if (this.endPre > 0 && this.f - this.endF === this.endPre) this.beginEndBanner();
    }
  }

  /**
   * 얼굴 아이콘(HUD) 떨림의 난수 소비 [직역 ROM 0xDE44 -> 0xDF7E]: 내야 슬롯 선수의 HP 가 1~19 인 동안 얼굴 오브젝트 카운터($18)가 매 프레임 +1,
   * 30 을 넘으면 난수 1회(좌표 ±1 흔들림), 60 이 되면 0 으로. 화면 효과는 클라이언트 몫이고 여기서는 난수 순서만 맞춘다 [실측 atk_seed3 f241~f270: 피격 30프레임 뒤부터 프레임당 1회 x30].
   * 카운터는 원작에서는 얼굴 오브젝트(슬롯 자리) 것이라 교체로 얼굴이 바뀌면 0 부터다 -> 선수에 붙여 둔 근사 [근사]
   */
  stepHudShake() {
    if (!(this.R.cpu.rom && this.data.rom)) return;
    if (this.official) return; // こうしき 는 얼굴 떨림(난수 소비)이 없다 [판독만 ROM 0xDF7E]
    for (const p of this.players) {
      if (p.slot >= 4 || p.removed || p.st === ST.GONE || p.st === ST.DEAD || !(p.hp > 0 && p.hp < 20)) continue;
      p.hudT = (p.hudT | 0) + 1;
      if (p.hudT <= 30) continue;
      if (p.hudT >= 60) p.hudT = 0;
      this.rng.next();
    }
  }

  // ================= 시작 연출 (08_start_sequence) =================
  setBanner(k) { this.banner = { k, f0: this.f }; }
  setRefAnim(a) { const r = this.ref; if (r.anim !== a) { r.anim = a; r.at = 0; } }

  stepStart() {
    const S = this.R.start, RF = S.ref, A = RF.anim, q = this.sq, r = this.ref;
    q.t++;
    if (this.f === 1) this.emit('enter');
    if (r) r.at++;
    switch (q.s) {
      case SQ.ENTER: {
        let all = true;
        for (const p of this.players) {
          const e = p.en;
          if (!e) continue;
          const dx = e.tx - e.ex, dy = e.ty - e.ey, d = Math.hypot(dx, dy);
          if (d <= e.spd) { // 도착: 목표로 스냅 [확인 0x6FEE]. 방향 = 원작 도착 규칙 [직역 ROM 0x9996: x >= $E2A2(256) 이면 왼쪽, y >= $E2A4(128, 0x35B4) 이면 뒷모습]
            e.ex = e.tx; e.ey = e.ty; p.en = null; p.face = e.tx >= RF.startX ? -1 : 1; p.back = e.ty >= 128;
          } else {
            e.ex += (dx / d) * e.spd; e.ey += (dy / d) * e.spd;
            // 걷는 동안 [직역 ROM 0x9962 -> 0x7868]: vx<0 왼쪽, vy<0 뒷모습, vy>=0 앞모습
            p.face = dx < 0 ? -1 : dx > 0 ? 1 : p.face; if (dy !== 0) p.back = dy < 0; else if (dx !== 0) p.back = false; all = false;
          }
          p.x = px(e.ex); p.y = px(e.ey);
        }
        if (all) { q.s = SQ.HUD; q.t = 0; }
        break;
      }
      case SQ.HUD:
        if (q.t >= S.hud.delay + S.hud.frames + S.hud.refDelay) {
          this.ref = { x: RF.startX, y: RF.startY, anim: A.walk, at: 0, flip: 0, call: 0, final: false };
          for (const p of this.players) p.face = p.seat === 0 ? 1 : -1; // 슬롯 기본형으로 재설정 [확인 f163]
          this.emit('ref_in');
          q.s = SQ.REF_IN; q.t = 0;
        }
        break;
      case SQ.REF_IN:
        r.y += RF.speed;
        if (r.y >= RF.standY - RF.arriveTol) { r.y = RF.standY; this.setRefAnim(A.stand); q.s = SQ.REF_WAIT; q.t = 0; }
        break;
      case SQ.REF_WAIT:
        if (q.t >= RF.waitFrames) { // GO: 입력 잠금 해제·경기 시계 시작
          this.phase = 'play'; this.tip.on = true;
          this.tip.goWait = S.go.waitMin + (this.rng.next() & S.go.waitMask);
          this.setRefAnim(A.hold_ball_go); this.setBanner('go');
          this.emit('start'); this.emit('go');
          q.s = SQ.GO; q.t = 0;
        }
        break;
      case SQ.GO:
        if (q.t >= this.tip.goWait) {
          const T = S.toss, b = this.ball;
          b.mode = BM.LOOSE; b.holder = -1; b.still = 0;
          b.vx = 0; b.vy = px(T.vy); b.vz = px(T.vzBase) + (this.rng.next() & T.vzRandMask) * px(T.vzUnit);
          this.tip.tossed = true;
          this.setRefAnim(A.toss); this.setBanner('fight');
          this.emit('toss', { vz: b.vz / ONE });
          q.s = SQ.TOSS; q.t = 0;
        }
        break;
      case SQ.TOSS:
        if (q.t >= RF.tossFrames) { this.setRefAnim(A.walk); q.s = SQ.BACK; q.t = 0; }
        break;
      case SQ.BACK:
        r.y -= RF.backSpeed;
        if (r.y <= RF.backY) { r.y = RF.homeY; this.setRefAnim(A.stand); q.s = SQ.WATCH; q.t = 0; }
        break;
      case SQ.WATCH:
        if (r.final) break;
        if (r.call > 0) { r.call--; break; }
        r.flip = 0;
        { const bx = toPx(this.ball.x); this.setRefAnim(bx < RF.lookLeftX ? A.look_left : bx > RF.lookRightX ? A.look_right : A.stand); }
        break;
      default: break;
    }
    if (this.ref && this.phase === 'ready' && (q.s === SQ.REF_IN || q.s === SQ.REF_WAIT)) {
      // 심판 등장(f163) 뒤 선수는 슬롯 타입(0x20/0x24/0x28)이 되고, 그 대기 핸들러가 매 프레임 공(심판 손) 쪽을 본다 [판독 ROM 0x8D3E/0x914E -> 0x8E50: 내 x >= 공 x 면 왼쪽, 내 y >= 공 y 면 뒷모습].
      // 점프볼 참가자(타입 0x6C/0x88)의 방향 처리는 판독하지 못해 그대로 둔다 [미확인]
      const bx = Math.floor(this.ball.x / ONE), by = Math.floor(this.ball.y / ONE);
      for (const p of this.players) if (p.idx !== S.tip.slotIdx) { p.face = Math.floor(p.x / ONE) >= bx ? -1 : 1; p.back = Math.floor(p.y / ONE) >= by; }
    }
    if (this.ref && this.ball.mode === BM.DROP) { // 토스 전: 공은 심판 손
      const rr = this.ref, a = rr.anim, g = RF.handDz;
      const walk = a === A.walk;
      const dx = walk ? RF.walkHandDx[Math.floor(rr.at / RF.walkTicksPerFrame) % 4] : 0;
      const dz = walk ? g.walk : a === A.hold_ball_go ? g.hold : a === A.toss ? g.toss : g.stand;
      this.ball.x = px(rr.x + dx); this.ball.y = px(rr.y + RF.ballDy); this.ball.z = px(dz);
    }
  }

  /** 점프볼 종료: 토스된 공이 바닥에 닿으면 일반 규칙으로 [확인 f443] */
  stepTipEnd() {
    if (this.tip.on && this.tip.tossed && this.ball.z <= 0) { this.tip.on = false; this.emit('tip_end', { hit: false }); }
  }

  /** 점프볼 참가자(각 팀 슬롯0 idx) 여부 */
  isJumper(p) { return this.tip.on && p.idx === this.R.start.tip.slotIdx; }

  /** CPU 점프볼 입력 [확인 0xD35A]: 토스 후 공 vz<0.5 이면 매 프레임 31% 점프, 점프 중 최고점(상승속도<0.5)·공과 겹침이면 쳐내기 */
  tipAi(p) {
    const T = this.R.start.tip;
    if (!this.tip.tossed) return 0;
    if (p.st === ST.JUMP) {
      if (p.swing > 0 || p.tipUsed) return 0;
      if (p.vz < px(T.cpuTriggerVz) || this.tipOverlap(p)) { p.tipUsed = true; return BIT.B; }
      return 0;
    }
    if (p.st === ST.IDLE && this.ball.vz < px(T.cpuTriggerVz) && this.rng.int(256) < T.cpuJumpChance256) return BIT.C;
    return 0;
  }

  /** 쳐내기 접촉 판정: 히트박스 idx(기본 15) + padX, z 는 선수 몸 중앙 기준 ±zRange [추정 폭] */
  tipOverlap(p) {
    const T = this.R.start.tip, hb = this.data.court.hitboxes[T.hitboxIdx], b = this.ball;
    const dx = toPx(b.x - p.x), dy = toPx(b.y - p.y);
    if (dx < hb.xoff - T.padX || dx > hb.xoff + hb.w + T.padX) return false;
    if (dy < hb.yoff - this.R.ballBox.hh || dy > hb.yoff + hb.h + this.R.ballBox.hh) return false;
    return Math.abs(toPx(b.z - p.z) - this.R.bodyZ.stand / 2) <= T.zRange;
  }

  /** 점프볼 쳐내기 처리(선수 갱신 후). swing>0 인 동안 공이 내려오는 중(vz<0)이고 접촉하면 성공 [확인 0x7C7E] */
  stepTipSwing(p, edge) {
    const T = this.R.start.tip;
    if (p.st !== ST.JUMP) p.swing = 0;
    else if (this.isJumper(p) && !this.tip.fg[p.seat] && this.tip.tossed && !p.swing && (edge & BIT.B)) { p.swing = T.swingFrames; this.emit('tip_swing', { p: p.pid }); }
    if (p.swing > 0 && this.tip.on && this.ball.vz < 0 && this.tipOverlap(p)) {
      const b = this.ball;
      b.vz = px(T.hitVz); b.vx = -p.face * px(T.hitVx); b.vy = 0; // 쳐낸 팀 자기 진영 쪽 [확인]
      this.tip.on = false;
      this.emit('tip_hit', { p: p.pid, seat: p.seat });
    }
    if (p.swing > 0) p.swing--;
  }

  beginEndBanner() {
    this.setBanner(this.result.reason === 'timeup' ? 'time_up' : 'game_set');
    if (this.ref) { this.ref.final = true; this.ref.call = 0; this.ref.flip = 0; this.setRefAnim(this.R.start.ref.anim.game_set); }
  }

  stepPlayers(inputs, live) {
    for (const s of this.sides) s.bits = inputs[s.seat] | 0;
    for (const p of this.players) {
      let bits = 0;
      if (live) {
        const s = this.sides[p.seat];
        p.aiNoHit = false; p.aiCatchTm = 0;
        p.aiFree = false; // 영역 클램프 생략은 그 프레임에 도는 컴퓨터형 핸들러(수동 내야 서브 8/0x10, 외야 서브 0x10, 강제 회수 0x44 등)의 성질이다. 매 프레임 지우고 ai.js 가 다시 세운다. 사람 타입(0x10/0x34/0x38)의 걷기 핸들러는 언제나 클램프한다(0x7F36) — 종전에는 컴퓨터형일 때 선 값이 사람 조작으로 넘어온 뒤에도 남아 코트 밖으로 걸어 나갔다(정검수 4차 High-2)
        if (p.recv && !this.stepRecv(p)) p.recv = null;
        const human = this.isHuman(p);
        if (human && p.cb) { p.cb.sub = 0; p.cb.fresh = true; p.cb.busy = 0; p.cb.has = false; } // 사람이 조작하던 선수가 컴퓨터형으로 돌아가면 타입 재설정(0x8204)으로 서브 0 부터 다시(대기 타이머 60) [실측 rng_roll_180 f73 p2]
        if (p.recv) { bits = 0; p.aiVel = p.st === ST.IDLE ? [0, 0] : null; }
        else if (this.isJumper(p) && !this.tip.fg[p.seat]) bits = human ? s.bits & (BIT.B | BIT.C) : this.tipAi(p); // 점프볼 참가자: C 점프·B 쳐내기만
        else if (this.tip.on && !this.tip.tossed) bits = 0; // 토스 전 나머지 선수는 제자리
        else bits = human ? s.bits & 127 : aiInput(this, p);
        // 점프볼 점프에서 내려온 컴퓨터 선수는 착지 다음 프레임(타입 0x70 초기화 + plan 0 결정 프레임)에 행동을 시작하지 않는다 [실측 ctrl_stop_in/ball_launch_tap 트레이스 p7: f13 착지, f14 정지, f15 첫 행동]
        if (!human && p.tipJ === 2) bits = 0;
      }
      const edge = bits & ~p.prev;
      if (live && this.fm && p.seat === this.fm.seat && !p.dead && p.st !== ST.GONE) { // 포메이션 중: 서버가 직접 구동(입력 무시)
        if (this.fm.st === FM.END && p.pid === this.fm.thrower) bits = 0; // 엔드 어택 투구자는 일반 물리로 점프
        else { this.fmFreeze(p, bits); continue; }
      }
      // 원작은 프레임 시작 때의 상태(서브) 핸들러가 돈다: 피격 판정은 그 핸들러 기준(stH), 히트박스 번호($4)는 애니 갱신이 판정 뒤라 한 프레임 늦게 바뀐다(hbC = 이번 판정용) [실측 tools/diff 트레이스 hb 필드]
      const s0 = p.st, air0 = p.z > 0 || p.vz !== 0, act0 = p.charging || !!p.wind;
      p.stH = s0; p.chkV = true;
      if (p.tipJ >= 2 && ++p.tipJ > 3) p.tipJ = 0; // 점프볼 점프 착지 다음 프레임(타입 초기화 프레임)까지 피격 판정 없음 [실측 ball_launch 트레이스 f13~f15]
      const keepHb = p.tipJ !== 0;
      this.updatePlayer(p, bits);
      if (p.recv) this.recvCatch(p);
      p.hbC = p.hb;
      // 점프볼 점프(타입 0x88)의 히트박스(9)는 착지 뒤 타입 초기화 프레임까지 그대로 남는다: 애니(= $4)를 바꾸는 것은 그 다음 프레임의 핸들러다 [실측 ball_launch_tap 트레이스 p7 hb: f13·f14 = 9, f15 에 hb9 로 피격]
      if (!keepHb) {
        // 히트박스 번호는 애니 프레임이 정한다: 몸통 클래스(0/1/2)별로 서기 계열 1/4/6, 점프 8/9/10, 웅크림·줍기 3/5/7. 공중 차지·공중 투구 동작 애니는 서기 계열 상자 [확인: 원작 트레이스 전 시나리오의 (클래스, 애니) -> $4 집계]
        const H = this.R.hitboxIdx, C = H.byClass, cls = C ? this.data.rom?.bodyClass?.[p.ot ?? this.sides[p.seat].team]?.[p.oi ?? p.idx] ?? 0 : 0;
        const pick = (k) => (C ? C[k][cls] : H[k] ?? H.stand);
        p.hb = s0 === ST.CROUCH || s0 === ST.PICKUP ? pick('crouch') : (s0 === ST.JUMP || (air0 && s0 !== ST.HIT)) && !(C && act0) ? pick('jump') : pick('stand');
      }
      if (live) this.stepTipSwing(p, edge);
      if (live) { const b = this.ball; if ((b.mode === BM.FLY && b.rom) || (b.mode === BM.PASS && b.romPass)) this.hitOne(p); }
    }
  }

  // ================= 선수 =================
  updatePlayer(p, bits) {
    const R = this.R;
    const edge = bits & ~p.prev;
    p.prev = bits;
    if (p.aiHold) { p.aiHold = false; return; } // 컴퓨터 plan 0 결정 프레임(0xBC42/0xBC8E)은 물리·판정 없이 지나간다(공중에서도 그 프레임은 멈춘다) [실측 atk_seed3 f181]
    if (p.slide) { if (p.vx === 0 && p.vy === 0) p.slide = 0; else bits &= ~15; } // 필살기 캐치 후 미끄럼 중엔 이동 입력 무시
    if (p.st === ST.DEAD || p.st === ST.GONE) return;
    const g = R.gravity;

    if (p.st === ST.OUTMOVE && this.romOut) {
      // 아웃 이동(타입 0x4C) [직역 ROM 0x988A]: 새 슬롯 기본 위치로 빠른 이동(0x9E62: (s2*16+0x300)/256 px/f), 클램프·피격 판정 없음. ±4 안이면(0x6FEE) 끝 -> $1E=0, 슬롯 타입으로(0x98DC~0x98EA)
      const fl = (v) => Math.floor(v / ONE), tx = fl(p.to[0]), ty = fl(p.to[1]);
      const a = romAngle(tx, ty, fl(p.x), fl(p.y));
      const v = romDecomp(this.data.rom.trig, a.i, a.fl, ((p.stat.spd << 4) + 0x300) & 0xffff);
      p.vx = v[0]; p.vy = v[1]; this.faceByVel(p, p.vx, p.vy);
      p.x += p.vx; p.y += p.vy;
      const x = fl(p.x), y = fl(p.y);
      if (x >= tx - 4 && x <= tx + 4 && y >= ty - 4 && y <= ty + 4) { p.vx = 0; p.vy = 0; p.st = ST.IDLE; p.cb = null; p.ob = null; }
      return;
    }
    if (p.st === ST.OUTMOVE) {
      const k = 1 - p.tm / R.out.swapFrames;
      p.x = Math.round(p.from[0] + (p.to[0] - p.from[0]) * k);
      p.y = Math.round(p.from[1] + (p.to[1] - p.from[1]) * k);
      if (--p.tm <= 0) {
        p.x = p.to[0]; p.y = p.to[1];
        p.st = p.dead ? (p.removed ? ST.GONE : ST.DEAD) : ST.IDLE;
      }
      return;
    }
    if (p.st === ST.HIT) {
      if (R.hit.rom) { // [직역 ROM 0x9498] 중력(0x1DEA), 속도로 보는 방향(0x7868), 이동(0x1B26), 코트 벽 반사(0x9DA8). z<0 이면 착지 -> 쓰러짐(0x40)
        p.vz -= g; this.faceByVel(p, p.vx, p.vy); // 날아가는 쪽을 본다 [실측: 원작 트레이스 피격 프레임의 $3 bit0/bit1]
        p.x += p.vx; p.y += p.vy; p.z += p.vz;
        this.bounceCourtRom(p);
        // 착지(0x94BE)는 타입만 0x40 으로 바꾼다. 쓰러짐 타이머 60 은 다음 프레임의 초기화(0x94E6)가 넣는다 -> 착지 프레임의 타이머($18)는 맞기 전 값 그대로 [실측 atk_p4 f218 p3: 19 -> f219 59]
        if (p.z < 0) { p.z = 0; p.vz = 0; p.st = ST.DOWN; p.tm = p.tmLeft ?? p.tm; p.tmNew = p.fl ? p.fl.down : R.hit.downFrames; } // flame R3: 쓰러짐 단축(하한 36)
        return;
      }
      p.x += p.vx; p.y += p.vy; p.z += p.vz; p.vz -= g;
      this.clampInCourt(p);
      if (p.z <= 0 && p.vz < 0) { p.z = 0; p.vz = 0; p.st = ST.DOWN; p.tm = p.fl ? p.fl.down : R.hit.downFrames; }
      return;
    }
    if (p.st === ST.DOWN) {
      if (R.hit.rom) { // [직역 ROM 0x94EC] 축별 마찰 감속(0x8A2A) 먼저, 그다음 이동
        if (p.tmNew) { p.tm = p.tmNew; p.tmNew = 0; } // 0x94E6
        p.vx = approach(p.vx, 0, this.stage.friction); p.vy = approach(p.vy, 0, this.stage.friction);
        p.x += p.vx; p.y += p.vy;
        this.bounceCourtRom(p);
      } else {
        p.x += p.vx; p.y += p.vy;
        p.vx = approach(p.vx, 0, this.stage.friction); p.vy = approach(p.vy, 0, this.stage.friction);
        this.clampInCourt(p);
      }
      if (--p.tm <= 0) {
        // こうしき [직역 ROM 0x9514~0x9562, 확인: 원작 실행 analysis/data/33_koushiki_oracle]: 내야 슬롯(<4)이고 유예 표시($6D)가 꺼졌으면 아웃(HP 를 0 으로, 이때 심판 콜 $C79C), 켜져 있으면(같은 편이 바닥 전에 잡음) 일어난다. HP 는 보지 않는다
        if (this.official) { if (p.slot < 4 && !p.grace) { if (!this.result) { p.hp = 0; this.refOut(p); this.startOut(p); } } else if (R.foul && R.zones.rom?.foul && this.data.rom && !this.inBox(R.zones.rom.area, p)) this.enterFoul(p); else p.st = ST.IDLE; return; }
        if (p.hp <= 0 && !this.tr && !(this.romOut && p.slot >= 4)) { if (!this.result) this.startOut(p); } // 특훈에는 아웃이 없다(HP 0 이어도 일어난다) [판독만 ROM 0x950C, 확인 sp_pass10] // 승패 확정 후엔 아웃 처리(인원 변경) 금지. 외야 슬롯(아웃된 뒤 외야에서 뛰는 선수 포함)은 맞아도 아웃 처리가 없다 [직역 ROM 0x9514]
        else if (R.foul && R.zones.rom?.foul && this.data.rom && !this.inBox(R.zones.rom.area, p)) this.enterFoul(p); // 이동 허용영역 밖에서 일어나면 선 이탈 상태로 걸어 돌아온다 [직역 ROM 0x952A~0x954E]
        else p.st = ST.IDLE;
      }
      return;
    }
    if (p.st === ST.FOUL) { this.stepFoul(p); return; }

    // 캐치 후 밀림(서브 0x20) [직역 ROM 0x74FA]: 남은 속력($68, 8.8)에서 매 프레임 마찰>>8 을 빼고, 공이 날아온 각도($64)로 그 속력만큼 이동. 0 이하면 끝. 그동안 입력 없음
    if (p.slideV > 0) {
      const s = p.slideV - (this.stage.friction >> 8);
      p.prev = bits; if (p.hasBall) p.hold++;
      if (s <= 0) { // [직역 ROM 0x7550~0x7584] 밀림 끝: 속도 0, 선 밖이면 선 이탈, 아니면 보는 방향 좌우·앞뒤 모두 반전(공이 온 쪽을 다시 본다)
        p.slideV = 0; p.vx = 0; p.vy = 0;
        if (this.outOfLine(p)) this.enterFoul(p); else { p.face = -p.face; p.back = !p.back; }
      } else {
        p.slideV = s;
        const v = romDecomp(this.data.rom.trig, p.slideA.i, p.slideA.fl, s);
        p.vx = v[0]; p.vy = v[1];
        this.faceByVel(p, p.vx, p.vy); // 0x753A
        p.slideRun = true; // 0x753E: 이 프레임부터 애니는 0x8870(앞뒤 반대로 고름)
        p.x += p.vx; p.y += p.vy;
        this.clampCourtRom(p); // 0x754C -> 0x7F8E (이동 허용영역 클램프는 없다)
      }
      return;
    }
    const romT = !!(R.throw.rom && this.data.rom);
    let air = p.z > 0 || p.vz !== 0, tookOff = false; // 원작 공중 플래그($3 bit2): 착지 판정은 z<0 (z=0·하강 중인 1프레임도 공중)
    const canAct = p.st === ST.IDLE || p.st === ST.DASH || p.st === ST.BRAKE;
    // 사람 조작 선수 = 원작 사람 타입(0x10/0x34/0x38) 핸들러 직역 경로(rules.move.rom). 그 밖(CPU·비조작)은 ai.js 담당 경로 유지
    const romCtrl = !!R.move.rom && this.isHuman(p);
    const st0 = p.st; // 이번 프레임에 도는 원작 서브 핸들러
    let landed = false;
    if (romCtrl) {
      // 보는 방향 [직역]: 걷기 핸들러(0x7076)는 방향키로 정한 걷기 속도로 0x7868, 점프 핸들러(0x70A6)는 좌·우 키가 눌려 있으면 그쪽(0x78FE)
      if (st0 === ST.IDLE && !air && !p.slide) { const d = this.dirOf(p, bits); this.faceByVel(p, d[0], d[1]); }
      else if (st0 === ST.JUMP && !p.charging && !p.wind && (bits & (BIT.LEFT | BIT.RIGHT))) p.face = bits & BIT.LEFT ? -1 : 1;
    }

    // 타이머 상태 종료
    // 캐치 자세(서브 0x14) 중 매 프레임: 위험 플래그 없는 공(바운스·굴러가는·정지 공)과 히트박스 11 이 겹치면 그대로 획득 [확인 ROM 0x7350~0x73AC, 실측 analysis/21 §2]
    if (p.st === ST.CATCH && this.ball.mode === BM.LOOSE && !this.tip.on && !this.result && this.grabTouch(p)) {
      if (!(p.z > 0 || p.vz !== 0)) { p.vx = 0; p.vy = 0; } // 지상 캐치 자세는 속도 0 (0x732C)
      this.giveBall(p); this.emit('receive', { p: p.pid }); this.acquireSwitch(p);
    }
    if (p.tmNew) { if (p.st === ST.CROUCH || p.st === ST.PICKUP) p.tm = p.tmNew; p.tmNew = 0; } // 웅크림·줍기 타이머는 진입 다음 프레임에 설정 [확인 0x74A0/0x74CC]
    if (!p.wind && (p.st === ST.THROW || p.st === ST.PASS || p.st === ST.CROUCH || p.st === ST.CATCH || p.st === ST.PICKUP)) {
      if (--p.tm <= 0) {
        if (p.st === ST.PICKUP) this.tryGrab(p, true);
        if (p.st !== ST.JUMP) p.st = air ? ST.JUMP : ST.IDLE; // 공중 캐치 자세가 끝나면 점프 상태로 [확인 0x8398]
      }
    }

    // 조준 그룹 갱신(공 보유 중 방향키 새로 누를 때) [확인 구조 0x8088]
    if (p.hasBall) {
      const side = this.sides[p.seat];
      const fwd = p.seat === 0 ? BIT.RIGHT : BIT.LEFT;
      if (R.throw.rom && R.throw.rom.aim && this.data.rom) {
        // [직역 ROM 0x8152, 표 0x81A4(좌석0)/0x8184(좌석1)] 내야 보유자: 방향키가 눌려 있으면(매 프레임, 새로 누름이 아님) 그 조합으로 조준 구역($E21C)을 정하고, 없으면 직전 값 유지.
        // 위·위+뒤 = 상대 상단 외야(4), 아래·아래+뒤 = 하단 외야(7), 뒤(좌석0 왼쪽/좌석1 오른쪽) = 후방 외야(10), 앞·앞+위·앞+아래 = 0(상대 활성 선수), 무효 조합(위+아래 등) = 0
        const d = bits & 15;
        if (d && p.slot < 4) {
          const u = d & BIT.UP, dn = d & BIT.DOWN, f = d & fwd, bk = d & (fwd === BIT.RIGHT ? BIT.LEFT : BIT.RIGHT);
          side.aim = (u && dn) || (f && bk) ? 0 : f ? 0 : u ? 1 : dn ? 2 : 3;
        }
      }
      else if (edge & BIT.UP) side.aim = 1;
      else if (edge & BIT.DOWN) side.aim = 2;
      else if (edge & fwd) side.aim = 0;
      else if (edge & (BIT.LEFT | BIT.RIGHT)) side.aim = 3;
    }

    // 행동
    const act = canAct || p.st === ST.JUMP || p.st === ST.CHARGE;
    if (act) {
      if (p.hasBall && p.wind) { /* 투구·패스 선딜(서브 0x0C/0x10) 중에는 입력을 받지 않는다 */ }
      else if (p.hasBall && romT) {
        // [직역 ROM 0x76A0~0x7778] 지상 B = 곧바로 투구 동작(차지 없음), 공중 B = 차지(서브 0x24), A = 패스 동작
        if (!p.charging && (edge & BIT.B) && (canAct || p.st === ST.JUMP)) {
          p.steer = 0;
          if (this.trPassBack(p)) { p.passTo = this.data.training.infieldIdx; this.beginWind(p, 'pass', 0, bits); } // 필살 슛 특훈: 선수 0 이 아니면 B 도 선수 0 에게 패스 [판독만 ROM 0x76EA]
          else if (air) { p.charging = true; p.charge = 0; p.chargeNew = !p.aiChg1; p.aiChg1 = false; p.windLeft = this.aimLeft(p); } // aiChg1 = 컴퓨터 plan 초기화에서 들어온 차지: 같은 프레임에 1 을 센다
          else this.beginWind(p, 'throw', 0, bits);
        } else if (!p.charging && (edge & BIT.A) && (canAct || p.st === ST.JUMP)) {
          if (this.trPassBack(p)) p.passTo = this.data.training.infieldIdx;
          this.beginWind(p, this.trThrowA(p) ? 'throw' : 'pass', 0, bits); // 특훈의 내 쪽은 A 도 상대 조준 투구(패스 없음). 필살 슛 특훈에서 선수 0 이 아니면 선수 0 에게 패스 [판독만 ROM 0x76CC~0x7702]
        }
      } else if (p.hasBall) {
        if (!p.charging && (edge & BIT.B) && (canAct || p.st === ST.JUMP)) {
          p.charging = true; p.charge = 0; p.dashFlag = p.dashFlag || p.st === ST.DASH;
          if (!air) p.st = ST.CHARGE;
        } else if (!p.charging && (edge & BIT.A) && (canAct || p.st === ST.JUMP)) {
          this.doPass(p, bits);
        }
      } else if ((canAct || (p.st === ST.JUMP && !this.isJumper(p))) && (edge & (BIT.A | BIT.B))) {
        // [확인 ROM 0x7782~0x780C, 실측 analysis/21 §2] 지상: 공이 정지($C71E=1)해 있으면 A·B 모두 줍기(서브 0x1C, 15f),
        // 아니면 B=캐치 자세(서브 0x14, s5 f)·A=웅크림(서브 0x18, 30f). 공중: B 캐치 자세만. 지상에서는 그 자리에 선다(0x7324, 0x74C0 은 이동 적분 없음)
        const b = this.ball;
        // 정지 플래그($C71E)는 공이 멈춘 다음 프레임(서브4 초기화, 0xA622)에 선다 = still>=2. 멈춘 직후 1프레임은 아직 '정지 공'이 아니다 [실측 tools/diff ctrl_stop_out_top f1~f2]
        const stopped = b.mode === BM.LOOSE && b.z === 0 && b.vx === 0 && b.vy === 0 && b.vz === 0 && (!R.ballPhys.rom || this.tip.on || b.still >= 2);
        if (!air && stopped) { p.st = ST.PICKUP; p.tm = edge & BIT.B ? p.stat.s5 : p.tm; p.tmNew = R.pickupFrames; this.emit('pickup', { p: p.pid }); } // B 경로는 캐치 타이머(s5)를 넣은 뒤 줍기로 바뀐다(0x77D4), A 경로는 타이머를 건드리지 않는다(0x7806)
        else if (edge & BIT.B) { p.st = ST.CATCH; p.tm = p.aiCatchTm || p.stat.s5; this.emit('catch_start', { p: p.pid }); } // aiCatchTm = 수동 내야의 패스 가로채기 자세(0x90A6)는 타이머를 새로 넣지 않고 남아 있던 $18 을 쓴다
        else if (!air) { p.st = ST.CROUCH; p.tm = 0; p.tmNew = R.crouchFrames; this.emit('crouch', { p: p.pid }); }
        if (!air && p.st !== ST.IDLE && p.st !== ST.DASH && p.st !== ST.BRAKE) { p.vx = 0; p.vy = 0; p.dashFlag = false; }
      }
      if ((edge & BIT.C) && canAct && !air && !p.charging && !p.wind) {
        if (romCtrl && p.st !== ST.IDLE && !p.slide) { // 대시·제동 중 점프: 그 프레임의 가속·감속(0x7FEA/0x8A4C)이 먼저 적용된다
          this.moveHuman(p, bits, edge, 0, 0);
        }
        if (romCtrl) {
          // [확인 ROM 0x770C, 실측 analysis/21 §1] 이륙: 대시 플래그(bit3 = 대시 속도 3.0 도달)면 +1.0, 수평 속도는 1/4(asr 2)로 줄고 공중 조작 없음.
          // 걷는 중 점프는 그 프레임의 걷기 속도(0x7E88 이 먼저 실행)의 1/4
          if (p.st === ST.IDLE && !p.slide) { const w = this.walkSpeed(p), d = this.dirOf(p, bits); p.vx = d[0] * w; p.vy = d[1] * w; }
          p.vx >>= 2; p.vy >>= 2;
        } else if (!(R.cpu.rom && this.data.rom)) p.dashFlag = p.st === ST.DASH; // 직역 컴퓨터(ai.js)는 대시 플래그($3 bit3)를 두뇌가 관리하고, 수평 속도 1/4(0x7720)은 aiKeepV 로 넣는다
        p.vz = R.jump.base + (p.stat.s3 << R.jump.s3Shift) + (p.dashFlag ? R.jump.dashBonus : 0);
        p.st = ST.JUMP; air = true; tookOff = true; // 이륙 프레임부터 z 적분(원작 서브0 핸들러가 같은 프레임에 0x1B26 실행: z[0]=vz0) [실측]
        if (this.isJumper(p) && !this.tip.fg[p.seat]) {
          p.tipJ = 1; // 점프볼 점프(원작 타입 0x88): 착지할 때까지 피격 판정을 하지 않는다
          if (!this.tip.tossed) this.tip.fg[p.seat] = true; // 토스 전 점프 = 점프볼 포기 [확인 f360]
          else p.vx = p.face * px(R.start.tip.driftVx); // 점프볼 점프는 상대 쪽으로 0.25px/f
        }
        this.emit('jump', { p: p.pid });
        if (p.aiJ0) { p.aiJ0 = false; tookOff = false; } // 컴퓨터 plan 0x1C: 점프한 프레임에 공중 핸들러가 이어서 돈다(중력·적분 있음)
      }
    }

    // 차지 진행
    // 궤적 보정 입력(1회 래치) [직역 ROM 0x8AB8]: 사람 사이드, 공중 + 대시 플래그일 때만, 차지·투구 동작 중 방향키를 새로 누르면 기록
    if (romT && (p.charging || p.wind) && !p.steer && air && p.dashFlag && this.humans[p.seat] && (edge & 15)) {
      let c = edge & 15;
      const fwd = c & BIT.LEFT ? !!p.windLeft : c & BIT.RIGHT ? !p.windLeft : null;
      if (fwd !== null) c = fwd ? (c & ~4) | 8 : (c | 4) & ~8;
      p.steer = c;
    }
    if (p.charging && romT) {
      // [직역 ROM 0x75CC] 공중 차지: 누른 다음 프레임부터 매 프레임 +1(받아치기 창이 열려 있으면 증가 없음), 15 를 넘거나 B 를 떼면 투구 동작으로
      if (p.chargeNew) p.chargeNew = false;
      else {
        if (!(this.ball.ctr > 0)) p.charge++;
        if (p.charge > R.throw.maxCharge || !(bits & BIT.B)) this.beginWind(p, 'throw', p.charge, bits);
      }
    } else if (p.charging) {
      if (bits & BIT.B) {
        p.charge++;
        if (p.charge >= R.throw.maxCharge + 1) this.doThrow(p, R.throw.maxCharge, true); // 16f 자동발사는 필살기 윈도 밖 [확인]
      } else this.doThrow(p, Math.min(p.charge, R.throw.maxCharge));
    }

    // 보유 시간 초과 강제 투구 [확인 0x76A4]
    if (p.hasBall) {
      if (++p.hold > R.holdMaxFrames && !p.charging && !p.wind && (p.st === ST.IDLE || p.st === ST.DASH || p.st === ST.BRAKE || p.st === ST.JUMP)) {
        if (romT && this.trPassBack(p)) { p.passTo = this.data.training.infieldIdx; this.beginWind(p, 'pass', 0, bits); } // 0x76AA -> 0x76CC 같은 분기
        else if (romT) this.beginWind(p, 'throw', 0, bits); else this.doThrow(p, 0);
      }
    } else p.hold = 0;

    // 이동
    const moveOk = !p.charging || air;
    if (p.st === ST.IDLE || p.st === ST.DASH || p.st === ST.BRAKE) {
      let dx = ((bits & BIT.RIGHT) ? 1 : 0) - ((bits & BIT.LEFT) ? 1 : 0);
      let dy = ((bits & BIT.DOWN) ? 1 : 0) - ((bits & BIT.UP) ? 1 : 0);
      // 외야 한 축 이동은 사람 조작 외야(타입 0x34/0x38, 0x82A4/0x82D6)만. 컴퓨터 외야(타입 0x74)는 허용영역 안에서 두 축으로 움직여 공을 주우러 간다
      // [실측 analysis/21 §2-4: 정지 공 (90,222) -> 하단 외야가 (160.7,238.6)에서 (103.8,225.7)로 이동 후 줍기]. rules.move.rom 이 없으면 종전대로 전원 한 축
      if (p.role === 'out' && (!R.move.rom || this.isHuman(p))) { if (slotGroup(p.slot) === 3) dx = 0; else dy = 0; }
      // 더블탭 대시 [확인 0x780E, 16f]
      const dirEdge = edge & 15;
      const humanCtrl = this.isHuman(p);
      if (romCtrl) this.moveHuman(p, bits, edge, dx, dy);
      else {
      if (dirEdge && !p.charging && humanCtrl) { // 더블탭은 사람 조작 선수만
        if (p.tapDir === dirEdge && this.f - p.tapF <= R.move.doubleTapFrames && p.st !== ST.DASH && (dx || dy)) {
          p.st = ST.DASH; p.tapDir = 0; this.emit('dash', { p: p.pid });
        } else { p.tapDir = dirEdge; p.tapF = this.f; }
      }
      // 컴퓨터 대시: 레벨 플래그(cpu.levels.N.dash)가 켜진 사이드의 AI 가 ai.js 에서 요청(p.aiDash). 사람 입력 경로와 무관
      const cpuTune = !humanCtrl ? this.aiTune[p.seat] : null;
      if (cpuTune?.dash && p.aiDash && !p.charging && p.st !== ST.DASH && (dx || dy)) { p.st = ST.DASH; this.emit('dash', { p: p.pid }); }
      p.aiDash = false;
      const spd = p.stat.spd;
      const fr = this.stage.friction;
      if (p.aiVel && !p.charging) { // 컴퓨터 직역 경로(ai.js outfieldRom 등): 원작처럼 속도를 직접 설정(가속 없음)
        p.vx = p.aiVel[0]; p.vy = p.aiVel[1]; p.aiVel = null;
        if (p.aiRun) { p.st = ST.DASH; p.aiRun = false; } // 컴퓨터 대시 주행(공격 plan 서브8, 0x7FEA): 대시 애니·발소리
        else if (p.st !== ST.IDLE) p.st = ST.IDLE;
      } else if (p.charging) {
        p.vx = approach(p.vx, 0, fr); p.vy = approach(p.vy, 0, fr);
      } else if (dx || dy) {
        const dash = p.st === ST.DASH;
        // 컴퓨터 원속도(ROM 0x9E2A/0x9E62): 걷기 = (s2*16+0x140)/256 px/f, 빠른 이동 = (s2*16+0x300)/256 px/f 로 속도를 즉시 설정 [확인 analysis/18]
        const os = cpuTune?.origSpeed ? R.cpu.origSpeed : null;
        const top = dash
          ? (cpuTune?.dash ? Math.min(os ? (spd << R.move.baseShift) + px(os.fastAdd) : px(cpuTune.dashMaxPx ?? 3), px(R.cpu.dashCapPx ?? 3.5)) : R.move.dashMax)
          : os ? (spd << R.move.baseShift) + px(os.walkAdd) : spd << R.move.baseShift;
        const a = os ? top : spd << (dash ? R.move.accelShiftDash : R.move.accelShiftWalk);
        const m = dx && dy ? R.move.diagMul : ONE;
        const tx = Math.trunc((dx * top * m) / ONE), ty = Math.trunc((dy * top * m) / ONE);
        p.vx = approach(p.vx, tx, a); p.vy = approach(p.vy, ty, a);
        if (p.st === ST.BRAKE) p.st = ST.IDLE;
      } else {
        if (p.st === ST.DASH) p.st = ST.BRAKE;
        p.vx = approach(p.vx, 0, fr); p.vy = approach(p.vy, 0, fr);
        if (p.st === ST.BRAKE && p.vx === 0 && p.vy === 0) p.st = ST.IDLE;
      }
      }
      void moveOk;
    } else if (p.st === ST.CATCH || p.st === ST.CROUCH || p.st === ST.PICKUP) {
      // 컴퓨터 활성 선수의 줍기·웅크림(0xC906/0xD188/0xC94E)은 속도를 지우지 않는다(이동 적분만 없다): 값만 남긴다 [실측 out_fetch_top f48]
      if (!air && !p.slide && p.cb?.act === true && !this.isHuman(p) && (p.st === ST.PICKUP || p.st === ST.CROUCH) && (p.vx || p.vy)) p.aiKeepV = [p.vx, p.vy];
      if (!air && !p.slide) { p.vx = 0; p.vy = 0; } // 지상 캐치·웅크림·줍기는 제자리 [확인 0x7324/0x7494/0x74C0], 공중 캐치는 속도 유지
    } else if (p.st === ST.THROW || p.st === ST.PASS || p.st === ST.CHARGE) {
      if (p.wind && romT) { p.vx = 0; p.vy = 0; } // 지상 투구·패스 동작 초기화(0x7166/0xC7D2)가 속도를 지운다. 컴퓨터는 동작을 시작한 프레임에 걷기·대시 속도 값이 남아 있다 [실측 atk_p4 f119]
      else { p.vx = approach(p.vx, 0, this.stage.friction); p.vy = approach(p.vy, 0, this.stage.friction); }
    }

    // 적분
    p.x += p.vx; p.y += p.vy;
    if (air) {
      // [직역 ROM 0x7F28 -> 0x1B26] 이륙 프레임은 중력 없이 z += vz, 그 뒤 매 프레임 vz -= g 후 z += vz. z<0 이면 착지
      if (!tookOff) p.vz -= g;
      if (!(tookOff && !romCtrl && R.cpu.rom && this.data.rom)) p.z += p.vz; // 컴퓨터의 점프 진입(0x770C)은 plan 대기 핸들러 끝에서 일어나 그 프레임에는 높이 적분이 없다 [실측 cpu_def_c f101]
      if (p.z < 0) {
        p.z = 0; p.vz = 0; p.dashFlag = false;
        if (p.tipJ === 1) p.tipJ = 2;
        if (p.cb && p.cb.sub === 4) p.cb.sub = 0; // 착지(0x83DA): 컴퓨터형 두뇌의 서브도 0 으로
        if (romCtrl || (R.cpu.rom && this.data.rom)) { p.vx = 0; p.vy = 0; } // 착지 시 수평 속도 0 [확인 ROM 0x83E0]. 컴퓨터형도 같은 착지 루틴(0x8D92/0xC7A0 -> 0x83DA) [실측 rng_stop_45 p7 f13]
        landed = !(romT && p.charging); // 0x83DA/0x83E0 경로(점프·공중 캐치·공중 투구 동작 착지)는 선 이탈 검사(0x8402)로 이어진다
        if (romT && p.charging) this.beginWind(p, 'throw', p.charge, bits); // 차지 중 착지 = 그대로 투구 동작 [확인 0x75F0]
        else if (p.wind) p.st = ST.THROW; // 공중 투구 동작 중 착지: 동작 계속 [확인 0x71B2 -> 0x83E0]
        else p.st = p.charging ? ST.CHARGE : ST.IDLE; // 착지: 공중 캐치 자세도 끝난다 [확인 0x734C -> 0x83DA]
      }
    }
    if (romCtrl && R.foul && R.zones.rom?.foul && this.data.rom && st0 !== ST.IDLE) {
      // [직역] 이동 허용영역 클램프(0x7F36)는 걷기 핸들러에만 있다. 대시(0x70E2)는 클램프 없이 선 이탈 검사만, 제동(0x760A)·공중·캐치 자세 등은 코트 클램프(0x7F8E) 뒤 선 이탈 검사(제동은 매 프레임, 공중은 착지 때)
      if (st0 === ST.DASH) {
        if (p.st !== ST.BRAKE) {
          if (this.outOfLine(p)) this.enterFoul(p, p.dashT);
          else if (p.vx === 0) p.chkV = false; // 0x712A: 속도 0 이면 피격 판정·발소리 없이 제동으로
          else if (p.hasBall && --p.dashT <= 0) { p.dashT = R.runSfx?.period ?? 6; this.emit('run', { p: p.pid, alt: R.runSfx?.altRomStages?.includes(this.stageInfo.romStage) ? 1 : 0 }); } // 공 들고 달리는 발소리 [직역 ROM 0x8BBA: 6프레임마다]
        }
      } else {
        this.clampCourtRom(p);
        if ((st0 === ST.BRAKE || landed) && this.outOfLine(p)) this.enterFoul(p);
      }
    } else {
      const b = this.bounds(p);
      // 컴퓨터형 선수의 공중 핸들러(0xC75A/0xCADE/0xCB30/0xCC5E/0xBF5E/0xCA0C/0xC7AC)는 코트 클램프(0x7F8E)만 하고 이동 허용영역 클램프가 없다. 착지(0x83DA/0x83E0)는 선 이탈 검사(0x8402)로 이어진다 [실측 atk_seed3 f193: 공중에서 영역 경계를 넘는다]
      if (R.cpu.rom && this.data.rom && (air || landed) && !p.tipJ && !tookOff) {
        this.clampCourtRom(p);
        if (landed && this.outOfLine(p)) this.enterFoul(p, p.charge); // 진입 프레임의 타이머($18)는 직전 값이 남는다(공중 투구 뒤라면 차지 카운터) [실측 atk_seed3 f210]
      } else if (!p.aiFree) { // 외야 자리 이동(서브 0x10, 0x91EE)은 영역 클램프가 없다
        if (p.x < b.x0) { p.x = b.x0; p.vx = Math.max(p.vx, 0); } else if (p.x > b.x1) { p.x = b.x1; p.vx = Math.min(p.vx, 0); }
        if (p.y < b.y0) { p.y = b.y0; p.vy = Math.max(p.vy, 0); } else if (p.y > b.y1) { p.y = b.y1; p.vy = Math.min(p.vy, 0); }
      }
      // 컴퓨터(ai.js 경로) 대시도 공을 들고 달리면 같은 주기로 발소리(원작은 CPU 활성 선수도 같은 대시 핸들러 0x70E2)
      if (!romCtrl && p.st === ST.DASH && p.hasBall && (p.vx || p.vy) && R.runSfx) {
        if (!(p.dashT > 0)) p.dashT = R.runSfx.period;
        if (--p.dashT <= 0) { p.dashT = R.runSfx.period; this.emit('run', { p: p.pid, alt: R.runSfx.altRomStages?.includes(this.stageInfo.romStage) ? 1 : 0 }); }
      }
    }
    if (p.aiKeepV) { p.vx = p.aiKeepV[0]; p.vy = p.aiKeepV[1]; p.aiKeepV = null; } // 컴퓨터가 이동한 프레임에 자세로 들어가면 속도 값은 그 프레임에 남는다(다음 프레임 자세 초기화가 지운다)
    if (p.st === ST.FOUL) return;
    // 투구·패스 동작(서브 0x0C/0x10): 애니 4프레임x속도2 가 끝나는 10번째 프레임에 공이 손을 떠나고 곧바로 조작 가능 [직역 ROM 0x7194~0x7224, 0x1A3A. 실측 analysis/21 §4]
    if (p.wind) {
      p.wind.age = (p.wind.age ?? -1) + 1; // 0 = 동작을 시작한 프레임(애니는 아직 이전 것)
      if (p.wind.faceAt === p.wind.age) { // [직역 ROM 0x78A0: 내 x >= 대상 x 면 왼쪽, 내 y >= 대상 y 면 뒤]
        const t = p.wind.kind === 'pass' ? (p.passTo != null ? this.players[p.passTo] : null) : this.pickTarget(p, this.sides[p.seat].aim); // 패스 동작(0x724E)은 패스 대상($E214) 쪽을 본다. 사람 패스 대상은 발사 때 정해져 여기서는 방향을 바꾸지 않는다(종전대로)
        if (t) { p.face = Math.floor(p.x / ONE) >= Math.floor(t.x / ONE) ? -1 : 1; p.back = Math.floor(p.y / ONE) >= Math.floor(t.y / ONE); }
      }
      if (p.wind.fresh) p.wind.fresh = false;
      else if (++p.wind.n >= R.throw.rom.windFrames) {
        const w = p.wind; p.wind = null;
        if (p.hasBall) { p.windRel = w.age > 0; if (w.kind === 'pass') this.doPass(p, w.bits); else this.doThrow(p, w.charge, w.charge > R.throw.maxCharge); p.windRel = false; }
        if (p.st === ST.THROW || p.st === ST.PASS || p.st === ST.JUMP) p.st = p.z > 0 || p.vz !== 0 ? ST.JUMP : ST.IDLE;
        p.dashFlag = false;
      }
    }
  }

  /** 조준 대상이 선수 왼쪽인지(원작 투구 시작 시 방향 비트0, 0x78A0: 선수 x >= 대상 x) */
  aimLeft(p) {
    const t = this.pickTarget(p, this.sides[p.seat].aim);
    return t ? Math.floor(p.x / ONE) >= Math.floor(t.x / ONE) : p.face < 0;
  }

  /** 투구·패스 동작 시작(서브 0x0C/0x10). 지상이면 그 자리에 선다(0x718C). 발사는 windFrames 프레임 뒤 */
  beginWind(p, kind, charge, bits) {
    p.charging = false; p.chargeNew = false;
    p.wind = { kind, charge, bits, n: 0, fresh: true, tgt: kind === 'throw' ? this.pickTarget(p, this.sides[p.seat].aim)?.pid ?? -1 : -1 }; // tgt = 투구 동작을 시작할 때의 대상(상대 컴퓨터가 방어 태세로 멈추는 기준)
    p.windLeft = this.aimLeft(p);
    if (kind === 'throw' && this.R.move.rom && this.isHuman(p)) p.wind.faceAt = 1; // 투구 시작: 대상 기준으로 좌우·앞뒤를 정한다(0x716E -> 0x78A0). 서브 0x0C 초기화는 B 를 누른 다음 프레임에 돈다 [실측 cpu_def_a: f41 B, 방향 비트는 f42 에 바뀜]
    if (!this.isHuman(p)) p.dashFlag = p.dashFlag || p.st === ST.DASH; // CPU 경로는 종전 대시 보너스 조건 유지
    if (!(p.z > 0 || p.vz !== 0)) { p.st = kind === 'pass' ? ST.PASS : ST.THROW; p.tm = 0; p.vx = 0; p.vy = 0; }
  }

  /** 사람 조작 걷기 속도(16.16): 1.0 + (s2<<12) - 2*마찰($E22C) [확인 ROM 0x8272. 실측 s2=16·마찰 0x2000 -> 1.75 px/f] */
  walkSpeed(p) { const w = ONE + (p.stat.spd << 12) - 2 * this.stage.friction; return p.fl ? flWalk(this.fls[p.seat], w, this.R.move.dashMax) : w; } // flame: 걷기도 대시 상한(3.0)으로 자른다(D14)

  /** 방향 입력 -> [dx,dy] (-1/0/1). 외야는 한 축만(상·하 띠=좌우, 후방=상하) [확인 0x82A4/0x82D6] */
  dirOf(p, bits) {
    let dx = ((bits & BIT.RIGHT) ? 1 : 0) - ((bits & BIT.LEFT) ? 1 : 0);
    let dy = ((bits & BIT.DOWN) ? 1 : 0) - ((bits & BIT.UP) ? 1 : 0);
    if (p.role === 'out') { if (slotGroup(p.slot) === 3) dx = 0; else dy = 0; }
    return [dx, dy];
  }

  /**
   * 사람 조작 선수 이동 = 원작 서브 0x00(걷기)/0x08(대시)/0x28(제동) 직역 [확인 ROM 0x7076, 0x70E2, 0x760A. 실측 analysis/scripts/feel_move.py]
   * - 걷기(0x7E88): 속도를 매 프레임 직접 설정(가속·감속 없음, 대각선도 축마다 최고속), 키를 떼면 그 프레임에 0
   * - 대시(0x780E): 내야 선수, 좌·우 같은 방향을 15프레임 안에 다시 누르면 진입. 진입 다음 프레임에 속도 0 에서 (대시기본+(s2<<7))/f 가속, 상한 3.0.
   *   방향키를 떼도 계속 달리고, 대시 방향이 아닌 방향키만 눌려 있으면 제동(0x8032). 3.0 도달 시 대시 플래그(점프 +1.0·투구 보너스)
   * - 제동(0x8A4C): 마찰*1.5/f 로 감속, x 속도 0 이면 걷기로. 제동 진입 프레임은 위치 적분 없음(0x713E)
   */
  moveHuman(p, bits, edge, dx, dy) {
    const M = this.R.move, fr = this.stage.friction;
    if (p.slide || p.charging) { p.vx = approach(p.vx, 0, fr); p.vy = approach(p.vy, 0, fr); if (p.st !== ST.IDLE) p.st = ST.IDLE; return; }
    if (p.st === ST.IDLE) {
      let dash = 0;
      if (p.role === 'in') {
        if (edge & BIT.RIGHT) { if (this.f - p.tapR <= M.rom.tapFrames) dash = 1; else { p.tapR = this.f; p.tapL = -999; } }
        else if (edge & BIT.LEFT) { if (this.f - p.tapL <= M.rom.tapFrames) dash = -1; else { p.tapL = this.f; p.tapR = -999; } }
      }
      const w = this.walkSpeed(p);
      p.vx = dx * w; p.vy = dy * w;
      if (dash) { p.st = ST.DASH; p.dashDir = dash; p.dashNew = true; this.emit('dash', { p: p.pid }); }
      return;
    }
    if (p.st === ST.DASH) {
      if (p.dashNew || !p.dashDir) { p.dashNew = false; p.dashDir = p.dashDir || (p.vx < 0 ? -1 : 1); p.vx = 0; p.vy = 0; p.dashFlag = false; p.dashT = this.R.runSfx?.period ?? 6; } // 0x70E2 초기화: 속도 0, $18=6
      const d = bits & 15;
      if (d && !(d & (p.dashDir > 0 ? BIT.RIGHT : BIT.LEFT))) { p.st = ST.BRAKE; p.dashFlag = false; p.x -= p.vx; p.y -= p.vy; return; }
      const a = M.rom.dashAccBase[this.stageInfo.romStage] + (p.stat.spd << 7);
      p.vx = p.dashDir > 0 ? Math.min(p.vx + a, M.dashMax) : Math.max(p.vx - a, -M.dashMax);
      if (Math.abs(p.vx) >= M.dashMax) p.dashFlag = true;
      return;
    }
    const dec = fr + (fr >> 1); // BRAKE
    p.vx = approach(p.vx, 0, dec); p.vy = approach(p.vy, 0, dec);
    if (p.vx === 0) { p.st = ST.IDLE; p.dashDir = 0; }
  }

  clampInCourt(p) {
    const C = this.R.court;
    p.x = Math.min(Math.max(p.x, px(C.xMin)), px(C.xMax));
    p.y = Math.min(Math.max(p.y, px(C.yMin)), px(C.yMax));
  }

  // ---- 투구/패스 ----
  pickTarget(p, group) {
    const opp = 1 - p.seat;
    if (this.tr) return this.players[opp * 7 + this.data.training.infieldIdx]; // 특훈: 투구 대상은 언제나 상대 내야 선수 0 [확인 0xBD30(컴퓨터) / 판독만 0x76CC(사람)]
    if (this.R.throw.rom && this.R.throw.rom.aim && this.data.rom && !this.fm) {
      // 투구 대상($E21E) [직역 ROM 0x81EA]: 외야 보유자 또는 조준 구역 0 -> 상대 사이드의 활성 선수(0x81DC, 상태와 무관). 조준 구역 4/7/10 -> 그 구역 외야 3명 중 보유자와 가장 가까운 선수(0x81C4 -> 0x8752), 없으면 대상 없음.
      // 컴퓨터도 대상은 상대 활성 선수다(0xD8C8)
      if (p.slot >= 4 || group === 0) return this.players[this.sides[opp].ctrl] ?? null;
      return this.romNearest(opp, [0, 4, 7, 10][group], 3, p);
    }
    const cand = (g) => this.players.filter((q) => q.seat === opp && this.usable(q) && (g === 0 ? q.role === 'in' : q.role === 'out' && slotGroup(q.slot) === g));
    let list = group === 0 ? [] : cand(group);
    if (!list.length) list = cand(0).filter((q) => q.st !== ST.HIT && q.st !== ST.DOWN);
    if (!list.length) list = cand(0);
    let best = null, bd = Infinity;
    for (const q of list) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  /** 필살기 ID 결정: 팀·선수 표(-1=무작위 풀 32항목). 표가 없으면 null */
  pickSpecialId(p, keepId = null) {
    const S = this.data.specials;
    if (!S) return null;
    if (this.tr) return this.data.training.specialId; // 특훈의 필살기 ID 는 22 고정 [판독만 ROM 0xB810, 확인 tr_full]
    if (typeof this.forceSpecial === 'number') return this.forceSpecial;
    if (keepId !== null) return keepId; // 받아치기 필살: 받아치기 창($40)이 열려 있으면 잡은 공의 ID($14)를 그대로 쓴다 [직역 ROM 0xB7EC -> 0xB84E, 확인 원작 실행 analysis/data/34_counter_special_oracle: 자기 표 ID 28 인 선수가 ID 22 로 받아침]
    if (p.fl) return flActiveId(this.fls[p.seat], p); // flame: 팀·선수 표 대신 주 슬롯의 해금된 ID(없으면 null = 일반 슛)
    const d = S.row[this.sides[p.seat].team]?.[p.idx];
    if (d === undefined) return null;
    return d < 0 ? S.pool[this.rng.int(S.pool.length)] : d;
  }

  /**
   * 필살기 발동 조건 [확인 0x8BEE]: 공중 투구, 차지 13~15, 내야 슬롯(<4). auto=16f 자동발사
   * 예외 = 받아치기(counter): 필살 공을 잡고 받아치기 창이 열린 채 던지면 공중·차지·auto 를 보지 않고 필살. こうしき·외야 슬롯·특훈 제외는 그보다 먼저 걸린다
   */
  specialReady(p, charge, air, auto, counter = false) {
    const L = this.R.special;
    if (!L?.enabled || !this.data.specials || p.slot > L.maxSlot) return false;
    if (this.trNoSpecial(p)) return false; // 캐치 특훈의 내 투구는 필살이 되지 않는다 [판독만 ROM 0x8C24]
    if (this.forceSpecial !== false) return true;
    if (this.official) return false; // こうしき: 차지 값과 상관없이 일반 슛(타입 0x14). 차지의 위력·속력 가산은 그대로다. 원작 순서 = 강제 발동($E694) 다음 [직역 ROM 0x8BFA, 확인 poke analysis/29 §3-5]
    if (p.fl && !flCanSpecial(this.fls[p.seat], p, counter)) return false; // flame 잠금: こうしき 처럼 차지의 위력·속력 가산은 남는 일반 슛이 된다
    // 받아치기 필살 [직역 ROM 0x8C08]: 필살 공($76=1)을 잡고 받아치기 창이 열린 동안 던지면 차지와 무관하게 필살 슛.
    // [확인 원작 실행 analysis/data/34_counter_special_oracle] 창 안 지상 투구 = 필살, ID·위력·속력 승계, 창이 끝난 뒤는 일반, 점프하면 창 해제, 밀리는 중에는 투구 불가
    // [판독만] こうしき 비적용·외야 슬롯 제외·검사 순서: こうしき($E680)·외야 슬롯 검사 다음, 차지 판정(0x8CF0) 앞. $76 은 창이 0 이 되는 프레임에 지워지므로(0xA8B8 -> 0xA3E6/0xA408) '창이 열려 있음'과 같다
    // auto(차지 16 자동 발사)와 겹치지 않는다: 창이 열려 있으면 차지가 늘지 않고(0x75D0, tickPlayer 의 ball.ctr 검사) 차지는 공중에서만 시작하는데 보유자가 공중이면 창이 닫힌다(0xA8C2, stepBall). 그래서 counter 와 auto 가 함께 참일 수 없다.
    // 보유 시간 초과 강제 투구(0x76A4)는 auto 가 아니라 차지 0 의 보통 투구 동작이고 원작도 같은 발사 루틴(0x71BC -> 0x8BEE)을 타므로 창 안이면 받아치기 필살이 맞다. 다만 보유 카운터는 공을 잡을 때 0 이 되고 한도가 1200 이라 창(밀림 최대 33 + 60틱) 안에 닿지 않는다
    if (counter) return true;
    // 원작 판정(0x8BEE -> 0x8CF0)은 차지 값($18)만 본다(공중 여부를 보지 않는다). 사람은 지상 투구의 $18 이 항상 0 이라 공중에서만 성립하고, 컴퓨터는 0xCC56 이 지상에서 $18=15 를 넣는 경우가 있다(p.gsp)
    return (air || !!p.gsp) && !auto && charge >= L.minCharge && charge <= L.maxCharge;
  }

  endSpecial() { this.ball.kind = 0; this.ball.sp = null; }

  /** fm = 엔드 어택 옵션 {target, power, speed}: 필살기 판정을 거치지 않고 위력·속도·대상을 직접 지정 */
  doThrow(p, charge, auto = false, fm = null) {
    const R = this.R, T = R.throw, b = this.ball;
    const air = p.z > 0 || p.vz > 0;
    const dash = p.dashFlag || p.st === ST.DASH;
    const aim = this.sides[p.seat].aim;
    const t = fm ? fm.target : this.pickTarget(p, aim);
    const pow = p.stat.pow;
    b.power = fm ? fm.power : pow + (air ? Math.trunc(pow / T.airBonusDiv) : 0) + (dash ? Math.trunc(pow / T.dashBonusDiv) : 0) + charge;
    const speed = fm ? fm.speed : (p.stat.thr << T.speedShift) + (air ? T.airSpeedBonus : 0) + (dash ? T.dashSpeedBonus : 0) + (charge << T.chargeSpeedShift);
    if (!fm && T.rom && this.data.rom && t) { this.romThrow(p, t, charge, auto); return; }
    b.rom = false; b.steer = 0; b.ang = null; b.ctr = 0;
    b.x = p.x + p.face * px(T.handDx); b.y = p.y; b.z = p.z + px(T.handZ);
    let nx = p.face, ny = 0, dist = 120;
    let zt = T.targetZ;
    if (t) {
      const dx = toPx(t.x - b.x), dy = toPx(t.y - b.y);
      dist = Math.max(1, Math.hypot(dx, dy));
      nx = dx / dist; ny = dy / dist;
      zt = toPx(t.z) + T.targetZ;
    }
    const sp = toPx(speed);
    const tf = Math.max(1, dist / sp);
    b.vx = Math.round(nx * speed); b.vy = Math.round(ny * speed);
    b.vz = Math.round(((zt - toPx(b.z) + (toPx(R.gravity) * tf * tf) / 2) / tf) * ONE);
    b.mode = BM.FLY; b.holder = -1; b.thrower = p.pid; b.tgt = t ? t.pid : -1; b.kind = 0; b.still = 0; b.id = ++this.throwId;
    b.steerBack = 0; b.sp = null;
    let spId = null;
    if (!fm && this.specialReady(p, charge, air, auto)) spId = this.pickSpecialId(p);
    if (spId !== null) { // 필살기: 위력=ID 표(255=덮어쓰지 않음), 중력 없는 V0(높이차/비행시간), kind=ID+1 [확인 06 §1.4]
      const pw = this.data.specials.power[spId];
      if (pw !== undefined && pw !== 255) b.power = pw;
      b.vz = Math.round(((zt - toPx(b.z)) / tf) * ONE);
      b.kind = spId + 1; b.sp = initSpecial(b, spId);
    }
    if (p.fl && !fm) { p.flPassSpd = 0; b.power = flThrowPow(this, p, b.power, { air, ch: charge <= T.maxCharge ? charge : 0, spId, counter: false }); } // flame 조건부 위력(포메이션 엔드 어택 제외). 이 비직역 경로는 속도 가산 없음
    p.hasBall = false; p.charging = false; p.hold = 0; p.dashFlag = false;
    if (!air && !(T.rom && this.data.rom)) { p.st = ST.THROW; p.tm = T.recoverFrames; }
    this.emit('throw', fm ? { p: p.pid, tgt: b.tgt, pw: b.power, ch: charge, fm: 1 } : { p: p.pid, tgt: b.tgt, pw: b.power, ch: charge });
    if (spId !== null) this.emit('special', { p: p.pid, id: spId });
    // 상대 투구 대상이 사람 사이드의 선수면 조작 전환용으로 autoSwitch 가 처리
  }

  /**
   * 투구 발사 = 원작 직역 [ROM 0x71BC~0x7224: 위력 0x89AA, 속력 0x7D0C, 속도 0x7D90, 필살기 판정 0x8BEE. 실측 analysis/21 §4]
   * - 공 위치 = 투구 애니의 손 위치 표(0x39F6C, 몸통 클래스·앞/뒤)로 정수부를 쓰고 소수부는 그대로 둔다(0xA2BA)
   * - 수평 속도 = 속력 x 방향(각도표), vz = 속력 x (대상 높이(+16 지상 투구) - 공 높이, 수평 거리)의 기울기. 중력 보정 없음(투구 비행은 직선)
   * - 받아치기 창(b.ctr>0, 캐치 후 60프레임): 잡은 공의 위력·속력을 그대로 쓴다(0x89B0/0x7D12)
   */
  romThrow(p, t, charge, auto) {
    const R = this.R, T = R.throw, b = this.ball, RT = this.data.rom;
    const air = p.z > 0 || p.vz !== 0, dash = p.dashFlag;
    const pow = p.stat.pow, ch = charge <= T.maxCharge ? charge : 0; // 16프레임 자동 발사는 차지 가산 없음 [확인 0x89D6 cmpi #$f/bhi]
    let power = pow + (air ? pow >> 2 : 0) + (dash ? pow >> 2 : 0) + ch;
    let spd = ((p.stat.thr << 4) + (air ? 0x100 : 0) + (dash ? 0x100 : 0) + (ch << 4)) & 0xffff;
    if (b.ctr > 0) { power = b.cpow; spd = b.cspd; }
    const flCtr = b.ctr > 0; // flame 훅용(받아치기 공인가). 아래에서 b.ctr 을 지우기 전에 읽는다
    if (p.fl) spd = flThrowSpd(this, p, spd, flCtr); // flame: 패스 직후 투구 속도
    const ctrId = b.ctr > 0 && b.f76 && typeof b.cid === 'number' ? b.cid : null; // 받아치기 필살(공 $76): 창이 열린 채 던지는 필살 공의 ID. 아래에서 b.ctr 을 지우기 전에 읽는다
    // 공 $42(던질 때의 공 $3E, 0x71C4). 창이 닫혀 있으면 $3E = 던진 선수의 차지($18). 창이 열려 있으면 보유 공 핸들러(0xA2B6 -> 0xA3E6)가 매 프레임 $3E 를 덮는다: 잡은 공이 필살 공($76)이면 15 고정, 일반 공이면 잡은 공의 $42 그대로
    // [직역 ROM 0xA3E6/0x71C4, 확인 원작 실행 analysis/data/34_counter_special_oracle/charge_*.txt: 차지 13 필살을 받아친 공 $42=15, 차지 12 일반 공을 받아친 공 $42=12]
    const c42 = b.ctr > 0 ? (b.f76 ? 15 : b.c42 | 0) : ch;
    if (this.trWeak(p)) { power = pow >> this.data.training.weakPowerShift; spd = (p.stat.thr << 4) & 0xffff; } // 캐치 특훈의 내 투구·필살 슛 특훈의 연습 상대 투구: 위력 1/4, 속력은 구속/16 만 [판독만 ROM 0x8A08/0x7D6E, 속력 5.5 는 확인]
    const fl = (v) => Math.floor(v / ONE);
    const left = fl(p.x) >= fl(t.x), back = fl(p.y) >= fl(t.y); // 0x78A0: 방향 비트0(좌우 반전)·비트1(뒤 애니 0x08)
    const cls = RT.bodyClass[p.ot ?? this.sides[p.seat].team]?.[p.oi ?? p.idx] ?? 0, h = T.rom.hand[back ? 'b' : 'a'][cls];
    // 발사(0x71BC)는 공 위치를 다시 계산하지 않는다: 직전 프레임의 공 핸들러가 놓은 보유 위치(투구 애니 손 위치) 그대로 떠난다. 지상에서는 아래 식과 같고, 공중에서는 선수가 그 사이 움직인 만큼 다르다 [실측 atk_seed3 f180]
    const held = p.windRel && b.mode === BM.HELD && b.holder === p.pid && !!RT.hand;
    const bx = held ? fl(b.x) : fl(p.x) + (left ? -h[0] : h[0]), by = held ? fl(b.y) : fl(p.y) + T.rom.handDy, bz = held ? fl(b.z) : fl(p.z) + h[1];
    b.x = bx * ONE + (b.x & 0xffff); b.y = by * ONE + (b.y & 0xffff); b.z = bz * ONE + (b.z & 0xffff);
    const a = romAngle(fl(t.x), fl(t.y), bx, by);
    const v = romDecomp(RT.trig, a.i, a.fl, spd);
    const dist = Math.floor((RT.dist[a.i] * a.major) / 256) & 0xffff;
    const e = romAngle(fl(t.z) + (air ? 0 : T.rom.groundTargetZ), dist, bz, 0);
    b.vx = v[0]; b.vy = v[1]; b.vz = romDecomp(RT.trig, e.i, e.fl, spd)[0];
    b.power = power; b.spd8 = spd; b.ang = { i: a.i, fl: a.fl }; // 공 $70/$72: 발사 각도. 패스에서는 갱신되지 않아 마지막 투구 값이 남는다(0x71EC 만 기록)
    b.mode = BM.FLY; b.holder = -1; b.thrower = p.pid; b.tgt = t.pid; b.kind = 0; b.still = 0; b.id = ++this.throwId;
    b.steerBack = 0; b.sp = null; b.rom = true; b.ctr = 0;
    b.steer = this.humans[p.seat] ? p.steer | 0 : 0; p.steer = 0;
    if (b.steer & 4) b.vz >>= 1; // 뒤쪽 보정이 걸린 채 발사되면 vz 절반 [확인 0xA450]
    let spId = null;
    if (this.specialReady(p, charge, air, auto, ctrId !== null)) spId = this.pickSpecialId(p, ctrId);
    if (spId !== null) { // 필살기: 위력=ID 표(255=덮어쓰지 않음), kind=ID+1. 초기 속도는 위 직선 속도 그대로
      const pw = this.data.specials.power[spId];
      if (pw !== undefined && pw !== 255) b.power = pw;
      const s2 = p.fl ? flSpSpd(this, p, spd, flCtr) : spd; // flame 필살 속도(등급 D52): 가산이 있으면 위(1172~1180행)와 같은 식으로 속도를 다시 분해한다 -> initSpecial 의 V0
      if (s2 !== spd) { const v2 = romDecomp(RT.trig, a.i, a.fl, s2); b.vx = v2[0]; b.vy = v2[1]; b.vz = romDecomp(RT.trig, e.i, e.fl, s2)[0]; b.spd8 = s2; if (b.steer & 4) b.vz >>= 1; }
      b.kind = spId + 1; b.sp = initSpecial(b, spId);
    }
    if (p.fl) b.power = flThrowPow(this, p, b.power, { air, ch, spId, counter: flCtr }); // flame 조건부 위력: 캐치 후 첫 투구·차지 13~15·공중·필살/계열 가산
    p.hasBall = false; p.charging = false; p.hold = 0; p.dashFlag = false; p.gsp = false;
    b.c42 = c42; // 컴퓨터의 받아치기 판단(0xD566)이 본다
    this.trThrow(p, spId !== null, ch);
    this.emit('throw', { p: p.pid, tgt: b.tgt, pw: b.power, ch: charge });
    if (spId !== null) this.emit('special', { p: p.pid, id: spId });
  }

  /** 투구 비행 1프레임 = 원작 직역 [ROM 0xA462 -> 0xA728]: 보정 -> 이동(중력 없음) -> 벽(x 1/4·y 1/2 반사, 바운스 공으로) -> 천장(z>=384) -> 바닥(속도 절반, vz 2.0) */
  stepRomFly() {
    const R = this.R, C = R.court, b = this.ball, s = b.steer | 0;
    if (s & 1) b.vy -= 0x1000;
    if (s & 2) b.vy += 0x1000;
    if (s & 8) b.vz += 0x1000;
    if (s & 4) b.vz -= 0x2000;
    this.ballDir();
    b.x += b.vx; b.y += b.vy; b.z += b.vz;
    let end = false;
    const fx = Math.floor(b.x / ONE), fy = Math.floor(b.y / ONE);
    if (fx < C.xMin || fx >= C.xMax) { b.x = px(fx < C.xMin ? C.xMin : C.xMax); b.vx = (-b.vx) >> 2; end = true; this.emit('wall'); }
    if (fy < C.yMin || fy >= C.yMax) { b.y = px(fy < C.yMin ? C.yMin : C.yMax); b.vy = (-b.vy) >> 1; if (!end) this.emit('wall'); end = true; }
    if (Math.floor(b.z / ONE) >= R.throw.rom.ceilZ) { b.vz = 0; end = true; }
    if (b.z <= 0) { b.vx >>= 1; b.vy >>= 1; b.vz = R.ballPhys.floorBounceVz; b.z = 0; end = true; this.emit('bounce'); }
    if (end) { b.mode = BM.LOOSE; b.still = 0; b.rom = false; b.steer = 0; }
  }

  /**
   * 바운스·굴러가는 공 1프레임 = 원작 직역 [ROM 0xA5B4(서브0) + 0xA77A(바닥) + 0xA7EA(벽)]:
   * 중력 -> 이동 -> 벽(x 1/4·y 1/2 반사) -> z<0 이면 바닥: 수평 속도 절반(-1 은 0), 반발 = -vz - (-vz >> 스테이지 시프트), 반발 <= 중력이면 0.
   * 지면 마찰로 굴러가는 구간은 없다(바닥에 닿을 때마다 절반). vz·vx·vy 가 모두 0 이 되면 정지(서브4, $1E=1)
   */
  stepRomLoose() {
    const R = this.R, C = R.court, b = this.ball, g = R.gravity;
    const romSt = !!(R.stall?.rom && R.ctrlSwitch.rom && this.data.rom); // 정지 공 처리 직역(구역 갱신·300프레임 강제 회수). 꺼져 있으면 종전 자작 안전망
    if (!(b.z === 0 && b.vz === 0 && b.vx === 0 && b.vy === 0 && b.still > 0)) {
      b.vz -= g; this.ballDir(); b.x += b.vx; b.y += b.vy; b.z += b.vz;
      const fx = Math.floor(b.x / ONE), fy = Math.floor(b.y / ONE);
      if (fx < C.xMin || fx >= C.xMax) { b.x = px(fx < C.xMin ? C.xMin : C.xMax); b.vx = (-b.vx) >> 2; this.emit('wall'); }
      if (fy < C.yMin || fy >= C.yMax) { b.y = px(fy < C.yMin ? C.yMin : C.yMax); b.vy = (-b.vy) >> 1; this.emit('wall'); }
      if (romSt) this.romZones(); // 바운스 공(서브0)은 매 프레임 공 구역을 갱신한다 [직역 ROM 0xA5D6 -> 0x6F5C]
      if (b.z < 0) {
        this.floorTouch();
        this.floorBounce();
        if (!(b.vz === 0 && b.vx === 0 && b.vy === 0)) { b.still = 0; return; }
      } else { b.still = 0; return; }
    }
    if (romSt) {
      // [직역 ROM 0xA60E~0xA666] 정지(서브4): 진입 프레임에 타이머 30·방치 카운터($E25E) 0. 매 프레임 타이머-1, 0 이 되면 타이머 30 + 구역 갱신 + 조작 전환(0x85CC),
      // 아니면 방치 카운터+1 이고 300(0x12C)을 넘으면 서브8: 그 다음 프레임에 구역 갱신 + 강제 회수(0x86A6, 타입 0x44) 1회. 서브8 이후에는 30프레임 전환이 더 없다.
      // still: 1 = 멈춘 프레임(서브0 마지막), 2 = 서브4 첫 프레임. 서브4 의 n 번째 프레임에서 카운터 = n - floor(n/30) -> 311번째에 서브8, 312번째에 회수 발동
      b.still++;
      if (this.phase !== 'play' || this.result) return;
      const n = b.still - 1, T = R.stall.rom.switchFrames, lim = R.stall.rom.idleFrames;
      let sub8 = lim + 1; while (sub8 - Math.floor(sub8 / T) <= lim) sub8++; // 카운터가 처음으로 lim 을 넘는 서브4 프레임 번호(300·30 -> 311)
      // [자작 안전망, 원작 근거 없음] 강제 회수(타입 0x44) 선수가 있는데도 공이 멈춘 채 t44MaxFrames 를 넘기면(원작 규칙으로는 생기지 않아야 하는 교착) 회수를 풀고 새로 멈춘 공으로 취급해 원작 흐름(30프레임 전환 -> 312프레임 강제 회수)을 처음부터 다시 돌린다.
      // 같은 공에서 두 번째면 giveFrames 안전망과 같은 방식으로 가장 가까운 선수에게 직접 준다. 정상 경로(회수 선수가 달려가 줍는다: 최장 실측 20프레임)에서는 발동하지 않는다
      // こうしき TIME UP·PLAY OFF 정지 구간(timeHold)에는 이 자작 안전망을 세지 않는다: 원작은 그 구간에도 방치 카운터·30프레임 전환·강제 회수 지정을 그대로 진행하고(0x6156/0x61A6 -> 0x4EBE 공 오브젝트),
      // 지정된 0x44 선수는 멈춘 채 0x44 로 남았다가 재개 뒤 달려가 줍는다 [확인 원작 실행 analysis/data/33_koushiki_oracle/hold_stall.txt]. 선수가 못 움직이는 시간을 교착으로 세면 재개 뒤 회수가 사라진다
      const tMax = this.timeHold ? 0 : R.stall.t44MaxFrames;
      if (tMax > 0) {
        let stale = null;
        for (const q of this.players) if (q.t44) { q.t44.age = (q.t44.age | 0) + 1; if (q.t44.age > tMax) stale = q; }
        if (stale) {
          for (const q of this.players) q.t44 = null;
          this.emit('stall_t44', { p: stale.pid });
          b.t44n = (b.t44n | 0) + 1;
          if (b.t44n >= 2 && R.stall.giveFrames) { b.still = R.stall.giveFrames; this.stallGuard(); }
          if (b.mode === BM.LOOSE) b.still = 0;
          return;
        }
      }
      if (n > sub8) {
        if (n === sub8 + 1) this.romRetrieve();
        // [자작 안전망, 원작 근거 없음] 원작 규칙으로 회수할 선수가 없을 때만(예: 그 구역 외야가 아웃된 선수뿐 — 아웃 선수의 외야 활동이 미이식이라 생기는 구멍) 종전 stallGuard 를 쓴다.
        // 강제 회수 선수가 달려가는 중에는 건드리지 않는다. 공을 옮긴 뒤에는 새로 멈춘 공으로 취급해 원작 흐름(30프레임 전환 -> 줍기)으로 되돌린다
        else if (!this.players.some((q) => q.t44) && R.stall.nudgeFrames) {
          // 정지 구간(timeHold)에는 공을 옮기거나 주지 않는다(원작에 없는 동작). 발동 프레임에 걸리면 still 을 한 칸 물려 재개 첫 틱에 발동시킨다(건너뛰면 안전망이 영영 안 걸린다)
          if (this.timeHold) { if (b.still === R.stall.nudgeFrames || b.still === R.stall.giveFrames) b.still--; return; }
          const x0 = b.x, y0 = b.y;
          this.stallGuard();
          if (b.mode === BM.LOOSE && (b.x !== x0 || b.y !== y0)) b.still = 0;
        }
        return;
      }
      if (n > 0 && n % T === 0) { this.romZones(); this.romSwitch(); }
      return;
    }
    // 정지: 이하(정지 위치 보정·컴퓨터 자동 습득·소프트락 안전망)는 원작 근거가 없는 자작 처리(rules.stall.rom 이 없을 때만 쓰인다)
    if (b.still === 0) this.settleBall();
    b.still++;
    // [직역 ROM 0xA60E] 정지(서브4) 진입 다음 프레임에 타이머 30, 0 이 될 때마다(정지 후 30·60·90... 프레임째) 구역 갱신 + 조작 전환(0x85CC)
    if (R.ctrlSwitch.rom && this.data.rom && this.phase === 'play' && !this.result && b.still > 1 && (b.still - 1) % 30 === 0) { this.romZones(); this.romSwitch(); }
    if (!R.autoPickup.off && b.still >= R.autoPickup.stillFrames) this.autoPickup(); // off=true: 원작에 없는 자동 습득을 끈다(컴퓨터는 공에 닿아 줍기 동작으로 줍는다)
    if (b.mode === BM.LOOSE && this.phase === 'play' && !this.result) this.stallGuard();
  }

  /** 공 방향 비트(공 $3 bit0 = x 음수, bit1 = y 음수) [직역 ROM 0xA85C]: 공이 움직이는 모든 핸들러가 매 프레임 속도 부호로 갱신한다(0 인 축은 그대로). 캐치 방향 판정(0x8416)이 이 값을 본다 */
  ballDir() { const b = this.ball; if (b.vx !== 0) b.d0 = b.vx < 0; if (b.vy !== 0) b.d1 = b.vy < 0; }

  /** 바운스 공이 바닥에 닿음 [직역 ROM 0xA5E2~0xA5EC]: 공 $3C(마지막으로 맞거나 잡은 선수)의 유예 표시($6D)를 끈다. こうしき 의 쓰러짐 종료 판정(0x9554)만 이 값을 본다 */
  floorTouch() { const h = this.players[this.ball.lastHit]; if (h) h.grace = false; }

  /** 바닥 반발 [직역 ROM 0xA77A]: 수평 속도 절반(-1 은 0), 반발 = -vz - (-vz >> 스테이지 시프트), 반발 <= 중력이면 0 */
  floorBounce() {
    const b = this.ball, g = this.R.gravity;
    b.vx >>= 1; if (b.vx === -1) b.vx = 0;
    b.vy >>= 1; if (b.vy === -1) b.vy = 0;
    let v = -b.vz; v -= v >> this.stage.bounceShift;
    if (v <= g) v = 0; else this.emit('bounce');
    b.vz = v; b.z = 0;
    // 반발 속도가 0.5 이상인 바운스마다 조작(활성) 선수 전환 [직역 ROM 0xA7B6~0xA7C6 -> 0x85CC]. 구역은 이 프레임에 이미 갱신된 값($E279 플래그의 뜻은 미판독: 0 으로 가정)
    if (v >= 0x8000 && this.R.stall?.rom && this.R.ctrlSwitch.rom && this.data.rom && this.phase === 'play' && !this.result && !this.tip.on) this.romSwitch();
  }

  /**
   * 패스 공 1프레임 = 원작 직역 [ROM 0xA516 -> 0x1DEA(중력) -> 0xA728(방향 비트·이동·벽 0xA7EA·천장·바닥)]. 포물선으로 날아가며 대상을 따라가지 않는다.
   * 벽에 닿거나 높이 384 이상, 바닥(z<=0, 0xA77A 반발)에 닿으면 바운스 공이 된다
   */
  stepRomPass() {
    const R = this.R, C = R.court, b = this.ball;
    b.vz -= R.gravity;
    this.ballDir();
    b.x += b.vx; b.y += b.vy; b.z += b.vz;
    let end = false;
    const fx = Math.floor(b.x / ONE), fy = Math.floor(b.y / ONE);
    if (fx < C.xMin || fx >= C.xMax) { b.x = px(fx < C.xMin ? C.xMin : C.xMax); b.vx = (-b.vx) >> 2; end = true; this.emit('wall'); }
    if (fy < C.yMin || fy >= C.yMax) { b.y = px(fy < C.yMin ? C.yMin : C.yMax); b.vy = (-b.vy) >> 1; if (!end) this.emit('wall'); end = true; }
    if (Math.floor(b.z / ONE) >= R.throw.rom.ceilZ) { b.vz = 0; end = true; }
    if (b.z <= 0) { this.floorBounce(); end = true; }
    if (end) { b.mode = BM.LOOSE; b.still = 0; b.romPass = false; }
  }

  /**
   * 패스 수신 대기(타입 0x30) [직역 ROM 0x935C]. 반환 false = 수신 대기 끝(평소 타입으로).
   * 서브0(0x93A0): 제자리(속도 0), 공 쪽을 한 번 본다. 패스 공이 히트박스 12(64x64, 높이 무시)에 들어오면 지상 패스는 캐치 자세(서브 0x14), 공중 패스는 점프(서브4, vz = 1.0 + s3<<12 (+1.0 대시 플래그) (+1.0 패서 대시 플래그))
   * 서브 0x14(0x9434)·서브4(0x93F8): 현재 히트박스와 공이 겹치면(0x6C44) 획득(0x744E). 서브 0x14 는 공이 패스 상태(bit7)가 아니면 끝(0x9448), 서브4 는 착지하면 끝(0x942A).
   * 서브0 에는 '패스가 끝나면 풀린다'는 검사가 없다: 어떤 공이든 히트박스 12 에 들어올 때까지 서 있고, 그 밖에는 피격 전환(0x85AA)·활성 선수 교체(0x821C/0x8262)·공 획득으로만 풀린다
   * [근사] 서브 0x14/4 의 획득은 패스 공일 때만(원작 0x945C 는 공 상태를 보지 않는다)
   */
  stepRecv(p) {
    const b = this.ball, r = p.recv;
    if (!this.usable(p) || p.st === ST.HIT || p.st === ST.DOWN || p.st === ST.FOUL) { if (p.st === ST.CATCH && r.sub === 0x14) p.st = ST.IDLE; return false; }
    const fl = (v) => Math.floor(v / ONE);
    if (r.sub === 0) {
      if (r.fresh) { r.fresh = false; p.face = fl(p.x) >= fl(b.x) ? -1 : 1; p.back = fl(p.y) >= fl(b.y); }
      if (p.st !== ST.IDLE && p.st !== ST.DASH && p.st !== ST.BRAKE) return true; // 자세 중이면 끝난 뒤에 반응
      p.st = ST.IDLE; p.dashDir = 0;
      const hbs = this.data.court.hitboxes, a = hbs[12], c = hbs[this.R.hitboxIdx.ball];
      const ov = (p0, o0, l0, p1, o1, l1) => { const s0 = Math.max(p0 + o0, 0), s1 = Math.max(p1 + o1, 0); return p0 + o0 + l0 >= s1 && p1 + o1 + l1 >= s0; };
      if (!(ov(fl(p.x), a.xoff, a.w, fl(b.x), c.xoff, c.w) && ov(fl(p.y), a.yoff, a.h, fl(b.y), c.yoff, c.h))) return true; // 0x93B0: 공 상태와 무관하게 상자에 들어올 때까지 대기
      if (!b.passAir) { r.sub = 0x14; r.fresh = true; p.st = ST.CATCH; p.tm = 0x7fff; p.vx = 0; p.vy = 0; p.face = fl(p.x) >= fl(b.x) ? -1 : 1; p.back = fl(p.y) >= fl(b.y); }
      else { r.sub = 4; p.vz = ONE + (p.stat.s3 << 12) + (p.dashFlag ? ONE : 0) + (b.passDash ? ONE : 0); p.st = ST.JUMP; r.air = true; p.aiHold = true; this.emit('jump', { p: p.pid }); } // 점프 진입 프레임에는 적분이 없다(핸들러 끝에서 진입) [실측 atk_seed1 f171]
      return true;
    }
    if (r.sub === 0x14) {
      if (r.fresh) { r.fresh = false; return true; } // 진입 다음 프레임부터 0x9434 가 돈다
      if (!(b.mode === BM.PASS && b.romPass)) { p.st = ST.IDLE; return false; } // 0x9448: 패스 공이 아니면 끝
      return true;
    }
    if (r.sub === 4 && !(p.z > 0 || p.vz !== 0) && !r.air) return false; // 착지: 수신 대기 끝(0x942A)
    r.air = false;
    return true;
  }

  /** 패스 수신 판정(이동 뒤) [직역 ROM 0x945C -> 0x744E]: 현재 히트박스와 공이 겹치면 획득 */
  recvCatch(p) {
    const r = p.recv, b = this.ball;
    if (r.sub === 0 || b.mode !== BM.PASS) return;
    if (!this.boxHit(p, p.hbC ?? this.R.hitboxIdx.stand)) return;
    p.recv = null;
    if (p.st === ST.CATCH) p.st = ST.IDLE;
    this.giveBall(p, 'recv'); this.emit('receive', { p: p.pid });
    // 패스 수신(0x744E -> 0x8886): 받은 선수가 그 사이드의 활성 선수가 된다(상대 사이드 전환은 없다) [실측 atk_seed1 f99]
    if (this.R.stall?.rom && this.R.ctrlSwitch.rom && this.data.rom && !this.tip.on && !this.fm) this.romSetCtrl(this.sides[p.seat], p, false);
  }

  doPass(p, bits) {
    const R = this.R, b = this.ball;
    const mates = this.players.filter((q) => q.seat === p.seat && q !== p && this.usable(q) && q.st !== ST.HIT && q.st !== ST.DOWN);
    if (!mates.length) return;
    let dx = ((bits & BIT.RIGHT) ? 1 : 0) - ((bits & BIT.LEFT) ? 1 : 0);
    let dy = ((bits & BIT.DOWN) ? 1 : 0) - ((bits & BIT.UP) ? 1 : 0);
    let best = null, bs = -Infinity;
    for (const q of mates) {
      const vx = toPx(q.x - p.x), vy = toPx(q.y - p.y), d = Math.max(1, Math.hypot(vx, vy));
      // 방향 입력이 있으면 그 방향 우선(코사인), 없으면 [추정] 가까운 외야 우선
      const score = dx || dy ? (vx * dx + vy * dy) / d / Math.hypot(dx, dy) * 1000 - d : (q.role === 'out' ? 1000 : 0) - d;
      if (score > bs) { bs = score; best = q; }
    }
    if (p.passTo != null) { best = this.players[p.passTo] ?? best; p.passTo = null; } // 컴퓨터 공격 plan 이 정한 패스 대상($E214)
    if (R.pass.rom && R.throw.rom && this.data.rom && !this.fm) { this.romPass(p, best); return; }
    b.x = p.x + p.face * px(R.throw.handDx); b.y = p.y; b.z = p.z + px(R.throw.handZ);
    const speed = p.stat.pass << R.pass.speedShift;
    b.romPass = false;
    b.mode = BM.PASS; b.holder = -1; b.thrower = p.pid; b.tgt = best.pid; b.power = R.pass.power; b.kind = 0; b.sp = null; b.id = ++this.throwId;
    b.vx = b.vy = b.vz = 0; b.passSpeed = speed;
    p.hasBall = false; p.charging = false; p.hold = 0;
    if (this.fl) flPass(this, p);
    b.rom = false; b.steer = 0; b.ang = null; b.ctr = 0;
    if (p.z <= 0 && !(R.throw.rom && this.data.rom)) { p.st = ST.PASS; p.tm = R.throw.passRecoverFrames; }
    this.emit('pass', { p: p.pid, tgt: best.pid });
  }

  /**
   * 패스 발사 = 원작 직역 [ROM 0x72A0~0x7300, 속도 0x7E02]. 공 위치는 보유 위치 그대로. 수평 속도 = 속력(s7*16, 8.8) x 대상 방향(각도 0x2254·분해 0x22DA),
   * vz = floor((거리/2 * 16) / (속력 >> 4)) * (중력 >> 12) << 12 (대상 지점에서 같은 높이로 떨어지는 포물선). 위력 3, 공 $3 bit7(패스), 대상은 수신 대기(타입 0x30).
   * 공의 각도($70/$72)는 갱신하지 않는다(마지막 투구 값이 남는다). 대상 선택 규칙($E214)은 미이식(종전 선택 유지)
   */
  romPass(p, t) {
    const R = this.R, b = this.ball, RT = this.data.rom, fl = (v) => Math.floor(v / ONE);
    const spd = (p.stat.pass << 4) & 0xffff;
    const a = romAngle(fl(t.x), fl(t.y), fl(b.x), fl(b.y));
    const v = romDecomp(RT.trig, a.i, a.fl, spd);
    const half = (Math.floor((RT.dist[a.i] * a.major) / 256) & 0xffff) >>> 1, d7 = spd >> 4;
    const q = d7 ? Math.floor(((half << 4) & 0xffff) / d7) & 0xffff : 0;
    b.vx = v[0]; b.vy = v[1]; b.vz = (Math.imul(q, (R.gravity >>> 12) & 0xffff) << 12) | 0;
    b.mode = BM.PASS; b.romPass = true; b.holder = -1; b.thrower = p.pid; b.tgt = t.pid; b.power = R.pass.power; b.kind = 0; b.sp = null; b.id = ++this.throwId;
    b.rom = false; b.steer = 0; b.ctr = 0; b.still = 0;
    b.passAir = p.z > 0 || p.vz !== 0; b.passDash = !!p.dashFlag; // 공 $3 bit2/bit3 = 패서의 공중·대시 플래그(0x7226)
    if (this.fl) flPass(this, p); // flame: 패스 직후 투구 속도 보너스를 공에 싣는다
    p.hasBall = false; p.charging = false; p.hold = 0; p.dashFlag = false;
    if (this.usable(t) && t.st !== ST.HIT && t.st !== ST.DOWN && t.st !== ST.FOUL && t.st !== ST.OUTMOVE) { // 0x72F4: $1E=0 인 대상만 타입 0x30
      t.recv = { sub: 0, fresh: true, air: false }; t.t44 = null;
      if (!(t.z > 0 || t.vz !== 0)) { t.vx = 0; t.vy = 0; }
    }
    this.emit('pass', { p: p.pid, tgt: t.pid });
  }

  giveBall(q, how) {
    const b = this.ball;
    for (const o of this.players) o.hasBall = false;
    if (this.fl) flGive(this, q, how);
    if (this.R.throw.rom?.aim && this.data.rom) this.sides[q.seat].aim = 0; // 획득 때 조준 구역($E21C) 0 [직역 ROM 0x73F4/0x7482]
    // 공 $3C·선수 $6D [직역 ROM 0x73CA~0x73E2]: 캐치·줍기로 잡은 선수가 직전에 맞은 선수와 다른 편이면 그 선수의 유예 표시를 끈다(같은 편이면 그대로 = こうしき 세이프). 패스 수신(0x746C)은 $3C 만 바꾼다
    if (how !== 'recv') { const h = this.players[b.lastHit]; if (h && h.seat !== q.seat) h.grace = false; }
    b.lastHit = q.pid;
    b.f76 = !!b.sp; b.acqRecv = how === 'recv'; // f76 = 공 $76(필살기 공이었음), acqRecv = 패스 수신(0x744E)으로 받음
    if (this.R.cpu.rom && this.data.rom) { // 획득 때 기본 패스 대상($E214) [직역 ROM 0x73F0/0x747E -> 0x8358 -> 0x8380]: 슬롯별 패스 구역(사이드 $20 표)의 선수 중 나와 가장 가까운 쓸 수 있는 선수. 없으면 직전 값 유지
      const g0 = PASS_GRP[q.seat][q.slot], t = this.romNearest(q.seat, g0, g0 === 0 ? 4 : 3, q);
      if (t) this.e214 = t.pid;
    }
    b.acqF = this.f; b.acqSt = q.st; // 획득 프레임의 보유 공 위치는 직전 자세 애니 기준(애니 갱신이 한 프레임 늦다) [실측 rng_roll_180 f72: 캐치 자세로 잡은 프레임의 공 높이]
    q.hasBall = true; q.hold = 0; q.charging = false; q.wind = null; q.recv = null;
    b.rom = false; b.steer = 0; b.ctr = 0; b.romPass = false; b.owner = q.pid; // owner = 공 $1C(마지막 보유자)
    b.mode = BM.HELD; b.holder = q.pid; b.vx = b.vy = b.vz = 0; b.still = 0; b.kind = 0; b.sp = null; b.t44n = 0;
    const s = this.sides[q.seat];
    if (this.humans[q.seat] && s.ctrl !== q.pid) { s.ctrl = q.pid; this.emit('ctrl', { seat: q.seat, p: q.pid }); }
    if (q.st === ST.CATCH || q.st === ST.PICKUP || q.st === ST.CROUCH) q.st = q.z > 0 || q.vz > 0 ? ST.JUMP : ST.IDLE;
    void how;
  }

  /**
   * 줍기·캐치 자세 히트박스(idx 11)와 공 히트박스(idx 2)의 겹침 [확인 ROM 0x6C44: 정수 px, 경계 포함. 표 0x69D8(x,y)·0x6A60(z)]
   * 실측(analysis/21 §2): 정지 공 |dx|<=22, |dy|<=20 성공·23/21 실패, 바운스 공은 공 z 정수부 <= 선수 z+32 일 때 성공
   */
  grabTouch(p) { return this.boxHit(p, this.R.hitboxIdx.catch); }

  /** 선수 히트박스(번호 idx)와 공 히트박스(idx 2)의 겹침 [직역 ROM 0x6C44: 정수 px, 경계 포함, x·y 표 0x69D8 + z 표 0x6A60] */
  boxHit(p, idx) {
    const H = this.R.hitboxIdx, hbs = this.data.court.hitboxes, Z = this.R.hitboxZ, b = this.ball;
    const a = hbs[idx], c = hbs[H.ball], za = Z[idx], zc = Z[H.ball];
    const fl = (v) => Math.floor(v / ONE);
    const ov = (p0, o0, l0, p1, o1, l1) => p0 + o0 + l0 >= p1 + o1 && p1 + o1 + l1 >= p0 + o0;
    return ov(fl(p.x), a.xoff, a.w, fl(b.x), c.xoff, c.w) && ov(fl(p.y), a.yoff, a.h, fl(b.y), c.yoff, c.h) && ov(fl(p.z), za[0], za[1], fl(b.z), zc[0], zc[1]);
  }

  /** 정지 공 줍기. strict=줍기 자세(15f) 완료 시 판정 [확인 0x74E0] */
  tryGrab(p, strict) {
    const b = this.ball;
    if (b.mode !== BM.LOOSE) return false; // 심판이 든 공(DROP)은 줍지 못한다
    if (strict && !this.grabTouch(p)) return false;
    this.giveBall(p);
    this.emit('receive', { p: p.pid });
    this.acquireSwitch(p);
    return true;
  }

  /**
   * 보유자의 현재 애니에 해당하는 손 위치 [dx, dy, dz] (표 data.rom.hand = ROM 0x39F6C/0x3A13A).
   * 애니 번호는 원작 애니 선택 루틴 기준: 서기 0x0E/0x10(0x87EC), 걷기 0x00/0x02(0x78CE), 대시 0x04(0x70FC), 투구 0x06/0x08(0x8802), 패스 0x28/0x2A(0x882E),
   * 점프 0x12/0x14(0x87D6), 웅크림·줍기 0x16/0x18(0x87C0), 캐치 0x20/0x22(0x885A), 캐치 후 밀림 0x20/0x22 반대(0x8870), 공중 차지 0x2C/0x2E(0x8818). 짝수=앞, +2=뒤 보기.
   * 한계: 애니 프레임 카운터($10/$11)는 이식하지 않아 여러 프레임짜리 애니(걷기 4프레임의 높이 ±1 등)는 0번 프레임 값을 쓴다
   */
  handOff(h) {
    const HT = this.data.rom.hand, cls = this.data.rom.bodyClass[h.ot ?? this.sides[h.seat].team]?.[h.oi ?? h.idx] ?? 0, bk = h.back ? 1 : 0;
    const air = h.z > 0 || h.vz !== 0;
    let a;
    // 투구·패스 동작을 시작한 프레임(서브 초기화 전)은 애니가 아직 직전 것이다 [실측 out_fetch_back f73, atk_seed6 f185]
    if (h.wind && !(h.wind.age > 0) && h.handA !== undefined && h.handF === this.f - 1) { h.handF = this.f; a = h.handA; const xz0 = HT.xz[cls][a][0]; return [xz0[0], HT.y[a][0], xz0[1]]; }
    if (h.wind && h.wind.age > 0) a = h.wind.kind === 'pass' ? 20 + bk : 3 + bk;
    else if (this.ball.acqF === this.f && this.ball.acqSt === ST.CATCH) a = 16 + bk; // 잡은 프레임은 아직 캐치 애니
    else if (h.slideV > 0) a = 17 - bk;
    else if (air && ((h.charging && h.charge > 0) || (h.wind && h.wind.charge > 0))) a = 22 + bk; // 차지를 끝낸 프레임(투구 동작 초기화 전)도 아직 차지 애니 [실측 atk_seed6 f185] // 차지 애니(0x8818)는 서브 0x24 초기화 = 차지를 시작한 다음 프레임부터 [실측 atk_plan14 f170/f171]
    else if (air) a = 9 + bk;
    else if (h.st === ST.CATCH || (this.ball.acqF === this.f && this.ball.acqSt === ST.CATCH)) a = 16 + bk;
    else if (h.st === ST.CROUCH || h.st === ST.PICKUP) a = 11 + bk;
    else if (h.st === ST.DASH || h.st === ST.BRAKE) a = 2;
    else if (h.st === ST.IDLE && (h.vx || h.vy)) a = bk;
    else a = 7 + bk;
    h.handA = a; h.handF = this.f;
    const xz = HT.xz[cls][a][0];
    return [xz[0], HT.y[a][0], xz[1]];
  }

  /** 공 구역($5D) [직역 ROM 0x6F5C -> 0x6DB8]: 좌석의 판정 영역 표(zones.rom.foul, 사다리꼴 보정 포함)와 공 히트박스(idx 2)가 겹치는 첫 구역. 0 내야, 4 외야 상단, 7 하단, 10 후방, -1 없음 */
  romBallZone(seat) {
    const Z = this.R.zones.rom, b = this.ball, hb = this.data.court.hitboxes[this.R.hitboxIdx.ball];
    const bx = Math.floor(b.x / ONE), by = Math.floor(b.y / ONE), q = by >> 2;
    for (const k of [0, 4, 7, 10]) {
      const r = Z.foul[seat][k], t = Z.trap[seat][k], x0 = r[0] + t[0] * q, x1 = r[1] + t[1] * q;
      if (bx + hb.xoff + hb.w >= x0 && x1 >= bx + hb.xoff && by + hb.yoff + hb.h >= r[2] && r[3] >= by + hb.yoff) return k;
    }
    return -1;
  }

  /**
   * 공 구역 갱신 [직역 ROM 0x6F5C]: 사이드마다 직전 값($5C) <- 현재 값($5D), 현재 값 <- 새 구역(0 내야, 4/7/10 외야, -1 없음).
   * 양쪽 모두 구역 밖이면 공 x > 256 은 좌석0, 아니면 좌석1 의 구역을 13 으로(0x6FC6). 호출: 보유 공 매 프레임(0xA32A), 바운스 공 매 프레임(0xA5D6), 정지 공 30프레임마다(0xA646), 강제 회수 때(0xA65E)
   */
  romZones() {
    const z = [this.romBallZone(0), this.romBallZone(1)];
    if (z[0] < 0 && z[1] < 0) z[Math.floor(this.ball.x / ONE) > 0x100 ? 0 : 1] = 13;
    for (const s of this.sides) { s.zp = s.zone; s.zone = z[s.seat]; }
  }

  /** 슬롯 lo 부터 n 개 중 쓸 수 있는($1E=0) 선수 가운데 공과의 원작 근사 거리(각도 0x2254 + 거리표 0x22A8)가 가장 작은 선수. 같으면 앞 슬롯 [직역 ROM 0x8752] */
  romNearest(seat, lo, n, ref = this.ball, first = false) {
    const b = ref, RT = this.data.rom, fl = (v) => Math.floor(v / ONE);
    // first=true: 결과(d6<0)를 검사하지 않는 호출처(0x8574/0x858A)용. 쓸 수 있는 후보가 없으면 0x8752 의 초깃값 = 후보 슬롯 중 첫 번째로 존재하는 선수(쓰러진 선수·본인일 수 있다)
    let best = first ? this.players.find((o) => o.seat === seat && o.slot >= lo && o.slot < lo + n && !o.removed && o.slot === Math.min(...this.players.filter((x) => x.seat === seat && x.slot >= lo && x.slot < lo + n && !x.removed).map((x) => x.slot))) ?? null : null, bd = 0xffffffff;
    for (let k = lo; k < lo + n; k++) {
      const q = this.players.find((o) => o.seat === seat && o.slot === k && !o.removed);
      if (!q || q === ref || !this.usable(q) || q.st === ST.HIT || q.st === ST.DOWN || q.st === ST.FOUL) continue;
      const a = romAngle(fl(q.x), fl(q.y), fl(b.x), fl(b.y));
      const d = Math.floor((RT.dist[a.i] * a.major) / 256);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  /** 공을 잡았을 때의 전환 [직역 ROM 0x73F8 -> 0x8574]: 잡은 선수가 자기 사이드의 활성 선수가 되고, 상대 사이드는 잡은 선수와 가장 가까운 내야 선수가 활성이 된다. 패스 수신(0x744E)에는 상대 전환이 없다 */
  acquireSwitch(q) {
    if (!(this.R.stall?.rom && this.R.ctrlSwitch.rom && this.data.rom) || this.tip.on || this.fm) return;
    this.romSetCtrl(this.sides[q.seat], q, false);
    const o = this.romNearest(1 - q.seat, 0, 4, q, true); // 0x8582 뒤 d6 검사 없이 0x8886
    if (o) this.romSetCtrl(this.sides[1 - q.seat], o, false);
  }

  /** 피격 때의 전환 [직역 ROM 0x8514 -> 0x858A]: 양 사이드 모두 맞은 선수와 가장 가까운(맞은 선수 제외) 내야 선수가 활성이 된다. 패스 수신 대기(타입 0x30) 선수는 평소 타입으로 */
  hitSwitch(q) {
    if (!(this.R.stall?.rom && this.R.ctrlSwitch.rom && this.data.rom) || this.tip.on || this.fm) return;
    for (const seat of [q.seat, 1 - q.seat]) { const o = this.romNearest(seat, 0, 4, q, true); if (o) this.romSetCtrl(this.sides[seat], o, false); } // 0x8592/0x85A2 뒤 d6 검사 없이 0x8886: 후보가 없으면 첫 내야 슬롯 선수(맞은 본인일 수 있다)가 활성
    for (const o of this.players) if (o.recv) { if (o.st === ST.CATCH && o.recv.sub === 0x14) o.st = ST.IDLE; o.recv = null; }
  }

  /** 활성(조작) 선수 지정 [직역 ROM 0x88B8 / 0x862A~0x865A]. retrieve=true 면 강제 회수(타입 0x44)로 만든다 */
  romSetCtrl(s, q, retrieve) {
    if (q.pid !== s.ctrl) {
      const old = this.players[s.ctrl];
      for (const o of [old, q]) if (o && o.recv && o.st !== ST.HIT && o.st !== ST.DOWN && o.st !== ST.FOUL && o.st !== ST.OUTMOVE) { if (o.st === ST.CATCH && o.recv.sub === 0x14) o.st = ST.IDLE; o.recv = null; } // 0x88D4 -> 0x821C / 0x88DA -> 0x8262: $1E=0 이면 타입이 다시 설정된다(수신 대기 타입 0x30 도 풀린다)
      // 타입 재설정(0x8204/0x8228 -> 0x83C4)은 서브를 0(공중이면 4)으로 되돌린다: 웅크림·캐치 자세·줍기가 그 자리에서 풀린다 [실측 cpu_def_b f94: 웅크리던 수동 내야가 활성이 되며 곧바로 대기로]. 투구·패스 동작 중인 경우는 미확인이라 건드리지 않는다
      for (const o of [old, q]) if (o && (o.st === ST.CATCH || o.st === ST.CROUCH || o.st === ST.PICKUP) && !(o.slideV > 0)) { o.st = o.z > 0 || o.vz !== 0 ? ST.JUMP : ST.IDLE; o.tm = 0; o.tmNew = 0; }
      for (const o of [old, q]) if (o) { if (o.cb) { o.cb.sub = 0; o.cb.fresh = true; } if (o.ob) { o.ob.pc = false; o.ob.mv = false; } } // 타입 재설정은 서브를 0 으로(0x83C4)
      s.ctrl = q.pid; this.emit('ctrl', { seat: s.seat, p: q.pid });
    }
    if (retrieve && !q.t44) { q.t44 = { sub: 0, busy: 0 }; q.recv = null; }
  }

  /**
   * 조작(활성) 선수 전환 = 원작 직역 [ROM 0x85CC -> 0x8660/0x85EE -> 0x8752 -> 0x88B8]. 호출: 공이 정지한 뒤 30프레임마다(0xA640, 구역 갱신 뒤), 반발 0.5 이상인 바운스마다(0xA7C6).
   * - 건너뜀(0x8660): 사람 사이드이고 조작 선수가 내야(슬롯<4)이며 공 구역이 내야(0)이고 방향키가 눌려 있을 때만
   * - 후보(0x85EE): 구역 0 또는 -1 -> 슬롯 0~3, 구역 4/7/10 -> 그 구역 슬롯 3개. 쓸 수 없는 선수($1E!=0: 피격·쓰러짐·선 이탈·아웃 이동)는 제외
   * - 구역 13(양쪽 모두 구역 밖, 0x8622): 후방 외야(슬롯 10~12) 중 가장 가까운 선수를 활성으로 하고 강제 회수(타입 0x44)로 만든다
   */
  romSwitch() {
    for (const s of this.sides) {
      const z = s.zone, cur = this.players[s.ctrl];
      if (this.humans[s.seat] && cur && cur.slot < 4 && z >= 0 && z < 4 && (s.bits & 15)) continue;
      if (z === 13) { const q = this.romNearest(s.seat, 10, 3); if (q) this.romSetCtrl(s, q, true); continue; }
      const best = z > 0 ? this.romNearest(s.seat, z, 3) : this.romNearest(s.seat, 0, 4);
      if (best) this.romSetCtrl(s, best, false);
    }
  }

  /**
   * 방치된 정지 공 강제 회수 [직역 ROM 0xA656 -> 0x6F5C + 0x86A6]: 사이드마다 공 구역의 가장 가까운 선수를 활성으로 하고 타입 0x44(공으로 달려가 줍는다, ai.js retrieveRom)로 만든다.
   * 구역 0 -> 내야 4명 중, 4/7/10 -> 그 구역 3명 중, 13 -> 후방 외야 3명 중. 구역이 없는(-1) 사이드는 내야 최근접으로 보통 전환만 한다(0x86D0 -> 0x88B8). 방향키 건너뜀 규칙은 없다
   */
  romRetrieve() {
    this.romZones();
    for (const s of this.sides) {
      const z = s.zone;
      if (z < 0) { const q = this.romNearest(s.seat, 0, 4); if (q) this.romSetCtrl(s, q, false); continue; }
      const q = z === 0 ? this.romNearest(s.seat, 0, 4) : z === 13 ? this.romNearest(s.seat, 10, 3) : this.romNearest(s.seat, z, 3);
      if (q) this.romSetCtrl(s, q, true);
    }
  }

  // ================= 공 =================
  stepBall() {
    const R = this.R, b = this.ball, C = R.court, g = R.gravity;
    if (b.mode === BM.HELD) {
      const h = this.players[b.holder];
      if (!h || !h.hasBall) { b.mode = BM.LOOSE; return; }
      // 받아치기 창 [직역 ROM 0xA8B8]: 보유자가 공중이면 닫히고, 밀리는 중(서브 0x20)에는 줄지 않으며, 그 밖에는 매 프레임 -1
      if (b.ctr > 0) { if (h.z > 0 || h.vz !== 0) b.ctr = 0; else if (!(h.slideV > 0)) b.ctr--; }
      const zf = R.stall?.rom && R.ctrlSwitch.rom && this.data.rom && !this.tip.on; // 보유 공은 위치를 갱신한 뒤 매 프레임 공 구역을 갱신한다 [직역 ROM 0xA322~0xA32A -> 0x6F5C]
      if (R.throw.rom) { // 보유 공은 정수부만 덮어쓴다(소수부 유지) [확인 ROM 0xA2EE~0xA322 워드 쓰기]. 손 위치 오프셋은 투구 동작 외에는 종전 고정값(표시용 손 위치는 클라이언트 표)
        const fl = (v) => Math.floor(v / ONE);
        if (this.data.rom?.hand) { // [직역 ROM 0xA2BA~0xA322] 손 위치 표(몸통 클래스·애니·프레임)의 [dx,dz]·dy 를 보유자 정수 좌표에 더한다. 왼쪽을 보면 dx 반전
          const o = this.handOff(h);
          // 손 위치의 좌우는 스프라이트 반전 플래그($2 bit7, 0xA2E6). 밀림 핸들러(0x74FA/0xC97E)는 방향 비트($3)만 바꾸고 0x8466 을 부르지 않아 밀리는 동안은 잡을 때의 반전이 남는다 [실측 cpu_def_a f75]
          const left = h.slideV > 0 && h.slideMir !== undefined ? h.slideMir : h.face < 0;
          b.x = (fl(h.x) + (left ? -o[0] : o[0])) * ONE + (b.x & 0xffff); b.y = (fl(h.y) + o[1]) * ONE + (b.y & 0xffff); b.z = (fl(h.z) + o[2]) * ONE + (b.z & 0xffff);
          if (zf) this.romZones();
          return;
        }
        b.x = (fl(h.x) + h.face * R.throw.handDx) * ONE + (b.x & 0xffff); b.y = fl(h.y) * ONE + (b.y & 0xffff); b.z = (fl(h.z) + R.throw.handZ) * ONE + (b.z & 0xffff);
        if (zf) this.romZones();
        return;
      }
      b.x = h.x + h.face * px(R.throw.handDx); b.y = h.y; b.z = h.z + px(R.throw.handZ);
      return;
    }
    if (b.mode === BM.DROP) return; // 심판 손에 있는 공(stepStart 가 위치 갱신)

    if (b.mode === BM.PASS && b.romPass) {
      // 원작 프레임 순서: 선수 핸들러(피격 0x847C·가로채기 0x7392·수신 0x945C, stepPlayers 의 hitOne/recvCatch)가 먼저, 그다음 공이 움직인다
      this.stepRomPass(); return;
    }
    if (b.mode === BM.PASS) {
      let t = this.players[b.tgt];
      if (!t || !this.usable(t) || t.st === ST.HIT || t.st === ST.DOWN) {
        const mates = this.players.filter((q) => q.seat === this.players[b.thrower].seat && this.usable(q) && q.st !== ST.HIT && q.st !== ST.DOWN);
        t = mates.sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
        if (!t) { b.mode = BM.LOOSE; return; }
        b.tgt = t.pid;
      }
      const dx = toPx(t.x - b.x), dy = toPx(t.y - b.y), dist = Math.hypot(dx, dy), sp = toPx(b.passSpeed);
      if (dist <= Math.max(sp, R.pass.catchDist)) {
        b.x = t.x; b.y = t.y;
        this.giveBall(t); this.emit('receive', { p: t.pid });
        return;
      }
      b.vx = Math.round((dx / dist) * b.passSpeed); b.vy = Math.round((dy / dist) * b.passSpeed); b.vz = 0;
      b.x += b.vx; b.y += b.vy; b.z += Math.round((px(R.pass.z) + t.z - b.z) / 4);
      return;
    }

    if (b.mode === BM.FLY && b.sp) { this.stepSpecialBall(); return; } // 직역 투구(b.rom)의 필살 공도 피격·캐치 판정은 선수 단계(stepPlayers 의 hitOne)에서 끝났다. 비직역 필살 공만 이동 뒤 hitCheck
    if (b.mode === BM.FLY && b.rom) { this.stepRomFly(); return; } // 피격·캐치 판정은 선수 단계(stepPlayers 의 hitOne)에서 이번 틱 선수 위치와 지난 틱 공 위치로 이미 끝났다(원작 프레임 순서)
    if (b.mode === BM.LOOSE && R.ballPhys.rom && !this.tip.on) { this.stepRomLoose(); return; }

    // FLY / LOOSE
    const fly = b.mode === BM.FLY;
    if (fly) this.steer();
    b.x += b.vx; b.y += b.vy;
    const air = b.z > 0 || b.vz > 0;
    // ROM 정합 모드(bounceShift >= romMinShift 스테이지의 굴러가는 공만): vz -= g 후 z += vz, 정지 임계 반발속도 <= 중력 [확인 0x1DEA/0xA6E4]
    const BP = R.ballPhys, rom = !fly && this.stage.bounceShift >= BP.romMinShift;
    if (air) { if (rom) { b.vz -= g; b.z += b.vz; } else { b.z += b.vz; b.vz -= g; } }
    // 벽 반사 [확인: 속도 반전, 1/4~1/2 -> 1/2 사용]
    if (b.x < px(C.xMin)) { b.x = px(C.xMin); b.vx = Math.trunc(-b.vx / 2); this.emit('wall'); }
    else if (b.x > px(C.xMax)) { b.x = px(C.xMax); b.vx = Math.trunc(-b.vx / 2); this.emit('wall'); }
    if (b.y < px(C.yMin)) { b.y = px(C.yMin); b.vy = Math.trunc(-b.vy / 2); this.emit('wall'); }
    else if (b.y > px(C.yMax)) { b.y = px(C.yMax); b.vy = Math.trunc(-b.vy / 2); this.emit('wall'); }
    if (b.z <= 0 && b.vz < 0) {
      b.z = 0;
      if (fly) { // 투구 비행 중 바닥 닿으면 한 번 튕김 후 일반 바운스 [확인 a7CC]
        b.vz = R.ballPhys.floorBounceVz; b.mode = BM.LOOSE; b.vx = Math.trunc(b.vx / 2); b.vy = Math.trunc(b.vy / 2);
        this.emit('bounce');
      } else {
        this.floorTouch();
        let v = -b.vz - ((-b.vz) >> this.stage.bounceShift);
        b.vx = Math.trunc(b.vx / 2); b.vy = Math.trunc(b.vy / 2);
        if (v < (rom ? BP.romSettleVz : BP.settleVz)) { b.vz = 0; } else { b.vz = v; this.emit('bounce'); }
      }
    }
    if (b.mode === BM.FLY) { this.hitCheck(); return; }
    // LOOSE: 지면 마찰, 정지 판정, 자동 습득
    if (b.z === 0 && b.vz === 0) {
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        const k = Math.max(0, sp - this.stage.friction) / sp;
        b.vx = Math.trunc(b.vx * k); b.vy = Math.trunc(b.vy * k);
        if (Math.abs(b.vx) < 64 && Math.abs(b.vy) < 64) b.vx = b.vy = 0;
      }
      if (b.vx === 0 && b.vy === 0) {
        if (b.still === 0) this.settleBall();
        b.still++;
        if (b.still >= R.autoPickup.stillFrames) this.autoPickup();
        if (b.mode === BM.LOOSE && this.phase === 'play' && !this.result) this.stallGuard();
      } else b.still = 0;
    } else b.still = 0;
  }

  /**
   * 필살기 비행 1프레임: 핸들러 -> pos+=V(중력·방향키 보정 없음) -> 벽/바닥/천장이면 바운스 공으로 종료 [확인 0xA728]
   * 피격·캐치 판정 순서: 직역 투구(b.rom)는 일반 투구 공과 같이 선수 핸들러가 먼저(이번 틱 선수 위치 대 지난 틱 공 위치), 그다음 공이 움직인다 [실측 tools/diff ctr_special f63~f64: 종전처럼 이동 뒤에 판정하면 캐치가 원작보다 1프레임 이르다].
   * 비직역 투구(R.throw.rom 이 꺼진 경로)의 필살 공만 종전대로 이동 뒤 hitCheck.
   * rom 이 켜져 있어도 투구 대상이 없으면(match.js:1092 doThrow 의 `&& t`) romThrow 를 타지 않아 비직역 필살 공이 생긴다 -> 그 공도 이동 뒤 hitCheck
   */
  stepSpecialBall() {
    const R = this.R, L = R.special, C = R.court, b = this.ball;
    stepSpecial(b, b.sp, () => this.rng.next(), L);
    this.ballDir();
    b.x += b.vx; b.y += b.vy; b.z += b.vz;
    let end = null;
    if (b.x < px(C.xMin)) { b.x = px(C.xMin); b.vx = Math.trunc(-b.vx / L.wallVxDiv); end = 'wall'; }
    else if (b.x >= px(C.xMax)) { b.x = px(C.xMax); b.vx = Math.trunc(-b.vx / L.wallVxDiv); end = 'wall'; }
    if (b.y < px(C.yMin)) { b.y = px(C.yMin); b.vy = Math.trunc(-b.vy / L.wallVyDiv); end = 'wall'; }
    else if (b.y >= px(C.yMax)) { b.y = px(C.yMax); b.vy = Math.trunc(-b.vy / L.wallVyDiv); end = 'wall'; }
    if (b.z >= px(L.ceilZ)) { b.vz = 0; end = end ?? 'ceil'; }
    else if (b.z <= 0) { b.z = 0; b.vx = Math.trunc(b.vx / 2); b.vy = Math.trunc(b.vy / 2); b.vz = L.landVz; end = 'floor'; }
    if (end) {
      this.endSpecial(); b.mode = BM.LOOSE; b.still = 0;
      this.emit(end === 'floor' ? 'bounce' : 'wall');
      return;
    }
    if (!b.rom) this.hitCheck();
  }

  /** 정지한 공이 코트 밖이면 해당 쪽 이동 가능 영역 안으로 이동 [추정] */
  settleBall() {
    const r = this.settledPos(this.ball.x, this.ball.y);
    this.ball.x = r.x; this.ball.y = r.y;
  }

  /** 정지 위치 보정 결과(순수 계산, settleBall/predictRest 공용) */
  settledPos(x, y) {
    // 어느 한 쪽 외야 구역에 놓인 공은 그대로 둔다(원작은 외야로 간 공을 코트 안으로 옮기지 않음) [확인]
    if (this.ballZone(0, x, y) > 0 || this.ballZone(1, x, y) > 0) return { x, y };
    const Z = this.R.zones.infield;
    const seat = toPx(x) < this.R.court.centerX ? 0 : 1;
    const a = seat === 0 ? [Z.xMin, Z.xMax] : [512 - Z.xMax, 512 - Z.xMin];
    return { x: Math.min(Math.max(x, px(a[0])), px(a[1])), y: Math.min(Math.max(y, px(Z.yMin)), px(Z.yMax)) };
  }

  /** 공이 놓인 구역(좌석 기준): 0 내야/구역 밖, 1 외야 상단, 2 외야 하단, 3 외야 후방 [확인 표 0x6B74/0x6BDC] */
  ballZone(seat, x = this.ball.x, y = this.ball.y) {
    const C = this.R.ctrlSwitch;
    let bx = toPx(x);
    const by = toPx(y);
    if (seat === 1) bx = 512 - bx;
    const hit = (z) => bx + C.ballBox.hx >= z.xMin && bx - C.ballBox.hx <= z.xMax && by + C.ballBox.hy >= z.yMin && by - C.ballBox.hy <= z.yMax;
    if (hit(C.infield)) return 0;
    return hit(C.outTop) ? 1 : hit(C.outBottom) ? 2 : hit(C.outBack) ? 3 : 0;
  }

  /**
   * 느슨한 공(LOOSE)의 예상 정지 지점 {x,y}(16.16) 또는 null. stepBall 의 LOOSE 물리(벽 반사·바운스·마찰)를 난수 없이 복제해 앞서 계산한다.
   * 프레임당 1회 캐시. 사람 조작 자동 전환·CPU 외야 추격이 사용(analysis/15). 엔진 상태는 바꾸지 않는다.
   */
  predictRest() {
    const b = this.ball;
    // 캐시 키: 프레임 + 공 상태 지문(같은 프레임 안에서 stepBall 전후로 공이 달라지면 재계산)
    const key = `${this.f}|${b.mode}|${b.x}|${b.y}|${b.z}|${b.vx}|${b.vy}|${b.vz}`;
    if (this.restK === key) return this.restC;
    this.restK = key; this.restC = null;
    if (b.mode !== BM.LOOSE) return null;
    const R = this.R, C = R.court, g = R.gravity, BP = R.ballPhys, fr = this.stage.friction;
    const rom = this.stage.bounceShift >= BP.romMinShift;
    let { x, y, z, vx, vy, vz } = b;
    if (BP.rom && !this.tip.on) { // stepRomLoose 와 같은 식
      for (let i = 0; i < 1500; i++) {
        if (z === 0 && vz === 0 && vx === 0 && vy === 0 && (i > 0 || b.still > 0)) return (this.restC = this.settledPos(x, y));
        vz -= g; x += vx; y += vy; z += vz;
        const fx = Math.floor(x / ONE), fy = Math.floor(y / ONE);
        if (fx < C.xMin || fx >= C.xMax) { x = px(fx < C.xMin ? C.xMin : C.xMax); vx = (-vx) >> 2; }
        if (fy < C.yMin || fy >= C.yMax) { y = px(fy < C.yMin ? C.yMin : C.yMax); vy = (-vy) >> 1; }
        if (z < 0) {
          vx >>= 1; if (vx === -1) vx = 0;
          vy >>= 1; if (vy === -1) vy = 0;
          let v = -vz; v -= v >> this.stage.bounceShift;
          if (v <= g) v = 0;
          vz = v; z = 0;
        }
      }
      return null;
    }
    for (let i = 0; i < 1500; i++) {
      if (z === 0 && vz === 0 && vx === 0 && vy === 0) return (this.restC = this.settledPos(x, y));
      x += vx; y += vy;
      if (z > 0 || vz > 0) { if (rom) { vz -= g; z += vz; } else { z += vz; vz -= g; } }
      if (x < px(C.xMin)) { x = px(C.xMin); vx = Math.trunc(-vx / 2); } else if (x > px(C.xMax)) { x = px(C.xMax); vx = Math.trunc(-vx / 2); }
      if (y < px(C.yMin)) { y = px(C.yMin); vy = Math.trunc(-vy / 2); } else if (y > px(C.yMax)) { y = px(C.yMax); vy = Math.trunc(-vy / 2); }
      if (z <= 0 && vz < 0) {
        z = 0;
        const v = -vz - ((-vz) >> this.stage.bounceShift);
        vx = Math.trunc(vx / 2); vy = Math.trunc(vy / 2);
        vz = v < (rom ? BP.romSettleVz : BP.settleVz) ? 0 : v;
      }
      if (z === 0 && vz === 0) {
        const sp = Math.hypot(vx, vy);
        if (sp > 0) {
          const k = Math.max(0, sp - fr) / sp;
          vx = Math.trunc(vx * k); vy = Math.trunc(vy * k);
          if (Math.abs(vx) < 64 && Math.abs(vy) < 64) vx = vy = 0;
        }
      }
    }
    return null;
  }

  /** 느슨한 공의 (예상) 정지 구역: 좌석 기준 0 내야/없음, 1~3 외야. 예측 실패 시 현재 위치 기준 */
  looseZone(seat) {
    if (this.ball.mode !== BM.LOOSE) return 0;
    const r = this.predictRest();
    return r ? this.ballZone(seat, r.x, r.y) : this.ballZone(seat);
  }

  autoPickup() {
    const b = this.ball;
    let best = null, bd = Infinity;
    for (const p of this.players) {
      if (!this.R.autoPickup.human && this.humans[p.seat] && p.pid === this.sides[p.seat].ctrl) continue; // 사람 조작 선수는 A 로만 줍는다 [확인]
      if (!this.usable(p) || (p.st !== ST.IDLE && p.st !== ST.BRAKE && p.st !== ST.DASH)) continue;
      const d = Math.max(Math.abs(p.x - b.x), Math.abs(p.y - b.y));
      // 컴퓨터 외야는 레벨별 줍기 반경(cpu.levels.N.outReach, 없으면 기본 reach)
      const reach = px(p.role === 'out' && this.aiTune[p.seat]?.outReach ? this.aiTune[p.seat].outReach : this.R.autoPickup.reach);
      // 줍기 도달 범위: 원작 줍기 판정(히트박스 11 대 공, |dx|<=22·|dy|<=20)을 만족하면 가능 [확인 0x74E0/0x6C44]. 종전 12px 는 [추정]이라 하단 외야 띠 위쪽(y 220~225)의 공을 아무도 못 주웠다
      const ok = d <= reach || (this.R.hitboxZ && this.grabTouch(p));
      if (ok && (d < bd || (d === bd && this.rng.next() & 1))) { bd = d; best = p; }
    }
    if (best) { this.giveBall(best); this.emit('receive', { p: best.pid }); }
  }

  /**
   * 소프트락 안전망(rules.stall): 정지한 공이 주워지지 않고 nudgeFrames 지속되면 가장 가까운 선수의 이동 범위 안 가장 가까운 지점으로 옮기고,
   * giveFrames 까지도 그대로면 그 선수에게 직접 준다. 난수·시계 무관(서든데스 포함). 사람 대전에서도 같은 규칙.
   */
  stallGuard() {
    const S = this.R.stall, b = this.ball;
    if (!S || (b.still !== S.nudgeFrames && b.still !== S.giveFrames)) return;
    let best = null, bd = Infinity;
    for (const p of this.players) { // pid 오름차순 순회 + 엄격한 < 비교 -> 동거리는 pid 낮은 쪽(결정적)
      if (!this.usable(p) || p.st === ST.HIT || p.st === ST.DOWN) continue;
      const q = this.bounds(p);
      const d = Math.max(Math.abs(Math.min(Math.max(b.x, q.x0), q.x1) - b.x), Math.abs(Math.min(Math.max(b.y, q.y0), q.y1) - b.y));
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    if (b.still === S.giveFrames) { this.giveBall(best); this.emit('receive', { p: best.pid }); this.emit('stall_give', { p: best.pid }); return; }
    const q = this.bounds(best);
    b.x = Math.min(Math.max(b.x, q.x0), q.x1); b.y = Math.min(Math.max(b.y, q.y0), q.y1);
    this.emit('stall_nudge', { p: best.pid });
  }

  /** 투구 비행 중 방향키 궤적 보정 [확인 구조 0xA46A] */
  steer() {
    const b = this.ball, T = this.R.throw;
    const th = this.players[b.thrower];
    if (!th || !this.humans[th.seat]) return;
    const bits = this.sides[th.seat].bits;
    const fwd = th.seat === 0 ? BIT.RIGHT : BIT.LEFT, back = th.seat === 0 ? BIT.LEFT : BIT.RIGHT;
    if (bits & BIT.UP) b.vy -= T.steerUp;
    if (bits & BIT.DOWN) b.vy += T.steerUp;
    if (bits & fwd) b.vz += T.steerFwd;
    if (bits & back) b.vz -= T.steerBack;
  }

  /**
   * 투구·패스 공과 선수의 충돌 = 원작 직역. 원작은 공이 아니라 각 선수 핸들러가 판정한다(객체 순서 = 선수 번호 순, 먼저 닿은 선수가 처리하면 공 상태가 바뀌어 끝).
   * - 피격(0x847C): 공이 위험 상태(공 $3 & 0xC0: 투구 bit6 또는 패스 bit7)이고 던진 사이드가 다를 때, 선수 히트박스($4: 서기·걷기·대시·캐치 자세 1, 웅크림 3, 점프 8 — 애니 갱신이 판정 뒤라 한 프레임 늦게 바뀜)와 공 히트박스(2)가 겹치면(0x6C44) 피격.
   *   패스 공도 상대에게 닿으면 피격이다(위력 3 = 0x72B6, 데미지 max(0, 3-방어)·넉백 0x851C). 판정을 부르는 핸들러: 걷기(0x709E), 점프(0x70CE), 대시·제동(속도 0 이 아닐 때, 0x7130/0x7646), 웅크림(0x74A6).
   *   투구·패스 동작, 줍기, 공중 차지, 캐치 후 밀림, 선 이탈 핸들러는 부르지 않는다. 컴퓨터형 핸들러 가운데 판정을 부르지 않는 것(이동 서브 8/0x10, plan 0, 웅크림·점프·옆걸음 대기)은 ai.js 가 aiNoHit 로 표시한다
   * - 캐치 자세(서브 0x14: 사람 0x7350~0x73A0, 컴퓨터 활성 0xC86C -> 0x7392, 강제 회수 0x968C -> 0x7392 모두 같은 규칙): 같은 겹침 검사(날아오는 공에는 현재 히트박스 그대로)에서 닿으면
   *   공 주축(마지막 투구 각도 플래그 $72 bit2: 0=좌우, 1=상하. 패스는 각도를 갱신하지 않는다)의 방향 비트를 비교(0x8416): 공 방향 비트(속도 부호, 0xA85C)와 선수 방향 비트($3 bit0/bit1)가 같으면(= 공에 등을 돌림) 피격(0x84AC), 다르면 캐치.
   *   자세 타이머에 따른 성공 창은 없다(0x8CF0 은 필살기 차지 판정 0x8C0E·성적 집계 0x8C5A 에서만 불린다)
   * - 컴퓨터 선수의 방향: 대기·방어 대기 핸들러가 매 프레임 공 쪽을 본다(0x8E50: 수동 내야 0x8D3E, 활성 plan 0x34/0x38 의 0xC402/0xC47C, 외야 0x914E). 캐치 자세에 들어간 뒤에는 방향을 바꾸지 않는다(0xC86C 에 0x8E50 호출 없음)
   */
  hitCheck() {
    for (const q of this.players) if (this.hitOne(q)) return;
  }

  /** 선수 한 명의 피격·캐치 판정. 반환 true = 공 상태가 바뀜. 직역 투구·패스 공은 stepPlayers 가 선수 갱신 직후 선수 번호 순으로 부른다(원작처럼 뒤 번호 선수의 핸들러가 같은 프레임에 바뀐 상태를 본다) */
  hitOne(q) {
    const R = this.R, b = this.ball, H = R.hitboxIdx;
    if (this.result || this.timeHold) return false; // 승패 확정 후엔 피격·캐치 판정 없음(공 물리만 연출). こうしき TIME UP·PLAY OFF 정지 구간(timeHold)도 같다: 선수 오브젝트가 돌지 않아 판정 핸들러가 불리지 않는다 [판독 ROM 0x612C/0x618A]
    const ts = this.players[b.thrower].seat, pass = b.mode === BM.PASS;
    const romDir = !!(R.cpu.rom && this.data.rom) || !!R.move.rom;
    {
      if (q.seat === ts || !this.hittable(q) || q.tipJ || q.recv) return false;
      const hs = q.stH ?? q.st;
      if (hs === ST.CATCH) {
        if (!this.boxHit(q, q.hbC ?? H.stand)) return false;
        const ok = romDir && (pass || b.ang)
          ? (b.ang && b.ang.fl & 4 ? !!b.d1 !== q.back : !!b.d0 !== (q.face < 0))
          : b.vx * q.face <= 0 && q.tm <= 15 - R.catch.windowAdj; // 방향 정보가 없는 공(포메이션 엔드 어택 등 비직역 투구)만 종전 규칙
        if (!ok) { this.hitPlayer(q); return true; }
        if (pass) { this.giveBall(q); this.emit('receive', { p: q.pid, steal: 1 }); this.acquireSwitch(q); return true; } // 패스 공: 밀림·받아치기 창 없음(0x7408 bit6 검사, 0x8CE2)
        const sk = b.kind;
        const dir = sgn(b.vx) || -q.face;
        this.emit('catch', sk ? { p: q.pid, by: b.thrower, kind: sk } : { p: q.pid, by: b.thrower });
        this.trCatch(q);
        if (q.fl) q.flCatch = 1; // flame: 캐치 후 첫 투구 위력 보너스 대기(투구·필살 공을 캐치 자세로 잡은 것만)
        const pw = b.power, ang = b.ang, spd8 = b.spd8;
        this.giveBall(q);
        if (sk) b.b6f = this.f; // 필살 공을 잡은 프레임: 이 프레임의 뒤 번호 수동 내야는 아직 투구 공 표시(공 $3 bit6)를 본다(ai.js passiveRom) [실측 ctr_special f64]
        if (ang && this.data.rom && R.catch.rom) {
          // [직역 ROM 0x7400~0x7448] 지상에서 투구(필살기 포함)를 잡으면 뒤로 밀린다: 속력 (min(위력,60)+8)/16 px/f 에서 시작해 마찰만큼 감속, 방향 = 공이 날아온 각도.
          // 공에는 받아치기 창 60프레임(0x8CDC): 그 안에 지상에서 던지면 잡은 공의 위력·속력 그대로
          if (!(q.z > 0 || q.vz !== 0)) { q.slideV = (Math.min(pw, R.catch.rom.slideCap) + R.catch.rom.slideBase) << 4; if (q.fl) q.slideV = flSlide(q, q.slideV); q.slideA = ang; q.vx = 0; q.vy = 0; q.slideMir = q.face < 0; q.slideRun = false; }
          b.ctr = this.tr ? 0 : R.catch.rom.counterFrames; b.cpow = pw; b.cspd = spd8; // 특훈은 받아치기 창(글로우)이 없다 [판독만 ROM 0xA3E6]
          b.cid = sk ? sk - 1 : null; // 잡은 필살 공의 ID(공 $14). 창 안에 던지면 같은 ID 의 필살 슛(romThrow, 0x8C08)
        } else if (sk) this.slideCatcher(q, dir, pw);
        this.acquireSwitch(q);
        return true;
      }
      const chk = hs === ST.IDLE || hs === ST.CROUCH || (hs === ST.JUMP && !q.charging && !q.wind) || ((hs === ST.DASH || hs === ST.BRAKE) && q.vx !== 0 && q.chkV);
      if (!chk || q.aiNoHit || q.t44 || q.slideV > 0 || !this.boxHit(q, q.hbC ?? H.stand)) return false;
      this.hitPlayer(q);
      return true;
    }
  }

  /** 필살기를 받은 선수가 뒤로 미끄러짐: min(위력,60)+8 px [확인 0x73AC]. 감속 마찰로 정확히 그 거리만큼 가는 초기속도. 비직역 경로(R.catch.rom 이 꺼진 경우)라 받아치기 창·받아치기 필살은 없다(직역 경로는 hitOne·romThrow) */
  slideCatcher(q, dir, power) {
    const L = this.R.special, a = this.stage.friction;
    const d = px(Math.min(power, L.catchSlideCap) + L.catchSlideBase);
    const v = Math.round(a * (-0.5 + Math.sqrt(0.25 + (2 * d) / a)));
    q.vx = dir * (q.fl ? flSlide(q, v) : v); q.vy = 0; q.slide = 1;
  }

  hitPlayer(q) {
    const R = this.R, b = this.ball;
    b.lastHit = q.pid; q.grace = true; // 공 $3C = 맞은 선수, 선수 $6D = 1(유예 표시) [직역 ROM 0x84AC/0x850E: 규칙과 무관하게 쓰고, こうしき 의 쓰러짐 종료만 읽는다]
    let dmg = this.official ? 0 : q.slot < 4 ? Math.max(0, b.power - q.stat.def) : 0; // こうしき 는 데미지 0 [직역 ROM 0x853E, 확인 HP 불변] // 외야(슬롯>=4)는 맞아도 HP 가 줄지 않는다 [직역 ROM 0x84B8]
    if (q.fl) { if (dmg > 0) dmg = flHitDmg(this, q, b.power, dmg); q.flCatch = 0; q.flPassSpd = 0; } // flame: HP 30% 이하 방어·치사 생존. 맞으면 대기 중인 투구 보너스는 사라진다
    const hp0 = q.hp;
    q.hp = Math.max(0, q.hp - dmg);
    if (hp0 > 0 && q.hp === 0 && !this.tr) this.refOut(q); // HP 0 순간 심판 호출(인원 감소와 별개 시점) [확인 f250]
    this.emit('hit', b.kind ? { p: q.pid, by: b.thrower, dmg, hp: q.hp, kind: b.kind } : { p: q.pid, by: b.thrower, dmg, hp: q.hp });
    q.charging = false; q.plan = null; q.wind = null; q.slideV = 0;
    if (q.hasBall) q.hasBall = false;
    // 맞는 순간의 타이머($18) 값은 피격·쓰러짐 착지 프레임까지 그대로 남는다(동작에는 영향 없음, 트레이스 대조용). 원작은 $18 한 칸을 자세 타이머와 컴퓨터형 두뇌 타이머(내야 대기 60 / 외야 자리 이동 120)가 같이 쓴다:
    // 사람이 조작으로 넘겨받은 선수도 두뇌 타이머 값이 그대로 남아 있다 [실측 atk_p4 f176 p3 = 19, out_fetch_top f88 p2 = 30].
    // [근사] 엔진은 이 칸을 p.tm / cb.tm / ob.t 로 나눠 갖는다: 자세(캐치·웅크림·줍기) 중에 맞으면 자세 타이머, 그 밖에는 두뇌 타이머로 본다. 사람이 넘겨받은 뒤 자세를 한 번 취하고 나서 맞은 경우는 다를 수 있다
    q.tmLeft = q.stH === ST.CATCH || q.stH === ST.CROUCH || q.stH === ST.PICKUP ? q.tm : q.role === 'out' && !q.cb?.act ? q.ob?.t ?? q.tm : q.cb?.tm ?? q.tm;
    q.st = ST.HIT; q.dashFlag = false;
    this.endSpecial();
    if (R.hit.rom && this.data.rom && (b.ang || b.romPass)) {
      // [직역 ROM 0x851C, 0x84DC~0x84EA. 실측 analysis/21 §5] 피격자: 공이 날아온 각도로 속력 위력/16 px/f, vz 4.0. 공: vx = -(피격자 vy >> 3), vy = 0, vz 3.0 (거의 제자리에서 위로 튄다)
      const ha = b.ang ?? { i: 0, fl: 0 };
      const v = romDecomp(this.data.rom.trig, ha.i, ha.fl, (b.power << 4) & 0xffff);
      q.vx = v[0]; q.vy = v[1]; q.vz = R.hit.knockVz;
      b.vx = -(v[1] >> 3); b.vy = 0;
    } else {
      q.vx = Math.trunc(b.vx / R.hit.knockVxDiv); q.vy = Math.trunc(b.vy / R.hit.knockVxDiv); q.vz = R.hit.knockVz; q.z = Math.max(q.z, 1);
      b.vx = Math.trunc(-b.vx / 2); b.vy = Math.trunc(-b.vy / 2);
    }
    if (q.fl) { q.vx = flKnock(q, q.vx); q.vy = flKnock(q, q.vy); } // flame R1: 수평 넉백만 줄인다(vz 4.0·공의 튕김은 줄이기 전 값 그대로)
    b.mode = BM.LOOSE; b.holder = -1; b.vz = R.hit.ballBounceVz; b.still = 0; b.rom = false; b.steer = 0; b.romPass = false;
    q.t44 = null; q.recv = null;
    this.hitSwitch(q);
  }

  // ---- 아웃·교체·승패 ----
  /** 아웃(HP 0) 순간: 호루라기 이벤트 + 심판 콜 애니(관전 중일 때만 애니, 아웃 선수가 왼팀이면 좌우 반전) [확인 0xDA94 서브 0x18] */
  refOut(q) {
    const RF = this.R.start.ref, r = this.ref;
    this.emit('ref_out', { p: q.pid, seat: q.seat });
    if (r && !r.final && this.sq.s === SQ.WATCH) { r.call = RF.outCallFrames; r.flip = q.seat === 0 ? 1 : 0; this.setRefAnim(RF.anim.out_call); r.at = 0; }
  }

  startOut(q) {
    const R = this.R, side = this.sides[q.seat];
    side.remaining--;
    q.hasBall = false;
    const cands = this.players.filter((o) => o.seat === q.seat && o.role === 'out' && !o.dead && o.st !== ST.OUTMOVE);
    const o = cands.sort((a, c) => a.slot - c.slot)[0] ?? null;
    if (o) { // 슬롯 교환 [확인 0x8930]
      const qs = q.slot, os = o.slot;
      q.dead = true; q.role = 'out'; q.slot = os;
      o.role = 'in'; o.slot = qs;
      for (const [pl, slot] of [[q, os], [o, qs]]) {
        const [sx, sy] = this.slotPos(pl.seat, slot);
        pl.from = [pl.x, pl.y]; pl.to = [px(sx), px(sy)]; pl.tm = R.out.swapFrames; pl.st = ST.OUTMOVE; pl.vx = pl.vy = 0;
        if (this.romOut) { pl.hasBall = false; pl.t44 = null; pl.recv = null; pl.wind = null; pl.charging = false; }
      }
    } else if (this.romOut && [4, 7, 10].some((k) => this.players.some((x) => x.seat === q.seat && x !== q && x.slot === k && !x.removed))) {
      // 교체할 외야가 없을 때 [직역 ROM 0x895A~0x89A6]: 상단·하단·후방 순으로 첫 슬롯(4/7/10)에 선수가 있는 띠를 찾아 그 선수를 다음 슬롯으로 옮기고, 아웃 선수는 그 다음 슬롯에 선다. 둘 다 아웃 이동(0x957E)
      const base = [4, 7, 10].find((k) => this.players.some((x) => x.seat === q.seat && x !== q && x.slot === k && !x.removed));
      const a2 = this.players.find((x) => x.seat === q.seat && x !== q && x.slot === base && !x.removed);
      a2.slot = base + 1; q.slot = base + 2; q.dead = true; q.role = 'out';
      for (const pl of [q, a2]) {
        const [sx, sy] = this.slotPos(pl.seat, pl.slot);
        pl.from = [pl.x, pl.y]; pl.to = [px(sx), px(sy)]; pl.tm = R.out.swapFrames; pl.st = ST.OUTMOVE; pl.vx = pl.vy = 0; pl.hasBall = false; pl.t44 = null; pl.recv = null; pl.wind = null; pl.charging = false;
      }
    } else { // 띠가 모두 비어 있는 경우의 원작 동작(0x897A: 교환 없이 제자리)은 미이식: 종전대로 퇴장
      q.dead = true; q.removed = true; q.st = ST.GONE; q.hp = 0; q.vx = q.vy = 0;
    }
    this.emit('out', { p: q.pid, swap: o ? o.pid : null, rem: [this.sides[0].remaining, this.sides[1].remaining] });
    if (this.sudden && !this.result) this.finish(1 - q.seat, 'sudden_death');
    else if (side.remaining <= 0 && !this.result) this.finish(1 - q.seat, 'annihilation');
  }

  finish(winner, reason) {
    if (this.result) return;
    this.result = { winner, reason, rem: [this.sides[0].remaining, this.sides[1].remaining] }; // 승패 확정 시점 인원 고정
    this.phase = 'end';
    this.endF = this.f;
    const E = this.R.start.end;
    this.endPre = reason === 'annihilation' || reason === 'sudden_death' ? E.gameSetDelay : 0; // 마지막 인원 감소 후 60f 정지 [확인]
    this.endHold = this.endPre + E.bannerFrames;
    if (this.fm) this.fmCancel('end');
    this.emit('end', { winner, reason });
    if (this.endPre === 0) this.beginEndBanner();
  }

  /** 외부(방)에서 기권/오류 등 강제 종료 */
  forceEnd(winner, reason) { this.finish(winner, reason); }

  checkTime() {
    if (this.clock >= this.capFrames) { this.finish(-1, 'draw_cap'); return; }
    if (this.limitFrames > 0 && !this.sudden && this.clock >= this.limitFrames) {
      this.emit('timeup');
      const [a, b] = [this.sides[0].remaining, this.sides[1].remaining];
      if (a !== b) this.finish(a > b ? 0 : 1, 'timeup');
      else if (this.official) { this.timeHold = 1; this.setBanner('time_up'); } // こうしき 동수: TIME UP 배너부터(stepTimeHold). 체력제 + 제한 시간(자작 조합)은 아래 종전 처리 그대로
      else { this.sudden = true; this.setBanner('play_off'); this.emit('sudden_death'); }
    }
  }

  /**
   * こうしき 시간 종료 동수 = PLAY OFF [직역 ROM 0x612C(상태 0x28) -> 0x618A(상태 0x2C) -> 0x61C2. 확인: 원작 실행 analysis/data/33_koushiki_oracle/timeup_freeze.txt, poke 29 §3-2]
   * TIME UP 배너 181프레임 -> PLAY OFF 배너 181프레임 동안 선수 오브젝트는 돌지 않는다(제자리·피격/캐치 판정 없음: hitOne 의 timeHold 가드). 끝나면 양쪽 남은 인원을 1 로 만들고 재개 -> 다음 아웃 1번으로 끝난다.
   * 공: TIME UP 구간(상태 0x28)은 공이 움직인다 [실측 timeup_freeze.txt: 181프레임 중 공 좌표 변화 95프레임, 선수 1프레임].
   *     PLAY OFF 구간(상태 0x2C)도 공 오브젝트가 돈다 [확인 원작 실행 analysis/data/33_koushiki_oracle/hold_stall.txt: 두 구간 모두 방치 카운터 $E25E 가 매 프레임 증가(0x2C 181프레임 중 175, 나머지는 30프레임 전환 프레임),
   *     카운터가 300 을 넘으면 정지 중에도 서브8 -> 강제 회수 타입 0x44 지정, 지정된 선수는 멈춰 있다가 재개 뒤 달려가 줍는다]. 엔진도 두 구간 모두 stepBall 을 돌린다(방치 카운터·30프레임 전환·강제 회수 지정 그대로).
   *     자작 안전망(t44MaxFrames 교착 해제, nudgeFrames/giveFrames 공 이동·지급)은 이 구간에 진행하지 않는다(stepRomLoose 의 timeHold 가드).
   * 미확인: 비직역 패스 수신(stepBall 의 giveBall, 포메이션 진행 중 시간 종료)은 정지 중에도 그대로 일어난다(원작 미조사).
   * 시계는 0:00 에 멈춘 채 다시 검사하지 않는다(this.sudden)
   */
  stepTimeHold() {
    const B = this.R.start.banners, t = this.timeHold++, a = B.time_up.life + 1, b = a + B.play_off.life + 1;
    this.stepBall();
    if (t === a) this.setBanner('play_off');
    else if (t >= b) {
      this.timeHold = 0; this.sudden = true;
      for (const s of this.sides) s.remaining = 1;
      this.emit('sudden_death', { rem: [1, 1] });
    }
  }

  // ---- 조작 선수 자동 전환 [확인 구조 0x88B8 + 추정] ----
  autoSwitch() {
    const b = this.ball;
    for (const s of this.sides) {
      if (!this.humans[s.seat] && !(this.R.ctrlSwitch.rom && this.data.rom)) { if (b.holder >= 0 && this.players[b.holder].seat === s.seat) s.ctrl = b.holder; continue; }
      const cur = this.players[s.ctrl];
      // 느슨한 공의 예상 정지 구역(굴러가는 중에도 마찰 시뮬로 선행 판정, analysis/15). 0=내야 또는 공이 느슨하지 않음
      // rom 모드: 느슨한 공에 따른 전환은 romSwitch(정지 후 30프레임 주기)만 한다. 선행 예측(looseZone)·매 틱 최근접 재평가는 원작에 없다
      const romSw = !!(this.R.ctrlSwitch.rom && this.data.rom);
      const zt = romSw ? 0 : this.looseZone(s.seat);
      const valid = (p) => p && ((p.role === 'in' && this.usable(p)) || p.hasBall || (p.role === 'out' && this.usable(p) && (romSw || (zt > 0 && slotGroup(p.slot) === zt)))) && (romSw || (p.st !== ST.HIT && p.st !== ST.DOWN && p.st !== ST.FOUL)); // 직역 모드: 피격·쓰러짐·선 이탈 중인 활성 선수는 다음 전환 시점까지 그대로(원작에 '쓸 수 없으면 바꾼다'는 규칙 없음)
      let nw = s.ctrl;
      if (b.holder >= 0 && this.players[b.holder].seat === s.seat) nw = b.holder;
      else if (b.mode === BM.FLY && this.players[b.thrower].seat !== s.seat && b.tgt >= 0 && this.players[b.tgt].seat === s.seat && b.id !== s.sw) {
        s.sw = b.id;
        if (valid(this.players[b.tgt])) nw = b.tgt;
      } else if (zt > 0) {
        // 공이 내 외야 구역에 (곧) 멈춘다 -> 정지를 기다리지 않고 그 구역 외야 선수로 선행 전환. 이미 그 구역 외야 선수면 유지(내야 최근접으로
        // 튀었다 돌아오는 깜빡임 방지). 정지 후에는 tickFrames 주기로 최근접 재평가 [원작 0x85CC 주기; 값은 rules.ctrlSwitch.tickFrames]
        const T = this.R.ctrlSwitch.tickFrames, rest = b.z === 0 && b.vx === 0 && b.vy === 0;
        const curOk = !!cur && cur.role === 'out' && valid(cur);
        if (!curOk || (rest && b.still >= T && (b.still - T) % T === 0)) {
          const r = this.predictRest() ?? b;
          let best = -1, bd = Infinity;
          for (let i = 0; i < 7; i++) {
            const q = this.players[s.seat * 7 + i];
            if (q.role !== 'out' || slotGroup(q.slot) !== zt || !this.usable(q) || q.dead || q.st === ST.HIT || q.st === ST.DOWN) continue;
            const d = Math.hypot(q.x - r.x, q.y - r.y);
            if (d < bd) { bd = d; best = q.pid; }
          }
          if (best >= 0) nw = best;
        }
      } else if (!valid(cur) || (!romSw && b.mode === BM.LOOSE && b.z === 0)) {
        const r = b.mode === BM.LOOSE ? this.predictRest() ?? b : b; // 내야: 굴러가는 공은 멈출 지점 기준 최근접
        const n = this.nearestInfield(s.seat, r.x, r.y, (p) => valid(p));
        if (n >= 0) {
          if (!valid(cur)) nw = n;
          else if (Math.hypot(this.players[n].x - r.x, this.players[n].y - r.y) + px(16) < Math.hypot(cur.x - r.x, cur.y - r.y)) nw = n;
        }
      }
      if (nw !== s.ctrl) { s.ctrl = nw; this.emit('ctrl', { seat: s.seat, p: nw }); }
    }
  }

  // ================= 포메이션 어택 (analysis/14_formation_cutin.md) =================
  fmTeam(teamId) { return this.data.formations?.teams.find((t) => t.team === teamId) ?? null; }
  /** 좌석의 포메이션 표. flame 좌석은 고른 패턴(sides.fmT), 그 밖은 좌석 팀(종전과 같다) */
  fmOf(seat) { const s = this.sides[seat]; return this.fmTeam(s.fmT ?? s.team); }

  /** 대기·패스 중 카메라 x 고정값(좌석별). 그 외 null */
  fmCam() { return this.fm && (this.fm.st === FM.HOLD || this.fm.st === FM.PASS) ? this.R.formation.cam[this.fm.seat] : null; }

  fmSnap() {
    const m = this.fm;
    return m ? { seat: m.seat, name: m.name, st: m.st, t: m.t, passes: m.passes, holder: m.holder } : null;
  }

  /** 발동 가능 여부(사람·CPU 공통): 공 보유자(내 편·지상·행동 가능), 남은 인원·횟수, 진행 중 포메이션 없음, 팀원이 날아가거나 쓰러져 있지 않음 */
  fmCanStart(seat) {
    const F = this.R.formation, s = this.sides[seat], b = this.ball;
    if (!this.fmOn || this.phase !== 'play' || this.result || this.tip.on || this.fm) return false;
    if (s.fmLeft <= 0 || s.remaining < F.minRemaining || !this.fmOf(seat)) return false;
    if (b.mode !== BM.HELD || b.holder < 0) return false;
    const h = this.players[b.holder];
    if (h.seat !== seat || h.charging || h.z > 0 || h.vz > 0 || !(h.st === ST.IDLE || h.st === ST.DASH || h.st === ST.BRAKE)) return false;
    return this.players.every((p) => p.seat !== seat || p.dead || (p.st !== ST.HIT && p.st !== ST.DOWN && p.st !== ST.OUTMOVE && p.z <= 0 && p.vz <= 0));
  }

  fmTarget(seat, slot) {
    const t = this.fmOf(seat), g = this.data.formations.slot_to_group[slot];
    return (seat === 0 ? t.pos_by_group : t.pos_by_group_mirror)[g];
  }

  fmStart(seat) {
    const s = this.sides[seat], t = this.fmOf(seat);
    s.fmLeft--; s.fmCnt = 0; s.fmPend = false;
    this.fm = { seat, team: s.team, name: t.name_idx, st: FM.GATHER, t: 0, passes: 0, holder: this.ball.holder, thrower: -1, fly: false, wait: 0, cpuOk: 0 };
    for (const p of this.players) {
      if (p.seat !== seat || p.dead) continue;
      p.st = ST.IDLE; p.tm = 0; p.vx = p.vy = 0; p.plan = null; p.charging = false; p.hold = 0; p.dashFlag = false; p.fmMove = true; p.wind = null; p.slideV = 0;
      p.fmTo = this.fmTarget(seat, p.slot);
    }
    this.emit('fm_start', { seat, team: s.team, name: t.name_idx, left: s.fmLeft });
  }

  /** 종료 공통 정리 */
  fmClear() {
    const seat = this.fm.seat;
    for (const p of this.players) if (p.seat === seat) { p.fmMove = false; p.fmTo = null; p.plan = null; }
    this.fm = null;
  }

  fmCancel(why) {
    const seat = this.fm.seat;
    this.fmClear();
    this.emit('fm_cancel', { seat, why });
  }

  /** 포메이션 중 팀원: 입력 무시, 이동·후딜 타이머만 서버가 처리 */
  fmFreeze(p, bits) {
    p.prev = bits;
    p.vx = p.vy = 0;
    if (p.st === ST.PASS && --p.tm <= 0) p.st = ST.IDLE;
    if (this.fm.st !== FM.GATHER || !p.fmTo) return;
    const F = this.R.formation, [tx, ty] = p.fmTo, dx = tx - toPx(p.x), dy = ty - toPx(p.y), d = Math.hypot(dx, dy);
    const spd = F.gatherBase + p.stat.spd / F.gatherDiv;
    // 집합 이동(타입 0x7C) 방향 [직역 ROM 0x9C72 -> 0x7868 / 도착 뒤 0x9CA6 -> 0x9D04: x >= 256 이면 왼쪽, y >= 128 이면 뒷모습]
    if (d <= spd) { p.x = px(tx); p.y = px(ty); p.fmMove = false; p.face = tx >= 256 ? -1 : 1; p.back = ty >= 128; }
    else { p.x += Math.round((dx / d) * spd * ONE); p.y += Math.round((dy / d) * spd * ONE); p.face = dx < 0 ? -1 : dx > 0 ? 1 : p.face; if (dy !== 0) p.back = dy < 0; else if (dx !== 0) p.back = false; p.fmMove = true; }
  }

  /** 순환표의 다음 수신자: 현재 슬롯의 그룹 -> 다음 슬롯 번호 -> 그 슬롯(없으면 같은 그룹)의 생존자. 없으면 표를 따라 건너뜀 */
  fmNextReceiver(from) {
    const F = this.data.formations, t = this.fmOf(this.fm.seat);
    const mates = this.players.filter((q) => q.seat === from.seat && q !== from && !q.dead && this.usable(q));
    let slot = from.slot;
    for (let i = 0; i < 7; i++) {
      slot = t.pass_next_slot_by_group[F.slot_to_group[slot]];
      const g = F.slot_to_group[slot];
      const q = mates.find((m) => m.slot === slot) ?? mates.find((m) => F.slot_to_group[m.slot] === g);
      if (q) return q;
    }
    // 표 순환이 살아 있는 선수에게 닿지 못한 경우(예: 4명 남아 전원 내야 슬롯인데 표가 외야 슬롯만 순환): 슬롯 번호 순으로 다음 생존자 [추정 폴백]
    const byslot = mates.sort((a, c) => a.slot - c.slot);
    return byslot.find((q) => q.slot > from.slot) ?? byslot[0] ?? null;
  }

  /** 자동 패스: 속도 passSpeed px/f 고정. 패스 공은 FLY 가 아니라 상대가 맞거나 가로챌 수 없다 */
  fmPass(p) {
    const F = this.R.formation, b = this.ball, q = this.fmNextReceiver(p);
    if (!q) { this.fmCancel('no_receiver'); return; }
    p.face = q.x < p.x ? -1 : 1;
    b.x = p.x + p.face * px(this.R.throw.handDx); b.y = p.y; b.z = p.z + px(this.R.throw.handZ);
    b.mode = BM.PASS; b.holder = -1; b.thrower = p.pid; b.tgt = q.pid; b.power = this.R.pass.power; b.kind = 0; b.sp = null; b.id = ++this.throwId;
    b.vx = b.vy = b.vz = 0; b.passSpeed = px(F.passSpeed); b.romPass = false;
    p.hasBall = false; p.charging = false; p.hold = 0; p.st = ST.PASS; p.tm = this.R.throw.passRecoverFrames;
    this.fm.fly = true;
    this.emit('pass', { p: p.pid, tgt: q.pid, fm: 1 });
  }

  /** 엔드 어택 개시: 수신자가 점프(일반 물리), 최고점에서 fmEndThrow */
  fmBeginEnd(p) {
    const m = this.fm;
    m.st = FM.END; m.t = 0; m.thrower = p.pid; p.fmMove = false;
    p.vz = this.R.jump.base + (p.stat.s3 << this.R.jump.s3Shift);
    p.st = ST.JUMP;
    this.emit('jump', { p: p.pid });
  }

  /** 엔드 어택 투구: 위력 s4*4, 속도 s6/16+4 px/f, 필살기 판정 없음(doThrow 의 fm 옵션) */
  fmEndThrow(p) {
    const F = this.R.formation, T = this.R.throw, seat = this.fm.seat;
    const cur = this.players[this.sides[1 - seat].ctrl]; // 상대 현재 활성 선수 [코드 0x9A86]
    const target = cur && cur.seat !== seat && this.targetable(cur) ? cur : this.pickTarget(p, 0);
    const power = p.stat.pow * F.endPowerMul, speed = (p.stat.thr << T.speedShift) + px(F.endSpeedBonus);
    this.doThrow(p, 0, false, { target, power, speed });
    this.emit('fm_end', { seat, p: p.pid, tgt: this.ball.tgt, pw: power });
    this.fmClear();
  }

  stepFormation() {
    if (!this.fmOn) return;
    const F = this.R.formation, b = this.ball;
    if (!this.fm) {
      // CPU 발동: 공을 잡을 때마다 팀 문턱 도달 시 약 50% [확인 0xD948]
      if (b.mode !== BM.HELD) this.fmLast = -1;
      else if (b.holder !== this.fmLast) {
        this.fmLast = b.holder;
        const h = this.players[b.holder], s = this.sides[h.seat];
        s.fmPend = false;
        // 직역 두뇌(rules.cpu.rom)에서는 컴퓨터 발동 판정(0xD948)을 ai.js attackRom 이 plan 0 결정 때 한다(난수 순서 유지)
        if (!(this.R.cpu.rom && this.data.rom) && !this.humans[h.seat] && this.fmOf(h.seat) && ++s.fmCnt >= this.fmOf(h.seat).cpu_threshold) { s.fmCnt = 0; s.fmPend = true; }
      }
      for (const s of this.sides) {
        if (s.fmPend && b.mode === BM.HELD && this.players[b.holder].seat === s.seat && this.fmCanStart(s.seat)) {
          s.fmPend = false;
          if (this.rng.int(256) <= F.cpuRoll256) { this.fmStart(s.seat); return; }
        }
      }
      // 사람 발동: Start(입력 bit7) 한 번, YES/NO 창 없음 [사용자 결정]
      for (const s of this.sides) {
        if (this.humans[s.seat] && this.sEdge[s.seat] && this.fmCanStart(s.seat)) { this.fmStart(s.seat); return; }
      }
      return;
    }
    const m = this.fm, seatP = this.players.filter((p) => p.seat === m.seat && !p.dead);
    m.t++;
    if (m.st === FM.GATHER) {
      if (b.mode !== BM.HELD || b.holder !== m.holder) { this.fmCancel('ball_lost'); return; }
      if (seatP.every((p) => !p.fmMove)) { m.st = FM.HOLD; m.t = 0; }
    } else if (m.st === FM.HOLD) {
      if (b.mode !== BM.HELD || b.holder !== m.holder) { this.fmCancel('ball_lost'); return; }
      if (m.t >= F.holdFrames) { m.st = FM.PASS; m.t = 0; m.wait = 0; this.emit('fm_ready', { seat: m.seat }); }
    } else if (m.st === FM.PASS) {
      if (!m.fly) {
        if (b.mode !== BM.HELD || this.players[b.holder]?.seat !== m.seat) { this.fmCancel('ball_lost'); return; }
        if (m.wait-- <= 0) this.fmPass(this.players[b.holder]);
      } else if (b.mode === BM.HELD && this.players[b.holder].seat === m.seat) { // 수신 순간 판정
        const r = this.players[b.holder];
        m.fly = false; m.holder = r.pid; m.passes++; m.wait = F.passInterval;
        let end = m.passes >= F.maxPasses;
        if (this.humans[m.seat]) end = end || (this.sides[m.seat].bits & BIT.B) !== 0;
        else if (this.rng.int(256) < F.cpuEndChance256 && ++m.cpuOk >= F.cpuEndNeed) end = true;
        if (end) this.fmBeginEnd(r);
      } else if (b.mode !== BM.PASS) { this.fmCancel('ball_lost'); return; }
    } else { // END
      const p = this.players[m.thrower];
      if (!p.hasBall || b.mode !== BM.HELD) { this.fmCancel('ball_lost'); return; }
      if (p.vz <= 0 || p.st !== ST.JUMP || m.t >= F.endTimeout) this.fmEndThrow(p);
    }
  }

  // ================= 스냅샷 =================
  snapshot(withEvents = true) {
    const q = (v) => Math.round(v / 4096); // 1/16 px
    // 선수 배열(길이 11): [0]x [1]y [2]z [3]st [4]hp [5]slot [6]플래그 [7]charge [8]face [9]입장 보행 [10]포메이션 집합 이동
    // 플래그 bit7 = 뒤 보기(원작 $3 bit1), face = 좌우(원작 $3 bit0): 캐치 성공 여부가 이 방향으로 정해진다
    // 단 캐치 후 밀림(bit6) 중엔 그려지는 방향을 보낸다(밀림 핸들러 0x74FA 는 $3 을 밀리는 속도 쪽으로 바꾼다(0x7868) [직역]):
    //  face = 스프라이트 반전($2 bit7) = 잡은 순간의 좌우(0x8466 을 부르지 않음, 공 손 위치 slideMir 와 같은 값),
    //  bit7 = 애니 앞뒤: 0x8870 은 $3 bit1 이 서 있으면 0x20(앞), 아니면 0x22(뒤)로 반대로 고른다. 잡은 프레임(핸들러가 아직 안 돎)은 캐치 자세 그대로
    //  -> 공이 온 쪽을 본 채 밀린다 [확인: 오라클 cpu_def_a f74~f86, ctr_special f64~f97 는 밀리는 동안 $3=0x10 인데 애니 0x22 유지]
    const slid = (o) => o.slideV > 0 && o.slideMir !== undefined;
    const p = this.players.map((o) => [
      q(o.x), q(o.y), q(o.z), o.st, o.hp, o.slot,
      (o.charging || (o.wind && o.st === ST.JUMP) ? 1 : 0) | (o.dashFlag ? 2 : 0) | (o.role === 'out' ? 4 : 0) | (o.dead ? 8 : 0) | (o.hasBall ? 16 : 0) | (o.swing > 0 ? 32 : 0) | (o.slideV > 0 ? 64 : 0) | ((slid(o) && o.slideRun ? !o.back : o.back) ? 128 : 0), o.charge,
      slid(o) ? (o.slideMir ? -1 : 1) : o.face,
      o.en ? 1 : 0, o.fmMove ? 1 : 0,
    ]);
    const b = this.ball;
    return {
      t: 'snap', f: this.f, ph: this.phase,
      clk: this.sudden ? 0 : Math.max(0, this.limitFrames - this.clock), sd: this.sudden,
      rem: [this.sides[0].remaining, this.sides[1].remaining],
      ctrl: [this.sides[0].ctrl, this.sides[1].ctrl], aim: [this.sides[0].aim, this.sides[1].aim],
      p, b: [q(b.x), q(b.y), q(b.z), b.mode, b.holder, b.power, b.kind],
      lock: this.phase === 'ready' ? 1 : 0, sq: [this.sq.s, this.sq.t], cam: this.fmCam() ?? (this.sq.s < SQ.WATCH ? 96 : null),
      fm: this.fmSnap(), fmLeft: [this.sides[0].fmLeft, this.sides[1].fmLeft],
      ref: this.ref ? [Math.round(this.ref.x * 16), Math.round(this.ref.y * 16), this.ref.anim, this.ref.at, this.ref.flip] : null,
      ban: this.bannerSnap(),
      tip: this.tip.on ? [this.tip.tossed ? 1 : 0, this.tip.fg[0] ? 1 : 0, this.tip.fg[1] ? 1 : 0] : null,
      ...(this.tr ? { tr: this.trSnap() } : {}), // 특훈일 때만(일반 경기 스냅샷에는 키가 없다)
      ev: withEvents ? this.drainEvents() : [],
    };
  }

  bannerSnap() {
    const bn = this.banner;
    if (!bn) return null;
    const age = this.f - bn.f0, life = this.R.start.banners[bn.k].life;
    return life > 0 && age >= life ? null : [bn.k, age, life];
  }

  /** flame 좌석의 game_start 팀 정보(PROTOCOL §12.2): 능력치 = 주입된 최종값, role = 라인업 자리 기준, from = 출신(스프라이트·얼굴·말풍선), hp0 = 시작 현재 HP, sp = 슬롯, spOn = 지금 발동되는 ID */
  flameTeamInfo(s) {
    const fl = this.fls[s.seat];
    const ROLE = ['infield', 'infield', 'infield', 'infield', 'outfield_top', 'outfield_bottom', 'outfield_back'];
    return {
      id: s.team, name: s.teamData.name, flame: true,
      players: fl.roster.map((r, i) => {
        const pl = r.stat;
        return { idx: i, role: ROLE[i], hp: pl.hp, def: pl.def, spd: pl.spd, s3: pl.s3, pow: pl.pow, s5: pl.s5, thr: pl.thr, pass: pl.pass, from: { team: r.from.team, idx: r.from.idx }, hp0: r.hp, r1: r.r1, r2: r.r2, down: r.down, sp: r.sp.slice(), spOn: flActiveId(fl, { fl: r }) };
      }),
    };
  }

  /** game_start 용 정적 정보 */
  info() {
    const R = this.R;
    return {
      seed: this.seed, tickRate: R.tickRate, snapEvery: R.snapEvery,
      ...(this.tr ? { training: { kind: this.tr.kind, step: this.tr.step, balls: this.data.training[this.tr.kind].balls, pass: this.data.training[this.tr.kind].pass, steps: this.data.training[this.tr.kind].steps.length, ...(this.tr.kind === 'special' ? { gauge: { max: R.throw.maxCharge, ok: [R.special.minCharge, R.special.maxCharge], hold: this.data.training.special.gaugeHold } } : {}) } } : {}),
      stage: { id: this.stageInfo.id, key: this.stageInfo.key, file: this.stageInfo.file, json: this.stageInfo.json, romStage: this.stageInfo.romStage },
      teams: this.sides.map((s) => (this.fls[s.seat] ? this.flameTeamInfo(s) : {
        id: s.team, name: s.teamData.name,
        players: s.teamData.players.map((pl) => ({ idx: pl.idx, role: pl.role, hp: pl.hp, def: pl.def, spd: pl.spd, s3: pl.s3, pow: pl.pow, s5: pl.s5, thr: pl.thr, pass: pl.pass })),
      })),
      ...(this.fl ? { flame: this.fls[0] && this.fls[1] ? { seats: this.fls.map(flInfo) } : flInfo(this.fl) } : {}), // flame 일 때만(일반 경기 game_start 에는 키가 없다). 두 좌석 경기 = {seats:[좌석 0, 좌석 1]}(D53)
      court: { ...R.court, slots: this.data.court.slots.map((s) => ({ slot: s.slot, a: s.a, b: s.b })) },
      rules: {
        limitFrames: this.limitFrames, mode: this.ruleMode, readyFrames: this.readyFrames, start: R.start, maxCharge: R.throw.maxCharge,
        holdMaxFrames: R.holdMaxFrames, catchWindowAdj: R.catch.windowAdj, crouchFrames: R.crouchFrames,
        swapFrames: R.out.swapFrames, downFrames: R.hit.downFrames,
        formation: this.fmOn ? {
          enabled: true, uses: R.formation.uses, startBit: BIT.S, holdFrames: R.formation.holdFrames, passSpeed: R.formation.passSpeed,
          passInterval: R.formation.passInterval, maxPasses: R.formation.maxPasses, cam: R.formation.cam,
          names: this.sides.map((x) => this.fmOf(x.seat)?.name_idx ?? -1),
        } : { enabled: false },
      },
    };
  }
}
