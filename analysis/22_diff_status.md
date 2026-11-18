# 22. 차분 테스트 현황 (원작 에뮬 대 우리 엔진)

이 파일은 `node tools/diff/run.mjs` 가 자동 생성한다(직접 고치지 말 것). 하니스 설명·실행법: `tools/diff/README.md`.

- 판정: 감시 필드(선수 x,y,z,vx,vy,vz 16.16 정수 · 상태 라벨 · 타이머 / 공 x..vz · 모드 · 보유자 · 위력)가 **전 프레임 비트 단위로 같아야 PASS**. 프레임 오프셋 허용 없음.
- 시작 상태: 원작 저장 상태 `analysis/state/ctrl0.pkl` 을 대기 루프 경계까지 진행한 뒤 우리 엔진에 주입(조작 선수 고정 켬).
- 원작 값은 자작 68000 에뮬(`analysis/scripts/m68k.py`) 결과다. 실기·검증된 에뮬과 대조한 적 없음(한계는 README "오라클 신뢰도").

## 요약 (영역별)

| 영역 | 시나리오 | PASS | 일치 프레임 / 전체 |
|---|---|---|---|
| 걷기 | 9 | 9 | 145 / 145 |
| 대시 | 3 | 3 | 102 / 102 |
| 점프 | 2 | 2 | 97 / 97 |
| 대시점프 | 1 | 1 | 72 / 72 |
| 웅크림 | 1 | 1 | 37 / 37 |
| 캐치 자세 | 2 | 2 | 47 / 47 |
| 지상 투구 | 2 | 2 | 66 / 66 |
| 공 발사 | 3 | 3 | 80 / 80 |
| 이동 한계 | 5 | 5 | 620 / 620 |
| 선 이탈 | 2 | 2 | 162 / 162 |
| 줍기 | 4 | 4 | 149 / 149 |
| 바운스 | 1 | 1 | 130 / 130 |
| 조작 전환 | 4 | 4 | 180 / 180 |
| CPU 두뇌 | 8 | 7 | 779 / 821 |
| CPU 공격 | 14 | 14 | 3405 / 3405 |
| CPU 외야 | 6 | 6 | 1980 / 1980 |
| こうしき | 6 | 6 | 865 / 865 |
| 받아치기 필살 | 1 | 1 | 121 / 121 |
| **합계** | 74 | 73 | 9037 / 9079 |

## 시나리오별

