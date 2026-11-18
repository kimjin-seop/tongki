import numpy
import sys; sys.path.insert(0,"analysis/scripts")
from hud_scen import *
md=pickle.load(open('analysis/state/hud_base.pkl','rb'))
pokeb(md,0xE717,0); pokeb(md,0xE797,0)
def faces(md):
    o=[]
    for k in range(42,50):
        a=0xC000+k*0x80
        if ramw(md,a): o.append((k,ramw(md,a+0x1a),ramw(md,a+0x50),ramw(md,a+0x2e),peekb(md,a+0x16),ramw(md,a+0x1c)))
    return o
last=None; shots=[]
for f in range(4000):
    md.pad=[0,0]; md.run_frame()
    key=(peekb(md,0xE757),peekb(md,0xE7D7),tuple((x[0],x[1],x[2],x[4]) for x in faces(md)))
    if key!=last:
        print(f,st(md),'rem',key[0],key[1],[(x[0],'s%d'%x[1],'p%d'%x[2],'y%d'%x[3],'sub%d'%x[4]) for x in faces(md)],flush=True)
        last=key
        if len(shots)<40: shots.append((f,H.render(md)))
    if st(md)[0]!=0x14 and st(md)[0]!=0x8c: pass
    if f>200 and (peekb(md,0xE757)==0 or peekb(md,0xE7D7)==0): print('end',f); break
pickle.dump([(f,im) for f,im in shots],open(sys.argv[1] if len(sys.argv)>1 else 'analysis/state/_shots.pkl','wb'))
