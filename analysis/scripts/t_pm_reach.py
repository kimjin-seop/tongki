"""모드1(1PvsCOM)에서 서브상태 (a4,0,<sub>,1) 도달 상태 저장. 사용: t_pm_reach.py <sub 3|4|2> <out.pkl>"""
import numpy, inspect
import sys,pickle; sys.path.insert(0,"analysis/scripts")
from drv import *
sub=int(sys.argv[1])
md=load('modemenu'); tap(md,U,20,hl=4)
for _ in range(4): md.pad=[S,0]; md.run_frame()
f=0
while True:
    s=(ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402))
    if s==(0xa4,0,sub,1): break
    md.pad=[S if f%45<3 else 0,0]; md.run_frame(); f+=1
hold(md,0,60)
pickle.dump(md,open(sys.argv[2],'wb')); print('reached',f)
