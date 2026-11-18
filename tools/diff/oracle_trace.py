# 원작 트레이서: 원작 에뮬(analysis/scripts/m68k.py)에 입력열을 프레임마다 주입하고 상태를 JSON 으로 덤프한다.
# 실행: python -I tools/diff/oracle_trace.py [시나리오명 ...] [--force] [--verify]
# 출력: tools/diff/traces/oracle/<이름>.json  (입력열·setup 이 같으면 건너뜀, --force 로 재생성)
#
# 프레임 경계: m68k.MD.run_frame() 의 끝(VBlank 후 1500명령)은 게임 로직 도중이다(선수 0~4 는 새 프레임, 5~13·공은 이전 프레임).
# 그래서 여기서는 "메인 루프가 VBlank 대기 루프(PC 0x14E2/0x14E6)에 들어간 시점"을 프레임 경계로 쓴다(전 객체가 같은 프레임).
import sys, os, json, time, pickle
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, 'analysis', 'scripts'))
from drv import load, ramw, raml, peekb, pokew, pokeb, s32  # noqa: E402

HERE = os.path.join(ROOT, 'tools', 'diff')
OUT = os.path.join(HERE, 'traces', 'oracle')
KEY = dict(U=1, D=2, L=4, R=8, B=16, C=32, A=64, S=128)
WAIT_PCS = (0x14E2, 0x14E6)   # 메인 루프의 VBlank 대기
VBL_LEN = 1500                # run_frame 과 같은 VBlank 플래그 유지 길이(명령 수)
FRAME_CAP = 14000             # run_frame 의 프레임당 명령 수. 넘기면 처리 지연(lag)으로 기록


def parse_pads(s):
    out = []
    for tok in (s or '').split():
        keys, n = tok.split(':')
        m = 0
        for ch in keys:
            if ch != '-': m |= KEY[ch]
        out += [m] * int(n)
    return out


def to_sync(md, cap=FRAME_CAP):
    """대기 루프에 들어갈 때까지 실행. 반환 = 실행 명령 수(-1 = cap 초과)"""
    n = 0
    while n < cap:
        if md.pc in WAIT_PCS: return n
        md.step(); n += 1
    return -1


def frame(md, p1, p2=0):
    """대기 루프 -> VBlank 인터럽트 -> 한 프레임 로직 -> 다시 대기 루프. 반환 = 명령 수(-1 = lag)"""
    md.pad = [p1, p2]
    vd = md.vdp
    vd.vblank = True
    if md.intmask < 6: md.interrupt(6, 30)
    n = 0
    while n < VBL_LEN:
        md.step(); n += 1
    vd.vblank = False
    while n < FRAME_CAP:
        if md.pc in WAIT_PCS:
            md.frame += 1
            return n
        md.step(); n += 1
    md.frame += 1
    return -1


def obj(md, k):
    a = 0xC000 + k * 0x80
    w = lambda o: ramw(md, a + o)
    l = lambda o: s32(raml(md, a + o))
    d = dict(k=k, type=w(0), f3=peekb(md, a + 3), hb=peekb(md, a + 4), anim=w(6), mir=peekb(md, a + 0x15),
             init=peekb(md, a + 0x16) >> 7, sub=peekb(md, a + 0x17), tmr=w(0x18), f1a=w(0x1A), own=w(0x1C),
             x=l(0x20), y=l(0x24), z=l(0x28), vx=l(0x30), vy=l(0x34), vz=l(0x38),
             plan=w(0x5E), tx=w(0x60), ty=w(0x62), f1e=peekb(md, a + 0x1E))  # plan=$5E(활성 두뇌 plan, bit15=초기화됨), tx/ty=$60/$62(대기점), f1e=$1E(쓸 수 없음 플래그)
    if k < 14:
        d['stat'] = [w(0x40 + 2 * i) for i in range(8)]  # s0 HP, s1 방어, s2 속도, s3 점프, s4 위력, s5 캐치, s6 투구, s7 패스
        d['side'] = w(0x52)
    else:
        d['tag'] = w(0x14)
        d['a70'] = w(0x70); d['a72'] = w(0x72); d['ctr'] = w(0x40)  # 마지막 투구 각도(번호·플래그), 받아치기 창
    return d


def snap(md, f, pad, n):
    return dict(f=f, pad=pad, n=n, o=[obj(md, k) for k in range(15)],  # 0~13 선수, 14 공
                rng=raml(md, 0xE620), rem=[peekb(md, 0xE757), peekb(md, 0xE7D7)],
                ctrl=[ramw(md, 0xE718), ramw(md, 0xE798)], e602=ramw(md, 0xE602),
                zone=[[peekb(md, 0xE75C), peekb(md, 0xE75D)], [peekb(md, 0xE7DC), peekb(md, 0xE7DD)]],  # 사이드별 공 구역 [직전 $5C, 현재 $5D]
                sball=[peekb(md, 0xE716), peekb(md, 0xE796)], e214=ramw(md, 0xE214), e25e=ramw(md, 0xE25E))  # 사이드 공 보유 플래그 $16, 패스 대상, 정지 공 방치 카운터


# ---- 사전 조작(시나리오 setup). 새 조작은 여기에 함수로 추가한다. 인자는 "이름:값,값" 형태 ----
def su_give_ball(md, k='0'):
    """선수 obj k(기본 0, 좌팀)에게 공 지급 (analysis/scripts/audit_throw.py 와 같은 조작, obj0 에서만 검증됨)"""
    a = 0xC000 + int(k) * 0x80
    side = ramw(md, a + 0x52)
    pokew(md, 0xC700, 4); pokeb(md, 0xC703, peekb(md, 0xC703) | 0x10); pokew(md, 0xC71C, a)
    pokeb(md, a + 3, peekb(md, a + 3) | 0x10); pokeb(md, side + 0x56, 1); pokeb(md, side + 0x16, 1)
    pokew(md, 0xC752, side)
    for off in range(0x30, 0x3C, 2): pokew(md, 0xC700 + off, 0)  # 공 속도 0 (원작도 보유 첫 프레임에 0 으로 만든다. 주입 시점 값을 맞추기 위함)


