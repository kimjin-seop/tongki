// 래더 대기열(메모리, 순수). 짝 찾기 규칙(analysis/46 §2·§8-2):
//  - 허용 차 = queueWindow(대기 시간). windowRule 'max' = 두 사람 중 넓은 창, 'min' = 두 창 모두.
//  - 손님끼리·같은 키끼리는 짝짓지 않는다(손님은 레이팅 1000 으로 본다).
//  - 오래 기다린 사람부터, 허용 범위 안에서 레이팅 차가 가장 작은 상대.
//  - 같은 상대 제한(blocked(a,b) = 24시간 반영 3판)에 걸린 짝은 다른 후보가 있으면 고르지 않고, 먼저 기다린 쪽 대기가 maxWaitSec 를 넘었을 때만 허용(그 경기는 반영 안 됨).
import { LADDER, queueWindow } from './elo.js';

export class LadderQueue {
  constructor() { this.map = new Map(); this.seq = 0; } // key -> entry

  /**
   * entry = {key, nick, guest:boolean, rating, at(ms), s?(세션)}. 이미 있으면 그대로 두고 false.
   * seq = 줄 선 순번(같은 ms 에 선 두 사람의 선후 판정용. 다시 세울 때 넘겨준 seq 는 유지 = 원래 순번)
   */
  join(e) {
    if (this.map.has(e.key)) return false;
    this.map.set(e.key, { ...e, rating: e.guest ? LADDER.guestRating : e.rating, seq: e.seq ?? ++this.seq });
    return true;
  }
  leave(key) { return this.map.delete(key); }
  get(key) { return this.map.get(key) ?? null; }
  get size() { return this.map.size; }
  window(e, now) { return queueWindow(now - e.at); }

  /** 한 번 짝 찾기. 짝지은 사람은 대기열에서 뺀다. 반환 [{a, b, blocked}](a = 먼저 기다린 사람) */
  match(now, blocked = () => false) {
    const Q = LADDER.queue;
    const es = [...this.map.values()].sort((x, y) => x.at - y.at || x.seq - y.seq); // 같은 ms 면 먼저 선 순번(종전 키 순은 같은 ms 에 선 사람의 선후를 뒤집었다)
    const used = new Set(), out = [];
    for (const a of es) {
      if (used.has(a.key)) continue;
      const wa = this.window(a, now);
      let best = null, lim = null;
      for (const b of es) {
        if (b === a || used.has(b.key) || (a.guest && b.guest) || a.key === b.key) continue;
        const d = Math.abs(a.rating - b.rating), wb = this.window(b, now);
        if (!(d <= (Q.windowRule === 'min' ? Math.min(wa, wb) : Math.max(wa, wb)))) continue;
        if (blocked(a, b)) { if (!lim || d < lim.d) lim = { b, d }; continue; }
        if (!best || d < best.d) best = { b, d };
      }
      const pick = best ?? (lim && now - a.at >= Q.maxWaitSec * 1000 ? lim : null);
      if (!pick) continue;
      used.add(a.key); used.add(pick.b.key);
      this.map.delete(a.key); this.map.delete(pick.b.key);
      out.push({ a, b: pick.b, blocked: !best });
    }
    return out;
  }
}
