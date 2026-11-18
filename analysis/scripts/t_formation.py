# 포메이션(작전 타임) 발동 타임라인 기록. 사용: python -I analysis/scripts/t_formation.py [yes|no] [frames] [shotdir]
import numpy as np
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
def setup():
    md=load('ctrl0')
    pokew(md,0xC700,4); pokeb(md,0xC703,peekb(md,0xC703)|0x10); pokew(md,0xC71C,0xC000)
    pokeb(md,0xC003,peekb(md,0xC003)|0x10); pokeb(md,0xE756,1); pokeb(md,0xE716,1)
    pokew(md,0xC752,0xE700)
    return md
def snap(md):
    side=0xE700
    pl=[]
    for i in range(14):
        a=0xC000+i*0x80; o=odump(md,a)
        pl.append((i,o['type']&0x7FFC,o['sub'],o['f1a'],round(o['x']),round(o['y']),round(o['z'])))
    b=odump(md,0xC700)
    return dict(st=st(md),E250=peekb(md,0xE250),E251=peekb(md,0xE251),E238=peekb(md,0xE238),s58=peekb(md,side+0x58),s59=peekb(md,side+0x59),s6a=peekb(md,side+0x6A),
        cam=raml(md,0xE006)/65536,ball=(b['type']&0x7FFC,b['sub'],round(b['x']),round(b['y']),round(b['z']),round(b['vx'],2),round(b['vy'],2),round(b['vz'],2),ramw(md,0xC71A),ramw(md,0xC71C)),
        ban=[ramw(md,0xD900+k*0x80)&0x7FFC for k in range(3)], banid=[ramw(md,0xD914+k*0x80) for k in range(3)], pl=pl,
        q=[peekb(md,0xE610+k) for k in range(8)])
if __name__=="__main__":
    yes=(sys.argv[1] if len(sys.argv)>1 else 'yes')=='yes'
    N=int(sys.argv[2]) if len(sys.argv)>2 else 600
    out=sys.argv[3] if len(sys.argv)>3 else None
    shots=set(int(x) for x in sys.argv[4].split(',')) if len(sys.argv)>4 else set()
    md=setup()
    script=[(10,0),(2,S),(20,0),(2,L if yes else R),(10,0),(2,B),(0,0)]
    f=0; prev=None
    seq=[]
    for fr,m in script: seq+= [m]*fr
    seq+=[0]*N
    for f,m in enumerate(seq):
        md.pad=[m,0]; md.run_frame()
        s=snap(md)
        key=(s['st'],s['E250'],s['E251'],s['E238'],s['s58'],s['s59'],s['s6a'],s['ban'],s['banid'],s['ball'][0],s['ball'][9])
        if key!=prev or f%30==0:
            print(f,'pad=%02x'%m,s['st'],'E250',s['E250'],'E251',s['E251'],'E238',s['E238'],'s58=%02x'%s['s58'],'s59',s['s59'],'pass',s['s6a'],'cam%.0f'%s['cam'],'ban',[hex(x) for x in s['ban']],s['banid'],'ball',s['ball'])
            if key!=prev: print('   pl',[p for p in s['pl'] if p[0]<7])
        prev=key
        if out and f in shots: H.render(md).save(out+'/f%04d.png'%f)
