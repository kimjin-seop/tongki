# 필살기 ID별 궤적 추적 (06_special_shots.md 용). 사용: python -I analysis/scripts/t_special.py ID [frames] [mode]
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
def setup(ID):
    md=load('ctrl0')
    pokew(md,0xC700,4); pokeb(md,0xC703,peekb(md,0xC703)|0x10); pokew(md,0xC71C,0xC000)
    pokeb(md,0xC003,peekb(md,0xC003)|0x10); pokeb(md,0xE756,1); pokeb(md,0xE716,1)
    pokew(md,0xC752,0xE700)
    pokew(md,0xE694,ID)
    return md
SCRIPT=[(3,0),(2,32),(8,0),(1,48),(14,48),(2,0)]
def objs(md):
    r=[]
    for i in range(0,0x20):
        a=0xC000+i*0x80
        t=ramw(md,a)&0x7FFC
        if t and i>=16: r.append((i,t,ramw(md,a+0x14),ramw(md,a+0x1A),ramw(md,a+0x16)&0xFF,raml(md,a+0x20)/65536,raml(md,a+0x24)/65536,raml(md,a+0x28)/65536))
    return r
def run(ID,n=120,verbose=True,nocol=True):
    md=setup(ID); f=0; out=[]; started=False
    for fr,m in SCRIPT+[(n,0)]:
        for _ in range(fr):
            md.pad=[m,0]; md.run_frame(); f+=1
            b=odump(md,0xC700)
            t=b['type']&0x7FFC
            if t==0x90 and not started: started=True; f0=f
            if started and nocol: pokeb(md,0xC703,peekb(md,0xC703)&0x3F)
            if started:
                out.append((f-f0,t,b['sub'],b['tmr'],b['x'],b['y'],b['z'],b['vx'],b['vy'],b['vz'],ramw(md,0xC71A),ramw(md,0xC714),objs(md)))
                if t!=0x90 and f-f0>2: break
        else: continue
        break
    return md,out
if __name__=="__main__":
    ID=int(sys.argv[1]); n=int(sys.argv[2]) if len(sys.argv)>2 else 120
    md,out=run(ID,n)
    for o in out:
        print('%3d t=%02x sub=%02x tmr=%d  p=(%.0f,%.0f,%.0f) v=(%.2f,%.2f,%.2f) pow=%d id=%d'%o[:12], [ (x[0],'%02x'%x[1],x[2],x[3]) for x in o[12]] if o[12] else '')
