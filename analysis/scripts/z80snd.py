"""원작 사운드 드라이버 오프라인 렌더러: 순수 파이썬 Z80 + YM2612 타이머 + VGM 로그 -> ffmpeg(libgme) WAV.

근거: analysis/02_code_map.md §6 (드라이버 ROM 0x7DE0C -> Z80 0x0000, 데이터 0x7EE68 -> 0x1100,
파라미터 0x15FC -> 0x1C00, 68k 명령 메일박스 $A01C0A/B/C). 드라이버 메인 루프는 YM 상태($4000) 타이머 A/B
오버플로 비트를 폴링해 진행하고, VBlank 인터럽트(IM1, RST 38h)로 $1FFF 카운터를 줄인다(이 파일 분석).

사용: python analysis/scripts/z80snd.py <id_hex> <seconds> <out.vgm>   (rom/danpei.gen 필요)
결과물은 원작 음원이므로 public/assets/rom/ (gitignore) 아래에만 둔다.
"""
import struct
import sys

Z_CLK = 3579545
YM_CLK = 7670453
FRAME_T = Z_CLK // 60          # NTSC VBlank 간격(T-state)
SAMPLES_PER_T = 44100 / Z_CLK
FM_TICK_T = 144 * Z_CLK / YM_CLK   # 타이머 A 1틱 = FM 샘플 1개 = 144 YM 클럭

SF, ZF, YF, HF, XF, PF, NF, CF = 0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01
SZ = [(i & SF) | (ZF if i == 0 else 0) for i in range(256)]
SZP = [SZ[i] | (PF if bin(i).count('1') % 2 == 0 else 0) for i in range(256)]

# 기본 T-state (주 테이블, 조건 분기는 미발생 값; 발생 시 별도 가산)
CYC = [4, 10, 7, 6, 4, 4, 7, 4, 4, 11, 7, 6, 4, 4, 7, 4,
       8, 10, 7, 6, 4, 4, 7, 4, 12, 11, 7, 6, 4, 4, 7, 4,
       7, 10, 16, 6, 4, 4, 7, 4, 7, 11, 16, 6, 4, 4, 7, 4,
       7, 10, 13, 6, 11, 11, 10, 4, 7, 11, 13, 6, 4, 4, 7, 4] + \
      [4] * 64 + [4] * 64 + \
      [5, 10, 10, 10, 10, 11, 7, 11, 5, 10, 10, 0, 10, 17, 7, 11,
       5, 10, 10, 11, 10, 11, 7, 11, 5, 4, 10, 11, 10, 0, 7, 11,
       5, 10, 10, 19, 10, 11, 7, 11, 5, 4, 10, 4, 10, 0, 7, 11,
       5, 10, 10, 4, 10, 11, 7, 11, 5, 6, 10, 4, 10, 0, 7, 11]
for _o in range(0x40, 0xC0):
    if (_o & 7) == 6 or (0x70 <= _o < 0x78):
        CYC[_o] = 7
CYC[0x76] = 4


class YM:
    """YM2612 레지스터 래치 + 타이머 A/B 만(소리 합성은 libgme 에 맡김)"""
    def __init__(self):
        self.addr = [0, 0]
        self.ta = 0; self.tb = 0; self.ctl = 0
        self.ta_next = None; self.tb_next = None
        self.flags = 0

    def _ta_period(self):
        return (1024 - self.ta) * FM_TICK_T

    def _tb_period(self):
        return (256 - self.tb) * 16 * FM_TICK_T

    def update(self, t):
        if self.ta_next is not None:
            while t >= self.ta_next:
                if self.ctl & 0x04: self.flags |= 1
                self.ta_next += self._ta_period()
        if self.tb_next is not None:
            while t >= self.tb_next:
                if self.ctl & 0x08: self.flags |= 2
                self.tb_next += self._tb_period()

    def write(self, port, reg, val, t):
        if port == 0:
            if reg == 0x24: self.ta = (val << 2) | (self.ta & 3)
            elif reg == 0x25: self.ta = (self.ta & 0x3FC) | (val & 3)
            elif reg == 0x26: self.tb = val
            elif reg == 0x27:
                if val & 0x10: self.flags &= ~1
                if val & 0x20: self.flags &= ~2
                if (val & 1) and not (self.ctl & 1): self.ta_next = t + self._ta_period()
                if not (val & 1): self.ta_next = None
                if (val & 2) and not (self.ctl & 2): self.tb_next = t + self._tb_period()
                if not (val & 2): self.tb_next = None
                self.ctl = val


