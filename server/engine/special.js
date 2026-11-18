// 필살기 궤적 핸들러 (analysis/06_special_shots.md §2, §6). 순수 함수: 공(b)과 상태(s)만 갱신, 위치 이동·벽 처리는 match.js 공통부.
// 단위: 16.16 정수(px/frame). 중력 없음. V0 = 투구 순간 속도(s.v0). 나눗셈은 0 방향 내림(Math.trunc).
import { ONE } from './consts.js';

const px = (v) => Math.round(v * ONE);
const sgn = (v) => (v > 0) - (v < 0);
const tr = Math.trunc;

// ID -> 궤적 핸들러 이름. 원작 핸들러 30종 중 "장식(잔상/분신/스프라이트 플립)만 다른 것"은 같은 궤적으로 합쳤다(클라이언트가 kind로 연출).
export const HANDLER_OF_ID = (() => {
  const m = new Array(54).fill('straight1');
  const set = (name, ids) => ids.forEach((i) => { m[i] = name; });
  set('straight15', [0, 4, 9, 11, 22, 25, 28, 29, 36, 38, 41, 42, 52]);
  set('straight1', [1, 2, 3, 5, 20, 21, 31, 32, 35, 37, 40, 47, 50, 51]);
  set('half', [26, 27, 30]);
  set('erratic', [6, 45]);
  set('stopgo', [12]);
  set('curveL', [7]);
  set('curveR', [10]);
  set('dive', [8, 15]);
  set('boomerang', [13, 33, 39]);
  set('lob', [14]);
  set('drop16', [16]);
  set('accel2', [17, 46]);
  set('slowfast', [18, 43]);
  set('dropMild', [19, 44]);
  set('upFast', [23]);
  set('skim', [24]);
  set('blink', [34]);
  set('loop', [49, 53]);
  set('loop2', [48]);
  return m;
})();

/** 새 필살기 상태. 호출 시점의 b.vx/vy/vz 가 V0 */
export function initSpecial(b, id) {
  return { id, h: HANDLER_OF_ID[id] ?? 'straight1', v0: [b.vx, b.vy, b.vz], st: 0, t: 0, n: 0, base: null, lt: 0, dur: 0 };
}

const scale = (b, s, num, den) => { b.vx = tr((s.v0[0] * num) / den); b.vy = tr((s.v0[1] * num) / den); b.vz = tr((s.v0[2] * num) / den); };
const go = (s, st, dur = 0) => { s.st = st; s.t = 0; s.dur = dur; };

/** 루프 위치 덮어쓰기(근사). 원작: t=0x160 부터 프레임당 +0x20, 0x380 에서 기준점 복귀. 반경 loopRadius px 수직 원 */
function loopStep(b, s, L) {
  s.lt += 0x20;
  if (s.lt >= 0x380) { b.x = s.base[0]; b.y = s.base[1]; b.z = s.base[2]; return true; }
  const a = ((s.lt & 0x1ff) / 512) * Math.PI * 2;
  const dir = sgn(s.v0[0]) || 1;
  const c = Math.round(Math.cos(a) * 256), sn = Math.round(Math.sin(a) * 256); // 정수화: 플랫폼 ulp 차 제거
  b.x = s.base[0] + dir * tr((c * px(L.loopRadius)) / 256);
  b.z = s.base[2] + tr((sn * px(L.loopRadius)) / 256) + px(L.loopLift); // 원 중심 = 기준 z + 31px [코드 0xB660 +0x1F]
  b.y = s.base[1];
  return false;
}

/**
 * 핸들러 1프레임. 반환 후 match.js 가 pos += V, 벽/바닥 종료 판정을 한다.
 * @param {object} b 공  @param {object} s initSpecial 상태  @param {() => number} rnd 난수(16비트)  @param {object} L rules.special
 */
