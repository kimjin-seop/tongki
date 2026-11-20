// 정적 파일 응답(server/net/static.js): 압축·304·차단 목록·Range. 실제 public/ 파일을 읽기만 한다(쓰기 없음), DB 는 메모리
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createServer } from '../server/index.js';
import { pipeFile } from '../server/net/static.js';
import { PassThrough } from 'node:stream';
import { MemoryResultStore } from '../server/store/results.js';

const get = (port, p, headers = {}) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port, path: p, headers }, (r) => {
    const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => res({ status: r.statusCode, h: r.headers, body: Buffer.concat(parts) }));
  }).on('error', rej);
});

test('정적: br/gzip 압축·304·차단 404·Range 206', async () => {
  const app = createServer({ store: new MemoryResultStore(), dbPath: ':memory:', log: () => {} });
  const port = await app.listen(0);
  try {
    const raw = readFileSync(new URL('../public/assets/manifest.json', import.meta.url));
    // br 우선, 풀면 원본과 같다
    const br = await get(port, '/assets/manifest.json', { 'accept-encoding': 'gzip, br' });
    assert.equal(br.status, 200);
    assert.equal(br.h['content-encoding'], 'br');
    assert.equal(br.h.vary, 'Accept-Encoding');
    assert.equal(br.h['cache-control'], 'no-cache');
    assert.ok(br.body.length < raw.length / 2);
    assert.deepEqual(zlib.brotliDecompressSync(br.body), raw);
    const gz = await get(port, '/assets/manifest.json', { 'accept-encoding': 'gzip' });
    assert.equal(gz.h['content-encoding'], 'gzip');
    assert.deepEqual(zlib.gunzipSync(gz.body), raw);
    const plain = await get(port, '/');
    assert.equal(plain.status, 200);
    assert.equal(plain.h['content-encoding'], undefined);
    assert.match(plain.body.toString('utf8'), /<html/i);

    // ETag 재검증 -> 304(본문 없음)
    const nm = await get(port, '/assets/manifest.json', { 'if-none-match': br.h.etag });
    assert.equal(nm.status, 304);
    assert.equal(nm.body.length, 0);

    // 차단 목록: 대소문자·8.3 짧은 이름 우회 포함 404, 디렉터리 순회 방어 유지
    for (const p of ['/assets/manifest.backup_before_bgm_removal.json', '/ASSETS/Manifest.Backup_before_bgm_removal.json', '/assets/fonts/Galmuri11.ttf', '/assets/rom/_cache/bgm_81_210.pkl', '/assets/MANIFE~2.JSO']) {
      assert.equal((await get(port, p)).status, 404, p);
    }
    assert.notEqual((await get(port, '/..%2fpackage.json')).status, 200);

    // 오디오: 압축 안 함, 1시간 캐시, 단일 Range -> 206
    const ogg = await get(port, '/assets/rom/bgm/83.ogg', { range: 'bytes=0-99', 'accept-encoding': 'br' });
    assert.equal(ogg.status, 206);
    assert.equal(ogg.body.length, 100);
    assert.match(ogg.h['content-range'], /^bytes 0-99\/\d+$/);
    assert.equal(ogg.h['content-encoding'], undefined);
    assert.equal(ogg.h['cache-control'], 'public, max-age=3600');
    // 해석 못 하는 범위는 200 전체로 폴백
    const multi = await get(port, '/assets/rom/bgm/83.ogg', { range: 'bytes=0-1,5-9' });
    assert.equal(multi.status, 200);
    assert.equal(multi.body.length, Number(ogg.h['content-range'].split('/')[1]));
  } finally { await app.close(); }
});

test('정적: 받는 쪽이 중간에 끊기면 파일 스트림도 닫힌다(fd 누수 방지)', async () => {
  const res = new PassThrough({ highWaterMark: 1024 });
  const s = pipeFile(new URL('../public/assets/rom/bgm/83.ogg', import.meta.url), res);
  await new Promise((r) => res.once('data', r)); // 첫 청크
  res.destroy(); // 클라이언트 끊김
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(s.destroyed, true);
});
