"""모드 흐름 조사용 범용 단계 조작 도구(28_modes_and_flow.md). t_lg_step.py 의 일반화판 + VDP 윈도 플레인 합성 렌더.
사용: python -I analysis/scripts/t_md_step.py <in> <out_state|-> <out_png_prefix> "<토큰...>"
  <in>  : menuN(모드 메뉴에서 커서 N 에 맞춘 상태, START 는 누르지 않음) | boot(리셋 직후) | 상태 이름(analysis/state/md/<이름>.pkl) | 경로(.pkl)
  토큰  : U D L R A B C S(누름 3f + 대기 12f), hX:n(X 를 n프레임 누름), wN(N프레임 무입력), shot(화면 저장), X*n(토큰 n회),
          p2X(2P 패드 3f), pb:addr:val(바이트 poke), pw:addr:val(워드 poke), ram:addr:len(RAM 16진 덤프),
          until:addr:val:max(워드 RAM[addr]==val 될 때까지 무입력, 최대 max 프레임), auto:N:per(N프레임 동안 per 주기로 S)
상태 변화($E600/$E602/$E400/$E402)와 사운드 큐($E610~)를 출력. 끝에서 화면 저장 + 요약."""
import numpy, inspect
import sys,os,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
K=dict(U=U,D=D,L=L,R=R,A=A,B=B,C=C,S=S)
SD='analysis/state/md'; os.makedirs(SD,exist_ok=True)
class _V: pass
class _M: pass
def render_w(md):
    """윈도 플레인을 플레인 A 위에 합성해 렌더(vdprender 는 윈도 미지원)."""
    v=md.vdp; r=list(v.reg); pw=[32,64,128,128][r[16]&3]
    an=(r[2]&0x38)<<10; wn=(r[3]&0x3E)<<10; h=r[17]; vv=r[18]; hn=(h&0x1F)*2; vn=vv&0x1F
    if not (hn or h&0x80 or vn or vv&0x80): return render(md)
    vram=bytearray(v.vram)
    for cy in range(28):
        for cx in range(40):
            inH=((cx>=hn) if h&0x80 else (cx<hn)) and (hn>0 or h&0x80)
            inV=((cy>=vn) if vv&0x80 else (cy<vn)) and (vn>0 or vv&0x80)
            if inH or inV:
                s=wn+(cy*64+cx)*2; d=an+(cy*pw+cx)*2; vram[d]=v.vram[s]; vram[d+1]=v.vram[s+1]
    x=_V(); x.reg=r; x.cram=v.cram; x.vsram=v.vsram; x.vram=bytes(vram); m=_M(); m.vdp=x; return render(m)
def start(mode):
    md=load('modemenu'); cur=2
    while cur>mode: tap(md,U,20,hl=4); cur-=1
    while cur<mode: tap(md,D,20,hl=4); cur+=1
    return md
if __name__=='__main__':
    src,dst,pref,toks=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4].split()
    if src.startswith('menu'): md=start(int(src[4]))
    elif src=='boot': md=new()
    elif src.endswith('.pkl'): md=pickle.load(open(src,'rb'))
    else: md=pickle.load(open('%s/%s.pkl'%(SD,src),'rb'))
    os.makedirs(os.path.dirname(pref) or '.',exist_ok=True)
    snd=[]; _w=md.write; F0=md.frame
    def w(addr,size,val):
        a=addr&0xFFFFFF
        if a>=0xFF0000 and (a&0xFFFF) in range(0xE610,0xE618) and size==0: snd.append((md.frame-F0,'%02x'%val))
        return _w(addr,size,val)
    md.write=w
    n=0; last=None
    def info():
        return 'f%d E600=%x E602=%x E400=%x E402=%x E404=%x cur=(%d,%d) mode=%x'%(md.frame-F0,ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402),ramw(md,0xE404),ramw(md,0xC020),ramw(md,0xC024),ramw(md,0xE68E))
    def shot(tag=''):
        global n
        fn='%s_%02d%s.png'%(pref,n,tag); n+=1
        im=render_w(md); im.resize((im.width*2,im.height*2)).save(fn); print('  shot',fn,info(),flush=True)
    def run(k,m0=0,m1=0):
        global last
        for _ in range(k):
            md.pad=[m0,m1]; md.run_frame()
            s=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))
            if s!=last: print('  f%d state %s'%(md.frame-F0,'/'.join('%x'%v for v in s)),flush=True); last=s
    for t in toks:
        rep=1
        if '*' in t: t,rep=t.split('*'); rep=int(rep)
        for _ in range(rep):
            if t=='shot': shot()
            elif t.startswith('pb:'): _,a,v=t.split(':'); pokeb(md,int(a,16),int(v,16))
            elif t.startswith('pw:'): _,a,v=t.split(':'); pokew(md,int(a,16),int(v,16))
            elif t.startswith('ram:'):
                _,a,l=t.split(':'); a=int(a,16)&0xFFFF; print('  ram %04x:'%a,bytes(md.ram[a:a+int(l,0)]).hex())
            elif t.startswith('until:'):
                _,a,v,mx=t.split(':'); a=int(a,16); v=int(v,16)
                for i in range(int(mx)):
                    if ramw(md,a)==v: break
                    run(1)
                print('  until %x==%x after %d f'%(a,v,i))
            elif t.startswith('auto:'):
                _,N,per=t.split(':'); per=int(per)
                for i in range(int(N)): run(1,S if i%per<3 else 0)
            elif t[0]=='h': k,nf=t[1:].split(':'); run(int(nf),K[k])
            elif t[0]=='w': run(int(t[1:]))
            elif t.startswith('p2'): run(3,0,K[t[2]]); run(12)
            else: run(3,K[t]); run(12)
    md.write=_w
    shot('_end'); print('snd',snd)
    if dst!='-': pickle.dump(md,open('%s/%s.pkl'%(SD,dst),'wb'))
