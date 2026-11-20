// 스토리(싱글 캠페인) 화면 (PROTOCOL §8): 챕터 목록 / 경기 전 대화 / 경기 후 대화 / 엔딩.
// 경기 자체는 game 화면. 캠페인 방은 대기실을 거치지 않는다(campaign_start → room_joined → room_state → game_start).
import { h, clear, pad2, isTyping } from '../util.js';
import { net } from '../net.js';
import { has, entry, image, json } from '../game/assets.js';
import { teamName, teamPlayers } from '../names.js';
import { arrowNav } from '../pix.js';
import { toast } from '../ui.js';
import { ERR } from '../i18n.js';
import * as StoryCut from '../story_cut.js';
import * as Intro from './story_intro.js';
import * as Scene from './story_scene.js';
import { faceoffEnd, screenFade, FACEOFF_FADE_IN, WIN_FADE_OUT } from './story_match.js';
import { CONTINUE_TEXT, continueTo, winFadeBgmOff } from './story_after.js';
import { playEnding, ENDING_BGM_KEY } from './story_end.js';
import { available as lineupOk } from './lineup.js';
import { RULE_TIMES } from './rules.js';

const LAST_K = 14;
const FACE = 24;
const NARRATOR = '해설';
const TYPE_MS = 28; // 글자 표시 간격
// team_names.json 에 한글 이름이 없는 화자 → [팀 id, 선수 idx]. 근거 analysis/09_team_names.md(팀1 0=남타이거, 팀2 0=태백산·6=강민철, 팀3 0=민대풍 [추정])
// 와 team_names.json 원작 표기(팀4 0 みたか, 팀5 0 きたの, 팀6 0 ごしょ, 팀7 0 いしがき)
const ALIAS = { 남타이거: [1, 0], 태백산: [2, 0], 강민철: [2, 6], 민대풍: [3, 0], 미타카: [4, 0], 기타노: [5, 0], 고쇼: [6, 0], 이시가키: [7, 0] };
const FALLBACK_CH = (k) => ({ k, teamMine: k >= 7 ? 22 : 0, teamOpp: null, stage: 0, unlocked: k === 0, cleared: false });

/** 스토리 경기 제한 시간(규칙 창에서 마지막으로 고른 값, 기본 5분). 규칙은 체력제 고정이라 시간만 보낸다 */
const storyRules = () => { const t = Number(localStorage.getItem('dd.rules.story') ?? 5); return { time: RULE_TIMES.includes(t) ? t : 5 }; };

let dlgData = null;
function loadDialogue() {
  if (!has('data.campaign.dialogue')) return Promise.resolve(null);
  return (dlgData ??= json('data.campaign.dialogue').catch((e) => { console.warn('dialogue', e.message); return null; }));
}

function bgUrl(stage) {
  for (const k of ['bg.stage.' + pad2(stage ?? 0), 'bg.stage.00']) {
    if (has(k)) { try { return `url("/assets/${entry(k).path}")`; } catch { /* 다음 후보 */ } }
  }
  return 'none';
}

