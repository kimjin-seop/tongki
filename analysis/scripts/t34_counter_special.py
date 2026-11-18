# 받아치기 필살(공 $76, ROM 0x8C08) 자연 재현 (analysis/06 §3.3 의 [미확인: 자연 조건 재현] 항목)
# 실행(cwd = 프로젝트 루트):
#   python -I analysis/scripts/t34_counter_special.py cpu <대기 프레임 시작> <끝> [최대f=260]
#       상태 ctrl0, 왼쪽 p0 에게 공을 주고(poke: 하네스 give_ball 과 같은 조작) 대기 k 프레임 뒤 패드 입력만으로 필살 슛(C 점프 -> 공중 B 15프레임)을 던진다.
#       컴퓨터(오른쪽)가 그 공을 잡은 뒤 무엇을 던지는지 본다. $E694(강제 ID)·$76·$40 은 건드리지 않는다.
#   python -I analysis/scripts/t34_counter_special.py human <대기 k> <B 시작 프레임 from> <to> [캐치 뒤 B 지연=20] [jump]
#       위 cpu 실행에서 컴퓨터가 받아친 필살 슛이 날아오는 동안, 왼쪽(사람) 활성 선수가 패드 B(캐치 자세)로 잡고 다시 패드 B 로 지상 투구한다. 조작은 패드뿐.
#       jump = 캐치 뒤 C 로 점프한 다음 공중에서 B(대조군: 점프하면 창이 지워져 일반 슛)
import sys, pickle
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'analysis/scripts'); sys.path.insert(0, 'tools/diff')
import oracle_trace as ot
from drv import load, ramw, raml, peekb, s32

B, C = 16, 32
BALL = 0xC700
SCRIPT = [(3, 0), (2, C), (8, 0), (15, B | C), (2, 0)]   # t_special.py 와 같은 입력: 점프 -> 공중 B 15프레임 -> 뗌


def typ(md, a): return ramw(md, a) & 0x7ffc
def pidx(a): return (a - 0xC000) // 0x80 if 0xC000 <= a < 0xC700 else -1


def bstate(md):
    return (typ(md, BALL), ramw(md, BALL + 0x14), ramw(md, BALL + 0x1A), peekb(md, BALL + 0x76), ramw(md, BALL + 0x1C), peekb(md, BALL + 3) & 0x40)


def describe(md, f):
    t, tag, pw, f76, own, dg = bstate(md)
    o = pidx(own)
    extra = ''
    if o >= 0:
        a = 0xC000 + o * 0x80
        extra = ' 보유자 p%d(side %x slot %d type %x sub %x 공중 %d)' % (o, ramw(md, a + 0x52), ramw(md, a + 0x1A), typ(md, a), peekb(md, a + 0x17), (peekb(md, a + 3) >> 2) & 1)
    return 'f%d 공 type=%02x tag($14)=%d 위력=%d $76=%d $40=%d $42=%d $3E=%d 속력$74=%04x 위험=%d E694=%d E680=%d%s' % (
        f, t, tag, pw, f76, ramw(md, BALL + 0x40), ramw(md, BALL + 0x42), ramw(md, BALL + 0x3E), ramw(md, BALL + 0x74), 1 if dg else 0, ramw(md, 0xE694), peekb(md, 0xE680), extra)


def start(k):
    md = load('ctrl0'); md.hook = None
    ot.to_sync(md)
    ot.su_give_ball(md, '0')
    for _ in range(k): ot.frame(md, 0)
    f = 0
    for n, m in SCRIPT:
        for _ in range(n):
            ot.frame(md, m); f += 1
    return md, f


