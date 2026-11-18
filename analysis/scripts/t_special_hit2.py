import sys; sys.path.insert(0,"analysis/scripts")
import t_special as T
from drv import *
def trial(ID,k,n=90,eval_=True):
    md=T.setup(ID)
    for _ in range(k): md.pad=[0,0]; md.run_frame()
    hp0=[ramw(md,0xC000+i*0x80+0x40) for i in range(14)]
    f=0;started=False;res='miss'
    for fr,m in T.SCRIPT+[(n,0)]:
        for _ in range(fr):
            md.pad=[m,0]; md.run_frame(); f+=1
            b=odump(md,0xC700); t=b['type']&0x7FFC
            if t==0x90 and not started: started=True; f0=f; pw=0
            if started:
                if t==0x90: pw=ramw(md,0xC71A)
                if t==4: return 'CAUGHT by %04x pow=%d f=%d'%(ramw(md,0xC71C),pw,f-f0),None
                hp=[ramw(md,0xC000+i*0x80+0x40) for i in range(14)]
                if hp!=hp0:
                    d=[(i,hp0[i],hp[i],ramw(md,0xC000+i*0x80+0x42)) for i in range(14) if hp[i]!=hp0[i]]
                    return 'HIT (idx,hp0,hp1,def) %s pow=%d f=%d ball type %02x vz=%.2f'%(d,pw,f-f0,t,b['vz']),None
    return 'none',None
if __name__=="__main__":
    ID=int(sys.argv[1])
    for k in range(0,int(sys.argv[2])):
        print(ID,k,trial(ID,k)[0],flush=True)
