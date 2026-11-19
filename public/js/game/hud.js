// 원작 경기 HUD (analysis/07_hud.md §6): 내야 4명 얼굴이 폴에 걸려 HP 에 따라 오르내림 + 남은 인원 "7 - 7" + 시간제한 타이머.
// 좌표는 원작 320x224 화면 px 정수. 와이드(398) 화면에서는 왼팀 얼굴은 왼쪽 끝 기준 그대로, 오른팀 얼굴은 오른쪽 끝 기준
// (원작과 같은 가장자리 간격), 인원·타이머는 가운데 기준(+DW)으로 옮긴다. 이미지는 manifest hud.* 키(game.js 가 로드해 imgs 에 넣는다).
import { W, BASE_W, DW } from './render.js';
import { dotMask, dotCanvas } from './dottext.js';
const SLOT_CX = [[116, 84, 52, 20], [204, 236, 268, 300].map((x) => x + (W - BASE_W))]; // [seat][내야 슬롯 0~3]
const POLE_Y = 8, FACE = 24, FLOOR_Y = 40; // 등장 시작·아웃 소멸 y_top
const REM_POS = [[136 + DW, 16], [168 + DW, 16]], DASH_POS = [156 + DW, 20];
const TIMER_POS = [144 + DW, 4]; // 웹 고정 위치(원작은 배경 전광판)
// 닉네임·팀 이름(캔버스 도트 글자, dottext.js): 안쪽 얼굴과 인원 숫자 사이 빈칸 [x0, x1] (논리 px). 왼팀은 오른쪽 정렬, 오른팀은 왼쪽 정렬.
// 팀 이름 = 한글 10px 흰색(한 줄에 안 들어가면 공백에서 두 줄), 닉네임 = 8px 노랑, 타이머 옆 윗줄(타이머 쪽으로 NICK_EXT 만큼 더 넓음)
const NAME_BOX = [
  [SLOT_CX[0][0] + FACE / 2 + 2, REM_POS[0][0] - 3],
  [REM_POS[1][0] + 16 + 3, SLOT_CX[1][0] - FACE / 2 - 2],
];
const NICK_EXT = TIMER_POS[0] - 4 - NAME_BOX[0][1]; // 타이머(32px 폭)와 4px 띄움
const TEAM_H = 10, NICK_H = 8, NICK_Y = 2, TEAM_Y1 = 18, TEAM_Y2 = [13, 25];
const NAME_FONT = '"DD UI", sans-serif', NAME_TH = 0.55, NAME_CT = 0.65; // 덮임 임계값, 둥근 모서리 정리 임계값(dottext.js)
const TEAM_COL = '#fcfcfc', NICK_COL = '#fcfc00'; // HUD 숫자 흰색, 원작 노랑
const FL_DEAD = 8, ST_OUTMOVE = 12, ST_GONE = 14;
const HP_FACE_MAX = 112; // 얼굴 상단 y = 28 - floor(hp/4) 가 0(화면 맨 위)이 되는 HP
const SUB_FACE_DELAY = 70;
const FM_DOT = 6; // 포메이션 남은 횟수 공 간격(5px 공 + 1px)
const HUD_IN_DELAY = 2; // 입장 완료 +2틱 후 얼굴 등장(rules.start.hud.delay, 08 §7) // 교체 투입 얼굴 등장 지연(틱): 원작 인원 감소(f349) 후 약 70f 뒤(f420) 등장. 표시 전용

export class Hud {
  /**
   * @param {{teamIds:[number,number], timed:boolean, resumed:boolean, remDelay:number, names?:[[string,string],[string,string]], you?:number, fmUses?:number, official?:boolean}} o names = [좌석][닉네임, 팀 이름], fmUses = 포메이션 횟수(0 = 꺼짐)
   * official = こうしき(game_start.rules.mode === 'official'): 얼굴이 체력에 따라 내려오지 않고 맨 위(y 8)에 고정되고 떨림도 없다 [확인 07 §2-1, 판독만 ROM 0xDF7E]. 가운데 숫자 쌍(남은 인원)은 체력제와 같다
   */
  constructor(o) {
    Object.assign(this, o);
    this.imgs = {};
    this.faces = [[null, null, null, null], [null, null, null, null]];
    this.pending = [[null, null, null, null], [null, null, null, null]]; // 교체 얼굴 등장 대기 {pid, at}
    this.lastTick = null;
    this.rem = null; this.remQ = [[], []]; // 표시용 인원: 서버 rem 변화를 remDelay 틱 늦춰 반영(원작은 코트 이탈 후 감소)
    this.nameKey = ''; this.nameImgs = null; // 이름 도트 캐시: 문자열·폰트 준비 상태가 바뀔 때만 다시 만든다
  }

