import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import t_special as T
def trial(tag,idv,f76,f40,hold,wait=0):
    md=T.setup(0); pokew(md,0xE694,0)
    pokew(md,0xC714,idv); pokeb(md,0xC776,f76); pokew(md,0xC740,f40)
    for _ in range(wait): md.pad=[0,0]; md.run_frame()
    sc=[(3,0),(2,32),(8,0),(1,48),(hold-1,48),(2,0),(30,0)]
    seen=None
    for fr,m in sc:
        for _ in range(fr):
            md.pad=[m,0]; md.run_frame()
            t=ramw(md,0xC700)&0x7FFC
            if t in(0x14,0x90) and seen is None: seen=(hex(t),'tag',ramw(md,0xC714),'pow',ramw(md,0xC71A))
    print(tag,seen)
trial('stale $76=1,$40=0, short charge 5',22,1,0,5)
trial('glow  $76=1,$40=60, short charge 5',22,1,60,5)
trial('glow  tag=41 (other id)',41,1,60,5)
trial('no flags, short charge 5',22,0,0,5)
