"""원작 BGM 루프 구조 확정(청취 불필요 수치 검증). 결과: analysis/data/bgm_loops.json, 캐시 public/assets/rom/_cache/exact_XX.pkl

오라클 = ROM 의 Z80 사운드 드라이버(ROM 0x7DE0C)를 analysis/scripts/z80snd.py 로 그대로 실행한 것.

드라이버 구조(Z80 메인 루프 0x0084~, 이 파일 작성 중 판독·실측):
 - YM2612 타이머 A 오버플로(상태 bit0) -> 0x00C0(타이머 A 재장전, 값 = $1C04/05 = 곡마다 다른 템포) -> 0x00EC: 곡 진행.
   트랙 구조체($1C40 부터 0x30 간격)의 데이터 포인터(+0x0D/0E)·길이(+0x0C)·반복 카운터(+0x1B~)는 이 경로에서만 바뀐다.
 - 타이머 B 오버플로(bit1, 값 $1C06 = 230 고정, 약 128Hz) -> 0x00DA -> 0x072A/0x0511/0x0116: 변조·음량 변화 등 고정 주기 처리.
   두 타이머의 주기가 서로 맞물리지 않으므로 "모든 레지스터 쓰기"는 루프마다 미세하게 다르다(원작 실기도 같다).
방법:
 1. 타이머 A 처리 직전(Z80 0x00A9)마다 작업 RAM $1C00~$1EFF 를 저장하고, 타이머 A 경로/타이머 B 경로가 각각 바꾼 번지를 모은다.
 2. 곡 진행 상태 = 타이머 A 경로에서만 바뀌는 번지. 이 상태 열이 간격 P 틱으로 한 주기 이상 그대로 반복되는 가장 이른 틱 S 를 찾는다
    -> 루프 시작 S, 길이 P 틱. 상태가 더 변하지 않으면 끝나는 곡(1회 재생).
 2-1. 전체 상태가 반복되지 않는 곡(트랙별 변조 위상이 루프와 무관하게 흐르는 곡)은 '진행 상태'만 본다(level sequence):
    트랙별 데이터 포인터(+3/+4)·호출 스택 포인터(+9)·남은 길이(+0x0B)·반복 카운터와 호출 스택(+0x28~0x2F)·재생 중 비트(+0 bit7)가
    한 주기 이상 그대로 반복되면 루프. 전체 상태에서 반복되지 않은 번지를 기록(nonperiodic_cells).
    끝나는 곡은 모든 트랙의 재생 중 비트가 꺼진 틱(level track-flags).
 3. 교차 검증: 틱 [S,S+P) 와 [S+P,S+2P) 의 키 온/오프(YM 0x28) 쓰기 열·PSG 쓰기 열, 틱별 쓰기 수 비교.
사용: python tools/bgm/loop_exact.py [병렬수] [id_hex ...]   (BGM_MAX_SEC 환경변수 = 최대 에뮬 시간, 기본 1500초)
"""
import importlib.util
import json
import os
import pickle
import sys
from multiprocessing import Pool

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_s = importlib.util.spec_from_file_location('z80snd', os.path.join(ROOT, 'analysis', 'scripts', 'z80snd.py'))
Z = importlib.util.module_from_spec(_s); _s.loader.exec_module(Z)
CACHE = os.path.join(ROOT, 'public', 'assets', 'rom', '_cache')
OUT = os.path.join(ROOT, 'analysis', 'data', 'bgm_loops.json')
IDS = list(range(0x81, 0x99))
MAX_SEC = float(os.environ.get('BGM_MAX_SEC', '1500'))
LO, HI = 0x1C00, 0x1F00
HOOK_B, HOOK_B_END, HOOK_A, LOOP_TOP = 0x92, 0xA2, 0xA9, 0x6F


SLOTS = list(range(0x1C40, HI - 0x30 + 1, 0x30))   # 트랙 구조체(0x30 바이트)
# 트랙 구조체 배치(실측, $1C70 덤프): +0 bit7 재생 중, +3/+4 데이터 포인터(뱅크 ROM 0x8000~), +9 호출 스택 포인터(0x30 에서 아래로),
# +0x0B 남은 길이, +0x0C 저장 길이, +0x0D/0E 주파수, +0x22~0x27 변조 상태, +0x28~0x2F 반복 카운터·호출 스택
SEQ_OFFS = (0x03, 0x04, 0x09, 0x0B, 0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F)
SEQ_COLS = np.array(sorted(b - LO + o for b in SLOTS for o in SEQ_OFFS))   # 곡 진행 상태(포인터·길이·반복·스택)
FLAG_COLS = np.array([b - LO for b in SLOTS])   # +0 bit7 = 재생 중


