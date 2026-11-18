# ROM 자체 1바이트 문자코드(0x21C0) 디코더 + 단어 검색. 사용: python -I analysis/scripts/romtext.py <단어...>
import sys; sys.stdout.reconfigure(encoding='utf-8')
R=open('rom/danpei.gen','rb').read()
hira="あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"
kata="アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン"
T={}
for i,c in enumerate(hira): T[0x60+i]=c
for i,c in enumerate(kata): T[0x97+i]=c
for i,c in enumerate("ァィゥェォッャュョ"): T[0xc5+i]=c
T.update({0x93:'っ',0x94:'ゃ',0x95:'ゅ',0x96:'ょ'})
DV=dict(zip("かきくけこさしすせそたちつてとはひふへほ","がぎぐげござじずぜぞだぢづでどばびぶべぼ")); DV.update({chr(ord(k)+96):chr(ord(v)+96) for k,v in list(DV.items())}); DV['ウ']='ヴ'
DP=dict(zip("はひふへほ","ぱぴぷぺぽ")); DP.update({chr(ord(k)+96):chr(ord(v)+96) for k,v in list(DP.items())})
def conv(b):
    if b<0x20:
        if b==0x1D: return 'ー'
        if b in (0x1E,0x1F): return None
        if b==0x13: return DV.get(T.get(0x99),'?')
        return None
    d=b-0x20
    if d<0x40: return chr(b) if 0x20<=b<0x7f else None
    d-=0x40; base=0x40
    if d>=0x50: d-=0x50; base=0x77
    k=0
    if d>=0x37:
        k=1
        if d<0x46: pass
        elif d<0x4B: d+=5
        else: k=2
        d-=0x32
    t=d+base+0x20
    c=T.get(t)
    if c is None: return None
    if k==1: return DV.get(c)
    if k==2: return DP.get(c)
    return c
ENC={}
for b in range(256):
    c=conv(b)
    if c and c not in ENC: ENC[c]=b
def enc(s): return bytes(ENC[c] for c in s)
def dec(bs): return ''.join(conv(b) or '·' for b in bs)
if __name__=='__main__':
    for w in sys.argv[1:]:
        try: e=enc(w)
        except KeyError as k: print(w,'encode fail',k); continue
        i=R.find(e); hits=[]
        while i>=0: hits.append(i); i=R.find(e,i+1)
        print(w,e.hex(),[hex(h) for h in hits][:20])
        for h in hits[:6]: print('   ',hex(h),dec(R[h-24:h+40]))
