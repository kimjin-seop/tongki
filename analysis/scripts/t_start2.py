import numpy
import sys,json; sys.path.insert(0,"analysis/scripts")
from drv import *
md=load('match_story0')
rec={}
for f in range(130):
    for i in range(14):
        a=0xC000+i*0x80
        r=rec.setdefault(i,dict(slot=ramw(md,a+0x1A),spd44=ramw(md,a+0x44),tgt=(ramw(md,a+0x60),ramw(md,a+0x62)),path=[]))
        r['tgt']=(ramw(md,a+0x60),ramw(md,a+0x62)); r['spd44']=ramw(md,a+0x44); r['slot']=ramw(md,a+0x1A)
        r['path'].append((f,ramw(md,a)&0x7FFC,peekb(md,a+0x17),round(raml(md,a+0x20)/65536,2),round(raml(md,a+0x24)/65536,2),round(s32(raml(md,a+0x30))/65536,3),round(s32(raml(md,a+0x34))/65536,3),peekb(md,a+0x3),peekb(md,a+0xF),peekb(md,a+0x10),hex(raml(md,a+8)),hex(raml(md,a+0xC))))
    if f in (8,9,10): print('cam',f,ramw(md,0xE004),ramw(md,0xE006),ramw(md,0xE00E))
    md.pad=[0,0]; md.run_frame()
for i,r in rec.items():
    p=r['path']
    st=[q for q in p if q[1]==0x5c]
    arr=[q for q in st if q[2]==8]
    print(i,'slot',r['slot'],'s44',r['spd44'],'tgt',r['tgt'],'start',st[1][3:7] if len(st)>1 else None,'arrive f',arr[0][0] if arr else None, arr[0][3:5] if arr else None)
    print('   f10',p[10][3:],' f30',p[30][3:])
