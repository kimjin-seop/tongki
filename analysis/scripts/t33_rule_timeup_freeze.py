# こうしき 시간 종료(TIME UP 0x28 -> PLAY OFF 0x2C) 동안 선수 오브젝트($C000~$C6FF)와 공($C700)이 움직이는지 확인
# 실행(cwd = 프로젝트 루트): python -I analysis/scripts/t33_rule_timeup_freeze.py [프레임=620]
# 조작: play0 에 $E680=1, 시계 0:02 (t29_rule_timeup.py 의 E 경우와 같음: 인원 동수 -> PLAY OFF)
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'analysis/scripts')
from drv import *
nf = int(sys.argv[1]) if len(sys.argv) > 1 else 620
md = load('play0'); pokeb(md, 0xE680, 1); md.ram[0xE684:0xE688] = bytes([0, 0, 2, 0])
last = None; seg = None
def pos(): return bytes(b for i in range(14) for b in md.ram[0xC000 + i * 0x80 + 0x20:0xC000 + i * 0x80 + 0x2C])   # 선수 14명의 x,y,z
for f in range(1, nf + 1):
    p0 = pos(); b0 = bytes(md.ram[0xC720:0xC72C])
    md.pad = [0, 0]; md.run_frame()
    st = ramw(md, 0xE602) & 0x7fff
    if st != last:
        if seg: print('  상태 %x: %d프레임, 선수 좌표가 바뀐 프레임 %d, 공 좌표가 바뀐 프레임 %d' % (seg[0], seg[1], seg[2], seg[3]))
        print('f%d E602=%x 남은 인원 %d-%d 시계=%s e220=%d' % (f, st, peekb(md, 0xE757), peekb(md, 0xE7D7), bytes(md.ram[0xE684:0xE688]).hex(), peekb(md, 0xE220)))
        last = st; seg = [st, 0, 0, 0]
    seg[1] += 1; seg[2] += pos() != p0; seg[3] += bytes(md.ram[0xC720:0xC72C]) != b0
print('  상태 %x: %d프레임, 선수 좌표가 바뀐 프레임 %d, 공 좌표가 바뀐 프레임 %d' % (seg[0], seg[1], seg[2], seg[3]))
