// 개발용 측정(analysis/26): 캠페인 15경기를 '사람 좌석 봇'(좌석0 = humans[0]=true, 패드 비트만 넣는다) 대 컴퓨터로 돌려 승률·시간·종료 사유·필살기 수를 잰다.
// 사용: node tools/campaign_remeasure.mjs [seeds=40] [bots=random,chase,aggr0,aggr50,aggr100] [kFrom=0] [kTo=14]
// 환경변수: FM=1(aggr 봇이 포메이션 어택 사용), ENGINE=엔진 index.js 절대경로(백업 엔진 비교용, 기본 server/engine), OVLV=1|2|3 (전 경기 cpuLevel 덮어쓰기), OVSP=0~256 (specialChance256 덮어쓰기), JSON=결과 json 경로, LIMIT=경기 제한 시간 프레임(Match 옵션 limitFrames, 0=무제한, 없으면 rules.json 기본 = 종전 동작)
// 봇 [자작, 사람과 다르다 = 절대 승률이 아니라 봇 사이·버전 사이 비교 지표]
//  random: 4~24프레임마다 방향 9종·B 35%·A 10%·C 15% 를 무작위로 새로 고른다
//  chase : 느슨한 공으로 걸어가 줍고, 공을 들면 내야는 x 200(좌석0)까지 걸어가 지상 투구. 방어 입력 없음
//  aggrNN: (NN = 상대 투구마다 캐치를 시도할 확률 %, 예 aggr0/aggr50/aggr100) chase + 내야 보유 시 뒤로 물러났다 대시 -> 점프 -> 공중 차지 13~15(필살기 창)에서 뗌, 상대 투구가 4프레임 안에 닿을 거리면 공 쪽을 보고 B(캐치 자세)
// 시드: 경기 k 마다 1000*(k+1)+2*i (i=1..seeds, 짝수만). 파일을 바꾸지 않는다(엔진·데이터 읽기 전용).
import { writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const enginePath = process.env.ENGINE || path.join(here, '../server/engine/index.js');
const { Match, loadData } = await import(pathToFileURL(enginePath).href);
const [seedsArg = 40, botsArg = 'random,chase,aggr0,aggr50,aggr100', k0 = 0, k1 = 14] = process.argv.slice(2);
const N = +seedsArg, bots = botsArg.split(',');
const data = loadData();
let chapters = data.campaign.map((c) => ({ ...c }));
if (process.env.OVLV) for (const c of chapters) c.cpuLevel = +process.env.OVLV;
if (process.env.OVSP) for (const c of chapters) c.specialChance256 = +process.env.OVSP;
const LIMIT = process.env.LIMIT !== undefined && process.env.LIMIT !== '' ? +process.env.LIMIT : undefined;
if (LIMIT !== undefined && !(Number.isInteger(LIMIT) && LIMIT >= 0)) throw new Error('LIMIT 은 0 이상의 정수(프레임)');
const FM = !!process.env.FM; // FM=1: aggr 봇이 포메이션 어택(경기당 3회)을 쓴다
const ONE = 65536, B = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, B: 16, C: 32, A: 64 };
const ST = { IDLE: 0, JUMP: 1, DASH: 2, BRAKE: 3 }, BM = { HELD: 0, FLY: 1, PASS: 2, LOOSE: 3, DROP: 4 };
const wilson = (w, n) => { const p = w / n, z = 1.96, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)]; };
function mkRnd(seed) { let s = (seed * 2654435761) >>> 0 || 1; return (n) => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; }; }
const DIRS = [0, 1, 2, 4, 8, 5, 9, 6, 10];

function toward(p, tx, ty, dead = 3) {
  let bits = 0; const dx = (tx - p.x) / ONE, dy = (ty - p.y) / ONE;
  if (dx > dead) bits |= B.RIGHT; else if (dx < -dead) bits |= B.LEFT;
  if (dy > dead) bits |= B.DOWN; else if (dy < -dead) bits |= B.UP;
  return bits;
}

function botRandom(m, s, rnd) {
  if (--s.seg <= 0) { s.seg = 4 + rnd(21); s.bits = DIRS[rnd(9)] | (rnd(100) < 35 ? B.B : 0) | (rnd(100) < 10 ? B.A : 0) | (rnd(100) < 15 ? B.C : 0); }
  return s.bits;
}

