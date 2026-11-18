// 필살기 임팩트 연출(웹 신규 연출, 원작에는 없음: analysis/14_formation_cutin.md §0·§3.7). 시각 전용, 서버·판정·타이밍 불변.
// 읽는 것: special 이벤트 {p, id}, 스냅샷 공 b[6](kind = id + 1)·공 좌표, hit 이벤트 {p, kind, dmg}. 보내는 것 없음.
//  ① 오라: 필살 투구 순간 투구 선수 주변(30틱)  ② 트레일: 필살 공이 나는 동안 공 뒤  ③ 명중: 충격 링·스파크 + 화면 흔들림 10틱
// 흔들림은 그리기 좌표만 옮긴다(카메라 표시값 x ±2px, 세계 그림 y ±1px). renderer.cam·게임 좌표·HUD·컷인은 그대로.
// 필살기 컷인(cutin.js, y 44~68)은 가리지 않는다: 모든 그림을 화면 y >= CLIP_Y 로 자른다(흔들림 y 이동 o.sy 를 빼서 이동 전 좌표 기준).
// 속성(화염·번개·바람·충격파) ↔ 필살 ID 대응은 ROM 근거가 없는 디자인 선택이다(화면에 이름·근거를 표시하지 않는다).
// 도트 느낌: 정수 좌표 fillRect 만, 속성당 5색, 확대는 캔버스 CSS(최근접). 효과음 없음(기존 special·hit 소리 그대로).
import { W, H } from './render.js';

export const IMPACT_KEY = 'fx.impact';
const read = () => { try { return localStorage.getItem(IMPACT_KEY) !== '0'; } catch { return true; } };
let on = read();
/** 옵션(localStorage, 기본 켬). 끄면 오라·트레일·명중·흔들림 전부 그리지 않는다 */
export const impactOn = () => on;
export const setImpactOn = (v) => { on = !!v; try { localStorage.setItem(IMPACT_KEY, on ? '1' : '0'); } catch { /* 저장 불가 무시 */ } };

/** 필살 ID(0~53) → 속성. F 화염, B 번개, W 바람, S 충격파.
 *  규칙(디자인 선택): 공 색 치환 키(special.js PAL_ID)가 Y(순환 점멸) = 번개, C·D·E·H(하늘색 계열) = 바람, F·G(회색 계열) = 충격파,
 *  A·B(빨강 계열) = 화염, 기본 색(N·-)은 잔상/분신이 있는 ID = 충격파, 없으면 화염.
 *  예외(2026-11-18): 슛 이름(special_shouts.json byId)이 다른 속성을 가리키는 7개는 이름을 따른다 —
 *  1 회오리·2 회전회오리·20 파도 = 바람, 7 면도날 = 충격파, 14 폭격 = 화염, 28 번개·37 별무리 = 번개 */
const ELEM_BY_ID = 'FWWSWBFSFWBSFFFFBBBBWBFBBFBBBFFSSFBFFBFWSBSFFFFWFFWWWF';
export const specialElement = (id) => ELEM_BY_ID[id] ?? 'F';
/** 속성별 5색(밝음 → 어두움) */
const PAL = {
  F: ['#fcfcfc', '#fce45c', '#fc9c18', '#e03c10', '#7c1408'],
  B: ['#fcfcfc', '#fcfc90', '#78d8fc', '#2c70f0', '#1c2c9c'],
  W: ['#fcfcfc', '#c0fcdc', '#58e0b0', '#1ca088', '#0c5c60'],
  S: ['#fcfcfc', '#fcf088', '#f4a4fc', '#a858e8', '#5c24a0'],
};

