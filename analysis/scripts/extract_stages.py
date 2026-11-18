import numpy
"""전 스테이지 배경 추출 (stage_00 과 동일 규약). cwd=프로젝트 루트. python -I analysis/scripts/extract_stages.py [validate]
ROM 로드 순서(0x4DCC 팔레트 / 0x4DEA 타일맵 / 0x4E82 타일 / 0x5010 우선순위) 를 파이썬으로 재현하고,
스크롤은 ROM 의 0x2F6C 루틴을 에뮬레이터에서 직접 호출해 얻는다."""
import sys, json, struct
sys.path.insert(0, 'analysis/scripts')
import numpy as np
from PIL import Image
import enigma as _en
from gfxdec import decode
from drv import load, pokew, ramw
rom = open('rom/danpei.gen', 'rb').read()
def enigma(rom, off, base=0):
    """enigma.py 와 동일하되 비트스트림 플립 비트 순서 교정(VRAM 실측: 헤더 bit1=vflip(0x1000) 비트를 먼저, bit0=hflip(0x800) 비트를 나중에 읽음).
    헤더의 inc/lit 값은 원문 그대로(교환하지 않음)."""
    p = off; nb = rom[p]; flags = rom[p + 1]; p += 2
    inc = ((rom[p] << 8) | rom[p + 1]) + base; p += 2
    lit = ((rom[p] << 8) | rom[p + 1]) + base; p += 2
    hasv = bool(flags & 1); hasn = bool(flags & 2)
    st = dict(bits=0, cnt=0, p=p)
    def rd(n):
        while st['cnt'] < n:
            st['bits'] = (st['bits'] << 8) | rom[st['p']]; st['p'] += 1; st['cnt'] += 8
        v = (st['bits'] >> (st['cnt'] - n)) & ((1 << n) - 1); st['cnt'] -= n; st['bits'] &= (1 << st['cnt']) - 1; return v
    def tile():
        t = base
        if hasn and rd(1): t |= 0x1000   # 헤더 bit1 = vflip 비트 존재(먼저 읽음)
        if hasv and rd(1): t |= 0x0800   # 헤더 bit0 = hflip 비트 존재
        return (rd(nb) + t) & 0xffff
    out = []; I = inc
    while True:
        if rd(1) == 0:
            m = rd(1); c = rd(4)
            if m == 0:
                for _ in range(c + 1): out.append(I); I += 1
            else:
                for _ in range(c + 1): out.append(lit)
        else:
            m = rd(2); c = rd(4)
            if m == 0: out += [tile()] * (c + 1)
            elif m == 1:
                t = tile()
                for _ in range(c + 1): out.append(t); t += 1
            elif m == 2:
                t = tile()
                for _ in range(c + 1): out.append(t); t -= 1
            else:
                if c == 15: break
                for _ in range(c + 1): out.append(tile())
    return out, st['p']
