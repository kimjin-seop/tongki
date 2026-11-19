# 38. 불꽃의 계승 — 데이터 마스터 스키마·효과 타입 사전

작성 2026-11-19. 기준 문서: `analysis/36_flame_legacy_spec.md`(기획 원문). 엔진 쪽 분석은 `analysis/37_flame_legacy_analysis.md`(다른 담당이 작성 중, 이 문서를 쓸 때는 아직 없었다).

이 문서는 `server/flame/data/` 의 JSON 이 무엇을 담고, 각 효과가 계산의 어느 단계에서 적용되며, 엔진에 훅이 필요한지를 적는다. 코드 로직과 엔진은 이 단계에서 건드리지 않았다.

## 1. 파일 목록

| 파일 | 내용 | 기획 근거 |
|---|---|---|
| `items_equipment.json` | 장비 40종(H01~H10, G01~G10, P01~P10, U01~U10) | §4, §5 |
| `artifacts.json` | 아티팩트 30종(A01~A30) | §7 |
| `consumables.json` | 소모품 20종(C01~C20) | §9 |
| `synergies.json` | 시너지 7종(SY01~SY03 = §8.3, SX01~SX04 = §8.4) | §8.3, §8.4 |
| `formation_tags.json` | 포메이션 전술 태그 6종, 기존 포메이션 매핑(미정) | §8.2 |
| `shot_families.json` | 필살기 계열 6종 → shotId | §7.2, §7.3 A |
| `economy.json` | 불꽃코인 지급표, 강화 비용·보너스·반올림, 경기 포인트 | §6.1, §10 |
| `perm_upgrades.json` | 영구 성장 A 4종·B 7종·C 6종 | §10.3 |
| `rules.json` | 인원·슬롯·구간·확률·상한·계산 순서 | §2, §3.1, §4.2, §9.1, §14 |
| `nodes.json` | 노드 8종, 구간 진행 예시, 특훈 11종 | §3.3, §11.2 |
| `effect_types.json` | 효과 타입 사전(검증 도구가 읽는다) | 이 문서 §4 |
| `run_config.json` | P2~P5 진행 수치(상대 풀·보상 구성·상점·특훈·휴식·영입·이벤트·영구 성장 C·업적·역할). 전부 [자작 제안], 검증은 `server/flame/catalog.js` | 기획에 값 없음(39 §4) |
| `decisions.json` | 확정 결정 D1~D14 상수 | 39 §1 |

검증 도구: `server/flame/tools/validate_data.mjs`. 시험: `test/flame_data.test.js`.

## 2. 공통 규칙

- 모든 파일의 `_meta.notes` 에 그 파일의 근거와 미확정 사항이 적혀 있다.
- **`proposed` 키 = [자작 제안]**. 기획서에 수치가 없는 값은 본래 자리에 `null` 을 두고 같은 객체의 `proposed` 아래에 제안값을 둔다. 구현은 `proposed` 를 읽는다는 사실을 알고 읽어야 하며, 사용자 확정 후 본래 자리로 옮긴다. 검증 도구는 `null` 인 효과 파라미터에 `proposed` 가 없으면 오류로 본다.
- `specText` 는 기획서 표의 효과 문구 원문이다. 검증 도구가 기획서와 글자 단위로 대조한다.
- 단위: s0~s7 은 정수, r1·r2 는 % 포인트 정수(10 = 10%), r3 은 단축 프레임 정수.

## 3. 항목 구조

### 3.1 장비 (`items_equipment.json` items[])

