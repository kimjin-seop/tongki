// 부팅 인트로(오프닝 데모 11장면) + 타이틀 로고 헤더.
// 사양: analysis/10_intro_title.md §2·§3·§7. 60fps 틱(f = 원본 부팅 프레임).
// 화면: 398x224(16:9) 논리 해상도를 창에 꽉 차게 확대. 원작 320 장면은 가운데(+DW)에 두고, 배경색·띠·와이프·페이드는 좌우 끝까지 연장,
// 일러스트·스프라이트는 원작처럼 가운데 320 영역 밖에서는 보이지 않게 자른다(화면 밖 대기 위치가 드러나지 않게).
// 데이터는 intro.data.play(tools/build-intro.mjs 축약본), 그림은 intro.* 키로만 참조(로고 교체 가능).
// 같은 탭 두 번째부터는 생략(sessionStorage). 키/클릭/터치로 건너뛰면 로고가 올라간 최종 위치로 즉시 이동한 뒤
// 로고가 로비/닉네임 화면 상단 로고 자리로 옮겨 가고 아래 UI 가 나타난다.
import { h, $, fitScale } from './util.js';
import { has, entry, image, json } from './game/assets.js';

const W = 398, H = 224, BW = 320, DW = (W - BW) / 2, TICK = 1000 / 60;
const SEEN_KEY = 'dd.introSeen';
const IMG = {
  flames: 'intro.logo.flames', main: 'intro.logo.main', sub: 'intro.logo.sub', flash: 'intro.logo.flash',
  fireball: 'intro.spr.fireball', flame: 'intro.spr.flame_burst', ball: 'intro.spr.ball', streaks: 'intro.spr.streaks',
  bandFire: 'intro.bg.band_fire', bandCyan: 'intro.bg.band_cyan',
  team: 'intro.art.team', rivals: 'intro.art.rivals', throw: 'intro.art.throw',
};
// 효과음·BGM: 에셋 없음 - 키만(§4 큐 등록 시점). manifest 에 키가 생기고 app.sfx 가 있으면 재생
const CUES = [[342, 'sfx.intro.fireball'], [378, 'sfx.intro.impact'], [431, 'sfx.intro.flame'], [510, 'sfx.intro.sublogo'],
  [574, 'sfx.intro.wipe'], [642, 'bgm.title'], [742, 'sfx.intro.flash']];

function seen() { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } }
function markSeen() { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* 저장 불가 환경: 매번 재생 */ } }

/** 로고 화면 좌표: [최종 타이틀, 인트로]. manifest intro.logo.title.screen / screen_intro */
function logoPos() {
  const e = has('intro.logo.title') ? entry('intro.logo.title') : {};
  return { fin: e.screen ?? [34, 4], intro: e.screen_intro ?? [34, 36], size: e.size ?? [254, 124] };
}

/** 로비·닉네임 화면 상단 로고(intro.logo.title). 키가 없으면 null */
export function titleLogo(tag = 'div') {
  if (!has('intro.logo.title')) return null;
  const e = entry('intro.logo.title');
  const [w, hh] = e.size ?? [254, 124];
  return h(tag + '.title-logo', h('img', { src: '/assets/' + e.path, alt: '피구왕 통키', width: w, height: hh, draggable: false }));
}

export const shouldPlay = () => has('intro.data.play') && has('intro.logo.title') && !seen();

/** [[f, v], ...] 변화 시점 목록에서 f 의 값 */
function at(list, f, dflt = null) {
  let lo = 0, hi = list.length - 1, v = dflt;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= f) { v = list[m][1]; lo = m + 1; } else hi = m - 1; }
  return v;
}

/**
 * 인트로 시작. 오버레이를 즉시 덮고(#app inert) 에셋을 받는 대로 재생한다.
 * @param {{app:object, onEnd?:()=>void}} o
 */
