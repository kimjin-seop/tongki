"""BGM 오라클 교차 확인 1: 곡 진행 상태(채널 트레이스) 대조. 방법·판정: analysis/35_bgm_port_plan.md §4

 공개 에뮬(BizHawk / Genesis Plus GX)이 게임을 부팅부터 실제로 돌려 모드 메뉴 곡(0x8C)을 연주하는 동안
 프레임마다 덤프한 Z80 RAM $1C00~$1EFF (tools/ext_emu/work/bgm/z80_1c00.bin, tools/ext_emu/xcheck/bgm_oracle.lua)
 대
 우리 렌더의 근거인 자작 Z80 실행(analysis/scripts/z80snd.py, 곡 명령만 직접 기록)의 곡 틱별 RAM.

 곡 진행 상태 = 트랙 구조체($1C40 부터 0x30 간격)의 데이터 포인터(+3/+4)·호출 스택 포인터(+9)·남은 길이(+0x0B)·
 반복 카운터와 호출 스택(+0x28~0x2F)·재생 중 비트(+0 bit7). tools/bgm/loop_exact.py 의 SEQ_OFFS 와 같다.
 공개 에뮬 덤프는 프레임 끝(곡 틱 경계가 아님)이라, 프레임 f 의 상태가 우리 틱 k 의 상태와 같거나(exact)
 틱 k 와 k+1 사이(각 바이트가 둘 중 하나, between)인 k 를 순서대로 찾는다.
사용: python -I tools/bgm/oracle/compare_state.py [곡 hex=8c] [우리 쪽 실행 초=58]
 덤프 파일: tools/ext_emu/work/bgm/z80_XX.bin(곡 지정판 bgm_oracle_song.lua, $1C0A 직접 기록)이 있으면 그것, 없으면 z80_1c00.bin(0x8C 시범).
 1회 곡(kind once)은 끝 틱까지만 회귀·판정한다(끝난 뒤에는 상태가 멈춰 프레임-틱 대응이 뜻이 없다).
"""
import importlib.util
import json
import os
import pickle
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
_s = importlib.util.spec_from_file_location('z80snd', os.path.join(ROOT, 'analysis', 'scripts', 'z80snd.py'))
Z = importlib.util.module_from_spec(_s); _s.loader.exec_module(Z)
WORK = os.path.join(ROOT, 'tools', 'ext_emu', 'work', 'bgm')
OUTD = os.path.join(ROOT, 'analysis', 'data', '35_bgm_oracle')
LO, HI, HOOK_A = 0x1C00, 0x1F00, 0xA9
SLOTS = list(range(0x1C40, HI - 0x30 + 1, 0x30))
SEQ_OFFS = (0x03, 0x04, 0x09, 0x0B, 0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F)
MD_FRAME_SEC = 3420 * 262 / 53693175          # NTSC 메가드라이브 1프레임(마스터 클럭 기준)


def ours(cid, sec):
    """자작 Z80 실행: 곡 틱(타이머 A 처리 직전)마다 RAM 저장. 반환 (틱별 RAM 배열, 틱 시각 초)"""
    # 장시간 실행 덤프(tools/bgm/long_run.py)가 있고 충분히 길면 그것을 쓴다(같은 실행 방법: 부팅 10프레임 뒤 곡 명령)
    lp = os.path.join(WORK, 'long', 'snaps_%02x.npy' % cid)
    if os.path.exists(lp):
        T = np.load(os.path.join(WORK, 'long', 'ticks_%02x.npy' % cid)) / Z.Z_CLK
        if T[-1] >= sec - 1:
            return np.load(lp), T
    cache = os.path.join(WORK, 'ours_%02x_%d.pkl' % (cid, sec))
    if os.path.exists(cache):
        return pickle.load(open(cache, 'rb'))
    z = Z.boot(os.path.join(ROOT, 'rom', 'danpei.gen'))
    assert bytes(z.mem[HOOK_A - 4:HOOK_A + 3]) == bytes.fromhex('cb4728c6cdc000')
    for _ in range(10):
        z.run_until(z.t + Z.FRAME_T); z.interrupt()
    t0 = z.t; z.mem[0x1C0A] = cid
    snaps, T = [], []
    mem = z.mem; step = z.step
    while z.t - t0 < sec * Z.Z_CLK:
        fe = z.t + Z.FRAME_T
        while z.t < fe:
            if z.pc == HOOK_A:
                snaps.append(bytes(mem[LO:HI])); T.append((z.t - t0) / Z.Z_CLK)
            step()
        z.interrupt()
    r = (np.frombuffer(b''.join(snaps), np.uint8).reshape(len(snaps), HI - LO).copy(), np.array(T))
    pickle.dump(r, open(cache, 'wb'))
    return r


