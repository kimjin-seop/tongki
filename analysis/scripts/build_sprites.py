"""선수 스프라이트(몸통+머리) 시트 생성. 모든 규칙은 ROM 코드 해독 + 에뮬레이터 SAT 대조로 검증.
 몸통: 3개 몸통 클래스(0x2FE00 -> 0x2FE0C/0x2FF38/0x30064) 애니표 -> 프레임(조각 6B). 클래스는 선수별 ROM 0x18008[team*7+player] (코드 0x4F48).
 몸통 타일: 공용 스트림 6개 (0x30744->tile 0x270, 0x30fde->0x2EF, 0x31570->0x341, 0x31f14->0x3D9, 0x32424->0x429, 0x32fec->0x4DB)
 머리: 팀별 스트림 ROM 0x40300[team] -> VRAM tile 0x100(사이드0)/0x1B8(사이드1) (코드 0x4F60). 머리 프레임 5개/선수: ROM 0x4D15C[team]+player*0x14 (코드 0x4FCA).
   머리 포즈 = byte 0x1E10[anim>>1](=0,4,8,12,16 -> 5개 포인터 중 하나, 코드 0x1DF8)
   머리 위치 = 0x40000[bodyclass] -> 애니별 (dx,dy) word 쌍/프레임 (코드 0x1E60), 반전시 dx 부호 반대
   머리/몸통 앞뒤 = 0x1EB8 표의 byte(애니·프레임별): 0 이면 몸통이 위, 1 이면 머리가 위 (코드 0x1F2A)
 팔레트: ROM 0x2FAEE 팀 팔레트 표.
출력: analysis/gfx/sprites/ {team_XX.png, anims.json, teams.json, palettes.json, manifest.json}
사용: python -I analysis/scripts/build_sprites.py"""
import sys,json,os
sys.path.insert(0,'analysis/scripts')
from PIL import Image
from sprlib import *
from gfxdec import decode
OUT='analysis/gfx/sprites'
os.makedirs(OUT,exist_ok=True)
def tiles_of(src,t0,TILES):
    data,end,dl,n=decode(ROM,src)
    for i in range(n):
        raw=data[i*32:(i+1)*32]
        px=[[0]*8 for _ in range(8)]
        for y in range(8):
            for x in range(4):
                b=raw[y*4+x];px[y][2*x]=b>>4;px[y][2*x+1]=b&15
        TILES[t0+i]=px
BODY_TILES={}
for src,t0 in {0x30744:0x270,0x30fde:0x2EF,0x31570:0x341,0x31f14:0x3D9,0x32424:0x429,0x32fec:0x4DB}.items(): tiles_of(src,t0,BODY_TILES)
def rgb(w): return (((w>>1)&7)*36,((w>>5)&7)*36,((w>>9)&7)*36)
po=[u16(0x2faee+2*i) for i in range(25)]
PALS=[[u16(0x2faee+po[t]+2*i) for i in range(16)] for t in range(25)]
CELL=80;OX=40;OY=56
ANIM_NAMES={0x00:'walk_a',0x02:'walk_b',0x04:'dash',0x06:'throw_a',0x08:'throw_b',0x0A:'unk0A',0x0C:'unk0C',
 0x0E:'stand_a',0x10:'stand_b',0x12:'jump_a',0x14:'jump_b',0x16:'duck_a',0x18:'duck_b',0x1A:'hit_a',0x1C:'hit_b',
 0x1E:'down',0x20:'catch_a',0x22:'catch_b',0x24:'unk24',0x26:'unk26',0x28:'pass_a',0x2A:'pass_b',0x2C:'jumpthrow_a',0x2E:'jumpthrow_b'}
def draw_pieces(im,pieces,tiles,tilebase,pal,flip,dx=0,dy=0):
    px=im.load()
    for p in reversed(pieces):
        w=((p['size']>>2)&3)+1;h=(p['size']&3)+1
        x0=(p['xf'] if flip else p['x'])+dx;y0=p['y']+dy
        for cx in range(w):
            for cy in range(h):
                tx=(w-1-cx) if flip else cx
                T=tiles.get((p['tile']+tilebase+tx*h+cy)&0x7FF)
                if T is None: continue
                for yy in range(8):
                    for xx in range(8):
                        v=T[yy][7-xx] if flip else T[yy][xx]
                        if v==0: continue
                        X=OX+x0+cx*8+xx;Y=OY+y0+cy*8+yy
                        if 0<=X<CELL and 0<=Y<CELL: px[X,Y]=rgb(pal[v])+(255,)
