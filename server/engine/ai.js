// 컴퓨터형 선수(사람이 조작하지 않는 선수 전부)의 1프레임 입력·이동을 만든다.
// rules.cpu.rom 이 켜져 있으면(현행) 원작 핸들러 직역 경로만 돈다: 수동 내야 passiveRom(0x8D02) / 활성 내야 activeRom·attackRom(0xBBE8) / 외야 outfieldRom(0x9128/0x92A8)·outActiveRom(0xCCE8) / 강제 회수 retrieveRom(0x9590).
// 근거 수준([확인]/[판독]/[판독만]/[근사]/[자작])은 analysis/25_cpu_brain.md §3·§9. [판독만] = ROM 을 읽어 옮겼지만 하네스 시나리오에 나오지 않아 원작 트레이스로 확인하지 못한 분기.
// 선수 파라미터 cfg(b0..b15): b0·b1 투구/패스 선택, b2..b5 투구 종류, b6..b8 패스 종류, b9..b12 방어 5택, b13 대기 프레임, b14 대시 점프 선택, b15 받아치기.
// 직역 경로가 꺼졌을 때(rom=false)와 포메이션·점프볼 중의 보유자는 파일 끝의 종전 자작 규칙(chaseMove/idlePoint/moveToward 등 [추정])을 쓴다.
import { BIT, ST, BM, ONE, slotGroup } from './consts.js';
import { romAngle, romDecomp } from './match.js';
import { boostOf, bumpSpecial } from './boost.js';

const toPx = (v) => v / ONE;
const px = (v) => Math.round(v * ONE);

function moveToward(p, tx, ty, dead = 3) {
  let bits = 0;
  const dx = toPx(tx - p.x), dy = toPx(ty - p.y);
  if (dx > dead) bits |= BIT.RIGHT; else if (dx < -dead) bits |= BIT.LEFT;
  if (dy > dead) bits |= BIT.DOWN; else if (dy < -dead) bits |= BIT.UP;
  return bits;
}

// 컴퓨터 추격 이동(대시 지원). tune.dash 가 켜진 레벨만: 목표가 dashDist 이상 멀면 대시 요청(p.aiDash, 엔진이 DASH 진입),
// 대시 중 남은 거리가 제동거리(v^2/2a)+여유 이하면 입력을 떼어 미끄러져 멈춘다(과속 오버슛·왕복 방지).
function chaseMove(m, p, tx, ty, dead, tune) {
  const bits = moveToward(p, tx, ty, dead);
  if (!tune?.dash || !bits) return bits;
  const dist = Math.hypot(toPx(tx - p.x), toPx(ty - p.y));
  const v = Math.hypot(p.vx, p.vy) / ONE, dashing = p.st === ST.DASH;
  if ((dashing || v > 1.2) && dist <= (v * v) / (2 * (m.stage.friction / ONE)) + 3) return 0;
  if (!dashing && dist > tune.dashDist) p.aiDash = true;
  return bits;
}


// 원작 내야 대기 위치표(ROM 0x9E92~0x9F11, 좌석0 기준 px. 좌석1 은 x=512-x). 공 구역별로 8점 중 하나를 골라 빠르게 이동한다(ROM 0x8F52).
const IDLE_PTS = {
  0: [[88, 56], [80, 96], [72, 160], [64, 200], [112, 56], [112, 96], [112, 160], [112, 200]], // 공이 상대 코트: 뒤쪽으로
  4: [[88, 160], [144, 160], [192, 160], [240, 160], [88, 200], [144, 200], [192, 200], [240, 200]], // 공이 위쪽 띠: 아래쪽으로
  7: [[88, 56], [144, 56], [192, 56], [240, 56], [88, 96], [144, 96], [192, 96], [240, 96]], // 공이 아래쪽 띠: 위쪽으로
  10: [[208, 56], [208, 96], [208, 160], [208, 200], [240, 56], [240, 96], [240, 160], [240, 200]], // 그 외: 중앙선 쪽으로
};
function idlePoint(m, p) {
  const b = m.ball, bx = toPx(b.x), by = toPx(b.y);
  const mx = p.seat === 0 ? bx : 512 - bx;
  const cls = mx > 256 ? 0 : by < 32 ? 4 : by > 224 ? 7 : 10;
  let w = p.wander;
  if (!w || w.cls !== cls || (m.f >= w.next && (w.next += 60, m.rng.int(2) === 0))) {
    const mates = m.players.filter((q) => q.seat === p.seat && q !== p && q.wander);
    let idx = m.rng.int(8);
    for (let t = 0; t < 4 && mates.some((q) => q.wander.cls === cls && q.wander.idx === idx); t++) idx = m.rng.int(8);
    const [x, y] = IDLE_PTS[cls][idx];
    const bd = m.bounds(p);
    const X = Math.min(Math.max((p.seat === 0 ? x : 512 - x) * ONE, bd.x0), bd.x1), Y = Math.min(Math.max(y * ONE, bd.y0), bd.y1);
    w = p.wander = { cls, idx, x: X, y: Y, next: m.f + 60 };
  } else if (!(w.next > m.f)) w.next = m.f + 60;
  return w;
}

const fl = (v) => Math.floor(v / ONE);

/** 선수 히트박스(번호 idx)와 공 히트박스의 x·y 겹침(z 무시) [직역 ROM 0x6CE8: 정수 px, 경계 포함, 음수 왼쪽 끝은 0] */
function boxXY(m, p, idx) {
  const hbs = m.data.court.hitboxes, a = hbs[idx], c = hbs[m.R.hitboxIdx.ball], b = m.ball;
  const ov = (p0, o0, l0, p1, o1, l1) => { const s0 = Math.max(p0 + o0, 0), s1 = Math.max(p1 + o1, 0); return p0 + o0 + l0 >= s1 && p1 + o1 + l1 >= s0; };
  return ov(fl(p.x), a.xoff, a.w, fl(b.x), c.xoff, c.w) && ov(fl(p.y), a.yoff, a.h, fl(b.y), c.yoff, c.h);
}

/** 공 쪽을 본다 [직역 ROM 0x8E50: 내 x >= 공 x 면 왼쪽, 내 y >= 공 y 면 뒤]. 컴퓨터형 선수(타입 0x20/0x24/0x28) 대기 핸들러가 매 프레임 부른다 */
function faceBall(m, p) { p.face = fl(p.x) >= fl(m.ball.x) ? -1 : 1; p.back = fl(p.y) >= fl(m.ball.y); }

/** 목표 (tx,ty px)를 향한 속도 [직역 ROM 0x9E2A(걷기: s2*16+0x140-마찰>>7) / 0x9E62(빠른 이동: s2*16+0x300), 각도 0x2254·분해 0x22DA] */
function velToward(m, p, tx, ty, fast) {
  const a = romAngle(tx, ty, fl(p.x), fl(p.y));
  const spd = fast ? (p.stat.spd << 4) + 0x300 : (p.stat.spd << 4) + 0x140 - (m.stage.friction >> 7);
  return romDecomp(m.data.rom.trig, a.i, a.fl, spd & 0xffff);
}

// 외야 대기점 표 [ROM 0x9FFA(좌석0)/0xA066(좌석1)]: 슬롯 4~12 마다 3점 (px)
const OUT_PTS = [
  [[[288, 24], [352, 24], [416, 24]], [[272, 24], [304, 24], [336, 24]], [[360, 24], [408, 24], [440, 24]], [[352, 238], [288, 238], [416, 238]], [[272, 238], [312, 238], [352, 238]], [[392, 238], [440, 238], [488, 238]], [[464, 128], [448, 64], [480, 192]], [[440, 32], [448, 64], [456, 96]], [[472, 160], [480, 192], [488, 224]]],
  [[[160, 24], [96, 24], [224, 24]], [[176, 24], [208, 24], [240, 24]], [[88, 24], [120, 24], [152, 24]], [[160, 238], [96, 238], [224, 238]], [[160, 238], [200, 238], [240, 238]], [[24, 238], [72, 238], [120, 238]], [[48, 128], [64, 64], [32, 192]], [[72, 32], [64, 64], [56, 96]], [[40, 160], [32, 192], [24, 224]]],
];

/**
 * 컴퓨터형 외야 선수(원작 타입 0x24/0x28, 핸들러 0x9128/0x92A8) 직역. 사람이 조작 중인 외야(타입 0x34/0x38)는 해당 없음.
 * - 대기(서브0, 0x914E): 속도 0, 매 프레임 공 쪽을 보고(0x8E50), 보유 상태가 아닌 공이 내 히트박스 14(24x24, 높이 무시)와 겹치면(0x9D8A -> 0x6CE8)
 *   캐치 자세로(0x77D4: 공이 정지해 있으면 줍기 15f). 캐치 자세(공용 0x730A)에서 느슨한 공은 히트박스 11 로 닿는 즉시 잡는다 -> 외야를 지나가는 공·튀는 공을 받아낸다
 * - 자리 이동(0x9212): 공의 (마지막) 소유자가 상대편일 때만 120프레임마다 난수 1회, 시드 bit3 이 1이면 슬롯별 3점 표에서 새 지점(0x9248: 난수&3, 3이면 0, 현재 목표와 같으면 앞 번호)
 *   -> 서브 0x10(0x91EE): 걷기 속력으로 이동, 목표 ±4px 안이면(0x6FEE) 대기로. 이동 중에는 캐치 검사가 없다
 * - 활성 선수(조작 전환 0x85CC 로 뽑힌 그 구역 외야, CPU 사이드)가 정지 공을 가지러 가는 이동은 빠른 이동 속력으로 공을 향하고, 겹치면 같은 줍기 진입(0x95F6~0x9634)
 * 반환: 입력 비트. 이동은 p.aiVel(16.16 속도)로 엔진에 직접 전달한다
 */
function outfieldRom(m, p, canAct) {
  const ball = m.ball, S = m.sides[p.seat];
  if (!canAct) return 0;
  const o = (p.ob ??= { t: 120, tx: -1, ty: -1, mv: false });
  faceBall(m, p);
  // 대기 핸들러(서브0·서브 0x0C)는 매 프레임 자리를 띠 선 위로 맞춘다 [직역 ROM 0x8306: 상단 y=24·하단 y=238(정수부만) / 후방 0x831E: x = 432 + y/4(좌석0), 80 - y/4(좌석1)] [실측 out_fetch_top f88]
  if (!o.mv && !(m.fm && m.fm.seat === p.seat)) { if (p.slot < 10) p.y = (p.slot < 7 ? 0x18 : 0xee) * ONE + (p.y & 0xffff); else { const d = p.y >> 2; p.x = p.seat === 0 ? 0x1b00000 + d : 0x500000 - d; } }
  const free = ball.mode !== BM.HELD && ball.mode !== BM.DROP && !m.tip.on;
  const stopped = ball.mode === BM.LOOSE && ball.z === 0 && ball.vx === 0 && ball.vy === 0 && ball.vz === 0 && ball.still >= 2;
  // [사실상 죽은 코드] 컴퓨터 사이드의 활성 외야는 aiInput 이 outActiveRom(타입 0x74)으로 먼저 보낸다. 이 분기는 포메이션·점프볼 중(그때는 outActiveRom 을 건너뛴다)에만 올 수 있고, 4차 이전의 근사 규칙(빠른 이동으로 줍기)이다 [추정]
  if (!m.humans[p.seat] && S.ctrl === p.pid && stopped && S.zone === (p.slot < 7 ? 4 : p.slot < 10 ? 7 : 10)) {
    if (m.boxHit(p, p.hb)) { p.aiVel = [0, 0]; return BIT.B; }
    p.aiVel = velToward(m, p, fl(ball.x), fl(ball.y), true);
    o.mv = false;
    return 0;
  }
  if (o.pc) { // 패스 대상 지정 대기(서브 0x0C) [직역 ROM 0x91C6 -> 0x8EC2]: 캐치 검사·자리 이동 타이머 없음. 풀리면 서브0 부터(타이머 120)
    p.aiVel = [0, 0];
    if (!(m.e214 === p.pid && sideHas(m, p.seat))) { o.pc = false; o.t = 120; }
    return 0;
  }
  if (o.mv) { // 서브 0x10
    p.aiVel = velToward(m, p, o.tx, o.ty, false); p.aiFree = true;
    const x = fl(p.x + p.aiVel[0]), y = fl(p.y + p.aiVel[1]);
    if (x >= o.tx - 4 && x <= o.tx + 4 && y >= o.ty - 4 && y <= o.ty + 4) { o.mv = false; o.t = 120; }
    return 0;
  }
  p.aiVel = [0, 0];
  if (free && boxXY(m, p, 14)) return BIT.B; // 0x9D8A
  // 0x9212: 공의 마지막 보유자($C71C)의 사이드가 내 사이드와 다르면 타이머를 센다. 아직 아무도 든 적이 없으면(포인터 0) ROM 0x52 의 값(0x0200)을 사이드로 읽어 '다른 사이드'가 된다 [실측 rng_stop_45 f30: 외야 6명 모두 난수 1회]
  const own = ball.owner ?? -1;
  if ((own < 0 || m.players[own].seat !== p.seat) && --o.t === 0) {
    o.t = 120;
    m.rng.next();
    if (m.rng.seed & 8) {
      const T = OUT_PTS[p.seat][p.slot - 4];
      m.rng.next();
      let k = m.rng.seed & 3; if (k === 3) k = 0;
      while (T[k][0] === o.tx && T[k][1] === o.ty) k = k === 0 ? 2 : k - 1;
      o.tx = T[k][0]; o.ty = T[k][1]; o.mv = true;
    }
  }
  if (sideHas(m, p.seat) && m.e214 === p.pid) { o.pc = true; o.mv = false; } // 0x9194 -> 0x8EA8 [실측 atk_p1c f72 p13]
  return 0;
}

