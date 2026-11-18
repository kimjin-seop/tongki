"""부팅부터 N프레임 VDP 상태 기록(레이어 분리 재렌더용). 사용: python -I analysis/scripts/t_intro_rec.py <out.pkl> <N> [inputs "f:mask:len,..."]
프레임마다 reg/cram/vsram/vram(변경 시만 새 사본)/RAM C000-CFFF,E400-E47F/state 저장."""
import numpy
import sys,pickle,hashlib; sys.path.insert(0,"analysis/scripts")
from drv import *
out=sys.argv[1]; N=int(sys.argv[2])
inp={}
if len(sys.argv)>3 and sys.argv[3]:
    for t in sys.argv[3].split(','):
        f,m,l=[int(x,0) for x in t.split(':')]
        for k in range(l): inp[f+k]=m
md=new()
vr=[];lasth=None;fr=[]
for f in range(N):
    v=md.vdp; h=hashlib.md5(bytes(v.vram)).digest()
    if h!=lasth: vr.append(bytes(v.vram)); lasth=h
    fr.append(dict(f=f,reg=list(v.reg),cram=list(v.cram),vsram=list(v.vsram),vi=len(vr)-1,
        obj=bytes(md.ram[0xC000:0xD000]),e4=bytes(md.ram[0xE400:0xE480]),
        st=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))))
    md.pad=[inp.get(f,0),0]; md.run_frame()
pickle.dump(dict(vr=vr,fr=fr),open(out,'wb'))
print('frames',N,'vram copies',len(vr))
