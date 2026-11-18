// 게임·화면 이벤트 → 소리 키 표. 값은 후보 배열이며 manifest 에 있는 첫 키를 재생하고, 하나도 없으면 무음.
// 에셋 키가 확정·추가되면 이 표만 고치면 된다(코드 수정 불필요). 원작 사운드 ID 는 analysis/08 §효과음, 14 §효과음(미청취 UNVERIFIED).
import { has } from './assets.js';
import { audio } from '../audio.js';
import { specialSfxKey } from './special.js';
import { pad2 } from '../util.js';

/** 서버 snap.ev 의 k → 후보 키. 함수면 (e, ctx) => 후보 배열. 키 이름은 public/assets/manifest.json(sfx.*) 기준 */
export const EV_SFX = {
  enter: [], // 행진 시작: 원작 0x95 는 곡 → matchBgm 이 bgm.enter 로 재생
  go: ['sfx.start.go'], // 0x81 음성
  toss: ['sfx.start.fight'], // 0x82 FIGHT!
  tip_swing: ['sfx.tip.swing'], // 0xA2
  tip_hit: ['sfx.tip.hit', 'sfx.ball.hit'],
  ref_out: ['sfx.ref.whistle'], // 0xAE 아웃 콜
  throw: (e) => (e.fm ? ['sfx.formation.throw', 'sfx.ball.throw', 'sfx.tip.swing'] : ['sfx.ball.throw', 'sfx.tip.swing']), // 투구 0xA2(쳐내기와 같은 소리)
  special: (e) => [specialSfxKey(e.id)], // 0xB7~0xC1(ID 표는 special.js)
  catch_start: ['sfx.player.catch_ready'],
  catch: (e) => (e.kind ? ['sfx.ball.catch_special', 'sfx.ball.catch'] : ['sfx.ball.catch']), // 0xA4
  // 0xAA 피격. 필살기 피격은 0xAB(hit_strong, ROM 렌더만 있어 파일 없으면 0xAA 로 넘어감)
  hit: (e) => (e.dmg === 0 ? ['sfx.ball.block', 'sfx.ball.hit'] : e.kind ? ['sfx.ball.hit_special', 'sfx.ball.hit_strong', 'sfx.ball.hit'] : ['sfx.ball.hit']),
  out: ['sfx.player.out'],
  jump: ['sfx.player.jump'], // 0xA6
  dash: ['sfx.player.dash'],
  run: (e) => (e.alt ? ['sfx.player.run_alt', 'sfx.player.run'] : ['sfx.player.run']), // 0xA9(ROM 스테이지 5·9 는 0xC5): 공을 들고 대시하는 동안 6프레임마다 [ROM 0x8BBA]
  crouch: ['sfx.player.crouch'],
  pickup: ['sfx.ball.pickup'], // 0xA5 공용
  pass: (e) => (e.fm ? ['sfx.formation.pass', 'sfx.ball.pass'] : ['sfx.ball.pass']), // 0xA3 / 포메이션 0xC3
  // 0xA5. ball.receive 는 fallback 이 없어 ROM 파일이 없으면 pickup(합성 fallback 있음)으로 넘어감
  receive: (e, ctx) => (ctx.fm ? ['sfx.formation.receive', 'sfx.ball.receive', 'sfx.ball.pickup'] : ['sfx.ball.receive', 'sfx.ball.pickup']),
  wall: ['sfx.ball.wall'],
  bounce: ['sfx.ball.bounce'],
  fm_start: ['sfx.formation.start', 'sfx.formation.open'], // 발동(작전 이름 배너)
  fm_ready: ['sfx.formation.open'], // 0xA1 집합 끝·패스 시작
  fm_end: [], // 같은 틱 throw{fm:1} 이 소리를 낸다
  timeup: ['sfx.match.timeup'], // 같은 틱에 end{reason:'timeup'} 또는 sudden_death 가 뒤따른다(こうしき 동수는 TIME UP·PLAY OFF 배너 362틱 뒤에 sudden_death)
  sudden_death: ['sfx.match.sudden_death'],
  // 0x83 GAME SET. 시간 종료는 바로 앞 timeup 이 이미 소리를 냈으므로 생략, draw_cap 은 timeup 이벤트가 없어 TIME UP 소리
  end: (e) => (e.reason === 'timeup' ? [] : e.reason === 'draw_cap' ? ['sfx.match.timeup', 'sfx.match.gameset'] : ['sfx.match.gameset']),
};