def main():
    cid = int(sys.argv[1], 16) if len(sys.argv) > 1 else 0x8C
    sec = int(sys.argv[2]) if len(sys.argv) > 2 else 58
    O, T = ours(cid, sec)
    dump = os.path.join(WORK, 'z80_%02x.bin' % cid)
    if not os.path.exists(dump):
        dump = os.path.join(WORK, 'z80_1c00.bin')
    raw = open(dump, 'rb').read()
    B = np.frombuffer(raw, np.uint8).reshape(-1, HI - LO)
    # 우리 쪽에서 한 번이라도 재생 중이던 트랙 = 이 곡의 트랙
    act = [b for b in SLOTS if (O[:, b - LO] & 0x80).any()]
    cols = np.array(sorted(b - LO + o for b in act for o in SEQ_OFFS))
    flag = np.array([b - LO for b in act])

    def key(arr):
        return np.concatenate([arr[:, cols], arr[:, flag] & 0x80], axis=1)
    KO, KB = key(O), key(B)
    nO, nB = len(KO), len(KB)
    # 시작 정렬: 우리 틱 k(8~40) 상태와 같은 첫 프레임 중, 뒤로 60프레임이 순서대로 이어지는 것
    def walk(f0, k0, limit=None):
        """f0 프레임을 틱 k0 에 놓고 순서대로 대응. 반환 [(f, k, 종류)]"""
        res = []; k = k0; f = f0
        end = nB if limit is None else min(nB, f0 + limit)
        while f < end:
            hit = None
            for dk in range(0, 4):
                kk = k + dk
                if kk >= nO:
                    break
                if (KB[f] == KO[kk]).all():
                    hit = (kk, 'exact'); break
            if hit is None:
                for dk in range(0, 3):
                    kk = k + dk
                    if kk + 1 >= nO:
                        break
                    if ((KB[f] == KO[kk]) | (KB[f] == KO[kk + 1])).all():
                        hit = (kk, 'between'); break
            if hit is None:
                if k + 4 >= nO:
                    break
                res.append((f, None, 'miss'))
                k = min(k + 1, nO - 1)   # 다음 프레임에서 다시 맞춘다(프레임당 약 1.05틱)
            else:
                res.append((f, hit[0], hit[1])); k = hit[0]
            f += 1
        return res
    start = None
    for f in range(nB):
        for k in range(8, 40):
            if (KB[f] == KO[k]).all():
                w = walk(f, k, 60)
                # 트랙이 많은 곡은 틱 처리 도중에 찍히는 프레임이 늘어 exact 비율이 낮다(0x96: 78%) -> exact 30 이상이고 exact+between 50 이상이면 정렬로 본다
                if sum(1 for x in w if x[2] == 'exact') >= 30 and sum(1 for x in w if x[2] != 'miss') >= 50:
                    start = (f, k); break
        if start:
            break
    if not start:
        print('정렬 실패: 공개 에뮬 덤프에서 이 곡의 진행 상태를 찾지 못함'); sys.exit(2)
    w = walk(*start)
    info = json.load(open(os.path.join(ROOT, 'analysis', 'data', 'bgm_loops.json'), encoding='utf-8'))['songs']['%02x' % cid]
    end_tick = info.get('end_tick') if info.get('kind') == 'once' else None
    if end_tick is not None:
        # 1회 곡: 끝 틱 뒤는 버린다
        w = [x for x in w if x[1] is None or x[1] <= end_tick]
        while w and w[-1][1] is None:
            w.pop()
        last_f = min(x[0] for x in w if x[1] == max(y[1] for y in w if y[1] is not None))
        w = [x for x in w if x[0] <= last_f]
    fs = np.array([x[0] for x in w if x[1] is not None]); ks = np.array([x[1] for x in w if x[1] is not None])
    kinds = [x[2] for x in w]
    slope, icpt = np.polyfit(fs, ks, 1)
    resid = ks - (slope * fs + icpt)
    S, P = info.get('loop_start_tick'), info.get('loop_ticks')
    tick_sec = info['tick_sec_last']   # 곡의 타이머 A 값에서 나온 1틱 길이 = (1024 - 값) * 144 / 7,670,453 초
    # 참고: 맞은 프레임에서 트랙 구조체 전체(0x30 바이트)와 작업 영역 전체가 같은 비율, 다른 번지
    ex = [(f, k) for (f, k, kind) in w if kind == 'exact']
    allc = np.array(sorted(b - LO + o for b in act for o in range(0x30)))
    fe = np.array([f for f, _ in ex]); ke = np.array([k for _, k in ex])
    eq_slot = (B[fe][:, allc] == O[ke][:, allc])
    eq_all = (B[fe] == O[ke])
    bad_off = sorted({'+0x%02X' % ((int(c) + LO - 0x1C40) % 0x30) for c in allc[~eq_slot.all(axis=0)]})
    bad_all = {'$%04X' % (int(c) + LO): round(float(1 - eq_all[:, c].mean()), 4) for c in np.nonzero(~eq_all.all(axis=0))[0]}
    # miss 프레임 = 곡 틱 처리 도중에 찍힌 프레임인지: 앞뒤 프레임이 연속인지, 연달아 나오는지,
    # 그리고 트랙 단위로 보면 몇 개 트랙이 '틱 k 도 k+1 도 아닌 중간값'인지(처리 중인 트랙과 그 트랙이 다시 건 트랙)
    mp = {f: k for (f, k, _) in w}
    miss = [f for (f, k, kind) in w if kind == 'miss']
    run = 0; maxrun = 0; prev = None
    for f in miss:
        run = run + 1 if prev is not None and f == prev + 1 else 1
        maxrun = max(maxrun, run); prev = f
    gaps = []; mid_tracks = []
    tcols = [np.array([b - LO + o for o in SEQ_OFFS]) for b in act]
    for f in miss:
        a = next((mp[g] for g in range(f - 1, f - 4, -1) if mp.get(g) is not None), None)
        b = next((mp[g] for g in range(f + 1, f + 4) if mp.get(g) is not None), None)
        if a is None or b is None:
            continue
        gaps.append(b - a)
        best = 99
        for k in range(a, min(b, nO - 2) + 1):
            n = sum(1 for c in tcols if not ((B[f][c] == O[k][c]).all() or (B[f][c] == O[k + 1][c]).all()))
            best = min(best, n)
        mid_tracks.append(best)
    miss_info = {'max_consecutive': maxrun, 'tick_gap_between_neighbors_max': max(gaps) if gaps else None,
                 'tracks_in_midstate_hist': {str(n): mid_tracks.count(n) for n in sorted(set(mid_tracks))}}
    # 공개 에뮬 쪽에서 이 곡 트랙이 아닌 구조체가 켜진 프레임(효과음 등)
    other = [b for b in SLOTS if b not in act]
    other_on = {('$%04X' % b): int((B[start[0]:, b - LO] & 0x80).astype(bool).sum()) for b in other if (B[start[0]:, b - LO] & 0x80).any()}
    r = {
        'song': '0x%02X' % cid,
        'ours_ticks': nO, 'ours_tick_sec': round(tick_sec, 7), 'biz_frames': nB,
        'song_tracks': ['$%04X' % b for b in act], 'state_bytes_per_frame': int(KO.shape[1]),
        'align': {'biz_frame': start[0], 'ours_tick': start[1]},
        'frames_compared': len(w),
        'exact': kinds.count('exact'), 'between_two_ticks': kinds.count('between'), 'miss': kinds.count('miss'),
        'miss_frames': [x[0] for x in w if x[2] == 'miss'][:40],
        'ours_tick_range': [int(ks.min()), int(ks.max())],
        'dump': os.path.basename(dump), 'kind': info.get('kind'), 'end_tick': end_tick,
        'loop': {'start_tick': S, 'ticks': P, 'passes_covered': round((int(ks.max()) - S) / P, 2) if P else None},
        'ticks_per_frame_measured': round(float(slope), 6),
        'ticks_per_frame_expected': round(MD_FRAME_SEC / tick_sec, 6),
        'tempo_ratio_measured_over_expected': round(float(slope) / (MD_FRAME_SEC / tick_sec), 6),
        'tick_residual_max': round(float(np.abs(resid).max()), 3),
        # 250프레임 구간별 잔차 평균의 범위: 틱이 한 개라도 밀리면(한쪽이 틱을 더 세면) 이 값이 그만큼 벌어진다
        'tick_residual_segment_mean_range': [round(float(min(resid[a:a + 250].mean() for a in range(0, len(resid), 250))), 3),
                                             round(float(max(resid[a:a + 250].mean() for a in range(0, len(resid), 250))), 3)],
        'full_track_struct_equal_ratio_at_exact': round(float(eq_slot.all(axis=1).mean()), 4),
        'track_struct_offsets_differing': bad_off,
        'work_ram_equal_ratio_at_exact': round(float(eq_all.all(axis=1).mean()), 4),
        'work_ram_cells_differing_ratio': bad_all,
        'miss_detail': miss_info,
        'biz_other_tracks_active_frames': other_on,
    }
    os.makedirs(OUTD, exist_ok=True)
    json.dump(r, open(os.path.join(OUTD, 'state_%02x.json' % cid), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    np.save(os.path.join(WORK, 'map_%02x.npy' % cid), np.array([(f, -1 if k is None else k) for f, k, _ in w]))
    print(json.dumps(r, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
