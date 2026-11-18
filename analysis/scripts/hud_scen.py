import numpy
"""HUD 시나리오 렌더 (analysis/gfx/hud/ 에 저장). 사용: python -I analysis/scripts/hud_scen.py  (cwd=프로젝트 루트)"""
import sys, copy, pickle
sys.path.insert(0, "analysis/scripts")
from drv import *
import hud_render as H
from PIL import Image, ImageDraw, ImageFont
try: FONT=ImageFont.truetype('C:/Windows/Fonts/malgun.ttf',12)
except Exception: FONT=None
OUT = 'analysis/gfx/hud/'

def base():
    md = load('match_story0')
    for _ in range(400):
        md.pad = [0, 0]; md.run_frame()
    return md

def snap(md, name, full=True):
    im = H.render(md)
    if full: im.save(OUT + name + '.png')
    return im

def top(im, h=64, s=3):
    return im.crop((0, 0, 320, h)).resize((320 * s, h * s), Image.NEAREST)

def montage(ims, labels, path, s=2, h=64):
    W = 320 * s
    out = Image.new('RGB', (W, (h * s + 14) * len(ims)), (30, 30, 30))
    d = ImageDraw.Draw(out)
    for i, (im, lb) in enumerate(zip(ims, labels)):
        out.paste(im.crop((0, 0, 320, h)).resize((W, h * s), Image.NEAREST), (0, i * (h * s + 14) + 14))
        d.text((4, i * (h * s + 14) + 0), lb, fill=(255, 255, 0), font=FONT)
    out.save(path)

if __name__ == '__main__':
    mdb = base()
    pickle.dump(mdb, open('analysis/state/hud_base.pkl', 'wb'))
