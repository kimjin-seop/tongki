import numpy
import sys,os,pickle,struct
sys.path.insert(0,'analysis/scripts')
from drv import *
from t_md_step import render_w
R_=open('rom/danpei.gen','rb').read()
W=[16,2,1,1,12,2,2,1]; DV=[150,12,16,48,30,10,88,72]
def rating_ram(md,team,sub):
    a=0x8000+team*0x38; d0=0
    for p in range(7):
        for j in range(8):
            v=md.ram[a]; a+=1
            d0=(d0+((v<<8)//DV[j])*W[j])&0xFFFF
    return (d0-sub)&0xFFFF
def rng(seed):
    s=seed if seed else 0x2a6d365a
    t=(s*41)&0xFFFFFFFF; r=((t&0xFFFF)+(t>>16))&0xFFFF
    return r,((r<<16)|(t&0xFFFF))
md=pickle.load(open('analysis/state/md/lg6.pkl','rb'))
extra=int(sys.argv[1]) if len(sys.argv)>1 else 0
def T(k,w=12):
    hold(md,k,3); hold(md,0,w)
T(A,60); T(R); T(R); T(D); print('cursor',ramw(md,0xC020),ramw(md,0xC024),'sub',ramw(md,0xE400))
T(A,40); print('sub',ramw(md,0xE400),ramw(md,0xE404),'e430/e432',ramw(md,0xE430),ramw(md,0xE432),'e446',ramw(md,0xE446))
render_w(md).save(sys.argv[2]+'_menu.png')
hold(md,0,extra)
hold(md,A,3)
last=None; pcs=[]
# step-level hook: 명령 단위로 돌려 0x3460 종료(0x34ba)와 0x34de/0x3502 를 잡는다
def run_frame_hook():
    seen={}
    st=md.step
    def step():
        pc=md.pc
        if pc==0x34ba: print('   rts@34ba d0=%04x a0=%x a2=%x byte9(a2)=%d'%(md.d[0]&0xFFFF,md.a[0]&0xFFFF,md.a[2]&0xFFFFFF,md.ram[(md.a[2]+9)&0xFFFF] if (md.a[2]&0xFF0000)==0xFF0000 else R_[(md.a[2]+9)&0x3FFFFF]))
        if pc==0x3502: print('   @3502 p=%d seed=%08x'%(md.d[1]&0xFFFF,raml(md,0xE620)))
        if pc==0x350e: print('   @350e rnd=%d p=%d -> %s'%(md.d[0]&0xFFFF,md.d[1]&0xFFFF,'A wins' if (md.d[1]&0xFFFF)>=(md.d[0]&0xFFFF) else 'B wins'))
        return st()
    md.step=step
try:
    run_frame_hook()
except Exception as e: print('hook fail',e)
for f in range(520):
    md.pad=[0,0]; md.run_frame()
    s=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE760),ramw(md,0xE7E0),ramw(md,0xE68A),peekb(md,0xE757),peekb(md,0xE7D7),ramw(md,0xE704),ramw(md,0xE784))
    if s!=last: print('f%d E600=%x E602=%x sub=%d rateA=%04x rateB=%04x winner=%x rem=%d-%d teams=%d,%d seed=%08x'%(f,*s,raml(md,0xE620))); last=s
    if f==200: render_w(md).save(sys.argv[2]+'_res.png')
for t in (ramw(md,0xE704),ramw(md,0xE784)): print('team',t,'rating(no sub)=%04x'%rating_ram(md,t,0))
print('e50c',bytes(md.ram[0xE50C:0xE50C+36]).hex()); print('e554',bytes(md.ram[0xE554:0xE554+30]).hex()); print('e590',bytes(md.ram[0xE590:0xE59C]).hex())
del md.step; pickle.dump(md,open(sys.argv[2]+".pkl","wb"))
