// 초대 링크: 대기실 코드 칩 = `${origin}/?room=<CODE>` 복사, 그 링크로 들어오면 로비가 된 뒤 join_room{code} 1회(PROTOCOL 메시지 불변).
// 대기 코드는 sessionStorage 에만 두고 주소창의 room 쿼리는 바로 지운다(새로고침 중복 참가 방지). 코드는 서버 CODE_RE 와 같은 형식만 받는다.
import { toast } from './ui.js';

const CODE_RE = /^[A-Z0-9]{4,6}$/; // server/net/protocol.js CODE_RE
const KEY = 'dd.invite';
const ss = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { sessionStorage.setItem(KEY, v); } catch { /* 저장 불가 무시 */ } },
  del: () => { try { sessionStorage.removeItem(KEY); } catch { /* 무시 */ } },
};
const norm = (v) => { const c = typeof v === 'string' ? v.trim().toUpperCase() : ''; return CODE_RE.test(c) ? c : null; };

/** 부팅 때 1회: ?room= 을 읽어 보관하고 주소창에서 그 쿼리만 지운다(다른 쿼리 값은 쓰지 않는다) */
export function capture() {
  let u; try { u = new URL(location.href); } catch { return; }
  if (!u.searchParams.has('room')) return;
  const c = norm(u.searchParams.get('room'));
  if (c) ss.set(c);
  u.searchParams.delete('room');
  try { history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch { /* 무시 */ }
}

/** 대기 코드를 꺼내고 지운다(1회 시도) */
export function take() { const c = norm(ss.get()); ss.del(); return c; }
export const pending = () => !!norm(ss.get());

export const shareable = (r) => !!r && !r.vsCpu && !r.ladder && !r.ranked && !r.campaign && !r.training && !r.league && !r.flame && !!norm(r.code);

function fallbackCopy(text) {
  const prev = document.activeElement;
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.append(ta);
  let ok = false;
  try { ta.select(); ta.setSelectionRange(0, text.length); ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  prev?.focus?.({ preventScroll: true });
  return ok;
}

/** 초대 URL 복사 → 토스트 한 줄 */
export async function copy(code) {
  const c = norm(code); if (!c) return false;
  const url = `${location.origin}/?room=${c}`;
  let ok = false;
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(url); ok = true; } catch { ok = false; }
  }
  if (!ok) ok = fallbackCopy(url);
  toast(ok ? '링크를 복사했습니다' : '링크를 복사하지 못했습니다', ok ? 'ok' : 'error', 2000);
  return ok;
}
