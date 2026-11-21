// 서버 진입점: HTTP(정적 public/, /health) + WebSocket(/ws) + 60Hz 게임 루프
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadData } from './engine/index.js';
import { mono, loadLimits } from './net/limits.js';
import { createStaticHandler } from './net/static.js';
import { createInviteHandler } from './net/invite_og.js';
import { BotGuard, loadBotguardConfig } from './net/botguard.js';
import { resolveClientIp } from './net/clientip.js';
import { Lobby } from './lobby/lobby.js';
import { JsonlResultStore } from './store/results.js';
import { SqliteProgressStore } from './store/progress.js';
import { SqliteLeagueStore } from './store/league.js';
import { SqliteFlameStore } from './store/flame.js';
import { openDb, sqliteAvailable, SQLITE_MISSING } from './store/db.js';
import { importJson } from './store/migrate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_MSG_PER_SEC = 240;

export function createServer(opts = {}) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const data = opts.data ?? loadData();
  const store = opts.store ?? new JsonlResultStore(process.env.RESULTS_PATH ?? path.join(root, 'data/results/results.jsonl'));
  // SQLite(계정·진행·리그·랭킹). 경로 DB_PATH, 기본 data/tongki.db. node --test 안에서는 실데이터 보호를 위해 기본이 메모리 DB
  const dbFile = opts.dbPath ?? process.env.DB_PATH ?? (process.env.NODE_TEST_CONTEXT ? ':memory:' : path.join(root, 'data/tongki.db'));
  const db = opts.db ?? openDb(dbFile);
  // 기존 JSON 저장을 한 번 가져온다(멱등, 원본 보존 + data/backup/json_before_sqlite/ 에 사본). 메모리 DB 는 opts.importJson 으로만
  if (opts.importJson ?? dbFile !== ':memory:') {
    importJson(db, {
      progressFile: process.env.PROGRESS_PATH ?? path.join(root, 'data/progress/progress.json'),
      leagueFile: process.env.LEAGUE_PATH ?? path.join(root, 'data/progress/league.json'),
      backupDir: process.env.JSON_BACKUP_DIR ?? path.join(dbFile === ':memory:' ? path.join(root, 'data') : path.dirname(dbFile), 'backup', 'json_before_sqlite'),
    });
  }
  const progress = opts.progress ?? new SqliteProgressStore(db);
  const leagues = opts.leagues ?? new SqliteLeagueStore(db);
  const flame = opts.flame ?? new SqliteFlameStore(db); // 불꽃의 계승 영구·도전 저장(PROTOCOL §13.6)
  const limits = loadLimits(process.env, opts.limits);
  const requireAccount = opts.requireAccount ?? process.env.REQUIRE_ACCOUNT === '1';
  // 채팅·공지(PROTOCOL §14): 관리자 = ADMIN_ACCOUNTS(쉼표 목록, 빈 값 = 공지 꺼짐). 공지 기록 = NOTICE_PATH, 기본 data/notices.jsonl(node --test 안에서는 실데이터 보호로 기록하지 않는다)
  const admins = opts.admins ?? limits.adminAccounts;
  const noticePath = opts.noticePath !== undefined ? opts.noticePath : limits.noticePath ? path.resolve(root, limits.noticePath) : process.env.NODE_TEST_CONTEXT ? null : path.join(root, 'data/notices.jsonl');
  // 봇 탐지·임시 차단(server/net/botguard.js, HANDOFF §19). 재시작 없이 면제 = BOTGUARD_ALLOW_FILE, 기본 data/botguard_allow.txt(node --test 안에서는 없음)
  const bgCfg = loadBotguardConfig(process.env, opts.botguardCfg);
  if (!bgCfg.allowFile && !process.env.NODE_TEST_CONTEXT) bgCfg.allowFile = path.join(root, 'data/botguard_allow.txt');
  else if (bgCfg.allowFile) bgCfg.allowFile = path.resolve(root, bgCfg.allowFile);
  const botguard = opts.botguard ?? new BotGuard(bgCfg, { log: opts.log });
  const lobby = new Lobby({ botguard, data, store, progress, leagues, flame, flameSeed: opts.flameSeed, db, requireAccount, leagueRand: opts.leagueRand, build: pkg.version, graceMs: opts.graceMs, limits, seed: opts.seed, log: opts.log, admins, noticePath });
  const publicDir = path.join(root, 'public');
  const serveStatic = createStaticHandler(publicDir, { cacheBytes: opts.staticCacheBytes });
  const serveInvite = createInviteHandler(path.join(publicDir, 'index.html'), lobby, { perMin: limits.maxInvitePreviewPerMin });
  // IP 판정(server/net/clientip.js, HANDOFF §20): TRUST_PROXY 없음 = 루프백(프록시)에서 온 연결만 XFF 마지막 값, '0' = 끔, 그 밖 = 항상 신뢰
  const log = opts.log ?? ((...a) => console.error(...a));
  let proxyWarned = false;
  const clientIp = (req) => {
    const r = resolveClientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], process.env.TRUST_PROXY);
    if (r.viaXff && !proxyWarned) { proxyWarned = true; log('[proxy] 루프백(프록시)에서 X-Forwarded-For 감지: 실제 IP 로 자동 인식합니다'); }
    return r.ip;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, build: pkg.version, ...lobby.stats(), botguard: botguard.summary() }));
        return;
      }
      // 초대 링크 미리보기: `/?room=` 만(og 메타 주입·no-store, server/net/invite_og.js). 쿼리 없는 `/` 는 종전 정적 응답 그대로
      if (u.pathname === '/' && u.searchParams.has('room')) { await serveInvite(req, res, u.searchParams.get('room'), clientIp(req)); return; }
      await serveStatic(req, res, u.pathname); // 압축·캐시 헤더·304·Range·차단 목록: server/net/static.js
    } catch { if (!res.headersSent) res.writeHead(400).end(); else res.destroy(); }
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  const ipConns = new Map();
  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    const conn = {
      session: null, count: 0, winStart: mono(), ip,
      send(m) {
        if (ws.readyState !== 1 || ws.bufferedAmount > 1 << 20) return;
        ws.send(typeof m === 'string' ? m : JSON.stringify(m));
      },
      close(code, reason) { ws.close(code, reason); }, // code 1008 + reason = 클라이언트가 자동 재연결을 길게 늦춘다(public/js/net.js)
    };
    const n = (ipConns.get(ip) ?? 0) + 1;
    ipConns.set(ip, n);
    let loginTimer = null;
    const reject = (code) => { lobby.err(conn, code); ws.close(1008, code); };
    // 로그인 타이머: 연결 시점(loginTimeoutMs)과 로그아웃 시점(lobby.logout -> logoutLoginTimeoutMs)마다 새로 건다. 이전 타이머는 취소(중복·조기 종료 없음)
    conn.armLoginTimer = (ms) => {
      clearTimeout(loginTimer);
      loginTimer = null;
      if (conn.closed || conn.rejected) return;
      loginTimer = setTimeout(() => { loginTimer = null; if (!conn.session) reject('LOGIN_TIMEOUT'); }, ms);
      loginTimer.unref?.();
    };
    // 업그레이드 단계는 점수 누적·Origin 검사만(Origin 불일치 = 오류 없이 close 1008). 차단 중 IP 판정은 hello·login 의 lobby.bgGate(경기 중 세션 재접속 예외)
    const bg = n > limits.maxConnPerIp ? { ok: true } : botguard.checkUpgrade(ip, req.headers);
    if (n > limits.maxConnPerIp) { reject('TOO_MANY_CONNECTIONS'); conn.rejected = true; }
    else if (!bg.ok) { ws.close(1008); conn.rejected = true; }
    else conn.armLoginTimer(limits.loginTimeoutMs);
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
      conn.closed = true; // 진행 중인 가입·로그인(비동기)이 닫힌 연결에 세션을 붙이지 않게
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
    server, wss, lobby, db, botguard,
    listen: (port = Number(process.env.PORT ?? 3100)) => new Promise((r) => server.listen(port, () => r(server.address().port))),
    close: () => new Promise((r) => {
      clearInterval(loop); clearInterval(ping);
      for (const c of wss.clients) c.terminate();
      wss.close(() => server.close(() => { if (!opts.db) db.close(); r(); }));
    }),
  };
}

// 직접 실행(node server/index.js, npm start) 또는 pm2 실행일 때만 시작한다. import 시에는 시작하지 않는다.
// pm2 는 argv[1] 이 자체 래퍼(ProcessContainerFork.js)라서, pm2 가 넣어 주는 pm_exec_path 로도 판정한다.
const selfPath = fileURLToPath(import.meta.url);
const isEntry = [process.argv[1], process.env.pm_exec_path].some((p) => p && path.resolve(p) === selfPath);
if (isEntry) {
  if (!sqliteAvailable()) { console.error(`[dodge-danpei] ${SQLITE_MISSING}`); process.exit(1); }
  let app;
  try { app = createServer(); } catch (e) { if (e?.code !== 'MIGRATION_GATED') throw e; console.error(`[dodge-danpei] ${e.message}`); process.exit(1); }
  app.listen().then((p) => console.log(`[dodge-danpei] listening :${p}`));
  process.on('uncaughtException', (e) => console.error('[uncaught]', e));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { app.lobby.progress.flush?.(); app.lobby.leagues.flush?.(); app.db.close(); process.exit(0); });
}
