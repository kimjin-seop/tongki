// 계정(닉네임 + 비밀번호)과 로그인 토큰. 저장은 db.js 래퍼만 쓴다.
// 비밀번호: crypto.scrypt(비동기, 게임 루프를 막지 않음) + 계정별 랜덤 솔트 16바이트, 비교는 timingSafeEqual. 평문·해시·토큰은 로그에 남기지 않는다.
// 로그인 토큰: 랜덤 32바이트(base64url). DB 에는 sha256 해시만 저장한다(DB 가 새어도 토큰으로 로그인할 수 없다).
import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const PW_MIN = 6;
export const PW_MAX = 64;
export const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 로그인 토큰 30일
const KEYLEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 };

const scrypt = (pw, salt) => new Promise((res, rej) => scryptCb(pw, salt, KEYLEN, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** 비밀번호 형식: 문자열, 6~64자(유니코드 코드 포인트 기준) */
export const passwordOk = (pw) => typeof pw === 'string' && [...pw].length >= PW_MIN && [...pw].length <= PW_MAX;

export async function hashPassword(pw, saltB64 = randomBytes(16).toString('base64')) {
  const k = await scrypt(pw.normalize('NFC'), Buffer.from(saltB64, 'base64'));
  return { hash: k.toString('base64'), salt: saltB64 };
}

export async function checkPassword(pw, hashB64, saltB64) {
  const k = await scrypt(pw.normalize('NFC'), Buffer.from(saltB64, 'base64'));
  const want = Buffer.from(hashB64, 'base64');
  return want.length === k.length && timingSafeEqual(k, want);
}

const DUMMY = { hash: randomBytes(KEYLEN).toString('base64'), salt: randomBytes(16).toString('base64') };

export class AccountStore {
  /** @param {ReturnType<import('./db.js').openDb>} db */
  constructor(db, { tokenTtlMs = TOKEN_TTL_MS } = {}) { this.db = db; this.tokenTtlMs = tokenTtlMs; }

  has(key) { return !!this.db.get('SELECT 1 AS x FROM accounts WHERE key = ?', key); }
  get(key) { const r = this.db.get('SELECT key, nick FROM accounts WHERE key = ?', key); return r ? { key: r.key, nick: r.nick } : null; }

  /** 가입. 이미 있으면 null(호출자가 ACCOUNT_EXISTS). 해시 계산 중 같은 닉네임 동시 가입은 PRIMARY KEY 로 하나만 성공 */
  async create(nick, pw) {
    const key = nick.toLowerCase();
    if (this.has(key)) return null;
    const h = await hashPassword(pw);
    const r = this.db.run('INSERT OR IGNORE INTO accounts (key, nick, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?, ?)', key, nick, h.hash, h.salt, Date.now());
    return r.changes ? { key, nick } : null;
  }

  /** 로그인 확인. 없는 닉네임도 같은 비용의 해시를 계산한다(존재 여부를 시간으로 드러내지 않게). 성공이면 계정, 아니면 null */
  async verify(key, pw) {
    const row = this.db.get('SELECT key, nick, pw_hash, pw_salt FROM accounts WHERE key = ?', key);
    const ok = await checkPassword(pw, row?.pw_hash ?? DUMMY.hash, row?.pw_salt ?? DUMMY.salt);
    if (!row || !ok) return null;
    this.db.run('UPDATE accounts SET last_login_at = ? WHERE key = ?', Date.now(), key);
    return { key: row.key, nick: row.nick };
  }

  /** 로그인 토큰 발급(원문 반환, DB 에는 해시만). 만료된 같은 계정 토큰은 이때 정리 */
  issueToken(key) {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.tx(() => {
      this.db.run('DELETE FROM auth_tokens WHERE key = ? AND expires_at <= ?', key, now);
      this.db.run('INSERT INTO auth_tokens (token_hash, key, created_at, expires_at) VALUES (?, ?, ?, ?)', sha256(token), key, now, now + this.tokenTtlMs);
    });
    return token;
  }

  /** 토큰 -> 계정(만료·없음 null). 토큰은 해시로 찾으므로 원문 비교가 없다 */
  tokenAccount(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const r = this.db.get('SELECT a.key, a.nick, t.expires_at FROM auth_tokens t JOIN accounts a ON a.key = t.key WHERE t.token_hash = ?', sha256(token));
    if (!r || r.expires_at <= Date.now()) return null;
    return { key: r.key, nick: r.nick };
  }

  revokeToken(token) { if (typeof token === 'string') this.db.run('DELETE FROM auth_tokens WHERE token_hash = ?', sha256(token)); }
}

/**
 * 로그인 실패 제한(메모리, windowMs 안의 실패 수).
 * - 잠금(lockMs 동안 맞는 비밀번호도 거절): (닉네임, IP) 쌍 failNick 회, IP failIp 회.
 * - 닉네임 단독(여러 IP 합계)은 잠그지 않고 늦춘다: failNick 회째 실패부터 다음 시도마다 slowStepMs 씩 더 기다린다(최대 slowMaxMs).
 *   공격자가 남의 닉네임으로 실패를 쌓아도 다른 IP(새 기기)의 본인 로그인은 막히지 않는다(느려질 뿐).
 * 성공하면 그 닉네임의 단독 기록과 그 (닉네임, IP) 쌍 기록을 지운다(IP 기록은 유지).
 */
export class LoginGuard {
  constructor({ failNick = 5, failIp = 20, windowMs = 15 * 60000, lockMs = 15 * 60000, slowStepMs = 1000, slowMaxMs = 10000, now = Date.now } = {}) {
    Object.assign(this, { failNick, failIp, windowMs, lockMs, slowStepMs, slowMaxMs, now });
    this.pair = new Map(); this.nick = new Map(); this.ip = new Map();
  }
  #rec(map, k) {
    const t = this.now();
    let r = map.get(k);
    if (!r || (t - r.start >= this.windowMs && r.until <= t)) { r = { start: t, count: 0, until: 0 }; map.set(k, r); }
    if (map.size > 10000) for (const [kk, v] of map) if (t - v.start >= this.windowMs && v.until <= t) map.delete(kk);
    return r;
  }
  #live(map, k) { const r = map.get(k); return r && this.now() - r.start < this.windowMs ? r : null; }
  locked(key, ip) {
    const t = this.now();
    return (this.pair.get(`${key}\n${ip ?? ''}`)?.until ?? 0) > t || (!!ip && (this.ip.get(ip)?.until ?? 0) > t);
  }
  /** 이 닉네임 로그인 전에 기다릴 시간(ms). 닉네임 단독 실패가 failNick 회 미만이면 0 */
  delayMs(key) {
    const n = this.#live(this.nick, key)?.count ?? 0;
    return n < this.failNick ? 0 : Math.min(this.slowStepMs * (n - this.failNick + 1), this.slowMaxMs);
  }
  fail(key, ip) {
    const t = this.now();
    const p = this.#rec(this.pair, `${key}\n${ip ?? ''}`);
    if (++p.count >= this.failNick) p.until = t + this.lockMs;
    this.#rec(this.nick, key).count++;
    if (ip) { const r = this.#rec(this.ip, ip); if (++r.count >= this.failIp) r.until = t + this.lockMs; }
  }
  success(key, ip) { this.nick.delete(key); this.pair.delete(`${key}\n${ip ?? ''}`); }
}
