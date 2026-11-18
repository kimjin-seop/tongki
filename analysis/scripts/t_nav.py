import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
from PIL import Image
md=new()
print(to_modemenu(md))
pokew(md,0xC024,int(sys.argv[1]))
ims=[]
for i in range(70):
    tap(md,S if i%3!=1 else C,25)
    s=st(md)
    print(i,s,hex(ramw(md,0xE400)),hex(ramw(md,0xE402)),hex(ramw(md,0xE704)),hex(ramw(md,0xE784)))
    ims.append(render(md).resize((160,112)))
    if s[0]==0x14: break
sh=Image.new('RGB',(160*8,112*9))
for i,im in enumerate(ims): sh.paste(im,((i%8)*160,(i//8)*112))
sh.save('analysis/gfx/emu_sheet2.png')
