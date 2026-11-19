// 불꽃의 계승 저장소(PROTOCOL §13.6). 닉네임 소문자 키(손님·계정 공통, 진행·리그와 같은 키)마다 영구 저장(profile) 1개 + 도전 저장(run) 0~1개.
// 인터페이스: getProfile(key) / getRun(key) -> 저장된 JSON 그대로(없으면 null), save(key, nick, profile, run|null) = 둘을 한 번에(원자적) 쓴다,
//             setAside(key, toKey) = 가입 시 손님 데이터 분리 보존(lobby.setAsideGuestData), flush(),
//             quarantine(key, toKey, {profile?, run?}) = 읽지 못한 저장을 지우지 않고 다른 키로 옮겨 보존(P2 리뷰 M1, handlers.js load),
//             allProfiles() -> [{key, nick, data}] = 영구 저장 전 행(도달 순위표를 서버 시작 때 만드는 용도, server/flame/ranking.js. 풀리지 않는 행은 뺀다).
// JSON 으로 풀리지 않는 행은 null(없음)이 아니라 {unparsable:true} 로 돌려준다 -> 호출자가 '없음'으로 보고 덮어쓰지 않게.
// 형식 검증·버전 이전은 여기서 하지 않는다(server/flame/save.js sanitize* 가 읽을 때마다 한다). 저장값의 v 필드는 ver 열에도 적는다(운영 조회용).
const clone = (v) => (v == null ? null : structuredClone(v));

export class MemoryFlameStore {
  constructor() { this.profiles = new Map(); this.runs = new Map(); }
  getProfile(key) { return clone(this.profiles.get(key)?.data ?? null); }
  getRun(key) { return clone(this.runs.get(key)?.data ?? null); }
  allProfiles() { return [...this.profiles].map(([key, u]) => ({ key, nick: u.nick, data: clone(u.data) })); }
  save(key, nick, profile, run) {
    if (profile) this.profiles.set(key, { nick, data: clone(profile) });
    if (run) this.runs.set(key, { nick, data: clone(run) }); else this.runs.delete(key);
  }
  setAside(key, toKey) { return this.quarantine(key, toKey, { profile: true, run: true }); }
  quarantine(key, toKey, { profile = false, run = false } = {}) {
    let n = 0;
    for (const m of [profile && this.profiles, run && this.runs]) { const u = m && m.get(key); if (u) { m.delete(key); m.set(toKey, u); n++; } }
    return n;
  }
  flush() {}
}

/** SQLite 구현(운영). 표 flame_profiles·flame_runs(db.js MIGRATIONS v2). save 는 한 트랜잭션이라 코인 정산과 도전 삭제가 따로 남지 않는다 */
export class SqliteFlameStore {
  /** @param {ReturnType<import('./db.js').openDb>} db */
  constructor(db) { this.db = db; }
  #get(table, key) {
    const r = this.db.get(`SELECT data FROM ${table} WHERE key = ?`, key); // table 은 아래 두 상수뿐(입력값 아님)
    if (!r) return null;
    try { return JSON.parse(r.data); } catch { return { unparsable: true }; }
  }
  getProfile(key) { return this.#get('flame_profiles', key); }
  getRun(key) { return this.#get('flame_runs', key); }
  allProfiles() {
    const out = [];
    for (const r of this.db.all('SELECT key, nick, data FROM flame_profiles')) { try { out.push({ key: r.key, nick: r.nick, data: JSON.parse(r.data) }); } catch { /* 풀리지 않는 행은 순위표에서 뺀다 */ } }
    return out;
  }
  save(key, nick, profile, run) {
    const up = (table, v) => this.db.run(`INSERT INTO ${table} (key, nick, data, ver, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET nick = excluded.nick, data = excluded.data, ver = excluded.ver, updated_at = excluded.updated_at`, key, nick, JSON.stringify(v), Number.isInteger(v.v) ? v.v : 0, Date.now());
    this.db.tx(() => {
      if (profile) up('flame_profiles', profile);
      if (run) up('flame_runs', run); else this.db.run('DELETE FROM flame_runs WHERE key = ?', key);
    });
  }
  setAside(key, toKey) { return this.quarantine(key, toKey, { profile: true, run: true }); }
  quarantine(key, toKey, { profile = false, run = false } = {}) {
    const mv = (table) => Number(this.db.run(`UPDATE ${table} SET key = ? WHERE key = ?`, toKey, key).changes); // table 은 상수(입력값 아님)
    return (profile ? mv('flame_profiles') : 0) + (run ? mv('flame_runs') : 0);
  }
  flush() {}
}
