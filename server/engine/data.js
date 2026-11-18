// 규칙 수치 JSON 로더 (엔진 본체는 파일을 읽지 않는다: 데이터를 주입받는다)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RULE_TIMES } from './consts.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const rd = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));

/** campaign.json 정합성 검사(k 연속, 팀·스테이지 존재). 어긋나면 로드 시 즉시 실패한다 */
export function validateCampaign(d) {
  d.campaign.forEach((c, i) => {
    if (c.k !== i) throw new Error('campaign k 불연속 ' + i);
    if (!d.teams[c.teamMine] || !d.teams[c.teamOpp]) throw new Error('campaign 팀 없음 k=' + i);
    const st = d.stages.find((s) => s.id === c.stage);
    if (!st) throw new Error('campaign 스테이지 없음 k=' + i);
    if (st.romStage !== c.romStage) throw new Error('campaign romStage 불일치 k=' + i);
    if (![1, 2, 3].includes(c.cpuLevel) || !(c.specialChance256 >= 0 && c.specialChance256 <= 256)) throw new Error('campaign cpu 값 k=' + i);
    // timeMin(선택): 그 경기의 기본 제한 시간(분, 0 = 무제한). 없으면 rules.time.limitFrames
    if (c.timeMin !== undefined && !RULE_TIMES.includes(c.timeMin)) throw new Error('campaign timeMin 값 k=' + i);
  });
}

/** formations.json 검사: fmTarget/fmNextReceiver 가 읽는 필드 전부. 어긋나면 서버 시작 단계에서 즉시 실패한다 */
export function validateFormations(F, teamCount = 25) {
  const bad = (m) => { throw new Error('formations ' + m); };
  const isPt = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
  if (!Array.isArray(F?.slot_to_group) || !F.slot_to_group.length || !F.slot_to_group.every((g) => Number.isInteger(g) && g >= 0 && g < 7)) bad('slot_to_group 이상');
  if (!Array.isArray(F.teams) || F.teams.length !== teamCount) bad(`teams 는 ${teamCount}개여야 함`);
  const nSlot = F.slot_to_group.length;
  F.teams.forEach((t, i) => {
    const w = `team=${t?.team} (idx ${i}) `;
    if (t?.team !== i) bad(w + 'team 번호 불연속');
    if (!Number.isFinite(t.name_idx)) bad(w + 'name_idx 없음');
    if (!(t.cpu_threshold > 0)) bad(w + 'cpu_threshold 는 0보다 커야 함');
    for (const k of ['pos_by_group', 'pos_by_group_mirror']) {
      if (!Array.isArray(t[k]) || t[k].length !== 7 || !t[k].every(isPt)) bad(w + `${k} 는 [x,y] 7개여야 함`);
    }
    if (!Array.isArray(t.pass_next_slot_by_group) || t.pass_next_slot_by_group.length !== 7
      || !t.pass_next_slot_by_group.every((s) => Number.isInteger(s) && s >= 0 && s < nSlot)) bad(w + 'pass_next_slot_by_group 는 슬롯 번호 7개여야 함');
  });
}

/** training.json 검사: Match 의 특훈 진행기가 읽는 필드. 어긋나면 서버 시작 단계에서 즉시 실패한다 */
export function validateTraining(d) {
  const T = d.training, bad = (m) => { throw new Error('training ' + m); };
  if (!Array.isArray(T?.teams) || T.teams.length !== 2 || !T.teams.every((t) => d.teams[t])) bad('teams 이상');
  if (!d.stages.find((s) => s.id === T.stage)) bad('stage 없음');
  if (!Array.isArray(T.outSlots) || T.outSlots.length !== 6 || !T.outSlots.every((s) => Number.isInteger(s) && s >= 4 && s <= 12)) bad('outSlots 는 외야 슬롯 6개여야 함');
  const C = T.catch;
  if (!(C?.balls > 0) || !(C.pass > 0 && C.pass <= C.balls) || !Array.isArray(C.steps) || !C.steps.length || !C.steps.every((s) => [4, 12, 16].includes(s.plan))) bad('catch 블록 이상');
  if (!Array.isArray(C.grades) || C.grades.length !== 3 || !Array.isArray(T.resultMsg) || T.resultMsg.length !== 4) bad('등급 표 이상');
  const S = T.special;
  if (!(S?.balls > 0) || !(S.pass > 0 && S.pass <= S.balls) || !Array.isArray(S.steps) || S.steps.length !== 1 || S.steps[0].plan !== 4 || !Array.isArray(S.grades) || S.grades.length !== 3 || !(S.gaugeHold > 0)) bad('special 블록 이상');
  if (![C, S].every((b) => (b.holder === 0 || b.holder === 1) && b.steps.every((s) => T.messages?.[s.intro])) || !T.retryMsg?.catch || !T.retryMsg?.special) bad('holder/말풍선 번호 이상');
  if (!(T.frames?.intro > 0 && T.frames.result > 0 && T.frames.fade > 0 && T.frames.settleMax > 0)) bad('frames 이상');
  if (!(Number.isInteger(T.frames.idleMax) && T.frames.idleMax > 0 && Number.isInteger(T.frames.totalMax) && T.frames.totalMax >= T.frames.idleMax)) bad('frames.idleMax/totalMax 이상(자작 안전망 상한)');
}

let cache = null;
export function loadData() {
  if (!cache) {
    const d = {
      rules: rd('rules.json'), teams: rd('teams.json').teams, court: rd('court.json'), specials: rd('specials.json'),
      stages: rd('stages.json').stages, campaign: rd('campaign.json').chapters, formations: rd('formations.json'),
      rom: rd('romtables.json'), // ROM 추출 표(각도 분해·거리·몸통 클래스). analysis/scripts/dump_feel_tables.py
      training: rd('training.json'), // 특훈 표(analysis/29 §4-2). Match 옵션 training 을 줄 때만 쓰인다
    };
    validateCampaign(d);
    validateTraining(d);
    validateFormations(d.formations);
    cache = d;
  }
  return cache;
}
