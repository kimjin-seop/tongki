import numpy
import sys; sys.path.insert(0,"analysis/scripts")
from hud_scen import *
md=pickle.load(open('analysis/state/hud_base.pkl','rb'))
pokeb(md,0xE717,0); pokeb(md,0xE797,0)
known=set(range(0x680,0x6e4))|{0x58f,0x5ff}|set(range(0x5d7,0x5ff))|{0x580,0x582,0x583,0x58b,0}
seen={}
def sprites(md):
    v=md.vdp;vram=v.vram;sat=(v.reg[5]&0x7F)<<9;i=0;n=0;o=[]
    while n<80:
        a=sat+i*8
        y=(((vram[a]<<8)|vram[a+1])&0x3FF)-128;sz=vram[a+2];nx=vram[a+3]&0x7F
        e=(vram[a+4]<<8)|vram[a+5];x=(((vram[a+6]<<8)|vram[a+7])&0x1FF)-128
        o.append((x,y,((sz>>2)&3)+1,(sz&3)+1,e&0x7FF,(e>>13)&3,e>>15));n+=1
        if nx==0:break
        i=nx
    return o
for f in range(2500):
    md.pad=[0,0]; md.run_frame()
    for (x,y,w,h,t,p,pr) in sprites(md):
        if p==2 and t not in known and t>=0x100:
            if t not in seen:
                seen[t]=(f,x,y,w,h); 
print({hex(k):v for k,v in seen.items()})
