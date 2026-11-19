// [sim_versus.mjs] 키운 팀 대전(analysis/43, 39 D33~D37) 측정 도구. analysis/40 §19. sim_balance.mjs(2026-11-19 사본)에 snap·vs·verify 모드만 더했다(맨 아래 "키운 팀 대전" 절). 봇 정책·도전 진행 부분은 사본 그대로다.
//   snap   = 정책 봇 도전을 돌리며 「구간 k 보스전에 들어갈 때의 팀」을 teams.js snapshotOf 로 떠서 JSON 으로 쓴다(--tiers=3,6,10 --out=<경로>. 나머지 옵션은 run 과 같다)
//   vs     = 스냅샷 팀 대 원작 팀 / 스냅샷 팀끼리. 엔진 파일은 고치지 않는다. 키운 팀끼리는 엔진의 두 좌석 flame 옵션(배열)으로 만든다(아래 mkMatch 주석)
//   verify = 두 좌석 경기의 자기 검증(flame 배열 순서 [0,1] 과 [1,0] 이 같은 시드에서 틱 단위로 같은 결과인가)
//   teams  = 스냅샷 팀의 재료·최종 능력치·조건부 위력 요약(구간별 평균과 팀 사이 범위)
//   vs 의 --a/--b 에는 구간 번호 말고 orig:<팀 번호>(원작 팀 그대로 = 기준선), build:<빌드 이름>(sim_balance BUILDS 의 합성 팀)도 쓸 수 있다. 옵션 전체는 runVs 주석.
//   한계: 양쪽 다 컴퓨터가 조작한다(레벨 1·2·3). 승률은 조건 사이의 상대 비교 지표이고 사람끼리 대전의 절대 승률이 아니다. 실행 묶음·출력은 analysis/data/40_flame_versus/
// 불꽃의 계승 밸런스 측정 도구(analysis/40_flame_balance.md). 엔진을 node 로 직접 돌린다(서버·포트·DB 를 쓰지 않는다. 파일을 고치지 않는다).
// 양쪽 다 컴퓨터(humans=[false,false])이고, flame 좌석(0)에는 실제 서버와 같은 경로(stats.computeTeam -> toEngine / run.matchOptions)로 만든 flame 옵션을 넣는다.
//
// 사용:
//   node server/flame/tools/sim_balance.mjs cond --builds=base,rare4 --opps=seg1n,seg1s --n=30 [--bot=2] [--seat=0] [--data=<데이터 폴더>] [--json=<경로>]
//   node server/flame/tools/sim_balance.mjs run  --n=30 [--bot=2] [--perm=none|mid|full] [--diff=0] [--recruit=off|safe|always|visit] [--recruit-hp=60] [--recruit-margin=3] [--data=<폴더>] [--json=<경로>] [--seed0=1]
//   node server/flame/tools/sim_balance.mjs list            (빌드·상대 묶음 이름과 빌드별 최종 능력치)
// 엔드리스(무한 구간, 39 D24)가 켜져 있으면 run 은 구간 3 뒤에도 이어 돌고(우승 = 종료 요약 championed), 구간별 도달·통과·종료 분포 표가 붙는다(analysis/40 §15):
//   [--max-seg=12] [--max-nodes=N] [--endless-bot=late|all|off] [--xopp=P --xopp-from=4 --xopp-stats=hp,def,pow,s5 (실험용 상대 가산, 서버·엔진 미구현)]
//   종전 측정(12경기 종료)은 환경 변수 FLAME_ENDLESS=0 을 붙이면 출력·JSON 이 그대로 나온다(2026-11-19 5조건 × 40판 대조: 0/4/10/0/5, JSON 바이트 동일).
// cond = 고정 빌드 대 고정 상대(경기마다 HP 가득). run = 도전 한 판을 정책 봇으로 끝까지(HP 이월·보상·상점·특훈·휴식 포함).
// --recruit = 봇 영입 정책(analysis/42 §7.2 초안). off(기본) = 영입하지 않는다(영입 노드는 맨 끝 순위, 들어가도 "영입 안 함") -> 출력·JSON 이 정책 추가 전과 같다(analysis/40 §13.4 와 판별 대조용).
//   safe = 팀 HP 가 --recruit-hp(기본 60)% 이상이면 영입 노드를 먼저 고르고(미만이면 종전대로 휴식 우선), 후보 점수(42 §2.1) + 역할 빈자리 가산이 교체 대상(주인공을 뺀 6명 중 점수 최저, 영구 성장 A 포함) + --recruit-margin(기본 3) 이상일 때만 영입.
//     문턱 60 의 뜻 [정책·자작, 42 §12.3]: 전원 휴식(50%)의 회복량 가운데 실제로 차는 몫이 40%p 를 넘으면(팀 HP 60% 미만) 휴식, 아니면 영입실. 종전 초안은 80 이었고 그 조건은 영입 층의 약 10~25% 에서만 맞았다.
//   always = 영입 층에서는 언제나 영입 노드로 간다(영입 조건은 safe 와 같다). safe·always 는 순번 표에 "영입한 판 수·영입 등급" 열과 영입 요약 줄이 붙는다.
//   visit = 진단용: always 처럼 영입실에 가되 영입하지 않는다(휴식·이벤트를 포기한 값만 잰다. always − visit = 영입 자체의 값).
// --bot = flame 좌석 컴퓨터 레벨(1 초보 / 2 보통 / 3 숙련 대용). --data = server/flame/data 대신 읽을 폴더(조정 전 사본과 비교용).
// 한계: flame 좌석을 사람이 아니라 컴퓨터가 조작한다. 절대 승률이 아니라 빌드 사이·상대 사이·조정 전후의 상대 비교 지표다.
// 시드: 조건마다 2*i + 시드 기준(짝수만. 엔진이 시드 최하위 비트를 버린다, analysis/25 §11-3). 같은 명령은 같은 결과를 낸다.
import { writeFileSync, readFileSync } from 'node:fs';
import { snapshotOf, versusOptions, sanitizeTeam } from '../teams.js';
import path from 'node:path';
import { Match, loadData } from '../../engine/index.js';
import { loadCatalog, startLineup, ENGINE_STAT, STAT_KEYS, cloneOf, originalOf, isLockedPlayer, recruitView, teamArtifactsOn } from '../catalog.js';
import { computeTeam, toEngine, allowOf, roleOf, initialSpecials, specialsOf } from '../stats.js';
import { baseSpecial } from '../items.js';
import * as Items from '../items.js';
import * as Nodes from '../nodes.js';
import * as Run from '../run.js';
import { freshProfile, unlockedOf, FlameError } from '../save.js';
import { candidates } from '../map.js';
import { homeStage } from '../../league/rules.js';

const argv = process.argv.slice(2), mode = argv[0] ?? 'list';
const flag = (n, d) => { const a = argv.find((x) => x.startsWith('--' + n + '=')); return a === undefined ? d : a.slice(n.length + 3); };
const N = +flag('n', 20), BOT = +flag('bot', 2), SEAT = +flag('seat', 0), JSONOUT = flag('json', null), DATA = flag('data', null);
// --xheal=NN [실험용, 서버에 없는 규칙]: run 모드에서 승리할 때마다 전원 최대 HP 의 NN% 를 회복시킨다(백엔드 요청안의 기대 효과를 재는 용도. 데이터·서버 코드는 바꾸지 않는다)
const XHEAL = +flag('xheal', 0);
// --xboss-heal=NN [실험용, 서버에 없는 규칙, analysis/40 §16.4]: 구간 보스를 이기고 도전이 이어질 때 전원 최대 HP 의 NN% 를 더 회복시킨다(서버의 승리 뒤 회복 afterWinHealPct 위에 얹는다 -> 보스 뒤 합계 = afterWinHealPct + NN)
//   (영입실 입장 회복은 서버 규칙이다: run_config recruitRoom.healPct, 39 D29. 값 비교는 --data 로 준 사본에서 그 키를 바꿔 잰다, §16.6)
// --train=T05,T02 [정책]: 봇이 특훈장에서 주장에게 찍는 특훈(방문당 picksPerVisit 회까지 차례로). 기본값이 종전 봇이다. 특훈 몰아주기·능력치 상한(statCaps) 측정용(§16.5)
const XBOSS = +flag('xboss-heal', 0), TRAIN = flag('train', 'T05,T02').split(',');
// --train-mode=captain|focus|spread [정책·자작, analysis/40 §18.2]: captain(기본) = 종전 봇(주장에게 --train 목록을 한 번씩). 그대로면 출력·JSON 이 종전과 같다.
//   focus = 몰아주기: 방문마다 picksPerVisit 회를 다 쓴다. --train 목록을 돌아가며 주장에게 찍고, 주장이 누적 상한(FLAME_TRAIN_CAP)에 걸리면 특훈 누적이 가장 많은 다른 선수에게 넘긴다(그 능력치가 전원 막히면 목록의 다음 특훈).
//   spread = 고르게: 같은 순서로 돌되 지금 내야(라인업 0~3)에서 그 능력치 누적이 가장 적은 선수에게 찍는다.
// --train-pri=default|pref|first [정책·자작]: 특훈장을 고르는 순위. default = 종전(휴식 > 상점 > 특훈). pref = 휴식 > 특훈 > 상점. first = 특훈이 맨 앞(포인트가 회당 비용 이상일 때) = "특훈장에 가는 사람" 대용.
const TRAIN_MODE = flag('train-mode', 'captain'), TRAIN_PRI = flag('train-pri', 'default');
if (!['captain', 'focus', 'spread'].includes(TRAIN_MODE) || !['default', 'pref', 'first'].includes(TRAIN_PRI)) throw new Error('--train-mode 는 captain|focus|spread, --train-pri 는 default|pref|first');
const TRAIN_ON = TRAIN_MODE !== 'captain' || TRAIN_PRI !== 'default';
const RECRUIT = flag('recruit', 'off');
if (!['off', 'safe', 'always', 'visit'].includes(RECRUIT)) throw new Error('--recruit 는 off|safe|always|visit');
// 봇 영입 정책값 [정책·자작, analysis/42 §12]. RECRUIT_HP = safe 가 영입실을 고르는 팀 HP 문턱(%), RECRUIT_MARGIN = 후보 점수가 교체 대상 점수를 이만큼 넘어야 영입한다.
// 기본값이 곧 주 지표(safe)의 정의다. 종전 초안(42 §7.2)은 80 / 3 이었다: --recruit-hp=80 으로 다시 잴 수 있다.
const RECRUIT_HP_DEFAULT = 60, RECRUIT_MARGIN_DEFAULT = 3;
const RECRUIT_HP = +flag('recruit-hp', RECRUIT_HP_DEFAULT), RECRUIT_MARGIN = +flag('recruit-margin', RECRUIT_MARGIN_DEFAULT);
// --artifact=off|team: 팀 공용 아티팩트 스위치(decisions.json artifact.model, D58)를 바꿔 잰다(데이터 파일은 그대로). 생략 = 파일 값(기본 off)
const ART = flag('artifact', null);
if (ART !== null && !['off', 'team'].includes(ART)) throw new Error('--artifact 는 off|team');
const data = loadData(), cat = loadCatalog({ ...(DATA ? { dir: path.resolve(DATA) } : {}), ...(ART ? { patch: (raw) => { raw.decisions.artifact = { ...(raw.decisions.artifact ?? {}), model: ART }; } } : {}) });
// ---------- 엔드리스(무한 구간, analysis/39 D24) 측정 옵션. 엔드리스가 꺼져 있으면(FLAME_ENDLESS=0 · endless.json enabled:false · 파일 없음) 아래 옵션은 전부 쓰이지 않고 출력·JSON 이 종전과 같다(analysis/40 §15.1 대조) ----------
// --max-seg=N(기본 12): 구간 N 의 보스를 이기면 그 도전을 "상한 도달"로 세고 멈춘다(끝이 없는 도전을 끊는 측정 상한. 서버 규칙이 아니다). --max-nodes = 판당 노드 안전 상한(기본 max-seg × 25 + 80).
// --endless-bot=late|all|off [정책·자작]: 봇의 포인트 사용 규칙(남는 장비 판매 + 낀 장비 강화). late(기본) = 구간 4 부터만 -> 1~12번째 경기는 엔드리스를 끈 측정과 판별로 같다. all = 처음부터. off = 종전 봇 그대로(팔지도 강화하지도 않는다 -> 장비 상한에 닿는 시점을 재는 용도).
// --xopp=P [실험용, 서버·엔진에 없는 규칙 = 39 D25 미구현]: 구간 --xopp-from(기본 4) 부터 상대 팀 능력치(--xopp-stats, 기본 hp,def,pow,s5)에 구간마다 +P% 씩(구간 4 = +P, 5 = +2P …) 곱한다.
//   엔진 코드를 고치지 않고 이 도구가 Match 에 넘기는 data 의 복사본에서 그 상대 팀만 키운다(전역 data·서버에는 영향 없음). "필요한 가산 폭"을 재는 용도다.
const MAXSEG = +flag('max-seg', 12), NODE_MAX = cat.endless ? +flag('max-nodes', MAXSEG * 25 + 80) : 80;
const EBOT = flag('endless-bot', 'late');
if (!['late', 'all', 'off'].includes(EBOT)) throw new Error('--endless-bot 는 late|all|off');
const XOPP = +flag('xopp', 0), XOPP_FROM = +flag('xopp-from', 4), XOPP_STATS = flag('xopp-stats', 'hp,def,pow,s5').split(',');
// --xopp-base=B [실험용]: 구간 1 부터 전 구간의 상대 능력치에 B% 를 더한다(음수 = 상대를 약하게). 사람 숙련자의 조작 우위를 흉내 내는 대용이다(봇은 숙련 조작을 못 한다, 40 §13.1) — 실제 조작이 아니라 "우위가 상대 능력 B% 에 해당하는 플레이어"라는 가정이다
const XOPP_BASE = +flag('xopp-base', 0);
const xoppCache = new Map();
/** 실험용 상대 가산: 구간 segNo(1부터)의 상대 팀만 키운 data 복사본(가산이 없으면 원본 그대로) */
function dataFor(team, segNo) {
  if (!cat.endless) return data;
  const mult = 1 + XOPP_BASE / 100 + (XOPP > 0 && segNo >= XOPP_FROM ? (XOPP / 100) * (segNo - XOPP_FROM + 1) : 0), key = `${team}:${segNo}`;
  if (mult === 1) return data;
  if (!xoppCache.has(key)) xoppCache.set(key, { ...data, teams: data.teams.map((t, i) => (i !== team ? t : { ...t, players: t.players.map((p) => ({ ...p, ai: p.ai.slice(), ...Object.fromEntries(XOPP_STATS.map((k) => [k, Math.min(255, Math.round(p[k] * mult))])) })) })) });
  return xoppCache.get(key);
}
const wilson = (w, n) => { if (!n) return [0, 1]; const p = w / n, z = 1.96, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)]; };
const pct = (x) => (100 * x).toFixed(0);
const ONE = 65536;