def detect(snaps, cols, reps=1, seq=False):
    """snaps: 틱별 RAM 바이트열 목록, cols: 상태로 볼 번지 인덱스, reps: 끝까지 이어져야 하는 반복 주기 수. 반환 (S, P) 또는 None"""
    arr = np.frombuffer(b''.join(snaps), dtype=np.uint8).reshape(len(snaps), HI - LO)
    if seq:
        arr = np.concatenate([arr[:, cols], arr[:, FLAG_COLS] & 0x80], axis=1)
    else:
        arr = arr[:, cols]
    keys = [r.tobytes() for r in np.ascontiguousarray(arr)]
    n = len(keys)
    last = {}
    curP, run = None, 0
    best = None
    for i, h in enumerate(keys):
        if curP and keys[i - curP] == h:
            run += 1
        else:
            curP = (i - last[h]) if h in last else None
            run = 1 if curP else 0
        last[h] = i
    if curP and run >= reps * curP + 16 and run >= 200:
        best = (n - run - curP, curP)
    return best


def detect_end(snaps):
    """끝나는 곡: 재생 중 비트가 한 번이라도 켜진 뒤 모든 트랙에서 꺼져 200틱 이상 유지 → 꺼진 첫 틱"""
    arr = np.frombuffer(b''.join(snaps), dtype=np.uint8).reshape(len(snaps), HI - LO)[:, FLAG_COLS] & 0x80
    on = arr.any(axis=1)
    if not on.any() or on[-1]:
        return None
    last = int(np.nonzero(on)[0][-1])
    return last + 1 if len(on) - last - 1 >= 200 else None


