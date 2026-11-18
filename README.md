# 피구왕 통키 웹 (dodge-danpei)

원작 롬 분석을 바탕으로 만든 2인 온라인 피구 대전. Node.js 서버(권위 서버, 60Hz 결정적 엔진) + 웹 클라이언트(`public/`).
프로토콜은 `docs/PROTOCOL.md`, 규칙은 `docs/SPEC.md`, 수치는 `server/data/rules.json` 참고.

## 로컬 실행
**Node 22.5 이상**(내장 SQLite `node:sqlite` 사용, 새 npm 의존성 없음). 22.13 이상 권장, 22.5~22.12 는 `node --experimental-sqlite server/index.js` 로 실행(pm2: `pm2 start server/index.js --name dodge-danpei --node-args="--experimental-sqlite"`). `node:sqlite` 를 못 쓰면 "이 서버는 Node 내장 SQLite(node:sqlite)가 필요합니다 ..." 문구를 내고 종료한다(개발 확인 Node 25.7).
```
npm install
npm start          # http://localhost:3100
```
`GET /health` 로 상태 확인.
pm2 로 띄울 때: `PORT=3100 pm2 start server/index.js --name dodge-danpei` (프로젝트 루트에서 실행).
Node 22.5~22.12 서버(시작 로그에 `node:sqlite` 오류)는 플래그를 붙인다: `pm2 start server/index.js --name tongki --node-args="--experimental-sqlite"` (이름은 서버의 기존 pm2 이름에 맞춘다. 이미 등록된 프로세스는 `pm2 delete <이름>` 뒤 다시 start, ecosystem 파일이면 `node_args: "--experimental-sqlite"`). Node 22.13 이상이면 플래그 불필요.

## 테스트
```
npm test
```

## 환경변수
| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 3100 | 수신 포트 |
| `HOST` | (미사용) | 현재 코드는 읽지 않는다. 모든 인터페이스에서 수신 |
| `TRUST_PROXY` | 없음 | 값이 있으면 `X-Forwarded-For` 마지막 값을 클라이언트 IP로 사용(리버스 프록시 뒤에서만 설정) |
| `RESULTS_PATH` | `data/results/results.jsonl` | 경기 결과 JSONL 저장 경로 |
| `DB_PATH` | `data/tongki.db` | SQLite DB(계정·로그인 토큰 해시·캠페인 진행·리그·랭킹). WAL 모드라 옆에 `-wal`·`-shm` 파일이 생긴다 |
| `REQUIRE_ACCOUNT` | 0 | `1` 이면 닉네임만으로 접속 불가(가입·로그인 필수). 기본 0 = 종전 방식 + 가입한 닉네임만 비밀번호 보호. 전환은 사용자 승인 뒤 |
| `PROGRESS_PATH` / `LEAGUE_PATH` | `data/progress/progress.json` / `league.json` | 옛 JSON 저장. 서버 시작 때 SQLite 로 한 번 가져온다(멱등, 원본 보존) |
| `JSON_BACKUP_DIR` | `<DB 폴더>/backup/json_before_sqlite` | 처음 가져올 때 JSON 원본 사본을 두는 곳 |
| `MAX_LEAGUE_PER_MIN` | 200 | 세션당 분당 리그 요청 |
| `MAX_AUTH_PER_MIN` | 10 | IP당 분당 가입·로그인 |
| `LOGIN_FAIL_NICK` / `LOGIN_FAIL_IP` / `LOGIN_LOCK_MS` | 5 / 20 / 900000 | 15분 안 로그인 실패 횟수((닉네임, IP) 쌍 / IP) 넘으면 잠금, 잠금 시간. 닉네임 단독 누적은 잠그지 않고 `LOGIN_FAIL_NICK` 회부터 늦춘다 |
| `LOGIN_SLOW_STEP_MS` / `LOGIN_SLOW_MAX_MS` | 1000 / 10000 | 닉네임 단독 실패 누적 시 시도당 응답 지연 증가분 / 상한 |
| `MAX_CONN_PER_IP` | 20 | IP당 동시 연결 |
| `MAX_HELLO_PER_MIN` | 60 | IP당 분당 로그인 시도 |
| `MAX_SESSIONS` | 2000 | 최대 세션 |
| `MAX_ROOMS` | 1000 | 최대 방 |
| `LOGIN_TIMEOUT_MS` | 30000 | 미로그인 연결 유지 시간 |
| `MAX_PAUSE_MS` | 90000 | 경기당 좌석별 누적 일시정지 상한 |
| `MAX_DISCONNECTS` | 5 | 경기당 좌석별 끊김 횟수 상한 |

