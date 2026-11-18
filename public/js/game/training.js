// 특훈(캐치·필살 슛) HUD·말풍선 (PROTOCOL §9.2·§9.4 snap.tr, analysis/29 §1-3·§1-6).
// HUD: 왼쪽 `캐치 NN구`(숫자 x=80·96, y=8) / 오른쪽 `남은 NN구`(숫자 x=256·272, y=8). 숫자는 인원 숫자와 같은 16x16(hud.digits).
// 필살 슛 특훈(kind 'special'): 왼쪽 `필살 슛 NN구`(숫자 x=112·128, y=8) + 차지 게이지(아래 GAUGE), 단계 표시 없음(단계가 하나).
// 와이드(398): 왼쪽 묶음은 왼쪽 끝 기준 그대로, 오른쪽 묶음은 오른쪽 끝 기준(hud.js 와 같은 규칙). 가운데에 단계(웹 추가).
// 얼굴 4칸·인원 숫자·이름은 없다(원작 특훈 HUD). Renderer 의 hud 자리에 그대로 들어간다(imgs, draw).
import { W, BASE_W } from './render.js';
import { dotMask, dotCanvas } from './dottext.js';

/** 말풍선 번호 → 한글(원문 analysis/29 §1-3 표, server/data/training.json messages) */
export const TR_MSG_KO = {
  1: '형편없군!', // はなしにならんな!
  2: '조금만 더!', // もう少しだ!
  3: '그 기세다!', // そのちょうしだ!
  4: '제법이군!', // やるじゃないか!
  5: '간다!', // いくぞ!
  6: '와라!', // こい!
  7: '다시 간다!', // もう一度いくぞ!
  8: '다시 던져봐라!', // もう一度なげて見ろ!
  9: '이번엔 좀 빠르다!', // 今度はちょっと速いぞ!
  10: '마지막은 속구다!', // 最後は速球だ!
};

const FONT = '"DD UI", sans-serif';
const NUM_Y = 8, DIGIT = 16;
const L_NUM = [80, 96], L_NUM_SP = [112, 128], R_NUM = [256, 272].map((x) => x + (W - BASE_W));
const TEXT_H = 12, TEXT_Y = NUM_Y + 2, STEP_H = 10, STEP_Y = NUM_Y + 3;
const COL = '#fcfcfc', STEP_COL = '#fcfc00';
// 차지 게이지(필살 슛 특훈). 원작에서 확인된 것은 표식 x = 20 + 8 x 차지(0~15)·y 32 와 초록 구간이 차지 13~15 자리라는 것뿐이다(29 §1-6).
// 막대 그림·색 구간 좌표·깜빡임 주기와 모양은 원작 미확정(29 §4-2-3 미확정 2·5): 캡처 tr_06 을 눈으로 보고 기존 HUD 색에 맞춰 자작했다.
// 막대 = 눈금 18칸(칸 폭 8, x 16~160, y 33~39), 눈금 i 칸 = x 16 + 8i. 성공 구간(game_start.training.gauge.ok)만 초록, 그 앞 4칸은 밝은 빨강.
const GAUGE = { x: 16, y: 33, cell: 8, cells: 18, h: 7, markY: 25, blink: 4,
  dark: '#6c0000', red: '#d80000', ok: '#00d800', frame: '#000', mark: COL, markOk: '#fcfc00' };
const GAUGE_MARK = [7, 7, 5, 5, 3, 3, 1]; // ▽ 표식 행별 폭(가운데 정렬, 7x7)
// 말풍선(원작 실측 analysis/gfx/modes/tr_05_speech_bubbles.png, 11장 모두 같은 크기·자리):
// 상자 106x26 고정(검정 외곽 1(모서리 빔) + 흰 테 1(모서리 회색) + 회색 테 1 + 검정 안쪽 100x20), 꼬리는 상자 아래 오른쪽(x 83~91)에서 오른쪽 아래로 8px.
// 자리: 상자 왼쪽 = 상대 x - 101, 위 = 머리 top - 39 (= COM 표식 왼쪽 - 93, 위 - 17: 표식의 COM 글자는 상자에 가리고 삼각형만 보인다)
const BUB_W = 106, BUB_BOX_H = 26, BUB_IMG_H = 34, BUB_DX = -101, BUB_DY = -39, BUB_TOP_MIN = 26;
const BUB_H = 12, BUB_MAX_W = 96; // 글자: 한글 높이 12(원작 가나 16), 안쪽 폭 100 에서 좌우 2 여백
const BUB_GRAY = '#6c6c6c';
const BUB_TAIL = [[23, 83, 'KKKK'], [24, 83, 'GKKKG'], [25, 83, 'WGKKGW'], [26, 83, 'KWGKGWK'], [27, 84, 'KWGGWK'], [28, 85, 'KWGGWK'],
  [29, 86, 'KWGWK'], [30, 87, 'KWGWK'], [31, 88, 'KWWK'], [32, 89, 'KWK'], [33, 90, 'KK']]; // [행, 시작 x, K 검정·W 흰색·G 회색]
