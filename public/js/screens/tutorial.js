// 튜토리얼: 종전 로비의 특훈 2종(PROTOCOL §9 training_start)을 단계 순서로 고르는 화면. 서버·프로토콜은 그대로다.
// 1 = 공 받기(kind 'catch'), 2 = 필살기(kind 'special'). 강제 진행은 없다(어느 쪽이든 바로 시작).
// 끝나면(완료·그만두기·상한) main.js room_left / game.js 완료 카드가 이 화면으로 돌려보낸다.
import { h } from '../util.js';
import { net } from '../net.js';
import { arrowNav } from '../pix.js';

const STEPS = [['catch', '공 받기'], ['special', '필살기']];

export function mount(root, app) {
  const back = () => app.go('lobby');
  const start = (kind) => {
    net.send('training_start', { kind }); // 서버가 닫아 둔 종류는 TRAINING_UNAVAILABLE 토스트
  };
  const btns = STEPS.map(([kind, label], i) => h('button.ritem.tut-step', { type: 'button', 'data-kind': kind, onclick: () => start(kind) },
    h('b.tut-no', String(i + 1)), h('span', label)));
  root.append(h('div.screen.rules',
    h('section.pwin.rules-win', { 'aria-label': '튜토리얼' },
      h('header.rules-head', h('h1.pix-title', '튜토리얼'), h('button.btn.small.back', { type: 'button', onclick: back }, '돌아가기')),
      h('div.tut-steps', btns))));
  const offNav = arrowNav(root, { onEsc: back });
  setTimeout(() => { if (btns[0].isConnected) btns[0].focus({ preventScroll: true }); }, 30);
  return { unmount: () => offNav() };
}
