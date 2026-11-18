"""순수 파이썬 68000 인터프리터 + 최소 메가드라이브 하드웨어(VDP 메모리/DMA, 패드, Z80 RAM 스텁).
분석(검증) 전용. 사용: from m68k import MD ; md=MD('rom/danpei.gen'); md.run_frame()
"""
import sys

M32 = 0xFFFFFFFF
MASK = (0xFF, 0xFFFF, 0xFFFFFFFF)
SIGN = (0x80, 0x8000, 0x80000000)


def sx(v, s):
    return v - (MASK[s] + 1) if v & SIGN[s] else v


class VDP:
    def __init__(self, md):
        self.md = md
        self.vram = bytearray(0x10000)
        self.cram = [0] * 64
        self.vsram = [0] * 40
        self.reg = [0] * 24
        self.pending = None   # first half of cmd
        self.code = 0
        self.addr = 0
        self.dma_fill = False
        self.vblank = False

    def status(self):
        s = 0x3400 | (0x08 if self.vblank else 0) | 0x200  # fifo empty
        return s

    def ctrl_write(self, v):
        if self.pending is not None:
            first = self.pending
            self.pending = None
            self.code = ((first >> 14) & 3) | ((v >> 2) & 0x3C)
            self.addr = (first & 0x3FFF) | ((v & 3) << 14)
            if self.code & 0x20 and self.reg[1] & 0x10:
                self.dma()
        elif (v & 0xC000) == 0x8000:
            r = (v >> 8) & 0x1F
            if r < 24:
                self.reg[r] = v & 0xFF
        else:
            self.pending = v

    def dma(self):
        r = self.reg
        ln = r[19] | (r[20] << 8)
        if ln == 0:
            ln = 0x10000
        mode = r[23] >> 6
        if mode in (0, 1):
            src = ((r[23] & 0x7F) << 17) | (r[22] << 9) | (r[21] << 1)
            for i in range(ln):
                w = self.md.read(src, 1)
                src = (src + 2) & 0xFFFFFF
                self.data_write(w, 1)
        elif mode == 2:
            self.dma_fill = True
        else:  # vram copy
            src = r[21] | (r[22] << 8)
            for i in range(ln):
                self.vram[self.addr & 0xFFFF] = self.vram[src & 0xFFFF]
                src += 1
                self.addr += r[15]

    def data_write(self, v, size):
        if self.dma_fill:
            self.dma_fill = False
            ln = self.reg[19] | (self.reg[20] << 8) or 0x10000
            hi = (v >> 8) & 0xFF
            lo = v & 0xFF
            self.vram[self.addr & 0xFFFF] = lo if False else hi
            a = self.addr
            for i in range(ln):
                self.vram[(a ^ 1) & 0xFFFF] = hi
                a += self.reg[15]
            return
        c = self.code & 0xF
        if size == 2:
            self.data_write(v >> 16, 1)
            self.data_write(v & 0xFFFF, 1)
            return
        if c == 1:   # VRAM write
            a = self.addr & 0xFFFF
            if size == 1:
                self.vram[a] = (v >> 8) & 0xFF
                self.vram[a ^ 1] = v & 0xFF if False else self.vram[a ^ 1]
                # word write: big-endian at a (even) ; if a odd, swapped
                if a & 1:
                    self.vram[a] = v & 0xFF
                    self.vram[a ^ 1] = (v >> 8) & 0xFF
                else:
                    self.vram[a] = (v >> 8) & 0xFF
                    self.vram[a + 1] = v & 0xFF
            else:
                self.vram[a ^ 1] = v & 0xFF
        elif c == 3:  # CRAM
            self.cram[(self.addr >> 1) & 0x3F] = v & 0xFFFF
        elif c == 5:  # VSRAM
            i = (self.addr >> 1) & 0x3F
            if i < 40:
                self.vsram[i] = v & 0xFFFF
        self.addr = (self.addr + self.reg[15]) & 0xFFFF

    def data_read(self, size):
        c = self.code & 0xF
        v = 0
        if c == 0:
            a = self.addr & 0xFFFF
            v = (self.vram[a] << 8) | self.vram[a ^ 1] if size == 1 else self.vram[a]
        self.addr = (self.addr + self.reg[15]) & 0xFFFF
        return v