// ===================== 컴퓨터형 내야 두뇌 직역 (rules.cpu.rom) =====================
// 원작 대기점 표 [ROM 0x9F92(좌석0)/0x9FC6(좌석1) 포인터 표 -> 0x9E92~0x9F91]: 상대 사이드 기준 공 구역(0, 4, 7, 10)마다 8점. 좌석1 표는 좌석0 의 좌우 반전이 아니다(순서가 다르다)
const WAIT_PTS = [
  {
    0: [[88, 56], [80, 96], [72, 160], [64, 200], [112, 56], [112, 96], [112, 160], [112, 200]],
    4: [[88, 160], [144, 160], [192, 160], [240, 160], [88, 200], [144, 200], [192, 200], [240, 200]],
    7: [[88, 56], [144, 56], [192, 56], [240, 56], [88, 96], [144, 96], [192, 96], [240, 96]],
    10: [[208, 56], [208, 96], [208, 160], [208, 200], [240, 56], [240, 96], [240, 160], [240, 200]],
  },
  {
    0: [[400, 56], [400, 96], [400, 160], [400, 200], [424, 56], [432, 96], [440, 160], [448, 200]],
    4: [[272, 160], [320, 160], [368, 160], [424, 160], [272, 200], [320, 200], [368, 200], [424, 200]],
    7: [[272, 56], [320, 56], [368, 56], [424, 56], [272, 96], [320, 96], [368, 96], [424, 96]],
    10: [[272, 56], [272, 96], [272, 160], [272, 200], [296, 56], [296, 96], [296, 160], [296, 200]],
  },
];

/** 슬롯의 담당 구역 [ROM 0xD54E 표]: 내야 0, 외야 상단 4, 하단 7, 후방 10 */
const zoneOfSlot = (s) => (s < 4 ? 0 : s < 7 ? 4 : s < 10 ? 7 : 10);
/** 공이 내 담당 구역에 있는가 [직역 ROM 0xD52C]: 사이드 공 구역($5D)이 슬롯 구역과 같거나, 후방 외야이고 구역 13 */
function sameZone(m, p) { const z = m.sides[p.seat].zone, zs = zoneOfSlot(p.slot); return z === zs || (zs === 10 && z === 13); }
/** 두뇌 상태: sub=서브($16), fresh=서브 초기화 전, tm=타이머($18), tx/ty=대기점($60/$62), plan=$5E, pf=plan 초기화 전, act=활성(타입 0x70) 여부, busy=엔진 자세(캐치·웅크림·점프·줍기) 진행 중 */
function cbOf(p) { return (p.cb ??= { sub: 0, fresh: true, tm: 0, tx: -1, ty: -1, plan: 0, pf: true, act: null, busy: 0 }); }
/** 사이드가 공을 가졌는가(사이드 $16). 획득 때 1(0x73B0), 투구 발사 때 0(0x7216). [추정] 그 밖에 지워지는 경로(피격·선 이탈로 놓침)는 판독하지 못해 '보유 중이거나 그 사이드의 패스가 날아가는 중'으로 근사 */
function sideHas(m, seat) { const b = m.ball; return (b.mode === BM.HELD && b.holder >= 0 && m.players[b.holder].seat === seat) || (b.mode === BM.PASS && m.players[b.thrower].seat === seat); }
/** 상대 활성 선수가 투구 동작(서브 0x0C) 중인가 [직역 ROM 0xD7CC]: 상대 활성 선수가 강제 회수(타입 0x44)면 아님 */
function oppWind(m, p) { const oc = m.players[m.sides[1 - p.seat].ctrl]; return !!oc && !oc.t44 && !!oc.wind && oc.wind.kind === 'throw'; }
/** 이동 뒤 위치가 목표 ±tol 안인가 [직역 ROM 0x6FEE(±4) / 0x6FE6(±32), 표 0x7030] */
function arrived(p, v, tx, ty, tol) { const x = fl(p.x + v[0]), y = fl(p.y + v[1]); return x >= tx - tol && x <= tx + tol && y >= ty - tol && y <= ty + tol; }
/** 이번 프레임 이동을 두뇌가 직접 적용(이동한 그 프레임에 자세로 들어가는 원작 순서용). clamp = 이동 허용영역 클램프(0x7F36) */
function moveNow(m, p, v, clamp) {
  p.x += v[0]; p.y += v[1];
  if (clamp) { const b = m.bounds(p); p.x = Math.min(Math.max(p.x, b.x0), b.x1); p.y = Math.min(Math.max(p.y, b.y0), b.y1); }
  p.aiVel = [0, 0];
}

/**
 * 대기점 선택 [직역 ROM 0x8F52(key = 상대 사이드의 공 구역, 13 또는 없음이면 10) / 0x8FBE(key 0)]:
 * 난수 1회, 시드 하위 3비트 번호부터 시작해 '지금 내 목표와 같은 점'과 '같은 편 내야(슬롯 0~3) 다른 선수의 목표와 같은 점'(0x9012)을 건너뛰며 번호를 1씩 내린다(0 다음은 7)
 */
function pickPoint(m, p, cb, key) {
  const T = WAIT_PTS[p.seat][key];
  m.rng.next();
  let k = m.rng.seed & 7;
  for (let n = 0; n < 16; n++) {
    const [x, y] = T[k];
    if (!(x === cb.tx && y === cb.ty) && !m.players.some((q) => q.seat === p.seat && q !== p && q.slot < 4 && !q.removed && q.cb && q.cb.tx === x && q.cb.ty === y)) { cb.tx = x; cb.ty = y; return; }
    k = k === 0 ? 7 : k - 1;
  }
}
const oppZoneKey = (m, p) => { const z = m.sides[1 - p.seat].zone; return z === 13 || z < 0 ? 10 : z; };

/**
 * 대기점 재선택 판단 [직역 ROM 0x8EDE]. 수동 내야 서브0·서브 0x10 이 매 프레임 부른다.
 * 양 사이드의 공 구역이 직전 값과 같으면 타이머-1, 0 이 되면 60 으로 되돌리고 난수 1회(결과 bit3 이 0 이면 그대로). 구역이 바뀌었거나 bit3 이 1이면:
 * 상대 사이드가 공을 가졌으면 0x8F52 로 새 대기점 -> 서브8(빠른 이동). 아니면 공의 마지막 보유자가 내야(슬롯<=3)일 때만 0x8FBE 로 새 대기점 -> 서브8
 */
function waitLogic(m, p, cb) {
  const S = m.sides[p.seat], O = m.sides[1 - p.seat];
  if (!(cb.plan === 0x2c && cb.pf) && O.zp === O.zone && S.zp === S.zone) {
    cb.tm = (cb.tm - 1) & 0xffff;
    if (cb.tm !== 0) return;
    cb.tm = 60;
    if (!(m.rng.next() & 8)) return;
  }
  cb.plan = 0; cb.pf = true;
  if (sideHas(m, 1 - p.seat)) { pickPoint(m, p, cb, oppZoneKey(m, p)); cb.sub = 8; cb.fresh = true; return; }
  const ow = m.ball.owner ?? -1;
  if (ow >= 0 && m.players[ow].slot <= 3) { pickPoint(m, p, cb, 0); cb.sub = 8; cb.fresh = true; }
}

/**
 * 수동 내야(타입 0x20) [직역 ROM 0x8D02]. 사람 편 동료와 컴퓨터 편 비활성 내야.
 * 서브0(0x8D28): 초기화 = 속도 0·타이머 60. 매 프레임 공 쪽을 보고(0x8E50), 피격 판정(0x847C), 대기점 판단(0x8EDE), 투구 공(공 $3 bit6, 편 구분 없음)이 히트박스 12 에 들어오면 웅크림(0x8E82),
 *   상대 패스 공(높이 48 이하)이 히트박스 12 에 들어오면 캐치 자세(0x90A6, 타이머는 남은 값 그대로)
 * 서브8(0x8D98): 대기점으로 빠른 이동(0x9E62), 클램프·피격 판정 없음, ±32 안이면 서브 0x10
 * 서브 0x10(0x8DD6): 초기화 = 타이머 60. 걷기 속력(0x9E2A)으로 이동, 클램프·피격 판정 없음, 0x8EDE, ±4 안이면 서브0
 * 서브 0x0C(0x8DC0 -> 0x8EC2): 패스 대상으로 지정됐을 때의 대기(4차에 이식)
 * 미이식: 공을 가진 수동 내야(0xA0D2)
 */
function passiveRom(m, p, cb) {
  const ball = m.ball;
  if (cb.sub === 8) {
    const v = velToward(m, p, cb.tx, cb.ty, true);
    p.aiVel = v; p.aiFree = true; p.aiNoHit = true; m.faceByVel(p, v[0], v[1]);
    if (arrived(p, v, cb.tx, cb.ty, 32)) { cb.sub = 0x10; cb.fresh = true; }
    return 0;
  }
  if (cb.sub === 0x10) {
    if (cb.fresh) { cb.fresh = false; cb.tm = 60; }
    const v = velToward(m, p, cb.tx, cb.ty, false);
    p.aiVel = v; p.aiFree = true; p.aiNoHit = true; m.faceByVel(p, v[0], v[1]);
    waitLogic(m, p, cb);
    if (arrived(p, v, cb.tx, cb.ty, 4)) { cb.sub = 0; cb.fresh = true; }
    return 0;
  }
  if (cb.sub === 0x0c) { // 패스 대상 지정 대기 [직역 ROM 0x8DC0 -> 0x8EC2]: 공 쪽을 보고 선다. 대기점 판단·피격 판정·웅크림 반응 없음. 내가 패스 대상($E214)이 아니거나 우리 편이 공을 놓으면 서브0 부터(타이머 60)
    p.aiVel = [0, 0]; p.aiNoHit = true; faceBall(m, p);
    if (!(m.e214 === p.pid && sideHas(m, p.seat))) { cb.sub = 0; cb.fresh = true; }
    return 0;
  }
  cb.sub = 0;
  if (cb.fresh) { cb.fresh = false; cb.tm = 60; }
  p.aiVel = [0, 0];
  faceBall(m, p);
  waitLogic(m, p, cb);
  // 필살기 공(타입 0x90)도 투구 공 표시(공 $3 bit6)가 서 있어 수동 내야가 웅크린다 [실측 tools/diff ctr_special 트레이스: 비행 중 공 $3 = 0x44, f64 p10 서브0 -> 0x18. 두 번째 장면 f112: 되던진 필살 공($3 = 0x43)이 뜬 프레임에 p10 서브 0 -> 0x18].
  // 필살 공을 앞 번호 선수가 같은 프레임에 잡아도 그 프레임의 뒤 번호 선수는 아직 bit6 이 선 공을 본다(공 오브젝트가 선수들 뒤에 돈다) [실측 같은 트레이스 f64: p7 캐치와 같은 프레임에 p10 웅크림] -> ball.b6f(hitOne 이 기록한 캐치 프레임). 일반 투구 공을 잡은 프레임은 원작 미확인이라 종전대로(HELD 면 반응 없음)
  if ((ball.mode === BM.FLY || (ball.b6f === m.f && ball.mode === BM.HELD)) && boxXY(m, p, 12)) { cb.sub = 0; cb.fresh = true; return BIT.A; }
  if (ball.mode === BM.PASS && ball.romPass && fl(ball.z) <= 0x30 && m.players[ball.thrower].seat !== p.seat && boxXY(m, p, 12)) {
    p.aiCatchTm = cb.tm || 0x7fff; cb.sub = 0x14; cb.fresh = true;
    return BIT.B;
  }
  if (sideHas(m, p.seat) && m.e214 === p.pid) { cb.sub = 0x0c; cb.fresh = true; } // 0x8EA8: 우리 편이 공을 들었고 내가 패스 대상이면 지정 대기로 [실측 atk_seed1 f76 p8]
  return 0;
}

