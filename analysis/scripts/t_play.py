import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
md=load()
hold(md,0,6)
for i in range(600):
    md.pad=[0,0]; md.run_frame()
    if st(md)==(0x14,0): break
print(i,st(md))
for k in list(range(14))+[14,15,16]:
    a=0xC000+k*0x80
    d=odump(md,a)
    print(k,hex(a),{x:(hex(v) if isinstance(v,int) else round(v,1)) for x,v in d.items()})
print('side',[hex(ramw(md,0xE700+k)) for k in range(0,0x70,2)])
print('side2',[hex(ramw(md,0xE780+k)) for k in range(0,0x70,2)])
print('E20C',hex(ramw(md,0xE20C)),'E214',hex(ramw(md,0xE214)),hex(ramw(md,0xE21E)))
for k in range(0xE200,0xE280,2):
    pass
import pickle
pickle.dump(md,open('analysis/state/play0.pkl','wb'))
