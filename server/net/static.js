// 정적 파일 응답(public/): 압축(br/gzip, 메모리 캐시)·검증 헤더(ETag/Last-Modified -> 304)·Cache-Control·단일 Range(206)·서빙 차단 목록.
// 근거: analysis/51_traffic_measure.md §3(압축·캐시·Range 없음, 안 쓰는 대용량 파일 공개). 경기·로비 로직과 무관하다.
import { stat, readFile, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

/**
 * 서빙 차단 목록(public/ 기준 상대 경로, 소문자 비교). 파일은 지우지 않고 HTTP 로만 404 를 준다.
 * 근거(2026-11-20 확인): public/js·css·index.html·assets/manifest.json 어디에서도 참조하지 않는다. docs/HANDOFF.md 에 기록.
 * BlackHanSans-Regular.ttf 는 manifest `font.title` 이 참조하고 loadFonts() 가 받으므로 넣지 않았다(manifest 항목 정리가 먼저).
 */
export const BLOCKED = [
  /^assets\/rom\/_cache\//, // 파이썬 피클 캐시 321MB(분석 도구 산출물)
  /\.pkl$/, // 피클은 어디에 있든
  /^assets\/rom\/bgm_lpf\//, // BGM 저역 필터 시안 34MB
  /^assets\/rom\/bgm_cand[^/]*\//, // BGM 후보 bgm_cand(28MB)·bgm_cand_lap(2MB)
  /^assets\/manifest\.backup[^/]*$/, // 백업 manifest
  /^assets\/fonts\/galmuri(7|11)\.ttf$/, // Galmuri ttf 원본 9MB(woff2 로 교체 후 보존만)
];
export const isBlocked = (rel) => { const r = rel.toLowerCase(); return BLOCKED.some((re) => re.test(r)); };

// 압축 대상(텍스트류 + 압축 안 된 ttf·ico). png·woff2·ogg·mp3·wav·jpg 등 이미 압축된 형식·음원은 제외
const COMPRESSIBLE = new Set(['.js', '.css', '.json', '.html', '.svg', '.webmanifest', '.txt', '.ttf', '.ico']);
const MIN_COMPRESS = 512; // 이보다 작으면 압축 이득이 헤더보다 작다
const MAX_COMPRESS = 8 << 20; // 이보다 큰 파일은 압축하지 않고 그대로(메모리 보호)
// 잘 바뀌지 않는 대용량 자산: 해시 없는 경로라 수정 직후 반영을 위해 1시간만. 나머지(html·js·css·json 등)는 no-cache(매번 재검증 -> 304)
const LONG_CACHE = /^assets\/rom\/.*\.(wav|png|woff2|ogg|mp3|jpg)$/;
const CC_LONG = 'public, max-age=3600';
const CC_DEFAULT = 'no-cache';

/** Accept-Encoding 에서 br > gzip 순으로 고른다(q=0 은 거부로 본다). */
export function pickEncoding(header) {
  if (!header) return null;
  const ok = new Set();
  for (const part of String(header).split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    if (q && !(Number(q.slice(2)) > 0)) continue;
    ok.add(name.trim());
  }
  if (ok.has('br')) return 'br';
  if (ok.has('gzip') || ok.has('*')) return 'gzip';
  return null;
}

/** 압축 결과 메모리 캐시: 키 = 파일 경로 + 인코딩, 값은 mtime+size 가 같을 때만 유효(파일을 고치면 자동 무효화). 총 바이트 상한 LRU. */
export class CompressCache {
  constructor(maxBytes = 64 << 20) { this.maxBytes = maxBytes; this.bytes = 0; this.map = new Map(); this.pending = new Map(); }
  async get(file, enc, st) {
    const key = enc + '|' + file, ver = st.mtimeMs + ':' + st.size;
    const hit = this.map.get(key);
    if (hit && hit.ver === ver) { this.map.delete(key); this.map.set(key, hit); return hit.buf; }
    const pk = key + '|' + ver;
    if (this.pending.has(pk)) return this.pending.get(pk);
    const p = (async () => {
      const raw = await readFile(file);
      // stat 과 읽기 사이에 파일이 바뀌었으면 옛 판 키로 새 내용을 넣지 않는다(이번 응답은 무압축 스트림으로)
      const st2 = await stat(file).catch(() => null);
      if (!st2 || st2.mtimeMs + ':' + st2.size !== ver) return null;
      const buf = enc === 'br'
        ? await brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
        : await gzip(raw, { level: 6 });
      const out = buf.length < raw.length ? buf : null; // 커지면 압축하지 않는다
      this.#put(key, { ver, buf: out, size: out?.length ?? 0 });
      return out;
    })().finally(() => this.pending.delete(pk));
    this.pending.set(pk, p);
    return p;
  }
  #put(key, v) {
    const old = this.map.get(key);
    if (old) { this.bytes -= old.size; this.map.delete(key); }
    if (v.size > this.maxBytes) return;
    this.map.set(key, v); this.bytes += v.size;
    for (const [k, e] of this.map) { if (this.bytes <= this.maxBytes) break; this.map.delete(k); this.bytes -= e.size; }
  }
}

