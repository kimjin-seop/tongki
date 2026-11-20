// 필살 추적 규칙(Match 옵션 evade='track', rules.special.track) 측정 도구. 엔진을 import 해 사람 좌석 두 개에 패드 비트만 넣는다(서버·DB·포트 없음).
// 방법은 analysis/45 §2·§3 의 duel/pvp 하네스와 같다(임밸런 스크래치 스크립트를 엔진 옵션으로 바꿔 옮김).
// 사용:
//   node tools/evade_track_measure.mjs duel N=120 react=12 [ids=all|nat|0,7,...] [pols=...] [dist=100,140]
//   node tools/evade_track_measure.mjs pvp N=50 err=12 A=catch B=zigc [evade=rom|track]
//   node tools/evade_track_measure.mjs same N=60     (일반 슛 G/J: evade rom/track 스냅샷 동일 여부)
import { createHash } from 'node:crypto';
import { Match, loadData } from '../server/engine/index.js';
import { BIT, BM, ST, ONE } from '../server/engine/consts.js';
import { HANDLER_OF_ID } from '../server/engine/special.js';

const [CMD = 'duel', ...rest] = process.argv.slice(2);
const A = Object.fromEntries(rest.map((s) => s.split('=')));
const data = loadData();
const wil = (w, n) => { if (!n) return [0, 0]; const p = w / n, z = 1.96, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)]; };
function rnd(seed) { let s = (seed * 2654435761) >>> 0 || 1; return (n) => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; }; }
const pc = (x, n) => (n ? ((100 * x) / n).toFixed(0) : '-');

// 핸들러별 대표 ID(special.js HANDLER_OF_ID 에서 첫 ID)
const REP = (() => { const m = new Map(); HANDLER_OF_ID.forEach((h, i) => { if (!m.has(h)) m.set(h, i); }); return [...m.entries()].map(([h, id]) => ({ h, id })); })();

/** 1구: 좌석0 투구 -> 좌석1 대상 수비 정책. kind: G(지상)·J(점프 투구 차지 3)·SP(점프 차지 13 필살)·F<id>(점프 투구 + forceSpecial=id) */
function trial(i, kind, pol, evade, dist, REACT, trace = false) {
  const r = rnd(i * 977 + 13);
  const teams = [i % 25, (i * 7 + 3) % 25];
  const force = kind[0] === 'F' ? +kind.slice(1) : false;
  const m = new Match({ seed: 2000 + 2 * i, teams, data, humans: [true, true], evade, ...(force !== false ? { forceSpecial: force } : {}) });
  let g = 0; while ((m.phase !== 'play' || m.tip.on) && g++ < 3000) m.tick([0, 0]);
  if (m.phase !== 'play') return null;
  for (let w = 0; w < 90; w++) m.tick([0, 0]);
  const th = m.players.find((p) => p.seat === 0 && p.slot === 0) ?? m.players.find((p) => p.seat === 0 && p.role === 'in');
  const df = m.players.find((p) => p.seat === 1 && p.slot === 0) ?? m.players.find((p) => p.seat === 1 && p.role === 'in');
  if (!th || !df || !m.hittable(df)) return null;
  m.sides[0].ctrl = th.pid; m.sides[1].ctrl = df.pid;
  const ay = 70 + ((i * 29) % 117), ax = 150 + (i % 5) * 4;
  th.x = ax * ONE; th.y = ay * ONE; th.vx = th.vy = 0; th.st = ST.IDLE; th.face = 1;
  df.x = Math.max(262, Math.min(410, ax + dist)) * ONE; df.y = ay * ONE; df.vx = df.vy = 0; df.st = ST.IDLE; df.face = -1;
  m.giveBall(th); m.drainEvents();
  const up = df.y / ONE > 128 ? BIT.UP : BIT.DOWN;
  let defHit = false, f = 0, relF = -1, res = null, ph = 0, prev1 = 0, sp = -1, catchAt = null, who = -1, endF = -1;
  const s5 = df.stat.s5, herr = r(9) - 4, spamPh = r(64), path = [];
  while (f++ < 400 && !res) {
    let a = 0;
    const air = th.z > 0 || th.vz !== 0;
    if (th.hasBall) {
      if (kind === 'G') a = f === 2 ? BIT.B : 0;
      else {
        const need = kind === 'SP' ? 13 : 3;
        if (!air && ph === 0) { a = BIT.C; ph = 1; } else if (air && !th.charging && ph === 1) { a = BIT.B; ph = 2; } else if (th.charging) a = th.charge >= need ? 0 : BIT.B;
      }
    }
    let d = 0;
    const ball = m.ball, fly = relF >= 0 && ball.mode === BM.FLY, since = relF >= 0 ? f - relF : -1;
    const ex = (ball.x - df.x) / ONE, ey = (ball.y - df.y) / ONE, bsp = Math.hypot(ball.vx, ball.vy) / ONE || 1, eta = Math.hypot(ex, ey) / bsp;
    if (pol === 'spam' || pol === 'spamJ') {
      const q = Math.floor((f + spamPh) / 40) % 2;
      d = (q ? BIT.UP : BIT.DOWN) | ((f + spamPh) % 80 < 40 ? BIT.RIGHT : BIT.LEFT);
      if ((f + spamPh) % 34 === 0) d = pol === 'spam' ? BIT.A : BIT.C;
    } else if (since >= REACT && fly) {
      if (pol === 'diag') d = up | BIT.RIGHT;
      else if (pol === 'side') d = up;
      else if (pol === 'crouch') d = since === REACT ? BIT.A : 0;
      else if (pol === 'jump') d = since === REACT ? BIT.C : 0;
    }
    if (pol === 'catchH' && fly && since >= Math.min(REACT, 3) && catchAt === null) {
      const want = Math.ceil(s5 / 2) + herr;
      if (eta <= want + 1) d = BIT.LEFT;
      if (eta <= want && prev1 & BIT.LEFT) { d = BIT.B; catchAt = f; }
    }
    if (pol === 'catchH' && catchAt !== null && f > catchAt) d = 0;
    m.tick([a, d]); prev1 = d;
    for (const e of m.drainEvents()) {
      if (e.k === 'throw' && relF < 0) { relF = f; sp = 0; }
      if (e.k === 'special') sp = e.id;
      if (relF >= 0 && (e.k === 'hit' || e.k === 'catch') && !res) { res = e.k; who = e.p; endF = f - relF; }
      if (relF >= 0 && e.k === 'hit' && m.players[e.p]?.seat === 1) defHit = true;
    }
    if (trace && relF >= 0 && !res) path.push([m.ball.x, m.ball.y, m.ball.z]);
    if (relF >= 0 && !res && m.ball.mode !== BM.FLY && f > relF + 1) { res = 'miss'; endF = f - relF; }
  }
  if (relF < 0) return null;
  if (kind === 'SP' && sp <= 0) return null; // 자연 필살: 실제로 필살이 나간 시도만
  return { res, onDef: who === df.pid, defHit, sp, endF, path };
}

