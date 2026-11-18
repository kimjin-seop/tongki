// 리그(闘球リーグ, 혼자 + 컴퓨터) 순수 규칙. 근거 analysis/29 §2·§4-3, analysis/32 §2-2, 확정본 analysis/33 A.
// 저장 형식: league = { id, teams:[{team, com}], turns, rules:{mode, time}, res:[[[승,패] x n] x n], done, createdAt, updatedAt }
// 파생 값(w, l, rate, left, rank)은 저장하지 않고 derive() 로 계산한다.

/** 즉시 판정 K = 7 * 16 * b, b 는 원작 버그 값(관측 127/162). 확정 결정 6: 14224 고정 */
export const QUICK_K = 14224;
/** 확정 결정 3: 마지막 경기 뒤에도 저장하고 done=true. 원작 엄격 적용(마지막 경기 전 상태 유지)은 false 로 */
export const SAVE_AFTER_FINAL = true;
/** 확정 결정 5: 리그 컴퓨터 난이도 레벨 2 고정 */
export const LEAGUE_CPU_LEVEL = 2;
/** 확정 결정 4: SPECIAL 7팀 해금 = 스토리 14번째 경기 승리(analysis/32 §0 정정 2) */
export const SPECIAL_UNLOCK_CLEARED = 13;

export const NORMAL_TEAMS = 15;        // 팀 0~14 = 기본 15팀 격자
export const SPECIAL_TEAMS = [15, 21]; // 팀 15~21 = SPECIAL TEAM 줄(CHN URS EGY GRE BRA CHI USA). 22·23·24 는 리그 불가
export const MAX_LEAGUE_TEAM = 21;
export const MIN_TEAMS = 2, MAX_TEAMS = 6, MIN_TURNS = 1, MAX_TURNS = 9;
export const MAX_HUMANS = 1;           // 확정 결정 1
// 원작 규칙 창 조합 4가지(analysis/29 §3-1): ノックアウト+무제한, こうしき+3/5/8분
const OFFICIAL_TIMES = [3, 5, 8];

/** 홈 스테이지 표 ROM 0x1257A(팀 0~23 -> ROM 스테이지 번호, analysis/32 §2-2). campaign.json 15행의 상대 팀 -> romStage 와 전부 일치 */
export const HOME_ROM_STAGE = [1, 1, 2, 2, 8, 3, 7, 9, 6, 0, 4, 10, 11, 12, 5, 6, 0, 4, 10, 11, 12, 5, 6, 6];

/** 레이팅 식(ROM 0x3460). 선수 7명 x 능력치 8개, 16비트로 잘림. 반환 = (raw - K) mod 65536 */
const W = [16, 2, 1, 1, 12, 2, 2, 1];
const DIV = [150, 12, 16, 48, 30, 10, 88, 72];
export function teamRaw(teamData) {
  let raw = 0;
  for (const p of teamData.players.slice(0, 7)) {
    [p.hp, p.def, p.spd, p.s3, p.pow, p.s5, p.thr, p.pass].forEach((v, j) => { raw += Math.floor(v * 256 / DIV[j]) * W[j]; });
  }
  return raw & 0xffff;
}
export const teamRating = (teamData, k = QUICK_K) => (teamRaw(teamData) - k + 0x10000) & 0xffff;

/** 즉시 판정(ROM 0x34DE). ratingL/R = 16비트 레이팅, r = 난수 1바이트(0~255). 반환 {leftWins, p, a, c} */
export function quickJudge(ratingL, ratingR, r) {
  let a = ratingL >> 8, c = ratingR >> 8;
  if (c >= a) a >>= 1; else c >>= 1; // 낮거나 같은 쪽을 절반으로(같으면 왼쪽)
  const p = a + c > 0 ? Math.floor(a * 256 / (a + c)) : 128;
  return { leftWins: r <= p, p, a, c };
}

/** 팀 -> 우리 stages.json id(홈 스테이지). 표 밖이거나 대응 스테이지가 없으면 0 */
export function homeStage(stages, team) {
  const rs = HOME_ROM_STAGE[team];
  return stages.find((s) => s.romStage === rs)?.id ?? 0;
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** 규칙 값 검증. 빠진 time 은 knockout=0, official=3. 원작에 없는 조합은 null */
export function normLeagueRules(v) {
  if (v === undefined) return { mode: 'knockout', time: 0 };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const mode = v.mode ?? 'knockout';
  if (mode === 'knockout') return v.time === undefined || v.time === 0 ? { mode, time: 0 } : null;
  if (mode === 'official') { const t = v.time ?? 3; return OFFICIAL_TIMES.includes(t) ? { mode, time: t } : null; }
  return null;
}

/** 리그 팀 번호 검사. 반환 null = 통과, 아니면 오류 코드 */
export function teamCheck(team, special) {
  if (!isInt(team, 0, MAX_LEAGUE_TEAM)) return 'LEAGUE_INVALID';
  if (team >= SPECIAL_TEAMS[0] && !special) return 'LEAGUE_TEAM_LOCKED';
  return null;
}

/** league_new 요청 -> 새 리그. 실패하면 {code}. teams 원소는 {team, com?}(com 생략 = 컴퓨터) */
export function makeLeague(m, special, now = Date.now(), id = String(now)) {
  const T = m?.teams;
  if (!Array.isArray(T) || T.length < MIN_TEAMS || T.length > MAX_TEAMS) return { code: 'LEAGUE_INVALID' };
  if (!isInt(m.turns, MIN_TURNS, MAX_TURNS)) return { code: 'LEAGUE_INVALID' };
  const teams = [];
  for (const e of T) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { code: 'LEAGUE_INVALID' };
    if (e.com !== undefined && typeof e.com !== 'boolean') return { code: 'LEAGUE_INVALID' };
    const bad = teamCheck(e.team, special);
    if (bad) return { code: bad };
    teams.push({ team: e.team, com: e.com !== false });
  }
  if (new Set(teams.map((t) => t.team)).size !== teams.length) return { code: 'LEAGUE_INVALID' };
  if (teams.filter((t) => !t.com).length > MAX_HUMANS) return { code: 'LEAGUE_INVALID' };
  const rules = normLeagueRules(m.rules);
  if (!rules) return { code: 'LEAGUE_INVALID' };
  const n = teams.length;
  return { league: { id, teams, turns: m.turns, rules, res: Array.from({ length: n }, () => Array.from({ length: n }, () => [0, 0])), done: false, createdAt: now, updatedAt: now } };
}