export function stepSpecial(b, s, rnd, L) {
  const v0 = s.v0;
  s.t++;
  switch (s.h) {
    case 'straight15': if (s.t === 1) scale(b, s, 3, 2); break;
    case 'straight1': if (s.t === 1) scale(b, s, 1, 1); break;
    case 'half': if (s.t === 1) scale(b, s, 1, 2); break;
    case 'erratic': // 4f V0 / 8f V0/4, 구간 끝마다 난수 bit3 로 전환 여부
      if (s.dur === 0) s.dur = 4; // 최초 1회만 초기화(st=0 구간 4f)
      if (s.st === 0) scale(b, s, 1, 1); else scale(b, s, 1, 4);
      if (s.t >= s.dur) { const flip = (rnd() & 8) !== 0; const nx = flip ? 4 - s.st : s.st; go(s, nx, nx === 0 ? 4 : 8); }
      break;
    case 'stopgo': // 8f V0 -> 16f V0/4 반복
      if (s.t === 1) s.dur = s.st === 0 ? 8 : 16;
      if (s.st === 0) scale(b, s, 1, 1); else scale(b, s, 1, 4);
      if (s.t >= s.dur) go(s, 4 - s.st, s.st === 0 ? 16 : 8);
      break;
    case 'curveL': case 'curveR': {
      if (s.t === 1) scale(b, s, 1, 1);
      if (s.t > 16) { const d = (s.h === 'curveL' ? -1 : 1) * (sgn(v0[0]) || 1); b.vy += d * px(0.5); }
      break;
    }
    case 'dive': // 급강하(V0xy/2, vz=2*V0z) -> 16f 정지 -> V0xy, vz=0, z=12 직진
      if (s.st === 0) {
        b.vx = tr(v0[0] / 2); b.vy = tr(v0[1] / 2); b.vz = v0[2] * 2;
        if (b.z + b.vz < px(L.minAirZ)) { if (b.z > px(L.minAirZ)) b.z = px(L.minAirZ); go(s, 4); } // [추정] 바닥 직전 정지
      }
      if (s.st === 4) {
        b.vx = b.vy = b.vz = 0;
        if (s.t > 16) { go(s, 8); b.z = px(12); }
      } else if (s.st === 8) { b.vx = v0[0]; b.vy = v0[1]; b.vz = 0; }
      break;
    case 'boomerang': // 24f V -= V0/16, 이후 V += V0/16 (|vx|>8 이면 가속 중지)
      if (s.t === 1) { b.vx = v0[0]; b.vy = v0[1]; b.vz = v0[2]; }
      else if (s.st === 0) { b.vx -= tr(v0[0] / 16); b.vy -= tr(v0[1] / 16); b.vz -= tr(v0[2] / 16); if (s.t >= 24) go(s, 4); }
      else if (Math.abs(b.vx) <= px(8)) { b.vx += tr(v0[0] / 16); b.vy += tr(v0[1] / 16); b.vz += tr(v0[2] / 16); }
      break;
    case 'lob': // V0/2, vz += 0.125/f, vz>=2.0 이면 vz*=-2
      if (s.t === 1) scale(b, s, 1, 2);
      else if (s.st === 0) { b.vz += px(0.125); if (b.vz >= px(2)) { b.vz = -2 * b.vz; s.st = 4; } }
      break;
    case 'drop16': // vz=V0z/4 8f -> vz -= 0.5/f
      if (s.t === 1) { b.vx = v0[0]; b.vy = v0[1]; b.vz = tr(v0[2] / 4); }
      else if (s.t > 8) b.vz -= px(0.5);
      break;
    case 'dropMild': // vz=V0z/2 8f -> vz -= 0.25/f
      if (s.t === 1) { b.vx = v0[0]; b.vy = v0[1]; b.vz = tr(v0[2] / 2); }
      else if (s.t > 8) b.vz -= px(0.25);
      break;
    case 'accel2': // vz=V0z/4 16f -> V=2*V0
      if (s.t === 1) { b.vx = v0[0]; b.vy = v0[1]; b.vz = tr(v0[2] / 4); }
      else if (s.t === 17) scale(b, s, 2, 1);
      break;
    case 'slowfast': // V0/2 로 10+(rnd&31)f -> 1.5*V0
      if (s.t === 1) { scale(b, s, 1, 2); s.dur = 10 + (rnd() & 31); }
      else if (s.t === s.dur + 1) scale(b, s, 3, 2);
      break;
    case 'upFast': // vz=2*V0z, vz += 0.5/f, vz>=4.0 이면 V=2*V0
      if (s.t === 1) { b.vx = v0[0]; b.vy = v0[1]; b.vz = 2 * v0[2]; }
      else if (s.st === 0) { b.vz += px(0.5); if (b.vz >= px(4)) { scale(b, s, 2, 1); s.st = 4; } }
      break;
    case 'skim': // vz=2*V0z 급강하, z<16 이면 vz=0 부터 0.03125/f 상승
      if (s.st === 0) {
        b.vx = v0[0]; b.vy = v0[1]; b.vz = 2 * v0[2];
        if (b.z + b.vz < px(L.minAirZ)) { if (b.z > px(L.minAirZ)) b.z = px(L.minAirZ); go(s, 4); b.vz = 0; }
      } else b.vz += px(0.03125);
      break;
    case 'blink': // 10f 등속 후 4프레임분 즉시 전진(1회)
      if (s.t === 1) scale(b, s, 1, 1);
      if (s.t === 11) { b.x += 4 * b.vx; b.y += 4 * b.vy; b.z += 4 * b.vz; }
      break;
    case 'loop': case 'loop2': {
      // 직진(8+rnd&7)f -> 제자리 루프 17f(위치 덮어쓰기, V 유지) -> 복귀 후 직진. loop2 는 이를 2회.
      if (s.t === 1) { scale(b, s, 1, 1); s.dur = s.h === 'loop2' ? 8 : 8 + (rnd() & 7); }
      if (s.st === 0 && s.t > s.dur) { s.st = 4; s.base = [b.x, b.y, b.z]; s.lt = 0x160 - 0x20; }
      if (s.st === 4) {
        if (loopStep(b, s, L)) { s.n++; if (s.h === 'loop2' && s.n < 2) { s.st = 0; s.t = 1; s.dur = 8 + (rnd() & 7); } else s.st = 8; }
      }
      break;
    }
    default: break;
  }
}
