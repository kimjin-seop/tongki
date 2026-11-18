// 서버 진입점: HTTP(정적 public/, /health) + WebSocket(/ws) + 60Hz 게임 루프
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadData } from './engine/index.js';
import { mono, loadLimits } from './net/limits.js';
import { Lobby } from './lobby/lobby.js';
import { JsonlResultStore } from './store/results.js';
import { JsonProgressStore } from './store/progress.js';
import { JsonLeagueStore } from './store/league.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};
const MAX_MSG_PER_SEC = 240;

export function createServer(opts = {}) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const data = opts.data ?? loadData();
  const store = opts.store ?? new JsonlResultStore(process.env.RESULTS_PATH ?? path.join(root, 'data/results/results.jsonl'));
  const progress = opts.progress ?? new JsonProgressStore(process.env.PROGRESS_PATH ?? path.join(root, 'data/progress/progress.json'));
  const leagues = opts.leagues ?? new JsonLeagueStore(process.env.LEAGUE_PATH ?? path.join(root, 'data/progress/league.json'));
  const limits = loadLimits(process.env, opts.limits);
  const lobby = new Lobby({ data, store, progress, leagues, leagueRand: opts.leagueRand, build: pkg.version, graceMs: opts.graceMs, limits, seed: opts.seed, log: opts.log });
  const publicDir = path.join(root, 'public');

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, build: pkg.version, ...lobby.stats() }));
        return;
      }
      let rel = decodeURIComponent(u.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(publicDir, rel);
      if (!file.startsWith(publicDir + path.sep)) { res.writeHead(403).end(); return; }
      const st = await stat(file).catch(() => null);
      if (!st?.isFile()) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    } catch { res.writeHead(400).end(); }
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  const ipConns = new Map();
  const clientIp = (req) => {
    if (process.env.TRUST_PROXY) { // 신뢰 프록시가 덧붙인 마지막 값을 사용
      const xf = String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim();
      if (xf) return xf;
    }
    return req.socket.remoteAddress ?? '';
  };
  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    const conn = {
      session: null, count: 0, winStart: mono(), ip,
      send(m) {
        if (ws.readyState !== 1 || ws.bufferedAmount > 1 << 20) return;
        ws.send(typeof m === 'string' ? m : JSON.stringify(m));
      },
      close() { ws.close(); },
    };
    const n = (ipConns.get(ip) ?? 0) + 1;
    ipConns.set(ip, n);
    let loginTimer = null;
    const reject = (code) => { lobby.err(conn, code); ws.close(1008, code); };
    if (n > limits.maxConnPerIp) { reject('TOO_MANY_CONNECTIONS'); conn.rejected = true; }
    else {
      loginTimer = setTimeout(() => { if (!conn.session) reject('LOGIN_TIMEOUT'); }, limits.loginTimeoutMs);
      loginTimer.unref?.();
    }
    ws.on('message', (raw) => {
      if (conn.rejected) return;
      try {
        const now = mono();
        if (now - conn.winStart >= 1000) { conn.winStart = now; conn.count = 0; }
        if (++conn.count > MAX_MSG_PER_SEC) { if (conn.count === MAX_MSG_PER_SEC + 1) lobby.err(conn, 'RATE_LIMITED'); return; }
        let msg;
        try { msg = JSON.parse(raw.toString('utf8')); } catch { lobby.err(conn, 'BAD_MESSAGE'); return; }
        lobby.onMessage(conn, msg);
      } catch (e) { console.error('[ws message]', e); }
    });
    ws.on('close', () => {
      clearTimeout(loginTimer);
      const c = (ipConns.get(ip) ?? 1) - 1;
      if (c <= 0) ipConns.delete(ip); else ipConns.set(ip, c);
      if (conn.rejected) return;
      try { lobby.onClose(conn); } catch (e) { console.error(e); } });
    ws.on('error', () => {});
  });

  const loop = setInterval(() => lobby.tickGames(mono()), 5);
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.dead) { ws.terminate(); continue; }
      ws.dead = true; ws.once('pong', () => { ws.dead = false; }); ws.ping();
    }
  }, 15000);
  loop.unref?.(); ping.unref?.();

  return {
    server, wss, lobby,
    listen: (port = Number(process.env.PORT ?? 3100)) => new Promise((r) => server.listen(port, () => r(server.address().port))),
    close: () => new Promise((r) => {
      clearInterval(loop); clearInterval(ping);
      for (const c of wss.clients) c.terminate();
      wss.close(() => server.close(() => r()));
    }),
  };
}

// 직접 실행(node server/index.js, npm start) 또는 pm2 실행일 때만 시작한다. import 시에는 시작하지 않는다.
// pm2 는 argv[1] 이 자체 래퍼(ProcessContainerFork.js)라서, pm2 가 넣어 주는 pm_exec_path 로도 판정한다.
const selfPath = fileURLToPath(import.meta.url);
const isEntry = [process.argv[1], process.env.pm_exec_path].some((p) => p && path.resolve(p) === selfPath);
if (isEntry) {
  const app = createServer();
  app.listen().then((p) => console.log(`[dodge-danpei] listening :${p}`));
  process.on('uncaughtException', (e) => console.error('[uncaught]', e));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { app.lobby.progress.flush?.(); app.lobby.leagues.flush?.(); process.exit(0); });
}