// ---------- 빌드 정의(cond) ----------
// eq = 선수 번호별 [머리띠, 장갑, 보호대, 복장] (null = 없음). lv = 강화 단계(전부 같은 값). who = 장비를 끼는 선수(기본 내야 0~3).
const SLOT = ['headband', 'glove', 'protector', 'uniform'];
const all4 = (ids, who = [0, 1, 2, 3]) => Object.fromEntries(who.map((i) => [i, ids]));
const ALL7 = [0, 1, 2, 3, 4, 5, 6];
const BUILDS = {
  base: { note: '시작 7명, 장비 없음, 필살기 잠금' },
  common4: { note: '내야 4명 일반 장비(H02 G01 P02 U01)', eq: all4(['H02', 'G01', 'P02', 'U01']) },
  rare4: { note: '내야 4명 희귀 장비(H06 G05 P05 U05)', eq: all4(['H06', 'G05', 'P05', 'U05']) },
  epic4: { note: '내야 4명 영웅 장비(H08 G08 P09 U08), 아티팩트 없음', eq: all4(['H08', 'G08', 'P09', 'U08']) },
  epic4art: { note: '영웅 장비 + A01 불꽃 해금 + A13 + A19, 포메이션 7(공격형), 전원 불꽃슛 22', eq: all4(['H08', 'G08', 'P09', 'U08']), arts: ['A01', 'A13', 'A19'], fm: 7, sp: 22 },
  legend4art: { note: '내야 4명 전설 장비(H10 G10 P10 U10) + A01 A07 A13, 전원 불꽃슛 22', eq: all4(['H10', 'G10', 'P10', 'U10']), arts: ['A01', 'A07', 'A13'], fm: 7, sp: 22 },
  art_only: { note: '장비 없음 + A01 A13 A19(필살기 해금만), 전원 불꽃슛 22', arts: ['A01', 'A13', 'A19'], fm: 7, sp: 22 },
  art_own: { note: '장비 없음 + A01(통키만 원래 불꽃슛 22, 나머지 잠금)', arts: ['A01'], fm: 7 },
  sp25: { note: '장비 없음 + A01, 전원 불꽃슛 25(위력 85)', arts: ['A01'], fm: 7, sp: 25 },
  // §14.3 위험 항목
  def_max: { note: '방어 극단: 전원 P09+3 + A09 A22 A18(수비형 5) + 수비 특훈 +2 + 영구 성장 방어 +2', eq: all4([null, null, 'P09', null], ALL7), lv: 3, arts: ['A09', 'A22', 'A18'], fm: 5, train: { s1: 2 }, perm: { PA02: 2 } },
  def_mid: { note: '방어 중간: 내야 P07 + A22', eq: all4([null, null, 'P07', null]), arts: ['A22'] },
  spd_max: { note: '이속 극단: 전원 H03 U05+3 + A10(속공형 8) + 달리기 특훈 +2', eq: all4(['H03', null, null, 'U05'], ALL7), lv: 3, arts: ['A10'], fm: 8, train: { s2: 2 } },
  pow_stack: { note: '공격 중복: 전원 H06 G05+3 + A13 A19 A18(공격형 7) + 투구 특훈 +4, 필살기 잠금', eq: all4(['H06', 'G05', null, null], ALL7), lv: 3, arts: ['A13', 'A19', 'A18'], fm: 7, train: { s4: 4 } },
  sp_stack: { note: '필살 위력 중복: 전원 H08 G10 + A01 A07 A13(SY01 +10% SX01 +4), 전원 불꽃슛 25', eq: all4(['H08', 'G10', null, null], ALL7), arts: ['A01', 'A07', 'A13'], fm: 7, sp: 25 },
  r1r3_max: { note: '넉백 저항 60% + 쓰러짐 36f: 전원 P09 + A17 A26 A25(수비형 5) + 특훈 r1 +10, r3 +20', eq: all4([null, null, 'P09', null], ALL7), arts: ['A17', 'A26', 'A25'], fm: 5, train: { r1: 10, r3: 20 } },
  full7: { note: '7명 전원 최고 장비 +3(H08 G10 P09 U08) + A01 A07 A13 + 영구 성장 A 전부 + 특훈(공격 +4 방어 +2), 전원 불꽃슛 25', eq: all4(['H08', 'G10', 'P09', 'U08'], ALL7), lv: 3, arts: ['A01', 'A07', 'A13'], fm: 7, sp: 25, train: { s4: 4, s1: 2 }, perm: { PA01: 3, PA02: 2, PA03: 2, PA04: 2 } },
  full7_nosp: { note: 'full7 에서 필살기만 잠금(A19 A13 A22)', eq: all4(['H06', 'G10', 'P09', 'U08'], ALL7), lv: 3, arts: ['A19', 'A13', 'A22'], fm: 7, train: { s4: 4, s1: 2 }, perm: { PA01: 3, PA02: 2, PA03: 2, PA04: 2 } },
  // §16.5 특훈 몰아주기(전원에게 같은 특훈 값. 한 선수 몰아주기의 위쪽 한계를 보는 용도)
  hp_112: { note: '체력 특훈으로 전원 HP 를 상한 112 근처까지(+32 = T01 4회분)', train: { s0: 32 } },
  hp_189: { note: '체력 특훈 +104(= T01 13회분, 하플레이 관측 HP 189 급)', train: { s0: 104 } },
  def_t10: { note: '수비 특훈 +10(T02 10회분)', train: { s1: 10 } },
  def_t20: { note: '수비 특훈 +20(T02 20회분)', train: { s1: 20 } },
  pow_t20: { note: '투구 특훈 +20(T05 10회분)', train: { s4: 20 } },
  pow_t40: { note: '투구 특훈 +40(T05 20회분)', train: { s4: 40 } },
  // §18.2 특훈 누적 상한(training.maxPerStat) 값 측정. train = 전원, train0 = 주장(라인업 0)만. 이름을 + 로 이으면 합친 빌드다(예: rare4+one_cap)
  def_t4: { note: '수비 특훈 +4 전원(def_max·full7 의 +2 에 더해 상한 6 을 채우는 용도)', train: { s1: 4 } },
  def_t8: { note: '수비 특훈 +8 전원(def_max 의 +2 에 더해 +10)', train: { s1: 8 } },
  pow_t8: { note: '투구 특훈 +8 전원(full7 의 +4 에 더해 상한 12 를 채우는 용도)', train: { s4: 8 } },
  def_t6: { note: '수비 특훈 +6(T02 6회분 = 상한 s1 6) 전원', train: { s1: 6 } },
  pow_t12: { note: '투구 특훈 +12(T05 6회분 = 상한 s4 12) 전원', train: { s4: 12 } },
  cap_all: { note: '전원이 세 상한을 다 채움(HP +32 방어 +6 공격 +12 = 16회 × 7명)', train: { s0: 32, s1: 6, s4: 12 } },
  one_cap: { note: '주장 한 명만 세 상한을 다 채움(16회 = 800점)', train0: { s0: 32, s1: 6, s4: 12 } },
  one_hack: { note: '주장 한 명 몰아주기 HP +104 공격 +28(하플레이 훅 HP 189·공격 57 급. 상한·statCaps.s0 를 뺀 --data 사본에서만 그 값이 된다)', train0: { s0: 104, s4: 28 } },
  one_pow28: { note: '주장 한 명 공격 +28', train0: { s4: 28 } },
  one_pow12: { note: '주장 한 명 공격 +12(상한)', train0: { s4: 12 } },
  one_hp32: { note: '주장 한 명 HP +32(상한)', train0: { s0: 32 } },
  one_def6: { note: '주장 한 명 방어 +6(상한)', train0: { s1: 6 } },
  one_def20: { note: '주장 한 명 방어 +20', train0: { s1: 20 } },
  perm_only: { note: '장비 없음 + 영구 성장 A 전부(HP +6 방어 +2 공격 +2 캐치 +2)', perm: { PA01: 3, PA02: 2, PA03: 2, PA04: 2 } },
};

/** 빌드 이름(+ 로 이으면 합친다: 뒤 빌드가 앞 빌드를 덮고 train·train0·perm 은 합산) */
function buildOf(name) {
  const parts = name.split('+').map((n) => BUILDS[n] ?? (() => { throw new Error('없는 빌드: ' + n); })());
  if (parts.length === 1) return parts[0];
  const sum = (k) => { const o = {}; for (const p of parts) for (const [s, v] of Object.entries(p[k] ?? {})) o[s] = (o[s] ?? 0) + v; return o; };
  return { ...Object.assign({}, ...parts), train: sum('train'), train0: sum('train0'), perm: sum('perm'), note: parts.map((p) => p.note).join(' + ') };
}
/** 빌드 -> computeTeam 입력(실제 서버와 같은 계산 경로) */
function ctxOf(b) {
  const items = [];
  let inst = 1;
  // 시작 라인업은 서버와 같은 함수로 얻는다(오리지널 팀 D17 이 켜져 있으면 그 7명의 base, 아니면 태동). 종전에는 decisions.json startTeam 을 직접 읽었다
  const roster = startLineup(cat).players.map(({ from, orig }, i) => {
    const equip = Object.fromEntries(SLOT.map((s) => [s, null]));
    (b.eq?.[i] ?? []).forEach((id, k) => { if (id) { items.push({ inst, id, lv: b.lv ?? 0 }); equip[SLOT[k]] = inst++; } });
    return { from, ...(orig ? { orig } : {}), train: { ...(b.train ?? {}), ...(i === 0 ? b.train0 ?? {} : {}) }, equip, recruited: false };
  });
  // off(D58): 빌드의 arts 중 필살슛 아이템은 라인업 앞 선수부터 한 명에 하나씩 끼고(roster[i].spItem), 첫 포메이션 아이템이 팀 칸(fmItem)이다
  const arts = b.arts ?? [], fmItem = teamArtifactsOn(cat) ? null : arts.find((a) => cat.artifacts.get(a)?.grant?.formation !== undefined) ?? null;
  if (!teamArtifactsOn(cat)) { let k = 0; for (const a of arts) if (cat.artifacts.get(a)?.grant?.shot !== undefined && roster[k]) roster[k++].spItem = a; }
  return { roster, items, artifacts: arts, fmItem, fm: b.fm ?? cat.cfg.formation.default, perm: b.perm ?? {}, buffs: [] };
}
function flameOf(b, seat = 0) {
  // 필살기 슬롯은 서버와 같은 경로로 만든다(정검수 M2): 새로 드는 선수의 시작값(initialSpecials: 불씨·클론 = 낀 아이템의 대표 슛 | 없음, 원작 선수 = 고유 슛) -> 선수별 발동 가능 집합으로 정리(specialsOf).
  // 빌드가 슛을 지정하면(b.sp) 그 값을 넣되 같은 정리를 거친다(부여되지 않은 슛은 비워진다). 종전에는 원작 필살기를 그대로 넣어 부여 구조(D38)·등급제(D39~)와 어긋났다
  const ctx = ctxOf(b);
  for (const r of ctx.roster) r.sp = b.sp !== undefined && b.sp !== null ? [b.sp, null] : initialSpecials(cat, data, r, ctx.artifacts);
  const team = computeTeam(cat, data, ctx), sps = specialsOf(cat, data, ctx.roster, ctx.artifacts);
  const roster = ctx.roster.map((r, i) => {
    const e = toEngine(team.players[i]);
    return { from: { ...r.from }, stat: e.stat, ext: e.ext, sp: sps[i], fx: e.fx };
  });
  return { team, opts: { seat, roster, allow: team.allow, families: cat.families, fm: team.fm, caps: { ...cat.engineCaps } } }; // team.fm = 실제로 쓰이는 패턴(등급제: 포메이션 아이템이 없으면 기본 포메이션)
}

