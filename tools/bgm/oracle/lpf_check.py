"""BGM 오라클 교차 확인 3: 고음 대역 차이의 원인 확인. 방법·판정: analysis/35_bgm_port_plan.md §9

 기준 에뮬(BizHawk 2.11.1 Genesis Plus GX)은 44.1kHz 출력에 1차 저역 통과 필터를 건다(설정 Filter=LowPass, LowPassRange=0x6666):
   y[n] = (a*y[n-1] + (1-a)*x[n]),  a = 0x6666/0x10000 = 0.39999   (Genesis Plus GX core/system.c audio_update)
 우리 렌더(libgme)에는 이 필터가 없다. 같은 필터를 우리 파일에 걸면 대역별 세기 비가 평평해지는지,
 그리고 대역 비에서 거꾸로 맞춘 a 가 0.4 근처인지 본다.
 입력: analysis/data/35_bgm_oracle/state_XX.json·audio_XX.json(정렬), tools/ext_emu/work/bgm/biz_XX.wav, 웹 파일(또는 --dir 로 준 폴더의 XX.ogg)
사용: python -I tools/bgm/oracle/lpf_check.py <곡 hex> [--dir public/assets/rom/bgm_lpf] [--nofilter]
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np
from scipy.signal import lfilter, stft, welch

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
WORK = os.path.join(ROOT, 'tools', 'ext_emu', 'work', 'bgm')
OUTD = os.path.join(ROOT, 'analysis', 'data', '35_bgm_oracle')
SR = 44100
A_REF = 0x6666 / 0x10000
EDGES = (20, 200, 1000, 2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 20000)


def corr(a, b):
    a = a - a.mean(); b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


def spec(x, hop=441, win=2048):
    _, _, Zx = stft(x, fs=SR, nperseg=win, noverlap=win - hop, boundary=None, padded=False)
    return np.log1p(1000 * np.abs(Zx))


def lpf(x, a):
    return lfilter([1 - a], [1, -a], x)


def bands(u, v):
    f, Pu = welch(u, SR, nperseg=8192); _, Pv = welch(v, SR, nperseg=8192)
    out = {}
    for lo, hi in zip(EDGES[:-1], EDGES[1:]):
        m = (f >= lo) & (f < hi)
        out['%d-%d' % (lo, hi)] = round(float(10 * np.log10(Pu[m].sum() / Pv[m].sum())), 2)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    tag = args[0].lower()
    d = None
    if '--dir' in sys.argv:
        d = sys.argv[sys.argv.index('--dir') + 1]
        args = [a for a in args if a != d]
    st = json.load(open(os.path.join(OUTD, 'state_%s.json' % tag), encoding='utf-8'))
    au = json.load(open(os.path.join(OUTD, 'audio_%s.json' % tag), encoding='utf-8'))
    info = json.load(open(os.path.join(ROOT, 'analysis', 'data', 'bgm_loops.json'), encoding='utf-8'))['songs'][tag]
    ogg = os.path.join(ROOT, d, tag + '.ogg') if d else os.path.join(ROOT, 'public', 'assets', 'rom', 'bgm', tag + '.ogg')
    w = wave.open(os.path.join(WORK, 'biz_%s.wav' % tag))
    ref = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float64).reshape(-1, w.getnchannels()).mean(axis=1) / 32768
    x = np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', ogg, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-']), '<f4').astype(np.float64).reshape(-1, 2).mean(axis=1)
    s0 = int(au['cmd_sec_est'] * SR) + int(round(au['start_lag_ms'] * SR / 1000))
    if info['kind'] == 'loop':
        a0, a1 = int(info['loop_start_sec'] * SR), int((info['loop_start_sec'] + info['loop_len_sec']) * SR)
    else:
        a0, a1 = 0, len(x)
    a1 = min(a1, len(x), len(ref) - s0)
    u = x[a0:a1]; v = ref[s0 + a0:s0 + a1]
    r = {'song': '0x' + tag.upper(), 'file': os.path.relpath(ogg, ROOT).replace('\\', '/'), 'segment_sec': [round(a0 / SR, 3), round(a1 / SR, 3)],
         'ref_filter': 'y[n] = a*y[n-1] + (1-a)*x[n], a = 0x6666/0x10000 = %.5f (BizHawk GPGX Filter=LowPass, LowPassRange=0x6666)' % A_REF}

    def measure(sig):
        b = bands(sig, v)
        g = float(np.median([b[k] for k in ('200-1000', '1000-2000', '2000-4000')]))   # 전체 이득 차(중역 기준)
        return {'band_db_ours_over_ref': b, 'mid_gain_db': round(g, 2),
                'band_db_minus_mid_gain': {k: round(val - g, 2) for k, val in b.items()},
                'spec_corr': round(corr(spec(sig).ravel(), spec(v).ravel()), 4)}
    r['as_is'] = measure(u)
    if '--nofilter' not in sys.argv:
        r['with_ref_lpf'] = measure(lpf(x, A_REF)[a0:a1])
        # 대역 비에서 거꾸로 맞춘 a: 2kHz 위 대역의 (이득 뺀) 차의 제곱합이 최소인 a
        best = None; curve = {}
        for a in np.arange(0.0, 0.801, 0.02):
            m = measure(lpf(x, a)[a0:a1])
            e = float(sum(val ** 2 for k, val in m['band_db_minus_mid_gain'].items() if int(k.split('-')[0]) >= 2000))
            curve['%.2f' % a] = round(e, 2)
            if best is None or e < best[1]:
                best = (float(a), e, m['spec_corr'])
        r['fit'] = {'a_best': round(best[0], 2), 'sq_err_db2': round(best[1], 2), 'spec_corr_at_best': best[2], 'sq_err_by_a': curve}
    name = 'lpf_%s%s.json' % (tag, '_' + os.path.basename(d.rstrip('/\\')) if d else '')
    json.dump(r, open(os.path.join(OUTD, name), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(r, ensure_ascii=False))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
