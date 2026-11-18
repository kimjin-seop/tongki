import numpy
import sys,json,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
OUT='analysis/gfx/start/'
md=load('match_story0')
def od(a):
    return dict(t=ramw(md,a)&0x7FFC,sub=peekb(md,a+0x17),an=ramw(md,a+6),fi=peekb(md,a+0x10),ft=peekb(md,a+0x11),f2=peekb(md,a+2),f3=peekb(md,a+3),
      x=round(raml(md,a+0x20)/65536,2),y=round(raml(md,a+0x24)/65536,2),z=round(s32(raml(md,a+0x28))/65536,2),
      vx=round(s32(raml(md,a+0x30))/65536,3),vy=round(s32(raml(md,a+0x34))/65536,3),vz=round(s32(raml(md,a+0x38))/65536,3),tm=ramw(md,a+0x18),a12=hex(ramw(md,a+0x12)),p14=ramw(md,a+0x14))
log=[];prev=None
shots=set(int(x) for x in sys.argv[1].split(",") if x) if len(sys.argv)>1 else set()
for f in range(int(sys.argv[2]) if len(sys.argv)>2 else 600):
    e=(ramw(md,0xE600),ramw(md,0xE602)&0x7C)
    R=dict(f=f,st=e,cam=(ramw(md,0xE004),ramw(md,0xE006)),ref=od(0xC780),ball=od(0xC700),p0=od(0xC000),p7=od(0xC380),ban=od(0xD900),ban2=od(0xD980),e239=peekb(md,0xE239))
    log.append(R)
    key=(e,R['ref']['t'],R['ref']['sub'],R['ref']['an'],R['ball']['t'],R['ball']['sub'],R['p0']['t'],R['p0']['sub'],R['p0']['an'],R['p7']['t'],R['p7']['sub'],R['p7']['an'],R['ban']['t'],R['ban']['p14'])
    if key!=prev:
        print(f,'st %02x/%02x'%e,'ref',R['ref']['t'],R['ref']['sub'],R['ref']['an'],(R['ref']['x'],R['ref']['y']),'ball',R['ball']['t'],R['ball']['sub'],(R['ball']['x'],R['ball']['y'],R['ball']['z']),'p0',R['p0']['t'],R['p0']['sub'],R['p0']['an'],(R['p0']['x'],R['p0']['y'],R['p0']['z']),'p7',R['p7']['t'],R['p7']['sub'],R['p7']['an'],(R['p7']['x'],R['p7']['y'],R['p7']['z']),'ban',R['ban']['t'],R['ban']['p14'],R['ban']['tm'],'cam',R['cam'])
    prev=key
    if f in shots: H.render(md).save(OUT+'raw_f%03d.png'%f)
    md.pad=[0,0]; md.run_frame()
json.dump(log,open('C:/Users/김진섭/AppData/Local/Temp/claude/64c85a23ae5c511c/fc8a8997-264e-47a4-83b3-a502d38ec8f0/scratchpad/start_log3.json','w'))
pickle.dump(md,open('C:/Users/김진섭/AppData/Local/Temp/claude/64c85a23ae5c511c/fc8a8997-264e-47a4-83b3-a502d38ec8f0/scratchpad/after.pkl','wb'))
