// WebSocket 어댑터 (docs/PROTOCOL.md v1). 메시지 = { t:'종류', ... }
// 세션 토큰은 localStorage 에 저장해 새로고침·재접속 시 같은 좌석으로 복귀한다.
import { Emitter } from './util.js';

const TOKEN_KEY = 'dd.token';

export class Net extends Emitter {
  constructor() {
    super();
    this.url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.ws = null; this.open = false; this.offset = 0; this.backoff = 500; this.seq = 0;
    this.closing = false;
    this.token = localStorage.getItem(TOKEN_KEY);
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

  _recv(m) {
    if (!m || typeof m.t !== 'string') return;
    if (typeof m.serverTime === 'number') this.offset = m.serverTime - Date.now();
    if (m.t === 'welcome') { this.tokenHello = false; this.token = m.token; localStorage.setItem(TOKEN_KEY, m.token); }
    if (m.t === 'error' && m.code === 'TOKEN_INVALID') { this.tokenHello = false; this.forgetToken(); }
    if (m.t === 'error' && m.code === 'SESSION_REPLACED') this.closing = true;
    this.emit(m.t, m);
  }

  send(t, data = {}) {
    if (!this.ws || this.ws.readyState !== 1) return 0;
    const msg = t === 'input' ? { t, ...data } : { t, ...data, ref: ++this.seq };
    this.ws.send(JSON.stringify(msg));
    return msg.ref ?? 1;
  }

  forgetToken() { this.token = null; localStorage.removeItem(TOKEN_KEY); }
  now() { return Date.now() + this.offset; }
}

export const net = new Net();
