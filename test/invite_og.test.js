// 초대 링크 미리보기(`/?room=CODE`, server/net/invite_og.js): og 메타 주입·이스케이프·일반 문구·쿼리 없는 `/` 불변. DB 는 메모리, public/ 은 읽기만
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';

const get = (port, p, headers = {}) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port, path: p, headers }, (r) => {
    const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => res({ status: r.statusCode, h: r.headers, body: Buffer.concat(parts).toString('utf8') }));
  }).on('error', rej);
});
const meta = (html, k) => [...html.matchAll(new RegExp(`<meta (?:property|name)="${k}" content="([^"]*)">`, 'g'))].map((m) => m[1]);

async function withApp(limits, fn) {
  const app = createServer({ store: new MemoryResultStore(), dbPath: ':memory:', log: () => {}, limits });
  const port = await app.listen(0);
  try { await fn(app, port); } finally { await app.close(); }
}
const seatHost = (app, code, nick) => { const r = app.lobby.makeRoom(code); r.seats[0] = { s: { nick }, ready: false, team: 0 }; return r; };

test('초대 미리보기: 대기 방 -> 방장 닉네임(이스케이프) 제목·절대 URL·no-store', async () => {
  await withApp({}, async (app, port) => {
    seatHost(app, 'ABCD', `<i>"운&영'"`);
    const r = await get(port, '/?room=abcd', { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'tongki.example.kr' });
    assert.equal(r.status, 200);
    assert.equal(r.h['cache-control'], 'no-store');
    assert.equal(r.h.etag, undefined);
    assert.deepEqual(meta(r.body, 'og:title'), ['&lt;i&gt;&quot;운&amp;영&#39;&quot;님과 한판하자!']);
    assert.deepEqual(meta(r.body, 'og:image'), ['https://tongki.example.kr/assets/og/invite.png']);
    assert.deepEqual(meta(r.body, 'og:url'), ['https://tongki.example.kr/?room=ABCD']);
    assert.deepEqual(meta(r.body, 'twitter:card'), ['summary_large_image']);
    assert.ok(!r.body.includes('<i>"운'), '날 닉네임이 그대로 들어가면 안 된다');
    // 이미지는 정적 서빙으로 200(차단 목록에 걸리지 않음)
    const img = await get(port, '/assets/og/invite.png');
    assert.equal(img.status, 200);
    assert.equal(img.h['content-type'], 'image/png');
  });
});

test('초대 미리보기: 방 없음·잘못된 코드·꽉 찬 방·빈도 초과 -> 일반 문구', async () => {
  await withApp({ maxInvitePreviewPerMin: 3 }, async (app, port) => {
    seatHost(app, 'WXYZ', '방장');
    const full = seatHost(app, 'FULL', '꽉참'); full.seats[1] = { s: { nick: '상대' }, ready: false, team: 1 };
    for (const q of ['QQQQ', '%3Cx%3E', 'FULL']) {
      const r = await get(port, '/?room=' + q);
      assert.equal(r.status, 200);
      assert.equal(r.h['cache-control'], 'no-store');
      assert.deepEqual(meta(r.body, 'og:title'), ['통키 피구 한판하자!'], q);
      assert.ok(!r.body.includes('<x>'));
    }
    // 위에서 형식이 맞는 코드 2회 조회(잘못된 코드는 세지 않음) -> 3번째까지 허용, 4번째는 있는 방이라도 일반 문구
    assert.deepEqual(meta((await get(port, '/?room=WXYZ')).body, 'og:title'), ['방장님과 한판하자!']);
    assert.deepEqual(meta((await get(port, '/?room=WXYZ')).body, 'og:title'), ['통키 피구 한판하자!']);
  });
});

test('초대 미리보기: 쿼리 없는 / 는 종전 정적 응답(파일 그대로·ETag·no-cache·압축)', async () => {
  await withApp({}, async (app, port) => {
    const raw = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const r = await get(port, '/');
    assert.equal(r.status, 200);
    assert.equal(r.body, raw);
    assert.equal(r.h['cache-control'], 'no-cache');
    assert.ok(r.h.etag);
    assert.equal((await get(port, '/', { 'if-none-match': r.h.etag })).status, 304);
    assert.equal((await get(port, '/', { 'accept-encoding': 'br' })).h['content-encoding'], 'br');
  });
});
