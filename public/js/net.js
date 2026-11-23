// WebSocket 어댑터 (docs/PROTOCOL.md v2). 메시지 = { t:'종류', ... }
// 세션 토큰은 localStorage 에 저장해 새로고침·재접속 시 같은 좌석으로 복귀한다.
// 계정 세션(§2.1)이면 같은 칸의 값이 로그인 토큰이다(유예 만료·새로고침 뒤 hello{token} 으로 비밀번호 없이 로그인). 저장소를 못 써도 동작한다(메모리만).
import { Emitter } from './util.js';
import { SnapDecoder } from './game/snapcodec.js';

export const PROTOCOL = 2; // server/net/protocol.js PROTOCOL 와 같아야 한다. 접속 주소 /ws?v=2 로 서버가 확인한다(다르면 PROTOCOL_MISMATCH)

const TOKEN_KEY = 'dd.token';
const KICK_WAIT_MS = 5000; // kick 으로 바꾼 새 소켓이 welcome 을 줄 때까지 기다리는 시간
const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 저장 불가: 메모리만 */ } };

export class Net extends Emitter {
  constructor() {
    super();
    this.url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?v=${PROTOCOL}`;
    this.ws = null; this.open = false; this.offset = 0; this.backoff = 500; this.seq = 0;
    this.closing = false;
    this.token = load(TOKEN_KEY);
    this.lastRecv = 0; // 마지막 수신 시각(performance.now). 경기 화면이 응답 없는 소켓을 가려내는 데 쓴다(kick)
    this.retryTimer = 0; this.retryHold = false; // 대기 중인 재연결 타이머 / 서버 거절로 길게 늦춘 재연결(바로 다시 붙지 않는다)
  }

  connect() {
    clearTimeout(this.retryTimer); this.retryTimer = 0;
    this.hook();
    return new Promise((res) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.binaryType = 'arraybuffer'; // 스냅샷은 바이너리(snapcodec.js). 그 밖의 메시지는 JSON 문자열
      const dec = new SnapDecoder(); // 연결마다 하나(델타는 이 연결의 직전 스냅샷 기준)
      ws.onopen = () => {
        this.open = true; // 재연결 간격은 welcome 을 받아야 초기화한다(열리자마자 거절되는 연결의 0.5초 반복 방지)
        this.emit('open');
        if (this.token) { this.tokenHello = true; this.send('hello', { token: this.token }); }
        res();
      };
      ws.onmessage = (ev) => {
        this.lastRecv = performance.now();
        let m;
        try { m = typeof ev.data === 'string' ? JSON.parse(ev.data) : dec.decode(new Uint8Array(ev.data)); } catch { return; }
        if (m) this._recv(m); // null = 기준이 어긋난 델타(다음 키프레임까지 버린다)
      };
      ws.onclose = (ev) => {
        if (this.ws !== ws) return; // kick 으로 바꿔 낀 옛 소켓
        const was = this.open; this.open = false;
        // 서버 거절(close 1008: 차단 RATE_LIMITED·TOO_MANY_CONNECTIONS·Origin 불일치. LOGIN_TIMEOUT 은 제외): 재연결을 1분 이상, 지수로 최대 15분까지 늦추고 1회 알림
        const rejected = ev?.code === 1008 && ev.reason !== 'LOGIN_TIMEOUT';
        this.emit('close', { was, rejected });
        res();
        if (this.closing) return;
        if (rejected) {
          this.backoff = Math.max(60000, this.backoff);
          if (!this.rejectNoticed) { this.rejectNoticed = true; this.emit('rejected', { reason: ev.reason }); }
        }
        this.retryHold = rejected;
        this.retryTimer = setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(rejected ? 15 * 60000 : Math.max(8000, this.backoff), this.backoff * 2);
      };
      ws.onerror = () => {};
    });
  }

  /** 화면 복귀(모바일 백그라운드·잠금 해제)·네트워크 복구 때: 대기 중인 재연결을 기다리지 않고 바로 붙는다. 앱 수명 동안 1회 등록 */
  hook() {
    if (this.hooked || typeof addEventListener !== 'function' || typeof document === 'undefined') return;
    this.hooked = true;
    const again = () => { this.lastRecv = performance.now(); if (!document.hidden) this.retryNow(); };
    addEventListener('online', again); addEventListener('pageshow', again);
    document.addEventListener('visibilitychange', again);
  }

  /** 재연결 대기 중이면 지금 바로 다시 연결(서버 거절로 늦춘 경우·재연결을 멈춘 경우는 그대로 둔다) */
  retryNow() {
    if (this.closing || this.open || !this.retryTimer || this.retryHold) return;
    this.connect();
  }

  /**
   * 응답 없는 소켓 교체: 모바일 망 전환(와이파이 ↔ 이동통신) 등으로 연결이 죽었는데 close 가 오지 않을 때 경기 화면이 부른다.
   * 옛 소켓은 먼저 닫지 않는다 — 새 연결의 hello{token} 이 서버에서 세션을 넘겨받으므로(옛 연결은 서버가 닫는다) 살아 있던 연결이어도 끊김 횟수·일시정지가 생기지 않는다
   */
  kick(again = false) {
    const old = this.ws;
    if (!old || this.closing || !this.token) return false;
    old.onopen = old.onmessage = old.onclose = old.onerror = null;
    this.open = false; this.lastRecv = performance.now();
    this.emit('close', { was: !again, rejected: false }); // 되풀이(again)는 끊김 알림을 다시 띄우지 않는다
    this.connect();
    // 새 소켓도 응답이 없으면(KICK_WAIT_MS 안에 welcome 없음) 그것도 바꾼다. 연결 자체가 실패하면 onclose 의 재연결 대기가 맡는다
    const ws = this.ws;
    this.kickWait = ws;
    setTimeout(() => { if (this.ws === ws && this.kickWait === ws) this.kick(true); }, KICK_WAIT_MS);
    setTimeout(() => { try { old.close(); } catch { /* 이미 닫힘 */ } }, 10000);
    return true;
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
    if (m.t === 'welcome') { this.kickWait = null; this.tokenHello = false; this.setToken(m.token); this.backoff = 500; this.rejectNoticed = false; }
    if (m.t === 'account_ok') this.setToken(m.token); // 손님 → 계정 승격: 저장 토큰을 로그인 토큰으로 바꾼다
    if (m.t === 'logged_out') this.forgetToken();
    if (m.t === 'error' && m.code === 'TOKEN_INVALID') { this.tokenHello = false; this.forgetToken(); }
    // 다른 곳에서 이 세션을 가져갔다: 자동 재연결 중지(되찾기 반복 방지). 저장 토큰은 같은 브라우저 다른 탭이 쓰고 있을 수 있어 메모리에서만 지운다
    if (m.t === 'error' && m.code === 'SESSION_REPLACED') { this.closing = true; this.token = null; }
    if (m.t === 'error' && m.code === 'PROTOCOL_MISMATCH') this.closing = true; // 서버와 화면 판이 다르다: 재연결을 멈추고 안내(새로고침)만
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
