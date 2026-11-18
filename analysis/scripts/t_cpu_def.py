# CPU 방어 결정 관찰(analysis/18): 1P 지상 투구 -> CPU 팀(obj 7~10 내야) 반응 추적.
# 워밍업 후(AI 가 정상 플레이 중인 상태) 1P 조작 선수에게 공을 주고 위치를 바꿔 B 홀드/뗌으로 투구.
# 사용: python -I analysis/scripts/t_cpu_def.py [시도수=20] [차지프레임=8] [verbose=0]
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
HOOKS={0x90D6:'passive-catch(90a6)',0x8EA0:'passive-crouch(8e82)',0x77D4:'plan-catch',0x77F8:'plan-crouch',0x770C:'plan-jump',0xC668:'plan-sidestep',0xD612:'decide-league',0xD60A:'decide'}
def trial(seed,charge,verbose=False):
    md=load('ctrl0')
    for _ in range(100+seed%40): md.pad=[0,0]; md.run_frame()
    th=[0xC000+i*0x80 for i in range(4) if ramw(md,0xC000+i*0x80)&0x7FFC==0x10]
    th=th[0] if th else 0xC000
    side=0xE700; ctrl=ramw(md,0xE718)
    px_=(130+(seed*13)%61)<<16; py_=(70+(seed*29)%117)<<16
    for a in (th,0xC700):
        md.ram[a+0x20:a+0x24]=px_.to_bytes(4,'big'); md.ram[a+0x24:a+0x28]=py_.to_bytes(4,'big')
    for a in range(0xC000,0xC400,0x80):
        if a!=th and ramw(md,a+0x1C)==0 and peekb(md,a+3)&0x10: pokeb(md,a+3,peekb(md,a+3)&0xEF)
    for a in range(0xC380,0xC580,0x80):   # CPU 내야: 공 소지/공격 plan 해제(plan 0 부터 다시 결정)
        pokeb(md,a+3,peekb(md,a+3)&0xEF); pokew(md,a+0x5E,0)
        if ramw(md,a)&0x7FFC==0x70: pokew(md,a+0x16,0)
    pokew(md,0xC700,4); pokeb(md,0xC703,(peekb(md,0xC703)|0x10)&0x3F); pokew(md,0xC71C,th)
    pokeb(md,th+3,peekb(md,th+3)|0x10); pokeb(md,0xE756,1); pokeb(md,0xE716,1); pokew(md,0xC752,0xE700)
    md.ram[0xE620:0xE624]=((seed*2654435761+12345) & 0xFFFFFFFF).to_bytes(4,'big')
    ev=[]
    def hook(m,pc):
        if pc in HOOKS: ev.append((m.frame,HOOKS[pc]+('' if pc!=0xD60A else ' choice=%d'%((m.d[0]&0xFFFF)//2)),m.a[0]&0xFFFF))
    md.hook=hook
    import os
    if os.environ.get('WATCH'):   # 대상 선수의 plan($5E)/sub($16) 쓰기 PC 기록
        wa=int(os.environ['WATCH'],16)
        def cb(m,a,v,sz): ev.append((m.frame,'W%X=%X pc=%X'%(a&0xFF,v,m.pc),wa))
        md.wwatch[wa+0x5E]=cb; md.wwatch[wa+0x16]=cb
    hp0=[ramw(md,0xC000+i*0x80+0x40) for i in range(14)]
    f=0; res='miss'; thrown=None; tgt=None; last=None
    for fr,m in [(3,0),(charge,16),(70,0)]:
        for _ in range(fr):
            md.pad=[m,0]; md.run_frame(); f+=1
            b=odump(md,0xC700); t=b['type']&0x7FFC
            if t==0x14 and thrown is None: thrown=f; tgt=ramw(md,0xE21E)
            if thrown and t==4 and ramw(md,0xC71C)!=th and res=='miss' and ramw(md,0xC71C)>=0xC380: res='CATCH'
            hp=[ramw(md,0xC000+i*0x80+0x40) for i in range(14)]
            if thrown and res=='miss' and any(hp[i]!=hp0[i] for i in range(7,14)): res='HIT'
    if verbose: print(seed,res,'thrown f',thrown,'tgt',hex(tgt or 0),[(e[0]-md.frame+f-thrown,e[1],hex(e[2])) for e in ev])
    return res,ev,thrown,tgt,md
if __name__=="__main__":
    n=int(sys.argv[1]) if len(sys.argv)>1 else 20; ch=int(sys.argv[2]) if len(sys.argv)>2 else 8
    v=len(sys.argv)>3 and sys.argv[3]=='1'
    from collections import Counter
    C=Counter()
    for s in range(1,n+1):
        r=trial(s,ch,v); C[r[0]]+=1
    print(dict(C))
