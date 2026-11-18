"""스테이지(코트) 배경 렌더: 타일맵(Enigma, 0x1A778 표) + 타일(0x1FCBE 오프셋표 -> 0x1126 압축) + 팔레트(0x1A598 표).
$e682=스테이지 번호(0..15). 팔레트 라인은 단일(0x1A598 항목)만 알려져 있어 모든 라인에 동일 적용(근사)."""
import sys,struct
sys.path.insert(0,'analysis/scripts')
from enigma import enigma
from gfxdec import decode
from PIL import Image
rom=open('rom/danpei.gen','rb').read()
def pal16(o):
    out=[]
    for i in range(16):
        w=(rom[o+i*2]<<8)|rom[o+i*2+1]
        out.append((((w>>1)&7)*36,((w>>5)&7)*36,((w>>9)&7)*36))
    return out
def render(stage):
    mo=struct.unpack('>H',rom[0x1a778+stage*2:0x1a778+stage*2+2])[0]+0x1a778
    words,_=enigma(rom,mo,0x730)
    go=struct.unpack('>H',rom[0x1fcbe+stage*2:0x1fcbe+stage*2+2])[0]+0x1fcbe
    tiles,_,_,nt=decode(rom,go)
    po=struct.unpack('>H',rom[0x1a598+stage*2:0x1a598+stage*2+2])[0]+0x1a598
    pal=pal16(po)
    im=Image.new('RGB',(64*8,28*8),(0,0,0));px=im.load()
    for i,w in enumerate(words[:64*28]):
        tx,ty=i%64,i//64
        t=(w&0x7ff)-0x730
        vf=bool(w&0x1000);hf=bool(w&0x800)
        if t<0 or t>=nt:continue
        for y in range(8):
            for x in range(8):
                sx=7-x if hf else x;sy=7-y if vf else y
                b=tiles[t*32+sy*4+(sx>>1)]
                c=(b>>4) if sx%2==0 else (b&15)
                if c:px[tx*8+x,ty*8+y]=pal[c]
    return im,(hex(mo),hex(go),nt,hex(po))
if __name__=='__main__':
    sheet=Image.new('RGB',(512*2,224*7),(40,0,40))
    for s in range(14):
        try:
            im,info=render(s)
        except Exception as e:
            print(s,'err',e);continue
        print(s,info)
        sheet.paste(im,((s%2)*512,(s//2)*224))
    sheet.save('analysis/gfx/preview_stages_16.png')
