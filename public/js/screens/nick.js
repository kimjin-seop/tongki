// 접속 화면: 손님(닉네임만, 종전 흐름) / 로그인 / 가입(PROTOCOL §2.1). 규칙 위반·중복·잠금 등은 전부 토스트(인라인 오류 없음).
// 서버가 계정 필수(REQUIRE_ACCOUNT=1)면 손님 칸을 숨긴다: welcome.requireAccount 또는 손님 hello 의 ACCOUNT_REQUIRED 로 알고 이 브라우저에 기억한다.
// data.upgrade = 로비의 '가입'(손님 세션을 지금 닉네임 그대로 계정으로 올림 → account_ok).
// 비밀번호는 서버로만 보낸다(콘솔·URL·저장소에 남기지 않는다).
import { h } from '../util.js';
import { toast } from '../ui.js';
import { net } from '../net.js';
import { ERR, AUTH } from '../i18n.js';
import { titleLogo } from '../intro.js';
import { arrowNav } from '../pix.js';

const NICK_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]{2,10}$/;
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 무시 */ } };
/** 이 브라우저가 기억하는 서버 정책·마지막 접속 방식 */
export const remember = (welcome) => { set('dd.reqAcct', welcome.requireAccount ? '1' : '0'); set('dd.acct', welcome.account ? '1' : '0'); };

export function mount(root, app, data = {}) {
  const upgrade = !!data.upgrade && !!app.nick;
  let reqAcct = get('dd.reqAcct') === '1';
  let mode = upgrade ? 'register' : data.mode ?? (reqAcct || get('dd.acct') === '1' ? 'login' : 'guest');
  if (reqAcct && mode === 'guest') mode = 'login';

  const nick = h('input', { id: 'nick', type: 'text', maxLength: 10, spellcheck: false, placeholder: '2~10자', autocapitalize: 'off' });
  const pw = h('input', { id: 'pw', type: 'password', maxLength: 64 });
  const pw2 = h('input', { id: 'pw2', type: 'password', maxLength: 64, 'aria-label': '비밀번호 확인' });
  const btn = h('button.btn.primary', { type: 'submit' });
  const tabs = h('div.auth-tabs', { role: 'group', 'aria-label': '접속 방식' });
  const pwRow = [h('label.field-label', { for: 'pw' }, '비밀번호'), pw];
  const pw2Row = [h('label.field-label', { for: 'pw2' }, '비밀번호 확인'), pw2];
  const back = upgrade ? h('button.btn.auth-back', { type: 'button', onclick: () => app.go('lobby') }, '돌아가기') : null;
  const logo = upgrade ? null : titleLogo('h1'); // 타이틀 로고(인트로가 끝나면 이 자리로 이동). 없으면 글자 제목
  const form = h('form.pwin.nick-card.title-follow', { onsubmit: (e) => { e.preventDefault(); go(); } },
    logo || upgrade ? null : h('h1.title', '피구왕 통키'), upgrade ? h('h1.title', '가입') : tabs,
    h('label.field-label', { for: 'nick' }, '닉네임'), nick, pwRow, pw2Row, btn, back);
  root.append(h('div.center-screen', h('div.title-stack', logo, form)));
  nick.value = upgrade ? app.nick : data.nick ?? get('dd.nick') ?? '';
  if (upgrade) nick.readOnly = true;

  function paint() {
    tabs.replaceChildren(...[['guest', '손님'], ['login', '로그인'], ['register', '가입']].filter(([m]) => !(reqAcct && m === 'guest'))
      .map(([m, label]) => h('button.btn.small', { type: 'button', 'aria-pressed': String(mode === m), 'data-mode': m, onclick: () => { mode = m; paint(); focus(); } }, label)));
    const acct = mode !== 'guest';
    for (const el of pwRow) el.hidden = !acct;
    for (const el of pw2Row) el.hidden = mode !== 'register';
    nick.autocomplete = acct ? 'username' : 'off';
    pw.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    pw2.autocomplete = 'new-password';
    pw.placeholder = mode === 'register' ? '6자 이상' : '';
    btn.textContent = mode === 'guest' ? '입장' : mode === 'login' ? '로그인' : '가입';
  }
  const focus = () => setTimeout(() => { (upgrade || (mode !== 'guest' && nick.value) ? pw : nick).focus(); }, 30);
  paint(); focus();
  const offNav = arrowNav(form);

  async function go() {
    const v = nick.value.trim();
    if (!NICK_RE.test(v)) { toast(ERR.NICK_INVALID, 'error'); nick.focus(); return; }
    if (mode !== 'guest') {
      if (!pw.value) { toast(AUTH.PW_EMPTY, 'error'); pw.focus(); return; }
      if (mode === 'register' && pw.value !== pw2.value) { toast(AUTH.PW_MISMATCH, 'error'); pw2.value = ''; pw2.focus(); return; }
    }
    btn.disabled = true;
    if (!net.open && !(await net.reopen())) { btn.disabled = false; toast(ERR.DISCONNECTED, 'error'); return; }
    if (!upgrade) set('dd.nick', v);
    if (mode === 'guest') net.send('hello', { nickname: v });
    else net.send(mode, { nickname: v, password: pw.value });
  }
  return {
    upgrade,
    onError(m) {
      btn.disabled = false;
      if (m?.code === 'ACCOUNT_REQUIRED') { reqAcct = true; set('dd.reqAcct', '1'); mode = 'login'; paint(); focus(); return; }
      // 가입은 됐지만 그 사이 세션이 바뀌어 토큰이 없다(드문 경합): 같은 닉네임으로 로그인 탭(가입 화면이었으면 일반 접속 화면으로)
      if (m?.code === 'ACCOUNT_CREATED_RELOGIN') { if (upgrade) { app.go('nick', { mode: 'login', nick: nick.value }); return; } mode = 'login'; pw.value = ''; pw2.value = ''; paint(); focus(); return; }
      if (m?.code === 'NICK_REGISTERED' && !upgrade) { mode = 'login'; paint(); focus(); return; } // 가입된 닉네임: 로그인으로
      if (mode !== 'guest' && ['LOGIN_FAILED', 'PASSWORD_INVALID'].includes(m?.code)) { pw.value = ''; pw2.value = ''; pw.focus(); return; }
      nick.focus(); if (!upgrade) nick.select();
    },
    onAccountOk() { toast(AUTH.SIGNED_UP, 'ok'); app.go('lobby'); },
    unmount() { offNav(); pw.value = ''; pw2.value = ''; },
  };
}
