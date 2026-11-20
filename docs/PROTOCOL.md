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
| ACCOUNT_REQUIRED | 계정으로 로그인해야 합니다 (`REQUIRE_ACCOUNT=1` 서버의 닉네임 `hello`, §2.1) |
| ACCOUNT_EXISTS / NICK_REGISTERED | 이미 가입된 닉네임입니다 (`register`) / 가입된 닉네임입니다. 비밀번호로 로그인하세요 (닉네임만 보낸 `hello`) |
| PASSWORD_INVALID | 비밀번호는 6~64자로 정하세요 (`register`) |
| LOGIN_FAILED / LOGIN_LOCKED | 닉네임 또는 비밀번호가 맞지 않습니다 / 로그인 실패가 많아 잠시 막혔습니다 (`login`) |
| AUTH_RATE_LIMITED / AUTH_BUSY | 가입·로그인 시도가 너무 잦습니다 (IP당 분당 10회) / 처리 중입니다 (같은 연결에서 앞 요청 처리 중) |
| ACCOUNT_CREATED_RELOGIN | 가입은 되었습니다. 비밀번호로 다시 로그인하세요 (`register` 처리 중에 그 연결이 로그아웃·교체·다른 닉네임 접속으로 바뀐 경우. 계정은 만들어졌고 토큰은 발급하지 않았다) |
| RANKED_LOCKED | 기권이 잦아 잠시 랭크 경기를 할 수 없습니다 (`params.until` = 풀리는 시각 epoch ms, `ladder_join`·래더 방 `start`, §11) |
| RANKED_RULES_FIXED | 랭크 방은 규칙을 바꿀 수 없습니다 (래더 방 `set_rules`) |
| LADDER_ONLY | 랭크 경기는 래더 대기열에서만 할 수 있습니다 (`create_room{ranked:true}` — 2026-11-20 래더로 대체, §11) |
| CHAT_EMPTY / CHAT_TOO_LONG | 보낼 내용을 입력하세요 / 너무 깁니다 (`chat`·`notice_send`, 정리 후 길이. TOO_LONG 은 `params.max`, §14) |
| CHAT_RATE_LIMITED | 채팅이 너무 빠릅니다. 잠시 후 다시 보내세요 (세션당 최소 간격·10초 상한·같은 내용 연속 3회째, §14) |
| CHAT_UNAVAILABLE | 여기서는 채팅할 수 없습니다 (사람끼리 방이 아닌 곳의 `chat`, §14) |
| NOT_ADMIN | 관리자만 할 수 있습니다 (관리자 계정이 아닌 세션의 `notice_send`, §14) |
| NOTICE_RATE_LIMITED | 공지를 너무 자주 보냈습니다. 잠시 후 다시 보내세요 (3초에 1개·분당 10개, §14) |

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
- `welcome`·`account_ok` 의 `admin:true` — 관리자 계정 세션에만 있다(없으면 일반). 공지 입력 UI 를 그릴지만 정한다. 권한은 서버가 요청마다 다시 판정한다(§14).
- **토큰**: 계정 세션의 `welcome.token` = 로그인 토큰(랜덤 32바이트 base64url, 30일). 세션 재접속 토큰을 겸하므로 클라이언트는 지금처럼 하나만 저장한다. 서버 DB 에는 sha256 해시만 저장한다. 손님(닉네임만) 세션의 토큰은 종전처럼 메모리 전용(유예 30초).
- **닉네임 보호**: 가입된 닉네임은 `REQUIRE_ACCOUNT` 값과 무관하게 닉네임만 보낸 `hello` 로 쓸 수 없다(`NICK_REGISTERED`). 가입하지 않은 닉네임은 종전 그대로(손님).
- **단계 정책**: 서버 환경변수 `REQUIRE_ACCOUNT=1` 이면 닉네임만 보낸 `hello` 를 `ACCOUNT_REQUIRED` 로 거절(계정 필수). **기본 0 = 종전 방식 유지**(기존 클라이언트가 그대로 동작). 기본값 전환은 사용자 승인 뒤.
- **진행 승계**(2026-11-18 보안 리뷰 반영): 서버가 손님 진행·리그를 이어 주는 경로는 **그 닉네임의 손님 세션으로 접속한 연결에서 `register` 한 경우(`account_ok` 승격)** 하나다. 이것은 "원래 손님 본인만 승계한다"는 보장이 아니다(아래 한계 ①). 로그인 전 연결에서 가입하면(그 닉네임의 손님이 끊겨 있었거나 예전 손님 데이터가 DB·JSON 에 남아 있어도) **빈 진행으로 시작**한다. 남아 있던 손님 데이터는 지우거나 덮지 않고 계정이 읽지 않는 키 `guest-aside:<소문자 닉네임>:<시각 ms>` 로 옮겨 보존한다(서버 로그에 건수·키 기록. `NICK_RE` 에 `:` 가 없어 어떤 세션도 이 키를 쓸 수 없다). JSON 가져오기도 가입된 계정 키는 건너뛴다(§11.5).
- **가입 경합**: 로그인 전 연결의 가입이 비밀번호 해시를 계산하는 사이 같은 닉네임 손님이 `hello` 로 들어오면, 계정은 만들어지고 그 손님 세션은 끝난다(`logout` 과 같은 정리: 방·경기 중이면 퇴장 = 기권, 손님 연결에 `logged_out`. 그 퇴장으로 끝나는 경기의 진행·리그는 계정 키에 기록하지 않는다). 가입 연결은 토큰 없이 `ACCOUNT_CREATED_RELOGIN` 을 받고 비밀번호로 `login` 한다.
- **한계**(수용, 2026-11-18 팀장 결정): ① 손님은 소유 증명(영속 토큰)이 없다. 끊겨 있고 방에도 없는 손님 닉네임은 누구나 `hello` 로 즉시 가져갈 수 있고(§2 닉네임 재사용), 그 연결에서 `register` 하면 위 승계 경로로 **그 손님의 진행·리그가 승계된다**(hello → register 2단계 우회). 원래 손님은 그 뒤 그 닉네임으로 `NICK_REGISTERED`. 손님 진행(캠페인 클리어 단계·리그)은 민감 데이터가 아니라 영속 손님 토큰은 두지 않는다. 랭킹 레이팅·전적은 계정에만 쌓이고(손님은 랭크 방 상대로만 참여, §11.1) 가입된 닉네임은 `hello` 로 잡을 수 없으므로, 랭킹·계정이 있는 닉네임은 이 우회의 영향을 받지 않는다. ② 로그인 전 연결 가입의 경우에도 원래 손님은 그 닉네임을 다시 쓸 수 없다(`NICK_REGISTERED`, 비밀번호를 모름). 진행은 `guest-aside:` 행에 남아 있으므로 되돌려 주려면 운영자가 수동으로 옮겨야 한다(자동 복구 경로 없음).
- **보안**: 비밀번호 = `crypto.scrypt`(N 16384, r 8, 64바이트) + 계정별 랜덤 솔트 16바이트, 비교는 `timingSafeEqual`, 없는 닉네임도 같은 비용으로 계산. 평문·해시·토큰은 로그에 남기지 않는다. 로그인 실패 제한(메모리 기록이라 재시작하면 풀림, 15분 창): **(닉네임, IP) 쌍** 5회(`LOGIN_FAIL_NICK`) 또는 **IP** 20회(`LOGIN_FAIL_IP`) 실패면 그 쌍/IP 를 15분(`LOGIN_LOCK_MS`) `LOGIN_LOCKED`(맞는 비밀번호도 거절). **닉네임 단독**(모든 IP 합계)은 잠그지 않고 5회째 실패부터 다음 시도마다 응답을 1초씩 더 늦춘다(최대 10초, `LOGIN_SLOW_STEP_MS`·`LOGIN_SLOW_MAX_MS`). 그래서 남이 내 닉네임으로 실패를 쌓아도 다른 IP(새 기기)에서는 로그인된다(늦어질 뿐). 로그인에 성공하면 그 닉네임 단독 기록과 그 쌍 기록을 지운다. 레이트 리밋: IP당 분당 `register`+`login` 10회(`MAX_AUTH_PER_MIN`), 그리고 `hello` 상한(`MAX_HELLO_PER_MIN`)에도 함께 센다. 평문 비밀번호가 오가므로 공개 배포는 TLS(`wss://`) 필수.
- **배포 필수 주의**: ① 리버스 프록시 뒤에서는 반드시 `TRUST_PROXY=1` — 빠뜨리면 모든 사용자가 프록시 IP 하나로 보여 IP별 로그인 잠금·가입/로그인 레이트 리밋·동시 연결 상한을 전원이 나눠 쓴다(한 사람의 실패로 전원 `LOGIN_LOCKED`). 반대로 프록시 없이 켜면 IP 위조로 우회된다. ② Node 22.5 이상(`node:sqlite`). 22.5~22.12 는 `--experimental-sqlite` 가 필요하다(pm2: `pm2 start server/index.js --name dodge-danpei --node-args="--experimental-sqlite"`), 22.13 이상은 옵션 없이 된다. ③ 공개 시 `wss://`(TLS) 필수. ④ DB 파일은 POSIX 에서 시작 때 권한 0600 으로 좁힌다(본 파일과 그때 있는 `-wal`·`-shm`, Windows 는 건너뜀).

## 3. 로비
- `{t:'list_rooms'}` -> `room_list`. 로비에 있는 사용자에게는 방 생성/삭제/인원/상태 변화·규칙 변경(`set_rules` 로 `mode`·`time`·`flameTeams` 가 실제로 바뀐 때, 2026-11-19) 시 서버가 `room_list`를 푸시한다(최대 250ms 단위로 합쳐서 전체 목록).
```js
{ t:'room_list', rooms:[{ code, host:'방장닉네임', players:1|2, max:2, status:'waiting'|'playing', rules:{mode, time} }] }  // 최근 생성 순. rules = 추가 필드(하위 호환, 방 목록 행의 규칙 요약용)
```
- **호스트 요약 `hostInfo`**(추가 필드, 2026-11-20, 하위 호환): 방장이 계정이면 `rooms[i].hostInfo = { tier, rating, w, l }`, 배치 중이면 `{ tier:null, placing:true, rating, w, l }`. 방장이 손님이면 키 자체가 없다. (`host` 는 종전대로 방장 닉네임 문자열이라 이름을 따로 둔다.)
  - `tier` = `ladder_status.me.tier` 와 같은 계산(지금 시즌 표시 티어, 순위 조건을 채우면 `'master'`, 배치 5판 미만이면 `null` + `placing:true`). `rating` = 지금 시즌 레이팅(배치 중에도 실린다, `ladder_matched.opp.rating` 과 같은 공개 값).
  - `w`·`l` = 사람끼리 누적 전적(`pvp_records`, 시즌 무관) = 전체 랭킹(§11.6 `pvp_board`)과 같은 값. 승률 표시는 클라이언트가 `w/(w+l)` 로 계산(판수 0 이면 표시 생략 권장).
  - 공개 값만 싣는다(계정 키·토큰·비밀번호 관련 값 없음).
  - 서버 비용: 호스트별 값은 `RankingStore.hostBadges` 메모리 캐시(래더·전적 기록·시즌 넘김마다 무효화, TTL 60초)에서 꺼내고, 캐시가 빗나간 호스트가 여럿이어도 시즌 순위 계산은 목록 1회당 한 번만 한다.
```js
{ code:'AB12', host:'철수', players:1, max:2, status:'waiting', rules:{…}, hostInfo:{ tier:'gold', rating:1180, w:12, l:7 } }
{ code:'CD34', host:'영희', players:1, max:2, status:'waiting', rules:{…}, hostInfo:{ tier:null, placing:true, rating:1000, w:0, l:0 } }
{ code:'EF56', host:'손님', players:1, max:2, status:'waiting', rules:{…} }   // 손님 방장 = hostInfo 없음
```
- 입장 불가 표시는 클라이언트가 `status==='playing'` 또는 `players>=max`로 한다. 최종 판정은 서버(`ROOM_IN_GAME`, `ROOM_FULL`).

## 4. 방·대기실

| 요청 | 필드 | 설명 |
|---|---|---|
| `create_room` | `code?`(4~6자 A-Z0-9, 생략 시 서버가 4자 발급), `vsCpu?:boolean`(기본 false), `cpuLevel?:1~3`(기본 2) | 만든 사람이 방장(왼쪽 팀). -> `room_joined`. `vsCpu`/`cpuLevel`은 선택 필드(하위 호환: 생략하면 기존 동작). 타입 위반은 `BAD_MESSAGE` |
| `join_room` | `code`(대소문자 무시) | -> `room_joined`. 없는 코드/가득/게임 중이면 오류 |
| `leave_room` | | -> `room_left{reason:'leave'}` 후 `room_list`. **게임 중이면 기권패**(상대에게 `game_end.reason='forfeit_leave'`). 기권한 본인도 순서대로 `game_end` -> `room_state`(waiting) -> `room_left{reason:'leave'}` -> `room_list`를 받는다(`room_left`가 항상 마지막 화면 전환 신호) |
| `ready` | `ready:boolean` | 방장 제외 본인. 방장은 `HOST_NO_READY` |
| `set_team` | `team`(0~24) | 내 팀 선택. 게임 중 불가(`IN_GAME`). 변경 시 내 준비 해제. 두 사람이 같은 팀이어도 허용. **컴퓨터 대전 방에서는 `team:'flame:recent'`·`'flame:best'`(불꽃의 계승에서 키운 팀 슬롯)도 받는다(§13.20)** |
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
  evade:'track'|'rom',   // 읽기 전용(2026-11-20). 'track' = 이 방 경기는 필살슛 유도(추적)가 항상 적용된다(사람끼리 일반 방·랭크 방). 'rom' = 원작 그대로. §5.8
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
- **필살슛 유도(`room.evade`)** [추가 필드, 읽기 전용, 2026-11-20]: 선택지가 아니다. 서버가 방 종류로 정하고 바꾸는 요청은 없다(`set_rules`·`create_room` 의 `rules` 에 `evade` 키를 실어도 쓰지 않는다 — 규칙 키·화이트리스트에 추가하지 않았다). 대기실 안내 문구는 표시하지 않는다(대기실 문구 제거됨, 2026-11-20). 규칙은 §5.8.
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

- **눌림 상태가 바뀔 때마다 즉시 전송**하고, 입력이 유지되는 동안 250ms마다 같은 값을 재전송(유실·연결 점검용). 서버는 틱 사이의 짧은 탭도 놓치지 않도록 래치한다(새로 눌린 비트만 1틱 보장, 뗀 비트는 다음 틱에 바로 반영).
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

### 5.8 필살슛 유도(추적) — 사람끼리 일반 멀티 경기 자동 적용 (2026-11-20 박백엔, 원작에 없음 [자작], analysis/45 B4 를 필살슛만으로 줄인 사용자 결정)
- **적용 판정(서버 한 곳, `server/game/roomGame.js isHumanVsHuman(room)`)**: 사람 두 좌석의 방(`vsCpu` 아님)이고 스토리(`campaign`)·특훈(`training`)·리그(`league`)·불꽃의 계승 도전/연습(`flame`) 방이 아니며 규칙 「불꽃 팀」(`rules.flameTeams:true`)을 켠 방도 아니면 `'track'`. 랭크 방·이후 래더 큐 경기도 이 조건을 지나면 적용된다. **불꽃 팀 허용 사람끼리 방은 이번에 적용하지 않는다(가정)**. 그 밖의 모든 경기(컴퓨터 대전·스토리·리그·특훈·불꽃)는 원작 프레임 그대로다(컴퓨터 AI 직역 행동표 보호).
- 전달: `room.evade` -> 경기 시작 때 `RoomGame` 옵션 `evade` -> `Match` 옵션 `evade:'track'`(컴퓨터 좌석·특훈·flame 경기는 `RoomGame`·`Match` 가 한 번 더 막는다). `game_start.rules.evade:'track'` 은 적용 경기에만 있다(없으면 원작). 결과 레코드 `rules.evade:'track'` 도 같다.
- 동작: **필살슛만** 던질 때의 대상을 따라간다. 일반 슛·패스는 원작 그대로(회피 가능, 옵션 켬/끔 프레임 동일). 필살 궤적 핸들러(직진·감속·커브·급강하·부메랑·루프 등)는 자기 속도대로 돌고, 그 출력의 수평 방향만 프레임당 약 5°(`rules.special.track.turn` 7/512 바퀴) 이내로 대상 쪽으로 돌린다. 높이는 대상이 웅크림·점프 중이거나 던질 때 자리에서 8px 이상 옮겨 갔을 때만, 이대로면 대상 상자에 닿지 않을 경우 대상 상자 가운데를 겨눈다. 높이(세로) 보정은 대상이 웅크리거나 점프하거나 8px 이상 옮겨 갔을 때만 하지만, 수평 조향은 커브·곡선 핸들러에서도 대상 쪽으로 보정되므로 가만히 선 대상에게도 원작에서 빗나가던 커브 필살이 명중으로 바뀔 수 있다(설계상 의도: 받아내기 외에는 피할 수 없음. 머리 위로 지나가는 lob 처럼 높이 때문에 빗나가는 궤적은 가만히 선 대상에게 그대로 빗나간다). 대상을 지나치거나 대상이 피격·쓰러짐 등으로 판정 대상이 아니게 되면 추적이 끝나고, 벽·바닥·천장 종료는 원작과 같다. 캐치·받아치기·피격 판정은 원작 그대로다.
- 서버 권위: 공 위치는 `snap` 으로만 내려간다(클라이언트는 그리기만, 예측 없음). 엔진은 정수 표·정수 연산만 쓴다(결정론).

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

## 11. 래더(랭크 대체) — 서버 2026-11-20 박백엔, [자작]. 수치 analysis/46 §6(시작값), 화면은 후속(윤프론)
구현 `server/ranking/elo.js`(규칙 값 `LADDER` 한 곳 + 순수 함수), `server/ranking/queue.js`(대기열), `server/store/ranking.js`(SQLite v3), `server/lobby/lobby.js`(대기열·래더 방·판정). 종전 랭크 방(2026-11-18, `create_room{ranked:true}`)은 **없어졌다**(`LADDER_ONLY`).

### 11.1 규칙
- **누가**: **계정만**(2026-11-20 사용자 결정). 손님 세션의 `ladder_join` = `ACCOUNT_REQUIRED`(같은 연결에서 가입해 계정으로 올라가면 가능), 짝 찾기도 계정 세션만 고른다. 이전 규칙 「계정 대 손님 래더 판은 계정만 K 16 반영」은 래더 한정으로 폐기 — 서버 코드(K 16·`guest:` 키·`vsGuest`·좌석 `guest:true`)는 도달 불가 상태로 남아 있다(미래 대비). 일반 사람끼리 방은 점수가 없으므로 K 16 과 무관하고, 손님이 낀 판은 계정 쪽 전적(`pvp`)만 오른다.
- **Elo**: 시작 1000, 하한 100, K 32, 시즌 첫 10판 K 48(시즌마다 다시), 각자 자기 K·반올림. 1000 대 1000 승 = +16(배치 +24, 손님 상대 +8).
- **배치**: 시즌 5판 미만 = 배치 중(티어·순위 숨김, 순위표 제외). 5판째에 레이팅으로 티어를 바로 정한다.
- **티어**: `bronze` < 950 ≤ `silver` < 1050 ≤ `gold` < 1150 ≤ `platinum` < 1250 ≤ `diamond`. 승급 = 위 티어 하한에 닿으면 바로, 강등 = 지금 티어 하한 − 25 아래로 내려가면(내려간 칸에도 같은 완충). 표시 티어는 저장한다(레이팅만으로 계산되지 않는다).
- **마스터**: 순위 조건(실시간). 시즌 순위표 인원(배치 완료·최근 14일 안 경기) ≥ 20 일 때 레이팅 ≥ 1250·시즌 20판 이상인 계정 중 상위 `min(5, max(1, floor(인원 × 0.05)))` 명. 마스터는 완충을 쓰지 않는다. 시즌 종료 때 확정값을 저장한다.
- **비활동**: 마지막 래더 경기 14일 지나면 순위표·마스터 자격에서 빠진다(레이팅·티어는 그대로, 내 줄 `inactive:true`).
- **시즌**: 28일. 시즌 1 = 전원 1000(종전 랭크 기록은 보관 표 `ratings_v2_archive`). 종료 시각이 지나면 서버가 시즌을 닫고(마스터 확정) 다음 시즌을 연다: 레이팅 `round(1000 + (r − 1000) × 0.5)`, 판수·승·패 0(배치·K 48 다시), 기권 잠금 유지, 지난 시즌 행은 남긴다. 다음 시즌 시작 = 지난 시즌 종료 시각(28일 단위 고정, 서버가 꺼져 있던 동안 지난 시즌 수만큼 넘긴다).
- **반영되는 종료**: GO 이후의 정상 종료(`annihilation`/`timeup`/`sudden_death`)와 기권(`forfeit_leave`/`forfeit_disconnect`, 기권한 쪽 패배). `draw_cap`·`error`·GO 이전 종료는 무효(`why:'VOID'`).
- **같은 상대 제한**: 같은 두 키(손님 = `guest:<키>`)가 24시간 안에 반영된 경기 3번이면 4번째부터 `counted:false, why:'PAIR_LIMIT'`(레이팅·래더 승패 불변, 사람끼리 전적은 오른다). 대기열은 이런 짝을 다른 후보가 있으면 고르지 않고, 먼저 선 쪽 대기가 60초를 넘었을 때만 짝짓는다(`ladder_matched.counted:false` 로 미리 알린다).
- **기권 잠금**: 최근 래더 경기 10판(반영 여부 무관) 중 자기 기권 3번 = 30분 잠금(`RANKED_LOCKED{params.until}`): `ladder_join`·래더 방 `start` 를 거절(계정만, 손님은 잠금 없음).
- **자기 대전 불가**: 같은 키끼리는 짝짓지 않고 기록하지도 않는다(`SAME_KEY`). 같은 IP 두 세션 미반영은 없다(`TRUST_PROXY` 의존).
- **사람끼리 전적(`pvp`)**: 사람 두 명이 한 모든 멀티 경기(래더 + 일반 사람끼리 방, 불꽃 팀 허용 방 포함. 컴퓨터 대전·스토리·특훈·리그·불꽃 도전 제외)의 승·패를 계정별로 센다(시즌 무관, 손님 저장 없음). 일반 방 경기는 레이팅을 바꾸지 않는다. 반영 조건은 위 「반영되는 종료」와 같다.
- 래더 경기 규칙 고정: 녹아웃·5분, 팀 0~21(SPECIAL 허용, 22~24 `TEAM_INVALID`), 필살슛 유도 적용(§5.8, `room.evade:'track'`).

### 11.2 대기열·래더 방
| 요청 | 설명 |
|---|---|
| `{t:'ladder_join'}` | 대기열에 선다(이미 서 있으면 그대로). 손님 `ACCOUNT_REQUIRED`, 방·경기 중이면 `ALREADY_IN_ROOM`, 잠긴 계정 `RANKED_LOCKED`. -> `ladder_queue{queued:true}`. 세션당 분당 30회(캠페인 창과 공유) |
| `{t:'ladder_cancel'}` | 줄에서 빠진다 -> `ladder_queue{queued:false, reason:'cancel'}`(서 있지 않았으면 `reason:'none'`) |
| `{t:'ladder_status'}` | -> `ladder_status`(시즌·규칙 값·내 상태·대기 상태) |
| `{t:'ladder_board', top?:1~50}` | -> `ladder_board`(순위표). 종전 `ranking_list` 는 같은 내용을 `t:'ranking_list'` 로 돌려준다(하위 호환) |
| `{t:'pvp_board', top?:1~50}` | -> `pvp_board`(전체 랭킹, 시즌 무관 누적 승). §11.6 |

- **대기 상태 푸시**(2026-11-20): 줄에 선 동안 1초 짝 찾기 주기마다, 허용 차(`window`, 15초마다 넓어짐)나 줄 인원(`waiting`)이 마지막으로 보낸 값과 다르면 서버가 `ladder_queue{queued:true}` 를 다시 보낸다(같으면 보내지 않는다, 끊긴 세션 제외). `waitSec` 은 화면이 `since`·`serverTime` 으로 센다. 폴링은 필요 없다(`ladder_status` 를 쓰더라도 분당 30회 상한 안).
- 짝 찾기: 줄을 설 때 1회 + 1초마다. 허용 레이팅 차 = `100 × (1 + floor(대기초 / 15))`, 60초 이상 무제한, 두 사람 중 넓은 창으로 판정(`windowRule:'max'`). 오래 기다린 사람부터, 허용 범위 안에서 레이팅 차가 가장 작은 상대. 손님은 1000 으로 본다.
- 줄에서 자동으로 빠지는 때: 연결 끊김(`reason:'disconnect'`, 다시 붙으면 `ladder_join` 을 다시 보낸다 — 끊긴 연결에는 알림이 가지 않는다), 로그아웃(`logout`), 다른 방 입장·스토리·리그·불꽃 등(`room`), 손님 세션에서 가입 승격(`account`, 계정 레이팅으로 다시 선다).
- 짝이 지어지면 서버가 **래더 방**을 만들어 두 사람을 앉힌다: 먼저 선 사람이 좌석 0(방장). 두 사람에게 `ladder_matched` 다음 `room_joined`. 이후는 일반 대기실과 같다(팀 고르기 -> 좌석 1 `ready` -> 방장 `start`).
- 래더 방: `room.ranked:true` + `room.ladder:{counted, startBy}`, 방 목록에 없다, 다른 사람 `join_room` = `ROOM_FULL`, `set_rules` = `RANKED_RULES_FIXED`, 불꽃 팀 = `FLAME_TEAM_ROOM`. 좌석(`slots[i]`)에 계정은 `rating`·`placement`·`placementLeft`(배치 남은 판, 완료 0 — 「배치 n/5」 표시용)·`tier`(배치 중 `null`, `'master'` 가능). `ladder_matched.opp` 에도 같은 키. 손님 좌석 `guest:true` 는 도달 불가(래더 = 계정만).
- **한 판만**: 경기가 끝나면(`game_end` -> `ranking_result`) 방을 없애고 두 사람 모두 `room_left{reason:'ladder_end'}` -> `room_list`. 재경기는 다시 `ladder_join`. 경기 전에 한 사람이 나가거나 유예 만료로 빠지면 남은 사람도 `room_left{reason:'ladder_cancel'}`(벌점 없음). `startBy`(매칭 뒤 120초)까지 시작하지 않으면 두 사람 모두 `room_left{reason:'ladder_timeout'}`. 경기 중 퇴장은 종전대로 기권패.