// ---------- 상대 묶음 ----------
const OPPS = {};
cat.cfg.opponents.segments.forEach((S, s) => {
  for (const [k, t] of [['n', 'normal'], ['s', 'strong'], ['b', 'boss']]) {
    OPPS[`seg${s + 1}${k}`] = S[t].map((team) => ({ team, lv: S.cpuLevel[t], label: `구간${s + 1} ${t}` }));
    if (S.unlocked) OPPS[`seg${s + 1}${k}u`] = S.unlocked[t].map((team) => ({ team, lv: S.cpuLevel[t], label: `구간${s + 1} ${t}(해금)` }));
  }
});
// 직접 지정: --opps=t5@1,t23@3
const oppsOf = (spec) => spec.split(',').flatMap((s) => { const m = /^t(\d+)@(\d)$/.exec(s); if (m) return [{ team: +m[1], lv: +m[2], label: '지정' }]; if (!OPPS[s]) throw new Error('없는 상대 묶음: ' + s); return OPPS[s]; });

// ---------- 한 경기 ----------
const DATA0 = data;
/** @returns {{win, reason, clock, rem, hpPct, st}} st = 경기 통계 */
function playMatch({ seed, flame, oppTeam, oppLv, botLv = BOT, limitMin = cat.cfg.match.timeMin, data: dataIn = null }) {
  const seat = flame.seat ?? 0, opp = 1 - seat, teams = [0, 0], data = dataIn ?? DATA0; // data = 실험용 상대 가산(--xopp)일 때만 복사본
  teams[opp] = oppTeam;
  const cpuLevels = [0, 0]; cpuLevels[seat] = botLv; cpuLevels[opp] = oppLv;
  const m = new Match({ seed, teams, data, humans: [false, false], cpuLevels, stage: homeStage(data.stages, oppTeam), limitFrames: limitMin * 3600, ruleMode: cat.cfg.match.ruleMode, flame });
  const st = { hitsOn: 0, zeroOn: 0, dmgOn: 0, hitsBy: 0, dmgBy: 0, zeroBy: 0, spBy: 0, spOpp: 0, spHitOn: 0, catchBy: 0, catchOpp: 0, throwBy: 0, throwOpp: 0, fm: 0, survive: 0, knock: 0, knockN: 0, reMine: 0, reN: 0, reFrames: 0, firstOutF: -1 };
  let n = 0, wait = null; // wait = flame 좌석이 맞은 뒤 다음 투구가 누구 것인지 기다리는 중
  while (m.phase !== 'end' && n++ < 80000) {
    m.tick([0, 0]);
    for (const e of m.drainEvents()) {
      const mine = e.p !== undefined && m.players[e.p]?.seat === seat;
      if (e.k === 'hit') {
        const q = m.players[e.p], inner = q.slot < 4;
        if (mine) {
          if (inner) { st.hitsOn++; st.dmgOn += e.dmg; if (e.dmg === 0) st.zeroOn++; if (e.kind) st.spHitOn++; }
          st.knock += Math.hypot(q.vx, q.vy) / ONE; st.knockN++;
          wait = { f: m.f };
        } else if (inner) { st.hitsBy++; st.dmgBy += e.dmg; if (e.dmg === 0) st.zeroBy++; }
      } else if (e.k === 'throw') {
        if (mine) st.throwBy++; else st.throwOpp++;
        if (wait) { st.reN++; if (mine) { st.reMine++; st.reFrames += m.f - wait.f; } wait = null; }
      } else if (e.k === 'special') { if (mine) st.spBy++; else st.spOpp++; }
      else if (e.k === 'catch') { if (mine) st.catchBy++; else st.catchOpp++; }
      else if (e.k === 'fm_start' && e.seat === seat) st.fm++;
      else if (e.k === 'fl_survive') st.survive++;
      else if (e.k === 'out' && st.firstOutF < 0) st.firstOutF = m.f;
    }
  }
  const r = m.result, fr = m.flameResult();
  return {
    win: !!r && r.winner === seat, reason: r ? r.reason : 'unfinished', clock: m.clock, rem: [m.sides[seat].remaining, m.sides[opp].remaining],
    hp: fr.hp, maxHp: fr.maxHp, hpPct: fr.hp.reduce((s, v) => s + v, 0) / fr.maxHp.reduce((s, v) => s + v, 0), surviveUsed: fr.surviveUsed, st,
  };
}

const sumSt = (rows) => { const o = {}; for (const r of rows) for (const [k, v] of Object.entries(r.st)) o[k] = (o[k] ?? 0) + v; return o; };
function summarize(rows) {
  const n = rows.length, w = rows.filter((r) => r.win).length, S = sumSt(rows), [lo, hi] = wilson(w, n);
  const tu = rows.filter((r) => r.reason === 'timeup' || r.reason === 'sudden_death').length;
  return {
    n, win: w, rate: w / n, ci: [lo, hi], avgSec: rows.reduce((s, r) => s + r.clock, 0) / n / 60, timeupRate: tu / n, draws: rows.filter((r) => ['draw_cap', 'unfinished'].includes(r.reason)).length,
    remMine: rows.reduce((s, r) => s + r.rem[0], 0) / n, remOpp: rows.reduce((s, r) => s + r.rem[1], 0) / n, hpLeft: rows.reduce((s, r) => s + r.hpPct, 0) / n,
    hitsOn: S.hitsOn / n, zeroOnRate: S.hitsOn ? S.zeroOn / S.hitsOn : 0, avgDmgOn: S.hitsOn ? S.dmgOn / S.hitsOn : 0, hitsBy: S.hitsBy / n, avgDmgBy: S.hitsBy ? S.dmgBy / S.hitsBy : 0, zeroByRate: S.hitsBy ? S.zeroBy / S.hitsBy : 0,
    spBy: S.spBy / n, spOpp: S.spOpp / n, catchBy: S.catchBy / n, catchOpp: S.catchOpp / n, throwBy: S.throwBy / n, throwOpp: S.throwOpp / n, fm: S.fm / n, survive: S.survive / n,
    knockPx: S.knockN ? S.knock / S.knockN : 0, rePossess: S.reN ? S.reMine / S.reN : 0, reFrames: S.reMine ? S.reFrames / S.reMine : 0,
    quickEnd: rows.filter((r) => r.clock < 1800).length / n, // 30초 안에 끝난 경기 비율(첫 턴 킬에 해당하는 지표)
  };
}
const line = (label, s) => `${label} | ${pct(s.rate)}% [${pct(s.ci[0])}-${pct(s.ci[1])}] ${s.win}/${s.n} | ${s.avgSec.toFixed(0)}s | 시간종료 ${pct(s.timeupRate)}% | 남은 ${s.remMine.toFixed(1)}:${s.remOpp.toFixed(1)} | HP남음 ${pct(s.hpLeft)}% | 피격 ${s.hitsOn.toFixed(1)}(평균 ${s.avgDmgOn.toFixed(1)}, 0피해 ${pct(s.zeroOnRate)}%) | 가격 ${s.hitsBy.toFixed(1)}(평균 ${s.avgDmgBy.toFixed(1)}) | 필살 ${s.spBy.toFixed(1)}:${s.spOpp.toFixed(1)} | 캐치 ${s.catchBy.toFixed(1)}:${s.catchOpp.toFixed(1)} | 넉백 ${s.knockPx.toFixed(2)}px/f | 피격 뒤 내 공 ${pct(s.rePossess)}% ${s.reFrames.toFixed(0)}f`;

// ---------- cond ----------
function runCond() {
  const builds = flag('builds', 'base').split(','), opps = oppsOf(flag('opps', 'seg1n')), out = [];
  console.log(`cond n=${N}/상대 bot=${BOT} seat=${SEAT} data=${DATA ?? 'server/flame/data'} ver=${cat.ver}`);
  console.log('빌드 vs 상대(레벨) | 승률 [95%CI] 승/판 | 평균 경기시간 | 시간종료 | 남은 인원 나:상대 | 내 팀 HP | 내 내야 피격/경기 | 내가 맞힌 횟수 | 필살 나:상대 | 캐치 나:상대 | 넉백 속력 | 피격 뒤 다음 투구가 내 것');
  for (const bn of builds) {
    const b = buildOf(bn);
    const { opts } = flameOf(b, SEAT), allRows = [], byLabel = new Map();
    for (const o of opps) {
      const rows = [];
      for (let i = 1; i <= N; i++) rows.push(playMatch({ seed: 100000 + o.team * 1000 + o.lv * 100 + 2 * i, flame: opts, oppTeam: o.team, oppLv: o.lv }));
      const s = summarize(rows);
      console.log(line(`${bn} vs t${o.team}(L${o.lv})`, s));
      out.push({ build: bn, team: o.team, lv: o.lv, label: o.label, ...s });
      allRows.push(...rows);
      if (!byLabel.has(o.label)) byLabel.set(o.label, []);
      byLabel.get(o.label).push(...rows);
    }
    for (const [lb, rows] of byLabel) { const s = summarize(rows); console.log(line(`== ${bn} vs [${lb}] 합계`, s)); out.push({ build: bn, team: 'all', label: lb, ...s }); }
  }
  if (JSONOUT) writeFileSync(JSONOUT, JSON.stringify({ mode: 'cond', n: N, bot: BOT, seat: SEAT, ver: cat.ver, rows: out }, null, 1));
}

// ---------- run: 도전 한 판(정책 봇) ----------
const PERMS = {
  none: {},
  mid: { PA01: 2, PA02: 1, PA03: 1, PA04: 1, PB01: 2, PB02: 1, PB03: 1, PB05: 1, PB07: 1 },
  full: { PA01: 3, PA02: 2, PA03: 2, PA04: 2, PB01: 3, PB02: 2, PB03: 2, PB04: 3, PB05: 3, PB06: 2, PB07: 2, PC01: 2, PC02: 1, PC03: 2, PC04: 1 },
};
const soft = (fn) => { try { fn(); return true; } catch (e) { if (e instanceof FlameError) return false; throw e; } };
// 아티팩트 선호 순서 [정책, 자작]: 필살기 해금 -> 위력 -> 팀 능력치
const ART_PREF = ['A01', 'A05', 'A04', 'A06', 'A03', 'A02', 'A07', 'A13', 'A19', 'A08', 'A22', 'A20', 'A27', 'A23', 'A26', 'A25', 'A30', 'A18', 'A11', 'A21', 'A24', 'A29', 'A28', 'A09', 'A14', 'A17', 'A16', 'A10', 'A12', 'A15'];
// 등급 아이템(D39) [정책, 자작 — 임밸런이 조정]: 필살슛 아이템 > 포메이션 아이템 > 손으로 쓴 아티팩트, 같은 종류 안에서는 높은 등급 먼저
const artRank = (id) => { const d = cat.artifacts.get(id); if (d?.grant) return (d.kind === 'shot' ? -20 : -10) - cat.grade.grades.indexOf(d.grade); const i = ART_PREF.indexOf(id); return i < 0 ? 99 : i; };
const itemScore = (id) => { const d = cat.items.get(id); return cat.rarityRank[d.rarity] * 10 + (d.stats.s4 ?? 0) * 2 + (d.stats.s1 ?? 0) * 2 + (d.stats.s0 ?? 0) / 4 + d.effects.length * 2; };

/**
 * off(D58) 봇 배치 [정책·자작 — 임밸런이 조정]: 포메이션 아이템 = 가장 높은 등급(같으면 먼저 얻은 것) 1칸.
 * 필살슛 아이템 = 위력(표값 + 등급 가산)이 큰 것부터, 아직 아이템이 없는 선수 중 지금 주 슬롯 위력이 가장 낮은 선수(같으면 라인업 앞)에게 하나씩 — 그 선수의 고유 슛보다 셀 때만
 */