function botSmart(m, s, rnd, aggr, catchPct) {
  const side = m.sides[0], p = m.players[side.ctrl], b = m.ball;
  if (!p) return 0;
  const air = p.z > 0 || p.vz !== 0;
  const press = (bit) => (s.last & bit ? 0 : bit); // 새로 누름이 되도록 직전 프레임에 눌려 있었으면 한 프레임 뗀다
  if (!p.hasBall) s.atk = null;
  if (FM && m.fm && m.fm.seat === 0) return B.B; // 포메이션 진행 중: B 를 누르고 있으면 받는 순간 엔드 어택
  if (p.hasBall) {
    if (p.wind) return 0;
    if (FM && aggr && side.fmLeft > 0 && m.fmCanStart(0)) return s.last & 128 ? 0 : 128; // 포메이션 어택(Start) 3회를 쓸 수 있을 때마다 쓴다
    if (p.slot >= 4) return press(B.B); // 외야 보유: 곧바로 지상 투구(대상 = 상대 활성 선수)
    if (!aggr) { // chase: 발사 위치까지 걸어가 지상 투구
      if (p.x < 200 * ONE && !air) return B.RIGHT;
      return B.RIGHT | press(B.B);
    }
    const a = (s.atk ??= { ph: 0, t: 0 });
    a.t++;
    if (a.t > 400) return B.RIGHT | press(B.B); // 꼬였을 때의 탈출: 그냥 던진다
    if (p.charging) return p.charge >= 13 ? 0 : B.B; // 차지 13 이상에서 뗀다(필살기 창 13~15)
    if (air) return press(B.B); // 공중: B 를 새로 눌러 차지 시작
    switch (a.ph) {
      case 0: if (p.x > 120 * ONE) return B.LEFT; a.ph = 1; a.k = 0; return 0; // 뒤로 물러난다
      case 1: { const k = a.k++; if (k === 0) return B.RIGHT; if (k === 1) return 0; a.ph = 2; return B.RIGHT; } // 더블탭
      case 2:
        if (p.st !== ST.DASH && a.k++ > 6) { a.ph = 1; a.k = 0; return 0; } // 대시가 안 걸렸으면 다시
        if (p.x >= 176 * ONE) { a.ph = 3; return B.RIGHT | B.C; }
        return B.RIGHT;
      default: return B.RIGHT | press(B.C); // 아직 지상이면 다시 점프
    }
  }
  // 방어(aggr 만): 상대 투구가 가까우면 공 쪽을 보고 캐치 자세
  if (aggr && b.mode === BM.FLY && b.thrower >= 0 && m.players[b.thrower].seat === 1 && s.tid !== b.id) { s.tid = b.id; s.try = rnd(100) < catchPct; } // 투구마다 한 번: 캐치를 시도할지
  if (aggr && s.try && b.mode === BM.FLY && b.thrower >= 0 && m.players[b.thrower].seat === 1) {
    const dx = (b.x - p.x) / ONE, dy = (b.y - p.y) / ONE, d = Math.hypot(dx, dy);
    const v = Math.hypot(b.vx, b.vy) / ONE || 1, eta = d / v;
    const closing = dx * b.vx + dy * b.vy < 0;
    if (closing && eta <= 4 && !air && p.st === ST.IDLE) return press(B.B);
    if (closing && eta <= 7) return toward(p, b.x, b.y, 0); // 공 쪽으로 한 걸음 = 그쪽을 본다
    return 0;
  }
  if (b.mode === BM.LOOSE) {
    const stopped = b.z === 0 && b.vx === 0 && b.vy === 0 && b.vz === 0;
    if (!air && (p.st === ST.IDLE) && m.grabTouch(p) && (stopped ? b.still >= 2 : b.z < 24 * ONE)) return press(B.B);
    if (side.zone >= 0 || stopped) return toward(p, b.x, b.y, 2);
  }
  return 0;
}

