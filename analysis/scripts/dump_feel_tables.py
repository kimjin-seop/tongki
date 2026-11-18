# ROM 표 추출 -> server/data/romtables.json (엔진 직역용). python -I analysis/scripts/dump_feel_tables.py
# trig: 0x232A [minor,major] 0.16 고정소수 64쌍(각도 분해 0x22DA), dist: 0x242E 8.8 배율 64개(거리 0x22A8), bodyClass: 0x18008 팀*7+선수(손 위치 표 0x39F6C 선택)
import struct, json
d = open('rom/danpei.gen', 'rb').read()
w = lambda a: struct.unpack('>H', d[a:a + 2])[0]
out = {
    '_note': '[확인] ROM 직접 추출(analysis/scripts/dump_feel_tables.py). trig=0x232A, dist=0x242E, bodyClass=0x18008',
    'trig': [[w(0x232A + i * 4), w(0x232A + i * 4 + 2)] for i in range(64)],
    'dist': [w(0x242E + i * 2) for i in range(64)],
    'bodyClass': [list(d[0x18008 + t * 7:0x18008 + t * 7 + 7]) for t in range(25)],
}
# 보유 공 손 위치 표 [ROM 0xA2BA~0xA322]: hand.xz[몸통 클래스 0~2][애니ID/2][프레임] = [dx, dz] (표 0x39F6C: 클래스별 롱 포인터 -> 애니별 워드 오프셋 -> 프레임당 2바이트),
# hand.y[애니ID/2][프레임] = dy (표 0x3A13A: 애니별 워드 오프셋 -> 프레임당 1바이트). 애니 ID 0x00~0x2E(24개). 프레임 수는 다음 오프셋과의 차이로 구한다
s8 = lambda a: struct.unpack('>b', d[a:a + 1])[0]
l32 = lambda a: struct.unpack('>I', d[a:a + 4])[0]
NA = 24
def _rows(base, step):
    offs = [w(base + 2 * i) for i in range(NA)]
    ends = sorted(set(offs)) + [offs[-1] + 4 * step]
    return [(base + o, (ends[ends.index(o) + 1] - o) // step) for o in offs]
out['hand'] = {
    'xz': [[[[s8(a + 2 * i), s8(a + 2 * i + 1)] for i in range(n)] for a, n in _rows(l32(0x39F6C + 4 * c), 2)] for c in range(3)],
    'y': [[s8(a + i) for i in range(n)] for a, n in _rows(0x3A13A, 1)],
}
out['_note'] += ', hand=0x39F6C/0x3A13A(보유 공 손 위치)'
json.dump(out, open('server/data/romtables.json', 'w', encoding='utf8'), separators=(',', ':'))
print(out['trig'][:3], out['dist'][:3], out['bodyClass'][:2])
