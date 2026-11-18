# 포메이션 연출 그래픽 추출 → public/assets/rom/sprites/formation.png/.json
# 사용: python -I analysis/scripts/formation_extract.py analysis/state/ctrl0.pkl
import numpy as np
import sys, json, pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
import t_banner_dump as TB
from t_banner_dump import u32, u16
import hud_render as H
def frame_img(md,fp,base):
    # t_banner_dump.frame_img 과 같되 캔버스 256x256, 원점 (128,128) (창 배너 상단 조각이 -64 를 넘어 잘리던 문제 수정)
    T=H.tiles_np(md.vdp.vram); cram=[H.cram_rgb(w) for w in md.vdp.cram]
    n=R[fp]+1; ps=[]
    for i in range(n):
        p=fp+2+i*6; ps.append((TB.s8(R[p]),R[p+1],u16(p+2),TB.s8(R[p+4])))
    img=Image.new('RGBA',(256,256),(0,0,0,0)); px=img.load()
    for (y,sz,t,x) in ps:
        e=(t+base)&0xFFFF; w=((sz>>2)&3)+1; h=(sz&3)+1; t0=e&0x7FF; hf=(e>>11)&1; vf=(e>>12)&1; pl=(e>>13)&3
        for cx in range(w):
            for cy in range(h):
                tx=(w-1-cx) if hf else cx
                ty=(h-1-cy) if vf else cy
                tt=T[(t0+tx*h+ty)&0x7FF]
                if hf: tt=tt[:,::-1]
                if vf: tt=tt[::-1,:]
                for yy in range(8):
                    for xx in range(8):
                        c=tt[yy,xx]
                        if c: px[128+x+cx*8+xx,128+y+cy*8+yy]=cram[pl*16+c]+(255,)
    return img,ps
import gfxdec
from PIL import Image
R=open('rom/danpei.gen','rb').read()
NAMES=['五芒星','V字','十勝岳','大文字','琉球アタック','虎牢関','山の手','エンドアタック','ミックスパス','モスクワン','パルテノン','サンドイッチ','モアイゴッド','ファラオアタック','スタークラッシュ']
def load_state():
    md=pickle.load(open(sys.argv[1],'rb'))
    for i in range(16): md.vdp.cram[32+i]=u16(0x3A1AC+2*i)   # 작전 타임 진입 시 0x58C6 이 CRAM 라인2 에 올리는 팔레트
    return md
def crop(im):
    bb=im.getbbox(); return im.crop(bb), bb
items=[]
md=load_state()
for k,key in ((1,'window'),(7,'label_formation')):
    im,ps=frame_img(md,u32(0xe130+4*k),u16(0xe0fc+2*k)); c,bb=crop(im)
    items.append((key,k,c,(128-bb[0],128-bb[1])))   # frame_img 원점 = (128,64)
for idx in range(15):
    a=0x38660+int.from_bytes(R[0x38660+2*idx:0x38662+2*idx],'big',signed=True)
    data=gfxdec.decode(R,a); data=data[0] if isinstance(data,tuple) else data
    md.vdp.vram[0xE0*32:0xE0*32+len(data)]=bytes(data)
    im,ps=frame_img(md,u32(0xe130+4*8),u16(0xe0fc+2*8)); c,bb=crop(im)
    items.append(('name_%02d'%idx,8,c,(128-bb[0],128-bb[1])))
W=max(c.width for _,_,c,_ in items); H=sum(c.height+2 for _,_,c,_ in items)
sh=Image.new('RGBA',(W,H),(0,0,0,0)); y=0; meta={}
teams_by_name={}
for t in range(25): teams_by_name.setdefault(R[0x18718+t],[]).append(t)
pos={k:(int.from_bytes(R[0xe190+4*k:0xe192+4*k],'big')-128,int.from_bytes(R[0xe192+4*k:0xe194+4*k],'big')-128) for k in (1,7,8,9)}
for key,k,c,anc in items:
    sh.paste(c,(0,y)); m=dict(rect=[0,y,c.width,c.height],anchor=list(anc),banner_type=k)
    if key=='window': m.update(screen_pos=list(pos[1]),note='YES/NO 커서(오브젝트 0x58)·남은 횟수 공 아이콘(오브젝트 0xBC)은 별도 스프라이트라 미포함. 문구: フォーメーション アタック? / YES NO / のこり')
    elif key=='label_formation': m.update(screen_pos=list(pos[7]),text_ja='フォーメーション')
    else:
        i=int(key[5:]); m.update(screen_pos_side1=list(pos[8]),screen_pos_side2=list(pos[9]),text_ja=NAMES[i],teams=teams_by_name.get(i,[]),rom_gfx=hex(0x38660+int.from_bytes(R[0x38660+2*i:0x38662+2*i],'big',signed=True)))
    meta[key]=m; y+=c.height+2
OUT='public/assets/rom/sprites/'
sh.save(OUT+'formation.png')
json.dump(dict(key='spr.formation',image='rom/sprites/formation.png',image_size=list(sh.size),alpha=True,scale=1,
  source='ROM: 배너 프레임 0xE130[1,7,8] + 타일속성 0xE0FC, 작전 이름 그래픽 0x38660 표(0x18718[팀]=이름 번호), 팔레트 0x3A1AC(CRAM 라인2), 경기 VRAM(ctrl0) 위에 합성. analysis/14_formation_cutin.md',
  coords='화면 고정(320x224 기준). (screen_pos - anchor) 에 rect 를 그림. 작전 배너 = name_NN(사이드1 (128,96)/사이드2 같은 자리) + label_formation (192,96) 을 동시에 표시',
  team_to_name=[R[0x18718+t] for t in range(25)], items=meta),open(OUT+'formation.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
sh.resize((sh.width*3,sh.height*3),Image.NEAREST).save('analysis/gfx/formation/formation_sheet_x3.png')
print('ok',sh.size,{k:(v['rect'],v['anchor']) for k,v in meta.items()})