export function mount(root, app, data = {}) {
  const mode = data.mode ?? 'list';
  let cleanup = [], alive = true;
  const off = () => { for (const f of cleanup) f(); cleanup = []; };
  const chapterOf = (k) => app.campaign?.chapters?.find((c) => c.k === k) ?? FALLBACK_CH(k);

  // ---------------- 챕터 목록 ----------------
  function showList() {
    off();
    clear(root);
    document.body.dataset.story = 'list';
    // 이전 경기가 끝나 대기 중인 캠페인 방은 나간다(로비 기능·방 만들기와 충돌 방지). room_left 는 main 이 화면 전환 없이 처리
    if (app.room?.campaign && app.room.status === 'waiting') net.send('leave_room');
    const list = h('div.chapter-list', { role: 'list', 'aria-label': '챕터 목록' });
    const cont = h('button.btn.primary', { type: 'button', hidden: true }, '이어하기');
    const prologue = h('button.btn', { type: 'button', onclick: () => StoryCut.start({ ids: Intro.PROLOGUE_IDS, onEnd: () => cont.isConnected && cont.focus() }) }, '프롤로그');
    root.append(h('div.screen.story-list',
      h('header.pix-head', h('h1.pix-title', '스토리 모드'), cont, prologue, h('span.nick-me', app.nick || ''),
        h('button.btn', { type: 'button', onclick: () => app.go('lobby') }, '로비')),
      h('section.pwin.chapter-win', list)));
    cleanup.push(arrowNav(root, { onEsc: () => app.go('lobby') }));
    let titles = [];
    const subs = new Map();
    const paint = () => {
      const c = app.campaign;
      clear(list);
      if (!c) { list.append(h('div.empty', '불러오는 중…')); return; }
      const reached = Math.min(LAST_K, (c.progress?.clearedMax ?? -1) + 1);
      cont.hidden = false;
      cont.textContent = `이어하기 · 경기 ${reached + 1}`;
      cont.onclick = () => app.go('story', { mode: 'pre', k: reached });
      for (const ch of c.chapters) {
        const cur = ch.k === reached;
        const tm = titles.find((x) => x.k === ch.k);
        const opp = ch.teamOpp != null ? teamName(ch.teamOpp, tm?.opponentName ?? '') : '';
        // 부제 = 원작 제목 카드 부제(53 §4). 번역을 못 받으면 종전 자작 제목
        const sub = subs.get(ch.k) ?? tm?.title ?? '';
        // 잠긴 행도 방향키 포커스는 받는다(disabled 면 arrowNav 대상에서 빠져 격자 이동이 끊김). 선택만 막는다
        list.append(h('button.chapter-row' + (cur ? '.current' : '') + (ch.cleared ? '.cleared' : ''), {
          type: 'button', role: 'listitem', 'aria-disabled': ch.unlocked ? null : 'true', 'aria-current': cur ? 'step' : null,
          onclick: () => (ch.unlocked ? app.go('story', { mode: 'pre', k: ch.k }) : toast('잠겨 있어요', 'info', 1500)),
        },
          h('b.ch-no.tabular', pad2(ch.k + 1)),
          h('span.ch-main', h('span.ch-opp', opp || `경기 ${ch.k + 1}`), sub ? h('span.ch-title', sub) : null),
          h('span.ch-st' + (ch.cleared ? '.clr' : ch.unlocked ? (cur ? '.cur' : '') : '.lock'),
            ch.cleared ? '클리어' : ch.unlocked ? (cur ? '도전' : '열림') : '잠금')));
      }
    };
    paint();
    loadDialogue().then((d) => { titles = d?.matches ?? []; if (app.view === 'story' && list.isConnected) paint(); });
    Intro.loadKo().then((ko) => {
      for (const m of ko?.matches ?? []) if (m.title_ko?.subtitle) subs.set(m.k, m.title_ko.subtitle);
      if (app.view === 'story' && list.isConnected) paint();
    }).catch((e) => console.warn('story subtitles', e.message));
    net.send('campaign_list');
    setTimeout(() => (cont.hidden ? null : cont.focus()), 30);
    return { onCampaignList: paint, onWelcome: () => net.send('campaign_list') };
  }

  // ---------------- 대화 장면 ----------------
  /**
   * @param {{k:number, lines:{speaker:string,line:string}[], tag?:string, stage?:number}} o
   * @param {()=>void} onDone 마지막 대사 이후(또는 건너뛰기)
   */
  function scene(o, onDone) {
    off();
    clear(root);
    document.body.dataset.story = 'scene';
    const ch = chapterOf(o.k);
    const opp = ch.teamOpp != null ? teamName(ch.teamOpp, '') : '';
    const face = h('canvas.dlg-face', { width: FACE, height: FACE, hidden: true, 'aria-hidden': 'true' });
    const who = h('div.dlg-who');
    const text = h('div.dlg-text', { 'aria-live': 'polite' });
    const more = h('span.dlg-more', { 'aria-hidden': 'true' }); // 넘김 표시 = 공 커서(css)
    const skip = h('button.btn.small.dlg-skip', { type: 'button', onclick: (e) => { e.stopPropagation(); finish(); } }, '건너뛰기');
    const actions = h('div.dlg-actions', { hidden: true, onclick: (e) => e.stopPropagation() });
    const box = h('div.pwin.dlg-box', face, h('div.dlg-body', who, text, more), actions);
    // 장면 머리 = 검정 이름판(경기 번호 + 상대) + 승패 태그(검정 칸)
    const cap = h('div.scene-cap', h('span.rplate', h('i.scene-no', `경기 ${o.k + 1}`), opp || null), o.tag ? h('span.tag.scene-tag' + (o.tagCls ?? ''), o.tag) : null);
    const sc = h('div.story-scene', { style: { backgroundImage: bgUrl(o.stage ?? ch.stage) }, onclick: () => advance() }, cap, box, skip);
    root.append(sc);
    let faces = null;
    if (has('hud.faces')) image('hud.faces').then((img) => { faces = img; paintFace(); }).catch(() => {});

    const lines = (o.lines ?? []).filter((l) => l && typeof l.line === 'string');
    let i = -1, shown = 0, full = '', timer = 0, done = false;

    function faceOf(name) {
      if (!name || name === NARRATOR) return null;
      const order = [ch.teamMine, ch.teamOpp].filter((t) => t != null);
      for (const t of order) { const idx = teamPlayers(t).indexOf(name); if (idx >= 0) return [t, idx]; }
      if (ALIAS[name]) return ALIAS[name];
      for (let t = 0; t < 25; t++) { const idx = teamPlayers(t).indexOf(name); if (idx >= 0) return [t, idx]; }
      return null;
    }
    function paintFace() {
      const l = lines[i];
      const f = l ? faceOf(l.speaker) : null;
      const mine = f ? f[0] === ch.teamMine || (ch.teamMine === 22 && f[0] === 0) : true;
      box.classList.toggle('opp', !mine);
      box.classList.toggle('noface', !f || !faces); // 초상 없음(해설 등): 이름판을 창 왼쪽부터
      if (!f || !faces) { face.hidden = true; return; }
      const g = face.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, FACE, FACE);
      // 아틀라스 얼굴은 왼쪽을 본다(HUD 규약: 왼팀은 반전). 내 팀은 반전해 오른쪽(상대 쪽)을 보게
      if (mine) { g.save(); g.translate(FACE, 0); g.scale(-1, 1); }
      g.drawImage(faces, f[1] * FACE, f[0] * FACE, FACE, FACE, 0, 0, FACE, FACE);
      if (mine) g.restore();
      face.hidden = false;
    }
    function show(n) {
      i = n;
      const l = lines[i];
      who.textContent = l.speaker ?? '';
      who.classList.toggle('narrator', l.speaker === NARRATOR);
      full = l.line; shown = 0; text.textContent = '';
      more.hidden = true;
      paintFace();
      clearInterval(timer);
      timer = setInterval(() => {
        shown = Math.min(full.length, shown + 1);
        text.textContent = full.slice(0, shown);
        if (shown >= full.length) { clearInterval(timer); more.hidden = false; }
      }, TYPE_MS);
    }
    function advance() {
      if (done) return;
      if (i >= 0 && shown < full.length) { clearInterval(timer); shown = full.length; text.textContent = full; more.hidden = false; return; }
      if (i + 1 < lines.length) show(i + 1); else finish();
    }
    function finish() {
      if (done) return;
      done = true; clearInterval(timer);
      if (i >= 0) { text.textContent = full; }
      more.hidden = true; skip.hidden = true;
      onDone({ box, actions, who, text, face });
    }
    const onKey = (e) => {
      if (isTyping() || e.repeat) return;
      if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
      if (done) return;
      const act = e.code === 'KeyD' && !e.ctrlKey && !e.metaKey && !e.altKey; // 경기 점프 키(D)로도 넘김
      if (e.key === 'Enter' || e.key === ' ' || act) {
        if (e.target instanceof HTMLButtonElement && e.key !== 'Enter' && !act) return;
        e.preventDefault(); advance();
      }
    };
    addEventListener('keydown', onKey);
    cleanup.push(() => { removeEventListener('keydown', onKey); clearInterval(timer); });
    if (lines.length) show(0); else finish();
    sc.focus?.();
    return { sc };
  }

  /**
   * 원작 경기 전 대사 장면(story_intro.js): 코트 배경 + 왼쪽 통키·오른쪽 상대 40x40 초상 + 기존 초록 창.
   * 원작에 없는 장면 머리(경기 N·상대)는 두지 않는다(48 §7-1 ③ ⑤). 건너뛰기 버튼·Esc 는 기존 장면과 같다
   */
  /**
   * 원작 대사 장면(경기 전·맞대면·경기 후 공통, story_scene.js). 코트 배경(VSRAM −32 = 32px 내린 위치) + 왼쪽 통키·오른쪽 상대 40x40 초상
   * (+ 3전 팀 그림·15전 엄마 그림 칸) + 기존 초록 창. 반환 view.play(kind, segments, done, fadeIn) 로 같은 화면에서 다른 블록을 이어 찍는다
   */
  function introScene(k, kind, segments, onDone, { fadeIn = 0 } = {}) {
    off();
    clear(root);
    document.body.dataset.story = 'scene';
    const ch = chapterOf(k);
    const left = h('canvas.story-intro-face.l', { width: 40, height: 40, 'aria-hidden': 'true' });
    const right = h('canvas.story-intro-face.r', { width: 40, height: 40, 'aria-hidden': 'true' });
    const extra = h('canvas.story-intro-face.x', { width: 40, height: 40, hidden: true, 'aria-hidden': 'true' });
    const who = h('div.dlg-who');
    const text = h('div.dlg-text.story-intro-text', { 'aria-live': 'polite' });
    const more = h('span.dlg-more', { 'aria-hidden': 'true', hidden: true });
    const skip = h('button.btn.small.dlg-skip', { type: 'button', onclick: (e) => { e.stopPropagation(); v.run?.finish(); } }, '건너뛰기');
    const actions = h('div.dlg-actions', { hidden: true, onclick: (e) => e.stopPropagation() });
    const box = h('div.pwin.dlg-box.story-intro-box', left, h('div.dlg-body', who, text, more), extra, right, actions);
    const band = h('div.story-intro-band', { hidden: true, 'aria-hidden': 'true' });
    const fade = h('div.story-intro-fade', { hidden: true, 'aria-hidden': 'true' });
    const sc = h('div.story-scene.story-intro-scene', { style: { backgroundImage: bgUrl(ch.stage) }, onclick: () => v.run?.advance() }, band, box, skip, fade);
    root.append(sc);
    const v = { k, sc, box, actions, who, text, more, band, fade, skip, face: left, run: null };
    v.play = (kd, segs, done, fi = 0) => {
      v.run?.stop();
      skip.hidden = false;
      v.run = Scene.runScene({ k, kind: kd, segments: segs ?? [], left, right, extra, who, text, more, fadeEl: fade, fadeIn: fi, sfx: app.sfx,
        onDone: () => { skip.hidden = true; done(v); } });
    };
    const onKey = (e) => {
      if (isTyping() || e.repeat || !v.run || v.run.phase === 'done') return; // 대사가 끝난 뒤(선택 줄)는 버튼 기본 동작
      if (e.key === 'Escape') { e.preventDefault(); v.run.finish(); return; }
      if (Intro.isAdvanceKey(e)) { e.preventDefault(); v.run.advance(); }
    };
    addEventListener('keydown', onKey);
    cleanup.push(() => { removeEventListener('keydown', onKey); v.run?.stop(); v.stopFx?.(); });
    v.play(kind, segments, onDone, fadeIn);
    return v;
  }

  /** 맞대면 블록 끝(0x125D8): 0xE0 → 창·초상 끔 → 32f 코트 상승·검은 띠 열림 → 경기 시작 요청 */
  function faceoffOut(v, k, rules, setWaiting) {
    app.bgm(null);
    v.stopFx = faceoffEnd({ sc: v.sc, box: v.box, band: v.band, done: () => { setWaiting(v); net.send('campaign_start', { k, rules }); } });
  }

  /** 대화 상자 아래쪽 버튼 줄로 바꾼다 */
  function setActions(v, btns) {
    v.actions.replaceChildren(...btns);
    v.actions.hidden = false;
    // 가로 선택 줄: ←↑ = 앞, →↓ = 다음(끝에서 멈춤, 로비 메뉴와 같음), Enter·Space 실행(버튼 기본 동작). 포커스가 줄 밖이면 첫 항목으로
    if (!v.navOff) {
      const STEP = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
      const onNav = (e) => {
        const d = STEP[e.key];
        if (!d || e.altKey || e.ctrlKey || e.metaKey || e.isComposing || v.actions.hidden || !v.actions.isConnected) return;
        const items = [...v.actions.querySelectorAll('button:not(:disabled)')];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement);
        items[i < 0 ? 0 : Math.max(0, Math.min(items.length - 1, i + d))].focus();
      };
      addEventListener('keydown', onNav);
      v.navOff = () => removeEventListener('keydown', onNav);
      cleanup.push(v.navOff);
    }
    v.box.classList.add('has-actions');
    setTimeout(() => btns[0]?.focus(), 30);
  }
  const busy = (v, msg) => { v.actions.replaceChildren(h('span.muted', msg)); v.actions.hidden = false; v.box.classList.add('has-actions'); };
  /** 경기 시작 요청 뒤 응답 없음(START_WAIT_MS)·오류·끊김·재접속: 숨긴 창을 「경기 준비 중…」 + 챕터 목록으로 되살린다 */
  const START_WAIT_MS = 8000;
  const restoreWait = (v) => {
    v.box.hidden = false;
    v.who.textContent = ''; v.text.textContent = '경기 준비 중…';
    if (v.more) v.more.hidden = true;
    setActions(v, [h('button.ritem', { type: 'button', onclick: () => app.go('story', { mode: 'list' }) }, '챕터 목록')]);
  };
  const watchStart = (onStall) => { const t = setTimeout(onStall, START_WAIT_MS); cleanup.push(() => clearTimeout(t)); };

  // ---------------- 경기 전 ----------------
  // 대사 -> 규칙 창(경기 시간) -> 라인업 VS -> 경기 시작. launch = 규칙 창·라인업을 지나 돌아온 상태(대사 없이 바로 시작 요청)
  function showPre(k, launch = null) {
    let view = null, waiting = false;
    const toList = () => app.go('story', { mode: 'list' });
    const recover = () => { if (!waiting) return; waiting = false; if (view) restoreWait(view); };
    const setWaiting = (v) => { view = v; waiting = true; watchStart(() => { if (waiting) { toast(ERR.UNKNOWN, 'error'); recover(); } }); };
    const start = (rules) => app.go('story', { mode: 'launch', k, rules });
    const lineup = (rules) => {
      const ch = chapterOf(k);
      if (!lineupOk() || ch.teamOpp == null) return start(rules);
      app.go('lineup', { teams: [ch.teamMine, ch.teamOpp], labels: ['1P', 'COM'], silent: true, onExit: () => start(rules), onCancel: toList });
    };
    const toRules = () => app.go('rules', { rules: storyRules(), modes: false, silent: true, onCancel: toList,
      onDone: (r) => { localStorage.setItem('dd.rules.story', String(r.time)); lineup({ time: r.time }); } });
    // 종전 장면(자작 대사): 번역 대사를 못 받았을 때의 대체 + launch(규칙 창·라인업을 지나 돌아온 '경기 준비 중')
    const legacy = () => loadDialogue().then((d) => {
      if (app.view !== 'story' || !alive) return;
      const m = d?.matches?.find((x) => x.k === k);
      scene({ k, lines: launch ? [] : m?.pre ?? [] }, (v) => {
        view = v;
        if (!launch) { toRules(); return; }
        setWaiting(v);
        busy(v, '경기 준비 중…');
        net.send('campaign_start', { k, rules: launch });
      });
    });
    // launch = 라인업 뒤: 맞대면(서브 7, 8f 페이드 인) → 끝 전환 → 경기. 번역을 못 받으면 종전 '경기 준비 중'
    const faceoff = () => Intro.loadKo().then((ko) => {
      if (app.view !== 'story' || !alive) return;
      const m = ko?.matches?.find((x) => x.k === k);
      if (!m?.blocks?.faceoff) throw new Error('맞대면 대사 없음 k=' + k);
      introScene(k, 'faceoff', m.blocks.faceoff.segments, (v) => faceoffOut(v, k, launch, setWaiting), { fadeIn: FACEOFF_FADE_IN });
    }).catch((e) => { console.warn('story faceoff', e.message); legacy(); });
    // 챕터 시작 연출: 제목 카드(0x91 시작 지점) → 원작 경기 전 대사 → 규칙 창 → 라인업 → 맞대면 → 경기. afterPrologue = 진입 컷 바로 뒤(컷4 끝 검정 119f 가 카드 앞 검정)
    const begin = (afterPrologue = false) => {
      if (launch) return faceoff();
      Intro.loadKo().then((ko) => {
        if (app.view !== 'story' || !alive) return;
        const m = ko?.matches?.find((x) => x.k === k);
        if (!m?.title_ko || !m.blocks?.pre) throw new Error('번역 대사 없음 k=' + k);
        off(); clear(root);
        document.body.dataset.story = 'card';
        const card = Intro.playCard({ root, number: m.title_ko.number, subtitle: m.title_ko.subtitle, black: afterPrologue ? 0 : undefined,
          onStart: () => { if (Intro.SCENE_BGM_ON) app.bgm(Intro.SCENE_BGM_KEY); },
          onEnd: () => { if (app.view === 'story' && alive) introScene(k, 'pre', m.blocks.pre.segments, toRules); } });
        cleanup.push(() => card.stop());
      }).catch((e) => { console.warn('story intro', e.message); legacy(); });
    };
    // 처음 시작(경기 1)이고 컷을 본 적이 없으면 원작처럼 진입 컷부터(제목 카드는 빼고 챕터 연출에서). 컷은 건너뛸 수 있고 실패해도 바로 카드로
    if (!launch && k === 0 && !StoryCut.storyCutSeen() && !(app.campaign?.progress?.clearedMax >= 0)) StoryCut.start({ ids: Intro.PROLOGUE_IDS, onEnd: () => begin(true) });
    else begin();
    // CAMPAIGN_LOCKED 등(토스트는 main)·끊김·재접속(요청이 사라짐): 챕터 목록 버튼
    return { onError: recover, onNetClose: recover, onWelcome: recover };
  }

  // ---------------- 경기 후(원작 서브 9·10) ----------------
  // 승리: 원작 대사(3전·15전은 이어지는 팀 그림·엄마 장면까지) → 화면 페이드 아웃 약 32f(+0xE0, k=6 제외) → 다음 경기 제목 카드 / 15전 = 엔딩 그림.
  // 패배: 진입 즉시 곡 정지(0xE1) → 원작 대사 → 같은 화면에서 컨티뉴 창(예 = k<14 제목 카드부터 / 15전 맞대면만, 아니오 = 챕터 목록).
  // 0x98(승리 후 곡)은 쓰지 않는다(팀장 결정) → 승리 쪽은 결과 곡이 screenBgm 의 0xE0 로 페이드된 무음 그대로
  function showPost(r) {
    const k = r.k, win = !!r.win;
    if (!win) app.bgmStop(); // 0x12694 0xE1. mount 안(동기)이라 뒤의 screenBgm('story') 페이드 명령은 할 일이 없다
    let view = null, waiting = false;
    const toList = () => app.go('story', { mode: 'list' });
    const recover = () => { if (!waiting || !view) return; waiting = false; restoreWait(view); };
    const setWaiting = (v) => { view = v; waiting = true; watchStart(() => { if (waiting) { toast(ERR.UNKNOWN, 'error'); recover(); } }); };
    const afterWin = (v) => {
      if (winFadeBgmOff(k)) app.bgm(null);
      v.stopFx = screenFade(v.fade, 'out', WIN_FADE_OUT, () => {
        if (!alive || app.view !== 'story') return;
        if (r.final) showEnding2();
        else if (k < LAST_K) app.go('story', { mode: 'pre', k: k + 1 });
        else toList();
      });
    };
    const askContinue = (v, m) => {
      view = v;
      v.who.textContent = '';
      v.text.textContent = CONTINUE_TEXT.prompt;
      const yes = () => {
        if (continueTo(k) === 'card') { app.go('story', { mode: 'pre', k }); return; }
        // 15전: 설정·페이드 없이 같은 화면에서 맞대면 대사(0x12B42 → 0x1259E), 무음. 규칙 창은 거치지 않고 마지막 값
        v.actions.hidden = true; v.box.classList.remove('has-actions');
        document.activeElement?.blur?.(); // 숨긴 버튼에 포커스가 남지 않게(Enter 가 버튼을 다시 누르지 않도록)
        v.play('faceoff', m.blocks.faceoff?.segments, (vv) => faceoffOut(vv, k, storyRules(), setWaiting));
      };
      setActions(v, [h('button.ritem', { type: 'button', onclick: yes }, CONTINUE_TEXT.yes),
        h('button.ritem', { type: 'button', onclick: toList }, CONTINUE_TEXT.no)]);
    };
    Intro.loadKo().then((ko) => {
      if (app.view !== 'story' || !alive) return;
      const m = ko?.matches?.find((x) => x.k === k);
      const blk = m?.blocks?.[win ? 'win' : 'lose'];
      if (!blk) throw new Error('경기 후 대사 없음 k=' + k);
      introScene(k, win ? 'win' : 'lose', blk.segments, (v) => (win ? afterWin(v) : askContinue(v, m)));
    }).catch((e) => { console.warn('story post', e.message); legacyPost(); });
    return {
      onError() {
        if (legacyPostApi) { legacyPostApi.onError?.(); return; }
        recover();
      },
      onNetClose: () => (legacyPostApi ? legacyPostApi.onError?.() : recover()),
      onWelcome: () => (legacyPostApi ? legacyPostApi.onError?.() : recover()),
    };

    /** 종전 경기 후(자작 대사·버튼): 번역 대사를 못 받았을 때만 */
    function legacyPost() { legacyPostApi = showPostLegacy(r); }
  }
  let legacyPostApi = null;

  // ---------------- 엔딩 그림(서브 12) ----------------
  function showEnding2() {
    off();
    clear(root);
    document.body.dataset.story = 'ending';
    const e = playEnding({ root, onStart: () => app.bgm(ENDING_BGM_KEY), onEnd: () => { if (alive && app.view === 'story') app.go('story', { mode: 'list' }); } });
    cleanup.push(() => e.stop());
  }

  function showPostLegacy(r) {
    const k = r.k, win = !!r.win;
    let view = null, waiting = false;
    const toList = () => app.go('story', { mode: 'list' });
    const retry = () => {
      waiting = true; busy(view, '경기 준비 중…');
      if (app.room?.campaign?.k === k && app.room.status === 'waiting') net.send('start');
      else net.send('campaign_start', { k, rules: storyRules() });
    };
    const buttons = () => {
      if (win && !r.final && k < LAST_K) {
        return [h('button.ritem', { type: 'button', onclick: () => app.go('story', { mode: 'pre', k: k + 1 }) }, '다음 경기'),
          h('button.ritem', { type: 'button', onclick: toList }, '챕터 목록')];
      }
      if (win) return [h('button.ritem', { type: 'button', onclick: toList }, '챕터 목록')];
      return [h('button.ritem', { type: 'button', onclick: retry }, '재도전'),
        h('button.ritem', { type: 'button', onclick: toList }, '챕터 목록')];
    };
    loadDialogue().then((d) => {
      if (app.view !== 'story') return;
      const m = d?.matches?.find((x) => x.k === k);
      const tag = win ? '승리' : '패배';
      scene({ k, lines: (win ? m?.winPost : m?.losePost) ?? [], tag, tagCls: win ? '.win' : '' }, (v) => {
        view = v;
        if (win && r.final) return showEnding(d?.ending ?? []);
        setActions(v, buttons());
      });
    });
    return {
      onError() {
        if (!waiting || !view) return;
        waiting = false; setActions(view, buttons());
      },
    };
  }

  // ---------------- 엔딩 ----------------
  function showEnding(lines) {
    scene({ k: LAST_K, lines, stage: chapterOf(LAST_K).stage }, () => {
      off();
      clear(root);
      document.body.dataset.story = 'ending';
      const btn = h('button.btn.primary.big', { type: 'button', onclick: () => app.go('story', { mode: 'list' }) }, '챕터 목록');
      root.append(h('div.story-scene.ending', { style: { backgroundImage: bgUrl(chapterOf(LAST_K).stage) } },
        h('div.ending-card', h('div.ending-title', 'THE END'), btn)));
      setTimeout(() => btn.focus(), 30);
    });
  }

  let api;
  if ((mode === 'pre' || mode === 'launch') && Number.isInteger(data.k)) api = showPre(data.k, mode === 'launch' ? data.rules ?? storyRules() : null);
  else if (mode === 'post' && data.result) api = showPost(data.result);
  else api = showList();
  return {
    ...api,
    unmount() { alive = false; off(); delete document.body.dataset.story; },
  };
}
