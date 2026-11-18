"""UI 시안 목업 생성(단순 합성, 구현 아님). 사용: python -I analysis/scripts/ui_mock.py
시안 B(전부 원작 UI): 논리 384x216 캔버스에 원작 추출 에셋 + 픽셀 정렬 한글 → 3배(1152x648) 저장
시안 A(하이브리드): 1152x648 에 직접 그림(픽셀 에셋 정수배 + 매끈한 한글)
출력: analysis/gfx/select/mock_{A,B}_{lobby,select,room}.png, ko_mock.png, ui_font_compare.png"""
import numpy as np
import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter

AS = 'public/assets/'; SEL = AS + 'rom/select/'; G = 'analysis/gfx/select/'
FD = AS + 'fonts/DoHyeon-Regular.ttf'; FB = AS + 'fonts/BlackHanSans-Regular.ttf'
TN = {t['id']: t for t in json.load(open(AS + 'data/team_names.json', encoding='utf-8'))['teams']}
SJ = json.load(open(SEL + 'select.json', encoding='utf-8'))['assets']
T2E = SJ['emblems']['team_to_emblem']
ABBR = ['T.D', 'S.A', 'A.T', 'B.A', 'TOK', 'HOK', 'KYO', 'OKI', 'USA', 'CHI', 'CHN', 'URS', 'GRE', 'BRA', 'EGY']
GRID = [0, 1, 3, 2, 5, 6, 7, 4, 10, 11, 14, 12, 13, 9, 8]

def L(p): return Image.open(p).convert('RGBA')
BGU = L(SEL + 'select_bg_unit.png'); WIN = L(SEL + 'select_window_9s.png'); EMB = L(SEL + 'select_emblems.png')
FONTW = L(SEL + 'select_font_white.png'); FONTY = L(SEL + 'select_font_yellow.png'); BALL = L(SEL + 'select_ball_anim.png')
CUR = L(SEL + 'select_cursor_sheet.png'); FACES = L(AS + 'rom/hud/faces_atlas.png'); LOGO = L(AS + 'rom/intro/title_logo.png')
FILL = tuple(int(SJ['window_9slice']['fill'][i:i + 2], 16) for i in (1, 3, 5))

# 원작 팔레트 토큰(MD 3비트 x36)
C = dict(white=(252, 252, 252), yellow=(252, 252, 0), cyan=(0, 252, 252), orange=(252, 180, 0), red=(252, 0, 0),
         grey=(144, 144, 144), dgrey=(72, 72, 72), black=(0, 0, 0), green=FILL, blue=(36, 108, 252), sky=(72, 180, 252))

def emblem(team): return EMB.crop((T2E[team] * 24, 0, T2E[team] * 24 + 24, 16))
def face(team, i): return FACES.crop((i * 24, team * 24, i * 24 + 24, team * 24 + 24))
def cursor(row, step=2): return CUR.crop((step * 40, row * 40, step * 40 + 40, row * 40 + 40))
CR = {'1p': 0, '1p!': 1, '2p': 2, '2p!': 3, 'com': 4, 'com!': 5, 'plain': 6, 'plain!': 7}

def tile_bg(W, H, dim=0.0):
    im = Image.new('RGBA', (W, H))
    for y in range(0, H, 96):
        for x in range(0, W, 48): im.alpha_composite(BGU, (x, y))
    if dim:
        a = np.array(im).astype(float); a[:, :, :3] *= (1 - dim); im = Image.fromarray(a.astype(np.uint8), 'RGBA')
    return im

def window(im, x, y, w, h, fill=None):
    """9-slice, 8px 단위. fill 지정 시 가운데 색 교체(검정 창 등)"""
    for yy in range(0, h, 8):
        for xx in range(0, w, 8):
            sx = 0 if xx == 0 else (16 if xx >= w - 8 else 8); sy = 0 if yy == 0 else (16 if yy >= h - 8 else 8)
            t = WIN.crop((sx, sy, sx + 8, sy + 8))
            if fill and sx == 8 and sy == 8: t = Image.new('RGBA', (8, 8), fill + (255,))
            im.alpha_composite(t, (x + xx, y + yy))

