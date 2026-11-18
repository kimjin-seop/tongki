import numpy as np
"""심판 스프라이트 + 시작/종료 배너 추출. 사용: python -I analysis/scripts/ref_extract.py <배너용 상태 pkl>  (cwd=프로젝트 루트)
배너용 상태 = 경기 중(상태 0x14) 저장 상태. 예: t_start3.py 실행 후 남는 상태."""
import sys, json, pickle
sys.path.insert(0, "analysis/scripts")
from PIL import Image
R = open('rom/danpei.gen', 'rb').read()
u16 = lambda a: (R[a] << 8) | R[a + 1]
u32 = lambda a: int.from_bytes(R[a:a + 4], 'big')
s8 = lambda v: v - 256 if v > 127 else v
cram = lambda w: (((w >> 1) & 7) * 36, ((w >> 5) & 7) * 36, ((w >> 9) & 7) * 36)
OUTD = 'public/assets/rom/sprites/'
PAL = [cram(u16(0x3A1AC + 2 * i)) for i in range(16)]
REF_GFX = 0x363DE; NFR = 12; TPF = 18


def tile(buf, i):
    t = np.zeros((8, 8), np.uint8)
    b = buf[i * 32:(i + 1) * 32]
    for y in range(8):
        for x in range(4):
            v = b[y * 4 + x]; t[y, 2 * x] = v >> 4; t[y, 2 * x + 1] = v & 15
    return t


# 심판 프레임 레이아웃 ROM 0xDDC2: [n-1][hb] + 6B 조각 (y, size, tile, x, xflip_x)
LAY = 0xDDC2
n = R[LAY] + 1
pieces = [(s8(R[LAY + 2 + 6 * i]), R[LAY + 3 + 6 * i], u16(LAY + 4 + 6 * i), s8(R[LAY + 6 + 6 * i]), s8(R[LAY + 7 + 6 * i])) for i in range(n)]
minx = min(p[3] for p in pieces); miny = min(p[0] for p in pieces)
W = max(p[3] + (((p[1] >> 2) & 3) + 1) * 8 for p in pieces) - minx
H = max(p[0] + ((p[1] & 3) + 1) * 8 for p in pieces) - miny
sheet = Image.new('RGBA', (W * NFR, H), (0, 0, 0, 0)); px = sheet.load()
for k in range(NFR):
    buf = R[REF_GFX + k * TPF * 32: REF_GFX + (k + 1) * TPF * 32]
    for (y, sz, t0, x, xf) in pieces:
        w = ((sz >> 2) & 3) + 1; h = (sz & 3) + 1
        for cx in range(w):
            for cy in range(h):
                tt = tile(buf, t0 + cx * h + cy)
                for yy in range(8):
                    for xx in range(8):
                        c = tt[yy, xx]
                        if c:
                            px[k * W + x - minx + cx * 8 + xx, y - miny + cy * 8 + yy] = PAL[c] + (255,)
sheet.save(OUTD + 'referee.png')
sheet.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST).save('analysis/gfx/start/referee_sheet_x4.png')

# 애니 표 ROM 0xDD78: word 오프셋 9개 → [프레임수][속도] + 프레임번호(word)
ANIMT = 0xDD78
names = {0: 'stand', 2: 'walk', 4: 'hold_ball_go', 6: 'toss', 8: 'out_call', 0xA: 'unused_a', 0xC: 'game_set', 0xE: 'look_left', 0x10: 'look_right'}
anims = {}
for i in range(9):
    a = ANIMT + u16(ANIMT + 2 * i); cnt = R[a]; sp = R[a + 1]
    fr = [u16(a + 2 + 2 * j) for j in range(max(cnt, 1))]
    anims[names[2 * i]] = dict(id=2 * i, rom=hex(a), frames=fr, ticks_per_frame=(sp + 1) if cnt > 1 else None, loop=cnt > 1)
anims['out_call']['loop'] = False
anims['out_call']['note'] = '1회 재생 후 상태 0x14(관전)로 복귀(코드 0xDCF8 애니 종료 비트). 실측 50프레임'
anims['unused_a']['note'] = '코드에서 사용처 미발견'

# 공 손 위치 (0xA3BE: dx,dz 바이트쌍 / 0xA3D4: dy 바이트), 애니 id 별 word 오프셋표
hold = {}
for aid, nm in ((0, 'stand'), (2, 'walk'), (4, 'hold_ball_go'), (6, 'toss')):
    ax = 0xA3BE + u16(0xA3BE + aid); ay = 0xA3D4 + u16(0xA3D4 + aid)
    cnt = len(anims[nm]['frames'])
    hold[nm] = [dict(dx=s8(R[ax + 2 * j]), dz=s8(R[ax + 2 * j + 1]), dy=s8(R[ay + j])) for j in range(cnt)]
