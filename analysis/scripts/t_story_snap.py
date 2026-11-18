"""스토리 컷 상태 스냅샷: 모드 메뉴에서 버튼으로 컷 2 까지 진행시킨 뒤 지정 프레임에서 에뮬레이터 상태 저장.
python -I analysis/scripts/t_story_snap.py <stop_f> <out.pkl>   (t_story_skip.py 와 같은 입력: f12,f100 START, f260 부터 40f 마다 C)"""
import numpy
import sys,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
N=int(sys.argv[1]); out=sys.argv[2]
md=load('modemenu'); pokew(md,0xC024,0)
inp={}
for f in (12,100):
    for k in range(3): inp[f+k]=S
f=260
while f<N:
    for k in range(3): inp[f+k]=C
    f+=40
for f in range(N):
    md.pad=[inp.get(f,0),0]; md.run_frame()
md.hook=None
pickle.dump(md,open(out,'wb')); print('saved',N,st(md),flush=True)
