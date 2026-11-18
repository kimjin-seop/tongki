"""리그/특훈 단계별 조작 도구. 사용: python -I analysis/scripts/t_lg_step.py <in_state|menu3|menu4> <out_state> <out_png_prefix> "<토큰...>"
토큰: U D L R A B C S(누름 3f + 대기 12f), wN(N프레임 무입력), shot(현재 화면 저장), X:n(토큰 X 를 n회), p2X(2P 패드), poke:addr:val(바이트)
상태는 analysis/state/lg/<이름>.pkl. 끝에서 항상 화면 저장 + RAM 요약 출력."""
import numpy, inspect
import sys,os,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
K=dict(U=U,D=D,L=L,R=R,A=A,B=B,C=C,S=S)
os.makedirs('analysis/state/lg',exist_ok=True)
def start(mode):
    md=load('modemenu'); cur=2
    while cur>mode: tap(md,U,20,hl=4); cur-=1
    while cur<mode: tap(md,D,20,hl=4); cur+=1
    return md
src,dst,pref,toks=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4].split()
md=start(int(src[4])) if src.startswith('menu') else pickle.load(open('analysis/state/lg/%s.pkl'%src,'rb'))
snd=[]; _w=md.write; F0=md.frame
def w(addr,size,val):
    a=addr&0xFFFFFF
    if a>=0xFF0000 and (a&0xFFFF) in range(0xE610,0xE618) and size==0: snd.append((md.frame-F0,hex(val)))
    return _w(addr,size,val)
md.write=w
n=0; last=None
def info():
    return 'f%d E600=%x E602=%x E400=%d E402=%d E404=%d cur=(%d,%d) e500=%s'%(md.frame-F0,ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402),s16(ramw(md,0xE404)),ramw(md,0xC020),ramw(md,0xC024),bytes(md.ram[0xE500:0xE50C]).hex())
def shot(tag=''):
    global n
    fn='%s_%02d%s.png'%(pref,n,tag); n+=1
    im=render(md); im.resize((im.width*2,im.height*2)).save(fn); print('  shot',fn,info())
def run(k,m0=0,m1=0):
    global last
    for _ in range(k):
        md.pad=[m0,m1]; md.run_frame()
        s=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))
        if s!=last: print('  f%d state %s'%(md.frame-F0,'/'.join('%x'%v for v in s))); last=s
for t in toks:
    rep=1
    if ':' in t and not t.startswith('poke'): t,rep=t.split(':'); rep=int(rep)
    for _ in range(rep):
        if t=='shot': shot()
        elif t[0]=='w': run(int(t[1:]))
        elif t.startswith('poke'):
            _,a,v=t.split(':'); pokeb(md,int(a,16),int(v,16))
        elif t.startswith('p2'): run(3,0,K[t[2]]); run(12)
        else: run(3,K[t]); run(12)
md.write=_w
shot('_end'); print('snd',snd)
pickle.dump(md,open('analysis/state/lg/%s.pkl'%dst,'wb'))
