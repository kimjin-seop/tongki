# CPU 엔드 어택(팀1 五芒星, force 발동)을 1P 가 캐치/회피 시도. 사용: python -I analysis/scripts/t_formation_catch.py <B|A|C> <누를프레임,...>
import numpy as np
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
btn={'B':B,'A':A,'C':C,'LB':B}[sys.argv[1]]
turn=L if sys.argv[1]=='LB' else 0   # LB: 먼저 왼쪽(공 오는 방향)으로 몸을 돌린 뒤 B
base=load('ctrl0')
pokeb(base,0xC003,peekb(base,0xC003)&0xEF)
pokew(base,0xC700,4); pokeb(base,0xC703,(peekb(base,0xC703)|0x10)&0x3F); pokew(base,0xC71C,0xC380); pokeb(base,0xC383,peekb(base,0xC383)|0x10); pokew(base,0xC752,0xE780); pokew(base,0xE798,0xC380)
pokeb(base,0xE266,1); pokew(base,0xE24E,0xE780); pokew(base,0xE24C,0xC380)
for _ in range(1280): base.pad=[0,0]; base.run_frame()     # 엔드 어택(f1285) 직전까지 공통 진행
snap=pickle.dumps(base)
for fp in [int(x) for x in sys.argv[2].split(',')]:
    md=pickle.loads(snap); res='-'
    for f in range(1280,1340):
        md.pad=[(btn if fp<=f<fp+3 else 0)|(turn if f<fp and f>=1281 and f%2==0 else 0),0]; md.run_frame()
        if f>1286:
            t=ramw(md,0xC700)&0x7FFC
            if t==4: res='CATCH by %04x hp0=%d'%(ramw(md,0xC71C),ramw(md,0xC040)); break
            if t==0x1C: res='HIT/MISS hp0=%d'%ramw(md,0xC040); break
    print(sys.argv[1],fp,res,flush=True)
