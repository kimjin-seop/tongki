# CPU 선수 이동/정지 비율 관찰(analysis/18): AI 대 AI(play0) N 프레임, 선수별 속도!=0 프레임 비율, 공 상태별 분리.
# 사용: python -I analysis/scripts/t_cpu_idle.py [프레임=1500] [시작프레임=150]
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
N=int(sys.argv[1]) if len(sys.argv)>1 else 1500; S0=int(sys.argv[2]) if len(sys.argv)>2 else 150
md=load('play0'); pokeb(md,0xE717,0); pokeb(md,0xE797,0)
from collections import defaultdict
mv=defaultdict(lambda:[0,0])  # key -> [moving, total]
runs=[]; cur={}; spd=defaultdict(list)
for f in range(N):
    md.pad=[0,0]; md.run_frame()
    if f<S0: continue
    b=odump(md,0xC700); bt=b['type']&0x7FFC
    state='fly' if bt in (0x14,0x90,0x18) else 'held' if bt==4 else 'loose'
    for i in range(14):
        a=0xC000+i*0x80
        ty=ramw(md,a)&0x7FFC
        if ty in (0,) or peekb(md,a+0x1E): continue
        vx=raml(md,a+0x30); vy=raml(md,a+0x34)
        m=1 if (vx or vy) else 0
        role='in' if (i%7)<4 else 'out'
        if m: spd[role].append(((s32(vx)/65536)**2+(s32(vy)/65536)**2)**.5)
        for k in (('all',role),(state,role)):
            mv[k][0]+=m; mv[k][1]+=1
        c=cur.get(i,[m,0])
        if c[0]==m: c[1]+=1
        else:
            if c[0]==0: runs.append(c[1])
            c=[m,1]
        cur[i]=c
for k in sorted(mv): print(k,'이동 %.0f%% (n=%d)'%(100*mv[k][0]/mv[k][1],mv[k][1]))
if runs:
    import statistics as S; print('정지 구간 길이 중앙값 %d f, 평균 %.0f, 최대 %d'%(S.median(runs),S.mean(runs),max(runs)))

for r in spd: print('이동 중 평균 속도',r,'%.2f px/f (최대 %.2f)'%(sum(spd[r])/len(spd[r]),max(spd[r])))