const Y0 = 96; // 화면 y = y/2 - z + 96 (render.js)

export class TrainHud {
  /** @param {{kind?:string, steps:number, balls:number, pass:number, oppPid?:number, gauge?:{max:number, ok:[number,number]}}} o game_start.training 값 */
  constructor(o) {
    Object.assign(this, o);
    this.oppPid ??= 7; // 연습 상대 내야 선수(좌석 1 선수 0)
    this.special = this.kind === 'special';
    const gz = this.gauge ?? {};
    this.gMax = Number.isInteger(gz.max) && gz.max > 0 && gz.max < GAUGE.cells ? gz.max : 15;
    this.gOk = Array.isArray(gz.ok) && gz.ok.every(Number.isInteger) ? [Math.max(0, gz.ok[0]), Math.min(this.gMax, gz.ok[1])] : [13, 15];
    this.imgs = {};
    this.cache = new Map();
  }

  /** 도트 글자 캔버스(문자열·크기·색·폰트 준비 상태별 캐시) */
  text(s, h, fill, maxW) {
    const ok = globalThis.document?.fonts?.check?.(`${h}px ${FONT}`, '가') ?? true;
    const key = [s, h, fill, ok].join('|');
    if (!this.cache.has(key)) {
      const mk = dotMask(s, { h, font: FONT, th: 0.55, ct: 0.65, maxW });
      this.cache.set(key, { c: dotCanvas(mk, { fill }), top: mk.top, w: mk.w });
    }
    return this.cache.get(key);
  }

  /** 글자를 (x, y) = 한글 왼쪽 위에 맞춰 그린다. right = true 면 x 가 오른쪽 끝 */
  put(g, s, x, y, h, fill, right = false) {
    const t = this.text(s, h, fill);
    g.drawImage(t.c, Math.round(right ? x - t.w : x) - 1, y - 1 - t.top);
  }

  num(g, n, xs) {
    n = Math.max(0, Math.min(99, n | 0));
    const d = [Math.floor(n / 10), n % 10];
    if (this.imgs.digits) d.forEach((v, i) => g.drawImage(this.imgs.digits, v * DIGIT, 0, DIGIT, DIGIT, xs[i], NUM_Y, DIGIT, DIGIT));
    else this.put(g, String(d[0]) + d[1], xs[0], TEXT_Y, TEXT_H, COL); // 숫자 시트가 없으면 도트 글자
  }

  /** 차지 게이지: 막대(성공 구간 초록) + 위쪽 ▽ 표식(tr.ch 자리). 투구 뒤(tr.chb > 0)에는 표식이 던진 값 자리에서 점멸한다 */
  drawGauge(g, tr, tick) {
    const G = GAUGE, ch = Math.max(0, Math.min(this.gMax, tr.ch | 0)), [o0, o1] = this.gOk;
    g.fillStyle = G.frame; g.fillRect(G.x - 1, G.y - 1, G.cell * G.cells + 2, G.h + 2);
    for (let i = 0; i < G.cells; i++) {
      g.fillStyle = i >= o0 && i <= o1 ? G.ok : i >= o0 - 4 && i < o0 ? G.red : G.dark;
      g.fillRect(G.x + i * G.cell, G.y, G.cell - 1, G.h); // 칸 사이 1px 은 테 색(눈금)
    }
    if ((tr.chb | 0) > 0 && (Math.floor((tick ?? 0) / G.blink) & 1)) return; // 점멸: 꺼진 구간
    const cx = G.x + ch * G.cell + 3; // 원작 표식 x = 20 + 8 x 차지 의 가운데 열(칸 가운데)
    g.fillStyle = G.frame;
    GAUGE_MARK.forEach((w, r) => g.fillRect(cx - (w >> 1) - 1, G.markY + r - 1, w + 2, 3));
    g.fillStyle = ch >= o0 && ch <= o1 ? G.markOk : G.mark;
    GAUGE_MARK.forEach((w, r) => g.fillRect(cx - (w >> 1), G.markY + r, w, 1));
  }

