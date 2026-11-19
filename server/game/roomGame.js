// 한 방의 한 판: 엔진 구동(60Hz 드리프트 보정), 입력 래치, 스냅샷 전송, 일시정지, 결과 레코드.
import { randomUUID } from 'node:crypto';
import { Match } from '../engine/index.js';
import { GRACE_MS } from '../net/protocol.js';
import { mono, loadLimits } from '../net/limits.js';

const END_HOLD_FALLBACK = 90; // 엔진 endHold 가 없을 때만
const MAX_CATCHUP = 4;

export class RoomGame {
  /**
   * @param {{roomCode:string, seats:[{nick:string, team:number},{nick:string, team:number}], data:any,
   *   send:(seat:number, obj:object|string)=>void, onEnd:(res:object)=>void, store:{append:Function}, build:string, seed?:number}} o
   */
  constructor(o) {
    this.o = o;
    this.matchId = randomUUID();
    this.startedAt = Date.now();
    this.seed = (o.seed ?? (Math.random() * 0xffffffff)) >>> 0;
    // 컴퓨터 좌석(seats[i].cpu): 조작 선수 포함 전원을 AI가 움직이고, 끊김·일시정지·기권 대상이 아니다.
    this.cpuSeat = o.seats.findIndex((s) => s.cpu);
    const cpuLevels = [0, 1].map((i) => (o.seats[i].cpu ? o.seats[i].level : null));
    this.campaign = o.campaign ?? null; // {k, stage}: 싱글 캠페인 경기(서버가 정한 값)
    this.league = o.league ?? null; // {i, j}: 리그 카드(PROTOCOL §10). game_start·결과 레코드에 싣는다
    this.training = o.training ?? null; // {kind}: 특훈(혼자 하기). 팀·스테이지는 엔진이 training.json 으로 정한다. 결과 레코드를 남기지 않는다
    this.match = new Match({
      seed: this.seed, teams: [o.seats[0].team, o.seats[1].team], data: o.data,
      humans: [!o.seats[0].cpu, !o.seats[1].cpu], cpuLevels, stage: o.stage ?? 0,
      specialChance256: [0, 1].map((i) => (o.seats[i].cpu ? o.seats[i].special256 : undefined)),
      limitFrames: o.rules?.limitFrames, ruleMode: o.rules?.mode, // 규칙 창 값(없으면 rules.json 기본)
      ...(this.training ? { training: { kind: this.training.kind } } : {}),
      ...(o.flame ? { flame: o.flame } : {}), // 불꽃의 계승(PROTOCOL §12): 엔진 flame 옵션 그대로. 주지 않으면 종전 경로
    });
    this.input = [{ cur: 0, latch: 0 }, { cur: 0, latch: 0 }];
    this.paused = [false, false];
    this.pauseDeadline = [0, 0];
    this.done = false;
    this.limits = o.limits ?? loadLimits();
    this.pausedMs = [0, 0]; // 좌석별 누적 일시정지(단조 ms)
    this.pauseSince = [0, 0];
    this.disconnects = [0, 0];
    this.nextAt = mono(); // 단조 시계
    this.snapEvery = o.data.rules.snapEvery;
    // 특훈 상한(자작 안전망, 원작에 없음): 특훈은 시계가 없어 방이 끝나지 않을 수 있다. training.json frames.idleMax / totalMax
    this.trainCap = this.training ? { idle: o.data.training.frames.idleMax, total: o.data.training.frames.totalMax } : null;
    this.lastInputF = 0; // 사람 좌석의 입력(bits != 0)이 마지막으로 들어온 엔진 프레임
  }

  startPayload(seat, resumed) {
    return { t: 'game_start', matchId: this.matchId, resumed, you: seat, ...(this.campaign ? { campaign: { k: this.campaign.k } } : {}), ...(this.league ? { league: { ...this.league } } : {}), ...this.match.info(),
      ...(this.o.flameCast ? { flameCast: { seat: this.match.fl?.seat ?? 0, ...this.o.flameCast } } : {}), // 불꽃의 계승 표시용 정의(팀명·선수 이름·skin, PROTOCOL §12.2). 엔진을 거치지 않는다. flame 경기가 아니면 키가 없다
    };
  }

  begin() {
    for (const s of [0, 1]) this.o.send(s, this.startPayload(s, false));
    this.broadcastSnap(this.match.snapshot());
  }

  /** 재접속한 좌석에 현재 상태 전송 (이벤트 없는 스냅샷) */
  resume(seat) {
    this.o.send(seat, this.startPayload(seat, true));
    this.o.send(seat, this.match.snapshot(false));
  }

  setInput(seat, bits) {
    const i = this.input[seat];
    i.cur = bits; i.latch |= bits; // 틱 사이 짧은 탭도 놓치지 않도록 래치
  }

  setConnected(seat, connected) {
    if (this.done || seat === this.cpuSeat) return; // 컴퓨터 좌석은 끊김 대상 아님
    if (this.match.result) return; // 승패 확정 후(연출 구간)에는 일시정지하지 않는다
    const wasSeat = this.paused[seat];
    if (!connected === wasSeat) return;
    const was = this.paused[0] || this.paused[1];
    this.paused[seat] = !connected;
    if (!connected) {
      this.pauseSince[seat] = mono();
      if (++this.disconnects[seat] > this.limits.maxDisconnects) { this.abort(1 - seat, 'forfeit_disconnect'); return; }
    } else this.pausedMs[seat] += mono() - this.pauseSince[seat];
    this.pauseDeadline[seat] = connected ? 0 : Date.now() + Math.min(GRACE_MS, Math.max(0, this.limits.maxPauseMs - this.pausedMs[seat]));
    const now = this.paused[0] || this.paused[1];
    if (!was && now) {
      this.o.send(1 - seat, { t: 'game_pause', seat, nick: this.o.seats[seat].nick, deadline: this.pauseDeadline[seat] });
    } else if (was && !now) {
      this.nextAt = mono();
      for (const s of [0, 1]) this.o.send(s, { t: 'game_resume' });
    }
  }

