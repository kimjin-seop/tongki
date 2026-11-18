# 필살기 발동 전후 화면 캡처(컷인/이름 표시 유무 확인). 사용: python -I analysis/scripts/t_special_cutin_check.py <ID> <outpng>
import numpy as np
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
from t_special import setup, SCRIPT
from PIL import Image, ImageDraw
ID=int(sys.argv[1]); out=sys.argv[2]
md=setup(ID); f=0; f0=None; shots=[]; seq=[]
for fr,m in SCRIPT+[(40,0)]: seq+=[m]*fr
spr=[]
for m in seq:
    md.pad=[m,0]; md.run_frame(); f+=1
    t=ramw(md,0xC700)&0x7FFC
    if t==0x90 and f0 is None: f0=f
    rel=None if f0 is None else f-f0
    if (f0 is None and f%8==0) or (rel is not None and rel in (-1,0,1,2,4,8,12,20)):
        shots.append(('f%d%s'%(f,'' if rel is None else ' rel%+d'%rel), H.render(md).convert('RGB'),[ramw(md,0xD900+k*0x80)&0x7FFC for k in range(4)], peekb(md,0xE602)))
cols=4; W,Hh=320,224
m=Image.new('RGB',(cols*W,((len(shots)+cols-1)//cols)*(Hh+14)),(30,30,30)); d=ImageDraw.Draw(m)
for i,(lab,im,ban,sub) in enumerate(shots):
    x=(i%cols)*W; y=(i//cols)*(Hh+14); m.paste(im,(x,y+14)); d.text((x+2,y+1),'%s ID%d banner=%s sub=%02x'%(lab,ID,[hex(b) for b in ban],sub),fill=(255,255,0))
m.save(out); print('f0',f0,len(shots))
