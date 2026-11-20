# 49. 채팅 + 관리자 공지 (2026-11-20)

상태: 서버 구현 완료(박백엔, 미커밋). 화면은 후속(윤프론). 계약 `docs/PROTOCOL.md §14`, 인수인계 `docs/HANDOFF.md §13`. 시안 `Works/_asset_samples/tongki_chat_mock/index.html`.

## 1. 사용자 결정
- 채팅은 사람끼리 방(대기실 + 경기 중)의 두 사람끼리만. 로비 전체 채팅 없음.
- 화면 채팅 로그는 최대 5줄(시안 4줄에서 변경).
- 공지는 관리자만 보내고, 접속 중인 전원에게 화면 중앙에 표시.

## 2. 설계(확정, 문기획 개정본 요약)
### 채팅
- 채팅 방 판정 `chatRoom(room) = !!room && !room.vsCpu && !room.campaign && !room.training && !room.league && !room.flame` (`server/chat/chat.js`). 불꽃 팀 허용 사람끼리 방·래더 방 포함. `roomGame.js isHumanVsHuman` 은 건드리지 않았다(필살 추적 판정과 분리).
- `{t:'chat', text}` -> 방 좌석 두 사람(본인 포함)에게 `{t:'chat', from, text, at, admin?:true}`. 그 밖 위치 `CHAT_UNAVAILABLE`. `room.chat:true` 읽기 전용 표시.
- 정리: 제어·0폭·양방향 제어 문자(U+0000~001F, 007F~009F, 200B~200F, 202A~202E, 2066~2069, FEFF, 짝 없는 대리)를 공백으로 -> NFC -> 연속 공백 축약 -> 앞뒤 공백 제거 -> 1~60 코드포인트(`CHAT_EMPTY`/`CHAT_TOO_LONG{max}`).
- 도배: 세션당 최소 간격 1초, 10초 5개, 같은 내용 연속 3회째 -> `CHAT_RATE_LIMITED`. 통과한 글만 센다.
- 욕설: `server/data/chat_badwords.json` 의 단어를 `*` 로 가림(거절 아님, 최소 목록).
- 손님 허용(`CHAT_GUEST=0` 이면 `ACCOUNT_REQUIRED`).
### 관리자 공지
- `ADMIN_ACCOUNTS`(쉼표, 시작 때 NFC·소문자). 판정 = `s.account === true` 이고 키가 목록에 있음.
- **반드시 먼저 가입한 계정만 목록에 넣는다**(2026-11-20 정검수 리뷰 M1 반영, 확정 닉네임 `운영자`). 서버 시작 때 목록 항목마다 `accounts` 존재를 확인: 있으면 `[admin] 관리자 계정 확인: <닉네임> (가입 <ISO 시각>)` 로그(운영자가 본인 가입 시각인지 확인), 없으면 경고 로그 + 그 실행 동안 비활성(뒤에 가입돼도 승격 없음). 목록 닉네임의 `register` = `NICK_TAKEN`. 절차: `ADMIN_ACCOUNTS` 없이 뜬 서버에서 `운영자` 가입(비밀번호는 사용자만) -> `ADMIN_ACCOUNTS=운영자` 로 재시작 -> 시작 로그 가입 시각 확인(docs/HANDOFF.md §13). `notice_send` 마다 다시 판정, 클라이언트 값 불신. `welcome`·`account_ok` 에 `admin:true`(관리자만).
- `{t:'notice_send', text}` 관리자 전용(그 외 `NOT_ADMIN`, 아무에게도 안 감), 위치 무관, 1~100자 같은 정리(욕설 가림 없음), 3초에 1개·분당 10개(`NOTICE_RATE_LIMITED`).
- 서버 증가 `id`, 연결된 세션 전원에게 `{t:'notice', id, text, at}`(CPU 경기 중·로비·대기실 포함, 유예 중 세션 제외, 늦게 온 사람에게 재전송 없음). 서버 로그 + `data/notices.jsonl`(`NOTICE_PATH`) `{at, by, text}` 추가.
- 관리자의 일반 채팅 줄에는 서버가 `admin:true` 를 붙인다.

## 3. 인수조건(시험 `test/chat.test.js`, 2026-11-20 실행 5/5)
1. 사람끼리 방 대기실·경기 중 채팅은 두 좌석만 받고, 로비·컴퓨터 대전·스토리는 `CHAT_UNAVAILABLE`.
2. `admins` = 서버 시작 전에 가입해 둔 `운영자` 계정 로그인 시 `welcome.admin:true`(시험 갱신 2026-11-20: 시작 뒤 가입은 거절), 일반 계정·손님은 없음. 손님 `hello{Boss}` = `NICK_REGISTERED`. 공지가 로비·사람끼리 경기 중·CPU 경기 중 세션 전원에게 같은 id·글로 도착, 일반 계정·손님(`admin:true` 를 실어 보내도) `NOT_ADMIN`, 곧바로 두 번째 = `NOTICE_RATE_LIMITED`, 기록 파일 1줄. 관리자 채팅 줄 `admin:true`.
3. 61자 `CHAT_TOO_LONG{max:60}`, 60자 통과, 1초 안 연속 `CHAT_RATE_LIMITED`, 양방향·0폭 문자 공백 치환, NFC, 욕설 가림, 손님 금지 설정 시 `ACCOUNT_REQUIRED`.
4. XSS 문자열(`<img onerror>`·`&amp;`·따옴표·`</script>`)이 공지·채팅 모두 원문 그대로 전달.
5. 래더 방(경기 전·경기 중)에서 채팅 가능, `room.chat:true`.

## 4. 위협 모델 요약
| 위협 | 대응 |
|---|---|
| 관리자 사칭(닉네임·클라이언트 플래그) | 서버가 계정 세션 + 목록으로만 판정, 요청마다 재판정. 가입된 닉네임은 손님 `hello` 불가(`NICK_REGISTERED`) |
| XSS·HTML 주입 | 서버는 원문 유지(이중 이스케이프 방지), 화면은 `textContent`/캔버스만(innerHTML 금지) |
| 화면 뒤집기·숨은 글자(양방향·0폭 문자) | 서버가 공백으로 치환 |
| 도배·대역폭 | 채팅 1초·10초 5개·같은 글 3회째, 공지 3초·분 10개, 연결당 초당 240 메시지·4KB 상한(기존) |
| 방 밖 엿듣기·로비 확산 | 좌석 두 사람에게만 보냄, 로비 채팅 없음 |
| 욕설 | 최소 목록 가림(우회 가능 — 남은 위험) |
| 공지 남용 추적 | 서버 로그 + jsonl 기록(누가·언제·무엇) |

## 5. 남은 위험·후속
- 욕설 우회(띄어쓰기·자모 분리), 신고·차단·뮤트 없음, 채팅 서버 기록 없음.
- 공지 id·빈도 창은 메모리(재시작 = 1부터).
- 화면(윤프론): 로그 5줄, 입력창(경기 입력과 분리), 공지 중앙 표시(시안 D2/D5/D8), 관리자 공지 토글, 오류 토스트.
