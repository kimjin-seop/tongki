import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
md=load('ctrl0')
script=eval(sys.argv[1]); K=int(sys.argv[2]) if len(sys.argv)>2 else 0
last=None; f=0
a=0xC000+K*0x80
for fr,m in script:
    for _ in range(fr):
        md.pad=[m,0]; md.run_frame(); f+=1
        o=odump(md,a); b=odump(md,0xC700)
        c=(o['type']&0x7FFF,o['sub'],ramw(md,a+6),peekb(md,a+3),b['type']&0x7FFF,o['hb'])
        if c!=last:
            print(f,hex(m),'P type %02x sub %02x anim %02x f3=%02x hb=%d'%(c[0],c[1],c[2],c[3],c[5]),'x=%.0f y=%.0f z=%.1f vx=%.2f vy=%.2f vz=%.2f tmr=%d'%(o['x'],o['y'],o['z'],o['vx'],o['vy'],o['vz'],o['tmr']),'| ball type %02x x=%.0f y=%.0f z=%.1f own=%x'%(c[4],b['x'],b['y'],b['z'],b['own']),flush=True)
            last=c
