import numpy
"""HUD 그래픽 추출 -> public/assets/rom/hud/ (PNG RGBA + hud_layout.json). cwd=프로젝트 루트."""
import sys, json
sys.path.insert(0, "analysis/scripts")
from gfxdec import decode
from drv import load
import hud_render as H
import numpy as np
from PIL import Image
rom = open('rom/danpei.gen', 'rb').read()
OUT = 'public/assets/rom/hud/'
def rgb(w): return H.cram_rgb(w)
def team_pal(t):
    o = int.from_bytes(rom[0x2FAEE + t * 2:0x2FAEE + t * 2 + 2], 'big')
    return [int.from_bytes(rom[0x2FAEE + o + i * 2:0x2FAEE + o + i * 2 + 2], 'big') for i in range(16)]
def tiles(data):
    n = len(data) // 32
    t = np.zeros((n, 8, 8), np.uint8)
    for i in range(n):
        for y in range(8):
            for x in range(4):
                b = data[i * 32 + y * 4 + x]
                t[i, y, x * 2] = b >> 4; t[i, y, x * 2 + 1] = b & 15
    return t
def compose(T, t0, w, h):  # 스프라이트 타일 순서(열 우선)
    im = np.zeros((h * 8, w * 8), np.uint8)
    for cx in range(w):
        for cy in range(h):
            im[cy * 8:cy * 8 + 8, cx * 8:cx * 8 + 8] = T[t0 + cx * h + cy]
    return im
def to_rgba(idx, pal):
    a = np.zeros(idx.shape + (4,), np.uint8)
    for i in range(1, 16):
        m = idx == i
        a[m, :3] = rgb(pal[i]); a[m, 3] = 255
    return Image.fromarray(a, 'RGBA')
ptrs = [int.from_bytes(rom[0x4EFFE + i * 4:0x4EFFE + i * 4 + 4], 'big') for i in range(25)]
layout = {'canvas': [320, 224], 'faces': {}, 'palettes': {}}
atlas = Image.new('RGBA', (7 * 24, 25 * 24), (0, 0, 0, 0))
for t in range(25):
    data, _, _, n = decode(rom, ptrs[t]); assert n == 63, (t, n)
    T = tiles(data); pal = team_pal(t)
    layout['palettes']['team_%02d' % t] = [list(rgb(w)) for w in pal]
    for p in range(7):
        im = to_rgba(compose(T, p * 9, 3, 3), pal)
        atlas.paste(im, (p * 24, t * 24))
atlas.save(OUT + 'faces_atlas.png')
layout['faces'] = {'file': 'faces_atlas.png', 'size': [24, 24], 'cols': 7, 'rows': 25,
  'index': 'x = player_idx(0..6)*24, y = team_id(0..24)*24', 'rom_stream_ptr_table': '0x4EFFE (u32 x25, 63 tiles = 7 faces x 9 tiles)',
  'palette': 'team palette table ROM 0x2FAEE (u16 offset per team, 16 words); color index 0 transparent', 'stored_orientation': 'as ROM; left side (seat 0) is drawn h-flipped'}
# UI 타일: 경기 중 VRAM 상태에서 추출 (팔레트 라인2)
md = load('ctrl0'); vram = md.vdp.vram; cram = md.vdp.cram
T = tiles(bytes(vram[:0x800 * 32]))
pal2 = list(cram[32:48]); layout['palettes']['ui_line2'] = [list(rgb(w)) for w in pal2]
def save(name, idx, pal=pal2):
    to_rgba(idx, pal).save(OUT + name + '.png')
save('pole', compose(T, 0x58F, 1, 4))
dig = Image.new('RGBA', (10 * 16, 16), (0, 0, 0, 0))
for n in range(10):
    dig.paste(to_rgba(compose(T, 0x5D7 + n * 4, 2, 2), pal2), (n * 16, 0))
dig.save(OUT + 'digits_big.png')
save('dash', compose(T, 0x5FF, 1, 1))
save('marker_1p', compose(T, 0x583, 2, 2)); save('marker_com', compose(T, 0x58B, 2, 2))
gl = Image.new('RGBA', (11 * 8, 8), (0, 0, 0, 0))
for i, ch in enumerate('0123456789:'):
    g = T[ord(ch)].copy()
    a = np.zeros((8, 8, 4), np.uint8)
    for y in range(8):
        for x in range(8):
            c = pal2[g[y, x]] if g[y, x] else None
            a[y, x, :3] = rgb(pal2[g[y, x]]); a[y, x, 3] = 255  # 타이머 글리프는 배경(idx1) 포함 불투명
    gl.paste(Image.fromarray(a, 'RGBA'), (i * 8, 0))
gl.save(OUT + 'timer_font.png')
layout['ui'] = {
 'pole': {'file': 'pole.png', 'size': [8, 32]},
 'digits_big': {'file': 'digits_big.png', 'cell': [16, 16], 'order': '0123456789', 'note': 'sprite tile = 0x5D7 + n*4'},
 'dash': {'file': 'dash.png', 'size': [8, 8]},
 'marker_1p': {'file': 'marker_1p.png', 'size': [16, 16]}, 'marker_com': {'file': 'marker_com.png', 'size': [16, 16]},
 'timer_font': {'file': 'timer_font.png', 'cell': [8, 8], 'order': '0123456789:', 'note': 'ASCII 1bpp font tiles 0x30.. in VRAM, pal2 idx1=black idx3=white, opaque'}}
json.dump(layout, open(OUT + 'hud_layout.json', 'w'), indent=1, ensure_ascii=False)
print('ok')
