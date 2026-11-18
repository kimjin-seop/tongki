// 랭킹 저장(SQLite, db.js 래퍼). ratings = 계정별 레이팅·전적·잠금, rank_games = 반영 판정용 경기 기록(같은 상대 제한·기권 잠금).
import { RANK, eloAfter } from '../ranking/elo.js';

const FRESH = (key, nick) => ({ key, nick, rating: RANK.init, w: 0, l: 0, games: 0, lockUntil: 0 });

export class RankingStore {
  /** @param {ReturnType<import('./db.js').openDb>} db */
  constructor(db) { this.db = db; }

  get(key, nick = key) {
    const r = this.db.get('SELECT key, nick, rating, w, l, games, lock_until FROM ratings WHERE key = ? AND season = ?', key, RANK.season);
    return r ? { key: r.key, nick: r.nick, rating: r.rating, w: r.w, l: r.l, games: r.games, lockUntil: r.lock_until } : FRESH(key, nick);
  }

  lockedUntil(key, now = Date.now()) { const u = this.get(key).lockUntil; return u > now ? u : 0; }

  #save(p, now) {
    this.db.run(`INSERT INTO ratings (key, nick, rating, w, l, games, season, lock_until, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET nick = excluded.nick, rating = excluded.rating, w = excluded.w, l = excluded.l, games = excluded.games,
        lock_until = excluded.lock_until, updated_at = excluded.updated_at`,
    p.key, p.nick, p.rating, p.w, p.l, p.games, RANK.season, p.lockUntil, now);
  }

  /**
   * 유효한 랭크 경기 1판 기록. players = [{key,nick}, {key,nick}](좌석 순), winner = 0|1, forfeit = 기권한 좌석|null.
   * 반환 { counted, why?, before:[a,b], after:[a,b], delta:[a,b] }. counted=false 면 레이팅·전적 불변(why:'PAIR_LIMIT')
   */
  record({ matchId, players, winner, forfeit = null, now = Date.now() }) {
    return this.db.tx(() => {
      const [a, b] = players.map((p) => this.get(p.key, p.nick));
      a.nick = players[0].nick; b.nick = players[1].nick;
      const n = this.db.get(`SELECT COUNT(*) AS n FROM rank_games WHERE counted = 1 AND at > ?
        AND ((a_key = ? AND b_key = ?) OR (a_key = ? AND b_key = ?))`, now - RANK.pairWindowMs, a.key, b.key, b.key, a.key).n;
      const counted = n < RANK.pairLimit;
      const before = [a.rating, b.rating];
      this.db.run('INSERT INTO rank_games (match_id, a_key, b_key, winner_key, forfeit_key, counted, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        String(matchId), a.key, b.key, winner === 0 ? a.key : b.key, forfeit === null ? null : players[forfeit].key, counted ? 1 : 0, now);
      if (counted) {
        const [ra, rb] = eloAfter(a, b, winner === 0);
        a.rating = ra; b.rating = rb;
        a.games++; b.games++;
        if (winner === 0) { a.w++; b.l++; } else { b.w++; a.l++; }
      }
      if (forfeit !== null) { // 최근 10경기(반영 여부 무관) 중 자기 기권 3회 -> 30분 잠금
        const f = forfeit === 0 ? a : b;
        const recent = this.db.all('SELECT forfeit_key FROM rank_games WHERE a_key = ? OR b_key = ? ORDER BY at DESC, id DESC LIMIT ?', f.key, f.key, RANK.forfeitWindow);
        if (recent.filter((r) => r.forfeit_key === f.key).length >= RANK.forfeitMax) f.lockUntil = now + RANK.lockMs;
      }
      this.#save(a, now); this.#save(b, now);
      const after = [a.rating, b.rating];
      return { counted, ...(counted ? {} : { why: 'PAIR_LIMIT' }), before, after, delta: [after[0] - before[0], after[1] - before[1]] };
    });
  }

  /** 순위표: 5경기 이상만, 레이팅 내림차순(같으면 같은 순위). me = 내 줄(5경기 미만이면 rank:null, placement:true) */
  board(top = RANK.boardTop, meKey = null, meNick = meKey) {
    const rows = this.db.all(`SELECT nick, rating, w, l FROM ratings WHERE season = ? AND games >= ?
      ORDER BY rating DESC, w DESC, key ASC LIMIT ?`, RANK.season, RANK.boardMinGames, top);
    let prev = null, rank = 0;
    const list = rows.map((r, i) => { if (r.rating !== prev) { rank = i + 1; prev = r.rating; } return { rank, nick: r.nick, rating: r.rating, w: r.w, l: r.l }; });
    let me = null;
    if (meKey) {
      const m = this.get(meKey, meNick);
      const placement = m.games < RANK.boardMinGames;
      const above = placement ? null : this.db.get('SELECT COUNT(*) AS n FROM ratings WHERE season = ? AND games >= ? AND rating > ?', RANK.season, RANK.boardMinGames, m.rating).n;
      me = { rank: placement ? null : above + 1, nick: m.nick, rating: m.rating, w: m.w, l: m.l, games: m.games, placement };
    }
    return { top: list, me };
  }
}
