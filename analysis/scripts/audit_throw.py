import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
def setup():
    md=load('ctrl0')
    pokew(md,0xC700,4); pokeb(md,0xC703,peekb(md,0xC703)|0x10); pokew(md,0xC71C,0xC000)
    pokeb(md,0xC003,peekb(md,0xC003)|0x10); pokeb(md,0xE756,1); pokeb(md,0xE716,1)
    pokew(md,0xC752,0xE700)
    return md
def run(script,n=70,tag=''):
    md=setup(); out=[]
    for fr,m in script+[(n,0)]:
        for _ in range(fr):
            md.pad=[m,0]; md.run_frame()
            b=odump(md,0xC700); p=odump(md,0xC000)
            out.append((b['type']&0x7FFC,round(b['x'],1),round(b['y'],1),round(b['z'],1),round(b['vx'],2),round(b['vy'],2),round(b['vz'],2),ramw(md,0xC71A),ramw(md,0xC774),p['sub'],p['tmr'],round(p['z'],1)))
    return out
if __name__=='__main__':
    for name,sc in (('ground B tap',[(1,B)]),('ground B hold5',[(5,B)]),('air B(chg3)',[(1,C),(8,0),(1,B|C),(2,B)])):
        o=run(sc)
        print(name)
        first=[i for i,x in enumerate(o) if x[0]==0x14 or x[0]==0x90]
        print(' first flight idx',first[:1])
        for i,x in enumerate(o[:60]):
            if i%4==0 or (first and i==first[0]): print('  ',i,x)