function arrangeOff(run) {
  const pw = data.specials.power, G = (a) => cat.grade.grades.indexOf(cat.artifacts.get(a).grade);
  const fms = run.artifactsOwned.filter((a) => cat.artifacts.get(a)?.grant?.formation !== undefined).sort((a, b) => G(b) - G(a));
  Items.setFmItem(cat, run, fms[0] ?? null);
  for (let i = 0; i < run.roster.length; i++) Items.setSpItem(cat, data, run, i, null);
  const eff = (a) => pw[cat.artifacts.get(a).grant.shot] + cat.grade.spPow[cat.artifacts.get(a).grade];
  const shots = run.artifactsOwned.filter((a) => cat.artifacts.get(a)?.grant?.shot !== undefined).sort((a, b) => eff(b) - eff(a));
  for (const a of shots) {
    const k = run.roster.map((r, i) => [r.sp[0] === null ? -1 : pw[r.sp[0]], i]).filter(([, i]) => !run.roster[i].spItem).sort((x, y) => x[0] - y[0] || x[1] - y[1])[0];
    if (k && eff(a) > k[0]) Items.setSpItem(cat, data, run, k[1], a);
  }
  Items.autoEquip(cat, run);
}
/** 아티팩트 3칸을 선호 순서로 채우고, 해금된 필살기 중 위력이 가장 큰 것을 필살기가 잠긴 선수의 주 슬롯에 넣는다(D3). off(D58)는 arrangeOff */
function arrange(run) {
  if (!teamArtifactsOn(cat)) return arrangeOff(run);
  const owned = run.artifactsOwned.slice().sort((a, b) => artRank(a) - artRank(b)).slice(0, cat.rules.team.artifactSlots);
  run.artifacts = [...owned, null, null, null].slice(0, cat.rules.team.artifactSlots);
  const allow = allowOf(cat, owned), pw = data.specials.power;
  const best = allow.slice().sort((a, b) => pw[b] - pw[a])[0];
  if (best !== undefined) for (const r of run.roster) if (!allow.includes(r.sp[0]) || pw[r.sp[0]] < pw[best]) r.sp = [best, r.sp[0] === best ? null : r.sp[1]];
  Items.autoEquip(cat, run);
}
// ---------- 봇 영입 정책(analysis/42 §7.2 초안, [정책·자작]) ----------
let REC = null; // 지금 도는 도전의 영입 기록 {visits, sawRare, recs[]}
/** 점수(42 §2.1): Σ (능력치 − 기준값) ÷ 단위. 풀 파일의 model 을 쓴다(풀이 없는 데이터 폴더면 null) */
function ptsOf(base) {
  const M = cat.pool?.model;
  return M ? Object.entries(ENGINE_STAT).reduce((s, [k, ek]) => s + (base[k] - M.anchor[ek]) / M.unit[ek], 0) : null;
}
/** 영입할 후보와 교체 자리. 영입하지 않으면 null */
function recruitPick(run, profile, pend) {
  const team = Run.viewOf(cat, data, run, profile).team;
  // 교체 대상: 주인공을 뺀 선수 중 점수(기본 + 영구 성장 A)가 가장 낮은 선수
  const mine = run.roster.map((r, i) => {
    const pl = team.players[i], perm = pl.steps[1].add, st = Object.fromEntries(STAT_KEYS.map((k) => [k, pl.base[k] + (perm[k] ?? 0)]));
    return { i, pts: ptsOf(st), role: cloneOf(cat, r)?.role ?? originalOf(cat, r)?.role ?? pl.role, locked: isLockedPlayer(cat, r) };
  });
  if (mine[0].pts === null) return null;
  const roles = new Set(mine.map((m) => m.role)), tgt = mine.filter((m) => !m.locked).sort((a, b) => a.pts - b.pts || b.i - a.i)[0];
  let best = null;
  pend.choices.forEach((c, i) => {
    const v = recruitView(cat, data, c), role = v.role ?? roleOf(cat, data, { ...v.stat, r1: 0, r2: 0, r3: 0 });
    const score = ptsOf(v.stat) + (roles.has(role) ? 0 : ['guard', 'ace'].includes(role) ? 4 : 2); // 역할 빈자리 가산: 없는 역할 +2, 수비·에이스가 없으면 +4
    if (!best || score > best.score) best = { i, score, grade: v.grade ?? 'O', id: v.id ?? `${v.team}:${v.idx}`, role };
  });
  if (REC && best && tgt) REC.seen.push({ seg: run.seg, best: best.grade, score: best.score, tgt: +tgt.pts.toFixed(2) }); // 진단용: 방문마다 가장 좋은 후보와 교체 대상 점수
  return best && tgt && best.score >= tgt.pts + RECRUIT_MARGIN ? { ...best, p: tgt.i, out: run.roster[tgt.i].orig ?? run.roster[tgt.i].clone ?? `${run.roster[tgt.i].from.team}:${run.roster[tgt.i].from.idx}`, tgt: +tgt.pts.toFixed(2) } : null;
}
function resolve(run, profile) {
  while (run.pending.length) {
    const p = run.pending[0], maxHp = Run.viewOf(cat, data, run, profile).team.players.map((x) => x.final.s0);
    if (p.kind === 'equipment') { const i = p.choices.map((id, k) => [itemScore(id), k]).sort((a, b) => b[0] - a[0])[0]?.[1] ?? -1; const note = Run.choose(cat, data, run, profile, i); if (EST && note?.full) { EST.fullSold++; EST.fullPts += note.sold; } }
    else if (p.kind === 'artifact') { const i = p.choices.map((id, k) => [artRank(id), k]).sort((a, b) => a[0] - b[0])[0]?.[1] ?? -1; Run.choose(cat, data, run, profile, i); }
    else if (p.kind === 'recruit') {
      const pick = RECRUIT === 'off' || RECRUIT === 'visit' ? null : recruitPick(run, profile, p); // visit = 진단용: 영입실에는 always 처럼 가되 영입하지 않는다(휴식·이벤트를 포기한 값만 잰다)
      if (REC) { REC.visits++; if (p.choices.some((c) => c.rare)) REC.sawRare = true; if (pick) REC.recs.push({ seg: run.seg, grade: pick.grade, id: pick.id, role: pick.role, out: pick.out, score: pick.score, tgt: pick.tgt }); }
      if (pick) Run.choose(cat, data, run, profile, pick.i, pick.p); else Run.choose(cat, data, run, profile, -1); // 빠진 선수의 장비는 아래 arrange 의 자동 장착이 다시 끼운다
    }
    else if (p.kind === 'rest') {
      const miss = run.roster.map((r, k) => maxHp[k] - r.hp), o = cat.cfg.rest.options;
      const teamGain = miss.reduce((s, v, k) => s + Math.min(v, Math.round(maxHp[k] * o[0].healPct / 100)), 0), k1 = miss.indexOf(Math.max(...miss)), oneGain = Math.min(miss[k1], Math.round(maxHp[k1] * o[1].healPct / 100));
      if (teamGain >= oneGain) Run.choose(cat, data, run, profile, 0, 0); else Run.choose(cat, data, run, profile, 1, k1);
    } else { // event: E03 은 장비, 나머지는 안전한 쪽
      const want = p.event === 'E03' ? 0 : p.event === 'E04' ? 1 : p.event === 'E05' ? 0 : 1;
      if (!soft(() => Run.choose(cat, data, run, profile, want))) Run.choose(cat, data, run, profile, 1);
    }
    arrange(run);
    tidy(run);
  }
}
function useHeals(run, profile) {
  for (let guard = 0; guard < 10; guard++) {
    const maxHp = Run.viewOf(cat, data, run, profile).team.players.map((x) => x.final.s0);
    const id = Object.keys(run.consumables).find((c) => cat.consumables.get(c).kind === 'heal');
    if (!id) return;
    const amt = cat.consumables.get(id).effects[0].params.value, k = run.roster.map((r, i) => [maxHp[i] - r.hp, i]).sort((a, b) => b[0] - a[0])[0];
    if (k[0] < amt * 0.7 || !soft(() => Items.useConsumable(cat, run, id, k[1], maxHp))) return;
  }
}
function useBuffs(run, profile, nodeType) {
  const maxHp = Run.viewOf(cat, data, run, profile).team.players.map((x) => x.final.s0);
  for (const id of Object.keys(run.consumables)) {
    const d = cat.consumables.get(id);
    if (d.kind === 'heal') continue;
    if (d.duration === 'nextBossMatch' && nodeType !== 'boss') continue;
    soft(() => Items.useConsumable(cat, run, id, 0, maxHp));
  }
}
// ---------- 엔드리스 봇의 포인트 사용 규칙 [정책·자작, analysis/40 §15.2]. 엔드리스가 꺼져 있거나 --endless-bot=off 면 아무 일도 하지 않는다(종전 봇) ----------
const ebotOn = (run) => !!cat.endless && (EBOT === 'all' || (EBOT === 'late' && run.seg >= cat.rules.run.segments));
const SPARE_KEEP = 4, ART_WANT = 6; // 남겨 둘 여벌 장비 수 / 아티팩트를 이만큼 모을 때까지는 특훈장에서 상점 아티팩트 값을 남겨 둔다
let EST = null; // 지금 도는 도전의 진단 {sold, soldPts, upg, upgPts, fullSold, fullPts, artPts}
/** 남는 장비 판매: 자동 장착 뒤 아무도 끼지 않은 장비 중 점수 상위 SPARE_KEEP 개만 남기고 판다(판매는 어디서나 된다, run_config sell.anywhere) -> 보유 상한에 닿지 않는다 */
function tidy(run) {
  if (!ebotOn(run)) return;
  const sc = (it) => itemScore(it.id) + it.lv * 3;
  const free = run.items.filter((it) => Items.wearerOf(cat, run, it.inst) < 0).sort((a, b) => sc(b) - sc(a) || a.inst - b.inst);
  for (const it of free.slice(SPARE_KEEP)) { const p = Items.sell(cat, run, it.inst); if (EST) { EST.sold++; EST.soldPts += p; } }
}
/** 남는 포인트로 낀 장비를 강화한다(상점·특훈장에서만 부른다): 내야(라인업 0~3) 먼저, 강화 단계가 낮은 것부터. reserve 만큼은 남긴다 */
function upgradeSpare(run, profile, reserve) {
  if (!ebotOn(run)) return;
  for (let g = 0; g < 200; g++) {
    const c = run.roster.flatMap((r, i) => cat.slots.map((s) => r.equip[s]).filter((x) => x !== null && x !== undefined).map((inst) => ({ it: run.items.find((x) => x.inst === inst), inner: i < 4 ? 1 : 0 })))
      .filter((x) => x.it && cat.items.get(x.it.id).upgradeable && x.it.lv < cat.upgrade.maxLevel)
      .sort((a, b) => b.inner - a.inner || a.it.lv - b.it.lv || itemScore(b.it.id) - itemScore(a.it.id) || a.it.inst - b.it.inst)[0];
    if (!c) return;
    const cost = Items.upgradeCost(cat, profile.perm, c.it.lv);
    if (run.points - cost < reserve) return;
    Items.upgrade(cat, run, profile.perm, c.it.inst);
    if (EST) { EST.upg++; EST.upgPts += cost; }
  }
}
let SNAP = null; // snap 모드: {tiers:number[], out:[]}
let TST = null, TROT = 0; // 지금 도는 도전의 특훈 기록 {picks, rej(상한 거절), spill(주장이 아닌 선수에게 간 횟수)} / 특훈 목록 순번
/** 특훈 정책(--train-mode=focus|spread). 서버 nodes.train 을 그대로 부른다(상한·포인트·방문 횟수 검사는 서버 규칙) */
function trainPolicy(run) {
  const tot = (r) => Object.values(r.train ?? {}).reduce((s, v) => s + v, 0);
  for (let g = 0; g < 20 && run.node.picks > 0 && run.points >= cat.cfg.training.cost; g++) {
    let done = false;
    for (let k = 0; k < TRAIN.length && !done; k++) {
      const t = TRAIN[(TROT + k) % TRAIN.length], stat = cat.training.find((x) => x.id === t).stat;
      const who = TRAIN_MODE === 'focus'
        ? run.roster.map((r, i) => i).sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : tot(run.roster[b]) - tot(run.roster[a]) || a - b))
        : [0, 1, 2, 3].sort((a, b) => (run.roster[a].train?.[stat] ?? 0) - (run.roster[b].train?.[stat] ?? 0) || a - b);
      for (const p of who) {
        try { Nodes.train(cat, run, p, t); done = true; TST.picks++; if (p !== 0) TST.spill++; break; }
        catch (e) { if (!(e instanceof FlameError)) throw e; if (e.code === 'FLAME_TRAIN_CAP') TST.rej++; else break; }
      }
    }
    if (!done) break;
    TROT++;
  }
}
function visit(run, profile) {
  tidy(run);
  if (run.node?.type === 'shop') {
    const order = run.node.stock.map((g, i) => ({ g, i })).sort((a, b) => (a.g.kind === 'artifact' ? -1 : 0) - (b.g.kind === 'artifact' ? -1 : 0) || (b.g.kind === 'equipment' ? itemScore(b.g.id) : 0) - (a.g.kind === 'equipment' ? itemScore(a.g.id) : 0));
    const hurt = run.roster.some((r) => r.hp < 30);
    for (const { g, i } of order) {
      if (g.kind === 'consumable' && !(cat.consumables.get(g.id).kind === 'heal' && hurt)) continue;
      if (g.kind === 'equipment' && cat.rarityRank[cat.items.get(g.id).rarity] < 1) continue;
      soft(() => Nodes.buy(cat, run, i));
    }
    arrange(run);
    tidy(run); upgradeSpare(run, profile, 0);
    Run.leaveNode(run);
  } else if (run.node?.type === 'training') {
    if (TRAIN_MODE === 'captain') for (const t of TRAIN) { const ok = soft(() => Nodes.train(cat, run, 0, t)); if (TST && ok) TST.picks++; }
    else trainPolicy(run);
    upgradeSpare(run, profile, run.artifactsOwned.length < ART_WANT ? cat.cfg.shop.artifactPrice : 0);
    Run.leaveNode(run);
  }
}
/** 다음 층에서 고를 노드 [정책]: 경기는 첫 후보, 그 밖은 다쳤으면 휴식 > 상점(포인트 150 이상) > 특훈 > 이벤트 > 영입. --recruit=safe 는 팀 HP 가 RECRUIT_HP % 이상일 때, always·visit 는 언제나 영입이 맨 앞이다 */
function pickNode(run, profile) {
  const c = candidates(run);
  if (c.length === 1 || c[0].opp) return c[0];
  const view = Run.viewOf(cat, data, run, profile), hpPct = run.roster.reduce((s, r) => s + r.hp, 0) / view.team.players.reduce((s, x) => s + x.final.s0, 0);
  const pri = (t) => (t === 'rest' ? (hpPct < 0.8 ? 0 : 6) : t === 'shop' ? (run.points >= 150 ? 1 : 4) : t === 'training' ? (run.points >= 50 ? (TRAIN_PRI === 'first' ? -0.5 : TRAIN_PRI === 'pref' ? 0.5 : 2) : 5) : t === 'event' ? 3 : t === 'recruit' && (RECRUIT === 'always' || RECRUIT === 'visit' || (RECRUIT === 'safe' && hpPct >= RECRUIT_HP / 100)) ? -1 : 7);
  const pick = c.slice().sort((a, b) => pri(a.type) - pri(b.type))[0];
  if (REC && c.some((x) => x.type === 'recruit')) REC.layers.push({ seg: run.seg, hp: +hpPct.toFixed(3), pick: pick.type }); // 진단용: 영입 층에 섰을 때의 팀 HP 와 고른 노드
  return pick;
}
/** 라인업 [정책]: 현재 HP 가 많은 4명을 내야로(주장 자리 0 은 그대로 둔다) */
function lineup(run) {
  const rest = [1, 2, 3, 4, 5, 6].sort((a, b) => run.roster[b].hp - run.roster[a].hp);
  Run.setLineup(run, [0, ...rest]);
}

