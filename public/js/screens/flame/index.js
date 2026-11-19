// 불꽃의 계승(PROTOCOL §13, 기획 analysis/36 §12). 한 모듈에서 화면을 모드로 나눈다(league.js 와 같은 형태):
//   home(모드 메인) / perm(영구 성장) / codex(선수·장비·아티팩트 도감) / records(기록 및 업적) / rank(도달 순위, §13.13) / end(도전 종료)
//   run(도전 진행): 서버 상태로 바탕 화면이 정해진다 — 풀지 않은 선택(pending) = reward·rest·recruit·event, 열린 노드 = shop·train, 그 밖 = map(진행 지도).
//                   그 위에 겹쳐 여는 화면(sub) = team(선수 관리) / inv(장비 관리) / artifact(아티팩트·필살기 슬롯) / formation / items(소모품)
// 상태는 서버가 단일 출처다: main.js 가 app.flame(최근 flame_state)·app.flameEnd(아직 보여 주지 않은 flame_end 요약)에 두고 이 화면은 그것만 그린다.
// 조작은 번호·ID 만 보내고 응답 flame_state 로 다시 그린다. 거절은 전부 토스트(main.js). 재접속 복구 = flame_get.
// 사용: app.go('flame', { mode?: 'home' | 'auto' })  (auto = 종료 요약이 있으면 end, 도전이 있으면 run, 없으면 home)
import { h, clear } from '../../util.js';
import { net } from '../../net.js';
import { toast } from '../../ui.js';
import { arrowNav } from '../../pix.js';
import { available as lineupOk } from '../lineup.js';
import { available as prematchOk } from '../prematch.js';
import * as F from './store.js';
import { imageAt } from '../../game/assets.js';
import * as Skin from './skin.js';
import { padNav, pname, bindCast, castOf, ORIG_EMBLEM, nodeIcons } from './ui.js';
import * as Home from './home.js';
import * as RunV from './run.js';
import * as Team from './team.js';
import * as Rank from './rank.js';
import './matchhud.js'; // 불꽃의 계승 경기에서만 켜지는 HP 숫자 층(일반 경기 HUD 는 그대로)

const VIEWS = {
  home: Home.home, perm: Home.perm, codex: Home.codex, records: Home.records, end: Home.end, rank: Rank.rank,
  intro: RunV.intro, champ: RunV.champ, map: RunV.map, reward: RunV.reward, shop: RunV.shop, train: RunV.train, rest: RunV.rest, recruit: RunV.recruit, event: RunV.event,
  team: Team.team, inv: Team.team, artifact: Team.artifact, formation: Team.formation, items: Team.items,
};
const SUBS = ['team', 'inv', 'artifact', 'formation', 'items'];
/** 도전 진행의 바탕 화면(서버 상태에서) */
export function runBase(run) {
  const p = run.pending?.[0];
  if (p) return p.kind === 'equipment' || p.kind === 'artifact' ? 'reward' : p.kind;
  if (run.node) return run.node.type === 'shop' ? 'shop' : 'train';
  return 'map';
}

// 화면을 다시 열어도(경기·편성 화면에서 돌아올 때) 남는 선택 상태
const S = { selP: 0, selSlot: 'headband', selInst: null, cmpP: null, cmpKey: null, segView: null, codexTab: 'equip', codexSel: null, artSel: null, spP: 0, trainP: 0, restP: 0, recP: null, recKey: null, recSel: 0, fmSel: null, itemSel: null, itemP: 0, runId: null };

