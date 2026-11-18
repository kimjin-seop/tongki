# 받아친 공의 차지($42/$3E) 구분 실험 (t34_counter_special.py 방식 재사용, 패드 입력만)
# 실행(cwd = 프로젝트 루트): python -I analysis/scripts/t34b_counter_charge.py <공중 B 프레임 수(차지)> <대기 k from> <to> [최대f=260]
#   왼쪽 p0 이 점프 뒤 공중 B 를 n 프레임 눌러 던진다(n=13 필살, n=10 일반). 컴퓨터가 잡아 다시 던질 때까지 공의 $42/$3E/$40/$76 을 매 변화마다 찍는다.
#   목적: 받아친 공의 $42 가 '15 고정'인지 '잡은 공의 값 유지'인지(ROM 0xA3E6: $76 이면 $3E=15, 아니면 $3E<-$42. 0x71C4: $42<-$3E)
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'analysis/scripts'); sys.path.insert(0, 'tools/diff')
import oracle_trace as ot
import t34_counter_special as t
from drv import load, ramw, peekb

B, C = 16, 32
n = int(sys.argv[1]); k0, k1 = int(sys.argv[2]), int(sys.argv[3]); nf = int(sys.argv[4]) if len(sys.argv) > 4 else 260
for k in range(k0, k1 + 1):
    md = load('ctrl0'); md.hook = None
    ot.to_sync(md); ot.su_give_ball(md, '0')
    for _ in range(k): ot.frame(md, 0)
    f = 0
    for cnt, m in [(3, 0), (2, C), (8, 0), (n, B | C), (2, 0)]:
        for _ in range(cnt): ot.frame(md, m); f += 1
    print('--- 차지 %d 대기 %d: 투구 직후 %s' % (n, k, t.describe(md, f)))
    key = lambda: (t.typ(md, 0xC700), peekb(md, 0xC776), ramw(md, 0xC742), ramw(md, 0xC73E), 1 if ramw(md, 0xC740) else 0)
    last = key(); caught = False
    while f < nf:
        ot.frame(md, 0); f += 1
        s = key()
        if s != last:
            print('   ' + t.describe(md, f))
            if s[0] == 4 and last[0] in (0x90, 0x14): caught = True
            elif caught and last[0] == 4 and s[0] in (0x14, 0x90, 0x18):
                ot.frame(md, 0); f += 1; print('   ' + t.describe(md, f)); break
        last = s
