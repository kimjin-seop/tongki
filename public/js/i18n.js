// 클라이언트 측 문구 (서버 msg 가 우선, 없을 때만 사용)
export const ERR = {
  DISCONNECTED: '서버와 연결이 끊어졌습니다. 다시 연결하는 중…',
  RECONNECTED: '다시 연결되었습니다',
  UNKNOWN: '요청을 처리하지 못했습니다',
  ASSETS: '리소스를 불러오지 못했습니다',
  NICK_INVALID: '닉네임은 2~10자의 한글·영문·숫자만 쓸 수 있습니다',
  ROOM_CODE_INVALID: '방 코드는 4~6자의 영문 대문자·숫자입니다',
};
export const ROOM_LEFT = { closed: '방이 닫혔습니다', grace: '연결이 오래 끊겨 방에서 나왔습니다' };
export const END_REASON = {
  annihilation: '전멸', timeup: '시간 종료', sudden_death: '서든데스', forfeit_disconnect: '연결 끊김 기권',
  forfeit_leave: '기권', draw_cap: '시간 초과 무승부', error: '서버 오류로 중단',
};
/** 특훈이 서버 상한으로 끝났을 때 토스트(PROTOCOL 9.2: idle = 무입력 10분, cap = 총 30분) */
export const TRAIN_END = { idle: '입력이 없어 특훈을 끝냈습니다', cap: '특훈 시간이 끝났습니다' };
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
