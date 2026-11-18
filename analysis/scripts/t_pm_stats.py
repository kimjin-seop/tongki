"""편성 화면 능력치 막대의 원천 추적: 선수 능력치 RAM($FF8000~87FF) 읽기 PC 수집."""
import numpy, inspect
import sys,pickle,collections; sys.path.insert(0,"analysis/scripts")
from drv import *
md=pickle.load(open('analysis/state/pm1_f4.pkl','rb'))
_r=md.read; rd=collections.Counter()
def r(addr,size):
    a=addr&0xFFFFFF
    if 0xFF8000<=a<0xFF8800: rd[(md.pc,a)]+=1
    return _r(addr,size)
tap(md,R,12,hl=4)  # warm
md.read=r
tap(md,R,12,hl=4)
md.read=_r
pcs=collections.Counter()
for (pc,a),n in rd.items(): pcs[pc]+=n
print(sorted(pcs.items())[:40])
print(sorted(set(hex(a) for pc,a in rd))[:30])
