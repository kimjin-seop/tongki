"""ROM 전체를 훑어 압축 타일 스트림 카탈로그 생성(analysis/gfx/catalog.json, catalog.txt).
모든 짝수 오프셋에서 디코드를 시도 -> 성공 구간 후보 -> 가중 구간 스케줄링(커버 바이트 최대)으로 겹침 해소."""
import sys,json,bisect
sys.path.insert(0,'analysis/scripts')
from gfxdec import decode,DecErr
rom=open('rom/danpei.gen','rb').read()
cands=[]
for o in range(0x1a000,len(rom)-8,2):
    if rom[o+2]<0x80 or rom[o+2]==0xff:continue
    nt=((rom[o]<<8)|rom[o+1])&0x1fff
    if not (1<=nt<=0x600):continue
    try:t,e,dl,n=decode(rom,o)
    except (DecErr,IndexError):continue
    cands.append((o,(e+1)&~1,n,dl))
cands.sort(key=lambda c:c[1])
ends=[c[1] for c in cands]
best=[0]*(len(cands)+1);choice=[None]*(len(cands)+1)
for i,c in enumerate(cands):
    # 가장 가까운 비겹침 이전 후보
    j=bisect.bisect_right(ends,c[0],0,i)
    w=c[1]-c[0]
    if best[j]+w>best[i] :
        best[i+1]=best[j]+w;choice[i+1]=(j,True)
    else:
        best[i+1]=best[i];choice[i+1]=(i,False)
    if best[i+1]<best[i]:best[i+1]=best[i];choice[i+1]=(i,False)
sel=[];k=len(cands)
while k>0:
    j,take=choice[k]
    if take: sel.append(cands[k-1])
    k=j
sel.sort()
json.dump([dict(off=o,end=e,tiles=n,delta=d) for o,e,n,d in sel],open('analysis/gfx/catalog.json','w'))
prev=0;L=[]
for o,e,n,d in sel:
    L.append("%06x-%06x tiles=%3d %s gap_before=%d"%(o,e,n,'D' if d else ' ',o-prev));prev=e
open('analysis/gfx/catalog.txt','w').write("\n".join(L))
print(len(cands),len(sel))
