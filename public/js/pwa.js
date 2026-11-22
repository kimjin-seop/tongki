// PWA(데스크톱 앱 설치, 2026-11-22): 서비스 워커 등록 + 설치 아이콘 버튼. 정책 = public/sw.js 머리 주석·docs/HANDOFF.md 「PWA」 절.
// 설치 버튼은 beforeinstallprompt 를 받았을 때만 보인다(이미 설치된 앱 창·iOS Safari·Firefox 등 미지원·최근에 닫음 = 숨김).
const DISMISS_KEY = 'tk.pwaDismiss';
const DISMISS_MS = 30 * 864e5; // 설치 창을 닫으면 30일 동안 버튼을 숨긴다(주소창 설치 아이콘은 그대로)
let deferred = null;
const subs = new Set();
const emit = () => { for (const f of subs) f(); };

export const isStandalone = () => ['standalone', 'window-controls-overlay', 'fullscreen', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
const dismissed = () => { try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_MS; } catch { return false; } };
export const canInstall = () => !!deferred && !isStandalone() && !dismissed();

addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit(); });
addEventListener('appinstalled', () => { deferred = null; emit(); });

/** HTTPS·localhost(보안 컨텍스트)에서만 등록. 실패는 경고만(게임 진행과 무관) */
export function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const go = () => navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch((e) => console.warn('sw', e));
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
}

/** 상단 아이콘 줄(소리 버튼 왼쪽)용 설치 버튼. 도트 아이콘(아래 화살표 + 받침), 글자 없음 */
export function installButton(h) {
  const b = h('button.btn.small.pwa-ins', { type: 'button', title: '설치', 'aria-label': '설치', onclick: async () => {
    const e = deferred; if (!e) return;
    deferred = null; emit();
    try { await e.prompt(); const r = await e.userChoice; if (r?.outcome !== 'accepted') localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* 무시 */ }
  } });
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 14 10'); svg.setAttribute('class', 'snd-ic'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('fill', 'currentColor');
  for (const [x, y, w, hh] of [[6, 0, 2, 4], [4, 3, 6, 1], [5, 4, 4, 1], [6, 5, 2, 1], [1, 6, 1, 4], [12, 6, 1, 4], [1, 9, 12, 1]]) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', hh); svg.append(r);
  }
  b.append(svg);
  const paint = () => { if (!b.isConnected && b.dataset.mounted) { subs.delete(paint); return; } b.dataset.mounted = '1'; b.hidden = !canInstall(); };
  subs.add(paint);
  paint();
  return b;
}
