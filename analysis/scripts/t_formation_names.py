# 팀별 작전 이름 그래픽(ROM 0x18718[팀] -> 0x38660 압축 그래픽) 렌더. 사용: python -I analysis/scripts/t_formation_names.py <state.pkl> <out.png> [scale]
import numpy as np
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
from t_banner_dump import frame_img, u32, u16
from PIL import Image, ImageDraw
import gfxdec
def call(md,addr,**regs):
    for k,v in regs.items():
        (md.d if k[0]=='d' else md.a)[int(k[1])]=v
    sav=md.intmask; md.intmask=7
    SENT=0x3FFFF0; md.push(4,SENT); md.pc=addr
    n=0
    while md.pc!=SENT:
        md.step(); n+=1
        if n>5_000_000: raise Exception('timeout')
    md.intmask=sav
st_path=sys.argv[1]; out=sys.argv[2]; sc=int(sys.argv[3]) if len(sys.argv)>3 else 3
R=open('rom/danpei.gen','rb').read()
crops=[]
for team in range(15):
    md=pickle.load(open(st_path,'rb'))
    idx=R[0x18718+team]; a=0x38660+int.from_bytes(R[0x38660+2*idx:0x38662+2*idx],'big',signed=True)
    data=gfxdec.decode(R,a)
    data=data[0] if isinstance(data,tuple) else data
    md.vdp.vram[0xE0*32:0xE0*32+len(data)]=bytes(data)
    im,ps=frame_img(md,u32(0xe130+4*8),u16(0xe0fc+2*8))
    bb=im.getbbox(); crops.append((team,R[0x18718+team],im.crop(bb) if bb else im))
W=max(c[2].width for c in crops)*sc+40; H=sum(c[2].height*sc+6 for c in crops)+10
m=Image.new('RGBA',(W+60,H),(24,24,24,255)); d=ImageDraw.Draw(m); y=4
for team,idx,c in crops:
    d.text((2,y),'t%02d i%02d'%(team,idx),fill=(255,255,0)); m.paste(c.resize((c.width*sc,c.height*sc),Image.NEAREST),(60,y),c.resize((c.width*sc,c.height*sc),Image.NEAREST)); y+=c.height*sc+6
m.save(out); print('ok',[(t,i,c.size) for t,i,c in crops])
