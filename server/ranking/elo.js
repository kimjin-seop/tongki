// 온라인 랭킹(래더) 규칙 — [자작], 기준 analysis/33 §B 권고값. 순수 함수만(저장은 server/store/ranking.js).
export const RANK = {
  init: 1000, k: 32, kPlacement: 48, placementGames: 10, floor: 100, // Elo: 초기 1000, K 32(첫 10경기 48), 하한 100
  boardMinGames: 5, boardTop: 50,                                      // 순위표: 5경기 미만 = 배치 중(목록 제외), 상위 50
  pairLimit: 3, pairWindowMs: 24 * 3600 * 1000,                        // 같은 상대 24시간 3경기까지만 반영
  forfeitWindow: 10, forfeitMax: 3, lockMs: 30 * 60000,                // 최근 10경기 중 기권 3회 -> 30분 랭크 입장 잠금
  season: 1,
  rules: { mode: 'knockout', time: 5 },                                // 랭크 방 규칙 고정
  maxTeam: 21,                                                         // SPECIAL(15~21) 허용, 22~24 금지
};

/** 랭크에 반영되는 종료: 정상 종료 3종 + 기권 2종(기권 쪽 패배). 그 밖(draw_cap·error·training 등)은 무효 */
export const RANK_NORMAL = ['annihilation', 'timeup', 'sudden_death'];
export const RANK_FORFEIT = ['forfeit_leave', 'forfeit_disconnect'];

export const kOf = (games) => (games < RANK.placementGames ? RANK.kPlacement : RANK.k);

/** A 의 기대 승률 */
export const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

/** 한 경기 뒤 두 사람의 새 레이팅. 각자 자기 K(배치 구간이면 48), 하한 100. 반환 [aAfter, bAfter] */
export function eloAfter(a, b, aWon) {
  const ea = expected(a.rating, b.rating);
  const da = Math.round(kOf(a.games) * ((aWon ? 1 : 0) - ea));
  const db = Math.round(kOf(b.games) * ((aWon ? 0 : 1) - (1 - ea)));
  return [Math.max(RANK.floor, a.rating + da), Math.max(RANK.floor, b.rating + db)];
}
