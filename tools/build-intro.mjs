// 인트로 재생용 축약 타임라인: public/assets/rom/intro/intro_timeline.json(약 618KB, 프레임별 기록)
//   -> public/assets/rom/intro/intro_play.json (웹 재생에 필요한 값만, 변화 시점·런 길이로 압축)
// 근거·좌표 규칙: analysis/10_intro_title.md §2·§3·§7. 실행: node tools/build-intro.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public/assets/rom/intro');
const src = JSON.parse(readFileSync(path.join(dir, 'intro_timeline.json'), 'utf8'));

const F0 = 342; // 파란 화면(불덩이) 시작. SEGA 로고(상표)·검정 공백은 재생하지 않는다
const F1 = 2845; // 로고 상승 끝(최종 타이틀 위치)
const byF = new Map(src.frames.map((fr) => [fr.f, fr]));
const frame = (f) => byF.get(f);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const inR = (f, a, b) => f >= a && f <= b;

/** 값 배열 -> [[f, v], ...] 변화 시점만 */
function changes(fs, get) {
  const out = []; let prev;
  for (const f of fs) { const v = get(f); const s = JSON.stringify(v); if (s !== prev) { out.push([f, v]); prev = s; } }
  return out;
}

// 백드롭: 흰 페이드 구간(띠 장면 끝·타이틀 페이드인)은 원래 색 위에 흰 오버레이로 근사하므로 기준색으로 둔다
const bg = changes(range(F0, F1), (f) => {
  if (inR(f, 1313, 1336) || inR(f, 2383, 2406)) return '#000000';
  if (inR(f, 2514, 2540)) return '#246cfc';
  return frame(f)?.bg ?? '#000000';
});
const gray = (hex) => parseInt(hex.slice(1, 3), 16) / 252;
// 화면 전체 오버레이 [색, 알파] (§3-4 팔레트 페이드 근사)
const ov = changes(range(F0, F1), (f) => {
  const fr = frame(f);
  if (inR(f, 1313, 1336) || inR(f, 2383, 2406)) return ['#fcfcfc', +gray(fr.bg).toFixed(3)]; // 흰색으로 페이드아웃(원본 백드롭 회색 단계 = 진행도)
  if (inR(f, 1337, 1401) || inR(f, 2407, 2513)) return ['#fcfcfc', 1];
  if (inR(f, 1402, 1410)) return [fr.bg, 1]; // 회색 한 번 → 검정
  if (inR(f, 2514, 2537)) return ['#fcfcfc', +(Math.ceil((2538 - f) / 4) / 7).toFixed(3)]; // 4f 간격 7단계
  return null;
});
// 라이벌 장면 단색 띠 색(화면 (2,100)). 띠 그림 장면(6·8)은 이 픽셀이 일러스트에 가려 색 순환 판정에 쓰지 않는다
const band = changes(range(1411, 2204), (f) => frame(f)?.band ?? '#000000');
const ah = changes(range(1025, 2407), (f) => frame(f)?.Ah?.[0] ?? 0);
// 라이벌 실루엣: 일러스트 팔레트(라인1) black k
const sil = changes(range(1411, 2204), (f) => {
  const m = frame(f)?.fade?.[1];
  return m && m[0] === 'black' ? +Math.max(0, Math.min(1, m[1])).toFixed(2) : 0;
});
// 로고 플래시: 라인1 'other' k>=0.25 = 플래시 이미지, 작은 값(f691~702 반짝임) = 반투명
const flash = changes(range(650, 961), (f) => {
  const m = frame(f)?.fade?.[1];
  if (!m || m[0] !== 'other') return 0;
  return m[1] >= 0.25 ? 1 : 0.4;
});

// 와이프 띠: 프레임별 [y,x0,x1,색] -> 같은 x0/x1/색이 이어지는 행은 [y,h,x0,x1,색번호] 로 묶음
const pal = [];
const ci = (c) => { let i = pal.indexOf(c); if (i < 0) { i = pal.length; pal.push(c); } return i; };
const wipe = src.tracks.wipe_spans.data.map((spans) => {
  const s = [...spans].sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[3].localeCompare(b[3]) || a[0] - b[0]);
  const out = [];
  for (const [y, x0, x1, c] of s) {
    const last = out[out.length - 1];
    const k = ci(c);
    if (last && last[2] === x0 && last[3] === x1 && last[4] === k && last[0] + last[1] === y) last[1]++;
    else out.push([y, 1, x0, x1, k]);
  }
  return out;
});

const lines = (t) => ({ f0: t.f0, y0: t.y0, lines: t.lines.map((l) => [l.x0, l.vx_avg]) });
const frames = (name) => src.assets[name].frames;

const out = {
  _note: 'tools/build-intro.mjs 가 intro_timeline.json 에서 생성. 직접 수정 금지. f = 부팅 후 프레임(60fps), 재생 구간 f0~f1',
  f0: F0, f1: F1,
  scenes: src.scenes.filter((s) => s.f1 >= F0).map((s) => [s.id, Math.max(s.f0, F0), Math.min(s.f1, F1)]),
  bg, ov, band, ah, sil, flash,
  subWhite: [[511, 0.8], [544, 0.55], [553, 0.3], [560, 0]], // 소로고 흰색→원색 3단계(§2 장면3)
  logoRise: [2830, 2], // f2830 부터 2px/f, 32px 까지(§2 장면10)
  fireball: { f0: src.tracks.fireball.f0, data: src.tracks.fireball.data, cells: frames('intro_fireball.png') },
  flame: { f0: src.tracks.flame_burst.f0, screen: src.tracks.flame_burst.screen, runs: src.tracks.flame_burst.runs, cells: frames('intro_flame_burst.png') },
  ball: { f0: src.tracks.ball.f0, data: src.tracks.ball.data, cells: frames('intro_ball.png') },
  streaks: { cells: frames('intro_streaks.png'), fire: src.tracks.streaks_fire, cyan: src.tracks.streaks_cyan },
  bandFire: lines(src.tracks.band_fire),
  bandCyan: lines(src.tracks.band_cyan),
  wipe: { f0: src.tracks.wipe_spans.f0, pal, data: wipe },
};
for (const k of ['fire', 'cyan']) out.streaks[k] = { f0: out.streaks[k].f0, data: out.streaks[k].data };
const file = path.join(dir, 'intro_play.json');
writeFileSync(file, JSON.stringify(out));
console.log('wrote', path.relative(root, file), JSON.stringify(out).length, 'bytes');
