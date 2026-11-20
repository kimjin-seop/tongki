// SQLite 얇은 래퍼. node:sqlite(Node >= 22.5 내장) 는 이 파일에서만 쓴다 — better-sqlite3 로 바꿀 때 이 파일만 고친다.
// 노출: openDb(file) -> { run, get, all, exec, tx, close, file }. SQL 값은 언제나 바인드 파라미터(?)로 넘긴다(문자열 이어 붙이기 금지).
// 스키마는 MIGRATIONS 배열 순서대로 한 번씩 적용하고 schema_version 에 기록한다(새 변경은 배열 끝에 추가만 한다).
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';

let sqlite = null;
try { sqlite = await import('node:sqlite'); } catch { /* 아래 openDb 에서 명확한 오류로 알린다 */ }

// 22.5~22.12 는 플래그 없이 import 하면 실패한다 -> 시작 시 아래 두 줄(한국어/영어)을 남기고 종료(server/index.js)
export const SQLITE_MISSING = `이 서버는 Node 내장 SQLite(node:sqlite)가 필요합니다(현재 ${process.version}). 해결: Node 22.13 이상으로 올리거나, 22.5~22.12 는 NODE_OPTIONS=--experimental-sqlite 또는 pm2 --node-args="--experimental-sqlite"(ecosystem 파일은 node_args) 로 실행하세요.\n` +
  `This server requires Node's built-in SQLite (node:sqlite) (current ${process.version}). Fix: upgrade to Node >= 22.13, or on 22.5-22.12 run with NODE_OPTIONS=--experimental-sqlite or pm2 --node-args="--experimental-sqlite" (node_args in an ecosystem file).`;
export const sqliteAvailable = () => !!sqlite?.DatabaseSync;

