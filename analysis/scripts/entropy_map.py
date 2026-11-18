import math,collections,sys
d=open('rom/danpei.gen','rb').read()
B=0x1000
out=[]
for a in range(0,len(d),B):
    b=d[a:a+B]
    c=collections.Counter(b);n=len(b)
    H=-sum(v/n*math.log2(v/n) for v in c.values())
    rts=sum(1 for i in range(0,n-1,2) if b[i:i+2]==b'\x4e\x75')
    jsr=sum(1 for i in range(0,n-1,2) if b[i:i+2] in (b'\x4e\xb9',b'\x4e\xba',b'\x61\x00'))
    z=c[0]/n
    out.append("%06x H=%.2f rts=%3d call=%3d zero=%.2f"%(a,H,rts,jsr,z))
open('analysis/entropy_map.txt','w').write("\n".join(out))
print("\n".join(out))
