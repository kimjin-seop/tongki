// 싱글 캠페인 진행 저장소. 닉네임(소문자 키) 기준 { nick, clearedMax, last, updatedAt }.
// 인터페이스: get(key) / recordResult(key, nick, k, win). clearedMax=-1 이면 클리어 없음(1경기만 열림).
// 파일에는 clearedMax 가 실제로 오른 사용자(0~14)만 기록한다. 클리어 없는 사용자의 last(패배/기권)는 메모리에만 두며
// 재시작하면 사라진다. 영속 항목은 MAX_USERS 로 제한한다.
// 인증은 세션 토큰이 걸린 연결에서만 호출되는 것으로 갈음한다(개인용 단계, docs/PROTOCOL.md §8 공개 전 재검토).
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';

export const MAX_USERS = 5000;     // 영속(파일) 사용자 항목 상한
const MAX_TRANSIENT = 5000;        // 메모리 전용 last 항목 상한(오래된 것부터 제거)
const MAX_K = 14;
const FLUSH_MS = 100;              // 쓰기 합치기 디바운스

const FRESH = () => ({ nick: '', clearedMax: -1, last: null, updatedAt: 0 });
const validK = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_K;

class Base {
  constructor() { this.users = new Map(); this.transient = new Map(); }
  get(key) {
    const u = this.users.get(key) ?? this.transient.get(key);
    return u ? { clearedMax: u.clearedMax, last: u.last } : { clearedMax: -1, last: null };
  }
  /** 경기 결과 반영. 승리로 clearedMax 가 오를 때만 영속(되돌아가지 않음), 그 외는 last 만 메모리 갱신. 변경 여부를 반환 */
  recordResult(key, nick, k, win) {
    const cur = this.users.get(key);
    const u = cur ?? this.transient.get(key) ?? { ...FRESH(), nick };
    const before = `${u.clearedMax}/${u.last}`;
    u.nick = nick; u.last = k; u.updatedAt = Date.now();
    if (win && k > u.clearedMax) {
      if (!cur && !this.#admit(key, k)) { // 상한 초과: 영속하지 않고 메모리에만 둔다
        console.error('[progress] 사용자 항목 상한 초과, 신규 항목 영속 거부', key);
        this.#remember(key, u);
      } else {
        u.clearedMax = k;
        this.transient.delete(key);
        this.users.set(key, u);
        this.persist();
      }
    } else if (cur) {
      // 영속 사용자의 last 변경은 메모리에만(다음 승리 저장 때 함께 기록됨)
    } else this.#remember(key, u);
    return `${u.clearedMax}/${u.last}` !== before;
  }
  /** 신규 영속 항목 자리 확보: 가득 차면 clearedMax 가 가장 낮고 오래된 항목을 정리(새 항목보다 높은 것은 지키고 거부) */
  #admit(key, k) {
    if (this.users.size < MAX_USERS) return true;
    let victim = null;
    for (const [kk, v] of this.users) {
      if (!victim || v.clearedMax < victim.v.clearedMax || (v.clearedMax === victim.v.clearedMax && v.updatedAt < victim.v.updatedAt)) victim = { k: kk, v };
    }
    if (!victim || victim.v.clearedMax > k) return false;
    this.users.delete(victim.k);
    return true;
  }
  #remember(key, u) {
    this.transient.delete(key); this.transient.set(key, u);
    if (this.transient.size > MAX_TRANSIENT) this.transient.delete(this.transient.keys().next().value);
  }
  /** key 의 항목을 toKey 로 옮긴다(지우지 않음, 가입 시 손님 데이터 분리 보존). 옮긴 건수 */
  setAside(key, toKey) {
    let n = 0;
    for (const m of [this.users, this.transient]) {
      const u = m.get(key);
      if (u) { m.delete(key); m.set(toKey, u); n++; }
    }
    if (n) this.persist();
    return n;
  }
  persist() {}
  flush() {}
}

