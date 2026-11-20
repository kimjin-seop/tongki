// 측정 전용(analysis/51 정적 파일): (1) public/ 파일별 크기와 gzip·brotli 압축 후 크기(계산만), (2) 임시 서버(포트 3400, DB_PATH=:memory:)의
// 실제 응답 헤더(Content-Encoding·Cache-Control·ETag·Last-Modified·Range), (3) Edge 헤드리스(임시 프로필, 이 도구가 띄운 것만 종료)로
// 첫 방문 -> 손님 로그인(로비) -> 컴퓨터 대전 1판 진입 -> 새로고침(재방문) 단계별 네트워크 요청 목록·바이트를 CDP 로 모은다. 서버 코드는 그대로.
// 사용: node tools/traffic_static.mjs --out <결과.json> [--no-edge]
import { readdirSync, statSync, readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { startServer } from './traffic_ws_measure.mjs';
import * as fsx from 'node:fs';
// --out 가 이미 디렉터리면(실행 환경이 경로를 미리 만드는 경우) 그 안의 result.json 에 쓴다
const outFile = (p) => (fsx.existsSync(p) && fsx.statSync(p).isDirectory() ? p.replace(/[\/]+$/, '') + '/result.json' : p);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', null);
const PORT = 3400;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- (1) 파일 크기·압축 ----------
function walk(d, out = []) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; }
const TEXT = new Set(['.js', '.css', '.html', '.json', '.svg', '.webmanifest', '.txt', '.md']);
const COMPRESSIBLE = new Set([...TEXT, '.ttf', '.ico', '.wav', '.pkl']);
function fileTable() {
  const rows = [];
  for (const f of walk(pub)) {
    const rel = path.relative(pub, f).split(path.sep).join('/'), ext = path.extname(f).toLowerCase(), size = statSync(f).size;
    let gz = null, br = null, br5 = null;
    if (size < 64 * 1024 * 1024) { // gzip(레벨 6) = 전부(이미 압축된 png·woff2·ogg·mp3 는 효과 없음을 보이려고), brotli 5 = 압축되는 형식만, brotli 11(사전 압축용) = 텍스트만(느려서)
      const b = readFileSync(f);
      gz = zlib.gzipSync(b, { level: 6 }).length;
      if (COMPRESSIBLE.has(ext)) br5 = zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
      if (TEXT.has(ext)) br = zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
    }
    rows.push({ rel, ext, size, gz, br5, br });
  }
  return rows;
}
function groupOf(rel) {
  const top = rel.split('/');
  if (top[0] === 'assets' && top[1] === 'rom') return 'assets/rom/' + (top[2]?.includes('.') ? '(루트)' : top[2]);
  if (top[0] === 'assets') return 'assets/' + (top[1]?.includes('.') ? '(루트)' : top[1]);
  return top.length > 1 ? top[0] : '(루트)';
}

// ---------- (2) 응답 헤더 ----------
async function headers(paths) {
  const out = {};
  for (const p of paths) {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { 'accept-encoding': 'gzip, deflate, br', range: 'bytes=0-99' } });
    const buf = Buffer.from(await r.arrayBuffer());
    out[p] = { status: r.status, bodyBytes: buf.length, headers: Object.fromEntries(r.headers.entries()) };
    // 조건부 요청: If-Modified-Since / If-None-Match 를 보내도 304 가 오는가
    const r2 = await fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { 'if-modified-since': new Date().toUTCString(), 'if-none-match': '"x"' } });
    out[p].conditionalStatus = r2.status; await r2.arrayBuffer();
  }
  return out;
}

// ---------- (3) Edge 헤드리스 CDP ----------
async function cdpSession(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map(), handlers = [];
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) for (const h of handlers) h(m); });
  return { send: (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }), on: (h) => handlers.push(h), close: () => ws.close() };
}