/** 실험용 회복(--xboss-heal): 전원 현재 HP += 최대 HP × pct %(최대 HP 까지). 서버 healAfterWin 과 같은 식 */
function healAll(run, profile, pct) {
  const mx = Run.viewOf(cat, data, run, profile).team.players.map((x) => x.final.s0);
  run.roster.forEach((r, k) => { r.hp = Math.min(mx[k], r.hp + Math.round(mx[k] * pct / 100)); });
}
function playRun(seed, perm, diff) {
  const profile = freshProfile();
  profile.perm = { ...perm };
  const run = Run.newRun(cat, data, profile, { seed, diff });
  const log = [];
  REC = { visits: 0, sawRare: false, recs: [], seen: [], layers: [] };
  const E = !!cat.endless; // 엔드리스가 꺼져 있으면 아래 E 분기는 전부 건너뛴다(종전 출력 그대로)
  TST = { picks: 0, rej: 0, spill: 0 }; TROT = 0;
  EST = E ? { sold: 0, soldPts: 0, upg: 0, upgPts: 0, fullSold: 0, fullPts: 0, artPts: 0, artOutSeg: null } : null;
  let end = null, champ = false, capped = false;
  for (let guard = 0; guard < NODE_MAX && !end; guard++) {
    if (E && run.seg >= MAXSEG) { capped = true; break; } // 측정 상한: 구간 MAXSEG 보스까지 이겼다
    resolve(run, profile);
    const node = pickNode(run, profile);
    if (node.opp) { useHeals(run, profile); useBuffs(run, profile, node.type); lineup(run); }
    if (SNAP && node.opp && node.type === 'boss' && SNAP.tiers.includes(run.seg + 1)) SNAP.out.push({ tier: run.seg + 1, seed, wins: log.filter((l) => l.win).length, team: snapshotOf(cat, run, profile, { seg: run.seg + 1, wins: log.filter((l) => l.win).length, now: 0 }) }); // 구간 k 보스전에 들어갈 때의 팀(= 그 보스에게 지고 끝난 도전이 저장하는 재료)
    const r = Run.enterNode(cat, data, run, profile, node.id);
    if (!r.match) { visit(run, profile); continue; }
    const o = r.match, hp0 = o.flame.roster.reduce((s, x) => s + x.hp, 0) / o.flame.roster.reduce((s, x) => s + x.stat.hp, 0);
    const res = playMatch({ seed: (seed * 7919 + log.length * 104729) * 2 % 2147483646, flame: o.flame, oppTeam: o.cpuTeam, oppLv: o.cpuLevel, data: dataFor(o.cpuTeam, run.seg + 1) });
    log.push({ seg: run.seg, type: o.type, opp: o.cpuTeam, lv: o.cpuLevel, win: res.win, hp0, hp1: res.hpPct, arts: run.artifacts.filter(Boolean).length, items: run.items.length, allow: o.flame.allow.length, outs: 7 - res.rem[1], sec: Math.round(res.clock / 60), ...(RECRUIT === 'off' ? {} : { rec: run.roster.filter((x) => x.recruited).map((x) => cloneOf(cat, x)?.grade ?? 'O') }),
      ...(E ? { pts: run.points, lvSum: run.items.reduce((s, it) => s + it.lv, 0), own: run.artifactsOwned.length, tu: res.reason !== 'annihilation' ? 1 : 0, p0pow: o.flame.roster[0].stat.pow, p0def: o.flame.roster[0].stat.def } : {}) });
    const a = Run.applyMatchResult(cat, data, run, profile, { winner: res.win ? 0 : 1, reason: ['annihilation', 'timeup', 'sudden_death'].includes(res.reason) ? res.reason : 'draw_cap', rem: res.rem, flame: { hp: res.hp, surviveUsed: res.surviveUsed } });
    end = a.end;
    if (a.champion) champ = true;
    if (EST && a.artifactPoints) { EST.artPts += a.artifactPoints; EST.artOutSeg ??= a.segCleared; }
    if (XHEAL > 0 && !end && res.win) { const mx = Run.viewOf(cat, data, run, profile).team.players.map((x) => x.final.s0); run.roster.forEach((r, k) => { r.hp = Math.min(mx[k], r.hp + Math.round(mx[k] * XHEAL / 100)); }); }
    if (XBOSS > 0 && !end && res.win && a.segCleared) healAll(run, profile, XBOSS);
  }
  const rec = REC; REC = null;
  const est = EST; EST = null;
  const tview = TRAIN_ON ? Run.viewOf(cat, data, run, profile).team.players : null;
  const tr = TRAIN_ON ? { ...TST, cap0: { ...(run.roster[0].train ?? {}) }, hp0: tview[0].final.s0, def0: tview[0].final.s1, pow0: tview[0].final.s4, trained: run.roster.filter((r) => Object.values(r.train ?? {}).some((v) => v > 0)).length } : null;
  TST = null;
  // championed = 이 도전에서 우승(구간 3 보스 격파)을 했는가: 종료 요약의 championed(엔드리스 꺼짐 = result 가 champion), 상한에서 멈춘 도전은 applyMatchResult 의 champion 표시
  // endSeg = 끝난(또는 멈춘) 구간(1부터). 엔드리스에서 구간 s 보스를 이기면 구간 s+1 에 들어간 것이라, 상한에서 멈춘 도전은 MAXSEG + 1 이다
  return { seed, end, log, wins: log.filter((l) => l.win).length, points: run.points, rec, ...(tr ? { tr } : {}),
    championed: end ? !!end.championed : champ, capped, endSeg: run.seg + 1, est, coins: end ? end.coins.total : E ? Run.coinsOf(cat, run, profile, null).total : 0 };
}
/** 구간별 집계(엔드리스 전용): 도달 = 그 구간에서 경기를 1판 이상 치른 도전, 통과 = 그 구간 보스를 이긴 도전 */
function segTable(runs) {
  const rows = [], avg = (a, f) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0), N0 = runs.length;
  const maxSeg = Math.min(MAXSEG, Math.max(...runs.map((r) => (r.log.length ? r.log[r.log.length - 1].seg + 1 : 1))));
  console.log(`구간 | 도달 판(도달률) | 통과 판 · 도달한 판 중 통과율 [95%CI] | 이 구간에서 끝난 판 | 경기 승률 일반 / 강팀 / 보스 | 시간 종료 | 구간 첫 경기 전 팀 HP | 장비 수 | 강화 단계 합 | 보유 아티팩트 | 경기 포인트 | 주장 공격·방어`);
  for (let s = 1; s <= maxSeg; s++) {
    const inSeg = runs.map((r) => r.log.filter((l) => l.seg === s - 1)).filter((l) => l.length);
    if (!inSeg.length) break;
    const cleared = inSeg.filter((l) => l.some((x) => x.type === 'boss' && x.win)).length, ci = wilson(cleared, inSeg.length), all = inSeg.flat();
    const wr = (t) => { const m = all.filter((x) => x.type === t); return m.length ? `${m.filter((x) => x.win).length}/${m.length}` : '-'; };
    const first = inSeg.map((l) => l[0]), ended = inSeg.length - cleared;
    console.log(`${s} | ${inSeg.length} (${pct(inSeg.length / N0)}%) | ${cleared} · ${pct(cleared / inSeg.length)}% [${pct(ci[0])}-${pct(ci[1])}] | ${ended} | ${wr('normal')} / ${wr('strong')} / ${wr('boss')} | ${pct(avg(all, (x) => x.tu))}% | ${pct(avg(first, (x) => x.hp0))}% | ${avg(first, (x) => x.items).toFixed(1)} | ${avg(first, (x) => x.lvSum).toFixed(1)} | ${avg(first, (x) => x.own).toFixed(1)} | ${avg(first, (x) => x.pts).toFixed(0)} | ${avg(first, (x) => x.p0pow).toFixed(0)}·${avg(first, (x) => x.p0def).toFixed(0)}`);
    rows.push({ seg: s, reached: inSeg.length, cleared, ended, normal: wr('normal'), strong: wr('strong'), boss: wr('boss'), timeup: avg(all, (x) => x.tu), hp0: avg(first, (x) => x.hp0), items: avg(first, (x) => x.items), lvSum: avg(first, (x) => x.lvSum), own: avg(first, (x) => x.own), pts: avg(first, (x) => x.pts) });
  }
  return rows;
}
function runRuns() {
  const permName = flag('perm', 'none'), perm = PERMS[permName] ?? JSON.parse(permName), diff = +flag('diff', 0), seed0 = +flag('seed0', 1), runs = [];
  if (diff > 0 && !unlockedOf(cat, perm).difficulty.includes(diff)) perm.PC06 = 1;
  console.log(`run n=${N} bot=${BOT} perm=${permName} diff=${diff} data=${DATA ?? 'server/flame/data'} ver=${cat.ver}${XHEAL ? ` xheal=${XHEAL}%(실험용, 서버 미구현)` : ''}${XBOSS ? ` xboss-heal=+${XBOSS}%(실험용, 서버 미구현)` : ''}${TRAIN.join() === 'T05,T02' ? '' : ` train=${TRAIN.join()}`}${TRAIN_ON ? ` train-mode=${TRAIN_MODE} train-pri=${TRAIN_PRI}` : ''}${RECRUIT === 'off' ? '' : ` recruit=${RECRUIT}${RECRUIT === 'safe' ? ` hp>=${RECRUIT_HP}%` : ''}${RECRUIT === 'visit' ? '' : ` margin=${RECRUIT_MARGIN}`}`}`);
  for (let i = 0; i < N; i++) runs.push(playRun(seed0 * 1000 + i * 17 + 5, perm, diff));
  const E = !!cat.endless, clears = runs.filter((r) => r.championed).length, [lo, hi] = wilson(clears, N); // 우승 = 구간 3 보스 격파(엔드리스에서는 도전이 이어진다, 39 D24)
  if (E) console.log(`엔드리스: 측정 상한 구간 ${MAXSEG} | 봇 포인트 규칙 ${EBOT}${XOPP > 0 ? ` | xopp=+${XOPP}%/구간(구간 ${XOPP_FROM}부터, ${XOPP_STATS.join('·')}) (실험용, 서버·엔진 미구현)` : ''}${XOPP_BASE ? ` | xopp-base=${XOPP_BASE}%(전 구간, 숙련 조작 대용 가정, 실험용)` : ''}`);
  console.log(`우승 ${clears}/${N} = ${pct(clears / N)}% [${pct(lo)}-${pct(hi)}] | 평균 승수 ${(runs.reduce((s, r) => s + r.wins, 0) / N).toFixed(2)}${E ? '' : '/12'} | 평균 코인 ${(runs.reduce((s, r) => s + r.coins, 0) / N).toFixed(0)} (첫 우승 보너스 포함)`);
  if (TRAIN_ON) {
    const A = (f) => (runs.reduce((s, r) => s + f(r.tr), 0) / N).toFixed(1);
    console.log(`특훈(${TRAIN_MODE}/${TRAIN_PRI}, 상한 ${JSON.stringify(cat.cfg.training.maxPerStat ?? null)}, statCaps.s0 ${cat.cfg.statCaps?.s0 ?? null}): 판당 특훈 ${A((t) => t.picks)}회 | 상한 거절 ${A((t) => t.rej)}회 | 주장 아닌 선수에게 ${A((t) => t.spill)}회 | 특훈 받은 선수 ${A((t) => t.trained)}명 | 종료 때 주장 특훈 HP +${A((t) => t.cap0.s0 ?? 0)} 방어 +${A((t) => t.cap0.s1 ?? 0)} 공격 +${A((t) => t.cap0.s4 ?? 0)} | 주장 최종 HP ${A((t) => t.hp0)} 방어 ${A((t) => t.def0)} 공격 ${A((t) => t.pow0)}`);
  }
  const recOn = RECRUIT !== 'off', gradeHist = (list) => { const h = {}; for (const g of list) h[g] = (h[g] ?? 0) + 1; return ['D', 'C', 'B', 'A', 'S', 'O'].filter((g) => h[g]).map((g) => `${g === 'O' ? '원작' : g} ${h[g]}`).join('·') || '-'; };
  if (recOn) {
    const all = runs.flatMap((r) => r.rec.recs);
    console.log(`영입(${RECRUIT}): 영입한 도전 ${runs.filter((r) => r.rec.recs.length).length}/${N} | 영입 ${all.length}회 (${gradeHist(all.map((x) => x.grade))}) | 영입실 방문 ${runs.reduce((t, r) => t + r.rec.visits, 0)}회 | 원작 희귀 칸을 본 도전 ${runs.filter((r) => r.rec.sawRare).length}/${N}`);
  }
  console.log('경기 순번 | 도달 판 | 승률 [95%CI] | 경기 전 팀 HP | 경기 뒤 팀 HP(이긴 판) | 장비 수 | 아티팩트 | 해금 슛 수 | 종류' + (recOn ? ' | 영입한 판 수 | 영입 등급(그 경기의 로스터)' : ''));
  const perIdx = [];
  for (let k = 0; k < 12; k++) {
    const rows = runs.filter((r) => r.log[k]).map((r) => r.log[k]);
    if (!rows.length) { perIdx.push(null); continue; }
    const w = rows.filter((x) => x.win), ci = wilson(w.length, rows.length), avg = (a, f) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0);
    const types = [...new Set(rows.map((x) => `${x.type}L${x.lv}`))].join('/');
    console.log(`${k + 1} | ${rows.length} | ${pct(w.length / rows.length)}% [${pct(ci[0])}-${pct(ci[1])}] | ${pct(avg(rows, (x) => x.hp0))}% | ${pct(avg(w, (x) => x.hp1))}% | ${avg(rows, (x) => x.items).toFixed(1)} | ${avg(rows, (x) => x.arts).toFixed(1)} | ${avg(rows, (x) => x.allow).toFixed(1)} | ${types}${recOn ? ` | ${rows.filter((x) => x.rec.length).length} | ${gradeHist(rows.flatMap((x) => x.rec))}` : ''}`);
    perIdx.push({ k: k + 1, reached: rows.length, win: w.length, hp0: avg(rows, (x) => x.hp0), hp1: avg(w, (x) => x.hp1), types });
  }
  const byOpp = {};
  for (const r of runs) for (const l of r.log) { const key = `seg${l.seg + 1} ${l.type} t${l.opp}`; (byOpp[key] ??= [0, 0])[l.win ? 0 : 1]++; }
  console.log('상대별 승/패: ' + Object.entries(byOpp).sort().map(([k, v]) => `${k} ${v[0]}/${v[1]}`).join(', '));
  let perSeg = null, endDist = null;
  if (E) {
    perSeg = segTable(runs);
    // 종료 분포: 끝난 구간(패배한 경기의 구간). 상한에서 멈춘 도전은 따로 센다
    endDist = {};
    for (const r of runs) { const k = r.capped ? `상한(구간 ${MAXSEG} 통과)` : r.end ? `${r.endSeg}` : '미종료'; endDist[k] = (endDist[k] ?? 0) + 1; }
    const champs = runs.filter((r) => r.championed), cd = {};
    for (const r of champs) { const k = r.capped ? `${MAXSEG}+` : `${r.endSeg}`; cd[k] = (cd[k] ?? 0) + 1; }
    const ord = (o) => Object.entries(o).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10) || a[0].length - b[0].length).map(([k, v]) => `${k}: ${v}`).join(' | ');
    console.log('종료 구간 분포(전 도전): ' + ord(endDist));
    console.log(`종료 구간 분포(우승한 도전 ${champs.length}판): ` + (ord(cd) || '-') + (champs.length ? ` | 평균 승수 ${(champs.reduce((s, r) => s + r.wins, 0) / champs.length).toFixed(1)} · 평균 종료 구간 ${(champs.reduce((s, r) => s + Math.min(r.endSeg, MAXSEG + 1), 0) / champs.length).toFixed(2)}` : ''));
    const S = (f) => runs.reduce((s, r) => s + f(r.est), 0), full = runs.filter((r) => r.est.fullSold).length, artOut = runs.filter((r) => r.est.artOutSeg).map((r) => r.est.artOutSeg);
    console.log(`보유 상한·고갈: 장비 상한(${cat.endless.itemMax})에 걸려 즉시 판매된 장비 ${S((e) => e.fullSold)}개(${full}판, ${S((e) => e.fullPts)}점) | 아티팩트 고갈 대체 포인트 ${S((e) => e.artPts)}점(${artOut.length}판${artOut.length ? `, 처음 고갈된 구간 최소 ${Math.min(...artOut)}` : ''}) | 봇 판매 ${S((e) => e.sold)}개 ${S((e) => e.soldPts)}점 · 강화 ${S((e) => e.upg)}회 ${S((e) => e.upgPts)}점`);
  }
  if (JSONOUT) writeFileSync(JSONOUT, JSON.stringify({ mode: 'run', n: N, bot: BOT, perm, diff, ver: cat.ver, ...(recOn ? { recruit: RECRUIT } : {}), ...(E ? { endless: { maxSeg: MAXSEG, bot: EBOT, xopp: XOPP, xoppBase: XOPP_BASE, xoppFrom: XOPP_FROM, xoppStats: XOPP_STATS }, perSeg, endDist } : {}), clears, perIdx, byOpp, runs: runs.map((r) => ({ seed: r.seed, wins: r.wins, result: r.end?.result ?? null, coins: r.coins, log: r.log, ...(recOn ? { rec: r.rec } : {}), ...(r.tr ? { tr: r.tr } : {}), ...(E ? { championed: r.championed, capped: r.capped, endSeg: r.endSeg, est: r.est } : {}) })) }, null, 1));
}