| 필드 | 뜻 |
|---|---|
| `id`, `name` | 기획 ID·이름 |
| `slot` | `headband` \| `glove` \| `protector` \| `uniform` (ID 접두 H/G/P/U 와 일치) |
| `rarity` | `common` \| `rare` \| `epic` \| `legendary` |
| `stats` | 무조건 능력치 증감. 키는 s0~s7, r1~r3. 0 은 적지 않는다. 음수 가능(U07 방어력 -1) |
| `effects` | 조건부·특수 효과 배열(§4) |
| `formationTags` | 이 장비가 걸리는 포메이션 태그(U09 = combo) |
| `shotTags` | 이 장비가 걸리는 필살기 계열(H08 = flame, G09 = axe) |
| `upgradeable` | 강화 가능 여부(전부 true, 최대 +3) |
| `source` | 획득 출처. 기획서에 품목별 출처가 없어 null |
| `icon` | 아이콘 경로(§6) |
| `proposed.sellPrice` | [자작 제안] 판매 가격(등급별 15/30/60/120) |
| `proposed.sources` | [자작 제안] 출처 초안. 전설은 `requires:PC02`(전설 장비 설계도 해금) |

### 3.2 아티팩트 (`artifacts.json` items[])

`category`(special = A01~A08, formation = A09~A18, team = A19~A30), `effects`, `unlockShotFamilies`(effects 의 `unlock_shot_family` 와 같아야 함), `formationTag`(효과 조건의 포메이션 태그, 없으면 null), `synergyKeys`(이 아티팩트가 조건인 시너지 ID), `icon`.

### 3.3 소모품 (`consumables.json` items[])

`kind`(heal \| nextMatch \| utility), `duration`(instant \| nextMatch \| nextBossMatch \| nextReward \| nextRecruit), `effects`, `stackMax`(3), `icon`.

`utility` 는 지시된 enum(heal \| nextMatch)에 없는 값이다. C18(다음 보상 선택지 추가)·C19(다음 영입 후보 추가)는 회복도 다음 경기 강화도 아니어서 따로 두었다.

### 3.4 시너지 (`synergies.json` synergies[])

`requires.formationTag`(null 이면 포메이션 무관), `requires.artifacts`(전부 장착해야 함), `specEffects`(원문), `effects`. `effects[].duplicatesArtifact` 는 그 효과가 조건 아티팩트의 효과와 같은 수치라는 표시다(§8 확인 필요 2번).

## 4. 효과 타입 사전

효과 한 개의 모양: `{ type, params, conditions, tags, proposed? }`.

**단계** 열은 기획 §14.1 의 번호다. 효과가 붙은 데이터 종류로 정해진다.

| 붙은 곳 | 단계 |
|---|---|
| 장비 `stats`·`effects` | 4 (선수별 장비 보너스) |
| 아티팩트 효과, 조건에 `formationTag` 없음 | 5 (팀 공용 아티팩트 보너스) |
| 아티팩트 효과, 조건에 `formationTag` 있음 | 6 (현재 포메이션 보너스) |
| 시너지 효과 | 7 (아티팩트 조합 시너지) |
| 소모품 효과 | 8 (소모품 임시 효과) |
| `rules.json` clamps | 9 (최종 상한 및 하한) |

1~3단계(기본 능력치, 영구 성장, 특훈)는 효과 타입이 아니라 `perm_upgrades.json` training 과 `nodes.json` trainingOptions 가 담당한다.

**시점** 열: `능력치` = 경기 전에 합산해 선수 능력치로 넣는다. `사건` = 경기 중 특정 순간에 적용한다. `경기 밖` = 보상·영입·회복 화면에서 적용한다.

