import sys,os,pickle
sys.path.insert(0,'analysis/scripts')
from drv import *
md=load('play0'); pokeb(md,0xE680,1)
last=None; lt=[None]*14
for f in range(1,int(sys.argv[1])+1):
    md.pad=[0,0]; md.run_frame()
    s=(ramw(md,0xE602),peekb(md,0xE757),peekb(md,0xE7D7))
    if s!=last: print('f%d E602=%x rem=%d-%d clock=%s'%(f,*s,bytes(md.ram[0xE685:0xE687]).hex())); last=s
    for i in range(14):
        a=0xC000+i*0x80; t=ramw(md,a)&0x7ffc
        k=(t,peekb(md,a+0x6d))
        if k!=lt[i] and (t in (0x3c,0x4c,0x48) or (lt[i] and lt[i][0] in (0x3c,0x4c))):
            b=0xC700
            print('  f%d p%d type=%x slot=%d hp=%d f6d=%d | ball t=%x z=%.1f last=%x'%(f,i,t,ramw(md,a+0x1a),ramw(md,a+0x40),k[1],ramw(md,b)&0x7ffc,raml(md,b+0x28)/65536,ramw(md,b+0x3c)))
        lt[i]=k
