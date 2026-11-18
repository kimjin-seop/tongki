// 포메이션 어택 작전 이름(PROTOCOL 5.6): snap.fm 이 집합(st 0)·대기(st 1) 단계인 동안 화면 상단 중앙에 작게 그린다(패스 시작 = fm_ready 에서 사라짐).
// 원작 그래픽(spr.formation name_NN)은 일본어라 쓰지 않고 dottext 한글로 그린다. 이름 번호(0~14, ROM 순서) → 한글은 analysis/14_formation_cutin.md §3.4.
// 위치: 상단 벽 구간(y 44~68, 예전 필살기 컷인 자리) 아래 y 74 고정, 원작 작전 배너 자리(y 80~96) 근처. 원작 이름 그래픽처럼 50% 체커 디더 검정 바탕.
import { W } from './render.js';
import { dotMask, dotCanvas } from './dottext.js';

export const FM_NAMES_KO = ['오복성 패스', 'V자 패스', '도카치다케', '다이몬지', '류큐 어택', '호뢰관', '야마노테', '엔드 어택',
  '믹스 패스', '모스크완', '파르테논', '샌드위치', '모아이 갓', '파라오 어택', '스타 크래시'];
export const fmNameKo = (n) => FM_NAMES_KO[n] ?? '포메이션 어택';

const Y = 74, PAD = 3, TEXT_H = 10, MAX_W = 140;
const FONT = '"DD UI", sans-serif';

export class FmName {
  constructor() { this.cache = new Map(); }

  /** 디더 바탕 + 글자를 합친 캔버스(이름·폰트 준비 상태별 캐시) */
  img(name) {
    const ok = globalThis.document?.fonts?.check?.(`${TEXT_H}px ${FONT}`, '가') ?? true;
    const key = name + ok;
    if (!this.cache.has(key)) {
      const t = dotCanvas(dotMask(name, { h: TEXT_H, font: FONT, th: 0.55, ct: 0.65, maxW: MAX_W }), { fill: '#fcfcfc' });
      const c = document.createElement('canvas');
      c.width = t.width + PAD * 2; c.height = t.height + PAD * 2;
      const g = c.getContext('2d');
      g.fillStyle = '#000';
      for (let y = 0; y < c.height; y++) for (let x = y & 1; x < c.width; x += 2) g.fillRect(x, y, 1, 1);
      g.drawImage(t, PAD, PAD);
      this.cache.set(key, c);
    }
    return this.cache.get(key);
  }

  draw(g, a) {
    const fm = a.fm;
    if (!fm || fm.st > 1) return;
    const c = this.img(fmNameKo(fm.name));
    g.drawImage(c, Math.round((W - c.width) / 2), Y);
  }
}
