// analysis/data/*.csv -> server/data/*.json (규칙 수치만. ROM·에셋은 포함하지 않는다)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const csv = (f) => {
  const [head, ...rows] = readFileSync(path.join(root, 'analysis/data', f), 'utf8').trim().split(/\r?\n/);
  // 헤더의 괄호 설명(쉼표 포함 가능)을 먼저 제거하고 열 이름을 trim ("h  (idx>=17 ...)" -> "h")
  const keys = head.replace(/\([^)]*\)/g, '').split(',').map((k) => k.trim());
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [keys[i], v])));
};
const num = (v) => Number(v);

const stats = csv('teams_players.csv');
const ai = csv('ai_params.csv');
const sp = csv('special_shots.csv');
const teams = [];
for (const r of stats) {
  const t = num(r.team);
  teams[t] ??= { id: t, name: `팀 ${String(t + 1).padStart(2, '0')}`, players: [] };
  const a = ai.find((x) => x.team === r.team && x.player === r.player);
  const s = sp.find((x) => x.team === r.team && x.player === r.player);
  teams[t].players[num(r.player)] = {
    idx: num(r.player), role: r.role,
    hp: num(r.hp), def: num(r.defense), spd: num(r.move_speed), s3: num(r.s3_lob_or_arc),
    pow: num(r.power), s5: num(r.s5_timer), thr: num(r.throw_speed), pass: num(r.pass_speed),
    ai: Array.from({ length: 16 }, (_, i) => num(a['b' + i])),
    special: { shotId: num(s.shot_id), power: num(s.power) }, // 1차 미사용(후속)
  };
}
writeFileSync(path.join(root, 'server/data/teams.json'), JSON.stringify({ source: 'analysis/data/teams_players.csv,ai_params.csv,special_shots.csv', teams }, null, 1));

const slots = csv('court_slots.csv').map((r) => ({
  slot: num(r.slot), objType: r.objtype,
  a: [num(r.x_sideA), num(r.y_sideA)], b: [num(r.x_sideB), num(r.y_sideB)],
}));
const hb = csv('hitboxes.csv').slice(0, 17).map((r) => ({ idx: num(r.index), xoff: num(r.xoff), w: num(r.w), yoff: num(r.yoff), h: num(r.h) }));
writeFileSync(path.join(root, 'server/data/court.json'), JSON.stringify({ slots, hitboxes: hb }, null, 1));
console.log('teams', teams.length, 'slots', slots.length, 'hitboxes', hb.length);

// 필살기 표 (analysis/06_special_shots.md §1.3, §2): ROW[팀][선수] (-1=무작위 풀), 위력표[ID](255=덮어쓰지 않음), 무작위 풀 32항목 [코드 0xB82E]
const SP_IDS = 54;
const row = [];
const power = Array(SP_IDS).fill(255);
for (const r of sp) {
  const t = num(r.team), p = num(r.player), id = num(r.shot_id), pw = num(r.power);
  (row[t] ??= [])[p] = id;
  if (id >= 0) {
    if (power[id] !== 255 && power[id] !== pw && pw !== 255) throw new Error(`special power conflict id ${id}`);
    if (pw !== 255) power[id] = pw;
  }
}
const pool = [1, 2, 4, 5, 6, 8, 11, 12, 13, 15, 18, 20, 22, 25, 26, 27, 48, 49, 31, 33, 34, 37, 39, 40, 6, 6, 43, 48, 49, 51, 53, 53];
writeFileSync(path.join(root, 'server/data/specials.json'), JSON.stringify({ source: 'analysis/data/special_shots.csv + 06_special_shots.md §1.3', row, power, pool }));
console.log('specials teams', row.length, 'ids', SP_IDS);
