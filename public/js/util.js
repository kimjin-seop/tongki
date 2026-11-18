// 공용 DOM 유틸 (프레임워크 없음)
export const $ = (sel, root = document) => root.querySelector(sel);

/** h('button.btn.primary', {onclick}, '텍스트', child) */
export function h(tag, attrs, ...kids) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m && m[1] ? m[1] : 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 논리 해상도 w x h 캔버스를 aw x ah 영역에 넣을 배율(최근접 이웃 확대).
 * 정수배가 영역의 97% 이상을 채우면 정수배(픽셀 크기 균일), 아니면 비정수 배율로 꽉 채운다
 * (1080p 는 정수 4배면 83%만 차서 좌우·상하가 비므로 비정수 4.82배). 결과 CSS 크기는 장치 픽셀에 맞춘다.
 */
export function fitScale(aw, ah, w, h) {
  const r = Math.max(0.1, Math.min(aw / w, ah / h));
  const ki = Math.floor(r);
  const k = ki >= 1 && ki / r >= 0.97 ? ki : r;
  const dpr = globalThis.devicePixelRatio || 1;
  const cw = Math.floor(w * k * dpr) / dpr, ch = Math.floor(h * k * dpr) / dpr;
  return { k: cw / w, cw, ch };
}

export class Emitter {
  constructor() { this._h = new Map(); }
  on(type, fn) { if (!this._h.has(type)) this._h.set(type, new Set()); this._h.get(type).add(fn); return () => this._h.get(type)?.delete(fn); }
  emit(type, data) { for (const fn of [...(this._h.get(type) || [])]) { try { fn(data); } catch (e) { console.error(e); } } }
}

/** 텍스트 입력 중인지(게임 키 가로채기 금지 판단) */
export function isTyping(t = document.activeElement) {
  if (!t) return false;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(t.type);
}
