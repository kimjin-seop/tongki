# 받아친 공의 차지($42) 확정 실험 2: t34b 와 같은 투구(패드 입력만) 뒤, 컴퓨터가 잡은 프레임에서 난수 시드 상위 워드($E622)만 바꿔 가며 컴퓨터의 받아치기 즉시 투구(0xD566)를 끌어낸다.
# 실행(cwd = 프로젝트 루트): python -I analysis/scripts/t34c_counter_charge_seed.py <공중 B 프레임 수(차지)> <대기 k> [시드 개수=16]
#   공 상태($3E/$40/$42/$76)는 건드리지 않는다. poke 는 시작 때 공 지급(하네스 give_ball), 캐치 프레임의 난수 시드, (선택) 잡은 선수 x 뿐.
import sys, pickle
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'analysis/scripts'); sys.path.insert(0, 'tools/diff')
import oracle_trace as ot
import t34_counter_special as t
from drv import load, ramw, peekb, pokew

B, C = 16, 32
n, k = int(sys.argv[1]), int(sys.argv[2]); ns = int(sys.argv[3]) if len(sys.argv) > 3 else 16
dx = int(sys.argv[4]) if len(sys.argv) > 4 else 0   # 캐치 프레임에 잡은 선수의 x 를 dx 만큼 옮긴다(밀려서 코트 밖으로 나가 라인 오버가 되는 것을 피하는 용도, 공 상태와 무관)
md = load('ctrl0'); md.hook = None
ot.to_sync(md); ot.su_give_ball(md, '0')
for _ in range(k): ot.frame(md, 0)
f = 0
for cnt, m in [(3, 0), (2, C), (8, 0), (n, B | C), (2, 0)]:
    for _ in range(cnt): ot.frame(md, m); f += 1
thrown = None
while f < 140:
    ot.frame(md, 0); f += 1
    ty = t.typ(md, 0xC700)
    if thrown is None and ty in (0x14, 0x90): thrown = t.describe(md, f)
    if thrown and ty == 4 and ramw(md, 0xC740): break
else:
    print('컴퓨터가 창을 열며 잡지 않음'); sys.exit()
print('투구: ' + thrown)
print('캐치: ' + t.describe(md, f))
if dx:
    a = ramw(md, 0xC71C); pokew(md, a + 0x20, ramw(md, a + 0x20) + dx)
base = pickle.dumps(md)
for i in range(ns):
    md = pickle.loads(base); g = f
    pokew(md, 0xE622, (0x1357 * (i + 1)) & 0xFFFE)
    for _ in range(110):
        ot.frame(md, 0); g += 1
        ty = t.typ(md, 0xC700)
        if ty != 4:
            ot.frame(md, 0); g += 1
            w = ramw(md, 0xC740)   # 투구(0x71BC)는 $40 을 지우지 않는다: 창 안에서 던진 공은 비행 중에도 $40 이 남는다
            print('  시드 #%d: %s%s' % (i, t.describe(md, g), '  <- 창 안 투구' if ty in (0x14, 0x90) and w else ''))
            break
