"""원작 효과음·음성·BGM 일괄 렌더 (z80snd.py + ffmpeg libgme). 결과는 public/assets/rom/ (gitignore) 에만 쓴다.

사용: python analysis/scripts/rom_audio_render.py [sfx|bgm|all] [병렬수]
      python analysis/scripts/rom_audio_render.py sfx-add <병렬수> a7,a8,b6  (지정 효과음만, 기존 sfx_gain_db 그대로 - 다른 파일은 안 건드림)
- 효과음: 3초 렌더 → 뒤 무음 제거 → 22.05kHz 모노 16비트 WAV (public/assets/rom/sfx/)
- 음성(DAC, 메일박스 $1BFF): 0x81 GO / 0x82 FIGHT / 0x83 GAME SET
- BGM: 150초 렌더 → 레지스터 쓰기 순서로 루프 탐지 → 인트로+1루프 구간을 OGG/MP3 (public/assets/rom/bgm/), 루프 지점(초) 기록
- 음량: 효과음 전체에 같은 이득(가장 큰 것 피크 -3dBFS), BGM 도 전체 공통 이득 → 원작 상대 음량 유지
측정·근거는 analysis/data/rom_audio.json 에 기록.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# 같은 폴더의 dis.py 가 표준 라이브러리 dis 를 가리므로 스크립트 폴더를 경로 앞에서 뺀다
sys.path[:] = [p for p in sys.path if os.path.abspath(p or '.') != HERE]

import json  # noqa: E402
import subprocess  # noqa: E402
import wave  # noqa: E402
from multiprocessing import Pool  # noqa: E402

import numpy as np  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.append(HERE)
import z80snd as Z  # noqa: E402

OUT_SFX = os.path.join(ROOT, 'public', 'assets', 'rom', 'sfx')
OUT_BGM = os.path.join(ROOT, 'public', 'assets', 'rom', 'bgm')
TMP = os.environ.get('AUDIO_TMP') or os.path.join(ROOT, 'public', 'assets', 'rom', '_tmp')
PEAK = 10 ** (-3 / 20)

# id, 메일박스, 의미, 근거
SFX = [
    (0xA0, 0x1C0A, '커서 이동', '10 §4, 11 효과음 표 [확인: 큐 관측]'),
    (0xA1, 0x1C0A, '결정/포메이션 창', '10 §4, 11, 14 [확인]'),
    (0xA2, 0x1C0A, '투구·쳐내기', '06 §4 (0xA434), 08 [코드]'),
    (0xA3, 0x1C0A, '패스 투구', '0x72FE 패스 실행 핸들러(04 표 0x724E) [추정]'),
    (0xA4, 0x1C0A, '캐치(위험 공)', '0x791C: 공 $3 bit6(위험) 이면 A4, 아니면 A5 [추정]'),
    (0xA5, 0x1C0A, '공 받기/수신', '0x748C 공 보유 처리, 14 패스 수신 관측 [관측+코드]'),
    (0xA6, 0x1C0A, '점프', '08 (0x7CD6) [코드]'),
    (0xA9, 0x1C0A, '6프레임 반복음(표 0x8BDE)', '0x8BBA [코드, 용도 미확인]'),
    (0xAA, 0x1C0A, '피격 넉백(약)', '0x99E2 ← 0x9484 피격 날아감 핸들러(05 0x946A) [추정]'),
    (0xAB, 0x1C0A, '피격 넉백(강, $20>=0x100)', '0x99EC [추정]'),
    (0xAE, 0x1C0A, '심판 호루라기(아웃 콜)', '08 서브 0x18 [확인]'),
    (0xAF, 0x1C0A, '메뉴 계열(0x113BE)', '[코드, 용도 미확인]'),
    (0xB0, 0x1C0A, '인트로 불덩이', '10 §4 [확인]'),
    (0xB1, 0x1C0A, '인트로 착탄', '10 §4 [확인]'),
    (0xB2, 0x1C0A, '인트로 불꽃', '10 §4 [확인]'),
    (0xB3, 0x1C0A, '인트로 로고 반짝', '10 §4 [확인]'),
    (0xB4, 0x1C0A, '인트로 와이프', '10 §4 [확인]'),
    (0xB5, 0x1C0A, '인트로 소로고', '10 §4 [확인]'),
] + [(i, 0x1C0A, '필살기 시작음', '06 §4 ROM[0xB866+ID] [코드]') for i in (0xB7, 0xB8, 0xB9, 0xBA, 0xBB, 0xBD, 0xBE, 0xBF, 0xC0, 0xC1)] + [
    (0xBC, 0x1C0A, '미사용 추정(B7~C1 사이)', '[호출 미발견]'),
    (0xC2, 0x1C0A, '시간 경고/결과 연출(0x2BB4, 0x6468)', '[코드, 용도 추정]'),
    (0xC3, 0x1C0A, '포메이션 패스', '14 [관측]'),
    (0xC5, 0x1C0A, '6프레임 반복음(표 0x8BDE)', '0x8BBA [코드, 용도 미확인]'),
    (0xD0, 0x1C0A, '메뉴 계열(0x10658, 0x135DA)', '[코드, 용도 미확인]'),
    (0xA7, 0x1C0A, '스토리 대사 타이핑음(대부분 화자)', '48 §2-2: 표 0x7528A, 0x121AE 가나마다 [코드+실측 t48_story_scene.py]'),
    (0xA8, 0x1C0A, '스토리 대사 타이핑음(여성 화자: キャサリン·はるか·みさと)', '48 §2-2: 표 0x7528A [코드+실측]'),
    (0xB6, 0x1C0A, '스토리 대사 타이핑음(だんぺい)', '48 §2-2: 표 0x7528A [코드+실측]'),
    (0x81, 0x1BFF, '음성 GO', '08 (0x288C 가 $A01BFF 에 기록, Z80 0x0FCF DAC 재생) [코드+렌더]'),
    (0x82, 0x1BFF, '음성 FIGHT', '08 [코드+렌더]'),
    (0x83, 0x1BFF, '음성 GAME SET', '08 [코드+렌더]'),
]

# 0x50D2 대전 스테이지 BGM 표(인덱스 $E682) + 확인된 화면 BGM
BGM = sorted(set([0x88, 0x81, 0x82, 0x83, 0x85, 0x89, 0x84, 0x86, 0x87, 0x96, 0x8A, 0x8B, 0x8C, 0x8D, 0x8E, 0x8F,
                  0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x97, 0x98]))
STORY_TABLE = list(open(os.path.join(ROOT, 'rom', 'danpei.gen'), 'rb').read()[0x50F2:0x50F2 + 15])
# 68k 호출 지점(jsr $16B6 직전 moveq) - 장면 매핑 근거
BGM_SITES = {
    '8A': '0xF042 타이틀 [확인]', '8B': '0x14880 VS 라인업 [확인]', '8C': '0x109A6, 0x15F12 모드 메뉴 [확인]',
    '8D': '0x14806($E600==0xB4 일 때 8C 대신), 0x15E8C 모드3 [코드]', '8E': '0x40F8 결과: 승자==$E700 [코드]',
    '93': '0x4100 결과: 그 외, 0x13DF0 모드0 흐름 [코드]', '95': '0x5ED2 경기 시작 연출 [확인]',
    '8F': '0x163D4 ($E60A=0x28 화면) [용도 미확인]', '90': '0x11A36 모드0 흐름 화면 [용도 미확인]',
    '91': '0x11CA0 모드0 흐름 화면 [용도 미확인]', '92': '0x12CDA 모드0 흐름 화면 [용도 미확인]',
    '94': '0x3858 ($E600 0x40~ 계열 진행 연출) [용도 미확인]', '97': '0x4474 ($E600 0x40~ 계열) [용도 미확인]',
    '98': '0x10E9C, 0x11070, 0x1268A(스토리 승자==$E700), 0x13F84 [용도 미확인, 스토리 승리 계열 추정]',
    '81~89,96': '경기 곡: 표 0x50D2[$E682](모드1~4), 표 0x50F2[$E688](스토리 $E68E==0) [코드]',
}
STAGE_TABLE = list(open(os.path.join(ROOT, 'rom', 'danpei.gen'), 'rb').read()[0x50D2:0x50D2 + 16])


def ffrender(vgm, wav, args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'libgme', '-i', vgm] + args + [wav],
                   check=True, timeout=600)


def readwav(p):
    w = wave.open(p)
    x = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float64) / 32768
    return x.reshape(-1, w.getnchannels()), w.getframerate()


def writewav(p, x, sr):
    y = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    with wave.open(p, 'wb') as w:
        w.setnchannels(x.shape[1] if x.ndim > 1 else 1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(y.tobytes())


def render_sfx(item):
    cid, slot, _, _ = item
    z = Z.boot()
    log, tt = Z.run_cmd(z, cid, 3.0, slot=slot)
    tag = '%02x' % cid + ('v' if slot == 0x1BFF else '')
    vgm = os.path.join(TMP, tag + '.vgm')
    open(vgm, 'wb').write(Z.make_vgm(log, tt))
    raw = os.path.join(TMP, tag + '_raw.wav')
    ffrender(vgm, raw, ['-ac', '1', '-ar', '22050'])
    x, sr = readwav(raw)
    x = x[:, 0]
    os.remove(vgm); os.remove(raw)
    return tag, x, sr


def streams(log):
    """레지스터 쓰기를 채널별 흐름으로 나눈다(타이머 A/B 어긋남으로 채널 간 순서가 매 회 달라지므로)"""
    out = {}
    latch = 0
    for (t, k, a, d) in log:
        if k == 0 and a in (0x24, 0x25, 0x26, 0x27):
            continue
        if k == 2:
            if d & 0x80:
                latch = (d >> 5) & 3
            key = ('p', latch)
        elif a == 0x28:
            key = ('y', (d & 7))
        elif a >= 0x30:
            key = ('y', (a & 3) + (4 if k == 1 else 0))
        else:
            key = ('g', k)
        s = out.setdefault(key, ([], []))
        s[0].append(bytes((k, a, d))); s[1].append(t)
    return out


def stream_loop(seq, ts, W=120):
    n = len(seq)
    if n < W * 3:
        return None
    buf = b''.join(seq)
    tail = buf[(n - W) * 3:]
    cands = []
    pos = buf.find(tail, 0)
    while pos != -1 and pos < (n - W) * 3:
        if pos % 3 == 0:
            P = (n - W) - pos // 3
            j = n - P - 1
            while j >= 0 and seq[j] == seq[j + P]:
                j -= 1
            S = j + 1
            # 한 주기 이상이 실제로 반복 확인된 후보만(긴 P 의 우연 일치 배제)
            if (n - P - S) >= P:
                cands.append((S, P))
        pos = buf.find(tail, pos + 1)
    if not cands:
        return None
    # 가장 이른 시작(=가장 긴 반복 구간), 시작이 1초 안으로 같으면 가장 짧은 주기
    s0 = min(ts[c[0]] for c in cands)
    S, P = min((c for c in cands if ts[c[0]] - s0 <= Z.Z_CLK), key=lambda c: c[1])
    return ts[S], ts[S + P] - ts[S], n


def find_loop(log):
    """채널별 반복 주기(시간) 중앙값 = 루프 길이, 시작 = 모든 채널이 반복에 들어간 가장 늦은 시점"""
    res = [r for r in (stream_loop(seq, ts) for seq, ts in streams(log).values()) if r]
    if not res:
        return None
    w = [r for r in res if r[2] >= 200] or res
    # 곡 전체 주기 = 가장 긴 채널 주기(짧게 도는 리듬 채널은 그 약수여야 함)
    P = max(r[1] for r in w)
    agree = [r for r in w if abs(P / r[1] - round(P / r[1])) * r[1] <= Z.FRAME_T * 2]
    start = max(r[0] for r in agree)
    return start, start + P, len(agree), len(w)


def run_exact(cid, chunk=30.0, max_sec=600.0, W=64):
    """드라이버 상태 루프 탐지(정확): 음악 템포는 YM 타이머 A 로 진행(메인 루프 'cb 47 28 c6 cd c0 00').
    타이머 A 틱마다 Z80 작업 RAM(0x1000~0x1EFF) 해시를 모으고, 해시열이 주기 P 로 한 주기 이상 그대로 반복되는
    가장 이른 시작 S 를 찾는다. 상태가 같으면 이후 레지스터 쓰기도 같으므로(결정적) 루프가 정확히 증명된다."""
    import hashlib
    z = Z.boot()
    hookA = bytes(z.mem).find(bytes.fromhex('cb4728c6cdc000')) + 4
    for _ in range(10):
        z.run_until(z.t + Z.FRAME_T); z.interrupt()
    pre = list(z.log); z.log = []
    t0 = z.t; z.mem[0x1C0A] = cid
    H, T = [], []
    found = None; ended = None
    next_check = t0 + chunk * Z.Z_CLK
    while z.t - t0 < max_sec * Z.Z_CLK:
        fe = z.t + Z.FRAME_T
        while z.t < fe:
            if z.pc == hookA:
                H.append(hashlib.md5(bytes(z.mem[0x1000:0x1F00])).digest()); T.append(z.t - t0)
            z.step()
        z.interrupt()
        if z.t >= next_check:
            next_check += chunk * Z.Z_CLK
            n = len(H)
            # 끝나는 곡: 마지막 5초 동안 상태 불변
            k = n - 1
            while k > 0 and H[k - 1] == H[n - 1]:
                k -= 1
            if T[n - 1] - T[k] > 5 * Z.Z_CLK:
                ended = T[k]; break
            if n > 3 * W:
                tail = H[n - W:]
                for p in range(n - W - 1, -1, -1):
                    if H[p:p + W] == tail:
                        P = (n - W) - p
                        if T[n - 1] - T[n - 1 - P] < 2 * Z.Z_CLK:
                            continue
                        j = n - P - 1
                        while j >= 0 and H[j] == H[j + P]:
                            j -= 1
                        S = j + 1
                        if (n - P - S) >= P:
                            found = (T[S], T[S + P], P, S)
                        break
                if found:
                    break
    log = [(0, k, a, d) for (_, k, a, d) in pre if k != 0 or a not in (0x28,)] + [(t - t0, k, a, d) for (t, k, a, d) in z.log]
    return log, z.t - t0, found, ended


def render_bgm(cid):
    log, tt, found, ended = run_exact(cid)
    tag = '%02x' % cid
    vgm = os.path.join(TMP, 'b' + tag + '.vgm')
    open(vgm, 'wb').write(Z.make_vgm(log, tt))
    raw = os.path.join(TMP, 'b' + tag + '_raw.wav')
    ffrender(vgm, raw, ['-ar', '44100'])
    x, sr = readwav(raw)
    os.remove(vgm); os.remove(raw)
    info = {'id': '0x%02X' % cid, 'method': 'driver-state-hash(timer A ticks, Z80 RAM 0x1000-0x1EFF)'}
    if found:
        ls = int(round(found[0] * Z.SAMPLES_PER_T)); le = int(round(found[1] * Z.SAMPLES_PER_T))
        seam = float(np.abs(x[le] - x[ls]).max()) if le < len(x) else None
        x = x[:le]
        info.update(loop=True, loop_start=round(ls / sr, 5), loop_end=round(le / sr, 5), loop_start_sample=ls,
                    loop_end_sample=le, loop_ticks=found[2], loop_start_tick=found[3],
                    seam_jump=round(seam, 4) if seam is not None else None, loop_confident=True)
    elif ended is not None:
        a = np.abs(x).max(axis=1)
        e = int(ended * Z.SAMPLES_PER_T)
        nz = np.nonzero(a[:min(len(a), e + 5 * sr)] > 10 ** (-60 / 20))[0]
        end = (nz[-1] + int(0.05 * sr)) if len(nz) else e
        x = x[:end]
        info.update(loop=False, loop_confident=True, _note='끝나는 곡(드라이버 상태 정지)')
    else:
        info.update(loop=None, loop_confident=False, _note='600초 안에 루프·종료 미확정')
    return tag, x, sr, info


def measure(x, sr):
    a = np.abs(x)
    pk = float(a.max())
    nz = np.nonzero((a.max(axis=1) if a.ndim > 1 else a) > 10 ** (-50 / 20))[0]
    return {'sec': round(len(x) / sr, 3), 'peak_dbfs': round(20 * np.log10(pk), 2) if pk else None,
            'rms_dbfs': round(20 * np.log10(float(np.sqrt(np.mean(x ** 2))) + 1e-12), 1),
            'lead_silence_ms': round(1000 * (nz[0] / sr if len(nz) else 0), 1),
            'clipped_samples': int(np.sum(a >= 0.9999))}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'all'
    npar = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    os.makedirs(TMP, exist_ok=True); os.makedirs(OUT_SFX, exist_ok=True); os.makedirs(OUT_BGM, exist_ok=True)
    meta_p = os.path.join(ROOT, 'analysis', 'data', 'rom_audio.json')
    meta = json.load(open(meta_p, encoding='utf-8')) if os.path.exists(meta_p) else {}
    meta['_note'] = ('원작 사운드 드라이버 렌더(analysis/scripts/z80snd.py + rom_audio_render.py, ffmpeg libgme). '
                     '파일은 public/assets/rom/ (gitignore). 청취 확인 UNVERIFIED. 의미 열의 [추정]은 코드 위치 근거만 있음.')
    if mode != 'sfx-add':  # sfx-add 는 sfx 항목만 더한다
        meta['stage_bgm_table_0x50D2'] = ['0x%02X' % v for v in STAGE_TABLE]
        meta['story_bgm_table_0x50F2'] = ['0x%02X' % v for v in STORY_TABLE]
        meta['bgm_call_sites'] = BGM_SITES
    with Pool(npar) as pool:
        if mode == 'sfx-add':
            # 지정 효과음만 추가 렌더: 기존 전체 공통 이득(sfx_gain_db)을 그대로 써서 원작 상대 음량 유지. 다른 효과음 파일·이득은 바꾸지 않는다
            tags = [t.strip().lower() for t in sys.argv[3].split(',')]
            items = [it for it in SFX if ('%02x' % it[0] + ('v' if it[1] == 0x1BFF else '')) in tags]
            gain = 10 ** (meta['sfx_gain_db'] / 20)
            for (tag, x, sr), (cid, slot, mean, ev) in zip(pool.map(render_sfx, items), items):
                a = np.abs(x)
                nz = np.nonzero(a > 10 ** (-60 / 20))[0]
                x = x[:(nz[-1] + int(0.03 * sr)) if len(nz) else int(0.05 * sr)] * gain
                n = min(len(x), int(0.008 * sr))
                x[-n:] *= np.linspace(1, 0, n)
                if np.abs(x).max() >= 1.0:
                    raise SystemExit('%s: 기존 이득으로 클리핑 - 전체 재렌더(sfx) 필요' % tag)
                p = os.path.join(OUT_SFX, tag + '.wav')
                writewav(p, x, sr)
                m = measure(x, sr)
                m.update(path='rom/sfx/' + tag + '.wav', bytes=os.path.getsize(p), slot='0x%04X' % slot, meaning=mean, evidence=ev,
                         silent=bool(len(nz) == 0))
                meta['sfx'][tag] = m
                print(tag, m['sec'], m['peak_dbfs'], m['bytes'], mean, flush=True)
        if mode in ('sfx', 'all'):
            res = pool.map(render_sfx, SFX)
            gpk = max(np.abs(x).max() for _, x, _ in [(t, x, s) for t, x, s in res])
            gain = PEAK / gpk
            meta['sfx_gain_db'] = round(20 * np.log10(gain), 2)
            meta['sfx'] = {}
            for (tag, x, sr), (cid, slot, mean, ev) in zip(res, SFX):
                a = np.abs(x)
                nz = np.nonzero(a > 10 ** (-60 / 20))[0]
                x = x[:(nz[-1] + int(0.03 * sr)) if len(nz) else int(0.05 * sr)] * gain
                n = min(len(x), int(0.008 * sr))
                x[-n:] *= np.linspace(1, 0, n)
                p = os.path.join(OUT_SFX, tag + '.wav')
                writewav(p, x, sr)
                m = measure(x, sr)
                m.update(path='rom/sfx/' + tag + '.wav', bytes=os.path.getsize(p), slot='0x%04X' % slot, meaning=mean, evidence=ev,
                         silent=bool(len(nz) == 0))
                meta['sfx'][tag] = m
                print(tag, m['sec'], m['peak_dbfs'], m['bytes'], mean, flush=True)
        if mode in ('bgm', 'all'):
            print('BGM 은 tools/bgm/loop_exact.py + render.py + build_manifest.py 로 만든다(analysis/27_bgm_status.md). 이 스크립트의 BGM 렌더는 시간축 보정이 없어 쓰지 않는다. 옛 방식은 bgm-legacy')
        if mode == 'bgm-legacy':
            res = pool.map(render_bgm, BGM, chunksize=1)
            gpk = max(np.abs(x).max() for _, x, _, _ in res)
            gain = PEAK / gpk
            meta['bgm_gain_db'] = round(20 * np.log10(gain), 2)
            meta['bgm'] = {}
            for tag, x, sr, info in res:
                x = x * gain
                wav = os.path.join(TMP, tag + '.wav')
                writewav(wav, x, sr)
                ogg = os.path.join(OUT_BGM, tag + '.ogg'); mp3 = os.path.join(OUT_BGM, tag + '.mp3')
                subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-q:a', '4', ogg], check=True, timeout=300)
                subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '128k', mp3], check=True, timeout=300)
                os.remove(wav)
                info.update(measure(x, sr))
                info.update(ogg='rom/bgm/' + tag + '.ogg', mp3='rom/bgm/' + tag + '.mp3',
                            ogg_bytes=os.path.getsize(ogg), mp3_bytes=os.path.getsize(mp3))
                meta['bgm'][tag] = info
                print(tag, info, flush=True)
    try:
        os.rmdir(TMP)
    except OSError:
        pass
    with open(meta_p, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