export class MemoryProgressStore extends Base {}

const live = new Set();
let exitHooked = false;
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on('exit', () => { for (const s of live) s.flush(); });
}

export class JsonProgressStore extends Base {
  constructor(file) {
    super();
    this.file = file;
    this.timer = null; this.dirty = false;
    this.#load();
    live.add(this); hookExit();
  }
  #load() {
    const file = this.file;
    if (!existsSync(file)) return;
    let j;
    try { j = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) {
      const bak = `${file}.corrupt-${Date.now()}`;
      try { renameSync(file, bak); console.error(`[progress] 파일 손상, 원본 보존: ${bak} (${e.message})`); }
      catch (e2) { console.error('[progress] 파일 손상, 원본 보존 실패', e2.message); }
      return;
    }
    if (!j || typeof j.users !== 'object' || j.users === null) return;
    for (const [k, v] of Object.entries(j.users)) {
      if (v?.clearedMax === -1) continue; // 구버전의 클리어 없는 항목: 조용히 버림
      if (!validK(v?.clearedMax)) { console.error('[progress] 잘못된 clearedMax 항목 무시', k); continue; }
      const last = validK(v.last) ? v.last : null;
      this.users.set(k, { ...FRESH(), ...v, clearedMax: v.clearedMax, last });
    }
    if (this.users.size > MAX_USERS) {
      const keep = [...this.users].sort((a, b) => b[1].clearedMax - a[1].clearedMax || b[1].updatedAt - a[1].updatedAt).slice(0, MAX_USERS);
      console.error(`[progress] 항목 ${this.users.size}개 > 상한 ${MAX_USERS}, 초과분 제외`);
      this.users = new Map(keep);
    }
  }
  /** 짧은 디바운스로 쓰기를 합친다 */
  persist() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, FLUSH_MS);
    this.timer.unref?.();
  }
  /** 즉시 저장(종료 시 호출). 임시 파일에 쓴 뒤 rename(원자적 교체) */
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, users: Object.fromEntries(this.users) }), 'utf8');
      renameSync(tmp, this.file);
    } catch (e) { console.error('[progress] 저장 실패', e.message); }
  }
}

/**
 * SQLite 구현(운영 기본, 2026-11-18). 인터페이스는 위와 같다(get / recordResult / flush).
 * 차이: 클리어 없는 사용자의 last 도 DB 에 남는다(재시작해도 유지). 항목 상한은 두지 않는다(행 단위 저장이라 파일 전체 재작성이 없다).
 * clearedMax 는 오르기만 한다. 계정이 없는 닉네임도 같은 키로 저장된다. 승계는 손님 세션 연결의 가입(account_ok)만, 그 밖의 가입은 setAside 로 분리 보존(lobby.register, PROTOCOL §2.1).
 */
export class SqliteProgressStore {
  /** @param {ReturnType<import('./db.js').openDb>} db */
  constructor(db) { this.db = db; }
  get(key) {
    const r = this.db.get('SELECT cleared_max, last FROM progress WHERE key = ?', key);
    return r ? { clearedMax: r.cleared_max, last: r.last } : { clearedMax: -1, last: null };
  }
  recordResult(key, nick, k, win) {
    const before = this.get(key);
    const clearedMax = win && k > before.clearedMax ? k : before.clearedMax;
    this.db.run(`INSERT INTO progress (key, nick, cleared_max, last, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET nick = excluded.nick, cleared_max = MAX(cleared_max, excluded.cleared_max), last = excluded.last, updated_at = excluded.updated_at`,
    key, nick, clearedMax, k, Date.now());
    return clearedMax !== before.clearedMax || k !== before.last;
  }
  /** key 의 행을 toKey 로 옮긴다(지우지 않음). 옮긴 건수 */
  setAside(key, toKey) { return Number(this.db.run('UPDATE progress SET key = ? WHERE key = ?', toKey, key).changes); }
  flush() {}
}
