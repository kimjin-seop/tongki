// 채팅·관리자 공지(PROTOCOL §14). makeChatHandlers 는 Lobby.makeHandlers 에 섞여 this = Lobby 로 불린다(리그·불꽃 처리기와 같은 패턴).
// 채팅 = 사람끼리 방(대기실·경기 중) 좌석 두 사람에게만. 로비 전체 채팅은 없다. 공지 = 관리자 계정만, 접속 중인 세션 전원에게.
// 서버는 글을 정리(제어·0폭·양방향 제어 문자 제거, NFC, 공백 축약, 길이)만 하고 HTML 이스케이프는 하지 않는다 — 화면은 textContent 로만 그린다
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mono } from '../net/limits.js';

const BADWORDS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/chat_badwords.json');
// 공백으로 바꾸는 문자: C0·DEL·C1 제어, 0폭·방향 표식(U+200B~200F), 양방향 덮어쓰기(U+202A~202E), 양방향 격리(U+2066~2069), BOM/0폭 비분리(U+FEFF), 짝 없는 대리 문자
const STRIP_RE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]|\p{Cs}/gu;
// 공지 빈도(고정, analysis/49): 3초에 1개 · 분당 10개
const NOTICE_GAP_MS = 3000, NOTICE_PER_MIN = 10;

/** 채팅이 되는 방인가: 사람끼리 방(일반·불꽃 팀 허용·래더). 컴퓨터 대전·스토리·특훈·리그·불꽃 도전 방과 로비(room 없음)는 아니다 */
export const chatRoom = (room) => !!room && !room.vsCpu && !room.campaign && !room.training && !room.league && !room.flame;

/** ADMIN_ACCOUNTS(쉼표 문자열 또는 배열) -> 소문자 NFC 키 Set. 빈 값 = 빈 Set(공지 꺼짐) */
export function parseAdmins(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(',');
  return new Set(list.map((x) => String(x).normalize('NFC').trim().toLowerCase()).filter(Boolean));
}

/** 관리자 판정(요청마다 다시 부른다): 비밀번호 계정 세션 + 키가 목록에 있음. 클라이언트가 보낸 값은 보지 않는다 */
export const isAdmin = (lobby, s) => s?.account === true && !!lobby.admins?.has(s.key) && !lobby.guestOfAccount(s);

/** 글 정리. 반환 {text} 또는 {code, params}. 길이 = 정리 후 코드포인트 수 */
export function cleanText(v, max) {
  if (typeof v !== 'string') return { code: 'BAD_MESSAGE' };
  const t = v.replace(STRIP_RE, ' ').normalize('NFC').replace(STRIP_RE, ' ').replace(/\s+/gu, ' ').trim();
  const n = [...t].length;
  if (!n) return { code: 'CHAT_EMPTY' };
  if (n > max) return { code: 'CHAT_TOO_LONG', params: { max } };
  return { text: t };
}

