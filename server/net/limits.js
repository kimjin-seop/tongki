// 접속·세션 상한 (환경변수로 조정). 100명+ 정상 사용을 막지 않는 넉넉한 기본값.
import { performance } from 'node:perf_hooks';

/** 단조 시계(ms). 게임 루프·시간 계산용. 벽시계(Date.now) 점프의 영향을 받지 않는다. */
export const mono = () => performance.now();

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export function loadLimits(env = process.env, over = {}) {
  return {
    maxConnPerIp: num(env.MAX_CONN_PER_IP, 20), // IP당 동시 연결 (NAT 공유 고려)
    maxHelloPerMin: num(env.MAX_HELLO_PER_MIN, 60), // IP당 분당 hello
    maxSessions: num(env.MAX_SESSIONS, 2000),
    maxRooms: num(env.MAX_ROOMS, 1000),
    loginTimeoutMs: num(env.LOGIN_TIMEOUT_MS, 30000), // 로그인 안 한 연결
    maxPauseMs: num(env.MAX_PAUSE_MS, 90000), // 경기당 좌석별 누적 일시정지
    maxDisconnects: num(env.MAX_DISCONNECTS, 5), // 경기당 좌석별 끊김 횟수
    maxCampaignPerMin: num(env.MAX_CAMPAIGN_PER_MIN, 30), // 세션당 분당 campaign_list/campaign_start
    maxLeaguePerMin: num(env.MAX_LEAGUE_PER_MIN, 200), // 세션당 분당 league_* (6팀 9턴 135카드 즉시 판정을 막지 않게 캠페인 창과 분리)
    ...over,
  };
}
