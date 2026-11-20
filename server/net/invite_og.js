// 초대 링크 미리보기(`/?room=CODE`): 메신저·SNS 크롤러는 JS 를 실행하지 않으므로 index.html 의 og:*/twitter:* 메타를 서버가 바꿔 준다.
// 방이 대기 중(빈 자리 있는 일반 대전방)이면 「{방장}님과 한판하자!」, 아니면 일반 문구. 쿼리 없는 `/` 는 이 모듈을 거치지 않는다(static.js 그대로).
// 보안 메모: 방 코드는 초대받은 사람만 아는 비밀 링크다. 다만 4자 코드라 열거하면 방 존재·방장 닉네임이 드러나므로
//   IP 당 분당 maxInvitePreviewPerMin 회만 방을 조회하고, 넘으면 방을 보지 않고 일반 문구를 준다(응답 모양이 같아 초과 여부도 구분 안 됨).
//   방 목록(room_list)에 이미 공개되는 정보(코드·방장)와 같은 수준이며 그 이상(규칙 외)을 싣지 않는다.
import { readFile, stat } from 'node:fs/promises';
import { CODE_RE } from './protocol.js';

export const INVITE_IMAGE = '/assets/og/invite.png';
export const GENERIC_TITLE = '통키 피구 한판하자!';
export const GENERIC_DESC = '피구왕 통키 1:1 대결 · 웹에서 바로 한판!';
const NICK_MAX = 12; // 코드포인트. 넘으면 잘라 '…'
const MODE_KO = { knockout: '체력제', official: '공식' };

/** HTML 속성값 이스케이프(& < > " ') */
export const escAttr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 요청 origin. 프록시(nginx) 뒤면 X-Forwarded-Proto/Host 를 전달해야 https·공개 도메인이 된다. 형식이 이상한 값은 버린다 */
export function originOf(req) {
  const first = (v) => String(v ?? '').split(',')[0].trim();
  let proto = first(req.headers['x-forwarded-proto']).toLowerCase();
  if (proto !== 'http' && proto !== 'https') proto = req.socket?.encrypted ? 'https' : 'http';
  const HOST_RE = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;
  let host = first(req.headers['x-forwarded-host']);
  if (!HOST_RE.test(host)) host = first(req.headers.host);
  if (!HOST_RE.test(host)) host = 'localhost';
  return `${proto}://${host}`;
}

/** 쿼리 값 -> 방 코드(대문자) 또는 null(서버 형식 CODE_RE 가 아니면 무시) */
export function parseCode(v) {
  if (typeof v !== 'string') return null;
  const c = v.trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

/** 초대 가능한(대기 중·빈 자리) 일반 대전방이면 { host, rules }, 아니면 null. lobby.join_room 의 참가 조건과 맞춘다 */
export function invitableRoom(lobby, code) {
  const r = code ? lobby.rooms.get(code) : null;
  if (!r || r.game || r.vsCpu || r.ladder || r.campaign || r.training || r.league || r.flame) return null;
  if (!r.seats[0] || r.seats[1]) return null;
  return { host: r.seats[0].s.nick, rules: r.rules };
}

const clipNick = (n) => { const a = [...String(n).normalize('NFC')]; return a.length > NICK_MAX ? a.slice(0, NICK_MAX).join('') + '…' : a.join(''); };

/** 메타 값(이스케이프 전). room = invitableRoom 결과 또는 null */
export function inviteMeta(origin, code, room) {
  if (!room) return { title: GENERIC_TITLE, desc: GENERIC_DESC, url: origin + '/', image: origin + INVITE_IMAGE };
  const t = room.rules?.time;
  const rule = [MODE_KO[room.rules?.mode], t === 0 ? '무제한' : Number.isInteger(t) ? `${t}분` : null].filter(Boolean).join(' ');
  return {
    title: `${clipNick(room.host)}님과 한판하자!`,
    desc: '피구왕 통키 1:1 대결' + (rule ? ` · ${rule}` : ''),
    url: `${origin}/?room=${code}`,
    image: origin + INVITE_IMAGE,
  };
}

const META_RE = /^[ \t]*<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>[ \t]*\r?\n?/gim;

/** index.html 의 기존 og:*·twitter:* 를 지우고 새 묶음을 </head> 앞에 넣는다 */
export function injectMeta(html, m) {
  const a = (k, v) => `<meta property="${k}" content="${escAttr(v)}">`;
  const n = (k, v) => `<meta name="${k}" content="${escAttr(v)}">`;
  const block = [
    a('og:type', 'website'), a('og:site_name', '피구왕 통키'), a('og:title', m.title), a('og:description', m.desc), a('og:url', m.url),
    a('og:image', m.image), a('og:image:width', '1200'), a('og:image:height', '630'),
    n('twitter:card', 'summary_large_image'), n('twitter:title', m.title), n('twitter:description', m.desc), n('twitter:image', m.image),
  ].map((l) => '  ' + l + '\n').join('');
  const out = html.replace(META_RE, '');
  return out.includes('</head>') ? out.replace('</head>', block + '</head>') : block + out;
}

/** IP 당 고정 창(1분) 횟수 제한. 창이 바뀌면 표를 비운다(메모리 상한) */
export class PerMinute {
  constructor(max, now = () => Date.now()) { this.max = max; this.now = now; this.win = 0; this.map = new Map(); }
  allow(key) {
    const w = Math.floor(this.now() / 60000);
    if (w !== this.win || this.map.size > 50000) { this.win = w; this.map.clear(); }
    const n = (this.map.get(key) ?? 0) + 1;
    this.map.set(key, n);
    return n <= this.max;
  }
}

/** `/?room=` 핸들러. 반환 함수(req, res, roomParam, ip) 가 응답을 끝낸다. 방 상태에 따라 달라지므로 no-store, ETag 없음, 압축 없음(약 3KB) */
export function createInviteHandler(indexFile, lobby, opts = {}) {
  const limiter = new PerMinute(opts.perMin ?? 30, opts.now);
  let cached = null; // { ver, html }
  return async function serveInvite(req, res, roomParam, ip) {
    const st = await stat(indexFile);
    const ver = st.mtimeMs + ':' + st.size;
    if (cached?.ver !== ver) cached = { ver, html: await readFile(indexFile, 'utf8') };
    const code = parseCode(roomParam);
    const room = code && limiter.allow(ip) ? invitableRoom(lobby, code) : null;
    const body = Buffer.from(injectMeta(cached.html, inviteMeta(originOf(req), code, room)), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
