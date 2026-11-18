"""1PvsCOM 편성(COM) 화면(서브 4)에서 커서 이동별 화면·RAM 변화. 사용: t_pm_hover.py <out_dir> <state_pkl_out>
S 자동 진행으로 (a4,0,4,1) 도달 후 정지, 방향 입력으로 선수 선택 시 RAM 차분을 출력."""
import numpy, inspect
import sys,json,os,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
out=sys.argv[1]; os.makedirs(out,exist_ok=True)
md=load('modemenu'); tap(md,U,20,hl=4)
for _ in range(4): md.pad=[S,0]; md.run_frame()
f=0
while True:
    s=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))
    if s==(0xa4,0,4,1): break
    md.pad=[S if f%45<3 else 0,0]; md.run_frame(); f+=1
hold(md,0,60)
pickle.dump(md,open(sys.argv[2],'wb'))
print('reached',f)
render(md).save(out+'/h_start.png')
prev=bytes(md.ram[0xE000:0x10000])
for i,(k,m) in enumerate([('R',R),('R',R),('D',D),('L',L),('L',L),('U',U),('U',U)]):
    tap(md,m,12,hl=4)
    cur=bytes(md.ram[0xE000:0x10000])
    ch=[(0xE000+j,prev[j],cur[j]) for j in range(len(cur)) if prev[j]!=cur[j]]
    print(i,k,len(ch),[(hex(a),b,c) for a,b,c in ch][:60])
    prev=cur
    render(md).save('%s/h_%d_%s.png'%(out,i,k))
