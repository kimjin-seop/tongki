// 채팅(사람끼리 방: 대기실 패널 + 경기 중 받은 줄·입력창). 시안 _asset_samples/tongki_chat_mock(사용자 결정: 경기 중 받은 줄 최대 5줄).
// 보일지는 서버의 room.chat 만 본다(방 종류를 따로 판정하지 않는다). 글자는 textContent(h 의 글자 노드)로만 넣는다.
// 서버 → {t:'chat', from, text, at, admin?}, 클라 → {t:'chat', text} / 관리자 「공지」 토글이 켜져 있으면 {t:'notice_send', text}
import { h } from './util.js';
import { net } from './net.js';

export const CHAT_MAX = 60, NOTICE_MAX = 100;
const KEEP = 50, GAME_LINES = 5, IDLE_LINES = 3, HOLD_MS = 5000, FADE_MS = 600;

const store = { code: null, lines: [], subs: new Set() };
let noticeMode = false; // 관리자 「공지」 토글: 기본 꺼짐, 새로고침하면 꺼짐(모듈 변수만)
let panel = null; // 대기실 패널(방마다 하나: 화면을 다시 그려도 입력 중 글자·스크롤 유지)
const emit = () => { for (const f of [...store.subs]) f(); };

/** 방에 들어옴(room_joined). 다른 방이면 기록을 비운다 */
export function enterRoom(code) {
  if (store.code === code) return;
  store.code = code ?? null; store.lines = [];
  panel?.drop(); panel = null;
  emit();
}
/** 방을 나감(room_left·로그아웃) */
export function reset() { enterRoom(null); }

function push(l) {
  store.lines.push(l);
  if (store.lines.length > KEEP) store.lines.splice(0, store.lines.length - KEEP);
  emit();
}
export function receive(m) {
  if (typeof m?.text !== 'string' || !store.code) return;
  push({ from: String(m.from ?? ''), text: m.text, admin: m.admin === true, at: performance.now() });
}
/** 새 공지를 대기실 기록에도 한 줄(경기 중 받은 줄에는 넣지 않는다: 공지 띠가 따로 뜬다) */
export function noticeLine(m) {
  if (typeof m?.text !== 'string' || !store.code) return;
  push({ notice: true, text: m.text, at: performance.now() });
}

function lineEl(app, l, cls = '') {
  if (l.notice) return h('div.cm-l.ntc' + cls, h('span.tag', '공지'), l.text);
  const seat = app.room?.slots?.findIndex((s) => s && s.nick === l.from) ?? -1;
  return h('div.cm-l' + (l.admin ? '.adm' : '') + cls, l.admin ? h('span.tag', '운영') : null,
    h('span.n' + (seat === 0 ? '.p1' : seat === 1 ? '.p2' : ''), l.from), l.text);
}
function send(app, text) {
  const t = text.trim();
  if (!t) return false;
  if (noticeMode && app.admin) net.send('notice_send', { text: t });
  else net.send('chat', { text: t });
  return true;
}
const modeSubs = new Set();
function setMode(on) { noticeMode = !!on; for (const f of [...modeSubs]) f(); }

/** 입력칸 공통: 글자 수 표시·한도(채팅 60 / 공지 100)·공지 토글 */
function inputParts(app, { cls, placeholder, onEnter, onEsc }) {
  const tx = h('input.cm-tx', { type: 'text', maxLength: CHAT_MAX * 2, placeholder: placeholder || null, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'send', 'aria-label': '채팅 입력' });
  const cnt = h('span.cnt.tabular');
  const to = cls === 'game' ? h('span.to') : null;
  const tg = app.admin ? h('button.tg', { type: 'button', tabIndex: -1, 'aria-pressed': 'false', onpointerdown: (e) => e.preventDefault(), onclick: () => setMode(!noticeMode) }, '공지') : null;
  const sync = () => {
    const on = noticeMode && !!app.admin, max = on ? NOTICE_MAX : CHAT_MAX;
    tx.maxLength = max * 2; // UTF-16 상한(코드포인트 최대 2칸). 실제 한도는 아래 코드포인트 기준(서버와 같다)
    let cp = Array.from(tx.value);
    if (cp.length > max) { cp = cp.slice(0, max); tx.value = cp.join(''); }
    cnt.textContent = `${cp.length}/${max}`;
    if (to) to.textContent = on ? '전원' : '전체';
    tg?.setAttribute('aria-pressed', String(on));
    return on;
  };
  tx.addEventListener('input', sync);
  tx.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onEnter(); }
    else if (e.key === 'Escape' && onEsc) { e.preventDefault(); e.stopPropagation(); onEsc(); }
  });
  return { tx, cnt, to, tg, sync };
}

