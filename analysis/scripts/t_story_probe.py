import numpy
import sys; sys.path.insert(0,"analysis/scripts")
import intro_lib as I, numpy as np
rec=I.load('analysis/state/story_rec2.pkl')
for f in (240,300,640,700,1000,1100,1450):
    fr=rec['fr'][f]; r=fr['reg']
    for w in 'AB':
        P,_=I.plane_rgba(rec,f,w); a=np.array(P)[:,:,3]>0
        ys,xs=np.where(a)
        print(f,w,'bbox',(xs.min(),ys.min(),xs.max(),ys.max()) if len(xs) else None, 'scroll',I.scroll(rec,f)[w]['h'][100],I.scroll(rec,f)[w]['v'])
    print(f,'sprites',len(I.sprites(rec,f)),'bg',I.bgcolor(rec,f),'reg',r[11],r[12],'geom',I.geom(r)[:2])
