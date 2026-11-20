"""스토리 남은 범위(analysis/53_story_remaining_spec.md)용 ROM 정적 추출. 에뮬레이터를 쓰지 않는다(ROM 바이트 디코드만).

산출(public/assets/rom/story/ 신규 파일만):
  story_extras.png / story_extras.json : 3전 승리 뒤 팀 그림(0x60FB6, 서브 9 0x128AC)·15전 승리 뒤 엄마 초상(0x60FB2+0x6385E, 0x127DC)
                                         각 바탕(closed) + 입 프레임(애니 표 0x72DCA 0x20/0x26/0x28)
  ending_01.png                         : 엔딩 그림(서브 12, 0x12CCE): 타일 0x6B888, 맵 0x73BE2(면 A, 팔레트 0)·0x73C34(면 B, 팔레트 1), 팔레트 0x74D0E 48색

검증: 같은 방법으로 1전 상대 초상(opp_01, 0x60F72[1])을 그려 기존 portraits.png(원작 실행 VRAM 합성)와 색 대응·픽셀 일치를 비교해 출력한다.

실행: python -I tools/story_remaining_extract.py [--check-only]
근거 주소는 각 함수 주석. 디코더는 analysis/scripts/gfxdec.py(0x1126)·enigma.py(0x1356) 를 그대로 쓴다.
"""
import sys, os, json, struct, hashlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(ROOT, 'analysis', 'scripts'))
from gfxdec import decode  # noqa: E402
from enigma import enigma  # noqa: E402
from PIL import Image  # noqa: E402

ROM = open(os.path.join(ROOT, 'rom', 'danpei.gen'), 'rb').read()
OUT = os.path.join(ROOT, 'public', 'assets', 'rom', 'story')
u32 = lambda a: struct.unpack('>I', ROM[a:a + 4])[0]
u16 = lambda a: struct.unpack('>H', ROM[a:a + 2])[0]


def color(w):
    # 기존 render_stages.py 와 같은 변환(3비트 x 36). 비교는 색 대응으로 하므로 변환식 차이는 판정에 영향 없음
    return (((w >> 1) & 7) * 36, ((w >> 5) & 7) * 36, ((w >> 9) & 7) * 36, 255)


def pal_words(a, n=16):
    return [u16(a + 2 * i) for i in range(n)]


class VRAM:
    """타일 번호 -> 32바이트. 0x1126 은 VDP 주소를 이어 쓰므로 연속 스트림은 이전 끝 다음 타일부터"""
    def __init__(self):
        self.t = {}

    def load(self, tile, ptr):
        data, end, delta, n = decode(ROM, ptr)
        for i in range(n):
            self.t[tile + i] = data[i * 32:(i + 1) * 32]
        return tile + n, n

    def px(self, tile, x, y):
        d = self.t.get(tile)
        if d is None:
            return None
        b = d[y * 4 + (x >> 1)]
        return (b >> 4) if x % 2 == 0 else (b & 15)


def mapping(a):
    """스프라이트 배치표: [개수-1][0] + 조각 6바이트(y s8, 크기, 타일 u16, x s8, 좌우반전 x s8). 0x72D8A·0x14200 으로 형식 확인"""
    n = ROM[a] + 1
    out = []
    for i in range(n):
        y, s, t, x, xf = struct.unpack('>bBHbb', ROM[a + 2 + 6 * i:a + 8 + 6 * i])
        out.append({'y': y, 'x': x, 'w': ((s >> 2) & 3) + 1, 'h': (s & 3) + 1, 'tile': t})
    return out


def anim(n):
    """애니 표 0x72DCA: u16 오프셋 -> [칸 수][대기] + 칸마다 배치표 포인터(롱). 48 §10-3 (대기 4 = 5프레임)"""
    a = 0x72DCA + u16(0x72DCA + n)
    cnt, hold = ROM[a], ROM[a + 1]
    return {'anim': hex(n), 'hold': hold, 'frames': [u32(a + 2 + 4 * i) for i in range(cnt)]}


