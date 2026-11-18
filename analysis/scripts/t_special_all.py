import sys; sys.path.insert(0,"analysis/scripts")
import t_special as T
from drv import *
def runb(ID,boost,n=150,extra=None):
    md=T.setup(ID); f=0; out=[]; started=False
    for fr,m in T.SCRIPT+[(n,0)]:
        for _ in range(fr):
            md.pad=[m,0]; md.run_frame(); f+=1
            b=odump(md,0xC700); t=b['type']&0x7FFC
            if t==0x90 and not started:
                started=True; f0=f
                if boost:
                    z=raml(md,0xC728); 
                    ww=z+int(boost*65536); md.ram[0xC728]=(ww>>24)&255; md.ram[0xC729]=(ww>>16)&255; md.ram[0xC72A]=(ww>>8)&255; md.ram[0xC72B]=ww&255
                    b=odump(md,0xC700)
            if started: pokeb(md,0xC703,peekb(md,0xC703)&0x3F)
            if started:
                out.append((f-f0,t,b['sub'],b['tmr'],b['x'],b['y'],b['z'],b['vx'],b['vy'],b['vz'],ramw(md,0xC71A),ramw(md,0xC714),T.objs(md)))
                if t!=0x90 and f-f0>2: return out
    return out
if __name__=="__main__":
    boost=float(sys.argv[1]); n=int(sys.argv[2])
    for ID in range(1,54):
        out=runb(ID,boost,n)
        print('=== ID',ID,'frames',len(out))
        for o in out:
            ex=[(x[0],'%02x'%x[1],x[2],x[3]) for x in o[12] if x[1] in (0x84,0x78,0x8c,0x80,0x88)]
            print('%3d t=%02x sub=%02x tmr=%d p=(%.1f,%.1f,%.1f) v=(%.3f,%.3f,%.3f) pow=%d'%(o[0],o[1],o[2],o[3],o[4],o[5],o[6],o[7],o[8],o[9],o[10]),ex if ex else '')
