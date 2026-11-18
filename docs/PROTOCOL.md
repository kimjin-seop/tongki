# 피구왕 통키 웹 - 네트워크 프로토콜 (v1)

클라이언트(윤프론)가 이 문서만 보고 붙을 수 있도록 쓴 계약서. 구조는 `..\tank\docs\PROTOCOL.md` 패턴(세션 토큰·재접속·방·토스트 오류)을 따른다.
규칙 근거: `analysis\05_match_rules.md`. 규칙 수치는 `server\data\*.json`, 확정/추정 구분은 코드·JSON의 `[추정]` 주석.

## 0. 전송
- WebSocket `ws://<host>:<PORT>/ws` (기본 PORT 3100, 환경변수 `PORT`). 텍스트 프레임 1개 = JSON 객체 1개, 항상 `{t:'종류', ...}`.
- 최대 4KB. 연결당 초당 240개 초과 시 `RATE_LIMITED` 오류(연결 유지). 서버는 15초마다 WS ping을 보낸다.
- 요청에 선택 필드 `ref`(아무 값)를 달면 실패 시 `error.ref`로 돌아온다.
- HTTP: `/` -> `public\` 정적 서빙(있을 때만), `/health` -> `{ok:true, ...}`. ROM·`analysis\` 는 서빙하지 않는다.
- 시간 값은 서버 epoch ms. 클라이언트 시계는 판정에 쓰이지 않는다.

## 1. 오류와 토스트
모든 거절은 `{t:'error', code, msg, params?, ref?}`. `msg`는 한글 기본 문구, `code`가 문구 키(클라이언트 덮어쓰기 가능). **인라인 박스 금지, 토스트로 표시.**

| code | 기본 문구 |
|---|---|
| BAD_MESSAGE / UNKNOWN_TYPE / RATE_LIMITED | 잘못된 요청입니다 / 알 수 없는 요청입니다 / 요청이 너무 빠릅니다 |
| NOT_LOGGED_IN / ALREADY_LOGGED_IN | 먼저 닉네임을 입력하세요 / 이미 접속한 상태입니다 |
| NICK_INVALID | 닉네임은 2~10자의 한글·영문·숫자만 쓸 수 있습니다 |
| NICK_TAKEN | 이미 사용 중인 닉네임입니다 |
| TOKEN_INVALID | 세션이 만료되었습니다. 닉네임을 다시 입력하세요 (클라이언트는 저장 토큰 폐기) |
| SESSION_REPLACED | 다른 곳에서 접속하여 연결이 종료됩니다 (이전 연결에 전송 후 close) |
| NOT_IN_ROOM / ALREADY_IN_ROOM | 방에 들어가 있지 않습니다 / 이미 방에 들어가 있습니다 |
| ROOM_CODE_INVALID | 방 코드는 4~6자의 영문 대문자·숫자입니다 |
| ROOM_CODE_TAKEN | 이미 사용 중인 방 코드입니다 |
| ROOM_NOT_FOUND / ROOM_FULL / ROOM_IN_GAME | 방을 찾을 수 없습니다 / 방이 가득 찼습니다 / 게임이 진행 중인 방입니다 |
| NOT_HOST / HOST_NO_READY | 방장만 할 수 있습니다 / 방장은 준비할 필요가 없습니다 |
| START_NEED_PLAYERS / START_NOT_READY | 2명이 모여야 시작할 수 있습니다 / 상대가 준비하지 않았습니다 |
| TEAM_INVALID | 팀 번호가 올바르지 않습니다 |
| IN_GAME / NOT_IN_GAME | 게임 중에는 할 수 없습니다 / 게임 중이 아닙니다 |
| INTERNAL | 서버 오류가 발생했습니다 |
| TOO_MANY_CONNECTIONS | 이 네트워크에서 접속이 너무 많습니다 (IP당 동시 연결 상한 초과. 전송 후 close 1008) |
| HELLO_RATE_LIMITED | 접속 시도가 너무 잦습니다. 잠시 후 다시 시도하세요 (IP당 분당 hello 상한) |
| SERVER_FULL | 서버가 가득 찼습니다. 잠시 후 다시 시도하세요 (신규 세션 총량 상한, `hello` 거절) |
| TOO_MANY_ROOMS | 방이 너무 많아 만들 수 없습니다 (`create_room` 거절) |
| CAMPAIGN_LOCKED | 아직 열리지 않은 경기입니다 (`campaign_start`, §8) |
| CAMPAIGN_RATE_LIMITED | 요청이 너무 잦습니다. 잠시 후 다시 시도하세요 (`campaign_*` 세션당 분당 상한) |
| NOT_IN_CAMPAIGN_ROOM | 캠페인 방에서는 할 수 없습니다 (캠페인·특훈 방의 `set_team`, 특훈 방의 `start`) |
| RULES_INVALID | 규칙 값이 올바르지 않습니다 (`set_rules`, `create_room`·`campaign_start` 의 `rules`) |
| LOGIN_TIMEOUT | 로그인 시간이 지나 연결이 종료됩니다 (연결 후 30초 내 `hello` 없음, 또는 `logout` 뒤 5분 내 다시 로그인 없음. 전송 후 close 1008) |
| TRAINING_UNAVAILABLE | 아직 준비되지 않은 튜토리얼입니다 (서버가 닫아 둔 `training_start.kind`, §9.1. 지금은 닫힌 종류가 없다) |
| NOT_IN_TRAINING | 튜토리얼 중이 아닙니다 (`training_quit`) |
| GAME_ABORTED | 경기가 서버 오류로 중단되었습니다 (아래 toast로만 전달) |
| ACCOUNT_REQUIRED | 계정으로 로그인해야 합니다 (`REQUIRE_ACCOUNT=1` 서버의 닉네임 `hello`, 손님의 랭크 방 만들기·입장, §2.1·§11) |
| ACCOUNT_EXISTS / NICK_REGISTERED | 이미 가입된 닉네임입니다 (`register`) / 가입된 닉네임입니다. 비밀번호로 로그인하세요 (닉네임만 보낸 `hello`) |
| PASSWORD_INVALID | 비밀번호는 6~64자로 정하세요 (`register`) |
| LOGIN_FAILED / LOGIN_LOCKED | 닉네임 또는 비밀번호가 맞지 않습니다 / 로그인 실패가 많아 잠시 막혔습니다 (`login`) |
| AUTH_RATE_LIMITED / AUTH_BUSY | 가입·로그인 시도가 너무 잦습니다 (IP당 분당 10회) / 처리 중입니다 (같은 연결에서 앞 요청 처리 중) |
| ACCOUNT_CREATED_RELOGIN | 가입은 되었습니다. 비밀번호로 다시 로그인하세요 (`register` 처리 중에 그 연결이 로그아웃·교체·다른 닉네임 접속으로 바뀐 경우. 계정은 만들어졌고 토큰은 발급하지 않았다) |
| RANKED_LOCKED | 기권이 잦아 잠시 랭크 경기를 할 수 없습니다 (`params.until` = 풀리는 시각 epoch ms, §11) |
| RANKED_RULES_FIXED | 랭크 방은 규칙을 바꿀 수 없습니다 (랭크 방 `set_rules`, 고정값과 다른 `create_room.rules`) |

정의 위치는 `server/net/protocol.js`의 `ERR`이며 이 표와 일치한다. `NOT_IN_GAME`은 정의만 있고 현재 서버가 보내지 않는다.
서버 주도 알림은 `{t:'toast', code, msg, params?}` (예: 한 방에서 엔진 오류로 경기가 중단됨 `GAME_ABORTED`, 이때 `game_end.reason='error'`).

**접속·세션 상한**(환경변수, 기본값): `MAX_CONN_PER_IP`=20 동시 연결/IP, `MAX_HELLO_PER_MIN`=60 hello/IP/분, `MAX_SESSIONS`=2000, `MAX_ROOMS`=1000, `LOGIN_TIMEOUT_MS`=30000, `LOGOUT_LOGIN_TIMEOUT_MS`=300000(로그아웃 시점부터, 연결 시점 타이머는 취소), `MAX_PAUSE_MS`=90000, `MAX_DISCONNECTS`=5. 리버스 프록시 뒤에서는 `TRUST_PROXY=1`(`X-Forwarded-For` 마지막 값을 IP로 사용).

## 2. 세션·로그인·재접속

### 클라이언트 -> 서버
- `{t:'hello', nickname}` 최초 접속. 규칙: 2~10자 한글·영문·숫자, 서버 전체 동시 유일(대소문자 무시). 서버는 검사 전에 유니코드 NFC 정규화 + 앞뒤 공백 제거를 한다(`hello`·`register`·`login` 공통, 조합형 NFD 한글도 완성형과 같은 닉네임).
- `{t:'hello', token}` 재접속. `nickname`은 무시.
- `{t:'ping', clientTime}` -> `{t:'pong', clientTime, serverTime}`.

### 서버 -> 클라이언트
```js
{ t:'welcome', protocol:1, token, nickname, resumed:boolean,
  location:'lobby'|'room'|'game', serverTime, build:'0.1.0', rulesVersion:'r0.1',
  tickRate:60, graceMs:30000,
  teams:[{id:0, name:'팀 01'}, ...25개] }
```
- `token`을 localStorage/sessionStorage에 저장한다(불투명 문자열).
- `welcome` 직후: `location==='lobby'`면 `room_list`, `'room'`이면 `room_joined`, `'game'`이면 `room_joined` + `game_start{resumed:true}` + 최신 `snap`.

### 재접속 규칙
1. 연결이 끊기면 서버는 세션·좌석을 **30초(유예)** 유지한다.
2. 새 WS에서 `{t:'hello', token}` -> `welcome.resumed=true` 와 현재 위치 상태 복구.
3. **대전 중 한쪽이 끊기면 경기는 일시정지**된다. 남은 쪽은 `game_pause`를 받고, 복귀하면 `game_resume`으로 이어진다. 유예(30초) 초과 시 끊긴 쪽 **기권패**(`game_end.reason='forfeit_disconnect'`). 악용 방지로 경기당 좌석별 **누적 일시정지 90초** 또는 **끊김 6회째**(`MAX_DISCONNECTS`=5 초과)에도 기권패. `game_pause.deadline`은 남은 누적 한도를 반영해 유예보다 짧을 수 있다.
   - **이미 승패가 확정된 경기**(`ev end` 이후 연출 구간)에는 일시정지하지 않으며, 이 구간(전멸/서든데스 약 4초, 그 외 3초)에 누가 끊기거나 퇴장해도 확정된 승패·`reason`·`rem`이 그대로 `game_end`와 저장 기록에 쓰인다(기권으로 뒤집지 않음).
4. 대기실에서 끊겼다가 유예가 지나면 자동 퇴장(방장이면 위임, 방이 비면 삭제).
5. 만료된 토큰으로 `hello`하면 `TOKEN_INVALID`.
6. 같은 토큰의 다른 연결이 접속하면 이전 연결은 `SESSION_REPLACED` 후 닫힌다.
- 닉네임 재사용: 끊겨 있고 방에도 없는 세션의 닉네임은 새 `hello`로 즉시 가져갈 수 있다. 방·게임 중이던 세션의 닉네임은 유예가 끝날 때까지 `NICK_TAKEN`.
- 서버 재시작 시 모든 세션/방이 사라진다. 연결이 끊긴 뒤 재접속이 `TOKEN_INVALID`이면 로비(닉네임 입력)로 복귀. (계정 로그인 토큰은 재시작 뒤에도 유효, §2.1)

### 2.1 계정(가입·로그인) — 서버 2026-11-18 박백엔, 클라이언트 2026-11-18 윤프론(접속 화면 탭 손님/로그인/가입, docs/HANDOFF §4-18)
저장: SQLite(`data/tongki.db`, 환경변수 `DB_PATH`). 계정 = 닉네임(위 규칙 그대로, 대소문자 무시 유일) + 비밀번호.

| 요청(로그인 전 연결) | 응답 |
|---|---|
| `{t:'register', nickname, password}` | 가입 + 바로 로그인 -> `welcome{account:true, token}`. 비밀번호 6~64자(`PASSWORD_INVALID`), 이미 있으면 `ACCOUNT_EXISTS`, 다른 사람이 그 닉네임으로 접속·방에 있으면 `NICK_TAKEN` |
| `{t:'register', nickname, password}` (같은 닉네임의 **손님 세션으로 접속 중**) | 그 세션을 계정으로 올린다 -> `{t:'account_ok', token, nickname}`(클라이언트는 저장 토큰을 이 값으로 바꾼다). 위치(로비·방·경기)는 그대로. 다른 닉네임이면 `ALREADY_LOGGED_IN` |
| `{t:'login', nickname, password}` | `welcome{account:true, token}`. 틀림·없는 닉네임 모두 `LOGIN_FAILED`(구분하지 않음). 같은 계정 세션이 이미 있으면 넘겨받는다(`resumed:true`, 이전 연결은 `SESSION_REPLACED`, 방·경기 위치 유지) |
| `{t:'hello', token}` | 기존 재접속과 같다. 메모리 세션이 없으면(유예 만료·서버 재시작) 로그인 토큰으로 보고 맞으면 비밀번호 없이 로그인(`welcome{account:true, resumed:false}`), 만료·폐기면 `TOKEN_INVALID` |
| `{t:'logout'}` (로그인 후) | 로그인 토큰 폐기 + 세션 종료(방·경기 중이면 퇴장 = 기권) -> `{t:'logged_out'}`. 연결은 유지(다시 `hello`/`login` 가능). 로그인 타이머를 로그아웃 시점부터 새로 건다: 5분(`LOGOUT_LOGIN_TIMEOUT_MS`) 안에 다시 로그인하지 않으면 `LOGIN_TIMEOUT` 후 close |

- `welcome` 추가 필드: `account:boolean`(계정 세션인가), `requireAccount:boolean`(서버가 계정 필수인가 = 클라이언트가 닉네임만 입력 칸을 숨길지).
- **토큰**: 계정 세션의 `welcome.token` = 로그인 토큰(랜덤 32바이트 base64url, 30일). 세션 재접속 토큰을 겸하므로 클라이언트는 지금처럼 하나만 저장한다. 서버 DB 에는 sha256 해시만 저장한다. 손님(닉네임만) 세션의 토큰은 종전처럼 메모리 전용(유예 30초).
- **닉네임 보호**: 가입된 닉네임은 `REQUIRE_ACCOUNT` 값과 무관하게 닉네임만 보낸 `hello` 로 쓸 수 없다(`NICK_REGISTERED`). 가입하지 않은 닉네임은 종전 그대로(손님).
- **단계 정책**: 서버 환경변수 `REQUIRE_ACCOUNT=1` 이면 닉네임만 보낸 `hello` 를 `ACCOUNT_REQUIRED` 로 거절(계정 필수). **기본 0 = 종전 방식 유지**(기존 클라이언트가 그대로 동작). 기본값 전환은 사용자 승인 뒤.
- **진행 승계**(2026-11-18 보안 리뷰 반영): 서버가 손님 진행·리그를 이어 주는 경로는 **그 닉네임의 손님 세션으로 접속한 연결에서 `register` 한 경우(`account_ok` 승격)** 하나다. 이것은 "원래 손님 본인만 승계한다"는 보장이 아니다(아래 한계 ①). 로그인 전 연결에서 가입하면(그 닉네임의 손님이 끊겨 있었거나 예전 손님 데이터가 DB·JSON 에 남아 있어도) **빈 진행으로 시작**한다. 남아 있던 손님 데이터는 지우거나 덮지 않고 계정이 읽지 않는 키 `guest-aside:<소문자 닉네임>:<시각 ms>` 로 옮겨 보존한다(서버 로그에 건수·키 기록. `NICK_RE` 에 `:` 가 없어 어떤 세션도 이 키를 쓸 수 없다). JSON 가져오기도 가입된 계정 키는 건너뛴다(§11.5).
- **가입 경합**: 로그인 전 연결의 가입이 비밀번호 해시를 계산하는 사이 같은 닉네임 손님이 `hello` 로 들어오면, 계정은 만들어지고 그 손님 세션은 끝난다(`logout` 과 같은 정리: 방·경기 중이면 퇴장 = 기권, 손님 연결에 `logged_out`. 그 퇴장으로 끝나는 경기의 진행·리그는 계정 키에 기록하지 않는다). 가입 연결은 토큰 없이 `ACCOUNT_CREATED_RELOGIN` 을 받고 비밀번호로 `login` 한다.
- **한계**(수용, 2026-11-18 팀장 결정): ① 손님은 소유 증명(영속 토큰)이 없다. 끊겨 있고 방에도 없는 손님 닉네임은 누구나 `hello` 로 즉시 가져갈 수 있고(§2 닉네임 재사용), 그 연결에서 `register` 하면 위 승계 경로로 **그 손님의 진행·리그가 승계된다**(hello → register 2단계 우회). 원래 손님은 그 뒤 그 닉네임으로 `NICK_REGISTERED`. 손님 진행(캠페인 클리어 단계·리그)은 민감 데이터가 아니라 영속 손님 토큰은 두지 않는다. 랭킹은 계정 전용(§11)이고 가입된 닉네임은 `hello` 로 잡을 수 없으므로, 랭킹·계정이 있는 닉네임은 이 우회의 영향을 받지 않는다. ② 로그인 전 연결 가입의 경우에도 원래 손님은 그 닉네임을 다시 쓸 수 없다(`NICK_REGISTERED`, 비밀번호를 모름). 진행은 `guest-aside:` 행에 남아 있으므로 되돌려 주려면 운영자가 수동으로 옮겨야 한다(자동 복구 경로 없음).
- **보안**: 비밀번호 = `crypto.scrypt`(N 16384, r 8, 64바이트) + 계정별 랜덤 솔트 16바이트, 비교는 `timingSafeEqual`, 없는 닉네임도 같은 비용으로 계산. 평문·해시·토큰은 로그에 남기지 않는다. 로그인 실패 제한(메모리 기록이라 재시작하면 풀림, 15분 창): **(닉네임, IP) 쌍** 5회(`LOGIN_FAIL_NICK`) 또는 **IP** 20회(`LOGIN_FAIL_IP`) 실패면 그 쌍/IP 를 15분(`LOGIN_LOCK_MS`) `LOGIN_LOCKED`(맞는 비밀번호도 거절). **닉네임 단독**(모든 IP 합계)은 잠그지 않고 5회째 실패부터 다음 시도마다 응답을 1초씩 더 늦춘다(최대 10초, `LOGIN_SLOW_STEP_MS`·`LOGIN_SLOW_MAX_MS`). 그래서 남이 내 닉네임으로 실패를 쌓아도 다른 IP(새 기기)에서는 로그인된다(늦어질 뿐). 로그인에 성공하면 그 닉네임 단독 기록과 그 쌍 기록을 지운다. 레이트 리밋: IP당 분당 `register`+`login` 10회(`MAX_AUTH_PER_MIN`), 그리고 `hello` 상한(`MAX_HELLO_PER_MIN`)에도 함께 센다. 평문 비밀번호가 오가므로 공개 배포는 TLS(`wss://`) 필수.
- **배포 필수 주의**: ① 리버스 프록시 뒤에서는 반드시 `TRUST_PROXY=1` — 빠뜨리면 모든 사용자가 프록시 IP 하나로 보여 IP별 로그인 잠금·가입/로그인 레이트 리밋·동시 연결 상한을 전원이 나눠 쓴다(한 사람의 실패로 전원 `LOGIN_LOCKED`). 반대로 프록시 없이 켜면 IP 위조로 우회된다. ② Node 22.5 이상(`node:sqlite`). 22.5~22.12 는 `--experimental-sqlite` 가 필요하다(pm2: `pm2 start server/index.js --name dodge-danpei --node-args="--experimental-sqlite"`), 22.13 이상은 옵션 없이 된다. ③ 공개 시 `wss://`(TLS) 필수. ④ DB 파일은 POSIX 에서 시작 때 권한 0600 으로 좁힌다(본 파일과 그때 있는 `-wal`·`-shm`, Windows 는 건너뜀).

