"""인트로/타이틀 에셋·타이밍 추출. 입력: t_intro_rec.py 기록(pkl, 부팅 f0부터 무입력).
사용(cwd=프로젝트 루트): python -I analysis/scripts/t_intro_extract.py <rec.pkl>
출력: public/assets/rom/intro/*.png, intro_timeline.json / analysis/gfx/intro/*.png(몽타주)"""
import numpy as np
import sys, os, json, hashlib
sys.path.insert(0, 'analysis/scripts')
import intro_lib as I
from PIL import Image, ImageDraw

rec = I.load(sys.argv[1])
OUT = 'public/assets/rom/intro/'
GFX = 'analysis/gfx/intro/'
os.makedirs(OUT, exist_ok=True); os.makedirs(GFX, exist_ok=True)
NF = len(rec['fr'])
TITLE = min(2899, NF - 1)

SCENES = [  # id, 시작 f, 끝 f(포함), 기준 팔레트 프레임
    ('sega_logo', 47, 265, None),
    ('blank', 266, 341, None),
    ('fireball', 342, 384, 700),
    ('flame_burst', 385, 510, 700),
    ('sub_logo_in', 511, 563, 700),
    ('wipe_logo_reveal', 564, 649, 700),
    ('logo_flash', 650, 961, 700),
    ('black1', 962, 1024, None),
    ('fire_band_team', 1025, 1410, 1250),
    ('rivals', 1411, 2204, 2000),
    ('throw_band', 2205, 2407, 2300),
    ('white', 2408, 2513, TITLE),
    ('title_fadein', 2514, 2540, TITLE),
    ('title_hold', 2541, 2843, TITLE),
    ('title_ready', 2844, TITLE, TITLE),
]
def scene_of(f):
    for s in SCENES:
        if s[1] <= f <= s[2]: return s
    return None

def hx(c): return '#%02x%02x%02x' % tuple(int(v) for v in c[:3])
def hsh(im): return hashlib.md5(im.tobytes()).hexdigest()[:10]
def crop_alpha(im):
    bb = im.getbbox(); return (im.crop(bb), bb) if bb else (None, None)

def plane_screen(f, which, palframe=None, rows=None):
    """플레인을 스크롤 적용해 화면(320x224) RGBA 로. 라인스크롤 지원. rows=(y0,y1) 플레인 행 제한."""
    P, _ = I.plane_rgba(rec, f, which, palframe)
    a = np.array(P)
    if rows: a[:rows[0]] = 0; a[rows[1]:] = 0
    sc = I.scroll(rec, f)[which]
    out = np.zeros((224, 320, 4), np.uint8)
    H, W = a.shape[:2]
    xs = np.arange(320)
    for y in range(224):
        yy = (y + sc['v']) % H
        out[y] = a[yy, (xs - sc['h'][y]) % W]
    return Image.fromarray(out, 'RGBA')

def sprites_screen(f, filt=None, palframe=None):
    im = I.sprite_layer(rec, f, pad=0, filt=filt, palframe=palframe)
    return im

def vis(s): return not (s['x'] <= -127 and s['y'] <= -127) and s['x'] > -128

assets = {}
def save(name, im, **meta):
    im.save(OUT + name)
    assets[name] = dict(w=im.width, h=im.height, **meta)
    print('saved', name, im.size)

# ---------------- 1. 타이틀 로고 (최종 타이틀 팔레트) ----------------
LOGO_A_ROWS = (0, 136)  # 플레인 A 로고 행(아래는 메뉴 패널)
def logo_layers(f, palframe=None):
    A = plane_screen(f, 'A', palframe, LOGO_A_ROWS)
    B = plane_screen(f, 'B', palframe)
    S = sprites_screen(f, lambda s: s['pal'] == 1, palframe)
    comp = Image.new('RGBA', (320, 224)); comp.alpha_composite(B); comp.alpha_composite(A); comp.alpha_composite(S)
    return B, A, S, comp
B, A, S, comp = logo_layers(TITLE)
bb = comp.getbbox()
print('title logo bbox(screen, final)', bb)
for nm, im in (('title_logo.png', comp), ('title_logo_flames.png', B), ('title_logo_main.png', A), ('title_logo_sub.png', S)):
    save(nm, im.crop(bb), screen_final=[bb[0], bb[1]], screen_intro=[bb[0], bb[1] + 32], src='title f%d' % TITLE)
