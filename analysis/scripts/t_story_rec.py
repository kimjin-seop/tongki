"""스토리 모드 진입 컷(내레이션) 기록. 사용: python -I analysis/scripts/t_story_rec.py <out.pkl> <N> [inputs "f:mask:len,..."] [cursor]
모드 메뉴 도달 후(to_modemenu) 첫 프레임을 0 으로 하여 프레임별 VDP 상태 기록(t_intro_rec 와 같은 형식) + 상태 변화 로그.
기본 입력: f12 START(倒せ! 선택) -> f40 START(はじめから)."""
import numpy
import sys,pickle,hashlib; sys.path.insert(0,"analysis/scripts")
from drv import *
out=sys.argv[1]; N=int(sys.argv[2])
spec=sys.argv[3] if len(sys.argv)>3 and sys.argv[3] else "12:128:3,40:128:3"
cur=int(sys.argv[4]) if len(sys.argv)>4 else None
inp={}
for t in spec.split(','):
    f,m,l=[int(x,0) for x in t.split(':')]
    for k in range(l): inp[f+k]=m
md=load('modemenu')
print('modemenu',st(md),flush=True)
if cur is not None: pokew(md,0xC024,cur)
vr=[];lasth=None;fr=[];prev=None
for f in range(N):
    v=md.vdp; h=hashlib.md5(bytes(v.vram)).digest()
    if h!=lasth: vr.append(bytes(v.vram)); lasth=h
    st4=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))
    if f%100==0: print("f",f,flush=True)
    if st4!=prev: print(f,[hex(x) for x in st4],flush=True); prev=st4
    fr.append(dict(f=f,reg=list(v.reg),cram=list(v.cram),vsram=list(v.vsram),vi=len(vr)-1,
        obj=bytes(md.ram[0xC000:0xD000]),e4=bytes(md.ram[0xE400:0xE480]),st=st4))
    md.pad=[inp.get(f,0),0]; md.run_frame()
pickle.dump(dict(vr=vr,fr=fr),open(out,'wb'))
print('frames',N,'vram copies',len(vr))