/** 방어 결정 [직역 ROM 0xD5F0 -> 0xD4F6]: 8비트 난수 1회를 선수 파라미터 b9..b12 와 차례로 비교 -> plan 0x34 서기 / 0x38 캐치 / 0x3C 웅크림 / 0x40 점프 / 0x44 옆걸음 */
function defend(m, p, cb) {
  if (m.tr) { cb.plan = 0x38; cb.pf = true; return; } // 특훈: 언제나 캐치 [판독만 ROM 0xD612 + 확인: 30회 전부 캐치]. 난수를 쓰는지는 미확인(쓰지 않게 했다)
  const c = p.cfg, r = m.rng.next() & 0xff;
  let k = r < c[9] ? 0 : r < c[10] ? 1 : r < c[11] ? 2 : r < c[12] ? 3 : 4;
  const tune = m.aiTune?.[p.seat];
  if (tune?.blunder256 > 0 && m.rng.int(256) < tune.blunder256) k = 0; // [자작, 원작 근거 없음] 난이도 1 의 방어 실수. 0 이면 난수를 쓰지 않는다
  const bst = m.cpuBoost ? boostOf(m, p) : null;
  if (bst && bst.catch256 > 0 && k !== 1 && m.rng.int(256) < bst.catch256) k = 1; // [자작] 컴퓨터 단계 보정(boost.js): 방어 결정을 캐치로 바꾼다. 보정이 없으면 난수를 쓰지 않는다
  if (m.official) k = [0, 1, 2, 1, 0][k]; // こうしき 방어 표 0xD624 = [서기, 캐치, 웅크림, 캐치, 서기] (체력제 0xD61A 는 점프·옆걸음) [판독만 ROM 0xD600, 표 바이트 확인]
  cb.plan = 0x34 + 4 * k; cb.pf = true;
}

/**
 * 컴퓨터 활성 내야(타입 0x70)의 공 없는 plan [직역 ROM 0xBBE8 표]. 공을 든 뒤의 공격 plan(0x04~0x24, 0x4C)은 아래 attackRom.
 * plan 0(0xBC42): 공이 내 구역이면 바운스·정지 공일 때 0x28, 아니면 0x2C. 내 구역이 아니면 상대 활성 선수가 공을 들고 투구 동작 중일 때 방어 결정, 아니면 0x2C
 * plan 0x28(0xC15C): 공으로 걷기 속력 이동(0x9E32). 공이 높이 24 이상이고 내 히트박스와 겹치면 선다. 이동 뒤 공에 닿으면 캐치 자세/줍기(0x77D4)
 * plan 0x2C(0xC22C): 대기점 선택(0x8F52) -> 빠른 이동(서브8, ±32) -> 걷기(서브0, ±4) -> plan 0x30. 매 프레임 상대 투구 동작이면 방어 결정
 * plan 0x30(0xC2D4): 제자리, 공 쪽을 봄, 타이머 60 마다 난수 bit3 이면 plan 0x2C. 구역이 바뀌어도 0x2C. 공이 내 구역 바운스·정지 공이면 0x28
 * plan 0x34~0x44(0xC3B0~0xC5DC): 방어. 서기·캐치는 매 프레임 공 쪽을 보고 피격 판정을 받는다. 웅크림·점프·옆걸음 대기는 초기화 때만 공 쪽을 보고 피격 판정이 없다.
 *   투구 공이 히트박스 12(점프는 13)에 들어오면 캐치 자세(0x77D4)/웅크림(0x77F8)/점프(0x770C)/옆걸음(위 또는 아래로 64px, 빠른 이동). 공이 투구 상태가 아니고 상대 투구 동작도 끝났으면 plan 0
 * plan 0x48(0xC6AC 서브0 0xC732): 파라미터 b13+1 프레임 대기 뒤 plan 0 (점프 착지·웅크림 끝)
 */
function activeRom(m, p, cb) {
  const ball = m.ball, O = m.sides[1 - p.seat], S = m.sides[p.seat], oc = m.players[O.ctrl];
  const fly = ball.mode === BM.FLY, wind = oppWind(m, p);
  const setPlan = (n) => { cb.plan = n; cb.pf = true; };
  p.aiVel = [0, 0];
  if (cb.plan === 0) {
    p.aiNoHit = true; p.aiKeepV = [p.vx, p.vy]; // plan 0 프레임은 이동이 없지만 속도 값은 지워지지 않고 남는다 [실측 atk_seed3 f274]
    if (sameZone(m, p)) setPlan(ball.mode === BM.LOOSE ? 0x28 : 0x2c);
    else if (oc && oc.hasBall && wind) defend(m, p, cb);
    else setPlan(0x2c);
    return 0;
  }
  if (cb.pf) { cb.pf = false; cb.sub = 0; cb.fresh = true; if (cb.plan === 0x2c) { pickPoint(m, p, cb, oppZoneKey(m, p)); cb.sub = 8; } }
  switch (cb.plan) {
    case 0x28: {
      let bits = 0;
      if (!(fl(ball.z) >= 0x18 && boxXY(m, p, p.hb))) {
        const v = velToward(m, p, fl(ball.x), fl(ball.y), false);
        p.aiVel = v; m.faceByVel(p, v[0], v[1]);
        if (!v[0] && !v[1]) setPlan(0x2c);
        else {
          const x0 = p.x, y0 = p.y;
          moveNow(m, p, v, true);
          if (ball.mode === BM.LOOSE && !m.tip.on && m.boxHit(p, p.hb)) { bits = BIT.B; p.aiKeepV = v; }
          else { p.x = x0; p.y = y0; p.aiVel = v; if (oc && oc.hasBall) setPlan(0); }
        }
      }
      if (!sameZone(m, p) || ball.mode !== BM.LOOSE || (oc && oc.hasBall)) setPlan(0);
      return bits;
    }
    case 0x2c: {
      if (cb.sub === 8) {
        const v = velToward(m, p, cb.tx, cb.ty, true);
        p.aiVel = v; p.aiFree = true; m.faceByVel(p, v[0], v[1]);
        if (arrived(p, v, cb.tx, cb.ty, 32)) cb.sub = 0;
      } else {
        const v = velToward(m, p, cb.tx, cb.ty, false);
        p.aiVel = v; m.faceByVel(p, v[0], v[1]);
        if (arrived(p, v, cb.tx, cb.ty, 4)) setPlan(0x30);
      }
      if (wind) defend(m, p, cb);
      return 0;
    }
    case 0x30: {
      if (cb.fresh) { cb.fresh = false; cb.tm = 60; }
      faceBall(m, p);
      if (wind) { defend(m, p, cb); return 0; }
      if (sameZone(m, p)) { if (ball.mode === BM.LOOSE) setPlan(0x28); return 0; }
      if (O.zp !== O.zone || S.zp !== S.zone) { setPlan(0x2c); return 0; }
      cb.tm = (cb.tm - 1) & 0xffff;
      if (cb.tm === 0) { cb.tm = 60; if (m.rng.next() & 8) setPlan(0x2c); }
      return 0;
    }
    case 0x34:
      faceBall(m, p);
      if (!fly && !wind) setPlan(0);
      return 0;
    case 0x38:
      faceBall(m, p);
      if (m.tr && ball.sp) return 0; // 특훈: 필살 슛(공 $76=1, 0xADF0)에는 캐치 자세에 들어가지 않는다 -> 서서 맞는다 [판독만 ROM 0xC48C~0xC496 + 확인 sp_pass10: plan 0x38 인 채 10구 모두 피격]
      if (!fly && !wind) { setPlan(0); return 0; }
      return boxXY(m, p, 12) ? BIT.B : 0;
    case 0x3c: case 0x40:
      if (cb.fresh) { cb.fresh = false; faceBall(m, p); }
      p.aiNoHit = true;
      if (!fly && !wind) { setPlan(0); return 0; }
      if (fly && boxXY(m, p, cb.plan === 0x3c ? 12 : 13)) return cb.plan === 0x3c ? BIT.A : BIT.C;
      return 0;
    case 0x44: {
      if (cb.sub === 8) {
        if (cb.fresh) { // 0xD7F0: 난수 bit2 가 0 이면 위로 64px(최소 48), 1 이면 아래로 64px(최대 216)
          cb.fresh = false;
          const y = fl(p.y);
          cb.tx = fl(p.x);
          if (!(m.rng.next() & 4)) cb.ty = y - 0x40 < 0x30 ? 0x30 : y - 0x40; else cb.ty = y + 0x40 >= 0xd8 ? 0xd8 : y + 0x40;
        }
        const v = velToward(m, p, cb.tx, cb.ty, true);
        p.aiVel = v; p.aiFree = true;
        if (arrived(p, v, cb.tx, cb.ty, 4)) { moveNow(m, p, v, false); setPlan(0); }
        return 0;
      }
      if (cb.fresh) { cb.fresh = false; faceBall(m, p); }
      p.aiNoHit = true;
      if (!fly && !wind) { setPlan(0); return 0; }
      if (fly && boxXY(m, p, 12)) { cb.sub = 8; cb.fresh = true; }
      return 0;
    }
    case 0x48:
      if (cb.fresh) { cb.fresh = false; cb.tm = (p.cfg[13] | 0) + 1; }
      faceBall(m, p);
      if (--cb.tm === 0) setPlan(0);
      return 0;
    default:
      setPlan(0);
      return 0;
  }
}

