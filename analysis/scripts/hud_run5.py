import numpy
import sys; sys.path.insert(0,"analysis/scripts")
from hud_scen import *
md=pickle.load(open('analysis/state/hud_base.pkl','rb'))
pokeb(md,0xE717,0); pokeb(md,0xE797,0)
want={246:'AI경기 f246 아웃 직전',250:'f250 얼굴 낙하',258:'f258 낙하 끝',300:'f300 (얼굴 소멸, 인원 7-7 유지)',352:'f352 인원 6-7',422:'f422 교체선수 얼굴 등장(바닥에서)',436:'f436 상승 중',450:'f450 정착(p4 얼굴)'}
ims=[];lbs=[]
for f in range(460):
    md.pad=[0,0]; md.run_frame()
    if f in want: ims.append(H.render(md)); lbs.append(want[f])
montage(ims,lbs,OUT+'hud_07_ai_out_substitute_montage.png',h=60)
