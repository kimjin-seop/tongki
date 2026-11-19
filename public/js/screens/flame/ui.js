// 불꽃의 계승 화면 공용 부품: 아이템 아이콘(희귀도 테두리는 아이콘 바깥 CSS), 선수 얼굴·이름·스프라이트, 능력치 표, HP 막대, 게임패드 → 포커스 이동.
import { h } from '../../util.js';
import { toast } from '../../ui.js';
import { has, image } from '../../game/assets.js';
import { face, emblem } from '../../pix.js';
import { playerName, teamName } from '../../names.js';
import * as F from './store.js';
import * as Skin from './skin.js';

/**
 * 아이템 아이콘 32x32(정수배 확대, image-rendering: pixelated). 슬롯 바탕은 밝은 남회색(#404860 이상), 희귀도 색은 바깥 테두리.
 * def = 장비·아티팩트·소모품 정의. o.lv = 강화 단계 표시, o.dim = 미발견(실루엣), o.n = 개수
 */
export function icon(def, o = {}) {
  const url = F.iconUrl(def);
  const cls = def?.rarity ? `.r-${def.rarity}` : def?.category ? '.k-art' : '.k-cons';
  return h('span.fl-ic' + cls + (o.dim ? '.dim' : '') + (o.big ? '.big' : ''), { 'aria-hidden': 'true' },
    url ? h('img', { src: url, alt: '', width: 32, height: 32, draggable: false, loading: 'lazy' }) : null,
    o.lv ? h('b.fl-ic-lv', `+${o.lv}`) : null, o.n > 1 ? h('b.fl-ic-n', String(o.n)) : null);
}
/** 없는 필살기의 습득 조건(카탈로그의 계열·아티팩트 정의에서) 토스트 한 줄 */
export function learnTip(id) {
  const who = F.josa(F.shotName(id), '은/는'), arts = F.shotGivers(id).map((a) => a.name).filter(Boolean);
  toast(arts.length ? `${who} 아티팩트 ${arts.map((n) => `「${n}」`).join(' 또는 ')} 장착 시 사용 가능` : `${who} 아티팩트가 있어야 쓸 수 있습니다`, 'info');
}
/** 빈 슬롯 칸 */
export const emptyIcon = (label = '') => h('span.fl-ic.vac', { 'aria-hidden': 'true' }, label);

// ---- 오리지널 팀(PROTOCOL §13.8): flame_state.run.cast = {team|null, players[7]}(지금 라인업 순서). players[i] 가 있으면 그 칸 선수는 이름·외형(skin)을 cast 에서,
// 없으면(원작 선수·cast 가 없는 종전 도전) 종전대로 출신 {team, idx} 에서 찾는다. 화면은 선수 칸을 roster[i].from 객체로 넘기므로 그 객체에 cast 칸을 걸어 둔다
// (영입 후보·도감처럼 로스터 밖에서 만든 {team, idx} 는 걸리지 않아 종전 그대로다).
// 영입 풀 클론(PROTOCOL §13.10): 로스터의 클론 칸은 cast.players[i] = {kind:'clone', name, role, skin}(시작 선수와 같은 길), 영입 후보의 클론 칸
// {kind:'clone', id, name, role, stat, sp, skin} 도 같은 표에 건다(cand = 아직 우리 팀이 아니다). kind 가 없거나 모르는 값이면 종전 그대로다.
const CAST = new WeakMap();
const shotId = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
/** 상태가 바뀔 때마다(index.js paint) 로스터 칸·영입 후보 칸에 cast 를 건다 */
export function bindCast(run) {
  for (const pd of Array.isArray(run?.pending) ? run.pending : []) {
    if (pd?.kind !== 'recruit' || !Array.isArray(pd.choices)) continue;
    for (const c of pd.choices) {
      if (!c || typeof c !== 'object' || c.kind !== 'clone' || typeof c.name !== 'string' || !c.name) continue;
      CAST.set(c, { p: c, team: null, skin: Skin.validSkin(c.skin), cand: true });
    }
  }
  const c = run?.cast;
  if (!c || !Array.isArray(c.players) || !Array.isArray(run.roster)) return;
  const team = c.team && typeof c.team.name === 'string' && c.team.name ? c.team : null;
  run.roster.forEach((r, i) => {
    const p = c.players[i];
    if (r?.from && p && typeof p === 'object' && typeof p.name === 'string' && p.name) CAST.set(r.from, { p, team, skin: Skin.validSkin(p.skin) });
  });
}
/** 로스터 밖의 선수 칸(도감 등)에 표시용 정의를 건다: obj = {team, idx}(능력치·필살기 출처), p = {name, role?, skin?, kind?}, team = 오리지널 팀 정의 | null. obj 를 돌려준다 */
export function castFor(obj, p, team = null) { CAST.set(obj, { p, team: team && typeof team.name === 'string' && team.name ? team : null, skin: Skin.validSkin(p.skin) }); return obj; }
/** 그 선수 칸의 cast 정의 {p, team, skin} 또는 null(원작 선수) */
export const castOf = (from) => (from && typeof from === 'object' ? CAST.get(from) ?? null : null);
/** 로스터 밖에서 만든 {team, idx}(도감 등)를 지금 도전의 같은 출신 로스터 칸으로 바꾼다(없으면 그대로) */
export const rosterFrom = (run, f) => run?.roster?.find((r) => !r.clone && !isClone(r.from) && r.from.team === f.team && r.from.idx === f.idx)?.from ?? f;
/** 영입 풀 클론인가(로스터 칸·영입 후보 칸). 클론의 from = 몸을 빌린 원작 선수라 출신 팀·원작 이름·원작 필살기를 쓰면 안 된다 */
export const isClone = (from) => castOf(from)?.p.kind === 'clone';
/** 선수의 원래 필살기 ID | null: 클론 = 자기 값(영입 후보 칸·cast.players[i] 의 sp, PROTOCOL §13.12 — 새로고침 뒤에도 서버가 준다), 그 밖 = 출신 선수의 ROM 표(종전) */
export function ownShotOf(from) {
  const c = castOf(from);
  if (c?.p.kind !== 'clone') return F.ownShot(from);
  return shotId(c.p.sp);
}

