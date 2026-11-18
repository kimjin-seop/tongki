// 캔버스용 도트 글자(Galmuri7 네이티브 8px = 'DD Pixel8', Galmuri11 12px = 'DD Pixel12', 안티앨리어싱 없음).
// 경기 전 화면(편성·라인업)이 같이 쓴다. 글꼴이 늦게 오면 폴백 글꼴로 굳으므로 준비 뒤 clearPixText() 로 비운다.
// 브라우저(Windows)는 작은 글자를 가로로 번지게 그려서(세로획이 2~3칸에 걸침) 1배로 그린 뒤 알파를 이진화하면
// 'ㅐ' 같은 겹세로획이 한 덩어리로 붙는다. 그래서 SS 배로 크게 그리고 각 도트의 한가운데만 읽어 원래 도트를 되살린다.
const FALLBACK = '"DD UI", sans-serif';
const SS = 4;
const cache = new Map();

/** 1배 기준 글자 폭과 SS 배로 그린 알파. 글자 윗선은 y=1(1배) 근처, 밑선(alphabetic)은 정수 줄에 맞춘다 */
function raster(str, px, ls) {
  const fam = px >= 12 ? '"DD Pixel12"' : '"DD Pixel8"';
  const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
  const set = (g, k) => { g.font = `${px * k}px ${fam}, ${FALLBACK}`; g.letterSpacing = `${ls * k}px`; };
  set(x, 1);
  const w = Math.ceil(x.measureText(str).width) + 1;
  x.textBaseline = 'top'; const top = x.measureText(str).fontBoundingBoxAscent;
  x.textBaseline = 'alphabetic'; const base = 1 + Math.round(x.measureText(str).fontBoundingBoxAscent - top);
  c.width = w * SS; c.height = (px + 3) * SS;
  const y = c.getContext('2d', { willReadFrequently: true });
  set(y, SS); y.textBaseline = 'alphabetic'; y.fillStyle = '#fff';
  y.fillText(str, 0, base * SS);
  return { w, big: y.getImageData(0, 0, c.width, c.height) };
}

/**
 * 글자 한 줄을 그린 캔버스(폭 = 글자 폭, 높이 = px+3, 글자는 y=1 부터).
 * maxW 를 넘으면 8px 는 자간 1 → 0 으로 먼저 좁히고, 그래도 넘으면 가로로만 줄인다(도트 열을 솎음)
 */
export function pixText(str, px, fill, maxW) {
  const key = `${str}|${px}|${fill}|${maxW}`;
  if (!cache.has(key)) {
    let r = raster(str, px, px < 12 ? 1 : 0);
    if (maxW && r.w > maxW && px < 12) r = raster(str, px, 0);
    const sq = maxW && r.w > maxW ? maxW / r.w : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(r.w * sq)); c.height = px + 3;
    const g = c.getContext('2d');
    g.fillStyle = fill; g.fillRect(0, 0, c.width, c.height);
    const im = g.getImageData(0, 0, c.width, c.height), d = im.data, src = r.big.data, bw = r.big.width;
    for (let yy = 0; yy < c.height; yy++) {
      for (let xx = 0; xx < c.width; xx++) {
        const sx = Math.min(r.w - 1, Math.floor((xx + 0.5) / sq)); // 1배 도트 열
        const a = src[((yy * SS + (SS >> 1)) * bw + sx * SS + (SS >> 1)) * 4 + 3];
        d[(yy * c.width + xx) * 4 + 3] = a >= 128 ? 255 : 0;
      }
    }
    g.putImageData(im, 0, 0);
    cache.set(key, c);
  }
  return cache.get(key);
}

/** 글자 폭(1배 도트, 자간 포함). 칸에 들어가는지 미리 잴 때 쓴다 */
export function pixTextWidth(str, px) { return raster(str, px, px < 12 ? 1 : 0).w; }

export function clearPixText() { cache.clear(); }
