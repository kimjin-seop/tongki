"""스트림 PNG를 세로로 이어 붙인 미리보기: python -I sheet.py out.png off1 off2 ..."""
import sys
from PIL import Image
out=sys.argv[1];offs=[int(x,16) for x in sys.argv[2:]]
ims=[Image.open('analysis/gfx/streams/%06x.png'%o).convert('RGB') for o in offs]
W=max(i.width for i in ims);H=sum(i.height+4 for i in ims)
s=Image.new('RGB',(W,H),(60,0,60));y=0
for i in ims:s.paste(i,(0,y));y+=i.height+4
s.save(out)