export function pface(from, flip = false) {
  const sk = castOf(from)?.skin;
  if (!sk) return face(from.team, from.idx, flip);
  const el = face(sk.team, sk.idx, flip); // 색을 바꾼 그림이 준비되기 전·실패 = 빌린 몸의 원본 얼굴
  Skin.faceUrl(sk).then((u) => { if (u) el.style.background = `#000 url("${u}") 0 0 / 100% 100% no-repeat`; });
  return el;
}
export const pname = (from) => castOf(from)?.p.name ?? playerName(from.team, from.idx);
/** 순위표 핵심 선수 이름(PROTOCOL §13.13): '@팀:번호' = 원작 선수 이름, 그 밖(오리지널·클론) = 문자열 그대로 */
export const rankName = (s) => { const m = /^@(\d{1,3}):(\d{1,2})$/.exec(String(s ?? '')); return m ? playerName(Number(m[1]), Number(m[2])) : String(s ?? ''); };
export const tname = (team) => teamName(team, `팀 ${team + 1}`).replace(/\s*국민학교$/, '');
export { emblem };
/** 오리지널 팀 엠블럼(24x16 한 장. 원작 엠블럼 시트 16칸과 따로 둔다: 크기 배율은 .emb 의 --ek 그대로) */
export const ORIG_EMBLEM = 'flame-legacy/emblem/bulssi_24x16.png';
export const origEmblem = () => h('span.emb.fl-emb-o', { 'aria-hidden': 'true' });
export const castTeamName = (team) => String(team.name).replace(/\s*국민학교$/, '');
/** 선수의 소속 표시 [엠블럼, 팀 이름]: 오리지널 선수 = cast 팀, 원작 선수 = 출신 팀. 팀이 없는 클론(영입 후보·종전 태동 도전의 클론) = 역할 이름(몸을 빌린 팀은 소속이 아니다) */
export const pteam = (from) => {
  const c = castOf(from);
  if (c?.team) return [origEmblem(), castTeamName(c.team)];
  if (c?.p.kind === 'clone') return F.roleName(c.p.role) || '';
  return [emblem(from.team), tname(from.team)];
};

/**
 * 표시할 HP { hp, max, up }: 다음 경기 소모품으로 출전 HP 가 늘어 있으면(flame_state.run.matchHp[i].bonus > 0) 출전값(up = true),
 * 아니면(또는 서버가 matchHp 를 주지 않으면) 종전대로 roster[i].hp / 최종 체력
 */
export function hpOf(run, team, i) {
  const m = run.matchHp?.[i];
  if (m && m.bonus > 0 && Number.isFinite(m.hp) && Number.isFinite(m.max)) return { hp: m.hp, max: m.max, up: true };
  return { hp: run.roster[i].hp, max: team.players[i].final.s0, up: false };
}
/** HP 막대(현재/최대). 30% 이하 빨강. up = 출전 HP(소모품으로 늘어난 값) */
export function hpBar(hp, max, up = false) {
  const r = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  return h('span.fl-hp' + (r <= 0.3 ? '.low' : '') + (up ? '.up' : ''), { role: 'img', 'aria-label': `HP ${hp}/${max}` },
    h('i', { style: { width: `${Math.round(r * 100)}%` } }), h('b.tabular', `${hp}/${max}`));
}

/** 선수 스프라이트(출신 팀 시트 80x80 칸, 서 있는 자세 = 24열, 오른쪽 보기 = 선수 번호 x 2행). 시트가 없으면 얼굴만 */
const STAND_COL = 24;
export function sprite(from) {
  const sk = castOf(from)?.skin, body = sk ?? from; // 오리지널 선수 = 빌린 몸(skin.team·skin.idx) + 색 세트
  const key = `spr.team.${String(body.team).padStart(2, '0')}`;
  const c = h('canvas.fl-spr', { width: 48, height: 56, 'aria-hidden': 'true' });
  if (!has(key)) return c;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  (sk ? Skin.standCanvas(sk) : Promise.resolve(null)).then((st) => {
    if (st) { g.drawImage(st, 16, 8, 48, 56, 0, 0, 48, 56); return null; }
    return image(key).then((img) => g.drawImage(img, STAND_COL * 80 + 16, body.idx * 2 * 80 + 8, 48, 56, 0, 0, 48, 56));
  }).catch((e) => console.warn('flame sprite', e.message));
  return c;
}