// ===================== 컴퓨터 활성 내야의 공격 plan 직역 (공 보유, ROM 0xBC8E~0xC15C) =====================
// 컴퓨터 포메이션 시도 문턱 [ROM 0x186FA, 팀 번호별 바이트]
const FM_THR = [3, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 2, 2, 3, 3, 4, 2, 2, 2, 2, 2, 2, 2, 2];
/** 쓸 수 있는 선수($1E=0) */
const freeP = (m, q) => !!q && m.usable(q) && q.st !== ST.HIT && q.st !== ST.DOWN && q.st !== ST.FOUL && q.st !== ST.OUTMOVE;
const slotP = (m, seat, k) => m.players.find((o) => o.seat === seat && o.slot === k && !o.removed) ?? null;
/** 대상 쪽을 본다 [직역 ROM 0x78A0] */
function faceTo(p, t) { if (t) { p.face = fl(p.x) >= fl(t.x) ? -1 : 1; p.back = fl(p.y) >= fl(t.y); } }
/** 발사선(0xD6CA: x = 좌석0 224 / 좌석1 288) 또는 뒤쪽 출발점(0xD736: x = 96 / 416). y 는 자기 y 를 48~216 으로 */
function lineTarget(p, cb, x0, x1) { cb.tx = p.seat === 0 ? x0 : x1; const y = fl(p.y); cb.ty = y < 0x30 ? 0x30 : y > 0xd8 ? 0xd8 : y; }
/** plan 초기화에서 곧바로 투구·패스 동작(서브 0x0C/0x10)으로 들어가는 경우: 초기화가 서브를 바꾼 뒤 같은 프레임에 그 서브 핸들러가 돈다 -> 동작의 첫 프레임이 이번 프레임 [실측 atk_seed1 f183~f192] */
function windNow(p) { if (p.wind) { p.wind.fresh = false; p.wind.age = 0; } return 0; }
/** plan 초기화에서 곧바로 공중 차지(서브 0x24, 0xCA0C)로 들어가는 경우: 같은 프레임에 차지 1 + 난수 판정 */
function chargeNow(m, p) {
  if ((m.rng.next() & 0xff) < 0x40) { p.charge = 1; m.beginWind(p, 'throw', 1, 0); p.wind.faceAt = 1; return 0; }
  p.aiChg1 = true;
  return BIT.B;
}
/** 점프 진입 [직역 ROM 0x770C]: 수평 속도 1/4(asr 2), vz = 1.0 + s3<<12 (+1.0 대시 플래그). 이 프레임의 이동은 이미 끝났다(엔진 적분 0, 속도 값만 남긴다) */
function cpuJump(p, v) { p.vx = 0; p.vy = 0; p.aiVel = null; p.aiKeepV = [v[0] >> 2, v[1] >> 2]; return BIT.C; }

/**
 * 컴퓨터 활성 내야(타입 0x70)가 공을 든 동안의 plan [직역 ROM 0xBBE8 표. 근거 수준은 analysis/25 §9]
 * 획득 직후: 공중이거나 투구 공이 아니면 plan 0x48(0x7418), 지상에서 투구를 잡으면 밀림(서브 0x20, 0xC97E) 뒤 plan 0x48(0xD90E). 패스 수신(0x744E)은 plan 0 그대로
 * plan 0x48(0xC732): 파라미터 b13+1 프레임 대기 -> plan 0
 * plan 0(0xBC8E): 이 프레임은 이동 없음.
 *   공중: 난수&0x1F < b0 이면 plan 4(대상 = 상대 활성 선수), 아니면 패스 대상($E214)이 있으면 plan 0x18
 *   지상: 포메이션 판정(0xD948) -> 0xD932 -> 0xD474(난수&0x1F vs b0,b1): 0 투구 종류(0xD55C) / 1 나보다 위력($48)이 큰 내야 동료에게 패스(plan 0x18), 없으면 2 / 2 외야 동료 무작위(0xD8D6) -> 0xD4CA(난수 8비트 vs b6..b8) plan 0x18/0x1C/0x20/0x24, 없으면 plan 4
 *   투구 종류(0xD55C): 받아치기 창이 열려 있고 잡은 공의 차지($42)가 10 이상이면 난수&0x1F(필살기 공이면 절반) < b15 일 때 즉시 투구(plan 4, $6C). 아니면 0xD496(난수 8비트 vs b2..b5): plan 4/8/0x0C/(난수&0x1F < b14 ? 0x10 : 0x4C)/0x14
 * plan 4(0xBD3A): 발사선까지 걷기(0x9E2A, 영역 클램프 0xD772), ±4 도착 -> 투구(0xD69C). plan 8(0xBDBA): 도착 -> 점프(0x770C) -> 공중(0xCADE)
 * plan 0x0C(0xBE20): 뒤쪽 출발점까지 걷기(0xCB82) -> 대시(0xBE62, 선 이탈 검사) -> 발사선 도착 -> 지상 대시 투구
 * plan 0x10/0x14/0x4C(0xBED6/0xBF1A/0xC6EE): 뒤쪽 출발점 -> 대시(0xCBB4): 상대 활성 선수와 x 거리 128 미만이면 점프, 발사선 도착 때 상대 활성 선수 x 가 208~304 밖이면 점프·안이면 지상 투구
 *   공중: 0x10/0x14 는 0xCADE(난수&7+8 프레임 뒤 차지 시작), 0x4C 는 0xCC5E(내려가기 시작하면 차지 시작). 차지(서브 0x24): 0x14 는 15까지 채워 투구(0xBF5E = 필살기 창), 그 밖은 매 프레임 난수&0xFF < 0x40 이면 투구(0xCA0C)
 * plan 0x18(0xBFC2): 대상($E214)을 보고 b13+1 프레임 뒤 패스. plan 0x1C(0xC044): 점프 -> 공중(0xCB30: 난수&7+8 프레임 뒤 패스)
 * plan 0x20(0xC086): 뒤쪽 출발점 -> 대시(0xC0C8) -> 발사선 도착 -> 패스. plan 0x24(0xC118): 뒤쪽 출발점 -> 대시(0xCBB4) -> 점프 -> 공중 패스(0xCB30)
 * 미이식: 2P 패드 입력이 컴퓨터 공중 보유자에게 먹는 경로(0x7664 가 $E20D 를 읽는다), $E697 모드(0xBD30), 포메이션 진행 플래그 $E250 의 해제 시점
 */
