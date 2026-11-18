// 필살기 공 연출(시각 전용). 근거: analysis/06_special_shots.md §4 + ROM 표 직접 판독
//  - 공 스프라이트 $6: 0xBAB8 표(ID별 1바이트) -> ball.json special_* (rom_anim 값과 동일 키)
//  - 공 색: 0xB940 점프표 -> CRAM 라인2 44~47번(공 시트의 색 12~15) 4색 치환 목록(0x362E6/0x3636E~0x363A6), 순환형 0x363AE(12틱 6색)
//  - 공 숨김: 핸들러가 $2 bit1(그리기 생략, 0x1944)을 켜는 ID(1,2,3,47,51,26,27,30, ID5 는 첫 10프레임)
//  - 잔상/분신: 타입 0x84 패턴($1A) 12종 중 사용되는 10종(0xA8F6 점프표)
// 서버는 ID 만 보낸다(공 b[6]=kind, ID=kind-1). 분신 위치는 공 위치 이력/속도로 클라가 만든다.

/** 0xBAB8: ID -> $6(스프라이트 애니). ID29 는 0xBAEE 조건부(0x1E/0x1A/0x1C) */
const SPR = [
  2, 2, 2, 2, 0x12, 2, 2, 2, 2, 0x14, 2, 0x16, 2, 0x0e, 2, 0x0e, 2, 2, 2, 2, 2, 2, 0x0c, 2, 2, 0x0c, 2,
  2, 0x0c, 0x1e, 2, 2, 2, 2, 2, 0x0e, 0x0e, 0x0c, 0x18, 0x14, 0x18, 2, 0x18, 0x0e, 0x0e, 0x0e, 0x0e, 0x14, 2, 2, 0x10, 0x10, 0x10, 0x0e,
];
/** 0xB940 점프표: ID -> 색 목록 키(N=일반 0x362E6, A~H=0x3636E~0x363A6, Y=순환 0x363AE, -=변경 없음) */
const PAL_ID = '-NNNDYNYNEYFNBYBYYYYYYAYYAYYHNNNNNYBBHNEGYGBBBBENNCCCB';
/** Genesis 색(0x0BGR) 4개 = 공 시트 색 12,13,14,15 를 바꿀 값 */
const PAL = {
  N: [0x028, 0x0ae, 0x0ee, 0x002], A: [0x02e, 0x0ae, 0x0ee, 0x000], B: [0x00e, 0x688, 0x444, 0x022],
  C: [0xeea, 0xee6, 0xaa4, 0x862], D: [0xeea, 0xcc4, 0x882, 0x660], E: [0xeea, 0xcc4, 0x882, 0x000],
  F: [0x48a, 0x888, 0x248, 0x222], G: [0x000, 0xccc, 0x666, 0x222], H: [0xaa4, 0xee6, 0xeea, 0x000],
};
/** 순환형: 카운터 0~11 >>1 -> 6색(4색 모두 같은 값). 흰/빨/흰/초/흰/파 */
const CYCLE = [0xeee, 0x00e, 0xeee, 0x0e0, 0xeee, 0xe00];
/** 공 시트(ball.png, CRAM 라인2 = ROM 0x3A1AC) 의 색 12~15 실제 RGB */
const SRC = [0x028, 0x0ae, 0x0ee, 0x002];

/** 잔상 패턴: ID -> [패턴, 개수]. 핸들러별 생성 코드(0xAEF4~0xB4DE) 판독 */
const GHOST = {};
const gset = (pat, n, ids) => { for (const id of ids) GHOST[id] = [pat, n]; };
gset(0x20, 1, [1]); gset(0x24, 1, [2]); gset(0x0c, 1, [3, 47, 51]); gset(0x18, 1, [20, 50]); gset(0x1c, 1, [21]);
gset(0x04, 1, [26]); gset(0x08, 1, [27]); gset(0x10, 3, [31, 35, 37, 40]); gset(0x14, 2, [32]); gset(0x28, 3, [25]);
/** 공 본체를 그리지 않는 ID(잔상만 보임). 5 는 첫 10프레임만 */
const HIDDEN = new Set([1, 2, 3, 47, 51, 26, 27, 30]);
/** 루프 계열: 스냅 사이 곡선 보간 대상 */
export const LOOP_IDS = new Set([48, 49, 53]);

/** 시작 효과음(0xB866): ID -> 원작 사운드 번호. 에셋이 없어 키만 둔다(sfx.special.b7 ~ sfx.special.c1) */
const SFX = 'B7BDBDBDB8B9C1B8B9B8B8B8C1BDBAB9BABAB8BABDBDB8BEBBB8B9B9BDB7B9C0C0BDB9C0B7C0B7BDC0B7B7B8BAC1BABDBFBFBDBDB7BF';
export const specialSfxKey = (id) => (id >= 0 && id < 54 ? 'sfx.special.' + SFX.slice(id * 2, id * 2 + 2).toLowerCase() : null);

const ANIM = { 2: 'throw', 0x0c: 'special_0c', 0x0e: 'special_0e', 0x10: 'special_10', 0x12: 'special_12', 0x14: 'special_14',
  0x16: 'special_16', 0x18: 'special_18', 0x1a: 'special_1a', 0x1c: 'special_1c', 0x1e: 'special_1e' };

