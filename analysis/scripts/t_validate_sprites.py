import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
from sprlib import *
import importlib.util
def s16(v): return v-65536 if v>32767 else v
def check(name):
    md=load(name); ok=bad=0
    sat=(md.vdp.reg[5]&0x7F)<<9
    entries=[]; i=0
    for n in range(80):
        a=sat+i*8
        y=(((md.vdp.vram[a]<<8)|md.vdp.vram[a+1])&0x3FF)-128; nx=md.vdp.vram[a+3]&0x7F
        e=(md.vdp.vram[a+4]<<8)|md.vdp.vram[a+5]; x=(((md.vdp.vram[a+6]<<8)|md.vdp.vram[a+7])&0x1FF)-128
        entries.append((y,x,md.vdp.vram[a+2],e))
        if nx==0:break
        i=nx
    for k in range(14):
        a=0xC000+k*0x80
        aid=ramw(md,a+6); fi=peekb(md,a+0x10); flip=peekb(md,a+2)>>7
        team=ramw(md,0xE704 if k<7 else 0xE784); p=ramw(md,a+0x50)
        bc=ROM[0x18008+team*7+p]
        an=parse_animset(BODY_SETS[bc]); rec=an[aid]
        fl=rec['frames'] if rec['count'] else [u32(rec['off']+2)]
        fi2=min(fi,len(fl)-1)
        body=fl[fi2]
        pose=ROM[0x1e10+(aid>>1)]
        head=u32(u32(0x4d15c+4*team)+p*0x14+pose)
        b=u32(0x40000+4*bc); ho=b+u16(b+aid)
        dx=s16(u16(ho+4*fi2)); dy=s16(u16(ho+4*fi2+2))
        if flip: dx=-dx
        gb=raml(md,a+0xC); gh=raml(md,a+0x70); g74=s16(ramw(md,a+0x74)); g76=s16(ramw(md,a+0x76)); g7b=peekb(md,a+0x7B)
        exp7b=ROM[0x1eb8+u16(0x1eb8+aid)+fi2]
        good=(body==gb and head==gh and dx==g74 and dy==g76 and exp7b==g7b and bc==ramw(md,a+0x3C))
        ok+=good; bad+=not good
        if not good: print(' mismatch obj',k,'anim',hex(aid),'fi',fi,'body',hex(body),hex(gb),'head',hex(head),hex(gh),(dx,dy),(g74,g76),exp7b,g7b,'bc',bc,ramw(md,a+0x3C))
    print(name,'objs ok',ok,'bad',bad)
for n in sys.argv[1:]: check(n)
