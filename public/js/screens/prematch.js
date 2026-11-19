// 경기 전 화면: 편성(능력치 보기). 원작 서브 3(1P)/서브 4(COM) 화면의 보기 전용 판 (analysis/20_prematch_screens.md §3.4).
// 위: 팀 패널(라벨+엠블럼+팀 이름+약칭) / 선수 패널(얼굴+이름+능력치 6줄) / EXIT, 아래: 코트 모형 위 선수 얼굴 7개.
// 커서를 얼굴에 맞추면 그 선수의 능력치가 보인다. 교대(포지션 변경)는 서버가 선수 순서를 받지 않아 아직 없다.
// 논리 해상도 398x224, 원작 320x224 를 가운데(+39)에 놓고 양옆은 배경을 거울로 이어 붙인다(경기 화면과 같은 방식).
// 사용: app.go('prematch', { team, label: 'COM'|'1P'|'2P', onExit, roster?, stats? })  (onExit 생략 시 대기실/로비로)
// roster = 혼합 로스터(불꽃의 계승) 7명의 출신 [{team, idx}]: 얼굴·이름을 출신으로 그린다. stats = 선수별 능력치 6종 [[체력, 방어, 스피드, 점프, 슛, 캐치] x7](서버가 계산한 최종값). 없으면 종전대로 팀 원본
//   칸에 name(문자열)·face(24x24 그림, hud.faces 와 같은 방향)가 있으면 그것을 먼저 쓴다(오리지널 선수). head = {name, abbr, emblem?(24x16 그림)}: 팀 패널을 팀 id 대신 이것으로(오리지널 팀)
import { h, fitScale, isTyping } from '../util.js';
import { has, image, json } from '../game/assets.js';
import { teamName, teamPlayers } from '../names.js';
import { emblemOf, abbrOf } from '../pix.js';
import { pixText, clearPixText } from '../pixtext.js';

const W = 398, H = 224, OX = 39;
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

/** 능력치 → 막대 칸 수(원작 루틴 0xEC2E: 큰 칸 = 2칸, 나머지 >= d/2 면 작은 칸 1) */
export const barBlocks = (v, d) => 2 * Math.floor(v / d) + (v % d >= d >> 1 ? 1 : 0);
/** 선수 창 안쪽 오른쪽 끝(원작 320 좌표, fm_bg 의 창 테두리가 x=213 에서 시작). 막대는 여기까지만 그린다: 원작 팀은 최대 16칸이라 닿지 않고, 불꽃의 계승처럼 능력치가 커진 선수만 잘린다 */
const BAR_RIGHT = 213;

