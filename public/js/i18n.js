// 클라이언트 측 문구 (서버 msg 가 우선, 없을 때만 사용)
export const ERR = {
  DISCONNECTED: '서버와 연결이 끊어졌습니다. 다시 연결하는 중…',
  RECONNECTED: '다시 연결되었습니다',
  UNKNOWN: '요청을 처리하지 못했습니다',
  ASSETS: '리소스를 불러오지 못했습니다',
  NICK_INVALID: '닉네임은 2~10자의 한글·영문·숫자만 쓸 수 있습니다',
  ROOM_CODE_INVALID: '방 코드는 4~6자의 영문 대문자·숫자입니다',
  READY_RESET_RULES: '규칙이 바뀌어 준비가 풀렸습니다',
  READY_RESET_TEAM: '팀을 바꿔 준비가 풀렸습니다',
  READY_RESET_OPP: '방장이 팀을 바꿔 준비가 풀렸습니다',
  ACCOUNT_REQUIRED: '계정으로 로그인해야 합니다',
  RANKED_RULES_FIXED: '래더 경기는 규칙을 바꿀 수 없습니다',
};
/** 서버 오류 코드별 짧은 토스트 문구(여기 있는 코드는 서버 msg 보다 먼저 쓴다, main.js). 불꽃 팀 고르기(PROTOCOL §13.20) */
export const ERR_CODE = {
  TEAM_INVALID: '고를 수 없는 팀입니다',
  FLAME_TEAM_NONE: '저장된 불꽃 팀이 없습니다',
  FLAME_TEAM_ROOM: '이 방은 불꽃 팀을 허용하지 않습니다',
  FLAME_TEAM_RULES: '불꽃 팀은 체력제만',
  FLAME_TEAM_CHANGED: '불꽃 팀 기록이 바뀌어 새로 불러왔습니다. 확인 후 다시 시작하세요', // 사람끼리 방(PROTOCOL §13.25): 시작 때 슬롯이 바뀜
  FLAME_TEAM_CLEARED: '방장이 불꽃 팀 허용을 꺼서 팀 선택이 풀렸습니다', // toast{code} 전용(§13.25)
  // 채팅·공지(사람끼리 방 chat, 관리자 notice_send). CHAT_TOO_LONG 은 params.max 로 고른다(chatErr)
  CHAT_EMPTY: '내용을 입력하세요',
  CHAT_TOO_LONG: '채팅은 60자까지입니다',
  CHAT_RATE_LIMITED: '채팅이 너무 빠릅니다',
  CHAT_UNAVAILABLE: '여기서는 채팅할 수 없습니다',
  NOT_ADMIN: '권한이 없습니다',
  NOTICE_RATE_LIMITED: '공지가 너무 잦습니다',
  // 래더(PROTOCOL §11): 종전 「랭크」 문구를 「래더」로
  RANKED_LOCKED: '기권이 잦아 잠시 래더 대전을 할 수 없습니다',
  RANKED_RULES_FIXED: '래더 경기는 규칙을 바꿀 수 없습니다',
  LADDER_ONLY: '래더 대전은 로비의 「래더 대전」으로만 할 수 있습니다',
};
/** 오류 코드 문구(CHAT_TOO_LONG = 한도 params.max: 100 이면 공지 문구) */
export const codeText = (m) => (m?.code === 'CHAT_TOO_LONG' && Number(m.params?.max) >= 100 ? '공지는 100자까지입니다'
  : m?.code === 'CHAT_TOO_LONG' && Number.isInteger(m.params?.max) ? `채팅은 ${m.params.max}자까지입니다`
  : m?.code === 'RANKED_LOCKED' && Number.isFinite(m.params?.until) ? lockText(m.params.until) : ERR_CODE[m?.code]);
/** 래더 기권 잠금 문구(until = 풀리는 시각 서버 epoch ms). 서버 시계 차는 무시(분 단위라 영향 작음) */
export const lockText = (until, now = Date.now()) => `${ERR_CODE.RANKED_LOCKED} (${Math.max(1, Math.ceil((until - now) / 60000))}분 뒤 가능)`;
/** 계정(PROTOCOL §2.1) 화면 문구. 서버 거절(6자 규칙·잠금 등)은 서버 msg 토스트 */
export const AUTH = {
  PW_EMPTY: '비밀번호를 입력하세요',
  PW_MISMATCH: '비밀번호가 서로 다릅니다',
  SIGNED_UP: '가입했습니다',
};
/** 래더 경기 점수가 반영되지 않은 사유(ranking_result.why, §11.1) */
export const RANK_WHY = {
  VOID: '무효 경기라 점수가 바뀌지 않았습니다',
  PAIR_LIMIT: '같은 상대와 하루 3경기를 넘어 점수가 바뀌지 않았습니다',
  SAME_KEY: '같은 계정끼리는 기록되지 않습니다',
};
/** 래더 티어(PROTOCOL §11.1 tier 키) */
export const TIER = { bronze: '브론즈', silver: '실버', gold: '골드', platinum: '플래티넘', diamond: '다이아', master: '마스터' };
export const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master'];
/** 방 목록에서 들어갈 수 없는 방: 상태 칸 문구(st)와 눌렀을 때 토스트(msg, 서버 ERR 문구와 같게) */
export const ROOM_OFF = {
  playing: { st: '게임 중', msg: '게임이 진행 중인 방입니다' },
  full: { st: '가득 참', msg: '방이 가득 찼습니다' },
  cpu: { st: '컴퓨터 대결', msg: '컴퓨터와 대결 중인 방입니다' },
};
export const ROOM_LEFT = { closed: '방이 닫혔습니다', grace: '연결이 오래 끊겨 방에서 나왔습니다',
  ladder_cancel: '상대가 나가 래더 대전이 취소되었습니다', ladder_timeout: '시작 시간이 지나 래더 대전이 해산되었습니다' }; // ladder_end = 정상 종료(문구 없음)
export const END_REASON = {
  annihilation: '전멸', timeup: '시간 종료', sudden_death: '서든데스', forfeit_disconnect: '연결 끊김 기권',
  forfeit_leave: '기권', draw_cap: '시간 초과 무승부', error: '서버 오류로 중단',
};
/** 튜토리얼(특훈)이 서버 상한으로 끝났을 때 토스트(PROTOCOL 9.2: idle = 무입력 10분, cap = 총 30분) */
export const TRAIN_END = { idle: '입력이 없어 튜토리얼을 끝냈습니다', cap: '튜토리얼 시간이 끝났습니다' };
/** 리그(PROTOCOL §10) 화면 문구. 서버 거절은 서버 msg 토스트가 우선 */
export const LEAGUE = {
  OVERWRITE: '진행 중인 리그를 지우고 새로 시작합니다',
  DUP: '이미 고른 팀입니다',
  CARD_DONE: '고를 수 없는 대전입니다',
  NOT_RECORDED: '이 경기는 기록되지 않았습니다',
};
/** 결과 화면 승패 기준 한 줄 */
export const END_RULE = {
  annihilation: '전멸: 내야를 모두 아웃시킨 팀 승리',
  timeup: '시간 종료: 남은 인원이 많은 팀 승리',
  sudden_death: '서든데스: 먼저 아웃시킨 팀 승리',
  forfeit_disconnect: '연결 끊김: 돌아오지 않은 쪽 기권패',
  forfeit_leave: '기권: 경기를 나간 쪽 패배',
  draw_cap: '시간 초과: 무승부',
  error: '서버 오류로 경기 중단',
};