  /** 이름 도트 이미지(좌석별 [{c, x, y}]) */
  nameSprites() {
    const names = this.names ?? [['', ''], ['', '']];
    const fontOk = globalThis.document?.fonts?.check?.(`${TEAM_H}px ${NAME_FONT}`, '가') ?? true;
    const key = JSON.stringify(names) + fontOk;
    if (key === this.nameKey) return this.nameImgs;
    this.nameKey = key;
    this.nameImgs = names.map(([nick, team], seat) => {
      const [x0, x1] = NAME_BOX[seat], out = [];
      const put = (text, h, y, fill, ext = 0) => {
        if (!text) return;
        const mk = dotMask(text, { h, font: NAME_FONT, th: NAME_TH, ct: NAME_CT, maxW: x1 - x0 + ext });
        const c = dotCanvas(mk, { fill });
        out.push({ c, x: seat === 0 ? x1 + ext - mk.w - 1 : x0 - ext - 1, y: y - 1 - mk.top });
      };
      put(String(nick ?? ''), NICK_H, NICK_Y, NICK_COL, NICK_EXT);
      const lines = teamLines(String(team ?? ''), x1 - x0);
      lines.forEach((ln, i) => put(ln, TEAM_H, lines.length === 1 ? TEAM_Y1 : TEAM_Y2[i], TEAM_COL));
      return out;
    });
    return this.nameImgs;
  }

  /** 프레임 진행: 게임 틱 1 = 1px 이동 */
  update(a, tick) {
    const t = Math.floor(tick);
    const first = this.lastTick === null;
    const steps = first ? 0 : Math.max(0, Math.min(120, t - this.lastTick));
    this.lastTick = t;
    this.updateRem(a, t, first);
    if (this.orig) for (const p of a.p) if (p && p[4] > (this.hpCap ?? 0)) this.hpCap = p[4]; // 혼합 로스터: 경기 중 본 최대 HP(game_start 에 값이 없을 때를 대비)
    // 시작 연출(PROTOCOL 5.5): 입장(sq 0) 중엔 얼굴 없음, HUD 대기(sq 1) +2틱에 8개가 함께 올라온다(서버 sq 없으면 즉시)
    const sq = a.sq;
    if (sq && (sq[0] === 0 || (sq[0] === 1 && sq[1] < HUD_IN_DELAY))) return;
    const intro = !this.introDone; // 첫 등장은 교체 지연 없이
    this.introDone = true;
    for (let seat = 0; seat < 2; seat++) {
      for (let slot = 0; slot < 4; slot++) {
        let f = this.faces[seat][slot];
        if (f && f.mode !== 'out') {
          const p = a.p[f.pid];
          if (p[5] !== slot || p[6] & FL_DEAD || p[3] === ST_GONE || p[4] <= 0) f.mode = 'out';
        }
        if (f) {
          if (f.mode === 'out') {
            f.y = Math.min(FLOOR_Y, f.y + steps);
            if (f.y >= FLOOR_Y) { this.faces[seat][slot] = f = null; }
          } else {
            const target = this.official ? POLE_Y : this.faceTop(a.p[f.pid][4]);
            if (f.mode === 'in') { f.y = Math.max(target, f.y - steps); if (f.y <= target) f.mode = 'on'; }
            if (f.mode === 'on') f.y = target;
          }
        }
        if (!f) {
          const pid = occupant(a, seat, slot);
          const pd = this.pending[seat];
          if (pid < 0) pd[slot] = null;
          else if (!first && !intro && pd[slot]?.pid !== pid) pd[slot] = { pid, at: t + SUB_FACE_DELAY }; // 경기 중 교체 투입은 늦게 등장
          else if (first || intro || t >= pd[slot].at) {
            pd[slot] = null;
            const on = first && this.resumed; // 재접속 복귀는 연출 없이 제자리
            this.faces[seat][slot] = { pid, y: on ? (this.official ? POLE_Y : this.faceTop(a.p[pid][4])) : FLOOR_Y, mode: on ? 'on' : 'in' };
          }
        }
      }
    }
  }

