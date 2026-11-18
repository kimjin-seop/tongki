// 필살슛 이름 말풍선(웹 신규 연출, 원작에는 없음: analysis/14_formation_cutin.md §3.8). 시각 전용, 서버·판정·타이밍 불변.
// special 이벤트 {p: pid, id} 를 받으면 {pid, id, start, text} 만 들고 있다가, 매 그리기마다 render.js 가 넘기는 그 선수의 보간 위치·머리 top 을
// 다시 읽어 머리 위 GAP px 에 그린다(좌표를 저장하지 않는다 → 점프·착지·이동을 그대로 따라간다). 48틱, 새 필살이 오면 교체.
// 문구: /assets/data/special_shouts.json 의 byPlayer['팀id:idx'].shouts[id] → byPlayer[..].shout → byId[id] → default.shout.
// 이름 있는 선수는 받아치기로 남의 ID 를 던져도 자기 슛 이름(.shout)을 외치고, byPlayer 에 없는 선수는 필살 ID 별 이름(byId)을 외친다.
import { W } from './render.js';
import { dotMask } from './dottext.js';

export const SHOUT_KEY = 'fx.shout';
const read = () => { try { return localStorage.getItem(SHOUT_KEY) !== '0'; } catch { return true; } };
let on = read();
/** 옵션(localStorage, 기본 켬) */
export const shoutOn = () => on;
export const setShoutOn = (v) => { on = !!v; try { localStorage.setItem(SHOUT_KEY, on ? '1' : '0'); } catch { /* 저장 불가 무시 */ } };

const DEFAULT = '필살슛!!';
const Y0 = 96; // 화면 y = y/2 - z + 96 (render.js)
const TOTAL = 48, T_IN = 6, T_BLINK = 8; // 팝인 6틱, 끝 8틱은 2틱 간격 깜빡임
const POP = [0.5, 0.8, 1.2, 1.2, 1.1, 1.1]; // 팝인 배율(꼬리 끝 기준, 최근접 확대)
const GAP = 4; // 머리 top 과 꼬리 끝 사이
const TEXT_H = 10, PAD_X = 5, PAD_Y = 4, TAIL_H = 5, TAIL_MIN = 7, MAX_W = 110;
const HEAD_DEF = -36; // 머리 top 을 못 구하면(시트 미로드) 특훈 말풍선과 같은 값
const FONT = '"DD UI", sans-serif';
const C_LINE = '#000000', C_BG = '#fcfcfc', C_TXT = '#000000', C_SHADE = '#b4b4c4';

export class ShoutFx {
  /** @param {{teamIds:[number,number]}} o game_start.teams 의 id */
  constructor(o) {
    this.teamIds = o.teamIds;
    this.data = null; // special_shouts.json (로드 전·실패 시 전부 기본 문구)
    this.cur = null; // {pid, id, start, text}
    this.cache = new Map();
    this.last = null; // 마지막으로 그린 자리(확인용): {x, y, w, h, tipX, tipY, head, z}
  }

  setData(d) { this.data = d && typeof d === 'object' ? d : null; }

  /** 선수(pid = seat*7 + idx)가 필살 id 를 던질 때의 문구 */
  textFor(pid, id) {
    const e = this.data?.byPlayer?.[`${this.teamIds[(pid / 7) | 0]}:${pid % 7}`];
    const s = e?.shouts?.[id] ?? e?.shout ?? this.data?.byId?.[id] ?? this.data?.default?.shout;
    return typeof s === 'string' && s ? s : DEFAULT;
  }

  /** special 이벤트 수신. start = 이벤트가 실린 스냅 틱 */
  special(pid, id, start) {
    if (!on || !Number.isInteger(pid) || pid < 0 || pid >= 14) return;
    this.cur = { pid, id, start, text: this.textFor(pid, id) };
  }

  clear() { this.cur = null; this.last = null; }