## 3. 로비
- `{t:'list_rooms'}` -> `room_list`. 로비에 있는 사용자에게는 방 생성/삭제/인원/상태 변화 시 서버가 `room_list`를 푸시한다(최대 250ms 단위로 합쳐서 전체 목록).
```js
{ t:'room_list', rooms:[{ code, host:'방장닉네임', players:1|2, max:2, status:'waiting'|'playing', rules:{mode, time} }] }  // 최근 생성 순. rules = 추가 필드(하위 호환, 방 목록 행의 규칙 요약용)
```
- 입장 불가 표시는 클라이언트가 `status==='playing'` 또는 `players>=max`로 한다. 최종 판정은 서버(`ROOM_IN_GAME`, `ROOM_FULL`).

## 4. 방·대기실

| 요청 | 필드 | 설명 |
|---|---|---|
| `create_room` | `code?`(4~6자 A-Z0-9, 생략 시 서버가 4자 발급), `vsCpu?:boolean`(기본 false), `cpuLevel?:1~3`(기본 2) | 만든 사람이 방장(왼쪽 팀). -> `room_joined`. `vsCpu`/`cpuLevel`은 선택 필드(하위 호환: 생략하면 기존 동작). 타입 위반은 `BAD_MESSAGE` |
| `join_room` | `code`(대소문자 무시) | -> `room_joined`. 없는 코드/가득/게임 중이면 오류 |
| `leave_room` | | -> `room_left{reason:'leave'}` 후 `room_list`. **게임 중이면 기권패**(상대에게 `game_end.reason='forfeit_leave'`). 기권한 본인도 순서대로 `game_end` -> `room_state`(waiting) -> `room_left{reason:'leave'}` -> `room_list`를 받는다(`room_left`가 항상 마지막 화면 전환 신호) |
| `ready` | `ready:boolean` | 방장 제외 본인. 방장은 `HOST_NO_READY` |
| `set_team` | `team`(0~24) | 내 팀 선택. 게임 중 불가(`IN_GAME`). 변경 시 내 준비 해제. 두 사람이 같은 팀이어도 허용 |
| `set_rules` | `rules:{mode?, time?}` | **규칙 창**(방장 전용, 대기 중에만). `mode`=`'knockout'`(체력제)/`'official'`(공식), `time`=경기 시간 분 `0`(무제한)/`3`/`5`/`8`. 빠진 필드는 현재 값 유지. 값이 바뀌면 상대 준비 해제 후 `room_state`. 방장 아님 `NOT_HOST`, 게임 중 `IN_GAME`, 틀린 값 `RULES_INVALID`. **`mode:'official'`(こうしき) 을 받는다**(2026-11-18 엔진 이식, §5.7. `server/net/protocol.js` `OFFICIAL_ENABLED=true`. `create_room` 의 `rules` 도 같다). `official` + `time 0` 은 `time 3` 으로 바뀐다(원작 규칙 창 동작: こうしき 는 무제한을 쓸 수 없다). 캠페인 방에서는 `mode` 를 보내도 무시하고 항상 `knockout` |
| `start` | | 방장 전용. 조건: 참가자 2명 + 상대 준비 완료 |
| `transfer_host` | | 방장 위임(상대에게). 좌석이 교환되어 새 방장이 왼쪽 팀이 된다 |

서버 -> 클라이언트
- `room_joined {you, room}` : `you`=내 좌석 번호(`0`=왼쪽 팀/방장 쪽, `1`=오른쪽 팀).
- `room_state {room}` : 대기실 상태가 바뀔 때마다 전체 상태를 방 전원에게.
- `room_left {reason:'leave'|'grace'}` : 로비로 이동(이어서 `room_list`).
- 게임이 끝나면 `game_end` 다음에 `room_state`(status `waiting`, 준비 해제)가 온다. 결과 화면 -> 대기실 복귀는 클라이언트가 이 `room_state`로 처리한다.

```js
room = { code, status:'waiting'|'playing', host:'방장닉네임', serverTime,
  rules:{ mode:'knockout'|'official', time:0|3|5|8 },   // 규칙 창 값. 기본 knockout·5분(= rules.json time.limitFrames)
  start:{ ok:true } | { ok:false, code:'START_NEED_PLAYERS'|'START_NOT_READY', msg },   // 시작 버튼 활성/툴팁
  slots:[ // 항상 길이 2. 0=왼쪽 팀(방장), 1=오른쪽 팀. 비었으면 null
    { seat:0, nick, ready:boolean, team:0~24, host:boolean, connected:boolean } | null,
    ...] }
```
- 시작 조건(서버 판정, 2026-11-18 클라이언트 표시 정리): 방장은 준비가 없다(`HOST_NO_READY`). 2명이 모이고 방장이 아닌 사람이 `ready:true` 일 때만 `start.ok`. 클라이언트는 조건 미달이어도 `시작` 버튼을 누를 수 있게 두고(흐리게), 누르면 `start.msg`(START_NEED_PLAYERS / START_NOT_READY 문구)를 토스트로 낸다. 로비는 방 코드 입력 없이 `room_list` 행을 눌러 그 `code` 로 `join_room` 을 보낸다(메시지 불변).
- **컴퓨터 대전(`vsCpu:true`)** [추가 필드, 하위 호환]
  - 좌석 1은 서버 AI 좌석: `slots[1] = { seat:1, nick:'컴퓨터', ready:true, team, host:false, connected:true, cpu:true }`(접속 세션 없음). `room`에 `vsCpu:true, cpuLevel` 추가. 컴퓨터 팀은 방 생성 시 무작위.
  - `room.start.ok`는 항상 true: 방장이 준비 없이 바로 `start`. 다른 사람은 `join_room` 불가(`ROOM_FULL`). `transfer_host`는 `START_NEED_PLAYERS`. `room_list` 항목에 `vsCpu:true`, `players:2`.
  - 컴퓨터 쪽은 조작 선수 포함 전원을 AI가 움직인다. `game_start.you`는 항상 0. 컴퓨터 좌석은 끊김·일시정지·기권 대상이 아니며, 일시정지/재접속/유예는 사람 한 명 기준으로 동작한다. 방장이 나가면 기권패(`winnerNick:'컴퓨터'`).
  - `cpuLevel` 1(쉬움)~3(어려움): AI 투구 지연·조준 정확도·방어 반응 시점/실수율. 현재 값(`rules.cpu.levels`, [추정]): 1 = 지연 +45f/반응 -6/정면조준 130/실수 130(/256), 2 = +30/-4/150/90(기본, `defaultLevel` 2), 3 = +20/-2/180/60. 임밸런 조정으로 레벨 1~3 이 이전 값보다 한 단계씩 약해졌다(같은 숫자의 컴퓨터가 더 쉬워짐). 캠페인도 이 레벨 표를 쓴다. **CPU 반응 개선(2026-11-17, analysis/15, [추정])**: 레벨별 플래그 `dash`(공 추격 시 AI 대시, 레벨2=진입 64px·상한 1.6px/f, 레벨3=56px·2.0px/f, 절대 상한 `cpu.dashCapPx` 3.5), `outChase`(외야 AI 가 예상 정지 지점이 자기 구역이면 선행 이동), `outReach`(외야 AI 줍기 반경 레벨2=24px, 레벨3=28px, 기본 12; 코트 안쪽 띠 근처에 멈춘 공도 접근해 줍는다). `catch256`(방어 캐치 행동 선택 확률 보정 /256: L1 20, L2 50, L3 80), `catchShift`(캐치 버튼 시점 가산 프레임: -4/-1/0, trigShift 와 분리). **레벨1(캠페인 초반)은 대시·외야 추격을 꺼서 기존 동작 유지(캐치 보정만 약하게).** 대시는 기존 `st`=2(DASH)·이벤트 `dash{p}` 를 그대로 쓰므로 클라이언트 변경 없음.
  - 결과 레코드: 최상위 `vsCpu:true`, `cpuLevel`, `players[1]`에 `cpu:true, cpuLevel`(사람 대전 레코드에는 없음).
- **규칙(`room.rules`)** [추가 필드, 하위 호환]: `create_room` 에 선택 필드 `rules:{mode?, time?}` 를 실으면 그 값으로 방을 만든다(생략 시 기본). 경기 시작 때 서버가 `Match` 옵션으로 넘긴다: `limitFrames = time * 60 * tickRate`(0 = 무제한), `ruleMode = mode`. **`official`(원작 こうしき) 은 2026-11-18 엔진에 이식됐다**(§5.7, analysis/29 §3·§4-1-1). 클라이언트 규칙 창에서 `공식` 을 고르면 `무제한` 이 회색(고를 수 없음)이 되고 시간이 무제한이었다면 3분으로 바뀐다. 캠페인·특훈 방은 언제나 `knockout`.
- 방장이 나가면 상대가 방장이 되고 좌석 0으로 이동한다. 사람이 0명이면 방은 삭제된다.

## 5. 대전

