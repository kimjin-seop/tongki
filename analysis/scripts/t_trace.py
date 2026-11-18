import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
md=load(sys.argv[1]); a0=int(sys.argv[2]); a1=int(sys.argv[3])
if len(sys.argv)>4 and sys.argv[4]=='ai': pokeb(md,0xE717,0); pokeb(md,0xE797,0)
last={}
for f in range(a1):
    md.pad=[0,0]; md.run_frame()
    if f<a0: continue
    for k in list(range(14))+[14,15]:
        a=0xC000+k*0x80
        c=(ramw(md,a)&0x7FFF,peekb(md,a+0x16)&0x7F)
        if last.get(k)!=c:
            o=odump(md,a)
            extra=''
            if k<14: extra='slot%d hp=%d own=%x side=%x 1e=%d x=%.0f y=%.0f z=%.0f'%(o['f1a'],o['hp'] if isinstance(o['hp'],int) else 0,o['own'],o['side'],o['f1e'],o['x'],o['y'],o['z'])
            else: extra='x=%.0f y=%.0f z=%.1f vx=%.2f vy=%.2f vz=%.2f own=%x f3=%02x'%(o['x'],o['y'],o['z'],o['vx'],o['vy'],o['vz'],o['own'],peekb(md,a+3))
            print(f,'obj%d'%k,'type %02x sub %02x'%c,extra,flush=True)
            last[k]=c
