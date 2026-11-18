import numpy
import sys; sys.path.insert(0,"analysis/scripts")
from hud_scen import *
# S1 시작 연출: match_story0 에서 프레임 진행하며 캡처
md=load('match_story0'); ims=[];lbs=[]
marks={120:'f120 (HUD 없음)',138:'f138 얼굴 등장(y=192에서 상승)',146:'f146',154:'f154',170:'f170 정착'}
for f in range(200):
    md.pad=[0,0]; md.run_frame()
    if f in marks:
        im=snap(md,'hud_01_start_f%03d'%f, full=(f in (120,146,170))); ims.append(im); lbs.append(marks[f])
montage(ims,lbs,OUT+'hud_01_start_montage.png')
# S2 HP 변화
md=pickle.load(open('analysis/state/hud_base.pkl','rb'))
def sethp(md,l,r):
    for i,h in enumerate(l): pokew(md,0xC000+i*0x80+0x40,h)
    for i,h in enumerate(r): pokew(md,0xC000+(7+i)*0x80+0x40,h)
ims=[];lbs=[]
for name,(l,r) in {'A 기본(원본)':(None,None),
  'B hp 100/75/50/25 | 100/75/50/25':([100,75,50,25],[100,75,50,25]),
  'C hp 19/10/5/1 | 19/10/5/1 (떨림)':([19,10,5,1],[19,10,5,1]),
  'D hp 150/120/90/60 | 40/30/20/20':([150,120,90,60],[40,30,20,20])}.items():
    m=pickle.loads(pickle.dumps(md))
    if l: sethp(m,l,r)
    for _ in range(3): m.pad=[0,0]; m.run_frame()
    ims.append(snap(m,'hud_02_hp_'+name[0],full=True)); lbs.append(name)
montage(ims,lbs,OUT+'hud_02_hp_montage.png')