/** 필살기 ID 의 공 애니 이름. v = 공 속도(px/틱) */
export function specialAnim(id, v) {
  let s = SPR[id] ?? 2;
  if (id === 29 && Math.hypot(v.vx, v.vy) >= 6) { // 0xBAEE: 고속일 때 납작(|vz|<0.25)/급강하(vz<=-2) 변형. 조준값 $70/$72 조건은 생략
    if (Math.abs(v.vz) < 0.25) s = 0x1a; else if (v.vz <= -2) s = 0x1c;
  }
  return ANIM[s] ?? 'throw';
}

/** 공 색 치환 키(시트 캐시 키). null 이면 원본 시트 */
export function specialPalKey(id, frame) {
  const k = PAL_ID[id];
  if (!k || k === '-' || k === 'N') return null;
  if (k === 'Y') return 'Y' + (((frame % 12) + 12) % 12 >> 1);
  return k;
}

/** 공 본체를 그리지 않는가(el = 필살기 시작 후 경과 틱) */
export const specialHidden = (id, el) => HIDDEN.has(id) || (id === 5 && el < 10);

const g2rgb = (w) => [(w & 0xe) * 18, ((w >> 4) & 0xe) * 18, ((w >> 8) & 0xe) * 18];

/** 색 치환된 공 시트(캔버스) 캐시 */
export function paletteSheet(cache, img, key) {
  if (!key) return img;
  if (cache.has(key)) return cache.get(key);
  const dst = key[0] === 'Y' ? Array(4).fill(CYCLE[+key.slice(1)]) : PAL[key];
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
  const from = SRC.map(g2rgb), to = dst.map(g2rgb);
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    for (let j = 0; j < 4; j++) {
      const f = from[j];
      if (px[i] === f[0] && px[i + 1] === f[1] && px[i + 2] === f[2]) { [px[i], px[i + 1], px[i + 2]] = to[j]; break; }
    }
  }
  g.putImageData(d, 0, 0);
  cache.set(key, c);
  return c;
}

// 결정적 난수(프레임·분신·축별로 프레임마다 바뀜): 원작 0x14EA 대체
const rnd16 = (f, k, a) => { let x = (f * 73856093) ^ (k * 19349663) ^ (a * 83492791); x = Math.imul(x ^ (x >>> 13), 0x5bd1e995); return ((x ^ (x >>> 15)) >>> 0) & 15; };
const SIN = (t) => Math.sin(((t & 0x1ff) / 512) * Math.PI * 2) * 256; // 0x28A4 (진폭 ±256 추정)
const COS = (t) => Math.cos(((t & 0x1ff) / 512) * Math.PI * 2) * 256; // 0x28C8

/**
 * 잔상/분신 위치 목록(px, [x,y,z]). 시각 전용.
 * @param {number} id 필살기 ID  @param {number[]} p 공 위치  @param {{vx:number,vy:number,vz:number}} v 공 속도(px/틱)
 * @param {number} el 필살기 시작 후 경과 틱  @param {number} frame 정수 틱  @param {(back:number)=>number[]|null} past n틱 전 공 위치
 */
export function specialGhosts(id, p, v, el, frame, past) {
  const g = GHOST[id];
  if (!g) return [];
  const [pat, n] = g, [x, y, z] = p, t = 0x40 * (Math.max(0, Math.floor(el)) + 1); // 분신 $18: 생성 프레임부터 +0x40/f
  const out = [];
  for (let k = 0; k < n; k++) {
    switch (pat) {
      case 0x04: { const q = past(4); if (q) out.push(q); break; } // 이력 $F018 = 4프레임 전 위치
      case 0x08: out.push([x + v.vx * 4, y + v.vy * 4, z + v.vz * 4]); break; // 4프레임 앞(앞서가는 분신)
      case 0x0c: { const r = rnd16(frame, k, 0); out.push([x, y, z + ((frame >> 3) & 1 ? -r : r)]); break; } // 상하 떨림, 8f마다 부호
      case 0x10: { const a = (i) => { const r = rnd16(frame, k, i); return r & 1 ? -r : r; }; out.push([x + a(1), y + a(2), z + a(3)]); break; }
      case 0x14: out.push([x, Math.max(0, y + (k ? 16 : -16)), z]); break; // y 오프셋 표 0xAB1E(-16,+16)
      case 0x18: out.push([x, y, z + SIN(t) / 16]); break; // sin>>4
      case 0x1c: out.push([x, y, z + SIN(t) / 64]); break; // sin>>6
      case 0x20: out.push([x + COS(t) / 16, y, z + SIN(t) / 16]); break; // 원운동 반경 16
      case 0x24: out.push([x + COS(t) / 64, y, z + SIN(t) / 64]); break; // 반경 4
      case 0x28: { const s = (k + 1) / 2; out.push([x - v.vx * s, y - v.vy * s, z - v.vz * s]); break; } // 속도 -1/2 로 k+1 스텝
      default:
    }
  }
  return out;
}
