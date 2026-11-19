// 불꽃의 계승 오리지널 선수 외형(PROTOCOL §13.8 skin = {team, idx, uni, hair}): 원작 선수의 몸(시트·얼굴)을 빌려 유니폼·머리 색만 바꾼다.
// 알고리즘은 안아트 시범(_verify/flame_orig_pilot/pilot.py recolor)을 그대로 옮긴 것이다:
//   - 유니폼: 팀 팔레트 원색 -> 역할(topLo·topHi·botLo·botHi·trimLo·trimHi·extra) -> 세트 색. 윤곽 검정·흰색·회색·피부(protect)는 건드리지 않는다
//   - 머리 C(전용 2색): 어두운 쪽 -> lo, 밝은 쪽 -> hi / B·G(검은 머리 슬롯 단색): 칸마다 4방향으로 이어진 8픽셀 이상 덩어리만 mono(눈·눈썹 선 보호) / K·N: 그대로
//   - uni·hair 0 = 원본 유지. 얼굴 칸(face)은 B·G 단색을 바꾸지 않고, 칸 바탕(원작 = 하의 밝은 색)을 세트의 상의 밝은 색으로 한다
// 색 값·팀별 표는 서버 카탈로그가 아니라 정적 파일 /assets/data/orig_skin.json 이다. 못 읽거나 표에 없는 팀이면 null 을 돌려 호출 쪽이 원본 그림으로 그린다.
// 캐시(키 team/idx/uni/hair): 선수별 띠(시트 2행, 3760x160 = 약 2.4MB) 캔버스는 최대 STRIP_MAX 장(약 34MB)까지만 들고 오래된 것부터 버린다.
import { has, entry, image, jsonAt } from '../../game/assets.js';

const DATA_PATH = 'data/orig_skin.json';
const FACE = 24, STAND_COL = 24, STRIP_MAX = 14;
const UNI_ROLES = ['topLo', 'topHi', 'botLo', 'botHi', 'trimLo', 'trimHi', 'extra'];
const HEX_RE = /^[0-9a-f]{6}$/;
const num = (hex) => (typeof hex === 'string' && HEX_RE.test(hex) ? parseInt(hex, 16) : -1);

let dataP = null;
/** 색 표(실패하면 null: 다음에 다시 받지 않는다. 화면은 원본 그림으로 그린다) */
export function loadSkinData() {
  dataP ??= jsonAt(DATA_PATH).then((d) => (d && typeof d === 'object' && d.teams && Array.isArray(d.uniformSets) && Array.isArray(d.hairSets) ? d : null))
    .catch((e) => { console.warn('flame skin', e.message); return null; });
  return dataP;
}

/** skin 형식 검사: {team, idx, uni, hair} 정수. 아니면 null */
export function validSkin(s) {
  return s && [s.team, s.idx, s.uni, s.hair].every((v) => Number.isInteger(v) && v >= 0) && s.idx < 7 ? s : null;
}
/** 색을 바꿀 것이 있는가(uni·hair 가 모두 0 이면 원본 그대로) */
export const tinted = (s) => !!validSkin(s) && (s.uni > 0 || s.hair > 0);
const keyOf = (s) => `${s.team}/${s.idx}/${s.uni}/${s.hair}`;

/**
 * RGBA 픽셀(px, w x h)을 제자리에서 바꾼다. 알파는 그대로다(불투명 픽셀만 바꾼다).
 * D = orig_skin.json, skin = {team, idx, uni, hair}, o.cell = 칸 크기(검은 머리 덩어리를 칸 단위로 센다), o.face = 얼굴 칸. 바꾼 픽셀 수를 돌려준다(표가 없으면 -1)
 */
