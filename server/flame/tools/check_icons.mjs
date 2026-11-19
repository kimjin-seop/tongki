// 불꽃의 계승(flame_legacy) 아이템 아이콘 파일 검사 도구. validate_data.mjs 와 별개 파일이며 읽기 전용이다.
// 사용: node server/flame/tools/check_icons.mjs [--asset-root <dir>] [--quiet] [--json]
//   --asset-root  아이콘 경로의 기준 폴더(기본: <프로젝트>/public)
// 검사(오류): 데이터 ID 중복, icon 필드 누락·경로 규칙 위반·경로 중복, 파일 없음, PNG 아님, 32x32 아님, 알파 채널 없음,
//             투명 배경 없음(네 모서리), 반투명 도트, 내용이 완전히 같은 파일, 아이템 수 90 아님
// 검사(경고): 색 수 16 초과, 외곽선 누락(투명과 맞닿은 도트가 어둡지 않음), 같은 폴더 안에서 실루엣이 거의 같은 쌍(색만 바꾼 의심),
//             데이터가 참조하지 않는 남는 PNG
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const ICON_DIR = { H: 'headbands', G: 'gloves', P: 'protectors', U: 'uniforms', A: 'artifacts', C: 'consumables' };
const DATA_FILES = ['items_equipment.json', 'artifacts.json', 'consumables.json'];
const SIZE = 32, MAX_COLORS = 16, EXPECTED = 90, SIL_IOU_WARN = 0.93, OUTLINE_LUM = 60, OUTLINE_MIN = 0.9;

// 최소 PNG 디코더(8비트, 컬러 타입 0/2/3/4/6, 인터레이스 없음) -> { w, h, hasAlpha, rgba }
export function decodePng(buf) {
  const SIG = '89504e470d0a1a0a';
  if (buf.length < 8 || buf.subarray(0, 8).toString('hex') !== SIG) throw new Error('PNG 서명이 아님');
  let p = 8, ihdr = null, plte = null, trns = null; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') ihdr = data; else if (type === 'PLTE') plte = data; else if (type === 'tRNS') trns = data; else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), depth = ihdr[8], ct = ihdr[9], interlace = ihdr[12];
  if (depth !== 8 || interlace !== 0) throw new Error(`지원하지 않는 PNG 형식(depth ${depth}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]; if (!ch) throw new Error(`지원하지 않는 컬러 타입 ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0, b = y > 0 ? px[(y - 1) * stride + x] : 0, c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (ct === 6) { r = px[i * 4]; g = px[i * 4 + 1]; b = px[i * 4 + 2]; a = px[i * 4 + 3]; }
    else if (ct === 2) { r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2]; }
    else if (ct === 3) { const k = px[i]; r = plte[k * 3]; g = plte[k * 3 + 1]; b = plte[k * 3 + 2]; a = trns && k < trns.length ? trns[k] : 255; }
    else if (ct === 4) { r = g = b = px[i * 2]; a = px[i * 2 + 1]; }
    else { r = g = b = px[i]; }
    rgba.set([r, g, b, a], i * 4);
  }
  return { w, h, hasAlpha: ct === 6 || ct === 4 || (ct === 3 && !!trns), rgba };
}

