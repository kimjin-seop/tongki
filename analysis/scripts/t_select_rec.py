"""팀 선택 화면 기록. modemenu.pkl(모드 메뉴, 커서=2)에서 시작.
사용: python -I analysis/scripts/t_select_rec.py <out.pkl> <mode 1|2> <N> [inputs "f:mask:len[:pad],..."] [unlock 0|1]
프레임마다 reg/cram/vsram/vram(변경 시만)/RAM C000-C3FF,E400-E47F,E700-E7FF/state + 사운드 큐 기록. f0 = 모드 메뉴에서 START 누른 프레임."""
import numpy
import sys,pickle,hashlib; sys.path.insert(0,"analysis/scripts")
from drv import *
out=sys.argv[1]; mode=int(sys.argv[2]); N=int(sys.argv[3])
inp=[{},{}]
if len(sys.argv)>4 and sys.argv[4]:
    for t in sys.argv[4].split(','):
        p=[int(x,0) for x in t.split(':')]; f,m,l=p[:3]; pd=p[3] if len(p)>3 else 0
        for k in range(l): inp[pd][f+k]=m
unlock=len(sys.argv)>5 and sys.argv[5]=='1'
md=load('modemenu')
if mode==1: tap(md,U,20,hl=4)
if unlock: md.ram[0xE500]|=1
snd=[]
_w=md.write
def w(addr,size,val):
    a=addr&0xFFFFFF
    if a>=0xFF0000 and (a&0xFFFF) in range(0xE610,0xE618) and size==0: snd.append((md.frame-F0,hex(val)))
    return _w(addr,size,val)
md.write=w
F0=md.frame
for _ in range(4): md.pad=[S,0]; md.run_frame()
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
print('frames',N,'vram copies',len(vr)); print('SND',snd)
