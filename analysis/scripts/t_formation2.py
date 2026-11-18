# 포메이션 → 엔드 어택 결과 기록. 사용: python -I analysis/scripts/t_formation2.py <B누를프레임> [frames] [shotdir] [shots]
import numpy as np
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
from t_formation import setup
bf=int(sys.argv[1]); N=int(sys.argv[2]) if len(sys.argv)>2 else 300
out=sys.argv[3] if len(sys.argv)>3 else None
shots=set(int(x) for x in sys.argv[4].split(',') if x) if len(sys.argv)>4 else set()
md=setup()
seq=[0]*10+[S]*2+[0]*20+[L]*2+[0]*10+[B]*2
seq+=[0]*(bf-len(seq))+[B]*int(sys.argv[5] if len(sys.argv)>5 else 3)+[0]*N
prev=None
for f,m in enumerate(seq):
    md.pad=[m,0]; md.run_frame()
    b=odump(md,0xC700)
    opp=[(i,ramw(md,0xC000+i*0x80)&0x7FFC,peekb(md,0xC000+i*0x80+0x17),ramw(md,0xC040+i*0x80),round(raml(md,0xC020+i*0x80)/65536),round(raml(md,0xC024+i*0x80)/65536)) for i in range(7,14)]
    key=(st(md),b['type']&0x7FFC,peekb(md,0xE250),peekb(md,0xE251),tuple(o[1:4] for o in opp))
    if key!=prev:
        print(f,'pad=%02x'%m,st(md),'E250',peekb(md,0xE250),'E251',peekb(md,0xE251),'pass',peekb(md,0xE76A),'ball t=%02x pow=%d spd74=%04x id=%d p=(%.0f,%.0f,%.0f) v=(%.2f,%.2f,%.2f) own=%04x side52=%04x b3=%02x'%(b['type']&0x7FFC,ramw(md,0xC71A),ramw(md,0xC774),ramw(md,0xC714),b['x'],b['y'],b['z'],b['vx'],b['vy'],b['vz'],ramw(md,0xC71C),ramw(md,0xC752),peekb(md,0xC703)),'snd',[hex(peekb(md,0xE610+k)) for k in range(8)])
        print('   opp',opp,' p0',(ramw(md,0xC000)&0x7FFC,peekb(md,0xC017)))
    prev=key
    if out and f in shots: H.render(md).save(out+'/f%04d.png'%f)