# 플래시(백색화) 변형: f760 (인트로 위치 +32)
B2, A2, S2, comp2 = logo_layers(760)
bb2 = (bb[0], bb[1] + 32, bb[2], bb[3] + 32)
save('title_logo_flash.png', comp2.crop(bb2), screen_intro=[bb2[0], bb2[1]], src='f760 logo_flash')
# x3 미리보기(분석용)
comp.crop(bb).resize(((bb[2]-bb[0])*3, (bb[3]-bb[1])*3), Image.NEAREST).save(GFX + 'title_logo_x3.png')

# 타이틀 메뉴 스프라이트(참고): PUSH START BUTTON(pal2), 커서 공(pal3)
for nm, pl in (('title_push_start.png', 2), ('title_cursor.png', 3)):
    im = sprites_screen(TITLE, lambda s, pl=pl: s['pal'] == pl and vis(s))
    c, b = crop_alpha(im)
    if c:
        a = np.array(c); key = np.array(I.bgcolor(rec, TITLE), np.uint8)
        a[(a[:, :, :3] == key).all(2)] = 0  # 백드롭과 같은 파랑 상자 제거
        c = Image.fromarray(a, 'RGBA')
        save(nm, c, screen_final=[b[0], b[1]], src='title f%d' % TITLE, note='백드롭색(파랑) 투명 처리')

# ---------------- 2. 스프라이트 셀 추출 공통 ----------------
def cel_track(f0, f1, filt, palframe, key):
    cels = []; idx = {}; track = []
    for f in range(f0, f1 + 1):
        im = sprites_screen(f, lambda s: vis(s) and filt(s), palframe) if True else None
        # 화면 밖 포함하려면 pad
        im = I.sprite_layer(rec, f, pad=64, filt=lambda s: vis(s) and filt(s), palframe=palframe)
        c, b = crop_alpha(im)
        if c is None: track.append(None); continue
        k = hsh(c)
        if k not in idx: idx[k] = len(cels); cels.append(c)
        track.append([idx[k], b[0] - 64, b[1] - 64])
    return cels, track
def sheet(cels, name, **meta):
    W = sum(c.width for c in cels) + 2 * (len(cels) - 1); Hh = max(c.height for c in cels)
    sh = Image.new('RGBA', (W, Hh)); x = 0; rects = []
    for c in cels:
        sh.paste(c, (x, 0)); rects.append([x, 0, c.width, c.height]); x += c.width + 2
    save(name, sh, frames=rects, **meta)
    return rects

timeline = dict(fps=60, note='f = 부팅(리셋) 후 프레임, NTSC 60Hz. 화면 320x224.', scenes=[], tracks={})

# 2-1 불덩이(fireball)
cels, tr = cel_track(342, 384, lambda s: True, 700, 'fireball')
sheet(cels, 'intro_fireball.png', src='sprites f342-384')
timeline['tracks']['fireball'] = dict(f0=342, sheet='intro_fireball.png', data=tr, fmt='[cel, x, y] 화면 좌상단, null=없음')

# 2-2 불꽃 폭발(플레인 B 타일 애니)
seqk = []; cels = []; idx = {}
for f in range(385, 511):
    P = plane_screen(f, 'B', 700); k = hsh(P)
    if k not in idx: idx[k] = len(cels); cels.append(P)
    seqk.append(idx[k])
U = Image.new('RGBA', (320, 224))
for c in cels: U.alpha_composite(c)
ub = U.getbbox(); cels = [c.crop(ub) for c in cels]
runs = []
for i, k in enumerate(seqk):
    if runs and runs[-1][0] == k: runs[-1][1] += 1
    else: runs.append([k, 1])
sheet(cels, 'intro_flame_burst.png', screen=[ub[0], ub[1]], src='plane B f385-510')
timeline['tracks']['flame_burst'] = dict(f0=385, sheet='intro_flame_burst.png', screen=[ub[0], ub[1]], runs=runs, fmt='[cel, 지속프레임]')

# 2-3 소로고(炎の闘球児) 스프라이트 위치 이력
sl = []
for f in range(511, NF):
    S_ = [s for s in I.sprites(rec, f) if vis(s) and s['pal'] == 1]
    sl.append([min(s['x'] for s in S_), min(s['y'] for s in S_)] if S_ else None)
