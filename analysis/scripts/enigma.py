"""0x1356 루틴 = Enigma 계열 타일맵 압축 해제기 (코드에서 직접 포팅).
헤더: [u8 타일비트수][u8 플래그(bit0=vflip비트 존재, bit1=hflip비트 존재)][u16 증가값][u16 고정값] + MSB-first 비트스트림.
입력 base = 타일 오프셋(d0). 반환: 16비트 워드 리스트."""
def enigma(rom,off,base=0):
    p=off
    nb=rom[p];flags=rom[p+1];p+=2
    inc=((rom[p]<<8)|rom[p+1])+base;p+=2
    lit=((rom[p]<<8)|rom[p+1])+base;p+=2
    hasv=bool(flags&1);hasn=bool(flags&2)
    bits=0;cnt=0
    def rd(n):
        nonlocal bits,cnt,p
        while cnt<n:
            bits=(bits<<8)|rom[p];p+=1;cnt+=8
        v=(bits>>(cnt-n))&((1<<n)-1);cnt-=n;bits&=(1<<cnt)-1;return v
    def tile():
        t=base
        if hasv and rd(1):t|=0x1000
        if hasn and rd(1):t|=0x0800
        return (rd(nb)+t)&0xffff
    out=[];I=inc
    while True:
        w=rd(1)
        if w==0:
            m=rd(1);c=rd(4)
            if m==0:
                for _ in range(c+1):out.append(I);I+=1
            else:
                for _ in range(c+1):out.append(lit)
        else:
            m=rd(2);c=rd(4)
            if m==0:
                t=tile();out+= [t]*(c+1)
            elif m==1:
                t=tile()
                for _ in range(c+1):out.append(t);t+=1
            elif m==2:
                t=tile()
                for _ in range(c+1):out.append(t);t-=1
            else:
                if c==15:break
                for _ in range(c+1):out.append(tile())
    return out,p
