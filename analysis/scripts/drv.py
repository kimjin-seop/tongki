import sys
sys.path.insert(0,'analysis/scripts')
from m68k import *
from vdprender import render
U,D,L,R,B,C,A,S=1,2,4,8,16,32,64,128
def new(): return MD('rom/danpei.gen')
def hold(md,m0,n,m1=0):
    for _ in range(n):
        md.pad=[m0,m1]; md.run_frame()
def tap(md,m,wait=6,hl=2,m1=0):
    hold(md,m,hl,m1); hold(md,0,wait)
def st(md): return ramw(md,0xE600),ramw(md,0xE602)
def until(md,cond,maxf=600,pad=0,m1=0):
    for i in range(maxf):
        if cond(md): return i
        md.pad=[pad,m1]; md.run_frame()
    return -1
def to_modemenu(md):
    hold(md,0,150)
    # title -> start
    for _ in range(5):
        tap(md,S,25)
        if st(md)[0]==0x8C: break
    return st(md)
def to_modemenu(md):
    hold(md,0,150)
    for i in range(30):
        tap(md,S,30)
        if st(md)[0]==0x8C and i>5: break
    hold(md,0,20)
    return st(md)
def pokew(md,a,v): md.ram[a&0xFFFF]=(v>>8)&255; md.ram[(a+1)&0xFFFF]=v&255
def pokeb(md,a,v): md.ram[a&0xFFFF]=v&255
def peekb(md,a): return md.ram[a&0xFFFF]
import pickle
def load(n='match_story0'): return pickle.load(open('analysis/state/%s.pkl'%n,'rb'))
def s16(v): return v-0x10000 if v&0x8000 else v
def s32(v): return v-(1<<32) if v&0x80000000 else v
def obj(md,i,base=0xC000):
    o=base+i*0x80 if i<64 else i
    return o
def odump(md,a):
    pass
def odump_old(md,a):
    w=lambda k:ramw(md,a+k)
    return dict(type=w(0),st14=peekb(md,a+0x14),mir=peekb(md,a+0x15),sub=peekb(md,a+0x16),tmr=w(0x18),f1a=w(0x1A),own=w(0x1C),f1e=peekb(md,a+0x1E),
      x=raml(md,a+0x20)/65536,y=raml(md,a+0x24)/65536,z=raml(md,a+0x28)/65536,
      vx=s32(raml(md,a+0x30))/65536,vy=s32(raml(md,a+0x34))/65536,vz=s32(raml(md,a+0x38))/65536,hp=w(0x40),side=w(0x52))
def odump(md,a):
    w=lambda k:ramw(md,a+k)
    return dict(type=w(0),st14=peekb(md,a+0x15),mir=peekb(md,a+0x15),sub=peekb(md,a+0x17),init=peekb(md,a+0x16)>>7,tmr=w(0x18),f1a=w(0x1A),own=w(0x1C),f1e=peekb(md,a+0x1E),hb=peekb(md,a+4),
      x=raml(md,a+0x20)/65536,y=raml(md,a+0x24)/65536,z=raml(md,a+0x28)/65536,
      vx=s32(raml(md,a+0x30))/65536,vy=s32(raml(md,a+0x34))/65536,vz=s32(raml(md,a+0x38))/65536,hp=w(0x40),side=w(0x52))
