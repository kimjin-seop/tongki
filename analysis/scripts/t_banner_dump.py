import numpy as np
import sys,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
from PIL import Image, ImageDraw
R=open('rom/danpei.gen','rb').read()
u16=lambda a:(R[a]<<8)|R[a+1]
u32=lambda a:int.from_bytes(R[a:a+4],'big')
s8=lambda v:v-256 if v>127 else v
def frame_img(md,fp,base,pal_override=None):
    T=H.tiles_np(md.vdp.vram); cram=[H.cram_rgb(w) for w in md.vdp.cram]
    n=R[fp]+1; ps=[]
    for i in range(n):
        p=fp+2+i*6; ps.append((s8(R[p]),R[p+1],u16(p+2),s8(R[p+4])))
    img=Image.new('RGBA',(256,128),(0,0,0,0)); px=img.load()
    for (y,sz,t,x) in ps:
        e=(t+base)&0xFFFF; w=((sz>>2)&3)+1; h=(sz&3)+1; t0=e&0x7FF; hf=(e>>11)&1; pl=(e>>13)&3 if pal_override is None else pal_override
        for cx in range(w):
            for cy in range(h):
                tx=(w-1-cx) if hf else cx
                tt=T[(t0+tx*h+cy)&0x7FF]
                if hf: tt=tt[:,::-1]
                for yy in range(8):
                    for xx in range(8):
                        c=tt[yy,xx]
                        if c: px[128+x+cx*8+xx,64+y+cy*8+yy]=cram[pl*16+c]+(255,)
    return img,ps
if __name__=='__main__':
    md=pickle.load(open(sys.argv[1],'rb'))
    out=Image.new('RGB',(256*4,(128+12)*5),(40,40,40)); d=ImageDraw.Draw(out)
    for k in range(19):
        fp=u32(0xe130+4*k); base=u16(0xe0fc+2*k)
        im,ps=frame_img(md,fp,base)
        X=(k%4)*256; Y=(k//4)*140
        out.paste(im,(X,Y+12),im); d.text((X+2,Y),'type %d fp %x base %x n%d'%(k,fp,base,len(ps)),fill=(255,255,0))
        d.line((X+128,Y+12+60,X+128,Y+12+68),fill=(255,0,0)); d.line((X+124,Y+12+64,X+132,Y+12+64),fill=(255,0,0))
    out.save(sys.argv[2])
