// 측정 전용(analysis/51 로비): 임시 서버(포트 3400, DB_PATH=:memory:)에 로비 손님 L 명을 앉혀 두고, 대기 방 R 개 + 방 생성·삭제 반복(churn)을 걸어
// 로비 1명이 받는 room_list 푸시 횟수·바이트를 잰다. 래더 대기열(계정 2명이 줄에 서 있다가 짝)·채팅 1줄 크기도 함께 잰다. 서버 코드는 그대로.
// 사용: node tools/traffic_lobby_measure.mjs --out <결과.json> [--lobby 40] [--rooms 0,20,60] [--churn 2] [--sec 15]
import { writeFileSync } from 'node:fs';
import { startServer, client } from './traffic_ws_measure.mjs';
import * as fsx from 'node:fs';
// --out 가 이미 디렉터리면(실행 환경이 경로를 미리 만드는 경우) 그 안의 result.json 에 쓴다
const outFile = (p) => (fsx.existsSync(p) && fsx.statSync(p).isDirectory() ? p.replace(/[\/]+$/, '') + '/result.json' : p);

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const L = Number(arg('lobby', 40)), ROOMS = arg('rooms', '0,20,60').split(',').map(Number), CHURN = Number(arg('churn', 2)), SEC = Number(arg('sec', 15));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const nick = (p) => `${p}${(++seq).toString().padStart(4, '0')}`;
async function guest(p) { const c = client(p); await c.open; c.send({ t: 'hello', nickname: nick(p) }); await c.type('welcome'); return c; }
const rl = (c) => c.st.recv.room_list ?? { n: 0, bytes: 0 };

const srv = await startServer(3400);
const out = { at: new Date().toISOString(), lobby: L, churnPerSec: CHURN, sec: SEC, cases: [] };
try {
  const lob = []; for (let i = 0; i < L; i++) lob.push(await guest('lo'));
  const hosts = [];
  for (const R of ROOMS) {
    while (hosts.length < R) { const h = await guest('ho'); h.send({ t: 'create_room', vsCpu: hosts.length % 2 === 0 }); await h.type('room_joined'); hosts.push(h); } // 대기 방(절반 컴퓨터 대전 방)
    await sleep(800);
    const before = lob.map((c) => ({ ...rl(c) }));
    // churn: 초당 CHURN 번 방 변화(만들기/나가기 번갈아). 사람 하나가 만들고 다음 번에 나간다
    const ch = await guest('ch'); let inRoom = false, changes = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < SEC * 1000) {
      if (CHURN > 0) { ch.send(inRoom ? { t: 'leave_room' } : { t: 'create_room' }); inRoom = !inRoom; changes++; }
      await sleep(CHURN > 0 ? 1000 / CHURN : 1000);
    }
    if (inRoom) ch.send({ t: 'leave_room' });
    await sleep(600);
    const d = lob.map((c, i) => ({ n: rl(c).n - before[i].n, bytes: rl(c).bytes - before[i].bytes }));
    const n = d.reduce((a, x) => a + x.n, 0) / L, b = d.reduce((a, x) => a + x.bytes, 0) / L;
    out.cases.push({ rooms: R, changes, pushesPerLobbyUserPerSec: +(n / SEC).toFixed(2), bytesPerLobbyUserPerSec: Math.round(b / SEC), avgListBytes: n ? Math.round(b / n) : 0 });
    console.log(JSON.stringify(out.cases.at(-1)));
    ch.close();
  }
  // 래더 대기열: 계정 2명(레이팅 같은 값) 줄 서기 -> 짝 -> 해산까지 받은 메시지
  const a = client('la'), b = client('lb'); await a.open; await b.open;
  a.send({ t: 'register', nickname: nick('la'), password: 'pw123456' }); await a.type('welcome');
  b.send({ t: 'register', nickname: nick('lb'), password: 'pw123456' }); await b.type('welcome');
  a.send({ t: 'ladder_status' }); const ls = await a.type('ladder_status');
  a.send({ t: 'ladder_board' }); const lb = await a.type('ladder_board');
  a.send({ t: 'pvp_board' }); const pb = await a.type('pvp_board');
  a.send({ t: 'ladder_join' }); await sleep(5000); // 혼자 5초 대기(1초 주기 tickLadder 푸시 확인)
  const q5 = { ...(a.st.recv.ladder_queue ?? {}) };
  b.send({ t: 'ladder_join' }); await a.type('ladder_matched', 8000);
  out.ladder = { statusBytes: JSON.stringify(ls).length, statusUtf8: Buffer.byteLength(JSON.stringify(ls)), boardEmptyBytes: Buffer.byteLength(JSON.stringify(lb)), pvpBoardEmptyBytes: Buffer.byteLength(JSON.stringify(pb)), queueMsgsAlone5s: q5, recvA: a.st.recv };
  // 채팅 1줄(사람끼리 방 두 좌석)
  const ra = await a.wait((m) => m.t === 'room_joined').catch(() => null); void ra;
  a.send({ t: 'chat', text: '안녕하세요 한판 해요' }); const cm = await a.type('chat').catch(() => null);
  out.chat = cm ? { bytes: Buffer.byteLength(JSON.stringify(cm)), sample: cm } : null;
  out.welcomeBytes = lob[0].st.recv.welcome?.bytes;
  console.log(JSON.stringify({ ladder: out.ladder, chat: out.chat }));
  for (const c of [...lob, ...hosts, a, b]) c.close();
} finally { srv.stop(); }
const o = arg('out', null); if (o) writeFileSync(outFile(o), JSON.stringify(out, null, 1));
