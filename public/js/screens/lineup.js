// 경기 전 화면: 라인업 VS. 원작 경기 전 공통 화면(1PvsCOM 서브 2, 스토리 서브 4, 리그 서브 9)의 구성을 따른다
// (analysis/11_team_select.md §4, analysis/28 §2-1·§10): 검은 바탕에 좌우 창 2개, 창 머리에 라벨(1P/2P/COM)·엠블럼·팀 이름·약칭,
// 그 아래 선수 7명 얼굴 + 이름, 가운데 VS. 좌표는 원작 320x224 캡처 실측(창 x 8/168 폭 144, 얼굴 (24|184, 40+24i), 이름 x 56|216).
// 원작과 다른 점: 글자는 한글(Galmuri 도트 글꼴), 논리 398 폭 가운데(+39)에 놓고 양옆은 원작 바탕색(검정) 그대로.
// 사용: app.go('lineup', { teams: [왼쪽 팀, 오른쪽 팀], labels: ['1P', 'COM'], onExit, onCancel })
import { h, fitScale, isTyping } from '../util.js';
import { has, image } from '../game/assets.js';
import { teamName, teamPlayers } from '../names.js';
import { emblemOf, abbrOf } from '../pix.js';
import { pixText, pixTextWidth, clearPixText } from '../pixtext.js';

const W = 398, H = 224, OX = 39;
const WIN_X = [8, 168], WIN_W = 144, HEAD_Y = 34; // 창 왼쪽 x(원작 좌표), 머리/명단 구분선 y
const NEXT_KEYS = new Set(['Enter', ' ']);
const NEXT_CODES = new Set(['KeyA', 'KeyS', 'KeyD']); // 경기 조작 키로도 넘김

export function mount(root, app, data = {}) {
  const teams = [0, 1].map((i) => (Number.isInteger(data.teams?.[i]) ? data.teams[i] : i));
  const labels = [data.labels?.[0] ?? '1P', data.labels?.[1] ?? 'COM'];
  const exit = data.onExit || (() => app.go(app.room ? 'room' : 'lobby'));
  const cancel = () => (data.onCancel || exit)();
  const nameOf = (t, i) => { const n = teamPlayers(t)[i]; return n && /[가-힣]/.test(n) ? n : `${i + 1}번`; };
  const canvas = h('canvas', { width: W, height: H, role: 'img',
    'aria-label': `${teamName(teams[0], '왼쪽 팀')} 대 ${teamName(teams[1], '오른쪽 팀')} 선수 명단`,
    style: { display: 'block', imageRendering: 'pixelated', background: '#000' } });
  const wrap = h('div.screen.lineup', { style: { alignItems: 'center', justifyContent: 'center', padding: '0', background: '#000' } }, canvas);
  root.append(wrap);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  let imgs = null, alive = true;

  function fit() {
    const s = fitScale(innerWidth, innerHeight, W, H);
    canvas.style.width = s.cw + 'px'; canvas.style.height = s.ch + 'px';
  }
  fit();
  addEventListener('resize', fit);

  /** 원작 창(select.window.9s 24x24, 테두리 8px) 9-slice */
  function win(x, y, w, hh) {
    const b = 8, s = imgs.win, m = 24 - 2 * b;
    const xs = [[0, x, b], [b, x + b, w - 2 * b], [24 - b, x + w - b, b]], ys = [[0, y, b], [b, y + b, hh - 2 * b], [24 - b, y + hh - b, b]];
    for (const [sy, dy, dh] of ys) for (const [sx, dx, dw] of xs) g.drawImage(s, sx, sy, sx === b ? m : b, sy === b ? m : b, OX + dx, dy, dw, dh);
  }
  function glyphs(str, x, y, sy = 1) {
    const s = String(str).toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const n = s.charCodeAt(i) - 32;
      if (n >= 0 && n < 64) g.drawImage(imgs.font, n * 8, 0, 8, 8, OX + x + i * 8, y, 8, 8 * sy);
    }
  }
  /** 12px 로 칸(maxW)에 안 들어가는 긴 이름은 가로로 찌그러뜨리지 않고 8px 도트 글자로 낮춰 그린다 */
  function put(str, x, y, px, maxW) {
    const small = px >= 12 && maxW && pixTextWidth(str, px) > maxW;
    g.drawImage(pixText(str, small ? 8 : px, '#fcfcfc', maxW), OX + x, y - 1 + (small ? 2 : 0));
  }
  /** 얼굴 24x24. hud.faces 아틀라스는 좌우반전 그림이라 다시 뒤집어 원작 방향으로 */
  function face(team, i, x, y) {
    g.save(); g.translate(OX + x + 24, y); g.scale(-1, 1);
    g.drawImage(imgs.faces, i * 24, team * 24, 24, 24, 0, 0, 24, 24);
    g.restore();
  }

  function draw() {
    if (!imgs) return;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    teams.forEach((t, s) => {
      const x = WIN_X[s];
      win(x, 0, WIN_W, H);
      // 머리/명단 구분선(원작 4줄: 회청 / 흰 / 연보라 / 회청)
      ['#6c6c90', '#fcfcfc', '#b4b4d8', '#6c6c90'].forEach((c, k) => { g.fillStyle = c; g.fillRect(OX + x + 6, HEAD_Y + k, WIN_W - 12, 1); });
      // 원작은 라벨·엠블럼·이름이 한 줄(x 16/40/72)이고 이름은 8px 가나. 한글은 8px 에서 읽기 어려워 12px 로 그리는데
      // 6~7글자 팀 이름(78~90px)이 그 자리(66px)에 안 들어가 창 테두리에 닿는다. 그래서 라벨을 엠블럼 위로 올려(편성 화면과 같은 배치) 이름 칸을 91px 로 넓힌다
      const lb = String(labels[s]);
      glyphs(lb, x + 25 - lb.length * 4, 8);
      g.drawImage(imgs.emb, emblemOf(t) * 24, 0, 24, 16, OX + x + 13, 17, 24, 16);
      put(teamName(t, `팀 ${t + 1}`), x + 42, 9, 12, 90);
      glyphs(abbrOf(t), x + 42, 24);
      for (let i = 0; i < 7; i++) {
        face(t, i, x + 16, 40 + 24 * i);
        put(nameOf(t, i), x + 48, 46 + 24 * i, 12, 84);
      }
    });
    glyphs('VS', 152, 104, 2);
  }

  function leave() { if (!alive) return; app.sfx?.('sfx.ui.confirm'); exit(); }
  function onKey(e) {
    if (!alive || e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.body.dataset.intro) return;
    if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); app.sfx?.('sfx.ui.confirm'); cancel(); return; }
    if (NEXT_KEYS.has(e.key) || NEXT_CODES.has(e.code)) { e.preventDefault(); leave(); }
  }
  addEventListener('keydown', onKey);
  canvas.addEventListener('pointerdown', leave);

  Promise.all([image('select.window.9s'), image('select.emblems'), image('select.font.white'), image('hud.faces')]).then(([w, emb, font, faces]) => {
    if (!alive) return;
    imgs = { win: w, emb, font, faces };
    document.fonts?.ready?.then(() => { if (alive) { clearPixText(); draw(); } });
    draw();
  }).catch((e) => { console.warn('lineup', e); if (alive) exit(); });

  return { onError() { cancel(); }, unmount() { alive = false; removeEventListener('keydown', onKey); removeEventListener('resize', fit); } };
}

/** 에셋이 모두 있을 때만 쓸 수 있음(없으면 호출 측이 건너뜀) */
export const available = () => has('select.window.9s') && has('select.emblems') && has('select.font.white') && has('hud.faces');