// ---------- list ----------
function runList() {
  console.log('상대 묶음: ' + Object.entries(OPPS).map(([k, v]) => `${k}=[${v.map((o) => `t${o.team}@${o.lv}`).join(' ')}]`).join('  '));
  for (const [name, b] of Object.entries(BUILDS)) {
    const { team, opts } = flameOf(b);
    console.log(`\n# ${name}: ${b.note}  (태그 ${team.tag}, 시너지 ${team.synergies.join(',') || '-'}, 해금 슛 ${team.allow.length}개, 미지원 ${team.unsupported.join(',') || '-'})`);
    for (const p of team.players) {
      const f = p.final, fx = Object.entries(opts.roster[p.i].fx).filter(([, v]) => (typeof v === 'number' ? v : Object.keys(v).length)).map(([k, v]) => `${k}=${typeof v === 'number' ? v : JSON.stringify(v)}`).join(' ');
      console.log(`  ${p.i} hp ${f.s0} def ${f.s1} spd ${f.s2}(걷기 ${p.move.walk.toFixed(2)}px/f, 낭비 ${p.move.wasted}) jmp ${f.s3} pow ${f.s4} catch ${f.s5} thr ${f.s6} pass ${f.s7} | r1 ${f.r1} r2 ${f.r2} r3 ${f.r3}(쓰러짐 ${p.down}f) | sp ${opts.roster[p.i].sp[0]} | 버려진 값 ${JSON.stringify(p.over)} | ${fx}`);
    }
  }
}

// ================= 키운 팀 대전(analysis/40 §19) =================
// 측정 도구 전용 [자작]. 서버·엔진·데이터 파일을 고치지 않는다. 포트·DB 를 쓰지 않는다.
/** snap: 정책 봇 도전을 돌리며 --tiers 구간의 보스전 직전 팀을 뜬다. --max-seg 는 가장 큰 tier 로 맞춘다(그 구간 보스를 이기면 멈춘다) */
function runSnap() {
  const permName = flag('perm', 'full'), perm = { ...(PERMS[permName] ?? JSON.parse(permName)) }, diff = +flag('diff', 0), seed0 = +flag('seed0', 1), out = flag('out', null);
  SNAP = { tiers: flag('tiers', '3,6,10').split(',').map(Number), out: [] };
  const ends = {};
  for (let i = 0; i < N; i++) { const r = playRun(seed0 * 1000 + i * 17 + 5, perm, diff); const k = r.capped ? `상한(구간 ${MAXSEG} 통과)` : `${r.endSeg}`; ends[k] = (ends[k] ?? 0) + 1; }
  console.log(`snap n=${N} bot=${BOT} perm=${permName} diff=${diff} recruit=${RECRUIT} train=${TRAIN.join()}/${TRAIN_MODE}/${TRAIN_PRI} xopp-base=${XOPP_BASE} max-seg=${MAXSEG} ver=${cat.ver}`);
  console.log('종료 구간 분포: ' + Object.entries(ends).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10)).map(([k, v]) => `${k}: ${v}`).join(' | '));
  for (const t of SNAP.tiers) console.log(`구간 ${t} 보스전 직전 팀: ${SNAP.out.filter((s) => s.tier === t).length}개`);
  if (out) writeFileSync(out, JSON.stringify({ meta: { n: N, bot: BOT, perm, diff, recruit: RECRUIT, train: TRAIN, trainMode: TRAIN_MODE, trainPri: TRAIN_PRI, xoppBase: XOPP_BASE, seed0, ver: cat.ver }, snaps: SNAP.out }));
  SNAP = null;
}

