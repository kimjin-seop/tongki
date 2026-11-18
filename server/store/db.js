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
];

/** @param {string} file DB 파일 경로 또는 ':memory:' */
export function openDb(file) {
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
  migrate(db);
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

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const cur = db.get('SELECT MAX(version) AS v FROM schema_version')?.v ?? 0;
  for (let v = cur + 1; v <= MIGRATIONS.length; v++) {
    db.tx(() => { db.exec(MIGRATIONS[v - 1]); db.run('INSERT INTO schema_version (version) VALUES (?)', v); });
  }
}

export const schemaVersion = (db) => db.get('SELECT MAX(version) AS v FROM schema_version')?.v ?? 0;
