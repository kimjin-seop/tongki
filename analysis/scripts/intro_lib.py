"""t_intro_rec.py 기록(pkl)에서 프레임별 레이어 분리 렌더. 분석/추출 전용."""
import numpy as np, pickle
from PIL import Image
import hud_render as H
class _V: pass
class FMD:
    def __init__(s,rec,i):
        fr=rec['fr'][i]; v=_V(); v.reg=fr['reg']; v.cram=fr['cram']; v.vsram=fr['vsram']; v.vram=rec['vr'][fr['vi']]; s.vdp=v; s.fr=fr
def load(p): return pickle.load(open(p,'rb'))
def pal(fr): return np.array([H.cram_rgb(w) for w in fr['cram']],np.uint8)
def geom(r):
    pw=[32,64,128,128][r[16]&3]; ph=[32,64,128,128][(r[16]>>4)&3]
    return pw,ph,(r[2]&0x38)<<10,(r[4]&7)<<13,(r[5]&0x7F)<<9,(r[13]&0x3F)<<10
def plane_rgba(rec,i,which,palframe=None):
    """which 'A'|'B' : 전체 플레인(스크롤 미적용) RGBA, prio 배열. palframe: 다른 프레임 CRAM 사용."""
    fr=rec['fr'][i]; r=fr['reg']; vram=rec['vr'][fr['vi']]
    pw,ph,an,bn,sat,hs=geom(r); T=H.tiles_np(vram)
    idx,pp,pr=H.plane_img(vram,an if which=='A' else bn,pw,ph,T)
    P=pal(rec['fr'][palframe] if palframe is not None else fr); rgb=P[pp.astype(int)*16+idx]
    a=np.where(idx>0,255,0).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb,a]),'RGBA'),pr
def scroll(rec,i):
    fr=rec['fr'][i]; r=fr['reg']; vram=rec['vr'][fr['vi']]; pw,ph,an,bn,sat,hs=geom(r); hm=r[11]&3
    out={}
    for nm,ix in (('A',0),('B',1)):
        hl=[]
        for y in range(224):
            a=hs+ix*2 if hm==0 else (hs+y*4+ix*2 if hm==3 else hs+(y&~7)*4+ix*2)
            v=((vram[a]<<8)|vram[a+1])&0x3FF; hl.append(v-1024 if v&0x200 else v)
        out[nm]=dict(h=hl,v=fr['vsram'][ix]&0x3FF,vcol=bool(r[11]&4))
    out['hmode']=hm; return out
def sprites(rec,i):
    fr=rec['fr'][i]; r=fr['reg']; vram=rec['vr'][fr['vi']]; pw,ph,an,bn,sat,hs=geom(r)
    L=[];k=0
    for _ in range(80):
        a=sat+k*8
        y=(((vram[a]<<8)|vram[a+1])&0x3FF)-128; sz=vram[a+2]; nx=vram[a+3]&0x7F
        e=(vram[a+4]<<8)|vram[a+5]; x=(((vram[a+6]<<8)|vram[a+7])&0x1FF)-128
        L.append(dict(x=x,y=y,w=((sz>>2)&3)+1,h=(sz&3)+1,t=e&0x7FF,hf=(e>>11)&1,vf=(e>>12)&1,pal=(e>>13)&3,pri=e>>15))
        if nx==0: break
        k=nx
    return L
def sprite_layer(rec,i,W=320,H_=224,pad=128,filt=None,palframe=None):
    """스프라이트만 RGBA. pad 만큼 화면 밖 여백 포함 캔버스(좌상단 = 화면(-pad,-pad)). palframe: 다른 프레임 CRAM 사용."""
    fr=rec['fr'][i]; vram=rec['vr'][fr['vi']]; T=H.tiles_np(vram); P=pal(rec['fr'][palframe] if palframe is not None else fr)
    cw,ch=W+2*pad,H_+2*pad
    img=np.zeros((ch,cw,4),np.uint8)
    S=sprites(rec,i)
    for s in reversed(S):
        if filt and not filt(s): continue
        if s['x']<=-128+1 and s['y']<=-128+1: continue
        for cx in range(s['w']):
            for cy in range(s['h']):
                tx=(s['w']-1-cx) if s['hf'] else cx; ty=(s['h']-1-cy) if s['vf'] else cy
                t=T[(s['t']+tx*s['h']+ty)&0x7FF]
                if s['hf']: t=t[:,::-1]
                if s['vf']: t=t[::-1,:]
                X=s['x']+cx*8+pad; Y=s['y']+cy*8+pad
                if X<0 or Y<0 or X+8>cw or Y+8>ch: continue
                m=t>0
                blk=img[Y:Y+8,X:X+8]
                blk[m,:3]=P[s['pal']*16+t[m]]; blk[m,3]=255
    return Image.fromarray(img,'RGBA')
def screen(rec,i): return H.render(FMD(rec,i))
def bgcolor(rec,i):
    fr=rec['fr'][i]; return tuple(int(c) for c in pal(fr)[fr['reg'][7]&0x3F])
def plane_palline(rec,i,which):
    fr=rec['fr'][i]; r=fr['reg']; vram=rec['vr'][fr['vi']]; pw,ph,an,bn,sat,hs=geom(r)
    idx,pp,pr=H.plane_img(vram,an if which=='A' else bn,pw,ph,H.tiles_np(vram))
    v=pp[idx>0]
    return int(np.bincount(v).argmax()) if v.size else 0
def fade(rec,i,ref,line=None):
    """ref 프레임 CRAM 대비 현재 CRAM: ('none'|'white'|'black'|'other', k 0~1)"""
    a=pal(rec['fr'][ref]).astype(float); c=pal(rec['fr'][i]).astype(float)
    sl=slice(line*16+1,line*16+16) if line is not None else slice(0,64)
    a=a[sl]; c=c[sl]
    m=a.sum(1)>0
    if not m.any(): return ('none',0.0)
    a=a[m]; c=c[m]
    if np.abs(a-c).max()<1: return ('none',0.0)
    mw=a<248; kw=((c-a)[mw]/(252-a[mw])).mean() if mw.any() else 0
    mb=a>5; kb=(1-(c[mb]/a[mb])).mean() if mb.any() else 0
    ew=np.abs(a+kw*(252-a)-c).mean(); eb=np.abs(a*(1-kb)-c).mean()
    if min(ew,eb)>20: return ('other',round(float(np.abs(c-a).mean()/255),2))
    return ('white',round(float(kw),2)) if ew<=eb else ('black',round(float(kb),2))
