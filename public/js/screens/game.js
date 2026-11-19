// 경기 화면: 398x224(16:9) 캔버스를 창에 꽉 차게 확대(util.fitScale), DOM HUD(글자), 입력 전송, 일시정지·결과 오버레이
import { h, pad2, fitScale, isTyping } from '../util.js';
import { net } from '../net.js';
import { END_REASON, END_RULE } from '../i18n.js';
import { isCpuSeat } from './room.js';
import { entry, has, image, json, imageAt, jsonAt } from '../game/assets.js';
import { SnapBuffer } from '../game/snaps.js';
import { Renderer, W, H, buildAnimIndex, parallaxOf } from '../game/render.js';
import { InputSender } from '../game/input.js';
import { TouchPad, COARSE_MQ } from '../game/touchpad.js';
import { Hud } from '../game/hud.js';
import { TrainHud } from '../game/training.js';
import { playEvent, playResult, matchBgm } from '../game/sfxmap.js';
import { soundButton } from '../audio.js';
import { ImpactFx, impactOn, setImpactOn } from '../game/impact.js';
import { ShoutFx, shoutOn, setShoutOn } from '../game/shout.js';
import { FmName } from '../game/formation.js';
import { teamName } from '../names.js';
import { toast } from '../ui.js';
import * as Skin from './flame/skin.js';
import { granted as flGranted, artOff as flArtOff } from './flame/store.js';

const STAGE_FILE_RE = /^rom\/bg\/stage_\d{2}$/, STAGE_JSON_RE = /^rom\/bg\/stage_\d{2}\.json$/, STAGE_KEY_RE = /^bg\.stage\.\d{2}$/;

/**
 * game_start.stage{id,key,file,json} → renderer.bgFar/bgNear/parallax.
 * 순서: 서버 경로 규칙(file+'_far.png'/'_near.png', json) → manifest 키(stage.key) → bg.stage.00. 근경이 없으면 렌더러 단색 폴백
 */
async function loadStage(st, renderer) {
  st = st && typeof st === 'object' ? st : {};
  const nn = pad2(Number.isInteger(st.id) && st.id >= 0 && st.id < 100 ? st.id : 0);
  const tries = [];
  if (STAGE_FILE_RE.test(st.file ?? '')) {
    tries.push({ near: () => imageAt(st.file + '_near.png'), far: () => imageAt(st.file + '_far.png'),
      json: STAGE_JSON_RE.test(st.json ?? '') ? () => jsonAt(st.json) : null });
  }
  for (const k of new Set([STAGE_KEY_RE.test(st.key ?? '') ? st.key : 'bg.stage.' + nn, 'bg.stage.00'])) {
    if (!has(k + '.near')) continue;
    tries.push({ near: () => image(k + '.near'), far: has(k + '.far') ? () => image(k + '.far') : null,
      json: has('data.' + k) ? () => json('data.' + k) : null });
  }
  for (const t of tries) {
    let near;
    try { near = await t.near(); } catch (e) { console.warn('stage', e.message); continue; }
    const [far, sj] = await Promise.all([
      t.far ? t.far().catch((e) => { console.warn('stage', e.message); return null; }) : null,
      t.json ? t.json().catch((e) => { console.warn('stage', e.message); return null; }) : null]);
    renderer.bgNear = near; renderer.bgFar = far; renderer.parallax = parallaxOf(sj);
    return;
  }
}

/** 그 경기의 최대 HP(game_start.teams[].players[].hp 가운데 가장 큰 값). 칸이 없으면 0 */
const hpCapOf = (start) => Math.max(0, ...(start.teams ?? []).flatMap((t) => (t?.players ?? []).map((p) => (Number.isFinite(p?.hp) ? p.hp : 0))));