/** league_config: com[](팀별 사람/컴퓨터), rules. 팀 수·턴 수는 바꾸지 않는다. 성공하면 null, 실패하면 오류 코드(league 는 바꾸지 않는다) */
export function applyConfig(league, m) {
  let com = league.teams.map((t) => t.com);
  if (m.com !== undefined) {
    if (!Array.isArray(m.com) || m.com.length !== league.teams.length || !m.com.every((v) => typeof v === 'boolean')) return 'LEAGUE_INVALID';
    com = m.com;
  }
  if (com.filter((v) => !v).length > MAX_HUMANS) return 'LEAGUE_INVALID';
  const rules = m.rules === undefined ? league.rules : normLeagueRules(m.rules);
  if (!rules) return 'LEAGUE_INVALID';
  league.teams.forEach((t, i) => { t.com = com[i]; });
  league.rules = rules;
  return null;
}

/** 파생 값. table 은 순위 목록 순서(순위 번호, 같은 번호 안은 참가 순번) */
export function derive(league) {
  const n = league.teams.length;
  const rows = league.teams.map((t, i) => {
    let w = 0, l = 0;
    for (let j = 0; j < n; j++) if (j !== i) { w += league.res[i][j][0]; l += league.res[i][j][1]; }
    return { idx: i, team: t.team, com: t.com, w, l, rate: w + l ? Math.floor(w * 1000 / (w + l)) : 0, left: (n - 1) * league.turns - w - l, rank: 0 };
  });
  for (const r of rows) r.rank = rows.filter((o) => o.rate > r.rate).length;
  const table = [...rows].sort((a, b) => a.rank - b.rank || a.idx - b.idx);
  const finished = rows.every((r) => r.left === 0);
  return { table, finished, champions: finished ? rows.filter((r) => r.rank === 0).map((r) => r.idx) : [] };
}

/** 카드 (i, j) 를 칠 수 있는지(i != j, 그 칸 승+패 < 턴) */
export function cardOk(league, i, j) {
  const n = league.teams.length;
  if (!isInt(i, 0, n - 1) || !isInt(j, 0, n - 1) || i === j || league.done) return false;
  const c = league.res[i][j];
  return c[0] + c[1] < league.turns;
}

/** 좌우 배치(analysis/29 §2-3): 사람이 낀 카드는 사람이 왼쪽(사이드 A = 좌석 0), 그 밖은 행 = 왼쪽 */
export function cardSides(league, i, j) {
  return !league.teams[j].com && league.teams[i].com ? { left: j, right: i } : { left: i, right: j };
}

/** 결과 기록: 승자·패자 리그 순번. done 을 다시 계산한다 */
export function recordWin(league, winner, loser, now = Date.now()) {
  league.res[winner][loser][0]++;
  league.res[loser][winner][1]++;
  league.done = derive(league).finished;
  league.updatedAt = now;
}

/** 저장소에서 읽은 값 검사(손상·수작업 편집 대비). 맞으면 정규화한 사본, 아니면 null */
export function sanitize(v) {
  try {
    if (!v || typeof v !== 'object') return null;
    const n = v.teams?.length;
    if (!isInt(n, MIN_TEAMS, MAX_TEAMS) || !isInt(v.turns, MIN_TURNS, MAX_TURNS)) return null;
    const teams = v.teams.map((t) => ({ team: t.team, com: t.com }));
    if (!teams.every((t) => isInt(t.team, 0, MAX_LEAGUE_TEAM) && typeof t.com === 'boolean')) return null;
    if (new Set(teams.map((t) => t.team)).size !== n || teams.filter((t) => !t.com).length > MAX_HUMANS) return null;
    const rules = normLeagueRules(v.rules);
    if (!rules || !Array.isArray(v.res) || v.res.length !== n) return null;
    const res = [];
    for (let i = 0; i < n; i++) {
      if (!Array.isArray(v.res[i]) || v.res[i].length !== n) return null;
      res.push([]);
      for (let j = 0; j < n; j++) {
        const c = v.res[i][j];
        if (!Array.isArray(c) || c.length !== 2 || !isInt(c[0], 0, MAX_TURNS) || !isInt(c[1], 0, MAX_TURNS)) return null;
        if (i === j ? c[0] + c[1] !== 0 : c[0] + c[1] > v.turns) return null;
        res[i].push([c[0], c[1]]);
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (res[i][j][0] !== res[j][i][1]) return null;
    const lg = { id: String(v.id ?? ''), teams, turns: v.turns, rules, res, done: false, createdAt: Number(v.createdAt) || 0, updatedAt: Number(v.updatedAt) || 0 };
    lg.done = derive(lg).finished;
    return lg;
  } catch { return null; }
}
