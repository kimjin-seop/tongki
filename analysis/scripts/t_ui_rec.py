"""UI 화면 기록. 사용: python -I analysis/scripts/t_ui_rec.py <src: boot|상태이름> <out.pkl> <N> <rec_from> [inputs f:mask:len[:pad]]
f = 시작점부터 센 프레임. rec_from 이후 프레임만 VDP 기록. 사운드 큐 기록."""
import numpy
import sys,pickle,hashlib; sys.path.insert(0,"analysis/scripts")
from drv import *
src,out,N,R0=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4])
inp=[{},{}]
if len(sys.argv)>5 and sys.argv[5]:
    for t in sys.argv[5].split(','):
        p=[int(x,0) for x in t.split(':')]; f,m,l=p[:3]; pd=p[3] if len(p)>3 else 0
        for k in range(l): inp[pd][f+k]=m
md=new() if src=='boot' else load(src)
snd=[]; F0=md.frame; _w=md.write
def w(addr,size,val):
    a=addr&0xFFFFFF
    if a>=0xFF0000 and (a&0xFFFF) in range(0xE610,0xE618) and size==0: snd.append((md.frame-F0,hex(val)))
    return _w(addr,size,val)
md.write=w
vr=[];lasth=None;fr=[];prev=None
for f in range(N):
    st=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))
    if st!=prev: print(f,['%x'%x for x in st])
    prev=st
    if f>=R0:
        v=md.vdp; h=hashlib.md5(bytes(v.vram)).digest()
        if h!=lasth: vr.append(bytes(v.vram)); lasth=h
        fr.append(dict(f=f,reg=list(v.reg),cram=list(v.cram),vsram=list(v.vsram),vi=len(vr)-1,obj=b'',e4=bytes(md.ram[0xE400:0xE480]),st=st))
    md.pad=[inp[0].get(f,0),inp[1].get(f,0)]; md.run_frame()
md.write=_w
pickle.dump(dict(vr=vr,fr=fr,snd=snd,f0=R0),open(out,'wb'))
md.hook=None; pickle.dump(md,open(out.replace('.pkl','_end.pkl'),'wb'))
print('SND',snd)