function duel() {
  const N = +(A.N ?? 120), REACT = +(A.react ?? 12), DISTS = (A.dist ?? '100,140').split(',').map(Number);
  const POLS = (A.pols ?? 'stand,diag,crouch,jump,spam,spamJ,catchH').split(',');
  const idsArg = A.ids ?? 'all';
  const kinds = idsArg === 'nat' ? ['SP'] : idsArg === 'all' ? ['SP', ...REP.map((x) => 'F' + x.id)] : idsArg.split(',').map((x) => (x === 'SP' ? x : 'F' + x));
  const name = (k) => (k === 'SP' ? 'SP(자연 필살)' : `${HANDLER_OF_ID[+k.slice(1)]}(ID ${k.slice(1)})`);
  console.log(`duel N=${N} react=${REACT} dist=${DISTS}`);
  console.log('종류 | 거리 | 정책 | n | rom 피격% | track 피격% [95%CI] | rom 캐치% | track 캐치% | track 수비편 피격% | track 12f 안 도착% | stand 궤적 최대 차(px)');
  for (const k of kinds) for (const dist of DISTS) for (const pol of POLS) {
    const o = { rom: { n: 0, hit: 0, cat: 0, fast: 0, dh: 0 }, track: { n: 0, hit: 0, cat: 0, fast: 0, dh: 0 } };
    let dev = 0;
    for (let i = 1; i <= N; i++) {
      const tr = pol === 'stand';
      const a = trial(i, k, pol, 'rom', dist, REACT, tr), b = trial(i, k, pol, 'track', dist, REACT, tr);
      if (!a || !b) continue;
      for (const [ev, t] of [['rom', a], ['track', b]]) { const s = o[ev]; s.n++; if (t.res === 'hit' && t.onDef) s.hit++; if (t.res === 'catch' && t.onDef) s.cat++; if (t.endF >= 0 && t.endF <= 12) s.fast++; if (t.defHit) s.dh++; }
      if (tr) { const L = Math.min(a.path.length, b.path.length); for (let j = 0; j < L; j++) for (let c = 0; c < 3; c++) dev = Math.max(dev, Math.abs(a.path[j][c] - b.path[j][c]) / ONE); }
    }
    const t = o.track, [lo, hi] = wil(t.hit, t.n);
    console.log(`${name(k)} | ${dist} | ${pol} | ${t.n} | ${pc(o.rom.hit, o.rom.n)} | ${pc(t.hit, t.n)} [${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}] | ${pc(o.rom.cat, o.rom.n)} | ${pc(t.cat, t.n)} | ${pc(t.dh, t.n)} | ${pc(t.fast, t.n)} | ${pol === 'stand' ? dev.toFixed(1) : ''}`);
  }
}

