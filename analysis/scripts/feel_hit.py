# 타격감 오라클 측정(원작 에뮬): 지상 투구가 상대에 닿을 때의 히트스톱·화면 흔들림·팔레트 번쩍임·효과음·피격 포물선·이펙트 오브젝트.
# 실행(프로젝트 루트): python -I analysis/scripts/feel_hit.py [대기프레임 k] [특수ID(-1=일반)]   결과는 analysis/21_game_feel.md
import sys; sys.path.insert(0, "analysis/scripts")
from drv import *

def run(k=0, special=-1, n=150):
    md = load('ctrl0')
    for _ in range(k): md.pad = [0, 0]; md.run_frame()
    pokew(md, 0xC700, 4); pokeb(md, 0xC703, peekb(md, 0xC703) | 0x10); pokew(md, 0xC71C, 0xC000)
    pokeb(md, 0xC003, peekb(md, 0xC003) | 0x10); pokeb(md, 0xE756, 1); pokeb(md, 0xE716, 1); pokew(md, 0xC752, 0xE700)
    script = [(1, B)]
    if special >= 0:
        pokew(md, 0xE694, special); script = [(3, 0), (2, 32), (8, 0), (1, 48), (14, 48), (2, 0)]
    snd = []
    fr = [0]
    def hook(m, pc):
        if pc == 0x16b6: snd.append((fr[0], m.d[0] & 0xFF))
    md.hook = hook
    cr0 = None; last = {}; hp0 = [ramw(md, 0xC000 + i * 0x80 + 0x40) for i in range(14)]
    prevclk = None
    for cnt, m in script + [(n, 0)]:
        for _ in range(cnt):
            fr[0] += 1; f = fr[0]
            md.pad = [m, 0]; md.run_frame()
            v = md.vdp
            if cr0 is None: cr0 = list(v.cram)
            b = odump(md, 0xC700)
            hs = (v.vram[(v.reg[13] & 0x3F) << 10] << 8) | v.vram[((v.reg[13] & 0x3F) << 10) + 1]
            line = ['f%d' % f, 'ball %02x/%02x p=(%.1f,%.1f,%.1f) v=(%.2f,%.2f,%.2f)' % (b['type'] & 0x7FFC, b['sub'], b['x'], b['y'], b['z'], b['vx'], b['vy'], b['vz'])]
            ch = []
            for i in range(32):
                a = 0xC000 + i * 0x80
                if a == 0xC700: continue
                t = (ramw(md, a) & 0x7FFC, peekb(md, a + 0x17) & 0x7C, ramw(md, a + 6))
                if last.get(i) != t:
                    o = odump(md, a)
                    ch.append('obj%d %02x/%02x anim%02x p=(%.1f,%.1f,%.1f) v=(%.2f,%.2f,%.2f) tmr%d' % (i, t[0], t[1], t[2], o['x'], o['y'], o['z'], o['vx'], o['vy'], o['vz'], o['tmr']))
                    last[i] = t
            hp = [ramw(md, 0xC000 + i * 0x80 + 0x40) for i in range(14)]
            if hp != hp0: ch.append('HP ' + str([(i, hp0[i], hp[i]) for i in range(14) if hp[i] != hp0[i]])); hp0 = hp
            cd = sum(1 for x, y in zip(v.cram, cr0) if x != y)
            clk = (peekb(md, 0xE685), peekb(md, 0xE686), peekb(md, 0xE687))
            fx = 'cam %d hs %d vs %d,%d cramdiff %d clk %s%s' % (ramw(md, 0xE00A), hs, v.vsram[0], v.vsram[1], cd, clk, ' CLOCK-STALL' if clk == prevclk else '')
            prevclk = clk
            s = [hex(x[1]) for x in snd if x[0] == f]
            if ch or s or cd or f < 3: print(' | '.join(line + [fx] + (['SND ' + ','.join(s)] if s else [])) + ''.join('\n      ' + c for c in ch), flush=True)
            # 피격 대상 궤적: 타입 0x3C/0x40 인 선수는 매 프레임 표시
            for i in range(14):
                a = 0xC000 + i * 0x80
                if (ramw(md, a) & 0x7FFC) in (0x3C, 0x40) and not ch:
                    o = odump(md, a); print('      f%d obj%d %02x p=(%.1f,%.1f,%.1f) v=(%.2f,%.2f,%.2f) tmr%d %s' % (f, i, o['type'] & 0x7FFC, o['x'], o['y'], o['z'], o['vx'], o['vy'], o['vz'], o['tmr'], fx), flush=True)

if __name__ == '__main__':
    run(int(sys.argv[1]) if len(sys.argv) > 1 else 0, int(sys.argv[2]) if len(sys.argv) > 2 else -1)