// ---------------- 대기실 패널(.seats 와 .cmds 사이, 50줄 보관 스크롤 + 입력창) ----------------
export function roomPanel(app) {
  if (panel && panel.code === store.code) return panel;
  panel?.drop();
  const log = h('div.rc-log', { role: 'log', 'aria-label': '채팅' });
  const thumb = h('i');
  const bar = h('div.rc-bar', { 'aria-hidden': 'true' }, thumb);
  let stick = true, saved = null;
  const doSend = () => { if (send(app, p.tx.value)) { p.tx.value = ''; p.sync(); } };
  const p = inputParts(app, { cls: 'room', placeholder: '채팅 입력 (Enter)', onEnter: doSend, onEsc: () => p.tx.blur() });
  const sendBtn = h('button.send', { type: 'button', tabIndex: -1, onpointerdown: (e) => e.preventDefault(), onclick: doSend }, '보내기');
  const row = h('div.rc-in', p.tg, p.tx, p.cnt, sendBtn);
  const el = h('div.rchat', log, bar, row);
  const paintMode = () => { el.classList.toggle('notice', p.sync()); };
  const paintBar = () => {
    const sh = log.scrollHeight, ch = log.clientHeight;
    thumb.hidden = sh <= ch + 1;
    if (thumb.hidden) return;
    thumb.style.height = Math.max(8, (ch / sh) * 100) + '%';
    thumb.style.bottom = ((sh - ch - log.scrollTop) / sh) * 100 + '%';
  };
  const render = () => {
    const at = stick || log.scrollTop + log.clientHeight >= log.scrollHeight - 2;
    log.replaceChildren(...store.lines.map((l) => lineEl(app, l)));
    if (at) log.scrollTop = log.scrollHeight;
    paintBar();
  };
  log.addEventListener('scroll', () => { stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 2; paintBar(); });
  // 크기가 바뀌면(화면 회전·배율 구간 변경) 맨 아래(최신)에 붙어 있던 로그는 계속 맨 아래로
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (stick) log.scrollTop = log.scrollHeight; paintBar(); }) : null;
  ro?.observe(log);
  // 모바일: OS 키보드가 아래를 덮으면 입력줄을 키보드 바로 위에 띄운다(visualViewport)
  const vv = globalThis.visualViewport;
  const kb = () => {
    const ov = vv && document.activeElement === p.tx ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
    el.classList.toggle('kb', ov > 40);
    el.style.setProperty('--kb', ov + 'px');
  };
  p.tx.addEventListener('focus', () => { vv?.addEventListener('resize', kb); vv?.addEventListener('scroll', kb); kb(); });
  p.tx.addEventListener('blur', () => { vv?.removeEventListener('resize', kb); vv?.removeEventListener('scroll', kb); kb(); });
  store.subs.add(render); modeSubs.add(paintMode);
  paintMode(); render();
  panel = {
    code: store.code, el,
    /** .cmds 바로 앞에 둔다. 이미 화면에 있으면 상태를 지키며 옮긴다(moveBefore), 없으면 끼우고 글자 선택·스크롤·포커스를 되살린다 */
    mount(before) {
      const parent = before.parentNode;
      const focused = document.activeElement === p.tx;
      saved = { focused, s: p.tx.selectionStart, e: p.tx.selectionEnd, top: log.scrollTop };
      if (el.isConnected && parent.isConnected && typeof parent.moveBefore === 'function') {
        try { parent.moveBefore(el, before); } catch { parent.insertBefore(el, before); }
      } else parent.insertBefore(el, before);
      if (stick) log.scrollTop = log.scrollHeight; else log.scrollTop = saved.top;
      if (saved.focused && document.activeElement !== p.tx) { p.tx.focus({ preventScroll: true }); try { p.tx.setSelectionRange(saved.s, saved.e); } catch { /* 무시 */ } }
      render();
    },
    /** 입력칸에 포커스가 있었나(대기실 재그리기 직전에 묻는다) */
    typing: () => document.activeElement === p.tx,
    drop() { ro?.disconnect(); store.subs.delete(render); modeSubs.delete(paintMode); el.remove(); },
  };
  return panel;
}

// ---------------- 경기 중: 받은 줄(최근 5줄, 8초 뒤 3단계 흐림) + PC 입력창(Enter) ----------------
/**
 * @param {{app, wrap:HTMLElement, stage:HTMLElement, help:HTMLElement, guide:HTMLElement, input:{down:Set, update:Function}, pad:()=>any}} o
 * 터치(가상 패드)면 받은 줄만. 위치는 캔버스(.stage)·--k·패드·하단 줄 사각형으로 계산(wrap 기준 좌표)
 */
