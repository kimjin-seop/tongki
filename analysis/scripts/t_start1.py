import numpy
import sys,time,json; sys.path.insert(0,"analysis/scripts")
from drv import *
md=load('match_story0')
t=time.time()
log=[]
prev=None
for f in range(261):
    e=(ramw(md,0xE600),ramw(md,0xE602))
    objs=[]
    for i in range(64):
        a=0xC000+i*0x80
        ty=ramw(md,a)
        if ty==0: continue
        objs.append((i,ty&0x7FFC,peekb(md,a+0x17),round(raml(md,a+0x20)/65536,2),round(raml(md,a+0x24)/65536,2),round(s32(raml(md,a+0x28))/65536,2),peekb(md,a+0x3C) if True else 0,peekb(md,a+0x10),ramw(md,a+0x18)))
    sig=(e,tuple((o[0],o[1],o[2]) for o in objs))
    if sig!=prev or f%20==0:
        print(f,'%02x %02x'%e,[o[:3] for o in objs])
    prev=sig
    log.append(dict(f=f,st=e,objs=objs))
    md.pad=[0,0]; md.run_frame()
json.dump(log,open('C:/Users/김진섭/AppData/Local/Temp/claude/64c85a23ae5c511c/fc8a8997-264e-47a4-83b3-a502d38ec8f0/scratchpad/start_log.json','w'))
print('time',time.time()-t)