const parseKv = (s) => (s ? Object.fromEntries(s.split(',').map((x) => { const [k, v] = x.split(':'); return [k, +v]; })) : null);
/** 팔(arm) 옵션: survive·surviveB(치사 생존 경기당 횟수, 없으면 데이터 값), vcap·vcapB(대전 전용 능력 상한 실험 {hp,def,pow,…}: 서버에 없는 규칙), p10·p10B(주장 보호대를 P10 으로 바꿔 끼운다: 치사 생존 효과 자체를 재는 용도), opt·optB(내야를 강한 4명으로 다시 세운다) */
function armOf(over = '') {
  const g = (k, d) => { const m = new RegExp(`(?:^|;)${k}=([^;]*)`).exec(over); return m ? m[1] : flag(k, d); };
  const num = (v) => (v === null || v === undefined || v === '' ? null : +v);
  return { survive: [num(g('survive', null)), num(g('surviveB', g('survive', null)))], vcap: [parseKv(g('vcap', null)), parseKv(g('vcapB', g('vcap', null)))], p10: [g('p10', '0') === '1', g('p10B', '0') === '1'], opt: [g('opt', '0') === '1', g('optB', g('opt', '0')) === '1'] };
}
/** 대전 전용 상한 실험(서버·엔진에 없는 규칙): 능력치 키(hp·def·pow…)는 최종 능력치 상한, fxsp = 필살 고정 가산(spPow·계열 famPow 각각) 상한, fxpct = 필살 %(spPct·famPct 각각) 상한 */
function capOne(r, cap) {
  for (const [s, mx] of Object.entries(cap)) {
    if (s === 'fxsp') { r.fx.spPow = Math.min(r.fx.spPow, mx); for (const f2 of Object.keys(r.fx.famPow)) r.fx.famPow[f2] = Math.min(r.fx.famPow[f2], mx); }
    else if (s === 'fxpct') { r.fx.spPct = Math.min(r.fx.spPct, mx); for (const f2 of Object.keys(r.fx.famPct)) r.fx.famPct[f2] = Math.min(r.fx.famPct[f2], mx); }
    else if (r.stat[s] > mx) r.stat[s] = mx;
  }
  r.hp = r.stat.hp;
}
/** 슬롯 한 칸 -> 엔진 flame 옵션(서버와 같은 teams.js versusOptions). k = 0(A)/1(B) */
function vsFlame(t, arm, k) {
  if (t.__build) { // 빌드 이름(sim_balance BUILDS, 시작 7명 기준의 합성 팀): 엔진 옵션을 바로 만든다. 치사 생존은 팀 합계 상한만 적용
    const fl = JSON.parse(JSON.stringify(flameOf(buildOf(t.__build)).opts)); let left = arm.survive[k] ?? cat.cfg.versusTeam?.surviveUsesPerMatch ?? 1;
    for (const r of fl.roster) { r.hp = r.stat.hp; const had = r.fx.survive; r.fx.survive = Math.min(had, left); left -= r.fx.survive; if (arm.vcap[k]) capOne(r, arm.vcap[k]); }
    return fl;
  }
  let tt = t;
  if (arm.p10[k]) { tt = JSON.parse(JSON.stringify(t)); tt.roster[0].equip.protector = { id: 'P10', lv: 0 }; tt = sanitizeTeam(cat, tt); }
  const cfg = { surviveUses: arm.survive[k] ?? cat.cfg.versusTeam?.surviveUsesPerMatch ?? 1 };
  const v = versusOptions(cat, data, tt, cfg);
  if (!v) throw new Error('쓸 수 없는 슬롯');
  if (arm.opt[k]) { // 실험: 저장된 라인업 대신 「내야 = 공격+방어+HP/4 상위」로 다시 세운다(주장 칸 0 은 그대로). 사람이 마지막 경기 전에 라인업을 정비했다는 가정
    const sc = (r) => r.stat.pow + r.stat.def + r.stat.hp / 4, rest = v.flame.roster.slice(1).sort((a, b) => sc(b) - sc(a));
    v.flame.roster = [v.flame.roster[0], ...rest];
    let left = cfg.surviveUses; for (const r of v.flame.roster) { const had = r.fx.survive; r.fx.survive = Math.min(had, left); left -= r.fx.survive; }
  }
  if (arm.vcap[k]) for (const r of v.flame.roster) { capOne(r, arm.vcap[k]); }
  return v.flame;
}
/**
 * 경기 만들기. sides[s] = {fl: flame 옵션} | {team: 원작 팀 번호}. 양쪽 다 컴퓨터 조작, 스테이지 0(대전 방 기본), 체력제.
 * 한쪽만 키운 팀이면 엔진 그대로다(flame.seat = 그 좌석). 양쪽 다 키운 팀이면 엔진의 두 좌석 옵션(flame 배열, analysis/39 D53)을 쓴다.
 * native = 배열에 넣는 순서(0 = [좌석 0, 좌석 1], 1 = [좌석 1, 좌석 0]). 결과는 순서와 무관해야 한다(verify 가 본다).
 * 2026-11-19 이전의 [두 좌석 근사](반대 좌석 선수를 makeFlamePlayer 로 바꿔 끼우고 allow 를 합집합으로 두던 방식)는 엔진 두 좌석 확장으로 대체했다. 같은 시드에서 근사와 결과가 같은 것을 확인했다(docs/HANDOFF.md §4-55)
 */
function mkMatch({ seed, sides, lv, limitMin, native = 0 }) {
  const base = { seed, data, humans: [false, false], cpuLevels: lv, stage: 0, limitFrames: limitMin * 3600, ruleMode: 'knockout' };
  const F = [sides[0].fl ?? null, sides[1].fl ?? null];
  if (!F[0] && !F[1]) return new Match({ ...base, teams: [sides[0].team, sides[1].team] });
  if (!(F[0] && F[1])) { const s = F[0] ? 0 : 1, teams = [0, 0]; teams[1 - s] = sides[1 - s].team; return new Match({ ...base, teams, flame: { ...F[s], seat: s } }); }
  const both = [{ ...F[0], seat: 0 }, { ...F[1], seat: 1 }];
  return new Match({ ...base, teams: [0, 0], flame: native === 1 ? [both[1], both[0]] : both });
}
/** 한 경기. 반환은 좌석 기준 */
function playVs(o) {
  const m = mkMatch(o), z = () => ({ hits: 0, dmg: 0, frac: 0, kills: 0, oneShot: 0, fullHits: 0, sp: 0, survive: 0, maxFrac: 0 }), st = [z(), z()]; // st[s] = 좌석 s 가 「준」 값
  let n = 0, firstOutF = -1;
  const hpPrev = m.players.map((p) => p.hp); // 맞기 직전 HP(이벤트의 hp 는 0 에서 잘린 뒤 값이라 초과 피해가 있으면 hp + dmg 로는 되돌릴 수 없다)
  while (m.phase !== 'end' && n++ < 130000) {
    m.tick([0, 0]);
    for (const e of m.drainEvents()) {
      if (e.k === 'hit') {
        const q = m.players[e.p];
        if (q.slot < 4 && e.dmg > 0) { const a = st[1 - q.seat], hp0 = hpPrev[e.p], fr = e.dmg / q.stat.hp; hpPrev[e.p] = e.hp; a.hits++; a.dmg += e.dmg; a.frac += fr; a.maxFrac = Math.max(a.maxFrac, fr); if (e.hp === 0) a.kills++; if (hp0 === q.stat.hp) { a.fullHits++; if (e.hp === 0) a.oneShot++; } }
        else if (q.slot < 4) st[1 - q.seat].hits++;
      } else if (e.k === 'special') st[m.players[e.p].seat].sp++;
      else if (e.k === 'fl_survive') st[m.players[e.p].seat].survive++;
      else if (e.k === 'out' && firstOutF < 0) firstOutF = m.f;
    }
  }
  const r = m.result;
  return { winner: r ? r.winner : -1, reason: r ? r.reason : 'unfinished', clock: m.clock, rem: [m.sides[0].remaining, m.sides[1].remaining], st, firstOutF, hp: m.players.map((p) => p.hp), pos: m.players.map((p) => p.x + p.y * 7) };
}
const loadSnaps = (file) => { const J = JSON.parse(readFileSync(file, 'utf8')), by = new Map(); for (const s of J.snaps) { if (!by.has(s.tier)) by.set(s.tier, []); by.get(s.tier).push(s.team); } return by; };
/** 여러 스냅샷 파일을 합친다: --snaps=a.json,b.json. tier 이름은 "파일번호:구간"(파일이 하나면 구간만) */
function snapsOf() {
  const files = flag('snaps', '').split(',').filter(Boolean), all = new Map();
  files.forEach((f, i) => { for (const [t, v] of loadSnaps(f)) all.set(files.length > 1 ? `${i}:${t}` : `${t}`, v); });
  for (const k of ['a', 'b']) { const v = flag(k, null); if (v && v.startsWith('build:')) all.set(v, [{ __build: v.slice(6) }]); if (v && v.startsWith('orig:')) all.set(v, [{ __team: +v.slice(5) }]); } // --a=orig:23 = 원작 팀 그대로(기준선: 원작 팀끼리) // --a=build:full7+cap_all = 합성 팀 1개
  return all;
}
function vsSummary(rows) {
  const n = rows.length, wA = rows.filter((r) => r.winA === 1).length, wB = rows.filter((r) => r.winA === 0).length, dr = n - wA - wB, [lo, hi] = wilson(wA, n);
  const S = (f) => rows.reduce((s, r) => s + f(r), 0);
  const side = (k) => { const h = S((r) => r[k].hits), fh = S((r) => r[k].fullHits); return { hits: h / n, fracAvg: h ? S((r) => r[k].frac) / h : 0, oneShot: fh ? S((r) => r[k].oneShot) / fh : 0, oneShotN: S((r) => r[k].oneShot), fullHits: fh, kills: S((r) => r[k].kills) / n, sp: S((r) => r[k].sp) / n, survive: S((r) => r[k].survive) / n, maxFrac: Math.max(0, ...rows.map((r) => r[k].maxFrac)) }; };
  const s0 = rows.filter((r) => r.seatA === 0), s1 = rows.filter((r) => r.seatA === 1);
  return {
    n, wA, wB, draws: dr, rate: wA / n, ci: [lo, hi], drawRate: dr / n, drawCi: wilson(dr, n),
    timeup: rows.filter((r) => r.reason === 'timeup' || r.reason === 'sudden_death').length / n, avgSec: S((r) => r.clock) / n / 60, p90Sec: rows.map((r) => r.clock / 60).sort((a, b) => a - b)[Math.floor(n * 0.9)] ?? 0, maxSec: Math.max(...rows.map((r) => r.clock / 60)),
    remA: S((r) => r.remA) / n, remB: S((r) => r.remB) / n, sweep: rows.filter((r) => r.winA === 1 && r.remA === 7).length / n, sweepB: rows.filter((r) => r.winA === 0 && r.remB === 7).length / n, quick: rows.filter((r) => r.clock < 1800).length / n, firstOutSec: S((r) => (r.firstOutF < 0 ? r.clock : r.firstOutF)) / n / 60,
    A: side('A'), B: side('B'),
    seat0: s0.length ? [s0.filter((r) => r.winA === 1).length, s0.length] : null, seat1: s1.length ? [s1.filter((r) => r.winA === 1).length, s1.length] : null,
  };
}
const p1 = (x) => (100 * x).toFixed(1);
function vsLine(label, s) {
  const sd = (x) => `맞힘 ${x.hits.toFixed(1)} · 평균 ${pct(x.fracAvg)}%HP · 최대 ${pct(x.maxFrac)}% · 만피 한 방 ${x.oneShotN}/${x.fullHits}(${p1(x.oneShot)}%) · 필살 ${x.sp.toFixed(1)} · 생존 ${x.survive.toFixed(2)}`;
  return `${label} | A 승 ${pct(s.rate)}% [${pct(s.ci[0])}-${pct(s.ci[1])}] ${s.wA}/${s.n} (B 승 ${s.wB}, 무승부 ${s.draws} = ${p1(s.drawRate)}% [${p1(s.drawCi[0])}-${p1(s.drawCi[1])}]) | 시간종료 ${pct(s.timeup)}% | 평균 ${s.avgSec.toFixed(0)}s · 90% ${s.p90Sec.toFixed(0)}s · 최장 ${s.maxSec.toFixed(0)}s · 30초 내 ${pct(s.quick)}% · 첫 아웃 ${s.firstOutSec.toFixed(0)}s | 남은 A:B ${s.remA.toFixed(1)}:${s.remB.toFixed(1)} · 7:0 완승 A ${pct(s.sweep)}% B ${pct(s.sweepB)}% | A가 준: ${sd(s.A)} | B가 준: ${sd(s.B)}` +
    (s.seat0 && s.seat1 ? ` | A 좌석 0: ${s.seat0[0]}/${s.seat0[1]} = ${pct(s.seat0[0] / s.seat0[1])}% · 좌석 1: ${s.seat1[0]}/${s.seat1[1]} = ${pct(s.seat1[0] / s.seat1[1])}%` : '');
}
/**
 * vs --snaps=<파일[,파일]> --a=<tier> (--b=<tier> | --opps=t8@3,…) --teams=K --n=판/짝/좌석 [--cross=1] [--limit=5(분, 0 = 무제한)] [--bot=3(A 조작 레벨)] [--botB=3] [--seat=0|1|both]
 *    [--survive=0|1] [--surviveB=] [--vcap=hp:100,pow:44] [--vcapB=] [--p10=1] [--p10B=1] [--opt=1] [--arm2="survive=0;vcap=hp:100"] [--json=<경로>]
 * A = tier a 의 스냅샷 앞 K 개. 원작 상대: 팀마다 opps 전부와 n 판. 키운 팀끼리: A[i] 대 B[(i + off) % K](off = 같은 tier 면 1.., 다른 tier 면 0..) 를 cross 가지.
 * --seat=both 는 같은 시드를 좌석만 바꿔 두 번 돈다(n 판 × 2). --mirror=1 = A[i] 대 A[i](같은 팀끼리 = 좌석 편향만 남는다).
 * --arm2 를 주면 같은 시드·같은 짝으로 옵션만 바꾼 두 번째 팔을 돌리고 짝 차이(A 승 차, 평균 ± 1.96 표준오차)를 낸다.
 */
