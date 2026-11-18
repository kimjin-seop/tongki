import numpy
import sys,time,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
md=new(); to_modemenu(md)
print('C024',ramw(md,0xC024))
for hl in (2,4,8):
    tap(md,D,20,hl=hl); print(hl,'C024',ramw(md,0xC024))
md.hook=None
pickle.dump(md,open('analysis/state/modemenu.pkl','wb'))