const Y0 = 96; // 투영: 화면y = y/2 - z + 96 (render.js 와 같다)
const CLIP_Y = 69; // 컷인(y 44~67) 아래부터만 그린다
const AURA_T = 30, HIT_T = 18, SHAKE_T = 10;
const SHAKE_X = [2, -2, 2, -1, 1, -1, 1, -1, 1, 0], SHAKE_Y = [1, -1, 0, 1, 0, -1, 0, 0, 0, 0];
// 품질 단계: 0 = gfx.quality 가 low/0.5x, 1 = 터치 기기(모바일), 2 = 그 외. 입자 상한과 생성량이 달라진다
const CAPS = [40, 72, 120];
function tier() {
  let q = '1x';
  try { q = localStorage.getItem('gfx.quality') || '1x'; } catch { /* 기본 */ }
  if (q === 'low' || q === '0.5x') return 0;
  return globalThis.matchMedia?.('(pointer: coarse)')?.matches ? 1 : 2;
}
/** 정수 2개 → 0~1 (프레임·칸별 고정 무늬) */
const hsh = (a, b) => {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12;
  return (x >>> 0) / 4294967296;
};
// 입자 모양
const DOT = 0, STREAK = 1, CROSS = 2, RING = 3, BLOB = 4, PILLAR = 5;

export class ImpactFx {
  constructor() {
    this.t = tier(); this.cap = CAPS[this.t];
    this.ps = []; // 입자 {x,y,z(세계 px), vx,vz(px/틱), g, t0, life, sh, el, sz?(DOT 시작 크기, 기본 3)}
    this.aura = null; // {pid, el, start}
    this.hits = []; // {x,y,z, el, start}
    this.shk = null; // 흔들림 시작 틱
    this.seed = 0x2f6e2b1; this.lastFi = null; this.lastTick = null;
  }

  rnd() { let s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s; return (s >>> 0) / 4294967296; }
  clear() { this.ps.length = 0; this.hits.length = 0; this.aura = null; this.shk = null; }
  spawn(p) { if (this.ps.length >= this.cap) this.ps.shift(); this.ps.push(p); }

  /** special 이벤트. tick = 이벤트가 실린 스냅 틱 */
  special(pid, id, tick) {
    if (!on || !Number.isInteger(pid) || pid < 0 || pid >= 14) return;
    this.aura = { pid, el: specialElement(id), start: tick };
  }

  /** 필살 공 피격(hit 이벤트의 kind 가 있을 때만 부른다). pos = 맞은 선수 [x,y,z] px, dmg 0 = 막힘(흔들림 없음·스파크 절반) */
  hit(pos, id, tick, dmg) {
    if (!on || !pos) return;
    const el = specialElement(id), [x, y, z] = pos, cz = z + 18;
    this.hits = [...this.hits.slice(-1), { x, y, z: cz, el, start: tick }];
    if (dmg !== 0) this.shk = tick;
    this.hits[this.hits.length - 1].rot = this.rnd() * Math.PI;
    const n = [10, 16, 24][this.t] >> (dmg === 0 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, sp = 1.8 + this.rnd() * 3.2;
      this.spawn({ x, y, z: cz, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp + 0.6, g: 0.16, t0: tick, life: 11 + this.rnd() * 9,
        sh: el === 'B' && i % 3 === 0 ? CROSS : el === 'W' && i % 2 ? STREAK : DOT, el, sz: 4 });
    }
  }

  /** 화면 흔들림 오프셋(정수 px) 또는 null. 표시 전용 */
  shake(tick) {
    if (!on || this.shk == null) return null;
    const age = Math.floor(tick - this.shk);
    if (age < 0) return null;
    if (age >= SHAKE_T) { this.shk = null; return null; }
    return { x: SHAKE_X[age], y: SHAKE_Y[age] };
  }