function runVs() {
  const snaps = snapsOf(), K = +flag('teams', 10), aT = flag('a', '3'), bT = flag('b', null), limitMin = +flag('limit', 5), botB = +flag('botB', BOT), seatOpt = flag('seat', 'both'), cross = +flag('cross', 1), mirror = flag('mirror', '0') === '1';
  const arms = [armOf()]; const a2 = flag('arm2', null); if (a2 !== null) arms.push(armOf(a2));
  const A = (snaps.get(aT) ?? (() => { throw new Error('없는 tier: ' + aT); })()).slice(0, K), seats = seatOpt === 'both' ? [0, 1] : [+seatOpt];
  const jobs = [];
  if (bT !== null) {
    const B = (snaps.get(bT) ?? (() => { throw new Error('없는 tier: ' + bT); })()).slice(0, K), same = bT === aT;
    for (let i = 0; i < A.length; i++) for (let c = 0; c < cross; c++) { const j = mirror ? i : (i + c + (same ? 1 : 0)) % B.length; jobs.push({ ai: i, bj: j, lvB: botB, seedBase: 700000 + i * 5000 + j * 100, mkB: (arm) => (B[j].__team !== undefined ? { team: B[j].__team } : { fl: vsFlame(B[j], arm, 1) }) }); }
  } else {
    for (let i = 0; i < A.length; i++) for (const o of oppsOf(flag('opps', 't8@3'))) jobs.push({ ai: i, opp: o, lvB: o.lv, seedBase: 600000 + i * 5000 + o.team * 100 + o.lv * 30, mkB: () => ({ team: o.team }) });
  }
  console.log(`vs a=${aT}(${A.length}팀) b=${bT ?? flag('opps', 't8@3')} n=${N}/짝/좌석 seat=${seatOpt} limit=${limitMin}분 botA=${BOT} botB=${bT !== null ? botB : '상대 표기'} cross=${cross}${mirror ? ' mirror' : ''} ver=${cat.ver}`);
  const res = arms.map(() => []);
  arms.forEach((arm, k) => {
    for (const J of jobs) {
      const sideA = A[J.ai].__team !== undefined ? { team: A[J.ai].__team } : { fl: vsFlame(A[J.ai], arm, 0) }, sideB = J.mkB(arm);
      for (const seatA of seats) for (let i = 1; i <= N; i++) {
        const sides = seatA === 0 ? [sideA, sideB] : [sideB, sideA], lv = seatA === 0 ? [BOT, J.lvB] : [J.lvB, BOT];
        const r = playVs({ seed: J.seedBase + 2 * i, sides, lv, limitMin, native: 0 });
        res[k].push({ ai: J.ai, opp: J.opp ? `t${J.opp.team}@${J.opp.lv}` : `b${J.bj}`, seatA, winA: r.winner < 0 ? -1 : r.winner === seatA ? 1 : 0, reason: r.reason, clock: r.clock, remA: r.rem[seatA], remB: r.rem[1 - seatA], A: r.st[seatA], B: r.st[1 - seatA], firstOutF: r.firstOutF });
      }
    }
    const rows = res[k], s = vsSummary(rows);
    console.log(vsLine(`팔 ${k + 1} ${JSON.stringify(arm)} 합계`, s));
    const byOpp = new Map(); for (const r of rows) { if (!byOpp.has(r.opp)) byOpp.set(r.opp, []); byOpp.get(r.opp).push(r); }
    if (bT === null && byOpp.size > 1) for (const [o, rs] of byOpp) console.log(vsLine(`  상대 ${o}`, vsSummary(rs)));
    const byA = new Map(); for (const r of rows) { if (!byA.has(r.ai)) byA.set(r.ai, []); byA.get(r.ai).push(r); }
    const rates = [...byA.values()].map((rs) => rs.filter((r) => r.winA === 1).length / rs.length).sort((a, b) => a - b);
    const mean = rates.reduce((s2, v) => s2 + v, 0) / rates.length, sdv = Math.sqrt(rates.reduce((s2, v) => s2 + (v - mean) ** 2, 0) / Math.max(1, rates.length - 1)), se = sdv / Math.sqrt(rates.length);
    console.log(`  A 팀별 승률: 최저 ${pct(rates[0])}% · 중앙 ${pct(rates[Math.floor(rates.length / 2)])}% · 최고 ${pct(rates[rates.length - 1])}% | 팀 단위(군집) 평균 ${pct(mean)}% ± ${p1(1.96 * se)}%p (팀 ${rates.length}개)`);
  });
  if (arms.length === 2) {
    const d = res[0].map((r, i) => (r.winA === 1 ? 1 : 0) - (res[1][i].winA === 1 ? 1 : 0)), n = d.length, mean = d.reduce((s, v) => s + v, 0) / n, sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    console.log(`짝 차이(팔 1 − 팔 2, A 승): ${p1(mean)}%p [${p1(mean - 1.96 * sd / Math.sqrt(n))}, ${p1(mean + 1.96 * sd / Math.sqrt(n))}] (n=${n}, 팔 1 만 승 ${d.filter((v) => v > 0).length} · 팔 2 만 승 ${d.filter((v) => v < 0).length})`);
  }
  if (JSONOUT) writeFileSync(JSONOUT, JSON.stringify({ mode: 'vs', a: aT, b: bT, n: N, arms, summary: res.map(vsSummary), rows: res.map((rs) => rs.map(({ A: _a, B: _b, ...r }) => r)) }));
}
/** verify: 두 좌석 경기의 자기 검증. 같은 두 팀·같은 시드를 flame 배열 순서 [좌석 0, 좌석 1] / [좌석 1, 좌석 0] 으로 돌려 승자·사유·시계·전원 HP·위치가 같은지 본다 */
function runVerify() {
  const snaps = snapsOf(), tiers = [...snaps.keys()], arm = armOf(), limitMin = +flag('limit', 5);
  let same = 0, tot = 0;
  for (let k = 0; k < N; k++) {
    const ta = tiers[k % tiers.length], tb = tiers[(k + 1) % tiers.length], A = snaps.get(ta), B = snaps.get(tb);
    const sides = [{ fl: vsFlame(A[k % A.length], arm, 0) }, { fl: vsFlame(B[(k * 3 + 1) % B.length], arm, 1) }];
    const r = [0, 1].map((native) => playVs({ seed: 900000 + 2 * k, sides, lv: [BOT, BOT], limitMin, native }));
    const eq = r[0].winner === r[1].winner && r[0].reason === r[1].reason && r[0].clock === r[1].clock && r[0].hp.join() === r[1].hp.join() && r[0].pos.join() === r[1].pos.join();
    tot++; if (eq) same++; else console.log(`다름: k=${k} ${ta} 대 ${tb} | ${r.map((x) => `${x.winner}/${x.reason}/${x.clock}/${x.hp.join(',')}`).join(' <> ')}`);
  }
  console.log(`verify: ${same}/${tot} 경기가 flame 배열 순서 [0,1] / [1,0] 에서 같은 결과(승자·사유·시계·14명 HP·위치)`);
}
/** teams: 스냅샷 팀의 재료·최종 능력치 요약(tier 별 평균과 범위) */
function runTeams() {
  const snaps = snapsOf(), arm = armOf();
  for (const [t, list] of snaps) {
    const av2 = (ps, k) => ps.reduce((s2, r) => s2 + r.fx[k], 0) / ps.length;
    const rows = list.slice(0, +flag('teams', 9999)).map((team) => {
      const fl = vsFlame(team, arm, 0), inn = fl.roster.slice(0, 4), all = fl.roster, mx = (k, ps = inn) => Math.max(...ps.map((r) => r.stat[k])), av = (k, ps = inn) => ps.reduce((s, r) => s + r.stat[k], 0) / ps.length;
      const spPow = inn.map((r) => (r.sp[0] !== null && fl.allow.includes(r.sp[0]) ? data.specials.power[r.sp[0]] : 0));
      return { hp: av('hp'), hpMax: mx('hp'), def: av('def'), defMax: mx('def'), pow: av('pow'), powMax: mx('pow'), spd: av('spd'), s5: av('s5'), thr: av('thr'), allow: fl.allow.length, spN: spPow.filter((v) => v > 0).length, spMax: Math.max(...spPow), survive: all.reduce((s, r) => s + r.fx.survive, 0), train: !team.roster ? 0 : team.roster.reduce((s, r) => s + Object.values(r.train).reduce((x, v) => x + v, 0), 0), lv: !team.roster ? 0 : team.roster.reduce((s, r) => s + Object.values(r.equip).reduce((x, e) => x + (e ? e.lv : 0), 0), 0), eq: !team.roster ? 0 : team.roster.reduce((s, r) => s + Object.values(r.equip).filter(Boolean).length, 0), wins: team.wins ?? 0, rec: !team.roster ? 0 : team.roster.filter((r) => r.recruited).length, p10: team.roster?.some((r) => r.equip.protector?.id === 'P10') ? 1 : 0, inHp112: inn.filter((r) => r.stat.hp >= 112).length,
        spAdd: Math.max(...inn.map((r) => r.fx.spPow + Math.max(0, ...Object.values(r.fx.famPow)))), spPct: Math.max(...inn.map((r) => r.fx.spPct + Math.max(0, ...Object.values(r.fx.famPct)))), catchPow: av2(inn, 'catchPow'), chargePow: av2(inn, 'chargePow'), airPow: av2(inn, 'airPow'), lowHpDef: av2(inn, 'lowHpDef'), r1: inn.reduce((s2, r) => s2 + (r.ext?.r1 ?? 0), 0) / 4,
        spEff: Math.max(...inn.map((r, i2) => (spPow[i2] ? Math.floor((spPow[i2] + r.fx.spPow + Math.max(0, ...Object.values(r.fx.famPow))) * (100 + r.fx.spPct + Math.max(0, ...Object.values(r.fx.famPct))) / 100) : 0))) };
    });
    const col = (k) => { const v = rows.map((r) => r[k]).sort((a, b) => a - b); return `${(v.reduce((s, x) => s + x, 0) / v.length).toFixed(1)} (${v[0].toFixed(0)}~${v[v.length - 1].toFixed(0)})`; };
    console.log(`\n# tier ${t}: ${rows.length}팀 | 승수 ${col('wins')} | 낀 장비 ${col('eq')} · 강화 합 ${col('lv')} | 특훈 합 ${col('train')} | 영입 ${col('rec')}명 | 해금 슛 ${col('allow')} · 내야 필살 가능 ${col('spN')}명 · 필살 표 위력 최대 ${col('spMax')} | P10 낀 팀 ${rows.filter((r) => r.p10).length} · 치사 생존 합 ${col('survive')}`);
    console.log(`  내야 평균(범위=팀 사이): HP ${col('hp')} · 방어 ${col('def')} · 공격 ${col('pow')} · 이속 ${col('spd')} · 캐치 ${col('s5')} · 투구속 ${col('thr')} | 내야 최대: HP ${col('hpMax')} · 방어 ${col('defMax')} · 공격 ${col('powMax')} | 내야 중 HP 112 인 선수 ${col('inHp112')}명`);
    console.log(`  조건부 위력(내야): 필살 고정 가산 최대(spPow + 계열 최대) ${col('spAdd')} · 필살 % 최대 ${col('spPct')} · 필살 실효 위력 최대(표값 + 가산, % 적용) ${col('spEff')} | 평균: 캐치 후 ${col('catchPow')} · 차지 ${col('chargePow')} · 공중 ${col('airPow')} · 저HP 방어 ${col('lowHpDef')} · 넉백 저항 ${col('r1')}%`);
  }
  const O = flag('opps', null);
  if (O) for (const o of oppsOf(O)) { const ps = data.teams[o.team].players.slice(0, 4), av = (k) => (ps.reduce((s, r) => s + r[k], 0) / 4).toFixed(1), mx = (k) => Math.max(...ps.map((r) => r[k])); console.log(`원작 t${o.team} ${data.teams[o.team].name ?? ''}: 내야 평균 HP ${av('hp')} 방어 ${av('def')} 공격 ${av('pow')} 이속 ${av('spd')} 캐치 ${av('s5')} | 최대 HP ${mx('hp')} 방어 ${mx('def')} 공격 ${mx('pow')}`); }
}

const t0 = Date.now();
if (mode === 'cond') runCond(); else if (mode === 'run') runRuns(); else if (mode === 'snap') runSnap(); else if (mode === 'vs') runVs(); else if (mode === 'verify') runVerify(); else if (mode === 'teams') runTeams(); else runList();
console.error(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
