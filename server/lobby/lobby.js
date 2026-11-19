// 세션·로비·방 관리 (단일 프로세스, 방 단위 try/catch 격리)
import { randomBytes, randomInt } from 'node:crypto';
import { RoomGame } from '../game/roomGame.js';
import { MemoryProgressStore } from '../store/progress.js';
import { MemoryLeagueStore } from '../store/league.js';
import { makeLeagueHandlers, leagueEnd } from '../league/handlers.js';
import { MemoryFlameStore } from '../store/flame.js';
import { makeFlameHandlers, flameEnd, initFlameCatalog } from '../flame/handlers.js';
import { FlameRanking } from '../flame/ranking.js';
import { mono, loadLimits } from '../net/limits.js';
import { openDb } from '../store/db.js';
import { AccountStore, LoginGuard, passwordOk } from '../store/accounts.js';
import { RankingStore } from '../store/ranking.js';
import { RANK, RANK_NORMAL, RANK_FORFEIT } from '../ranking/elo.js';
import { ERR, PROTOCOL, GRACE_MS, NICK_RE, CODE_RE, CODE_CHARS, isInt, normRules, TRAINING_KINDS, TRAINING_READY } from '../net/protocol.js';
import { RULE_TIMES } from '../engine/consts.js';

const RECENT_CODES = 64;
const CPU_NICK = '컴퓨터';