frames = [dict(id=k, rect=[k * W, 0, W, H], anchor=[-minx, -miny], rom=hex(REF_GFX + k * TPF * 32)) for k in range(NFR)]
js = dict(
    key='spr.referee', image='rom/sprites/referee.png', image_size=[sheet.width, sheet.height], alpha=True, scale=1,
    source='rom-extract: ROM 0x363DE 무압축 4bpp, 12프레임 x 18타일(576B). 코드 0x598A 가 RAM $FF6000 에 복사, 매 프레임 $E23E 경유로 VRAM 타일 0x00A 에 DMA. 조각 레이아웃 ROM 0xDDC2(24x32 + 24x16), 팔레트 CRAM 라인2 = ROM 0x3A1AC(타일 속성 0xC00A: 우선순위1, 팔레트2)',
    coords='ball.json 과 동일: screen_x = world.x - cam_x, screen_y = world.y/2 + 96 - world.z (심판 z=0). rect 를 (screen_x - anchor.x, screen_y - anchor.y) 에 그림. 그리기 순서는 다른 오브젝트와 world.y 기준 정렬',
    hflip='obj+2 bit7. 이동 중 vx<0 이면 반전(0xDD4A). out_call 은 아웃 선수 사이드 기준(0xDCC0: 왼팀 선수 아웃 = 반전). 앵커가 셀 가로 중앙이라 반전해도 앵커 동일',
    frames=frames, anims=anims, ball_hold=hold,
    ball_hold_note='공(타입 0x68)이 심판 손에 붙어 있는 동안 공 world = (ref.x + dx(반전 시 -dx), ref.y + dy, ref.z + dz). index = 현재 애니 프레임 index (코드 0xA32E)',
    world_positions=dict(spawn=[256, 16], center_target=[256, 120], center_actual=[256, 116], return_target=[256, 12], idle=[256, 16]),
    qa='확인: 에뮬레이터 VRAM 타일 0x00A~ 와 ROM 프레임 바이트 일치, 화면 렌더(analysis/gfx/start/)와 대조'
)
json.dump(js, open(OUTD + 'referee.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('referee', sheet.size, 'pieces', pieces, 'anchor', (-minx, -miny))

# ---- 배너 (VRAM 캡처 필요) ----
if len(sys.argv) > 1:
    import hud_render as HR
    md = pickle.load(open(sys.argv[1], 'rb'))
    T = HR.tiles_np(md.vdp.vram); CR = [HR.cram_rgb(w) for w in md.vdp.cram]
    want = {0: 'pause', 2: 'play_off', 3: 'game_set', 4: 'time_up', 11: 'go', 12: 'fight'}
    imgs = []; meta = {}
    for k, nm in want.items():
        fp = u32(0xE130 + 4 * k); base = u16(0xE0FC + 2 * k)
        nn = R[fp] + 1
        ps = [(s8(R[fp + 2 + 6 * i]), R[fp + 3 + 6 * i], u16(fp + 4 + 6 * i), s8(R[fp + 6 + 6 * i])) for i in range(nn)]
        x0 = min(p[3] for p in ps); y0 = min(p[0] for p in ps)
        x1 = max(p[3] + (((p[1] >> 2) & 3) + 1) * 8 for p in ps); y1 = max(p[0] + ((p[1] & 3) + 1) * 8 for p in ps)
        im = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0)); q = im.load()
        for (y, sz, t, x) in ps:
            e = (t + base) & 0xFFFF; w = ((sz >> 2) & 3) + 1; h = (sz & 3) + 1; t0 = e & 0x7FF; pl = (e >> 13) & 3
            for cx in range(w):
                for cy in range(h):
                    tt = T[(t0 + cx * h + cy) & 0x7FF]
                    for yy in range(8):
                        for xx in range(8):
                            c = tt[yy, xx]
                            if c:
                                q[x - x0 + cx * 8 + xx, y - y0 + cy * 8 + yy] = CR[pl * 16 + c] + (255,)
        sx, sy = u16(0xE190 + 4 * k) - 128, u16(0xE192 + 4 * k) - 128
        life = u16(0xE1EA + 2 * k)
        blink = {0: '카운터 bit5 (32f 표시/32f 숨김)', 2: '카운터 bit3 (8f 표시/8f 숨김)'}.get(k)
        imgs.append((nm, im))
        meta[nm] = dict(type=k, anchor=[-x0, -y0], screen_pos=[sx, sy], size=list(im.size), frame_rom=hex(fp), tile_attr=hex(base), life_frames=life or None, blink=blink)
    Wt = sum(i.width for _, i in imgs) + 2 * len(imgs); Ht = max(i.height for _, i in imgs)
    sh = Image.new('RGBA', (Wt, Ht), (0, 0, 0, 0)); xx = 0
    for nm, im in imgs:
        sh.paste(im, (xx, 0)); meta[nm]['rect'] = [xx, 0, im.width, im.height]; xx += im.width + 2
    sh.save(OUTD + 'banners.png')
    sh.resize((sh.width * 3, sh.height * 3), Image.NEAREST).save('analysis/gfx/start/banners_x3.png')
    json.dump(dict(key='spr.banners', image='rom/sprites/banners.png', image_size=list(sh.size), alpha=True, scale=1,
                   source='경기 중 VRAM 캡처(에뮬레이터, 타일 0x60~ UI 팔레트 라인2) + 배너 프레임 구조 ROM 0xE130 표, 위치 0xE190, 수명 0xE1EA, 타일속성 0xE0FC (배너 오브젝트 타입 0x54 @ $D900, 핸들러 0xDFD0)',
                   coords='화면 고정(카메라 무관). rect 를 (screen_pos.x - anchor.x, screen_pos.y - anchor.y) 에 그림. 같은 슬롯($D900)이라 새 배너가 이전 배너를 즉시 대체',
                   banners=meta), open(OUTD + 'banners.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('banners', sh.size, {k: (v['screen_pos'], v['size'], v['anchor']) for k, v in meta.items()})
