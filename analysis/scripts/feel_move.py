# 조작감 오라클 측정(원작 에뮬): 걷기 시작/정지 지연, 방향 전환, 대각선, 대시(유지·제동·더블탭 윈도), 점프(이륙 지연·공중 속도).
# 실행(프로젝트 루트): python -I analysis/scripts/feel_move.py [시나리오...]   결과는 analysis/21_game_feel.md
import sys; sys.path.insert(0, "analysis/scripts")
from drv import *

def fresh():
    return load('ctrl0')

def rec(md, pads, a=0xC000):
    out = []
    for m in pads:
        md.pad = [m, 0]; md.run_frame()
        d = odump(md, a); d['f3'] = peekb(md, a + 3); d['anim'] = ramw(md, a + 6); out.append(d)
    return out

r2 = lambda v: round(v, 3)
def show(name, o, keys=('vx', 'vy'), step=1, n=None):
    print(name)
    for k in keys:
        print('  ', k, [r2(x[k]) if isinstance(x[k], float) else x[k] for x in o[:n:step]])

SC = {}
def sc(f): SC[f.__name__] = f; return f

@sc
def consts():
    md = fresh()
    print('E200 gravity', hex(raml(md, 0xE200)), 'E224 dashAccBase', hex(raml(md, 0xE224)), 'E22C friction', hex(raml(md, 0xE22C)), 'E22A bounceShift', ramw(md, 0xE22A))
    print('stats s0..s7', [ramw(md, 0xC040 + 2 * i) for i in range(8)], 'bounds E256..', [ramw(md, 0xE256 + 2 * i) for i in range(4)])

@sc
def walk():
    show('WALK L 6f, release 4f, R 5f (start/stop/reverse)', rec(fresh(), [L] * 6 + [0] * 4 + [R] * 5), ('vx', 'x', 'anim'))
    show('WALK diag U|L 5f', rec(fresh(), [U | L] * 5), ('vx', 'vy'))
    show('WALK U 3f then D 3f', rec(fresh(), [U] * 3 + [D] * 3), ('vy',))

@sc
def dash():
    o = rec(fresh(), [L] * 2 + [0] * 3 + [L] * 2 + [0] * 45)
    show('DASH L double-tap then no input 45f (does it keep running?)', o, ('vx', 'sub', 'f3', 'type'), 1)
    o = rec(fresh(), [L] * 2 + [0] * 3 + [L] * 2 + [0] * 28 + [U] * 30)
    show('DASH L then U at +28 (brake)', o[30:], ('vx', 'vy', 'sub'))
    o = rec(fresh(), [L] * 2 + [0] * 3 + [L] * 30 + [R] * 30)
    show('DASH L hold then R (reverse)', o[30:], ('vx', 'sub'))
    o = rec(fresh(), [U] * 2 + [0] * 3 + [U] * 20)
    show('double-tap UP (dash on vertical?)', o, ('vy', 'sub'))

@sc
def tapwin():
    for gap in (10, 13, 14, 15, 16, 17):
        o = rec(fresh(), [L] * 1 + [0] * gap + [L] * 4)
        print('double-tap gap', gap, 'sub', [x['sub'] for x in o[-4:]])

@sc
def jump():
    o = rec(fresh(), [C] + [0] * 45)
    show('JUMP stand', o, ('z', 'vz', 'sub'), 1, 6)
    print('   air frames', sum(1 for x in o if x['z'] > 0), 'zmax', max(x['z'] for x in o), 'land sub seq', [x['sub'] for x in o[38:45]])
    o = rec(fresh(), [L] * 5 + [L | C] + [L] * 45)
    show('JUMP while walking L (air vx, landing)', o, ('vx', 'z'), 1, 12); show('   ...landing', o[40:], ('vx', 'z', 'sub'))
    o = rec(fresh(), [C] + [0] * 5 + [L] * 40)
    show('JUMP then L in air (air control?)', o, ('vx', 'f3'), 3)
    o = rec(fresh(), [L] * 2 + [0] * 3 + [L] * 2 + [0] * 26 + [C] + [0] * 60)
    show('DASH JUMP', o[32:], ('vx', 'vz', 'z', 'sub', 'f3'), 4)
    print('   zmax', max(x['z'] for x in o), 'air frames', sum(1 for x in o if x['z'] > 0))

@sc
def stance():
    o = rec(fresh(), [B] + [0] * 16); show('B catch stance', o, ('sub', 'tmr', 'hb', 'anim'))
    o = rec(fresh(), [B] * 30); show('B held 30f (repeat?)', o, ('sub', 'tmr'))
    o = rec(fresh(), [B] + [L] * 14); show('B then L (move cancel?)', o, ('sub', 'vx'))
    o = rec(fresh(), [C] + [0] * 6 + [B] + [0] * 40); show('air B (air catch?)', o, ('sub', 'tmr', 'z'), 2)
    o = rec(fresh(), [A] + [0] * 34); show('A crouch', o, ('sub', 'tmr', 'hb'), 2)

if __name__ == '__main__':
    for n in (sys.argv[1:] or list(SC)):
        SC[n](); sys.stdout.flush()
