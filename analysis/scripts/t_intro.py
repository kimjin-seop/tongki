"""부팅→인트로/타이틀/데모 시퀀스 추적. 사용: python -I analysis/scripts/t_intro.py <out_dir> <frames> [every] [inputs]
inputs: "프레임:버튼마스크:길이,..."  (S=128). 로그: state 변화, 사운드 큐(16B6) 및 Z80 직접명령."""
import numpy
import sys,json,pickle,os; sys.path.insert(0,"analysis/scripts")
from drv import *
import hud_render as H
out=sys.argv[1]; N=int(sys.argv[2]); every=int(sys.argv[3]) if len(sys.argv)>3 else 6
inp={}
if len(sys.argv)>4 and sys.argv[4]:
    for t in sys.argv[4].split(','):
        f,m,l=[int(x,0) for x in t.split(':')]
        for k in range(l): inp[f+k]=m
os.makedirs(out,exist_ok=True)
md=new()
snd=[]
_w=md.write
def w(addr,size,val):
    a=addr&0xFFFFFF
    if 0xA01B00<=a<0xA01C20 and a not in (0xA01C00,):
        snd.append((md.frame,'z80',hex(a),hex(val)))
    if a&0xFFFF in range(0xE610,0xE618) and a>=0xFF0000 and size==0:
        snd.append((md.frame,'q',hex(a&0xFFFF),hex(val)))
    return _w(addr,size,val)
md.write=w
log=[];prev=None
for f in range(N):
    key=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402),ramw(md,0xE608))
    if key!=prev:
        print(f,'E600=%02x E602=%02x E400=%04x E402=%04x vbl=%02x'%key,'pc',hex(md.pc)); sys.stdout.flush()
        log.append(dict(f=f,k=[hex(x) for x in key]))
        H.render(md).save(out+'/chg_%05d.png'%f)
        pickle.dump(md.__dict__.get('ram') and None,open(os.devnull,'wb'))
    prev=key
    if f%every==0: H.render(md).save(out+'/f%05d.png'%f)
    md.pad=[inp.get(f,0),0]; md.run_frame()
json.dump(dict(log=log,snd=snd),open(out+'/log.json','w'),indent=0)
for s in snd: print('SND',s)
