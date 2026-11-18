"""COM 전용 리그를 즉시 판정(しあいけっか)으로 끝까지 돌린다. usage: lgplay.py <state.pkl|name> <prefix> "c,r c,r ..." """
import numpy
import sys,os,pickle
sys.path.insert(0,'analysis/scripts')
from drv import *
from t_md_step import render_w
src=sys.argv[1]; pref=sys.argv[2]; cards=[tuple(int(v) for v in c.split(',')) for c in sys.argv[3].split()]
md=pickle.load(open(src if src.endswith('.pkl') else 'analysis/state/md/%s.pkl'%src,'rb'))
F0=md.frame
def T(k,w=12): hold(md,k,3); hold(md,0,w)
def sub(): return ramw(md,0xE400)
def dump(tag):
    n=peekb(md,0xE502)+2
    mat=[[ (md.ram[0xE50C+r*12+c*2],md.ram[0xE50C+r*12+c*2+1]) for c in range(n)] for r in range(n)]
    st=[tuple(ramw(md,0xE554+i*10+k) for k in (0,2,4,8)) for i in range(n)]
    rk=[(md.ram[0xE590+2*i],md.ram[0xE591+2*i]) for i in range(6)]
    print('[%s] f%d sub=%d e404=%d matrix(w,l)=%s standings(w,l,rate,left)=%s ranks(rank,team)=%s save=%s'%(tag,md.frame-F0,sub(),ramw(md,0xE404),mat,st,rk,bytes(md.ram[0xE5A8:0xE5C8]).hex()),flush=True)
def shot(tag): render_w(md).save('%s_%s.png'%(pref,tag))
def goto(c,r):
    for _ in range(12):
        x,y=ramw(md,0xC020),ramw(md,0xC024)
        if (x,y)==(c,r): return True
        if x<c: T(R,8)
        elif x>c: T(L,8)
        elif y<r: T(D,8)
        else: T(U,8)
    return False
dump('start')
for i,(c,r) in enumerate(cards):
    # 카드 선택 화면(서브 8)까지
    for _ in range(40):
        if sub()==8 and ramw(md,0xE402)>=2: break
        if sub()==5 and ramw(md,0xE402)>=2: T(A,30)
        else: hold(md,0,10)
    ok=goto(c,r); seed=raml(md,0xE620)
    if i in (0,len(cards)-1) : shot('grid%d'%i)
    T(A,50)
    print('card %d (col %d,row %d) goto=%s -> sub=%d e404=%d e430=%d e432=%d e446=%d'%(i,c,r,ok,sub(),ramw(md,0xE404),ramw(md,0xE430),ramw(md,0xE432),ramw(md,0xE446)),flush=True)
    if sub()!=14:
        print('  not accepted (still sub %d)'%sub()); continue
    hold(md,0,30); T(A,10)
    # 결과 연출: 서브가 5/13 으로 돌아올 때까지 START 를 가끔 누름
    for k in range(3000):
        md.pad=[S if (k%40)<3 and ramw(md,0xE600)==0x14 and (ramw(md,0xE602)&0x7c)==0x40 else 0,0]; md.run_frame()
        if ramw(md,0xE600)==0xB4 and sub() in (5,13) and ramw(md,0xE402)>=1: break
    print('  result: winner side=%x teams A=%d B=%d rateA=%04x rateB=%04x'%(ramw(md,0xE68A),ramw(md,0xE704),ramw(md,0xE784),ramw(md,0xE760),ramw(md,0xE7E0)))
    hold(md,0,20); dump('after %d'%i)
    if sub()==13: break
shot('final'); hold(md,0,300); shot('final2'); hold(md,0,600); shot('final3')
print('end sub',sub(),'E600=%x'%ramw(md,0xE600))
pickle.dump(md,open(pref+'.pkl','wb'))
