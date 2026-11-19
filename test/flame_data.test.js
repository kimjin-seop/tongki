import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../server/flame/tools/validate_data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('flame_legacy 데이터 마스터: 스키마·기획 대조 통과 (40/30/20)', () => {
  const r = validate();
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.counts, { equipment: 40, artifacts: 30, consumables: 20, synergies: 7 });
});

test('flame_legacy 데이터 마스터: 기획과 다른 수치는 검출된다', () => {
  // 임시 폴더에 복사한 뒤 H02(HP +8)를 +9 로 바꿔 검증기가 잡는지 본다. 원본은 건드리지 않는다.
  const tmp = mkdtempSync(path.join(tmpdir(), 'flame-data-'));
  const files = [...readdirSync(path.join(ROOT, 'server/flame/data')).map((f) => 'server/flame/data/' + f), 'server/data/specials.json', 'analysis/36_flame_legacy_spec.md'];
  for (const rel of files) {
    mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    copyFileSync(path.join(ROOT, rel), path.join(tmp, rel));
  }
  const file = path.join(tmp, 'server/flame/data/items_equipment.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.items.find((i) => i.id === 'H02').stats.s0 = 9;
  writeFileSync(file, JSON.stringify(data));
  const r = validate({ root: tmp });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.startsWith('H02:')));
});
