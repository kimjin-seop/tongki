// 닉네임 입력. 규칙 위반·중복은 서버 거절 → 토스트
import { h } from '../util.js';
import { toast } from '../ui.js';
import { net } from '../net.js';
import { ERR } from '../i18n.js';
import { titleLogo } from '../intro.js';
import { arrowNav } from '../pix.js';

const NICK_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]{2,10}$/;

export function mount(root) {
  const input = h('input', { id: 'nick', type: 'text', maxLength: 10, autocomplete: 'off', spellcheck: false, placeholder: '2~10자' });
  const btn = h('button.btn.primary', { type: 'submit' }, '입장');
  const logo = titleLogo('h1'); // 타이틀 로고(인트로가 끝나면 이 자리로 이동). 없으면 글자 제목
  const form = h('form.pwin.nick-card.title-follow', { onsubmit: (e) => { e.preventDefault(); go(); } },
    logo ? null : h('h1.title', '피구왕 통키'),
    h('label.field-label', { for: 'nick' }, '닉네임'), input, btn);
  root.append(h('div.center-screen', h('div.title-stack', logo, form)));
  input.value = localStorage.getItem('dd.nick') || '';
  setTimeout(() => input.focus(), 30);
  const offNav = arrowNav(form);
  function go() {
    const v = input.value.trim();
    if (!NICK_RE.test(v)) { toast(ERR.NICK_INVALID, 'error'); input.focus(); return; }
    if (!net.open) { toast(ERR.DISCONNECTED, 'error'); return; }
    localStorage.setItem('dd.nick', v);
    btn.disabled = true;
    net.send('hello', { nickname: v });
  }
  return { onError: () => { btn.disabled = false; input.focus(); input.select(); }, unmount: offNav };
}
