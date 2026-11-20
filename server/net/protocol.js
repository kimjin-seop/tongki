// 프로토콜 상수·검증 (계약: docs/PROTOCOL.md)
import { RULE_MODES, RULE_TIMES } from '../engine/consts.js';
export const PROTOCOL = 1;
export const GRACE_MS = 30000;
export const NICK_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]{2,10}$/;
export const CODE_RE = /^[A-Z0-9]{4,6}$/;
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const ERR = {
  BAD_MESSAGE: '잘못된 요청입니다',
  UNKNOWN_TYPE: '알 수 없는 요청입니다',
  RATE_LIMITED: '요청이 너무 빠릅니다',
  NOT_LOGGED_IN: '먼저 닉네임을 입력하세요',
  ALREADY_LOGGED_IN: '이미 접속한 상태입니다',
  NICK_INVALID: '닉네임은 2~10자의 한글·영문·숫자만 쓸 수 있습니다',
  NICK_TAKEN: '이미 사용 중인 닉네임입니다',
  TOKEN_INVALID: '세션이 만료되었습니다. 닉네임을 다시 입력하세요',
  SESSION_REPLACED: '다른 곳에서 접속하여 연결이 종료됩니다',
  NOT_IN_ROOM: '방에 들어가 있지 않습니다',
  ALREADY_IN_ROOM: '이미 방에 들어가 있습니다',
  ROOM_CODE_INVALID: '방 코드는 4~6자의 영문 대문자·숫자입니다',
  ROOM_CODE_TAKEN: '이미 사용 중인 방 코드입니다',
  ROOM_NOT_FOUND: '방을 찾을 수 없습니다',
  ROOM_FULL: '방이 가득 찼습니다',
  ROOM_IN_GAME: '게임이 진행 중인 방입니다',
  NOT_HOST: '방장만 할 수 있습니다',
  HOST_NO_READY: '방장은 준비할 필요가 없습니다',
  START_NEED_PLAYERS: '2명이 모여야 시작할 수 있습니다',
  START_NOT_READY: '상대가 준비하지 않았습니다',
  TEAM_INVALID: '팀 번호가 올바르지 않습니다',
  IN_GAME: '게임 중에는 할 수 없습니다',
  NOT_IN_GAME: '게임 중이 아닙니다',
  INTERNAL: '서버 오류가 발생했습니다',
  GAME_ABORTED: '경기가 서버 오류로 중단되었습니다',
  TOO_MANY_CONNECTIONS: '이 네트워크에서 접속이 너무 많습니다',
  HELLO_RATE_LIMITED: '접속 시도가 너무 잦습니다. 잠시 후 다시 시도하세요',
  SERVER_FULL: '서버가 가득 찼습니다. 잠시 후 다시 시도하세요',
  TOO_MANY_ROOMS: '방이 너무 많아 만들 수 없습니다',
  CAMPAIGN_LOCKED: '아직 열리지 않은 경기입니다',
  CAMPAIGN_RATE_LIMITED: '요청이 너무 잦습니다. 잠시 후 다시 시도하세요',
  NOT_IN_CAMPAIGN_ROOM: '캠페인 방에서는 할 수 없습니다',
  RULES_INVALID: '규칙 값이 올바르지 않습니다',
  LOGIN_TIMEOUT:'로그인 시간이 지나 연결이 종료됩니다',
  TRAINING_UNAVAILABLE: '아직 준비되지 않은 튜토리얼입니다',
  NOT_IN_TRAINING: '튜토리얼 중이 아닙니다',
  LEAGUE_NONE: '진행 중인 리그가 없습니다',
  LEAGUE_INVALID: '리그 설정이 올바르지 않습니다',
  LEAGUE_CARD_INVALID: '고를 수 없는 대전입니다',
  LEAGUE_TEAM_LOCKED: '아직 고를 수 없는 팀입니다',
  // 불꽃의 계승(PROTOCOL §13)
  FLAME_UNAVAILABLE: '불꽃의 계승을 지금 쓸 수 없습니다',
  FLAME_SAVE_NEWER: '저장 데이터가 더 새 버전입니다',
  FLAME_SAVE_BROKEN: '저장 데이터를 읽지 못했습니다. 운영자에게 알려 주세요',
  FLAME_SAVE_FAILED: '경기 결과를 저장하지 못했습니다. 같은 경기를 다시 할 수 있습니다',
  FLAME_NONE: '진행 중인 도전이 없습니다',
  FLAME_INVALID: '고를 수 없는 항목입니다',
  FLAME_LOCKED: '아직 해금되지 않았습니다',
  FLAME_NO_FUNDS: '재화가 부족합니다',
  FLAME_FULL: '더 가질 수 없습니다',
  FLAME_EQUIPPED: '다른 선수가 착용 중입니다',
  FLAME_MAX: '더 올릴 수 없습니다',
  FLAME_PENDING: '먼저 보상을 선택하세요',
  FLAME_IN_NODE: '지금 있는 곳에서 먼저 나가세요',
  FLAME_NOT_HERE: '여기서는 할 수 없습니다',
  FLAME_DUP: '이미 적용되어 있습니다',
  FLAME_NO_EFFECT: '효과가 없습니다',
  FLAME_PROTAGONIST: '주인공은 교체할 수 없습니다',
  FLAME_PRACTICE_NONE: '지금은 연습 경기를 할 수 없습니다',
  FLAME_TRAIN_CAP: '이 능력치는 특훈으로 더 올릴 수 없습니다',
  // 키운 팀 슬롯(PROTOCOL §13.20)
  FLAME_TEAM_NONE: '저장된 불꽃 팀이 없습니다',
  FLAME_TEAM_ROOM: '이 방은 불꽃 팀을 허용하지 않습니다',
  FLAME_TEAM_RULES: '불꽃 팀은 체력제 규칙에서만 쓸 수 있습니다',
  FLAME_TEAM_CHANGED: '불꽃 팀 기록이 바뀌어 새로 불러왔습니다. 확인 후 다시 시작하세요', // 사람끼리 방(D53): 시작 때 슬롯 요약 at 이 고를 때와 다름
  FLAME_TEAM_CLEARED: '방장이 불꽃 팀 허용을 꺼서 팀 선택이 풀렸습니다', // 토스트(D53): 고른 사람에게 1회
  // 계정(PROTOCOL §2.1)
  ACCOUNT_REQUIRED: '계정으로 로그인해야 합니다',
  ACCOUNT_EXISTS: '이미 가입된 닉네임입니다',
  NICK_REGISTERED: '가입된 닉네임입니다. 비밀번호로 로그인하세요',
  PASSWORD_INVALID: '비밀번호는 6~64자로 정하세요',
  LOGIN_FAILED: '닉네임 또는 비밀번호가 맞지 않습니다',
  LOGIN_LOCKED: '로그인 실패가 많아 잠시 막혔습니다. 잠시 후 다시 시도하세요',
  AUTH_RATE_LIMITED: '가입·로그인 시도가 너무 잦습니다. 잠시 후 다시 시도하세요',
  AUTH_BUSY: '처리 중입니다. 잠시 기다리세요',
  ACCOUNT_CREATED_RELOGIN: '가입은 되었습니다. 비밀번호로 다시 로그인하세요',
  // 랭킹(PROTOCOL §11)
  RANKED_LOCKED: '기권이 잦아 잠시 랭크 경기를 할 수 없습니다',
  RANKED_RULES_FIXED: '랭크 방은 규칙을 바꿀 수 없습니다',
  LADDER_ONLY: '랭크 경기는 래더 대기열에서만 할 수 있습니다', // create_room{ranked:true}(2026-11-20 래더로 대체), 끝난 래더 방 start
  // 채팅·공지(PROTOCOL §14)
  CHAT_EMPTY: '보낼 내용을 입력하세요',
  CHAT_TOO_LONG: '너무 깁니다', // params.max = 최대 글자 수
  CHAT_RATE_LIMITED: '채팅이 너무 빠릅니다. 잠시 후 다시 보내세요',
  CHAT_UNAVAILABLE: '여기서는 채팅할 수 없습니다',
  NOT_ADMIN: '관리자만 할 수 있습니다',
  NOTICE_RATE_LIMITED: '공지를 너무 자주 보냈습니다. 잠시 후 다시 보내세요',
};