| type | 뜻 | params | 쓸 수 있는 conditions | 시점 | 단계 | 엔진 훅 |
|---|---|---|---|---|---|---|
| `stat_bonus` | 능력치 증감 | `stat`(s0~s7, r1~r3), `value`(정수), `target` | `formationTag`, `hpAtMostPct`, `nodeType` | 능력치 | 4~8 | s0~s7 은 불필요(경기 시작 때 능력치를 넣어 주면 기존 공식이 그대로 쓴다). r1~r3 은 필요(§5). `hpAtMostPct` 조건(P08)은 경기 중 HP 가 바뀔 때 다시 계산해야 하므로 필요 |
| `throw_power_bonus` | 투구 위력 증가 | `value`(정수) 또는 `pct`(%) | `special`, `shotFamily`, `airborne`, `afterCatch`, `chargeMin`, `chargeMax` | 사건 | 4, 5, 7 | 필요. 투구 위력을 계산한 직후(원작 0x89AA 대응 지점) |
| `throw_speed_bonus` | 투구 속도 증가 | `value`(정수) | `special`, `shotFamily`, `afterPass` | 사건 | 4, 5, 7 | 필요. 투구 속도를 계산한 직후(원작 0x7D0C 대응 지점) |
| `unlock_shot_family` | 필살기 계열 해금 | `family` | 없음 | 능력치 | 5 | 필요. 필살기 발동 허용 판정(이 모드는 잠긴 상태로 시작) |
| `formation_bonus_amplify` | 현재 포메이션 보너스 강화 | `multiplierPct` | `isCaptain` | 능력치 | 6 | 불필요. 6단계에서 합산한 값에 배율 |
| `synergy_amplify` | 활성 시너지 강화 | `multiplierPct` | 없음 | 능력치 | 7 | 불필요. 7단계에서 합산한 값에 배율 |
| `survive_lethal` | 치명 피해를 받고 HP 1 로 생존 | `hpAfter`, `usesPerRun` | 없음 | 사건 | 4 | 필요. 피해를 HP 에 반영하기 직전. 사용 여부는 도전 상태에 저장 |
| `reward_extra_choice` | 보상 선택지 추가 | `rewardKind`, `rarity`, `count` | `nodeType` | 경기 밖 | 해당 없음 | 불필요(보상 생성) |
| `recruit_extra_candidate` | 영입 후보 추가 | `count` | 없음 | 경기 밖 | 해당 없음 | 불필요(영입 후보 생성) |
| `heal_hp` | HP 회복 | `value`, `target` | 없음 | 경기 밖 | 해당 없음 | 불필요. 도전 전용 현재 HP 를 고친다(§9.2) |

훅의 실제 위치(웹 엔진의 파일·함수)는 이 문서에서 정하지 않았다. `analysis/37` 의 결과를 따른다.

### 4.1 target

| 값 | 뜻 |
|---|---|
| `self` | 장비를 낀 선수 |
| `team` | 팀 전원 |
| `captain` | 주장 한 명 |
| `player` | 사용할 때 고르는 선수 한 명(소모품) |
| `null` | 기획서에 대상이 없음. `proposed.target` 참조 |

### 4.2 조건 문법

`conditions` 는 키-값 객체이고 적힌 조건을 **모두** 만족해야 한다(AND). 빈 객체는 무조건이다.

| 키 | 값 | 뜻 | 쓰는 항목 |
|---|---|---|---|
| `formationTag` | 태그 ID | 현재 포메이션이 그 태그일 때 | U09, A09, A10, A12~A17 |
| `shotFamily` | 계열 ID | 던진 필살기가 그 계열일 때 | H08, G09, A01, A02, A04, SY01, SX01 |
| `special` | true | 필살기 투구일 때 | H08, G09, G10, A01, A02, A04, A07, A08 |
| `airborne` | true | 공중(점프) 투구일 때 | H04, G08, U08, A08 |
| `afterCatch` | true | 캐치에 성공한 뒤 첫 투구 | H09, G07, SX02 |
| `afterPass` | true | 패스를 받은 직후 첫 투구 | U10, SX03 |
| `chargeMin`, `chargeMax` | 정수 | 차지값이 이 구간일 때(양 끝 포함) | H07(13~15) |
| `hpAtMostPct` | 정수 | 현재 HP 가 최대 HP 의 이 % 이하일 때 | P08(30) |
| `isCaptain` | true | 장착 선수가 주장으로 지정됐을 때 | H10 |
| `nodeType` | 노드 ID | 그 종류의 경기·노드일 때 | A28(boss), A29(strong), C20(boss) |