/** 연속 발화 묶음: 같은 group 은 groupGap(ms) 안에 한 번만. pickup→receive(줍기 15f 뒤 획득)는 같은 0xA5 라 묶고, 공 벽·바닥 충돌은 너무 잦지 않게 */
export const EV_OPT = {
  pickup: { group: 'grab', groupGap: 400 },
  receive: { group: 'grab', groupGap: 400 },
  wall: { group: 'contact', groupGap: 120, gap: 150 },
  bounce: { group: 'contact', groupGap: 120, gap: 150 },
};

/** 결과 곡(원작 0x40E2, 종료 연출 뒤 서브상태 진입 시): 사람 대 컴퓨터($E717!=0, $E797==0)에서 승자가 1P 쪽이면 0x8E, 아니면 0x93.
 *  그 외(사람 대 사람 등)는 언제나 0x8E. 무승부는 원작에 없다(서든데스) → 무음 */
export const RESULT_BGM = { win: 'bgm.result.win', lose: 'bgm.result.lose' };

/** 메뉴: 방향키 이동, 버튼 결정, 뒤로/나가기 */
export const UI_SFX = { move: ['sfx.ui.cursor'], ok: ['sfx.ui.confirm'], cancel: ['sfx.ui.cancel', 'sfx.ui.confirm'] };

/** 화면 → 곡(원작 장면 대응, 근거 analysis/27_bgm_status.md §3). 허용 목록에 없는 곡·대응 장면이 확정되지 않은 화면은 무음.
 *  원작에 없는 대체 연결(다른 곡으로 넘기기)은 하지 않는다 */
export const SCREEN_BGM = {
  nick: () => (audio.wantBgm === 'bgm.title' ? ['bgm.title'] : []), // 타이틀: 인트로에서 시작한 0x8A 가 이어질 뿐, 새로 틀지 않는다
  lobby: () => ['bgm.menu'], // 모드 메뉴 0x8C
  tutorial: () => ['bgm.menu'], // 튜토리얼 고르기: 로비 곡 유지
  league: () => ['bgm.menu'],
  ranking: () => ['bgm.menu'], // 순위표: 로비 곡 유지 // 리그 화면들: 리그 곡은 후속(analysis/33 A), 로비 곡 유지
  room: () => ['bgm.menu'], // 팀 선택: 새 곡 명령 없음(0x8C 유지)
  prematch: () => ['bgm.vs'], // 라인업(VS)·편성 0x8B
  rules: (d) => (d?.silent ? [] : ['bgm.menu']), // 규칙 창: 새 곡 명령 없음(0x8C 유지). silent = 스토리 흐름(곡 미확정 → 무음)
  lineup: (d) => (d?.silent ? [] : ['bgm.vs']), // 라인업(VS) 0x8B
  story: () => [], // 스토리 막간(0x90/0x91/0x92/0x98 계열): 장면 대응 미확정 → 무음
  game: () => [], // 매치 진입 0xE0(페이드). 곡은 matchBgm 이 이벤트로 재생
};

/** 원작 심판: FIGHT(토스) 20f + 제자리 복귀 33f 뒤 관전 상태(0x14)로 바뀌는 순간 경기 곡 명령(0xDC6C -> 0x509C). 08 §1 실측 f388 -> f441 */
const MATCH_BGM_DELAY_MS = 53 * 1000 / 60;