function attackRom(m, p, cb) {
  const S = m.sides[p.seat], ball = m.ball, c = p.cfg, g = m.R.gravity;
  const oc = m.players[m.sides[1 - p.seat].ctrl] ?? null;
  const air = p.z > 0 || p.vz !== 0;
  const setPlan = (n) => { cb.plan = n; cb.pf = true; };
  const tgt21 = () => (m.e21e != null ? m.players[m.e21e] : null), tgt14 = () => (m.e214 != null ? m.players[m.e214] : null);
  p.aiVel = null;
  if (!cb.has) { // 획득
    cb.has = true; cb.sub = 0; cb.fresh = true; cb.busy = 0; cb.air = air; cb.now = false; cb.slid = false;
    if (ball.acqRecv) setPlan(0); else if (!(p.slideV > 0)) setPlan(0x48);
  }
  if (p.slideV > 0) { cb.slid = true; return 0; }
  if (cb.slid) { cb.slid = false; cb.sub = 0; cb.fresh = true; setPlan(0x48); } // 0xC9E8 -> 0xD90E
  if (p.wind) { cb.air = air; return 0; } // 투구·패스 동작(서브 0x0C/0x10, 0xC7AC/0xC80E): 엔진이 진행
  if (p.st !== ST.IDLE && p.st !== ST.DASH && p.st !== ST.BRAKE && p.st !== ST.JUMP) { cb.air = air; return 0; }
  if (cb.air && !air) { // 지난 프레임에 착지
    if (cb.sub === 4 && (cb.plan === 4 || cb.plan === 0x0c || cb.plan === 0x20 || cb.plan === 0x48)) setPlan(0x48); // 0xC75A -> 0xD90E
    cb.sub = 0; cb.fresh = true; // 0x83DA
  }
  cb.air = air;
  // 투구 시작 [직역 ROM 0xD69C]: 대상 = 상대 활성 선수, 지상이면 투구 동작(서브 0x0C), 공중이면 차지(서브 0x24)
  const startThrow = (charge = 0) => {
    m.e21e = oc ? oc.pid : null;
    if (air) return BIT.B;
    p.st = ST.IDLE; m.beginWind(p, 'throw', charge, 0); p.wind.faceAt = 1;
    return 0;
  };
  // 패스 시작 [직역 ROM 0x776C]: 패스 대상($E214)이 있으면 패스 동작(서브 0x10)
  const startPass = () => {
    const t = tgt14();
    if (!t) return 0;
    p.passTo = t.pid; if (!air) p.st = ST.IDLE;
    m.beginWind(p, 'pass', 0, 0); p.wind.faceAt = 1;
    return 0;
  };

  if (cb.plan === 0) { // 0xBC8E
    if (!air) { p.aiVel = [0, 0]; p.aiKeepV = [p.vx, p.vy]; }
    // 특훈의 연습 상대 [확인 ROM 0xBD30, 표 0xD9C8 = 4 / 0x0C / 0x10 / 4]: 난수 없이 단계 표의 plan(캐치 1~3단계 4 / 0x0C / 0x10, 필살 슛 특훈 4), 대상 = 상대 내야 선수 0. 공중에서 든 경우의 원작 분기는 미확인(같은 표를 쓴다)
    if (m.tr && p.seat === 1) {
      const T = m.data.training;
      m.e21e = (1 - p.seat) * 7 + T.infieldIdx;
      setPlan(T[m.tr.kind].steps[m.tr.step].plan);
      return 0;
    }
    const aim = () => { m.e21e = oc ? oc.pid : null; };
    if (air) {
      if ((m.rng.next() & 0x1f) < c[0] || m.e214 == null || m.e214 === p.pid) { aim(); setPlan(4); } // E214 가 비어 있는 경우는 원작 동작(0 번지 대상 패스)을 옮기지 않고 투구로 [추정]
      else setPlan(0x18);
      return 0;
    }
    // 포메이션 판정 [직역 ROM 0xD948]: 사이드 카운터($62)+1 이 팀 문턱 이상이면 0 으로 되돌리고, 남은 인원 >= 4·남은 횟수 != 0 이면 난수&0xFF <= 0x80 이고 팀 7명이 모두 쓸 수 있을 때 발동
    if (!m.fm) {
      S.fmCnt = ((S.fmCnt | 0) + 1) & 0xff;
      if (!((FM_THR[S.fmT ?? S.team] ?? 255) > S.fmCnt)) { // S.fmT = flame 좌석이 고른 포메이션 패턴의 기준 팀(flame 옵션이 없으면 없다 = 종전과 같다)
        S.fmCnt = 0;
        if (S.remaining >= 4 && S.fmLeft > 0 && (m.rng.next() & 0xff) <= 0x80 && m.players.every((q) => q.seat !== p.seat || q.removed || freeP(m, q))) {
          if (m.fmCanStart(p.seat)) { m.fmStart(p.seat); return 0; } // 포메이션 진행 자체는 엔진 기존 구현(analysis/14)
        }
      }
    }
    // 0xD932: 원작은 lea $56(a0) 뒤 $18(a2) 를 읽어 선수 $6E 워드를 포인터로 쓴다($6E 를 쓰는 코드는 찾지 못했고 실측 0) -> 0 번지를 선수로 읽어 (x,y)=(0,0)·히트박스 0 과 내 히트박스 12 의 겹침. 겹치면 plan 4
    {
      const hbs = m.data.court.hitboxes, a = hbs[12], z = hbs[0];
      const ov = (p0, o0, l0, o1, l1) => { const s0 = Math.max(p0 + o0, 0), s1 = Math.max(o1, 0); return p0 + o0 + l0 >= s1 && o1 + l1 >= s0; };
      if (ov(fl(p.x), a.xoff, a.w, z.xoff, z.w) && ov(fl(p.y), a.yoff, a.h, z.yoff, z.h)) { aim(); setPlan(4); return 0; }
    }
    const r = m.rng.next() & 0x1f;
    const k = r < c[0] ? 0 : r < c[1] ? 1 : 2;
    if (k === 0) { // 0xBCF8 -> 0xD55C
      aim();
      // 받아치기 즉시 투구(0xD566): 창이 열려 있고 잡은 공의 차지가 10 이상일 때. [판독 + 원작 실행에서 0xD56E 호출·plan 4 관측(하네스 ctr_special f102, analysis/06 §3.3). 우리 쪽은 그 시나리오가 f63 부터 갈려 난수 대조는 못 했다]
      // 필살 공을 잡은 경우(ball.f76) 이 투구는 받아치기 필살이 된다(match.js romThrow, 0x8C08)
      if (ball.ctr > 0 && (ball.c42 | 0) >= 10) {
        let q = m.rng.next() & 0x1f;
        if (ball.f76) q >>= 1;
        if (q < c[15]) { setPlan(4); cb.now = true; return 0; }
      }
      const t = m.rng.next() & 0xff, n = m.cpuBoost ? bumpSpecial(m, p, t < c[2] ? 0 : t < c[3] ? 1 : t < c[4] ? 2 : t < c[5] ? 3 : 4) : t < c[2] ? 0 : t < c[3] ? 1 : t < c[4] ? 2 : t < c[5] ? 3 : 4;
      if (n !== 3) setPlan([4, 8, 0x0c, 0, 0x14][n]);
      else setPlan((m.rng.next() & 0x1f) < c[14] ? 0x10 : 0x4c);
      return 0;
    }
    if (k === 1) { // 0xBD00 -> 0xD65C: 내야 슬롯 0~3 중 나보다 위력이 큰 첫 선수
      for (let i = 0; i < 4; i++) { const q = slotP(m, p.seat, i); if (q && q !== p && freeP(m, q) && q.stat.pow > p.stat.pow) { m.e214 = q.pid; setPlan(0x18); return 0; } }
    }
    { // 0xBD12 -> 0xD8D6: 난수&7 번째 외야 슬롯부터 뒤로 첫 번째 쓸 수 있는 선수
      const r7 = m.rng.next() & 7;
      let t = null;
      for (let i = 4 + r7; i <= 12 && !t; i++) { const q = slotP(m, p.seat, i); if (q && q !== p && freeP(m, q)) t = q; }
      if (!t) { aim(); setPlan(4); return 0; }
      m.e214 = t.pid;
      const u = m.rng.next() & 0xff; // 0xD5DA -> 0xD4CA
      setPlan([0x18, 0x1c, 0x20, 0x24][u < c[6] ? 0 : u < c[7] ? 1 : u < c[8] ? 2 : 3]);
    }
    return 0;
  }

  if (cb.pf) { // plan 초기화
    cb.pf = false; cb.fresh = true;
    const q = cb.plan;
    if (q === 8 || q === 0x0c || q === 0x20 || q === 0x48) cb.sub = air ? 4 : 0; // 0x8398
    else cb.sub = 0;
    if (q === 4 && (cb.now || air)) { // 0xBD48: 즉시 투구($6C) 또는 공중 -> 0xD69C 뒤 같은 프레임에 서브 핸들러
      cb.now = false; m.e21e = oc ? oc.pid : null;
      if (air) { cb.sub = 0x24; faceTo(p, tgt21()); return chargeNow(m, p); }
      cb.sub = 0x0c; startThrow(); return windNow(p);
    }
    if (q === 0x18 && air) { startPass(); return windNow(p); } // 0xBFD8
    if (q === 0x1c && !air) { // 0xC04C: plan 초기화에서 점프(0x770C)하고 같은 프레임에 공중 핸들러(0xCB30)가 돈다 -> 그 프레임에 중력·높이 적분·타이머 [실측 atk_seed1 f101]
      cb.sub = 4; cb.fresh = false; faceTo(p, tgt14()); cb.tm = ((m.rng.next() & 7) + 8 - 1) & 0xffff;
      p.aiJ0 = true;
      const b = cpuJump(p, [p.vx, p.vy]); p.aiVel = null; p.vx = p.aiKeepV[0]; p.vy = p.aiKeepV[1]; p.aiKeepV = null;
      return b;
    }
  }
  const pl = cb.plan;

  if (p.charging) { // 서브 0x24
    if (cb.sub !== 0x24) { cb.sub = 0x24; faceTo(p, tgt21()); } // 0xBF66/0xCA14
    const n = p.charge + 1;
    if (pl === 0x14) return n >= 15 ? 0 : BIT.B; // 0xBF5E
    if (n > 15) return 0; // 0xCA0C
    return (m.rng.next() & 0xff) < 0x40 ? 0 : BIT.B;
  }
  if (air) { // 서브 4
    const first = cb.sub !== 4 || cb.fresh;
    cb.sub = 4; cb.fresh = false;
    const landing = p.z + (p.vz - g) < 0; // 이번 프레임에 착지(원작은 착지를 먼저 본다)
    if (pl === 4 || pl === 0x0c || pl === 0x20 || pl === 0x48) return 0; // 0xC75A
    if (pl === 0x4c) { // 0xCC5E: 내려가기 시작하면 차지
      if (first) faceTo(p, tgt21());
      return !landing && p.vz - g < 0 ? startThrow() : 0;
    }
    const pass = pl === 0x1c || pl === 0x24; // 0xCB30 / 그 밖 0xCADE
    if (first) { faceTo(p, pass ? tgt14() : tgt21()); cb.tm = (m.rng.next() & 7) + 8; }
    if (landing) return 0;
    cb.tm = (cb.tm - 1) & 0xffff;
    if (cb.tm !== 0) return 0;
    return pass ? startPass() : startThrow();
  }

  // ---- 지상 ----
  const walk = (onArrive) => { // 0x9E2A + 0xD772 + 0x6FEE
    const v = velToward(m, p, cb.tx, cb.ty, false);
    m.faceByVel(p, v[0], v[1]);
    const x0 = p.x, y0 = p.y;
    moveNow(m, p, v, true);
    if (arrived(p, [0, 0], cb.tx, cb.ty, 4)) return onArrive(v);
    p.x = x0; p.y = y0; p.aiVel = v;
    return 0;
  };
  if (cb.sub === 8) {
    if (pl === 4 || pl === 8 || pl === 0x18 || pl === 0x1c || pl === 0x48) { setPlan(0); p.aiVel = [0, 0]; return 0; } // 0xC7A4
    // 대시 [직역 ROM 0xBE62/0xC0C8/0xCBB4 -> 0x7FEA]
    if (cb.fresh) { cb.fresh = false; lineTarget(p, cb, 0xe0, 0x120); p.dashDir = p.seat === 0 ? 1 : -1; p.dashFlag = false; p.back = false; p.vy = 0; p.dashT = 6; }
    const M = m.R.move, acc = M.rom.dashAccBase[m.stageInfo.romStage] + (p.stat.spd << 7);
    const vx = p.dashDir > 0 ? Math.min(p.vx + acc, M.dashMax) : Math.max(p.vx - acc, -M.dashMax);
    if (Math.abs(vx) >= M.dashMax) p.dashFlag = true; // 0x7934
    p.face = vx < 0 ? -1 : 1; // 0xD844: 스프라이트 반전은 속도 부호 ($3 bit0 은 원작에서 바뀌지 않는다 [근사])
    const here = arrived(p, [vx, 0], cb.tx, cb.ty, 4), x1 = fl(p.x + vx);
    const stop = () => { p.x += vx; p.vx = 0; p.vy = 0; };
    if (pl === 0x0c) { // 0xBE62: 선 이탈 검사 -> 도착하면 지상 대시 투구
      p.x += vx;
      const out = m.outOfLine(p);
      p.x -= vx;
      if (out) { p.x += vx; p.vx = vx; p.vy = 0; m.enterFoul(p); return 0; } // [판독만] plan 0x0C 대시 중 선 이탈
      if (!here) { p.aiVel = [vx, 0]; p.aiFree = true; p.aiRun = true; return 0; }
      stop(); p.aiKeepV = [vx, 0];
      return startThrow();
    }
    if (pl === 0x20) { // 0xC0C8: 도착하면 패스
      if (!here) { p.aiVel = [vx, 0]; p.aiFree = true; p.aiRun = true; return 0; }
      stop(); p.aiKeepV = [vx, 0];
      return startPass();
    }
    // 0xCBB4 [확인: 발사선 도착 뒤 점프(atk_seed3/5 등)] [판독만: 대시 중 상대 근접 점프(0xCC04), 도착 뒤 지상 대시 투구(0xCC40), 팀 0x17 선수 0 의 지상 차지 15(0xCC44)]
    const ox = oc ? fl(oc.x) : 0;
    if (!here) {
      if (Math.abs(ox - x1) < 0x80) { p.x += vx; return cpuJump(p, [vx, 0]); } // [판독만]
      p.aiVel = [vx, 0]; p.aiFree = true; p.aiRun = true;
      return 0;
    }
    p.x += vx;
    if (ox < 0xd0 || ox > 0x130) return cpuJump(p, [vx, 0]);
    p.vx = 0; p.vy = 0; p.aiKeepV = [vx, 0]; // [판독만] 여기부터 지상 대시 투구 분기
    // [판독만] 0xCC44: 팀 번호 0x17 의 선수 0 은 지상 투구에 차지 15 를 넣는다(0x8CF0 창 = 필살기)
    if ((p.ot ?? S.team) === 0x17 && (p.oi ?? p.idx) === 0) { p.gsp = true; return startThrow(15); } // p.ot/p.oi = flame 혼합 로스터의 출신 팀·번호(없으면 좌석 팀·번호 = 종전과 같다)
    return startThrow();
  }
  // 서브 0
  if (pl === 4 || pl === 8) { // 0xBD96 / 0xBDFC
    if (cb.fresh) { cb.fresh = false; lineTarget(p, cb, 0xe0, 0x120); }
    return walk((v) => { if (pl === 8) return cpuJump(p, v); p.aiKeepV = v; return startThrow(); });
  }
  if (pl === 0x18) { // 0xC014
    p.aiVel = [0, 0];
    if (cb.fresh) { cb.fresh = false; faceTo(p, tgt14()); cb.tm = (c[13] | 0) + 1; }
    cb.tm = (cb.tm - 1) & 0xffff;
    return cb.tm === 0 ? startPass() : 0;
  }
  if (pl === 0x1c || pl === 0x48) { // 0xC732
    p.aiVel = [0, 0];
    if (cb.fresh) { cb.fresh = false; cb.tm = (c[13] | 0) + 1; }
    faceBall(m, p);
    cb.tm = (cb.tm - 1) & 0xffff;
    if (cb.tm === 0) setPlan(0);
    return 0;
  }
  // 0xCB82: 뒤쪽 출발점까지 걷기 -> 서브8
  if (cb.fresh) { cb.fresh = false; lineTarget(p, cb, 0x60, 0x1a0); }
  return walk(() => { cb.sub = 8; cb.fresh = true; return 0; });
}

// ===================== 컴퓨터 활성 외야 직역 (타입 0x74, ROM 0xCCE8) =====================
/** 외야 대기점 선택 [직역 ROM 0x9248]: 난수 1회, 시드&3(3이면 0)번 점. 지금 목표와 같으면 앞 번호(0 다음은 2) */
function pickOutPoint(m, p, o) {
  const T = OUT_PTS[p.seat][p.slot - 4];
  m.rng.next();
  let k = m.rng.seed & 3; if (k === 3) k = 0;
  while (T[k][0] === o.tx && T[k][1] === o.ty) k = k === 0 ? 2 : k - 1;
  o.tx = T[k][0]; o.ty = T[k][1];
}
/** 외야 이동의 방향 [직역 ROM 0xD788]: 공이 없으면 속도 방향(0x7868). 공을 들었으면 상·하단 띠는 좌우 = vx 부호·하단 띠만 뒷모습(0x79E0), 후방은 코트 쪽을 보고 vy<0 이면 뒷모습(0x7ABE) */
function outFace(m, p, v) {
  if (!p.hasBall) { m.faceByVel(p, v[0], v[1]); return; }
  if (p.slot < 10) { if (v[0] !== 0) p.face = v[0] < 0 ? -1 : 1; p.back = p.slot >= 7; }
  else { p.face = p.seat === 0 ? -1 : 1; p.back = v[1] < 0; }
}

