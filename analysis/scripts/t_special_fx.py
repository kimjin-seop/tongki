import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import t_special as T
def run(ID,shots=(),boost=0,tag=''):
    md=T.setup(ID); f=0; started=False; cr0=None; res=[]
    for fr,m in T.SCRIPT+[(70,0)]:
        for _ in range(fr):
            md.pad=[m,0]; md.run_frame(); f+=1
            t=ramw(md,0xC700)&0x7FFC
            if t==0x90 and not started:
                started=True;f0=f;cr0=list(md.vdp.cram)
                if boost:
                    z=raml(md,0xC728)+int(boost*65536)
                    for i in range(4): md.ram[0xC728+i]=(z>>(24-8*i))&255
            if started:
                if t==0x90: pokeb(md,0xC703,peekb(md,0xC703)&0x3F)
                v=md.vdp
                res.append((f-f0,t,sum(1 for a,b in zip(v.cram,cr0) if a!=b),v.vsram[0],v.vsram[1],(v.vram[(v.reg[13]&0x3F)<<10]<<8)|v.vram[((v.reg[13]&0x3F)<<10)+1]))
                if (f-f0) in shots:
                    img=render(md); img.save('analysis/gfx/_sp_%d_%d%s.png'%(ID,f-f0,tag))
                if t!=0x90 and f-f0>2: break
        else: continue
        break
    return res
if __name__=="__main__":
    ID=int(sys.argv[1]); shots=tuple(int(x) for x in sys.argv[2].split(',')) if len(sys.argv)>2 and sys.argv[2] else ()
    b=float(sys.argv[3]) if len(sys.argv)>3 else 0
    r=run(ID,shots,b)
    print('frames',len(r),'cram-diff max',max(x[2] for x in r),'vsram range',min(x[3] for x in r),max(x[3] for x in r),'hscroll range',min(x[5] for x in r),max(x[5] for x in r))