export function recolorPixels(px, w, h, D, skin, o = {}) {
  const T = D?.teams?.[String(skin.team)];
  if (!T) return -1;
  const uni = skin.uni > 0 ? D.uniformSets[skin.uni - 1] ?? null : null, hair = skin.hair > 0 ? D.hairSets[skin.hair - 1] ?? null : null;
  const kind = T.hairKind?.[skin.idx] ?? 'N', cell = o.cell ?? 80;
  const keep = new Set((T.protect ?? []).map(num));
  const map = new Map(); // 원색 -> 새 색(둘 다 0xRRGGBB)
  const put = (src, dst) => { const a = num(src), b = num(dst); if (a >= 0 && b >= 0 && !keep.has(a)) map.set(a, b); };
  if (uni) {
    for (const [src, role] of Object.entries(T.uniform ?? {})) if (UNI_ROLES.includes(role)) put(src, uni[role]);
    if (o.face) put(T.faceBg, uni.topHi);
  }
  if (hair && kind === 'C') { put(T.hair?.lo, hair.lo); put(T.hair?.hi, hair.hi); }
  let changed = 0;
  const n = w * h;
  if (map.size) {
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (!px[p + 3]) continue;
      const to = map.get((px[p] << 16) | (px[p + 1] << 8) | px[p + 2]);
      if (to === undefined) continue;
      px[p] = to >> 16; px[p + 1] = (to >> 8) & 255; px[p + 2] = to & 255; changed++;
    }
  }
  const blk = num(T.hair?.blk), mono = num(hair?.mono);
  if (hair && (kind === 'B' || kind === 'G') && !o.face && blk >= 0 && mono >= 0) {
    // 검은 머리 슬롯은 눈·눈썹 선과 같은 색이다: 칸 안에서 4방향으로 이어진 덩어리가 hairMinComp 이상일 때만 머리로 본다
    const min = D.hairMinComp ?? 8, seen = new Uint8Array(n), stack = new Int32Array(cell * cell), pts = new Int32Array(cell * cell);
    const isBlk = (i) => { const p = i * 4; return px[p + 3] > 0 && ((px[p] << 16) | (px[p + 1] << 8) | px[p + 2]) === blk; };
    for (let cy = 0; cy < h; cy += cell) for (let cx = 0; cx < w; cx += cell) {
      const x1 = Math.min(w, cx + cell), y1 = Math.min(h, cy + cell);
      for (let y = cy; y < y1; y++) for (let x = cx; x < x1; x++) {
        const i0 = y * w + x;
        if (seen[i0] || !isBlk(i0)) continue;
        let sp = 0, np = 0;
        stack[sp++] = i0; seen[i0] = 1;
        while (sp) {
          const i = stack[--sp], ix = i % w, iy = (i / w) | 0;
          pts[np++] = i;
          if (ix + 1 < x1 && !seen[i + 1] && isBlk(i + 1)) { seen[i + 1] = 1; stack[sp++] = i + 1; }
          if (ix > cx && !seen[i - 1] && isBlk(i - 1)) { seen[i - 1] = 1; stack[sp++] = i - 1; }
          if (iy + 1 < y1 && !seen[i + w] && isBlk(i + w)) { seen[i + w] = 1; stack[sp++] = i + w; }
          if (iy > cy && !seen[i - w] && isBlk(i - w)) { seen[i - w] = 1; stack[sp++] = i - w; }
        }
        if (np < min) continue;
        for (let k = 0; k < np; k++) { const p = pts[k] * 4; px[p] = mono >> 16; px[p + 1] = (mono >> 8) & 255; px[p + 2] = mono & 255; }
        changed += np;
      }
    }
  }
  return changed;
}

/** 그림의 한 구역을 잘라 색을 바꾼 캔버스. 표가 없거나 캔버스를 못 쓰면 null */
async function region(img, sx, sy, w, h, skin, o) {
  const D = await loadSkinData();
  if (!D?.teams?.[String(skin.team)]) return null;
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: false });
    g.imageSmoothingEnabled = false;
    g.drawImage(img, sx, sy, w, h, 0, 0, w, h);
    const im = g.getImageData(0, 0, w, h);
    if (recolorPixels(im.data, w, h, D, skin, o) < 0) return null;
    g.putImageData(im, 0, 0);
    return c;
  } catch (e) { console.warn('flame skin', e.message); return null; }
}
const sheetKey = (team) => `spr.team.${String(team).padStart(2, '0')}`;