### 5.1 시작
`{t:'game_start', matchId, resumed:boolean, you:seat, seed, tickRate:60, snapEvery:2, stage, teams:[A, B], court, rules, campaign?}`
- `stage`=`{id, key, file, json, romStage}`(배경 선택, §8). `campaign`={k}는 캠페인 경기일 때만.
- `teams[seat]` = `{ id, name, players:[7개] }`, 선수 `{ idx(0~6), role:'infield'|'outfield_top'|'outfield_bottom'|'outfield_back', hp, def, spd, s3, pow, s5, thr, pass }` (원작 능력치 s0~s7, `analysis\05_match_rules.md` 4절).
- `court` = `{ xMin:16, xMax:496, yMin:16, yMax:248, centerX:256, slots:[{slot, a:[x,y], b:[x,y]}...13개] }` px. 화면 y는 `y/2 - z`(의사 3D)로 그린다(원작 방식: 화면y = y/2 - z + 오프셋).
- 선수 id(`pid`) = `seat*7 + idx`(0~13). 좌석 0 = 왼쪽 팀(+x 방향을 바라봄), 좌석 1 = 오른쪽 팀(-x 방향).
- `rules` 는 클라이언트 표시에 필요한 일부(`limitFrames`, `readyFrames`, `maxCharge`, `holdMaxFrames`, `catchWindowAdj`, `crouchFrames`, `swapFrames`=아웃 교체 이동 70f, `downFrames`=쓰러짐 60f). `limitFrames`=이 경기의 제한 시간(60fps 프레임. 규칙 창 값: 10800/18000/28800, **0 = 무제한**: 시계를 그리지 않는다. 기본 18000=5분), `mode`=`'knockout'|'official'`(규칙 창 값). `mode==='official'` 이 원작 규칙모드($E680=1) 플래그다: 클라이언트는 이 값 하나로 HUD 얼굴을 맨 위에 고정한다(별도 `noDamage`/`hpFixedHud` 필드는 없다, §5.7).
- 경기는 `ph:'ready'`(입장 행진·심판 등장·대기, **입력 잠금**) -> GO 에서 `play`(입력·경기 시계 시작) 순서로 시작한다. `rules.readyFrames` = GO 가 나오는 틱 번호(결정적, 팀 능력치 의존 약 350). `rules.start` = 시작 연출 데이터 전체(`server/data/rules.json`의 `start`: 입장 출발점·속도식, 심판 경로/애니 ID, 배너 수명, 점프볼 파라미터 등. 원작 확정값과 [추정] 구분은 그 파일 주석). 상세는 5.5.

### 5.2 입력 (클라이언트 -> 서버)
`{t:'input', bits}` — **프레임별 입력 상태 비트**(0~255, 범위 밖은 조용히 무시). 서버가 판정하며 클라이언트 값으로 상태를 바꿀 수 없다.

| 비트 | 값 | 의미 |
|---|---|---|
| UP | 1 | 위 |
| DOWN | 2 | 아래 |
| LEFT | 4 | 왼쪽(화면 기준) |
| RIGHT | 8 | 오른쪽 |
| B | 16 | 공 없음: 캐치 자세 / 공 보유: 투구(누르고 있는 동안 차지, 떼면 발사) |
| C | 32 | 점프 |
| A | 64 | 공 없음: 공이 움직이면 웅크림(회피), 정지해 있으면 줍기 / 공 보유: 패스 |
| S(Start) | 128 | 공을 든 지상 선수가 누르면 **포메이션 어택 즉시 발동**(§5.6). 그 외에는 무시. 구버전 클라이언트는 0 이라 호환 |

- **눌림 상태가 바뀔 때마다 즉시 전송**하고, 입력이 유지되는 동안 250ms마다 같은 값을 재전송(유실·연결 점검용). 서버는 틱 사이의 짧은 탭도 놓치지 않도록 래치한다.
- 엣지(방금 눌림) 판정·더블탭 대시(같은 방향 16프레임 이내 연타)·조준 그룹 선택은 모두 서버가 한다.
- 좌/우 방향키는 좌석과 무관하게 화면 좌/우 이동이다. 조준·궤적 보정에서 "상대 쪽/반대쪽"은 서버가 좌석별로 해석한다.
- 조작 선수는 **서버가 자동 전환**한다(공 보유자 → 공이 정지/느리면 가장 가까운 선수 → 상대 투구 대상이 내 선수면 그 선수). 공이 **외야 구역**(좌석 기준 상대 코트 위/아래/후방 띠)에 멈출 예정이면 그 구역의 살아 있는 외야 선수 중 공에 가장 가까운 선수로 전환한다(방향키를 눌러도 전환, 외야에 간 공은 코트 안으로 옮기지 않음). **2026-11-17 변경(analysis/15)**: 굴러가거나 튕기는 공도 서버가 마찰·바운스를 시뮬레이션해 구한 예상 정지 지점이 내 외야 구역이면 멈추기 전에 즉시 전환하고(엔진 `predictRest()`), 그 구역 외야 선수가 이미 조작 중이면 내야 최근접으로 다시 전환하지 않는다(깜빡임 제거). 정지 후 재평가 주기 `rules.ctrlSwitch.tickFrames` 는 원작 30 -> 12프레임. 내야로 갈 공도 굴러가는 중에는 예상 정지 지점 기준 최근접으로 전환한다. 프로토콜(필드·이벤트) 변경 없음. 줍기는 **A 키**로만 한다(사람이 조작 중인 선수는 자동 습득 없음, CPU 선수만 자동 습득). 전환은 `snap.ctrl`와 이벤트 `ctrl`로 알린다. 수동 전환 입력 없음. 외야 선수가 조작 중이면 `snap.ctrl` 의 pid 가 `slot>=4` 선수다(클라이언트가 카메라/표식을 이 선수에 맞춰야 한다).
- 조준 그룹(공 보유 중 **방향키를 새로 누를 때** 갱신, 이후 유지): 상대 쪽(좌석0이면 오른쪽 키/좌석1이면 왼쪽 키)=상대 내야, 위=상대 외야 상단, 아래=상대 외야 하단, 반대쪽=상대 외야 후방. 그룹 안에서 거리 최근접이 대상. 현재 값은 `snap.aim`.
- 투구 후 비행 중 방향키로 궤적 보정(↑/↓ 횡 가속, 상대 쪽=위로 보정, 반대쪽=아래로 보정). 필살기 비행 중에는 방향키 보정이 없다(§5.3 필살기).

### 5.3 스냅샷 (서버 -> 클라이언트)
`snapEvery`(=2) 틱마다(=30Hz) 방 전원에게 **전체 상태**를 보낸다(변경분 아님). 틱 사이는 클라이언트가 보간.
```js
{ t:'snap', f:틱번호, ph:'ready'|'play'|'end', clk:남은프레임(60fps 기준, 시작 시 limitFrames; 0=서든데스 중 또는 무제한 경기), sd:boolean,
  rem:[좌석0 생존 인원, 좌석1 생존 인원], ctrl:[좌석0 조작 pid, 좌석1 조작 pid], aim:[좌석0 조준그룹, 좌석1],
  p:[ [x,y,z,st,hp,slot,fl,ch,face,walk,fmWalk] x14 ],      // pid 순서(0~13). walk=입장 행진 중(5.5), fmWalk=포메이션 집합 이동 중(걷기 애니, 5.6)
  b:[x,y,z,mode,holder,power,kind],
  lock:0|1, sq:[단계,단계내틱], cam:96|191|0|null, fm:null|{seat,name,st,t,passes,holder}, fmLeft:[좌석0 남은 횟수, 좌석1], ref:[x,y,anim,at,flip]|null, ban:[종류,나이,수명]|null, tip:[토스됨,포기0,포기1]|null,  // 시작/종료 연출(5.5), 구버전 클라이언트는 무시 가능
  ev:[ ...이벤트 ] }
```
- 좌표 단위: **1/16 px 정수**(`x/16`=px). z(높이)도 동일하게 1/16 px(`z/16`=px). 공 `b`의 x,y,z도 같다.
- `face`(선수 배열 맨 뒤, 인덱스 8): 바라보는 방향 `1`=오른쪽, `-1`=왼쪽. 좌석0 선수는 `1`, 좌석1 선수는 `-1`로 시작(현재 엔진은 고정값). 캐치 후 밀림(`fl&64`) 중에는 서버가 그려지는 방향을 보낸다: `face`=잡은 순간의 좌우(원작 스프라이트 반전 $2 bit7), `fl&128`=캐치 애니 앞뒤(원작 0x8870 이 밀리는 속도 쪽 $3 bit1 의 반대로 고름). 결과적으로 공이 온 쪽을 본 채 밀린다. 클라이언트는 평소처럼 그대로 그린다. 기존 필드 인덱스(0~7)는 불변이므로 `face`가 없는 구버전 클라이언트도 동작한다.
- 선수 `st` 상태 코드: 0 IDLE(걷기/서있기), 1 JUMP, 2 DASH, 3 BRAKE(대시 제동), 4 CHARGE(투구 차지), 5 THROW(투구 후딜), 6 PASS(패스 후딜), 7 CATCH(캐치 자세), 8 CROUCH(웅크림), 9 PICKUP(줍기), 10 HIT(피격 날아감), 11 DOWN(쓰러짐), 12 OUTMOVE(아웃 교체 이동), 13 DEAD(아웃되어 외야에서 대기), 14 GONE(퇴장, 그리지 않음).
- `slot`(0~12): 현재 코트 슬롯(0~3 내야, 4~12 외야). 아웃 교체 시 아웃 시점(DOWN 종료)에 아웃자와 투입 선수가 슬롯 값을 즉시 맞바꾼다(이동 연출 70f 동안 `st=12`, 값은 이동 시작 시점에 이미 바뀜). `fl` 비트: 1=차지중, 2=대시점프, 4=외야, 8=아웃자(DEAD/GONE), 16=공 보유, 32=점프볼 쳐내기 자세 중. `ch`=차지 값(0~15).
- **HUD 내야 4슬롯**: `slot<4 && !(fl&8)` 인 선수가 슬롯 얼굴(투입 중 선수 포함, 외야 소진 후엔 3명 이하). HP=`p[4]`, idx=`pid%7`, 팀=`teams[seat].id`. 별도 필드 추가 불필요(기존 값으로 충분). 새 선수 등장 연출은 `slot<4` 점유 pid 변화로 검출한다.
- **아웃 타이밍**(엔진 현행, 원작과 같은 2단계): 피격 즉시 `hit` 이벤트·`p[4]==0`(선수는 HIT→DOWN 60f, slot·rem 불변) → DOWN 종료 시 `out` 이벤트와 같은 스냅에서 `rem` 감소·slot 교환·`fl&8` 설정(이후 OUTMOVE 70f). 얼굴 하강 연출은 `hp==0` 감지 시 시작하고(교체 후에도 pid 기준 유지), 원작처럼 숫자를 코트 이탈 후에 줄이려면 표시용 `rem` 변화를 `rules.swapFrames`(70f)만큼 늦춘다(서버 `rem`·승패 판정은 그대로, 엔진 규칙 변경 없음).
- 공 `mode`: 0 HELD(보유, `holder`=pid), 1 FLY(투구 비행, 위험), 2 PASS(패스 비행), 3 LOOSE(바운스/구름, 무해), 4 DROP(**심판이 손에 든 공**, 토스 전. 위치는 심판을 따라다니며 서버가 좌표를 준다. 토스되면 LOOSE(3)). 이전 버전의 '시드로 정해진 한쪽 내야에 낙하' 규칙은 폐지(점프볼로 대체). `holder`는 보유 중이 아니면 -1. `power`=현재 위력. `kind`=0 일반 공, `kind`>=1 필살기 비행 중(필살기 ID = `kind-1`, 0~53). 필살기는 `mode`=1(FLY)이며 벽/바닥/천장에 닿거나 피격·캐치되면 `kind`가 0으로 돌아간다(바운스 공). 자세한 내용은 아래 "필살기".
- 이벤트 `ev` (각 항목 `{k, f, ...}`):
  - 시작/종료 연출 이벤트(5.5): `enter`(행진 시작), `ref_in`, `go`, `toss{vz}`, `tip_swing{p}`, `tip_hit{p, seat}`, `tip_end{hit:false}`(공 착지로 점프볼 종료), `ref_out{p, seat}`(아웃 호출)
  - `start` 경기 시작(= GO 와 같은 틱, 하위 호환용으로 유지), `jump{p}`, `dash{p}`, `catch_start{p}`, `crouch{p}`, `pickup{p}`
  - `special{p, id}` 필살기 발동(같은 스냅의 `throw` 직후, `id`=필살기 ID 0~53, 공 `kind`=id+1). 일반 투구는 이 이벤트가 없다
  - `throw{p, tgt, pw, ch}` 투구, `pass{p, tgt}` 패스, `receive{p}` 공 획득(패스 수신·줍기 공통)
  - `catch{p, by:투구자pid, kind?}` 캐치 성공, `hit{p, by, dmg, hp, kind?}` 피격(`dmg`=0이면 방어력으로 무효. こうしき 는 언제나 `dmg` 0·`hp` 불변, §5.7). 필살기에 의한 캐치/피격이면 `kind`(=ID+1)가 추가된다(일반이면 필드 없음)
  - `out{p, swap:교체투입pid|null, rem:[a,b]}` 아웃, `ctrl{seat, p}` 조작 전환
  - `wall` 공 벽 반사, `bounce` 공 바닥 튕김, `timeup`, `sudden_death`(こうしき 는 `sudden_death{rem:[1,1]}`: PLAY OFF 로 양쪽 남은 인원이 1 이 됨, §5.7)
  - `end{winner:seat|-1, reason}` 경기 종료 확정(실제 `game_end`는 `endHold` 후: 전멸/서든데스 240틱(정지 60 + GAME SET 180), 그 외 180틱(TIME UP 등). 5.5)