기획 문구의 "점프슛"(H04), "점프 중 투구"(G08), "공중 투구"(U08, A08)는 모두 `airborne` 하나로 옮겼다. 엔진이 점프 투구와 대시 점프 투구를 구분한다면 나눌지 정해야 한다(§8 확인 필요 6번).

## 5. 9단계(상한·하한)와 확장 능력치

`rules.json` clamps 값은 전부 기획 수치다.

| 항목 | 값 | 훅 |
|---|---|---|
| r1 넉백 저항 상한 | 60% | 필요. 피격 수평 넉백 × (1 - r1/100). 수직 속도와 쓰러짐 시간은 그대로 |
| r2 캐치 후 밀림 감소 상한 | 60% | 필요. 적용 위치는 캐치·이동 물리 분석 후 결정(기획 §2.2) |
| r3 쓰러짐 회복 단축 상한 | 24프레임 | 필요. 쓰러짐 60프레임 - r3, 최소 36프레임 |
| 이동속도 상한 | 3.0px/프레임 | 불필요(원작 규칙 유지). s2 가 올라가도 상한에 걸리면 낭비 표시(UI) |

## 6. 아이콘 경로 규칙

`assets/flame-legacy/items/{headbands|gloves|protectors|uniforms|artifacts|consumables}/{ID}_{영문명}.png`

- 영문명은 소문자·숫자·밑줄만 쓴다.
- 기획서가 예시로 든 6개(H08, G09, P09, U10, A01, C01)는 그 이름 그대로다. 나머지 84개 이름은 이번에 정했다.
- 검증 도구는 `public/` 을 기준으로 파일이 있는지 본다(`--asset-root` 로 변경). 파일이 없으면 경고로 목록을 내고, `--strict` 일 때만 실패다.
- 전체 목록은 §9.

## 7. 강화 계산(`economy.json` upgrade)

- 비용 60 / 140 / 260, 보너스 20 / 40 / 60%, 실패 없음: 기획 §6.1 그대로.
- 반올림(2026-11-19 확정, `analysis/39_flame_decisions.md` D11): `bonus = base > 0 ? max(minBonusWhenPositive, floor(base × pct / 100 + 0.5)) : 0`, 최종 = base + bonus. half-up 반올림만 하고 **최소 +1 보장은 하지 않는다**(`minBonusWhenPositive = 0`. 종전 값 1 = "양수 보너스 최소 1" 은 이 결정으로 바뀌었다. 1 로 되돌리면 종전 규칙). 값이 그대로인 단계는 UI 에 `변화 없음`(`noChangeLabel`). 비용은 단계별 지불(`costMode = perStep`, 합 460).
- 대상은 `stats` 의 양수 값이다. `effects` 는 강화해도 그대로다(§6.1 "고유 특수효과는 유지").

이 규칙으로 계산한 예(기본값 → +1 / +2 / +3):

| 기본값 | +1 | +2 | +3 |
|---:|---:|---:|---:|
| 1 | 1 (변화 없음) | 1 (변화 없음) | 2 |
| 2 | 2 (변화 없음) | 3 | 3 |
| 3 | 4 | 4 | 5 |
| 5 | 6 | 7 | 8 |
| 8 | 10 | 11 | 13 |
| 10 | 12 | 14 | 16 |
| 15 | 18 | 21 | 24 |
| 20 | 24 | 28 | 32 |

## 8. [자작 제안]과 확인 필요

### 8.1 [자작 제안] (`proposed` 키)

