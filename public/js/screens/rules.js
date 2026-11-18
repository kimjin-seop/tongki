// 규칙 창: 원작 경기 전 화면 `ルール`(ノックアウト/こうしき) + `しあいじかん`(むせいげん/3/5/8分) + EXIT (analysis/28 §2-1, §10).
// 값만 고르고 돌려준다. 방에서는 방장이 set_rules 로, 스토리에서는 campaign_start 의 rules 로 서버에 보낸다(판정은 서버).
// 사용: app.go('rules', { rules: {mode, time}, modes?: false(시간만), onDone(rules), onCancel() })
import { h } from '../util.js';
import { arrowNav } from '../pix.js';

export const RULE_TIMES = [0, 3, 5, 8]; // 분, 0 = 무제한 (서버 server/engine/consts.js 와 같은 값)
const MODES = [['knockout', '녹아웃'], ['official', '공식']];
/** こうしき(공식) 규칙: 서버 엔진 이식 완료(analysis/29 §3, §4-1-1). false 로 되돌리면 원작의 '고를 수 없는 값'처럼 회색으로만 보인다(서버 OFFICIAL_ENABLED 와 함께 바꿀 것) */
const OFFICIAL_READY = true;

export const timeLabel = (t) => (t ? `${t}분` : '무제한');
export const rulesText = (r) => `${MODES.find((m) => m[0] === r?.mode)?.[1] ?? MODES[0][1]} · ${timeLabel(r?.time ?? 5)}`;

export function mount(root, app, data = {}) {
  const cur = { mode: data.rules?.mode === 'official' && OFFICIAL_READY ? 'official' : 'knockout', time: RULE_TIMES.includes(data.rules?.time) ? data.rules.time : 5 };
  const done = () => (data.onDone ?? (() => app.go(app.room ? 'room' : 'lobby')))({ ...cur });
  const cancel = () => (data.onCancel ?? (() => app.go(app.room ? 'room' : 'lobby')))();

  const modeBtns = MODES.map(([id, label]) => h('button.btn', { type: 'button', 'data-mode': id, onclick: () => { cur.mode = id; sync(); } }, label));
  const timeBtns = RULE_TIMES.map((t) => h('button.btn', { type: 'button', 'data-time': t, onclick: () => { cur.time = t; sync(); } }, timeLabel(t)));
  const ok = h('button.btn.primary.ok', { type: 'button', onclick: done }, '결정');

  /** 원작: こうしき 를 고르면 むせいげん 을 쓸 수 없고 시간이 3분으로 바뀐다 */
  function sync() {
    if (cur.mode === 'official' && cur.time === 0) cur.time = 3;
    for (const b of modeBtns) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === cur.mode));
      b.disabled = b.dataset.mode === 'official' && !OFFICIAL_READY;
    }
    for (const b of timeBtns) {
      b.setAttribute('aria-pressed', String(+b.dataset.time === cur.time));
      b.disabled = cur.mode === 'official' && +b.dataset.time === 0;
    }
  }
  sync();

  root.append(h('div.screen.rules',
    h('section.pwin.rules-win', { 'aria-label': '규칙' },
      h('header.rules-head', h('h1.pix-title', '규칙'), h('button.btn.small.back', { type: 'button', onclick: cancel }, '돌아가기')),
      data.modes === false ? null : h('div.rules-row', { role: 'group', 'aria-label': '규칙' }, h('span.rules-lbl', '규칙'), h('div.rules-opts', modeBtns)),
      h('div.rules-row', { role: 'group', 'aria-label': '경기 시간' }, h('span.rules-lbl', '경기 시간'), h('div.rules-opts', timeBtns)),
      ok)));
  const offNav = arrowNav(root, { onEsc: cancel });
  setTimeout(() => { if (ok.isConnected) ok.focus({ preventScroll: true }); }, 30);
  return { onError: cancel, unmount: () => offNav() };
}
