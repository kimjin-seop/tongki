// 채팅·관리자 공지(PROTOCOL §14) 핵심 시험: 사람끼리 방 2명만 수신·그 밖 CHAT_UNAVAILABLE, 관리자 판정·공지 전원 전달, 길이·빈도·문자 정리, 공지 원문 전달, 래더 방 채팅
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { MemoryResultStore } from '../server/store/results.js';
import { cleanText, compileBadwords, maskBadwords } from '../server/chat/chat.js';
import { openDb } from '../server/store/db.js';
import { AccountStore } from '../server/store/accounts.js';

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const q = [], waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].res(m); else q.push(m);
  });
  const open = new Promise((r) => ws.on('open', r));
  return {
    open, ws, q, send: (o) => ws.send(JSON.stringify(o)),
    wait(pred, ms = 5000) {
      const i = q.findIndex(pred);
      if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]);
      return new Promise((res, rej) => { waiters.push({ pred, res }); setTimeout(() => rej(new Error('timeout')), ms).unref(); });
    },
    type(t, ms) { return this.wait((m) => m.t === t, ms); },
    async err(m) { this.send(m); return (await this.type('error')).code; },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (o = {}) => createServer({ store: new MemoryResultStore(), limits: { maxAuthPerMin: 100, maxHelloPerMin: 1000 }, log: () => {}, ...o });
async function clients(port, n) { const cs = Array.from({ length: n }, () => client(port)); await Promise.all(cs.map((c) => c.open)); return cs; }
const hello = async (c, nickname) => { c.send({ t: 'hello', nickname }); return c.type('welcome'); };
const reg = async (c, nickname) => { c.send({ t: 'register', nickname, password: 'pass1234' }); return c.type('welcome'); };
const login = async (c, nickname) => { c.send({ t: 'login', nickname, password: 'pass1234' }); return c.type('welcome'); };
/** 관리자 계정은 서버 시작 전에 가입돼 있어야 한다(M1): 미리 만든 메모리 DB 로 서버를 띄운다 */
async function mkWithAccounts(nicks, o) { const db = openDb(':memory:'), acc = new AccountStore(db); for (const n of nicks) await acc.create(n, 'pass1234'); return mk({ db, ...o }); }
/** a 가 방을 만들고 b 가 들어온다. start=true 면 경기 시작까지 */
async function pair(a, b, start = false) {
  a.send({ t: 'create_room' }); const { room } = await a.type('room_joined');
  b.send({ t: 'join_room', code: room.code }); const j = await b.type('room_joined');
  if (start) { b.send({ t: 'ready', ready: true }); await a.wait((m) => m.t === 'room_state' && m.room.start.ok); a.send({ t: 'start' }); await a.type('game_start'); await b.type('game_start'); }
  return j.room;
}

test('채팅: 사람끼리 방(대기실·경기 중) 좌석 두 사람만 받는다, 로비·컴퓨터 대전·스토리는 CHAT_UNAVAILABLE', async () => {
  const app = mk(), port = await app.listen(0);
  const [a, b, c, d] = await clients(port, 4);
  try {
    for (const [x, n] of [[a, '채팅A'], [b, '채팅B'], [c, '채팅C'], [d, '채팅D']]) await hello(x, n);
    const room = await pair(a, b);
    assert.equal(room.chat, true);
    a.send({ t: 'chat', text: '안녕' });
    for (const x of [a, b]) assert.deepEqual((({ t, from, text }) => ({ t, from, text }))(await x.type('chat')), { t: 'chat', from: '채팅A', text: '안녕' });
    assert.equal(await c.err({ t: 'chat', text: '로비' }), 'CHAT_UNAVAILABLE'); // 로비 전체 채팅 없음
    c.send({ t: 'create_room', vsCpu: true }); const cpu = await c.type('room_joined');
    assert.equal(cpu.room.chat, undefined);
    assert.equal(await c.err({ t: 'chat', text: 'cpu' }), 'CHAT_UNAVAILABLE');
    d.send({ t: 'campaign_start', k: 0 }); await d.type('game_start');
    assert.equal(await d.err({ t: 'chat', text: 'story' }), 'CHAT_UNAVAILABLE');
    // 경기 중
    await sleep(1050);
    b.send({ t: 'ready', ready: true }); await a.wait((m) => m.t === 'room_state' && m.room.start.ok);
    a.send({ t: 'start' }); await b.type('game_start');
    b.send({ t: 'chat', text: '경기 중' });
    assert.equal((await a.type('chat')).text, '경기 중');
    assert.equal((await b.type('chat')).from, '채팅B');
    await sleep(100);
    assert.equal([c, d].some((x) => x.q.some((m) => m.t === 'chat')), false); // 방 밖 사람은 못 받는다
  } finally { for (const x of [a, b, c, d]) x.ws.close(); await app.close(); }
});