const out = [];
console.log(`engine=${path.relative(path.join(here, '..'), enginePath)} seeds=${N} bots=${bots.join(',')}${process.env.OVLV ? ' OVLV=' + process.env.OVLV : ''}${process.env.OVSP ? ' OVSP=' + process.env.OVSP : ''}${FM ? ' FM=1' : ''}${LIMIT !== undefined ? ' LIMIT=' + LIMIT : ''}`);
console.log('bot | k | 팀 vs | stage | cpuLv sp256 | 승률 [95%CI] | 평균초 | 전멸/타임업/서든데스/draw_cap/미종료 % | 필살기 CPU/봇 (경기당) | 투구 CPU/봇 | 봇 피격/캐치 | CPU 피격/캐치 | 선이탈 CPU/봇 | 안전망 | 포메이션 CPU/봇');
for (const bot of bots) {
  for (let k = +k0; k <= +k1; k++) {
    const c = chapters[k];
    const r = { bot, k, n: N, w: 0, clock: 0, why: {}, unfinished: 0, sp: [0, 0], thr: [0, 0], hit: [0, 0], cat: [0, 0], foul: [0, 0], fm: [0, 0], stall: 0, err: 0, maxClock: 0 };
    for (let sd = 1; sd <= N; sd++) {
      const seed = 1000 * (k + 1) + 2 * sd; // 짝수 시드만: 엔진이 난수 시드의 최하위 비트를 버리므로(analysis/25 §11-3) 홀수 시드는 시드-1 과 같은 경기가 된다
      const m = new Match({ seed, limitFrames: LIMIT, teams: [c.teamMine, c.teamOpp], data, humans: [true, false], stage: c.stage, cpuLevels: [null, c.cpuLevel], specialChance256: [0, c.specialChance256] });
      const rnd = mkRnd(seed * 31 + 7), s = { seg: 0, bits: 0, last: 0, atk: null };
      let n = 0;
      try {
        while (m.phase !== 'end' && n++ < 80000) {
          const bits = m.phase === 'play' ? (bot === 'random' ? botRandom(m, s, rnd) : botSmart(m, s, rnd, bot.startsWith('aggr'), bot.startsWith('aggr') ? +(bot.slice(4) || 100) : 0)) : 0;
          s.last = bits;
          m.tick([bits, 0]);
          for (const e of m.drainEvents()) {
            const seat = e.p != null && m.players[e.p] ? m.players[e.p].seat : -1;
            if (e.k === 'fm_start') r.fm[e.seat]++;
            if (e.k === 'special') r.sp[seat]++;
            else if (e.k === 'throw') r.thr[seat]++;
            else if (e.k === 'hit') r.hit[seat]++;
            else if (e.k === 'catch') r.cat[seat]++;
            else if (e.k === 'foul') r.foul[seat]++;
            else if (e.k.startsWith('stall_')) r.stall++;
          }
        }
      } catch (e) { r.err++; if (r.err === 1) console.error(`ERR bot=${bot} k=${k} seed=${seed}: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`); continue; }
      if (m.phase !== 'end') r.unfinished++; else { r.why[m.result.reason] = (r.why[m.result.reason] || 0) + 1; if (m.result.winner === 0) r.w++; }
      r.clock += m.clock; r.maxClock = Math.max(r.maxClock, m.clock);
    }
    const [lo, hi] = wilson(r.w, N), pc = (x) => (100 * (x || 0) / N).toFixed(0), per = (x) => (x / N).toFixed(1);
    r.lo = lo; r.hi = hi; out.push(r);
    console.log(`${bot} | ${k} | ${c.teamMine} vs ${c.teamOpp} | ${c.stage} | ${c.cpuLevel} ${c.specialChance256} | ${pc(r.w)}% [${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}] | ${(r.clock / N / 60).toFixed(0)} | ${pc(r.why.annihilation)}/${pc(r.why.timeup)}/${pc(r.why.sudden_death)}/${pc(r.why.draw_cap)}/${pc(r.unfinished)} | ${per(r.sp[1])}/${per(r.sp[0])} | ${per(r.thr[1])}/${per(r.thr[0])} | ${per(r.hit[0])}/${per(r.cat[0])} | ${per(r.hit[1])}/${per(r.cat[1])} | ${per(r.foul[1])}/${per(r.foul[0])} | ${r.stall} | fm ${per(r.fm[1])}/${per(r.fm[0])}${r.err ? ' ERR=' + r.err : ''}`);
  }
}
if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(out));
