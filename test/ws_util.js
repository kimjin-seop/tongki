// 테스트용 WebSocket: 현행 프로토콜 주소(/ws?v=)로 접속하고, 스냅샷(바이너리) 프레임은 기본으로 건너뛴다(JSON 만 읽는 테스트용).
// 스냅샷이 필요한 테스트는 { snaps: true } 를 주면 SnapDecoder 로 풀어 'message' 리스너에 JSON 문자열(옛 모양)로 넘긴다.
import { WebSocket } from 'ws';
import { PROTOCOL } from '../server/net/protocol.js';
import { SnapDecoder } from '../public/js/game/snapcodec.js';

export function openWs(port, opts = {}) {
  const { snaps, ...wsOpts } = opts;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?v=${PROTOCOL}`, Object.keys(wsOpts).length ? wsOpts : undefined);
  const dec = new SnapDecoder();
  const on = ws.on.bind(ws);
  ws.on = (ev, fn) => {
    if (ev !== 'message') return on(ev, fn);
    return on('message', (raw, isBin) => {
      if (!isBin) return fn(raw, isBin);
      if (!snaps) return undefined;
      const m = dec.decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.length));
      return m ? fn(Buffer.from(JSON.stringify(m)), false) : undefined;
    });
  };
  return ws;
}
