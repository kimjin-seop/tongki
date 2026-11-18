# 줍기 오라클 측정(원작 에뮬): 정지 공 A/B 줍기 반경, 바운스 중인 공을 B(캐치 자세)/A 로 잡을 수 있는지, 높이 한계, 걷는 중·대시 중 줍기.
# 실행(프로젝트 루트): python -I analysis/scripts/feel_pickup.py [reach|bounce|misc]   결과는 analysis/21_game_feel.md
import sys; sys.path.insert(0, "analysis/scripts")
from drv import *

def pokel(md, a, v):
    v &= 0xFFFFFFFF
    for i in range(4): md.ram[(a + i) & 0xFFFF] = (v >> (24 - 8 * i)) & 255

def place(md, x, y, z=0.0, vx=0.0, vy=0.0, vz=0.0):
    """공을 바운스 타입(0x1C, 초기화 전)으로 배치. z=0,v=0 이면 다음 프레임에 정지(서브4, $1E=1)"""
    b = 0xC700
    pokew(md, b, 0x1C); pokew(md, b + 0x16, 0); pokew(md, b + 0x1C, 0)
    for k, v in ((0x20, x), (0x24, y), (0x28, z), (0x30, vx), (0x34, vy), (0x38, vz)): pokel(md, b + k, int(round(v * 65536)))

def me(md): return odump(md, 0xC000)
def held(md): return (ramw(md, 0xC700) & 0x7FFC) == 4 and ramw(md, 0xC71C) == 0xC000

def trial(pads, bx, by, bz=0.0, bv=(0, 0, 0), settle=3, n=24, pre=()):
    md = load('ctrl0')
    for m in pre: md.pad = [m, 0]; md.run_frame()
    p = me(md)
    place(md, p['x'] + bx, p['y'] + by, bz, *bv)
    for _ in range(settle): md.pad = [0, 0]; md.run_frame()
    log = []
    for i, m in enumerate(list(pads) + [0] * n):
        md.pad = [m, 0]; md.run_frame()
        p = me(md); b = odump(md, 0xC700)
        log.append((i, p['sub'], round(b['z'], 1), b['type'] & 0x7FFC, peekb(md, 0xC71E)))
        if held(md): return i, log, md
    return None, log, md

def reach():
    md = load('ctrl0'); place(md, 200, 128); md.pad = [0, 0]; md.run_frame(); md.run_frame()
    print('ball hb idx $4 =', peekb(md, 0xC704), 'stopped flag', peekb(md, 0xC71E), 'sub', ramw(md, 0xC716) & 0x7C)
    for key, nm in ((A, 'A'), (B, 'B')):
        for dx in (0, 16, 20, 22, 23, 24, 25, -22, -24, -25):
            r, log, _ = trial([key], dx, 0); print('stopped ball', nm, '1f tap dx', dx, 'dy 0 -> held at frame', r, 'subs', sorted(set(x[1] for x in log)), flush=True)
        for dy in (16, 17, 20, 21, -16, -17, -20, -21):
            r, log, _ = trial([key], 0, dy); print('stopped ball', nm, '1f tap dx 0 dy', dy, '-> held at frame', r, flush=True)

def bounce():
    # 선수 옆 8px 에서 z=50 으로 떨어지는 공. k 프레임 뒤 B(캐치 자세) 1프레임 탭
    for k in (0, 4, 8, 12, 16, 20, 24, 30, 40):
        r, log, _ = trial([0] * k + [B], 8, 0, 50.0, settle=0, n=14)
        print('bouncing ball, B tap at f%d' % k, '-> held at', r, 'ball z around press', [x[2] for x in log[k:k + 12]], 'p sub', [x[1] for x in log[k:k + 12]], flush=True)
    for k in (8, 20):
        r, log, _ = trial([0] * k + [A], 8, 0, 50.0, settle=0, n=40)
        print('bouncing ball, A tap at f%d' % k, '-> held at', r, 'p subs', sorted(set(x[1] for x in log)), flush=True)
    # 굴러오는(낮게 튀는) 공: vx 로 다가오는 공을 B 로
    r, log, _ = trial([0] * 6 + [B], 60, 0, 10.0, (-3.0, 0, 0), settle=0, n=20)
    print('incoming low bounce vx=-3, B at f6 -> held at', r, [(x[2], x[3]) for x in log[6:20]], flush=True)
    # 점프 중 B(공중 캐치): 머리 위 높은 공
    r, log, _ = trial([C] + [0] * 10 + [B], 4, 0, 90.0, settle=0, n=20)
    print('jump then B at f11 for high ball(z0=90) -> held at', r, [(x[1], x[2]) for x in log[8:26]], flush=True)

def misc():
    r, log, md = trial([A] * 30, 10, 0); print('A held 30f near stopped ball -> held at', r)
    r, log, md = trial([L | A] + [L] * 20, -12, 0, pre=[L] * 4); p = me(md); print('walking L then A(1f) with L kept held, ball 12px ahead -> held at', r, 'p vx during', p['vx'], 'subs', [x[1] for x in log][:18])
    r, log, md = trial([A], -40, 0, pre=[L] * 2 + [0] * 3 + [L] * 10); print('dashing L, A tap with ball 40px ahead (settle 3f ~9px) -> held at', r, 'subs', [x[1] for x in log][:18], 'x', me(md)['x'])
    r, log, md = trial([0] * 200, 0, 0, n=0); print('standing on stopped ball 200f no key -> held at', r)
    r, log, md = trial([L] * 30, -20, 0, n=0); print('walk over stopped ball no key -> held at', r)

if __name__ == '__main__':
    for n in (sys.argv[1:] or ['reach', 'bounce', 'misc']): globals()[n]()
