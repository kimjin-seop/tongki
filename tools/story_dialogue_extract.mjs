// 원작 스토리 대사 전 블록 + 제목 카드 15장 -> data/rom_derived/story_dialogue_jp.json (ROM 파생물, /data/ 는 .gitignore)
// 근거: analysis/48_story_chapter_intro.md §2-2·§3·§4, 구현 1단계 §10. ROM(rom/danpei.gen)은 읽기만 한다.
// 실행: node tools/story_dialogue_extract.mjs [--out <경로>]
//
// ROM 규칙(디스어셈블 0x1205C~0x1236C, 글자 변환 0x21C0 / 0x1429A)
// - 블록 포인터 표 0x752E2(롱 64개). 경기 k(0~14) = 경기 전 4k, 맞대면 4k+1, 승리 후 4k+2, 패배 후 4k+3 (선택 표 0x752A2/0x752B2/0x752C2/0x752D2)
// - 바이트: 0x00~0x16 화자 바꾸기(이름 표 0x750BA+10*id 를 쓰고 줄바꿈), 0x17 줄바꿈, 0x18 페이지 끝(버튼 대기), 0x19 블록 끝
//   0x1D ー, 0x1E 、, 0x1F 。, 0x5B 「, 0x5D 」, 그 밖은 0x21C0 문자 변환(가나·탁점·반탁점)
// - 속도: 바이트 하나(화자·줄바꿈 포함)마다 $E40A=3 -> 4프레임에 1스텝. 。(0x1F) 를 찍은 뒤에는 $E40A=0x30 -> 49프레임 뒤 다음 스텝
// - 타이핑음: 변환 타일 0x60~0xD0(가나와 ー)을 찍을 때만, 화자별 효과음 표 0x7528A. 화자 0x16(내레이션)은 소리 없음
// - 입: 같은 범위 글자에서 켜지고(0x1230C) 범위 밖 글자에서 꺼짐(0x121E2). 다음 바이트가 」(0x5D)면 그 글자 뒤에 끔(0x121CA)
// - 버튼(A/B/C): 찍는 중이면 페이지 끝까지 한 번에 찍고 0xA0, 페이지 끝이면 다음 페이지
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argOut = process.argv.indexOf('--out');
const outPath = argOut > 0 ? path.resolve(process.argv[argOut + 1]) : path.join(root, 'data/rom_derived/story_dialogue_jp.json');
const R = readFileSync(path.join(root, 'rom/danpei.gen'));
const hex = (n, w = 0) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');
const u32 = (a) => R.readUInt32BE(a);

// --- 문자 변환 (analysis/scripts/romtext.py 와 같은 표 = ROM 0x21C0) ---
const HIRA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
const KATA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
const T = {};
[...HIRA].forEach((c, i) => { T[0x60 + i] = c; });
[...KATA].forEach((c, i) => { T[0x97 + i] = c; });
[...'ァィゥェォッャュョ'].forEach((c, i) => { T[0xC5 + i] = c; });
Object.assign(T, { 0x93: 'っ', 0x94: 'ゃ', 0x95: 'ゅ', 0x96: 'ょ' });
const DV = {}; const DP = {};
[...'かきくけこさしすせそたちつてとはひふへほ'].forEach((c, i) => { DV[c] = 'がぎぐげござじずぜぞだぢづでどばびぶべぼ'[i]; });
for (const [k, v] of Object.entries({ ...DV })) DV[String.fromCharCode(k.charCodeAt(0) + 96)] = String.fromCharCode(v.charCodeAt(0) + 96);
DV['ウ'] = 'ヴ';
[...'はひふへほ'].forEach((c, i) => { DP[c] = 'ぱぴぷぺぽ'[i]; });
for (const [k, v] of Object.entries({ ...DP })) DP[String.fromCharCode(k.charCodeAt(0) + 96)] = String.fromCharCode(v.charCodeAt(0) + 96);