| 위치 | 내용 |
|---|---|
| 장비 `proposed.sellPrice` | 등급별 15 / 30 / 60 / 120 |
| 장비 `proposed.sources` | 보상·상점, 전설은 설계도 해금(PC02) 필요 |
| H10, A18, C12 `multiplierPct` | 포메이션 보너스 강화 폭 50% |
| A30 `multiplierPct` | 시너지 강화 폭 50% |
| A04 `value` | 공 속도 강화 +2 |
| A28, A29 `count` | 추가 선택지 1개 |
| SX01~SX04 | 위력 +4 / 위력 +4 / 속도 +3 / 주장 패스 속도 +3 |
| 시너지 `applyDuplicates=false` | §8.3 에서 아티팩트와 겹치는 수치는 다시 더하지 않음 |
| 소모품 C03~C10, C16, C17 `target` | 선수 1명 |
| `economy.json` matchPoints | 시작 100, 일반 60, 강팀 100, 보스 160 |
| `economy.json` shop | 장비 80 / 150 / 260 / 450, 소모품 기본 40(C02 60, C11 90, C18·C19 70) |
| `economy.json` upgrade.proposed | 비용은 단계마다 지불(합계 460), 음수 능력치는 강화로 변하지 않음 |
| `perm_upgrades.json` preparation | B 7종의 단계당 효과와 비용 |
| `shot_families.json` 속구·특수 궤적·강위력 | 궤적·위력으로 나눈 shotId 목록, 회전의 추가 후보 1 |
| `nodes.json` proposed | 구간당 4경기 템플릿, 휴식 회복 30% |

### 8.2 확인 필요

> 2026-11-19: 아래 1~5·7~9 는 `analysis/39_flame_decisions.md` 로 확정되었다(1 = D9, 2 = D10, 3·4 = D11, 5 = D1, 7 = D2, 8 = D7, 9 = D12). `shot_families.json` 의 null 3계열과 `formation_tags.json` 의 mapping 을 채웠고, 결정 상수는 `server/flame/data/decisions.json` 에 모았다. 6·10 은 그대로 남아 있다.

1. **구간당 경기 수**: §3.3 진행 예시는 구간당 3경기(일반·강팀·보스)라 3구간이면 9경기다. §3.1 은 총 12경기다. 제안 템플릿은 구간당 4경기로 맞췄다.
2. **§8.3 시너지의 수치**: 공격력 +3, 방어력 +2·넉백 저항 +15%, 이동속도 +1·투구 속도 +2 는 조건 아티팩트 두 개의 효과 합과 같다. 추가 보너스인지 결과 설명인지 원문으로 정할 수 없다. 추가라면 A13 은 공격형에서 공격력 +6 이 된다.
3. **강화 비용**: 60/140/260 이 단계별인지 누적인지 원문에 없다.
4. **강화 반올림의 빈 단계**: 기본값 1·2 는 +1 이후 +2·+3 을 해도 값이 그대로다(§7 표). 일반·희귀 장비 다수가 여기에 해당한다. 또 `stats` 가 없는 장비(H07, H09, G07, G08, G09)는 강화해도 변하는 것이 없다. 비용만 드는 강화를 막을지, 특수효과도 강화할지 결정이 필요하다.
5. **필살기 선수당 2개**: 기획서는 "선수별 기존 2개"라고 하나 `server/data/specials.json` row(ROM 0x18732)는 선수당 ID 1개다. 2슬롯 구성은 37 결과로 정한다.
6. **`airborne` 하나로 통합한 조건**: 점프슛·점프 중 투구·공중 투구를 구분할지.
7. **속구·특수 궤적·강위력 계열의 shotId**: 원작에 계열 구분이 없다. 확정값은 null 이고 제안 목록만 있다. 불꽃 = 22·25, 도끼 = 11, 회전 = 2 는 기존 이름 근거(`analysis/31_special_shot_names.md` §8)로 채웠다. 25(위력 85, 분신 3)를 불꽃 계열에 넣을지는 밸런스 판단 대상이다.
8. **포메이션 태그 매핑**: 기존 포메이션 15종은 팀에 고정된 배치·패스 순서 데이터다. 태그 6종과의 매핑은 전부 null 이다.
9. **주장**: A11·H10·SX04 의 주장이 엔진의 어느 선수인지, 지정 방식이 있는지.
10. **소모품 대상**: C03~C10·C16·C17 이 선수 1명인지 팀 전체인지. C04 와 C16 은 원문 효과가 같다.
11. **C13 "팀 전체 HP +5"**: 최대 HP 인지 현재 HP 인지. C03 은 "최대 HP"라고 적혀 있고 C13 은 그렇지 않다. 둘 다 s0 증가로 옮겼다.
12. **A15 "점프 공격 중심 포메이션"**: 고공형(highair) 태그로 옮겼다.
13. **등급 확률의 적용 범위**: 55/30/12/3 은 장비 등급 기준이다. 아티팩트·소모품에는 등급이 없다.

