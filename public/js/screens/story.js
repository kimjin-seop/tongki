// 스토리(싱글 캠페인) 화면 (PROTOCOL §8): 챕터 목록 / 경기 전 대화 / 경기 후 대화 / 엔딩.
// 경기 자체는 game 화면. 캠페인 방은 대기실을 거치지 않는다(campaign_start → room_joined → room_state → game_start).
import { h, clear, pad2, isTyping } from '../util.js';
import { net } from '../net.js';
import { has, entry, image, json } from '../game/assets.js';
import { teamName, teamPlayers } from '../names.js';
import { arrowNav } from '../pix.js';
import * as StoryCut from '../story_cut.js';
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
  let cleanup = [];
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
    const prologue = h('button.btn', { type: 'button', onclick: () => StoryCut.start({ onEnd: () => cont.isConnected && cont.focus() }) }, '프롤로그');
    root.append(h('div.screen.story-list',
      h('header.pix-head', h('h1.pix-title', '스토리 모드'), cont, prologue, h('span.nick-me', app.nick || ''),
        h('button.btn', { type: 'button', onclick: () => app.go('lobby') }, '로비')),
      h('section.pwin.chapter-win', list)));
    cleanup.push(arrowNav(root, { onEsc: () => app.go('lobby') }));
    let titles = [];
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
        list.append(h('button.chapter-row' + (cur ? '.current' : '') + (ch.cleared ? '.cleared' : ''), {
          type: 'button', role: 'listitem', disabled: !ch.unlocked, 'aria-current': cur ? 'step' : null,
          onclick: () => app.go('story', { mode: 'pre', k: ch.k }),
        },
          h('b.ch-no.tabular', pad2(ch.k + 1)),
          h('span.ch-main', h('span.ch-opp', opp || `경기 ${ch.k + 1}`), tm?.title ? h('span.ch-title', tm.title) : null),
          h('span.ch-st' + (ch.cleared ? '.clr' : ch.unlocked ? (cur ? '.cur' : '') : '.lock'),
            ch.cleared ? '클리어' : ch.unlocked ? (cur ? '도전' : '열림') : '잠금')));
      }
    };
    paint();
    loadDialogue().then((d) => { titles = d?.matches ?? []; if (app.view === 'story' && list.isConnected) paint(); });
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
    const more = h('span.dlg-more', { 'aria-hidden': 'true' }, '▼');
    const skip = h('button.btn.small.dlg-skip', { type: 'button', onclick: (e) => { e.stopPropagation(); finish(); } }, '건너뛰기');
    const actions = h('div.dlg-actions', { hidden: true });
    const box = h('div.pwin.dlg-box', face, h('div.dlg-body', who, text, more), skip, actions);
    const cap = h('div.scene-cap', h('span.scene-no', `경기 ${o.k + 1}`), opp ? h('span', opp) : null, o.tag ? h('span.scene-tag' + (o.tagCls ?? ''), o.tag) : null);
    const sc = h('div.story-scene', { style: { backgroundImage: bgUrl(o.stage ?? ch.stage) }, onclick: () => advance() }, cap, box);
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

  /** 대화 상자 아래쪽 버튼 줄로 바꾼다 */
  function setActions(v, btns) {
    v.actions.replaceChildren(...btns);
    v.actions.hidden = false;
    v.box.classList.add('has-actions');
    setTimeout(() => btns[0]?.focus(), 30);
  }
  const busy = (v, msg) => { v.actions.replaceChildren(h('span.muted', msg)); v.actions.hidden = false; v.box.classList.add('has-actions'); };

  // ---------------- 경기 전 ----------------
  // 대사 -> 규칙 창(경기 시간) -> 라인업 VS -> 경기 시작. launch = 규칙 창·라인업을 지나 돌아온 상태(대사 없이 바로 시작 요청)
  function showPre(k, launch = null) {
    let view = null, waiting = false;
    const toList = () => app.go('story', { mode: 'list' });
    const start = (rules) => app.go('story', { mode: 'launch', k, rules });
    const lineup = (rules) => {
      const ch = chapterOf(k);
      if (!lineupOk() || ch.teamOpp == null) return start(rules);
      app.go('lineup', { teams: [ch.teamMine, ch.teamOpp], labels: ['1P', 'COM'], silent: true, onExit: () => start(rules), onCancel: toList });
    };
    const begin = () => loadDialogue().then((d) => {
      if (app.view !== 'story') return;
      const m = d?.matches?.find((x) => x.k === k);
      scene({ k, lines: launch ? [] : m?.pre ?? [] }, (v) => {
        view = v;
        if (!launch) {
          app.go('rules', { rules: storyRules(), modes: false, silent: true, onCancel: toList,
            onDone: (r) => { localStorage.setItem('dd.rules.story', String(r.time)); lineup({ time: r.time }); } });
          return;
        }
        waiting = true;
        busy(v, '경기 준비 중…');
        net.send('campaign_start', { k, rules: launch });
      });
    });
    // 처음 시작(경기 1)이고 컷을 본 적이 없으면 원작처럼 진입 컷부터. 컷은 건너뛸 수 있고 실패해도 바로 대화로
    if (!launch && k === 0 && !StoryCut.storyCutSeen() && !(app.campaign?.progress?.clearedMax >= 0)) StoryCut.start({ onEnd: begin });
    else begin();
    return {
      onError() { // CAMPAIGN_LOCKED 등(토스트는 main). 목록으로
        if (!waiting) return;
        waiting = false;
        if (view) setActions(view, [h('button.btn.primary.center', { type: 'button', onclick: () => app.go('story', { mode: 'list' }) }, '챕터 목록')]);
      },
    };
  }

  // ---------------- 경기 후 ----------------
  function showPost(r) {
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
        return [h('button.btn.primary.center', { type: 'button', onclick: () => app.go('story', { mode: 'pre', k: k + 1 }) }, '다음 경기'),
          h('button.btn.center', { type: 'button', onclick: toList }, '챕터 목록')];
      }
      if (win) return [h('button.btn.primary.center', { type: 'button', onclick: toList }, '챕터 목록')];
      return [h('button.btn.primary.center', { type: 'button', onclick: retry }, '재도전'),
        h('button.btn.center', { type: 'button', onclick: toList }, '챕터 목록')];
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
    unmount() { off(); delete document.body.dataset.story; },
  };
}