/** 화면 머리: 제목 + (정보 칸) + 돌아가기 */
export const head = (title, onBack, ...extra) => h('header.fl-head', h('h1.pix-title.fl-title', title), h('div.fl-head-x', extra),
  onBack ? h('button.btn.small.back', { type: 'button', 'data-k': 'back', onclick: onBack }, '돌아가기') : null);
/** 정보 칸: 라벨 + 값 */
export const chip = (label, value, cls = '') => h('span.fl-chip' + cls, h('i', label), h('b.tabular', value));
export const btn = (label, k, onclick, cls = '', attrs = {}) => h('button.btn' + cls, { type: 'button', 'data-k': k, onclick, ...attrs }, label);

/**
 * 능력치 표(선수 관리): 기본 / 장비 / 그 밖(영구·특훈·아티팩트·포메이션·시너지·소모품) / 최종.
 * pl = flame_state.team.players[i] (steps[9], delta, over, move). preview = 장비를 바꿨을 때 장비 칸 변화 {stat: 증감}(비교)
 */
export function statTable(pl, preview = null) {
  const stepAdd = (id) => pl.steps.find((s) => s.id === id)?.add ?? {};
  const eq = stepAdd('equipment');
  const others = ['permanent', 'training', 'artifact', 'formation', 'synergy', 'consumable'].map(stepAdd);
  const rows = F.STAT_KEYS.map((k) => {
    const u = F.statUnit(k), e = eq[k] ?? 0, o = others.reduce((s, a) => s + (a[k] ?? 0), 0), pv = preview?.[k] ?? 0;
    const notes = [];
    if (pl.over?.[k]) notes.push(h('span.fl-warn', `상한 −${pl.over[k]}`));
    if (k === 's2' && pl.move?.wasted > 0) notes.push(h('span.fl-warn', `낭비 ${pl.move.wasted}`));
    return h('tr' + (pl.delta[k] ? '.chg' : ''),
      h('th', { scope: 'row' }, F.statName(k)),
      h('td.tabular', `${pl.base[k]}${u}`),
      h('td.tabular' + (e > 0 ? '.up' : e < 0 ? '.down' : '.zero'), e ? F.sgn(e) : '·'),
      h('td.tabular' + (o > 0 ? '.up' : o < 0 ? '.down' : '.zero'), o ? F.sgn(o) : '·'),
      h('td.tabular.fin', `${pl.final[k]}${u}`, notes),
      preview ? h('td.tabular' + (pv > 0 ? '.up' : pv < 0 ? '.down' : '.zero'), pv ? F.sgn(pv) : '·') : null);
  });
  const none = F.STAT_KEYS.every((k) => !(eq[k] ?? 0));
  return h('table.fl-stats', h('thead', h('tr', h('th', ''), h('th', '기본'), h('th', '장비'), h('th', '기타'), h('th', '최종'), preview ? h('th', '비교') : null)),
    h('tbody', rows), none ? h('caption', '장비 변화 없음') : null);
}

/** 방향 패드·A/B 버튼 → 화살표·Enter·Esc 키 이벤트로 바꿔 화면의 키보드 처리(pix.js arrowNav)와 같은 길로 보낸다. 불꽃의 계승 화면이 떠 있는 동안만 돈다(경기 화면 입력과 겹치지 않는다) */
export function padNav() {
  let raf = 0, prev = 0, at = 0;
  const KEYS = [[12, 'ArrowUp'], [13, 'ArrowDown'], [14, 'ArrowLeft'], [15, 'ArrowRight']];
  const fire = (key) => {
    if (key === 'Enter') { const a = document.activeElement; if (a && a !== document.body && typeof a.click === 'function') a.click(); return; }
    dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const pads = navigator.getGamepads?.() ?? [];
    let bits = 0;
    for (const p of pads) {
      if (!p?.connected) continue;
      KEYS.forEach(([b], i) => { if (p.buttons[b]?.pressed) bits |= 1 << i; });
      const [ax = 0, ay = 0] = p.axes ?? [];
      if (ay < -0.6) bits |= 1; if (ay > 0.6) bits |= 2; if (ax < -0.6) bits |= 4; if (ax > 0.6) bits |= 8;
      if (p.buttons[0]?.pressed) bits |= 16;
      if (p.buttons[1]?.pressed) bits |= 32;
    }
    const down = bits & ~prev;
    if (down) at = now + 380; // 누른 순간 1회, 누르고 있으면 반복
    else if (bits & 15 && now >= at) at = now + 130;
    else { prev = bits; return; }
    prev = bits;
    const use = down || (bits & 15);
    KEYS.forEach(([, key], i) => { if (use & (1 << i)) fire(key); });
    if (down & 16) fire('Enter');
    if (down & 32) fire('Escape');
  };
  if (typeof navigator.getGamepads === 'function') raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
