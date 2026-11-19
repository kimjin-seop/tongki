// 앱 진입점: 에셋 manifest·폰트 로드 → 연결 → 화면 라우팅(닉네임 → 로비 → 대기실 → 경기 → 결과 → 대기실)
import { net } from './net.js';
import { loadManifest, loadFonts } from './game/assets.js';
import { toast } from './ui.js';
import { loadNames, teamName, teamLabel } from './names.js';
import { ERR, ROOM_LEFT, TRAIN_END, LEAGUE, RANK_WHY } from './i18n.js';
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
import * as Tutorial from './screens/tutorial.js';
import * as League from './screens/league.js';
import * as Ranking from './screens/ranking.js';
import * as Flame from './screens/flame/index.js';
import { setCatalog as setFlameCatalog } from './screens/flame/store.js';
import * as Intro from './intro.js';
import { audio } from './audio.js';
import { screenBgm, bindUiSfx } from './game/sfxmap.js';

export const app = {
  nick: null, you: null, rooms: [], room: null, welcome: null, teams: [],
  campaign: null, // 최근 campaign_list {progress, chapters}
  account: false, // 계정 세션인가(welcome.account / account_ok, PROTOCOL §2.1)
  rankBoard: null, // 최근 ranking_list {top, me}(§11.3)
  league: null, leagueChamp: null, // 최근 league_state(PROTOCOL §10) / 아직 보여 주지 않은 league_end 우승 팀 idx
  flame: null, flameEnd: null, // 불꽃의 계승(PROTOCOL §13): 최근 flame_state / 아직 보여 주지 않은 flame_end 요약
  flameChamp: null, flameRank: null, // 아직 보여 주지 않은 우승(flame_result.champion: {run, achievements}, §13.12) / 최근 flame_ranking {top, me, total}(§13.13)
  view: null, screen: null,
  intro: null, // 부팅 인트로 제어(재생 중일 때만)
  sfx: (key, opt) => audio.play(key, opt), // 소리 키 재생(bgm.* 는 BGM 전환). 없는 키·잠금 전은 무음
  bgm: (key) => audio.bgm(key),
  bgmStop: () => audio.bgmStop(), // 원작 0xE1(즉시 정지)
  go(name, data) {
    const mods = { nick: Nick, lobby: Lobby, room: Room, game: Game, story: Story, prematch: Prematch, rules: Rules, lineup: Lineup, tutorial: Tutorial, league: League, ranking: Ranking, flame: Flame };
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
  // 접속 화면에 머물다 서버가 LOGIN_TIMEOUT 으로 끊는 경우(로그아웃 뒤 5분 등): 자동 재연결되고 화면은 그대로라 토스트·끊김 알림을 띄우지 않는다
  let quietClose = false;
  net.on('error', (m) => {
    if (m.code === 'LOGIN_TIMEOUT' && app.view === 'nick') { quietClose = true; return; }
    toast(m.msg || ERR.UNKNOWN, 'error');
    app.screen?.onError?.(m);
    // 토큰 거절(저장 토큰은 net 이 지웠다)·다른 곳에서 접속: 로그인 화면으로(가입 화면이 떠 있었으면 일반 접속 화면으로)
    if (m.code === 'TOKEN_INVALID' || m.code === 'SESSION_REPLACED') { app.room = null; app.account = false; app.flame = null; app.flameEnd = null; app.flameChamp = null; app.flameRank = null; if (app.view !== 'nick' || app.screen?.upgrade) app.go('nick'); }
  });
  net.on('toast', (m) => toast(m.msg || m.code, 'warn'));
  net.on('close', ({ was }) => {
    if (was && !net.closing && !quietClose) toast(ERR.DISCONNECTED, 'error');
    quietClose = false;
    app.screen?.onNetClose?.();
  });
  net.on('open', () => {
    // 저장 토큰이 없으면 닉네임 화면, 있으면 hello{token} 결과(welcome/TOKEN_INVALID)를 기다린다
    if (!net.token && app.view !== 'nick') app.go('nick');
  });
  net.on('welcome', (m) => {
    if (m.resumed && app.view && app.view !== 'nick') toast(ERR.RECONNECTED, 'ok', 1500);
    app.welcome = m; app.nick = m.nickname; app.account = !!m.account; Nick.remember(m); app.teams = (m.teams || []).map((t) => ({ ...t, name: teamName(t.id, t.name), label: teamLabel(t.id, t.name) }));
    if (m.location === 'lobby' && !['story', 'tutorial', 'league', 'ranking', 'flame'].includes(app.view)) app.go('lobby');
    else if (m.location === 'lobby') app.screen?.onWelcome?.();
  });
  // 손님 → 계정 승격(토큰 교체는 net). 위치는 그대로
  net.on('account_ok', (m) => {
    app.account = true; if (app.welcome) app.welcome.account = true;
    if (app.view === 'nick') app.screen.onAccountOk?.(m); else if (app.view === 'lobby') app.go('lobby');
  });
  // 로그아웃: 연결은 남고 세션만 끝난다(저장 토큰은 net 이 지웠다) -> 로그인 화면
  net.on('logged_out', () => { app.room = null; app.account = false; app.welcome = null; app.flame = null; app.flameEnd = null; app.flameChamp = null; app.flameRank = null; app.go('nick', { mode: 'login', nick: app.nick }); });
  // 순위표(§11.3): 순위표 화면과 랭크 대기실(상대 레이팅)이 쓴다
  net.on('ranking_list', (m) => { app.rankBoard = m; app.screen?.onRankingList?.(m); });
  // 랭크 경기 레이팅 변동(game_end 바로 뒤): 결과 카드에 한 줄, 반영 안 된 사유는 토스트
  net.on('ranking_result', (m) => {
    if (!m.counted && RANK_WHY[m.why]) toast(RANK_WHY[m.why], 'warn');
    if (app.view === 'game') app.screen.on_ranking_result?.(m);
  });
  net.on('room_list', (m) => { app.rooms = m.rooms || []; if (app.view === 'lobby') app.screen.update?.(); });
  net.on('room_joined', (m) => {
    app.you = m.you; app.room = m.room;
    // 캠페인 방은 대기실을 거치지 않는다: 곧 game_start 가 온다(campaign_start·재접속 'game').
    // 경기가 끝난 대기 상태 방으로 재접속('room')했으면 스토리 목록으로
    if (m.room?.training) return; // 특훈 방(PROTOCOL §9): 대기실 없이 곧 game_start 가 온다
    if (m.room?.league) return; // 리그 방(PROTOCOL §10): 대기실 없이 곧 game_start{league} 가 온다
    if (m.room?.flame) return; // 불꽃의 계승 경기 방(PROTOCOL §13.5): 대기실 없이 곧 game_start{flame} 이 온다
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
    if (app.view === 'game' && app.screen.holdLobby?.()) return; // 튜토리얼(특훈) 완료 카드가 떠 있다: 카드의 '튜토리얼로'(자동 복귀 포함)가 넘긴다
    if (app.view === 'game' && app.screen.training) { app.go('tutorial'); return; } // 튜토리얼을 그만두거나 상한으로 끝났다: 고르는 화면으로
    if (app.view === 'game' && app.screen.league) { app.go('league', { mode: 'menu' }); return; } // 리그 경기 방 정리(결과 카드가 없을 때): 리그 메뉴로
    // 불꽃의 계승 경기 방 정리: 결과 카드가 떠 있으면 카드의 '도전으로'가 넘기고(holdLobby), 없으면 바로 도전 화면으로
    if (app.view === 'game' && app.screen.flame) { app.go('flame', { mode: 'auto' }); return; }
    if (app.view === 'league' || app.view === 'flame') return;
    if ((app.view === 'lineup' || app.view === 'prematch') && app.screen.flame) return; // 불꽃의 계승 경기 전 화면에서 온 정리: 그 화면이 제자리로 돌아간다
    if (app.view !== 'lobby') app.go('lobby');
  });
  net.on('game_start', (m) => { app.you = m.you; app.go('game', { start: m }); });
  net.on('training_end', (m) => { if (TRAIN_END[m.reason]) toast(TRAIN_END[m.reason], 'warn'); }); // 상한 종료 사유(화면 처리는 아래 game 화면 on_training_end)
  // 리그(PROTOCOL §10): 상태는 app.league 에 두고 리그 화면에 넘긴다. 사람 경기 중 온 우승은 리그 화면으로 돌아갈 때 보여 준다
  net.on('league_state', (m) => { app.league = m; if (app.view === 'league') app.screen.onLeagueState?.(m); });
  net.on('league_result', (m) => {
    if (!m.quick && !m.recorded) toast(LEAGUE.NOT_RECORDED, 'warn');
    if (app.view === 'league') app.screen.onLeagueResult?.(m);
  });
  net.on('league_end', (m) => { app.leagueChamp = m.champions || []; if (app.view === 'league') app.screen.onLeagueEnd?.(m); });
  // 불꽃의 계승(PROTOCOL §13): 상태는 app.flame 한 곳에 두고 화면은 그것만 그린다. 경기 종료 순서 = game_end{flame} → flame_result → (flame_end) → flame_state → room_left
  net.on('flame_state', (m) => { app.flame = m; if (app.view === 'flame') app.screen.onFlameState?.(m); });
  net.on('flame_catalog', (m) => { setFlameCatalog(m); if (app.view === 'flame') app.screen.onFlameCatalog?.(m); });
  net.on('flame_end', (m) => { app.flameEnd = m.summary ?? null; if (app.view === 'flame') app.screen.onFlameEnd?.(m); else if (app.view === 'game') app.screen.on_flame_end?.(m); });
  net.on('flame_result', (m) => {
    // 엔드리스 우승(§13.12): 도전은 이어진다. 도전 화면으로 돌아가면 그 도전에서 한 번 우승 화면을 보인다
    if (m.champion === true) app.flameChamp = { run: app.flame?.run?.id ?? null, achievements: Array.isArray(m.achievements) ? m.achievements : [] };
    if (m.practiceRefunded === true) toast('연습 경기를 다시 할 수 있습니다', 'info', 4200); // 엔진 오류로 끝난 연습 경기는 서버가 소비를 되돌린다(§13.18 (4))
    if (app.view === 'game') app.screen.on_flame_result?.(m);
  });
  // 내 순위용 응답(flame_ranking_get{top:1}: 순위표가 2명 이상인데 top 이 1줄 이하)은 me 만 갈아 끼운다 -> 순위 화면에 1줄짜리 표가 비치지 않는다(rank.js 는 top 이 없으면 '불러오는 중')
  net.on('flame_ranking', (m) => {
    const full = Array.isArray(m.top) && (m.top.length > 1 || !(m.total > 1));
    app.flameRank = full ? m : { ...(app.flameRank ?? {}), me: m.me ?? null };
    if (app.view === 'flame') app.screen.onFlameRanking?.(m);
  });
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
