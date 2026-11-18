import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
md=load('play0')
# run until some P1 obj has type 0x10 (controlled inner)
def ctrl():
    for k in range(14):
        a=0xC000+k*0x80
        if ramw(md,a)&0x7FFF in (0x10,0x34,0x38): return k
    return None
for f in range(600):
    md.pad=[0,0]; md.run_frame()
    c=ctrl()
    if c is not None and f>60: break
print('frame',f,'ctrl',c)
pickle.dump(md,open('analysis/state/ctrl0.pkl','wb'))
a=0xC000+c*0x80
print(odump(md,a), 'ball',odump(md,0xC700))
print('E680',peekb(md,0xE680),'E681',peekb(md,0xE681),'E697',peekb(md,0xE697),'E69C',ramw(md,0xE69C),'E69E',ramw(md,0xE69E),'E692',peekb(md,0xE692),'E693',peekb(md,0xE693),'E68E',ramw(md,0xE68E),'E688',ramw(md,0xE688),'E682',peekb(md,0xE682))