  /**
   * 선수·공보다 먼저(뒤에) 그리는 층 + 이번 틱 입자 생성.
   * @param {{cam:number, tick:number, kind:number, sy?:number, ball:number[]|null, posOf:(pid:number)=>number[]|null}} o ball = 날고 있는 공 위치(보유 중이면 null), sy = 흔들림 y 이동(px)
   */
  drawBack(g, o) {
    const { tick } = o;
    if (!on) { if (this.ps.length || this.aura || this.hits.length || this.shk != null) this.clear(); return; }
    if (this.lastTick != null && tick < this.lastTick - 30) this.clear(); // 재접속 등 틱 되감기
    this.lastTick = tick;
    const fi = Math.floor(tick), step = fi !== this.lastFi;
    this.lastFi = fi;
    const au = this.auraState(o);
    if (step) {
      if (o.kind && o.ball) this.trail(specialElement(o.kind - 1), o.ball, fi);
      if (au) this.auraSpawn(au, fi);
    }
    if (!au) return;
    this.clip(g, o.sy);
    const p = PAL[au.el], { sx, sy, age, amp } = au;
    if (au.el === 'F') { // 몸 뒤에서 솟는 불기둥(2틱마다 모양이 바뀐다)
      for (let i = -6; i <= 6; i++) {
        const n = hsh(fi >> 1, i + 16);
        const h = Math.round((66 - Math.abs(i) * 5.5) * amp * (0.6 + 0.4 * n));
        if (h < 4) continue;
        const x = sx + i * 3 - 1 + (n > 0.66 ? 1 : n < 0.33 ? -1 : 0), top = sy + 3 - h;
        const d = Math.max(2, h >> 3), r = Math.max(2, (h * 5) >> 4), or = Math.max(2, (h * 5) >> 4);
        g.fillStyle = p[4]; g.fillRect(x, top, 3, d);
        g.fillStyle = p[3]; g.fillRect(x, top + d, 3, r);
        g.fillStyle = p[2]; g.fillRect(x, top + d + r, 3, or);
        g.fillStyle = p[1]; g.fillRect(x, top + d + r + or, 3, Math.max(0, h - d - r - or));
      }
    } else if (au.el === 'S') { // 몸 중심에서 퍼지는 기 고리 3겹: 굵은 바깥 점(노랑 → 분홍 → 보라) + 안쪽 흰 테
      for (let k = 0; k < 3; k++) {
        const ra = age - 2 - k * 6;
        if (ra < 0 || ra > 13) continue;
        const r = 6 + ra * 3, n = this.t ? 36 : 18;
        this.ring(g, sx, sy - 20, r, 0.7, p[ra < 6 ? 1 : ra < 11 ? 2 : 3], ra < 9 ? 4 : 3, n);
        if (ra < 11) this.ring(g, sx, sy - 20, r - 2, 0.7, p[ra < 7 ? 0 : 1], 2, n);
      }
    } else if (au.el === 'W') { // 발밑(지면)에서 퍼지는 먼지 고리 + 회오리 뒤쪽 반
      if (age >= 1 && age < 16) this.ring(g, sx, au.gy + 1, 8 + age * 2.5, 0.3, p[age < 9 ? 0 : 1], age < 11 ? 3 : 2, this.t ? 22 : 11);
      this.helix(g, au, fi, false);
    }
    // 발동 순간 기 폭발 고리(전 속성 공통)
    if (age < 8) this.ring(g, sx, sy - 20, 5 + age * 4, 1, p[Math.min(4, age >> 1)], age < 5 ? 3 : 2, this.t ? 24 : 12);
    g.restore();
  }

  /** 선수·공 위에 그리는 층: 오라 앞쪽 + 입자 + 명중 */
  drawFront(g, o) {
    if (!on) return;
    const { tick, cam } = o, fi = Math.floor(tick);
    const au = this.auraState(o);
    this.hits = this.hits.filter((h) => tick - h.start < HIT_T);
    if (!au && !this.ps.length && !this.hits.length) return;
    this.clip(g, o.sy);
    if (au) {
      const p = PAL[au.el], { sx, sy, age } = au;
      if (au.el === 'B' && age < 18 && (age < 4 || ((fi >> 1) & 1) === 0)) { // 위에서 내리꽂는 번개(2틱 켜짐·2틱 꺼짐)
        const s = fi >> 1;
        for (let k = 0; k < (this.t ? 2 : 1); k++) {
          this.bolt(g, sx + Math.round((hsh(s, k + 40) - 0.5) * 44), Math.max(CLIP_Y + 1, sy - 104), sx + (k ? 3 : -3), sy - 24 + k * 8, s * 4 + k, p);
        }
      } else if (au.el === 'W') this.helix(g, au, fi, true);
      if (age < 4) this.star(g, sx, sy - 20, 12 - age * 3, p[0]);
    }
    this.particles(g, cam, tick);
    for (const h of this.hits) {
      const age = tick - h.start;
      if (age < 0) continue;
      const a = Math.floor(age), p = PAL[h.el];
      const cx = Math.round(h.x - cam), cy = Math.round(h.y / 2 - h.z + Y0);
      if (a < 13) this.ring(g, cx, cy, 6 + a * 3, 1, p[Math.min(4, 1 + (a >> 2))], a < 8 ? 3 : 2, this.t ? 28 : 14);
      if (this.t && a >= 3 && a < 16) this.ring(g, cx, cy, 4 + (a - 3) * 3, 1, p[Math.min(4, 2 + ((a - 3) >> 2))], 2, 20);
      if (h.el === 'S' && a >= 6) this.ring(g, cx, cy, 4 + (a - 6) * 4, 0.5, p[2], 2, 16);
      if (h.el === 'B' && a < 8 && (a & 1) === 0) this.bolt(g, cx + Math.round((hsh(fi, 7) - 0.5) * 30), Math.max(CLIP_Y + 1, cy - 90), cx, cy, fi, p);
      if (a < 8) { // 방사 줄기 8갈래
        for (let d = 0; d < 8; d++) {
          const an = (h.rot ?? 0) + (d * Math.PI) / 4, c = Math.cos(an), s = Math.sin(an);
          for (let j = 0; j < 3; j++) {
            const r = 7 + a * 3 + j * 5, w = 3 - j;
            g.fillStyle = p[Math.min(4, j + (a >> 1))];
            g.fillRect(Math.round(cx + c * r) - (w >> 1), Math.round(cy + s * r) - (w >> 1), w, w);
          }
        }
      }
      if (a < 4) this.star(g, cx, cy, 16 - a * 3, p[0]);
      else if (a < 7) this.star(g, cx, cy, 5, p[1]);
    }
    g.restore();
  }