  /**
   * 상자 + 꼬리를 합친 캔버스(문구·꼬리 자리·폰트 준비 상태별 캐시). tail = 가리킬 x(상자 왼쪽 기준).
   * 꼬리 뿌리(c.tx)는 상자 양끝 TAIL_MIN 안에 두고, 꼬리 끝(c.tip, height - 1 행)은 상자 폭 안에서 tail 을 그대로 따라간다
   * → 상자가 캔버스 가장자리에 가둬져도 꼬리가 기울어 선수 중심을 가리킨다(가운데에서는 tip = tx 로 곧은 꼬리)
   */
  img(text, tail) {
    const ok = globalThis.document?.fonts?.check?.(`${TEXT_H}px ${FONT}`, '가') ?? true;
    const wk = `${text}|${ok}`;
    let mk = this.masks?.get(wk);
    if (!mk) {
      mk = dotMask(text, { h: TEXT_H, font: FONT, th: 0.55, ct: 0.65, maxW: MAX_W - PAD_X * 2 });
      (this.masks ??= new Map()).set(wk, mk);
      if (this.masks.size > 64) { this.masks.clear(); this.masks.set(wk, mk); }
    }
    const bw = mk.w + PAD_X * 2, bh = mk.hh + PAD_Y * 2;
    const tx = Math.max(TAIL_MIN, Math.min(bw - 1 - TAIL_MIN, tail)), tip = Math.max(0, Math.min(bw - 1, tail));
    const key = `${wk}|${tx}|${tip}`;
    let c = this.cache.get(key);
    if (c) return c;
    if (this.cache.size > 48) this.cache.clear();
    c = document.createElement('canvas');
    c.width = bw; c.height = bh + TAIL_H - 1; // 맨 아래 행 = 꼬리 끝 한 점
    const g = c.getContext('2d');
    // 상자: 검정 윤곽 1px + 흰 바탕, 모서리 2px 깎음, 아래 안쪽 1줄 음영
    g.fillStyle = C_LINE; g.fillRect(2, 0, bw - 4, bh); g.fillRect(0, 2, bw, bh - 4); g.fillRect(1, 1, bw - 2, bh - 2);
    g.fillStyle = C_BG; g.fillRect(2, 1, bw - 4, bh - 2); g.fillRect(1, 2, bw - 2, bh - 4);
    g.fillStyle = C_SHADE; g.fillRect(2, bh - 2, bw - 4, 1);
    // 꼬리: 아래로 좁아지는 삼각형(폭 7 → 1), 상자 아랫변 윤곽을 열고 잇는다
    g.fillStyle = C_BG; g.fillRect(tx - 2, bh - 2, 5, 2);
    for (let r = 0; r < TAIL_H; r++) {
      const hw = TAIL_H - 2 - r; // 흰 안쪽 반폭: 3, 2, 1, 0, -1(끝은 검정 한 점)
      const cx = tx + Math.round(((tip - tx) * r) / (TAIL_H - 1)); // 행 중심: 뿌리 tx → 끝 tip
      g.fillStyle = C_LINE; g.fillRect(cx - hw - 1, bh - 1 + r, (hw + 1) * 2 + 1, 1);
      if (hw >= 0 && r < TAIL_H - 1) { g.fillStyle = C_BG; g.fillRect(cx - hw, bh - 1 + r, hw * 2 + 1, 1); }
    }
    // 글자(검정, 외곽선 없이 마스크 그대로)
    g.fillStyle = C_TXT;
    const ox = PAD_X, oy = PAD_Y - mk.top;
    for (let y = 0; y < mk.h; y++) for (let x = 0; x < mk.w; x++) if (mk.m[y * mk.w + x] && oy + y >= 1 && oy + y < bh - 1) g.fillRect(ox + x, oy + y, 1, 1);
    c.tx = tx; c.tip = tip;
    this.cache.set(key, c);
    return c;
  }

  /**
   * @param {CanvasRenderingContext2D} g
   * @param {{tick:number, cam:number, sy?:number, at:(pid:number)=>({pos:number[], top:number|null}|null)}} o
   *   at = 이번 프레임에 그린 그 선수의 보간 위치 [x, y, z] 와 머리 top(발 기준, 음수). 퇴장 등으로 없으면 null. sy = 명중 흔들림 y
   */
  draw(g, o) {
    const cur = this.cur;
    if (!cur) return;
    if (!on) { this.clear(); return; }
    const age = Math.floor(o.tick - cur.start);
    if (age >= TOTAL || age < -60) { this.clear(); return; } // 끝남, 또는 재접속 등 틱 되감기
    if (age < 0) return; // 이벤트 틱이 보간 그리기 틱보다 앞선다
    const left = TOTAL - age;
    if (left <= T_BLINK && ((T_BLINK - left) >> 1) & 1) return; // 끝: 깜빡이며 사라짐
    const p = o.at(cur.pid);
    if (!p) return;
    const [x, y, z] = p.pos;
    const sx = Math.round(x - o.cam), head = Math.round(y / 2 - z + Y0) + (p.top ?? HEAD_DEF) + (o.sy ?? 0);
    // 상자는 선수 x 가운데, 캔버스 좌우 안으로 가둔다. 꼬리 끝은 선수 x 를 가리킨다(상자가 가둬지면 꼬리가 기운다).
    // 선수 중심이 캔버스 밖이면 꼬리 끝이 그쪽 상자 끝(캔버스 가장자리 1px 안)에 붙는다
    const probe = this.img(cur.text, 0), bw = probe.width, ch = probe.height;
    const bx = Math.max(1, Math.min(W - 1 - bw, sx - (bw >> 1)));
    const c = this.img(cur.text, sx - bx);
    const by = Math.max(0, head - GAP - ch); // 위로 잘리지 않게
    const tipX = bx + c.tip, tipY = by + ch;
    this.last = { x: bx, y: by, w: bw, h: ch, tipX, tipY, head, z, age, sx };
    const k = age < T_IN ? POP[age] : 1;
    if (k === 1) { g.drawImage(c, bx, by); return; }
    const dw = Math.max(1, Math.round(bw * k)), dh = Math.max(1, Math.round(ch * k));
    const dx = Math.round(tipX - c.tip * k), dy = Math.max(0, tipY - dh);
    g.drawImage(c, 0, 0, bw, ch, Math.max(0, Math.min(W - dw, dx)), dy, dw, dh);
  }
}