/** ROM 0x21C0: 바이트 -> { tile(본 글자 타일), mark: 0 없음 / 1 탁점 / 2 반탁점 } */
function tileOf(b) {
  let d = b - 0x20;
  if (d < 0) {
    if (b === 0x1D) return { tile: 0xD0, mark: 0 };
    if (b === 0x1E) return { tile: 0xD1, mark: 0 };
    if (b === 0x1F) return { tile: 0xD2, mark: 0 };
    if (b === 0x13) return { tile: 0x99, mark: 1 };
    return { tile: b + 0xC0, mark: 0 };
  }
  if (d < 0x40) return { tile: b, mark: 0 };
  d -= 0x40; let base = 0x40;
  if (d >= 0x50) { d -= 0x50; base = 0x77; }
  let mark = 0;
  if (d >= 0x37) {
    mark = 1;
    if (d >= 0x46) { if (d < 0x4B) d += 5; else mark = 2; }
    d -= 0x32;
  }
  return { tile: d + base + 0x20, mark };
}
const SPECIAL = { 0x1D: 'ー', 0x1E: '、', 0x1F: '。', 0x5B: '「', 0x5D: '」', 0x20: ' ', 0x2E: '.', 0x21: '!', 0x3F: '?' };
function charOf(b) {
  if (SPECIAL[b]) return SPECIAL[b];
  const { tile, mark } = tileOf(b);
  if (b >= 0x20 && b < 0x60) return String.fromCharCode(b);
  const c = T[tile];
  if (!c) return `{${hex(b, 2)}}`;
  return mark === 1 ? (DV[c] ?? `{${hex(b, 2)}}`) : mark === 2 ? (DP[c] ?? `{${hex(b, 2)}}`) : c;
}
const isKanaTile = (b) => { const t = tileOf(b).tile; return t >= 0x60 && t <= 0xD0; }; // 0x12180~0x1218A

// --- 화자 표 ---
const NAME_TAB = 0x750BA; const SFX_TAB = 0x7528A;
const nameOf = (id) => [...R.subarray(NAME_TAB + 10 * id, NAME_TAB + 10 * id + 10)].filter((b) => b !== 0 && b !== 0x20).map(charOf).join('');
const speakers = [];
for (let id = 0; id <= 0x16; id++) {
  const s = R[SFX_TAB + id];
  speakers.push({ id, idHex: hex(id, 2), nameJp: nameOf(id), sfx: hex(s, 2), sfxKind: s === 0xB6 ? 'B6' : s === 0xA7 ? 'A7' : s === 0xA8 ? 'A8' : s === 0xE3 ? 'none(E3)' : hex(s, 2),
    mouthSlot: id === 0 ? 'C700(통키 쪽 왼쪽)' : (id === 0x10 || id === 0x12) ? 'CA80' : id === 0x13 ? 'C800+CA80' : 'C800(상대 쪽 오른쪽)' });
}

// --- 블록 디코드 ---
const PTR_TAB = 0x752E2; const NPTR = 64;
const ptrs = Array.from({ length: NPTR }, (_, i) => u32(PTR_TAB + 4 * i));
const END_ALL = 0x76980; // 마지막 포인터(63) = 다음 데이터 시작. 블록은 0x19 로 끝난다

/** 포인터에서 0x19(블록 끝)까지 한 '세그먼트'를 페이지로 나눈다. 이어서 다음 세그먼트가 같은 포인터 구간에 있으면 계속 */
function decodeSegment(start, speakerIn) {
  let i = start; let spk = speakerIn;
  const pages = [];
  let page = null; let line = null;
  const newPage = () => {
    page = { startsWithSpeaker: R[i] <= 0x16, speakerAtStart: spk, runs: [], kana: 0, steps: 0, frames: 0, puncPauses: 0, end: null, romStart: hex(i) };
    line = null;
  };
  const curRun = () => { let r = page.runs.at(-1); if (!r || r.speaker !== spk) { r = { speaker: spk, nameJp: spk == null ? null : nameOf(spk), lines: [''] }; page.runs.push(r); line = r; } return r; };
  newPage();
  for (;;) {
    const b = R[i]; i++;
    page.steps++;
    if (b === 0x18 || b === 0x19) {
      page.end = b === 0x18 ? 'page' : 'block'; page.frames += 4;
      pages.push(page);
      if (b === 0x19) break;
      newPage(); continue;
    }
    if (b <= 0x16) { spk = b; const r = { speaker: spk, nameJp: nameOf(spk), lines: [''] }; page.runs.push(r); page.frames += 4; continue; }
    if (b === 0x17) { const r = curRun(); r.lines.push(''); page.frames += 4; continue; }
    const r = curRun();
    r.lines[r.lines.length - 1] += charOf(b);
    if (isKanaTile(b)) page.kana++;
    if (b === 0x1F) { page.frames += 49; page.puncPauses++; } else page.frames += 4;
  }
  for (const p of pages) for (const r of p.runs) r.text = r.lines.join('\n');
  return { romStart: hex(start), romEnd: hex(i - 1), bytes: i - start, pages, nextAddr: i, speakerOut: spk };
}

