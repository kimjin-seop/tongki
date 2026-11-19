# 44. 불꽃의 계승 — 팀 공용 아티팩트 빼기, 필살기는 선수별로

작성 2026-11-19, 박백엔(분석 = 문기획, 구현 = 박백엔). 결정 = `analysis/39` D58~D63(구현 가정 B135~B145), 요청·응답 = `docs/PROTOCOL.md` §13.26, 인수인계 = `docs/HANDOFF.md` §4-64.

## 1. 사용자 지시와 확정 원칙

- 지시: 「아티팩트에서 슛을 끼면 모든 선수에게 슛이 적용되는데 그게 아니라 슛 기능이 있는 아이템이 나오는 구조임. 아티팩트는 그냥 빼」, 「각각 선수마다 필살기가 적용되는 구조야」.
- 원칙: 필살기 아이템(`SP<슛>-<등급>`)은 그 아이템을 낀 **선수 한 명에게만** 적용된다. 팀 공용 아티팩트(3칸, A01~A30)는 모드에서 뺀다.
- 방식: 문기획 안 1. **데이터 스위치로 끄고**(`decisions.json artifact.model = 'off'`), 필살기 아이템은 선수 칸으로 옮긴다. `artifacts.json`(30종)과 아티팩트 코드는 남긴다. `'team'` 으로 바꾸면 이전 동작이 돌아온다.
- 엔진(`server/engine/*`)은 고치지 않았다. 엔진은 서버가 넘기는 `allow`·선수별 `sp`·`fx` 만 받고, 선수별 적용은 서버가 그 값을 선수마다 다르게 만들어서 처리한다.

## 2. 무엇이 이미 선수별이었고 무엇이 전원 적용이었나(문기획 분석 요지)

| 구분 | 내용 | 위치(변경 전) |
|---|---|---|
| 이미 선수별 | 엔진은 선수마다 주 슬롯 `sp[0]` 만 보고 쏜다 | `flame.js` flActiveId |
| 이미 선수별 | `fx` 위력·속도 가산(E1 `flSpSpd` 포함), 장비 효과, 원작 선수 고유 슛 잠금, 사람끼리 대전 좌석별 계산(D54), `capSpecialFx` | `stats.js:70-76`, `items.js:204-212` |
| **전원 적용(고칠 대상)** | 낀 SP 아이템의 슛 목록이 팀 공용이라 아무 선수나 슬롯에 넣을 수 있었다 | `allowOf(run.artifacts)` `stats.js:34-42`, `items.js:207` |
| **전원 적용** | 아티팩트를 끼면 슬롯이 빈 선수 전원에게 그 슛이 자동으로 들어갔다(영입 선수 포함) | `items.js:193-196`, `stats.js:95-99`, `nodes.js:168` |
| **전원 적용** | 등급 위력·속도 가산이 팀 전체에 붙었다(B118 「전원 +35」) | `stats.js:296-302` |
| **전원 적용** | A01·A07·A08 투구 효과와 시너지가 7명 전원에게 더해졌다 | `stats.js:269·285` |
| **전원 적용** | 키운 팀 대전에서도 슬롯이 빈 선수 전원에게 채웠다 | `teams.js:129-133` |

## 3. 아티팩트가 닿는 곳(전수)

- 데이터: `artifacts.json`(30종), `synergies.json`(7종 전부 아티팩트 조건), `run_config.json`(시작·보스 보상 칸 수, 상점 칸·값 280, `unlocks.defaultArtifactsExcept`, PC03, 이벤트 E05 `gainArtifact`), `perm_upgrades.json`(PB03 전술 연구, PC03 신규 아티팩트 해금), `rules.json`(`team.artifactSlots` 3, 능력치 5단계), `decisions.json`(`grade.drop.bossKinds·shopKinds·emptyAsTeam`, `grade.price`), `endless.json`(`artifactFallbackPoints`), `effect_types.json`.
- 서버: `catalog.js`(`isTeamArtifact`·`buildGrade`·30종 검사·시너지 검사·PC03 검사), `items.js`(아티팩트 보유·장착·슬롯 맞추기·필살기 슬롯), `rewards.js`(후보·상점값·보상 칸 수), `stats.js`(부여·해금·5~7단계·등급 가산), `run.js`(새 도전·시작 보상·보스 보상·첫 승리·재선택·포메이션·정산), `nodes.js`(상점·영입·이벤트), `save.js`(보유·장착·선택 정리), `handlers.js`(`flame_artifact`·카탈로그), `teams.js`(스냅샷 `arts`).
- 도구·시험: `validate_data.mjs`(30종 고정·시너지·기획 대조 「공용 아티팩트 슬롯: 3개」), `check_icons.mjs`, `sim_balance.mjs`·`sim_versus.mjs`, `test/flame_{grade,stats,special,run,endless,postbalance,data,perm,versus_team}`.

## 4. 대체 매핑

