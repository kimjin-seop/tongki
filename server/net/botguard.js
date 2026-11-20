// 봇 탐지·임시 차단 (docs/HANDOFF.md §19). 세 가지 신호만 본다:
//  ① 기계적 입력 간격(사람끼리 경기, 경기 끝날 때 판정) ② 한 IP 다계정(서로 다른 닉네임 신규 접속·로그인) ③ 브라우저가 아닌 클라이언트 지문(WS 업그레이드 헤더)
// IP·계정(닉네임 키)별 의심 점수 -> 임계 초과 시 새 접속·hello 거절(RATE_LIMITED / close 1008). 점수는 분당 감쇠, 차단 시간은 반복 시 2배(최대 24시간).
// 이미 접속 중인 세션·진행 중 경기는 끊지 않는다(기계적 입력 차단은 경기가 끝난 뒤 그 좌석 연결만 닫는다, lobby.js onGameEnd).
import { statSync, readFileSync } from 'node:fs';

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const list = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
/** IPv4-mapped IPv6(::ffff:1.2.3.4) 를 IPv4 로 */
export const normIp = (ip) => String(ip ?? '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
const normOrigin = (o) => String(o ?? '').trim().toLowerCase().replace(/\/+$/, '');
const MIN = 60000, DAY = 24 * 60 * MIN;

export function loadBotguardConfig(env = process.env, over = {}) {
  return {
    enabled: env.BOTGUARD_ENABLED !== '0', // 기본 켬
    threshold: num(env.BOTGUARD_THRESHOLD, 100), // 이 점수를 넘으면 차단(IP·계정 키 각각)
    blockMs: num(env.BLOCK_MINUTES, 30) * MIN, // 첫 차단 시간. 24시간 안에 다시 걸리면 2배씩, 상한 24시간
    decayPerMin: num(env.BOTGUARD_DECAY_PER_MIN, 1), // 분당 점수 감쇠
    allowedOrigins: list(env.ALLOWED_ORIGINS).map(normOrigin), // 비면 Origin 검사 끔(지문 점수의 「Origin 없음」만 낮게 반영)
    allowIps: ['127.0.0.1', '::1', ...list(env.BOTGUARD_ALLOW_IPS)].map(normIp), // 검사·차단 면제
    allowFile: env.BOTGUARD_ALLOW_FILE || null, // 재시작 없이 면제 추가(줄마다 IP 또는 nick:<닉네임>). 비면 server/index.js 가 data/botguard_allow.txt(테스트 중이면 없음)
    accountWeight: Math.min(1, num(env.BOTGUARD_ACCOUNT_WEIGHT, 0.5)), // 계정 로그인 세션 신호의 IP 점수 배율(같은 NAT 학교 보호)
    // 다계정: 한 IP 의 서로 다른 닉네임(손님 신규 hello·가입·로그인) 수. 학교 NAT 를 고려해 넉넉히
    nicksPer10Min: num(env.BOTGUARD_NICKS_PER_10MIN, 40),
    nicksPerDay: num(env.BOTGUARD_NICKS_PER_DAY, 200),
    multiPts: num(env.BOTGUARD_MULTI_PTS, 20), // 상한을 넘는 새 닉네임 1개당 점수
    // 기계적 입력(mechanicalInput 기준값)
    mechMinSamples: num(env.BOTGUARD_MECH_SAMPLES, 120), // 판정에 필요한 입력 변화 간격 수(경기 1~2판 누적)
    mechCvMax: num(env.BOTGUARD_MECH_CV, 0.08), // 변동계수(표준편차/평균) 이 값 미만 = 거의 상수 간격
    mechModeShare: num(env.BOTGUARD_MECH_MODE_SHARE, 0.85), // 간격의 이 비율 이상이 같은 틱 칸 = 완전 주기 반복
    mechPts: num(env.BOTGUARD_MECH_PTS, 70), // 1회 판정 점수(IP 는 계정이면 accountWeight 배). 계정 키에는 그대로 -> 2회 반복이면 차단
    ...over,
  };
}

/**
 * 기계적 입력 판정(순수 함수). intervals = 한 좌석의 입력 비트 변화 사이 간격(ms, 서버 수신 시각 기준).
 * 2초 넘는 간격(멈춤·점수 뒤 대기)은 뺀다. 표본이 minSamples 미만이면 판정 안 함.
 * 의심 = 변동계수 cv < cvMax(간격이 거의 상수) 또는 가장 흔한 틱 칸(1/60초) 비율 >= modeShare(틱 단위 완전 주기 반복)
 */
export function mechanicalInput(intervals, { minSamples = 120, cvMax = 0.08, modeShare = 0.85, tickMs = 1000 / 60 } = {}) {
  const xs = intervals.filter((x) => Number.isFinite(x) && x > 0 && x <= 2000);
  const n = xs.length;
  if (n < minSamples) return { suspect: false, n, reason: 'few' };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const cv = sd / mean;
  const buckets = new Map();
  for (const x of xs) { const k = Math.round(x / tickMs); buckets.set(k, (buckets.get(k) ?? 0) + 1); }
  const share = Math.max(...buckets.values()) / n;
  const suspect = cv < cvMax || share >= modeShare;
  return { suspect, n, mean: Math.round(mean), sd: Math.round(sd * 10) / 10, cv: Math.round(cv * 1000) / 1000, share: Math.round(share * 100) / 100, reason: suspect ? (cv < cvMax ? 'cv' : 'periodic') : 'human' };
}

const TOOL_UA = /\b(node|undici|ws\/|python|aiohttp|requests|websocket-client|websockets|curl|wget|go-http|okhttp|java\/|libwww|httpie|axios|got\/|deno|bun\/|postman|insomnia)/i;

/**
 * 브라우저 아닌 클라이언트 지문(순수 함수). headers = WS 업그레이드 요청 헤더(소문자 키).
 * 신호: Origin 없음, User-Agent 없음 또는 도구 UA(2단위), Accept-Language 없음, Sec-WebSocket-Extensions 없음.
 * 단위 합 1 = 5점, 2 = 25점, 3 이상 = 60점(하나만으로는 거의 안 오르고 겹치면 크게)
 */
export function headerSignals(headers = {}) {
  const sig = [];
  if (!headers.origin) sig.push('no_origin');
  const ua = String(headers['user-agent'] ?? '');
  if (!ua) sig.push('no_ua'); else if (TOOL_UA.test(ua) && !/mozilla\//i.test(ua)) sig.push('tool_ua');
  if (!headers['accept-language']) sig.push('no_lang');
  if (!headers['sec-websocket-extensions']) sig.push('no_ext');
  const units = sig.reduce((a, s) => a + (s === 'no_ua' || s === 'tool_ua' ? 2 : 1), 0);
  return { signals: sig, score: units === 0 ? 0 : units === 1 ? 5 : units === 2 ? 25 : 60 };
}

export class BotGuard {
  /** @param {object} cfg loadBotguardConfig 결과  @param {{now?:()=>number, log?:Function}} o  now = 벽시계 ms(시험 주입) */
  constructor(cfg = loadBotguardConfig(), o = {}) {
    this.cfg = cfg;
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((...a) => console.error(...a));
    this.ent = new Map(); // id('ip:…'|'k:…') -> {score, at, until, strikes, strikeAt}
    this.nicks = new Map(); // ip -> Map(key -> 첫 시각)
    this.reasons = {}; // 사유별 누적 횟수(/health)
    this.allowSet = new Set(cfg.allowIps);
    this.fileAllow = new Set();
    this.fileCheckAt = 0; this.fileMtime = 0;
  }

  /** 파일 면제 목록을 10초에 한 번 mtime 으로 다시 읽는다(재시작 없이 해제·면제) */
  refreshFile() {
    const f = this.cfg.allowFile;
    if (!f) return;
    const t = this.now();
    if (t - this.fileCheckAt < 10000) return;
    this.fileCheckAt = t;
    let m = 0;
    try { m = statSync(f).mtimeMs; } catch { if (this.fileAllow.size) this.fileAllow = new Set(); this.fileMtime = 0; return; }
    if (m === this.fileMtime) return;
    this.fileMtime = m;
    try {
      const s = new Set();
      for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
        const v = line.replace(/#.*/, '').trim();
        if (!v) continue;
        s.add(v.toLowerCase().startsWith('nick:') ? `k:${v.slice(5).trim().normalize('NFC').toLowerCase()}` : `ip:${normIp(v)}`);
      }
      this.fileAllow = s;
      for (const id of s) this.ent.delete(id); // 면제에 넣으면 기존 점수·차단도 지운다
    } catch (e) { this.log('[botguard] allow file', e?.message ?? e); }
  }

  exemptIp(ip) { this.refreshFile(); ip = normIp(ip); return !ip || this.allowSet.has(ip) || this.fileAllow.has(`ip:${ip}`); }
  exemptKey(key) { this.refreshFile(); return !key || this.fileAllow.has(`k:${key}`); }

  entry(id) {
    const t = this.now();
    let e = this.ent.get(id);
    if (!e) { e = { score: 0, at: t, until: 0, strikes: 0, strikeAt: 0 }; this.ent.set(id, e); }
    e.score = Math.max(0, e.score - ((t - e.at) / MIN) * this.cfg.decayPerMin);
    e.at = t;
    if (e.strikes && t - e.strikeAt > DAY && t >= e.until) e.strikes = 0;
    return e;
  }

  /** 점수 더하기. 임계를 넘으면 차단(반복 시 2배, 상한 24시간). label = 로그용 원문(ip 또는 닉네임) */
  add(id, pts, reason, extra = '') {
    if (!this.cfg.enabled || pts <= 0) return false;
    const e = this.entry(id);
    e.score += pts;
    this.reasons[reason] = (this.reasons[reason] ?? 0) + 1;
    const [kind, ...rest] = id.split(':');
    const who = `${kind === 'ip' ? 'ip' : 'nick'}=${rest.join(':')}`;
    this.log(`[botguard] ${who} reason=${reason} score=${Math.round(e.score)}${extra ? ` ${extra}` : ''}`);
    const t = this.now();
    if (e.score > this.cfg.threshold && t >= e.until) {
      e.strikes += 1; e.strikeAt = t;
      const ms = Math.min(DAY, this.cfg.blockMs * 2 ** (e.strikes - 1));
      e.until = t + ms;
      e.score = 0; // 차단으로 정산. 해제 뒤 다시 쌓여야 다시 차단
      this.log(`[botguard] ${who} blocked minutes=${Math.round(ms / MIN)} strikes=${e.strikes}`);
      return true;
    }
    return false;
  }

  addIp(ip, pts, reason, extra) { if (this.exemptIp(ip)) return false; return this.add(`ip:${normIp(ip)}`, pts, reason, extra); }
  addKey(key, pts, reason, extra) { if (!key || this.exemptKey(key)) return false; return this.add(`k:${key}`, pts, reason, extra); }

  isBlocked(id) { const e = this.ent.get(id); return !!e && this.now() < e.until; }
  /** IP 또는 계정 키가 차단 중인가(면제면 false) */
  blocked(ip, key) {
    if (!this.cfg.enabled) return false;
    if (ip && !this.exemptIp(ip) && this.isBlocked(`ip:${normIp(ip)}`)) return true;
    if (key && !this.exemptKey(key) && this.isBlocked(`k:${key}`)) return true;
    return false;
  }

  /**
   * WS 업그레이드 검사. 반환 {ok:true} | {ok:false, why:'blocked'|'origin'}.
   * Origin 검사(ALLOWED_ORIGINS 설정 시): 없거나 목록 밖이면 점수 + 거절. 지문 점수는 통과한 접속에도 쌓인다
   */
  checkUpgrade(ip, headers = {}) {
    if (!this.cfg.enabled || this.exemptIp(ip)) return { ok: true };
    if (this.blocked(ip)) return { ok: false, why: 'blocked' };
    const fp = headerSignals(headers);
    if (this.cfg.allowedOrigins.length && !this.cfg.allowedOrigins.includes(normOrigin(headers.origin))) {
      this.addIp(ip, Math.max(25, fp.score), 'origin', `origin=${String(headers.origin ?? '-').slice(0, 80)}`);
      return { ok: false, why: 'origin' };
    }
    if (fp.score) this.addIp(ip, fp.score, 'fingerprint', `signals=${fp.signals.join('+')}`);
    return this.blocked(ip) ? { ok: false, why: 'blocked' } : { ok: true };
  }

  /** 다계정: 이 IP 에서 닉네임 키로 새 세션(손님 신규 hello·가입·로그인 성공). account = 계정 로그인이면 점수 배율을 낮춘다 */
  noteNick(ip, key, account) {
    if (!this.cfg.enabled || !key || this.exemptIp(ip)) return false;
    ip = normIp(ip);
    const t = this.now();
    let m = this.nicks.get(ip);
    if (!m) { if (this.nicks.size > 20000) this.pruneNicks(t); m = new Map(); this.nicks.set(ip, m); }
    if (m.has(key)) return false;
    for (const [k, at] of m) if (t - at > DAY) m.delete(k);
    m.set(key, t);
    let recent = 0;
    for (const at of m.values()) if (t - at <= 10 * MIN) recent++;
    const over = recent > this.cfg.nicksPer10Min || m.size > this.cfg.nicksPerDay;
    if (!over) return false;
    const pts = this.cfg.multiPts * (account ? this.cfg.accountWeight : 1);
    return this.addIp(ip, pts, 'multi_account', `nicks10m=${recent} nicksDay=${m.size}`);
  }

  pruneNicks(t) {
    for (const [ip, m] of this.nicks) { for (const [k, at] of m) if (t - at > DAY) m.delete(k); if (!m.size) this.nicks.delete(ip); }
  }

  /**
   * 기계적 입력: 경기 끝에 좌석의 누적 간격 표본으로 판정. 의심이면 계정 키(그대로)와 IP(계정이면 배율) 점수.
   * 반환 {res, blocked} — res = mechanicalInput 결과. 판정(표본 충분)했으면 호출 측이 표본을 비운다
   */
  noteMechanical(ip, key, account, intervals) {
    const c = this.cfg;
    const res = mechanicalInput(intervals, { minSamples: c.mechMinSamples, cvMax: c.mechCvMax, modeShare: c.mechModeShare });
    if (!c.enabled || !res.suspect || (this.exemptIp(ip) && this.exemptKey(key))) return { res, blocked: false };
    const extra = `n=${res.n} mean=${res.mean} sd=${res.sd} cv=${res.cv} share=${res.share}`;
    let b = false;
    if (!this.exemptIp(ip)) b = this.addKey(key, c.mechPts, 'mechanical_input', extra) || b;
    b = this.addIp(ip, c.mechPts * (account ? c.accountWeight : 1), 'mechanical_input', extra) || b;
    return { res, blocked: b || this.blocked(ip, key) };
  }

  /** /health 요약: 차단 중 수·사유별 누적(IP·닉네임 원문 없음) */
  summary() {
    const t = this.now();
    let blockedIps = 0, blockedNicks = 0;
    for (const [id, e] of this.ent) {
      if (t < e.until) { if (id.startsWith('ip:')) blockedIps++; else blockedNicks++; }
      else if (e.score - ((t - e.at) / MIN) * this.cfg.decayPerMin <= 0 && (!e.strikes || t - e.strikeAt > DAY)) this.ent.delete(id); // 다 식은 항목 정리
    }
    return { enabled: this.cfg.enabled, blockedIps, blockedNicks, reasons: { ...this.reasons } };
  }
}
