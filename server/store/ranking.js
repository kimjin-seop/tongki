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
   * 유효한 랭크 경기 1판 기록. players = [{key,nick,account?}, …](좌석 순, account 생략 = true), winner = 0|1, forfeit = 기권한 좌석|null.
   * 손님(account:false, 2026-11-20)은 레이팅 1000·저장 없음으로 상대 노릇만 한다: 계정 쪽만 레이팅·승패가 바뀌고 손님 행은 만들지 않는다.
   * rank_games 의 손님 키는 'guest:<키>'(NICK_RE 에 ':' 가 없어 계정 키와 겹치지 않는다. 나중에 같은 닉네임으로 가입해도 그 계정의 같은 상대 제한·기권 잠금에 섞이지 않게).
   * 반환 { counted, why?, before:[a,b], after:[a,b], delta:[a,b], seatCounted:[a,b] }. counted=false 면 레이팅·전적 불변(why:'PAIR_LIMIT'|'SAME_KEY'|'NO_ACCOUNT')
   */
  record({ matchId, players, winner, forfeit = null, now = Date.now() }) {
    return this.db.tx(() => {
      const acct = players.map((p) => p.account !== false);
      const [a, b] = players.map((p, i) => (acct[i] ? this.get(p.key, p.nick) : FRESH(p.key, p.nick)));
      a.nick = players[0].nick; b.nick = players[1].nick;
      const [ak, bk] = players.map((p, i) => (acct[i] ? p.key : `guest:${p.key}`));
      const before0 = [a.rating, b.rating];
      const none = (why) => ({ counted: false, why, before: before0, after: before0, delta: [0, 0], seatCounted: [false, false] });
      if (a.key === b.key) return none('SAME_KEY'); // 같은 사람끼리(자기 자신 상대 반복) 제외
      if (!acct[0] && !acct[1]) return none('NO_ACCOUNT');
      const n = this.db.get(`SELECT COUNT(*) AS n FROM rank_games WHERE counted = 1 AND at > ?
        AND ((a_key = ? AND b_key = ?) OR (a_key = ? AND b_key = ?))`, now - RANK.pairWindowMs, ak, bk, bk, ak).n;
      const counted = n < RANK.pairLimit;
      const before = [a.rating, b.rating];
      this.db.run('INSERT INTO rank_games (match_id, a_key, b_key, winner_key, forfeit_key, counted, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        String(matchId), ak, bk, winner === 0 ? ak : bk, forfeit === null ? null : (forfeit === 0 ? ak : bk), counted ? 1 : 0, now);
      if (counted) {
        const [ra, rb] = eloAfter(a, b, winner === 0);
        a.rating = ra; b.rating = rb;
        a.games++; b.games++;
        if (winner === 0) { a.w++; b.l++; } else { b.w++; a.l++; }
      }
      if (forfeit !== null && acct[forfeit]) { // 최근 10경기(반영 여부 무관) 중 자기 기권 3회 -> 30분 잠금(계정만)
        const f = forfeit === 0 ? a : b;
        const recent = this.db.all('SELECT forfeit_key FROM rank_games WHERE a_key = ? OR b_key = ? ORDER BY at DESC, id DESC LIMIT ?', f.key, f.key, RANK.forfeitWindow);
        if (recent.filter((r) => r.forfeit_key === f.key).length >= RANK.forfeitMax) f.lockUntil = now + RANK.lockMs;
      }
      if (acct[0]) this.#save(a, now);
      if (acct[1]) this.#save(b, now);
      if (!acct[0]) a.rating = before[0]; // 손님 쪽은 저장하지 않으므로 변동 0 으로 돌려준다
      if (!acct[1]) b.rating = before[1];
      const after = [a.rating, b.rating];
      return { counted, ...(counted ? {} : { why: 'PAIR_LIMIT' }), before, after, delta: [after[0] - before[0], after[1] - before[1]], seatCounted: acct.map((x) => counted && x) };
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
