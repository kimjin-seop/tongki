# -*- coding: utf-8 -*-
"""PWA 아이콘 생성(2026-11-22, 윤프론). 원본 = 저장소의 자체 제작 파비콘 public/favicon.svg(16x16 코드 도트, 불꽃 피구공).
원작 ROM 이미지·외부 샘플 미사용. 확대는 정수배 nearest(도트 유지). Pillow 만 사용.

출력(public/):
  icon-192.png, icon-512.png        purpose any      : 16x16 전체를 x12 / x32, 투명 배경(기존 파일과 같은 픽셀)
  icon-maskable-192.png, -512.png   purpose maskable : 창 색 #004824 꽉 채움 + 그림 bbox 를 안전 영역(지름 80% 원) 안에 가운데 정수배

사용: python -I tools/build-pwa-icons.py   (--check = 쓰지 않고 기존 파일과 픽셀 비교만)
"""
import os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
BG = (0x00, 0x48, 0x24, 255)  # manifest theme/background = 창 색 --r-win


def master():
    svg = open(os.path.join(PUB, 'favicon.svg'), encoding='utf-8').read()
    m = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for x, y, w, h, c in re.findall(r'<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="#([0-9a-fA-F]{6})"/>', svg):
        col = tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
        for yy in range(int(y), int(y) + int(h)):
            for xx in range(int(x), int(x) + int(w)):
                m.putpixel((xx, yy), col)
    return m


def up(im, k):
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def maskable(m, size):
    art = m.crop(m.getbbox())
    # 안전 영역 = 가운데 지름 80% 원. 정사각 그림의 대각선이 그 원 안에 들어가는 최대 정수배
    k = max(1, int(size * 0.8 / (2 ** 0.5) / max(art.size)))
    art = up(art, k)
    out = Image.new('RGBA', (size, size), BG)
    out.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return out.convert('RGB'), k


def main():
    check = '--check' in sys.argv
    m = master()
    outs = {'icon-192.png': up(m, 12), 'icon-512.png': up(m, 32)}
    for s in (192, 512):
        outs[f'icon-maskable-{s}.png'], k = maskable(m, s)
        print(f'maskable {s}: x{k}')
    bad = 0
    for name, im in outs.items():
        p = os.path.join(PUB, name)
        same = os.path.exists(p) and Image.open(p).convert(im.mode).tobytes() == im.tobytes()
        if check or same:  # 픽셀이 같으면 다시 쓰지 않는다(바이트 변경 방지)
            print(('SAME ' if same else 'DIFF ') + name); bad += check and not same
        else:
            im.save(p, optimize=True); print('wrote', name, im.size)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