### 11.3 서버 -> 클라이언트
```js
{ t:'ladder_queue', queued:true, since, waitSec, window:number|null, rating, waiting, serverTime }  // window = 지금 허용 차(null = 무제한), waiting = 줄 인원(나 포함), rating = 짝 찾기에 쓰는 값(손님 1000)
{ t:'ladder_queue', queued:false, reason:'cancel'|'none'|'logout'|'room'|'account'|'disconnect' }
{ t:'ladder_matched', code, you:0|1, counted:boolean, startBy, opp:{ nick, rating?, placement?, placementLeft?, tier?, guest? } }  // counted:false = 같은 상대 제한으로 이번 판은 반영 안 됨
{ t:'ladder_status', serverTime, season:{ n, startedAt, endsAt },
  config:{ tierBounds:{silver,gold,platinum,diamond}, tierDemoteBuffer, placementGames, master:{topN,pct,minPlayers,minRating,minGames}, queue:{expandStep,expandSec,maxWaitSec,windowRule,tickMs}, rules, maxTeam, pairLimit, inactiveDays },
  me: { rating, tier:string|null, games, w, l, placement, placementLeft, rank:number|null, inactive, master, lockUntil, pvp:{w,l} } | null,   // 손님 null
  queue: <ladder_queue 와 같은 꼴> }
{ t:'ladder_board' /* 또는 'ranking_list' */, season:{ n, startedAt, endsAt }, total, masterQuota,
  top:[{ rank, nick, rating, w, l, tier, pvp:{w,l} }],     // 시즌 배치 완료·활동 중만, rating 내림차순(같으면 같은 rank, 그다음 승 많은 순). tier 에 'master' 포함
  me:{ rank|null, nick, rating, w, l, games, placement, placementLeft, tier|null, inactive, pvp:{w,l} } | null }   // 손님 null
{ t:'ranking_result', matchId, ladder:true, season, counted, why?:'VOID'|'PAIR_LIMIT'|'SAME_KEY',
  before, after, delta, oppBefore, vsGuest, tierBefore, tier, placement, placementLeft }   // 래더 경기 game_end 바로 뒤, 계정 좌석별(내 값). 손님 좌석에는 보내지 않는다. 상대가 손님이면 oppBefore = 1000
```
- `tier`·`tierBefore` 키: `bronze|silver|gold|platinum|diamond|master`, 배치 중 `null`. 승급·강등 = 두 값 비교(마스터는 순위표·`ladder_status` 에서만 보인다 — `ranking_result.tier` 는 저장 티어).
- 결과 레코드(§6)에 `ranked:true, ratingCounted, ratingDelta:[좌석0, 좌석1]`(종전과 같다).

### 11.4 저장(SQLite `data/tongki.db`, 스키마 v3)
- `ratings(key, season, nick, rating, w, l, games, tier, lock_until, last_game_at, updated_at)` 기본키 (key, season). `ladder_seasons(season, started_at, ends_at, closed_at, final)`(final = 종료 확정 JSON `{players, masters:[{key,nick,rating}]}`). `pvp_records(key, nick, w, l, updated_at)`. `rank_games(…, season)`(종전 행 = 0). 보관 `ratings_v2_archive`(v2 의 ratings 그대로). 한 경기 판정·시즌 전환은 트랜잭션 하나.
- **v3 게이트(2026-11-20 리뷰 M2)**: 기존 DB(`schema_version` ≥ 1)에 v3 를 적용하려면 환경변수 `LADDER_MIGRATE=1` 로 기동해야 한다. 없으면 아무것도 적용하지 않고 `MIGRATION_GATED` 오류(한국어·영어 두 줄)를 남기고 **서버 시작을 멈춘다**(종료 코드 1). 새 DB(버전 0, `:memory:`·시험 포함)는 게이트 없이 최신까지 만든다.
- 마이그레이션 v3·되돌리기 SQL: docs/HANDOFF.md 「래더」 절. v3 DB 는 옛 코드로 열 수 없다(ratings 기본키가 달라 랭크 저장이 실패) — 코드를 되돌리면 DB 도 되돌린다.

### 11.5 저장 계층·이전(계정·진행·리그·랭킹 공통)
- `server/store/db.js` 한 파일만 `node:sqlite`(Node 22.5 이상 내장)를 쓴다(better-sqlite3 로 바꿀 때 이 파일만). WAL, `schema_version` 표 + `MIGRATIONS` 배열(끝에 추가만). SQL 은 언제나 바인드 파라미터.
- 표: `accounts`, `auth_tokens`(토큰 해시), `progress`, `leagues`, `ratings`, `rank_games`, `meta`.
- JSON 가져오기(`server/store/migrate.js`): 서버 시작 때 `PROGRESS_PATH`·`LEAGUE_PATH`(기본 `data/progress/*.json`)를 가져온다. 파일별 `meta` 표식(크기·수정 시각)이 같으면 건너뛰고, 파일이 바뀌었으면 다시 합친다. 합치기 규칙(코드와 같다): (a) 키마다 **처음 가져올 때만 새 행을 넣고** `meta` 에 `json_imported:<progress|league>:<키>` 로 기록한다. (b) 가져온 적 있는 키는 DB 에 행이 남아 있을 때만 고치고, 행이 없으면 다시 넣지 않는다(리그 포기·손님 데이터 분리 보존 뒤 부활 없음). (c) 고치는 조건: 진행은 JSON `clearedMax` 가 더 클 때만, 리그는 JSON `updatedAt` 이 DB `updated_at` 보다 새로울 때만(그때는 리그 전체를 JSON 값으로 바꾼다). (d) 가입된 계정 키는 처음이든 아니든 건너뛴다(계정 데이터는 DB 에서만 바뀐다). 처음 가져올 때 원본 사본을 `<DB 폴더>/backup/json_before_sqlite/`(환경변수 `JSON_BACKUP_DIR`)에 두고, 원본 JSON 은 지우거나 바꾸지 않는다. 수동 실행: `node server/store/migrate.js --db <파일> --progress <json> --league <json> [--backup <폴더>]`. 한계: 키별 표식이 생기기 전 버전으로 이미 가져온 DB 에는 `json_imported:*` 표식이 없어, 그 DB 에서 지워진 행(리그 포기·분리 보존)은 JSON 이 바뀐 뒤 첫 재가져오기에서 한 번 다시 들어올 수 있다(그 뒤로는 표식이 남는다. (d) 계정 키 건너뛰기는 그대로).

### 11.6 전체 랭킹 `pvp_board` — 서버 2026-11-20 박백엔, 화면은 후속(윤프론)
순위표는 두 가지다. **래더 랭킹**(`ladder_board`, §11.3) = 래더전 레이팅으로만 순위, **시즌별 초기화**. **전체 랭킹**(`pvp_board`, 이 절) = 래더전 + 일반 사람끼리 방 경기를 합산한 **시즌과 무관한 누적** 전적(`pvp_records`, §11.1 「사람끼리 전적」)으로 순위. 구현 `server/store/ranking.js` `pvpBoard`, 처리기 `server/lobby/lobby.js` `pvp_board`.

| 요청 | 설명 |
|---|---|
| `{t:'pvp_board', top?:1~50}` | -> `pvp_board`. top 생략 50, 범위 밖·정수 아님 `BAD_MESSAGE`. 빈도 = `ladder_board` 와 같다(세션당 분당 30회, 캠페인 창 공유). 위치 무관 |

```js
{ t:'pvp_board', total,                                   // 전적 1판 이상인 계정 수
  top:[{ rank, nick, w, l, games, rate }],                // 1~top 위. games = w + l(플레이 횟수), rate = 승률 천분율 정수 floor(w*1000/games) (0~1000, 예 750 = 75.0%)
  me:{ rank:number|null, nick, w, l, games, rate } | null } // 계정 = 내 줄(목록 밖이어도 rank 계산, 전적 없으면 rank:null·0), 손님 = null
```
- 정렬: 승 `w` 내림차순 -> 승률 `rate` 내림차순 -> 판수 `games` 내림차순 -> 닉네임(코드포인트 순). **승·승률·판수가 모두 같으면 같은 rank**(1,1,3 식, 닉네임은 같은 rank 안 표시 순서만 정한다). 최소 판수 필터 없음(1판 이상 전부).
- 대상: `pvp_records` 중 `accounts` 에 있는 계정만(손님은 저장 자체가 없다). `nick` = 계정 표의 닉네임.
- 조회 비용·색인 결정: **새 색인 없음**. 근거 — ① 정렬 열 `rate` 가 계산값이라 `pvp_records(w)` 색인으로는 정렬기를 없애지 못하고(같은 `w` 안에서 다시 정렬), ② 행 수 = 사람끼리 경기를 한 계정 수(지금 운영 계정 0~수십), ③ 측정(메모리 DB, 계정 20,000행): 계획 `SCAN p | SEARCH a USING INDEX (key=?) | USE TEMP B-TREE FOR ORDER BY`(LIMIT 상위 N 정렬기), `pvpBoard` 1회(목록·전체 수·내 줄·내 순위 COUNT 4문) **약 33ms**, ④ v3 는 정검수 리뷰 대상이고 `db.js` 규칙이 「배열 끝에 추가만」이라 v3 정의를 고치지 않는다. 계정이 수만을 넘어 느려지면 v4 로 `CREATE INDEX IF NOT EXISTS`(표현식 색인 또는 순위 캐시)를 추가한다.

## 12. 불꽃의 계승(flame_legacy) — 엔진 flame 옵션 (P1, 2026-11-19 박백엔)

기준: `analysis/36`(기획 원문), `analysis/37`(분석), `analysis/39_flame_decisions.md`(확정 결정 D1~D14·구현 가정). 이 절은 **엔진 옵션과 `game_start`/`game_end` 확장만** 다룬다. 도전 진행 요청(`flame_*`)·저장은 §13 이다(로비가 저장된 도전 상태에서 이 옵션을 조립해 비공개 방으로 경기를 만든다).

원칙: `Match` 옵션 `flame` 을 주지 않으면 엔진 동작·`game_start`·스냅샷·이벤트가 종전과 완전히 같다(같은 시드 대조로 확인, HANDOFF §4-19). 모든 효과는 flame 좌석 선수에게만 걸리고 상대 좌석은 원작대로다. 훅은 난수를 부르지 않는다.

### 12.1 엔진 옵션 (`new Match({…, flame})`, `new RoomGame({…, flame})`)

```
flame: {
  seat?: 0|1,                 // flame 좌석(기본 0). Match 옵션 teams[seat] 는 쓰이지 않는다
  roster: [7칸 {              // 순서 = 라인업: 0~3 내야, 4 상단·5 하단·6 후방 외야. 0번 = 주장·점프볼 참가자
    from: {team, idx},        // 출신 선수(teams.json). 같은 선수 중복 불가(이 7칸 안에서만 본다. 상대 좌석과는 대조하지 않는다)
    stat?: {hp,def,spd,s3,pow,s5,thr,pass}, // 최종 능력치(정수, 일부만 줘도 됨. 없는 칸 = 출신 원본). 하한 HP 1·나머지 0
    hp?: number,              // 시작 현재 HP. 기본 = 최대 HP. [1, 최대 HP] 로 자른다(HP 0 선수는 1 로 출전)
    ext?: {r1, r2, r3},       // R1 넉백 저항 %(상한 60), R2 캐치 후 밀림 감소 %(상한 60), R3 쓰러짐 단축 프레임(상한 24, 쓰러짐 하한 36)
    sp?: [id|null, id|null],  // 필살기 슬롯. 경기 중 발동은 슬롯 0(주 슬롯)만
    fx?: {                    // 조건부 효과(전부 정수, 기본 0). 팀 공용 효과는 서버가 선수마다 더해서 넘긴다
      catchPow,               // 캐치 성공 후 첫 투구 위력 +N
      passSpd,                // 이 선수가 패스한 공을 받은 같은 편 선수의 다음 투구 속도 +N(s6 단위 = N/16 px/f)
      chargePow,              // 차지 13~15 투구 위력 +N(일반·필살 모두)
      airPow,                 // 공중 투구 위력 +N
      lowHpDef,               // HP 30% 이하일 때 방어 +N
      survive,                // 치사 피해를 HP 1 로 버티는 남은 횟수
      spPow, spAirPow, spPct, // 필살 위력 +N / 공중 필살 +N / 필살 위력 +%
      spSpd,                  // 필살 투구 속력 +N(s6 단위 = N/16 px/f). 필살 ID 가 정해진 뒤 직역 투구(romThrow)에서만 붙고 초기 속도(V0)가 된다. 받아치기 공·일반 투구는 가산 없음(D52, 2026-11-19)
      famPow:{계열:N}, famPct:{계열:%}, // 계열 필살 위력(계열 = families 의 키)
    },
  }],
  allow?: number[],           // 해금된 필살기 ID. 없으면 전부 잠금. 위력 표값 255 인 ID(0·16·30·32·38·46·47)는 넣어도 빠진다
  families?: {계열:[id…]},    // famPow/famPct 판정용(server/flame/data/shot_families.json)
  fm?: 0~14,                  // 포메이션 패턴(이름 번호, §5.6). 없으면 team 의 패턴
  team?: number,              // 좌석 대표 팀 id(기본 = roster[0].from.team): game_start.teams[seat].id·이름
  caps?: {…}                  // 상한·규칙 스위치(server/engine/flame.js FLAME_DEFAULTS). 보통 생략
}
```
- 잘못된 옵션(7칸이 아님, 없는 선수·필살 ID, 같은 선수 중복, 정수가 아닌 값(`from.team`·`from.idx`·`team`·`fm`·`allow[]`·`families` 포함, 문자열 숫자도 거절), 음수 효과값, 특훈과 함께 사용)은 `Match` 생성 때 예외다. 호출자가 먼저 검증한다.
- 안전 상한(2026-11-19, P1 리뷰 M1·M2, `flame.js FLAME_LIMITS`): 능력치는 [하한, 255], `fx`·`famPow`·`famPct` 는 0 이상 정수(255 까지), 훅을 거친 최종 위력은 [0, 4095] 로 자른다. `caps` 는 아는 키만 받고 범위를 자른다(`r1MaxPct`·`r2MaxPct` 0~100, `r3MaxFrames` 0~255, `downFramesMin` 1~255, `lowHpPct` 0~100, `hpFloor` 0~1, 스위치는 boolean). `caps`·`roster`·`allow` 는 클라이언트 입력이 아니라 서버가 저장된 도전 상태와 데이터에서 조립한다(§13).
- 능력치는 언제나 복사본에 넣는다(전역 캐시 `teams.json` 객체는 바뀌지 않는다).
- 위력 가산 순서: (일반 슛 = 원작 식 / 필살 = 표값) + 고정값 합 → % 는 마지막에 내림. 받아치기 공(잡은 공의 위력·속력 승계)과 포메이션 엔드 어택에는 가산하지 않는다.
- 필살 잠금: 주 슬롯 ID 가 `allow` 에 없으면 공중 차지 13~15 투구도 일반 슛(차지의 위력·속력 가산은 남는다, こうしき 와 같은 형태). 받아치기 필살은 `caps.lockCounter`(엔진 기본 true)가 true 면 주 슬롯이 해금된 선수만 된다. **불꽃의 계승 서버는 `decisions.json special.counterAnyPlayer`(기본 true, analysis/39 D64, 2026-11-20)로 `lockCounter:false` 를 넘긴다** → 필살기가 없는 선수도 상대 필살 공을 받아치면 잡은 공의 ID·위력·속력으로 받아치기 필살이 나간다(이벤트·스냅샷은 일반 받아치기 필살과 같다: `throw` 뒤 `special{p,id}`, 새 키 없음).
- 20초 보유 제한·피격/캐치 판정·난수 순서는 건드리지 않는다.
- 필살기 부여 구조(§13.21, 2026-11-19): 엔진 옵션은 **바뀌지 않았다**. 서버가 `allow` 에 「낀 아티팩트가 부여한 슛 + 로스터 원작 선수의 고유 슛」을 넣고, `roster[i].sp` 는 선수별 발동 가능 집합으로 거른 값을 넘긴다(불씨·클론은 아티팩트가 없으면 `[null, null]`).
- 오리지널 팀(§13.8, 2026-11-19): 엔진 옵션은 **바뀌지 않았다**. 오리지널 선수의 `from` 에는 능력치·히트박스·기본 필살기의 출처인 `original_team.json` 의 `base` 선수가 들어간다(1차 = 태동 7명과 같은 값). 이름·몸(skin)·팀명은 엔진에 넘기지 않고 `RoomGame` 옵션 `flameCast` 로 따로 실어 `game_start.flameCast` 로 보낸다(§12.2).

### 12.2 `game_start` 확장 (flame 경기에만 있는 키)

- `flame: {seat, fm, allow:[id…]}` — flame 좌석, 고른 포메이션 패턴(없으면 null), 해금된 필살기 ID(오름차순).
- `teams[flame.seat]` = `{id, name, flame:true, players:[7]}`. 선수 칸은 §5.1 의 칸에 더해:
  - `idx` = 라인업 번호(0~6, `pid = seat*7 + idx` 는 그대로), `role` = 라인업 자리 기준.
  - `hp, def, spd, s3, pow, s5, thr, pass` = **주입된 최종 능력치**(`hp` = 최대 HP).
  - `from: {team, idx}` = 출신. **스프라이트 시트·행, 몸통 클래스, HUD 얼굴, 말풍선 문구, 선수 이름은 좌석 팀·`pid%7` 이 아니라 이 값으로 찾는다.**
  - `hp0` = 시작 현재 HP, `r1`·`r2`(%)·`down`(쓰러짐 프레임), `sp:[id|null, id|null]`, `spOn` = 지금 발동되는 ID(잠겨 있으면 null).
- 상대 좌석의 `teams[…]` 은 §5.1 그대로(`from` 없음). `rules.formation.names[flame.seat]` 은 고른 패턴 번호.
- `flameCast: {seat, team, players[7]}`(추가 키, 2026-11-19 오리지널 팀. flame 경기에만 있다) — 표시용 정의. 형식은 `flame_state.run.cast` 와 같고(§13.8) `seat` 만 더 있다. `team` = `{id, name, short, intro}`(오리지널 팀으로 시작한 도전) 또는 `null`(종전 태동 도전: 좌석 팀 이름은 종전대로 `teams[seat].id`). `players[i]`(라인업 순서 = `teams[seat].players[i]` 와 같은 번호) = 오리지널 선수면 `{id, name, role, tagline, skin{team, idx, uni, hair}, protagonist, locked}`, 원작 선수(영입)면 `null`. **`players[i]` 가 있으면 이름은 `name`, 스프라이트 시트·행·HUD 얼굴은 `from` 이 아니라 `skin.team`·`skin.idx` 로 찾고 `skin.uni`·`skin.hair` 색 세트로 치환한다.** 몸통 클래스는 `skin` 몸과 `from` 이 같게 맞춰져 있어(서버 시작 때 검사) 어느 쪽으로 찾아도 같다. `team` 이 있으면 좌석 대표 팀 이름·약칭은 `team.name`·`team.short` 다(39 A14 개정). `teams[seat].id`·`name`·`from` 은 종전 그대로라 이 키를 읽지 않는 화면은 태동 선수로 그린다. 재접속 `game_start{resumed:true}` 에도 실린다.
- 클라이언트(2026-11-19, 박백엔 최소 반영): `screens/game.js` 가 `from` 이 하나라도 있으면 `orig[pid] = {team, idx}` 표를 만들어 `Renderer`(선수별 시트 `pSheets`·행·몸통 클래스)·`Hud`(얼굴)·`ShoutFx`(말풍선 키, 슛 ID 이름 우선)에 넘긴다. `from` 이 없으면 종전 경로 그대로다. 실화면 검증은 아직 하지 않았다.

### 12.3 이벤트·종료

- 이벤트 `fl_survive {p}`: 치사 피해를 HP 1 로 버팀(같은 틱의 `hit` 이벤트는 `dmg` = 실제 깎인 값, `hp:1`).
- `game_end.flame = {seat, hp:[7], maxHp:[7], surviveUsed:[idx…]}`(flame 경기만): 라인업 순서의 최종 HP·최대 HP, 치사 생존을 쓴 라인업 번호. 아웃된 선수는 HP 0 이다(다음 경기 HP 1 처리는 도전 상태 쪽, D5). 엔진에서는 `match.flameResult()`.

## 13. 불꽃의 계승(flame_legacy) — 도전 진행 요청 `flame_*` (P2~P5 서버, 2026-11-19 박백엔)

기준: `analysis/36`(기획), `analysis/37` §4(모듈 구조), `analysis/38`(데이터), `analysis/39`(결정 D1~D14 + P2 가정 B1~B16). 서버 코드 `server/flame/`(catalog·stats·items·map·rewards·nodes·run·save·handlers), 저장소 `server/store/flame.js`. 클라이언트 화면은 §13.7(P6, 2026-11-19 윤프론). 환경변수 없이 언제나 켜져 있다. `server/flame/data` 가 깨져 있으면 기존 모드는 그대로 뜨고 `flame_*` 만 `FLAME_UNAVAILABLE` 로 거절한다.

원칙
- 서버 권위: 지도·보상·상점·영입 후보·이벤트 결과는 서버가 만든다. 클라이언트는 **번호·ID 만** 보낸다(수치를 보내도 읽지 않는다).
- 난수(2026-11-19 P2 리뷰 M2): **지도**는 지도 시드(`run.seed`, 32비트)로, **보상·재선택·상점·영입 후보·이벤트**는 도전마다 새로 만드는 **비밀값(`run.secret`, 128비트)** 으로 뽑는다(흐름마다 `HMAC-SHA256(비밀값, 키)` 로 초기값을 만든다, `rng.js rngSecret`). 둘 다 저장만 하고 클라이언트에 보내지 않는다. 지도 시드는 화면에 보이는 지도에서 역산할 수 있지만 그것으로 얻는 것은 이미 보이는 지도뿐이다. 보인 보상 하나에서 그 흐름의 상태를 알아내도 다른 흐름(다음 보상·재선택·상점)은 알 수 없다.
- 엔진 flame 옵션(§12.1 `roster`·`allow`·`families`·`fm`·`caps`)은 경기 노드를 고를 때 **저장된 도전 상태와 서버 데이터에서만** 조립한다(`run.js matchOptions`). `caps` 는 `rules.json clamps` + `decisions.json engine`.
- 모든 `flame_*` 요청의 정상 응답은 `flame_state` 하나다(아래 예외 표기 제외). 거절은 공통 `error{code, msg, ref}` 이고 **클라이언트는 토스트로 보인다**(인라인 오류 상자 없음). 거절된 요청은 상태를 바꾸지 않는다.
- 방 안(경기 중)에서는 `flame_get`·`flame_catalog` 외의 `flame_*` 가 `ALREADY_IN_ROOM` 이다. 빈도 제한은 세션당 분당 `MAX_FLAME_PER_MIN`(기본 300), 초과 `CAMPAIGN_RATE_LIMITED`.
- 수치는 전부 데이터다: 기획 수치 = `rules.json`·`economy.json`·`perm_upgrades.json`, 기획에 없던 수치([자작 제안]) = `run_config.json` 과 각 파일의 `proposed`.

### 13.1 요청 (클라이언트 -> 서버)

| 요청 | 필드 | 동작 |
|---|---|---|
| `flame_get` | - | 현재 상태. 진입·이어하기·재접속 복구 |
| `flame_catalog` | - | 마스터 데이터 `flame_catalog`(§13.4). `flame_state.catalogVer` 가 바뀌었을 때만 다시 받으면 된다 |
| `flame_new` | `diff?`(0 기본, 1 고난도 = PC06 해금) | 새 도전. 진행 중 도전이 있으면 포기로 정산(`flame_end{summary.result:'abandon'}` 가 먼저 온다). '처음부터' 확인은 클라이언트가 한다 |
| `flame_abandon` | - | 도전 포기 = 그때까지의 코인 정산. `flame_end` -> `flame_state{run:null}` |
| `flame_node` | `id`(`run.candidates` 중 하나) | 노드 선택. 경기 노드(normal·strong·boss) = 비공개 방을 만들어 바로 시작: `room_joined{room.flame:{node,type}}` -> `game_start{flame,…}`(§12.2). 그 밖 = `flame_state`(상점·특훈장은 `run.node` 가 열린 상태, 휴식·영입·이벤트는 `run.pending[0]`) |
| `flame_practice` | - | 연습 경기(§13.15, D28). 첫 도전의 구간 1 첫 경기 전에 계정당 한 번. 비공개 방을 만들어 바로 시작: `room_joined{room.flame:{node:null,type:'practice'}}` -> `game_start{flameCast.practice:true,…}`. 받을 수 없으면 `FLAME_PRACTICE_NONE`, 풀지 않은 선택이 있으면 `FLAME_PENDING` |
| `flame_leave` | - | 상점·특훈장에서 나간다(다음 층으로) |
| `flame_choose` | `i`, `p?` | 맨 앞 선택 `run.pending[0]` 을 푼다. 장비·아티팩트 = `choices[i]` 1개 획득(`i:-1` = 받지 않음). 영입 = `choices[i]` 를 라인업 `p` 자리와 교체(`i:-1` = 영입 안 함. `p` 자리가 주인공이면 `FLAME_PROTAGONIST`, §13.8). 휴식 = 옵션 `i`(집중 치료는 `p`). 이벤트 = 선택지 `i`(응답에 `note{event, choice, results[]}`) |
| `flame_reroll` | - | 맨 앞 장비·아티팩트 선택지를 다시 뽑는다(`run.rerolls` 1 소모) |
| `flame_equip` | `p`, `inst` \| (`inst:null`, `slot`) | 장착(슬롯은 아이템 분류로 정해짐) / 해제. 다른 선수가 낀 인스턴스는 `FLAME_EQUIPPED` |
| `flame_auto_equip` | `p?` | 자동 장착(생략 = 전원). 남이 낀 장비는 뺏지 않는다 |
| `flame_upgrade` | `inst` | 강화 +1(최대 +3). 특훈장·상점 안에서만(`FLAME_NOT_HERE`) |
| `flame_sell` | `inst` | 판매(끼지 않은 장비만) |
| `flame_artifact` | `id`, `slot?` \| (`id:null`, `slot`) | 아티팩트 장착(슬롯 생략 = 빈 칸, 없으면 `FLAME_FULL`) / 해제 |
| `flame_special` | `p`, `sp:[a\|null, b\|null]` | 필살기 슬롯 2칸. 넣을 수 있는 ID = 지금 해금된 ID(`team.allow`) 또는 그 선수의 원래 ID. 발동은 슬롯 0 만(D1) |
| `flame_formation` | `fm`(0~14) | 포메이션 패턴 변경 -> 태그 보너스·시너지 재계산 |
| `flame_lineup` | `order:[7]` | 라인업 순서(지금 번호의 순열). 0~3 내야, 4~6 외야, 0번 = 주장 |
| `flame_use` | `c`, `p?` | 소모품 사용(경기 밖에서만). 대상이 선수 1명인 것은 `p` |
| `flame_buy` | `i` | 상점 상품 `run.node.stock[i]` 구매 |
| `flame_train` | `p`, `opt`(T01~T11) | 특훈장 능력치 특훈 |
| `flame_perm` | `id`(PA01~PC06) | 영구 성장 다음 단계 구매(불꽃코인). 도전이 없어도 된다 |
| `flame_ranking_get` | `top?`(1~50, 생략 50) | 도달 순위표 `flame_ranking`(§13.13). 응답은 `flame_state` 가 아니다. 방 안(경기 중)에서도 된다 |

### 13.2 서버 -> 클라이언트

