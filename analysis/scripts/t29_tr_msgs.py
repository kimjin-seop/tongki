import numpy
import sys,os,pickle
sys.path.insert(0,'analysis/scripts')
from drv import *
from t_md_step import render_w
from PIL import Image
ims=[]
for i in range(11):
    md=pickle.load(open('analysis/state/md/tr0.pkl','rb'))
    hold(md,0,5)
    pokew(md,0xD914,i); pokew(md,0xD900,0x00B0)
    hold(md,0,3)
    im=render_w(md).convert('RGB'); ims.append(im.crop((0,0,320,150)))
W=Image.new('RGB',(640,150*6))
for i,im in enumerate(ims): W.paste(im,((i%2)*320,(i//2)*150))
W.save(sys.argv[1])
