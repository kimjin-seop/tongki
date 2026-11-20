// 래더 저장(SQLite, db.js 래퍼, 스키마 v3). ratings = 계정·시즌별 레이팅·전적·표시 티어·잠금, rank_games = 반영 판정용 경기 기록(같은 상대 제한·기권 잠금),
// ladder_seasons = 시즌 번호·기간·종료 확정값, pvp_records = 사람끼리 모든 멀티 경기 전적(시즌 무관, 계정만). 규칙 값은 server/ranking/elo.js LADDER.
import { LADDER, TIERS, eloAfter, tierOf, nextTier, seasonReset, masterQuota, seasonMs } from '../ranking/elo.js';

const DAY = 86400000;
const BADGE_TTL_MS = 60000, BADGE_MAX = 2000; // 방 목록 호스트 요약 캐시(hostBadges)
const fresh = (key, nick, season) => ({ key, nick, season, rating: LADDER.init, w: 0, l: 0, games: 0, tier: tierOf(LADDER.init), lockUntil: 0, lastGameAt: 0 });
const rowOf = (r) => ({ key: r.key, nick: r.nick, season: r.season, rating: r.rating, w: r.w, l: r.l, games: r.games, tier: r.tier, lockUntil: r.lock_until, lastGameAt: r.last_game_at });
/** 화면에 보일 티어: 배치 중이면 null, 마스터면 'master' */
const shownTier = (p, master = false) => (p.games < LADDER.placementGames ? null : master ? 'master' : p.tier);

export class RankingStore {
  /** @param {ReturnType<import('./db.js').openDb>} db */
  constructor(db) { this.db = db; this.cur = null; this.ver = 0; this.badges = new Map(); } // ver = 래더·전적 쓰기 판번호(방 목록 호스트 요약 캐시 무효화)

  // ---------- 시즌 ----------
  /**
   * 지금 시즌 {season, startedAt, endsAt}. 시즌 표가 비어 있으면 시즌 1 을 now 에 연다(종전 랭크 기록은 v3 에서 보관 표로 옮겨져 전원 1000 시작).
   * now 가 종료 시각을 지났으면 시즌을 닫고(마스터 확정) 다음 시즌을 연다(이전 종료 시각부터 28일 단위, 서버가 꺼져 있던 동안 여러 시즌이 지났으면 그만큼 반복)
   */
  season(now = Date.now()) {
    if (this.cur && now < this.cur.endsAt) return this.cur;
    return this.db.tx(() => {
      let r = this.db.get('SELECT season, started_at, ends_at FROM ladder_seasons WHERE closed_at IS NULL ORDER BY season DESC LIMIT 1');
      if (!r) {
        const n = (this.db.get('SELECT MAX(season) AS n FROM ladder_seasons')?.n ?? 0) + 1;
        this.db.run('INSERT INTO ladder_seasons (season, started_at, ends_at) VALUES (?, ?, ?)', n, now, now + seasonMs());
        r = { season: n, started_at: now, ends_at: now + seasonMs() };
      }
      while (now >= r.ends_at) r = this.#rollover(r);
      this.cur = { season: r.season, startedAt: r.started_at, endsAt: r.ends_at };
      return this.cur;
    });
  }