## 데이터 백업·복구 (SQLite)
- 서버를 멈춘 뒤 `data/tongki.db`(+ 있으면 `tongki.db-wal`·`tongki.db-shm`)를 함께 복사하면 된다. 서버를 켠 채 복사하려면 `sqlite3 data/tongki.db ".backup backup.db"` 처럼 SQLite 백업 명령을 쓴다(파일만 복사하면 WAL 내용이 빠질 수 있다).
- 복구: 서버를 멈추고 백업 파일을 `DB_PATH` 위치에 놓고 시작.
- 옛 JSON 으로 되돌리기: `_backup/accounts_sqlite_before/` 의 코드로 되돌리면 `data/progress/*.json` 을 다시 쓴다(가져오기는 JSON 을 지우거나 바꾸지 않는다. 단 SQLite 로 옮긴 뒤 쌓인 진행·계정·랭킹은 JSON 에 없다).
- 가져오기 수동 시험(복사본으로): `node server/store/migrate.js --db <임시.db> --progress <복사한 progress.json> --league <복사한 league.json>`.
- 한계: 키별 가져오기 표식(`json_imported:*`)이 생기기 전 버전으로 이미 가져온 DB 에는 그 표식이 없다. 그런 DB 에서 리그 포기·손님 데이터 분리 보존으로 지워진 행은 JSON 파일이 바뀐 뒤 첫 재가져오기에서 한 번 다시 들어올 수 있다(그 뒤로는 표식이 남아 부활하지 않는다. 계정 키는 언제나 건너뛴다).

## 주의
- **배포 필수**: ① 리버스 프록시 뒤에서는 반드시 `TRUST_PROXY=1`(빠뜨리면 전원이 프록시 IP 하나로 보여 로그인 잠금·가입/로그인 레이트 리밋·IP당 연결 상한을 함께 쓴다 = 한 사람 실패로 전원 잠김). ② Node 22.5 이상, 22.5~22.12 는 `--experimental-sqlite`(위 pm2 예시). ③ 공개 시 `wss://`(TLS) 필수. ④ POSIX 에서 DB 파일은 시작 때 권한 0600 으로 좁힌다(Windows 는 건너뜀).
- 검증·테스트 스크립트는 `DB_PATH`·`PROGRESS_PATH`·`LEAGUE_PATH`·`RESULTS_PATH`·`JSON_BACKUP_DIR` 를 전부 임시 경로로 준다(기본값이면 운영 `data/` 에 `tongki.db` 가 생긴다).
- 가입(닉네임+비밀번호)은 선택이다(`REQUIRE_ACCOUNT=0`). 가입하지 않은 닉네임은 종전처럼 닉네임이 곧 신원이다. 비밀번호가 평문으로 오가므로 공개 배포는 반드시 TLS(`wss://`) 프록시 뒤에서. 공개 배포 시 프록시(TLS, `/ws` 업그레이드 허용)를 앞단에 둘 것.
- `TRUST_PROXY`를 프록시 없이 켜면 클라이언트가 IP를 위조해 연결 제한을 우회할 수 있다.
- 결과 파일 경로는 쓰기 가능한 영속 디스크로 지정한다.
- 서버는 단일 프로세스 메모리에 방/세션을 둔다(수평 확장 불가).