def tbl(base, s): return base + struct.unpack('>H', rom[base + s * 2:base + s * 2 + 2])[0]
def cram_rgb(w): return (((w >> 1) & 7) * 36, ((w >> 5) & 7) * 36, ((w >> 9) & 7) * 36)
PRIO_CLEAR = {3, 4, 7, 10}   # 0x5010 점프표: 0x505C/0x507C 경로 (평면 A 맵 두 반쪽의 앞 256워드 bit15 해제)
HMODE = list(rom[0x48f8:0x48f8 + 16])  # 0x48D8: $E643(VDP reg11 섀도) = 표[$E682]; 2=8라인 셀 단위 스크롤
def stage_data(s):
    pal = [cram_rgb((rom[tbl(0x1a598, s) + i * 2] << 8) | rom[tbl(0x1a598, s) + i * 2 + 1]) for i in range(16)]
    ga = tbl(0x1fcbe, s)
    tiles, _, _, nt = decode(rom, ga)
    A, _ = enigma(rom, tbl(0x1a778, s), 0xE730)
    B, _ = enigma(rom, tbl(0x1a798, s), 0xE730)
    assert len(A) == 1792 and len(B) == 768, (s, len(A), len(B))
    A = list(A)
    # 광고판 로고: 0x55F4 가 평면 A (34..37, 9) 에 UI 타일 0x593..0x596 (팔레트 라인2, 우선순위 0) 기록(E680=0 일 때)
    for k in range(4 if s != 13 else 0):   # 13(모드4 전용)은 로고 위치 미검증 -> 생략
        A[(34 // 32) * 896 + 9 * 32 + (34 % 32) + k] = 0xC593 + k
    if s in PRIO_CLEAR:
        for o in (0, 896):
            for i in range(256): A[o + i] &= 0x7FFF
    return pal, tiles, nt, A, B, dict(map_a=tbl(0x1a778, s), map_b=tbl(0x1a798, s), tiles=ga, palette=tbl(0x1a598, s))
_ui = load('match_story0')
UI_TILES = bytes(_ui.vdp.vram[0x593 * 32:0x597 * 32]); UI_PAL = [cram_rgb(w) for w in _ui.vdp.cram[32:48]]
def tile_np(tiles):
    n = len(tiles) // 32
    a = np.frombuffer(tiles, np.uint8).reshape(n, 8, 4)
    t = np.zeros((n, 8, 8), np.uint8); t[:, :, 0::2] = a >> 4; t[:, :, 1::2] = a & 15
    return t
UI_T = None
def plane(words, rows, T, nt):
    """words: 두 반쪽(32열 x rows) 순서. 반환 (idx[H,512], line[H,512])"""
    global UI_T
    if UI_T is None: UI_T = tile_np(UI_TILES)
    half = 32 * rows
    idx = np.zeros((rows * 8, 512), np.uint8); line = np.full((rows * 8, 512), 3, np.uint8)
    for h in range(2):
        for i in range(half):
            w = words[h * half + i]
            tx, ty = h * 32 + i % 32, i // 32
            tn = w & 0x7FF
            if 0x593 <= tn < 0x597: px = UI_T[tn - 0x593]
            else:
                t = tn - 0x730
                if t < 0 or t >= nt: continue
                px = T[t]
            if w & 0x800: px = px[:, ::-1]
            if w & 0x1000: px = px[::-1, :]
            idx[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = px
            line[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = (w >> 13) & 3
    return idx, line
def render_idx(s):
    pal, tiles, nt, A, B, refs = stage_data(s)
    T = tile_np(tiles)
    return plane(A, 28, T, nt), plane(B, 12, T, nt), pal, refs, nt, A
def to_img(il, pal, alpha, backdrop=None):
    idx, line = il
    pals = {3: pal, 2: UI_PAL, 0: pal, 1: pal}
    a = np.zeros(idx.shape + (4,), np.uint8)
    for ln in (2, 3):
        for i in range(16):
            m = (idx == i) & (line == ln)
            a[m, :3] = pals[ln][i]; a[m, 3] = 255
    if alpha: a[idx == 0, 3] = 0
    else:
        a[idx == 0, :3] = backdrop if backdrop else pal[0]
    return Image.fromarray(a if alpha else a[:, :, :3], 'RGBA' if alpha else 'RGB')
# ================= 전체 추출 =================
import os, math
OUTD = 'public/assets/rom/bg/'
STORY_STAGE = list(rom[0x11ec2:0x11ec2 + 16])   # 스토리 경기 k(=$E688) -> 스테이지($E682)
STORY_OPP = list(rom[0x11ed2:0x11ed2 + 16])     # [k+1] = 상대 팀
VS_STAGE = list(rom[0x1257a:0x1257a + 24])      # 팀 -> 스테이지 (모드1/2: $E683 = 표[상대팀 $E784])
ORDER = []                                      # NN -> ROM 스테이지 인덱스 (스토리 첫 등장 순, 그 다음 ROM 13)
for r in STORY_STAGE[:15]:
    if r not in ORDER: ORDER.append(r)
ORDER.append(13)
FRIC = [struct.unpack('>H', rom[0x54ba + i * 2:0x54ba + i * 2 + 2])[0] for i in range(16)]
BOUNCE = [struct.unpack('>H', rom[0x54e8 + i * 2:0x54e8 + i * 2 + 2])[0] for i in range(16)]
BGM = list(rom[0x50d2:0x50e2])
def fit_rows(rom_s, md):
    """cam 0..191 에서 행(8px)별 가로 이동량 -> 계수 적합."""
    A = np.zeros((192, 28), int); B = np.zeros((192, 28), int)
    for cam in range(192):
        t = scroll_table(rom_s, cam, md)
        for r in range(28): A[cam, r] = -t[r][0]; B[cam, r] = -t[r][1]   # 이동량(+) : 화면 x = 평면 x - shift
    cams = np.arange(192)
    def fit(col):
        best = None
        for n in range(0, 9):
            f = n / 8.0
            for name, fn in (('floor', math.floor), ('ceil', math.ceil)):
                pred = np.array([96 + fn((c - 96) * f) for c in cams])
                err = np.abs(pred - col).max()
                if best is None or err < best[0]: best = (int(err), f, name)
        return best
    if HMODE[rom_s] == 0:   # 화면 전체 스크롤: 0행 값만 유효
        A[:, :] = A[:, :1]; B[:, :] = B[:, :1]
    rowsA = [fit(A[:, r]) for r in range(28)]; rowsB = [fit(B[:, r]) for r in range(12)]
    return rowsA, rowsB, A, B
_scroll_md = None
def scroll_table(s, cam, md=None):
    md = md or load('match_story0')
    pokew(md, 0xe682, s); pokew(md, 0xe006, cam)
    for k in range(0x400): md.ram[0x9c00 + k] = 0
    SENT = 0x3ffff0
    md.a[7] -= 4; md.write(md.a[7], 2, SENT); md.pc = 0x2f6c; md.hook = None
    for _ in range(20000):
        if md.pc == SENT: break
        md.step()
    else: raise RuntimeError('no return')
    md.a[7] += 0
    sgn = lambda v: v - 65536 if v & 0x8000 else v
    return [(sgn(ramw(md, 0x9c00 + r * 0x20)), sgn(ramw(md, 0x9c02 + r * 0x20))) for r in range(28)]
def run_all(only=None):
    summary = {}
    for nn, rs in enumerate(ORDER):
        if only is not None and nn not in only: continue
        A, B, pal, refs, nt, _ = render_idx(rs)
        near = to_img(A, pal, True); far = to_img(B, pal, False)
        # flat: 카메라 96 정렬(far 를 y 0 에 놓고 near 를 덮음)
        flat = Image.new('RGB', (512, 224), pal[0]); flat.paste(far, (0, 0)); flat.paste(near, (0, 0), near)
        tag = 'stage_%02d' % nn
        if nn == 0:   # 기존 stage_00* 는 수정 금지: 동일성만 확인
            for suf, im in (('_near', near), ('_far', far), ('', flat)):
                ex = Image.open(OUTD + tag + suf + '.png').convert('RGBA'); me = im.convert('RGBA')
                print('  stage_00%s identical to existing:' % suf, np.array_equal(np.array(ex), np.array(me)))
        else:
            near.save(OUTD + tag + '_near.png'); far.save(OUTD + tag + '_far.png'); flat.save(OUTD + tag + '.png')
        md = load('match_story0')
        rowsA, rowsB, SA, SB = fit_rows(rs, md)
        summary[nn] = dict(rom=rs, refs=refs, nt=nt, hmode=HMODE[rs], rowsA=rowsA, rowsB=rowsB, SA=SA, SB=SB)
        print(tag, 'rom', rs, 'hmode', HMODE[rs], 'tiles', nt, 'maxerrA', max(r[0] for r in rowsA), 'maxerrB', max(r[0] for r in rowsB), flush=True)
    return summary

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'validate':
        A, B, pal, refs, nt, _ = render_idx(1)
        md = load('match_story0')
        print('cram line3 eq', [cram_rgb(w) for w in md.vdp.cram[48:64]] == pal)
        for n, idx, al in (('stage_00_near', A, True), ('stage_00_far', B, False)):
            ex = np.array(Image.open('public/assets/rom/bg/%s.png' % n).convert('RGBA'))
            mine = np.array(to_img(idx, pal, al).convert('RGBA'))
            if al: d = np.abs(ex.astype(int) - mine.astype(int))[ex[:, :, 3] > 0].sum(), (ex[:, :, 3] != mine[:, :, 3]).sum()
            else: d = np.abs(ex.astype(int) - mine.astype(int)).sum()
            print(n, 'diff', d)
        for cam in (0, 96, 127, 191): print(cam, scroll_table(1, cam)[0])
    else:
        import pickle
        sm = run_all()
        pickle.dump(sm, open(sys.argv[2] if len(sys.argv) > 2 else 'stage_summary.pkl', 'wb'))

