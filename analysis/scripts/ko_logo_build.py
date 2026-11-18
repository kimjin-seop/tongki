# 한국판 타이틀 로고 "피구왕 통키" 생성(자체 디자인, 원작 한국판 로고 모방 아님).
# 원작 로고와 같은 254x124 캔버스·같은 레이어 구조(flames/main/sub/flash + 합성본).
# 폰트: public/assets/fonts/BlackHanSans-Regular.ttf (OFL) 를 고해상도 래스터 → 기울임 → 1x 다운샘플·임계 → 도트 가공.
# 팔레트: MD 3비트 값(0,36,...,252)만 사용, 색0=투명.
# 실행: python -I analysis/scripts/ko_logo_build.py [out_dir]
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONT = os.path.join(ROOT, 'public', 'assets', 'fonts', 'BlackHanSans-Regular.ttf')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'public', 'assets', 'rom', 'intro')
W, H = 254, 124
SS = 8            # 슈퍼샘플 배율
SLANT = 0.16      # 기울임(우상향 약 9도)

# ---- 팔레트(MD 3비트) ----
BLACK = (0, 0, 0)
RED = (252, 0, 0)
RED_D = (216, 0, 0)       # 본체 아래쪽 음영
RED_HI = (252, 180, 144)  # 상단 하이라이트
EXTR = (144, 0, 0)        # 압출 그림자
EXTR_D = (72, 0, 0)       # 압출 그림자 끝
YEL = (252, 252, 0)
YEL_SH = (180, 108, 0)
FL_O = (252, 108, 0)
FL_M = (252, 144, 0)
FL_I = (252, 180, 0)
FL_C = (252, 252, 108)
WHITE = (252, 252, 252)
CY1 = (216, 252, 252)
CY2 = (180, 252, 252)
CY3 = (108, 216, 252)


