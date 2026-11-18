import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import json
md=new()
log=[]
def hook(m,pc):
    if pc in (0x1126,0x1138,0x1356):
        ret=m.read(m.a[7],2)
        log.append(dict(pc=hex(pc),src=hex(m.a[0]),vaddr=hex(m.vdp.addr),code=m.vdp.code,d0=hex(m.d[0]),ret=hex(ret),frame=m.frame))
md.hook=hook
to_modemenu(md)
for i in range(120):
    tap(md,S if i%3!=1 else C,25)
    if st(md)[0]==0x14: break
hold(md,0,360)
md.hook=None
json.dump(log,open('analysis/state/loadlog.json','w'),indent=0)
pickle.dump(md,open('analysis/state/play1.pkl','wb'))
print(len(log))
