"""장시간 실행 덤프(tools/bgm/long_run.py) + 주기(tools/bgm/long_period.py) -> 렌더용 캐시(public/assets/rom/_cache/exact_XX.pkl)와
analysis/data/bgm_loops.json 의 곡 항목. loop_exact.py 를 다시 돌리지 않기 위한 변환기(같은 실행 방법·같은 형식).
loop_exact.py 가 이 곡들을 못 잡은 이유: 곡 진행 상태에 '쓰지 않는 트랙'의 남은 길이(+0x0B)까지 넣었는데,
템포 지연(Z80 0x0871)이 쓰지 않는 트랙의 +0x0B 도 계속 늘려서 영영 같아지지 않았다(0x98 의 PSG 트랙 3개). 소리와 무관한 번지다.
사용: python -I tools/bgm/long_to_cache.py <id_hex ...>
"""
import importlib.util
import json
import os
import pickle
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_s = importlib.util.spec_from_file_location('z80snd', os.path.join(ROOT, 'analysis', 'scripts', 'z80snd.py'))
Z = importlib.util.module_from_spec(_s); _s.loader.exec_module(Z)
D = os.path.join(ROOT, 'tools', 'ext_emu', 'work', 'bgm', 'long')
OUTD = os.path.join(ROOT, 'analysis', 'data', '35_bgm_oracle')
CACHE = os.path.join(ROOT, 'public', 'assets', 'rom', '_cache')
META = os.path.join(ROOT, 'analysis', 'data', 'bgm_loops.json')
DT = np.dtype([('t', '<u8'), ('k', 'u1'), ('a', 'u1'), ('d', 'u1')])


def main():
    meta = json.load(open(META, encoding='utf-8'))
    for tag in [a.lower() for a in sys.argv[1:]]:
        per = json.load(open(os.path.join(OUTD, 'period_%s.json' % tag), encoding='utf-8'))
        assert per.get('loop_ticks'), '주기 미확정'
        assert per['keyon_equal'] and per['psg_equal']
        T = np.load(os.path.join(D, 'ticks_%s.npy' % tag))
        raw = np.fromfile(os.path.join(D, 'log_%s.bin' % tag), dtype=DT)
        pre = np.fromfile(os.path.join(D, 'pre_%s.bin' % tag), dtype=DT)
        pre_log = [(0, int(k), int(a), int(d)) for (_, k, a, d) in pre.tolist() if k != 0 or a != 0x28]
        log = pre_log + [(int(t), int(k), int(a), int(d)) for (t, k, a, d) in raw.tolist()]
        L = (np.searchsorted(raw['t'], T, side='left') + len(pre_log)).tolist()
        S, P = per['loop_start_tick'], per['loop_ticks']
        total_t = int(raw['t'][-1]) + 1
        info = {'id': '0x%s' % tag.upper(), 'ticks': per['ticks_run'], 'emulated_sec': per['sec_run'], 'timer_a_values': [180],
                'level': 'sequence(active tracks + delay counter)' if per['full_ram_equal_tick_ratio'] < 1 else 'full-state',
                'tick_sec_last': round((1024 - 180) * 144 / Z.YM_CLK, 8),
                'kind': 'loop', 'loop_start_tick': S, 'loop_ticks': P,
                'loop_start_sec': round(float(T[S]) / Z.Z_CLK, 5), 'loop_end_sec': round(float(T[S + P]) / Z.Z_CLK, 5),
                'loop2_end_sec': round(float(T[S + 2 * P]) / Z.Z_CLK, 5),
                'loop_len_sec': round(float(T[S + P] - T[S]) / Z.Z_CLK, 5), 'pass2_len_sec': round(float(T[S + 2 * P] - T[S + P]) / Z.Z_CLK, 5),
                'state_ticks_verified': per['ticks_verified_after_first_pass'],
                'keyon_writes': per['keyon_writes'], 'keyon_equal': per['keyon_equal'], 'psg_writes': per['psg_writes'], 'psg_equal': per['psg_equal'],
                'writes_pass1': per['writes_pass1'], 'writes_pass2': per['writes_pass2'], 'full_ram_equal_tick_ratio': per['full_ram_equal_tick_ratio'],
                'tempo_delay_N': per['tempo_delay_N'], 'laps_per_period': per.get('laps_per_period'),
                'source': 'tools/bgm/long_run.py + long_period.py + long_to_cache.py (analysis/35_bgm_port_plan.md §8)'}
        if per['full_ram_equal_tick_ratio'] < 1:
            info['nonperiodic_cells'] = per['ram_cells_differing']
        # 타이머 A 값이 실제로 180 인지 확인(로그에 타이머 쓰기는 없으므로 틱 간격으로)
        dt = float(np.median(np.diff(T[1000:2000]))) / Z.Z_CLK
        assert abs(dt - info['tick_sec_last']) < 2e-5, dt
        pickle.dump({'log': log, 'total_t': total_t, 'T': T.tolist(), 'L': L, 'info': info}, open(os.path.join(CACHE, 'exact_%s.pkl' % tag), 'wb'))
        meta['songs'][tag] = info
        print(json.dumps(info, ensure_ascii=False))
    json.dump(meta, open(META, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
