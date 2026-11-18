# 감사용 오라클 측정(원작 에뮬): 이동·대시·점프·캐치 윈도 수치. python -I analysis/scripts/audit_oracle.py
import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
def fresh():
    md=load('ctrl0'); return md
def me(md):
    for k in range(14):
        if ramw(md,0xC000+k*0x80)&0x7FFC in (0x10,0x34,0x38): return 0xC000+k*0x80
a0=None
def rec(md,a,pads,keys=('x','y','z','vx','vy','vz','sub','type','tmr')):
    out=[]
    for m in pads:
        md.pad=[m,0]; md.run_frame(); d=odump(md,a); out.append(d)
    return out
md=fresh(); a=me(md); d=odump(md,a); print('ctrl obj',hex(a),{k:round(v,2) if isinstance(v,float) else v for k,v in d.items()})
print('stats', [ramw(md,a+0x40+2*i) for i in range(8)])
print('ball',odump(md,0xC700)['type'],'own',hex(odump(md,0xC700)['own']))
# 걷기: 오른쪽 40f
md=fresh();a=me(md);o=rec(md,a,[R]*40)
print('WALK R x:',[round(x['x'],2) for x in o[:40:3]],'vx',[round(x['vx'],2) for x in o[:12]])
# 위쪽(y)
md=fresh();a=me(md);o=rec(md,a,[U]*30)
print('WALK U y:',[round(x['y'],2) for x in o[:30:3]],'vy',[round(x['vy'],2) for x in o[:10]])
# 대시: R 탭(2f) 해제 4f 다시 R 60f
md=fresh();a=me(md);o=rec(md,a,[R]*2+[0]*4+[R]*50)
print('DASH vx:',[round(x['vx'],2) for x in o[6:50:3]],'sub',[x['sub'] for x in o[6:50:6]],'type',[hex(x['type']) for x in o[6:50:12]])
# 점프(C) 
md=fresh();a=me(md);o=rec(md,a,[C]*1+[0]*80)
z=[x['z'] for x in o]; mx=max(z); print('JUMP z max',round(mx,2),'airframes',sum(1 for v in z if v>0.01),'vz0',[round(x['vz'],2) for x in o[:4]], 'zs',[round(v,1) for v in z[:60:4]])
# 대시 점프
md=fresh();a=me(md);o=rec(md,a,[R]*2+[0]*4+[R]*30+[R|C]+[R]*60)
z=[x['z'] for x in o]; print('DASHJUMP z max',round(max(z),2),'airframes',sum(1 for v in z if v>0.01))
# 정지 점프+이동 vx
md=fresh();a=me(md);o=rec(md,a,[R|C]+[R]*60)
print('JUMP+R vx',[round(x['vx'],2) for x in o[:60:6]],'zmax',round(max(x['z'] for x in o),2))
# 캐치 자세 B (공 없음 상태 가정)
md=fresh();a=me(md);o=rec(md,a,[B]+[0]*40)
print('B sub/tmr/type',[(x['sub'],x['tmr'],hex(x['type'])) for x in o[:24]])
# 웅크림 A
md=fresh();a=me(md);o=rec(md,a,[A]+[0]*50)
print('A sub/tmr',[(x['sub'],x['tmr']) for x in o[:40:3]])