- `flame_state {catalogVer, profile, run|null, team|null, note?}`
  - `profile`: `coins`, `earned`, `perm{id:단계}`, `permList[17]{id,name,group:'A'|'B'|'C',lv,maxLevel,costs[],next}`, `spent[]`(최근 20), `unlocked{recruitTeams[], legendary, items[], artifacts[], events[], opponents, difficulty[]}`, `codex{items[],artifacts[],consumables[],players['팀:번호' | 'c:<클론 id>']}`(선수 키: 원작 선수·시작 7명 = `'팀:번호'`, 영입한 오리지널 클론 = `'c:c001'` 꼴. §13.10 D23), `best{seg,wins,clears,clearDiff[]}`, `totals{runs,wins,boss}`, `achievements[]`, `firstClear`.
  - `run`(도전 저장 그대로 + 파생): `id`, `diff`, `seg`(0~2)·`layer`, `segments`(3), `map[seg].layers[][]{id,type,opp?{team,cpuLevel,stage},next[]}`, `candidates[]`(지금 고를 수 있는 노드 ID. 선택이 남았거나 노드 안이면 빈 배열), `node|null{id,type,stock?[{kind,id,price,sold}],picks?}`, `pending[]`(`{kind:'equipment'|'artifact'|'recruit'|'event'|'rest', choices?, event?, src?, nodeType?, n}`. `nodeType`(장비·아티팩트 보상 칸, 아티팩트는 `.m11` 부터) = 보상이 나온 곳의 종류 `start|normal|strong|boss`, §13.19. 영입(`recruit`)의 `choices[]` 는 표시용 정의가 채워진 칸이다, §13.10), `done[]`, `wins{normal,strong,boss}`, `matchesWon`/`matchesTotal`(12), `origTeam?`(오리지널 팀 id. 오리지널 팀으로 시작한 도전만), `roster[7]{from{team,idx},orig?(오리지널 선수 id),clone?(영입 풀 클론 id. 그 칸의 `from` = 클론의 몸, §13.10),hp,train{},equip{headband,glove,protector,uniform},sp[2],recruited}`, `cast{team|null, players[7]}`(추가 칸, 표시용 정의. §13.8), `items[]{inst,id,lv,slot,rarity,stats,wearer,sell,up{lv,maxLevel,cost,stats[{stat,base,now,next,noChange}],noChange,noChangeLabel}}`, `artifactsOwned[]`, `artifacts[3]`, `consumables{id:n}`, `buffs[]{c,p}`, `extraReward`, `extraRecruit`, `points`, `fm`, `rerolls`, `surviveUsed[]`(치사 생존을 쓴 장비 인스턴스, 표시용), `surviveCount`(이 도전에서 쓴 치사 생존 횟수), `inMatch`, `coinsPending{normal,strong,boss,champion,first,pct,total}`, `stat{bestRarity,fms[],bosses[]}`, `matchHp[7]{hp,max,bonus}`(추가 칸, 표시용: 다음 경기 출전 HP. `max` = 다음 경기 최대 HP(= `team.players[i].final.s0`), `hp` = 출전 현재 HP = `min(max, roster[i].hp + bonus)`(HP 0 은 1 로 출전, D5), `bonus` = 다음 경기 소모품 C03·C13 으로 늘어난 최대 HP(D13). 서버가 경기를 만들 때 쓰는 `matchOptions` 와 같은 식이다. `roster[i].hp` 는 종전 그대로 저장된 현재 HP 다).
  - `team`(능력치 계산 결과, `stats.js`): `tag`(포메이션 태그), `synergies[]`, `allow[]`(해금된 필살기 ID), `amp{formation,synergy}`(강화 배율 % 합), `unsupported[]`(엔진 훅이 없어 적용되지 않는 효과), `players[7]{from, base{s0..s7,r1,r2,r3}, final{…}, delta{…}, steps[9]{id,add{}}, over{}(상한 초과분), fx{…§12.1}, down(쓰러짐 프레임), move{walk, capPxPerFrame, capS2, wasted}, role}`.
- `flame_catalog {ver, original, recruit, equipment[40], artifacts[30], consumables[20], synergies[], formationTags[], shotFamilies[], rarity, slots, stats, clamps, nodeTypes, training{options[11],cost,picksPerVisit}, rest[], afterWinHealPct, events[], difficulty[], roles[], achievements[], economy, perm[17]}` — `server/flame/data` 원문(아이콘 경로 `icon` 포함). `afterWinHealPct`(추가 칸) = 승리 뒤 전원 회복 %(`run_config.rest.afterWinHealPct`, 키가 없거나 0 이하면 0 = 꺼짐). `rest[]` 는 종전대로 휴식실 선택지뿐이다. `original`(추가 칸, 개정 4) = 오리지널 팀 정의 `{id, name, short, intro, protagonist, start, protagonistLocked, skinSets{uniforms, hairs}, players[7]{id, name, role, tagline, skin{team, idx, uni, hair}}}` 또는 `null`(§13.8). `ver` = `장비.아티팩트.소모품.run_config 의 _meta.version` + (오리지널 팀 파일이 있으면 `.o<original_team.json 의 _meta.version>`) + `.m<메시지 개정 번호>`(`catalog.js CATALOG_MSG_REV`, 지금 19 — 개정 이력은 각 절·catalog.js 주석. 아래 예는 개정 6 때. 예 `1.1.1.3.o3.p1.m6`. 영입 풀 파일이 있으면 `.o…` 뒤에 `.p<recruit_pool.json 의 _meta.version>` 이 든다). `recruit`(추가 칸, 개정 6) = 영입 풀 요약 `{clone, poolId, poolVersion, count, grades[], rareOriginal}`(§13.10. 풀 명단은 싣지 않는다): 데이터 버전이 그대로여도 메시지에 칸이 늘면 개정 번호가 올라 `catalogVer` 가 바뀐다(클라이언트는 문자열 비교만 하면 된다).
- `flame_result {matchId, node, type, outcome:'win'|'lose'|'rematch'|'stale', reason, hp:[7]|null, saveFailed?}` — flame 경기의 `game_end` 바로 뒤 1회. 결과 저장에 실패하면(3회 시도) 먼저 `error{code:'FLAME_SAVE_FAILED'}`(`ref` 없음, 토스트)가 오고 `outcome:'rematch', saveFailed:true` 다: 결과는 반영되지 않았고 같은 노드를 다시 고를 수 있다(뒤따르는 `flame_state` 는 저장되어 있는 상태).
- `flame_end {summary}` — 도전 종료(패배·우승·포기). `summary{result:'defeat'|'champion'|'abandon', counted(경기를 1판 이상 치른 도전인가. false 면 도전 횟수·최고 기록·업적에 들지 않았다), seg(도달 구간 1~3), wins{}, matches, bosses[팀], bestRarity, formations[], coins{normal,strong,boss,champion,first,defeat,pct,total}, defeatOuts, achievements[새로 얻은 것], lost{items,artifacts,consumables,points,recruited}, teams{recent, best}}`. `teams` = 이번 정산에서 키운 팀 슬롯(§13.20)이 갱신됐는가(boolean 둘. 경기 없는 도전·`versusTeam` 꺼짐 = 둘 다 false, 기록을 넘지 못한 도전 = `recent` 만 true. 응답 칸일 뿐 저장 형식과 무관, 2026-11-19 추가). `coins.defeat` = 패배 분투 보상(D16, [자작 제안]. §13.3 정산), `defeatOuts` = 그 계산에 쓴 상대 아웃 수(0~7. 보상 대상이 아니면 0). 둘 다 항상 있고 패배가 아니면 0 이다. `coins.total` 에 이미 들어 있다(`pct` 적용). `flame_result` 에는 코인 칸이 없다(패배 코인은 뒤따르는 `flame_end.summary.coins` 로만 온다).
- 경기 종료 순서: `game_end{flame}` -> `flame_result` -> (`flame_end`) -> `flame_state` -> `room_left{reason:'leave'}` -> `room_list`.

> **엔드리스(2026-11-19, §13.12)**: 위 `run.seg`(0~2)·`segments`(3)·`map[seg]`·`flame_end.summary.result`·`seg(1~3)` 설명은 엔드리스가 꺼진 종전 형태다. 켜져 있으면(기본) §13.12 의 표가 우선한다 — `seg` 는 상한이 없고, `segments`·`matchesTotal` 은 `null`, 도전은 패배·포기로만 끝난다.

### 13.3 규칙 요약

- **도전**: 시작 7명 = 오리지널 팀 「불씨 국민학교」 7명(D17, §13.8. `decisions.json roster.startOriginal` 키를 지우면 종전대로 태동(팀 0, D4)), 시작 경기 포인트 100(+초기 지원금), 시작 보상 = 장비 선택(2 + 장비 보급), 전술 연구가 있으면 아티팩트 선택. 3구간 × 층 7(일반 → 상점|특훈 → 일반 → 휴식|영입|이벤트 → 강팀 → 상점|특훈|휴식 → 보스), 층마다 후보 1~2개, 총 12경기(D9). 같은 지도 시드 = 같은 지도. 보상은 도전 비밀값을 따른다(같은 도전의 같은 보상은 언제 열어도 같다. 재접속·재시작 뒤에도).
- **경기 결과(D6)**: 좌석 0 의 정상 승리(`annihilation`·`timeup`·`sudden_death`)만 승리. `error`(엔진 오류) = 재경기(같은 노드), 서버 재시작으로 사라진 경기 = 재경기(`flame_get` 때 `inMatch` 가 풀린다). 그 밖(패배·`forfeit_*`·`draw_cap`) = 패배 = 도전 종료. 경기 뒤 현재 HP 는 유지되고 HP 0 선수는 1 로 남는다(D5). **승리 뒤 전원 회복(D15, [자작 제안])**: 이기고 도전이 이어지면 전원 현재 HP 가 최대 HP 의 `run_config.rest.afterWinHealPct` %(시작값 30, half-up)만큼 오른다(최대 HP 까지, HP 1 로 남은 선수 포함. 키가 없거나 0 이면 꺼짐. 패배·재경기·우승에는 없음). **구간 보스 승리(D30, §13.18)** 는 `rest.afterBossHealPct` %(시작값 50)가 이 값을 대신한다(키가 없으면 같은 값). `flame_result.hp` 는 엔진이 낸 경기 종료 시점 값 그대로이고, 회복이 반영된 값은 뒤따르는 `flame_state.run.roster[i].hp` 다. 회복 % 는 `flame_catalog.afterWinHealPct`·`afterBossHealPct` 로 받는다(`rest[]` 는 휴식실 선택지뿐).
- **승리 보상**: 경기 포인트(일반 60·강팀 100·보스 160) + 장비 선택 3장(등급 55/30/12/3 에 구간·노드 보정, 전설은 PC02 해금 뒤, A28·A29·C18 로 장수 증가) + 보스 = 아티팩트 선택 3 / 강팀 = 소모품 1. 선택(`pending`)을 풀어야 다음 노드를 고를 수 있다(`FLAME_PENDING`).
- **정산**: 도전 종료 때 한 번. 일반 20·강팀 40·보스 80 × 승수 + 우승 200 + 첫 우승 300(× 난이도 `coinPct`). **패배 분투 보상(D16, [자작 제안])**: 끝까지 치른 경기(`annihilation`·`timeup`·`sudden_death`)를 져서 도전이 끝나면 그 마지막 경기에서 아웃시킨 상대 수 × `economy.flameCoin.proposed.defeatOutCoin`(지금 값 4, 처음 2)을 최대 `defeatOutCoinMax`(18, 처음 12. 2026-11-19 임밸런 보정 analysis/40 §16.2)까지 더한다(같은 `coinPct` 적용). 아웃 수는 서버의 경기 결과 `game_end.rem[1]`(상대 남은 인원)에서만 읽는다(7 - 남은 인원). 기권(`forfeit_*`)·무승부 상한(`draw_cap`)·포기(`flame_abandon`·`flame_new`)·재경기(`error`·서버 재시작·저장 실패)·우승·승리에는 없다. 두 키가 없거나 0 이면 꺼짐. 값은 `flame_catalog.economy.coin.proposed` 로도 받는다. `flame_state.run.coinsPending` 에는 들지 않는다(항상 `defeat:0`). 도전 저장은 지워지고(영입 선수·장비·아티팩트·강화·특훈·경기 포인트·소모품) 코인·영구 성장·도감·기록·업적은 남는다. **경기를 한 판도 치르지 않은 도전**(시작 직후 포기·`flame_new` 반복)은 도전 횟수(`totals.runs`)·최고 기록(`best`)·업적에 넣지 않는다(`summary.counted:false`, 도감만 합친다).
- **능력치**: §14.1 9단계(`team.players[i].steps`). 정수, 반올림은 half-up 하나. 매번 원본에서 다시 계산하므로 장비를 빼면 정확히 원복한다. 강화는 양수 능력치만 20/40/60% half-up(D11, 변하지 않는 단계는 `noChange`). R1·R2 상한 60, R3 상한 24(쓰러짐 하한 36), 방어 0 이상·HP 1 이상. 이동속도는 걷기 식이 3.0px/f 에 닿는 `capS2`(36)부터 낭비(`move.wasted`).
- **필살기**(부여 구조 D38, §13.21): 선수 자체에는 필살기가 없고 낀 아티팩트가 계열의 슛을 부여한다(`team.grant`). 원작 선수만 자기 고유 슛(`team.players[i].own`)을 아티팩트 없이 쓴다. 아티팩트를 빼면 그 슛은 슬롯에서 비워진다. A06(강위력)은 불꽃·도끼를 주지 않는다. (종전 `special.model='legacy'`: 아티팩트를 장착해야 계열이 해금되고 해제하면 슬롯에는 남되 발동하지 않는다.)
- **소모품**: 보유 5개·종류당 3개. 회복은 즉시, 다음 경기 효과는 `buffs` 에 걸렸다가 경기 뒤 사라진다(C20 은 보스전 뒤). 같은 소모품을 같은 대상에 두 번 걸 수 없다(`FLAME_DUP`). 다음 경기 최대 HP 소모품(C03 선수 +10, C13 팀 +5)은 그 경기에 한해 최대 HP 와 현재 HP 를 같이 올려 출전하고(D13), 경기 뒤 그 선수의 현재 HP 는 **경기 전 값을 넘지 않는다**(늘어난 몫이 먼저 깎인 셈. 회복으로 남지 않는다). 영입으로 교체된 자리의 선수 대상 효과는 사라진다(팀 대상은 남는다).
- **치사 생존(P10)**: 도전 전체에서 1회(`run.surviveCount`). 같은 장비를 또 얻거나 두 명이 껴도 늘지 않고, 라인업 앞 선수가 먼저 받는다. 팔아도 횟수는 돌아오지 않는다.

### 13.4 오류 코드 (전부 토스트)

| 코드 | 뜻 |
|---|---|
| `FLAME_UNAVAILABLE` | 서버 데이터 오류로 모드가 꺼져 있음 |
| `FLAME_SAVE_NEWER` | 저장이 서버보다 새 형식(읽지도 덮어쓰지도 않음) |
| `FLAME_SAVE_BROKEN` | 저장을 읽지 못했고 따로 보존하지도 못함(덮어쓰지 않으려고 요청을 거절) |
| `FLAME_SAVE_FAILED` | 경기 결과 저장 실패(푸시, `ref` 없음). 같은 노드 재경기 |
| `FLAME_NONE` | 진행 중인 도전 없음 |
| `FLAME_INVALID` | 없는 번호·ID, 고를 수 없는 항목 |
| `FLAME_LOCKED` | 해금되지 않은 난이도·포메이션. 필살기 슬롯(`flame_special`): 그 선수가 쓸 수 없는 슛 — 낀 아티팩트가 부여하지 않은 슛, **다른 선수의 고유 슛**, 불씨·클론의 옛 원래 필살기(§13.21) |
| `FLAME_NO_FUNDS` | 경기 포인트·불꽃코인 부족 |
| `FLAME_FULL` | 아티팩트 슬롯 3·소모품 보유 상한 |
| `FLAME_EQUIPPED` | 다른 선수가 낀 장비(장착)·낀 장비(판매) |
| `FLAME_MAX` | 강화 +3·영구 성장 최대 단계·특훈 방문 횟수·재선택 횟수 소진(특훈 누적 상한은 `FLAME_TRAIN_CAP`) |
| `FLAME_PENDING` | 풀지 않은 선택이 있음 |
| `FLAME_IN_NODE` | 상점·특훈장 안(먼저 `flame_leave`) |
| `FLAME_NOT_HERE` | 그 노드가 아님(구매·특훈·강화·나가기) |
| `FLAME_DUP` | 같은 소모품 효과가 이미 걸려 있음 |
| `FLAME_NO_EFFECT` | 효과 없음(HP 가득, 후보 없음) |
| `FLAME_PROTAGONIST` | 주인공은 영입 교체 대상으로 고를 수 없음(D20, §13.8) |
| `FLAME_PRACTICE_NONE` | 연습 경기를 받을 수 없음(꺼져 있음·첫 도전이 아님·이미 썼음·실전을 치렀음, §13.15) |
| `FLAME_TEAM_NONE` | 키운 팀 슬롯이 없음·쓸 수 없음(`set_team{team:'flame:…'}`·`start`, §13.20) |
| `FLAME_TEAM_ROOM` | 불꽃 팀을 쓸 수 없는 방(랭크·사람끼리 방, §13.20) |
| `FLAME_TEAM_RULES` | 불꽃 팀은 체력제(`knockout`)에서만(§13.20): 공식 규칙 방에서 고르거나, 고른 뒤 공식으로 바꾸려 할 때 |
| `FLAME_TRAIN_CAP` | 특훈 누적 상한(D31, §13.18): 그 선수의 그 능력치는 특훈으로 더 올릴 수 없음(`flame_train`), 또는 이벤트 선택지의 무작위 특훈을 받을 선수가 없음(`flame_choose`). 포인트·횟수 소모 없음 |
| 공통 | `ALREADY_IN_ROOM`(경기 중), `TOO_MANY_ROOMS`, `CAMPAIGN_RATE_LIMITED`, `BAD_MESSAGE` |

### 13.5 방

flame 경기 방은 특훈·리그 방과 같은 비공개 방이다: 방 목록에 나오지 않고, `set_team`·`set_rules`·`start` 는 `NOT_IN_CAMPAIGN_ROOM`, 끝나면 방이 없어진다. `room_joined.room.flame = {node, type}` 이 있으면 대기실을 건너뛴다(리그와 같은 처리). 규칙은 `run_config.json match`(녹아웃 5분). 상대는 컴퓨터(좌석 1), 상대 팀·레벨·스테이지는 지도 노드의 `opp`.

### 13.6 저장

- 키 = 소문자 닉네임(손님·계정 공통). SQLite 표 `flame_profiles`·`flame_runs`(`db.js MIGRATIONS` v2, JSON 한 덩어리 + `ver`). 영구 저장과 도전 저장은 한 트랜잭션으로 쓴다(정산과 도전 삭제가 따로 남지 않는다).
- 저장 형식 버전 `v`(**도전 저장 3**, 영구 저장 2 — `server/flame/save.js SAVE_VERSION`·`PROFILE_VERSION`. v3 은 §13.12). 읽을 때마다 버전 이전(`MIGRATE`) -> 형식 검증(`sanitize*`): 없어진 ID·깨진 장착 참조·깨진 선택(`pending`)은 그 칸만 버린다. 배열이 아닌 선택지는 빈 배열, 없어진 이벤트 ID 의 선택은 버리고 그 노드를 닫는다(같은 층에서 다시 고른다).
  - v2(2026-11-19): 도전 저장에 `secret`·`surviveCount` 추가. v1 도전은 읽을 때 `secret` = 지도 시드에서 파생, `surviveCount` = `surviveUsed` 길이로 채운다. v2 로 쓰인 저장은 v1 코드가 `FLAME_SAVE_NEWER` 로 거절한다(코드를 되돌릴 때 주의).
  - 오리지널 팀(2026-11-19, §13.8): 도전 저장에 `origTeam`(팀 id)·`roster[i].orig`(선수 id)가 **선택 칸**으로 늘었다. **저장 버전은 올리지 않았다(v2 그대로)**. 두 칸이 없는 저장(변경 전의 태동 도전)은 그대로 읽혀 이어지고, 변경 전 코드가 새 저장을 읽으면 두 칸만 버려져 태동 도전으로 보인다(능력치·진행은 같다). 읽을 때 `orig` 는 정의에 있고 그 정의의 `base` 가 그 칸의 `from` 과 같고 로스터에 한 번만 나올 때만 남긴다(아니면 그 표시만 버린다).
  - 영입 풀(2026-11-19, §13.10): 도전 저장에 `roster[i].clone`(영입 풀 클론 id)·`recruitShown[]`(이 도전에서 이미 나온 영입 후보: 클론 id | `'팀:번호'`)·영입 선택 칸의 `clone`·`rare` 가 **선택 칸**으로 늘었다. **저장 버전은 올리지 않았다(v2 그대로)**. 그 칸들이 없는 저장은 그대로 읽혀 이어진다(영입 선택 `{team, idx}` = 원작 선수 후보). 읽을 때 `clone` 은 풀에 있고 그 정의의 몸이 그 칸의 `from` 과 같고 로스터에 한 번만 나올 때만 남긴다 — 풀에서 없어진 id 면 **칸은 버리지 않고 표시만 지운다**(그 몸의 원작 선수로 이어진다). 영구 저장 `codex.players` 는 `'팀:번호'` 와 `'c:<클론 id>'` 두 꼴을 받는다. 변경 전 코드가 새 저장을 읽으면 `clone`·`recruitShown` 이 버려져 클론이 그 몸의 원작 선수로 보이고 도감의 `c:` 키는 지워진다(코드를 되돌릴 때 주의).
- **읽지 못한 저장은 지우지 않는다**(P2 리뷰 M1): 도전이 복구 불가(예: 로스터 7명이 아님)이거나 행이 JSON 으로 풀리지 않으면 서버 로그 `[flame] 읽지 못한 저장: key=… run=<이유> -> <격리 키>` 를 남기고 그 행을 `flame-broken:<키>:<시각>` 키로 옮긴 뒤 '도전 없음'으로 진행한다(닉네임에 `:` 가 없어 어떤 세션도 이 키를 쓰지 못한다. 운영자가 원본을 살펴 되돌릴 수 있다). 옮기지 못하면 `FLAME_SAVE_BROKEN` 으로 거절한다. 경기 결과 반영 때 읽지 못하면 반영하지 않고 원본을 그대로 둔다. 조회: `SELECT key, updated_at FROM flame_runs WHERE key LIKE 'flame-broken:%'`.
- 가입: 손님 세션에서 가입하면 승계, 그 밖의 가입은 `guest-aside:` 키로 분리 보존(§2.1, 진행·리그와 같음). 가입 경합으로 남은 손님 세션은 쓰지 않는다.
- 도감(codex)은 도전이 끝날 때 영구 저장에 합쳐진다(도전 중에는 `run` 안에만 있다).

### 13.7 클라이언트 화면 (P6, 2026-11-19 윤프론) — `public/js/screens/flame/`, `public/css/flame.css`

- 진입: 로비 왼쪽 `불꽃의 계승`(스토리 아래) → `app.go('flame', {mode?: 'home'|'auto'})`. 상태는 `main.js` 가 `app.flame`(최근 `flame_state`)·`app.flameEnd`(아직 보여 주지 않은 `flame_end.summary`)에 두고 화면은 그것만 그린다. 모든 조작은 번호·ID 만 보내고 응답 `flame_state` 로 다시 그린다(낙관적 갱신 없음). 거절은 전부 토스트. 진입·재접속(`welcome`) 때 `flame_get`.
- catalog: `flame_state.catalogVer` 와 다를 때만 `flame_catalog` 를 요청하고 메모리 + `localStorage['dd.flame.catalog']` 에 둔다(`store.js`). 아이콘은 catalog 의 `icon` 경로(형식 검사 뒤 `/assets/flame-legacy/items/…`), 32x32 정수배 `image-rendering: pixelated`, 슬롯 바탕 `#586078`, 희귀도 색은 아이콘 바깥 테두리(CSS).
- 모듈: `index.js`(모드 라우팅·서버 메시지·경기 전 화면 연결), `store.js`(catalog 캐시·이름 조회), `ui.js`(아이콘·얼굴·스프라이트·능력치 표·게임패드 → 방향키), `home.js`, `run.js`, `team.js`.

| 모드 | 화면 | 쓰는 요청 |
|---|---|---|
| `home` | 모드 메인: 로고·불꽃코인·최고 도달 구간·최고 기록 / 새로운 도전(난이도·덮어쓰기 확인)·이어하기·영구 성장·도감 3·기록 및 업적 / 뒤로·조작 안내 | `flame_get`, `flame_new{diff}` |
| `perm` | 영구 성장 17항목(A 기본 훈련·B 출발 준비·C 콘텐츠 해금): 단계·다음 비용·코인 | `flame_perm{id}` |
| `codex` | 도감 3탭: 선수(만난 선수)·장비 40·아티팩트 30(미발견 = 실루엣) | - |
| `records` | 기록(`best`·`totals`·`earned`)·업적 | - |
| `end` | 도전 종료: 도달 구간·승수·격파 보스·최고 장비 등급·사용 포메이션 / 보존(획득 불꽃코인·새 업적) / 소멸(`summary.lost`). `counted:false` 면 `기록 미반영` | - |
| `run` → `map` | 도전 진행: 구간·다음 상대·남은 경기·경기 포인트·장착 아티팩트 / 분기 지도(구간 탭, 후보 = 금색 깜빡임, 지나온 길 = 금색 선) / 팀 관리·장비 관리·아티팩트·포메이션·소모품·다음 경기 / 포기 | `flame_node{id}`, `flame_abandon` |
| `run` → `reward` | `pending[0]` 이 장비·아티팩트: 카드(아이콘·이름·희귀도·능력치·특수효과·비교 선수의 현재 장비와 차이)·받지 않음·재선택 | `flame_choose{i}`, `flame_reroll` |
| `run` → `shop` / `train` | `run.node` 가 열림: 상점(구매·품절) / 특훈장(선수 + 11종, 남은 횟수·비용). 둘 다 장비 관리로 들어가 강화 | `flame_buy{i}`, `flame_train{p,opt}`, `flame_leave` |
| `run` → `rest` / `recruit` / `event` | `pending[0]`: 휴식(전원·집중 치료 대상) / 영입(후보 스프라이트·기본 능력치 6종·원래 필살기, 교체할 자리) / 이벤트(선택지·비용·효과, 결과 `note` 는 토스트) | `flame_choose{i,p?}` |
| 겹쳐 여는 `team` / `inv` | 선수 관리·장비 관리: 7명(HP·공·방·장비 수·역할·주장) / 스프라이트·능력치 표(기본·장비·기타·최종·비교, 상한 초과·이속 낭비·`장비 변화 없음`) / 4슬롯·보유 목록·상세(다음 강화, `변화 없음`) / 자동 장착·장착·비교·해제·강화·판매·다음 선수·순서 ▲▼ | `flame_equip`, `flame_auto_equip{p}`, `flame_upgrade{inst}`, `flame_sell{inst}`, `flame_lineup{order}` |
| 겹쳐 여는 `artifact` | 아티팩트 3슬롯·보유 목록·장착 정보·활성 필살기·시너지·포메이션 보너스·미적용 효과(`team.unsupported`) / 탭 `필살기 슬롯`(선수별 주·예비, 선택지 = 해금 ID + 원래 ID) | `flame_artifact{id,slot}`, `flame_special{p,sp}` |
| 겹쳐 여는 `formation` | 15패턴(태그 표시)·현재 효과·아티팩트 강화·시너지·변경 전후 선수별 최종 능력치 비교·되돌리기 | `flame_formation{fm}` |
| 겹쳐 여는 `items` | 소모품 목록·대상 선수·다음 경기 효과(`buffs`·`extraReward`·`extraRecruit`) | `flame_use{c,p?}` |

