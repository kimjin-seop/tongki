import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
md=load('play0')
script=eval(sys.argv[1])  # list of (frames, mask)
names={}
last={}
f=0
def snap():
    out=[]
    for k in list(range(14))+[14,15,16,17]:
        a=0xC000+k*0x80
        out.append((ramw(md,a),peekb(md,a+0x16)))
    return out
def log(tag=''):
    global last
    cur=snap()
    ch=[(k,hex(c[0]),hex(c[1])) for k,c in enumerate(cur) if last.get(k)!=c]
    for k,c in enumerate(cur): last[k]=c
    if ch: print(f,tag,ch, 'ball', {x:(round(v,1) if not isinstance(v,int) else hex(v)) for x,v in odump(md,0xC700).items() if x in('x','y','z','vx','vy','vz','own','tmr','f1a')},'E602',hex(ramw(md,0xE602)))
for fr,m in script:
    for _ in range(fr):
        md.pad=[m,0]; md.run_frame(); f+=1
        log(hex(m))
