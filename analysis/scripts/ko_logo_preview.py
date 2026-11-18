# 한국판 로고 QA 시트: 레이어별 3배 + 원작 일본 로고와 나란히 비교 + 팔레트/투명 경계 검사.
# python -I analysis/scripts/ko_logo_preview.py <ko_dir> <jp_dir> <out_png>
import sys, os
import numpy as np
from PIL import Image, ImageDraw

ko, jp, out = sys.argv[1], sys.argv[2], sys.argv[3]
BG = (36, 108, 252)
names = ['title_logo', 'title_logo_flames', 'title_logo_main', 'title_logo_sub', 'title_logo_flash']


def on_bg(p, bg=BG):
    im = Image.open(p).convert('RGBA')
    base = Image.new('RGBA', im.size, bg + (255,))
    base.alpha_composite(im)
    return base


def x(im, k):
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


for n in names:
    a = np.array(Image.open(os.path.join(ko, n + '.png')).convert('RGBA'))
    al = a[..., 3]
    semi = ((al > 0) & (al < 255)).sum()
    cols = {tuple(c) for c in a[al > 0][:, :3]}
    bad = [c for c in cols if any(v % 36 for v in c)]
    ys, xs = np.where(al > 0)
    print(f'{n}: size={a.shape[1]}x{a.shape[0]} colors={len(cols)} semi_alpha={semi} non_md={bad} bbox=({xs.min()},{ys.min()})-({xs.max()},{ys.max()}) w%={(xs.max()-xs.min()+1)/a.shape[1]*100:.0f}')

k = 3
W, H = 254 * k, 124 * k
sheet = Image.new('RGBA', (W * 2 + 30, H * 3 + 120), (40, 40, 40, 255))
d = ImageDraw.Draw(sheet)
sheet.paste(x(on_bg(os.path.join(jp, 'title_logo.png')), k), (10, 20)); d.text((10, 4), 'JP original (x3)', fill='white')
sheet.paste(x(on_bg(os.path.join(ko, 'title_logo.png')), k), (W + 20, 20)); d.text((W + 20, 4), 'KO new (x3)', fill='white')
sheet.paste(x(on_bg(os.path.join(ko, 'title_logo_flash.png')), k), (10, H + 50)); d.text((10, H + 34), 'KO flash (x3)', fill='white')
# 레이어 분리(각 x1.5 대신 x3 를 반으로 나눠 2x2)
for i, n in enumerate(['title_logo_flames', 'title_logo_main', 'title_logo_sub']):
    im = x(on_bg(os.path.join(ko, n + '.png'), (60, 60, 60)), 1)
    im = im.resize((254 * 2 // 1, 124 * 2 // 1), Image.NEAREST) if False else x(im, 1)
    sheet.paste(x(im, 1), (W + 20 + (i % 2) * 380, H + 50 + (i // 2) * 140)); d.text((W + 20 + (i % 2) * 380, H + 36 + (i // 2) * 140), n + ' x1', fill='white')
# 1x 실제 크기 비교 + 2x
sheet.paste(on_bg(os.path.join(jp, 'title_logo.png')), (10, 2 * H + 80)); d.text((10, 2 * H + 64), 'JP x1', fill='white')
sheet.paste(on_bg(os.path.join(ko, 'title_logo.png')), (280, 2 * H + 80)); d.text((280, 2 * H + 64), 'KO x1', fill='white')
sheet.paste(x(on_bg(os.path.join(ko, 'title_logo.png')), 2), (560, 2 * H + 80)); d.text((560, 2 * H + 64), 'KO x2', fill='white')
sheet.save(out)
print('saved', out)
