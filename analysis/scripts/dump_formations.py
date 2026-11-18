# 팀별 포메이션 표 덤프 → analysis/data/formations.json + 도식 PNG. 사용: python -I analysis/scripts/dump_formations.py
import sys, json; sys.stdout.reconfigure(encoding='utf-8')
from PIL import Image, ImageDraw
R=open('rom/danpei.gen','rb').read()
w=lambda a:int.from_bytes(R[a:a+2],'big')
GROUP=[w(0x180b8+2*i) for i in range(13)]          # 슬롯 -> 그룹(0..6)
NAMES=['五芒星','V字','十勝岳','大文字','琉球アタック','虎牢関','山の手','エンドアタック','ミックスパス','モスクワン','パルテノン','サンドイッチ','モアイゴッド','ファラオアタック','スタークラッシュ']
GSLOT=[0,1,2,3,4,7,10]   # 그룹 대표 슬롯(7인 팀: 내야 0~3, 외야 상 4, 하 7, 후방 10)
teams=[]
for t in range(25):
    pos=[(w(0x18182+t*28+4*g),w(0x18184+t*28+4*g)) for g in range(7)]
    posm=[(w(0x1843e+t*28+4*g),w(0x18440+t*28+4*g)) for g in range(7)]
    order=list(R[0x180d2+t*7:0x180d2+t*7+7])
    nxt={GSLOT[g]:order[g] for g in range(7)}
    # 슬롯0 에서 시작한 순환
    seen=[];s=0
    while s not in seen: seen.append(s); s=nxt[s]
    cyc=seen[seen.index(s):]
    teams.append(dict(team=t,name_idx=R[0x18718+t],name_ja=NAMES[R[0x18718+t]],cpu_threshold=R[0x186fa+t],
        pos_by_group=pos,pos_by_group_mirror=posm,pass_next_slot_by_group=order,cycle_from_slot0=cyc,cycle_len=len(cyc)))
out=dict(_source="ROM: 위치 0x18182(사이드 미러 0x1843E) 팀*28+그룹*4 (x,y word, 코트 좌표 x 0~512 y 0~256); 패스 다음 슬롯 0x180D2 팀*7+그룹; 슬롯->그룹 0x180B8; 이름 그래픽 인덱스 0x18718[팀] -> 0x38660 상대오프셋 압축 타일(16타일, 64x16); CPU 발동 문턱 0x186FA[팀]. analysis/14_formation_cutin.md",
    slot_to_group=GROUP, group_rep_slot=GSLOT, teams=teams)
json.dump(out,open('analysis/data/formations.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
for t in teams: print(t['team'],t['name_ja'],'thr',t['cpu_threshold'],'cycle',t['cycle_from_slot0'],'next',t['pass_next_slot_by_group'])
# 도식(15 선택 가능 팀 + 22/23)
sel=list(range(15))+[22,23]
cw,ch=256,128; cols=4; rows=(len(sel)+cols-1)//cols
img=Image.new('RGB',(cols*(cw+8),rows*(ch+20)),(20,20,20)); d=ImageDraw.Draw(img)
for k,t in enumerate(sel):
    T=teams[t]; ox=(k%cols)*(cw+8)+4; oy=(k//cols)*(ch+20)+16
    d.rectangle((ox,oy,ox+cw,oy+ch),outline=(90,90,90)); d.line((ox+cw//2,oy,ox+cw//2,oy+ch),fill=(90,90,90))
    P=lambda xy:(ox+xy[0]/2,oy+xy[1]/2)
    gp={GSLOT[g]:T['pos_by_group'][g] for g in range(7)}
    c=T['cycle_from_slot0']
    for i in range(len(c)):
        a=P(gp[c[i]]); b=P(gp[c[(i+1)%len(c)]]); d.line((a,b),fill=(255,200,60),width=1)
    for g in range(7):
        x,y=P(T['pos_by_group'][g]); col=(80,200,255) if GSLOT[g] in c else (150,150,150)
        d.ellipse((x-3,y-3,x+3,y+3),fill=col); d.text((x+4,y-6),str(GSLOT[g]),fill=col)
    d.text((ox,oy-14),'team %d  name#%d  cycle %s'%(t,T['name_idx'],c),fill=(255,255,0))
img.save('analysis/gfx/formation/formation_paths_by_team.png'); print('png ok')