class Z80Sound:
    def __init__(self, rom, z80ram):
        self.rom = rom
        self.mem = bytearray(z80ram[:0x2000])
        self.bank = 0
        self.ym = YM()
        self.log = []   # (T, kind, a, d) kind: 0/1 = YM port, 2 = PSG
        self.t = 0
        self.r = [0] * 8   # B C D E H L - A
        self.f = 0
        self.alt = [0] * 8; self.f_ = 0
        self.ix = self.iy = 0xFFFF
        self.sp = 0; self.pc = 0
        self.iff1 = self.iff2 = 0
        self.im = 0; self.halted = False
        self.i = self.rr = 0
        self.ei_delay = False

    # ---------- 메모리 ----------
    def rd(self, a):
        a &= 0xFFFF
        if a < 0x4000: return self.mem[a & 0x1FFF]
        if a < 0x6000:
            self.ym.update(self.t)
            return self.ym.flags & 3
        if a < 0x8000: return 0xFF
        return self.rom[((self.bank << 15) | (a & 0x7FFF)) % len(self.rom)]

    def wr(self, a, v):
        a &= 0xFFFF; v &= 0xFF
        if a < 0x4000: self.mem[a & 0x1FFF] = v; return
        if a < 0x6000:
            p = a & 3
            if p == 0: self.ym.addr[0] = v
            elif p == 2: self.ym.addr[1] = v
            else:
                port = p >> 1
                reg = self.ym.addr[port]
                self.ym.update(self.t)
                self.ym.write(port, reg, v, self.t)
                if not (port == 0 and reg in (0x24, 0x25, 0x26, 0x27)) or (port == 0 and reg == 0x27):
                    self.log.append((self.t, port, reg, v))
            return
        if a < 0x6100: self.bank = ((self.bank >> 1) | ((v & 1) << 8)) & 0x1FF; return
        if a == 0x7F11: self.log.append((self.t, 2, 0, v)); return

    def rw(self, a): return self.rd(a) | (self.rd(a + 1) << 8)

    def ww(self, a, v): self.wr(a, v & 0xFF); self.wr(a + 1, v >> 8)

    def fetch(self):
        v = self.rd(self.pc); self.pc = (self.pc + 1) & 0xFFFF; return v

    def fetchw(self):
        v = self.rw(self.pc); self.pc = (self.pc + 2) & 0xFFFF; return v

    def push(self, v):
        self.sp = (self.sp - 2) & 0xFFFF; self.ww(self.sp, v)

    def pop(self):
        v = self.rw(self.sp); self.sp = (self.sp + 2) & 0xFFFF; return v

    # ---------- 레지스터 쌍 ----------
    def get_rp(self, p, idx):
        r = self.r
        if p == 0: return (r[0] << 8) | r[1]
        if p == 1: return (r[2] << 8) | r[3]
        if p == 2: return self.ix if idx == 1 else self.iy if idx == 2 else (r[4] << 8) | r[5]
        return self.sp

    def set_rp(self, p, v, idx):
        v &= 0xFFFF; r = self.r
        if p == 0: r[0], r[1] = v >> 8, v & 0xFF
        elif p == 1: r[2], r[3] = v >> 8, v & 0xFF
        elif p == 2:
            if idx == 1: self.ix = v
            elif idx == 2: self.iy = v
            else: r[4], r[5] = v >> 8, v & 0xFF
        else: self.sp = v

    def get_rp2(self, p, idx):
        return ((self.r[7] << 8) | self.f) if p == 3 else self.get_rp(p, idx)

    def set_rp2(self, p, v, idx):
        if p == 3: self.r[7], self.f = (v >> 8) & 0xFF, v & 0xFF
        else: self.set_rp(p, v, idx)

    def g8(self, i, idx, addr):
        """i=6 -> 메모리(addr), H/L 은 idx 시 IXH/IXL"""
        if i == 6: return self.rd(addr)
        if idx and i in (4, 5):
            v = self.ix if idx == 1 else self.iy
            return v >> 8 if i == 4 else v & 0xFF
        return self.r[i]

    def s8(self, i, v, idx, addr):
        v &= 0xFF
        if i == 6: self.wr(addr, v); return
        if idx and i in (4, 5):
            x = self.ix if idx == 1 else self.iy
            x = (v << 8) | (x & 0xFF) if i == 4 else (x & 0xFF00) | v
            if idx == 1: self.ix = x
            else: self.iy = x
            return
        self.r[i] = v

    def cond(self, y):
        f = self.f
        return [not f & ZF, f & ZF, not f & CF, f & CF, not f & PF, f & PF, not f & SF, f & SF][y]

    # ---------- ALU ----------
    def alu(self, op, v):
        a = self.r[7]; c = self.f & CF
        if op in (0, 1):
            res = a + v + (c if op == 1 else 0)
            self.f = SZ[res & 0xFF] | ((a ^ v ^ res) & HF) | (PF if ((a ^ ~v) & (a ^ res) & 0x80) else 0) | (CF if res > 0xFF else 0)
            self.r[7] = res & 0xFF
        elif op in (2, 3, 7):
            res = a - v - (c if op == 3 else 0)
            self.f = SZ[res & 0xFF] | NF | ((a ^ v ^ res) & HF) | (PF if ((a ^ v) & (a ^ res) & 0x80) else 0) | (CF if res < 0 else 0)
            if op != 7: self.r[7] = res & 0xFF
        elif op == 4:
            self.r[7] = a & v; self.f = SZP[self.r[7]] | HF
        elif op == 5:
            self.r[7] = a ^ v; self.f = SZP[self.r[7]]
        else:
            self.r[7] = a | v; self.f = SZP[self.r[7]]

    def inc8(self, v):
        r = (v + 1) & 0xFF
        self.f = (self.f & CF) | SZ[r] | (HF if (r & 0xF) == 0 else 0) | (PF if r == 0x80 else 0)
        return r

    def dec8(self, v):
        r = (v - 1) & 0xFF
        self.f = (self.f & CF) | NF | SZ[r] | (HF if (r & 0xF) == 0xF else 0) | (PF if r == 0x7F else 0)
        return r

    def rot(self, y, v):
        c = self.f & CF
        if y == 0: c2 = v >> 7; r = ((v << 1) | c2) & 0xFF
        elif y == 1: c2 = v & 1; r = (v >> 1) | (c2 << 7)
        elif y == 2: c2 = v >> 7; r = ((v << 1) | c) & 0xFF
        elif y == 3: c2 = v & 1; r = (v >> 1) | (c << 7)
        elif y == 4: c2 = v >> 7; r = (v << 1) & 0xFF
        elif y == 5: c2 = v & 1; r = (v >> 1) | (v & 0x80)
        elif y == 6: c2 = v >> 7; r = ((v << 1) | 1) & 0xFF
        else: c2 = v & 1; r = v >> 1
        self.f = SZP[r] | c2
        return r

    def daa(self):
        a = self.r[7]; f = self.f; corr = 0; c = f & CF
        if (f & HF) or (a & 0xF) > 9: corr |= 0x06
        if c or a > 0x99: corr |= 0x60; c = CF
        if f & NF:
            h = HF if (f & HF) and (a & 0xF) < 6 else 0
            a = (a - corr) & 0xFF
        else:
            h = HF if (a & 0xF) > 9 else 0
            a = (a + corr) & 0xFF
        self.r[7] = a
        self.f = SZP[a] | h | (f & NF) | c

    # ---------- 실행 ----------
    def interrupt(self):
        if not self.iff1: return
        self.halted = False
        self.iff1 = self.iff2 = 0
        self.push(self.pc)
        self.pc = 0x38
        self.t += 13

    def step(self):
        if self.halted:
            self.t += 4; return
        op = self.fetch()
        idx = 0
        while op in (0xDD, 0xFD):
            idx = 1 if op == 0xDD else 2
            self.t += 4
            op = self.fetch()
        self.t += CYC[op] + (8 if idx and ((op & 0xC7) == 0x46 or (op & 0xF8) == 0x70 or op in (0x34, 0x35, 0x36) or ((op & 0xC7) == 0x86 and op >= 0x80)) else 0)
        x, y, z = op >> 6, (op >> 3) & 7, op & 7
        p, q = y >> 1, y & 1
        r = self.r

        def maddr():
            if idx:
                d = self.fetch(); d = d - 256 if d > 127 else d
                return ((self.ix if idx == 1 else self.iy) + d) & 0xFFFF
            return (r[4] << 8) | r[5]

        if op == 0xCB:
            if idx:
                d = self.fetch(); d = d - 256 if d > 127 else d
                addr = ((self.ix if idx == 1 else self.iy) + d) & 0xFFFF
                op2 = self.fetch(); self.t += 15
                x2, y2, z2 = op2 >> 6, (op2 >> 3) & 7, op2 & 7
                v = self.rd(addr)
                if x2 == 0: v = self.rot(y2, v); self.wr(addr, v)
                elif x2 == 1:
                    self.f = (self.f & CF) | HF | (0 if v & (1 << y2) else ZF | PF) | (SF if y2 == 7 and v & 0x80 else 0); return
                elif x2 == 2: v &= ~(1 << y2); self.wr(addr, v)
                else: v |= (1 << y2); self.wr(addr, v)
                if z2 != 6: r[z2] = v & 0xFF
                return
            op2 = self.fetch(); self.t += 4 if (op2 & 7) != 6 else 11
            x2, y2, z2 = op2 >> 6, (op2 >> 3) & 7, op2 & 7
            addr = (r[4] << 8) | r[5]
            v = self.g8(z2, 0, addr)
            if x2 == 0: self.s8(z2, self.rot(y2, v), 0, addr)
            elif x2 == 1: self.f = (self.f & CF) | HF | (0 if v & (1 << y2) else ZF | PF) | (SF if y2 == 7 and v & 0x80 else 0)
            elif x2 == 2: self.s8(z2, v & ~(1 << y2), 0, addr)
            else: self.s8(z2, v | (1 << y2), 0, addr)
            return
        if op == 0xED:
            self.ed(); return

        if x == 0:
            if z == 0:
                if y == 0: pass
                elif y == 1:
                    r[7], self.f, self.alt[7], self.f_ = self.alt[7], self.f_, r[7], self.f
                elif y == 2:
                    d = self.fetch(); r[0] = (r[0] - 1) & 0xFF
                    if r[0]: self.pc = (self.pc + (d - 256 if d > 127 else d)) & 0xFFFF; self.t += 5
                else:
                    d = self.fetch()
                    if y == 3 or self.cond(y - 4):
                        self.pc = (self.pc + (d - 256 if d > 127 else d)) & 0xFFFF
                        if y != 3: self.t += 5
            elif z == 1:
                if q == 0: self.set_rp(p, self.fetchw(), idx)
                else:
                    hl = self.get_rp(2, idx); v = self.get_rp(p, idx); res = hl + v
                    self.f = (self.f & (SF | ZF | PF)) | (HF if (hl ^ v ^ res) & 0x1000 else 0) | (CF if res > 0xFFFF else 0)
                    self.set_rp(2, res, idx)
            elif z == 2:
                if q == 0:
                    if p == 0: self.wr((r[0] << 8) | r[1], r[7])
                    elif p == 1: self.wr((r[2] << 8) | r[3], r[7])
                    elif p == 2: self.ww(self.fetchw(), self.get_rp(2, idx))
                    else: self.wr(self.fetchw(), r[7])
                else:
                    if p == 0: r[7] = self.rd((r[0] << 8) | r[1])
                    elif p == 1: r[7] = self.rd((r[2] << 8) | r[3])
                    elif p == 2: self.set_rp(2, self.rw(self.fetchw()), idx)
                    else: r[7] = self.rd(self.fetchw())
            elif z == 3:
                self.set_rp(p, self.get_rp(p, idx) + (1 if q == 0 else -1), idx)
            elif z in (4, 5):
                addr = maddr() if y == 6 else 0
                v = self.g8(y, idx, addr)
                self.s8(y, self.inc8(v) if z == 4 else self.dec8(v), idx, addr)
            elif z == 6:
                addr = maddr() if y == 6 else 0
                self.s8(y, self.fetch(), idx, addr)
            else:
                a = r[7]; f = self.f
                if y == 0: c = a >> 7; r[7] = ((a << 1) | c) & 0xFF; self.f = (f & (SF | ZF | PF)) | c
                elif y == 1: c = a & 1; r[7] = (a >> 1) | (c << 7); self.f = (f & (SF | ZF | PF)) | c
                elif y == 2: c = a >> 7; r[7] = ((a << 1) | (f & CF)) & 0xFF; self.f = (f & (SF | ZF | PF)) | c
                elif y == 3: c = a & 1; r[7] = (a >> 1) | ((f & CF) << 7); self.f = (f & (SF | ZF | PF)) | c
                elif y == 4: self.daa()
                elif y == 5: r[7] = a ^ 0xFF; self.f = f | HF | NF
                elif y == 6: self.f = (f & (SF | ZF | PF)) | CF
                else: self.f = (f & (SF | ZF | PF)) | (HF if f & CF else 0) | ((f & CF) ^ 1)
        elif x == 1:
            if op == 0x76: self.halted = True; return
            if y == 6 or z == 6:
                addr = maddr()
                if y == 6: self.wr(addr, r[z])
                else: r[y] = self.rd(addr)
            else:
                self.s8(y, self.g8(z, idx, 0), idx, 0)
        elif x == 2:
            addr = maddr() if z == 6 else 0
            self.alu(y, self.g8(z, idx, addr))
        else:
            if z == 0:
                if self.cond(y): self.pc = self.pop(); self.t += 6
            elif z == 1:
                if q == 0: self.set_rp2(p, self.pop(), idx)
                elif p == 0: self.pc = self.pop()
                elif p == 1:
                    for k in range(6): r[k], self.alt[k] = self.alt[k], r[k]
                elif p == 2: self.pc = self.get_rp(2, idx)
                else: self.sp = self.get_rp(2, idx)
            elif z == 2:
                a = self.fetchw()
                if self.cond(y): self.pc = a
            elif z == 3:
                if y == 0: self.pc = self.fetchw()
                elif y == 2: self.fetch()
                elif y == 3: self.fetch(); r[7] = 0xFF
                elif y == 4:
                    v = self.rw(self.sp); self.ww(self.sp, self.get_rp(2, idx)); self.set_rp(2, v, idx)
                elif y == 5:
                    r[2], r[3], r[4], r[5] = r[4], r[5], r[2], r[3]
                elif y == 6: self.iff1 = self.iff2 = 0
                else: self.iff1 = self.iff2 = 1; self.ei_delay = True
            elif z == 4:
                a = self.fetchw()
                if self.cond(y): self.push(self.pc); self.pc = a; self.t += 7
            elif z == 5:
                if q == 0: self.push(self.get_rp2(p, idx))
                else:
                    a = self.fetchw(); self.push(self.pc); self.pc = a
            elif z == 6:
                self.alu(y, self.fetch())
            else:
                self.push(self.pc); self.pc = y * 8

    def ed(self):
        op = self.fetch(); r = self.r
        x, y, z = op >> 6, (op >> 3) & 7, op & 7
        p, q = y >> 1, y & 1
        self.t += 8
        if x == 1:
            if z == 0:
                v = 0xFF
                if y != 6: r[y] = v
                self.f = (self.f & CF) | SZP[v]
            elif z == 1: pass
            elif z == 2:
                hl = (r[4] << 8) | r[5]; v = self.get_rp(p, 0); c = self.f & CF
                if q == 0:
                    res = hl - v - c
                    self.f = (SF if res & 0x8000 else 0) | (ZF if res & 0xFFFF == 0 else 0) | NF | (((hl ^ v ^ res) >> 8) & HF) | (PF if (hl ^ v) & (hl ^ res) & 0x8000 else 0) | (CF if res < 0 else 0)
                else:
                    res = hl + v + c
                    self.f = (SF if res & 0x8000 else 0) | (ZF if res & 0xFFFF == 0 else 0) | (((hl ^ v ^ res) >> 8) & HF) | (PF if (hl ^ ~v) & (hl ^ res) & 0x8000 else 0) | (CF if res > 0xFFFF else 0)
                r[4], r[5] = (res >> 8) & 0xFF, res & 0xFF
                self.t += 7
            elif z == 3:
                a = self.fetchw()
                if q == 0: self.ww(a, self.get_rp(p, 0))
                else: self.set_rp(p, self.rw(a), 0)
                self.t += 12
            elif z == 4:
                a = r[7]; r[7] = 0; self.alu(2, a)
            elif z == 5:
                self.pc = self.pop(); self.iff1 = self.iff2; self.t += 6
            elif z == 6:
                self.im = [0, 0, 1, 2][y & 3]
            else:
                if y == 0: self.i = r[7]
                elif y == 1: self.rr = r[7]
                elif y == 2: r[7] = self.i; self.f = (self.f & CF) | SZ[r[7]] | (PF if self.iff2 else 0)
                elif y == 3: r[7] = self.rr & 0x7F; self.f = (self.f & CF) | SZ[r[7]] | (PF if self.iff2 else 0)
                elif y in (4, 5):
                    hl = (r[4] << 8) | r[5]; m = self.rd(hl); a = r[7]
                    if y == 4:  # RRD
                        self.wr(hl, ((a << 4) | (m >> 4)) & 0xFF); r[7] = (a & 0xF0) | (m & 0x0F)
                    else:       # RLD
                        self.wr(hl, ((m << 4) | (a & 0x0F)) & 0xFF); r[7] = (a & 0xF0) | (m >> 4)
                    self.f = (self.f & CF) | SZP[r[7]]
                    self.t += 10
        elif x == 2 and z <= 1 and y >= 4:
            inc = 1 if y in (4, 6) else -1
            rep = y >= 6
            while True:
                hl = (r[4] << 8) | r[5]; bc = (r[0] << 8) | r[1]
                if z == 0:  # LDI/LDD
                    de = (r[2] << 8) | r[3]
                    self.wr(de, self.rd(hl))
                    de = (de + inc) & 0xFFFF; r[2], r[3] = de >> 8, de & 0xFF
                    hl = (hl + inc) & 0xFFFF; bc = (bc - 1) & 0xFFFF
                    self.f = (self.f & (SF | ZF | CF)) | (PF if bc else 0)
                    stop = bc == 0
                else:       # CPI/CPD
                    v = self.rd(hl); res = (r[7] - v) & 0xFF
                    hl = (hl + inc) & 0xFFFF; bc = (bc - 1) & 0xFFFF
                    self.f = (self.f & CF) | NF | SZ[res] | ((r[7] ^ v ^ res) & HF) | (PF if bc else 0)
                    stop = bc == 0 or res == 0
                r[4], r[5] = hl >> 8, hl & 0xFF; r[0], r[1] = bc >> 8, bc & 0xFF
                self.t += 8
                if not rep or stop: break
                self.t += 21
        # 그 외(IN/OUT 블록 등) 무시

    def run_until(self, t_end):
        while self.t < t_end:
            self.step()
            if self.ei_delay:
                self.ei_delay = False


