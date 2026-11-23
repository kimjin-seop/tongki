// 스냅샷 바이너리 코덱 (서버 -> 클라이언트, PROTOCOL §5.3). 서버(server/game/roomGame.js)와 클라이언트(net.js)가 같은 파일을 쓴다.
// 스냅샷의 정수 값을 평평한 배열로 펴서 키프레임(전부) / 델타(직전 스냅샷에서 바뀐 칸만)로 보낸다. 값은 하나도 줄이거나 반올림하지 않는다(무손실).
// 드물게 바뀌는 객체(fm·tr)와 이벤트(ev)는 JSON 문자열 덩어리로 덧붙인다. WebSocket(TCP)은 순서가 보장되므로 델타는 직전 메시지 기준이다.
const MAGIC = 0x50; // 상위 4비트
const F_KEY = 1, F_FM = 2, F_TR = 4, F_EV = 8;
export const KEY_EVERY = 60; // 키프레임 주기(틱). 델타 기준이 어긋난 경우(서버가 메시지를 버린 뒤)의 복구 한도
const PHASES = ['ready', 'play', 'end'];
const BANNERS = ['go', 'fight', 'game_set', 'time_up', 'play_off']; // server/data/rules.json start.banners 의 키(스냅샷 ban[0]). 새 배너를 더하면 여기도 더한다(없으면 인코딩 오류)

// 평평한 칸 배치: 선수 14 x 11, 공 7, rem 2, ctrl 2, aim 2, clk, sd, lock, ph, sq 2, fmLeft 2, [cam], [ref 5], [ban 3], [tip 3] (null 가능한 묶음은 앞에 존재 칸 1개)
const P0 = 0, B0 = 154, REM = 161, CTRL = 163, AIM = 165, CLK = 167, SD = 168, LOCK = 169, PH = 170, SQ = 171, FML = 173, CAM = 175, REF = 177, BAN = 183, TIP = 187;
export const N = 191;

const zz = (n) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzz = (z) => (z % 2 ? -(z + 1) / 2 : z / 2);

class Writer {
  constructor() { this.b = new Uint8Array(2048); this.n = 0; }
  need(k) { if (this.n + k > this.b.length) { const c = new Uint8Array(Math.max(this.b.length * 2, this.n + k)); c.set(this.b); this.b = c; } }
  u8(v) { this.need(1); this.b[this.n++] = v; }
  u16(v) { this.need(2); this.b[this.n++] = v & 255; this.b[this.n++] = (v >> 8) & 255; }
  varint(v) { this.need(10); while (v >= 128) { this.b[this.n++] = (v % 128) | 128; v = Math.floor(v / 128); } this.b[this.n++] = v; }
  bytes(u) { this.need(u.length); this.b.set(u, this.n); this.n += u.length; }
  out() { return this.b.slice(0, this.n); }
}

class Reader {
  constructor(u) { this.b = u; this.n = 0; }
  u8() { if (this.n >= this.b.length) throw new Error('snap: 길이 초과'); return this.b[this.n++]; }
  u16() { return this.u8() | (this.u8() << 8); }
  varint() { let v = 0, m = 1, c; do { c = this.u8(); v += (c & 127) * m; m *= 128; } while (c & 128); return v; }
  bytes(k) { if (this.n + k > this.b.length) throw new Error('snap: 길이 초과'); const r = this.b.subarray(this.n, this.n + k); this.n += k; return r; }
}

const te = new TextEncoder();
const td = new TextDecoder();
const num = (v) => (v === true ? 1 : v === false ? 0 : v);

/** 스냅샷 객체 -> 정수 칸 배열. 정수가 아닌 값이 있으면 오류(서버 스냅샷 형식이 바뀌면 코덱을 맞춰야 한다) */
export function flatten(s) {
  const v = new Array(N).fill(0);
  for (let i = 0; i < 14; i++) for (let j = 0; j < 11; j++) v[P0 + i * 11 + j] = num(s.p[i][j]);
  for (let j = 0; j < 7; j++) v[B0 + j] = num(s.b[j]);
  v[REM] = s.rem[0]; v[REM + 1] = s.rem[1];
  v[CTRL] = s.ctrl[0]; v[CTRL + 1] = s.ctrl[1];
  v[AIM] = num(s.aim[0]); v[AIM + 1] = num(s.aim[1]);
  v[CLK] = s.clk; v[SD] = num(s.sd); v[LOCK] = num(s.lock);
  const ph = PHASES.indexOf(s.ph); if (ph < 0) throw new Error('snap: 모르는 ph ' + s.ph);
  v[PH] = ph;
  v[SQ] = s.sq[0]; v[SQ + 1] = s.sq[1];
  v[FML] = s.fmLeft[0]; v[FML + 1] = s.fmLeft[1];
  if (s.cam != null) { v[CAM] = 1; v[CAM + 1] = s.cam; }
  if (s.ref) { v[REF] = 1; for (let j = 0; j < 5; j++) v[REF + 1 + j] = num(s.ref[j]); }
  if (s.ban) { const k = BANNERS.indexOf(s.ban[0]); if (k < 0) throw new Error('snap: 모르는 배너 ' + s.ban[0]); v[BAN] = 1; v[BAN + 1] = k; v[BAN + 2] = s.ban[1]; v[BAN + 3] = s.ban[2]; }
  if (s.tip) { v[TIP] = 1; for (let j = 0; j < 3; j++) v[TIP + 1 + j] = s.tip[j]; }
  for (let i = 0; i < N; i++) if (!Number.isInteger(v[i])) throw new Error(`snap: 정수가 아닌 값 칸 ${i} = ${v[i]}`);
  return v;
}

