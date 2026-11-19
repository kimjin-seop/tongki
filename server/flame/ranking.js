// 불꽃의 계승 도달 순위표(PROTOCOL §13.13, analysis/39 D27). 새 DB 표 없이 flame_profiles 의 JSON(best.rank)만 쓴다.
// 서버 시작 때 영구 저장 전 행을 한 번 읽어 메모리 표를 만들고(rebuild), 그 뒤에는 저장할 때마다 그 계정의 줄만 고친다(update).
// 계정(accounts 표에 있는 키)만 오른다. 손님 행·격리 키(guest-aside:·flame-broken:)는 accounts 에 없어 빠진다.
// 정렬: 최고 도달 구간 내림차순 -> 그 도전의 승수 내림차순 -> 먼저 달성한 사람(달성 시각 오름차순) -> 키. 구간·승수가 같으면 같은 순위다.
// 규모: 전 행을 메모리에 두고 조회 때 정렬 결과를 캐시한다(기록이 바뀌면 다시 정렬). 유저 수만 명까지는 문제없지만 그 이상이면 시작 시간·정렬 비용이 커진다 -> 그때 전용 표(또는 색인 열)로 옮긴다(운영 DB DDL 승인 필요)
import { rankRecordOf } from './run.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const nat = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

/** 저장된 영구 저장 JSON(검증 전)에서 순위 기록만 꺼낸다. 형식이 틀리면 null(그 줄만 빠진다). segments = 우승 기준 구간 수(엔드리스 이전 우승자 보정, run.js rankRecordOf) */
export function rankOfRaw(data, segments = 0) {
  if (!isObj(data) || !isObj(data.best)) return null;
  const r = rankRecordOf({ best: { seg: nat(data.best.seg), wins: nat(data.best.wins), clears: nat(data.best.clears), rank: isObj(data.best.rank) && Number.isInteger(data.best.rank.seg) && data.best.rank.seg >= 1 ? data.best.rank : undefined } }, segments);
  if (!r) return null;
  return { seg: r.seg, wins: nat(r.wins), at: nat(r.at), team: (Array.isArray(r.team) ? r.team : []).filter((x) => typeof x === 'string').slice(0, 3), diff: nat(r.diff) };
}

export class FlameRanking {
  /** @param {{store:{allProfiles?:Function}, isAccount:(key:string)=>boolean, top?:number, segments?:number, log?:Function}} o segments = 우승 기준 구간 수(rules.json run.segments) */
  constructor(o) {
    this.o = o; this.top = o.top ?? 50; this.segments = o.segments ?? 0; this.rows = new Map(); this.sorted = null;
    try { this.rebuild(); } catch (e) { o.log?.('[flame] 순위표를 만들지 못했습니다(빈 표로 시작):', e?.message ?? e); }
  }

  /** 영구 저장 전 행에서 다시 만든다(서버 시작 때 1회) */
  rebuild() {
    this.rows.clear(); this.sorted = null;
    for (const p of this.o.store.allProfiles?.() ?? []) {
      const r = this.o.isAccount(p.key) ? rankOfRaw(p.data, this.segments) : null;
      if (r) this.rows.set(p.key, { key: p.key, nick: p.nick, ...r });
    }
  }

  /**
   * 저장 직후: 그 키의 줄을 지금 영구 저장 값으로 맞춘다. 손님 키는 올리지 않는다.
   * 저장은 조작마다 일어나지만 순위 기록은 거의 바뀌지 않는다 -> 줄이 실제로 달라질 때만 계정 판정(accounts SELECT)을 하고 정렬 캐시를 버린다
   */
  update(key, nick, profile) {
    const r = rankOfRaw(profile, this.segments), old = this.rows.get(key);
    if (!r) { if (old) { this.rows.delete(key); this.sorted = null; } return; }
    if (old && old.nick === nick && old.seg === r.seg && old.wins === r.wins && old.at === r.at && old.diff === r.diff && old.team.join('\n') === r.team.join('\n')) return;
    if (this.o.isAccount(key)) this.rows.set(key, { key, nick, ...r });
    else if (old) this.rows.delete(key);
    else return;
    this.sorted = null;
  }

  #list() {
    if (!this.sorted) {
      const a = [...this.rows.values()].sort((x, y) => y.seg - x.seg || y.wins - x.wins || x.at - y.at || (x.key < y.key ? -1 : 1));
      let rank = 0;
      a.forEach((r, i) => { if (i === 0 || r.seg !== a[i - 1].seg || r.wins !== a[i - 1].wins) rank = i + 1; r.rank = rank; });
      this.sorted = a;
    }
    return this.sorted;
  }

  /** @returns {{top:object[], me:object|null, total:number}} me = 계정이면 내 줄(기록이 없으면 rank:null), 손님이면 null */
  board(top = this.top, meKey = null, meNick = meKey) {
    const a = this.#list(), row = (r) => ({ rank: r.rank, nick: r.nick, seg: r.seg, wins: r.wins, team: r.team.slice(), diff: r.diff, at: r.at });
    let me = null;
    if (meKey && this.o.isAccount(meKey)) { const r = this.rows.get(meKey); me = r ? row(r) : { rank: null, nick: meNick, seg: 0, wins: 0, team: [], diff: 0, at: 0 }; }
    return { top: a.slice(0, Math.min(top, this.top)).map(row), me, total: a.length };
  }
}
