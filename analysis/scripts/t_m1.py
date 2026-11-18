import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import pickle
md=pickle.load(open('analysis/state/match_story0.pkl','rb'))
for i in range(6):
    hold(md,0,40)
    print(st(md),hex(ramw(md,0xE684)),hex(ramw(md,0xE686)),[hex(ramw(md,0xC000+k*0x80)) for k in range(0,16)])
    render(md).save('analysis/gfx/emu_m%d.png'%i)
