"""통키 자체 합성 효과음·징글·BGM 생성기 (설치 불필요: 표준 라이브러리 wave + 기존 numpy).

오디오 스타일 가이드(이 파일이 단일 기준):
- 음색 팔레트: 메가드라이브풍 2-op FM(멜로디·타격 톤), 펄스 12.5/25/50%(효과·아르페지오),
  삼각파(베이스), 15비트 LFSR 노이즈(타격·바람·호루라기 숨소리). 음정 변화는 60Hz 프레임 단위 계단(칩 느낌).
- 마스터: 44.1kHz 합성 → 1극 저역통과(약 9kHz) → 효과음은 22.05kHz 16비트 모노 WAV, BGM·징글은 OGG/MP3.
- 음량: 파일별 피크 -3dBFS 정규화, 클리핑 0. 효과음 길이 1.1초 이하(파일 50KB 이하).
- 금지: 기존 곡·효과음의 멜로디/리듬 복제. 모든 선율은 이 파일에서 새로 작곡.
- QA: 길이·피크·RMS·무음 앞머리(10ms 이하)·클리핑·루프 이음새(BGM: 끝→처음 샘플 차) 수치 점검. 청취는 사람 확인 필요.

실행: python tools/audio_synth.py  (출력: public/assets/audio/, 측정값: public/assets/audio/audio_qa.json)
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'assets', 'audio')
SR = 44100
PEAK = 10 ** (-3 / 20)  # -3 dBFS
rng = np.random.default_rng(1729)


# ---------- 기본 파형 ----------
def t_(dur):
    return np.arange(int(dur * SR)) / SR


def frames(f, dur):
    """주파수(상수/함수/배열)를 60Hz 계단으로 만든 배열"""
    n = int(dur * SR)
    if callable(f):
        tt = np.floor(np.arange(n) / SR * 60) / 60
        return f(tt)
    return np.full(n, float(f)) if np.isscalar(f) else np.asarray(f)[:n]


def phase(freq):
    return np.cumsum(freq) / SR


def pulse(freq, duty=0.5):
    ph = phase(freq) % 1.0
    return np.where(ph < duty, 1.0, -1.0)


def tri(freq):
    ph = phase(freq) % 1.0
    return 4 * np.abs(ph - 0.5) - 1


def sine(freq):
    return np.sin(2 * np.pi * phase(freq))


def fm(freq, ratio=1.0, index=2.0, fb=0.0):
    """2-op FM: index 는 상수 또는 배열(엔벨로프)"""
    m = np.sin(2 * np.pi * phase(freq * ratio))
    if fb:
        m = np.sin(2 * np.pi * phase(freq * ratio) + fb * m)
    return np.sin(2 * np.pi * phase(freq) + index * m)


def noise(dur, rate=22050.0, short=False):
    """PSG 식 LFSR 노이즈. rate=값 갱신 빈도(높을수록 쉭, 낮을수록 둔탁). 배열 허용"""
    n = int(dur * SR)
    rate = np.full(n, float(rate)) if np.isscalar(rate) else np.asarray(rate)[:n]
    steps = np.floor(np.cumsum(rate) / SR).astype(np.int64)
    cnt = int(steps[-1]) + 2 if n else 1
    reg, bits = 0x4000, np.empty(cnt)
    tap = 6 if short else 1
    for i in range(cnt):
        b = (reg ^ (reg >> tap)) & 1
        reg = (reg >> 1) | (b << 14)
        bits[i] = 1.0 if reg & 1 else -1.0
    return bits[steps]


# ---------- 엔벨로프·필터 ----------
def env(dur, a=0.002, d=0.1, s=0.0, r=0.05, hold=None):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    hold = dur - r if hold is None else hold
    e = np.where(tt < a, tt / max(a, 1e-6), s + (1 - s) * np.exp(-(tt - a) / max(d, 1e-6)))
    rel = np.clip((tt - hold) / max(r, 1e-6), 0, 1)
    return e * (1 - rel)


def expd(dur, tau):
    return np.exp(-t_(dur) / tau)


def lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):  # 짧은 신호 전용(효과음)
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def lp_fast(x, fc):
    from scipy.signal import lfilter  # 이미 설치된 scipy (없으면 lp 로 대체)
    a = np.exp(-2 * np.pi * fc / SR)
    return lfilter([1 - a], [1, -a], x)


try:
    import scipy  # noqa: F401
    LP = lp_fast
except Exception:  # pragma: no cover
    LP = lp


def hp(x, fc):
    return x - LP(x, fc)


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[:len(p)] += p
    return out


def at(x, sec, total=None):
    pad = np.zeros(int(sec * SR))
    y = np.concatenate([pad, x])
    if total:
        y = np.pad(y, (0, max(0, int(total * SR) - len(y))))[: int(total * SR)]
    return y


def crush(x, bits=8):
    q = 2 ** (bits - 1)
    return np.round(x * q) / q


def N(name):
    """음이름 -> Hz (C4=261.63). 예: 'A4', 'C#5', 'Bb3'"""
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    k = names[name[0]]
    i = 1
    if name[i] == '#':
        k += 1; i += 1
    elif name[i] == 'b':
        k -= 1; i += 1
    octv = int(name[i:])
    midi = 12 * (octv + 1) + k
    return 440.0 * 2 ** ((midi - 69) / 12)


# ---------- 효과음 정의 ----------
def s_ui_cursor():
    d = 0.05
    return pulse(frames(N('A5'), d), 0.25) * env(d, d=0.03, r=0.01) * 0.6


def s_ui_confirm():
    d1, d2 = 0.06, 0.12
    a = fm(frames(N('E5'), d1), 2, 1.2) * env(d1, d=0.05, r=0.005)
    b = fm(frames(N('B5'), d2), 2, 1.2) * env(d2, d=0.06, r=0.03)
    return np.concatenate([a, b]) * 0.8


def s_ui_cancel():
    d1, d2 = 0.06, 0.12
    a = pulse(frames(N('E5'), d1), 0.5) * env(d1, d=0.05, r=0.005)
    b = pulse(frames(N('A4'), d2), 0.5) * env(d2, d=0.05, r=0.04)
    return LP(np.concatenate([a, b]), 5000) * 0.6


def whoosh(d, f0, f1, tone=0.0, q=0.0):
    rate = frames(lambda tt: f0 * (f1 / f0) ** (tt / d), d)
    n = noise(d, rate)
    e = np.sin(np.pi * np.clip(t_(d) / d, 0, 1)) ** 1.5
    x = hp(LP(n, 6000), 300) * e
    if tone:
        x += sine(frames(lambda tt: tone * (1 - 0.5 * tt / d), d)) * e * q
    return x


def s_ball_throw():
    d = 0.22
    w = whoosh(d, 16000, 3000, tone=420, q=0.25)
    thump = sine(frames(lambda tt: 160 - 300 * tt, 0.06)) * expd(0.06, 0.02)
    return mix(thump * 0.8, w)


def s_tip_swing():
    return whoosh(0.15, 20000, 6000) * 0.8


def s_ball_pass():
    return mix(whoosh(0.12, 18000, 8000) * 0.7, pulse(frames(N('E6'), 0.03), 0.125) * env(0.03, d=0.01, r=0.005) * 0.3)


def s_ball_catch():
    d = 0.16
    body = sine(frames(lambda tt: 140 * np.exp(-tt * 6), d)) * expd(d, 0.05)
    slap = hp(noise(0.04, 18000), 1500) * expd(0.04, 0.008)
    ring = fm(frames(N('C5'), d), 3, 0.8) * expd(d, 0.04) * 0.25
    return mix(body, slap * 0.9, ring)


def s_ball_hit():
    d = 0.32
    crack = noise(0.08, 22050) * expd(0.08, 0.02)
    sq = pulse(frames(lambda tt: 420 * np.exp(-tt * 9) + 60, d), 0.25) * expd(d, 0.09)
    boom = sine(frames(lambda tt: 90 * np.exp(-tt * 3), d)) * expd(d, 0.12)
    return mix(crack, LP(sq, 4000) * 0.6, boom * 0.9)


def s_ball_bounce():
    d = 0.09
    return mix(sine(frames(lambda tt: 220 * np.exp(-tt * 12) + 70, d)) * expd(d, 0.03),
               LP(noise(0.02, 8000), 2500) * expd(0.02, 0.005) * 0.4) * 0.7


def s_ball_wall():
    d = 0.1
    return mix(LP(noise(d, 5000), 1800) * expd(d, 0.02), sine(frames(110, d)) * expd(d, 0.03) * 0.6) * 0.7


def s_ball_pickup():
    d = 0.08
    return pulse(frames(lambda tt: np.where(tt < 0.04, N('C5'), N('G5')), d), 0.25) * env(d, d=0.06, r=0.01) * 0.5


def s_player_jump():
    d = 0.16
    return LP(pulse(frames(lambda tt: 220 * 2 ** (tt / d * 2.0), d), 0.25), 6000) * env(d, d=0.2, r=0.04) * 0.6


def s_player_land():
    d = 0.07
    return mix(sine(frames(lambda tt: 120 - 400 * tt, d)) * expd(d, 0.02), LP(noise(0.03, 6000), 2000) * expd(0.03, 0.008) * 0.5) * 0.8


def s_player_dash():
    return whoosh(0.1, 9000, 14000) * 0.6


def s_player_out():
    d = 0.6
    f = frames(lambda tt: N('A4') * 2 ** (-tt / d * 2.5), d)
    tone = fm(f, 1, 1.5) * env(d, d=0.5, r=0.12)
    vib = 1 + 0.015 * np.sin(2 * np.pi * 9 * t_(d))
    return LP(tone * vib, 5000) * 0.7


def whistle(d, f=2900, trill=28, breath=0.25):
    tt = t_(d)
    fr = f * (1 + 0.035 * np.sign(np.sin(2 * np.pi * trill * tt)))  # 호루라기 구슬 떨림
    tone = sine(fr) * 0.8 + sine(fr * 2) * 0.12
    br = hp(noise(d, 22050), 2000) * breath
    e = env(d, a=0.012, d=10, s=1, r=0.04)
    return (tone + br) * e


def s_ref_whistle():
    return whistle(0.38)


def s_start_fight():
    # 토스: 짧은 호루라기 + 위로 튀는 공
    w = whistle(0.22, f=3100)
    up = pulse(frames(lambda tt: 300 * 2 ** (tt / 0.2 * 1.5), 0.2), 0.5) * env(0.2, d=0.2, r=0.04) * 0.25
    return mix(w, at(LP(up, 5000), 0.18))


def chord_stab(notes, d, ratio=1, idx=2.0, tau=0.15):
    x = sum(fm(frames(N(n), d), ratio, idx * expd(d, tau * 0.7)) for n in notes) / len(notes)
    return x * env(d, d=tau, s=0.2, r=0.05)


def s_start_go():
    a = chord_stab(['C5', 'E5', 'G5', 'C6'], 0.35, 1, 2.5, 0.2)
    kick = sine(frames(lambda tt: 150 * np.exp(-tt * 20) + 45, 0.15)) * expd(0.15, 0.05)
    return mix(a, kick * 0.8)


def s_start_enter():
    # 입장: 작은 행진 팡파르(원작 0x95 대응, 자체 작곡)
    seq = [('G4', 0.1), ('C5', 0.1), ('E5', 0.1), ('G5', 0.28)]
    parts, tpos = [], 0.0
    for n, d in seq:
        parts.append(at(fm(frames(N(n), d), 1, 1.8 * expd(d, 0.08)) * env(d, d=0.1, s=0.4, r=0.03), tpos))
        parts.append(at(tri(frames(N(n) / 4, d)) * env(d, d=0.1, s=0.5, r=0.03) * 0.5, tpos))
        tpos += d
    snare = [at(hp(noise(0.06, 15000), 800) * expd(0.06, 0.015) * 0.4, k * 0.1) for k in range(4)]
    return mix(*parts, *snare)


def s_formation_start():
    seq = ['C5', 'E5', 'G5', 'C6', 'E6', 'G6']
    parts = [at(pulse(frames(N(n), 0.07), 0.125) * env(0.07, d=0.05, r=0.01) * 0.6, i * 0.05) for i, n in enumerate(seq)]
    tail = at(chord_stab(['C5', 'G5', 'C6'], 0.35, 2, 1.5, 0.2), 0.3)
    return mix(*parts, tail)


def s_formation_open():
    return s_ui_confirm()


def s_formation_pass():
    d = 0.1
    tick = fm(frames(N('A6'), 0.04), 3.5, 1.0) * expd(0.04, 0.012)
    return mix(whoosh(d, 22000, 12000) * 0.6, tick * 0.6)


def s_formation_receive():
    d = 0.08
    return mix(sine(frames(180, d)) * expd(d, 0.025), fm(frames(N('E6'), d), 2, 0.6) * expd(d, 0.02) * 0.4)


def s_ball_receive():
    d = 0.1
    return mix(sine(frames(lambda tt: 160 * np.exp(-tt * 8), d)) * expd(d, 0.03),
               hp(noise(0.03, 16000), 1500) * expd(0.03, 0.006) * 0.5)


def s_ball_hit_strong():
    d = 0.42
    x = s_ball_hit()
    boom = sine(frames(lambda tt: 70 * np.exp(-tt * 2.5) + 30, d)) * expd(d, 0.16)
    return mix(x, boom, LP(noise(d, 4000), 1200) * expd(d, 0.12) * 0.5)


def s_player_catch_ready():
    d = 0.06
    return pulse(frames(N('D6'), d), 0.125) * env(d, d=0.04, r=0.01) * 0.4


def s_player_crouch():
    d = 0.08
    return LP(noise(d, 7000), 2500) * env(d, a=0.01, d=0.03, r=0.02) * 0.6


def s_tip_hit():
    d = 0.14
    smack = hp(noise(0.04, 20000), 1200) * expd(0.04, 0.01)
    tone = sine(frames(lambda tt: 300 * np.exp(-tt * 10) + 120, d)) * expd(d, 0.04)
    return mix(smack, tone * 0.8)


def s_match_timeup():
    d = 0.8
    buzz = LP(pulse(frames(N('A3'), d), 0.5) + pulse(frames(N('A3') * 1.01, d), 0.5), 2500) * env(d, a=0.005, d=10, s=1, r=0.06)
    return buzz * 0.5


def s_match_sudden():
    parts = []
    for i in range(4):
        f = N('E5') if i % 2 == 0 else N('B4')
        parts.append(at(fm(frames(f, 0.16), 1, 2.0) * env(0.16, d=10, s=1, r=0.02), i * 0.17))
    return mix(*parts) * 0.8


def s_match_gameset():
    return mix(whistle(0.13), at(whistle(0.13), 0.2), at(whistle(0.55), 0.42))


# 필살기 시작음 10종(원작 ID 0xB7~0xC1 자리, 소리는 자체 설계). 성격만 구분.
def s_sp_b7():  # 불꽃 슛: 상승하는 불길 + 굉음
    d = 0.8
    roar = LP(noise(d, frames(lambda tt: 2000 + 9000 * tt / d, d)), 3500) * env(d, a=0.15, d=10, s=1, r=0.25)
    rise = fm(frames(lambda tt: 110 * 2 ** (tt / d * 2), d), 0.5, 3 * expd(d, 0.4)) * env(d, a=0.05, d=0.5, s=0.3, r=0.2)
    return mix(roar * 0.8, rise * 0.6)


def s_sp_b8():  # 번개: 지지직 전격
    d = 0.6
    zap = pulse(frames(lambda tt: 900 + 600 * np.sin(2 * np.pi * 37 * tt), d), 0.125)
    crackle = noise(d, 22050) * (rng.random(int(d * SR)) > 0.6)
    return (LP(zap, 7000) * 0.5 + crackle * 0.35) * env(d, a=0.005, d=0.25, s=0.3, r=0.15)


def s_sp_b9():  # 회오리: 소용돌이 바람
    d = 0.8
    w = noise(d, frames(lambda tt: 6000 + 5000 * np.sin(2 * np.pi * 6 * tt), d))
    x = hp(LP(w, 5000), 400)
    return x * env(d, a=0.1, d=10, s=1, r=0.25) * (0.7 + 0.3 * np.sin(2 * np.pi * 6 * t_(d)))


def s_sp_ba():  # 충전 상승 + 발사
    d = 0.7
    ch = pulse(frames(lambda tt: 200 * 2 ** (tt / 0.5 * 3), d), 0.25) * env(d, a=0.01, d=10, s=1, r=0.2, hold=0.5)
    shot = at(s_ball_throw(), 0.48)
    return mix(LP(ch, 6000) * 0.45, shot)


def s_sp_bb():  # 분신: 반짝이는 아르페지오 에코
    seq = ['E6', 'B6', 'E7', 'B6']
    parts = []
    for rep in range(3):
        for i, n in enumerate(seq):
            parts.append(at(pulse(frames(N(n), 0.05), 0.125) * expd(0.05, 0.02) * 0.6 * (0.6 ** rep), rep * 0.18 + i * 0.045))
    return mix(*parts)


def s_sp_bd():  # 강속 직구: 묵직한 저음 + 바람
    d = 0.6
    low = fm(frames(lambda tt: 70 + 40 * tt, d), 1, 4 * expd(d, 0.2)) * env(d, a=0.01, d=0.35, s=0.2, r=0.1)
    return mix(low * 0.9, whoosh(d, 12000, 2500) * 0.6)


def s_sp_be():  # 빛: 위로 쓸어올리는 신스
    d = 0.7
    f = frames(lambda tt: 400 * 2 ** (tt / d * 2), d)
    return (fm(f, 2.01, 1.5) * 0.6 + sine(f * 1.5) * 0.3) * env(d, a=0.02, d=10, s=1, r=0.2)


def s_sp_bf():  # 폭발: 큰 쾅
    d = 0.9
    boom = sine(frames(lambda tt: 80 * np.exp(-tt * 2) + 30, d)) * expd(d, 0.25)
    rumble = LP(noise(d, frames(lambda tt: 3000 * np.exp(-tt * 3) + 300, d)), 1500) * expd(d, 0.3)
    crack = noise(0.05, 22050) * expd(0.05, 0.012)
    return mix(boom, rumble * 0.9, crack * 0.8)


def s_sp_c0():  # 흔들리는 마구(변화구): 워블
    d = 0.7
    f = frames(lambda tt: 500 * 2 ** (0.4 * np.sin(2 * np.pi * 7 * tt)), d)
    return LP(pulse(f, 0.5), 4000) * env(d, a=0.01, d=10, s=1, r=0.2) * 0.55


def s_sp_c1():  # 초필살: 화음 + 불길
    d = 0.9
    stab = chord_stab(['D4', 'A4', 'D5', 'F#5'], d, 1, 3.0, 0.35)
    return mix(stab, s_sp_b7()[: int(d * SR)] * 0.5)


# 인트로 효과음(원작 큐 시점 0xB0~0xB5, 소리는 자체 설계)
def s_intro_fireball():
    d = 0.6
    return LP(noise(d, frames(lambda tt: 3000 + 8000 * tt / d, d)), 4000) * env(d, a=0.1, d=10, s=1, r=0.2) * 0.9


def s_intro_impact():
    return s_sp_bf()


def s_intro_flame():
    d = 0.9
    return hp(LP(noise(d, frames(lambda tt: 5000 + 4000 * np.sin(2 * np.pi * 4 * tt), d)), 4500), 200) * env(d, a=0.08, d=10, s=1, r=0.3)


def s_intro_sublogo():
    return chord_stab(['G4', 'D5', 'G5'], 0.5, 1, 2.5, 0.25)


def s_intro_wipe():
    return whoosh(0.35, 6000, 22000) * 0.9


def s_intro_flash():
    seq = ['C7', 'G6', 'E7', 'C7']
    return mix(*[at(sine(frames(N(n), 0.12)) * expd(0.12, 0.04), i * 0.05) for i, n in enumerate(seq)])


SFX = {
    'sfx.ui.cursor': s_ui_cursor, 'sfx.ui.confirm': s_ui_confirm, 'sfx.ui.cancel': s_ui_cancel,
    'sfx.ball.throw': s_ball_throw, 'sfx.ball.catch': s_ball_catch, 'sfx.ball.hit': s_ball_hit,
    'sfx.ball.bounce': s_ball_bounce, 'sfx.ball.wall': s_ball_wall, 'sfx.ball.pickup': s_ball_pickup,
    'sfx.ball.pass': s_ball_pass,
    'sfx.player.jump': s_player_jump, 'sfx.player.land': s_player_land, 'sfx.player.dash': s_player_dash,
    'sfx.player.out': s_player_out,
    'sfx.tip.swing': s_tip_swing, 'sfx.ref.whistle': s_ref_whistle,
    'sfx.start.enter': s_start_enter, 'sfx.start.go': s_start_go, 'sfx.start.fight': s_start_fight,
    'sfx.formation.start': s_formation_start, 'sfx.formation.open': s_formation_open,
    'sfx.formation.pass': s_formation_pass, 'sfx.formation.receive': s_formation_receive,
    'sfx.ball.receive': s_ball_receive, 'sfx.ball.hit_strong': s_ball_hit_strong,
    'sfx.player.catch_ready': s_player_catch_ready, 'sfx.player.crouch': s_player_crouch, 'sfx.tip.hit': s_tip_hit,
    'sfx.match.timeup': s_match_timeup, 'sfx.match.sudden_death': s_match_sudden, 'sfx.match.gameset': s_match_gameset,
    'sfx.special.b7': s_sp_b7, 'sfx.special.b8': s_sp_b8, 'sfx.special.b9': s_sp_b9, 'sfx.special.ba': s_sp_ba,
    'sfx.special.bb': s_sp_bb, 'sfx.special.bd': s_sp_bd, 'sfx.special.be': s_sp_be, 'sfx.special.bf': s_sp_bf,
    'sfx.special.c0': s_sp_c0, 'sfx.special.c1': s_sp_c1,
    'sfx.intro.fireball': s_intro_fireball, 'sfx.intro.impact': s_intro_impact, 'sfx.intro.flame': s_intro_flame,
    'sfx.intro.sublogo': s_intro_sublogo, 'sfx.intro.wipe': s_intro_wipe, 'sfx.intro.flash': s_intro_flash,
}


# ---------- 간이 시퀀서(징글·BGM) ----------
def render_track(notes, bpm, total_beats, voice, gain=1.0):
    """notes: [(beat, len_beats, note|None)]"""
    spb = 60 / bpm
    out = np.zeros(int(total_beats * spb * SR) + 1)
    for b, L, n in notes:
        if n is None:
            continue
        d = L * spb
        x = voice(N(n) if isinstance(n, str) else n, d) * gain
        s = int(b * spb * SR)
        e = min(len(out), s + len(x))
        out[s:e] += x[: e - s]
    return out


def v_lead(f, d):
    return fm(frames(f, d), 1, 1.6 * (0.4 + 0.6 * expd(d, 0.12)), fb=0.3) * env(d, a=0.005, d=0.25, s=0.55, r=min(0.06, d * 0.3))


def v_bell(f, d):
    return fm(frames(f, d), 3.5, 1.2 * expd(d, 0.1)) * env(d, a=0.002, d=0.15, s=0.1, r=min(0.05, d * 0.3))


def v_bass(f, d):
    return (tri(frames(f, d)) * 0.8 + pulse(frames(f, d), 0.5) * 0.15) * env(d, a=0.003, d=0.2, s=0.6, r=min(0.03, d * 0.3))


def v_arp(f, d):
    return pulse(frames(f, d), 0.25) * env(d, a=0.002, d=0.06, s=0.3, r=min(0.02, d * 0.3))


def drum(kind, d=0.2):
    if kind == 'k':
        return sine(frames(lambda tt: 140 * np.exp(-tt * 25) + 45, 0.18)) * expd(0.18, 0.06)
    if kind == 's':
        return mix(hp(noise(0.14, 16000), 900) * expd(0.14, 0.04) * 0.7, sine(frames(190, 0.08)) * expd(0.08, 0.02) * 0.4)
    if kind == 'h':
        return hp(noise(0.04, 22050, short=False), 6000) * expd(0.04, 0.01) * 0.35
    return np.zeros(1)


def render_drums(pattern, bpm, bars, steps=8):
    """pattern: 한 마디 문자열 목록(같은 길이), 예 'k.s.k.s.' 각 글자=8분음"""
    spb = 60 / bpm
    step = 4 * spb / steps
    out = np.zeros(int(bars * 4 * spb * SR) + 1)
    for bar in range(bars):
        pat = pattern[bar % len(pattern)]
        for i, ch in enumerate(pat):
            for c in ch.split('+') if '+' in ch else [ch]:
                if c == '.':
                    continue
                x = drum(c)
                s = int((bar * 4 * spb + i * step) * SR)
                e = min(len(out), s + len(x))
                out[s:e] += x[: e - s]
    return out


def seq_from(spec, start=0.0):
    """'C5:1 E5:0.5 -:0.5' -> [(beat,len,note)]"""
    res, b = [], start
    for tok in spec.split():
        n, L = tok.split(':')
        L = float(L)
        res.append((b, L, None if n == '-' else n))
        b += L
    return res


def chords_bass(prog, beats_per=4, pattern=(0, 1, 2, 3), octave_notes=None):
    """prog: 근음 목록. 4분음 베이스 루트-옥타브 패턴"""
    res = []
    for i, root in enumerate(prog):
        lo = root
        hi = root[:-1] + str(int(root[-1]) + 1)
        for k in range(beats_per):
            res.append((i * beats_per + k, 0.9, lo if k % 2 == 0 else hi))
    return res


def arps(prog_chords, bpm_steps=4, beats_per=4):
    res = []
    for i, ch in enumerate(prog_chords):
        for k in range(beats_per * 2):
            res.append((i * beats_per + k * 0.5, 0.45, ch[k % len(ch)]))
    return res


def loop_render(parts, total_beats, bpm, tail_beats=2):
    """루프: 끝에 넘친 꼬리(잔향)를 처음에 겹쳐 이음새를 없앤다"""
    spb = 60 / bpm
    L = int(round(total_beats * spb * SR))
    full = mix(*parts)
    out = full[:L].copy()
    tail = full[L:]
    out[: len(tail)] += tail[: L]
    return out


def bgm_match():
    bpm, bars = 152, 16
    prog = ['A2', 'F2', 'G2', 'E2'] * 4
    chords = [['A4', 'C5', 'E5'], ['F4', 'A4', 'C5'], ['G4', 'B4', 'D5'], ['E4', 'G#4', 'B4']] * 4
    mel = ('A5:1.5 E5:0.5 A5:1 C6:1 B5:1.5 A5:0.5 G5:2 '
           'F5:1 A5:1 C6:1.5 B5:0.5 A5:1 G5:1 E5:2 '
           'D5:0.5 E5:0.5 F5:1 G5:1 A5:1 B5:1.5 G5:0.5 D5:2 '
           'E5:1 G#5:1 B5:1 E6:1 D6:1 B5:1 G#5:2 '
           'A5:0.5 A5:0.5 C6:1 A5:1 E5:1 F5:1.5 A5:0.5 C6:2 '
           'G5:1 F5:0.5 E5:0.5 D5:1 G5:1 B5:2 -:2 '
           'C6:1 B5:1 A5:1 E5:1 F5:1 A5:1 D6:2 '
           'E6:1.5 D6:0.5 C6:1 B5:1 G#5:2 E5:2')
    drums = ['k.h.s.h.', 'k.h.s.hk', 'k.k.s.h.', 'k.h.s.ss']
    parts = [render_track(seq_from(mel), bpm, bars * 4 + 4, v_lead, 0.32),
             render_track(chords_bass(prog), bpm, bars * 4 + 4, v_bass, 0.42),
             render_track(arps(chords), bpm, bars * 4 + 4, v_arp, 0.11),
             render_drums(drums, bpm, bars) * 0.55]
    return loop_render(parts, bars * 4, bpm), bpm, bars


def bgm_title():
    bpm, bars = 132, 8
    prog = ['C3', 'G2', 'A2', 'F2', 'C3', 'G2', 'F2', 'G2']
    chords = [['C5', 'E5', 'G5'], ['B4', 'D5', 'G5'], ['A4', 'C5', 'E5'], ['A4', 'C5', 'F5'],
              ['C5', 'E5', 'G5'], ['B4', 'D5', 'G5'], ['A4', 'C5', 'F5'], ['B4', 'D5', 'G5']]
    mel = ('G5:1 C6:1 E6:1.5 D6:0.5 D6:2 B5:1 G5:1 '
           'C6:1.5 B5:0.5 A5:1 E6:1 F6:2 C6:2 '
           'G5:1 C6:1 E6:1.5 G6:0.5 G6:2 F6:1 D6:1 '
           'C6:1 A5:1 F6:1 E6:1 D6:3 -:1')
    drums = ['k...s...', 'k.k.s...', 'k...s...', 'k.k.s.ss']
    parts = [render_track(seq_from(mel), bpm, bars * 4 + 4, v_lead, 0.33),
             render_track(chords_bass(prog), bpm, bars * 4 + 4, v_bass, 0.4),
             render_track(arps(chords), bpm, bars * 4 + 4, v_bell, 0.12),
             render_drums(drums, bpm, bars) * 0.5]
    return loop_render(parts, bars * 4, bpm), bpm, bars


def bgm_menu():
    bpm, bars = 116, 8
    prog = ['F2', 'G2', 'E2', 'A2', 'D2', 'G2', 'C3', 'C3']
    chords = [['F4', 'A4', 'C5', 'E5'], ['G4', 'B4', 'D5', 'F5'], ['E4', 'G4', 'B4', 'D5'], ['A4', 'C5', 'E5', 'G5'],
              ['D4', 'F4', 'A4', 'C5'], ['G4', 'B4', 'D5', 'F5'], ['C5', 'E5', 'G5', 'B5'], ['C5', 'E5', 'G5', 'B5']]
    mel = ('A5:1.5 G5:0.5 E5:1 C5:1 D5:1.5 E5:0.5 F5:2 '
           'G5:1 E5:1 B5:1 G5:1 A5:3 -:1 '
           'F5:1.5 E5:0.5 D5:1 A5:1 B5:1.5 A5:0.5 G5:2 '
           'E5:1 G5:1 C6:1 B5:1 C6:3 -:1')
    drums = ['k.h.s.h.', 'k.hks.h.']
    parts = [render_track(seq_from(mel), bpm, bars * 4 + 4, v_bell, 0.34),
             render_track(chords_bass(prog), bpm, bars * 4 + 4, v_bass, 0.38),
             render_track(arps(chords), bpm, bars * 4 + 4, v_arp, 0.08),
             render_drums(drums, bpm, bars) * 0.4]
    return loop_render(parts, bars * 4, bpm), bpm, bars


def jingle_win():
    bpm = 150
    mel = 'C5:0.5 E5:0.5 G5:0.5 C6:0.5 -:0.5 G5:0.5 C6:3'
    harm = 'E4:0.5 G4:0.5 C5:0.5 E5:0.5 -:0.5 D5:0.5 E5:3'
    bass = 'C3:2 G2:0.5 C3:3.5'
    total = 7
    x = mix(render_track(seq_from(mel), bpm, total, v_lead, 0.4),
            render_track(seq_from(harm), bpm, total, v_bell, 0.2),
            render_track(seq_from(bass), bpm, total, v_bass, 0.4),
            render_drums(['k.k.s.k.', 's...'], bpm, 2)[: int(2 * 4 * 60 / bpm * SR)] * 0.4)
    return x * env(len(x) / SR, a=0.001, d=10, s=1, r=0.6)


def jingle_lose():
    bpm = 100
    mel = 'E5:0.5 D#5:0.5 D5:0.5 C#5:0.5 C5:3'
    bass = 'A2:2 F2:3'
    total = 5.5
    x = mix(render_track(seq_from(mel), bpm, total, v_lead, 0.4),
            render_track(seq_from(bass), bpm, total, v_bass, 0.45))
    return x * env(len(x) / SR, a=0.001, d=10, s=1, r=0.8)


def jingle_draw():
    bpm = 120
    mel = 'G4:0.5 C5:0.5 G4:0.5 D5:0.5 C5:2'
    bass = 'C3:2 G2:2'
    total = 4.5
    x = mix(render_track(seq_from(mel), bpm, total, v_lead, 0.4),
            render_track(seq_from(bass), bpm, total, v_bass, 0.45))
    return x * env(len(x) / SR, a=0.001, d=10, s=1, r=0.6)


# ---------- 출력·QA ----------
def normalize(x):
    x = x - np.mean(x[: min(len(x), 64)]) * 0  # DC 보정은 hp 로 충분
    x = hp(x, 20)
    pk = np.max(np.abs(x)) or 1.0
    return x * (PEAK / pk)


def fade_edges(x, ms_in=1.0, ms_out=8.0):
    n_in, n_out = int(SR * ms_in / 1000), int(SR * ms_out / 1000)
    x = x.copy()
    x[:n_in] *= np.linspace(0, 1, n_in)
    x[-n_out:] *= np.linspace(1, 0, n_out)
    return x


def write_wav(path, x, sr):
    y = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(y.tobytes())


def to22k(x):
    y = LP(x, 9000)
    return y[::2]


def measure(x, sr):
    a = np.abs(x)
    pk = float(a.max())
    nz = np.nonzero(a > 10 ** (-50 / 20))[0]
    return {
        'sec': round(len(x) / sr, 3),
        'peak_dbfs': round(20 * np.log10(pk), 2) if pk else None,
        'rms_dbfs': round(20 * np.log10(float(np.sqrt(np.mean(x ** 2))) + 1e-12), 1),
        'lead_silence_ms': round(1000 * (nz[0] / sr if len(nz) else len(x) / sr), 1),
        'clipped_samples': int(np.sum(a >= 0.9999)),
    }


def ffmpeg_encode(wav, out, codec_args):
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav] + codec_args + [out]
    subprocess.run(cmd, check=True, timeout=120)


def main():
    os.makedirs(os.path.join(OUT, 'sfx'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'bgm'), exist_ok=True)
    qa = {'_note': 'tools/audio_synth.py 측정값. 청취 확인은 사람(UNVERIFIED).', 'sfx': {}, 'bgm': {}}
    for key, fn in SFX.items():
        x = fade_edges(normalize(fn()))
        y = to22k(x)
        y = y * (PEAK / np.max(np.abs(y)))
        name = key[len('sfx.'):].replace('.', '_') + '.wav'
        p = os.path.join(OUT, 'sfx', name)
        write_wav(p, y, SR // 2)
        m = measure(y, SR // 2)
        m.update(path='audio/sfx/' + name, bytes=os.path.getsize(p))
        qa['sfx'][key] = m
    tmpdir = os.environ.get('AUDIO_TMP') or os.path.join(OUT, '_tmp')
    os.makedirs(tmpdir, exist_ok=True)
    jobs = [('bgm.title', bgm_title, True), ('bgm.menu', bgm_menu, True), ('bgm.match', bgm_match, True),
            ('bgm.jingle.win', jingle_win, False), ('bgm.jingle.lose', jingle_lose, False),
            ('bgm.jingle.draw', jingle_draw, False)]
    for key, fn, loop in jobs:
        r = fn()
        x, bpm, bars = r if loop else (r, None, None)
        x = normalize(x) if loop else fade_edges(normalize(x), 1, 30)
        base = key[len('bgm.'):].replace('.', '_')
        wav = os.path.join(tmpdir, base + '.wav')
        write_wav(wav, x, SR)
        ogg = os.path.join(OUT, 'bgm', base + '.ogg')
        mp3 = os.path.join(OUT, 'bgm', base + '.mp3')
        ffmpeg_encode(wav, ogg, ['-c:a', 'libvorbis', '-q:a', '3'])
        ffmpeg_encode(wav, mp3, ['-c:a', 'libmp3lame', '-b:a', '96k'])
        m = measure(x, SR)
        m.update(ogg='audio/bgm/' + base + '.ogg', mp3='audio/bgm/' + base + '.mp3',
                 ogg_bytes=os.path.getsize(ogg), mp3_bytes=os.path.getsize(mp3), loop=loop)
        if loop:
            m.update(bpm=bpm, bars=bars, loop_samples=len(x),
                     seam_jump=round(float(abs(x[-1] - x[0])), 4),
                     seam_neighbor_max=round(float(np.max(np.abs(np.diff(x)))), 4))
        qa['bgm'][key] = m
        os.remove(wav)
    try:
        os.rmdir(tmpdir)
    except OSError:
        pass
    with open(os.path.join(OUT, 'audio_qa.json'), 'w', encoding='utf-8') as f:
        json.dump(qa, f, ensure_ascii=False, indent=1)
    tot = sum(v['bytes'] for v in qa['sfx'].values())
    print('sfx', len(qa['sfx']), 'files', tot, 'bytes; max', max(v['bytes'] for v in qa['sfx'].values()))
    for k, v in qa['bgm'].items():
        print(k, v)


if __name__ == '__main__':
    sys.exit(main())