- **필살기** (엔진 `server/engine/special.js`, 근거 `analysis/06_special_shots.md`)
  - 발동: 점프 중(공중) 투구에서 B를 **13~15프레임 홀드 후 뗄 때**(16f 자동발사는 일반), 내야 슬롯(`slot<4`)일 때만. 지상 투구·외야는 항상 일반. 필살기 ID는 팀·선수별 표(`server/data/specials.json` `row`, -1이면 32항목 풀 무작위). `ch`는 일반과 같이 투구 이벤트에 실린다.
  - 위력: `power[ID]`(255=덮어쓰지 않음)로 덮어쓴다(선수 능력치 무관). `throw.pw`와 공 `power`에 이미 반영.
  - 비행: 중력·방향키 보정 없음. 투구 순간 속도 V0에 ID별 배율/가감속을 적용. 벽/바닥/천장에 닿으면 즉시 일반 바운스 공(`mode` 3, `kind` 0)이 되며 `wall`/`bounce` 이벤트가 나온다. 충돌·캐치·데미지(위력-방어)는 일반 투구와 같다.
  - 캐치: 필살기도 받을 수 있고, 받은 선수는 투구 반대(공 진행) 방향으로 `min(위력,60)+8` px 미끄러진다(미끄럼 중 이동 입력 무시, 투구/패스는 가능).
  - 클라이언트 연출 매핑 키는 `kind-1`(=ID): 효과음 = ID→10종(0xB7~0xC1, analysis §4), 잔상/분신 패턴 = analysis §4 표(서버는 분신 위치를 보내지 않음, 클라가 공 위치 기준으로 생성), 스프라이트 플립 등은 ID별. 공 그래픽 기본은 "불타는 공"이고 ID 1,2,3,6,8,12,29~33,38,48,49는 일반 공 그래픽.
  - 궤적 클래스(ID→): 직선x1.5{0,4,9,11,22,25,28,29,36,38,41,42,52}, 직선x1{1,2,3,5,20,21,31,32,35,37,40,47,50,51}, 직선x0.5{26,27,30}, 완급{6,45}, 정지-이동{12}, 급커브{7,10}, 다이빙{8,15}, 부메랑{13,33,39}, 로브+내리꽂기{14}, 낙구{16,19,44}, 저속후2배{17,46}, 반속후1.5배{18,43}, 상승후2배{23}, 저공활주{24}, 블링크{34}, 루프{49,53}, 더블루프{48}. 루프는 반경 30px 수직 원 근사(원작 ±30px 관측치)로 제자리에서 도는 동안 `b` 좌표가 원 위를 움직인다(스냅샷 보간 시 순간이동처럼 보이지 않도록 필요하면 클라에서 부드럽게).
  - **받아치기 필살**(2026-11-18, 원작 공 `$76`·ROM 0x8C08, 06 §3.3. 원작 실행 확인 = 창 안 지상 투구가 필살·ID/위력/속력 승계·창 종료 뒤 일반·점프 해제·밀림 중 투구 불가, 판독만 = こうしき 비적용·외야 제외·검사 순서): 필살기 공(`kind`>=1)을 캐치 자세로 잡으면 받아치기 창이 열린다(밀리는 동안은 줄지 않고 그 뒤 60틱, 보유자가 점프하면 즉시 닫힘). 창이 열린 동안 내야 선수가 **지상에서 던지면 차지와 무관하게 필살기**가 된다: ID·위력·속력 모두 잡은 공 그대로(던진 선수의 표 ID 가 아니다). 이벤트·스냅샷은 일반 필살과 같다(`throw` 직후 `special{p, id}`, 공 `kind`=id+1) -> 클라이언트 연출(반짝임·효과음·공 그래픽)은 추가 처리 없이 그대로 나온다. 새 키·새 이벤트 없음. こうしき·특훈에는 없다. [미이식] 창이 열린 동안 손에 든 공의 그래픽(원작 `$3E`: 필살 공이면 15, 아니면 잡은 공의 차지 값)은 스냅샷에 창 값이 없어 그리지 않는다. 컴퓨터는 일반 컴퓨터 대전에서도 필살기를 쓴다(2026-11-18 정정, 종전 '쓰지 않는다'는 원작 두뇌 직역 전의 서술): 활성 내야의 원작 두뇌(`ai.js attackRom`)가 공중 차지 투구를 차지 13~15 에서 떼면 필살이 되고, 받아치기 창이 열린 채 즉시 지상 투구(0xD566)하면 받아치기 필살이 되며, 팀 0x17 의 선수 0 은 지상 투구에 차지 15 를 넣어 지상 필살을 던진다(0xCC56, 판독만). `rules.cpu.specialChance256`(기본 0)·캠페인의 경기별 확률은 활성 선수가 아닌 보유자·포메이션 중에 쓰이는 종전 자작 경로에만 걸린다(§8). 실측: 컴퓨터 대 컴퓨터 40경기(레벨 2, `specialChance256`=0)에서 `special` 653회 = 공중 638 + 받아치기 15.
  - 시간제한 모드에서도 필살기는 켜져 있다: 의도된 설계(원작은 시간제한 시 비활성, 웹은 5분 제한과 함께 활성).
  - 서버 옵션: `Match({forceSpecial: true|ID})`는 시뮬레이션/테스트용(내야 선수의 모든 투구를 필살기로 강제), 기본 꺼짐.
- `game_pause{seat, nick, deadline}` 상대 연결 끊김으로 일시정지(스냅샷 중단). `game_resume{}` 재개.

### 5.5 경기 시작·종료 연출 (원작 `analysis\08_start_sequence.md` 근거, 서버 권위)
서버가 단계·위치·타이밍을 정하고 클라이언트는 그대로 그린다(난수는 엔진 rng 하나). 시간은 모두 60Hz 틱.

**단계 `sq=[s,t]`** (`t`=그 단계 진입 후 틱):

| s | 이름 | 길이 | 설명 |
|---|---|---|---|
| 0 | 입장 | 슬롯별 거리/속도, 최장 약 125 | 좌팀 7명 (48,128), 우팀 (464,128) 에서 **동시 출발**(`카메라 96`이라 화면 밖), 슬롯 위치까지 직선 등속, 속도 = 3.0 + spd/16 px/f. 걷는 동안 `p[9]`(walk)=1, `face`=진행 방향. 도착하면 스냅·`p[9]`=0, 정지 자세 방향은 원작 규칙(x>=256 이면 왼쪽, y>=128 이면 뒷모습)을 클라가 적용(`face`는 x>=256 -> -1, 그 외 1) |
| 1 | HUD 대기 | 39 | 입장 완료 +2 후 HUD 얼굴 36틱 등장(클라 연출), +1 후 심판. 서버는 대기만 |
| 2 | 심판 등장 | 99 | `ref` 가 null -> 객체로 바뀜(`ref_in` 이벤트). (256,16)->(256,116) 1px/f walk. 이 틱에 선수 `face`가 팀 기본(좌석0=1, 1=-1)으로 재설정. 공은 심판 손(DROP) |
| 3 | 심판 대기 | 90 | stand |
| 4 | GO | 30~61(무작위) | **`ph` 'ready' -> 'play', `lock` 1 -> 0, 경기 시계·입력 시작.** `go` 이벤트(+`start`), 배너 GO, 심판 hold_ball_go |
| 5 | 토스 | 20 | `toss{vz}` 이벤트, 배너 FIGHT!(GO 대체), 심판 toss, 공 LOOSE: vz 4.5~6.44 px/f, vy +0.125 |
| 6 | 심판 복귀 | 약 35 | (256,116)->(256,12) 3px/f walk, 도착 시 (256,16) 고정 |
| 7 | 관전 | 이후 | 공 x<224 look_left, x>288 look_right, 그 사이 stand. 아웃 호출 중엔 out_call |

- `lock`: 1 이면 **입력 잠금**(서버가 입력을 무시; 클라는 조작 안내/입력 표시만). GO 틱에 0. 종료 후에도 입력은 무시되지만 `lock`은 0 그대로.
- `cam`: 96 이면 **카메라 x 를 96 으로 고정**(s<7, 코트 중앙 x=256 이 화면 x=160). null 이면 클라이언트 일반 카메라(공/선수 추적 등).
- `ref`: null=아직 등장 전(**공도 그리지 말 것**, 이때 `b`는 심판 시작 위치). `[x, y, anim, at, flip]`: x,y=월드 좌표(1/16 px), 발밑 중앙 기준 24x48 한 장(`spr.referee`), `anim`=원작 애니 ID(0 stand, 2 walk, 4 hold_ball_go, 6 toss, 8 out_call, 12 game_set, 14 look_left, 16 look_right — `data.sprite.referee`의 애니 9종과 대응), `at`=그 애니 시작 후 틱(프레임 진행은 `속도+1`틱 기준으로 클라가 계산), `flip`=1 이면 좌우 반전. 그리기 순서는 월드 y 정렬(심판 y 116 은 점프볼 선수 y 128 뒤).
- `ban`: `[종류, 나이(틱), 수명]` 또는 null. 종류 `'go'|'fight'|'game_set'|'time_up'|'play_off'`, 수명 0=무한. 한 번에 하나, 새 배너가 이전 것을 대체. 수명이 지나면 null. 화면 고정 좌표(카메라 무관, 위치·글자 크기는 `data.sprite.banners`/08 §5): GO·FIGHT! (160,72), GAME SET·TIME UP·PLAY OFF (160,112), PLAY OFF 는 8틱 깜빡임(`rules.start.banners`). `play_off`=시간 종료 동점으로 서든데스 돌입(경기는 계속).
- `tip`: 점프볼 진행 중이면 `[토스됨, 좌석0 포기, 좌석1 포기]`, 끝나면 null. 점프볼 참가자는 **각 팀 `idx 0`(pid 0 과 7) 한 명씩**.
- 점프볼 규칙(서버): GO 이후~공이 바닥에 닿거나 쳐낼 때까지(`tip.on`) 참가자(사람)는 **C(점프)·B(쳐내기)만** 유효, 이동 불가, 나머지 선수는 토스 전 제자리·토스 후 일반 AI. C 점프는 상대 쪽으로 vx 0.25 px/f. **토스 전 C = 헛점프 -> 그 좌석 점프볼 포기**(`tip[1|2]=1`, 이후 일반 조작). 점프 중 B 로 쳐내기 자세(`fl&32`, 20틱) 동안 **공이 내려오는 중이고 접촉**하면 성공: `tip_hit{p, seat}`, 공 vz -3.0, vx 3.5 px/f **쳐낸 팀 자기 진영 쪽**(좌석0 -> -x, 좌석1 -> +x), 1회뿐. 아무도 못 치면 `tip_end`(공 착지) 후 일반 규칙. 컴퓨터(AI 좌석)는 토스 후 공 vz<0.5 가 되면 틱마다 31% 로 점프, 최고점에서 쳐내기.
- 조작 선수(`ctrl`)는 점프볼 동안 각 팀 pid 0/7 로 고정, 점프볼이 끝나면 일반 자동 전환.
- **아웃 호출**: 내야 선수 HP 가 0 이 되는 순간 `ref_out{p, seat}`(호루라기, 원작 0xAE) 와 `ref.anim=8`(out_call, 50틱, 아웃 선수가 좌석0 이면 `flip=1`). 인원 감소(`out` 이벤트·`rem`)는 기존대로 DOWN 종료 시점으로 별개.
- **종료**: `end` 이벤트 시점에 `ph`='end'. 전멸/서든데스는 60틱 정지 뒤 배너 `game_set`(180틱), 시간 종료 승패는 즉시 `time_up`(180틱). 배너 시작 틱에 `ref.anim=12`(game_set 만세). `game_end`는 이 구간(240/180틱) 뒤에 온다. 기권·오류 종료는 즉시.
- 재접속(`resumed`)은 위 필드가 모두 스냅샷 안에 있어 그대로 복구된다(단계·심판·배너 나이 포함).
- **원작 대비 바뀐 점**: 5분 제한·서든데스·하드캡은 웹 규칙 유지. 경기 시계는 GO 에서 시작(원작과 동일). HUD 등장(36틱)은 서버가 타이밍만 비워두고 연출은 클라가 한다. 사람 점프볼 참가자의 이동 금지, 쳐내기 자세 길이·접촉 판정 폭은 [추정]. 시간 종료 후 PLAY OFF 이후 재시작 연출은 없음(서든데스 연속).

### 5.6 포메이션 어택 (원작 `analysis_formation_cutin.md`, 서버 권위)
공을 든 팀이 같은 편 7명을 팀별 고정 위치로 모아 자동 패스를 돌리다 **엔드 어택**을 던지는 작전. 사이드당 경기마다 **3회**, 전 모드 적용. `rules.formation.enabled=false`(서버 `rules.json`)면 꺼지며 이때 `fmLeft=[0,0]`, `rules.formation={enabled:false}`.

**발동**: 입력 bit7(S=128)의 **눌림 엣지**, 한 번이면 즉시 시작(YES/NO 창 없음). 서버 조건(하나라도 어긋나면 조용히 무시): 경기 `play`·점프볼 끝남·승패 미확정 / 진행 중 포메이션 없음(양 팀 통틀어 1개) / 공 `HELD` 이고 보유자가 내 편·지상·행동 가능(차지·점프·피격 아님) / 내 생존 인원 >= 4 / `fmLeft[seat] > 0` / 내 팀 생존자 전원이 피격·쓰러짐·교체 이동·공중이 아님. 컴퓨터 좌석은 입력 대신 서버가 판단한다(공을 잡을 때마다 팀별 문턱 2~4회 도달 시 약 50%).

**`snap.fm`** = 진행 중이 아니면 `null`, 아니면 `{seat, name, st, t, passes, holder}`
| 필드 | 의미 |
|---|---|
| seat | 발동한 좌석 |
| name | **작전 이름 번호 0~14**(ROM 그래픽 순서). `spr.formation` 의 `name_NN` 과 대응(`data.sprite.formation` team_to_name 참고). 배너 = `name_NN`(기준점 (128,96)) + `label_formation`(192,96) |
| st | 단계. 0 GATHER(집합 이동) / 1 HOLD(대기 60틱) / 2 PASS(자동 패스 순환) / 3 END(엔드 어택 점프, 투구 직전) |
| t | 현재 단계 진입 후 틱(HOLD 는 0~59, 60 에서 PASS) |
| passes | 지금까지 성공한 패스(수신) 횟수(최대 32) |
| holder | 현재 공 보유자 pid(패스 비행 중에는 직전 보유자) |
- `fmLeft=[a,b]`: 좌석별 남은 횟수(발동 시점에 즉시 -1, 이벤트 `fm_start.left` 도 같은 값). HUD 공 아이콘 개수용.
- `p[10]`(fmWalk)=1 이면 그 선수가 집합 위치로 걷는 중(`face` 는 진행 방향). 집합 중 `st` 는 항상 0(IDLE)이다. 패스한 선수는 `st=6`(PASS) 후딜.
- `cam`: HOLD·PASS 단계에서만 서버가 **x 고정값**을 보낸다(좌석0 발동=191, 좌석1 발동=0, `rules.formation.cam`). GATHER·END 에서는 기존 규칙(96/null). 값이 있으면 클라이언트는 공 추적 카메라 대신 그 x 로 이동·고정한다.
- 팀 사이 시계: **GATHER·HOLD 동안 경기 시계(`clk`) 정지**(원작). PASS 부터 다시 흐른다. 상대 팀은 그동안 정상 진행(입력·AI).
- 포메이션 팀 선수 입력은 무시된다(B 의 "받는 순간 홀드" 판정만 읽음). 조작 선수(`ctrl`)는 공 보유자를 따라 자동 이동.

**단계 진행**: GATHER(전원 도착, 속도 3+spd/16 px/f) -> HOLD 60틱 -> PASS: 보유자가 순환 순서의 다음 선수에게 **8 px/f 고정**으로 자동 패스(`FLY` 가 아닌 `PASS` 공이라 **상대가 맞히거나 가로챌 수 없음**), 수신 약 10틱 뒤 다음 패스. **수신 순간** 판정: 사람 = 그 순간 B 를 누르고 있거나 패스 32회 / 컴퓨터 = 수신마다 25% 성공을 5회 누적(또는 32회) -> END. END: 수신자가 점프, 최고점에서 상대 현재 조작 선수에게 투구. 위력 `s4*4`(=`pow*4`), 속도 `s6/16+4` px/f(= `thr/16+4`), 필살기 판정 없음(`kind=0`, `special` 이벤트 없음). **막기(캐치·웅크림·점프 회피)는 일반 투구와 동일하게 가능**. 투구 후 포메이션 종료(`fm=null`).
- 중단: 공이 패스 비행 중 아닌데 보유자를 잃거나(`ball_lost`), 수신자가 없거나(`no_receiver`), 경기 종료(`end`) 시 `fm_cancel`. 이미 차감된 횟수는 돌려주지 않는다.