export function gameChat({ app, wrap, stage, help, guide, input, pad }) {
  const layer = h('div.cm-game');
  const log = h('div.cm-log.cm-ol', { 'aria-live': 'polite' });
  let open = false, fadeT = 0;
  const close = () => {
    if (!open) return;
    open = false; box.hidden = true;
    if (document.activeElement === p.tx) p.tx.blur();
    input.update();
    render();
  };
  const p = inputParts(app, { cls: 'game', onEnter: () => { const v = p.tx.value; if (send(app, v)) { p.tx.value = ''; p.sync(); } close(); }, onEsc: () => { p.tx.value = ''; p.sync(); close(); } }); // Esc = 취소(쓰던 글 버림)
  const box = h('div.cm-in', { hidden: true }, p.tg, p.to, p.tx, p.cnt);
  p.tx.addEventListener('blur', () => { setTimeout(() => { if (open && document.activeElement !== p.tx) close(); }, 0); });
  layer.append(log, box);
  wrap.append(layer);
  const paintMode = () => { box.classList.toggle('notice', p.sync()); };

  function render() {
    clearTimeout(fadeT);
    const now = performance.now();
    const ls = store.lines.filter((l) => !l.notice);
    const shown = open ? ls.slice(-GAME_LINES) : ls.slice(-IDLE_LINES).filter((l) => now - l.at < HOLD_MS + FADE_MS);
    log.classList.toggle('open', open);
    log.replaceChildren(...shown.map((l) => {
      const e = lineEl(app, l, '.cm-line');
      if (!open) e.style.animationDelay = Math.round(HOLD_MS - (now - l.at)) + 'ms';
      return e;
    }));
    if (!open && shown.length) fadeT = setTimeout(render, Math.max(50, HOLD_MS + FADE_MS - (now - shown[0].at) + 20)); // 다 흐려진 줄은 빼낸다
    place();
  }
  function place() {
    if (!layer.isConnected) return;
    const W0 = wrap.getBoundingClientRect(), st = stage.getBoundingClientRect();
    const k = parseFloat(stage.style.getPropertyValue('--k')) || 1;
    const touch = !!pad(), land = wrap.classList.contains('land');
    layer.classList.toggle('t-land', touch && land); layer.classList.toggle('t-port', touch && !land);
    if (touch && open) close();
    const ls = log.style; ls.left = ls.top = ls.bottom = ls.maxWidth = '';
    if (!touch) {
      const left = st.left + 4 * k - W0.left, maxW = Math.min(140 * k, W0.width * 0.4);
      let bottom = st.bottom - 4 * k;
      // 조작 안내가 캔버스 왼쪽 아래에 펼쳐져 있으면 그 위로
      if (!guide.hidden && !guide.classList.contains('side') && guide.isConnected) bottom = Math.min(bottom, guide.getBoundingClientRect().top - 4 * k);
      const bH = W0.bottom - bottom;
      Object.assign(ls, { left: left + 'px', maxWidth: maxW + 'px' });
      if (open) {
        const ih = box.offsetHeight || 36;
        Object.assign(box.style, { left: left + 'px', width: maxW + 'px', bottom: bH + 'px' });
        ls.bottom = bH + ih + 8 + 'px';
      } else ls.bottom = bH + 'px';
    } else if (land) {
      const d = wrap.querySelector('.tp-dir')?.getBoundingClientRect(), b = wrap.querySelector('.tp-btns')?.getBoundingClientRect(), hp = help.getBoundingClientRect();
      if (!d || !b) return;
      Object.assign(ls, { left: d.right + 8 - W0.left + 'px', maxWidth: Math.max(0, Math.min(b.left - d.right - 16, W0.width * 0.4)) + 'px', bottom: W0.bottom - (hp.top - 6) + 'px' });
    } else {
      const hp = help.getBoundingClientRect();
      Object.assign(ls, { left: '12px', maxWidth: Math.min(W0.width - 24, W0.width * 0.4) + 'px', top: hp.bottom + 12 - W0.top + 'px' });
    }
  }
  function openInput() {
    if (open || pad()) return;
    open = true;
    input.down.clear(); input.update(); // 눌려 있던 방향·버튼 비트를 비운다(선수가 계속 달리지 않게)
    box.hidden = false; paintMode(); render();
    p.tx.focus({ preventScroll: true });
  }
  const onKey = (e) => {
    if (e.key !== 'Enter' || open || e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey || pad()) return;
    const a = document.activeElement;
    if (a && a !== document.body && a.closest('button, input, textarea, select, a, [contenteditable]')) return; // 버튼(결과 카드 등)의 Enter 는 그대로
    e.preventDefault(); openInput();
  };
  addEventListener('keydown', onKey);
  store.subs.add(render); modeSubs.add(paintMode);
  paintMode(); render();
  return {
    place, isOpen: () => open,
    destroy() { clearTimeout(fadeT); removeEventListener('keydown', onKey); store.subs.delete(render); modeSubs.delete(paintMode); if (open) { open = false; input.update(); } layer.remove(); },
  };
}
