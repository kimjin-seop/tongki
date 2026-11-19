// 불꽃의 계승 영입 풀(오리지널 클론) 생성 도구(analysis/42 §2~§4·§8, analysis/41 §3, analysis/39 D18).
// 입력 = server/flame/data/recruit_pool_spec.json, 출력 = server/flame/data/recruit_pool.json(서버 전용. 카탈로그 메시지에는 싣지 않는다).
// 사용:
//   node server/flame/tools/gen_recruit_pool.mjs                 요약만 출력(파일을 쓰지 않는다)
//   node server/flame/tools/gen_recruit_pool.mjs --write         recruit_pool.json 을 쓴다
//   node server/flame/tools/gen_recruit_pool.mjs --spec=<경로> --out=<경로> --write
// 같은 입력이면 같은 파일이 나온다: 시계·Math.random 을 쓰지 않고 시드 난수(server/flame/rng.js rngFor)만 쓴다. 서버·포트·DB 를 쓰지 않는다.
// 정체(역할·등급·이름·몸·색·필살기)와 능력치는 난수 흐름이 따로다 -> model(등급 예산·역할 보정점·상하한)만 고치면 id·이름·겉모습은 그대로다.
// 인원 추가는 spec.batches 뒤에 묶음을 더한다(앞 묶음 선수는 그대로, 번호가 이어진다). 빼는 선수는 spec.retired 에 id 를 적는다(지우지 않는다).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rngFor } from '../rng.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '../data');
export const GEN_REV = 1; // 생성 규칙 개정 번호(이 파일의 알고리즘을 바꾸면 올린다)
export const GRADES = ['D', 'C', 'B', 'A', 'S'];
export const POOL_STATS = ['hp', 'def', 'spd', 's3', 'pow', 's5', 'thr', 'pass'];

const bad = (m) => { throw new Error('gen_recruit_pool: ' + m); };

/** 선수 점수(42 §2.1) = Σ (능력치 − 기준값) ÷ 단위. 클론은 정수(= 등급 예산 + 역할 보정점), 원작 선수는 소수가 나온다 */
export const scoreOf = (model, stat) => POOL_STATS.reduce((s, k) => s + (stat[k] - model.anchor[k]) / model.unit[k], 0);

/** 클론 한 명의 능력치(42 §2.2~§2.3): 역할 산식 + 등급 예산(몫은 전 능력치, 나머지는 우선순위) -> 상·하한에 걸린 점수 재분배 -> 1점 옮기기 jitterMoves 회. 합계는 언제나 예산과 같다 */
export function statsOf(model, role, grade, rng) {
  const R = model.roles[role] ?? bad(`없는 역할 ${role}`), prio = R.prio, n = POOL_STATS.length;
  if (prio.length !== n || POOL_STATS.some((k) => !prio.includes(k))) bad(`${role}.prio 는 능력치 ${n}개의 순열`);
  const lo = {}, hi = {}, pts = {};
  for (const k of POOL_STATS) {
    lo[k] = Math.ceil((model.limits[k][0] - model.anchor[k]) / model.unit[k]);
    hi[k] = Math.floor((model.limits[k][1] - model.anchor[k]) / model.unit[k]);
    pts[k] = R.off[k] ?? 0;
  }
  const budget = model.grades[grade] + R.adj, q = Math.trunc(budget / n), rem = budget - q * n;
  const back = prio.filter((k) => k !== R.main).reverse(); // 깎는 순서: 우선순위 뒤에서부터, 주 능력 제외
  for (const k of POOL_STATS) pts[k] += q;
  for (let i = 0; i < Math.abs(rem); i++) { if (rem > 0) pts[prio[i]]++; else pts[back[i]]--; }
  // 상·하한에 걸린 점수는 우선순위 순으로 다시 나눈다(넘친 점수 = 앞에서부터 1점씩, 모자란 점수 = 뒤에서부터 1점씩)
  let over = 0, under = 0;
  for (const k of POOL_STATS) {
    if (pts[k] > hi[k]) { over += pts[k] - hi[k]; pts[k] = hi[k]; }
    if (pts[k] < lo[k]) { under += lo[k] - pts[k]; pts[k] = lo[k]; }
  }
  for (let guard = 0; over > 0; guard++) {
    const room = prio.filter((k) => pts[k] < hi[k]);
    if (!room.length || guard > 1000) bad(`${role}/${grade}: 상한에 걸린 점수를 나눌 곳이 없음`);
    for (const k of room) { if (over <= 0) break; pts[k]++; over--; }
  }
  for (let guard = 0; under > 0; guard++) {
    let room = back.filter((k) => pts[k] > lo[k]);
    if (!room.length) room = prio.filter((k) => pts[k] > lo[k]);
    if (!room.length || guard > 1000) bad(`${role}/${grade}: 하한에 걸린 점수를 뺄 곳이 없음`);
    for (const k of room) { if (under <= 0) break; pts[k]--; under--; }
  }
  // 흔들림: 1점을 한 능력치에서 다른 능력치로(주 능력에서는 빼지 않는다, 상·하한 안에서만)
  for (let i = 0; i < model.jitterMoves; i++) {
    const src = POOL_STATS.filter((k) => k !== R.main && pts[k] > lo[k]);
    if (!src.length) break;
    const s = rng.pick(src), dst = POOL_STATS.filter((k) => k !== s && pts[k] < hi[k]);
    if (!dst.length) continue;
    pts[s]--; pts[rng.pick(dst)]++;
  }
  const stat = {};
  for (const k of POOL_STATS) stat[k] = model.anchor[k] + pts[k] * model.unit[k];
  return { stat, pts: budget };
}

