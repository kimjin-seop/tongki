// 서비스 워커(PWA, 2026-11-22 윤프론). 범위 = / . 정책·버전 올리는 법 = docs/HANDOFF.md 「PWA」 절.
// - 가로채는 것: 같은 출처 GET 정적 파일만. /ws(WebSocket 은 SW 를 거치지 않음)·/api·/health·Range 요청·다른 출처는 손대지 않는다.
// - 화면 이동(navigate): 네트워크 그대로, 실패할 때만 /offline.html. HTML 은 캐시에 넣지 않는다(/?room= 초대 응답 포함).
// - 코드(js·css·json·webmanifest): 네트워크 우선(서버 no-cache + ETag 재검증 그대로), 실패 시 캐시.
// - 그림·글꼴(png·svg·ico·woff2·jpg): stale-while-revalidate. 음원(ogg·mp3·wav)은 크기가 커서 캐시하지 않는다(HTTP 캐시 1시간에 맡김).
// - 새 판: VERSION 을 올리면 브라우저가 새 SW 를 받아 대기시키고, 열린 창이 모두 닫힌 다음 실행부터 적용(skipWaiting 안 함 = 경기 중 교체·새로고침 없음).
const VERSION = 'tongki-pwa-v1';
const SHELL = VERSION + '-shell';
const RT = VERSION + '-rt';
const SHELL_FILES = ['/offline.html', '/icon-192.png', '/favicon.svg'];
const CODE = /\.(js|mjs|css|json|webmanifest)$/i;
const MEDIA = /\.(png|svg|ico|woff2|jpg|jpeg|webp|gif)$/i;
const SKIP = /^\/(ws|api|health)(\/|$)/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('tongki-pwa-') && k !== SHELL && k !== RT).map((k) => caches.delete(k)))));
});

/** 캐시해도 되는 응답: 같은 출처 200 이고 no-store·private 이 아님 */
const storable = (r) => r && r.ok && r.status === 200 && r.type === 'basic' && !/no-store|private/i.test(r.headers.get('cache-control') || '');

async function put(req, res) {
  if (!storable(res)) return;
  try { await (await caches.open(RT)).put(req, res); } catch { /* 용량 초과 등: 무시 */ }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || SKIP.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match('/offline.html')) || Response.error()));
    return;
  }
  if (url.pathname === '/sw.js') return;

  if (CODE.test(url.pathname)) {
    e.respondWith(fetch(req).then((res) => { e.waitUntil(put(req, res.clone())); return res; })
      .catch(async () => (await caches.match(req)) || Response.error()));
    return;
  }
  if (MEDIA.test(url.pathname)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      const net = fetch(req).then((res) => { e.waitUntil(put(req, res.clone())); return res; });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    })());
  }
  // 그 밖(음원 등)은 가로채지 않는다
});
