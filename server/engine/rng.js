// 원작 난수(0x14EA) 이식 [확인]. seed(=$E620)는 VBlank마다 +2, 호출 시 아래 식으로 갱신.
export class Rng {
  constructor(seed = 0) { this.seed = seed >>> 0; }
  /** VBlank 틱마다 호출 ($E620 += 2) */
  vblank() { this.seed = (this.seed + 2) >>> 0; }
  /** 16비트 난수 */
  next() {
    const s = this.seed === 0 ? 0x2a6d365a : this.seed;
    const t = Math.imul(s, 41) >>> 0;
    const r = ((t & 0xffff) + (t >>> 16)) & 0xffff;
    this.seed = (((r << 16) | (t & 0xffff)) >>> 0);
    return r;
  }
  /** 0..n-1 */
  int(n) { return this.next() % n; }
}
