"""팀 선택 화면 에셋 추출. 입력: analysis/state/sel/{m2,m2u,m1,m1c}.pkl (t_select_rec/cont 기록), m2_end.pkl(RAM)
출력: public/assets/rom/select/*.png, select.json
사용(cwd=프로젝트 루트): python -I analysis/scripts/t_select_extract.py"""
import numpy as np
import sys, os, json, pickle
sys.path.insert(0, 'analysis/scripts')
import intro_lib as I
import hud_render as H
from PIL import Image

OUT = 'public/assets/rom/select/'
os.makedirs(OUT, exist_ok=True)
R = {k: I.load('analysis/state/sel/%s.pkl' % k) for k in ('m2', 'm2u', 'm1', 'm1c')}


def hx(c): return '#%02x%02x%02x' % tuple(int(v) for v in c[:3])


def ctx(rec, f):
    fr = rec['fr'][f]; vram = rec['vr'][fr['vi']]
    return H.tiles_np(vram), I.pal(fr), fr


def tile_rgba(T, P, t, pal, hf=0, vf=0):
    px = T[t & 0x7FF]
    if hf: px = px[:, ::-1]
    if vf: px = px[::-1, :]
    rgb = P[pal * 16 + px]; a = np.where(px > 0, 255, 0).astype(np.uint8)
    return np.dstack([rgb, a])


def tiles_img(T, P, grid, pal):
    h = len(grid); w = len(grid[0]); out = np.zeros((h * 8, w * 8, 4), np.uint8)
    for y, row in enumerate(grid):
        for x, e in enumerate(row):
            if e is None: continue
            t, hf, vf = e
            out[y * 8:y * 8 + 8, x * 8:x * 8 + 8] = tile_rgba(T, P, t, pal, hf, vf)
    return Image.fromarray(out, 'RGBA')


def plane_layer(rec, f, which):
    im, _ = I.plane_rgba(rec, f, which)
    return im.crop((0, 0, 320, 224))  # 이 화면들은 스크롤 0 (확인)


def save(im, name):
    im.save(OUT + name); return name


J = {'source': 'ROM 에뮬 재생(analysis/scripts/t_select_rec.py, t_select_extract.py). 좌표 = 논리 320x224 화면 px, 1x. 색0 투명 RGBA',
     'assets': {}}
A = J['assets']
rec = R['m2']; F = 100; T, P, fr = ctx(rec, F)

# 1. 배경(플레인 B)
bg = plane_layer(rec, F, 'B')
A['bg_full'] = dict(file=save(bg, 'select_bg.png'), size=[320, 224], pos=[0, 0], note='플레인 B, 스크롤 0 고정. 모드 메뉴/팀 선택/규칙 화면 공통 배경')
A['bg_unit'] = dict(file=save(bg.crop((0, 0, 48, 96)), 'select_bg_unit.png'), size=[48, 96],
                    note='48x96 반복 단위(6x12 타일). 화면 (0,0)부터 타일링. 위 48x48 블록과 아래 블록은 가로 24px 어긋남(벽돌 배치)')
md = pickle.load(open('analysis/state/sel/m2_end.pkl', 'rb'))
med = Image.new('RGBA', (24 * 6, 24))
for n in range(6):
    raw = bytes(md.ram[0x41A6 + n * 0x120:0x41A6 + (n + 1) * 0x120])
    v = np.frombuffer(raw, np.uint8).reshape(9, 8, 4)
    t = np.zeros((9, 8, 8), np.uint8); t[:, :, 0::2] = v >> 4; t[:, :, 1::2] = v & 15
    img = np.zeros((24, 24, 4), np.uint8)
    for k in range(9):
        y, x = divmod(k, 3); px = t[k]
        img[y * 8:y * 8 + 8, x * 8:x * 8 + 8, :3] = P[2 * 16 + px]
        img[y * 8:y * 8 + 8, x * 8:x * 8 + 8, 3] = np.where(px > 0, 255, 0)
    med.paste(Image.fromarray(img, 'RGBA'), (n * 24, 0))
A['bg_medal_anim'] = dict(file=save(med, 'select_bg_medal_anim.png'), cell=[24, 24], frames=6,
                          place='배경 타일 0xD3~0xDB(메달 가운데 3x3). bg_unit 안 (8,0) 과 (32,48) (+48 가로 반복)',
                          idle_cycle=[[0, 5], [1, 5]], confirm_seq=[[n % 6, 5] for n in range(8)],
                          note='평상시 프레임 0/1 을 5f 마다 교대. 팀 확정 직후 0~5,0,1 을 5f 씩(40f) 재생 후 다음 화면. 3·5번째 프레임 때 팔레트2 색8 을 %s/%s 로 바꿈(번쩍)' % (
                              hx(H.cram_rgb(0x8CE)), hx(H.cram_rgb(0x4CE))))

