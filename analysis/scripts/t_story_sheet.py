"""story_rec.pkl 몽타주. python -I analysis/scripts/t_story_sheet.py <pkl> <f0> <f1> <step> <out.png>"""
import numpy
import sys; sys.path.insert(0,"analysis/scripts")
import intro_lib as I
from PIL import Image, ImageDraw
rec=I.load(sys.argv[1]); f0,f1,st=map(int,sys.argv[2:5]); out=sys.argv[5]
fs=list(range(f0,min(f1,len(rec['fr'])),st)); cols=6
sh=Image.new('RGB',(cols*320,((len(fs)+cols-1)//cols)*236))
d=ImageDraw.Draw(sh)
for n,f in enumerate(fs):
    im=I.screen(rec,f); x,y=(n%cols)*320,(n//cols)*236
    sh.paste(im,(x,y+12)); d.text((x+2,y),str(f),fill=(255,255,0))
sh.save(out)
