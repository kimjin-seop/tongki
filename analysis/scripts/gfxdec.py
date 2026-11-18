"""ROM 자체 타일 압축(0x1126/0x1138 루틴) 디코더 (허프만+니블 런+선택적 행 XOR).
스트림: u16 헤더(bit15=행 XOR(delta) 모드, 하위 13비트=타일 수)
 + 허프만 테이블 정의 + MSB-first 비트스트림.
테이블 정의: [값바이트(>=0x80, 하위니블=니블값)] 이후 항목 반복
  항목=[b2: bit4-6=run-1, 하위니블=코드길이(1..8)][코드바이트: len비트 코드를 <<(8-len) 한 8비트 인덱스 기준으로 룩업 채움]
  b2>=0x80 이면 새 값바이트, 0xFF면 종료.
복호: 8비트 peek -> 테이블; >=0xFC면 escape(6비트 소비 후 7비트: 상위3=run-1, 하위4=니블값).
8니블=1 long(타일 한 줄), 8 long=1타일(32바이트). delta면 이전 줄과 XOR 누적.
"""
import sys
class DecErr(Exception):pass
def decode(rom,off):
    p=off
    hdr=(rom[p]<<8)|rom[p+1];p+=2
    delta=bool(hdr&0x8000)
    ntile=hdr&0x1fff
    nlong=ntile*8
    if nlong==0:raise DecErr('zero')
    tab=[None]*256
    b=rom[p];p+=1
    if b<0x80:raise DecErr('first byte')
    while True:
        b2=rom[p];p+=1
        if b2>=0x80:
            if b2==0xff:break
            b=b2;continue
        val=b&0xf; run=(b2&0x70)>>4; ln=b2&0xf
        if ln<1 or ln>8: raise DecErr('len')
        code=rom[p];p+=1
        base=(code<<(8-ln))&0xff
        for i in range(1<<(8-ln)):
            tab[base+i]=(ln,run,val)
    bits=0;nb=0
    def need(n):
        nonlocal bits,nb,p
        while nb<n:
            if p>=len(rom):raise DecErr('eof')
            bits=(bits<<8)|rom[p];p+=1;nb+=8
    def peek(n):
        need(n);return (bits>>(nb-n))&((1<<n)-1)
    def eat(n):
        nonlocal bits,nb
        need(n);nb-=n;bits&=(1<<nb)-1
    out=bytearray();d4=0;d3=8;d2=0;cnt=0
    while cnt<nlong:
        idx=peek(8)
        if idx>=0xfc:
            eat(6);v=peek(7);eat(7);run=v>>4;val=v&0xf
        else:
            e=tab[idx]
            if e is None:raise DecErr('undef code')
            ln,run,val=e;eat(ln)
        for _ in range(run+1):
            d4=(d4<<4)|val;d3-=1
            if d3==0:
                if delta:d2^=d4;w=d2
                else:w=d4
                out+=w.to_bytes(4,'big');cnt+=1
                d4=0;d3=8
                if cnt>=nlong:break
    return bytes(out),p,delta,ntile
if __name__=='__main__':
    rom=open('rom/danpei.gen','rb').read()
    o=int(sys.argv[1],16)
    t,e,dl,n=decode(rom,o);print(len(t),hex(e),dl,n)