def make_vgm(log, total_t, sn_clk=Z_CLK, ym_clk=YM_CLK):
    body = bytearray()
    cur = 0  # 샘플 위치
    for t, kind, a, d in log:
        s = int(t * SAMPLES_PER_T)
        while s > cur:
            w = min(s - cur, 0xFFFF)
            body += b'\x61' + struct.pack('<H', w); cur += w
        if kind == 2: body += bytes([0x50, d])
        else: body += bytes([0x52 + kind, a, d])
    end = int(total_t * SAMPLES_PER_T)
    while end > cur:
        w = min(end - cur, 0xFFFF)
        body += b'\x61' + struct.pack('<H', w); cur += w
    body += b'\x66'
    hdr = bytearray(0x40)
    hdr[0:4] = b'Vgm '
    struct.pack_into('<I', hdr, 0x04, 0x40 + len(body) - 4)
    struct.pack_into('<I', hdr, 0x08, 0x150)
    struct.pack_into('<I', hdr, 0x0C, sn_clk)
    struct.pack_into('<I', hdr, 0x18, cur)
    struct.pack_into('<I', hdr, 0x24, 60)
    struct.pack_into('<H', hdr, 0x28, 0x0009)
    hdr[0x2A] = 16
    struct.pack_into('<I', hdr, 0x2C, ym_clk)
    struct.pack_into('<I', hdr, 0x34, 0x40 - 0x34)
    return bytes(hdr + body)


