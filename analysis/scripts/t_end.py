import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
from PIL import Image
md=load('play0')
pokeb(md,0xE717,0); pokeb(md,0xE797,0)
pokeb(md,0xE757,int(sys.argv[1])); pokeb(md,0xE7D7,int(sys.argv[2]))
last=None; shots=[]
for f in range(int(sys.argv[3])):
    md.pad=[0,0]; md.run_frame()
    s=(ramw(md,0xE600),ramw(md,0xE602),peekb(md,0xE757),peekb(md,0xE7D7))
    if s!=last:
        print(f,[hex(x) for x in s],'t',peekb(md,0xE685),peekb(md,0xE686),peekb(md,0xE687),flush=True); last=s
        shots.append(render(md).resize((160,112)))
sh=Image.new('RGB',(160*6,112*((len(shots)+5)//6)))
for i,im in enumerate(shots): sh.paste(im,((i%6)*160,(i//6)*112))
sh.save('analysis/gfx/emu_end.png')
print(st(md))