def glyph_text(im, x, y, s, yellow=False):
    F = FONTY if yellow else FONTW
    for i, ch in enumerate(s.upper()):
        c = ord(ch) - 32
        if 0 <= c < 64: im.alpha_composite(F.crop((c * 8, 0, c * 8 + 8, 8)), (x + i * 8, y))

def px_text(im, x, y, s, size=12, col=C['white'], font=FD, mode='th', outline=None, shadow=None, anchor='la', ow=1):
    """픽셀 정렬 한글: 정수 크기 래스터 → 임계값(th) 또는 그대로(aa). outline/shadow 는 1px"""
    f = ImageFont.truetype(font, size)
    pd = 2 + ow; bb = f.getbbox(s, anchor=anchor); w, h = bb[2] - bb[0] + 2 * pd, bb[3] - bb[1] + 2 * pd
    m = Image.new('L', (w, h)); ImageDraw.Draw(m).text((pd - bb[0], pd - bb[1]), s, font=f, fill=255, anchor=anchor)
    a = np.array(m)
    if mode == 'th': a = np.where(a >= 96, 255, 0).astype(np.uint8)
    ox, oy = x + bb[0] - pd, y + bb[1] - pd
    def stamp(arr, color, dx, dy):
        lay = Image.new('RGBA', (w, h), color + (0,)); lay.putalpha(Image.fromarray(arr)); im.alpha_composite(lay, (ox + dx, oy + dy))
    if outline:
        d = np.array(Image.fromarray(a).filter(ImageFilter.MaxFilter(2 * ow + 1))); stamp(d, outline, 0, 0)
    if shadow: stamp(a, shadow, 1, 1)
    stamp(a, col, 0, 0)
    return bb[2] - bb[0]

def save3(im, name, k=3):
    big = im.resize((im.width * k, im.height * k), Image.NEAREST)
    for (x, y, t, col, size, font, ol) in TQ:
        if ol: px_text(big, x * k, y * k, t, size * k, ol, font=font, outline=ol, shadow=None, ow=k)
        px_text(big, x * k, y * k, t, size * k, col, font=font)
    TQ.clear(); big.save(G + name)

# ===================== 시안 B : 전부 원작 UI (384x216) =====================
W, H = 384, 216

TQ = []  # 시안 B 한글: 출력 해상도(3x)에서 임계 래스터(AA 없음)로 그림 - 1x 래스터는 획 소실(ui_font_compare 참고)
def T(im, x, y, s, col=C['white'], size=16, font=FD, outline=None, **k):
    TQ.append((x, y, s, col, size, font, outline))
    return ImageFont.truetype(font, size).getbbox(s)[2]

def b_lobby():
    im = tile_bg(W, H)
    im.alpha_composite(LOGO, (0, 0))
    window(im, 256, 8, 120, 136)
    T(im, 268, 15, '통키짱', C['yellow'])
    items = ['스토리 모드', '방 만들기', '컴퓨터 대전', '코드로 입장', '설정']
    for i, s in enumerate(items): T(im, 288, 36 + i * 20, s)
    im.alpha_composite(BALL.crop((0, 0, 16, 16)), (266, 36 + 2 * 20))
    window(im, 256, 152, 120, 56)
    T(im, 268, 160, '난이도'); T(im, 316, 160, '◀', C['cyan']); glyph_text(im, 336, 164, '2'); T(im, 350, 160, '▶', C['cyan'])
    T(im, 268, 182, '상대', C['grey']); T(im, 316, 182, '컴퓨터', C['grey'])
    window(im, 8, 128, 240, 80)
    T(im, 18, 135, '방 목록', C['yellow']); glyph_text(im, 196, 140, '3/12')
    rows = [('A3F9', '통키짱', '1/2', '대기', True), ('K7Q2', '강철맨', '2/2', '경기중', False), ('Z0P4', '맹태', '1/2', '대기', True)]
    for i, (code, host, n, stt, ok) in enumerate(rows):
        yy = 152 + i * 17; col = C['white'] if ok else C['grey']
        glyph_text(im, 34, yy + 4, code); T(im, 76, yy, host, col); glyph_text(im, 150, yy + 4, n)
        T(im, 188, yy, stt, C['cyan'] if ok else C['grey'])
    return im