def run(cid):
    z = Z.boot(os.path.join(ROOT, 'rom', 'danpei.gen'))
    assert bytes(z.mem[HOOK_B - 4:HOOK_B + 3]) == bytes.fromhex('cb4f2810cdda00')
    assert bytes(z.mem[HOOK_A - 4:HOOK_A + 3]) == bytes.fromhex('cb4728c6cdc000')
    for _ in range(10):
        z.run_until(z.t + Z.FRAME_T); z.interrupt()
    pre = list(z.log); z.log = []
    t0 = z.t; z.mem[0x1C0A] = cid
    snaps, T, L = [], [], []
    wA = np.zeros(HI - LO, bool); wB = np.zeros(HI - LO, bool)
    mode = None; before = None
    mem = z.mem; step = z.step
    res = None; level = 'full-state'
    next_check = 40.0
    TA = set()
    while res is None and z.t - t0 < MAX_SEC * Z.Z_CLK:
        fe = z.t + Z.FRAME_T
        while z.t < fe:
            pc = z.pc
            if pc == HOOK_A or pc == HOOK_B or (mode is not None and (pc == LOOP_TOP or pc == HOOK_B_END)):
                cur = bytes(mem[LO:HI])
                if mode is not None and cur != before:
                    d = np.frombuffer(cur, np.uint8) != np.frombuffer(before, np.uint8)
                    if mode == 'A': wA |= d
                    else: wB |= d
                mode = 'A' if pc == HOOK_A else 'B' if pc == HOOK_B else None
                before = cur
                if pc == HOOK_A:
                    snaps.append(cur); T.append(z.t - t0); L.append(len(z.log)); TA.add(z.ym.ta)
            step()
        z.interrupt()
        if (z.t - t0) / Z.Z_CLK >= next_check:
            next_check += 40.0
            cols = np.nonzero(wA & ~wB)[0]
            res = detect(snaps, cols)
            if res is None:
                e = detect_end(snaps)
                if e is not None:
                    res = (e, 1); level = 'track-flags'
                else:
                    res = detect(snaps, SEQ_COLS, reps=1, seq=True)
                    if res:
                        level = 'sequence'
    if res is None:
        cols = np.nonzero(wA & ~wB)[0]
        res = detect(snaps, cols)
        if res is None:
            res = detect(snaps, SEQ_COLS, reps=1, seq=True)
            if res:
                level = 'sequence'
    off = len([1 for (_, k, a, d) in pre if k != 0 or a != 0x28])
    log = [(0, k, a, d) for (_, k, a, d) in pre if k != 0 or a != 0x28] + [(t - t0, k, a, d) for (t, k, a, d) in z.log]
    info = {'id': '0x%02X' % cid, 'ticks': len(snaps), 'emulated_sec': round((z.t - t0) / Z.Z_CLK, 3),
            'timer_a_values': sorted(TA), 'state_cells': int(len(cols)), 'level': level,
            'tick_sec_last': round((1024 - z.ym.ta) * 144 / Z.YM_CLK, 8)}
    if res:
        S, P = res
        if P == 1:
            info.update(kind='once', end_tick=S, end_sec=round(T[S] / Z.Z_CLK, 5))
        else:
            def part(a, b):
                w = z.log[L[a]:L[b]]
                return ([(k, r, d) for (_, k, r, d) in w if k == 0 and r == 0x28], [d for (_, k, r, d) in w if k == 2], len(w))
            k1, p1, n1 = part(S, S + P); k2, p2, n2 = part(S + P, S + 2 * P)
            # 'both'(두 경로가 다 쓰는 번지)까지 포함한 상태가 같은 틱의 비율(참고)
            arr = np.frombuffer(b''.join(snaps[S:S + 2 * P]), np.uint8).reshape(2 * P, HI - LO)
            full_eq = float((arr[:P] == arr[P:]).all(axis=1).mean())
            if level == 'sequence':
                # 곡 진행(포인터·길이)은 반복되지만 전체 상태는 아닌 경우: 반복되지 않는 번지를 트랙 내 오프셋으로 기록
                bad = np.nonzero((arr[:P] != arr[P:]).any(axis=0))[0]
                info['nonperiodic_cells'] = sorted({'+0x%02X' % ((int(c) + LO - 0x1C40) % 0x30) if c + LO >= 0x1C40 else '$%04X' % (int(c) + LO) for c in bad})
                info['nonperiodic_count'] = int(len(bad))
                info['seq_periods_verified'] = round((len(snaps) - S) / P, 2)
            info.update(kind='loop', loop_start_tick=S, loop_ticks=P,
                        loop_start_sec=round(T[S] / Z.Z_CLK, 5), loop_end_sec=round(T[S + P] / Z.Z_CLK, 5),
                        loop2_end_sec=round(T[S + 2 * P] / Z.Z_CLK, 5),
                        loop_len_sec=round((T[S + P] - T[S]) / Z.Z_CLK, 5),
                        pass2_len_sec=round((T[S + 2 * P] - T[S + P]) / Z.Z_CLK, 5),
                        state_ticks_verified=len(snaps) - S - P,
                        keyon_writes=len(k1), keyon_equal=(k1 == k2), psg_writes=len(p1), psg_equal=(p1 == p2),
                        writes_pass1=n1, writes_pass2=n2, full_ram_equal_tick_ratio=round(full_eq, 4))
    else:
        info.update(kind='unknown', _note='%d초 안에 곡 진행 상태 반복 없음' % MAX_SEC)
    os.makedirs(CACHE, exist_ok=True)
    pickle.dump({'log': log, 'total_t': z.t - t0, 'T': T, 'L': [x + off for x in L], 'info': info},
                open(os.path.join(CACHE, 'exact_%02x.pkl' % cid), 'wb'))
    print(json.dumps(info, ensure_ascii=False), flush=True)
    return info


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    npar = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    ids = [int(x, 16) for x in sys.argv[2:]] or IDS
    with Pool(npar) as p:
        res = p.map(run, ids, chunksize=1)
    old = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {'songs': {}}
    for r in res:
        old['songs'][r['id'][2:].lower()] = r
    old['_note'] = '원작 BGM 루프 구조(곡 진행 상태 반복 + 키 온/PSG 쓰기 열 비교). 생성: tools/bgm/loop_exact.py. 시간은 곡 명령 기록 시점 기준 초.'
    json.dump(old, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
