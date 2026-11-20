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
    logoutLoginTimeoutMs: num(env.LOGOUT_LOGIN_TIMEOUT_MS, 5 * 60000), // 로그아웃 뒤 다시 로그인하지 않은 연결(로그아웃 시점부터)
    maxPauseMs: num(env.MAX_PAUSE_MS, 90000), // 경기당 좌석별 누적 일시정지
    maxDisconnects: num(env.MAX_DISCONNECTS, 5), // 경기당 좌석별 끊김 횟수
    maxCampaignPerMin: num(env.MAX_CAMPAIGN_PER_MIN, 30), // 세션당 분당 campaign_list/campaign_start/training_start/ranking_list
    maxLeaguePerMin: num(env.MAX_LEAGUE_PER_MIN, 200), // 세션당 분당 league_* (6팀 9턴 135카드 즉시 판정을 막지 않게 캠페인 창과 분리)
    maxFlamePerMin: num(env.MAX_FLAME_PER_MIN, 300), // 세션당 분당 flame_* (장비·상점 조작이 잦아 리그 창과 분리)
    maxAuthPerMin: num(env.MAX_AUTH_PER_MIN, 10), // IP당 분당 register/login
    maxInvitePreviewPerMin: num(env.MAX_INVITE_PREVIEW_PER_MIN, 30), // IP당 분당 초대 링크 미리보기(`/?room=`) 방 조회. 넘으면 일반 문구(server/net/invite_og.js)
    loginFailNick: num(env.LOGIN_FAIL_NICK, 5), // 15분 안 (닉네임, IP) 쌍 로그인 실패 n회 -> 잠금. 닉네임 단독(전 IP 합계)은 n회부터 응답 지연
    loginSlowStepMs: num(env.LOGIN_SLOW_STEP_MS, 1000), // 닉네임 단독 실패 누적 시 시도당 지연 증가분
    loginSlowMaxMs: num(env.LOGIN_SLOW_MAX_MS, 10000), // 위 지연 상한
    loginFailIp: num(env.LOGIN_FAIL_IP, 20), // IP별 15분 안 로그인 실패 n회 -> 잠금
    loginLockMs: num(env.LOGIN_LOCK_MS, 15 * 60000), // 잠금 시간
    // 채팅·공지(PROTOCOL §14)
    adminAccounts: String(env.ADMIN_ACCOUNTS ?? ''), // 쉼표 목록(계정 닉네임). 빈 값 = 공지 꺼짐. 정리(NFC·소문자)는 server/chat/chat.js parseAdmins
    chatGuest: env.CHAT_GUEST !== '0', // 손님 채팅 허용(기본 1). '0' 이면 계정만(ACCOUNT_REQUIRED)
    chatMax: num(env.CHAT_MAX, 60), // 채팅 한 줄 최대 글자(코드포인트, 정리 후)
    noticeMax: num(env.NOTICE_MAX, 100), // 공지 최대 글자
    chatMinGapMs: num(env.CHAT_MIN_GAP_MS, 1000), // 세션당 채팅 최소 간격
    chatBurst: num(env.CHAT_BURST, 5), // CHAT_WINDOW_MS 안 채팅 상한
    chatWindowMs: num(env.CHAT_WINDOW_MS, 10000),
    noticePath: env.NOTICE_PATH || null, // 공지 기록 jsonl. 비면 server/index.js 가 data/notices.jsonl(테스트 실행 중이면 기록 안 함)
    ...over,
  };
}