| 종전 | 종류 | 바뀐 뒤(off) |
|---|---|---|
| A01~A06 필살기 계열 | 필살기 | 등급제에서 이미 새로 나오지 않았다(D40). 대체품은 SP 아이템 188종. 바뀐 것은 보유·장착 위치다: **선수마다 필살기 아이템 칸 1칸 `roster[i].spItem`** |
| A07·A08 필살 위력 | 필살기 | 삭제(장비 쪽에 필살 위력 옵션이 있다) |
| A09·A10·A12~A17 포메이션 강화 | 포메이션 | 수치를 **태그 보너스표**(`formation_tags.json tags[].bonus`)로 옮겼다. 포메이션 아이템을 끼면 「태그 보너스 × 등급 배율(C50/B100/A150/S200 %)」 |
| A11 주장 완장·A18 전술 교본 | 포메이션 | 삭제 |
| A19~A27 팀 능력치 | 팀 강화 | 삭제 |
| A28·A29 보상 칸 추가, A30 시너지 강화 | 팀 강화 | 삭제 |
| 시너지 7종 | — | 같이 꺼진다(D10·D47 은 off 에서 효과 없음) |

필살기 아이템 규칙(off):

- 그 선수의 주 슬롯 = 낀 아이템의 슛. 원작 선수가 아이템을 빼면 고유 슛으로 돌아가고, 불씨·클론은 「필살기 없음」이 된다.
- 등급 위력·속도 가산은 **낀 선수에게만** 붙는다(B118 「전원 +35」 폐기).
- **아이템 하나는 한 선수만 낀다.** 같은 슛은 최고 등급 하나만 가진다는 규칙(D39)이 그대로라서 **같은 슛은 한 번에 한 선수만** 쓸 수 있다. 원작 선수의 고유 슛은 예외로, 그 선수 자신의 것이라 다른 선수가 같은 슛 아이템을 껴도 겹칠 수 있다.
- 상위 등급을 얻으면 낮은 등급은 자동 판매되고, 끼고 있던 선수에게 새 등급이 그대로 들어간다.
- **포메이션 아이템은 팀 1칸 `run.fmItem`** 으로 남겼다. 포메이션은 팀 전체 개념이라 선수별로 나눌 수 없다.

## 5. 보상 경로 대체(전부 데이터, `decisions.json artifact.off`)

| 경로 | 종전(team) | 바뀐 뒤(off) |
|---|---|---|
| 보스 보상 3지선다 | 필살슛 · 포메이션 · 팀 강화(`grade.drop.bossKinds`) | `artifact.off.bossKinds` = 필살슛 · 필살슛 · 포메이션. 낼 것이 없는 칸은 빼고(`emptyAsTeam` 은 쓰지 않는다), 셋 다 비면 엔드리스 `artifactFallbackPoints`(150) 포인트 |
| 시작 보상(PB03 전술 연구) | 팀 강화 1+단계 개 | 필살슛 아이템 1+단계 개, 등급 출처 `startGrade` = `firstWin`(C 100%) |
| 상점 아티팩트 칸 | 유형 가중치 shot 50 / formation 30 / team 20 | `artifact.off.shopKinds` shot 60 / formation 40. 값은 등급별 180~600 그대로 |
| 이벤트 E05 | 팀 강화 1개 | 필살슛 아이템 1개, 등급 출처 `eventGrade` = `shop` |
| 첫 승리 보상 | 필살슛 C 3지선다 | 그대로 |
| A28·A29 보상 칸 추가 | 있음 | 없음 |

## 6. 저장 호환(읽을 때 한 번 이관, 저장 형식 번호는 그대로)

- **도전 저장**(`save.js sanitizeRun`, off 일 때):
  - 보유(`artifactsOwned`)의 SP·FM 아이템은 그대로 보유로 남는다.
  - 낀 3칸의 SP 아이템은 **주 슬롯이 그 슛인 첫 선수**에게 끼운다. 같은 슛을 넣었던 나머지 선수는 슬롯이 비고, 원작 선수는 고유 슛으로 돌아간다. 주 슬롯이 그 슛인 선수가 없으면 끼지 않은 채 보유로 남는다.
  - 낀 FM 아이템은 `fmItem` 으로 옮긴다: team 에서 실제로 쓰이던 것(저장된 `fm` 패턴의 아이템, 없으면 기본 포메이션 패턴의 아이템, 둘 다 없으면 없음, B146). 옮긴 뒤 3칸은 비운다.
  - 손으로 쓴 아티팩트(A01~A30)는 버리고 **1개당 `artifact.refundPoints`(80) 경기 포인트**를 돌려준다. 버린 뒤 저장되면 다시 돌려줄 것이 없으니 한 번만 돌려준다.
  - 풀지 않은 아티팩트 선택(`pending kind 'artifact'`)에서 A 번호 칸을 빼고, 그래서 비면 선택을 통째로 뺀다. 단 시작 보상(PB03)이면 같은 칸 수의 시작 필살기 아이템 후보로 바꿔 넣는다(B147). 열려 있는 상점의 A 번호 칸도 뺀다.
