import sys
from capstone import *
d=open('rom/danpei.gen','rb').read()
md=Cs(CS_ARCH_M68K,CS_MODE_M68K_000)
def dis(a,n=60,out=sys.stdout):
    c=0
    for i in md.disasm(d[a:a+n*8],a):
        out.write("%06x: %-20s %s %s\n"%(i.address,d[i.address:i.address+i.size].hex(),i.mnemonic,i.op_str));c+=1
        if c>=n:break
if __name__=="__main__":
    a=int(sys.argv[1],16);n=int(sys.argv[2]) if len(sys.argv)>2 else 60
    dis(a,n)
