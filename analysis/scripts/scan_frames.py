"""스프라이트 프레임 구조체 탐색. 포맷(0x1944 루틴에서 역추정):
 frame = [n-1 (u8)][flag (u8)] + n * piece(6B)
 piece = [y s8][size u8 (VDP 스프라이트 크기 비트: bit3-2 가로-1, bit1-0 세로-1)][tile u16][x s8][xflip_x s8]
앵커: 애니 레코드 [count][speed][ptr.l * count] 중 모든 ptr이 프레임 구조체로 유효한 것을 찾는다."""
import sys,json
rom=open('rom/danpei.gen','rb').read()
def parse_frame(o):
    if o<0x1000 or o+2>len(rom) or o&1:return None
    n=rom[o]+1
    if n>24:return None
    ps=[];p=o+2
    for i in range(n):
        if p+6>len(rom):return None
        y=rom[p];sz=rom[p+1];tile=(rom[p+2]<<8)|rom[p+3];x=rom[p+4];xf=rom[p+5]
        if sz&0xf0:return None
        s8=lambda v:v-256 if v>=128 else v
        ps.append((s8(y),sz,tile,s8(x),s8(xf)));p+=6
    return dict(off=o,n=n,flag=rom[o+1],pieces=ps)
anims=[]
for o in range(0x200,len(rom)-8,2):
    c=rom[o];sp=rom[o+1]
    if not(1<=c<=24 and sp<0x40):continue
    ok=True;fr=[]
    for i in range(c):
        q=o+2+i*4
        if q+4>len(rom):ok=False;break
        ptr=int.from_bytes(rom[q:q+4],'big')
        if not(0x1000<=ptr<0x80000):ok=False;break
        f=parse_frame(ptr)
        if f is None:ok=False;break
        fr.append(ptr)
    if ok:anims.append(dict(off=o,count=c,speed=sp,frames=fr))
json.dump(anims,open('analysis/gfx/anims.json','w'))
print(len(anims))
import collections
reg=collections.Counter(a['off']>>12 for a in anims)
print(sorted((hex(k<<12),v) for k,v in reg.items()))
