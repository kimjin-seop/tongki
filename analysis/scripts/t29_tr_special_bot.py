"""필살 슛 특훈 봇(실제 패드 입력만). usage: python -I sp_bot.py <state> <maxframes> <specLimit> <stop> [out] [relAt]
 specLimit: 필살을 이 수만큼만 성공시키고 나머지는 지상 일반 투구. stop: retry | exit | none"""
import sys,os,pickle,time
sys.path.insert(0,'analysis/scripts'); sys.path.insert(0,os.path.dirname(__file__))
from drv import *
from t29_tr_log import ball,pl,stats
st_,nf,lim,stop=sys.argv[1],int(sys.argv[2]),int(sys.argv[3]),sys.argv[4]
out=sys.argv[5] if len(sys.argv)>5 else '-'
relAt=int(sys.argv[6]) if len(sys.argv)>6 else 13
md=pickle.load(open(st_ if st_.endswith('.pkl') else 'analysis/state/md/%s.pkl'%st_,'rb'))
F0=md.frame; last=None; lstat=None; held=0; cool=0; t0=time.time(); d9=None; mode=None; hb=0
for f in range(nf):
    b=ball(md); p0=pl(md,0); pad=0; bt=b['t']&0x7ffc; pt=p0['t']&0x7ffc
    spec=peekb(md,0xE768)
    if cool>0: cool-=1
    have = bt==4 and b['own']==0xC000
    if mode=='jump':
        hb+=1
        if hb<=2: pad=C
        elif p0['z']>0 or hb<8:
            # 공중: B 를 누르고 있다가 차지 카운터가 relAt 이 되면 뗀다
            if p0['sub']==0x24 and p0['tm']>=relAt: mode=None; cool=30; print('  f%d release charge=%d z=%.1f'%(md.frame-F0,p0['tm'],p0['z']))
            else: pad=B
        else: mode=None; cool=10
    elif held>0: pad=B; held-=1
    elif have and pt==0x10 and p0['sub']==0 and p0['z']==0 and cool==0:
        if spec<lim: mode='jump'; hb=0
        else: held=2; cool=20
    elif b['fl']&0x40 and b['vx']<0:
        dx=b['x']-p0['x']
        if 0<dx<=8*(-b['vx']) and cool==0: held=2; cool=12
    elif (bt!=4 and not b['fl']&0x40 and b['vx']==0 and b['x']<250):
        if pt==0x10:
            dx=b['x']-p0['x']; dy=b['y']-p0['y']
            if abs(dx)>6: pad|= R if dx>0 else L
            if abs(dy)>6: pad|= D if dy>0 else U
            if abs(dx)<=6 and abs(dy)<=6 and b['z']<4 and cool==0: pad=A; cool=20
    md.pad=[pad,0]; md.run_frame(); fr=md.frame-F0
    s=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE69C),peekb(md,0xE267))
    if s!=last: print('f%d st E600=%x E602=%x stage=%d retry=%d cnt A=%s B=%s'%(fr,*s,*stats(md)),flush=True); last=s
    dd=(ramw(md,0xD900),ramw(md,0xD914))
    if dd!=d9 and dd[0]&0x7ffc==0xb0: print('  f%d dialog msg=%d'%(fr,dd[1]),flush=True)
    d9=dd
    ss=stats(md)
    if ss!=lstat:
        b=ball(md); p0=pl(md,0); p7=pl(md,7)
        print('f%d A=%s B=%s | ball t=%x fl=%02x tag=%d x=%.1f y=%.1f z=%.1f v=(%.4f,%.4f,%.4f) | p0 x=%.1f y=%.1f z=%.1f hp=%d | p7 x=%.1f y=%.1f hp=%d plan=%x t=%x'%(fr,ss[0],ss[1],b['t'],b['fl'],b['tag'],b['x'],b['y'],b['z'],b['vx'],b['vy'],b['vz'],p0['x'],p0['y'],p0['z'],p0['hp'],p7['x'],p7['y'],p7['hp'],p7['plan'],p7['t']),flush=True); lstat=ss
    if stop=='retry' and s[3]!=0 and s[1]&0x7c==0: break
    if stop=='exit' and s[0] not in (0x48,0x4c): break
print('end f%d elapsed %.1fs'%(md.frame-F0,time.time()-t0))
if out!='-': pickle.dump(md,open(out,'wb'))
