import sys; sys.path.insert(0,"analysis/scripts")
from drv import *
md=new()
hits=[]
cur={}
def hook(m,pc):
    cur['pc']=pc
md.hook=hook
def cb(m,addr,val,size):
    hits.append((m.frame,hex(cur['pc']),hex(addr),hex(val),size))
md.wwatch={0xC13C:cb,0xC13D:cb,0xC4BC:cb,0xC4BD:cb}
to_modemenu(md)
for i in range(120):
    tap(md,S if i%3!=1 else C,25)
    if st(md)[0]==0x14: break
hold(md,0,10)
for h in hits[:40]: print(h)
