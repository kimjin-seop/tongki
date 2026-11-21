// 클라이언트 IP 판정(WS 연결 상한·botguard·hello/로그인 제한·초대 미리보기가 같이 쓴다). HANDOFF §20
// TRUST_PROXY: 없음/빈 값 = 자동(직접 상대가 루프백일 때만 X-Forwarded-For 신뢰), '0' = 끔(항상 소켓 주소), 그 밖의 값(예 '1') = 항상 신뢰(종전 동작)

/** 127.0.0.0/8, ::1, ::ffff:127.* */
export function isLoopback(addr) {
  const a = String(addr ?? '').toLowerCase();
  return a === '::1' || a.startsWith('127.') || a.startsWith('::ffff:127.');
}

/** X-Forwarded-For 의 마지막(가장 가까운 프록시가 덧붙인) 값. nginx $proxy_add_x_forwarded_for 는 클라이언트가 보낸 값 뒤에 실제 IP 를 붙이므로 왼쪽은 위조 가능 */
export function lastForwarded(xff) {
  const v = Array.isArray(xff) ? xff.join(',') : String(xff ?? '');
  return v.split(',').pop().trim();
}

/** 순수 판정. 반환 { ip, viaXff } — viaXff = 자동 신뢰로 XFF 를 쓴 경우(1회 경고용) */
export function resolveClientIp(remoteAddress, xff, trustProxy) {
  const sock = remoteAddress ?? '';
  const mode = trustProxy === undefined || trustProxy === '' ? 'auto' : trustProxy === '0' ? 'off' : 'on';
  if (mode === 'off') return { ip: sock, viaXff: false };
  if (mode === 'on' || isLoopback(sock)) {
    const xf = lastForwarded(xff);
    if (xf) return { ip: xf, viaXff: mode === 'auto' };
  }
  return { ip: sock, viaXff: false };
}
