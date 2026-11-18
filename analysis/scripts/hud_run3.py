import numpy
import sys; sys.path.insert(0,"analysis/scripts")
from hud_scen import *
md=pickle.load(open('analysis/state/hud_base.pkl','rb'))
pokeb(md,0xE717,0); pokeb(md,0xE797,0)
# S3 아웃: 얼굴 HP 0 -> 낙하 후 소멸
m=pickle.loads(pickle.dumps(md)); pokew(m,0xC000+1*0x80+0x40,0); pokew(m,0xC000+8*0x80+0x40,0)
ims=[];lbs=[]
for f in range(1,25):
    m.pad=[0,0]; m.run_frame()
    if f in (1,4,8,12,16,24):
        ims.append(H.render(m)); lbs.append('hp=0 설정 후 f%d (face y=%d,%d)'%(f,ramw(m,0xC000+43*0x80+0x2e),ramw(m,0xC000+47*0x80+0x2e)))
montage(ims,lbs,OUT+'hud_03_out_fall_montage.png')
# S4 남은 인원 숫자 0~7
ims=[];lbs=[]
for a,b in ((7,7),(5,3),(2,0),(1,1)):
    m=pickle.loads(pickle.dumps(md)); pokeb(m,0xE757,a); pokeb(m,0xE7D7,b); m.pad=[0,0]; m.run_frame()
    ims.append(H.render(m)); lbs.append('rem %d - %d'%(a,b))
montage(ims,lbs,OUT+'hud_04_remaining_montage.png',h=40)
# S5 조작선수 표식(1P/COM) 와 타이머(E680=1)
m=load('ctrl0'); H.render(m).save(OUT+'hud_05_markers_1p_com.png')
m=pickle.loads(pickle.dumps(md)); pokeb(m,0xE680,1)
for i,b in enumerate([0,2,0,34]): pokeb(m,0xE684+i,b)
for f in range(40): m.pad=[0,0]; m.run_frame()
H.render(m).save(OUT+'hud_06_timer_mode_E680_1.png'); print(peekb(m,0xE685),peekb(m,0xE686))
