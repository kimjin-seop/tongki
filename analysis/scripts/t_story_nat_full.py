"""모드 메뉴(modemenu.pkl)에서 START 2회(f12 倒せ!, f100 はじめから) 후 무입력 진행, 프레임별 팔레트 라인 합·VRAM 해시·상태 기록 + 매 10f PNG. python -I analysis/scripts/t_story_nat_full.py <무시> <N> <out_prefix>
python -I analysis/scripts/t_story_nat.py <snap.pkl> <N> <out_prefix>"""
import numpy
import sys,pickle,hashlib,json,os; sys.path.insert(0,"analysis/scripts")
from drv import *
snap,N,pre=sys.argv[1],int(sys.argv[2]),sys.argv[3]
md=load('modemenu'); pokew(md,0xC024,0)
INP={f+k:S for f in (12,100) for k in range(3)}
os.makedirs(os.path.dirname(pre),exist_ok=True)
rows=[]
def lsum(v,l): return sum(((w>>1)&7)+((w>>5)&7)+((w>>9)&7) for w in v.cram[l*16:(l+1)*16])
for f in range(N):
    v=md.vdp
    rows.append([f,ramw(md,0xE600),ramw(md,0xE602),ramw(md,0xE400),ramw(md,0xE402),[lsum(v,l) for l in range(4)],hashlib.md5(bytes(v.vram)).hexdigest()[:8]])
    if f%10==0: render(md).save('%s_f%05d.png'%(pre,f))
    md.pad=[INP.get(f,0),0]; md.run_frame()
json.dump(rows,open(pre+'_log.json','w'))
print('done',N,flush=True)