- 경기: 지도에서 경기 노드를 고르면 라인업(VS) → 내 팀 편성(최종 능력치) → `flame_node`. `lineup.js` 는 `rosters`, `prematch.js` 는 `roster`·`stats` 를 받으면 얼굴·이름·능력치를 출신 `{team, idx}`·서버 최종값으로 그린다(없으면 종전 그대로). `room_joined{room.flame}` 은 대기실을 건너뛴다.
- 경기 화면(`screens/game.js`): `game_start.flame` 이면 결과 카드 버튼이 `도전으로`, `room_left` 가 와도 카드가 남고(`holdLobby`), 누르면 `app.go('flame', {mode:'auto'})`(종료 요약이 있으면 도전 종료 화면, 아니면 보상 선택·지도). `flame_result.outcome:'rematch'` = `재경기`(`saveFailed` 면 `저장 실패 · 재경기`), `flame_end` = `도전 종료`/`우승` 한 줄. 이벤트 `fl_survive` = 머리 위 `버텼다!`. HUD 얼굴은 혼합 로스터일 때 HP 112 에서 자른다(화면 위로 나가지 않게). → 2026-11-19 개정: 최대 HP 가 112 를 넘는 경기는 높이를 그 값에 맞춰 편다(§13.17).
- 입력: 방향키 포커스 이동(`pix.js arrowNav`)·Enter/Space·Esc(뒤로). 게임패드는 flame 화면이 떠 있는 동안만 방향 패드/왼쪽 스틱 → 방향키, A → 누르기, B → Esc 로 바꾼다(`ui.js padNav`). 경기 조작 키(A/S/D/F)는 메뉴에서 쓰지 않는다.
- 서버가 주지 않아 클라이언트 에셋으로 채운 것: 영입 후보의 능력치(원작 편성 표 `data/prematch.json` 6종)와 원래 필살기(`rom/sprites/teams.json special_shot_id`). 후보의 추천 역할은 표시하지 않는다(영입 뒤 `team.players[i].role` 로 보인다).

### 13.8 오리지널 팀 (1차 증분, 2026-11-19 박백엔) — 서버·데이터만, 화면은 후속(윤프론)

기준: 사용자 결정(팀 선택 없이 새 오리지널 팀으로 시작해 원작 팀들과 대결), `analysis/39` D17·D20·D21·A14 개정, `analysis/41`(이름), `_verify/flame_orig_pilot/`(색 치환 시범). 이번 범위는 **시작 7명 오리지널 고정**까지다. 영입 풀을 오리지널 선수로 바꾸는 것은 2차(D18).

- 데이터: `server/flame/data/original_team.json` — `id`·`name`·`short`·`intro`·`protagonist`·`skinSets{uniforms, hairs}`·`rules{protagonistLocked, recruitExcludeSkinBodies}`·`players[7]{id, name, role, tagline, base{team, idx}, skin{team, idx, uni, hair}}`. 켜는 키 = `decisions.json roster.startOriginal`(이 파일의 `id`). **그 키를 지우면 새 도전은 종전대로 태동 7명으로 시작한다**(파일은 남겨도 된다. 이미 진행 중인 오리지널 도전은 그대로 이어진다).
- `base` = 능력치·컴퓨터 표·히트박스·기본 필살기의 출처(엔진 `roster[i].from`). 1차는 태동 7명과 같은 값이라 계산·지도·보상·밸런스가 종전과 같다(시뮬 전후 대조 동일, HANDOFF §4-26).
- `skin` = 화면 표시용 외형. `team`·`idx` = 몸(스프라이트·얼굴)을 빌려 오는 원작 선수, `uni` = 유니폼 색 세트 1~`skinSets.uniforms`(8), `hair` = 머리 색 세트 1~`skinSets.hairs`(4), **0 = 원본 유지**(검은 머리 슬롯·회색·민머리 몸). 색 값은 서버 데이터가 아니다(화면 쪽, `_verify/flame_orig_pilot/orig_pilot_data.json uniform_sets·hair_sets` 가 시범 값). 서버·엔진은 `skin` 을 계산에 쓰지 않는다.
- 서버가 보장하는 것(시작 때 `checkAgainstEngine` + `validate_data.mjs`): `base`·`skin` 몸이 `teams.json` 에 실제 있는 선수, `base` 7개와 `skin` 몸 7개가 각각 서로 다름, **`skin` 몸의 몸통 분류(`romtables.json bodyClass`)가 `base` 와 같음**(엔진 히트박스·공 든 손 위치는 `base` 기준이라 그림과 어긋나지 않게), 주인공 = 주장 칸(`captainSlot`)의 선수, 역할 = `run_config.roles` 의 id, 이름이 원작 이름표와 겹치지 않음.
- 받는 곳 3군데(같은 선수 정의):
  - `flame_catalog.original = {id, name, short, intro, protagonist, start, protagonistLocked, skinSets{uniforms, hairs}, players[7]{id, name, role, tagline, base{team, idx}, skin{team, idx, uni, hair}}}` — 팀 정의 전체(시작 팀 소개 화면·도감용). `start` = 새 도전이 이 팀으로 시작하는가, `protagonistLocked` = 주인공 교체 불가가 켜져 있는가. **`players[].base`(메시지 개정 5, 2026-11-19 추가)** = 능력치 출처 선수이고 그 선수 칸의 `roster[i].from` 과 같은 값이다. 도감(`codex.players`)·`seen.players` 의 키 `'팀:번호'` 가 이 값이라, 도전이 없을 때(`run.cast` 없음)도 화면이 그 키에 오리지널 이름·외형을 붙일 수 있다. `run.cast.players[i]`·`game_start.flameCast` 에는 `base` 를 싣지 않는다(같은 칸의 `roster[i].from` 이 그 값이다). 주의: 그 키는 오리지널 팀을 넣기 전의 태동 도전 기록과 같은 키다(프로필 형식은 그대로, 구분은 2차).
  - `flame_state.run.cast = {team: {id, name, short, intro} | null, players[7]}` — **지금 라인업 순서**. `players[i]` = 오리지널 선수면 `{id, name, role, tagline, skin{team, idx, uni, hair}, protagonist, locked}`, 원작 선수(영입)면 `null`(화면이 종전대로 `roster[i].from` 으로 이름·얼굴을 찾는다). `locked` = 영입 교체 대상으로 고를 수 없는 칸. `team` 이 `null` 이면 종전 태동 도전이다.
  - `game_start.flameCast = {seat, team, players[7]}` — 경기 화면용(§12.2).
- `role` 은 이름표(41 의 역할 이름)다. 능력치로 계산한 추천 역할은 종전대로 `team.players[i].role` 이고 1차에는 둘이 다를 수 있다(능력치가 태동 값이라서).
- **주인공 교체 불가(D20)**: `flame_choose` 의 영입에서 `p` 자리 선수가 주인공이면 `error{code:'FLAME_PROTAGONIST'}`(토스트, 상태는 그대로). 주인공이 라인업 어느 칸에 있든 같다(`flame_lineup` 으로 순서는 바꿀 수 있다). `original_team.json rules.protagonistLocked` 를 `false` 로 두거나 지우면 꺼진다. 태동 도전에는 주인공이 없어 종전과 같다.
- **영입 후보(1차 보조 규칙, D21)**: 내 오리지널 선수가 몸을 빌린 원작 선수(`skin.team:idx`)는 영입 후보에서 뺀다(같은 그림 두 명이 한 팀에 서지 않게). `rules.recruitExcludeSkinBodies` 로 끈다. 그 밖의 영입 풀·상대 풀은 바꾸지 않았다(상대는 종전대로 `from` 의 팀·같은 인물 묶음만 피한다). **2차(§13.10)에서 영입 후보는 오리지널 클론 풀 + 원작 희귀 칸으로 바뀌었고, 팀 겹침 판정은 원작 선수 칸만 본다.**
- 알려 둘 것: 몸을 빌린 팀(지금 2·4)은 상대 풀에 그대로 있다(팀 2 = 구간 1 일반, 팀 4 = 구간 3 보스·영입 기본 풀). 그 팀과 만나면 같은 몸이 색만 다르게 양쪽에 선다. 엔진의 중복 거절은 flame 로스터 7칸 안의 `from` 만 보므로 경기는 만들어진다. 상대 풀에서 빼면 지도 난수와 최종 보스 구성이 바뀌어 밸런스를 다시 재야 해서 1차에는 빼지 않았다(39 D21).

- **소폭 보정(2026-11-19, `original_team.json _meta.version` 2, 39 「D21 보정」)**: 주인공 `o1` 의 `skin.hair` 4 → 3(세트 4 적발은 팀 2 원래 머리색과 같은 값이라 원작 2:2 와 똑같이 보였다). 팀 2 몸 2명(`o1`·`o7`)의 `uni` 는 1 그대로다(시트 색 분포로 재면 8세트 가운데 1 이 팀 4 몸 5명에 가장 가깝고, 분류가 맞는 다른 팀 몸은 더 멀다. 남는 차이 = 팀 2 원색에 `extra` 색이 따로 없어 흰 줄 자리가 `trimLo` 색으로 칠해지는 것, 화면 색 표 과제). 화면의 팀 2 치환 표(`public/assets/data/orig_skin.json teams["2"]`: 유니폼 원색 6개 → 역할, `hairKind[2]=C`·`[1]=N`)는 이 값들을 그대로 처리한다(`uni 1` = 종전과 같은 경로, `hair 3` = 전용 2색 `900000`·`fc4800` → `906c00`·`fcd848`, 민머리 `o7` 은 `hair 0`). 카탈로그 `ver` 가 `…o2.m5` 로 바뀌어 화면의 옛 캐시는 버려진다.

### 13.9 오리지널 팀 클라이언트 화면 (2026-11-19 윤프론)

- 조회(`flame/ui.js`): `bindCast(run)` 이 `run.roster[i].from` 객체에 `run.cast.players[i]` 를 걸어 두고 `pname`·`pface`·`sprite`·`pteam` 이 그것을 먼저 쓴다(칸이 `null` 이거나 `cast` 가 없으면 종전대로 출신 `{team, idx}`). 영입 후보·도감처럼 로스터 밖에서 만든 `{team, idx}` 는 종전 그대로이고, 도감 선수 탭은 지금 도전의 로스터 칸과 같은 출신만 오리지널 이름·얼굴로 표시한다(`rosterFrom`. 서버 발견 키는 base 그대로).
- 색 치환(`flame/skin.js`, 정적 데이터 `/assets/data/orig_skin.json` = 안아트 시범 `_verify/flame_orig_pilot/` 의 `uniform_sets`·`hair_sets`·팀별 원색→역할·선수별 머리 유형): `skin.uni`·`skin.hair`(0 = 원본)로 유니폼 원색 → 세트 색, 머리 C(전용 2색)·B/G(검은 머리 슬롯, 칸마다 4방향 연결 8픽셀 이상 덩어리만), 윤곽 검정·흰색·회색·피부 불변. 얼굴 칸은 바탕(원작 = 하의 밝은 색)을 세트 상의 밝은 색으로. 캐시 키 `team/idx/uni/hair`: 경기용 선수 띠(시트 2행 3760x160) 최대 14장, 얼굴 24x24, 서 있는 칸 80x80. 표에 없는 팀·로드 실패 = 빌린 몸의 원본 그림.
- 경기(`screens/game.js`): `flameCast.players[i]` 가 있으면 `orig[pid] = {team: skin.team, idx: skin.idx, cast: true, skin}`. 색을 바꾼 띠는 `renderer.pSheets[pid]` + `renderer.pRow[pid] = 0`(`render.js` 는 `pRow ?? orig.idx ?? pid%7` 로 행을 찾는다), HUD 얼굴은 `hud.pFaces[pid]`(없으면 아틀라스), 좌석 팀 이름 = `flameCast.team.name`. 말풍선(`shout.js`)은 `orig[pid].cast` 면 `byPlayer` 를 건너뛰고 `byId` 만 쓴다. `flameCast` 가 없거나 `team:null`·`players` 전부 `null`(종전 태동 도전)이면 전부 종전 경로다.
- 경기 전(`lineup.js`·`prematch.js`): 로스터 칸에 `name`·`face`(24x24 그림)가 있으면 그것을, `heads[s]`/`head = {name, abbr, emblem}` 이 있으면 팀 이름·약칭·엠블럼을 그것으로 그린다(없으면 종전). 한글 약칭은 8x8 영문 글리프 대신 도트 글자.
- 팀 소개(`run.js intro`): `cast.team` 이 있고 막 시작한 도전(완료 노드 0·승리 0·열린 노드 없음)에서 한 번(`localStorage['dd.flame.intro']` = 도전 id). 팀명·엠블럼·`intro` 한 줄·7명 얼굴. 누르거나 아무 키로 넘긴다.
- 영입(`run.js recruit`): `cast.players[i].locked` 칸은 흐리게(`aria-disabled`), 누르면 `주인공은 교체할 수 없습니다` 토스트(서버 `FLAME_PROTAGONIST` 와 같은 문구). 기본 교체 칸은 잠기지 않은 마지막 칸.
- 엠블럼: `/assets/flame-legacy/emblem/bulssi_24x16.png`(초안) 한 장을 `.emb.fl-emb-o` 로 쓴다(원작 16칸 시트 불변).

### 13.10 영입 풀: 오리지널 클론 + 원작 희귀 발견 (2차 증분, 2026-11-19 박백엔) — 서버·데이터·도구. 화면은 §13.11

기준: 사용자 결정(「원작 캐릭터는 가뭄에 콩 나듯 발견하는 정도고, 대부분은 수백 개의 클론 오리지널 선수들이 뽑힘」, 「영입하면 교체하는 방식」), `analysis/39` D18·D19·D22·D23, `analysis/42`(임밸런 설계), `analysis/41` §3(이름). 영입은 종전대로 **7명 고정 로스터의 한 자리 교체**다(B11·D20 그대로). 엔진(`server/engine/`)은 고치지 않았다.

- 데이터 3개
  - `server/flame/data/recruit_pool_spec.json` — 생성 도구의 입력(서버는 읽지 않는다): `version`, `batches[{seed, count, gradeQuota}]`(지금 시드 20261119·300명·D 66/C 99/B 84/A 39/S 12), `retired[]`, `roleWeight`, `model{unit, anchor, limits, grades, roles{main, adj, off, prio}, jitterMoves}`(점수 예산제, 42 §2. **밸런스 상수는 전부 여기 있다**), `bodies{maxPerBody, list, namedFaces}`(35몸), `uniforms`(2~8)·`hairs`(1~4), `shots{forbidden, byRole}`, `names{givenMaxUse, surnames, given, bannedPrefix, bannedFull}`.
  - `server/flame/data/recruit_pool.json` — 생성 결과(**서버 전용, `flame_catalog` 에 싣지 않는다. 손으로 고치지 않는다**): `_meta{version, poolId('rp<버전>-s<시드>-n<인원>'), generator{tool, rev, specSha256}}`, `model`(입력 그대로), `players[]{id('c001'~), name(3자), role, grade('D'|'C'|'B'|'A'|'S'), pts(점수 합계 = 등급 예산 + 역할 보정점), stat{hp, def, spd, s3, pow, s5, thr, pass}, sp(기본 필살기 ID), body{team, idx}, skin{uni, hair}, retired?}`.
  - `run_config.json recruit` 추가 키(`_meta.version` 3): `clone.gradePct[구간][D,C,B,A,S]` = 후보 한 칸의 등급 확률(지금 값 25/35/32/8/0, 20/35/30/13/2, 12/28/34/21/5 — 구간 1 줄은 2026-11-19 임밸런 보정 analysis/40 §16.3, 처음 35/40/20/5/0), `original{visitPct[구간](5/8/12), maxPerVisit(1), segmentTeams[구간][팀], minPts(-9)}`, `excludeTeams` 에 통키 팀 0 추가. **`clone` 키를 지우면 종전 영입(원작 선수만 n 명)으로 돌아간다**(코드 수정 없음). `original` 만 지우면 클론만 나온다.
- 생성 도구 `node server/flame/tools/gen_recruit_pool.mjs [--write]`: 같은 입력 = 같은 파일(시계·`Math.random` 없음, `rng.js rngFor`). 정체(역할·등급·이름·몸·색·필살기)와 능력치의 난수 흐름이 따로라 `model` 만 고치면 id·이름·겉모습은 그대로다. **id 는 다시 쓰지 않는다**: 인원 추가 = `batches` 뒤에 묶음 추가(앞 선수 불변, 번호 이어짐), 빼기 = `retired` 에 id(지우지 않는다). `validate_data.mjs` 7절이 입력으로 다시 생성한 결과와 파일이 같은지·점수 합계·상하한·id/이름/겉모습 중복·몸 제외 목록·필살기 금지 ID·역할×등급 인원을 본다.
- 클론의 계산: 로스터 칸 `{from: body, clone: id, …, recruited: true}`. **`from` = 몸**(엔진 히트박스·공 든 손 위치·컴퓨터 표·그림이 같은 선수라 몸통 분류가 어긋나지 않는다), 기본 능력치 8개는 풀의 `stat`(`stats.js computeTeam` 1단계 → 엔진 `roster[i].stat`), 기본 필살기는 풀의 `sp`(주 슬롯에 들어가고 계열을 아티팩트로 열어야 발동하는 것은 원작 선수와 같다). 영구 성장 A 는 붙지 않는다(B5). 가득 찬 HP 로 합류한다.
- 영입 후보(`nodes.js recruitChoices`, 난수 = 도전 비밀값 + 노드 ID → 같은 도전·같은 노드는 언제나 같은 후보):
  - 칸 수 n = 종전대로 3 + PB04 + C19. 칸마다 `gradePct[구간]` 으로 등급을 뽑고 그 등급 안에서 균등 추첨. 그 등급에 남은 선수가 없으면 아래 등급 → 위 등급 순.
  - 후보에서 빼는 것: 은퇴(`retired`), **이 도전에서 이미 나온 후보**(`run.recruitShown`, D22), 이미 로스터에 있는 클론, **내 로스터가 쓰는 몸**(클론·원작 선수의 `from`, 오리지널 시작 선수가 빌린 `skin` 몸 — 엔진의 `from` 중복 거절을 이렇게 피한다), 내 로스터나 같은 화면 후보와 **이름 2자가 같은** 선수(41 §3-4). 시작 7명이 빌린 몸·방영판 이름이 확정된 얼굴은 풀을 만들 때 이미 빠져 있다.
  - **원작 희귀 발견(D22)**: 방문당 `maxPerVisit`(1)번 `visitPct[구간]` % 로 굴려 맞으면 **마지막 칸**을 원작 선수로 바꾼다(PB04·C19 는 클론 칸만 늘린다). 범위 = 해금 팀(기본 1~7, PC01 1단계 +8~14, 2단계 +15~21, D19) ∩ `segmentTeams[구간]`(구간 1 은 1~7 만, 구간 2 는 14 까지), 점수(42 §2.1) `minPts` 이상, 기본 필살기 있음, 통키 팀(0)·22~24 제외, 내 로스터의 원작 선수와 같은 팀·같은 인물 묶음 제외(B11 그대로), 내 로스터가 쓰는 몸 제외. 맞는 선수가 없으면 그 칸도 클론이다.
- 팀 겹침 판정(`map.js conflicts`): **원작 선수 칸만** 본다. 오리지널 시작 선수(`orig`)와 클론(`clone`)은 팀 소속이 아니다 → 클론을 영입해도 몸을 빌린 팀이 상대 풀에서 빠지지 않고(같은 몸이 색만 다르게 양쪽에 설 수 있다), 오리지널 팀 도전에서는 통키 팀(0)이 상대 후보가 될 수 있다(지금 `opponents` 에는 넣지 않았다. 최종 보스 [4,16,0] 은 임밸런 측정 뒤 결정). 원작 선수를 영입하면 종전대로 그 팀·같은 인물 묶음이 남은 상대에서 다른 팀으로 바뀐다. 태동 도전(구 저장)은 종전과 같다.
- 화면이 받는 것(전부 추가 칸)
  - `flame_state.run.pending[k].choices[i]`(영입) — 저장에는 `{team, idx, clone?, rare?}` 만 있고 보낼 때 채운다.
    - 클론: `{kind:'clone', id, name, role, grade, stat{s0..s7}, sp, skin{team, idx, uni, hair}, team, idx}`. `team`·`idx` = 몸(= `skin.team`·`skin.idx`. 종전 화면이 이 칸을 원작 선수로 그려도 깨지지 않게 남겼다. 이름·능력치는 이 칸의 것을 써야 한다).
    - 원작 선수: `{kind:'original', team, idx, rare, stat{s0..s7}, sp}`. `rare:true` = 희귀 발견 칸(영입 풀이 꺼진 종전 영입의 원작 후보는 `rare:false`).
    - `stat` = 기본 능력치(장비·영구 성장 전, `team.players[i].base` 와 같은 키), `sp` = 기본 필살기 ID | null. 종전에 화면이 자기 에셋으로 채우던 6종 능력치·원래 필살기는 이제 이 값으로 그릴 수 있다.
  - `flame_state.run.cast.players[i]` · `game_start.flameCast.players[i]` — 클론 칸 = `{id, kind:'clone', name, role, grade, tagline:null, skin{team, idx, uni, hair}, protagonist:false, locked:false}`. 시작 선수 칸에는 `kind:'starter'` 가 붙었다. 원작 선수 칸은 종전대로 `null`. **클론의 유니폼은 자기 색 그대로다**(`skin.uni` 2~8. 불씨 색 세트 1 로 바꾸지 않는다, 42 §9-7).
  - `flame_catalog.recruit = {clone, poolId, poolVersion, count, grades['D','C','B','A','S'], rareOriginal}` — `clone` = 영입 후보가 클론 풀에서 나오는가, `count` = 은퇴를 뺀 풀 인원, `rareOriginal` = 원작 희귀 칸이 켜져 있는가. 풀 명단·확률은 싣지 않는다.
  - `run.recruitShown` 은 보내지 않는다(서버 내부 기록).
- 도감(D23): `seen.players`·`codex.players` 의 키 = 원작 선수·시작 7명 `'팀:번호'`(종전), **영입한 클론 `'c:<id>'`**. 종전대로 **영입했을 때** 적힌다(후보로 보기만 한 선수는 적지 않는다). 클론 키는 이름·겉모습을 카탈로그에서 찾을 수 없다(명단이 서버 전용) → 화면이 도감에서 클론을 이름으로 보여 주려면 서버가 도감용 정의를 따로 보내야 한다(후속, 결정 필요). 지금은 "영입한 클론 수 / `recruit.count`" 로 셀 수 있다.
- 거절: 영입 선택에서 풀에 없는 클론 칸·같은 몸이 로스터에 이미 있는 칸은 `FLAME_INVALID`(후보를 만들 때 이미 걸러 정상 흐름에서는 나오지 않는다).
- 시뮬 도구: `sim_balance.mjs run --recruit=off|safe|always`(42 §7.2 초안). `off`(기본)는 출력·JSON 이 정책 추가 전과 같다(5조건 × 40판 대조 동일, HANDOFF §4-29).

### 13.11 영입 풀 클라이언트 화면 (2026-11-19 윤프론)

- 조회(`flame/ui.js`): `bindCast(run)` 이 로스터 칸(`cast.players[i]`, 클론 = `kind:'clone'`)에 더해 **영입 후보의 클론 칸**(`pending[].choices[]` 의 `kind:'clone'`)도 같은 표에 건다. 그래서 `pname`·`pface`·`sprite` 는 클론 칸을 자기 이름·`skin` 색 입힌 몸으로 그린다. `isClone(from)`, `ownShotOf(from)`(클론 = 칸의 `sp`, 없으면 영입 후보에서 본 값을 id 로 기억한 것 | null. 그 밖 = 종전 ROM 표), `pteam(from)`(오리지널 팀 소속 = 팀 엠블럼·이름, 팀이 없는 클론(후보·종전 태동 도전) = 역할 이름, 원작 선수 = 출신 팀), `rosterFrom` 은 클론 칸을 건너뛴다(클론의 `from` = 몸이라 원작 선수와 키가 같다). `kind` 가 없거나 모르는 값이면 전부 종전 경로다.
- 영입(`run.js recruit`): 클론 칸 = 이름·역할 이름(`flame_catalog.roles`)·능력 6종(`stat.s0~s5`)·필살기(`sp`)·색 입힌 스프라이트. 원작 칸 = 종전 표시(이름·팀 엠블럼·팀 이름). `stat`·`sp` 가 없는 칸(종전 서버)은 화면 에셋(편성 표 6종·ROM 필살기)으로 채운다(원작 175명은 두 값이 같다). **등급(`grade`)은 화면에 내지 않는다**(능력치 숫자로 판단). `rare:true` 칸 = 표식 「원작」 한 개 + 금색·붉은 이중 고리(깜빡임, `prefers-reduced-motion` 이면 멈춤).
- 후보 3~8칸 배치(`flame.css .fl-cards.rec`): 넓은 화면 = 4칸까지 한 줄, 5~8칸은 두 줄(3+2·3+3·4+3·4+4, 스프라이트 한 단계 작게 → 1366x768 에서 8칸이 스크롤 없이 보인다). 폭 1150px 이하·높이 560px 이하 = 폭에 맞춰 줄바꿈하고 카드 줄이 세로 스크롤(844x390 = 3열, 390x844 = 1열·스프라이트 왼쪽). 줄 높이는 `grid-auto-rows: max-content`(auto 줄은 높이가 모자랄 때 내용보다 낮게 잡혀 카드가 겹쳤다). 고른 카드는 보이는 곳으로 옮긴다.
- 팀 관리·필살기 슬롯: 클론의 「원래 필살기」 선택지는 `ownShotOf`(몸 주인의 ROM 필살기를 넣지 않는다 — 서버가 `FLAME_LOCKED` 로 거절한다).
- 도감 선수 탭: 목록·수 = 원작 선수(시작 7명 포함) 그대로. 클론 칸의 `from`(몸)은 원작 발견으로 세지 않고, 영입한 클론은 `codex.players` 의 `c:` 키 + 지금 로스터의 `clone` 을 세어 「n명 · 영입 m명」 한 줄로만 보인다(1명 이상일 때).
- 라인업·편성·경기 HUD·말풍선: 코드 변경 없음(§13.9 경로가 `cast` 칸을 그대로 처리한다: 이름 = 칸의 `name`, 띠·얼굴 = `skin` 색 치환, 말풍선 = `byId` 만).
- 원정 세트(`orig_skin.json away[] = {vs, uni, use}`, `skin.js awaySkin`, `game.js`): 상대 팀 id 가 `vs` 이고 선수의 세트가 `uni` 면 그 경기의 선수 띠만 세트 `use` 로 그린다. 지금 한 줄: 상아(팀 1, 노랑) 상대 = 세트 1 → 세트 9(세트 1 과 같고 양말·손목만 흰색 `909090`·`fcfcfc`). 얼굴 칸·경기 밖 화면은 그대로. 줄을 지우면 종전과 같다. 세트 9 는 화면 전용이다(서버 `skinSets.uniforms` 8 과 무관, 서버는 9 를 보내지 않는다).
- 남은 것: 팀 2 몸의 가슴 흰 줄(위치 마스크가 필요해 하지 않았다), 도감에서 클론을 이름으로 보이기(서버 정의 필요). 클론의 기본 필살기는 `cast.players[i].sp` 로 받는다(§13.12·§13.14 — 영입 화면에서 본 값을 세션 동안 기억하던 것은 없앴다).

### 13.12 엔드리스(무한 구간) (2026-11-19 박백엔) — 서버·데이터. 화면은 §13.14

결정 `analysis/39` D24·D26(D25 = 구간 4+ 상대 능력 가산은 **사용자 승인 대기, 미구현**). 데이터 `server/flame/data/endless.json`(전부 [자작 제안·시작값]).

