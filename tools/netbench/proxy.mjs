// 지연·지터·손실(재전송 지연) 모의 TCP 프록시. 방향별 순서 보장(HOL, 단일 큐) + 도착 몰림
import net from 'node:net';
export function createProxy({ listen, target, rtt, jitter, loss, seed = 1 }) {
  // 난수는 연결마다·방향마다 같은 씨앗으로 따로 만든다: 같은 프록시를 지나는 여러 연결(bench 의 변형들)이 내려받는 쪽에서 같은 지연·손실 무늬를 겪는다
  const mkRnd = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const stats = { down: 0, up: 0 };
  const srv = net.createServer((c) => {
    const u = net.connect(target, '127.0.0.1');
    c.setNoDelay(true); u.setNoDelay(true);
    const pipe = (from, to, dir) => {
      const rnd = mkRnd(seed + (dir === 'up' ? 1000 : 0));
      const q = []; let last = 0, timer = null;
      const pump = () => {
        timer = null;
        const now = performance.now();
        while (q.length && q[0].t <= now + 0.0005) { const it = q.shift(); if (!to.destroyed) to.write(it.buf); }
        if (q.length) timer = setTimeout(pump, Math.max(0, q[0].t - performance.now()));
      };
      from.on('data', (buf) => {
        stats[dir] += buf.length;
        const now = performance.now();
        let t = now + rtt / 2 + rnd() * jitter;
        if (rnd() < loss) t += rtt + 50; // 빠른 재전송 모의
        t = Math.max(t, last); last = t;
        q.push({ t, buf });
        if (!timer) timer = setTimeout(pump, Math.max(0, t - performance.now()));
      });
      from.on('close', () => setTimeout(() => to.destroy(), rtt)); from.on('error', () => {});
    };
    pipe(c, u, 'up'); pipe(u, c, 'down');
  });
  return { stats, start: () => new Promise((r) => srv.listen(listen, '127.0.0.1', r)), stop: () => srv.close() };
}
