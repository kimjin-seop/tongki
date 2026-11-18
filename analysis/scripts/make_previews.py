"""미리보기 PNG 생성: 팔레트 스와치 + 대표 스트림 시트 (analysis/gfx/preview_*.png)."""
import sys,subprocess
sys.path.insert(0,'analysis/scripts')
from PIL import Image,ImageDraw
rom=open('rom/danpei.gen','rb').read()
# 팔레트 스와치: palettes.txt 의 각 구간을 16색 한 줄씩
rows=[]
for l in open('analysis/palettes.txt'):
    o,w,u=l.split();o=int(o,16);n=int(w.split('=')[1])
    for line in range(min(n//16,40)):
        rows.append((o+line*32,[(rom[o+line*32+i*2]<<8)|rom[o+line*32+i*2+1] for i in range(16)]))
S=12
im=Image.new('RGB',(16*S+90,len(rows)*S),(20,20,20));d=ImageDraw.Draw(im)
for r,(off,ws) in enumerate(rows):
    d.text((2,r*S),"%06x"%off,fill=(200,200,200))
    for i,w in enumerate(ws):
        c=(((w>>1)&7)*36,((w>>5)&7)*36,((w>>9)&7)*36)
        d.rectangle([90+i*S,r*S,90+i*S+S-1,r*S+S-2],fill=c)
im.save('analysis/gfx/preview_palettes.png')
print(len(rows),'palette lines')
def sheet(name,offs):
    ims=[Image.open('analysis/gfx/streams/%06x.png'%o).convert('RGB') for o in offs]
    W=max(i.width for i in ims);H=sum(i.height+4 for i in ims)
    s=Image.new('RGB',(W,H),(60,0,60));y=0
    for i in ims:s.paste(i,(0,y));y+=i.height+4
    s.save(name)
sheet('analysis/gfx/preview_big_art_1fcde.png',[0x1fcde,0x20b26,0x21a3a])
sheet('analysis/gfx/preview_char_sprites_40364.png',[0x40364,0x40ef2,0x41ae8])
sheet('analysis/gfx/preview_team_sprites_4f49e.png',[0x4f49e,0x4f8f4,0x501c8])
sheet('analysis/gfx/preview_small_ui_2e684.png',[0x2e684,0x2e77a,0x2e95c,0x2e9f6,0x2eadc,0x2ed02])
sheet('analysis/gfx/preview_fx_38d90.png',[0x38d90,0x38e96,0x39588,0x37efa])
sheet('analysis/gfx/preview_large_58000.png',[0x58000,0x5aa84])