export function checkIcons({ root = ROOT, assetRoot } = {}) {
  const errors = [], warnings = [], rows = [];
  const base = assetRoot || path.join(root, 'public');
  const items = [];
  for (const f of DATA_FILES) {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'server/flame/data', f), 'utf8'));
    for (const it of j.items) items.push({ id: it.id, name: it.name, icon: it.icon, file: f });
  }
  if (items.length !== EXPECTED) errors.push(`아이템 수 ${items.length} (기대 ${EXPECTED})`);
  const seenId = new Map(), seenIcon = new Map(), seenHash = new Map(), sil = [];
  for (const it of items) {
    if (seenId.has(it.id)) errors.push(`ID 중복: ${it.id} (${seenId.get(it.id)}, ${it.file})`); seenId.set(it.id, it.file);
    const row = { id: it.id, name: it.name, icon: it.icon, ok: false }; rows.push(row);
    if (!it.icon) { errors.push(`${it.id}: icon 필드 없음`); continue; }
    const dir = ICON_DIR[it.id[0]];
    const re = new RegExp(`^assets/flame-legacy/items/${dir}/${it.id}_[a-z0-9_]+\\.png$`);
    if (!dir || !re.test(it.icon)) errors.push(`${it.id}: 경로 규칙 위반 ${it.icon}`);
    if (seenIcon.has(it.icon)) errors.push(`${it.id}: 경로 중복 ${it.icon} (${seenIcon.get(it.icon)})`); seenIcon.set(it.icon, it.id);
    const fp = path.join(base, it.icon);
    if (!fs.existsSync(fp)) { errors.push(`${it.id}: 파일 없음 ${it.icon}`); continue; }
    const buf = fs.readFileSync(fp); let img;
    try { img = decodePng(buf); } catch (e) { errors.push(`${it.id}: PNG 해석 실패 (${e.message})`); continue; }
    row.w = img.w; row.h = img.h; row.bytes = buf.length;
    const before = errors.length;
    if (img.w !== SIZE || img.h !== SIZE) errors.push(`${it.id}: 크기 ${img.w}x${img.h} (기대 ${SIZE}x${SIZE})`);
    if (!img.hasAlpha) errors.push(`${it.id}: 알파 채널 없음`);
    const hash = crypto.createHash('sha1').update(img.rgba).digest('hex');
    if (seenHash.has(hash)) errors.push(`${it.id}: 그림 내용이 ${seenHash.get(hash)} 와 완전히 같음`); seenHash.set(hash, it.id);
    if (img.w === SIZE && img.h === SIZE) {
      const A = (x, y) => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? 0 : img.rgba[(y * SIZE + x) * 4 + 3]);
      const colors = new Set(); let opaque = 0, semi = 0, edge = 0, edgeDark = 0; const mask = new Uint8Array(SIZE * SIZE);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 4, a = img.rgba[i + 3];
        if (a === 0) continue; if (a !== 255) { semi++; continue; }
        opaque++; mask[y * SIZE + x] = 1; colors.add((img.rgba[i] << 16) | (img.rgba[i + 1] << 8) | img.rgba[i + 2]);
        if (!A(x - 1, y) || !A(x + 1, y) || !A(x, y - 1) || !A(x, y + 1)) {
          edge++; if (0.299 * img.rgba[i] + 0.587 * img.rgba[i + 1] + 0.114 * img.rgba[i + 2] < OUTLINE_LUM) edgeDark++;
        }
      }
      row.colors = colors.size; row.opaque = opaque; row.outline = edge ? +(edgeDark / edge).toFixed(3) : 0;
      if (semi) errors.push(`${it.id}: 반투명 도트 ${semi}개(알파는 0 또는 255 만 허용)`);
      if ([A(0, 0), A(SIZE - 1, 0), A(0, SIZE - 1), A(SIZE - 1, SIZE - 1)].every((a) => a !== 0)) errors.push(`${it.id}: 투명 배경 없음(네 모서리가 모두 불투명)`);
      if (opaque < 80) errors.push(`${it.id}: 불투명 도트 ${opaque}개 — 빈 그림 또는 자리표시 의심`);
      if (colors.size > MAX_COLORS) warnings.push(`${it.id}: 색 수 ${colors.size} (권장 ${MAX_COLORS} 이하)`);
      if (colors.size < 3) errors.push(`${it.id}: 색 수 ${colors.size} — 자리표시 의심`);
      if (row.outline < OUTLINE_MIN) warnings.push(`${it.id}: 외곽선 비율 ${row.outline} (기대 ${OUTLINE_MIN} 이상)`);
      sil.push({ id: it.id, dir, mask });
    }
    row.ok = errors.length === before;
  }
  // 실루엣 유사도(같은 폴더 안): 색만 바꾼 아이콘 의심 쌍
  for (let i = 0; i < sil.length; i++) for (let j = i + 1; j < sil.length; j++) {
    if (sil[i].dir !== sil[j].dir) continue;
    let inter = 0, uni = 0; for (let k = 0; k < SIZE * SIZE; k++) { inter += sil[i].mask[k] & sil[j].mask[k]; uni += sil[i].mask[k] | sil[j].mask[k]; }
    const iou = uni ? inter / uni : 0;
    if (iou >= SIL_IOU_WARN) warnings.push(`${sil[i].id}·${sil[j].id}: 실루엣 겹침 ${iou.toFixed(3)} — 형태가 거의 같음(문양·색으로만 구분)`);
  }
  // 참조되지 않는 PNG
  for (const dir of Object.values(ICON_DIR)) {
    const d = path.join(base, 'assets/flame-legacy/items', dir); if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.png') && !seenIcon.has(`assets/flame-legacy/items/${dir}/${f}`)) warnings.push(`참조되지 않는 파일: ${dir}/${f}`);
  }
  return { ok: errors.length === 0, total: items.length, passed: rows.filter((r) => r.ok).length, errors, warnings, rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), ai = args.indexOf('--asset-root');
  const r = checkIcons({ assetRoot: ai >= 0 ? path.resolve(args[ai + 1]) : undefined });
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    if (!args.includes('--quiet')) for (const x of r.rows) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.id} ${x.w ?? '-'}x${x.h ?? '-'} 색 ${x.colors ?? '-'} 외곽선 ${x.outline ?? '-'} ${x.icon}`);
    for (const w of r.warnings) console.log(`[경고] ${w}`);
    for (const e of r.errors) console.log(`[오류] ${e}`);
    console.log(`아이콘 검사: ${r.passed}/${r.total} 통과, 오류 ${r.errors.length}, 경고 ${r.warnings.length} — ${r.ok ? '합격' : '불합격'}`);
  }
  process.exit(r.ok ? 0 : 1);
}