def boot(rom_path='rom/danpei.gen'):
    rom = open(rom_path, 'rb').read()
    ram = bytearray(0x2000)
    ram[0:0x105C] = rom[0x7DE0C:0x7DE0C + 0x105C]
    ram[0x1100:0x1100 + 0x888] = rom[0x7EE68:0x7EE68 + 0x888]
    ram[0x1C00:0x1C0A] = rom[0x15FC:0x15FC + 10]
    z = Z80Sound(rom, ram)
    return z


def run_cmd(z, cmd, seconds, warm_frames=10, slot=0x1C0A):
    """warm_frames 동안 드라이버 초기화 후 명령 기록, seconds 동안 진행. 로그 시간은 명령 시점 기준으로 이동"""
    for _ in range(warm_frames):
        z.run_until(z.t + FRAME_T); z.interrupt()
    t0 = z.t
    pre = list(z.log)
    z.log = []
    z.mem[slot] = cmd
    n = int(seconds * 60)
    for _ in range(n):
        z.run_until(z.t + FRAME_T); z.interrupt()
    # 초기화 단계의 레지스터 상태(음색 등)는 시간 0 으로 앞에 붙인다
    log = [(0, k, a, d) for (_, k, a, d) in pre if k != 0 or a not in (0x28,)] + [(t - t0, k, a, d) for (t, k, a, d) in z.log]
    return log, z.t - t0


if __name__ == '__main__':
    cid = int(sys.argv[1], 16); sec = float(sys.argv[2]); out = sys.argv[3]
    z = boot()
    log, tt = run_cmd(z, cid, sec)
    open(out, 'wb').write(make_vgm(log, tt))
    print('writes', len(log), 'pc', hex(z.pc), 'bank', hex(z.bank))
