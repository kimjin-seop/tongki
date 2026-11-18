"""디렉터리의 PNG 몽타주. 사용: t_pm_sheet.py out.png scale cols files..."""
import sys
from PIL import Image, ImageDraw
out=sys.argv[1]; sc=float(sys.argv[2]); cols=int(sys.argv[3]); fs=sys.argv[4:]
W,H=int(320*sc),int(224*sc)
sh=Image.new('RGB',(W*cols,(H+12)*((len(fs)+cols-1)//cols)),(40,40,40)); d=ImageDraw.Draw(sh)
for i,f in enumerate(fs):
    im=Image.open(f).convert('RGB').resize((W,H),Image.NEAREST); x=(i%cols)*W; y=(i//cols)*(H+12)
    sh.paste(im,(x,y+12)); d.text((x+2,y),f.split('/')[-1].split(chr(92))[-1][:-4],fill=(255,255,0))
sh.save(out)