- **켜고 끄기**: `endless.json enabled:true` 면 켜짐. 파일을 지우거나 `enabled:false`, 또는 환경 변수 `FLAME_ENDLESS=0` 이면 종전 동작(구간 3 보스 승리 = `flame_end{result:'champion'}` 로 도전 종료, 12경기)이다. 코드 수정이 없다. `rules.json run{segments 3, matches 12}` 는 기획 원문 대조값 그대로이고 뜻만 "우승 기준 구간"이다.
- **진행**: 기존 3구간이 엔드리스의 첫 3구간이다. 구간 보스를 이기면 다음 구간으로 넘어가고 끝이 없다. **도전 종료 = 패배·포기뿐**(1패 종료·분투 보상 D16 그대로).
- **우승**: 구간 3 보스를 이긴 그 순간 서버가 우승 횟수(`best.clears`)·`firstClear`·`best.clearDiff`·업적(ACH03 등)을 영구 저장에 반영하고 도전은 구간 4 로 이어진다. 한 도전에서 한 번만 일어난다(`run.champ`). **`flame_end` 는 오지 않는다.**
- **코인(D26)**: 승리 단가는 구간과 무관하게 일반 20·강팀 40·보스 80. 우승 200·첫 우승 300 은 구간 3 보스에서 얻되 **지급은 도전 종료 정산 때 다른 코인과 함께 한 번**(기획 §10.2). 우승 뒤 포기해도 받는다. 정산 전 예상치 `run.coinsPending` 에는 우승한 순간부터 들어 있다.
- **구간 4+ 의 내용**: 상대 팀 풀·컴퓨터 레벨·장비 등급 보정·영입 등급 확률·원작 희귀 칸 확률과 대상 팀은 `run_config.json` 각 표의 **마지막 줄(구간 3)** 을 그대로 쓴다(PC05 를 샀으면 해금 풀 포함, `cpuLevelMax` 3). 상대 능력치는 키우지 않는다. 보스도 같은 템플릿이다.
- **지도**: 구간에 들어갈 때 한 구간씩 만든다(난수 `rngFor(seed,'map',구간)`, 노드 ID `<구간>-<층>-<번호>` — 구간 1~3 지도는 종전과 같다). **다음 구간은 미리 볼 수 없다.** 지나온 구간의 지도는 버린다.
- **보유 상한·고갈**: 장비 인스턴스 `items.max`(60)개가 차면 새로 얻는 장비는 받는 즉시 판매가만큼 경기 포인트로 바뀐다(가진 장비는 건드리지 않는다. 상점 구매는 `FLAME_FULL`). 아티팩트 30종을 다 가지면 보스 보상의 아티팩트 선택 대신 경기 포인트 `artifactFallbackPoints`(150). 영입 후보가 모자라면 "이미 나온 후보" 기록을 비우고 다시 뽑는다. 재선택 횟수는 구간 `rerollPerBoss.fromSegment`(4) 이상의 보스를 이길 때마다 +`add`(1).

메시지 변경(`CATALOG_MSG_REV` 6 → 7, `flame_catalog.ver` 끝이 `.e<endless 버전>.m7`)

| 메시지 | 칸 | 뜻 |
|---|---|---|
| `flame_state.run` | `seg` | 현재 구간(0 부터). 엔드리스에서는 상한이 없다 |
| | `segNo` | 현재 구간(1 부터) = `seg + 1`. **화면 표시는 이것만 쓴다** |
| | `endless` | 무한 구간 도전인가 |
| | `championed` | 이번 도전에서 우승(구간 3 보스 격파)을 했는가 |
| | `championSegments` | 우승 기준 구간 수(3) |
| | `segments`, `matchesTotal` | 엔드리스 = **`null`**(분모·남은 경기 수를 표시하지 않는다). 꺼져 있으면 종전 3·12 |
| | `map[]` | 길이 `seg + 1` 이상. **`map[seg]` 만 실제 지도**이고 지나온 구간 `map[0..seg-1]` 은 `{layers: []}` 빈 칸이다(종전 화면이 `map[run.seg]` 로 읽을 수 있게 자리만 채운다). `map[seg+1…]` 은 v2 저장에서 이어 온 도전에만 있다 |
| | `done[]` | 현재 구간에서 지나온 노드만(구간이 넘어가면 비운다) |
| | `champ` | 저장 칸 `{first}`(우승 때 첫 우승이었는가). 화면은 `championed` 를 쓴다 |
| | `cast.players[i].sp` | **클론 칸에만**: 그 클론의 기본 필살기 ID(슬롯에서 뺀 뒤·새로고침 뒤에도 "원래 필살기"를 선택지로 낼 수 있다) |
| `game_start.flameCast.players[i].sp` | | 위와 같다 |
| `flame_result` | `segCleared?` | 방금 이긴 보스의 구간(1 부터). 보스 승리에만 |
| | `champion?`, `achievements?` | 이 승리로 우승했다(`true`) + 그때 새로 딴 업적 ID. **우승 연출은 이 칸으로 띄운다**(도전은 이어진다) |
| | `artifactPoints?` | 아티팩트 고갈로 대신 받은 경기 포인트 |
| `flame_end.summary` | `result` | 엔드리스 = `'defeat'` \| `'abandon'` 뿐(`'champion'` 은 꺼져 있을 때만) |
| | `championed`, `endless` | 이번 도전에서 우승했는가 / 엔드리스 도전이었는가 |
| | `seg` | 도달 구간(1 부터, 상한 없음) |
| | `bosses[]` | 격파 보스 팀 — 최근 `bossesKeep`(12)개만 |
| `flame_state.note` | `{full:true, id, sold}` | 장비 보상을 골랐는데 보유 상한이라 `sold` 포인트로 바뀌었다. 이벤트 결과의 `gainEquipment` 칸에도 `sold` 가 붙는다 |
| `flame_catalog` | `endless` | `{enabled, championSegments, itemMax, artifactFallbackPoints, rerollFrom, rerollAdd, rankTop}`(꺼져 있으면 `{enabled:false, championSegments}`) |
| `flame_state.profile.best` | `rank?` | 순위 기록 `{seg, wins, at, team[3], diff}`(§13.13). `best.seg`·`best.wins` 는 종전 뜻 그대로(각각의 최고값)이고 보스를 이길 때마다도 갱신된다 |

저장(도전 저장 v3)
- `run.map` = `[현재 구간, (미리 만든 다음 구간)…]`, `map[i]` = 구간 `seg + i`. `run.done` 은 현재 구간 것만, `run.stat.bosses` 는 최근 12개만 → 저장 크기가 구간 수에 비례해 커지지 않는다(실측 20개 시드: 구간 3 뒤 평균 3.8KB, 구간 10 뒤 5.4KB, 구간 30 뒤 5.9KB — 늘어나는 것은 장비 인스턴스(상한 60)·도감 기록(상한 있음)뿐이다).
- **v2 도전은 읽을 때 자동으로 v3 이 된다**: 지나온 구간의 지도·노드 기록만 버리고 진행 위치·미리 만들어 둔 다음 구간 지도는 그대로다. 3구간 진행 중이던 도전은 구간 3 보스를 이기면 구간 4 로 넘어간다.
- **되돌리기 비용**: v3 도전은 v2 코드에서 읽히지 않는다 — 깨진 저장으로 격리되지 않고 `FLAME_SAVE_NEWER` 로 거절된다(그 유저는 진행 중 도전이 끝나기 전까지 flame 요청 전부가 거절된다). 코드를 되돌리려면 진행 중 도전 행(`flame_runs`)을 운영자가 따로 처리해야 한다(운영 DB 쓰기 = 승인 필요). **영구 저장은 v2 그대로**라 되돌려도 읽힌다(되돌린 서버가 다시 쓰면 `best.rank` 만 사라지고 순위는 `best.seg`·`best.wins` 로 다시 계산된다). `endless.json enabled:false` 로 끄는 것은 저장 형식과 무관해 언제든 된다 — 이때 구간 4 이상에 있던 도전은 다음 보스 승리에서 우승으로 끝난다.
- PC05(해금 상대)는 종전에는 도전 시작 때의 값이 3구간 전체에 쓰였지만 이제 구간에 들어갈 때의 값이 쓰인다(도전 중에 사면 다음 구간부터 반영).

화면(윤프론) 후속 지점 — 지금 화면은 `segments ?? 3`·`matchesTotal - matchesWon`·`run.map.length` 로 그린다
- 구간 표시: `N구간` 은 `segNo`. 「최고 도달 구간 n/3」·「도달 구간 n/3」의 분모와 「남은 경기」 칩은 `endless` 면 없앤다(`matchesTotal:null` 이라 지금은 음수가 나온다).
- 구간 탭: 지나온 구간 탭은 빈 지도다 → 현재 구간만 그리거나 탭을 없앤다. 다음 구간 미리 보기는 없다.
- 우승 표시: `flame_result.champion` 때 「우승!」 연출 + "도전은 계속된다" 안내, 그 뒤 `run.championed` 로 배지. 경기 결과 카드의 한 줄(`on_flame_end`: `summary.result === 'champion'` → '우승')은 엔드리스에서 오지 않는다.
- 종료 화면: `summary.championed`·`seg`(분모 없이)·코인 내역(`coins.champion`·`coins.first` 는 우승한 도전만 0 이 아니다).
- 장비 상한: `note.full` 토스트(「장비가 가득 차 n 포인트로 바뀌었습니다」), 상점 `FLAME_FULL` 은 기존 토스트.

### 13.13 도달 순위표 (2026-11-19 박백엔) — 서버. 화면은 §13.14

결정 `analysis/39` D27. 코드 `server/flame/ranking.js`. **새 DB 표·마이그레이션 없음**(스키마 v2 그대로): 영구 저장 JSON 의 `best.rank` 만 쓴다.

- 요청 `flame_ranking_get {top?}`(1~50, 생략 50. 범위 밖 = `BAD_MESSAGE`). 로비·방 안 어디서나 되고 flame 빈도 제한(`MAX_FLAME_PER_MIN`)에 든다. 거절은 공통 `error`(토스트).
- 응답 `flame_ranking {top:[{rank, nick, seg, wins, team:[…최대 3], diff, at}], me, total}`
  - `seg` = 최고 도달 구간(1 부터. 구간 3 보스를 이겼으면 4), `wins` = **그 도전의 승수**, `diff` = 그 도전의 난이도 id(1 = 고난도 표시), `at` = 달성 시각(ms, 엔드리스 이전 기록은 0), `total` = 순위표에 오른 계정 수.
  - `team` = 기록 시점 라인업 0~2번 칸의 이름. 오리지널·클론은 이름 문자열(예 `'윤이음'`), **원작 선수는 `'@<팀>:<번호>'`**(예 `'@3:1'` — 서버에는 원작 선수 이름표가 없다. 화면이 `names.js playerName(팀, 번호)` 로 푼다). 엔드리스 이전 기록은 빈 배열.
  - `me` = 계정이면 내 줄(같은 형태. 기록이 없으면 `{rank:null, seg:0, wins:0, team:[], …}`), **손님이면 `null`**(조회만 된다).
- 오르는 사람: **계정만**(`accounts` 표에 있는 키). 손님 행·격리 키는 빠진다.
- 정렬: 최고 도달 구간 내림차순 → 그 도전의 승수 내림차순 → 먼저 달성한 사람. **구간·승수가 같으면 같은 순위**(1, 2, 2, 4).
- 갱신: 구간 보스를 이길 때마다(진행 중인 도전도 반영)와 도전 종료 때 서버가 기록한다. 더 멀리 갔거나 같은 구간에서 승수가 더 많을 때만 바뀐다 → 패배·포기·재접속으로 줄거나 사라지지 않는다. 경기를 한 판도 치르지 않은 도전은 기록하지 않는다.
- 엔드리스 이전 기록: `best.rank` 가 없는 영구 저장은 `best.seg`(최대 3)·`best.wins` 로 오른다(핵심 3명 빈칸, 시각 0). **엔드리스 이전 우승자**(`best.clears > 0` 이고 `best.seg` = 우승 기준 구간 수 3)는 `seg` 4 로 오른다 — 엔드리스의 우승(구간 3 보스 격파 = 구간 4 도달)과 같은 성취가 같은 구간이 되게(읽을 때만 보정, 저장은 고치지 않는다. `run.js rankRecordOf`).
- 서버 시작 때 `flame_profiles` 전 행을 한 번 읽어 메모리 표를 만들고 그 뒤에는 저장할 때 그 계정 줄만 고친다. 재시작해도 같은 표가 나온다. **규모 한계**: 수만 명이 되면 시작 때 전 행 읽기·정렬이 느려진다 → 그때 전용 표로 옮긴다(운영 DB DDL 승인 필요). 지금 유저 수에서는 문제없다.
- 2차 「이번 주」 탭: `at` 으로 거를 수 있다. 다만 지금 저장은 계정당 최고 기록 1건이라 "이번 주에 세운 기록"만 나온다(주간 최고를 따로 남기려면 저장 칸 추가 필요).
- 화면 후속(윤프론): 순위 화면(순위·닉네임·최고 구간·승수·핵심 3명·고난도 표시, 상위 50 + 내 줄. `ranking_list` 화면과 같은 꼴), 손님에게는 내 줄 대신 가입 안내 한 줄.

### 13.14 엔드리스 + 도달 순위 클라이언트 화면 (2026-11-19 윤프론) — `public/js/screens/flame/{run,home,index,ui,store,rank}.js`, `main.js`, `game.js`, `flame.css`

화면 규약(§13.7 의 표에 덧붙는 것). 서버·엔진은 고치지 않았다. 엔드리스 여부는 도전·종료 요약의 `endless` 칸, 없으면 `flame_catalog.endless.enabled` 로 본다(`store.js isEndless`·`segText`).

- **구간 표시**: 지도 제목 = `run.segNo` + 「구간」(없으면 `seg + 1`). 「남은 경기」 칩은 `run.matchesTotal` 이 숫자일 때만(엔드리스 = `null` → 없음). 「최고 도달 구간」(모드 메인·기록)·「도달 구간」(종료 화면)은 엔드리스면 숫자만, 꺼져 있으면 종전 `n/3`.
- **구간 탭**: 지도가 있는 구간(`map[i].layers` 가 비어 있지 않은 칸 + 현재 구간)만 탭으로 낸다. 하나뿐이면 탭 줄을 그리지 않는다 — 엔드리스는 지나온 구간이 빈 칸이고 다음 구간을 미리 볼 수 없어 보통 탭이 없다(v2 에서 이어 온 도전처럼 다음 구간 지도가 있으면 그 탭만 나온다). 도전 저장 v3 은 엔드리스가 꺼져 있어도 지도가 현재 구간 하나라 탭이 없다.
- **우승**: `flame_result.champion` 이 오면 `main.js` 가 `app.flameChamp = {run(도전 id), achievements}` 로 들고 있고, 경기 결과 카드의 한 줄은 「우승!」이다(`game.js on_flame_result`). 도전 화면으로 돌아오면 그 도전에서 한 번 우승 화면(`run.js champ`: 팀 엠블럼·「우승!」(로고 불꽃)·「n구간 돌입」·새 업적·7명 얼굴 — 팀 소개 화면의 틀 재사용, 누르거나 아무 키로 넘김) → 보상 선택 → 지도. 다른 도전의 것이 남아 있으면 버린다. 새로고침하면 우승 화면은 다시 뜨지 않는다. 그 뒤로는 지도 제목 옆 작은 표식 「우승」(`run.championed`).
- **종료 화면**: 제목은 `summary.result`(엔드리스 = 「도전 종료」·「도전 포기」), 우승한 도전이면 표식 「우승」(`summary.championed`), 「도달 구간」 = `summary.seg`(분모 없음), 코인 내역에 우승·첫 우승.
- **순위 화면**(모드 `rank`, `rank.js`): 모드 메인 아래 오른쪽 작은 버튼 「순위」 → `flame_ranking_get`(들어갈 때마다·재접속 때) → `flame_ranking` 을 `app.flameRank` 에 두고 그린다. 한 줄 = 순위 · 닉네임(+난이도 이름 표식, `diff > 0`) · 구간(`seg`, 서버 값 그대로) · 승(`wins`) · 핵심 3명(`'@팀:번호'` 는 `names.js playerName` 으로 풀고 그 밖은 문자열 그대로). 머리 줄은 위, **내 줄(`me`)은 아래에 붙어** 강조색이고 상위 목록 안의 내 닉네임 줄도 같은 색이다. 기록이 없는 계정의 내 줄은 `-`. 손님(`me:null`)은 내 줄이 없다(조회만, 안내 문구 없음). 머리에 `total` 명. 폭 639px 이하는 핵심 3명이 줄 아래로 내려간다. **닉네임·핵심 선수 이름은 텍스트 노드로만 넣는다**(`innerHTML` 을 쓰지 않는다). 거절은 공통 토스트.
- **장비 상한**: `flame_state.note{full, id, sold}` → 토스트 「장비가 가득 차 n 포인트로 바뀌었습니다」(이벤트 결과의 `gainEquipment.sold` 도 같은 문구). `flame_result.artifactPoints` → 토스트 「아티팩트 대신 경기 포인트 +n」. 상점 `FLAME_FULL` 은 종전 오류 토스트.
- **클론의 원래 필살기**: 필살기 슬롯의 「원래 필살기」 선택지는 `cast.players[i].sp`(영입 후보는 그 칸의 `sp`)만 쓴다. 영입 화면에서 본 값을 세션 동안 기억하던 표는 없앴다 → 새로고침 뒤에도 같은 선택지가 나온다.
- 카탈로그 개정 7(`…e1.m7`): 화면은 `catalogVer` 문자열 비교로 다시 받는다(코드 변경 없음). 새로 읽는 칸 = `flame_catalog.endless.enabled`·`championSegments`.

### 13.15 연습 경기 — 구간 1 초보 구제 (2026-11-19 박백엔) — 서버·데이터. 화면은 후속(윤프론)

결정 `analysis/39` D28(가정 B43~B51). 데이터 `run_config.json practice{enabled, cpuLevel?}` — **키를 지우거나 `enabled:false` 면 종전 동작**(연습 경기 없음). 원작 경기 엔진은 고치지 않았다(실전 flame 경기와 같은 flame 옵션 경로).

- **받을 수 있는 때**(`flame_state.run.practiceAvailable`): 연습 경기가 켜져 있고, **첫 도전**(영구 저장 `totals.runs`·`totals.wins`·`best.seg`·`best.clears` 가 전부 0)이고, 이 계정이 아직 쓰지 않았고(`profile.practiceUsed` 가 false), 구간 1 첫 층에서 실전을 한 판도 치르지 않았고 경기 중이 아닐 때. 경기를 치르지 않고 끝낸 도전은 기록에 들지 않으므로 그 뒤의 새 도전도 첫 도전이다. 풀지 않은 선택(시작 보상)이 있으면 참이어도 요청은 `FLAME_PENDING` 이다.
- **요청** `flame_practice {}` → `room_joined{room.flame:{node:null, type:'practice'}}` → `game_start{flame, flameCast{…, practice:true}}`. 그 밖의 거절: `FLAME_NONE`(도전 없음), `ALREADY_IN_ROOM`, `TOO_MANY_ROOMS`, `FLAME_PRACTICE_NONE`.
- **경기**: 내 팀 = 지금 도전 상태 그대로(로스터·장비·HP·포메이션, `matchOptions` 와 같은 조립). 상대 = 지금 고를 수 있는 첫 경기 노드의 팀·스테이지, 레벨 = `practice.cpuLevel`(시작값 1. 생략하면 구간 1 일반의 레벨. 난이도 가산 없음). 규칙 = `run_config.json match`. 방은 §13.5 와 같은 비공개 방이다.
- **종료**: `game_end{flame}` -> `flame_result{matchId, node:null, type:'practice', practice:true, outcome:'practice', won, reason, hp:null}` -> `flame_state` -> `room_left{reason:'leave'}` -> `room_list`. `won` = 좌석 0 의 정상 승리였는가(표시용). `flame_end` 는 오지 않는다. 기권(`leave_room`)·유예 만료·엔진 오류로 끝나도 같다.
- **무반영 보장**: 서버는 연습 경기가 끝난 뒤 **아무것도 저장하지 않는다**(도전 저장·영구 저장·순위표·결과 레코드 `results.jsonl`. 단 하나의 예외 = 엔진 오류로 끝난 연습 경기의 소비 표시 되돌리기, §13.18 (4)). 도전 진행(층·노드 기록)·승수·현재 HP·경기 포인트·보상·영입·치사 생존 횟수·코인·최고 기록·순위 기록·업적·도전 횟수가 전부 그대로이고, 뒤따르는 `flame_state` 는 저장되어 있는 상태다. 저장은 **시작할 때 한 번**뿐이다: 영구 저장에 `practiceUsed:true`(선택 칸, `PROFILE_VERSION` 2 그대로)를 적는다 → 도중에 나가거나 서버가 재시작되어도 다시 받을 수 없다(경기 방을 만들지 못했을 때와 엔진 오류 `reason:'error'` 로 끝났을 때만 되돌린다, §13.18 (4)). 도전 저장에는 `match`(경기 중 표시)를 세우지 않는다.
- **추가 칸**: `flame_state.profile.practiceUsed`(bool), `flame_state.run.practiceAvailable`(bool), `flame_catalog.practice{enabled, cpuLevel|null}`. `CATALOG_MSG_REV` 7 → 8(`flame_catalog.ver` 끝이 `.m8`).
- 저장하지 않는 세션(가입 경합으로 남은 손님)에는 주지 않는다(`FLAME_PRACTICE_NONE`).
- 화면 후속(윤프론): 지도 화면의 「연습 경기」 버튼(`practiceAvailable` 이고 `pending` 이 비었을 때), `room.flame.type === 'practice'` 대기실 건너뛰기, 경기 화면의 연습 표시와 결과 카드(보상·코인 줄 없음, 지도로 복귀), `FLAME_PRACTICE_NONE` 토스트.

### 13.16 영입실 입장 회복 + 도감 클론 정의 (2026-11-19 박백엔, 하플레이 보고 후속) — 서버·데이터. 화면은 후속(윤프론)

결정 `analysis/39` D29(가정 B52~B59). 원작 경기 엔진·`public/` 은 고치지 않았다. `CATALOG_MSG_REV` 8 → 9(`flame_catalog.ver` 끝이 `.m9`). 저장 형식 버전은 그대로(도전 3·영구 2).

**(1) 영입실 입장 회복** — 데이터 `run_config.json recruitRoom{healPct}`(시작값 10, [자작 제안]). **`healPct` 가 0 이거나 키를 지우면 종전 동작**(영입실은 회복하지 않는다. 코드 수정 없음).

- **언제**: 영입 노드에 들어가는 `flame_node` 한 번(후보를 고르기 전). 전원 현재 HP += 최대 HP × `healPct` %(half-up), 최대 HP 까지. 아웃되어 HP 1 로 남은 선수도 받는다(승리 뒤 회복 D15 와 같은 식).
- **한 방문에 한 번**: 준 층을 도전 저장에 적는다(`roomHeal{at:'구간:층', pct, total}`, 선택 필드). 영입실 안에서 `flame_get`·새로고침·재접속을 해도 다시 주지 않고(노드가 열려 있으면 `flame_node` 는 `FLAME_IN_NODE`), 저장의 선택이 깨져 노드가 닫힌 뒤 같은 층의 영입 노드에 다시 들어가도 주지 않는다. 난수는 쓰지 않는다(같은 상태 = 같은 결과).
- **다른 회복과의 관계**: 휴식실(`rest.options`, 전원 50%·집중 치료 100%)·승리 뒤 회복(`rest.afterWinHealPct`, D15)은 값·동작 모두 그대로다. 구간 템플릿에서 영입은 휴식·이벤트와 **같은 층의 선택지**라 한 층에서 휴식 50% 와 영입실 10% 를 함께 받을 수 없다. D15 는 경기 승리 때만, 이 회복은 영입 노드 입장 때만 걸리므로 한 계기에 두 번 걸리지 않는다(영입 층 앞의 일반 경기 승리 회복 → 영입실 입장 회복 순으로 차례로 더해질 뿐이다). 구간 보스 뒤(다음 구간 첫 층은 일반 경기)에는 영입 노드가 없다.
- **추가 칸**: `flame_state.run.recruitHeal` = 지금 열려 있는 영입실에 들어올 때 받은 회복 `{pct, total}`(`total` = 전원이 실제로 오른 HP 합. 전원이 가득 차 있었으면 0) 또는 `null`(영입실 밖·꺼짐). 영입 선택(`flame_choose`)을 마치면 `null` 이 된다. `flame_catalog.recruitRoomHealPct` = 회복 %(꺼져 있으면 0). 저장의 `roomHeal` 은 `flame_state` 에 싣지 않는다.

**(2) 도감 클론 정의** — `flame_state.profile.codexCast`(추가 칸, 도전이 없어도 온다).

- 형태: `{ 'c:c012': {id, kind:'clone', name, role, grade, skin{team, idx, uni, hair}, retired?} }`. 키 = `profile.codex.players[]` 의 클론 키 그대로(`'c:<풀 id>'`, §13.10 D23). `role` = `flame_catalog.roles[].id`, `grade` = `flame_catalog.recruit.grades[]` 의 값, `skin` = `run.cast.players[i].skin` 과 같은 뜻(몸 + 색 세트), `retired` 는 풀에서 은퇴 처리된 선수에만 `true`.
- **영구 저장의 도감에 적힌 클론만** 싣는다(풀 300명 명단은 보내지 않는다). 풀에서 없어진 id 의 키는 싣지 않는다(화면은 정의 없는 키로 다룬다). 원작 선수 키(`'팀:번호'`)는 형식·내용 모두 그대로이고 여기 없다: 시작 7명(불씨)의 이름은 종전대로 `flame_catalog.original.players[].base`(= 도감 키)로 찾는다.
- **크기 상한**: 칸 수 ≤ 풀 인원(`recruit_pool.json players`, 지금 300). 실측 한 칸 약 128바이트(JSON, UTF-8) → 300명을 전부 영입했을 때 약 38KB 가 `flame_state` 마다 실린다(보통은 도전당 영입 0~3명이라 수백 바이트~수 KB). 풀을 늘리면 상한도 같이 는다.
- 도감은 도전 종료 정산 때 합쳐진다(종전 그대로): 진행 중인 도전에서 방금 영입한 클론은 정산 전에는 `codex.players`·`codexCast` 에 없고 `run.cast.players[]` 로만 보인다.

**(3) 연습 경기(§13.15) 후속 화면용 칸 점검**: 변경 없음. `flame_result{practice:true, outcome:'practice', won, reason, node:null, type:'practice', hp:null}`·`game_start.flameCast.practice`·`room.flame.type === 'practice'`·`flame_state.run.practiceAvailable`·`profile.practiceUsed`·`flame_catalog.practice` 가 §13.15 대로 나간다(시험 `test/flame_practice.test.js` 3건 통과).

화면 후속(윤프론): ① 영입실 화면에 `run.recruitHeal` 이 있고 `total > 0` 이면 회복 한 줄(토스트 또는 머리말 한 줄), 지도의 영입 노드 설명에 `recruitRoomHealPct`(0 이면 표시 없음). ② 선수 도감: `c:` 키는 `profile.codexCast[key]` 의 이름·역할·등급·skin 으로, 시작 7명 키는 `flame_catalog.original.players[].base` 로 이름을 붙인다.

### 13.17 연습 경기 화면 + 하플레이 지적 화면 수정 + 도감 클론·영입실 회복 표시 (2026-11-19 윤프론) — `public/js/screens/flame/{run,home,index,team,ui,store,matchhud}.js`, `screens/game.js`, `game/hud.js`, `flame.css`

화면 규약(§13.7·§13.14 에 덧붙는 것). 서버·엔진은 고치지 않았다. 원작 편성 화면의 `EXIT`(경기 시작)는 원작 UI 그림이라 그대로 두었다.