# 2. 창 9-slice
win = tiles_img(T, P, [[(0x16, 0, 0), (0x11, 0, 0), (0x16, 1, 0)], [(0x12, 0, 0), (0x17, 0, 0), (0x12, 1, 0)],
                       [(0x16, 0, 1), (0x11, 0, 1), (0x16, 1, 1)]], 2)
fillc = P[2 * 16 + int(np.bincount(T[0x17].ravel()).argmax())]
A['window_9slice'] = dict(file=save(win, 'select_window_9s.png'), size=[24, 24], slice=[8, 8, 8, 8], fill=hx(fillc),
                          note='플레인 A 타일 0x16 모서리 / 0x11 위·아래(아래=V반전) / 0x12 좌우(오른쪽=H반전) / 0x17 채움, 팔레트2. 가운데 8x8 반복. 크기는 8px 단위')

# 3. 엠블럼
es = Image.new('RGBA', (24 * 17, 16)); emb = []
for n in range(17):
    b = 0x284 + 6 * n
    im = tiles_img(T, P, [[(b, 0, 0), (b + 2, 0, 0), (b + 4, 0, 0)], [(b + 1, 0, 0), (b + 3, 0, 0), (b + 5, 0, 0)]], 3)
    es.paste(im, (n * 24, 0)); emb.append(im)
es.save('analysis/gfx/select/_emblems17.png')
os.makedirs(OUT + 'emblems', exist_ok=True)
for n in range(16): emb[n].save(OUT + 'emblems/emblem_%02d.png' % n)
A['emblems'] = dict(file=save(es.crop((0, 0, 24 * 16, 16)), 'select_emblems.png'), cell=[24, 16], count=16,
                    dir='emblems/emblem_NN.png',
                    team_to_emblem=[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 8, 9, 10, 11, 12, 13, 14, 0, 15, None],
                    note='ROM 표 0x1505A(팀->엠블럼), 타일 0x284+6n 3x2(열 우선), 팔레트3. 스토리 해외팀 15~21 은 같은 나라 엠블럼 재사용, 22(TAM)=T.D, 23(CHO)=15번 전용, 24(REN) 는 표 밖')

# 4. 글꼴
chars = ''.join(chr(c) for c in range(0x20, 0x60))
Tu, Pu, _ = ctx(R['m2u'], 100)
for nm, pal in (('white', 2), ('yellow', 0)):
    im = Image.new('RGBA', (8 * len(chars), 8))
    for i, c in enumerate(chars):
        blk = tile_rgba(Tu, Pu, ord(c), pal); blk[Tu[ord(c)] == 1] = 0  # 인덱스1 = 창 바탕색 -> 투명
        im.paste(Image.fromarray(blk, 'RGBA'), (i * 8, 0))
    A['font_' + nm] = dict(file=save(im, 'select_font_%s.png' % nm), cell=[8, 8], first=32, chars=chars,
                           note='타일 번호 = ASCII 코드, 고정폭 8x8. 글자 타일 인덱스1(창 바탕 초록)은 투명 처리, 인덱스2=글자색. white=팀 약칭(팔레트2), yellow=SPECIAL TEAM(팔레트0)')

# 5. 플레인 A 레이어
pa = plane_layer(rec, F, 'A')
tj = np.array(pa.crop((80, 16, 224, 32))); tj[(tj[:, :, :3] == fillc).all(2)] = 0
A['title_ja_ref'] = dict(file=save(Image.fromarray(tj, 'RGBA'), 'select_title_ja_ref.png'), size=[144, 16], pos=[80, 16],
                         note='참고용(プレイするチームを えらんでください, 탁점 줄 포함 2행). 한국판은 한글로 대체')
A['planeA_main'] = dict(file=save(pa, 'select_planeA.png'), size=[320, 224], pos=[0, 0], note='창+제목+엠블럼+약칭 원본 합성(일반)')
pau = plane_layer(R['m2u'], 100, 'A')
A['planeA_special'] = dict(file=save(pau, 'select_planeA_special.png'), size=[320, 224], pos=[0, 0], note='SPECIAL TEAM 창 포함(스토리 클리어 후)')

