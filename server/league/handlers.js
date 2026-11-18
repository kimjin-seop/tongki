// 리그 요청 핸들러(PROTOCOL §10). Lobby.makeHandlers 에 섞여 this = Lobby 로 불린다.
// 저장은 this.leagues(get/set/flush)만 쓴다. 사람 낀 카드는 특훈 방처럼 비공개 방을 만들어 바로 시작하고, 끝나면 방을 없앤다.
import { randomInt, randomUUID } from 'node:crypto';
import {
  makeLeague, applyConfig, derive, cardOk, cardSides, recordWin, quickJudge, teamRating, homeStage,
  SAVE_AFTER_FINAL, LEAGUE_CPU_LEVEL, SPECIAL_UNLOCK_CLEARED,
} from './rules.js';

const NORMAL_END = ['annihilation', 'timeup', 'sudden_death'];

const specialOf = (lobby, s) => lobby.progress.get(s.key).clearedMax >= SPECIAL_UNLOCK_CLEARED;

export function leagueStateMsg(lobby, s, lg = lobby.leagues.get(s.key)) {
  const special = specialOf(lobby, s);
  if (!lg) return { t: 'league_state', league: null, table: null, special };
  const d = derive(lg);
  return { t: 'league_state', league: lg, table: d.table, special, ...(lg.done ? { champions: d.champions } : {}) };
}

/** 경기 결과 저장 + league_state(+ 끝났으면 league_end) 전송 */
function saveAndReport(lobby, s, lg) {
  if (!(lg.done && !SAVE_AFTER_FINAL)) lobby.leagues.set(s.key, s.nick, lg);
  lobby.sendTo(s, leagueStateMsg(lobby, s, lg));
  if (lg.done) lobby.sendTo(s, { t: 'league_end', champions: derive(lg).champions });
}

export function makeLeagueHandlers(fail) {
  const ready = (lobby, s) => { lobby.leagueRate(s); if (s.roomCode) fail('ALREADY_IN_ROOM'); };
  const need = (lobby, s) => lobby.leagues.get(s.key) ?? fail('LEAGUE_NONE');
  return {
    league_get(s) {
      this.leagueRate(s);
      this.sendTo(s, leagueStateMsg(this, s));
    },
    // 새 리그(있으면 덮어쓴다. '처음부터' 확인은 클라이언트가 한다)
    league_new(s, m) {
      ready(this, s);
      const r = makeLeague(m, specialOf(this, s), Date.now(), randomUUID());
      if (r.code) fail(r.code);
      this.leagues.set(s.key, s.nick, r.league);
      this.sendTo(s, leagueStateMsg(this, s, r.league));
    },
    // 설정 변경: 팀별 사람/컴퓨터(com[]), 규칙. 팀 수·턴 수·대전 결과는 그대로
    league_config(s, m) {
      ready(this, s);
      const lg = need(this, s);
      const code = applyConfig(lg, m);
      if (code) fail(code);
      lg.updatedAt = Date.now();
      this.leagues.set(s.key, s.nick, lg);
      this.sendTo(s, leagueStateMsg(this, s, lg));
    },
    league_abandon(s) {
      ready(this, s);
      this.leagues.set(s.key, s.nick, null);
      this.sendTo(s, leagueStateMsg(this, s, null));
    },
    // 카드 (i = 행, j = 열). 컴-컴 = 즉시 판정, 사람이 끼면 비공개 방에서 실제 경기
    league_play(s, m) {
      ready(this, s);
      const lg = need(this, s);
      if (!cardOk(lg, m.i, m.j)) fail('LEAGUE_CARD_INVALID');
      const { left, right } = cardSides(lg, m.i, m.j);
      const tl = lg.teams[left], tr = lg.teams[right], D = this.o.data;
      if (tl.com && tr.com) {
        const r = this.o.leagueRand?.() ?? randomInt(256); // 난수 1바이트(analysis/29 §2-5)
        const q = quickJudge(teamRating(D.teams[tl.team]), teamRating(D.teams[tr.team]), r);
        const winner = q.leftWins ? left : right;
        recordWin(lg, winner, q.leftWins ? right : left);
        this.sendTo(s, { t: 'league_result', i: m.i, j: m.j, left, right, winner, quick: true, p: q.p, r });
        saveAndReport(this, s, lg);
        return;
      }
      if (!tr.com) fail('LEAGUE_CARD_INVALID'); // 사람끼리 카드(사람 팀 최대 1이라 생기지 않는다)
      if (this.rooms.size >= this.limits.maxRooms) fail('TOO_MANY_ROOMS');
      const room = this.makeRoom(this.newCode(), true, LEAGUE_CPU_LEVEL, null, { ...lg.rules });
      room.league = { id: lg.id, i: m.i, j: m.j, left, right, stage: homeStage(D.stages, tr.team) };
      room.cpuTeam = tr.team;
      this.join(s, room, tl.team);
      this.startGame(room);
    },
  };
}

/**
 * 사람 낀 리그 경기 종료(Lobby.onGameEnd 에서 game_end 전송 뒤 1회). 정상 종료 = 승자 기록, 기권(forfeit_*) = 사람 패배,
 * draw_cap·error 는 기록하지 않는다. 그 사이 리그가 바뀌었으면(id 불일치·카드 이미 다 침) 기록하지 않는다.
 * 그다음 방을 없애고 room_left 로 돌려보낸다(특훈 방과 같은 정리, removeFromRoom 이 부른 종료면 그쪽이 정리한다)
 */
export function leagueEnd(lobby, room, res) {
  const s = room.seats[0]?.s, c = room.league;
  let winner = null, recorded = false;
  const lg = s ? lobby.leagues.get(s.key) : null;
  if (lg && lg.id === c.id && cardOk(lg, c.i, c.j)) {
    const ws = NORMAL_END.includes(res.reason) && (res.winner === 0 || res.winner === 1) ? res.winner
      : String(res.reason).startsWith('forfeit_') ? 1 : null; // 사람은 언제나 좌석 0
    if (ws !== null) {
      winner = ws === 0 ? c.left : c.right;
      recordWin(lg, winner, ws === 0 ? c.right : c.left);
      recorded = true;
    }
  }
  if (s) {
    lobby.sendTo(s, { t: 'league_result', matchId: res.matchId, i: c.i, j: c.j, left: c.left, right: c.right, winner, quick: false, reason: res.reason, recorded });
    if (recorded) saveAndReport(lobby, s, lg);
    else lobby.sendTo(s, leagueStateMsg(lobby, s));
    if (!room.closing && lobby.roomOf(s) === room) lobby.removeFromRoom(s, 'leave');
  }
  lobby.markListDirty();
}
