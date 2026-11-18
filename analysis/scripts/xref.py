"""무차별 xref 검색(모든 짝수 오프셋): jsr/jmp abs.l·abs.w, bsr/bra/bcc .b/.w, jsr/jmp/lea/pea (d16,pc), move.w/l #imm 등 주소 상수.
사용: python -I analysis/scripts/xref.py <hex주소|lo-hi> ...   (코드 구간 0x200~0x17100 만 검색)"""
import sys,struct
R=open('rom/danpei.gen','rb').read()
END=0x17100
def scan():
    out=[]
    for a in range(0x200,END,2):
        op=struct.unpack_from('>H',R,a)[0]
        if op in (0x4EB9,0x4EF9):
            out.append((struct.unpack_from('>I',R,a+2)[0],a,'jsr.l' if op==0x4EB9 else 'jmp.l'))
        elif op in (0x4EB8,0x4EF8):
            out.append((struct.unpack_from('>H',R,a+2)[0],a,'jsr.w' if op==0x4EB8 else 'jmp.w'))
        elif op in (0x4EBA,0x4EFA,0x487A) or (op&0xF1FF)==0x41FA:
            t=a+2+struct.unpack_from('>h',R,a+2)[0]
            out.append((t,a,{0x4EBA:'jsr.pc',0x4EFA:'jmp.pc',0x487A:'pea.pc'}.get(op,'lea.pc')))
        elif (op&0xF000)==0x6000:
            d=op&0xFF
            if d==0: t=a+2+struct.unpack_from('>h',R,a+2)[0]
            elif d==0xFF: continue
            else: t=a+2+(d-256 if d&0x80 else d)
            cc=(op>>8)&0xF
            out.append((t,a,'bra' if cc==0 else 'bsr' if cc==1 else 'bcc%x'%cc))
    return out
if __name__=='__main__':
    X=scan()
    for arg in sys.argv[1:]:
        if '-' in arg: lo,hi=[int(x,16) for x in arg.split('-')]
        else: lo=hi=int(arg,16)
        print('== xref',arg)
        for t,a,k in sorted(X):
            if lo<=t<=hi and not (lo<=a<=hi and k.startswith('b')): print('  %06x <- %06x %s'%(t,a,k))
