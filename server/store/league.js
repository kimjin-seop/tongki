// 리그 저장소(닉네임당 리그 1개). 얇은 인터페이스: get(key) -> league|null, set(key, nick, league|null), flush().
// 곧 SQLite 계정 저장으로 옮길 예정이라 lobby 는 이 세 함수만 쓴다(구현을 바꿔 끼우면 된다).
// 파일 형식 { version:1, users:{ <소문자 닉네임>: { nick, league, updatedAt } } }. 임시 파일에 쓴 뒤 rename(원자적 교체),
// 읽기 실패(JSON 손상)면 원본을 <file>.corrupt-<시각> 으로 보존하고 빈 상태로 시작, 형식이 틀린 항목은 버린다(progress.js 와 같은 패턴).
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { sanitize } from '../league/rules.js';

export const MAX_LEAGUE_USERS = 5000; // 영속 항목 상한(넘으면 가장 오래 갱신 안 된 항목부터 정리)
const FLUSH_MS = 100;

const clone = (v) => (v == null ? null : structuredClone(v));

class Base {
  constructor() { this.users = new Map(); }
  get(key) { return clone(this.users.get(key)?.league ?? null); }
  set(key, nick, league) {
    if (!league) this.users.delete(key);
    else {
      this.users.delete(key); // 삽입 순서 = 갱신 순서(상한 정리용)
      this.users.set(key, { nick, league: clone(league), updatedAt: Date.now() });
      while (this.users.size > MAX_LEAGUE_USERS) this.users.delete(this.users.keys().next().value);
    }
    this.persist();
  }
  persist() {}
  flush() {}
}

export class MemoryLeagueStore extends Base {}

const live = new Set();
let exitHooked = false;
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on('exit', () => { for (const s of live) s.flush(); });
}

export class JsonLeagueStore extends Base {
  constructor(file) {
    super();
    this.file = file; this.timer = null; this.dirty = false;
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
      try { renameSync(file, bak); console.error(`[league] 파일 손상, 원본 보존: ${bak} (${e.message})`); }
      catch (e2) { console.error('[league] 파일 손상, 원본 보존 실패', e2.message); }
      return;
    }
    if (!j || typeof j.users !== 'object' || j.users === null) return;
    const rows = Object.entries(j.users).sort((a, b) => (a[1]?.updatedAt ?? 0) - (b[1]?.updatedAt ?? 0));
    for (const [k, v] of rows) {
      const league = sanitize(v?.league);
      if (!league) { console.error('[league] 잘못된 항목 무시', k); continue; }
      this.users.set(k, { nick: String(v.nick ?? k), league, updatedAt: Number(v.updatedAt) || 0 });
    }
    while (this.users.size > MAX_LEAGUE_USERS) this.users.delete(this.users.keys().next().value);
  }
  persist() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, FLUSH_MS);
    this.timer.unref?.();
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, users: Object.fromEntries(this.users) }), 'utf8');
      renameSync(tmp, this.file);
    } catch (e) { console.error('[league] 저장 실패', e.message); }
  }
}
