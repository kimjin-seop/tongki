// 래더(랭크 대체) 규칙 — [자작]. 파라미터는 아래 LADDER 한 곳(시작값: analysis/46 §6, 2026-11-20 임밸런). 순수 함수만(저장은 server/store/ranking.js, 대기열은 server/ranking/queue.js).
// 값을 바꾸면 그대로 반영된다(데이터만으로 조정). 티어 이름은 화면 문구가 아니라 키다(클라이언트가 번역).
export const LADDER = {
  init: 1000, floor: 100,                         // 시작 레이팅·하한
  k: 32, kPlacement: 48, kPlacementGames: 10,     // K 32, 시즌 첫 10판 K 48(시즌마다 다시)
  kGuest: 16, guestRating: 1000,                  // 손님 상대 경기: 계정 쪽 K 16(배치 중이어도), 손님은 1000 고정·저장 없음(analysis/46 §8-1)
  placementGames: 5,                              // 시즌 5판 미만 = 배치 중(티어·순위 숨김, 순위표 제외)
  tierBounds: { silver: 950, gold: 1050, platinum: 1150, diamond: 1250 }, // 하한. 950 미만 bronze
  tierDemoteBuffer: 25,                           // 강등만 완충: 지금 티어 하한 - 25 아래로 내려가야 강등
  queue: {
    expandStep: 100, expandSec: 15, maxWaitSec: 60, // 허용 차 = step × (1 + floor(대기/expandSec)), maxWaitSec 이상 무제한
    windowRule: 'max',                            // 'max' = 두 사람 중 넓은 창으로 판정, 'min' = 두 창 모두
    tickMs: 1000,                                 // 짝 찾기 주기
  },
  room: { startTimeoutSec: 120 },                 // 매칭 뒤 이 시간 안에 시작하지 않으면 방 해산(벌점 없음)
  season: { days: 28, resetFactor: 0.5 },         // 시즌 길이, 시즌 전환 = round(1000 + (r - 1000) × 0.5). 시즌 1 은 전원 1000(마이그레이션 v3)
  master: { topN: 5, pct: 0.05, minPlayers: 20, minRating: 1250, minGames: 20 }, // 정원 = min(topN, max(1, floor(인원 × pct))), 인원 < minPlayers 면 없음
  inactiveDays: 14,                               // 마지막 경기 14일 지나면 순위표·마스터 자격에서 빠짐(레이팅은 그대로)
  pairLimit: 3, pairWindowMs: 24 * 3600 * 1000,   // 같은 상대 24시간 3판까지만 반영(큐는 4판째 짝을 뒤로 미룬다)
  forfeitWindow: 10, forfeitMax: 3, lockMs: 30 * 60000, // 최근 10판 중 기권 3회 -> 30분 래더 잠금
  boardTop: 50,
  rules: { mode: 'knockout', time: 5 },           // 래더 경기 규칙 고정
  maxTeam: 21,                                    // SPECIAL(15~21) 허용, 22~24 금지
};

export const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
const DAY = 86400000;
export const seasonMs = () => LADDER.season.days * DAY;

/** 래더에 반영되는 종료: 정상 종료 3종 + 기권 2종(기권 쪽 패배). 그 밖(draw_cap·error·training 등)은 무효 */
export const RANK_NORMAL = ['annihilation', 'timeup', 'sudden_death'];
export const RANK_FORFEIT = ['forfeit_leave', 'forfeit_disconnect'];
export const validResult = ({ winner, reason, wentGo }) => !!wentGo && (winner === 0 || winner === 1) && (RANK_NORMAL.includes(reason) || RANK_FORFEIT.includes(reason));

/** 내 K. vsGuest = 상대가 손님 */
export const kOf = (games, vsGuest = false) => (vsGuest ? LADDER.kGuest : games < LADDER.kPlacementGames ? LADDER.kPlacement : LADDER.k);

/** A 의 기대 승률 */
export const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

/**
 * 한 경기 뒤 두 사람의 새 레이팅. 각자 자기 K(배치 구간 48, 상대가 손님이면 16), 반올림, 하한 100. 반환 [aAfter, bAfter].
 * 손님(guest:true)은 레이팅을 guestRating 으로 보고 계산하며, 손님 쪽 값은 호출한 쪽이 버린다(저장 없음)
 */
export function eloAfter(a, b, aWon) {
  const ra = a.guest ? LADDER.guestRating : a.rating, rb = b.guest ? LADDER.guestRating : b.rating;
  const ea = expected(ra, rb);
  const da = Math.round(kOf(a.games, !!b.guest) * ((aWon ? 1 : 0) - ea));
  const db = Math.round(kOf(b.games, !!a.guest) * ((aWon ? 0 : 1) - (1 - ea)));
  return [Math.max(LADDER.floor, ra + da), Math.max(LADDER.floor, rb + db)];
}

/** 티어 하한(bronze = -Infinity) */
export const tierLower = (t) => (t === 'bronze' ? -Infinity : LADDER.tierBounds[t]);
/** 레이팅만으로 정한 티어(완충 없음) */
export function tierOf(r) {
  let t = 'bronze';
  for (const x of TIERS) if (x !== 'bronze' && r >= LADDER.tierBounds[x]) t = x;
  return t;
}
/**
 * 표시 티어 갱신(완충). cur = 저장된 표시 티어(없으면 레이팅으로). 승급 = 레이팅이 더 높은 티어 하한에 닿으면 바로,
 * 강등 = 지금 티어 하한 - tierDemoteBuffer 아래로 내려가면 한 칸씩(내려간 칸에도 같은 완충을 적용)
 */
export function nextTier(cur, r) {
  if (!TIERS.includes(cur)) return tierOf(r);
  const raw = tierOf(r);
  let i = TIERS.indexOf(cur);
  if (TIERS.indexOf(raw) > i) return raw;
  while (i > 0 && r < tierLower(TIERS[i]) - LADDER.tierDemoteBuffer) i--;
  return TIERS[i];
}

/** 시즌 전환 레이팅 */
export const seasonReset = (r) => Math.max(LADDER.floor, Math.round(LADDER.init + (r - LADDER.init) * LADDER.season.resetFactor));

/** 마스터 정원(래더 인원 = 배치 완료·비활동 아님) */
export function masterQuota(players) {
  const M = LADDER.master;
  if (players < M.minPlayers) return 0;
  return Math.min(M.topN, Math.max(1, Math.floor(players * M.pct)));
}

/** 대기 waitMs 인 사람의 허용 레이팅 차(maxWaitSec 이상 = Infinity) */
export function queueWindow(waitMs) {
  const Q = LADDER.queue, w = Math.max(0, waitMs) / 1000;
  if (w >= Q.maxWaitSec) return Infinity;
  return Q.expandStep * (1 + Math.floor(w / Q.expandSec));
}
