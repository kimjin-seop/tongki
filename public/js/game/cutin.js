// [미사용 2026-11-18] 사용자 지시로 필살기 컷인을 제거했다(필살슛 이름 말풍선 shout.js 가 대신한다). 이 파일은 어디서도 import 하지 않는다.
// 보관용으로만 남긴다(사본 _backup/cutin_removed_before/). localStorage fx.cutin 도 더 이상 읽지 않는다.
// 필살기 컷인(웹 신규 연출, 원작에는 없음: analysis/14_formation_cutin.md §3.3). 서버 변경 없음:
// special 이벤트 {p: pid, id}, pid = seat*7 + idx. 화면 상단 벽 구간(y 44~68)에 얼굴(hud.faces) + '필살 슛!' 를 48틱 그린다.
// 일시정지·암전·번쩍임 없음, 입력·진행과 무관. 좌석0 = 왼쪽 끝, 좌석1 = 오른쪽 끝(HUD 처럼 와이드 화면 가장자리 기준), 가운데는 비운다.
// 필살기 고유 이름은 ROM 근거가 없어 표시하지 않는다(문구 고정). 효과음은 기존 specialSfxKey 만(game.js), 컷인 전용 소리 없음.
import { W } from './render.js';
import { dotMask, dotCanvas } from './dottext.js';

export const CUTIN_KEY = 'fx.cutin';
/** 옵션(localStorage, 기본 켬) */
export const cutinOn = () => { try { return localStorage.getItem(CUTIN_KEY) !== '0'; } catch { return true; } };
export const setCutinOn = (on) => { try { localStorage.setItem(CUTIN_KEY, on ? '1' : '0'); } catch { /* 저장 불가 무시 */ } };

const TEXT = '필살 슛!';
const Y = 44, FACE = 24, BOX_W = 96, BOX_H = 16, EDGE = 4; // 전체 120x24
const T_IN = 6, T_HOLD = 30, T_OUT = 12, TOTAL = T_IN + T_HOLD + T_OUT, SLIDE = 24;
const FONT = '"DD UI", sans-serif', TEXT_H = 10;
const C_OUT = '#0048d8', C_IN = '#6c90fc', C_BG = '#000000', C_TXT = '#fcfcfc';

export class Cutin {
  /** @param {{teamIds:[number,number], imgs:{faces?:HTMLImageElement}}} o imgs 는 Hud.imgs 공유(얼굴 로드 후 채워짐) */
  constructor(o) {
    this.teamIds = o.teamIds; this.imgs = o.imgs;
    this.q = []; // {seat, idx, start} 최대 2개: 표시 중 + 대기(이벤트 틱이 보간 그리기 틱보다 앞서므로)
    this.txt = null; this.txtOk = false;
  }

  /** special 이벤트 수신. start = 이벤트가 실린 스냅 틱 */
  show(pid, start) {
    if (!cutinOn() || !Number.isInteger(pid) || pid < 0 || pid >= 14) return;
    this.q = [...this.q.filter((c) => c.start < start).slice(-1), { seat: (pid / 7) | 0, idx: pid % 7, start }];
  }

  text() {
    const ok = globalThis.document?.fonts?.check?.(`${TEXT_H}px ${FONT}`, '필') ?? true;
    if (!this.txt || (ok && !this.txtOk)) {
      this.txtOk = ok;
      this.txt = dotCanvas(dotMask(TEXT, { h: TEXT_H, font: FONT, th: 0.55, ct: 0.65, maxW: BOX_W - 6 }), { fill: C_TXT });
    }
    return this.txt;
  }

  draw(g, tick) {
    if (!this.q.length) return;
    // 단일 슬롯: 시작된 것 중 가장 최근 하나만(새 필살기가 오면 즉시 교체)
    this.q = this.q.filter((c) => tick - c.start < TOTAL);
    let cur = null;
    for (const c of this.q) if (tick >= c.start) cur = c;
    if (!cur) return;
    const age = tick - cur.start;
    const right = cur.seat === 1;
    const slide = age < T_IN ? Math.round(SLIDE * (1 - age / T_IN)) : 0;
    const x0 = right ? W - EDGE - FACE - BOX_W + slide : EDGE - slide;
    const fade = age - T_IN - T_HOLD; // 끝 12틱: 3틱마다 25%씩(계단식)
    const alpha = fade > 0 ? 1 - Math.ceil(fade / 3) * 0.25 : 1;
    if (alpha <= 0) return;
    g.save();
    g.globalAlpha = alpha;
    const faceX = right ? x0 + BOX_W : x0, boxX = right ? x0 : x0 + FACE, boxY = Y + (FACE - BOX_H) / 2;
    g.fillStyle = C_OUT; g.fillRect(boxX, boxY, BOX_W, BOX_H);
    g.fillStyle = C_IN; g.fillRect(boxX + 1, boxY + 1, BOX_W - 2, BOX_H - 2);
    g.fillStyle = C_BG; g.fillRect(boxX + 2, boxY + 2, BOX_W - 4, BOX_H - 4);
    const t = this.text();
    g.drawImage(t, boxX + Math.round((BOX_W - t.width) / 2), boxY + Math.round((BOX_H - t.height) / 2));
    const F = this.imgs?.faces;
    if (F) {
      const sx = cur.idx * FACE, sy = (this.teamIds[cur.seat] ?? 0) * FACE;
      if (!right) { // 왼팀은 HUD 와 같이 좌우 반전(오른쪽을 본다)
        g.translate(faceX + FACE, Y); g.scale(-1, 1);
        g.drawImage(F, sx, sy, FACE, FACE, 0, 0, FACE, FACE);
      } else g.drawImage(F, sx, sy, FACE, FACE, faceX, Y, FACE, FACE);
    }
    g.restore();
  }
}