# 6. 공 아이콘
bs = Image.new('RGBA', (64, 16))
for i, t in enumerate((1, 5, 9, 13)):
    bs.paste(tiles_img(T, P, [[(t, 0, 0), (t + 2, 0, 0)], [(t + 1, 0, 0), (t + 3, 0, 0)]], 2), (i * 16, 0))
A['ball_icon'] = dict(file=save(bs, 'select_ball_anim.png'), cell=[16, 16], frames=4, frame_len=5, pos=[[56, 16], [240, 16]],
                      note='스프라이트 팔레트2, 4프레임 x 5f 회전(20f 주기)')

# 7. 커서 프레임
D = open('rom/danpei.gen', 'rb').read()
def words(a, n): return [(D[a + 2 * i] << 8) | D[a + 2 * i + 1] for i in range(n)]
l0 = words(0x100E2, 7); l1 = words(0x100F0, 7); offs = [D[0x100DA + i] // 2 for i in range(7)]
cram = list(fr['cram'])


def glow_pal(step, line):
    c = list(cram); tb = l0 if line == 0 else l1
    for k in range(3): c[line * 16 + 6 + k] = tb[offs[step] + k]
    return np.array([H.cram_rgb(w) for w in c], np.uint8)


def cursor(top, line, step):
    Pp = glow_pal(step, line); img = np.zeros((40, 40, 4), np.uint8)

    def put(t0, w, h, x, y, hf=0, vf=0):
        for cx in range(w):
            for cy in range(h):
                tx = (w - 1 - cx) if hf else cx; ty = (h - 1 - cy) if vf else cy
                blk = tile_rgba(T, Pp, t0 + tx * h + ty, line, hf, vf)
                m = blk[:, :, 3] > 0
                img[y + cy * 8:y + cy * 8 + 8, x + cx * 8:x + cx * 8 + 8][m] = blk[m]
    if top == 0x424: put(0x424, 4, 1, 0, 0, 1, 1)
    else: put(top, 4, 1, 0, 0)
    put(0x420, 1, 4, 0, 8); put(0x424, 4, 1, 8, 32); put(0x420, 1, 4, 32, 0, 1, 1)
    return Image.fromarray(img, 'RGBA')


cs = Image.new('RGBA', (40 * 7, 40 * 8)); rows = []
for ri, (nm, top, line) in enumerate([('1p', 0x41c, 0), ('1p', 0x41c, 1), ('2p', 0x428, 0), ('2p', 0x428, 1),
                                      ('com', 0x42c, 0), ('com', 0x42c, 1), ('plain', 0x424, 0), ('plain', 0x424, 1)]):
    for s in range(7): cs.paste(cursor(top, line, s), (s * 40, ri * 40))
    rows.append('%s_%s' % (nm, 'move' if line == 0 else 'picked'))
A['cursor'] = dict(file=save(cs, 'select_cursor_sheet.png'), cell=[40, 40], rows=rows,
                   cols='글로우 단계 0~6, 단계당 6f(한 바퀴 42f, 무한 반복)',
                   anchor='셀 좌상단 = 엠블럼 좌상단 - (8,8). 메인 격자: (56+40*c, 32+40*r)',
                   glow_move=[hx(H.cram_rgb(w)) for w in l0], glow_picked=[hx(H.cram_rgb(w)) for w in l1], glow_offsets=offs,
                   note='라벨(1P/2P/COM)은 위 변 타일에 포함. plain=라벨 없는 프레임(편성 화면 선수 커서와 같은 구성). 이동 중=하늘색 계열 글로우, 확정=빨강·노랑 글로우. 표시/숨김 깜빡임 없음')

# 8. 이후 화면 참고 레이어
A['lineup_planeA_ref'] = dict(file=save(plane_layer(R['m1'], 600, 'A'), 'lineup_planeA_ref.png'), size=[320, 224],
                              note='팀 확정 후 라인업(VS) 화면 플레인 A. 얼굴 = 스프라이트 24x24, 왼쪽 (24,40+24i) 오른쪽 (184,40+24i), i=0~6')
A['formation_planeA_ref'] = dict(file=save(plane_layer(R['m1c'], 150, 'A'), 'formation_planeA_ref.png'), size=[320, 224],
                                 note='편성(포지션 변경) 화면 플레인 A: 팀 패널 + 능력치 6줄 막대 + 선수 2명 비교')
A['formation_planeB_ref'] = dict(file=save(plane_layer(R['m1c'], 150, 'B'), 'formation_planeB_ref.png'), size=[320, 224])
json.dump(J, open(OUT + 'select.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok')
