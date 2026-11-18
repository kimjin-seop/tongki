// 경기 결과 레코드 저장 (JSON Lines). 저장소 인터페이스: append(record). 랭킹 화면 없음.
import { mkdirSync, appendFile } from 'node:fs';
import path from 'node:path';

export class JsonlResultStore {
  constructor(file) {
    this.file = file;
    mkdirSync(path.dirname(file), { recursive: true });
  }
  append(record) {
    appendFile(this.file, JSON.stringify(record) + '\n', 'utf8', (err) => {
      if (err) console.error('[results] 저장 실패', err.message);
    });
  }
}

export class MemoryResultStore {
  constructor() { this.records = []; }
  append(r) { this.records.push(r); }
}
