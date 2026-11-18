import numpy
import sys,os,pickle
sys.path.insert(0,'analysis/scripts')
from drv import *
from t_md_step import render_w
from PIL import Image
md=pickle.load(open(sys.argv[1],'rb')); ims=[]; last=None
for f in range(1,int(sys.argv[3])+1):
    md.pad=[0,0]; md.run_frame()
    s=(ramw(md,0xE600),ramw(md,0xE400),ramw(md,0xE406))
    if s!=last: print('f%d E600=%x sub=%d e406=%d'%(f,*s)); last=s
    if f%150==0: ims.append(render_w(md).convert('RGB').crop((0,20,320,80)))
W=Image.new('RGB',(320,60*len(ims)))
for i,im in enumerate(ims): W.paste(im,(0,60*i))
W.save(sys.argv[2])
