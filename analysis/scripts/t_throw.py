import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
md=load('ctrl0')
script=eval(sys.argv[1]); K=0
# give ball to player 0
pokew(md,0xC700,4); pokeb(md,0xC703,peekb(md,0xC703)|0x10); pokew(md,0xC71C,0xC000)
pokeb(md,0xC003,peekb(md,0xC003)|0x10); pokeb(md,0xE756,1); pokeb(md,0xE716,1)
pokew(md,0xC752,0xE700)
last=None; f=0
a=0xC000
for fr,m in script:
    for _ in range(fr):
        md.pad=[m,0]; md.run_frame(); f+=1
        o=odump(md,a); b=odump(md,0xC700)
        c=(o['type']&0x7FFF,o['sub'],ramw(md,a+6),peekb(md,a+3),b['type']&0x7FFF,o['tmr'])
        if c[:5]!=(last or [0]*5)[:5]:
            print(f,hex(m),'P type %02x sub %02x anim %02x f3=%02x'%c[:4],'tmr=%d z=%.1f'%(o['tmr'],o['z']),'| ball type %02x x=%.0f y=%.0f z=%.1f v=(%.2f,%.2f,%.2f) pow=%d tag14=%d f3=%02x'%(c[4],b['x'],b['y'],b['z'],b['vx'],b['vy'],b['vz'],ramw(md,0xC71A),ramw(md,0xC714),peekb(md,0xC703)),flush=True)
        last=c
print('E21E',hex(ramw(md,0xE21E)))