  /** 서버 루프에서 호출. 예외는 호출자가 방 단위로 처리한다. */
  step(now) {
    if (this.done) return;
    if (this.paused[0] || this.paused[1]) {
      this.nextAt = now;
      for (const s of [0, 1]) {
        if (this.paused[s] && this.pausedMs[s] + (now - this.pauseSince[s]) > this.limits.maxPauseMs) { this.abort(1 - s, 'forfeit_disconnect'); return; }
      }
      return;
    }
    const dt = 1000 / this.match.R.tickRate;
    let n = 0;
    while (this.nextAt <= now && n < MAX_CATCHUP && !this.done) {
      this.nextAt += dt; n++;
      const bits = [0, 1].map((s) => { const i = this.input[s]; const b = i.latch; i.latch = i.cur; return b; });
      this.match.tick(bits);
      if (this.match.f % this.snapEvery === 0) this.broadcastSnap(this.match.snapshot());
      if (this.match.result && this.match.f - this.match.endF >= (this.match.endHold || END_HOLD_FALLBACK)) this.finish(this.match.result.winner, this.match.result.reason, this.match.result.rem);
      else if (this.trainCap && !this.match.result) { // 완료 연출 중에는 끊지 않는다
        if (bits[0] | bits[1]) this.lastInputF = this.match.f;
        if (this.match.f >= this.trainCap.total) this.finish(-1, 'cap');
        else if (this.match.f - this.lastInputF >= this.trainCap.idle) this.finish(-1, 'idle');
      }
    }
    if (n === MAX_CATCHUP) this.nextAt = Math.max(this.nextAt, now - dt * 2); // 과도한 지연 포기
  }

  broadcastSnap(snap) {
    const str = JSON.stringify(snap);
    this.o.send(0, str); this.o.send(1, str);
  }

  /** 외부 종료(기권/오류) */
  abort(winner, reason) {
    if (this.done) return;
    const r = this.match.result; // 이미 승패가 났으면 그 결과를 유지한다
    if (r) this.finish(r.winner, r.reason, r.rem);
    else this.finish(winner, reason);
  }

  finish(winner, reason, remFixed) {
    if (this.done) return;
    this.done = true;
    const { seats } = this.o;
    const rem = remFixed ?? this.match.result?.rem ?? [this.match.sides[0].remaining, this.match.sides[1].remaining];
    const endedAt = Date.now();
    const res = {
      t: 'game_end', matchId: this.matchId, winner, winnerNick: winner >= 0 ? seats[winner].nick : null,
      reason, rem, ticks: this.match.f,
      ...(this.match.fl ? { flame: this.match.flameResult() } : {}), // flame 경기만: 라인업 순서의 최종 HP·최대 HP·치사 생존 사용(도전 상태 저장용)
    };
    if (this.training || this.o.noRecord) { this.o.onEnd(res); return; } // 특훈은 저장·보상이 없다(analysis/29 §1-7): 결과 레코드를 쓰지 않는다. noRecord = 불꽃의 계승 연습 경기(PROTOCOL §13.15)도 같다
    // 랭크 방(PROTOCOL §11): 레코드를 쓰기 전에 레이팅을 반영해 ranked·ratingDelta 를 함께 남긴다. wentGo = GO 이후 종료인지(이전이면 무효)
    let rankRec = null;
    if (this.o.onRanked) {
      try { rankRec = this.o.onRanked({ matchId: this.matchId, winner, reason, wentGo: this.match.phase !== 'ready' }); } catch (e) { console.error('[ranking]', e); }
    }
    try {
      this.o.store.append({
        matchId: this.matchId, roomCode: this.o.roomCode, startedAt: new Date(this.startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(),
        players: seats.map((s, i) => (s.cpu ? { seat: i, nickname: s.nick, team: s.team, cpu: true, cpuLevel: s.level } : { seat: i, nickname: s.nick, team: s.team })),
        ...(this.cpuSeat >= 0 ? { vsCpu: true, cpuLevel: seats[this.cpuSeat].level } : {}),
        ...(this.campaign ? { campaign: { k: this.campaign.k, stage: this.match.stageInfo.id } } : {}),
        ...(this.league ? { league: { ...this.league, stage: this.match.stageInfo.id } } : {}),
        ...(this.o.onRanked ? { ranked: true, ratingCounted: !!rankRec?.counted, ratingDelta: rankRec?.delta ?? [0, 0] } : {}),
        rules: { mode: this.match.ruleMode, limitFrames: this.match.limitFrames },
        winner: res.winnerNick, loser: winner >= 0 ? seats[1 - winner].nick : null,
        endReason: reason, ticks: this.match.f, remaining: rem, seed: this.seed,
        buildVersion: this.o.build, rulesVersion: this.match.R.version,
      });
    } catch (e) { console.error('[results]', e); }
    this.o.onEnd(res);
  }
}
