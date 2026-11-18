# 정지 공 방치 오라클 측정(원작 에뮬): 지정 좌표에 공을 세우고 무입력으로 누가 몇 프레임에 어떻게 줍는지. python -I analysis/scripts/feel_deadball.py x y [frames]
import sys; sys.path.insert(0, "analysis/scripts")
from drv import *
from feel_pickup import place
x, y = float(sys.argv[1]), float(sys.argv[2]); n = int(sys.argv[3]) if len(sys.argv) > 3 else 220
md = load('ctrl0'); place(md, x, y)
last = {}
for f in range(n):
    md.pad = [0, 0]; md.run_frame()
    b = odump(md, 0xC700)
    if (b['type'] & 0x7FFC) == 4:
        own = ramw(md, 0xC71C); k = (own - 0xC000) // 0x80; o = odump(md, own)
        print('f%d HELD by obj%d slot %d type %02x at (%.1f,%.1f) ball stopped at (%.1f,%.1f)' % (f, k, ramw(md, own + 0x1A), o['type'] & 0x7FFC, o['x'], o['y'], x, y)); break
    for k in range(14):
        a = 0xC000 + k * 0x80; o = odump(md, a); t = (o['type'] & 0x7FFC, o['sub'])
        if last.get(k) != t and f > 0: print('  f%d obj%d slot%d type %02x sub %02x pos (%.1f,%.1f) v (%.2f,%.2f)' % (f, k, ramw(md, a + 0x1A), t[0], t[1], o['x'], o['y'], o['vx'], o['vy']))
        last[k] = t
else:
    print('not picked in', n, 'frames; ball', odump(md, 0xC700)['x'], odump(md, 0xC700)['y'])