export function mount(root, app, data = {}) {
  const team = Number.isInteger(data.team) ? data.team : 1;
  const label = data.label || 'COM';
  const mirror = label === '1P'; // 1P 화면은 코트·얼굴 x 를 반전(296-x). 2P 는 COM 과 같은 쪽 [추정]
  const cancel = () => (data.onCancel || exit)();
  const roster = Array.isArray(data.roster) && data.roster.length === 7 && data.roster.every((o) => Number.isInteger(o?.team) && Number.isInteger(o?.idx)) ? data.roster : null;
  const origin = (i) => (roster ? [roster[i].team, roster[i].idx] : [team, i]);
  const statsOf = (i) => (Array.isArray(data.stats?.[i]) ? data.stats[i] : D.teams[String(origin(i)[0])]?.[origin(i)[1]]);
  const nameOf = (i) => { if (typeof roster?.[i]?.name === 'string' && roster[i].name) return roster[i].name; const [t, k] = origin(i); const nm = teamPlayers(t)[k]; return nm && /[가-힣]/.test(nm) ? nm : `${k + 1}번`; };
  const head = typeof data.head?.name === 'string' && data.head.name ? data.head : null;
  const exit = data.onExit || (() => app.go(app.room ? 'room' : 'lobby'));
  const canvas = h('canvas', { width: W, height: H, 'aria-label': '편성 화면',
    style: { display: 'block', imageRendering: 'pixelated', background: '#000' } });
  const live = h('div', { role: 'status', 'aria-live': 'polite',
    style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' } });
  const wrap = h('div.screen.prematch', { style: { alignItems: 'center', justifyContent: 'center', padding: '0', background: '#000', position: 'relative' } }, canvas, live);
  root.append(wrap);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;

  let D = null, imgs = null, sel = 'exit', tick = 0, alive = true, timer = null;

  function fit() {
    const s = fitScale(innerWidth, innerHeight, W, H);
    canvas.style.width = s.cw + 'px'; canvas.style.height = s.ch + 'px';
  }
  fit();
  addEventListener('resize', fit);

  const text = pixText; // 도트 글자(Galmuri 8px/12px), 편성·라인업 공용
  /** 글자 그리기. (x, y) = 글자 상단(원작 320 좌표). align 'c' 면 x 가 가운데 */
  function put(str, x, y, px, fill, maxW, align) {
    const c = text(str, px, fill, maxW);
    const dx = align === 'c' ? Math.round(c.width / 2) : 0;
    g.drawImage(c, OX + x - dx, y - 1);
  }
  /** 원작 8x8 영문 글리프 */
  function glyphs(str, x, y) {
    const s = String(str).toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const n = s.charCodeAt(i) - 32;
      if (n >= 0 && n < 64) g.drawImage(imgs.font, n * 8, 0, 8, 8, OX + x + i * 8, y, 8, 8);
    }
  }

  /** 얼굴 24x24. hud.faces 아틀라스는 좌우반전 그림이라 다시 뒤집어 원작 방향으로 그린다 */
  function face(i, x, y) {
    g.save(); g.translate(OX + x + 24, y); g.scale(-1, 1);
    const [ot, oi] = origin(i), own = roster?.[i]?.face ?? null;
    if (own) g.drawImage(own, 0, 0, 24, 24, 0, 0, 24, 24); else g.drawImage(imgs.faces, oi * 24, ot * 24, 24, 24, 0, 0, 24, 24);
    g.restore();
  }
  const facePos = () => D.faces[mirror ? 'p1' : 'com'];
  /** 커서 대상 중심(원작 좌표): 얼굴 7 + EXIT */
  const centers = () => [...facePos().map(([x, y]) => [x + 12, y + 12]), [268, 83]];
  const keyOf = (i) => (i === 7 ? 'exit' : i);
  const idxOf = (k) => (k === 'exit' ? 7 : k);

  function draw() {
    if (!imgs || !D) return;
    const P = D.panel;
    g.clearRect(0, 0, W, H);
    // 배경: 가운데 원작 화면 + 양옆 거울
    g.drawImage(imgs.bg, OX, 0);
    // 양옆: 창이 없는 가장자리 24px 를 거울로 왕복 반복(창 조각이 보이지 않게)
    for (let i = 0; i < OX; i++) {
      const k = i % 48, sx = k < 24 ? k : 47 - k; // 왼쪽: 화면 끝(0)에서 바깥쪽으로 갈수록 원본 0..23 을 왕복
      g.drawImage(imgs.bg, sx, 0, 1, H, OX - 1 - i, 0, 1, H);
      g.drawImage(imgs.bg, 319 - sx, 0, 1, H, OX + 320 + i, 0, 1, H);
    }
    // 팀 패널
    glyphs(label, P.label[0], P.label[1]);
    if (head?.emblem) g.drawImage(head.emblem, 0, 0, 24, 16, OX + P.emblem[0], P.emblem[1], 24, 16); else g.drawImage(imgs.emb, emblemOf(team) * 24, 0, 24, 16, OX + P.emblem[0], P.emblem[1], 24, 16);
    put(head ? head.name : teamName(team, `팀 ${team + 1}`), P.teamName[0], P.teamName[1], 8, '#fcfcfc', 68);
    const ab = head ? String(head.abbr ?? '') : abbrOf(team);
    if (/^[\x20-\x5f]*$/.test(ab.toUpperCase())) glyphs(ab, P.abbr[0], P.abbr[1]); else put(ab, P.abbr[0], P.abbr[1], 8, '#fcfcfc', 68); // 원작 8x8 글리프는 영문·숫자뿐: 한글 약칭은 도트 글자로
    // 능력치 라벨 + 점선(원작: 라벨 끝부터 4px 간격 2px 점)
    const B = D.bar;
    D.ko.stats.forEach((lb, k) => {
      const y = P.statLabel[1] + k * B.pitch;
      put(lb, P.statLabel[0], y, 8, '#fcfcfc', 40);
      const t = text(lb, 8, '#fcfcfc', 40);
      for (let x = P.statLabel[0] + Math.min(40, t.width - 1) + 3; x < P.dotsEnd; x += 4) { g.fillStyle = '#fcfcfc'; g.fillRect(OX + x, y + 3, 2, 1); }
    });
    // 안내문
    const who = label === '1P' ? '1P' : label;
    put(D.ko.tipCom.replace('{who}', who), P.tip.cx, P.tip.y + 3, 8, P.tip.color, 236, 'c');
    // EXIT 글자
    g.drawImage(imgs.exit, OX + P.exit[0], P.exit[1]);
    // 얼굴 7
    const fp = facePos();
    fp.forEach(([x, y], i) => face(i, x, y));
    // 선수 패널(커서가 얼굴 위일 때)
    if (typeof sel === 'number') {
      const st = statsOf(sel);
      face(sel, D.faces.hover[0], D.faces.hover[1]);
      put(nameOf(sel), P.playerName[0], P.playerName[1], 8, '#fcfcfc', 66);
      if (st) st.forEach((v, k) => {
        const full = barBlocks(v, B.divisors[k]), cap = Math.floor((BAR_RIGHT - B.x) / B.blockW), n = Math.min(full, cap);
        for (let b = 0; b < n; b++) g.drawImage(imgs.bar, OX + B.x + b * B.blockW, B.y0 + k * B.pitch);
        if (full > cap) { // 칸을 넘는 값: 막대는 창 폭까지, 값은 막대 오른쪽 끝에 숫자로
          const t = text(String(v), 8, '#fcfc00'), x = BAR_RIGHT - t.width - 1;
          g.fillStyle = '#002400'; g.fillRect(OX + x - 1, B.y0 + k * B.pitch, BAR_RIGHT - x + 1, B.pitch);
          g.drawImage(t, OX + x, B.y0 + k * B.pitch - 1);
        }
      });
    }
    // 커서: 얼굴 = 40x40 plain 프레임(select.cursor 7행 = plain_move), EXIT = 팔각 프레임
    const col = Math.floor(tick / 6) % 7;
    if (typeof sel === 'number') {
      const [x, y] = fp[sel];
      g.drawImage(imgs.cursor, col * 40, 6 * 40, 40, 40, OX + x - 8, y - 8, 40, 40);
    } else {
      const [fx, fy, fw, fh] = P.exitFrame, c = 6;
      const glow = ['#fcfcfc', '#fcfcfc', '#00fcfc', '#48b4fc', '#0024b4', '#00006c', '#000000'];
      const cols = [glow[(col + 2) % 7], glow[(col + 3) % 7]];
      octagon(OX + fx, fy, fw, fh, c, cols[0], cols[1]);
    }
  }
  /** 팔각 테두리(2px, 바깥/안쪽 색) */
  function octagon(x, y, w, hh, c, outer, inner) {
    const ring = (inset, color) => {
      g.fillStyle = color;
      const L = x + inset, T = y + inset, R = x + w - inset, Bm = y + hh - inset, k = c - inset;
      g.fillRect(L + k, T, R - L - 2 * k, 1); g.fillRect(L + k, Bm - 1, R - L - 2 * k, 1);
      g.fillRect(L, T + k, 1, Bm - T - 2 * k); g.fillRect(R - 1, T + k, 1, Bm - T - 2 * k);
      for (let i = 0; i < k; i++) {
        g.fillRect(L + k - 1 - i, T + i, 1, 1); g.fillRect(R - k + i, T + i, 1, 1);
        g.fillRect(L + k - 1 - i, Bm - 1 - i, 1, 1); g.fillRect(R - k + i, Bm - 1 - i, 1, 1);
      }
    };
    ring(0, outer); ring(1, inner);
  }

  function announce() {
    if (typeof sel !== 'number') { live.textContent = 'EXIT'; return; }
    const st = statsOf(sel);
    live.textContent = `${nameOf(sel)}: ` + (st ? st.map((v, k) => `${D.ko.stats[k]} ${barBlocks(v, D.bar.divisors[k])}`).join(', ') : '');
  }
  function select(k, sound = true) {
    if (k === sel) return;
    sel = k; if (sound) app.sfx?.('sfx.ui.cursor');
    announce(); draw();
  }
  function move(dir) {
    const cs = centers(), cur = cs[idxOf(sel)];
    let best = -1, bs = Infinity;
    cs.forEach((c, i) => {
      if (i === idxOf(sel)) return;
      const dx = c[0] - cur[0], dy = c[1] - cur[1];
      const along = dx * dir[0] + dy * dir[1], cross = Math.abs(dx * dir[1] - dy * dir[0]);
      if (along <= 0) return;
      const sc = along + cross * 1.5;
      if (sc < bs) { bs = sc; best = i; }
    });
    if (best >= 0) select(keyOf(best));
  }
  function onKey(e) {
    if (!alive || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.body.dataset.intro) return;
    const d = DIRS[e.key];
    if (d) { e.preventDefault(); if (!e.repeat) move(d); return; } // 원작: 자동 반복 없음
    if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); if (alive) { app.sfx?.('sfx.ui.confirm'); cancel(); } return; }
    if ((e.key === 'Enter' || e.key === ' ') && sel === 'exit') { e.preventDefault(); leave(); }
  }
  function leave() { if (!alive) return; app.sfx?.('sfx.ui.confirm'); exit(); }
  function hit(ev) {
    const r = canvas.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W - OX, y = ((ev.clientY - r.top) / r.height) * H;
    const cs = centers();
    for (let i = 0; i < 8; i++) {
      const c = cs[i], hw = i === 7 ? 19 : 16, hh = i === 7 ? 19 : 16;
      if (Math.abs(x - c[0]) <= hw && Math.abs(y - c[1]) <= hh) return i;
    }
    return -1;
  }
  canvas.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') { const i = hit(ev); if (i >= 0) select(keyOf(i), false); } });
  canvas.addEventListener('pointerdown', (ev) => {
    const i = hit(ev);
    if (i < 0) return;
    if (i === 7) { if (sel === 'exit' || ev.pointerType === 'mouse') leave(); else select('exit'); } else select(keyOf(i));
  });
  addEventListener('keydown', onKey);

  Promise.all([
    json('data.prematch'), image('prematch.fm.bg'), image('prematch.fm.bar'), image('prematch.fm.exit'),
    image('select.cursor'), image('select.emblems'), image('select.font.white'), image('hud.faces'),
  ]).then(([d, bg, bar, ex, cursor, emb, font, faces]) => {
    if (!alive) return;
    D = d; imgs = { bg, bar, exit: ex, cursor, emb, font, faces };
    // 글꼴이 늦게 오면 도트 글자 캐시가 폴백 글꼴로 굳으므로 준비 후 비운다
    document.fonts?.ready?.then(() => { clearPixText(); draw(); });
    announce(); draw();
    timer = setInterval(() => { tick++; if (tick % 6 === 0) draw(); }, 1000 / 60);
  }).catch((e) => { console.warn('prematch', e); exit(); });

  return { flame: !!roster, onError() { cancel(); }, unmount() { alive = false; clearInterval(timer); removeEventListener('keydown', onKey); removeEventListener('resize', fit); } };
}

/** 에셋이 모두 있을 때만 쓸 수 있음(없으면 호출 측이 건너뜀) */
export const available = () => has('data.prematch') && has('prematch.fm.bg');
