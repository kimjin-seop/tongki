import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
import pickle
md=pickle.load(open('analysis/state/match_story0.pkl','rb'))
last=None
for f in range(900):
    md.pad=[0,0]; md.run_frame()
    s=st(md)+(ramw(md,0xE700+0x16),)
    if s!=last:
        print(f,[hex(x) for x in s],'time',peekb(md,0xE684),peekb(md,0xE685),peekb(md,0xE686),peekb(md,0xE687)); last=s
