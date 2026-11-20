// 측정 전용(analysis/51): 녹화한 실제 snap 원문을 별도의 임시 ws 서버(이 파일 안, 게임 서버 아님)로 60Hz 재생해
// permessage-deflate 켬/끔별 서버 CPU·실제 송신 바이트(socket.bytesWritten)·송신->수신 지연을 잰다. 게임 서버 코드는 그대로.
// 클라이언트는 자식 프로세스(같은 파일 --client)로 띄워 압축 해제 CPU 가 서버 측 수치에 섞이지 않게 한다.
// 사용: node tools/deflate_replay.mjs --snaps <x.snaps.jsonl> --out <결과.json> [--port 3400] [--sec 10] [--clients 2,100,200]
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import * as fsx from 'node:fs';
// --out 가 이미 디렉터리면(실행 환경이 경로를 미리 만드는 경우) 그 안의 result.json 에 쓴다
const outFile = (p) => (fsx.existsSync(p) && fsx.statSync(p).isDirectory() ? p.replace(/[\/]+$/, '') + '/result.json' : p);

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', 3400));
const now = () => performance.timeOrigin + performance.now();
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(3); };

if (process.argv.includes('--client')) { // 자식: N 개 연결, 받은 메시지 번호(k)별 수신 시각 -> 부모가 보낸 시각과 비교
  const n = Number(arg('n', 2)), deflate = arg('deflate', '1') === '1';
  const lat = []; let open = 0, bytes = 0;
  const conns = [];
  for (let i = 0; i < n; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`, { perMessageDeflate: deflate });
    ws.on('open', () => { if (++open === n) process.send({ ready: true }); });
    ws.on('message', (raw) => { const t = now(); const s = raw.toString(); bytes += s.length; const k = s.indexOf('"k":'); if (k > 0 && i < 4) lat.push([Number(s.slice(k + 4, s.indexOf(',', k))), t]); });
    conns.push(ws);
  }
  process.on('message', (m) => { if (m.done) { process.send({ lat, bytes }); for (const c of conns) c.terminate(); setTimeout(() => process.exit(0), 200); } });
} else {
  const SEC = Number(arg('sec', 10));
  const CLIENTS = arg('clients', '2,100,200').split(',').map(Number);
  const raw = readFileSync(arg('snaps'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).s);
  const MODES = {
    off: false,
    deflate_default: { threshold: 1024 }, // ws 기본값 그대로(1KB 미만은 압축 안 함) — 지금 snap(약 700B)은 거의 다 그대로 나간다
    deflate_t0: { threshold: 0 }, // 전부 압축, zlib 기본(레벨 -1=6, memLevel 8, windowBits 15), 문맥 유지
    deflate_t0_l1: { threshold: 0, zlibDeflateOptions: { level: 1 } },
    deflate_t0_noctx: { threshold: 0, serverNoContextTakeover: true, clientNoContextTakeover: true },
  };
  const results = [];
  for (const n of CLIENTS) {
    for (const [mode, pmd] of Object.entries(MODES)) {
      const server = http.createServer();
      const wss = new WebSocketServer({ server, perMessageDeflate: pmd });
      await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--client', '--n', String(n), '--port', String(PORT), '--deflate', pmd ? '1' : '0'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      await new Promise((r) => child.on('message', (m) => m.ready && r()));
      const sockets = [...wss.clients];
      const sentAt = [];
      // snap 원문에 메시지 번호 k 를 붙여 보낸다(앞쪽 7바이트 증가, 압축률 영향은 미미). 두 좌석이 같은 문자열을 받는 서버 동작을 따라 모든 연결에 같은 문자열
      const c0 = process.cpuUsage(); const b0 = sockets.reduce((a, w) => a + w._socket.bytesWritten, 0);
      let k = 0, next = performance.now();
      const frames = SEC * 60;
      await new Promise((res) => {
        const loop = setInterval(() => {
          const t = performance.now();
          while (next <= t && k < frames) {
            next += 1000 / 60;
            const s = raw[k % raw.length].replace('{"t":"snap",', `{"t":"snap","k":${k},`);
            sentAt[k] = now();
            for (const w of sockets) if (w.readyState === 1 && w.bufferedAmount < (1 << 20)) w.send(s);
            k++;
          }
          if (k >= frames) { clearInterval(loop); setTimeout(res, 500); }
        }, 5);
      });
      const cpu = process.cpuUsage(c0);
      const wire = sockets.reduce((a, w) => a + w._socket.bytesWritten, 0) - b0;
      const fromChild = await new Promise((r) => { child.on('message', (m) => m.lat && r(m)); child.send({ done: true }); });
      const lat = fromChild.lat.map(([kk, t]) => t - sentAt[kk]).filter((x) => Number.isFinite(x));
      const r = { clients: n, mode, sec: SEC, serverCpuPct: +(((cpu.user + cpu.system) / 1e6) / SEC * 100).toFixed(1), wireBytesPerClientPerSec: Math.round(wire / n / SEC),
        cpuUsPerMsg: +((cpu.user + cpu.system) / (frames * n)).toFixed(2), latencyMs: { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: lat.length ? +Math.max(...lat).toFixed(2) : null, n: lat.length } };
      results.push(r); console.log(JSON.stringify(r));
      for (const w of wss.clients) w.terminate();
      await new Promise((rr) => wss.close(() => server.close(rr)));
      await new Promise((rr) => setTimeout(rr, 500));
    }
  }
  const out = arg('out', null);
  if (out) writeFileSync(outFile(out), JSON.stringify({ at: new Date().toISOString(), node: process.version, platform: process.platform, snapsFile: arg('snaps'), results }, null, 1));
}
