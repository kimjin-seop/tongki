"""Z80 사운드 드라이버 디스어셈블러(선형). 드라이버 = ROM 0x7DE0C(0x105C 바이트) -> Z80 0x0000.
사용: python -I analysis/scripts/z80dis.py [시작 hex=0] [끝 hex=105C] > out.asm
      (rom/danpei.gen 필요. 데이터 영역도 그대로 명령으로 풀리므로 읽을 때 주의)
"""
import sys

R = ['b', 'c', 'd', 'e', 'h', 'l', '(hl)', 'a']
RP = ['bc', 'de', 'hl', 'sp']
RP2 = ['bc', 'de', 'hl', 'af']
CC = ['nz', 'z', 'nc', 'c', 'po', 'pe', 'p', 'm']
ALU = ['add a,', 'adc a,', 'sub ', 'sbc a,', 'and ', 'xor ', 'or ', 'cp ']
ROT = ['rlc', 'rrc', 'rl', 'rr', 'sla', 'sra', 'sll', 'srl']


def dis(mem, pc):
    """반환 (다음 pc, 문자열)"""
    p = pc
    def b():
        nonlocal p
        v = mem[p & 0xFFFF]; p += 1; return v
    def w():
        lo = b(); return lo | (b() << 8)
    def s8():
        v = b(); return v - 256 if v > 127 else v
    op = b(); ix = None
    while op in (0xDD, 0xFD):
        ix = 'ix' if op == 0xDD else 'iy'; op = b()
    disp = None

    def body():
        nonlocal disp
        def m():
            nonlocal disp
            if ix:
                if disp is None:
                    disp = s8()
                return '(%s%+d)' % (ix, disp)
            return '(hl)'
        def r(i, mem_ok=True):
            if i == 6:
                return m()
            if ix and i in (4, 5):
                return ix + 'hl'[i - 4]
            return R[i]
        def rp(i):
            return ix if (ix and i == 2) else RP[i]
        def rp2(i):
            return ix if (ix and i == 2) else RP2[i]
        x, y, z = op >> 6, (op >> 3) & 7, op & 7
        pp, q = y >> 1, y & 1
        if op == 0xCB:
            if ix:
                disp = s8()
            o2 = b(); x2, y2, z2 = o2 >> 6, (o2 >> 3) & 7, o2 & 7
            t = m() if (ix or z2 == 6) else R[z2]
            if x2 == 0: s = '%s %s' % (ROT[y2], t)
            else: s = '%s %d,%s' % (['', 'bit', 'res', 'set'][x2], y2, t)
            return s
        if op == 0xED:
            o2 = b(); x2, y2, z2 = o2 >> 6, (o2 >> 3) & 7, o2 & 7
            if x2 == 1:
                if z2 == 2: return '%s hl,%s' % ('sbc' if (y2 & 1) == 0 else 'adc', RP[y2 >> 1])
                if z2 == 3:
                    a = w(); return ('ld ($%04X),%s' % (a, RP[y2 >> 1])) if (y2 & 1) == 0 else ('ld %s,($%04X)' % (RP[y2 >> 1], a))
                if z2 == 4: return 'neg'
                if z2 == 5: return 'retn' if y2 != 1 else 'reti'
                if z2 == 6: return 'im %d' % [0, 0, 1, 2][y2 & 3]
                if z2 == 7: return ['ld i,a', 'ld r,a', 'ld a,i', 'ld a,r', 'rrd', 'rld', 'nop', 'nop'][y2]
                return 'in/out ed %02X' % o2
            if x2 == 2 and z2 <= 3 and y2 >= 4:
                return [['ldi', 'cpi', 'ini', 'outi'], ['ldd', 'cpd', 'ind', 'outd'], ['ldir', 'cpir', 'inir', 'otir'], ['lddr', 'cpdr', 'indr', 'otdr']][y2 - 4][z2]
            return 'db $ED,$%02X' % o2
        if x == 0:
            if z == 0:
                if y == 0: return 'nop'
                if y == 1: return "ex af,af'"
                d = s8(); t = (p + d) & 0xFFFF
                if y == 2: return 'djnz $%04X' % t
                if y == 3: return 'jr $%04X' % t
                return 'jr %s,$%04X' % (CC[y - 4], t)
            if z == 1:
                return ('ld %s,$%04X' % (rp(pp), w())) if q == 0 else ('add %s,%s' % (rp(2), rp(pp)))
            if z == 2:
                if q == 0:
                    if pp == 0: return 'ld (bc),a'
                    if pp == 1: return 'ld (de),a'
                    a = w()
                    return ('ld ($%04X),%s' % (a, rp(2))) if pp == 2 else ('ld ($%04X),a' % a)
                if pp == 0: return 'ld a,(bc)'
                if pp == 1: return 'ld a,(de)'
                a = w()
                return ('ld %s,($%04X)' % (rp(2), a)) if pp == 2 else ('ld a,($%04X)' % a)
            if z == 3: return '%s %s' % ('inc' if q == 0 else 'dec', rp(pp))
            if z == 4: return 'inc %s' % r(y)
            if z == 5: return 'dec %s' % r(y)
            if z == 6:
                t = r(y); return 'ld %s,$%02X' % (t, b())
            return ['rlca', 'rrca', 'rla', 'rra', 'daa', 'cpl', 'scf', 'ccf'][y]
        if x == 1:
            if op == 0x76: return 'halt'
            if y == 6: return 'ld %s,%s' % (m(), R[z])
            if z == 6: return 'ld %s,%s' % (R[y], m())
            return 'ld %s,%s' % (r(y), r(z))
        if x == 2:
            return ALU[y] + r(z)
        if z == 0: return 'ret %s' % CC[y]
        if z == 1:
            if q == 0: return 'pop %s' % rp2(pp)
            return ['ret', 'exx', 'jp (%s)' % (ix or 'hl'), 'ld sp,%s' % (ix or 'hl')][pp]
        if z == 2: return 'jp %s,$%04X' % (CC[y], w())
        if z == 3:
            if y == 0: return 'jp $%04X' % w()
            if y == 2: return 'out ($%02X),a' % b()
            if y == 3: return 'in a,($%02X)' % b()
            return ['', '', '', '', 'ex (sp),%s' % (ix or 'hl'), 'ex de,hl', 'di', 'ei'][y]
        if z == 4: return 'call %s,$%04X' % (CC[y], w())
        if z == 5:
            if q == 0: return 'push %s' % rp2(pp)
            return 'call $%04X' % w()
        if z == 6: return ALU[y] + '$%02X' % b()
        return 'rst $%02X' % (y * 8)
    text = body()
    return p, text


def load(rom_path='rom/danpei.gen'):
    rom = open(rom_path, 'rb').read()
    mem = bytearray(0x10000)
    mem[0:0x105C] = rom[0x7DE0C:0x7DE0C + 0x105C]
    mem[0x1100:0x1100 + 0x888] = rom[0x7EE68:0x7EE68 + 0x888]
    mem[0x1C00:0x1C0A] = rom[0x15FC:0x15FC + 10]
    mem[0x8000:0x10000] = rom[0x78000:0x80000]      # 곡 데이터 뱅크 0x0F
    return mem


if __name__ == '__main__':
    a = int(sys.argv[1], 16) if len(sys.argv) > 1 else 0
    e = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x105C
    mem = load()
    while a < e:
        n, s = dis(mem, a)
        print('%04X: %-12s %s' % (a, mem[a:n].hex(), s))
        a = n
