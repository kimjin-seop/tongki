// 개발용: 캠페인 경기별 승률 측정. 사람 대신 '플레이어 봇'(AI, 난이도 파라미터 선택)이 좌석0을 조작한다.
// 사용: node tools/campaign_sim.mjs [seeds=40] [botLevel=2] [campaignJsonPath] [kFrom] [kTo]
// 선택 플래그(위치 인자 뒤/사이 어디든, 없으면 종전 동작 그대로):
//   --limit=<프레임>  경기 제한 시간(Match 옵션 limitFrames, 60프레임=1초, 0=무제한). 그 시점 남은 인원으로 승패(기존 타임업 규칙), 동수면 서든데스
//   --nosd            서든데스에 들어가면 그 자리에서 멈추고 무승부로 센다(빠른 측정용, 엔진 규칙은 그대로)
//   --even            짝수 시드만(1000*(k+1)+2*i). 엔진이 시드 최하위 비트를 버려 종전 시드(1..N)는 절반이 같은 경기다(analysis/25 §11-3)
//   --json=<경로>     결과를 JSON 으로도 저장
// 한계: 봇은 필살기를 쓰지 않고 반응이 일정하다(사람과 다름). 절대 승률이 아니라 경기 간 상대 곡선 지표.
import { readFileSync, writeFileSync } from 'node:fs';
import { Match, loadData } from '../server/engine/index.js';
const argv = process.argv.slice(2), flag = (n) => { const a = argv.find((x) => x === '--' + n || x.startsWith('--' + n + '=')); return a === undefined ? undefined : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true; };
const [seeds = 40, botLv = 2, cpath, k0 = 0, k1 = 14] = argv.filter((x) => !x.startsWith('--'));
const LIMIT = flag('limit') === undefined ? undefined : +flag('limit'), NOSD = !!flag('nosd'), EVEN = !!flag('even'), JSONOUT = flag('json');
if (LIMIT !== undefined && !(Number.isInteger(LIMIT) && LIMIT >= 0)) throw new Error('--limit 은 0 이상의 정수(프레임)');
const data = loadData();
let chapters = data.campaign;
if (cpath && cpath !== '-') chapters = JSON.parse(readFileSync(cpath, 'utf8')).chapters;
const N = +seeds;
// 플레이어 봇은 rules.json 이 바뀌어도 고정되도록 최초(임시값) 난이도 파라미터를 여기에 박아 둔다. botLevel 1~3 = 당시 cpu level 1~3
const BOT = { 1: { holdDelayAdd: 30, trigShift: -4, aimFwd256: 150, blunder256: 90 }, 2: { holdDelayAdd: 10, trigShift: 0, aimFwd256: 215, blunder256: 30 }, 3: { holdDelayAdd: 0, trigShift: 3, aimFwd256: 245, blunder256: 0 } };
data.rules = { ...data.rules, cpu: { ...data.rules.cpu, levels: { ...data.rules.cpu.levels, 91: BOT[1], 92: BOT[2], 93: BOT[3] } } };
// 스윕용 덮어쓰기: OV="14:3:96,13:3:80" (k:cpuLevel:specialChance256). 파일은 바뀌지 않는다
if (process.env.OV) { chapters = chapters.map((c) => ({ ...c })); for (const t of process.env.OV.split(",")) { const [k, lv, sp] = t.split(":").map(Number); chapters[k].cpuLevel = lv; chapters[k].specialChance256 = sp; } }
// FIXBOUNCE=1: bounceShift 3 스테이지는 공이 영원히 안 멈추는 엔진 이슈가 있어 측정용으로만 2 로 치환(엔진/데이터 파일은 안 바뀜)
if (process.env.FIXBOUNCE) data.stages = data.stages.map((s) => (s.bounceShift === 3 ? { ...s, bounceShift: 2 } : s));
const wilson = (w, n) => { const p = w / n, z = 1.96, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - s) / d, (c + s) / d]; };
console.log(`seeds=${N} botLevel=${botLv}${LIMIT !== undefined ? ' limitFrames=' + LIMIT : ''}${NOSD ? ' nosd' : ''}${EVEN ? ' even' : ''}`);
const out = [];
console.log('k | 팀 vs | stage | cpuLv sp256 | 승률 [95%CI] | 평균초 | 타임업% | 상대필살기/경기 | 내필살기 | 승/패/무 | 평균프레임 | 평균 남은 인원(나:상대)');
for (let k = +k0; k <= +k1; k++) {
  const c = chapters[k]; let w = 0, l = 0, frames = 0, tu = 0, sp = 0, spMine = 0, draws = 0; const rem = [0, 0];
  for (let s = 1; s <= N; s++) {
    const m = new Match({ seed: 1000 * (k + 1) + (EVEN ? 2 * s : s), limitFrames: LIMIT, teams: [c.teamMine, c.teamOpp], data, humans: [false, false], stage: c.stage,
      cpuLevels: [90 + +botLv, c.cpuLevel], specialChance256: [0, c.specialChance256] });
    let n = 0;
    while (m.phase !== 'end' || m.f < m.endF + 90) {
      m.tick([0, 0]); n++;
      for (const e of m.drainEvents()) if (e.k === 'special') { if (m.players[e.p].seat === 1) sp++; else spMine++; }
      if (n > 70000 || (NOSD && m.sudden && !m.result)) break;
    }
    const r = m.result;
    if (!r || r.winner < 0) draws++; else if (r.winner === 1) l++;
    rem[0] += m.sides[0].remaining; rem[1] += m.sides[1].remaining;
    if (r) { if (r.winner === 0) w++; if (r.reason === 'timeup' || r.reason === 'sudden_death') tu++; }
    frames += m.clock || m.f;
  }
  const [lo, hi] = wilson(w, N);
  console.log(`${k} | ${c.teamMine} vs ${c.teamOpp} | ${c.stage} | ${c.cpuLevel} ${c.specialChance256} | ${(100 * w / N).toFixed(0)}% [${(100 * Math.max(0, lo)).toFixed(0)}-${(100 * hi).toFixed(0)}] | ${(frames / N / 60).toFixed(0)} | ${(100 * tu / N).toFixed(0)}% | ${(sp / N).toFixed(1)} | ${(spMine / N).toFixed(1)} | ${w}/${l}/${draws} | ${(frames / N).toFixed(0)} | ${(rem[0] / N).toFixed(2)}:${(rem[1] / N).toFixed(2)}`);
  out.push({ k, teamMine: c.teamMine, teamOpp: c.teamOpp, stage: c.stage, cpuLevel: c.cpuLevel, specialChance256: c.specialChance256, n: N, win: w, lose: l, draw: draws, winRate: w / N, ci95: [Math.max(0, lo), Math.min(1, hi)], avgFrames: frames / N, timeupOrSudden: tu, avgRemaining: [rem[0] / N, rem[1] / N], cpuSpecialPerGame: sp / N, botSpecialPerGame: spMine / N });
}
if (JSONOUT && JSONOUT !== true) writeFileSync(JSONOUT, JSON.stringify({ seeds: N, botLevel: +botLv, limitFrames: LIMIT ?? data.rules.time.limitFrames, nosd: NOSD, even: EVEN, rows: out }, null, 1));