/**
 * 컴퓨터 활성 외야(타입 0x74) [직역 ROM 0xCCE8 표]. 공이 없을 때와 들었을 때 모두.
 * plan 0(0xCD1E): 공 없음 -> 바운스·정지 공이면 plan 0x1C, 아니면 0x28. 공 보유 -> 공중: 난수&0x1F < b0 이면 plan 4, 아니면 패스 대상이 있으면 plan 0x10.
 *   지상: 0xD932 -> 0xD474: 0 = 투구(0xD62E: 0xD496 -> plan 4/0x0C/8/4/4), 1 = 나보다 위력이 큰 내야 동료(0xD65C) 없으면 2, 2 = 나보다 위력이 큰 외야 동료(0xD664) -> 0xD646(0xD4CA -> plan 0x10/0x18/0x14/0x24), 없으면 plan 4
 * plan 4(0xCDF0): 대상을 보고 b13+1 프레임 뒤 투구. plan 8(0xCE62): 대기점(0x9248)으로 걸어가 투구. plan 0x0C(0xCECA): 점프 -> 공중(0xCADE) 투구
 * plan 0x10(0xCF0C): b13+1 프레임 뒤 패스. plan 0x14(0xCF5E): 대기점으로 걸어가 패스. plan 0x18(0xCFCC): 점프 -> 공중(0xCB30) 패스
 * plan 0x1C(0xD00E): 공으로 걷기 속력(0x9E32, 영역 클램프). 공이 높이 24 이상이고 겹치면 선다. 닿으면 캐치 자세/줍기(0x77D4). 공이 내 구역이 아니거나 바운스 공이 아니면 plan 0
 * plan 0x20/0x24(0xD1D4/0xD246): 대기점으로 걸어가 점프 -> 공중 투구/패스. plan 0x28(0xD28A): b13+1 프레임 대기 -> plan 0
 * 획득: 활성 상태(plan 0x1C)에서 잡으면 plan 0(0xD024: 공이 바운스 공이 아님), 비활성 외야가 잡으면 활성이 되며 plan 0x28(0x7420) 또는 밀림 뒤 0x28(0xD90E), 패스 수신은 plan 0
 */
function outActiveRom(m, p) {
  const cb = cbOf(p), ball = m.ball, c = p.cfg, g = m.R.gravity;
  const oc = m.players[m.sides[1 - p.seat].ctrl] ?? null;
  const air = p.z > 0 || p.vz !== 0;
  const setPlan = (n) => { cb.plan = n; cb.pf = true; cb.fresh = true; };
  const tgt21 = () => (m.e21e != null ? m.players[m.e21e] : null), tgt14 = () => (m.e214 != null ? m.players[m.e214] : null);
  p.aiVel = null;
  if (cb.act !== true) { cb.act = true; cb.sub = 0; cb.busy = 0; cb.has = false; cb.slid = false; cb.air = air; setPlan(0); p.ob = null; } // 타입 재설정(0x8228): plan 0
  if (!p.hasBall) { if (cb.has) { setPlan(0); cb.sub = 0; } cb.has = false; cb.slid = false; } // 발사하면 plan 0(0xC804/0xC862)
  else {
    if (!cb.has) {
      cb.has = true; cb.busy = 0;
      const fetch = cb.plan === 0x1c && !cb.pf && !ball.acqRecv; // 활성 상태에서 주운 공(0xD174/0xD1C0): 서브 8, plan 은 0xD024 가 0 으로
      if (!fetch) cb.sub = 0;
      if (ball.acqRecv || fetch) { p.slideV = 0; setPlan(0); }
      else if (!(p.slideV > 0)) setPlan(0x28);
    }
    if (p.slideV > 0) { cb.slid = true; return 0; }
    if (cb.slid) { cb.slid = false; cb.sub = 0; setPlan(0x28); }
    if (p.wind) { cb.air = air; return 0; }
  }
  if (p.st !== ST.IDLE && p.st !== ST.DASH && p.st !== ST.BRAKE && p.st !== ST.JUMP) {
    cb.busy = p.st; cb.air = air;
    if (p.st === ST.PICKUP || p.st === ST.CROUCH) { p.aiVel = [0, 0]; p.aiKeepV = [p.vx, p.vy]; } // 줍기·웅크림 핸들러는 이동도 속도 지우기도 없다(끝나는 프레임 포함)
    return 0;
  }
  if (cb.busy) { cb.busy = 0; if (!p.hasBall) { cb.sub = 0; cb.fresh = true; } }
  if (cb.air && !air) { // 지난 프레임에 착지
    const pl0 = cb.plan;
    cb.sub = 0; cb.fresh = true;
    if (cb.airC75a) setPlan(0); // 0xC75A -> 0xD90E 뒤 외야는 plan 0(0xC79A)
    void pl0;
  }
  cb.air = air; cb.airC75a = false;
  const startThrow = () => {
    m.e21e = oc ? oc.pid : null;
    if (air) return BIT.B;
    p.st = ST.IDLE; m.beginWind(p, 'throw', 0, 0); p.wind.faceAt = 1;
    return 0;
  };
  const startPass = () => {
    const t = tgt14();
    if (!t) return 0;
    p.passTo = t.pid; if (!air) p.st = ST.IDLE;
    m.beginWind(p, 'pass', 0, 0); p.wind.faceAt = 1;
    return 0;
  };
  const jumpNow = (first14) => { // plan 초기화의 점프(0x770C) + 같은 프레임의 공중 핸들러
    cb.sub = 4; cb.fresh = false; faceTo(p, first14 ? tgt14() : tgt21()); cb.tm = ((m.rng.next() & 7) + 8 - 1) & 0xffff;
    p.aiJ0 = true;
    const b = cpuJump(p, [p.vx, p.vy]); p.vx = p.aiKeepV[0]; p.vy = p.aiKeepV[1]; p.aiKeepV = null;
    return b;
  };

  if (cb.plan === 0) { // 0xCD1E
    p.aiNoHit = true;
    if (!air) { p.aiVel = [0, 0]; p.aiKeepV = [p.vx, p.vy]; } else p.aiHold = true;
    if (!p.hasBall) { setPlan(ball.mode === BM.LOOSE ? 0x1c : 0x28); return 0; }
    // 캐치 특훈: 연습 상대 쪽 외야가 공을 들면 자기 편 내야 선수 0 에게 패스(외야 plan 0x10) [판독만 ROM 0xCDCC]
    if (m.tr && m.tr.kind === 'catch' && p.seat === 1) { m.e214 = p.seat * 7 + m.data.training.infieldIdx; setPlan(0x10); return 0; }
    // 필살 슛 특훈: 연습 상대 쪽 외야가 공을 들면 내 쪽 내야 선수 0 에게 투구(외야 plan 4) [판독만 ROM 0xCDCC]
    if (m.tr && m.tr.kind === 'special' && p.seat === 1) { m.e21e = (1 - p.seat) * 7 + m.data.training.infieldIdx; setPlan(4); return 0; }
    const aim = () => { m.e21e = oc ? oc.pid : null; };
    if (air) {
      if ((m.rng.next() & 0x1f) < c[0] || m.e214 == null || m.e214 === p.pid) { aim(); setPlan(4); }
      else setPlan(0x10);
      return 0;
    }
    { // 0xD932 (공격 plan 과 같은 판독: 0 번지를 선수로 읽는 겹침 검사)
      const hbs = m.data.court.hitboxes, a = hbs[12], z = hbs[0];
      const ov = (p0, o0, l0, o1, l1) => { const s0 = Math.max(p0 + o0, 0), s1 = Math.max(o1, 0); return p0 + o0 + l0 >= s1 && o1 + l1 >= s0; };
      if (ov(fl(p.x), a.xoff, a.w, z.xoff, z.w) && ov(fl(p.y), a.yoff, a.h, z.yoff, z.h)) { aim(); setPlan(4); return 0; }
    }
    const r = m.rng.next() & 0x1f, k = r < c[0] ? 0 : r < c[1] ? 1 : 2;
    if (k === 0) { // 0xCDAA -> 0xD62E
      aim();
      const t = m.rng.next() & 0xff, n = t < c[2] ? 0 : t < c[3] ? 1 : t < c[4] ? 2 : t < c[5] ? 3 : 4;
      setPlan([4, 0x0c, 8, 4, 4][n]);
      return 0;
    }
    let t = null;
    if (k === 1) for (let i = 0; i < 4 && !t; i++) { const q = slotP(m, p.seat, i); if (q && q !== p && freeP(m, q) && q.stat.pow > p.stat.pow) t = q; } // 0xD65C
    if (!t) for (let i = 4; i <= 12 && !t; i++) { const q = slotP(m, p.seat, i); if (q && q !== p && freeP(m, q) && q.stat.pow > p.stat.pow) t = q; } // 0xD664
    if (!t) { aim(); setPlan(4); return 0; }
    m.e214 = t.pid;
    const u = m.rng.next() & 0xff; // 0xD646 -> 0xD4CA
    setPlan([0x10, 0x18, 0x14, 0x24][u < c[6] ? 0 : u < c[7] ? 1 : u < c[8] ? 2 : 3]);
    return 0;
  }

  if (cb.pf) { // plan 초기화
    cb.pf = false; cb.fresh = true;
    const q = cb.plan;
    if (q === 0x1c) cb.sub = air ? 4 : 0; // 0x8398
    else if (q !== 0x28) cb.sub = 0;
    if (p.hasBall) {
      if (q === 4 && air) { m.e21e = oc ? oc.pid : null; cb.sub = 0x24; faceTo(p, tgt21()); return chargeNow(m, p); } // 0xCE06
      if (q === 0x10 && air) { startPass(); return windNow(p); } // 0xCF22
      if ((q === 0x0c || q === 0x18) && !air) return jumpNow(q === 0x18); // 0xCED2 / 0xCFD4 [판독만: 외야 plan 0x0C/0x18]
    }
  }
  const pl = cb.plan;

  if (p.charging) { // 서브 0x24 = 0xCA0C
    if (cb.sub !== 0x24) { cb.sub = 0x24; faceTo(p, tgt21()); }
    const n = p.charge + 1;
    if (n > 15) return 0;
    return (m.rng.next() & 0xff) < 0x40 ? 0 : BIT.B;
  }
  if (air) { // 서브 4
    const first = cb.sub !== 4 || cb.fresh;
    cb.sub = 4; cb.fresh = false;
    const landing = p.z + (p.vz - g) < 0;
    if (pl === 0x28) return 0; // 0xD2C0
    const thr = pl === 0x0c || pl === 0x20, pas = pl === 0x18 || pl === 0x24; // [판독만] 외야의 점프 투구·패스 plan 은 하네스 시나리오에 나오지 않는다
    if (!p.hasBall || (!thr && !pas)) { cb.airC75a = true; return 0; } // 0xC75A
    if (first) { faceTo(p, pas ? tgt14() : tgt21()); cb.tm = (m.rng.next() & 7) + 8; }
    if (landing) return 0;
    cb.tm = (cb.tm - 1) & 0xffff;
    if (cb.tm !== 0) return 0;
    return pas ? startPass() : startThrow();
  }

  // ---- 지상 ----
  const walkPt = (onArrive) => { // 대기점으로 걷기 [0x9248 + 0x9E2A + 0xD788 + 0x6FEE]. 영역 클램프 없음
    if (cb.fresh) { cb.fresh = false; pickOutPoint(m, p, cb); }
    const v = velToward(m, p, cb.tx, cb.ty, false);
    outFace(m, p, v);
    if (arrived(p, v, cb.tx, cb.ty, 4)) { moveNow(m, p, v, false); return onArrive(v); }
    p.aiVel = v; p.aiFree = true;
    return 0;
  };
  const wait = (then) => { // 0xC732 / 0xCE40 / 0xC014
    p.aiVel = [0, 0];
    cb.tm = (cb.tm - 1) & 0xffff;
    return cb.tm === 0 ? then() : 0;
  };
  if (cb.sub === 8 && pl !== 0x1c) { setPlan(0); p.aiVel = [0, 0]; return 0; } // 0xC7A4
  if (!p.hasBall && pl !== 0x1c && pl !== 0x28) { setPlan(0); p.aiVel = [0, 0]; return 0; } // 공을 잃은 채 남은 공격 plan: 원작은 발사 때 plan 0 으로 돌아간다(0xC804/0xC862)
  switch (pl) {
    case 4: // 0xCE40
      if (cb.fresh) { cb.fresh = false; faceTo(p, tgt21()); cb.tm = (c[13] | 0) + 1; }
      p.aiKeepV = [p.vx, p.vy]; // 0xCE40 은 이동도 속도 지우기도 없다: 값만 남는다 [실측 out_fetch_top f64]
      return wait(startThrow);
    case 8: return walkPt((v) => { p.aiKeepV = v; return startThrow(); }); // 0xCEA6 [판독만]
    case 0x10: // 0xC014
      if (cb.fresh) { cb.fresh = false; faceTo(p, tgt14()); cb.tm = (c[13] | 0) + 1; }
      return wait(startPass);
    case 0x14: return walkPt((v) => { p.aiKeepV = v; return startPass(); }); // 0xCFA2 [판독만]
    case 0x20: case 0x24: return walkPt(() => cpuJump(p, [0, 0])); // 0xD218: 도착하면 속도 0 뒤 점프 [판독만]
    case 0x1c: { // 0xD066 (공 없음)
      if (p.hasBall) { setPlan(0); p.aiVel = [0, 0]; return 0; }
      let bits = 0;
      if (fl(ball.z) >= 0x18 && boxXY(m, p, p.hb)) p.aiVel = [0, 0];
      else {
        const v = velToward(m, p, fl(ball.x), fl(ball.y), false);
        m.faceByVel(p, v[0], v[1]);
        const x0 = p.x, y0 = p.y;
        moveNow(m, p, v, true);
        if (ball.mode === BM.LOOSE && !m.tip.on && m.boxHit(p, p.hb)) { bits = BIT.B; p.aiKeepV = v; cb.sub = 8; } // 잡으면 서브 8(0xD180/0xD1CC). 못 잡고 끝나면 서브 0
        else { p.x = x0; p.y = y0; p.aiVel = v; if (oc && oc.hasBall) setPlan(0); }
      }
      if (!sameZone(m, p) || ball.mode !== BM.LOOSE) setPlan(0);
      return bits;
    }
    default: // 0x0C/0x18/0x28 서브0 = 0xC732 (0x28 은 확인, 0x0C/0x18 은 [판독만])
      if (cb.fresh) { cb.fresh = false; cb.tm = (c[13] | 0) + 1; }
      faceBall(m, p);
      return wait(() => { setPlan(0); return 0; });
  }
}

