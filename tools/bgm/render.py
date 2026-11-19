"""원작 BGM 렌더 + 오디오 영역 수치 검증. 입력: tools/bgm/loop_exact.py 의 캐시(public/assets/rom/_cache/exact_XX.pkl).
출력: public/assets/rom/bgm/XX.ogg|mp3 (gitignore), analysis/data/bgm_loops.json 의 곡별 render 항목.

- 루프 곡: 0 ~ (루프 2회차 끝 S+2P) 까지 렌더해 1회차와 2회차 파형을 비교한 뒤,
  파일에는 0 ~ S+P+SEAM+PAD 초만 담는다. 재생 루프 구간 = [S+SEAM, S+P+SEAM].
  (SEAM 초 뒤로 민 이유: 루프 끝에서 되돌아갈 때 인트로 꼬리음 대신 '루프 끝 음의 잔향'이 이어지도록. 구간 길이는 P 그대로)
- 끝나는 곡: 0 ~ 끝+TAIL 초, 뒤 무음 제거.
- 음량: 효과음 렌더(analysis/data/rom_audio.json 의 sfx_gain_db)와 같은 이득을 모든 곡에 적용 = 원작 칩 출력의 BGM:효과음 비율 유지.
수치 검증(청취 불필요): ① 1·2회차 스펙트로그램 상관(지연 0)과 0.5초 어긋난 대조군 ② 음 변화량 교차상관이 최대인 지연(=오디오에서 잰 루프 길이 오차, ms) ③ 이음매 앞뒤 0.5초 스펙트로그램 상관
사용: python tools/bgm/render.py [병렬수] [id_hex ...]
비교 렌더(제품 파일·manifest 를 건드리지 않는다, analysis/35_bgm_port_plan.md §9):
  BGM_OUT_DIR=bgm_lpf   출력 폴더(public/assets/rom/ 아래). 지정하면 결과를 곡 항목의 render 가 아니라 render_<폴더이름> 에 적는다
  BGM_LPF_A=0.4         44.1kHz 출력에 1차 저역 통과 y[n] = a*y[n-1] + (1-a)*x[n] 를 건다(기준 에뮬 BizHawk GPGX 의 값은 0x6666/0x10000)
"""
import importlib.util
import json
import os
import pickle
import subprocess
import sys
import wave
from multiprocessing import Pool

import numpy as np
from scipy.signal import resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_s = importlib.util.spec_from_file_location('z80snd', os.path.join(ROOT, 'analysis', 'scripts', 'z80snd.py'))
Z = importlib.util.module_from_spec(_s); _s.loader.exec_module(Z)
CACHE = os.path.join(ROOT, 'public', 'assets', 'rom', '_cache')
OUT_NAME = os.environ.get('BGM_OUT_DIR', 'bgm')
OUT_BGM = os.path.join(ROOT, 'public', 'assets', 'rom', OUT_NAME)
LPF_A = float(os.environ['BGM_LPF_A']) if os.environ.get('BGM_LPF_A') else None
META = os.path.join(ROOT, 'analysis', 'data', 'bgm_loops.json')
SFX_GAIN_DB = json.load(open(os.path.join(ROOT, 'analysis', 'data', 'rom_audio.json'), encoding='utf-8'))['sfx_gain_db']
SR = 44100
SEAM, PAD, TAIL = 2.0, 0.25, 3.0
# ffmpeg libgme 렌더의 시간축 보정(2026-11-18 실측, 합성 클릭 41개·200초, FM·PSG 공통, 잔차 0.06ms 이하):
#  - 앞 무음을 잘라 낸다(잘린 길이 불명) → 로그 시각 0 에 PSG 표식음을 넣어 기준점으로 삼고, 곡은 LEAD 초 뒤에 둔다
#  - 출력이 2049/2048 배(0.0488%) 늘어진다 → 2048/2049 로 리샘플해 원래 시간축으로 되돌린다
LEAD = 0.5
GME_UP, GME_DOWN = 2049, 2048
_m = int(0.005 * Z.Z_CLK)
# 표식: PSG 채널0 주기 0x02E·최대 음량 5ms → 소거·주기 0(전원 초기값)으로 복원
MARK = [(0, 2, 0, 0x8E), (0, 2, 0, 0x02), (0, 2, 0, 0x90), (_m, 2, 0, 0x9F), (_m, 2, 0, 0x80), (_m, 2, 0, 0x00)]


