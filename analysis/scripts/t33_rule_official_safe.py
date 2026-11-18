# こうしき($E680=1) 피격 뒤 공을 '바닥에 닿기 전에' 잡았을 때의 $6D(유예 표시)·아웃 여부 확인 (analysis/29 §3-4 의 판독만 항목)
# 실행(cwd = 프로젝트 루트): python -I analysis/scripts/t33_rule_official_safe.py <safe|enemy|floor> [최대f=460] [B 시작 지연=0] [시드 바이트 $E622(16진, enemy/floor 만)]
#   safe  : 상태 play0. 컴퓨터(오른쪽)가 던진 공에 왼쪽 선수가 맞는다 -> 왼쪽 활성 선수를 공 자리로 옮겨(poke) 캐치 자세(B)로 바닥 전에 잡는다 = 같은 편 캐치
#   enemy : 상태 ctrl0(차분 하네스 기준 상태). 왼쪽 p0 에게 공을 주고(poke) B 로 던져 오른쪽 선수를 맞힌다 -> 왼쪽 활성 선수를 공 자리로 옮겨 바닥 전에 잡는다 = 상대(던진 쪽) 캐치
#   floor : enemy 와 같은 투구, 잡지 않고 둔다(대조군: 바닥 -> 아웃)
# 조작은 좌표 poke + 패드 B 뿐이다. $6D·남은 인원·HP 는 건드리지 않는다.
import sys, os
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'analysis/scripts'); sys.path.insert(0, 'tools/diff')
import oracle_trace as ot
from drv import load, ramw, raml, peekb, pokew, pokeb, s32

case = sys.argv[1]; nf = int(sys.argv[2]) if len(sys.argv) > 2 else 460; delay = int(sys.argv[3]) if len(sys.argv) > 3 else 0
B = 16
md = load('play0' if case == 'safe' else 'ctrl0'); md.hook = None
ot.to_sync(md)
pokeb(md, 0xE680, 1)
if case != 'safe':
    ot.su_give_ball(md, '0')
    if len(sys.argv) > 4: pokeb(md, 0xE622, int(sys.argv[4], 16))   # 컴퓨터 방어 결정(난수)을 바꿔 '서기'가 나오는 시드를 고른다(짝수만)

def P(i): return 0xC000 + i * 0x80
def typ(a): return ramw(md, a) & 0x7ffc
def setpos(a, x, y):
    for off, v in ((0x20, x), (0x24, y)): pokew(md, a + off, v); pokew(md, a + off + 2, 0)

hit = None; hitf = 0; last = None; grabbed = None; floorf = None
for f in range(1, nf + 1):
    pad = 0
    if case != 'safe' and f in (2, 3): pad = B            # 지상 투구
    b = 0xC700
    if hit is not None and grabbed is None and case != 'floor' and f - hitf > delay:
        act = ramw(md, 0xE718)                              # 왼쪽 사이드 활성 선수
        if act != hit and typ(b) == 0x1C:
            setpos(act, ramw(md, b + 0x20), ramw(md, b + 0x24))
            pad = B if (f & 1) else 0                       # 캐치 자세 재진입용으로 한 프레임씩 눌렀다 뗌
    ot.frame(md, pad)
    if hit is None:
        for i in range(14):
            if peekb(md, P(i) + 0x6D) == 1 and typ(P(i)) == 0x3C:
                hit = P(i); hitf = f
                print('f%d 피격 p%d side=%x slot=%d hp=%d $6D=1 | 공 type=%x z=%.1f $3C=%x' % (f, i, ramw(md, hit + 0x52), ramw(md, hit + 0x1A), ramw(md, hit + 0x40), typ(b), s32(raml(md, b + 0x28)) / 65536, ramw(md, b + 0x3C)))
    else:
        bz = s32(raml(md, b + 0x28)) / 65536
        if floorf is None and grabbed is None and typ(b) == 0x1C and peekb(md, hit + 0x6D) == 0: floorf = f
        if grabbed is None and typ(b) == 4:
            grabbed = ramw(md, b + 0x1C)
            print('f%d 획득: 보유자 obj=%x side=%x (공 z=%.1f, 바닥 접촉 %s) | 맞은 선수 $6D=%d, 공 $3C=%x' % (f, grabbed, ramw(md, grabbed + 0x52), bz, '있음 f%d' % floorf if floorf else '없음', peekb(md, hit + 0x6D), ramw(md, b + 0x3C)))
        s = (typ(hit), peekb(md, hit + 0x6D), ramw(md, hit + 0x1A), ramw(md, hit + 0x40), peekb(md, 0xE757), peekb(md, 0xE7D7))
        if s != last:
            print('f%d 맞은 선수 type=%x $6D=%d slot=%d hp=%d | 남은 인원 %d-%d | 공 type=%x z=%.1f' % (f, *s, typ(b), bz)); last = s
        if typ(hit) not in (0x3C, 0x40) and f - hitf > 30: break
print('끝 f%d: 남은 인원 %d-%d, 맞은 선수 type=%x slot=%d hp=%d' % (f, peekb(md, 0xE757), peekb(md, 0xE7D7), typ(hit) if hit else 0, ramw(md, hit + 0x1A) if hit else -1, ramw(md, hit + 0x40) if hit else -1))
