"""미확정 곡(0x82·0x85·0x98) 장시간 실행 덤프. analysis/35_bgm_port_plan.md §7
자작 Z80(analysis/scripts/z80snd.py)로 곡을 <초> 동안 돌려 곡 틱(타이머 A 처리 직전, Z80 0x00A9)마다
작업 RAM $1C00~$1EFF 와 시각을 저장하고, 레지스터 쓰기 열을 파일로 흘려 쓴다(메모리에 쌓지 않는다).
출력(tools/ext_emu/work/bgm/long/): snaps_XX.npy(틱 x 0x300), ticks_XX.npy(틱 시각 T-state), log_XX.bin(<QBBB: T, kind, reg, val), pre_XX.bin(곡 명령 전 쓰기)
사용: python -I tools/bgm/long_run.py <초> <id_hex ...>   (곡마다 프로세스 1개)
"""
import importlib.util
import os
import struct
import sys
from multiprocessing import Pool

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_s = importlib.util.spec_from_file_location('z80snd', os.path.join(ROOT, 'analysis', 'scripts', 'z80snd.py'))
Z = importlib.util.module_from_spec(_s); _s.loader.exec_module(Z)
OUT = os.path.join(ROOT, 'tools', 'ext_emu', 'work', 'bgm', 'long')
LO, HI, HOOK_A = 0x1C00, 0x1F00, 0xA9
PK = struct.Struct('<QBBB')


def run(args):
    cid, sec = args
    z = Z.boot(os.path.join(ROOT, 'rom', 'danpei.gen'))
    assert bytes(z.mem[HOOK_A - 4:HOOK_A + 3]) == bytes.fromhex('cb4728c6cdc000')
    for _ in range(10):
        z.run_until(z.t + Z.FRAME_T); z.interrupt()
    tag = '%02x' % cid
    with open(os.path.join(OUT, 'pre_%s.bin' % tag), 'wb') as f:
        for (t, k, a, d) in z.log:
            f.write(PK.pack(t, k, a, d))
    z.log = []
    t0 = z.t; z.mem[0x1C0A] = cid
    snaps, T = [], []
    mem = z.mem; step = z.step
    lf = open(os.path.join(OUT, 'log_%s.bin' % tag), 'wb')
    nxt = 60.0
    while z.t - t0 < sec * Z.Z_CLK:
        fe = z.t + Z.FRAME_T
        while z.t < fe:
            if z.pc == HOOK_A:
                snaps.append(bytes(mem[LO:HI])); T.append(z.t - t0)
            step()
        z.interrupt()
        if z.log:
            lf.write(b''.join(PK.pack(t - t0, k, a, d) for (t, k, a, d) in z.log)); z.log = []
        if (z.t - t0) / Z.Z_CLK >= nxt:
            print(tag, 'sec', int(nxt), 'ticks', len(snaps), flush=True); nxt += 60.0
    lf.close()
    np.save(os.path.join(OUT, 'snaps_%s.npy' % tag), np.frombuffer(b''.join(snaps), np.uint8).reshape(len(snaps), HI - LO))
    np.save(os.path.join(OUT, 'ticks_%s.npy' % tag), np.array(T, dtype=np.int64))
    print(tag, 'DONE ticks', len(snaps), 'total_t', z.t - t0, 'ta', z.ym.ta, 'bank', hex(z.bank), flush=True)
    return tag


if __name__ == '__main__':
    sec = float(sys.argv[1]); ids = [int(v, 16) for v in sys.argv[2:]]
    os.makedirs(OUT, exist_ok=True)
    with Pool(len(ids)) as p:
        p.map(run, [(i, sec) for i in ids], chunksize=1)
