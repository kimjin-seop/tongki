// 경기 후 흐름(서브 9·10). 근거 analysis/53 §1-3·§7, 팀장 결정(2026-11-20): 패배 → 컨티뉴 창(예 = 다시 도전, 아니오 = 챕터 목록), 승리 → 약 32f 페이드 후 진행.
// 컨티뉴 창 문구 = data/rom_derived/story_remaining_ko_draft.json 초안(0x12B6E·0x12B7E·0x12B84). 용어 미확정(초안 uncertain) — 확정되면 여기만 바꾼다.
export const CONTINUE_TEXT = { prompt: '컨티뉴하겠습니까?', yes: '예', no: '아니오' };

/**
 * 컨티뉴 예: 원작 0x12AB4~0x12B4C. k≤6 → 제목 카드부터, k 7~13 → 세계 지도부터(미구현 → 제목 카드부터), k=14 → 맞대면만(설정·페이드 없이, 무음).
 * @returns {'card'|'faceoff'}
 */
export const continueTo = (k) => (k === 14 ? 'faceoff' : 'card');

/**
 * 승리 끝: k=2·14 는 이어지는 장면(win 세그먼트 1)이 같은 장면 안에서 먼저 나온다. 그 뒤 화면 전체 페이드 아웃 약 32f + 0xE0(k=6 은 0xE0 없음, 0x12748).
 * 다음: final(15전) → 엔딩 그림, 그 밖 → 다음 경기 제목 카드(세계 지도·세이브 창·7번째 승리 이벤트는 미구현).
 */
export const winFadeBgmOff = (k) => k !== 6;
