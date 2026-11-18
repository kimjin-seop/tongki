"""리그/특훈 코드 안 문자열 덤프. 사용: python -I analysis/scripts/t_lg_text.py <hex시작> <hex끝> ... (구간 원시 바이트를 ROM 문자코드로 해독)"""
import numpy, inspect
import sys; sys.path.insert(0,'analysis/scripts'); sys.stdout.reconfigure(encoding='utf-8')
from romtext import R,dec,conv
def show(a,b):
    bs=R[a:b]; print('%06x-%06x'%(a,b), bs.hex())
    print('   ', ''.join((conv(x) or ('[%02x]'%x)) for x in bs))
if __name__=='__main__':
    for i in range(1,len(sys.argv),2): show(int(sys.argv[i],16),int(sys.argv[i+1],16))
