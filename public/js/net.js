// WebSocket 어댑터 (docs/PROTOCOL.md v1). 메시지 = { t:'종류', ... }
// 세션 토큰은 localStorage 에 저장해 새로고침·재접속 시 같은 좌석으로 복귀한다.
// 계정 세션(§2.1)이면 같은 칸의 값이 로그인 토큰이다(유예 만료·새로고침 뒤 hello{token} 으로 비밀번호 없이 로그인). 저장소를 못 써도 동작한다(메모리만).
import { Emitter } from './util.js';

const TOKEN_KEY = 'dd.token';
const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 저장 불가: 메모리만 */ } };

export class Net extends Emitter {
  constructor() {
    super();
    this.url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.ws = null; this.open = false; this.offset = 0; this.backoff = 500; this.seq = 0;
    this.closing = false;
    this.token = load(TOKEN_KEY);
  }

  connect() {
    return new Promise((res) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.open = true; this.backoff = 500;
        this.emit('open');
        if (this.token) { this.tokenHello = true; this.send('hello', { token: this.token }); }
        res();
      };
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } this._recv(m); };
      ws.onclose = () => {
        const was = this.open; this.open = false;
        this.emit('close', { was });
        res();
        if (this.closing) return;
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(8000, this.backoff * 2);
      };
      ws.onerror = () => {};
    });
  }

  /** SESSION_REPLACED 등으로 자동 재연결을 멈춘 뒤 다시 연결(로그인 화면에서 입장할 때). 이미 열려 있으면 그대로 */
  async reopen() {
    if (this.open) return true;
    if (!this.closing) return false; // 자동 재연결이 돌고 있다
    this.closing = false;
    await this.connect();
    return this.open;
  }

  _recv(m) {
    if (!m || typeof m.t !== 'string') return;
    if (typeof m.serverTime === 'number') this.offset = m.serverTime - Date.now();
    if (m.t === 'welcome') { this.tokenHello = false; this.setToken(m.token); }
    if (m.t === 'account_ok') this.setToken(m.token); // 손님 → 계정 승격: 저장 토큰을 로그인 토큰으로 바꾼다
    if (m.t === 'logged_out') this.forgetToken();
    if (m.t === 'error' && m.code === 'TOKEN_INVALID') { this.tokenHello = false; this.forgetToken(); }
    // 다른 곳에서 이 세션을 가져갔다: 자동 재연결 중지(되찾기 반복 방지). 저장 토큰은 같은 브라우저 다른 탭이 쓰고 있을 수 있어 메모리에서만 지운다
    if (m.t === 'error' && m.code === 'SESSION_REPLACED') { this.closing = true; this.token = null; }
    this.emit(m.t, m);
  }

  send(t, data = {}) {
    if (!this.ws || this.ws.readyState !== 1) return 0;
    const msg = t === 'input' ? { t, ...data } : { t, ...data, ref: ++this.seq };
    this.ws.send(JSON.stringify(msg));
    return msg.ref ?? 1;
  }

  setToken(t) { if (typeof t !== 'string' || !t) return; this.token = t; save(TOKEN_KEY, t); }
  forgetToken() { this.token = null; save(TOKEN_KEY, null); }
  now() { return Date.now() + this.offset; }
}

export const net = new Net();