/** 욕설 목록 -> 정규식(긴 단어 먼저, 대소문자 무시). 빈 목록 = null */
export function compileBadwords(words) {
  const list = [...new Set((Array.isArray(words) ? words : []).filter((w) => typeof w === 'string').map((w) => w.normalize('NFC').trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return null;
  list.sort((a, b) => b.length - a.length);
  return new RegExp(list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
}

export function loadBadwords(log, file = BADWORDS_FILE) {
  try { return compileBadwords(JSON.parse(readFileSync(file, 'utf8')).words); } catch (e) { log?.('[chat] 욕설 목록을 읽지 못해 가림 없이 시작', e?.message ?? e); return null; }
}

/** 욕설 가림: 들어 있는 단어의 글자마다 * (거절하지 않는다) */
export const maskBadwords = (text, re) => (re ? text.replace(re, (w) => '*'.repeat([...w].length)) : text);

/** Lobby 생성자에서 1회: 관리자 목록·공지 기록 경로·욕설 목록·공지 번호 */
export function initChat(lobby, o) {
  // 목록 전체(adminNames)는 가입 거절용(lobby.register -> NICK_TAKEN). 관리자(admins)는 서버 시작 때 이미 가입돼 있는 항목만(나중 가입으로 승격 없음, PROTOCOL §14.2)
  lobby.adminNames = parseAdmins(o.admins ?? lobby.limits.adminAccounts);
  lobby.admins = new Set();
  for (const k of lobby.adminNames) {
    const r = lobby.accounts?.db?.get?.('SELECT nick, created_at FROM accounts WHERE key = ?', k);
    if (r) { lobby.admins.add(k); lobby.log(`[admin] 관리자 계정 확인: ${r.nick} (가입 ${new Date(r.created_at).toISOString()})`); }
    else lobby.log(`[admin] 경고: ADMIN_ACCOUNTS 의 '${k}' 는 가입된 계정이 없어 비활성(이 닉네임 가입은 거절된다. 먼저 가입한 뒤 목록에 넣고 재시작)`);
  }
  lobby.noticePath = o.noticePath ?? null; // null = 파일 기록 없음(서버 로그만)
  lobby.chatBad = o.chatBadwords !== undefined ? compileBadwords(o.chatBadwords) : loadBadwords(lobby.log);
  lobby.noticeSeq = 0;
  if (lobby.admins.size) lobby.log(`[admin] 관리자 계정 ${lobby.admins.size}개로 공지 켜짐`);
}

function chatRate(lobby, s, text, fail) {
  const L = lobby.limits, now = mono();
  const w = s.chatWin ?? (s.chatWin = { times: [], lastAt: -Infinity, last: null, same: 0 });
  w.times = w.times.filter((t) => now - t < L.chatWindowMs);
  if (now - w.lastAt < L.chatMinGapMs) fail('CHAT_RATE_LIMITED');
  if (w.times.length >= L.chatBurst) fail('CHAT_RATE_LIMITED');
  if (text === w.last && w.same >= 2) fail('CHAT_RATE_LIMITED'); // 같은 내용 연속 3회째
  w.times.push(now); w.lastAt = now;
  w.same = text === w.last ? w.same + 1 : 1; w.last = text;
}

function noticeRate(s, fail) {
  const now = mono();
  const w = s.noticeWin ?? (s.noticeWin = { times: [], lastAt: -Infinity });
  w.times = w.times.filter((t) => now - t < 60000);
  if (now - w.lastAt < NOTICE_GAP_MS || w.times.length >= NOTICE_PER_MIN) fail('NOTICE_RATE_LIMITED');
  w.times.push(now); w.lastAt = now;
}

function recordNotice(lobby, rec) {
  lobby.log(`[notice] #${rec.id} ${rec.by}: ${JSON.stringify(rec.text)}`);
  if (!lobby.noticePath) return;
  try {
    mkdirSync(path.dirname(lobby.noticePath), { recursive: true });
    appendFileSync(lobby.noticePath, JSON.stringify({ at: rec.at, by: rec.by, text: rec.text }) + '\n');
  } catch (e) { lobby.log('[notice] 기록 실패', e?.message ?? e); } // 기록 실패해도 공지는 보낸다
}

export function makeChatHandlers(fail) {
  const clean = (v, max) => { const r = cleanText(v, max); if (r.code) fail(r.code, r.params); return r.text; };
  return {
    // {t:'chat', text}: 사람끼리 방 좌석 두 사람(본인 포함)에게 {t:'chat', from, text, at, admin?}
    chat(s, m) {
      const room = this.roomOf(s);
      if (!chatRoom(room)) fail('CHAT_UNAVAILABLE');
      if (!s.account && !this.limits.chatGuest) fail('ACCOUNT_REQUIRED');
      const text = clean(m.text, this.limits.chatMax);
      chatRate(this, s, text, fail);
      const out = { t: 'chat', from: s.nick, text: maskBadwords(text, this.chatBad), at: Date.now(), ...(isAdmin(this, s) ? { admin: true } : {}) };
      for (const mm of room.seats) if (mm) this.sendTo(mm.s, out);
    },
    // {t:'notice_send', text}: 관리자만. 접속 중인 세션 전원(로비·대기실·모든 경기 중, 유예 중 제외)에게 {t:'notice', id, text, at}. 재전송 없음
    notice_send(s, m) {
      if (!isAdmin(this, s)) fail('NOT_ADMIN');
      const text = clean(m.text, this.limits.noticeMax);
      noticeRate(s, fail);
      const rec = { id: ++this.noticeSeq, at: Date.now(), by: s.key, text };
      recordNotice(this, rec);
      const out = JSON.stringify({ t: 'notice', id: rec.id, text, at: rec.at });
      for (const ss of this.sessions.values()) if (ss.conn) this.sendTo(ss, out);
    },
  };
}