timeline['tracks']['sub_logo_pos'] = dict(f0=511, data=sl, fmt='[x,y] 소로고 스프라이트 좌상단(화면)')

# 2-4 와이프(흰 선/흰 띠/검은 띠) 스팬
spans = []
for f in range(564, 651):
    L = sprites_screen(f, lambda s: vis(s) and s['pal'] != 1)
    if f < 612:
        Ap = plane_screen(f, 'A'); L2 = Image.new('RGBA', (320, 224)); L2.alpha_composite(Ap); L2.alpha_composite(L); L = L2
    a = np.array(L); fr = []
    for y in range(224):
        row = a[y, :, 3] > 0
        if not row.any(): continue
        xs = np.where(np.diff(np.concatenate([[0], row.astype(int), [0]])))[0]
        for x0, x1 in zip(xs[::2], xs[1::2]):
            fr.append([y, int(x0), int(x1), hx(a[y, x0])])
    spans.append(fr)
timeline['tracks']['wipe_spans'] = dict(f0=564, data=spans, fmt='프레임별 [y, x0, x1(미포함), 색] 가로 띠. 로고(플레인 A)는 f612 이후 띠 아래에 이미 있음')

# 2-5 밴드 배경 + 라인 스크롤 속도
def band(f, name, f0, f1, palframe):
    P, _ = I.plane_rgba(rec, f, 'B', palframe)
    sc0 = I.scroll(rec, f0)
    ys = [y for y in range(224) if any(I.scroll(rec, g)['B']['h'][y] != 0 for g in (f0 + 5, f0 + 40))]
    y0, y1 = min(ys), max(ys) + 1
    vB = sc0['B']['v']
    save(name, P.crop((0, y0 + vB, 512, y1 + vB)), screen_y=y0, src='plane B f%d, 512px 가로 반복' % f)
    hs = [I.scroll(rec, g)['B']['h'] for g in range(f0, f1 + 1)]
    lines = []
    for y in range(y0, y1):
        d = [((hs[i + 1][y] - hs[i][y] + 256) % 512) - 256 for i in range(len(hs) - 1)]
        vals = sorted(set(d))
        lines.append(dict(y=y, x0=hs[0][y], vx=(d[0] if len(vals) == 1 else None), vx_avg=round(sum(d) / len(d), 3), vx_set=vals[:6]))
    return dict(f0=f0, f1=f1, y0=y0, y1=y1, image=name, lines=lines,
                fmt='화면 x = 플레인x + h(y), h 는 매 프레임 vx 만큼 변함(512 순환). vx=null 이면 vx_set 순환/가변')
timeline['tracks']['band_fire'] = band(1250, 'intro_band_fire.png', 1030, 1300, 1250)
timeline['tracks']['band_cyan'] = band(2300, 'intro_band_cyan.png', 2215, 2400, 2300)

# 2-6 캐릭터 일러스트(플레인 A)
for nm, f in (('intro_art_team.png', 1250), ('intro_art_rivals.png', 2000), ('intro_art_throw.png', 2300)):
    P, _ = I.plane_rgba(rec, f, 'A'); c, b = crop_alpha(P)
    save(nm, c, plane_xy=[b[0], b[1]], src='plane A f%d' % f)
    assets[nm]['note'] = '화면 x = plane_x + A.h, 화면 y = plane_y - A.v'

# 2-7 공(throw) 스프라이트, 잔상 선
cels, tr = cel_track(2205, 2407, lambda s: s['pal'] == 2, 2300, 'ball')
sheet(cels, 'intro_ball.png', src='sprites pal2 f2205-2407')
timeline['tracks']['ball'] = dict(f0=2205, sheet='intro_ball.png', data=tr, fmt='[cel, x, y]')
st_cels = []; st_idx = {}; st_tr = {}
for f0, f1, pf, nm in ((1025, 1410, 1250, 'streaks_fire'), (2205, 2407, 2300, 'streaks_cyan')):
    fr_list = []
    for f in range(f0, f1 + 1):
        row = []
        for s in I.sprites(rec, f):
            if not vis(s) or s['pal'] != 0 or s['h'] != 1: continue
            im = I.sprite_layer(rec, f, pad=64, filt=lambda q, s=s: (q['x'], q['y'], q['t'], q['w']) == (s['x'], s['y'], s['t'], s['w']), palframe=pf)
            c, b = crop_alpha(im)
            if c is None: continue
            k = hsh(c)
            if k not in st_idx: st_idx[k] = len(st_cels); st_cels.append(c)
            row.append([st_idx[k], s['x'], s['y']])
        fr_list.append(row)
    st_tr[nm] = dict(f0=f0, data=fr_list, fmt='프레임별 [[cel,x,y],...] 화면 좌상단(셀 투명 여백 제외 전 원점=스프라이트 원점 근사)')
