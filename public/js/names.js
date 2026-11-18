// 팀·선수 표시 이름(manifest data.names.teams). 로드 실패·누락 시 서버가 준 이름을 그대로 쓴다
import { has, json } from './game/assets.js';

let teams = [];

export async function loadNames() {
  if (!has('data.names.teams')) return;
  try { teams = (await json('data.names.teams')).teams ?? []; } catch (e) { console.warn('names', e); }
}

/** 선수 표시 이름 배열(idx 0~6). 없으면 빈 배열 */
export const teamPlayers = (id) => teams.find((t) => t.id === id)?.players ?? [];

export const teamName =(id, fallback = '') => teams.find((t) => t.id === id)?.name ?? fallback;

/** 팀 목록용 이름: 이름이 겹치는 팀(0·22 태동)을 구분하는 label, 없으면 name */
export const teamLabel = (id, fallback = '') => teams.find((t) => t.id === id)?.label ?? teamName(id, fallback);