const strips = new Map(), faces = new Map(), urls = new Map(), stands = new Map();
/** 실패(null)는 캐시에 남기지 않는다 */
function cached(m, k, make, max = 64) {
  let p = m.get(k);
  if (p) { m.delete(k); m.set(k, p); return p; } // 최근에 쓴 것을 뒤로
  p = make().catch((e) => { console.warn('flame skin', e.message); return null; });
  m.set(k, p);
  p.then((v) => { if (v === null && m.get(k) === p) m.delete(k); });
  while (m.size > max) m.delete(m.keys().next().value);
  return p;
}

/** 경기용 선수 띠: 그 선수의 시트 2행(오른쪽 보기·왼쪽 보기)만 잘라 색을 바꾼 캔버스(행 0·1). 바꿀 것이 없거나 실패하면 null(원본 시트를 쓴다) */
export function strip(skin) {
  if (!tinted(skin) || !has(sheetKey(skin.team))) return Promise.resolve(null);
  return cached(strips, keyOf(skin), async () => {
    const cell = entry(sheetKey(skin.team)).cell ?? 80, img = await image(sheetKey(skin.team));
    return region(img, 0, skin.idx * 2 * cell, img.naturalWidth || img.width, cell * 2, skin, { cell });
  }, STRIP_MAX);
}
/** 얼굴 24x24(hud.faces 아틀라스와 같은 방향). 바꿀 것이 없거나 실패하면 null(아틀라스의 skin.team·skin.idx 칸을 쓴다) */
export function faceCanvas(skin) {
  if (!tinted(skin) || !has('hud.faces')) return Promise.resolve(null);
  return cached(faces, keyOf(skin), async () => region(await image('hud.faces'), skin.idx * FACE, skin.team * FACE, FACE, FACE, skin, { cell: FACE, face: true }));
}
/** 얼굴 그림 주소(DOM 배경용). 없으면 null */
export function faceUrl(skin) {
  if (!tinted(skin)) return Promise.resolve(null);
  return cached(urls, keyOf(skin), async () => (await faceCanvas(skin))?.toDataURL('image/png') ?? null);
}
/** 서 있는 자세 한 칸(DOM 스프라이트용, 칸 전체 cell x cell). 없으면 null */
export function standCanvas(skin) {
  if (!tinted(skin) || !has(sheetKey(skin.team))) return Promise.resolve(null);
  return cached(stands, keyOf(skin), async () => {
    const cell = entry(sheetKey(skin.team)).cell ?? 80;
    return region(await image(sheetKey(skin.team)), STAND_COL * cell, skin.idx * 2 * cell, cell, cell, skin, { cell });
  });
}
/**
 * 경기 상대에 따른 원정 세트(orig_skin.json away[] = {vs: 상대 팀 id, uni: 원래 세트, use: 바꿔 입을 세트}): 상대 유니폼과 색이 겹치는 세트만 그 경기에서 바꿔 입는다
 * (지금은 상아(팀 1, 노랑) 상대일 때 세트 1 의 노란 양말·손목 → 흰색 세트 9). 표가 없거나 맞는 줄이 없으면 받은 skin 그대로
 */
export async function awaySkin(skin, oppTeam) {
  if (!validSkin(skin) || !Number.isInteger(oppTeam)) return skin;
  const D = await loadSkinData();
  const a = Array.isArray(D?.away) ? D.away.find((x) => x && x.vs === oppTeam && x.uni === skin.uni && Number.isInteger(x.use) && D.uniformSets[x.use - 1]) : null;
  return a ? { ...skin, uni: a.use } : skin;
}
/** 들고 있는 선수 띠 캔버스의 픽셀 바이트 합(실측 기록용) */
export async function stripBytes() {
  let n = 0;
  for (const p of strips.values()) { const c = await p; if (c) n += c.width * c.height * 4; }
  return n;
}