- **연습 경기(§13.15)**: 지도 머리 줄의 작은 버튼 「연습 경기」 — `run.practiceAvailable === true` 이고 `pending` 이 비었고 노드가 열려 있지 않을 때만. 누르면 `flame_practice`(라인업·편성 화면을 거치지 않는다). `room_joined.room.flame`(`type:'practice'`, `node:null`)은 종전 `room.flame` 처리로 대기실을 건너뛴다. 경기 화면은 `game_start.flameCast.practice` 면 가운데 위에 작은 「연습」(`.fl-practice-m`). 결과 카드 = 제목(승리!/패배 — `flame_result.won` 으로 맞춘다. 무승부 `game_end.winner -1` 는 「무승부」 그대로) + 한 줄 「연습 경기」, 보상·코인·도전 종료 줄 없음, 버튼 「도전으로」 → 지도. `FLAME_PRACTICE_NONE`·`FLAME_PENDING` 은 공통 오류 토스트.
- **필살기 표시**: 조작 안내의 「D + S 길게 → 필살기」 줄은 flame 경기에서 내 팀에 발동되는 필살기(`teams[seat].players[i].spOn`)가 하나도 없으면 숨긴다(`spOn` 칸이 없으면 `flame.allow` 가 비었을 때). 영입 카드·팀 관리·필살기 슬롯에서 아직 발동되지 않는 필살기의 표식은 「미습득」(종전 「없음」), 필살기가 아예 없으면 「필살기 없음」. 습득 안내 토스트 = 「OO은(는) 아티팩트 「XX」 장착 시 사용 가능」. 「활성 필살기」는 이름만(같은 이름은 한 번, 내부 ID 없음). 필살기 슬롯 선택지는 같은 이름이 한 목록에 둘 이상일 때 둘째부터 순번(「불꽃슛」·「불꽃슛 2」 — 슛 표의 같은 이름 가운데 ID 오름차순 순번, ID 자체는 내지 않는다).
- **영입실**: 교체 대상의 기본값은 **선택 없음**(영입 버튼은 고르기 전 비활성, 후보 묶음이 바뀌면 비운다). 고르면 후보 카드의 HP·공격력·방어력·캐치에 증감 ▲▼(후보 − 교체 대상, **기본 능력치끼리** = `team.players[p].base`. 장비 보상 카드의 `.fl-diff` 와 같은 색), 능력치 칸은 2열. 등급 글자는 내지 않는다. `run.recruitHeal{pct,total}` 이 있고 `total > 0` 이면 토스트 「전원 회복 +total」 한 번 — 본 방문(`도전 id:구간:층`)을 `localStorage['dd.flame.roomHeal']` 에 적어 새로고침·재접속 때 다시 띄우지 않는다. 지도의 영입 노드에는 `flame_catalog.recruitRoomHealPct > 0` 이면 `HP +n%` 한 줄(0 이면 없음).
- **지도**: 가로로 넘칠 때(세로 390 등) **지금 고를 수 있는 노드**(없으면 현재 층)를 가운데로 맞춘다 — 그릴 때와 지도 폭이 바뀔 때(화면 회전 포함). 「다음」 버튼: 후보가 하나면 그 칸으로 바로(경기 = 「다음 경기」, 그 밖 = 「다음 · 상점」 등), 둘 이상이면 토스트 「지도에서 갈 곳을 고르세요」 + 후보로 포커스·스크롤(후보가 전부 비경기 칸이면 버튼 이름 「다음 칸」), 후보가 없으면 비활성. 토스트는 지도 창 안 맨 아래에 비워 둔 띠(`.fl-run .fl-map` 아래 여백 2.7rem, 낮은 가로 화면 1.85rem. 위치는 `run.js` 가 `--fl-toast-bottom` 으로 잰다)에 한 줄 높이로 뜬다 — 머리 줄 정보 칸·노드·명령 버튼을 가리지 않는다(낮은 가로 화면은 비경기 칸 높이를 조금 낮춰 3칸짜리 층이 스크롤 없이 선다. 토스트가 둘 이상 겹치면 위로 쌓여 그때만 아랫줄 노드에 걸칠 수 있다). 세로 화면(폭 639px 이하)의 머리 줄은 제목 + 버튼 한 줄, 정보 칸은 그 아래 줄.
- **경기 HUD(혼합 로스터)**: 그 경기의 최대 HP(`game_start.teams[].players[].hp` 와 경기 중 본 값의 최댓값)가 112 를 넘으면 얼굴 높이를 그 값에 맞춰 편다(`hud.js flameFaceY`: 0~최대 HP → y 28~2). 112 이하면 원작 식 그대로다. HP 숫자 층(`matchhud.js`)도 같은 식을 쓴다. 일반 경기 HUD 는 그대로다.
- **우승**: 우승 화면에 「정산 시 우승 코인 +n」(`run.coinsPending` 의 `(champion + first) × pct%`. `flame_result` 에는 코인 칸이 없다. 지급은 종전대로 도전 종료 정산 때). 종료 화면은 우승한 도전(`summary.championed` 또는 `result:'champion'`)이면 제목 「우승 · 도전 종료」(금색) + 제목 바로 아래 우승 요약(「우승」 로고·도달 구간·우승 코인·내 순위) — 소멸 목록보다 먼저 보인다.
- **내 순위**: `flame_state` 에는 순위가 없어 `flame_ranking_get{top:1}` 응답의 `me.rank` 를 쓴다(flame 화면에 들어올 때·도전 종료 때·재접속 때 요청, `app.flameRank`). 모드 메인 칸 「내 순위 n위」, 종료 화면 한 줄(우승한 도전은 요약 칸). 손님(`me:null`)·기록 없는 계정(`rank:null`)은 표시 없음. 순위 화면은 들어갈 때마다 전체를 다시 받는다(종전 그대로). 내 순위용 응답(`total` 2 이상인데 `top` 1줄 이하)은 `app.flameRank.me` 만 바꾼다(`main.js`) — 순위 화면은 `top` 이 없으면 「불러오는 중」이라 1줄짜리 표가 비치지 않는다.
- **선수 도감(§13.16)**: `'팀:번호'` 키가 `flame_catalog.original.players[].base` 와 같으면 오리지널 이름·색 입힌 얼굴·팀(도전이 없어도), 아니면 원작 선수(종전). `'c:<id>'` 키는 `profile.codexCast[키]` 의 이름·역할·skin(정산 전인 지금 도전의 클론은 로스터 칸 `run.cast`), 정의가 없는 키는 「영입 선수」 한 칸. 클론 상세는 이름·역할·모습만(능력치·필살기는 정의에 없어 내지 않는다). 등급(`grade`)·은퇴(`retired`)는 표시하지 않는다. 개수 = 칸 수(「n명」).

### 13.18 밸런스 보정 후속: 보스 뒤 회복 · 특훈 누적 상한 · 난이도 레벨 가산 종류별 · 연습 경기 오류 복구 (2026-11-19 박백엔) — 서버·데이터. 화면은 후속(윤프론)

결정 `analysis/39` D30·D31·D32(가정 B60~B69), 제안 `analysis/40` §16.9, 정검수 리뷰 L1. 원작 경기 엔진·`public/` 은 고치지 않았다. `CATALOG_MSG_REV` 9 → 10(`flame_catalog.ver` 끝이 `.m10`). 저장 형식 버전은 그대로(도전 3·영구 2). `run_config.json` 은 키 2개만 더했다(그때는 `_meta` 불변. **그 뒤 임밸런 보정으로 `_meta.version` 5·`difficulty[1].cpuLevelAdd = {normal:1, strong:0, boss:1}`**, (3) 참조).

**(1) 구간 보스 뒤 회복(D30)** — 데이터 `run_config.json rest.afterBossHealPct`(시작값 50, [자작 제안]). **키를 지우면 종전 동작**(보스 뒤에도 `afterWinHealPct` 30).

- 구간 보스를 이기고 도전이 이어질 때 전원 현재 HP += 최대 HP × `afterBossHealPct` %(half-up, 최대 HP 까지, HP 1 로 남은 선수 포함). `afterWinHealPct`(D15) **대신** 한 번만 계산한다(둘을 더하지 않는다). 일반·강팀 승리는 종전대로 `afterWinHealPct`. 0 = 보스 뒤 회복만 없음.
- 추가 칸: `flame_catalog.afterBossHealPct`(숫자) = 보스 승리 뒤에 실제로 쓰이는 %(키가 없으면 `afterWinHealPct` 와 같은 값). `flame_result`·`flame_state` 의 모양은 그대로다(회복이 반영된 HP 는 종전대로 뒤따르는 `flame_state.run.roster[i].hp`).
- D15·D29 와의 관계: 보스 뒤 한 계기에 걸리는 회복은 이것 하나다. 다음 구간 첫 층은 일반 경기라 영입실 회복(D29)·휴식실과 같은 층에서 겹치지 않는다.

**(2) 특훈 누적 상한(D31)** — 데이터 `run_config.json training.maxPerStat{능력치 키: 상한}`(시작값 `{s0:32, s1:6, s4:12}`, [자작 제안]·**근거 약함**, 39 D31). **키를 지우면 종전 동작**(상한 없음). 표에 없는 능력치는 상한이 없다.

- 대상 = 선수별·능력치별 특훈 누적 `run.roster[i].train[stat]`(특훈장 + 이벤트 `trainRandom` 합). `statCaps`(최종 능력치 상한, `team.players[i].over`)와 별개다.
- `flame_train`: `지금 누적 + 이번 증가량 > 상한` 이면 `error{code:'FLAME_TRAIN_CAP'}`(토스트, 문구 「이 능력치는 특훈으로 더 올릴 수 없습니다」). 경기 포인트·`node.picks`·누적 전부 그대로다. 검사 순서: `FLAME_NOT_HERE` → `FLAME_INVALID` → `FLAME_MAX`(방문 횟수) → `FLAME_TRAIN_CAP` → `FLAME_NO_FUNDS`.
- 이벤트 `trainRandom`(`flame_choose`): 뽑힌 선수가 상한에 걸리면 라인업 순서로 다음 선수가 받는다(결과 `note.results[]{op:'trainRandom', p, stat, value}` 의 `p` 가 실제로 받은 선수). 받을 선수가 한 명도 없으면 그 선택지는 `FLAME_TRAIN_CAP`(비용·HP 변화 없음, 다른 선택지를 고를 수 있다).
- 구 저장: 이미 상한을 넘은 누적은 읽기만 하고 깎지 않는다(능력치에도 그대로 반영). 더 받을 수만 없다.
- 추가 칸: `flame_catalog.training.maxPerStat` = `{능력치: 상한}` 또는 `null`(키 없음). 화면은 `roster[p].train[stat] + options[].value > maxPerStat[stat]` 이면 그 특훈 버튼을 막아 둘 수 있다(서버가 어차피 거절한다).

**(3) 난이도 레벨 가산 종류별(D32)** — `run_config.json difficulty[].cpuLevelAdd` 가 **숫자**(종전, 모든 상대에 같은 값) 또는 **`{normal, strong, boss}`**(종류별, 없는 종류 0). **현재 값(임밸런 보정, `analysis/40` §18.3, `run_config.json _meta.version` 5): 기본 `0`, 고난도 `difficulty[1].cpuLevelAdd = { "normal": 1, "strong": 0, "boss": 1 }`**(종전 `1` = 전 종류 +1. 기능을 넣을 때는 값을 종전 그대로 두었다). `flame_catalog.difficulty[]` 는 원문 그대로 나가므로 **지금 `difficulty[1].cpuLevelAdd` 는 객체다**(숫자로 읽지 말 것). 상대 레벨은 지도 생성 때 정해 저장하므로 값을 바꿔도 이미 만든 구간은 그대로다.

**(4) 연습 경기 오류 복구(정검수 리뷰 L1, §13.15 개정)** — 연습 경기가 엔진 오류(`game_end.reason === 'error'`, 토스트 `GAME_ABORTED`)로 끝나면 서버가 `profile.practiceUsed` 를 되돌려 다시 받을 수 있다. 방 생성·입장·경기 시작 실패(`INTERNAL`)도 되돌린다(종전에는 경기 시작 실패만).

- `flame_result{practice:true, outcome:'practice', reason:'error', practiceRefunded:true}` → 뒤따르는 `flame_state` 가 `profile.practiceUsed:false`·`run.practiceAvailable:true`. `practiceRefunded` 는 되돌렸을 때만 실린다.
- 정상 종료(승·패)·기권(`forfeit_*`)·유예 초과·`draw_cap`·서버 재시작은 **종전 그대로 소비**. 도전·코인·승수·HP·결과 레코드는 어느 경우에도 반영되지 않는다(이때 하는 저장은 그 칸 하나를 지우는 것뿐).
- 저장을 온전히 읽지 못한 때(더 새 형식·깨진 저장)는 되돌리지 않는다.

**검증**(2026-11-19): `FLAME_ENDLESS=0 sim_balance.mjs run --n=40 --bot=2 --perm=full`, 같은 시드 40판. (가) 수정 전 코드 + `--xboss-heal=20`(30% 뒤 20% 를 따로) 대 (나) 새 코드 + `afterBossHealPct: 50`(도구 옵션 없음): **판별 로그가 같은 판 20/40, 승수가 같은 판 37/40**, 우승 8 대 8, 평균 승수 7.35 대 7.13 — **완전히 같지는 않다.** 갈라지는 20판은 전부 첫 보스 승리 바로 다음 경기(구간 2 또는 3 의 첫 경기)의 경기 전 팀 HP 가 0.2~0.4%p(선수 한두 명의 HP 1) 다른 데서 시작한다 = 반올림 차이(도구는 30% 와 20% 를 따로 half-up, 서버는 50% 를 한 번. 39 B61)이고 그 뒤 경기가 통째로 다시 굴려진다. (다) 새 코드 + 두 키를 지운 데이터 사본 + `--xboss-heal=20` 은 (가)와 **40/40 판별 일치**(키가 없으면 종전 동작), (라) `maxPerStat` 만 뺀 사본과 실제 데이터는 40/40 일치(이 조건의 봇은 특훈 상한에 닿지 않는다)

화면 후속(윤프론): ① `FLAME_TRAIN_CAP` 토스트(서버 `msg` 그대로 써도 된다) + 특훈장에서 상한에 닿은 선수·능력치 버튼 막기/「최대」 표시(`flame_catalog.training.maxPerStat`, `roster[p].train`). ② 승리 보상 화면의 「전원 회복 n%」 한 칸(`public/js/screens/flame/run.js`, 지금은 `afterWinHealPct` 만 읽는다)이 **보스 승리 보상에서는 `afterBossHealPct`** 를 읽게(보상 `pending[].nodeType === 'boss'`). 고치기 전에는 보스 뒤에 실제 50% 가 들어오는데 화면에는 30% 로 적힌다. ③ (선택) `flame_result.practiceRefunded` 면 「연습 경기를 다시 받을 수 있습니다」 한 줄. ④ `catalogVer` 가 `.m10` 으로 바뀌므로 캐시된 카탈로그는 다시 받는다(종전 문자열 비교 그대로).

화면 반영(2026-11-19 윤프론, HANDOFF §4-39): ① 특훈장에서 상한을 넘는 특훈 버튼은 누를 수 없고 「능력치 값 · 최대」로 적는다(`maxPerStat` `null`·키 없음 = 종전). `FLAME_TRAIN_CAP` 은 서버 `msg` 토스트. ② 승리 보상의 「승리 회복 +n%」는 보스 승리 보상에서 `afterBossHealPct`. 보스 판별은 `pending[].nodeType` 을 먼저 읽는다. **아티팩트 보상 칸(`pending[]{kind:'artifact'}`)에도 `.m11`(`CATALOG_MSG_REV` 11, 39 B70, §13.19)부터 `nodeType` 이 실린다** — 이 화면을 반영할 때(`.m10`)는 그 칸이 없어 `run.done[]` 의 노드 종류 → 「승리 보상 아티팩트 = 보스」 순의 대체 판별을 넣었고, 그 대체 판별은 지금은 **`.m11` 전에 만들어져 저장된 선택 칸**에만 쓰인다. ③ `practiceRefunded` → 토스트 「연습 경기를 다시 할 수 있습니다」. ④ 코드 수정 없음.

### 13.19 아티팩트 보상 칸의 `nodeType` (2026-11-19 박백엔) — 서버. 화면은 후속(윤프론)

가정 `analysis/39` B70~B72. 원작 경기 엔진·`public/` 은 고치지 않았다. `CATALOG_MSG_REV` 10 → 11(`flame_catalog.ver` 끝이 `.m11`, 카탈로그 내용은 그대로). 저장 형식 버전은 그대로(도전 3·영구 2).

- `flame_state.run.pending[]` 의 **아티팩트 선택 칸**(`kind:'artifact'`)에도 장비 보상 칸과 같은 **`nodeType`** 이 실린다: 보스 승리 보상 = `'boss'`, 시작 보상(전술 연구 PB03) = `'start'`. 같은 승리에서 나온 장비 칸과 값이 같다(`src` 도 같다). 다른 칸(`kind`·`src`·`choices`·`n`)은 그대로다.
- 표시용이다: 서버는 아티팩트 칸의 `nodeType` 을 뽑기·재선택에 쓰지 않는다(장비 칸은 종전대로 등급 확률에 쓴다).
- **이 변경 전에 만들어져 저장된 선택 칸에는 `nodeType` 이 없다**(저장을 고쳐 채우지 않는다) → 화면은 없을 때의 종전 판별(`run.done[]` → 「승리 보상 아티팩트 = 보스」)을 남겨 둔다.
- 화면 후속(윤프론): `public/js/screens/flame/run.js` 의 승리 회복 % 판별은 이미 `pend.nodeType` 을 먼저 읽으므로(§13.18 화면 반영 ②) **코드를 고치지 않아도 새 칸을 쓴다.** 할 일은 확인뿐이다: 보스 승리 뒤 두 번째 보상(아티팩트) 화면의 「승리 회복 +50%」, 시작 보상 아티팩트 화면에는 회복 칸이 없음, `catalogVer` `.m11` 로 카탈로그를 다시 받는지.

같이 넣은 정검수 리뷰 Low 2건(39 B71·B72, 현재 데이터에는 영향 없음):

- **L1 상대 레벨 하한 1**: `difficulty[].cpuLevelAdd`(숫자·객체의 값)는 **0 이상의 정수**만 받는다(`catalog.js` 로드 검사·`validate_data.mjs` 11절). 지도 생성(`map.js oppOf`)도 `max(1, min(cpuLevelMax, 기본 + 가산))` 으로 자른다 — 레벨 0 이하가 저장되면 저장 검사(`cpuLevel >= 1`)에 걸려 도전이 격리되기 때문이다.
- **L2 이벤트 선택지 하나에 같은 능력치의 `trainRandom` 은 1개**(`validate_data.mjs` 11절 오류). 받을 수 있는 선수 검사는 op 마다 따로 하므로 2개 이상이면 뒤쪽이 조용히 건너뛰어질 수 있다. 서버 동작(`nodes.js chooseEvent`)은 고치지 않았다.

### 13.20 키운 팀 슬롯 + 컴퓨터 대전에서 그 팀 고르기 (1차 증분, 2026-11-19 박백엔) — 서버·데이터. 화면은 후속(윤프론)

결정 `analysis/39` D33~D37(가정 B73~B84), 요구·분해 `analysis/43_flame_team_in_versus.md`. 사용자 요청 「멀티에서 팀 고를 때 자기가 키웠던 팀을 선택할 수 있으면 좋을듯」의 **1차 범위 = 컴퓨터 대전 방**(사람 1명 + 컴퓨터 원작 팀). 온라인 사람끼리 방은 2차(미구현, 43 §6). 원작 경기 엔진(`server/engine/`)·`public/` 은 고치지 않았다. 데이터 `run_config.json versusTeam{enabled, surviveUsesPerMatch?}` — **키를 지우거나 `enabled:false` 면 종전 동작**(슬롯을 저장하지 않고 고를 수도 없다. 이미 저장된 슬롯은 지우지 않는다). `CATALOG_MSG_REV` 11 → 12(`flame_catalog.ver` 끝이 `.m12`). 저장 형식 버전은 그대로(도전 3·영구 2). 새 DB 표 없음.

**(1) 슬롯 저장** — 영구 저장(`flame_profiles` 의 JSON)의 **선택 칸** `teams{recent?, best?}`.

- 저장 시점 = 도전 종료 정산(`run.js settle`, 패배·포기·종전 우승 종료 공통). **경기를 1판 이상 치른 도전**(`flame_end.summary.counted`)만 저장한다.
  - `recent`(최근) = 그런 도전이 끝날 때마다 덮어쓴다.
  - `best`(최고) = 그 도전이 순위 기록(`best.rank`, §13.13)을 가진 도전일 때만 쓴다(= 정산 뒤 `best.rank.run` 이 이 도전의 id. `best.rank` 에 기록을 세운 도전 id `run` 이 선택 칸으로 늘었다. 구간·승수가 같은 동률 도전은 기록을 바꾸지 않으므로 `best` 도 그대로다. `run` 이 없는 변경 전 기록은 다시 넘어설 때부터 `best` 가 채워진다). 기록을 넘지 못한 도전은 `best` 를 건드리지 않는다. 저장되는 팀은 **기록을 세운 순간이 아니라 그 도전이 끝난 시점의 팀**이다.
- 저장 내용은 **재료만**이다: `{v:1, at, diff, seg(도달 구간, 1부터), wins, origTeam?(팀 id), fm, arts[3], perm{영구 성장 A 단계}, roster[7]{from{team,idx}, orig?, clone?, recruited, train{}, equip{슬롯:{id, lv}|null}, sp[2]}}`. 한 칸 약 1.2KB.
- **저장하지 않는 것**: 최종 능력치, 이름·skin·팀명, 현재 HP, 소모품·다음 경기 효과, 끼지 않은 장비, 경기 포인트, 지도, 난수 시드·비밀값, 치사 생존 사용 횟수.
- 읽을 때마다 검증한다(`teams.js sanitizeTeam`, 저장할 때도 같은 함수): 없어진 아이템·아티팩트 id 는 그 칸만 비우고, 특훈 누적은 `training.maxPerStat`(§13.18, 표에 없는 능력치는 255)로 자르고, 없어진 클론·오리지널 id 는 표시만 버리고(= 그 몸의 원작 선수로 읽힌다) 팀은 살린다. 7명이 아니거나 같은 선수가 겹치거나 형식 번호가 더 새것이면 **그 슬롯만** 없음이다.
- 손님도 저장된다(불꽃의 계승 기존 규칙. 가입 경합으로 남은 손님 세션은 종전대로 쓰지 않는다).
- **한계(되돌리기)**: `PROFILE_VERSION` 을 올리지 않았으므로 이 변경 전 서버로 되돌려도 영구 저장은 읽힌다. 다만 되돌린 서버가 그 계정의 영구 저장을 다시 쓰면(아무 `flame_*` 조작) **`teams` 칸만 사라진다**(`best.rank`·`practiceUsed` 와 같은 성질). 코인·기록·도감은 그대로다.

**(2) 요약 칸** — `flame_state.profile.teams = {recent, best}`, 각 `{seg, wins, diff, at, core:[이름 3], team:{id,name,short}|null, captain:{team,idx}} | null`.

- `core` = 라인업 0~2번 칸의 이름(오리지널·클론 = 이름 문자열, 원작 선수 = `'@팀:번호'`, 순위표 `team` 과 같은 표기). `team` = 오리지널 팀으로 시작한 도전이면 그 팀, 아니면 `null`. `captain` = 주장 칸의 몸.
- 재료·능력치는 보내지 않는다. `flame_get` 은 방 안에서도 받을 수 있다(대기실의 팀 선택 화면이 슬롯 유무를 알 수 있다).
- `flame_catalog.versusTeam = {enabled:true, slots:['recent','best'], ruleMode:'knockout', surviveUsesPerMatch} | {enabled:false, slots:[]}`.

**(3) 고르기** — `set_team { team: 'flame:recent' | 'flame:best' }`(새 메시지 없음. `team` 이 문자열이면 슬롯 참조다).

- 되는 방: **일반 컴퓨터 대전 방**(`create_room{vsCpu:true}`)의 방장(= 유일한 사람), 대기 중, 규칙 `mode:'knockout'`(시간은 자유).
- 성공하면 `room_state`: `slots[0].flameTeam = {slot, …요약 칸과 같은 값}`, `slots[0].team` = 주장 칸의 몸 출처 팀 번호(표시 fallback), 컴퓨터 팀이 내 로스터와 겹치면 다시 뽑힌다((5)). **`room.flame` 은 생기지 않는다**(그 키는 도전 경기 방 표시다, §13.5).
- 숫자 `team` 으로 다시 `set_team` 하면 선택이 풀린다(`slots[0].flameTeam` 없음).
- 거절(전부 토스트): `TEAM_INVALID`(`'flame:…'` 형식이 아닌 문자열·모르는 슬롯·객체 등 위조 값), `NOT_IN_CAMPAIGN_ROOM`(스토리·튜토리얼·리그·불꽃의 계승 도전 방 — 종전 `set_team` 과 같은 코드), `FLAME_TEAM_ROOM`(랭크 방·사람끼리 방), `FLAME_TEAM_RULES`(공식 규칙 방), `FLAME_TEAM_NONE`(그 슬롯이 없음·쓸 수 없음·읽지 못한 저장), `FLAME_UNAVAILABLE`(모드 또는 `versusTeam` 꺼짐), `FLAME_SAVE_NEWER`, `CAMPAIGN_RATE_LIMITED`(영구 저장을 읽는 요청이라 `flame_*` 빈도 창에 든다), 공통 `NOT_IN_ROOM`·`IN_GAME`.
- 불꽃 팀을 고른 방에서 `set_rules{mode:'official'}` 은 `FLAME_TEAM_RULES`(먼저 원작 팀으로 바꾼다).

**(4) 경기** — `start`(종전 요청 그대로).

- 서버가 **시작 시점의 저장값**을 다시 읽어 `computeTeam → toEngine` 으로 능력치를 다시 계산하고 엔진 flame 옵션(§12.1, 좌석 0)을 조립한다. 클라이언트가 보낸 것은 슬롯 이름뿐이다. 그사이 슬롯을 쓸 수 없게 됐으면 `start` 가 `FLAME_TEAM_NONE` 등으로 거절된다(방은 그대로).
- 도전과 다른 점: **시작 HP 는 언제나 최대**, 소모품·다음 경기 효과 없음, 보스전 한정 효과 없음, 치사 생존(P10)은 **경기마다 새로 세고 팀 합계 `surviveUsesPerMatch`(시작값 1)회**(0 = 발동하지 않음. 아이템 정의의 `usesPerRun` 보다 늘리지는 못한다).
- **`game_start` 구분값**: 도전 경기의 `flame:{seat, fm, allow}` **키가 없고**, 대신 **`flameVs:{seat:0, fm, allow, mode:'versus', slot}`** 가 실린다. `teams[0]`(§12.2 의 `flame:true`·`from`·`hp0`·`sp`·`spOn` 등)·`flameCast` 형식은 도전 경기와 같고 `flameCast` 에 `versus:true, slot` 이 더 있다.
  - 이유: 클라이언트는 `game_start.flame` 을 「불꽃의 계승 도전 경기」 표시로 쓴다(`screens/game.js` 의 `flame` 판별 → 결과 카드 「도전으로」·`holdLobby`·`room_left` 뒤 도전 화면 이동, `main.js`). 같은 키를 쓰면 대전이 끝난 뒤 도전 화면으로 넘어가 버린다. 키를 나눴으므로 **화면을 고치지 않아도 경기 흐름(끝나면 대기실)은 종전 컴퓨터 대전과 같다** — 고칠 것은 표시뿐이다(아래 화면 후속).
