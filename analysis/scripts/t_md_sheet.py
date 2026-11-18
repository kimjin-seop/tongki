"""PNG 여러 장을 한 장 몽타주로. 사용: python -I analysis/scripts/t_md_sheet.py <out.png> <열 수> <축소 배율(예 0.5)> <png...>"""
import sys
from PIL import Image
out,cols,sc=sys.argv[1],int(sys.argv[2]),float(sys.argv[3]); fs=sys.argv[4:]
ims=[Image.open(f) for f in fs]; w,h=ims[0].size; w=int(w*sc); h=int(h*sc)
rows=(len(ims)+cols-1)//cols; sh=Image.new('RGB',(w*cols,h*rows))
for i,im in enumerate(ims): sh.paste(im.resize((w,h),Image.NEAREST if sc>=1 else Image.LANCZOS),((i%cols)*w,(i//cols)*h))
sh.save(out)
