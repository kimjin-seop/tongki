"""모드 선택 이후~경기 시작 전 화면 전수 캡처. 사용: python -I analysis/scripts/t_prematch.py <mode 0~4> <out_dir> <N> [inputs "f:mask:len[:pad],..."] [auto_period] (환경변수 AUTO2=1 이면 2P 패드도 자동)
mode = 모드 메뉴 커서(0 倒せ, 1 1PvsCOM, 2 1Pvs2P, 3 リーグ, 4 特訓). f0 = START 누른 프레임. auto_period>0 이면 그 주기로 S 를 3f 눌러 진행(입력 지정 없는 프레임만).
서브상태(E600/E602/E400/E402) 변화 프레임과 상태 변화 +24f 에 PNG 저장, 사운드 큐(E610~E617) 기록 -> <out_dir>/log.json"""
import numpy, inspect
import sys,json,os; sys.path.insert(0,"analysis/scripts")
from drv import *
mode=int(sys.argv[1]); out=sys.argv[2]; N=int(sys.argv[3])
inp=[{},{}]
if len(sys.argv)>4 and sys.argv[4]:
    for t in sys.argv[4].split(','):
        p=[int(x,0) for x in t.split(':')]; f,m,l=p[:3]; pd=p[3] if len(p)>3 else 0
        for k in range(l): inp[pd][f+k]=m
per=int(sys.argv[5]) if len(sys.argv)>5 else 0
os.makedirs(out,exist_ok=True)
md=load('modemenu')
cur=2
while cur>mode: tap(md,U,20,hl=4); cur-=1
while cur<mode: tap(md,D,20,hl=4); cur+=1
snd=[]; _w=md.write; F0=md.frame
def w(addr,size,val):
    a=addr&0xFFFFFF
    if a>=0xFF0000 and (a&0xFFFF) in range(0xE610,0xE618) and size==0: snd.append((md.frame-F0,hex(val)))
    return _w(addr,size,val)
md.write=w
for _ in range(4): md.pad=[S,0]; md.run_frame()
log=[]; last=None; pend=[]
for f in range(N):
    s=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))
    if s!=last:
        log.append((f,'/'.join('%x'%v for v in s))); last=s; pend=[f,f+24]
        render(md).save('%s/f%04d_%s.png'%(out,f,'_'.join('%x'%v for v in s)))
    elif f%30==0 or f in pend[1:]:
        render(md).save('%s/f%04d_%s_b.png'%(out,f,'_'.join('%x'%v for v in s)))
    m0=inp[0].get(f,0); m1=inp[1].get(f,0)
    if per and f%per<3 and f not in inp[0]: m0=S
    if per and os.environ.get('AUTO2') and (f+15)%per<3 and f not in inp[1]: m1=S
    md.pad=[m0,m1]; md.run_frame()
    if s[0]==0x2C or s[0]==0x14: pass
md.write=_w
json.dump(dict(mode=mode,log=log,snd=snd),open(out+'/log.json','w'),ensure_ascii=False)
print(log); print(snd)
import pickle; pickle.dump(md,open(out+'/end.pkl','wb'))
