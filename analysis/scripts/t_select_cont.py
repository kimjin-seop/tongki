"""저장된 md 상태(pkl)에서 이어서 기록. 사용: t_select_cont.py <in_md.pkl> <out.pkl> <N> [inputs f:mask:len[:pad]]"""
import numpy
import sys,pickle,hashlib; sys.path.insert(0,"analysis/scripts")
from drv import *
md=pickle.load(open(sys.argv[1],'rb')); out=sys.argv[2]; N=int(sys.argv[3])
inp=[{},{}]
if len(sys.argv)>4 and sys.argv[4]:
    for t in sys.argv[4].split(','):
        p=[int(x,0) for x in t.split(':')]; f,m,l=p[:3]; pd=p[3] if len(p)>3 else 0
        for k in range(l): inp[pd][f+k]=m
snd=[]; F0=md.frame
_w=md.write
def w(addr,size,val):
    a=addr&0xFFFFFF
    if a>=0xFF0000 and (a&0xFFFF) in range(0xE610,0xE618) and size==0: snd.append((md.frame-F0,hex(val)))
    return _w(addr,size,val)
md.write=w
vr=[];lasth=None;fr=[]
for f in range(N):
    v=md.vdp; h=hashlib.md5(bytes(v.vram)).digest()
    if h!=lasth: vr.append(bytes(v.vram)); lasth=h
    fr.append(dict(f=f,reg=list(v.reg),cram=list(v.cram),vsram=list(v.vsram),vi=len(vr)-1,
        obj=bytes(md.ram[0xC000:0xC400]),e4=bytes(md.ram[0xE400:0xE480]),e7=bytes(md.ram[0xE700:0xE800]),pad=(inp[0].get(f,0),inp[1].get(f,0)),
        st=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))))
    md.pad=[inp[0].get(f,0),inp[1].get(f,0)]; md.run_frame()
md.write=_w
pickle.dump(dict(vr=vr,fr=fr,snd=snd),open(out,'wb'))
md.hook=None
pickle.dump(md,open(out.replace('.pkl','_end.pkl'),'wb'))
print('frames',N,'vram',len(vr)); print('SND',snd)