def draw(img, vram, pals, base_attr, ox, oy, mp):
    """MD 스프라이트: 조각 안 타일은 세로 우선(열 단위) 순서"""
    pal_line = (base_attr >> 13) & 3
    base = base_attr & 0x7FF
    W, H = img.size
    pix = img.load()
    for pc in mp:
        t0 = base + (pc['tile'] & 0x7FF)
        for cx in range(pc['w']):
            for cy in range(pc['h']):
                t = t0 + cx * pc['h'] + cy
                for y in range(8):
                    for x in range(8):
                        c = vram.px(t, x, y)
                        if not c:
                            continue
                        X, Y = ox + pc['x'] + cx * 8 + x, oy + pc['y'] + cy * 8 + y
                        if 0 <= X < W and 0 <= Y < H:
                            pix[X, Y] = color(pals[pal_line][c])


def sprite_box(mp):
    xs = [p['x'] for p in mp] + [p['x'] + p['w'] * 8 for p in mp]
    ys = [p['y'] for p in mp] + [p['y'] + p['h'] * 8 for p in mp]
    return min(xs), min(ys), max(xs), max(ys)


def line2_base():
    """대사 장면 팔레트 라인 2: 0x3A1AC(0x1251C) + $ED42 롱 = 0x0EEE0000(0x12540) -> 1번 흰색, 2번 검정"""
    p = pal_words(0x3A1AC)
    p[1], p[2] = 0x0EEE, 0x0000
    return p


# ---------- 검증: 1전 상대 초상 ----------
def check_opp01():
    v = VRAM()
    v.load(0x4C0, u32(0x60F72 + 4 * 1))  # 0x12450: VRAM 0x4C0 <- 0x60F72[k+1]
    pals = [pal_words(0x74AAE), pal_words(u32(0x74A62 + 4 * 1)), line2_base(), [0] * 16]
    img = Image.new('RGBA', (40, 40), (0, 0, 0, 0))
    draw(img, v, pals, 0xA4C0, 0, 0, mapping(0x72D8A))  # $C900: 0xA4C0, 배치 0x72D8A (0x14158)
    ref = Image.open(os.path.join(OUT, 'portraits.png')).convert('RGBA')
    meta = json.load(open(os.path.join(OUT, 'portraits.json'), encoding='utf-8'))
    f = meta['frames']['opp_01.closed']
    r = ref.crop((f['x'], f['y'], f['x'] + 40, f['y'] + 40))
    a, b = img.load(), r.load()
    same_shape = mism = 0
    corr = {}
    for y in range(40):
        for x in range(40):
            pa, pb = a[x, y], b[x, y]
            if (pa[3] == 0) != (pb[3] == 0):
                mism += 1
                continue
            same_shape += 1
            if pa[3]:
                corr.setdefault(pa[:3], set()).add(pb[:3])
    one_to_one = all(len(s) == 1 for s in corr.values())
    return {'pixels': 1600, 'opaqueMaskMismatch': mism, 'colorsOurs': len(corr), 'colorMapOneToOne': one_to_one}


# ---------- 3전 승리 뒤 팀 그림 (0x128AC -> 0x12974) ----------
def team_picture():
    v = VRAM()
    end, n = v.load(0xDC, u32(0x60FB6))  # VRAM 0xDC <- (0x60FB6)
    pals = [pal_words(0x74AAE), pal_words(u32(0x74AA6)), line2_base(), [0] * 16]  # 0x128EA: (0x74AA6) -> $ED20 라인 1
    body = mapping(0x13DBE)  # $CB00: 배치 0x13DBE, 타일 0xA0DC, (0x160,0x120)
    objs = {'body': {'attr': 0xA0DC, 'x': 0x160, 'y': 0x120, 'map': 0x13DBE},
            'mouth1': {'attr': 0xA0DC, 'x': 0x170, 'y': 0x130, 'anim': anim(0x26), 'slot': 'C800'},
            'mouth2': {'attr': 0xA0DC, 'x': 0x198, 'y': 0x138, 'anim': anim(0x28), 'slot': 'CA80'}}
    return v, pals, body, objs, {'tiles': n, 'tilePtr': hex(u32(0x60FB6)), 'palPtr': hex(u32(0x74AA6))}