- 끝나면 일반 방과 같다: `game_end`(`flameVs:{seat, hp[7], maxHp[7], surviveUsed[]}` 표시용, `flame` 키 없음) → `room_state`(waiting). 방과 팀 선택은 남는다(다시 `start` 할 수 있다). `flame_result`·`flame_end`·`flame_state`·`room_left` 는 오지 않는다.
- **무반영 보장**: 이 경기는 도전 경로(`flameEnd`·`applyMatchResult`·`settle`)를 타지 않는다 — 진행 중인 도전·현재 HP·승수·코인·최고 기록·순위표·슬롯·업적·도감이 전부 그대로이고 **저장이 한 번도 일어나지 않는다**. 결과 레코드(`results.jsonl`)도 쓰지 않는다(연습 경기와 같은 `noRecord`).

**(5) 상대 팀**(D36) — 불꽃 팀을 고르면 컴퓨터 팀은 **내 로스터 7칸의 몸 출처 팀(`from.team`) 전부를 뺀 무작위**다(고를 때와 시작할 때 겹치면 다시 뽑는다). 도전 경기(상대 = 지도 노드의 팀 그대로, 39 B30)와 다르다: 대전은 상대를 정한 지도가 없고, 같은 원작 선수가 양쪽에 서는 일을 피한다.

> **2차(2026-11-19, §13.25)**: 사람끼리 방에서도 방장이 규칙 「불꽃 팀」(`rules.flameTeams`)을 켜면 두 사람이 각자 슬롯을 고를 수 있다. 위 (3) 의 `FLAME_TEAM_ROOM`(사람끼리 방) 거절은 그 규칙이 꺼진 방에만 해당하고, 문구는 「이 방은 불꽃 팀을 허용하지 않습니다」로 바뀌었다. 컴퓨터 대전 방의 동작·`game_start.flameVs{seat:0,…}`·`noRecord` 는 이 절 그대로다. 도전 종료 요약에 `flame_end.summary.teams{recent, best}` 가 늘었다(§13.2 목록).

화면 후속(윤프론): ① 대기실 팀 선택 격자에 「최근」「최고」 2칸(`flame_state.profile.teams`, `flame_catalog.versusTeam.enabled`, 컴퓨터 대전 방·체력제일 때만 활성) → `set_team{team:'flame:recent'}`. ② 대기실 좌석 표시(`slots[0].flameTeam`: 구간·승수·핵심 3명). ③ `screens/game.js`: 그리기용 판별을 `start.flame ?? start.flameVs` 로(선수 이름·skin `flameCast`, 필살기 안내 `noSpecial`), **흐름용 판별(결과 카드 「도전으로」·`holdLobby`·`room_left`)은 `start.flame` 만** 보게 유지. ④ 새 오류 코드 3개 토스트. ⑤ 공식 규칙을 고르면 불꽃 팀 칸 비활성(또는 `FLAME_TEAM_RULES` 토스트).

### 13.21 필살기 부여 구조 (2026-11-19 박백엔) — 서버·데이터. 화면은 후속(윤프론). 결정 analysis/39 D38(가정 B85~B93)

사용자 결정: 선수 자체에는 필살기가 없고, **낀 아티팩트가 부여한 슛**만 나간다. 단 **원작 선수**는 자기 고유 슛을 기본으로 갖는다. 엔진은 바뀌지 않았다(§12.1 그대로. 서버가 `allow` 와 슬롯을 맞춰 넘긴다).

- **스위치**: `server/flame/data/decisions.json special.model` = `'granted'`(지금 값) | `'legacy'`(또는 키 없음 = 종전: 원래 필살기를 갖고 시작하고 아티팩트가 계열을 해금). `flame_catalog.special = {model, slotRule, artifactShots:{아티팩트 id: 대표 슛 ID}}`(`CATALOG_MSG_REV` 13 → `catalogVer` 끝이 `.m13`).
- **선수 구분**(`flame_state.team.players[i].kind`): `'starter'` = 불씨 시작 선수(`roster[i].orig`), `'clone'` = 영입 클론(`roster[i].clone`), `'original'` = 원작 선수(두 표시가 없는 칸: 희귀 발견으로 영입한 원작 캐릭터, D17 이전 저장의 태동 선수).
- **고유 슛**(`flame_state.team.players[i].own`): 원작 선수 = 원작 필살기 ID(표값 255 로 빠진 ID 면 `null`), 불씨·클론 = 언제나 `null`.
- **선수별 발동 가능 집합** = `team.grant`(낀 아티팩트가 부여한 ID. 아무 선수나 슬롯에 넣을 수 있다) + 그 선수의 `own`. 화면의 슬롯 선택지는 이 둘로 만든다.
  - `team.allow` 는 **엔진에 넘기는 값**(= `grant` + 로스터 원작 선수들의 `own`)이다. 팀 공용이라 **선택지로 쓰면 안 된다**(남의 고유 슛이 들어 있다 → 넣으면 `FLAME_LOCKED`).
  - 발동은 주 슬롯(`roster[i].sp[0]`)만(D1). 그 값이 `null` 이면 「필살기 없음」, `own` 과 같으면 「고유」, 그 밖이면 아티팩트 슛이다. 「미습득」(슬롯에 있지만 발동하지 않는 상태)은 더 없다 — 서버가 집합 밖의 값을 비운다.
- **새 도전**: 불씨 7명 `sp = [null, null]`, 아티팩트가 없으면 경기 `allow = []`(필살기 발동 없음. 공중 차지 13~15 투구는 일반 슛, §12.1 「필살 잠금」과 같다).
- **영입**(`flame_choose`): 클론 = `[null, null]`(풀 정의의 `sp` 는 쓰지 않는다. 지금 낀 필살기 아티팩트가 있으면 슬롯 순서로 첫 아티팩트의 대표 슛이 주 슬롯에 들어간다), 원작 선수 = `[own, null]`. 영입 후보 칸(`pending[].choices[]`)의 `sp`: 클론 = `null`, 원작 선수 = 고유 슛 ID. `run.cast.players[i].sp`(클론 칸)도 `null`.
- **아티팩트 장착·해제**(`flame_artifact`) 뒤 서버가 슬롯을 맞춘다: ① 집합 밖의 ID 를 두 슬롯에서 비운다(원작 선수의 주 슬롯이 비면 고유 슛으로 복귀) ② 주 슬롯이 비고 예비 슬롯에 쓸 수 있는 슛이 있으면 주 슬롯으로 올린다 ③ 새로 낀 아티팩트의 대표 슛을 주 슬롯이 빈 선수 전원에게 넣는다(이미 슛이 있는 선수·원작 선수는 그대로). 응답 `flame_state.run.roster[i].sp` 가 바뀐 값이다.
- **슬롯 지정**(`flame_special{p, sp:[a, b]}`): 넣을 수 있는 것 = `team.grant` 의 ID 또는 그 선수의 `own`. 그 밖 — **다른 선수의 고유 슛, 부여되지 않은 슛, 불씨·클론의 옛 「원래 필살기」** — 은 `FLAME_LOCKED`(상태 그대로). 두 칸이 같은 ID 면 `FLAME_INVALID`. 원작 선수의 주 슬롯을 비워 보내면 고유 슛으로 돌아간다(`[null, x]` → `[own, x]`).
- **저장**: 형식 번호 그대로(도전 3·영구 2). 읽을 때(`sanitizeRun`) 집합 밖의 슬롯 값을 `null` 로 정리한다 → 변경 전 도전의 불씨·클론 필살기는 비고 원작 선수의 고유 슛은 남는다. 키운 팀 슬롯(§13.20)은 저장된 칸을 고치지 않고 대전 조립 때마다 같은 정리를 한다(`flameVs.allow` 에도 원작 선수의 고유 슛이 든다). 한계: 정리된 값은 `legacy` 로 되돌려도 되살아나지 않는다(39 B91).
- **대표 슛**: `shot_families.json families[].grantShotId`. 시작값 [자작] = 그 계열 아티팩트가 부여하는 ID 중 위력 최저(A01 22 · A02 11 · A03 1 · A04 9 · A05 3 · A06 13). 검증기(`validate_data.mjs`)가 「그 아티팩트가 실제로 부여하는 ID 인가」와 `model` 값을 본다.

화면 후속(윤프론): ① 선수 카드·팀 관리 슬롯 탭의 선택지를 `team.grant` + `team.players[i].own` 으로(지금의 `allow`·`cast.sp`·몸 주인 필살기 기반 「원래 필살기」 선택지는 거절된다) ② 주 슬롯 표기 「필살기 없음」/「고유」, 「미습득」 표기 제거 ③ 영입 카드: 클론 = 「필살기 없음」, 원작 선수 = 고유 슛 이름 + 「고유」 ④ 도감·아티팩트 설명문 「해금」→「부여」(대표 슛 = `flame_catalog.special.artifactShots`) ⑤ `FLAME_LOCKED` 토스트 문구 ⑥ 경기 조작 안내(필살기 없는 선수의 공중 차지 투구는 일반 슛) ⑦ `special.model === 'legacy'` 면 종전 화면.

화면 반영(2026-11-19 윤프론, HANDOFF §4-45): ①~⑦ 구현. 서버 메시지는 그대로다. `FLAME_LOCKED` 토스트는 `flame_special` 요청의 거절일 때만 화면이 「부여되지 않은 필살기입니다」로 바꿔 내고(서버 `msg` 불변), 아티팩트 설명문은 화면에서 「해금」→「부여」 낱말만 바꾼다(`specText` 원문 불변).

### 13.22 등급제: 필살슛·포메이션 아이템 (2026-11-19 박백엔) — 서버·데이터. 화면은 후속(윤프론). 결정 analysis/39 D39~D44(가정 B94~B108)

필살슛과 포메이션이 **등급(C/B/A/S)이 붙은 아이템**이 됐다. 엔진은 바뀌지 않았다(§12.1 그대로). 수치는 전부 `server/flame/data/decisions.json grade` 의 시작값이다.

- **스위치**: `grade.model` = `'v1'`(지금 값) | `'off'`(등급 아이템이 새로 나오지 않고 가산·상한·포메이션 아이템 규칙이 꺼진다 = §13.21 까지의 동작). `CATALOG_MSG_REV` 13 → 14(`catalogVer` 끝 `.m14`).
- **아이템 id**: `SP<슛 ID>-<등급>`(47종 × 4 = 188), `FM<패턴 번호>-<등급>`(15 × 4 = 60). 서버가 규칙으로 만들어 **`flame_catalog.artifacts` 뒤에 붙인다**(30 → 278칸). 등급 아이템의 칸: `kind:'shot'|'formation'`, `grant:{shot:ID}|{formation:패턴}`, `grade`, `effects:[]`. `name`·`specText`·`icon` 은 임시 값이다(화면이 `grant` 로 이름을 붙인다).
- **`flame_catalog.grade`** = `{model, grades:['C','B','A','S'], spPow:{C,B,A,S}, spPowCap, formation:{default, stat:{s7,s6,s4:{C,B,A,S}}, tagPct:{C,B,A,S}, ampCapPct}, drop:{boss:[구간별 {C,B,A,S}], shop, firstWin, bossKinds, shopKinds, firstWinChoices}, price:{shop, sell}, equipmentLetters}`. `flame_catalog.rarity.letters` = 장비 등급 표기 `{common:'C', rare:'B', epic:'A', legendary:'S'}`(데이터 키는 그대로).
- **보유·장착**: 종전 아티팩트와 같다(`run.artifactsOwned` id 목록, `flame_artifact` 로 3슬롯에 낀다). **같은 슛·같은 포메이션은 가장 높은 등급 하나만**: 더 높은 등급을 얻으면 낮은 것은 자동 판매(경기 포인트 `price.sell`)되고 끼고 있던 칸을 새 등급이 물려받는다. 보상 선택이면 `flame_state.note = {upgraded:true, id, sold, points}`. 같거나 낮은 등급을 받으려 하면 `FLAME_INVALID`(후보에는 나오지 않는다).
- **드롭**: 등급 먼저(출처별 가중치) → 종류 균등. 같은 도전의 같은 보상은 다시 열어도 같다.
  - 구간 보스 승리의 아티팩트 선택 = **「필살슛 1 · 포메이션 1 · 팀 강화(A07~A30) 1」** 고정(낼 것이 없는 유형은 빠진다).
  - **첫 승리 보상**: 도전의 첫 승리(보스 제외)에 `pending` 한 칸이 더 선다 — `{kind:'artifact', g:'firstWin', nodeType, choices:[필살슛 C 3개]}`. 장비 보상 다음 차례다(`flame_choose` 로 고르거나 `i:-1`).
  - 상점의 아티팩트 칸: 유형을 가중치로 뽑는다. 값은 `stock[].price`(등급 아이템 = 등급별).
  - 시작 보상·이벤트의 아티팩트 = 팀 강화만. **A01~A06 은 새로 나오지 않는다**(가진 것은 종전대로 계열을 부여한다).
- **필살슛 아이템**: 끼면 그 슛 하나가 `team.grant` 에 들고(아무 선수나 슬롯에 넣을 수 있다) 대표 슛 자동 채움은 그 슛이다(§13.21 규칙 그대로). **등급 위력 가산** = 주 슬롯의 슛을 주는 낀 아이템의 등급(`spPow`). 고유 슛·A01~A06 의 슛은 등급 없음(가산 0) — 같은 슛의 아이템을 끼면 그 등급을 받는다.
  - `flame_state.team.players[i].special = {id: 주 슬롯 슛|null, grade: 'C'|…|null, add: 등급 가산, cut: 위력 상한으로 잘린 값}`.
  - **위력 상한**: 필살 최종 위력 ≤ 표값 + `spPowCap`(장비·아티팩트·시너지 가산 포함). 서버가 엔진에 넘기는 `fx` 를 자른다 → `team.players[i].fx` 는 잘린 뒤 값이다.
- **포메이션 아이템**: 기본 포메이션(`grade.formation.default`)은 아이템 없이 쓰지만 **태그·보너스·시너지가 없다**(`team.tag = null`). 아이템을 끼면 그 패턴으로 바뀌고 태그 + 등급 보너스를 받는다. 빼면 기본으로.
  - `flame_formation{fm}`: 기본 포메이션 또는 **낀** 포메이션 아이템의 패턴만. 그 밖은 `FLAME_LOCKED`.
  - `flame_state.team.fm`(실제로 쓰이는 패턴)·`fmItem`(그 패턴을 주는 낀 아이템 id|null)·`fmGrade`. 등급 보너스는 능력치 6단계(`steps[5]`)에 들어 있다.
- **저장**: 형식 번호 그대로. 변경 전 도전의 「아이템 없이 고른 포메이션」은 읽을 때 기본 포메이션이 된다(되살아나지 않는다). 표시(`orig`·`clone`)가 무효가 된 칸은 `lost:true` 가 붙어 고유 슛이 없다(§13.21 의 「원작 선수로 이어져 고유 슛을 갖는다」를 대체).
- **키운 팀·컴퓨터 대전(§13.20)**: 같은 계산이다(등급 가산·상한·포메이션 아이템). 주 슬롯이 빈 불씨·클론은 낀 필살슛 아이템의 대표 슛을 받는다.

**리뷰 반영 보강 (2026-11-19 박백엔, 결정 analysis/39 D45~D48·가정 B109~B119)** — 기존 칸의 이름·모양은 그대로이고 **새 칸만 더했다**. `CATALOG_MSG_REV` 14 → 15(`catalogVer` 끝 `.m15`).

- **위력 상한 구조가 바뀌었다(D45, 위의 「위력 상한」 줄을 대체)**: 등급 가산(`special.add`)은 상한 밖에서 언제나 전액 붙는다. 그 밖의 필살 가산 합(장비·아티팩트·시너지 + 필살 투구에 늘 붙는 차지·공중 가산, 캐치 직후가 아닌 평소 필살 기준)만 `grade.spOtherCap`(20)에서 자른다. 캐치 직후까지 더한 전체는 `grade.spPowCap`(60 — **칸 이름 그대로, 값 45 → 60, 뜻 = 전체 안전 상한**)에서 캐치 가산(`fx.catchPow`)만 줄인다.
  - 새 칸 **`flame_catalog.grade.spOtherCap`**(정수 | `null` = 따로 자르지 않음).
  - 새 칸 **`flame_state.team.players[i].special.other`**(자른 뒤 평소 필살의 그 밖의 가산, 0~`spOtherCap`)·**`special.cutCatch`**(전체 상한 때문에 줄인 캐치 가산, 0 = 줄이지 않음). `special.id·grade·add·cut` 은 그대로다(`cut` = 그 밖의 가산 상한으로 잘린 값). 평소 필살 위력 = 표값 + `add` + `other`.
  - `team.players[i].fx` 는 종전처럼 자른 뒤 값이다. 자를 때 접는 `famPow`·`famPct` 는 그 슛이 속한 계열 칸만이다(다른 계열 칸은 남는다).
- **드롭(D46)**: 뽑힌 등급으로 받을 것이 없을 때 올려 찾는 범위 = 그 출처의 가중치가 0 보다 큰 등급, `grade.drop.escalateMax`(`'A'`) 이하. 상점의 S·첫 승리 보상의 B 이상은 나오지 않고 보스의 S 는 직접 뽑혔을 때만 나온다. 낼 것이 없는 필살슛·포메이션 칸은 `grade.drop.emptyAsTeam`(true)이면 **팀 강화 한 칸으로 대신**한다 → 보스 3칸이 「팀 강화 · 포메이션 · 팀 강화」처럼 설 수 있고, **첫 승리 보상(`g:'firstWin'`)·상점의 칸에도 팀 강화가 올 수 있다**(유형은 칸의 아이템 `kind` 로 판별한다. 없으면 팀 강화). 새 칸 **`flame_catalog.grade.drop.escalateMax`·`emptyAsTeam`**.
- **시너지 조건(D47)**: 새 칸 **`flame_catalog.synergies[].requires.shotFamily`**(계열 id | 없음) = 그 계열의 슛을 부여하는 아티팩트(계열 아티팩트 또는 그 계열 슛의 필살슛 아이템)를 낀 조건. SY01·SX01 은 `requires = {formationTag, artifacts:['A13'], shotFamily:'flame'}` 이다(종전 `artifacts:['A01','A13']`). 켜진 시너지는 종전대로 `team.synergies`.
- **알림(D48)**: `flame_buy` 의 `flame_state` 에도 **`note = {upgraded:true, id, sold, points}`**(보상 선택과 같은 모양)가 붙는다. 새 알림 **`note = {voided:true, id}`** = 고른 칸이 이미 가진 등급 이하라 무효가 됐다(거절 아님. `FLAME_INVALID` 대신 온다). 아티팩트를 얻으면 남은 아티팩트 선택(`pending`)에서 받을 수 없게 된 칸이 빠지고 빈 선택은 통째로 사라진다 → 화면은 받은 `pending` 을 그대로 그린다(칸 번호는 새 목록 기준).

화면 후속 추가(윤프론): ⑪ `special.other`·`cutCatch` 표시(선택) ⑫ `note.voided` 토스트·상점 `note.upgraded` 토스트 ⑬ 첫 승리 보상·보스 보상 칸에 팀 강화가 섞일 수 있음 ⑭ 시너지 조건을 그리게 되면 `requires.shotFamily`.

화면 후속(윤프론): ① 아티팩트 목록·보상·상점·도감에서 등급 아이템 표시(`grant` 로 슛·포메이션 이름, 등급 배지 C/B/A/S, 「같은 종류 보유 등급」 비교) ② 보스 보상 3칸의 유형 표시(필살슛·포메이션·팀 강화) ③ 첫 승리 보상 화면(`g:'firstWin'`) ④ 자동 판매 알림(`note.upgraded` 토스트) ⑤ 선수 카드의 슛 등급·가산·상한 표시(`special`) ⑥ 포메이션 화면: 고를 수 있는 것 = 기본 + 낀 아이템의 패턴, 기본은 「태그 없음」, `fmGrade` 보너스 표시, `FLAME_LOCKED` 토스트 ⑦ 장비 등급 표기 C/B/A/S(`rarity.letters`) ⑧ 도감 아티팩트 탭의 분모(30 → 등급 아이템 포함 여부 결정) ⑨ `grade.model === 'off'` 면 종전 화면 ⑩ 전용 아이콘(안아트)이 생기기 전까지 임시 아이콘.

화면 반영(2026-11-19 윤프론, HANDOFF §4-47): ①~⑩ 구현. 서버 칸·메시지는 그대로다. 이름은 화면이 `grant` 로 붙이고(`name`·`specText` 임시 문구 미사용), ⑧ 도감 분모는 손으로 쓴 30종 그대로 두고 등급 아이템은 종류당 한 칸(슛 47 · 포메이션 15, 발견한 최고 등급)으로 따로 센다. `flame_formation` 의 `FLAME_LOCKED` 는 화면이 「장착한 포메이션 아이템만 고를 수 있습니다」로 바꿔 낸다(서버 `msg` 불변). `.m15` 의 `note.voided`·상점 구매 `note.upgraded` 는 토스트로 받고, `special.other`·`special.cutCatch`·`grade.spOtherCap` 은 화면에 내지 않는다.

### 13.23 영구 성장 표 개정·옛 저장 이관 + 장비 S 극희귀화 채택 + 포메이션 C 보너스 (2026-11-19 박백엔) — 서버·데이터. 화면은 후속(윤프론). 결정 analysis/39 D49~D51(가정 B120~B123)

메시지 칸 이름·모양은 바뀌지 않았다. 값과 한 가지 범위만 바뀐다. `run_config.json _meta.version` 6 → 7 이라 `cat.ver`(예 `1.1.1.7.o3.p2.m15`)가 바뀌어 클라이언트는 옛 카탈로그(영구 성장 비용 포함)를 버리고 다시 받는다.

- **영구 성장 값(D50)**: `flame_catalog.perm[]`·`flame_state.profile.permList[]` 의 `maxLevel`·`costs`·`effect.perLevel` 이 새 표다 — PA01 4단계(HP +1, 150/250/350/450) · PA02/PA03 1단계(700) · PA04 1단계(400) · PB01 6단계(+15, 40/60/80/100/130/160) · PB02 120/240 · PB03 150/300 · PB04 80/150/250 · PB05 80/150/250 · PB06 4단계(−5%, 40/60/80/100) · PB07 120/240 · PC02 300. 풀강화 9,480코인 · 37단계.
- **범위가 바뀐 칸**: `profile.perm{id:단계}`·`permList[].lv` 의 **A(PA01~04) 단계는 `maxLevel` 보다 클 수 있다**(옛 표에서 산 효과를 보존한 저장: PA01 최대 6, PA02~04 최대 2). 그때 `next` 는 null 이고 `flame_perm` 은 `FLAME_MAX`. B·C 는 언제나 `maxLevel` 이하다. 키운 팀 슬롯(§13.20)의 `perm` 도 같다.
- **옛 저장 이관(읽을 때 한 번)**: 영구 저장의 선택 필드 `permV`(영구 성장 표 판, 지금 2)가 없거나 2 미만이면 단계를 총효과가 같게 바꾼다(PA01 ×2, PB01 ×2, PB06 ×2, 나머지 그대로). 환불은 없다. 새 프로필은 처음부터 `permV:2`. `profile.v`(`PROFILE_VERSION` 2)는 그대로. `permV` 는 `flame_state` 에 싣지 않는다. 되돌림 한계는 39 B122.
- **장비 S(D49)**: 전설 장비 제시 확률이 완주당 약 6.3% 로 줄었다(`run_config reward.rarityShift` v6 값 채택). 메시지는 그대로.
- **포메이션 등급 보너스(D51)**: `flame_catalog.grade.formation.stat.s7` = `{C:1, B:2, A:2, S:4}`(종전 0/1/2/4). C 포메이션 아이템만 껴도 팀 패스 속도 +1.

화면 후속(윤프론): ① 영구 성장 화면이 6단계(PB01)·4단계(PA01·PB06) 칸을 담는지 ② A 의 `lv > maxLevel`(예 6/4)을 「최대」로 보이게(넘친 단계는 「이전 구매 보존」 정도로, 문구는 최소) ③ 카탈로그 캐시가 `cat.ver` 변경으로 새로 받아지는지 ④ 포메이션 C 아이템 설명의 「효과 없음」 류 문구가 있으면 「패스 속도 +1」로.

### 13.24 필살 속도의 등급 차 — 엔진 훅 E1 (2026-11-19 박백엔) — 엔진·서버·데이터. 화면은 후속(윤프론). 결정 analysis/39 D52(가정 B124~B128)

사용자 지시 「S등급으로 맞출때쯤이면 엄청나게 빠르고 쎄야됨」「같은 슛이라도 등급에 따라 속도나 파워가 달라야함」. 같은 슛이라도 등급 아이템의 등급에 따라 필살 공이 빨라진다(위력 가산 D41·D45 는 그대로).

- **엔진 옵션 새 칸 `flame.roster[i].fx.spSpd`**(§12.1): 0 이상 정수(엔진 안전 상한 255). 필살 투구에서만 속력 +N×16(8.8) 후 같은 식으로 속도를 다시 분해한다. 일반 투구·받아치기 공(잡은 공의 속력 승계)·비직역 투구 경로는 가산 없음. 칸이 없거나 0 이면 종전과 비트 단위로 같다.
- **카탈로그 새 칸 `flame_catalog.grade.spSpd`** = `{C:0, B:4, A:10, S:24}`(투구 속도 s6 단위, +4 = +0.25px/f, S = +1.5px/f. 데이터 `decisions.json grade.spSpd`, 0~64 정수, 낮은 등급부터 줄지 않게. 키가 없으면 전 등급 0). `CATALOG_MSG_REV` 15 → 16 이라 `cat.ver` 끝이 `.m16` 으로 바뀌어 클라이언트는 카탈로그를 다시 받는다.
- **`flame_state.team.players[i].fx.spSpd`**: 그 선수의 필살 속도 가산 = 주 슬롯 슛을 주는 낀 등급 아이템의 `grade.spSpd[등급]`(데이터 최댓값 이내로 자른 값). 고유 슛·계열 아티팩트 단독 = 0, 고유 슛 + 같은 슛 아이템 = 그 등급. `players[i].special` 의 칸은 그대로다(`special.grade` 와 함께 읽는다).

화면 후속(윤프론, 표시만): ① 선수 카드(팀 화면의 필살 슛 줄)에 `fx.spSpd > 0` 이면 「필살 속도 +n」(n = `fx.spSpd`) ② 필살슛 아이템 카드·상점 줄·보상 카드·도감 상세에 그 등급의 `grade.spSpd[등급]` 이 0 보다 크면 「필살 속도 +n」(위력 가산 표시와 같은 줄) ③ 단위 문구는 붙이지 않는다(숫자만, 설명 최소).

### 13.25 사람끼리 방에서 키운 팀으로 대전 — 엔진 두 좌석 + 방 규칙 「불꽃 팀」 (2차 증분, 2026-11-19 박백엔) — 엔진·서버·데이터. 화면은 후속(윤프론). 결정 analysis/39 D53~D57(가정 B129~B134)

사용자 승인 「내가 키운 선수들을 멀티에서 편성해 다른 유저와 붙어보게」(문기획 권고안 A: 방장이 켠 방에서만, 능력치 보정 없음, 랭크 제외). 박제 슬롯은 읽기 전용이다 — 대전은 슬롯·도전·코인·순위·도감·업적·성장 어디에도 쓰지 않고, 슬롯은 새 도전에 가져가지 못한다(도전 종료 때 영입·장비·아티팩트 초기화 그대로).

