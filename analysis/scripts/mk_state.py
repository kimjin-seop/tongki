import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import pickle,time
t=time.time()
md=new()
to_modemenu(md)
for i in range(120):
    tap(md,S if i%3!=1 else C,25)
    if st(md)[0]==0x14: break
print(i,st(md),time.time()-t)
hold(md,0,60)
print(st(md))
md.hook=None
pickle.dump(md,open('analysis/state/match_story0.pkl','wb'))
render(md).save('analysis/gfx/emu_match0.png')
