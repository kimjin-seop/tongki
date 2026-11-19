"""BGM 오라클 교차 확인 2: 소리 대조. 방법·판정: analysis/35_bgm_port_plan.md §4

 공개 에뮬(BizHawk / Genesis Plus GX)이 부팅부터 돌려 녹음한 소리(tools/ext_emu/work/bgm/biz_8c.wav, 모드 메뉴 곡 0x8C)
 대 웹이 실제로 트는 파일(public/assets/rom/bgm/8c.ogg) + manifest 의 루프 지점.
 (1) 곡 명령 시점(compare_state.py 가 찾은 정렬)부터 2초 창마다 로그 스펙트로그램 상관 = 같은 곡·같은 박자인지
 (2) 공개 에뮬 녹음 안에서 1회차와 2~4회차의 음 변화량 교차상관이 최대인 지연 = 공개 에뮬에서 잰 루프 길이와 우리 루프 길이의 차(ms)
 (3) 웹 루프 구간 [loop_start, loop_end] 을 이어 붙인 2·3회차를 공개 에뮬 녹음과 대조
사용: python -I tools/bgm/oracle/compare_audio.py [곡 hex=8c]   (같은 곡의 compare_state.py 를 먼저 실행)
 곡 지정 시 녹음 = biz_XX.wav(run_biz_song.ps1), 웹 파일 = manifest 에서 rom_id 가 그 곡인 첫 bgm.* 키.
 1회 곡(루프 없음)은 (1)과 대역 비교만 한다.
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np
from scipy.signal import stft

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
WORK = os.path.join(ROOT, 'tools', 'ext_emu', 'work', 'bgm')
OUTD = os.path.join(ROOT, 'analysis', 'data', '35_bgm_oracle')
SR = 44100
MD_FRAME_SEC = 3420 * 262 / 53693175


def corr(a, b):
    a = a - a.mean(); b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


def spec(x, hop=441, win=2048):
    _, _, Zx = stft(x, fs=SR, nperseg=win, noverlap=win - hop, boundary=None, padded=False)
    return np.log1p(1000 * np.abs(Zx))


def flux(x, hop=44, win=1024):
    _, _, Zx = stft(x, fs=SR, nperseg=win, noverlap=win - hop, boundary=None, padded=False)
    M = np.log1p(1000 * np.abs(Zx))
    return np.maximum(M[:, 1:] - M[:, :-1], 0).sum(axis=0)


def best_lag(u, v, L=60):
    """1ms 간격 플럭스 열 u, v 의 교차상관이 최대인 지연(ms)"""
    fa = flux(u); fb = flux(v); best = (-2, 0)
    for lag in range(-L, L + 1):
        a = fa[L:-L]; b = fb[L + lag:len(fb) - L + lag]
        q = min(len(a), len(b)); c = corr(a[:q], b[:q])
        if c > best[0]:
            best = (c, lag)
    return best[1], round(best[0], 4)


def main():
    tag = (sys.argv[1] if len(sys.argv) > 1 else '8c').lower()
    st = json.load(open(os.path.join(OUTD, 'state_%s.json' % tag), encoding='utf-8'))
    info = json.load(open(os.path.join(ROOT, 'analysis', 'data', 'bgm_loops.json'), encoding='utf-8'))['songs'][tag]
    allman = json.load(open(os.path.join(ROOT, 'public', 'assets', 'manifest.json'), encoding='utf-8'))
    mkey = next((k for k, v in sorted(allman.items()) if k.startswith('bgm.') and isinstance(v, dict) and v.get('rom_id', '').lower() == '0x' + tag), None)
    cand = [a for a in sys.argv[2:] if not a.startswith('-')]
    if cand or mkey is None:
        # manifest 에 없는 곡(꺼 둔 곡) 또는 비교 렌더: bgm_loops.json 의 render_<폴더> 항목을 쓴다. 예: compare_audio.py 85 bgm_cand
        rk = 'render_' + (cand[0] if cand else 'bgm_cand')
        rr = info[rk]
        man = {'path': rr['ogg'], 'loop_start': rr.get('loop_start'), 'loop_end': rr.get('loop_end')}
        mkey = '(%s)' % rk
    else:
        man = allman[mkey]
    is_loop = info['kind'] == 'loop'
    w = wave.open(os.path.join(WORK, 'biz_%s.wav' % tag))
    assert w.getframerate() == SR, w.getframerate()
    ref = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float64).reshape(-1, w.getnchannels()).mean(axis=1) / 32768
    # 덤프 프레임 번호 f(0 부터) = frameadvance f+1 번 뒤의 상태. 곡 명령 시점(프레임) = 정렬 프레임 - 정렬 틱 / (프레임당 틱)
    f_cmd = st['align']['biz_frame'] + 1 - st['align']['ours_tick'] / st['ticks_per_frame_expected']
    t_cmd = f_cmd * MD_FRAME_SEC
    ogg = os.path.join(ROOT, 'public', 'assets', man['path'])
    # 좌우 평균은 직접 낸다(ffmpeg 의 -ac 1 은 평균이 아니라 약 +3dB 로 섞는다)
    xs = np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', ogg, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-']), '<f4').astype(np.float64).reshape(-1, 2)
    x = xs.mean(axis=1)
    S, P = (info['loop_start_sec'], info['loop_len_sec']) if is_loop else (0.0, len(x) / SR)
    # (1) 곡 시작 지연(처음 4초, +-150ms) -> 그 지연을 고정하고 2초 창마다 상관(창별 지연도 기록)
    n4 = min(4 * SR, len(x)); best = (-2, 0)
    A = spec(x[:n4])
    for lag in range(-int(0.15 * SR), int(0.15 * SR), 44):
        s = int(t_cmd * SR) + lag
        c = corr(A.ravel(), spec(ref[s:s + n4]).ravel())
        if c > best[0]:
            best = (c, lag)
    lag0 = best[1]; s0 = int(t_cmd * SR) + lag0
    wins = []
    for k in range(0, max(int(len(x) / SR) - 2, 1), 2):
        a = x[k * SR:(k + 2) * SR]; b = ref[s0 + k * SR:s0 + (k + 2) * SR]
        fixed = corr(spec(a).ravel(), spec(b).ravel())
        dl, _ = best_lag(a, b)
        wins.append({'sec': k, 'corr_fixed_lag': round(fixed, 3), 'local_lag_ms': dl,
                     'gain_db_ours_over_ref': round(20 * np.log10(np.sqrt((a ** 2).mean()) / (np.sqrt((b ** 2).mean()) + 1e-20)), 2)})
    # 대조군: 0.5초 어긋나게
    c0, c1 = (2 * SR, 6 * SR) if len(x) >= 6 * SR else (0, len(x))
    ctrl = corr(spec(x[c0:c1]).ravel(), spec(ref[s0 + c0 + SR // 2:s0 + c1 + SR // 2]).ravel())
    # (2) 공개 에뮬 녹음 안의 루프 길이
    n = int(round(P * SR)); a0 = s0 + int(round(S * SR))
    p1 = ref[a0:a0 + n]; loops = []
    for j in ((1, 2, 3) if is_loop else ()):
        pj = ref[a0 + j * n:a0 + (j + 1) * n]
        if len(pj) < n:
            break
        lag, c = best_lag(p1, pj)
        loops.append({'pass': j + 1, 'lag_ms_vs_pass1': lag, 'flux_corr': c, 'spec_corr': round(corr(spec(p1).ravel(), spec(pj).ravel()), 4)})
    # (3) 웹 루프 구간을 이어 붙인 2·3회차 대 공개 에뮬 녹음
    ls, le = (man['loop_start'], man['loop_end']) if is_loop else (0.0, 0.0)
    i0, i1 = int(round(ls * SR)), int(round(le * SR))
    web = np.concatenate([x[:i1], x[i0:i1], x[i0:i1]])
    seg = []
    for k in (range(int(le), int(len(web) / SR) - 2, 2) if is_loop else ()):
        a = web[k * SR:(k + 2) * SR]; b = ref[s0 + k * SR:s0 + (k + 2) * SR]
        if len(b) < len(a):
            break
        dl, _ = best_lag(a, b)
        seg.append({'sec': k, 'corr_fixed_lag': round(corr(spec(a).ravel(), spec(b).ravel()), 3), 'local_lag_ms': dl})
    # 대역별 세기 비(우리 / 공개 에뮬, dB). 루프 1회차 구간
    from scipy.signal import welch
    u = x[int(S * SR):int((S + P) * SR)]; v = ref[s0 + int(S * SR):s0 + int((S + P) * SR)]
    f, Po = welch(u, SR, nperseg=8192); _, Pr = welch(v, SR, nperseg=8192)
    bands = {'%d-%dHz' % (lo, hi): round(float(10 * np.log10(Po[(f >= lo) & (f < hi)].sum() / Pr[(f >= lo) & (f < hi)].sum())), 2)
             for lo, hi in ((20, 200), (200, 1000), (1000, 4000), (4000, 10000), (10000, 20000))}
    cf = [v['corr_fixed_lag'] for v in wins]; cl = [v['corr_fixed_lag'] for v in seg]
    r = {'song': '0x' + tag.upper(), 'manifest_key': mkey, 'kind': info['kind'], 'ref_wav_sec': round(len(ref) / SR, 3), 'ref_peak': round(float(np.abs(ref).max()), 3),
         'cmd_frame_est': round(f_cmd, 2), 'cmd_sec_est': round(t_cmd, 4), 'start_lag_ms': round(1000 * lag0 / SR, 1), 'start_corr_4s': round(best[0], 3),
         'file_windows': wins, 'file_corr_min': min(cf), 'file_corr_median': round(float(np.median(cf)), 3),
         'file_local_lag_ms_range': [min(v['local_lag_ms'] for v in wins), max(v['local_lag_ms'] for v in wins)],
         'control_shift500ms_corr': round(ctrl, 3),
         'ref_loop_passes': loops,
         'web_loop': {'loop_start': ls, 'loop_end': le, 'len': round(le - ls, 5), 'oracle_len': P} if is_loop else None,
         'web_looped_windows': seg, 'web_looped_corr_min': min(cl) if cl else None,
         'web_looped_local_lag_ms_range': [min(v['local_lag_ms'] for v in seg), max(v['local_lag_ms'] for v in seg)] if seg else None,
         'band_db_ours_over_ref': bands,
         'gain_db_ours_over_ref_median': round(float(np.median([v['gain_db_ours_over_ref'] for v in wins])), 2)}
    json.dump(r, open(os.path.join(OUTD, 'audio_%s%s.json' % (tag, ('_' + cand[0]) if cand else '')), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(r, ensure_ascii=False))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
