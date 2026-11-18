"""팀 선택 화면 진입 탐색: 모드메뉴 -> 커서 이동 -> START, 상태 변화 렌더."""
import numpy
import sys,time,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
t=time.time()
md=new(); print(to_modemenu(md), time.time()-t)
mode=int(sys.argv[1]) if len(sys.argv)>1 else 1
for i in range(mode): tap(md,D,10)
H.render(md).save('analysis/gfx/select/_m_%d.png'%mode)
tap(md,S,2)
prev=None
for f in range(400):
    key=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))
    if key!=prev: print(f,['%04x'%k for k in key]); H.render(md).save('analysis/gfx/select/_chg_%d_%03d.png'%(mode,f))
    prev=key
    md.pad=[0,0]; md.run_frame()
H.render(md).save('analysis/gfx/select/_end_%d.png'%mode)
md.hook=None
pickle.dump(md,open('analysis/state/select_m%d.pkl'%mode,'wb'))
print(time.time()-t)