/** 등급 × 역할 인원(최대잉여법): 등급 인원 × 역할 가중치 ÷ 가중치 합을 내림하고 남는 자리는 소수부가 큰 역할부터(같으면 roleWeight 순서) */
export function cellCounts(gradeQuota, roleWeight) {
  const roles = Object.keys(roleWeight), W = roles.reduce((s, r) => s + roleWeight[r], 0), out = {};
  for (const g of GRADES) {
    const q = gradeQuota[g] ?? 0, raw = roles.map((r, i) => ({ r, i, v: (q * roleWeight[r]) / W }));
    const cnt = Object.fromEntries(raw.map((x) => [x.r, Math.floor(x.v)]));
    let left = q - raw.reduce((s, x) => s + Math.floor(x.v), 0);
    for (const x of raw.slice().sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)) || a.i - b.i)) { if (left-- <= 0) break; cnt[x.r]++; }
    out[g] = cnt;
  }
  return out;
}

const specHash = (spec) => { const { _meta, ...rest } = spec; return createHash('sha256').update(JSON.stringify(rest)).digest('hex'); }; // eslint-disable-line no-unused-vars

/**
 * 풀 생성(순수 함수: 입력을 고치지 않고 파일·시계·Math.random 을 쓰지 않는다).
 * @param {object} spec recruit_pool_spec.json
 * @returns {{_meta:object, model:object, players:object[]}} recruit_pool.json 의 내용
 */