sheet(st_cels, 'intro_streaks.png', src='sprites pal0 1행 f1025-1410, f2205-2407')
timeline['tracks'].update(st_tr)

# ---------------- 3. 프레임별 상태(스크롤·페이드·배경색) ----------------
per = []
for f in range(47, NF):
    fr = rec['fr'][f]; sc = I.scroll(rec, f); s = scene_of(f)
    ref = s[3] if s else None
    d = dict(f=f, sub=fr['st'][2], disp=int(bool(fr['reg'][1] & 0x40)), bg=hx(I.bgcolor(rec, f)),
             Ah=[sc['A']['h'][64], sc['A']['h'][159]], Av=(sc['A']['v'] - 1024 if sc['A']['v'] & 0x200 else sc['A']['v']),
             Bv=(sc['B']['v'] - 1024 if sc['B']['v'] & 0x200 else sc['B']['v']))
    if ref is not None:
        d['fade'] = [list(I.fade(rec, f, ref, ln)) for ln in range(4)]
    if s and s[0] in ('rivals', 'fire_band_team', 'throw_band'):
        scr = np.array(I.screen(rec, f)); d['band'] = hx(scr[100, 2])
    per.append(d)
timeline['frames'] = per
timeline['frames_fmt'] = ('disp=화면표시, bg=백드롭색, Ah=[플레인A h(y64), h(y159)], Av/Bv=세로스크롤(양수=내용이 위로), '
                          'fade=팔레트 라인0~3 [모드,k] (기준 프레임 대비: white=k만큼 흰색으로, black=k만큼 어둡게), band=화면(2,100) 색')
for s in SCENES:
    timeline['scenes'].append(dict(id=s[0], f0=s[1], f1=s[2], frames=s[2] - s[1] + 1, ref_palette_frame=s[3]))
timeline['assets'] = assets
json.dump(timeline, open(OUT + 'intro_timeline.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('timeline json', os.path.getsize(OUT + 'intro_timeline.json'))

# ---------------- 4. 몽타주 ----------------
def montage(name, fs, cols=6):
    W, Hh = 320, 224
    sh = Image.new('RGB', (cols * (W + 2), ((len(fs) + cols - 1) // cols) * (Hh + 14)), (40, 40, 40)); d = ImageDraw.Draw(sh)
    for i, f in enumerate(fs):
        x, y = (i % cols) * (W + 2), (i // cols) * (Hh + 14)
        sh.paste(I.screen(rec, f), (x, y + 14)); d.text((x + 2, y + 1), 'f%d sub%02x' % (f, rec['fr'][f]['st'][2]), fill=(255, 255, 0))
    sh.save(GFX + name)
montage('01_sega_fireball_flames.png', [60, 100, 200, 300, 345, 360, 376, 380, 390, 410, 430, 450, 480, 512, 545, 560])
montage('02_wipe_logo_flash.png', [580, 600, 606, 610, 614, 630, 640, 644, 646, 648, 650, 700, 745, 760, 800, 830, 900, 961])
montage('03_fire_band_team.png', [1030, 1100, 1160, 1200, 1250, 1290, 1312, 1320, 1330, 1340, 1405, 1420])
montage('04_rivals.png', [1476, 1478, 1518, 1522, 1560, 1570, 1600, 1700, 1740, 1760, 1790, 1830, 1860, 1880, 1900, 2000, 2100, 2204])
montage('05_throw_band.png', [2210, 2240, 2260, 2280, 2300, 2320, 2340, 2360, 2380, 2390, 2400, 2405])
montage('06_title.png', [2420, 2512, 2518, 2526, 2534, 2540, 2700, 2841, 2843, 2846, 2877, TITLE])
