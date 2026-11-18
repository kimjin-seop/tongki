// 토스트(오류·거절·알림 전부. 인라인 오류 박스 금지 - AC-50)
import { h } from './util.js';

let host;
export function toast(msg, kind = 'info', ms = 3200) {
  if (!msg) return;
  host ??= document.getElementById('toasts');
  const key = kind + '|' + msg;
  const same = [...host.children].find((x) => x.dataset.key === key && !x.dataset.closing);
  if (same) { clearTimeout(same._t); same._t = setTimeout(() => close(same), ms); return; }
  const el = h('div.toast.' + kind, { role: kind === 'error' ? 'alert' : 'status' }, msg);
  el.dataset.key = key;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  el._t = setTimeout(() => close(el), ms);
  while (host.children.length > 3) host.firstChild.remove();
}
function close(el) { el.dataset.closing = '1'; el.classList.remove('show'); setTimeout(() => el.remove(), 250); }