class LobbyError extends Error {
  constructor(code, params) { super(code); this.code = code; this.params = params; }
}
const fail = (code, params) => { throw new LobbyError(code, params); };
/** 닉네임 입력 정리(hello·register·login 공통): NFC 정규화 후 앞뒤 공백 제거. 조합형(NFD) 한글도 완성형과 같은 닉네임이 된다 */
const cleanNick = (v) => (typeof v === 'string' ? v.normalize('NFC').trim() : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Lobby {
  /** @param {{data:any, store:any, build:string, graceMs?:number, limits?:object, seed?:number, log?:Function}} o */
  constructor(o) {
    this.o = o;
    this.progress = o.progress ?? new MemoryProgressStore();
    this.leagues = o.leagues ?? new MemoryLeagueStore(); // 리그 저장소(get/set/flush, PROTOCOL §10)
    const db = (!o.accounts || !o.ranking) ? (o.db ?? openDb(':memory:')) : null; // 계정·랭킹 저장(PROTOCOL §2.1·§11). 없으면 메모리 DB
    this.accounts = o.accounts ?? new AccountStore(db);
    this.ranking = o.ranking ?? new RankingStore(db);
    this.requireAccount = !!o.requireAccount; // REQUIRE_ACCOUNT=1: 닉네임만으로 hello 불가(계정 필수)
    this.graceMs = o.graceMs ?? GRACE_MS;
    this.limits = o.limits ?? loadLimits();
    this.helloWin = new Map(); // ip -> {start,count}
    this.authWin = new Map(); // ip -> {start,count} (register/login)
    this.loginGuard = o.loginGuard ?? new LoginGuard({ failNick: this.limits.loginFailNick, failIp: this.limits.loginFailIp, lockMs: this.limits.loginLockMs, slowStepMs: this.limits.loginSlowStepMs, slowMaxMs: this.limits.loginSlowMaxMs });
    this.log = o.log ?? ((...a) => console.error(...a));
    this.flame = o.flame ?? new MemoryFlameStore(); // 불꽃의 계승 저장소(getProfile/getRun/save, PROTOCOL §13)
    this.flameCat = initFlameCatalog(o.data, this.log); // 데이터 카탈로그(깨져 있으면 null = flame 요청만 거절, 기존 모드는 그대로)
    // 도달 순위표(PROTOCOL §13.13): 시작 때 영구 저장 전 행에서 메모리 표를 만든다. 계정만 오른다(accounts 표로 판정)
    this.flameRank = new FlameRanking({ store: this.flame, isAccount: (k) => this.accounts.has(k), top: this.flameCat?.endless?.rankTop, segments: this.flameCat?.rules.run.segments, log: this.log });
    this.sessions = new Map(); // token -> session
    this.byNick = new Map(); // lower nick -> session
    this.rooms = new Map(); // code -> room
    this.recentCodes = []; // 최근 발급 코드(재사용 회피, 최대 RECENT_CODES개)
    this.listTimer = null;
    this.handlers = this.makeHandlers();
  }

  // ---------- 전송 ----------
  sendTo(session, msg) {
    const c = session?.conn;
    if (!c) return;
    try { c.send(msg); } catch (e) { this.log('[send]', e.message); }
  }
  toast(session, code, params) { this.sendTo(session, { t: 'toast', code, msg: ERR[code] ?? code, params }); }
  err(conn, code, ref, params) { try { conn.send({ t: 'error', code, msg: ERR[code] ?? code, params, ref }); } catch { /* ignore */ } }

  // ---------- 연결 ----------
  onClose(conn) {
    const s = conn.session;
    if (!s || s.conn !== conn) return;
    s.conn = null;
    const room = this.roomOf(s);
    if (room?.game) room.game.setConnected(room.seatOf(s), false);
    if (room) this.broadcastRoom(room);
    clearTimeout(s.graceTimer);
    s.graceTimer = setTimeout(() => this.expire(s), this.graceMs);
    s.graceTimer.unref?.();
    this.markListDirty();
  }

  expire(s) {
    if (s.conn) return;
    try {
      if (this.roomOf(s)) this.removeFromRoom(s, 'grace');
    } catch (e) { this.log('[expire]', e); }
    this.sessions.delete(s.token);
    if (this.byNick.get(s.key) === s) this.byNick.delete(s.key);
  }

  /** 메시지 진입점. 모든 예외는 여기서 흡수한다(연결/방 격리). */
  onMessage(conn, msg) {
    const ref = msg?.ref;
    try {
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') fail('BAD_MESSAGE');
      if (msg.t === 'ping') { conn.send({ t: 'pong', clientTime: msg.clientTime, serverTime: Date.now() }); return; }
      if (msg.t === 'hello') { this.hello(conn, msg); return; }
      if (msg.t === 'register' || msg.t === 'login') { this.authAsync(conn, msg); return; }
      const s = conn.session;
      if (!s) fail('NOT_LOGGED_IN');
      const h = Object.hasOwn(this.handlers, msg.t) ? this.handlers[msg.t] : null;
      if (!h) fail('UNKNOWN_TYPE');
      h.call(this, s, msg);
    } catch (e) {
      if (e instanceof LobbyError) this.err(conn, e.code, ref, e.params);
      else { this.log('[message]', e); this.err(conn, 'INTERNAL', ref); }
    }
  }

  hello(conn, msg) {
    if (conn.session) fail('ALREADY_LOGGED_IN');
    this.checkHelloRate(conn.ip);
    let s;
    let resumed = false;
    if (typeof msg.token === 'string' && msg.token) {
      s = this.sessions.get(msg.token);
      if (!s) {
        // 메모리 세션이 없으면(유예 만료·서버 재시작) 계정 로그인 토큰인지 본다(§2.1). 맞으면 비밀번호 없이 로그인
        const acct = this.accounts.tokenAccount(msg.token);
        if (!acct) fail('TOKEN_INVALID');
        this.attachAccount(conn, acct, msg.token);
        return;
      }
      if (s.conn && s.conn !== conn) {
        const old = s.conn;
        old.session = null;
        try { old.send({ t: 'error', code: 'SESSION_REPLACED', msg: ERR.SESSION_REPLACED }); old.close(); } catch { /* ignore */ }
        s.conn = null;
      }
      clearTimeout(s.graceTimer);
      resumed = true;
    } else {
      const nick = cleanNick(msg.nickname);
      if (!NICK_RE.test(nick)) fail('NICK_INVALID');
      if (this.requireAccount) fail('ACCOUNT_REQUIRED');
      const key = nick.toLowerCase();
      if (this.accounts.has(key)) fail('NICK_REGISTERED'); // 가입된 닉네임은 비밀번호(login) 또는 로그인 토큰으로만
      const ex = this.byNick.get(key);
      if (ex) {
        if (ex.conn || this.roomOf(ex)) fail('NICK_TAKEN');
        clearTimeout(ex.graceTimer);
        this.sessions.delete(ex.token);
      }
      if (this.sessions.size >= this.limits.maxSessions) fail('SERVER_FULL');
      s = { token: randomBytes(18).toString('base64url'), nick, key, account: false, conn: null, roomCode: null, graceTimer: null };
      this.sessions.set(s.token, s);
      this.byNick.set(key, s);
    }
    this.welcome(conn, s, resumed);
  }

  /** 세션에 연결을 붙이고 welcome + 현재 위치 상태 전송(hello·login·register 공통) */
  welcome(conn, s, resumed) {
    s.conn = conn; conn.session = s;
    const room = this.roomOf(s);
    this.sendTo(s, {
      t: 'welcome', protocol: PROTOCOL, token: s.token, nickname: s.nick, resumed, account: !!s.account, requireAccount: this.requireAccount,
      location: room ? (room.game ? 'game' : 'room') : 'lobby', serverTime: Date.now(),
      build: this.o.build, rulesVersion: this.o.data.rules.version, tickRate: this.o.data.rules.tickRate, graceMs: this.graceMs,
      teams: this.o.data.teams.map((t) => ({ id: t.id, name: t.name })),
    });
    if (!room) this.sendTo(s, this.roomListMsg());
    else {
      this.sendTo(s, { t: 'room_joined', you: room.seatOf(s), room: this.roomView(room) });
      if (room.game) {
        room.game.resume(room.seatOf(s));
        room.game.setConnected(room.seatOf(s), true);
      }
      this.broadcastRoom(room);
    }
    this.markListDirty();
  }

  /**
   * 계정 세션 붙이기(로그인 성공·토큰 로그인·가입). token = 로그인 토큰 원문(세션 토큰으로도 쓴다).
   * 같은 계정의 세션이 이미 있으면(다른 기기·유예 중) 그 세션을 넘겨받는다: 이전 연결은 SESSION_REPLACED, 방·경기 위치 유지.
   * 같은 닉네임의 손님 세션(가입 전부터 있던 것)이 접속 중이거나 방에 있으면 NICK_TAKEN, 아니면 정리한다.
   * token 이 함수면 거절 검사(NICK_TAKEN·SERVER_FULL)를 다 통과한 뒤에 불러 발급한다(거절될 때 고아 토큰 행을 남기지 않게)
   */
  attachAccount(conn, acct, token) {
    const key = acct.key;
    let s = null, resumed = false;
    const ex = this.byNick.get(key);
    const guest = ex && !ex.account ? ex : null;
    if (guest && (guest.conn || this.roomOf(guest))) fail('NICK_TAKEN');
    if (!(ex && ex.account) && this.sessions.size - (guest ? 1 : 0) >= this.limits.maxSessions) fail('SERVER_FULL');
    if (typeof token === 'function') token = token();
    if (guest) {
      clearTimeout(ex.graceTimer);
      this.sessions.delete(ex.token);
      this.byNick.delete(key);
    } else if (ex) {
      s = ex;
      if (s.conn && s.conn !== conn) {
        const old = s.conn;
        old.session = null;
        try { old.send({ t: 'error', code: 'SESSION_REPLACED', msg: ERR.SESSION_REPLACED }); old.close(); } catch { /* ignore */ }
        s.conn = null;
      }
      clearTimeout(s.graceTimer);
      this.sessions.delete(s.token);
      s.token = token;
      this.sessions.set(token, s);
      resumed = true;
    }
    if (!s) {
      s = { token, nick: acct.nick, key, account: true, conn: null, roomCode: null, graceTimer: null };
      this.sessions.set(token, s);
      this.byNick.set(key, s);
    }
    this.welcome(conn, s, resumed);
  }

  /** register / login(비동기: scrypt 는 스레드 풀에서 돈다). 예외는 여기서 error 로 돌려준다 */
  authAsync(conn, msg) {
    const ref = msg.ref;
    const run = msg.t === 'register' ? this.register(conn, msg) : this.login(conn, msg);
    return run.catch((e) => {
      if (e instanceof LobbyError) this.err(conn, e.code, ref, e.params);
      else { this.log('[auth]', e?.message ?? e); this.err(conn, 'INTERNAL', ref); }
    }).finally(() => { if (conn.authBusy === msg) conn.authBusy = false; });
  }

  authInput(conn, msg) {
    const nick = cleanNick(msg.nickname);
    if (!NICK_RE.test(nick)) fail('NICK_INVALID');
    if (conn.authBusy) fail('AUTH_BUSY');
    this.checkHelloRate(conn.ip);
    this.checkAuthRate(conn.ip);
    return { nick, key: nick.toLowerCase() };
  }

  /**
   * 가입 {nickname, password}. 로그인 전 연결이면 가입 후 바로 로그인(welcome{account:true}).
   * 같은 닉네임의 손님 세션으로 이미 접속해 있으면 그 세션을 계정으로 올린다(account_ok{token}). 진행·리그 승계는 이 경로에서만(닉네임 키 그대로).
   * 그 밖의 가입(로그인 전 연결)은 빈 진행으로 시작한다: 그 닉네임에 남아 있던 손님 진행·리그는 지우지 않고 계정이 못 읽는 키로 옮겨 둔다(PROTOCOL §2.1)
   * 한계(수용): 손님은 소유 증명이 없어, 끊긴 손님 닉네임을 hello 로 잡은 뒤 그 연결에서 가입하면 진행이 승계된다(2단계 우회, §2.1)
   * 해시 계산 중 같은 닉네임 손님이 hello 하면(경합) 계정은 만들어지고, 그 손님 세션은 끝내며 이 연결은 ACCOUNT_CREATED_RELOGIN(토큰 미발급)
   */
  async register(conn, msg) {
    const { nick, key } = this.authInput(conn, msg);
    const cur = conn.session;
    if (cur && (cur.account || cur.key !== key)) fail('ALREADY_LOGGED_IN');
    if (!passwordOk(msg.password)) fail('PASSWORD_INVALID');
    if (this.accounts.has(key)) fail('ACCOUNT_EXISTS');
    if (!cur) {
      const ex = this.byNick.get(key);
      if (ex && (ex.conn || this.roomOf(ex))) fail('NICK_TAKEN');
    }
    conn.authBusy = msg; // 이 요청이 끝날 때만 푼다(AUTH_BUSY 로 거절된 다른 요청이 풀지 않게)
    const acct = await this.accounts.create(cur ? cur.nick : nick, msg.password);
    if (!acct) fail('ACCOUNT_EXISTS');
    let raced = false;
    if (!cur) {
      this.setAsideGuestData(key); // 손님 데이터 선점 방지: 승계하지 않고 따로 보존
      // 해시 계산(await) 중 같은 닉네임 손님이 hello 로 들어와 있으면: 그 손님 세션을 끝내고(계정 키에 기록을 쓰지 않게) 이 가입은 재로그인 안내
      const ex = this.byNick.get(key);
      if (ex && !ex.account && (ex.conn || this.roomOf(ex))) { raced = true; this.endGuestSession(ex); }
    }
    if (conn.closed) return;
    if (cur && conn.session !== cur) fail('ACCOUNT_CREATED_RELOGIN'); // 그 사이 이 연결의 세션이 바뀜(로그아웃·교체). 계정은 만들어졌다
    if (!cur && (conn.session || raced)) fail('ACCOUNT_CREATED_RELOGIN'); // 그 사이 이 연결이 다른 닉네임으로 접속함 / 같은 닉네임 손님과 경합(토큰 미발급)
    if (cur) {
      const token = this.accounts.issueToken(key);
      this.sessions.delete(cur.token);
      cur.token = token; cur.account = true;
      this.sessions.set(token, cur);
      this.sendTo(cur, { t: 'account_ok', token, nickname: cur.nick });
      return;
    }
    this.attachAccount(conn, acct, () => this.accounts.issueToken(key));
  }

  /**
   * 가입 경합으로 계정이 생긴 닉네임에 남은 손님 세션을 끝낸다(logout 과 같은 정리: 방·경기 중이면 퇴장 = 기권, logged_out 전송).
   * 그 퇴장으로 끝나는 경기의 진행·리그 기록은 guestOfAccount 검사로 계정 키에 쓰지 않는다
   */
  endGuestSession(s) {
    this.log(`[account] 가입 경합: 같은 닉네임 손님 세션 종료 ${s.key}`);
    this.logout(s);
  }

  /** 계정이 있는 닉네임의 손님 세션인가(가입 경합으로 남은 세션). 이런 세션의 진행·리그 기록은 계정 키에 쓰지 않는다 */
  guestOfAccount(s) { return !s.account && this.accounts.has(s.key); }

  /**
   * 로그인 {nickname, password}. 없는 닉네임과 틀린 비밀번호는 같은 LOGIN_FAILED.
   * 실패 제한(LoginGuard): (닉네임, IP) 쌍·IP 별 잠금(LOGIN_LOCKED), 닉네임 단독 누적은 잠그지 않고 응답을 늦춘다(다른 IP 본인 로그인 보장)
   */
  async login(conn, msg) {
    if (conn.session) fail('ALREADY_LOGGED_IN');
    const { key } = this.authInput(conn, msg);
    if (this.loginGuard.locked(key, conn.ip)) fail('LOGIN_LOCKED');
    const pw = typeof msg.password === 'string' && msg.password.length <= 256 ? msg.password : '';
    conn.authBusy = msg; // 이 요청이 끝날 때만 푼다(AUTH_BUSY 로 거절된 다른 요청이 풀지 않게)
    const wait = this.loginGuard.delayMs(key);
    if (wait > 0) await sleep(wait);
    const acct = pw ? await this.accounts.verify(key, pw) : null;
    if (!acct) { this.loginGuard.fail(key, conn.ip); fail('LOGIN_FAILED'); }
    this.loginGuard.success(key, conn.ip);
    if (conn.closed) return; // 확인을 토큰 발급 앞에 둔다(거절·끊김 때 고아 토큰 행이 남지 않게)
    if (conn.session) fail('ALREADY_LOGGED_IN');
    this.attachAccount(conn, acct, () => this.accounts.issueToken(key));
  }

  /** 로그아웃: 로그인 토큰 폐기 + 세션 종료(방·경기 중이면 퇴장 = 기권). 연결은 남겨 두고 logged_out 을 보낸다 */
  logout(s) {
    if (s.account) this.accounts.revokeToken(s.token);
    const conn = s.conn;
    if (this.roomOf(s)) this.removeFromRoom(s, 'leave');
    clearTimeout(s.graceTimer);
    this.sessions.delete(s.token);
    if (this.byNick.get(s.key) === s) this.byNick.delete(s.key);
    s.conn = null;
    if (conn) {
      conn.session = null;
      conn.armLoginTimer?.(this.limits.logoutLoginTimeoutMs); // 로그아웃 시점부터 재로그인 제한 시간(연결 시점 타이머는 취소)
      try { conn.send({ t: 'logged_out' }); } catch { /* ignore */ }
    }
    this.markListDirty();
  }

  /**
   * 가입 경로가 승계가 아닐 때: 그 닉네임 키의 손님 진행·리그를 계정이 읽지 않는 키(`guest-aside:<키>:<시각>`)로 옮긴다.
   * 지우거나 덮지 않는다(운영자가 원래 손님에게 되돌려 줄 수 있게). NICK_RE 에 ':' 가 없어 어떤 세션도 이 키를 쓸 수 없다
   */
  setAsideGuestData(key) {
    const aside = `guest-aside:${key}:${Date.now()}`;
    let moved = 0;
    const db = this.progress.db;
    if (db && db === this.leagues.db && typeof db.tx === 'function') {
      // 같은 SQLite DB: 진행·리그를 한 트랜잭션으로 옮긴다(한쪽만 옮겨지는 상태를 남기지 않음)
      try { moved = db.tx(() => (this.progress.setAside(key, aside) ?? 0) + (this.leagues.setAside(key, aside) ?? 0) + (this.flame.db === db ? this.flame.setAside(key, aside) ?? 0 : 0)); }
      catch (e) { this.log('[aside]', e?.message ?? e); }
    } else {
      try { moved += this.progress.setAside?.(key, aside) ?? 0; } catch (e) { this.log('[aside progress]', e?.message ?? e); }
      try { moved += this.leagues.setAside?.(key, aside) ?? 0; } catch (e) { this.log('[aside league]', e?.message ?? e); }
    }
    if (!(db && db === this.leagues.db && typeof db.tx === 'function' && this.flame.db === db)) { // flame 저장소가 같은 DB 가 아니면(메모리 등) 따로 옮긴다
      try { moved += this.flame.setAside?.(key, aside) ?? 0; } catch (e) { this.log('[aside flame]', e?.message ?? e); }
    }
    if (moved) this.log(`[account] 가입 닉네임의 손님 데이터 ${moved}건을 승계하지 않고 보존: ${aside}`);
  }

  checkAuthRate(ip) {
    if (!ip) return;
    const now = mono();
    if (this.authWin.size > 5000) for (const [k, v] of this.authWin) if (now - v.start >= 60000) this.authWin.delete(k);
    let w = this.authWin.get(ip);
    if (!w || now - w.start >= 60000) { w = { start: now, count: 0 }; this.authWin.set(ip, w); }
    if (++w.count > this.limits.maxAuthPerMin) fail('AUTH_RATE_LIMITED');
  }

  checkHelloRate(ip) {
    if (!ip) return;
    const now = mono();
    if (this.helloWin.size > 5000) for (const [k, v] of this.helloWin) if (now - v.start >= 60000) this.helloWin.delete(k);
    let w = this.helloWin.get(ip);
    if (!w || now - w.start >= 60000) { w = { start: now, count: 0 }; this.helloWin.set(ip, w); }
    if (++w.count > this.limits.maxHelloPerMin) fail('HELLO_RATE_LIMITED');
  }

  // ---------- 방 ----------
  /** 방을 만들 때의 규칙: 녹아웃 + rules.json 제한 시간(5분). 규칙 창(set_rules)에서 바꾼다 */
  defaultRules(timeMin) {
    const R = this.o.data.rules, min = timeMin ?? R.time.limitFrames / (60 * R.tickRate);
    return { mode: 'knockout', time: RULE_TIMES.includes(min) ? min : 5 };
  }
  /** 요청에 실린 규칙 값 검증. campaign = 스토리 경기(원작 스토리는 체력제 고정이라 시간만 받는다) */
  parseRules(v, base, campaign = false) {
    // 스토리는 mode 를 보내도 무시(PROTOCOL §8): 검증 전에 빼서, 꺼 둔 official 이 실려 와도 시간만 본다
    const isObj = v && typeof v === 'object' && !Array.isArray(v);
    const r = normRules(campaign && isObj ? { time: v.time } : v, base) ?? fail('RULES_INVALID');
    return campaign ? { mode: 'knockout', time: r.time } : r;
  }

  roomOf(s) { return s.roomCode ? this.rooms.get(s.roomCode) ?? null : null; }

  newCode() {
    for (let i = 0; i < 100; i++) {
      let c = '';
      for (let k = 0; k < 4; k++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
      if (this.rooms.has(c) || this.recentCodes.includes(c)) continue;
      this.rememberCode(c);
      return c;
    }
    return fail('INTERNAL');
  }

  rememberCode(c) {
    this.recentCodes.push(c);
    if (this.recentCodes.length > RECENT_CODES) this.recentCodes.shift();
  }

  roomView(room) {
    const st = this.startCheck(room);
    return {
      code: room.code, status: room.game ? 'playing' : 'waiting', host: room.seats[0]?.s.nick ?? null, serverTime: Date.now(),
      ...(room.vsCpu ? { vsCpu: true, cpuLevel: room.cpuLevel } : {}),
      ...(room.campaign ? { campaign: { k: room.campaign.k } } : {}),
      ...(room.training ? { training: { kind: room.training.kind } } : {}),
      ...(room.league ? { league: { i: room.league.i, j: room.league.j } } : {}),
      ...(room.flame ? { flame: { node: room.flame.node, type: room.flame.type } } : {}),
      ...(room.ranked ? { ranked: true } : {}),
      rules: { ...room.rules },
      start: st.ok ? { ok: true } : { ok: false, code: st.code, msg: ERR[st.code] },
      slots: room.seats.map((m, i) => (!m && i === 1 && room.vsCpu ? { seat: 1, nick: CPU_NICK, ready: true, team: room.cpuTeam, host: false, connected: true, cpu: true } : m ? { seat: i, nick: m.s.nick, ready: m.ready, team: m.team, host: i === 0, connected: !!m.s.conn, ...(room.ranked ? this.seatRating(m.s) : {}) } : null)),
    };
  }

  /** 랭크 방 좌석의 현재 레이팅(PROTOCOL §11.2). placement = 순위표 기준 경기 수 미만(ranking_list.me.placement 와 같은 기준) */
  seatRating(s) {
    const r = this.ranking.get(s.key, s.nick);
    return { rating: r.rating, placement: r.games < RANK.boardMinGames };
  }

  startCheck(room) {
    if (room.vsCpu) return { ok: true };
    if (!room.seats[1]) return { ok: false, code: 'START_NEED_PLAYERS' };
    if (!room.seats[1].ready) return { ok: false, code: 'START_NOT_READY' };
    return { ok: true };
  }

  broadcastRoom(room) {
    const v = this.roomView(room);
    for (const m of room.seats) if (m) this.sendTo(m.s, { t: 'room_state', room: v });
  }

  /** 컴퓨터 대전 상대 팀: 내 팀(exclude)을 뺀 무작위(같은 유니폼 구분 불가 방지) */
  pickCpuTeam(exclude) {
    const n = this.o.data.teams.length;
    if (n <= 1) return 0;
    const t = randomInt(n - 1);
    return t >= exclude ? t + 1 : t;
  }

  makeRoom(code, vsCpu = false, cpuLevel = 2, campaign = null, rules = this.defaultRules()) {
    const room = {
      code, vsCpu, cpuLevel, campaign, rules, cpuTeam: campaign ? this.o.data.campaign[campaign.k].teamOpp : vsCpu ? this.pickCpuTeam(0) : 0, seats: [null, null], game: null, createdAt: Date.now(),
      seatOf(s) { return this.seats.findIndex((m) => m && m.s === s); },
    };
    this.rooms.set(code, room);
    return room;
  }

  removeFromRoom(s, reason) {
    const room = this.roomOf(s);
    if (!room) return;
    const seat = room.seatOf(s);
    room.closing = true; // 좌석 정리는 이 함수가 한다(abort -> onGameEnd -> trainingEnd 가 또 빼지 않게)
    try {
      if (room.game) room.game.abort(1 - seat, reason === 'leave' ? 'forfeit_leave' : 'forfeit_disconnect');
    } finally {
      // abort 가 던져도 좌석 정리와 closing 해제는 끝낸다(방이 closing 인 채 남지 않게). 예외는 그대로 올라간다
      room.seats[seat] = null;
      s.roomCode = null;
      if (room.seats[0] === null && room.seats[1]) { room.seats[0] = room.seats[1]; room.seats[1] = null; }
      for (const m of room.seats) if (m) m.ready = false;
      room.closing = false;
    }
    if (!room.seats[0]) this.rooms.delete(room.code);
    else this.broadcastRoom(room);
    if (s.conn) { this.sendTo(s, { t: 'room_left', reason }); this.sendTo(s, this.roomListMsg()); }
    this.markListDirty();
  }

  roomListMsg() {
    const rooms = [...this.rooms.values()].filter((r) => !r.campaign && !r.training && !r.league && !r.flame).sort((a, b) => b.createdAt - a.createdAt).map((r) => ({
      code: r.code, host: r.seats[0]?.s.nick ?? '', players: r.vsCpu ? 2 : r.seats.filter(Boolean).length, max: 2, ...(r.vsCpu ? { vsCpu: true } : {}), ...(r.ranked ? { ranked: true } : {}), status: r.game ? 'playing' : 'waiting',
      rules: { ...r.rules }, // 방 목록 행의 규칙 요약용(추가 필드, 하위 호환)
    }));
    return { t: 'room_list', rooms };
  }

  markListDirty() {
    if (this.listTimer) return;
    this.listTimer = setTimeout(() => {
      this.listTimer = null;
      const msg = JSON.stringify(this.roomListMsg());
      for (const s of this.sessions.values()) if (s.conn && !s.roomCode) this.sendTo(s, msg);
    }, 250);
    this.listTimer.unref?.();
  }

  join(s, room, team) {
    const idx = room.seats[0] ? 1 : 0;
    room.seats[idx] = { s, ready: false, team: team ?? idx };
    s.roomCode = room.code;
    this.sendTo(s, { t: 'room_joined', you: idx, room: this.roomView(room) });
    this.broadcastRoom(room);
    this.markListDirty();
  }

  // ---------- 요청 핸들러 ----------
  makeHandlers() {
    return {
      list_rooms(s) { this.sendTo(s, this.roomListMsg()); },
      create_room(s, m) {
        if (s.roomCode) fail('ALREADY_IN_ROOM');
        if (this.rooms.size >= this.limits.maxRooms) fail('TOO_MANY_ROOMS');
        if (m.vsCpu !== undefined && typeof m.vsCpu !== 'boolean') fail('BAD_MESSAGE');
        const vsCpu = m.vsCpu === true;
        if (m.cpuLevel !== undefined && !isInt(m.cpuLevel, 1, 3)) fail('BAD_MESSAGE');
        const cpuLevel = m.cpuLevel ?? this.o.data.rules.cpu.defaultLevel;
        if (m.ranked !== undefined && typeof m.ranked !== 'boolean') fail('BAD_MESSAGE');
        const ranked = m.ranked === true;
        if (ranked && vsCpu) fail('BAD_MESSAGE'); // 랭크는 사람끼리만
        if (ranked) this.rankedGate(s);
        let code;
        if (m.code !== undefined && m.code !== null && m.code !== '') {
          code = typeof m.code === 'string' ? m.code.toUpperCase() : '';
          if (!CODE_RE.test(code)) fail('ROOM_CODE_INVALID');
          if (this.rooms.has(code)) fail('ROOM_CODE_TAKEN');
        } else code = this.newCode();
        let rules = m.rules === undefined ? this.defaultRules() : this.parseRules(m.rules, this.defaultRules());
        if (ranked) {
          if (m.rules !== undefined && (rules.mode !== RANK.rules.mode || rules.time !== RANK.rules.time)) fail('RANKED_RULES_FIXED');
          rules = { ...RANK.rules };
        }
        this.rememberCode(code);
        const room = this.makeRoom(code, vsCpu, cpuLevel, null, rules);
        if (ranked) room.ranked = true;
        this.join(s, room);
      },
      join_room(s, m) {
        if (s.roomCode) fail('ALREADY_IN_ROOM');
        const code = typeof m.code === 'string' ? m.code.trim().toUpperCase() : '';
        if (!CODE_RE.test(code)) fail('ROOM_CODE_INVALID');
        const room = this.rooms.get(code);
        if (!room) fail('ROOM_NOT_FOUND');
        if (room.game) fail('ROOM_IN_GAME');
        if (room.vsCpu || (room.seats[0] && room.seats[1])) fail('ROOM_FULL');
        if (room.ranked) this.rankedGate(s);
        this.join(s, room);
      },
      leave_room(s) {
        if (!s.roomCode) fail('NOT_IN_ROOM');
        this.removeFromRoom(s, 'leave');
      },
      ready(s, m) {
        const room = this.roomOf(s) ?? fail('NOT_IN_ROOM');
        if (room.game) fail('IN_GAME');
        const seat = room.seatOf(s);
        if (seat === 0) fail('HOST_NO_READY');
        if (typeof m.ready !== 'boolean') fail('BAD_MESSAGE');
        room.seats[seat].ready = m.ready;
        this.broadcastRoom(room);
      },
      set_team(s, m) {
        const room = this.roomOf(s) ?? fail('NOT_IN_ROOM');
        if (room.game) fail('IN_GAME');
        if (room.campaign || room.training || room.league || room.flame) fail('NOT_IN_CAMPAIGN_ROOM');
        if (!isInt(m.team, 0, this.o.data.teams.length - 1)) fail('TEAM_INVALID');
        if (room.ranked && m.team > RANK.maxTeam) fail('TEAM_INVALID'); // 랭크: SPECIAL(15~21)까지, 22~24 금지
        const mem = room.seats[room.seatOf(s)];
        if (mem.team !== m.team) { mem.team = m.team; mem.ready = false; }
        if (room.vsCpu && !room.campaign && room.cpuTeam === mem.team) room.cpuTeam = this.pickCpuTeam(mem.team);
        this.broadcastRoom(room);
      },
      // 규칙 창(원작 ルール/しあいじかん): 방장만, 대기 중에만. 바뀌면 상대 준비 해제(바뀐 규칙을 보고 다시 준비)
      set_rules(s, m) {
        const room = this.roomOf(s) ?? fail('NOT_IN_ROOM');
        if (room.game) fail('IN_GAME');
        if (room.seatOf(s) !== 0) fail('NOT_HOST');
        if (room.league || room.flame) fail('NOT_IN_CAMPAIGN_ROOM'); // 리그 규칙은 league_config 로만, flame 경기 규칙은 서버 데이터(run_config.json)
        if (room.ranked) fail('RANKED_RULES_FIXED');
        const r = this.parseRules(m.rules, room.rules, !!room.campaign);
        if (r.mode !== room.rules.mode || r.time !== room.rules.time) {
          room.rules = r;
          if (room.seats[1]) room.seats[1].ready = false;
        }
        this.broadcastRoom(room);
      },
      transfer_host(s) {
        const room = this.roomOf(s) ?? fail('NOT_IN_ROOM');
        if (room.game) fail('IN_GAME');
        if (room.seatOf(s) !== 0) fail('NOT_HOST');
        if (!room.seats[1]) fail('START_NEED_PLAYERS');
        [room.seats[0], room.seats[1]] = [room.seats[1], room.seats[0]];
        for (const m of room.seats) m.ready = false;
        this.broadcastRoom(room);
        this.markListDirty();
      },
      start(s) {
        const room = this.roomOf(s) ?? fail('NOT_IN_ROOM');
        if (room.training || room.league || room.flame) fail('NOT_IN_CAMPAIGN_ROOM'); // 특훈 방은 training_start, 리그 방은 league_play 로만 시작한다(일반 경기로 다시 시작 금지, set_team 과 같은 코드)
        if (room.game) fail('IN_GAME');
        if (room.seatOf(s) !== 0) fail('NOT_HOST');
        const c = this.startCheck(room);
        if (!c.ok) fail(c.code);
        if (room.ranked) for (const mm of room.seats) if (mm) this.rankedGate(mm.s); // 방에 든 뒤 잠긴 사람(이 방의 앞 경기 기권 등)
        this.startGame(room);
      },
      // 순위표(PROTOCOL §11). top = 1~50(생략 50). me = 계정이면 내 줄, 손님이면 null
      ranking_list(s, m) {
        this.campaignRate(s);
        if (m.top !== undefined && !isInt(m.top, 1, RANK.boardTop)) fail('BAD_MESSAGE');
        const b = this.ranking.board(m.top ?? RANK.boardTop, s.account ? s.key : null, s.nick);
        this.sendTo(s, { t: 'ranking_list', top: b.top, me: b.me });
      },
      logout(s) { this.logout(s); },
      campaign_list(s) {
        this.campaignRate(s);
        this.sendTo(s, this.campaignListMsg(s));
      },
      campaign_start(s, m) {
        this.campaignRate(s);
        const chs = this.o.data.campaign;
        if (!isInt(m.k, 0, chs.length - 1)) fail('BAD_MESSAGE');
        // 상대·스테이지·내 팀은 클라이언트가 보내도 무시한다(서버 표만 사용)
        if (m.k > this.progress.get(s.key).clearedMax + 1) fail('CAMPAIGN_LOCKED');
        const old = this.roomOf(s);
        if (old && !(old.campaign && !old.game)) fail('ALREADY_IN_ROOM');
        const c = chs[m.k];
        // 제한 시간: 요청 값(규칙 창) > 경기 표의 timeMin > 기본
        const base = this.defaultRules(c.timeMin);
        const rules = m.rules === undefined ? base : this.parseRules(m.rules, base, true);
        // 거절은 전부 옛 대기 방을 나가기 전에 끝낸다(거절된 요청이 상태를 바꾸지 않게). 옛 캠페인 방은 나가면 없어지므로 한 자리 빼고 센다
        if (this.rooms.size - (old ? 1 : 0) >= this.limits.maxRooms) fail('TOO_MANY_ROOMS');
        if (old) this.removeFromRoom(s, 'leave');
        const code = this.newCode();
        const room = this.makeRoom(code, true, c.cpuLevel, { k: m.k }, rules);
        this.join(s, room, c.teamMine);
        this.startGame(room);
      },
      // 특훈(혼자 하기 전용, PROTOCOL §9): 비공개 방을 만들어 준비 없이 바로 시작한다. 진입 조건·저장·보상 없음(analysis/29 §1-7).
      // 팀(22 대 24)·스테이지·투구 표는 전부 서버 표(server/data/training.json)가 정한다. 끝나면(완료·그만두기·기권) 방은 없어지고 로비로 돌아간다
      training_start(s, m) {
        this.campaignRate(s);
        if (!TRAINING_KINDS.includes(m.kind)) fail('BAD_MESSAGE');
        if (!TRAINING_READY.includes(m.kind)) fail('TRAINING_UNAVAILABLE');
        if (s.roomCode) fail('ALREADY_IN_ROOM');
        if (this.rooms.size >= this.limits.maxRooms) fail('TOO_MANY_ROOMS');
        const T = this.o.data.training;
        const room = this.makeRoom(this.newCode(), true, this.o.data.rules.cpu.defaultLevel, null, { mode: 'knockout', time: 0 });
        room.training = { kind: m.kind }; room.cpuTeam = T.teams[1];
        this.join(s, room, T.teams[0]);
        this.startGame(room);
      },
      // 일시정지 창의 그만두기: 특훈을 끝내고 로비로(training_end.cleared=false)
      training_quit(s) {
        const room = this.roomOf(s);
        if (!room?.training || !room.game) fail('NOT_IN_TRAINING');
        room.game.abort(-1, 'training_quit');
      },
      ...makeLeagueHandlers(fail), // league_get/new/config/abandon/play (server/league/handlers.js)
      ...makeFlameHandlers(fail), // flame_* (server/flame/handlers.js, PROTOCOL §13)
      input(s, m) {
        const room = this.roomOf(s);
        if (!room?.game || !isInt(m.bits, 0, 255)) return; // 게임 종료 직후 입력은 조용히 무시
        room.game.setInput(room.seatOf(s), m.bits);
      },
    };
  }

  /** 랭크 입장 조건: 계정(REQUIRE_ACCOUNT 와 무관) + 기권 잠금 아님 */
  rankedGate(s) {
    if (!s.account) fail('ACCOUNT_REQUIRED');
    const until = this.ranking.lockedUntil(s.key);
    if (until) fail('RANKED_LOCKED', { until });
  }

  /**
   * 랭크 경기 판정(RoomGame.finish 가 결과 레코드 쓰기 전에 1회 부른다). 반영 = GO 이후의 정상 종료·기권(기권 쪽 패배).
   * draw_cap·error·GO 이전 종료는 무효(VOID, 변동 없음). 같은 상대 24시간 3경기 초과는 PAIR_LIMIT(변동 없음)
   */
  rankedResult(room, { matchId, winner, reason, wentGo }) {
    const players = room.rankPlayers;
    const valid = wentGo && (winner === 0 || winner === 1) && (RANK_NORMAL.includes(reason) || RANK_FORFEIT.includes(reason));
    let out;
    if (!valid) {
      const before = players.map((p) => this.ranking.get(p.key).rating);
      out = { counted: false, why: 'VOID', before, after: before, delta: [0, 0] };
    } else out = this.ranking.record({ matchId, players, winner, forfeit: RANK_FORFEIT.includes(reason) ? 1 - winner : null });
    room.rankOut = out;
    return out;
  }

  campaignRate(s) {
    const now = mono();
    if (!s.campWin || now - s.campWin.start >= 60000) s.campWin = { start: now, count: 0 };
    if (++s.campWin.count > this.limits.maxCampaignPerMin) fail('CAMPAIGN_RATE_LIMITED');
  }

  /** 리그 전용 창(league_*, 사람 카드 방 생성 포함). 거절된 요청도 횟수에 든다. 초과 코드는 캠페인과 같다 */
  leagueRate(s) {
    const now = mono();
    if (!s.leagueWin || now - s.leagueWin.start >= 60000) s.leagueWin = { start: now, count: 0 };
    if (++s.leagueWin.count > this.limits.maxLeaguePerMin) fail('CAMPAIGN_RATE_LIMITED');
  }

  /** 불꽃의 계승 전용 창(flame_*). 거절된 요청도 횟수에 든다. 초과 코드는 캠페인과 같다 */
  flameRate(s) {
    const now = mono();
    if (!s.flameWin || now - s.flameWin.start >= 60000) s.flameWin = { start: now, count: 0 };
    if (++s.flameWin.count > this.limits.maxFlamePerMin) fail('CAMPAIGN_RATE_LIMITED');
  }

  campaignListMsg(s) {
    const p = this.progress.get(s.key);
    return {
      t: 'campaign_list', progress: p,
      chapters: this.o.data.campaign.map((c) => ({ k: c.k, teamMine: c.teamMine, teamOpp: c.teamOpp, stage: c.stage, unlocked: c.k <= p.clearedMax + 1, cleared: c.k <= p.clearedMax })),
    };
  }

  startGame(room) {
    const seats = room.seats.map((m) => (m ? { nick: m.s.nick, team: m.team } : null));
    const ch = room.campaign ? this.o.data.campaign[room.campaign.k] : null;
    if (ch) seats[0].team = ch.teamMine;
    // 일반 컴퓨터 대전만: 내 팀과 같은 상대는 다른 팀으로 바꾼다. flame 방은 바꾸지 않는다 - 상대는 지도 노드가 정한 팀이고(결과 기록 done[].opp 와 같아야 한다),
    // 좌석 0 팀은 주장 칸 선수의 몸 출처(roster[0].from.team)일 뿐이라 클론을 주장에 두면 상대 팀과 같을 수 있다(엔진은 같은 팀끼리도 받는다)
    if (room.vsCpu && !ch && !room.flame && seats[0] && room.cpuTeam === seats[0].team) room.cpuTeam = this.pickCpuTeam(seats[0].team);
    if (room.vsCpu) seats[1] = { nick: CPU_NICK, team: room.cpuTeam, cpu: true, level: room.cpuLevel, ...(ch ? { special256: ch.specialChance256 } : {}) };
    for (const m of room.seats) if (m) m.ready = false;
    if (room.ranked) room.rankPlayers = room.seats.map((m) => ({ key: m.s.key, nick: m.s.nick })); // 시작 시점 두 사람(종료 때 좌석이 비어도)
    room.rankOut = null;
    room.game = new RoomGame({
      roomCode: room.code, seats, data: this.o.data, stage: ch?.stage ?? room.league?.stage ?? room.flame?.stage ?? 0, league: room.league ? { i: room.league.i, j: room.league.j } : null,
      rules: { mode: room.rules.mode, timeMin: room.rules.time, limitFrames: room.rules.time * 60 * this.o.data.rules.tickRate }, campaign: room.campaign, training: room.training ?? null, store: this.o.store, build: this.o.build, seed: this.o.seed, limits: this.limits,
      send: (seat, obj) => this.sendTo(room.seats[seat]?.s, obj),
      onEnd: (res) => this.onGameEnd(room, res),
      ...(room.ranked ? { onRanked: (r) => this.rankedResult(room, r) } : {}),
      ...(room.flame?.practice ? { noRecord: true } : {}), // 연습 경기(PROTOCOL §13.15): 결과 레코드를 남기지 않는다
      ...(room.flame ? { flame: room.flame.opts, flameCast: room.flame.cast ?? null } : {}), // 엔진 flame 옵션(저장된 도전 상태에서 서버가 조립한 값, PROTOCOL §12.1·§13) + 표시용 정의(game_start.flameCast, 엔진에는 넘기지 않는다)
    });
    room.game.begin();
    this.broadcastRoom(room);
    this.markListDirty();
  }

  onGameEnd(room, res) {
    room.game = null;
    for (const [i, m] of room.seats.entries()) if (m) this.sendTo(m.s, { ...res, you: i });
    if (room.rankOut) { // 랭크 방: game_end 바로 뒤 좌석별 레이팅 변동
      const o = room.rankOut; room.rankOut = null;
      for (const [i, m] of room.seats.entries()) {
        if (m) this.sendTo(m.s, { t: 'ranking_result', matchId: res.matchId, counted: o.counted, ...(o.why ? { why: o.why } : {}), before: o.before[i], after: o.after[i], delta: o.delta[i], oppBefore: o.before[1 - i] });
      }
    }
    if (room.campaign && room.seats[0]) this.campaignEnd(room, res);
    if (room.training) { this.trainingEnd(room, res); return; }
    if (room.league) { leagueEnd(this, room, res); return; } // 기록 1회 + 방 삭제 -> room_left
    if (room.flame) { flameEnd(this, room, res); return; } // 도전 상태 반영 + flame_result/flame_end/flame_state + 방 삭제 -> room_left
    for (const m of room.seats) if (m) m.ready = false;
    if (this.rooms.get(room.code) === room) this.broadcastRoom(room);
    this.markListDirty();
  }

  /** 특훈 종료: training_end 를 보내고 방을 없앤 뒤 로비로 돌려보낸다(재도전은 training_start 를 다시 보낸다). 진행·결과는 저장하지 않는다 */
  trainingEnd(room, res) {
    const s = room.seats[0]?.s;
    if (s) this.sendTo(s, { t: 'training_end', matchId: res.matchId, kind: room.training.kind, cleared: res.reason === 'training_clear', reason: res.reason });
    // removeFromRoom 이 부른 종료(room.closing: leave_room·유예 만료)는 그쪽이 방 정리와 room_left 를 마저 한다.
    // 그 밖(완료·그만두기·상한·오류, 그리고 roomGame 이 직접 끝내는 끊김 횟수·누적 일시정지 초과 기권)은 사유와 무관하게 여기서 좌석을 빼고 방을 없앤다
    if (s && !room.closing && this.roomOf(s) === room) this.removeFromRoom(s, 'leave'); // room_left{reason:'leave'} + room_list (끊겨 있으면 전송 없음 -> 재접속 시 welcome@lobby)
    this.markListDirty();
  }

  /** 캠페인 결과 반영: 사람(좌석0)의 정상 승리만 해제. 패배·기권·오류·무승부는 진행 불변(last 만 갱신) */
  campaignEnd(room, res) {
    const s = room.seats[0].s, k = room.campaign.k;
    const win = res.winner === 0 && ['annihilation', 'timeup', 'sudden_death'].includes(res.reason);
    const prev = this.progress.get(s.key).clearedMax;
    if (!this.guestOfAccount(s)) this.progress.recordResult(s.key, s.nick, k, win); // 가입 경합으로 남은 손님 세션은 계정 키에 쓰지 않는다
    const progress = this.progress.get(s.key);
    const unlocked = win && k > prev && k + 1 < this.o.data.campaign.length ? k + 1 : null;
    this.sendTo(s, { t: 'campaign_result', matchId: res.matchId, k, win, reason: res.reason, progress, unlocked, final: win && k === this.o.data.campaign.length - 1 });
  }

  // ---------- 게임 루프 (서버에서 주기 호출) ----------
  tickGames(now = mono()) {
    for (const room of this.rooms.values()) {
      const g = room.game;
      if (!g) continue;
      try { g.step(now); } catch (e) { // 방 단위 격리
        this.log('[game]', room.code, e);
        const members = room.seats.filter(Boolean).map((m) => m.s); // 특훈 방은 abort 중에 좌석이 비므로 먼저 잡아 둔다
        try { g.abort(-1, 'error'); } catch (e2) { this.log(e2); }
        for (const ms of members) this.toast(ms, 'GAME_ABORTED');
      }
    }
  }

  stats() {
    let playing = 0;
    for (const r of this.rooms.values()) if (r.game) playing++;
    return { sessions: this.sessions.size, rooms: this.rooms.size, playing };
  }
}