def readwav(p):
    w = wave.open(p)
    x = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float64) / 32768
    return x.reshape(-1, w.getnchannels()), w.getframerate()


def writewav(p, x, sr):
    y = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    with wave.open(p, 'wb') as w:
        w.setnchannels(x.shape[1]); w.setsampwidth(2); w.setframerate(sr); w.writeframes(y.tobytes())


def corr(a, b):
    a = a - a.mean(); b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


def spec(x, hop=441, win=2048):
    """로그 크기 스펙트로그램(주파수 x 시간)"""
    from scipy.signal import stft
    _, _, Zx = stft(x, fs=SR, nperseg=win, noverlap=win - hop, boundary=None, padded=False)
    return np.log1p(1000 * np.abs(Zx))


def flux(x, hop=44, win=1024):
    """1ms 간격 스펙트럼 플럭스(양의 변화량 합)"""
    from scipy.signal import stft
    _, _, Zx = stft(x, fs=SR, nperseg=win, noverlap=win - hop, boundary=None, padded=False)
    M = np.log1p(1000 * np.abs(Zx))
    return np.maximum(M[:, 1:] - M[:, :-1], 0).sum(axis=0)


def render(cid):
    tag = '%02x' % cid
    p = os.path.join(CACHE, 'exact_%s.pkl' % tag)
    if not os.path.exists(p):
        return tag, None
    c = pickle.load(open(p, 'rb'))
    info = c['info']
    if info['kind'] == 'unknown':
        return tag, None
    t_end = (info['loop2_end_sec'] + 0.5) if info['kind'] == 'loop' else (info['end_sec'] + TAIL)
    t_end_T = min(int(t_end * Z.Z_CLK), c['total_t'])
    lead = int(LEAD * Z.Z_CLK)
    log = MARK + [(w[0] + lead, w[1], w[2], w[3]) for w in c['log'] if w[0] <= t_end_T]
    vgm = os.path.join(CACHE, 'r%s.vgm' % tag); raw = os.path.join(CACHE, 'r%s.wav' % tag)
    open(vgm, 'wb').write(Z.make_vgm(log, t_end_T + lead))
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'libgme', '-i', vgm, '-ar', str(SR), raw], check=True, timeout=1200)
    x, sr = readwav(raw)
    os.remove(vgm); os.remove(raw)
    assert sr == SR
    # 시간축 보정: 표식음 시작 = 로그 시각 0, 길이 2048/2049 배(libgme 늘어짐 제거) → 표식 구간(LEAD) 제거
    m0 = int(np.nonzero(np.abs(x).max(axis=1) > 0.02)[0][0])
    assert m0 < 0.1 * sr, m0
    x = resample_poly(x[m0:], GME_DOWN, GME_UP, axis=0)[int(LEAD * sr):]
    r = {'rendered_sec': round(len(x) / sr, 3), 'expected_sec': round(t_end_T / Z.Z_CLK, 3), 'marker_onset_ms': round(1000 * m0 / sr, 2),
         'time_scale_fix': '%d/%d' % (GME_DOWN, GME_UP)}
    if LPF_A is not None:
        from scipy.signal import lfilter
        x = lfilter([1 - LPF_A], [1, -LPF_A], x, axis=0)
        r['lpf_a'] = LPF_A
    m = x.mean(axis=1)
    if info['kind'] == 'loop':
        S = info['loop_start_sec']; P = info['loop_end_sec'] - info['loop_start_sec']
        s0 = int(round(S * sr)); n = int(round(P * sr)); d = int(SEAM * sr)
        a = m[s0 + d:s0 + n]; b = m[s0 + n + d:s0 + 2 * n]
        k = min(len(a), len(b)); a = a[:k]; b = b[:k]
        # 파형 그대로의 상관(참고): FM 위상은 타이머 B(128Hz) 변조와 타이머 A(곡 틱)의 어긋남 때문에 회차마다 달라 낮게 나온다
        r['wave_corr'] = round(corr(a, b), 4)
        # 스펙트럼(위상 무시) 대조: 10ms 간격 로그 크기 스펙트로그램 상관
        A = spec(a); B = spec(b)
        r['pass_corr'] = round(corr(A.ravel(), B.ravel()), 4)
        # 대조군: 2회차를 0.5초 어긋나게 놓았을 때(틀린 루프 길이라면 이 정도로 떨어진다)
        r['pass_corr_shift500ms'] = round(corr(A[:, :-50].ravel(), B[:, 50:].ravel()), 4)
        # 지연 탐색(±60ms, 1ms 간격): 음 변화량(스펙트럼 플럭스) 열의 교차상관이 최대인 지연 = 오디오에서 잰 루프 길이 오차
        fa = flux(a); fb = flux(b); L = 60; best = (-2, 0)
        for lag in range(-L, L + 1):
            u = fa[L:-L]; v = fb[L + lag:len(fb) - L + lag]
            q = min(len(u), len(v)); cc = corr(u[:q], v[:q])
            if cc > best[0]:
                best = (cc, lag)
        r['best_lag_ms'] = float(best[1]); r['best_lag_corr'] = round(best[0], 4)
        h = int(0.5 * sr)
        r['seam_corr'] = round(corr(spec(m[s0 + d - h:s0 + d + h]).ravel(), spec(m[s0 + n + d - h:s0 + n + d + h]).ravel()), 4)
        end = s0 + n + d + int(PAD * sr)
        y = x[:end]
        r.update(loop=True, loop_start=round((s0 + d) / sr, 5), loop_end=round((s0 + n + d) / sr, 5), loop_len=round(n / sr, 5),
                 seam_shift_sec=SEAM)
    else:
        e = int((info['end_sec'] + TAIL) * sr)
        a = np.abs(x[:e]).max(axis=1)
        nz = np.nonzero(a > 10 ** (-60 / 20))[0]
        y = x[:(nz[-1] + int(0.05 * sr)) if len(nz) else e]
        r.update(loop=False, last_sound_sec=round((nz[-1] / sr) if len(nz) else 0, 3))
    g = 10 ** (SFX_GAIN_DB / 20)
    y = y * g
    pk = float(np.abs(y).max())
    r.update(sec=round(len(y) / sr, 3), gain_db=SFX_GAIN_DB, peak_dbfs=round(20 * np.log10(pk), 2) if pk else None,
             rms_dbfs=round(20 * np.log10(float(np.sqrt(np.mean(y ** 2))) + 1e-12), 1), clipped_samples=int(np.sum(np.abs(y) >= 1.0)))
    wav = os.path.join(CACHE, 'o%s.wav' % tag)
    writewav(wav, y, sr)
    ogg = os.path.join(OUT_BGM, tag + '.ogg'); mp3 = os.path.join(OUT_BGM, tag + '.mp3')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-q:a', '4', ogg], check=True, timeout=600)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '128k', mp3], check=True, timeout=600)
    # 인코딩 뒤 길이 확인(ogg 디코딩)
    chk = os.path.join(CACHE, 'c%s.wav' % tag)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', ogg, chk], check=True, timeout=600)
    z, _ = readwav(chk)
    k = min(len(z), len(y))
    r.update(ogg='rom/%s/%s.ogg' % (OUT_NAME, tag), mp3='rom/%s/%s.mp3' % (OUT_NAME, tag), ogg_bytes=os.path.getsize(ogg), mp3_bytes=os.path.getsize(mp3),
             ogg_decoded_sec=round(len(z) / sr, 3), ogg_vs_wav_corr=round(corr(z[:k].mean(axis=1), y[:k].mean(axis=1)), 4))
    os.remove(wav); os.remove(chk)
    r = {k: (float(v) if isinstance(v, np.floating) else v) for k, v in r.items()}
    print(tag, json.dumps(r), flush=True)
    return tag, r


if __name__ == '__main__':
    npar = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    ids = [int(v, 16) for v in sys.argv[2:]] or list(range(0x81, 0x99))
    os.makedirs(OUT_BGM, exist_ok=True)
    with Pool(npar) as pool:
        res = pool.map(render, ids, chunksize=1)
    meta = json.load(open(META, encoding='utf-8'))
    for tag, r in res:
        if r and tag in meta['songs']:
            meta['songs'][tag]['render' if OUT_NAME == 'bgm' else 'render_' + OUT_NAME] = r
    json.dump(meta, open(META, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