# ---------- 15전 승리 뒤 엄마 초상 (0x127DC) ----------
def mom_picture():
    v = VRAM()
    end, n1 = v.load(0xDC, u32(0x60FB2))  # VRAM 0xDC <- (0x60FB2)
    end2, n2 = v.load(end, u32(0x6385E))  # 이어서 (0x6385E) = 입
    src = pal_words(u32(0x74AA2))  # 0x12882: (0x74AA2)+0x0C -> $EDCC: 6·7번, 8번 건너뜀, 9~14번, 15번 = 0x0EEE
    p2 = line2_base()
    for i in (6, 7, 9, 10, 11, 12, 13, 14):
        p2[i] = src[i]
    p2[15] = 0x0EEE
    pals = [pal_words(0x74AAE), [0] * 16, p2, [0] * 16]
    body = mapping(0x72D8A)  # $CB00: 배치 0x72D8A, 타일 0xC0DC, (0x160,0x120)
    objs = {'body': {'attr': 0xC0DC, 'x': 0x160, 'y': 0x120, 'map': 0x72D8A},
            'mouth': {'attr': 0xC0F5, 'x': 0x170, 'y': 0x138, 'anim': anim(0x20), 'slot': 'CA80'}}
    return v, pals, body, objs, {'tiles': n1, 'mouthTiles': n2, 'mouthVram': hex(end), 'tilePtr': hex(u32(0x60FB2)), 'mouthPtr': hex(u32(0x6385E)), 'palPtr': hex(u32(0x74AA2))}


def render_set(name, v, pals, body, objs):
    """바탕(closed) + 입 칸별 그림. 좌표는 원작 화면(320x224) 기준 = 스프라이트 좌표 - 0x80"""
    bx, by = objs['body']['x'] - 0x80, objs['body']['y'] - 0x80
    x0, y0, x1, y1 = sprite_box(body)
    W, H = x1 - x0, y1 - y0
    frames = []
    base = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw(base, v, pals, objs['body']['attr'], -x0, -y0, body)
    frames.append(('closed', base))
    # 입 칸 이름은 portraits.json 과 같게: 켜는 프레임에 1틱 진행하므로 처음 보이는 칸 = 애니 칸 1 = mouthA, 칸 0 = mouthB (48 §10-3).
    # 입 객체가 둘(팀 그림: $C800·$CA80)이면 화자 0x13(みんな)이 둘을 같은 프레임에 켜므로 같은 위상으로 합쳐 그린다
    mouths = [k for k in objs if k.startswith('mouth')]
    for label, idx in (('mouthA', 1), ('mouthB', 0)):
        im = base.copy()
        for mk in mouths:
            o = objs[mk]
            draw(im, v, pals, o['attr'], (o['x'] - 0x80) - bx - x0, (o['y'] - 0x80) - by - y0, mapping(o['anim']['frames'][idx]))
        frames.append((label, im))
    return {'screen': {'x': bx + x0, 'y': by + y0, 'w': W, 'h': H}, 'frames': frames}


