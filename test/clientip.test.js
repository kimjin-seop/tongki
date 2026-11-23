import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { resolveClientIp } from '../server/net/clientip.js';
import { openWs } from './ws_util.js';

test('IP 판정(순수): 루프백만 XFF 자동 신뢰·마지막 값 기준·외부 직접 연결은 소켓 주소·TRUST_PROXY=0 끔/1 종전', () => {
  assert.deepEqual(resolveClientIp('127.0.0.1', '203.0.113.5', undefined), { ip: '203.0.113.5', viaXff: true });
  assert.equal(resolveClientIp('::ffff:127.0.0.1', '1.1.1.1, 203.0.113.5', undefined).ip, '203.0.113.5'); // 왼쪽 위조 무시
  assert.equal(resolveClientIp('::1', undefined, undefined).ip, '::1'); // XFF 없으면 루프백 그대로
  assert.equal(resolveClientIp('198.51.100.7', '10.9.9.9', undefined).ip, '198.51.100.7'); // 외부 직접 연결 = XFF 무시
  assert.equal(resolveClientIp('127.0.0.1', '203.0.113.5', '0').ip, '127.0.0.1');
  assert.deepEqual(resolveClientIp('198.51.100.7', '203.0.113.5', '1'), { ip: '203.0.113.5', viaXff: false });
});

function conn(port, xff) {
  const ws = openWs(port, { headers: { 'x-forwarded-for': xff, 'user-agent': 'Mozilla/5.0', 'accept-language': 'ko', origin: `http://127.0.0.1:${port}` } }); // 브라우저 헤더(botguard 지문 점수 회피)
  const err = new Promise((res) => {
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t === 'error') res(m.code); });
    ws.on('close', () => res('closed'));
  });
  return { ws, open: new Promise((r) => { ws.on('open', r); ws.on('error', r); }), err };
}

test('실서버(:memory:): 루프백+XFF 는 IP별로 따로 세고, 왼쪽 위조로 상한을 못 피한다, 경고 1회', async () => {
  const prev = process.env.TRUST_PROXY;
  delete process.env.TRUST_PROXY;
  const logs = [];
  const app = createServer({ store: new MemoryResultStore(), log: (...a) => logs.push(a.join(' ')), limits: { maxConnPerIp: 2, loginTimeoutMs: 5000 } });
  const port = await app.listen(0);
  const all = [];
  try {
    const a1 = conn(port, '203.0.113.1'), a2 = conn(port, '9.9.9.9, 203.0.113.1');
    all.push(a1, a2);
    await Promise.all([a1.open, a2.open]);
    const a3 = conn(port, '8.8.8.8, 203.0.113.1'); // 왼쪽 가짜 IP 를 바꿔도 마지막 값 = A
    all.push(a3);
    assert.equal(await a3.err, 'TOO_MANY_CONNECTIONS');
    const b1 = conn(port, '203.0.113.2');
    all.push(b1);
    await b1.open;
    b1.ws.send(JSON.stringify({ t: 'hello', nickname: '비아이피' }));
    const w = await new Promise((res) => b1.ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t === 'welcome' || m.t === 'error') res(m); }));
    assert.equal(w.t, 'welcome'); // IP B 는 정상
    assert.equal(logs.filter((l) => l.startsWith('[proxy]')).length, 1);
  } finally {
    if (prev === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = prev;
    all.forEach((c) => c.ws.close());
    await app.close();
  }
});
