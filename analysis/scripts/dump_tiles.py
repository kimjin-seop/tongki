"""catalog.json의 모든 압축 타일 스트림을 해제하여 PNG(8x8 타일 시트, 16열, 회색조 팔레트)로 저장.
사용: python -I analysis/scripts/dump_tiles.py  -> analysis/gfx/streams/<offset>.png , analysis/gfx/raw/<offset>.bin(저장 안 함: 에셋 재배포 방지 위해 PNG만)"""
import sys,json
sys.path.insert(0,'analysis/scripts')
from gfxdec import decode
from PIL import Image
rom=open('rom/danpei.gen','rb').read()
def tiles_to_img(data,cols=16,pal=None):
    n=len(data)//32
    rows=(n+cols-1)//cols
    im=Image.new('P',(cols*8,rows*8),0)
    if pal is None:pal=[(i*17,i*17,i*17) for i in range(16)]
    flat=[]
    for c in pal:flat+=list(c)
    im.putpalette(flat+[0]*(768-len(flat)))
    px=im.load()
    for t in range(n):
        base=t*32
        for y in range(8):
            row=data[base+y*4:base+y*4+4]
            for x in range(8):
                b=row[x>>1]
                px[(t%cols)*8+x,(t//cols)*8+y]=(b>>4) if x%2==0 else (b&15)
    return im
def md_pal(words):
    out=[]
    for w in words:
        out.append((((w>>1)&7)*36,((w>>5)&7)*36,((w>>9)&7)*36))
    return out
if __name__=='__main__':
    cat=json.load(open('analysis/gfx/catalog.json'))
    for c in cat:
        t,e,dl,n=decode(rom,c['off'])
        im=tiles_to_img(t)
        im=im.resize((im.width*3,im.height*3),Image.NEAREST)
        im.save('analysis/gfx/streams/%06x.png'%c['off'])
    print(len(cat))
