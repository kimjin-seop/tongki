# 공 줍기 주체 집계(analysis/18): AI 대 AI(play0) N 프레임, 정지 공(타입 0x1C)->보유(타입 4) 전이의 소유자를 내야/외야로 분류.
# 사용: python -I analysis/scripts/t_cpu_pick.py [프레임=4000]
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
N=int(sys.argv[1]) if len(sys.argv)>1 else 4000
md=load('play0'); pokeb(md,0xE717,0); pokeb(md,0xE797,0)
prev=None; from collections import Counter; C=Counter(); loose_f=0; waits=[]
for f in range(N):
    md.pad=[0,0]; md.run_frame()
    t=odump(md,0xC700)['type']&0x7FFC
    if t==0x1C and prev!=0x1C: loose_f=f
    if t==4 and prev==0x1C:
        o=(ramw(md,0xC71C)-0xC000)//0x80; role='in' if (o%7)<4 else 'out'
        C[role]+=1; waits.append((role,f-loose_f))
    prev=t
print(dict(C),'프레임',N)
for r in ('in','out'):
    w=sorted(x[1] for x in waits if x[0]==r)
    if w: print(r,'정지 후 줍기까지 중앙값',w[len(w)//2],'f',w)
