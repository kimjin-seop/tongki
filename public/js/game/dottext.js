// HUD 이름용 도트 글자: 기존 폰트(DD UI 등)를 오프스크린에서 크게 그린 뒤 논리 픽셀 칸마다 덮인 비율로 이진화(반투명 없음),
// 검정 1px 외곽선 + 오른쪽·아래 1px 그림자를 붙인 캔버스를 만든다. 폰트에 없는 글자는 브라우저 대체 글꼴의 모양을 그대로 이진화한다.
// 기준 높이 h = 한글 '국'의 잉크 높이(논리 px). 한글 윗선·아랫선이 픽셀 행에 정확히 맞도록 폰트 크기·기준선을 정한다.

const SS = 4; // 논리 1px 당 샘플 수(가로·세로)
let scratch = null;
const ctx2d = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  return c.getContext('2d', { willReadFrequently: true });
};
const inkCache = new Map();
/** 100px 기준 한글 잉크 위·아래(px) */
function ink(font) {
  if (!inkCache.has(font)) {
    scratch ??= ctx2d(8, 8);
    scratch.font = `100px ${font}`;
    const m = scratch.measureText('국');
    const a = m.actualBoundingBoxAscent || 80, d = m.actualBoundingBoxDescent || 5;
    inkCache.set(font, { a, d: Math.max(0, d) });
  }
  return inkCache.get(font);
}

const chars = (s) => (globalThis.Intl?.Segmenter ? [...new Intl.Segmenter().segment(s)].map((x) => x.segment) : [...s]);

/**
 * 글자 → 논리 해상도 이진 마스크
 * @param {string} text
 * @param {{h:number, font?:string, maxW?:number, minSq?:number, th?:number, ss?:number, r?:number}} o
 *   h 한글 높이(논리 px), maxW 최대 폭(넘으면 가로 압축 → 그래도 넘으면 말줄임), minSq 최소 압축 비율,
 *   th 덮임 비율 임계값, ct 모서리 칸 임계값(0 = 정리 안 함), ss 샘플 수(1 = 원 해상도 직접 래스터), r 출력 배율(1 = 논리 px)
 * @returns {{w:number, h:number, top:number, hh:number, m:Uint8Array, text:string, sq:number}} top = 한글 상단 행, hh = 한글 높이
 */
export function dotMask(text, o) {
  const font = o.font ?? '"DD UI", sans-serif';
  const r = o.r ?? 1, ss = o.ss ?? SS, k = r * ss; // 출력 px 당 샘플 = ss, 논리 px 당 샘플 = k
  const { a, d } = ink(font);
  const fs = (o.h * 100) / (a + d); // 논리 폰트 크기
  scratch ??= ctx2d(8, 8);
  scratch.font = `${fs * k}px ${font}`;
  const width = (s) => scratch.measureText(s).width / k;
  const maxW = o.maxW ?? Infinity, minSq = o.minSq ?? 0.72;
  let t = text, wl = width(t), sq = 1;
  if (wl > maxW) {
    sq = Math.max(minSq, maxW / wl);
    if (wl * sq > maxW) { // 압축만으로 모자라면 끝 글자를 줄이고 '..'
      const cs = chars(text);
      while (cs.length > 1 && width(cs.join('') + '..') * sq > maxW) cs.pop();
      t = cs.join('') + '..'; wl = width(t);
    }
  }
  const m0 = scratch.measureText(t);
  const asc = a * fs / 100; // 한글 상단 → 기준선(논리 px)
  const up = Math.max(0, Math.ceil((m0.actualBoundingBoxAscent ?? 0) / k - asc));
  const down = Math.max(0, Math.ceil((m0.actualBoundingBoxDescent ?? 0) / k - (o.h - asc)));
  const left = Math.max(0, Math.ceil(((m0.actualBoundingBoxLeft ?? 0) / k) * sq));
  const W = Math.max(1, Math.ceil(Math.max(wl, (m0.actualBoundingBoxRight ?? 0) / k) * sq) + left) * r;
  const Hh = (up + o.h + down) * r;
  const g = ctx2d(W * ss, Hh * ss);
  g.font = `${fs * k}px ${font}`;
  g.fillStyle = '#fff';
  g.setTransform(sq, 0, 0, 1, 0, 0);
  g.fillText(t, (left * k) / sq, (up + asc) * k);
  const px = g.getImageData(0, 0, W * ss, Hh * ss).data;
  const th = (o.th ?? 0.42) * 255 * ss * ss;
  const m = new Uint8Array(W * Hh), cov = new Float32Array(W * Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let j = 0; j < ss; j++) { let p = ((y * ss + j) * W * ss + x * ss) * 4 + 3; for (let i = 0; i < ss; i++, p += 4) s += px[p]; }
    m[y * W + x] = s >= th ? 1 : 0;
    cov[y * W + x] = s / (255 * ss * ss);
  }
  // 외곽선 정리: 둥근 획(ㅇ 등)의 바깥 모서리 칸은 덮임이 덜하다 → 모서리 칸 중 덮임이 ct 미만이면 끈다(ㅁ 같은 각진 모서리는 남는다)
  const ct = o.ct ?? 0;
  if (ct > 0) {
    const on = (x, y) => (x >= 0 && y >= 0 && x < W && y < Hh ? m[y * W + x] : 0);
    const off = [];
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      if (!m[y * W + x] || cov[y * W + x] >= ct) continue;
      const u = on(x, y - 1), d = on(x, y + 1), l = on(x - 1, y), r = on(x + 1, y);
      if (u + d !== 1 || l + r !== 1) continue;
      off.push(y * W + x);
    }
    for (const i of off) m[i] = 0;
  }
  return { w: W, h: Hh, top: up * r, hh: o.h * r, m, text: t, sq };
}

/**
 * 마스크 → 외곽선·그림자를 붙인 캔버스(왼쪽·위 1px, 오른쪽·아래 2px 여백)
 * @param {ReturnType<typeof dotMask>} mk
 * @param {{fill:string, shade?:string, shadeRows?:number}} o shade = 아래쪽 shadeRows 행 색(HUD 숫자처럼 아래가 어두운 색)
 */
export function dotCanvas(mk, o) {
  const { w, h, m } = mk, W = w + 3, H = h + 3;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0);
  const img = g.createImageData(W, H), p = img.data;
  const rgb = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const F = rgb(o.fill), S = o.shade ? rgb(o.shade) : F;
  const shadeFrom = mk.top + mk.hh - (o.shadeRows ?? 0);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const x = X - 1, y = Y - 1, i = (Y * W + X) * 4;
    if (at(x, y)) { const C = y >= shadeFrom ? S : F; p[i] = C[0]; p[i + 1] = C[1]; p[i + 2] = C[2]; p[i + 3] = 255; continue; }
    let edge = false;
    for (let j = -1; j <= 1 && !edge; j++) for (let k = -1; k <= 1; k++) if (at(x + k, y + j)) { edge = true; break; }
    if (!edge) edge = at(x - 2, y - 2) || at(x - 1, y - 2) || at(x - 2, y - 1); // 오른쪽·아래 그림자
    if (edge) p[i + 3] = 255; // 검정
  }
  g.putImageData(img, 0, 0);
  return c;
}