const active0 = (m, p) => m.sides[p.seat].ctrl === p.pid && !m.humans[p.seat];
/** 컴퓨터형 내야 1프레임. 엔진 자세(캐치·웅크림·점프·줍기·선 이탈 등)가 도는 동안은 입력 없음, 끝나면 원작처럼 서브0 부터 다시 */
function infieldRom(m, p, canAct) {
  const cb = cbOf(p), ball = m.ball;
  if (cb.has && (p.z > 0 || p.vz !== 0) && active0(m, p)) { cb.land48 = true; p.aiHold = true; p.aiNoHit = true; } // 이 프레임 = plan 0 결정 프레임(0xBC42: 공중이면 plan 0x48): 물리 없음 // 공중에서 공을 놓았다(투구·패스): plan 0 -> 공중이면 0x48(0xBC68) -> 착지(0xC75A -> 0xD90E)도 0x48
  if (cb.has) cb.sub = 0; // 공을 놓으면 서브 0(공중이면 4)부터 (0x7208 -> 0x8398)
  cb.has = false; cb.slid = false;
  const active = m.sides[p.seat].ctrl === p.pid && !m.humans[p.seat];
  if (cb.act !== active) { // 타입 전환(0x8204 수동 / 0x8228 활성): 서브 초기화, 활성이 되면 plan 0
    cb.act = active; cb.sub = 0; cb.fresh = true; cb.busy = 0;
    if (active) { cb.plan = 0; cb.pf = true; }
  }
  if (!canAct) {
    // 수동 내야의 패스 가로채기 자세(서브 0x14, 0x8E0C): 패스 공이 사라지면 자세를 풀고 서브 0x10 으로
    if (!active && cb.sub === 0x14 && p.st === ST.CATCH && ball.mode !== BM.PASS) { p.st = ST.IDLE; p.tm = 0; cb.sub = 0x10; cb.fresh = true; cb.busy = 0; return 0; }
    cb.busy = p.st;
    return 0;
  }
  if (cb.busy) {
    const was = cb.busy;
    cb.busy = 0; cb.sub = 0; cb.fresh = true;
    const l48 = cb.land48; cb.land48 = false;
    if (was === ST.FOUL && !active) { cb.plan = 0x2c; cb.pf = true; } // 선 이탈 복귀 끝(0x9848): plan 0x2C(외야 0x28) -> 수동 내야는 곧바로 새 대기점을 고른다(0x8EDE). 활성 선수는 타입 재설정(0x8228)이 plan 0 으로 [실측 atk_seed3 f249]
    if (active) {
      if ((was === ST.JUMP && (cb.plan === 0x40 || l48)) || was === ST.CROUCH) { cb.plan = 0x48; cb.pf = true; } // 0xD90E
      else if (was === ST.PICKUP) { cb.plan = 0x2c; cb.pf = true; } // 0xC946
      else if (was !== ST.CATCH) { cb.plan = 0; cb.pf = true; }
    }
  }
  return active ? activeRom(m, p, cb) : passiveRom(m, p, cb);
}

/**
 * 강제 회수(타입 0x44) [직역 ROM 0x9590]. 방치된 정지 공(0x86A6)이나 양쪽 구역 밖 공(0x8622)을 가지러 간다. 반환 null = 회수 끝(평소 타입으로)
 * 서브0(0x95C8): 공이 높이 24 이상이고 내 히트박스와 겹치면 선다. 아니면 공으로 빠른 이동(0x9E6A, 영역 클램프·피격 판정 없음).
 *   이동 뒤 공이 내 담당 구역이 아니거나(0xD52C) 누가 들었으면 끝. 공에 닿으면 캐치 자세/줍기(0x77D4)
 * 획득 뒤(0x96DA/0x9734): 선 밖이면(0x88EA) 슬롯 기본 위치로 빠른 이동(서브8, 0x9646), ±4 안이면 그 자리(정수부)로 맞추고 끝. 선 안이면 바로 끝
 */
function retrieveRom(m, p, canAct) {
  const t = p.t44, ball = m.ball;
  p.aiFree = true; // 강제 회수의 줍기(0x96F2)·캐치 자세(0x968C)에도 이동 허용영역 클램프가 없다
  if (!canAct) return 0;
  if (p.hasBall) {
    if (t.sub !== 8) {
      if (!m.outOfLine(p)) { p.t44 = null; return null; }
      const [hx, hy] = m.slotPos(p.seat, p.slot);
      t.sub = 8; t.tx = Math.floor(hx); t.ty = Math.floor(hy);
    }
    const v = velToward(m, p, t.tx, t.ty, true);
    m.faceByVel(p, v[0], v[1]);
    if (arrived(p, v, t.tx, t.ty, 4)) {
      moveNow(m, p, v, false);
      p.x = t.tx * ONE + (p.x & 0xffff); p.y = t.ty * ONE + (p.y & 0xffff);
      p.t44 = null;
      return 0;
    }
    p.aiVel = v; p.aiFree = true;
    return 0;
  }
  if (t.sub === 8) { p.t44 = null; return null; }
  if (fl(ball.z) >= 0x18 && boxXY(m, p, p.hb)) { p.aiVel = [0, 0]; return 0; }
  const v = velToward(m, p, fl(ball.x), fl(ball.y), true);
  m.faceByVel(p, v[0], v[1]);
  p.aiVel = v; p.aiFree = true;
  if (!sameZone(m, p) || ball.mode === BM.HELD) { p.t44 = null; return 0; }
  const x0 = p.x, y0 = p.y;
  moveNow(m, p, v, false);
  if (ball.mode === BM.LOOSE && !m.tip.on && m.boxHit(p, p.hb)) return BIT.B; // 0x962C: 속도를 지운 뒤 자세로
  p.x = x0; p.y = y0; p.aiVel = v;
  return 0;
}

/**
 * 컴퓨터형 선수 1프레임의 입력 비트.
 * [직역] 컴퓨터형 핸들러는 캐치 자세/줍기(0x77D4)·웅크림(0x77F8)에 패드 없이 곧바로 분기한다(강제 회수 0x9634, 활성 내야 plan 0x28, 활성 외야 plan 0x1C, 외야 대기 0x9D8A, 수동 내야 0x8E82/0x90A6).
 * '직전 프레임에 눌렀는가'라는 기억이 없다. 엔진은 이를 A/B 를 새로 누른 것으로 옮기므로, 지상에서 공 없이 설 수 있는 선수가 A/B 를 내면 직전 입력의 그 비트를 지워 매번 새 누름이 되게 한다.
 * (자세에 들어간 프레임에 활성 선수 교체·강제 회수 전환(0x86A6/0x88B8 -> 타입 재설정, 서브 0)으로 자세가 풀리면 다음 프레임 핸들러가 다시 0x77D4 로 간다. 종전에는 직전 입력에 B 가 남아 영영 자세에 못 들어갔다 — 정검수 4차 High-1)
 */
export function aiInput(m, p) {
  const bits = aiInputRaw(m, p);
  const AB = bits & (BIT.A | BIT.B);
  if (AB && (p.prev & AB) && m.R.cpu.rom && m.data.rom && !p.hasBall && !p.charging && !(p.z > 0 || p.vz !== 0) && (p.st === ST.IDLE || p.st === ST.DASH || p.st === ST.BRAKE)) p.prev &= ~AB;
  return bits;
}

