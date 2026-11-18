// 장시간 트레이스 통계: 외야 대기 선수의 이동 비율·최장 정지 구간을 원작(oracle_long.py 출력)과 우리 엔진(같은 형식으로 여기서 생성)에서 같은 정의로 잰다.
// 사용: node tools/diff/long_stats.mjs oracle <이름...>          (tools/diff/traces/long/<이름>.json)
//       node tools/diff/long_stats.mjs ours [경기 수=3] [프레임=8000] [엔진 경로=../../server/engine/index.js] [첫 시드=7000]
//       --no-fm = 포메이션 어택 구간(원작 타입 0x7C/0x80, 우리 m.fm)을 뺀다
// 정의: 이동 = 직전 프레임과 정수 좌표(x,y)가 다름. 쓸 수 없는 선수($1E≠0 / usable=false)·경기 밖 프레임은 뺀다.
//       외야 = 슬롯($1A) 4 이상(아웃 교체로 외야에 선 선수 포함). 선수별(오브젝트 번호) 최장 정지 = 좌표가 그대로인 연속 프레임 수.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** frames: [{ p:[[type,sub,x,y,vx,vy,f1e,tmr,tx,ty,slot] x14], b:[type,sub,x,y,z,owner] }] */
export function stats(frames, noFm) {
  // 선수(오브젝트)·역할별로 따로 센다: 아웃 교체로 내야 선수가 외야에 서면 그때부터 외야 쪽 누적으로 간다
  const per = {}, grp = {};
  let prev = null;
  for (const fr of frames) {
    // 포메이션 어택(원작 타입 0x7C/0x80, 우리 m.fm) 프레임을 빼는 모드: 그 구간에서 정지 구간도 끊는다
    if (noFm && (fr.fm ?? fr.p.some((p) => p[0] === 0x7c || p[0] === 0x80))) { for (const s of Object.values(per)) { if (s.run) s.runs.push(s.run); s.run = 0; } prev = fr; continue; }
    for (let k = 0; k < 14; k++) {
      const p = fr.p[k], role = p[10] >= 4 ? 'out' : 'in', other = per[k + (role === 'out' ? ' in' : ' out')];
      if (other && other.run) { other.runs.push(other.run); other.run = 0; }
      const s = (per[k + ' ' + role] ??= { k, role, n: 0, mv: 0, run: 0, max: 0, runs: [] });
      if (p[6] || p[0] === 0) { if (s.run) s.runs.push(s.run); s.run = 0; continue; }
      const q = prev && prev.p[k];
      const moved = q ? (q[2] !== p[2] || q[3] !== p[3]) : false;
      s.n++;
      if (moved) { s.mv++; if (s.run) s.runs.push(s.run); s.run = 0; } else { s.run++; if (s.run > s.max) s.max = s.run; }
      const kind = p.kind ?? ('t' + p[0].toString(16) + '/' + p[1].toString(16));
      const key = role + ' ' + kind; (grp[key] ??= [0, 0]); grp[key][0] += moved ? 1 : 0; grp[key][1]++;
      const g = (grp['= ' + role] ??= [0, 0]); g[0] += moved ? 1 : 0; g[1]++;
    }
    prev = fr;
  }
  for (const s of Object.values(per)) if (s.run) s.runs.push(s.run);
  return { per: Object.values(per).sort((a, b) => a.k - b.k || (a.role < b.role ? -1 : 1)), grp };
}

export function report(title, frames, noFm) {
  const { per, grp } = stats(frames, noFm);
  console.log(`== ${title}: ${frames.length}프레임${noFm ? ' (포메이션 구간 제외)' : ''}`);
  const rows = per.map((s) => ({ k: s.k, role: s.role, pct: s.n ? 100 * s.mv / s.n : 0, max: s.max, med: s.runs.sort((a, b) => a - b)[s.runs.length >> 1] ?? 0, n: s.n }));
  for (const r of rows) console.log(`  p${String(r.k).padStart(2)} ${r.role.padEnd(3)} 이동 ${r.pct.toFixed(1).padStart(5)}%  최장 정지 ${String(r.max).padStart(5)}f  정지 구간 중앙값 ${String(r.med).padStart(4)}f  (n=${r.n})`);
  for (const k of Object.keys(grp).sort()) if (grp[k][1] >= 30) console.log(`  [${k}] 이동 ${(100 * grp[k][0] / grp[k][1]).toFixed(1)}% (n=${grp[k][1]})`);
  return rows;
}