**(1) 데이터 스위치** — `run_config.json versusTeam.humans`(boolean, 기본 데이터 true). **false 이거나 키가 없으면 1차 동작**: `rules.flameTeams` 를 받지 않고 버린다(방 규칙에 키가 생기지 않는다), 사람끼리 방의 `set_team{'flame:…'}` 은 `FLAME_TEAM_ROOM`. `flame_catalog.versusTeam.humans` 로 화면이 토글을 숨긴다. `CATALOG_MSG_REV` 16 → 17.

**(2) 방 규칙 `rules.flameTeams`** — `create_room{rules:{…, flameTeams:true}}`·`set_rules{rules:{flameTeams:true|false}}`(방장만, 대기 중. 다른 규칙 칸과 함께 보내도 된다. 생략 = 지금 값).

- 켜진 방에만 `room.rules.flameTeams:true` 가 실린다(`room_state.room.rules`·`room_list.rooms[].rules` 둘 다 — 방 목록 표시용). 꺼져 있으면 키가 없다(종전 모양).
- 거절: 랭크 방 만들기(`create_room{ranked:true, …}`)는 2026-11-20 부터 `LADDER_ONLY`(래더 방은 `set_rules` 자체가 `RANKED_RULES_FIXED`), 공식 규칙과 함께 `FLAME_TEAM_RULES`(허용 방에서 `mode:'official'` 로 바꾸려 해도 같다. 먼저 허용을 끈다 — `{mode:'official', flameTeams:false}` 한 번에 보내도 된다), boolean 이 아닌 값 `RULES_INVALID`. 컴퓨터 대전 방·스토리 방에서는 키를 버린다(컴퓨터 대전 방은 1차대로 언제나 고를 수 있다).
- 바뀌면 상대 준비가 풀린다(종전 규칙 창과 같다). **끄면** 불꽃 팀을 고른 사람(양쪽 모두)의 선택을 풀고 준비를 해제한 뒤 그 사람에게 `toast{code:'FLAME_TEAM_CLEARED'}` 를 1회 보낸다. 좌석 `team` 번호는 주장 칸 몸 출처 팀 그대로 남는다(원작 팀으로 고른 상태).

**(3) 고르기** — 1차와 같은 `set_team{team:'flame:recent'|'flame:best'}`. 허용 방에서는 **두 좌석 모두**(방장·손님) 고를 수 있다. `room_state.slots[i].flameTeam` = 그 사람 슬롯 요약(양쪽에 보인다).

- 준비(D53 (6)): 손님이 고르거나 바꾸면 손님 자신의 준비가 풀린다(1차와 같다). **방장이 불꽃 팀 선택을 바꾸면**(다른 슬롯·슬롯 → 원작 팀·원작 팀 → 슬롯, 같은 슬롯을 다시 골라 요약 `at` 이 바뀐 경우 포함) **손님 준비가 풀린다**. 같은 슬롯·같은 `at` 을 다시 고르면 풀지 않는다.
- 거절은 1차 목록 그대로(`FLAME_TEAM_ROOM` = 허용이 꺼진 사람끼리 방·랭크 방).
- 방 안에서는 슬롯이 바뀌지 않는다: 도전 조작(`flame_new`·`flame_abandon`·`flame_node` 등 `flame_*` 쓰기 전부)은 방에 있으면 `ALREADY_IN_ROOM` 이다(handlers.js `act`·`flame_node`·`flame_practice`). 바뀌는 경우는 **같은 계정의 다른 접속**이 도전을 끝냈을 때뿐이다 → (4) 의 `at` 검사.

**(4) 시작** — `start`(종전). 서버가 **좌석마다 그 사람의 지금 저장값**으로 `versusTeamOf → versusOptions(seat)` 를 다시 계산해 엔진 flame 옵션을 좌석별 배열로 조립한다(클라이언트가 보낸 것은 슬롯 이름뿐. 위조 문자열은 고를 때 `TEAM_INVALID`).

- 고를 때 본 요약의 `at` 과 지금 저장의 `at` 이 다르면 **`FLAME_TEAM_CHANGED` 로 거절**하고 새 요약으로 `room_state` 를 방송한다(손님 준비 해제 → 바뀐 팀을 보고 다시 준비). 슬롯이 없어졌으면 `FLAME_TEAM_NONE`.
- 경기 옵션은 시작 때 `RoomGame` 에 고정된다. 경기 중 저장이 바뀌어도 그 경기는 시작 값으로 돌고, **재접속 `game_start{resumed:true}` 는 같은 값**을 다시 보낸다.
- 경기 조건은 1차와 같다: 시작 HP 최대, 소모품·다음 경기 효과 없음, 치사 생존(P10)은 **좌석(팀)마다** 경기당 `surviveUsesPerMatch`(1)회, 규칙 체력제(`FLAME_TEAM_RULES`), 상대 팀 제외 규칙(D36)은 없다(상대가 사람이 고른 팀). 같은 원작 몸이 양쪽에 설 수 있다(미러전 유니폼 구분은 범위 밖).

**(5) 경기 메시지(사람끼리 방만. 한 좌석만 불꽃 팀이어도 같은 모양)**

| 메시지 | 칸 |
|---|---|
| `game_start.flameVs` | `{mode:'versus', seats:[{seat, fm, allow[], slot} | null, {…} | null]}`(고르지 않은 좌석 = null). `game_start.flame` 키는 없다(도전 경기 표시) |
| `game_start.teams[s]` | 불꽃 팀 좌석은 §12.2 의 flame 팀 정보(`flame:true`·`from`·`hp0`·`sp`·`spOn` 등) — 좌석마다 |
| `game_start.flameCast` | `{versus:true, seats:[{…cast, slot} | null, …]}`(1차의 `{seat, …cast, versus, slot}` 와 다르다: 좌석 칸 `seat` 없음) |
| `game_end.flameVs` | `{seats:[{seat, hp[7], maxHp[7], surviveUsed[]} | null, …]}`(표시용) |

- 끝나면 일반 방과 같다(대기실 복귀, 방·선택 유지). `flame_result`·`flame_end`·`flame_state` 는 오지 않는다. **저장 호출 0회**(영구 저장·도전 상태·순위표·코인·도감·업적·슬롯 불변). 랭크가 아니므로 레이팅도 없다.
- **결과 레코드(`results.jsonl`)는 남긴다**(사람끼리 방의 일반 대전과 같다). 불꽃 팀을 고른 좌석에 `players[i].flameTeam = {slot, at}` 칸이 붙는다. 이 파일은 서버만 쓰고(`store.append`) 어떤 메시지·HTTP 경로로도 나가지 않는다(정적 파일은 `public/` 만).
- 컴퓨터 대전 방(1차)은 그대로: `flameVs:{seat:0,…}`·`flameCast:{seat:0,…}`·`noRecord`(결과 레코드 없음).

**(6) 엔진 옵션 형식(§12.1 추가)** — `flame` 에 종전 단일 객체 대신 **1~2칸 배열**을 줄 수 있다(칸마다 `seat`, 같은 좌석 두 번 = 예외). 좌석마다 `initFlame` 을 따로 거쳐 `Match.fls[좌석]` 에 들어가고, `allow`(해금)·`families`(계열)·`caps`·치사 생존 기록은 **좌석별**이다(합집합 없음 — 남의 고유 슛·계열 가산이 넘어오지 않는다). 훅은 언제나 그 선수의 좌석 값을 읽는다. 두 좌석이면 `info().flame = {seats:[…]}`, `flameResult()` = `[좌석 0, 좌석 1]`. 단일 객체·1칸 배열은 종전과 바이트 단위로 같다(§ 검증: HANDOFF §4-56).

오류 코드(토스트): `FLAME_TEAM_ROOM` 문구 변경 「이 방은 불꽃 팀을 허용하지 않습니다」, 새 `FLAME_TEAM_CHANGED`(「불꽃 팀 기록이 바뀌어 새로 불러왔습니다. 확인 후 다시 시작하세요」), 새 `FLAME_TEAM_CLEARED`(토스트 전용, 「방장이 불꽃 팀 허용을 꺼서 팀 선택이 풀렸습니다」).

화면 후속(윤프론): ① 규칙 창에 「불꽃 팀」 토글(사람끼리 일반 방·`flame_catalog.versusTeam.humans`·체력제일 때만, 랭크 방 숨김) → `set_rules{rules:{flameTeams}}`. ② 방 목록 행에 `rules.flameTeams` 표시. ③ 대기실 상대 좌석의 `slots[i].flameTeam` 요약(구간·승수·핵심 3명) 표시와 손님 쪽 팀 선택 격자의 「최근」「최고」 활성(허용 방). ④ `screens/game.js`: 사람끼리 방은 `flameVs.seats[s]`·`flameCast.seats[s]` 로 좌석별 그리기(선수 이름·skin·필살 안내). 흐름 판별은 여전히 `start.flame` 만. ⑤ 토스트 `FLAME_TEAM_CHANGED`·`FLAME_TEAM_CLEARED`, 문구 바뀐 `FLAME_TEAM_ROOM`. ⑥ 결과 화면의 「최근/최고 보관 팀」 딱지는 `flame_end.summary.teams`(§13.2).

### 13.26 팀 공용 아티팩트 빼기 — 선수별 필살기 아이템 칸 + 팀 포메이션 아이템 칸 (2026-11-19 박백엔) — 서버·데이터. 화면은 후속(윤프론). 결정 analysis/39 D58~D63(가정 B135~B145), 분석 analysis/44

사용자 지시 「아티팩트는 그냥 빼」「각각 선수마다 필살기가 적용되는 구조」. 엔진·엔진 옵션 형식(§12.1)은 그대로다(서버가 선수마다 다른 `sp`·`fx` 를 만들어 넘긴다).

**(1) 스위치** — `decisions.json artifact.model`: `'off'`(기본 데이터) | `'team'`(종전 §13.21·§13.22 그대로). `artifact` 키가 없거나 `model` 키가 없으면 team, `artifact` 가 객체가 아니면(`null` 등) 카탈로그 읽기 오류. 화면은 `flame_catalog.artifact` 로 판별한다.

| `flame_catalog.artifact` 칸 | 뜻 |
|---|---|
| `model` | `'off'` \| `'team'` |
| `slots` | 공용 아티팩트 칸 수(off = 0, team = 3) |
| `refundPoints` | 옛 도전의 A01~A30 1개당 돌려준 경기 포인트(표시용) |
| `hiddenPerm` | off 에서 영구 성장 목록에 없는 항목 id(`['PC03']`). team = `[]` |
| `permText` | off 에서 바뀐 영구 성장 설명 `{PB03: '시작 필살기 아이템(C 등급) 후보 선택권 제공'}`. team = `{}` |

`formationTags[].bonus` = 태그 보너스표 `[{stat, value, from}]`(off 에서 포메이션 아이템을 끼면 `× grade.formation.tagPct[등급]%`, `from` = 옮겨 온 종전 아티팩트 id).

**(2) 새 요청(off 전용. team 에서는 `FLAME_INVALID`)** — 도전 조작 공통 규칙(`act`: 방 안이면 `ALREADY_IN_ROOM`, 도전 없으면 `FLAME_NONE`, 성공하면 `flame_state`).

| 요청 | 칸 | 동작 | 오류 |
|---|---|---|---|
| `flame_sp_item` | `p`(선수 번호 0~6), `id`(보유한 필살슛 아이템 `SP<슛>-<등급>` \| `null` = 빼기) | 끼우면 그 선수 슬롯 = `[아이템 슛, 원작 선수면 고유 슛(같은 슛이면 null)]`. 빼면 아이템 슛이 슬롯에서 빠진다(원작 선수 = 고유 슛, 불씨·클론 = `[null, null]`) | 다른 선수가 낀 아이템 `FLAME_EQUIPPED`(먼저 그 선수에게서 뺀다), 보유하지 않음·필살슛 아이템 아님·잘못된 `p` `FLAME_INVALID` |
| `flame_fm_item` | `id`(보유한 포메이션 아이템 `FM<패턴>-<등급>` \| `null`) | 끼우면 `run.fm` = 그 패턴, 빼면 기본 포메이션(`run_config.json formation.default`, 지금 7) | 보유하지 않음·포메이션 아이템 아님 `FLAME_INVALID` |

바뀐 종전 요청(off):

- `flame_artifact` → 언제나 `FLAME_INVALID`(공용 칸이 없다).
- `flame_special{p, sp}` → 넣을 수 있는 것 = **그 선수가 낀 아이템의 슛 + 그 선수의 고유 슛**. 다른 선수가 낀 아이템의 슛은 `FLAME_LOCKED`. 원작 선수의 주 슬롯은 종전대로 비울 수 없다.
- `flame_formation{fm}` → 기본 포메이션과 `fmItem` 의 패턴만(그 밖 `FLAME_LOCKED`). 보통은 `flame_fm_item` 만 쓰면 된다.
- `flame_perm{id:'PC03'}` → `FLAME_LOCKED`.

**(3) `flame_state` 칸(추가)**

| 칸 | 뜻 |
|---|---|
| `run.roster[i].spItem` | 그 선수가 낀 필살슛 아이템 id. **없으면 키가 없다**(undefined) |
| `run.fmItem` | 팀 포메이션 아이템 id \| `null` |
| `run.artifacts` | off 에서는 언제나 `[null, null, null]` |
| `run.artifactsOwned` | 보유한 필살슛·포메이션 아이템(off 에서는 A 번호가 없다). 끼지 않은 것 = 인벤토리 |
| `team.players[i].spItem` | 계산에 쓰인 그 선수의 아이템 id \| `null` |
| `team.players[i].special` | 종전 칸 그대로. `grade`·`add` 는 **그 선수의 아이템**에서만 온다(다른 선수 아이템의 등급은 붙지 않는다) |
| `team.grant` | off 에서는 `[]`(아무 선수나 넣을 수 있는 슛이 없다) |
| `team.synergies` | off 에서는 `[]` |
| `profile.permList` | off 에서는 `hiddenPerm` 항목이 빠지고, `permText` 항목에 `text`(바뀐 설명)가 붙는다 |

보상·상점 칸 모양은 그대로다(`pending kind 'artifact'`·`node.stock[].kind 'artifact'`, 칸 id 가 SP·FM 아이템뿐). 받은 아이템은 보유로 들어오고 자동으로 끼지 않는다.

**(4) 저장 이관(읽을 때 한 번, 형식 번호 그대로)** — 도전: 낀 SP → 주 슬롯이 그 슛인 첫 선수의 `spItem`, 낀 FM → `fmItem` = team 에서 실제로 쓰이던 아이템(저장된 `fm` 패턴의 아이템, 없으면 기본 포메이션 패턴의 아이템, 둘 다 없으면 `null` — 그래서 `run.fmItem` 과 `team.fmItem`·`run.fm` 이 언제나 짝이 맞고 쓰던 패턴·태그가 이어진다), 3칸 비움, A01~A30 버림 + 1개당 `refundPoints` 경기 포인트, 풀지 않은 선택·열린 상점의 A 번호 칸 제거(빈 선택은 통째로). 단 풀지 않은 시작 보상(PB03, `nodeType 'start'`)이 A 번호뿐이었으면 같은 칸 수의 시작 필살기 아이템 후보(출처 start, 결정적 난수)로 바꿔 넣는다. 영구 저장: PC03 산 단계 비용 합을 코인으로 한 번 환불 + 단계 삭제, `profile.artV` 1(중복 방지). 새 계정은 off 에서 만들면 `artV` 1, team 에서 만들면 표시 없이 시작한다(team 에서 산 PC03 은 off 로 바꿀 때 한 번 환불). 키운 팀 슬롯: 옛 슬롯은 쓸 때 이관해 읽고 저장 칸은 그대로, 새 슬롯은 `roster[i].spItem`·`fmItem` 을 담는다. 되돌린 서버는 `spItem`·`fmItem`·`artV` 를 버린다(이관된 도전은 아무것도 끼지 않은 상태로 읽힌다).

**(5) `CATALOG_MSG_REV` 17 → 18** — `cat.ver` 끝이 `.m18` 이 된다. off 이면 그 앞에 `.aoff` 가 든다(예 `1.1.1.7.o3.p2.e1.aoff.m18`, team 은 그 칸이 없다) — 데이터 버전이 같아도 off↔team 을 바꾸면 클라이언트가 카탈로그를 다시 받는다(개정 번호는 그대로). 구 클라이언트는 `catalogVer` 가 달라 카탈로그를 다시 받는다. 다시 받아도 `artifact` 칸을 모르는 구 화면은 아티팩트 탭을 그대로 보여 주고, 장착을 누르면 `FLAME_INVALID` 토스트가 난다(상태는 바뀌지 않는다). 선수별 칸을 낄 방법이 없으므로 화면 갱신 전에는 아이템이 보유로만 쌓인다.

**배포 순서 주의(정검수 R1)**: 기본 데이터가 이미 `'off'` 다. **3300 재시작은 화면(`public/`) 반영과 함께** 한다. 화면이 반영되지 않은 채 서버만 재시작하면 옛 도전을 처음 읽는 순간 A01~A30 이 환급 처리되고(되돌릴 수 없다) 공용 3칸에 끼어 있던 필살기 아이템은 주 슬롯이 그 슛인 첫 선수에게만 남는데, 화면에서는 그것을 보거나 다시 낄 방법이 없다. 화면 반영이 늦어지면 서버만 먼저 올릴 때는 `artifact.model` 을 `'team'` 으로 두고 올린다(이관은 off 에서만 일어난다).

화면 후속(윤프론): ① 선수 칸마다 「필살기 아이템」 1칸(보유 SP 아이템 목록, 다른 선수가 낀 것은 표시·`FLAME_EQUIPPED` 토스트), ② 팀 「포메이션 아이템」 1칸(`flame_fm_item`), ③ `artifact.model === 'off'` 면 아티팩트 탭·공용 3칸·시너지 표시를 숨긴다, ④ 영구 성장 목록은 `permList` 그대로(PC03 없음, PB03 은 `text`), ⑤ 도감 아티팩트 기록은 그대로 표시해도 된다.

### 13.27 카탈로그 슛별 기본 위력 + 상점 칸·값 조정 (2026-11-20 박백엔) — 서버·데이터. 화면은 후속(윤프론). 결정 analysis/39 D65, 하플레이 M2·M3

**(1) `flame_catalog.special.power`(추가 칸)** = 슛 ID 를 번호로 하는 배열(길이 54) = `server/data/specials.json power[슛 ID]`(필살 투구 때 엔진이 공 위력으로 쓰는 표값, 등급 가산 `grade.spPow`·장비·포메이션 가산을 더하기 전). 표값 255(일반 투구 계산값을 쓰는 ID 0·16·30·32·38·46·47, 아이템·고유 슛으로 나오지 않는다)는 `null`. 화면은 `power[id] + grade.spPow[등급]` 으로 카드의 기본 위력을 그릴 수 있다.
- **속도 칸은 없다**: 슛별 투구 속도 표가 데이터에 없다. 필살 공의 속도 = 던진 선수의 구속(`s6`)·차지·공중/대시에서 계산한 일반 투구 속도 + 등급 `grade.spSpd` 이고, 궤적 핸들러(`server/engine/special.js`)가 슛마다 배수(1.5배·1배·0.5배·가감속)만 바꾼다 — 선수와 무관한 단일 값이 아니다.

**(2) 상점(D65, 데이터만)**: 상점 아이템(필살슛·포메이션) 칸 `run_config.shop.artifactSlots` 1 → 2, 상점가 `grade.price.shop` C 120 · B 200 · A 320 · S 600(종전 180·280·420·600), 상점 유형 `artifact.off.shopKinds` shot 75 · formation 25(종전 60·40). 메시지 모양은 그대로(`flame_catalog.grade.price`·`flame_state.run.node.stock[]` 의 값만 바뀐다). 이미 열린 상점(`run.node.stock`)은 저장된 값 그대로다.

**(3) `CATALOG_MSG_REV` 18 → 19** — `cat.ver` 끝이 `.m19`(예 `1.1.1.7.o3.p2.e1.aoff.m19`). 캐시된 카탈로그는 종전대로 문자열 비교로 다시 받는다.

화면 구현됨(artLine, 윤프론): `store.js artLine` 에서 C 등급 필살 카드의 기본 위력 = `cat.special.power[grant.shot]`(+ 등급 가산), `null` 이면 표시하지 않는다.

## 14. 채팅·관리자 공지 — 서버 2026-11-20 박백엔. 설계 analysis/49_chat_admin_notice.md, 화면은 후속(윤프론, 시안 `Works/_asset_samples/tongki_chat_mock/`)

구현 `server/chat/chat.js`(처리기·정리·빈도·판정, `makeChatHandlers` 를 `lobby.js` 처리기 사전에 펼침), 욕설 목록 `server/data/chat_badwords.json`. 경기 엔진·입력 프로토콜은 바뀌지 않는다(채팅은 경기 틱 메시지에 섞이지 않는 별도 메시지).

### 14.1 채팅
- 요청 `{t:'chat', text}`. **사람끼리 방에서만**(대기실·경기 중 모두): 일반 방, 불꽃 팀 허용 방, 래더 방(경기 전·중). 판정 = 방에 있고 `vsCpu`·`campaign`·`training`·`league`·`flame` 이 아님. 그 밖(로비, 컴퓨터 대전, 스토리, 특훈, 리그, 불꽃의 계승 도전)은 `CHAT_UNAVAILABLE`. **로비 전체 채팅은 없다.**
- 받는 사람 = 그 방 좌석 두 사람(보낸 본인 포함, 혼자 기다리는 중이면 본인만): `{t:'chat', from:<닉네임>, text:<정리된 글>, at:<서버 epoch ms>, admin?:true}`. `admin:true` = 보낸 사람이 관리자 계정. 화면에 그린 순서 = 받은 순서. 지난 채팅 재전송(재접속·입장 때)은 없다.
- `room_joined.room`·`room_state.room` 의 `chat:true`(읽기 전용) = 이 방에서 채팅할 수 있다. 없으면 입력창을 숨긴다.
- 글 정리(서버, 공지도 같다): 문자열이 아니면 `BAD_MESSAGE`. 제어 문자 U+0000~001F·U+007F~009F, 0폭·방향 표식 U+200B~200F, 양방향 U+202A~202E·U+2066~2069, U+FEFF, 짝 없는 대리 문자를 공백으로 -> NFC -> 연속 공백(줄바꿈 포함)을 하나로 -> 앞뒤 공백 제거. 그 뒤 코드포인트 수 0 = `CHAT_EMPTY`, `CHAT_MAX`(기본 60) 초과 = `CHAT_TOO_LONG{params:{max}}`.
- 욕설: 목록 단어가 들어 있으면 그 글자를 `*` 로 바꿔 보낸다(거절하지 않는다, 대소문자 무시). 공지에는 적용하지 않는다.
- 빈도(세션당, 통과한 글만 센다): 직전 글과 `CHAT_MIN_GAP_MS`(1000) 미만, `CHAT_WINDOW_MS`(10000) 안 `CHAT_BURST`(5)개 초과, 같은 글 연속 3번째 = `CHAT_RATE_LIMITED`.
- 손님: 기본 허용. `CHAT_GUEST=0` 이면 손님 `chat` = `ACCOUNT_REQUIRED`.
- **서버는 HTML 이스케이프를 하지 않는다**(`<`·`&` 등 원문 그대로). 화면은 반드시 `textContent`(또는 캔버스 텍스트)로 그린다. `innerHTML` 금지.

### 14.2 관리자 공지
- **목록에는 반드시 먼저 가입한 계정만 넣는다**(2026-11-20 리뷰 M1, 확정 닉네임 `운영자` = `ADMIN_ACCOUNTS=운영자`): 서버 시작 때 목록의 각 닉네임이 `accounts` 에 있는지 확인해, 있으면 로그 `[admin] 관리자 계정 확인: <닉네임> (가입 <ISO 시각>)`(운영자가 본인이 가입한 시각인지 확인), 없으면 경고 로그를 남기고 **그 항목은 이번 실행 동안 비활성**(뒤에 계정이 생겨도 재시작 전에는 관리자가 아니다). 목록에 있는 닉네임의 `register` 는 `NICK_TAKEN` 으로 거절한다(미가입 관리자 닉네임 선점 방지 — 가입은 목록에 넣기 전, 목록 없이 띄운 서버에서 한다).
- 관리자 = 서버 환경변수 `ADMIN_ACCOUNTS`(쉼표 목록, 시작 때 NFC·소문자로 정리) 안의 **비밀번호 계정** 세션(위 확인을 통과한 항목만). 손님 세션은 같은 닉네임이어도 관리자가 아니다(가입된 닉네임의 손님 `hello` 는 원래 `NICK_REGISTERED`). 빈 값 = 공지 꺼짐(누구나 `NOT_ADMIN`). 판정은 `notice_send` 마다 서버가 다시 하고 클라이언트가 보낸 값은 보지 않는다.
- 요청 `{t:'notice_send', text}` — 위치 무관(로비·대기실·경기 중). 관리자가 아니면 `NOT_ADMIN`(아무에게도 가지 않는다). 글 정리는 §14.1 과 같고 상한 `NOTICE_MAX`(100), 욕설 가림 없음. 빈도 3초에 1개·분당 10개 초과 = `NOTICE_RATE_LIMITED`.
- 전달 `{t:'notice', id, text, at}` — 그 순간 **연결된 세션 전원**(보낸 관리자 포함, 로비·대기실·사람끼리 경기·컴퓨터 경기·스토리·특훈·리그·불꽃 도전 중 모두). 끊겨 유예 중인 세션·로그인 전 연결은 받지 않고, 나중에 접속한 사람에게 다시 보내지 않는다. `id` 는 서버 시작부터 1씩 는다(재시작하면 1부터) — 같은 `id` 를 두 번 그리지 않는 데만 쓴다. 화면은 중앙(시안 D2/D5/D8)에 `textContent` 로 표시.
- 기록: 서버 로그 `[notice] #id key: "text"` + `NOTICE_PATH`(기본 `data/notices.jsonl`) 한 줄 `{at, by:<계정 키>, text}` 추가. 기록 실패는 로그만 남기고 공지는 보낸다. `node --test` 안에서 `NOTICE_PATH` 가 없으면 파일에 쓰지 않는다.

### 14.3 환경변수 (`server/net/limits.js`)
| 이름 | 기본 | 뜻 |
|---|---|---|
| `ADMIN_ACCOUNTS` | (빈 값) | 관리자 계정 닉네임 쉼표 목록. 빈 값 = 공지 꺼짐 |
| `CHAT_GUEST` | 1 | 0 이면 손님 채팅 거절(`ACCOUNT_REQUIRED`) |
| `CHAT_MAX` / `NOTICE_MAX` | 60 / 100 | 정리 후 최대 글자(코드포인트) |
| `CHAT_MIN_GAP_MS` / `CHAT_BURST` / `CHAT_WINDOW_MS` | 1000 / 5 / 10000 | 채팅 빈도 |
| `NOTICE_PATH` | `data/notices.jsonl` | 공지 기록 파일(프로젝트 루트 기준 상대 경로 가능) |

### 14.4 화면 메모(윤프론)
- 채팅 로그는 **최대 5줄**(오래된 줄부터 밀어낸다). 방을 나가면(`room_left`) 비운다. 경기 중 입력창은 경기 입력과 겹치지 않게(Enter 로 열고 닫기 등, 시안 참조).
- 관리자(`welcome.admin`/`account_ok.admin`)만 공지 입력(로비 입력줄·채팅 입력창의 공지 토글)을 그린다. 오류는 전부 토스트.
