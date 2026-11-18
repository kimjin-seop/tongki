"""편성(능력치 보기) 화면 에셋 추출 -> public/assets/rom/prematch/. 입력: analysis/state/pm1_f4h.pkl (t_select_cont, 커서가 선수 위)
산출: fm_bg.png(320x224, 텍스트 제거한 창+코트 배경), fm_bar.png(4x8 막대 1칸)"""
import numpy, inspect
import sys,os; sys.path.insert(0,"analysis/scripts")
import intro_lib as I
from PIL import Image
r=I.load('analysis/state/pm1_f4h.pkl'); out='public/assets/rom/prematch'; os.makedirs(out,exist_ok=True)
i=60
A,_=I.plane_rgba(r,i,'A'); B,_=I.plane_rgba(r,i,'B')
bg=Image.new('RGBA',(320,224),(0,0,0,255)); bg.alpha_composite(B)
fill=(0,36,0,255)
from PIL import ImageDraw
d=ImageDraw.Draw(bg)
d.rectangle((27,11,136,44),fill=fill)     # 왼쪽 위 팀 패널 안쪽(엠블럼·글자 자리)
d.rectangle((27,52,138,107),fill=fill)    # 능력치 창 안쪽(라벨·점선)
d.rectangle((139,11,212,107),fill=fill)   # 가운데 패널 안쪽(점선 끝이 걸림)
bg.convert('RGB').save(out+'/fm_bg.png')
# 막대 1칸 4x8: 평면 A 의 (144,56)
bar=A.crop((144,56,148,64)); bar.save(out+'/fm_bar.png')
# 커서: 편성 커서는 40x40 (얼굴 24x24 + 바깥 8px) = select.cursor 시트의 plain 행과 동일 -> 별도 추출 없음
# 확인용 확대
Image.open(out+'/fm_bg.png').resize((640,448),Image.NEAREST).save('analysis/gfx/prematch/_fm_bg_x2.png')

# ---- EXIT 글자(22x12, 평면 A (257,78)) ----
A.crop((257,78,279,90)).save(out+'/fm_exit.png')
# ---- 데이터 JSON(public/assets/data/prematch.json): 레이아웃·좌표·능력치·문구·사운드 ----
import csv,json
rows=list(csv.DictReader(open('analysis/data/teams_players.csv',encoding='utf-8')))
teams={}
for r_ in rows:
    teams.setdefault(int(r_['team']),[None]*7)[int(r_['player'])]=[int(r_[k]) for k in ['hp(s0)','defense(s1)','move_speed(s2)','s3_lob_or_arc','power(s4)','s5_timer']]
rom=open('rom/danpei.gen','rb').read()
div=[b>>3 for b in rom[0xE9CC:0xE9D2]]
com=[[164,164],[244,164],[204,140],[204,180],[88,136],[88,188],[28,164]]
data={
 "_note":"편성(능력치 보기) 화면 데이터. 근거 analysis/20_prematch_screens.md. 좌표는 원작 320x224 기준(논리 398 폭에선 +39)",
 "source":{"stats":"ROM 0x18836 (25팀x7x8B, 앞 6바이트 = 체력,방어,스피드,점프,슛,캐치) = analysis/data/teams_players.csv","divisors":"ROM 0xE9CC 표 >>3 (루틴 0xEC2E)"},
 "bar":{"x":144,"y0":56,"pitch":8,"blockW":4,"rule":"q=floor(v/d); blocks=2*q + (v%d >= (d>>1) ? 1 : 0)","divisors":div,"order":["hp","def","spd","jump","shot","catch"]},
 "faces":{"com":com,"p1":[[296-x,y] for x,y in com],"hover":[144,20],"size":24,"cursorMargin":8,"note":"선수 idx 0~3 내야, 4 외야상, 5 외야하, 6 외야후방. 1P 화면은 x 를 296-x 로 반전"},
 "panel":{"label":[32,17],"emblem":[32,24],"teamName":[64,22],"abbr":[64,32],"playerName":[144,48],"statLabel":[32,56],"dotsEnd":138,"exit":[257,78],"exitFrame":[250,65,36,37],"tip":{"y":116,"cx":160,"color":"#fcfc00"}},
 "teams":{str(k):v for k,v in sorted(teams.items())},
 "ko":{"stats":["체력","방어","스피드","점프","슛","캐치"],"tipCom":"커서를 맞추면 {who}의 파라미터를 볼 수 있습니다","tipSwap":"포지션을 바꿀 수 있습니다","tipPick":"교대할 사람을 고르세요","exit":"EXIT"},
 "sfx":{"cursorMove":"0xA0","confirm":"0xA1","note":"원작 ID. 웹은 sfx.ui.cursor / sfx.ui.confirm 으로 대응(미청취 UNVERIFIED)"}
}
# 에이스 후보 [추정]: 팀 내 체력(hp) 최대, 동률이면 뒤쪽 idx. 칭호 숫자 = floor(hp/9). 사용자 스크린샷 4팀(A.T 12, TOK 14, GRE 15, 팀15 16)과 4/4 일치하나 ROM 표는 미확인
ace={}
for t,pl in teams.items():
    hp=[p_[0] for p_ in pl]; m=max(hp); i=max(k for k,v in enumerate(hp) if v==m); ace[str(t)]={"idx":i,"hp":m,"num":m//9}
data["aceEstimate"]={"_note":"[추정] ROM 표 미확인. 근거 analysis/20_prematch_screens.md 5","teams":ace}
os.makedirs('public/assets/data',exist_ok=True)
json.dump(data,open('public/assets/data/prematch.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('divisors',div,'teams',len(teams))
