import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
from PIL import Image
md=new()
hold(md,0,150)
ims=[]
for i in range(48):
    tap(md,S,20)
    s=st(md)
    print(i,s,hex(md.pc),hex(ramw(md,0xE400)),hex(ramw(md,0xE402)))
    ims.append(render(md).resize((160,112)))
sh=Image.new('RGB',(160*8,112*6))
for i,im in enumerate(ims): sh.paste(im,((i%8)*160,(i//8)*112))
sh.save('analysis/gfx/emu_sheet.png')