async function edgeRun() {
  if (!existsSync(EDGE)) return { error: 'Edge 없음' };
  const prof = mkdtempSync(path.join(tmpdir(), 'traffic51-edge-'));
  const ch = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  const pid = ch.pid;
  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i++) { await sleep(200); const f = path.join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = Number(readFileSync(f, 'utf8').split('\n')[0]); }
    if (!port) return { error: 'DevToolsActivePort 없음' };
    const c = await cdpSession(port);
    const reqs = new Map(); let phase = 'boot';
    c.on((m) => {
      const p = m.params;
      if (m.method === 'Network.requestWillBeSent') reqs.set(p.requestId, { phase, url: p.request.url.replace(`http://127.0.0.1:${PORT}`, ''), type: p.type, t: p.timestamp });
      else if (m.method === 'Network.responseReceived') { const r = reqs.get(p.requestId); if (r) { r.status = p.response.status; r.fromDiskCache = !!p.response.fromDiskCache; r.fromMemoryCache = !!p.response.fromMemoryCache || undefined; r.mime = p.response.mimeType; r.ce = p.response.headers['content-encoding'] ?? p.response.headers['Content-Encoding'] ?? null; r.cc = p.response.headers['cache-control'] ?? null; } }
      else if (m.method === 'Network.requestServedFromCache') { const r = reqs.get(p.requestId); if (r) r.servedFromCache = true; }
      else if (m.method === 'Network.loadingFinished') { const r = reqs.get(p.requestId); if (r) r.encoded = p.encodedDataLength; }
      else if (m.method === 'Network.loadingFailed') { const r = reqs.get(p.requestId); if (r) r.failed = p.errorText; }
      else if (m.method === 'Network.webSocketFrameReceived' || m.method === 'Network.webSocketFrameSent') { const k = m.method.endsWith('Received') ? 'wsIn' : 'wsOut'; const e = reqs.get('ws:' + phase + k) ?? { phase, url: k, type: 'WebSocketFrames', n: 0, encoded: 0 }; e.n++; e.encoded += Buffer.byteLength(p.response.payloadData); reqs.set('ws:' + phase + k, e); }
    });
    await c.send('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
    await c.send('Page.enable'); await c.send('Runtime.enable');
    const ev = (expr) => c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await sleep(20000); // 첫 화면 + 인트로 재생 중 지연 로딩
    phase = 'login'; // 앱 모듈(net.js)을 같은 URL 로 import 하면 같은 인스턴스 -> 화면 전환·에셋 로딩은 앱이 평소대로 한다
    await ev(`import('/js/net.js').then(({net}) => { net.send('hello', { nickname: 'edge' + Math.floor(Math.random()*9000+1000) }); return 1; })`);
    await sleep(6000);
    phase = 'game';
    await ev(`import('/js/net.js').then(({net}) => { net.send('create_room', { vsCpu: true, cpuLevel: 2 }); setTimeout(() => net.send('start'), 1500); return 1; })`);
    await sleep(25000);
    const view = await ev(`document.querySelector('#app')?.className + ' ' + (document.querySelector('canvas') ? 'canvas' : '')`);
    await ev(`import('/js/net.js').then(({net}) => { net.send('leave_room'); return 1; })`);
    await sleep(2000);
    phase = 'reload'; // 재방문(같은 프로필 새로고침): 캐시 동작
    await c.send('Page.reload', { ignoreCache: false });
    await sleep(15000);
    phase = 'revisit_nav'; // 주소창 재진입과 같은 일반 탐색
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await sleep(15000);
    c.close();
    return { view: view?.result?.value ?? null, reqs: [...reqs.values()] };
  } finally {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 이미 종료 */ }
    // 런처 pid 가 먼저 끝나 트리 종료가 안 되는 경우가 있었다: 이 도구의 임시 프로필(폴더 이름 traffic51-edge-*)을 쓰는 msedge 만 골라 끈다(사용자 본인 Edge 는 건드리지 않음)
    const tag = path.basename(prof);
    try { execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "name='msedge.exe'" | Where-Object { $_.CommandLine -match '${tag}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' }); } catch { /* 없음 */ }
    await sleep(1000);
    try { rmSync(prof, { recursive: true, force: true }); } catch { /* 잠금 */ }
  }
}

function phaseSummary(reqs) {
  const by = {};
  for (const r of reqs) {
    const e = by[r.phase] ?? (by[r.phase] = { requests: 0, bytes: 0, fromCache: 0, status304: 0, ws: {}, byType: {} });
    if (r.type === 'WebSocketFrames') { e.ws[r.url] = { frames: r.n, payloadBytes: r.encoded }; continue; }
    e.requests++; e.bytes += r.encoded ?? 0;
    if (r.fromDiskCache || r.servedFromCache || r.fromMemoryCache) e.fromCache++;
    if (r.status === 304) e.status304++;
    const t = r.type ?? '?'; const x = e.byType[t] ?? (e.byType[t] = { n: 0, bytes: 0 }); x.n++; x.bytes += r.encoded ?? 0;
  }
  return by;
}

const rows = fileTable();
const groups = {};
for (const r of rows) { const g = groupOf(r.rel); const e = groups[g] ?? (groups[g] = { files: 0, size: 0, gz: 0, br: 0 }); e.files++; e.size += r.size; e.gz += Math.min(r.size, r.gz ?? r.size); e.br += Math.min(r.size, r.br ?? r.br5 ?? r.gz ?? r.size); }
const result = { at: new Date().toISOString(), totals: { files: rows.length, size: rows.reduce((a, r) => a + r.size, 0) }, groups, files: rows };
const srv = await startServer(PORT);
try {
  result.headers = await headers(['/', '/js/main.js', '/css/app.css', '/assets/manifest.json', '/assets/fonts/Galmuri11.woff2', '/assets/rom/bgm/83.ogg', '/assets/rom/_cache/bgm_81_210.pkl', '/assets/manifest.backup_before_bgm_removal.json']);
  if (!process.argv.includes('--no-edge')) {
    const e = await edgeRun();
    result.edge = e.error ? e : { view: e.view, phases: phaseSummary(e.reqs), requests: e.reqs };
  }
} finally { srv.stop(); }
if (OUT) writeFileSync(outFile(OUT), JSON.stringify(result, null, 1));
console.log(JSON.stringify({ totals: result.totals, groups: Object.fromEntries(Object.entries(groups).sort((a, b) => b[1].size - a[1].size)), headers: result.headers, phases: result.edge?.phases ?? result.edge }, null, 1));
