"""스토리 진입 컷 전수 캡처(버튼으로 페이지 넘김). 사용: python -I analysis/scripts/t_story_skip.py <outdir> <N> [every] [period]
모드 메뉴 상태에서 커서 0, f12 START(倒せ!), f100 START(はじめから) 후 f260 부터 period 프레임마다 C 를 3f 누름.
every 프레임마다 원본 해상도 PNG 저장 + 상태 로그."""
import numpy
import sys,os; sys.path.insert(0,"analysis/scripts")
from drv import *
out=sys.argv[1]; N=int(sys.argv[2]); every=int(sys.argv[3]) if len(sys.argv)>3 else 10; per=int(sys.argv[4]) if len(sys.argv)>4 else 40
os.makedirs(out,exist_ok=True)
md=load('modemenu'); pokew(md,0xC024,0)
inp={}
for f in (12,100):
    for k in range(3): inp[f+k]=S
f=260
while f<N:
    for k in range(3): inp[f+k]=C
    f+=per
prev=None
for f in range(N):
    k=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))
    if k!=prev: print(f,[hex(x) for x in k],flush=True); prev=k
    if f%every==0: render(md).save('%s/f%05d.png'%(out,f))
    md.pad=[inp.get(f,0),0]; md.run_frame()
print('done',flush=True)