export function generatePool(spec) {
  const N = spec.names, M = spec.model, total = spec.batches.reduce((s, b) => s + b.count, 0);
  // 겉모습 후보: 몸마다 (유니폼 × 머리) 조합. 머리색을 못 바꾸는 몸은 머리 0(원본)만
  const bodies = spec.bodies.list.flatMap((t) => t.idx.map((idx) => {
    const hairs = t.hair.includes(idx) ? spec.hairs : [0];
    return { team: t.team, idx, n: 0, looks: spec.uniforms.flatMap((uni) => hairs.map((hair) => ({ uni, hair }))) };
  }));
  const surnames = N.surnames.flatMap(([list, w]) => list.map((s) => [s, w])), wSum = surnames.reduce((s, [, w]) => s + w, 0);
  const bannedPrefix = new Set(N.bannedPrefix), bannedFull = new Set(N.bannedFull), fullUsed = new Set(), givenUse = new Map();
  const retired = new Set(spec.retired ?? []), players = [];
  let next = 1;
  for (const b of spec.batches) {
    if (GRADES.reduce((s, g) => s + (b.gradeQuota[g] ?? 0), 0) !== b.count) bad(`묶음(seed ${b.seed}): gradeQuota 합이 count(${b.count})와 다름`);
    const cells = cellCounts(b.gradeQuota, spec.roleWeight), order = [];
    for (const g of GRADES) for (const [role, c] of Object.entries(cells[g])) for (let i = 0; i < c; i++) order.push({ grade: g, role });
    const who = rngFor(b.seed, 'order').sample(order, order.length); // id 가 등급 순으로 늘어서지 않게 섞는다
    const rName = rngFor(b.seed, 'name'), rLook = rngFor(b.seed, 'look');
    for (const { grade, role } of who) {
      const id = 'c' + String(next++).padStart(3, '0');
      // 이름(41 §3-4): 이름 2자를 먼저 고르고(분포를 고르게) 성을 가중치로 뽑는다. 금칙에 걸리면 성을 다시 뽑는다
      let name = null;
      for (let guard = 0; guard < 50 && !name; guard++) {
        const free = N.given.filter((g) => (givenUse.get(g) ?? 0) < N.givenMaxUse);
        if (!free.length) bad('이름 2자가 모자람(givenMaxUse 를 올린다)');
        const given = rName.pick(free);
        for (let t = 0; t < 40 && !name; t++) {
          let r = rName.next() * wSum, sur = surnames.at(-1)[0];
          for (const [s, w] of surnames) { if ((r -= w) < 0) { sur = s; break; } }
          const full = sur + given;
          if (sur === given[0] || bannedPrefix.has(sur + given[0]) || bannedFull.has(full) || fullUsed.has(full)) continue;
          name = full; fullUsed.add(full); givenUse.set(given, (givenUse.get(given) ?? 0) + 1);
        }
      }
      if (!name) bad(`${id}: 이름을 만들지 못함`);
      // 겉모습: 지금까지 가장 적게 쓴 몸 가운데 하나, 그 몸의 안 쓴 (유니폼·머리) 조합 하나. 조합은 풀 전체에서 한 번만 쓴다
      const open = bodies.filter((x) => x.looks.length && x.n < spec.bodies.maxPerBody);
      if (!open.length) bad(`${id}: 겉모습 조합이 모자람(몸 ${bodies.length}개)`);
      const least = Math.min(...open.map((x) => x.n)), body = rLook.pick(open.filter((x) => x.n === least));
      const look = body.looks.splice(rLook.int(body.looks.length), 1)[0];
      body.n++;
      const tier = spec.shots.byRole[role]?.[grade] ?? spec.shots.byRole[role]?.low ?? bad(`${role}: 필살기 후보 없음`);
      const { stat, pts } = statsOf(M, role, grade, rngFor(b.seed, 'jit', id));
      players.push({ id, name, role, grade, pts, stat, sp: rngFor(b.seed, 'sp', id).pick(tier), body: { team: body.team, idx: body.idx }, skin: look, ...(retired.has(id) ? { retired: true } : {}) });
    }
  }
  for (const id of retired) if (!players.some((p) => p.id === id)) bad(`retired: 없는 id ${id}`);
  return {
    _meta: {
      version: spec.version, poolId: `rp${spec.version}-s${spec.batches[0].seed}-n${total}`,
      generator: { tool: 'server/flame/tools/gen_recruit_pool.mjs', rev: GEN_REV, specSha256: specHash(spec) },
      doc: 'analysis/42_flame_recruit_pool_design.md §8, analysis/39_flame_decisions.md D18',
      notes: [
        '생성 도구가 쓴 파일이다. 손으로 고치지 않는다(입력 = recruit_pool_spec.json, 검증기가 다시 생성해 대조한다).',
        '서버 전용: flame_catalog 에 싣지 않는다. 화면에는 후보 칸(flame_state.run.pending[].choices)과 로스터(run.cast.players)에 표시용 정의만 나간다.',
        'players[].id 는 다시 쓰지 않는다(저장 roster[i].clone·도감 키 c:<id>). body = 엔진 from(히트박스·손 위치·컴퓨터 표) 겸 그림, skin = 유니폼·머리 색 세트. stat 은 엔진 능력치 이름(hp def spd s3 pow s5 thr pass).',
      ],
    },
    model: JSON.parse(JSON.stringify(M)),
    players,
  };
}

