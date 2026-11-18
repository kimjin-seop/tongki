import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import os
os.makedirs('_verify/audit1/orig',exist_ok=True)
def sv(md,n,scale=3):
    im=render(md); im=im.resize((im.width*scale,im.height*scale),0); im.save('_verify/audit1/orig/%s.png'%n); print('saved',n,im.size)
md=load('play0'); sv(md,'o00_play0_entry')
md=load('ctrl0'); sv(md,'o01_ctrl0_play')
import copy
def at(n,pad_seq,name):
    md=load('ctrl0')
    for m in pad_seq:
        md.pad=[m,0]; md.run_frame()
    sv(md,name)
at(0,[R]*20,'o02_walkR20')
at(0,[C]+[0]*7,'o03_jump8')
md=None