export function mount(root, app, { start }) {
  const campaign = start.campaign && Number.isInteger(start.campaign.k) ? start.campaign : null;
  const training = start.training?.kind ? start.training : null; // 특훈(혼자 하기, PROTOCOL §9): {kind, step, balls, pass, steps, gauge?}
  const league = start.league && Number.isInteger(start.league.i) ? start.league : null; // 리그 사람 경기(PROTOCOL §10): 끝나면 방이 없어지고 리그 메뉴로
  const flame = start.flame && Number.isInteger(start.flame.seat) ? start.flame : null; // 불꽃의 계승 경기(PROTOCOL §12.2·§13): 끝나면 방이 없어지고 도전 화면으로
  // 키운 팀 대전(PROTOCOL §13.20, 컴퓨터 대전 방의 불꽃 팀): game_start.flameVs. 그리기(선수 이름·skin·필살기 안내)만 flame 경기처럼 하고, 흐름(결과 카드·holdLobby·room_left)은 일반 방 그대로(= flame 은 null)
  // 사람끼리 방(§13.25): flameVs = {mode:'versus', seats:[{seat, fm, allow, slot} | null, …]} → 내 좌석 칸이 내 그리기 기준(안내 줄), 선수 이름·skin 은 좌석마다(flameCast.seats)
  const vsSeats = Array.isArray(start.flameVs?.seats) ? start.flameVs.seats : null;
  const flDraw = flame ?? (start.flameVs && Number.isInteger(start.flameVs.seat) ? start.flameVs
    : vsSeats ? vsSeats.find((x) => x && x.seat === start.you) ?? null : null);
  const trSpecial = training?.kind === 'special'; // 필살 슛 특훈(§9.5): 공중 차지 필살, 차지 게이지 HUD
  const practice = !!flame && start.flameCast?.practice === true; // 불꽃의 계승 연습 경기(PROTOCOL §13.15): 결과가 도전에 반영되지 않는다. 화면에 작은 「연습」 표시
  // 불꽃의 계승: 내 팀에 지금 발동되는 필살기(teams[seat].players[i].spOn)가 하나도 없으면 조작 안내의 필살기 줄을 숨긴다(아티팩트 장착 전). 칸이 없는 서버면 해금 목록(flame.allow)으로 본다
  const flPlayers = flDraw ? start.teams?.[flDraw.seat]?.players ?? [] : [];
  const noSpecial = !!flDraw && (flPlayers.some((p) => p && 'spOn' in p) ? !flPlayers.some((p) => Number.isInteger(p?.spOn)) : Array.isArray(flDraw.allow) && !flDraw.allow.length);
  // 부여 구조(PROTOCOL §13.21): 필살기가 없는 선수가 섞여 있으면 안내 줄에 「없으면 일반 슛」(그 선수의 공중 차지 투구는 일반 슛으로 나간다). 종전 구조는 줄 그대로
  const someNoSp = !!flDraw && flGranted() && flPlayers.some((p) => p && 'spOn' in p && !Number.isInteger(p.spOn));
  const you = start.you;
  const canvas = h('canvas.game-canvas', { width: W, height: H, 'aria-label': '경기 화면' });
  // 닉네임·팀 이름은 캔버스 HUD 에 도트 글자로 그린다(hud.js). DOM 이름은 화면 읽기 전용(보이지 않음), 서든데스 글자는 DOM
  const nameL = h('div.hud-name'), nameR = h('div.hud-name.r');
  const timer = h('div.hud-timer');
  const banner = h('div.banner', { hidden: true });
  const overlay = h('div.overlay', { hidden: true });
  // 입력 잠금(lock) 동안 한 줄 안내. 전체 조작법은 아래 help 줄
  const keyJump = h('b', 'D'), keyThrow = h('b', 'S');
  const keys = h('div.keys-guide', { hidden: true }, h('div', '점프볼: ', keyJump, ' 점프 중 ', keyThrow));
  const floats = h('div.floats');
  const stage = h('div.stage', canvas, floats, practice ? h('div.fl-practice-m', '연습') : null, keys, banner, overlay);
  const bar = h('div.game-bar', nameL, timer, nameR);
  const quit = h('button.btn.small', { type: 'button', onclick: onQuit }, training ? '그만두기' : '기권');
  // 특훈 그만두기 확인 창(Esc·그만두기 버튼). 서버 일시정지가 없어(PROTOCOL §9.1) 창이 떠 있어도 경기는 흐른다:
  // 화면을 어둡게 덮지 않고 조작 입력도 그대로 보낸다
  const quitStay = h('button.btn.small', { type: 'button', onclick: () => toggleQuitWin(false) }, '계속');
  const quitGo = h('button.btn.small.danger', { type: 'button', onclick: () => { toggleQuitWin(false); net.send('training_quit'); } }, '그만두기');
  const quitWin = h('div.tr-quit', { hidden: true },
    h('div.pwin.tr-quit-card', { role: 'dialog', 'aria-label': '튜토리얼 그만두기' },
      h('div.tr-quit-t', '그만둘까요?'), h('div.tr-quit-n', '경기는 멈추지 않습니다'), h('div.tr-quit-b', quitStay, quitGo)));
  if (training) stage.append(quitWin);
  function toggleQuitWin(on = quitWin.hidden) {
    if (!training || (on && ended)) return;
    quitWin.hidden = !on;
    placeToast();
    if (on) quitStay.focus({ preventScroll: true }); else document.activeElement?.blur?.();
  }
  const onEsc = (e) => {
    if (e.key !== 'Escape' || e.repeat || !training || ended) return;
    e.preventDefault(); toggleQuitWin();
  };
  addEventListener('keydown', onEsc);
  // 그만두기 창이 열려 있는 동안만 ←→·Tab 은 창의 포커스 이동(경기 입력 InputSender 보다 먼저 받아 전파를 끊는다). ↑↓·A/S/D 와 키 떼기는 경기로 그대로, 창을 닫으면 원래대로
  const onQuitNav = (e) => {
    if (!training || quitWin.hidden || ended || e.ctrlKey || e.metaKey || e.altKey) return;
    const b = [quitStay, quitGo], i = b.indexOf(document.activeElement);
    let to;
    if (e.key === 'ArrowLeft') to = 0;
    else if (e.key === 'ArrowRight') to = i < 0 ? 0 : 1;
    else if (e.key === 'Tab') to = i < 0 ? 0 : (i + 1) % 2; // 두 칸이라 Shift+Tab 도 같은 순환
    else return;
    e.preventDefault(); e.stopPropagation();
    b[to].focus({ preventScroll: true });
  };
  addEventListener('keydown', onQuitNav, true);
  // 필살기 임팩트 연출 켬/끔(fx.impact, 기본 켬: 오라·트레일·명중·화면 흔들림, game/impact.js). 누른 뒤 포커스를 풀어 경기 키 입력과 겹치지 않게
  const impactBtn = h('button.btn.small', { type: 'button', 'aria-pressed': String(impactOn()), title: '필살기 이펙트',
    onclick: () => { setImpactOn(!impactOn()); impactBtn.setAttribute('aria-pressed', String(impactOn())); impactBtn.blur(); } }, '이펙트');
  // 필살슛 이름 말풍선 켬/끔(fx.shout, 기본 켬, game/shout.js)
  const shoutBtn = h('button.btn.small', { type: 'button', 'aria-pressed': String(shoutOn()), title: '필살슛 말풍선',
    onclick: () => { setShoutOn(!shoutOn()); shoutBtn.setAttribute('aria-pressed', String(shoutOn())); shoutBtn.blur(); } }, '말풍선');
  // 하단 줄은 `설정`·기권 2개. 소리·이펙트·말풍선 토글은 `설정` 을 누르면 그 위로 펼쳐지는 칸 안에 둔다(바깥을 누르거나 다시 누르면 접힘).
  // 칸은 접혀 있어도 DOM 에 남긴다(소리 버튼 구독 유지, audio.js soundButton). 단축키 M(소리)·H(조작키 안내)·Esc(특훈 그만두기)는 그대로
  const opts = h('div.game-opts', { hidden: true, role: 'group', 'aria-label': '설정' }, soundButton(h), impactBtn, shoutBtn);
  const optBtn = h('button.btn.small', { type: 'button', 'aria-expanded': 'false', onclick: () => toggleOpts() }, '설정');
  function toggleOpts(on = opts.hidden) { opts.hidden = !on; optBtn.setAttribute('aria-expanded', String(on)); optBtn.blur(); }
  // 조작키 안내는 처음엔 접어 둔다(사용자 요청: 화면을 가림). 하단 줄 「조작」 명령 칸 · H 키로 펼치고, 다시 누르기 · H · 바깥 클릭으로 닫는다. 튜토리얼(특훈)은 조작을 배우는 곳이라 펼친 채 시작
  let guideOpen = !!training;
  const guideBtn = h('button.btn.small.ctl-btn', { type: 'button', 'aria-expanded': String(guideOpen), 'aria-keyshortcuts': 'H', onclick: () => toggleGuide() }, '조작');
  function toggleGuide(on = !guideOpen) { guideOpen = !!on; guideBtn.setAttribute('aria-expanded', String(guideOpen)); guideBtn.blur(); fit(); }
  const help = h('div.help', opts, guideBtn, optBtn, quit);
  const onOptsOut = (e) => {
    if (!opts.hidden && !help.contains(e.target)) toggleOpts(false);
    if (guideOpen && !training && !guide.contains(e.target) && !guideBtn.contains(e.target)) toggleGuide(false);
  };
  addEventListener('pointerdown', onOptsOut);
  const wrap = h('div.game' + (training ? '.train' : ''), bar, stage, help);
  root.append(wrap);
  // 조작키 안내(키보드 전용, input.js KEYMAP 과 일치: A=A, S=B, D=C 점프, F=S 포메이션). 펼치면 옆 여백이 있으면 캔버스 밖, 없으면 캔버스 왼쪽 아래 불투명 창.
  // 「조작」 칸·H 로 펼침/닫기(경기마다 접힌 채 시작, 종전 dd.ctlGuide 저장 값은 읽지 않는다), 터치 기기는 숨김(가상 패드)
  const row = (k, t) => [h('span.ck', ...k.map((x, i) => (i ? [' + ', h('b', x)] : h('b', x))).flat()), h('span', t)];
  // 캐치 특훈: A·S 모두 상대 조준 투구(패스 없음), 필살·포메이션 없음(PROTOCOL §9.1). 필살 슛 특훈: 같은 조작 + 점프 중 S 길게 = 차지(§9.5)
  const guide = h('div.ctl-guide', { 'aria-label': '조작키' },
    ...(training
      ? [...row(['←↑↓→'], '이동'), ...row(['A'], '줍기·던지기·웅크림'), ...row(['S'], '캐치·던지기'), ...row(['D'], '점프'),
        ...(trSpecial ? row(['D', 'S'], '길게 → 필살기') : []), ...row(['Esc'], '그만두기')]
      : [...row(['←↑↓→'], '이동'), ...row(['A'], '줍기·패스·웅크림'), ...row(['S'], '캐치·던지기·차지'),
        ...row(['D'], '점프'), ...(noSpecial ? [] : row(['D', 'S'], someNoSp ? '길게 → 필살기 · 없으면 일반 슛' : '길게 → 필살기')), ...row(['F'], '포메이션')]),
    h('span.ck.dim', h('b', 'H')), h('span.dim', '닫기'));
  function placeGuide(cw) {
    guideBtn.hidden = !!pad;
    guide.hidden = !guideOpen || !!pad;
    if (guide.hidden) return;
    guide.classList.add('side'); wrap.append(guide);
    if ((innerWidth - cw) / 2 - 16 < guide.offsetWidth) { guide.classList.remove('side'); stage.insertBefore(guide, keys); }
  }
  const onGuideKey = (e) => {
    if (e.code !== 'KeyH' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    toggleGuide();
  };
  addEventListener('keydown', onGuideKey);
  const input = new InputSender((bits) => net.send('input', { bits }));
  // 터치 기기: 가상 패드(마우스 환경에서는 만들지 않음) + 스크롤·확대·길게 눌러 메뉴 방지
  const coarse = matchMedia(COARSE_MQ);
  let pad = null;
  const noMenu = (e) => e.preventDefault();
  function applyTouch() {
    const on = coarse.matches;
    wrap.classList.toggle('touch', on);
    keyJump.textContent = on ? 'C' : 'D'; keyThrow.textContent = on ? 'B' : 'S';
    if (on && !pad) { pad = new TouchPad((b) => input.setTouch(b), { training: !!training }); wrap.append(pad.el); }
    else if (!on && pad) { pad.reset(); pad.el.remove(); pad = null; }
    fit();
  }
  wrap.addEventListener('contextmenu', noMenu);
  document.addEventListener('gesturestart', noMenu); // iOS 사파리 핀치
  const onBlur = () => pad?.reset();
  addEventListener('blur', onBlur);
  // 데스크톱 Ctrl+휠(트랙패드 핀치 포함) 확대 방지: 경기 화면에서만(unmount 에서 해제)
  const noWheelZoom = (e) => { if (e.ctrlKey) e.preventDefault(); };
  addEventListener('wheel', noWheelZoom, { passive: false });

  const seats = app.room?.slots ?? [];
  const nickOf = (s) => (isCpuSeat(app.room, s) ? '컴퓨터' : seats[s]?.nick ?? '');
  // 불꽃의 계승 오리지널 팀(PROTOCOL §12.2 game_start.flameCast = {seat, team|null, players[7]}): 표시용 정의. 없으면(일반 경기·종전 도전) 전부 종전 경로
  // 좌석별 표(casts[좌석]): 도전·1차 컴퓨터 대전 = 단일 객체 {seat, players…}, 사람끼리 방(§13.25) = {versus, seats:[{…cast, slot} | null, …]}(좌석 칸에 seat 없음 → 배열 위치가 좌석)
  const fc = start.flameCast, casts = [null, null];
  if (fc && Array.isArray(fc.seats)) fc.seats.slice(0, 2).forEach((c, s) => { if (c && Array.isArray(c.players)) casts[s] = c; });
  else if (fc && Array.isArray(fc.players) && (flDraw || vsSeats)) { const s = fc.seat === 0 || fc.seat === 1 ? fc.seat : flDraw?.seat; if (s === 0 || s === 1) casts[s] = fc; }
  const castTeamOf = (s) => { const t = casts[s]?.team; return t && typeof t.name === 'string' && t.name ? t : null; };
  const castAt = (seat, i) => { const p = casts[seat]?.players?.[i]; return p && typeof p === 'object' ? p : null; };
  const tName = (s) => (castTeamOf(s) ? castTeamOf(s).name : teamName(start.teams[s].id, start.teams[s].name));
  nameL.textContent = `${nickOf(0)} · ${tName(0)}`; nameR.textContent = `${tName(1)} · ${nickOf(1)}`;

  // ---- 크기: 창에 꽉 차게(util.fitScale: 정수배가 거의 꽉 차면 정수배, 아니면 비정수 최근접 이웃) ----
  // 16:9 창처럼 캔버스가 화면을 다 채우면 이름 줄·도움말을 캔버스 위에 겹치고(.ov), 위아래에 자리가 남으면(비 16:9·세로) 캔버스 밖에 둔다.
  // 터치: 세로면 캔버스 위·패드 아래(패드 높이 확보), 가로면 캔버스를 꽉 채우고 패드를 양쪽 아래에 겹친다
  const FLOW_H = 76; // 캔버스 밖 이름 줄 + 도움말 줄 높이
  let overMode = null;
  function fit() {
    const vw = innerWidth, vh = innerHeight, land = vw > vh;
    wrap.classList.toggle('land', !!pad && land);
    const padH = pad && !land ? 230 : 0;
    const full = fitScale(vw, vh - padH, W, H);
    const over = (!!pad && land) || vh - padH - full.ch < FLOW_H;
    const s = over ? full : fitScale(vw, vh - padH - FLOW_H, W, H);
    if (over !== overMode) {
      overMode = over;
      wrap.classList.toggle('ov', over);
      if (over) stage.insertBefore(bar, keys), stage.insertBefore(help, keys);
      else wrap.insertBefore(bar, stage), stage.after(help);
    }
    stage.style.width = s.cw + 'px'; stage.style.height = s.ch + 'px';
    bar.style.width = over ? '' : s.cw + 'px';
    stage.style.setProperty('--k', s.k);
    stage.style.setProperty('--ki', Math.max(1, Math.floor(s.k + 0.01))); // 캔버스에 붙는 DOM 글자(배너·떠오르는 글자)는 정수 배율(css)
    toastK = s.k; placeToast();
    placeGuide(s.cw);
  }
  // 특훈: 토스트가 HUD(가운데 N/3단계)를 가리지 않게 HUD 줄(26px) 아래로 내린다(css #toasts --toast-top, unmount 에서 해제).
  // 필살 슛 특훈은 게이지(y 40 까지)·상단 벽 구간(y 44~68, 예전 필살 컷인 자리 — 이후 연출용으로 비워 둔다) 아래, 그만두기 창이 떠 있으면 그 창 아래
  let toastK = 1;
  function placeToast() {
    if (!training) return;
    let top = Math.max(0, stage.getBoundingClientRect().top) + (trSpecial ? 70 : 28) * toastK;
    if (trSpecial && !quitWin.hidden) top = Math.max(top, quitWin.firstElementChild.getBoundingClientRect().bottom + 6);
    document.body.style.setProperty('--toast-top', Math.round(top) + 'px');
  }
  addEventListener('resize', fit);
  coarse.addEventListener('change', applyTouch);
  applyTouch();

  // ---- 에셋 (키로만 참조) ----
  const layout = entry(`spr.team.${pad2(start.teams[0].id)}`);
  // 불꽃의 계승 혼합 로스터(PROTOCOL §12.2): game_start.teams[seat].players[i].from = {team, idx} 가 하나라도 있으면 pid -> 출신 표를 만든다. 없으면 null(종전대로 좌석 팀·pid%7)
  // 오리지널 선수 칸(flameCast.players[i])은 from 대신 빌린 몸 skin.team·skin.idx 로 시트·행·얼굴을 찾고(cast = 말풍선이 선수 고정 문구를 건너뛴다), skin 은 색 세트용으로 같이 둔다
  const orig = start.teams.some((t) => t.players?.some((p) => p.from)) ? start.teams.flatMap((t, seat) => Array.from({ length: 7 }, (_, i) => {
    const from = t.players?.[i]?.from ?? { team: t.id, idx: i }, cp = castAt(seat, i), sk = cp ? Skin.validSkin(cp.skin) : null;
    return cp ? { team: sk ? sk.team : from.team, idx: sk ? sk.idx : from.idx, cast: true, skin: sk } : from;
  })) : null;
  // 특훈 HUD: 얼굴 4칸·인원 숫자 대신 `캐치 NN구 / 남은 NN구`, 필살 슛 특훈은 `필살 슛 NN구` + 차지 게이지(game/training.js)
  const hud = training ? new TrainHud({ kind: training.kind, steps: training.steps ?? 3, balls: training.balls ?? 10, pass: training.pass ?? 6, oppPid: (1 - you) * 7, gauge: training.gauge }) : new Hud({
    teamIds: start.teams.map((t) => t.id), timed: (start.rules?.limitFrames ?? 0) > 0,
    resumed: !!start.resumed, remDelay: start.rules?.swapFrames ?? 0, names: [0, 1].map((s) => [nickOf(s), tName(s)]),
    you: you === 1 ? 1 : 0, fmUses: start.rules?.formation?.enabled ? start.rules.formation.uses ?? 3 : 0,
    official: start.rules?.mode === 'official', // こうしき: 얼굴 맨 위 고정(hud.js)
    orig, pFaces: orig ? new Array(14).fill(null) : null, // 색을 바꾼 얼굴(오리지널 선수 pid 만). 없으면 아틀라스
    hpCap: orig ? hpCapOf(start) : 0, // 혼합 로스터: 이 경기의 최대 HP(112 를 넘으면 얼굴 높이를 그 값에 맞춰 줄인다, hud.js flameFaceY)
  });
  const renderer = new Renderer(canvas, {
    sheets: [null, null], anims: null, bodyClass: [[], []], cell: layout.cell, origin: layout.origin, you, hud,
    cpuSeats: [isCpuSeat(app.room, 0), isCpuSeat(app.room, 1)], banRules: start.rules?.start?.banners,
    fmName: new FmName(), impact: new ImpactFx(), shout: new ShoutFx({ teamIds: start.teams.map((t) => t.id), orig }),
    orig, pSheets: orig ? new Array(14).fill(null) : null,
    pRow: orig ? new Array(14).fill(null) : null, // 선수별 띠 시트(색 치환)를 쓰는 pid 의 행 번호(0). null = 시트의 선수 번호 행
  });
  // 로딩 완료(성공·실패 모두) 전에는 렌더러가 검은 화면만 그린다. 실패한 에셋은 렌더러 폴백
  const loads = [];
  const track = (pr) => { loads.push(pr.catch((e) => console.error(e))); };
  for (const [k, f] of [['hud.faces', 'faces'], ['hud.pole', 'pole'], ['hud.digits', 'digits'], ['hud.dash', 'dash'],
    ['hud.timer', 'timer'], ['hud.marker.1p', 'm1p'], ['hud.marker.com', 'mcom'], ['hud.marker.2p', 'm2p']]) {
    if (has(k)) track(image(k).then((img) => { hud.imgs[f] = img; }));
  }
  track(Promise.all([json('anim.body'), json('data.sprite.teams')]).then(([anims, steams]) => {
    renderer.animIndex = buildAnimIndex(anims);
    renderer.bodyClass = orig
      ? [0, 1].map((s) => Array.from({ length: 7 }, (_, i) => steams[orig[s * 7 + i].team]?.players?.[orig[s * 7 + i].idx]?.body_class))
      : start.teams.map((t) => (steams[t.id]?.players ?? []).map((p) => p.body_class));
  }));
  // 스테이지 배경(원경·근경·시차표)과 공 시트. 실패하면 stage_00 → 단색 배경/원 공으로 폴백
  track(loadStage(start.stage, renderer));
  if (has('spr.ball')) track(image('spr.ball').then((img) => { renderer.ballImg = img; }));
  if (has('data.sprite.ball')) track(json('data.sprite.ball').then((d) => { renderer.ballData = d; }));
  // 필살슛 말풍선 문구 표. 실패하면 전부 기본 문구
  track(jsonAt('data/special_shouts.json').then((d) => { renderer.shout.setData(d); }));
  // 심판·배너(시작/종료 연출). 실패하면 그리지 않는다
  for (const [k, f] of [['spr.referee', 'refImg'], ['spr.banners', 'banImg']]) {
    if (has(k)) track(image(k).then((img) => { renderer[f] = img; }));
  }
  if (has('data.sprite.referee')) {
    track(json('data.sprite.referee').then((d) => {
      renderer.refData = d;
      renderer.refAnims = Object.fromEntries(Object.entries(d.anims).map(([name, an]) => [an.id, name]));
    }));
  }
  if (has('data.sprite.banners')) track(json('data.sprite.banners').then((d) => { renderer.banData = d; }));
  start.teams.forEach((t, seat) => track(image(`spr.team.${pad2(t.id)}`).then((img) => { renderer.sheets[seat] = img; })));
  // 혼합 로스터: 출신 팀 시트를 팀마다 한 번 받아 그 팀 출신 선수(pid)에 건다. 실패한 칸은 좌석 팀 시트로 폴백(render.js)
  if (orig) for (const tid of new Set(orig.map((o) => o.team))) track(image(`spr.team.${pad2(tid)}`).then((img) => { orig.forEach((o, pid) => { if (o.team === tid && renderer.pRow[pid] === null) renderer.pSheets[pid] = img; }); }));
  // 오리지널 선수: 유니폼·머리 색을 바꾼 선수별 띠(2행)와 HUD 얼굴. 만들지 못한 칸은 위의 원본 시트·얼굴 그대로(flame/skin.js)
  if (orig) orig.forEach((o, pid) => {
    if (!o.skin || !Skin.tinted(o.skin)) return;
    // 상대 유니폼과 겹치는 세트는 그 경기에서만 원정 세트로(orig_skin.json away, 없으면 그대로). 얼굴 칸은 양말·손목 색이 없어 그대로 둔다
    track(Skin.awaySkin(o.skin, start.teams[pid < 7 ? 1 : 0]?.id).then((sk) => Skin.strip(sk)).then((c) => { if (c) { renderer.pSheets[pid] = c; renderer.pRow[pid] = 0; } }));
    if (hud.pFaces) track(Skin.faceCanvas(o.skin).then((c) => { if (c) hud.pFaces[pid] = c; }));
  });
  Promise.all(loads).then(() => { renderer.ready = true; });

  // ---- 상태 ----
  const buf = new SnapBuffer();
  const stStart = new Array(14).fill(0);
  let helpDim = 0;
  let prevSnap = null, ended = null, roomWaiting = false, paused = null, backTimer = 0, bannerUntil = 0, raf = 0;

  function showBanner(text, ms = 1200, cls = '') {
    banner.textContent = text; banner.className = 'banner ' + cls; banner.hidden = false;
    bannerUntil = ms ? performance.now() + ms : Infinity;
  }

  // 특훈은 곡의 장면 대응이 확정되지 않아 무음(analysis/27 남은 일). 그 외: 경기 곡 진행(입장 0x95 → 토스 뒤 경기 곡)
  const mbgm = training ? { onEvent() {}, resume() {}, stop() {} } : matchBgm(start);
  let trPhase = null;
  /** 특훈 단계 결과(snap.tr.phase 'result' 동안): 합격/재시도. 이벤트가 아니라 상태로 그려 재접속에도 맞는다 */
  function onTrain(tr) {
    if (!tr || ended || tr.phase === trPhase) return;
    const was = trPhase; trPhase = tr.phase;
    if (tr.phase === 'result') showBanner(tr.count >= (training.pass ?? 6) ? '합격' : '재시도', 0, 'big');
    else if (was === 'result') banner.hidden = true;
  }
  function onSnap(s) {
    if (!prevSnap && start.resumed && s.ph === 'play') mbgm.resume(); // 진행 중 경기 복귀
    if (prevSnap) for (let i = 0; i < 14; i++) if (s.p[i][3] !== prevSnap.p[i][3]) stStart[i] = s.f;
    prevSnap = s;
    buf.push(s);
    // 시작/종료 글자는 원작 배너(snap.ban)를 캔버스에 그린다. 구버전 서버(lock 없음)는 준비 단계에만 안내
    keys.hidden = (s.lock ?? (s.ph === 'ready' ? 1 : 0)) !== 1 || !!ended;
    // 겹침 배치: 경기가 시작되고 6초 뒤 도움말 줄을 흐린 표시로(조작 안내는 「조작」 칸으로만 펼친다)
    if (!helpDim && s.ph === 'play' && !s.lock) helpDim = setTimeout(() => { help.classList.add('dim'); }, 6000);
    for (const e of s.ev || []) onEvent(e, s);
    if (training) onTrain(s.tr);
    timer.textContent = s.sd ? '서든데스' : '';
  }

  let refOutSeen = false;

  function onEvent(e, s) {
    const pos = (pid) => { const p = s.p[pid]; return p ? [p[0] / 16, p[1] / 16, p[2] / 16] : null; };
    mbgm.onEvent(e);
    if (!(training && e.k === 'end')) playEvent(e, { fm: !!s.fm }); // 효과음: 이벤트 → 키 표(game/sfxmap.js), manifest 에 없는 키는 무음. 특훈 완료에는 GAME SET 이 없다
    switch (e.k) {
      case 'ref_out': refOutSeen = true; floatText(pos(e.p), '아웃!'); break; // 심판 호루라기(애니는 snap.ref)와 같은 순간
      case 'hit': {
        const q = pos(e.p); if (q) renderer.flash(q[0], q[1], q[2], 'hit', s.f);
        if (e.kind) renderer.impact.hit(q, e.kind - 1, s.f, e.dmg); // 필살 공 명중: 충격 링·스파크·흔들림(옵션 꺼짐이면 무시)
        break;
      }
      case 'catch': {
        const q = pos(e.p); if (q) renderer.flash(q[0], q[1], q[2], 'catch', s.f);
        if (!training || (e.p < 7) === (you === 0)) showBanner('캐치!', 700); // 특훈: 연습 상대는 내 공을 언제나 잡는다 → 내 캐치만 알린다
        break;
      }
      case 'special': {
        renderer.specialCue(e.p, s.f);
        renderer.impact.special(e.p, e.id, s.f); // 투구 선수 오라(옵션 꺼짐이면 무시)
        renderer.shout.special(e.p, e.id, s.f); // 투구 선수 머리 위 슛 이름 말풍선(옵션 꺼짐이면 무시)
        break;
      }
      case 'out': if (!refOutSeen) floatText(pos(e.p), '아웃!'); break; // ref_out 없는 구버전 서버
      case 'fl_survive': { // 불꽃의 계승: 치사 피해를 HP 1 로 버팀(PROTOCOL §12.3)
        const q = pos(e.p); floatText(q, '버텼다!', 'survive'); if (q) renderer.flash(q[0], q[1], q[2], 'catch', s.f);
        break;
      }
      default:
    }
  }

  /** 선수 머리 위에 잠깐 떠올랐다 사라지는 글자 (DOM, 화면 해상도) */
  function floatText(q, text, cls = '') {
    const k = +stage.style.getPropertyValue('--k') || 1;
    const cam = renderer.cam ?? 0;
    const x = q ? Math.max(24, Math.min(W - 24, q[0] - cam)) : W / 2;
    const y = q ? Math.max(40, q[1] / 2 - q[2] + 96 - 40) : 48;
    const el = h('div.float-txt' + (cls ? '.' + cls : ''), { style: { left: x * k + 'px', top: y * k + 'px' } }, text);
    floats.append(el);
    setTimeout(() => el.remove(), 1000);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (banner.hidden === false && now > bannerUntil) banner.hidden = true;
    const sm = buf.sample(now);
    if (sm) renderer.draw(sm, stStart);
    if (paused) {
      const left = Math.max(0, Math.ceil((paused.deadline - net.now()) / 1000));
      paused.el.textContent = `${paused.nick} 연결 끊김 · ${left}초 대기`;
    }
  }
  raf = requestAnimationFrame(frame);

  // 캠페인: 결과 카드 대신 campaign_result 수신 시 main 이 스토리 화면(경기 후 대화)으로 넘긴다.
  // campaign_result 가 오지 않으면(구버전 서버 등) 일반 결과 카드로 폴백
  let campFallback = 0;
  function onGameEnd(m) {
    if (training) { // 특훈: game_end -> training_end -> room_left -> room_list (PROTOCOL §9.2). 결과 곡·결과 카드 없음
      ended = m; input.setEnabled(false); buf.frozen = true; keys.hidden = true; quitWin.hidden = true; placeToast();
      return;
    }
    playResult(m.winner, you, !!campaign || !!league || isCpuSeat(app.room, you === 1 ? 0 : 1));
    if (!campaign) return showResult(m);
    ended = m;
    input.setEnabled(false);
    buf.frozen = true;
    keys.hidden = true;
    campFallback = setTimeout(() => { if (app.view === 'game') showResult(m); }, 4000);
  }

  function showResult(m) {
    ended = m;
    input.setEnabled(false);
    buf.frozen = true;
    banner.hidden = true;
    renderer.noBanner = true; // 결과 카드와 GAME SET 등 캔버스 배너가 겹치지 않게
    const title = m.winner === -1 ? '무승부' : m.winner === you ? '승리!' : '패배';
    btn = h('button.btn.primary', { type: 'button', onclick: back }, backLabel);
    keys.hidden = true;
    overlay.className = 'overlay result';
    titleEl = h('div.result-title' + (m.winner === you ? '.win' : ''), title);
    if (practice) setFlameLine('연습 경기'); // 연습 경기: 승패만(보상·코인 줄 없음). 서버 판정(flame_result.won)이 오면 제목을 그것으로 맞춘다
    if (practiceWon !== null) setPracticeTitle();
    overlay.replaceChildren(h('div.pwin.result-card',
      titleEl,
      h('div.result-rule', END_RULE[m.reason] ?? END_REASON[m.reason] ?? m.reason),
      h('div.muted.tabular', `남은 인원 ${m.rem[0]} : ${m.rem[1]}`),
      rankLine, flameLine, btn));
    overlay.hidden = false;
    setTimeout(() => btn.focus(), 30);
    armBack(BACK_MS);
  }
  /** 특훈(화면 표기 = 튜토리얼) 종료: 3단계 통과만 완료 카드(→ 튜토리얼 화면). 그만두기·기권·오류는 이어지는 room_left 가 바로 튜토리얼 화면으로 보낸다(오류 사유는 서버 토스트) */
  let trainDone = false;
  function onTrainingEnd(m) {
    if (!training || !m.cleared) return;
    trainDone = true; ended ??= m;
    input.setEnabled(false); buf.frozen = true; banner.hidden = true; quitWin.hidden = true; placeToast(); keys.hidden = true;
    btn = h('button.btn.primary', { type: 'button', onclick: back }, backLabel);
    overlay.className = 'overlay result';
    overlay.replaceChildren(h('div.pwin.result-card', h('div.result-title.win', '튜토리얼 완료'), btn));
    overlay.hidden = false;
    setTimeout(() => btn.focus(), 30);
    armBack(BACK_MS);
  }
  // 결과 화면 자동 복귀: 10초 카운트다운(버튼에 표시), 버튼을 누르면 즉시
  const BACK_MS = 10000;
  const backLabel = training ? '튜토리얼로' : campaign ? '스토리로' : league ? '리그로' : flame ? '도전으로' : '대기실로';
  let btn = null, backAt = 0, backTick = 0;
  function armBack(ms) {
    clearTimeout(backTimer); clearInterval(backTick);
    backAt = performance.now() + ms;
    backTimer = setTimeout(back, ms);
    const paint = () => { if (btn) btn.textContent = `${backLabel} (${Math.max(0, Math.ceil((backAt - performance.now()) / 1000))})`; };
    paint(); backTick = setInterval(paint, 250);
  }
  function back() {
    clearTimeout(backTimer); clearInterval(backTick);
    if (app.view !== 'game') return;
    if (training) app.go('tutorial');
    else if (campaign) app.go('story', { mode: 'list' });
    else if (league) app.go('league', { mode: 'menu' });
    else if (flame) app.go('flame', { mode: 'auto' });
    else if (app.room) app.go('room');
  }

  // 랭크 경기(PROTOCOL §11.3): ranking_result 가 game_end 바로 뒤에 온다 -> 결과 카드 버튼 위에 `레이팅 전 → 후 (±delta)`.
  // 내가 기권해 곧 로비로 넘어가면(카드가 남지 않는다) 같은 줄을 토스트로
  const rankLine = h('div.result-rank.tabular', { hidden: true });
  let leaving = false;
  // 불꽃의 계승: game_end 뒤에 오는 flame_result(재경기)·flame_end(도전 종료·우승)를 결과 카드 버튼 위 한 줄로
  const flameLine = h('div.result-flame', { hidden: true });
  const setFlameLine = (t) => { flameLine.textContent = t; flameLine.hidden = !t; };
  // 연습 경기 결과(flame_result{practice, won}): 결과 카드 제목 = 서버가 본 승패. 무승부(game_end.winner -1)는 won 이 false 로 와도 '무승부' 그대로 둔다
  let titleEl = null, practiceWon = null;
  const setPracticeTitle = () => {
    if (!titleEl || (!practiceWon && ended?.winner === -1)) return;
    titleEl.textContent = practiceWon ? '승리!' : '패배'; titleEl.classList.toggle('win', practiceWon);
  };
  function onRankingResult(r) {
    if (![r?.before, r?.after, r?.delta].every(Number.isFinite)) return;
    const d = r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? `−${-r.delta}` : '±0';
    const text = `레이팅 ${r.before} → ${r.after} (${d})`;
    rankLine.textContent = text; rankLine.hidden = false;
    rankLine.classList.toggle('up', r.delta > 0); rankLine.classList.toggle('down', r.delta < 0);
    if (leaving) toast(text, r.delta < 0 ? 'warn' : 'ok', 5000);
  }

  let quitArmed = 0;
  function onQuit() {
    if (ended) return back();
    if (training) { quit.blur(); return toggleQuitWin(); }
    if (!quitArmed) {
      quit.textContent = '정말 기권?'; quit.classList.add('danger');
      quitArmed = setTimeout(() => { quitArmed = 0; quit.textContent = '기권'; quit.classList.remove('danger'); }, 3000);
      return;
    }
    leaving = true;
    net.send('leave_room');
  }

  return {
    on_snap: onSnap,
    on_game_pause(m) {
      buf.frozen = true; input.setEnabled(false);
      const el = h('div.pwin.pause-card');
      overlay.className = 'overlay'; overlay.replaceChildren(el); overlay.hidden = false;
      paused = { ...m, el };
    },
    on_game_resume() {
      paused = null; buf.frozen = false; input.setEnabled(true);
      if (!ended) overlay.hidden = true;
    },
    on_game_end: onGameEnd,
    on_training_end: onTrainingEnd,
    on_ranking_result: onRankingResult,
    on_flame_result(m) {
      if (m.practice === true || m.outcome === 'practice') { // 연습 경기(PROTOCOL §13.15): 승패만 보이고 지도로 돌아간다(보상·코인·도전 종료 줄 없음)
        practiceWon = m.won === true; setFlameLine('연습 경기'); setPracticeTitle();
        return;
      }
      if (m.outcome === 'rematch') setFlameLine(m.saveFailed ? '저장 실패 · 재경기' : '재경기'); // saveFailed = 결과 저장 실패(사유는 서버 error 토스트, PROTOCOL §13.2)
      else if (m.champion === true) setFlameLine('우승!'); // 엔드리스(§13.12): 우승해도 flame_end 는 오지 않고 도전이 이어진다
      if (m.artifactPoints > 0) toast(`${flArtOff() ? '아이템' : '아티팩트'} 대신 경기 포인트 +${m.artifactPoints}`, 'ok', 4200); // 아티팩트 고갈(off §13.26 = 보스 보상으로 낼 아이템이 없음)
    },
    on_flame_end(m) { setFlameLine(m.summary?.result === 'champion' ? '우승' : '도전 종료'); },
    holdLobby: () => trainDone || ((!!league || !!flame) && !!ended), // 완료·결과 카드가 떠 있으면 room_left 가 화면을 넘기지 않는다(main.js)
    renderer, campaign, training, league, flame,
    onRoom(room) {
      roomWaiting = room.status === 'waiting';
      if (ended && roomWaiting && !backAt && btn) armBack(BACK_MS);
    },
    onNetClose() {
      if (ended) return;
      input.setEnabled(false); buf.frozen = true;
      overlay.className = 'overlay'; overlay.replaceChildren(h('div.pwin.pause-card', '다시 연결하는 중…')); overlay.hidden = false;
    },
    unmount() {
      document.body.style.removeProperty('--toast-top');
      mbgm.stop();
      cancelAnimationFrame(raf); clearTimeout(backTimer); clearInterval(backTick); clearTimeout(quitArmed); clearTimeout(campFallback); clearTimeout(helpDim);
      input.setEnabled(false); input.destroy();
      removeEventListener('resize', fit); removeEventListener('blur', onBlur); removeEventListener('keydown', onGuideKey); removeEventListener('keydown', onEsc); removeEventListener('keydown', onQuitNav, true); removeEventListener('pointerdown', onOptsOut); removeEventListener('wheel', noWheelZoom, { passive: false });
      coarse.removeEventListener('change', applyTouch);
      document.removeEventListener('gesturestart', noMenu);
    },
  };
}
