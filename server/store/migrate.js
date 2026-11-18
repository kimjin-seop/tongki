// 기존 JSON 저장(progress.json·league.json) -> SQLite 가져오기. 멱등: 파일별 meta 표식(파일 크기·수정 시각)이 같으면 건너뛴다.
// 파일이 그 뒤 바뀌었으면(옛 JSON 서버가 계속 쓴 경우) 다시 합친다. 합치기 규칙(PROTOCOL §11.5 와 같다):
//  - 키(소문자 닉네임)마다 처음 가져올 때만 새 행을 넣는다. 가져온 키는 meta(`json_imported:<종류>:<키>`)에 남기고, 그 뒤 재가져오기에서는
//    DB 에 행이 남아 있을 때만 고친다(행이 없으면 다시 넣지 않음 = 리그 포기·손님 데이터 분리 보존 뒤 부활 없음).
//  - 고치는 조건: 진행은 clearedMax 가 더 클 때만, 리그는 JSON updatedAt 이 DB updated_at 보다 새로울 때만(DB 값을 옛 값으로 덮지 않음).
//  - 가입된 계정 키는 건너뛴다(계정 데이터는 DB 에서만 바뀐다. 같은 닉네임 손님 JSON 이 계정에 섞이지 않게).
// 원본 JSON 은 지우거나 바꾸지 않는다. 처음 가져올 때 원본을 backupDir 에 복사해 둔다.
// 직접 실행(복사본으로 시험할 때): node server/store/migrate.js --db <tongki.db> --progress <progress.json> --league <league.json> [--backup <dir>]
import { existsSync, readFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitize } from '../league/rules.js';

const validK = (v) => Number.isInteger(v) && v >= 0 && v <= 14;

function readJson(file, log) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { log(`[migrate] ${file} 읽기 실패, 건너뜀 (${e.message})`); return null; }
}

/**
 * @param {ReturnType<import('./db.js').openDb>} db
 * @param {{progressFile?:string, leagueFile?:string, backupDir?:string, log?:Function}} o
 * @returns {{progress:number, leagues:number, skipped:string[]}}
 */
export function importJson(db, o = {}) {
  const log = o.log ?? ((...a) => console.error(...a));
  const out = { progress: 0, leagues: 0, skipped: [] };
  let accountSkipped = 0; // 계정 키라 건너뛴 항목 수(로그용)
  const isAccount = (key) => !!db.get('SELECT 1 AS x FROM accounts WHERE key = ?', key);
  const MARK = "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO NOTHING";
  /** 키 하나 합치기: 처음이면 upsert(조건부) + 기록, 가져온 적 있으면 기존 행 조건부 갱신만. 반환 = 바뀐 행 수 */
  const merge = (kind, key, upsert, update, args) => {
    if (isAccount(key)) { accountSkipped++; return 0; }
    const mk = `json_imported:${kind}:${key}`;
    if (db.get('SELECT 1 AS x FROM meta WHERE k = ?', mk)) return Number(db.run(update, ...args).changes);
    const n = Number(db.run(upsert, ...args).changes);
    db.run(MARK, mk, String(Date.now()));
    return n;
  };
  const jobs = [
    ['progress', o.progressFile, (j) => {
      for (const [k, v] of Object.entries(j.users)) {
        if (!validK(v?.clearedMax)) continue; // 클리어 없음(-1)·잘못된 항목은 가져오지 않는다
        const key = String(k).toLowerCase();
        out.progress += merge('progress', key,
          `INSERT INTO progress (key, nick, cleared_max, last, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(key) DO UPDATE SET cleared_max = excluded.cleared_max, nick = excluded.nick, updated_at = excluded.updated_at
            WHERE excluded.cleared_max > progress.cleared_max`,
          'UPDATE progress SET cleared_max = ?3, nick = ?2, updated_at = ?5 WHERE key = ?1 AND cleared_max < ?3',
          [key, String(v.nick ?? k), v.clearedMax, validK(v.last) ? v.last : null, Number(v.updatedAt) || 0]);
      }
    }],
    ['league', o.leagueFile, (j) => {
      for (const [k, v] of Object.entries(j.users)) {
        const lg = sanitize(v?.league);
        if (!lg) continue;
        const key = String(k).toLowerCase();
        out.leagues += merge('league', key,
          `INSERT INTO leagues (key, nick, data, updated_at) VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(key) DO UPDATE SET nick = excluded.nick, data = excluded.data, updated_at = excluded.updated_at WHERE excluded.updated_at > leagues.updated_at`,
          'UPDATE leagues SET nick = ?2, data = ?3, updated_at = ?4 WHERE key = ?1 AND updated_at < ?4',
          [key, String(v.nick ?? k), JSON.stringify(lg), Number(v.updatedAt) || 0]);
      }
    }],
  ];
  for (const [name, file, apply] of jobs) {
    if (!file || !existsSync(file)) continue;
    const mark = `json_import:${name}`;
    const st = statSync(file);
    const ver = { size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
    const prev = db.get('SELECT v FROM meta WHERE k = ?', mark);
    let pv = null; try { pv = prev && JSON.parse(prev.v); } catch { /* 표식 손상 = 다시 합친다 */ }
    if (pv && pv.size === ver.size && pv.mtimeMs === ver.mtimeMs) { out.skipped.push(name); continue; }
    const j = readJson(file, log);
    if (!j || typeof j.users !== 'object' || j.users === null) continue;
    if (o.backupDir && !prev) {
      try { mkdirSync(o.backupDir, { recursive: true }); copyFileSync(file, path.join(o.backupDir, path.basename(file))); }
      catch (e) { log(`[migrate] 백업 실패, 가져오기 중단: ${name} (${e.message})`); continue; }
    }
    db.tx(() => {
      apply(j);
      db.run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', mark, JSON.stringify({ file: path.resolve(file), ...ver, at: Date.now() }));
    });
  }
  if (accountSkipped) log(`[migrate] 가입된 계정 닉네임 ${accountSkipped}건은 JSON 에서 가져오지 않음`);
  if (out.progress || out.leagues) log(`[migrate] JSON -> SQLite: 진행 ${out.progress}건, 리그 ${out.leagues}건`);
  return out;
}

const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === selfPath) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const { openDb } = await import('./db.js');
  const dbFile = arg('db');
  if (!dbFile) { console.error('사용법: node server/store/migrate.js --db <파일> --progress <json> --league <json> [--backup <dir>]'); process.exit(2); }
  const db = openDb(dbFile);
  const r = importJson(db, { progressFile: arg('progress'), leagueFile: arg('league'), backupDir: arg('backup') });
  console.log(JSON.stringify(r));
  db.close();
}
