"""스토리(모드 0) 서브 3 화면 레지스터(윈도 사용 여부) 확인 + 윈도 합성 렌더. 사용: t_pm_story_win.py <out_dir>"""
import numpy, inspect
import sys,os,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
from vdprender import render
out=sys.argv[1]; os.makedirs(out,exist_ok=True)
md=load('modemenu')
while True:
    break
tap(md,U,20,hl=4); tap(md,U,20,hl=4)
for _ in range(4): md.pad=[S,0]; md.run_frame()
class V: pass
class M: pass
def render_w(md):
    v=md.vdp; r=list(v.reg); pw=[32,64,128,128][r[16]&3]
    an=(r[2]&0x38)<<10; wn=(r[3]&0x3E)<<10; h=r[17]; vv_=r[18]; hn=(h&0x1F)*2; vn=vv_&0x1F
    vram=bytearray(v.vram)
    for cy in range(28):
        for cx in range(40):
            inH=((cx>=hn) if h&0x80 else (cx<hn)) and (hn>0 or h&0x80)
            inV=((cy>=vn) if vv_&0x80 else (cy<vn)) and (vn>0 or vv_&0x80)
            if inH or inV:
                s=wn+(cy*64+cx)*2; d=an+(cy*pw+cx)*2; vram[d]=v.vram[s]; vram[d+1]=v.vram[s+1]
    x=V(); x.reg=r; x.cram=v.cram; x.vsram=v.vsram; x.vram=bytes(vram); m=M(); m.vdp=x; return render(m)
f=0
for f in range(1300):
    if f in (1090,1140,1180,1230,1280):
        v=md.vdp; print(f,'reg17/18',v.reg[17],v.reg[18],'reg3',v.reg[3],'st',[hex(ramw(md,a)) for a in (0xE400,0xE402)],flush=True)
        render_w(md).save('%s/w%04d.png'%(out,f))
    md.pad=[S if f%45<3 else 0,0]; md.run_frame()
