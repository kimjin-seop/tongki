import sys; sys.path.insert(0,"analysis/scripts")
import t_special as T
from drv import *
def run(ID,n=70,watch=0xC380,pre=None):
    md=T.setup(ID)
    if pre: pre(md)
    print('P0 s4(+0x48)=',ramw(md,0xC048),'s6(+0x4c)=',ramw(md,0xC04C),'tgt',hex(ramw(md,0xE21E)))
    f=0;started=False
    for fr,m in T.SCRIPT+[(n,0)]:
        for _ in range(fr):
            md.pad=[m,0]; md.run_frame(); f+=1
            b=odump(md,0xC700); t=b['type']&0x7FFC
            if t==0x90 and not started: started=True; f0=f; print('special start frame',f)
            if started:
                o=odump(md,watch)
                print(f-f0,'ball %02x'%t,'p=(%.0f,%.0f,%.0f)'%(b['x'],b['y'],b['z']),'pow',ramw(md,0xC71A),'f3=%02x'%peekb(md,0xC703),'| tgt type %02x sub %02x hp=%d pos=(%.0f,%.0f,%.0f)'%(o['type']&0x7FFC,o['sub'],o['hp'],o['x'],o['y'],o['z']),'own=%04x'%ramw(md,0xC71C))
if __name__=="__main__":
    run(int(sys.argv[1]),int(sys.argv[2]))