const etagOf = (st) => `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;

function notModified(req, etag, st) {
  const inm = req.headers['if-none-match'];
  if (inm != null) { // If-None-Match 가 있으면 If-Modified-Since 는 무시(RFC 9110 13.2.2)
    const strip = (t) => t.trim().replace(/^W\//, '');
    return String(inm).split(',').some((t) => t.trim() === '*' || strip(t) === strip(etag));
  }
  const ims = Date.parse(req.headers['if-modified-since'] ?? '');
  return Number.isFinite(ims) && Math.floor(st.mtimeMs / 1000) * 1000 <= ims;
}

/** 단일 범위 bytes=a-b / a- / -n 만. 해석 못 하거나 만족 못 하면 null(-> 200 전체 응답으로 안전하게 폴백) */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '') || size === 0) return null;
  let start, end;
  if (m[1] === '') { const n = Number(m[2]); if (n === 0) return null; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!(start <= end) || start >= size) return null;
  return { start, end };
}

/** 정적 핸들러를 만든다. 반환 함수(req, res, pathname)는 응답을 끝낸다. */
export function createStaticHandler(publicDir, opts = {}) {
  const cache = opts.cache ?? new CompressCache(opts.cacheBytes);
  let realRoot = null;
  return async function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(publicDir, rel);
    if (!file.startsWith(publicDir + path.sep)) { res.writeHead(403).end(); return; }
    const st = await stat(file).catch(() => null);
    if (!st?.isFile()) { res.writeHead(404).end('not found'); return; }
    // 차단 판정은 실제 경로 기준(Windows 대소문자·8.3 짧은 이름·::$DATA 등으로 우회하지 못하게)
    realRoot ??= await realpath(publicDir).catch(() => publicDir);
    const real = await realpath(file).catch(() => null);
    const realRel = real && path.relative(realRoot, real);
    if (!realRel || realRel.startsWith('..') || path.isAbsolute(realRel) || isBlocked(realRel.split(path.sep).join('/'))) { res.writeHead(404).end('not found'); return; }
    const relN = realRel.split(path.sep).join('/').toLowerCase();
    const ext = path.extname(real).toLowerCase();
    const etag = etagOf(st);
    const compressible = COMPRESSIBLE.has(ext) && st.size >= MIN_COMPRESS && st.size <= MAX_COMPRESS;
    const headers = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': LONG_CACHE.test(relN) ? CC_LONG : CC_DEFAULT,
      etag, 'last-modified': st.mtime.toUTCString(),
    };
    if (compressible) headers.vary = 'Accept-Encoding';
    else headers['accept-ranges'] = 'bytes';
    const head = req.method === 'HEAD';
    if (notModified(req, etag, st)) { res.writeHead(304, headers).end(); return; }

    // 범위 요청: 압축하지 않는 형식만(오디오 탐색). If-Range 가 현재 판과 다르면 전체
    if (!compressible && req.headers.range) {
      const ir = req.headers['if-range'];
      const irOk = ir == null || ir === etag.replace(/^W\//, '') || ir === headers['last-modified'];
      const r = irOk ? parseRange(req.headers.range, st.size) : null;
      if (r) {
        res.writeHead(206, { ...headers, 'content-range': `bytes ${r.start}-${r.end}/${st.size}`, 'content-length': r.end - r.start + 1 });
        if (head) { res.end(); return; }
        pipeFile(real, res, r);
        return;
      }
    }

    const enc = compressible ? pickEncoding(req.headers['accept-encoding']) : null;
    const body = enc ? await cache.get(real, enc, st).catch(() => null) : null;
    if (body) {
      res.writeHead(200, { ...headers, 'content-encoding': enc, 'content-length': body.length });
      res.end(head ? undefined : body);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': st.size });
    if (head) { res.end(); return; }
    pipeFile(real, res);
  };
}

/** 파일 -> 응답. pipeline 이라 클라이언트가 중간에 끊으면 ReadStream 도 닫힌다(fd 누수 방지), 읽기 오류면 응답을 끊는다 */
export function pipeFile(file, res, range) {
  const s = createReadStream(file, range ?? {});
  pipeline(s, res, () => {});
  return s;
}
