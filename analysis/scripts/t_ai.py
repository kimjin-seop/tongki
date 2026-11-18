import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
md=load('play0')
pokeb(md,0xE717,0); pokeb(md,0xE797,0)
last=None
N=int(sys.argv[1])
for f in range(N):
    md.pad=[0,0]; md.run_frame()
    s=(ramw(md,0xE600),ramw(md,0xE602),peekb(md,0xE757),peekb(md,0xE7D7),peekb(md,0xE714),peekb(md,0xE794))
    if s!=last:
        print(f,[hex(x) for x in s],'t',peekb(md,0xE684),peekb(md,0xE685),peekb(md,0xE686),peekb(md,0xE687)); last=s
print(st(md))
import pickle; pickle.dump(md,open('analysis/state/ai_end.pkl','wb'))