test('관리자: ADMIN_ACCOUNTS 계정만 admin:true, 공지는 로비·사람끼리 경기·컴퓨터 경기 전원에게, 일반 계정·손님 NOT_ADMIN', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tongki-notice-')), noticePath = path.join(dir, 'notices.jsonl');
  const app = await mkWithAccounts(['운영자'], { admins: ' 운영자 ,다른관리', noticePath }), port = await app.listen(0);
  const [boss, n, g, h, p1, p2, q] = await clients(port, 7);
  try {
    assert.equal((await login(boss, '운영자')).admin, true);
    const wn = await reg(n, '일반계정');
    assert.equal(wn.admin, undefined);
    assert.equal((await hello(g, '손님G')).admin, undefined);
    assert.equal(await h.err({ t: 'hello', nickname: '운영자' }), 'NICK_REGISTERED'); // 손님이 관리자 닉네임으로 못 들어온다
    await hello(p1, '사람P1'); await hello(p2, '사람P2'); await pair(p1, p2, true);
    await hello(q, '컴퓨터Q'); q.send({ t: 'create_room', vsCpu: true }); await q.type('room_joined'); q.send({ t: 'start' }); await q.type('game_start');
    assert.equal(await n.err({ t: 'notice_send', text: '가짜 공지' }), 'NOT_ADMIN');
    assert.equal(await g.err({ t: 'notice_send', text: '가짜 공지', admin: true }), 'NOT_ADMIN'); // 클라이언트 값 불신
    boss.send({ t: 'notice_send', text: '  서버   점검 안내 ' });
    const got = await Promise.all([boss, n, g, p1, p2, q].map((x) => x.type('notice')));
    for (const m of got) assert.deepEqual([m.id, m.text], [1, '서버 점검 안내']);
    assert.equal(await boss.err({ t: 'notice_send', text: '또' }), 'NOTICE_RATE_LIMITED'); // 3초에 1개
    const rec = readFileSync(noticePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(rec.map((r) => [r.by, r.text]), [['운영자', '서버 점검 안내']]);
    // 관리자 일반 채팅 줄에는 admin:true
    boss.send({ t: 'create_room' }); const { room } = await boss.type('room_joined');
    n.send({ t: 'join_room', code: room.code }); await n.type('room_joined');
    boss.send({ t: 'chat', text: '관리자' });
    assert.equal((await n.type('chat')).admin, true);
    n.send({ t: 'chat', text: '일반' });
    assert.equal((await boss.wait((m) => m.t === 'chat' && m.text === '일반')).admin, undefined);
  } finally { for (const x of [boss, n, g, h, p1, p2, q]) x.ws.close(); await app.close(); }
});

test('채팅 정리: 61자 CHAT_TOO_LONG, 1초 안 연속 CHAT_RATE_LIMITED, 양방향·0폭 문자 제거, 욕설 가림, CHAT_GUEST=0 이면 ACCOUNT_REQUIRED', async () => {
  assert.deepEqual(cleanText('a‮b​c⁦d﻿\u0007', 60), { text: 'a b c d' });
  assert.deepEqual(cleanText(' ​\t ', 60), { code: 'CHAT_EMPTY' });
  assert.equal(cleanText('가', 60).text, '가'); // NFC
  assert.equal(maskBadwords('너 씨발 FUCK', compileBadwords(['씨발', 'fuck'])), '너 ** ****');
  const app = mk(), port = await app.listen(0);
  const [a, b] = await clients(port, 2);
  try {
    await hello(a, '정리A'); await hello(b, '정리B'); await pair(a, b);
    a.send({ t: 'chat', text: '가'.repeat(61) });
    const e = await a.type('error');
    assert.deepEqual([e.code, e.params], ['CHAT_TOO_LONG', { max: 60 }]);
    a.send({ t: 'chat', text: '가'.repeat(60) }); assert.equal([...(await b.type('chat')).text].length, 60);
    assert.equal(await a.err({ t: 'chat', text: '바로 또' }), 'CHAT_RATE_LIMITED');
    await sleep(1050);
    a.send({ t: 'chat', text: '오른‮쪽‏ 글' });
    assert.equal((await b.wait((m) => m.t === 'chat' && m.from === '정리A' && m.text.startsWith('오른'))).text, '오른 쪽 글');
    app.lobby.limits.chatGuest = false;
    assert.equal(await b.err({ t: 'chat', text: '손님' }), 'ACCOUNT_REQUIRED');
  } finally { a.ws.close(); b.ws.close(); await app.close(); }
});

