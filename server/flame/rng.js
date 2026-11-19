// 도전 전용 시드 난수(엔진 rng 와 분리). 용도별 파생 시드(seed + 키 문자열)라 호출 순서와 무관하게 같은 시드·같은 키면 같은 결과다(재현 가능, 37 §4.1).
// 예: rngFor(run.seed, 'map', seg). Math.random 은 쓰지 않는다(시드·비밀값은 run.js 가 node:crypto 로 만든다).
// 두 갈래(P2 리뷰 M2): 지도 = rngFor(지도 시드 32비트) — 지도는 클라이언트에 보이므로 시드가 역산돼도 얻을 것이 없다.
//   보상·상점·영입·이벤트 = rngSecret(도전 비밀값 128비트) — 흐름마다 HMAC-SHA256(비밀값, 키)로 초기값을 만든다.
//   한 흐름의 출력으로 그 흐름의 32비트 상태를 알아내도 비밀값이나 다른 흐름(다음 보상·재선택·상점)은 알 수 없다.
import { createHmac, createHash } from 'node:crypto';

/** FNV-1a 32비트 */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** 지도용: mulberry32(FNV(시드|키)). next() = [0, 1) */
export const rngFor = (seed, ...keys) => mulberry(hash(`${seed >>> 0}|${keys.join('|')}`));

/** 보상·상점·영입·이벤트용: mulberry32(HMAC-SHA256(비밀값, 키) 앞 32비트). secret = 16진 문자열(run.secret) */
export const rngSecret = (secret, ...keys) => mulberry(createHmac('sha256', String(secret)).update(keys.join('|')).digest().readUInt32LE(0));

/** 비밀값이 없는 옛 저장(v1)·시드를 지정한 도전(시험·시뮬)의 비밀값: 시드에서 파생(같은 시드 = 같은 보상) */
export const secretFromSeed = (seed) => createHash('sha256').update(`flame-secret-v1|${seed >>> 0}`).digest('hex').slice(0, 32);

function mulberry(a) {
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  return {
    next, int,
    pick: (arr) => arr[int(arr.length)],
    /** 가중치 표 {키:가중치}에서 하나. 가중치 합이 0 이면 null */
    weighted(w) {
      const es = Object.entries(w).filter(([, v]) => v > 0), sum = es.reduce((s, [, v]) => s + v, 0);
      if (!sum) return null;
      let r = next() * sum;
      for (const [k, v] of es) { if ((r -= v) < 0) return k; }
      return es.at(-1)[0];
    },
    /** 중복 없이 n 개(모자라면 있는 만큼) */
    sample(arr, n) {
      const a = arr.slice(), out = [];
      while (a.length && out.length < n) out.push(a.splice(int(a.length), 1)[0]);
      return out;
    },
  };
}
