export const ONE = 65536;
export const BIT = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, B: 16, C: 32, A: 64, S: 128 };
export const ST = {
  IDLE: 0, JUMP: 1, DASH: 2, BRAKE: 3, CHARGE: 4, THROW: 5, PASS: 6, CATCH: 7, CROUCH: 8,
  PICKUP: 9, HIT: 10, DOWN: 11, OUTMOVE: 12, DEAD: 13, GONE: 14, FOUL: 15, // FOUL = 선 이탈(원작 타입 0x48)
};
export const BM = { HELD: 0, FLY: 1, PASS: 2, LOOSE: 3, DROP: 4 };
export function slotGroup(slot) { return slot < 4 ? 0 : slot < 7 ? 1 : slot < 10 ? 2 : 3; } // 0내야 1상 2하 3후방
export const FM = { GATHER: 0, HOLD: 1, PASS: 2, END: 3 }; // 포메이션 어택 단계 (snap.fm.st)
// 경기별 규칙 옵션(원작 규칙 창, analysis/28 §2-1): 규칙 ノックアウト(체력제)/こうしき(공식), 경기 시간 むせいげん(0)/3/5/8분
export const RULE_MODES = ['knockout', 'official'];
export const RULE_TIMES = [0, 3, 5, 8];
