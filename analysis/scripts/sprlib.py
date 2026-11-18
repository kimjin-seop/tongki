"""선수 스프라이트 애니/프레임 파서 (ROM 정적 파싱)."""
ROM=open('rom/danpei.gen','rb').read()
def u16(a): return (ROM[a]<<8)|ROM[a+1]
def u32(a): return (ROM[a]<<24)|(ROM[a+1]<<16)|(ROM[a+2]<<8)|ROM[a+3]
def s8(v): return v-256 if v>127 else v
def parse_frame(o):
    n=ROM[o]+1; hb=ROM[o+1]; ps=[]
    for i in range(n):
        p=o+2+i*6
        ps.append(dict(y=s8(ROM[p]),size=ROM[p+1],tile=u16(p+2),x=s8(ROM[p+4]),xf=s8(ROM[p+5])))
    return dict(off=o,hb=hb,pieces=ps)
def parse_animset(base):
    """base 에서 word 오프셋표(첫 값 = 표 바이트 크기). 반환 {anim_id(byte offset): {frames:[...],speed}}"""
    first=u16(base)
    n=first//2
    out={}
    for i in range(n):
        off=u16(base+2*i)
        a=base+off
        cnt=ROM[a]; sp=ROM[a+1]
        frs=[]
        for k in range(cnt):
            frs.append(u32(a+2+4*k))
        out[2*i]=dict(off=a,count=cnt,speed=sp,frames=frs)
    return out
BODY_SETS=[u32(0x2fe00+4*i) for i in range(3)]
