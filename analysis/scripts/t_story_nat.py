"""스냅샷(t_story_snap.py)에서 무입력으로 진행하며 프레임별 팔레트 라인 합·VRAM 해시·상태 기록(JSON) + 매 10f PNG.
python -I analysis/scripts/t_story_nat.py <snap.pkl> <N> <out_prefix>"""
import numpy
import sys,pickle,hashlib,json,os; sys.path.insert(0,"analysis/scripts")
from drv import *
snap,N,pre=sys.argv[1],int(sys.argv[2]),sys.argv[3]
EVERY=int(sys.argv[4]) if len(sys.argv)>4 else 10
md=pickle.load(open(snap,'rb'))
os.makedirs(os.path.dirname(pre),exist_ok=True)
rows=[]
def lsum(v,l): return sum(((w>>1)&7)+((w>>5)&7)+((w>>9)&7) for w in v.cram[l*16:(l+1)*16])
for f in range(N):
    v=md.vdp
    rows.append([f,ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402),[lsum(v,l) for l in range(4)],hashlib.md5(bytes(v.vram)).hexdigest()[:8]])
    if EVERY and f%EVERY==0: render(md).save('%s_f%05d.png'%(pre,f))
    md.pad=[0,0]; md.run_frame()
json.dump(rows,open(pre+'_log.json','w'))
print('done',N,flush=True)
