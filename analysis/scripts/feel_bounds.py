# 이동 한계 오라클 측정(원작 에뮬): 걷기로 4방향 끝까지 간 좌표(사다리꼴 보정 0x6F26 확인). python -I analysis/scripts/feel_bounds.py
import sys; sys.path.insert(0, "analysis/scripts")
from drv import *
for name, seq in (('L@y128', [(L, 110)]), ('U then L', [(U, 60), (L, 110)]), ('D then L', [(D, 60), (L, 110)]), ('R', [(R, 20)]), ('D then R', [(D, 60), (R, 20)])):
    md = load('ctrl0')
    for m, n in seq:
        for _ in range(n): md.pad = [m, 0]; md.run_frame()
    o = odump(md, 0xC000); print(name, 'x=%.2f y=%.2f type %02x' % (o['x'], o['y'], o['type'] & 0x7FFC), flush=True)
