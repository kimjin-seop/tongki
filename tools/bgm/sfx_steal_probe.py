"""효과음이 곡 FM 채널을 가로채는 원작 동작 실측(자작 Z80 실행). 판독·규칙: analysis/35_bgm_port_plan.md §10
곡을 틀고 일정 시각에 효과음 명령을 넣은 뒤, 곡 트랙·효과음 트랙의 상태 비트와 채널별 YM 쓰기 수를 틱 단위로 기록한다.
사용: python -I tools/bgm/sfx_steal_probe.py   -> analysis/data/35_bgm_oracle/sfx_steal_probe.json
"""
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_s = importlib.util.spec_from_file_location('z80snd', os.path.join(ROOT, 'analysis', 'scripts', 'z80snd.py'))
Z = importlib.util.module_from_spec(_s); _s.loader.exec_module(Z)
MUS = {'FM5': 0x1D00, 'FM6': 0x1D30}
SFX = {'FM5': 0x1EB0, 'FM6': 0x1EE0}


def frames(z, n):
    for _ in range(n):
        z.run_until(z.t + Z.FRAME_T); z.interrupt()


def chan_writes(log):
    """YM 쓰기를 채널별로 센다. 반환 {'FM5': n, 'FM6': n, 'keyon5': n, 'keyon6': n}"""
    r = {'FM5': 0, 'FM6': 0, 'keyon5': 0, 'keyon6': 0, 'other': 0}
    for (_, k, a, d) in log:
        if k == 0 and a == 0x28:
            if (d & 7) == 5: r['keyon5'] += 1 if d & 0xF0 else 0
            elif (d & 7) == 6: r['keyon6'] += 1 if d & 0xF0 else 0
        elif k == 1 and 0x30 <= a < 0xB8 and (a & 3) == 1: r['FM5'] += 1
        elif k == 1 and 0x30 <= a < 0xB8 and (a & 3) == 2: r['FM6'] += 1
        else: r['other'] += 1
    return r


def state(z):
    m = z.mem
    return {'mus_FM5': '%02X' % m[MUS['FM5']], 'mus_FM6': '%02X' % m[MUS['FM6']], 'sfx_FM5': '%02X' % m[SFX['FM5']], 'sfx_FM6': '%02X' % m[SFX['FM6']],
            'prio_1C19': '%02X' % m[0x1C19], 'mus_FM5_ptr': '%04X' % (m[MUS['FM5'] + 3] | m[MUS['FM5'] + 4] << 8)}


def scenario(song, cmds, total_frames):
    """cmds: [(프레임, 메일박스 번지, 값)]"""
    z = Z.boot(os.path.join(ROOT, 'rom', 'danpei.gen'))
    frames(z, 10)
    z.mem[0x1C0A] = song
    out = []
    for f in range(total_frames):
        for (cf, slot, val) in cmds:
            if cf == f:
                z.mem[slot] = val
        z.log = []
        frames(z, 1)
        st = state(z); st.update(frame=f, writes=chan_writes(z.log))
        out.append(st)
    return out


def brief(rows, pick):
    return [{k: r[k] for k in ('frame', 'mus_FM5', 'mus_FM6', 'sfx_FM5', 'sfx_FM6', 'prio_1C19', 'writes')} for r in rows if r['frame'] in pick]


def spans(rows, key, bit):
    """key 의 bit 가 켜져 있던 프레임 구간"""
    res = []; s = None
    for r in rows:
        on = bool(int(r[key], 16) & bit)
        if on and s is None: s = r['frame']
        if not on and s is not None: res.append([s, r['frame'] - 1]); s = None
    if s is not None: res.append([s, rows[-1]['frame']])
    return res


def main():
    R = {}
    # A: 곡 0x81 + 300프레임째 효과음 0xAA(FM5+FM6, 우선순위 0x75)
    a = scenario(0x81, [(300, 0x1C0A, 0xAA)], 420)
    base = scenario(0x81, [], 420)
    R['A_song81_sfxAA'] = {
        'music_FM5_overridden_frames(bit2)': spans(a, 'mus_FM5', 4), 'music_FM6_overridden_frames(bit2)': spans(a, 'mus_FM6', 4),
        'sfx_FM5_playing_frames(bit7)': spans(a, 'sfx_FM5', 0x80), 'sfx_FM6_playing_frames(bit7)': spans(a, 'sfx_FM6', 0x80),
        'music_pointer_same_as_no_sfx_run_all_frames': all(x['mus_FM5_ptr'] == y['mus_FM5_ptr'] for x, y in zip(a, base)),
        'keyon_FM5_during_300_420': {'with_sfx': sum(r['writes']['keyon5'] for r in a[300:]), 'no_sfx': sum(r['writes']['keyon5'] for r in base[300:])},
        'prio_1C19_frames_nonzero': spans(a, 'prio_1C19', 0xFF), 'sample': brief(a, (299, 300, 301, 302, 310))}
    # B: 0xAA(0x75) 재생 중에 낮은 우선순위 0xA0(0x70) -> 버려지는가 / 높은 0xAE(0x78) -> 바뀌는가
    b = scenario(0x81, [(300, 0x1C0A, 0xAA), (303, 0x1C0A, 0xA0)], 360)
    c = scenario(0x81, [(300, 0x1C0A, 0xAA), (303, 0x1C0A, 0xAE)], 360)
    a2 = a[:360]
    R['B_lower_priority_A0_during_AA'] = {'state_identical_to_A': all(x['sfx_FM5'] == y['sfx_FM5'] and x['writes'] == y['writes'] for x, y in zip(b, a2))}
    R['C_higher_priority_AE_during_AA'] = {'state_identical_to_A': all(x['sfx_FM5'] == y['sfx_FM5'] and x['writes'] == y['writes'] for x, y in zip(c, a2)),
                                           'prio_after': c[306]['prio_1C19']}
    # D: 효과음 재생 중 새 곡 명령 -> 효과음도 끊기는가
    d = scenario(0x81, [(300, 0x1C0A, 0xB0), (310, 0x1C0A, 0x8C)], 330)
    R['D_new_song_during_sfx'] = {'sfx_FM5_playing_frames': spans(d, 'sfx_FM5', 0x80), 'sample': brief(d, (309, 310, 311, 312))}
    # E: 같은 폴링 구간에 메일박스 3개가 다 찬 경우(0x1C0A=A0, 0x1C0B=AA, 0x1C0C=A1): 마지막으로 통과한 것만 남는가
    e = scenario(0x81, [(300, 0x1C0A, 0xA0), (300, 0x1C0B, 0xAA), (300, 0x1C0C, 0xA1)], 330)
    R['E_three_mailboxes_same_frame'] = {'sfx_FM5_playing_frames': spans(e, 'sfx_FM5', 0x80), 'sfx_FM6_playing_frames': spans(e, 'sfx_FM6', 0x80), 'prio_after': e[302]['prio_1C19']}
    outp = os.path.join(ROOT, 'analysis', 'data', '35_bgm_oracle', 'sfx_steal_probe.json')
    json.dump(R, open(outp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(R, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
