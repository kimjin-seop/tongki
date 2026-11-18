"""팀 선택 문서용 몽타주. 사용: python -I analysis/scripts/t_select_gfx.py"""
import numpy as np
import sys
sys.path.insert(0, 'analysis/scripts')
import intro_lib as I
from PIL import Image, ImageDraw

G = 'analysis/gfx/select/'
R = {k: I.load('analysis/state/sel/%s.pkl' % k) for k in ('m2', 'm2u', 'm1', 'm1c')}


def grid(items, out, cols=3, sc=1):
    W, H = 320 * sc, 224 * sc
    sh = Image.new('RGB', (W * cols, (H + 14) * ((len(items) + cols - 1) // cols)), (32, 32, 32)); d = ImageDraw.Draw(sh)
    for i, (k, f, lab) in enumerate(items):
        im = I.screen(R[k], f).resize((W, H), Image.NEAREST)
        x = (i % cols) * W; y = (i // cols) * (H + 14)
        sh.paste(im, (x, y + 14)); d.text((x + 3, y + 1), lab, fill=(255, 255, 0))
    sh.save(out)


grid([('m2', 30, '1 mode menu (8C) f30'), ('m2', 44, '2 window open f44'), ('m2', 49, '3 emblems drawn f49'),
      ('m2', 100, '4 idle 1P/2P cursor f100'), ('m2', 380, '5 1P picked(red) 2P moving f380'), ('m2', 540, '6 both picked, medal anim f540'),
      ('m1', 200, '7 1PvsCOM: COM cursor f200'), ('m2u', 170, '8 SPECIAL TEAM unlocked f170'), ('m2', 600, '9 rules window f600'),
      ('m1', 600, '10 lineup VS f600'), ('m1c', 150, '11 formation stats f150'), ('m1c', 230, '12 formation swap f230')],
     G + '01_select_flow.png')

# 레이어 분리
rec = R['m2']; f = 380
B, _ = I.plane_rgba(rec, f, 'B'); A, _ = I.plane_rgba(rec, f, 'A')
S = I.sprite_layer(rec, f, pad=0)
items = [B.crop((0, 0, 320, 224)), A.crop((0, 0, 320, 224)), S, I.screen(rec, f).convert('RGBA')]
labs = ['plane B (bg)', 'plane A (window/emblem/text)', 'sprites (cursor/ball)', 'composite']
sh = Image.new('RGBA', (640 * 2, (448 + 14) * 2), (255, 0, 255, 255)); d = ImageDraw.Draw(sh)
for i, (im, lab) in enumerate(zip(items, labs)):
    x = (i % 2) * 640; y = (i // 2) * 462
    sh.alpha_composite(im.resize((640, 448), Image.NEAREST), (x, y + 14)); d.rectangle((x, y, x + 640, y + 13), fill=(32, 32, 32)); d.text((x + 3, y + 1), lab, fill=(255, 255, 0))
sh.save(G + '02_select_layers.png')

# 좌표 격자
im = I.screen(R['m2u'], 100).resize((960, 672), Image.NEAREST); d = ImageDraw.Draw(im); s = 3
names = ['T.D 0', 'S.A 1', 'B.A 3', 'A.T 2', 'HOK 5', 'KYO 6', 'OKI 7', 'TOK 4', 'CHN 10', 'URS 11', 'EGY 14', 'GRE 12', 'BRA 13', 'CHI 9', 'USA 8']
for r in range(3):
    for c in range(5):
        x, y = 64 + 40 * c, 40 + 40 * r
        d.rectangle((x * s, y * s, (x + 24) * s - 1, (y + 16) * s - 1), outline=(255, 0, 255))
        d.rectangle(((x - 8) * s, (y - 8) * s, (x + 32) * s - 1, (y + 32) * s - 1), outline=(255, 255, 0))
        d.text(((x - 6) * s, (y + 25) * s), '(%d,%d) %s' % (c, r, names[r * 5 + c]), fill=(255, 255, 255))
sp = ['CHN 17', 'URS 18', 'EGY 21', 'GRE 19', 'BRA 20', 'CHI 16', 'USA 15']
for k in range(7):
    x, y = 24 + 40 * k, 176
    d.rectangle((x * s, y * s, (x + 24) * s - 1, (y + 16) * s - 1), outline=(255, 0, 255))
    d.text(((x - 6) * s, (y + 25) * s), 'x%d %s' % ((k + 6) % 7, sp[k]), fill=(255, 255, 255))
for gx in range(0, 320, 8):
    d.line((gx * s, 0, gx * s, 3), fill=(255, 255, 255))
d.text((4, 4), 'magenta=emblem 24x16, yellow=cursor 40x40, label=(col,row) team', fill=(255, 255, 255))
im.save(G + '03_select_grid_x3.png')
print('ok')
