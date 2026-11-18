# 2P 조작 선수 표식 생성: 원작에는 2P 마커가 없어 marker_1p.png(16x16)의 '1' 글리프(열 0~7, 행 0~6)만
# 같은 굵기·4방향 외곽선 규칙의 '2' 픽셀 글리프로 바꾼다. 'P'·아래 화살표·8행 외곽선·팔레트(흑/백)는 그대로 복사.
# 실행: python tools/make-marker-2p.py   -> public/assets/rom/hud/marker_2p.png
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
HUD = ROOT / 'public' / 'assets' / 'rom' / 'hud'

# 채움(흰색) 픽셀. 열 1~6, 행 1~6 (2px 획)
GLYPH_2 = [
    '.####.',
    '##..##',
    '...##.',
    '..##..',
    '.##...',
    '######',
]


def main():
    src = Image.open(HUD / 'marker_1p.png').convert('RGBA')
    w, h = src.size
    assert (w, h) == (16, 16), src.size
    outline = src.getpixel((2, 0))   # 원작 마커 외곽선색(검정)
    fill = src.getpixel((2, 1))      # 원작 마커 채움색(흰색)
    assert outline[3] == 255 and fill[3] == 255 and outline != fill
    out = src.copy()
    clear = (0, 0, 0, 0)
    for y in range(0, 7):            # '1' 영역 지우기(8행 외곽선은 'P'와 공유하므로 유지)
        for x in range(0, 8):
            out.putpixel((x, y), clear)
    cells = {(1 + i, 1 + j) for j, row in enumerate(GLYPH_2) for i, c in enumerate(row) if c == '#'}
    for (x, y) in cells:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if q not in cells and 0 <= q[0] < 8 and 0 <= q[1] < 8:
                out.putpixel(q, outline)
    for p in cells:
        out.putpixel(p, fill)
    dst = HUD / 'marker_2p.png'
    out.save(dst)
    print('wrote', dst)
    for y in range(h):
        print(''.join('.' if out.getpixel((x, y))[3] == 0 else ('#' if out.getpixel((x, y)) == fill else 'o') for x in range(w)))


if __name__ == '__main__':
    main()