function aiInputRaw(m, p) {
  const R = m.R, ball = m.ball, c = p.cfg;
  p.aiDash = false; p.aiVel = null; p.aiFree = false;
  if (!m.usable(p)) return 0;
  const romAi = !!(R.cpu.rom && m.data.rom);
  const cbReset = () => { if (p.cb) { p.cb.sub = 0; p.cb.fresh = true; p.cb.busy = 0; p.cb.plan = 0; p.cb.pf = true; } }; // 피격·쓰러짐·공 보유 뒤에는 타입이 다시 설정된다(서브 0, plan 0)
  if (p.st === ST.HIT || p.st === ST.DOWN || p.st === ST.THROW || p.st === ST.PASS) { cbReset(); return 0; }
  if (romAi && p.t44) { // 강제 회수(타입 0x44)
    const r = retrieveRom(m, p, p.st === ST.IDLE || p.st === ST.DASH || p.st === ST.BRAKE);
    if (r !== null) return r;
  }
  const fwd = p.seat === 0 ? BIT.RIGHT : BIT.LEFT;
  const tune = m.aiTune?.[p.seat] ?? null; // 컴퓨터 대전 난이도(없으면 기본 AI)

  // 컴퓨터 활성 외야(타입 0x74) 직역. 비활성 외야는 아래 outfieldRom(타입 0x24/0x28)
  if (romAi && p.role === 'out' && !m.humans[p.seat] && m.sides[p.seat].ctrl === p.pid && !m.fm && !m.tip.on) return outActiveRom(m, p);
  if (p.role === 'out' && p.cb) p.cb.act = false;
  // 컴퓨터 활성 내야의 공격 plan 직역(0xBC8E~). 그 밖의 보유자(활성이 아닌 보유자·포메이션 중)는 아래 종전 규칙
  if (romAi && p.hasBall && p.role === 'in' && !m.humans[p.seat] && m.sides[p.seat].ctrl === p.pid && !m.fm && !m.tip.on) return attackRom(m, p, cbOf(p));
  // --- 공 보유: 지연 후 조준 -> 차지 -> 발사 ---
  if (p.hasBall) {
    cbReset();
    let pl = p.plan;
    if (!pl) {
      const group = m.rng.int(256) < (tune?.aimFwd256 ?? 215) ? 0 : 1 + m.rng.int(3);
      const aimBit = group === 0 ? fwd : group === 1 ? BIT.UP : group === 2 ? BIT.DOWN : (fwd === BIT.RIGHT ? BIT.LEFT : BIT.RIGHT);
      const hasMate = m.players.some((q) => q.seat === p.seat && q !== p && m.usable(q) && q.role !== p.role);
      pl = p.plan = {
        t: 0, delay: R.ai.holdDelayBase + c[13] * R.ai.holdDelayPerB13 + m.rng.int(20) + (tune?.holdDelayAdd ?? 0), aimBit,
        pass: hasMate && m.rng.int(100) < (p.role === 'out' ? 5 : 8),
        charge: R.ai.chargeMin + m.rng.int(R.ai.chargeMax - R.ai.chargeMin + 1),
      };
      // 컴퓨터 필살기: 내야 슬롯 + 확률(specialChance256, 0 이면 난수를 소비하지 않아 기존 결과와 동일)
      const spc = m.aiSpecial?.[p.seat] ?? 0;
      if (spc > 0 && !pl.pass && R.special?.enabled && p.slot <= R.special.maxSlot && m.rng.int(256) < spc) {
        pl.sp = { jumped: false, held: 0, hold: R.special.minCharge + m.rng.int(R.special.maxCharge - R.special.minCharge + 1) };
      }
    }
    pl.t++;
    const k = pl.t - pl.delay;
    // 원작: 공을 받은 내야는 발사선(좌석0 x=224 / 좌석1 x=288, ROM 0xD6CA)까지 달려가 도착하면 던진다. 도착 전에는 지연 타이머를 멈춘다
    if (tune?.origSpeed && p.role === 'in' && !pl.sp && !pl.pass && (pl.walk = (pl.walk ?? 0) + 1) < 150) {
      const lx = (p.seat === 0 ? 224 : 288) * ONE;
      if (p.seat === 0 ? p.x < lx - px(4) : p.x > lx + px(4)) { pl.t--; return chaseMove(m, p, lx, p.y, 3, tune); }
    }
    if (k < 0) return 0;
    if (pl.sp) { // 필살기 시도: 사람과 같은 입력(점프 C -> 공중에서 B 13~15프레임 홀드 -> 뗌). 성립 여부는 엔진이 판정
      const air = p.z > 0 || p.vz > 0;
      if (k === 0) return pl.aimBit;
      if (!air && !pl.sp.jumped) {
        if (k <= 6) return BIT.C; // 점프 입력(상태가 안 맞으면 몇 프레임 재시도)
        pl.sp = null; pl.t = pl.delay + 1; // 점프 실패: 일반 투구로 전환
        return BIT.B;
      }
      if (air) {
        pl.sp.jumped = true;
        if (++pl.sp.held <= pl.sp.hold) return BIT.B;
        return 0; // 뗌 -> 엔진이 공중 차지 13~15 로 필살기 판정
      }
      return 0; // 착지(필살기 창 놓침): 뗌 -> 일반 투구
    }
    if (k === 0) return pl.pass ? 0 : pl.aimBit;
    if (pl.pass) return BIT.A;
    if (k === 1) return BIT.B;
    if (k <= 1 + pl.charge) return BIT.B;
    return 0; // 떼면 발사
  }
  p.plan = null;
  if (p.charging) return 0;
  const canAct = p.st === ST.IDLE || p.st === ST.DASH || p.st === ST.BRAKE;
  if (romAi && p.role === 'out') return outfieldRom(m, p, canAct);
  if (romAi) return infieldRom(m, p, canAct); // 컴퓨터형 내야(수동 0x20 / 활성 0x70) 직역. 아래는 rules.cpu.rom 이 꺼졌을 때의 종전 자작 규칙
  if (romAi && canAct) faceBall(m, p); // 컴퓨터형 내야도 대기 중 매 프레임 공 쪽을 본다 [직역 ROM 0x8D3E -> 0x8E50]

  // --- 방어: 날아오는 상대 공에 반응 ---
  const A = p.ai;
  if (p.role === 'in' && ball.mode === BM.FLY && m.players[ball.thrower].seat !== p.seat) {
    if (A.last !== ball.id) {
      A.last = ball.id; A.act = null;
      if (ball.tgt === p.pid) {
        // 원작 방어 결정(ROM 0xD5F0): 상대 투구 시작 시 b9..b12 누적 임계값(8비트 난수)으로 5택 -> 0 서있기, 1 캐치, 2 웅크리기, 3 점프, 4 옆걸음.
        // (종전 코드는 공격용 표 b2..b5 를 방어에 써서 캐치 구간이 평균 9% 였다. 원작 방어표 평균 캐치 구간은 43%.) [확인 analysis/18]
        const r = m.rng.next() & 0xff;
        const tbl = [0, 2, 4, 3, 1]; // 선택 순번 -> 웹 행동코드(0 stay 1 sidestep 2 catch 3 jump 4 crouch)
        let act = (m.official ? [0, 2, 4, 2, 0] : tbl)[r < c[9] ? 0 : r < c[10] ? 1 : r < c[11] ? 2 : r < c[12] ? 3 : 4]; // こうしき 표 0xD624: 점프 -> 캐치, 옆걸음 -> 서기
        if (tune && m.rng.int(256) < tune.blunder256) act = 0; // 난이도: 방어 실수(레벨 1 만 사용)
        const c256 = (tune?.catch256 ?? 0) + (m.cpuBoost ? boostOf(m, p)?.catch256 ?? 0 : 0);
        if (c256 && act !== 2 && m.rng.int(256) < c256) act = 2; // 선택 보정(기본 0, 컴퓨터 단계 보정 포함)
        A.act = { act, box: act === 3 ? 80 : 34, dir: m.rng.int(2) ? BIT.UP : BIT.DOWN, fired: 0 };
      }
    }
    const a = A.act;
    if (a && canAct) {
      const dx = toPx(ball.x - p.x), dy = toPx(ball.y - p.y), dist = Math.hypot(dx, dy);
      const closing = dx * ball.vx + dy * ball.vy < 0;
      void dist;
      // 원작: 공이 선수 중심 +-32px 상자(히트박스 12, 점프는 +-80px 상자 13)에 들어오면 행동 개시(ROM 0x6CE8) [확인]
      if (closing && Math.abs(dx) <= a.box && Math.abs(dy) <= a.box) {
        if (a.act === 2 && !a.fired) { a.fired = 1; return BIT.B; }
        if (a.act === 3 && !a.fired) { a.fired = 1; return BIT.C; }
        if (a.act === 4 && !a.fired) { a.fired = 1; return BIT.A; }
        if (a.act === 1) return a.dir;
      }
    }
    if (a && tune?.origSpeed) { if (romAi && canAct) p.aiVel = [0, 0]; return 0; } // 원작: 방어 결정을 내린 선수는 제자리에서 공이 상자에 들어오길 기다린다(plan 핸들러가 속도를 0 으로 지운다, ROM 0xC3F2 등). 미끄러지며 멈추는 제동은 원작 CPU 에 없다
  } else if (ball.mode !== BM.FLY) A.act = null;

  if (!canAct) return 0;
  if (romAi && p.role === 'in' && ball.mode === BM.HELD) {
    // 원작 방어 결정 시점 = 상대가 투구 동작(서브 0x0C)을 시작한 프레임(릴리스 10프레임 전, ROM 0xD5F0). 그때부터 대상 선수는 속도 0 으로 선다 [확인 analysis/18 §1]
    const h = m.players[ball.holder];
    if (h && h.seat !== p.seat && h.wind && h.wind.tgt === p.pid) { p.aiVel = [0, 0]; return 0; }
  }
  if (romAi && p.role === 'in' && !(m.sides[p.seat].ctrl === p.pid && !m.humans[p.seat])) {
    // 수동 내야(타입 0x20, 0x8D02 서브0) [직역]: 위험한 투구 공(공 $3 bit6)이 히트박스 12(64x64, 높이 무시)에 들어오면 웅크림(0x8E82),
    // 상대편 패스 공(bit7)이 높이 48 이하로 같은 상자에 들어오면 캐치 자세(0x90A6)
    if (ball.mode === BM.FLY && !ball.sp && m.players[ball.thrower].seat !== p.seat && !A.act && boxXY(m, p, 12)) return BIT.A;
    if (ball.mode === BM.PASS && m.players[ball.thrower].seat !== p.seat && fl(ball.z) <= 0x30 && boxXY(m, p, 12)) return BIT.B;
  }

  // --- 공 주우러 가기: 팀에서 공에 가장 가까운 내야 1명 ---
  if (ball.mode === BM.LOOSE || ball.mode === BM.DROP) {
    const slow = Math.abs(ball.vx) + Math.abs(ball.vy) < ONE * 1.5;
    // rom 모드: 원작 수동 내야(타입 0x20, 0x8D02)에는 공을 가지러 가는 동작이 없다. 컴퓨터 사이드의 활성 선수(타입 0x70, 사이드 $18)만 간다 [실측 tools/diff ctrl_stop_in: 사람 편 동료는 정지 공을 줍지 않음]
    if (slow && p.role === 'in' && (!romAi || (!m.humans[p.seat] && m.sides[p.seat].ctrl === p.pid))) {
      const f = romAi ? p.pid : m.nearestInfield(p.seat, ball.x, ball.y, (q) => m.usable(q) && q.st !== ST.HIT && q.st !== ST.DOWN);
      if (f === p.pid) {
        // 공에 닿으면(현재 히트박스와 공의 겹침, 0x6C44) 캐치 자세/줍기로 [직역 ROM 0x9624~0x9634 -> 0x77D4]. 자동 습득(자작)은 쓰지 않는다
        if (romAi && ball.mode === BM.LOOSE && !m.tip.on && m.boxHit(p, p.hb)) return BIT.B;
        return chaseMove(m, p, ball.x, ball.y, 2, tune);
      }
    }
  }

  // --- 평상시: 홈 슬롯 주변 배회(외야는 공 쪽 정렬) ---
  const [hx, hy] = m.slotPos(p.seat, p.slot);
  let tx = hx * ONE, ty = hy * ONE, chasing = false;
  if (p.role === 'in') {
    if (tune?.origSpeed) {
      const h = ball.holder >= 0 ? m.players[ball.holder] : null;
      if (h && h.seat !== p.seat && (h.charging || h.st === ST.CHARGE)) return 0; // 상대가 차지 중이면 이동을 멈추고 방어 태세(원작은 투구 시작 프레임에 방어를 결정)
    }
    if (tune?.origSpeed) { // 원작식: 공 구역별 대기점으로 빠르게 이동(ROM 0x8F52 + 0x9E62), 약 60f 마다 1/2 확률로 재선택
      const w = idlePoint(m, p);
      return chaseMove(m, p, w.x, w.y, 6, tune);
    }
    if (!p.wander || m.f - p.wander.f > 40 + (p.pid % 7) * 5) p.wander = { f: m.f, x: (m.rng.int(33) - 16) * ONE, y: (m.rng.int(33) - 16) * ONE };
    tx += p.wander.x; ty += p.wander.y;
    // 우리가 공을 갖고 있으면 조금 전진
    if (ball.holder >= 0 && m.players[ball.holder].seat === p.seat) tx += (p.seat === 0 ? 1 : -1) * 12 * ONE;
  } else {
    const g = slotGroup(p.slot);
    // 레벨 플래그 outChase: 공이 자기 구역에 멈출 예정이면 현재 위치가 아니라 정지 예상 지점으로 선행 이동(대시 포함)
    let bx = ball.x, by = ball.y;
    if (tune?.outChase && ball.mode === BM.LOOSE) {
      const r = m.predictRest();
      if (r) {
        // 자기 구역에 멈출 공, 또는 코트 안쪽이지만 자기 띠에서 outReach 이내(띠와 직각 방향 거리)에 멈출 공: 띠 안에서 그 축으로 접근해 줍는다
        const near = Math.abs(g === 3 ? r.x - p.x : r.y - p.y) <= px(tune.outReach ?? 12);
        if (near || m.ballZone(p.seat, r.x, r.y) === g) { bx = r.x; by = r.y; chasing = true; }
      }
    }
    if (g === 3) ty = Math.min(Math.max(by, 40 * ONE), 216 * ONE);
    else tx = bx;
  }
  return p.role === 'out' && chasing ? chaseMove(m, p, tx, ty, 6, tune) : moveToward(p, tx, ty, 6);
}