  /** 진행 중 오라의 화면 위치·세기. 끝났거나 선수를 못 찾으면 null */
  auraState(o) {
    const au = this.aura;
    if (!au) return null;
    const age = Math.floor(o.tick - au.start);
    if (age >= AURA_T) { this.aura = null; return null; }
    const pos = age >= 0 ? o.posOf(au.pid) : null;
    if (!pos) return null;
    const amp = age < 4 ? (age + 1) / 5 : age > AURA_T - 8 ? (AURA_T - age) / 8 : 1;
    return { el: au.el, age, amp, pos, sx: Math.round(pos[0] - o.cam), sy: Math.round(pos[1] / 2 - pos[2] + Y0), gy: Math.round(pos[1] / 2 + Y0) };
  }

  /** 오라 입자(틱당): 화염 = 오르는 불티, 번개 = 몸 주변 스파크, 충격파 = 솟는 기, 바람 = 발밑에서 말려 오르는 먼지·바람 줄 */
  auraSpawn(au, fi) {
    if (this.t === 0 && (fi & 1)) return;
    const [x, y, z] = au.pos;
    if (au.age > AURA_T - 6) return;
    for (let i = 0; i < (this.t === 2 ? (au.el === 'W' ? 2 : 3) : 1); i++) {
      const ox = (this.rnd() - 0.5) * 34, oz = this.rnd() * 40;
      if (au.el === 'W') this.spawn({ x: x + ox, y, z: this.rnd() * 6, vx: (ox < 0 ? -1 : 1) * (0.5 + this.rnd() * 1.1), vz: 1 + this.rnd() * 1.6, g: 0, t0: fi, life: 9 + this.rnd() * 5, sh: (fi + i) & 1 ? STREAK : DOT, el: 'W', sz: 3 });
      else if (au.el === 'F') this.spawn({ x: x + ox, y, z: z + oz, vx: (this.rnd() - 0.5) * 0.5, vz: 1 + this.rnd() * 1.2, g: 0, t0: fi, life: 11 + this.rnd() * 6, sh: DOT, el: 'F', sz: 4 });
      else if (au.el === 'B') this.spawn({ x: x + ox, y, z: z + oz, vx: 0, vz: 0, g: 0, t0: fi, life: 4 + this.rnd() * 3, sh: CROSS, el: 'B' });
      else this.spawn({ x: x + ox * 1.3, y, z: z + oz * 0.3, vx: 0, vz: 2.2 + this.rnd() * 1.4, g: 0, t0: fi, life: 8 + this.rnd() * 4, sh: PILLAR, el: 'S' });
    }
  }

