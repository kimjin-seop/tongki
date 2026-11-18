import numpy
import sys,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
OUT='analysis/gfx/start/'
md=pickle.load(open('analysis/state/hud_base.pkl','rb'))
pokeb(md,0xE717,0); pokeb(md,0xE797,0)
if len(sys.argv)>1: pokeb(md,0xE757,int(sys.argv[1])); pokeb(md,0xE7D7,int(sys.argv[2]))
N=int(sys.argv[3]) if len(sys.argv)>3 else 900
tag=sys.argv[4] if len(sys.argv)>4 else 'end'
shots=set(int(x) for x in sys.argv[5].split(',') if x) if len(sys.argv)>5 else set()
prev=None
for f in range(N):
    s=(ramw(md,0xE600),ramw(md,0xE602)&0x7C,peekb(md,0xE757),peekb(md,0xE7D7),ramw(md,0xC780)&0x7FFC,peekb(md,0xC797),ramw(md,0xC786),ramw(md,0xD900)&0x7FFC,ramw(md,0xD914),peekb(md,0xC782)>>7)
    if s!=prev:
        ps=[(i,hex(ramw(md,0xC000+i*0x80)&0x7FFC),ramw(md,0xC000+i*0x80+6)) for i in range(14)]
        print(f,'st %02x/%02x rem %d-%d ref t%x sub%x an%x ban t%x k%d refflip%d'%s,ps if s[0]!=(prev or s)[0] or s[1]!=(prev or s)[1] else '',flush=True)
        prev=s
    if f in shots: H.render(md).save(OUT+'%s_f%03d.png'%(tag,f))
    md.pad=[0,0]; md.run_frame()
print(st(md))