class MD:
    def __init__(self, path):
        self.rom = open(path, 'rb').read()
        self.rom += b'\0' * (0x400000 - len(self.rom))
        self.ram = bytearray(0x10000)
        self.z80 = bytearray(0x10000)
        self.vdp = VDP(self)
        self.d = [0] * 8
        self.a = [0] * 8
        self.pc = 0
        self.x = self.n = self.z = self.v = self.c = 0
        self.intmask = 7
        self.s = 1
        self.pad = [0, 0]          # pressed bit masks (논리: 눌림=1; bit0 U,1 D,2 L,3 R,4 B,5 C,6 A,7 Start)
        self.th = [0x40, 0x40]
        self.ioctl = [0, 0, 0]
        self.frame = 0
        self.icount = 0
        self.halted = False
        self.stopped = False
        self.hook = None           # hook(md, pc) -> called each instruction when set
        self.wwatch = {}           # addr -> callback(md, addr, val, size)
        self.eeprom_in = 0
        self.reset()

    # ---------- memory ----------
    def reset(self):
        self.a[7] = self.read(0, 2)
        self.pc = self.read(4, 2)

    def read(self, addr, size):
        addr &= 0xFFFFFF
        if addr < 0x400000:
            if addr >= 0x200000:
                return self.eeprom_in if size == 0 else self.eeprom_in
            r = self.rom
            if size == 0:
                return r[addr]
            if size == 1:
                return (r[addr] << 8) | r[addr + 1]
            return (r[addr] << 24) | (r[addr + 1] << 16) | (r[addr + 2] << 8) | r[addr + 3]
        if addr >= 0xE00000:
            a = addr & 0xFFFF
            r = self.ram
            if size == 0:
                return r[a]
            if size == 1:
                return (r[a] << 8) | r[(a + 1) & 0xFFFF]
            return (r[a] << 24) | (r[a + 1] << 16) | (r[a + 2] << 8) | r[(a + 3) & 0xFFFF]
        if 0xA00000 <= addr < 0xA10000:
            a = addr & 0xFFFF
            if size == 0:
                return self.z80[a]
            if size == 1:
                return (self.z80[a] << 8) | self.z80[a + 1]
            return (self.z80[a] << 24) | (self.z80[a + 1] << 16) | (self.z80[a + 2] << 8) | self.z80[a + 3]
        if 0xA10000 <= addr < 0xA10020:
            return self.io_read(addr, size)
        if 0xA11100 <= addr < 0xA11102:
            return 0
        if 0xC00000 <= addr < 0xC00020:
            a = addr & 0x1F
            if a < 4:
                return self.vdp.data_read(size if size < 2 else 1) if size < 2 else (self.vdp.data_read(1) << 16) | self.vdp.data_read(1)
            if a < 8:
                s = self.vdp.status()
                return s if size else s & 0xFF
            return 0
        return 0

    def io_read(self, addr, size):
        a = addr & 0x1F
        if a == 1:
            return 0xA0  # version: overseas? JP=0x20 ; 0xA0 NTSC export
        if a in (3, 5):
            p = (a - 3) // 2
            th = self.th[p]
            pr = self.pad[p]
            if th:
                v = 0x40 | ((~pr) & 0x3F)
                # bits: 5 C,4 B,3 R,2 L,1 D,0 U (active low)
                v = 0x40 | (((~pr) & 0x0F)) | ((~(pr >> 4) & 1) << 4) | ((~(pr >> 5) & 1) << 5)
            else:
                v = (((~pr) >> 6 & 1) << 4) | (((~pr) >> 7 & 1) << 5) | ((~pr) & 0x03)
            return v & 0xFF
        if a in (9, 0xB, 0xD):
            return self.ioctl[(a - 9) // 2]
        return 0

    def write(self, addr, size, val):
        addr &= 0xFFFFFF
        if addr >= 0xE00000:
            a = addr & 0xFFFF
            r = self.ram
            if size == 0:
                r[a] = val & 0xFF
            elif size == 1:
                r[a] = (val >> 8) & 0xFF
                r[(a + 1) & 0xFFFF] = val & 0xFF
            else:
                r[a] = (val >> 24) & 0xFF
                r[(a + 1) & 0xFFFF] = (val >> 16) & 0xFF
                r[(a + 2) & 0xFFFF] = (val >> 8) & 0xFF
                r[(a + 3) & 0xFFFF] = val & 0xFF
            if self.wwatch:
                for w, cb in self.wwatch.items():
                    if a <= w < a + (1 << size) or (size == 2 and a <= w < a + 4):
                        cb(self, addr, val, size)
            return
        if 0xA00000 <= addr < 0xA10000:
            a = addr & 0xFFFF
            if size == 0:
                self.z80[a] = val & 0xFF
            elif size == 1:
                self.z80[a] = (val >> 8) & 0xFF
                self.z80[a + 1] = val & 0xFF
            return
        if 0xA10000 <= addr < 0xA10020:
            a = addr & 0x1F
            if a in (3, 5):
                self.th[(a - 3) // 2] = val & 0x40
            elif a in (9, 0xB, 0xD):
                self.ioctl[(a - 9) // 2] = val & 0xFF
            return
        if 0xC00000 <= addr < 0xC00020:
            a = addr & 0x1F
            if a < 4:
                if size == 2:
                    self.vdp.data_write(val & M32, 2)
                else:
                    self.vdp.data_write(val & 0xFFFF, size)
            elif a < 8:
                if size == 2:
                    self.vdp.ctrl_write(val >> 16)
                    self.vdp.ctrl_write(val & 0xFFFF)
                elif size == 1:
                    self.vdp.ctrl_write(val & 0xFFFF)
            return

    # ---------- flags ----------
    def get_sr(self):
        return (self.s << 13) | (self.intmask << 8) | (self.x << 4) | (self.n << 3) | (self.z << 2) | (self.v << 1) | self.c

    def set_sr(self, v):
        self.s = (v >> 13) & 1
        self.intmask = (v >> 8) & 7
        self.set_ccr(v)

    def set_ccr(self, v):
        self.x = (v >> 4) & 1
        self.n = (v >> 3) & 1
        self.z = (v >> 2) & 1
        self.v = (v >> 1) & 1
        self.c = v & 1

    def push(self, size, v):
        self.a[7] = (self.a[7] - size) & M32
        self.write(self.a[7], 1 if size == 2 else 2, v)

    def interrupt(self, level, vec):
        sr = self.get_sr()
        self.s = 1
        self.intmask = level
        self.push(4, self.pc)
        self.push(2, sr)
        self.pc = self.read(vec * 4, 2)
        self.stopped = False

    # ---------- fetch ----------
    def fw(self):
        v = self.read(self.pc, 1)
        self.pc = (self.pc + 2) & M32
        return v

    def fl(self):
        v = self.read(self.pc, 2)
        self.pc = (self.pc + 4) & M32
        return v

    # ---------- effective addresses ----------
    def ea(self, mode, reg, size):
        """returns (kind, value): kind 0=Dn 1=An 2=mem addr 3=imm"""
        if mode == 0:
            return (0, reg)
        if mode == 1:
            return (1, reg)
        if mode == 2:
            return (2, self.a[reg])
        if mode == 3:
            a = self.a[reg]
            inc = 2 if (size == 0 and reg == 7) else (1 << size)
            self.a[reg] = (a + inc) & M32
            return (2, a)
        if mode == 4:
            dec = 2 if (size == 0 and reg == 7) else (1 << size)
            self.a[reg] = (self.a[reg] - dec) & M32
            return (2, self.a[reg])
        if mode == 5:
            d = sx(self.fw(), 1)
            return (2, (self.a[reg] + d) & M32)
        if mode == 6:
            return (2, self.index(self.a[reg]))
        if mode == 7:
            if reg == 0:
                return (2, sx(self.fw(), 1) & M32)
            if reg == 1:
                return (2, self.fl())
            if reg == 2:
                pc = self.pc
                d = sx(self.fw(), 1)
                return (2, (pc + d) & M32)
            if reg == 3:
                pc = self.pc
                return (2, self.index(pc))
            if reg == 4:
                if size == 2:
                    return (3, self.fl())
                v = self.fw()
                return (3, v & 0xFF if size == 0 else v)
        raise Exception("bad ea %d %d at %06x" % (mode, reg, self.pc))

    def index(self, base):
        e = self.fw()
        d8 = sx(e & 0xFF, 0)
        r = (e >> 12) & 7
        v = self.a[r] if e & 0x8000 else self.d[r]
        if not e & 0x800:
            v = sx(v & 0xFFFF, 1)
        return (base + d8 + v) & M32

    def rd(self, loc, size):
        k, v = loc
        if k == 0:
            return self.d[v] & MASK[size]
        if k == 1:
            return self.a[v] & MASK[size]
        if k == 2:
            return self.read(v, size)
        return v & MASK[size]

    def wr(self, loc, size, val):
        k, v = loc
        val &= MASK[size]
        if k == 0:
            m = MASK[size]
            self.d[v] = (self.d[v] & ~m & M32) | val
        elif k == 1:
            self.a[v] = sx(val, size) & M32 if size < 2 else val
        elif k == 2:
            self.write(v, size, val)

    # ---------- ALU ----------
    def add(self, a, b, size, cin=0, setx=True, chkz=False):
        m = MASK[size]
        r = a + b + cin
        res = r & m
        sg = SIGN[size]
        self.c = 1 if r > m else 0
        self.v = 1 if (~(a ^ b) & (a ^ res) & sg) else 0
        self.n = 1 if res & sg else 0
        if chkz:
            if res:
                self.z = 0
        else:
            self.z = 1 if res == 0 else 0
        if setx:
            self.x = self.c
        return res

    def sub(self, a, b, size, cin=0, setx=True, chkz=False, cmp=False):
        # a - b - cin
        m = MASK[size]
        r = a - b - cin
        res = r & m
        sg = SIGN[size]
        self.c = 1 if r < 0 else 0
        self.v = 1 if ((a ^ b) & (a ^ res) & sg) else 0
        self.n = 1 if res & sg else 0
        if chkz:
            if res:
                self.z = 0
        else:
            self.z = 1 if res == 0 else 0
        if setx and not cmp:
            self.x = self.c
        return res

    def logic_flags(self, res, size):
        self.n = 1 if res & SIGN[size] else 0
        self.z = 1 if res == 0 else 0
        self.v = 0
        self.c = 0

    def cond(self, cc):
        if cc == 0: return True
        if cc == 1: return False
        if cc == 2: return not (self.c or self.z)
        if cc == 3: return bool(self.c or self.z)
        if cc == 4: return not self.c
        if cc == 5: return bool(self.c)
        if cc == 6: return not self.z
        if cc == 7: return bool(self.z)
        if cc == 8: return not self.v
        if cc == 9: return bool(self.v)
        if cc == 10: return not self.n
        if cc == 11: return bool(self.n)
        if cc == 12: return self.n == self.v
        if cc == 13: return self.n != self.v
        if cc == 14: return (not self.z) and self.n == self.v
        return bool(self.z or self.n != self.v)

    # ---------- step ----------
    def step(self):
        if self.hook:
            self.hook(self, self.pc)
        op = self.fw()
        self.icount += 1
        h = op >> 12
        try:
            getattr(self, 'g%x' % h)(op)
        except Exception:
            self.halted = True
            raise

    def g0(self, op):
        if op & 0x100 or (op & 0xF00) == 0x800:
            # bit ops / movep
            mode = (op >> 3) & 7
            reg = op & 7
            if mode == 1 and op & 0x100:
                raise Exception("movep unsupported")
            t = (op >> 6) & 3
            if op & 0x100:
                bit = self.d[(op >> 9) & 7]
            else:
                bit = self.fw() & 0xFF
            if mode == 0:
                loc = (0, reg)
                bit &= 31
                size = 2
            else:
                loc = self.ea(mode, reg, 0)
                bit &= 7
                size = 0
            v = self.rd(loc, size)
            self.z = 0 if (v >> bit) & 1 else 1
            if t == 1:
                self.wr(loc, size, v ^ (1 << bit))
            elif t == 2:
                self.wr(loc, size, v & ~(1 << bit))
            elif t == 3:
                self.wr(loc, size, v | (1 << bit))
            return
        t = (op >> 9) & 7
        size = (op >> 6) & 3
        mode = (op >> 3) & 7
        reg = op & 7
        if mode == 7 and reg == 4:  # to CCR/SR
            imm = self.fw()
            if size == 0:
                c = self.get_sr() & 0xFF
                if t == 0: c |= imm
                elif t == 1: c &= imm
                else: c ^= imm
                self.set_ccr(c)
            else:
                c = self.get_sr()
                if t == 0: c |= imm
                elif t == 1: c &= imm
                else: c ^= imm
                self.set_sr(c)
            return
        if size == 3:
            raise Exception("bad op0 %04x" % op)
        imm = self.fl() if size == 2 else (self.fw() & MASK[size])
        loc = self.ea(mode, reg, size)
        a = self.rd(loc, size)
        if t == 0:
            r = a | imm; self.logic_flags(r, size); self.wr(loc, size, r)
        elif t == 1:
            r = a & imm; self.logic_flags(r, size); self.wr(loc, size, r)
        elif t == 2:
            r = self.sub(a, imm, size); self.wr(loc, size, r)
        elif t == 3:
            r = self.add(a, imm, size); self.wr(loc, size, r)
        elif t == 5:
            r = a ^ imm; self.logic_flags(r, size); self.wr(loc, size, r)
        elif t == 6:
            self.sub(a, imm, size, cmp=True)
        else:
            raise Exception("bad op0 %04x" % op)

    def move(self, op, size):
        sm, sr_ = (op >> 3) & 7, op & 7
        dm, dr = (op >> 6) & 7, (op >> 9) & 7
        s = self.ea(sm, sr_, size)
        v = self.rd(s, size)
        if dm == 1:
            self.a[dr] = sx(v, size) & M32 if size == 1 else v
            return
        d = self.ea(dm, dr, size)
        self.logic_flags(v, size)
        self.wr(d, size, v)

    def g1(self, op): self.move(op, 0)
    def g2(self, op): self.move(op, 2)
    def g3(self, op): self.move(op, 1)

    def g4(self, op):
        mode = (op >> 3) & 7
        reg = op & 7
        if op & 0x100 and (op & 0x1C0) == 0x1C0:  # LEA
            loc = self.ea(mode, reg, 2)
            self.a[(op >> 9) & 7] = loc[1] & M32
            return
        if op & 0x100 and (op & 0x1C0) == 0x180:  # CHK
            loc = self.ea(mode, reg, 1)
            v = sx(self.rd(loc, 1), 1)
            dv = sx(self.d[(op >> 9) & 7] & 0xFFFF, 1)
            if dv < 0 or dv > v:
                raise Exception("CHK trap")
            return
        t = (op >> 8) & 0xF
        size = (op >> 6) & 3
        if t == 0:   # NEGX / MOVE from SR
            if size == 3:
                loc = self.ea(mode, reg, 1); self.wr(loc, 1, self.get_sr()); return
            loc = self.ea(mode, reg, size)
            a = self.rd(loc, size)
            r = self.sub(0, a, size, self.x, chkz=True)
            self.wr(loc, size, r); return
        if t == 2:   # CLR / MOVE from CCR
            if size == 3:
                loc = self.ea(mode, reg, 1); self.wr(loc, 1, self.get_sr() & 0xFF); return
            loc = self.ea(mode, reg, size)
            self.wr(loc, size, 0)
            self.n = 0; self.z = 1; self.v = 0; self.c = 0
            return
        if t == 4:   # NEG / MOVE to CCR
            if size == 3:
                loc = self.ea(mode, reg, 1); self.set_ccr(self.rd(loc, 1)); return
            loc = self.ea(mode, reg, size)
            a = self.rd(loc, size)
            r = self.sub(0, a, size)
            self.wr(loc, size, r); return
        if t == 6:   # NOT / MOVE to SR
            if size == 3:
                loc = self.ea(mode, reg, 1); self.set_sr(self.rd(loc, 1)); return
            loc = self.ea(mode, reg, size)
            r = ~self.rd(loc, size) & MASK[size]
            self.logic_flags(r, size); self.wr(loc, size, r); return
        if t == 8:
            if size == 0:  # NBCD
                raise Exception("nbcd")
            if mode == 0:   # SWAP / EXT
                if size == 1:
                    v = self.d[reg]
                    r = ((v & 0xFFFF) << 16) | (v >> 16)
                    self.d[reg] = r
                    self.logic_flags(r, 2)
                    return
                if size == 2:  # EXT.W
                    v = sx(self.d[reg] & 0xFF, 0) & 0xFFFF
                    self.d[reg] = (self.d[reg] & 0xFFFF0000) | v
                    self.logic_flags(v, 1)
                    return
            if size == 1 and mode != 0:  # PEA
                loc = self.ea(mode, reg, 2)
                self.push(4, loc[1])
                return
            if size == 3 and mode == 0:  # EXT.L
                v = sx(self.d[reg] & 0xFFFF, 1) & M32
                self.d[reg] = v
                self.logic_flags(v, 2)
                return
            if size in (2, 3):  # MOVEM reg->mem
                sz = 2 if size == 3 else 1
                self.movem(op, sz, True)
                return
            raise Exception("op4 8 %04x" % op)
        if t == 0xA:
            if size == 3:  # TAS
                loc = self.ea(mode, reg, 0)
                v = self.rd(loc, 0)
                self.logic_flags(v, 0)
                self.wr(loc, 0, v | 0x80)
                return
            loc = self.ea(mode, reg, size)
            self.logic_flags(self.rd(loc, size), size)
            return
        if t == 0xC:
            if size in (2, 3):
                sz = 2 if size == 3 else 1
                self.movem(op, sz, False)
                return
        if t == 0xE:
            if op & 0xFF8 == 0x650 or (op & 0xFF0) == 0x640:  # TRAP
                raise Exception("trap")
            if op & 0xFFF8 == 0x4E50:  # LINK
                d = sx(self.fw(), 1)
                self.push(4, self.a[reg])
                self.a[reg] = self.a[7]
                self.a[7] = (self.a[7] + d) & M32
                return
            if op & 0xFFF8 == 0x4E58:  # UNLK
                self.a[7] = self.a[reg]
                self.a[reg] = self.pop(4)
                return
            if op == 0x4E71: return
            if op == 0x4E75:
                self.pc = self.pop(4); return
            if op == 0x4E73:
                sr = self.pop(2); self.pc = self.pop(4); self.set_sr(sr); return
            if op == 0x4E77:
                self.set_ccr(self.pop(2)); self.pc = self.pop(4); return
            if op == 0x4E72:
                self.fw(); self.stopped = True; return
            if op == 0x4E70: return
            if (op & 0xFFC0) == 0x4E80:  # JSR
                loc = self.ea(mode, reg, 2)
                self.push(4, self.pc)
                self.pc = loc[1]
                return
            if (op & 0xFFC0) == 0x4EC0:
                loc = self.ea(mode, reg, 2)
                self.pc = loc[1]
                return
            if (op & 0xFFF0) == 0x4E60:  # MOVE USP
                return
        raise Exception("unimpl op4 %04x at %06x" % (op, self.pc - 2))

    def pop(self, size):
        v = self.read(self.a[7], 2 if size == 4 else 1)
        self.a[7] = (self.a[7] + size) & M32
        return v

    def movem(self, op, sz, to_mem):
        mask = self.fw()
        mode = (op >> 3) & 7
        reg = op & 7
        n = 1 << sz
        if to_mem:
            if mode == 4:
                a = self.a[reg]
                for i in range(16):
                    if mask & (1 << i):
                        r = 15 - i
                        v = self.a[r - 8] if r >= 8 else self.d[r]
                        a = (a - n) & M32
                        self.write(a, sz, v if sz == 2 else v & 0xFFFF)
                self.a[reg] = a
            else:
                loc = self.ea(mode, reg, sz)
                a = loc[1]
                for i in range(16):
                    if mask & (1 << i):
                        v = self.a[i - 8] if i >= 8 else self.d[i]
                        self.write(a, sz, v if sz == 2 else v & 0xFFFF)
                        a = (a + n) & M32
        else:
            if mode == 3:
                a = self.a[reg]
            else:
                a = self.ea(mode, reg, sz)[1]
            for i in range(16):
                if mask & (1 << i):
                    v = self.read(a, sz)
                    if sz == 1:
                        v = sx(v, 1) & M32
                    if i >= 8:
                        self.a[i - 8] = v
                    else:
                        self.d[i] = v
                    a = (a + n) & M32
            if mode == 3:
                self.a[reg] = a

    def g5(self, op):
        mode = (op >> 3) & 7
        reg = op & 7
        size = (op >> 6) & 3
        if size == 3:
            cc = (op >> 8) & 0xF
            if mode == 1:  # DBcc
                disp = sx(self.fw(), 1)
                if not self.cond(cc):
                    v = (self.d[reg] - 1) & 0xFFFF
                    self.d[reg] = (self.d[reg] & 0xFFFF0000) | v
                    if v != 0xFFFF:
                        self.pc = (self.pc - 2 + disp) & M32
                return
            loc = self.ea(mode, reg, 0)
            self.wr(loc, 0, 0xFF if self.cond(cc) else 0)
            return
        q = (op >> 9) & 7 or 8
        if mode == 1:
            if op & 0x100:
                self.a[reg] = (self.a[reg] - q) & M32
            else:
                self.a[reg] = (self.a[reg] + q) & M32
            return
        loc = self.ea(mode, reg, size)
        a = self.rd(loc, size)
        if op & 0x100:
            r = self.sub(a, q, size)
        else:
            r = self.add(a, q, size)
        self.wr(loc, size, r)

    def g6(self, op):
        cc = (op >> 8) & 0xF
        d = op & 0xFF
        pc = self.pc
        if d == 0:
            d = sx(self.fw(), 1)
        elif d == 0xFF:
            d = sx(self.fl(), 2)
        else:
            d = sx(d, 0)
        if cc == 1:
            self.push(4, self.pc)
            self.pc = (pc + d) & M32
        elif self.cond(cc):
            self.pc = (pc + d) & M32

    def g7(self, op):
        v = sx(op & 0xFF, 0) & M32
        self.d[(op >> 9) & 7] = v
        self.logic_flags(v, 2)

    def g8(self, op):
        mode = (op >> 3) & 7
        reg = op & 7
        r = (op >> 9) & 7
        size = (op >> 6) & 3
        if size == 3:
            loc = self.ea(mode, reg, 1)
            s = self.rd(loc, 1)
            dv = self.d[r]
            if op & 0x100:  # DIVS
                s = sx(s, 1)
                if s == 0: raise Exception("div0")
                a = sx(dv, 2)
                q = abs(a) // abs(s)
                if (a < 0) != (s < 0): q = -q
                rem = a - q * s
                if q > 32767 or q < -32768:
                    self.v = 1; return
                self.d[r] = ((rem & 0xFFFF) << 16) | (q & 0xFFFF)
                self.n = 1 if q & 0x8000 else 0; self.z = 1 if (q & 0xFFFF) == 0 else 0; self.v = 0; self.c = 0
            else:
                if s == 0: raise Exception("div0")
                q = dv // s
                rem = dv % s
                if q > 0xFFFF:
                    self.v = 1; return
                self.d[r] = (rem << 16) | q
                self.n = 1 if q & 0x8000 else 0; self.z = 1 if q == 0 else 0; self.v = 0; self.c = 0
            return
        if (op & 0x1F0) == 0x100:  # SBCD
            raise Exception("sbcd")
        loc = self.ea(mode, reg, size)
        if op & 0x100:
            a = self.rd(loc, size)
            res = a | (self.d[r] & MASK[size])
            self.logic_flags(res, size); self.wr(loc, size, res)
        else:
            res = self.rd(loc, size) | (self.d[r] & MASK[size])
            self.logic_flags(res, size)
            self.wr((0, r), size, res)

    def addsub(self, op, isadd):
        mode = (op >> 3) & 7
        reg = op & 7
        r = (op >> 9) & 7
        size = (op >> 6) & 3
        if size == 3:  # ADDA/SUBA
            sz = 2 if op & 0x100 else 1
            loc = self.ea(mode, reg, sz)
            v = self.rd(loc, sz)
            if sz == 1:
                v = sx(v, 1)
            self.a[r] = (self.a[r] + v if isadd else self.a[r] - v) & M32
            return
        if op & 0x100 and mode in (0, 1):  # ADDX/SUBX
            if mode == 0:
                dl = (0, r); sl = (0, reg)
            else:
                sl = self.ea(4, reg, size); dl = self.ea(4, r, size)
            s = self.rd(sl, size); d = self.rd(dl, size)
            if isadd:
                res = self.add(d, s, size, self.x, chkz=True)
            else:
                res = self.sub(d, s, size, self.x, chkz=True)
            self.wr(dl, size, res)
            return
        loc = self.ea(mode, reg, size)
        if op & 0x100:
            a = self.rd(loc, size); b = self.d[r] & MASK[size]
            res = self.add(a, b, size) if isadd else self.sub(a, b, size)
            self.wr(loc, size, res)
        else:
            a = self.d[r] & MASK[size]; b = self.rd(loc, size)
            res = self.add(a, b, size) if isadd else self.sub(a, b, size)
            self.wr((0, r), size, res)

    def g9(self, op): self.addsub(op, False)
    def gd(self, op): self.addsub(op, True)

    def gb(self, op):
        mode = (op >> 3) & 7
        reg = op & 7
        r = (op >> 9) & 7
        size = (op >> 6) & 3
        if size == 3:  # CMPA
            sz = 2 if op & 0x100 else 1
            loc = self.ea(mode, reg, sz)
            v = self.rd(loc, sz)
            if sz == 1:
                v = sx(v, 1) & M32
            self.sub(self.a[r], v, 2, cmp=True)
            return
        if op & 0x100:
            if mode == 1:  # CMPM
                s = self.ea(3, reg, size); d = self.ea(3, r, size)
                self.sub(self.rd(d, size), self.rd(s, size), size, cmp=True)
                return
            loc = self.ea(mode, reg, size)
            res = self.rd(loc, size) ^ (self.d[r] & MASK[size])
            self.logic_flags(res, size); self.wr(loc, size, res)
            return
        loc = self.ea(mode, reg, size)
        self.sub(self.d[r] & MASK[size], self.rd(loc, size), size, cmp=True)

    def gc(self, op):
        mode = (op >> 3) & 7
        reg = op & 7
        r = (op >> 9) & 7
        size = (op >> 6) & 3
        if size == 3:
            loc = self.ea(mode, reg, 1)
            s = self.rd(loc, 1)
            if op & 0x100:
                res = (sx(s, 1) * sx(self.d[r] & 0xFFFF, 1)) & M32
            else:
                res = s * (self.d[r] & 0xFFFF)
            self.d[r] = res
            self.logic_flags(res, 2)
            return
        if (op & 0x130) == 0x100:  # EXG / ABCD
            opm = (op >> 3) & 0x1F
            if opm == 0x08:
                self.d[r], self.d[reg] = self.d[reg], self.d[r]; return
            if opm == 0x09:
                self.a[r], self.a[reg] = self.a[reg], self.a[r]; return
            if opm == 0x11:
                self.d[r], self.a[reg] = self.a[reg], self.d[r]; return
            raise Exception("abcd")
        loc = self.ea(mode, reg, size)
        if op & 0x100:
            res = self.rd(loc, size) & self.d[r]
            res &= MASK[size]
            self.logic_flags(res, size); self.wr(loc, size, res)
        else:
            res = self.rd(loc, size) & self.d[r] & MASK[size]
            self.logic_flags(res, size)
            self.wr((0, r), size, res)

    def ge(self, op):
        size = (op >> 6) & 3
        left = op & 0x100
        if size == 3:  # memory shift
            mode = (op >> 3) & 7
            reg = op & 7
            loc = self.ea(mode, reg, 1)
            v = self.rd(loc, 1)
            res = self.shift((op >> 9) & 3, left, v, 1, 1)
            self.wr(loc, 1, res)
            return
        reg = op & 7
        t = (op >> 3) & 3
        if op & 0x20:
            cnt = self.d[(op >> 9) & 7] & 63
        else:
            cnt = (op >> 9) & 7 or 8
        v = self.d[reg] & MASK[size]
        res = self.shift(t, left, v, size, cnt)
        self.wr((0, reg), size, res)

    def shift(self, t, left, v, size, cnt):
        m = MASK[size]
        sg = SIGN[size]
        bits = (m + 1).bit_length() - 1
        c = self.c
        if cnt == 0:
            self.logic_flags(v, size)
            self.c = 0 if t != 2 else self.c
            if t == 2:
                self.c = self.x
            res = v
            self.v = 0
            return res
        if t == 0:  # AS
            if left:
                ov = 0
                for _ in range(cnt):
                    c = 1 if v & sg else 0
                    nv = (v << 1) & m
                    if (nv ^ v) & sg: ov = 1
                    v = nv
                self.v = ov
            else:
                for _ in range(cnt):
                    c = v & 1
                    v = (v >> 1) | (v & sg)
                self.v = 0
            self.x = c
        elif t == 1:  # LS
            for _ in range(cnt):
                if left:
                    c = 1 if v & sg else 0
                    v = (v << 1) & m
                else:
                    c = v & 1
                    v >>= 1
            self.v = 0
            self.x = c
        elif t == 2:  # ROX
            x = self.x
            for _ in range(cnt):
                if left:
                    c = 1 if v & sg else 0
                    v = ((v << 1) & m) | x
                else:
                    c = v & 1
                    v = (v >> 1) | (sg if x else 0)
                x = c
            self.x = x
            self.v = 0
        else:  # RO
            for _ in range(cnt):
                if left:
                    c = 1 if v & sg else 0
                    v = ((v << 1) & m) | c
                else:
                    c = v & 1
                    v = (v >> 1) | (sg if c else 0)
            self.v = 0
        self.c = c
        self.n = 1 if v & sg else 0
        self.z = 1 if v == 0 else 0
        return v

    def ga(self, op): raise Exception("line A %04x" % op)
    def gf(self, op): raise Exception("line F %04x" % op)

    # ---------- frame driver ----------
    INSTR_PER_FRAME = 14000
    VBL_START = 12500

    def run_frame(self, maxinstr=None):
        """한 프레임(VBlank 1회) 분량 실행. VBlank 구간 진입 시 인터럽트 발생."""
        vd = self.vdp
        vd.vblank = False
        n = 0
        fired = False
        while n < self.INSTR_PER_FRAME:
            if n == self.VBL_START and not fired:
                vd.vblank = True
                fired = True
                if self.intmask < 6:
                    self.interrupt(6, 30)
            if self.stopped:
                n = max(n + 1, self.VBL_START) if n < self.VBL_START else n + 1
                continue
            self.step()
            n += 1
        self.frame += 1


def ramw(md, a):
    return (md.ram[a & 0xFFFF] << 8) | md.ram[(a + 1) & 0xFFFF]


def raml(md, a):
    return (ramw(md, a) << 16) | ramw(md, a + 2)