/** 특훈 종류(PROTOCOL §9). TRAINING_READY 에 든 것만 시작할 수 있다(빠진 종류는 TRAINING_UNAVAILABLE). 지금은 둘 다 열려 있다 */
export const TRAINING_KINDS = ['catch', 'special'];
export const TRAINING_READY = ['catch', 'special'];

export const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * 규칙 창 값 검증(PROTOCOL §4 set_rules). v = {mode?, time?}, 빠진 필드는 base 값. 형식이 틀리면 null.
 * 원작: こうしき 를 고르면 むせいげん 을 쓸 수 없고 시간이 3분으로 바뀐다(analysis/28 §2-1 [확인])
 * OFFICIAL_ENABLED: こうしき 엔진 이식(analysis/29 §3·§4-1-1)으로 켰다. false 로 되돌리면 mode 'official' 을 틀린 값으로 거절한다(RULES_INVALID)
 */
export const OFFICIAL_ENABLED = true;
export function normRules(v, base) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const mode = v.mode ?? base.mode, time = v.time ?? base.time;
  if (!RULE_MODES.includes(mode) || !RULE_TIMES.includes(time)) return null;
  if (mode === 'official' && !OFFICIAL_ENABLED) return null;
  return { mode, time: mode === 'official' && time === 0 ? 3 : time };
}