export function mount(root, app, data = {}) {
  let mode = ['home', 'auto', 'run'].includes(data.mode) ? data.mode : 'home';
  if (app.flameEnd) mode = 'auto'; // 아직 보여 주지 않은 종료 요약이 남아 있으면 어디서 들어오든 그것부터 보인다(다음 도전 중에 뒤늦게 뜨지 않게)
  let sub = null, offNav = null, offView = null, busy = false, busyT = 0, alive = true, last = null, wantRun = false, healed = false;
  let peek = false, req = null, seen = null; // peek = 휴식실에서 지도 보기 / req = 마지막으로 보낸 요청 / seen = 직전 상태 요약(획득·구매 토스트용)
  S.newAsk = false; S.abAsk = false; // 확인 창은 화면을 다시 열 때 닫힌 상태로
  const offPad = padNav();
  nodeIcons(); // 지도 노드 아이콘 manifest 경로 → CSS 변수(한 번)
  const st = () => app.flame ?? null;

  const ctx = {
    root, app, S,
    st, run: () => st()?.run ?? null, team: () => st()?.team ?? null, prof: () => st()?.profile ?? null,
    get sub() { return sub; },
    /** 서버 요청(응답 flame_state 가 올 때까지 겹쳐 보내지 않는다) */
    send(t, d = {}) {
      if (busy) return false;
      busy = true; clearTimeout(busyT); busyT = setTimeout(() => { busy = false; }, 4000);
      net.send(t, d); req = t;
      return true;
    },
    go(m) { mode = m; sub = null; peek = false; if (m === 'rank') net.send('flame_ranking_get', {}); paint(true); }, // 순위는 들어갈 때마다 새로 받는다(응답 = flame_ranking, flame_state 가 아니라 busy 를 걸지 않는다)
    /** 풀지 않은 휴식 선택을 둔 채 지도를 본다(on = false 면 휴식실로 돌아간다) */
    peek(on) { peek = !!on; sub = null; paint(true); },
    get peeking() { return peek; },
    /** 새 도전을 요청했다: 도전이 담긴 상태가 오면 도전 진행 화면으로 */
    expectRun() { wantRun = true; },
    open(s) { if (SUBS.includes(s)) { sub = s; paint(true); } },
    close() { sub = null; paint(true); },
    paint: () => paint(),
    leave: () => app.go('lobby'),
    startMatch,
  };

  function viewName() {
    const s = st();
    if (mode === 'auto') mode = app.flameEnd ? 'end' : s.run ? 'run' : 'home';
    if (mode === 'end' && !app.flameEnd) mode = s.run ? 'run' : 'home';
    if (mode === 'run') {
      if (!s.run) { mode = app.flameEnd ? 'end' : 'home'; sub = null; return mode; }
      S.segments = s.run.segments ?? S.segments;
      if (S.segSeen !== s.run.seg) { S.segSeen = s.run.seg; S.segView = null; } // 구간이 넘어가면 보던 구간 탭을 현재 구간으로
      if (S.runId !== s.run.id) Object.assign(S, { runId: s.run.id, selP: 0, selInst: null, cmpP: null, cmpKey: null, segView: null, artSel: null, artSlot: null, spP: 0, trainP: 0, restP: 0, recP: null, recKey: null, recSel: 0, fmSel: null, fmPrev: null, itemSel: null, itemP: 0, abAsk: false });
      const base = runBase(s.run);
      if (base !== 'rest') peek = false;
      // 우승(엔드리스, PROTOCOL §13.12): 경기에서 flame_result.champion 을 받고 돌아온 그 도전에서 한 번. 다른 도전의 것이 남아 있으면 버린다
      if (app.flameChamp && !(app.flameChamp.run === s.run.id && s.run.championed)) app.flameChamp = null;
      if (!sub && app.flameChamp) return 'champ';
      if (!sub && RunV.introDue(s.run, S)) return 'intro'; // 오리지널 팀으로 막 시작한 도전: 팀 소개 한 화면(한 번)
      return sub ?? (peek ? 'map' : base);
    }
    sub = null;
    return mode;
  }

  function paint(first = false) {
    if (!alive) return;
    const fe = document.activeElement;
    const keep = root.contains(fe) ? fe.dataset?.k : null;
    const sc = {};
    for (const el of root.querySelectorAll('[data-sc]')) sc[el.dataset.sc] = el.scrollTop;
    offView?.(); offView = null;
    clear(root);
    const s = st();
    let name = 'loading', v = null;
    if (!s || !F.ensureCatalog(s.catalogVer)) root.append(h('div.center-screen', h('div.muted', '불러오는 중…')));
    else {
      try { bindCast(s.run); name = viewName(); v = VIEWS[name](ctx, name) ?? {}; }
      catch (e) {
        // 그리다 실패(카탈로그와 상태가 어긋난 경우 등): 캐시를 버리고 카탈로그를 한 번 새로 받는다. 그래도 실패하면 로비로
        console.warn('flame view', name, e);
        clear(root); name = 'loading'; v = null;
        if (healed) { toast('화면을 열 수 없습니다', 'error'); setTimeout(() => { if (alive) app.go('lobby'); }, 0); }
        else { healed = true; F.dropCatalog(); F.ensureCatalog(s.catalogVer); }
        root.append(h('div.center-screen', h('div.muted', '불러오는 중…')));
      }
    }
    offView = v?.off ?? null;
    offNav?.(); offNav = arrowNav(root, { onEsc: v?.esc ?? (() => app.go('lobby')) });
    const fresh = first || name !== last;
    last = name;
    if (!fresh) for (const el of root.querySelectorAll('[data-sc]')) if (sc[el.dataset.sc]) el.scrollTop = sc[el.dataset.sc];
    const want = (!fresh && keep && root.querySelector(`[data-k="${CSS.escape(keep)}"]:not(:disabled)`)) || root.querySelector('[data-first]') || root.querySelector('button:not(:disabled)');
    setTimeout(() => { if (alive && want?.isConnected && !root.contains(document.activeElement)) want.focus({ preventScroll: !fresh }); }, 30);
  }

  /**
   * 경기 노드: 라인업(VS) → 내 팀 편성(최종 능력치) → flame_node. 혼합 로스터라 얼굴·이름·능력치를 출신 기준으로 넘긴다.
   * 오리지널 선수 칸(run.cast.players[i], PROTOCOL §13.8)은 이름 = cast, 얼굴 = 빌린 몸(skin.team·skin.idx)에 색 세트를 입힌 그림, 팀 머리 = cast.team(이름·약칭·엠블럼)으로 넘긴다
   */
  let starting = false;
  function startMatch(node) {
    const run = ctx.run(), team = ctx.team();
    if (!run || !node?.opp || starting) return;
    bindCast(run);
    const casts = run.roster.map((r) => castOf(r.from)), ct = casts.find((c) => c?.team)?.team ?? null;
    const stats = team.players.map((p) => F.SIX_KEYS.map((k) => p.final[k]));
    const back = () => app.go('flame', { mode: 'run' });
    const begin = (faces, emb) => {
      const me = run.roster.map((r, i) => (casts[i] ? { team: casts[i].skin?.team ?? r.from.team, idx: casts[i].skin?.idx ?? r.from.idx, name: casts[i].p.name, face: faces[i] ?? null } : { ...r.from }));
      const head = ct ? { name: ct.name, abbr: typeof ct.short === 'string' ? ct.short : '', emblem: emb } : null;
      const tid = run.roster[0].from.team; // 좌석 대표 팀 id(종전 그대로. 머리 표시는 head 가 있으면 그것)
      const steps = [];
      if (lineupOk()) steps.push((next) => app.go('lineup', { teams: [tid, node.opp.team], rosters: [me, null], heads: [head, null], labels: ['1P', 'COM'], onCancel: back, onExit: next }));
      if (prematchOk()) steps.push((next) => app.go('prematch', { team: tid, roster: me, head, stats, label: '1P', onCancel: back, onExit: next }));
      let sent = false; // 편성 EXIT 를 거듭 눌러도 flame_node 는 한 번만
      const go = (k) => {
        if (k < steps.length) return steps[k](() => go(k + 1));
        if (sent) return;
        sent = true; net.send('flame_node', { id: node.id });
      };
      go(0);
    };
    if (!casts.some(Boolean)) return begin([], null); // 종전 도전: 기다릴 그림이 없다
    starting = true; // 색 입힌 얼굴·엠블럼이 준비된 뒤 넘어간다(실패한 칸은 원본 그림)
    Promise.all([Promise.all(casts.map((c) => (c?.skin ? Skin.faceCanvas(c.skin) : null))).catch(() => []), ct ? imageAt(ORIG_EMBLEM).catch(() => null) : null])
      .then(([faces, emb]) => { starting = false; if (alive && app.view === 'flame') begin(faces, emb); });
  }

  /** 상태 요약: 요청 전후를 견줘 획득·구매·성장 완료를 토스트 한 줄로 알린다 */
  const digest = (s) => (s ? { run: s.run?.id ?? null, items: s.run?.items?.length ?? 0, arts: s.run?.artifactsOwned?.length ?? 0, artIds: s.run?.artifactsOwned ?? [],
    sold: (s.run?.node?.stock ?? []).filter((g) => g.sold).length, perm: (s.profile?.permList ?? []).reduce((a, u) => a + (u.lv ?? 0), 0) } : null);
  function showDone(m) {
    const was = seen, now = digest(m), r = req;
    seen = now; req = null;
    if (!was || !now || !r || m.note) return;
    if (r === 'flame_perm') { if (now.perm > was.perm) toast('성장 완료', 'ok'); return; }
    if (now.run === null || now.run !== was.run) return;
    if (r === 'flame_buy' && now.sold > was.sold) toast('구매 완료', 'ok');
    else if (r === 'flame_choose' && now.arts > was.arts) {
      // off(§13.26): 받은 아이템 이름 + 종류(필살기·포메이션 아이템). 받은 것은 자동으로 끼지 않는다
      const id = F.artOff() ? now.artIds.find((x) => !was.artIds.includes(x)) : null, d = id ? F.artDef(id) : null, g = F.grantOf(d);
      toast(F.artOff() ? (g ? `${F.ITEM_KO[g.kind]} 획득 ${F.artName(d)}` : '아이템 획득') : '아티팩트 획득 — 장착 가능', 'ok');
    }
    else if (r === 'flame_choose' && now.items > was.items) toast('장비 획득 — 장착 가능', 'ok');
  }
  seen = digest(st());
  /** 영입실 입장 회복(PROTOCOL §13.16 flame_state.run.recruitHeal{pct,total}): 올랐으면 토스트 한 번. 본 방문(도전 id:구간:층)을 localStorage 에 적어 새로고침·재접속 때 다시 띄우지 않는다 */
  const HEAL_KEY = 'dd.flame.roomHeal';
  function showRoomHeal(m) {
    const r = m?.run, hl = r?.recruitHeal;
    if (!r || !hl || !(hl.total > 0)) return;
    const k = `${r.id}:${r.seg}:${r.layer}`;
    if (S.healSeen === k) return;
    try { if (localStorage.getItem(HEAL_KEY) === k) { S.healSeen = k; return; } localStorage.setItem(HEAL_KEY, k); } catch { /* 저장 불가: 이 화면 동안만 기억 */ }
    S.healSeen = k;
    toast(`전원 회복 +${hl.total}`, 'ok');
  }

  /** 이벤트 결과(flame_state.note): 토스트 한 줄 */
  function showNote(n) {
    // 장비 보유 상한(PROTOCOL §13.12): 고른 장비가 받는 즉시 판매가만큼 경기 포인트로 바뀌었다
    // 등급 아이템(PROTOCOL §13.22): 더 높은 등급을 얻어 갖고 있던 낮은 등급이 자동 판매됐다(note = {upgraded, id, sold, points})
    if (n?.upgraded) { const d = F.artDef(n.id), o = F.artDef(n.sold); toast(`${F.artName(d)} ${o?.grade ?? ''} → ${d?.grade ?? ''} · 자동 판매 +${Number.isFinite(n.points) ? n.points : 0}`, 'ok', 4200); return; }
    // 무효가 된 선택(서버 .m15, note = {voided, id}): 이미 같거나 높은 등급을 갖고 있어 받지 못했다(남은 칸은 다시 고른다)
    if (n?.voided) { toast(`${F.artName(F.artDef(n.id))} — 이미 같거나 높은 등급 보유`.replace(/^ — /, ''), 'warn', 4200); return; }
    if (n?.full) { toast(`장비가 가득 차 ${Number.isFinite(n.sold) ? n.sold : 0} 포인트로 바뀌었습니다`, 'warn', 4200); return; }
    if (!n || !Array.isArray(n.results)) return;
    const out = [];
    for (const r of n.results) {
      if (r.op === 'points') out.push(`경기 포인트 ${F.sgn(r.value)}`);
      else if (r.op === 'hpAll') out.push(`전원 HP ${F.sgn(r.value)}`);
      else if (r.op === 'hpAllPct') out.push(`전원 HP ${F.sgn(r.value)}%`);
      else if (r.op === 'hpCaptain') out.push(`주장 HP ${F.sgn(r.value)}`);
      else if (r.op === 'trainRandom') { const p = ctx.run()?.roster?.[r.p]; out.push(`${p ? pname(p.from) : ''} ${F.statName(r.stat)} ${F.sgn(r.value)}`.trim()); }
      else if (r.op === 'gamble') out.push(r.win ? `내기 승리 경기 포인트 +${r.value}` : '내기 패배');
      else if (r.op === 'gainEquipment') out.push(Number.isFinite(r.sold) ? `장비가 가득 차 ${r.sold} 포인트로 바뀌었습니다` : `장비 획득 ${F.equipDef(r.id)?.name ?? ''}`);
      else if (r.op === 'gainConsumable') out.push(`소모품 획득 ${F.consDef(r.id)?.name ?? ''}`);
      else if (r.op === 'gainArtifact') { const d = F.artDef(r.id), g = F.grantOf(d); out.push(`${F.artOff() ? F.ITEM_KO[g?.kind] ?? '아이템' : '아티팩트'} 획득 ${F.artName(d)}`); }
    }
    toast(out.length ? out.join(' · ') : '아무 일도 일어나지 않았다', 'ok', 4200);
  }

  F.loadExtras().then(() => { if (alive && st()) paint(); });
  paint(true);
  net.send('flame_get');
  // 내 순위 한 줄(모드 메인·종료 화면): flame_state 에는 순위가 없어 순위표 응답의 me 만 쓴다(flame_ranking_get{top:1}, PROTOCOL §13.13. 손님 = me:null → 줄 없음)
  const askMyRank = () => net.send('flame_ranking_get', { top: 1 });
  askMyRank();

  return {
    onFlameState(m) {
      busy = false; clearTimeout(busyT);
      if (wantRun && m.run) { wantRun = false; if (mode !== 'end') { mode = 'run'; sub = null; } }
      if (m.note) showNote(m.note);
      showDone(m);
      showRoomHeal(m);
      paint();
    },
    onFlameCatalog() { paint(); },
    onFlameRanking() { if (mode === 'rank' || mode === 'home' || mode === 'end') paint(); },
    onFlameEnd() { mode = 'end'; sub = null; askMyRank(); },
    // 카탈로그 요청이 거절되면 '불러오는 중'에 머물지 않게 로비로 돌아간다(거절 사유는 main.js 토스트)
    /** 거절 토스트 문구를 이 화면이 정한다(main.js 가 먼저 묻는다. null = 종전 문구). 부여 구조(§13.21)의 슬롯 지정 거절 = 그 선수가 쓸 수 없는 슛 */
    errText(m) {
      if (m?.code !== 'FLAME_LOCKED') return null;
      if (req === 'flame_special' && F.artOff()) return '그 선수의 필살기 아이템이 아닙니다'; // off: 자기 아이템의 슛 + 고유 슛만
      if (req === 'flame_formation' && F.gradeOn()) return '장착한 포메이션 아이템만 고를 수 있습니다'; // 등급제(§13.22): 기본 + 낀 아이템의 패턴만
      return req === 'flame_special' && F.granted() ? '부여되지 않은 필살기입니다' : null;
    },
    onError() { busy = false; wantRun = false; req = null; clearTimeout(busyT); F.catalogRetry(); const s = st(); if (!s || !F.catalogReady(s.catalogVer)) app.go('lobby'); },
    onWelcome() { net.send('flame_get'); if (mode === 'rank') net.send('flame_ranking_get', {}); else askMyRank(); },
    unmount() { alive = false; offView?.(); offNav?.(); offPad(); clearTimeout(busyT); },
  };
}