def text_mask(txt, px_h, track=0, squeeze=1.0):
    """글자 하나씩 래스터 → (높이 px_h 기준) 1x 마스크. squeeze: 가로 압축률"""
    f = ImageFont.truetype(FONT, px_h * SS * 4 // 3)
    glyphs = []
    for ch in txt:
        if ch == ' ':
            glyphs.append(None); continue
        bb = f.getbbox(ch)
        im = Image.new('L', (bb[2] - bb[0] + 4, bb[3] - bb[1] + 4), 0)
        ImageDraw.Draw(im).text((2 - bb[0], 2 - bb[1]), ch, font=f, fill=255)
        glyphs.append(im)
    # 글자 높이를 px_h*SS 로 맞춤
    hs = [g.size[1] for g in glyphs if g]
    scale = px_h * SS / max(hs)
    parts = []
    for g in glyphs:
        if g is None:
            parts.append(('sp', int(px_h * SS * 0.18))); continue
        g = g.resize((max(1, int(g.size[0] * scale * squeeze)), max(1, int(g.size[1] * scale))), Image.LANCZOS)
        parts.append(('g', g))
    tw = sum(p[1] if p[0] == 'sp' else p[1].size[0] for p in parts) + track * SS * (len(parts) - 1)
    canvas = Image.new('L', (tw + px_h * SS, px_h * SS + 4 * SS), 0)
    x = 0
    for kind, g in parts:
        if kind == 'sp':
            x += g
        else:
            canvas.paste(g, (x, canvas.size[1] - 2 * SS - g.size[1]))  # 바닥 정렬
            x += g.size[0]
        x += track * SS
    # 기울임: 위쪽이 오른쪽으로
    cw, chh = canvas.size
    canvas = canvas.transform((cw, chh), Image.AFFINE, (1, SLANT, -SLANT * chh, 0, 1, 0), Image.BICUBIC)
    small = canvas.resize((cw // SS, chh // SS), Image.BOX)
    m = np.array(small) >= 118
    ys, xs = np.where(m)
    return m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def dil(m, r=1, square=True):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if not square and abs(dx) + abs(dy) > r + (1 if r >= 2 else 0):
                continue
            out |= shift(m, dx, dy)
    return out


def shift(m, dx, dy):
    o = np.zeros_like(m)
    h, w = m.shape
    ys0, ys1 = max(0, dy), min(h, h + dy)
    xs0, xs1 = max(0, dx), min(w, w + dx)
    o[ys0:ys1, xs0:xs1] = m[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return o


def clean(m):
    """고립 픽셀·1px 돌기 제거"""
    n = sum(shift(m, dx, dy).astype(int) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    m = m & (n >= 2)
    holes = (~m) & (n >= 3)  # 1px 홈 메움
    return m | holes


def place(dst, m, x, y):
    h, w = m.shape
    dst[y:y + h, x:x + w] |= m


def paint(img, mask, col):
    img[mask] = (*col, 255)


def tongues(shape, x0, x1, base_top, rng, hmin, hmax, layers):
    """불꽃 혀: 아래가 통통하고 위로 휘며 뾰족해지는 혀 모양을 겹침. layers=[(색, 안쪽 축소 px)]"""
    H_, W_ = shape
    peaks = []
    x = x0 - 2
    while x < x1:
        w = int(rng.integers(12, 19)); hgt = int(rng.integers(hmin, hmax + 1))
        sway = float(rng.uniform(-3.5, 3.5))
        peaks.append((x + w / 2, w / 2, hgt, sway)); x += int(w * 0.55)
    outs = []
    for col, inset in layers:
        m = np.zeros((H_, W_), bool)
        for cx, half, hgt, sway in peaks:
            hh = hgt - inset * 1.6
            hw = half - inset * 0.9
            if hh <= 2 or hw <= 1: continue
            for k in range(int(hh) + 1):
                f = k / hh                       # 0=바닥, 1=끝
                w_ = hw * (1 - f) ** 0.75 * (1 + 0.25 * np.sin(f * np.pi))
                c = cx + sway * f ** 1.6         # 위로 갈수록 휘어짐
                yy = base_top - k
                xa, xb = int(round(c - w_)), int(round(c + w_))
                if 0 <= yy < H_:
                    m[yy, max(x0, xa):min(x1, xb + 1)] = True
            m[base_top:base_top + 6, max(x0, int(cx - hw)):min(x1, int(cx + hw) + 1)] = True
        outs.append((col, m))
    return outs


def ball(cx, cy, r):
    """피구공 장식: 빨강 공 + 이음선 + 하이라이트 (마스크 dict)"""
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    body = d <= r
    seam = body & ((np.abs((xx - cx) * 0.8 + (yy - cy) * 0.6) < 0.9) | (np.abs(d - r * 0.62) < 0.6) & (xx > cx))
    hi = body & (np.sqrt((xx - cx + r * 0.42) ** 2 + (yy - cy + r * 0.42) ** 2) <= r * 0.28)
    shade = body & (np.sqrt((xx - cx + 2) ** 2 + (yy - cy + 2) ** 2) > r - 0.2)
    return body, seam, hi, shade


def build():
    ys = np.arange(H)[:, None]
    xs_all = np.arange(W)[None, :]
    # ---------- main: 아래 단 "피구왕"(작게) + 오른쪽 "통키"(세로로 크게, 원작 큰 글자 자리) ----------
    m1 = clean(text_mask('피구왕', 44, track=-1, squeeze=0.68))
    m2 = clean(text_mask('통키', 86, track=-2, squeeze=0.55))
    gap = 3
    total = m1.shape[1] + gap + m2.shape[1]
    x0 = (W - total) // 2 - 3       # 압출 그림자(오른쪽 아래)만큼 왼쪽 보정
    base = 112                      # 본체 바닥선(그림자 포함 하단 = 118)
    fill = np.zeros((H, W), bool)
    t1 = base - m1.shape[0]; t2 = base - m2.shape[0]
    place(fill, m1, x0, t1)
    x2 = x0 + m1.shape[1] + gap
    place(fill, m2, x2, t2)
    # 피구공 장식(부제 오른쪽 끝, 통키 왼쪽 위)
    bcx, bcy, br = x2 - 6, t1 - 13, 9
    bbody, bseam, bhi, bshade = ball(bcx, bcy, br)
    shape = fill | bbody
    inner = dil(shape, 1)           # 본체 + 1px 검정 테
    extr = np.zeros_like(fill)
    for k in range(1, 6):           # 오른쪽 아래 압출 5px
        extr |= shift(inner, k, k)
    extr_d = (shift(inner, 5, 5) | shift(inner, 4, 4)) & ~shift(inner, 3, 3)
    allm = inner | extr
    outline = dil(allm, 1) & ~allm
    main = np.zeros((H, W, 4), np.uint8)
    paint(main, outline, BLACK)
    paint(main, extr & ~inner, EXTR)
    paint(main, extr_d & ~inner, EXTR_D)
    paint(main, inner & ~shape, BLACK)
    paint(main, fill, RED)
    for m, top in ((m1, t1), (m2, t2)):  # 아래쪽 음영(바닥 28%) + 경계 1행 디더
        cut = top + int(m.shape[0] * 0.72)
        band = fill & (ys > cut) & (ys <= base)
        dither = fill & (ys == cut) & ((xs_all + ys) % 2 == 0)
        paint(main, band | dither, RED_D)
    hi = fill & ~shift(fill, 0, 1)   # 윗변 1px 하이라이트
    paint(main, hi, RED_HI)
    paint(main, bbody, RED); paint(main, bshade, RED_D); paint(main, bseam, EXTR); paint(main, bhi, WHITE)
    main_alpha = main[..., 3] > 0

    # ---------- sub: "불꽃의 피구소년" ----------
    s = text_mask('불꽃의 피구소년', 18, track=0, squeeze=0.80)
    sx, sy = 14, 22
    sfill = np.zeros((H, W), bool)
    place(sfill, s, sx, sy)
    ssh = shift(sfill, 1, 1) & ~sfill           # 1px 주황 그림자
    sout = dil(sfill | ssh, 2, square=False) & ~(sfill | ssh)
    sub = np.zeros((H, W, 4), np.uint8)
    paint(sub, sout, BLACK)
    paint(sub, ssh, YEL_SH)
    paint(sub, sfill, YEL)
    sub_alpha = sub[..., 3] > 0

    # ---------- flames: 부제 뒤 + 통키 윗부분 뒤 ----------
    rng = np.random.default_rng(11)
    fl = np.zeros((H, W, 4), np.uint8)
    sb_x = np.where(sub_alpha.any(0))[0]; sb_y = np.where(sub_alpha.any(1))[0]
    lay = [(FL_O, 0), (FL_M, 2), (FL_I, 4), (FL_C, 7)]
    for col, m in tongues((H, W), sb_x.min() - 3, sb_x.max() + 4, sb_y.min() + 8, rng, 13, 22, lay):
        paint(fl, m, col)
    # 부제 아래쪽 띠(원작처럼 부제 뒤를 불꽃색 판으로 받침)
    plate = np.zeros((H, W), bool)
    plate[sb_y.min() + 4:sb_y.max() - 1, sb_x.min() - 2:sb_x.max() + 3] = True
    paint(fl, plate, FL_M); paint(fl, plate & (ys < sb_y.min() + 9), FL_I)
    tb_x = np.where(fill[:, x2:].any(0))[0] + x2
    for col, m in tongues((H, W), tb_x.min() + 4, tb_x.max() - 2, t2 + 10, rng, 12, 22, lay):
        paint(fl, m, col)

    # ---------- 합성 ----------
    comp = fl.copy()
    for layer in (main, sub):
        a = layer[..., 3] > 0
        comp[a] = layer[a]
    # 플래시: 본체 색 → 흰색·하늘색(검정 테·부제·불꽃은 그대로)
    flash = comp.copy()
    rep = {RED: WHITE, RED_HI: WHITE, RED_D: CY1, EXTR: CY2, EXTR_D: CY3}
    for a, b in rep.items():
        sel = main_alpha & (main[..., 0] == a[0]) & (main[..., 1] == a[1]) & (main[..., 2] == a[2])
        sel &= ~sub_alpha
        flash[sel] = (*b, 255)

    os.makedirs(OUT, exist_ok=True)
    for name, arr in (('title_logo_flames', fl), ('title_logo_main', main), ('title_logo_sub', sub),
                      ('title_logo_flash', flash), ('title_logo', comp)):
        Image.fromarray(arr, 'RGBA').save(os.path.join(OUT, name + '.png'), optimize=True)
    fx = np.where(fill.any(0))[0]
    print('fill x', fx.min(), fx.max(), 'w%%=%.0f' % ((fx.max() - fx.min() + 1) / W * 100), 'm1', m1.shape, 'm2', m2.shape, 'sub', s.shape)


if __name__ == '__main__':
    build()
