"""전체 상태가 반복되지 않는 곡의 트랙별 루프 주기 조사(미확정 곡 분석용). 사용: python tools/bgm/track_periods.py <초> <id_hex ...>
트랙 구조체($1C40 부터 0x30 간격)의 진행 상태(+3/+4 포인터, +9 스택 포인터, +0x0B 남은 길이, +0x28~0x2F 반복 카운터·스택)를
타이머 A 틱마다 모아, 트랙마다 '끝 400틱 창이 앞에서 다시 나오는 가장 가까운 간격'을 주기로 보고 그 주기가 어디서부터 성립하는지 잰다.
트랙들의 주기가 서로 정수배가 아니면 곡 전체는 그 최소공배수 주기로만 반복한다(짧은 파일 하나로 루프를 만들 수 없음).
"""
import importlib.util
import json
import os
import sys
from math import gcd
from multiprocessing import Pool

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_s = importlib.util.spec_from_file_location('z80snd', os.path.join(ROOT, 'analysis', 'scripts', 'z80snd.py'))
Z = importlib.util.module_from_spec(_s); _s.loader.exec_module(Z)
LO, HI = 0x1C00, 0x1F00
OFFS = (0x03, 0x04, 0x09, 0x0B, 0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F)
W = 400


def run(args):
    cid, sec = args
    z = Z.boot(os.path.join(ROOT, 'rom', 'danpei.gen'))
    for _ in range(10):
        z.run_until(z.t + Z.FRAME_T); z.interrupt()
    t0 = z.t; z.mem[0x1C0A] = cid
    snaps, T = [], []
    while z.t - t0 < sec * Z.Z_CLK:
        fe = z.t + Z.FRAME_T
        while z.t < fe:
            if z.pc == 0xA9:
                snaps.append(bytes(z.mem[LO:HI])); T.append((z.t - t0) / Z.Z_CLK)
            z.step()
        z.interrupt()
    arr = np.frombuffer(b''.join(snaps), np.uint8).reshape(len(snaps), HI - LO)
    n = len(arr); tick = (T[-1] - T[200]) / (n - 201)
    out = {'id': '0x%02X' % cid, 'ticks': n, 'tick_sec': round(tick, 6), 'tracks': []}
    for b in range(0x1C40, HI - 0x2F, 0x30):
        o = b - LO
        if not (arr[:, o] & 0x80).any():
            continue
        k = len(OFFS)
        buf = np.ascontiguousarray(arr[:, [o + x for x in OFFS]]).tobytes()
        tail = buf[(n - W) * k:]
        pos = buf.rfind(tail, 0, (n - 1) * k)
        while pos != -1 and pos % k:
            pos = buf.rfind(tail, 0, pos + len(tail) - 1)
        tr = {'slot': '$%04X' % b, 'tempo_div': int(arr[-1, o + 2]), 'ptr_hi': '%02X' % arr[-1, o + 4]}
        if pos == -1:
            tr.update(period_ticks=None)
        else:
            P = (n - W) - pos // k
            j = n - P - 1
            while j >= 0 and buf[j * k:(j + 1) * k] == buf[(j + P) * k:(j + P + 1) * k]:
                j -= 1
            S = j + 1
            tr.update(period_ticks=P, period_sec=round(P * tick, 3), start_tick=S, start_sec=round(T[S], 3), periods_verified=round((n - S) / P, 2))
        out['tracks'].append(tr)
    ps = [t['period_ticks'] for t in out['tracks'] if t.get('period_ticks')]
    if ps and len(ps) == len(out['tracks']):
        l = 1
        for p in ps:
            l = l * p // gcd(l, p)
        out['lcm_ticks'] = l; out['lcm_sec'] = round(l * tick, 1)
    print(json.dumps(out, ensure_ascii=False), flush=True)
    return out


if __name__ == '__main__':
    sec = float(sys.argv[1])
    ids = [int(v, 16) for v in sys.argv[2:]]
    with Pool(len(ids)) as p:
        res = p.map(run, [(i, sec) for i in ids])
    outp = os.path.join(ROOT, 'analysis', 'data', 'bgm_track_periods.json')
    old = json.load(open(outp, encoding='utf-8')) if os.path.exists(outp) else {}
    for r in res:
        old[r['id'][2:].lower()] = r
    json.dump(old, open(outp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
