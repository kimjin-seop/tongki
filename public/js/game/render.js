// 경기 화면 렌더러: 논리 해상도 398x224(16:9 와이드). 원작 320x224 에서 세로는 그대로, 가로만 좌우 39px 씩 넓혀
// 카메라가 필드를 더 넓게 본다(세계 평면 512 폭 안). 확대는 CSS(util.fitScale) + image-rendering: pixelated.
// 투영(05_match_rules.md §1): 화면x = x - 카메라, 화면y = y/2 - z + 96 (VDP 오프셋 0xE0-0x80)
// 카메라(this.cam)는 와이드 화면 왼쪽 끝의 세계 x. 원작 기준 카메라(320 화면 왼쪽) = cam + DW
import { lerpPos, splinePos } from './snaps.js';
import { LOOP_IDS, specialAnim, specialPalKey, specialHidden, specialGhosts, paletteSheet, chargePalKey } from './special.js';

export const W = 398, H = 224;
export const BASE_W = 320; // 원작 화면 폭
export const DW = (W - BASE_W) / 2; // 원작 화면 대비 좌우 확장 폭(39)
const PLANE_W = 512; // 배경 평면(=세계) 폭
const Y0 = 96;
const ST = { IDLE: 0, JUMP: 1, DASH: 2, BRAKE: 3, CHARGE: 4, THROW: 5, PASS: 6, CATCH: 7, CROUCH: 8, PICKUP: 9, HIT: 10, DOWN: 11, OUTMOVE: 12, DEAD: 13, GONE: 14, FOUL: 15 }; // FOUL = 선 이탈(원작 타입 0x48)
const FL = { CHARGING: 1, DASHJUMP: 2, OUT: 4, DEAD: 8, BALL: 16, TIP: 32, SLIDE: 64, BACK: 128 }; // BACK = 뒤 보기(원작 $3 bit1)
const SQ_REF_IN = 2, SQ_GO = 4; // 시작 연출 단계(PROTOCOL 5.5): 0 입장, 1 HUD 대기, 2 심판 등장, 3 대기, 4 GO ...
const BACK_Y = 128; // 입장 도착 자세: y>=128 뒷모습(08 §2). 좌우(x>=256 왼쪽)는 서버 face 로 온다
const BM = { HELD: 0, FLY: 1, PASS: 2, LOOSE: 3, DROP: 4 };
const CAM_CENTER = 96; // stage_00.json camera.center
// 조작 표식(16x16) 위치. 원작 실측(ctrl0 SAT, 2026-11-17): 표식 top = 발 화면y - 60 상수(공 보유·점프·좌석 무관,
// x = 선수x - 8). 원작은 머리 높이를 보지 않아 키 작은 선수·웅크림은 간격이 11~18px 로 벌어지고 점프는 머리에 겹친다.
// 웹은 그린 프레임의 실제 머리 top(시트 알파 첫 행) 위 MARKER_GAP 에 붙인다(원작 표준 서기 간격 6~7px).
// 머리 top 을 구하지 못하면(시트 없음·읽기 실패) 원작 상수 MARKER_DY 사용
const MARKER_DY = 60, MARKER_GAP = 6, MARKER_H = 16;
// 카메라(원작 0x3322→0x3336, 0x32D8/0x32FE, 0x31BE 판독 + 에뮬레이터 실측 ctrl0): 원작 범위 0~191(=512-320-1), 준비 단계는 96 고정.
// 프레임당 이동량 = clamp(대상 화면x - 목표 화면x, ±4) (가속 없음: 실측 첫 프레임부터 4px). 목표 화면x(원작 320 화면 기준):
// - 공 보유: 보유자가 상대 쪽을 보면 좌석0=48, 좌석1=272, 아니면 160 (실측: 좌석0 내야 보유자 화면x 48, 좌석1 외야 보유자 272)
// - 투구·패스 비행: 던진 좌석0=48/좌석1=272 기준, 공 진행 방향으로만 이동(반대 방향 차이는 0) (실측: 좌석1 패스 중 공 화면x 272 유지)
// - 그 밖(굴러가는/정지 공): 공 화면x 160 (실측: 정지 공 화면x 160)
// 와이드: 화면이 평면 밖을 보지 않게 0~(191-78)=113. 원작 목표 화면x 는 +DW, 서버 cam(원작 기준)은 -DW 해서 쓴다.
const CAM_LIMIT = PLANE_W - W - 1, CAM_VMAX = 4;
const CAM_SX = { near: 48, center: 160, far: 272 }; // 원작 목표 화면x
const FAST_SPEED = 6; // 강투구 기준 공속 $74>=0x600 (8.8 고정소수 px/틱)
// 선수가 든 공 위치(원작 보유 공 핸들러 0xA2BA). 공 world = 선수 + (반전 시 -dx, dy, dz).
// HAND[몸통 클래스($3C)][애니] = 프레임별 [dx, dz, ...] (ROM 0x39F6C, 프레임 수보다 짧으면 마지막 값),
// HAND_DY[애니] = dy (ROM 0x3A13A, 모든 클래스·프레임 동일). dy>0 이면 공이 선수 앞(위 레이어), <0 이면 뒤.
// 에뮬레이터 SAT 실측(ctrl0): stand 공 z=선수+10, 공 스프라이트 24x24 좌상단 = (공x-12, 공y/2-공z+96-24), 반전 없음
const HAND_DY = { walk_a: 2, walk_b: -2, dash: 2, throw_a: 2, throw_b: 2, unk0A: 2, unk0C: -2, stand_a: 2, stand_b: -2, jump_a: 2, jump_b: -2, duck_a: 2, duck_b: -2, hit_a: 2, hit_b: -2, down: 2, catch_a: 2, catch_b: -2, unk24: 2, unk26: -2, pass_a: 2, pass_b: 2, jumpthrow_a: 2, jumpthrow_b: 2 };
const HAND = [
  { walk_a: [6, 9, 6, 10, 6, 9, 6, 10], walk_b: [6, 10, 6, 9, 6, 10, 6, 9], dash: [10, 10, 6, 10, 10, 10, 6, 10], throw_a: [-8, 20], throw_b: [10, 22], unk0A: [6, 10], unk0C: [6, 10], stand_a: [6, 10], stand_b: [6, 10], jump_a: [4, 14], jump_b: [2, 17], duck_a: [6, 10], duck_b: [6, 10], hit_a: [6, 10], hit_b: [6, 10], down: [6, 10], catch_a: [6, 10], catch_b: [6, 10], unk24: [6, 10], unk26: [6, 10], pass_a: [-8, 20], pass_b: [10, 22], jumpthrow_a: [-8, 20], jumpthrow_b: [10, 22] },
  { walk_a: [6, 11, 6, 12, 6, 11, 6, 12], walk_b: [8, 11, 8, 12, 8, 11, 8, 12], dash: [10, 12, 6, 12, 10, 12, 6, 12], throw_a: [-7, 25], throw_b: [6, 23], unk0A: [6, 10], unk0C: [6, 10], stand_a: [4, 12], stand_b: [6, 12], jump_a: [6, 19], jump_b: [4, 21], duck_a: [6, 10], duck_b: [6, 10], hit_a: [6, 10], hit_b: [6, 10], down: [6, 10], catch_a: [4, 11], catch_b: [6, 11], unk24: [6, 10], unk26: [6, 10], pass_a: [-7, 25], pass_b: [6, 23], jumpthrow_a: [-7, 25], jumpthrow_b: [6, 23] },
  { walk_a: [8, 13, 8, 14, 8, 13, 8, 14], walk_b: [8, 13, 8, 14, 8, 13, 8, 14], dash: [12, 14, 8, 14, 10, 14, 8, 14], throw_a: [-7, 30], throw_b: [10, 31], unk0A: [6, 10], unk0C: [6, 10], stand_a: [7, 15], stand_b: [6, 14], jump_a: [5, 18], jump_b: [4, 26], duck_a: [6, 10], duck_b: [6, 10], hit_a: [6, 10], hit_b: [6, 10], down: [6, 10], catch_a: [7, 15], catch_b: [6, 13], unk24: [6, 10], unk26: [6, 10], pass_a: [-7, 30], pass_b: [10, 31], jumpthrow_a: [-7, 30], jumpthrow_b: [10, 31] },
];
const CUE_TICKS = 12; // 필살기 발동 시 투구 선수 반짝임 길이(임의값, 원작 근거 없음)
// stage_00(parallax 필드 없음) 규칙: 근경 = -cam, 원경 = -(96 + floor((cam-96)*3/4))
const DEFAULT_PARALLAX = {
  near_rows: [{ rows: [0, 27], factor: 1, rounding: 'floor' }],
  far_rows: [{ rows: [0, 11], factor: 0.75, rounding: 'floor' }],
};