/** 정수 칸 배열 + 덩어리 -> 스냅샷 객체(서버 snapshot() 과 같은 모양) */
function build(v, f, fm, tr, ev) {
  const p = [];
  for (let i = 0; i < 14; i++) p.push(v.slice(P0 + i * 11, P0 + i * 11 + 11));
  const grp = (at, n) => (v[at] ? v.slice(at + 1, at + 1 + n) : null);
  const s = {
    t: 'snap', f, ph: PHASES[v[PH]], clk: v[CLK], sd: !!v[SD], rem: [v[REM], v[REM + 1]], ctrl: [v[CTRL], v[CTRL + 1]], aim: [v[AIM], v[AIM + 1]],
    p, b: v.slice(B0, B0 + 7), lock: v[LOCK], sq: [v[SQ], v[SQ + 1]], cam: v[CAM] ? v[CAM + 1] : null,
    fm, fmLeft: [v[FML], v[FML + 1]], ref: grp(REF, 5), ban: v[BAN] ? [BANNERS[v[BAN + 1]], v[BAN + 2], v[BAN + 3]] : null, tip: grp(TIP, 3),
  };
  if (tr !== undefined) s.tr = tr;
  s.ev = ev;
  return s;
}

/** 서버 쪽: 한 방의 스냅샷 스트림 인코더(두 좌석에 같은 메시지를 보낸다) */
export class SnapEncoder {
  constructor() { this.prev = null; this.prevF = 0; this.keyF = 0; this.fm = 'null'; this.tr = undefined; }

  /** 다음 encode 를 키프레임으로 */
  forceKey() { this.prev = null; }

  /** 스냅샷 -> Uint8Array. 직전 메시지가 없거나 KEY_EVERY 틱이 지났으면 키프레임, 아니면 델타 */
  encode(s) {
    const v = flatten(s);
    const fm = JSON.stringify(s.fm ?? null);
    const tr = s.tr === undefined ? undefined : JSON.stringify(s.tr);
    const key = !this.prev || s.f <= this.prevF || s.f - this.keyF >= KEY_EVERY;
    const w = new Writer();
    const fmOn = key ? fm !== 'null' : fm !== this.fm;
    const trOn = tr !== undefined && (key || tr !== this.tr);
    const evOn = s.ev?.length > 0;
    w.u8(MAGIC | (key ? F_KEY : 0) | (fmOn ? F_FM : 0) | (trOn ? F_TR : 0) | (evOn ? F_EV : 0));
    if (key) {
      w.varint(s.f);
      for (let i = 0; i < N; i++) w.varint(zz(v[i]));
      this.keyF = s.f;
    } else {
      w.u16(this.prevF & 0xffff); w.varint(s.f - this.prevF);
      const ch = [];
      for (let i = 0; i < N; i++) if (v[i] !== this.prev[i]) ch.push(i);
      w.varint(ch.length);
      let last = 0;
      for (const i of ch) { w.varint(i - last); w.varint(zz(v[i] - this.prev[i])); last = i; }
    }
    if (fmOn) { const u = te.encode(fm); w.varint(u.length); w.bytes(u); }
    if (trOn) { const u = te.encode(tr); w.varint(u.length); w.bytes(u); }
    if (evOn) { const u = te.encode(JSON.stringify(s.ev)); w.varint(u.length); w.bytes(u); }
    this.prev = v; this.prevF = s.f; this.fm = fm; this.tr = tr;
    return w.out();
  }

  /** 체인 상태를 건드리지 않고 이 스냅샷만 키프레임으로(재접속한 좌석 한 명에게) */
  encodeKeyOnly(s) {
    const save = [this.prev, this.prevF, this.keyF, this.fm, this.tr];
    this.prev = null;
    try { return this.encode(s); } finally { [this.prev, this.prevF, this.keyF, this.fm, this.tr] = save; }
  }
}

/** 클라이언트 쪽: 연결마다 하나. decode 는 스냅샷 객체, 또는 기준이 어긋난 델타(다음 키프레임까지)면 null */
export class SnapDecoder {
  constructor() { this.v = null; this.f = 0; this.fm = null; this.tr = undefined; this.stale = 0; }

  isSnap(u) { return u.length > 0 && (u[0] & 0xf0) === MAGIC; }

  decode(u) {
    const r = new Reader(u);
    const h = r.u8();
    if ((h & 0xf0) !== MAGIC) throw new Error('snap: 알 수 없는 메시지');
    let v, f;
    if (h & F_KEY) {
      f = r.varint(); v = new Array(N);
      for (let i = 0; i < N; i++) v[i] = unzz(r.varint());
      this.fm = null; this.tr = undefined; // 키프레임은 fm·tr 이 있을 때만 덩어리를 싣는다
    } else {
      const base = r.u16(); const df = r.varint();
      if (!this.v || (this.f & 0xffff) !== base) { this.stale++; return null; } // 기준 불일치: 다음 키프레임을 기다린다
      v = this.v.slice(); f = this.f + df;
      const n = r.varint(); let at = 0;
      for (let k = 0; k < n; k++) { at += r.varint(); v[at] += unzz(r.varint()); }
    }
    if (h & F_FM) this.fm = JSON.parse(td.decode(r.bytes(r.varint())));
    if (h & F_TR) this.tr = JSON.parse(td.decode(r.bytes(r.varint())));
    const ev = h & F_EV ? JSON.parse(td.decode(r.bytes(r.varint()))) : [];
    this.v = v; this.f = f;
    return build(v, f, this.fm, this.tr, ev);
  }
}