async function ours(games, nf, enginePath, seed0) {
  const E = await import(pathToFileURL(path.resolve(HERE, enginePath)).href);
  const C = await import(pathToFileURL(path.resolve(HERE, path.dirname(enginePath), 'consts.js')).href);
  const data = E.loadData(), all = [];
  for (let g = 0; g < games; g++) {
    const m = new E.Match({ seed: seed0 + g, teams: [g % 15, (g * 7 + 3) % 15], data, humans: [false, false], cpuLevels: [2, 2] });
    let w = 0; while ((m.phase !== 'play' || m.tip.on) && w++ < 3000) m.tick([0, 0]);
    const frames = [];
    for (let f = 0; f < nf && m.phase === 'play'; f++) {
      m.tick([0, 0]); m.drainEvents();
      frames.push({
        f, fm: !!m.fm, b: [m.ball.mode, 0, m.ball.x >> 16, m.ball.y >> 16, m.ball.z >> 16, m.ball.holder ?? -1],
        p: m.players.map((p) => {
          const active = m.sides[p.seat].ctrl === p.pid;
          const a = [1, 0, p.x >> 16, p.y >> 16, p.vx, p.vy, m.usable(p) ? 0 : 1, 0, 0, 0, p.slot];
          a.kind = m.fm && m.fm.seat === p.seat ? 'fm' : p.t44 ? 't44' : p.recv ? 'recv' : p.st === C.ST.HIT || p.st === C.ST.DOWN ? 'hit' : p.st === C.ST.FOUL ? 'foul' : active ? 'active' : p.slot >= 4 ? (p.ob?.mv ? 'wait/10' : p.ob?.pc ? 'wait/c' : 'wait/0') : 'passive';
          return a;
        }),
      });
    }
    all.push(report(`우리 엔진 경기 ${g} (seed ${seed0 + g}, 팀 ${g % 15} 대 ${(g * 7 + 3) % 15})`, frames, NOFM));
  }
  return all;
}

const NOFM = process.argv.includes('--no-fm');
const [mode, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const all = [];
if (mode === 'oracle') {
  for (const name of rest) {
    const d = JSON.parse(fs.readFileSync(path.join(HERE, 'traces', 'long', name + '.json'), 'utf8'));
    // 경기 중 프레임만: 내야 선수가 한 명이라도 컴퓨터형 대기·활성 타입(0x20/0x70)인 프레임
    const fr = d.frames.filter((f) => f.p.some((p) => p[0] === 0x20 || p[0] === 0x70));
    all.push(report(`원작 ${name} (시드 poke ${d.seed || '없음'}, lag ${d.lagFrames})`, fr, NOFM));
  }
} else if (mode === 'ours') {
  all.push(...await ours(+rest[0] || 3, +rest[1] || 8000, rest[2] || '../../server/engine/index.js', +rest[3] || 7000));
} else { console.log('usage: long_stats.mjs oracle <이름...> | ours [경기 수] [프레임] [엔진 경로]'); process.exit(1); }
const o = all.flat().filter((r) => r.role === 'out' && r.n > 2000), i = all.flat().filter((r) => r.role === 'in' && r.n > 2000);
const avg = (a, f) => a.reduce((s, r) => s + f(r), 0) / Math.max(1, a.length);
console.log(`\n요약(${mode}): 외야 ${o.length}명 이동 ${avg(o, (r) => r.pct).toFixed(1)}% (최소 ${Math.min(...o.map((r) => r.pct)).toFixed(1)} ~ 최대 ${Math.max(...o.map((r) => r.pct)).toFixed(1)}), 최장 정지 평균 ${avg(o, (r) => r.max).toFixed(0)}f 최대 ${Math.max(...o.map((r) => r.max))}f`);
console.log(`           내야 ${i.length}명 이동 ${avg(i, (r) => r.pct).toFixed(1)}% (최소 ${Math.min(...i.map((r) => r.pct)).toFixed(1)} ~ 최대 ${Math.max(...i.map((r) => r.pct)).toFixed(1)}), 최장 정지 평균 ${avg(i, (r) => r.max).toFixed(0)}f 최대 ${Math.max(...i.map((r) => r.max))}f`);