def run_cpu(k, nf):
    md, f = start(k)
    print('--- 대기 %d: 투구 직후 %s' % (k, describe(md, f)))
    last = bstate(md); catchf = None; res = '?'
    while f < nf:
        ot.frame(md, 0); f += 1
        s = bstate(md)
        if s[0] != last[0] or s[3] != last[3]:
            print('   ' + describe(md, f))
            if s[0] == 4 and last[0] == 0x90: catchf = f
            if catchf and last[0] == 4 and s[0] in (0x14, 0x90, 0x18):
                res = '캐치 f%d -> %d프레임 뒤 %s' % (catchf, f - catchf, {0x14: '일반 슛', 0x90: '필살 슛 tag %d 위력(다음 프레임에 표값)' % s[1], 0x18: '패스'}[s[0]])
                if s[0] == 0x90:
                    ot.frame(md, 0); f += 1
                    print('   ' + describe(md, f))
                    res += ' -> 위력 %d' % ramw(md, BALL + 0x1A)
                break
        last = s
    print('=== 대기 %d 결과: %s' % (k, res if catchf else '컴퓨터가 잡지 않음'))
    return md, f


def run_human(k, b0, b1, delay, jump):
    md0, f0 = start(k)
    # 컴퓨터가 잡고 받아칠 때까지 무입력으로 진행
    last = bstate(md0); f = f0; thrown = False
    while f < 300:
        ot.frame(md0, 0); f += 1
        s = bstate(md0)
        if last[0] == 4 and s[0] == 0x90 and ramw(md0, BALL + 0x52) != 0xE700: thrown = True; break
        last = s
    if not thrown: print('컴퓨터의 받아치기 필살이 나오지 않는 대기 값'); return
    print('컴퓨터 받아치기 필살: ' + describe(md0, f))
    base = pickle.dumps(md0)
    for bs in range(b0, b1 + 1):
        md = pickle.loads(base); g = f; caught = None; out = None; last = bstate(md); jf = None
        for i in range(160):
            pad = 0
            if caught is None:
                if i >= bs: pad = B if ((i - bs) & 3) < 2 else 0     # 캐치 자세(B): 2프레임 누르고 2프레임 뗌을 되풀이
            else:
                d = g - caught
                if jump:
                    if d in (delay, delay + 1): pad = C
                    elif d in (delay + 6, delay + 7): pad = B | C
                elif d in (delay, delay + 1): pad = B
            ot.frame(md, pad); g += 1
            s = bstate(md)
            if s[0] != last[0] or s[3] != last[3]:
                print('   [B 시작 +%d] %s' % (bs, describe(md, g)))
                if caught is None and s[0] == 4 and ramw(md, s[4] + 0x52) == 0xE700: caught = g
                elif caught is None and s[0] not in (0x90,): out = '못 잡음(공 type %02x)' % s[0]; break
                elif caught is not None and last[0] == 4 and s[0] in (0x14, 0x90, 0x18):
                    out = '캐치 f%d -> %d프레임 뒤 %s' % (caught, g - caught, {0x14: '일반 슛', 0x90: '필살 슛 tag %d' % s[1], 0x18: '패스'}[s[0]])
                    if s[0] == 0x90:
                        ot.frame(md, 0); g += 1
                        print('   [B 시작 +%d] %s' % (bs, describe(md, g)))
                        out += ' -> 위력 %d' % ramw(md, BALL + 0x1A)
                    break
            last = s
        print('=== 사람 캐치 B 시작 +%d (캐치 뒤 %s 지연 %d): %s' % (bs, '점프+B' if jump else '지상 B', delay, out))


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'cpu':
        k0, k1 = int(sys.argv[2]), int(sys.argv[3]); nf = int(sys.argv[4]) if len(sys.argv) > 4 else 260
        for k in range(k0, k1 + 1): run_cpu(k, nf)
    else:
        k = int(sys.argv[2]); b0, b1 = int(sys.argv[3]), int(sys.argv[4])
        delay = int(sys.argv[5]) if len(sys.argv) > 5 else 20
        run_human(k, b0, b1, delay, len(sys.argv) > 6 and sys.argv[6] == 'jump')