def ending_picture():
    """서브 12(0x12CCE): 0x92 -> 면 지움 -> 타일 0x6B888 -> VRAM 0xDC(0x12DE8 표) -> 맵 0x73BE2(기준 0x00DC) -> RAM FF0000 -> 면 A(0xC208),
    맵 0x73C34(기준 0x20DC) -> FF03E0 -> 면 B(0xE208). 크기 31칸 x 16줄(0xCCA: d1=0x1E, d2=0x0F). 팔레트 0x74D0E 48색(라인 0~2)"""
    v = VRAM()
    v.load(0xDC, 0x6B888)
    pals = [pal_words(0x74D0E + 32 * i) for i in range(3)] + [[0] * 16]
    img = Image.new('RGBA', (320, 224), (0, 0, 0, 255))
    pix = img.load()
    planes = []
    for ptr, base in ((0x73C34, 0x20DC), (0x73BE2, 0x00DC)):  # 면 B 먼저(뒤), 면 A 위
        words, _ = enigma(ROM, ptr, base)
        planes.append({'map': hex(ptr), 'base': hex(base), 'words': len(words)})
        for i, w in enumerate(words[:31 * 16]):
            cx, cy = i % 31, i // 31
            t = w & 0x7FF
            pl = (w >> 13) & 3
            hf, vf = bool(w & 0x800), bool(w & 0x1000)
            for y in range(8):
                for x in range(8):
                    c = v.px(t, 7 - x if hf else x, 7 - y if vf else y)
                    if c:
                        pix[32 + cx * 8 + x, 32 + cy * 8 + y] = color(pals[pl][c])
    return img, planes


def main():
    chk = check_opp01()
    print('check opp_01 vs portraits.png:', chk)
    if '--check-only' in sys.argv:
        return
    sets = {}
    for name, fn in (('team3', team_picture), ('mom15', mom_picture)):
        v, pals, body, objs, info = fn()
        r = render_set(name, v, pals, body, objs)
        sets[name] = (r, objs, info)
    # 시트: 행 = 세트, 열 = 칸
    cw = max(r['screen']['w'] for r, _, _ in sets.values())
    ch = max(r['screen']['h'] for r, _, _ in sets.values())
    ncol = max(len(r['frames']) for r, _, _ in sets.values())
    sheet = Image.new('RGBA', (cw * ncol, ch * len(sets)), (0, 0, 0, 0))
    meta = {'schema': 'tongki.story_extras/1', 'generatedBy': 'tools/story_remaining_extract.py',
            'source': 'ROM 정적 디코드(타일 0x1126·배치표·팔레트). 원작 실행 대조 전(analysis/53 §3 근거 부족 목록)',
            'romSha256_16': hashlib.sha256(ROM).hexdigest()[:16], 'check_opp01': chk, 'frames': {}, 'sets': {}}
    for row, (name, (r, objs, info)) in enumerate(sets.items()):
        for col, (fname, im) in enumerate(r['frames']):
            sheet.paste(im, (col * cw, row * ch))
            meta['frames'][f'{name}.{fname}'] = {'x': col * cw, 'y': row * ch, 'w': r['screen']['w'], 'h': r['screen']['h']}
        meta['sets'][name] = {'screen': r['screen'], 'info': info,
                              'objects': {k: {kk: (hex(vv) if isinstance(vv, int) else ({'anim': vv['anim'], 'hold': vv['hold'], 'frames': [hex(f) for f in vv['frames']]} if kk == 'anim' else vv)) for kk, vv in o.items()} for k, o in objs.items()}}
    os.makedirs(OUT, exist_ok=True)
    sheet.save(os.path.join(OUT, 'story_extras.png'))
    img, planes = ending_picture()
    img.save(os.path.join(OUT, 'ending_01.png'))
    meta['ending_01'] = {'file': 'ending_01.png', 'screen': {'x': 32, 'y': 32, 'w': 248, 'h': 128}, 'canvas': [320, 224], 'tiles': '0x6B888', 'palette': '0x74D0E(48색)', 'planes': planes,
                         'note': '면 위치 = VRAM 0xC208/0xE208(칸 4,4). 스크롤 값은 0 으로 가정(미측정)'}
    with open(os.path.join(OUT, 'story_extras.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print('wrote story_extras.png/json, ending_01.png')
    for k, s in meta['sets'].items():
        print(k, s['screen'], s['info'])
    print('ending planes', planes)


if __name__ == '__main__':
    main()