export const MIGRATIONS = [
  // v1: 계정·로그인 토큰·캠페인 진행·리그·랭킹·메타
  `CREATE TABLE accounts (
     key TEXT PRIMARY KEY,              -- 소문자 닉네임
     nick TEXT NOT NULL,
     pw_hash TEXT NOT NULL,             -- scrypt(base64)
     pw_salt TEXT NOT NULL,             -- 16바이트 랜덤(base64)
     created_at INTEGER NOT NULL,
     last_login_at INTEGER
   );
   CREATE TABLE auth_tokens (
     token_hash TEXT PRIMARY KEY,       -- sha256(토큰) hex. 토큰 원문은 저장하지 않는다
     key TEXT NOT NULL REFERENCES accounts(key),
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX auth_tokens_key ON auth_tokens(key);
   CREATE TABLE progress (
     key TEXT PRIMARY KEY, nick TEXT NOT NULL,
     cleared_max INTEGER NOT NULL, last INTEGER, updated_at INTEGER NOT NULL
   );
   CREATE TABLE leagues (
     key TEXT PRIMARY KEY, nick TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE TABLE ratings (
     key TEXT PRIMARY KEY, nick TEXT NOT NULL,
     rating INTEGER NOT NULL, w INTEGER NOT NULL, l INTEGER NOT NULL, games INTEGER NOT NULL,
     season INTEGER NOT NULL DEFAULT 1, lock_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
   );
   CREATE INDEX ratings_board ON ratings(season, games, rating);
   CREATE TABLE rank_games (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     match_id TEXT NOT NULL, a_key TEXT NOT NULL, b_key TEXT NOT NULL,
     winner_key TEXT NOT NULL, forfeit_key TEXT, counted INTEGER NOT NULL, at INTEGER NOT NULL
   );
   CREATE INDEX rank_games_a ON rank_games(a_key, at);
   CREATE INDEX rank_games_b ON rank_games(b_key, at);
   CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
  // v2: 불꽃의 계승(PROTOCOL §13.6). 영구 저장·도전 저장을 JSON 한 덩어리로(형식 버전 = ver, server/flame/save.js SAVE_VERSION). 기존 표는 건드리지 않는다
  `CREATE TABLE flame_profiles (
     key TEXT PRIMARY KEY, nick TEXT NOT NULL, data TEXT NOT NULL, ver INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE TABLE flame_runs (
     key TEXT PRIMARY KEY, nick TEXT NOT NULL, data TEXT NOT NULL, ver INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );`,
  // v3: 래더(2026-11-20, PROTOCOL §11). 시즌 1 = 전원 1000(사용자 결정): 종전 ratings(key 기본키, 시즌 없음)는 지우지 않고 보관 표로 이름만 바꾼다.
  // 새 ratings 는 (key, season) 기본키 + 표시 티어(강등 완충 상태) + 마지막 경기 시각(비활동 판정). 시즌 표·사람끼리 전적 표 추가. rank_games 에 시즌 열.
  // 한 트랜잭션(migrate 의 db.tx)이라 중간 실패 시 전부 되돌아가고, schema_version 으로 한 번만 적용된다. 되돌리기 SQL 은 docs/HANDOFF.md 래더 절
  `ALTER TABLE ratings RENAME TO ratings_v2_archive;
   DROP INDEX IF EXISTS ratings_board;
   CREATE TABLE ratings (
     key TEXT NOT NULL, season INTEGER NOT NULL, nick TEXT NOT NULL,
     rating INTEGER NOT NULL, w INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0,
     games INTEGER NOT NULL DEFAULT 0,          -- 이 시즌 반영 판수(배치·K48 판정)
     tier TEXT NOT NULL,                        -- 표시 티어(완충 반영). 배치 중에는 숨긴다(값은 시즌 시작 레이팅 기준)
     lock_until INTEGER NOT NULL DEFAULT 0, last_game_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
     PRIMARY KEY (key, season)
   );
   CREATE INDEX ratings_board ON ratings(season, games, rating);
   CREATE TABLE ladder_seasons (
     season INTEGER PRIMARY KEY, started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
     closed_at INTEGER, final TEXT              -- 종료 때 확정값 JSON {players, masters:[{key,nick,rating}]}
   );
   CREATE TABLE pvp_records (
     key TEXT PRIMARY KEY, nick TEXT NOT NULL, w INTEGER NOT NULL, l INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   ALTER TABLE rank_games ADD COLUMN season INTEGER NOT NULL DEFAULT 0;`,
];

// 운영자 승인이 필요한 마이그레이션(버전 -> 환경변수). 기존 DB(schema_version >= 1)에 이 버전을 적용하려면 그 변수 = '1'(또는 openDb 의 opts.allow).
// 새 DB(버전 0, :memory: 포함)는 게이트 없이 최신까지 만든다. 게이트에 걸리면 아무것도 적용하지 않고 오류로 시작을 멈춘다(docs/HANDOFF.md §12 래더 절)
export const GATED = { 3: 'LADDER_MIGRATE' };
export const gateMessage = (v, env, cur) => `DB 스키마 v${cur} -> v${v} 마이그레이션(래더)은 운영자 승인 뒤 ${env}=1 로 한 번 기동해야 적용됩니다. 적용하지 않고 시작을 멈춥니다(docs/HANDOFF.md §12).\n` +
  `DB schema v${cur} -> v${v} migration (ladder) needs ${env}=1 for one start after operator approval. Nothing was applied; refusing to start.`;

/** @param {string} file DB 파일 경로 또는 ':memory:' @param {{allow?: Record<number, boolean>}} [opts] 게이트 마이그레이션 허용(생략 = 환경변수) */
export function openDb(file, opts = {}) {
  if (!sqliteAvailable()) throw new Error(SQLITE_MISSING);
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); // mode 는 새로 만드는 폴더에만 적용
  const raw = new sqlite.DatabaseSync(file);
  if (file !== ':memory:') { raw.exec('PRAGMA journal_mode = WAL'); restrictPerms(file); }
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA synchronous = NORMAL');
  const cache = new Map();
  const st = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  let depth = 0;
  const db = {
    file,
    run: (sql, ...p) => st(sql).run(...p),
    get: (sql, ...p) => st(sql).get(...p) ?? null,
    all: (sql, ...p) => st(sql).all(...p),
    exec: (sql) => raw.exec(sql),
    /** 트랜잭션(중첩 호출은 바깥 트랜잭션에 합류) */
    tx(fn) {
      if (depth > 0) return fn();
      raw.exec('BEGIN IMMEDIATE'); depth++;
      try { const r = fn(); raw.exec('COMMIT'); return r; }
      catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
      finally { depth--; }
    },
    close() { cache.clear(); try { raw.close(); } catch { /* ignore */ } },
  };
  try { migrate(db, opts.allow); } catch (e) { db.close(); throw e; }
  return db;
}

/**
 * DB 파일 권한을 소유자 읽기·쓰기(0600)로 좁힌다(계정 해시·토큰 해시가 들어 있다). POSIX 에서만, Windows 는 권한 모델이 달라 건너뛴다.
 * 대상 = 본 파일 + 이 시점에 있는 -wal·-shm(WAL 모드 전환 직후라 보통 함께 생겨 있다). 나중에 SQLite 가 다시 만드는 -wal·-shm 은
 * SQLite 가 본 파일 권한을 따라 만든다. 실패해도 서버는 계속 뜬다(경고만)
 */
function restrictPerms(file) {
  if (process.platform === 'win32') return;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try { if (existsSync(f)) chmodSync(f, 0o600); } catch (e) { console.error(`[db] 권한 0600 설정 실패: ${f} (${e.message})`); }
  }
}

function migrate(db, allow) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const cur = db.get('SELECT MAX(version) AS v FROM schema_version')?.v ?? 0;
  if (cur > 0) { // 기존 DB: 게이트 버전이 남아 있고 허용이 없으면 하나도 적용하지 않는다
    for (let v = cur + 1; v <= MIGRATIONS.length; v++) {
      const env = GATED[v];
      if (env && !(allow?.[v] ?? process.env[env] === '1')) { const e = new Error(gateMessage(v, env, cur)); e.code = 'MIGRATION_GATED'; throw e; }
    }
  }
  for (let v = cur + 1; v <= MIGRATIONS.length; v++) {
    db.tx(() => { db.exec(MIGRATIONS[v - 1]); db.run('INSERT INTO schema_version (version) VALUES (?)', v); });
  }
}

export const schemaVersion = (db) => db.get('SELECT MAX(version) AS v FROM schema_version')?.v ?? 0;
