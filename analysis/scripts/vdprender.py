"""간이 VDP 렌더러(H40x224): 플레인A/B(수직 전체스크롤 VSRAM[0]/[1], 가로 HScroll 전체/라인), 스프라이트, 우선순위."""
from PIL import Image
def col(w):
    return (((w>>1)&7)*36,((w>>5)&7)*36,((w>>9)&7)*36)
def render(md, W=320, H=224):
    v=md.vdp; r=v.reg; vram=v.vram
    pal=[col(w) for w in v.cram]
    pw=[32,64,128,128][r[16]&3]; ph=[32,64,128,128][(r[16]>>4)&3]
    an=(r[2]&0x38)<<10; bn=(r[4]&7)<<13; sat=(r[5]&0x7F)<<9; hs=(r[13]&0x3F)<<10
    hmode=r[11]&3
    pix=[[(0,0,0,0)]*W for _ in range(H)]  # (palidx,prio,layer) simplified
    # background color
    bg=pal[r[7]&0x3F]
    def tile_px(t,x,y,hf,vf):
        base=(t&0x7FF)*32
        if vf:y=7-y
        if hf:x=7-x
        b=vram[(base+y*4+(x>>1))&0xFFFF]
        return (b&15) if x&1 else (b>>4)
    img=[[None]*W for _ in range(H)]
    # layer buffers: low/high prio for B, A, sprites
    layers={}
    def plane(base,idx):
        low=[[0]*W for _ in range(H)];high=[[0]*W for _ in range(H)]
        for y in range(H):
            if hmode==0: hx=(vram[(hs+idx*2)&0xFFFF]<<8)|vram[(hs+idx*2+1)&0xFFFF]
            elif hmode==3: hx=(vram[(hs+y*4+idx*2)&0xFFFF]<<8)|vram[(hs+y*4+idx*2+1)&0xFFFF]
            else: hx=(vram[(hs+(y&~7)*4+idx*2)&0xFFFF]<<8)|vram[(hs+(y&~7)*4+idx*2+1)&0xFFFF]
            hx=(hx&0x3FF)  # 수정: plane_x=(x-scroll) mod W (기존은 부호 반대로 x+416 위치를 그림)
            for x in range(W):
                vs=0
                if r[11]&4:
                    vs=v.vsram[(x>>4)*2+idx]&0x3FF
                else: vs=v.vsram[idx]&0x3FF
                yy=(y+vs)%(ph*8); xx=(x-hx)%(pw*8)
                e=(vram[(base+((yy>>3)*pw+(xx>>3))*2)&0xFFFF]<<8)|vram[(base+((yy>>3)*pw+(xx>>3))*2+1)&0xFFFF]
                p=tile_px(e&0x7FF,xx&7,yy&7,(e>>11)&1,(e>>12)&1)
                if p:
                    c=pal[((e>>13)&3)*16+p]
                    (high if e&0x8000 else low)[y][x]=c
        return low,high
    bl,bh=plane(bn,1); al,ah=plane(an,0)
    out=Image.new('RGB',(W,H),bg); px=out.load()
    # sprites
    sl=[[0]*W for _ in range(H)];sh=[[0]*W for _ in range(H)]
    spr=[];i=0;cnt=0
    while cnt<80:
        a=sat+i*8
        y=(((vram[a]<<8)|vram[a+1])&0x3FF)-128
        sz=vram[a+2];nx=vram[a+3]&0x7F
        e=(vram[a+4]<<8)|vram[a+5]
        x=(((vram[a+6]<<8)|vram[a+7])&0x1FF)-128
        spr.append((y,x,sz,e));cnt+=1
        if nx==0:break
        i=nx
    for (y,x,sz,e) in reversed(spr):
        w=((sz>>2)&3)+1;h=(sz&3)+1;t0=e&0x7FF;hf=(e>>11)&1;vf=(e>>12)&1;pl=(e>>13)&3
        for cx in range(w):
            for cy in range(h):
                tx=(w-1-cx) if hf else cx; ty=(h-1-cy) if vf else cy
                t=t0+tx*h+ty
                for yy in range(8):
                    for xx in range(8):
                        p=tile_px(t,xx,yy,hf,vf)
                        if not p:continue
                        X=x+cx*8+xx;Y=y+cy*8+yy
                        if 0<=X<W and 0<=Y<H:
                            c=pal[pl*16+p]
                            (sh if e&0x8000 else sl)[Y][X]=c
    for y in range(H):
        for x in range(W):
            for L in (bl,al,sl,bh,ah,sh):
                c=L[y][x]
                if c:px[x,y]=c
    return out