/** stage_NN.json → 렌더러 시차 표. parallax 가 없으면 layers.*.scroll_factor(floor), 그것도 없으면 stage_00 기본 */
export function parallaxOf(sj) {
  const p = sj?.parallax;
  const ok = (a) => Array.isArray(a) && a.length && a.every((r) => Array.isArray(r?.rows) && Number.isFinite(r.factor));
  if (p && ok(p.near_rows) && ok(p.far_rows)) return { near_rows: p.near_rows, far_rows: p.far_rows };
  const nf = sj?.layers?.near?.scroll_factor, ff = sj?.layers?.far?.scroll_factor;
  return {
    near_rows: [{ rows: [0, 27], factor: Number.isFinite(nf) ? nf : 1, rounding: 'floor' }],
    far_rows: [{ rows: [0, 11], factor: Number.isFinite(ff) ? ff : 0.75, rounding: 'floor' }],
  };
}

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{sheets:[HTMLImageElement|null, HTMLImageElement|null], anims:any, bodyClass:[number[],number[]], cell:number, origin:[number,number], you:number, hud?:import('./hud.js').Hud}} o
   */
  constructor(canvas, o) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    Object.assign(this, o);
    this.cam = null;
    this.mem = Array.from({ length: 14 }, () => ({ left: false, back: false }));
    this.fx = [];
    this.animIndex = buildAnimIndex(o.anims);
    this.bodyClass ??= [[], []];
    this.sp = null; // 진행 중 필살기 {id, start, dir}
    this.hist = []; // 필살기 공 위치 이력 {f, pos} (잔상 패턴 0x04)
    this.palCache = new Map();
    this.cue = null; // 필살기 발동 선수 반응 {pid, until}
    this.ready ??= false; // 에셋 로딩(성공/실패) 완료 전에는 검은 화면만 그린다
  }

  /** 이벤트 시각효과(피격/캐치 번쩍임) */
  flash(x, y, z, kind, tick) { this.fx.push({ x, y, z, kind, until: tick + 12 }); }

  /** 필살기 발동(special 이벤트): 투구 선수 짧은 반짝임 */
  specialCue(pid, tick) { this.cue = { pid, until: tick + CUE_TICKS }; }

  draw(sm, stStart) {
    const g = this.g;
    const { a, b, t, tick } = sm;
    const kind = a.b[6] ?? 0;
    // 루프 계열은 스냅(2틱) 사이 원호가 직선으로 꺾여 보이므로 곡선 보간
    const loop = LOOP_IDS.has(kind - 1) || LOOP_IDS.has((b.b[6] ?? 0) - 1);
    const ball = loop ? splinePos(sm.a0?.b, a.b, b.b, sm.b1?.b, t) : lerpPos(a.b, b.b, t);
    if (!this.ready) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return; } // 에셋 로딩 중: 대체 렌더 대신 검은 화면
    // 카메라: 서버 cam(시작 연출 중 96 고정). 필드가 없는 구버전 서버는 준비 단계만 고정.
    // 포메이션 중(a.fm)의 서버 cam(대기·패스 191/0)은 즉시 고정 대신 camGoal 로 틱당 4px 이동 후 고정
    const fixedCam = a.fm ? null : 'cam' in a ? a.cam : a.ph === 'ready' ? CAM_CENTER : null;

    // 심판(ref=null 이면 등장 전: 심판도 손에 든 공도 그리지 않는다). 특훈(a.tr, PROTOCOL §9.2)은 심판이 없어 ref 가 언제나 null 이지만 공을 그린다
    const ref = this.refState(a, b, t, tick);
    const hideBall = a.ref === null && !a.tr;
    if (ref && a.b[3] === BM.DROP) { ball[0] = ref.ball[0]; ball[1] = ref.ball[1]; ball[2] = ref.ball[2]; }
    const sq = a.sq?.[0];

    // 선수 + 공 + 심판을 깊이(y) 순으로
    const items = [];
    if (ref) items.push({ k: 'r', depth: ref.y });
    for (let pid = 0; pid < 14; pid++) {
      const pa = a.p[pid], pb = b.p[pid];
      // 아웃자는 쓰러진 뒤 외야 슬롯으로 걸어가(OUTMOVE) 외야에 선다(DEAD). 원작 에뮬레이터 실측: 아웃자 오브젝트가
      // 타입 0x4C(이동)로 빈 외야 슬롯까지 걸어간 뒤 외야 타입 0x24 로 남아 계속 보인다. 교체할 외야가 없어 퇴장(GONE)한 경우만 그리지 않는다
      if (pa[3] === ST.GONE) continue;
      const pos = lerpPos(pa, pb, t);
      // 걷기 판정용 속도: 렌더 틱이 최신 스냅에 닿으면(a==b, 스냅 도착이 늦은 프레임) a-b 차가 0 이라 서기 그림이 끼어 다리가 떨린다.
      // 그때는 직전 스냅(a0)→a 차로 잰다(원작은 걷는 동안 애니 0/2 유지, tools/diff/traces/oracle/walk_*.json)
      const [qa, qb, nf] = b.f > a.f ? [pa, pb, b.f - a.f] : [sm.a0?.p[pid] ?? pa, pa, a.f - (sm.a0?.f ?? a.f)];
      const dx = (qb[0] - qa[0]) / 16 / Math.max(1, nf), dy = (qb[1] - qa[1]) / 16 / Math.max(1, nf);
      items.push({ k: 'p', pid, pos, s: pa, dx, dy, depth: pos[1] });
    }
    // 선수 자세(방향·애니 프레임)를 먼저 정한다: 든 공 위치가 자세에 따라 달라진다
    for (const it of items) if (it.k === 'p') this.pose(it, a, ball, tick, stStart);
    const holder = a.b[3] === BM.HELD ? a.b[4] : -1;
    const holderItem = items.find((i) => i.pid === holder);
    // 든 공: 서버 공 위치(고정 손 오프셋) 대신 원작 손 위치 표로 그린다. 표에 없으면 서버 위치
    const held = holderItem && this.handPos(holderItem);
    if (!hideBall) items.push({ k: 'b', pos: held ?? ball, held: !!held, depth: held ? held[1] : holderItem ? holderItem.depth + 0.01 : ref && a.b[3] === BM.DROP ? ref.y + 0.01 : ball[1] });
    items.sort((p, q) => p.depth - q.depth);
    const bv = ballVel(a, b) ?? this.bv ?? { vx: 0, vy: 0, vz: 0 };
    this.bv = bv;
    // 카메라는 선수 자세(보유자 방향)가 정해진 뒤 계산하고, 배경은 그 카메라로 그린다
    const cam0 = fixedCam != null ? this.fixCam(fixedCam - DW, tick) : this.updateCam(this.camGoal(a, ball, holderItem, bv), tick);
    // 필살 명중 화면 흔들림(impact.js, 표시 전용): 세계 그림만 x = 카메라 표시값, y = 그리기 이동. this.cam·HUD 는 그대로
    const sk = this.impact?.shake(tick), cam = cam0 + (sk?.x ?? 0), skY = sk?.y ?? 0;
    if (skY) { g.save(); g.translate(0, skY); }
    this.background(cam);

    // 그림자 먼저 (배경 바로 위, 선수·공 아래). 공은 보유 중(선수·심판 손)이면 그림자 없음, 심판은 그림자 없음
    for (const it of items) {
      if (it.k === 'r' || (it.k === 'b' && (a.b[3] === BM.HELD || a.b[3] === BM.DROP))) continue;
      this.shadow(it.pos, cam, it.k === 'p');
    }
    this.trackSpecial(kind, a.f, ball, bv, tick);
    // 필살 임팩트 연출(impact.js): 오라 뒤층 → 선수·공 → 앞층(입자·명중)
    const ifx = this.impact && { cam, tick, kind, sy: skY, ball: a.b[3] === BM.HELD || hideBall ? null : ball, posOf: (pid) => items.find((i) => i.pid === pid)?.pos ?? null };
    if (ifx) this.impact.drawBack(g, ifx);
    // 차지 공 색(원작 0xA40C, ROM 0x362E6): 보유자가 차지 중이면 차지값 행으로 공 4색 치환. 최신 스냅(b) 값 = 원작 1프레임 표시 지연 근사
    const hb = holder >= 0 ? b.p[holder] : null;
    const chgKey = hb && hb[6] & FL.CHARGING ? chargePalKey(hb[7]) : null;
    for (const it of items) {
      if (it.k === 'p') this.player(it, cam, tick);
      else if (it.k === 'r') this.referee(ref, cam);
      else this.ball(it.pos, cam, a.b, it.held ? { vx: 0, vy: 0, vz: 0 } : bv, tick, chgKey); // 보유 중 속도 0(원작 $30 클리어 → 반전 없음)
    }
    if (ifx) this.impact.drawFront(g, ifx);

    // 조작 선수 머리 위 표식(16x16): 내 좌석=1P, 상대는 컴퓨터면 COM, 사람이면 2P(원작에 없는 생성 에셋 hud.marker.2p).
    // 원작처럼 심판 등장(sq 2)부터 표시. 1P/2P/COM 같은 규칙: 머리 top 위 MARKER_GAP, 화면 위로는 잘리지 않게 y>=0
    for (let seat = 0; seat < 2 && !(sq < SQ_REF_IN); seat++) {
      const trOpp = !!a.tr && seat !== this.you && this.hud?.oppPid != null; // 특훈: 연습 상대(공을 던지는 선수) 머리 위 COM 표식(원작 tr_05)
      const pid = trOpp ? this.hud.oppPid : a.ctrl[seat];
      const it = items.find((i) => i.pid === pid);
      const key = seat === this.you ? 'm1p' : trOpp || this.cpuSeats?.[seat] ? 'mcom' : 'm2p';
      const img = key && this.hud?.imgs[key];
      if (!it || !img) continue;
      const [x, y, z] = it.pos;
      const sy = Math.round(y / 2 - z + Y0), top = this.headTop(it);
      const my = top != null ? sy + top - MARKER_GAP - MARKER_H : sy - MARKER_DY;
      g.drawImage(img, Math.round(x - cam) - 8, Math.max(0, my));
    }

    // 특훈 말풍선(연습 상대 머리 옆, game/training.js)
    if (a.tr && this.hud?.bubble) {
      const it = items.find((i) => i.pid === this.hud.oppPid);
      if (it) this.hud.bubble(g, a, it.pos, cam, this.headTop(it));
    }

    // 효과
    this.fx = this.fx.filter((f) => f.until > tick);
    for (const f of this.fx) {
      const sx = f.x - cam, sy = f.y / 2 - f.z + Y0 - 14;
      const r = 4 + Math.max(0, 12 - (f.until - tick)) * 0.8; // 이벤트는 최신 스냅 f, 그리기는 보간(지연) tick 이라 until-tick 이 12 를 넘을 수 있음
      g.strokeStyle = f.kind === 'catch' ? '#7cf7ff' : '#ffffff';
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.stroke();
    }
    if (skY) { // 흔들림으로 비는 가장자리 1줄은 이웃 줄로 채운다
      g.restore();
      if (skY > 0) g.drawImage(this.c, 0, skY, W, 1, 0, 0, W, skY); else g.drawImage(this.c, 0, H + skY - 1, W, 1, 0, H + skY, W, -skY);
    }

    this.hud?.draw(g, a, tick);
    // 필살슛 이름 말풍선(shout.js): 투구 선수의 이번 프레임 보간 위치·머리 top 을 매번 다시 읽어 머리 위에 붙인다. HUD 에 가리지 않게 HUD 뒤에 그린다
    this.shout?.draw(g, { tick, cam, sy: skY, at: (pid) => { const it = items.find((i) => i.pid === pid); return it ? { pos: it.pos, top: this.headTop(it) } : null; } });
    this.fmName?.draw(g, a); // 포메이션 작전 이름(상단 중앙 y 74, formation.js)
    if (!this.noBanner) this.banner(a, tick);
  }

  /** 시작 연출 카메라 고정: 이후 일반 카메라가 이 위치에서 이어지도록 상태도 맞춘다 */
  fixCam(x, tick) {
    this.cam = clamp(Math.round(x), 0, CAM_LIMIT); this.camTick = Math.floor(tick);
    return this.cam;
  }

  /** 심판 보간 위치·프레임과 손에 든 공 위치(referee.json ball_hold). 없으면 null */
  refState(a, b, t, tick) {
    const ra = a.ref, rd = this.refData;
    if (!ra || !rd) return null;
    const rb = b.ref ?? ra;
    const x = (ra[0] + (rb[0] - ra[0]) * t) / 16, y = (ra[1] + (rb[1] - ra[1]) * t) / 16;
    const name = this.refAnims?.[ra[2]] ?? 'stand';
    const an = rd.anims[name] ?? rd.anims.stand;
    const at = ra[3] + Math.max(0, Math.floor(tick) - a.f);
    const n = an.frames.length, k = Math.floor(at / Math.max(1, an.ticks_per_frame ?? 1));
    const i = an.loop ? k % n : Math.min(n - 1, k);
    const flip = !!ra[4];
    const hold = rd.ball_hold?.[name] ?? rd.ball_hold?.stand ?? [{ dx: 0, dy: 2, dz: 16 }];
    const h = hold[i % hold.length];
    return { x, y, flip, frame: rd.frames[an.frames[i]] ?? rd.frames[0], ball: [x + (flip ? -h.dx : h.dx), y + h.dy, h.dz] };
  }

  /** 심판 24x48 한 장, 앵커 발밑 중앙. 반전해도 앵커는 가로 중앙이라 같은 자리 */
  referee(r, cam) {
    if (!this.refImg) return;
    const g = this.g;
    const [rx, ry, rw, rh] = r.frame.rect;
    const sx = Math.round(r.x - cam), sy = Math.round(r.y / 2 + Y0);
    const dx = sx - r.frame.anchor[0], dy = sy - r.frame.anchor[1];
    if (r.flip) {
      g.save(); g.translate(sx * 2, 0); g.scale(-1, 1);
      g.drawImage(this.refImg, rx, ry, rw, rh, dx, dy, rw, rh);
      g.restore();
    } else g.drawImage(this.refImg, rx, ry, rw, rh, dx, dy, rw, rh);
  }

  /** 화면 고정 배너(snap ban=[종류, 나이, 수명]). 위치·앵커는 banners.json, 깜빡임 간격은 rules.start.banners */
  banner(a, tick) {
    const bn = a.ban, bd = this.banData?.banners?.[bn?.[0]];
    if (!bn || !bd || !this.banImg) return;
    const age = bn[1] + Math.max(0, Math.floor(tick) - a.f);
    if (bn[2] > 0 && age >= bn[2]) return;
    const blink = this.banRules?.[bn[0]]?.blink ?? 0;
    if (blink > 0 && Math.floor(age / blink) % 2 === 1) return;
    const [rx, ry, rw, rh] = bd.rect;
    this.g.drawImage(this.banImg, rx, ry, rw, rh, bd.screen_pos[0] + DW - bd.anchor[0], bd.screen_pos[1] - bd.anchor[1], rw, rh);
  }

  /**
   * 스테이지 배경: 원경(far) → 근경(near, 코트선 포함). 시차는 stage_NN.json parallax(this.parallax)를 따른다.
   * 행(8px) 그룹마다 shift = 96 + rounding((cam-96)*factor), 그리기 x = -shift (512 폭 반복).
   * 와이드: 원작 기준 카메라(c = cam + DW)로 계산해 가운데 320 영역이 원작과 같고, 좌우 확장분은 같은 평면 반복으로 채운다.
   * parallax 가 없으면 stage_00 규칙(근경 1.0 floor, 원경 0.75 floor).
   */
  background(cam) {
    const g = this.g;
    const { bgFar, bgNear } = this;
    if (!bgNear) return this.backgroundFallback(cam);
    const px = this.parallax ?? DEFAULT_PARALLAX;
    if (bgFar) this.layer(bgFar, px.far_rows, cam);
    else { g.fillStyle = '#1d2238'; g.fillRect(0, 0, W, H); }
    this.layer(bgNear, px.near_rows, cam);
  }

  /** 한 평면을 행 그룹별 시차로 그린다(가로 반복). 그룹이 이미지 전체면 한 번에 그린다 */
  layer(img, groups, cam) {
    const g = this.g;
    const wrap = img.width || 512, ih = img.height || H;
    for (const grp of groups?.length ? groups : DEFAULT_PARALLAX.near_rows) {
      const d = (cam + DW - CAM_CENTER) * (grp.factor ?? 1);
      const shift = CAM_CENTER - DW + (grp.rounding === 'ceil' ? Math.ceil(d) : grp.rounding === 'round' ? Math.round(d) : Math.floor(d));
      const o = ((-shift % wrap) + wrap) % wrap;
      const y0 = Math.max(0, (grp.rows?.[0] ?? 0) * 8), y1 = Math.min(ih, ((grp.rows?.[1] ?? 27) + 1) * 8);
      if (y1 <= y0) continue;
      if (y0 === 0 && y1 === ih) {
        g.drawImage(img, o - wrap, 0);
        if (o < W) g.drawImage(img, o, 0);
      } else {
        const hh = y1 - y0;
        g.drawImage(img, 0, y0, wrap, hh, o - wrap, y0, wrap, hh);
        if (o < W) g.drawImage(img, 0, y0, wrap, hh, o, y0, wrap, hh);
      }
    }
  }

  /** 배경 이미지 로드 실패 시: 단색 관중석 + 모래 바닥 + 코트 선 */
  backgroundFallback(cam) {
    const g = this.g;
    g.fillStyle = '#1d2238'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2a3150'; for (let y = 34; y < 100; y += 8) g.fillRect(0, y, W, 4);
    g.fillStyle = '#c8a26a'; g.fillRect(0, 100, W, H - 100);
    g.fillStyle = '#b8925c'; g.fillRect(0, 100, W, 4);
    const X = (x) => Math.round(x - cam) + 0.5, Y = (y) => Math.round(y / 2 + Y0) + 0.5;
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.strokeRect(X(16), Y(16), 480, Y(248) - Y(16));
    g.strokeStyle = '#f4efe2';
    g.strokeRect(X(80), Y(40), 352, Y(232) - Y(40));
    g.beginPath(); g.moveTo(X(256), Y(40)); g.lineTo(X(256), Y(232)); g.stroke();
  }

  /** 선수 방향(this.mem)과 애니 프레임을 정해 it.left/it.col/it.anim/it.fi 에 둔다 */
  pose(it, a, ball, tick, stStart) {
    const { pid, pos, s, dx, dy } = it;
    const seat = pid < 7 ? 0 : 1, idx = pid % 7;
    const y = pos[1];
    const st = s[3], fl = s[6];
    const m = this.mem[pid];
    let moving = Math.hypot(dx, dy) > 0.15;
    const sq = a.sq?.[0], face = s[8] ?? (seat === 0 ? 1 : -1);
    // 방향은 서버 값 그대로: 좌우 = face(s[8], 원작 $3 bit0), 앞뒤 = 플래그 bit7(원작 $3 bit1). 클라이언트는 추정하지 않는다
    // (캐치는 공 쪽을 보고 있어야 성공하므로 등을 돌린 채 맞는 장면이 그대로 보여야 한다. analysis/24 §1)
    m.left = face < 0;
    m.back = !!(fl & FL.BACK);
    if (sq != null && sq < SQ_GO) {
      // 시작 연출(GO 전): 앞뒤도 서버 bit7 그대로(걷는 중 위로 = 뒷모습 0x7868, 도착 후 y>=128 뒷모습 0x9996 을 서버가 보낸다).
      // 보간 구간의 dy 로 추정하면 스냅샷이 밀릴 때(dy=0) 앞모습이 끼어 깜빡인다.
      // 입장 보행 필드([9])나 플래그가 없는 구버전 스냅샷·로컬 모의만 원작 규칙(08 §2)으로 추정한다
      moving = !!s[9];
      if (s[9] === undefined || typeof fl !== 'number') m.back = moving ? dy < -0.05 : y >= BACK_Y;
    } else if (s[10]) moving = true; // 포메이션 집합 이동(fmWalk): 걷기 애니
    // 시각 선반영(옵션 fx.predict, 기본 꺼짐. game.js 가 localBits 를 건다): 내 조작 선수가 서 있을 때 방향키를 누르면 서버 스냅샷을 기다리지 않고 걷기 그림부터 시작한다.
    // 위치·방향·판정은 서버 값 그대로다(다리 동작만 먼저). 조작이 잠긴 동안·포메이션·시작 연출은 제외
    else if (this.localBits && pid === a.ctrl[this.you] && (this.localBits() & 15) && st === ST.IDLE && !a.lock && a.ph === 'play' && !a.fm) moving = true;

    // 점프볼 쳐내기 자세(fl&32) 시작 틱
    if (fl & FL.TIP) m.tipAt ??= tick; else m.tipAt = null;
    const el = fl & FL.TIP ? tick - m.tipAt : tick - (stStart[pid] ?? tick);
    const pk = this.pickCol(seat, idx, st, fl, moving, m.back, el, tick, m);
    it.left = m.left; it.col = pk.col; it.anim = pk.name; it.fi = pk.fi; it.cls = this.bodyClass[seat]?.[idx] ?? 0;
  }

  /** 든 공 world 위치 [x,y,z] (원작 손 위치 표). 표에 없는 자세면 null */
  handPos(it) {
    const h = HAND[it.cls]?.[it.anim] ?? HAND[0][it.anim];
    if (!h) return null;
    const k = Math.min(it.fi ?? 0, h.length / 2 - 1) * 2;
    const [x, y, z] = it.pos;
    return [x + (it.left ? -h[k] : h[k]), y + (HAND_DY[it.anim] ?? 2), z + h[k + 1]];
  }

  /** 이번에 그린 선수 프레임의 머리(최상단 불투명 행) y, 발 기준 상대값(음수). 시트 칸별로 1회 계산·캐시, 실패 시 null */
  headTop(it) {
    const img = this.pSheets?.[it.pid] ?? this.sheets[it.pid < 7 ? 0 : 1]; // pSheets/orig = 혼합 로스터(불꽃의 계승)의 선수별 출신 시트·번호. 없으면 좌석 팀 시트·pid%7
    if (!img || it.col == null || typeof document === 'undefined') return null;
    this.topCache ??= new WeakMap();
    let e = this.topCache.get(img);
    if (!e) {
      e = { px: null, w: 0, tops: new Map() };
      try {
        const c = document.createElement('canvas');
        c.width = e.w = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        e.px = g.getImageData(0, 0, c.width, c.height).data;
      } catch { e.px = null; }
      this.topCache.set(img, e);
    }
    if (!e.px) return null;
    const cell = this.cell, row = (this.pRow?.[it.pid] ?? this.orig?.[it.pid]?.idx ?? it.pid % 7) * 2 + (it.left ? 1 : 0), k = row * 1000 + it.col; // pRow = 선수별 띠 시트(불꽃의 계승 색 치환)의 행
    if (!e.tops.has(k)) {
      let top = null;
      const x0 = it.col * cell, y0 = row * cell;
      for (let r = 0; r < cell && top == null && x0 + cell <= e.w; r++) {
        const base = ((y0 + r) * e.w + x0) * 4;
        for (let i = 3; i < cell * 4; i += 4) if (e.px[base + i]) { top = r - this.origin[1]; break; }
      }
      e.tops.set(k, top);
    }
    return e.tops.get(k);
  }

  player(it, cam, tick) {
    const g = this.g;
    const { pid, pos } = it;
    const seat = pid < 7 ? 0 : 1, idx = pid % 7;
    const [x, y, z] = pos;
    const col = it.col, left = it.left;
    const sx = Math.round(x - cam), sy = Math.round(y / 2 - z + Y0);
    const img = this.pSheets?.[pid] ?? this.sheets[seat];
    if (img) {
      const row = (this.pRow?.[pid] ?? this.orig?.[pid]?.idx ?? idx) * 2 + (left ? 1 : 0);
      g.drawImage(img, col * this.cell, row * this.cell, this.cell, this.cell, sx - this.origin[0], sy - this.origin[1], this.cell, this.cell);
      // 필살기 발동 직후 투구 선수 반짝임(스프라이트 위에 같은 그림을 더해 밝게, 2틱 간격 점멸)
      if (this.cue?.pid === pid && tick < this.cue.until && (Math.floor(tick) >> 1) & 1) {
        g.globalCompositeOperation = 'lighter';
        g.drawImage(img, col * this.cell, row * this.cell, this.cell, this.cell, sx - this.origin[0], sy - this.origin[1], this.cell, this.cell);
        g.globalCompositeOperation = 'source-over';
      }
    } else {
      g.fillStyle = seat === 0 ? '#4a8cff' : '#ff6a4a'; g.fillRect(sx - 6, sy - 24, 12, 24);
    }
  }

  /**
   * 원작 0x3336 카메라 목표: {x: 목표 카메라(와이드), dir: 0=양방향, 1=증가만, -1=감소만}.
   * 비행 중 공의 던진 좌석은 스냅에 없어(holder=-1) 마지막 보유자 좌석으로 대신한다
   */
  camGoal(a, ball, holderItem, bv) {
    const bm = a.b[3];
    if (a.fm && a.cam != null) return { x: a.cam - DW, dir: 0 }; // 포메이션 대기·패스: 서버 고정 x(원작 기준) 우선
    if (bm === BM.HELD) this.flyDir = null; // 투구마다 비행 방향 초기화
    if (bm === BM.HELD && a.b[4] >= 0) this.throwSeat = a.b[4] < 7 ? 0 : 1;
    else if (bm === BM.DROP) this.throwSeat = null;
    const at = (x, sx) => x - sx - DW; // 세계 x 가 원작 화면 sx 에 오는 카메라(와이드)
    if (bm === BM.HELD && holderItem) {
      const seat = holderItem.pid < 7 ? 0 : 1;
      const ahead = seat === 0 ? !holderItem.left : holderItem.left; // 상대 쪽을 봄
      return { x: at(holderItem.pos[0], ahead ? (seat === 0 ? CAM_SX.near : CAM_SX.far) : CAM_SX.center), dir: 0 };
    }
    if ((bm === BM.FLY || bm === BM.PASS) && this.throwSeat != null) {
      if (Math.abs(bv.vx) > 0.01) this.flyDir = bv.vx < 0 ? -1 : 1;
      return { x: at(ball[0], this.throwSeat === 0 ? CAM_SX.near : CAM_SX.far), dir: this.flyDir ?? 0 };
    }
    return { x: at(ball[0], CAM_SX.center), dir: 0 };
  }

  /** 카메라를 게임 틱(60Hz) 단위로 목표에 접근시킨다(틱당 최대 4px, 주사율 무관). 정수 px 반환 */
  updateCam(goal, tick) {
    const tg = clamp(Math.round(goal.x), 0, CAM_LIMIT);
    const ti = Math.floor(tick);
    if (this.cam === null) { this.cam = tg; this.camTick = ti; return tg; }
    const steps = Math.max(0, Math.min(60, ti - this.camTick));
    this.camTick = Math.max(this.camTick, ti);
    for (let i = 0; i < steps; i++) {
      let d = tg - this.cam;
      if (goal.dir && Math.sign(d) !== goal.dir) d = 0; // 비행 중엔 공 진행 방향으로만
      if (d === 0) break;
      this.cam += clamp(d, -CAM_VMAX, CAM_VMAX);
    }
    return this.cam;
  }

  /** 필살기 진행 상태(시작 틱·진행 방향)와 공 위치 이력 갱신 */
  trackSpecial(kind, f, pos, v, tick) {
    if (!kind) { this.sp = null; this.hist.length = 0; return; }
    const id = kind - 1;
    if (this.sp?.id !== id) { this.sp = { id, start: f, dir: 0 }; this.hist.length = 0; }
    // 좌우 반전은 원작처럼 속도 부호($30) 기준. 루프 중엔 V 가 그대로라 위치 차가 뒤로 가도 뒤집지 않는다
    if (!LOOP_IDS.has(id) || !this.sp.dir) { if (Math.abs(v.vx) > 0.05) this.sp.dir = v.vx < 0 ? -1 : 1; }
    const fi = Math.floor(tick);
    const h = this.hist;
    if (!h.length || h[h.length - 1].f !== fi) { h.push({ f: fi, pos }); if (h.length > 16) h.shift(); }
  }

  /** n틱 전 공 위치(이력이 짧으면 가장 오래된 위치. 원작 이력 버퍼는 필살기 전부터 쌓여 있다) */
  pastBall(n) {
    const want = (this.hist[this.hist.length - 1]?.f ?? 0) - n;
    let best = this.hist[0]?.pos ?? null;
    for (const e of this.hist) if (e.f <= want) best = e.pos;
    return best;
  }

  /** 상태 코드 → anims.json 애니 이름 → 시트 열 */
  pickCol(seat, idx, st, fl, moving, back, el, tick, mem = null) {
    const cls = this.bodyClass[seat]?.[idx] ?? 0;
    const ab = back ? '_b' : '_a';
    let name, mode = 'loop';
    if (fl & FL.TIP) { name = 'pass' + ab; mode = 'once'; } // 쳐내기 = 원작 애니 0x28/0x2A(pass_a/b)
    else if (fl & FL.SLIDE) name = 'catch' + ab; // 캐치 후 밀림(원작 애니 0x20/0x22)
    else switch (st) {
      case ST.JUMP: name = fl & FL.CHARGING ? 'jumpthrow' + ab : 'jump' + ab; break;
      case ST.DASH: name = 'dash'; break;
      case ST.CHARGE: name = 'throw' + ab; mode = 'first'; break;
      case ST.THROW: name = 'throw' + ab; mode = 'wind'; break; // 투구 동작 10프레임(발사 전). 원작 0x1A3A: 프레임당 (속도+1)틱
      case ST.PASS: name = 'pass' + ab; mode = 'wind'; break;
      case ST.CATCH: name = 'catch' + ab; break;
      case ST.CROUCH: case ST.PICKUP: name = 'duck' + ab; break;
      case ST.HIT: name = 'hit_a'; break;
      case ST.DOWN: name = 'down'; break;
      case ST.OUTMOVE: name = 'walk' + ab; break;
      // ST.FOUL(선 이탈, 원작 0x974C): 정지 30f·공 놓고 20f 는 서기(0x87EC: 애니 0x0E/0x10), 복귀 이동은 걷기(0x78CE: 애니 0/2) → 아래 기본 분기
      default: name = moving ? 'walk' + ab : 'stand' + ab;
    }
    const an = this.animIndex[cls]?.[name] ?? this.animIndex[0]?.[name];
    if (!an) return { col: 24, name: null, fi: 0 };
    const n = an.frames.length, sp = Math.max(1, an.speed);
    let fi;
    if (mode === 'first') fi = 0;
    else if (mode === 'once') fi = Math.min(n - 1, Math.floor(el / sp) + 1);
    else if (mode === 'wind') fi = Math.min(n - 1, Math.floor(Math.max(0, el - 1) / (sp + 1)) + 1);
    else fi = mem ? 0 : Math.floor(tick / sp) % n;
    if (mem) { const k = animCounter(mem, an.name ?? name, n, Math.max(0, an.speed), mode === 'loop' && n > 1, tick); if (mode === 'loop') fi = k; }
    fi = Math.max(0, fi);
    return { col: an.frames[fi].col, name: an.name ?? name, fi };
  }

  /** 공용 그림자 타일(ball.json shadow): z≤16 큰 16x8, 그 위 작은 8x8. 바닥(z 무시)에 그린다 */
  shadow([x, y, z], cam, isPlayer) {
    const g = this.g;
    const sx = Math.round(x - cam), gy = Math.round(y / 2 + Y0);
    const sh = this.ballData?.shadow;
    if (this.ballImg && sh) {
      const s = z <= 16 ? sh.large : sh.small;
      const [rx, ry, rw, rh] = s.rect;
      g.drawImage(this.ballImg, rx, ry, rw, rh, sx - s.anchor[0], gy - s.anchor[1], rw, rh);
      return;
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    if (isPlayer) ellipse(g, sx, gy, 8, 2.5); else ellipse(g, sx, gy, 3.5, 1.5);
  }

  /** 공 상태 → ball.json 애니 이름 */
  ballAnim(b, v) {
    const kind = b[6] ?? 0;
    if (kind) return specialAnim(kind - 1, v);
    switch (b[3]) {
      case BM.HELD: return 'held';
      case BM.PASS: return 'pass';
      case BM.DROP: return 'held'; // 심판 손에 든 공
      case BM.FLY: {
        if (Math.hypot(v.vx, v.vy) >= FAST_SPEED) {
          if (v.vz <= -2) return 'throw_fast_drop';
          if (Math.abs(v.vz) < 0.25) return 'throw_fast_flat';
        }
        return 'throw';
      }
      default: // LOOSE/DROP: 굴러가거나 튕기면 bounce, 멈추면 held
        return Math.hypot(v.vx, v.vy, v.vz) > 0.05 || b[2] > 0 ? 'bounce' : 'held';
    }
  }

  ball([x, y, z], cam, b, v, tick, chgKey = null) {
    const g = this.g;
    const sx = Math.round(x - cam), sy = Math.round(y / 2 - z + Y0);
    const bd = this.ballData?.ball;
    if (this.ballImg && bd) {
      const an = bd.anims[this.ballAnim(b, v)] ?? bd.anims.held;
      const ft = Math.max(1, an.frame_ticks), n = an.frames.length;
      const fi = Math.max(0, Math.floor(tick)); // 경기 시작 직후 tick 이 음수일 수 있다
      const k = Math.floor(fi / ft);
      const i = an.loop ? k % n : Math.min(n - 1, k);
      const fr = bd.frames[an.frames[i]] ?? bd.frames[0];
      const sp = b[6] ? this.sp : null;
      if (!sp) return this.ballSprite(chgKey ? paletteSheet(this.palCache, this.ballImg, chgKey) : this.ballImg, fr, sx, sy, v.vx < 0);
      // 필살기: 색 치환 시트 + (숨김 ID 가 아니면) 본체 + 잔상/분신
      const img = paletteSheet(this.palCache, this.ballImg, specialPalKey(sp.id, fi));
      const el = tick - sp.start, left = sp.dir < 0;
      for (const q of specialGhosts(sp.id, [x, y, z], v, el, fi, (n2) => this.pastBall(n2))) {
        this.ballSprite(img, fr, Math.round(q[0] - cam), Math.round(q[1] / 2 - q[2] + Y0), left);
      }
      if (!specialHidden(sp.id, el)) this.ballSprite(img, fr, sx, sy, left);
      return;
    }
    const danger = b[3] === BM.FLY;
    g.fillStyle = danger ? '#ff3b2f' : '#e8e2d0';
    g.beginPath(); g.arc(sx, sy - 3, 3.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = danger ? '#ffd0c0' : '#ffffff';
    g.fillRect(sx - 2, sy - 6, 2, 2);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1;
    g.beginPath(); g.arc(sx, sy - 3, 3.5, 0, Math.PI * 2); g.stroke();
  }

  /** 공 프레임 1장(좌우 반전 가능). (sx,sy)=공 바닥 기준 화면 좌표 */
  ballSprite(img, fr, sx, sy, flip) {
    const g = this.g;
    const [rx, ry, rw, rh] = fr.rect;
    const dx = sx - fr.anchor[0], dy = sy - fr.anchor[1];
    if (flip) {
      g.save(); g.translate(sx * 2, 0); g.scale(-1, 1);
      g.drawImage(img, rx, ry, rw, rh, dx, dy, rw, rh);
      g.restore();
    } else g.drawImage(img, rx, ry, rw, rh, dx, dy, rw, rh);
  }
}

/**
 * 원작 선수 애니 프레임 카운터($10 = 프레임, $11 = 남은 틱, 0x19EC) 재현. 반환 = 이번 틱의 프레임 번호.
 * 원작(에뮬 실측 _verify/walk_jitter_20261120/oracle_walk_L48.json): 루프 애니는 $11 이 0 이면 다음 프레임·speed 로 다시 채우고, 아니면 1 줄인다
 * (프레임당 speed+1 틱: 걷기 7, 대시 4). 애니가 바뀌면 프레임만 0 으로 돌아가고 $11 은 이어 간다. 1프레임 애니(서기 등) 동안은 $11 이 멈춘다.
 * run = 카운터를 돌리는 애니(여러 프레임 루프). 아니면 애니 이름만 기록해 다음 루프 애니가 프레임 0 에서 시작하게 한다
 */
export function animCounter(mem, name, n, speed, run, tick) {
  const ti = Math.floor(tick);
  let c = mem.ac;
  if (!c || ti < c.t || ti - c.t > 60) c = mem.ac = { name, idx: 0, cnt: speed, t: ti }; // 처음·되감기·긴 공백: 프레임 0 부터
  while (c.t < ti) {
    c.t++;
    if (c.name !== name) { c.name = name; c.idx = 0; }
    if (!run) continue;
    if (c.cnt <= 0) { c.idx = (c.idx + 1) % n; c.cnt = speed; } else c.cnt--;
  }
  if (c.name !== name) { c.name = name; c.idx = 0; } // 같은 틱 안에서 애니가 바뀐 경우
  return c.idx % n;
}

export function buildAnimIndex(anims) {
  const out = {};
  for (const [k, v] of Object.entries(anims || {})) {
    const cls = Number(k.replace('body', ''));
    out[cls] = {};
    for (const an of Object.values(v.anims)) {
      const base = an.name.replace(/_[ab]$/, '');
      out[cls][an.name] = an;
      out[cls][base] ??= an; // 'dash', 'down' 처럼 a/b 구분 없는 이름
    }
  }
  return out;
}
/** 공 속도(px/틱): 스냅에 속도 필드가 없어 인접 스냅 두 개의 차이로 구한다 */
function ballVel(a, b) {
  const n = b.f - a.f;
  if (!(n > 0)) return null;
  const d = (i) => (b.b[i] - a.b[i]) / 16 / n;
  const vx = d(0), vy = d(1), vz = d(2);
  if (Math.abs(vx) > 64 || Math.abs(vy) > 64) return { vx: 0, vy: 0, vz: 0 }; // 순간이동
  return { vx, vy, vz };
}
function ellipse(g, x, y, rx, ry) { g.beginPath(); g.ellipse(Math.round(x), Math.round(y), rx, ry, 0, 0, Math.PI * 2); g.fill(); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
