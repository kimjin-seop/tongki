# 피구왕 통키 웹 (dodge-danpei)

원작 롬 분석을 바탕으로 만든 2인 온라인 피구 대전. Node.js 서버(권위 서버, 60Hz 결정적 엔진) + 웹 클라이언트(`public/`).
프로토콜은 `docs/PROTOCOL.md`, 규칙은 `docs/SPEC.md`, 수치는 `server/data/rules.json` 참고.

## 로컬 실행
Node 20 이상.
```
npm install
npm start          # http://localhost:3100
```
`GET /health` 로 상태 확인.
pm2 로 띄울 때: `PORT=3100 pm2 start server/index.js --name dodge-danpei` (프로젝트 루트에서 실행).

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
| `PROGRESS_PATH` / `LEAGUE_PATH` | `data/progress/progress.json` / `league.json` | 캠페인 진행·리그 JSON 저장 경로 |
| `MAX_LEAGUE_PER_MIN` | 200 | 세션당 분당 리그 요청 |
| `MAX_CONN_PER_IP` | 20 | IP당 동시 연결 |
| `MAX_HELLO_PER_MIN` | 60 | IP당 분당 로그인 시도 |
| `MAX_SESSIONS` | 2000 | 최대 세션 |
| `MAX_ROOMS` | 1000 | 최대 방 |
| `LOGIN_TIMEOUT_MS` | 30000 | 미로그인 연결 유지 시간 |
| `MAX_PAUSE_MS` | 90000 | 경기당 좌석별 누적 일시정지 상한 |
| `MAX_DISCONNECTS` | 5 | 경기당 좌석별 끊김 횟수 상한 |

## 주의
- 인증이 없는 닉네임 기반이다. 공개 배포 시 프록시(TLS, `/ws` 업그레이드 허용)를 앞단에 둘 것.
- `TRUST_PROXY`를 프록시 없이 켜면 클라이언트가 IP를 위조해 연결 제한을 우회할 수 있다.
- 결과 파일 경로는 쓰기 가능한 영속 디스크로 지정한다.
- 서버는 단일 프로세스 메모리에 방/세션을 둔다(수평 확장 불가).
