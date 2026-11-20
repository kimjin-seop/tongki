// 서버 공지(서버 → {t:'notice', id, text, at}). 시안 _asset_samples/tongki_chat_mock D2~D8.
// #notice = #app 밖 고정 레이어(누름 통과, 화면 전환에도 유지). 경기 화면 = HUD 아래 띠(논리 y44~, 최대 2줄 말줄임, 세로 모바일은 검정 여백 가운데),
// 그 밖 = 중앙 상단 배너(100자 줄바꿈, 떠 있는 동안 토스트는 배너 아래로 --toast-top). 글자는 textContent 로만
import { h } from './util.js';

const GAME_MS = 8000, SCREEN_MS = 10000, QMAX = 3; // 표시 시간 = 시안값(경기 띠 8초 · 비경기 배너 10초), 대기 최대 3개(넘치면 오래된 대기분 폐기)
const seen = new Set();
const queue = [];
let cur = null, timer = 0, host = null, raf = 0;
const inGame = () => document.body.dataset.view === 'game';

/** 새 공지면 true(같은 id 는 무시) */
export function show(m) {
  const text = typeof m?.text === 'string' ? m.text.trim() : '';
  if (!text) return false;
  const id = m.id ?? null;
  if (id != null) {
    // 서버 재시작 뒤 id 가 1부터 다시 시작하므로 at(보낸 시각)과 묶어 같은 공지의 중복 수신만 무시한다
    const key = `${id}|${m.at ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 200) seen.delete(seen.values().next().value);
  }
  queue.push({ id, text });
  while (queue.length > QMAX) queue.shift();
  if (!cur) next();
  return true;
}

function next() {
  clearTimeout(timer);
  cur = queue.shift() ?? null;
  paint();
  if (cur) timer = setTimeout(next, inGame() ? GAME_MS : SCREEN_MS);
}

function paint() {
  host ??= document.getElementById('notice');
  if (!host) return;
  host.replaceChildren();
  document.documentElement.style.removeProperty('--toast-top');
  if (!cur) return;
  if (inGame()) {
    const t = h('span.t', cur.text);
    const nb = h('div.cm-nb.cm-ol', { role: 'status' }, h('span.lb', '공지'), t);
    host.append(nb);
    placeBand(nb);
  } else {
    const nb = h('div.cm-nbx', { role: 'status' }, h('span.lb', '공지'), h('span.t', cur.text));
    host.append(nb);
    document.documentElement.style.setProperty('--toast-top', Math.round(nb.getBoundingClientRect().bottom + 10) + 'px');
  }
}

function placeBand(nb) {
  const stEl = document.querySelector('.game .stage');
  if (!stEl) return;
  const st = stEl.getBoundingClientRect(), k = parseFloat(stEl.style.getPropertyValue('--k')) || 1;
  const g = stEl.closest('.game'), touch = g.classList.contains('touch'), land = g.classList.contains('land');
  const dir = g.querySelector('.tp-dir')?.getBoundingClientRect(), help = g.querySelector('.help')?.getBoundingClientRect();
  if (touch && !land && dir && help) { // 세로 모바일: 캔버스가 작아 설정·기권 아래 ~ 패드 위 검정 여백 가운데에 크게
    nb.classList.add('gap');
    Object.assign(nb.style, { left: '0px', width: innerWidth + 'px' });
    nb.style.top = Math.round((help.bottom + dir.top) / 2 - nb.offsetHeight / 2) + 'px';
    return;
  }
  Object.assign(nb.style, { left: st.left + 'px', width: st.width + 'px', top: Math.round(st.top + 44 * k) + 'px' });
}

// 화면이 바뀌면(경기 ↔ 비경기) 같은 공지를 그 화면 모양으로 다시 그린다. 창 크기가 바뀌면 다시 맞춘다(경기 화면 fit 뒤)
const repaint = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (cur) paint(); }); };
new MutationObserver(repaint).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
addEventListener('resize', repaint);