| 시나리오 | 영역 | 입력 | 감시 | 판정 | 예상(19) | 일치/전체 | 첫 불일치 | 진단 |
|---|---|---|---|---|---|---|---|---|
| walk_R | 걷기 | `R:6 -:6` | p0 | **PASS** | FAIL (**다름**) | 12/12 | - | - |
| walk_L | 걷기 | `L:12 -:6` | p0 | **PASS** | FAIL (**다름**) | 18/18 | - | - |
| walk_U | 걷기 | `U:12 -:6` | p0 | **PASS** | FAIL (**다름**) | 18/18 | - | - |
| walk_D | 걷기 | `D:12 -:6` | p0 | **PASS** | FAIL (**다름**) | 18/18 | - | - |
| walk_UL | 걷기 | `UL:12 -:6` | p0 | **PASS** | FAIL (**다름**) | 18/18 | - | - |
| walk_DL | 걷기 | `DL:12 -:6` | p0 | **PASS** | FAIL (**다름**) | 18/18 | - | - |
| walk_UR | 걷기 | `UR:6 -:6` | p0 | **PASS** | FAIL (**다름**) | 12/12 | - | - |
| walk_DR | 걷기 | `DR:6 -:6` | p0 | **PASS** | FAIL (**다름**) | 12/12 | - | - |
| walk_start_stop_reverse | 걷기 | `L:6 -:4 R:5 -:4` | p0 | **PASS** | FAIL (**다름**) | 19/19 | - | - |
| dash_L_hold | 대시 | `L:2 -:3 L:30` | p0 | **PASS** | FAIL (**다름**) | 35/35 | - | - |
| dash_L_release | 대시 | `L:2 -:3 L:2 -:35` | p0 | **PASS** | FAIL (**다름**) | 42/42 | - | - |
| dash_U_doubletap | 대시 | `U:2 -:3 U:20` | p0 | **PASS** | FAIL (**다름**) | 25/25 | - | - |
| jump_stand | 점프 | `C:1 -:45` | p0 | **PASS** | FAIL (**다름**) | 46/46 | - | - |
| jump_walk_L | 점프 | `L:5 LC:1 L:45` | p0 | **PASS** | FAIL (**다름**) | 51/51 | - | - |
| dashjump_L | 대시점프 | `L:2 -:3 L:10 LC:1 L:56` | p0 | **PASS** | FAIL (**다름**) | 72/72 | - | - |
| crouch_A | 웅크림 | `A:1 -:36` | p0 | **PASS** | ? | 37/37 | - | - |
| catch_B_tap | 캐치 자세 | `B:1 -:16` | p0 | **PASS** | ? | 17/17 | - | - |
| catch_B_hold | 캐치 자세 | `B:30` | p0 | **PASS** | ? | 30/30 | - | - |
| throw_ground_tap | 지상 투구 | `give_ball / B:1 -:30` | p0 | **PASS** | FAIL (**다름**) | 31/31 | - | - |
| throw_ground_hold | 지상 투구 | `give_ball / B:5 -:30` | p0 | **PASS** | FAIL (**다름**) | 35/35 | - | - |
| ball_launch_tap | 공 발사 | `give_ball / B:1 -:30` | ball | **PASS** | FAIL (**다름**) | 31/31 | - | - |
| ball_launch_hold | 공 발사 | `give_ball / B:5 -:30` | ball | **PASS** | FAIL (**다름**) | 35/35 | - | - |
| ball_launch_only | 공 발사 | `give_ball / B:1 -:13` | p0,ball | **PASS** | ? | 14/14 | - | - |
| bound_R | 이동 한계 | `R:40` | p0 | **PASS** | FAIL (**다름**) | 40/40 | - | - |
| bound_D | 이동 한계 | `D:120` | p0 | **PASS** | FAIL (**다름**) | 120/120 | - | - |
| bound_U | 이동 한계 | `U:100` | p0 | **PASS** | FAIL (**다름**) | 100/100 | - | - |
| bound_L | 이동 한계 | `L:180` | p0,ctrl | **PASS** | FAIL (**다름**) | 180/180 | - | 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| bound_L_ball | 이동 한계 | `give_ball / L:180` | p0 | **PASS** | FAIL (**다름**) | 180/180 | - | - |
| line_dash_R | 선 이탈 | `R:2 -:3 R:20 -:60` | p0 | **PASS** | FAIL (**다름**) | 85/85 | - | 원작이 조작 선수를 바꿈 f36(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| line_dash_R_ball | 선 이탈 | `give_ball / R:2 -:3 R:20 -:52` | p0 | **PASS** | ? | 77/77 | - | 원작이 조작 선수를 바꿈 f63(obj 1) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| pickup_A | 줍기 | `ball:226,128 / -:3 A:1 -:30` | p0,ball | **PASS** | ? | 34/34 | - | - |
| pickup_B | 줍기 | `ball:246,138 / -:3 B:1 -:30` | p0,ball | **PASS** | ? | 34/34 | - | - |
| pickup_far | 줍기 | `ball:212,128 / -:3 A:1 -:30` | p0,ball | **PASS** | ? | 34/34 | - | - |
| pickup_bounce_B | 줍기 | `ball:244,128,50 / -:16 B:1 -:30` | p0,ball | **PASS** | ? | 47/47 | - | - |
| ball_drop_bounce | 바운스 | `ball:180,90,40,1.5,-0.75,2 / -:130` | ball | **PASS** | ? | 130/130 | - | - |
| ctrl_stop_in | 조작 전환 | `ball:120,180 / -:45` | ctrl | **PASS** | ? | 45/45 | - | 원작이 조작 선수를 바꿈 f31(obj 3) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| ctrl_stop_in_dir | 조작 전환 | `ball:120,180 / U:45` | ctrl | **PASS** | ? | 45/45 | - | - |
| ctrl_stop_out_top | 조작 전환 | `ball:350,25 / U:45` | ctrl | **PASS** | ? | 45/45 | - | 원작이 조작 선수를 바꿈 f2(obj 4) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| ctrl_stop_out_back | 조작 전환 | `ball:436,128 / -:45` | ctrl | **PASS** | ? | 45/45 | - | - |
| rng_stop_45 | CPU 두뇌 | `ball:120,180 / -:45` | rng,p1,p2,p3,p7,p8,p9,p10 | **PASS** | ? | 45/45 | - | 원작이 조작 선수를 바꿈 f31(obj 3) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_plan14 | CPU 공격 | `L:180` | rng,p7,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 180/180 | - | 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_seed1 | CPU 공격 | `poke:E622,1111 / L:300` | rng,p7,p8,p11,p12,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 300/300 | - | 원작 p3 HP 변화 f271; 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_seed2 | CPU 공격 | `poke:E622,2222 / L:100` | rng,p7,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 100/100 | - | 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_seed3 | CPU 공격 | `poke:E622,3333 / L:300` | rng,p7,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 300/300 | - | 원작 p3 HP 변화 f211; 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_seed4 | CPU 공격 | `poke:E622,4444 / L:200` | rng,p7,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 200/200 | - | 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_seed5 | CPU 공격 | `poke:E622,5555 / L:300` | rng,p7,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 300/300 | - | 원작 p3 HP 변화 f211; 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_seed6 | CPU 공격 | `poke:E622,6666 / L:205` | rng,p7,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 205/205 | - | 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_p4 | CPU 공격 | `poke:E622,04 / L:260` | rng,p7,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 260/260 | - | 원작 p3 HP 변화 f176; 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_p8 | CPU 공격 | `poke:E622,08 / L:260` | rng,p7,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 260/260 | - | 원작 p3 HP 변화 f181; 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_pc | CPU 공격 | `poke:E622,36 / L:260` | rng,p7,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 260/260 | - | 원작 p3 HP 변화 f205; 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_p20 | CPU 공격 | `poke:E622,18 / L:260` | rng,p7,p12,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 260/260 | - | 원작 p3 HP 변화 f243; 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_p24 | CPU 공격 | `poke:E622,46 / L:260` | rng,p7,p11,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 260/260 | - | 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_p4c | CPU 공격 | `poke:E622,05 / L:260` | rng,p7,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 260/260 | - | 원작 p3 HP 변화 f226; 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| atk_p1c | CPU 공격 | `poke:E622,24 / L:260` | rng,p7,p13,p11,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 260/260 | - | 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| out_fetch_top | CPU 외야 | `ball:120,26 / -:260` | rng,p11,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 260/260 | - | 원작 p2 HP 변화 f88; 원작이 조작 선수를 바꿈 f31(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| out_fetch_back | CPU 외야 | `ball:34,150 / -:260` | rng,p13,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 260/260 | - | 원작 p1 HP 변화 f92; 원작이 조작 선수를 바꿈 f31(obj 1) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| out_fetch_seed | CPU 외야 | `ball:120,26+poke:E622,5a / -:260` | rng,p11,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 260/260 | - | 원작 p2 HP 변화 f88; 원작이 조작 선수를 바꿈 f31(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| rng_roll_180 | CPU 두뇌 | `L:180` | rng,p7,ball,ctrl | **FAIL** | ? | 138/180 | f78 ball.z 원작 12.2266 / 우리 11.2266 | 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| cpu_def_throw | CPU 두뇌 | `give_ball / B:1 -:30` | p7,rng,ball,rules | **PASS** | ? | 31/31 | - | 원작 p7 HP 변화 f15 |
| cpu_def_a | CPU 두뇌 | `give_ball / -:40 B:1 -:45` | p7,rng,ball,rules,ctrl | **PASS** | ? | 86/86 | - | - |
| cpu_def_b | CPU 두뇌 | `give_ball / -:52 B:1 -:45` | p7,rng,ball,rules,ctrl | **PASS** | ? | 98/98 | - | 원작 p7 HP 변화 f94 |
| cpu_def_c | CPU 두뇌 | `give_ball / -:67 B:1 -:45` | p7,rng,ball,rules,ctrl | **PASS** | ? | 113/113 | - | - |
| cpu_def_d | CPU 두뇌 | `give_ball / -:81 B:1 -:45` | p7,rng,ball,rules,ctrl | **PASS** | ? | 127/127 | - | - |
| cpu_def_e | CPU 두뇌 | `give_ball / -:95 B:1 -:45` | p7,rng,ball,rules,ctrl | **PASS** | ? | 141/141 | - | - |
| out_wait_400 | CPU 외야 | `give_ball / -:400` | rng,p11,p12,p13 | **PASS** | ? | 400/400 | - | - |
| out_wait_seed | CPU 외야 | `give_ball+poke:E622,5a / -:400` | rng,p11,p12,p13 | **PASS** | ? | 400/400 | - | - |
| out_wait_move | CPU 외야 | `give_ball+poke:E623,a0 / -:400` | rng,p11,p12,p13 | **PASS** | ? | 400/400 | - | - |
| kou_hit_out | こうしき | `poke:E622,04+poke:E680,01 / L:300` | rng,p7,ctrl,p0,p1,p2,p3,rules | **PASS** | ? | 300/300 | - | 원작 p3 HP 변화 f278; 원작이 조작 선수를 바꿈 f63(obj 2) -> 이후 구간은 입력이 그 선수에게 가지 않음 |
| kou_def_a | こうしき | `give_ball+poke:E680,01 / -:40 B:1 -:45` | p7,rng,ball,rules,ctrl | **PASS** | ? | 86/86 | - | - |
| kou_def_b | こうしき | `give_ball+poke:E680,01 / -:52 B:1 -:45` | p7,rng,ball,rules,ctrl | **PASS** | ? | 98/98 | - | - |
| kou_def_c | こうしき | `give_ball+poke:E680,01 / -:67 B:1 -:45` | p7,rng,ball,rules,ctrl | **PASS** | ? | 113/113 | - | - |
| kou_def_d | こうしき | `give_ball+poke:E680,01 / -:81 B:1 -:45` | p7,rng,ball,rules,ctrl | **PASS** | ? | 127/127 | - | - |
| kou_def_e | こうしき | `give_ball+poke:E680,01 / -:95 B:1 -:45` | p7,rng,ball,rules,ctrl | **PASS** | ? | 141/141 | - | - |
| ctr_special | 받아치기 필살 | `give_ball / -:16 C:2 -:8 BC:15 -:80` | rng,p7,rules,ctrl | **PASS** | ? | 121/121 | - | - |

## 불일치 필드 집계 (FAIL 시나리오)

| 시나리오 | 필드: 불일치 프레임 수 |
|---|---|
| rng_roll_180 | ball.x: 27, ball.z: 16 |

## 상태 전이와 끝 위치 (FAIL 시나리오)

라벨x프레임수. 원작 라벨은 타입/서브, 우리 라벨은 ST 를 `ours_trace.mjs` 표로 바꾼 것. 끝 위치 = 마지막 프레임 (x, y, z) px.

- **rng_roll_180**
  - p7 원작: jumpx12 idlex58 cpu14x1 idlex31 cpu8x53 cpu4x14 cpu24x11
  - p7 우리: jumpx12 idlex58 cpu14x1 idlex31 cpu8x53 cpu4x14 cpu24x11
  - ball 원작: loosex71 heldx109
  - ball 우리: loosex71 heldx109
  - 끝 위치: p7 원작 (272.5547, 127.9766, 63.7500) / 우리 (272.5547, 127.9766, 63.7500); ball 원작 (279.3750, 129.1563, 88.2266) / 우리 (279.3750, 129.1563, 88.2266)

## 주입 근사·참고

- 우리 엔진이 조작 선수를 117회 바꿈 (bound_L, atk_plan14, rng_roll_180)
- 우리 엔진이 조작 선수를 1회 바꿈(고정으로 되돌림) (line_dash_R)
- 우리 엔진이 조작 선수를 2회 바꿈(고정으로 되돌림) (line_dash_R_ball)
- 우리 엔진이 조작 선수를 14회 바꿈 (ctrl_stop_in, rng_stop_45)
- 우리 엔진이 조작 선수를 43회 바꿈 (ctrl_stop_out_top)
- 우리 엔진이 조작 선수를 237회 바꿈 (atk_seed1)
- 우리 엔진이 조작 선수를 37회 바꿈 (atk_seed2)
- 우리 엔진이 조작 선수를 148회 바꿈 (atk_seed3, atk_seed5)
- 우리 엔진이 조작 선수를 137회 바꿈 (atk_seed4)
- 우리 엔진이 조작 선수를 142회 바꿈 (atk_seed6, atk_pc)
- 우리 엔진이 조작 선수를 113회 바꿈 (atk_p4, kou_hit_out)
- 우리 엔진이 조작 선수를 118회 바꿈 (atk_p8)
- 우리 엔진이 조작 선수를 197회 바꿈 (atk_p20, atk_p24, atk_p4c, atk_p1c)
- 우리 엔진이 조작 선수를 229회 바꿈 (out_fetch_top, out_fetch_back, out_fetch_seed)
