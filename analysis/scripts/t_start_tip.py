import numpy
import sys,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
base=load('match_story0')
for _ in range(400): base.pad=[0,0]; base.run_frame()
def run(cf,bf,shots=(),tag=None):
    md=pickle.loads(pickle.dumps(base)); res=None; tl=[]
    for f in range(400,470):
        pad=0
        if f in (cf,cf+1): pad=C
        if f in (bf,bf+1): pad=B
        md.pad=[pad,0]; md.run_frame()
        b=0xC700
        tl.append((f,ramw(md,0xC000)&0x7FFC,peekb(md,0xC017),round(s32(raml(md,0xC028))/65536,1),ramw(md,b)&0x7FFC,round(s32(raml(md,b+0x28))/65536,1),round(s32(raml(md,b+0x30))/65536,2),peekb(md,0xE247),hex(ramw(md,b+0x3C))))
        if tag and f in shots: H.render(md).save('analysis/gfx/start/%s_f%03d.png'%(tag,f))
        if peekb(md,0xE247) and res is None: res=(f,tl[-1])
    return res,tl
if len(sys.argv)==1:
  for cf in (404,408,412):
    for bf in range(cf+6,cf+30,3):
        r,_=run(cf,bf); print('C',cf,'B',bf,'->',r)
if len(sys.argv)>1:
    run(408,420,shots=(409,416,425,428,436,448),tag='tip1p')
