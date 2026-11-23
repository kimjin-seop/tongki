// 불꽃의 계승 컴퓨터 단계(analysis 후속, 사용자 2026-11-22): 엔드리스 구간이 쌓일수록 컴퓨터 단계 N 이 1, 2, 3, 4 ... 무한히 오른다. 전부 [자작 제안·시작값]이고 값은 run_config.json 의 tier 에 있다.
// 단계 1~3 은 종전 cpuLevel 표 그대로다(원작 레벨 검증·로비 1~3 불변). 4 이상은 엔진에 cpuLevel 3 + 보정(cpuBoost, server/engine/boost.js)으로 들어간다.
// 모든 값은 서버가 저장된 구간 번호(run.seg)와 데이터로만 계산한다(클라이언트가 보낸 값은 쓰지 않는다). 정수 연산, 난수 없음, 결정적이다.
// 단계는 구간에서 파생되므로 저장에 새 필드가 필요 없다(구간 수 상한 SEG_MAX 안에서 N 은 안전한 정수다). 지도 노드(opp.tier)에는 4 이상일 때만 적어 둔다(지도는 구간에 들어갈 때 만든다).
// tier 키가 없거나 enabled 가 true 가 아니거나 환경 변수 FLAME_TIER=0 이면 null = 종전 동작.

const T_CAP = 1e9; // 계산 상한(Number.isSafeInteger 범위 안)

/** 포화 곡선: floor(max * n / (n + k)). n >= 0, k >= 1 이라 0 나눗셈이 없고 0 <= 결과 < max */
export const saturate = (max, n, k) => (n > 0 ? Math.floor((max * Math.min(n, T_CAP)) / (Math.min(n, T_CAP) + k)) : 0);

/** 설정(없거나 꺼져 있으면 null). 값 검사는 checkTierCfg(카탈로그 로드 때) */
export function tierCfg(cat) {
  const T = cat?.cfg?.tier;
  return T && T.enabled === true && process.env.FLAME_TIER !== '0' ? T : null;
}

/** 형식 검사(카탈로그 로드 때). 틀리면 메시지 문자열, 맞으면 null */
export function checkTierCfg(T) {
  if (T === undefined) return null;
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!T || typeof T.enabled !== 'boolean') return 'tier.enabled 는 true|false';
  if (!int(T.stepRuns, 1, 1000) || !int(T.baseLevel, 1, 3) || !int(T.unitSegs ?? 1, 1, 100)) return 'tier.stepRuns(1~1000)·baseLevel(1~3)·unitSegs(1~100) 정수';
  const S = (o, max) => o && int(o.max, 0, max) && int(o.k, 1, 1e6);
  if (!S(T.catch256, 255) || !S(T.special256, 255) || !S(T.ballSpeedPct, 2000) || !S(T.hpPct, 300) || !S(T.strongPct, 100)) return 'tier.catch256·special256·ballSpeedPct·hpPct·strongPct 는 {max,k}';
  if (!int(T.coin?.perTier, 0, 1000) || !int(T.coin?.cap, 0, 100000)) return 'tier.coin {perTier, cap}';
  return null;
}

/** 구간 seg(0부터)에서 더해지는 단계 수: 구간 3 까지는 0, 그 뒤 unitSegs 구간마다 stepRuns 번에 한 단계. 구간 seg=2(세 번째 구간)가 기준 */
export function extraOf(T, seg) {
  if (!T || !(seg > 2)) return 0;
  return Math.floor(Math.floor((seg - 2) / T.unitSegs) / T.stepRuns);
}

/** 이 경기의 단계 = 종전 레벨(난이도 가산 포함, 1~3) + 구간으로 더해진 단계 */
export const tierOf = (T, level, seg) => level + extraOf(T, seg);

/** 엔진에 넘길 레벨(1~3) */
export const engineLevel = (tier) => Math.max(1, Math.min(3, tier));

/** 단계 N 의 엔진 보정(cpuBoost). N <= 3 이면 null(보정 없음 = 종전). 상한은 포화 곡선의 max 미만이다 */
export function boostOf(T, N) {
  if (!T) return null;
  const n = N - T.baseLevel;
  if (!(n > 0)) return null;
  return {
    seat: 1,
    catch256: saturate(T.catch256.max, n, T.catch256.k),
    special256: saturate(T.special256.max, n, T.special256.k),
    ballSpeedPct: 100 + saturate(T.ballSpeedPct.max, n, T.ballSpeedPct.k),
    hpPct: saturate(T.hpPct.max, n, T.hpPct.k),
  };
}

/** 지도에서 일반 노드의 상대를 강팀 풀로, 강팀 노드의 상대를 보스 풀로 바꿀 확률(%) */
export const strongPctOf = (T, N) => (T && N > T.baseLevel ? saturate(T.strongPct.max, N - T.baseLevel, T.strongPct.k) : 0);

/** 코인 가산(%p): 단계 4 부터 단계마다 coin.perTier, 상한 coin.cap. 극한 단계일수록 크다(포화하지 않고 상한까지 선형) */
export const coinBonusPct = (T, N) => (T && N > T.baseLevel ? Math.min(T.coin.cap, (Math.min(N, T_CAP) - T.baseLevel) * T.coin.perTier) : 0);

/** 도전의 현재 구간에서 가장 높은 단계(보스 기준, 표시·코인용) */
export function segTier(cat, run) {
  const T = tierCfg(cat);
  if (!T) return null;
  const O = cat.cfg.opponents, row = O.segments[Math.max(0, Math.min(run.seg, O.segments.length - 1))];
  const add = cat.cfg.difficulty.find((d) => d.id === run.diff)?.cpuLevelAdd, a = add && typeof add === 'object' ? add.boss ?? 0 : add ?? 0;
  return tierOf(T, Math.max(1, Math.min(O.cpuLevelMax, row.cpuLevel.boss + a)), run.seg);
}

/** 표시 문자열 용: 4자리를 넘으면 9999+ */
export const tierLabel = (N) => (N > 9999 ? '9999+' : String(N));