- **영구 저장**(`sanitizeProfile`): `artifact.hiddenPerm`(PC03)의 이미 산 단계는 그 단계 비용 합(300 / 900)을 **코인으로 한 번 돌려주고** 단계를 지운다. `profile.artV` = 1 이 중복 환불을 막는다(permV 와 같은 방식). PC03 은 영구 성장 목록(`permList`)에서 빠지고, 사려고 하면 `FLAME_LOCKED`. PB03 은 이름은 그대로이고 뜻이 「시작 필살기 아이템 후보」로 바뀐다(`artifact.off.permText`). 도감의 아티팩트 기록은 버리지 않는다.
- **키운 팀 슬롯**(`teams.js`): `spItem`·`fmItem` 이 없는 옛 슬롯은 쓸 때 같은 규칙으로 바꿔 읽고, 저장된 칸은 고치지 않는다(B92 방식). 새 슬롯에는 `roster[i].spItem`·`fmItem` 을 담는다.

## 7. 구현 분할(이번에 한 순서)

1. 스위치(`catalog.js buildArtifactModel`·`teamArtifactsOn`)와 `spItem`·`fmItem` 필드.
2. `stats.js`: `spItemShot`·`teamWornOf`·`migrateWorn`, `engineAllow`(전 선수 아이템 슛 + 고유 슛의 합, 종전과 같은 방식), `cleanSp`(선수마다 자기 아이템의 슛만), `initialSpecials`(자동 배정 없음), `activeSynergies`(off = 없음), `computeTeam`(5단계 0, 태그 보너스표, 선수별 등급 가산).
3. 새 요청 `flame_sp_item`·`flame_fm_item`(`items.js setSpItem·setFmItem`), off 에서 `flame_artifact` 는 `FLAME_INVALID`.
4. 보상·상점·이벤트·시작 보상(`rewards.js itemChoices`, `run.js`·`nodes.js` 가 출처를 넘긴다).
5. 저장 이관·스냅샷(`save.js`, `teams.js`).
6. 태그 보너스표(`formation_tags.json tags[].bonus`).
7. 도구: `validate_data.mjs`(`--artifact-model=off|team`, 태그 보너스 출처 대조), `sim_balance.mjs`·`sim_versus.mjs`(`--artifact=off|team`, off 봇 배치 `arrangeOff`), `loadCatalog({patch})`.
8. 문서: PROTOCOL §13.26, 39 D58~D63·B135~B145, HANDOFF §4-64, 이 문서.

## 8. 밸런스 영향(예상)과 재측정 요청

- 팀 화력이 크게 떨어진다. 필살기가 전원에서 아이템을 낀 몇 명으로 줄고, 등급 가산도 한 명에게만 붙고, 팀 강화 아티팩트(공격 +2·HP +8·방어 +1 등)와 시너지가 없어진다.
- 대충 잰 값(측정 전용, 확정 아님): `sim_balance run --n=20 --perm=mid`(엔드리스 끔, bot 2) 평균 승수 off **4.90**/12 · 우승 0/20, team **6.10**/12 · 우승 2/20. 표본이 작아 방향만 본다.
- **임밸런 재측정 요청**: (1) off 기본 측정 `run --perm=none|mid|full`, 엔드리스 켬·끔 둘 다(+0 승률 40~60% 기준), (2) 보상 유형 `artifact.off.bossKinds`·`shopKinds`·상점값, (3) 태그 보너스표 수치와 등급 배율(A09~A17 값을 그대로 옮겼다), (4) 등급 가산 `grade.spPow`·`spSpd`(이제 한 명 몫), (5) `refundPoints` 80, (6) 봇 배치 정책 `arrangeOff`(위력 큰 아이템부터 지금 필살 위력이 가장 낮은 선수에게), (7) 키운 팀 대전(`sim_versus`) 격차.

## 9. 남은 것·위험

- 화면(윤프론): 선수 칸에 필살기 아이템 칸, 팀 포메이션 아이템 칸, 아티팩트 탭 숨김(`flame_catalog.artifact.model === 'off'`), PC03 숨김·PB03 문구(`permList[].text`). 화면이 바뀌기 전에는 off 에서 아이템을 낄 방법이 없다(보유만 늘어난다). 서버 변경은 사용자 승인 뒤 3300 을 재시작해야 반영된다.
- **배포 순서(정검수 R1)**: 기본 데이터가 이미 `'off'` 라서 화면(`public/`) 반영 없이 3300 만 재시작하면 옛 도전의 A01~A30 이 되돌릴 수 없게 환급되고 공용 3칸 필살기 아이템은 첫 선수에게만 남는데 화면으로는 다시 낄 수 없다. **재시작은 화면 반영과 함께**, 서버만 먼저 올릴 때는 `artifact.model = 'team'`.
- 서버를 이 기능 전으로 되돌리면 `spItem`·`fmItem`·`artV` 는 버려진다. 이관된 도전은 아무것도 끼지 않은 채 읽히고, 돌려준 포인트·코인은 되돌리지 않는다.
- `team` 으로 되돌리면 off 에서 낀 칸(`spItem`·`fmItem`)은 저장에 남되 쓰이지 않고 3칸은 빈 채로 시작한다. 손으로 쓴 아티팩트는 이미 환급됐으면 돌아오지 않는다.
- 등급제(`grade.model`)까지 끄면 off 에서는 낼 보상이 없다(보스 보상은 포인트로 대신).
