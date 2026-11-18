"""1PvsCOM 편성(1P) 화면(서브 3) 조작 기록: 선수 hover/선택/교대/EXIT. 사용: t_pm_swap.py <out_dir>
서브 3 도달(S 자동) 후 입력 시나리오 실행, 프레임별 PNG + 사운드 큐 + 선수 순서 RAM 로그."""
import numpy, inspect
import sys,os,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
out=sys.argv[1]; os.makedirs(out,exist_ok=True)
md=load('modemenu'); tap(md,U,20,hl=4)
for _ in range(4): md.pad=[S,0]; md.run_frame()
snd=[]; _w=md.write; F0=md.frame
def w(addr,size,val):
    a=addr&0xFFFFFF
    if a>=0xFF0000 and (a&0xFFFF) in range(0xE610,0xE618) and size==0: snd.append((md.frame-F0,hex(val)))
    return _w(addr,size,val)
md.write=w
f=0
while True:
    s=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))
    if s==(0xa4,0,3,1): break
    md.pad=[S if f%45<3 else 0,0]; md.run_frame(); f+=1
hold(md,0,60)
pickle.dump(md,open('analysis/state/pm1_f3.pkl','wb'))
def shot(n,hl=4): 
    render(md).save('%s/s_%s.png'%(out,n))
    print(n,'st',[hex(v) for v in (ramw(md,0xE400),ramw(md,0xE402))],'order?',[peekb(md,0xE700+0x40+i) for i in range(8)], snd[-3:])
shot('0_start')
steps=[('R',R),('R',R),('S',S),('D',D),('S',S),('L',L)]
for i,(k,m) in enumerate(steps):
    tap(md,m,10,hl=4); hold(md,0,50 if k=='S' else 0); shot('%d_%s'%(i+1,k))
# EXIT: 이동 후 결정
for i in range(8):
    tap(md,R,10,hl=4); 
shot('9_afterR')
tap(md,S,10,hl=4); hold(md,0,40); shot('10_S'); hold(md,0,60); shot('11_later')
print(snd)
