// 불꽃의 계승 경기 전용 HUD 덧그림: 내야 얼굴 아래 HP 숫자(DOM, 작게). game_start.flame 이 있는 경기에서만 켜진다.
// 일반 경기 HUD(game/hud.js, 원작식 캔버스)는 건드리지 않는다: 이 모듈은 경기 화면의 .stage 위에 숫자 층 하나만 얹고, 경기 화면이 사라지면 같이 없어진다.
// 좌표는 hud.js 와 같은 값(398x224 논리 px): 얼굴 가운데 x, 얼굴 상단 y = hud.js flameFaceY(hp, 그 경기 최대 HP), 얼굴 24px.
import { h } from '../../util.js';
import { net } from '../../net.js';
import { flameFaceY } from '../../game/hud.js';

const W = 398, H = 224, FACE = 24, SUB_DELAY = 70 + 44, IN_TICKS = 44;
const SLOT_CX = [[116, 84, 52, 20], [204, 236, 268, 300].map((x) => x + (W - 320))]; // [좌석][내야 슬롯]
const FL_DEAD = 8, ST_OUTMOVE = 12, ST_GONE = 14;
let active = false, layer = null, cells = null, cur = null, hpCap = 0;
const faceTop = (hp) => flameFaceY(hp, hpCap);

function occupant(p, seat, slot) {
  for (let pid = seat * 7; pid < seat * 7 + 7; pid++) {
    const x = p[pid];
    if (x && x[5] === slot && !(x[6] & FL_DEAD) && x[3] !== ST_GONE && x[3] !== ST_OUTMOVE && x[4] > 0) return pid;
  }
  return -1;
}
function drop() { layer?.remove(); layer = null; cells = null; cur = null; }
function ensure() {
  if (layer?.isConnected) return true;
  const stage = document.querySelector('.game .stage'), canvas = stage?.querySelector('canvas');
  if (!canvas) return false;
  cells = [0, 1].map(() => [0, 1, 2, 3].map(() => h('b', { hidden: true })));
  cur = [0, 1].map(() => [0, 1, 2, 3].map(() => ({ pid: -2, at: 0, text: '', top: -1 })));
  layer = h('div.fl-hud-hp', { 'aria-hidden': 'true' }, cells);
  canvas.after(layer);
  return true;
}

function onSnap(s) {
  if (!active || !Array.isArray(s?.p) || !ensure()) return;
  for (const p of s.p) if (p && p[4] > hpCap) hpCap = p[4]; // hud.js 와 같은 값(경기 중 본 최대 HP)
  const intro = !!s.sq && (s.sq[0] === 0 || (s.sq[0] === 1 && s.sq[1] < IN_TICKS));
  for (let seat = 0; seat < 2; seat++) for (let slot = 0; slot < 4; slot++) {
    const el = cells[seat][slot], c = cur[seat][slot], pid = occupant(s.p, seat, slot);
    if (pid !== c.pid) { c.at = c.pid === -2 ? 0 : s.f + SUB_DELAY; c.pid = pid; } // 교체 투입 얼굴은 늦게 올라온다(hud.js): 숫자도 그 뒤에
    const show = pid >= 0 && !intro && s.f >= c.at;
    if (el.hidden === show) el.hidden = !show;
    if (!show) continue;
    const hp = s.p[pid][4], top = faceTop(hp) + FACE + 1, text = String(hp);
    if (text !== c.text) { c.text = text; el.textContent = text; el.classList.toggle('low', hp < 20); }
    if (top !== c.top) { c.top = top; el.style.top = `${(top / H) * 100}%`; el.style.left = `${(SLOT_CX[seat][slot] / W) * 100}%`; }
  }
}

net.on('game_start', (m) => {
  const f = m?.flame ?? m?.flameVs; // flameVs = 키운 팀 대전(PROTOCOL §13.20): HP 숫자는 같이 보인다
  drop(); active = !!f && (Number.isInteger(f.seat) || (Array.isArray(f.seats) && f.seats.some(Boolean))); // 사람끼리 방(§13.25) = seats 배열(한 좌석만 불꽃 팀이어도 양쪽 숫자)
  hpCap = Math.max(0, ...(m?.teams ?? []).flatMap((t) => (t?.players ?? []).map((p) => (Number.isFinite(p?.hp) ? p.hp : 0))));
});
net.on('room_left', () => { active = false; });
net.on('snap', onSnap);