  /** 시즌 종료 처리: 마스터 확정·기록 -> 다음 시즌 행 + 전원 소프트 리셋(레이팅 1000 쪽으로 resetFactor, 판수·승패 0 = 배치·K48 다시, 잠금 유지). 이전 시즌 행은 남긴다 */
  #rollover(r) {
    const end = r.ends_at, next = r.season + 1;
    const fin = this.#standings(r.season, end);
    this.db.run('UPDATE ladder_seasons SET closed_at = ?, final = ? WHERE season = ?', end, JSON.stringify({ players: fin.players, masters: fin.masters.map((m) => ({ key: m.key, nick: m.nick, rating: m.rating })) }), r.season);
    this.db.run('INSERT INTO ladder_seasons (season, started_at, ends_at) VALUES (?, ?, ?)', next, end, end + seasonMs());
    this.ver++;
    for (const p of this.db.all('SELECT key, nick, rating, lock_until, last_game_at FROM ratings WHERE season = ?', r.season)) {
      const nr = seasonReset(p.rating);
      this.db.run(`INSERT INTO ratings (key, season, nick, rating, w, l, games, tier, lock_until, last_game_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)
        ON CONFLICT(key, season) DO NOTHING`, p.key, next, p.nick, nr, tierOf(nr), p.lock_until, p.last_game_at, end);
    }
    return { season: next, started_at: end, ends_at: end + seasonMs() };
  }

  /** 시즌 순위(배치 완료·비활동 아님) + 마스터. 반환 {rows(순서대로, rank·master 포함), players, masters} */
  #standings(season, now) {
    const rows = this.db.all(`SELECT r.key, r.nick, r.rating, r.w, r.l, r.games, r.tier, r.last_game_at, COALESCE(p.w, 0) AS pw, COALESCE(p.l, 0) AS pl
      FROM ratings r LEFT JOIN pvp_records p ON p.key = r.key
      WHERE r.season = ? AND r.games >= ? AND r.last_game_at >= ? ORDER BY r.rating DESC, r.w DESC, r.key ASC`, season, LADDER.placementGames, now - LADDER.inactiveDays * DAY);
    const M = LADDER.master, quota = masterQuota(rows.length);
    const masters = rows.filter((x) => x.rating >= M.minRating && x.games >= M.minGames).slice(0, quota);
    const mk = new Set(masters.map((m) => m.key));
    let prev = null, rank = 0;
    rows.forEach((x, i) => { if (x.rating !== prev) { rank = i + 1; prev = x.rating; } x.rank = rank; x.master = mk.has(x.key); });
    return { rows, players: rows.length, masters, quota };
  }

  // ---------- 조회 ----------
  get(key, nick = key, now = Date.now()) {
    const S = this.season(now).season;
    const r = this.db.get('SELECT key, nick, season, rating, w, l, games, tier, lock_until, last_game_at FROM ratings WHERE key = ? AND season = ?', key, S);
    return r ? rowOf(r) : fresh(key, nick, S);
  }

  lockedUntil(key, now = Date.now()) { const u = this.get(key, key, now).lockUntil; return u > now ? u : 0; }

  /** 화면용 내 래더 상태(계정). 순위는 순위표와 같은 기준(배치 중·비활동이면 null) */
  status(key, nick = key, now = Date.now()) {
    const p = this.get(key, nick, now);
    const st = p.games >= LADDER.placementGames ? this.#standings(p.season, now) : null;
    const me = st?.rows.find((x) => x.key === key) ?? null;
    return {
      rating: p.rating, tier: shownTier(p, !!me?.master), games: p.games, w: p.w, l: p.l,
      placement: p.games < LADDER.placementGames, placementLeft: Math.max(0, LADDER.placementGames - p.games),
      rank: me?.rank ?? null, inactive: p.games >= LADDER.placementGames && !me, master: !!me?.master,
      lockUntil: p.lockUntil > now ? p.lockUntil : 0, pvp: this.pvp(key),
    };
  }

  /** 사람끼리 전적(시즌 무관) */
  pvp(key) { const r = this.db.get('SELECT w, l FROM pvp_records WHERE key = ?', key); return { w: r?.w ?? 0, l: r?.l ?? 0 }; }

  /** 24시간 안에 반영된 두 키(rank_games 키: 계정 = 키, 손님 = 'guest:<키>') 사이 경기 수 */
  pairCount(ak, bk, now = Date.now()) {
    return this.db.get(`SELECT COUNT(*) AS n FROM rank_games WHERE counted = 1 AND at > ?
      AND ((a_key = ? AND b_key = ?) OR (a_key = ? AND b_key = ?))`, now - LADDER.pairWindowMs, ak, bk, bk, ak).n;
  }

  #save(p, now) {
    this.db.run(`INSERT INTO ratings (key, season, nick, rating, w, l, games, tier, lock_until, last_game_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key, season) DO UPDATE SET nick = excluded.nick, rating = excluded.rating, w = excluded.w, l = excluded.l, games = excluded.games,
        tier = excluded.tier, lock_until = excluded.lock_until, last_game_at = excluded.last_game_at, updated_at = excluded.updated_at`,
    p.key, p.season, p.nick, p.rating, p.w, p.l, p.games, p.tier, p.lockUntil, p.lastGameAt, now);
  }

  #pvpAdd(key, nick, won, now) {
    this.ver++;
    this.db.run(`INSERT INTO pvp_records (key, nick, w, l, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET nick = excluded.nick, w = w + excluded.w, l = l + excluded.l, updated_at = excluded.updated_at`, key, nick, won ? 1 : 0, won ? 0 : 1, now);
  }

  /**
   * 사람끼리 일반 멀티 경기(래더 아님) 1판의 전적. players = [{key,nick,account}, …](좌석 순), winner = 0|1. 계정 좌석만 쓴다(손님은 저장 없음). 레이팅은 바뀌지 않는다
   */
  recordPvp({ players, winner, now = Date.now() }) {
    if (players[0].key === players[1].key) return;
    this.db.tx(() => { players.forEach((p, i) => { if (p.account !== false) this.#pvpAdd(p.key, p.nick, i === winner, now); }); });
  }

  /**
   * 래더 경기 1판 기록. players = [{key,nick,account?}, …](좌석 순, account 생략 = true), winner = 0|1, forfeit = 기권한 좌석|null.
   * 2026-11-20 사용자 결정으로 래더는 계정만(ladder_join 이 손님을 ACCOUNT_REQUIRED 로 거절) -> 아래 손님 분기(K16·guest: 키·vsGuest)는 지금 도달 불가, 미래 대비로 남긴다(회귀 시험 test/accounts.test.js).
   * 손님(account:false)은 레이팅 1000·저장 없음으로 상대 노릇만 한다: 계정 쪽만 바뀌고 그 경기 계정 K = 16. rank_games 의 손님 키는 'guest:<키>'.
   * 반영되면 승패·판수·표시 티어(완충)·마지막 경기 시각이 바뀐다. 같은 상대 제한(PAIR_LIMIT)이어도 사람끼리 전적(pvp_records)은 오른다.
   * 반환 { counted, why?, before, after, delta, seatCounted, tierBefore, tier, placement, placementLeft, season }(좌석별 배열, 손님 좌석 티어 null).
   * counted=false 면 레이팅·래더 전적 불변(why:'PAIR_LIMIT'|'SAME_KEY'|'NO_ACCOUNT')
   */
  record({ matchId, players, winner, forfeit = null, now = Date.now() }) {
    const S = this.season(now).season;
    return this.db.tx(() => {
      const acct = players.map((p) => p.account !== false);
      const ps = players.map((p, i) => (acct[i] ? { ...this.get(p.key, p.nick, now), nick: p.nick } : { ...fresh(p.key, p.nick, S), guest: true }));
      const [a, b] = ps;
      const [ak, bk] = players.map((p, i) => (acct[i] ? p.key : `guest:${p.key}`));
      const before = [a.rating, b.rating];
      // 표시 티어는 ladder_status·순위표와 같게 마스터(순위 조건, 실시간)를 반영한다: 경기 전 = 기록 전 순위, 경기 후 = 저장 뒤 순위
      const masterKeys = () => new Set(this.#standings(S, now).masters.map((m) => m.key));
      const mBefore = masterKeys();
      const tierBefore = ps.map((p, i) => (acct[i] ? shownTier(p, mBefore.has(p.key)) : null));
      const pack = (counted, why) => { const mAfter = masterKeys(); return {
        counted, ...(why ? { why } : {}), before, after: ps.map((p, i) => (acct[i] ? p.rating : before[i])),
        delta: ps.map((p, i) => (acct[i] ? p.rating - before[i] : 0)), seatCounted: acct.map((x) => counted && x),
        tierBefore, tier: ps.map((p, i) => (acct[i] ? shownTier(p, mAfter.has(p.key)) : null)),
        placement: ps.map((p, i) => (acct[i] ? p.games < LADDER.placementGames : null)),
        placementLeft: ps.map((p, i) => (acct[i] ? Math.max(0, LADDER.placementGames - p.games) : null)), season: S,
      }; };
      if (a.key === b.key) return pack(false, 'SAME_KEY'); // 같은 사람끼리 제외
      if (!acct[0] && !acct[1]) return pack(false, 'NO_ACCOUNT');
      const counted = this.pairCount(ak, bk, now) < LADDER.pairLimit;
      this.db.run('INSERT INTO rank_games (match_id, a_key, b_key, winner_key, forfeit_key, counted, at, season) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        String(matchId), ak, bk, winner === 0 ? ak : bk, forfeit === null ? null : (forfeit === 0 ? ak : bk), counted ? 1 : 0, now, S);
      this.ver++; // 반영 여부와 무관하게 표시 값(마스터·전적)이 바뀔 수 있다
      if (counted) {
        const [ra, rb] = eloAfter(a, b, winner === 0);
        a.rating = ra; b.rating = rb;
        for (const [i, p] of ps.entries()) {
          if (!acct[i]) continue;
          p.games++; if (winner === i) p.w++; else p.l++;
          p.lastGameAt = now;
          // 배치 끝(5판째) = 레이팅으로 바로 정하고, 그 뒤로는 완충 규칙. 배치 중에는 숨김이라 레이팅 기준 값만 둔다
          p.tier = p.games <= LADDER.placementGames ? tierOf(p.rating) : nextTier(p.tier, p.rating);
        }
      }
      if (forfeit !== null && acct[forfeit]) { // 최근 10경기(반영 여부 무관) 중 자기 기권 3회 -> 30분 잠금(계정만)
        const f = ps[forfeit];
        const recent = this.db.all('SELECT forfeit_key FROM rank_games WHERE a_key = ? OR b_key = ? ORDER BY at DESC, id DESC LIMIT ?', f.key, f.key, LADDER.forfeitWindow);
        if (recent.filter((r) => r.forfeit_key === f.key).length >= LADDER.forfeitMax) f.lockUntil = now + LADDER.lockMs;
      }
      for (const [i, p] of ps.entries()) if (acct[i]) { this.#save(p, now); this.#pvpAdd(p.key, p.nick, winner === i, now); }
      return pack(counted, counted ? null : 'PAIR_LIMIT');
    });
  }

  /**
   * 순위표: 지금 시즌, 배치 완료(5판 이상)·최근 14일 안에 경기한 계정만, 레이팅 내림차순(같으면 같은 순위). 마스터는 순위 조건(실시간).
   * me = 내 줄(배치 중이면 rank:null·placement:true, 비활동이면 rank:null·inactive:true)
   */
  board(top = LADDER.boardTop, meKey = null, meNick = meKey, now = Date.now()) {
    const S = this.season(now);
    const st = this.#standings(S.season, now);
    const line = (x) => ({ rank: x.rank, nick: x.nick, rating: x.rating, w: x.w, l: x.l, tier: x.master ? 'master' : x.tier, pvp: { w: x.pw, l: x.pl } });
    const list = st.rows.slice(0, top).map(line);
    let me = null;
    if (meKey) {
      const m = this.get(meKey, meNick, now);
      const row = st.rows.find((x) => x.key === meKey);
      const placement = m.games < LADDER.placementGames;
      me = { rank: row?.rank ?? null, nick: m.nick, rating: m.rating, w: m.w, l: m.l, games: m.games, placement, placementLeft: Math.max(0, LADDER.placementGames - m.games),
        tier: shownTier(m, !!row?.master), inactive: !placement && !row, pvp: this.pvp(meKey) };
    }
    return { season: { n: S.season, startedAt: S.startedAt, endsAt: S.endsAt }, total: st.players, masterQuota: st.quota, top: list, me };
  }

  /**
   * 전체 랭킹(PROTOCOL §11.6, 시즌 무관 누적 = 래더 + 일반 사람끼리 방): pvp_records 중 accounts 에 있는 계정만.
   * 정렬 = 승 내림차순 -> 승률 rate(천분율 정수 floor(w*1000/(w+l))) 내림차순 -> 판수 내림차순 -> 닉네임(코드포인트 순) -> 키. 승·승률·판수가 모두 같으면 같은 rank(1,1,3 식).
   * 색인 없음(행 수 = 사람끼리 경기를 한 계정 수, 정렬은 LIMIT 상위 N 정렬기, 내 순위는 COUNT 1회. 근거 docs/PROTOCOL.md §11.6)
   * me = meKey 가 있으면 내 줄(전적 없으면 rank:null·0), 없으면(손님) null
   */
  pvpBoard(top = LADDER.boardTop, meKey = null, meNick = meKey) {
    const B = `SELECT p.key, a.nick, p.w, p.l, p.w + p.l AS games, CASE WHEN p.w + p.l > 0 THEN (p.w * 1000) / (p.w + p.l) ELSE 0 END AS rate
      FROM pvp_records p JOIN accounts a ON a.key = p.key WHERE p.w + p.l > 0`;
    const rows = this.db.all(`SELECT * FROM (${B}) ORDER BY w DESC, rate DESC, games DESC, nick ASC, key ASC LIMIT ?`, top);
    const same = (x, y) => x.w === y.w && x.rate === y.rate && x.games === y.games;
    const list = rows.map((x, i) => ({ rank: i + 1, nick: x.nick, w: x.w, l: x.l, games: x.games, rate: x.rate, _x: x }));
    list.forEach((e, i) => { if (i && same(e._x, list[i - 1]._x)) e.rank = list[i - 1].rank; });
    const total = this.db.get(`SELECT COUNT(*) AS n FROM (${B})`).n;
    let me = null;
    if (meKey) {
      const r = this.db.get(`SELECT * FROM (${B}) WHERE key = ?`, meKey);
      me = r
        ? { rank: 1 + this.db.get(`SELECT COUNT(*) AS n FROM (${B}) WHERE w > ? OR (w = ? AND (rate > ? OR (rate = ? AND games > ?)))`, r.w, r.w, r.rate, r.rate, r.games).n,
          nick: r.nick, w: r.w, l: r.l, games: r.games, rate: r.rate }
        : { rank: null, nick: meNick, w: 0, l: 0, games: 0, rate: 0 };
    }
    return { top: list.map(({ _x, ...e }) => e), me, total };
  }

  /**
   * 방 목록 행의 호스트 요약(PROTOCOL §3 room_list, 공개 값만). keys = 계정 키 배열 -> Map(key -> {tier, rating, w, l} | 배치 중 {tier:null, placing:true, rating, w, l}).
   * tier 는 status()(ladder_status) 와 같은 계산(마스터 포함), w/l = pvp_records 누적(전체 랭킹과 같은 값).
   * 캐시: 키별 값을 쓰기 판번호(ver: record·recordPvp·시즌 넘김마다 +1)·시즌이 같고 TTL(BADGE_TTL_MS, 비활동 14일 경계 같은 시간 변화용) 안이면 그대로 쓴다.
   * 빗나간 키가 있으면 순위(#standings)는 한 번만 계산해 함께 쓴다(호스트 수만큼 전체 표를 다시 읽지 않게)
   */
  hostBadges(keys, now = Date.now()) {
    const S = this.season(now).season, out = new Map(), miss = [];
    for (const k of keys) {
      const c = this.badges.get(k);
      if (c && c.ver === this.ver && c.season === S && now - c.at < BADGE_TTL_MS) out.set(k, c.v); else miss.push(k);
    }
    if (!miss.length) return out;
    let mk = null;
    const masters = () => (mk ??= new Set(this.#standings(S, now).masters.map((m) => m.key)));
    for (const k of miss) {
      const p = this.get(k, k, now), pv = this.pvp(k);
      const placing = p.games < LADDER.placementGames;
      const v = placing ? { tier: null, placing: true, rating: p.rating, w: pv.w, l: pv.l } : { tier: shownTier(p, masters().has(k)), rating: p.rating, w: pv.w, l: pv.l };
      this.badges.set(k, { v, ver: this.ver, season: S, at: now });
      out.set(k, v);
    }
    if (this.badges.size > BADGE_MAX) for (const [k, c] of this.badges) if (c.ver !== this.ver || now - c.at >= BADGE_TTL_MS || this.badges.size > BADGE_MAX) this.badges.delete(k); // 오래된 것부터 정리(상한)
    return out;
  }

  /** 지난 시즌 확정값(없으면 null) */
  seasonFinal(n) {
    const r = this.db.get('SELECT season, started_at, ends_at, closed_at, final FROM ladder_seasons WHERE season = ?', n);
    if (!r) return null;
    let final = null; try { final = r.final ? JSON.parse(r.final) : null; } catch { /* 손상 = 없음 */ }
    return { season: r.season, startedAt: r.started_at, endsAt: r.ends_at, closedAt: r.closed_at, final };
  }
}

export { TIERS };