/** 역할 × 등급 인원·등급별 평균 점수·이름 중복 수(보고·검증용) */
export function summarizePool(pool) {
  const hist = {}, byGrade = Object.fromEntries(GRADES.map((g) => [g, { n: 0, pts: 0 }])), body = {};
  for (const p of pool.players) {
    (hist[p.role] ??= Object.fromEntries(GRADES.map((g) => [g, 0])))[p.grade]++;
    byGrade[p.grade].n++; byGrade[p.grade].pts += p.pts;
    const k = `${p.body.team}:${p.body.idx}`; body[k] = (body[k] ?? 0) + 1;
  }
  const names = pool.players.map((p) => p.name), given = {};
  for (const n of names) given[n.slice(1)] = (given[n.slice(1)] ?? 0) + 1;
  return {
    count: pool.players.length, hist, byGrade,
    avgPts: pool.players.reduce((s, p) => s + p.pts, 0) / (pool.players.length || 1),
    dupNames: names.length - new Set(names).size, dupIds: names.length - new Set(pool.players.map((p) => p.id)).size,
    givenMax: Math.max(0, ...Object.values(given)), bodies: Object.keys(body).length, bodyMin: Math.min(...Object.values(body)), bodyMax: Math.max(...Object.values(body)),
    dupLooks: pool.players.length - new Set(pool.players.map((p) => `${p.body.team}:${p.body.idx}:${p.skin.uni}:${p.skin.hair}`)).size,
    retired: pool.players.filter((p) => p.retired).length,
  };
}

/** 파일 내용(선수 한 명 = 한 줄. 같은 입력 = 같은 바이트) */
export function serializePool(pool) {
  const head = JSON.stringify({ _meta: pool._meta, model: pool.model }, null, 2).replace(/\n\}$/, '');
  return `${head},\n  "players": [\n${pool.players.map((p) => '    ' + JSON.stringify(p)).join(',\n')}\n  ]\n}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = (n, d) => { const a = args.find((x) => x.startsWith('--' + n + '=')); return a === undefined ? d : a.slice(n.length + 3); };
  const specFile = path.resolve(flag('spec', path.join(DATA, 'recruit_pool_spec.json'))), outFile = path.resolve(flag('out', path.join(DATA, 'recruit_pool.json')));
  const pool = generatePool(JSON.parse(readFileSync(specFile, 'utf8'))), text = serializePool(pool), s = summarizePool(pool);
  console.log(`풀 ${pool._meta.poolId} (version ${pool._meta.version}, 생성 규칙 ${GEN_REV}, 입력 sha256 ${pool._meta.generator.specSha256.slice(0, 12)}…)`);
  console.log(`인원 ${s.count} (은퇴 ${s.retired}) | 평균 점수 ${s.avgPts.toFixed(2)} | id 중복 ${s.dupIds} | 이름 중복 ${s.dupNames} | 이름 2자 최다 사용 ${s.givenMax} | 겉모습 중복 ${s.dupLooks} | 몸 ${s.bodies}개(몸당 ${s.bodyMin}~${s.bodyMax}명)`);
  console.log('역할 \\ 등급 | ' + GRADES.join(' | ') + ' | 합');
  for (const [r, h] of Object.entries(s.hist)) console.log(`${r} | ${GRADES.map((g) => h[g]).join(' | ')} | ${GRADES.reduce((t, g) => t + h[g], 0)}`);
  console.log(`합 | ${GRADES.map((g) => s.byGrade[g].n).join(' | ')} | ${s.count}`);
  console.log('등급별 평균 점수: ' + GRADES.map((g) => `${g} ${(s.byGrade[g].pts / (s.byGrade[g].n || 1)).toFixed(1)}`).join(' / '));
  console.log(`출력 sha256 ${createHash('sha256').update(text).digest('hex')}`);
  if (args.includes('--write')) { writeFileSync(outFile, text); console.log('썼다: ' + outFile); } else console.log('(쓰지 않았다. --write 를 주면 ' + outFile + ' 에 쓴다)');
}
