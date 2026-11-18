"""기록 pkl 에서 프레임 목록 몽타주. 사용: t_select_sheet.py rec.pkl out.png f0 f1 step [cols] [scale]"""
import numpy as np
import sys; sys.path.insert(0,"analysis/scripts")
import intro_lib as I
from PIL import Image, ImageDraw
rec=I.load(sys.argv[1]); out=sys.argv[2]; a,b,s=map(int,sys.argv[3:6])
cols=int(sys.argv[6]) if len(sys.argv)>6 else 6; sc=float(sys.argv[7]) if len(sys.argv)>7 else 0.5
fs=list(range(a,min(b,len(rec['fr'])),s))
W,H=int(320*sc),int(224*sc)
sh=Image.new('RGB',(W*cols,(H+12)*((len(fs)+cols-1)//cols)),(40,40,40)); d=ImageDraw.Draw(sh)
for i,f in enumerate(fs):
    im=I.screen(rec,f).resize((W,H),Image.NEAREST); x=(i%cols)*W; y=(i//cols)*(H+12)
    sh.paste(im,(x,y+12)); d.text((x+2,y),'f%d %s'%(f,'/'.join('%x'%v for v in rec['fr'][f]['st'])),fill=(255,255,0))
sh.save(out)