/** 일반 슛: 무작위 입력 경기를 evade rom/track 으로 돌려 매 프레임 스냅샷 해시 비교. 필살이 한 번도 안 나온 경기는 같아야 한다 */
function same() {
  const N = +(A.N ?? 60), F = +(A.frames ?? 1800);
  const c = { noSp: 0, noSpDiff: 0, sp: 0, spDiff: 0, throws: 0 };
  for (let i = 1; i <= N; i++) {
    const run = (ev) => {
      const m = new Match({ seed: 2000 + 2 * i, teams: [i % 22, (i * 7 + 3) % 22], data, humans: [true, true], evade: ev });
      const x = createHash('sha1'); let s = 12345 + i, nsp = 0, nth = 0;
      for (let f = 0; f < F && m.phase !== 'end'; f++) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        m.tick([(s >>> 8) & 127, (s >>> 16) & 127]);
        for (const e of m.drainEvents()) { if (e.k === 'special') nsp++; if (e.k === 'throw') nth++; }
        const B = m.ball; x.update(JSON.stringify([m.snapshot(false), B.x, B.y, B.z, B.vx, B.vy, B.vz, m.players.map((q) => [q.x, q.y, q.z, q.st, q.hp])]));
      }
      return { h: x.digest('hex'), nsp, nth };
    };
    const a = run('rom'), b = run('track');
    c.throws += a.nth;
    if (a.nsp === 0) { c.noSp++; if (a.h !== b.h) c.noSpDiff++; } else { c.sp++; if (a.h !== b.h) c.spDiff++; }
  }
  console.log(`same: 무작위 입력 ${N}경기 x ${F}f (투구 ${c.throws}회). 필살 없는 경기 ${c.noSp} 중 rom/track 해시 다름 ${c.noSpDiff} / 필살 나온 경기 ${c.sp} 중 다름 ${c.spDiff}`);
}