function decodeBlock(idx) {
  const a = ptrs[idx];
  const limit = idx + 1 < NPTR ? Math.min(...ptrs.filter((p) => p > a), END_ALL) : END_ALL;
  const segs = []; let p = a; let spk = null;
  while (p < limit) {
    const s = decodeSegment(p, spk); segs.push(s); p = s.nextAddr; spk = s.speakerOut;
    if (idx < 60) break; // 경기 블록은 첫 세그먼트까지만 기본으로 읽는다(15번째 경기 전 블록은 아래 특례)
  }
  const tail = p < limit ? hex(p) : null;
  for (const s of segs) delete s.nextAddr;
  return { blockIndex: idx, pointer: hex(a), segments: segs, unreadTail: tail ? { from: tail, to: hex(limit) } : null };
}

const KINDS = ['pre', 'faceoff', 'win', 'lose'];
const KIND_KO = { pre: '경기 전(서브 3)', faceoff: '맞대면(서브 7)', win: '승리 후(서브 9 승리)', lose: '패배 후(서브 9 패배)' };
const SEL = { pre: 0x752A2, faceoff: 0x752B2, win: 0x752C2, lose: 0x752D2 };

// 제목 카드: ROM 그래픽(한자) 판독 결과(48 §3, titles.py 렌더). 그래픽 데이터 위치도 함께 기록
const TITLE_JP = ['第1戦 「大河への挑戦」', '第2戦 「打倒！ブラックアーマーズ」', '第3戦 「陸王との対決」', '第4戦 「大自然での戦い」', '第5戦 「落日の決戦」',
  '第6戦 「琉球の達人たち」', '第7戦 「日本最強の座はここに」', '第8戦 「世界初挑戦、中国へ」', '第9戦 「炎も凍る！氷点下の戦い」', '第10戦 「スフィンクスを撃て！」',
  '第11戦 「神殿での対決」', '第12戦 「ジャングルでの決戦」', '第13戦 「イースター島の戦慄」', '第14戦 「最強チームへの挑戦」', '第15戦 「死闘！最後の対決」'];
const STAGE = [...R.subarray(0x11EC2, 0x11EC2 + 15)];
const TEAM = [...R.subarray(0x11ED2, 0x11ED2 + 15)];

