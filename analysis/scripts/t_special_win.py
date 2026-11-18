import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import t_special as T
for hold in range(8,19):
    md=T.setup(0); pokew(md,0xE694,0)   # natural (table) ID
    sc=[(3,0),(2,32),(8,0),(1,48),(hold-1,48),(2,0),(30,0)]
    seen=None;ch=None
    for fr,m in sc:
        for _ in range(fr):
            md.pad=[m,0]; md.run_frame()
            t=ramw(md,0xC700)&0x7FFC
            if t in(0x14,0x90) and seen is None: seen=t; ch=(ramw(md,0xC714),ramw(md,0xC71A),ramw(md,0xC018))
    print('B hold frames',hold,'-> ball type',hex(seen) if seen else None,'tag/pow/ctr',ch)
