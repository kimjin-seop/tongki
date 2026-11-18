# 선형 스윕 디스어셈블 -> analysis/disasm_code.asm  (0x200~0x17000, 데이터 구간은 쓰레기 명령이 섞임)
from capstone import *
d=open('rom/danpei.gen','rb').read()
md=Cs(CS_ARCH_M68K,CS_MODE_M68K_000)
a=0x200;end=0x17000
out=open('analysis/disasm_code.asm','w',encoding='utf-8')
while a<end:
    got=False
    for i in md.disasm(d[a:a+20],a,1):
        out.write("%06x: %-22s %s %s\n"%(i.address,d[a:a+i.size].hex(),i.mnemonic,i.op_str));a+=i.size;got=True
    if not got:
        out.write("%06x: %-22s dc.w $%04x\n"%(a,d[a:a+2].hex(),int.from_bytes(d[a:a+2],'big')));a+=2
out.close()
