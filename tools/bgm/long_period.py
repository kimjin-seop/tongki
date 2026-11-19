"""미확정 곡의 전체 주기 확정. 입력: tools/bgm/long_run.py 의 덤프. 판정·근거: analysis/35_bgm_port_plan.md §8
드라이버 판독(Z80 0x0871): 곡 머리 +5 의 값 N($1C15)이 0 이 아니면 곡 틱 N 개마다 모든 트랙의 남은 길이(+0x0B)를 1 늘린다
 = N 틱에 한 번 전 트랙이 1틱 쉰다(템포 미세 조정). 악보 한 바퀴가 M(악보 틱)이면 드라이버 틱으로는 M*N/(N-1) 이고,
 이것이 정수가 아니면 '쉬는 틱의 위치'가 바퀴마다 달라져 전체 주기는 (N-1)/gcd(M, N-1) 바퀴가 된다.
여기서는 그 주기를 실행 결과로 확인한다: 곡 진행 상태(loop_exact.py 와 같은 정의, + 지연 카운터 $1C14)가 간격 P 로 한 주기 이상 반복되는 가장 이른 틱 S.
사용: python -I tools/bgm/long_period.py <id_hex ...>  -> analysis/data/35_bgm_oracle/period_XX.json
"""
import importlib.util
import json
import os
import struct
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_s = importlib.util.spec_from_file_location('z80snd', os.path.join(ROOT, 'analysis', 'scripts', 'z80snd.py'))
Z = importlib.util.module_from_spec(_s); _s.loader.exec_module(Z)
D = os.path.join(ROOT, 'tools', 'ext_emu', 'work', 'bgm', 'long')
OUTD = os.path.join(ROOT, 'analysis', 'data', '35_bgm_oracle')
LO, HI = 0x1C00, 0x1F00
SLOTS = list(range(0x1C40, HI - 0x30 + 1, 0x30))
SEQ_OFFS = (0x03, 0x04, 0x09, 0x0B, 0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F)


def find_period(K):
    """K: 틱별 상태 바이트열 목록. 끝까지 이어지는 반복의 (S, P, 확인된 틱 수) 또는 None"""
    last = {}; curP = None; run = 0
    for i, h in enumerate(K):
        if curP and K[i - curP] == h:
            run += 1
        else:
            curP = (i - last[h]) if h in last else None
            run = 1 if curP else 0
        last[h] = i
    if curP and run >= curP + 16:
        return len(K) - run - curP, curP, run
    return None


def main():
    rom = open(os.path.join(ROOT, 'rom', 'danpei.gen'), 'rb').read()
    for tag in [a.lower() for a in sys.argv[1:]]:
        A = np.load(os.path.join(D, 'snaps_%s.npy' % tag)); T = np.load(os.path.join(D, 'ticks_%s.npy' % tag))
        n = len(A)
        act = [b for b in SLOTS if (A[:, b - LO] & 0x80).any()]
        cols = np.array(sorted(b - LO + o for b in act for o in SEQ_OFFS))
        flag = np.array([b - LO for b in act])
        key = np.concatenate([A[:, cols], A[:, flag] & 0x80, A[:, [0x14]]], axis=1)
        K = [r.tobytes() for r in np.ascontiguousarray(key)]
        res = find_period(K)
        # 곡 머리: 곡 표 = Z80 0x8004 의 워드(뱅크 0x0F = ROM 0x78000)
        w = lambda a: rom[0x78000 + a - 0x8000] | rom[0x78000 + a - 0x8000 + 1] << 8
        h = w(w(0x8004) + 2 * (int(tag, 16) - 0x81)); N = rom[0x78000 + h - 0x8000 + 5]
        tick = (1024 - 180) * 144 / Z.YM_CLK
        r = {'song': '0x' + tag.upper(), 'ticks_run': n, 'sec_run': round(float(T[-1]) / Z.Z_CLK, 1), 'tracks': ['$%04X' % b for b in act],
             'header_z80': '0x%04X' % h, 'tempo_delay_N': N, 'delay_counter_seen': sorted(set(int(v) for v in A[200:, 0x15]))}
        if res:
            S, P, run = res
            r.update(loop_start_tick=S, loop_ticks=P, loop_start_sec=round(float(T[S]) / Z.Z_CLK, 5), loop_len_sec=round(float(T[S + P] - T[S]) / Z.Z_CLK, 5),
                     ticks_verified_after_first_pass=run, passes_verified=round((n - S) / P, 3),
                     P_div_N=P / N if N else None, musical_ticks=(P - P // N) if N and P % N == 0 else None)
            # 1회차와 2회차: 작업 RAM 전체가 같은 틱의 비율, 키 온·PSG 쓰기 열
            if S + 2 * P <= n:
                r['full_ram_equal_tick_ratio'] = round(float((A[S:S + P] == A[S + P:S + 2 * P]).all(axis=1).mean()), 4)
                bad = np.nonzero((A[S:S + P] != A[S + P:S + 2 * P]).any(axis=0))[0]
                r['ram_cells_differing'] = ['$%04X' % (int(c) + LO) for c in bad][:40]
                raw = np.fromfile(os.path.join(D, 'log_%s.bin' % tag), dtype=np.dtype([('t', '<u8'), ('k', 'u1'), ('a', 'u1'), ('d', 'u1')]))
                def part(a, b):
                    m = raw[(raw['t'] >= T[a]) & (raw['t'] < T[b])]
                    ko = m[(m['k'] == 0) & (m['a'] == 0x28)]['d'].tobytes(); ps = m[m['k'] == 2]['d'].tobytes()
                    return ko, ps, len(m)
                k1, p1, n1 = part(S, S + P); k2, p2, n2 = part(S + P, S + 2 * P)
                r.update(keyon_writes=len(k1), keyon_equal=(k1 == k2), psg_writes=len(p1), psg_equal=(p1 == p2), writes_pass1=n1, writes_pass2=n2)
            # 한 바퀴(악보 한 번) 길이: 선율 트랙 가운데 하나의 데이터 포인터가 최솟값으로 되돌아가는 틱 간격
            best = None
            for b in act[1:]:
                ptr = A[:, b - LO + 3].astype(int) | (A[:, b - LO + 4].astype(int) << 8)
                lo = ptr[n // 2:].min()
                back = np.nonzero((ptr[1:] == lo) & (ptr[:-1] != lo))[0] + 1
                if len(back) > 3:
                    d = np.diff(back)
                    cand = {'track': '$%04X' % b, 'first_ticks': [int(x) for x in back[:16]], 'lap_ticks_min_max': [int(d.min()), int(d.max())], 'lap_ticks_mean': round(float(d.mean()), 3), 'laps': int(len(d))}
                    if best is None or cand['lap_ticks_mean'] > best['lap_ticks_mean']:
                        best = cand
            r['lap'] = best
            if best:
                r['laps_per_period'] = round(P / best['lap_ticks_mean'], 3)
        else:
            r.update(loop_ticks=None, note='실행 범위 안에 한 주기 이상 반복 없음')
        r['tick_sec'] = round(tick, 7)
        json.dump(r, open(os.path.join(OUTD, 'period_%s.json' % tag), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(json.dumps(r, ensure_ascii=False))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