  /** 얼굴 상단 y. 혼합 로스터(불꽃의 계승)는 장비·특훈으로 HP 가 원작 범위를 넘을 수 있다: 이 경기의 최대 HP(hpCap)가 112 를 넘으면 그 값에 맞춰 높이를 줄여 화면 안에서 차이가 보이게 한다(종전 경기는 원작 식 그대로) */
  faceTop(hp) { return this.orig ? flameFaceY(hp, this.hpCap) : faceY(hp); }

  updateRem(a, t, first) {
    if (first || !this.rem) { this.rem = [a.rem[0], a.rem[1]]; this.remRaw = [a.rem[0], a.rem[1]]; return; }
    // PLAY OFF(こうしき 시간 종료 동수): 서버가 양쪽 남은 인원을 1 로 바꾼다. 아웃이 아니므로 교체 이동 지연 없이 곧바로 1-1 [확인 poke 29 §3-2]
    if (this.official && a.sd && !this.sdSeen) { this.sdSeen = true; this.rem = [a.rem[0], a.rem[1]]; this.remRaw = [a.rem[0], a.rem[1]]; this.remQ = [[], []]; return; }
    for (let seat = 0; seat < 2; seat++) {
      const q = this.remQ[seat];
      if (a.rem[seat] !== this.remRaw[seat]) { this.remRaw[seat] = a.rem[seat]; q.push([t + (this.remDelay | 0), a.rem[seat]]); }
      while (q.length && q[0][0] <= t) this.rem[seat] = q.shift()[1];
    }
  }

  draw(g, a, tick) {
    this.update(a, tick);
    if (a.sq?.[0] === 0) return; // 입장 행진 중엔 HUD 전체를 숨긴다(원작 f126 까지 HUD 없음)
    const I = this.imgs, t = Math.floor(tick);
    if (I.pole) for (let seat = 0; seat < 2; seat++) for (let slot = 0; slot < 4; slot++) {
      if (this.faces[seat][slot]) g.drawImage(I.pole, SLOT_CX[seat][slot] - 4, POLE_Y);
    }
    if (I.faces) for (let seat = 0; seat < 2; seat++) for (let slot = 0; slot < 4; slot++) {
      const f = this.faces[seat][slot];
      if (!f) continue;
      let x = SLOT_CX[seat][slot] - FACE / 2, y = f.y;
      const hp = a.p[f.pid][4];
      if (f.mode === 'on' && hp < 20 && !this.official && (((t % 60) + 60) % 60) >= 31) { x += jit(); y += jit(); }
      const og = this.orig?.[f.pid]; // 혼합 로스터(불꽃의 계승): 선수 출신 {team, idx}. 없으면 좌석 팀·pid%7
      const pf = this.pFaces?.[f.pid] ?? null; // 불꽃의 계승 오리지널 선수: 색을 바꾼 얼굴 한 칸(24x24). 없으면 아틀라스
      const src = pf ?? I.faces, sx = pf ? 0 : (og ? og.idx : f.pid % 7) * FACE, sy = pf ? 0 : (og ? og.team : this.teamIds[seat] ?? 0) * FACE;
      if (seat === 0) {
        g.save(); g.translate(x + FACE, y); g.scale(-1, 1);
        g.drawImage(src, sx, sy, FACE, FACE, 0, 0, FACE, FACE);
        g.restore();
      } else g.drawImage(src, sx, sy, FACE, FACE, x, y, FACE, FACE);
    }
    for (const side of this.nameSprites()) for (const n of side) g.drawImage(n.c, n.x, n.y);
    if (I.digits) for (let seat = 0; seat < 2; seat++) {
      const n = Math.max(0, Math.min(9, this.rem[seat] | 0));
      g.drawImage(I.digits, n * 16, 0, 16, 16, REM_POS[seat][0], REM_POS[seat][1], 16, 16);
    }
    if (I.dash) g.drawImage(I.dash, DASH_POS[0], DASH_POS[1]);
    // 포메이션 남은 횟수(snap.fmLeft, PROTOCOL 5.6): 내 쪽 인원 숫자 아래 작은 공 fmUses 개, 남은 것만 밝게
    const fl = a.fmLeft?.[this.you];
    if (this.fmUses > 0 && Number.isInteger(fl)) {
      const x0 = REM_POS[this.you][0] + 8 - ((this.fmUses * FM_DOT) - 1) / 2, y0 = REM_POS[this.you][1] + 21; // 숫자와 5px 띄움(붙이면 '7'이 '?'처럼 보임)
      for (let i = 0; i < this.fmUses; i++) fmDot(g, Math.round(x0 + i * FM_DOT), y0, i < fl);
    }
    if (this.timed && !a.sd && I.timer) {
      const sec = Math.ceil(Math.max(0, a.clk) / 60);
      const chars = [Math.min(9, Math.floor(sec / 60)), 10, Math.floor((sec % 60) / 10), sec % 10];
      chars.forEach((c, i) => g.drawImage(I.timer, c * 8, 0, 8, 8, TIMER_POS[0] + i * 8, TIMER_POS[1], 8, 8));
    }
  }
}