// ---- 한 경기 전체(analysis/45 pvp.mjs 와 같은 봇) ----
function bot(m, seat, S, rr, pol, SPP, ERR) {
  const side = m.sides[seat], p = m.players[side.ctrl], b = m.ball; if (!p) return 0;
  const FW = seat === 0 ? BIT.RIGHT : BIT.LEFT, BK = seat === 0 ? BIT.LEFT : BIT.RIGHT;
  const fx = (q) => (seat === 0 ? q.x / ONE : 512 - q.x / ONE);
  const air = p.z > 0 || p.vz !== 0;
  const press = (bit) => (S.last & bit ? 0 : bit);
  const toward = (tx, ty, dead = 2) => { let r = 0; const dx = (tx - p.x) / ONE, dy = (ty - p.y) / ONE; if (dx > dead) r |= BIT.RIGHT; else if (dx < -dead) r |= BIT.LEFT; if (dy > dead) r |= BIT.DOWN; else if (dy < -dead) r |= BIT.UP; return r; };
  if (!p.hasBall) S.atk = null;
  if (p.hasBall) {
    if (p.wind) return 0;
    if (p.slot >= 4) return press(BIT.B);
    const a = (S.atk ??= { t: 0, sp: rr(100) < SPP, wait: rr(40) });
    a.t++;
    if (a.t > 300) return press(BIT.B);
    if (p.charging) return p.charge >= 13 ? 0 : BIT.B;
    if (a.sp) { if (air) return press(BIT.B); if (fx(p) < 200) return FW; return press(BIT.C); }
    if (a.t < a.wait) return 0;
    if (fx(p) < 215) return FW;
    return press(BIT.B);
  }
  const oppBall = (b.mode === BM.HELD && b.holder >= 0 && m.players[b.holder].seat !== seat) || (b.mode === BM.FLY && b.thrower >= 0 && m.players[b.thrower].seat !== seat);
  if ((pol === 'zig' || pol === 'zigc') && oppBall && p.role === 'in') {
    const ph = Math.floor(m.f / 40) % 2, ph2 = Math.floor(m.f / 23) % 2;
    let d = (ph ? BIT.UP : BIT.DOWN) | (ph2 ? BK : FW);
    if (fx(p) > 240) d = (d & ~FW) | BK;
    if (pol === 'zig' && !air && p.st === ST.IDLE) d |= press(BIT.C);
    if (pol === 'zigc' && b.mode === BM.FLY && !air && p.st === ST.IDLE && b.tgt === p.pid) { const v = Math.hypot(b.vx, b.vy) / ONE || 1; if (Math.hypot(b.x - p.x, b.y - p.y) / ONE / v < 12) d = press(BIT.A); }
    return d;
  }
  if (b.mode === BM.FLY && b.thrower >= 0 && m.players[b.thrower].seat !== seat && b.tgt === p.pid) {
    if (S.tid !== b.id) { S.tid = b.id; S.herr = rr(2 * ERR + 1) - ERR; S.done = false; }
    const dx = (b.x - p.x) / ONE, dy = (b.y - p.y) / ONE, v = Math.hypot(b.vx, b.vy) / ONE || 1, eta = Math.hypot(dx, dy) / v;
    if (pol === 'catch') {
      const want = Math.ceil(p.stat.s5 / 2) + S.herr;
      if (S.done) return 0;
      if (eta <= want + 1 && !air && p.st === ST.IDLE) { if (eta <= want && S.last & (BIT.LEFT | BIT.RIGHT)) { S.done = true; return BIT.B; } return toward(b.x, b.y, 0) & (BIT.LEFT | BIT.RIGHT) || (dx < 0 ? BIT.LEFT : BIT.RIGHT); }
      return 0;
    }
    return 0;
  }
  if (b.mode === BM.LOOSE) {
    const stopped = b.z === 0 && b.vx === 0 && b.vy === 0 && b.vz === 0;
    if (!air && p.st === ST.IDLE && m.grabTouch(p) && (stopped ? b.still >= 2 : b.z < 24 * ONE)) return press(BIT.B);
    if (side.zone >= 0 || stopped) return toward(b.x, b.y, 2);
  }
  return 0;
}
function pvp() {
  const N = +(A.N ?? 50), SPP = +(A.sp ?? 50), ERR = +(A.err ?? 12), POL = [A.A ?? 'catch', A.B ?? 'zigc'], EV = A.evade ?? 'track';
  let w = [0, 0], draws = 0, clock = 0, hits = [0, 0], cats = [0, 0], sps = [0, 0];
  for (let i = 1; i <= N; i++) for (const swap of [0, 1]) {
    const r = rnd(i * 31 + swap), teams = [r(22), r(22)], pols = swap ? [POL[1], POL[0]] : POL;
    const m = new Match({ seed: 5000 + 4 * i + 2 * swap, teams, data, humans: [true, true], limitFrames: 18000, evade: EV });
    const S = [{ last: 0 }, { last: 0 }], rr = [rnd(i * 7 + 1 + swap * 3), rnd(i * 11 + 5 + swap * 3)];
    let n = 0;
    while (m.phase !== 'end' && n++ < 80000) {
      const bits = m.phase === 'play' ? [0, 1].map((s) => bot(m, s, S[s], rr[s], pols[s], SPP, ERR)) : [0, 0];
      S[0].last = bits[0]; S[1].last = bits[1];
      m.tick(bits);
      for (const e of m.drainEvents()) {
        const seat = e.p != null && m.players[e.p] ? m.players[e.p].seat : -1, who = (s) => (swap ? 1 - s : s);
        if (seat < 0) continue;
        if (e.k === 'special') sps[who(seat)]++; else if (e.k === 'hit') hits[who(seat)]++; else if (e.k === 'catch') cats[who(seat)]++;
      }
    }
    const res = m.result; clock += m.clock;
    if (!res || res.winner < 0) draws++; else w[swap ? 1 - res.winner : res.winner]++;
  }
  const G = 2 * N, [lo, hi] = wil(w[0], G), per = (x) => (x / G).toFixed(1);
  console.log(`pvp evade=${EV} err=±${ERR} A=${POL[0]} B=${POL[1]} 경기 ${G} | A 승률 ${pc(w[0], G)}% [${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}] 무 ${draws} | 평균 ${(clock / G / 60).toFixed(0)}초 | 경기당 받은 피격 A ${per(hits[0])} B ${per(hits[1])} | 캐치 A ${per(cats[0])} B ${per(cats[1])} | 필살 A ${per(sps[0])} B ${per(sps[1])}`);
}

const fn = { duel, pvp, same }[CMD];
if (fn) fn(); else console.log('명령: duel | pvp | same');