**이벤트**(`snap.ev`)
| k | 필드 | 시점 |
|---|---|---|
| `fm_start` | `{seat, team, name, left}` | 발동 틱. 작전 이름 배너 시작, `left`=차감 후 남은 횟수 |
| `fm_ready` | `{seat}` | HOLD 종료(PASS 진입). 배너 종료 |
| `pass` | `{p, tgt, fm:1}` | 자동 패스(일반 `pass` 와 같은 형식에 `fm:1` 추가). 효과음 `sfx.formation.pass` |
| `receive` | `{p}` | 패스 수신(기존 이벤트 그대로) |
| `jump` | `{p}` | 엔드 어택 점프 시작(기존 이벤트) |
| `fm_end` | `{seat, p, tgt, pw}` | 엔드 어택 투구(같은 틱에 `throw{..., fm:1}` 가 먼저 나온다) |
| `fm_cancel` | `{seat, why}` | 중단. `why`='ball_lost'/'no_receiver'/'end' |
- `throw` 이벤트에 엔드 어택일 때만 `fm:1` 이 붙는다. 이후 `catch`/`hit` 는 일반과 같다.

**`game_start.rules.formation`**: `{enabled, uses:3, startBit:128, holdFrames:60, passSpeed:8, passInterval:10, maxPasses:32, cam:[191,0], names:[좌석0 팀의 작전 이름 번호, 좌석1]}`. 꺼져 있으면 `{enabled:false}`. 재접속(`resumed`)은 `snap.fm`·`fmLeft` 로 상태가 그대로 복구된다.

### 5.7 こうしき(공식) 규칙 — `rules.mode === 'official'` (원작 `$E680`=1, analysis/29 §3·§4-1-1, 서버 권위)

새 메시지는 없다. 방의 `rules.mode`(`set_rules`·`create_room`) -> `game_start.rules.mode` -> `Match` 옵션 `ruleMode:'official'` 로만 전달된다. 주지 않으면 체력제(`knockout`)이고 종전 경로와 같다(차분 하네스 기존 67개 결과 불변).

