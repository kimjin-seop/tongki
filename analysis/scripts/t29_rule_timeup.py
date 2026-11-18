import sys,os,pickle
sys.path.insert(0,'analysis/scripts')
from drv import *
case=sys.argv[1]; nf=int(sys.argv[2])
md=load('play0')
print('init E600=%x E602=%x E680=%d e757=%d e7d7=%d clock=%s e220=%d e68e=%x'%(ramw(md,0xE600),ramw(md,0xE602),peekb(md,0xE680),peekb(md,0xE757),peekb(md,0xE7D7),bytes(md.ram[0xE684:0xE688]).hex(),peekb(md,0xE220),ramw(md,0xE68E)))
pokeb(md,0xE680,1); md.ram[0xE684:0xE688]=bytes([0,0,2,0])
if case=='A': pokeb(md,0xE7D7,5)
if case=='B': pokeb(md,0xE757,5)
last=None
for f in range(nf):
    md.pad=[0,0]; md.run_frame()
    s=(ramw(md,0xE600),ramw(md,0xE602),peekb(md,0xE757),peekb(md,0xE7D7),ramw(md,0xE68A),peekb(md,0xE220),ramw(md,0xD900)&0x7ffc,ramw(md,0xD914),bytes(md.ram[0xE684:0xE687]).hex())
    k=s[:8]
    if k!=last: print('f%d E600=%x E602=%x remA=%d remB=%d winner=%x e220=%d d900=%x/%d clock=%s'%(f+1,*s)); last=k
if len(sys.argv)>3:
    from t_md_step import render_w
    im=render_w(md); im.save(sys.argv[3])