  /** 필살 공 트레일(틱당). b = 공 [x,y,z] px, 공 그림 중심은 z + 12 */
  trail(el, b, fi) {
    if (this.t === 0 && (fi & 1)) return;
    const [x, y] = b, z = b[2] + 12, r = () => this.rnd() - 0.5;
    this.spawn({ x, y, z, vx: 0, vz: 0, g: 0, t0: fi, life: 9, sh: BLOB, el }); // 공이 지나간 자리에 남는 잔상 덩어리
    if (el === 'S' && this.t && fi % 3 === 0) this.spawn({ x, y, z, vx: 0, vz: 0, g: 0, t0: fi, life: 10, sh: RING, el });
    for (let i = this.t === 2 ? 3 : this.t; i > 0; i--) this.trailBit(el, x, y, z, fi, r);
  }

  trailBit(el, x, y, z, fi, r) {
    if (el === 'F') this.spawn({ x: x + r() * 12, y, z: z + r() * 12, vx: r() * 0.6, vz: 0.5 + this.rnd() * 0.9, g: 0, t0: fi, life: 12 + this.rnd() * 6, sh: DOT, el, sz: 4 });
    else if (el === 'B') this.spawn({ x: x + r() * 16, y, z: z + r() * 16, vx: 0, vz: 0, g: 0, t0: fi, life: 5 + this.rnd() * 3, sh: fi & 1 ? CROSS : DOT, el });
    else if (el === 'W') this.spawn({ x: x + r() * 6, y, z: z + r() * 18, vx: 0, vz: 0, g: 0, t0: fi, life: 10, sh: STREAK, el });
    else this.spawn({ x: x + r() * 12, y, z: z + r() * 12, vx: 0, vz: 0.3, g: 0, t0: fi, life: 8 + this.rnd() * 4, sh: DOT, el, sz: 4 });
  }

  /** 화면 y >= CLIP_Y 만 그린다. dy = 지금 걸려 있는 그리기 이동(흔들림 y, render.js 의 g.translate) — 빼서 이동 전(화면) 좌표로 자른다 */
  clip(g, dy = 0) { g.save(); g.beginPath(); g.rect(0, CLIP_Y - dy, W, H - CLIP_Y + Math.abs(dy)); g.clip(); }