| 항목 | 체력제(`knockout`) | こうしき(`official`) | 클라이언트에 보이는 것 |
|---|---|---|---|
| 피격 데미지 | 위력 − 방어 | **0** (HP 불변) | `hit{dmg:0, hp}` |
| 아웃 | HP 0 인 선수가 쓰러짐이 끝날 때 | **맞은 공이 바닥에 닿거나 상대편이 잡으면, 쓰러짐이 끝날 때 아웃.** 같은 편이 바닥 전에 잡으면 세이프(일어난다). 외야 슬롯은 아웃 없음 | 아웃 시점에 `ref_out` -> `out{p, swap, rem}`, 그 선수의 스냅샷 `hp` 가 0 이 된다. 세이프는 이벤트 없음(일어날 뿐) |
| 심판 콜(`ref_out`) | HP 가 0 이 되는 피격 순간 | 아웃이 확정되는 쓰러짐 끝 | 같은 이벤트 |
| 필살 슛 | 공중 차지 13~15 | **나가지 않는다**: 차지는 되고 위력·속력의 차지 가산도 그대로인 일반 슛 | `special` 이벤트 없음, `b[6]`(kind) 0 |
| 제한 시간 | 무제한/3/5/8분(자작 조합 포함) | **3/5/8분만**(`time 0` 은 서버가 3 으로) | `limitFrames`, `clk` |
| 시간 종료 | 인원 많은 쪽 승, 동수 = 서든데스(인원 그대로) | 인원 많은 쪽 승, 동수 = **PLAY OFF**: `TIME UP` 배너 181f -> `PLAY OFF` 배너 181f 동안 선수 정지(입력 무시, 피격·캐치 판정 없음, 시계 0:00. 공은 `TIME UP` 구간에 움직인다[실측 181f 중 좌표 변화 95f]. `PLAY OFF` 구간은 실측 좌표 변화 0f 인데 이미 멈춘 공이어서 공 오브젝트가 도는지는 미확인, 서버는 두 구간 모두 공 물리를 돌린다) -> **양쪽 남은 인원을 1 로** 만들고 재개 -> 다음 아웃 1번으로 끝 | `timeup` + 배너 `time_up`(`ph` 는 `play` 그대로) -> 배너 `play_off` -> `sudden_death{rem:[1,1]}`, `snap.sd=true`, `snap.rem=[1,1]`, 종료 `reason:'sudden_death'` |
| 컴퓨터 방어 결정 | 서기/캐치/웅크림/점프/옆걸음 | 서기/캐치/웅크림/**캐치/서기** | - |
| HUD | 얼굴이 체력에 따라 내려옴 + 가운데 인원 숫자 쌍 | **얼굴 맨 위(y 8) 고정·떨림 없음** + 가운데 인원 숫자 쌍(`rem`, 같은 숫자) + 시계 | `hud.js` 의 `official` 옵션 |

- 스냅샷 형식은 그대로다(추가 키 없음). 선수 `hp` 는 아웃 전까지 처음 값 그대로 온다.
- 동수가 아닌 시간 종료는 종전과 같다: 그 틱에 `end{reason:'timeup'}` + `TIME UP` 배너 180f(원작은 배너가 끝난 뒤 승패를 정하지만 결과는 같다).
- 정지 구간에는 날아가는 공이 선수를 지나가도 `hit`·`catch` 이벤트가 나오지 않는다(원작 판독: 선수 오브젝트가 돌지 않음). 미확인(포메이션 진행 중 시간 종료): 비직역 패스의 `receive` 는 정지 중에도 나올 수 있다(원작 미조사).
- 원작과 다른 점·미확인은 analysis/29 §4-1-1 표.

### 5.4 종료
`{t:'game_end', matchId, winner:seat|-1, winnerNick, reason, rem:[a,b], ticks, you}`
- `rem`은 승패 확정 시점의 생존 인원으로 고정된다(연출 구간 중 변동 무시). 기권/오류 종료는 종료 시점 값. 승패 확정 후 연출 구간은 5.5(`endHold`), 이 구간 동안 일시정지하지 않는 규칙은 그대로.
- `reason`: `annihilation`(전멸), `timeup`(시간 종료 인원 우세), `sudden_death`(시간 종료 동수 뒤 첫 아웃. こうしき 도 이 사유로 끝난다), `forfeit_disconnect`(유예 초과), `forfeit_leave`(퇴장), `draw_cap`(하드캡 무승부, winner=-1. 제한 시간 경기 15분, 무제한 경기 30분 `time.unlimitedCapFrames` [자작 안전망]), `error`(서버 오류 중단, winner=-1).
- 직후 `room_state`(waiting)가 온다.

## 6. 결과 레코드 (서버 저장, 클라이언트 노출 없음)
`data\results\results.jsonl`(환경변수 `RESULTS_PATH`)에 한 줄 JSON: `{matchId, roomCode, startedAt, endedAt, players:[{seat,nickname,team}], winner:nickname|null, loser:nickname|null, endReason, ticks, remaining:[a,b], seed, buildVersion, rulesVersion}`. 캠페인 경기는 추가로 `vsCpu:true, cpuLevel, campaign:{k, stage}`. 모든 레코드에 `rules:{mode, limitFrames}`(규칙 창 값, 0 = 무제한) 추가. 랭킹 화면은 만들지 않는다.

## 7. 클라이언트 구현 메모
- 렌더: 서버 `snap` 2개 사이를 보간(30Hz 입력, 60fps 렌더). 서버 상태가 정본이므로 로컬 예측은 1차에서 하지 않는다.
- 소리/이펙트는 `ev`로 트리거한다. 스냅샷 한 개의 `ev`는 이전 스냅샷 이후의 모든 이벤트를 담는다(중복 없음).
- 재접속 후 첫 `snap`에서 `ev`는 비어 있을 수 있다.
- 에러는 토스트. 로비/대기실/대전 화면 전환은 `welcome.location`, `room_joined`, `room_left`, `game_start`, `game_end`+`room_state`로 결정한다.
- 키보드 매핑(`public/js/game/input.js`): 화살표 = 방향, A = A(64), S = B(16), D = C(32), F = S(128). 터치 가상 패드는 A/B/C + 작은 F 버튼. Ctrl/Alt/Meta 조합·입력칸 타이핑은 가로채지 않는다.
- 포메이션(§5.6) 클라이언트: 작전 이름은 `snap.fm.st` 가 0~1(집합·대기)인 동안 한글 도트 글자로 상단 중앙(y74 고정)에 그린다(`public/js/game/formation.js`, 이름 번호 → 한글은 analysis/14 §3.4, 범위 밖은 '포메이션 어택'). 이벤트 대신 스냅 상태로 그려 재접속에도 그대로 복구된다. 원작 일본어 그래픽 `spr.formation` 은 쓰지 않는다. 남은 횟수 = `fmLeft[you]` 를 내 쪽 인원 숫자 아래 공 `rules.formation.uses` 개(남은 것만 밝게). `p[10]`=1 이면 걷기 애니. `fm` 이 있고 `cam` 이 오면 즉시 고정 대신 일반 카메라 속도(틱당 4px)로 그 x(원작 기준, 와이드는 -39 후 0~113 클램프)로 이동한다. 패스 공(`mode` 2)·엔드 어택(`throw{fm:1}`)은 기존 렌더 그대로. 효과음은 `pass{fm:1}` 에 `sfx.formation.pass` 키만(에셋 없으면 무음).

## 8. 싱글 캠페인(스토리) 모드
15경기(k=0~14). **상대 팀·스테이지·내 팀·컴퓨터 난이도는 전부 서버 표(`server/data/campaign.json`)가 정한다.** 클라이언트가 `campaign_start`에 다른 필드를 실어도 무시한다. 근거: `analysis/09_team_names.md` A-4(k>=7부터 내 팀 22).

| k | 내 팀 | 상대 팀 | 스테이지(stage.id = stage_NN) | cpuLevel | 필살기 확률/256 |
|---|---|---|---|---|---|
| 0 | 0 | 1 | 0 | 1 | 0 |
| 1 | 0 | 3 | 1 | 1 | 0 |
| 2 | 0 | 2 | 1 | 1 | 4 |
| 3 | 0 | 5 | 2 | 2 | 16 |
| 4 | 0 | 6 | 3 | 2 | 12 |
| 5 | 0 | 7 | 4 | 2 | 32 |
| 6 | 0 | 4 | 5 | 2 | 20 |
| 7 | 22 | 17 | 6 | 2 | 56 |
| 8 | 22 | 18 | 7 | 3 | 64 |
| 9 | 22 | 21 | 8 | 3 | 72 |
| 10 | 22 | 19 | 9 | 3 | 72 |
| 11 | 22 | 20 | 10 | 3 | 64 |
| 12 | 22 | 16 | 11 | 3 | 72 |
| 13 | 22 | 15 | 12 | 3 | 80 |
| 14 | 22 | 23(보스) | 12 | 3 | 64 |

cpuLevel(1~3)은 `server/data/rules.json` `cpu.levels` 의 난이도(holdDelayAdd/trigShift/aimFwd256/blunder256: 1=45/-6/130/130, 2=30/-4/150/90, 3=20/-2/180/60, 기본 2)이고, 필살기 확률은 임밸런이 시뮬레이션으로 최종 조정한 값 [추정]이다(임시 곡선 아님). 표는 `server/data/campaign.json` 과 같아야 한다.
측정 기준: 봇 레벨2 100시드 승률 초반 약 80%·보스 29%, 레벨3 60시드 보스 25%, 보스 필살기 경기당 약 6.2회. 알려진 한계: 12·14번째 경기(k=11·13)는 타임업 비율이 높다.

스테이지 번호는 `public/assets/rom/bg/stage_NN` 의 NN 이며 ROM stage 번호(`romStage`)와 다르다(예: NN 08 = ROM 5).

### 8.1 요청 (로비 상태에서만. 이미 방/게임 중이면 `ALREADY_IN_ROOM`)
- `{t:'campaign_list'}` -> 서버가 `campaign_list` 응답.
- `{t:'campaign_start', k:0~14, rules?:{time}}` -> 서버가 비공개 캠페인 방을 만들어 **준비 없이 바로 시작**한다: `room_joined`(`room.campaign={k}`, `room.vsCpu=true`) -> `room_state` -> `game_start`. `k > progress.clearedMax+1` 이면 `CAMPAIGN_LOCKED`, `k` 가 정수 0~14 가 아니면 `BAD_MESSAGE`.
- `rules.time`(선택, 0/3/5/8분): 이 경기의 제한 시간. 생략하면 경기 표의 `timeMin`(`campaign.json` 선택 필드, 현재 전 경기 미지정) -> 없으면 기본 5분. 틀린 값은 `RULES_INVALID`. `mode` 는 보내도 무시하고 `knockout`(원작 스토리는 체력제). 같은 방 재도전(`start`)은 그 방의 `rules` 를 그대로 쓰고, 대기 중 `set_rules` 로 바꿀 수 있다.
- 이전 캠페인 경기가 끝나 대기 중인 방이 남아 있으면 `campaign_start` 가 그 방을 자동으로 나가고 새로 시작한다. 요청이 거절되면(`RULES_INVALID`·`TOO_MANY_ROOMS` 등) 옛 방은 그대로 남는다(검증을 전부 끝낸 뒤에 나간다). 같은 경기 **재도전은 `{t:'start'}`**(같은 방, 같은 k) 또는 `campaign_start` 로 한다(무제한).
- 캠페인 방에서 `set_team` 은 `NOT_IN_CAMPAIGN_ROOM`, `ready`/`transfer_host` 는 기존 컴퓨터 대전과 같다. 다른 사람은 `join_room` 불가(`ROOM_IN_GAME`/`ROOM_FULL`).
- 캠페인 방은 `room_list`(공개 목록)에 나오지 않는다. 방 코드는 서버가 발급한다.
- 레이트 리밋: 세션당 분당 `campaign_list`+`campaign_start` 합산 30회(환경변수 `MAX_CAMPAIGN_PER_MIN`), 초과 시 `CAMPAIGN_RATE_LIMITED`. 기존 연결당 초당 240개 제한도 적용.

### 8.2 서버 -> 클라이언트
```js
{ t:'campaign_list', progress:{ clearedMax:-1~14, last:null|0~14 },   // clearedMax=클리어한 가장 높은 k(-1=없음), last=마지막으로 치른 경기
  chapters:[{ k, teamMine, teamOpp, stage, unlocked:boolean, cleared:boolean } x15] }   // unlocked = k <= clearedMax+1
{ t:'campaign_result', matchId, k, win:boolean, reason, progress:{clearedMax,last},
  unlocked:null|k+1,       // 이번 승리로 새로 열린 다음 경기(이미 열려 있었거나 마지막 경기면 null)
  final:boolean }          // 보스(k=14) 승리
```
- `campaign_result` 는 해당 경기의 `game_end` 직후에 온다(재접속·기권 포함 모든 종료). `win=true` 는 사람 좌석이 정상 종료(`annihilation`/`timeup`/`sudden_death`)로 이긴 경우뿐이다. 패배·기권(`forfeit_*`)·오류·무승부는 `win=false` 이고 `clearedMax` 는 변하지 않는다(`last` 만 갱신).
- `game_start` 에 하위 호환 필드 추가(캠페인이 아니어도 `stage` 는 항상 온다): `stage:{ id, key:'bg.stage.NN', file:'rom/bg/stage_NN', json:'rom/bg/stage_NN.json', romStage }`(배경 키·시차 json 경로, `public/assets/rom/bg` 기준), 캠페인이면 `campaign:{k}`. 일반 대전·컴퓨터 대전은 `stage.id=0`.
- 스테이지별 **마찰·바운스**는 서버 엔진이 적용한다(`server/data/stages.json`, 표 0x54BA/0x54E8). 스테이지 0 은 기존과 동일한 값이라 결과가 바뀌지 않는다. 클라이언트 렌더에는 영향 없음(원하면 `stage_NN.json`의 `parallax` 사용). 바운스 시프트 3 스테이지(5,6,12)의 공은 원작 정합 규칙(중력 먼저 적용 후 위치 갱신, 반발 속도가 중력 이하면 정지)으로 몇 회(중앙값 약 12회, 약 3.5초) 튀고 멈춘다. 공 상태 필드(`ball`)·이벤트 형식은 변하지 않는다(내부 `bv` 필드 제거, 스냅샷 미노출).
- 컴퓨터는 캠페인에서 점프 투구+B 13~15프레임으로 **필살기를 쓸 수 있다**(`special` 이벤트, 사람과 동일 조건·서버 판정). 확률은 경기별 `specialChance256`. [2026-11-18 정정] 일반 컴퓨터 대전(`create_room{vsCpu}`)의 컴퓨터도 필살기를 쓴다: 이 확률(`specialChance256`, 일반 대전 0)은 종전 자작 경로에만 걸리고, 활성 내야의 원작 두뇌는 확률 값과 무관하게 공중 차지 13~15 필살·받아치기 즉시 투구 필살(팀 0x17 선수 0 은 지상 차지 15 필살)을 던진다(§5 필살기 절).
- 재접속·일시정지·유예(30초)·기권 규칙은 기존 컴퓨터 대전과 같다(`welcome.location='game'` 이면 `game_start{resumed:true, campaign}` 가 이어진다). 유예 초과 기권은 패배 처리(진행 불변).
- 오류 코드 추가: `CAMPAIGN_LOCKED`(아직 열리지 않은 경기), `CAMPAIGN_RATE_LIMITED`, `NOT_IN_CAMPAIGN_ROOM`.

### 8.3 저장·보안 범위 (개인용 단계)
- 진행 저장소: `data/progress/progress.json`(환경변수 `PROGRESS_PATH`), 닉네임(소문자) 키 `{nick, clearedMax, last, updatedAt}`. 임시 파일에 쓴 뒤 rename 으로 원자적 교체. 파일 기록은 clearedMax 가 오른 승리 때만(100ms 디바운스, 종료 시 flush), 패배/기권의 `last` 는 메모리에만 유지(재시작 시 소실). 영속 항목 상한 5000(초과 시 clearedMax 최저·최오래 항목 정리, 더 높은 것만 남으면 신규 거부). 로드 시 JSON 파싱 실패면 원본을 `progress.json.corrupt-<타임스탬프>` 로 보존하고 빈 상태로 시작, clearedMax 가 0~14 정수가 아닌 항목은 무시. 구현 `server/store/progress.js`.
- 진행은 **세션 토큰으로 인증된 연결**에서만 읽고 쓰며, 값은 서버가 경기 결과로만 올린다(클라이언트가 보낸 진행 값은 없음).
- 2026-11-18: 저장이 SQLite(`data/tongki.db` 의 `progress` 표)로 바뀌었다. 클리어 없는 사용자의 `last` 도 이제 DB 에 남고 항목 상한은 없다. 위 JSON 설명은 `JsonProgressStore`(테스트·폴백용으로 남김) 기준이다. 기존 `progress.json` 은 서버 첫 시작 때 한 번 가져온다(§11.5).
- 2026-11-18: 계정(§2.1)이 생겨 **가입한 닉네임은 탈취되지 않는다**. 아래 한계는 가입하지 않은 손님 닉네임에만 남는다.
- **알려진 한계(공개 전 재검토)**: 계정/비밀번호가 없어 닉네임이 곧 신원이다. 세션 만료(유예 30초 후) 뒤 다른 사람이 같은 닉네임으로 접속하면 그 진행을 이어받는다(닉네임 탈취). 개인용 단계에서는 수용하며, 공개 전에 계정 또는 영구 토큰 도입을 재검토한다. 결과 레코드(§6)에는 `campaign:{k, stage}` 가 추가된다.

## 9. 특훈 (혼자 하기 전용) — 캐치 특훈·필살 슛 특훈 (화면 표기 = `튜토리얼`: 공 받기·필살기, §9.4)
원작 `炎の猛特訓`(analysis/29 §1). 온라인 방이 아니다: 서버가 비공개 방을 만들어 준비 없이 바로 시작하고, 끝나면 방을 없애고 로비로 돌려보낸다. 진입 조건·저장·보상 없음. 팀(내 쪽 22, 연습 상대 24)·스테이지(`stage.id` 13)·투구 표는 전부 서버 표(`server/data/training.json`)가 정한다.

### 9.1 요청 (로비 상태에서만. 방·게임 중이면 `ALREADY_IN_ROOM`)
- `{t:'training_start', kind:'catch'|'special'}` -> `room_joined`(`room.training={kind}`, `room.vsCpu=true`) -> `room_state` -> `game_start` -> `snap`...
  - `kind`: `'catch'` = 캐치 특훈(3단계), `'special'` = 필살 슛 특훈(§9.5). 그 밖은 `BAD_MESSAGE`. 캐치 3단계를 마쳐도 필살 슛 특훈으로 이어지지 않는다(따로 시작한다). `TRAINING_UNAVAILABLE` 은 서버가 닫아 둔 종류에만 쓴다(지금은 둘 다 열려 있어 나오지 않는다. 필살 슛 특훈을 넣기 전의 서버는 `'special'` 에 이 코드를 돌려준다).
  - 레이트 리밋은 캠페인과 같은 창을 쓴다(세션당 분당 30회 합산, 초과 `CAMPAIGN_RATE_LIMITED`).
- `{t:'training_quit'}` 그만두기(일시정지 창의 `やめる`). 특훈 중이 아니면 `NOT_IN_TRAINING`. 서버 일시정지는 없다(창을 띄운 동안에도 경기는 흐른다).
- `{t:'input', bits}` 는 대전과 같다. 캐치 특훈에서 공을 들었을 때 **B·A 모두 상대 조준 투구**다(패스 없음). 포메이션(S)은 없다. 필살 슛 특훈의 조작은 §9.5.
- `leave_room` 도 쓸 수 있다(기권 처리: `game_end.reason='forfeit_leave'` -> `training_end{cleared:false}` -> `room_left`). 완료 연출(24틱) 중에 보내면 `game_end.reason='training_clear'` -> `training_end{cleared:true}` -> `room_left` 이고 `room_left` 는 한 번만 온다.
- 특훈 방에서 `set_team`·`start` 는 `NOT_IN_CAMPAIGN_ROOM`(특훈은 `training_start` 로만 시작한다). 특훈 방은 `room_list` 에 나오지 않는다.

### 9.2 서버 -> 클라이언트
- `game_start` 에 추가 필드 `training:{kind:'catch', step:0, balls:10, pass:6, steps:3}`(`balls` = 단계당 상대 투구 수, `pass` = 합격선, `steps` = 단계 수). `you` 는 항상 0, `teams[0].id`=22, `teams[1].id`=24, `rules.limitFrames`=0(시계 없음), `rules.readyFrames`=0, `rules.formation={enabled:false}`.
- 스냅샷 `snap` 에 추가 필드 **`tr`**(특훈일 때만 있다):
```js
tr: { step:0~2,          // 현재 단계(0부터)
      count:0~10,        // 이번 단계에서 잡은 수(HUD 왼쪽 `캐치 NN구`)
      left:10~0,         // 남은 상대 투구 수(HUD 오른쪽 `남은 NN구`)
      phase:'intro'|'play'|'settle'|'result'|'done',
      msg:0~10,          // 연습 상대 말풍선 번호(0 = 없음). 번호 -> 원문은 training.json messages / analysis/29 §1-3
      retry:0~ }         // 같은 단계를 다시 하는 횟수(단계를 통과하면 0)
```
  - `intro`(120틱): 예고 말풍선(`msg` 1단계 5, 2단계 9, 3단계 10, 재시도 7). **입력 무시**, 카운터 0. 선수 위치·공 보유자는 직전 그대로.
  - `play`: 연습. 상대가 10번 던지고 그 공이 투구 비행을 마치면(잡힘·맞음·바닥·벽) 끝.
  - `settle`: 전원이 멈출 때까지 대기 + 페이드 24틱. 입력 무시. (29 §4 초안의 `phase` 3값에 더한 값이다.)
  - `result`(180틱): 결과 말풍선(`msg` 1 = 0~1개, 2 = 2~5개, 3 = 6~8개, 4 = 9~10개). 끝나면 6개 이상 = 다음 단계 `intro`(3단계였으면 종료), 5개 이하 = 같은 단계 `intro`(`retry`+1).
  - `done`: 완료 직후(`ph:'end'`, 24틱 뒤 `game_end`).
- 스냅샷의 다른 필드: `ph` 는 처음부터 `'play'`, `lock` 0, `sq=[7,0]`, `cam`·`ref`·`ban`·`tip`·`fm` 은 null, `rem=[1,1]`, `clk` 0, `fmLeft=[0,0]`. **`ref` 가 null 이어도 공을 그려야 한다**(§5.5 의 "ref null 이면 공을 그리지 않는다"는 `tr` 이 없을 때만). 양쪽 내야는 pid 0 과 7 한 명씩(`slot` 0), 나머지 12명은 외야 슬롯 5,6,8,9,11,12 다. HP 가 0 이 돼도 아웃(`out`·`ref_out`)은 없다.
- 이벤트(`snap.ev`): 기존 `throw`/`special`/`catch`/`hit`/`pass`/`receive` 등은 그대로. 추가 `tr_result{step, count, grade:0~3, pass:boolean}`(결과 말풍선이 뜨는 틱), `tr_step{step, retry}`(다음 예고가 시작되는 틱), 완료 때 `end{winner:0, reason:'training_clear'}`.
- 종료 순서: `game_end{reason}` -> **`training_end{matchId, kind, cleared:boolean, reason}`** -> `room_left{reason:'leave'}` -> `room_list`. `game_end` 뒤에 `room_state`(waiting)는 오지 않는다.
  - `reason`: `training_clear`(3단계 통과, `cleared:true`, `winner:0`), `training_quit`(`winner:-1`), `forfeit_leave`/`forfeit_disconnect`(퇴장·유예 초과·끊김 횟수 초과·누적 일시정지 초과), `idle`/`cap`(상한, 아래), `error`. `cleared` 는 `training_clear` 일 때만 true.
  - **방 정리**: 어떤 사유로 끝나든 특훈 방은 그 자리에서 없어진다(대기 방으로 남지 않는다). 끊긴 채로 끝났으면(`forfeit_disconnect`: 끊김 횟수 `maxDisconnects` 초과·누적 일시정지 `maxPauseMs` 초과) 보낼 연결이 없어 위 메시지는 가지 않고, 유예 안에 토큰으로 재접속하면 `welcome.location='lobby'` + `room_list` 다.
  - **상한 [자작 안전망, 원작에 없음]**: 특훈은 시계가 없으므로 서버가 끊는다. 사용자 입력(`input.bits` != 0)이 36,000틱(10분) 동안 없으면 `reason:'idle'`, 한 판의 총 틱이 108,000(30분)에 닿으면 `reason:'cap'`(둘 다 `winner:-1`, `cleared:false`). 값은 `training.json` `frames.idleMax`/`totalMax`. 끊김 일시정지 중에는 세지 않고, 완료 연출 중에는 끊지 않는다.
  - `error`(엔진 오류 중단): 위 순서 뒤에 `toast{code:'GAME_ABORTED'}` 가 온다(`room_left`·`room_list` 다음).
  - 다시 하려면 `training_start` 를 다시 보낸다(1단계부터).
- 재접속·끊김 일시정지·유예(30초)는 컴퓨터 대전과 같다(`welcome.location='game'` -> `room_joined` + `game_start{resumed:true, training}` + `snap`).
- 결과 레코드(§6)는 남기지 않는다.
- 위 `tr`·`game_start.training` 의 값 범위는 캐치 특훈 기준이다. 필살 슛 특훈의 값과 추가 필드(`ch`·`chb`·`gauge`)는 §9.5. 종료 순서·`reason`·방 정리·상한·재접속은 두 특훈이 같다(`training_end.kind` 만 다르다).

### 9.3 원작과 다른 점·미확인 (캐치 특훈)
| 항목 | 원작 | 우리 구현 | 수준 |
|---|---|---|---|
| 합격선·단계 진행 | 10구 중 6개 이상 = 다음 단계, 5개 이하 = 같은 단계 재시도, 3단계 통과 = 완료 | 같음(`training.json` `catch.balls/pass/steps`) | 확인 값 그대로. 봇 시뮬로 5·6·0개 경로 실행 |
| 단계별 구종 | plan 0x04 / 0x0C / 0x10, 대상 p0 고정, 난수 없이 표에서 | 같음(`ai.js attackRom` plan 0). 수평 속도 x 성분 실측 5.2~5.5 / 6.05~6.5 / 6.94~8.0 | 기존 직역 plan 재사용. 프레임 단위 원작 대조(차분 하네스)는 하지 않았다 |
| 공중에서 공을 든 경우의 plan | 미확인 | 지상과 같은 표를 쓴다 | 미확인 |
| 3단계 필살 슛 섞임 | 10구 중 1구 관측(표본 1회) | 차지 난수(매 프레임 1/4 로 발사)가 13~15 에 걸릴 때만. 6시드 60구 중 1구(ID 22) | 빈도 차이 미확정(원작 표본이 작다) |
| 투구 간격(잡자마자 되던질 때) | 1단계 104~133f, 2단계 205~376f, 3단계 278~311f | 봇 시뮬(시드 2) 112~159f / 214~280f / 281~296f | 타이머 없이 흐름으로 정해진다. 1단계 상한 차이는 봇의 되던지기 시점 차이일 수 있음(미확정) |
| 연습 상대 방어 | 언제나 캐치 | 같음(`defend` -> plan 0x38) | 원작이 이때 난수를 쓰는지 미확인(쓰지 않게 했다) |
| 캐치 집계 | 선수 0 이 지상에서 살아 있는 투구를 잡을 때만 +1(필살 슛 포함, 공중·바운스 공 제외) | 같음(`trCatch`) | 판독만 그대로. 공중 캐치 제외는 실행으로 확인하지 않았다 |
| 투구 수 집계 | 연습 상대 선수 0 의 투구만 | 같음(`trThrow`). 구종별 칸(`$65`~`$67`)은 세지 않는다 | 판정에 무관 |
| 내 투구 | B·A 모두 상대 조준 투구, 위력 1/4, 속력 구속/16 만, 필살 불가 | 같음. 위력은 `위력 >> 2`(점프·대시·차지 가산을 더한 뒤 나누는지 판독하지 않아 가산 없이 계산) | 속력 5.5 확인, 나머지 판독만 |
| 받아치기 창(글로우) | 끔(0xA3E6) | 끔(캐치 뒤 창 0) | 판독만. 3단계에서 캐치 직후 B 가 통계에 안 잡힌 경로(29 §1-4 미해결)는 재현하지 않는다 |
| 아웃 | 없음(HP 0 이어도 계속) | 같음. HP 는 단계가 바뀌어도 회복하지 않고 0 에서 멈춘다 | 단계 사이 HP 회복 여부 미확인 |
| 피격 데미지 | 13 (HP 112 -> 99) | 13 (112 -> 99) | 확인(시뮬) |
| 예고 길이 | 121f(첫 예고만 114f) | 120f 고정 | 1~6f 차이 |
| 예고 중 | 연습 상대가 공을 든 채 서 있다 | 입력·컴퓨터 두뇌 정지, 물리만 진행 | 확인(상대 정지) |
| 전원 정지 대기(0x08) | 6~140f 관측. 판정식 미판독 | 전원 속도 0·지상·피격/쓰러짐 아님. 이 구간도 입력·두뇌 정지. 상한 600f [자작 안전망] | 판정식·이 구간의 선수 동작 미확인 |
| 페이드·결과 | 약 23~27f, 181f | 24f, 180f | 근사 |
| 재시도 횟수 표시 | `$E267` +1(단계 통과 때 지워지는지 미확인) | `tr.retry` = 같은 단계 재시도 횟수(단계 통과 때 0) | 미확인 |
| 외야 6명 배치 | 슬롯 5,6,8,9,11,12 | 같음. 선수 1~6 을 그 순서로 세웠다 | 어느 선수가 어느 슬롯인지 추정 |
| 연습 상대 난이도 값 | 없음 | 방이 컴퓨터 레벨 2 값을 넘긴다. 직역 두뇌 경로에서는 방어 실수 값만 쓰이는데 특훈은 언제나 캐치라 영향 없음 | 동작 차이 없음(시뮬은 레벨 값 없이 돌렸다) |
| 일시정지 창 | つづける / やめる | Esc·`그만두기` 버튼 -> 확인 창(`계속` / `그만두기` = `training_quit`). 서버 일시정지 없음: 창을 띄운 동안에도 공이 오고, 창은 화면을 덮지 않으며 조작 입력도 그대로 간다 | 일시정지는 미구현 |
| 완료 뒤 | 완료 대사 화면 -> 모드 메뉴 | `training_end{cleared:true}` -> `튜토리얼 완료` 카드(10초 뒤 자동) -> 튜토리얼 화면. 도입 대사·3지선다·완료 대사 화면은 없다 | 대사 화면 미구현 |
| 2P 패드 디버그(카운터 채우기) | 있음 | 없음 | 제외 |
| 무입력·총 시간 상한 | 없음(시계가 없어 무한히 계속된다) | **[자작 안전망, 원작에 없음]** 사용자 입력(`bits` != 0)이 36,000f(10분) 동안 없으면 `reason:'idle'`, 한 판 총 108,000f(30분)에 닿으면 `reason:'cap'` 으로 `training_end{cleared:false}`. 값은 `training.json` `frames.idleMax`/`totalMax`, 서버 방(`roomGame.js`)이 센다(끊김 일시정지 중에는 세지 않는다. 완료 연출 중에는 끊지 않는다) | 자작. 방이 끝없이 남는 것을 막는 용도 |
| B 연타로 캐치 통과 | 미확인(원작 대조 불가) | B 를 연타하는 것만으로 합격선을 넘을 수 있다는 리뷰 지적(정검수, 2026-11-18). 캐치 입력 창·연타 제한이 원작과 같은지 대조할 자료가 없어 손대지 않았다 | 미확인 |

### 9.4 클라이언트 구현 (2026-11-18, 윤프론)
- **화면 표기는 `튜토리얼`(2026-11-18 통일).** 메시지·코드 이름(`training_*`, `kind`)과 이 문서의 '특훈' 은 그대로다. 로비 `튜토리얼` 버튼 1개 -> 튜토리얼 화면(`screens/tutorial.js`) `1 공 받기` -> `training_start{kind:'catch'}`, `2 필살기` -> `training_start{kind:'special'}`. 서버 거절(`TRAINING_UNAVAILABLE` 등)은 토스트. `room_joined`(`room.training`)는 대기실로 가지 않고 `game_start` 를 기다린다(`main.js`).
- 경기 화면(`screens/game.js`, `game/training.js`): `game_start.training` 이 있으면 얼굴·인원 HUD 대신 `캐치 NN구`(숫자 x=80·96, y=8) / `남은 NN구`(숫자 x=256·272 + 와이드 78, y=8) + 가운데 `N/3단계`(웹 추가). 말풍선은 `tr.msg` 번호를 한글로 연습 상대(pid 7) 머리 왼쪽 위에 그린다(번호 -> 한글 표는 `training.js` `TR_MSG_KO`, analysis/29 §4-2-2). `tr.phase==='result'` 동안 가운데 `합격`(`count >= pass`) / `재시도`.
- `tr` 이 있으면 `ref` 가 null 이어도 공을 그린다(`render.js`).
- 2차(2026-11-18) 화면 규칙 — 원작 실측 `analysis/gfx/modes/tr_05_speech_bubbles.png`:
  - 말풍선: 글자 수와 무관한 고정 상자 106x26(검정 외곽 1·모서리 빔, 흰 테 1·모서리 회색 `#6c6c6c`, 회색 테 1, 검정 안쪽 100x20) + 꼬리(상자 아래 x 83~91 에서 오른쪽 아래로 8px, 전체 그림 106x34). 자리: 왼쪽 = 상대 화면 x - 101, 위 = 머리 top - 39(화면 밖·HUD 줄로는 넘지 않게 보정). 한글은 높이 12px 가운데 정렬, 안쪽 폭 96 을 넘으면 가로 압축.
  - 연습 상대(`oppPid`) 머리 위에 COM 표식(`hud.marker.com`)을 그린다(`snap.ctrl` 과 무관, 말풍선이 표식 위에 그려져 COM 글자를 가린다).
  - 터치 패드(`touchpad.js`, `TouchPad(onBits, {training:true})`): F(포메이션) 버튼 없음, A 표기 `던지기`. 일반 경기는 그대로(A `패스`, F 있음).
  - 웹 추가 표시 위치: `합격`/`재시도` 는 HUD 아래 벽 구간(`.game.train .banner.big` top 13%), 특훈 중 토스트는 HUD 줄 아래(`body` 의 `--toast-top`, 화면을 떠날 때 해제).
- 그만두기: Esc 또는 `그만두기` 버튼 -> 확인 창 -> `training_quit`. 경기 곡·GAME SET·결과 곡은 내지 않는다(특훈 곡 장면 미확정).
- 종료: `game_end`(입력·화면 정지) -> `training_end`(`cleared` 면 완료 카드, `idle`/`cap` 은 토스트 `i18n.js TRAIN_END`) -> `room_left`(완료 카드가 없으면 튜토리얼 화면으로, 완료 카드의 `튜토리얼로` 도 같은 화면) -> `room_list`. 오류 종료의 `GAME_ABORTED` 토스트는 튜토리얼 화면에서 뜬다.
- 필살 슛 특훈(`kind:'special'`, §9.5. 2026-11-18 윤프론) — 캐치 특훈과 같은 화면·같은 경로이고 아래만 다르다:
  - HUD(`game/training.js` `TrainHud`): 왼쪽 `필살 슛 NN구`(`tr.count`, 숫자 x=112·128, y=8), 오른쪽 `남은 NN구`(`tr.left`)는 캐치와 같은 자리. 가운데 단계 표시는 없다(단계가 하나).
  - 차지 게이지: 막대 x 16~160·y 33~39(눈금 18칸, 칸 폭 8), `game_start.training.gauge.ok` 구간(13~15 = x 120~143)만 초록, 그 앞 4칸 밝은 빨강, 나머지 어두운 빨강. 위쪽 ▽ 표식(7x7, y 25~31)이 `tr.ch` 칸 위에 서고(원작 표식 x = 20 + 8 x 차지), 성공 구간에 있으면 노랑이다. `tr.chb` > 0 인 동안 표식이 4틱 켜짐 / 4틱 꺼짐으로 점멸한다. **막대 그림·색 구간 좌표·점멸 주기와 모양은 원작 미확정이라 자작이다**(29 §4-2-3 미확정 2·5. 화면에는 근거 표기를 넣지 않는다).
  - 말풍선: `tr.msg` 6 `와라!`(예고)·8 `다시 던져봐라!`(재시도 예고)와 결과 1~4 가 캐치와 같은 상자로 나온다(클라이언트는 번호만 따른다).
  - 결과 `합격`(`count >= pass`) / `재시도`, 완료 카드, 그만두기 확인 창, 상한 토스트, 방 정리는 캐치와 같은 코드다. 조작 안내에 `D + S 길게 → 필살기` 한 줄이 더 있다. 필살 슛을 던지면 일반 경기와 같은 반짝임·임팩트 연출·슛 이름 말풍선(`public/js/game/shout.js`, 클라이언트 전용, analysis/14 §3.8)이 나온다(필살기 컷인은 2026-11-18 제거, analysis/14 §3.3). 특훈 중 토스트는 게이지 아래(캔버스 y 44)로 내린다.

### 9.5 필살 슛 특훈 (`kind:'special'`, 서버 2026-11-18 박백엔. 클라이언트는 §9.4)
원작 필살 슛 특훈(analysis/29 §1-5, 구현 결과·검증 §4-2-3). 내 투구 20개 중 필살 슛 10개 이상이면 완료, 9개 이하면 같은 것을 다시 한다(횟수 제한 없음). 단계는 하나다.
- `game_start.training`: `{kind:'special', step:0, balls:20, pass:10, steps:1, gauge:{max:15, ok:[13,15], hold:120}}`. `balls` = 내 투구 수, `pass` = 필살 합격선, `gauge.max` = 게이지 눈금 최댓값, `gauge.ok` = 필살이 되는 차지 구간(원작 게이지의 초록 구간), `gauge.hold` = 투구 뒤 깜빡임 틱 수. 그 밖의 필드는 캐치 특훈과 같다(팀 22 대 24, 스테이지 13, 시계 없음).
- 스냅샷 `tr`(캐치와 같은 6필드 + 2필드):
```js
tr: { step:0,
      count:0~20,        // 필살 슛 성공 수(HUD 왼쪽, 원작 `必殺シュートNN球`)
      left:20~0,         // 남은 내 투구 수(HUD 오른쪽)
      phase:'intro'|'play'|'settle'|'result'|'done',
      msg:0~10,          // 예고 6, 재시도 예고 8, 결과 1(0~3개)·2(4~9개)·3(10~17개)·4(18~20개)
      retry:0~,
      ch:0~15,           // 차지 게이지 값. 원작 표시 x = 20 + 8 x ch (320 폭 기준, y 32)
      chb:0~120 }        // 0 보다 크면 투구 뒤 깜빡이는 중(남은 틱). 투구 틱에 1 감소해 실제 관측 최대 119. 그동안 ch 는 던진 차지 값, 0 이 되면 ch 도 0
```
  - `ch` 는 내 선수 0(pid 0)이 공중에서 B 를 눌러 차지하는 동안 0 에서 올라간다(매 틱 +1, 선수 배열 [7] 과 같은 값을 15 로 자른 것). 차지 13~15 에서 B 를 떼면 필살 슛이다. 지상 투구에는 움직이지 않는다.
  - 시작할 때 공은 pid 0 이 들고 있다(`b[4]`=0). `intro` 동안 입력 무시.
  - `play` 는 내가 20번 던지고 그 공이 투구 비행을 마치면 끝난다. 일반 투구(지상 B·A, 차지가 13~15 가 아닌 공중 투구)도 20개에 들어간다.
- 조작(`input.bits`): 선수 0 이 공을 들면 지상 B·A = 연습 상대(pid 7) 조준 투구, C = 점프, 공중 B 홀드 = 차지. **선수 0 이 아닌 내 선수(외야)가 공을 들면 B·A 모두 선수 0 에게 패스**다. 포메이션(S) 없음.
- 연습 상대: 필살 슛에는 캐치 자세를 잡지 않고 맞는다(데미지 65, HP 80 -> 15 -> 0, 아웃 없음). 일반 투구는 잡는다. 공을 주우면 지상 투구로 나(pid 0)에게 되던진다(위력 1/4 이라 내 HP 는 줄지 않는다. 잡아도 되고 맞아도 된다).
- 이벤트: 필살 슛을 던진 틱에 `throw` 와 `special{p:0, id:22}`. `tr_result{step:0, count, grade:0~3, pass}`, `tr_step{step:0, retry}`, 완료 `end{winner:0, reason:'training_clear'}` 는 캐치와 같다.
- 미확정(클라이언트는 §9.4 처럼 자작 그림으로 먼저 넣었다. 원작 대조가 남은 것. 상세 analysis/29 §4-2-3 미확정 표): 게이지 깜빡임의 주기·모양, 게이지 막대 그림과 색 구간 좌표, 차지가 투구 없이 끝났을 때의 게이지, 차지 16(자동 발사)의 게이지 값, 선수 0 이 아닌 선수의 패스 장면(코드 판독만).

## 10. 리그 (혼자 + 컴퓨터) — 서버 1차 (2026-11-18, 박백엔)
원작 `闘球リーグ`(analysis/29 §2·§4-3, 확정본 analysis/33 A). 닉네임(소문자)당 리그 1개를 서버가 저장하고 이어 한다. 클라이언트 화면은 후속(윤프론). 구현 `server/league/rules.js`(순수 규칙)·`server/league/handlers.js`(요청)·`server/store/league.js`(저장).

### 10.1 데이터
```js
league = { id, teams:[{team, com:boolean} x 2~6],   // 참가 순번 = 배열 순서(idx). com=false 가 사람 팀(최대 1팀, 0팀 = 전원 컴퓨터)
           turns:1~9, rules:{mode:'knockout', time:0} | {mode:'official', time:3|5|8},
           res:[[[승,패] x n] x n],                  // res[i][j] = i 가 j 에게 거둔 승·패 누적(res[j][i] 는 뒤집은 값)
           done:boolean, createdAt, updatedAt }
table = [{idx, team, com, w, l, rate, left, rank}]  // 순위 목록 순서(rank 오름차순, 같은 rank 는 idx 순). 저장하지 않고 매번 계산
```
- `rate = floor(w*1000/(w+l))`(0경기 = 0), `left = (n-1)*turns - w - l`, `rank` = 자기보다 `rate` 가 높은 팀 수(0부터, 동률 같은 번호. 화면 표시는 +1). 승점·득실 없음.
- 팀: 0~14 = 기본 15팀, 15~21 = SPECIAL 줄(스토리 14번째 경기 승리 = `progress.clearedMax >= 13` 인 계정만), 22·23·24 는 거절. 중복 불가.
- 규칙: 원작 조합 4가지만(`knockout`+무제한, `official`+3/5/8분). `rules` 생략 = `knockout`·0, `official` 의 `time` 생략 = 3. 그 밖(`knockout`+5분 등)은 `LEAGUE_INVALID`.

### 10.2 요청 (로비 상태에서만. 방·게임 중이면 `league_get` 외에는 `ALREADY_IN_ROOM`)
| 요청 | 동작 |
|---|---|
| `{t:'league_get'}` | `league_state` |
| `{t:'league_new', teams:[{team, com?}], turns, rules?}` | 새 리그(있으면 덮어쓴다. `처음부터` 확인은 클라이언트). `com` 생략 = 컴퓨터. -> `league_state` |
| `{t:'league_config', com?:[boolean x n], rules?}` | 팀별 사람/컴퓨터·규칙만 바꾼다(팀 수·턴 수·결과 불변). -> `league_state` |
| `{t:'league_play', i, j}` | 카드(행 i, 열 j). `i != j` 이고 `res[i][j]` 의 승+패 < `turns` 이며 리그가 끝나지 않았어야 한다(아니면 `LEAGUE_CARD_INVALID`) |
| `{t:'league_abandon'}` | 리그 지우기 -> `league_state{league:null}` |
- 레이트 리밋: **리그 전용 창**(세션당 분당 `league_*` 합산 200회, 환경변수 `MAX_LEAGUE_PER_MIN`, 사람 카드 방 생성·즉시 판정 포함, 거절된 요청도 센다). 6팀 9턴 135카드를 연달아 눌러도 걸리지 않는다. 초과 코드는 캠페인과 같은 `CAMPAIGN_RATE_LIMITED`. (2026-11-18 캠페인 창 30회에서 분리) 오류는 모두 `error` -> 토스트.
- 오류 코드: `LEAGUE_NONE`(리그 없음), `LEAGUE_INVALID`(팀 수·턴·중복·22~24·사람 2팀 이상·규칙 조합·형식), `LEAGUE_CARD_INVALID`, `LEAGUE_TEAM_LOCKED`(해금 전 SPECIAL 팀).

### 10.3 서버 -> 클라이언트
```js
{ t:'league_state', league:league|null, table:table|null, special:boolean, champions?:[idx] }   // champions 는 done 일 때만
{ t:'league_result', i, j, left, right, winner:idx|null, quick:boolean,
  p?, r?,                                   // quick: 즉시 판정 확률(왼쪽 승 = r <= p, 0~255)
  matchId?, reason?, recorded? }            // 실제 경기: 결과 기록 여부
{ t:'league_end', champions:[idx] }        // 전원 left 0. rank 0 인 팀 전부(참가 순)
```
- **컴-컴 카드**: 경기 화면·방 없이 즉시 판정(analysis/29 §2-5): 왼쪽 = 행 i, 오른쪽 = 열 j. 레이팅 `(raw - 14224) mod 65536` 의 상위 바이트 a·c, 낮거나 같은 쪽 절반, `p = floor(a*256/(a+c))`, 서버 난수 1바이트 `r <= p` 면 왼쪽 승. 순서 `league_result{quick:true}` -> `league_state` (-> `league_end`).
- **사람 낀 카드**: 사람 팀이 언제나 왼쪽(좌석 0, 행이 컴퓨터면 좌우를 바꾼다). 비공개 방(`room_list` 에 없음, 다른 사람 `join_room` 불가)을 만들어 준비 없이 바로 시작: `room_joined{room.league:{i,j}, room.vsCpu:true}` -> `room_state` -> `game_start{league:{i,j}}`. 상대 = 오른쪽 팀, 컴퓨터 레벨 2 고정, 스테이지 = 오른쪽 팀의 홈(ROM 표 0x1257A -> `romStage` -> `stages.json` id), 규칙 = 리그 `rules`(`official`·5분 = `game_start.rules.limitFrames` 18000, `knockout` = 0).
  - 리그 방에서 `set_team`·`start`·`set_rules` 는 `NOT_IN_CAMPAIGN_ROOM`(경기 중에는 `IN_GAME` 이 먼저). 그만두기는 `leave_room`(= 기권).
  - 종료 순서: `game_end` -> `league_result{quick:false, reason, recorded}` -> `league_state` (-> `league_end`) -> `room_left{reason:'leave'}` -> `room_list`. `room_state`(waiting)는 오지 않는다. 방은 어떤 사유로 끝나든 없어진다.
  - 기록: `annihilation`/`timeup`/`sudden_death` = 승자 기록, `forfeit_leave`/`forfeit_disconnect` = 사람 패배 기록, `draw_cap`·`error` = 기록 없음(`recorded:false, winner:null`, 같은 카드를 다시 칠 수 있다). 한 경기에 한 번만 기록한다. 경기 중 리그가 바뀌었으면(다른 리그 id·그 카드를 이미 다 침) 기록하지 않는다.
  - 재접속·끊김 일시정지·유예는 컴퓨터 대전과 같다(`welcome.location='game'` -> `room_joined` + `game_start{resumed:true, league}`). 결과 레코드(§6)에 `league:{i, j, stage}` 가 붙는다.

### 10.4 저장
- `data/progress/league.json`(환경변수 `LEAGUE_PATH`), `{version:1, users:{<소문자 닉네임>:{nick, league, updatedAt}}}`. 만들 때·설정 변경·매 경기 뒤 저장(100ms 디바운스, 임시 파일 -> rename, 종료 시 flush). 마지막 경기 뒤에도 저장하고 `done:true`(원작은 마지막 경기 전 상태로 남는다. 원작대로 하려면 `rules.js SAVE_AFTER_FINAL=false`). JSON 손상 시 원본을 `league.json.corrupt-<시각>` 으로 보존하고 빈 상태로 시작, 형식이 틀린 항목(팀·턴·결과 대칭·합 > 턴)은 버린다. 항목 상한 5000(오래된 갱신부터 정리).
- 저장 계층은 `get(key)` / `set(key, nick, league|null)` / `flush()` 세 함수뿐이다. **2026-11-18 운영 기본이 SQLite(`SqliteLeagueStore`, `data/tongki.db` 의 `leagues` 표)로 바뀌었다**(위 JSON 설명은 `JsonLeagueStore` = 테스트·폴백용). 기존 `league.json` 은 첫 시작 때 한 번 가져온다(§11.5). 인증 범위는 §8.3 과 같다(가입한 닉네임은 보호, §2.1).
- 원작과 다른 점: 사람 팀 최대 1(사람끼리 카드는 2P 패드가 필요해 없음), 사람 경기 기권 = 패배, 즉시 판정 K 고정(원작은 경기마다 쓰레기 값이 들어올 수 있다), 컴-컴 관전(`しあいをみる`)·개막식은 후속.

## 11. 온라인 랭킹(래더) — 서버 2026-11-18 박백엔, [자작]. 기준 analysis/33 §B, 클라이언트(랭크 탭·결과 변동·순위표) 2026-11-18 윤프론(docs/HANDOFF §4-18)
구현 `server/ranking/elo.js`(규칙 상수·Elo), `server/store/ranking.js`(SQLite `ratings`·`rank_games`), `server/lobby/lobby.js`(랭크 방·판정).

### 11.1 규칙
- Elo: 초기 1000, K 32, 자기 첫 10경기(배치)는 K 48, 하한 100. 각자 자기 K 를 쓴다(1000 대 1000 승리 = +16/−16, 둘 다 배치 중 = +24/−24). 시즌 없음(`season` 1 고정 열만).
- 반영: GO 이후의 정상 종료(`annihilation`/`timeup`/`sudden_death`)와 기권(`forfeit_leave`/`forfeit_disconnect`, 기권한 쪽 패배). `draw_cap`·`error`·GO 이전 종료(입장 연출 중 퇴장 등)는 무효(`why:'VOID'`, 변동 없음).
- 같은 상대와 24시간 안에 반영된 경기가 3번이면 4번째부터 `counted:false, why:'PAIR_LIMIT'`(변동 없음, 기권 기록은 남는다).
- 최근 랭크 경기 10판(반영 여부 무관) 중 자기 기권이 3번이 되면 30분 랭크 입장 잠금(`RANKED_LOCKED{params.until}`): `create_room{ranked}`·랭크 방 `join_room`·랭크 방 `start`(두 사람 모두 검사)를 거절.
- 같은 IP 두 세션 미반영은 넣지 않았다(`TRUST_PROXY` 설정에 달려 있어 배포 환경 확인 뒤).
- 컴퓨터 대전·캠페인·특훈(튜토리얼)·리그는 랭킹에 영향 없음.

### 11.2 랭크 방
- `create_room{ranked:true}`: **계정 세션만**(`REQUIRE_ACCOUNT` 와 무관, 손님은 `ACCOUNT_REQUIRED`). `vsCpu:true` 와 함께 보내면 `BAD_MESSAGE`. 규칙은 녹아웃·5분 고정(`rules` 를 보내면 같은 값만 허용, 다르면 `RANKED_RULES_FIXED`).
- `room_list` 항목과 `room_state.room` 에 `ranked:true`(추가 필드). 랭크 방 `join_room` 도 계정만(`ACCOUNT_REQUIRED`·`RANKED_LOCKED`).
- 랭크 방의 `room_joined.room.slots[i]`·`room_state.room.slots[i]`(사람 좌석)에 **`rating`(정수, 현재 레이팅, 배치 중이어도 값) · `placement`(boolean, 경기 수 < 5 = 순위표 `ranking_list.me.placement` 와 같은 기준)** 추가(2026-11-18). 비랭크 방 좌석에는 두 필드가 없다(하위 호환). 보낼 때마다 저장소에서 읽으므로 상대 입장·퇴장·경기 종료 뒤 `room_state`(반영 후 값)에도 최신이다. 경기 전 레이팅을 얻으려 `ranking_list` 로 보완할 필요 없음.
- 랭크 방 `set_rules` = `RANKED_RULES_FIXED`. `set_team` 은 0~21 만(SPECIAL 허용, 22~24 = `TEAM_INVALID`). 준비·시작·방장 위임·재경기는 일반 방과 같다.

### 11.3 요청·응답
```js
{ t:'ranking_list', top?:1~50 }   // 생략 50. 세션당 분당 30회(캠페인 창과 공유)
-> { t:'ranking_list',
     top:[{ rank, nick, rating, w, l }],       // 5경기 이상만, rating 내림차순(같으면 같은 rank, 그다음 승 많은 순)
     me: { rank|null, nick, rating, w, l, games, placement:boolean } | null }   // 계정이면 내 줄(5경기 미만 = placement:true·rank:null = '배치 중'), 손님이면 null
{ t:'ranking_result', matchId, counted:boolean, why?:'VOID'|'PAIR_LIMIT', before, after, delta, oppBefore }   // 랭크 경기 game_end 바로 뒤, 좌석별(내 값)
```
- 결과 레코드(§6)에 `ranked:true, ratingCounted, ratingDelta:[좌석0, 좌석1]` 추가.

### 11.4 저장(SQLite `data/tongki.db`)
- `ratings(key, nick, rating, w, l, games, season, lock_until, updated_at)`, `rank_games(match_id, a_key, b_key, winner_key, forfeit_key, counted, at)`. 한 경기 판정은 트랜잭션 하나.

### 11.5 저장 계층·이전(계정·진행·리그·랭킹 공통)
- `server/store/db.js` 한 파일만 `node:sqlite`(Node 22.5 이상 내장)를 쓴다(better-sqlite3 로 바꿀 때 이 파일만). WAL, `schema_version` 표 + `MIGRATIONS` 배열(끝에 추가만). SQL 은 언제나 바인드 파라미터.
- 표: `accounts`, `auth_tokens`(토큰 해시), `progress`, `leagues`, `ratings`, `rank_games`, `meta`.
- JSON 가져오기(`server/store/migrate.js`): 서버 시작 때 `PROGRESS_PATH`·`LEAGUE_PATH`(기본 `data/progress/*.json`)를 가져온다. 파일별 `meta` 표식(크기·수정 시각)이 같으면 건너뛰고, 파일이 바뀌었으면 다시 합친다. 합치기 규칙(코드와 같다): (a) 키마다 **처음 가져올 때만 새 행을 넣고** `meta` 에 `json_imported:<progress|league>:<키>` 로 기록한다. (b) 가져온 적 있는 키는 DB 에 행이 남아 있을 때만 고치고, 행이 없으면 다시 넣지 않는다(리그 포기·손님 데이터 분리 보존 뒤 부활 없음). (c) 고치는 조건: 진행은 JSON `clearedMax` 가 더 클 때만, 리그는 JSON `updatedAt` 이 DB `updated_at` 보다 새로울 때만(그때는 리그 전체를 JSON 값으로 바꾼다). (d) 가입된 계정 키는 처음이든 아니든 건너뛴다(계정 데이터는 DB 에서만 바뀐다). 처음 가져올 때 원본 사본을 `<DB 폴더>/backup/json_before_sqlite/`(환경변수 `JSON_BACKUP_DIR`)에 두고, 원본 JSON 은 지우거나 바꾸지 않는다. 수동 실행: `node server/store/migrate.js --db <파일> --progress <json> --league <json> [--backup <폴더>]`. 한계: 키별 표식이 생기기 전 버전으로 이미 가져온 DB 에는 `json_imported:*` 표식이 없어, 그 DB 에서 지워진 행(리그 포기·분리 보존)은 JSON 이 바뀐 뒤 첫 재가져오기에서 한 번 다시 들어올 수 있다(그 뒤로는 표식이 남는다. (d) 계정 키 건너뛰기는 그대로).
