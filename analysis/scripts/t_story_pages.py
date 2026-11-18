"""t_story_skip.py 캡처에서 페이지(글자 최대 밝기 구간)를 찾아 (f, 글자 확대 PNG) 저장. python -I analysis/scripts/t_story_pages.py <rawdir> <outdir>"""
import numpy as np, sys, os, glob, re
from PIL import Image
raw,out=sys.argv[1:3]; os.makedirs(out,exist_ok=True)
fs=sorted(int(re.search(r'f(\d+)',p).group(1)) for p in glob.glob(raw+'/f*.png'))
rows=[]
for f in fs:
    a=np.array(Image.open('%s/f%05d.png'%(raw,f)).convert('RGB')).astype(int)
    t=a[132:176,:,:]; img=a[32:128,32:288,:]
    rows.append((f,int((t.sum(2)>600).sum()), int(img.sum()//1000)))
# 글자 흰 픽셀 수 기준 페이지: 흰 픽셀>20 인 연속 구간의 최대 근처
pg=[];cur=[]
for f,w,i in rows:
    if w>20: cur.append((f,w,i))
    else:
        if cur: pg.append(cur); cur=[]
if cur: pg.append(cur)
for n,c in enumerate(pg):
    best=max(c,key=lambda r:r[1]); f=best[0]
    print(n,'f%d-%d'%(c[0][0],c[-1][0]),'best',f,best[1])
    im=Image.open('%s/f%05d.png'%(raw,f)).convert('RGB')
    im.crop((40,128,280,176)).resize((960,192),Image.NEAREST).save('%s/p%02d_f%05d_txt.png'%(out,n,f))
