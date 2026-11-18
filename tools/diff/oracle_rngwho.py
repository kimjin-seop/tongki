# 디버그: 원작에서 난수(0x14EA)를 부른 위치(복귀 주소)와 그때의 a0(오브젝트)를 프레임별로 출력한다.
# 실행: python -I tools/diff/oracle_rngwho.py <시나리오> <from> <to>
import sys, os, json
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import oracle_trace as ot  # noqa: E402  (chdir·sys.path 설정 포함)
from drv import load, raml  # noqa: E402

name, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
cfg = json.load(open(os.path.join(HERE, 'scenarios.json'), encoding='utf-8'))
sc = next(s for s in cfg['scenarios'] if s['name'] == name)
md = load(sc.get('state') or cfg['state'])
md.hook = None
ot.to_sync(md)
ot.setup(md, sc.get('setup'))
p1, p2 = ot.padlists(sc)
step0 = md.step
cur = [0]
def step():
    if md.pc == 0x14EA and a <= cur[0] <= b:
        print('f%d rng from %x a0=%x' % (cur[0], raml(md, md.a[7]) - 6, md.a[0] & 0xffff))
    step0()
md.step = step
for i, m in enumerate(p1):
    cur[0] = i + 1
    if cur[0] > b: break
    ot.frame(md, m, p2[i])
