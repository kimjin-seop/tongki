# CPU 공격(투구/패스) 관찰(analysis/18): AI 대 AI(play0) 를 N 프레임 돌려 소유 시작 -> 릴리스 지연, 투구/패스 비율, 투구 상태를 기록.
# 사용: python -I analysis/scripts/t_cpu_off.py [프레임=3000]
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
N=int(sys.argv[1]) if len(sys.argv)>1 else 3000
md=load('play0'); pokeb(md,0xE717,0); pokeb(md,0xE797,0)
last=None; own=None; t0=None; log=[]
prevtype=None
for f in range(N):
    md.pad=[0,0]; md.run_frame()
    b=odump(md,0xC700); t=b['type']&0x7FFC; o=ramw(md,0xC71C)
    if t==4 and o!=own:  # 공 보유 시작
        own=o; t0=f
    if t in (0x14,0x90,0x18) and prevtype==4 and t0 is not None:
        pl=odump(md,own)
        log.append((f,'seat%d'%(0 if own<0xC380 else 1),'idx%d'%((own-0xC000)//0x80),{0x14:'shot',0x90:'special',0x18:'pass'}[t],f-t0,'vx=%.1f'%b['vx'],'pow=%d'%ramw(md,0xC71A),'tgt=%x'%ramw(md,0xE21E)))
    if t!=4 and t!=prevtype and t in (0x1c,): own=None
    prevtype=t
for l in log: print(*l)
import statistics as S
d=[l[4] for l in log if l[3]!='pass']
if d: print('투구 %d회, 보유->릴리스 중앙값 %d f, 최소 %d, 최대 %d; 패스 %d회'%(len(d),S.median(d),min(d),max(d),sum(1 for l in log if l[3]=='pass')),'프레임',N)
