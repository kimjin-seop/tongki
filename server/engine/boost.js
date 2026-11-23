// 컴퓨터 단계 보정(cpuBoost): 불꽃의 계승 단계 4 이상의 컴퓨터 팀에만 주는 보조 규칙. 원작에 없는 [자작]이다.
// Match 옵션 cpuBoost 를 주지 않으면 이 파일의 어떤 함수도 난수·상태를 건드리지 않는다(원작 비트 동일).
// 옵션 값(전부 정수, 서버가 server/flame/tier.js 로 계산해서 넘긴다. 클라이언트 값은 쓰지 않는다):
//   seat = 보정을 받는 컴퓨터 좌석(사람이 조작하는 좌석에는 적용하지 않는다)
//   catch256 = 방어 결정에서 캐치가 아닌 행동을 캐치로 바꿀 확률(/256)
//   special256 = 공을 든 내야의 투구 종류 선택에서 필살기 시도(plan 0x14)로 바꿀 확률(/256)
//   ballSpeedPct = 그 좌석 선수가 던지는 공의 속력 배율(%, 100 = 그대로). 투구 동작(와인드업)·차지 프레임은 원작 그대로다
//   hpPct = 그 좌석 선수 최대 HP·시작 HP 에 더하는 %(원작 능력치 표는 건드리지 않고 경기 안의 복사본만 바꾼다)
import { ONE, BM } from './consts.js';

export const BOOST_LIMITS = { catch256: 255, special256: 255, ballSpeedPct: 2000, hpPct: 300 };
/** 공 한 프레임 이동 구간 길이(px). 이보다 빠른 공은 구간마다 피격·캐치 판정을 끼워 넣는다(터널링 방지) */
export const SWEEP_PX = 6;

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? Math.trunc(+v) : lo));

/** 옵션 정리. 없거나 모든 값이 기본이면 null(= 원작과 같은 경로) */
export function normBoost(o, humans) {
  if (!o || typeof o !== 'object') return null;
  const seat = o.seat === 0 || o.seat === 1 ? o.seat : 1;
  if (humans?.[seat]) return null; // 사람이 조작하는 좌석에는 쓰지 않는다
  const B = { seat, catch256: clampInt(o.catch256 ?? 0, 0, BOOST_LIMITS.catch256), special256: clampInt(o.special256 ?? 0, 0, BOOST_LIMITS.special256), ballSpeedPct: clampInt(o.ballSpeedPct ?? 100, 100, BOOST_LIMITS.ballSpeedPct), hpPct: clampInt(o.hpPct ?? 0, 0, BOOST_LIMITS.hpPct), sweepPx: clampInt(o.sweepPx ?? SWEEP_PX, 1, 100000) }; // sweepPx = 구간 길이(px), 측정용(터널링 on/off 비교). 기본 SWEEP_PX
  return B.catch256 || B.special256 || B.ballSpeedPct > 100 || B.hpPct ? B : null;
}

/** 선수 p 가 보정을 받는가(받으면 보정 객체) */
export const boostOf = (m, p) => (m.cpuBoost && m.cpuBoost.seat === p.seat && !m.humans[p.seat] ? m.cpuBoost : null);

/** 경기 시작 직후 1회: 그 좌석 선수의 최대 HP·시작 HP 를 늘린다(stat 은 복사본으로 바꿔 데이터 표를 건드리지 않는다) */
export function applyBoostHp(m) {
  const B = m.cpuBoost;
  if (!B || !B.hpPct) return;
  for (const p of m.players) {
    if (p.seat !== B.seat) continue;
    const hp = Math.min(255, p.stat.hp + Math.floor((p.stat.hp * B.hpPct) / 100));
    p.stat = { ...p.stat, hp }; p.hp = Math.min(255, p.hp + Math.floor((p.hp * B.hpPct) / 100));
  }
}

/** 공을 든 내야의 투구 종류(0~4, 4 = 필살 시도): 필살 시도가 아니면 확률로 바꾼다. 보정이 없으면 난수를 쓰지 않는다 */
export function bumpSpecial(m, p, n) {
  const B = boostOf(m, p);
  return B && B.special256 > 0 && n !== 4 && m.rng.int(256) < B.special256 ? 4 : n;
}

/** 투구 속력(8.8) 배율. 보정이 없거나 100% 면 그대로. 상한은 16비트 */
export function boostSpd(m, p, spd) {
  const B = boostOf(m, p);
  return B && B.ballSpeedPct > 100 ? Math.min(0xffff, Math.floor((spd * B.ballSpeedPct) / 100)) : spd;
}

/** 던진 공의 구간 수(속도가 빠를 때만 > 1). 0 = 구간 판정 없음 */
export function sweepCount(b, px = SWEEP_PX) {
  const m = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) / ONE;
  return m > px ? Math.min(64, Math.ceil(m / px)) : 0;
}

/**
 * 이번 프레임 이동 경로 중간 지점(마지막 지점은 다음 틱의 일반 판정이 본다)에서 피격·캐치를 미리 본다.
 * 맞거나 잡히면(공 상태가 바뀌면) true = 호출자는 이번 프레임 이동을 하지 않는다. 아니면 공 위치를 원래대로 두고 false
 */
export function sweepHit(m, k) {
  const b = m.ball, x0 = b.x, y0 = b.y, z0 = b.z, vx = b.vx, vy = b.vy, vz = b.vz, id = b.id;
  for (let i = 1; i < k; i++) {
    b.x = x0 + Math.trunc((vx * i) / k); b.y = y0 + Math.trunc((vy * i) / k); b.z = z0 + Math.trunc((vz * i) / k);
    m.hitCheck();
    if (b.mode !== BM.FLY || b.id !== id) return true; // 맞았다: 공 상태·위치는 hitPlayer 가 정한 값 그대로
  }
  b.x = x0; b.y = y0; b.z = z0;
  return false;
}

/** 보정 좌석 선수가 던진 공이 빠르면 이동 중간 판정을 먼저 본다. true = 공이 중간에 맞았거나 잡혀서 이번 프레임 이동은 하지 않는다 */
export function boostFly(m) {
  const b = m.ball;
  if (m.players[b.thrower]?.seat !== m.cpuBoost.seat) return false;
  const k = sweepCount(b, m.cpuBoost.sweepPx);
  return k > 0 && sweepHit(m, k);
}