/** 경기 곡 키: 스토리($E68E==0)는 표 0x50F2[경기 번호], 그 외는 표 0x50D2[ROM 스테이지] */
export function matchBgmKey(start) {
  const k = start?.campaign?.k, id = start?.stage?.id;
  if (Number.isInteger(k)) return 'bgm.story.' + pad2(k);
  return Number.isInteger(id) && id >= 0 && id < 100 ? 'bgm.stage.' + pad2(id) : null;
}

/** 경기 중 곡 진행: 입장 0x95(1회) → 토스 53f 뒤 경기 곡 → 승패 확정 0xE0 페이드(playEvent 'end') */
export function matchBgm(start) {
  const key = matchBgmKey(start);
  let timer = 0, started = false, over = false;
  const begin = () => { timer = 0; if (over || started) return; started = true; audio.bgm(key); };
  audio.preload([key, 'bgm.enter']); // 경기 곡은 토스 53f 뒤 바로 나와야 하므로 화면 진입 때 받아 둔다(없는 키는 무시)
  return {
    key,
    onEvent(e) {
      if (e.k === 'enter') audio.bgm('bgm.enter');
      else if (e.k === 'toss' && !started && !timer) timer = setTimeout(begin, MATCH_BGM_DELAY_MS);
      else if (e.k === 'end') { over = true; clearTimeout(timer); }
    },
    /** 진행 중 경기로 복귀(토스 이벤트를 못 받음) */
    resume: begin,
    stop() { over = true; clearTimeout(timer); },
  };
}

/** 후보 중 manifest 에 있는 첫 키(없으면 null) */
export const pick = (list) => (Array.isArray(list) ? list.find((k) => typeof k === 'string' && has(k)) ?? null : null);
/** 후보 중 manifest 에 있는 키 전부(앞 키 파일이 없으면 audio 가 다음 키로 넘어간다) */
export const avail = (list) => (Array.isArray(list) ? list.filter((k) => typeof k === 'string' && has(k)) : []);

/** 경기 이벤트 1개 → 소리. ctx = {fm: 진행 중 포메이션 여부} */
export function playEvent(e, ctx = {}) {
  const v = EV_SFX[e?.k];
  if (!v) return;
  if (e.k === 'end') audio.bgm(null); // 승패 확정: 원작 0xE0(페이드 아웃) 뒤 GAME SET
  const list = avail(typeof v === 'function' ? v(e, ctx) : v);
  if (list.length) audio.play(list, EV_OPT[e.k]);
}

/** game_end: 결과 곡. vsCpu = 상대가 컴퓨터인 경기 */
export function playResult(winner, you, vsCpu) {
  if (winner !== 0 && winner !== 1) return;
  audio.bgm(winner === you || !vsCpu ? RESULT_BGM.win : RESULT_BGM.lose);
}

/** 화면 전환 시 곡(후보가 없으면 0xE0 페이드). 인트로가 덮고 있는 동안은 건드리지 않는다(인트로 끝에서 main 이 다시 부른다) */
export function screenBgm(view, data) {
  if (document.body.dataset.intro) return;
  audio.bgm(pick(SCREEN_BGM[view]?.(data)));
}
/** 메뉴 효과음(앱 수명 1회): 방향키로 포커스가 옮겨 가면 move, 버튼 누르면 ok. 경기 화면 버튼은 제외 */
export function bindUiSfx() {
  let navAt = 0;
  addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Tab') navAt = performance.now(); }, true);
  document.addEventListener('focusin', (e) => {
    if (performance.now() - navAt > 120 || document.body.dataset.view === 'game') return;
    if (e.target?.matches?.('button, input, [data-nav]')) { const k = pick(UI_SFX.move); if (k) audio.play(k); }
  });
  document.addEventListener('click', (e) => {
    if (document.body.dataset.view === 'game' || document.body.dataset.intro) return;
    const b = e.target?.closest?.('button');
    if (!b || b.disabled || b.classList.contains('snd')) return;
    const list = avail(b.matches('.back, [data-cmd="leave"], [data-sfx="cancel"]') ? UI_SFX.cancel : UI_SFX.ok);
    if (list.length) audio.play(list);
  });
}
