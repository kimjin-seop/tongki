// 에셋 manifest 계층 (AC-51): 코드는 키(spr.team.00, font.title ...)로만 참조하고
// 실제 경로·해상도 변형은 /assets/manifest.json 이 결정한다.
const BASE = '/assets/';
let manifest = null;
const quality = localStorage.getItem('gfx.quality') || '1x';
const cache = new Map();

export async function loadManifest() {
  const r = await fetch(BASE + 'manifest.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('manifest ' + r.status);
  manifest = await r.json();
  return manifest;
}

export function entry(key) {
  const e = manifest?.[key];
  if (!e) throw new Error('asset key 없음: ' + key);
  const v = e.variants ? (e.variants[quality] || e.variants['1x'] || Object.values(e.variants)[0]) : null;
  return { ...e, path: v?.path ?? e.path, scale: v?.scale ?? 1 };
}

export function has(key) { return !!manifest?.[key]; }

/** 실패한 Promise 는 캐시에서 빼서 다음 호출 때 다시 받게 한다 */
function remember(ck, p) {
  cache.set(ck, p);
  p.catch(() => { if (cache.get(ck) === p) cache.delete(ck); });
  return p;
}

export function json(key) {
  if (!cache.has(key)) remember(key, fetch(BASE + entry(key).path).then((r) => { if (!r.ok) throw new Error(key + ' ' + r.status); return r.json(); }));
  return cache.get(key);
}

export function image(key) {
  if (!cache.has(key)) {
    remember(key, new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('image ' + key));
      img.src = BASE + entry(key).path;
    }));
  }
  return cache.get(key);
}

/** 서버가 준 상대 경로(/assets/ 기준) 직접 로드. 경로는 호출 측에서 형식 검증 후 넘긴다 */
export function imageAt(path) {
  const ck = 'path:' + path;
  if (!cache.has(ck)) {
    cache.set(ck, new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('image ' + path));
      img.src = BASE + path;
    }));
  }
  return cache.get(ck);
}
export function jsonAt(path) {
  const ck = 'path:' + path;
  if (!cache.has(ck)) cache.set(ck, fetch(BASE + path).then((r) => { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); }));
  return cache.get(ck);
}

/** font.* 키를 FontFace 로 등록. 실패해도 시스템 폰트로 폴백하므로 치명적이지 않다. */
export async function loadFonts() {
  const keys = Object.keys(manifest).filter((k) => k.startsWith('font.'));
  await Promise.all(keys.map(async (k) => {
    const e = entry(k);
    try {
      const ff = new FontFace(e.family, `url(${BASE + e.path})`);
      document.fonts.add(await ff.load());
    } catch (err) { console.warn('font', k, err); }
  }));
}