## 9. 아이콘 파일 목록 (90개)

| ID | 이름 | 경로 |
|---|---|---|
| H01 | 연습용 머리띠 | `assets/flame-legacy/items/headbands/H01_practice_headband.png` |
| H02 | 근성 머리띠 | `assets/flame-legacy/items/headbands/H02_guts_headband.png` |
| H03 | 질풍 머리띠 | `assets/flame-legacy/items/headbands/H03_gale_headband.png` |
| H04 | 도약 머리띠 | `assets/flame-legacy/items/headbands/H04_leap_headband.png` |
| H05 | 집중 머리띠 | `assets/flame-legacy/items/headbands/H05_focus_headband.png` |
| H06 | 투혼 머리띠 | `assets/flame-legacy/items/headbands/H06_fighting_spirit_headband.png` |
| H07 | 승부사의 머리띠 | `assets/flame-legacy/items/headbands/H07_clutch_headband.png` |
| H08 | 불꽃 머리띠 | `assets/flame-legacy/items/headbands/H08_flame_headband.png` |
| H09 | 반격의 머리띠 | `assets/flame-legacy/items/headbands/H09_counter_headband.png` |
| H10 | 전설의 주장 머리띠 | `assets/flame-legacy/items/headbands/H10_legendary_captain_headband.png` |
| G01 | 연습용 장갑 | `assets/flame-legacy/items/gloves/G01_practice_glove.png` |
| G02 | 캐치 장갑 | `assets/flame-legacy/items/gloves/G02_catch_glove.png` |
| G03 | 속구 장갑 | `assets/flame-legacy/items/gloves/G03_fastball_glove.png` |
| G04 | 패스 장갑 | `assets/flame-legacy/items/gloves/G04_pass_glove.png` |
| G05 | 강투 장갑 | `assets/flame-legacy/items/gloves/G05_power_throw_glove.png` |
| G06 | 안정형 장갑 | `assets/flame-legacy/items/gloves/G06_stable_glove.png` |
| G07 | 반격 장갑 | `assets/flame-legacy/items/gloves/G07_counter_glove.png` |
| G08 | 점프슛 장갑 | `assets/flame-legacy/items/gloves/G08_jumpshot_glove.png` |
| G09 | 도끼 장갑 | `assets/flame-legacy/items/gloves/G09_axe_glove.png` |
| G10 | 전설의 에이스 장갑 | `assets/flame-legacy/items/gloves/G10_legendary_ace_glove.png` |
| P01 | 연습용 보호대 | `assets/flame-legacy/items/protectors/P01_practice_protector.png` |
| P02 | 체육부 보호대 | `assets/flame-legacy/items/protectors/P02_pe_club_protector.png` |
| P03 | 밀림 방지 보호대 | `assets/flame-legacy/items/protectors/P03_anti_push_protector.png` |
| P04 | 캐치 안정 보호대 | `assets/flame-legacy/items/protectors/P04_catch_stable_protector.png` |
| P05 | 충격 흡수 보호대 | `assets/flame-legacy/items/protectors/P05_shock_absorb_protector.png` |
| P06 | 회복 보호대 | `assets/flame-legacy/items/protectors/P06_recovery_protector.png` |
| P07 | 강철 패드 보호대 | `assets/flame-legacy/items/protectors/P07_steel_pad_protector.png` |
| P08 | 근성 보호대 | `assets/flame-legacy/items/protectors/P08_guts_protector.png` |
| P09 | 철벽 보호대 | `assets/flame-legacy/items/protectors/P09_ironwall_protector.png` |
| P10 | 전설의 불굴 보호대 | `assets/flame-legacy/items/protectors/P10_legendary_indomitable_protector.png` |
| U01 | 기본 체육복 | `assets/flame-legacy/items/uniforms/U01_basic_gym_uniform.png` |
| U02 | 도약 체육복 | `assets/flame-legacy/items/uniforms/U02_leap_gym_uniform.png` |
| U03 | 속공 유니폼 | `assets/flame-legacy/items/uniforms/U03_fastbreak_uniform.png` |
| U04 | 점프 유니폼 | `assets/flame-legacy/items/uniforms/U04_jump_uniform.png` |
| U05 | 질풍 유니폼 | `assets/flame-legacy/items/uniforms/U05_gale_uniform.png` |
| U06 | 연계 유니폼 | `assets/flame-legacy/items/uniforms/U06_combo_uniform.png` |
| U07 | 경량 유니폼 | `assets/flame-legacy/items/uniforms/U07_lightweight_uniform.png` |
| U08 | 고공 유니폼 | `assets/flame-legacy/items/uniforms/U08_highair_uniform.png` |
| U09 | 팀워크 유니폼 | `assets/flame-legacy/items/uniforms/U09_teamwork_uniform.png` |
| U10 | 전설의 질풍 유니폼 | `assets/flame-legacy/items/uniforms/U10_legendary_wind_uniform.png` |
| A01 | 불꽃 훈련공 | `assets/flame-legacy/items/artifacts/A01_flame_training_ball.png` |
| A02 | 도끼슛 교본 | `assets/flame-legacy/items/artifacts/A02_axe_shot_manual.png` |
| A03 | 회전 연습공 | `assets/flame-legacy/items/artifacts/A03_spin_practice_ball.png` |
| A04 | 번개 특훈 테이프 | `assets/flame-legacy/items/artifacts/A04_lightning_training_tape.png` |
| A05 | 비밀 슛 비디오 | `assets/flame-legacy/items/artifacts/A05_secret_shot_video.png` |
| A06 | 폭발 훈련공 | `assets/flame-legacy/items/artifacts/A06_blast_training_ball.png` |
| A07 | 에이스의 연습구 | `assets/flame-legacy/items/artifacts/A07_ace_practice_ball.png` |
| A08 | 필살기 특훈 수첩 | `assets/flame-legacy/items/artifacts/A08_special_training_notebook.png` |
| A09 | 철벽 작전보드 | `assets/flame-legacy/items/artifacts/A09_ironwall_tactics_board.png` |
| A10 | 질풍의 응원 깃발 | `assets/flame-legacy/items/artifacts/A10_gale_cheer_flag.png` |
| A11 | 주장 완장 | `assets/flame-legacy/items/artifacts/A11_captain_armband.png` |
| A12 | 연계 작전노트 | `assets/flame-legacy/items/artifacts/A12_combo_tactics_note.png` |
| A13 | 돌격 작전판 | `assets/flame-legacy/items/artifacts/A13_charge_tactics_board.png` |
| A14 | 수비 특훈 기록부 | `assets/flame-legacy/items/artifacts/A14_defense_training_log.png` |
| A15 | 고공 작전도 | `assets/flame-legacy/items/artifacts/A15_highair_tactics_map.png` |
| A16 | 속공 호각 | `assets/flame-legacy/items/artifacts/A16_fastbreak_whistle.png` |
| A17 | 철벽 팀 배지 | `assets/flame-legacy/items/artifacts/A17_ironwall_team_badge.png` |
| A18 | 전술 교본 | `assets/flame-legacy/items/artifacts/A18_tactics_textbook.png` |
| A19 | 전설의 피구공 | `assets/flame-legacy/items/artifacts/A19_legendary_dodgeball.png` |
| A20 | 우승 트로피 | `assets/flame-legacy/items/artifacts/A20_champion_trophy.png` |
| A21 | 특훈 출석부 | `assets/flame-legacy/items/artifacts/A21_training_attendance_book.png` |
| A22 | 명문 피구부 배지 | `assets/flame-legacy/items/artifacts/A22_elite_club_badge.png` |
| A23 | 전국대회 경기구 | `assets/flame-legacy/items/artifacts/A23_national_match_ball.png` |
| A24 | 팀워크 응원 깃발 | `assets/flame-legacy/items/artifacts/A24_teamwork_cheer_flag.png` |
| A25 | 근성의 구호판 | `assets/flame-legacy/items/artifacts/A25_guts_slogan_board.png` |
| A26 | 충격 완화 매트 | `assets/flame-legacy/items/artifacts/A26_shock_absorb_mat.png` |
| A27 | 캐치 특훈 교본 | `assets/flame-legacy/items/artifacts/A27_catch_training_manual.png` |
| A28 | 비밀 훈련 기록 | `assets/flame-legacy/items/artifacts/A28_secret_training_record.png` |
| A29 | 우승 후보 명찰 | `assets/flame-legacy/items/artifacts/A29_contender_name_tag.png` |
| A30 | 불꽃의 계승 증표 | `assets/flame-legacy/items/artifacts/A30_flame_legacy_token.png` |
| C01 | 스포츠 드링크 | `assets/flame-legacy/items/consumables/C01_sports_drink.png` |
| C02 | 특제 스포츠 드링크 | `assets/flame-legacy/items/consumables/C02_special_sports_drink.png` |
| C03 | 에너지 주먹밥 | `assets/flame-legacy/items/consumables/C03_energy_riceball.png` |
| C04 | 특훈 도시락 | `assets/flame-legacy/items/consumables/C04_training_lunchbox.png` |
| C05 | 냉찜질 팩 | `assets/flame-legacy/items/consumables/C05_ice_pack.png` |
| C06 | 손목 테이핑 | `assets/flame-legacy/items/consumables/C06_wrist_taping.png` |
| C07 | 발목 테이핑 | `assets/flame-legacy/items/consumables/C07_ankle_taping.png` |
| C08 | 무릎 보호 테이프 | `assets/flame-legacy/items/consumables/C08_knee_support_tape.png` |
| C09 | 캐치용 미끄럼 방지제 | `assets/flame-legacy/items/consumables/C09_catch_antislip_agent.png` |
| C10 | 충격 흡수 패드 | `assets/flame-legacy/items/consumables/C10_shock_absorb_pad.png` |
| C11 | 긴급 치료 키트 | `assets/flame-legacy/items/consumables/C11_emergency_med_kit.png` |
| C12 | 전술 메모 | `assets/flame-legacy/items/consumables/C12_tactics_memo.png` |
| C13 | 응원 머플러 | `assets/flame-legacy/items/consumables/C13_cheer_muffler.png` |
| C14 | 특훈 호각 | `assets/flame-legacy/items/consumables/C14_training_whistle.png` |
| C15 | 고무 연습공 | `assets/flame-legacy/items/consumables/C15_rubber_practice_ball.png` |
| C16 | 무게 훈련공 | `assets/flame-legacy/items/consumables/C16_weighted_training_ball.png` |
| C17 | 유연성 훈련 밴드 | `assets/flame-legacy/items/consumables/C17_flexibility_band.png` |
| C18 | 경기 분석 비디오 | `assets/flame-legacy/items/consumables/C18_match_analysis_video.png` |
| C19 | 스카우트 추천서 | `assets/flame-legacy/items/consumables/C19_scout_recommendation.png` |
| C20 | 우승 기원 부적 | `assets/flame-legacy/items/consumables/C20_victory_charm.png` |
