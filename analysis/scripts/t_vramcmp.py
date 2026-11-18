import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
from gfxdec import decode
rom=open('rom/danpei.gen','rb').read()
md=load('play1')
vr=md.vdp.vram
streams={0x30744:0x270,0x30fde:0x2EF,0x31570:0x341,0x31f14:0x3D9,0x32424:0x429,0x32fec:0x4DB,0x4f062:0x680,0x4f49e:0x6C0,0x2f8e0:0x88}
for s,t in streams.items():
    data,end,dl,n=decode(rom,s)
    ok=vr[t*32:t*32+len(data)]==data
    print(hex(s),'->tile',hex(t),'n',n,'end',hex(end),'match',ok)
    if not ok:
        nm=sum(1 for i in range(n) if vr[(t+i)*32:(t+i+1)*32]==data[i*32:(i+1)*32]); print('  tiles matching',nm)