def su_pos(md, k, x, y):
    """선수 obj k 를 (x,y) px 로 이동"""
    a = 0xC000 + int(k) * 0x80
    for off, v in ((0x20, int(x)), (0x24, int(y))):
        pokew(md, a + off, v); pokew(md, a + off + 2, 0)


def su_hp(md, k, hp):
    pokew(md, 0xC000 + int(k) * 0x80 + 0x40, int(hp))


def su_poke(md, addr, val):
    """임의 RAM 바이트 쓰기(16진수)"""
    pokeb(md, int(addr, 16), int(val, 16))


def su_ball(md, x, y, z='0', vx='0', vy='0', vz='0'):
    """공을 바운스 공(타입 0x1C, 초기화 전)으로 배치. 좌표 px, 속도 px/f(실수). z=0·속도 0 이면 다음 프레임에 정지 공(서브4)이 된다 (analysis/scripts/feel_pickup.py place 와 같은 조작)"""
    b = 0xC700
    pokew(md, b, 0x1C); pokew(md, b + 0x16, 0); pokew(md, b + 0x1C, 0)
    for off, v in ((0x20, x), (0x24, y), (0x28, z), (0x30, vx), (0x34, vy), (0x38, vz)):
        iv = int(round(float(v) * 65536)) & 0xFFFFFFFF
        pokew(md, b + off, iv >> 16); pokew(md, b + off + 2, iv & 0xFFFF)


SETUP = dict(give_ball=su_give_ball, pos=su_pos, hp=su_hp, poke=su_poke, ball=su_ball)


def setup(md, ops):
    for op in ops or []:
        name, _, arg = op.partition(':')
        if name not in SETUP: raise SystemExit('unknown setup ' + op)
        SETUP[name](md, *([a for a in arg.split(',')] if arg else []))


def padlists(sc):
    p1 = parse_pads(sc['pads']); p2 = parse_pads(sc.get('pads2'))
    return p1, (p2 + [0] * len(p1))[:len(p1)]


def trace(sc, state):
    md = load(state)
    md.hook = None
    n0 = to_sync(md)
    if n0 < 0: raise SystemExit('초기 동기화 실패')
    setup(md, sc.get('setup'))
    p1, p2 = padlists(sc)
    init = snap(md, 0, 0, n0)
    frames, lag = [], 0
    for i, m in enumerate(p1):
        n = frame(md, m, p2[i])
        if n < 0: lag += 1
        frames.append(snap(md, i + 1, m, n))
    return dict(name=sc['name'], state=state, setup=sc.get('setup') or [], pads=p1, pads2=p2, lagFrames=lag, init=init, frames=frames)


def verify(sc, state):
    """프레임 경계 방식 검증: 표준 run_frame(14000명령, VBlank 12500) 뒤 대기 루프까지 진행한 RAM 과 이 트레이서의 RAM 을 프레임마다 비교"""
    if sc.get('setup'):
        print('verify %s: setup 이 있는 시나리오는 조작 시점이 달라 비교할 수 없음(건너뜀)' % sc['name']); return
    a = load(state); b = load(state); a.hook = b.hook = None
    to_sync(a)  # b 는 run_frame 경계(저장 상태 그대로)에서 시작
    p1, p2 = padlists(sc)
    bad = 0
    for i, m in enumerate(p1):
        frame(a, m, p2[i])
        b.pad = [m, p2[i]]; b.run_frame()
        c = pickle.loads(pickle.dumps(b))
        if to_sync(c) < 0: print('  f%d: run_frame 쪽 동기화 실패' % (i + 1)); bad += 1; continue
        ra, rc = bytes(a.ram[0xC000:0xE800]), bytes(c.ram[0xC000:0xE800])
        if ra != rc:
            bad += 1
            df = [0xC000 + j for j in range(len(ra)) if ra[j] != rc[j]]
            print('  f%d: RAM 차이 %d바이트, 처음 %s' % (i + 1, len(df), [hex(x) for x in df[:8]]))
    print('verify %s: %d프레임 중 불일치 %d' % (sc['name'], len(p1), bad))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    cfg = json.load(open(os.path.join(HERE, 'scenarios.json'), encoding='utf8'))
    os.makedirs(OUT, exist_ok=True)
    for sc in cfg['scenarios']:
        if args and sc['name'] not in args: continue
        if '--verify' in sys.argv:
            verify(sc, cfg['state']); continue
        path = os.path.join(OUT, sc['name'] + '.json')
        p1, p2 = padlists(sc)
        if os.path.exists(path) and not force:
            old = json.load(open(path, encoding='utf8'))
            if old.get('pads') == p1 and old.get('pads2') == p2 and old.get('setup') == (sc.get('setup') or []) and 'zone' in old.get('init', {}):
                print('skip', sc['name'], '(cache)'); continue
        t = time.time()
        tr = trace(sc, cfg['state'])
        json.dump(tr, open(path, 'w', encoding='utf8'), separators=(',', ':'))
        print('ok', sc['name'], '%df %.1fs lag=%d' % (len(p1), time.time() - t, tr['lagFrames']), flush=True)


if __name__ == '__main__':
    main()