export function start({ app, onEnd }) {
  markSeen();
  const appRoot = $('#app');
  const canvas = h('canvas.intro-canvas', { width: W, height: H, 'aria-hidden': 'true' });
  const coarse = matchMedia?.('(pointer: coarse)').matches;
  const hint = h('div.intro-hint', coarse ? '화면을 누르면 건너뜁니다' : '아무 키나 누르면 건너뜁니다');
  const overlay = h('div#intro', { role: 'presentation' }, canvas, hint);
  document.body.append(overlay);
  document.body.dataset.intro = 'play';
  appRoot.inert = true;
  const g = canvas.getContext('2d');
  const scratch = document.createElement('canvas');
  const sg = scratch.getContext('2d');
  const pos = logoPos();
  let D = null, img = {}, f = 0, acc = 0, last = 0, raf = 0, paused = false;
  let state = 'load'; // load → play → leave → done
  let skipWanted = false, leaveTimer = 0;

  function fit() {
    const s = fitScale(innerWidth, innerHeight, W, H);
    canvas.style.width = s.cw + 'px'; canvas.style.height = s.ch + 'px';
  }
  fit(); addEventListener('resize', fit);

  // ---------- 그리기 ----------
  const cell = (im, rect, x, y) => g.drawImage(im, rect[0], rect[1], rect[2], rect[3], x, y, rect[2], rect[3]);
  function tinted(im, color, k) { // 그림 모양대로 color 를 k 만큼 덮은 사본(실루엣·흰색화 근사)
    scratch.width = im.width; scratch.height = im.height;
    sg.globalCompositeOperation = 'source-over'; sg.globalAlpha = 1;
    sg.clearRect(0, 0, im.width, im.height); sg.drawImage(im, 0, 0);
    if (k > 0) { sg.globalCompositeOperation = 'source-atop'; sg.globalAlpha = Math.min(1, k); sg.fillStyle = color; sg.fillRect(0, 0, im.width, im.height); }
    sg.globalCompositeOperation = 'source-over'; sg.globalAlpha = 1;
    return scratch;
  }
  function band(im, B, fr) { // 라인별 가로 스크롤(512px 반복). 화면 x = 띠그림 x + h(y). 와이드 좌우 끝까지 반복
    const iw = im.width;
    for (let i = 0; i < B.lines.length; i++) {
      const [x0, vx] = B.lines[i];
      let sx = ((-Math.round(x0 + vx * (fr - B.f0)) - DW) % iw + iw) % iw, dx = -DW;
      while (dx < BW + DW) { const w = Math.min(iw - sx, BW + DW - dx); g.drawImage(im, sx, i, w, 1, dx, B.y0 + i, w, 1); dx += w; sx = 0; }
    }
  }
  /** 원작 320 화면 밖으로 나간 스프라이트는 자른다 */
  function clipped(fn) { g.save(); g.beginPath(); g.rect(0, 0, BW, H); g.clip(); fn(); g.restore(); }
  /** 왼쪽 밖에서 들어오는 일러스트: 원작 x(-w~0)를 와이드 왼쪽 끝 밖(-w-DW~0)으로 늘려, 대기 중엔 숨고 화면 끝에서 들어오게 한다 */
  const artX = (x, w) => (x < 0 ? Math.round(x * (w + DW) / w) : x);
  function streaks(T, fr) {
    const list = T.data[fr - T.f0];
    if (list) for (const [c, x, y] of list) cell(img.streaks, D.streaks.cells[c], x, y);
  }
  function flameCell(t) {
    for (const [c, n] of D.flame.runs) { if (t < n) return c; t -= n; }
    return D.flame.runs[D.flame.runs.length - 1][0];
  }
  function logo(fr, withLogo) {
    if (!withLogo) return;
    const rise = fr >= D.logoRise[0] ? Math.min(pos.intro[1] - pos.fin[1], (fr - D.logoRise[0] + 1) * D.logoRise[1]) : 0;
    const x = pos.intro[0], y = pos.intro[1] - rise;
    g.drawImage(img.flames, x, y); g.drawImage(img.main, x, y); g.drawImage(img.sub, x, y);
    const fl = fr <= 961 ? at(D.flash, fr, 0) : 0;
    if (fl > 0) { g.globalAlpha = fl; g.drawImage(img.flash, x, y); g.globalAlpha = 1; }
  }

  function draw(fr, withLogo = true) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = at(D.bg, fr, '#000000'); g.fillRect(0, 0, W, H);
    g.translate(DW, 0); // 이후 좌표는 원작 320 화면 기준
    if (fr <= 384) { // 1 불덩이
      const d = D.fireball.data[fr - D.fireball.f0];
      if (d) clipped(() => cell(img.fireball, D.fireball.cells[d[0]], d[1], d[2]));
    }
    if (fr >= D.flame.f0 && fr < 612) { // 2 불꽃 폭발(로고가 드러나면 로고 불꽃 레이어가 이어받음)
      clipped(() => cell(img.flame, D.flame.cells[flameCell(fr - D.flame.f0)], D.flame.screen[0], D.flame.screen[1]));
    }
    if (fr >= 511 && fr < 612) { // 3 소로고 등장(흰색 → 원색 3단계)
      g.drawImage(tinted(img.sub, '#fcfcfc', at(D.subWhite, fr, 0)), pos.intro[0], pos.intro[1]);
    }
    if ((fr >= 612 && fr <= 961) || fr >= 2445) logo(fr, withLogo); // 5 로고 / 9~10 타이틀
    if (fr >= D.wipe.f0 && fr <= 650) { // 4 와이프
      const spans = D.wipe.data[fr - D.wipe.f0];
      // 화면 끝에 닿는 띠는 와이드 끝까지 연장
      if (spans) for (const [y, hh, x0, x1, k] of spans) { const a = x0 <= 0 ? -DW : x0, b = x1 >= BW ? BW + DW : x1; g.fillStyle = D.wipe.pal[k]; g.fillRect(a, y, b - a, hh); }
    }
    if (fr >= 1025 && fr <= 1410) { // 6 불꽃 띠 + 팀 일러스트
      if (fr >= 1028) band(img.bandFire, D.bandFire, fr);
      if (fr >= 1026) g.drawImage(img.team, artX(at(D.ah, fr, 0), img.team.width), 64);
      clipped(() => streaks(D.streaks.fire, fr));
    }
    if (fr >= 1411 && fr <= 2204) { // 7 라이벌 3인(단색 띠 + 실루엣 → 원색)
      g.fillStyle = at(D.band, fr, '#000000'); g.fillRect(-DW, 64, W, 96);
      const riv = tinted(img.rivals, '#000000', at(D.sil, fr, 0));
      clipped(() => g.drawImage(riv, 126, 64));
    }
    if (fr >= 2205 && fr <= 2407) { // 8 청록 띠 + 투구 일러스트 + 황금 공
      band(img.bandCyan, D.bandCyan, fr);
      g.drawImage(img.throw, artX(5 + at(D.ah, fr, 0), img.throw.width), 64);
      clipped(() => {
        streaks(D.streaks.cyan, fr);
        const b = D.ball.data[fr - D.ball.f0]; // 공이 잔상 선보다 앞
        if (b) cell(img.ball, D.ball.cells[b[0]], b[1], b[2]);
      });
    }
    const ov = at(D.ov, fr, null); // 팔레트 페이드 근사(흰/회색 오버레이)
    if (ov && ov[1] > 0) { g.globalAlpha = ov[1]; g.fillStyle = ov[0]; g.fillRect(-DW, 0, W, H); g.globalAlpha = 1; }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------- 진행 ----------
  function cue(fr) {
    // 효과음은 원작처럼 한 번에 하나(새 효과음이 앞 효과음을 끊는다: 기준 녹음에서 불덩이 0xB0 은 착탄 0xB1 시작 때 끊긴다)
    for (const [cf, key] of CUES) if (cf === fr && has(key)) { try { app.sfx?.(key, { solo: 'intro' }); } catch (e) { console.warn('sfx', e); } }
  }
  function tick(now) {
    if (state !== 'play') return;
    if (!paused) {
      acc += Math.min(100, now - last);
      while (acc >= TICK && f < D.f1) { acc -= TICK; f++; cue(f); }
    }
    last = now;
    draw(f);
    if (f >= D.f1) { finish(); return; }
    raf = requestAnimationFrame(tick);
  }

  const view = () => app.view;
  function waitView(ms) {
    return new Promise((res) => {
      const t0 = performance.now();
      const poll = () => (view() || performance.now() - t0 > ms ? res() : setTimeout(poll, 50));
      poll();
    });
  }

  /** 최종 타이틀 상태 → 로고가 화면 상단 로고 자리로 이동, 오버레이 페이드, 아래 UI 등장 */
  async function finish() {
    if (state === 'leave' || state === 'done') return;
    state = 'leave';
    cancelAnimationFrame(raf);
    f = D.f1; draw(f);
    document.body.dataset.intro = 'leave';
    release();
    await waitView(1500);
    if (state !== 'leave') return; // 대기 중 abort
    release();
    const target = $('#app .title-logo img');
    const tr = target?.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    if (target && tr.width > 0 && cr.width > 0) {
      const s = cr.width / W;
      const from = { left: cr.left + (pos.fin[0] + DW) * s, top: cr.top + pos.fin[1] * s, width: pos.size[0] * s, height: pos.size[1] * s };
      const fly = h('img.title-fly', { src: target.src, alt: '', 'aria-hidden': 'true' });
      for (const [k, v] of Object.entries(from)) fly.style[k] = v + 'px';
      document.body.append(fly);
      target.style.visibility = 'hidden';
      draw(f, false); // 캔버스에서는 로고를 빼고(날아가는 사본이 대신) 배경만
      document.body.dataset.titleEnter = '1';
      fly.getBoundingClientRect();
      requestAnimationFrame(() => {
        fly.classList.add('go');
        Object.assign(fly.style, { left: tr.left + 'px', top: tr.top + 'px', width: tr.width + 'px', height: tr.height + 'px' });
        overlay.classList.add('out');
      });
      leaveTimer = setTimeout(() => { fly.remove(); const t = $('#app .title-logo img'); if (t) t.style.visibility = ''; done(); }, 480);
    } else {
      overlay.classList.add('out');
      leaveTimer = setTimeout(done, 320);
    }
  }
  /** 건너뛴 뒤 전환 중에도 입력 가능: 키 가로채기 해제, inert 해제, 닉네임 칸 포커스 */
  function release() {
    removeEventListener('keydown', onKey, true);
    appRoot.inert = false;
    const n = $('#nick');
    if (n && document.activeElement !== n) n.focus();
  }
  function done() {
    if (state === 'done') return;
    state = 'done';
    cleanup();
    $('#nick')?.focus();
    setTimeout(() => { delete document.body.dataset.titleEnter; }, 600);
    onEnd?.();
  }
  function cleanup() {
    cancelAnimationFrame(raf);
    clearTimeout(leaveTimer);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', fit);
    overlay.remove();
    document.querySelectorAll('.title-fly').forEach((x) => x.remove());
    appRoot.inert = false;
    delete document.body.dataset.intro;
  }
  /** 경기 복귀 등 즉시 종료(전환 연출 없음) */
  function abort() {
    if (state === 'done') return;
    state = 'done';
    cleanup();
    const t = $('#app .title-logo img'); if (t) t.style.visibility = '';
    onEnd?.();
  }
  function skip() {
    if (state === 'load') { skipWanted = true; release(); return; }
    if (state === 'play') { try { app.bgmStop?.(); } catch { /* 무시 */ } finish(); } // 원작: 건너뛰면 0xE1(곡 즉시 정지)
  }

  function onKey(e) {
    if (state !== 'play' && !(state === 'load' && !skipWanted)) return; // 건너뛴 뒤에는 통과
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return; // 새로고침·개발자 도구 등은 통과
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) skip();
  }
  addEventListener('keydown', onKey, true);
  overlay.addEventListener('pointerdown', (e) => { e.preventDefault(); skip(); });

  // ---------- 로드 ----------
  const loadTimer = setTimeout(() => { if (state === 'load') { console.warn('intro: 로드 시간 초과'); abort(); } }, 10000);
  Promise.all([json('intro.data.play'), ...Object.entries(IMG).map(([k, key]) => image(key).then((im) => { img[k] = im; }))])
    .then(([d]) => {
      clearTimeout(loadTimer);
      if (state !== 'load') return;
      D = d; f = D.f0; state = 'play';
      if (skipWanted) { finish(); return; }
      cue(f); last = performance.now(); acc = 0;
      draw(f);
      raf = requestAnimationFrame(tick);
    })
    .catch((e) => { clearTimeout(loadTimer); console.warn('intro', e.message); abort(); });

  const ctl = {
    get active() { return state !== 'done'; },
    get state() { return state; },
    get frame() { return f; },
    get scene() { return D?.scenes.find(([, a, b]) => f >= a && f <= b)?.[0] ?? null; },
    skip, abort,
    // 검증용: 프레임 고정
    pause(v = true) { paused = v; },
    seek(n) { if (!D) return; f = Math.max(D.f0, Math.min(D.f1 - 1, n | 0)); acc = 0; draw(f); },
  };
  return ctl;
}
