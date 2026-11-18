// 앱 진입점: 에셋 manifest·폰트 로드 → 연결 → 화면 라우팅(닉네임 → 로비 → 대기실 → 경기 → 결과 → 대기실)
import { net } from './net.js';
import { loadManifest, loadFonts } from './game/assets.js';
import { toast } from './ui.js';
import { loadNames, teamName, teamLabel } from './names.js';
import { ERR, ROOM_LEFT, TRAIN_END } from './i18n.js';
import { $, isTyping } from './util.js';
import { loadPix } from './pix.js';
import * as Nick from './screens/nick.js';
import * as Lobby from './screens/lobby.js';
import * as Room from './screens/room.js';
import * as Game from './screens/game.js';
import * as Story from './screens/story.js';
import * as Prematch from './screens/prematch.js';
import * as Rules from './screens/rules.js';
import * as Lineup from './screens/lineup.js';
import * as Intro from './intro.js';
import { audio } from './audio.js';
import { screenBgm, bindUiSfx } from './game/sfxmap.js';

export const app = {
  nick: null, you: null, rooms: [], room: null, welcome: null, teams: [],
  campaign: null, // 최근 campaign_list {progress, chapters}
  view: null, screen: null,
  intro: null, // 부팅 인트로 제어(재생 중일 때만)
  sfx: (key, opt) => audio.play(key, opt), // 소리 키 재생(bgm.* 는 BGM 전환). 없는 키·잠금 전은 무음
  bgm: (key) => audio.bgm(key),
  bgmStop: () => audio.bgmStop(), // 원작 0xE1(즉시 정지)
  go(name, data) {
    const mods = { nick: Nick, lobby: Lobby, room: Room, game: Game, story: Story, prematch: Prematch, rules: Rules, lineup: Lineup };
    if (name === 'game' && this.intro?.active) this.intro.abort(); // 진행 중 경기로 복귀하면 인트로를 바로 끝낸다
    this.screen?.unmount?.();
    const root = $('#app'); root.innerHTML = '';
    this.view = name;
    this.screen = mods[name].mount(root, this, data) || {};
    document.body.dataset.view = name;
    screenBgm(name, data);
  },
};
window.__app = app; window.__net = net; window.__audio = audio; // 디버그·검증용

/**
 * 모바일 확대·선택 방지(앱 수명 동안 1회 등록, 화면 전환과 무관해 정리 불필요).
 * 안드로이드 크롬: viewport user-scalable=no + CSS touch-action. iOS 사파리는 user-scalable 을 무시하므로
 * gesture* 이벤트와 두 손가락 touchmove 를 막는다. 길게 눌러 메뉴·이미지 끌기는 입력칸 밖에서만 막는다.
 * 데스크톱 Ctrl+휠 확대는 경기 화면(game.js)에서만 막는다. Ctrl +/- 키 확대는 브라우저가 처리해 막을 수 없다.
 */
const editable = (t) => !!t?.closest?.('input, textarea, [contenteditable]');
function guardZoom() {
  const stop = (e) => e.preventDefault();
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (!editable(e.target)) e.preventDefault(); });
}
guardZoom();

// 소리: 첫 입력에서 잠금 해제, 메뉴 효과음, M = 소리 켬/끔(입력칸 타이핑 중 제외)
audio.install();
bindUiSfx();
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || isTyping(e.target)) return;
  audio.toggleMute();
});

