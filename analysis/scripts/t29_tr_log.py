"""특훈 오라클 로거. usage: python -I tr_log.py <state> <frames> <policy> [out_state] [pokes]
policy: none | catch:<lead> (공이 dx<lead*vx 안에 오면 B) | script
"""
import sys,os,pickle,time
sys.path.insert(0,'analysis/scripts')
from drv import *
def sw(md,a): return s16(ramw(md,a))
def ball(md):
    a=0xC700
    return dict(t=ramw(md,a),fl=peekb(md,a+3),tag=ramw(md,a+0x14),own=ramw(md,a+0x1C),x=raml(md,a+0x20)/65536,y=raml(md,a+0x24)/65536,z=raml(md,a+0x28)/65536,
      vx=s32(raml(md,a+0x30))/65536,vy=s32(raml(md,a+0x34))/65536,vz=s32(raml(md,a+0x38))/65536,p48=ramw(md,a+0x48),p4c=ramw(md,a+0x4c),p3e=ramw(md,a+0x3e),p76=peekb(md,a+0x76))
def pl(md,i):
    a=0xC000+i*0x80
    return dict(t=ramw(md,a),fl=peekb(md,a+3),sub=ramw(md,a+0x16)&0x7c,tm=ramw(md,a+0x18),x=raml(md,a+0x20)/65536,y=raml(md,a+0x24)/65536,z=raml(md,a+0x28)/65536,plan=ramw(md,a+0x5e)&0x7f,hp=ramw(md,a+0x40))
def stats(md): return bytes(md.ram[0xE763:0xE76A]).hex(), bytes(md.ram[0xE7E3:0xE7EA]).hex()
if __name__=='__main__':
    st_,nf,pol=sys.argv[1],int(sys.argv[2]),sys.argv[3]
    md=pickle.load(open(st_ if st_.endswith('.pkl') else 'analysis/state/md/%s.pkl'%st_,'rb'))
    out=sys.argv[4] if len(sys.argv)>4 else '-'
    last=None; lstat=None; lbt=None; F0=md.frame; t0=time.time(); held=0
    lead=float(pol.split(':')[1]) if pol.startswith('catch') else 0
    for f in range(nf):
        b=ball(md); p0=pl(md,0)
        pad=0
        if pol.startswith('catch'):
            # 공이 살아 있고(bit6) 1P 쪽으로 오면, 도달 예상 프레임이 lead 이하일 때 B 를 2프레임 누름
            if b['fl']&0x40 and b['vx']<0 and held==0:
                dx=b['x']-p0['x']
                if 0<dx<=lead*(-b['vx']): held=3
            if held>0: pad=B; held-=1
        md.pad=[pad,0]; md.run_frame()
        s=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE69C),peekb(md,0xE267))
        if s!=last: print('f%d st E600=%x E602=%x stage=%d retry=%d'%(md.frame-F0,*s)); last=s
        ss=stats(md)
        if ss!=lstat:
            b=ball(md); print('f%d stats A=%s B=%s | ball t=%x fl=%02x tag=%x x=%.1f y=%.1f z=%.1f v=(%.3f,%.3f,%.3f) p48=%d p4c=%d p3e=%d | p0 %s | p7 %s'%(md.frame-F0,ss[0],ss[1],b['t'],b['fl'],b['tag'],b['x'],b['y'],b['z'],b['vx'],b['vy'],b['vz'],b['p48'],b['p4c'],b['p3e'],pl(md,0),pl(md,7))); lstat=ss
        bt=(ball(md)['t'],ball(md)['fl']&0xC0)
        if bt!=lbt:
            b=ball(md); print('  f%d ball t=%x fl=%02x own=%x x=%.1f y=%.1f z=%.1f v=(%.3f,%.3f,%.3f) p48=%d p4c=%d p0t=%x/%x p7t=%x/%x plan7=%x'%(md.frame-F0,b['t'],b['fl'],b['own'],b['x'],b['y'],b['z'],b['vx'],b['vy'],b['vz'],b['p48'],b['p4c'],pl(md,0)['t'],pl(md,0)['sub'],pl(md,7)['t'],pl(md,7)['sub'],pl(md,7)['plan'])); lbt=bt
    print('elapsed %.1fs'%(time.time()-t0))
    if out!='-': pickle.dump(md,open(out,'wb'))