const matches = [];
let totalPages = 0; let matchPages = 0; let contPages = 0;
for (let k = 0; k < 15; k++) {
  const m = { k, chapter: k + 1, romStage: STAGE[k], romTeam: hex(TEAM[k], 2),
    title: { jp: TITLE_JP[k], number: `第${k + 1}戦`, subtitle: TITLE_JP[k].replace(/^第\d+戦 /, ''), source: 'ROM 그래픽 판독(48 §3)',
      mapPtr: hex(u32(0x743FE + 4 * k)), mapWidthByte: R[0x7443A + k], vramPos: hex(R.readUInt16BE(0x7444A + 2 * k), 4), tiles: '0x6E1EE',
      timingFrames: { blackBefore: 119, line1FadeIn: 27, line2After: 113, line2FadeIn: 27, holdBeforeOut: 82, fadeOut: 27, note: '1전 실측(12 문서) = story_cuts.json match1.card. 15장 같은 코드 경로(0x11C94)' } },
    blocks: {} };
  for (const kind of KINDS) {
    const idx = R[SEL[kind] + k];
    const blk = decodeBlock(idx);
    if (k === 14 && kind === 'pre') {
      // 0x11EEE: 경기 번호를 13 으로 바꿔 14번째 경기 배경·초상으로 0x753C2(=블록 56) 첫 세그먼트를 찍고,
      // 0x11F78~0x12058: 전용 배경 0x60FAE·초상 0x6385A·팔레트 0x74A9E 로 바꾼 뒤 같은 포인터 뒤 세그먼트를 이어 찍는다
      const s2 = decodeSegment(parseInt(blk.segments[0].romEnd, 16) + 1, blk.segments[0].pages.at(-1).runs.at(-1)?.speaker ?? null);
      delete s2.nextAddr;
      blk.segments.push(s2);
      blk.special15 = { seg0: '14번째 경기(맨해튼, 스테이지 6) 배경·초상', seg1: '전용 배경 0x60FAE + 초상 0x6385A + 팔레트 0x74A9E 로 교체 뒤', code: '0x11EEE~0x12058' };
      blk.unreadTail = null;
    }
    if (kind === 'win' && (k === 2 || k === 14)) {
      // 0x12792: 승리 블록 끝에서 k==2 -> 0x128AC(팀 그림 0x60FB6, 입 $C800 애니 0x26·$CA80 0x28), k==14 -> 0x127DC(엄마 그림 0x60FB2+0x6385E, 입 $CA80 애니 0x20) 뒤 이어 찍는다
      const s0 = blk.segments[0];
      const s2 = decodeSegment(parseInt(s0.romEnd, 16) + 1 + (R[parseInt(s0.romEnd, 16) + 1] === 0 && R[parseInt(s0.romEnd, 16) + 2] > 0x16 ? 1 : 0), s0.pages.at(-1).runs.at(-1)?.speaker ?? null);
      delete s2.nextAddr;
      blk.segments.push(s2);
      blk.continuation = k === 2 ? { code: '0x128AC', picture: '0x60FB6(팀 그림)', mouth: '$C800 애니 0x26, $CA80 애니 0x28' } : { code: '0x127DC', picture: '0x60FB2 + 0x6385E(엄마)', mouth: '$CA80 애니 0x20' };
      blk.unreadTail = null;
      contPages += s2.pages.length;
    }
    blk.kind = kind; blk.kindKo = KIND_KO[kind];
    blk.pageCount = blk.segments.reduce((n, s) => n + s.pages.length, 0);
    m.blocks[kind] = blk;
    matchPages += blk.pageCount - (blk.continuation ? blk.segments.at(-1).pages.length : 0);
  }
  m.pageCount = KINDS.reduce((n, kd) => n + m.blocks[kd].pageCount, 0);
  matches.push(m);
}
totalPages += matchPages;

// 경기 밖 블록. 60·61 은 대사 루틴이 아니라 내레이션 형식(레코드 = VRAM 이름표 주소 u16 + 글자 + 0x00, 판독)
function decodeNarration(a, limit) {
  const recs = []; let i = a;
  while (i + 2 < limit) {
    const addr = R.readUInt16BE(i); i += 2; let t = '';
    while (i < limit && R[i] !== 0x00) { t += charOf(R[i]); i++; }
    i++; recs.push({ vramAddr: hex(addr, 4), text: t });
  }
  return recs;
}
function decodeAll(a, limit, spk = null) {
  const segs = []; let p = a;
  while (p < limit) {
    if (R[p] === 0x00 && R[p + 1] > 0x16) { p++; continue; } // 짝수 정렬 채움 바이트
    const s = decodeSegment(p, spk); segs.push(s); p = s.nextAddr; spk = s.speakerOut; delete s.nextAddr;
  }
  return segs;
}
const extras = [
  { id: 'intro_narration', blockIndex: 60, pointer: hex(ptrs[60]), format: 'narration', note: '진입 컷 내레이션(서브 13) — 번역 있음(public/assets/rom/story/story_cuts.json). 레코드 머리 u16 은 VRAM 이름표 주소로 판독',
    records: decodeNarration(ptrs[60], ptrs[61]) },
  { id: 'win7_narration', blockIndex: 61, pointer: hex(ptrs[61]), format: 'narration', note: '7번째 승리 이벤트(서브 14, 표 0x753D6) 검은 화면 내레이션. 2차 범위',
    records: decodeNarration(ptrs[61], ptrs[62]) },
  { id: 'win7_letter_graduation', blockIndex: 62, pointer: hex(ptrs[62]), format: 'dialogue', note: '7번째 승리 이벤트: 다이가의 편지(서브 18) → 통키 → 졸업 인사(서브 19·20). 세그먼트별 서브 대응은 [판독 32 §1-1, 세그먼트 경계 미측정]. 2차 범위',
    segments: decodeAll(ptrs[62], END_ALL) },
  { id: 'k15_lose_tail', blockIndex: null, pointer: '0x76691', format: 'dialogue', note: '15번째 경기 패배 후 블록(59) 뒤에 붙은 세그먼트. 서브 9 패배 경로(0x12792 → 0x10C78)는 읽지 않는다. 쓰임 [미측정]',
    segments: decodeAll(0x76691, ptrs[60]) },
];
for (const e of extras) e.pageCount = e.segments ? e.segments.reduce((n, sg) => n + sg.pages.length, 0) : 0;
const extraOnlyPages = extras.reduce((n, e) => n + e.pageCount, 0) + contPages;
totalPages += extraOnlyPages;