function wire() {
  net.on('error', (m) => {
    toast(m.msg || ERR.UNKNOWN, 'error');
    app.screen?.onError?.(m);
    if (m.code === 'TOKEN_INVALID' || m.code === 'SESSION_REPLACED') { app.room = null; if (app.view !== 'nick') app.go('nick'); }
  });
  net.on('toast', (m) => toast(m.msg || m.code, 'warn'));
  net.on('close', ({ was }) => {
    if (was && !net.closing) toast(ERR.DISCONNECTED, 'error');
    app.screen?.onNetClose?.();
  });
  net.on('open', () => {
    // 저장 토큰이 없으면 닉네임 화면, 있으면 hello{token} 결과(welcome/TOKEN_INVALID)를 기다린다
    if (!net.token && app.view !== 'nick') app.go('nick');
  });
  net.on('welcome', (m) => {
    if (m.resumed && app.view && app.view !== 'nick') toast(ERR.RECONNECTED, 'ok', 1500);
    app.welcome = m; app.nick = m.nickname; app.teams = (m.teams || []).map((t) => ({ ...t, name: teamName(t.id, t.name), label: teamLabel(t.id, t.name) }));
    if (m.location === 'lobby' && app.view !== 'story') app.go('lobby');
    else if (m.location === 'lobby') app.screen?.onWelcome?.();
  });
  net.on('room_list', (m) => { app.rooms = m.rooms || []; if (app.view === 'lobby') app.screen.update?.(); });
  net.on('room_joined', (m) => {
    app.you = m.you; app.room = m.room;
    // 캠페인 방은 대기실을 거치지 않는다: 곧 game_start 가 온다(campaign_start·재접속 'game').
    // 경기가 끝난 대기 상태 방으로 재접속('room')했으면 스토리 목록으로
    if (m.room?.training) return; // 특훈 방(PROTOCOL §9): 대기실 없이 곧 game_start 가 온다
    if (m.room?.campaign) { if (app.welcome?.location === 'room' && app.view !== 'story' && app.view !== 'game') app.go('story', { mode: 'list' }); return; }
    app.go('room');
  });
  net.on('room_state', (m) => {
    app.room = m.room;
    if (app.view === 'room') app.screen.update?.();
    else if (app.view === 'game') app.screen.onRoom?.(m.room);
  });
  net.on('room_left', (m) => {
    app.room = null;
    if (ROOM_LEFT[m.reason]) toast(ROOM_LEFT[m.reason], 'warn');
    if (app.view === 'story') return; // 캠페인 방 정리(재시작·목록 복귀)는 스토리 화면 안에서 처리
    if (app.view === 'game' && app.screen.holdLobby?.()) return; // 특훈 완료 카드가 떠 있다: 카드의 '로비로'(자동 복귀 포함)가 넘긴다
    if (app.view !== 'lobby') app.go('lobby');
  });
  net.on('game_start', (m) => { app.you = m.you; app.go('game', { start: m }); });
  net.on('training_end', (m) => { if (TRAIN_END[m.reason]) toast(TRAIN_END[m.reason], 'warn'); }); // 상한 종료 사유(화면 처리는 아래 game 화면 on_training_end)
  net.on('campaign_list', (m) => { app.campaign = m; app.screen?.onCampaignList?.(m); });
  net.on('campaign_result', (m) => {
    if (app.campaign) app.campaign.progress = m.progress;
    app.go('story', { mode: 'post', result: m });
  });
  for (const t of ['snap', 'game_pause', 'game_resume', 'game_end', 'training_end']) {
    net.on(t, (m) => { if (app.view === 'game') app.screen['on_' + t]?.(m); });
  }
}

async function boot() {
  const root = $('#app');
  root.innerHTML = '<div class="center-screen"><div class="muted">불러오는 중…</div></div>';
  try {
    await loadManifest();
    // 오프닝 인트로: 저장 세션 자동 로그인이어도 재생, 같은 탭 두 번째부터 생략. 연결·화면 전환은 뒤에서 그대로 진행
    // 인트로 실패는 부팅을 막지 않는다(연결·라우팅 계속, #app inert 해제)
    try {
      if (Intro.shouldPlay()) app.intro = Intro.start({ app, onEnd: () => { app.intro = null; if (app.view && app.view !== 'game') screenBgm(app.view); } });
    } catch (e) {
      console.warn('intro', e);
      try { app.intro?.abort(); } catch { /* 무시 */ }
      app.intro = null;
      document.getElementById('intro')?.remove();
      document.querySelectorAll('.title-fly').forEach((x) => x.remove());
      delete document.body.dataset.intro;
      root.inert = false;
    }
    await Promise.all([loadFonts(), loadNames(), loadPix()]);
  } catch (e) { console.error(e); app.intro?.abort(); toast(ERR.ASSETS, 'error'); return; }
  wire();
  await net.connect();
}
boot();