  particles(g, cam, tick) {
    const ps = this.ps;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], age = tick - p.t0;
      if (age >= p.life || age < -60) continue;
      ps[w++] = p;
      if (age < 0) continue;
      const k = age / p.life, pal = PAL[p.el];
      const sx = Math.round(p.x + p.vx * age - cam), sy = Math.round(p.y / 2 - (p.z + p.vz * age - 0.5 * p.g * age * age) + Y0);
      if (sx < -8 || sx > W + 8) continue;
      g.fillStyle = pal[Math.min(4, (k * 5) | 0)];
      if (p.sh === DOT) { const z = p.sz ?? 3, s = k < 0.34 ? z : k < 0.67 ? z - 1 : Math.max(1, z - 2); g.fillRect(sx - (s >> 1), sy - (s >> 1), s, s); }
      else if (p.sh === STREAK) { const l = k < 0.5 ? 12 : 6; g.fillRect(sx - (l >> 1), sy, l, k < 0.3 ? 2 : 1); }
      else if (p.sh === PILLAR) g.fillRect(sx - 1, sy - 4, k < 0.5 ? 3 : 2, k < 0.5 ? 10 : 6);
      else if (p.sh === BLOB) {
        if (age < 1) continue; // 공 자리(가장 새 것)는 공을 가리지 않게 건너뛴다
        const s = Math.max(2, Math.round(9 - k * 8)), o = s >> 1; // 속성색 덩어리(모서리를 깎아 둥글게) + 새 것만 흰 중심 점
        g.fillStyle = pal[Math.min(4, 2 + ((k * 3) | 0))];
        if (s < 5) g.fillRect(sx - o, sy - o, s, s);
        else { g.fillRect(sx - o, sy - o + 2, s, s - 4); g.fillRect(sx - o + 2, sy - o, s - 4, s); g.fillRect(sx - o + 1, sy - o + 1, s - 2, s - 2); }
        if (k < 0.34) { const c = s >= 7 ? 3 : 2; g.fillStyle = pal[k < 0.2 ? 0 : 1]; g.fillRect(sx - (c >> 1), sy - (c >> 1), c, c); }
      }
      else if (p.sh === CROSS) { g.fillRect(sx - 2, sy, 5, 1); g.fillRect(sx, sy - 2, 1, 5); }
      else this.ring(g, sx, sy, 2 + ((k * 6) | 0), 1, g.fillStyle, 1, 8);
    }
    ps.length = w;
  }

  /** 점선 고리: n 개의 s x s 점. ky = 세로 눌림 */
  ring(g, cx, cy, r, ky, color, s, n) {
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.fillRect(Math.round(cx + Math.cos(a) * r) - (s >> 1), Math.round(cy + Math.sin(a) * r * ky) - (s >> 1), s, s);
    }
  }

  /** 십자 섬광 */
  star(g, cx, cy, r, color) {
    if (r < 2) return;
    const c = Math.max(1, r >> 1);
    g.fillStyle = color;
    g.fillRect(cx - r, cy - 1, r * 2, 2); g.fillRect(cx - 1, cy - r, 2, r * 2); g.fillRect(cx - c, cy - c, c * 2, c * 2);
  }

  /** 계단 모양 번개: (x0,y0) → (x1,y1), 6px 마디. 바깥 파랑 4px + 속 흰색 2px */
  bolt(g, x0, y0, x1, y1, seed, pal) {
    const n = Math.max(2, Math.ceil((y1 - y0) / 6)), segs = [];
    let x = x0;
    for (let s = 0; s < n; s++) {
      const nx = s === n - 1 ? x1 : Math.round(x0 + ((x1 - x0) * (s + 1)) / n + (hsh(seed, s) - 0.5) * 12);
      segs.push([x, y0 + s * 6, nx]);
      x = nx;
    }
    for (const [core, color] of [[0, pal[3]], [1, pal[0]]]) {
      g.fillStyle = color;
      const o = core ? 0 : 1;
      for (const [sx, sy, nx] of segs) {
        g.fillRect(sx - o, sy, 2 + o * 2, 6);
        if (nx !== sx) g.fillRect(Math.min(sx, nx) - o, sy + 5 - o, Math.abs(nx - sx) + 2 + o * 2, 1 + o * 2);
      }
    }
  }

  /** 바람: 몸을 감고 오르는 나선 줄기(앞쪽은 3px 밝은 줄 + 흰 심) + 발밑(지면) 납작한 회오리 호 2겹. front = 몸 앞쪽 반바퀴 */
  helix(g, au, fi, front) {
    const p = PAL.W, { sx, sy, gy, age, amp } = au, n = this.t ? 24 : 12, m = this.t ? 20 : 10;
    for (let k = 0; k < 2; k++) { // 발밑 회오리: 끊어진 호가 서로 반대로 돈다
      const r = Math.round((11 + k * 9 + (age % 6)) * (0.5 + 0.5 * amp));
      for (let i = 0; i < m; i++) {
        if ((i + k) % 5 >= 3) continue;
        const a = (i / m) * Math.PI * 2 + age * (k ? -0.5 : 0.6), d = Math.sin(a);
        if (d >= 0 !== front) continue;
        g.fillStyle = p[front ? k : 1 + k];
        g.fillRect(sx + Math.round(Math.cos(a) * r) - 2, gy + Math.round(d * r * 0.3), 4, 2);
      }
    }
    for (let i = 0; i < n; i++) {
      const ph = age * 0.55 + i * 1.7, d = Math.sin(ph);
      if (d >= 0 !== front) continue;
      const rise = (age * 3 + i * 5) % 58, rad = 8 + rise * 0.34; // 위로 갈수록 넓어지는 회오리
      const l = Math.max(4, Math.round((7 + rise * 0.22) * amp * (0.55 + 0.45 * Math.abs(d))));
      const x = sx + Math.round(Math.cos(ph) * rad) - (l >> 1), y = sy + 2 - rise;
      if (front) {
        g.fillStyle = p[i % 4 === 3 ? 2 : 1]; g.fillRect(x, y, l, 3);
        g.fillStyle = p[0]; g.fillRect(x + 1, y + 1, l - 2, 1);
      } else { g.fillStyle = p[i & 1 ? 1 : 2]; g.fillRect(x, y, l, 2); }
    }
  }
}
