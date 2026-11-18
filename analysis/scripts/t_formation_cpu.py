# CPU 측(팀1 セントアローズ) 포메이션 관찰. 사용: python -I analysis/scripts/t_formation_cpu.py [natural|force] [frames] [shotdir] [shots]
import numpy as np
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
mode=sys.argv[1] if len(sys.argv)>1 else 'natural'; N=int(sys.argv[2]) if len(sys.argv)>2 else 1500
out=sys.argv[3] if len(sys.argv)>3 else None
shots=set(int(x) for x in sys.argv[4].split(',') if x) if len(sys.argv)>4 else set()
md=load('ctrl0')
def give(md,a,side):
    pokew(md,0xC700,4); pokeb(md,0xC703,(peekb(md,0xC703)|0x10)&0x3F); pokew(md,0xC71C,a)
    pokeb(md,a+3,peekb(md,a+3)|0x10); pokew(md,0xC752,side)
pokeb(md,0xC003,peekb(md,0xC003)&0xEF)
give(md,0xC380,0xE780); pokew(md,0xE798,0xC380)
if mode=='force':
    pokeb(md,0xE266,1); pokew(md,0xE24E,0xE780); pokew(md,0xE24C,0xC380)
prev=None
for f in range(N):
    md.pad=[0,0]; md.run_frame()
    b=odump(md,0xC700)
    key=(st(md),peekb(md,0xE266),peekb(md,0xE250),peekb(md,0xE251),b['type']&0x7FFC,ramw(md,0xC71C),peekb(md,0xE7EA),[ramw(md,0xD914+k*0x80) for k in range(3)].__repr__(),peekb(md,0xE7E2))
    if key!=prev:
        pl=[(i,ramw(md,0xC000+i*0x80)&0x7FFC,ramw(md,0xC01A+i*0x80),round(raml(md,0xC020+i*0x80)/65536),round(raml(md,0xC024+i*0x80)/65536)) for i in range(7,14)]
        print(f,st(md),'E266',key[1],'E250',key[2],'E251',key[3],'ball %02x own %04x pow %d spd %04x p=(%.0f,%.0f,%.0f) v=(%.2f,%.2f,%.2f)'%(key[4],key[5],ramw(md,0xC71A),ramw(md,0xC774),b['x'],b['y'],b['z'],b['vx'],b['vy'],b['vz']),'pass',key[6],'ban',[hex(ramw(md,0xD900+k*0x80)&0x7FFC) for k in range(3)],key[7],'s62',key[8],'s59',peekb(md,0xE7D9),'E221',peekb(md,0xE221),'hp',[ramw(md,0xC040+i*0x80) for i in range(7)])
        if key[1] or key[2]: print('   cpu',pl)
    prev=key
    if out and f in shots: H.render(md).save(out+'/c%04d.png'%f)
