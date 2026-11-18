"""modemenu.pkl(커서=2, 1Pvs2P) 에서 모드 선택 후 팀 선택 진입. 인자: 모드(1|2)"""
import numpy
import sys,time,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
mode=int(sys.argv[1])
md=load('modemenu')
if mode==1: tap(md,U,20,hl=4)
print('C024',ramw(md,0xC024))
hold(md,S,4)
prev=None
for f in range(300):
    key=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))
    if key!=prev: print(f,['%04x'%k for k in key]); H.render(md).save('analysis/gfx/select/_chg_%d_%03d.png'%(mode,f))
    prev=key
    md.pad=[0,0]; md.run_frame()
H.render(md).save('analysis/gfx/select/_end_%d.png'%mode)
md.hook=None
pickle.dump(md,open('analysis/state/select_m%d.pkl'%mode,'wb'))
