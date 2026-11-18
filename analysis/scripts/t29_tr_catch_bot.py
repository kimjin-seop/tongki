"""특훈 캐치 봇(실제 패드 입력만). usage: python -I tr_bot.py <state> <maxframes> <lead> <catchLimit> <stopcond> [out_state]
 catchLimit: 단계당 이 수만큼만 잡고 나머지는 맞는다(-1 = 전부 잡기)
 stopcond: 'stage:N'(E69C==N 되고 E602==0 되면 정지) | 'retry'(E267!=0 & E602==0) | 'exit'(E600!=0x48/0x4c) | 'none'
"""
import sys,os,pickle,time
sys.path.insert(0,'analysis/scripts'); sys.path.insert(0,os.path.dirname(__file__))
from drv import *
from t29_tr_log import ball,pl,stats
st_,nf,lead,lim,stop=sys.argv[1],int(sys.argv[2]),float(sys.argv[3]),int(sys.argv[4]),sys.argv[5]
out=sys.argv[6] if len(sys.argv)>6 else '-'
md=pickle.load(open(st_ if st_.endswith('.pkl') else 'analysis/state/md/%s.pkl'%st_,'rb'))
F0=md.frame; last=None; lstat=None; lbt=None; held=0; cool=0; lplan=None; t0=time.time(); lthrow=None; d9=None
for f in range(nf):
    b=ball(md); p0=pl(md,0); pad=0
    bt=b['t']&0x7ffc
    caught=peekb(md,0xE763)
    if cool>0: cool-=1
    if held>0: pad=B; held-=1
    elif bt==4 and b['own']==0xC000 and (p0['t']&0x7ffc)==0x10 and cool==0:
        held=2; cool=20                      # 공을 들고 있으면 B = 상대에게 던짐
    elif b['fl']&0x40 and b['vx']<0 and (lim<0 or caught<lim):
        dx=b['x']-p0['x']
        if 0<dx<=lead*(-b['vx']) and cool==0: held=2; cool=12
    elif bt in (0x1c,0x20,0x24,0x28) or (bt!=4 and not b['fl']&0x40 and b['vx']==0):
        # 죽은 공: 걸어가서 A 로 줍기
        if (p0['t']&0x7ffc)==0x10 and b['x']<250:
            dx=b['x']-p0['x']; dy=b['y']-p0['y']
            if abs(dx)>6: pad|= R if dx>0 else L
            if abs(dy)>6: pad|= D if dy>0 else U
            if abs(dx)<=6 and abs(dy)<=6 and b['z']<4 and cool==0: pad=A; cool=20
    md.pad=[pad,0]; md.run_frame(); fr=md.frame-F0
    s=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE69C),peekb(md,0xE267))
    if s!=last: print('f%d st E600=%x E602=%x stage=%d retry=%d cnt A=%s B=%s'%(fr,*s,*stats(md)),flush=True); last=s
    dd=(ramw(md,0xD900),ramw(md,0xD914))
    if dd!=d9 and dd[0]&0x7ffc==0xb0: print('  f%d dialog obj d900 type=%x msg=%d'%(fr,*dd),flush=True)
    d9=dd
    p7=pl(md,7)
    if p7['plan']!=lplan: print('  f%d p7 plan=%x x=%.1f y=%.1f'%(fr,p7['plan'],p7['x'],p7['y'])); lplan=p7['plan']
    ss=stats(md)
    if ss!=lstat:
        b=ball(md); p0=pl(md,0)
        ev='?'
        if lstat:
            if ss[1][2:4]!=lstat[1][2:4]: ev='B-throw dt=%s'%(fr-lthrow if lthrow else '-'); lthrow=fr
            elif ss[0][0:2]!=lstat[0][0:2]: ev='A-catch'
            elif ss[0][12:14]!=lstat[0][12:14]: ev='A-hit hp=%d'%p0['hp']
            elif ss[0][2:4]!=lstat[0][2:4]: ev='A-throw'
            elif ss[1][0:2]!=lstat[1][0:2]: ev='B-catch'
        print('f%d %s A=%s B=%s | ball t=%x fl=%02x x=%.2f y=%.2f z=%.2f v=(%.4f,%.4f,%.4f) p48=%d p4c=%d | p0 x=%.1f y=%.1f t=%x sub=%x tm=%d | p7 x=%.1f y=%.1f z=%.1f'%(fr,ev,ss[0],ss[1],b['t'],b['fl'],b['x'],b['y'],b['z'],b['vx'],b['vy'],b['vz'],b['p48'],b['p4c'],p0['x'],p0['y'],p0['t'],p0['sub'],p0['tm'],p7['x'],p7['y'],p7['z']),flush=True); lstat=ss
    if stop.startswith('stage:') and s[2]==int(stop[6:]) and s[1]&0x7c==0: break
    if stop=='retry' and s[3]!=0 and s[1]&0x7c==0: break
    if stop=='exit' and s[0] not in (0x48,0x4c): break
print('end f%d elapsed %.1fs'%(md.frame-F0,time.time()-t0))
if out!='-': pickle.dump(md,open(out,'wb'))
