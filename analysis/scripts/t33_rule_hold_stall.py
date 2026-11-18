# こうしき TIME UP(0x28)·PLAY OFF(0x2C) 구간에 공 방치 카운터($E25E)·공 서브($C716/17)·30프레임 전환·강제 회수(타입 0x44)가 진행되는지 원작 실행으로 확인
# 실행(cwd = 프로젝트 루트): python -I analysis/scripts/t33_rule_hold_stall.py [시계 초=2] [프레임=700] [poke: 정지 구간에서 공이 서브4 가 된 뒤 $E25E 에 더할 값=0]
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'analysis/scripts')
from drv import *
sec = int(sys.argv[1]) if len(sys.argv) > 1 else 2
nf = int(sys.argv[2]) if len(sys.argv) > 2 else 700
add = int(sys.argv[3]) if len(sys.argv) > 3 else 0
md = load('play0'); pokeb(md, 0xE680, 1); md.ram[0xE684:0xE688] = bytes([0, sec // 10, sec % 10, 0])
def types(): return tuple(ramw(md, 0xC000 + i * 0x80) & 0x7fff for i in range(14))
def ppos(): return bytes(b for i in range(14) for b in md.ram[0xC000 + i * 0x80 + 0x20:0xC000 + i * 0x80 + 0x2C])
def bsub(): return ramw(md, 0xC716) & 0x7c
last = None; lt = types(); lsub = None; poked = False; seg = None
def endseg():
    if seg: print('  -- 상태 %x 요약: %d프레임, E25E %d -> %d (증가한 프레임 %d), 공 서브4 프레임 %d, 서브8 프레임 %d, 공 좌표 변화 %d, 선수 좌표 변화 %d, 선수 타입 변화 %d' % tuple(seg))
for f in range(1, nf + 1):
    c0 = ramw(md, 0xE25E); b0 = bytes(md.ram[0xC720:0xC72C]); p0 = ppos()
    md.pad = [0, 0]; md.run_frame()
    st = ramw(md, 0xE602) & 0x7fff; c1 = ramw(md, 0xE25E); sub = bsub(); t = types()
    if st != last:
        endseg()
        print('f%d E602=%x 남은 인원 %d-%d 시계=%s 공 서브=%x 타이머=%d E25E=%d' % (f, st, peekb(md, 0xE757), peekb(md, 0xE7D7), bytes(md.ram[0xE684:0xE688]).hex(), sub, ramw(md, 0xC718), c1))
        last = st; seg = [st, 0, c1, c1, 0, 0, 0, 0, 0, 0]
    seg[1] += 1; seg[3] = c1; seg[4] += c1 > c0; seg[5] += sub == 4; seg[6] += sub == 8; seg[7] += bytes(md.ram[0xC720:0xC72C]) != b0; seg[8] += ppos() != p0; seg[9] += t != lt
    if sub != lsub: print('  f%d [상태 %x] 공 서브 %s -> %x, E25E=%d, 공 xyz=%d,%d,%d' % (f, st, lsub if lsub is None else '%x' % lsub, sub, c1, ramw(md, 0xC720), ramw(md, 0xC724), ramw(md, 0xC728))); lsub = sub
    if t != lt:
        print('  f%d [상태 %x] 선수 타입 변화: %s (E25E=%d)' % (f, st, ', '.join('#%d %x->%x' % (i, lt[i], t[i]) for i in range(14) if lt[i] != t[i]), c1)); lt = t
    if add and not poked and st in (0x28, 0x2C) and sub == 4 and c1 > 5:
        pokew(md, 0xE25E, c1 + add); poked = True; print('  f%d [상태 %x] poke: E25E %d -> %d' % (f, st, c1, c1 + add))
endseg()