test('공지·채팅: XSS 문자열을 서버가 바꾸지 않고 원문 그대로 보낸다(화면이 textContent 로 그린다)', async () => {
  const app = await mkWithAccounts(['Boss2'], { admins: 'boss2', noticePath: null }), port = await app.listen(0);
  const [boss, x] = await clients(port, 2);
  const evil = '<img src=x onerror="alert(1)">&amp;\'"</script>';
  try {
    await login(boss, 'Boss2'); await hello(x, '보는이');
    boss.send({ t: 'notice_send', text: evil });
    assert.equal((await x.type('notice')).text, evil);
    await pair(boss, x);
    boss.send({ t: 'chat', text: evil });
    assert.equal((await x.type('chat')).text, evil);
  } finally { boss.ws.close(); x.ws.close(); await app.close(); }
});

test('래더 방(경기 전·경기 중)에서 채팅할 수 있다', async () => {
  const app = mk(), port = await app.listen(0);
  const [a, c] = await clients(port, 2);
  try {
    await reg(a, '래더챗A'); await reg(c, '래더챗C');
    a.send({ t: 'ladder_join' }); c.send({ t: 'ladder_join' });
    await a.type('ladder_matched'); const { room } = await a.type('room_joined'); await c.type('room_joined');
    assert.deepEqual([room.ranked, !!room.ladder, room.chat], [true, true, true]);
    a.send({ t: 'chat', text: '잘 부탁' });
    assert.equal((await c.type('chat')).text, '잘 부탁');
    const seat1 = room.slots[1].nick === '래더챗C' ? c : a, host = seat1 === c ? a : c;
    seat1.send({ t: 'ready', ready: true }); await host.wait((m) => m.t === 'room_state' && m.room.start.ok);
    host.send({ t: 'start' }); await c.type('game_start');
    c.send({ t: 'chat', text: '경기 중' });
    assert.equal((await a.wait((m) => m.t === 'chat' && m.text === '경기 중')).from, '래더챗C');
  } finally { a.ws.close(); c.ws.close(); await app.close(); }
});

test('관리자 미가입(M1): 시작 때 가입 안 된 목록 닉네임은 경고·비활성, 그 닉네임 가입은 NICK_TAKEN, 나중에 생긴 계정도 승격 없음. 가입된 항목은 가입 시각을 로그', async () => {
  const logs = [];
  const app = await mkWithAccounts(['운영자'], { admins: '운영자,미가입관리', noticePath: null, log: (...a) => logs.push(a.join(' ')) });
  const port = await app.listen(0);
  const [a, b] = await clients(port, 2);
  try {
    assert.ok(logs.some((l) => l.includes('관리자 계정 확인: 운영자 (가입 ')));
    assert.ok(logs.some((l) => l.includes("'미가입관리'") && l.includes('비활성')));
    assert.deepEqual([...app.lobby.admins], ['운영자']);
    a.send({ t: 'register', nickname: '미가입관리', password: 'pass1234' });
    assert.equal((await a.type('error')).code, 'NICK_TAKEN');
    await app.lobby.accounts.create('미가입관리', 'pass1234'); // 다른 경로로 계정이 생겨도(재시작 전) 관리자가 아니다
    const w = await login(b, '미가입관리');
    assert.equal(w.admin, undefined);
    assert.equal(await b.err({ t: 'notice_send', text: '공지' }), 'NOT_ADMIN');
  } finally { a.ws.close(); b.ws.close(); await app.close(); }
});