def b_select():
    im = tile_bg(W, H)
    window(im, 8, 8, 232, 200)
    im.alpha_composite(BALL.crop((0, 0, 16, 16)), (20, 14)); im.alpha_composite(BALL.crop((0, 0, 16, 16)), (212, 14))
    T(im, 76, 14, '팀을 고르세요')
    for k, team in enumerate(GRID):
        c, r = k % 5, k // 5; x, y = 32 + 40 * c, 40 + 40 * r
        im.alpha_composite(emblem(team), (x, y)); glyph_text(im, x, y + 16, ABBR[team])
    im.alpha_composite(cursor(CR['1p'], 1), (24, 32))
    im.alpha_composite(cursor(CR['2p!'], 3), (24 + 40 * 1, 32))
    T(im, 20, 160, '1P', C['cyan']); T(im, 44, 160, TN[0]['name'])
    T(im, 20, 180, '2P', C['red']); T(im, 44, 180, TN[1]['name']); T(im, 196, 180, '결정', C['yellow'])
    for j, (team, lab, lc, done) in enumerate(((0, '1P', C['cyan'], False), (1, '2P', C['red'], True))):
        y0 = 8 + j * 100
        window(im, 248, y0, 128, 100)
        T(im, 256, y0 + 7, lab, lc); im.alpha_composite(emblem(team), (278, y0 + 8))
        if done: T(im, 336, y0 + 7, '결정', C['yellow'])
        T(im, 256, y0 + 26, TN[team]['name'])
        for i in range(7): im.alpha_composite(face(team, i), (258 + (i % 4) * 27, y0 + 46 + (i // 4) * 25))
    return im

def b_room():
    im = tile_bg(W, H)
    window(im, 8, 8, 368, 32)
    T(im, 18, 16, '대기실', C['yellow']); glyph_text(im, 72, 20, 'ROOM A3F9'); T(im, 308, 16, '관전 0', C['grey'])
    seats = [(0, '통키짱', '방장', C['yellow'], C['cyan']), (3, '강철맨', '준비 완료', C['cyan'], C['red'])]
    for j, (team, nick, badge, bc, lc) in enumerate(seats):
        x0 = 8 + j * 200
        window(im, x0, 44, 168, 120)
        T(im, x0 + 10, 52, '1P' if j == 0 else '2P', lc); T(im, x0 + 34, 52, nick)
        bw = ImageFont.truetype(FD, 16).getbbox(badge)[2]; T(im, x0 + 158 - bw, 52, badge, bc)
        im.alpha_composite(emblem(team), (x0 + 10, 74)); T(im, x0 + 40, 74, TN[team]['name'])
        for i in range(7): im.alpha_composite(face(team, i), (x0 + 12 + (i % 4) * 38, 98 + (i // 4) * 30))
    T(im, 181, 96, 'VS', C['yellow'], font=FB, outline=C['black'])
    window(im, 8, 168, 368, 40)
    acts = ['팀 변경', '준비', '시작', '나가기']
    for i, s in enumerate(acts): T(im, 44 + i * 88, 180, s)
    im.alpha_composite(BALL.crop((0, 0, 16, 16)), (24 + 2 * 88, 180))
    return im

# ===================== 시안 A : 하이브리드 (1152x648 직접) =====================
AW, AH = 1152, 648
def up(img, k): return img.resize((img.width * k, img.height * k), Image.NEAREST)
def a_text(im, x, y, s, size, col, font=FD, anchor='la', stroke=0, sc=C['black']):
    ImageDraw.Draw(im).text((x, y), s, font=ImageFont.truetype(font, size), fill=col, anchor=anchor, stroke_width=stroke, stroke_fill=sc)
def a_panel(im, x, y, w, h, border=C['grey'], fill=None, glow=None):
    d = ImageDraw.Draw(im)
    d.rectangle((x, y, x + w - 1, y + h - 1), fill=(fill or FILL))
    d.rectangle((x, y, x + w - 1, y + h - 1), outline=C['black'], width=3)
    d.rectangle((x + 3, y + 3, x + w - 4, y + h - 4), outline=(glow or border), width=3)
def a_bg():
    return up(tile_bg(384, 216, dim=0.55), 3)
def a_btn(im, x, y, w, h, s, on=False, sub=None, dis=False):
    a_panel(im, x, y, w, h, border=C['yellow'] if on else C['dgrey'], fill=(0, 108, 72) if on else FILL)
    a_text(im, x + 24, y + h // 2, s, 30, C['grey'] if dis else C['white'], anchor='lm')
    if sub: a_text(im, x + w - 20, y + h // 2, sub, 24, C['yellow'] if on else C['grey'], anchor='rm')

def a_lobby():
    im = a_bg()
    im.alpha_composite(up(LOGO, 2), (40, 16))
    a_text(im, 1112, 40, '통키짱', 28, C['white'], anchor='ra')
    bx, by = 48, 300
    a_btn(im, bx, by, 500, 64, '스토리 모드', on=True, sub='15경기')
    a_panel(im, bx, by + 80, 500, 120)
    a_text(im, bx + 24, by + 104, '컴퓨터와 대결', 30, C['white'])
    for i in range(3):
        on = i == 1; x = bx + 24 + i * 76
        a_panel(im, x, by + 144, 64, 44, border=C['yellow'] if on else C['dgrey'], fill=(0, 108, 72) if on else FILL)
        a_text(im, x + 32, by + 166, str(i + 1), 26, C['yellow'] if on else C['grey'], anchor='mm')
    a_btn(im, bx + 280, by + 144, 196, 44, '대결 시작')
    a_btn(im, bx, by + 216, 240, 64, '방 만들기')
    a_panel(im, bx + 256, by + 216, 160, 64, fill=(0, 0, 0)); a_text(im, bx + 276, by + 248, 'A3F9', 30, C['white'], anchor='lm')
    a_btn(im, bx + 424, by + 216, 76, 64, '입장')
    # 방 목록
    px0, py0 = 596, 120
    a_panel(im, px0, py0, 516, 488)
    a_text(im, px0 + 24, py0 + 20, '방 목록', 34, C['yellow'], font=FB)
    hdr = [('코드', 24), ('방장', 140), ('인원', 330), ('상태', 410)]
    for s, dx in hdr: a_text(im, px0 + dx, py0 + 80, s, 22, C['grey'])
    ImageDraw.Draw(im).line((px0 + 16, py0 + 110, px0 + 500, py0 + 110), fill=C['dgrey'], width=3)
    rows = [('A3F9', '통키짱', '1/2', '대기', True), ('K7Q2', '강철맨', '2/2', '경기 중', False), ('Z0P4', '맹태', '1/2', '대기', True)]
    for i, (code, host, n, stt, ok) in enumerate(rows):
        y = py0 + 124 + i * 64
        if i == 0: a_panel(im, px0 + 12, y - 4, 492, 56, border=C['yellow'], fill=(0, 108, 72))
        col = C['white'] if ok else C['grey']
        a_text(im, px0 + 24, y + 24, code, 26, col, anchor='lm'); a_text(im, px0 + 140, y + 24, host, 26, col, anchor='lm')
        a_text(im, px0 + 330, y + 24, n, 26, col, anchor='lm'); a_text(im, px0 + 410, y + 24, stt, 26, C['cyan'] if ok else C['grey'], anchor='lm')
    return im

def a_select():
    im = a_bg()
    a_text(im, 48, 28, '팀 선택', 44, C['white'], font=FB, stroke=3)
    a_panel(im, 40, 96, 700, 512)
    for k, team in enumerate(GRID):
        c, r = k % 5, k // 5; x, y = 64 + 134 * c, 120 + 160 * r
        sel = {0: C['cyan'], 1: C['red']}.get(k)
        a_panel(im, x, y, 118, 144, border=sel or C['dgrey'], fill=(0, 64, 40) if sel else FILL)
        im.alpha_composite(up(emblem(team), 3), (x + 23, y + 26))
        nm = TN[team]['name'].replace(' 국민학교', '')
        a_text(im, x + 59, y + 98, ABBR[team], 20, C['grey'], anchor='mm')
        a_text(im, x + 59, y + 120, nm, 20, C['white'], anchor='mm')
        if sel: a_text(im, x + 10, y + 5, '1P' if k == 0 else '2P', 18, sel, font=FB)
    for j, (team, lab, lc, st) in enumerate(((0, '1P', C['cyan'], '고르는 중'), (1, '2P', C['red'], '결정 완료'))):
        y0 = 96 + j * 264
        a_panel(im, 760, y0, 352, 248, border=lc)
        a_text(im, 784, y0 + 20, lab, 34, lc, font=FB)
        im.alpha_composite(up(emblem(team), 2), (840, y0 + 22))
        a_text(im, 900, y0 + 38, TN[team]['name'], 28, C['white'], anchor='lm')
        for i in range(7):
            im.alpha_composite(up(face(team, i), 2), (784 + (i % 4) * 76, y0 + 76 + (i // 4) * 56))
        a_text(im, 1092, y0 + 220, st, 24, C['yellow'] if j else C['grey'], anchor='rm')
    return im

def a_room():
    im = a_bg()
    a_text(im, 48, 28, '대기실', 44, C['white'], font=FB, stroke=3); a_text(im, 230, 46, '방 코드 A3F9', 28, C['yellow'], anchor='lm')
    for j, (team, nick, badge, bc, lc) in enumerate(((0, '통키짱', '방장', C['yellow'], C['cyan']), (3, '강철맨', '준비 완료', C['cyan'], C['red']))):
        x0 = 40 + j * 572
        a_panel(im, x0, 100, 500, 380, border=lc)
        a_text(im, x0 + 24, 124, '1P' if j == 0 else '2P', 36, lc, font=FB); a_text(im, x0 + 90, 146, nick, 34, C['white'], anchor='lm')
        a_panel(im, x0 + 500 - 180, 120, 156, 52, border=bc, fill=(0, 0, 0)); a_text(im, x0 + 500 - 102, 146, badge, 26, bc, anchor='mm')
        im.alpha_composite(up(emblem(team), 3), (x0 + 24, 196)); a_text(im, x0 + 112, 220, TN[team]['name'], 32, C['white'], anchor='lm')
        a_text(im, x0 + 476, 220, '변경 ▶', 24, C['grey'], anchor='rm')
        for i in range(7):
            im.alpha_composite(up(face(team, i), 3), (x0 + 28 + (i % 4) * 116, 268 + (i // 4) * 96))
    a_text(im, 576, 290, 'VS', 56, C['yellow'], font=FB, anchor='mm', stroke=4)
    bt = [('팀 변경', False), ('준비', False), ('시작', True), ('나가기', False)]
    for i, (s, on) in enumerate(bt):
        a_btn(im, 40 + i * 272, 512, 256, 96, s, on=on)
    return im

# ===================== 폰트 비교(한글 픽셀 처리) =====================
def font_compare():
    im = Image.new('RGBA', (384, 120)); window(im, 0, 0, 384, 120)
    y = 8
    for lab, fnt, sz, mode, ol in (('DoHyeon 12 th', FD, 12, 'th', None), ('DoHyeon 12 aa', FD, 12, 'aa', None), ('DoHyeon 12 th+outline', FD, 12, 'th', C['black']),
                                   ('BlackHan 12 th', FB, 12, 'th', None), ('BlackHan 16 th+outline', FB, 16, 'th', C['black']), ('DoHyeon 16 th', FD, 16, 'th', None)):
        glyph_text(im, 8, y + 3, lab[:22].upper())
        px_text(im, 196, y, '태동 국민학교 방 만들기', sz, C['white'], font=fnt, mode=mode, outline=ol)
        y += 18 if sz <= 12 else 20
    return im

save3(b_select(), 'ko_mock.png')
save3(b_select(), 'mock_B_select.png'); save3(b_lobby(), 'mock_B_lobby.png'); save3(b_room(), 'mock_B_room.png')
a_lobby().save(G + 'mock_A_lobby.png'); a_select().save(G + 'mock_A_select.png'); a_room().save(G + 'mock_A_room.png')
save3(font_compare(), 'ui_font_compare.png')
print('ok')