def head_offsets(bc,aid,nfr):
    b=u32(0x40000+4*bc)
    a=b+u16(b+aid)
    return [(s16(u16(a+4*i)),s16(u16(a+4*i+2))) for i in range(max(nfr,1))]
def s16(v): return v-65536 if v>32767 else v
def head_front(aid,fi):
    a=0x1eb8+u16(0x1eb8+aid)
    return ROM[a+fi]
# 애니 목록 (몸통 클래스별) -> 콤보(애니,프레임) 열 목록
combos=[]  # (aid, fidx)
an_by_body=[parse_animset(b) for b in BODY_SETS]
ref=an_by_body[0]
for aid,a in ref.items():
    n=a['count'] if a['count'] else 1
    for fi in range(n): combos.append((aid,fi))
NCOL=len(combos)
def frames_of(an,aid):
    a=an[aid]
    return a['frames'] if a['count'] else [u32(a['off']+2)]
anims_json={}
for bc in range(3):
    an=an_by_body[bc]; aj={}
    for aid,a in an.items():
        fl=frames_of(an,aid)
        aj[aid]=dict(name=ANIM_NAMES.get(aid,'a%02X'%aid),speed=a['speed'],loop=bool(a['count']),
          head_pose_index=ROM[0x1e10+(aid>>1)]//4,
          frames=[dict(col=combos.index((aid,i)) if (aid,i) in combos else None,rom=hex(f),hitbox=parse_frame(f)['hb'],
                       head_dx=head_offsets(bc,aid,len(fl))[i][0],head_dy=head_offsets(bc,aid,len(fl))[i][1],head_on_top=head_front(aid,i),
                       pieces=parse_frame(f)['pieces']) for i,f in enumerate(fl)])
    anims_json[f'body{bc}']=dict(table_rom=hex(BODY_SETS[bc]),anims=aj)
teams_json=[]
for t in range(25):
    HT={}
    tiles_of(u32(0x40300+4*t),0x100,HT)
    sheet=Image.new('RGBA',(NCOL*CELL,CELL*14),(0,0,0,0))
    players=[]
    for p in range(7):
        bc=ROM[0x18008+t*7+p]
        hb=u32(0x4d15c+4*t)+p*0x14
        heads=[u32(hb+4*i) for i in range(5)]
        players.append(dict(player=p,body_class=bc,head_frames_rom=[hex(h) for h in heads],special_shot_id=ROM[0x18732+t*8+p] if ROM[0x18732+t*8+p]<0x80 else -1))
        for ci,(aid,fi) in enumerate(combos):
            an=an_by_body[bc]
            fl=frames_of(an,aid); f=fl[min(fi,len(fl)-1)]
            body=parse_frame(f)
            pose=ROM[0x1e10+(aid>>1)]//4
            head=parse_frame(heads[pose])
            ho=head_offsets(bc,aid,len(fl))[min(fi,len(fl)-1)]
            top=head_front(aid,min(fi,len(fl)-1))
            for flip in (0,1):
                im=Image.new('RGBA',(CELL,CELL),(0,0,0,0))
                dx=-ho[0] if flip else ho[0]
                layers=[('b',),('h',)] if top else [('h',),('b',)]
                for (k,) in layers:
                    if k=='b': draw_pieces(im,body['pieces'],BODY_TILES,0,PALS[t],flip)
                    else: draw_pieces(im,head['pieces'],HT,0x100,PALS[t],flip,dx,ho[1])
                sheet.paste(im,(ci*CELL,(p*2+flip)*CELL))
    sheet.save('%s/team_%02d.png'%(OUT,t))
    teams_json.append(dict(team=t,palette_index=t,players=players,sheet='team_%02d.png'%t))
json.dump(anims_json,open(OUT+'/anims.json','w'),indent=1)
json.dump(teams_json,open(OUT+'/teams.json','w'),indent=1)
json.dump(dict(cram_words=[[hex(w) for w in p] for p in PALS],rgb=[[rgb(w) for w in p] for p in PALS],rom_table='0x2FAEE: 25 word offsets -> 16 CRAM words (index0 transparent)'),open(OUT+'/palettes.json','w'))
json.dump(dict(cell=CELL,origin_in_cell=[OX,OY],columns=[dict(col=i,anim_id=a,anim=ANIM_NAMES.get(a),frame=f) for i,(a,f) in enumerate(combos)],
  rows='row = player*2 + flip (flip=object flags bit7: mirror, use head_dx negated)',
  note='sheet column ci is (anim,frame) from the anim list of body class (frames differ per body class, columns identical). origin = object ground position. Screen y: obj.y/2 - obj.z (pseudo 3D).'),open(OUT+'/manifest.json','w'),indent=1)
print('ok',NCOL)