  draw(g, a, tick) {
    const tr = a.tr;
    if (!tr) return;
    const ln = this.special ? L_NUM_SP : L_NUM;
    this.put(g, this.special ? '필살 슛' : '캐치', ln[0] - 3, TEXT_Y, TEXT_H, COL, true);
    this.num(g, tr.count, ln);
    this.put(g, '구', ln[1] + DIGIT + 2, TEXT_Y, TEXT_H, COL);
    this.put(g, '남은', R_NUM[0] - 3, TEXT_Y, TEXT_H, COL, true);
    this.num(g, tr.left, R_NUM);
    this.put(g, '구', R_NUM[1] + DIGIT + 2, TEXT_Y, TEXT_H, COL);
    if (this.special) return this.drawGauge(g, tr, tick);
    const st = this.text(`${(tr.step | 0) + 1}/${this.steps | 0}단계`, STEP_H, STEP_COL);
    g.drawImage(st.c, Math.round((W - st.w) / 2) - 1, STEP_Y - 1 - st.top);
  }

  bubbleImg(s) {
    const key = 'b|' + s + (globalThis.document?.fonts?.check?.(`${BUB_H}px ${FONT}`, '가') ?? true);
    if (!this.cache.has(key)) {
      const mk = dotMask(s, { h: BUB_H, font: FONT, th: 0.55, ct: 0.65, maxW: BUB_MAX_W });
      const c = document.createElement('canvas');
      c.width = BUB_W; c.height = BUB_IMG_H;
      const g = c.getContext('2d');
      const box = (col, d) => { g.fillStyle = col; g.fillRect(d, d, BUB_W - d * 2, BUB_BOX_H - d * 2); };
      box('#000', 0); box(COL, 1); box(BUB_GRAY, 2); box('#000', 3);
      g.fillStyle = BUB_GRAY;
      for (const [x, y] of [[1, 1], [BUB_W - 2, 1], [1, BUB_BOX_H - 2], [BUB_W - 2, BUB_BOX_H - 2]]) g.fillRect(x, y, 1, 1); // 흰 테 모서리
      for (const [x, y] of [[0, 0], [BUB_W - 1, 0], [0, BUB_BOX_H - 1], [BUB_W - 1, BUB_BOX_H - 1]]) g.clearRect(x, y, 1, 1); // 검정 외곽 모서리는 비운다(둥근 모서리)
      const TAIL_COL = { K: '#000', W: COL, G: BUB_GRAY };
      for (const [y, x0, row] of BUB_TAIL) [...row].forEach((ch, i) => { g.fillStyle = TAIL_COL[ch]; g.fillRect(x0 + i, y, 1, 1); });
      // 글자: 안쪽(100x20) 가운데
      g.drawImage(dotCanvas(mk, { fill: COL }), Math.round((BUB_W - mk.w) / 2) - 1, Math.round((BUB_BOX_H - mk.hh) / 2) - 1 - mk.top);
      this.cache.set(key, c);
    }
    return this.cache.get(key);
  }

  /** 연습 상대 왼쪽 위 말풍선(원작 배치: 고정 폭 상자가 상대 왼쪽으로 뻗고 꼬리가 머리를 가리킨다). top = 발 기준 머리 top(음수), 없으면 -36 */
  bubble(g, a, pos, cam, top) {
    const s = TR_MSG_KO[a.tr?.msg];
    if (!s) return;
    const sx = Math.round(pos[0] - cam), head = Math.round(pos[1] / 2 - pos[2] + Y0) + (top ?? -36);
    g.drawImage(this.bubbleImg(s), Math.max(0, Math.min(W - BUB_W, sx + BUB_DX)), Math.max(BUB_TOP_MIN, head + BUB_DY));
  }
}