const out = {
  schema: 'tongki.story_dialogue_jp/1',
  generatedBy: 'tools/story_dialogue_extract.mjs',
  romSha256_16: createHash('sha256').update(R).digest('hex').slice(0, 16),
  private: 'ROM 파생물. data/ 아래(.gitignore)에만 둔다. 번역 0',
  rules: {
    framesPerStep: 4, stepNote: '바이트 하나(글자·화자·줄바꿈·페이지 끝)마다 1스텝. $E40A=3 를 매 프레임 1 감소(0x1212E~0x12136)',
    afterPeriodFrames: 49, afterPeriodNote: '。(0x1F) 를 찍은 뒤 $E40A=0x30 (0x121DA) -> 49프레임 뒤 다음 스텝',
    typingSfx: '변환 타일 0x60~0xD0(가나, ー 포함) 글자마다 화자 효과음(0x7528A). 공백·、。「」!?.은 무음. 화자 0x16 무음(0x121A6)',
    mouth: '같은 범위 글자에서 입 객체 0x118 켬(0x1230C), 범위 밖 글자·페이지 끝·블록 끝에서 끔(0x121E2/0x12202). 다음 바이트가 」이면 그 글자 직후 끔(0x121CA)',
    button: '찍는 중 A/B/C -> 페이지 끝까지 한 번에 + 0xA0(0x122CE). 페이지 끝 A/B/C -> 다음 페이지(0x1208C). 블록 끝 -> 다음 서브',
    pageEndBlink: '넘김 표시 타일 8프레임 주기 깜빡임(0x120DC, $E410 bit3)',
    pageStart: '페이지 첫 바이트가 화자(≤0x16)가 아니면 이전 화자 유지·둘째 줄부터(0x120CA)',
    windowGrid: '글자 영역 24칸 x 9줄(0x1208C). 우리 앱은 기존 초록 창으로 대체(48 요구 5)',
    pageFramesField: 'pages[].frames = 버튼 없이 그 페이지를 다 찍는 데 드는 프레임(4f x 스텝 + 。 마다 49f) [ROM 규칙 계산]',
  },
  speakers,
  pointerTable: { addr: '0x752E2', count: NPTR, pointers: ptrs.map((p) => hex(p)) },
  matches,
  extras,
  totals: { matchBlockPages: matchPages, winContinuationPages: contPages, extraDialoguePages: extraOnlyPages - contPages, totalPages, narrationRecords: extras.reduce((n, e) => n + (e.records?.length ?? 0), 0), translatedKo: 0, note: 'matchBlockPages = 경기 블록 첫 세그먼트(+15전 경기 전 배경 교체 뒤). 진입 컷·7번째 승리 내레이션은 레코드 수로 따로 셈' },
};
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log('wrote', path.relative(root, outPath));
console.log('match pages', matchPages, 'win continuation', contPages, 'extra dialogue', extraOnlyPages - contPages, 'total', totalPages);
for (const m of matches) console.log(m.chapter, KINDS.map((kd) => m.blocks[kd].pageCount).join('/'), m.title.jp, '|', m.blocks.pre.segments[0].pages[0].runs.map((r) => r.nameJp + ':' + r.text.split('\n')[0]).join(' / ').slice(0, 60));