/** 팀 이름 줄 나누기: 한 줄에 그대로 들어가면 한 줄, 아니면 공백 위치 중 긴 줄이 가장 짧은 곳에서 두 줄(공백 없으면 한 줄 압축) */
function teamLines(t, maxW) {
  t = t.trim();
  const w = (s) => dotMask(s, { h: TEAM_H, font: NAME_FONT, th: NAME_TH, ct: NAME_CT }).w;
  if (!t || !t.includes(' ') || w(t) <= maxW) return [t];
  const ws = t.split(/\s+/);
  let best = null;
  for (let i = 1; i < ws.length; i++) {
    const ln = [ws.slice(0, i).join(' '), ws.slice(i).join(' ')];
    const m = Math.max(w(ln[0]), w(ln[1]));
    if (!best || m < best[0]) best = [m, ln];
  }
  return best[1];
}

/** 5x5 도트 공(검정 테두리 포함 7x7): on = 밝은 공, off = 어두운 빈 칸 */
function fmDot(g, x, y, on) {
  g.fillStyle = '#000'; g.fillRect(x, y - 1, 5, 7); g.fillRect(x - 1, y, 7, 5);
  g.fillStyle = on ? '#fcb400' : '#3a3a3a'; g.fillRect(x + 1, y, 3, 5); g.fillRect(x, y + 1, 5, 3);
  if (on) { g.fillStyle = '#fcfc9c'; g.fillRect(x + 1, y + 1, 1, 1); }
}

/** 얼굴 상단 y = 28 - floor(hp/4) */
const faceY = (hp) => 28 - Math.floor(Math.max(0, hp) / 4);
/**
 * 불꽃의 계승(혼합 로스터) 얼굴 상단 y. cap = 그 경기의 최대 HP.
 * cap 이 HP_FACE_MAX(112) 이하면 원작 식 그대로(112 에서 y 0), 넘으면 0~cap 을 y 28~FLAME_TOP 에 고르게 편다(HP 189 도 화면 안, 112 를 넘는 HP 끼리도 높이가 다르다)
 */
const FLAME_TOP = 2;
export function flameFaceY(hp, cap = 0) {
  const v = Math.max(0, hp);
  if (!(cap > HP_FACE_MAX)) return faceY(Math.min(v, HP_FACE_MAX));
  return 28 - Math.floor((Math.min(v, cap) * (28 - FLAME_TOP)) / cap);
}
const jit = () => Math.floor(Math.random() * 5) - 2;

/** 해당 내야 슬롯에 서 있는 살아있는 선수 pid (없으면 -1). 교체 투입 선수는 이동(OUTMOVE)을 마친 뒤 등장 */
function occupant(a, seat, slot) {
  for (let pid = seat * 7; pid < seat * 7 + 7; pid++) {
    const p = a.p[pid];
    if (p[5] === slot && !(p[6] & FL_DEAD) && p[3] !== ST_GONE && p[3] !== ST_OUTMOVE && p[4] > 0) return pid;
  }
  return -1;
}
